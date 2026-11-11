insert into categorias (nome, ordem) values ('Compras', 9), ('Previdência e seguros', 16), ('Doações', 17) on conflict (nome) do nothing;
create table if not exists categorias_pluggy (
  pluggy text primary key,
  categoria_id int references categorias,
  entre_contas boolean not null default false
);
alter table categorias_pluggy enable row level security;
drop policy if exists membros_tudo on categorias_pluggy;
create policy membros_tudo on categorias_pluggy for all to authenticated using (eh_membro()) with check (eh_membro());
grant select, insert, update, delete on categorias_pluggy to authenticated;
grant all on categorias_pluggy to service_role;
insert into categorias_pluggy (pluggy, categoria_id, entre_contas)
select p, (select id from categorias where nome = c), e from (values
 ('Hospital clinics and labs','Farmácia e saúde',false), ('Pharmacy','Farmácia e saúde',false), ('Healthcare','Farmácia e saúde',false),
 ('Dentist','Farmácia e saúde',false), ('Gyms and fitness centers','Lazer',false),
 ('Clothing','Calçados e roupas',false), ('Shopping','Compras',false), ('Online shopping','Compras',false),
 ('Electronics','Compras',false), ('Bookstore','Compras',false), ('Sports goods','Compras',false), ('Houseware','Casa',false),
 ('Automotive','Carro',false), ('Tolls and in vehicle payment','Carro',false), ('Parking','Carro',false), ('Vehicle maintenance','Carro',false),
 ('Gas stations','Combustível',false), ('Donations','Doações',false), ('Telecommunications','Contas (luz, água, internet)',false),
 ('Utilities','Contas (luz, água, internet)',false), ('Electricity','Contas (luz, água, internet)',false), ('Water','Contas (luz, água, internet)',false),
 ('Internet','Contas (luz, água, internet)',false), ('Eating out','Restaurantes e lanches',false), ('Food delivery','Restaurantes e lanches',false),
 ('Food and drinks','Restaurantes e lanches',false), ('Groceries','Mercado',false), ('Supermarkets','Mercado',false), ('Leisure','Lazer',false),
 ('Entertainment','Lazer',false), ('Digital services','Assinaturas',false), ('Video streaming','Assinaturas',false), ('Music streaming','Assinaturas',false),
 ('Bank fees','Tarifas e juros',false), ('Interests charged','Tarifas e juros',false), ('Taxes','Tarifas e juros',false),
 ('Pension','Previdência e seguros',false), ('Insurance','Previdência e seguros',false), ('Health insurance','Previdência e seguros',false),
 ('Education','Educação',false), ('School','Educação',false), ('Travel','Viagem',false), ('Airport and airlines','Viagem',false),
 ('Accomodation','Viagem',false), ('Taxi and ride-hailing','Viagem',false), ('Public transportation','Viagem',false),
 ('Automatic investment',null,true), ('Investments',null,true), ('Fixed income',null,true), ('Mutual funds',null,true), ('Variable income',null,true)
) v(p, c, e)
on conflict (pluggy) do nothing;
-- aplica no que já entrou
update lancamentos l set conta_como = 'Entre contas', categoria_id = null
from transacoes_banco t join categorias_pluggy cp on cp.pluggy = t.categoria_pluggy
where l.transacao_banco_id = t.id and l.conta_como = 'Gasto' and cp.entre_contas;
update lancamentos l set categoria_id = cp.categoria_id
from transacoes_banco t join categorias_pluggy cp on cp.pluggy = t.categoria_pluggy
where l.transacao_banco_id = t.id and l.conta_como = 'Gasto' and l.categoria_id is null and cp.categoria_id is not null
  and not exists (select 1 from partes p where p.lancamento_id = l.id);
select count(*) filter (where categoria_id is null) sem_cat, count(*) gastos from lancamentos where conta_como = 'Gasto';
