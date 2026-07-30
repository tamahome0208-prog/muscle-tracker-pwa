import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTS, levelFromXp, addWorkoutXp, radarData } from '../js/game.js';
import { calcStreak, isInitialPhase, initialPhaseStatus } from '../js/game.js';
import { BADGES, checkBadges, recomputeGame } from '../js/game.js';

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

const LOAD_EXERCISES = [
  { id: 'chin_assist', part: 'back', load: 'assist' },
  { id: 'ab_coaster', part: 'abs', load: 'bodyweight' },
  { id: 'seated_row', part: 'back', load: 'external' }
];

test('bodyweight を渡すとアシスト/自重種目にもXPが付く', () => {
  const workout = {
    date: '2026-07-29', program: 'B',
    sets: [
      { exId: 'chin_assist', weight: -40, reps: 8 }, // (60-40)*8=160
      { exId: 'ab_coaster', weight: 0, reps: 15 }    // 60*15=900
    ]
  };
  const xp = addWorkoutXp({ chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 }, workout, LOAD_EXERCISES, 60);
  assert.equal(xp.back, 16);  // 160/10
  assert.equal(xp.abs, 90);   // 900/10
});

test('bodyweight を省略すると従来どおりアシスト/自重種目は0のまま', () => {
  const workout = {
    date: '2026-07-29', program: 'B',
    sets: [
      { exId: 'chin_assist', weight: -40, reps: 8 },
      { exId: 'ab_coaster', weight: 0, reps: 15 }
    ]
  };
  const xp = addWorkoutXp({ chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 }, workout, LOAD_EXERCISES);
  assert.equal(xp.back, 0);
  assert.equal(xp.abs, 0);
});

test('bodyweight を渡しても external 種目のXPは変わらない', () => {
  const workout = { date: '2026-07-29', program: 'B', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] };
  const withBw = addWorkoutXp({ chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 }, workout, LOAD_EXERCISES, 60);
  const withoutBw = addWorkoutXp({ chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 }, workout, LOAD_EXERCISES);
  assert.equal(withBw.back, withoutBw.back);
  assert.equal(withBw.back, 30);
});

test('bodyweight が負値でもXPを減らさない（完成したワークアウトがXPを減らすことはあってはならない）', () => {
  const workout = {
    date: '2026-07-29', program: 'B',
    sets: [{ exId: 'ab_coaster', weight: 0, reps: 15 }]
  };
  const before = { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 100 };
  const xp = addWorkoutXp(before, workout, LOAD_EXERCISES, -60);
  assert.equal(xp.abs, 100); // 0が加算される。減ってはならない
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

test('calcStreak: 同じ日に複数記録しても実施日数としては1日なので水増ししない', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A' },
    { date: '2026-07-27', program: 'B' }, // 同日2件目（本来は1回のジム訪問）
    { date: '2026-07-29', program: 'C' }
  ];
  // 実施日は2026-07-27, 2026-07-29の2日だけなので週3回に届かない
  assert.equal(calcStreak(workouts, '2026-07-29'), 0);
});

test('calcStreak: null要素が混ざっていても例外を投げずに無視する', () => {
  const workouts = [null, ...gymWeek('2026-07-27', 3)];
  assert.doesNotThrow(() => calcStreak(workouts, '2026-07-29'));
  assert.equal(calcStreak(workouts, '2026-07-29'), 1);
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

test('initialPhaseStatus: 同じ日に複数記録があってもgymCountは実施日数(1)としてカウントする（チップの誤操作対策）', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A' },
    { date: '2026-07-27', program: 'B' }
  ];
  assert.equal(initialPhaseStatus(workouts, [], '2026-07-29').gymCount, 1);
});

// --- recomputeGame（削除時のXP/自己ベストのロールバック用の再構築） ---

const EMPTY_XP = { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 };
const flatBodyweight = (bw) => () => bw;

test('recomputeGame: 空履歴からは xp が全0・bests が空オブジェクト', () => {
  const result = recomputeGame([], EXERCISES, flatBodyweight(60));
  assert.deepEqual(result.xp, EMPTY_XP);
  assert.deepEqual(result.bests, {});
});

