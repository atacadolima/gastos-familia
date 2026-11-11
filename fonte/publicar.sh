#!/bin/bash
# Gera o APK de cada celular e publica a atualização (versao.json + gastos.apk) no Supabase Storage.
# Uso: ./publicar.sh "notas da versão"
set -euo pipefail
cd "$(dirname "$0")"
NOTAS="${1:-Melhorias no app}"
SRK=$(cat .srk); U=https://cjltedcpwmaqluvhybih.supabase.co
VC=$(sed -n 's/.*android:versionCode="\([0-9]*\)".*/\1/p' AndroidManifest.xml)
VN=$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' AndroidManifest.xml)
for d in celular-daniel celular-2; do
  K=$(sed -n "s/^$d=//p" .chaves-dispositivos); C=$(sed -n "s/^$d=//p" .canais)
  if [ "$d" = celular-daniel ]; then NOME="Celular do Daniel"; else NOME="Celular 2 (BB/Caixa)"; fi
  cat > src/br/lima/gastos/Config.java <<EOC
package br.lima.gastos;
/** Gerado no build. Cada celular tem sua própria chave (só permite mandar avisos) e seu canal de atualização. */
final class Config {
    static final String URL_AVISO = "$U/functions/v1/aviso";
    static final String CHAVE_PUBLICA = "sb_publishable_q6Ae6qRfaqPvCX-W5yMQyQ_LtkI77w9";
    static final String CHAVE_DISPOSITIVO = "$K";
    static final String NOME_DISPOSITIVO = "$NOME";
    static final String URL_ATUALIZACAO = "$U/storage/v1/object/public/app/$C/";
}
EOC
  bash build.sh >/dev/null 2>&1 || { echo "falhou o build"; rm -f src/br/lima/gastos/Config.java; exit 1; }
  cp build/GastosTeste.apk "/home/claude/Gastos-$VN-$d.apk"
  python3 -c 'import json,sys; print(json.dumps({"versionCode":int(sys.argv[1]),"versionName":sys.argv[2],"notas":sys.argv[3]},ensure_ascii=False))' "$VC" "$VN" "$NOTAS" > build/versao.json
  for f in gastos.apk:build/GastosTeste.apk:application/vnd.android.package-archive versao.json:build/versao.json:application/json; do
    IFS=: read nome arq tipo <<< "$f"
    curl -s -o /dev/null -w "$d $nome %{http_code}\n" -X POST "$U/storage/v1/object/app/$C/$nome" -H "apikey: $SRK" -H "Authorization: Bearer $SRK" \
      -H "content-type: $tipo" -H "x-upsert: true" -H "cache-control: no-cache" --data-binary @"$arq"
  done
done
rm -f src/br/lima/gastos/Config.java
echo "publicado $VN ($VC)"
