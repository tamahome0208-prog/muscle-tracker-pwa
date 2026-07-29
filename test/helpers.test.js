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
