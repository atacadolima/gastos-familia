package br.lima.gastos;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import java.util.ArrayList;
import java.util.List;

/** Guarda os avisos só no celular. Guarda o texto bruto; a leitura (Parser) é feita na hora de mostrar. */
public final class Db extends SQLiteOpenHelper {

    public static final class Aviso {
        public long id, recebidoEm;
        public String pacote, titulo, texto;
        public Parser.Resultado lido;
    }

    private static Db inst;

    public static synchronized Db get(Context c) {
        if (inst == null) inst = new Db(c.getApplicationContext());
        return inst;
    }

    private Db(Context c) { super(c, "gastos.db", null, 2); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE avisos (id INTEGER PRIMARY KEY AUTOINCREMENT, recebido_em INTEGER NOT NULL, "
                + "pacote TEXT NOT NULL, titulo TEXT, texto TEXT, chave TEXT NOT NULL UNIQUE, enviado INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("CREATE TABLE pacotes (pacote TEXT PRIMARY KEY, vezes INTEGER NOT NULL, ultimo INTEGER NOT NULL)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int o, int n) {
        if (o < 2) db.execSQL("ALTER TABLE avisos ADD COLUMN enviado INTEGER NOT NULL DEFAULT 0");
    }

    /** Avisos ainda não enviados ao servidor (mais antigos primeiro). */
    public List<String[]> pendentes(int limite) {
        List<String[]> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT id, recebido_em, pacote, titulo, texto, chave FROM avisos WHERE enviado = 0 ORDER BY id LIMIT " + limite, null)) {
            while (c.moveToNext()) out.add(new String[]{c.getString(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4), c.getString(5)});
        }
        return out;
    }

    public int qtdPendentes() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM avisos WHERE enviado = 0", null)) {
            return c.moveToFirst() ? c.getInt(0) : 0;
        }
    }

    public void marcarEnviado(String chave) {
        getWritableDatabase().execSQL("UPDATE avisos SET enviado = 1 WHERE chave = ?", new Object[]{chave});
    }

    /** @return true se era um aviso novo. */
    public boolean salvar(long quando, String pacote, String titulo, String texto, String chave) {
        ContentValues v = new ContentValues();
        v.put("recebido_em", quando);
        v.put("pacote", pacote);
        v.put("titulo", titulo);
        v.put("texto", texto);
        v.put("chave", chave);
        return getWritableDatabase().insertWithOnConflict("avisos", null, v, SQLiteDatabase.CONFLICT_IGNORE) != -1;
    }

    /** Só o nome do app que notificou, para descobrir o pacote do banco. Nada do conteúdo. */
    public void anotarPacote(String pacote, long quando) {
        SQLiteDatabase db = getWritableDatabase();
        db.execSQL("INSERT OR IGNORE INTO pacotes(pacote, vezes, ultimo) VALUES (?, 0, ?)", new Object[]{pacote, quando});
        db.execSQL("UPDATE pacotes SET vezes = vezes + 1, ultimo = ? WHERE pacote = ?", new Object[]{quando, pacote});
    }

    public List<Aviso> avisos() {
        List<Aviso> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT id, recebido_em, pacote, titulo, texto FROM avisos ORDER BY recebido_em DESC, id DESC", null)) {
            while (c.moveToNext()) {
                Aviso a = new Aviso();
                a.id = c.getLong(0);
                a.recebidoEm = c.getLong(1);
                a.pacote = c.getString(2);
                a.titulo = c.getString(3);
                a.texto = c.getString(4);
                a.lido = Parser.ler(a.pacote, a.titulo, a.texto);
                out.add(a);
            }
        }
        return out;
    }

    public List<String[]> pacotes() {
        List<String[]> out = new ArrayList<>();
        try (Cursor c = getReadableDatabase().rawQuery("SELECT pacote, vezes, ultimo FROM pacotes ORDER BY ultimo DESC", null)) {
            while (c.moveToNext()) out.add(new String[]{c.getString(0), String.valueOf(c.getLong(1)), String.valueOf(c.getLong(2))});
        }
        return out;
    }

    public void apagarTudo() {
        SQLiteDatabase db = getWritableDatabase();
        db.delete("avisos", null, null);
        db.delete("pacotes", null, null);
    }
}
