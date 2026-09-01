import { $, onShow, toast, vibrate, todayStr, newId, esc, icon } from './ui.js';
import {
  nextProgram, calcVolume, lastSetFor, isPB, updateBests, restorableSession, programStatus,
  nextWeightStep, setIndexInSession
} from './workout.js';
import { addWorkoutXp, checkBadges, BADGES, calcStreak } from './game.js';
import { bodyweightAsOf } from './body.js';
import { renderStatusBar } from './mealTab.js';

const PROGRAM_NAMES = { A: '胸・肩・三頭', B: '背中・二頭', C: '脚・腹' };
const REST_SECONDS = 90;
const EMPTY_SESSION = { program: null, date: null, startedAt: null, sets: [], extraExIds: [] };

let store;
let session = null; // { program, date, startedAt, sets: [] }
let timerId = null;
let wakeLock = null; // WakeLockSentinel | null

export function initWorkoutTab(s) {
  store = s;
  onShow('workout', renderWorkoutTab);

  // セット間の90秒待ちのたびに画面が消えて、汗ばんだ手でロック解除する不満を
  // 減らすための Screen Wake Lock。navigator.wakeLock 非対応環境や request() の
  // 拒否は静かに無視する(acquireWakeLock内でcatch済み)。バッテリー消費があるため
  // 設定タブでON/OFFできる(既定ON、js/store.js の settings.wakeLock)。
  //
  // ページが隠れるとブラウザ側でロックが強制解放される仕様のため、再表示時に
  // セッションが進行中ならここで再取得する。逆に隠れる瞬間は明示的に解放しておく
  // (呼ばなくてもブラウザが解放するが、wakeLock変数を確実にnullへ揃えるため)。
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      releaseWakeLock();
    } else if (session) {
      acquireWakeLock();
    }
  });

  // トレーニングタブを離れたら解放する。#tabbar のボタンは初期化時に一度だけ
  // 生成され再描画されないので addEventListener でよい(js/main.js の
  // stopCamera 呼び出しと同じパターン)。
  document.querySelectorAll('#tabbar button').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab !== 'workout') releaseWakeLock();
    });
  });
}

/**
 * navigator.wakeLock が無い環境・request() が拒否される場合(タブが非表示、
 * バッテリーセーバー等)の両方を静かに無視する。ここが例外を投げると
 * セット記録そのものを止めかねないため、try/catchの外に一切ロジックを
 * 漏らさない(呼び出し側は await/結果チェックをせず「投げっぱなし」にできる)。
 */
