import test from 'node:test';
import assert from 'node:assert/strict';
import { nextProgram, calcVolume, weeklyVolume, lastSetsFor, isPB, updateBests, warnsBadmintonAfterLegs } from '../js/workout.js';

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

test('前回のセットを種目ごとに引ける', () => {
  const workouts = [
    { date: '2026-07-20', program: 'B', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] },
    { date: '2026-07-27', program: 'B', sets: [{ exId: 'seated_row', weight: 32.5, reps: 12 }] }
  ];
  assert.deepEqual(lastSetsFor(workouts, 'seated_row'), { weight: 32.5, reps: 12 });
  assert.equal(lastSetsFor(workouts, 'leg_press'), null);
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
