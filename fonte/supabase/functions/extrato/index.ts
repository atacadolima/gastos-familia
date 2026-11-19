// Extrato das contas, direto do banco (Open Finance via Pluggy): movimentos do período com saldo inicial, saldo após cada um e saldo final.
// Não grava nada. Só membros da família (ou o robô, com a chave do cron).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const PLUGGY = 'https://api.pluggy.ai';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...CORS } });

async function autorizado(req: Request) {
  const cron = Deno.env.get('CRON_KEY');
  if (cron && req.headers.get('x-chave-cron') === cron) return true;
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return false;
  const { data } = await db.auth.getUser(jwt);
  if (!data?.user) return false;
  const { data: m } = await db.from('membros').select('papel').eq('user_id', data.user.id).maybeSingle();
  return m?.papel === 'completo';
}
async function pluggy(path: string, apiKey: string) {
  const r = await fetch(PLUGGY + path, { headers: { 'X-API-KEY': apiKey, accept: 'application/json' } });
  if (!r.ok) throw new Error(`banco respondeu ${r.status}`);
  return r.json();
}
const dia = (d: Date) => d.toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (!(await autorizado(req))) return json({ erro: 'sem acesso' }, 401);
  let p: any = {};
  try { p = await req.json(); } catch { /* vazio */ }
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(p.desde || '') ? p.desde : dia(new Date(Date.now() - 90 * 86400000));
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(p.ate || '') ? p.ate : dia(new Date());
  const tipos: string[] = Array.isArray(p.tipos) && p.tipos.length ? p.tipos : ['BANK'];
  const soContas: string[] | null = Array.isArray(p.contas) && p.contas.length ? p.contas : null;

  const auth = await fetch(PLUGGY + '/auth', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId: Deno.env.get('PLUGGY_CLIENT_ID'), clientSecret: Deno.env.get('PLUGGY_CLIENT_SECRET') }) });
  if (!auth.ok) return json({ erro: 'não consegui falar com o banco agora' }, 502);
  const { apiKey } = await auth.json();
  const { data: itens } = await db.from('pluggy_itens').select('id, banco');
  const { data: ign } = await db.from('contas_banco').select('id').eq('ignorar', true);
  const ignoradas = new Set((ign || []).map((x: any) => x.id));
  const hoje = dia(new Date(Date.now() + 86400000));
  const contas: any[] = [];
  for (const item of itens || []) {
    let lista: any[] = [];
    try { lista = (await pluggy(`/accounts?itemId=${item.id}`, apiKey)).results || []; }
    catch (e) { contas.push({ banco: item.banco, erro: String((e as Error).message) }); continue; }
    for (const c of lista) {
      if (ignoradas.has(c.id) || !tipos.includes(c.type) || (soContas && !soContas.includes(c.id))) continue;
      const movs: any[] = [];
      try {
        let prox: string | null = `?accountId=${c.id}&dateFrom=${desde}&dateTo=${hoje}`;
        for (let v = 0; prox && v < 60; v++) {
          const r = await pluggy(`/v2/transactions${prox}`, apiKey);
          prox = r.next || null;
          for (const tx of r.results || []) {
            if (tx.status === 'PENDING') continue;
            const pd = tx.paymentData || {};
            const saida = tx.type === 'DEBIT';
            const outro = (saida ? pd.receiver : pd.payer) || {};
            const nome = outro.name || (tx.merchant && (tx.merchant.businessName || tx.merchant.name)) || '';
            const desc = [tx.description || tx.descriptionRaw || '', nome && !(tx.description || '').includes(nome) ? nome : ''].filter(Boolean).join(' · ');
            movs.push({ data: String(tx.date).slice(0, 10), hora: String(tx.date).slice(11, 16), descricao: desc, valor: r2((saida ? -1 : 1) * Math.abs(Number(tx.amount))) });
          }
        }
      } catch (e) { contas.push({ banco: item.banco, numero: c.number, erro: String((e as Error).message) }); continue; }
      movs.sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
      const saldoAtual = Number(c.balance || 0);
      const depois = movs.filter((m) => m.data > ate).reduce((s, m) => s + m.valor, 0);
      const doPeriodo = movs.filter((m) => m.data <= ate);
      const saldoFinal = r2(saldoAtual - depois);
      let saldo = r2(saldoFinal - doPeriodo.reduce((s, m) => s + m.valor, 0));
      const saldoInicial = saldo;
      for (const m of doPeriodo) { saldo = r2(saldo + m.valor); m.saldo = saldo; }
      const bd = c.bankData || {};
      contas.push({ id: c.id, banco: item.banco, tipo: c.type, nome: c.name, numero: c.number, agencia_conta: bd.transferNumber || null,
        saldo_atual: r2(saldoAtual), saldo_inicial: saldoInicial, saldo_final: saldoFinal,
        primeiro_movimento: doPeriodo[0]?.data || null, movimentos: doPeriodo });
    }
  }
  return json({ desde, ate, gerado_em: new Date().toISOString(), contas });
});
