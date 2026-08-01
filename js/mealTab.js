import { $, onShow, toast, todayStr, nowStr, newId, esc, icon } from './ui.js';
import { dayTotals, achievement, sortFoodsByUse, bumpFoodUse } from './nutrition.js';
import { isBarcodeSupported, scanJan, lookupJan } from './barcode.js';
import { analyzeMealPhoto, analyzeReceipt, OcrError } from './ocr.js';
import { estimateFfmKg, dailyExerciseKcal, macroTargets, estimateMaintenance, equationMaintenanceEstimate } from './energy.js';
import { latestBody, currentBodyweight } from './body.js';
import { microTargetsForAge, applyAldh2Answer } from './micronutrients.js';

let store;

export function initMealTab(s) {
  store = s;
  onShow('meal', renderMealTab);
  renderStatusBar();
}

/** 上部の死守2項目バーを更新する。食事を追加するたびに呼ぶ */
export function renderStatusBar() {
  const profile = store.get('profile');
  const targets = profile.targets;
  const totals = dayTotals(store.get('meals'), todayStr());
  // このステータスバーは常に「今日」の集計しか表示しない(過去日を見るビューは
  // 無い)ため、dayOver は現在時刻が20時以降かどうかだけで決まる。
  const dayOver = new Date().getHours() >= 20;

  // EA(エネルギー可用性)フロアで下限警告を判定するため、直近のInBody記録から
  // FFM(除脂肪量)と直近7日の運動消費kcalを渡す(js/energy.js 参照)。
  // InBody記録が無い場合も estimateFfmKg が profile.weight から概算FFMを返すため、
  // 運動はしているのにEA経路が完全に無効化される(=運動消費の項が丸ごと落ちて
  // floorが必要以上に緩くなる)回帰を避ける。どちらの経路でも得られなければ ffmKg は
  // null になり、achievement() は最終手段として targets.kcalFloor の固定値に
  // フォールバックする。
  const body = store.get('body');
  const latest = latestBody(body);
  const weightForExercise = currentBodyweight(body, profile);
  const ffmResult = estimateFfmKg(latest, weightForExercise);
  const ffmKg = ffmResult ? ffmResult.ffmKg : null;
  const exerciseKcal = dailyExerciseKcal(store.get('workouts'), store.get('badminton'), todayStr(), weightForExercise);

  const a = achievement(totals, targets, { dayOver, ffmKg, exerciseKcal });

  const setBar = (fillId, valueId, pct, text, state) => {
    const fill = $(fillId);
    fill.style.width = `${Math.min(100, pct)}%`;
    fill.classList.toggle('over', state === 'over');
    fill.classList.toggle('done', state === 'done');
    $(valueId).textContent = text;
  };

  setBar('#proteinFill', '#proteinValue', a.proteinPct,
    `${Math.round(totals.protein)} / ${targets.protein}g`,
    totals.protein >= targets.protein ? 'done' : '');
  // 達成率は下限(kcalMin)基準・100%頭打ち。表示も範囲で出す。
  // 「/1800」だと1800が目標に見え、このユーザーが最も避けたい「もっと減らそう」方向に効く
  setBar('#kcalFill', '#kcalValue', a.kcalPct,
    `${Math.round(totals.kcal)} / ${targets.kcalMin}〜${targets.kcalMax}`,
    totals.kcal > targets.kcalMax ? 'over' : (totals.kcal >= targets.kcalMin ? 'done' : ''));
  // targets.alcoholMl が0(禁酒目標)だと 0/0 が NaN になり、幅が Infinity%/NaN% に
  // 化ける。目標0のときは「1mlでも飲んだら100%」として扱う。
  // バーの幅・over/done判定は既存どおり targets.alcoholMl(ml)基準のまま変えない
  // (設定タブの目標入力・achievement()のalcoholOver判定を変更せずに済ませるため)。
  // 表示するテキストだけを、全ての飲酒ガイドラインが使う単位である純アルコール(g)に
  // 変換する(js/micronutrients.js の alcoholGrams、dayTotals が totals.alcoholG として
  // 計算済み)。20g(500ml・5%)を「危険」と煽らないよう、ここでは数値だけを淡々と示す。
  const alcoholPct = targets.alcoholMl > 0
    ? (totals.alcoholMl / targets.alcoholMl) * 100
    : (totals.alcoholMl > 0 ? 100 : 0);
  setBar('#alcoholFill', '#alcoholValue',
    alcoholPct,
    `${Math.round(totals.alcoholG)}g（${totals.alcoholMl}ml）`,
    a.alcoholOver ? 'over' : '');

  const warningsHtml = a.warnings.map((w) => `<div class="warn ${w.level}">${w.message}</div>`);

  // 脂質・炭水化物はタンパク質・カロリーと違って「死守」する数値ではないため、
  // 同じ太さのバーをもう2本増やさない(このタブは筋トレの合間に見る前提の画面で、
  // 管理する数値を2つだけに絞ってあるという設計そのものを薄めてしまう)。
  // ここでは値だけを小さく・muted色で添える二次的な行にする(js/energy.js の
  // macroTargets 参照)。
  const macro = computeMacroTargets(profile, body, weightForExercise, exerciseKcal, ffmKg);
  renderMacroSecondary(totals, macro);
  if (macro && macro.status === 'energyTooLow') {
    warningsHtml.push(`<div class="warn danger">${esc(macro.notes[macro.notes.length - 1] ?? 'カロリー目標が低すぎて炭水化物の目安を満たせません。設定タブで詳細を確認してください。')}</div>`);
  }

  $('#warnings').innerHTML = warningsHtml.join('');
}

