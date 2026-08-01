// エネルギー可用性(EA: Energy Availability)関連の純粋関数群。
//
// このモジュールが存在する理由: js/store.js に固定値で入っていた kcalFloor: 1500 には
// 追跡可能な一次情報源が無かった(「男性は1500kcalを下回るべきでない」という言説は出典を
// 辿れず、英国栄養士会(BDA)の減量ガイダンス自体はカロリーの下限を一切定めていない)。
// 一方でACSM/AND/DCの共同ポジションスタンドはEA(エネルギー可用性)について具体的な数値を
// 示しており、こちらを根拠にする方が原則がある。
//
// EA        = (摂取kcal − 運動消費kcal) / 除脂肪量(FFM, kg)
// floor     = 30 × FFM + 運動消費kcal
// optimal   = 45 × FFM + 運動消費kcal
//
// 出典(EA 30/45の閾値): Mountjoy M, et al. "RED-S" 関連のACSM/AND/DC合同ポジションスタンド
// (Med Sci Sports Exerc. 2016;48(3):543-568)より原文:
// "an EA of 45 kcal/kg FFM/d was found to be associated with energy balance and optimal
//  health; meanwhile, a chronic reduction in EA, (particularly below 30 kcal/kg FFM/d) was
//  associated with impairments of a variety of body functions."
//
// 正直に書いておくべきこと(過信させないための注記): 30 kcal/kg FFM/d という閾値は女性の
// データから導かれたものであり、男性についてはより低く・より不確実な値しか根拠が無い
// (Koehler et al. 2016, Med Sci Sports Exerc 48(5):947-954 は4日間 15 kcal/kg FFM/d でも
// テストステロンの有意な変化を認めなかった。男性で害が観測された報告はおよそ9〜25の範囲に
// 散らばっている)。2023年のIOC合意声明もRED-Sを単一の閾値ではなく連続体として扱う方向に
// 移っている。このアプリが30を警告ラインとして採用するのは「保守的」かつ「出典を明示できる」
// からであって、「これを下回った瞬間に何かが壊れる崖」という意味ではない。このモジュールを
// 呼び出す側(js/nutrition.js, js/settingsTab.js, js/recordTab.js)の文言は、この点を
// 誇張しないこと。
//
// エネルギー消費/RMR式の出典は各関数のコメントに個別に記す。

const KCAL_PER_KJ = 4.184;

/** ffmKg等、数値化できない/0以下の入力を弾く共通ガード。無効なら null を返す。 */
function positiveOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Cunningham 1991: RMR(基礎代謝) = 370 + 21.6 × FFM(kg)。
 * 出典: Cunningham JJ. "Body composition as a determinant of energy expenditure in the obese."
 *       (除脂肪量から直接RMRを求める式。InBody等でFFMが既知の場合はこちらを優先する)
 *
 * 162cm/60kg/男性、FFM 48kgの場合: 370 + 21.6×48 = 1,406.8 ≈ 1,407 kcal。
 */
export function rmrCunningham(ffmKg) {
  const ffm = positiveOrNull(ffmKg);
  return ffm === null ? 0 : 370 + 21.6 * ffm;
}

/**
 * ten Haaf & Weijs 2014 (PLOS ONE 9(10):e108460)。FFMが不明なとき(InBody未計測)の
 * フォールバック式。アスリート集団でMifflin-St Jeorより高精度
 * (O'Neill et al. 2023: 実測値の±10%以内に収まった割合が80.2% vs 他式40.7〜63.7%)。
 *
 * ⚠️ 必ずkJ単位で計算してからkcalに変換すること。ネット上に出回る「kcal版」の式
 *    (係数をそのままkcal単位の式として使うもの)は通常の身長・体重・年齢の入力で
 *    負の値を返す誤った式であり、絶対に使わない。この注意書きごと削除しないこと。
 *
 * REE_kJ = 49.940×W(kg) + 2459.053×H(m) − 34.014×A(歳) + 799.257×S(男性1/女性0) + 122.502
 * REE_kcal = REE_kJ / 4.184
 *
 * 162cm/60kg/35歳/男性の場合: REE_kJ ≈ 6,711.3 → 6,711.3/4.184 ≈ 1,604 kcal。
 */
