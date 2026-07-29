export const SCHEMA_VERSION = 1;

export const DEFAULTS = {
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
};

const KEY_PREFIX = 'mt.';
const isArrayKey = (key) => Array.isArray(DEFAULTS[key]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createStore(storage = globalThis.localStorage) {
  const cache = new Map();

  function readRaw(key) {
    const raw = storage.getItem(KEY_PREFIX + key);
    if (raw === null) return { ok: true, value: clone(DEFAULTS[key]) };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, value: clone(DEFAULTS[key]) };
    }
    const typeOk = isArrayKey(key)
      ? Array.isArray(parsed)
      : parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    if (!typeOk) return { ok: false, value: clone(DEFAULTS[key]) };
    return { ok: true, value: parsed };
  }

  return {
    get(key) {
      if (!(key in DEFAULTS)) throw new Error(`未知のキー: ${key}`);
      if (!cache.has(key)) {
        const { value } = readRaw(key);
        // オブジェクト系はデフォルトを土台にマージし、後から増えた項目を補う
        cache.set(key, isArrayKey(key) ? value : { ...clone(DEFAULTS[key]), ...value });
      }
      return cache.get(key);
    },

    set(key, value) {
      if (!(key in DEFAULTS)) throw new Error(`未知のキー: ${key}`);
      cache.set(key, value);
      storage.setItem(KEY_PREFIX + key, JSON.stringify(value));
      return value;
    },

    /** 全キーを検証し、壊れていたキーだけ初期化する。戻り値は修復したキー名の配列 */
    validate() {
      const repaired = [];
      for (const key of Object.keys(DEFAULTS)) {
        const { ok, value } = readRaw(key);
        if (!ok) {
          repaired.push(key);
          cache.set(key, value);
          storage.setItem(KEY_PREFIX + key, JSON.stringify(value));
        }
      }
      storage.setItem(KEY_PREFIX + 'schemaVersion', String(SCHEMA_VERSION));
      return repaired;
    },

    exportAll() {
      const out = { schemaVersion: SCHEMA_VERSION };
      for (const key of Object.keys(DEFAULTS)) out[key] = this.get(key);
      return JSON.stringify(out, null, 2);
    },

    importAll(json) {
      let data;
      try {
        data = JSON.parse(json);
      } catch {
        throw new Error('インポートに失敗しました: JSONとして読めません');
      }
      if (data === null || typeof data !== 'object') {
        throw new Error('インポートに失敗しました: 形式が不正です');
      }
      for (const key of Object.keys(DEFAULTS)) {
        if (key in data) this.set(key, data[key]);
      }
    }
  };
}