/**
 * PFC目標(js/energy.js の macroTargets)を計算する。energyKcal には targets.kcalMin
 * (このアプリが「最低限ここまでは食べる」としている値)を使う。inDeficit は
 * 推定維持カロリー(js/energy.js の estimateMaintenance)と比べて、kcalMinがそれを
 * 下回っていれば赤字期とみなす。維持カロリーが分からない(データ不足)場合は、
 * 赤字だと決めつけない(inDeficit: false)。誤って赤字扱いにすると、タンパク質が
 * 2.8×FFMまで引き上がり、炭水化物のトリップワイヤーに不要に引っかかりやすくなるため。
 * ffmKg/weightKgが無効ならmacroTargetsはnullを返す(呼び出し側は「計算不能」を表示すること)。
 */
export function computeMacroTargets(profile, body, weightForExercise, exerciseKcal, ffmKg) {
  const targets = profile.targets;
  const meals = store.get('meals');
  const equationEstimate = equationMaintenanceEstimate({
    ffmKg,
    weightKg: profile.weight,
    heightM: profile.height / 100,
    ageYears: profile.age,
    isMale: profile.sex === 'male',
    exerciseKcalPerDay: exerciseKcal
  });
  const maintenance = estimateMaintenance(meals, body, todayStr(), equationEstimate);
  const inDeficit = Number.isFinite(maintenance.kcal) && targets.kcalMin < maintenance.kcal;
  return macroTargets({ energyKcal: targets.kcalMin, ffmKg, weightKg: weightForExercise, inDeficit });
}

/**
 * 脂質・炭水化物の二次表示。未計測データは「0g」ではなく不明であることを示す。
 * その日まだ何も記録が無い(totals.kcalが0)場合は achievement() の「食べなさすぎ」判定と
 * 同じ約束で「まだ記録していないだけ」の状態とみなし、"0g+" ではなく "--" にする
 * (0gという実測値に見せない・未記録という状態自体をさらに紛らわしくしない、の両方を満たす)。
 * 一部の品目だけデータが無い(記録はあるが過小合計)場合は "Ng+" とアスタリスクで示す。
 */