export function rmrTenHaaf({ weightKg, heightM, ageYears, isMale }) {
  const w = Number(weightKg);
  const h = Number(heightM);
  const a = Number(ageYears);
  if (![w, h, a].every(Number.isFinite) || w <= 0 || h <= 0 || a <= 0) return 0;
  const s = isMale ? 1 : 0;
  const kJ = 49.940 * w + 2459.053 * h - 34.014 * a + 799.257 * s + 122.502;
  return kJ / KCAL_PER_KJ;
}

// InBody記録が無いときにFFMを概算するための仮の体脂肪率。
// 出典: このユーザー属性(162cm/60kg/初心者男性)における一般的な体脂肪率のレンジの
// 目安であり、実測ではない(js/store.jsのDEFAULT_KCAL_FLOORが仮定しているFFM48kg
// = 60kg×(1-20%)と揃えてある)。
//
// 【回帰修正の経緯】以前はInBody記録が無いと ffmKg が null になり、js/nutrition.js の
// achievement() は EA(エネルギー可用性)経路を完全に諦めて固定の targets.kcalFloor に
// フォールバックしていた。これは「体組成を測っていない=運動もしていない扱い」を意味し、
// 実際にトレーニングしているのに運動消費の項が丸ごと落ちる(floor = 30×FFM+運動消費 の
// +運動消費が0になる)という安全側と逆方向の回帰だった。このユーザーは今まさにInBody
// 未測定の状態なので、この経路は現実に起こる。
const ASSUMED_BODYFAT_PCT_NO_INBODY = 20;

/**
 * FFM(除脂肪量)を返す。InBody記録(weight, fatPct)が有効ならそこから実測ベースで計算し、
 * `estimated: false` を返す。無効/欠損なら fallbackWeightKg(通常は profile.weight)と
 * ASSUMED_BODYFAT_PCT_NO_INBODY から概算し、`estimated: true` を返す(呼び出し側は
 * この違いを画面上でも表現し、実測と同じ確度で見せないこと)。
 * どちらも得られなければ null(EA関連の計算をスキップすること)。
 */
export function estimateFfmKg(bodyRecord, fallbackWeightKg = null) {
  const weight = positiveOrNull(bodyRecord?.weight);
  const fatPct = Number(bodyRecord?.fatPct);
  if (weight !== null && Number.isFinite(fatPct) && fatPct >= 0 && fatPct < 100) {
    return { ffmKg: weight * (1 - fatPct / 100), estimated: false };
  }
  const fallbackWeight = positiveOrNull(fallbackWeightKg);
  if (fallbackWeight === null) return null;
  return { ffmKg: fallbackWeight * (1 - ASSUMED_BODYFAT_PCT_NO_INBODY / 100), estimated: true };
}

