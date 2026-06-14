const CACHE = 'rental-manager-v1';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './finance.js',
  './report.js',
  './styles.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './fonts/DejaVuSans.ttf',
  './fonts/DejaVuSans-Bold.ttf'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('firestore') ||
      e.request.url.includes('firebase') ||
      e.request.url.includes('googleapis') ||
      e.request.url.includes('gstatic') ||
      e.request.url.includes('cdnjs')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
