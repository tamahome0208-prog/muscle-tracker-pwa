// 目標設定・進捗トラッキングの純粋関数群。
//
// なぜ body.js / energy.js ではなく新しいモジュールにするか:
// - js/body.js は「生の体組成レコード」の読み取り・差分・系列化(latestBody/bodyDiff/bodySeries)を
//   担当する薄いレイヤーで、目標(goal)という概念そのものを知らない。
// - js/energy.js はエネルギー可用性(EA)とマクロという「今日/直近」の計算を担当し、
//   月単位のトレンド・長期の目標到達といった時間軸が長い概念とは別の関心事。
// - 目標設定・トレンド・投影・FFMI・レート信号判定は、上記どちらの既存モジュールにも
//   自然には収まらない「目標」という第三のレイヤーであり、かつテストすべき純粋関数の
//   かたまりとしてまとまりが良い。そのため js/goals.js として独立させる。
//
// 【このモジュール全体を貫く方針】
// 体組成の実測値(InBody)は単体では信頼できない(InBody vs DXAで脂肪量に-2.9±2.0kgの
// system的バイアス、SEE 1.9kg)。かつ1ヶ月の本当の進捗(0.3〜0.5kg)は同一デバイス内の
// 測定誤差(SEM 0.77〜0.99%、Miller et al. 2018)より小さい。
//
// 【出典の状態】このうち著者・年まで辿れるのは SEM 0.77〜0.99%(Miller et al. 2018)だけ。
// 「InBody vs DXA で -2.9±2.0kg、SEE 1.9kg」と「1ヶ月の実進捗 0.3〜0.5kg」は
// 一次文献を特定できていない(出典なし)。
// ただし、この方針が依存しているのは個々の数値ではなく
// 「測定誤差 > 1ヶ月の実変化」という大小関係そのものであり、その向きは
// Miller et al. 2018 の SEM だけでも支持される。数値が後で訂正されても
// 「単発2点の差を進捗と呼ばない」という設計判断は変わらない。
// 一次文献が特定でき次第、著者・年に置き換えること。
//
// したがって:
// - 単発の記録2点を比べて「進捗」と言わない(js/recordTab.js の bodyDiff は開始比較の
//   参考値であり、このモジュールの trend とは別物)。
// - 8〜12週の窓・3点移動平均を必須にし、条件を満たさなければ null を返す
//   (捏造した数値より「まだ分からない」の方が誠実)。
// - 投影は単一の確信めいた日付を返さない。常に幅(range)で返す。

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 24 * 3600 * 1000;
// 【設計上の判断】1ヶ月の日数。グレゴリオ暦の平均年長 365.2425 日を12で割った値。
// 「月あたりの増加ペース」を日数から換算するためだけに使う。
const DAYS_PER_MONTH = 30.4368; // 365.2425/12

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isValidDateStr(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00Z');
  return !Number.isNaN(d.getTime());
}

function dateDiffDays(fromStr, toStr) {
  const from = new Date(fromStr + 'T00:00:00Z');
  const to = new Date(toStr + 'T00:00:00Z');
  return Math.round((to - from) / MS_PER_DAY);
}

/**
 * body(store.get('body'))のレコードとして、体重・体脂肪率が両方とも有効な数値である
 * ものだけを「トレンド計算に使える記録」として扱う。壊れたレコードは読み飛ばす
 * (js/body.js の sorted() と同じ設計判断)。
 */
function isUsableRecord(b) {
  if (!b || typeof b.date !== 'string' || !DATE_RE.test(b.date)) return false;
  const weight = Number(b.weight);
  const fatPct = Number(b.fatPct);
  return Number.isFinite(weight) && weight > 0 && Number.isFinite(fatPct) && fatPct >= 0 && fatPct < 100;
}

/** 中心化3点移動平均。長さnの配列から長さn-2の配列を返す(先頭・末尾は平均できない) */
function centeredRollingAverage3(values) {
  const out = [];
  for (let i = 1; i < values.length - 1; i++) {
    out.push((values[i - 1] + values[i] + values[i + 1]) / 3);
  }
  return out;
}

