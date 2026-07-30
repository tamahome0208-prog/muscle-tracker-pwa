/** 数値化できない値は0として扱い、NaN/文字列連結の伝播を防ぐ */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * その日の kcal / タンパク質 / アルコール量を合計する。
 *
 * meals は OCR 経路や store.importAll(配列かどうかしか検証しない)から入る
 * 信頼できない境界のデータなので、壊れたレコード1件で集計全体が落ちないよう
 * 例外を投げず読み飛ばす。js/workout.js の weeklyVolume が不正な日付の記録を
 * 除外して継続するのと同じ設計判断。
 */
export function dayTotals(meals, dateStr) {
  const totals = { kcal: 0, protein: 0, alcoholMl: 0 };
  for (const meal of meals) {
    if (!meal || typeof meal.datetime !== 'string') continue;
    if (!meal.datetime.startsWith(dateStr)) continue;
    if (!Array.isArray(meal.items)) continue;
    for (const item of meal.items) {
      if (!item) continue;
      totals.kcal += toNum(item.kcal);
      totals.protein += toNum(item.protein);
      totals.alcoholMl += toNum(item.alcoholMl);
    }
  }
  return totals;
}

/**
 * 達成率と警告を返す。
 * 設計方針: 上限超過より「下限割れ」を重く扱う。摂取を削るほど目的から遠ざかるため。
 * kcal:0(まだ何も記録していない日)は「食べなさすぎ」danger警告の対象にしない。
 *
 * dayOver: その日の食事がほぼ終わっているとみなせるかどうか(呼び出し側が判定して渡す。
 * 例: 表示している日付が今日より前、または今日で現地時刻が20時以降)。
 * 「食べなさすぎ」danger警告は、まだ食事の途中である日中に出し続けると
 * 一日の大半で表示され続ける壁紙と化し、1,000kcal台への逆戻りを止めるという
 * 本来の目的を果たせなくなる。そのため dayOver でない間はdanger警告を出さず、
 * 代わりに残量を info レベルで淡々と示す。上限超過(info)側は非対称に元々弱い
 * 警告なので、dayOver に関わらず出してよい。
 *
 * 時計を直接読まず引数で受け取るのは、このモジュールを純粋関数のまま
 * テスト可能に保つため(呼び出し側の js/mealTab.js が現在時刻から判定する)。
 *
 * totals は dayTotals を経由しない呼び出しにも備え、dayTotals と同じ toNum で
 * 防御的に丸める(achievement は単体でもエクスポートされているため)。
 * targets の分母(protein / kcalMin)が0または非有限の場合、割り算が
 * Infinity/NaN になり JSON.stringify で null に化ける(store.js で潰したのと
 * 同じ失敗モード)。ここではバーが伸びないだけで済むよう達成率を0%として扱う。
 */
export function achievement(totals, targets, { dayOver = false } = {}) {
  const kcal = toNum(totals?.kcal);
  const protein = toNum(totals?.protein);
  const alcoholMl = toNum(totals?.alcoholMl);

  const warnings = [];

  if (kcal > targets.kcalMax) {
    warnings.push({
      type: 'kcalOver',
      level: 'info',
      message: `目標を${Math.round(kcal - targets.kcalMax)}kcal超えています`
    });
  } else if (dayOver) {
    if (kcal > 0 && kcal < targets.kcalFloor) {
      warnings.push({
        type: 'kcalFloor',
        level: 'danger',
        message: `${Math.round(kcal)}kcal は少なすぎます。この水準が続くと筋肉が分解されて目的と逆方向に進みます`
      });
    }
  } else {
    warnings.push({
      type: 'kcalRemaining',
      level: 'info',
      message: `残り ${Math.round(targets.kcalMin - kcal)}kcal`
    });
  }

  if (protein > 0 && protein < targets.protein) {
    warnings.push({
      type: 'proteinShort',
      level: 'warn',
      message: `タンパク質があと${Math.round(targets.protein - protein)}g足りません`
    });
  }

  const proteinTarget = targets.protein;
  const kcalMinTarget = targets.kcalMin;

  return {
    proteinPct: Number.isFinite(proteinTarget) && proteinTarget > 0
      ? Math.round((protein / proteinTarget) * 100)
      : 0,
    kcalPct: Number.isFinite(kcalMinTarget) && kcalMinTarget > 0
      ? Math.min(100, Math.round((kcal / kcalMinTarget) * 100))
      : 0,
    alcoholOver: alcoholMl > targets.alcoholMl,
    warnings
  };
}

/** 使用回数の多い順。同数なら名前順で安定させる */
export function sortFoodsByUse(foods) {
  return [...foods].sort((a, b) => {
    const diff = (b.useCount ?? 0) - (a.useCount ?? 0);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, 'ja');
  });
}

/** 使用回数を1増やした新しい配列を返す（元は変更しない） */
export function bumpFoodUse(foods, foodId) {
  return foods.map((f) => (f.id === foodId ? { ...f, useCount: (f.useCount ?? 0) + 1 } : f));
}
