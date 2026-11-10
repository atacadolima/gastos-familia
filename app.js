'use strict';
// Gastos da Família — app do Daniel e da Helene.
// Os dados ficam no Supabase, protegidos por login: só quem está na tabela "membros" enxerga.

const SB_URL = 'https://cjltedcpwmaqluvhybih.supabase.co';
const SB_KEY = 'sb_publishable_q6Ae6qRfaqPvCX-W5yMQyQ_LtkI77w9';
const TZ = 'America/Sao_Paulo';

// Tipo do link de e-mail (convite ou troca de senha) — lido antes do supabase limpar o endereço
const TIPO_LINK = new URLSearchParams(location.hash.slice(1)).get('type');

const sb = window.supabase.createClient(SB_URL, SB_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
});

const st = {
  aba: 'inicio',
  mes: inicioDoMes(new Date()),
  pessoa: 'todos',
  soPendentes: false,
  verTransf: false,
  cad: null,          // pessoas, categorias, cartoes
  lancs: [],          // lançamentos do mês
  carregando: false,
};

// ---------- utilidades ----------
function h(tag, attrs, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') throw new Error('sem html');
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) el.append(f.nodeType ? f : String(f));
  return el;
}
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const R = (v) => moeda.format(Number(v) || 0);
const num = (v) => Math.round((Number(v) || 0) * 100) / 100;
function inicioDoMes(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMes(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
const nomeMes = (d) => d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());
const dataCurta = (s) => new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ });
const hora = (s) => new Date(s).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const diaChave = (s) => new Date(s).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ });
function haQuanto(s) {
  if (!s) return 'nunca';
  const min = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `há ${hr} h`;
  return `há ${Math.round(hr / 24)} dias`;
}
function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
const nomeCat = (id) => (st.cad.categorias.find((c) => c.id === id) || {}).nome || 'A categorizar';
const nomePessoa = (id) => (st.cad.pessoas.find((p) => p.id === id) || {}).nome || '—';
const catId = (nome) => (st.cad.categorias.find((c) => c.nome === nome) || {}).id;
const partesDe = (l) => (Array.isArray(l.partes) ? l.partes : []);
const abastDe = (l) => (Array.isArray(l.abastecimentos) ? l.abastecimentos[0] : l.abastecimentos) || null;
function erroMsg(e) { return (e && (e.message || e.error_description)) || String(e); }

// ---------- dados ----------
async function carregarCadastros() {
  const [p, c, k] = await Promise.all([
    sb.from('pessoas').select('*').order('ordem'),
    sb.from('categorias').select('*').eq('ativa', true).order('ordem'),
    sb.from('cartoes').select('*'),
  ]);
  for (const x of [p, c, k]) if (x.error) throw x.error;
  st.cad = { pessoas: p.data, categorias: c.data, cartoes: k.data };
}

async function carregarMes() {
  st.carregando = true;
  const de = st.mes.toISOString(), ate = addMes(st.mes, 1).toISOString();
  const { data, error } = await sb.from('lancamentos')
    .select('*, partes(*), abastecimentos(*)')
    .gte('data_hora', de).lt('data_hora', ate)
    .order('data_hora', { ascending: false });
  st.carregando = false;
  if (error) throw error;
  st.lancs = data;
}

/** Cada gasto vira uma ou mais "porções" (quando dividido em categorias). */
function porcoes(lancs) {
  const out = [];
  for (const l of lancs) {
    if (l.conta_como !== 'Gasto') continue;
    const ps = partesDe(l);
    if (ps.length) for (const p of ps) out.push({ l, valor: Number(p.valor), cat: p.categoria_id, pessoa: p.pessoa_id || l.pessoa_id });
    else out.push({ l, valor: Number(l.valor), cat: l.categoria_id, pessoa: l.pessoa_id });
  }
  return out;
}
/** Divisão só entre pessoas (mesma categoria em todas as partes) — feita pelos quadradinhos de "Quem". */
function divisaoPorPessoa(l) {
  const ps = partesDe(l);
  return ps.length > 1 && ps.every((p) => p.categoria_id === ps[0].categoria_id) && new Set(ps.map((p) => p.pessoa_id)).size === ps.length;
}
const divisaoPorCategoria = (l) => partesDe(l).length > 0 && !divisaoPorPessoa(l);
/** Divide em centavos iguais; a sobra vai para os primeiros. */
function dividirIgual(total, n) {
  const c = Math.round(total * 100), base = Math.floor(c / n), sobra = c - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < sobra ? 1 : 0)) / 100);
}
const pendente = (l) => l.conta_como === 'Gasto' && !l.categoria_id && !partesDe(l).length;

// ---------- telas ----------
function render() {
  const app = document.getElementById('app');
  app.replaceChildren();
  const tela = { inicio: telaInicio, lanc: telaLancamentos, carro: telaCarro, conf: telaConferencia }[st.aba];
  const wrap = h('div', { class: 'app' });
  app.append(wrap);
  Promise.resolve(tela(wrap)).catch((e) => wrap.append(h('div', { class: 'corpo' }, h('div', { class: 'card erro' }, 'Erro: ' + erroMsg(e)))));
  app.append(navegacao());
}

