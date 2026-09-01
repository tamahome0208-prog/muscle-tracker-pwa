const CACHE = 'muscle-tracker-v15';

const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'vendor/chart.umd.js',
  'js/main.js',
  'js/ui.js',
  'js/store.js',
  'js/storageInfo.js',
  'js/backupReminder.js',
  'js/workout.js',
  'js/nutrition.js',
  'js/energy.js',
  'js/micronutrients.js',
  'js/game.js',
  'js/body.js',
  'js/goals.js',
  'js/photos.js',
  'js/ocr.js',
  'js/barcode.js',
  'js/charts.js',
  'js/homeTab.js',
  'js/workoutTab.js',
  'js/mealTab.js',
  'js/photoTab.js',
  'js/recordTab.js',
  'js/calendarView.js',
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

// ナビゲーション(index.html)がキャッシュを返す前に、ネットワークの応答を待つ上限(ミリ秒)。
//
// 【なぜタイムアウトが要るか】機内モードは fetch が即座に reject する
// 「きれいなオフライン」で、catch 節がすぐ走るため問題にならない。
// しかしジムの不安定Wi-Fiは「TCPは張れるが応答が返らない」半死の状態で、
// fetch は reject も解決もしない。タイムアウトが無ければ、手元のキャッシュに
// あるアセットまで待たされ続ける。機内モードは最も優しい障害モードであり、
// 実使用環境を代表していない。
//
// 【なぜ 800ms か】ここで待つのは「手元に使えるキャッシュがあるのに、
// もっと新しいものが来ないか確かめている」時間である。回線が正常なら同一オリジンの
// 小さなアセットは数十msで返る。返らないなら、待つ価値のある遅延ではない。
// 以前は 2500ms にしていたが根拠は無かった。R4.7.6(起動から1セット目記録まで
// 2秒以内)を掲げる以上、この1本で予算の大半を使い切る値は設定できない。
//
// タイムアウトしてもネットワーク側のPromiseは中断しないため、遅れて到着した応答は
// そのままキャッシュを更新する(次回の起動では新しいバイト列が使われる)。
//
// この待ち時間が発生するのはナビゲーション1本だけ。サブリソースは
// stale-while-revalidate なので回線の状態に依存しない(下の fetch ハンドラ参照)。
const NETWORK_TIMEOUT_MS = 800;
const TIMED_OUT = Symbol('network-timeout');

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // 外部API（Gemini / Open Food Facts）はキャッシュせず素通しする
  if (url.origin !== location.origin) return;
  if (e.request.method !== 'GET') return;

  // 【計測で分かったこと・戦略を2つに分けた理由】
  //
  // 全てをネットワーク優先(タイムアウト800ms)にしていたとき、応答の返らない
  // 回線での起動を実測したら **8.08秒** かかった。HTML自体は812msで
  // キャッシュから返っていたのに、である。
  //
  // 原因はESモジュールの読み込みが依存関係の段数だけ待たされることにある。
  // index.html → js/main.js → その import → さらにその import …と辿るため、
  // 1本あたり800msのタイムアウトが**段数分積み上がる**。24本のモジュールが
  // 並列に取得されるわけではない。タイムアウトを短くしても段数は変わらないので、
  // この構造では「1本あたりの待ち時間」を削る方向に限界がある。
  //
  // そこで:
  // - ナビゲーション(index.html)だけネットワーク優先を維持する。
  //   デプロイが端末に届く速さは、この1本で担保できる。最悪でも800ms。
  // - サブリソース(js / css / data / vendor)はキャッシュを即座に返し、
  //   更新は背景で行う(stale-while-revalidate)。回線の状態に一切依存しなくなる。
  //
  // デプロイの反映は「次回の起動」に一段遅れるが、
  // ジムで開いたアプリが8秒間何も表示しないことの方がはるかに悪い。
  if (e.request.mode === 'navigate') {
    e.respondWith(networkFirst(e.request));
    return;
  }
  e.respondWith(staleWhileRevalidate(e.request));
});

/**
 * キャッシュがあれば即座に返し、更新は背景で行う。
 * 回線が半死でも待ち時間は 0ms になる(これが起動時間を8.08秒から縮める鍵)。
 * キャッシュが無い場合(初回訪問・新しく追加されたファイル)だけネットワークを待つ。
 */
async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);

  const network = fetch(request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
    }
    return res;
  });
  // 背景での更新なので、失敗しても利用者には何も起きない。
  // unhandled rejection にだけしないようにしておく。
  network.catch(() => {});

  if (cached) return cached;

  try {
    return await network;
  } catch {
    // 取得できなかった同一オリジンのサブリソース（js/画像等）に
    // index.html を200で返してはならない。本当のエラーが隠れて気づけなくなる。
    return Response.error();
  }
}

async function networkFirst(request) {
  const cached = await caches.match(request);

  const network = fetch(request).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
    }
    return res;
  });
  // タイムアウトが先に決着した場合でも、network 側の rejection が
  // unhandled rejection にならないようにしておく。
  network.catch(() => {});

  if (!cached) {
    // 返せるキャッシュが無い以上、待つ以外の選択肢が無い。ここにタイムアウトを
    // 付けると、初回訪問や低速回線でまだ一度も取得していないアセットを
    // 打ち切ってしまい、アプリそのものが起動できなくなる。
    try {
      return await network;
    } catch {
      // ナビゲーション（ページ遷移）だけは、オフライン時にアプリシェルへ
      // フォールバックする。取得できなかった同一オリジンのサブリソース
      // （js/画像等）まで index.html を200で返してしまうと、本当のエラーが
      // 隠れて気づけなくなるため、ここでは失敗させる。
      if (request.mode === 'navigate') {
        const shell = await caches.match('index.html');
        if (shell) return shell;
      }
      return Response.error();
    }
  }

  // キャッシュを持っている場合だけ、応答の来ない回線で待ち続けない。
  // ネットワーク優先の利点（sw.js を編集しなくてもデプロイが端末に届く）は、
  // 回線が正常なら 2.5 秒以内に応答が返るため維持される。
  const timeout = new Promise((resolve) => { setTimeout(() => resolve(TIMED_OUT), NETWORK_TIMEOUT_MS); });
  const winner = await Promise.race([network.catch(() => TIMED_OUT), timeout]);
  return winner === TIMED_OUT ? cached : winner;
}
