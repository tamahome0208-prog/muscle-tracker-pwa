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
