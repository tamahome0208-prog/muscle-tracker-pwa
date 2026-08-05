// navigator.storage の永続化ステータスの問い合わせ専用モジュール。
// js/store.js(localStorage)にも js/photos.js(IndexedDB)にも触れない。単なる問い合わせであり、
// 外部への通信は一切発生しない(ブラウザのローカルAPIのみ)。
//
// 引数で navigator.storage 相当のオブジェクトを注入できるようにしてあるのは、
// テストで「APIが無い環境」「persist()がrejectする」「false を返す」の3パターンを
// 例外なく処理できることを検証するため(js/store.js の createStore(storage = ...) と同じ
// 依存注入の考え方)。実際の呼び出し側(js/main.js, js/settingsTab.js)は引数を省略してよい。

/**
 * 起動時に一度呼ぶ。永続ストレージを要求する。
 * Android Chromeでは、ホーム画面にインストールされたPWAは高い確率で許可されるが、
 * 通常のタブ(未インストール)では許可されないことが多い(ブラウザ側の判断で、アプリ側から
 * 強制はできない)。API自体が無い環境・promiseがrejectした場合・false(拒否)が返った場合の
 * いずれでも例外を投げず、supported/persisted の2値で状態を返す。
 */
export async function requestPersistentStorage(storageApi = globalThis.navigator?.storage) {
  if (!storageApi || typeof storageApi.persist !== 'function') {
    return { supported: false, persisted: false };
  }
  try {
    const persisted = await storageApi.persist();
    return { supported: true, persisted: persisted === true };
  } catch (err) {
    console.warn('永続ストレージの要求に失敗しました:', err);
    return { supported: true, persisted: false };
  }
}

/** 現在すでに永続化されているかどうかを問い合わせるだけ(要求はしない。設定タブの表示用) */
export async function readPersistedState(storageApi = globalThis.navigator?.storage) {
  if (!storageApi || typeof storageApi.persisted !== 'function') {
    return { supported: false, persisted: false };
  }
  try {
    const persisted = await storageApi.persisted();
    return { supported: true, persisted: persisted === true };
  } catch {
    return { supported: true, persisted: false };
  }
}

/** 使用量/割当量の概算(バイト)。取得できない環境・失敗時は null */
export async function readStorageEstimate(storageApi = globalThis.navigator?.storage) {
  if (!storageApi || typeof storageApi.estimate !== 'function') return null;
  try {
    const { usage, quota } = await storageApi.estimate();
    if (!Number.isFinite(usage) || !Number.isFinite(quota)) return null;
    return { usage, quota };
  } catch {
    return null;
  }
}

/**
 * 設定タブに出す文言。永続化されていない場合は、それが何を意味するか
 * (空き容量不足でブラウザに消される可能性)とどうすれば改善するか(ホーム画面に追加)を
 * 一文で伝える。
 */
export function persistedStateText(state) {
  if (!state?.supported) {
    return 'この端末・ブラウザでは永続ストレージの対応状況を確認できません。';
  }
  if (state.persisted) {
    return '永久保存: 許可されています。端末の空き容量が不足しても、このデータが優先的に削除される可能性は低くなっています。';
  }
  return '永久保存: 許可されていません。端末の空き容量が不足すると、ブラウザがこのデータを削除する可能性があります。ホーム画面に追加すると許可されやすくなります。';
}

/** 使用量/割当量をMB表示のテキストにする。estimate が無ければ空文字(呼び出し側で空要素として扱う) */
export function storageEstimateText(estimate) {
  if (!estimate) return '';
  const mb = (n) => (n / (1024 * 1024)).toFixed(1);
  return `使用量の目安: ${mb(estimate.usage)}MB / 割当量の目安: ${mb(estimate.quota)}MB`;
}
