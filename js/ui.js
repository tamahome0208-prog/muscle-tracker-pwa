export const $ = (sel) => document.querySelector(sel);

/** innerHTML に文字列を埋める際のエスケープ。外部由来の文字列は必ず通すこと */
export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * assets/sprite.svg（index.html にインライン済み）の <symbol> を参照する
 * <svg><use></svg> マークアップを返す。呼び出し側は絵文字を直接書かず、
 * これを通すことでサイズ・aria-hidden を一箇所に統一する。
 * name はコード側で固定した定数のみを渡す想定で、外部由来の文字列は通さない
 * （esc() の対象はテキストノードであり、ここは対象外）。
 * cls は追加のCSSクラス（例: 'icon-pb' で --pb 色にする）。
 */
export function icon(name, cls = '') {
  return `<svg class="icon${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#${name}"></use></svg>`;
}

const TABS = ['home', 'workout', 'meal', 'photo', 'record', 'settings'];
const listeners = {};
let activeTab = null;

/** タブ表示時に呼ぶ描画関数を登録する */
export function onShow(tab, fn) {
  listeners[tab] = fn;
}

export function showTab(tab) {
  for (const t of TABS) {
    $(`#tab-${t}`).classList.toggle('hidden', t !== tab);
    document.querySelector(`#tabbar button[data-tab="${t}"]`).classList.toggle('active', t === tab);
  }
  activeTab = tab;
  listeners[tab]?.();
}

/**
 * 今表示しているタブを描き直す。
 * js/main.js の boot() が initTabs() を先に呼んでから種データの取得を待つように
 * なったため(不安定な回線で fetch がハングしてもタブが操作可能であることを
 * 優先する)、取得完了後に画面へ反映するための再描画口が必要になった。
 * まだ initTabs() が呼ばれていなければ何もしない。
 */
export function refreshCurrentTab() {
  if (activeTab) listeners[activeTab]?.();
}

/**
 * これから外部(Google)へ送る画像を実際に表示し、送ってよいかを確認する。
 *
 * 【なぜ必要か】食事写真・レシート・InBody結果紙はいずれも
 * <input type="file" accept="image/*" capture="environment"> から選ぶ。
 * capture はヒントに過ぎず、Androidではギャラリー選択に切り替えられる。
 * つまり利用者が誤って体の進捗写真を選ぶ経路が実在する。
 * 以前の確認は解析「結果の数値」しか見せておらず、その時点で送信は終わっていた。
 * 送る前に、何を送るのかを本人が目で見て確認できなければならない。
 *
 * confirm() ではなく自前のダイアログにしているのは、画像そのものを見せる必要が
 * あるため(ブラウザ標準ダイアログには画像を入れられない)。
 * 表示用の ObjectURL は、どの分岐で閉じても必ず revoke する。
 *
 * kindLabel: 送るものの名前(例: 'インボディの結果紙')。何を確認すべきかを示す。
 * 戻り値: 送ってよければ true。
 */
export function confirmSend(file, kindLabel) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const host = activeTab ? $(`#tab-${activeTab}`) : document.body;
    const dialog = document.createElement('div');
    dialog.className = 'card';
    dialog.id = 'sendConfirm';
    dialog.innerHTML = `
      <h2 style="margin-top:0">この画像をGoogleに送信します</h2>
      <img src="${url}" alt="送信する画像" style="max-width:100%;border-radius:8px;display:block">
      <p class="muted">${esc(kindLabel)}であることを確認してください。
        解析のためGoogle(Gemini API)へ送信されます。送信するのはこの1枚だけです。
        撮影タブの体の進捗写真や、保存済みのトレーニング記録・体重の履歴データは送信されません。</p>
      <div class="chips">
        <button id="btnSendOk" class="primary">送信する</button>
        <button id="btnSendCancel">やめる</button>
      </div>`;
    host.prepend(dialog);
    dialog.scrollIntoView({ block: 'center' });

    const close = (ok) => {
      URL.revokeObjectURL(url);
      dialog.remove();
      resolve(ok);
    };
    dialog.querySelector('#btnSendOk').addEventListener('click', () => close(true));
    dialog.querySelector('#btnSendCancel').addEventListener('click', () => close(false));
  });
}

export function initTabs() {
  document.querySelectorAll('#tabbar button').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  showTab('home');
}

let toastTimer = null;
/**
 * variant: 'pb' で自己ベスト演出（金色＋一瞬のポップ）にする。それ以外は通常表示。
 * iconName（例: 'i-crest'）を渡すとテキストの前にアイコンを添える。
 * message は DOM の text node として追加するため esc() は不要（innerHTML を経由しない）。
 * icon() が返す静的なマークアップだけを別途 innerHTML で組み立てるので、
 * message にどんな文字列が来ても innerHTML には触れない。
 */
export function toast(message, ms = 2200, variant = '', iconName = '') {
  const el = $('#toast');
  el.textContent = '';
  if (iconName) {
    const wrap = document.createElement('span');
    wrap.innerHTML = icon(iconName);
    el.appendChild(wrap.firstElementChild);
    el.appendChild(document.createTextNode(' '));
  }
  el.appendChild(document.createTextNode(message));
  el.classList.toggle('pb', variant === 'pb');
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

export function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

export function todayStr() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 10);
}

export function nowStr() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d - off).toISOString().slice(0, 16);
}

/** 衝突しないID。crypto.randomUUID が使えない環境ではカウンタで補う */
let idCounter = 0;
export function newId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  idCounter += 1;
  return `${prefix}_${Date.now()}_${idCounter}`;
}
