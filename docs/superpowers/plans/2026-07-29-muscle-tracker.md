# 筋トレ継続管理アプリ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JOYFIT24室蘭モルエ中島のマシン専用の週3プログラムを、✓タップだけで記録でき、食事・体組成・体の写真・ゲーミフィケーションまで一体で管理できるオフライン動作のPWAを作る。

**Architecture:** ビルド工程なしの静的サイト。`index.html` から ES modules を直接読み込む。計算ロジック（`workout.js` / `nutrition.js` / `game.js` / `store.js`）は DOM とネットワークに触れない純粋関数として切り出し、Node の `node:test` でテストする。記録データは localStorage、体の写真だけ IndexedDB に分離する。`photos.js` は `fetch` を一切持たず、体の写真が外部に出る経路を構造的に作らない。

**Tech Stack:** Vanilla JS (ES modules) / Chart.js (vendored) / localStorage / IndexedDB / Service Worker / BarcodeDetector API / Gemini API / GitHub Pages

**Spec:** `docs/superpowers/specs/2026-07-29-muscle-tracker-design.md`

---

## File Structure

| ファイル | 責務 |
|---|---|
| `index.html` | 6タブのシェル。モジュール読み込み |
| `css/style.css` | 全スタイル |
| `js/main.js` | 起動・初期化・タブ配線 |
| `js/store.js` | localStorage の読み書きと破損検証。**唯一 localStorage に触るモジュール** |
| `js/workout.js` | ローテーション判定・総挙上量・PB判定（純粋関数） |
| `js/nutrition.js` | 日次集計・達成率・下限警告（純粋関数） |
| `js/game.js` | XP・レベル・ストリーク・称号（純粋関数） |
| `js/body.js` | 体重・体組成の集計（純粋関数） |
| `js/photos.js` | IndexedDB 専用。**fetch を含まない** |
| `js/ocr.js` | Gemini API 呼び出しとフォールバック |
| `js/barcode.js` | BarcodeDetector と Open Food Facts 照会 |
| `js/charts.js` | Chart.js 描画のみ |
| `js/ui.js` | DOM 生成・タブ切替・各タブ描画 |
| `data/exercises.json` | マシン一覧とプログラムA/B/C |
| `data/foods.json` | 初期のよく食べる食品 |
| `vendor/chart.umd.js` | Chart.js 本体（オフライン用に同梱） |
| `scripts/make-icons.js` | PWAアイコンの生成（Node標準ライブラリのみ） |
| `manifest.json` / `sw.js` | PWA |
| `test/*.test.js` | node:test |

---

## Task 1: プロジェクト初期化とテスト環境

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `test/helpers.js`
- Test: `test/helpers.test.js`

**前提:** このリポジトリには `git config user.name` / `user.email` がローカル設定済み。未設定ならコミットできないので先に確認する。

- [ ] **Step 1: `package.json` を作る**

```json
{
  "name": "muscle-tracker-pwa",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test \"test/**/*.test.js\""
  }
}
```

- [ ] **Step 2: `.gitignore` を作る**

```
node_modules/
.DS_Store
```

- [ ] **Step 3: `test/helpers.js` を作る（localStorage スタブ）**

```js
export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; }
  };
}
```

- [ ] **Step 4: `test/helpers.test.js` を作る**

スタブも動作を保証すべきコードなので、テストを書く。

**テスト実行コマンドの注意（検証済み）:** Node v24.15.0 (Windows) では `node --test test/` のように
**ディレクトリを引数に渡すと中身に関係なく `MODULE_NOT_FOUND` で失敗する**。
引数なしの `node --test` は動くが、テストではない `test/helpers.js` まで「0アサーションのテスト」として数えてしまう。
そのため `package.json` ではグロブ形式 `node --test "test/**/*.test.js"` を使う（ダブルクォートは sh でのグロブ展開を防ぐため必須）。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryStorage } from './helpers.js';

test('setItem した値を getItem で読める', () => {
  const s = memoryStorage();
  s.setItem('k', 'v');
  assert.equal(s.getItem('k'), 'v');
});

test('未設定のキーは null を返す', () => {
  assert.equal(memoryStorage().getItem('無い'), null);
});

test('初期値つきで作れて length が件数を返す', () => {
  const s = memoryStorage({ a: '1', b: '2' });
  assert.equal(s.length, 2);
  assert.equal(s.getItem('a'), '1');
  s.removeItem('a');
  assert.equal(s.length, 1);
  assert.equal(s.getItem('a'), null);
});
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npm test`
Expected: PASS（3件）、exit code 0

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore test/helpers.js test/helpers.test.js
git commit -m "chore: プロジェクト初期化とテスト環境"
```

---

## Task 2: store.js（localStorage 層）

**Files:**
- Create: `js/store.js`
- Test: `test/store.test.js`

`store.js` は「保存・読み込み・破損検証」だけを担当する。localStorage に触るのはこのファイルだけ。

**設計上の要点（コードレビューで確定した事項）:**

1. **永続化してからキャッシュを更新する。** 逆順だと `setItem` が QuotaExceededError で失敗しても
   `get()` が「保存済み」と答えてしまい、ジムで記録した1セットが画面上は残ってリロードで消える。
2. **`get`/`set` はスナップショット（clone）を扱う。** キャッシュの実体を返すと、呼び出し側が
   `set` を忘れて mutate したときに「そのセッション中だけ存在してリロードで消える」幽霊データになる。
3. **デフォルトのマージは再帰的に行う。** 浅いマージだと `profile.targets` や `game.xp` の
   ネストした項目を補えず、`kcalFloor` が `undefined` になってカロリー下限警告が壊れる。
4. **`get` と `set` は同じ `normalize()` を通す。** 通さないと、`set` 直後とリロード後で
   `get` の結果が変わるという再現しづらいバグになる。
5. **`importAll` は書き込み前に全キーを検証する。** 検証しないと `{"workouts":"garbage"}` を
   そのまま書き込んで1年分の履歴を壊し、次回起動の `validate()` がそれを `[]` に「修復」して確定的に失う。
   途中で `setItem` が失敗した場合は書き込み済みの分を元に戻す。
6. **`exportAll` は Gemini APIキーを出力しない。** バックアップJSONは端末外（Drive・自分宛メール等）に
   持ち出される可能性が最も高いファイルで、そこに認証情報を平文で載せない。
   インポート時に空なら端末側の既存キーを維持する。

- [ ] **Step 1: 失敗するテストを書く**

`test/store.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DEFAULTS } from '../js/store.js';
import { memoryStorage } from './helpers.js';

test('初回はデフォルト値を返す', () => {
  const store = createStore(memoryStorage());
  assert.deepEqual(store.get('workouts'), []);
  assert.equal(store.get('profile').height, 162);
  assert.equal(store.get('profile').targets.protein, 100);
  assert.equal(store.get('profile').targets.kcalFloor, 1500);
});

test('保存した値を読み戻せる', () => {
  const store = createStore(memoryStorage());
  store.set('workouts', [{ id: 'w1', date: '2026-07-29' }]);
  assert.equal(store.get('workouts').length, 1);
  assert.equal(store.get('workouts')[0].id, 'w1');
});

test('壊れたJSONは該当キーだけ初期化し他は守る', () => {
  const storage = memoryStorage({
    'mt.workouts': '{{{壊れたJSON',
    'mt.meals': JSON.stringify([{ id: 'm1' }])
  });
  const store = createStore(storage);
  const repaired = store.validate();
  assert.deepEqual(repaired, ['workouts']);
  assert.deepEqual(store.get('workouts'), []);
  assert.equal(store.get('meals').length, 1);
});

test('型が違う値も破損として初期化する', () => {
  const storage = memoryStorage({ 'mt.workouts': '"文字列"' });
  const store = createStore(storage);
  assert.deepEqual(store.validate(), ['workouts']);
  assert.deepEqual(store.get('workouts'), []);
});

test('エクスポートとインポートで往復できる', () => {
  const store = createStore(memoryStorage());
  store.set('meals', [{ id: 'm1', kcal: 500 }]);
  const json = store.exportAll();
  const store2 = createStore(memoryStorage());
  store2.importAll(json);
  assert.equal(store2.get('meals')[0].id, 'm1');
});

test('importAll は不正なJSONで例外を投げ、既存データを壊さない', () => {
  const store = createStore(memoryStorage());
  store.set('meals', [{ id: 'keep' }]);
  assert.throws(() => store.importAll('壊れた'), /インポート/);
  assert.equal(store.get('meals')[0].id, 'keep');
});

// --- 以下、コード品質レビューで指摘された観点の回帰テスト ---

test('set は同じ storage を渡した別インスタンスからも読み戻せる(実際に永続化される)', () => {
  const storage = memoryStorage();
  const store1 = createStore(storage);
  store1.set('workouts', [{ id: 'w1' }]);
  const store2 = createStore(storage);
  assert.equal(store2.get('workouts').length, 1);
  assert.equal(store2.get('workouts')[0].id, 'w1');
});

test('set は storage の生JSONにも正しい形で書き込む', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.set('workouts', [{ id: 'w1' }]);
  assert.deepEqual(JSON.parse(storage.getItem('mt.workouts')), [{ id: 'w1' }]);
});

test('validate() の修復は storage 側にも反映される', () => {
  const storage = memoryStorage({ 'mt.workouts': '{{{壊れたJSON' });
  const store = createStore(storage);
  store.validate();
  assert.deepEqual(JSON.parse(storage.getItem('mt.workouts')), []);
});

test('read-modify-write パターンを別インスタンスを跨いで繰り返しても一貫した結果になる', () => {
  const storage = memoryStorage();
  const store1 = createStore(storage);
  const w1 = store1.get('workouts');
  w1.push({ id: 'w1' });
  store1.set('workouts', w1);

  const store2 = createStore(storage);
  const w2 = store2.get('workouts');
  w2.push({ id: 'w2' });
  store2.set('workouts', w2);

  const store3 = createStore(storage);
  assert.equal(store3.get('workouts').length, 2);
});

test('get で返した値を mutate しても set しない限り保存されない(ゴーストデータ防止)', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  const workouts = store.get('workouts');
  workouts.push({ id: 'ghost' });
  assert.equal(store.get('workouts').length, 0);
  assert.equal(storage.getItem('mt.workouts'), null);
});

test('setItem が失敗した場合、キャッシュも更新されない', () => {
  const storage = memoryStorage();
  const realSetItem = storage.setItem.bind(storage);
  let shouldFail = false;
  storage.setItem = (k, v) => {
    if (shouldFail) throw new Error('QuotaExceededError');
    realSetItem(k, v);
  };
  const store = createStore(storage);
  store.set('workouts', [{ id: 'w1' }]);
  shouldFail = true;
  assert.throws(() => store.set('workouts', [{ id: 'w1' }, { id: 'w2' }]));
  assert.equal(store.get('workouts').length, 1);
});

test('部分的な profile を保存してもデフォルトのネスト項目が再帰的に補われる', () => {
  const storage = memoryStorage({
    'mt.profile': JSON.stringify({ targets: { protein: 120 } })
  });
  const store = createStore(storage);
  const profile = store.get('profile');
  assert.equal(profile.targets.protein, 120);
  assert.equal(profile.targets.kcalFloor, 1500);
  assert.equal(profile.height, 162);
});

test('importAll は不正な形式のキーを含む場合、何も書き込まずに例外を投げる', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.set('meals', [{ id: 'keep' }]);
  assert.throws(
    () => store.importAll(JSON.stringify({ workouts: 'garbage', meals: [{ id: 'new' }] })),
    /インポート/
  );
  assert.equal(store.get('meals')[0].id, 'keep');
  assert.equal(store.get('workouts').length, 0);
});

test('importAll 途中で setItem が失敗したら書き込み済みの分も元に戻す', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.set('workouts', [{ id: 'old-w' }]);
  store.set('meals', [{ id: 'old-m' }]);

  const realSetItem = storage.setItem.bind(storage);
  let failOnMeals = false;
  storage.setItem = (k, v) => {
    if (failOnMeals && k === 'mt.meals') throw new Error('QuotaExceededError');
    realSetItem(k, v);
  };

  failOnMeals = true;
  assert.throws(() => store.importAll(JSON.stringify({
    workouts: [{ id: 'new-w' }],
    meals: [{ id: 'new-m' }]
  })));
  failOnMeals = false;

  // カウンター経由(store.get)ではなく storage の生JSONを直接見て、
  // キャッシュ側だけ元に戻っていて storage 側が壊れたまま、という事態を検知できるようにする。
  assert.equal(JSON.parse(storage.getItem('mt.workouts'))[0].id, 'old-w');
  assert.equal(JSON.parse(storage.getItem('mt.meals'))[0].id, 'old-m');
  assert.equal(store.get('workouts')[0].id, 'old-w');
  assert.equal(store.get('meals')[0].id, 'old-m');
});

test('get/set に未知のキーを渡すと例外になる', () => {
  const store = createStore(memoryStorage());
  assert.throws(() => store.get('unknown'), /未知のキー/);
  assert.throws(() => store.set('unknown', {}), /未知のキー/);
});

test('exportAll は geminiKey を含めない', () => {
  const store = createStore(memoryStorage());
  store.set('settings', { geminiKey: 'secret-key', useOpenFoodFacts: true, photoReminder: true });
  const json = JSON.parse(store.exportAll());
  assert.equal(json.settings.geminiKey, '');
});

test('importAll で geminiKey が空なら端末側の既存キーを維持する', () => {
  const store = createStore(memoryStorage());
  store.set('settings', { geminiKey: 'existing-key', useOpenFoodFacts: true, photoReminder: true });
  store.importAll(JSON.stringify({ settings: { geminiKey: '', useOpenFoodFacts: false, photoReminder: false } }));
  assert.equal(store.get('settings').geminiKey, 'existing-key');
  assert.equal(store.get('settings').useOpenFoodFacts, false);
});

// --- 再レビュー(N1〜N7)対応の回帰テスト ---

test('set() は型が違う値を拒否し、storage を壊さない', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  assert.throws(() => store.set('profile', 'garbage'), /不正な値/);
  assert.throws(() => store.set('workouts', null), /不正な値/);
  assert.throws(() => store.set('workouts', 42), /不正な値/);
  assert.throws(() => store.set('profile', undefined), /不正な値/);
  assert.equal(storage.getItem('mt.profile'), null);
  assert.equal(storage.getItem('mt.workouts'), null);
});

test('set() は normalize を通す: 部分的な profile を渡してもデフォルトのネスト項目が補われる', () => {
  const store = createStore(memoryStorage());
  store.set('profile', { height: 170 });
  assert.equal(store.get('profile').targets.kcalFloor, 1500);
  assert.equal(store.get('profile').height, 170);
});

test('DEFAULTS は deep freeze されており、ネストしたプロパティの書き換えも例外になる', () => {
  assert.throws(() => { DEFAULTS.profile.height = 1; });
  assert.throws(() => { DEFAULTS.profile.targets.protein = 1; });
  assert.throws(() => { DEFAULTS.workouts.push({}); });
});

test('validate() は mt. 以外のキーには一切触らない', () => {
  const storage = memoryStorage({ 'other-app.settings': 'untouched-value' });
  const store = createStore(storage);
  store.validate();
  assert.equal(storage.getItem('other-app.settings'), 'untouched-value');
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL - `Cannot find module '../js/store.js'`

- [ ] **Step 3: `js/store.js` を実装**

```js
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
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（累計25件）

- [ ] **Step 5: 永続化が本当にテストされているか確認する（ミューテーションテスト）**

永続化層のテストは、キャッシュ経由でしか読み戻していないと「永続化していなくても通る」状態になりやすい。
一時的に `set()` 内の `storage.setItem(...)` の行を無効化して `npm test` を実行し、
**テストが失敗すること**を確認してから元に戻す。

Expected: 5件が fail する（0件しか落ちないなら、テストがキャッシュしか見ていない）

同様に次の変異でもテストが落ちることを確認する。いずれも1件ずつ落ちる:
`set()` の `normalize` 呼び出し除去 / `set()` の型検証除去 / `deepMerge` を浅いマージに変更 / `DEFAULTS` の `deepFreeze` 除去

- [ ] **Step 6: Commit**

```bash
git add js/store.js test/store.test.js
git commit -m "feat: localStorage層と破損検証を追加"
```

---

## Task 3: exercises.json（JOYFIT室蘭のマシン定義）

