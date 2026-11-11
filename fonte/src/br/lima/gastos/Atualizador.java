package br.lima.gastos;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Atualização automática: confere se há versão nova, baixa e abre a tela "Instalar" do Android.
 * (O Android exige um toque de confirmação para apps fora da Play Store.)
 */
public final class Atualizador {

    private static long ultimaChecagem = 0;
    private static volatile boolean ocupado = false;

    /** Confere no máximo a cada 3 horas (ou sempre, se forcar). */
    public static void verificar(Activity a, boolean forcar) {
        if (ocupado) return;
        if (!forcar && System.currentTimeMillis() - ultimaChecagem < 3 * 3600_000L) return;
        ultimaChecagem = System.currentTimeMillis();
        ocupado = true;
        new Thread(() -> {
            try {
                JSONObject v = new JSONObject(new String(baixar(Config.URL_ATUALIZACAO + "versao.json"), "UTF-8"));
                int nova = v.getInt("versionCode");
                if (nova <= versaoAtual(a)) {
                    if (forcar) a.runOnUiThread(() -> Toast.makeText(a, "O app já está na versão mais nova.", Toast.LENGTH_SHORT).show());
                    return;
                }
                String nome = v.optString("versionName", String.valueOf(nova));
                String notas = v.optString("notas", "");
                a.runOnUiThread(() -> perguntar(a, nome, notas));
            } catch (Exception e) {
                if (forcar) a.runOnUiThread(() -> Toast.makeText(a, "Não consegui verificar atualização agora.", Toast.LENGTH_SHORT).show());
            } finally {
                ocupado = false;
            }
        }).start();
    }

    private static void perguntar(Activity a, String nome, String notas) {
        if (a.isFinishing()) return;
        new AlertDialog.Builder(a)
                .setTitle("Atualização do Gastos (" + nome + ")")
                .setMessage((notas.isEmpty() ? "" : notas + "\n\n") + "Baixar e instalar agora? Os seus dados continuam no app.")
                .setPositiveButton("Atualizar", (d, w) -> instalar(a))
                .setNegativeButton("Depois", null)
                .show();
    }

    private static void instalar(Activity a) {
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(a, "Permita que o Gastos instale atualizações e volte para o app.", Toast.LENGTH_LONG).show();
            a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
            ultimaChecagem = 0; // pergunta de novo ao voltar
            return;
        }
        Toast.makeText(a, "Baixando a atualização…", Toast.LENGTH_SHORT).show();
        ocupado = true;
        new Thread(() -> {
            try {
                byte[] apk = baixar(Config.URL_ATUALIZACAO + "gastos.apk");
                PackageInstaller pi = a.getPackageManager().getPackageInstaller();
                PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                p.setAppPackageName(a.getPackageName());
                int id = pi.createSession(p);
                try (PackageInstaller.Session s = pi.openSession(id)) {
                    try (OutputStream out = s.openWrite("gastos", 0, apk.length)) {
                        out.write(apk);
                        s.fsync(out);
                    }
                    Intent i = new Intent(a, Resultado.class);
                    int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                    PendingIntent pend = PendingIntent.getBroadcast(a, id, i, flags);
                    s.commit(pend.getIntentSender());
                }
            } catch (Exception e) {
                a.runOnUiThread(() -> Toast.makeText(a, "Não deu para baixar a atualização: " + e.getMessage(), Toast.LENGTH_LONG).show());
            } finally {
                ocupado = false;
            }
        }).start();
    }

    static int versaoAtual(Context c) {
        try {
            PackageInfo pi = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return pi.versionCode;
        } catch (Exception e) { return 0; }
    }

    private static byte[] baixar(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url + (url.contains("?") ? "&" : "?") + "t=" + System.currentTimeMillis()).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(60000);
        c.setUseCaches(false);
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            return b.toByteArray();
        } finally { c.disconnect(); }
    }

    /** Recebe o retorno do instalador e mostra a tela de confirmação do Android. */
    public static final class Resultado extends BroadcastReceiver {
        @Override public void onReceive(Context c, Intent i) {
            int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
            if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                Intent confirmar = i.getParcelableExtra(Intent.EXTRA_INTENT);
                if (confirmar != null) {
                    confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    c.startActivity(confirmar);
                }
            } else if (st != PackageInstaller.STATUS_SUCCESS) {
                String msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                Toast.makeText(c, "Atualização não instalada" + (msg == null ? "" : ": " + msg), Toast.LENGTH_LONG).show();
            }
        }
    }
}