function renderMacroSecondary(totals, macro) {
  const el = $('#macroSecondary');
  if (!el) return;
  const fatTarget = macro ? Math.round(macro.fatG) : null;
  const carbTarget = macro ? Math.round(macro.carbG) : null;
  const noRecordYet = totals.kcal === 0;

  const unknownMark = (label) =>
    `<span class="macro-unknown" title="${label}のデータが無い品目が含まれています(実測ではありません)">*</span>`;

  const fatText = totals.fatKnown
    ? `${Math.round(totals.fat)}g`
    : noRecordYet ? '--' : `${Math.round(totals.fat)}g+ ${unknownMark('脂質')}`;
  const carbText = totals.carbKnown
    ? `${Math.round(totals.carb)}g`
    : noRecordYet ? '--' : `${Math.round(totals.carb)}g+ ${unknownMark('炭水化物')}`;

  el.innerHTML = `
    <span>脂質 ${fatText}${fatTarget !== null ? ` / ${fatTarget}g` : ''}</span>
    <span>炭水化物 ${carbText}${carbTarget !== null ? ` / ${carbTarget}g` : ''}</span>`;
}

// --- 参考栄養素(食物繊維・ビタミンD・カルシウム・食塩相当量・純アルコール) ---
//
// js/micronutrients.js 参照: この5項目はタンパク質・カロリー(死守2項目)は
// もちろん、脂質・炭水化物(二次表示)よりもさらに軽い「三次」表示にする。
// ステータスバー(#statusBar)にこれ以上バーや行を積み増すと、筋トレの合間に
// 一瞬だけ見る画面という設計そのものが壊れる。そのため、食事を記録・確認しに
// 来ている食事タブ側にだけ、進捗バー無し・muted文字の小さなカードとして置く
// (js/energy.jsのEAカードをrecordTabに置いたのと同様、"見たい人だけが見る"場所)。

/** 未計測データは「0」ではなく不明であることを示す(renderMacroSecondaryと同じ約束) */
function microValueText(known, value, unit, noRecordYet, label) {
  if (known) return `${Math.round(value * 10) / 10}${unit}`;
  if (noRecordYet) return '--';
  return `${Math.round(value * 10) / 10}${unit}+ <span class="macro-unknown" title="${esc(label)}のデータが無い品目が含まれています(実測ではありません)">*</span>`;
}

// ALDH2(アルコール分解酵素)フラッシング質問への回答が「はい」のときに一度だけ出す注記。
// 出典・数字はここに固定しておく(呼び出し側で文言をいじって誇張/矮小化しないため)。
// 84.8%/82.3%はフラッシング質問のALDH2不活性型に対する感度/特異度、Yokoyama 2003・
// Brooks 2009は少量〜中等量の飲酒でも食道扁平上皮癌リスクが上がるとする報告。
// 「診断ではない」「あくまで目安」「判断は本人に委ねる」の3点を必ず含め、危険を
// 煽る言い回し(「危険です」「やめるべきです」等)は使わない。
export const ALDH2_YES_NOTICE =
  '「顔が赤くなる」体質は、アルコールを分解する酵素ALDH2の働きが弱いことと関連があるとされています。' +
  'この体質では、少量〜中等量の飲酒でも食道がんのリスクが高まるという報告があります' +
  '(Yokoyama et al. 2003; Brooks et al. 2009)。このアンケートはALDH2の状態を確定する検査ではなく、' +
  'あくまで目安(感度84.8%・特異度82.3%程度)です。診断ではありません。' +
  '今後の飲酒量をどうするかは、あなた自身の判断です。';

