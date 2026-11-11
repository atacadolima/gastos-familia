// Recebe os avisos capturados pelo leitor no celular, grava e gera o lançamento.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { ler, GASTO, RECEITA, ENTRE_CONTAS, DETALHE } from '../_shared/parser.js';
import { carregarCadastros, pessoaDe, categoriaDe } from '../_shared/regras.js';
import { sentidoDoAviso } from '../_shared/concilia.js';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

async function sha256(s: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

const LANCA = new Set([GASTO, RECEITA, ENTRE_CONTAS, DETALHE]);
const DIA = 86400000;

/** Procura uma transação já trazida pelo banco que corresponda a este aviso e ainda não tenha aviso ligado. */
async function acharLancamentoDoBanco(r: any, recebido: string) {
  const base = new Date(r.quando || recebido).getTime();
  const { data: tb } = await db.from('transacoes_banco')
    .select('id, lancamento_id, final_cartao, data, valor, parcela, total_parcelas, bruto')
    .eq('banco', r.banco).eq('sentido', sentidoDoAviso(r.tipo)).not('lancamento_id', 'is', null)
    .gte('data', new Date(base - 4 * DIA).toISOString()).lte('data', new Date(base + 5 * DIA).toISOString());
  const cands = (tb || []).filter((t: any) => {
    const v = Number(t.valor);
    if (Math.abs(v - r.valor) < 0.005) return true;
    const tot = t.total_parcelas > 1 && (t.parcela || 1) === 1
      ? Number(t.bruto?.creditCardMetadata?.totalAmount || v * t.total_parcelas) : 0;
    return tot > 0 && Math.abs(tot - r.valor) < 0.05;
  });
  if (!cands.length) return null;
  const { data: ls } = await db.from('lancamentos')
    .select('id, data_hora, final_cartao, pessoa_id, categoria_id')
    .in('id', cands.map((t: any) => t.lancamento_id)).is('aviso_id', null);
  if (!ls?.length) return null;
  const fim = (l: any) => (r.finalCartao && l.final_cartao === r.finalCartao ? 0 : 1);
  ls.sort((a: any, b: any) => fim(a) - fim(b)
    || Math.abs(new Date(a.data_hora).getTime() - base) - Math.abs(new Date(b.data_hora).getTime() - base));
  return ls[0];
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'use POST' }, 405);
  const chave = req.headers.get('x-chave') || '';
  if (chave.length < 20) return json({ erro: 'sem chave' }, 401);
  const { data: disp } = await db.from('dispositivos').select('id, ativo')
    .eq('chave_hash', await sha256(chave)).maybeSingle();
  if (!disp || !disp.ativo) return json({ erro: 'dispositivo não autorizado' }, 401);

  let corpo: any;
  try { corpo = await req.json(); } catch { return json({ erro: 'json inválido' }, 400); }
  const lista = Array.isArray(corpo?.avisos) ? corpo.avisos.slice(0, 200) : [];
  await db.from('dispositivos').update({ ultimo_contato: new Date().toISOString() }).eq('id', disp.id);

  const cad = await carregarCadastros(db);
  const aceitos: string[] = [];
  let novos = 0;
  for (const a of lista) {
    const pacote = String(a.pacote || '').slice(0, 200);
    const titulo = String(a.titulo || '').slice(0, 500);
    const texto = String(a.texto || '').slice(0, 4000);
    const chaveAviso = String(a.chave || '').slice(0, 5000);
    const recebido = new Date(Number(a.recebido_em) || Date.now()).toISOString();
    if (!pacote || !chaveAviso) continue;

    const r = ler(pacote, titulo, texto);
    const ins = await db.from('avisos').insert({
      dispositivo_id: disp.id, pacote, titulo, texto, recebido_em: recebido, chave: chaveAviso, lido: r,
    }).select('id').maybeSingle();
    if (ins.error) {
      if (ins.error.code === '23505') { aceitos.push(chaveAviso); continue; } // já recebido
      return json({ erro: ins.error.message, aceitos }, 500);
    }
    aceitos.push(chaveAviso);
    novos++;
    if (!r.banco || !LANCA.has(r.contaComo)) continue;

    const pessoa = pessoaDe(cad, r.banco, r.finalCartao, r.portador);
    const categoria = r.contaComo === GASTO ? categoriaDe(cad, r.descricao) : null;

    // O banco pode ter chegado antes do aviso (Open Finance): então só liga os dois.
    if (r.contaComo !== DETALHE) {
      const par = await acharLancamentoDoBanco(r, recebido);
      if (par) {
        // O aviso descreve melhor (nome da loja, final do cartão): ele prevalece sobre o texto do banco.
        await db.from('lancamentos').update({
          aviso_id: ins.data!.id, conferido: true, data_hora: r.quando || par.data_hora,
          descricao: r.descricao || undefined, tipo: r.tipo || undefined,
          final_cartao: r.finalCartao || par.final_cartao || null,
          pessoa_id: r.portador || r.finalCartao ? pessoa : par.pessoa_id,
          categoria_id: par.categoria_id ?? categoria, atualizado_em: new Date().toISOString(),
        }).eq('id', par.id);
        await db.from('avisos').update({ lancamento_id: par.id }).eq('id', ins.data!.id);
        continue;
      }
    }

    // O mesmo gasto pode chegar por dois avisos (ex.: SMS + app do banco): não duplica.
    if (r.contaComo !== DETALHE) {
      const base = new Date(r.quando || recebido).getTime();
      const { data: dup } = await db.from('lancamentos').select('id')
        .eq('origem', 'aviso').eq('banco', r.banco).eq('valor', r.valor).eq('conta_como', r.contaComo)
        .gte('data_hora', new Date(base - 30 * 60000).toISOString()).lte('data_hora', new Date(base + 30 * 60000).toISOString())
        .limit(1);
      if (dup && dup.length) {
        await db.from('avisos').update({ lancamento_id: dup[0].id }).eq('id', ins.data!.id);
        continue;
      }
    }

    const lanc = await db.from('lancamentos').insert({
      origem: 'aviso', banco: r.banco, tipo: r.tipo, conta_como: r.contaComo, valor: r.valor,
      data_hora: r.quando || recebido, descricao: r.descricao || r.tipo,
      final_cartao: r.finalCartao || null,
      pessoa_id: pessoa,
      categoria_id: categoria,
      observacao: r.placa ? `Placa ${r.placa}` : null,
      aviso_id: ins.data!.id,
    }).select('id').single();
    if (!lanc.error) await db.from('avisos').update({ lancamento_id: lanc.data.id }).eq('id', ins.data!.id);
  }
  return json({ ok: true, recebidos: lista.length, novos, aceitos });
});
