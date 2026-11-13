package br.lima.gastos;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/** Tela principal: o app Gastos da Família (site), com o leitor de avisos rodando por baixo. */
public final class MainActivity extends Activity {

    static final String SITE = "https://atacadolima.github.io/gastos-familia/";
    private WebView web;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(0xFF1B3FBF);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F4F5F3"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportZoom(false);
        web.addJavascriptInterface(new Ponte(), "GastosAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (u.toString().startsWith(SITE)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        setContentView(web);
        if (b != null) web.restoreState(b); else web.loadUrl(SITE);

        // Primeira vez: liberar a leitura de avisos antes de tudo
        if (!acessoLiberado()) startActivity(new Intent(this, StatusActivity.class));
    }

    @Override protected void onResume() {
        super.onResume();
        Enviador.enviarAgora(this);
        Atualizador.verificar(this, false);
    }

    @Override protected void onSaveInstanceState(Bundle o) { super.onSaveInstanceState(o); web.saveState(o); }

    @Override public void onBackPressed() {
        web.evaluateJavascript("window.voltarApp ? window.voltarApp() : false", v -> {
            if (!"true".equals(v)) {
                if (web.canGoBack()) web.goBack(); else MainActivity.super.onBackPressed();
            }
        });
    }

    private boolean acessoLiberado() {
        String s = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        return s != null && s.contains(new ComponentName(this, Leitor.class).flattenToString());
    }

    /** Chamadas que o site pode fazer quando está dentro do app Android. */
    final class Ponte {
        @JavascriptInterface public void abrirLeitor() {
            runOnUiThread(() -> startActivity(new Intent(MainActivity.this, StatusActivity.class)));
        }
        @JavascriptInterface public void verificarAtualizacao() {
            runOnUiThread(() -> Atualizador.verificar(MainActivity.this, true));
        }
        @JavascriptInterface public int versao() { return Atualizador.versaoAtual(MainActivity.this); }
        @JavascriptInterface public String status() {
            try {
                return new JSONObject()
                        .put("ligado", acessoLiberado())
                        .put("pendentes", Db.get(MainActivity.this).qtdPendentes())
                        .put("ultimoStatus", Enviador.ultimoStatus)
                        .put("ultimoEnvioOk", Enviador.ultimoEnvioOk)
                        .toString();
            } catch (Exception e) { return "{}"; }
        }
    }
}
