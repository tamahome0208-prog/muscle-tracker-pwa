import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTS, levelFromXp, addWorkoutXp, radarData } from '../js/game.js';
import { calcStreak, isInitialPhase, initialPhaseStatus } from '../js/game.js';
import { BADGES, checkBadges } from '../js/game.js';

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

test('同じ朝に2杯飲んでも1日として数える', () => {
  const meals = [
    { datetime: '2026-07-27T07:00', items: [{ name: 'プロテイン 1杯', kcal: 120, protein: 24 }] },
    { datetime: '2026-07-27T09:00', items: [{ name: 'プロテイン 1杯', kcal: 120, protein: 24 }] }
  ];
  assert.equal(initialPhaseStatus([], meals, '2026-07-29').proteinMornings, 1);
});

test('先週の朝プロテインは今週に数えない', () => {
  const meals = [
    { datetime: '2026-07-20T07:00', items: [{ name: 'プロテイン 1杯', kcal: 120, protein: 24 }] },
    { datetime: '2026-07-27T07:00', items: [{ name: 'プロテイン 1杯', kcal: 120, protein: 24 }] }
  ];
  assert.equal(initialPhaseStatus([], meals, '2026-07-29').proteinMornings, 1);
});

test('先週のジムの記録は今週のgymCountに混ざらない', () => {
  const workouts = [...gymWeek('2026-07-20', 3), ...gymWeek('2026-07-27', 1)];
  assert.equal(initialPhaseStatus(workouts, [], '2026-07-29').gymCount, 1);
});

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

test('3週連続では「習慣化」を獲得しない', () => {
  const base = { workouts: [], body: [], xp: { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 }, comparedPhotos: false, badges: [] };
  assert.ok(!checkBadges({ ...base, streak: 3 }).includes('habit_4w'));
  assert.ok(checkBadges({ ...base, streak: 4 }).includes('habit_4w'));
});

test('総挙上量10トン未満では「10トン挙げた」を獲得しない', () => {
  const base = { body: [], streak: 0, xp: { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 }, comparedPhotos: false, badges: [] };
  const under = [{ date: '2026-07-29', program: 'A', volume: 9999 }];
  const over = [{ date: '2026-07-29', program: 'A', volume: 10000 }];
  assert.ok(!checkBadges({ ...base, workouts: under }).includes('volume_10t'));
  assert.ok(checkBadges({ ...base, workouts: over }).includes('volume_10t'));
});

test('body の配列順が逆でも開始時と最新で比較する', () => {
  const earned = checkBadges({
    workouts: [], streak: 0,
    body: [
      { date: '2026-07-29', weight: 60, muscle: 47, fatPct: 17 },
      { date: '2026-04-29', weight: 60, muscle: 45, fatPct: 20 }
    ],
    xp: { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 },
    comparedPhotos: false, badges: []
  });
  assert.ok(earned.includes('abs_visible'));
  assert.ok(earned.includes('muscle_plus2'));
});

test('胸と肩の両方がレベル3以上で「肩と胸に丸みが出た」を獲得する（片方だけでは獲得しない）', () => {
  const base = { workouts: [], body: [], streak: 0, comparedPhotos: false, badges: [] };
  const bothLv3 = checkBadges({ ...base, xp: { chest: 900, back: 0, shoulder: 900, leg: 0, arm: 0, abs: 0 } });
  assert.ok(bothLv3.includes('shoulder_lv3'));

  const onlyChest = checkBadges({ ...base, xp: { chest: 900, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 } });
  assert.ok(!onlyChest.includes('shoulder_lv3'));

  const onlyShoulder = checkBadges({ ...base, xp: { chest: 0, back: 0, shoulder: 900, leg: 0, arm: 0, abs: 0 } });
  assert.ok(!onlyShoulder.includes('shoulder_lv3'));
});

test('筋肉量+2.0kgで「中身が変わった」を獲得する（+1.9kgでは獲得しない）', () => {
  const base = { workouts: [], streak: 0, xp: { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 }, comparedPhotos: false, badges: [] };
  const under = checkBadges({
    ...base,
    body: [
      { date: '2026-04-29', weight: 60, muscle: 45, fatPct: 20 },
      { date: '2026-07-29', weight: 60, muscle: 46.9, fatPct: 20 }
    ]
  });
  assert.ok(!under.includes('muscle_plus2'));

  const over = checkBadges({
    ...base,
    body: [
      { date: '2026-04-29', weight: 60, muscle: 45, fatPct: 20 },
      { date: '2026-07-29', weight: 60, muscle: 47, fatPct: 20 }
    ]
  });
  assert.ok(over.includes('muscle_plus2'));
});