const ICONES = {
  inicio: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  lanc: 'M4 6h16M4 12h16M4 18h10',
  carro: 'M5 16l1.5-5A2 2 0 0 1 8.4 9.5h7.2a2 2 0 0 1 1.9 1.5L19 16M4 16h16v3h-2M4 16v3h2M7.5 16.5h.01M16.5 16.5h.01',
  conf: 'M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
};
function navegacao() {
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Telas' });
  for (const [id, rot] of [['inicio', 'Início'], ['lanc', 'Lançamentos'], ['carro', 'Carro'], ['conf', 'Conferência']]) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONES[id]); svg.append(p);
    nav.append(h('button', { class: st.aba === id ? 'on' : '', 'aria-current': st.aba === id ? 'page' : null,
      onclick: () => { st.aba = id; render(); window.scrollTo(0, 0); } }, svg, rot));
  }
  return nav;
}

function seletorMes(aoMudar) {
  return h('div', { class: 'mes' },
    h('button', { 'aria-label': 'Mês anterior', onclick: async () => { st.mes = addMes(st.mes, -1); await carregarMes(); aoMudar(); } }, '‹'),
    h('span', {}, nomeMes(st.mes)),
    h('button', { 'aria-label': 'Próximo mês', onclick: async () => { st.mes = addMes(st.mes, 1); await carregarMes(); aoMudar(); } }, '›'));
}

// ----- Início -----
async function telaInicio(wrap) {
  const ps = porcoes(st.lancs);
  const total = num(ps.reduce((s, p) => s + p.valor, 0));
  const receitas = num(st.lancs.filter((l) => l.conta_como === 'Receita').reduce((s, l) => s + Number(l.valor), 0));

  wrap.append(h('div', { class: 'hero' },
    h('div', { class: 'linha1' }, seletorMes(render), h('span', { class: 'rotulo' }, 'Família')),
    h('span', { class: 'rotulo' }, 'Gasto no mês'),
    h('span', { class: 'grande' }, R(total)),
    h('span', { class: 'rotulo' }, `Entradas no mês: ${R(receitas)}`)));
  const corpo = h('div', { class: 'corpo' });
  wrap.append(corpo);

  // Quem gastou
  const porPessoa = {};
  for (const p of ps) porPessoa[p.pessoa || 'daniel'] = (porPessoa[p.pessoa || 'daniel'] || 0) + p.valor;
  const cardP = h('div', { class: 'card' }, h('h2', {}, 'Quem gastou'));
  for (const pe of st.cad.pessoas) {
    const v = num(porPessoa[pe.id] || 0);
    if (pe.id === 'outros' && !v) continue;
    const pct = total ? Math.round((v / total) * 100) : 0;
    cardP.append(h('div', {},
      h('div', { class: 'lin' }, h('span', {}, pe.nome), h('span', { class: 'v' }, R(v))),
      h('div', { class: 'barra', role: 'img', 'aria-label': `${pct}% do total` },
        h('div', { style: `width:${pct}%;background:${pe.id === 'helene' ? 'var(--helene)' : pe.id === 'gabriel' ? '#4A6072' : pe.id === 'outros' ? '#8A8F8B' : 'var(--verde)'}` }))));
  }
  corpo.append(cardP);

  // Por categoria
  const porCat = {};
  for (const p of ps) porCat[p.cat || 0] = (porCat[p.cat || 0] || 0) + p.valor;
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const cardC = h('div', { class: 'card' }, h('h2', {}, 'Por categoria'));
  if (!cats.length) cardC.append(h('div', { class: 'vazio' }, 'Nenhum gasto neste mês.'));
  const nPend = st.lancs.filter(pendente).length;
  for (const [id, v] of cats) {
    const pend = id === '0';
    cardC.append(h('button', { class: 'lin', style: 'border:none;background:none;padding:2px 0;text-align:left;min-height:32px',
      onclick: () => { st.aba = 'lanc'; st.soPendentes = pend; render(); } },
      h('span', { class: pend ? 'alerta' : '' }, pend ? `A categorizar (${nPend})` : nomeCat(Number(id))),
      h('span', { class: 'v' + (pend ? ' alerta' : '') }, R(v))));
  }
  corpo.append(cardC);

  // Cartões e contas
  const { data: contas } = await sb.from('contas_banco').select('*').order('banco');
  const cardF = h('div', { class: 'card' }, h('h2', {}, 'Cartões e contas'));
  if (!contas || !contas.length) cardF.append(h('div', { class: 'nota' }, 'Aguardando a primeira leitura dos bancos.'));
  for (const c of contas || []) {
    const fim = (c.numero || '').replace(/\D/g, '').slice(-4);
    if (c.tipo === 'CREDIT') {
      cardF.append(h('div', { class: 'lin' },
        h('span', {}, `Cartão ${c.banco} ${fim}`,
          h('br'), h('span', { class: 'nota' }, `Limite livre ${R(c.limite_disponivel)}${c.vencimento ? ' · venc. ' + dataCurta(c.vencimento + 'T12:00:00') : ''}`)),
        h('span', { class: 'v' }, R(c.saldo))));
    } else {
      cardF.append(h('div', { class: 'lin' }, h('span', {}, `Conta ${c.banco}`),
        h('span', { class: 'v', style: Number(c.saldo) < 0 ? 'color:var(--erro)' : '' }, R(c.saldo))));
    }
  }
  cardF.append(h('div', { class: 'nota' }, 'Cartão: valor em aberto informado pelo banco. Atualiza 2x por dia.'));
  corpo.append(cardF);
}

