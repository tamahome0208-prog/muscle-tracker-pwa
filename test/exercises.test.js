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
    // js/workoutTab.js の onExerciseClick は data-step を重量の増減幅に使う。
    // step が数値でないと Number(row.dataset.step) が NaN になり、重量表示に
    // NaN が書き込まれる(呼び出し側には `|| 2.5` のフォールバックがあるが、
    // データ自体が壊れていることを検知できるようにここでも保証する)。
    assert.equal(typeof e.step, 'number', `stepが数値でない: ${e.id}`);
  }
});

test('idが重複していない', () => {
  const ids = exercises.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});
