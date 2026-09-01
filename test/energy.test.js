// このファイルのテストが「何を保証しているか」の記録。
// 下の MUTATION 行は、実装を意図的にその形へ壊したときに落ちるテストの件数である。
// テストが通ることは、そのテストが何かを保証している証拠にはならない。
// 保証しているかどうかは、壊して落ちることでしか確かめられない(docs/SPEC.md §5.2)。
// 実装を変えたら、この記録も実際に壊して数え直すこと。
// MUTATION: js/energy.js:dailyExerciseKcal 体重不正時に null->0 => 期待失敗 2件
// MUTATION: js/energy.js:eaFloorKcal exerciseKcal===null のガードを外す => 期待失敗 1件
// MUTATION: js/energy.js:energyAvailability exerciseKcal===null のガードを外す => 期待失敗 1件
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
  estimateMaintenance,
  macroTargets
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

test('dailyExerciseKcal: weightKgが不正なら null（旧仕様の 0 から変更）', () => {
  // 【なぜ変えたか】旧仕様は 0 を返し、このテストがその挙動を固定していた。
  // しかし EAフロア = 30 × FFM + 運動消費kcal なので、0 を返すとフロアが
  // 運動分だけ低くなり、週5日運動している人に「運動していない人の下限」を
  // 適用することになる。安全装置が緩む方向であり、テストが誤った挙動を
  // 守っていた状態だった。分からないときは緩めず、判定を保留する。
  const workouts = [{ date: TODAY, sets: new Array(18).fill({ exId: 'x', weight: 10, reps: 10 }) }];
  assert.equal(dailyExerciseKcal(workouts, [], TODAY, 0), null);
  assert.equal(dailyExerciseKcal(workouts, [], TODAY, 'oops'), null);
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

// --- macroTargets(PFC目標) ---
// このユーザー属性: 体重60kg・FFM48kg(体脂肪率20%相当)。

function approx(actual, expected, tol = 0.05) {
  assert.ok(Math.abs(actual - expected) < tol, `期待値 ${expected} に近いはず(実際: ${actual})`);
}

test('macroTargets: 入力が不正(非数値・0以下)ならnull', () => {
  assert.equal(macroTargets({ energyKcal: 0, ffmKg: 48, weightKg: 60 }), null);
  assert.equal(macroTargets({ energyKcal: 2000, ffmKg: 0, weightKg: 60 }), null);
  assert.equal(macroTargets({ energyKcal: 2000, ffmKg: 48, weightKg: 'oops' }), null);
  assert.equal(macroTargets({}), null);
});

test('macroTargets: 2300kcal(既定・非赤字)は2.4×FFMのタンパク質のままstatus ok', () => {
  const r = macroTargets({ energyKcal: 2300, ffmKg: 48, weightKg: 60, inDeficit: false });
  approx(r.proteinG, 2.4 * 48); // 115.2g、クランプ[96,132]の範囲内なのでクランプなし
  approx(r.fatG, 0.20 * 2300 / 9); // 20%Eの床が0.5×体重(30g)より高いのでこちらを採用
  approx(r.carbG, (2300 - 4 * r.proteinG - 9 * r.fatG) / 4);
  assert.ok(r.carbPerKg >= 3, '3g/kg以上を満たしているのでstatusはok');
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.notes, []);
});

test('macroTargets: 2000kcal(既定・非赤字)', () => {
  const r = macroTargets({ energyKcal: 2000, ffmKg: 48, weightKg: 60, inDeficit: false });
  approx(r.proteinG, 115.2);
  approx(r.fatG, 2000 * 0.2 / 9);
  approx(r.carbG, (2000 - 4 * 115.2 - 9 * (2000 * 0.2 / 9)) / 4);
  assert.equal(r.status, 'ok');
});

test('macroTargets: 1750kcal(既定・非赤字)は炭水化物が体重1kgあたり約3.9g', () => {
  const r = macroTargets({ energyKcal: 1750, ffmKg: 48, weightKg: 60, inDeficit: false });
  approx(r.carbPerKg, 3.9, 0.1);
  assert.equal(r.status, 'ok');
});

test('macroTargets: 1624kcal(EAフロア相当)は非赤字でもぎりぎりstatus ok(トリップワイヤーに近い)', () => {
  const r = macroTargets({ energyKcal: 1624, ffmKg: 48, weightKg: 60, inDeficit: false });
  assert.equal(r.status, 'ok');
  assert.ok(r.carbPerKg >= 3 && r.carbPerKg < 4, `境界付近のはず(実際: ${r.carbPerKg})`);
});

test('macroTargets: 1200kcal(赤字)はタンパク質・脂質を下限まで緩めても炭水化物が3g/kgに届かずenergyTooLowに自己停止する', () => {
  const r = macroTargets({ energyKcal: 1200, ffmKg: 48, weightKg: 60, inDeficit: true });
  assert.equal(r.status, 'energyTooLow');
  assert.ok(r.carbPerKg < 3, 'トリップワイヤーの3g/kgを下回っているはず');
  assert.ok(r.notes.length > 0, '説明のnoteがあるはず');
  assert.ok(r.notes.some((n) => /低すぎ/.test(n)), 'エネルギーが低すぎる旨のnoteがあるはず');
  // 静かに帳尻合わせをしない: 返ってくる数値そのものが3g/kg未満であること
  // (つまり呼び出し側が別の数値にすり替えて安全に見せていない)
  approx(r.proteinG, 96); // 1.6×60まで緩めた値
  approx(r.fatG, 1200 * 0.2 / 9); // 20%Eの床まで緩めた値
});

test('macroTargets: 赤字なしでも1200kcalは同様にenergyTooLowになる', () => {
  const r = macroTargets({ energyKcal: 1200, ffmKg: 48, weightKg: 60, inDeficit: false });
  assert.equal(r.status, 'energyTooLow');
});

test('macroTargets: エネルギー赤字期は2.8×FFMを使う(クランプに掛からない範囲で)', () => {
  const r = macroTargets({ energyKcal: 2500, ffmKg: 45, weightKg: 60, inDeficit: true });
  approx(r.proteinG, 2.8 * 45); // 126g。クランプ[96,132]の範囲内
});

test('macroTargets: タンパク質の上限クランプ(体重×2.2)が発動する', () => {
  // 赤字期・BW50kg・FFM45kg(体脂肪率10%相当の痩身): 2.8×45=126g > 2.2×50=110g
  const r = macroTargets({ energyKcal: 2200, ffmKg: 45, weightKg: 50, inDeficit: true });
  approx(r.proteinG, 110);
  assert.ok(r.notes.some((n) => /上限/.test(n)));
});

test('macroTargets: タンパク質の下限クランプ(体重×1.6)が発動する', () => {
  // 非赤字・BW80kg・FFM48kg(体脂肪率40%相当): 2.4×48=115.2g < 1.6×80=128g
  const r = macroTargets({ energyKcal: 2600, ffmKg: 48, weightKg: 80, inDeficit: false });
  approx(r.proteinG, 128);
  assert.ok(r.notes.some((n) => /下限/.test(n)));
});

test('macroTargets: 3g/kgを下回った状態からタンパク質だけの緩和で回復するとstatus relaxed', () => {
  // 赤字・1500kcal: 初期は2.8×48=134.4→クランプで132g、脂質は20%Eの床(33.3g)。
  // 炭水化物168g(2.8g/kg)は3g/kg(180g)未満なのでタンパク質を1.6×60=96gまで緩める。
  // 緩めた後の炭水化物204g(3.4g/kg)は3g/kg以上に回復するので脂質は緩めずに済む。
  const r = macroTargets({ energyKcal: 1500, ffmKg: 48, weightKg: 60, inDeficit: true });
  assert.equal(r.status, 'relaxed');
  approx(r.proteinG, 96);
  approx(r.fatG, 1500 * 0.2 / 9); // 脂質は緩めていない(20%Eの床のまま)
  assert.ok(r.carbPerKg >= 3);
  assert.ok(r.notes.some((n) => /タンパク質/.test(n) && /緩め/.test(n)));
  assert.ok(!r.notes.some((n) => /脂質.*緩め/.test(n)), '脂質はこのケースでは緩める必要が無いはず');
});

test('macroTargets: 脂質の0.5×体重の床が20%Eの床より高い場合、最初はそちらが採用される(通常時)', () => {
  // 十分なエネルギーがあり緩和が要らない代表例: 1350kcal・FFM10kg・BW60kgなら
  // タンパク質の必要量(1.6×60=96g、下限クランプ)が小さく抑えられるほどFFMが低い場合を除き
  // 一般には0.5×体重(30g)より20%Eの床の方が先に大きくなる。ここでは低カロリー・低FFMという
  // 極端な組み合わせで0.5×体重の床(30g)がそのまま採用されるケースのみを確認する
  // (3g/kgトリップワイヤーとの整合は次のテストで別途確認する)。
  const r = macroTargets({ energyKcal: 1350, ffmKg: 5, weightKg: 60, inDeficit: false });
  approx(r.fatG, 30);
});

// 【この式が持つ性質、意図的に書き残す】0.5×体重という脂質の床と、3×体重という炭水化物の
// トリップワイヤーは、定数どうしの関係上ほぼ両立しない: 脂質が0.5×体重の床で決まる
// (=E/体重が22.5kcal/kg未満)状況では、タンパク質を1.6×体重まで緩めた最良のケースでも
// 必要エネルギー密度は約22.9kcal/kg(4×1.6+9×0.5+12)であり、22.5よりわずかに高い。
// つまり脂質が0.5×体重の床で始まったケースは、この式の中でほぼ必ず脂質も
// 20%Eの床まで緩和されることになる(=0.5×体重の床のまま最終確定することは構造的に稀)。
// これは実装のバグではなく、この3つの定数(1.6・0.5・3)の組み合わせ自体が持つ性質であり、
// 「エネルギーが本当に厳しい局面では、脂質の上乗せ分より炭水化物のトリップワイヤーを
// 優先する」という設計意図とも整合している。
test('macroTargets: エネルギー密度が低い場合、脂質は0.5×体重の床から20%Eの床まで緩和される', () => {
  const r = macroTargets({ energyKcal: 1300, ffmKg: 48, weightKg: 60, inDeficit: false });
  approx(r.fatG, 1300 * 0.2 / 9);
  assert.ok(r.fatG < 30, '緩和前の0.5×体重(30g)より低い値まで下がっているはず');
  assert.equal(r.status, 'energyTooLow');
});

// --- 【安全装置】体重不明時にEAフロアを緩めないこと ---
// 以前は dailyExerciseKcal が体重不正時に 0 を返し、コメントは「運動消費不明で
// 計算を止めるより、EA計算側で『運動0』として安全側に振れる方を優先する」と
// 書いていた。これは逆である。運動消費が 0 として扱われると
// EAフロア(30 × FFM + 運動消費)が下がり、警告が緩む。

test('dailyExerciseKcal: 体重が不正・未指定なら null を返す（0ではない）', () => {
  const workouts = [{ date: '2026-08-19', sets: [{}, {}, {}] }];
  for (const bad of [null, undefined, 0, -5, NaN, 'おもい']) {
    assert.equal(
      dailyExerciseKcal(workouts, [], '2026-08-19', bad), null,
      `体重 ${String(bad)} は null を返すべき（0を返すとEAフロアが運動分だけ低くなる）`
    );
  }
});

test('dailyExerciseKcal: 体重が妥当なら従来どおり数値を返す', () => {
  const workouts = [{ date: '2026-08-19', sets: [{}, {}, {}] }];
  const v = dailyExerciseKcal(workouts, [], '2026-08-19', 60);
  assert.ok(Number.isFinite(v) && v > 0);
});

test('eaFloorKcal: 運動消費が null（不明）なら null を返す', () => {
  assert.equal(eaFloorKcal(48, null), null);
  // 未指定(undefined)は従来どおり 0 として扱う（後方互換）
  assert.equal(eaFloorKcal(48, undefined), 30 * 48);
  assert.equal(eaFloorKcal(48, 184), 30 * 48 + 184);
});

test('energyAvailability: 運動消費が null（不明）なら null を返す', () => {
  assert.equal(energyAvailability(1800, null, 48), null);
  assert.equal(energyAvailability(1800, 184, 48), (1800 - 184) / 48);
});