// 2024 Adult Compendium of Physical Activities のMETs値。
// 出典: Herrmann SD, et al. "2024 Adult Compendium of Physical Activities." J Sport Health Sci.
// - バドミントン(社会人・シングルス/ダブルス): 5.5 METs
// - レジスタンストレーニング(8〜15回、軽〜中等度の負荷): 3.5 METs
// - スクワット/デッドリフトのような高強度の複合種目(vigorous effort): 5.0 METs
//
// 【意図的に不確実性を上側へ倒している箇所】レジスタンストレーニングのMETは
// Compendiumの「3.5(軽〜中等度)」ではなく「5.0(高強度)」を使う。本アプリの種目は
// マシン系でスクワット/デッドリフトそのものではないが、このアプリの指示は1〜3RIR
// (限界の1〜3回手前)であり、Compendiumの「8〜15回・軽〜中等度」よりも
// vigorous effort側の実態に近いと判断した。
// なぜ高い方に倒すか: floor = 30×FFM + 運動消費 なので、運動消費を過小に見積もると
// floorが下がり「食べなさすぎ」警告が出にくくなる。同時に EA=(摂取-運動)/FFM も
// 過大に(=実際より安全に)出る。つまりこの不確実性は、低く見積もる側に倒すと
// 安全性チェックが緩む方向にずれる。逆に高く見積もった場合の実害は「floorが本来より
// 少し高く出て、まだ十分食べられているのに警告が出る」程度であり、この非対称性から
// 高い方の値を採用する。
//
// 「正味(net)METs」を使う理由: 1 MET(安静時代謝)は既にRMRの計算に含まれているため、
// 運動によって「追加で」消費した分だけをEAの計算に載せる必要がある。そのままのMETsを
// 使うと安静時代謝を二重に数えてしまう(RMR側とexercise側の両方に安静分が乗る)。
const MET = {
  badminton: 5.5,
  resistance: 5.0 // 上記コメント参照: 3.5(Compendium「軽〜中等度」)ではなく意図的に5.0を使う
};
const NET_MET = {
  badminton: MET.badminton - 1,
  resistance: MET.resistance - 1
};

// レジスタンストレーニングの実測消費は休憩を含めて概ね6 kcal/分程度という報告がある。
// このモジュールでは体重に応じて個別化できるMETベースの式(上記NET_MET.resistance)を
// 一貫して使う。162cm/60kgのこのユーザーでは、上のMET=5.0(正味4.0)換算で
// 4.0×3.5×60/200=4.2 kcal/分となり、6 kcal/分という(主に体格の大きい被験者での
// 測定値と見られる)数字とオーダーとしては近い水準になった。6 kcal/分をそのまま
// 一律に採用しない理由は、体格による個人差を無視することになるため。
// EPOC(運動後過剰酸素消費)は14〜27kcal程度と僅かなため、"追い焚き"のボーナスは
// 足さない(この点はMETベースの式にも共通する注記)。

/** METs(正味)と体重から kcal/分 を求める標準式: kcal/分 = MET × 3.5 × 体重(kg) / 200 */
function kcalPerMinute(netMet, weightKg) {
  return netMet * 3.5 * weightKg / 200;
}

// 筋トレ1セットあたりの所要時間(セット遂行+セット間休憩)の仮定値。
// このアプリはワークアウトの実施時間(分)を記録していない(セット数・重量・回数のみ)ため、
// 「休憩を含めた1セットあたり約2.5分」という仮定でセット数から所要時間を概算する。
// 根拠: 筋肥大目的のレジスタンストレーニングで一般的に推奨される休憩は60〜120秒程度
// (例: Schoenfeld et al. 2016のレビュー等)+ セット遂行自体に30〜45秒。これは研究から
// 直接引いた値ではなく、上記の一般的な目安から組み立てたエンジニアリング上の仮定である。
// 実測の記録が無い以上の精度は主張しない。
const MINUTES_PER_SET = 2.5;

/**
 * 直近7日間(todayStrを含む)に実際に記録されたセッションから、1日あたりの運動消費kcalの
 * 平均を求める。「週3回・週2時間」のような想定スケジュールではなく、実際にログされた
 * セッションだけを数える(記録が飛んだ週は少なく出るし、飲み会続きで練習を増やした週は
 * 多く出る。前提のスケジュールを仮定しないのはこのため)。
 *
 * workouts / badminton は storage / store.importAll(配列かどうかしか検証しない) 由来の
 * 信頼できない外部データなので、null要素・不正な date・型の合わないフィールドは
 * (js/workout.js の weeklyVolume 等と同じ方針で)例外を投げず読み飛ばす。
 *
 * weightKg はMETベースの換算に必要な現在体重(js/body.js の currentBodyweight 等で
 * 呼び出し側が用意する)。不正・未指定なら0を返す(運動消費不明で計算を止めるより、
 * EA計算側で「運動0」として安全側に振れる方を優先する)。
 */