async function acquireWakeLock() {
  try {
    if (!store.get('settings').wakeLock) return;
    if (!('wakeLock' in navigator)) return;
    if (wakeLock && !wakeLock.released) return; // 既に保持中なら取り直さない
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  try {
    wakeLock?.release();
  } catch {
    /* 解放自体の失敗は無視してよい */
  }
  wakeLock = null;
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
    acquireWakeLock();
    return true;
  }
  // 古い/壊れたセッションが残っていたら復元せず捨てる。次のセット記録で新しいセッションが
  // 上書きするので必須ではないが、ここで消しておけば storage 上にも古いデータが
  // 残り続けない。
  if (store.get('session').date) {
    try { store.set('session', EMPTY_SESSION); } catch { /* 消せなくても致命的ではない */ }
  }
  const targetDate = date ?? today;
  const program = nextProgram(store.get('workouts'));
  if (targetDate !== today && !confirmSameDayDuplicate(targetDate, program)) return false;
  session = { program, date: targetDate, startedAt: today, sets: [], extraExIds: [] };
  acquireWakeLock();
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
 * その場のセット自体は失われない(次回のセット記録や終了時にまた保存を試みる)。 */
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
  const allExercises = store.get('exercises');
  // 今日のプログラムの種目＋利用者が個別に足した種目(session.extraExIds)。
  // 追加種目は今日のプログラムの後ろに、足した順で並べる。
  const extraIds = session.extraExIds ?? [];
  const exercises = [
    ...allExercises.filter((e) => e.program === session.program),
    ...extraIds.map((id) => allExercises.find((e) => e.id === id)).filter(Boolean)
  ];
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
      <button data-act="add-exercise" style="margin-top:12px;width:100%">種目を追加</button>
    </div>`;

  // 再描画のたびにハンドラが積み重ならないよう onclick 代入にする
  $('#tab-workout').onclick = onExerciseClick;
  $('#btnFinish').addEventListener('click', finishSession);
  updateVolume();
}

/**
 * 今日のプログラムに無い種目を選んで追加する。
 *
 * 【なぜ必要か】このアプリは A/B/C を曜日固定せず順送りする設計だが、
 * 「今日はAだが、背中も1種目だけやっておきたい」は実際に起きる。
 * プログラムを切り替えると記録済みのセットが破棄される(switchProgram)ため、
 * 従来はその日のうちに別プログラムの種目を混ぜる手段が無かった。
 *
 * 追加してもワークアウトの program は今日のまま。部位別XPは種目ごとに
 * 部位を引くので(js/game.js の addWorkoutXp)、Bの種目を足せば背中のXPが入る。
 * 「今週何回ジムへ行ったか」の数え方は日付ベースなので影響しない。
 */
function openAddExerciseDialog() {
  const all = store.get('exercises');
  const shown = new Set([
    ...all.filter((e) => e.program === session.program).map((e) => e.id),
    ...(session.extraExIds ?? [])
  ]);
  const candidates = all.filter((e) => !shown.has(e.id));

  const dialog = document.createElement('div');
  dialog.className = 'card';
  dialog.id = 'addExerciseDialog';
  dialog.innerHTML = candidates.length === 0
    ? `<h2 style="margin-top:0">種目を追加</h2>
       <p class="muted">追加できる種目がありません（全種目が今日の一覧に入っています）。</p>
       <button id="btnCancelAddEx" style="width:100%">閉じる</button>`
    : `<h2 style="margin-top:0">種目を追加</h2>
       <p class="muted">今日のプログラム(${esc(session.program)})以外の種目を、この日の記録に足します。今日のプログラム自体は変わりません。</p>
       ${['A', 'B', 'C'].filter((p) => p !== session.program).map((p) => {
         const inProgram = candidates.filter((e) => e.program === p);
         if (inProgram.length === 0) return '';
         return `<div class="muted" style="margin-top:8px">【${esc(p)}】${esc(PROGRAM_NAMES[p])}</div>
           <div class="chips">
             ${inProgram.map((e) => `<button data-add-ex="${esc(e.id)}">${esc(e.name)}</button>`).join('')}
           </div>`;
       }).join('')}
       <button id="btnCancelAddEx" style="margin-top:12px;width:100%">やめる</button>`;

  $('#tab-workout').prepend(dialog);
  dialog.scrollIntoView({ block: 'center' });

  // 使い捨てのDOMなので addEventListener でよい
  dialog.addEventListener('click', (e) => {
    if (e.target.closest('#btnCancelAddEx')) {
      dialog.remove();
      return;
    }
    const btn = e.target.closest('[data-add-ex]');
    if (!btn) return;
    const id = btn.dataset.addEx;
    session.extraExIds = [...(session.extraExIds ?? []), id];
    persistSession();
    dialog.remove();
    const name = store.get('exercises').find((x) => x.id === id)?.name ?? '';
    toast(`${name} を追加しました`);
    renderWorkoutTab();
  });
}

function programDaysLabel(status) {
  if (status.daysAgo === null) return '未実施';
  if (status.daysAgo === 0) return '今日';
  return `${status.daysAgo}日前`;
}

function renderProgramChip(status) {
  const selected = status.program === session.program;
  const mark = status.recommended ? icon('i-rotate') + ' ' : '';
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
  // 絵文字は使わない。金の文字色(.pb-hint)だけで「自己ベストが懸かっている」ことは伝わる
  const hint = best ? `${best.weight}kg×${best.reps} を超えると自己ベスト` : '';

  // 重量の刻み。利用者が種目ごとに選んだ値(profile.stepOverrides)を優先し、
  // 未選択なら data/exercises.json の step を使う。
  const step = weightStepFor(ex);
  // 追加種目(今日のプログラム以外)であることを明示する。どのプログラムから
  // 持ってきたのかが分からないと、記録を見返したときに混乱する。
  const isExtra = ex.program !== session.program;

  return `
    <div class="ex" data-ex="${ex.id}" data-step="${step}">
      <div class="ex-head">
        <span class="ex-name">${esc(ex.name)}${isExtra ? ` <span class="ex-extra">${esc(ex.program)}から追加</span>` : ''}</span>
        <span class="ex-last">${last ? `前回 ${last.weight}×${last.reps}` : '初回'}</span>
      </div>
      ${hint ? `<div class="ex-last pb-hint">${hint}</div>` : ''}
      <div class="ex-ctrl">
        <button data-act="w-" aria-label="${esc(ex.name)} 重量を${step}kg減らす">−</button>
        <span class="num" data-field="weight">${weight}</span><span class="muted">kg</span>
        <button data-act="w+" aria-label="${esc(ex.name)} 重量を${step}kg増やす">＋</button>
        <button data-act="r-" aria-label="${esc(ex.name)} 回数を1減らす">−</button>
        <span class="num" data-field="reps">${reps}</span><span class="muted">回</span>
        <button data-act="r+" aria-label="${esc(ex.name)} 回数を1増やす">＋</button>
      </div>
      <div class="ex-ctrl">
        ${Array.from({ length: ex.sets }, (_, i) => {
          const done = i < doneCount;
          // 記録済みのボタンをもう一度押すと取り消す。誤タップは立ったまま操作する
          // 以上必ず起きるので、確認ダイアログは挟まない(もう一度押せば戻せる)。
          return `<button class="setbtn${done ? ' done' : ''}" data-act="set" data-index="${i}"
            aria-label="${esc(ex.name)} セット${i + 1}を${done ? '取り消す' : '記録する'}"
            aria-pressed="${done}">${icon('i-check')}</button>`;
        }).join('')}
        <button class="stepbtn" data-act="step" aria-label="${esc(ex.name)} 重量の刻みを変更（現在${step}kg）">${step}kg刻み</button>
      </div>
    </div>`;
}

/**
 * この種目の重量±ボタンの刻み(kg)。
 * 利用者が選んだ値(profile.stepOverrides)を優先し、未選択なら種目マスタの step。
 * 壊れた値(0以下・非数値)は種目マスタへフォールバックする。
 */
function weightStepFor(ex) {
  const override = Number(store.get('profile').stepOverrides?.[ex.id]);
  if (Number.isFinite(override) && override > 0) return override;
  return Number(ex.step) || 2.5;
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
  if (btn.dataset.act === 'add-exercise') {
    openAddExerciseDialog();
    return;
  }
  const row = btn.closest('.ex');
  const exId = row.dataset.ex;
  const step = Number(row.dataset.step) || 2.5;
  const weightEl = row.querySelector('[data-field="weight"]');
  const repsEl = row.querySelector('[data-field="reps"]');

  switch (btn.dataset.act) {
    // 重量は0未満にしない。負の重量は calcVolume 側でクランプされるが、
    // 画面に -2.5kg と出ること自体が記録として意味を持たない。
    case 'w+': weightEl.textContent = round2(Number(weightEl.textContent) + step); break;
    case 'w-': weightEl.textContent = round2(Math.max(0, Number(weightEl.textContent) - step)); break;
    case 'r+': repsEl.textContent = Number(repsEl.textContent) + 1; break;
    case 'r-': repsEl.textContent = Math.max(1, Number(repsEl.textContent) - 1); break;
    case 'step': cycleWeightStep(exId, step); break;
    case 'set': toggleSet(btn, exId, Number(weightEl.textContent), Number(repsEl.textContent)); break;
  }
}

/**
 * 1.25kg刻みで足し引きすると 0.1+0.2 と同じ理由で 21.250000000000004 のような
 * 値が出る。表示にも session.sets にも入る数値なので、小数第2位で丸めておく。
 * (0.5 / 1.25 / 2.5 / 5 のどの刻みでも、第2位までで正確に表せる)
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * ✓ボタンの「記録済みかどうか」を表す属性を揃える。
 * aria-label は押したときに何が起きるかを述べる(記録する / 取り消す)。
 */
function setButtonState(btn, done) {
  btn.setAttribute('aria-pressed', String(done));
  const label = btn.getAttribute('aria-label') ?? '';
  btn.setAttribute('aria-label', done
    ? label.replace('を記録する', 'を取り消す')
    : label.replace('を取り消す', 'を記録する'));
}

/** 重量の刻みを次の段階へ。種目ごとに profile.stepOverrides へ覚える */
function cycleWeightStep(exId, current) {
  const profile = store.get('profile');
  const next = nextWeightStep(current);
  try {
    store.set('profile', { ...profile, stepOverrides: { ...profile.stepOverrides, [exId]: next } });
  } catch {
    toast('刻みを保存できませんでした（端末の空き容量を確認してください）');
    return;
  }
  renderWorkoutTab();
}

/**
 * ✓ボタンのタップ。未記録なら記録し、記録済みならその1セットを取り消す。
 *
 * 【なぜ取り消しが要るか】立ったまま汗ばんだ手で操作する以上、誤タップは必ず起きる。
 * 以前は記録済みボタンを押しても何も起こらず、間違えたセットを消す手段が
 * 「終了して保存」してから日付ビューでワークアウトごと削除するしかなかった。
 * 確認ダイアログは挟まない — もう一度押せば戻せる操作に確認を付けると、
 * 本来1タップで済むはずの記録が2タップになる。
 */
function toggleSet(btn, exId, weight, reps) {
  if (btn.classList.contains('done')) {
    undoSet(btn, exId);
    return;
  }
  recordSet(btn, exId, weight, reps);
}

function undoSet(btn, exId) {
  const nth = Number(btn.dataset.index);
  // 「この種目のnth番目」が session.sets の何番目かを引く。
  // ここを取り違えると別の種目のセットを消す(js/workout.js の setIndexInSession)。
  const idx = setIndexInSession(session.sets, exId, nth);
  if (idx === -1) return;
  session.sets.splice(idx, 1);
  persistSession();

  // 取り消したのだから休憩タイマーも止める。押し間違いで始まったタイマーが
  // そのまま90秒動き続けると、次のセットの間隔がずれる。
  clearInterval(timerId);
  removeTimer();

  toast('セットを取り消しました');
  // 表示中の重量・回数は「今回の最後に記録した値」から導出しているため、
  // 取り消し後は再描画して整合させる。
  renderWorkoutTab();
}

function recordSet(btn, exId, weight, reps) {
  if (btn.classList.contains('done')) return;
  btn.classList.add('done');
  // recordSet は1タップの速さを保つため再描画しない。そのぶん、ボタンの状態を
  // 表す属性はここで自分で更新する必要がある。これを忘れると、記録済みなのに
  // 読み上げは「セット2を記録する」のまま残り、押すと実際には取り消される。
  setButtonState(btn, true);
  session.sets.push({ exId, weight, reps });
  persistSession();
  acquireWakeLock(); // 意図的にawaitしない: 失敗・非対応でもセット記録自体は止めない

  const bests = store.get('game').bests;
  if (isPB(bests, exId, weight, reps)) {
    const name = store.get('exercises').find((e) => e.id === exId)?.name ?? '';
    btn.classList.add('pb');
    toast(`自己ベスト更新 ${name} ${weight}kg×${reps}`, 2200, 'pb', 'i-crest');
    vibrate([40, 60, 40]);
  }

  updateVolume();
  startRestTimer();
}

function updateVolume() {
  const el = $('#sessionVolume');
  if (!el) return;
  // バックデート入力のときは「その日時点の体重」を使う。
  // 保存時(finishSession)と同じ基準でなければ、画面の数字と実際に保存される値が食い違う。
  const bodyweight = bodyweightAsOf(store.get('body'), session.date, store.get('profile'));
  el.textContent = Math.round(calcVolume(session.sets, { exercises: store.get('exercises'), bodyweight }));
}

/**
 * #timer の生成と body への 'timer-active' クラス付与をまとめる。
 * このクラスが立っている間、CSS側で body の下側余白を広げてセットボタンの列を
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
  el.innerHTML = `${icon('i-clock')} ${left}`;
  timerId = setInterval(() => {
    left -= 1;
    el.innerHTML = `${icon('i-clock')} ${left}`;
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
  // 「今の体重」ではなく「そのワークアウト日時点の体重」を使う。
  // 日付ビュー(js/dayView.js)から過去日の記録を入れられるため、
  // currentBodyweight だと 3ヶ月前のチンニングを今の体重で計算してしまう。
  // js/workout.js の migrateHistoricalVolume は bodyweightAsOf を使っており、
  // 新規保存と移行済みデータで基準が食い違っていた。
  const bodyweight = bodyweightAsOf(store.get('body'), session.date, store.get('profile'));
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
    if (badge) toast(`称号解放「${badge.name}」`, 3000, '', 'i-crest');
  }

  clearInterval(timerId);
  removeTimer();
  releaseWakeLock();
  toast(`保存しました（総挙上量 ${Math.round(volume)}kg）`);
  session = null;
  // 終了して保存できたので、復元用に持っていた進行中セッションは消してよい。
  // 消せなくても(容量逼迫等)致命的ではない: date が過去日として扱われれば
  // 次回起動時に restorableSession が古いものとして破棄する。
  try { store.set('session', EMPTY_SESSION); } catch { /* 無視してよい */ }
  renderWorkoutTab();
  // トレーニングを保存すると直近7日の運動消費(js/energy.js の dailyExerciseKcal)が
  // 増え、EAフロア(30 × FFM + 運動消費)が上がる。つまり「今日はもっと食べないと
  // いけない」状態に変わったということなので、ステータスバーを描き直して
  // 新しい下限を反映する。ここを呼ばないと、運動した日ほど古い(緩い)フロアの
  // まま表示され続ける。
  renderStatusBar();
}
