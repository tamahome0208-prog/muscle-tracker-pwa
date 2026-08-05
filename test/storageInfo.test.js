import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestPersistentStorage, readPersistedState, readStorageEstimate,
  persistedStateText, storageEstimateText
} from '../js/storageInfo.js';

// --- requestPersistentStorage: API欠如・reject・false応答を例外なく処理する ---

test('requestPersistentStorage: persist API が無ければ supported:false を返し、例外を投げない', async () => {
  const result = await requestPersistentStorage(null);
  assert.deepEqual(result, { supported: false, persisted: false });
});

test('requestPersistentStorage: persist() が reject しても例外を投げない', async () => {
  const fake = { persist: async () => { throw new Error('boom'); } };
  const result = await requestPersistentStorage(fake);
  assert.equal(result.supported, true);
  assert.equal(result.persisted, false);
});

test('requestPersistentStorage: persist() が false を返した場合(許可されなかった)', async () => {
  const fake = { persist: async () => false };
  const result = await requestPersistentStorage(fake);
  assert.deepEqual(result, { supported: true, persisted: false });
});

test('requestPersistentStorage: persist() が true を返した場合(許可された)', async () => {
  const fake = { persist: async () => true };
  const result = await requestPersistentStorage(fake);
  assert.deepEqual(result, { supported: true, persisted: true });
});

// --- readPersistedState ---

test('readPersistedState: persisted API が無ければ supported:false', async () => {
  const result = await readPersistedState(null);
  assert.deepEqual(result, { supported: false, persisted: false });
});

test('readPersistedState: persisted() が reject しても例外を投げない', async () => {
  const fake = { persisted: async () => { throw new Error('boom'); } };
  const result = await readPersistedState(fake);
  assert.equal(result.supported, true);
  assert.equal(result.persisted, false);
});

test('readPersistedState: persisted() の戻り値をそのまま反映する', async () => {
  const fake = { persisted: async () => true };
  assert.deepEqual(await readPersistedState(fake), { supported: true, persisted: true });
});

// --- readStorageEstimate ---

test('readStorageEstimate: estimate API が無ければ null', async () => {
  assert.equal(await readStorageEstimate(null), null);
});

test('readStorageEstimate: estimate() が reject しても null', async () => {
  const fake = { estimate: async () => { throw new Error('boom'); } };
  assert.equal(await readStorageEstimate(fake), null);
});

test('readStorageEstimate: usage/quota を返す', async () => {
  const fake = { estimate: async () => ({ usage: 1234, quota: 5678 }) };
  assert.deepEqual(await readStorageEstimate(fake), { usage: 1234, quota: 5678 });
});

test('readStorageEstimate: usage/quotaが数値でなければ null(防御的丸め)', async () => {
  const fake = { estimate: async () => ({ usage: NaN, quota: undefined }) };
  assert.equal(await readStorageEstimate(fake), null);
});

// --- 表示文言 ---

test('persistedStateText: 非対応環境', () => {
  assert.match(persistedStateText({ supported: false, persisted: false }), /確認できません/);
});

test('persistedStateText: 許可されている', () => {
  assert.match(persistedStateText({ supported: true, persisted: true }), /許可されています/);
});

test('persistedStateText: 許可されていない場合、意味と対策(ホーム画面追加)を一文で伝える', () => {
  const text = persistedStateText({ supported: true, persisted: false });
  assert.match(text, /許可されていません/);
  assert.match(text, /削除する可能性/);
  assert.match(text, /ホーム画面/);
});

test('storageEstimateText: estimateが無ければ空文字', () => {
  assert.equal(storageEstimateText(null), '');
});

test('storageEstimateText: MB表示になる', () => {
  const text = storageEstimateText({ usage: 1024 * 1024 * 2, quota: 1024 * 1024 * 100 });
  assert.match(text, /2\.0MB/);
  assert.match(text, /100\.0MB/);
});
