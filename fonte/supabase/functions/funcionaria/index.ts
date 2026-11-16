// Acesso da funcionária (só lista de compras + recibos). Só Daniel/Helene chamam.
//  { acao: 'criar', funcionario_id, usuario, pin }  -> cria o login usuario@casa.mutirao.app com senha = PIN
//  { acao: 'pin', funcionario_id, pin }              -> troca o PIN
//  { acao: 'encerrar', funcionario_id, saida }       -> bloqueia o login e tira da família
import { createClient } from 'jsr:@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const adm = createClient(URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type' };
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...CORS } });
const DOMINIO = '@casa.mutirao.app';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer /i, '');
  const { data: u } = await adm.auth.getUser(jwt);
  if (!u?.user) return json({ erro: 'Entre de novo no app.' }, 401);
  const { data: eu } = await adm.from('membros').select('papel').eq('user_id', u.user.id).maybeSingle();
  if (eu?.papel !== 'completo') return json({ erro: 'Só o Daniel e a Helene podem fazer isso.' }, 403);

  let c: any; try { c = await req.json(); } catch { return json({ erro: 'pedido inválido' }, 400); }
  const { data: f } = await adm.from('funcionarios').select('*').eq('id', c.funcionario_id).maybeSingle();
  if (!f) return json({ erro: 'Funcionária não encontrada.' }, 404);
  const pinOk = (p: string) => /^\d{6}$/.test(p || '');

  if (c.acao === 'criar') {
    const usuario = String(c.usuario || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]/g, '');
    if (usuario.length < 3) return json({ erro: 'O nome de usuário precisa ter pelo menos 3 letras.' }, 400);
    if (!pinOk(c.pin)) return json({ erro: 'A senha tem que ter 6 números.' }, 400);
    if (f.user_id) return json({ erro: 'Ela já tem acesso. Use "Trocar senha".' }, 400);
    const { data: novo, error } = await adm.auth.admin.createUser({ email: usuario + DOMINIO, password: c.pin, email_confirm: true,
      user_metadata: { nome: f.nome, funcionaria: true } });
    if (error) return json({ erro: /already|registered|exists/i.test(error.message) ? 'Esse usuário já existe. Escolha outro.' : error.message }, 400);
    await adm.from('membros').insert({ user_id: novo.user.id, nome: f.nome.split(' ')[0], papel: 'compras' });
    await adm.from('funcionarios').update({ user_id: novo.user.id, usuario }).eq('id', f.id);
    return json({ ok: true, usuario });
  }
  if (c.acao === 'pin') {
    if (!f.user_id) return json({ erro: 'Ela ainda não tem acesso.' }, 400);
    if (!pinOk(c.pin)) return json({ erro: 'A senha tem que ter 6 números.' }, 400);
    const { error } = await adm.auth.admin.updateUserById(f.user_id, { password: c.pin, ban_duration: 'none' });
    if (error) return json({ erro: error.message }, 400);
    return json({ ok: true });
  }
  if (c.acao === 'encerrar') {
    if (f.user_id) {
      await adm.from('membros').delete().eq('user_id', f.user_id);
      await adm.auth.admin.updateUserById(f.user_id, { ban_duration: '876000h' });
      await adm.auth.admin.signOut(f.user_id).catch(() => {});
      await adm.from('push_inscricoes').delete().eq('user_id', f.user_id);
    }
    await adm.from('funcionarios').update({ ativo: false, saida: c.saida || new Date().toISOString().slice(0, 10) }).eq('id', f.id);
    return json({ ok: true });
  }
  return json({ erro: 'ação desconhecida' }, 400);
});