// ----- Lançamentos -----
function telaLancamentos(wrap) {
  const cab = h('div', { class: 'cab' }, h('h1', {}, 'Lançamentos'), seletorMes(render));
  const nPend = st.lancs.filter(pendente).length;
  const chips = h('div', { class: 'chips' });
  for (const [id, rot] of [['todos', 'Todos'], ...st.cad.pessoas.map((p) => [p.id, p.nome])]) {
    chips.append(h('button', { class: 'chip' + (st.pessoa === id ? ' on' : ''), 'aria-pressed': String(st.pessoa === id),
      onclick: () => { st.pessoa = id; render(); } }, rot));
  }
  chips.append(h('button', { class: 'chip amb' + (st.soPendentes ? ' on' : ''), 'aria-pressed': String(st.soPendentes),
    onclick: () => { st.soPendentes = !st.soPendentes; render(); } }, `A categorizar · ${nPend}`));
  chips.append(h('button', { class: 'chip' + (st.verTransf ? ' on' : ''), 'aria-pressed': String(st.verTransf),
    onclick: () => { st.verTransf = !st.verTransf; render(); } }, 'Transferências'));
  cab.append(chips);
  wrap.append(cab);

  const corpo = h('div', { class: 'corpo', style: 'gap:8px' });
  wrap.append(corpo);
  let lista = st.lancs.filter((l) => (st.verTransf ? true : l.conta_como === 'Gasto' || l.conta_como === 'Receita'));
  if (st.pessoa !== 'todos') lista = lista.filter((l) => l.pessoa_id === st.pessoa || partesDe(l).some((p) => p.pessoa_id === st.pessoa));
  if (st.soPendentes) lista = lista.filter(pendente);
  if (!lista.length) { corpo.append(h('div', { class: 'vazio' }, st.soPendentes ? 'Nada para categorizar. 👍' : 'Nenhum lançamento.')); return; }

  let diaAtual = '';
  for (const l of lista) {
    const d = diaChave(l.data_hora);
    if (d !== diaAtual) { diaAtual = d; corpo.append(h('div', { class: 'dia' }, d)); }
    corpo.append(itemLanc(l));
  }
}

function itemLanc(l) {
  const ps = partesDe(l);
  const porPes = divisaoPorPessoa(l);
  const cat = ps.length && !porPes ? `Dividido em ${ps.length}` : l.conta_como === 'Gasto' ? nomeCat(l.categoria_id) : l.conta_como;
  const quem = porPes ? ps.map((p) => nomePessoa(p.pessoa_id)).join(', ') : nomePessoa(l.pessoa_id);
  const fim = l.final_cartao ? ` ${l.final_cartao}` : '';
  const ab = abastDe(l);
  const classeV = l.conta_como === 'Receita' ? 'v rec' : l.conta_como === 'Gasto' ? 'v' : 'v neu';
  const tags = [];
  if (l.conferido) tags.push(h('span', { class: 'tag ok' }, l.aviso_id ? 'aviso + banco' : 'banco'));
  else if (l.origem === 'aviso') tags.push(h('span', { class: 'tag amb' }, 'só aviso'));
  if (l.total_parcelas > 1) tags.push(h('span', { class: 'tag' }, `parcela ${l.parcela}/${l.total_parcelas}`));
  return h('button', { class: 'item' + (pendente(l) ? ' pend' : ''), onclick: () => abrirLanc(l) },
    h('div', { class: 't' }, h('span', { class: 'n' }, l.descricao || l.tipo), h('span', { class: classeV }, (l.conta_como === 'Receita' ? '+ ' : '') + R(l.valor))),
    h('div', { class: 'd' }, `${hora(l.data_hora)} · ${cat} · ${l.banco || ''}${fim} · ${quem}${ab && ab.km ? ` · ${ab.km.toLocaleString('pt-BR')} km` : ''}`),
    tags.length ? h('div', {}, tags) : null,
    l.observacao ? h('div', { class: 'd' }, `“${l.observacao}”`) : null);
}

// ----- Folha de edição -----
function abrirSheet(...conteudo) {
  const s = document.getElementById('sheet'), f = document.getElementById('sheet-fundo');
  s.replaceChildren(h('button', { class: 'fechar', 'aria-label': 'Fechar', onclick: fecharSheet }, '✕'), ...conteudo.flat().filter((x) => x != null && x !== false));
  s.hidden = false; f.hidden = false; f.onclick = fecharSheet;
  const foco = s.querySelector('select, input, textarea'); if (foco) foco.focus({ preventScroll: true });
}
function fecharSheet() { document.getElementById('sheet').hidden = true; document.getElementById('sheet-fundo').hidden = true; }

