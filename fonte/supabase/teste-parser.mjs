import { ler, GASTO, RECEITA, ENTRE_CONTAS, DETALHE, ALERTA, NAO_ENTENDIDO, OUTRO } from './functions/_shared/parser.js';

let falhas = 0;
function caso(pacote, titulo, texto, contaComo, valor, campo, esperado) {
  const r = ler(pacote, titulo, texto, 2026);
  const ok = r.contaComo === contaComo && r.valor === valor && (!campo || r[campo] === esperado);
  if (!ok) falhas++;
  console.log(ok ? 'OK   ' : 'FALHA', '|', r.banco, '|', r.contaComo, '|', r.tipo, '|', r.valor, '|', r.descricao, '|', r.finalCartao, r.portador, '|', r.quando);
}
const c6 = 'com.c6bank.app', it = 'com.itau.pers', sms = 'com.google.android.apps.messaging';
// Textos reais capturados pelo leitor
caso(c6, 'Compra no crédito aprovada', 'Sua compra no cartão final 7201 no valor de R$ 26,90, dia 09/11/2026 às 21:30, em Google YouTube         SAO PAULO     BRA, foi aprovada.', GASTO, 26.9, 'quando', '2026-11-09T21:30:00-03:00');
caso(c6, 'Compra no crédito aprovada', 'Sua compra no cartão final 7201 no valor de R$ 9,99, dia 08/11/2026 às 22:07, em Google GOOGLE*ONE 14M  SAO PAULO     BRA, foi aprovada.', GASTO, 9.99, 'descricao', 'Google GOOGLE*ONE 14M SAO PAULO BRA');
caso(c6, 'Você enviou um Pix', 'Pix enviado no valor de R$ 6.900,00, para DANIEL RIBEIRO DE LIMA, CPF ***.544.196-**, em 09/11/2026.', ENTRE_CONTAS, 6900);
caso(c6, 'Você enviou um Pix', 'Pix enviado no valor de R$ 80,00, para HELENE ALVES FIGUEIREDO DE MENDONCA LIMA, CPF ***.453.446-**, em 09/11/2026.', GASTO, 80, 'descricao', 'HELENE ALVES FIGUEIREDO DE MENDONCA LIMA');
caso(c6, 'Você recebeu um Pix', 'Pix recebido no valor de R$ 6.947,14, de PAULO ROBERTO, CPF ***.990.596-**, em 09/11/2026.', RECEITA, 6947.14);
caso(it, 'Pix recebido', 'Você recebeu R$ 6.500,00 de DANIEL, CPF XXX.544.196-XX.', ENTRE_CONTAS, 6500);
caso(it, 'Tag Itaú: recarga aprovada', 'Debitamos R$ 50,00 do cartão cadastrado (final 9523) para manter sua Tag Itaú ativa e com saldo.', GASTO, 50, 'finalCartao', '9523');
caso(it, 'Você usou a Tag Itaú', 'O veículo TIX-3E23 realizou uma passagem de R$9,10 em NASCENTES DAS GERAIS no dia 16/10/2026 às 10:32', DETALHE, 9.1, 'placa', 'TIX-3E23');
caso(it, 'Seu pagamento foi feito', 'O boleto de R$ 15,00 para IRMANDADE DA SANTA CASA D foi pago. Confira no extrato', GASTO, 15);
caso(it, 'Assistente do Limite da Conta', 'Você entrou no Limite da Conta XXX74-7. Acompanhe quantos Dias sem Juros', ALERTA, 0);
caso(it, 'Seus dados foram compartilhados 👀', 'Traga também os seus dados do (a) PLUGGY BRASIL INSTITUICAO DE PAGAMENTO LTDA para cá', OUTRO, 0);
caso(sms, '29040', 'Compra aprovada no seu PERSON BLACK PONTOS final 9523 - POSTO CONCEICAO valor RS 208,76 em 10/11, as 06h34.', GASTO, 208.76, 'quando', '2026-11-10T06:34:00-03:00');
caso(sms, '29040', 'Compra aprovada no PERSON BLACK PONTOS p/ HELENE ALVES FIGUEIREDO - ELITE CALCADOS valor RS 189,90 em 06/11/2026 as 17h39.', GASTO, 189.9, 'portador', 'HELENE ALVES FIGUEIREDO');
caso(sms, '29040', 'Recebemos o pagamento no valor de RS 3.210,55 referente a fatura.', ENTRE_CONTAS, 3210.55);
caso(c6, 'Oferta', 'Aproveite cashback de R$ 20,00', NAO_ENTENDIDO, 0);
caso(sms, 'Mãe', 'Compra aprovada no seu X final 1111 - Y valor RS 10,00 em 08/11, as 12h42.', GASTO, 10, 'banco', '');
console.log(falhas ? `\nFALHAS: ${falhas}` : '\nTODOS OS CASOS OK');
process.exit(falhas);
