// このファイルのテストが「何を保証しているか」の記録。
// 下の MUTATION 行は、実装を意図的にその形へ壊したときに落ちるテストの件数である。
// テストが通ることは、そのテストが何かを保証している証拠にはならない。
// 保証しているかどうかは、壊して落ちることでしか確かめられない(docs/SPEC.md §5.2)。
// 実装を変えたら、この記録も実際に壊して数え直すこと。
// MUTATION: js/nutrition.js:belowFloor 常にfalseにする => 期待失敗 8件
// MUTATION: js/nutrition.js:kcalOver フロア未満でも上限超過を出す => 期待失敗 1件
// MUTATION: js/nutrition.js:DEFAULT_DAY_OVER_HOUR 22->20 => 期待失敗 2件
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayTotals, achievement, sortFoodsByUse, bumpFoodUse, isDayOver, DEFAULT_DAY_OVER_HOUR, daysSinceLastMealLog, MEAL_LOG_GAP_DAYS } from '../js/nutrition.js';
import { estimateFfmKg } from '../js/energy.js';

const TARGETS = { protein: 100, kcalMin: 1700, kcalMax: 1800, kcalFloor: 1500, alcoholMl: 500 };

const MEALS = [
  { id: 'm1', datetime: '2026-07-29T07:00', items: [{ name: 'プロテイン', kcal: 120, protein: 24 }] },
  { id: 'm2', datetime: '2026-07-29T19:00', items: [
      { name: '唐揚げ', kcal: 600, protein: 35 },
      { name: 'ごはん150g', kcal: 234, protein: 4 }
  ] },
  { id: 'm3', datetime: '2026-07-29T21:00', items: [{ name: '発泡酒500ml', kcal: 150, protein: 0, alcoholMl: 500 }] },
  { id: 'm4', datetime: '2026-07-28T19:00', items: [{ name: '別の日', kcal: 999, protein: 99 }] }
];

test('その日の合計だけを集計する', () => {
  const t = dayTotals(MEALS, '2026-07-29');
  assert.equal(t.kcal, 120 + 600 + 234 + 150);
  assert.equal(t.protein, 24 + 35 + 4);
  assert.equal(t.alcoholMl, 500);
});

test('記録が無い日は0になる(ただしfat/carb/fibre/vitaminD/calcium/saltはunknown扱い。まだ何も記録していないだけで実測ゼロではない)', () => {
  assert.deepEqual(dayTotals(MEALS, '2026-01-01'), {
    kcal: 0, protein: 0, alcoholMl: 0, alcoholG: 0, alcoholKcal: 0, fat: 0, carb: 0, fibre: 0, vitaminD: 0, calcium: 0, salt: 0,
    fatKnown: false, carbKnown: false, fibreKnown: false, vitaminDKnown: false, calciumKnown: false, saltKnown: false
  });
});

// --- fat/carb集計: 「不明」と「実測0」の区別 ---

test('dayTotals: MEALSの品目にはfat/carbフィールドが無い(既存の食品マスタ・記録の実態)ため、fat/carbKnownはfalseになる', () => {
  const t = dayTotals(MEALS, '2026-07-29');
  assert.equal(t.fat, 0);
  assert.equal(t.carb, 0);
  assert.equal(t.fatKnown, false);
  assert.equal(t.carbKnown, false);
});

test('dayTotals: 全品目にfat/carbが記録されていれば合計しKnownはtrueのまま', () => {
  const meals = [
    { id: 'm1', datetime: '2026-08-01T07:00', items: [{ name: 'プロテイン', kcal: 120, protein: 24, fat: 1, carb: 3 }] },
    { id: 'm2', datetime: '2026-08-01T19:00', items: [{ name: 'ごはん150g', kcal: 234, protein: 4, fat: 0.5, carb: 53 }] }
  ];
  const t = dayTotals(meals, '2026-08-01');
  assert.equal(t.fat, 1.5);
  assert.equal(t.carb, 56);
  assert.equal(t.fatKnown, true);
  assert.equal(t.carbKnown, true);
});

