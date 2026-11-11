package br.lima.gastos;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Lê o texto de um aviso do banco e tira dele o lançamento. Sem dependência do Android, para poder testar. */
public final class Parser {

    /** Como o lançamento entra nas contas do app. */
    public static final String GASTO = "Gasto";
    public static final String RECEITA = "Receita";
    public static final String ENTRE_CONTAS = "Entre contas";
    public static final String DETALHE = "Detalhe";
    public static final String ALERTA = "Alerta";
    public static final String NAO_ENTENDIDO = "Não entendido";
    public static final String OUTRO = "Outro aviso";

    /** Final do cartão → de quem é. */
    public static final Map<String, String> CARTOES = new HashMap<>();
    static {
        CARTOES.put("2337", "Daniel (C6 físico)");
        CARTOES.put("7201", "Daniel (C6 virtual)");
        CARTOES.put("4668", "Helene (C6)");
        CARTOES.put("6421", "Gabriel (C6)");
        CARTOES.put("9523", "Daniel (Itaú)");
        CARTOES.put("8306", "Helene (Itaú)");
    }

    /** Primeiro nome do titular: Pix para/de alguém com esse nome é transferência entre contas próprias. */
    public static final String TITULAR = "DANIEL";

    public static final class Resultado {
        public String banco = "";
        public String tipo = "";
        public String contaComo = OUTRO;
        public long centavos = 0;
        public String finalCartao = "";
        public String pessoa = "";
        public String onde = "";
        public String quando = "";

        public String resumo() {
            StringBuilder sb = new StringBuilder();
            sb.append(tipo.isEmpty() ? contaComo : tipo);
            if (centavos > 0) sb.append(" · ").append(reais(centavos));
            if (!onde.isEmpty()) sb.append(" · ").append(onde);
            if (!pessoa.isEmpty()) sb.append(" · ").append(pessoa);
            return sb.toString();
        }
    }

    private static final int F = Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE | Pattern.DOTALL;
    private static final String VALOR = "R[$S]\\s*([\\d.]+,\\d{2})";

    // C6
    private static final Pattern C6_COMPRA = Pattern.compile(
            "cart[aã]o final (\\d{4}) no valor de " + VALOR + ", dia (\\d{2}/\\d{2}/\\d{4}) [àa]s (\\d{2}:\\d{2}), em (.+?), foi aprovada", F);
    private static final Pattern C6_PIX_ENV = Pattern.compile("Pix enviado no valor de " + VALOR + ", para (.+?)(?:, CPF|, CNPJ|\\.|$)", F);
    private static final Pattern C6_PIX_REC = Pattern.compile("Pix recebido no valor de " + VALOR + ", de (.+?)(?:, CPF|, CNPJ|\\.|$)", F);

    // Itaú
    private static final Pattern IT_PIX_REC = Pattern.compile("Voc[eê] recebeu " + VALOR + " de (.+?)(?:, CPF|, CNPJ|\\.|$)", F);
    private static final Pattern IT_PIX_ENV = Pattern.compile("(?:Voc[eê] (?:enviou|fez um Pix de)|Pix (?:enviado|realizado) de) " + VALOR + " (?:para|a) (.+?)(?:, CPF|, CNPJ|\\.|$)", F);
    private static final Pattern IT_BOLETO = Pattern.compile("boleto de " + VALOR + " para (.+?) foi pago", F);
    private static final Pattern IT_TAG_RECARGA = Pattern.compile("Debitamos " + VALOR + " do cart[aã]o cadastrado \\(final (\\d{4})\\)", F);
    private static final Pattern IT_TAG_PASSAGEM = Pattern.compile(
            "ve[ií]culo (\\S+) realizou uma passagem de " + VALOR + " em (.+?) no dia (\\d{2}/\\d{2}/\\d{4}) [àa]s (\\d{2}:\\d{2})", F);
    private static final Pattern IT_LIMITE = Pattern.compile("Limite da Conta", F);
    // Itaú por SMS (remetente 29040): "RS" no lugar de "R$"
    private static final Pattern IT_SMS_FINAL = Pattern.compile(
            "Compra aprovada no seu (.+?) final (\\d{4}) - (.+?) valor " + VALOR + " em (\\d{2}/\\d{2}(?:/\\d{4})?),? [àa]s (\\d{2})h(\\d{2})", F);
    private static final Pattern IT_SMS_ADICIONAL = Pattern.compile(
            "Compra aprovada no (.+?) p/ (.+?) - (.+?) valor " + VALOR + " em (\\d{2}/\\d{2}(?:/\\d{4})?),? [àa]s (\\d{2})h(\\d{2})", F);
    private static final Pattern IT_SMS_PAGTO = Pattern.compile("Recebemos o pagamento no valor de " + VALOR, F);
    /** Remetentes de SMS do Itaú. */
    public static final java.util.Set<String> SMS_ITAU = new java.util.HashSet<>(java.util.Arrays.asList("29040"));
    /** Nome do portador do adicional → de quem é. */
    public static final Map<String, String> PORTADORES = new HashMap<>();
    static { PORTADORES.put("HELENE", "Helene (Itaú)"); PORTADORES.put("DANIEL", "Daniel (Itaú)"); }