**Files:**
- Create: `data/exercises.json`
- Test: `test/exercises.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/exercises.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const exercises = JSON.parse(readFileSync(new URL('../data/exercises.json', import.meta.url)));
const PARTS = ['chest', 'back', 'shoulder', 'leg', 'arm', 'abs'];

test('A/B/C の3プログラムが各6種目ある', () => {
  for (const program of ['A', 'B', 'C']) {
    const list = exercises.filter((e) => e.program === program);
    assert.equal(list.length, 6, `プログラム${program}の種目数`);
  }
});

test('全種目に id・name・part・初期重量がある', () => {
  for (const e of exercises) {
    assert.ok(e.id, `idが無い: ${JSON.stringify(e)}`);
    assert.ok(e.name, `nameが無い: ${e.id}`);
    assert.ok(PARTS.includes(e.part), `partが不正: ${e.id}`);
    assert.equal(typeof e.defaultWeight, 'number', `defaultWeightが数値でない: ${e.id}`);
    assert.equal(typeof e.defaultReps, 'number', `defaultRepsが数値でない: ${e.id}`);
    assert.equal(typeof e.sets, 'number', `setsが数値でない: ${e.id}`);
  }
});

test('idが重複していない', () => {
  const ids = exercises.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL - `ENOENT ... data/exercises.json`

- [ ] **Step 3: `data/exercises.json` を作る**

会話で確定した設置マシンと初期重量をそのまま入れる。`defaultWeight` は目安レンジの下限側を採用（初回は軽めから始めて伸ばす）。

```json
[
  { "id": "incline_chest_press", "program": "A", "part": "chest",    "name": "インクラインチェストプレス", "defaultWeight": 5,   "defaultReps": 10, "sets": 3, "step": 2.5, "note": "片側の重量。通常のチェストプレス機が無いため胸の主軸" },
  { "id": "pec_fly",             "program": "A", "part": "chest",    "name": "ペックフライ（胸側）",       "defaultWeight": 20,  "defaultReps": 10, "sets": 3, "step": 2.5, "note": "" },
  { "id": "shoulder_press",      "program": "A", "part": "shoulder", "name": "ショルダープレス",           "defaultWeight": 15,  "defaultReps": 10, "sets": 3, "step": 2.5, "note": "" },
  { "id": "lateral_raise",       "program": "A", "part": "shoulder", "name": "ラテラルレイズ",             "defaultWeight": 5,   "defaultReps": 15, "sets": 3, "step": 2.5, "note": "軽めで15回" },
  { "id": "triceps_extension",   "program": "A", "part": "arm",      "name": "トライセップエクステンション", "defaultWeight": 15, "defaultReps": 10, "sets": 3, "step": 2.5, "note": "" },
  { "id": "dip_assist",          "program": "A", "part": "chest",    "name": "ディプアシスト",             "defaultWeight": -40, "defaultReps": 8,  "sets": 3, "step": 5,   "note": "マイナスは補助重量。数値が0に近いほど高負荷" },

  { "id": "lat_pulldown",        "program": "B", "part": "back",     "name": "ラットプルダウン",           "defaultWeight": 30,  "defaultReps": 10, "sets": 3, "step": 2.5, "note": "" },
  { "id": "seated_row",          "program": "B", "part": "back",     "name": "シーテッドロー",             "defaultWeight": 30,  "defaultReps": 10, "sets": 3, "step": 2.5, "note": "" },
  { "id": "pulldown",            "program": "B", "part": "back",     "name": "プルダウン",                 "defaultWeight": 30,  "defaultReps": 12, "sets": 3, "step": 2.5, "note": "" },
  { "id": "rear_delt",           "program": "B", "part": "shoulder", "name": "リアデルト",                 "defaultWeight": 15,  "defaultReps": 12, "sets": 3, "step": 2.5, "note": "ペックフライの逆方向" },
  { "id": "biceps_curl",         "program": "B", "part": "arm",      "name": "バイセップスカール",         "defaultWeight": 15,  "defaultReps": 10, "sets": 3, "step": 2.5, "note": "" },
  { "id": "chin_assist",         "program": "B", "part": "back",     "name": "チンアシスト",               "defaultWeight": -40, "defaultReps": 8,  "sets": 3, "step": 5,   "note": "8回×3セットを目標" },

  { "id": "leg_press",           "program": "C", "part": "leg",      "name": "レッグプレス",               "defaultWeight": 60,  "defaultReps": 10, "sets": 3, "step": 5,   "note": "" },
  { "id": "leg_extension",       "program": "C", "part": "leg",      "name": "レッグエクステンション",     "defaultWeight": 25,  "defaultReps": 10, "sets": 3, "step": 2.5, "note": "" },
  { "id": "seated_leg_curl",     "program": "C", "part": "leg",      "name": "シーテッドレッグカール",     "defaultWeight": 20,  "defaultReps": 10, "sets": 3, "step": 2.5, "note": "" },
  { "id": "back_extension",      "program": "C", "part": "back",     "name": "バックエクステンション",     "defaultWeight": 0,   "defaultReps": 12, "sets": 3, "step": 2.5, "note": "自重から開始" },
  { "id": "ab_coaster",          "program": "C", "part": "abs",      "name": "アブコースター",             "defaultWeight": 0,   "defaultReps": 15, "sets": 3, "step": 2.5, "note": "自重15回×3" },
  { "id": "abdominal",           "program": "C", "part": "abs",      "name": "アブドミナル",               "defaultWeight": 20,  "defaultReps": 12, "sets": 3, "step": 2.5, "note": "" }
]
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（累計28件）

- [ ] **Step 5: Commit**

```bash
git add data/exercises.json test/exercises.test.js
git commit -m "feat: JOYFIT室蘭のマシン定義とプログラムA/B/Cを追加"
```

---

## Task 4: workout.js — ローテーション判定と総挙上量

**Files:**
- Create: `js/workout.js`
- Test: `test/workout.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/workout.test.js`（Task 5 で追加するPB系のテストも含めた最終形）:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextProgram,
  calcVolume,
  weeklyVolume,
  lastSetFor,
  isPB,
  updateBests,
  warnsBadmintonAfterLegs,
  weekKey
} from '../js/workout.js';

test('記録が無ければ最初はA', () => {
  assert.equal(nextProgram([]), 'A');
});

test('A→B→C→A と順送りする', () => {
  assert.equal(nextProgram([{ date: '2026-07-29', program: 'A' }]), 'B');
  assert.equal(nextProgram([{ date: '2026-07-29', program: 'B' }]), 'C');
  assert.equal(nextProgram([{ date: '2026-07-29', program: 'C' }]), 'A');
});

test('日付が最新の記録を基準にする（配列順に依存しない）', () => {
  const workouts = [
    { date: '2026-07-29', program: 'B' },
    { date: '2026-07-20', program: 'C' }
  ];
  assert.equal(nextProgram(workouts), 'C');
});

test('未知のprogramの記録は無視して直近の既知programから継続する', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A' },
    { date: '2026-07-29', program: undefined }
  ];
  assert.equal(nextProgram(workouts), 'B');
});

test('総挙上量は 重量×回数 の合計', () => {
  const sets = [
    { exId: 'lat_pulldown', weight: 35, reps: 10 },
    { exId: 'lat_pulldown', weight: 35, reps: 8 },
    { exId: 'seated_row', weight: 30, reps: 10 }
  ];
  assert.equal(calcVolume(sets), 35 * 10 + 35 * 8 + 30 * 10);
});

test('補助重量（マイナス）は総挙上量に加算しない', () => {
  const sets = [{ exId: 'chin_assist', weight: -40, reps: 8 }];
  assert.equal(calcVolume(sets), 0);
});

test('自重（0kg）は回数×体重換算せず0として扱う', () => {
  assert.equal(calcVolume([{ exId: 'ab_coaster', weight: 0, reps: 15 }]), 0);
});

test('calcVolume は不正な値を0として扱いNaNを伝播させない', () => {
  const sets = [
    { exId: 'lat_pulldown', weight: 35, reps: 10 },
    { exId: 'lat_pulldown', weight: undefined, reps: 8 }
  ];
  assert.equal(calcVolume(sets), 350);
});

test('週次の総挙上量を月曜始まりで集計する', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A', volume: 1000 }, // 月
    { date: '2026-07-29', program: 'B', volume: 1200 }, // 水（同じ週）
    { date: '2026-08-03', program: 'C', volume: 900 }   // 翌週の月
  ];
  const weeks = weeklyVolume(workouts);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].volume, 2200);
  assert.equal(weeks[1].volume, 900);
});

test('weeklyVolume は volume が無い記録を sets から計算して集計する', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] }
  ];
  const weeks = weeklyVolume(workouts);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].volume, 300);
});

test('weeklyVolume は日付が不正な記録を例外を投げずに除外する', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A', volume: 1000 },
    { date: undefined, program: 'B', volume: 99999 }
  ];
  const weeks = weeklyVolume(workouts);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].volume, 1000);
});

test('weekKey は月曜始まりのISO週番号を返す', () => {
  assert.equal(weekKey('2025-12-29'), '2026-W01');
  assert.equal(weekKey('2026-07-29'), '2026-W31');
  assert.equal(weekKey('2026-12-31'), '2026-W53');
  assert.equal(weekKey('2027-01-01'), '2026-W53');
  assert.equal(weekKey('2027-01-04'), '2027-W01');
});

test('weekKey は不正な形式の日付で例外を投げる', () => {
  assert.throws(() => weekKey(undefined));
  assert.throws(() => weekKey('2026-7-9')); // ゼロ埋めなし
});

test('前回のセットを種目ごとに引ける（同一セッション内では最後のセットを返す）', () => {
  const workouts = [
    { date: '2026-07-20', program: 'B', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] },
    {
      date: '2026-07-27',
      program: 'B',
      sets: [
        { exId: 'seated_row', weight: 32.5, reps: 12 },
        { exId: 'seated_row', weight: 32.5, reps: 10 },
        { exId: 'seated_row', weight: 35, reps: 8 }
      ]
    }
  ];
  assert.deepEqual(lastSetFor(workouts, 'seated_row'), { weight: 35, reps: 8 });
  assert.equal(lastSetFor(workouts, 'leg_press'), null);
});

test('記録が無ければ最初のセットはPB', () => {
  assert.equal(isPB({}, 'seated_row', 30, 10), true);
});

test('重量が上回ればPB', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  assert.equal(isPB(bests, 'seated_row', 32.5, 8), true);
});

test('同じ重量で回数が上回ればPB', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  assert.equal(isPB(bests, 'seated_row', 30, 11), true);
});

test('同じ重量で回数が同じならPBではない', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  assert.equal(isPB(bests, 'seated_row', 30, 10), false);
});

test('重量が下がれば回数が多くてもPBではない', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  assert.equal(isPB(bests, 'seated_row', 27.5, 20), false);
});

test('updateBests は元のオブジェクトを壊さない', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  const next = updateBests(bests, 'seated_row', 32.5, 8, '2026-07-29');
  assert.equal(bests.seated_row.weight, 30);
  assert.equal(next.seated_row.weight, 32.5);
  assert.equal(next.seated_row.date, '2026-07-29');
});

test('PBでなければ updateBests は同じ内容を返す', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  const next = updateBests(bests, 'seated_row', 27.5, 8, '2026-07-29');
  assert.deepEqual(next.seated_row, bests.seated_row);
  assert.notEqual(next, bests); // 内容は同じでも新しいオブジェクトを返す
});

test('updateBests は他種目のPBを保持する', () => {
  const bests = {
    seated_row: { weight: 30, reps: 10, date: '2026-07-20' },
    lat_pulldown: { weight: 40, reps: 8, date: '2026-07-15' }
  };
  const next = updateBests(bests, 'seated_row', 32.5, 8, '2026-07-29');
  assert.deepEqual(next.lat_pulldown, bests.lat_pulldown);
  assert.deepEqual(next.seated_row, { weight: 32.5, reps: 8, date: '2026-07-29' });
});

