package br.lima.gastos;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public final class StatusActivity extends Activity {

    private static final int VERDE = 0xFF1F5C4A;
    private static final SimpleDateFormat FMT = new SimpleDateFormat("dd/MM HH:mm", new Locale("pt", "BR"));

    private List<Db.Aviso> itens = new ArrayList<>();
    private TextView status, resumo;
    private Button liberar;
    private BaseAdapter adapter;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(VERDE);

        ListView lista = new ListView(this);
        lista.setDivider(null);
        lista.setBackgroundColor(0xFFF4F5F3);
        lista.setPadding(0, 0, 0, dp(24));
        lista.setClipToPadding(false);

        LinearLayout topo = new LinearLayout(this);
        topo.setOrientation(LinearLayout.VERTICAL);

        LinearLayout barra = new LinearLayout(this);
        barra.setOrientation(LinearLayout.VERTICAL);
        barra.setBackgroundColor(VERDE);
        barra.setPadding(dp(16), dp(18), dp(16), dp(18));
        barra.addView(texto("Leitor de avisos", 20, Color.WHITE, true));
        barra.addView(texto(Config.NOME_DISPOSITIVO + " · manda só os avisos dos bancos", 13, 0xCCFFFFFF, false));
        topo.addView(barra, new LinearLayout.LayoutParams(-1, -2));
        LinearLayout corpo = new LinearLayout(this);
        corpo.setOrientation(LinearLayout.VERTICAL);
        corpo.setPadding(dp(12), dp(12), dp(12), 0);
        topo.addView(corpo, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout cartao = cartao();
        status = texto("", 15, 0xFF1B1B1B, true);
        cartao.addView(status);
        liberar = botao("Liberar leitura de avisos", true);
        liberar.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        cartao.addView(liberar);
        corpo.addView(cartao);

        LinearLayout cartao2 = cartao();
        resumo = texto("", 14, 0xFF1B1B1B, false);
        resumo.setLineSpacing(0, 1.25f);
        cartao2.addView(resumo);
        LinearLayout linha = new LinearLayout(this);
        linha.setPadding(0, dp(8), 0, 0);
        Button exportar = botao("Enviar para o Claude", true);
        exportar.setOnClickListener(v -> exportar());
        Button apps = botao("Apps que avisaram", false);
        apps.setOnClickListener(v -> mostrarApps());
        linha.addView(exportar, new LinearLayout.LayoutParams(0, -2, 1));
        View esp = new View(this);
        linha.addView(esp, new LinearLayout.LayoutParams(dp(8), 1));
        linha.addView(apps, new LinearLayout.LayoutParams(0, -2, 1));
        cartao2.addView(linha);
        Button apagar = botao("Apagar tudo", false);
        apagar.setOnClickListener(v -> new AlertDialog.Builder(this)
                .setMessage("Apagar todos os avisos capturados?")
                .setPositiveButton("Apagar", (d, w) -> { Db.get(this).apagarTudo(); atualizar(); })
                .setNegativeButton("Cancelar", null).show());
        cartao2.addView(apagar);
        corpo.addView(cartao2);

        TextView cab = texto("Avisos capturados", 13, 0xFF5F6360, true);
        cab.setPadding(dp(4), dp(8), 0, dp(6));
        corpo.addView(cab);

        lista.addHeaderView(topo, null, false);
        adapter = new Adaptador();
        lista.setAdapter(adapter);
        lista.setOnItemClickListener((p, v, pos, id) -> {
            int i = pos - lista.getHeaderViewsCount();
            if (i >= 0 && i < itens.size()) detalhe(itens.get(i));
        });
        setContentView(lista);
    }

    @Override protected void onResume() {
        super.onResume();
        Leitor.aoMudar = this::atualizar;
        Enviador.enviarAgora(this);
        if (acessoLiberado()) {
            try { NotificationListenerService.requestRebind(new ComponentName(this, Leitor.class)); } catch (Exception ignored) { }
        }
        atualizar();
    }

    @Override protected void onPause() {
        super.onPause();
        Leitor.aoMudar = null;
    }

    private boolean acessoLiberado() {
        String s = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return s != null && s.contains(new ComponentName(this, Leitor.class).flattenToString());
    }

    private void atualizar() {
        boolean ok = acessoLiberado();
        status.setText(ok ? "✅ Leitura de avisos ligada" : "⚠️ Leitura de avisos desligada");
        status.setTextColor(ok ? VERDE : 0xFF9A3B00);
        liberar.setVisibility(ok ? View.GONE : View.VISIBLE);

        itens = Db.get(this).avisos();
        Calendar c = Calendar.getInstance();
        int mes = c.get(Calendar.MONTH), ano = c.get(Calendar.YEAR);
        long gastoMes = 0;
        int entendidos = 0, naoEntendidos = 0;
        for (Db.Aviso a : itens) {
            c.setTimeInMillis(a.recebidoEm);
            String cc = a.lido.contaComo;
            if (cc.equals(Parser.NAO_ENTENDIDO)) naoEntendidos++;
            else if (!cc.equals(Parser.OUTRO)) entendidos++;
            if (cc.equals(Parser.GASTO) && c.get(Calendar.MONTH) == mes && c.get(Calendar.YEAR) == ano) gastoMes += a.lido.centavos;
        }
        resumo.setText("Avisos capturados: " + itens.size()
                + "\nEntendidos: " + entendidos
                + "\nNão entendidos: " + naoEntendidos
                + "\nGastos deste mês (só o que chegou por aviso): " + Parser.reais(gastoMes)
                + "\n\nAguardando envio: " + Db.get(this).qtdPendentes()
                + (Enviador.ultimoStatus.isEmpty() ? "" : "\nÚltimo envio: " + Enviador.ultimoStatus
                   + (Enviador.ultimoEnvioOk > 0 ? " às " + new SimpleDateFormat("HH:mm", Locale.ROOT).format(new Date(Enviador.ultimoEnvioOk)) : "")));
        adapter.notifyDataSetChanged();
    }

    private void detalhe(Db.Aviso a) {
        Parser.Resultado r = a.lido;
        StringBuilder sb = new StringBuilder();
        sb.append("Banco: ").append(vazio(r.banco)).append('\n')
          .append("Tipo: ").append(vazio(r.tipo)).append('\n')
          .append("Entra como: ").append(r.contaComo).append('\n');
        if (r.centavos > 0) sb.append("Valor: ").append(Parser.reais(r.centavos)).append('\n');
        if (!r.finalCartao.isEmpty()) sb.append("Final do cartão: ").append(r.finalCartao).append('\n');
        if (!r.pessoa.isEmpty()) sb.append("Quem / placa: ").append(r.pessoa).append('\n');
        if (!r.onde.isEmpty()) sb.append("Onde / com quem: ").append(r.onde).append('\n');
        if (!r.quando.isEmpty()) sb.append("Data da operação: ").append(r.quando).append('\n');
        sb.append("Recebido em: ").append(FMT.format(new Date(a.recebidoEm))).append('\n')
          .append("App: ").append(a.pacote).append("\n\nTexto original:\n")
          .append(a.titulo).append('\n').append(a.texto);
        new AlertDialog.Builder(this).setTitle("Detalhe do aviso").setMessage(sb).setPositiveButton("OK", null).show();
    }

    private void mostrarApps() {
        StringBuilder sb = new StringBuilder("Apps que mandaram notificação desde que a leitura foi ligada (só o nome do app):\n\n");
        for (String[] p : Db.get(this).pacotes()) {
            String b = Parser.banco(p[0], "");
            sb.append(b.isEmpty() ? "  " : "★ ").append(p[0]).append(" (").append(p[1]).append("x)\n");
        }
        sb.append("\n★ = lido pelo app. SMS: só a conversa do 29040 (Itaú).");
        new AlertDialog.Builder(this).setTitle("Apps que avisaram").setMessage(sb).setPositiveButton("OK", null).show();
    }

    private void exportar() {
        if (itens.isEmpty()) {
            new AlertDialog.Builder(this).setMessage("Ainda não há avisos capturados.").setPositiveButton("OK", null).show();
            return;
        }
        StringBuilder sb = new StringBuilder("GASTOS TESTE · avisos capturados\n");
        for (Db.Aviso a : itens) {
            sb.append("\n--- ").append(FMT.format(new Date(a.recebidoEm))).append(" | ").append(a.pacote)
              .append("\nLIDO: ").append(a.lido.contaComo).append(" | ").append(a.lido.resumo())
              .append(" | final ").append(vazio(a.lido.finalCartao)).append(" | data ").append(vazio(a.lido.quando))
              .append("\nTEXTO: ").append(a.titulo).append(" / ").append(a.texto.replace('\n', ' ')).append('\n');
        }
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType("text/plain");
        i.putExtra(Intent.EXTRA_SUBJECT, "Gastos teste");
        i.putExtra(Intent.EXTRA_TEXT, sb.toString());
        startActivity(Intent.createChooser(i, "Enviar avisos capturados"));
    }

    private final class Adaptador extends BaseAdapter {
        @Override public int getCount() { return itens.size(); }
        @Override public Object getItem(int i) { return itens.get(i); }
        @Override public long getItemId(int i) { return itens.get(i).id; }

        @Override public View getView(int i, View v, ViewGroup parent) {
            Linha h;
            if (v == null) {
                h = new Linha();
                LinearLayout fora = new LinearLayout(StatusActivity.this);
                fora.setPadding(dp(12), 0, dp(12), dp(10));
                LinearLayout l = cartao();
                fora.addView(l, new LinearLayout.LayoutParams(-1, -2));
                l.setPadding(dp(14), dp(12), dp(14), dp(12));
                LinearLayout cima = new LinearLayout(StatusActivity.this);
                cima.setGravity(Gravity.CENTER_VERTICAL);
                h.etiqueta = texto("", 11, Color.WHITE, true);
                h.etiqueta.setPadding(dp(8), dp(2), dp(8), dp(2));
                h.valor = texto("", 16, 0xFF1B1B1B, true);
                h.valor.setGravity(Gravity.END);
                cima.addView(h.etiqueta);
                cima.addView(h.valor, new LinearLayout.LayoutParams(0, -2, 1));
                l.addView(cima);
                h.titulo = texto("", 15, 0xFF1B1B1B, false);
                h.titulo.setPadding(0, dp(6), 0, 0);
                h.titulo.setMaxLines(2);
                h.titulo.setEllipsize(TextUtils.TruncateAt.END);
                l.addView(h.titulo);
                h.rodape = texto("", 12, 0xFF6B706C, false);
                h.rodape.setPadding(0, dp(4), 0, 0);
                l.addView(h.rodape);
                fora.setTag(h);
                v = fora;
            } else h = (Linha) v.getTag();

            Db.Aviso a = itens.get(i);
            Parser.Resultado r = a.lido;
            h.etiqueta.setText(r.contaComo);
            GradientDrawable g = new GradientDrawable();
            g.setCornerRadius(dp(10));
            g.setColor(cor(r.contaComo));
            h.etiqueta.setBackground(g);
            h.valor.setText(r.centavos > 0 ? Parser.reais(r.centavos) : "");
            h.valor.setTextColor(r.contaComo.equals(Parser.RECEITA) ? 0xFF1E7A3E : 0xFF1B1B1B);
            String tit = !r.onde.isEmpty() ? r.onde : (!r.tipo.isEmpty() ? r.tipo : a.titulo);
            h.titulo.setText(r.contaComo.equals(Parser.NAO_ENTENDIDO) || r.contaComo.equals(Parser.OUTRO)
                    ? a.titulo + " — " + a.texto : tit);
            String quem = r.pessoa.isEmpty() ? "" : " · " + r.pessoa;
            h.rodape.setText(vazio(r.banco) + " · " + vazio(r.tipo) + quem + " · " + FMT.format(new Date(a.recebidoEm)));
            return v;
        }
    }

    private static final class Linha { TextView etiqueta, valor, titulo, rodape; }

    private static int cor(String contaComo) {
        switch (contaComo) {
            case Parser.GASTO: return 0xFFB3261E;
            case Parser.RECEITA: return 0xFF1E7A3E;
            case Parser.ENTRE_CONTAS: return 0xFF4A6072;
            case Parser.DETALHE: return 0xFF7A7F7C;
            case Parser.ALERTA: return 0xFF9A6700;
            case Parser.NAO_ENTENDIDO: return 0xFF7B2E8E;
            default: return 0xFFA9ADAA;
        }
    }

    private static String vazio(String s) { return s == null || s.isEmpty() ? "—" : s; }

    private LinearLayout cartao() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setPadding(dp(16), dp(14), dp(16), dp(14));
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.WHITE);
        g.setCornerRadius(dp(14));
        l.setBackground(g);
        l.setElevation(dp(1));
        return withMargin(l);
    }

    private LinearLayout withMargin(LinearLayout l) {
        // Dentro de LinearLayout usamos margem; na ListView o espaçamento vem do padding superior.
        l.setLayoutParams(new LinearLayout.LayoutParams(-1, -2));
        ((LinearLayout.LayoutParams) l.getLayoutParams()).setMargins(0, 0, 0, dp(10));
        return l;
    }

    private Button botao(String t, boolean principal) {
        Button b = new Button(this);
        b.setText(t);
        b.setAllCaps(false);
        b.setTextSize(14);
        b.setTextColor(principal ? Color.WHITE : VERDE);
        GradientDrawable g = new GradientDrawable();
        g.setCornerRadius(dp(10));
        if (principal) g.setColor(VERDE); else { g.setColor(Color.WHITE); g.setStroke(dp(1), VERDE); }
        b.setBackground(g);
        b.setStateListAnimator(null);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, dp(44));
        lp.setMargins(0, dp(10), 0, 0);
        b.setLayoutParams(lp);
        return b;
    }

    private TextView texto(String t, int sp, int cor, boolean negrito) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextSize(sp);
        v.setTextColor(cor);
        if (negrito) v.setTypeface(Typeface.DEFAULT_BOLD);
        return v;
    }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