function opcoes(lista, atual, vazio) {
  const out = [];
  if (vazio) out.push(h('option', { value: '' }, vazio));
  for (const [v, t] of lista) out.push(h('option', { value: String(v), selected: String(v) === String(atual ?? '') }, t));
  return out;
}
function padraoSugerido(desc) {
  return (desc || '').toLowerCase().replace(/[0-9*#/\\-]+/g, ' ').replace(/\b(sao paulo|bra|br|ltda|s\/a|sa|me|eireli)\b/g, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
}

function abrirLanc(l) {
  const catSel = h('select', {}, opcoes(st.cad.categorias.map((c) => [c.id, c.nome]), l.categoria_id, 'A categorizar'));
  const porCat = divisaoPorCategoria(l);
  const marcados = new Set(divisaoPorPessoa(l) ? partesDe(l).map((p) => p.pessoa_id) : [l.pessoa_id || 'daniel']);
  const parteOutro = partesDe(l).find((p) => p.pessoa_id === 'outros');
  const outroNome = h('input', { value: (parteOutro && parteOutro.observacao) || '', placeholder: 'Quem? ex.: sogra (opcional)', 'aria-label': 'Nome de quem mais estava' });
  const cadaUm = h('div', { class: 'nota' });
  const caixas = st.cad.pessoas.map((p) => {
    const cb = h('input', { type: 'checkbox', checked: marcados.has(p.id), value: p.id });
    cb.onchange = () => atualizaQuem();
    return cb;
  });
  const blocoQuem = h('div', { class: 'card', style: 'gap:2px' }, h('h2', {}, 'Quem gastou (pode marcar mais de um)'),
    h('div', { class: 'grade2', style: 'gap:0 10px' }, caixas.map((cb, i) => h('label', { class: 'check' }, cb, st.cad.pessoas[i].id === 'outros' ? 'Outro' : st.cad.pessoas[i].nome))),
    h('div', { class: 'campo' }, outroNome), cadaUm);
  const selecionados = () => caixas.filter((c) => c.checked).map((c) => c.value);
  const atualizaQuem = () => {
    const sel = selecionados();
    outroNome.parentElement.hidden = !sel.includes('outros');
    cadaUm.textContent = sel.length > 1 ? `Dividido igual: ${R(dividirIgual(Number(l.valor), sel.length)[sel.length - 1])} para cada um.` : '';
  };
  const comoSel = h('select', {}, opcoes([['Gasto', 'Gasto'], ['Receita', 'Receita (entrada)'], ['Entre contas', 'Transferência entre contas / não conta'], ['Detalhe', 'Detalhe (não soma)']], l.conta_como));
  const obs = h('textarea', { placeholder: 'ex.: lavagem do carro' }, l.observacao || '');
  const nome = h('input', { value: l.descricao || '', placeholder: 'ex.: Padaria do Zé' });
  const generico = /^(DEBITO DE CARTAO|itau|Saída na conta)$/i.test((l.descricao || '').trim());
  const sempre = h('input', { type: 'checkbox', checked: !l.categoria_id });
  const padrao = h('input', { value: padraoSugerido(l.descricao), 'aria-label': 'Trecho do nome' });
  const blocoRegra = h('div', { class: 'card', style: 'gap:6px' },
    h('label', { class: 'check' }, sempre, 'Usar esta categoria sempre que o nome tiver:'), h('div', { class: 'campo' }, padrao),
    h('div', { class: 'nota' }, 'Vale também para os lançamentos ainda sem categoria com esse nome.'));
  const ab = abastDe(l) || {};
  const km = h('input', { type: 'number', inputmode: 'numeric', value: ab.km ?? '', placeholder: 'ex.: 23599' });
  const litros = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: ab.litros ?? '', placeholder: 'ex.: 35,2' });
  const cheio = h('input', { type: 'checkbox', checked: ab.tanque_cheio ?? true });
  const blocoComb = h('div', { class: 'card' }, h('h2', {}, 'Abastecimento'),
    h('div', { class: 'grade2' }, h('label', { class: 'campo' }, 'Km no painel', km), h('label', { class: 'campo' }, 'Litros', litros)),
    h('label', { class: 'check' }, cheio, 'Enchi o tanque'));
  const mostrar = () => {
    const ehGasto = comoSel.value === 'Gasto';
    catSel.parentElement.hidden = !ehGasto;
    blocoRegra.hidden = !ehGasto || !catSel.value || !l.descricao;
    blocoComb.hidden = !ehGasto || Number(catSel.value) !== catId('Combustível');
  };
  catSel.onchange = mostrar; comoSel.onchange = mostrar;
  const ps = partesDe(l);

  const salvar = h('button', { class: 'btn', onclick: async () => {
    salvar.disabled = true;
    try {
      const sel = selecionados();
      if (!porCat && !sel.length) { salvar.disabled = false; toast('Marque pelo menos uma pessoa.'); return; }
      const upd = { descricao: nome.value.trim() || l.descricao, conta_como: comoSel.value, pessoa_id: porCat ? l.pessoa_id : sel[0], observacao: obs.value.trim() || null,
        categoria_id: comoSel.value === 'Gasto' && catSel.value ? Number(catSel.value) : null, atualizado_em: new Date().toISOString() };
      const r = await sb.from('lancamentos').update(upd).eq('id', l.id);
      if (r.error) throw r.error;
      if (!porCat) {
        // "Quem": uma pessoa = sem partes; várias = partes iguais
        const d = await sb.from('partes').delete().eq('lancamento_id', l.id);
        if (d.error) throw d.error;
        if (sel.length > 1 && upd.conta_como === 'Gasto') {
          const vals = dividirIgual(Number(l.valor), sel.length);
          const ins = await sb.from('partes').insert(sel.map((pid, i) => ({ lancamento_id: l.id, categoria_id: upd.categoria_id, pessoa_id: pid,
            valor: vals[i], observacao: pid === 'outros' ? (outroNome.value.trim() || null) : null })));
          if (ins.error) throw ins.error;
        }
      }
      let extras = 0;
      if (!blocoRegra.hidden && sempre.checked && padrao.value.trim().length >= 3) {
        const p = padrao.value.trim().toLowerCase();
        await sb.from('regras_categoria').upsert({ padrao: p, categoria_id: upd.categoria_id }, { onConflict: 'padrao' });
        const esc = p.replace(/[%_\\]/g, (c) => '\\' + c);
        const r2 = await sb.from('lancamentos').update({ categoria_id: upd.categoria_id, atualizado_em: upd.atualizado_em })
          .is('categoria_id', null).eq('conta_como', 'Gasto').ilike('descricao', `%${esc}%`).select('id');
        extras = (r2.data || []).filter((x) => x.id !== l.id).length;
      }
      if (!blocoComb.hidden && (km.value || litros.value)) {
        const r3 = await sb.from('abastecimentos').upsert({ lancamento_id: l.id, km: km.value ? Math.round(Number(km.value)) : null,
          litros: litros.value ? Number(String(litros.value).replace(',', '.')) : null, tanque_cheio: cheio.checked });
        if (r3.error) throw r3.error;
      }
      fecharSheet();
      await carregarMes(); render();
      toast(extras ? `Salvo. Mais ${extras} lançamento(s) categorizados.` : 'Salvo.');
    } catch (e) { salvar.disabled = false; toast('Não salvou: ' + erroMsg(e), 4000); }
  } }, 'Salvar');

  abrirSheet(
    h('h3', {}, l.descricao || l.tipo),
    h('div', { class: 'card', style: 'gap:6px' },
      h('div', { class: 'lin' }, h('span', {}, 'Valor'), h('span', { class: 'v' }, R(l.valor))),
      h('div', { class: 'lin' }, h('span', {}, 'Data'), h('span', {}, `${dataCurta(l.data_hora)} ${hora(l.data_hora)}`)),
      h('div', { class: 'lin' }, h('span', {}, 'Onde'), h('span', {}, `${l.banco || ''} ${l.final_cartao ? 'final ' + l.final_cartao : ''} · ${l.tipo || ''}`)),
      l.total_parcelas > 1 ? h('div', { class: 'lin' }, h('span', {}, 'Parcela'), h('span', {}, `${l.parcela}/${l.total_parcelas}`)) : null,
      h('div', { class: 'nota' }, l.conferido ? (l.aviso_id ? 'Conferido: veio pelo aviso e pelo banco.' : 'Veio pelo banco (Open Finance).')
        : 'Veio só pelo aviso do celular; o banco ainda não confirmou.')),
    h('label', { class: 'campo' }, generico ? 'Nome (o banco não informou a loja — escreva onde foi)' : 'Nome', nome),
    h('label', { class: 'campo' }, 'Entra como', comoSel),
    h('label', { class: 'campo' }, 'Categoria', catSel),
    blocoRegra,
    porCat ? h('div', { class: 'nota' }, 'Quem gastou está definido em cada parte da divisão.') : blocoQuem,
    blocoComb,
    h('label', { class: 'campo' }, 'Observação', obs),
    porCat ? h('div', { class: 'card', style: 'gap:6px' }, h('h2', {}, `Dividido em ${ps.length} partes`),
      ps.map((p) => h('div', { class: 'lin' }, h('span', {}, `${nomeCat(p.categoria_id)} · ${nomePessoa(p.pessoa_id || l.pessoa_id)}`), h('span', { class: 'v' }, R(p.valor))))) : null,
    h('div', { class: 'btns' }, salvar,
      comoSel.value === 'Gasto' ? h('button', { class: 'btn sec', onclick: () => abrirDivisao(l) }, porCat ? 'Editar divisão' : 'Dividir por categoria') : null));
  mostrar(); atualizaQuem();
}

