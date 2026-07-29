import { calcVolume, weekKey } from './workout.js';

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

const GYM_PER_WEEK = 3;

function shiftWeeks(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta * 7);
  return d.toISOString().slice(0, 10);
}

/**
 * 連続週数。判定条件はジム3回のみ。
 * 食事や写真を条件に足すと切れやすくなり、ストリークの意味が失われるため意図的に含めない。
 * 進行中の今週はまだ未達でも切らない（達成していればカウントする）。
 */
export function calcStreak(workouts, todayStr) {
  const counts = new Map();
  for (const w of workouts) {
    if (typeof w.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) continue;
    const key = weekKey(w.date);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const thisWeek = weekKey(todayStr);
  let streak = 0;
  let cursor = todayStr;
  let first = true;
  while (true) {
    const key = weekKey(cursor);
    const count = counts.get(key) ?? 0;
    if (count >= GYM_PER_WEEK) {
      streak += 1;
    } else if (first && key === thisWeek) {
      // 進行中の週は未達でも遡り続ける
    } else {
      break;
    }
    first = false;
    cursor = shiftWeeks(cursor, -1);
  }
  return streak;
}

/** 開始から28日未満なら初期モード */
export function isInitialPhase(startDate, todayStr) {
  if (!startDate) return false;
  const days = (new Date(todayStr + 'T00:00:00Z') - new Date(startDate + 'T00:00:00Z')) / 86400000;
  return days < 28;
}

/**
 * 初期4週間で追跡する2項目だけを返す。
 * 「まず週3ジムと朝プロテインだけ習慣化できれば、あとは自動的に進む」という方針に対応。
 */
export function initialPhaseStatus(workouts, meals, todayStr) {
  const thisWeek = weekKey(todayStr);
  const gymCount = (workouts ?? []).filter((w) => {
    if (typeof w.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(w.date)) return false;
    return weekKey(w.date) === thisWeek;
  }).length;

  const proteinMornings = new Set();
  for (const meal of meals ?? []) {
    if (typeof meal?.datetime !== 'string') continue;
    const [date, time = ''] = meal.datetime.split('T');
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (weekKey(date) !== thisWeek) continue;
    const hour = Number(time.slice(0, 2));
    if (Number.isNaN(hour) || hour >= 11) continue;
    const hasProtein = (meal.items ?? []).some((i) => typeof i?.name === 'string' && i.name.includes('プロテイン'));
    if (hasProtein) proteinMornings.add(date);
  }

  return { gymCount, gymDone: gymCount >= GYM_PER_WEEK, proteinMornings: proteinMornings.size };
}
