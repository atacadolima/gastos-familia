// Guarda só as telas do app para abrir rápido. Os dados vêm sempre da internet.
const VERSAO = 'gastos-v18';
const TELAS = ['./', 'index.html', 'styles.css?v=18', 'app.js?v=18', 'manifest.webmanifest', 'icons/icon-192.png', 'vendor/supabase.min.js?v=2.50.0', 'vendor/fonts/manrope-latin-500-normal.woff2', 'vendor/fonts/manrope-latin-700-normal.woff2', 'vendor/fonts/manrope-latin-800-normal.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(TELAS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // Rede primeiro (pega versão nova), cache se estiver sem internet
  e.respondWith(fetch(e.request).then((r) => {
    const copia = r.clone();
    caches.open(VERSAO).then((c) => c.put(e.request, copia));
    return r;
  }).catch(() => caches.match(e.request)));
});
