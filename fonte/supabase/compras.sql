-- Lista de compras + acesso simples (só compras)
alter table membros add column if not exists papel text not null default 'completo' check (papel in ('completo','compras'));

-- Gastos: só quem tem acesso completo
create or replace function public.eh_membro() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from membros where user_id = auth.uid() and papel = 'completo') $$;

-- Compras: qualquer membro (completo ou só compras)
create or replace function public.eh_membro_compras() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from membros where user_id = auth.uid()) $$;
grant execute on function public.eh_membro_compras() to authenticated;

-- Cada um vê o próprio cadastro (para saber o papel) e os nomes dos outros membros
drop policy if exists membros_ler on membros;
create policy membros_ler on membros for select to authenticated using (eh_membro_compras());

create table if not exists compras_itens (
  id bigserial primary key,
  nome text not null check (length(trim(nome)) between 1 and 120),
  quantidade text,
  observacao text,
  grupo text not null default 'Mercado',
  criado_por uuid not null default auth.uid() references auth.users on delete set null,
  criado_em timestamptz not null default now(),
  comprado_em timestamptz,
  comprado_por uuid references auth.users on delete set null
);
create index if not exists compras_pendentes on compras_itens (comprado_em) ;

alter table compras_itens enable row level security;
drop policy if exists ver on compras_itens;
drop policy if exists incluir on compras_itens;
drop policy if exists editar on compras_itens;
drop policy if exists apagar on compras_itens;
create policy ver on compras_itens for select to authenticated using (eh_membro_compras());
create policy incluir on compras_itens for insert to authenticated with check (eh_membro_compras() and criado_por = auth.uid());
-- Editar/apagar: acesso completo edita tudo; acesso simples só o que ele mesmo adicionou
create policy editar on compras_itens for update to authenticated
  using (eh_membro() or criado_por = auth.uid()) with check (eh_membro() or criado_por = auth.uid());
create policy apagar on compras_itens for delete to authenticated using (eh_membro() or criado_por = auth.uid());
grant select, insert, update, delete on compras_itens to authenticated;
grant usage, select on sequence compras_itens_id_seq to authenticated;
grant all on compras_itens to service_role;

-- Marcar/desmarcar como comprado: liberado para todos os membros
create or replace function public.marcar_comprado(item bigint, comprado boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not eh_membro_compras() then raise exception 'sem acesso'; end if;
  update compras_itens
     set comprado_em = case when comprado then now() else null end,
         comprado_por = case when comprado then auth.uid() else null end
   where id = item;
end $$;
revoke all on function public.marcar_comprado(bigint, boolean) from public, anon;
grant execute on function public.marcar_comprado(bigint, boolean) to authenticated;

-- Atualização ao vivo nas telas abertas
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'compras_itens') then
    alter publication supabase_realtime add table compras_itens;
  end if;
end $$;

-- Ajuste: só quem tem acesso completo (Daniel e Helene) marca como comprado
create or replace function public.marcar_comprado(item bigint, comprado boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not eh_membro() then raise exception 'Só o Daniel e a Helene marcam como comprado'; end if;
  update compras_itens
     set comprado_em = case when comprado then now() else null end,
         comprado_por = case when comprado then auth.uid() else null end
   where id = item;
end $$;
