import { $, onShow, toast, vibrate, todayStr, newId, esc } from './ui.js';
import { nextProgram, calcVolume, lastSetFor, isPB, updateBests, restorableSession, programStatus } from './workout.js';
import { addWorkoutXp, checkBadges, BADGES, calcStreak } from './game.js';
import { currentBodyweight } from './body.js';

const PROGRAM_NAMES = { A: '胸・肩・三頭', B: '背中・二頭', C: '脚・腹' };
const REST_SECONDS = 90;
const EMPTY_SESSION = { program: null, date: null, sets: [] };

let store;
let session = null; // { program, date, sets: [] }
let timerId = null;

export function initWorkoutTab(s) {
  store = s;
  onShow('workout', renderWorkoutTab);
}

function startSession() {
  const restored = restorableSession(store.get('session'), todayStr());
  if (restored) {
    session = restored;
    return;
  }
  // 古い/壊れたセッションが残っていたら復元せず捨てる。次の✓で新しいセッションが
  // 上書きするので必須ではないが、ここで消しておけば storage 上にも古いデータが
  // 残り続けない。
  if (store.get('session').date) {
    try { store.set('session', EMPTY_SESSION); } catch { /* 消せなくても致命的ではない */ }
  }
  session = { program: nextProgram(store.get('workouts')), date: todayStr(), sets: [] };
}

/** セット記録のたびに呼ぶ。書き込みに失敗しても session はメモリ上に残るので
 * その場のセット自体は失われない(次回の✓や終了時にまた保存を試みる)。 */
function persistSession() {
  try {
    store.set('session', session);
  } catch {
    toast('保存できませんでした（端末の空き容量を確認してください）');
  }
}

export function renderWorkoutTab() {
  if (!session) startSession();
  const exercises = store.get('exercises').filter((e) => e.program === session.program);
  const workouts = store.get('workouts');
  const bests = store.get('game').bests;
  const statuses = programStatus(workouts, todayStr());

  $('#tab-workout').innerHTML = `
    <div class="card">
      <div class="ex-head">
        <div><span class="big">【${session.program}】</span> ${PROGRAM_NAMES[session.program]}</div>
        <button id="btnFinish" class="primary">終了して保存</button>
      </div>
      <div class="chips" id="programChips" style="grid-template-columns:repeat(3,1fr)">
        ${statuses.map((s) => renderProgramChip(s)).join('')}
      </div>
      <div class="muted">今回の総挙上量 <span id="sessionVolume">0</span> kg</div>
    </div>
    <div class="card">
      ${exercises.map((ex) => renderExercise(ex, workouts, bests)).join('')}
    </div>`;

  // 再描画のたびにハンドラが積み重ならないよう onclick 代入にする
  $('#tab-workout').onclick = onExerciseClick;
  $('#btnFinish').addEventListener('click', finishSession);
  updateVolume();
}

function programDaysLabel(status) {
  if (status.daysAgo === null) return '未実施';
  if (status.daysAgo === 0) return '今日';
  return `${status.daysAgo}日前`;
}

function renderProgramChip(status) {
  const selected = status.program === session.program;
  const mark = status.recommended ? '⟳ ' : '';
  return `<button class="${selected ? 'primary' : ''}" data-act="switch-program" data-program="${status.program}">${mark}${status.program} ${programDaysLabel(status)}</button>`;
}

function renderExercise(ex, workouts, bests) {
  const last = lastSetFor(workouts, ex.id);
  // 今回のセッションで既に記録済みのセット（タブ移動しても .done を DOM ではなく
  // session.sets から導出するための元データ）。
  const mySets = session.sets.filter((s) => s.exId === ex.id);
  const doneCount = mySets.length;
  const latestThisSession = mySets[mySets.length - 1];
  // 今回既に1セットでも記録していれば、表示する重量・回数は前回セッションの値ではなく
  // 「今回実際に記録した最後の値」にする。そうしないとタブ往復のたびに前回値へ巻き戻り、
  // 次のセットが意図と違う重量で記録されてしまう。
  const weight = latestThisSession?.weight ?? last?.weight ?? ex.defaultWeight;
  const reps = latestThisSession?.reps ?? last?.reps ?? ex.defaultReps;
  const best = bests[ex.id];
  const hint = best ? `⚡ ${best.weight}kg×${best.reps}を超えると自己ベスト` : '';

  return `
    <div class="ex" data-ex="${ex.id}" data-step="${ex.step}">
      <div class="ex-head">
        <span class="ex-name">${esc(ex.name)}</span>
        <span class="ex-last">${last ? `前回 ${last.weight}×${last.reps}` : '初回'}</span>
      </div>
      ${hint ? `<div class="ex-last pb-hint">${hint}</div>` : ''}
      <div class="ex-ctrl">
        <button data-act="w-">−</button>
        <span class="num" data-field="weight">${weight}</span><span class="muted">kg</span>
        <button data-act="w+">＋</button>
        <button data-act="r-">−</button>
        <span class="num" data-field="reps">${reps}</span><span class="muted">回</span>
        <button data-act="r+">＋</button>
      </div>
      <div class="ex-ctrl">
        ${Array.from({ length: ex.sets }, (_, i) => `<button class="setbtn${i < doneCount ? ' done' : ''}" data-act="set" data-index="${i}">✓</button>`).join('')}
      </div>
    </div>`;
}