function abrirDivisao(l) {
  const total = num(l.valor);
  let linhas = (divisaoPorCategoria(l) ? partesDe(l) : []).map((p) => ({ cat: p.categoria_id, pessoa: p.pessoa_id || l.pessoa_id, valor: Number(p.valor) }));
  if (!linhas.length) linhas = [{ cat: l.categoria_id, pessoa: l.pessoa_id, valor: total }, { cat: null, pessoa: l.pessoa_id, valor: 0 }];
  const lista = h('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  const falta = h('div', { class: 'lin' });
  const salvar = h('button', { class: 'btn' }, 'Salvar divisão');

  const atualizar = () => {
    const soma = num(linhas.reduce((s, x) => s + (Number(x.valor) || 0), 0));
    const dif = num(total - soma);
    falta.replaceChildren(h('span', {}, dif === 0 ? 'Distribuído certinho' : dif > 0 ? 'Falta distribuir' : 'Passou do total'),
      h('span', { class: 'v', style: dif === 0 ? 'color:var(--receita)' : 'color:var(--erro)' }, R(Math.abs(dif))));
    salvar.disabled = dif !== 0 || linhas.length < 2 || linhas.some((x) => !(Number(x.valor) > 0) || !x.cat);
  };
  const desenhar = () => {
    lista.replaceChildren();
    linhas.forEach((x, i) => {
      const c = h('select', { 'aria-label': 'Categoria' }, opcoes(st.cad.categorias.map((k) => [k.id, k.nome]), x.cat, 'Categoria…'));
      const p = h('select', { 'aria-label': 'Quem' }, opcoes(st.cad.pessoas.map((k) => [k.id, k.nome]), x.pessoa));
      const v = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: x.valor || '', 'aria-label': 'Valor' });
      c.onchange = () => { x.cat = c.value ? Number(c.value) : null; atualizar(); };
      p.onchange = () => { x.pessoa = p.value; };
      v.oninput = () => { x.valor = Number(String(v.value).replace(',', '.')) || 0; atualizar(); };
      lista.append(h('div', { class: 'parte campo' }, c, p, v,
        h('button', { 'aria-label': 'Remover parte', onclick: () => { linhas.splice(i, 1); desenhar(); } }, '✕')));
    });
    atualizar();
  };
  salvar.onclick = async () => {
    salvar.disabled = true;
    try {
      const d = await sb.from('partes').delete().eq('lancamento_id', l.id);
      if (d.error) throw d.error;
      const ins = await sb.from('partes').insert(linhas.map((x) => ({ lancamento_id: l.id, categoria_id: x.cat, pessoa_id: x.pessoa, valor: num(x.valor) })));
      if (ins.error) throw ins.error;
      fecharSheet(); await carregarMes(); render(); toast('Divisão salva.');
    } catch (e) { salvar.disabled = false; toast('Não salvou: ' + erroMsg(e), 4000); }
  };
  abrirSheet(
    h('h3', {}, 'Dividir lançamento'),
    h('div', { class: 'lin' }, h('span', {}, l.descricao || l.tipo), h('span', { class: 'v' }, R(total))),
    lista,
    h('button', { class: 'btn sec', onclick: () => { linhas.push({ cat: null, pessoa: l.pessoa_id, valor: 0 }); desenhar(); } }, '+ Adicionar parte'),
    h('div', { class: 'card' }, falta),
    h('div', { class: 'btns' }, salvar,
      divisaoPorCategoria(l) ? h('button', { class: 'btn perigo', onclick: async () => {
        await sb.from('partes').delete().eq('lancamento_id', l.id); fecharSheet(); await carregarMes(); render(); toast('Divisão desfeita.');
      } }, 'Desfazer divisão') : null));
  desenhar();
}

