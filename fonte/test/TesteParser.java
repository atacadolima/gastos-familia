import br.lima.gastos.Parser;

public class TesteParser {
    static int falhas = 0;

    static void caso(String pacote, String titulo, String texto, String contaComo, long centavos, String esperaNoResumo) {
        Parser.Resultado r = Parser.ler(pacote, titulo, texto);
        boolean ok = r.contaComo.equals(contaComo) && r.centavos == centavos && r.resumo().contains(esperaNoResumo);
        if (!ok) falhas++;
        System.out.println((ok ? "OK   " : "FALHA") + " | " + r.banco + " | " + r.contaComo + " | " + r.resumo() + " | final=" + r.finalCartao + " | quando=" + r.quando);
    }

    public static void main(String[] a) {
        String c6 = "com.c6bank.app", it = "com.itau";
        caso(c6, "Compra no crédito aprovada",
                "Sua compra no cartão final 7201 no valor de R$ 26,90, dia 09/11/2026 às 21:30, em Google YouTube SAO PAULO BRA, foi aprovada.",
                Parser.GASTO, 2690, "Google YouTube SAO PAULO BRA");
        caso(c6, "Compra no crédito aprovada",
                "Sua compra no cartão final 4668 no valor de R$ 1.234,56, dia 08/11/2026 às 10:05, em PADARIA X, foi aprovada.",
                Parser.GASTO, 123456, "Helene");
        caso(c6, "Você enviou um Pix", "Pix enviado no valor de R$ 6.900,00, para DANIEL RIBEIRO DE LIMA, CPF ***.544.196-**",
                Parser.ENTRE_CONTAS, 690000, "DANIEL RIBEIRO DE LIMA");
        caso(c6, "Você enviou um Pix", "Pix enviado no valor de R$ 150,00, para MARIA SOUZA, CPF ***",
                Parser.GASTO, 15000, "MARIA SOUZA");
        caso(c6, "Você recebeu um Pix", "Pix recebido no valor de R$ 6.947,14, de PAULO ROBERTO, CPF ***",
                Parser.RECEITA, 694714, "PAULO ROBERTO");
        caso(it, "Tag Itaú: recarga aprovada",
                "Debitamos R$ 50,00 do cartão cadastrado (final 9523) para manter sua Tag Itaú ativa e com saldo.",
                Parser.GASTO, 5000, "Daniel (Itaú)");
        caso(it, "Você usou a Tag Itaú",
                "O veículo TIX-3E23 realizou uma passagem de R$9,10 em NASCENTES DAS GERAIS no dia 16/10/2026 às 10:32",
                Parser.DETALHE, 910, "NASCENTES DAS GERAIS");
        caso(it, "Pix recebido", "Você recebeu R$ 1.000,00 de DANIEL, CPF XXX.544.196-XX.",
                Parser.ENTRE_CONTAS, 100000, "DANIEL");
        caso(it, "Seu pagamento foi feito",
                "O boleto de R$ 15,00 para IRMANDADE DA SANTA CASA D foi pago. Confira no extrato",
                Parser.GASTO, 1500, "IRMANDADE DA SANTA CASA D");
        caso(it, "Assistente do Limite da Conta", "Você entrou no Limite da Conta XXX74-7.",
                Parser.ALERTA, 0, "limite");
        caso(c6, "Oferta especial", "Aproveite cashback de R$ 20,00 no seu aniversário",
                Parser.NAO_ENTENDIDO, 0, "");
        caso(c6, "Seu cartão chegou", "Desbloqueie agora pelo app",
                Parser.OUTRO, 0, "");
        String sms = "com.google.android.apps.messaging";
        caso(sms, "29040", "Compra aprovada no PERSON BLACK PONTOS p/ HELENE ALVES FIGUEIREDO - ELITE CALCADOS valor RS 189,90 em 06/11/2026 as 17h39.",
                Parser.GASTO, 18990, "Helene (Itaú)");
        caso(sms, "29040", "Compra aprovada no seu PERSON BLACK PONTOS final 9523 - 68119715 ROSEMEIRE DA valor RS 165,00 em 08/11, as 12h42.",
                Parser.GASTO, 16500, "68119715 ROSEMEIRE DA");
        caso(sms, "29040", "Recebemos o pagamento no valor de RS 3.210,55 referente a fatura.",
                Parser.ENTRE_CONTAS, 321055, "Pagamento da fatura");
        caso(sms, "Mãe", "Compra aprovada no seu X final 1111 - Y valor RS 10,00 em 08/11, as 12h42.",
                Parser.GASTO, 1000, "");
        System.out.println(falhas == 0 ? "\nTODOS OS CASOS OK" : "\nFALHAS: " + falhas);
        System.exit(falhas);
    }
}
