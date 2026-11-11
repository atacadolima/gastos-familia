// Regras comuns: quem gastou, categoria e gravação do lançamento.
import { TITULAR } from './parser.js';

let cache = null;
export async function carregarCadastros(db) {
  if (cache && Date.now() - cache.em < 60_000) return cache;
  const [c, p, r] = await Promise.all([
    db.from('cartoes').select('banco, final, pessoa_id'),
    db.from('pessoas').select('id, nome'),
    db.from('regras_categoria').select('padrao, categoria_id'),
  ]);
  for (const x of [c, p, r]) if (x.error) throw x.error;
  cache = { em: Date.now(), cartoes: c.data, pessoas: p.data,
    regras: r.data.sort((a, b) => b.padrao.length - a.padrao.length) };
  return cache;
}

export function pessoaDe(cad, banco, finalCartao, portador) {
  if (finalCartao) {
    const c = cad.cartoes.find((x) => x.banco === banco && x.final === finalCartao);
    if (c) return c.pessoa_id;
  }
  if (portador) {
    const primeiro = portador.trim().split(/\s+/)[0].toUpperCase();
    const p = cad.pessoas.find((x) => x.nome.toUpperCase() === primeiro);
    if (p) return p.id;
  }
  return 'daniel'; // titular das contas
}

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export function categoriaDe(cad, descricao) {
  const d = norm(descricao);
  if (!d) return null;
  // o trecho tem que começar uma palavra ("posto" não pode casar com "imposto")
  const r = cad.regras.find((x) => {
    const p = norm(x.padrao);
    let i = d.indexOf(p);
    while (i >= 0) {
      if (i === 0 || !/[a-z0-9]/.test(d[i - 1])) return true;
      i = d.indexOf(p, i + 1);
    }
    return false;
  });
  return r ? r.categoria_id : null;
}

// Nome completo do titular: Pix de/para ele é transferência entre as contas dele.
export const TITULAR_COMPLETO = 'DANIEL RIBEIRO DE LIMA';
export function ehTitular(nome) {
  const n = (nome || '').trim().toUpperCase().replace(/\s+/g, ' ');
  return n === TITULAR || n.startsWith(TITULAR_COMPLETO);
}