function renderMicroCard(totals, profile) {
  const el = $('#microSecondary');
  const alcoholEl = $('#alcoholNote');
  const aldh2El = $('#aldh2Area');
  if (!el || !alcoholEl || !aldh2El) return;

  const targets = microTargetsForAge(profile.age);
  const noRecordYet = totals.kcal === 0;

  el.innerHTML = `
    <span>食物繊維 ${microValueText(totals.fibreKnown, totals.fibre, 'g', noRecordYet, '食物繊維')} / ${targets.fibreG}g</span>
    <span>ビタミンD ${microValueText(totals.vitaminDKnown, totals.vitaminD, 'µg', noRecordYet, 'ビタミンD')} / ${targets.vitaminDUg}µg</span>
    <span>カルシウム ${microValueText(totals.calciumKnown, totals.calcium, 'mg', noRecordYet, 'カルシウム')} / ${targets.calciumMg}mg</span>
    <span>食塩相当量 ${microValueText(totals.saltKnown, totals.salt, 'g', noRecordYet, '食塩相当量')} （目標 ${targets.saltG}g未満）</span>`;

  // 純アルコールの文脈: 「危険」ではなく「1日の予算の中で一番手軽に取り戻せる分」として
  // 見せる(ブリーフの指示通り、20gをdangerとして煽らない)。alcoholKcalは実際に記録された
  // アルコール品目のkcal(js/nutrition.js の dayTotals)から計算し、220kcalのような
  // 決め打ちの数字は使わない。
  if (totals.alcoholMl > 0) {
    const pctOfBudget = profile.targets.kcalMin > 0
      ? Math.round((totals.alcoholKcal / profile.targets.kcalMin) * 100)
      : null;
    alcoholEl.innerHTML = `純アルコール ${Math.round(totals.alcoholG)}g（${totals.alcoholMl}ml・約${Math.round(totals.alcoholKcal)}kcal）` +
      (pctOfBudget !== null ? ` — 1日の目安(${profile.targets.kcalMin}kcal)の約${pctOfBudget}%。ここが一番手軽に取り戻せるカロリーです` : '');
  } else {
    alcoholEl.innerHTML = noRecordYet ? '' : '純アルコール 0g';
  }

  aldh2El.innerHTML = renderAldh2Area(profile);
}

/** ALDH2フラッシング質問(未回答なら1回だけ)、または「はい」回答時の注記(未クローズなら) */
function renderAldh2Area(profile) {
  if (profile.aldh2Flushing == null) {
    return `
      <div class="ex" id="aldh2Question">
        <div class="muted">お酒を飲むと顔が赤くなりますか？（一度だけお聞きします。あとで設定タブから回答を変更できます）</div>
        <div class="chips" style="margin-top:6px">
          <button data-aldh2-answer="yes">はい</button>
          <button data-aldh2-answer="no">いいえ</button>
          <button data-aldh2-answer="skipped">あとで</button>
        </div>
      </div>`;
  }
  if (profile.aldh2Flushing === 'yes' && !profile.aldh2NoticeDismissed) {
    return `
      <div class="warn info" id="aldh2Notice">
        ${esc(ALDH2_YES_NOTICE)}
        <div style="margin-top:6px"><button data-aldh2-dismiss>閉じる</button></div>
      </div>`;
  }
  return '';
}

function answerAldh2Question(answer) {
  const profile = store.get('profile');
  try {
    store.set('profile', applyAldh2Answer(profile, answer));
  } catch {
    toast('保存できませんでした（端末の空き容量を確認してください）');
    return;
  }
  renderMealTab();
}

function dismissAldh2Notice() {
  const profile = store.get('profile');
  try {
    store.set('profile', { ...profile, aldh2NoticeDismissed: true });
  } catch {
    toast('保存できませんでした（端末の空き容量を確認してください）');
    return;
  }
  renderMealTab();
}

