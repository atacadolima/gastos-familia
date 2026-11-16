'use strict';
// Mutirão (antes "Gastos da Família") — app do Daniel e da Helene. Juntos, a conta fecha.
// Os dados ficam no Supabase, protegidos por login: só quem está na tabela "membros" enxerga.

const SB_URL = 'https://cjltedcpwmaqluvhybih.supabase.co';
const SB_KEY = 'sb_publishable_q6Ae6qRfaqPvCX-W5yMQyQ_LtkI77w9';
const TZ = 'America/Sao_Paulo';

// Tipo do link de e-mail (convite ou troca de senha) — lido antes do supabase limpar o endereço
const TIPO_LINK = new URLSearchParams(location.hash.slice(1)).get('type');

const sb = window.supabase.createClient(SB_URL, SB_KEY, {
  // lock simples: a trava padrão (navigator.locks) pode ficar presa dentro do app Android e deixar a tela em branco
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit',
    lock: async (_nome, _espera, fn) => fn() },
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
const VERSAO_TELAS = 'v29';
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
/** Categorias em ordem alfabética, com "Outros" por último */
const catsOrdem = () => [...st.cad.categorias].sort((a, b) => (a.nome === 'Outros') - (b.nome === 'Outros') || a.nome.localeCompare(b.nome, 'pt-BR'))
  .map((c) => [c.id, c.nome]);
const catId = (nome) => (st.cad.categorias.find((c) => c.nome === nome) || {}).id;
const partesDe = (l) => (Array.isArray(l.partes) ? l.partes : []);
const abastDe = (l) => (Array.isArray(l.abastecimentos) ? l.abastecimentos[0] : l.abastecimentos) || null;
function erroMsg(e) { return (e && (e.message || e.error_description)) || String(e); }

// ---------- dados ----------
async function carregarCaixinhas() {
  const r = await sb.from('caixinhas_saldo').select('*').eq('ativa', true).order('nome');
  if (!r.error) st.cad.caixinhas = r.data;
}
const TIPOS_CX = [['banco', 'Aplicação no banco'], ['poupanca', 'Poupança'], ['previdencia', 'Previdência privada'], ['consorcio', 'Consórcio'], ['dolar', 'Dólar / moeda'], ['outro', 'Outro']];
const nomeCx = (id) => ((st.cad.caixinhas || []).find((c) => c.id === id) || {}).nome || 'sem caixinha';
async function carregarCadastros() {
  const [p, c, k] = await Promise.all([
    sb.from('pessoas').select('*').order('ordem'),
    sb.from('categorias').select('*').eq('ativa', true).order('ordem'),
    sb.from('cartoes').select('*'),
  ]);
  for (const x of [p, c, k]) if (x.error) throw x.error;
  st.cad = { pessoas: p.data, categorias: c.data, cartoes: k.data, caixinhas: [], fins: [] };
  await carregarCaixinhas();
  await carregarFinanciamentos();
}
/** Financiamentos e o andamento: posição de referência + parcelas pagas depois dela (compromisso ligado). */
async function carregarFinanciamentos() {
  const r = await sb.from('financiamentos').select('*, financiamento_anos(*)').eq('ativo', true).order('id');
  if (r.error) { st.cad.fins = []; return; }
  const fins = r.data;
  for (const f of fins) {
    let pagos = [];
    if (f.compromisso_id) {
      const q = await sb.from('lancamentos').select('data_hora, valor').eq('compromisso_id', f.compromisso_id).eq('previsto', false)
        .gt('data_hora', new Date(f.saldo_em + 'T23:59:59-03:00').toISOString()).order('data_hora');
      if (!q.error) pagos = q.data;
    }
    const am = Number(f.amortizacao_mes) || 0, i = (Number(f.taxa_anual) || 0) / 1200;
    f.pagos = pagos;
    f.pagas = f.parcelas_pagas + pagos.length;
    f.saldo = Math.max(0, Number(f.saldo_devedor) - am * pagos.length);
    f.faltam = Math.max(0, f.parcelas_total - f.pagas);
    f.prox = { amort: Math.min(am, f.saldo), juros: f.saldo * i, outros: (Number(f.seguro_mes) || 0) + (Number(f.taxa_adm_mes) || 0) };
    f.prox.total = f.prox.amort + f.prox.juros + f.prox.outros;
    f.ultima = addMes(new Date(new Date(f.saldo_em + 'T12:00:00').getFullYear(), new Date(f.saldo_em + 'T12:00:00').getMonth(), 1), f.parcelas_total - f.parcelas_pagas);
    f.original = am * f.parcelas_total;
  }
  st.cad.fins = fins;
}
/** Juros que ainda faltam pagar (SAC, amortização fixa); com amortização extra, o prazo encurta. */
function jurosRestantes(saldo, am, i) {
  let j = 0, n = 0;
  while (saldo > 0.01 && n < 1000) { j += saldo * i; saldo -= Math.min(am, saldo); n++; }
  return { juros: j, meses: n };
}

async function carregarMes() {
  st.carregando = true;
  const de = st.mes.toISOString(), ate = addMes(st.mes, 1).toISOString();
  const { data, error } = await sb.from('lancamentos')
    .select('*, partes(*), abastecimentos(*), comprovantes(id)')
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
    if (l.conta_como !== 'Gasto' || l.previsto) continue;
    const ps = partesDe(l);
    if (ps.length) for (const p of ps) out.push({ l, valor: Number(p.valor), cat: p.categoria_id, pessoa: p.pessoa_id || l.pessoa_id });
    else out.push({ l, valor: Number(l.valor), cat: l.categoria_id, pessoa: l.pessoa_id });
  }
  return out;
}
/** Divisão só entre pessoas (mesma categoria em todas as partes) — feita pelos quadradinhos de "Quem". */
function divisaoPorPessoa(l) {
  const ps = partesDe(l);
  if (!(ps.length > 1 && ps.every((p) => p.categoria_id === ps[0].categoria_id) && new Set(ps.map((p) => p.pessoa_id)).size === ps.length)) return false;
  // Divisão feita em "Dividir" (valores diferentes ou com observação em cada parte) não é a divisão simples por pessoa
  if (ps.some((p) => p.nome_outro || (p.observacao && p.pessoa_id !== 'outros'))) return false;
  const iguais = dividirIgual(Number(l.valor), ps.length).map((v) => Math.round(v * 100)).sort().join();
  return ps.map((p) => Math.round(Number(p.valor) * 100)).sort().join() === iguais;
}
const divisaoPorCategoria = (l) => partesDe(l).length > 0 && !divisaoPorPessoa(l);
/** Divide em centavos iguais; a sobra vai para os primeiros. */
function dividirIgual(total, n) {
  const c = Math.round(total * 100), base = Math.floor(c / n), sobra = c - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < sobra ? 1 : 0)) / 100);
}
const pendente = (l) => l.conta_como === 'Gasto' && !l.previsto && !l.categoria_id && !partesDe(l).length;

// ---------- telas ----------
function render() {
  if (st.papel === 'compras') return telaComprasSimples();
  const app = document.getElementById('app');
  app.replaceChildren();
  const tela = { inicio: telaInicio, lanc: telaLancamentos, compras: telaCompras, carro: telaCarro, conf: telaConferencia, analise: telaAnalise }[st.aba];
  const wrap = h('div', { class: 'app' });
  app.append(wrap);
  Promise.resolve(tela(wrap)).catch((e) => wrap.append(h('div', { class: 'corpo' }, h('div', { class: 'card erro' }, 'Erro: ' + erroMsg(e)))));
  app.append(navegacao());
}