test('dayTotals: 一部の品目だけfat/carbが欠けていても、記録されている分は合計しつつKnownはfalseにする(過小合計であることを示す)', () => {
  const meals = [
    { id: 'm1', datetime: '2026-08-01T07:00', items: [{ name: 'プロテイン', kcal: 120, protein: 24, fat: 1, carb: 3 }] },
    // からあげ(fat/carbフィールドが無い旧シード相当の記録)
    { id: 'm2', datetime: '2026-08-01T19:00', items: [{ name: '唐揚げ', kcal: 600, protein: 35 }] }
  ];
  const t = dayTotals(meals, '2026-08-01');
  assert.equal(t.fat, 1); // 記録されている分だけの合計(過小)
  assert.equal(t.carb, 3);
  assert.equal(t.fatKnown, false);
  assert.equal(t.carbKnown, false);
});

test('dayTotals: fat/carbが0という明示的な値(記録された実測ゼロ)はKnownをfalseにしない', () => {
  const meals = [
    { id: 'm1', datetime: '2026-08-01T21:00', items: [{ name: '発泡酒500ml', kcal: 150, protein: 0, fat: 0, carb: 11, alcoholMl: 500 }] }
  ];
  const t = dayTotals(meals, '2026-08-01');
  assert.equal(t.fat, 0);
  assert.equal(t.carb, 11);
  assert.equal(t.fatKnown, true);
  assert.equal(t.carbKnown, true);
});

test('dayTotals: fat/carbが非数値(壊れたデータ)ならKnownをfalseにし、加算もしない', () => {
  const meals = [
    { id: 'm1', datetime: '2026-08-01T19:00', items: [{ name: 'x', kcal: 100, protein: 10, fat: 'oops', carb: null }] }
  ];
  const t = dayTotals(meals, '2026-08-01');
  assert.equal(t.fat, 0);
  assert.equal(t.carb, 0);
  assert.equal(t.fatKnown, false);
  assert.equal(t.carbKnown, false);
});

test('達成率を返す（一日の終わりに達成していれば警告なし）', () => {
  const a = achievement({ kcal: 1750, protein: 100, alcoholMl: 500 }, TARGETS, { dayOver: true });
  assert.equal(a.proteinPct, 100);
  assert.equal(a.kcalPct, 100);
  assert.equal(a.alcoholOver, false);
  assert.deepEqual(a.warnings, []);
});

test('dayOverの日に1500kcal未満だと「食べなさすぎ」警告を出す', () => {
  const a = achievement({ kcal: 1200, protein: 100, alcoholMl: 0 }, TARGETS, { dayOver: true });
  assert.ok(a.warnings.some((w) => w.level === 'danger' && w.type === 'kcalFloor'));
});

test('dayOverの日に1000kcal台は筋肉が削れる領域としてより強い警告を出す', () => {
  const a = achievement({ kcal: 1000, protein: 100, alcoholMl: 0 }, TARGETS, { dayOver: true });
  const w = a.warnings.find((x) => x.type === 'kcalFloor');
  assert.equal(w.level, 'danger');
  assert.match(w.message, /筋肉/);
});

test('目標上限を超えると軽い注意のみ（下限割れより弱い、dayOverに関わらず出る）', () => {
  const a = achievement({ kcal: 2200, protein: 100, alcoholMl: 0 }, TARGETS);
  const w = a.warnings.find((x) => x.type === 'kcalOver');
  assert.equal(w.level, 'info');
});

test('日中(dayOverでない)は下限割れでも danger を出さず、残量を info で示す', () => {
  // 朝の180kcalの朝食。1日の途中でdangerを出し続けると壁紙化して無視されるようになる。
  const a = achievement({ kcal: 180, protein: 20, alcoholMl: 0 }, TARGETS, { dayOver: false });
  assert.ok(!a.warnings.some((w) => w.type === 'kcalFloor'));
  assert.ok(!a.warnings.some((w) => w.level === 'danger'));
  const remaining = a.warnings.find((w) => w.type === 'kcalRemaining');
  assert.ok(remaining);
  assert.equal(remaining.level, 'info');
  assert.equal(remaining.message, `残り ${TARGETS.kcalMin - 180}kcal`);
});

