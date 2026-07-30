import { calcVolume, weekKey, distinctDatesPerWeek } from './workout.js';

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
 *
 * bodyweight は省略可能（js/workout.js の calcVolume と同じ設計）。省略時は
 * 従来どおり calcVolume([set]) が体重を加味しない値を返すため、既存の
 * 呼び出し側・テストの挙動は変えない。渡すとアシスト/自重種目にも体重を
 * 加味した実効挙上量からXPが計算され、leg/abs/back 等が0のまま止まらなくなる。
 */
export function addWorkoutXp(xpMap, workout, exercises, bodyweight) {
  const partOf = new Map(exercises.map((e) => [e.id, e.part]));
  const next = { ...xpMap };
  const context = bodyweight === undefined ? undefined : { exercises, bodyweight };
  for (const set of workout.sets ?? []) {
    const part = partOf.get(set.exId);
    if (!part || !PARTS.includes(part)) continue;
    next[part] = toNum(next[part]) + calcVolume([set], context) / 10;
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
 * 連続週数。判定条件は「週3回ジムへ行った日数」。
 * 食事や写真を条件に足すと切れやすくなり、ストリークの意味が失われるため意図的に含めない。
 * 進行中の今週はまだ未達でも切らない（達成していればカウントする）。
 * 同じ日に複数回の記録があっても、ジムへ行った回数は1回として数える
 * （js/workout.js の distinctDatesPerWeek を参照。同日複数記録での水増しを防ぐ）。
 * workouts に null 要素（壊れたレコード）が混ざっていても distinctDatesPerWeek 側で
 * 例外を投げずに読み飛ばす。
 */
export function calcStreak(workouts, todayStr) {
  const dateMap = distinctDatesPerWeek(workouts);
  const counts = new Map();
  for (const [week, dates] of dateMap) counts.set(week, dates.size);
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
 * gymCount は実施日数（同じ日の複数記録は1回として数える。calcStreak・weekFeasibility
 * と同じ数え方。js/workout.js の distinctDatesPerWeek を参照）。
 */
export function initialPhaseStatus(workouts, meals, todayStr) {
  const thisWeek = weekKey(todayStr);
  const gymCount = distinctDatesPerWeek(workouts).get(thisWeek)?.size ?? 0;

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

/** 称号。到達点は会話で確認した現実的なラインに対応させている */
export const BADGES = [
  { id: 'first_workout', name: '初心者ボーナス期', desc: '初めてジムで記録をつけた' },
  { id: 'habit_4w',      name: '習慣化',           desc: '週3ジムを4週連続で達成した' },
  { id: 'shoulder_lv3',  name: '肩と胸に丸みが出た', desc: '胸と肩のレベルが3に到達した' },
  { id: 'abs_visible',   name: '腹筋上部が割れた',   desc: '体脂肪率が開始時から3%下がった' },
  { id: 'muscle_plus2',  name: '中身が変わった',     desc: '筋肉量が開始時から2kg増えた' },
  { id: 'photo_compare', name: '定点観測',         desc: '写真の比較ビューを開いた' },
  { id: 'volume_10t',    name: '10トン挙げた',      desc: '総挙上量の累計が10,000kgを超えた' }
];

/**
 * 未獲得のうち、条件を満たした称号IDを返す。
 * state: { workouts, body, streak, xp, comparedPhotos, badges }
 *
 * body / workouts は storage / importAll を経由して届く未検証データのため
 * （このファイルの他の集計関数と同じ方針で）不正なレコードは無視し、例外は投げない。
 * fatPct・muscle・volume は toNum で防御的に丸める: NaN や欠損値のまま差分を
 * 取ると `NaN >= 3` は常に false になるため実害は薄いが、文字列が紛れ込むと
 * `'20' - '17'` のように意図せず動く/動かないケースがあり、丸めて統一しておく方が安全。
 * body の日付は文字列比較でソートするため、不正な形式の日付が混ざると並び順が
 * 保証できない。ここでは date が YYYY-MM-DD 形式のレコードだけを対象にする。
 * badges は game オブジェクト内のネストしたフィールドであり、store.js の
 * deepMerge は配列型のトップレベルキー(workouts/body等)しか配列性を検証しない
 * ため、ネストした badges が不正なJSON編集等で配列以外(文字列・数値等)に
 * 壊れていてもそのまま届き得る。Array.isArray で確認し、そうでなければ
 * 「何も所持していない」として扱う（Set(非配列) は例外を投げるため）。
 */
export function checkBadges(state) {
  const owned = new Set(Array.isArray(state.badges) ? state.badges : []);
  const earned = [];
  const add = (id, condition) => {
    if (condition && !owned.has(id)) earned.push(id);
  };

  add('first_workout', (state.workouts ?? []).length >= 1);
  add('habit_4w', (state.streak ?? 0) >= 4);
  add('shoulder_lv3', levelFromXp(state.xp?.chest ?? 0) >= 3 && levelFromXp(state.xp?.shoulder ?? 0) >= 3);
  add('photo_compare', state.comparedPhotos === true);

  const body = (state.body ?? [])
    .filter((b) => typeof b?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (body.length >= 2) {
    const first = body[0];
    const last = body[body.length - 1];
    add('abs_visible', toNum(first.fatPct) - toNum(last.fatPct) >= 3);
    add('muscle_plus2', toNum(last.muscle) - toNum(first.muscle) >= 2);
  }

  const totalVolume = (state.workouts ?? []).reduce((sum, w) => sum + toNum(w?.volume), 0);
  add('volume_10t', totalVolume >= 10000);

  return earned;
}