// Ícone e cor de cada categoria (pelo nome; categorias novas caem em "Outros")
const CAT_ICONE = [
  [/mercado/i, 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20h.01M17 20h.01', '#C2560C', '#FDE8D4'],
  [/combust/i, 'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3M7 8h4', '#1B3FBF', '#E2E8FB'],
  [/^carro/i, 'M5 16l1.5-5A2 2 0 0 1 8.4 9.5h7.2a2 2 0 0 1 1.9 1.5L19 16M4 16h16v3H4zM7 19v2M17 19v2', '#1B3FBF', '#E2E8FB'],
  [/restaur|lanche/i, 'M6 3v8a3 3 0 0 0 6 0V3M9 3v18M17 3c-2 2-2 6 0 8v10', '#A8461A', '#FBE7D9'],
  [/m[eé]dic/i, 'M6 3v6a4 4 0 0 0 8 0V3M10 13v3a5 5 0 0 0 10 0v-2M20 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', '#0E7C86', '#DDF1F2'],
  [/farm|saúde/i, 'M10 3h4v4l3 3v11H7V10l3-3zM10 15h4M12 13v4', '#B0285A', '#F7DDE6'],
  [/^casa/i, 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z', '#0E7C86', '#DDF1F2'],
  [/contas/i, 'M13 2L4 14h7l-1 8 9-12h-7z', '#B07A00', '#FFF2C7'],
  [/assinat/i, 'M4 6h16v12H4zM10 9l5 3-5 3z', '#6A3FB5', '#E9E1F7'],
  [/roupa|calçad/i, 'M8 3l-5 3 2 4 3-1v12h8V9l3 1 2-4-5-3a4 4 0 0 1-8 0z', '#B0285A', '#F7DDE6'],
  [/^compras/i, 'M6 7h12l1 14H5zM9 7a3 3 0 0 1 6 0', '#C2560C', '#FDE8D4'],
  [/gabriel/i, 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM5 21a7 7 0 0 1 14 0M10 8h.01M14 8h.01', '#0E7C86', '#DDF1F2'],
  [/lazer/i, 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z', '#6A3FB5', '#E9E1F7'],
  [/viagem/i, 'M2 16l20-7-3-2-7 2-5-4-2 1 3 5-4 1-2-1-1 1z', '#0E7C86', '#DDF1F2'],
  [/educa/i, 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h13', '#1B3FBF', '#E2E8FB'],
  [/presente/i, 'M4 10h16v11H4zM2 7h20v3H2zM12 7v14M12 7c-2-4-6-4-6-1s6 1 6 1zm0 0c2-4 6-4 6-1s-6 1-6 1z', '#B0285A', '#F7DDE6'],
  [/tarifa|juros/i, 'M19 5L5 19M7 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 18a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', '#B3261E', '#FBE3E1'],
  [/previd|seguro/i, 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', '#1B3FBF', '#E2E8FB'],
  [/doaç/i, 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z', '#B0285A', '#F7DDE6'],
  [/beleza|cuidado/i, 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 17l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z', '#B0285A', '#F7DDE6'],
  [/funcion|serviço/i, 'M9 3h6l-1 7h-4zM6 21l2-11h8l2 11z', '#0E7C86', '#DDF1F2'],
  [/imposto/i, 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4', '#B3261E', '#FBE3E1'],
  [/moradia/i, 'M4 21V8l8-5 8 5v13M9 21v-6h6v6M4 21h16', '#0E7C86', '#DDF1F2'],
  [/academia|esporte/i, 'M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12', '#C2560C', '#FDE8D4'],
  [/pets/i, 'M12 14c-3 0-6 3-6 5.5 0 1.5 1.5 1.5 3 1s2-.5 3-.5 1.5 0 3 .5 3 .5 3-1C18 17 15 14 12 14zM6 10a1.5 2 0 1 0 0-.1M18 10a1.5 2 0 1 0 0-.1M9.5 6a1.5 2 0 1 0 0-.1M14.5 6a1.5 2 0 1 0 0-.1', '#A8461A', '#FBE7D9'],
  [/empresa|reembols/i, 'M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18', '#4A5568', '#E8EBF0'],
];
const ICO_OUTROS = ['M5 12h.01M12 12h.01M19 12h.01', '#4A5568', '#E8EBF0'];
const ICO_TIPO = {
  Receita: ['M12 19V5M5 12l7-7 7 7', '#17803F', '#DDF1E4'],
  Investimento: ['M4 17l6-6 4 4 7-7M15 8h6v6', '#1B3FBF', '#E2E8FB'],
  'Entre contas': ['M7 7h13l-3-3M17 17H4l3 3', '#4A5568', '#E8EBF0'],
  Detalhe: ['M5 12h.01M12 12h.01M19 12h.01', '#4A5568', '#E8EBF0'],
};
function icoDe(nome) { for (const [re, d, c, f] of CAT_ICONE) if (re.test(nome || '')) return [d, c, f]; return ICO_OUTROS; }
function bolinha([d, cor, fundo], tam = 40) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: tam / 2, height: tam / 2, fill: 'none', stroke: cor, 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.append(p);
  return h('span', { class: 'ico', style: `width:${tam}px;height:${tam}px;background:${fundo}` }, svg);
}
const icoPend = (tam = 40) => h('span', { class: 'ico pend', style: `width:${tam}px;height:${tam}px` }, '?');
function icoLanc(l) {
  if (pendente(l)) return icoPend(42);
  if (l.conta_como === 'Gasto') return bolinha(l.categoria_id ? icoDe(nomeCat(l.categoria_id)) : ICO_OUTROS, 42);
  return bolinha(ICO_TIPO[l.conta_como] || ICO_OUTROS, 42);
}

const ICONES = {
  inicio: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  lanc: 'M4 6h16M4 12h16M4 18h10',
  carro: 'M5 16l1.5-5A2 2 0 0 1 8.4 9.5h7.2a2 2 0 0 1 1.9 1.5L19 16M4 16h16v3h-2M4 16v3h2M7.5 16.5h.01M16.5 16.5h.01',
  compras: 'M3 4h2l2.4 11.2a1 1 0 0 0 1 .8h8.9a1 1 0 0 0 1-.8L20 8H6.2M9 20h.01M17 20h.01',
  conf: 'M9 12l2 2 4-4M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
  analise: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
};
function navegacao() {
  const nav = h('nav', { class: 'tabs', 'aria-label': 'Telas' });
  for (const [id, rot] of [['inicio', 'Início'], ['lanc', 'Lançamentos'], ['compras', 'Compras'], ['carro', 'Carro'], ['analise', 'Análise']]) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONES[id]); svg.append(p);
    nav.append(h('button', { class: st.aba === id ? 'on' : '', 'aria-current': st.aba === id ? 'page' : null,
      onclick: () => { st.aba = id; st.filtroCat = null; st.analiseCat = null; st.analiseFin = null; st.analiseIR = null; st.busca = ''; render(); window.scrollTo(0, 0); } }, svg, rot));
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
  const todas = porcoes(st.lancs);
  const totalFamilia = num(todas.reduce((s, p) => s + p.valor, 0));
  const filtro = st.filtroInicio || null;
  const ps = filtro ? todas.filter((p) => (p.pessoa || 'daniel') === filtro) : todas;
  const total = num(ps.reduce((s, p) => s + p.valor, 0));
  const receitas = num(st.lancs.filter((l) => l.conta_como === 'Receita' && !l.previsto).reduce((s, l) => s + Number(l.valor), 0));
  const prevMes = num(st.lancs.filter((l) => l.previsto && l.conta_como === 'Gasto' && (!st.filtroInicio || l.pessoa_id === st.filtroInicio))
    .reduce((s, l) => s + Number(l.valor), 0));
  const invMes = st.lancs.filter((l) => l.conta_como === 'Investimento');
  const guardado = num(invMes.reduce((s, l) => s + (l.resgate ? -1 : 1) * Number(l.valor), 0));
  const filtrar = (id) => { st.filtroInicio = st.filtroInicio === id ? null : id; render(); };

  wrap.append(h('div', { class: 'hero' },
    h('div', { class: 'linha1' }, h('span', { class: 'marca' }, h('img', { src: 'icons/icon-192.png', alt: '' }), 'Mutirão'), h('span', { class: 'selo' }, filtro ? nomePessoa(filtro) : 'Família')),
    seletorMes(render),
    h('span', { class: 'rotulo', style: 'margin-top:8px' }, filtro ? `Gasto de ${nomePessoa(filtro)} no mês` : 'Gasto no mês'),
    h('span', { class: 'grande' }, R(total)),
    filtro ? h('span', { class: 'rotulo' }, `de ${R(totalFamilia)} da família`) : null,
    prevMes ? h('span', { class: 'prev-hero' }, `+ ${R(prevMes)} previsto até o fim do mês`) : null));
  const qtdPend = new Set(ps.filter((p) => !p.cat && pendente(p.l)).map((p) => p.l.id)).size;
  const irPend = () => { st.aba = 'lanc'; st.soPendentes = true; st.pessoa = filtro || 'todos'; render(); };
  wrap.append(h('div', { class: 'blocos' },
    h('div', { class: 'bloco' }, h('span', { class: 'r' }, 'Entradas'), h('span', { class: 'n rec' }, R(receitas))),
    h('div', { class: 'bloco' }, h('span', { class: 'r' }, guardado >= 0 ? 'Guardado' : 'Resgatado'), h('span', { class: 'n inv' }, R(Math.abs(guardado)))),
    h('button', { class: 'bloco' + (qtdPend ? ' amb' : ''), onclick: irPend }, h('span', { class: 'r' }, 'A categorizar'),
      h('span', { class: 'n' }, qtdPend ? `${qtdPend} ${qtdPend === 1 ? 'item' : 'itens'}` : 'Tudo certo'))));
  const corpo = h('div', { class: 'corpo' });
  wrap.append(corpo);
  // App do Android desatualizado: oferece atualizar (o número sobe a cada APK publicado)
  const APK_ATUAL = 9;
  let vInst = 0;
  try { vInst = window.GastosAndroid && window.GastosAndroid.versao ? Number(window.GastosAndroid.versao()) : 0; } catch {}
  if (vInst && vInst < APK_ATUAL) {
    corpo.append(h('div', { class: 'card', style: 'background:var(--ambar-fundo);border:1.5px solid var(--laranja)' },
      h('h2', {}, 'Tem versão nova do app'),
      h('div', { class: 'nota', style: 'color:var(--texto)' }, 'Toque em Atualizar e depois em Instalar. Seus dados continuam no app.'),
      h('button', { class: 'btn', onclick: () => window.GastosAndroid.verificarAtualizacao() }, 'Atualizar o app')));
  }
  if (filtro) {
    corpo.append(h('div', { class: 'card', style: 'flex-direction:row;align-items:center;justify-content:space-between;padding:10px 16px;background:var(--verde-claro)' },
      h('span', {}, 'Mostrando: ', h('b', {}, nomePessoa(filtro))),
      h('button', { class: 'btn sec', style: 'min-height:40px', onclick: () => filtrar(filtro) }, 'Ver todos')));
  }

  // Quem gastou (toque no nome para filtrar)
  const porPessoa = {};
  for (const p of todas) porPessoa[p.pessoa || 'daniel'] = (porPessoa[p.pessoa || 'daniel'] || 0) + p.valor;
  const cardP = h('div', { class: 'card' }, h('h2', {}, 'Quem gastou'), h('div', { class: 'nota', style: 'margin-top:-6px' }, 'Toque num nome para ver só os gastos dele.'));
  const cor = (id) => (id === 'helene' ? 'var(--helene)' : id === 'gabriel' ? '#1F5FAF' : id === 'outros' ? '#8A8F9B' : id === 'familia' ? '#6A3FB5' : 'var(--verde)');
  for (const pe of st.cad.pessoas) {
    const v = num(porPessoa[pe.id] || 0);
    if ((pe.id === 'outros' || pe.id === 'familia') && !v) continue;
    const pct = totalFamilia ? Math.round((v / totalFamilia) * 100) : 0;
    const ativo = filtro === pe.id;
    cardP.append(h('button', { 'aria-pressed': String(ativo), onclick: () => filtrar(pe.id),
      style: `display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;border-radius:10px;padding:8px;margin:0 -8px;width:calc(100% + 16px);
        border:1px solid ${ativo ? 'var(--verde)' : 'transparent'};background:${ativo ? 'var(--verde-claro)' : 'transparent'};opacity:${filtro && !ativo ? '.55' : '1'}` },
      h('div', { class: 'lin', style: 'width:100%' }, h('span', { style: ativo ? 'font-weight:700' : '' }, pe.nome), h('span', { class: 'v' }, R(v))),
      h('div', { class: 'barra', style: 'width:100%', role: 'img', 'aria-label': `${pct}% do total` },
        h('div', { style: `width:${pct}%;background:${cor(pe.id)}` }))));
  }
  corpo.append(cardP);

  // Por categoria (respeita o filtro)
  const porCat = {};
  for (const p of ps) porCat[p.cat || 0] = (porCat[p.cat || 0] || 0) + p.valor;
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const cardC = h('div', { class: 'card' }, h('h2', {}, filtro ? `Por categoria · ${nomePessoa(filtro)}` : 'Por categoria'));
  if (!cats.length) cardC.append(h('div', { class: 'vazio' }, filtro ? 'Nenhum gasto dessa pessoa neste mês.' : 'Nenhum gasto neste mês.'));
  const nPend = new Set(ps.filter((p) => !p.cat && pendente(p.l)).map((p) => p.l.id)).size;
  const maior = cats.length ? cats[0][1] : 0;
  for (const [id, v] of cats) {
    const pend = id === '0';
    const ic = pend ? null : icoDe(nomeCat(Number(id)));
    const pct = maior ? Math.max(3, Math.round((v / maior) * 100)) : 0;
    cardC.append(h('button', { class: 'catlin',
      onclick: () => { st.aba = 'lanc'; st.soPendentes = pend; st.pessoa = filtro || 'todos'; render(); } },
      pend ? icoPend(38) : bolinha(ic, 38),
      h('div', { class: 'catcorpo' },
        h('div', { class: 'lin' }, h('span', { class: pend ? 'alerta' : '', style: 'font-weight:700' }, pend ? `A categorizar (${nPend})` : nomeCat(Number(id))),
          h('span', { class: 'v' + (pend ? ' alerta' : '') }, R(v))),
        h('div', { class: 'barra fina' }, h('div', { style: `width:${pct}%;background:${pend ? 'var(--laranja)' : ic[1]}` })))));
  }
  corpo.append(cardC);

  // Já comprometido nos próximos meses (parcelas e assinaturas previstas)
  const prox = addMes(st.mes, 1);
  const rp = await sb.from('lancamentos').select('data_hora, valor').eq('previsto', true).eq('conta_como', 'Gasto')
    .gte('data_hora', prox.toISOString()).lt('data_hora', addMes(prox, 6).toISOString());
  if (!rp.error && rp.data.length) {
    const porMes = {};
    for (const x of rp.data) { const d = new Date(x.data_hora); const k = `${d.getFullYear()}-${d.getMonth()}`; porMes[k] = (porMes[k] || 0) + Number(x.valor); }
    const cardJ = h('div', { class: 'card' }, h('h2', {}, 'Já comprometido nos próximos meses'));
    for (let i = 0; i < 6; i++) {
      const m = addMes(prox, i); const v = porMes[`${m.getFullYear()}-${m.getMonth()}`];
      if (v) cardJ.append(h('button', { class: 'lin', style: 'border:none;background:none;padding:2px 0;text-align:left;min-height:32px',
        onclick: async () => { st.mes = m; st.aba = 'lanc'; await carregarMes(); render(); } },
        h('span', {}, nomeMes(m)), h('span', { class: 'v' }, R(v))));
    }
    cardJ.append(h('div', { class: 'nota' }, 'Parcelas que ainda vão cair e assinaturas que se repetem todo mês.'));
    corpo.append(cardJ);
  }

  // Financiamentos: uma linha simples (detalhe na Análise)
  for (const f of st.cad.fins || []) {
    const pct = Math.round((f.pagas / f.parcelas_total) * 100);
    corpo.append(h('button', { class: 'card fin-mini', onclick: () => { st.aba = 'analise'; st.analiseFin = f.id; render(); window.scrollTo(0, 0); } },
      h('div', { class: 'lin' }, h('h2', {}, f.nome), h('span', { class: 'v' }, `${Rmil(f.saldo)}`)),
      h('div', { class: 'barra fina' }, h('div', { style: `width:${pct}%;background:var(--verde)` })),
      h('div', { class: 'nota' }, `${f.pagas} de ${f.parcelas_total} parcelas · faltam ${f.faltam} · toque para ver o detalhe`)));
  }

  // Investimentos (caixinhas)
  await carregarCaixinhas();
  const cxs = st.cad.caixinhas;
  const cardI = h('div', { class: 'card' }, h('div', { class: 'lin' }, h('h2', {}, 'Investimentos'),
    h('span', { class: 'v' }, R(cxs.reduce((s, c) => s + Number(c.saldo || 0), 0)))));
  if (!cxs.length) cardI.append(h('div', { class: 'nota' }, 'Nenhuma caixinha ainda.'));
  for (const c of cxs) {
    const semSaldo = c.saldo_banco == null && Number(c.saldo_inicial) === 0 && c.tipo !== 'consorcio' && c.tipo !== 'outro';
    cardI.append(h('button', { class: 'lin', style: 'border:none;background:none;padding:4px 0;text-align:left;min-height:40px', onclick: () => abrirCaixinha(c) },
      h('span', {}, c.nome, h('br'), h('span', { class: 'nota' + (semSaldo ? ' alerta' : '') },
        semSaldo ? 'toque para informar o saldo de hoje' : (TIPOS_CX.find((t) => t[0] === c.tipo) || [0, ''])[1] + (c.qtd_dolar ? ` · US$ ${Number(c.qtd_dolar).toLocaleString('pt-BR')}` : ''))),
      h('span', { class: 'v' }, R(c.saldo))));
  }
  cardI.append(h('button', { class: 'btn sec', onclick: () => abrirCaixinha(null) }, '+ Nova caixinha'));
  corpo.append(cardI);

  // Cartões e contas
  const { data: contas } = await sb.from('contas_banco').select('*').eq('ignorar', false).order('banco');
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
  corpo.append(h('button', { class: 'btn sec', onclick: () => { st.aba = 'conf'; render(); window.scrollTo(0, 0); } }, 'Conferência e bancos'));
  corpo.append(h('div', { class: 'rodape' }, vInst ? `Versão do app ${Math.floor(vInst / 10)}.${vInst % 10} · telas ${VERSAO_TELAS}` : `Telas ${VERSAO_TELAS}`));
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
  const busca = h('input', { type: 'search', class: 'busca', value: st.busca || '', placeholder: 'Buscar em todos os meses: nome, valor, observação…', 'aria-label': 'Buscar lançamentos' });
  cab.append(busca);
  wrap.append(cab);

  const corpo = h('div', { class: 'corpo', style: 'gap:8px' });
  let tempo = null;
  busca.oninput = () => { clearTimeout(tempo); tempo = setTimeout(() => { st.busca = busca.value.trim(); if (st.busca.length >= 2) buscarLancamentos(corpo); else render(); }, 400); };
  if (st.busca && st.busca.length >= 2) { wrap.append(corpo); buscarLancamentos(corpo); return; }
  corpo.append(h('div', { class: 'btns' },
    h('button', { class: 'btn', onclick: () => abrirCompromisso(null) }, '+ Compromisso mensal'),
    h('button', { class: 'btn sec', onclick: listaCompromissos }, 'Ver compromissos')));
  wrap.append(corpo);
  let lista = st.lancs.filter((l) => (st.verTransf ? true : ['Gasto', 'Receita', 'Investimento'].includes(l.conta_como)));
  if (st.pessoa !== 'todos') lista = lista.filter((l) => l.pessoa_id === st.pessoa || partesDe(l).some((p) => p.pessoa_id === st.pessoa));
  if (st.soPendentes) lista = lista.filter(pendente);
  if (st.filtroCat) {
    lista = lista.filter((l) => l.conta_como === 'Gasto' && (l.categoria_id === st.filtroCat || partesDe(l).some((p) => p.categoria_id === st.filtroCat)));
    corpo.append(h('div', { class: 'card', style: 'flex-direction:row;align-items:center;justify-content:space-between;padding:10px 16px;background:var(--verde-claro)' },
      h('span', {}, 'Só: ', h('b', {}, nomeCat(st.filtroCat))), h('button', { class: 'btn sec', style: 'min-height:40px', onclick: () => { st.filtroCat = null; render(); } }, 'Ver todos')));
  }
  if (!lista.length) { corpo.append(h('div', { class: 'vazio' }, st.soPendentes ? 'Nada para categorizar. 👍' : 'Nenhum lançamento.')); return; }

  let diaAtual = '';
  for (const l of lista) {
    const d = diaChave(l.data_hora);
    if (d !== diaAtual) { diaAtual = d; corpo.append(h('div', { class: 'dia' }, d)); }
    corpo.append(itemLanc(l));
  }
}

/** Busca em todos os meses: texto (nome, observação, prestador, partes) ou valor (ex.: 2500, 2.500,00, 115,5). */
async function buscarLancamentos(corpo) {
  const q = st.busca;
  corpo.replaceChildren(h('div', { class: 'vazio' }, 'Buscando…'));
  const ehValor = /^[\d.,]+$/.test(q) && /\d/.test(q);
  let ids = new Set(), achados = [];
  const sel = '*, partes(*), abastecimentos(*), comprovantes(id)';
  if (ehValor) {
    const v = Number(q.includes(',') ? q.replace(/\./g, '').replace(',', '.') : q);
    const r = await sb.from('lancamentos').select(sel).gte('valor', v - 0.005).lt('valor', v + 1).order('data_hora', { ascending: false }).limit(100);
    if (!r.error) achados = r.data.filter((l) => Number(l.valor) === v || (!q.includes(',') && !q.includes('.') && Math.floor(Number(l.valor)) === v));
    const rp = await sb.from('partes').select('lancamento_id, valor').gte('valor', v - 0.005).lt('valor', v + 1);
    for (const p of rp.data || []) if (Math.floor(Number(p.valor)) === Math.floor(v)) ids.add(p.lancamento_id);
  } else {
    const t = q.replace(/[,()*%]/g, ' ').trim();
    const r = await sb.from('lancamentos').select(sel)
      .or(`descricao.ilike.*${t}*,observacao.ilike.*${t}*,ded_prestador.ilike.*${t}*`).order('data_hora', { ascending: false }).limit(100);
    if (!r.error) achados = r.data;
    const rp = await sb.from('partes').select('lancamento_id').or(`observacao.ilike.*${t}*,nome_outro.ilike.*${t}*`).limit(100);
    for (const p of rp.data || []) ids.add(p.lancamento_id);
  }
  for (const l of achados) ids.delete(l.id);
  if (ids.size) {
    const r2 = await sb.from('lancamentos').select(sel).in('id', [...ids]);
    if (!r2.error) achados = achados.concat(r2.data);
  }
  if (st.busca !== q) return; // o usuário já digitou outra coisa
  achados.sort((a, b) => (a.previsto - b.previsto) || (new Date(b.data_hora) - new Date(a.data_hora))); // reais primeiro; previstos no fim
  const tot = achados.filter((l) => l.conta_como === 'Gasto' && !l.previsto).reduce((s, l) => s + Number(l.valor), 0);
  corpo.replaceChildren(h('div', { class: 'card', style: 'flex-direction:row;align-items:center;justify-content:space-between;padding:10px 16px;background:var(--verde-claro)' },
    h('span', {}, achados.length ? `${achados.length} encontrado(s)` + (tot ? ` · gastos ${R(tot)}` : '') : 'Nada encontrado.'),
    h('button', { class: 'btn sec', style: 'min-height:40px', onclick: () => { st.busca = ''; render(); } }, 'Limpar')));
  let mesAtual = '';
  for (const l of achados) {
    const d = new Date(l.data_hora);
    const m = nomeMes(new Date(d.getFullYear(), d.getMonth(), 1));
    const rot = l.previsto ? `Previsto · ${m}` : m;
    if (rot !== mesAtual) { mesAtual = rot; corpo.append(h('div', { class: 'dia' }, rot)); }
    corpo.append(itemLanc(l));
  }
}

const dataCompra = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function itemLanc(l) {
  const ps = partesDe(l);
  const porPes = divisaoPorPessoa(l);
  const cat = ps.length && !porPes ? `Dividido em ${ps.length}` : l.conta_como === 'Gasto' ? nomeCat(l.categoria_id)
    : l.conta_como === 'Investimento' ? `${l.resgate ? 'Resgate' : 'Investimento'} · ${nomeCx(l.caixinha_id)}` : l.conta_como;
  const quem = porPes ? ps.map((p) => nomePessoa(p.pessoa_id)).join(', ') : nomePessoa(l.pessoa_id);
  const fim = l.final_cartao ? ` ${l.final_cartao}` : '';
  const ab = abastDe(l);
  const classeV = l.conta_como === 'Receita' ? 'v rec' : l.conta_como === 'Gasto' ? 'v' : l.conta_como === 'Investimento' ? 'v inv' : 'v neu';
  const tags = [];
  const atrasado = l.previsto && l.compromisso_id && new Date(l.data_hora) < new Date(Date.now() - 86400000);
  if (atrasado) tags.push(h('span', { class: 'tag amb' }, `venceu dia ${dataCurta(l.data_hora)} · não pago`));
  else if (l.previsto && l.compromisso_id) tags.push(h('span', { class: 'tag' }, `compromisso · vence dia ${dataCurta(l.data_hora)}`));
  else if (l.previsto) tags.push(h('span', { class: 'tag' }, l.serie && l.serie.startsWith('rec:') ? 'previsto · assinatura' : 'previsto'));
  if (!l.previsto && l.compromisso_id) tags.push(h('span', { class: 'tag ok' }, 'compromisso pago'));
  if (l.ded_tipo) tags.push(h('span', { class: 'tag ir' }, `IR · ${NOME_IR[l.ded_tipo]}${(l.comprovantes || []).length ? ' · 📎' : ' · sem nota'}`));
  else if (l.conferido) tags.push(h('span', { class: 'tag ok' }, l.aviso_id ? 'aviso + banco' : 'banco'));
  else if (l.origem === 'aviso') tags.push(h('span', { class: 'tag amb' }, 'só aviso'));
  if (l.total_parcelas > 1) tags.push(h('span', { class: 'tag' }, `parcela ${l.parcela}/${l.total_parcelas}`));
  if (l.total_parcelas > 1 && l.data_compra) tags.push(h('span', { class: 'tag compra' }, `comprado em ${dataCompra(l.data_compra)}`));
  return h('button', { class: 'item' + (pendente(l) ? ' pend' : '') + (l.previsto ? ' prev' : '') + (atrasado ? ' atrasado' : ''), onclick: () => abrirLanc(l) },
    icoLanc(l),
    h('div', { class: 'itemcorpo' },
      h('div', { class: 't' }, h('span', { class: 'n' }, l.descricao || l.tipo), h('span', { class: classeV }, (l.conta_como === 'Receita' ? '+ ' : '') + R(l.valor))),
      h('div', { class: 'd' }, pendente(l) ? h('b', { class: 'alerta' }, 'Toque para escolher a categoria · ') : null,
        `${st.busca ? dataCurta(l.data_hora) + ' ' : ''}${hora(l.data_hora)} · ${pendente(l) ? '' : cat + ' · '}${l.banco ? l.banco + fim + ' · ' : ''}${quem}${ab && ab.km ? ` · ${ab.km.toLocaleString('pt-BR')} km` : ''}`),
      tags.length ? h('div', {}, tags) : null,
      l.observacao ? h('div', { class: 'd' }, `“${l.observacao}”`) : null,
      ps.length && !porPes ? h('div', { class: 'partes-lista' }, ps.map((p) => h('div', { class: 'd' },
        `• ${nomeCat(p.categoria_id)} · ${nomePessoa(p.pessoa_id || l.pessoa_id)}${p.nome_outro ? ` (${p.nome_outro})` : ''} · ${R(p.valor)}${p.observacao ? ` — ${p.observacao}` : ''}`))) : null));
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
  if (l.previsto && l.compromisso_id) return abrirPrevistoCompromisso(l);
  const catSel = h('select', {}, opcoes(catsOrdem(), l.categoria_id, 'A categorizar'), h('option', { value: '__nova' }, '+ Nova categoria…'));
  const novaCat = h('input', { placeholder: 'Nome da nova categoria', maxlength: '40' });
  const blocoNova = h('div', { style: 'display:flex;gap:8px' }, h('div', { class: 'campo', style: 'flex-grow:1' }, novaCat),
    h('button', { class: 'btn', onclick: async () => {
      const nome = novaCat.value.trim();
      if (nome.length < 2) { toast('Escreva o nome da categoria.'); return; }
      const r = await sb.from('categorias').insert({ nome, ordem: 50 }).select().single();
      if (r.error) { toast(r.error.code === '23505' ? 'Essa categoria já existe.' : 'Não criou: ' + erroMsg(r.error), 4000); return; }
      st.cad.categorias.push(r.data);
      catSel.insertBefore(h('option', { value: String(r.data.id) }, r.data.nome), catSel.lastChild);
      catSel.value = String(r.data.id); mostrar(); toast(`Categoria "${r.data.nome}" criada.`);
    } }, 'Criar'));
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
  const comoSel = h('select', {}, opcoes([['Gasto', 'Gasto'], ['Receita', 'Receita (entrada)'], ['Investimento', 'Investimento (dinheiro guardado)'], ['Entre contas', 'Transferência entre contas / não conta'], ['Detalhe', 'Detalhe (não soma)']], l.conta_como));
  const cxSel = h('select', {}, opcoes((st.cad.caixinhas || []).map((c) => [c.id, c.nome]), l.caixinha_id, 'Escolha a caixinha…'), h('option', { value: '__nova' }, '+ Nova caixinha…'));
  const cxNome = h('input', { placeholder: 'ex.: Poupança, Consórcio do carro, Dólares', maxlength: '60' });
  const cxTipo = h('select', {}, opcoes(TIPOS_CX, 'banco'));
  const resgate = h('input', { type: 'checkbox', checked: !!l.resgate });
  const blocoCxNova = h('div', { class: 'grade2' }, h('label', { class: 'campo' }, 'Nome', cxNome), h('label', { class: 'campo' }, 'Tipo', cxTipo));
  const blocoInv = h('div', { class: 'card' }, h('h2', {}, 'Investimento'), h('label', { class: 'campo' }, 'Caixinha', cxSel), blocoCxNova,
    h('label', { class: 'check' }, resgate, 'É resgate (o dinheiro voltou para a conta)'),
    h('div', { class: 'nota' }, 'Não entra no gasto do mês; soma no saldo da caixinha.'));
  cxSel.onchange = () => { blocoCxNova.hidden = cxSel.value !== '__nova'; };
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
  // ---- Imposto de Renda: dedutível + comprovantes ----
  const sugereIR = sugestaoIR(l);
  const dedChk = h('input', { type: 'checkbox', checked: !!l.ded_tipo });
  const dedTipo = h('select', {}, opcoes(TIPOS_IR, l.ded_tipo || sugereIR || 'saude'));
  const pessoasIR = st.cad.pessoas.filter((p) => p.id !== 'outros' && p.id !== 'familia');
  const dedPes = h('select', {}, opcoes(pessoasIR.map((p) => [p.id, p.nome]), l.ded_pessoa || (pessoasIR.some((p) => p.id === l.pessoa_id) ? l.pessoa_id : 'daniel')));
  const dedPrest = h('input', { value: l.ded_prestador || '', placeholder: 'ex.: Dra. Ana / Clínica X / Escola Y', maxlength: '80' });
  const dedDoc = h('input', { value: l.ded_doc || '', placeholder: 'CPF ou CNPJ', inputmode: 'numeric', maxlength: '20' });
  const dedCampos = h('div', { class: 'ded-campos' },
    h('div', { class: 'grade2' }, h('label', { class: 'campo' }, 'Tipo', dedTipo), h('label', { class: 'campo' }, 'Para quem', dedPes)),
    h('label', { class: 'campo' }, 'Quem recebeu (médico, clínica, escola)', dedPrest),
    h('label', { class: 'campo' }, 'CPF/CNPJ de quem recebeu', dedDoc));
  dedCampos.hidden = !dedChk.checked;
  dedChk.onchange = () => { dedCampos.hidden = !dedChk.checked; };
  const listaAnexos = h('div', { class: 'anexos' });
  const recarregarAnexos = async () => {
    const r = await sb.from('comprovantes').select('*').eq('lancamento_id', l.id).order('id');
    listaAnexos.replaceChildren(...(r.data || []).map((c) => h('div', { class: 'anexo' },
      h('button', { class: 'anexo-nome', onclick: () => abrirComprovante(c.caminho) }, `📎 ${c.nome || 'comprovante'}`),
      h('button', { class: 'anexo-x', 'aria-label': 'Apagar comprovante', onclick: async () => {
        await sb.storage.from('comprovantes').remove([c.caminho]); await sb.from('comprovantes').delete().eq('id', c.id); recarregarAnexos(); } }, '✕'))));
  };
  const arquivo = h('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true });
  arquivo.onchange = async () => {
    for (const f of arquivo.files) {
      const caminho = `${l.id}/${Date.now()}-${f.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-60)}`;
      toast('Enviando comprovante…');
      const up = await sb.storage.from('comprovantes').upload(caminho, f, { contentType: f.type || 'application/octet-stream' });
      if (up.error) { toast('Não enviou: ' + erroMsg(up.error), 4000); continue; }
      await sb.from('comprovantes').insert({ lancamento_id: l.id, caminho, nome: f.name, tipo: f.type });
    }
    arquivo.value = ''; recarregarAnexos(); toast('Comprovante anexado.');
  };
  const blocoIR = h('div', { class: 'card', style: 'gap:8px' }, h('h2', {}, 'Imposto de Renda'),
    sugereIR && !l.ded_tipo ? h('div', { class: 'nota', style: 'color:var(--ambar);font-weight:700' }, 'Pode ser dedutível no IR. Quer marcar e anexar a nota?') : null,
    h('label', { class: 'check' }, dedChk, 'Dedutível no Imposto de Renda'), dedCampos, listaAnexos,
    h('button', { class: 'btn sec', type: 'button', onclick: () => arquivo.click() }, 'Anexar comprovante (foto ou PDF)'), arquivo);
  recarregarAnexos();
  if (!l.ded_doc && l.transacao_banco_id) {
    // Pix/boleto: o banco às vezes informa quem recebeu (nome e CPF/CNPJ)
    sb.from('transacoes_banco').select('bruto').eq('id', l.transacao_banco_id).maybeSingle().then(({ data }) => {
      const rc = data && data.bruto && data.bruto.paymentData && data.bruto.paymentData.receiver;
      const doc = rc && rc.documentNumber && rc.documentNumber.value;
      if (doc && !dedDoc.value && String(doc).replace(/\D/g, '') !== '00754419690') dedDoc.value = doc;
      if (rc && rc.name && !dedPrest.value) dedPrest.value = rc.name;
    });
  }

  const mostrar = () => {
    const ehGasto = comoSel.value === 'Gasto';
    blocoIR.hidden = !ehGasto;
    blocoNova.hidden = !ehGasto || catSel.value !== '__nova';
    if (!blocoNova.hidden) setTimeout(() => novaCat.focus(), 50);
    catSel.parentElement.hidden = !ehGasto;
    blocoRegra.hidden = !ehGasto || !catSel.value || catSel.value === '__nova' || !l.descricao;
    blocoComb.hidden = !ehGasto || Number(catSel.value) !== catId('Combustível');
    blocoInv.hidden = comoSel.value !== 'Investimento';
    blocoCxNova.hidden = cxSel.value !== '__nova';
  };
  catSel.onchange = mostrar; comoSel.onchange = mostrar;
  const ps = partesDe(l);

  const salvar = h('button', { class: 'btn', onclick: async () => {
    salvar.disabled = true;
    try {
      const sel = selecionados();
      if (!porCat && !sel.length) { salvar.disabled = false; toast('Marque pelo menos uma pessoa.'); return; }
      let cxId = null;
      if (comoSel.value === 'Investimento') {
        if (cxSel.value === '__nova') {
          if (cxNome.value.trim().length < 2) { salvar.disabled = false; toast('Dê um nome para a caixinha.'); return; }
          const nc = await sb.from('caixinhas').insert({ nome: cxNome.value.trim(), tipo: cxTipo.value, banco: l.banco }).select().single();
          if (nc.error) throw nc.error;
          cxId = nc.data.id;
        } else if (cxSel.value) cxId = Number(cxSel.value);
        else { salvar.disabled = false; toast('Escolha a caixinha.'); return; }
      }
      const upd = { caixinha_id: cxId, resgate: comoSel.value === 'Investimento' && resgate.checked, descricao: nome.value.trim() || l.descricao, conta_como: comoSel.value, pessoa_id: porCat ? l.pessoa_id : sel[0], observacao: obs.value.trim() || null,
        categoria_id: comoSel.value === 'Gasto' && catSel.value && catSel.value !== '__nova' ? Number(catSel.value) : null, atualizado_em: new Date().toISOString() };
      const ehDed = comoSel.value === 'Gasto' && dedChk.checked;
      const ded = { ded_tipo: ehDed ? dedTipo.value : null, ded_pessoa: ehDed ? dedPes.value : null,
        ded_prestador: ehDed ? (dedPrest.value.trim() || null) : null, ded_doc: ehDed ? (dedDoc.value.trim() || null) : null };
      Object.assign(upd, ded);
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
      // Mesma compra parcelada / mesma assinatura: aplica em toda a série
      let daSerie = 0;
      if (l.serie) { const rs = await sb.rpc('aplicar_serie', { p_id: l.id }); if (!rs.error) daSerie = rs.data || 0;
        await sb.from('lancamentos').update(ded).eq('serie', l.serie); }
      fecharSheet();
      await carregarCaixinhas(); await carregarMes(); render();
      const msgs = [];
      if (daSerie) msgs.push(`${daSerie} da mesma série`);
      if (extras) msgs.push(`${extras} com o mesmo nome`);
      toast(msgs.length ? `Salvo. Também atualizados: ${msgs.join(' e ')}.` : 'Salvo.');
    } catch (e) { salvar.disabled = false; toast('Não salvou: ' + erroMsg(e), 4000); }
  } }, 'Salvar');

  abrirSheet(
    h('h3', {}, l.descricao || l.tipo),
    h('div', { class: 'card', style: 'gap:6px' },
      h('div', { class: 'lin' }, h('span', {}, 'Valor'), h('span', { class: 'v' }, R(l.valor))),
      h('div', { class: 'lin' }, h('span', {}, l.total_parcelas > 1 ? 'Data da parcela' : 'Data'), h('span', {}, `${dataCurta(l.data_hora)} ${hora(l.data_hora)}`)),
      h('div', { class: 'lin' }, h('span', {}, 'Onde'), h('span', {}, `${l.banco || ''} ${l.final_cartao ? 'final ' + l.final_cartao : ''} · ${l.tipo || ''}`)),
      l.total_parcelas > 1 ? h('div', { class: 'lin' }, h('span', {}, 'Parcela'), h('span', {}, `${l.parcela}/${l.total_parcelas}`)) : null,
      l.total_parcelas > 1 && l.data_compra ? h('div', { class: 'lin' }, h('span', {}, 'Data da compra'), h('b', {}, dataCompra(l.data_compra))) : null,
      l.serie ? h('div', { class: 'nota', style: 'color:var(--verde);font-weight:600' }, l.serie.startsWith('rec:')
        ? 'Assinatura: o que você mudar aqui vale para todos os meses.' : 'Compra parcelada: o que você mudar aqui vale para todas as parcelas.') : null,
      l.previsto ? h('div', { class: 'nota' }, 'Previsto: ainda não caiu. Quando o lançamento real chegar, ele toma o lugar deste.') : null,
      h('div', { class: 'nota' }, l.conferido ? (l.aviso_id ? 'Conferido: veio pelo aviso e pelo banco.' : 'Veio pelo banco (Open Finance).')
        : 'Veio só pelo aviso do celular; o banco ainda não confirmou.')),
    h('label', { class: 'campo' }, generico ? 'Nome (o banco não informou a loja — escreva onde foi)' : 'Nome', nome),
    h('label', { class: 'campo' }, 'Entra como', comoSel),
    blocoInv,
    h('label', { class: 'campo' }, 'Categoria', catSel),
    blocoNova,
    blocoRegra,
    porCat ? h('div', { class: 'nota' }, 'Quem gastou está definido em cada parte da divisão.') : blocoQuem,
    blocoComb,
    h('label', { class: 'campo' }, 'Observação', obs),
    blocoIR,
    porCat ? h('div', { class: 'card', style: 'gap:6px' }, h('h2', {}, `Dividido em ${ps.length} partes`),
      ps.map((p) => h('div', { class: 'lin' }, h('span', {}, `${nomeCat(p.categoria_id)} · ${nomePessoa(p.pessoa_id || l.pessoa_id)}`), h('span', { class: 'v' }, R(p.valor))))) : null,
    h('div', { class: 'btns' }, salvar,
      comoSel.value === 'Gasto' ? h('button', { class: 'btn sec', onclick: () => abrirDivisao(l) }, porCat ? 'Editar divisão' : 'Dividir por categoria') : null));
  mostrar(); atualizaQuem();
}

async function abrirCaixinha(c) {
  const nova = !c;
  c = c || { nome: '', tipo: 'banco', saldo: 0, aportes: 0, resgates: 0, saldo_inicial: 0 };
  const nome = h('input', { value: c.nome, maxlength: '60', placeholder: 'ex.: Poupança, Consórcio do carro' });
  const tipo = h('select', {}, opcoes(TIPOS_CX, c.tipo));
  const saldoHoje = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', placeholder: 'ex.: 1500,00',
    value: c.saldo_banco == null && !nova ? Number(c.saldo).toFixed(2) : '' });
  const dolar = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: c.qtd_dolar ?? '', placeholder: 'ex.: 500' });
  const carta = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: c.valor_carta ?? '', placeholder: 'ex.: 80000' });
  const blocoDolar = h('label', { class: 'campo' }, 'Quantos dólares (US$)', dolar);
  const blocoCarta = h('label', { class: 'campo' }, 'Valor da carta do consórcio', carta);
  const ajusta = () => { blocoDolar.hidden = tipo.value !== 'dolar'; blocoCarta.hidden = tipo.value !== 'consorcio'; };
  tipo.onchange = ajusta;
  let hist = [];
  if (!nova) {
    const r = await sb.from('lancamentos').select('id, data_hora, valor, resgate, descricao').eq('caixinha_id', c.id).eq('conta_como', 'Investimento')
      .order('data_hora', { ascending: false }).limit(60);
    hist = r.data || [];
  }
  const salvar = h('button', { class: 'btn', onclick: async () => {
    if (nome.value.trim().length < 2) { toast('Dê um nome para a caixinha.'); return; }
    salvar.disabled = true;
    const dados = { nome: nome.value.trim(), tipo: tipo.value,
      qtd_dolar: tipo.value === 'dolar' && dolar.value ? Number(dolar.value) : null,
      valor_carta: tipo.value === 'consorcio' && carta.value ? Number(carta.value) : null };
    // "Saldo de hoje" vira o saldo inicial (o que já existia antes dos lançamentos anotados)
    if (saldoHoje.value !== '' && c.saldo_banco == null) dados.saldo_inicial = num(Number(saldoHoje.value) - Number(c.aportes || 0) + Number(c.resgates || 0));
    const r = nova ? await sb.from('caixinhas').insert(dados) : await sb.from('caixinhas').update(dados).eq('id', c.id);
    if (r.error) { salvar.disabled = false; toast(r.error.code === '23505' ? 'Já existe uma caixinha com esse nome.' : 'Não salvou: ' + erroMsg(r.error), 4000); return; }
    fecharSheet(); await carregarCaixinhas(); render(); toast('Caixinha salva.');
  } }, 'Salvar');
  abrirSheet(
    h('h3', {}, nova ? 'Nova caixinha' : c.nome),
    nova ? null : h('div', { class: 'card', style: 'gap:6px' },
      h('div', { class: 'lin' }, h('span', {}, 'Saldo'), h('span', { class: 'v' }, R(c.saldo))),
      h('div', { class: 'lin' }, h('span', {}, 'Aportes anotados'), h('span', {}, R(c.aportes))),
      h('div', { class: 'lin' }, h('span', {}, 'Resgates anotados'), h('span', {}, R(c.resgates))),
      c.saldo_banco != null ? h('div', { class: 'nota' }, `Saldo informado pelo banco ${haQuanto(c.saldo_banco_em)}.`) : null),
    h('label', { class: 'campo' }, 'Nome', nome),
    h('label', { class: 'campo' }, 'Tipo', tipo),
    c.saldo_banco == null ? h('label', { class: 'campo' }, 'Saldo de hoje (confira no app do banco)', saldoHoje) : null,
    c.saldo_banco == null ? h('div', { class: 'nota' }, 'Informe uma vez; daí em diante o app soma os aportes e desconta os resgates.') : null,
    blocoDolar, blocoCarta,
    h('div', { class: 'btns' }, salvar),
    hist.length ? h('div', { class: 'card', style: 'gap:6px' }, h('h2', {}, 'Histórico'),
      hist.map((x) => h('div', { class: 'lin' }, h('span', {}, `${dataCurta(x.data_hora)} · ${x.resgate ? 'Resgate' : 'Aporte'}`),
        h('span', { class: 'v', style: x.resgate ? 'color:var(--erro)' : 'color:var(--receita)' }, (x.resgate ? '− ' : '+ ') + R(x.valor))))) : null);
  ajusta();
}

function abrirDivisao(l) {
  const total = num(l.valor);
  let linhas = (divisaoPorCategoria(l) ? partesDe(l) : []).map((p) => ({ cat: p.categoria_id, pessoa: p.pessoa_id || l.pessoa_id, valor: Number(p.valor), obs: p.observacao || '', quem: p.nome_outro || '' }));
  if (!linhas.length) linhas = [{ cat: l.categoria_id, pessoa: l.pessoa_id, valor: total, obs: '' }, { cat: null, pessoa: l.pessoa_id, valor: 0, obs: '' }];
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
      const c = h('select', { 'aria-label': 'Categoria' }, opcoes(catsOrdem(), x.cat, 'Categoria…'));
      const p = h('select', { 'aria-label': 'Quem' }, opcoes(st.cad.pessoas.map((k) => [k.id, k.nome]), x.pessoa));
      const v = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: x.valor || '', 'aria-label': 'Valor' });
      const o = h('input', { type: 'text', value: x.obs || '', placeholder: 'Do que se trata (opcional)', 'aria-label': `Observação da parte ${i + 1}`, maxlength: '120' });
      c.onchange = () => { x.cat = c.value ? Number(c.value) : null; atualizar(); };
      p.onchange = () => { x.pessoa = p.value; desenhar(); };
      v.oninput = () => { x.valor = Number(String(v.value).replace(',', '.')) || 0; atualizar(); };
      const q = x.pessoa === 'outros' ? h('input', { type: 'text', value: x.quem || '', placeholder: 'Quem? ex.: sogra', 'aria-label': `Quem é o "Outros" da parte ${i + 1}`, maxlength: '60' }) : null;
      if (q) q.oninput = () => { x.quem = q.value; };
      o.oninput = () => { x.obs = o.value; };
      lista.append(h('div', { class: 'parte-card campo' },
        h('div', { class: 'parte-topo' }, h('b', {}, `Parte ${i + 1}`),
          h('button', { class: 'parte-x', 'aria-label': `Remover parte ${i + 1}`, onclick: () => { linhas.splice(i, 1); desenhar(); } }, '✕')),
        c, h('div', { class: 'grade2' }, p, v), q, o));
    });
    atualizar();
  };
  salvar.onclick = async () => {
    salvar.disabled = true;
    try {
      const d = await sb.from('partes').delete().eq('lancamento_id', l.id);
      if (d.error) throw d.error;
      const ins = await sb.from('partes').insert(linhas.map((x) => ({ lancamento_id: l.id, categoria_id: x.cat, pessoa_id: x.pessoa, valor: num(x.valor), observacao: (x.obs || '').trim() || null, nome_outro: x.pessoa === 'outros' ? ((x.quem || '').trim() || null) : null })));
      if (ins.error) throw ins.error;
      // A categoria da maior parte fica também no lançamento (assim nunca volta para "A categorizar")
      const maior = linhas.reduce((m, x) => (Number(x.valor) > Number(m.valor) ? x : m), linhas[0]);
      const up = await sb.from('lancamentos').update({ categoria_id: maior.cat }).eq('id', l.id);
      if (up.error) throw up.error;
      fecharSheet(); await carregarMes(); render(); toast('Divisão salva.');
    } catch (e) { salvar.disabled = false; toast('Não salvou: ' + erroMsg(e), 4000); }
  };
  abrirSheet(
    h('h3', {}, 'Dividir lançamento'),
    h('div', { class: 'lin' }, h('span', {}, l.descricao || l.tipo), h('span', { class: 'v' }, R(total))),
    lista,
    h('button', { class: 'btn sec', onclick: () => { linhas.push({ cat: null, pessoa: l.pessoa_id, valor: 0, obs: '' }); desenhar(); } }, '+ Adicionar parte'),
    h('div', { class: 'card' }, falta),
    h('div', { class: 'btns' }, salvar,
      divisaoPorCategoria(l) ? h('button', { class: 'btn perigo', onclick: async () => {
        await sb.from('partes').delete().eq('lancamento_id', l.id); fecharSheet(); await carregarMes(); render(); toast('Divisão desfeita.');
      } }, 'Desfazer divisão') : null));
  desenhar();
}

