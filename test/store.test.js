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
