import test from 'node:test';
import assert from 'node:assert/strict';
import { dayTotals, achievement, sortFoodsByUse, bumpFoodUse } from '../js/nutrition.js';

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

test('記録が無い日は0になる', () => {
  assert.deepEqual(dayTotals(MEALS, '2026-01-01'), { kcal: 0, protein: 0, alcoholMl: 0 });
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
  assert.deepEqual(t, { kcal: 0, protein: 0, alcoholMl: 0 });
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
  assert.deepEqual(dayTotals(meals, '2026-07-29'), { kcal: 100, protein: 10, alcoholMl: 0 });
});

test('targetsの分母が0または非有限なら達成率は0%として扱う（Infinity/NaNを出さない）', () => {
  const a1 = achievement({ kcal: 1750, protein: 100, alcoholMl: 0 }, { ...TARGETS, protein: 0 });
  assert.equal(a1.proteinPct, 0);

  const a2 = achievement({ kcal: 1750, protein: 100, alcoholMl: 0 }, { ...TARGETS, kcalMin: 0 });
  assert.equal(a2.kcalPct, 0);
});