// ----- Carro -----
async function telaCarro(wrap) {
  wrap.append(h('div', { class: 'cab' }, h('h1', {}, 'Carro'), h('span', { class: 'sub' }, 'Combustível, pedágio, lavagem e manutenção')));
  const corpo = h('div', { class: 'corpo' });
  wrap.append(corpo);
  const comb = catId('Combustível'), carro = catId('Carro');
  const desde = addMes(st.mes, -11).toISOString();
  const { data, error } = await sb.from('lancamentos').select('*, partes(*), abastecimentos(*)')
    .eq('conta_como', 'Gasto').eq('categoria_id', comb).gte('data_hora', desde).order('data_hora', { ascending: false });
  if (error) throw error;

  // Consumo: entre dois tanques cheios
  const fills = data.map((l) => ({ l, a: abastDe(l) })).filter((x) => x.a && x.a.km).sort((a, b) => a.a.km - b.a.km);
  const trechos = [];
  let base = null, litros = 0, valor = 0;
  for (const f of fills) {
    if (base) { litros += Number(f.a.litros) || 0; valor += Number(f.l.valor); }
    if (f.a.tanque_cheio) {
      if (base && litros > 0 && f.a.km > base.a.km) trechos.push({ km: f.a.km - base.a.km, litros, valor });
      base = f; litros = 0; valor = 0;
    }
  }
  const ult = trechos[trechos.length - 1];
  const tot = trechos.reduce((s, t) => ({ km: s.km + t.km, litros: s.litros + t.litros, valor: s.valor + t.valor }), { km: 0, litros: 0, valor: 0 });
  const fmt1 = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmt2 = (v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  corpo.append(h('div', { class: 'grade2' },
    h('div', { class: 'card', style: 'gap:2px' }, h('h2', {}, 'Consumo'),
      h('span', { style: 'font-size:20px;font-weight:700' }, ult ? `${fmt1(ult.km / ult.litros)} km/l` : '— km/l'),
      h('span', { class: 'nota' }, ult ? `média ${fmt1(tot.km / tot.litros)} km/l` : 'a partir do 2º tanque cheio')),
    h('div', { class: 'card', style: 'gap:2px' }, h('h2', {}, 'Custo por km'),
      h('span', { style: 'font-size:20px;font-weight:700' }, ult ? `R$ ${fmt2(ult.valor / ult.km)}` : '— R$/km'),
      h('span', { class: 'nota' }, ult ? `média R$ ${fmt2(tot.valor / tot.km)}` : 'a partir do 2º tanque cheio'))));
  if (trechos.length >= 2 && ult.km / ult.litros < 0.85 * (tot.km / tot.litros)) {
    corpo.append(h('div', { class: 'card', style: 'background:var(--ambar-fundo);color:var(--ambar)' },
      'O consumo do último tanque caiu mais de 15% em relação à média. Vale olhar pneus, manutenção ou o combustível.'));
  }

  // Gastos do carro no mês selecionado
  const doMes = porcoes(st.lancs).filter((p) => p.cat === comb || p.cat === carro);
  const somaC = num(doMes.filter((p) => p.cat === comb).reduce((s, p) => s + p.valor, 0));
  const somaO = num(doMes.filter((p) => p.cat === carro).reduce((s, p) => s + p.valor, 0));
  corpo.append(h('div', { class: 'card' }, h('div', { class: 'lin' }, h('h2', {}, `Carro em ${nomeMes(st.mes).toLowerCase()}`)),
    h('div', { class: 'lin' }, h('span', {}, 'Combustível'), h('span', { class: 'v' }, R(somaC))),
    h('div', { class: 'lin' }, h('span', {}, 'Pedágio, lavagem e outros'), h('span', { class: 'v' }, R(somaO))),
    h('div', { class: 'lin total' }, h('span', {}, 'Total'), h('span', {}, R(somaC + somaO)))));

  const semKm = data.filter((l) => !(abastDe(l) || {}).km);
  corpo.append(h('div', { class: 'dia' }, 'Abastecimentos'));
  if (!data.length) corpo.append(h('div', { class: 'vazio' }, 'Nenhum abastecimento ainda.'));
  if (semKm.length) corpo.append(h('div', { class: 'nota' }, `Toque num abastecimento para informar o km e os litros. Faltam ${semKm.length}.`));
  for (const l of data) corpo.append(itemLanc(l));
}

// ----- Conferência -----
async function telaConferencia(wrap) {
  wrap.append(h('div', { class: 'cab' }, h('h1', {}, 'Conferência'), h('span', { class: 'sub' }, 'Avisos do celular × dados dos bancos')));
  const corpo = h('div', { class: 'corpo' });
  wrap.append(corpo);
  const desde = new Date(Date.now() - 60 * 86400000).toISOString();
  const [disp, sync, lancs, avisos] = await Promise.all([
    sb.from('dispositivos').select('nome, ativo, ultimo_contato').order('nome'),
    sb.from('sync_log').select('*').order('id', { ascending: false }).limit(1),
    sb.from('lancamentos').select('*, partes(*), abastecimentos(*)').gte('data_hora', desde).neq('conta_como', 'Detalhe').order('data_hora', { ascending: false }),
    sb.from('avisos').select('pacote, titulo, texto, recebido_em, lido').gte('recebido_em', desde).order('recebido_em', { ascending: false }).limit(300),
  ]);
  for (const x of [disp, sync, lancs, avisos]) if (x.error) throw x.error;

  const s = sync.data[0];
  const cardF = h('div', { class: 'card' }, h('h2', {}, 'Funcionamento'));
  for (const d of disp.data) {
    const velho = !d.ultimo_contato || Date.now() - new Date(d.ultimo_contato).getTime() > 3 * 86400000;
    cardF.append(h('div', { class: 'lin' }, h('span', {}, `Leitor · ${d.nome}`),
      h('span', { class: 'status ' + (velho ? 'amb' : 'ok') }, haQuanto(d.ultimo_contato))));
  }
  cardF.append(h('div', { class: 'lin' }, h('span', {}, 'Leitura dos bancos'),
    h('span', { class: 'status ' + (!s ? 'amb' : s.ok ? 'ok' : 'err') }, !s ? 'ainda não rodou' : s.ok ? haQuanto(s.fim || s.inicio) : 'erro ' + haQuanto(s.inicio))));
  if (s && !s.ok) cardF.append(h('div', { class: 'nota erro' }, String(s.detalhe || '').slice(0, 300)));
  const btnSync = h('button', { class: 'btn sec', onclick: async () => {
    btnSync.disabled = true; btnSync.textContent = 'Lendo os bancos…';
    const r = await sb.functions.invoke('sync-pluggy', { body: {} });
    btnSync.disabled = false; btnSync.textContent = 'Ler os bancos agora';
    if (r.error) toast('Erro ao ler os bancos: ' + erroMsg(r.error), 5000);
    else toast(`Pronto: ${r.data.novas || 0} movimentações novas.`);
    await carregarMes(); render();
  } }, 'Ler os bancos agora');
  cardF.append(btnSync, h('div', { class: 'nota' }, 'Os bancos são lidos sozinhos às 6h20 e às 18h20. O leitor do celular manda os avisos na hora em que chegam.'));
  if (window.GastosAndroid) {
    let info = {};
    try { info = JSON.parse(window.GastosAndroid.status()); } catch {}
    cardF.append(h('div', { class: 'lin' }, h('span', {}, 'Leitor neste celular'),
      h('span', { class: 'status ' + (info.ligado ? 'ok' : 'err') }, info.ligado ? `${info.pendentes || 0} aguardando envio` : 'desligado')),
      h('button', { class: 'btn sec', onclick: () => window.GastosAndroid.abrirLeitor() }, 'Abrir o leitor de avisos'));
  }
  corpo.append(cardF);

  const L = lancs.data;
  const cinco = Date.now() - 5 * 86400000;
  const soAviso = L.filter((l) => l.origem === 'aviso' && !l.conferido);
  const soAvisoVelho = soAviso.filter((l) => new Date(l.data_hora).getTime() < cinco);
  const ambos = L.filter((l) => l.aviso_id && l.conferido).length;
  const soBanco = L.filter((l) => l.origem === 'banco' && !l.aviso_id).length;
  corpo.append(h('div', { class: 'card' }, h('h2', {}, 'Últimos 60 dias'),
    h('div', { class: 'lin' }, h('span', {}, 'Chegou pelo aviso e pelo banco'), h('span', { class: 'v' }, ambos)),
    h('div', { class: 'lin' }, h('span', {}, 'Só pelo banco (sem aviso)'), h('span', { class: 'v' }, soBanco)),
    h('div', { class: 'lin' }, h('span', {}, 'Só pelo aviso (banco ainda não trouxe)'), h('span', { class: 'v' }, soAviso.length)),
    h('div', { class: 'nota' }, 'Compras no cartão costumam chegar pelo banco com alguns dias ou só no fechamento da fatura.')));
  if (soAvisoVelho.length) {
    corpo.append(h('div', { class: 'dia' }, `Só no aviso há mais de 5 dias (${soAvisoVelho.length})`));
    for (const l of soAvisoVelho.slice(0, 30)) corpo.append(itemLanc(l));
  }

  const nao = avisos.data.filter((a) => a.lido && a.lido.contaComo === 'Não entendido');
  const cardN = h('div', { class: 'card' }, h('h2', {}, 'Avisos não entendidos'));
  if (!nao.length) cardN.append(h('span', {}, 'Nenhum'));
  for (const a of nao.slice(0, 20)) cardN.append(h('div', { class: 'nota' }, `${dataCurta(a.recebido_em)} · ${a.titulo || a.pacote}: ${a.texto}`));
  if (nao.length) cardN.append(h('div', { class: 'nota' }, 'Mande um print destes para o Claude ajustar a leitura.'));
  corpo.append(cardN);

  const { data: u } = await sb.auth.getUser();
  corpo.append(h('div', { class: 'card' }, h('div', { class: 'nota' }, `Conectado como ${u.user ? u.user.email : ''}`),
    h('button', { class: 'btn perigo', onclick: async () => { await sb.auth.signOut(); location.reload(); } }, 'Sair')));
}

// ---------- login ----------
function telaLogin(msg) {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const senha = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const erro = h('div', { class: 'erro', role: 'alert' }, msg || '');
  const entrar = h('button', { class: 'btn', type: 'submit' }, 'Entrar');
  const form = h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault(); entrar.disabled = true; erro.textContent = '';
    const r = await sb.auth.signInWithPassword({ email: email.value.trim(), password: senha.value });
    entrar.disabled = false;
    if (r.error) erro.textContent = 'E-mail ou senha incorretos.';
    else iniciar();
  } },
    h('img', { class: 'logo', src: 'icons/icon-192.png', alt: '' }),
    h('h1', {}, 'Gastos da Família'),
    h('label', { class: 'campo' }, 'E-mail', email),
    h('label', { class: 'campo' }, 'Senha', senha),
    erro, entrar,
    h('button', { class: 'btn sec', type: 'button', onclick: async () => {
      if (!email.value.trim()) { erro.textContent = 'Escreva seu e-mail primeiro.'; return; }
      await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname });
      erro.textContent = 'Se o e-mail estiver cadastrado, chega um link para criar uma senha nova.';
    } }, 'Esqueci a senha'));
  document.getElementById('app').replaceChildren(form);
}