/**
 * チップをタップしてプログラムを手動で切り替える。
 * 記録済みのセットが1つでもあれば確認ダイアログを挟む。承諾された場合、
 * 2つのプログラムのセットが1つの記録に混ざって volume / 部位別XP が壊れるのを
 * 防ぐため、既存のセットは保持せず新規プログラムで空セッションから始める。
 * 「保持する」選択肢は意図的に用意しない。
 */
function switchProgram(program) {
  if (program === session.program) return;
  if (session.sets.length > 0) {
    const ok = confirm(`記録済みの${session.sets.length}セットは破棄されます。${program}に切り替えますか？`);
    if (!ok) return;
    clearInterval(timerId);
    $('#timer')?.remove();
  }
  session = { program, date: todayStr(), sets: [] };
  persistSession();
  renderWorkoutTab();
}

function onExerciseClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'switch-program') {
    switchProgram(btn.dataset.program);
    return;
  }
  const row = btn.closest('.ex');
  const exId = row.dataset.ex;
  const step = Number(row.dataset.step) || 2.5;
  const weightEl = row.querySelector('[data-field="weight"]');
  const repsEl = row.querySelector('[data-field="reps"]');

  switch (btn.dataset.act) {
    case 'w+': weightEl.textContent = Number(weightEl.textContent) + step; break;
    case 'w-': weightEl.textContent = Number(weightEl.textContent) - step; break;
    case 'r+': repsEl.textContent = Number(repsEl.textContent) + 1; break;
    case 'r-': repsEl.textContent = Math.max(1, Number(repsEl.textContent) - 1); break;
    case 'set': recordSet(btn, exId, Number(weightEl.textContent), Number(repsEl.textContent)); break;
  }
}

function recordSet(btn, exId, weight, reps) {
  if (btn.classList.contains('done')) return;
  btn.classList.add('done');
  session.sets.push({ exId, weight, reps });
  persistSession();

  const bests = store.get('game').bests;
  if (isPB(bests, exId, weight, reps)) {
    const name = store.get('exercises').find((e) => e.id === exId)?.name ?? '';
    toast(`🏆 自己ベスト更新 ${name} ${weight}kg×${reps}`);
    vibrate([40, 60, 40]);
  }

  updateVolume();
  startRestTimer();
}

function updateVolume() {
  const el = $('#sessionVolume');
  if (!el) return;
  const bodyweight = currentBodyweight(store.get('body'), store.get('profile'));
  el.textContent = Math.round(calcVolume(session.sets, { exercises: store.get('exercises'), bodyweight }));
}

function startRestTimer() {
  clearInterval(timerId);
  let left = REST_SECONDS;
  let el = $('#timer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'timer';
    document.body.appendChild(el);
  }
  el.textContent = `⏱ ${left}`;
  timerId = setInterval(() => {
    left -= 1;
    el.textContent = `⏱ ${left}`;
    if (left <= 0) {
      clearInterval(timerId);
      el.remove();
      vibrate([200, 100, 200]);
    }
  }, 1000);
}

function finishSession() {
  if (session.sets.length === 0) {
    toast('セットが1つも記録されていません');
    return;
  }
  const workouts = store.get('workouts');
  const exercises = store.get('exercises');
  const bodyweight = currentBodyweight(store.get('body'), store.get('profile'));
  const volume = calcVolume(session.sets, { exercises, bodyweight });
  workouts.push({
    id: newId('w'),
    date: session.date,
    program: session.program,
    sets: session.sets,
    volume
  });

  // ここが失敗(QuotaExceededError等)したら session は絶対にnullにしない。
  // メモリ上のセット記録を保持したまま「保存できませんでした」を出し、
  // ユーザーが再度「終了して保存」を押せばやり直せるようにする。
  try {
    store.set('workouts', workouts);
  } catch {
    toast('保存できませんでした（端末の空き容量を確認してください）');
    return;
  }

  const game = store.get('game');
  let bests = game.bests;
  for (const s of session.sets) bests = updateBests(bests, s.exId, s.weight, s.reps, session.date);
  const xp = addWorkoutXp(game.xp, { sets: session.sets }, exercises, bodyweight);
  const streak = calcStreak(workouts, todayStr());

  const earned = checkBadges({
    workouts, body: store.get('body'), streak, xp,
    comparedPhotos: game.badges.includes('photo_compare'),
    badges: game.badges
  });

  // workouts は既に保存済みなので、ここから先が失敗してもトレーニング記録自体は
  // 失われない(称号/XPの更新が反映されないだけ)。session はもう戻す意味が薄い
  // ので通常どおりクリアし、失敗だけ知らせる。
  try {
    store.set('game', { ...game, bests, xp, streakWeeks: streak, badges: [...game.badges, ...earned] });
  } catch {
    toast('保存できませんでした（端末の空き容量を確認してください）。トレーニング記録自体は保存されています');
  }

  for (const id of earned) {
    const badge = BADGES.find((b) => b.id === id);
    if (badge) toast(`🎖 称号解放「${badge.name}」`, 3000);
  }

  clearInterval(timerId);
  $('#timer')?.remove();
  toast(`保存しました（総挙上量 ${Math.round(volume)}kg）`);
  session = null;
  // 終了して保存できたので、復元用に持っていた進行中セッションは消してよい。
  // 消せなくても(容量逼迫等)致命的ではない: date が過去日として扱われれば
  // 次回起動時に restorableSession が古いものとして破棄する。
  try { store.set('session', EMPTY_SESSION); } catch { /* 無視してよい */ }
  renderWorkoutTab();
}
