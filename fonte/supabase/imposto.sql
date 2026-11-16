-- Imposto de Renda: gastos dedutíveis (saúde, educação, previdência) e comprovantes anexados
alter table lancamentos add column if not exists ded_tipo text check (ded_tipo in ('saude','educacao','previdencia'));
alter table lancamentos add column if not exists ded_pessoa text references pessoas;
alter table lancamentos add column if not exists ded_prestador text;
alter table lancamentos add column if not exists ded_doc text;           -- CPF/CNPJ de quem recebeu

create table if not exists comprovantes (
  id serial primary key,
  lancamento_id bigint not null references lancamentos on delete cascade,
  caminho text not null unique,     -- no bucket privado "comprovantes"
  nome text,
  tipo text,
  criado_em timestamptz not null default now()
);
alter table comprovantes enable row level security;
drop policy if exists membros_tudo on comprovantes;
create policy membros_tudo on comprovantes for all to authenticated using (eh_membro()) with check (eh_membro());
grant select, insert, update, delete on comprovantes to authenticated;
grant all on comprovantes to service_role;
grant usage, select on sequence comprovantes_id_seq to authenticated, service_role;

drop policy if exists comprovantes_ler on storage.objects;
create policy comprovantes_ler on storage.objects for select to authenticated using (bucket_id = 'comprovantes' and eh_membro());
drop policy if exists comprovantes_gravar on storage.objects;
create policy comprovantes_gravar on storage.objects for insert to authenticated with check (bucket_id = 'comprovantes' and eh_membro());
drop policy if exists comprovantes_apagar on storage.objects;
create policy comprovantes_apagar on storage.objects for delete to authenticated using (bucket_id = 'comprovantes' and eh_membro());

-- Parcela/assinatura nova herda a marcação de dedutível da série (ex.: plano de saúde todo mês)
create or replace function public.herdar_dedutivel() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with s as (
    select distinct on (serie) serie, ded_tipo, ded_pessoa, ded_prestador, ded_doc from lancamentos
     where serie is not null and ded_tipo is not null order by serie, atualizado_em desc)
  update lancamentos l set ded_tipo = s.ded_tipo, ded_pessoa = s.ded_pessoa,
         ded_prestador = coalesce(l.ded_prestador, s.ded_prestador), ded_doc = coalesce(l.ded_doc, s.ded_doc)
    from s where l.serie = s.serie and l.ded_tipo is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.herdar_dedutivel() from public, anon;
grant execute on function public.herdar_dedutivel() to authenticated, service_role;
