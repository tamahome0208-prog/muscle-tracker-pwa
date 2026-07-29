import { $, onShow, toast, todayStr, nowStr } from './ui.js';
import { dayTotals, achievement, sortFoodsByUse, bumpFoodUse } from './nutrition.js';

let store;

export function initMealTab(s) {
  store = s;
  onShow('meal', renderMealTab);
  renderStatusBar();
}

/** 上部の死守2項目バーを更新する。食事を追加するたびに呼ぶ */
export function renderStatusBar() {
  const targets = store.get('profile').targets;
  const totals = dayTotals(store.get('meals'), todayStr());
  const a = achievement(totals, targets);

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
  setBar('#alcoholFill', '#alcoholValue',
    (totals.alcoholMl / targets.alcoholMl) * 100,
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
  addItems([{ name: food.name, kcal: food.kcal, protein: food.protein, alcoholMl: food.alcoholMl ?? 0 }], 'tap');
  store.set('foods', bumpFoodUse(store.get('foods'), foodId));
  toast(`${food.name} を追加`);
}

/** 任意の品目群を1回の食事として記録する */
export function addItems(items, source) {
  const meals = store.get('meals');
  meals.push({ id: `m${Date.now()}`, datetime: nowStr(), items, source });
  store.set('meals', meals);
  renderStatusBar();
  renderMealTab();
}

export function renderMealTab() {
  const foods = sortFoodsByUse(store.get('foods'));
  const today = todayStr();
  const meals = store.get('meals').filter((m) => m.datetime.startsWith(today));

  $('#tab-meal').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">ワンタップ登録</h2>
      <div class="chips" id="foodChips">
        ${foods.map((f) => `<button data-food="${f.id}">${f.name}<br><span class="muted">${f.kcal}kcal / P${f.protein}g</span></button>`).join('')}
      </div>
      <div class="chips" style="margin-top:8px">
        <button id="btnBarcode">📷 バーコード</button>
        <button id="btnPhoto">🍱 食事写真</button>
        <button id="btnReceipt">🧾 レシート</button>
        <button id="btnManual">✏️ 手入力</button>
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
          ${m.items.map((i) => `<div class="muted">${i.name} — ${i.kcal}kcal / P${i.protein}g</div>`).join('')}
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
}

function openManualDialog() {
  const name = prompt('品目名');
  if (!name) return;
  const kcal = Number(prompt('カロリー(kcal)', '0'));
  const protein = Number(prompt('タンパク質(g)', '0'));
  if (Number.isNaN(kcal) || Number.isNaN(protein)) {
    toast('数値が読めませんでした');
    return;
  }
  addItems([{ name, kcal, protein }], 'manual');
}
