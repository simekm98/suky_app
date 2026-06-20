// WoodGrader 26 — Service Worker
const CACHE = 'wg26-v56';

// Cachujeme jen index.html — všechno ostatní je inline nebo CDN
const ASSETS = ['./index.html', './manifest.json', './sync.js', './folders.js', './stats.js', './voice.js', './import.js', './icons/icon-192.svg', './icons/icon-512.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => {
      // addAll selže pokud jeden soubor chybí — proto fetchujeme jednotlivě
      return Promise.all(
        ASSETS.map(url =>
          fetch(url).then(r => r.ok ? c.put(url, r) : null).catch(() => null)
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // index.html — VŽDY network-first, bez ohledu na request.mode.
  // V iOS standalone PWA nemusí být request.mode==='navigate' spolehlivě
  // nastaven, takže kontrolujeme i URL přímo (jinak appka servuje starý HTML).
  var url = e.request.url;
  if (e.request.mode === 'navigate' || url.endsWith('/') || url.endsWith('index.html')) {
    e.respondWith(
      fetch(e.request, {cache: 'no-store'}).catch(() => caches.match('./index.html'))
    );
    return;
  }
  // JS soubory — network-only (žádná cache), aby vždy běžela aktuální verze
  if (url.endsWith('.js')) {
    e.respondWith(
      fetch(e.request, {cache: 'no-store'}).catch(() => caches.match(e.request))
    );
    return;
  }
  // Ostatní — cache first, pak síť
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
