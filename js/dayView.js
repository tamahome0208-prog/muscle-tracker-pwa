import { $, esc, toast, showTab } from './ui.js';
import { recomputeGame } from './game.js';
import { bodyweightAsOf } from './body.js';
import { startSession } from './workoutTab.js';
import { addItems } from './mealTab.js';

// 日付ビュー(カレンダーの1マスをタップして開く、選んだ日の記録一覧)。
// stage 1 の対象はトレーニングと食事のみ。バドミントン・体組成・写真は
// stage 2 で追加する前提でここには手を付けない(削除ボタンも置かない)。

let store;
let onBack = null; // 「カレンダーに戻る」で呼ぶ、呼び出し元(recordTab)の再描画関数
let currentDate = null;

export function initDayView(s) {
  store = s;
}

// 朝/昼/夜の固定時刻。時刻ピッカーではなくこの3択にするのは、汗ばんだ手で
// 立ったまま操作する前提のため。時刻を落とさないのは、js/game.js の
// initialPhaseStatus が「11時より前の摂取だけを朝プロテインとして数える」という
// 時刻依存の判定をしており、時刻情報が無いと過去日の朝プロテインを正しく
// 数えられなくなるため。
const MEAL_SLOTS = [
  { label: '朝', time: '07:00' },
  { label: '昼', time: '12:00' },
  { label: '夜', time: '19:00' }
];

/** カレンダーの1マスから呼ぶ。backToCalendar は「カレンダーに戻る」ボタンから呼ぶ再描画関数 */
export function renderDayView(date, backToCalendar) {
  currentDate = date;
  onBack = backToCalendar;

  const exercises = store.get('exercises');
  const workouts = store.get('workouts').filter((w) => w && w.date === date);
  // meals は importAll/手編集で datetime や items を欠いた壊れたレコードが
  // 混ざりうる境界のデータ。js/mealTab.js の renderMealTab と同じ方針で弾く。
  const meals = store.get('meals')
    .filter((m) => m && typeof m.datetime === 'string' && Array.isArray(m.items))
    .filter((m) => m.datetime.startsWith(date));

  $('#tab-record').innerHTML = `
    <div class="card">
      <button id="btnBackToCalendar">← カレンダーに戻る</button>
      <h2 style="margin-bottom:0">${esc(date)}</h2>
    </div>
    <div class="card">
      <h2 style="margin-top:0">トレーニング</h2>
      ${workouts.length === 0 ? '<p class="muted">記録はありません</p>' : workouts.map((w) => renderWorkoutCard(w, exercises)).join('')}
      <button data-act="add-workout" class="primary" style="margin-top:8px;width:100%">＋トレーニング</button>
    </div>
    <div class="card">
      <h2 style="margin-top:0">食事</h2>
      ${meals.length === 0 ? '<p class="muted">記録はありません</p>' : meals.map((m) => renderMealCard(m)).join('')}
      <button data-act="add-meal" class="primary" style="margin-top:8px;width:100%">＋食事</button>
    </div>`;

  // #tab-record は record タブとの間で再描画のたびに使い回されるコンテナなので、
  // addEventListener だとタブ往復・削除のたびにハンドラが積み重なる。onclick 代入で1つに保つ。
  $('#tab-record').onclick = onDayViewClick;
}

function renderWorkoutCard(w, exercises) {
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const setsHtml = (w.sets ?? [])
    .map((s) => {
      const name = exMap.get(s.exId)?.name ?? s.exId;
      return `<div class="muted">${esc(name)} ${esc(s.weight)}kg × ${esc(s.reps)}</div>`;
    })
    .join('');
  return `
    <div class="ex" data-workout="${esc(w.id)}">
      <div class="ex-head">
        <span class="ex-name">【${esc(w.program)}】 総挙上量 ${Math.round(Number(w.volume) || 0)}kg</span>
        <button data-del-workout="${esc(w.id)}">削除</button>
      </div>
      ${setsHtml}
    </div>`;
}

function renderMealCard(m) {
  const itemsHtml = (m.items ?? [])
    .map((i) => `<div class="muted">${esc(i?.name)} — ${Number(i?.kcal) || 0}kcal / P${Number(i?.protein) || 0}g</div>`)
    .join('');
  return `
    <div class="ex" data-meal="${esc(m.id)}">
      <div class="ex-head">
        <span>${esc(m.datetime.slice(11))}</span>
        <button data-del-meal="${esc(m.id)}">削除</button>
      </div>
      ${itemsHtml}
    </div>`;
}

