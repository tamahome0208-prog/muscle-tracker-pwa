export const $ = (sel) => document.querySelector(sel);

/** innerHTML に文字列を埋める際のエスケープ。外部由来の文字列は必ず通すこと */
export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
export function toast(message, ms = 2200) {
  const el = $('#toast');
  el.textContent = message;
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
