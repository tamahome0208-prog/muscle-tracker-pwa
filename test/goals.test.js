import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyTrend,
  goalProgress,
  ffmi,
  ffmiHeadroom,
  projectLeanGainMonths,
  checkRateSignals,
  bodyFatGoalTension,
  recentWeeklyWeightPctChange,
  consecutiveFallingWeeks,
  LIT_LEAN_GAIN_MIN_KG_PER_MONTH,
  LIT_LEAN_GAIN_MAX_KG_PER_MONTH,
  HEALTHY_BODYFAT_RANGE_LOW
} from '../js/goals.js';

// --- bodyTrend ---

test('bodyTrend: 記録が1件だけなら null', () => {
  const body = [{ date: '2026-08-01', weight: 60, muscle: 45, fatPct: 20 }];
  assert.equal(bodyTrend(body, '2026-08-05'), null);
});

test('bodyTrend: 記録が2件だけなら null', () => {
  const body = [
    { date: '2026-06-01', weight: 60, muscle: 45, fatPct: 20 },
    { date: '2026-08-01', weight: 59.8, muscle: 46, fatPct: 19 }
  ];
  assert.equal(bodyTrend(body, '2026-08-05'), null);
});

test('bodyTrend: 記録が最低窓(8週)未満の期間に密集していれば null', () => {
  // 4件あるが、移動平均後の開始・終了点の間隔が8週(56日)に届かない短期間の記録
  const body = [
    { date: '2026-07-20', weight: 60.0, muscle: 45.0, fatPct: 20.0 },
    { date: '2026-07-27', weight: 59.9, muscle: 45.2, fatPct: 19.8 },
    { date: '2026-08-03', weight: 59.8, muscle: 45.4, fatPct: 19.6 },
    { date: '2026-08-05', weight: 59.7, muscle: 45.6, fatPct: 19.4 }
  ];
  assert.equal(bodyTrend(body, '2026-08-05'), null);
});

test('bodyTrend: 8〜12週の窓を満たせば値を返す', () => {
  // 60kg・体脂肪20% → FFM48kg から、体脂肪率をゆっくり落として筋肉を増やす
  // 現実的なペース(月0.3kg程度)を模した7件、84日スパン(2週おき)
  const body = [
    { date: '2026-05-13', weight: 60.0, muscle: 45.0, fatPct: 20.0 },
    { date: '2026-05-27', weight: 59.9, muscle: 45.3, fatPct: 19.6 },
    { date: '2026-06-10', weight: 59.9, muscle: 45.6, fatPct: 19.2 },
    { date: '2026-06-24', weight: 59.8, muscle: 45.9, fatPct: 18.8 },
    { date: '2026-07-08', weight: 59.8, muscle: 46.2, fatPct: 18.4 },
    { date: '2026-07-22', weight: 59.7, muscle: 46.5, fatPct: 18.0 },
    { date: '2026-08-05', weight: 59.7, muscle: 46.8, fatPct: 17.6 }
  ];
  const trend = bodyTrend(body, '2026-08-05');
  assert.notEqual(trend, null);
  assert.ok(trend.days >= 56);
  assert.ok(trend.ffmKg.deltaKg > 0, 'FFMが増加トレンドになっていること');
  assert.ok(trend.ffmKg.ratePerMonthKg > 0 && trend.ffmKg.ratePerMonthKg < 1, `現実的な月間レート: ${trend.ffmKg.ratePerMonthKg}`);
});

test('bodyTrend: 壊れたレコード(日付不正・体重欠損)は読み飛ばす', () => {
  const body = [
    { date: '2026-05-13', weight: 60.0, muscle: 45.0, fatPct: 20.0 },
    { date: '2026-05-27', weight: 59.9, muscle: 45.3, fatPct: 19.6 },
    { date: 'not-a-date', weight: 999, muscle: 999, fatPct: 999 },
    { date: '2026-06-24', weight: null, muscle: 45.9, fatPct: 18.8 },
    { date: '2026-07-08', weight: 59.8, muscle: 46.2, fatPct: 18.4 },
    { date: '2026-07-22', weight: 59.7, muscle: 46.5, fatPct: 18.0 },
    { date: '2026-08-05', weight: 59.7, muscle: 46.8, fatPct: 17.6 }
  ];
  // 壊れた2件を除いた有効な5件(05-13, 05-27, 07-08, 07-22, 08-05)だけで
  // 例外にならず計算できる(移動平均の開始・終了点の間隔は05-27〜07-22の56日)
  const trend = bodyTrend(body, '2026-08-05');
  assert.notEqual(trend, null);
  assert.equal(trend.days, 56);
});

