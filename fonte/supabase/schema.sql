-- Gastos da Família — estrutura do banco
create extension if not exists pgcrypto;

-- Quem pode usar o app (Daniel e Helene). Preenchido quando os logins forem criados.
create table if not exists membros (
  user_id uuid primary key references auth.users on delete cascade,
  nome text not null
);

create or replace function public.eh_membro() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from membros where user_id = auth.uid()) $$;

create table if not exists pessoas (
  id text primary key,
  nome text not null,
  ordem int not null default 0
);

create table if not exists cartoes (
  banco text not null,
  final text not null,
  pessoa_id text not null references pessoas,
  descricao text,
  primary key (banco, final)
);

create table if not exists categorias (
  id serial primary key,
  nome text not null unique,
  ordem int not null default 0,
  ativa boolean not null default true
);

-- "Aprendizado": trecho do nome do estabelecimento -> categoria
create table if not exists regras_categoria (
  id serial primary key,
  padrao text not null unique,
  categoria_id int not null references categorias,
  criado_em timestamptz not null default now()
);

-- Celulares que mandam avisos (a chave fica só no celular; aqui só o hash)
create table if not exists dispositivos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  chave_hash text not null unique,
  ativo boolean not null default true,
  ultimo_contato timestamptz,
  criado_em timestamptz not null default now()
);

create table if not exists avisos (
  id bigserial primary key,
  dispositivo_id uuid references dispositivos,
  pacote text not null,
  titulo text,
  texto text,
  recebido_em timestamptz not null,
  chave text not null unique,
  lido jsonb,
  lancamento_id bigint,
  criado_em timestamptz not null default now()
);

create table if not exists lancamentos (
  id bigserial primary key,
  origem text not null check (origem in ('aviso','banco','manual')),
  banco text,
  tipo text,
  conta_como text not null check (conta_como in ('Gasto','Receita','Entre contas','Detalhe')),
  valor numeric(12,2) not null check (valor >= 0),
  data_hora timestamptz not null,
  descricao text,
  final_cartao text,
  pessoa_id text references pessoas,
  categoria_id int references categorias,
  observacao text,
  parcela int,
  total_parcelas int,
  aviso_id bigint references avisos,
  transacao_banco_id text unique,
  conferido boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists lancamentos_data on lancamentos (data_hora desc);

-- Divisão de um lançamento em várias categorias
create table if not exists partes (
  id bigserial primary key,
  lancamento_id bigint not null references lancamentos on delete cascade,
  categoria_id int references categorias,
  pessoa_id text references pessoas,
  valor numeric(12,2) not null check (valor > 0),
  observacao text
);

create table if not exists abastecimentos (
  lancamento_id bigint primary key references lancamentos on delete cascade,
  km int,
  litros numeric(8,3),
  tanque_cheio boolean not null default true
);

-- Open Finance (Pluggy)
create table if not exists pluggy_itens (
  id text primary key,
  banco text not null
);

create table if not exists contas_banco (
  id text primary key,
  item_id text references pluggy_itens,
  banco text,
  tipo text,
  subtipo text,
  nome text,
  numero text,
  saldo numeric(14,2),
  limite_disponivel numeric(14,2),
  fechamento date,
  vencimento date,
  atualizado_em timestamptz
);

create table if not exists transacoes_banco (
  id text primary key,
  conta_id text references contas_banco,
  banco text,
  data timestamptz not null,
  descricao text,
  valor numeric(12,2) not null,
  sentido text not null check (sentido in ('saida','entrada')),
  conta_tipo text,
  final_cartao text,
  parcela int,
  total_parcelas int,
  categoria_pluggy text,
  contraparte text,
  bruto jsonb,
  lancamento_id bigint references lancamentos,
  criado_em timestamptz not null default now()
);

create table if not exists sync_log (
  id bigserial primary key,
  inicio timestamptz not null default now(),
  fim timestamptz,
  ok boolean,
  detalhe text
);

-- Regras de acesso: só membros logados; o celular e o robô entram pelas funções do servidor
do $$
declare t text;
begin
  foreach t in array array['pessoas','cartoes','categorias','regras_categoria','lancamentos','partes','abastecimentos'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists membros_tudo on %I', t);
    execute format('create policy membros_tudo on %I for all to authenticated using (eh_membro()) with check (eh_membro())', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
  foreach t in array array['membros','dispositivos','avisos','pluggy_itens','contas_banco','transacoes_banco','sync_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists membros_ler on %I', t);
    execute format('create policy membros_ler on %I for select to authenticated using (eh_membro())', t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;
revoke all on all tables in schema public from anon;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.eh_membro() to authenticated;

-- Dados iniciais
insert into pessoas (id, nome, ordem) values
  ('daniel','Daniel',1), ('helene','Helene',2), ('gabriel','Gabriel',3)
on conflict (id) do nothing;

insert into cartoes (banco, final, pessoa_id, descricao) values
  ('C6','2337','daniel','C6 físico'),
  ('C6','7201','daniel','C6 virtual'),
  ('C6','4668','helene','C6 Helene'),
  ('C6','6421','gabriel','C6 Gabriel'),
  ('Itaú','9523','daniel','Itaú Person Black'),
  ('Itaú','8306','helene','Itaú Helene')
on conflict do nothing;

insert into categorias (nome, ordem) values
  ('Mercado',1), ('Combustível',2), ('Carro',3), ('Restaurantes e lanches',4),
  ('Farmácia e saúde',5), ('Casa',6), ('Contas (luz, água, internet)',7),
  ('Assinaturas',8), ('Calçados e roupas',9), ('Gabriel',10), ('Lazer',11),
  ('Viagem',12), ('Educação',13), ('Presentes',14), ('Outros',99)
on conflict (nome) do nothing;

insert into regras_categoria (padrao, categoria_id)
select p, (select id from categorias where nome = c) from (values
  ('youtube','Assinaturas'), ('google one','Assinaturas'), ('google*one','Assinaturas'),
  ('netflix','Assinaturas'), ('spotify','Assinaturas'), ('posto','Combustível'),
  ('calcados','Calçados e roupas'), ('tag itaú','Carro'), ('farmacia','Farmácia e saúde'),
  ('drogaria','Farmácia e saúde'), ('supermercado','Mercado')
) v(p, c)
on conflict (padrao) do nothing;

insert into pluggy_itens (id, banco) values
  ('d627e02b-bbbd-408d-babd-7f94d883789d','BB'),
  ('8a631b07-f2f4-47cf-9a54-2975d8d20b47','C6'),
  ('abea216b-b028-48ed-bc43-5b0bf578eb56','Itaú')
on conflict (id) do nothing;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
insert into pessoas (id, nome, ordem) values ('outros','Outros',9) on conflict (id) do nothing;
insert into pessoas (id, nome, ordem) values ('familia','Família (geral)',4) on conflict (id) do nothing;
