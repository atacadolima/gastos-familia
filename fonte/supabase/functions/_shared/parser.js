// Lê o texto de um aviso de banco e tira dele o lançamento.
// Mesma lógica do Parser.java do leitor Android, aqui no servidor para poder ajustar sem atualizar o APK.

export const GASTO = 'Gasto', RECEITA = 'Receita', ENTRE_CONTAS = 'Entre contas',
  DETALHE = 'Detalhe', ALERTA = 'Alerta', NAO_ENTENDIDO = 'Não entendido', OUTRO = 'Outro aviso';

// Primeiro nome do titular das contas: Pix de/para ele é transferência entre contas próprias.
export const TITULAR = 'DANIEL';
export const SMS_ITAU = new Set(['29040']);

const F = 'isu';
const VALOR = 'R[$S]\\s*([\\d.]+,\\d{2})';
const re = (s) => new RegExp(s, F);

const C6_COMPRA = re(`cart[aã]o final (\\d{4}) no valor de ${VALOR}, dia (\\d{2}/\\d{2}/\\d{4}) [àa]s (\\d{2}:\\d{2}), em (.+?), foi aprovada`);
const PIX_ENV = [
  re(`Pix enviado no valor de ${VALOR}, para (.+?)(?:, CPF|, CNPJ|\\.|$)`),
  re(`(?:Voc[eê] (?:enviou|fez um Pix de)|Pix (?:enviado|realizado) de) ${VALOR} (?:para|a) (.+?)(?:, CPF|, CNPJ|\\.|$)`),
];
const PIX_REC = [
  re(`Pix recebido no valor de ${VALOR}, de (.+?)(?:, CPF|, CNPJ|\\.|$)`),
  re(`Voc[eê] recebeu ${VALOR} de (.+?)(?:, CPF|, CNPJ|\\.|$)`),
];
const IT_BOLETO = re(`boleto de ${VALOR} para (.+?) foi pago`);
const IT_TAG_RECARGA = re(`Debitamos ${VALOR} do cart[aã]o cadastrado \\(final (\\d{4})\\)`);
const IT_TAG_PASSAGEM = re(`ve[ií]culo (\\S+) realizou uma passagem de ${VALOR} em (.+?) no dia (\\d{2}/\\d{2}/\\d{4}) [àa]s (\\d{2}:\\d{2})`);
const IT_SMS_FINAL = re(`Compra aprovada no seu (.+?) final (\\d{4}) - (.+?) valor ${VALOR} em (\\d{2}/\\d{2}(?:/\\d{4})?),? [àa]s (\\d{2})h(\\d{2})`);
const IT_SMS_ADICIONAL = re(`Compra aprovada no (.+?) p/ (.+?) - (.+?) valor ${VALOR} em (\\d{2}/\\d{2}(?:/\\d{4})?),? [àa]s (\\d{2})h(\\d{2})`);
const IT_SMS_PAGTO = re(`Recebemos o pagamento no valor de ${VALOR}`);
const GEN_COMPRA = re(`compra.*?${VALOR}.*?(?:em|no estabelecimento) (.+?)(?:\\s+(?:aprovada|no cart[aã]o)|[.,]|$).*?final (\\d{4})`);
const IT_LIMITE = re('Limite da Conta');
const LEMBRETE = re('vence hoje|vencimento (hoje|amanh[ãa])|fatura (fecha|vence)|lembrete');

export function ehAppDeSms(pacote) {
  const p = (pacote || '').toLowerCase();
  return p.includes('messaging') || p.includes('mms') || p.includes('.sms');
}

export function banco(pacote, titulo) {
  const p = (pacote || '').toLowerCase();
  if (ehAppDeSms(p)) {
    const t = (titulo || '').replace(/\D/g, '');
    return SMS_ITAU.has(t) ? 'Itaú' : '';
  }
  if (p.includes('c6')) return 'C6';
  if (p.includes('itau') || p.includes('itaucard')) return 'Itaú';
  if (p.startsWith('br.com.bb') || p.includes('.bb.') || p.includes('bancodobrasil') || p.includes('ourocard')) return 'BB';
  if (p.includes('caixa')) return 'Caixa';
  return '';
}