// ----- Compromissos mensais (salário da funcionária, escola, luz…) -----
async function abrirCompromisso(c) {
  const novo = !c;
  c = c || { nome: '', valor: '', dia: new Date().getDate(), categoria_id: null, pessoa_id: 'familia', conta_como: 'Gasto', varia: false, palavra: '', meses: null,
    inicio: `${st.mes.getFullYear()}-${String(st.mes.getMonth() + 1).padStart(2, '0')}-01` };
  const nome = h('input', { value: c.nome, placeholder: 'ex.: Salário da funcionária', maxlength: '60' });
  const valor = h('input', { type: 'number', inputmode: 'decimal', step: '0.01', value: c.valor || '' });
  const dia = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '31', value: c.dia });
  const como = h('select', {}, opcoes([['Gasto', 'Gasto (sai dinheiro)'], ['Receita', 'Entrada (entra dinheiro)']], c.conta_como));
  const cat = h('select', {}, opcoes(catsOrdem(), c.categoria_id, 'Escolha a categoria'));
  const quem = h('select', {}, opcoes(st.cad.pessoas.map((k) => [k.id, k.nome]), c.pessoa_id || 'familia'));
  const repete = h('select', {}, opcoes([['sempre', 'Todo mês, sem data para acabar'], ['meses', 'Por alguns meses']], c.meses ? 'meses' : 'sempre'));
  const meses = h('input', { type: 'number', inputmode: 'numeric', min: '1', max: '120', value: c.meses || '' });
  const inicio = h('input', { type: 'month', value: String(c.inicio).slice(0, 7) });
  const varia = h('input', { type: 'checkbox', checked: !!c.varia });
  const palavra = h('input', { value: c.palavra || '', placeholder: 'ex.: nome da funcionária, CEMIG, COPASA', maxlength: '40' });
  const campoMeses = h('label', { class: 'campo' }, 'Quantos meses', meses);
  const campoCat = h('label', { class: 'campo' }, 'Categoria', cat);
  const mostrar = () => { campoMeses.hidden = repete.value !== 'meses'; campoCat.hidden = como.value !== 'Gasto'; };
  repete.onchange = mostrar; como.onchange = mostrar;
  const salvar = h('button', { class: 'btn', onclick: async () => {
    const v = Number(String(valor.value).replace(',', '.')), d = Number(dia.value);
    if (nome.value.trim().length < 2) return toast('Escreva o nome do compromisso.');
    if (!(v > 0)) return toast('Informe o valor.');
    if (!(d >= 1 && d <= 31)) return toast('O dia tem que ser de 1 a 31.');
    if (como.value === 'Gasto' && !cat.value) return toast('Escolha a categoria.');
    if (repete.value === 'meses' && !(Number(meses.value) > 0)) return toast('Informe quantos meses.');
    const dados = { nome: nome.value.trim(), valor: v, dia: d, conta_como: como.value, categoria_id: como.value === 'Gasto' ? Number(cat.value) : null,
      pessoa_id: quem.value, varia: varia.checked, palavra: palavra.value.trim() || null, meses: repete.value === 'meses' ? Number(meses.value) : null,
      inicio: (inicio.value || String(c.inicio).slice(0, 7)) + '-01', ativo: true };
    salvar.disabled = true;
    try {
      const r = novo ? await sb.from('compromissos').insert(dados).select().single() : await sb.from('compromissos').update(dados).eq('id', c.id).select().single();
      if (r.error) throw r.error;
      const g = await sb.rpc('refazer_compromisso', { p_id: r.data.id });
      if (g.error) throw g.error;
      fecharSheet(); await carregarMes(); render();
      toast(g.data && g.data.pagos_reconhecidos ? 'Compromisso salvo. Já achei o pagamento deste mês.' : 'Compromisso salvo. Ele aparece como previsto nos próximos meses.', 4000);
    } catch (e) { salvar.disabled = false; toast('Não salvou: ' + erroMsg(e), 4000); }
  } }, 'Salvar');
  const encerrar = novo ? null : h('button', { class: 'btn perigo', onclick: async () => {
    const r = await sb.from('compromissos').update({ ativo: false }).eq('id', c.id);
    if (r.error) return toast('Não encerrou: ' + erroMsg(r.error), 4000);
    await sb.rpc('gerar_compromissos'); fecharSheet(); await carregarMes(); render(); toast('Compromisso encerrado. Os previstos futuros saíram.');
  } }, 'Encerrar compromisso');
  abrirSheet(
    h('h3', {}, novo ? 'Novo compromisso mensal' : 'Editar compromisso'),
    h('label', { class: 'campo' }, 'Nome', nome),
    h('div', { class: 'grade2' }, h('label', { class: 'campo' }, 'Valor (R$)', valor), h('label', { class: 'campo' }, 'Dia do mês', dia)),
    h('label', { class: 'campo' }, 'Entra como', como),
    campoCat,
    h('label', { class: 'campo' }, 'Quem', quem),
    h('div', { class: 'grade2' }, h('label', { class: 'campo' }, 'Repete', repete), h('label', { class: 'campo' }, 'Começa em', inicio)),
    campoMeses,
    h('label', { class: 'check' }, varia, 'O valor muda todo mês (luz, água…) — uso como estimativa'),
    h('label', { class: 'campo' }, 'Como aparece no banco (opcional, ajuda a reconhecer o pagamento)', palavra),
    h('div', { class: 'nota' }, 'Ele aparece como previsto em todos os meses. Quando o pagamento cair no banco (mesmo valor, perto do dia), o app troca o previsto pelo real sozinho. Se pagar em dinheiro, abra o previsto e toque em "Marcar como pago".'),
    h('div', { class: 'btns' }, salvar, encerrar));
  mostrar();
}