test('脚の日（C）の翌日にバドミントンを入れると警告する', () => {
  const workouts = [{ date: '2026-07-29', program: 'C' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2026-07-30'), true);
});

test('脚の日の2日後なら警告しない', () => {
  const workouts = [{ date: '2026-07-29', program: 'C' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2026-07-31'), false);
});

test('AやBの翌日は警告しない', () => {
  const workouts = [{ date: '2026-07-29', program: 'A' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2026-07-30'), false);
});

test('月をまたぐ脚の日の翌日も警告する', () => {
  const workouts = [{ date: '2026-07-31', program: 'C' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2026-08-01'), true);
});

test('年をまたぐ脚の日の翌日も警告する', () => {
  const workouts = [{ date: '2026-12-31', program: 'C' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2027-01-01'), true);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL - `Cannot find module '../js/workout.js'`

- [ ] **Step 3: `js/workout.js` を実装（この時点ではローテーションと集計のみ）**

```js
export const PROGRAMS = ['A', 'B', 'C'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 日付文字列 'YYYY-MM-DD' の週キー（月曜始まり、ISO 8601週番号）を返す。例: '2026-W31'
 *
 * 不正な形式の入力（undefined・ゼロ埋め無しなど）は例外を投げる。これはプログラマの
 * ミスを黙って通さないための設計判断: 以前は不正入力で 'NaN-WNaN' のような無意味な
 * キーを返しており、文字列比較では 'N' > '2' のため週次集計の並びの最後（＝「最新週」
 * として画面に出る位置）に紛れ込んでしまっていた。
 *
 * 一方 weeklyVolume() はこの関数と非対称に、不正な日付を持つ記録を例外を投げずに
 * 除外する。weeklyVolume はインポートされた記録など信頼できない外部データが入りうる
 * 境界であり、1件の壊れた記録のせいで週次集計全体が例外で落ちるのは避けたいため。
 */
export function weekKey(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) {
    throw new Error(`weekKey: invalid date string: ${dateStr}`);
  }
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // 月=0
  d.setUTCDate(d.getUTCDate() - day + 3); // その週の木曜
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function sortedByDate(workouts) {
  return [...workouts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 曜日ではなく順送りで次のプログラムを決める。
 * 直近の記録の program が未知（不正値・undefined）な場合は、既知の program を持つ
 * 直近の記録まで遡って続きを決める。1件の壊れた記録のせいでローテーションが 'A' に
 * リセットされ、胸の日（A）が2連続になったり脚の日（C）が飛ばされたりする事故を防ぐため。
 */
export function nextProgram(workouts) {
  const sorted = sortedByDate(workouts).reverse();
  for (const w of sorted) {
    const index = PROGRAMS.indexOf(w.program);
    if (index !== -1) return PROGRAMS[(index + 1) % PROGRAMS.length];
  }
  return 'A';
}

/**
 * 総挙上量 = Σ(重量 × 回数)。補助重量（負値）と自重（0）は0として扱う。
 * weight/reps が数値化できない値（undefined など）でも NaN を伝播させず0として扱う
 * （防御的丸め）。NaN が混入すると reduce の結果・週合計・XP計算まで汚染され、
 * さらに JSON.stringify(NaN) は null になるため localStorage に null として永続化され
 * 以降の計算が恒久的に壊れる。
 */
export function calcVolume(sets) {
  return sets.reduce((sum, s) => {
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    return sum + Math.max(0, w) * r;
  }, 0);
}

/**
 * 週ごとの総挙上量。週キーの昇順で返す。
 * 返す配列は疎(sparse)である: トレーニングの無い週は要素自体が存在しないので、
 * 呼び出し側は連続した週番号の並びだとみなしてはならない（間の週を0として補完したい
 * 場合は呼び出し側で行うこと）。
 * 日付が不正な記録（weekKey が例外を投げる形式）は、集計前に黙って除外する。
 */
export function weeklyVolume(workouts) {
  const map = new Map();
  for (const w of workouts) {
    if (typeof w.date !== 'string' || !DATE_RE.test(w.date)) continue;
    const key = weekKey(w.date);
    const volume = w.volume ?? calcVolume(w.sets ?? []);
    map.set(key, (map.get(key) ?? 0) + volume);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, volume]) => ({ week, volume }));
}

/** その種目の直近の重量・回数（同一セッション内では最後に記録したセット）。無ければ null */
export function lastSetFor(workouts, exId) {
  const sorted = sortedByDate(workouts).reverse();
  for (const w of sorted) {
    const hit = (w.sets ?? []).filter((s) => s.exId === exId).pop();
    if (hit) return { weight: hit.weight, reps: hit.reps };
  }
  return null;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（累計36件）

- [ ] **Step 5: Commit**

```bash
git add js/workout.js test/workout.test.js
git commit -m "feat: ローテーション判定と総挙上量の集計を追加"
```

---

## Task 5: workout.js — PB判定とバドミントン警告

**Files:**
- Modify: `js/workout.js`
- Modify: `test/workout.test.js`

- [ ] **Step 1: 失敗するテストを追記**

`test/workout.test.js` の末尾に追記（import 行も更新する）:

```js
import { isPB, updateBests, warnsBadmintonAfterLegs } from '../js/workout.js';

test('記録が無ければ最初のセットはPB', () => {
  assert.equal(isPB({}, 'seated_row', 30, 10), true);
});

test('重量が上回ればPB', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  assert.equal(isPB(bests, 'seated_row', 32.5, 8), true);
});

test('同じ重量で回数が上回ればPB', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  assert.equal(isPB(bests, 'seated_row', 30, 11), true);
});

test('同じ重量で回数が同じならPBではない', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  assert.equal(isPB(bests, 'seated_row', 30, 10), false);
});

test('重量が下がれば回数が多くてもPBではない', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  assert.equal(isPB(bests, 'seated_row', 27.5, 20), false);
});

test('updateBests は元のオブジェクトを壊さない', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  const next = updateBests(bests, 'seated_row', 32.5, 8, '2026-07-29');
  assert.equal(bests.seated_row.weight, 30);
  assert.equal(next.seated_row.weight, 32.5);
  assert.equal(next.seated_row.date, '2026-07-29');
});

test('PBでなければ updateBests は同じ内容を返す', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  const next = updateBests(bests, 'seated_row', 27.5, 8, '2026-07-29');
  assert.deepEqual(next.seated_row, bests.seated_row);
});

test('脚の日（C）の翌日にバドミントンを入れると警告する', () => {
  const workouts = [{ date: '2026-07-29', program: 'C' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2026-07-30'), true);
});

test('脚の日の2日後なら警告しない', () => {
  const workouts = [{ date: '2026-07-29', program: 'C' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2026-07-31'), false);
});

test('AやBの翌日は警告しない', () => {
  const workouts = [{ date: '2026-07-29', program: 'A' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2026-07-30'), false);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL - `isPB is not a function` 等

- [ ] **Step 3: `js/workout.js` に追記**

```js
/** 重量優先、同重量なら回数で自己ベストを判定する */
export function isPB(bests, exId, weight, reps) {
  const best = bests[exId];
  if (!best) return true;
  if (weight > best.weight) return true;
  if (weight === best.weight && reps > best.reps) return true;
  return false;
}

/**
 * PBのときだけ更新した新しい bests を返す（元は変更しない）。
 * これは浅いコピー（shallow copy）である: 更新していない種目のエントリは入力の
 * オブジェクトと参照を共有している。呼び出し側は `next[otherExId].reps++` のような
 * 入れ子側の書き換えをしてはならない（元の bests を壊してしまう）。
 */
export function updateBests(bests, exId, weight, reps, date) {
  if (!isPB(bests, exId, weight, reps)) return { ...bests };
  return { ...bests, [exId]: { weight, reps, date } };
}

/** 脚の日（C）の翌日にバドミントンを入れようとしていれば true */
export function warnsBadmintonAfterLegs(workouts, badmintonDate) {
  const target = new Date(badmintonDate + 'T00:00:00Z');
  const prev = new Date(target);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const prevStr = prev.toISOString().slice(0, 10);
  return workouts.some((w) => w.date === prevStr && w.program === 'C');
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（累計55件）

- [ ] **Step 5: Commit**

```bash
git add js/workout.js test/workout.test.js
git commit -m "feat: PB判定と脚の日翌日のバドミントン警告を追加"
```

---

## Task 6: nutrition.js — 日次集計と死守2項目

**Files:**
- Create: `js/nutrition.js`
- Create: `data/foods.json`
- Test: `test/nutrition.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/nutrition.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayTotals, achievement, sortFoodsByUse, bumpFoodUse } from '../js/nutrition.js';

const TARGETS = { protein: 100, kcalMin: 1700, kcalMax: 1800, kcalFloor: 1500, alcoholMl: 500 };

const MEALS = [
  { id: 'm1', datetime: '2026-07-29T07:00', items: [{ name: 'プロテイン', kcal: 120, protein: 24 }] },
  { id: 'm2', datetime: '2026-07-29T19:00', items: [
      { name: '唐揚げ', kcal: 600, protein: 35 },
      { name: 'ごはん150g', kcal: 234, protein: 4 }
  ] },
  { id: 'm3', datetime: '2026-07-29T21:00', items: [{ name: '発泡酒500ml', kcal: 150, protein: 0, alcoholMl: 500 }] },
  { id: 'm4', datetime: '2026-07-28T19:00', items: [{ name: '別の日', kcal: 999, protein: 99 }] }
];

test('その日の合計だけを集計する', () => {
  const t = dayTotals(MEALS, '2026-07-29');
  assert.equal(t.kcal, 120 + 600 + 234 + 150);
  assert.equal(t.protein, 24 + 35 + 4);
  assert.equal(t.alcoholMl, 500);
});

test('記録が無い日は0になる', () => {
  assert.deepEqual(dayTotals(MEALS, '2026-01-01'), { kcal: 0, protein: 0, alcoholMl: 0 });
});

test('達成率を返す', () => {
  const a = achievement({ kcal: 1750, protein: 100, alcoholMl: 500 }, TARGETS);
  assert.equal(a.proteinPct, 100);
  assert.equal(a.kcalPct, 100);
  assert.equal(a.alcoholOver, false);
  assert.deepEqual(a.warnings, []);
});

test('1500kcal未満は「食べなさすぎ」警告を出す', () => {
  const a = achievement({ kcal: 1200, protein: 100, alcoholMl: 0 }, TARGETS);
  assert.ok(a.warnings.some((w) => w.level === 'danger' && w.type === 'kcalFloor'));
});

test('1000kcal台は筋肉が削れる領域としてより強い警告を出す', () => {
  const a = achievement({ kcal: 1000, protein: 100, alcoholMl: 0 }, TARGETS);
  const w = a.warnings.find((x) => x.type === 'kcalFloor');
  assert.equal(w.level, 'danger');
  assert.match(w.message, /筋肉/);
});

test('目標上限を超えると軽い注意のみ（下限割れより弱い）', () => {
  const a = achievement({ kcal: 2200, protein: 100, alcoholMl: 0 }, TARGETS);
  const w = a.warnings.find((x) => x.type === 'kcalOver');
  assert.equal(w.level, 'info');
});

test('タンパク質不足を警告する', () => {
  const a = achievement({ kcal: 1750, protein: 60, alcoholMl: 0 }, TARGETS);
  assert.ok(a.warnings.some((w) => w.type === 'proteinShort'));
});

test('発泡酒が500mlを超えると注意する', () => {
  const a = achievement({ kcal: 1750, protein: 100, alcoholMl: 1000 }, TARGETS);
  assert.equal(a.alcoholOver, true);
});

test('食品は使用回数の多い順に並ぶ', () => {
  const foods = [
    { id: 'f1', name: 'ゆで卵', useCount: 3 },
    { id: 'f2', name: 'プロテイン', useCount: 20 },
    { id: 'f3', name: '唐揚げ', useCount: 7 }
  ];
  assert.deepEqual(sortFoodsByUse(foods).map((f) => f.id), ['f2', 'f3', 'f1']);
});

test('bumpFoodUse は使用回数を1増やした新しい配列を返す', () => {
  const foods = [{ id: 'f1', name: 'ゆで卵', useCount: 3 }];
  const next = bumpFoodUse(foods, 'f1');
  assert.equal(foods[0].useCount, 3);
  assert.equal(next[0].useCount, 4);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL - `Cannot find module '../js/nutrition.js'`

- [ ] **Step 3: `js/nutrition.js` を実装**

```js
/** その日の kcal / タンパク質 / アルコール量を合計する */
export function dayTotals(meals, dateStr) {
  const totals = { kcal: 0, protein: 0, alcoholMl: 0 };
  for (const meal of meals) {
    if (!meal.datetime.startsWith(dateStr)) continue;
    for (const item of meal.items ?? []) {
      totals.kcal += item.kcal ?? 0;
      totals.protein += item.protein ?? 0;
      totals.alcoholMl += item.alcoholMl ?? 0;
    }
  }
  return totals;
}

/**
 * 達成率と警告を返す。
 * 設計方針: 上限超過より「下限割れ」を重く扱う。摂取を削るほど目的から遠ざかるため。
 */
export function achievement(totals, targets) {
  const warnings = [];

  if (totals.kcal > 0 && totals.kcal < targets.kcalFloor) {
    warnings.push({
      type: 'kcalFloor',
      level: 'danger',
      message: `${Math.round(totals.kcal)}kcal は少なすぎます。この水準が続くと筋肉が分解されて目的と逆方向に進みます`
    });
  } else if (totals.kcal > targets.kcalMax) {
    warnings.push({
      type: 'kcalOver',
      level: 'info',
      message: `目標を${Math.round(totals.kcal - targets.kcalMax)}kcal超えています`
    });
  }

  if (totals.protein > 0 && totals.protein < targets.protein) {
    warnings.push({
      type: 'proteinShort',
      level: 'warn',
      message: `タンパク質があと${Math.round(targets.protein - totals.protein)}g足りません`
    });
  }

  return {
    proteinPct: Math.round((totals.protein / targets.protein) * 100),
    kcalPct: Math.round((totals.kcal / targets.kcalMax) * 100),
    alcoholOver: totals.alcoholMl > targets.alcoholMl,
    warnings
  };
}

/** 使用回数の多い順。同数なら名前順で安定させる */
export function sortFoodsByUse(foods) {
  return [...foods].sort((a, b) => {
    const diff = (b.useCount ?? 0) - (a.useCount ?? 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'ja');
  });
}

/** 使用回数を1増やした新しい配列を返す（元は変更しない） */
export function bumpFoodUse(foods, foodId) {
  return foods.map((f) => (f.id === foodId ? { ...f, useCount: (f.useCount ?? 0) + 1 } : f));
}
```

- [ ] **Step 4: `data/foods.json` を作る**

会話で出てきた常用品を初期セットにする。`useCount` は初期の並び順を意図した値。

```json
[
  { "id": "protein_shake", "name": "プロテイン 1杯", "unit": "杯",  "kcal": 120, "protein": 24, "useCount": 10 },
  { "id": "boiled_egg",    "name": "ゆで卵",         "unit": "個",  "kcal": 76,  "protein": 6,  "useCount": 8 },
  { "id": "salad_chicken", "name": "サラダチキン",   "unit": "個",  "kcal": 114, "protein": 25, "useCount": 7 },
  { "id": "onigiri",       "name": "おにぎり",       "unit": "個",  "kcal": 180, "protein": 3,  "useCount": 6 },
  { "id": "happoshu_500",  "name": "発泡酒 500ml",   "unit": "本",  "kcal": 150, "protein": 0,  "alcoholMl": 500, "useCount": 9 },
  { "id": "karaage",       "name": "唐揚げ",         "unit": "人前","kcal": 600, "protein": 35, "useCount": 5 },
  { "id": "rice_150",      "name": "ごはん 150g",    "unit": "杯",  "kcal": 234, "protein": 4,  "useCount": 5 }
]
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（累計65件）

- [ ] **Step 6: Commit**

```bash
git add js/nutrition.js data/foods.json test/nutrition.test.js
git commit -m "feat: 食事集計と死守2項目の判定を追加"
```

---

## Task 7: game.js — XPと部位レベル

**Files:**
- Create: `js/game.js`
- Test: `test/game.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/game.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTS, levelFromXp, addWorkoutXp, radarData } from '../js/game.js';

const EXERCISES = [
  { id: 'lat_pulldown', part: 'back' },
  { id: 'seated_row', part: 'back' },
  { id: 'biceps_curl', part: 'arm' }
];

test('6部位が定義されている', () => {
  assert.deepEqual(PARTS, ['chest', 'back', 'shoulder', 'leg', 'arm', 'abs']);
});

test('レベルは floor(sqrt(XP/100))', () => {
  assert.equal(levelFromXp(0), 0);
  assert.equal(levelFromXp(99), 0);
  assert.equal(levelFromXp(100), 1);
  assert.equal(levelFromXp(400), 2);
  assert.equal(levelFromXp(900), 3);
  assert.equal(levelFromXp(899), 2);
});

test('XPは部位ごとに 総挙上量/10 が加算される', () => {
  const workout = {
    date: '2026-07-29',
    program: 'B',
    sets: [
      { exId: 'lat_pulldown', weight: 35, reps: 10 }, // 350
      { exId: 'seated_row', weight: 30, reps: 10 },   // 300
      { exId: 'biceps_curl', weight: 15, reps: 10 }   // 150
    ]
  };
  const xp = addWorkoutXp({ chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 }, workout, EXERCISES);
  assert.equal(xp.back, 65);  // (350+300)/10
  assert.equal(xp.arm, 15);   // 150/10
  assert.equal(xp.chest, 0);
});

test('addWorkoutXp は元のXPを壊さない', () => {
  const before = { chest: 0, back: 100, shoulder: 0, leg: 0, arm: 0, abs: 0 };
  const workout = { date: '2026-07-29', program: 'B', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] };
  addWorkoutXp(before, workout, EXERCISES);
  assert.equal(before.back, 100);
});

test('未知の種目IDは無視する', () => {
  const workout = { date: '2026-07-29', program: 'B', sets: [{ exId: '存在しない', weight: 30, reps: 10 }] };
  const xp = addWorkoutXp({ chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 }, workout, EXERCISES);
  assert.equal(Object.values(xp).reduce((a, b) => a + b, 0), 0);
});

test('レーダー用データは6部位すべてのレベルを返す', () => {
  const data = radarData({ chest: 400, back: 900, shoulder: 0, leg: 100, arm: 0, abs: 0 });
  assert.equal(data.length, 6);
  assert.equal(data.find((d) => d.part === 'back').level, 3);
  assert.equal(data.find((d) => d.part === 'chest').label, '胸');
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL - `Cannot find module '../js/game.js'`

- [ ] **Step 3: `js/game.js` を実装**

```js
import { calcVolume } from './workout.js';

export const PARTS = ['chest', 'back', 'shoulder', 'leg', 'arm', 'abs'];

export const PART_LABELS = {
  chest: '胸', back: '背中', shoulder: '肩', leg: '脚', arm: '腕', abs: '腹'
};

/** レベルは固定式。バランス調整に時間を溶かさないため意図的に単純化している */
export function levelFromXp(xp) {
  return Math.floor(Math.sqrt(xp / 100));
}

/** 部位XPに1回分のトレーニングを加算した新しいオブジェクトを返す */
export function addWorkoutXp(xpMap, workout, exercises) {
  const partOf = new Map(exercises.map((e) => [e.id, e.part]));
  const next = { ...xpMap };
  for (const set of workout.sets ?? []) {
    const part = partOf.get(set.exId);
    if (!part || !PARTS.includes(part)) continue;
    next[part] = (next[part] ?? 0) + calcVolume([set]) / 10;
  }
  return next;
}

/** レーダーチャート用のデータ */
export function radarData(xpMap) {
  return PARTS.map((part) => ({
    part,
    label: PART_LABELS[part],
    xp: xpMap[part] ?? 0,
    level: levelFromXp(xpMap[part] ?? 0)
  }));
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（累計71件）

- [ ] **Step 5: Commit**

```bash
git add js/game.js test/game.test.js
git commit -m "feat: 部位XPとレベル計算を追加"
```

---

## Task 8: game.js — ストリークと初期4週間モード

**Files:**
- Modify: `js/game.js`
- Modify: `test/game.test.js`

- [ ] **Step 1: 失敗するテストを追記**

`test/game.test.js` の末尾に追記（import 行も更新する）:

```js
import { calcStreak, isInitialPhase, initialPhaseStatus } from '../js/game.js';

function gymWeek(mondayDate, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(mondayDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i * 2);
    out.push({ date: d.toISOString().slice(0, 10), program: 'A' });
  }
  return out;
}

test('週3回達成した週が連続していればストリークが伸びる', () => {
  const workouts = [
    ...gymWeek('2026-07-13', 3),
    ...gymWeek('2026-07-20', 3),
    ...gymWeek('2026-07-27', 3)
  ];
  assert.equal(calcStreak(workouts, '2026-07-29'), 3);
});

test('週2回しかできなかった週でストリークが切れる', () => {
  const workouts = [
    ...gymWeek('2026-07-13', 3),
    ...gymWeek('2026-07-20', 2),
    ...gymWeek('2026-07-27', 3)
  ];
  assert.equal(calcStreak(workouts, '2026-07-29'), 1);
});

test('進行中の週はまだ3回に達していなくてもストリークを切らない', () => {
  const workouts = [
    ...gymWeek('2026-07-20', 3),
    ...gymWeek('2026-07-27', 1) // 今週はまだ1回
  ];
  assert.equal(calcStreak(workouts, '2026-07-29'), 1);
});

test('記録が無ければ0', () => {
  assert.equal(calcStreak([], '2026-07-29'), 0);
});

test('開始から28日未満は初期モード', () => {
  assert.equal(isInitialPhase('2026-07-01', '2026-07-28'), true);
  assert.equal(isInitialPhase('2026-07-01', '2026-07-29'), false);
});

test('初期モードでは週3ジムと朝プロテインの2つだけを評価する', () => {
  const workouts = gymWeek('2026-07-27', 3);
  const meals = [
    { datetime: '2026-07-27T07:00', items: [{ name: 'プロテイン 1杯', kcal: 120, protein: 24 }] },
    { datetime: '2026-07-28T07:30', items: [{ name: 'プロテイン 1杯', kcal: 120, protein: 24 }] }
  ];
  const s = initialPhaseStatus(workouts, meals, '2026-07-29');
  assert.equal(s.gymCount, 3);
  assert.equal(s.gymDone, true);
  assert.equal(s.proteinMornings, 2);
  assert.deepEqual(Object.keys(s).sort(), ['gymCount', 'gymDone', 'proteinMornings']);
});

test('朝プロテインは11時までの摂取だけを数える', () => {
  const meals = [
    { datetime: '2026-07-27T07:00', items: [{ name: 'プロテイン 1杯', kcal: 120, protein: 24 }] },
    { datetime: '2026-07-28T15:00', items: [{ name: 'プロテイン 1杯', kcal: 120, protein: 24 }] }
  ];
  assert.equal(initialPhaseStatus([], meals, '2026-07-29').proteinMornings, 1);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL - `calcStreak is not a function`

- [ ] **Step 3: `js/game.js` に追記**

まずファイル冒頭の import 行を書き換える（同じモジュールから2回importしないため）:

```js
import { calcVolume, weekKey } from './workout.js';
```

続けてファイル末尾に追記する:

```js
const GYM_PER_WEEK = 3;

function shiftWeeks(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * 連続週数。判定条件はジム3回のみ。
 * 食事や写真を条件に足すと切れやすくなり、ストリークの意味が失われるため意図的に含めない。
 * 進行中の今週はまだ未達でも切らない（達成していればカウントする）。
 */
export function calcStreak(workouts, todayStr) {
  const counts = new Map();
  for (const w of workouts) {
    const key = weekKey(w.date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const thisWeek = weekKey(todayStr);
  let streak = 0;
  let cursor = todayStr;
  let first = true;
  while (true) {
    const key = weekKey(cursor);
    const count = counts.get(key) ?? 0;
    if (count >= GYM_PER_WEEK) {
      streak += 1;
    } else if (first && key === thisWeek) {
      // 進行中の週は未達でも遡り続ける
    } else {
      break;
    }
    first = false;
    cursor = shiftWeeks(cursor, -1);
  }
  return streak;
}

/** 開始から28日未満なら初期モード */
export function isInitialPhase(startDate, todayStr) {
  if (!startDate) return false;
  const days = (new Date(todayStr + 'T00:00:00Z') - new Date(startDate + 'T00:00:00Z')) / 86400000;
  return days < 28;
}

/**
 * 初期4週間で追跡する2項目だけを返す。
 * 「まず週3ジムと朝プロテインだけ習慣化できれば、あとは自動的に進む」という方針に対応。
 */
export function initialPhaseStatus(workouts, meals, todayStr) {
  const thisWeek = weekKey(todayStr);
  const gymCount = workouts.filter((w) => weekKey(w.date) === thisWeek).length;

  const proteinMornings = new Set();
  for (const meal of meals) {
    const [date, time = ''] = meal.datetime.split('T');
    if (weekKey(date) !== thisWeek) continue;
    const hour = Number(time.slice(0, 2));
    if (Number.isNaN(hour) || hour >= 11) continue;
    const hasProtein = (meal.items ?? []).some((i) => i.name.includes('プロテイン'));
    if (hasProtein) proteinMornings.add(date);
  }

  return { gymCount, gymDone: gymCount >= GYM_PER_WEEK, proteinMornings: proteinMornings.size };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（累計78件）

- [ ] **Step 5: Commit**

```bash
git add js/game.js test/game.test.js
git commit -m "feat: 週単位ストリークと初期4週間モードを追加"
```

---

## Task 9: game.js — 称号

**Files:**
- Modify: `js/game.js`
- Modify: `test/game.test.js`

- [ ] **Step 1: 失敗するテストを追記**

```js
import { BADGES, checkBadges } from '../js/game.js';

test('称号は id・name・説明を持つ', () => {
  for (const b of BADGES) {
    assert.ok(b.id && b.name && b.desc);
  }
});

test('初回トレーニングで「初心者ボーナス期」を獲得する', () => {
  const earned = checkBadges({
    workouts: [{ date: '2026-07-29', program: 'A', volume: 1000 }],
    body: [], streak: 0, xp: { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 },
    comparedPhotos: false, badges: []
  });
  assert.ok(earned.includes('first_workout'));
});

test('すでに持っている称号は再度返さない', () => {
  const earned = checkBadges({
    workouts: [{ date: '2026-07-29', program: 'A', volume: 1000 }],
    body: [], streak: 0, xp: { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 },
    comparedPhotos: false, badges: ['first_workout']
  });
  assert.ok(!earned.includes('first_workout'));
});

test('4週連続で「習慣化」を獲得する', () => {
  const earned = checkBadges({
    workouts: [], body: [], streak: 4,
    xp: { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 },
    comparedPhotos: false, badges: []
  });
  assert.ok(earned.includes('habit_4w'));
});

test('体脂肪率が3%下がると「腹筋上部が割れた」を獲得する', () => {
  const earned = checkBadges({
    workouts: [], streak: 0,
    body: [
      { date: '2026-04-29', weight: 60, muscle: 45, fatPct: 20 },
      { date: '2026-07-29', weight: 60, muscle: 47, fatPct: 17 }
    ],
    xp: { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 },
    comparedPhotos: false, badges: []
  });
  assert.ok(earned.includes('abs_visible'));
});

test('比較ビューを開くと「定点観測」を獲得する', () => {
  const earned = checkBadges({
    workouts: [], body: [], streak: 0,
    xp: { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 },
    comparedPhotos: true, badges: []
  });
  assert.ok(earned.includes('photo_compare'));
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL - `BADGES is not defined`

- [ ] **Step 3: `js/game.js` に追記**

```js
/** 称号。到達点は会話で確認した現実的なラインに対応させている */
export const BADGES = [
  { id: 'first_workout', name: '初心者ボーナス期', desc: '初めてジムで記録をつけた' },
  { id: 'habit_4w',      name: '習慣化',           desc: '週3ジムを4週連続で達成した' },
  { id: 'shoulder_lv3',  name: '肩と胸に丸みが出た', desc: '胸と肩のレベルが3に到達した' },
  { id: 'abs_visible',   name: '腹筋上部が割れた',   desc: '体脂肪率が開始時から3%下がった' },
  { id: 'muscle_plus2',  name: '中身が変わった',     desc: '筋肉量が開始時から2kg増えた' },
  { id: 'photo_compare', name: '定点観測',         desc: '写真の比較ビューを開いた' },
  { id: 'volume_10t',    name: '10トン挙げた',      desc: '総挙上量の累計が10,000kgを超えた' }
];

/**
 * 未獲得のうち、条件を満たした称号IDを返す。
 * state: { workouts, body, streak, xp, comparedPhotos, badges }
 */
export function checkBadges(state) {
  const owned = new Set(state.badges ?? []);
  const earned = [];
  const add = (id, condition) => {
    if (condition && !owned.has(id)) earned.push(id);
  };

  add('first_workout', (state.workouts ?? []).length >= 1);
  add('habit_4w', (state.streak ?? 0) >= 4);
  add('shoulder_lv3', levelFromXp(state.xp?.chest ?? 0) >= 3 && levelFromXp(state.xp?.shoulder ?? 0) >= 3);
  add('photo_compare', state.comparedPhotos === true);

  const body = [...(state.body ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (body.length >= 2) {
    const first = body[0];
    const last = body[body.length - 1];
    add('abs_visible', first.fatPct - last.fatPct >= 3);
    add('muscle_plus2', last.muscle - first.muscle >= 2);
  }

  const totalVolume = (state.workouts ?? []).reduce((sum, w) => sum + (w.volume ?? 0), 0);
  add('volume_10t', totalVolume >= 10000);

  return earned;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（累計84件）

- [ ] **Step 5: Commit**

```bash
git add js/game.js test/game.test.js
git commit -m "feat: 称号の判定を追加"
```

---

## Task 10: body.js — 体組成の差分

**Files:**
- Create: `js/body.js`
- Test: `test/body.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`test/body.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { latestBody, bodyDiff, bodySeries } from '../js/body.js';

const BODY = [
  { date: '2026-04-29', weight: 60.0, muscle: 45.0, fatPct: 20.0, source: 'inbody' },
  { date: '2026-05-29', weight: 59.5, muscle: 45.8, fatPct: 18.5, source: 'inbody' },
  { date: '2026-07-29', weight: 59.8, muscle: 47.0, fatPct: 17.0, source: 'inbody' }
];

test('最新の記録を返す（配列順に依存しない）', () => {
  const shuffled = [BODY[2], BODY[0], BODY[1]];
  assert.equal(latestBody(shuffled).date, '2026-07-29');
});

test('記録が無ければ null', () => {
  assert.equal(latestBody([]), null);
});

test('開始時との差分を返す', () => {
  const d = bodyDiff(BODY);
  assert.equal(d.weight.toFixed(1), '-0.2');
  assert.equal(d.muscle.toFixed(1), '2.0');
  assert.equal(d.fatPct.toFixed(1), '-3.0');
});

test('指定日以降の最初の記録を基準にできる', () => {
  const d = bodyDiff(BODY, '2026-05-01');
  assert.equal(d.muscle.toFixed(1), '1.2');
});

test('記録が1件だけなら差分は0', () => {
  const d = bodyDiff([BODY[0]]);
  assert.deepEqual(d, { weight: 0, muscle: 0, fatPct: 0 });
});

test('グラフ用に日付昇順の3系列を返す', () => {
  const s = bodySeries(BODY);
  assert.deepEqual(s.labels, ['2026-04-29', '2026-05-29', '2026-07-29']);
  assert.deepEqual(s.muscle, [45.0, 45.8, 47.0]);
  assert.deepEqual(s.fatPct, [20.0, 18.5, 17.0]);
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npm test`
Expected: FAIL - `Cannot find module '../js/body.js'`

- [ ] **Step 3: `js/body.js` を実装**

```js
function sorted(body) {
  return [...body].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function latestBody(body) {
  const s = sorted(body);
  return s.length ? s[s.length - 1] : null;
}

/** 基準日以降の最初の記録と最新記録の差分。sinceを省略すると全期間 */
export function bodyDiff(body, since = null) {
  const s = sorted(body).filter((b) => (since ? b.date >= since : true));
  if (s.length === 0) return { weight: 0, muscle: 0, fatPct: 0 };
  const first = s[0];
  const last = s[s.length - 1];
  return {
    weight: last.weight - first.weight,
    muscle: last.muscle - first.muscle,
    fatPct: last.fatPct - first.fatPct
  };
}

/** 体重・筋肉量・体脂肪率を3本重ねて描くためのデータ */
export function bodySeries(body) {
  const s = sorted(body);
  return {
    labels: s.map((b) => b.date),
    weight: s.map((b) => b.weight),
    muscle: s.map((b) => b.muscle),
    fatPct: s.map((b) => b.fatPct)
  };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npm test`
Expected: PASS（累計90件）

- [ ] **Step 5: Commit**

```bash
git add js/body.js test/body.test.js
git commit -m "feat: 体組成の差分と系列データを追加"
```

---

## Task 11: HTMLシェルとスタイル

**Files:**
- Create: `index.html`
- Create: `css/style.css`
- Create: `js/ui.js`
- Create: `js/main.js`

このタスクは自動テスト対象外。ブラウザで手動確認する。

- [ ] **Step 1: `index.html` を作る**

```html
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0f1115">
<title>筋トレ管理</title>
<link rel="manifest" href="manifest.json">
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<header id="statusBar">
  <div class="bar"><span class="bar-label">🥩 タンパク質</span>
    <div class="track"><div class="fill" id="proteinFill"></div></div>
    <span class="bar-value" id="proteinValue">0 / 100g</span></div>
  <div class="bar"><span class="bar-label">🔥 カロリー</span>
    <div class="track"><div class="fill" id="kcalFill"></div></div>
    <span class="bar-value" id="kcalValue">0 / 1750</span></div>
  <div class="bar"><span class="bar-label">🍺 発泡酒</span>
    <div class="track"><div class="fill" id="alcoholFill"></div></div>
    <span class="bar-value" id="alcoholValue">0 / 500ml</span></div>
  <div id="warnings"></div>
</header>

<main>
  <section id="tab-home" class="tab"></section>
  <section id="tab-workout" class="tab hidden"></section>
  <section id="tab-meal" class="tab hidden"></section>
  <section id="tab-photo" class="tab hidden"></section>
  <section id="tab-record" class="tab hidden"></section>
  <section id="tab-settings" class="tab hidden"></section>
</main>

<nav id="tabbar">
  <button data-tab="home" class="active">🏠<span>ホーム</span></button>
  <button data-tab="workout">💪<span>トレ</span></button>
  <button data-tab="meal">🍽<span>食事</span></button>
  <button data-tab="photo">📷<span>写真</span></button>
  <button data-tab="record">📈<span>記録</span></button>
  <button data-tab="settings">⚙️<span>設定</span></button>
</nav>

<div id="toast" class="hidden"></div>

<script src="vendor/chart.umd.js"></script>
<script type="module" src="js/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: `css/style.css` を作る**

```css
:root {
  --bg: #0f1115; --panel: #181c24; --line: #262c38;
  --text: #e8ecf4; --muted: #8b95a8;
  --accent: #40e8ff; --pb: #ffd166; --danger: #ff5e6c; --ok: #4ade80;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: system-ui, -apple-system, "Noto Sans JP", sans-serif;
  padding-bottom: calc(64px + var(--safe-bottom));
}
.hidden { display: none !important; }

#statusBar { position: sticky; top: 0; z-index: 10; background: var(--panel);
  border-bottom: 1px solid var(--line); padding: 8px 12px; }
.bar { display: grid; grid-template-columns: 90px 1fr auto; gap: 8px;
  align-items: center; font-size: 12px; margin: 4px 0; }
.bar-label { color: var(--muted); }
.bar-value { font-variant-numeric: tabular-nums; }
.track { height: 8px; background: #0b0d12; border-radius: 4px; overflow: hidden; }
.fill { height: 100%; width: 0%; background: var(--accent); transition: width .3s; }
.fill.over { background: var(--danger); }
.fill.done { background: var(--ok); }

#warnings:empty { display: none; }
.warn { font-size: 12px; padding: 6px 8px; border-radius: 6px; margin-top: 6px; }
.warn.danger { background: #3a1218; color: #ffb3ba; border: 1px solid var(--danger); }
.warn.warn { background: #3a2f12; color: #ffe0a3; }
.warn.info { background: #12202e; color: #bcd8ff; }

main { padding: 12px; }
h2 { font-size: 16px; margin: 16px 0 8px; }
.card { background: var(--panel); border: 1px solid var(--line);
  border-radius: 12px; padding: 12px; margin-bottom: 12px; }
.big { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); font-size: 12px; }
.up { color: var(--ok); }

button { font: inherit; color: inherit; background: #222836;
  border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
button:active { transform: scale(.97); }
.primary { background: var(--accent); color: #04202a; border: none; font-weight: 700; }
.chips { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }

/* トレ画面 */
.ex { border-bottom: 1px solid var(--line); padding: 10px 0; }
.ex-head { display: flex; justify-content: space-between; align-items: baseline; }
.ex-name { font-weight: 600; }
.ex-last { font-size: 11px; color: var(--muted); }
.pb-hint { color: var(--pb); }
.ex-ctrl { display: flex; gap: 6px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
.ex-ctrl .num { min-width: 62px; text-align: center; font-variant-numeric: tabular-nums; }
.setbtn { width: 44px; height: 44px; border-radius: 22px; }
.setbtn.done { background: var(--accent); color: #04202a; border-color: var(--accent); }

#timer { position: fixed; right: 12px; bottom: calc(76px + var(--safe-bottom));
  background: var(--accent); color: #04202a; font-weight: 700;
  padding: 10px 14px; border-radius: 24px; }

/* 写真 */
.photo-stage { position: relative; background: #000; border-radius: 12px; overflow: hidden; }
.photo-stage video, .photo-stage img { width: 100%; display: block; }
.photo-stage .ghost { position: absolute; inset: 0; opacity: .35; pointer-events: none; }
.compare { position: relative; overflow: hidden; border-radius: 12px; }
.compare img { width: 100%; display: block; }
.compare .after { position: absolute; inset: 0; clip-path: inset(0 50% 0 0); }
.compare input[type=range] { width: 100%; margin-top: 8px; }

#tabbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20;
  display: grid; grid-template-columns: repeat(6, 1fr);
  background: var(--panel); border-top: 1px solid var(--line);
  padding-bottom: var(--safe-bottom); }
#tabbar button { background: none; border: none; border-radius: 0;
  padding: 8px 0; font-size: 18px; color: var(--muted); }
#tabbar button span { display: block; font-size: 10px; }
#tabbar button.active { color: var(--accent); }

#toast { position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(88px + var(--safe-bottom)); background: var(--pb); color: #2a1f00;
  font-weight: 700; padding: 10px 16px; border-radius: 20px; z-index: 30; }
```

- [ ] **Step 3: `js/ui.js` にタブ切替と共通部品を作る**

```js
export const $ = (sel) => document.querySelector(sel);

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
```

- [ ] **Step 4: `js/main.js` で起動処理を書く**

```js
import { createStore } from './store.js';
import { initTabs, todayStr } from './ui.js';

export const store = createStore();

async function loadSeed() {
  if (store.get('exercises').length === 0) {
    store.set('exercises', await (await fetch('data/exercises.json')).json());
  }
  if (store.get('foods').length === 0) {
    store.set('foods', await (await fetch('data/foods.json')).json());
  }
  const profile = store.get('profile');
  if (!profile.startDate) {
    store.set('profile', { ...profile, startDate: todayStr() });
  }
}

async function boot() {
  const repaired = store.validate();
  if (repaired.length) {
    console.warn('破損したデータを初期化しました:', repaired);
  }
  await loadSeed();
  initTabs();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
```

- [ ] **Step 5: ブラウザで確認**

Run: `python -m http.server 8080`（プロジェクト直下で実行）
ブラウザで `http://localhost:8080` を開く。
Expected: 上部に3本のバー、下部に6つのタブが表示される。タブをタップすると `active` の色が切り替わる。
`vendor/chart.umd.js`（Task 18で作成）と `sw.js`（Task 21で作成）の404はこの時点では正常。それ以外のコンソールエラーが出ないことを確認する。

- [ ] **Step 6: Commit**

```bash
git add index.html css/style.css js/ui.js js/main.js
git commit -m "feat: HTMLシェル・スタイル・タブ切替を追加"
```

---

## Task 12: 食事タブ（ワンタップ登録）

**Files:**
- Create: `js/mealTab.js`
- Modify: `js/main.js`

- [ ] **Step 1: `js/mealTab.js` を作る**

```js
import { $, onShow, toast, todayStr, nowStr } from './ui.js';
import { dayTotals, achievement, sortFoodsByUse, bumpFoodUse } from './nutrition.js';

let store;

export function initMealTab(s) {
  store = s;
  onShow('meal', renderMealTab);
  renderStatusBar();
}

/** 上部の死守2項目バーを更新する。食事を追加するたびに呼ぶ */
export function renderStatusBar() {
  const targets = store.get('profile').targets;
  const totals = dayTotals(store.get('meals'), todayStr());
  const a = achievement(totals, targets);

  const setBar = (fillId, valueId, pct, text, state) => {
    const fill = $(fillId);
    fill.style.width = `${Math.min(100, pct)}%`;
    fill.classList.toggle('over', state === 'over');
    fill.classList.toggle('done', state === 'done');
    $(valueId).textContent = text;
  };

  setBar('#proteinFill', '#proteinValue', a.proteinPct,
    `${Math.round(totals.protein)} / ${targets.protein}g`,
    totals.protein >= targets.protein ? 'done' : '');
  setBar('#kcalFill', '#kcalValue', a.kcalPct,
    `${Math.round(totals.kcal)} / ${targets.kcalMax}`,
    totals.kcal > targets.kcalMax ? 'over' : '');
  setBar('#alcoholFill', '#alcoholValue',
    (totals.alcoholMl / targets.alcoholMl) * 100,
    `${totals.alcoholMl} / ${targets.alcoholMl}ml`,
    a.alcoholOver ? 'over' : '');

  $('#warnings').innerHTML = a.warnings
    .map((w) => `<div class="warn ${w.level}">${w.message}</div>`)
    .join('');
}

/** ワンタップで1品追加する。食品の使用回数も増やして並び順を育てる */
export function addFoodById(foodId) {
  const food = store.get('foods').find((f) => f.id === foodId);
  if (!food) return;
  addItems([{ name: food.name, kcal: food.kcal, protein: food.protein, alcoholMl: food.alcoholMl ?? 0 }], 'tap');
  store.set('foods', bumpFoodUse(store.get('foods'), foodId));
  toast(`${food.name} を追加`);
}

/** 任意の品目群を1回の食事として記録する */
export function addItems(items, source) {
  const meals = store.get('meals');
  meals.push({ id: `m${Date.now()}`, datetime: nowStr(), items, source });
  store.set('meals', meals);
  renderStatusBar();
  renderMealTab();
}

export function renderMealTab() {
  const foods = sortFoodsByUse(store.get('foods'));
  const today = todayStr();
  const meals = store.get('meals').filter((m) => m.datetime.startsWith(today));

  $('#tab-meal').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">ワンタップ登録</h2>
      <div class="chips" id="foodChips">
        ${foods.map((f) => `<button data-food="${f.id}">${f.name}<br><span class="muted">${f.kcal}kcal / P${f.protein}g</span></button>`).join('')}
      </div>
      <div class="chips" style="margin-top:8px">
        <button id="btnBarcode">📷 バーコード</button>
        <button id="btnPhoto">🍱 食事写真</button>
        <button id="btnReceipt">🧾 レシート</button>
        <button id="btnManual">✏️ 手入力</button>
      </div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">今日の記録</h2>
      ${meals.length === 0 ? '<p class="muted">まだ記録がありません</p>' : ''}
      ${meals.map((m) => `
        <div class="ex">
          <div class="ex-head">
            <span>${m.datetime.slice(11)}</span>
            <button data-del="${m.id}">削除</button>
          </div>
          ${m.items.map((i) => `<div class="muted">${i.name} — ${i.kcal}kcal / P${i.protein}g</div>`).join('')}
        </div>`).join('')}
    </div>`;

  $('#foodChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-food]');
    if (btn) addFoodById(btn.dataset.food);
  });

  // #tab-meal は再描画されても要素自体は残るため、addEventListener だと
  // 描画のたびにハンドラが積み重なる。onclick 代入で常に1つに保つ
  $('#tab-meal').onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    store.set('meals', store.get('meals').filter((m) => m.id !== del.dataset.del));
    renderStatusBar();
    renderMealTab();
  };

  $('#btnManual').addEventListener('click', openManualDialog);
}

function openManualDialog() {
  const name = prompt('品目名');
  if (!name) return;
  const kcal = Number(prompt('カロリー(kcal)', '0'));
  const protein = Number(prompt('タンパク質(g)', '0'));
  if (Number.isNaN(kcal) || Number.isNaN(protein)) {
    toast('数値が読めませんでした');
    return;
  }
  addItems([{ name, kcal, protein }], 'manual');
}
```

- [ ] **Step 2: `js/main.js` に組み込む**

`boot()` の `initTabs()` の直前に以下を追加し、ファイル冒頭に import を足す:

```js
import { initMealTab } from './mealTab.js';
```

```js
  initMealTab(store);
```

- [ ] **Step 3: ブラウザで確認**

Run: `python -m http.server 8080`
`http://localhost:8080` → 食事タブ。
Expected: 7つの食品ボタンが並ぶ。「プロテイン 1杯」を押すと上部のタンパク質バーが24g分伸び、「今日の記録」に追加される。もう一度食事タブを開くと、押した食品が上位に移動している。

- [ ] **Step 4: Commit**

```bash
git add js/mealTab.js js/main.js
git commit -m "feat: 食事タブとワンタップ登録を追加"
```

---

## Task 13: トレタブ（✓タップ記録・タイマー・PB演出）

**Files:**
- Create: `js/workoutTab.js`
- Modify: `js/main.js`

- [ ] **Step 1: `js/workoutTab.js` を作る**

```js
import { $, onShow, toast, vibrate, todayStr } from './ui.js';
import { nextProgram, calcVolume, lastSetFor, isPB, updateBests } from './workout.js';
import { addWorkoutXp, checkBadges, BADGES, calcStreak } from './game.js';

const PROGRAM_NAMES = { A: '胸・肩・三頭', B: '背中・二頭', C: '脚・腹' };
const REST_SECONDS = 90;

let store;
let session = null; // { program, date, sets: [] }
let timerId = null;

export function initWorkoutTab(s) {
  store = s;
  onShow('workout', renderWorkoutTab);
}

function startSession() {
  session = { program: nextProgram(store.get('workouts')), date: todayStr(), sets: [] };
}

export function renderWorkoutTab() {
  if (!session) startSession();
  const exercises = store.get('exercises').filter((e) => e.program === session.program);
  const workouts = store.get('workouts');
  const bests = store.get('game').bests;

  $('#tab-workout').innerHTML = `
    <div class="card">
      <div class="ex-head">
        <div><span class="big">【${session.program}】</span> ${PROGRAM_NAMES[session.program]}</div>
        <button id="btnFinish" class="primary">終了して保存</button>
      </div>
      <div class="muted">今回の総挙上量 <span id="sessionVolume">0</span> kg</div>
    </div>
    <div class="card">
      ${exercises.map((ex) => renderExercise(ex, workouts, bests)).join('')}
    </div>`;

  // 再描画のたびにハンドラが積み重ならないよう onclick 代入にする
  $('#tab-workout').onclick = onExerciseClick;
  $('#btnFinish').addEventListener('click', finishSession);
  updateVolume();
}

function renderExercise(ex, workouts, bests) {
  const last = lastSetFor(workouts, ex.id);
  const weight = last?.weight ?? ex.defaultWeight;
  const reps = last?.reps ?? ex.defaultReps;
  const best = bests[ex.id];
  const hint = best ? `⚡ ${best.weight}kg×${best.reps}を超えると自己ベスト` : '';

  return `
    <div class="ex" data-ex="${ex.id}" data-step="${ex.step}">
      <div class="ex-head">
        <span class="ex-name">${ex.name}</span>
        <span class="ex-last">${last ? `前回 ${last.weight}×${last.reps}` : '初回'}</span>
      </div>
      ${hint ? `<div class="ex-last pb-hint">${hint}</div>` : ''}
      <div class="ex-ctrl">
        <button data-act="w-">−</button>
        <span class="num" data-field="weight">${weight}</span><span class="muted">kg</span>
        <button data-act="w+">＋</button>
        <button data-act="r-">−</button>
        <span class="num" data-field="reps">${reps}</span><span class="muted">回</span>
        <button data-act="r+">＋</button>
      </div>
      <div class="ex-ctrl">
        ${Array.from({ length: ex.sets }, (_, i) => `<button class="setbtn" data-act="set" data-index="${i}">✓</button>`).join('')}
      </div>
    </div>`;
}

function onExerciseClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const row = btn.closest('.ex');
  const exId = row.dataset.ex;
  const step = Number(row.dataset.step);
  const weightEl = row.querySelector('[data-field="weight"]');
  const repsEl = row.querySelector('[data-field="reps"]');

  switch (btn.dataset.act) {
    case 'w+': weightEl.textContent = Number(weightEl.textContent) + step; break;
    case 'w-': weightEl.textContent = Number(weightEl.textContent) - step; break;
    case 'r+': repsEl.textContent = Number(repsEl.textContent) + 1; break;
    case 'r-': repsEl.textContent = Math.max(1, Number(repsEl.textContent) - 1); break;
    case 'set': recordSet(btn, exId, Number(weightEl.textContent), Number(repsEl.textContent)); break;
  }
}

function recordSet(btn, exId, weight, reps) {
  if (btn.classList.contains('done')) return;
  btn.classList.add('done');
  session.sets.push({ exId, weight, reps });

  const bests = store.get('game').bests;
  if (isPB(bests, exId, weight, reps)) {
    const name = store.get('exercises').find((e) => e.id === exId)?.name ?? '';
    toast(`🏆 自己ベスト更新 ${name} ${weight}kg×${reps}`);
    vibrate([40, 60, 40]);
  }

  updateVolume();
  startRestTimer();
}

function updateVolume() {
  const el = $('#sessionVolume');
  if (el) el.textContent = Math.round(calcVolume(session.sets));
}

function startRestTimer() {
  clearInterval(timerId);
  let left = REST_SECONDS;
  let el = $('#timer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'timer';
    document.body.appendChild(el);
  }
  el.textContent = `⏱ ${left}`;
  timerId = setInterval(() => {
    left -= 1;
    el.textContent = `⏱ ${left}`;
    if (left <= 0) {
      clearInterval(timerId);
      el.remove();
      vibrate([200, 100, 200]);
    }
  }, 1000);
}

function finishSession() {
  if (session.sets.length === 0) {
    toast('セットが1つも記録されていません');
    return;
  }
  const workouts = store.get('workouts');
  const volume = calcVolume(session.sets);
  workouts.push({
    id: `w${Date.now()}`,
    date: session.date,
    program: session.program,
    sets: session.sets,
    volume
  });
  store.set('workouts', workouts);

  const game = store.get('game');
  let bests = game.bests;
  for (const s of session.sets) bests = updateBests(bests, s.exId, s.weight, s.reps, session.date);
  const xp = addWorkoutXp(game.xp, { sets: session.sets }, store.get('exercises'));
  const streak = calcStreak(workouts, todayStr());

  const earned = checkBadges({
    workouts, body: store.get('body'), streak, xp,
    comparedPhotos: game.badges.includes('photo_compare'),
    badges: game.badges
  });

  store.set('game', { ...game, bests, xp, streakWeeks: streak, badges: [...game.badges, ...earned] });

  for (const id of earned) {
    const badge = BADGES.find((b) => b.id === id);
    if (badge) toast(`🎖 称号解放「${badge.name}」`, 3000);
  }

  clearInterval(timerId);
  $('#timer')?.remove();
  toast(`保存しました（総挙上量 ${Math.round(volume)}kg）`);
  session = null;
  renderWorkoutTab();
}
```

- [ ] **Step 2: `js/main.js` に組み込む**

冒頭に import を追加:

```js
import { initWorkoutTab } from './workoutTab.js';
```

`initTabs()` の直前に追加:

```js
  initWorkoutTab(store);
```

- [ ] **Step 3: ブラウザで確認**

Run: `python -m http.server 8080`
トレタブを開く。
Expected:
- 「【A】胸・肩・三頭」と表示され、6種目が初期重量つきで並ぶ
- ✓を押すとボタンが水色に変わり、右下に90秒カウントダウンが出る
- 初回は全セットで「🏆 自己ベスト更新」のトーストが出る
- 「終了して保存」で総挙上量つきのトーストが出て、称号「初心者ボーナス期」が解放される
- 再度トレタブを開くと「【B】背中・二頭」に変わっている

- [ ] **Step 4: Commit**

```bash
git add js/workoutTab.js js/main.js
git commit -m "feat: トレタブの✓タップ記録・90秒タイマー・PB演出を追加"
```

---

## Task 14: photos.js（IndexedDB・外部通信なし）

**Files:**
- Create: `js/photos.js`

**重要:** このファイルには `fetch` / `XMLHttpRequest` / `navigator.sendBeacon` を一切書かない。体の写真が外部に出る経路を構造的に作らないための制約。

- [ ] **Step 1: `js/photos.js` を作る**

```js
// 体の写真専用のIndexedDBラッパー。
// 【重要】このファイルは外部通信APIを一切使わない。体の写真は端末外に出さない。

const DB_NAME = 'mt-photos';
const STORE = 'photos';
const MAX_EDGE = 1080;
const QUALITY = 0.8;

export const ANGLES = [
  { id: 'front', label: '正面' },
  { id: 'side', label: '横' },
  { id: 'back', label: '背面' }
];

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('date', 'date');
        os.createIndex('angle', 'angle');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function isAvailable() {
  try {
    const db = await openDb();
    db.close();
    return true;
  } catch {
    return false;
  }
}

/** 長辺1080pxへ縮小しJPEG圧縮したBlobを返す（1枚おおよそ200KB） */
export async function compressImage(source) {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
  return { blob, width, height };
}

export async function savePhoto({ date, angle, source }) {
  const { blob, width, height } = await compressImage(source);
  const db = await openDb();
  const id = await wrap(tx(db, 'readwrite').add({ date, angle, blob, width, height }));
  db.close();
  return id;
}

export async function listPhotos() {
  const db = await openDb();
  const all = await wrap(tx(db, 'readonly').getAll());
  db.close();
  return all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export async function latestByAngle(angle) {
  const all = await listPhotos();
  const hits = all.filter((p) => p.angle === angle);
  return hits.length ? hits[hits.length - 1] : null;
}

export async function firstByAngle(angle) {
  const all = await listPhotos();
  return all.find((p) => p.angle === angle) ?? null;
}

export async function deletePhoto(id) {
  const db = await openDb();
  await wrap(tx(db, 'readwrite').delete(id));
  db.close();
}

export function toUrl(photo) {
  return URL.createObjectURL(photo.blob);
}
```

- [ ] **Step 2: 外部通信APIを含まないことを確認**

Run: `grep -nE "fetch|XMLHttpRequest|sendBeacon|WebSocket" js/photos.js`
Expected: 出力なし（該当行が0件）

- [ ] **Step 3: Commit**

```bash
git add js/photos.js
git commit -m "feat: 体の写真用IndexedDB層を追加（外部通信を持たない）"
```

---

## Task 15: 写真タブ（撮影オーバーレイ・比較スライダー）

**Files:**
- Create: `js/photoTab.js`
- Modify: `js/main.js`

- [ ] **Step 1: `js/photoTab.js` を作る**

```js
import { $, onShow, toast, todayStr } from './ui.js';
import { ANGLES, savePhoto, listPhotos, latestByAngle, firstByAngle, toUrl, isAvailable, deletePhoto } from './photos.js';
import { BADGES, checkBadges, calcStreak } from './game.js';

let store;
let stream = null;
let currentAngle = 'front';

export function initPhotoTab(s) {
  store = s;
  onShow('photo', renderPhotoTab);
}

export async function renderPhotoTab() {
  if (!(await isAvailable())) {
    $('#tab-photo').innerHTML = '<div class="card">この端末では写真機能を利用できません（IndexedDBが使えません）。他の機能は通常どおり使えます。</div>';
    return;
  }

  $('#tab-photo').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">撮影</h2>
      <div class="chips" id="angleChips">
        ${ANGLES.map((a) => `<button data-angle="${a.id}" class="${a.id === currentAngle ? 'primary' : ''}">${a.label}</button>`).join('')}
      </div>
      <div class="photo-stage" id="stage" style="margin-top:8px">
        <video id="cam" playsinline muted></video>
        <img class="ghost hidden" id="ghost" alt="">
      </div>
      <p class="muted">前回の写真を薄く重ねています。輪郭を合わせて撮ると比較できる写真になります。</p>
      <div class="chips">
        <button id="btnShoot" class="primary">📷 撮影</button>
        <button id="btnFile">🖼 ファイルから</button>
      </div>
      <input type="file" id="filePicker" accept="image/*" class="hidden">
    </div>
    <div class="card">
      <h2 style="margin-top:0">比較</h2>
      <div class="chips">
        <button data-cmp="first">開始時と比較</button>
        <button data-cmp="3m">3ヶ月前と比較</button>
      </div>
      <div id="compareArea" style="margin-top:8px"></div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">タイムライン</h2>
      <div id="timeline"></div>
    </div>`;

  $('#angleChips').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-angle]');
    if (!btn) return;
    currentAngle = btn.dataset.angle;
    await renderPhotoTab();
  });

  $('#btnShoot').addEventListener('click', shoot);
  $('#btnFile').addEventListener('click', () => $('#filePicker').click());
  $('#filePicker').addEventListener('change', onFilePicked);
  // 再描画のたびにハンドラが積み重ならないよう onclick 代入にする
  $('#tab-photo').onclick = onCompareClick;

  await startCamera();
  await showGhost();
  await renderTimeline();
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const cam = $('#cam');
    cam.srcObject = stream;
    await cam.play();
  } catch {
    // カメラが使えなくてもファイル選択で記録できるようにする
    $('#cam').classList.add('hidden');
    toast('カメラを使えないため、ファイル選択で登録してください');
  }
}

export function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

/** 前回の同アングル写真を半透明で重ねる。構図を揃えるための補助 */
async function showGhost() {
  const prev = await latestByAngle(currentAngle);
  const ghost = $('#ghost');
  if (!prev) {
    ghost.classList.add('hidden');
    return;
  }
  ghost.src = toUrl(prev);
  ghost.classList.remove('hidden');
}

async function shoot() {
  const cam = $('#cam');
  if (!stream) {
    toast('カメラが使えません');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = cam.videoWidth;
  canvas.height = cam.videoHeight;
  canvas.getContext('2d').drawImage(cam, 0, 0);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
  await savePhoto({ date: todayStr(), angle: currentAngle, source: blob });
  toast('保存しました');
  await showGhost();
  await renderTimeline();
}

async function onFilePicked(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  await savePhoto({ date: todayStr(), angle: currentAngle, source: file });
  e.target.value = '';
  toast('保存しました');
  await showGhost();
  await renderTimeline();
}

async function onCompareClick(e) {
  const btn = e.target.closest('[data-cmp]');
  if (!btn) return;

  const after = await latestByAngle(currentAngle);
  const before = btn.dataset.cmp === 'first'
    ? await firstByAngle(currentAngle)
    : await photoNearMonthsAgo(currentAngle, 3);

  if (!before || !after || before.id === after.id) {
    $('#compareArea').innerHTML = '<p class="muted">比較には同じアングルの写真が2枚以上必要です。</p>';
    return;
  }

  const bodyAt = (date) => {
    const hit = [...store.get('body')].sort((a, b) => (a.date < b.date ? -1 : 1))
      .filter((b) => b.date <= date).pop();
    return hit ? `筋肉量 ${hit.muscle}kg / 体脂肪 ${hit.fatPct}%` : '体組成の記録なし';
  };

  $('#compareArea').innerHTML = `
    <div class="compare">
      <img src="${toUrl(before)}" alt="">
      <img class="after" id="afterImg" src="${toUrl(after)}" alt="">
    </div>
    <input type="range" id="cmpRange" min="0" max="100" value="50">
    <div class="muted">${before.date}: ${bodyAt(before.date)}</div>
    <div class="muted">${after.date}: ${bodyAt(after.date)}</div>`;

  $('#cmpRange').addEventListener('input', (ev) => {
    $('#afterImg').style.clipPath = `inset(0 ${100 - ev.target.value}% 0 0)`;
  });

  grantCompareBadge();
}

async function photoNearMonthsAgo(angle, months) {
  const target = new Date();
  target.setMonth(target.getMonth() - months);
  const targetStr = target.toISOString().slice(0, 10);
  const all = (await listPhotos()).filter((p) => p.angle === angle);
  if (all.length === 0) return null;
  return all.reduce((best, p) =>
    Math.abs(new Date(p.date) - new Date(targetStr)) < Math.abs(new Date(best.date) - new Date(targetStr)) ? p : best);
}

function grantCompareBadge() {
  const game = store.get('game');
  const earned = checkBadges({
    workouts: store.get('workouts'), body: store.get('body'),
    streak: calcStreak(store.get('workouts'), todayStr()),
    xp: game.xp, comparedPhotos: true, badges: game.badges
  });
  if (earned.length === 0) return;
  store.set('game', { ...game, badges: [...game.badges, ...earned] });
  for (const id of earned) {
    const badge = BADGES.find((b) => b.id === id);
    if (badge) toast(`🎖 称号解放「${badge.name}」`, 3000);
  }
}

async function renderTimeline() {
  const all = await listPhotos();
  $('#timeline').innerHTML = all.length === 0
    ? '<p class="muted">まだ写真がありません</p>'
    : all.map((p) => `
        <div class="ex">
          <div class="ex-head">
            <span>${p.date} / ${ANGLES.find((a) => a.id === p.angle)?.label ?? p.angle}</span>
            <button data-delphoto="${p.id}">削除</button>
          </div>
          <img src="${toUrl(p)}" style="width:80px;border-radius:6px" alt="">
        </div>`).join('');

  $('#timeline').onclick = async (e) => {
    const btn = e.target.closest('[data-delphoto]');
    if (!btn) return;
    if (!confirm('この写真を削除しますか？（元に戻せません）')) return;
    await deletePhoto(Number(btn.dataset.delphoto));
    await renderTimeline();
    await showGhost();
  };
}
```

- [ ] **Step 2: `js/main.js` に組み込み、タブ離脱時にカメラを止める**

冒頭に import を追加:

```js
import { initPhotoTab, stopCamera } from './photoTab.js';
```

`initTabs()` の直前に追加:

```js
  initPhotoTab(store);
```

`boot()` の末尾に追加（写真タブ以外に移動したらカメラを解放する）:

```js
  document.querySelectorAll('#tabbar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab !== 'photo') stopCamera();
    });
  });
```

- [ ] **Step 3: ブラウザで確認**

Run: `python -m http.server 8080`
※ カメラは `http://localhost` では動作するが、他端末から見る場合は HTTPS が必要。Android実機での確認は Task 22 のデプロイ後に行う。

Expected（PCのブラウザ）:
- 写真タブでカメラ許可を求められる
- 「ファイルから」で画像を選ぶとタイムラインに追加される
- 2枚目を追加すると、カメラ映像の上に前回写真が薄く重なる
- 同じアングルで2枚以上あるとき「開始時と比較」でスライダー比較が出て、称号「定点観測」が解放される
- 他タブに移動するとカメラのインジケータが消える

- [ ] **Step 4: Commit**

```bash
git add js/photoTab.js js/main.js
git commit -m "feat: 写真タブの撮影オーバーレイと比較スライダーを追加"
```

---

## Task 16: barcode.js（バーコード読み取り）

**Files:**
- Create: `js/barcode.js`
- Modify: `js/mealTab.js`

- [ ] **Step 1: `js/barcode.js` を作る**

```js
// バーコードから食品を特定する。外部に送るのはJANコード13桁のみ。

const OFF_ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product/';

export function isBarcodeSupported() {
  return 'BarcodeDetector' in globalThis;
}

/** カメラ映像からJANコードを1件読み取る。timeoutMs内に読めなければ null */
export async function scanJan(videoEl, timeoutMs = 15000) {
  if (!isBarcodeSupported()) return null;
  const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const codes = await detector.detect(videoEl);
      if (codes.length) return codes[0].rawValue;
    } catch {
      return null;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

/** ローカルのマイメニューを先に見る。無ければ Open Food Facts に問い合わせる */
export async function lookupJan(jan, foods, useOpenFoodFacts) {
  const local = foods.find((f) => f.jan === jan);
  if (local) return { source: 'local', food: local };
  if (!useOpenFoodFacts) return null;

  try {
    const res = await fetch(`${OFF_ENDPOINT}${encodeURIComponent(jan)}.json?fields=product_name,product_name_ja,nutriments`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const n = data.product.nutriments ?? {};
    const kcal = n['energy-kcal_serving'] ?? n['energy-kcal_100g'];
    const protein = n.proteins_serving ?? n.proteins_100g;
    if (kcal === undefined || protein === undefined) return null;
    return {
      source: 'openfoodfacts',
      food: {
        id: `jan_${jan}`,
        jan,
        name: data.product.product_name_ja || data.product.product_name || `商品 ${jan}`,
        unit: '個',
        kcal: Math.round(kcal),
        protein: Math.round(protein * 10) / 10,
        useCount: 0
      }
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: `js/mealTab.js` にバーコードボタンの処理を追加**

冒頭の import に追加:

```js
import { isBarcodeSupported, scanJan, lookupJan } from './barcode.js';
```

`renderMealTab()` の末尾（`$('#btnManual').addEventListener(...)` の直後）に追加:

```js
  const barcodeBtn = $('#btnBarcode');
  if (!isBarcodeSupported()) {
    barcodeBtn.classList.add('hidden');
  } else {
    barcodeBtn.addEventListener('click', scanBarcode);
  }
```

同ファイルの末尾に追加:

```js
/** バーコードを読み、未知の商品は1回だけ手入力してマイメニューに育てる */
async function scanBarcode() {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  let mediaStream;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    toast('カメラを使えません');
    return;
  }
  video.srcObject = mediaStream;
  await video.play();

  const stage = document.createElement('div');
  stage.className = 'card photo-stage';
  stage.appendChild(video);
  $('#tab-meal').prepend(stage);
  toast('バーコードをかざしてください');

  const jan = await scanJan(video);
  mediaStream.getTracks().forEach((t) => t.stop());
  stage.remove();

  if (!jan) {
    toast('読み取れませんでした');
    return;
  }

  const hit = await lookupJan(jan, store.get('foods'), store.get('settings').useOpenFoodFacts);
  if (hit) {
    if (hit.source === 'openfoodfacts') {
      store.set('foods', [...store.get('foods'), hit.food]);
    }
    addFoodById(hit.food.id);
    return;
  }

  const name = prompt(`未登録の商品です（${jan}）\n品名を入力すると次回から自動登録されます`);
  if (!name) return;
  const kcal = Number(prompt('カロリー(kcal)', '0'));
  const protein = Number(prompt('タンパク質(g)', '0'));
  if (Number.isNaN(kcal) || Number.isNaN(protein)) {
    toast('数値が読めませんでした');
    return;
  }
  const food = { id: `jan_${jan}`, jan, name, unit: '個', kcal, protein, useCount: 0 };
  store.set('foods', [...store.get('foods'), food]);
  addFoodById(food.id);
}
```

- [ ] **Step 3: ブラウザで確認**

Run: `python -m http.server 8080`
Expected:
- BarcodeDetector 非対応のブラウザ（Firefox / Safari）ではバーコードボタンが表示されない
- Chrome では押すとカメラが起動し、商品バーコードを読むと商品名の入力を求められる（または Open Food Facts から自動取得される）
- 登録後は食事タブのボタン一覧に増えている

- [ ] **Step 4: Commit**

```bash
git add js/barcode.js js/mealTab.js
git commit -m "feat: バーコード読み取りとOpen Food Facts照会を追加"
```

---

## Task 17: ocr.js（食事写真・レシート）

**Files:**
- Create: `js/ocr.js`
- Modify: `js/mealTab.js`

**重要:** `ocr.js` に渡してよいのは食事写真とレシートのみ。体の写真は `photos.js` の管轄で、このモジュールを経由しない。

- [ ] **Step 1: `js/ocr.js` を作る**

```js
// 食事写真とレシートだけをGemini APIに送る。体の写真はこのモジュールを通らない。

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const MEAL_PROMPT = `この写真に写っている食べ物を推定してください。
日本の一般的な食品の栄養値を使い、1品ごとに名前・カロリー(kcal)・タンパク質(g)を返してください。
飲み物にアルコールが含まれる場合は alcoholMl にmL数を入れてください。
JSONのみを返してください。説明文は不要です。
形式: {"items":[{"name":"...","kcal":0,"protein":0,"alcoholMl":0}]}`;

const RECEIPT_PROMPT = `このレシートから飲食物の品目だけを抽出してください。
日用品・雑貨・レジ袋などの食べ物でないものは除外してください。
各品目について日本の一般的な栄養値でカロリー(kcal)とタンパク質(g)を推定してください。
アルコール飲料は alcoholMl にmL数を入れてください。
JSONのみを返してください。説明文は不要です。
形式: {"items":[{"name":"...","kcal":0,"protein":0,"alcoholMl":0}]}`;

export class OcrError extends Error {}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new OcrError('画像を読み込めませんでした'));
    reader.readAsDataURL(blob);
  });
}

async function callGemini(prompt, blob, apiKey) {
  if (!apiKey) throw new OcrError('APIキーが設定されていません');
  if (!navigator.onLine) throw new OcrError('オフラインのため解析できません');

  const base64 = await blobToBase64(blob);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  let res;
  try {
    res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: blob.type || 'image/jpeg', data: base64 } }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });
  } catch {
    throw new OcrError('解析に失敗しました（通信エラー）');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new OcrError(`解析に失敗しました（HTTP ${res.status}）`);

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new OcrError('解析結果を読み取れませんでした');

  return parseItems(text);
}

/** モデルの出力から品目配列を取り出す。数値でない値は0に落として必ず配列を返す */
export function parseItems(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OcrError('解析結果の形式が不正です');
  }
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  if (items.length === 0) throw new OcrError('食べ物を認識できませんでした');
  return items.map((i) => ({
    name: String(i.name ?? '不明'),
    kcal: Number(i.kcal) || 0,
    protein: Number(i.protein) || 0,
    alcoholMl: Number(i.alcoholMl) || 0
  }));
}

export function analyzeMealPhoto(blob, apiKey) {
  return callGemini(MEAL_PROMPT, blob, apiKey);
}

export function analyzeReceipt(blob, apiKey) {
  return callGemini(RECEIPT_PROMPT, blob, apiKey);
}
```

- [ ] **Step 2: `js/mealTab.js` に写真・レシート処理を追加**

冒頭の import に追加:

```js
import { analyzeMealPhoto, analyzeReceipt, OcrError } from './ocr.js';
```

`renderMealTab()` の末尾に追加:

```js
  const hasKey = Boolean(store.get('settings').geminiKey);
  for (const [id, kind] of [['#btnPhoto', 'meal'], ['#btnReceipt', 'receipt']]) {
    const btn = $(id);
    if (!hasKey) {
      btn.disabled = true;
      btn.title = '設定タブでGemini APIキーを登録すると使えます';
    } else {
      btn.addEventListener('click', () => pickAndAnalyze(kind));
    }
  }
```

同ファイルの末尾に追加:

```js
/** 写真をGeminiに送って品目を推定し、必ず確認画面を挟んでから保存する */
async function pickAndAnalyze(kind) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    toast('解析中...');
    const apiKey = store.get('settings').geminiKey;
    try {
      const items = kind === 'meal'
        ? await analyzeMealPhoto(file, apiKey)
        : await analyzeReceipt(file, apiKey);
      confirmItems(items, kind === 'meal' ? 'photo' : 'receipt');
    } catch (err) {
      // 解析に失敗しても記録を落とさない。手入力に必ず落とす
      toast(err instanceof OcrError ? err.message : '解析に失敗しました');
      openManualDialog();
    }
  });
  input.click();
}

