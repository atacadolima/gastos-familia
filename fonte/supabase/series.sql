-- Séries (parcelas da mesma compra / assinaturas) e lançamentos previstos
alter table lancamentos add column if not exists serie text;
alter table lancamentos add column if not exists previsto boolean not null default false;
create index if not exists lancamentos_serie on lancamentos (serie);

-- Nome-base: tira "02/03", números soltos, asteriscos e espaços repetidos
create or replace function public.base_desc(d text) returns text language sql immutable as $$
  select trim(regexp_replace(regexp_replace(lower(coalesce(d,'')), '\d{2}/\d{2}\s*$', ''), '\s+', ' ', 'g'))
$$;

create or replace function public.gerar_previstos() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r record; k int; n_prev int := 0; n_apag int := 0; n_cat int := 0; n_rec int := 0;
begin
  -- 1) Marca a série das compras parceladas
  update lancamentos set serie = 'parc:' || coalesce(banco,'') || '|' || coalesce(final_cartao,'') || '|' || base_desc(descricao)
         || '|' || total_parcelas || '|' || round(valor)::text
   where total_parcelas > 1 and serie is null and not previsto;

  -- 2) Parcela real chegou: apaga a prevista correspondente
  with apagar as (
    delete from lancamentos p where p.previsto
      and exists (select 1 from lancamentos x where not x.previsto and x.serie = p.serie and x.parcela = p.parcela)
    returning 1)
  select count(*) into n_apag from apagar;

  -- 3) Parcela nova sem categoria/dono herda da série
  with herda as (
    update lancamentos l set categoria_id = s.categoria_id, pessoa_id = s.pessoa_id, atualizado_em = now()
      from (select distinct on (serie) serie, categoria_id, pessoa_id from lancamentos
             where serie is not null and categoria_id is not null order by serie, atualizado_em desc) s
     where l.serie = s.serie and l.categoria_id is null and l.conta_como = 'Gasto'
    returning 1)
  select count(*) into n_cat from herda;

  -- 4) Cria as parcelas que faltam como previstas
  for r in
    select distinct on (serie) * from lancamentos
     where serie like 'parc:%' and not previsto and parcela is not null and total_parcelas > parcela
     order by serie, parcela desc
  loop
    for k in (r.parcela + 1)..r.total_parcelas loop
      if not exists (select 1 from lancamentos where serie = r.serie and parcela = k) then
        insert into lancamentos (origem, banco, tipo, conta_como, valor, data_hora, descricao, final_cartao, pessoa_id,
                                 categoria_id, parcela, total_parcelas, serie, previsto, conferido)
        values ('manual', r.banco, r.tipo, r.conta_como, r.valor,
                r.data_hora + make_interval(months => k - r.parcela), r.descricao, r.final_cartao, r.pessoa_id,
                r.categoria_id, k, r.total_parcelas, r.serie, true, false);
        n_prev := n_prev + 1;
      end if;
    end loop;
  end loop;

  -- 5) Assinaturas: mesmo lugar e mesmo valor, uma vez por mês, em 2+ meses seguidos (perto do mesmo dia)
  update lancamentos l set serie = 'rec:' || coalesce(l.banco,'') || '|' || base_desc(l.descricao) || '|' || l.valor::text
   where l.serie is null and l.conta_como = 'Gasto' and not l.previsto and coalesce(l.total_parcelas,1) <= 1
     and coalesce(l.tipo,'') not ilike '%débito%' and coalesce(l.tipo,'') not ilike 'pix%'
     and base_desc(l.descricao) !~ '(pedagio|tag|conv |posto|padaria|mercado|supermerc)'
     and exists (select 1 from lancamentos x
                  where x.id <> l.id and not x.previsto and x.conta_como = 'Gasto' and coalesce(x.banco,'') = coalesce(l.banco,'')
                    and base_desc(x.descricao) = base_desc(l.descricao) and x.valor = l.valor
                    and abs(extract(epoch from (l.data_hora - x.data_hora)) / 86400) between 25 and 36)
     and not exists (select 1 from lancamentos y
                  where y.id <> l.id and not y.previsto and coalesce(y.banco,'') = coalesce(l.banco,'')
                    and base_desc(y.descricao) = base_desc(l.descricao) and y.valor = l.valor
                    and abs(extract(epoch from (l.data_hora - y.data_hora)) / 86400) < 20);
  for r in
    select distinct on (serie) * from lancamentos where serie like 'rec:%' and not previsto order by serie, data_hora desc
  loop
    if r.data_hora > now() - interval '40 days'
       and not exists (select 1 from lancamentos where serie = r.serie and data_hora > r.data_hora + interval '20 days') then
      insert into lancamentos (origem, banco, tipo, conta_como, valor, data_hora, descricao, final_cartao, pessoa_id,
                               categoria_id, serie, previsto, conferido)
      values ('manual', r.banco, r.tipo, 'Gasto', r.valor, r.data_hora + interval '1 month', r.descricao, r.final_cartao,
              r.pessoa_id, r.categoria_id, r.serie, true, false);
      n_rec := n_rec + 1;
    end if;
  end loop;
  -- assinatura real chegou no mês: apaga a prevista daquele mês
  delete from lancamentos p where p.previsto and p.serie like 'rec:%'
     and exists (select 1 from lancamentos x where not x.previsto and x.serie = p.serie
                  and abs(extract(epoch from x.data_hora - p.data_hora)) < 20 * 86400);

  return jsonb_build_object('previstas_novas', n_prev, 'previstas_apagadas', n_apag, 'herdaram_categoria', n_cat, 'assinaturas_previstas', n_rec);