async function listaCompromissos() {
  const r = await sb.from('compromissos').select('*').order('ativo', { ascending: false }).order('dia');
  if (r.error) return toast('Não carregou: ' + erroMsg(r.error), 4000);
  const ativos = r.data.filter((c) => c.ativo);
  const total = (tipo) => ativos.filter((c) => c.conta_como === tipo).reduce((s, c) => s + Number(c.valor), 0);
  const lista = r.data.map((c) => h('button', { class: 'item' + (c.ativo ? '' : ' prev'), onclick: () => abrirCompromisso(c) },
    c.conta_como === 'Receita' ? bolinha(ICO_TIPO.Receita, 42) : bolinha(icoDe(nomeCat(c.categoria_id)), 42),
    h('div', { class: 'itemcorpo' },
      h('div', { class: 't' }, h('span', { class: 'n' }, c.nome), h('span', { class: 'v' + (c.conta_como === 'Receita' ? ' rec' : '') }, (c.varia ? '~ ' : '') + R(c.valor))),
      h('div', { class: 'd' }, `todo dia ${c.dia} · ${c.conta_como === 'Receita' ? 'Entrada' : nomeCat(c.categoria_id)} · ${nomePessoa(c.pessoa_id)}`
        + (c.meses ? ` · por ${c.meses} ${c.meses === 1 ? 'mês' : 'meses'}` : '') + (c.ativo ? '' : ' · encerrado')))));
  abrirSheet(
    h('h3', {}, 'Compromissos mensais'),
    ativos.length ? h('div', { class: 'card', style: 'gap:6px' },
      h('div', { class: 'lin' }, h('span', {}, 'Gastos fixos por mês'), h('span', { class: 'v' }, R(total('Gasto')))),
      total('Receita') ? h('div', { class: 'lin' }, h('span', {}, 'Entradas fixas por mês'), h('span', { class: 'v', style: 'color:var(--receita)' }, R(total('Receita')))) : null) : null,
    r.data.length ? lista : h('div', { class: 'vazio' }, 'Nenhum compromisso ainda.'),
    h('button', { class: 'btn', onclick: () => abrirCompromisso(null) }, '+ Compromisso mensal'));
}