export function dailyExerciseKcal(workouts, badminton, todayStr, weightKg) {
  const weight = positiveOrNull(weightKg);
  if (weight === null || typeof todayStr !== 'string') return 0;

  const windowDates = new Set(lastNDates(todayStr, 7));
  if (windowDates.size === 0) return 0;

  let total = 0;

  for (const w of workouts ?? []) {
    if (!w || !isValidDateStr(w.date) || !windowDates.has(w.date)) continue;
    if (!Array.isArray(w.sets)) continue;
    const minutes = w.sets.length * MINUTES_PER_SET;
    total += kcalPerMinute(NET_MET.resistance, weight) * minutes;
  }

  for (const b of badminton ?? []) {
    if (!b || !isValidDateStr(b.date) || !windowDates.has(b.date)) continue;
    const minutes = Number(b.durationMin);
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    total += kcalPerMinute(NET_MET.badminton, weight) * minutes;
  }

  return total / 7;
}

/**
 * エネルギー可用性(EA) = (摂取kcal − 運動消費kcal) / FFM(kg)。
 * ffmKgが不明・不正なら計算できないため null を返す(呼び出し側は「FFM不明」として
 * 別の表示に切り替えること。0 kcal/kg のような誤解を招く数値は返さない)。
 *
 * 運動を増やしながら摂取を削ると、運動消費は分子から引かれる側にあるため
 * 両方が同時にEAを下げる方向に働く(このユーザーが提案した「1,200kcalに削りつつ
 * 週5日トレーニング」のような組み合わせが、単純な「摂取だけ」の指標より
 * はるかに厳しい状態を示す理由はここにある)。
 */
export function energyAvailability(intakeKcal, exerciseKcal, ffmKg) {
  const ffm = positiveOrNull(ffmKg);
  if (ffm === null) return null;
  const intake = Number(intakeKcal);
  const exercise = Number(exerciseKcal);
  const safeIntake = Number.isFinite(intake) ? intake : 0;
  const safeExercise = Number.isFinite(exercise) ? exercise : 0;
  return (safeIntake - safeExercise) / ffm;
}

const EA_FLOOR_PER_KG_FFM = 30; // ACSM/AND/DC 2016 (上記コメント参照)。警告ライン(崖ではない)
const EA_OPTIMAL_PER_KG_FFM = 45; // 同上。「これ以上ならエネルギーバランス・健康に望ましい」水準

/**
 * EAフロア(警告ライン)をkcalで表したもの: 30 × FFM(kg) + 運動消費kcal。
 * FFM不明なら null(呼び出し側は既存の固定targets.kcalFloorにフォールバックすること)。
 *
 * 例: FFM 48kg・運動消費 184kcal/日 → 30×48+184 = 1,624kcal 付近。
 * このユーザーが提案した1,200kcal/日は EA 21.2、1,000kcal/日は EA 17.0
 * (いずれも30を大きく下回り、かつ運動を増やすほど悪化する)。
 */
export function eaFloorKcal(ffmKg, exerciseKcal) {
  const ffm = positiveOrNull(ffmKg);
  if (ffm === null) return null;
  const exercise = Number(exerciseKcal);
  return EA_FLOOR_PER_KG_FFM * ffm + (Number.isFinite(exercise) ? exercise : 0);
}

/** EA最適ライン(45 × FFM + 運動消費kcal)。eaFloorKcalと同じ入力規約。 */
export function eaOptimalKcal(ffmKg, exerciseKcal) {
  const ffm = positiveOrNull(ffmKg);
  if (ffm === null) return null;
  const exercise = Number(exerciseKcal);
  return EA_OPTIMAL_PER_KG_FFM * ffm + (Number.isFinite(exercise) ? exercise : 0);
}