/** AIの推定値をそのまま保存せず、チェックと修正を挟む */
function confirmItems(items, source) {
  const dialog = document.createElement('div');
  dialog.className = 'card';
  dialog.innerHTML = `
    <h2 style="margin-top:0">確認して保存</h2>
    <p class="muted">推定値です。違っていれば数値を直してから保存してください。</p>
    ${items.map((i, idx) => `
      <div class="ex">
        <label><input type="checkbox" data-pick="${idx}" checked> ${i.name}</label>
        <div class="ex-ctrl">
          <input type="number" data-kcal="${idx}" value="${i.kcal}" style="width:80px"> kcal
          <input type="number" data-protein="${idx}" value="${i.protein}" style="width:70px"> g
        </div>
      </div>`).join('')}
    <div class="chips">
      <button id="btnOcrSave" class="primary">保存</button>
      <button id="btnOcrCancel">やめる</button>
    </div>`;
  $('#tab-meal').prepend(dialog);

  dialog.querySelector('#btnOcrCancel').addEventListener('click', () => dialog.remove());
  dialog.querySelector('#btnOcrSave').addEventListener('click', () => {
    const picked = items
      .map((i, idx) => ({
        ...i,
        kcal: Number(dialog.querySelector(`[data-kcal="${idx}"]`).value) || 0,
        protein: Number(dialog.querySelector(`[data-protein="${idx}"]`).value) || 0,
        checked: dialog.querySelector(`[data-pick="${idx}"]`).checked
      }))
      .filter((i) => i.checked)
      .map(({ checked, ...rest }) => rest);

    if (picked.length === 0) {
      toast('品目が選ばれていません');
      return;
    }
    dialog.remove();
    // 画像そのものは保存しない。抽出結果のテキストだけを残す
    addItems(picked, source);
  });
}
```

- [ ] **Step 3: ブラウザで確認**

Run: `python -m http.server 8080`
Expected:
- APIキー未設定のとき「🍱 食事写真」「🧾 レシート」ボタンが無効表示になる
- 設定タブ（Task 19）でキーを入れた後は、写真を選ぶと解析中トーストが出て、確認画面に品目が並ぶ
- 通信を切って試すと「オフラインのため解析できません」と出て、手入力ダイアログに落ちる

- [ ] **Step 4: Commit**

```bash
git add js/ocr.js js/mealTab.js
git commit -m "feat: 食事写真とレシートのOCRを追加（失敗時は手入力に落とす）"
```

---

## Task 18: 記録タブとグラフ

**Files:**
- Create: `js/charts.js`
- Create: `js/recordTab.js`
- Create: `vendor/chart.umd.js`
- Modify: `js/main.js`

- [ ] **Step 1: Chart.js を同梱する（オフライン動作のためCDNを使わない）**

```bash
npm install --no-save chart.js@4
mkdir -p vendor
cp node_modules/chart.js/dist/chart.umd.js vendor/chart.umd.js
```

Expected: `vendor/chart.umd.js` が作成される（約200KB）

- [ ] **Step 2: `js/charts.js` を作る**

```js
// Chart.js は index.html でグローバルに読み込んでいる（オフライン用にvendor同梱）
const registry = new Map();