function abrirPrevistoCompromisso(l) {
  const pagar = h('button', { class: 'btn', onclick: async () => {
    pagar.disabled = true;
    const agora = new Date();
    const mesmoMes = new Date(l.data_hora).getMonth() === agora.getMonth() && new Date(l.data_hora).getFullYear() === agora.getFullYear();
    const r = await sb.from('lancamentos').update({ previsto: false, tipo: 'Pago à parte', data_hora: mesmoMes ? agora.toISOString() : l.data_hora,
      atualizado_em: agora.toISOString() }).eq('id', l.id);
    if (r.error) { pagar.disabled = false; return toast('Não marcou: ' + erroMsg(r.error), 4000); }
    fecharSheet(); await carregarMes(); render(); toast('Marcado como pago.');
  } }, 'Marcar como pago');
  abrirSheet(
    h('h3', {}, l.descricao),
    h('div', { class: 'card', style: 'gap:6px' },
      h('div', { class: 'lin' }, h('span', {}, 'Valor'), h('span', { class: 'v' }, R(l.valor))),
      h('div', { class: 'lin' }, h('span', {}, 'Vence'), h('span', {}, dataCurta(l.data_hora))),
      h('div', { class: 'lin' }, h('span', {}, 'Categoria'), h('span', {}, l.conta_como === 'Receita' ? 'Entrada' : nomeCat(l.categoria_id))),
      h('div', { class: 'lin' }, h('span', {}, 'Quem'), h('span', {}, nomePessoa(l.pessoa_id))),
      h('div', { class: 'nota' }, 'Compromisso mensal previsto. Quando o pagamento cair no banco, ele toma o lugar deste sozinho. Pagou em dinheiro ou por fora? Toque em "Marcar como pago".')),
    h('div', { class: 'btns' }, pagar,
      h('button', { class: 'btn sec', onclick: async () => {
        const r = await sb.from('compromissos').select('*').eq('id', l.compromisso_id).single();
        if (r.error) return toast('Não abriu: ' + erroMsg(r.error), 4000);
        abrirCompromisso(r.data);
      } }, 'Editar compromisso')));
}

// ----- Análise: como estou indo, mês a mês, o que subiu/desceu, planilha -----
const Rmil = (v) => (Math.abs(v) >= 1000
  ? `R$ ${(v / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mil`
  : `R$ ${Math.round(v).toLocaleString('pt-BR')}`);
