// Robô diário: puxa contas e transações da Pluggy (Open Finance) e confere com os avisos.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { carregarCadastros, pessoaDe, categoriaDe } from '../_shared/regras.js';
import { converter, contaComo, tipoDe, acharPar } from '../_shared/concilia.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const PLUGGY = 'https://api.pluggy.ai';
const CORS = {
  'access-control-allow-origin': 'https://atacadolima.github.io',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...CORS } });

async function autorizado(req: Request) {
  const cron = Deno.env.get('CRON_KEY');
  if (cron && req.headers.get('x-chave-cron') === cron) return true;
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return false;
  const { data: m } = await db.from('membros').select('user_id').eq('user_id', data.user.id).maybeSingle();
  return !!m;
}

async function pluggy(path: string, apiKey: string) {
  const r = await fetch(PLUGGY + path, { headers: { 'X-API-KEY': apiKey, accept: 'application/json' } });
  if (!r.ok) throw new Error(`Pluggy ${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!(await autorizado(req))) return json({ erro: 'não autorizado' }, 401);
  const id = Deno.env.get('PLUGGY_CLIENT_ID'), secret = Deno.env.get('PLUGGY_CLIENT_SECRET');
  if (!id || !secret) return json({ erro: 'Falta o Client Secret da Pluggy nos segredos do projeto' }, 500);

  const log = await db.from('sync_log').insert({}).select('id').single();
  const resumo: Record<string, unknown> = {};
  try {
    const auth = await fetch(PLUGGY + '/auth', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: id, clientSecret: secret }),
    });
    if (!auth.ok) throw new Error(`Pluggy /auth: ${auth.status} ${(await auth.text()).slice(0, 200)}`);
    const { apiKey } = await auth.json();

    // Primeira vez: 60 dias para trás; depois, 10 dias (pega lançamentos que o banco demora a postar).
    const { count } = await db.from('transacoes_banco').select('id', { count: 'exact', head: true });
    const de = new Date(Date.now() - (count ? 10 : 60) * 86400000);
    const ate = new Date(Date.now() + 86400000);

    const { data: itens, error: eItens } = await db.from('pluggy_itens').select('id, banco');
    if (eItens) throw eItens;
    const cad = await carregarCadastros(db);
    const { data: cpl } = await db.from('categorias_pluggy').select('pluggy, categoria_id, entre_contas');
    const catPluggy = new Map((cpl || []).map((x: any) => [x.pluggy, x]));
    let novas = 0, casadas = 0, criadas = 0;

    for (const item of itens!) {
      const contas = (await pluggy(`/accounts?itemId=${item.id}`, apiKey)).results || [];
      for (const c of contas) {
        const cd = c.creditData || {};
        await db.from('contas_banco').upsert({
          id: c.id, item_id: item.id, banco: item.banco, tipo: c.type, subtipo: c.subtype, nome: c.name,
          numero: c.number, saldo: c.balance, limite_disponivel: cd.availableCreditLimit ?? null,
          fechamento: cd.balanceCloseDate ? String(cd.balanceCloseDate).slice(0, 10) : null,
          vencimento: cd.balanceDueDate ? String(cd.balanceDueDate).slice(0, 10) : null,
          atualizado_em: new Date().toISOString(),
        });

        let prox: string | null = `?accountId=${c.id}&dateFrom=${dia(de)}&dateTo=${dia(ate)}`;
        for (let volta = 0; prox && volta < 50; volta++) {
          const r = await pluggy(`/v2/transactions${prox}`, apiKey);
          prox = r.next || null;
          const linhas = (r.results || []).filter((tx: any) => tx.status !== 'PENDING').map((tx: any) => converter(tx, c, item.banco));
          if (!linhas.length) continue;
          const ids = linhas.map((l: any) => l.id);
          const { data: ja } = await db.from('transacoes_banco').select('id').in('id', ids);
          const existentes = new Set((ja || []).map((x: any) => x.id));
          const novasLinhas = linhas.filter((l: any) => !existentes.has(l.id));
          if (!novasLinhas.length) continue;
          const ins = await db.from('transacoes_banco').insert(novasLinhas);
          if (ins.error) throw ins.error;
          novas += novasLinhas.length;

          // Conferência com os avisos
          const datas = novasLinhas.map((l: any) => new Date(l.data).getTime());
          const ini = new Date(Math.min(...datas) - 6 * 86400000).toISOString();
          const fim = new Date(Math.max(...datas) + 6 * 86400000).toISOString();
          const { data: cands } = await db.from('lancamentos')
            .select('id, banco, tipo, valor, data_hora, final_cartao, transacao_banco_id')
            .eq('origem', 'aviso').is('transacao_banco_id', null).eq('banco', item.banco)
            .gte('data_hora', ini).lte('data_hora', fim);
          const pool = cands || [];

          for (const t of novasLinhas) {
            const par = acharPar(t, pool);
            if (par) {
              const upd: Record<string, unknown> = { transacao_banco_id: t.id, conferido: true, atualizado_em: new Date().toISOString() };
              if (t.total_parcelas > 1) Object.assign(upd, { valor: t.valor, parcela: t.parcela, total_parcelas: t.total_parcelas });
              await db.from('lancamentos').update(upd).eq('id', par.id);
              await db.from('transacoes_banco').update({ lancamento_id: par.id }).eq('id', t.id);
              par.transacao_banco_id = t.id;
              casadas++;
              continue;
            }
            const cp: any = catPluggy.get(t.categoria_pluggy);
            let cc = contaComo(t);
            if (cc === 'Gasto' && cp?.entre_contas) cc = 'Entre contas';
            const novo = await db.from('lancamentos').insert({
              origem: 'banco', banco: t.banco, tipo: tipoDe(t), conta_como: cc, valor: t.valor, data_hora: t.data,
              descricao: t.contraparte || t.descricao, final_cartao: t.final_cartao,
              pessoa_id: pessoaDe(cad, t.banco, t.final_cartao, null),
              categoria_id: cc === 'Gasto' ? (categoriaDe(cad, `${t.descricao} ${t.contraparte || ''}`) ?? cp?.categoria_id ?? null) : null,
              parcela: t.parcela, total_parcelas: t.total_parcelas,
              transacao_banco_id: t.id, conferido: true,
            }).select('id').single();
            if (novo.error) throw novo.error;
            await db.from('transacoes_banco').update({ lancamento_id: novo.data.id }).eq('id', t.id);
            criadas++;
          }
        }
      }
      resumo[item.banco] = 'ok';
    }
    // Pagamento de fatura feito pela conta corrente: as compras já contam no cartão, então não é gasto.
    const pf = await db.rpc('marcar_pagamentos_fatura');
    if (pf.error) throw pf.error;
    Object.assign(resumo, { faturas_pagas: pf.data, novas, casadas_com_aviso: casadas, so_no_banco: criadas });
    await db.from('sync_log').update({ fim: new Date().toISOString(), ok: true, detalhe: JSON.stringify(resumo) }).eq('id', log.data!.id);
    return json({ ok: true, ...resumo });
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    await db.from('sync_log').update({ fim: new Date().toISOString(), ok: false, detalhe: msg + ' | ' + JSON.stringify(resumo) }).eq('id', log.data!.id);
    return json({ ok: false, erro: msg, ...resumo }, 500);
  }
});
