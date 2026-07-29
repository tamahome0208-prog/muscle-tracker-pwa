import { $, onShow, showTab, toast, todayStr, esc } from './ui.js';
import { nextProgram, weeklyVolume, warnsBadmintonAfterLegs, weekKey } from './workout.js';
import { calcStreak, isInitialPhase, initialPhaseStatus, levelFromXp, PART_LABELS, PARTS } from './game.js';
import { sortFoodsByUse } from './nutrition.js';
import { addFoodById } from './mealTab.js';
import { latestBody } from './body.js';

const PROGRAM_NAMES = { A: '胸・肩・三頭', B: '背中・二頭', C: '脚・腹' };

let store;

export function initHomeTab(s) {
  store = s;
  onShow('home', renderHomeTab);
}

export function renderHomeTab() {
  const workouts = store.get('workouts');
  const profile = store.get('profile');
  const game = store.get('game');
  const today = todayStr();
  const program = nextProgram(workouts);
  const streak = calcStreak(workouts, today);
  const weeks = weeklyVolume(workouts);
  const initial = isInitialPhase(profile.startDate, today);
  const status = initialPhaseStatus(workouts, store.get('meals'), today);
  const quickFoods = sortFoodsByUse(store.get('foods')).slice(0, 6);
  const body = latestBody(store.get('body'));

  $('#tab-home').innerHTML = `
    <div class="card">
      <div class="muted">今日やること</div>
      <div class="big">【${program}】${PROGRAM_NAMES[program]}</div>
      <button id="btnGoWorkout" class="primary" style="margin-top:8px;width:100%">トレーニングを始める</button>
    </div>

    ${initial ? `
    <div class="card">
      <h2 style="margin-top:0">最初の4週間</h2>
      <p class="muted">この期間は2つだけ追いかけます。ここが習慣になれば、あとは自動的に進みます。</p>
      <div>週3ジム <b>${status.gymCount} / 3</b> ${status.gymDone ? '✅' : ''}</div>
      <div>朝プロテイン <b>${status.proteinMornings}</b> 日 / 今週</div>
    </div>` : ''}

    <div class="card">
      <div class="muted">連続週数</div>
      <div class="big">🔥 ${streak} 週</div>
      <div class="muted">今週の総挙上量 ${thisWeekVolume(weeks, today)} kg ${weekDiff(weeks)}</div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">クイック記録</h2>
      <div class="chips" id="quickFoods">
        ${quickFoods.map((f) => `<button data-food="${f.id}">${esc(f.name)}</button>`).join('')}
      </div>
      <div class="chips" style="margin-top:8px">
        <button id="btnBadminton">🏸 バドミントンを記録</button>
        <button id="btnInbody">📏 体組成を記録</button>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-top:0">部位レベル</h2>
      ${PARTS.map((p) => `<div class="muted">${PART_LABELS[p]} Lv${levelFromXp(game.xp[p] ?? 0)}</div>`).join('')}
      ${body ? `<div class="muted" style="margin-top:8px">最新の体組成 ${body.date}: 筋肉${body.muscle}kg / 体脂肪${body.fatPct}%</div>` : ''}
    </div>`;

  $('#btnGoWorkout').addEventListener('click', () => showTab('workout'));
  $('#quickFoods').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-food]');
    if (!btn) return;
    addFoodById(btn.dataset.food);
    renderHomeTab();
  });
  $('#btnBadminton').addEventListener('click', recordBadminton);
  $('#btnInbody').addEventListener('click', recordBody);
}

function thisWeekVolume(weeks, today) {
  const key = weekKey(today);
  return Math.round(weeks.find((w) => w.week === key)?.volume ?? 0);
}

// 疎な系列なので、週キーが隣接していない場合は「先週比」と呼ばない
function weekDiff(weeks) {
  if (weeks.length < 2) return '';
  const last = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  if (prev.week !== previousWeekKey(last.week)) return '';
  const diff = Math.round(last.volume - prev.volume);
  return diff >= 0 ? `<span class="up">先週比 +${diff}kg ↗</span>` : `先週比 ${diff}kg`;
}

// 週キーの1つ前の週キーを返す。年またぎは weekKey に計算させる（js/recordTab.js と同じ実装）
function previousWeekKey(week) {
  const [year, num] = week.split('-W').map(Number);
  const jan4 = Date.UTC(year, 0, 4);
  const monday = new Date(jan4);
  monday.setUTCDate(monday.getUTCDate() - ((new Date(jan4).getUTCDay() + 6) % 7) + (num - 2) * 7);
  return weekKey(monday.toISOString().slice(0, 10));
}

/** 脚の日の翌日は回復が間に合わないため警告を出す */
function recordBadminton() {
  const today = todayStr();
  if (warnsBadmintonAfterLegs(store.get('workouts'), today)) {
    if (!confirm('昨日は脚の日（C）でした。回復が間に合わない可能性があります。それでも記録しますか？')) return;
  }
  const minutes = Number(prompt('何分やりましたか？', '60'));
  if (!minutes || Number.isNaN(minutes)) return;
  store.set('badminton', [...store.get('badminton'), { date: today, durationMin: minutes }]);
  toast('バドミントンを記録しました');
  renderHomeTab();
}

// 3項目そろっていない記録は保存しない。body.js は欠損値を0扱いするため、
// 1項目だけ欠けると差分が実際の値と大きくずれる（例: weight欠損で開始比 +59.8kg）
function recordBody() {
  const weight = Number(prompt('体重(kg)', '60'));
  const muscle = Number(prompt('筋肉量(kg)', '45'));
  const fatPct = Number(prompt('体脂肪率(%)', '20'));
  if ([weight, muscle, fatPct].some((n) => Number.isNaN(n) || n <= 0)) {
    toast('数値が読めませんでした');
    return;
  }
  store.set('body', [...store.get('body'), { date: todayStr(), weight, muscle, fatPct, source: 'inbody' }]);
  toast('体組成を記録しました');
  renderHomeTab();
}