const R0 = (v) => `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
const chaveMes = (d) => `${d.getFullYear()}-${d.getMonth()}`;

async function dadosAnalise() {
  const de = addMes(st.mes, -5), ate = addMes(st.mes, 1);
  const k = `${de.toISOString()}|${st.lancs.length}`;
  if (st.analiseDados && st.analiseDados.k === k) return st.analiseDados;
  const { data, error } = await sb.from('lancamentos')
    .select('id, data_hora, valor, conta_como, categoria_id, pessoa_id, previsto, descricao, partes(categoria_id, pessoa_id, valor)')
    .gte('data_hora', de.toISOString()).lt('data_hora', ate.toISOString());
  if (error) throw error;
  const { data: prim } = await sb.from('lancamentos').select('data_hora').eq('previsto', false).order('data_hora').limit(1);
  st.analiseDados = { k, lancs: data, inicio: prim && prim[0] ? new Date(prim[0].data_hora) : null };
  return st.analiseDados;
}
/** Porções de gasto (respeita divisões) com data, categoria e pessoa. */
function porcoesAnalise(lancs, comPrevisto) {
  const out = [];
  for (const l of lancs) {
    if (l.conta_como !== 'Gasto' || (l.previsto && !comPrevisto)) continue;
    const d = new Date(l.data_hora);
    const ps = l.partes || [];
    if (ps.length) for (const p of ps) out.push({ d, l, valor: Number(p.valor), cat: p.categoria_id, pessoa: p.pessoa_id || l.pessoa_id });
    else out.push({ d, l, valor: Number(l.valor), cat: l.categoria_id, pessoa: l.pessoa_id });
  }
  return out;
}

async function telaAnalise(wrap) {
  const { lancs, inicio } = await dadosAnalise();
  if (st.analiseIR) return telaIR(wrap);
  if (st.analiseFin) return telaFinanciamento(wrap);
  if (st.analiseCat) return telaAnaliseCategoria(wrap, lancs, inicio);
  const hoje = new Date();
  const mesAtual = st.mes.getFullYear() === hoje.getFullYear() && st.mes.getMonth() === hoje.getMonth();
  const diaCorte = mesAtual ? hoje.getDate() : 31;
  wrap.append(h('div', { class: 'cab' }, h('h1', {}, 'Análise'), seletorMes(render),
    h('span', { class: 'sub' }, mesAtual ? `Até hoje, dia ${hoje.getDate()}` : 'Mês fechado')));
  const corpo = h('div', { class: 'corpo' });
  wrap.append(corpo);

  const reais = porcoesAnalise(lancs, false);
  const doMes = (arr, m) => arr.filter((x) => chaveMes(x.d) === chaveMes(m));
  const somaV = (arr) => arr.reduce((s, x) => s + x.valor, 0);
  const entradasMes = (m) => lancs.filter((l) => l.conta_como === 'Receita' && !l.previsto && chaveMes(new Date(l.data_hora)) === chaveMes(m))
    .reduce((s, l) => s + Number(l.valor), 0);

  // 1) Como estou indo
  const entrou = entradasMes(st.mes);
  const saiu = somaV(doMes(reais, st.mes));
  const prev = lancs.filter((l) => l.previsto && l.conta_como === 'Gasto' && chaveMes(new Date(l.data_hora)) === chaveMes(st.mes))
    .reduce((s, l) => s + Number(l.valor), 0);
  const fim = entrou - saiu - prev;
  const nivel = fim < 0 ? 'ver' : fim < entrou * 0.1 ? 'ama' : 'verde';
  const frase = { ver: mesAtual ? 'Atenção: no ritmo atual, o mês fecha no vermelho' : 'O mês fechou no vermelho',
    ama: mesAtual ? 'No limite: o mês deve fechar quase sem sobra' : 'O mês fechou quase sem sobra',
    verde: mesAtual ? 'Tudo bem: o mês deve fechar com sobra' : 'O mês fechou com sobra' }[nivel];
  const cor = { ver: 'var(--erro)', ama: 'var(--laranja)', verde: 'var(--receita)' }[nivel];
  const tot = Math.max(entrou, saiu + prev, 1);
  corpo.append(h('div', { class: 'card semaforo ' + nivel },
    h('div', { style: 'display:flex;align-items:center;gap:10px' }, h('span', { class: 'luz', style: `background:${cor}` }), h('b', { style: 'font-size:16px' }, frase)),
    h('div', { class: 'lin' }, h('span', {}, 'Entrou'), h('b', { style: 'color:var(--receita)' }, Rmil(entrou))),
    h('div', { class: 'lin' }, h('span', {}, 'Já saiu'), h('b', {}, Rmil(saiu))),
    prev ? h('div', { class: 'lin' }, h('span', {}, 'Ainda vai cair (parcelas e compromissos)'), h('b', {}, Rmil(prev))) : null,
    h('div', { class: 'lin total' }, h('b', {}, mesAtual ? 'Previsão do fim do mês' : 'Resultado do mês'), h('b', { style: `color:${fim < 0 ? 'var(--erro)' : 'var(--receita)'}` }, (fim < 0 ? '− ' : '+ ') + Rmil(Math.abs(fim)))),
    h('div', { class: 'barra-sem', role: 'img', 'aria-label': `Gasto ${Rmil(saiu)}, previsto ${Rmil(prev)}, entradas ${Rmil(entrou)}` },
      h('div', { style: `width:${(Math.min(saiu, tot) / tot) * 100}%;background:var(--verde)` }),
      h('div', { class: 'listra', style: `width:${(Math.min(prev, Math.max(tot - saiu, 0)) / tot) * 100}%` }),
      fim < 0 ? h('div', { style: `width:${(Math.min(-fim, tot) / tot) * 100}%;background:var(--erro)` }) : null),
    h('div', { class: 'nota' }, 'Azul: já gasto · listrado: previsto · vermelho: o que passa do que entrou. Entradas: só o que o app marca como entrada; transferências entre suas contas não contam.')));

  // 2) Mês a mês
  const meses = [];
  for (let i = 5; i >= 0; i--) { const m = addMes(st.mes, -i); if (!inicio || addMes(m, 1) > inicio) meses.push(m); }
  const serie = meses.map((m) => ({ m, g: somaV(doMes(reais, m)), e: entradasMes(m),
    p: chaveMes(m) === chaveMes(st.mes) ? prev : 0 }));
  const maxV = Math.max(1, ...serie.map((x) => Math.max(x.g + x.p, x.e)));
  const graf = h('div', { class: 'graf' });
  for (const x of serie) {
    graf.append(h('button', { class: 'gcol', onclick: async () => { st.mes = x.m; await carregarMes(); render(); },
      'aria-label': `${nomeMes(x.m)}: gasto ${Rmil(x.g)}, entrada ${Rmil(x.e)}` },
      h('div', { class: 'gbarras' },
        h('div', { class: 'gpilha' },
          x.p ? h('div', { class: 'listra', style: `height:${(x.p / maxV) * 140}px;border-radius:4px 4px 0 0` }) : null,
          h('div', { style: `height:${(x.g / maxV) * 140}px;background:var(--verde);border-radius:${x.p ? 0 : '4px 4px 0 0'}` })),
        h('div', { style: `height:${(x.e / maxV) * 140}px;background:var(--receita);border-radius:4px 4px 0 0;width:18px` })),
      h('b', { style: chaveMes(x.m) === chaveMes(st.mes) ? 'color:var(--verde)' : '' }, x.m.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')),
      h('span', {}, Rmil(x.g)), h('span', { style: 'color:var(--receita)' }, Rmil(x.e))));
  }
  corpo.append(h('div', { class: 'card' }, h('h2', {}, 'Gastos e entradas por mês'), graf,
    h('div', { class: 'nota' }, h('span', { class: 'leg', style: 'background:var(--verde)' }), ' Gasto  ', h('span', { class: 'leg', style: 'background:var(--receita)' }), ' Entrada',
      inicio ? ` · os dados começam em ${inicio.toLocaleDateString('pt-BR')}` : '', '. Toque num mês para abrir.')));

  // 3) O que subiu / desceu (até o mesmo dia)
  const ant = addMes(st.mes, -1);
  const corte = (arr) => arr.filter((x) => x.d.getDate() <= diaCorte);
  const agrupa = (arr, campo) => { const o = {}; for (const x of arr) { const c = x[campo] || 0; o[c] = (o[c] || 0) + x.valor; } return o; };
  const comparar = (campo, nomeDe, abrir) => {
    const a = agrupa(corte(doMes(reais, st.mes)), campo), b = agrupa(corte(doMes(reais, ant)), campo);
    const difs = [...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => ({ k, agora: a[k] || 0, antes: b[k] || 0, d: (a[k] || 0) - (b[k] || 0) }))
      .filter((x) => Math.abs(x.d) >= 1);
    const sub = difs.filter((x) => x.d > 0).sort((x, y) => y.d - x.d), des = difs.filter((x) => x.d < 0).sort((x, y) => x.d - y.d);
    const linha = (x) => h('button', { class: 'catlin', onclick: abrir ? () => abrir(x.k) : null },
      campo === 'cat' ? (x.k === '0' ? icoPend(36) : bolinha(icoDe(nomeCat(Number(x.k))), 36)) : null,
      h('div', { class: 'catcorpo', style: 'gap:2px' }, h('b', {}, nomeDe(x.k)), h('span', { class: 'd' }, `${R0(x.antes)} → ${R0(x.agora)}`)),
      h('b', { style: `color:${x.d > 0 ? 'var(--erro)' : 'var(--receita)'};white-space:nowrap` }, (x.d > 0 ? '+ ' : '− ') + R0(Math.abs(x.d))));
    return { sub, des, linha };
  };
  const nomeAnt = ant.toLocaleDateString('pt-BR', { month: 'long' });
  const cc = comparar('cat', (k) => (k === '0' ? 'A categorizar' : nomeCat(Number(k))), (k) => { if (k !== '0') { st.analiseCat = Number(k); render(); window.scrollTo(0, 0); } });
  const cardC = h('div', { class: 'card' }, h('h2', {}, `O que mudou em relação a ${nomeAnt}`),
    h('div', { class: 'nota', style: 'margin-top:-6px' }, mesAtual ? `Comparando até o mesmo dia (1 a ${diaCorte}). Toque para ver o gráfico da categoria.` : 'Mês inteiro contra mês inteiro. Toque para ver o gráfico da categoria.'));
  if (!cc.sub.length && !cc.des.length) cardC.append(h('div', { class: 'vazio' }, 'Sem dados do mês anterior para comparar.'));
  if (cc.sub.length) cardC.append(h('span', { class: 'rot-sub' }, 'SUBIU'), ...cc.sub.slice(0, 5).map(cc.linha));
  if (cc.des.length) cardC.append(h('span', { class: 'rot-des' }, 'DESCEU'), ...cc.des.slice(0, 5).map(cc.linha));
  corpo.append(cardC);

  // 4) Por pessoa
  const cp = comparar('pessoa', (k) => nomePessoa(k));
  const pessoas = [...cp.sub, ...cp.des].sort((a, b) => b.agora - a.agora);
  if (pessoas.length) corpo.append(h('div', { class: 'card' }, h('h2', {}, 'Por pessoa'),
    h('div', { class: 'nota', style: 'margin-top:-6px' }, `Mesmo comparativo com ${nomeAnt}, separado por quem gastou.`), pessoas.map(cp.linha)));

  // Financiamentos (só aparece para quem tem)
  if ((st.cad.fins || []).length) {
    const cf = h('div', { class: 'card' }, h('h2', {}, 'Financiamentos'));
    for (const f of st.cad.fins) cf.append(h('button', { class: 'catlin', onclick: () => { st.analiseFin = f.id; render(); window.scrollTo(0, 0); } },
      bolinha(icoDe('Moradia'), 36),
      h('div', { class: 'catcorpo', style: 'gap:2px' }, h('b', {}, f.nome), h('span', { class: 'd' }, `${f.pagas} de ${f.parcelas_total} parcelas · saldo ${Rmil(f.saldo)}`)),
      h('b', { style: 'white-space:nowrap' }, '›')));
    corpo.append(cf);
  }

  // Imposto de Renda (só aparece se algo foi marcado como dedutível no ano)
  try {
    const anoIR = st.mes.getFullYear(), itensIR = await dadosIR(anoIR);
    if (itensIR.length) {
      const tot = itensIR.reduce((s, x) => s + Number(x.valor), 0), sem = itensIR.filter((x) => !(x.comprovantes || []).length).length;
      corpo.append(h('button', { class: 'card fin-mini', onclick: () => { st.analiseIR = anoIR; render(); window.scrollTo(0, 0); } },
        h('div', { class: 'lin' }, h('h2', {}, `Imposto de Renda ${anoIR}`), h('span', { class: 'v' }, R(tot))),
        h('div', { class: 'nota' }, `${itensIR.length} gasto(s) dedutível(is)${sem ? ` · ${sem} sem comprovante` : ' · todos com comprovante'} · toque para ver`)));
    }
  } catch {}

  // 5) Planilha
  const btnPl = h('button', { class: 'btn sec', onclick: () => baixarPlanilha(btnPl) }, 'Baixar planilha (Excel)');
  corpo.append(h('div', { class: 'card' }, h('h2', {}, 'Planilha'), btnPl,
    h('div', { class: 'nota' }, 'Todos os lançamentos (desde o início) com data, data da compra, categoria, pessoa, banco, valor, observação e partes da divisão. Para analisar no computador.')));
}

// ----- Imposto de Renda -----
const TIPOS_IR = [['saude', 'Saúde (médico, dentista, exames, plano)'], ['educacao', 'Educação (escola, faculdade)'], ['previdencia', 'Previdência PGBL']];
const NOME_IR = { saude: 'saúde', educacao: 'educação', previdencia: 'previdência' };
/** Sugere "pode ser dedutível" (farmácia não entra: remédio de farmácia não é dedutível). */
function sugestaoIR(l) {
  if (l.conta_como !== 'Gasto') return null;
  const c = nomeCat(l.categoria_id) || '', d = (l.descricao || '').toLowerCase();
  if (/drog|farm[aá]c|raia|pacheco|pague menos|panvel|ara[uú]jo|venancio/.test(d)) return null;
  if (/educa/i.test(c) || /escola|col[eé]gio|faculdade|universidade|creche|ber[cç][aá]rio/.test(d)) return 'educacao';
  if (/m[eé]dic|cl[ií]nic|odonto|dentist|psic[oó]|hospital|laborat|exame|unimed|amil|hapvida|sulam[eé]rica|bradesco sa[uú]de|fisioter|fonoaud|nutricion|terapia|ortodon/.test(d)) return 'saude';
  if (/sa[uú]de/i.test(c)) return 'saude';
  return null;
}
async function abrirComprovante(caminho) {
  const r = await sb.storage.from('comprovantes').createSignedUrl(caminho, 600);
  if (r.error) return toast('Não abriu: ' + erroMsg(r.error), 4000);
  if (window.GastosAndroid) location.href = r.data.signedUrl; else window.open(r.data.signedUrl, '_blank');
}
/** Entrega um arquivo gerado: no Android abre um link temporário no navegador; no resto, baixa direto. */
async function entregarArquivo(blob, nome) {
  if (window.GastosAndroid) {
    const caminho = `${st.eu}/${Date.now()}-${nome}`;
    const up = await sb.storage.from('planilhas').upload(caminho, blob, { contentType: blob.type });
    if (up.error) throw up.error;
    const lk = await sb.storage.from('planilhas').createSignedUrl(caminho, 600, { download: nome });
    if (lk.error) throw lk.error;
    location.href = lk.data.signedUrl;
  } else {
    const a = h('a', { href: URL.createObjectURL(blob), download: nome }); document.body.append(a); a.click(); a.remove();
  }
}
async function carregarXLSX() {
  if (!window.XLSX) await new Promise((ok, erro) => { const sc = document.createElement('script'); sc.src = 'vendor/xlsx-0.18.5.min.js'; sc.onload = ok; sc.onerror = () => erro(new Error('não carregou o gerador')); document.head.append(sc); });
}
async function dadosIR(ano) {
  const de = new Date(ano, 0, 1).toISOString(), ate = new Date(ano + 1, 0, 1).toISOString();
  const r = await sb.from('lancamentos').select('id, data_hora, valor, descricao, ded_tipo, ded_pessoa, ded_prestador, ded_doc, comprovantes(id, caminho, nome)')
    .not('ded_tipo', 'is', null).eq('previsto', false).gte('data_hora', de).lt('data_hora', ate).order('data_hora');
  if (r.error) throw r.error;
  return r.data;
}

async function telaIR(wrap) {
  const ano = st.analiseIR;
  wrap.append(h('div', { class: 'cab' },
    h('button', { class: 'voltar', onclick: () => { st.analiseIR = null; render(); } }, '‹ Análise'),
    h('div', { class: 'mes' }, h('button', { 'aria-label': 'Ano anterior', onclick: () => { st.analiseIR--; render(); } }, '‹'),
      h('h1', { style: 'flex:1;text-align:center' }, `Imposto de Renda ${ano}`), h('button', { 'aria-label': 'Próximo ano', onclick: () => { st.analiseIR++; render(); } }, '›')),
    h('span', { class: 'sub' }, `Gastos dedutíveis de ${ano} (declaração de ${ano + 1})`)));
  const corpo = h('div', { class: 'corpo' });
  wrap.append(corpo);
  const itens = await dadosIR(ano);
  const pessoasIR = st.cad.pessoas.filter((p) => p.id !== 'outros' && p.id !== 'familia');
  const resumo = h('div', { class: 'card' }, h('h2', {}, 'Resumo'));
  if (!itens.length) resumo.append(h('div', { class: 'vazio' }, 'Nada marcado como dedutível neste ano. Abra um gasto (médico, escola…) e marque "Dedutível no Imposto de Renda".'));
  for (const [t, nomeT] of TIPOS_IR) {
    const doTipo = itens.filter((x) => x.ded_tipo === t);
    if (!doTipo.length) continue;
    resumo.append(h('div', { class: 'lin' }, h('b', {}, nomeT.split(' (')[0]), h('b', {}, R(doTipo.reduce((s, x) => s + Number(x.valor), 0)))));
    for (const p of pessoasIR) {
      const v = doTipo.filter((x) => x.ded_pessoa === p.id).reduce((s, x) => s + Number(x.valor), 0);
      if (v) resumo.append(h('div', { class: 'lin', style: 'padding-left:12px' }, h('span', {}, p.nome), h('span', { class: 'v' }, R(v))));
    }
  }
  const semNota = itens.filter((x) => !(x.comprovantes || []).length).length;
  if (semNota) resumo.append(h('div', { class: 'nota', style: 'color:var(--ambar);font-weight:700' }, `${semNota} gasto(s) ainda sem comprovante anexado.`));
  // Previdência PGBL e financiamento (informativo)
  const pgbl = (st.cad.caixinhas || []).filter((c) => /pgbl/i.test(c.nome));
  if (pgbl.length) {
    const r = await sb.from('lancamentos').select('valor').in('caixinha_id', pgbl.map((c) => c.id)).eq('previsto', false).eq('resgate', false)
      .gte('data_hora', new Date(ano, 0, 1).toISOString()).lt('data_hora', new Date(ano + 1, 0, 1).toISOString());
    const v = (r.data || []).reduce((s, x) => s + Number(x.valor), 0);
    if (v) resumo.append(h('div', { class: 'lin' }, h('span', {}, 'Contribuições PGBL (no app)'), h('span', { class: 'v' }, R(v))));
  }
  corpo.append(resumo);

  // Lista
  if (itens.length) {
    const lista = h('div', { class: 'card', style: 'gap:4px' }, h('h2', {}, 'Lançamentos'));
    for (const x of itens) lista.append(h('div', { class: 'ir-item' },
      h('div', { class: 'lin' }, h('b', {}, x.ded_prestador || x.descricao), h('b', {}, R(x.valor))),
      h('div', { class: 'd' }, `${dataCurta(x.data_hora)} · ${NOME_IR[x.ded_tipo]} · ${nomePessoa(x.ded_pessoa)}${x.ded_doc ? ' · ' + x.ded_doc : ' · sem CPF/CNPJ'}`),
      h('div', { class: 'anexos' }, (x.comprovantes || []).length
        ? x.comprovantes.map((c) => h('button', { class: 'anexo-nome', onclick: () => abrirComprovante(c.caminho) }, `📎 ${c.nome || 'comprovante'}`))
        : h('span', { class: 'd', style: 'color:var(--ambar)' }, 'sem comprovante'))));
    corpo.append(lista);
    const btn = h('button', { class: 'btn', onclick: async () => {
      btn.disabled = true; btn.textContent = 'Gerando…';
      try {
        await carregarXLSX();
        const linhas = [];
        for (const x of itens) {
          const links = [];
          for (const c of x.comprovantes || []) { const u = await sb.storage.from('comprovantes').createSignedUrl(c.caminho, 7 * 86400); if (!u.error) links.push(u.data.signedUrl); }
          linhas.push({ Data: new Date(x.data_hora), Tipo: NOME_IR[x.ded_tipo], 'Para quem': nomePessoa(x.ded_pessoa), 'Quem recebeu': x.ded_prestador || x.descricao,
            'CPF/CNPJ': x.ded_doc || '', Valor: Number(x.valor), 'Comprovante (link válido por 7 dias)': links.join(' ') });
        }
        const wb = XLSX.utils.book_new(); const ws = XLSX.utils.json_to_sheet(linhas, { cellDates: true, dateNF: 'dd/mm/yyyy' });
        ws['!cols'] = [11, 12, 12, 34, 20, 12, 60].map((w) => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, `IR ${ano}`);
        const bin = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: true });
        await entregarArquivo(new Blob([bin], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `imposto-de-renda-${ano}.xlsx`);
        toast('Planilha do IR pronta.');
      } catch (e) { toast('Não gerou: ' + erroMsg(e), 5000); }
      btn.disabled = false; btn.textContent = 'Baixar planilha do IR (com links dos comprovantes)';
    } }, 'Baixar planilha do IR (com links dos comprovantes)');
    corpo.append(btn);
  }
  corpo.append(h('div', { class: 'nota', style: 'padding:0 4px 12px' }, 'Saúde: médico, dentista, psicólogo, exames, hospital e plano de saúde são dedutíveis; remédio de farmácia não. Educação tem limite anual por pessoa. Confira as regras do ano com seu contador.'));
}

function telaFinanciamento(wrap) {
  const f = (st.cad.fins || []).find((x) => x.id === st.analiseFin);
  if (!f) { st.analiseFin = null; return telaAnalise(wrap); }
  const am = Number(f.amortizacao_mes) || 0, i = (Number(f.taxa_anual) || 0) / 1200;
  const pctPrazo = Math.round((f.pagas / f.parcelas_total) * 100);
  const pctDivida = f.original ? Math.round((1 - f.saldo / f.original) * 100) : null;
  wrap.append(h('div', { class: 'cab' },
    h('button', { class: 'voltar', onclick: () => { st.analiseFin = null; render(); } }, '‹ Análise'),
    h('h1', {}, f.nome),
    h('span', { class: 'sub' }, [f.banco, f.contrato ? `contrato ${f.contrato}` : null, f.sistema, f.taxa_anual ? `${String(f.taxa_anual).replace('.', ',')}% ao ano` : null].filter(Boolean).join(' · '))));
  const corpo = h('div', { class: 'corpo' });
  wrap.append(corpo);

  // Andamento
  corpo.append(h('div', { class: 'card' }, h('h2', {}, 'Andamento'),
    h('div', { class: 'lin' }, h('span', {}, 'Saldo devedor'), h('b', { style: 'font-size:18px' }, Rmil(f.saldo))),
    h('div', { class: 'barra' }, h('div', { style: `width:${pctPrazo}%;background:var(--verde)` })),
    h('div', { class: 'lin' }, h('span', {}, `${f.pagas} de ${f.parcelas_total} parcelas pagas`), h('b', {}, `${pctPrazo}% do prazo`)),
    h('div', { class: 'lin' }, h('span', {}, 'Faltam'), h('b', {}, `${f.faltam} parcelas · até ${nomeMes(f.ultima).toLowerCase()}`)),
    pctDivida != null ? h('div', { class: 'lin' }, h('span', {}, 'Da dívida já abatida'), h('b', {}, `${pctDivida}%`)) : null,
    h('div', { class: 'nota' }, `Posição do banco em ${new Date(f.saldo_em + 'T12:00:00').toLocaleDateString('pt-BR')}` +
      (f.pagos.length ? `, mais ${f.pagos.length} parcela(s) paga(s) depois, reconhecida(s) pelo app.` : '. O app atualiza sozinho quando cada parcela cai na conta.'))));

  // Próxima parcela: para onde vai o dinheiro
  const p = f.prox, tot = p.total || 1;
  corpo.append(h('div', { class: 'card' }, h('h2', {}, 'Para onde vai a próxima parcela'),
    h('div', { class: 'barra-sem', role: 'img', 'aria-label': `Abate a dívida ${R(p.amort)}, juros ${R(p.juros)}, seguro e taxa ${R(p.outros)}` },
      h('div', { style: `width:${(p.amort / tot) * 100}%;background:var(--receita)` }),
      h('div', { style: `width:${(p.juros / tot) * 100}%;background:var(--erro)` }),
      h('div', { style: `width:${(p.outros / tot) * 100}%;background:#8A8F9B` })),
    h('div', { class: 'lin' }, h('span', {}, h('span', { class: 'leg', style: 'background:var(--receita)' }), ' Abate a dívida'), h('b', {}, R(p.amort))),
    h('div', { class: 'lin' }, h('span', {}, h('span', { class: 'leg', style: 'background:var(--erro)' }), ' Juros'), h('b', {}, R(p.juros))),
    h('div', { class: 'lin' }, h('span', {}, h('span', { class: 'leg', style: 'background:#8A8F9B' }), ' Seguro e taxa'), h('b', {}, R(p.outros))),
    h('div', { class: 'lin total' }, h('span', {}, 'Parcela'), h('b', {}, R(p.total))),
    h('div', { class: 'nota' }, `De cada R$ 100 da parcela, R$ ${Math.round((p.amort / tot) * 100)} diminuem a dívida. Valores calculados; o boleto da Caixa é o oficial.`)));

  // Por ano
  const anos = [...(f.financiamento_anos || [])].sort((a, b) => b.ano - a.ano);
  if (anos.length) {
    const ca = h('div', { class: 'card' }, h('h2', {}, 'Por ano'));
    for (const a of anos) {
      const extra = f.pagos.filter((x) => new Date(x.data_hora).getFullYear() === a.ano);
      const totPago = Number(a.total_pago) + extra.reduce((s, x) => s + Number(x.valor), 0);
      ca.append(h('div', { class: 'ano-fin' },
        h('div', { class: 'lin' }, h('b', {}, String(a.ano) + (a.ate_mes && a.ate_mes < 12 && !extra.length ? ` (até ${['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'][a.ate_mes - 1]})` : '')), h('b', {}, `${Rmil(totPago)} pagos`)),
        h('div', { class: 'd' }, `Juros ${Rmil(Number(a.juros))} · abateu ${Rmil(Number(a.amortizacao))} · seguro e taxas ${Rmil(Number(a.seguros) + Number(a.taxas))}` +
          (a.saldo_fim ? ` · saldo ${Rmil(Number(a.saldo_fim))}` : '') + (a.estimado ? ' · estimado' : ''))));
    }
    ca.append(h('div', { class: 'nota' }, 'O ano fechado vem do extrato de Imposto de Renda da Caixa (útil na declaração).'));
    corpo.append(ca);
  }

  // Simulação de amortização extra
  const base = jurosRestantes(f.saldo, am, i);
  const valor = h('input', { type: 'number', inputmode: 'decimal', step: '100', placeholder: 'ex.: 10000', 'aria-label': 'Valor a amortizar' });
  const res = h('div', { class: 'sim-res' });
  const calc = () => {
    const v = Number(String(valor.value).replace(',', '.')) || 0;
    if (!(v > 0)) { res.replaceChildren(h('div', { class: 'nota' }, `Sem nada extra: faltam ${base.meses} parcelas e cerca de ${Rmil(base.juros)} de juros.`)); return; }
    const com = jurosRestantes(Math.max(0, f.saldo - v), am, i);
    res.replaceChildren(
      h('div', { class: 'lin' }, h('span', {}, 'Prazo cai'), h('b', { style: 'color:var(--receita)' }, `${base.meses - com.meses} parcelas`)),
      h('div', { class: 'lin' }, h('span', {}, 'Juros que deixa de pagar'), h('b', { style: 'color:var(--receita)' }, `cerca de ${Rmil(base.juros - com.juros)}`)),
      h('div', { class: 'nota' }, 'Conta aproximada (mantém a parcela e encurta o prazo). Não é recomendação: confirme as condições com a Caixa antes de decidir.'));
  };
  valor.oninput = calc;
  corpo.append(h('div', { class: 'card' }, h('h2', {}, 'E se eu amortizar um valor extra?'),
    h('label', { class: 'campo' }, 'Valor extra (R$)', valor), res));
  calc();
}

