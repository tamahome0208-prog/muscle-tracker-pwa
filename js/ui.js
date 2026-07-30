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

/** タブ表示時に呼ぶ描画関数を登録する */
export function onShow(tab, fn) {
  listeners[tab] = fn;
}

export function showTab(tab) {
  for (const t of TABS) {
    $(`#tab-${t}`).classList.toggle('hidden', t !== tab);
    document.querySelector(`#tabbar button[data-tab="${t}"]`).classList.toggle('active', t === tab);
  }
  listeners[tab]?.();
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
