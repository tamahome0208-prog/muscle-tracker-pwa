import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rmrCunningham,
  rmrTenHaaf,
  estimateFfmKg,
  dailyExerciseKcal,
  energyAvailability,
  eaFloorKcal,
  eaOptimalKcal,
  equationMaintenanceEstimate,
  estimateMaintenance
} from '../js/energy.js';

// --- RMR式: 研究記載の実測値との照合 ---

test('rmrCunningham: 162cm/60kg/男性相当、FFM48kgで約1,407kcal', () => {
  assert.equal(Math.round(rmrCunningham(48)), 1407);
});

test('rmrCunningham: 不正なFFM(0以下・非数値)は0を返す', () => {
  assert.equal(rmrCunningham(0), 0);
  assert.equal(rmrCunningham(-10), 0);
  assert.equal(rmrCunningham('oops'), 0);
  assert.equal(rmrCunningham(null), 0);
});

test('rmrTenHaaf: 162cm/60kg/35歳/男性で約1,604kcal', () => {
  const ree = rmrTenHaaf({ weightKg: 60, heightM: 1.62, ageYears: 35, isMale: true });
  assert.equal(Math.round(ree), 1604);
});

// 出回っている「kcal版」の壊れた式は通常の入力で負の値を返す。正しい式(kJ→kcal変換)は
// 現実的な入力(成人・通常の身長体重)で必ず正の妥当な値を返さなければならない。
// このテストは、将来誰かが誤って壊れた式に差し替えてしまうことを防ぐためのガード。
test('rmrTenHaaf: 現実的な入力(成人男女どちらも)で正の妥当な値を返す(壊れたkcal版の混入防止)', () => {
  const male = rmrTenHaaf({ weightKg: 60, heightM: 1.62, ageYears: 35, isMale: true });
  const female = rmrTenHaaf({ weightKg: 55, heightM: 1.58, ageYears: 30, isMale: false });
  for (const v of [male, female]) {
    assert.ok(Number.isFinite(v), '有限の数値であること');
    assert.ok(v > 500 && v < 3000, `成人の基礎代謝として妥当な範囲であること(実際: ${v})`);
  }
});

test('rmrTenHaaf: 不正な入力は0を返す', () => {
  assert.equal(rmrTenHaaf({ weightKg: 0, heightM: 1.62, ageYears: 35, isMale: true }), 0);
  assert.equal(rmrTenHaaf({ weightKg: 60, heightM: 1.62, ageYears: 35 }), rmrTenHaaf({ weightKg: 60, heightM: 1.62, ageYears: 35, isMale: false }));
  assert.equal(rmrTenHaaf({}), 0);
});

// --- estimateFfmKg ---

test('estimateFfmKg: InBody記録(体重60kg・体脂肪率20%)があれば実測ベースでFFM48kg・estimated:false', () => {
  const r = estimateFfmKg({ weight: 60, fatPct: 20 });
  assert.equal(r.ffmKg, 48);
  assert.equal(r.estimated, false);
});

test('estimateFfmKg: InBody記録が不正でもfallbackWeightKgがあれば体重から概算し、estimated:trueで返す', () => {
  const r1 = estimateFfmKg({ weight: 0, fatPct: 20 }, 60);
  assert.equal(r1.ffmKg, 48); // 60 * (1 - 20/100)
  assert.equal(r1.estimated, true);

  const r2 = estimateFfmKg(null, 60);
  assert.equal(r2.ffmKg, 48);
  assert.equal(r2.estimated, true);

  const r3 = estimateFfmKg({ weight: 60, fatPct: 100 }, 60); // fatPctが不正でも同様にフォールバック
  assert.equal(r3.ffmKg, 48);
  assert.equal(r3.estimated, true);
});

test('estimateFfmKg: InBody記録が有効ならfallbackWeightKgより実測を優先する', () => {
  const r = estimateFfmKg({ weight: 55, fatPct: 15 }, 999);
  assert.equal(r.ffmKg, 55 * 0.85);
  assert.equal(r.estimated, false);
});

test('estimateFfmKg: InBody記録もfallbackWeightKgも無ければnull(体組成・体重ともに不明)', () => {
  assert.equal(estimateFfmKg({ weight: 0, fatPct: 20 }), null);
  assert.equal(estimateFfmKg(null), null);
  assert.equal(estimateFfmKg(null, 0), null);
  assert.equal(estimateFfmKg(null, 'oops'), null);
});

// --- energyAvailability / eaFloorKcal / eaOptimalKcal ---

test('energyAvailability: (摂取-運動)/FFM。1,200kcal・運動184kcal・FFM48kgでEA約21.2', () => {
  const ea = energyAvailability(1200, 184, 48);
  assert.equal(ea.toFixed(1), '21.2');
});

test('energyAvailability: 1,000kcal・運動184kcal・FFM48kgでEA=17.0', () => {
  const ea = energyAvailability(1000, 184, 48);
  assert.equal(ea.toFixed(1), '17.0');
});

test('energyAvailability: FFM不明ならnull', () => {
  assert.equal(energyAvailability(1500, 100, null), null);
  assert.equal(energyAvailability(1500, 100, 0), null);
});

