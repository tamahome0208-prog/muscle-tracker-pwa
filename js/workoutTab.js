import { $, onShow, toast, vibrate, todayStr, newId, esc } from './ui.js';
import { nextProgram, calcVolume, lastSetFor, isPB, updateBests, restorableSession, programStatus } from './workout.js';
import { addWorkoutXp, checkBadges, BADGES, calcStreak } from './game.js';
import { currentBodyweight } from './body.js';

const PROGRAM_NAMES = { A: '胸・肩・三頭', B: '背中・二頭', C: '脚・腹' };
const REST_SECONDS = 90;
const EMPTY_SESSION = { program: null, date: null, startedAt: null, sets: [] };

let store;
let session = null; // { program, date, startedAt, sets: [] }
let timerId = null;

export function initWorkoutTab(s) {
  store = s;
  onShow('workout', renderWorkoutTab);
}

/**
 * date は「今回記録する対象の日付」。省略時は今日。日付ビュー(js/dayView.js)から
 * 過去日を渡して呼ぶと、その日付の記録として保存するセッションを開始する。
 * すでに進行中の(今日 startedAt の)セッションがあれば date に関わらずそちらを
 * 優先して復元する(1つのセッションしか同時に持てない設計のため)。
 *
 * 対象日にその日の記録がすでにある場合は、プログラム切り替え時(switchProgram)と
 * 同じ確認ダイアログを挟む。ただし通常の「今日、タブを開いたら自動的に始まる」
 * 経路(date省略)まで確認を挟むと今までの操作感を変えてしまうため、date が
 * 明示的に今日以外を指している場合(=バックデート入力)だけ確認する。
 *
 * 戻り値: 開始(または復元)できたら true。確認で断られた場合は false を返し、
 * 呼び出し側(dayView)はタブを切り替えないこと。
 */
export function startSession(date) {
  const today = todayStr();
  const restored = restorableSession(store.get('session'), today);
  if (restored) {
    session = restored;
    return true;
  }
  // 古い/壊れたセッションが残っていたら復元せず捨てる。次の✓で新しいセッションが
  // 上書きするので必須ではないが、ここで消しておけば storage 上にも古いデータが
  // 残り続けない。
  if (store.get('session').date) {
    try { store.set('session', EMPTY_SESSION); } catch { /* 消せなくても致命的ではない */ }
  }
  const targetDate = date ?? today;
  const program = nextProgram(store.get('workouts'));
  if (targetDate !== today && !confirmSameDayDuplicate(targetDate, program)) return false;
  session = { program, date: targetDate, startedAt: today, sets: [] };
  return true;
}

/**
 * 対象日に同じprogramの記録がすでにあれば確認する。switchProgram の同日重複確認と
 * 同じ文言・同じ判断基準を共有する(1つの確認ダイアログを2箇所が個別に持たない)。
 */
function confirmSameDayDuplicate(date, program) {
  const alreadyLogged = store.get('workouts').some((w) => w?.date === date && w.program === program);
  if (!alreadyLogged) return true;
  const label = date === todayStr() ? '今日' : `${date}に`;
  return confirm(
    `${program}は${label}すでに記録済みです。もう一度${program}を記録すると、同じ日に2件登録されます` +
    `（今週の達成回数などの数え方は日数なので二重には数えませんが、記録自体は増えます）。` +
    `それでも記録しますか？`
  );
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

/** '2026-07-28' → '7月28日'（バックデート時のバナー・確認文言用） */
function formatMonthDay(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

export function renderWorkoutTab() {
  if (!session) {
    // date省略時のstartSessionは常にtrueを返す(バックデートでない限り確認を挟まないため)。
    // それでも念のため false を無視して死んだ画面にしないよう早期returnで守る。
    if (!startSession()) return;
  }
  const exercises = store.get('exercises').filter((e) => e.program === session.program);
  const workouts = store.get('workouts');
  const bests = store.get('game').bests;
  const statuses = programStatus(workouts, todayStr());
  // バックデート入力(対象日が今日でない)であることを常に見える形で示す。
  // これが無いと、過去日の記録のつもりが今日の記録だと誤解されるおそれがある。
  const backdatedBanner = session.date !== todayStr()
    ? `<div class="warn info">${formatMonthDay(session.date)}の記録として保存します</div>`
    : '';

  $('#tab-workout').innerHTML = `
    ${backdatedBanner}
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
 *
 * さらに、切り替え先のプログラムが対象日(session.date。通常は今日、バックデート
 * 入力中はその過去日)にすでに記録済みなら先に確認する(confirmSameDayDuplicate、
 * js/workoutTab.js の startSession と同じ確認を共有する)。
 * 例: Aを終えて自動でBに進んだ直後、忘れたセットを足すつもりで「A 今日」
 * チップを押すと、そのまま終了して同じ日に2件目のA記録ができてしまう。
 * 週の達成回数・gymCount・ストリークは記録数ではなく実施日数で数えるため実害は
 * 抑えてあるが、無自覚に同日2件目を作ること自体は防ぎたいので、ここで先に
 * 状況を名指しして確認する。
 */
function switchProgram(program) {
  if (program === session.program) return;

  if (!confirmSameDayDuplicate(session.date, program)) return;

  if (session.sets.length > 0) {
    const ok = confirm(`記録済みの${session.sets.length}セットは破棄されます。${program}に切り替えますか？`);
    if (!ok) return;
    clearInterval(timerId);
    removeTimer();
  }
  // date/startedAt はそのまま引き継ぐ: バックデート入力中にプログラムを切り替えても
  // 記録対象の日付が今日に巻き戻ってしまわないようにする。
  session = { program, date: session.date, startedAt: session.startedAt, sets: [] };
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
    btn.classList.add('pb');
    toast(`🏆 自己ベスト更新 ${name} ${weight}kg×${reps}`, 2200, 'pb');
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

/**
 * #timer の生成と body への 'timer-active' クラス付与をまとめる。
 * このクラスが立っている間、CSS側で body の下側余白を広げて✓ボタンの列を
 * タイマーバナーの上までスクロールし切れるようにする(css/style.css 参照)。
 * タイマー表示中は #timer 自体に pointer-events:none も付けているので、
 * 万一余白が足りない環境でもタップはタイマーではなくその下の要素に届く。
 */
function startRestTimer() {
  clearInterval(timerId);
  let left = REST_SECONDS;
  let el = $('#timer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'timer';
    document.body.appendChild(el);
  }
  document.body.classList.add('timer-active');
  el.textContent = `⏱ ${left}`;
  timerId = setInterval(() => {
    left -= 1;
    el.textContent = `⏱ ${left}`;
    if (left <= 0) {
      clearInterval(timerId);
      removeTimer();
      vibrate([200, 100, 200]);
    }
  }, 1000);
}

/** #timer を消し、body の 'timer-active' クラスも一緒に外す（startRestTimer 参照） */
function removeTimer() {
  $('#timer')?.remove();
  document.body.classList.remove('timer-active');
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
  removeTimer();
  toast(`保存しました（総挙上量 ${Math.round(volume)}kg）`);
  session = null;
  // 終了して保存できたので、復元用に持っていた進行中セッションは消してよい。
  // 消せなくても(容量逼迫等)致命的ではない: date が過去日として扱われれば
  // 次回起動時に restorableSession が古いものとして破棄する。
  try { store.set('session', EMPTY_SESSION); } catch { /* 無視してよい */ }
  renderWorkoutTab();
}
