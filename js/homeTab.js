import { $, onShow, showTab, toast, todayStr, esc, icon } from './ui.js';
import {
  nextProgram, weeklyVolume, warnsBadmintonAfterLegs, weekKey, previousWeekKey,
  weekFeasibility, daysUntilDetraining
} from './workout.js';
import { calcStreak, isInitialPhase, initialPhaseStatus, levelFromXp, PART_LABELS, PARTS } from './game.js';
import { sortFoodsByUse } from './nutrition.js';
import { addFoodById } from './mealTab.js';
import { latestBody } from './body.js';
import { analyzeInbody, OcrError } from './ocr.js';
import { shouldShowBackupReminder } from './backupReminder.js';

const PROGRAM_NAMES = { A: '胸・肩・三頭', B: '背中・二頭', C: '脚・腹' };

/** PARTS の各部位に対応する assets/sprite.svg のトルソー上書きシンボルID */
const PART_TORSO = {
  chest: 'torso-chest', back: 'torso-back', shoulder: 'torso-shoulder',
  leg: 'torso-leg', arm: 'torso-arm', abs: 'torso-abs'
};

let store;

export function initHomeTab(s) {
  store = s;
  onShow('home', renderHomeTab);
}

export function renderHomeTab() {
  const workouts = store.get('workouts');
  const profile = store.get('profile');
  const game = store.get('game');
  const settings = store.get('settings');
  const meals = store.get('meals');
  const bodyRecords = store.get('body');
  const badminton = store.get('badminton');
  const today = todayStr();
  const program = nextProgram(workouts);
  const streak = calcStreak(workouts, today);
  const weeks = weeklyVolume(workouts);
  const initial = isInitialPhase(profile.startDate, today);
  const status = initialPhaseStatus(workouts, meals, today);
  const feasibility = weekFeasibility(workouts, today);
  const detraining = daysUntilDetraining(workouts, today);
  const quickFoods = sortFoodsByUse(store.get('foods')).slice(0, 6);
  const body = latestBody(bodyRecords);
  // 「失うと惜しい量のデータ」があり、かつ最近バックアップ(エクスポート)していない場合だけ
  // 出すリマインダー(js/backupReminder.js)。写真(IndexedDB)は同期的に数えられないため
  // この判定には含めない(js/settingsTab.js の「データの状態」カードでは別途表示する)。
  const recordCount = workouts.length + meals.length + bodyRecords.length + badminton.length;
  const showBackupReminder = shouldShowBackupReminder(recordCount, settings, today);

  $('#tab-home').innerHTML = `
    <div class="card card-primary">
      <div class="muted">今日やること</div>
      <div class="big">【${program}】${PROGRAM_NAMES[program]}</div>
      <button id="btnGoWorkout" class="primary" style="margin-top:8px;width:100%">トレーニングを始める</button>
    </div>

    ${showBackupReminder ? renderBackupReminderCard() : ''}

    <div class="card">
      <div class="muted">今週の達成状況</div>
      <div class="big${feasibility.remaining === 0 ? ' up' : ''}">${feasibilityHeadline(feasibility)}</div>
      <div class="muted">${feasibilitySub(feasibility)}</div>
      <div class="muted">今週の総挙上量 ${thisWeekVolume(weeks, today)} kg ${weekDiff(weeks, feasibility)}</div>
    </div>

    ${!initial ? `
    <div class="card card-secondary">
      <div class="muted">連続週数</div>
      <div class="big">${icon('i-flame')} ${streak} 週</div>
    </div>` : ''}

    ${initial ? `
    <div class="card">
      <h2 style="margin-top:0">最初の4週間</h2>
      <p class="muted">この期間は2つだけ追いかけます。1つは上の「今週の達成状況」（週3ジム）、もう1つはこちらの朝プロテイン。ここが習慣になれば、あとは自動的に進みます。</p>
      <div>朝プロテイン <b>${status.proteinMornings}</b> 日 / 今週</div>
    </div>` : ''}

    ${!initial ? `
    <div class="card card-secondary">
      <div class="muted">前回のトレーニングから</div>
      <div class="big">${detrainingHeadline(detraining)}</div>
      <div class="muted">${detrainingSub(detraining)}</div>
    </div>` : ''}

    <div class="card">
      <h2 style="margin-top:0">クイック記録</h2>
      <div class="chips" id="quickFoods">
        ${quickFoods.map((f) => `<button data-food="${f.id}">${esc(f.name)}</button>`).join('')}
      </div>
      <div class="chips" style="margin-top:8px">
        <button id="btnBadminton">${icon('i-shuttle')} バドミントンを記録</button>
        <button id="btnInbody">${icon('i-scale')} InBody（体組成）を記録</button>
      </div>
    </div>

    <div class="card card-secondary">
      <h2 style="margin-top:0">部位レベル</h2>
      ${renderTorsoRow(game.xp)}
      ${body ? `<div class="muted" style="margin-top:8px">最新の体組成 ${body.date}: 筋肉${body.muscle}kg / 体脂肪${body.fatPct}%</div>` : ''}
    </div>`;

  $('#btnGoWorkout').addEventListener('click', () => showTab('workout'));
  if (showBackupReminder) {
    $('#btnGoBackup').addEventListener('click', () => showTab('settings'));
    $('#btnDismissBackup').addEventListener('click', () => {
      try {
        store.set('settings', { ...settings, backupReminderDismissedAt: today });
      } catch {
        toast('保存できませんでした（端末の空き容量を確認してください）');
        return;
      }
      renderHomeTab();
    });
  }
  $('#quickFoods').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-food]');
    if (!btn) return;
    addFoodById(btn.dataset.food);
    renderHomeTab();
  });
  $('#btnBadminton').addEventListener('click', recordBadminton);
  $('#btnInbody').addEventListener('click', recordBody);
}

