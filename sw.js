const CACHE = 'muscle-tracker-v5';

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
  'js/dayView.js',
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

// ネットワーク優先＋キャッシュフォールバック。
//
// install 時のプリキャッシュ(ASSETS)はコールドスタート時のオフライン起動のために残すが、
// 通常時の取得戦略はキャッシュ優先ではなくネットワーク優先にする。CACHE定数は
// sw.js自身のバイト列が変わらない限り再インストールされないため、js/*だけを直しても
// 「install時にキャッシュした古いバイト列」が更新されず、index.html を含め
// 永久に古いファイルを配信し続けてしまう(=デプロイしても端末に反映されない)。
// ネットワーク優先にしておけば、sw.js自体を編集しなくても次回リクエストで
// 新しいバイト列がそのままキャッシュに上書きされる。
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 外部API（Gemini / Open Food Facts）はキャッシュせず素通しする
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then((hit) => {
        if (hit) return hit;
        // ナビゲーション（ページ遷移）だけは、オフライン時にアプリシェルへ
        // フォールバックする。取得できなかった同一オリジンのサブリソース
        // （js/画像等）まで index.html を200で返してしまうと、本当のエラーが
        // 隠れて気づけなくなるため、ここでは何も返さず失敗させる。
        return e.request.mode === 'navigate' ? caches.match('index.html') : undefined;
      })
    )
  );
});
