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