    // Compra no cartão Itaú (formato ainda não visto; tentativa genérica)
    private static final Pattern GEN_COMPRA = Pattern.compile(
            "compra.*?" + VALOR + ".*?(?:em|no estabelecimento) (.+?)(?:\\s+(?:aprovada|no cart[aã]o)|[.,]|$).*?final (\\d{4})", F);

    public static boolean ehAppDeSms(String pacote) {
        String p = pacote == null ? "" : pacote.toLowerCase(Locale.ROOT);
        return p.contains("messaging") || p.contains("mms") || p.contains(".sms");
    }

    /** Banco pelo app que notificou; para SMS, pelo remetente (título da notificação). */
    public static String banco(String pacote, String titulo) {
        String p = pacote == null ? "" : pacote.toLowerCase(Locale.ROOT);
        if (ehAppDeSms(p)) {
            String t = titulo == null ? "" : titulo.replaceAll("\\D", "");
            return SMS_ITAU.contains(t) ? "Itaú (SMS)" : "";
        }
        if (p.contains("c6")) return "C6";
        if (p.contains("itau") || p.contains("itaucard")) return "Itaú";
        if (p.startsWith("br.com.bb") || p.contains(".bb.") || p.contains("bancodobrasil") || p.contains("ourocard")) return "BB";
        if (p.contains("caixa")) return "Caixa";
        return "";
    }

