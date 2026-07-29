const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 数値化できない値は0として扱い、NaN/文字列連結の伝播を防ぐ（js/nutrition.js, js/game.js の toNum と同じ） */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * body は storage / store.importAll(配列かどうかしか検証しない) を経由して届く
 * 未検証データの境界であり、壊れたレコード1件で計算全体を落とさないよう例外を
 * 投げず読み飛ばす（js/nutrition.js の dayTotals, js/workout.js の weeklyVolume,
 * js/game.js の checkBadges と同じ設計判断）。null要素と、date が文字列で
 * YYYY-MM-DD 形式でないレコードを除外する: 後続のソートは日付を文字列比較する
 * ため、date が undefined 等だと比較が常に false になり並び順が保証できない。
 */
function sorted(body) {
  return (body ?? [])
    .filter((b) => b && typeof b.date === 'string' && DATE_RE.test(b.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function latestBody(body) {
  const s = sorted(body);
  return s.length ? s[s.length - 1] : null;
}

/** 基準日以降の最初の記録と最新記録の差分。sinceを省略すると全期間 */
export function bodyDiff(body, since = null) {
  const s = sorted(body).filter((b) => (since ? b.date >= since : true));
  if (s.length === 0) return { weight: 0, muscle: 0, fatPct: 0 };
  const first = s[0];
  const last = s[s.length - 1];
  return {
    weight: toNum(last.weight) - toNum(first.weight),
    muscle: toNum(last.muscle) - toNum(first.muscle),
    fatPct: toNum(last.fatPct) - toNum(first.fatPct)
  };
}

/** 体重・筋肉量・体脂肪率を3本重ねて描くためのデータ */
export function bodySeries(body) {
  const s = sorted(body);
  return {
    labels: s.map((b) => b.date),
    weight: s.map((b) => toNum(b.weight)),
    muscle: s.map((b) => toNum(b.muscle)),
    fatPct: s.map((b) => toNum(b.fatPct))
  };
}