// --- トレンド窓の設定 ---
// MIN_WINDOW_DAYS = 56 (8週): これより短い期間の変化は測定誤差(SEM)に埋もれる
//   (ブリーフの根拠: 月あたりの実進捗0.3〜0.5kgはSEM 1.9kg弱と同程度かそれ以下)。
// MAX_WINDOW_DAYS = 84 (12週): これより古い記録まで遡ると「今のトレンド」として
//   古すぎる情報が混ざる。8〜12週というブリーフの指定レンジの上限をそのまま採用。
// MIN_RAW_RECORDS = 4: 3点移動平均が1点でも出るには生データが3件必要だが、
//   1点だけでは「トレンド(変化率)」を語れない。移動平均の点が2点以上出て
//   初めて開始点・終了点の差分が取れるため、生データは最低4件必要。
// 【設計上の判断】以下3つは文献値ではなく、測定誤差より大きな変化だけを
// トレンドとして扱うために選んだ窓幅・最小件数である。理由は上のコメント参照。
const MIN_WINDOW_DAYS = 56;
const MAX_WINDOW_DAYS = 84;
const MIN_RAW_RECORDS = 4;

/**
 * 体組成のトレンドを返す。3点移動平均で平滑化したFFM(除脂肪量)・体脂肪率を、
 * 直近8〜12週の窓で開始点と終了点だけ比較する。
 *
 * データが足りない(生データ4件未満、移動平均が2点に満たない、
 * 移動平均後の開始・終了点の間隔が8週=56日未満)場合は、自信の無い数値を
 * 捏造せず null を返す。呼び出し側はこの null を「単発の記録は進捗ではない」
 * という表示に変換すること。
 *
 * body は storage/store.importAll由来の信頼できない外部データなので、
 * 壊れたレコード(日付不正・体重や体脂肪率が欠損/非数値)は読み飛ばす。
 */
export function bodyTrend(body, todayStr) {
  if (!isValidDateStr(todayStr)) return null;

  const records = (body ?? [])
    .filter(isUsableRecord)
    .filter((b) => b.date <= todayStr && dateDiffDays(b.date, todayStr) <= MAX_WINDOW_DAYS)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (records.length < MIN_RAW_RECORDS) return null;

  const dates = records.map((r) => r.date);
  const ffmValues = records.map((r) => Number(r.weight) * (1 - Number(r.fatPct) / 100));
  const fatValues = records.map((r) => Number(r.fatPct));

  const ffmRolling = centeredRollingAverage3(ffmValues);
  const fatRolling = centeredRollingAverage3(fatValues);
  const rollingDates = dates.slice(1, dates.length - 1);

  if (ffmRolling.length < 2) return null;

  const startDate = rollingDates[0];
  const endDate = rollingDates[rollingDates.length - 1];
  const days = dateDiffDays(startDate, endDate);
  if (days < MIN_WINDOW_DAYS) return null;

  const monthsSpan = days / DAYS_PER_MONTH;
  const ffmStart = ffmRolling[0];
  const ffmEnd = ffmRolling[ffmRolling.length - 1];
  const fatStart = fatRolling[0];
  const fatEnd = fatRolling[fatRolling.length - 1];

  return {
    days,
    startDate,
    endDate,
    ffmKg: {
      start: ffmStart,
      end: ffmEnd,
      deltaKg: ffmEnd - ffmStart,
      ratePerMonthKg: (ffmEnd - ffmStart) / monthsSpan
    },
    bodyFatPct: {
      start: fatStart,
      end: fatEnd,
      deltaPct: fatEnd - fatStart,
      ratePerMonthPct: (fatEnd - fatStart) / monthsSpan
    }
  };
}

/**
 * 目標に対する進捗を FFM(kg) と 体脂肪率(ポイント) で表す。
 * 現在値・目標値のいずれかが不正なら null(FFM側)。体脂肪率は現在値・目標値の
 * どちらかが無ければそのフィールドだけ null にする(FFMが分かっていれば
 * 体脂肪率が未計測でも進捗の一部は見せられるため)。
 */
export function goalProgress({ currentFfmKg, currentBodyFatPct, targetFfmKg, targetBodyFatPct } = {}) {
  const cFfm = Number(currentFfmKg);
  const tFfm = Number(targetFfmKg);
  if (!Number.isFinite(cFfm) || !Number.isFinite(tFfm)) return null;

  const cFat = Number(currentBodyFatPct);
  const tFat = Number(targetBodyFatPct);
  const fatOk = Number.isFinite(cFat) && Number.isFinite(tFat);

  return {
    ffmKg: { current: cFfm, target: tFfm, remainingKg: tFfm - cFfm },
    bodyFatPct: fatOk ? { current: cFat, target: tFat, remainingPct: cFat - tFat } : null
  };
}