function telaCriarSenha() {
  const s1 = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
  const s2 = h('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: true });
  const erro = h('div', { class: 'erro', role: 'alert' });
  const ok = h('button', { class: 'btn', type: 'submit' }, 'Salvar senha');
  const form = h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault(); erro.textContent = '';
    if (s1.value.length < 8) { erro.textContent = 'Use pelo menos 8 caracteres.'; return; }
    if (s1.value !== s2.value) { erro.textContent = 'As duas senhas estão diferentes.'; return; }
    ok.disabled = true;
    const r = await sb.auth.updateUser({ password: s1.value });
    ok.disabled = false;
    if (r.error) erro.textContent = 'Não deu para salvar: ' + erroMsg(r.error);
    else { history.replaceState(null, '', location.pathname); iniciar(); }
  } },
    h('img', { class: 'logo', src: 'icons/icon-192.png', alt: '' }),
    h('h1', {}, 'Crie sua senha'),
    h('p', { class: 'nota' }, 'É com ela que você vai entrar no app daqui para frente.'),
    h('label', { class: 'campo' }, 'Senha nova', s1),
    h('label', { class: 'campo' }, 'Repita a senha', s2),
    erro, ok);
  document.getElementById('app').replaceChildren(form);
}

let criandoSenha = TIPO_LINK === 'invite' || TIPO_LINK === 'recovery';
sb.auth.onAuthStateChange((evento) => {
  if (evento === 'PASSWORD_RECOVERY') { criandoSenha = true; telaCriarSenha(); }
});

