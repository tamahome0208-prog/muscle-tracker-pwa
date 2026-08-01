import { eaFloorKcal } from './energy.js';
import { alcoholGrams, DEFAULT_ALCOHOL_ABV_PCT } from './micronutrients.js';

/** 数値化できない値は0として扱い、NaN/文字列連結の伝播を防ぐ */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** item.fat / item.carb が「実際に記録された数値」かどうかを判定する（欠損=0 と混同しない） */
function hasNumericField(item, key) {
  const v = item[key];
  return v !== undefined && v !== null && Number.isFinite(Number(v));
}

/**
 * その日の kcal / タンパク質 / アルコール量 / 脂質 / 炭水化物 / 食物繊維 / ビタミンD /
 * カルシウム / 食塩相当量 を合計する。
 *
 * meals は OCR 経路や store.importAll(配列かどうかしか検証しない)から入る
 * 信頼できない境界のデータなので、壊れたレコード1件で集計全体が落ちないよう
 * 例外を投げず読み飛ばす。js/workout.js の weeklyVolume が不正な日付の記録を
 * 除外して継続するのと同じ設計判断。
 *
 * 【fat/carb/fibre/vitaminD/calcium/salt の「不明」と「0」の区別について】
 * data/foods.json の既存シード食品や、このアプリがこれまでに記録してきた食事には
 * そもそもこれらのフィールドが存在しない(js/main.js の foodsMacroSyncedV1/
 * foodsMicroSyncedV1 移行前のデータ、手入力を経ずに保存された古い記録等)。これを
 * toNum() で一律0として合計すると、「今日は脂質0g(=何も脂質を摂っていない実測値)」と
 * 「今日の記録には脂質のデータが1件も無い(=未計測)」の区別がつかなくなり、
 * ユーザーが「脂質0g」という嘘の実測値を見せられることになる(このユーザーは
 * カロリーを削りたい衝動があるため、意図せず「足りている」という誤った
 * 安心材料を与えかねない)。この設計はfat/carbで既に採用済みのもので、
 * 食物繊維・ビタミンD・カルシウム・食塩相当量の4項目にもそのまま適用する。
 * そのため各項目は「数値として記録されていた品目だけ」を合計し、1件でも
 * そのフィールドを持たない品目がその日にあれば対応する *Known を false にする
 * (=その日の合計は過小である可能性があり、真の0であることを示さない)。
 * その日に記録が1件も無い場合(hasItems=false)も、kcal:0 の扱いと同様「まだ何も
 * 記録していない」であって「摂取ゼロを実測した」わけではないため、
 * 各 *Known は false のままにする。
 *
 * 【純アルコール(alcoholG)・alcoholKcalについて】
 * alcoholMl(飲料の量, ml)はそのまま維持しつつ、js/micronutrients.js の
 * alcoholGrams() で純アルコール量(g)も合わせて計算する。度数(alcoholAbvPct)を
 * 品目が持たない場合はこのユーザーの実際の飲酒習慣(500ml・5%)に基づく既定値
 * (DEFAULT_ALCOHOL_ABV_PCT)にフォールバックする。alcoholMl自体が既存コードで
 * 「不明」を区別していない(欠損は既定で0扱い)のに合わせ、alcoholG/alcoholKcalも
 * 同様に *Known は持たない(常に計算できる派生値として扱う)。
 * alcoholKcalは「アルコール飲料として記録された品目のkcal」の合計(発泡酒のように
 * 炭水化物由来のkcalも含む、実際に記録された値)。js/mealTab.js が「純アルコールは
 * 1日のカロリー予算のうち最も手軽に取り戻せる分」という文脈を見せる際、
 * 220kcalのような固定値を決め打ちで表示せず、実際に記録された値から計算する
 * ためにここで用意する(このアプリの食品マスタのkcal自体が銘柄依存の概算であり、
 * 固定値を騙ると実際の記録とずれるため)。
 */
