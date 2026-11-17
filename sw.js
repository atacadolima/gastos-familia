// Guarda só as telas do app para abrir rápido. Os dados vêm sempre da internet.
const VERSAO = 'gastos-v36';
const TELAS = ['./', 'index.html', 'styles.css?v=36', 'app.js?v=36', 'manifest.webmanifest', 'icons/icon-192.png', 'vendor/supabase.min.js?v=2.50.0', 'vendor/fonts/manrope-latin-500-normal.woff2', 'vendor/fonts/manrope-latin-700-normal.woff2', 'vendor/fonts/manrope-latin-800-normal.woff2'];

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

// Avisos (Web Push): compras novas e compromissos do dia
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { titulo: 'Mutirão', texto: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Mutirão', {
    body: d.texto || '', tag: d.tag || undefined, renotify: !!d.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: { aba: d.aba || 'inicio' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const aba = (e.notification.data && e.notification.data.aba) || 'inicio';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if ('focus' in c) { c.postMessage({ aba }); return c.focus(); } }
    return self.clients.openWindow('./?aba=' + aba);
  }));
});
