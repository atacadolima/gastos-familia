#!/bin/bash
# Compila o APK sem Gradle: aapt2 -> javac -> d8 -> zip -> zipalign -> apksigner
set -euo pipefail
cd "$(dirname "$0")"
SDK=/opt/android-sdk
BT=$SDK/build-tools/34.0.0
JAR=$SDK/platforms/android-34/android.jar
OUT=build
rm -rf $OUT && mkdir -p $OUT/gen $OUT/classes $OUT/dex

$BT/aapt2 compile --dir res -o $OUT/res.zip
$BT/aapt2 link -o $OUT/base.apk -I $JAR --manifest AndroidManifest.xml \
  --java $OUT/gen $OUT/res.zip --auto-add-overlay

javac -encoding UTF-8 --release 8 -Xlint:-options -classpath $JAR -nowarn \
  -d $OUT/classes $(find src $OUT/gen -name '*.java') 2>&1 | grep -v JAVA_TOOL || true
test -f $OUT/classes/br/lima/gastos/MainActivity.class

(cd $OUT/classes && jar cf ../classes.jar .)
java -cp /opt/r8/r8.jar com.android.tools.r8.D8 --min-api 26 --lib $JAR --output $OUT/dex $OUT/classes.jar 2>&1 | grep -v JAVA_TOOL || true
cp $OUT/base.apk $OUT/unsigned.apk
(cd $OUT/dex && zip -q ../unsigned.apk classes.dex)
$BT/zipalign -f -p 4 $OUT/unsigned.apk $OUT/aligned.apk

KS=$HOME/.gastos-assinatura.jks
if [ ! -f $KS ]; then
  keytool -genkeypair -keystore $KS -alias gastos -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass gastos123 -keypass gastos123 -dname "CN=Gastos Teste, O=Pessoal, C=BR" 2>&1 | grep -v JAVA_TOOL || true
fi
$BT/apksigner sign --ks $KS --ks-pass pass:gastos123 --key-pass pass:gastos123 --out $OUT/GastosTeste.apk $OUT/aligned.apk 2>&1 | grep -v JAVA_TOOL || true
$BT/apksigner verify $OUT/GastosTeste.apk 2>&1 | grep -v JAVA_TOOL || true
ls -l $OUT/GastosTeste.apk