test('bodyTrend: todayStrが不正なら null', () => {
  assert.equal(bodyTrend([{ date: '2026-08-01', weight: 60, fatPct: 20 }], 'oops'), null);
});

// --- ffmi / headroom ---

test('ffmi: FFM48kg・身長162cmで18.3', () => {
  const v = ffmi(48, 1.62);
  assert.equal(v.toFixed(1), '18.3');
});

test('ffmi: 不正な入力は null', () => {
  assert.equal(ffmi(0, 1.62), null);
  assert.equal(ffmi(48, 0), null);
  assert.equal(ffmi(NaN, 1.62), null);
});

test('ffmiHeadroom: 18.3の伸びしろは25基準で6.7', () => {
  const h = ffmiHeadroom(18.3);
  assert.equal(h.ceiling, 25);
  assert.equal(h.headroomFfmi.toFixed(1), '6.7');
});

// --- goalProgress ---

test('goalProgress: FFM・体脂肪率の両方の進捗を返す', () => {
  const p = goalProgress({ currentFfmKg: 48, currentBodyFatPct: 20, targetFfmKg: 54, targetBodyFatPct: 10 });
  assert.equal(p.ffmKg.remainingKg, 6);
  assert.equal(p.bodyFatPct.remainingPct, 10);
});

test('goalProgress: 現在値・目標値が不正なら null', () => {
  assert.equal(goalProgress({ currentFfmKg: NaN, targetFfmKg: 54 }), null);
});

// --- projectLeanGainMonths ---

test('projectLeanGainMonths: 実測レートがあればそれを基準に幅で返す(単一の確定日付ではない)', () => {
  const p = projectLeanGainMonths({ currentFfmKg: 48, targetFfmKg: 54, measuredRatePerMonthKg: 0.3 });
  assert.equal(p.basis, 'measured');
  assert.equal(p.reached, false);
  assert.ok(Array.isArray(p.monthsRange) && p.monthsRange.length === 2);
  assert.ok(p.monthsRange[0] < p.monthsRange[1], '楽観側 < 保守側');
  assert.equal(p.monthsRange[0], 6 / 0.3);
});

test('projectLeanGainMonths: 実測レートが無ければ文献レンジにフォールバックする', () => {
  const p = projectLeanGainMonths({ currentFfmKg: 48, targetFfmKg: 54, measuredRatePerMonthKg: null });
  assert.equal(p.basis, 'literature');
  assert.equal(p.monthsRange[0], 6 / LIT_LEAN_GAIN_MAX_KG_PER_MONTH);
  assert.equal(p.monthsRange[1], 6 / LIT_LEAN_GAIN_MIN_KG_PER_MONTH);
});

test('projectLeanGainMonths: 既に到達していれば reached:true', () => {
  const p = projectLeanGainMonths({ currentFfmKg: 55, targetFfmKg: 54 });
  assert.equal(p.reached, true);
});

test('projectLeanGainMonths: 入力が不正なら null', () => {
  assert.equal(projectLeanGainMonths({ currentFfmKg: NaN, targetFfmKg: 54 }), null);
});

// --- checkRateSignals ---

test('checkRateSignals: 全て正常なら空配列', () => {
  const problems = checkRateSignals({ weightWeeklyPctChange: 0.1, ffmChangeKgOver8Weeks: 0.2, strengthFallingWeeks: 0, eaKcalPerKgFfm: 35 });
  assert.deepEqual(problems, []);
});

test('checkRateSignals: 週1%超の体重変化は問題として検出する', () => {
  const problems = checkRateSignals({ weightWeeklyPctChange: 1.5 });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].signal, 'bodyweight');
});

test('checkRateSignals: FFMが8週で0.5kg超低下すれば問題として検出する', () => {
  const problems = checkRateSignals({ ffmChangeKgOver8Weeks: -0.8 });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].signal, 'ffm');
});

test('checkRateSignals: 8週で0.5kg以内の低下は問題ではない', () => {
  const problems = checkRateSignals({ ffmChangeKgOver8Weeks: -0.3 });
  assert.deepEqual(problems, []);
});

test('checkRateSignals: 筋力が2週連続で低下すれば問題として検出する', () => {
  const problems = checkRateSignals({ strengthFallingWeeks: 2 });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].signal, 'strength');
});