// --- FFMI(Fat-Free Mass Index) ---
// FFMI = FFM(kg) / 身長(m)^2。Kouri et al. 1995は薬物非使用のボディビルダー42名全員が
// FFMI 25.0以下だったと報告し、後年の研究(薬物検査済みナチュラル競技者)ではおよそ5%が
// 25をわずかに超えたとされる。そのため25は「絶対に超えられない壁」ではなく
// 「典型的な上限の目安」として扱う。
export const FFMI_NATURAL_CEILING = 25;

/** FFMI = FFM(kg) / 身長(m)^2。入力が不正なら null */
export function ffmi(ffmKg, heightM) {
  const ffm = Number(ffmKg);
  const h = Number(heightM);
  if (!Number.isFinite(ffm) || ffm <= 0 || !Number.isFinite(h) || h <= 0) return null;
  return ffm / (h * h);
}

/**
 * FFMIに対する「headroom(伸びしろ)」の文脈づけ。FFMI_NATURAL_CEILING(25)は
 * 崖ではなく目安である旨は呼び出し側の文言で明示すること。
 */
export function ffmiHeadroom(ffmiValue) {
  const v = Number(ffmiValue);
  if (!Number.isFinite(v) || v <= 0) return null;
  return { ffmi: v, ceiling: FFMI_NATURAL_CEILING, headroomFfmi: FFMI_NATURAL_CEILING - v };
}

// --- 投影(projection) ---
// 実測トレンド(bodyTrend)の月あたりレートが得られればそれを優先するが、
// Ogasawara et al. 2011は1レップあたりの増加ペースが15週で約70%低下すると報告しており、
// 早期のペースをそのまま将来まで直線外挿するのは誤りである。そのため実測レートが
// 得られた場合でも「このペースのまま」の楽観側と「Ogasawaraの減速を踏まえた」保守側の
// 両方を幅として返し、単一の確信めいた月数・日付を返さない。
// 文献レンジ(実測が無い場合のフォールバック): 初心者男性の維持カロリー下での
// 現実的な除脂肪量増加は月0.25〜0.5kg。
//
// 【出典なし・実務上の仮定】この 0.25〜0.5 という具体的な数値そのものを述べた
// 一次文献は特定できていない。DXAで実測した研究群から広く引用されるレンジだが、
// どの研究のどの数値かを本コードは示せていない。
// 練習者の間で流布する「初月に1kg増える」式の経験則よりは保守的な値を採っている、
// という以上の主張はしない。実測レートが得られたら常にそちらを優先する
// (この定数はフォールバックでしか使われない)。
// 一次文献が特定でき次第、著者・年に置き換えること。
export const LIT_LEAN_GAIN_MIN_KG_PER_MONTH = 0.25;
export const LIT_LEAN_GAIN_MAX_KG_PER_MONTH = 0.5;
// Ogasawara et al. 2011: 1レップあたりの増加ペースが15週でおよそ70%低下 → 保守的な
//下限側の見積もりとして、実測レートの30%(=70%減)が続いた場合を悲観シナリオとする。
const OGASAWARA_DECAY_REMAINING_FRACTION = 0.3;

/**
 * FFM目標までの投影(何ヶ月かかりそうか)を幅で返す。
 * measuredRatePerMonthKg(bodyTrendのffmKg.ratePerMonthKgなど)が正の有限数で
 * 渡された場合はそれを基準にし、そうでなければ文献レンジにフォールバックする
 * (basisで区別する。呼び出し側は必ずbasisを画面に表示すること)。
 * 既に目標に到達/超過している場合は reached:true を返す。
 */