/** ワンタップで1品追加する。食品の使用回数も増やして並び順を育てる */
export function addFoodById(foodId) {
  const food = store.get('foods').find((f) => f.id === foodId);
  if (!food) return;
  // useCount は addItems（=再描画を含む）より先に更新する。
  // 先に addItems を呼んでしまうと、押した食品が上位に来るのが次の描画まで
  // 遅れてしまい、「よく食べるものが1タップで届く位置に来る」という
  // このタブの存在意義そのものが体感で1回遅れて壊れる。
  store.set('foods', bumpFoodUse(store.get('foods'), foodId));
  // food.fat/food.carb/food.fibre/food.vitaminD/food.calcium/food.salt はシード食品
  // (data/foods.json)やOCR経由で登録された食品にはあるが、旧バージョンで登録済みの
  // バーコード食品(js/main.js の foodsMacroSyncedV1/foodsMicroSyncedV1 移行の対象外)
  // には無いことがある。無い場合はプロパティごと省略し、undefinedを明示的な0として
  // 保存しない(js/nutrition.js の dayTotals が「不明」として扱えるようにするため)。
  const item = { name: food.name, kcal: food.kcal, protein: food.protein, alcoholMl: food.alcoholMl ?? 0 };
  if (food.fat !== undefined) item.fat = food.fat;
  if (food.carb !== undefined) item.carb = food.carb;
  if (food.fibre !== undefined) item.fibre = food.fibre;
  if (food.vitaminD !== undefined) item.vitaminD = food.vitaminD;
  if (food.calcium !== undefined) item.calcium = food.calcium;
  if (food.salt !== undefined) item.salt = food.salt;
  if (food.alcoholAbvPct !== undefined) item.alcoholAbvPct = food.alcoholAbvPct;
  const saved = addItems([item], 'tap');
  // addItems が保存失敗のtoastを既に出している場合、ここで成功toastを重ねて
  // 上書きしてしまうと「保存できませんでした」が一瞬で消え、実際には保存されて
  // いないのに追加成功したように見えてしまう。
  if (saved) toast(`${food.name} を追加`);
}

/**
 * 任意の品目群を1回の食事として記録する。保存できたかどうかを呼び出し側に返す。
 * datetime を省略すると従来どおり現在時刻(nowStr())を使う。js/dayView.js は
 * 過去日の食事を「朝/昼/夜」の固定時刻付きで記録するため、明示的な datetime
 * ('YYYY-MM-DDTHH:MM')を渡せるようにしている。時刻を落として日付だけにしないのは、
 * js/game.js の initialPhaseStatus が「11時より前の摂取だけを朝プロテインとして
 * 数える」という時刻依存の判定をしているため。
 */
export function addItems(items, source, datetime) {
  const meals = store.get('meals');
  meals.push({ id: newId('m'), datetime: datetime ?? nowStr(), items, source });
  try {
    store.set('meals', meals);
  } catch {
    toast('保存できませんでした（端末の空き容量を確認してください）');
    return false;
  }
  renderStatusBar();
  renderMealTab();
  return true;
}

