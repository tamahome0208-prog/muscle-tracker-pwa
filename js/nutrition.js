/** 数値化できない値は0として扱い、NaN/文字列連結の伝播を防ぐ */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** その日の kcal / タンパク質 / アルコール量を合計する */
export function dayTotals(meals, dateStr) {
  const totals = { kcal: 0, protein: 0, alcoholMl: 0 };
  for (const meal of meals) {
    if (!meal.datetime.startsWith(dateStr)) continue;
    for (const item of meal.items ?? []) {
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
 */
export function achievement(totals, targets) {
  const warnings = [];

  if (totals.kcal > 0 && totals.kcal < targets.kcalFloor) {
    warnings.push({
      type: 'kcalFloor',
      level: 'danger',
      message: `${Math.round(totals.kcal)}kcal は少なすぎます。この水準が続くと筋肉が分解されて目的と逆方向に進みます`
    });
  } else if (totals.kcal > targets.kcalMax) {
    warnings.push({
      type: 'kcalOver',
      level: 'info',
      message: `目標を${Math.round(totals.kcal - targets.kcalMax)}kcal超えています`
    });
  }

  if (totals.protein > 0 && totals.protein < targets.protein) {
    warnings.push({
      type: 'proteinShort',
      level: 'warn',
      message: `タンパク質があと${Math.round(targets.protein - totals.protein)}g足りません`
    });
  }

  return {
    proteinPct: Math.round((totals.protein / targets.protein) * 100),
    kcalPct: Math.min(100, Math.round((totals.kcal / targets.kcalMin) * 100)),
    alcoholOver: totals.alcoholMl > targets.alcoholMl,
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