    public static Resultado ler(String pacote, String titulo, String texto) {
        Resultado r = new Resultado();
        r.banco = banco(pacote, titulo);
        String t = ((titulo == null ? "" : titulo) + "\n" + (texto == null ? "" : texto)).replace(' ', ' ');
        Matcher m;

        if ((m = C6_COMPRA.matcher(t)).find()) {
            r.tipo = "Compra no crédito";
            r.contaComo = GASTO;
            r.finalCartao = m.group(1);
            r.centavos = centavos(m.group(2));
            r.quando = m.group(3) + " " + m.group(4);
            r.onde = limpa(m.group(5));
            r.pessoa = dono(r.finalCartao);
            if (t.toLowerCase(Locale.ROOT).contains("débito")) r.tipo = "Compra no débito";
            return r;
        }
        if ((m = C6_PIX_ENV.matcher(t)).find() || (m = IT_PIX_ENV.matcher(t)).find()) {
            r.tipo = "Pix enviado";
            r.centavos = centavos(m.group(1));
            r.onde = limpa(m.group(2));
            r.contaComo = ehTitular(r.onde) ? ENTRE_CONTAS : GASTO;
            return r;
        }
        if ((m = C6_PIX_REC.matcher(t)).find() || (m = IT_PIX_REC.matcher(t)).find()) {
            r.tipo = "Pix recebido";
            r.centavos = centavos(m.group(1));
            r.onde = limpa(m.group(2));
            r.contaComo = ehTitular(r.onde) ? ENTRE_CONTAS : RECEITA;
            return r;
        }
        if ((m = IT_BOLETO.matcher(t)).find()) {
            r.tipo = "Boleto pago";
            r.contaComo = GASTO;
            r.centavos = centavos(m.group(1));
            r.onde = limpa(m.group(2));
            return r;
        }
        if ((m = IT_TAG_RECARGA.matcher(t)).find()) {
            r.tipo = "Recarga da Tag";
            r.contaComo = GASTO;
            r.centavos = centavos(m.group(1));
            r.finalCartao = m.group(2);
            r.pessoa = dono(r.finalCartao);
            r.onde = "Tag Itaú";
            return r;
        }
        if ((m = IT_TAG_PASSAGEM.matcher(t)).find()) {
            r.tipo = "Passagem da Tag";
            r.contaComo = DETALHE; // o gasto já entrou na recarga
            r.pessoa = m.group(1).toUpperCase(Locale.ROOT);
            r.centavos = centavos(m.group(2));
            r.onde = limpa(m.group(3));
            r.quando = m.group(4) + " " + m.group(5);
            return r;
        }
        if ((m = IT_SMS_FINAL.matcher(t)).find()) {
            r.tipo = "Compra no crédito";
            r.contaComo = GASTO;
            r.finalCartao = m.group(2);
            r.pessoa = dono(r.finalCartao);
            r.onde = limpa(m.group(3));
            r.centavos = centavos(m.group(4));
            r.quando = comAno(m.group(5)) + " " + m.group(6) + ":" + m.group(7);
            return r;
        }
        if ((m = IT_SMS_ADICIONAL.matcher(t)).find()) {
            r.tipo = "Compra no crédito (adicional)";
            r.contaComo = GASTO;
            String portador = limpa(m.group(2)).toUpperCase(Locale.ROOT);
            String primeiro = portador.split(" ")[0];
            String d = PORTADORES.get(primeiro);
            r.pessoa = d != null ? d : portador;
            r.onde = limpa(m.group(3));
            r.centavos = centavos(m.group(4));
            r.quando = comAno(m.group(5)) + " " + m.group(6) + ":" + m.group(7);
            return r;
        }
        if ((m = IT_SMS_PAGTO.matcher(t)).find()) {
            r.tipo = "Pagamento da fatura";
            r.contaComo = ENTRE_CONTAS;
            r.centavos = centavos(m.group(1));
            return r;
        }
        if ((m = GEN_COMPRA.matcher(t)).find()) {
            r.tipo = "Compra no cartão";
            r.contaComo = GASTO;
            r.centavos = centavos(m.group(1));
            r.onde = limpa(m.group(2));
            r.finalCartao = m.group(3);
            r.pessoa = dono(r.finalCartao);
            return r;
        }
        if (IT_LIMITE.matcher(t).find()) {
            r.tipo = "Entrou no limite da conta";
            r.contaComo = ALERTA;
            return r;
        }
        // Tem valor em reais mas não reconhecemos o formato: precisa de ajuste.
        r.contaComo = (t.contains("R$") || t.matches("(?s).*\\bRS\\s*\\d.*")) ? NAO_ENTENDIDO : OUTRO;
        return r;
    }

    static String comAno(String data) {
        if (data.length() > 5) return data;
        return data + "/" + java.util.Calendar.getInstance().get(java.util.Calendar.YEAR);
    }

    static boolean ehTitular(String nome) {
        String n = nome.trim().toUpperCase(Locale.ROOT);
        return n.equals(TITULAR) || n.startsWith(TITULAR + " ");
    }

    static String dono(String fim) {
        String d = CARTOES.get(fim);
        return d == null ? "Cartão " + fim + " (sem dono)" : d;
    }

    static String limpa(String s) {
        return s.replaceAll("\\s+", " ").replaceAll("[\\s.,…]+$", "").trim();
    }

    static long centavos(String v) {
        String s = v.replace(".", "").replace(",", "");
        try { return Long.parseLong(s); } catch (NumberFormatException e) { return 0; }
    }

    public static String reais(long c) {
        long abs = Math.abs(c);
        String inteiro = String.format(Locale.ROOT, "%,d", abs / 100).replace(',', '.');
        return (c < 0 ? "-" : "") + "R$ " + inteiro + "," + String.format(Locale.ROOT, "%02d", abs % 100);
    }
}