const limpa = (s) => s.replace(/\s+/g, ' ').replace(/[\s.,…]+$/, '').trim();
const valor = (v) => Number(v.replace(/\./g, '').replace(',', '.'));
const ehTitular = (nome) => {
  const n = nome.trim().toUpperCase();
  return n === TITULAR || n.startsWith(TITULAR + ' ');
};
const comAno = (d, ano) => (d.length > 5 ? d : `${d}/${ano}`);

/** data "dd/mm/aaaa" + "hh:mm" (horário de Brasília) -> ISO */
export function quandoISO(data, hora) {
  const [d, m, a] = data.split('/');
  return `${a}-${m}-${d}T${hora}:00-03:00`;
}

/**
 * @returns {{banco, tipo, contaComo, valor, finalCartao, portador, descricao, quando, placa}}
 * quando: ISO da operação, quando o aviso traz; senão null.
 */
export function ler(pacote, titulo, texto, anoAtual = new Date().getFullYear()) {
  const r = { banco: banco(pacote, titulo), tipo: '', contaComo: OUTRO, valor: 0,
    finalCartao: '', portador: '', descricao: '', quando: null, placa: '' };
  const t = `${titulo || ''}\n${texto || ''}`.replace(/ /g, ' ');
  let m;

  if ((m = C6_COMPRA.exec(t))) {
    return { ...r, tipo: /débito/i.test(t) ? 'Compra no débito' : 'Compra no crédito', contaComo: GASTO,
      finalCartao: m[1], valor: valor(m[2]), quando: quandoISO(m[3], m[4]), descricao: limpa(m[5]) };
  }
  for (const p of PIX_ENV) if ((m = p.exec(t))) {
    const d = limpa(m[2]);
    return { ...r, tipo: 'Pix enviado', valor: valor(m[1]), descricao: d, contaComo: ehTitular(d) ? ENTRE_CONTAS : GASTO };
  }
  for (const p of PIX_REC) if ((m = p.exec(t))) {
    const d = limpa(m[2]);
    return { ...r, tipo: 'Pix recebido', valor: valor(m[1]), descricao: d, contaComo: ehTitular(d) ? ENTRE_CONTAS : RECEITA };
  }
  if ((m = IT_BOLETO.exec(t))) {
    return { ...r, tipo: 'Boleto pago', contaComo: GASTO, valor: valor(m[1]), descricao: limpa(m[2]) };
  }
  if ((m = IT_TAG_RECARGA.exec(t))) {
    return { ...r, tipo: 'Recarga da Tag', contaComo: GASTO, valor: valor(m[1]), finalCartao: m[2], descricao: 'Tag Itaú' };
  }
  if ((m = IT_TAG_PASSAGEM.exec(t))) {
    return { ...r, tipo: 'Passagem da Tag', contaComo: DETALHE, placa: m[1].toUpperCase(), valor: valor(m[2]),
      descricao: limpa(m[3]), quando: quandoISO(m[4], m[5]) };
  }
  if ((m = IT_SMS_FINAL.exec(t))) {
    return { ...r, tipo: 'Compra no crédito', contaComo: GASTO, finalCartao: m[2], descricao: limpa(m[3]),
      valor: valor(m[4]), quando: quandoISO(comAno(m[5], anoAtual), `${m[6]}:${m[7]}`) };
  }
  if ((m = IT_SMS_ADICIONAL.exec(t))) {
    return { ...r, tipo: 'Compra no crédito (adicional)', contaComo: GASTO, portador: limpa(m[2]).toUpperCase(),
      descricao: limpa(m[3]), valor: valor(m[4]), quando: quandoISO(comAno(m[5], anoAtual), `${m[6]}:${m[7]}`) };
  }
  if ((m = IT_SMS_PAGTO.exec(t))) {
    return { ...r, tipo: 'Pagamento da fatura', contaComo: ENTRE_CONTAS, valor: valor(m[1]) };
  }
  if ((m = GEN_COMPRA.exec(t))) {
    return { ...r, tipo: 'Compra no cartão', contaComo: GASTO, valor: valor(m[1]), descricao: limpa(m[2]), finalCartao: m[3] };
  }
  if (IT_LIMITE.test(t)) return { ...r, tipo: 'Entrou no limite da conta', contaComo: ALERTA };
  if (LEMBRETE.test(t)) return { ...r, tipo: 'Lembrete de vencimento', contaComo: ALERTA };
  return { ...r, contaComo: /R\$|\bRS\s*\d/.test(t) ? NAO_ENTENDIDO : OUTRO };
}