test('同じ総量でも一日が終わっていれば(dayOver: true) danger警告に切り替わる', () => {
  const a = achievement({ kcal: 180, protein: 20, alcoholMl: 0 }, TARGETS, { dayOver: true });
  const w = a.warnings.find((x) => x.type === 'kcalFloor');
  assert.ok(w);
  assert.equal(w.level, 'danger');
});

test('dayOverを省略すると日中扱い(danger警告を出さない)がデフォルトになる', () => {
  const a = achievement({ kcal: 180, protein: 20, alcoholMl: 0 }, TARGETS);
  assert.ok(!a.warnings.some((w) => w.level === 'danger'));
});

test('タンパク質不足を警告する', () => {
  const a = achievement({ kcal: 1750, protein: 60, alcoholMl: 0 }, TARGETS);
  assert.ok(a.warnings.some((w) => w.type === 'proteinShort'));
});

test('発泡酒が500mlを超えると注意する', () => {
  const a = achievement({ kcal: 1750, protein: 100, alcoholMl: 1000 }, TARGETS);
  assert.equal(a.alcoholOver, true);
});

test('食品は使用回数の多い順に並ぶ', () => {
  const foods = [
    { id: 'f1', name: 'ゆで卵', useCount: 3 },
    { id: 'f2', name: 'プロテイン', useCount: 20 },
    { id: 'f3', name: '唐揚げ', useCount: 7 }
  ];
  assert.deepEqual(sortFoodsByUse(foods).map((f) => f.id), ['f2', 'f3', 'f1']);
});

test('bumpFoodUse は使用回数を1増やした新しい配列を返す', () => {
  const foods = [{ id: 'f1', name: 'ゆで卵', useCount: 3 }];
  const next = bumpFoodUse(foods, 'f1');
  assert.equal(foods[0].useCount, 3);
  assert.equal(next[0].useCount, 4);
});

test('まだ何も記録していない日(kcal:0)は「食べなさすぎ」警告を出さない', () => {
  const t = dayTotals([], '2026-07-29');
  assert.deepEqual(t, {
    kcal: 0, protein: 0, alcoholMl: 0, alcoholG: 0, alcoholKcal: 0, fat: 0, carb: 0, fibre: 0, vitaminD: 0, calcium: 0, salt: 0,
    fatKnown: false, carbKnown: false, fibreKnown: false, vitaminDKnown: false, calciumKnown: false, saltKnown: false
  });
  const a = achievement(t, TARGETS);
  assert.ok(!a.warnings.some((w) => w.type === 'kcalFloor'));
});

test('dayTotals は壊れたmealレコードを例外を投げずに読み飛ばす', () => {
  const meals = [
    { id: 'ok', datetime: '2026-07-29T19:00', items: [{ kcal: 100, protein: 10 }] },
    { id: 'no-datetime', items: [{ kcal: 999, protein: 99 }] },
    { id: 'null-datetime', datetime: null, items: [{ kcal: 999, protein: 99 }] },
    null,
    { id: 'items-not-array', datetime: '2026-07-29T20:00', items: 'garbage' }
  ];
  assert.deepEqual(dayTotals(meals, '2026-07-29'), {
    kcal: 100, protein: 10, alcoholMl: 0, alcoholG: 0, alcoholKcal: 0, fat: 0, carb: 0, fibre: 0, vitaminD: 0, calcium: 0, salt: 0,
    fatKnown: false, carbKnown: false, fibreKnown: false, vitaminDKnown: false, calciumKnown: false, saltKnown: false
  });
});

// --- 食物繊維・ビタミンD・カルシウム・食塩相当量・純アルコール(g)の集計 ---

