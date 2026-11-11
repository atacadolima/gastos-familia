// Transforma transações da Pluggy no nosso formato e decide como cada uma entra.
import { ehTitular } from './regras.js';

const ultimos4 = (s) => { const d = String(s || '').replace(/\D/g, ''); return d.length >= 4 ? d.slice(-4) : ''; };

/** Quando o banco não manda os dados do Pix, o nome vem na descrição ("Pix enviado para FULANO"). */
function nomeDaDescricao(tx) {
  const d = String(tx.description || tx.descriptionRaw || '').trim();
  const m = /^Pix (?:enviado|recebido|transf\w*)(?: (?:para|de|p\/))?\s+(.+)$/i.exec(d);
  if (m) return m[1].trim();
  const pix = (tx.paymentData && tx.paymentData.paymentMethod === 'PIX') || tx.operationType === 'PIX';
  if (pix && /^[A-ZÀ-Ú][A-ZÀ-Ú .'-]{3,}$/.test(d)) return d; // só o nome em maiúsculas
  return '';
}

/** Transação da Pluggy -> linha de transacoes_banco */
export function converter(tx, conta, banco) {
  const saida = tx.type === 'DEBIT';
  const pd = tx.paymentData || {};
  const outro = saida ? pd.receiver : pd.payer;
  const cc = tx.creditCardMetadata || {};
  const merchant = tx.merchant ? (tx.merchant.businessName || tx.merchant.name) : '';
  return {
    id: tx.id,
    conta_id: conta.id,
    banco,
    data: tx.date,
    descricao: merchant || tx.description || tx.descriptionRaw || '',
    valor: Math.abs(Number(tx.amount)),
    sentido: saida ? 'saida' : 'entrada',
    conta_tipo: conta.type,
    final_cartao: ultimos4(cc.cardNumber) || null,
    parcela: cc.installmentNumber || null,
    total_parcelas: cc.totalInstallments || null,
    categoria_pluggy: tx.category || null,
    contraparte: (outro && outro.name) || nomeDaDescricao(tx) || null,
    bruto: tx,
  };
}

const ENTRE_CONTAS_TXT = /d[ée]bito autom[áa]tico .*(black|cart|fatura|visa|master|personnalit)|pgto\.? ?cart[aã]o|pgto\.? fat|pagamento (de )?fatura|pagto\.? ?fatura|pag fatura|fatura cart|pagamento recebido|pagamento efetuado|aplica[cç][aã]o|resgate|invest|cdb|poupan[cç]a/i;

/** Como uma transação do banco que não casou com nenhum aviso entra nas contas. */
export function contaComo(t) {
  if (t.contraparte && ehTitular(t.contraparte)) return 'Entre contas';
  if (ENTRE_CONTAS_TXT.test(t.descricao || '') || ENTRE_CONTAS_TXT.test((t.bruto && t.bruto.description) || '')) return 'Entre contas';
  if (t.sentido === 'entrada') return t.conta_tipo === 'CREDIT' ? 'Entre contas' : 'Receita';
  return 'Gasto';
}

export function tipoDe(t) {
  const m = t.bruto && t.bruto.paymentData && t.bruto.paymentData.paymentMethod;
  if (m === 'PIX' || (t.bruto && t.bruto.operationType === 'PIX')) return t.sentido === 'saida' ? 'Pix enviado' : 'Pix recebido';
  if (m === 'BOLETO') return 'Boleto pago';
  if (t.conta_tipo === 'CREDIT') return t.sentido === 'saida' ? 'Compra no crédito' : 'Crédito no cartão';
  return t.sentido === 'saida' ? 'Saída na conta' : 'Entrada na conta';
}

/** Sentido do dinheiro pelo tipo do aviso */
export function sentidoDoAviso(tipo) {
  return /recebido|Pagamento da fatura/i.test(tipo || '') ? 'entrada' : 'saida';
}

const DIA = 86400000;
/**
 * Escolhe, entre os lançamentos vindos de aviso ainda sem par, o que corresponde à transação.
 * Para compra parcelada, o aviso traz o valor cheio; o banco traz a parcela.
 */
export function acharPar(t, candidatos) {
  const totalParcelado = t.total_parcelas > 1
    ? Number((t.bruto && t.bruto.creditCardMetadata && t.bruto.creditCardMetadata.totalAmount) || t.valor * t.total_parcelas)
    : null;
  if (t.total_parcelas > 1 && t.parcela > 1) return null; // parcelas seguintes não têm aviso
  const dt = new Date((t.bruto && t.bruto.creditCardMetadata && t.bruto.creditCardMetadata.purchaseDate) || t.data).getTime();
  const ok = candidatos.filter((l) => {
    if (l.banco !== t.banco || l.transacao_banco_id) return false;
    if (sentidoDoAviso(l.tipo) !== t.sentido) return false;
    const v = Number(l.valor);
    const valorBate = Math.abs(v - t.valor) < 0.005 || (totalParcelado && Math.abs(v - totalParcelado) < 0.05);
    return valorBate && Math.abs(new Date(l.data_hora).getTime() - dt) <= 4 * DIA;
  });
  ok.sort((a, b) => {
    const fa = a.final_cartao && a.final_cartao === t.final_cartao ? 0 : 1;
    const fb = b.final_cartao && b.final_cartao === t.final_cartao ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return Math.abs(new Date(a.data_hora).getTime() - dt) - Math.abs(new Date(b.data_hora).getTime() - dt);
  });
  return ok[0] || null;
}
