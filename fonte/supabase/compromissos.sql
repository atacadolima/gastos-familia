-- Compromissos mensais cadastrados à mão (salário da funcionária, escola, aluguel, luz…)
create table if not exists compromissos (
  id serial primary key,
  nome text not null,
  valor numeric(14,2) not null check (valor > 0),
  dia int not null check (dia between 1 and 31),
  categoria_id int references categorias,
  pessoa_id text references pessoas default 'familia',
  conta_como text not null default 'Gasto' check (conta_como in ('Gasto','Receita')),
  varia boolean not null default false,          -- valor aproximado (luz, água)
  palavra text,                                  -- texto que aparece no banco (ajuda a reconhecer o pagamento)
  inicio date not null default date_trunc('month', now())::date,
  meses int check (meses is null or meses > 0),  -- null = todo mês, sem fim
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table lancamentos add column if not exists compromisso_id int references compromissos on delete set null;
create index if not exists lancamentos_compromisso on lancamentos (compromisso_id);

alter table compromissos enable row level security;
drop policy if exists membros_tudo on compromissos;
create policy membros_tudo on compromissos for all to authenticated using (eh_membro()) with check (eh_membro());
grant select, insert, update, delete on compromissos to authenticated;
grant all on compromissos to service_role;
grant usage, select on sequence compromissos_id_seq to authenticated, service_role;

-- Gera os previstos dos próximos meses e troca pelo pagamento real quando ele aparece
create or replace function public.gerar_compromissos() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c record; pv record; m date; venc timestamptz; n_novos int := 0; n_casados int := 0; n_apag int := 0; achado bigint; k int;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- 1) Apaga previstos de compromissos encerrados/pausados ou fora do prazo
  with apagar as (
    delete from lancamentos l using compromissos cc
     where l.compromisso_id = cc.id and l.previsto
       and (not cc.ativo
            or date_trunc('month', l.data_hora at time zone 'America/Sao_Paulo') < date_trunc('month', cc.inicio)
            or (cc.meses is not null and date_trunc('month', l.data_hora at time zone 'America/Sao_Paulo')
                                        >= date_trunc('month', cc.inicio) + make_interval(months => cc.meses)))
    returning 1)
  select count(*) into n_apag from apagar;

  for c in select * from compromissos where ativo loop
    -- 3) Cria os previstos do mês atual até 6 meses à frente
    for k in 0..6 loop
      m := (date_trunc('month', hoje) + make_interval(months => k))::date;
      continue when m < date_trunc('month', c.inicio)::date;
      exit when c.meses is not null and m >= (date_trunc('month', c.inicio) + make_interval(months => c.meses))::date;
      if not exists (select 1 from lancamentos where compromisso_id = c.id
                        and date_trunc('month', data_hora at time zone 'America/Sao_Paulo') = m) then
        venc := ((m + (least(c.dia, extract(day from (m + interval '1 month - 1 day'))::int) - 1)) + time '12:00')
                at time zone 'America/Sao_Paulo';
        insert into lancamentos (origem, tipo, conta_como, valor, data_hora, descricao, pessoa_id, categoria_id,
                                 serie, previsto, conferido, compromisso_id)
        values ('manual', 'Compromisso', c.conta_como, c.valor, venc, c.nome, c.pessoa_id,
                case when c.conta_como = 'Gasto' then c.categoria_id end,
                'cmp:' || c.id, true, false, c.id);
        n_novos := n_novos + 1;
      end if;
    end loop;
    -- 2) Pagamento real já chegou? (mesmo mês, perto do dia, valor parecido ou texto do banco)
    for pv in select * from lancamentos p where p.compromisso_id = c.id and p.previsto loop
      achado := null;
      select x.id into achado from lancamentos x
       where not x.previsto and x.compromisso_id is null
         and x.conta_como in ('Gasto','Receita','Entre contas')
         and (c.conta_como = 'Receita') = (x.conta_como = 'Receita')
         and abs(extract(epoch from (x.data_hora - pv.data_hora)) / 86400) <= 10
         and (
           (c.palavra is not null and length(trim(c.palavra)) >= 3
              and lower(x.descricao) like '%' || lower(trim(c.palavra)) || '%'
              and x.valor between c.valor * 0.5 and c.valor * 1.5)
           or (not c.varia and abs(x.valor - c.valor) <= greatest(1, c.valor * 0.01))
         )
       order by abs(x.valor - c.valor), abs(extract(epoch from (x.data_hora - pv.data_hora)))
       limit 1;
      if achado is not null then
        update lancamentos set compromisso_id = c.id,
               categoria_id = coalesce(categoria_id, c.categoria_id),
               conta_como = case when conta_como = 'Entre contas' then 'Gasto' else conta_como end,
               atualizado_em = now()
         where id = achado;
        delete from lancamentos where id = pv.id;
        n_casados := n_casados + 1;
      end if;
    end loop;

  end loop;
  return jsonb_build_object('novos', n_novos, 'pagos_reconhecidos', n_casados, 'apagados', n_apag);
end $$;
revoke all on function public.gerar_compromissos() from public, anon;
grant execute on function public.gerar_compromissos() to authenticated, service_role;

-- Atualiza os previstos futuros quando o compromisso muda (valor, dia, categoria…)
create or replace function public.refazer_compromisso(p_id int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not eh_membro() and current_user <> 'service_role' then raise exception 'sem acesso'; end if;
  delete from lancamentos where compromisso_id = p_id and previsto;
  return gerar_compromissos();
end $$;
revoke all on function public.refazer_compromisso(int) from public, anon;
grant execute on function public.refazer_compromisso(int) to authenticated, service_role;