test('checkRateSignals: EAが30未満・25未満で警告レベルが変わる', () => {
  assert.equal(checkRateSignals({ eaKcalPerKgFfm: 28 })[0].message.includes('警告域'), true);
  assert.equal(checkRateSignals({ eaKcalPerKgFfm: 20 })[0].message.includes('緊急域'), true);
  assert.deepEqual(checkRateSignals({ eaKcalPerKgFfm: 31 }), []);
});

test('checkRateSignals: null/未指定の入力は問題として扱わない', () => {
  assert.deepEqual(checkRateSignals({}), []);
  assert.deepEqual(checkRateSignals(), []);
});

// --- bodyFatGoalTension ---

test('bodyFatGoalTension: 健康的レンジ(14%以上)なら null', () => {
  assert.equal(bodyFatGoalTension({ targetBodyFatPct: 14, weightKg: 60 }), null);
  assert.equal(bodyFatGoalTension({ targetBodyFatPct: 18 }), null);
});

test('bodyFatGoalTension: 14%未満なら緊張関係を説明し、ブロックしない(値を返すだけ)', () => {
  const t = bodyFatGoalTension({ targetBodyFatPct: 10, weightKg: 60, exerciseKcal: 184 });
  assert.equal(t.belowHealthyRange, true);
  assert.ok(t.message.includes('14〜18%'));
  assert.ok(t.message.includes('ACE'));
  assert.ok(t.message.includes('ACSM'));
  assert.equal(t.targetFfmKg, 60 * 0.9);
  assert.ok(t.message.includes(`${Math.round(30 * (60 * 0.9) + 184)}kcal`));
});

test('bodyFatGoalTension: 12%未満は健康上の必然性が無い旨を明示する', () => {
  const t = bodyFatGoalTension({ targetBodyFatPct: 8, weightKg: 60, exerciseKcal: 0 });
  assert.ok(t.message.includes('健康上の必然性がなく'));
});

test('bodyFatGoalTension: 体重が不明でも一般的な説明は返す(算数は省く)', () => {
  const t = bodyFatGoalTension({ targetBodyFatPct: 10 });
  assert.equal(t.belowHealthyRange, true);
  assert.equal(t.targetFfmKg, null);
});

test('HEALTHY_BODYFAT_RANGE_LOW は14', () => {
  assert.equal(HEALTHY_BODYFAT_RANGE_LOW, 14);
});

// --- recentWeeklyWeightPctChange ---

test('recentWeeklyWeightPctChange: 週1%超の急な減少を検出できる', () => {
  const body = [
    { date: '2026-07-29', weight: 60.0 },
    { date: '2026-08-05', weight: 58.5 } // 7日で-2.5% → 週あたり-2.5%
  ];
  const pct = recentWeeklyWeightPctChange(body, '2026-08-05');
  assert.ok(pct < -1, `週1%超の低下として検出されるはず: ${pct}`);
});

test('recentWeeklyWeightPctChange: 通常のブレ(週0.3%程度)は問題域にならない', () => {
  const body = [
    { date: '2026-07-29', weight: 60.0 },
    { date: '2026-08-05', weight: 59.85 }
  ];
  const pct = recentWeeklyWeightPctChange(body, '2026-08-05');
  assert.ok(Math.abs(pct) < 1, `通常のブレの範囲のはず: ${pct}`);
});

test('recentWeeklyWeightPctChange: 記録が1件以下、または1週間前後の記録が無ければ null', () => {
  assert.equal(recentWeeklyWeightPctChange([{ date: '2026-08-05', weight: 60 }], '2026-08-05'), null);
  assert.equal(recentWeeklyWeightPctChange([
    { date: '2026-06-01', weight: 60 },
    { date: '2026-08-05', weight: 59 }
  ], '2026-08-05'), null);
});

// --- consecutiveFallingWeeks ---

test('consecutiveFallingWeeks: 2週連続で低下していれば2を返す', () => {
  assert.equal(consecutiveFallingWeeks([500, 520, 480, 460]), 2);
});

test('consecutiveFallingWeeks: 直近が前週以上なら0', () => {
  assert.equal(consecutiveFallingWeeks([500, 480, 520]), 0);
});

test('consecutiveFallingWeeks: 点が1件以下なら0', () => {
  assert.equal(consecutiveFallingWeeks([500]), 0);
  assert.equal(consecutiveFallingWeeks([]), 0);
});
