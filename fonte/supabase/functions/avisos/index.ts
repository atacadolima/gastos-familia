// Avisos no celular.
//  - cron (x-chave-cron), a cada minuto: gera os avisos pendentes e manda Web Push (iPhone/PWA)
//  - celular Android (x-chave): busca os avisos ainda não entregues a ele
//  - app logado (Authorization): devolve a chave pública VAPID
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const PUB = Deno.env.get('VAPID_PUBLIC')!, PRIV = Deno.env.get('VAPID_PRIVATE')!;
webpush.setVapidDetails('mailto:avisos@mutirao.app.br', PUB, PRIV);

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-chave' };
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...CORS } });

async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function rodarCron() {
  const { data: n, error } = await db.rpc('gerar_notificacoes');
  if (error) return { erro: error.message };
  const { data: pend } = await db.from('notificacoes').select('*').eq('push_enviado', false)
    .gt('criado_em', new Date(Date.now() - 6 * 3600e3).toISOString()).order('id').limit(50);
  let enviados = 0;
  for (const nt of pend || []) {
    const { data: subs } = await db.from('push_inscricoes').select('*').eq('user_id', nt.user_id);
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ titulo: nt.titulo, texto: nt.texto, tag: nt.tag, aba: nt.aba }), { TTL: 6 * 3600 });
        enviados++;
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await db.from('push_inscricoes').delete().eq('endpoint', s.endpoint);
        else console.error('push', e?.statusCode, e?.body);
      }
    }
    await db.from('notificacoes').update({ push_enviado: true }).eq('id', nt.id);
  }
  return { gerados: n, enviados };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const cron = Deno.env.get('CRON_KEY');
  if (cron && req.headers.get('x-chave-cron') === cron) return json(await rodarCron());

  const chave = req.headers.get('x-chave') || '';
  if (chave.length >= 20) {
    const { data: d } = await db.from('dispositivos').select('id, ativo, user_id')
      .eq('chave_hash', await sha256(chave)).maybeSingle();
    if (!d || !d.ativo || !d.user_id) return json({ avisos: [] });
    const { data: lista } = await db.from('notificacoes').select('id, titulo, texto, tag, aba')
      .eq('user_id', d.user_id).eq('entregue_android', false)
      .gt('criado_em', new Date(Date.now() - 24 * 3600e3).toISOString()).order('id').limit(20);
    if (lista?.length) await db.from('notificacoes').update({ entregue_android: true }).in('id', lista.map((x) => x.id));
    return json({ avisos: lista || [] });
  }
  return json({ vapid: PUB });
});