function onDayViewClick(e) {
  if (e.target.closest('#btnBackToCalendar')) {
    onBack?.();
    return;
  }
  if (e.target.closest('[data-act="add-workout"]')) {
    // startSession は対象日にその日の記録がすでにあれば確認ダイアログを挟む
    // (js/workoutTab.js の switchProgram の同日重複確認と同じもの)。
    // 断られた場合(false)はタブを切り替えず、この画面に留まる。
    if (startSession(currentDate)) showTab('workout');
    return;
  }
  if (e.target.closest('[data-act="add-meal"]')) {
    openAddMealDialog(currentDate);
    return;
  }
  const delWorkoutBtn = e.target.closest('[data-del-workout]');
  if (delWorkoutBtn) {
    deleteWorkout(delWorkoutBtn.dataset.delWorkout);
    return;
  }
  const delMealBtn = e.target.closest('[data-del-meal]');
  if (delMealBtn) {
    deleteMeal(delMealBtn.dataset.delMeal);
  }
}

/**
 * ワークアウト削除。削除しただけで終わらせず、xp/bests を全履歴から再構築して
 * 保存しなおす(js/game.js の recomputeGame を参照)。これをしないと、例えば
 * 260kgの入力ミスを削除しても自己ベストが260kgのまま永久に残ってしまう。
 *
 * badges は recomputeGame が一切触れない値なのでそのまま引き継ぐ(称号は罰ではないので
 * 記録を消しても取り消さない設計)。streakWeeks/lastWeekKey もここでは変更しない
 * (この2つは finishSession 時にスタンプされる値で、削除時の扱いはstage 1の対象外)。
 */
function deleteWorkout(id) {
  const remaining = store.get('workouts').filter((w) => w?.id !== id);
  try {
    store.set('workouts', remaining);
  } catch {
    toast('削除できませんでした（端末の空き容量を確認してください）');
    return;
  }

  const exercises = store.get('exercises');
  const body = store.get('body');
  const profile = store.get('profile');
  const { xp, bests } = recomputeGame(remaining, exercises, (d) => bodyweightAsOf(body, d, profile));
  const game = store.get('game');
  try {
    store.set('game', { ...game, xp, bests });
  } catch {
    toast('保存できませんでした（端末の空き容量を確認してください）。記録の削除自体は完了しています');
  }

  toast('削除しました');
  renderDayView(currentDate, onBack);
}

function deleteMeal(id) {
  const remaining = store.get('meals').filter((m) => m?.id !== id);
  try {
    store.set('meals', remaining);
  } catch {
    toast('削除できませんでした（端末の空き容量を確認してください）');
    return;
  }
  toast('削除しました');
  renderDayView(currentDate, onBack);
}

function openAddMealDialog(date) {
  const dialog = document.createElement('div');
  dialog.className = 'card';
  dialog.innerHTML = `
    <h2 style="margin-top:0">食事を追加（${esc(date)}）</h2>
    <div class="chips">
      ${MEAL_SLOTS.map((s) => `<button data-slot="${s.time}">${s.label} ${s.time}</button>`).join('')}
    </div>
    <button id="btnCancelAddMeal" style="margin-top:8px;width:100%">やめる</button>`;
  $('#tab-record').prepend(dialog);

  // このダイアログは開くたびに新しく作る使い捨てのDOMなので addEventListener でよい
  // (onclick代入が必要なのは再描画をまたいで生き続けるコンテナだけ)。
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('#btnCancelAddMeal')) {
      dialog.remove();
      return;
    }
    const slotBtn = e.target.closest('[data-slot]');
    if (slotBtn) {
      dialog.remove();
      promptAndAddMeal(date, slotBtn.dataset.slot);
    }
  });
}

/** js/mealTab.js の openManualDialog と同じprompt方式。past-date版として日時を明示する */
function promptAndAddMeal(date, time) {
  const name = prompt('品目名');
  if (!name) return;
  // prompt はキャンセルで null を返す。Number(null) は 0 になり「キャンセル＝0kcalで記録」
  // という意図しない挙動になるため、null は数値変換する前に中断として扱う
  // (js/mealTab.js の openManualDialog と同じガード)。
  const kcalRaw = prompt('カロリー(kcal)', '0');
  if (kcalRaw === null) return;
  const proteinRaw = prompt('タンパク質(g)', '0');
  if (proteinRaw === null) return;
  const kcal = Number(kcalRaw);
  const protein = Number(proteinRaw);
  if (Number.isNaN(kcal) || Number.isNaN(protein)) {
    toast('数値が読めませんでした');
    return;
  }
  const saved = addItems([{ name, kcal, protein }], 'manual', `${date}T${time}`);
  if (saved) {
    toast(`${name} を追加`);
    renderDayView(date, onBack);
  }
}