export function dayTotals(meals, dateStr) {
  const totals = {
    kcal: 0, protein: 0, alcoholMl: 0, alcoholG: 0, alcoholKcal: 0, fat: 0, carb: 0,
    fibre: 0, vitaminD: 0, calcium: 0, salt: 0,
    fatKnown: true, carbKnown: true, fibreKnown: true, vitaminDKnown: true, calciumKnown: true, saltKnown: true
  };
  let hasItems = false;
  for (const meal of meals) {
    if (!meal || typeof meal.datetime !== 'string') continue;
    if (!meal.datetime.startsWith(dateStr)) continue;
    if (!Array.isArray(meal.items)) continue;
    for (const item of meal.items) {
      if (!item) continue;
      hasItems = true;
      totals.kcal += toNum(item.kcal);
      totals.protein += toNum(item.protein);
      totals.alcoholMl += toNum(item.alcoholMl);
      totals.alcoholG += alcoholGrams(item.alcoholMl, item.alcoholAbvPct ?? DEFAULT_ALCOHOL_ABV_PCT);
      if (toNum(item.alcoholMl) > 0) totals.alcoholKcal += toNum(item.kcal);
      if (hasNumericField(item, 'fat')) totals.fat += Number(item.fat);
      else totals.fatKnown = false;
      if (hasNumericField(item, 'carb')) totals.carb += Number(item.carb);
      else totals.carbKnown = false;
      if (hasNumericField(item, 'fibre')) totals.fibre += Number(item.fibre);
      else totals.fibreKnown = false;
      if (hasNumericField(item, 'vitaminD')) totals.vitaminD += Number(item.vitaminD);
      else totals.vitaminDKnown = false;
      if (hasNumericField(item, 'calcium')) totals.calcium += Number(item.calcium);
      else totals.calciumKnown = false;
      if (hasNumericField(item, 'salt')) totals.salt += Number(item.salt);
      else totals.saltKnown = false;
    }
  }
  if (!hasItems) {
    totals.fatKnown = false;
    totals.carbKnown = false;
    totals.fibreKnown = false;
    totals.vitaminDKnown = false;
    totals.calciumKnown = false;
    totals.saltKnown = false;
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
 *
 * ffmKg(除脂肪量, kg)を渡すと、下限警告の基準を targets.kcalFloor の固定値ではなく
 * js/energy.js の eaFloorKcal(EA=エネルギー可用性フロア: 30 × FFM + 運動消費kcal、
 * ACSM/AND/DC 2016)に切り替える。ffmKg が無い/不正(InBody記録が無い端末)なら、
 * これまでどおり targets.kcalFloor を使う(後方互換: ffmKgを渡さない既存の呼び出しは
 * 挙動を変えない)。exerciseKcal は直近の運動消費(js/energy.js の dailyExerciseKcal)で、
 * 未指定なら0として扱う。
 */
export function achievement(totals, targets, { dayOver = false, ffmKg = null, exerciseKcal = 0 } = {}) {
  const kcal = toNum(totals?.kcal);
  const protein = toNum(totals?.protein);
  const alcoholMl = toNum(totals?.alcoholMl);

  const warnings = [];

  const eaFloor = eaFloorKcal(ffmKg, exerciseKcal);
  const floor = Number.isFinite(eaFloor) && eaFloor > 0 ? eaFloor : targets.kcalFloor;

  if (kcal > targets.kcalMax) {
    warnings.push({
      type: 'kcalOver',
      level: 'info',
      message: `目標を${Math.round(kcal - targets.kcalMax)}kcal超えています`
    });
  } else if (dayOver) {
    if (kcal > 0 && kcal < floor) {
      warnings.push({
        type: 'kcalFloor',
        level: 'danger',
        // EAベースの目安が使えるときは、その根拠となる数字も併記する(単なる「少なすぎます」
        // という言い切りより、どこから来た基準かを見せる方が誠実)。EA30は崖ではなく
        // 警告ラインなので、ここでも「下回ると即座に何かが壊れる」とは言わない。
        message: Number.isFinite(eaFloor) && eaFloor > 0
          ? `${Math.round(kcal)}kcal は少なすぎます(エネルギー可用性の目安 約${Math.round(floor)}kcal を下回っています)。この水準が続くと筋肉が分解されて目的と逆方向に進みます`
          : `${Math.round(kcal)}kcal は少なすぎます。この水準が続くと筋肉が分解されて目的と逆方向に進みます`
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