/**
 * バックアップ(JSONエクスポート)を促すリマインダーカード(js/backupReminder.js の
 * shouldShowBackupReminder が true の間だけ表示)。設定タブに既にあるエクスポート機能を
 * 誰にも気づかれないまま放置しないための導線。押しつけがましくならないよう、
 * 「あとで」で今日から14日間は黙る(閉じた記録は settings.backupReminderDismissedAt に残す)。
 */
function renderBackupReminderCard() {
  return `
    <div class="card" id="backupReminderCard">
      <h2 style="margin-top:0">バックアップのお願い</h2>
      <p class="muted">記録がある程度たまりました。端末の故障・紛失や、ブラウザ側の自動削除に備えて、設定タブのJSONバックアップを一度取っておくと安心です。</p>
      <div class="chips">
        <button id="btnGoBackup" class="primary">設定でバックアップする</button>
        <button id="btnDismissBackup">あとで</button>
      </div>
    </div>`;
}

/**
 * 部位レベルをトルソー6体の行として描画する。数字を読まなくても、
 * 鍛えていない部位（レベル0）が一目で沈んで見えることが目的なので、
 * レベル0は overlay を --track・ラベルを --muted にして明確に暗く沈める。
 * レベル1以上は overlay を --accent・ラベルを --text にする。
 * torso-base は常に --text（sprite側で opacity を持たせた輪郭線）。
 */
function renderTorsoRow(xp) {
  const items = PARTS.map((p) => {
    const level = levelFromXp(xp[p] ?? 0);
    const trained = level >= 1;
    const overlayColor = trained ? 'var(--accent)' : 'var(--track)';
    const labelColor = trained ? 'var(--text)' : 'var(--muted)';
    return `
      <div class="torso-item">
        <div class="torso-box">
          <svg class="torso-layer" style="color:var(--text)" aria-hidden="true"><use href="#torso-base"></use></svg>
          <svg class="torso-layer" style="color:${overlayColor}" aria-hidden="true"><use href="#${PART_TORSO[p]}"></use></svg>
        </div>
        <div class="torso-label" style="color:${labelColor}">${PART_LABELS[p]} Lv${level}</div>
      </div>`;
  }).join('');
  return `<div class="torso-row">${items}</div>`;
}

/**
 * 週の達成可否（weekFeasibility の結果）の見出し。
 * これは「失敗」を見せる場所ではないので、週3回の目標に届かなくなっても、
 * 今週にまだ日が残っている限りは（canFitMore）「まだ入る」という前向きな
 * 言い方にする。「今週は◯回で締め」という区切り（罰）の言い方は、本当に
 * 今週の日が尽きた場合だけに使う。土曜に「締め」を出していたのが元のバグ。
 */
