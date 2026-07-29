const CACHE = 'muscle-tracker-v1';

const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'vendor/chart.umd.js',
  'js/main.js',
  'js/ui.js',
  'js/store.js',
  'js/workout.js',
  'js/nutrition.js',
  'js/game.js',
  'js/body.js',
  'js/photos.js',
  'js/ocr.js',
  'js/barcode.js',
  'js/charts.js',
  'js/homeTab.js',
  'js/workoutTab.js',
  'js/mealTab.js',
  'js/photoTab.js',
  'js/recordTab.js',
  'js/settingsTab.js',
  'data/exercises.json',
  'data/foods.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 外部API（Gemini / Open Food Facts）はキャッシュせず素通しする
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then((hit) => hit ?? fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('index.html')))
  );
});