async function iniciar() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return telaLogin();
  if (criandoSenha) { criandoSenha = false; return telaCriarSenha(); }
  const { data: m } = await sb.from('membros').select('nome').eq('user_id', data.session.user.id).maybeSingle();
  if (!m) {
    telaLogin('Seu login ainda não foi liberado. Fale com o Daniel.');
    await sb.auth.signOut();
    return;
  }
  try {
    await carregarCadastros();
    await carregarMes();
    render();
  } catch (e) {
    document.getElementById('app').replaceChildren(h('div', { class: 'login' }, h('h1', {}, 'Não consegui carregar'),
      h('p', { class: 'erro' }, erroMsg(e)), h('button', { class: 'btn', onclick: () => location.reload() }, 'Tentar de novo')));
  }
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharSheet(); });
// Botão "voltar" do Android: fecha a janela aberta ou volta para o Início
window.voltarApp = () => {
  if (!document.getElementById('sheet').hidden) { fecharSheet(); return true; }
  if (st.cad && st.aba !== 'inicio') { st.aba = 'inicio'; render(); return true; }
  return false;
};
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && st.cad) { try { await carregarMes(); render(); } catch {} }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
// Deixa o supabase ler o link do e-mail antes de decidir a tela
setTimeout(iniciar, TIPO_LINK ? 400 : 0);