function feasibilityHeadline(f) {
  if (f.remaining === 0) return `今週${f.done}回 達成`;
  if (f.stillPossible) return `残り${f.remaining}回`;
  if (f.canFitMore) return `今週あと${f.daysLeftInWeek}回入る`;
  return `今週は${f.done}回で締め`;
}

function feasibilitySub(f) {
  if (f.remaining === 0) return '今週の目標はクリアしました';
  if (f.stillPossible) return `今週あと${f.daysLeftInWeek}日 · 間に合う`;
  if (f.canFitMore) return `週3回には届かないけれど、まだ${f.daysLeftInWeek}日ある`;
  return '来週から';
}

/**
 * 検出開始カウントダウン（daysUntilDetraining の結果）の見出し。
 * ペナルティではなく時計として見せるため、0またはoverdueのときも
 * 「今すぐ取り返せ」のような煽りではなく、次の一歩を促すだけの言い方にする。
 *
 * 「◯日で筋肉が落ち始める」という特定の日を断定する表現は使わない
 * （js/workout.js の daysUntilDetraining 上のコメントにある研究の通り、
 * 発症日を1点で特定できるほどの根拠は無い）。筋力はおよそ3週間は保たれ、
 * 測定可能なサイズの低下はおよそ3〜6週間あたりから見え始める、という
 * 情報として伝える。計画的な休養は失敗ではないので、過ぎても煽らない。
 */
function detrainingHeadline(d) {
  if (d.lastDate === null) return 'まだ記録がありません';
  if (d.daysLeft > 0) return `あと${d.daysLeft}日`;
  return 'ひとやすみ中';
}

function detrainingSub(d) {
  if (d.lastDate === null) return 'トレーニングを始めましょう';
  if (d.daysLeft > 0) return `最後にジムへ行ってから${d.daysSince}日。筋力はこのくらいの期間ならしっかり保たれると言われています`;
  return `筋力はまだ大きくは落ちていないはず。見た目の変化は3〜6週間あたりから出始めると言われています。軽めでいいので一度行くと戻りやすい`;
}

function thisWeekVolume(weeks, today) {
  const key = weekKey(today);
  return Math.round(weeks.find((w) => w.week === key)?.volume ?? 0);
}

// 疎な系列なので、週キーが隣接していない場合は「先週比」と呼ばない
// 週の途中で先週比を出さない。3回やった先週と1回しかやっていない今週を比べれば
// 当然マイナスになり、まだ失敗していないのに失敗したと言うことになる。
// 今週の目標回数を終えてから（＝比較が公平になってから）出す。
function weekDiff(weeks, feasibility) {
  if (weeks.length < 2) return '';
  if (feasibility && feasibility.remaining > 0) return '';
  const last = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  if (prev.week !== previousWeekKey(last.week)) return '';
  const diff = Math.round(last.volume - prev.volume);
  return diff >= 0 ? `<span class="up">先週比 +${diff}kg ↗</span>` : `先週比 ${diff}kg`;
}

/** 脚の日の翌日は回復が間に合わないため警告を出す */
function recordBadminton() {
  const today = todayStr();
  if (warnsBadmintonAfterLegs(store.get('workouts'), today)) {
    if (!confirm('昨日は脚の日（C）でした。回復が間に合わない可能性があります。それでも記録しますか？')) return;
  }
  const minutes = Number(prompt('何分やりましたか？', '60'));
  if (!minutes || Number.isNaN(minutes)) return;
  try {
    store.set('badminton', [...store.get('badminton'), { date: today, durationMin: minutes }]);
  } catch {
    toast('保存できませんでした（端末の空き容量を確認してください）');
    return;
  }
  toast('バドミントンを記録しました');
  renderHomeTab();
}

