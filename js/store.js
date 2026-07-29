// このモジュールの契約(store.js を利用する全モジュールが前提としてよいこと):
//
// 1. get() が返す値は常にコピーである。呼び出し側がその場で mutate しても、
//    set() を呼ばない限り永続化(localStorage)にもキャッシュにも反映されない。
//    例: const w = store.get('workouts'); w.push(x); // ここではまだ何も保存されていない
//        store.set('workouts', w);                    // この行で初めて保存される
//
// 2. 参照の同一性は保証されない。
//    store.get('workouts')[0] !== store.get('workouts')[0] (呼ぶたびに新しいコピー)。
//    そのため `===` によるオブジェクト比較や、エンティティそのものをキーにした
//    Set/Map には依存しないこと。id などのプリミティブ値で同一性を判定すること。

export const SCHEMA_VERSION = 1;

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export const DEFAULTS = deepFreeze({
  profile: {
    height: 162,
    startDate: null,
    targets: { protein: 100, kcalMin: 1700, kcalMax: 1800, kcalFloor: 1500, alcoholMl: 500 }
  },
  workouts: [],
  exercises: [],
  meals: [],
  foods: [],
  body: [],
  badminton: [],
  game: {
    xp: { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 },
    streakWeeks: 0,
    lastWeekKey: null,
    bests: {},
    badges: []
  },
  settings: { geminiKey: '', useOpenFoodFacts: true, photoReminder: true }
});

const KEY_PREFIX = 'mt.';
const isArrayKey = (key) => Array.isArray(DEFAULTS[key]);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// プレーンオブジェクトは再帰的にマージし、配列やプリミティブは丸ごと置き換える。
// 保存済みデータに一部の項目しか無くても、後から DEFAULTS に増えたネストした項目を補える。
function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const result = { ...base };
  for (const key of Object.keys(override)) {
    result[key] = isPlainObject(base[key]) && isPlainObject(override[key])
      ? deepMerge(base[key], override[key])
      : override[key];
  }
  return result;
}

function isValidFor(key, value) {
  if (!(key in DEFAULTS)) return false;
  return isArrayKey(key) ? Array.isArray(value) : isPlainObject(value);
}

export function createStore(storage = globalThis.localStorage) {
  const cache = new Map();

  // get/set で同じ正規化を通す: 配列はそのまま(クローンのみ)、オブジェクトは DEFAULTS と再帰マージ。
  function normalize(key, value) {
    return isArrayKey(key) ? clone(value) : deepMerge(DEFAULTS[key], value);
  }

  // 保存済みJSONを読み、パース失敗・型不一致を破損として検出したうえで正規化まで行う。
  function readValidated(key) {
    const raw = storage.getItem(KEY_PREFIX + key);
    if (raw === null) return { ok: true, value: clone(DEFAULTS[key]) };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, value: clone(DEFAULTS[key]) };
    }
    if (!isValidFor(key, parsed)) return { ok: false, value: clone(DEFAULTS[key]) };
    return { ok: true, value: normalize(key, parsed) };
  }

  function get(key) {
    if (!(key in DEFAULTS)) throw new Error(`未知のキー: ${key}`);
    if (!cache.has(key)) {
      const { value } = readValidated(key);
      cache.set(key, clone(value));
    }
    // キャッシュの実体ではなくスナップショットを返す。呼び出し側が set せずに mutate しても
    // キャッシュ/永続化には影響しない(= set し忘れによる「リロードで消えるゴーストデータ」を防ぐ)。
    return clone(cache.get(key));
  }

  function set(key, value) {
    if (!(key in DEFAULTS)) throw new Error(`未知のキー: ${key}`);
    if (!isValidFor(key, value)) {
      const expected = isArrayKey(key) ? '配列' : 'オブジェクト';
      throw new Error(`不正な値です(${key}): ${expected} を指定してください`);
    }
    const normalized = normalize(key, value);
    // 先に永続化し、成功した場合のみキャッシュを更新する。
    // setItem が QuotaExceededError 等で失敗した場合、キャッシュは古いままになり
    // get() が「保存済み」と偽って答えることがない。
    storage.setItem(KEY_PREFIX + key, JSON.stringify(normalized));
    cache.set(key, clone(normalized));
    return clone(normalized);
  }

  function validate() {
    const repaired = [];
    for (const key of Object.keys(DEFAULTS)) {
      const { ok, value } = readValidated(key);
      if (!ok) {
        repaired.push(key);
        storage.setItem(KEY_PREFIX + key, JSON.stringify(value));
        cache.set(key, clone(value));
      }
    }
    storage.setItem(KEY_PREFIX + 'schemaVersion', String(SCHEMA_VERSION));
    return repaired;
  }

  function exportAll() {
    const out = { schemaVersion: SCHEMA_VERSION };
    for (const key of Object.keys(DEFAULTS)) out[key] = get(key);
    // Gemini APIキーはバックアップ(端末外に持ち出される可能性が高いファイル)には含めない。
    if (out.settings) out.settings = { ...out.settings, geminiKey: '' };
    return JSON.stringify(out, null, 2);
  }

  function importAll(json) {
    let data;
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error('インポートに失敗しました: JSONとして読めません');
    }
    if (!isPlainObject(data)) {
      throw new Error('インポートに失敗しました: 形式が不正です');
    }

    const targetKeys = Object.keys(DEFAULTS).filter((key) => key in data);

    // 書き込み前に全キーの形式を検証する。1つでも不正なら何も書き込まずに例外を投げる。
    for (const key of targetKeys) {
      if (!isValidFor(key, data[key])) {
        throw new Error(`インポートに失敗しました: ${key} の形式が不正です`);
      }
    }

    // Gemini APIキーが空でインポートされた場合は、端末に既にある値を維持する
    // (同じ端末へ復元する際にキーを入れ直さずに済むように)。
    if (targetKeys.includes('settings') && !data.settings.geminiKey) {
      data.settings = { ...data.settings, geminiKey: get('settings').geminiKey };
    }

    const previousRaw = new Map();
    for (const key of targetKeys) previousRaw.set(key, storage.getItem(KEY_PREFIX + key));

    const applied = [];
    try {
      for (const key of targetKeys) {
        set(key, data[key]);
        applied.push(key);
      }
    } catch (err) {
      // 途中で setItem が失敗した場合、書き込み済みだった分を元の値に戻してから再スローする。
      // ロールバック自体の setItem/removeItem も(容量逼迫時などに)失敗しうるため、
      // 1件ずつ try/catch で囲んで残りの復元を続行し、元の例外(原因)を消さずに再スローする。
      const failedRollbacks = [];
      for (const key of applied) {
        try {
          const prev = previousRaw.get(key);
          if (prev === null) storage.removeItem(KEY_PREFIX + key);
          else storage.setItem(KEY_PREFIX + key, prev);
          cache.delete(key);
        } catch {
          failedRollbacks.push(key);
        }
      }
      if (failedRollbacks.length > 0) {
        err.message += ` (ロールバックにも失敗したキー: ${failedRollbacks.join(', ')})`;
      }
      throw err;
    }
  }

  return { get, set, validate, exportAll, importAll };
}
