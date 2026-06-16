// WoodGrader 26 — Service Worker
const CACHE = 'wg26-v9';

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
  // Pro navigaci (HTML) vždy zkusíme síť, fallback na cache
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('./index.html'))
    );
    return;
  }
  // Ostatní — cache first, pak síť
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
