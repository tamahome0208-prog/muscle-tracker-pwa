import { $, onShow, todayStr, icon } from './ui.js';
import { weeklyVolume, weekKey, previousWeekKey, weekFeasibility } from './workout.js';
import { bodySeries, bodyDiff, latestBody } from './body.js';
import { radarData, BADGES } from './game.js';
import { loadChartJs, drawVolumeChart, drawBodyChart, drawRadarChart } from './charts.js';
import { initDayView, renderDayView } from './dayView.js';

let store;

export function initRecordTab(s) {
  store = s;
  initDayView(s);
  onShow('record', renderRecordTab);
}

export function renderRecordTab() {
  const workouts = store.get('workouts');
  const weeks = weeklyVolume(workouts);
  const feasibility = weekFeasibility(workouts, todayStr());
  const game = store.get('game');
  const body = store.get('body');
  const diff = bodyDiff(body);
  const latest = latestBody(body);

  $('#tab-record').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">週次総挙上量</h2>
      <canvas id="volumeChart"></canvas>
      <div class="muted">${weekSummary(weeks, feasibility)}</div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">体組成</h2>
      <canvas id="bodyChart"></canvas>
      ${latest ? `<div class="muted">最新 ${latest.date}: 体重${latest.weight}kg / 筋肉${latest.muscle}kg / 体脂肪${latest.fatPct}%</div>
      <div class="muted">開始比: 体重${fmt(diff.weight)}kg / 筋肉<span class="up">${fmt(diff.muscle)}kg</span> / 体脂肪${fmt(diff.fatPct)}%</div>`
        : '<p class="muted">体組成の記録がありません。ホームから登録してください。</p>'}
    </div>
    <div class="card">
      <h2 style="margin-top:0">部位レベル</h2>
      <canvas id="radarChart"></canvas>
    </div>
    <div class="card">
      <h2 style="margin-top:0">カレンダー</h2>
      ${renderCalendar(workouts, store.get('badminton'))}
    </div>
    <div class="card">
      <h2 style="margin-top:0">称号</h2>
      ${BADGES.map((b) => {
        // game は object キーなので、入れ子の badges は store.js の型検証を通らない。
        // game.js の checkBadges と同じガードを置き、壊れていても記録タブ全体を落とさない
        const ownedBadges = Array.isArray(game.badges) ? game.badges : [];
        const owned = ownedBadges.includes(b.id);
        return `<div class="ex"><div class="ex-head"><span class="ex-name">${owned ? icon('i-crest') + ' ' + b.name : icon('i-crest-locked') + ' ???'}</span></div>
          <div class="muted">${owned ? b.desc : '未解放'}</div></div>`;
      }).join('')}
    </div>`;

  // #tab-record は日付ビュー(js/dayView.js)との間で使い回されるコンテナなので、
  // addEventListener だと record タブに戻ってくるたびにハンドラが積み重なる。
  // onclick 代入で常に1つに保つ。
  $('#tab-record').onclick = onRecordTabClick;

  // Chart.js はここで初めて動的に読み込む(js/charts.js の loadChartJs 参照)。
  // カレンダー・称号・体組成の数値等、canvas を使わないカードは上の innerHTML 代入で
  // 既に描画済みなので、これが失敗してもタブ全体が空白になることはない。
  loadChartJs().then(() => {
    drawVolumeChart('volumeChart', weeks);
    drawBodyChart('bodyChart', bodySeries(body));
    drawRadarChart('radarChart', radarData(game.xp));
  }).catch((err) => {
    console.warn('グラフの読み込みに失敗しました:', err);
    for (const id of ['volumeChart', 'bodyChart', 'radarChart']) {
      const canvas = document.getElementById(id);
      if (!canvas) continue;
      const msg = document.createElement('p');
      msg.className = 'muted';
      msg.textContent = 'グラフを読み込めませんでした（オフラインなど）。数値やカレンダーは下に表示されています。';
      canvas.replaceWith(msg);
    }
  });
}

/** カレンダーのセルをタップしたら、その日付の記録一覧(js/dayView.js)を開く */
function onRecordTabClick(e) {
  const cell = e.target.closest('[data-date]');
  if (!cell) return;
  renderDayView(cell.dataset.date, renderRecordTab);
}

function fmt(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(1);
}

// weeklyVolume の系列は疎（トレーニングが無い週は要素が無い）。
// 直前の要素が本当に「先週」とは限らないので、週キーが隣接している時だけ先週比を出す。
// 週の途中で先週比を出さない。完了した先週と進行中の今週を比べれば当然マイナスで、
// まだ終わっていない週を失敗として見せることになる。目標回数を終えてから出す。
function weekSummary(weeks, feasibility) {
  if (weeks.length < 2) return '2週分たまると先週比が出ます';
  if (feasibility && feasibility.remaining > 0) {
    return `今週は進行中（あと${feasibility.remaining}回）· 終わったら先週比を出します`;
  }
  const last = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  if (prev.week !== previousWeekKey(last.week)) return `前回トレした週(${prev.week})から再開`;
  const diff = Math.round(last.volume - prev.volume);
  return `先週比 ${diff >= 0 ? '+' : ''}${diff}kg`;
}


/** 直近8週間のカレンダー。ジムはバーベル・バドミントンはシャトルのアイコン、休養は中点 */
function renderCalendar(workouts, badminton) {
  const gymDates = new Set(workouts.map((w) => w.date));
  const badDates = new Set(badminton.map((b) => b.date));
  const cells = [];
  const today = new Date(todayStr() + 'T00:00:00Z');
  for (let i = 55; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const mark = gymDates.has(key) ? icon('i-barbell', 'icon-sm') : badDates.has(key) ? icon('i-shuttle', 'icon-sm') : '·';
    // data-date でタップ判定する(title属性はホバー用の補助表示として残す)。
    // 44px未満だと誤タップ元になるため、幅は12.5%でも縦方向のpaddingで
    // タップ領域を44px以上確保する。
    cells.push(`<span title="${key}" data-date="${key}" style="display:inline-block;width:12.5%;text-align:center;padding:12px 0;cursor:pointer">${mark}</span>`);
  }
  return `<div style="font-size:14px">${cells.join('')}</div>`;
}
