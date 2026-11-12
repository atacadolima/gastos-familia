insert into categorias (nome, ordem) values
  ('Beleza e cuidados', 18), ('Funcionária e serviços da casa', 19), ('Impostos', 20),
  ('Moradia', 21), ('Academia e esporte', 22), ('Pets', 23), ('Empresa / reembolsar', 24)
on conflict (nome) do nothing;
update categorias_pluggy set categoria_id = (select id from categorias where nome='Impostos') where pluggy = 'Taxes';
update categorias_pluggy set categoria_id = (select id from categorias where nome='Academia e esporte') where pluggy = 'Gyms and fitness centers';
insert into categorias_pluggy (pluggy, categoria_id) select p, (select id from categorias where nome=c) from (values
  ('Pet supplies and vet','Pets'), ('Pets','Pets'), ('Beauty and personal care','Beleza e cuidados'), ('Personal care','Beleza e cuidados'),
  ('Rent','Moradia'), ('Housing','Moradia'), ('Sports','Academia e esporte'), ('Vehicle tax','Impostos')
) v(p,c) on conflict (pluggy) do nothing;
insert into regras_categoria (padrao, categoria_id) select p, (select id from categorias where nome=c) from (values
  ('ipva','Impostos'), ('iptu','Impostos'), ('licenciamento','Impostos'), ('detran','Impostos'), ('darf','Impostos'),
  ('salao','Beleza e cuidados'), ('barbearia','Beleza e cuidados'), ('cabeleireiro','Beleza e cuidados'),
  ('petshop','Pets'), ('pet shop','Pets'), ('veterinari','Pets'), ('academia','Academia e esporte'), ('smart fit','Academia e esporte'),
  ('condominio','Moradia'), ('aluguel','Moradia')
) v(p,c) on conflict (padrao) do nothing;
select count(*) from categorias;