export function projectLeanGainMonths({ currentFfmKg, targetFfmKg, measuredRatePerMonthKg = null } = {}) {
  const current = Number(currentFfmKg);
  const target = Number(targetFfmKg);
  if (!Number.isFinite(current) || !Number.isFinite(target)) return null;

  const deltaKg = target - current;
  if (deltaKg <= 0) {
    return { reached: true, deltaFfmKg: deltaKg, basis: null, ratePerMonthKg: null, monthsRange: [0, 0], note: '目標のFFMに到達しています。' };
  }

  const measured = Number(measuredRatePerMonthKg);
  if (Number.isFinite(measured) && measured > 0) {
    const monthsOptimistic = deltaKg / measured;
    const monthsConservative = deltaKg / (measured * OGASAWARA_DECAY_REMAINING_FRACTION);
    return {
      reached: false,
      deltaFfmKg: deltaKg,
      basis: 'measured',
      ratePerMonthKg: measured,
      monthsRange: [monthsOptimistic, monthsConservative],
      note: `あなた自身の実測トレンド(月あたり約${measured.toFixed(2)}kg)を基準にした推定です。このペースがそのまま続いた場合と、` +
        `Ogasawara et al. 2011が報告する増加ペースの減速(15週で約70%低下)を踏まえた場合の幅を示しています。単一の確定した日付ではありません。`
    };
  }

  const monthsOptimistic = deltaKg / LIT_LEAN_GAIN_MAX_KG_PER_MONTH;
  const monthsConservative = deltaKg / LIT_LEAN_GAIN_MIN_KG_PER_MONTH;
  return {
    reached: false,
    deltaFfmKg: deltaKg,
    basis: 'literature',
    ratePerMonthKg: null,
    monthsRange: [monthsOptimistic, monthsConservative],
    note: '実測トレンドがまだ十分でないため、文献上の初心者男性の目安(維持カロリー下で月0.25〜0.5kg、DXA実測データに基づく)から' +
      '計算した幅です。実測ではありません。'
  };
}

// --- レート信号(normal / problem) ---
// ブリーフの表:
//   体重          正常 週±0.3%          問題 週1%超が持続
//   FFM           正常 横ばい〜微増        問題 8週で-0.5kg超
//   筋力(挙上重量)  正常 緩やかに上昇        問題 2週連続以上の低下
//   EA            正常 30kcal/kgFFM以上   問題 30未満、緊急 25未満
// 男性ではRED-Sの兆候はしばしば体重計より先に内分泌・自覚症状に出るため、
// この4指標だけで「異常なし」と請け合わない、という注記を呼び出し側の文言に必ず添えること。

/**
 * エネルギー可用性(EA)の警告域と緊急域。単位は kcal/kg FFM/日。
 * 出典: Mountjoy et al., ACSM/AND/DC 2016 共同ポジションスタンド(RED-S)。
 * 30 未満で相対的エネルギー不足の懸念域、25 未満はより明確な低可用性域とされる。
 * js/energy.js の EA_FLOOR_PER_KG_FFM(30) と同じ文献に由来し、値も整合している。
 *
 * 【リテラルで埋め込まないこと】以前は checkRateSignals の中に 25 / 30 が
 * 直接書かれており、ホームタブから同じ基準で判定しようとしたときに
 * 数値を二重に持つことになった。閾値が2箇所にあると、片方だけ変更されて
 * 画面ごとに違う判定が出る。
 */
export const EA_EMERGENCY_PER_KG_FFM = 25;
export const EA_WARNING_PER_KG_FFM = 30;
// 呼び出し側が値を持たない指標には null/undefined を渡す想定。Number(null) === 0 に
// なってしまい「0%変化」「EA 0kcal/kgFFM」のような捏造した数値として判定されるのを防ぐため、
// null/undefined は明示的に「データ無し」として弾いてから数値化する。
function finiteOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function checkRateSignals({
  weightWeeklyPctChange = null,
  ffmChangeKgOver8Weeks = null,
  strengthFallingWeeks = null,
  eaKcalPerKgFfm = null
} = {}) {
  const problems = [];

  const w = finiteOrNull(weightWeeklyPctChange);
  if (Number.isFinite(w) && Math.abs(w) > 1) {
    problems.push({
      signal: 'bodyweight',
      message: `体重が週${w >= 0 ? '+' : ''}${w.toFixed(1)}%変化しています(目安は週±0.3%、問題域は週1%超の変化が続くこと)`
    });
  }

  const ffmDelta = finiteOrNull(ffmChangeKgOver8Weeks);
  if (Number.isFinite(ffmDelta) && ffmDelta < -0.5) {
    problems.push({
      signal: 'ffm',
      message: `除脂肪量が8週間で${ffmDelta.toFixed(1)}kg低下しています(問題域は8週で-0.5kgを超える低下)`
    });
  }

  const fallingWeeks = finiteOrNull(strengthFallingWeeks);
  if (Number.isFinite(fallingWeeks) && fallingWeeks >= 2) {
    problems.push({
      signal: 'strength',
      message: `挙上重量が${fallingWeeks}週連続で低下しています(問題域は2週連続以上の低下)`
    });
  }

  const ea = finiteOrNull(eaKcalPerKgFfm);
  if (Number.isFinite(ea)) {
    if (ea < EA_EMERGENCY_PER_KG_FFM) {
      problems.push({ signal: 'energyAvailability', message: `エネルギー可用性が${ea.toFixed(1)}kcal/kgFFM/日で、緊急域(${EA_EMERGENCY_PER_KG_FFM}未満)です` });
    } else if (ea < EA_WARNING_PER_KG_FFM) {
      problems.push({ signal: 'energyAvailability', message: `エネルギー可用性が${ea.toFixed(1)}kcal/kgFFM/日で、警告域(${EA_WARNING_PER_KG_FFM}未満)です` });
    }
  }

  return problems;
}