test('dayTotals: fibre/vitaminD/calcium/saltが全品目に記録されていれば合計しKnownはtrueのまま', () => {
  const meals = [
    { id: 'm1', datetime: '2026-08-01T19:00', items: [
      { name: '納豆', kcal: 100, protein: 8, fibre: 3, vitaminD: 0, calcium: 45, salt: 0.7 },
      { name: '鮭', kcal: 140, protein: 22, fibre: 0, vitaminD: 25, calcium: 10, salt: 1.2 }
    ] }
  ];
  const t = dayTotals(meals, '2026-08-01');
  assert.equal(t.fibre, 3);
  assert.equal(t.vitaminD, 25);
  assert.equal(t.calcium, 55);
  assert.equal(t.salt, 1.9);
  assert.equal(t.fibreKnown, true);
  assert.equal(t.vitaminDKnown, true);
  assert.equal(t.calciumKnown, true);
  assert.equal(t.saltKnown, true);
});

test('dayTotals: 一部の品目だけfibre/vitaminD/calcium/saltが欠けていればKnownをfalseにする(過小合計であることを示す)', () => {
  const meals = [
    { id: 'm1', datetime: '2026-08-01T19:00', items: [
      { name: '納豆', kcal: 100, protein: 8, fibre: 3, vitaminD: 0, calcium: 45, salt: 0.7 },
      { name: '唐揚げ(旧レコード)', kcal: 600, protein: 35 }
    ] }
  ];
  const t = dayTotals(meals, '2026-08-01');
  assert.equal(t.fibre, 3);
  assert.equal(t.calcium, 45);
  assert.equal(t.fibreKnown, false);
  assert.equal(t.vitaminDKnown, false);
  assert.equal(t.calciumKnown, false);
  assert.equal(t.saltKnown, false);
});

test('dayTotals: 純アルコール(alcoholG) = ml × 度数% ÷ 100 × 0.8。度数未指定なら既定の5%を使う(500ml・5%で20g)', () => {
  const meals = [
    { id: 'm1', datetime: '2026-08-01T21:00', items: [{ name: '発泡酒500ml', kcal: 150, protein: 0, alcoholMl: 500 }] }
  ];
  const t = dayTotals(meals, '2026-08-01');
  assert.equal(t.alcoholMl, 500);
  assert.equal(t.alcoholG, 20);
});

test('dayTotals: 品目にalcoholAbvPctがあればそちらを使う(既定の5%を上書きする)', () => {
  const meals = [
    { id: 'm1', datetime: '2026-08-01T21:00', items: [{ name: '缶チューハイ500ml(9%)', kcal: 200, protein: 0, alcoholMl: 500, alcoholAbvPct: 9 }] }
  ];
  const t = dayTotals(meals, '2026-08-01');
  assert.equal(t.alcoholG, 500 * 0.09 * 0.8);
});

test('dayTotals: alcoholKcalはアルコール品目(alcoholMl>0)のkcalだけを合計する(固定値を決め打ちしない)', () => {
  const meals = [
    { id: 'm1', datetime: '2026-08-01T19:00', items: [
      { name: '唐揚げ', kcal: 600, protein: 35 },
      { name: '発泡酒500ml', kcal: 150, protein: 0, alcoholMl: 500 }
    ] }
  ];
  const t = dayTotals(meals, '2026-08-01');
  assert.equal(t.alcoholKcal, 150);
  assert.equal(t.kcal, 750);
});

test('targetsの分母が0または非有限なら達成率は0%として扱う（Infinity/NaNを出さない）', () => {
  const a1 = achievement({ kcal: 1750, protein: 100, alcoholMl: 0 }, { ...TARGETS, protein: 0 });
  assert.equal(a1.proteinPct, 0);

  // kcalMin=0 は「バーの分母を0にして達成率表示を無効化する」抜け道だった。
  // 現在、達成率の分母は max(kcalMin, フロア) なので、kcalMin を0にしても
  // 警告ライン(kcalFloor=1500)基準で評価され続ける。Infinity/NaN も出ない。
  const a2 = achievement({ kcal: 1750, protein: 100, alcoholMl: 0 }, { ...TARGETS, kcalMin: 0 });
  assert.equal(a2.kcalPct, 100);
  assert.ok(Number.isFinite(a2.kcalPct));

  // 分母になりうる値が全て0/非有限のときだけ、割り算を行わず0%へフォールバックする。
  const a3 = achievement({ kcal: 1750, protein: 100, alcoholMl: 0 }, { ...TARGETS, kcalMin: 0, kcalFloor: 0 });
  assert.equal(a3.kcalPct, 0);
});