function draw(canvasId, config) {
  registry.get(canvasId)?.destroy();
  const chart = new Chart(document.getElementById(canvasId), config);
  registry.set(canvasId, chart);
  return chart;
}

const COLORS = { accent: '#40e8ff', muscle: '#4ade80', fat: '#ff5e6c', weight: '#8b95a8' };

const BASE_OPTIONS = {
  responsive: true,
  plugins: { legend: { labels: { color: '#e8ecf4' } } },
  scales: {
    x: { ticks: { color: '#8b95a8' }, grid: { color: '#262c38' } },
    y: { ticks: { color: '#8b95a8' }, grid: { color: '#262c38' } }
  }
};

export function drawVolumeChart(canvasId, weeks) {
  return draw(canvasId, {
    type: 'bar',
    data: {
      labels: weeks.map((w) => w.week),
      datasets: [{ label: '週次総挙上量(kg)', data: weeks.map((w) => Math.round(w.volume)), backgroundColor: COLORS.accent }]
    },
    options: BASE_OPTIONS
  });
}

export function drawBodyChart(canvasId, series) {
  return draw(canvasId, {
    type: 'line',
    data: {
      labels: series.labels,
      datasets: [
        { label: '体重(kg)', data: series.weight, borderColor: COLORS.weight, yAxisID: 'y' },
        { label: '筋肉量(kg)', data: series.muscle, borderColor: COLORS.muscle, yAxisID: 'y' },
        { label: '体脂肪率(%)', data: series.fatPct, borderColor: COLORS.fat, yAxisID: 'y1' }
      ]
    },
    options: {
      ...BASE_OPTIONS,
      scales: {
        ...BASE_OPTIONS.scales,
        y1: { position: 'right', ticks: { color: '#8b95a8' }, grid: { display: false } }
      }
    }
  });
}