// --- 目標体脂肪率が健康的レンジを下回るときの緊張関係 ---
// 研究が挙げる「支持できる健康目標」は14〜18%。12%を下回るとレクリエーションレベルの
// 筋トレ愛好者にとって健康上の必然性がなく、そこに必要なエネルギー可用性の条件は
// このユーザーのリスクプロファイル(1,200kcal/日・1,000kcal/日への削減を過去に提案)と
// 直接衝突する。
//
// 【出典の状態】機関名(ACE / ACSM)までは辿れるが、どの版・どの年の基準表かを
// 本コードは特定できていない。14〜18% という本アプリの採用値も、両機関のレンジが
// 重なる区間から選んだ実務上の判断であり、どちらかの機関が「14〜18%」と
// 述べているわけではない。版が特定でき次第、西暦を付すこと。
//
// ACEとACSMの基準ですら一致しない(ACE: アスリート男性6〜13% / ACSM:
// 健康的なレンジ10〜22%)ため、単一の数値ではなく範囲として示す。
export const HEALTHY_BODYFAT_RANGE_LOW = 14;
export const HEALTHY_BODYFAT_RANGE_HIGH = 18;
export const NO_HEALTH_JUSTIFICATION_BODYFAT = 12;

/**
 * 目標体脂肪率が健康的レンジ(14〜18%)を下回るときだけ、その緊張関係を説明する
 * オブジェクトを返す(下回っていなければ null)。ブロックはしない
 * (目標はユーザーのものであり、このアプリはクランプも拒否もしない)。
 *
 * weightKg・exerciseKcalが有効な数値なら、目標体脂肪率に体重が変わらず到達したと
 * 仮定した場合のFFM・EAフロアと、ユーザーが過去に提案した1,200kcal/日・1,000kcal/日が
 * その体組成でどれだけEAを下回るかという具体的な算数を添える(体重が不明な場合は
 * 算数抜きの一般的な説明のみ返す)。
 */
export function bodyFatGoalTension({ targetBodyFatPct, weightKg = null, exerciseKcal = 0 } = {}) {
  const target = Number(targetBodyFatPct);
  if (!Number.isFinite(target) || target >= HEALTHY_BODYFAT_RANGE_LOW) return null;

  const belowNoJustification = target < NO_HEALTH_JUSTIFICATION_BODYFAT;
  const general =
    `設定した目標体脂肪率${target}%は、研究が挙げる健康的な目安のレンジ14〜18%を下回っています。` +
    (belowNoJustification
      ? '12%を下回る水準は、レクリエーションレベルの筋トレ愛好者にとって健康上の必然性がなく、必要なエネルギー可用性の条件はあなたのリスクプロファイルと衝突します。'
      : '') +
    'ACE(アスリート男性6〜13%)とACSM(健康的なレンジ10〜22%)の基準自体が一致していないため、単一の数値ではなく範囲としてお伝えします。';

  const weight = Number(weightKg);
  const exercise = Number.isFinite(Number(exerciseKcal)) ? Number(exerciseKcal) : 0;
  if (!Number.isFinite(weight) || weight <= 0) {
    return { belowHealthyRange: true, targetFfmKg: null, floorAtTargetKcal: null, ea1200: null, ea1000: null, message: general };
  }

  const targetFfmKg = weight * (1 - target / 100);
  const floorAtTargetKcal = 30 * targetFfmKg + exercise;
  const ea1200 = (1200 - exercise) / targetFfmKg;
  const ea1000 = (1000 - exercise) / targetFfmKg;

  const arithmetic =
    `具体的な計算: 体重${weight.toFixed(1)}kgのままこの目標体脂肪率に到達したと仮定すると、除脂肪量は${targetFfmKg.toFixed(1)}kgになります。` +
    `このFFMでのEAフロア(30×FFM+運動消費)は約${Math.round(floorAtTargetKcal)}kcalです。` +
    `あなたが過去に提案した1,200kcal/日はこの体組成でEA ${ea1200.toFixed(1)}kcal/kgFFM/日、` +
    `1,000kcal/日ではEA ${ea1000.toFixed(1)}kcal/kgFFM/日となり、いずれも30を大きく下回ります(25未満は緊急域)。`;

  return {
    belowHealthyRange: true,
    targetFfmKg,
    floorAtTargetKcal,
    ea1200,
    ea1000,
    message: `${general} ${arithmetic}`
  };
}

