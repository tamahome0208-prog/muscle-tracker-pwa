import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTS, levelFromXp, addWorkoutXp, radarData } from '../js/game.js';
import { calcStreak, isInitialPhase, initialPhaseStatus } from '../js/game.js';

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

test('xpMap に無い部位もレベル0で必ず含める（弱点部位が消えない）', () => {
  const data = radarData({ back: 400 });
  assert.equal(data.length, 6);
  assert.deepEqual(data.map((d) => d.part), ['chest', 'back', 'shoulder', 'leg', 'arm', 'abs']);
  assert.equal(data.find((d) => d.part === 'leg').level, 0);
  assert.equal(data.find((d) => d.part === 'leg').xp, 0);
});

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
