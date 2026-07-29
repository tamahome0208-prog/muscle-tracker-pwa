export const PROGRAMS = ['A', 'B', 'C'];

/** 日付文字列 'YYYY-MM-DD' の週キー（月曜始まり）を返す。例: '2026-W31' */
export function weekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // 月=0
  d.setUTCDate(d.getUTCDate() - day + 3); // その週の木曜
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function sortedByDate(workouts) {
  return [...workouts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 曜日ではなく順送りで次のプログラムを決める */
export function nextProgram(workouts) {
  const sorted = sortedByDate(workouts);
  const last = sorted[sorted.length - 1];
  if (!last) return 'A';
  const index = PROGRAMS.indexOf(last.program);
  if (index === -1) return 'A';
  return PROGRAMS[(index + 1) % PROGRAMS.length];
}

/** 総挙上量 = Σ(重量 × 回数)。補助重量（負値）と自重（0）は0として扱う */
export function calcVolume(sets) {
  return sets.reduce((sum, s) => sum + Math.max(0, s.weight) * s.reps, 0);
}

/** 週ごとの総挙上量。週キーの昇順で返す */
export function weeklyVolume(workouts) {
  const map = new Map();
  for (const w of workouts) {
    const key = weekKey(w.date);
    const volume = w.volume ?? calcVolume(w.sets ?? []);
    map.set(key, (map.get(key) ?? 0) + volume);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, volume]) => ({ week, volume }));
}

/** その種目の直近の重量・回数。無ければ null */
export function lastSetsFor(workouts, exId) {
  const sorted = sortedByDate(workouts).reverse();
  for (const w of sorted) {
    const hit = (w.sets ?? []).filter((s) => s.exId === exId).pop();
    if (hit) return { weight: hit.weight, reps: hit.reps };
  }
  return null;
}
