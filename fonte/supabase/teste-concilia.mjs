import { converter, contaComo, acharPar } from './functions/_shared/concilia.js';
let f = 0; const ok = (c, m) => { if (!c) f++; console.log(c ? 'OK   ' : 'FALHA', m); };
const cartao = { id: 'acc-cc', type: 'CREDIT' }, conta = { id: 'acc-cc2', type: 'BANK' };
const aviso = [
  { id: 1, banco: 'Itaú', tipo: 'Compra no crédito', valor: '208.76', data_hora: '2026-11-10T09:34:00Z', final_cartao: '9523', transacao_banco_id: null },
  { id: 2, banco: 'Itaú', tipo: 'Compra no crédito', valor: '600.00', data_hora: '2026-11-05T15:00:00Z', final_cartao: '9523', transacao_banco_id: null },
  { id: 3, banco: 'C6', tipo: 'Pix recebido', valor: '6947.14', data_hora: '2026-11-09T18:41:00Z', final_cartao: null, transacao_banco_id: null },
];
const t1 = converter({ id: 'a', type: 'DEBIT', amount: 208.76, date: '2026-11-10T03:00:00Z', description: 'POSTO CONCEICAO', creditCardMetadata: { cardNumber: '9523' } }, cartao, 'Itaú');
ok(acharPar(t1, aviso)?.id === 1, 'compra no cartão casa com o SMS');
const t2 = converter({ id: 'b', type: 'DEBIT', amount: 200, date: '2026-11-06T03:00:00Z', description: 'LOJA X 1/3', creditCardMetadata: { installmentNumber: 1, totalInstallments: 3, totalAmount: 600, cardNumber: '9523' } }, cartao, 'Itaú');
ok(acharPar(t2, aviso)?.id === 2, 'parcela 1 casa com o aviso do valor cheio');
const t3 = converter({ id: 'c', type: 'DEBIT', amount: 200, date: '2026-12-06T03:00:00Z', description: 'LOJA X 2/3', creditCardMetadata: { installmentNumber: 2, totalInstallments: 3, totalAmount: 600 } }, cartao, 'Itaú');
ok(acharPar(t3, aviso) === null, 'parcela 2 não casa (vira lançamento do banco)');
const t4 = converter({ id: 'd', type: 'CREDIT', amount: 6947.14, date: '2026-11-09T03:00:00Z', description: 'PIX RECEBIDO', paymentData: { paymentMethod: 'PIX', payer: { name: 'PAULO ROBERTO' } } }, conta, 'C6');
ok(acharPar(t4, aviso)?.id === 3, 'Pix recebido casa');
const t5 = converter({ id: 'e', type: 'DEBIT', amount: 6900, date: '2026-11-09T03:00:00Z', description: 'PIX ENVIADO', paymentData: { paymentMethod: 'PIX', receiver: { name: 'DANIEL RIBEIRO DE LIMA' } } }, conta, 'C6');
ok(contaComo(t5) === 'Entre contas', 'Pix para o titular = entre contas');
const t6 = converter({ id: 'f', type: 'DEBIT', amount: 3210.55, date: '2026-11-09T03:00:00Z', description: 'PAGTO FATURA ITAU' }, conta, 'BB');
ok(contaComo(t6) === 'Entre contas', 'pagamento de fatura não conta como gasto');
const t7 = converter({ id: 'g', type: 'CREDIT', amount: 3210.55, date: '2026-11-09T03:00:00Z', description: 'PAGAMENTO EFETUADO' }, cartao, 'Itaú');
ok(contaComo(t7) === 'Entre contas', 'pagamento recebido no cartão = entre contas');
const t8 = converter({ id: 'h', type: 'DEBIT', amount: 55, date: '2026-11-09T03:00:00Z', description: 'PADARIA' }, conta, 'BB');
ok(contaComo(t8) === 'Gasto' && acharPar(t8, aviso) === null, 'débito sem aviso = gasto do banco');
console.log(f ? `FALHAS: ${f}` : 'TODOS OK'); process.exit(f);