// --- 表示側(js/recordTab.js)がレート信号の入力を組み立てるための補助関数 ---

// 【設計上の判断】「週次の体重変化」を計算するために、直近の記録2点の間隔として
// 許容する日数。文献値ではない。ちょうど7日の記録が揃うことは実際には稀なので、
// 7日の前後2日(5〜9日)を週次とみなす。狭くすると計算できる日が減り、
// 広げると「週次」と呼べない間隔まで週次として扱ってしまう。
const WEEKLY_CHECK_MIN_DAYS = 5;
const WEEKLY_CHECK_MAX_DAYS = 9;

/**
 * 直近の体重記録2件から「週あたり何%変化したか」を概算する。
 * 単純に最新2件を比べるのではなく、最新記録からおおよそ1週間(5〜9日)前に
 * 収まる記録を探して比較する(記録の間隔がバラバラなこのアプリでは、
 * 「たまたま2日前に測った記録」同士を比べると水分変動をそのまま週次の
 * トレンドと誤認しかねないため)。該当する記録が無ければ null。
 */
export function recentWeeklyWeightPctChange(body, todayStr) {
  if (!isValidDateStr(todayStr)) return null;
  const records = (body ?? [])
    .filter((b) => b && typeof b.date === 'string' && DATE_RE.test(b.date))
    .filter((b) => {
      const w = Number(b.weight);
      return Number.isFinite(w) && w > 0;
    })
    .filter((b) => b.date <= todayStr)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  if (records.length < 2) return null;
  const latest = records[records.length - 1];

  let earlier = null;
  for (let i = records.length - 2; i >= 0; i--) {
    const days = dateDiffDays(records[i].date, latest.date);
    if (days > WEEKLY_CHECK_MAX_DAYS) break;
    if (days >= WEEKLY_CHECK_MIN_DAYS) {
      earlier = records[i];
      break;
    }
  }
  if (!earlier) return null;

  const days = dateDiffDays(earlier.date, latest.date);
  const earlierWeight = Number(earlier.weight);
  const pct = ((Number(latest.weight) - earlierWeight) / earlierWeight) * 100;
  return pct * (7 / days);
}

/**
 * 週次の値の配列(例: js/workout.js の weeklyVolume が返す各週のvolume)が、
 * 末尾から何週連続で前週を下回っているかを返す。進行中でまだ終わっていない
 * 最新週を含めると「まだセットを終えていないだけ」を低下と誤認するため、
 * 呼び出し側で必要なら進行中の週を除いてから渡すこと。比較できる点が
 * 2件未満なら0(低下していないのと同じ扱い)。
 */
export function consecutiveFallingWeeks(weeklyValues) {
  const values = (weeklyValues ?? []).map((v) => Number(v)).filter((v) => Number.isFinite(v));
  let count = 0;
  for (let i = values.length - 1; i > 0; i--) {
    if (values[i] < values[i - 1]) count++;
    else break;
  }
  return count;
}

/** 「単発の記録は進捗ではない」という測定ノイズの注記文言。表示側で共通利用する */
export const MEASUREMENT_NOISE_NOTE =
  '体組成計(InBody)は同一デバイス内でも測定誤差(SEM)が体脂肪率で約0.77〜0.99ポイントあり、' +
  '1ヶ月の本当の進捗(月0.25〜0.5kg)はこの誤差より小さいことが普通です。単発の記録1件を前回と比べても、' +
  'それは進捗ではなく測定ノイズです。8〜12週分の記録が貯まって初めてトレンドとして表示します。';