// 座位〜軽い日常活動のみを表す活動係数(Institute of Medicine, 2005の座位〜低活動PALの
// 目安レンジ、概ね1.0〜1.4の中央付近)。このアプリが週3回のマシントレーニング・週2時間の
// バドミントンという「構造化された運動」をdailyExerciseKcalとして別途加算するため、
// ここでの係数は構造化運動を含まない値を意図的に選んでいる(含めてしまうと運動分を
// 二重に数えることになる)。
const SEDENTARY_ACTIVITY_FACTOR = 1.2;

/**
 * 体組成・食事のトレンドデータが無い/不十分なときの、維持カロリーの「出発点」推定。
 * RMR(FFM既知ならCunningham、不明ならten Haaf)× 座位活動係数 + 実測の運動消費。
 * これはあくまで予測式であり、後述の estimateMaintenance が優先する「体重トレンドからの
 * 実測ベース推定」に取って代わるものではない(このアプリのユーザーの体組成計測記録では、
 * 予測式は実測よりも500〜700kcal/日ほど高く出る傾向があり、申告摂取量の過小評価が
 * 典型的な原因とされる。ACSM 2016 参照)。
 */
export function equationMaintenanceEstimate({ ffmKg, weightKg, heightM, ageYears, isMale, exerciseKcalPerDay = 0 } = {}) {
  const ffm = positiveOrNull(ffmKg);
  const rmr = ffm !== null
    ? rmrCunningham(ffm)
    : rmrTenHaaf({ weightKg, heightM, ageYears, isMale });
  if (!Number.isFinite(rmr) || rmr <= 0) return null;
  const exercise = Number(exerciseKcalPerDay);
  return rmr * SEDENTARY_ACTIVITY_FACTOR + (Number.isFinite(exercise) ? exercise : 0);
}