export function renderMealTab() {
  const foods = sortFoodsByUse(store.get('foods'));
  const today = todayStr();
  // meals は importAll や手編集されたバックアップ経由で datetime/items を欠いた
  // 壊れたレコードが混ざりうる境界のデータ。ここで弾かないと1件の壊れたレコードで
  // #tab-meal 全体が空白のまま復旧できなくなる(js/nutrition.js の dayTotals と同じ方針)。
  const meals = store.get('meals')
    .filter((m) => m && typeof m.datetime === 'string' && Array.isArray(m.items))
    .filter((m) => m.datetime.startsWith(today));

  $('#tab-meal').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">ワンタップ登録</h2>
      <div class="chips" id="foodChips">
        ${foods.map((f) => `<button data-food="${f.id}">${esc(f.name)}<br><span class="muted">${f.kcal}kcal / P${f.protein}g</span></button>`).join('')}
      </div>
      <div class="chips" style="margin-top:8px">
        <button id="btnBarcode">${icon('i-camera')} バーコード</button>
        <button id="btnPhoto">${icon('i-camera')} 食事写真</button>
        <button id="btnReceipt">${icon('i-bowl')} レシート</button>
        <button id="btnManual">手入力</button>
      </div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">今日の記録</h2>
      ${meals.length === 0 ? '<p class="muted">まだ記録がありません</p>' : ''}
      ${meals.map((m) => `
        <div class="ex">
          <div class="ex-head">
            <span>${m.datetime.slice(11)}</span>
            <button data-del="${m.id}">削除</button>
          </div>
          ${m.items.map((i) => `<div class="muted">${esc(i.name)} — ${i.kcal}kcal / P${i.protein}g</div>`).join('')}
        </div>`).join('')}
    </div>
    <div class="card">
      <h2 style="margin-top:0">参考栄養素</h2>
      <div class="micro-secondary" id="microSecondary"></div>
      <div class="muted" id="alcoholNote" style="margin-top:6px"></div>
      <div id="aldh2Area"></div>
    </div>`;

  $('#foodChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-food]');
    if (btn) addFoodById(btn.dataset.food);
  });

  // #tab-meal は再描画されても要素自体は残るため、addEventListener だと
  // 描画のたびにハンドラが積み重なる。onclick 代入で常に1つに保つ
  $('#tab-meal').onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      store.set('meals', store.get('meals').filter((m) => m.id !== del.dataset.del));
      renderStatusBar();
      renderMealTab();
      return;
    }
    const aldh2Btn = e.target.closest('[data-aldh2-answer]');
    if (aldh2Btn) {
      answerAldh2Question(aldh2Btn.dataset.aldh2Answer);
      return;
    }
    if (e.target.closest('[data-aldh2-dismiss]')) {
      dismissAldh2Notice();
    }
  };

  renderMicroCard(dayTotals(store.get('meals'), today), store.get('profile'));

  $('#btnManual').addEventListener('click', openManualDialog);

  const barcodeBtn = $('#btnBarcode');
  if (!isBarcodeSupported()) {
    barcodeBtn.classList.add('hidden');
  } else {
    barcodeBtn.addEventListener('click', scanBarcode);
  }

  // ボタンを disabled + title で無効化すると、タッチ操作ではツールチップが出ず
  // 「押しても反応しない」だけに見え、機能の存在自体が発見できない。キー未設定
  // （既定の状態）でも常にタップは受け付け、押した瞬間に機能の説明とキーが
  // 必要なことを伝える（設定タブへの案内までがこの画面の責務。キーの入力・
  // 発行はここでは行わない）。無言で何も起きない、は避ける。
  const hasKey = Boolean(store.get('settings').geminiKey);
  const FEATURE_INFO = {
    meal: '食事の写真から品目・カロリー・タンパク質を自動で読み取る機能です。',
    receipt: 'レシートの写真から飲食物の品目を自動で読み取る機能です。'
  };
  for (const [id, kind] of [['#btnPhoto', 'meal'], ['#btnReceipt', 'receipt']]) {
    const btn = $(id);
    btn.addEventListener('click', () => {
      if (!hasKey) {
        alert(`${FEATURE_INFO[kind]}設定タブでGemini APIキーを登録すると使えます。`);
        return;
      }
      pickAndAnalyze(kind);
    });
  }
}

/**
 * 品目名・カロリー・タンパク質の3値を1画面で入力するインラインフォーム。
 * 汗ばんだ手で立ったまま操作する前提では、OSのprompt()を3連続で出す方式は
 * フォーカスが途中で外れると入力し直しになる（3つ目までいって初めて気付く）。
 * その場に留まったまま全項目を見渡して直せるカードに置き換える。
 *
 * 入力はここでは esc() しない: innerHTML に書き戻すのは自分自身の固定マークアップ
 * だけで、ユーザーが打った文字列は .value を読み取って呼び出し側に渡すだけ
 * （esc() が必要なのは innerHTML に注入する時点であり、ここでは発生しない）。
 * onSave はレコードの組み立てと保存を呼び出し側の責務として残す(mealTab.js内の
 * 通常の手入力と、未登録バーコードのマイメニュー登録とで保存先が異なるため)。
 */
function openItemForm({ title, nameLabel = '品目名', onSave }) {
  const dialog = document.createElement('div');
  dialog.className = 'card';
  dialog.innerHTML = `
    <h2 style="margin-top:0">${esc(title)}</h2>
    <div class="ex-ctrl"><input type="text" id="ifName" placeholder="${esc(nameLabel)}" style="flex:1"></div>
    <div class="ex-ctrl">カロリー <input type="number" inputmode="numeric" id="ifKcal" value="0" style="width:90px">kcal</div>
    <div class="ex-ctrl">タンパク質 <input type="number" inputmode="decimal" id="ifProtein" value="0" style="width:90px">g</div>
    <div class="ex-ctrl">脂質 <input type="number" inputmode="decimal" id="ifFat" value="0" style="width:90px">g</div>
    <div class="ex-ctrl">炭水化物 <input type="number" inputmode="decimal" id="ifCarb" value="0" style="width:90px">g</div>
    <div class="chips">
      <button id="ifSave" class="primary">保存</button>
      <button id="ifCancel">やめる</button>
    </div>`;
  $('#tab-meal').prepend(dialog);

  // このダイアログは開くたびに新しく作る使い捨てのDOMなので addEventListener でよい
  // (onclick代入が必要なのは再描画をまたいで生き続けるコンテナだけ)。
  dialog.querySelector('#ifCancel').addEventListener('click', () => dialog.remove());
  dialog.querySelector('#ifSave').addEventListener('click', () => {
    const name = dialog.querySelector('#ifName').value.trim();
    if (!name) {
      toast('品目名を入力してください');
      return;
    }
    const kcal = Number(dialog.querySelector('#ifKcal').value);
    const protein = Number(dialog.querySelector('#ifProtein').value);
    const fat = Number(dialog.querySelector('#ifFat').value);
    const carb = Number(dialog.querySelector('#ifCarb').value);
    if ([kcal, protein, fat, carb].some((n) => Number.isNaN(n))) {
      toast('数値が読めませんでした');
      return;
    }
    dialog.remove();
    onSave({ name, kcal, protein, fat, carb });
  });
}

function openManualDialog() {
  openItemForm({
    title: '手入力',
    onSave: ({ name, kcal, protein, fat, carb }) => addItems([{ name, kcal, protein, fat, carb }], 'manual')
  });
}

/** バーコードを読み、未知の商品は1回だけ手入力してマイメニューに育てる */
async function scanBarcode() {
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  let mediaStream;
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch {
    toast('カメラを使えません');
    return;
  }
  video.srcObject = mediaStream;
  await video.play();

  const stage = document.createElement('div');
  stage.className = 'card photo-stage';
  stage.appendChild(video);
  $('#tab-meal').prepend(stage);
  toast('バーコードをかざしてください');

  const jan = await scanJan(video);
  mediaStream.getTracks().forEach((t) => t.stop());
  stage.remove();

  if (!jan) {
    toast('読み取れませんでした');
    return;
  }

  const hit = await lookupJan(jan, store.get('foods'), store.get('settings').useOpenFoodFacts);
  if (hit) {
    if (hit.source === 'openfoodfacts') {
      store.set('foods', [...store.get('foods'), hit.food]);
    }
    addFoodById(hit.food.id);
    return;
  }

  openItemForm({
    title: `未登録の商品です（${jan}）`,
    nameLabel: '品名（次回から自動登録されます）',
    onSave: ({ name, kcal, protein, fat, carb }) => {
      const food = { id: `jan_${jan}`, jan, name, unit: '個', kcal, protein, fat, carb, useCount: 0 };
      store.set('foods', [...store.get('foods'), food]);
      addFoodById(food.id);
    }
  });
}

/** 写真をGeminiに送って品目を推定し、必ず確認画面を挟んでから保存する */
async function pickAndAnalyze(kind) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.capture = 'environment';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    toast('解析中...');
    const apiKey = store.get('settings').geminiKey;
    try {
      const items = kind === 'meal'
        ? await analyzeMealPhoto(file, apiKey)
        : await analyzeReceipt(file, apiKey);
      confirmItems(items, kind === 'meal' ? 'photo' : 'receipt');
    } catch (err) {
      // 解析に失敗しても記録を落とさない。手入力に必ず落とす
      toast(err instanceof OcrError ? err.message : '解析に失敗しました');
      openManualDialog();
    }
  });
  input.click();
}

/** AIの推定値をそのまま保存せず、チェックと修正を挟む */
function confirmItems(items, source) {
  const dialog = document.createElement('div');
  dialog.className = 'card';
  dialog.innerHTML = `
    <h2 style="margin-top:0">確認して保存</h2>
    <p class="muted">推定値です。違っていれば数値を直してから保存してください。</p>
    ${items.map((i, idx) => `
      <div class="ex">
        <label><input type="checkbox" data-pick="${idx}" checked> ${esc(i.name)}</label>
        <div class="ex-ctrl">
          <input type="number" inputmode="numeric" data-kcal="${idx}" value="${i.kcal}" style="width:80px"> kcal
          <input type="number" inputmode="decimal" data-protein="${idx}" value="${i.protein}" style="width:70px"> gP
          <input type="number" inputmode="decimal" data-fat="${idx}" value="${i.fat ?? 0}" style="width:70px"> gF
          <input type="number" inputmode="decimal" data-carb="${idx}" value="${i.carb ?? 0}" style="width:70px"> gC
          ${Number(i.alcoholMl) > 0 ? `<input type="number" inputmode="numeric" data-alcohol="${idx}" value="${i.alcoholMl}" style="width:70px"> mL` : ''}
        </div>
        <div class="ex-ctrl muted" style="font-size:11px">
          食物繊維<input type="number" inputmode="decimal" data-fibre="${idx}" value="${i.fibre ?? 0}" style="width:50px"> g
          ビタミンD<input type="number" inputmode="decimal" data-vitamind="${idx}" value="${i.vitaminD ?? 0}" style="width:50px"> µg
          カルシウム<input type="number" inputmode="decimal" data-calcium="${idx}" value="${i.calcium ?? 0}" style="width:55px"> mg
          食塩<input type="number" inputmode="decimal" data-salt="${idx}" value="${i.salt ?? 0}" style="width:50px"> g
        </div>
      </div>`).join('')}
    <div class="chips">
      <button id="btnOcrSave" class="primary">保存</button>
      <button id="btnOcrCancel">やめる</button>
    </div>`;
  $('#tab-meal').prepend(dialog);

  dialog.querySelector('#btnOcrCancel').addEventListener('click', () => dialog.remove());
  dialog.querySelector('#btnOcrSave').addEventListener('click', () => {
    const picked = items
      .map((i, idx) => {
        const alcoholInput = dialog.querySelector(`[data-alcohol="${idx}"]`);
        return {
          ...i,
          kcal: Number(dialog.querySelector(`[data-kcal="${idx}"]`).value) || 0,
          protein: Number(dialog.querySelector(`[data-protein="${idx}"]`).value) || 0,
          fat: Number(dialog.querySelector(`[data-fat="${idx}"]`).value) || 0,
          carb: Number(dialog.querySelector(`[data-carb="${idx}"]`).value) || 0,
          fibre: Number(dialog.querySelector(`[data-fibre="${idx}"]`).value) || 0,
          vitaminD: Number(dialog.querySelector(`[data-vitamind="${idx}"]`).value) || 0,
          calcium: Number(dialog.querySelector(`[data-calcium="${idx}"]`).value) || 0,
          salt: Number(dialog.querySelector(`[data-salt="${idx}"]`).value) || 0,
          alcoholMl: alcoholInput ? Number(alcoholInput.value) || 0 : (Number(i.alcoholMl) || 0),
          checked: dialog.querySelector(`[data-pick="${idx}"]`).checked
        };
      })
      .filter((i) => i.checked)
      .map(({ checked, ...rest }) => rest);

    if (picked.length === 0) {
      toast('品目が選ばれていません');
      return;
    }
    dialog.remove();
    // 画像そのものは保存しない。抽出結果のテキストだけを残す
    addItems(picked, source);
  });
}
