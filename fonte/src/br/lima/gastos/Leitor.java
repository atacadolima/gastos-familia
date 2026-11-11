package br.lima.gastos;

import android.app.Notification;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcelable;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

/** Recebe as notificações do Android e guarda só as do C6 e do Itaú. */
public final class Leitor extends NotificationListenerService {

    /** A tela se inscreve aqui para atualizar quando chega aviso novo. */
    public static volatile Runnable aoMudar;
    public static volatile boolean conectado;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    @Override public void onListenerConnected() {
        conectado = true;
        try {
            StatusBarNotification[] ativas = getActiveNotifications();
            if (ativas != null) for (StatusBarNotification s : ativas) tratar(s);
        } catch (Exception ignored) { }
        avisarTela();
    }

    @Override public void onListenerDisconnected() {
        conectado = false;
        avisarSoTela();
    }

    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        try { tratar(sbn); } catch (Exception ignored) { }
    }

    private void tratar(StatusBarNotification sbn) {
        String pacote = sbn.getPackageName();
        if (pacote == null || pacote.equals(getPackageName())) return;
        Db db = Db.get(this);
        db.anotarPacote(pacote, System.currentTimeMillis());
        Notification n = sbn.getNotification();
        Bundle ex = n.extras;
        String titulo0 = str(ex.getCharSequence(Notification.EXTRA_TITLE));
        String conversa = str(ex.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE));
        boolean sms = Parser.ehAppDeSms(pacote);
        // SMS: só a conversa do remetente do Itaú (29040). As outras mensagens não são lidas.
        if (sms) {
            String remetente = !Parser.banco(pacote, titulo0).isEmpty() ? titulo0
                    : (!Parser.banco(pacote, conversa).isEmpty() ? conversa : "");
            if (remetente.isEmpty()) return;
            Parcelable[] msgs = ex.getParcelableArray(Notification.EXTRA_MESSAGES);
            boolean algum = false;
            if (msgs != null) {
                for (Parcelable p : msgs) {
                    if (!(p instanceof Bundle)) continue;
                    Bundle b = (Bundle) p;
                    String txt = str(b.getCharSequence("text"));
                    long hora = b.getLong("time", sbn.getPostTime());
                    if (txt.isEmpty()) continue;
                    algum = true;
                    if (db.salvar(hora, pacote, remetente, txt, pacote + "|" + remetente + "|" + txt)) avisarTela();
                }
            }
            if (algum) return;
            String txt = str(ex.getCharSequence(Notification.EXTRA_BIG_TEXT));
            if (txt.isEmpty()) txt = str(ex.getCharSequence(Notification.EXTRA_TEXT));
            if (!txt.isEmpty() && db.salvar(sbn.getPostTime(), pacote, remetente, txt, pacote + "|" + remetente + "|" + txt)) avisarTela();
            return;
        }
        if (Parser.banco(pacote, titulo0).isEmpty()) return;
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return; // resumo do grupo repete os avisos
        String titulo = titulo0;
        String texto = str(ex.getCharSequence(Notification.EXTRA_BIG_TEXT));
        if (texto.isEmpty()) texto = str(ex.getCharSequence(Notification.EXTRA_TEXT));
        CharSequence[] linhas = ex.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
        if (texto.isEmpty() && linhas != null) {
            StringBuilder sb = new StringBuilder();
            for (CharSequence l : linhas) sb.append(l).append('\n');
            texto = sb.toString().trim();
        }
        if (titulo.isEmpty() && texto.isEmpty()) return;

        String chave = pacote + "|" + sbn.getKey() + "|" + titulo + "|" + texto;
        if (db.salvar(sbn.getPostTime(), pacote, titulo, texto, chave)) avisarTela();
    }

    private static String str(CharSequence c) { return c == null ? "" : c.toString().trim(); }

    private void avisarTela() {
        Enviador.enviarAgora(getApplicationContext());
        avisarSoTela();
    }

    private static void avisarSoTela() {
        final Runnable r = aoMudar;
        if (r != null) MAIN.post(r);
    }
}
