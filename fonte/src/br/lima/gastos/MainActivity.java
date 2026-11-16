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
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/** Tela principal: o app Mutirão (site), com o leitor de avisos rodando por baixo. */
public final class MainActivity extends Activity {

    static final String SITE = "https://atacadolima.github.io/gastos-familia/";
    private WebView web;
    private ValueCallback<Uri[]> escolhaArquivo;
    private static final int PEDIDO_ARQUIVO = 41;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(0xFF0F766E);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#EEF3F2"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportZoom(false);
        web.addJavascriptInterface(new Ponte(), "GastosAndroid");
        // "Anexar comprovante": abre a galeria/arquivos do celular (foto ou PDF)
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (escolhaArquivo != null) escolhaArquivo.onReceiveValue(null);
                escolhaArquivo = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "image/*", "application/pdf" });
                try { startActivityForResult(Intent.createChooser(i, "Escolha o comprovante"), PEDIDO_ARQUIVO); }
                catch (Exception e) { escolhaArquivo = null; return false; }
                return true;
            }
        });
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

    @Override protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == PEDIDO_ARQUIVO && escolhaArquivo != null) {
            escolhaArquivo.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            escolhaArquivo = null;
        }
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
