import { calcVolume } from './workout.js';

export const PARTS = ['chest', 'back', 'shoulder', 'leg', 'arm', 'abs'];

export const PART_LABELS = {
  chest: '胸', back: '背中', shoulder: '肩', leg: '脚', arm: '腕', abs: '腹'
};

/**
 * 数値化できない値・負値は0として扱う（js/nutrition.js の toNum と同じ防御的丸め）。
 * XPは加算を繰り返しながら永続化されるため、1回だけ紛れ込んだ NaN や不正な型の値を
 * そのまま伝播させると、以降の加算・レベル計算が恒久的に壊れる
 * （JSON.stringify(NaN) は null になり localStorage 上でも消えない）。
 */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** レベルは固定式。バランス調整に時間を溶かさないため意図的に単純化している */
export function levelFromXp(xp) {
  return Math.floor(Math.sqrt(toNum(xp) / 100));
}

/**
 * 部位XPに1回分のトレーニングを加算した新しいオブジェクトを返す。
 * 加算前の既存値も toNum で防御的に丸める: xpMap に既に NaN や文字列が
 * 紛れ込んでいた場合、`(next[part] ?? 0)` のような null/undefined のみを
 * 見るガードだと NaN はそのまま伝播し、文字列は `+` で連結されてしまう
 * （例: 'oops' + 35 === 'oops35'）。ここで0に丸めることで、過去に紛れ込んだ
 * 壊れた値からも次回の加算で回復できるようにしている。
 */
export function addWorkoutXp(xpMap, workout, exercises) {
  const partOf = new Map(exercises.map((e) => [e.id, e.part]));
  const next = { ...xpMap };
  for (const set of workout.sets ?? []) {
    const part = partOf.get(set.exId);
    if (!part || !PARTS.includes(part)) continue;
    next[part] = toNum(next[part]) + calcVolume([set]) / 10;
  }
  return next;
}

/** レーダーチャート用のデータ */
export function radarData(xpMap) {
  return PARTS.map((part) => ({
    part,
    label: PART_LABELS[part],
    xp: toNum(xpMap?.[part]),
    level: levelFromXp(xpMap?.[part])
  }));
}