// --- 【安全装置】下限判定が上限超過の判定に潰されないこと ---
// これらは「kcalMax を下げるだけで下限警告を到達不能にできた」欠陥に対する回帰テスト。
// 実装の分岐を排他(if/else if)に戻すと必ず落ちる。

test('achievement: kcalMaxを下限より低く設定しても、下限割れのdanger警告は出る', () => {
  // 利用者が上限を1,000kcalに下げた状態で1,100kcal摂取。EAフロアは30*48+184=1,624kcal。
  // 以前は「上限超過(info)」が成立した時点で下限判定に到達せず、
  // 食べなさすぎの日に「目標を100kcal超えています」とだけ表示されていた。
  const a = achievement(
    { kcal: 1100, protein: 100, alcoholMl: 0 },
    { ...TARGETS, kcalMin: 1000, kcalMax: 1000 },
    { dayOver: true, ffmKg: 48, exerciseKcal: 184 }
  );
  const floorWarning = a.warnings.find((w) => w.type === 'kcalFloor');
  assert.ok(floorWarning, 'EAフロアを下回っているので kcalFloor 警告が出なければならない');
  assert.equal(floorWarning.level, 'danger');
});

test('achievement: フロアを下回っている間は上限超過(kcalOver)を出さない', () => {
  // EAフロア未満の状態で「目標を超えています」と伝えるのは、摂取を減らす方向へ
  // 誘導することになり、このアプリの目的と正面から反する。
  const a = achievement(
    { kcal: 1100, protein: 100, alcoholMl: 0 },
    { ...TARGETS, kcalMin: 1000, kcalMax: 1000 },
    { dayOver: true, ffmKg: 48, exerciseKcal: 184 }
  );
  assert.equal(a.warnings.find((w) => w.type === 'kcalOver'), undefined);
});

test('achievement: フロアより上で上限を超えていれば、従来どおりkcalOver(info)を出す', () => {
  const a = achievement(
    { kcal: 1900, protein: 100, alcoholMl: 0 },
    TARGETS,
    { dayOver: true, ffmKg: 48, exerciseKcal: 184 }
  );
  const over = a.warnings.find((w) => w.type === 'kcalOver');
  assert.ok(over, '1,900kcal は EAフロア1,624 より上で上限1,800を超えている');
  assert.equal(over.level, 'info');
  assert.equal(a.warnings.find((w) => w.type === 'kcalFloor'), undefined);
});

test('achievement: 「残りkcal」のアンカーはkcalMinではなくEAフロアの方が大きければEAフロア', () => {
  // kcalMin=1000 のまま kcalMin を分母にすると、900kcal時点で「残り100kcal」=
  // もうすぐ終わり、という誤った安心を与える。実際のEAフロアは1,624kcal。
  const a = achievement(
    { kcal: 900, protein: 100, alcoholMl: 0 },
    { ...TARGETS, kcalMin: 1000, kcalMax: 1000 },
    { dayOver: false, ffmKg: 48, exerciseKcal: 184 }
  );
  const remaining = a.warnings.find((w) => w.type === 'kcalRemaining');
  assert.ok(remaining);
  assert.match(remaining.message, /残り 724kcal/); // 1624 - 900
});

// --- isDayOver（「その日の食事は終わった」とみなす時刻） ---

test('isDayOver: 既定の閾値は22時（朝プロテイン+夕食1食の生活で20時は夕食前に誤爆する）', () => {
  assert.equal(DEFAULT_DAY_OVER_HOUR, 22);
  assert.equal(isDayOver(20), false);
  assert.equal(isDayOver(21), false);
  assert.equal(isDayOver(22), true);
  assert.equal(isDayOver(23), true);
});

test('isDayOver: 利用者が閾値を指定できる', () => {
  assert.equal(isDayOver(20, 20), true);
  assert.equal(isDayOver(19, 20), false);
  assert.equal(isDayOver(0, 0), true);
});

