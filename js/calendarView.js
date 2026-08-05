// 記録タブのカレンダー（js/recordTab.js）向けの純粋ロジック。DOM・store.js に依存しないので
// 単体テストしやすい（週の切り方・週次カウントは js/recordTab.js に直書きせずここに置く）。
//
// 週の数え方は js/workout.js の distinctDatesPerWeek をそのまま使う。weekFeasibility・
// game.js の calcStreak も同じ関数を土台にしており、「同じ日に複数回の記録があってもジムへ
// 行った回数は1回として数える」というルールを三重に別実装しない（1つのバグを3箇所で
// 別々に踏まないための共通化、という workout.js 自身のコメントと同じ考え方）。
import { isValidDateStr, weekKey, distinctDatesPerWeek, PROGRAMS } from './workout.js';

export const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日'];

// 週次の目標回数。game.js の GYM_PER_WEEK、workout.js の weekFeasibility の既定 perWeek と
// 同じ値（週3回）。3箇所に同じ定数が独立して存在する形になるが、カウントの「数え方」自体は
// distinctDatesPerWeek に一本化されているため、値がずれても表示上の分母がずれるだけで
// カウント自体の集計ロジックが割れることはない。将来この目標値を変える場合は3箇所とも
// 合わせて直すこと。
export const GYM_TARGET_PER_WEEK = 3;

function toDateUTC(dateStr) {
  return new Date(dateStr + 'T00:00:00Z');
}

function addDaysUTC(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toKey(date) {
  return date.toISOString().slice(0, 10);
}

/** workouts から「日付 → その日に出てきた program の集合」を作る。未知/欠損の program は null に丸める */
function groupProgramsByDate(workouts) {
  const map = new Map();
  for (const w of workouts ?? []) {
    if (!isValidDateStr(w?.date)) continue;
    const program = PROGRAMS.includes(w?.program) ? w.program : null;
    if (!map.has(w.date)) map.set(w.date, new Set());
    map.get(w.date).add(program);
  }
  return map;
}

/**
 * その日付の「ジムの印」を1つ返す。
 *  - 記録が無ければ null
 *  - 記録があり program が一意に A/B/C のいずれかへ決まれば、その文字
 *  - 記録はあるが program が不正/欠損、または同日に異なる program が複数混ざっている
 *    場合は 'unknown'（行ったこと自体は伝えるが、どの種目かを嘘で決め打ちしない）
 * 同じ program の記録が同日に複数あっても（チップの誤操作等）1件の集合要素にしかならず、
 * distinctDatesPerWeek と同じ「日付単位」の粒度になる。
 */
function gymMarkForDate(programsByDate, date) {
  const programs = programsByDate.get(date);
  if (!programs || programs.size === 0) return null;
  if (programs.size > 1) return 'unknown';
  const [only] = programs;
  return only ?? 'unknown';
}

/**
 * カレンダーに表示する週の並びを組み立てる。
 *
 * 引数:
 *  - workouts / badminton: store.js から取り出した生の配列（信頼できない外部データ。
 *    importAll 由来の null 要素・日付欠損を含みうるため、isValidDateStr で弾く）
 *  - photoDates: 'YYYY-MM-DD' の Set（js/photos.js の listPhotos() の結果から
 *    呼び出し側が作る。IndexedDBへの問い合わせは非同期なため、このモジュール自体は
 *    問い合わせない。省略時は空集合＝写真の印を一切出さない）
 *  - todayStr: 'YYYY-MM-DD'（アプリ内部の信頼できる値）
 *  - weeks: 何週間分を遡って表示するか（既定8週＝直近2ヶ月弱）
 *
 * 戻り値: { weeks: [{ weekKey, gymCount, days: [...] }] }（週は昇順＝古い週が先頭）
 * 各 day は { date, dayOfMonth, month, year, isFirstOfMonth, isToday, isFuture,
 *   program, hasBadminton, hasPhoto } を持つ。
 *
 * 最終週は「今週」（月曜〜日曜）で、today より後の日は isFuture:true とし、
 * program/hasBadminton/hasPhoto は必ず null/false になる（未来日には記録が存在しようがない）。
 */
export function buildCalendarWeeks({ workouts, badminton, photoDates, todayStr, weeks = 8 }) {
  const programsByDate = groupProgramsByDate(workouts);
  const badDates = new Set((badminton ?? []).map((b) => b?.date).filter((d) => isValidDateStr(d)));
  const photos = photoDates ?? new Set();
  const gymCounts = distinctDatesPerWeek(workouts); // weekKey -> Set<date>（唯一のカウント方法）

  const today = toDateUTC(todayStr);
  const todayDow = (today.getUTCDay() + 6) % 7; // 月=0 ... 日=6
  const thisMonday = addDaysUTC(today, -todayDow);
  const startMonday = addDaysUTC(thisMonday, -(weeks - 1) * 7);

  const weekRows = [];
  let cursor = startMonday;
  for (let w = 0; w < weeks; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = toKey(cursor);
      const isFuture = date > todayStr;
      days.push({
        date,
        dayOfMonth: cursor.getUTCDate(),
        month: cursor.getUTCMonth() + 1,
        year: cursor.getUTCFullYear(),
        isFirstOfMonth: cursor.getUTCDate() === 1,
        isToday: date === todayStr,
        isFuture,
        program: isFuture ? null : gymMarkForDate(programsByDate, date),
        hasBadminton: !isFuture && badDates.has(date),
        hasPhoto: !isFuture && photos.has(date)
      });
      cursor = addDaysUTC(cursor, 1);
    }
    const wk = weekKey(days[0].date);
    weekRows.push({ weekKey: wk, gymCount: gymCounts.get(wk)?.size ?? 0, days });
  }
  return { weeks: weekRows };
}
