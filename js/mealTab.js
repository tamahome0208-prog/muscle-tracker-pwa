import { $, onShow, toast, todayStr, nowStr, newId, esc, icon } from './ui.js';
import { dayTotals, achievement, sortFoodsByUse, bumpFoodUse } from './nutrition.js';
import { isBarcodeSupported, scanJan, lookupJan } from './barcode.js';
import { analyzeMealPhoto, analyzeReceipt, OcrError } from './ocr.js';
import { estimateFfmKg, dailyExerciseKcal } from './energy.js';
import { latestBody, currentBodyweight } from './body.js';

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
  // InBody記録が無ければ ffmKg は null になり、achievement() は従来どおり
  // targets.kcalFloor の固定値にフォールバックする。
  const body = store.get('body');
  const latest = latestBody(body);
  const ffmKg = latest ? estimateFfmKg(latest) : null;
  const weightForExercise = currentBodyweight(body, profile);
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
  const alcoholPct = targets.alcoholMl > 0
    ? (totals.alcoholMl / targets.alcoholMl) * 100
    : (totals.alcoholMl > 0 ? 100 : 0);
  setBar('#alcoholFill', '#alcoholValue',
    alcoholPct,
    `${totals.alcoholMl} / ${targets.alcoholMl}ml`,
    a.alcoholOver ? 'over' : '');

  $('#warnings').innerHTML = a.warnings
    .map((w) => `<div class="warn ${w.level}">${w.message}</div>`)
    .join('');
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
  const saved = addItems([{ name: food.name, kcal: food.kcal, protein: food.protein, alcoholMl: food.alcoholMl ?? 0 }], 'tap');
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
    </div>`;

  $('#foodChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-food]');
    if (btn) addFoodById(btn.dataset.food);
  });

  // #tab-meal は再描画されても要素自体は残るため、addEventListener だと
  // 描画のたびにハンドラが積み重なる。onclick 代入で常に1つに保つ
  $('#tab-meal').onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (!del) return;
    store.set('meals', store.get('meals').filter((m) => m.id !== del.dataset.del));
    renderStatusBar();
    renderMealTab();
  };

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
    if (Number.isNaN(kcal) || Number.isNaN(protein)) {
      toast('数値が読めませんでした');
      return;
    }
    dialog.remove();
    onSave({ name, kcal, protein });
  });
}

function openManualDialog() {
  openItemForm({
    title: '手入力',
    onSave: ({ name, kcal, protein }) => addItems([{ name, kcal, protein }], 'manual')
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
    onSave: ({ name, kcal, protein }) => {
      const food = { id: `jan_${jan}`, jan, name, unit: '個', kcal, protein, useCount: 0 };
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
          <input type="number" inputmode="decimal" data-protein="${idx}" value="${i.protein}" style="width:70px"> g
          ${Number(i.alcoholMl) > 0 ? `<input type="number" inputmode="numeric" data-alcohol="${idx}" value="${i.alcoholMl}" style="width:70px"> mL` : ''}
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
