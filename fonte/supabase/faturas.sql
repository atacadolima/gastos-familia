-- Faturas de cartão fechadas, como o banco informa (vencimento e valor) — base do semáforo "pela conta"
create table if not exists faturas_cartao (
  id text primary key,                       -- id da fatura na Pluggy
  conta_id text not null,
  banco text,
  numero text,
  vencimento date not null,
  total numeric(14,2) not null,
  minimo numeric(14,2),
  atualizado_em timestamptz not null default now()
);
create index if not exists faturas_cartao_venc on faturas_cartao (vencimento);
alter table faturas_cartao enable row level security;
drop policy if exists membros_ler on faturas_cartao;
create policy membros_ler on faturas_cartao for select to authenticated using (eh_membro());
grant select on faturas_cartao to authenticated;
grant all on faturas_cartao to service_role;
