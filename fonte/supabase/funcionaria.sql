-- Funcionária da casa: cadastro, faltas, recibo mensal com confirmação ("Recebi")
create table if not exists funcionarios (
  id serial primary key,
  nome text not null,
  user_id uuid references auth.users on delete set null,   -- login dela (papel 'compras')
  usuario text,                                            -- o que ela digita para entrar (sem @)
  admissao date not null,
  saida date,
  salario numeric(12,2) not null check (salario > 0),
  dia_pagamento int not null default 5 check (dia_pagamento between 1 and 31),
  dias_semana int[] not null default '{1,2,3,4,5}',      -- 0=dom … 6=sáb
  compromisso_id int references compromissos on delete set null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create table if not exists faltas (
  id serial primary key,
  funcionario_id int not null references funcionarios on delete cascade,
  data date not null,
  justificada boolean not null default false,
  obs text,
  unique (funcionario_id, data)
);
create table if not exists recibos (
  id serial primary key,
  funcionario_id int not null references funcionarios on delete cascade,
  mes date not null,                         -- 1º dia do mês de referência
  salario numeric(12,2) not null,
  dias_previstos int not null,               -- dias de trabalho do mês (pelos dias da semana dela)
  dias_devidos int not null,                 -- dias de trabalho dentro do período em que ela estava na casa
  base numeric(12,2) not null,               -- salário (proporcional se entrou/saiu no mês)
  faltas_datas date[] not null default '{}', -- só as não justificadas
  justificadas_datas date[] not null default '{}',
  valor_dia numeric(12,2) not null,
  desconto_faltas numeric(12,2) not null default 0,
  adiantamentos numeric(12,2) not null default 0,
  adiantamentos_obs text,
  valor_pago numeric(12,2) not null,
  enviado_em timestamptz,
  confirmado_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (funcionario_id, mes)
);

create or replace function public.minha_funcionaria() returns int
language sql stable security definer set search_path = public as
$$ select id from funcionarios where user_id = auth.uid() and ativo limit 1 $$;

alter table funcionarios enable row level security;
alter table faltas enable row level security;
alter table recibos enable row level security;
drop policy if exists completo on funcionarios; drop policy if exists ela on funcionarios;
create policy completo on funcionarios for all to authenticated using (eh_membro()) with check (eh_membro());
create policy ela on funcionarios for select to authenticated using (id = minha_funcionaria());
drop policy if exists completo on faltas; drop policy if exists ela on faltas;
create policy completo on faltas for all to authenticated using (eh_membro()) with check (eh_membro());
create policy ela on faltas for select to authenticated using (funcionario_id = minha_funcionaria());
drop policy if exists completo on recibos; drop policy if exists ela on recibos;
create policy completo on recibos for all to authenticated using (eh_membro()) with check (eh_membro());
create policy ela on recibos for select to authenticated using (funcionario_id = minha_funcionaria() and enviado_em is not null);
grant select, insert, update, delete on funcionarios, faltas, recibos to authenticated;
grant all on funcionarios, faltas, recibos to service_role;
grant usage, select on sequence funcionarios_id_seq, faltas_id_seq, recibos_id_seq to authenticated, service_role;

-- Envia o recibo: avisa a funcionária e acerta o valor previsto do salário daquele mês
create or replace function public.enviar_recibo(p_id int) returns void
language plpgsql security definer set search_path = public as $$
declare r record; f record;
begin
  if not eh_membro() then raise exception 'sem acesso'; end if;
  select * into r from recibos where id = p_id;
  select * into f from funcionarios where id = r.funcionario_id;
  update recibos set enviado_em = now(), confirmado_em = null where id = p_id;
  if f.user_id is not null then
    insert into notificacoes (user_id, titulo, texto, tag, aba)
    values (f.user_id, 'Recibo de ' || to_char(r.mes, 'MM/YYYY'),
            'Valor: R$ ' || translate(to_char(r.valor_pago, 'FM999,999,990.00'), ',.', '.,') || '. Toque para conferir e confirmar.',
            'recibo-' || p_id, 'recibos');
  end if;
  if f.compromisso_id is not null then
    update lancamentos set valor = r.valor_pago, atualizado_em = now()
     where compromisso_id = f.compromisso_id and previsto
       and date_trunc('month', data_hora at time zone 'America/Sao_Paulo') = r.mes;
  end if;
end $$;
revoke all on function public.enviar_recibo(int) from public, anon;
grant execute on function public.enviar_recibo(int) to authenticated;

-- Ela confirma: grava a hora e avisa Daniel e Helene
create or replace function public.confirmar_recibo(p_id int) returns void
language plpgsql security definer set search_path = public as $$
declare r record; f record; m record;
begin
  select * into r from recibos where id = p_id and enviado_em is not null;
  if r.id is null or r.funcionario_id is distinct from minha_funcionaria() then raise exception 'sem acesso'; end if;
  if r.confirmado_em is not null then return; end if;
  update recibos set confirmado_em = now() where id = p_id;
  select * into f from funcionarios where id = r.funcionario_id;
  for m in select user_id from membros where papel = 'completo' loop
    insert into notificacoes (user_id, titulo, texto, tag, aba)
    values (m.user_id, f.nome || ' confirmou o recibo',
            to_char(r.mes, 'MM/YYYY') || ' · R$ ' || translate(to_char(r.valor_pago, 'FM999,999,990.00'), ',.', '.,'),
            'recibo-ok-' || p_id, 'inicio');
  end loop;
end $$;
revoke all on function public.confirmar_recibo(int) from public, anon;
grant execute on function public.confirmar_recibo(int) to authenticated;