end $$;
revoke all on function public.gerar_previstos() from public, anon;
grant execute on function public.gerar_previstos() to authenticated, service_role;

-- Aplica categoria/dono/divisão de um lançamento em toda a série
create or replace function public.aplicar_serie(p_id bigint) returns int
language plpgsql security definer set search_path = public as $$
declare base lancamentos; n int; outro record; pess text[]; i int; cents bigint; q int;
begin
  if not eh_membro() then raise exception 'sem acesso'; end if;
  select * into base from lancamentos where id = p_id;
  if base.serie is null then return 0; end if;
  update lancamentos set categoria_id = base.categoria_id, pessoa_id = base.pessoa_id, conta_como = base.conta_como,
         caixinha_id = base.caixinha_id, atualizado_em = now()
   where serie = base.serie and id <> base.id;
  get diagnostics n = row_count;
  -- divisão entre pessoas (partes de mesma categoria): replica dividindo igual
  select array_agg(pessoa_id order by id) into pess from partes where lancamento_id = base.id;
  for outro in select id, valor from lancamentos where serie = base.serie and id <> base.id loop
    delete from partes where lancamento_id = outro.id;
    if pess is not null and array_length(pess,1) > 1 then
      q := array_length(pess,1); cents := round(outro.valor * 100);
      for i in 1..q loop
        insert into partes (lancamento_id, categoria_id, pessoa_id, valor)
        values (outro.id, base.categoria_id, pess[i], ((cents / q) + case when i <= cents % q then 1 else 0 end) / 100.0);
      end loop;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.aplicar_serie(bigint) from public, anon;
grant execute on function public.aplicar_serie(bigint) to authenticated;

-- Mercado Livre não é mercado
insert into regras_categoria (padrao, categoria_id) select p, (select id from categorias where nome='Compras') from (values
  ('mercadoliv'), ('mercado livre'), ('mercado*mercadoliv'), ('mercadolivre'), ('mercado pago')) v(p)
on conflict (padrao) do update set categoria_id = excluded.categoria_id;
update lancamentos set categoria_id = (select id from categorias where nome='Compras')
 where descricao ~* 'mercado\s*\*?\s*livre|mercadoliv' and categoria_id = (select id from categorias where nome='Mercado');

select gerar_previstos();