test('isDayOver: 閾値が不正（範囲外・非数値・未指定）なら既定値へフォールバックする', () => {
  for (const bad of [undefined, null, NaN, -1, 24, 99, 'abc', {}]) {
    assert.equal(isDayOver(21, bad), false, `${String(bad)} は既定22時にフォールバックすべき`);
    assert.equal(isDayOver(22, bad), true, `${String(bad)} は既定22時にフォールバックすべき`);
  }
});

// --- achievement() のEA(エネルギー可用性)フロア連動(js/energy.js の eaFloorKcal) ---

test('achievement: FFM既知ならEAフロアを下限の基準に使う(固定targets.kcalFloorより厳しくなりうる)', () => {
  // FFM48kg・運動消費184kcal/日 → EAフロア = 30*48+184 = 1,624kcal
  // 1,600kcalはTARGETSの固定kcalFloor(1,500)より高いので従来なら警告は出ないが、
  // EAフロア(1,624)を下回るため danger 警告に切り替わる。
  const a = achievement({ kcal: 1600, protein: 100, alcoholMl: 0 }, TARGETS, { dayOver: true, ffmKg: 48, exerciseKcal: 184 });
  const w = a.warnings.find((x) => x.type === 'kcalFloor');
  assert.ok(w, 'EAフロアを下回っているのでkcalFloor警告が出るはず');
  assert.equal(w.level, 'danger');
  assert.match(w.message, /エネルギー可用性/);
  assert.match(w.message, /1624/);
});

test('achievement: 同じ1,600kcalでもffmKgを渡さなければ固定targets.kcalFloor(1,500)基準のまま警告なし', () => {
  const a = achievement({ kcal: 1600, protein: 100, alcoholMl: 0 }, TARGETS, { dayOver: true });
  assert.ok(!a.warnings.some((w) => w.type === 'kcalFloor'));
});

test('achievement: ffmKgが不正(0以下・非数値)なら固定targets.kcalFloorにフォールバックする', () => {
  const a = achievement({ kcal: 1600, protein: 100, alcoholMl: 0 }, TARGETS, { dayOver: true, ffmKg: 0, exerciseKcal: 184 });
  assert.ok(!a.warnings.some((w) => w.type === 'kcalFloor'));
});

test('achievement: EAフロアを上回っていればFFM既知でも警告は出ない', () => {
  const a = achievement({ kcal: 1700, protein: 100, alcoholMl: 0 }, TARGETS, { dayOver: true, ffmKg: 48, exerciseKcal: 184 });
  assert.ok(!a.warnings.some((w) => w.type === 'kcalFloor'));
});

// --- 回帰確認: InBody記録が無くてもEAフロアが運動消費を反映すること ---
//
// 以前は「InBody記録が無ければ ffmKg は null」という呼び出し側の実装のせいで、
// 実際にトレーニングしているユーザーでも運動消費の項が丸ごと落ち、固定の
// targets.kcalFloor(この既定値ですら1500→1440に下がっている)にフォールバックして
// いた。js/energy.js の estimateFfmKg(bodyRecord, fallbackWeightKg) が
// profile.weight から概算FFMを返すようになったことで、この経路でも
// EAフロア(30×FFM+運動消費)が使われることを確認する。
test('achievement: InBody記録が無くても(profile.weightからの概算FFM経由で)EAフロアで判定する(回帰確認)', () => {
  // estimateFfmKg(null, 60) → FFM = 60kg × (1 − 20%) = 48kg, estimated: true
  const ffmResult = estimateFfmKg(null, 60);
  assert.equal(ffmResult.estimated, true);
  assert.equal(ffmResult.ffmKg, 48);

  const exerciseKcal = 132; // 直近7日の実測運動消費の例(js/energy.js dailyExerciseKcal相当)
  // floor = 30*48 + 132 = 1572kcal。固定既定値1440はもちろん、旧既定値1500よりも高い。
  const a = achievement({ kcal: 1460, protein: 100, alcoholMl: 0 }, TARGETS, {
    dayOver: true,
    ffmKg: ffmResult.ffmKg,
    exerciseKcal
  });
  const w = a.warnings.find((x) => x.type === 'kcalFloor');
  assert.ok(w, 'InBody記録が無くても運動消費を反映したEAフロアで警告が出るはず(以前は無警告になっていた回帰)');
  assert.equal(w.level, 'danger');
  assert.match(w.message, /1572/);
});

