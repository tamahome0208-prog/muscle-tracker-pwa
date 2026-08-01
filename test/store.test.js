import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, DEFAULTS } from '../js/store.js';
import { memoryStorage } from './helpers.js';

test('初回はデフォルト値を返す', () => {
  const store = createStore(memoryStorage());
  assert.deepEqual(store.get('workouts'), []);
  assert.equal(store.get('profile').height, 162);
  assert.equal(store.get('profile').targets.protein, 100);
  // 1500固定値からEAフロア由来の既定値(js/store.js のDEFAULT_KCAL_FLOOR、js/energy.js 参照)に変更
  assert.equal(store.get('profile').targets.kcalFloor, 1440);
});

test('profile はEA計算用の age/sex を既定値付きで持つ', () => {
  const store = createStore(memoryStorage());
  assert.equal(store.get('profile').age, 35);
  assert.equal(store.get('profile').sex, 'male');
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
  store.set('meals', [{ id: 'm1', datetime: '2026-07-29T19:00', items: [{ name: 'x', kcal: 500 }] }]);
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
  assert.equal(profile.targets.kcalFloor, 1440);
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
  store.set('meals', [{ id: 'old-m', datetime: '2026-07-28T19:00', items: [] }]);

  const realSetItem = storage.setItem.bind(storage);
  let failOnMeals = false;
  storage.setItem = (k, v) => {
    if (failOnMeals && k === 'mt.meals') throw new Error('QuotaExceededError');
    realSetItem(k, v);
  };

  failOnMeals = true;
  assert.throws(() => store.importAll(JSON.stringify({
    workouts: [{ id: 'new-w' }],
    meals: [{ id: 'new-m', datetime: '2026-07-29T19:00', items: [] }]
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
  assert.equal(store.get('profile').targets.kcalFloor, 1440);
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

// --- 最終レビュー対応の回帰テスト ---

test('session キーはデフォルトで program/date/startedAt が null、sets が空配列', () => {
  const store = createStore(memoryStorage());
  assert.deepEqual(store.get('session'), { program: null, date: null, startedAt: null, sets: [] });
});

test('session を保存して読み戻せる(startedAtも含めて)', () => {
  const store = createStore(memoryStorage());
  store.set('session', { program: 'A', date: '2026-07-28', startedAt: '2026-07-29', sets: [{ exId: 'x', weight: 10, reps: 10 }] });
  assert.equal(store.get('session').program, 'A');
  assert.equal(store.get('session').date, '2026-07-28');
  assert.equal(store.get('session').startedAt, '2026-07-29');
  assert.equal(store.get('session').sets.length, 1);
});

test('importAll は datetime/items を欠いた meals レコードを弾き、他キーも巻き込んで書き込まない', () => {
  const store = createStore(memoryStorage());
  store.set('workouts', [{ id: 'keep-w' }]);
  assert.throws(
    () => store.importAll(JSON.stringify({
      workouts: [{ id: 'new-w' }],
      meals: [{ id: 'broken-meal' }] // datetime も items も無い
    })),
    /meals.*レコード形式/
  );
  assert.equal(store.get('workouts')[0].id, 'keep-w');
  assert.equal(store.get('meals').length, 0);
});

test('game.badges が配列以外(数値・文字列)に壊れていても normalize で空配列に補正される', () => {
  const storage = memoryStorage({ 'mt.game': JSON.stringify({ badges: 42 }) });
  const store = createStore(storage);
  assert.deepEqual(store.get('game').badges, []);

  const storage2 = memoryStorage({ 'mt.game': JSON.stringify({ badges: 'abc' }) });
  const store2 = createStore(storage2);
  assert.deepEqual(store2.get('game').badges, []);
});

test('game.badges の補正は set() 経由でも(保存時にも)働く', () => {
  const store = createStore(memoryStorage());
  const game = store.get('game');
  store.set('game', { ...game, badges: 999 });
  assert.deepEqual(store.get('game').badges, []);
});
