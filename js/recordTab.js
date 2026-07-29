import { $, onShow, todayStr } from './ui.js';
import { weeklyVolume, weekKey } from './workout.js';
import { bodySeries, bodyDiff, latestBody } from './body.js';
import { radarData, BADGES } from './game.js';
import { drawVolumeChart, drawBodyChart, drawRadarChart } from './charts.js';

let store;

export function initRecordTab(s) {
  store = s;
  onShow('record', renderRecordTab);
}

export function renderRecordTab() {
  const workouts = store.get('workouts');
  const weeks = weeklyVolume(workouts);
  const game = store.get('game');
  const body = store.get('body');
  const diff = bodyDiff(body);
  const latest = latestBody(body);

  $('#tab-record').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">週次総挙上量</h2>
      <canvas id="volumeChart"></canvas>
      <div class="muted">${weekSummary(weeks)}</div>
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
        return `<div class="ex"><div class="ex-head"><span class="ex-name">${owned ? '🎖 ' + b.name : '🔒 ???'}</span></div>
          <div class="muted">${owned ? b.desc : '未解放'}</div></div>`;
      }).join('')}
    </div>`;

  drawVolumeChart('volumeChart', weeks);
  drawBodyChart('bodyChart', bodySeries(body));
  drawRadarChart('radarChart', radarData(game.xp));
}

function fmt(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(1);
}

// weeklyVolume の系列は疎（トレーニングが無い週は要素が無い）。
// 直前の要素が本当に「先週」とは限らないので、週キーが隣接している時だけ先週比を出す。
function weekSummary(weeks) {
  if (weeks.length < 2) return '2週分たまると先週比が出ます';
  const last = weeks[weeks.length - 1];
  const prev = weeks[weeks.length - 2];
  if (prev.week !== previousWeekKey(last.week)) return `前回トレした週(${prev.week})から再開`;
  const diff = Math.round(last.volume - prev.volume);
  return `先週比 ${diff >= 0 ? '+' : ''}${diff}kg`;
}

/** 週キーの1つ前の週キーを返す。年またぎは weekKey に計算させる */
function previousWeekKey(week) {
  const [year, num] = week.split('-W').map(Number);
  const jan4 = Date.UTC(year, 0, 4);
  const monday = new Date(jan4);
  monday.setUTCDate(monday.getUTCDate() - ((new Date(jan4).getUTCDay() + 6) % 7) + (num - 2) * 7);
  return weekKey(monday.toISOString().slice(0, 10));
}

/** 直近8週間のカレンダー。💪ジム 🏸バド 😴休養 */
function renderCalendar(workouts, badminton) {
  const gymDates = new Set(workouts.map((w) => w.date));
  const badDates = new Set(badminton.map((b) => b.date));
  const cells = [];
  const today = new Date(todayStr() + 'T00:00:00Z');
  for (let i = 55; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    const mark = gymDates.has(key) ? '💪' : badDates.has(key) ? '🏸' : '·';
    cells.push(`<span title="${key}" style="display:inline-block;width:12.5%;text-align:center;padding:2px 0">${mark}</span>`);
  }
  return `<div style="font-size:14px">${cells.join('')}</div>`;
}