function telaAnaliseCategoria(wrap, lancs, inicio) {
  const cat = st.analiseCat;
  const reais = porcoesAnalise(lancs, false).filter((x) => x.cat === cat);
  const meses = [];
  for (let i = 5; i >= 0; i--) { const m = addMes(st.mes, -i); if (!inicio || addMes(m, 1) > inicio) meses.push(m); }
  const serie = meses.map((m) => ({ m, v: reais.filter((x) => chaveMes(x.d) === chaveMes(m)).reduce((s, x) => s + x.valor, 0) }));
  const comDado = serie.filter((x) => x.v > 0);
  const media = comDado.length ? comDado.reduce((s, x) => s + x.v, 0) / comDado.length : 0;
  const atual = serie[serie.length - 1].v;
  const maxV = Math.max(1, ...serie.map((x) => x.v), media);
  wrap.append(h('div', { class: 'cab' },
    h('button', { class: 'voltar', onclick: () => { st.analiseCat = null; render(); } }, '‹ Análise'),
    h('h1', {}, nomeCat(cat)),
    h('span', { class: 'sub' }, `Média por mês: ${R0(media)} · ${nomeMes(st.mes)}: ${R0(atual)}`)));
  const corpo = h('div', { class: 'corpo' });
  wrap.append(corpo);
  const graf = h('div', { class: 'graf', style: 'position:relative' },
    media ? h('div', { class: 'gmedia', style: `bottom:${(media / maxV) * 140 + 40}px` }) : null);
  for (const x of serie) graf.append(h('div', { class: 'gcol' },
    h('div', { class: 'gbarras' }, h('div', { style: `height:${(x.v / maxV) * 140}px;background:${icoDe(nomeCat(cat))[1]};border-radius:6px 6px 0 0;width:32px` })),
    h('b', {}, x.m.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')), h('span', {}, R0(x.v))));
  corpo.append(h('div', { class: 'card' }, h('h2', {}, 'Mês a mês'), graf,
    h('div', { class: 'nota' }, 'Linha laranja: média dos meses com gasto.', inicio ? ` Os dados começam em ${inicio.toLocaleDateString('pt-BR')}.` : '')));
  const doMes = reais.filter((x) => chaveMes(x.d) === chaveMes(st.mes)).sort((a, b) => b.valor - a.valor);
  const info = h('div', { class: 'card' }, h('h2', {}, `Em ${nomeMes(st.mes).toLowerCase()}`),
    h('div', { class: 'lin' }, h('span', {}, 'Total'), h('b', {}, R(atual))),
    h('div', { class: 'lin' }, h('span', {}, 'Lançamentos'), h('b', {}, String(new Set(doMes.map((x) => x.l.id)).size))),
    doMes[0] ? h('div', { class: 'lin' }, h('span', {}, `Maior: ${doMes[0].l.descricao || ''} (${dataCurta(doMes[0].l.data_hora)})`), h('b', {}, R(doMes[0].valor))) : null,
    media ? h('div', { class: 'lin' }, h('span', {}, 'Contra a média'), h('b', { style: `color:${atual > media ? 'var(--erro)' : 'var(--receita)'}` },
      `${atual > media ? '+' : '−'} ${Math.round(Math.abs(atual / media - 1) * 100)}%`)) : null,
    h('button', { class: 'btn sec', onclick: () => { st.filtroCat = cat; st.aba = 'lanc'; st.pessoa = 'todos'; st.soPendentes = false; render(); window.scrollTo(0, 0); } },
      `Ver os lançamentos de ${nomeCat(cat)}`));
  corpo.append(info);
}

async function baixarPlanilha(btn) {
  btn.disabled = true; btn.textContent = 'Gerando planilha…';
  try {
    if (!window.XLSX) await new Promise((ok, erro) => { const sc = document.createElement('script'); sc.src = 'vendor/xlsx-0.18.5.min.js'; sc.onload = ok; sc.onerror = () => erro(new Error('não carregou o gerador')); document.head.append(sc); });
    const todos = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await sb.from('lancamentos').select('*, partes(*)').eq('previsto', false).order('data_hora').range(de, de + 999);
      if (error) throw error;
      todos.push(...data); if (data.length < 1000) break;
    }
    const dt = (s) => (s ? new Date(s) : null);
    const linhas = todos.map((l) => ({
      Data: dt(l.data_hora), 'Data da compra': dt(l.data_compra), Descrição: l.descricao || l.tipo, 'Entra como': l.conta_como,
      Categoria: l.conta_como === 'Gasto' ? nomeCat(l.categoria_id) : '', Quem: nomePessoa(l.pessoa_id), Banco: l.banco || '',
      Cartão: l.final_cartao || '', Tipo: l.tipo || '', Parcela: l.total_parcelas > 1 ? `${l.parcela}/${l.total_parcelas}` : '',
      Valor: Number(l.valor), Observação: l.observacao || '', Origem: l.conferido ? (l.aviso_id ? 'aviso + banco' : 'banco') : 'só aviso',
    }));
    const partes = [];
    for (const l of todos) for (const p of l.partes || []) partes.push({ Data: dt(l.data_hora), Descrição: l.descricao || l.tipo,
      Categoria: nomeCat(p.categoria_id || l.categoria_id), Quem: nomePessoa(p.pessoa_id || l.pessoa_id) + (p.nome_outro ? ` (${p.nome_outro})` : ''),
      Valor: Number(p.valor), Observação: p.observacao || '' });
    const wb = XLSX.utils.book_new();
    const aba = (rows, nome, larg) => { const ws = XLSX.utils.json_to_sheet(rows, { cellDates: true, dateNF: 'dd/mm/yyyy' }); ws['!cols'] = larg.map((w) => ({ wch: w })); ws['!autofilter'] = { ref: ws['!ref'] }; XLSX.utils.book_append_sheet(wb, ws, nome); };
    aba(linhas, 'Lançamentos', [11, 13, 34, 12, 24, 14, 8, 7, 18, 8, 12, 30, 13]);
    aba(partes, 'Partes das divisões', [11, 34, 24, 20, 12, 30]);
    const bin = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: true });
    const nome = `gastos-${new Date().toLocaleDateString('sv-SE')}.xlsx`;
    const blob = new Blob([bin], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await entregarArquivo(blob, nome);
    toast('Planilha pronta.');
  } catch (e) { toast('Não gerou a planilha: ' + erroMsg(e), 5000); }
  btn.disabled = false; btn.textContent = 'Baixar planilha (Excel)';
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
      h('button', { class: 'btn sec', onclick: () => window.GastosAndroid.abrirLeitor() }, 'Abrir o leitor de avisos'),
      window.GastosAndroid.verificarAtualizacao ? h('button', { class: 'btn sec', onclick: () => window.GastosAndroid.verificarAtualizacao() },
        `Procurar atualização do app (versão instalada: ${window.GastosAndroid.versao ? window.GastosAndroid.versao() : '?'})`) : null);
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

// ---------- Compras ----------
const GRUPOS = ['Mercado', 'Limpeza', 'Higiene', 'Farmácia', 'Gabriel', 'Casa', 'Outros'];
const PALAVRAS = {
  Limpeza: ['desinfetante', 'saco de lixo', 'detergente', 'sabão', 'sabao', 'amaciante', 'água sanitária', 'agua sanitaria', 'esponja', 'multiuso', 'limpa', 'vassoura', 'rodo', 'pano', 'álcool', 'alcool', 'cloro', 'veja', 'lustra', 'inseticida'],
  Higiene: ['papel higiênico', 'papel higienico', 'pasta de dente', 'creme dental', 'escova', 'shampoo', 'xampu', 'condicionador', 'sabonete', 'desodorante', 'absorvente', 'fio dental', 'cotonete', 'barbear'],
  Farmácia: ['remédio', 'remedio', 'dipirona', 'paracetamol', 'vitamina', 'curativo', 'band-aid', 'termômetro', 'soro'],
  Gabriel: ['fralda', 'lenço umedecido', 'lenco umedecido', 'pomada', 'mamadeira', 'chupeta', 'leite em pó', 'leite em po', 'papinha', 'gabriel'],
  Casa: ['lâmpada', 'lampada', 'pilha', 'gás', 'gas ', 'filtro', 'tomada', 'extensão'],
};
const semAcento = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function grupoDe(nome) {
  const n = semAcento(nome);
  for (const [g, ps] of Object.entries(PALAVRAS)) if (ps.some((p) => n.includes(semAcento(p)))) return g;
  return 'Mercado';
}
const comp = { itens: [], membros: {}, sugest: [], canal: null, timer: null };
const hojeISO = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const nomeMembro = (uid) => comp.membros[uid] || '—';
const podeEditar = (it) => st.papel === 'completo' || it.criado_por === st.eu;

async function carregarCompras() {
  const [i, m, hist] = await Promise.all([
    sb.from('compras_itens').select('*').or(`comprado_em.is.null,comprado_em.gte.${hojeISO()}`).order('criado_em'),
    sb.from('membros').select('user_id, nome'),
    sb.from('compras_itens').select('nome').not('comprado_em', 'is', null).order('comprado_em', { ascending: false }).limit(400),
  ]);
  for (const x of [i, m, hist]) if (x.error) throw x.error;
  comp.itens = i.data; comp.em = Date.now();
  comp.membros = Object.fromEntries(m.data.map((x) => [x.user_id, x.nome]));
  const pend = new Set(comp.itens.filter((x) => !x.comprado_em).map((x) => semAcento(x.nome)));
  const cont = {};
  for (const x of hist.data) { const k = semAcento(x.nome); if (!pend.has(k)) (cont[k] = cont[k] || { n: 0, nome: x.nome }).n++; }
  comp.sugest = Object.values(cont).filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 6).map((x) => x.nome);
}

