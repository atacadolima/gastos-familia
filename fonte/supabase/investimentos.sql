-- Investimentos: caixinhas com saldo; lançamentos do tipo "Investimento" (aporte ou resgate)
alter table lancamentos drop constraint if exists lancamentos_conta_como_check;
alter table lancamentos add constraint lancamentos_conta_como_check
  check (conta_como in ('Gasto','Receita','Entre contas','Detalhe','Investimento'));

create table if not exists caixinhas (
  id serial primary key,
  nome text not null unique,
  tipo text not null default 'outro' check (tipo in ('banco','previdencia','consorcio','dolar','poupanca','outro')),
  banco text,
  pluggy_id text unique,          -- investimento lido do banco (Open Finance)
  saldo_banco numeric(14,2),      -- saldo informado pelo banco
  saldo_banco_em timestamptz,
  saldo_inicial numeric(14,2) not null default 0,  -- o que já tinha antes de começar a anotar
  qtd_dolar numeric(14,2),        -- caixinha de dólar: quantos US$
  valor_carta numeric(14,2),      -- consórcio: valor da carta
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);
alter table lancamentos add column if not exists caixinha_id int references caixinhas;
alter table lancamentos add column if not exists resgate boolean not null default false;

-- padrões do texto do banco que indicam investimento -> caixinha
create table if not exists regras_caixinha (
  padrao text primary key,
  caixinha text not null,
  tipo text not null default 'banco'
);
insert into regras_caixinha (padrao, caixinha, tipo) values
  ('rende facil', 'Rende Fácil BB', 'banco'), ('rend.facil', 'Rende Fácil BB', 'banco'),
  ('brasilprev', 'Brasilprev', 'previdencia'), ('previd', 'Previdência', 'previdencia'),
  ('poupanca', 'Poupança', 'poupanca'), ('cdb', 'CDB', 'banco'), ('consorcio', 'Consórcio', 'consorcio')
on conflict (padrao) do nothing;

do $$
declare t text;
begin
  foreach t in array array['caixinhas','regras_caixinha'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists membros_tudo on %I', t);
    execute format('create policy membros_tudo on %I for all to authenticated using (eh_membro()) with check (eh_membro())', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;
grant usage, select on sequence caixinhas_id_seq to authenticated, service_role;

-- Categorias do banco que são investimento
alter table categorias_pluggy add column if not exists investimento boolean not null default false;
update categorias_pluggy set investimento = true, entre_contas = false, categoria_id = null
 where pluggy in ('Automatic investment','Investments','Fixed income','Mutual funds','Variable income','Pension');

-- Saldo de cada caixinha: o do banco quando houver; senão saldo inicial + aportes - resgates
create or replace view caixinhas_saldo with (security_invoker = true) as
select c.*,
  coalesce(sum(l.valor) filter (where not l.resgate), 0) as aportes,
  coalesce(sum(l.valor) filter (where l.resgate), 0) as resgates,
  coalesce(c.saldo_banco, c.saldo_inicial + coalesce(sum(l.valor) filter (where not l.resgate), 0) - coalesce(sum(l.valor) filter (where l.resgate), 0)) as saldo
from caixinhas c
left join lancamentos l on l.caixinha_id = c.id and l.conta_como = 'Investimento'
group by c.id;
grant select on caixinhas_saldo to authenticated, service_role;

-- Reclassifica o que já entrou
insert into caixinhas (nome, tipo, banco) values ('Rende Fácil BB','banco','BB'), ('Brasilprev','previdencia','BB') on conflict (nome) do nothing;
update lancamentos l set conta_como = 'Investimento', categoria_id = null, resgate = (t.sentido = 'entrada'),
       caixinha_id = (select id from caixinhas where nome = 'Rende Fácil BB'), atualizado_em = now()
from transacoes_banco t where t.lancamento_id = l.id and t.bruto->>'description' ~* 'rend\.?\s*facil|rende facil';
update lancamentos l set conta_como = 'Investimento', categoria_id = null, resgate = false,
       caixinha_id = (select id from caixinhas where nome = 'Brasilprev'), atualizado_em = now()
from transacoes_banco t where t.lancamento_id = l.id and t.bruto->>'description' ~* 'brasilprev';
delete from partes where lancamento_id in (select id from lancamentos where conta_como = 'Investimento');
select nome, aportes, resgates, saldo from caixinhas_saldo;