test('recomputeGame: 単一のワークアウトから xp と bests を組み立てる', () => {
  const workouts = [
    { date: '2026-07-27', program: 'B', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] }
  ];
  const result = recomputeGame(workouts, EXERCISES, flatBodyweight(60));
  assert.equal(result.xp.back, 30); // 300/10
  assert.deepEqual(result.bests.seated_row, { weight: 30, reps: 10, date: '2026-07-27' });
});

test('recomputeGame: 複数ワークアウトで後の記録がPBを更新する', () => {
  const workouts = [
    { date: '2026-07-20', program: 'B', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] },
    { date: '2026-07-27', program: 'B', sets: [{ exId: 'seated_row', weight: 35, reps: 8 }] } // PB
  ];
  const result = recomputeGame(workouts, EXERCISES, flatBodyweight(60));
  assert.deepEqual(result.bests.seated_row, { weight: 35, reps: 8, date: '2026-07-27' });
});

test('recomputeGame: PBを出した記録を削除すると bests は次点に戻る(消えたまま残らない)', () => {
  const withPb = [
    { date: '2026-07-20', program: 'B', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] },
    { date: '2026-07-27', program: 'B', sets: [{ exId: 'seated_row', weight: 35, reps: 8 }] } // PB。260kg誤入力のようなケースを想定
  ];
  const before = recomputeGame(withPb, EXERCISES, flatBodyweight(60));
  assert.deepEqual(before.bests.seated_row, { weight: 35, reps: 8, date: '2026-07-27' });

  // PBを出した記録(2026-07-27)を削除した後の履歴
  const afterDeletion = withPb.filter((w) => w.date !== '2026-07-27');
  const after = recomputeGame(afterDeletion, EXERCISES, flatBodyweight(60));
  assert.deepEqual(after.bests.seated_row, { weight: 30, reps: 10, date: '2026-07-20' });
});

test('recomputeGame: XPは同じ履歴をaddWorkoutXpで順に積み上げた結果と一致する', () => {
  const workouts = [
    { date: '2026-07-13', program: 'B', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] },
    { date: '2026-07-20', program: 'A', sets: [{ exId: 'lat_pulldown', weight: 32.5, reps: 8 }] },
    { date: '2026-07-27', program: 'B', sets: [{ exId: 'biceps_curl', weight: 15, reps: 10 }] }
  ];
  let expectedXp = EMPTY_XP;
  for (const w of workouts) expectedXp = addWorkoutXp(expectedXp, w, EXERCISES, 60);

  const result = recomputeGame(workouts, EXERCISES, flatBodyweight(60));
  assert.deepEqual(result.xp, expectedXp);
});

test('recomputeGame: 体重依存種目(assist/bodyweight)は日付ごとの体重で解決する', () => {
  const bodyweightExercises = [
    { id: 'chin_assist', part: 'back', load: 'assist' },
    { id: 'ab_coaster', part: 'abs', load: 'bodyweight' }
  ];
  const workouts = [
    { date: '2026-04-01', program: 'B', sets: [{ exId: 'chin_assist', weight: -40, reps: 8 }] }, // 当時55kg → (55-40)*8=120
    { date: '2026-07-01', program: 'C', sets: [{ exId: 'ab_coaster', weight: 0, reps: 15 }] }    // 現在60kg → 60*15=900
  ];
  const bodyweightForDate = (d) => (d < '2026-06-01' ? 55 : 60);
  const result = recomputeGame(workouts, bodyweightExercises, bodyweightForDate);
  assert.equal(result.xp.back, 12);  // 120/10、今の体重(60)ではなく当時(55)基準
  assert.equal(result.xp.abs, 90);   // 900/10
});

test('recomputeGame: 壊れたレコード(null・日付不正・sets非配列)は例外を投げずに除外する', () => {
  const workouts = [
    null,
    { date: undefined, program: 'B', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] },
    { date: '2026-07-27', program: 'B', sets: 'garbage' },
    { date: '2026-07-29', program: 'B', sets: [{ exId: 'seated_row', weight: 32.5, reps: 8 }] }
  ];
  assert.doesNotThrow(() => recomputeGame(workouts, EXERCISES, flatBodyweight(60)));
  const result = recomputeGame(workouts, EXERCISES, flatBodyweight(60));
  assert.deepEqual(result.bests.seated_row, { weight: 32.5, reps: 8, date: '2026-07-29' });
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
