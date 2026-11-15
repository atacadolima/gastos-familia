-- Financiamentos (casa, carro…): dados do contrato + resumo por ano. O app calcula o andamento a partir
-- da posição de referência e das parcelas pagas depois dela (compromisso mensal ligado).
create table if not exists financiamentos (
  id serial primary key,
  nome text not null,
  banco text,
  contrato text,
  compromisso_id int references compromissos on delete set null,
  sistema text not null default 'SAC',
  taxa_anual numeric(6,3),            -- % ao ano (nominal)
  parcelas_total int not null,
  parcelas_pagas int not null,        -- na data de referência
  saldo_devedor numeric(14,2) not null,
  saldo_em date not null,             -- data de referência do saldo
  amortizacao_mes numeric(12,2),
  seguro_mes numeric(12,2),
  taxa_adm_mes numeric(12,2),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create table if not exists financiamento_anos (
  financiamento_id int references financiamentos on delete cascade,
  ano int not null,
  total_pago numeric(14,2), amortizacao numeric(14,2), juros numeric(14,2), seguros numeric(14,2), taxas numeric(14,2),
  saldo_fim numeric(14,2),
  ate_mes int,                        -- ano incompleto: até qual mês os números vão
  estimado boolean not null default false,
  primary key (financiamento_id, ano)
);
do $$ declare t text; begin
  foreach t in array array['financiamentos','financiamento_anos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists membros_tudo on %I', t);
    execute format('create policy membros_tudo on %I for all to authenticated using (eh_membro()) with check (eh_membro())', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;
grant usage, select on sequence financiamentos_id_seq to authenticated, service_role;

-- Casa (Caixa), pelo demonstrativo de 15/11/2026 e pelo extrato do IR 2025
insert into financiamentos (nome, banco, contrato, compromisso_id, sistema, taxa_anual, parcelas_total, parcelas_pagas, saldo_devedor, saldo_em, amortizacao_mes, seguro_mes, taxa_adm_mes)
select 'Financiamento da casa', 'Caixa', '144441073027-3', 5, 'SAC', 9.57, 420, 73, 455417.11, '2026-10-23', 1301.28, 253.53, 25
 where not exists (select 1 from financiamentos where contrato = '144441073027-3');
insert into financiamento_anos (financiamento_id, ano, total_pago, amortizacao, juros, seguros, taxas, saldo_fim, ate_mes, estimado)
select f.id, x.* from financiamentos f, (values
  (2025, 62781.42, 15214.90, 44449.54, 2816.98, 300.00, 460713.34, 12, false),
  (2026, 52271.06, 13012.80, 36596.23, 2537.03, 125.00, 455417.11, 10, true)) x(ano, total_pago, amortizacao, juros, seguros, taxas, saldo_fim, ate_mes, estimado)
 where f.contrato = '144441073027-3'
on conflict (financiamento_id, ano) do nothing;