export function drawRadarChart(canvasId, radar) {
  return draw(canvasId, {
    type: 'radar',
    data: {
      labels: radar.map((r) => r.label),
      datasets: [{
        label: '部位レベル',
        data: radar.map((r) => r.level),
        borderColor: COLORS.accent,
        backgroundColor: 'rgba(64,232,255,.2)'
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#e8ecf4' } } },
      scales: { r: {
        angleLines: { color: '#262c38' }, grid: { color: '#262c38' },
        pointLabels: { color: '#e8ecf4' }, ticks: { color: '#8b95a8', backdropColor: 'transparent' },
        beginAtZero: true
      } }
    }
  });
}
```

- [ ] **Step 3: `js/recordTab.js` を作る**

```js
import { $, onShow, todayStr } from './ui.js';
import { weeklyVolume } from './workout.js';
import { bodySeries, bodyDiff, latestBody } from './body.js';
import { radarData, BADGES } from './game.js';
import { drawVolumeChart, drawBodyChart, drawRadarChart } from './charts.js';

let store;

export function initRecordTab(s) {
  store = s;
  onShow('record', renderRecordTab);
}

export function renderRecordTab() {
  const workouts = store.get('workouts');
  const weeks = weeklyVolume(workouts);
  const game = store.get('game');
  const body = store.get('body');
  const diff = bodyDiff(body);
  const latest = latestBody(body);

  $('#tab-record').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">週次総挙上量</h2>
      <canvas id="volumeChart"></canvas>
      <div class="muted">${weekSummary(weeks)}</div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">体組成</h2>
      <canvas id="bodyChart"></canvas>
      ${latest ? `<div class="muted">最新 ${latest.date}: 体重${latest.weight}kg / 筋肉${latest.muscle}kg / 体脂肪${latest.fatPct}%</div>
      <div class="muted">開始比: 体重${fmt(diff.weight)}kg / 筋肉<span class="up">${fmt(diff.muscle)}kg</span> / 体脂肪${fmt(diff.fatPct)}%</div>`
        : '<p class="muted">体組成の記録がありません。ホームから登録してください。</p>'}
    </div>
    <div class="card">
      <h2 style="margin-top:0">部位レベル</h2>
      <canvas id="radarChart"></canvas>
    </div>
    <div class="card">
      <h2 style="margin-top:0">カレンダー</h2>
      ${renderCalendar(workouts, store.get('badminton'))}
    </div>
    <div class="card">
      <h2 style="margin-top:0">称号</h2>
      ${BADGES.map((b) => {
        const owned = game.badges.includes(b.id);
        return `<div class="ex"><div class="ex-head"><span class="ex-name">${owned ? '🎖 ' + b.name : '🔒 ???'}</span></div>
          <div class="muted">${owned ? b.desc : '未解放'}</div></div>`;
      }).join('')}
    </div>`;

  drawVolumeChart('volumeChart', weeks);
  drawBodyChart('bodyChart', bodySeries(body));
  drawRadarChart('radarChart', radarData(game.xp));
}

function fmt(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(1);
}

// weeklyVolume の系列は疎（トレーニングが無い週は要素が無い）。
// 直前の要素が本当に「先週」とは限らないので、週キーが隣接している時だけ先週比を出す。
function weekSummary(weeks) {
  if (weeks.length < 2) return '2週分たまると先週比が出ます';
  const last = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  if (prev.week !== previousWeekKey(last.week)) return `前回トレした週(${prev.week})から再開`;
  const diff = Math.round(last.volume - prev.volume);
  return `先週比 ${diff >= 0 ? '+' : ''}${diff}kg`;
}

/** 週キーの1つ前の週キーを返す。年またぎは weekKey に計算させる */
function previousWeekKey(week) {
  const [year, num] = week.split('-W').map(Number);
  const jan4 = Date.UTC(year, 0, 4);
  const monday = new Date(jan4);
  monday.setUTCDate(monday.getUTCDate() - ((new Date(jan4).getUTCDay() + 6) % 7) + (num - 2) * 7);
  return weekKey(monday.toISOString().slice(0, 10));
}

/** 直近8週間のカレンダー。💪ジム 🏸バド 😴休養 */
function renderCalendar(workouts, badminton) {
  const gymDates = new Set(workouts.map((w) => w.date));
  const badDates = new Set(badminton.map((b) => b.date));
  const cells = [];
  const today = new Date(todayStr() + 'T00:00:00Z');
  for (let i = 55; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const mark = gymDates.has(key) ? '💪' : badDates.has(key) ? '🏸' : '·';
    cells.push(`<span title="${key}" style="display:inline-block;width:12.5%;text-align:center;padding:2px 0">${mark}</span>`);
  }
  return `<div style="font-size:14px">${cells.join('')}</div>`;
}
```

- [ ] **Step 4: `js/main.js` に組み込む**

```js
import { initRecordTab } from './recordTab.js';
```

```js
  initRecordTab(store);
```

- [ ] **Step 5: ブラウザで確認**

Run: `python -m http.server 8080`
Expected: 記録タブに4つのカードが並び、週次総挙上量の棒グラフとレーダーチャートが描画される。体組成の記録が無い間はグラフが空でエラーにならない。称号一覧が表示され、未解放は🔒表示になる。

- [ ] **Step 6: Commit**

```bash
git add vendor/chart.umd.js js/charts.js js/recordTab.js js/main.js
git commit -m "feat: 記録タブとグラフを追加"
```

---

## Task 19: ホームタブと設定タブ

**Files:**
- Create: `js/homeTab.js`
- Create: `js/settingsTab.js`
- Modify: `js/main.js`

- [ ] **Step 1: `js/homeTab.js` を作る**

```js
import { $, onShow, showTab, toast, todayStr } from './ui.js';
import { nextProgram, weeklyVolume, warnsBadmintonAfterLegs, weekKey } from './workout.js';
import { calcStreak, isInitialPhase, initialPhaseStatus, levelFromXp, PART_LABELS, PARTS } from './game.js';
import { sortFoodsByUse } from './nutrition.js';
import { addFoodById } from './mealTab.js';
import { latestBody } from './body.js';

const PROGRAM_NAMES = { A: '胸・肩・三頭', B: '背中・二頭', C: '脚・腹' };

let store;

export function initHomeTab(s) {
  store = s;
  onShow('home', renderHomeTab);
}

export function renderHomeTab() {
  const workouts = store.get('workouts');
  const profile = store.get('profile');
  const game = store.get('game');
  const today = todayStr();
  const program = nextProgram(workouts);
  const streak = calcStreak(workouts, today);
  const weeks = weeklyVolume(workouts);
  const initial = isInitialPhase(profile.startDate, today);
  const status = initialPhaseStatus(workouts, store.get('meals'), today);
  const quickFoods = sortFoodsByUse(store.get('foods')).slice(0, 6);
  const body = latestBody(store.get('body'));

  $('#tab-home').innerHTML = `
    <div class="card">
      <div class="muted">今日やること</div>
      <div class="big">【${program}】${PROGRAM_NAMES[program]}</div>
      <button id="btnGoWorkout" class="primary" style="margin-top:8px;width:100%">トレーニングを始める</button>
    </div>

    ${initial ? `
    <div class="card">
      <h2 style="margin-top:0">最初の4週間</h2>
      <p class="muted">この期間は2つだけ追いかけます。ここが習慣になれば、あとは自動的に進みます。</p>
      <div>週3ジム <b>${status.gymCount} / 3</b> ${status.gymDone ? '✅' : ''}</div>
      <div>朝プロテイン <b>${status.proteinMornings}</b> 日 / 今週</div>
    </div>` : ''}

    <div class="card">
      <div class="muted">連続週数</div>
      <div class="big">🔥 ${streak} 週</div>
      <div class="muted">今週の総挙上量 ${thisWeekVolume(weeks, today)} kg ${weekDiff(weeks)}</div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">クイック記録</h2>
      <div class="chips" id="quickFoods">
        ${quickFoods.map((f) => `<button data-food="${f.id}">${f.name}</button>`).join('')}
      </div>
      <div class="chips" style="margin-top:8px">
        <button id="btnBadminton">🏸 バドミントンを記録</button>
        <button id="btnInbody">📏 体組成を記録</button>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">部位レベル</h2>
      ${PARTS.map((p) => `<div class="muted">${PART_LABELS[p]} Lv${levelFromXp(game.xp[p] ?? 0)}</div>`).join('')}
      ${body ? `<div class="muted" style="margin-top:8px">最新の体組成 ${body.date}: 筋肉${body.muscle}kg / 体脂肪${body.fatPct}%</div>` : ''}
    </div>`;

  $('#btnGoWorkout').addEventListener('click', () => showTab('workout'));
  $('#quickFoods').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-food]');
    if (!btn) return;
    addFoodById(btn.dataset.food);
    renderHomeTab();
  });
  $('#btnBadminton').addEventListener('click', recordBadminton);
  $('#btnInbody').addEventListener('click', recordBody);
}

function thisWeekVolume(weeks, today) {
  const key = weekKey(today);
  return Math.round(weeks.find((w) => w.week === key)?.volume ?? 0);
}

// 疎な系列なので、週キーが隣接していない場合は「先週比」と呼ばない
function weekDiff(weeks) {
  if (weeks.length < 2) return '';
  const last = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  if (prev.week !== previousWeekKey(last.week)) return '';
  const diff = Math.round(last.volume - prev.volume);
  return diff >= 0 ? `<span class="up">先週比 +${diff}kg ↗</span>` : `先週比 ${diff}kg`;
}

/** 脚の日の翌日は回復が間に合わないため警告を出す */
function recordBadminton() {
  const today = todayStr();
  if (warnsBadmintonAfterLegs(store.get('workouts'), today)) {
    if (!confirm('昨日は脚の日（C）でした。回復が間に合わない可能性があります。それでも記録しますか？')) return;
  }
  const minutes = Number(prompt('何分やりましたか？', '60'));
  if (!minutes || Number.isNaN(minutes)) return;
  store.set('badminton', [...store.get('badminton'), { date: today, durationMin: minutes }]);
  toast('バドミントンを記録しました');
  renderHomeTab();
}

function recordBody() {
  const weight = Number(prompt('体重(kg)', '60'));
  const muscle = Number(prompt('筋肉量(kg)', '45'));
  const fatPct = Number(prompt('体脂肪率(%)', '20'));
  if ([weight, muscle, fatPct].some((n) => Number.isNaN(n) || n <= 0)) {
    toast('数値が読めませんでした');
    return;
  }
  store.set('body', [...store.get('body'), { date: todayStr(), weight, muscle, fatPct, source: 'inbody' }]);
  toast('体組成を記録しました');
  renderHomeTab();
}
```

- [ ] **Step 2: `js/settingsTab.js` を作る**

```js
import { $, onShow, toast } from './ui.js';

let store;

export function initSettingsTab(s) {
  store = s;
  onShow('settings', renderSettingsTab);
}

export function renderSettingsTab() {
  const profile = store.get('profile');
  const settings = store.get('settings');
  const t = profile.targets;

  $('#tab-settings').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">目標</h2>
      <div class="ex-ctrl">タンパク質 <input type="number" id="tProtein" value="${t.protein}" style="width:80px">g</div>
      <div class="ex-ctrl">カロリー下限 <input type="number" id="tKcalMin" value="${t.kcalMin}" style="width:90px"></div>
      <div class="ex-ctrl">カロリー上限 <input type="number" id="tKcalMax" value="${t.kcalMax}" style="width:90px"></div>
      <div class="ex-ctrl">警告ライン <input type="number" id="tKcalFloor" value="${t.kcalFloor}" style="width:90px"></div>
      <div class="ex-ctrl">発泡酒 <input type="number" id="tAlcohol" value="${t.alcoholMl}" style="width:90px">ml</div>
      <p class="muted">警告ラインを下回った日は「食べなさすぎ」の警告が出ます。摂取を削るほど筋肉が落ちるため、下限側を守る設計です。</p>
      <button id="btnSaveTargets" class="primary">保存</button>
    </div>

    <div class="card">
      <h2 style="margin-top:0">写真・レシート解析</h2>
      <div class="ex-ctrl">Gemini APIキー <input type="password" id="geminiKey" value="${settings.geminiKey}" style="flex:1"></div>
      <p class="muted">食事写真とレシート画像だけがGoogleに送信されます。体の写真・体重・トレ記録は送信されません。無料枠内で動作します。</p>
      <label class="ex-ctrl"><input type="checkbox" id="useOff" ${settings.useOpenFoodFacts ? 'checked' : ''}>
        バーコード検索でOpen Food Factsに問い合わせる（送信するのはJANコード13桁のみ）</label>
      <button id="btnSaveSettings" class="primary">保存</button>
    </div>

    <div class="card">
      <h2 style="margin-top:0">バックアップ</h2>
      <div class="chips">
        <button id="btnExport">エクスポート</button>
        <button id="btnImport">インポート</button>
      </div>
      <p class="muted">記録データをJSONで書き出します。体の写真は含まれません（端末内のIndexedDBにのみ保存されます）。</p>
      <input type="file" id="importFile" accept="application/json" class="hidden">
    </div>`;

  $('#btnSaveTargets').addEventListener('click', () => {
    store.set('profile', {
      ...profile,
      targets: {
        protein: Number($('#tProtein').value),
        kcalMin: Number($('#tKcalMin').value),
        kcalMax: Number($('#tKcalMax').value),
        kcalFloor: Number($('#tKcalFloor').value),
        alcoholMl: Number($('#tAlcohol').value)
      }
    });
    toast('目標を保存しました');
  });

  $('#btnSaveSettings').addEventListener('click', () => {
    store.set('settings', {
      ...settings,
      geminiKey: $('#geminiKey').value.trim(),
      useOpenFoodFacts: $('#useOff').checked
    });
    toast('設定を保存しました');
  });

  $('#btnExport').addEventListener('click', () => {
    const blob = new Blob([store.exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `muscle-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('現在の記録を上書きします。よろしいですか？')) return;
    try {
      store.importAll(await file.text());
      toast('インポートしました');
      location.reload();
    } catch (err) {
      toast(err.message);
    }
  });
}
```

- [ ] **Step 3: `js/main.js` に組み込む**

冒頭に import を追加:

```js
import { initHomeTab } from './homeTab.js';
import { initSettingsTab } from './settingsTab.js';
```

`initTabs()` の直前に追加:

```js
  initHomeTab(store);
  initSettingsTab(store);
```

- [ ] **Step 4: ブラウザで確認**

Run: `python -m http.server 8080`
Expected:
- ホームに「今日やること【A】胸・肩・三頭」が出る
- 初回起動から4週間は「最初の4週間」カードが表示され、週3ジムと朝プロテインの2項目だけが出る
- クイック記録のボタンで食事が登録され、上部バーが伸びる
- 「📏 体組成を記録」で3項目を入れると、記録タブのグラフに反映される
- 設定タブでエクスポートするとJSONがダウンロードされ、インポートで復元できる

- [ ] **Step 5: Commit**

```bash
git add js/homeTab.js js/settingsTab.js js/main.js
git commit -m "feat: ホームタブと設定タブを追加"
```

---

## Task 20: インボディ結果紙のOCR

**Files:**
- Modify: `js/ocr.js`
- Modify: `js/homeTab.js`

月1のインボディは3項目だけだが、結果紙を撮るだけで入力が終わるようにする。

- [ ] **Step 1: `js/ocr.js` に体組成の解析を追加**

冒頭のプロンプト定義の下に追加:

```js
const INBODY_PROMPT = `このインボディ（体組成計）の結果紙から3つの数値だけを読み取ってください。
体重(kg)、骨格筋量または筋肉量(kg)、体脂肪率(%)の3つです。
JSONのみを返してください。説明文は不要です。
形式: {"weight":0,"muscle":0,"fatPct":0}`;
```

ファイル末尾に追加:

```js
/** インボディ結果紙から体重・筋肉量・体脂肪率を読み取る */
export async function analyzeInbody(blob, apiKey) {
  const text = await callGeminiRaw(INBODY_PROMPT, blob, apiKey);
  return parseBody(text);
}

/** モデル出力から体組成3項目を取り出す。1つでも欠けていれば失敗させる */
export function parseBody(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OcrError('解析結果の形式が不正です');
  }
  const weight = Number(parsed?.weight);
  const muscle = Number(parsed?.muscle);
  const fatPct = Number(parsed?.fatPct);
  if (![weight, muscle, fatPct].every((n) => Number.isFinite(n) && n > 0)) {
    throw new OcrError('数値を読み取れませんでした');
  }
  return { weight, muscle, fatPct };
}
```

- [ ] **Step 2: `callGemini` を「生テキストを返す部分」と「品目に変換する部分」に分ける**

`callGemini` は品目配列を返す作りになっているため、体組成では使えない。
Task 17 で書いた `callGemini` の最後の2行を差し替える。

変更前:

```js
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new OcrError('解析結果を読み取れませんでした');

  return parseItems(text);
}
```

変更後（関数名も `callGeminiRaw` に変える）:

```js
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new OcrError('解析結果を読み取れませんでした');

  return text;
}
```

あわせて関数の宣言行を変え、品目系の呼び出し元も直す:

```js
async function callGeminiRaw(prompt, blob, apiKey) {
```

```js
export async function analyzeMealPhoto(blob, apiKey) {
  return parseItems(await callGeminiRaw(MEAL_PROMPT, blob, apiKey));
}

export async function analyzeReceipt(blob, apiKey) {
  return parseItems(await callGeminiRaw(RECEIPT_PROMPT, blob, apiKey));
}
```

- [ ] **Step 3: `js/homeTab.js` の体組成記録を写真対応にする**

冒頭の import に追加:

```js
import { analyzeInbody, OcrError } from './ocr.js';
```

`recordBody` 関数を次の内容に差し替える:

```js
/** 結果紙を撮れば3項目が埋まる。読めなければ手入力に落とす */
async function recordBody() {
  const hasKey = Boolean(store.get('settings').geminiKey);
  const usePhoto = hasKey && confirm('インボディの結果紙を撮影して読み取りますか？\n（キャンセルすると手入力になります）');

  let values = null;
  if (usePhoto) {
    values = await readInbodyPhoto();
  }
  if (!values) {
    values = promptBodyValues();
  }
  if (!values) return;

  store.set('body', [...store.get('body'), { date: todayStr(), ...values, source: 'inbody' }]);
  toast('体組成を記録しました');
  renderHomeTab();
}

function readInbodyPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      toast('解析中...');
      try {
        const v = await analyzeInbody(file, store.get('settings').geminiKey);
        if (!confirm(`読み取り結果\n体重 ${v.weight}kg / 筋肉量 ${v.muscle}kg / 体脂肪 ${v.fatPct}%\n\nこの値で保存しますか？`)) {
          return resolve(null);
        }
        resolve(v);
      } catch (err) {
        toast(err instanceof OcrError ? err.message : '解析に失敗しました');
        resolve(null);
      }
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function promptBodyValues() {
  const weight = Number(prompt('体重(kg)', '60'));
  const muscle = Number(prompt('筋肉量(kg)', '45'));
  const fatPct = Number(prompt('体脂肪率(%)', '20'));
  if ([weight, muscle, fatPct].some((n) => Number.isNaN(n) || n <= 0)) {
    toast('数値が読めませんでした');
    return null;
  }
  return { weight, muscle, fatPct };
}
```

- [ ] **Step 4: ブラウザで確認**

Run: `python -m http.server 8080`
Expected:
- APIキー未設定なら「📏 体組成を記録」は今までどおり3回のプロンプト入力になる
- APIキー設定済みなら撮影するか聞かれ、撮影すると読み取り結果の確認ダイアログが出る
- 「キャンセル」または解析失敗時は手入力に落ち、記録が失われない

- [ ] **Step 5: Commit**

```bash
git add js/ocr.js js/homeTab.js
git commit -m "feat: インボディ結果紙のOCRを追加"
```

---

## Task 21: PWA化（オフライン動作）

**Files:**
- Create: `manifest.json`
- Create: `sw.js`
- Create: `icons/icon-192.png`, `icons/icon-512.png`

ジムは電波が弱いことがあるため、オフラインで全機能（OCR以外）が動くことが必須。

- [ ] **Step 1: `manifest.json` を作る**

```json
{
  "name": "筋トレ管理",
  "short_name": "筋トレ",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0f1115",
  "theme_color": "#0f1115",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: アイコン生成スクリプトを作る**

外部依存なしで単色PNGを書き出す。`scripts/make-icons.js`:

```js
// 追加パッケージ無しでアイコンPNGを生成する（Node標準のzlibのみ使用）
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [15, 17, 21];      // --bg #0f1115
const FG = [64, 232, 255];    // --accent #40e8ff

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let r = 0xffffffff;
  for (const b of buf) r = CRC_TABLE[(r ^ b) & 0xff] ^ (r >>> 8);
  return (r ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 背景色の中央に前景色の正方形を描いた単純なアイコン */
function icon(size) {
  const inset = Math.round(size * 0.28);
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const off = y * (size * 3 + 1);
    raw[off] = 0; // フィルタタイプ None
    for (let x = 0; x < size; x++) {
      const inside = x >= inset && x < size - inset && y >= inset && y < size - inset;
      const [r, g, b] = inside ? FG : BG;
      raw[off + 1 + x * 3] = r;
      raw[off + 2 + x * 3] = g;
      raw[off + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // カラータイプ Truecolor
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

mkdirSync('icons', { recursive: true });
for (const size of [192, 512]) {
  writeFileSync(`icons/icon-${size}.png`, icon(size));
  console.log(`icons/icon-${size}.png`);
}
```

- [ ] **Step 3: アイコンを生成して確認**

Run: `node scripts/make-icons.js`
Expected:
```
icons/icon-192.png
icons/icon-512.png
```
生成された PNG をブラウザで開き、濃紺の背景に水色の正方形が表示されることを確認する。

- [ ] **Step 4: `sw.js` を作る**

```js
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
```

- [ ] **Step 5: オフライン動作を確認**

Run: `python -m http.server 8080`
`http://localhost:8080` を開き、DevTools → Application → Service Workers で登録を確認。
DevTools → Network → Offline にチェックを入れてリロード。
Expected: オフラインでもアプリが起動し、ホーム・トレ・食事・記録タブがすべて動作する。食事タブの写真ボタンだけ押しても「オフラインのため解析できません」と出て手入力に落ちる。

- [ ] **Step 6: Commit**

```bash
git add manifest.json sw.js icons/ scripts/make-icons.js
git commit -m "feat: PWA化してオフライン動作に対応"
```

---

## Task 22: GitHub Pages へデプロイ

**Files:**
- Create: `.github/workflows/pages.yml`
- Create: `README.md`

- [ ] **Step 1: `.github/workflows/pages.yml` を作る**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: `README.md` を作る**

```markdown
# 筋トレ管理 PWA

JOYFIT24 室蘭モルエ中島のマシンで回す週3プログラムの記録アプリ。

## 使い方

1. Android Chrome で公開URLを開く
2. メニュー →「ホーム画面に追加」でPWAとしてインストール
3. 設定タブで Gemini APIキーを登録すると、食事写真とレシートの解析が使える（任意）

## 開発

```bash
npm test                      # 純粋関数のテスト
python -m http.server 8080    # ローカル確認
```

## データの扱い

- 記録データは端末の localStorage、体の写真は IndexedDB に保存される。サーバーには送信されない
- Gemini API に送るのは食事写真とレシート画像のみ
- Open Food Facts に送るのは JANコード13桁のみ（設定でオフにできる）
- バックアップは設定タブから JSON でエクスポートする（写真は含まれない）
```

- [ ] **Step 3: 全テストを流して確認**

Run: `npm test`
Expected: PASS（累計90件）、失敗0件

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pages.yml README.md
git commit -m "chore: GitHub Pagesのデプロイ設定とREADMEを追加"
```

- [ ] **Step 5: GitHubにリポジトリを作成して push**

```bash
gh repo create muscle-tracker-pwa --public --source=. --remote=origin --push
```

- [ ] **Step 6: Pages を有効化して公開URLを確認**

GitHub のリポジトリ設定 → Pages → Source を「GitHub Actions」に設定する。
Actions の実行完了後、`https://<ユーザー名>.github.io/muscle-tracker-pwa/` を Android Chrome で開く。

Expected:
- HTTPSで配信されるためカメラが動作する
- 「ホーム画面に追加」でPWAとしてインストールできる
- 機内モードにしてもアプリが起動し、トレ記録がつけられる

---

## 完了条件

- [ ] `npm test` が全件パスする
- [ ] Android Chrome で PWA としてインストールできる
- [ ] 機内モードでトレ記録・食事のワンタップ登録ができる
- [ ] トレタブで ✓ を押すだけで記録でき、90秒タイマーとPB演出が動く
- [ ] 食事タブでワンタップ・バーコード・写真・レシートの4経路すべてから記録でき、失敗時は手入力に落ちる
- [ ] 「📏 体組成を記録」でインボディ結果紙を撮ると3項目が自動で埋まり、失敗時は手入力に落ちる
- [ ] 写真タブで前回写真のオーバーレイ撮影と before/after 比較ができる
- [ ] `grep -nE "fetch|XMLHttpRequest|sendBeacon|WebSocket" js/photos.js` が0件（体の写真が外部に出ない）
- [ ] 記録タブに週次総挙上量・体組成3本重ね・部位レーダーが描画される