// --- 【安全装置】運動消費が不明なとき、下限判定を保留すること ---

test('achievement: exerciseKcal が null（体重未記録）なら下限判定を行わず eaUnavailable を返す', () => {
  // 摂取1,100kcal は固定の kcalFloor(1500) を下回るが、運動消費が不明なので
  // 「1500を基準に判定する」ことはできない。フロアを固定値へ緩めて
  // 「1500未満だから警告」と出すのも、逆に「運動0だから足りている」と
  // 判断するのも、どちらも根拠が無い。判定そのものを保留する。
  const a = achievement(
    { kcal: 1100, protein: 100, alcoholMl: 0 },
    TARGETS,
    { dayOver: true, ffmKg: 48, exerciseKcal: null }
  );
  assert.equal(a.warnings.find((w) => w.type === 'kcalFloor'), undefined, '下限判定は行わない');
  const unavailable = a.warnings.find((w) => w.type === 'eaUnavailable');
  assert.ok(unavailable, 'eaUnavailable 警告を1件返すこと');
  assert.equal(unavailable.level, 'warn');
});

test('achievement: exerciseKcal を省略した場合は従来どおり 0 として扱う（後方互換）', () => {
  const a = achievement({ kcal: 1100, protein: 100, alcoholMl: 0 }, TARGETS, { dayOver: true, ffmKg: 48 });
  // EAフロア = 30*48 + 0 = 1440。1,100 はこれを下回るので danger が出る。
  const floor = a.warnings.find((w) => w.type === 'kcalFloor');
  assert.ok(floor, '省略時は運動0として計算し、下限判定は行う');
  assert.equal(a.warnings.find((w) => w.type === 'eaUnavailable'), undefined);
});

test('achievement: 運動消費が不明でもタンパク質の警告は従来どおり出る', () => {
  const a = achievement(
    { kcal: 1100, protein: 40, alcoholMl: 0 },
    TARGETS,
    { dayOver: true, ffmKg: 48, exerciseKcal: null }
  );
  assert.ok(a.warnings.find((w) => w.type === 'proteinShort'), '下限判定の保留は他の警告を止めない');
});

// --- 記録の途切れ検知（R3.7.1） ---
// 【なぜ要るか】achievement() は kcal === 0（まだ何も記録していない日）を
// danger の対象にしない。意図は妥当だが、帰結として「食事を記録しなくなれば
// EA関連の警告は全て消える」。極端な減量志向の再発は、まさに記録が途切れる
// 形で現れる。「食べていないから記録しない」と「記録していないから警告が
// 出ない」が同じ状態になってはならない。

test('daysSinceLastMealLog: 最後に食事を記録した日からの日数を返す', () => {
  const meals = [
    { id: 'a', datetime: '2026-08-10T19:00', items: [] },
    { id: 'b', datetime: '2026-08-16T19:00', items: [] }
  ];
  assert.equal(daysSinceLastMealLog(meals, '2026-08-19'), 3);
  assert.equal(daysSinceLastMealLog(meals, '2026-08-16'), 0);
});

test('daysSinceLastMealLog: 記録が1件も無ければ null', () => {
  assert.equal(daysSinceLastMealLog([], '2026-08-19'), null);
  assert.equal(daysSinceLastMealLog(null, '2026-08-19'), null);
});

test('daysSinceLastMealLog: 壊れたレコード・未来日付を読み飛ばす', () => {
  const meals = [
    null,
    { id: 'no-dt', items: [] },
    { id: 'bad', datetime: 'いつか', items: [] },
    { id: 'future', datetime: '2099-01-01T19:00', items: [] },
    { id: 'ok', datetime: '2026-08-17T19:00', items: [] }
  ];
  assert.equal(daysSinceLastMealLog(meals, '2026-08-19'), 2);
});

test('MEAL_LOG_GAP_DAYS は3日。これを超えたら記録が途切れているとみなす', () => {
  assert.equal(MEAL_LOG_GAP_DAYS, 3);
});
