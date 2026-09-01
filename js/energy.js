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

// 【製品仕様ではなく物理定数】1 kcal = 4.184 kJ(熱化学カロリーの定義値)。
// 研究由来の推定値ではないので、この値が将来変わることはない。
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
 * 呼び出し側が用意する)。
 *
 * 【不正・未指定なら null を返す】以前はここで 0 を返し、コメントには
 * 「運動消費不明で計算を止めるより、EA計算側で『運動0』として安全側に振れる方を
 * 優先する」と書いていた。これは向きが逆である。
 * EAフロアは 30 × FFM + 運動消費kcal なので、運動消費が 0 として扱われると
 * フロアが運動分だけ低くなり、警告は緩む。週5日トレーニングしている人の
 * フロアを「運動していない人のフロア」に置き換えることになる。
 * 分からないときは緩めるのではなく、判定を保留する(呼び出し側は null を
 * 「不明」として扱い、下限判定を行わないこと。js/nutrition.js の achievement 参照)。
 */
export function dailyExerciseKcal(workouts, badminton, todayStr, weightKg) {
  const weight = positiveOrNull(weightKg);
  if (weight === null || typeof todayStr !== 'string') return null;

  const windowDates = new Set(lastNDates(todayStr, 7));
  if (windowDates.size === 0) return null;

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
  // eaFloorKcal と同じ規約: null は「運動消費不明」。0 として扱うとEAが実際より
  // 高く出てしまい、緊急域の判定が甘くなる。
  if (exerciseKcal === null) return null;
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
  // exerciseKcal === null は「運動消費が計算できなかった」の明示的な合図
  // (dailyExerciseKcal が体重不明時に返す)。0 として足し込むとフロアが
  // 運動分だけ低くなるため、フロア自体を「計算できない」として返す。
  // undefined(未指定)は従来どおり 0 として扱う(後方互換)。
  if (exerciseKcal === null) return null;
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
 * 実測ベース推定」に取って代わるものではない。
 *
 * 【出典なし・実務上の仮定】「予測式は実測より500〜700kcal/日ほど高く出る」という
 * この幅そのものを述べた一次文献は特定できていない。申告摂取量の過小評価が
 * 予測式と実測の乖離の典型的な原因であること自体は広く指摘されている(ACSM 2016)が、
 * 500〜700 という具体的な数値は本コードが示せる文献に基づいていない。
 *
 * ただしこの数値は計算に使っていない。予測式の結果を「あくまで出発点の推定であり
 * 実測ではない」と画面に明示する根拠として書かれているだけで、乖離の向き
 * (予測式の方が高く出る)が合っていれば設計判断は変わらない。
 * 一次文献が特定でき次第、著者・年に置き換えること。
 */
export function equationMaintenanceEstimate({ ffmKg, weightKg, heightM, ageYears, isMale, exerciseKcalPerDay = 0 } = {}) {
  const ffm = positiveOrNull(ffmKg);
  const rmr = ffm !== null
    ? rmrCunningham(ffm)
    : rmrTenHaaf({ weightKg, heightM, ageYears, isMale });
  if (!Number.isFinite(rmr) || rmr <= 0) return null;
  // eaFloorKcal と同じ規約: null は「運動消費不明」。0 として足すと維持カロリーが
  // 運動分だけ低く出て、「これだけ食べれば維持できる」という数字が実際より小さくなる。
  // これも警告が緩む向きの誤りなので、推定そのものを行わない。
  if (exerciseKcalPerDay === null) return null;
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
// 【設計上の判断】以下3つは文献から引いた値ではなく、このアプリの記録頻度に
// 合わせて決めた窓幅・最小件数である。上のコメントに理由を書いてある。
const TREND_SPAN_DAYS = 14;
const TREND_MIN_LOGGED_DAYS = 10;
const TREND_MIN_BODY_RECORDS = 2;
// 体重1kgの増減に相当するエネルギー収支の伝統的な概算値。
// 出典: Wishnofsky 1958 の「体脂肪1ポンド ≒ 3,500kcal」をkg換算したもの。
// 【この値の限界を承知で使う】この経験則は、体重が減るにつれて代謝も落ちること・
// 減量時に失われるのが脂肪だけではないことを織り込んでおらず、長期の減量では
// 実際より大きな減少を予測することが知られている(Hall 2008、Thomas et al. 2014 等の
// 批判がある)。ここでは14日程度の短期窓で「摂取と体重変化から維持カロリーを逆算する」
// 用途にしか使っておらず、その範囲では実用上の誤差に収まる。
// 長期予測に流用してはならない。
const KCAL_PER_KG_BODYWEIGHT = 7700;

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

// --- macroTargets: タンパク質・脂質・炭水化物(PFC)の目標値 ---
//
// このアプリはこれまでタンパク質を体重比の固定目標(100g)で扱ってきたが、それでは
// 除脂肪量(FFM)の変化にも、増量・減量のどちらの局面にも追随しない。以下は
// タンパク質を「体重」ではなく「FFM」基準に切り替え、脂質・炭水化物にも
// 根拠を明示した式を与えるための拡張。
//
// 【タンパク質: FFM基準】
// Refalo, Trexler & Helms (2025, Strength & Conditioning Journal) の系統的レビュー
// (ベイズ・メタ回帰、29研究)は、タンパク質摂取量と効果の間に線形の用量反応関係がある
// 確率97%超と報告し、その関係は「体重よりFFM基準で表したとき」「男性で」「4週間を
// 超える介入で」「体脂肪率が低いほど」強く出るとしている。このアプリのユーザー
// (男性・初心者・trainingは4週間超を想定・体脂肪率は高くない)はこの4条件に
// おおむね該当するため、FFM基準を採用する根拠になる。
// Morton et al. 2018 (BJSM, 49研究/1,863人のメタ解析)は体重比で見た効果の頭打ちを
// 1.62 g/kg・体重(信頼区間の上端は約2.2 g/kg)としている。
// ISSN 2017のポジションスタンドは通常時1.4〜2.0 g/kg・体重、低カロリー期には
// 2.3〜3.1 g/kg・体重に引き上げるべきとしている。
// Helms et al. 2014は減量期の除脂肪体重の低いトレーニーについて2.3〜3.1 g/kg・FFMを
// 挙げている。
// これらを踏まえ、既定値を 2.4×FFM(g)、エネルギー赤字期は 2.8×FFM(g) とし、
// 実務上の安全域として [1.6×体重, 2.2×体重] にクランプする(Morton 2018の頭打ちと
// ISSN 2017の通常域を両側の目安にした、このアプリ独自の実務的な折衷であり、
// どちらの論文も「この2.4/2.8という係数そのもの」を明記しているわけではない
// 点は正直に書いておく)。
//
// 【脂質: 下限としての最低ライン】
// ACSM 2016のポジションスタンドは、脂質摂取をエネルギー摂取の20%を慢性的に
// 下回らせるべきではないとしている(脂溶性ビタミン・必須脂肪酸を含む食品の
// 多様性が落ちることが理由)。Ruiz-Castellano et al. 2021は体重比で0.5 g/kg・体重を
// 最低ラインとして挙げている。日本人の食事摂取基準(2025年版)の目標量も脂質20〜30%Eで、
// 同じレンジが日本人集団についても支持されている。
// Whittaker & Wu 2021(J Steroid Biochem Mol Biol, メタ解析)は、低脂質食が男性の
// テストステロンをわずかに下げる方向に働くこと、かつその影響は「脂質が非常に低く、
// かつカロリーも制限されている」組み合わせで最大になることを報告している。これは
// まさにこのユーザーが繰り返し提案してきた「カロリーを削りつつ脂質も削る」方向の
// 組み合わせであるため、脂質は削ってよい変数ではなく下限を持つ変数として扱う。
// fat_g = max(0.5×体重, 0.20×E / 9)
//
// 【炭水化物: 残りとトリップワイヤー】
// ACSM 2016は運動量に応じて、軽い(低強度・スキル練習中心)日は3〜5 g/kg/日、
// 中等度(1日約1時間程度)の日は5〜7 g/kg/日を挙げている。このユーザーの運動量
// (週3回のマシントレーニング+週2時間のバドミントン、概ね週5時間)は軽度〜中等度の
// 境界にあたるため、3〜5 g/kg/日のレンジのうち下限側の 3 g/kg/日 を
// 「これを下回ったら炭水化物が足りていない」というトリップワイヤーに採用する。
// carb_g = (E − 4×protein_g − 9×fat_g) / 4
// この式が 3×体重(g) を下回った場合、まずタンパク質を1.6×体重まで緩め、
// それでも足りなければ脂質を「0.5×体重」の下駄を外した20%Eの床まで緩める。
// それでもなお3×体重を下回るなら、それは炭水化物の割り振り方の問題ではなく
// 「設定されているエネルギー量そのものが低すぎる」ことを意味するため、数値を
// 静かに帳尻合わせせず energyTooLow として呼び出し側に警告させる。
//
// 【タンパク質の摂取タイミングについて、あえて実装しないこと】
// Trommelen et al. 2023 (Cell Reports Medicine)はレジスタンス運動後に100gと25gの
// タンパク質を比較し、100gの方が筋原線維合成が高く、上限は見えなかったと報告している。
// 「1回20〜25gまで・1日4食に分けて」という広く流布した枠組みは、この知見からは
// 支持されない。Mamerow 2014・Areta 2013は均等な分配が急性の合成指標を高めることを
// 示しているが、これは急性の指標であり、鍛練者において「1日2食 vs 4食」を同じ
// 総タンパク質量で比較した長期RCTは存在しない(これは埋まっていない研究の空白であり、
// 「1日2食のこのユーザーの食べ方が問題だ」という結論の根拠にはできない)。そのため
// このアプリは1食あたりのタンパク質上限を設けない。
export const MACRO_PROTEIN_PER_FFM_DEFAULT = 2.4;
export const MACRO_PROTEIN_PER_FFM_DEFICIT = 2.8;
const MACRO_PROTEIN_CLAMP_LOW_PER_BW = 1.6;
const MACRO_PROTEIN_CLAMP_HIGH_PER_BW = 2.2;
const MACRO_FAT_MIN_PER_BW = 0.5;
const MACRO_FAT_MIN_PCT_ENERGY = 0.20;
const MACRO_CARB_MIN_PER_BW = 3; // g/kg/日。ACSM 2016の「軽度」運動量レンジ(3〜5g/kg)の下端

/**
 * PFC(タンパク質・脂質・炭水化物)の目標を計算する。数値は丸めずに返すので、
 * 表示側(js/settingsTab.js, js/mealTab.js)でMath.round等をかけること。
 *
 * energyKcal: その日のエネルギー目標(呼び出し側が決める。例: targets.kcalMin)。
 * ffmKg: 除脂肪量(estimateFfmKg で得る)。
 * weightKg: 体重(currentBodyweight 等で得る、InBody未計測ならprofile.weight)。
 * inDeficit: エネルギー赤字期かどうか(呼び出し側が推定維持カロリーと比較して渡す)。
 *
 * 3つの入力(energyKcal, ffmKg, weightKg)のいずれかが正の有限数でなければ、
 * 計算不能として null を返す(他の関数と同じく「0として計算を続ける」ことはしない。
 * 分母がFFM/体重であるこの計算で0や負値を通すと、割り算が発散したり、
 * 誤って安全な数値に見える結果を返しかねないため)。
 *
 * 戻り値の status:
 * - 'ok'       : 既定(またはクランプ後)のタンパク質・脂質のままで炭水化物が
 *                3×体重(g)以上確保できた。
 * - 'relaxed'  : 3×体重を下回ったため、タンパク質→脂質の順に下限まで緩めた結果、
 *                炭水化物が3×体重以上に戻った。notes に緩めた理由を記録する。
 * - 'energyTooLow' : タンパク質・脂質を下限まで緩めても炭水化物が3×体重に届かない。
 *                これは炭水化物の配分の問題ではなく、energyKcal自体が低すぎることを
 *                意味する。呼び出し側は静かに数値を出し直さず、その旨を明示すること。
 */
export function macroTargets({ energyKcal, ffmKg, weightKg, inDeficit = false } = {}) {
  const energy = Number(energyKcal);
  const ffm = Number(ffmKg);
  const bw = Number(weightKg);
  if (![energy, ffm, bw].every((n) => Number.isFinite(n) && n > 0)) return null;

  const notes = [];
  const lowRail = MACRO_PROTEIN_CLAMP_LOW_PER_BW * bw;
  const highRail = MACRO_PROTEIN_CLAMP_HIGH_PER_BW * bw;
  const perFfm = inDeficit ? MACRO_PROTEIN_PER_FFM_DEFICIT : MACRO_PROTEIN_PER_FFM_DEFAULT;

  let proteinG = perFfm * ffm;
  if (proteinG > highRail) {
    notes.push(`タンパク質は${perFfm}×FFM(${proteinG.toFixed(1)}g)でしたが、上限の目安である体重×2.2(${highRail.toFixed(1)}g)に抑えました。`);
    proteinG = highRail;
  } else if (proteinG < lowRail) {
    notes.push(`タンパク質は${perFfm}×FFM(${proteinG.toFixed(1)}g)でしたが、下限の目安である体重×1.6(${lowRail.toFixed(1)}g)まで引き上げました。`);
    proteinG = lowRail;
  }

  const fatFloorByBw = MACRO_FAT_MIN_PER_BW * bw;
  const fatFloorByPct = (MACRO_FAT_MIN_PCT_ENERGY * energy) / 9;
  let fatG = Math.max(fatFloorByBw, fatFloorByPct);

  const carbFor = (p, f) => (energy - 4 * p - 9 * f) / 4;
  const carbMinG = MACRO_CARB_MIN_PER_BW * bw;

  let carbG = carbFor(proteinG, fatG);
  let status = 'ok';

  if (carbG < carbMinG) {
    if (proteinG > lowRail) {
      proteinG = lowRail;
      carbG = carbFor(proteinG, fatG);
      notes.push(`炭水化物が目安の体重×3g(${carbMinG.toFixed(0)}g)を下回ったため、タンパク質を体重×1.6(${lowRail.toFixed(1)}g)まで緩めました。`);
    }

    if (carbG < carbMinG && fatG > fatFloorByPct) {
      fatG = fatFloorByPct;
      carbG = carbFor(proteinG, fatG);
      notes.push(`それでも炭水化物が目安を下回ったため、脂質を20%Eの下限(${fatG.toFixed(1)}g)まで緩めました。`);
    }

    if (carbG < carbMinG) {
      status = 'energyTooLow';
      notes.push(
        `タンパク質(${proteinG.toFixed(1)}g)・脂質(${fatG.toFixed(1)}g)を下限まで緩めても炭水化物は` +
        `${carbG.toFixed(1)}g(体重1kgあたり${(carbG / bw).toFixed(1)}g)にしかならず、目安の体重×3g` +
        `(${carbMinG.toFixed(0)}g)に届きません。${Math.round(energy)}kcalという設定自体が低すぎます。`
      );
    } else {
      status = 'relaxed';
    }
  }

  return {
    proteinG,
    fatG,
    carbG,
    carbPerKg: carbG / bw,
    status,
    notes
  };
}
