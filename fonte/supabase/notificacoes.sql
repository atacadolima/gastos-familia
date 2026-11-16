-- Avisos no celular: itens novos na lista de Compras (agrupados) e compromissos que vencem hoje
alter table compras_itens add column if not exists notificado boolean not null default false;
alter table compras_itens add column if not exists notif_comprado boolean not null default false;
update compras_itens set notif_comprado = true where not notif_comprado and comprado_em is not null and comprado_em < now() - interval '30 minutes';
update compras_itens set notificado = true where not notificado and criado_em < now() - interval '10 minutes';
alter table dispositivos add column if not exists user_id uuid references auth.users;
update dispositivos set user_id = '39e47a06-8893-4260-8de2-6d997739f10c' where nome = 'Celular do Daniel' and user_id is null;

create table if not exists notificacoes (
  id bigserial primary key,
  user_id uuid not null references auth.users on delete cascade,
  titulo text not null,
  texto text not null,
  tag text,                                     -- mesmo tag: o celular substitui o aviso anterior
  aba text,                                     -- tela que abre ao tocar
  criado_em timestamptz not null default now(),
  push_enviado boolean not null default false,  -- iPhone/navegador (Web Push)
  entregue_android boolean not null default false
);
create index if not exists notificacoes_user on notificacoes (user_id, criado_em desc);
alter table notificacoes enable row level security;
drop policy if exists proprio on notificacoes;
create policy proprio on notificacoes for select to authenticated using (user_id = auth.uid());
grant select on notificacoes to authenticated;
grant all on notificacoes to service_role;
grant usage, select on sequence notificacoes_id_seq to service_role;

create table if not exists push_inscricoes (
  endpoint text primary key,
  user_id uuid not null references auth.users on delete cascade,
  p256dh text not null,
  auth text not null,
  criado_em timestamptz not null default now()
);
alter table push_inscricoes enable row level security;
drop policy if exists proprio on push_inscricoes;
create policy proprio on push_inscricoes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on push_inscricoes to authenticated;
grant all on push_inscricoes to service_role;

create table if not exists notif_compromissos (lancamento_id bigint primary key, criado_em timestamptz not null default now());
grant all on notif_compromissos to service_role;

create or replace function public.gerar_notificacoes() returns int
language plpgsql security definer set search_path = public as $$
declare a record; m record; n int := 0; nomes text; qtd int; autor text; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- 1) Compras: espera 2 min sem item novo da mesma pessoa e manda um aviso só
  for a in
    select criado_por, max(criado_em) ultimo, count(*) qtd, string_agg(nome, ', ' order by criado_em) itens, array_agg(id) ids
      from compras_itens where not notificado and criado_por is not null and comprado_em is null
     group by criado_por
  loop
    continue when a.ultimo > now() - interval '2 minutes';
    select coalesce(nome, 'Alguém') into autor from membros where user_id = a.criado_por;
    nomes := case when length(a.itens) > 120 then left(a.itens, 117) || '…' else a.itens end;
    for m in select user_id from membros where user_id <> a.criado_por and papel = 'completo' loop
      insert into notificacoes (user_id, titulo, texto, tag, aba)
      values (m.user_id, case when a.qtd = 1 then coalesce(autor,'Alguém') || ' adicionou à lista de compras'
                              else coalesce(autor,'Alguém') || ' adicionou ' || a.qtd || ' itens à lista' end,
              nomes, 'compras', 'compras');
      n := n + 1;
    end loop;
    update compras_itens set notificado = true where id = any(a.ids);
  end loop;
  update compras_itens set notificado = true where not notificado and (criado_por is null or comprado_em is not null);

  -- 1b) Comprado: espera 10 min sem marcação nova de quem está comprando e avisa só quem pediu
  for a in
    select comprado_por, max(comprado_em) ultimo, array_agg(id) ids
      from compras_itens where not notif_comprado and comprado_em is not null and comprado_por is not null
     group by comprado_por
  loop
    continue when a.ultimo > now() - interval '10 minutes';
    select coalesce(nome, 'Alguém') into autor from membros where user_id = a.comprado_por;
    for m in
      select i.criado_por, count(*) qtd, string_agg(i.nome, ', ' order by i.comprado_em) itens
        from compras_itens i join membros mb on mb.user_id = i.criado_por
       where i.id = any(a.ids) and i.criado_por <> a.comprado_por
       group by i.criado_por
    loop
      nomes := case when length(m.itens) > 120 then left(m.itens, 117) || '…' else m.itens end;
      insert into notificacoes (user_id, titulo, texto, tag, aba)
      values (m.criado_por, coalesce(autor,'Alguém') || case when m.qtd = 1 then ' comprou o que você pediu' else ' comprou ' || m.qtd || ' itens que você pediu' end,
              nomes, 'comprado', 'compras');
      n := n + 1;
    end loop;
    update compras_itens set notif_comprado = true where id = any(a.ids);
  end loop;
  update compras_itens set notif_comprado = true where not notif_comprado and comprado_em is not null and comprado_por is null;

  -- 2) Compromissos que vencem hoje (a partir das 8h), uma vez por compromisso
  if extract(hour from now() at time zone 'America/Sao_Paulo') >= 8 then
    for a in
      select l.id, l.descricao, l.valor from lancamentos l
       where l.previsto and l.compromisso_id is not null
         and (l.data_hora at time zone 'America/Sao_Paulo')::date = hoje
         and not exists (select 1 from notif_compromissos x where x.lancamento_id = l.id)
    loop
      for m in select user_id from membros where papel = 'completo' loop
        insert into notificacoes (user_id, titulo, texto, tag, aba)
        values (m.user_id, 'Vence hoje: ' || a.descricao, 'R$ ' || translate(to_char(a.valor, 'FM999,999,990.00'), ',.', '.,'), 'compromisso-' || a.id, 'lanc');
        n := n + 1;
      end loop;
      insert into notif_compromissos (lancamento_id) values (a.id);
    end loop;
  end if;
  return n;
end $$;
revoke all on function public.gerar_notificacoes() from public, anon, authenticated;
grant execute on function public.gerar_notificacoes() to service_role;
