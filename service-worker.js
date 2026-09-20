// -----------------------------------------------------------------------------
// Service worker: cache dos ficheiros estaticos para a app abrir sem ligacao.
//
// Os dados em si (Supabase) NUNCA sao guardados em cache -- alem de ficarem
// desactualizados, seria guardar informacao financeira no disco do browser.
// Sem Internet a app abre, mas mostra erro ao tentar ler dados.
// -----------------------------------------------------------------------------

// Subir esta versao sempre que um ficheiro em cache mude -- o cache-first
// em baixo so' actualiza em segundo plano (para a proxima vez); sem subir a
// versao, um ficheiro novo pode importar de um ficheiro antigo ainda em
// cache da versao anterior (foi o que aconteceu ao acrescentar assets.js:
// ficou a pedir um export de db.js que a versao em cache ainda nao tinha).
const VERSAO = 'gestfi-v2';

const ESTATICOS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './js/ui.js',
  './js/format.js',
  './js/supabaseClient.js',
  './js/db.js',
  './js/modal.js',
  './js/accounts.js',
  './js/categories.js',
  './js/tags.js',
  './js/transactions.js',
  './js/dashboard.js',
  './js/budgets.js',
  './js/charts.js',
  './js/assets.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO)
      // addAll falha por inteiro se um ficheiro faltar; adiciona-se um a um.
      .then((cache) => Promise.allSettled(ESTATICOS.map((f) => cache.add(f))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(
        chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;

  const url = new URL(pedido.url);

  // Supabase: sempre da rede, nunca em cache.
  if (url.hostname.endsWith('.supabase.co')) return;

  // Biblioteca da CDN: cache-first, para a app arrancar offline.
  if (url.hostname === 'esm.sh') {
    evento.respondWith(
      caches.match(pedido).then((emCache) => emCache || fetch(pedido).then((resposta) => {
        const copia = resposta.clone();
        caches.open(VERSAO).then((cache) => cache.put(pedido, copia));
        return resposta;
      })),
    );
    return;
  }

  // Ficheiros da propria app: cache-first, com actualizacao em segundo plano.
  if (url.origin === self.location.origin) {
    evento.respondWith(
      caches.match(pedido).then((emCache) => {
        const daRede = fetch(pedido).then((resposta) => {
          if (resposta && resposta.ok) {
            const copia = resposta.clone();
            caches.open(VERSAO).then((cache) => cache.put(pedido, copia));
          }
          return resposta;
        }).catch(() => emCache);
        return emCache || daRede;
      }),
    );
  }
});