/** Atualiza a lista na hora quando outra pessoa mexe. */
function assinarCompras() {
  if (comp.canal) return;
  comp.canal = sb.channel('compras').on('postgres_changes', { event: '*', schema: 'public', table: 'compras_itens' }, () => {
    clearTimeout(comp.timer);
    comp.timer = setTimeout(async () => {
      if (st.papel === 'compras' || st.aba === 'compras') {
        if (!document.getElementById('sheet').hidden) return; // não atrapalha quem está editando
        await carregarCompras(); render();
      }
    }, 400);
  }).subscribe();
}

async function adicionarItens(texto) {
  const nomes = texto.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 30);
  if (!nomes.length) return false;
  const r = await sb.from('compras_itens').insert(nomes.map((n) => ({ nome: n.slice(0, 120), grupo: grupoDe(n), criado_por: st.eu })));
  if (r.error) { toast('Não adicionou: ' + erroMsg(r.error), 4000); return false; }
  await carregarCompras(); render();
  toast(nomes.length > 1 ? `${nomes.length} itens adicionados.` : 'Adicionado.');
  return true;
}

async function marcar(it, comprado) {
  const r = await sb.rpc('marcar_comprado', { item: it.id, comprado });
  if (r.error) { toast('Não deu: ' + erroMsg(r.error), 4000); return; }
  await carregarCompras(); render();
}

function linhaItem(it, grande) {
  const cb = h('input', { type: 'checkbox', checked: !!it.comprado_em, 'aria-label': `Comprado: ${it.nome}`,
    style: `width:${grande ? 26 : 22}px;height:${grande ? 26 : 22}px;accent-color:var(--verde);flex:none` });
  cb.onchange = () => marcar(it, cb.checked);
  const podeMarcar = st.papel === 'completo';
  const feito = !!it.comprado_em;
  const info = feito ? `${nomeMembro(it.comprado_por)}, ${hora(it.comprado_em)}` : nomeMembro(it.criado_por);
  const texto = h('button', { class: 'item-nome', disabled: !podeEditar(it), onclick: () => editarItem(it),
    style: `flex-grow:1;text-align:left;border:none;background:none;padding:6px 0;min-height:44px;font-size:${grande ? 17 : 16}px;${feito ? 'text-decoration:line-through;color:var(--suave)' : ''}` },
    it.nome, it.quantidade ? h('span', { class: 'nota' }, ` · ${it.quantidade}`) : null,
    it.observacao ? h('div', { class: 'nota' }, it.observacao) : null);
  return h('div', { style: 'display:flex;align-items:center;gap:12px;border-bottom:1px solid #EEF0ED' },
    podeMarcar ? cb : null, texto, h('span', { class: 'nota', style: 'white-space:nowrap' }, info));
}

function listaAgrupada(corpo, grande) {
  const pend = comp.itens.filter((x) => !x.comprado_em);
  const feitos = comp.itens.filter((x) => x.comprado_em);
  if (!pend.length) corpo.append(h('div', { class: 'vazio' }, 'Nada na lista. 🎉'));
  for (const g of GRUPOS) {
    const doGrupo = pend.filter((x) => (GRUPOS.includes(x.grupo) ? x.grupo : 'Outros') === g);
    if (!doGrupo.length) continue;
    corpo.append(h('div', { class: 'card', style: 'gap:0;padding:6px 14px' }, h('div', { class: 'dia', style: 'padding:8px 0 2px' }, g),
      doGrupo.map((it) => linhaItem(it, grande))));
  }
  if (feitos.length && st.papel === 'completo') {
    corpo.append(h('div', { class: 'card', style: 'gap:0;padding:6px 14px;opacity:.8' }, h('div', { class: 'dia', style: 'padding:8px 0 2px' }, 'Comprado hoje'),
      feitos.map((it) => linhaItem(it, grande))));
  }
}

function campoAdicionar(grande) {
  const inp = h('input', { placeholder: grande ? 'Escreva aqui: sabão em pó, esponja…' : 'Adicionar: leite, saco de lixo, detergente…',
    'aria-label': 'Itens para adicionar', enterkeyhint: 'done', style: grande ? 'min-height:52px;font-size:17px' : '' });
  const enviar = async () => { const ok = await adicionarItens(inp.value); if (ok) inp.value = ''; };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); enviar(); } });
  const btn = grande
    ? h('button', { class: 'btn', style: 'min-height:52px;font-size:17px', onclick: enviar }, 'Adicionar na lista')
    : h('button', { class: 'btn', 'aria-label': 'Adicionar', style: 'min-width:52px;font-size:20px', onclick: enviar }, '+');
  return { inp, btn };
}

async function telaCompras(wrap) {
  // Desenha na hora com o que já tem; se estiver velho, recarrega e redesenha uma vez
  if (!comp.em) await carregarCompras();
  else if (Date.now() - comp.em > 30000) setTimeout(async () => { await carregarCompras(); if (st.aba === 'compras') render(); }, 0);
  assinarCompras();
  const n = comp.itens.filter((x) => !x.comprado_em).length;
  const { inp, btn } = campoAdicionar(false);
  const cab = h('div', { class: 'cab' },
    h('div', { class: 'lin' }, h('h1', {}, 'Compras'), h('span', { class: 'sub' }, n ? `${n} para comprar` : 'lista vazia')),
    h('div', { style: 'display:flex;gap:8px' }, h('div', { class: 'campo', style: 'flex-grow:1' }, inp), btn));
  if (comp.sugest.length) {
    cab.append(h('div', { class: 'chips' }, h('span', { class: 'nota', style: 'align-self:center' }, 'Sempre compra:'),
      comp.sugest.map((s) => h('button', { class: 'chip', style: 'border-style:dashed;color:var(--verde);border-color:var(--verde)',
        onclick: () => adicionarItens(s) }, '+ ' + s))));
  }
  wrap.append(cab);
  const corpo = h('div', { class: 'corpo', style: 'gap:10px' });
  wrap.append(corpo);
  listaAgrupada(corpo, false);
  corpo.append(h('div', { class: 'nota', style: 'text-align:center' }, 'Toque no nome para editar. O quadradinho marca como comprado.'));
}

async function telaComprasSimples() {
  if (!comp.em || Date.now() - comp.em > 30000) await carregarCompras();
  assinarCompras();
  const app = document.getElementById('app');
  const wrap = h('div', { class: 'app', style: 'padding-bottom:24px' });
  const { inp, btn } = campoAdicionar(true);
  wrap.append(h('div', { class: 'hero' },
    h('span', { class: 'rotulo' }, `Olá, ${st.meuNome}`),
    h('span', { style: 'font-size:26px;font-weight:700' }, 'Lista de compras'),
    h('span', { class: 'rotulo' }, 'Da casa do Daniel e da Helene')));
  const corpo = h('div', { class: 'corpo' });
  corpo.append(h('div', { class: 'card' }, h('span', { style: 'font-size:15px;font-weight:600' }, 'Está faltando alguma coisa?'),
    h('div', { class: 'campo' }, inp), btn));
  listaAgrupada(corpo, true);
  corpo.append(h('div', { class: 'nota', style: 'text-align:center' }, 'Você pode editar ou apagar o que você mesma adicionou.'),
    h('button', { class: 'btn perigo', onclick: async () => { await sb.auth.signOut(); location.reload(); } }, 'Sair'));
  wrap.append(corpo);
  app.replaceChildren(wrap);
}

function editarItem(it) {
  if (!podeEditar(it)) return;
  const nome = h('input', { value: it.nome, maxlength: '120' });
  const qtd = h('input', { value: it.quantidade || '', placeholder: 'ex.: 2 pacotes' });
  const obs = h('input', { value: it.observacao || '', placeholder: 'ex.: marca, cor, tamanho' });
  const grupo = h('select', {}, opcoes(GRUPOS.map((g) => [g, g]), GRUPOS.includes(it.grupo) ? it.grupo : 'Outros'));
  const salvar = h('button', { class: 'btn', onclick: async () => {
    if (!nome.value.trim()) { toast('Escreva o nome do item.'); return; }
    salvar.disabled = true;
    const r = await sb.from('compras_itens').update({ nome: nome.value.trim(), quantidade: qtd.value.trim() || null,
      observacao: obs.value.trim() || null, grupo: grupo.value }).eq('id', it.id);
    if (r.error) { salvar.disabled = false; toast('Não salvou: ' + erroMsg(r.error), 4000); return; }
    fecharSheet(); await carregarCompras(); render(); toast('Salvo.');
  } }, 'Salvar');
  let confirmar = false;
  const apagar = h('button', { class: 'btn perigo', onclick: async () => {
    if (!confirmar) { confirmar = true; apagar.textContent = 'Toque de novo para apagar'; return; }
    const r = await sb.from('compras_itens').delete().eq('id', it.id);
    if (r.error) { toast('Não apagou: ' + erroMsg(r.error), 4000); return; }
    fecharSheet(); await carregarCompras(); render(); toast('Apagado.');
  } }, 'Apagar');
  abrirSheet(h('h3', {}, 'Editar item'),
    h('label', { class: 'campo' }, 'Item', nome),
    h('div', { class: 'grade2' }, h('label', { class: 'campo' }, 'Quantidade', qtd), h('label', { class: 'campo' }, 'Grupo', grupo)),
    h('label', { class: 'campo' }, 'Observação', obs),
    h('div', { class: 'nota' }, `Pedido por ${nomeMembro(it.criado_por)} em ${dataCurta(it.criado_em)} ${hora(it.criado_em)}`),
    h('div', { class: 'btns' }, salvar, apagar));
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
    h('h1', {}, 'Mutirão'),
    h('p', { class: 'lema' }, 'Juntos, a conta fecha.'),
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
  const { data: m } = await sb.from('membros').select('nome, papel').eq('user_id', data.session.user.id).maybeSingle();
  if (!m) {
    telaLogin('Seu login ainda não foi liberado. Fale com o Daniel.');
    await sb.auth.signOut();
    return;
  }
  st.eu = data.session.user.id; st.papel = m.papel; st.meuNome = m.nome;
  try {
    if (st.papel === 'compras') return await telaComprasSimples();
    await carregarCadastros();
    try { await sb.rpc('gerar_compromissos'); } catch {}
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
  if (st.cad && st.aba === 'analise' && st.analiseIR) { st.analiseIR = null; render(); return true; }
  if (st.cad && st.aba === 'analise' && st.analiseFin) { st.analiseFin = null; render(); return true; }
  if (st.cad && st.aba === 'analise' && st.analiseCat) { st.analiseCat = null; render(); return true; }
  if (st.cad && st.aba !== 'inicio') { st.aba = 'inicio'; render(); return true; }
  return false;
};
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  try {
    if (st.papel === 'compras') return await telaComprasSimples();
    if (st.cad) { await carregarMes(); render(); }
  } catch {}
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
// Deixa o supabase ler o link do e-mail antes de decidir a tela
setTimeout(iniciar, TIPO_LINK ? 400 : 0);
// Se em 20 s nada apareceu, mostra aviso em vez de tela branca
setTimeout(() => {
  const app = document.getElementById('app');
  if (app && !app.children.length) {
    app.replaceChildren(h('div', { class: 'login' }, h('h1', {}, 'O app está demorando para abrir'),
      h('p', { class: 'nota' }, 'Verifique a internet e tente de novo. Se continuar, avise o Daniel/Claude: "travou ao iniciar".'),
      h('button', { class: 'btn', onclick: () => location.reload() }, 'Tentar de novo'),
      h('button', { class: 'btn sec', onclick: async () => { try { localStorage.clear(); } catch {} location.reload(); } }, 'Entrar de novo (limpar login)')));
  }
}, 20000);
