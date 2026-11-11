create or replace function public.marcar_pagamentos_fatura() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update lancamentos l set conta_como = 'Entre contas', tipo = 'Pagamento de fatura',
         categoria_id = null, atualizado_em = now()
  from transacoes_banco t
  where l.transacao_banco_id = t.id and l.origem = 'banco' and l.conta_como = 'Gasto'
    and t.conta_tipo = 'BANK' and t.sentido = 'saida'
    and exists (select 1 from transacoes_banco c
                where c.conta_tipo = 'CREDIT' and c.sentido = 'entrada'
                  and abs(c.valor - t.valor) < 0.01
                  and c.data between t.data - interval '5 days' and t.data + interval '5 days');
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.marcar_pagamentos_fatura() from public, anon, authenticated;
grant execute on function public.marcar_pagamentos_fatura() to service_role;
