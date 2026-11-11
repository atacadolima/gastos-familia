package br.lima.gastos;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Manda os avisos guardados para a base do app. O que falhar fica na fila e vai na próxima vez. */
public final class Enviador {

    private static final ExecutorService FILA = Executors.newSingleThreadExecutor();
    private static final AtomicBoolean RODANDO = new AtomicBoolean(false);
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    public static volatile String ultimoStatus = "";
    public static volatile long ultimoEnvioOk = 0;

    /** Dispara um envio em segundo plano (ignora se já houver um rodando). */
    public static void enviarAgora(Context ctx) {
        final Context app = ctx.getApplicationContext();
        agendar(app);
        if (!RODANDO.compareAndSet(false, true)) return;
        FILA.execute(() -> {
            try { enviarTudo(app); } finally { RODANDO.set(false); avisarTela(); }
        });
    }

    /** Envia em blocos até esvaziar a fila. @return true se não sobrou nada. */
    static boolean enviarTudo(Context ctx) {
        Db db = Db.get(ctx);
        for (int volta = 0; volta < 20; volta++) {
            List<String[]> lote = db.pendentes(50);
            if (lote.isEmpty()) { ultimoStatus = "Tudo enviado"; return true; }
            try {
                JSONArray arr = new JSONArray();
                for (String[] a : lote) {
                    JSONObject o = new JSONObject();
                    o.put("recebido_em", Long.parseLong(a[1]));
                    o.put("pacote", a[2]);
                    o.put("titulo", a[3] == null ? "" : a[3]);
                    o.put("texto", a[4] == null ? "" : a[4]);
                    o.put("chave", a[5]);
                    arr.put(o);
                }
                JSONObject corpo = new JSONObject().put("avisos", arr);
                JSONObject resp = post(corpo.toString());
                JSONArray aceitos = resp.optJSONArray("aceitos");
                if (aceitos == null || aceitos.length() == 0) {
                    ultimoStatus = "Servidor não aceitou: " + resp.optString("erro", "?");
                    return false;
                }
                for (int i = 0; i < aceitos.length(); i++) db.marcarEnviado(aceitos.getString(i));
                ultimoEnvioOk = System.currentTimeMillis();
                ultimoStatus = "Enviado";
            } catch (Exception e) {
                ultimoStatus = "Sem conexão, tenta de novo depois (" + e.getClass().getSimpleName() + ")";
                return false;
            }
        }
        return db.qtdPendentes() == 0;
    }

    private static JSONObject post(String corpo) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(Config.URL_AVISO).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setDoOutput(true);
        c.setRequestProperty("content-type", "application/json; charset=utf-8");
        c.setRequestProperty("apikey", Config.CHAVE_PUBLICA);
        c.setRequestProperty("x-chave", Config.CHAVE_DISPOSITIVO);
        try (OutputStream os = c.getOutputStream()) { os.write(corpo.getBytes(StandardCharsets.UTF_8)); }
        int code = c.getResponseCode();
        InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        if (in != null) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            in.close();
        }
        String txt = b.toString("UTF-8");
        c.disconnect();
        JSONObject o = txt.isEmpty() ? new JSONObject() : new JSONObject(txt);
        if (code >= 400 && !o.has("erro")) o.put("erro", "HTTP " + code);
        return o;
    }

    /** Tarefa do Android que tenta de novo a cada ~1h quando houver internet. */
    static void agendar(Context ctx) {
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(1) != null) return;
        js.schedule(new JobInfo.Builder(1, new ComponentName(ctx, Job.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(60 * 60 * 1000L)
                .setPersisted(false)
                .build());
    }

    private static void avisarTela() {
        Runnable r = Leitor.aoMudar;
        if (r != null) MAIN.post(r);
    }

    public static final class Job extends JobService {
        @Override public boolean onStartJob(JobParameters p) {
            FILA.execute(() -> {
                boolean ok = enviarTudo(getApplicationContext());
                avisarTela();
                jobFinished(p, !ok);
            });
            return true;
        }
        @Override public boolean onStopJob(JobParameters p) { return true; }
    }
}