// --- estimateMaintenance で使う日付/合計のヘルパー ---
// nutrition.js の dayTotals を再利用したいところだが、js/nutrition.js の achievement() が
// このモジュールの eaFloorKcal を使うため、逆方向にnutrition.jsを import すると循環参照に
// なる。ここでは kcal 合計だけを取り出す最小限のロジックを重複させる(dayTotals と同じ
// 防御的丸め方針: 壊れたレコードは例外を投げず読み飛ばす)。
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function dayKcalTotal(meals, dateStr) {
  let kcal = 0;
  for (const meal of meals ?? []) {
    if (!meal || typeof meal.datetime !== 'string' || !meal.datetime.startsWith(dateStr)) continue;
    if (!Array.isArray(meal.items)) continue;
    for (const item of meal.items) {
      if (!item) continue;
      kcal += toNum(item.kcal);
    }
  }
  return kcal;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateStr(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00Z');
  return !Number.isNaN(d.getTime());
}

/** todayStrを含む直近n日分の日付文字列を昇順(古い→新しい)で返す */
function lastNDates(todayStr, n) {
  if (!isValidDateStr(todayStr)) return [];
  const today = new Date(todayStr + 'T00:00:00Z');
  const dates = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function dateDiffDays(fromStr, toStr) {
  const from = new Date(fromStr + 'T00:00:00Z');
  const to = new Date(toStr + 'T00:00:00Z');
  return Math.round((to - from) / (24 * 3600 * 1000));
}

// 実測トレンドから維持カロリーを逆算するために要求する最低条件。ここを甘くすると
// 「数日記録しただけ」のノイズを「維持カロリーが分かった」と言い切ってしまう
// (=捏造に近い自信過剰)。逆に厳しすぎると実測ベースの推定が長期間出せない。
// 選定理由:
// - TREND_SPAN_DAYS = 14: 体重は水分・グリコーゲンで日々1kg近く変動しうるため、
//   数日〜1週間程度の窓では体重変化がノイズに埋もれる。2週間はその変動をある程度
//   均せる最短の目安として選んだ(生理学的根拠のある「正しい日数」があるわけではない)。
// - TREND_MIN_LOGGED_DAYS = 10: 14日中70%(10日)以上に食事記録が無いと、平均摂取が
//   「記録した日だけ食べた特別な日」に偏っている可能性が高く、代表値として使えない。
// - TREND_MIN_BODY_RECORDS = 2: 体重変化を計算するには最低2点(期間の始点・終点)が必要。
const TREND_SPAN_DAYS = 14;
const TREND_MIN_LOGGED_DAYS = 10;
const TREND_MIN_BODY_RECORDS = 2;
const KCAL_PER_KG_BODYWEIGHT = 7700; // 体重1kgの増減に相当するエネルギー収支の伝統的な概算値

/**
 * 維持カロリーを推定する。
 * 1) 直近 TREND_SPAN_DAYS 日について、食事記録が十分な日数あり、かつ体組成記録が
 *    期間内に2件以上あれば、実測ベースで逆算する:
 *      maintenance ≈ 平均摂取kcal + (体重変化kg × 7700) / 経過日数
 *    (体重が減っている=平均摂取は維持カロリーより低かった、という前提の単純な逆算)
 * 2) データ不足なら、equationEstimateKcal(呼び出し側が equationMaintenanceEstimate で
 *    計算して渡す)があればそれを「予測式による、あくまで出発点の推定」として返す。
 * 3) それも無ければ method: 'insufficient' とし、kcal は null(自信の無い数字を
 *    捏造しない。呼び出し側はこの場合、数値を出さずに「データが足りない」と伝えること)。
 *
 * meals/body は信頼できない外部データの境界なので、壊れたレコードは読み飛ばす。
 */
export function estimateMaintenance(meals, body, todayStr, equationEstimateKcal = null) {
  const windowDates = lastNDates(todayStr, TREND_SPAN_DAYS);
  const fallback = () => {
    const eq = Number(equationEstimateKcal);
    if (Number.isFinite(eq) && eq > 0) {
      return {
        kcal: Math.round(eq),
        method: 'equation',
        days: null,
        note: '実測データ(食事記録・体重記録)がまだ不足しているため、予測式によるおおまかな出発点の推定です。体重の実測トレンドではありません。'
      };
    }
    return {
      kcal: null,
      method: 'insufficient',
      days: null,
      note: 'データが不足していて推定できません。食事と体重の記録を増やしてください。'
    };
  };

  if (windowDates.length === 0) return fallback();

  const validBody = (body ?? [])
    .filter((b) => b && typeof b.date === 'string' && DATE_RE.test(b.date) && positiveOrNull(b.weight) !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const startDate = windowDates[0];
  const bodyInWindow = validBody.filter((b) => b.date >= startDate && b.date <= todayStr);

  const loggedDailyKcal = windowDates
    .map((d) => dayKcalTotal(meals, d))
    .filter((k) => k > 0);

  if (bodyInWindow.length < TREND_MIN_BODY_RECORDS || loggedDailyKcal.length < TREND_MIN_LOGGED_DAYS) {
    return fallback();
  }

  const first = bodyInWindow[0];
  const last = bodyInWindow[bodyInWindow.length - 1];
  const days = dateDiffDays(first.date, last.date);
  if (days <= 0) return fallback();

  const meanIntake = loggedDailyKcal.reduce((sum, k) => sum + k, 0) / loggedDailyKcal.length;
  const deltaWeight = Number(last.weight) - Number(first.weight);
  const maintenance = meanIntake + (deltaWeight * KCAL_PER_KG_BODYWEIGHT) / days;

  return {
    kcal: Math.round(maintenance),
    method: 'trend',
    days,
    note: `直近${days}日の平均摂取${Math.round(meanIntake)}kcalと体重変化${deltaWeight >= 0 ? '+' : ''}${deltaWeight.toFixed(1)}kgから逆算した実測ベースの推定です。`
  };
}
