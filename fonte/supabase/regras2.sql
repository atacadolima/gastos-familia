insert into categorias (nome, ordem) values ('Tarifas e juros', 15) on conflict (nome) do nothing;
insert into regras_categoria (padrao, categoria_id)
select p, (select id from categorias where nome = c) from (values
  ('pedagio','Carro'), ('c6tag','Carro'), ('sem parar','Carro'), ('veloe','Carro'),
  ('iof','Tarifas e juros'), ('juros','Tarifas e juros'), ('tarifa','Tarifas e juros'), ('encargo','Tarifas e juros'), ('anuidade','Tarifas e juros'),
  ('copasa','Contas (luz, água, internet)'), ('saneamento','Contas (luz, água, internet)'), ('cemig','Contas (luz, água, internet)'),
  ('energia','Contas (luz, água, internet)'), ('ifood','Restaurantes e lanches'), ('sorvete','Restaurantes e lanches'),
  ('padaria','Restaurantes e lanches'), ('restaurante','Restaurantes e lanches'), ('lanchonete','Restaurantes e lanches'),
  ('drogasil','Farmácia e saúde'), ('raia','Farmácia e saúde'), ('uber','Viagem'), ('mercado','Mercado'), ('atacadao','Mercado'),
  ('shell','Combustível'), ('ipiranga','Combustível'), ('auto posto','Combustível'), ('amazon prime','Assinaturas'), ('apple.com','Assinaturas')
) v(p, c)
on conflict (padrao) do nothing;