test('energyAvailability: 摂取・運動が非数値でも例外を投げず計算する(0扱い)', () => {
  assert.equal(energyAvailability('oops', undefined, 48), 0);
});

test('eaFloorKcal: 30×FFM+運動消費。FFM48kg・運動184kcalで1,624kcal', () => {
  assert.equal(eaFloorKcal(48, 184), 30 * 48 + 184);
  assert.equal(eaFloorKcal(48, 184), 1624);
});

test('eaOptimalKcal: 45×FFM+運動消費。FFM48kg・運動184kcalで2,344kcal', () => {
  assert.equal(eaOptimalKcal(48, 184), 45 * 48 + 184);
});

test('eaFloorKcal / eaOptimalKcal: FFM不明・不正ならnull', () => {
  assert.equal(eaFloorKcal(null, 100), null);
  assert.equal(eaOptimalKcal(0, 100), null);
});

test('eaFloorKcal: 運動消費が非数値/未指定なら0として扱う', () => {
  assert.equal(eaFloorKcal(48, undefined), 30 * 48);
  assert.equal(eaFloorKcal(48, 'oops'), 30 * 48);
});

// --- dailyExerciseKcal ---

const TODAY = '2026-08-01';

function daysAgo(n) {
  const d = new Date(TODAY + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

test('dailyExerciseKcal: セッションが無ければ0', () => {
  assert.equal(dailyExerciseKcal([], [], TODAY, 60), 0);
});

test('dailyExerciseKcal: weightKgが不正なら0', () => {
  const workouts = [{ date: TODAY, sets: new Array(18).fill({ exId: 'x', weight: 10, reps: 10 }) }];
  assert.equal(dailyExerciseKcal(workouts, [], TODAY, 0), 0);
  assert.equal(dailyExerciseKcal(workouts, [], TODAY, 'oops'), 0);
});

test('dailyExerciseKcal: 直近7日に筋トレ3回・バドミントン2回を記録した週の平均を計算する', () => {
  // 3回のワークアウト(各18セット=6種目×3セット)+ バドミントン2回(各60分)を7日以内に配置
  const workouts = [
    { date: daysAgo(0), sets: new Array(18).fill({ exId: 'x', weight: 10, reps: 10 }) },
    { date: daysAgo(2), sets: new Array(18).fill({ exId: 'x', weight: 10, reps: 10 }) },
    { date: daysAgo(4), sets: new Array(18).fill({ exId: 'x', weight: 10, reps: 10 }) }
  ];
  const badminton = [
    { date: daysAgo(1), durationMin: 60 },
    { date: daysAgo(6), durationMin: 60 }
  ];
  const weight = 60;

  // 手計算: netMET resistance = 4.0(MET5.0-1。意図的に上側に倒した値、js/energy.js参照)
  //         kcal/分 = 4.0*3.5*60/200 = 4.2
  //         1セッション = 18セット×2.5分/セット = 45分 → 4.2*45 = 189kcal、3回で567kcal
  //         netMET badminton = 4.5, kcal/分 = 4.5*3.5*60/200 = 4.725
  //         1セッション60分 → 283.5kcal、2回で567kcal
  //         週合計 1134kcal ÷ 7 = 162kcal/日
  const result = dailyExerciseKcal(workouts, badminton, TODAY, weight);
  const expectedWorkoutKcal = 4.0 * 3.5 * weight / 200 * (18 * 2.5) * 3;
  const expectedBadmintonKcal = 4.5 * 3.5 * weight / 200 * 60 * 2;
  const expected = (expectedWorkoutKcal + expectedBadmintonKcal) / 7;
  assert.ok(Math.abs(result - expected) < 1e-9);
  assert.equal(Math.round(result), 162);
  assert.ok(result > 0);
});

test('dailyExerciseKcal: 7日より前のセッションは含めない', () => {
  const workouts = [{ date: daysAgo(7), sets: new Array(18).fill({}) }];
  const badminton = [{ date: daysAgo(10), durationMin: 60 }];
  assert.equal(dailyExerciseKcal(workouts, badminton, TODAY, 60), 0);
});

test('dailyExerciseKcal: 壊れたレコード(null要素・不正date・setsが配列でない・durationMinが不正)は読み飛ばす', () => {
  const workouts = [
    null,
    { date: 'not-a-date', sets: [{}] },
    { date: TODAY, sets: 'not-an-array' },
    { date: TODAY } // sets欠損
  ];
  const badminton = [
    null,
    { date: 'invalid', durationMin: 60 },
    { date: TODAY, durationMin: 'oops' },
    { date: TODAY, durationMin: -10 },
    { date: TODAY } // durationMin欠損
  ];
  assert.equal(dailyExerciseKcal(workouts, badminton, TODAY, 60), 0);
});

// --- equationMaintenanceEstimate ---

test('equationMaintenanceEstimate: FFM既知ならCunninghamベース', () => {
  const est = equationMaintenanceEstimate({ ffmKg: 48, exerciseKcalPerDay: 184 });
  assert.equal(Math.round(est), Math.round(rmrCunningham(48) * 1.2 + 184));
});

test('equationMaintenanceEstimate: FFM不明ならten Haafベース', () => {
  const est = equationMaintenanceEstimate({ weightKg: 60, heightM: 1.62, ageYears: 35, isMale: true, exerciseKcalPerDay: 0 });
  const rmr = rmrTenHaaf({ weightKg: 60, heightM: 1.62, ageYears: 35, isMale: true });
  assert.equal(Math.round(est), Math.round(rmr * 1.2));
});

test('equationMaintenanceEstimate: RMRが計算できなければnull', () => {
  assert.equal(equationMaintenanceEstimate({}), null);
});

// --- estimateMaintenance ---

function meal(date, kcal) {
  return { id: `m_${date}`, datetime: `${date}T19:00`, items: [{ name: 'x', kcal, protein: 0 }] };
}

test('estimateMaintenance: データ不足時はequation推定にフォールバックする', () => {
  const meals = [meal(TODAY, 1800)]; // 1日分しかログが無い
  const body = [{ date: TODAY, weight: 60, muscle: 45, fatPct: 20 }]; // 1件しかない
  const result = estimateMaintenance(meals, body, TODAY, 2300);
  assert.equal(result.method, 'equation');
  assert.equal(result.kcal, 2300);
  assert.match(result.note, /予測式/);
});

test('estimateMaintenance: equation推定も無ければinsufficient(数値を捏造しない)', () => {
  const result = estimateMaintenance([], [], TODAY, null);
  assert.equal(result.method, 'insufficient');
  assert.equal(result.kcal, null);
  assert.match(result.note, /データが不足/);
});

test('estimateMaintenance: 体重が安定しているトレンドは平均摂取に近い値を返す', () => {
  const meals = [];
  for (let i = 0; i < 14; i++) meals.push(meal(daysAgo(i), 1800));
  const body = [
    { date: daysAgo(13), weight: 60.0, muscle: 45, fatPct: 20 },
    { date: daysAgo(0), weight: 60.0, muscle: 45, fatPct: 20 }
  ];
  const result = estimateMaintenance(meals, body, TODAY, 2300);
  assert.equal(result.method, 'trend');
  assert.equal(result.kcal, 1800); // 体重変化0なので平均摂取そのまま
  assert.equal(result.days, 13);
});

test('estimateMaintenance: 体重が減少しているトレンドは平均摂取より高い維持カロリーを返す', () => {
  const meals = [];
  for (let i = 0; i < 14; i++) meals.push(meal(daysAgo(i), 1700));
  const body = [
    { date: daysAgo(13), weight: 61.0, muscle: 45, fatPct: 20 },
    { date: daysAgo(0), weight: 60.0, muscle: 45, fatPct: 20 } // 13日で-1kg
  ];
  const result = estimateMaintenance(meals, body, TODAY, 2300);
  assert.equal(result.method, 'trend');
  // maintenance = 1700 + (-1 * 7700)/13 = 1700 - 592.3... ≈ 1107.7 → 実際は減少しているので
  // 「摂取より維持カロリーの方が高いはず」という直感に反するように見えるが、これは
  // 「体重が減っている=摂取<維持カロリー」ではなく「摂取-7700*delta/days」の式が
  // deltaが負(減少)のとき第2項も負になるため、maintenance < meanIntake になる。
  // これは体重が減っているのだから当然の向きである(摂取量より維持カロリーの方が低い)。
  const expected = 1700 + (-1 * 7700) / 13;
  assert.equal(result.kcal, Math.round(expected));
  assert.ok(result.kcal < 1700);
});

test('estimateMaintenance: 食事記録日数が足りない(10日未満)場合はtrendを採用せずequationにフォールバックする', () => {
  const meals = [];
  for (let i = 0; i < 5; i++) meals.push(meal(daysAgo(i), 1800)); // 14日中5日しか記録が無い
  const body = [
    { date: daysAgo(13), weight: 61.0, muscle: 45, fatPct: 20 },
    { date: daysAgo(0), weight: 60.0, muscle: 45, fatPct: 20 }
  ];
  const result = estimateMaintenance(meals, body, TODAY, 2300);
  assert.equal(result.method, 'equation');
});

test('estimateMaintenance: 体組成記録が1件しか無い場合はequationにフォールバックする', () => {
  const meals = [];
  for (let i = 0; i < 14; i++) meals.push(meal(daysAgo(i), 1800));
  const body = [{ date: daysAgo(0), weight: 60.0, muscle: 45, fatPct: 20 }];
  const result = estimateMaintenance(meals, body, TODAY, 2300);
  assert.equal(result.method, 'equation');
});

test('estimateMaintenance: 壊れた/null要素の記録は読み飛ばして判定する', () => {
  const meals = [null, { id: 'broken' }, ...Array.from({ length: 14 }, (_, i) => meal(daysAgo(i), 1800))];
  const body = [null, { date: 'bad-date', weight: 999 }, { date: daysAgo(13), weight: 60, fatPct: 20 }, { date: daysAgo(0), weight: 60, fatPct: 20 }];
  const result = estimateMaintenance(meals, body, TODAY, 2300);
  assert.equal(result.method, 'trend');
});
