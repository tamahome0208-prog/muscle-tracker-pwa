import { $, onShow, toast, vibrate, todayStr, newId } from './ui.js';
import { nextProgram, calcVolume, lastSetFor, isPB, updateBests } from './workout.js';
import { addWorkoutXp, checkBadges, BADGES, calcStreak } from './game.js';

const PROGRAM_NAMES = { A: '胸・肩・三頭', B: '背中・二頭', C: '脚・腹' };
const REST_SECONDS = 90;

let store;
let session = null; // { program, date, sets: [] }
let timerId = null;

export function initWorkoutTab(s) {
  store = s;
  onShow('workout', renderWorkoutTab);
}

function startSession() {
  session = { program: nextProgram(store.get('workouts')), date: todayStr(), sets: [] };
}

export function renderWorkoutTab() {
  if (!session) startSession();
  const exercises = store.get('exercises').filter((e) => e.program === session.program);
  const workouts = store.get('workouts');
  const bests = store.get('game').bests;

  $('#tab-workout').innerHTML = `
    <div class="card">
      <div class="ex-head">
        <div><span class="big">【${session.program}】</span> ${PROGRAM_NAMES[session.program]}</div>
        <button id="btnFinish" class="primary">終了して保存</button>
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

function renderExercise(ex, workouts, bests) {
  const last = lastSetFor(workouts, ex.id);
  const weight = last?.weight ?? ex.defaultWeight;
  const reps = last?.reps ?? ex.defaultReps;
  const best = bests[ex.id];
  const hint = best ? `⚡ ${best.weight}kg×${best.reps}を超えると自己ベスト` : '';

  return `
    <div class="ex" data-ex="${ex.id}" data-step="${ex.step}">
      <div class="ex-head">
        <span class="ex-name">${ex.name}</span>
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
        ${Array.from({ length: ex.sets }, (_, i) => `<button class="setbtn" data-act="set" data-index="${i}">✓</button>`).join('')}
      </div>
    </div>`;
}

function onExerciseClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const row = btn.closest('.ex');
  const exId = row.dataset.ex;
  const step = Number(row.dataset.step);
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
  if (el) el.textContent = Math.round(calcVolume(session.sets));
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
  const volume = calcVolume(session.sets);
  workouts.push({
    id: newId('w'),
    date: session.date,
    program: session.program,
    sets: session.sets,
    volume
  });
  store.set('workouts', workouts);

  const game = store.get('game');
  let bests = game.bests;
  for (const s of session.sets) bests = updateBests(bests, s.exId, s.weight, s.reps, session.date);
  const xp = addWorkoutXp(game.xp, { sets: session.sets }, store.get('exercises'));
  const streak = calcStreak(workouts, todayStr());

  const earned = checkBadges({
    workouts, body: store.get('body'), streak, xp,
    comparedPhotos: game.badges.includes('photo_compare'),
    badges: game.badges
  });

  store.set('game', { ...game, bests, xp, streakWeeks: streak, badges: [...game.badges, ...earned] });

  for (const id of earned) {
    const badge = BADGES.find((b) => b.id === id);
    if (badge) toast(`🎖 称号解放「${badge.name}」`, 3000);
  }

  clearInterval(timerId);
  $('#timer')?.remove();
  toast(`保存しました（総挙上量 ${Math.round(volume)}kg）`);
  session = null;
  renderWorkoutTab();
}