/**
 * 結果紙を撮れば3項目が埋まる。読めなければ手入力に落とす。
 * 3項目そろっていない記録は保存しない。body.js は欠損値を0扱いするため、
 * 1項目だけ欠けると差分が実際の値と大きくずれる（例: weight欠損で開始比 +59.8kg）
 *
 * 撮影の選択肢は Gemini APIキーの有無に関わらず常に提示する。かつては
 * `hasKey && confirm(...)` としており、キー未設定（既定の状態）だと確認自体が
 * 出ずに無言で手入力へ飛んでいた。これでは撮影という機能が存在すること自体を
 * ユーザーが知りようがない。キーが無い場合は「撮影する」を選んだ時点で、
 * 設定タブでキーを登録すれば使えることを伝えたうえで手入力に落とす
 * （行き止まりにしない）。ここではキーの入力・発行までは行わない
 * （設定タブへの案内までがこの画面の責務）。
 */
async function recordBody() {
  const hasKey = Boolean(store.get('settings').geminiKey);
  const usePhoto = confirm('InBodyの結果紙を撮影して読み取りますか？\n（キャンセルすると手入力になります）');

  let values = null;
  if (usePhoto) {
    if (!hasKey) {
      alert('この機能を使うには設定タブでGemini APIキーを登録してください。続けて手入力に進みます。');
    } else {
      values = await readInbodyPhoto();
    }
  }
  if (!values) {
    openBodyForm(saveBodyValues);
    return;
  }
  saveBodyValues(values);
}

function saveBodyValues(values) {
  try {
    store.set('body', [...store.get('body'), { date: todayStr(), ...values, source: 'inbody' }]);
  } catch {
    toast('保存できませんでした（端末の空き容量を確認してください）');
    return;
  }
  toast('体組成を記録しました');
  renderHomeTab();
}

function readInbodyPhoto() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      toast('解析中...');
      try {
        const v = await analyzeInbody(file, store.get('settings').geminiKey);
        if (!confirm(`読み取り結果\n体重 ${v.weight}kg / 筋肉量 ${v.muscle}kg / 体脂肪 ${v.fatPct}%\n\nこの値で保存しますか？`)) {
          return resolve(null);
        }
        resolve(v);
      } catch (err) {
        toast(err instanceof OcrError ? err.message : '解析に失敗しました');
        resolve(null);
      }
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * 体重・筋肉量・体脂肪率の3値を1画面で入力するインラインフォーム。
 * OSのprompt()を3連続出す方式（旧promptBodyValues）は、汗ばんだ手で立ったまま
 * 操作している最中にフォーカスが途中で外れると、3つ目まで進んでから
 * 入力し直しになっていた。その場に留まったまま3項目を見渡して直せる
 * カードに置き換える。
 * 3項目すべてが正の有限数でなければ保存しない(旧実装と同じ検証: body.js は
 * 欠損値を0扱いするため、1項目だけ欠けると差分が実際の値と大きくずれる)。
 */
function openBodyForm(onSave) {
  const dialog = document.createElement('div');
  dialog.className = 'card';
  dialog.innerHTML = `
    <h2 style="margin-top:0">体組成を記録</h2>
    <p class="muted" style="margin-top:0">結果紙を撮影すれば、この3項目は自動で入力できます</p>
    <div class="ex-ctrl">体重 <input type="number" inputmode="decimal" id="bfWeight" value="60" style="width:90px">kg</div>
    <div class="ex-ctrl">筋肉量 <input type="number" inputmode="decimal" id="bfMuscle" value="45" style="width:90px">kg</div>
    <div class="ex-ctrl">体脂肪率 <input type="number" inputmode="decimal" id="bfFat" value="20" style="width:90px">%</div>
    <div class="chips">
      <button id="bfSave" class="primary">保存</button>
      <button id="bfCancel">やめる</button>
    </div>`;
  $('#tab-home').prepend(dialog);

  // このダイアログは開くたびに新しく作る使い捨てのDOMなので addEventListener でよい
  // (onclick代入が必要なのは再描画をまたいで生き続けるコンテナだけ)。
  dialog.querySelector('#bfCancel').addEventListener('click', () => dialog.remove());
  dialog.querySelector('#bfSave').addEventListener('click', () => {
    const weight = Number(dialog.querySelector('#bfWeight').value);
    const muscle = Number(dialog.querySelector('#bfMuscle').value);
    const fatPct = Number(dialog.querySelector('#bfFat').value);
    if ([weight, muscle, fatPct].some((n) => !Number.isFinite(n) || n <= 0)) {
      toast('数値が読めませんでした');
      return;
    }
    dialog.remove();
    onSave({ weight, muscle, fatPct });
  });
}
