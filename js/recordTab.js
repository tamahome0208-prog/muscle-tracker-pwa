import { $, onShow, todayStr, icon, esc } from './ui.js';
import { weeklyVolume, weekKey, previousWeekKey, weekFeasibility } from './workout.js';
import { bodySeries, bodyDiff, latestBody, currentBodyweight } from './body.js';
import { radarData, BADGES } from './game.js';
import { loadChartJs, drawVolumeChart, drawBodyChart, drawRadarChart } from './charts.js';
import { initDayView, renderDayView } from './dayView.js';
import { dayTotals } from './nutrition.js';
import { buildCalendarWeeks, WEEKDAY_LABELS, GYM_TARGET_PER_WEEK } from './calendarView.js';
import { listPhotos } from './photos.js';
import {
  estimateFfmKg,
  dailyExerciseKcal,
  energyAvailability,
  eaFloorKcal,
  eaOptimalKcal,
  equationMaintenanceEstimate,
  estimateMaintenance
} from './energy.js';

let store;

export function initRecordTab(s) {
  store = s;
  initDayView(s);
  onShow('record', renderRecordTab);
}

export function renderRecordTab() {
  const workouts = store.get('workouts');
  const badminton = store.get('badminton');
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
      ${renderEnergyCard()}
    </div>
    <div class="card">
      <h2 style="margin-top:0">カレンダー</h2>
      <div id="calendarWrap">${renderCalendar(workouts, badminton, new Set())}</div>
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

  // 写真の印だけは IndexedDB(js/photos.js)への非同期問い合わせが必要なので、
  // 上の innerHTML 代入(同期部分。写真の印なしで一度描画済み)の後に埋め直す。
  // カレンダー部分だけを再構築し、Chart.js の読み込み・canvas 描画には触れない。
  fillCalendarPhotos(workouts, badminton);

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

/**
 * 「エネルギー可用性(EA)」カード。推定維持カロリー・EAフロア・現在のEAをまとめて表示する
 * (js/energy.js 参照)。式そのものを画面に出す方針: 数字だけ見せて仕組みを隠すと、
 * このユーザーがまた「もっと削ってもいいはず」と思ったときに検算できない。
 *
 * データが足りない場合は自信のある数値のふりをせず、その旨をそのまま表示する
 * (estimateMaintenance の method: 'insufficient'/'equation' をそのまま文言に反映する)。
 */
function renderEnergyCard() {
  const profile = store.get('profile');
  const meals = store.get('meals');
  const workouts = store.get('workouts');
  const badminton = store.get('badminton');
  const body = store.get('body');
  const latest = latestBody(body);
  const today = todayStr();

  const weightForExercise = currentBodyweight(body, profile);
  // InBody記録が無くても profile.weight から概算FFMを使い続ける(体組成未計測=
  // 判定しない、という回帰を避ける。js/energy.js の estimateFfmKg 参照)。
  // ただしその場合は estimated: true が返るので、画面上で実測と区別して示す。
  const ffmResult = estimateFfmKg(latest, weightForExercise);
  const ffmKg = ffmResult ? ffmResult.ffmKg : null;
  const ffmEstimated = ffmResult ? ffmResult.estimated : false;
  const exerciseKcal = dailyExerciseKcal(workouts, badminton, today, weightForExercise);

  const equationEstimate = equationMaintenanceEstimate({
    ffmKg,
    weightKg: profile.weight,
    heightM: profile.height / 100,
    ageYears: profile.age,
    isMale: profile.sex === 'male',
    exerciseKcalPerDay: exerciseKcal
  });
  const maintenance = estimateMaintenance(meals, body, today, equationEstimate);

  const todayTotals = dayTotals(meals, today);
  const hasFfm = Number.isFinite(ffmKg) && ffmKg > 0;
  const floor = hasFfm ? eaFloorKcal(ffmKg, exerciseKcal) : null;
  const optimal = hasFfm ? eaOptimalKcal(ffmKg, exerciseKcal) : null;
  const currentEA = hasFfm && todayTotals.kcal > 0 ? energyAvailability(todayTotals.kcal, exerciseKcal, ffmKg) : null;

  const maintenanceBlock = maintenance.method === 'insufficient'
    ? `<p class="muted">推定維持カロリー: データ不足のため算出できません。${maintenance.note}</p>`
    : `<p>推定維持カロリー: <strong>${maintenance.kcal}kcal</strong>
        (${maintenance.method === 'trend' ? '直近の体重トレンドからの実測ベース推定' : '予測式によるおおまかな出発点の推定(実測ではありません)'})</p>
       <p class="muted">${maintenance.note}</p>`;

  const ffmLabel = ffmEstimated ? `${ffmKg.toFixed(1)}kg(推定)` : `${ffmKg.toFixed(1)}kg`;
  const ffmEstimatedNote = ffmEstimated
    ? `<p class="muted">FFM(除脂肪量)はInBody記録が無いため実測ではなく、体重${weightForExercise.toFixed(1)}kg・
        体脂肪率20%(このユーザー属性の一般的なレンジの目安。実測ではない)と仮定した概算値です。
        ホームからInBodyを記録すると、以降は実測FFMに切り替わります。</p>`
    : '';

  const eaBlock = hasFfm
    ? `${ffmEstimatedNote}
       <p>EAフロア(警告ライン): <strong>${Math.round(floor)}kcal</strong>
        <span class="muted">= 30 × FFM(${ffmLabel}) + 運動消費(${Math.round(exerciseKcal)}kcal/日)</span></p>
       <p>EA最適ライン: <strong>${Math.round(optimal)}kcal</strong>
        <span class="muted">= 45 × FFM + 運動消費</span></p>
       ${currentEA !== null
         ? `<p>今日のEA: <strong>${currentEA.toFixed(1)} kcal/kg FFM/日</strong>
             <span class="muted">= (摂取${Math.round(todayTotals.kcal)} − 運動${Math.round(exerciseKcal)}) / FFM${ffmLabel}</span></p>`
         : '<p class="muted">今日はまだ食事記録が無いため、今日のEAはまだ計算できません。</p>'}
       <p class="muted">EA 30 kcal/kg FFM/日はACSM/AND/DC 2016の共同ポジションスタンドが根拠の警告ラインで、
        「下回った瞬間に何かが壊れる崖」ではありません。この閾値は元々女性のデータから
        導かれたもので、男性についてはより低く・より不確実な値しか根拠が無い
        (参考: Koehler et al. 2016は4日間15でもテストステロンの有意な変化なし)ため、
        保守的な目安として使っています。</p>`
    : '<p class="muted">体重が記録されていないため、EAフロア・現在のEAは計算できません。</p>';

  return `<h2 style="margin-top:0">エネルギー可用性(EA)</h2>
    ${maintenanceBlock}
    ${eaBlock}`;
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


// 表示する週数。以前の実装も56日(=8週)分を一覧していたため、見せる履歴の長さは
// 変えずに「曜日の列が揃う」よう週単位(月曜始まり)に切り上げる。ページング(先週より前に
// 遡る)は今回は追加しない: 8週あれば直近2ヶ月の傾向は十分読み取れるし、ページングを足すと
// 状態(表示中の週オフセット)を持つ必要が出て複雑になる。ユーザーからページングが要る
// という声が出たら、そのとき素直に足せばよい。
const CALENDAR_WEEKS = 8;

/**
 * 直近8週間(月曜始まり、weekKey/weekFeasibilityと同じ週の切り方)のカレンダー。
 * 週の切り方・各セルの中身(program/バドミントン/写真の有無)・週次のジム回数は
 * js/calendarView.js の buildCalendarWeeks に集約してある(単体テスト済み。このモジュール側は
 * その戻り値をHTMLに描くだけ)。7列固定のグリッドに8列目として週次のジム回数
 * (目標回数中、何回実施したか)を添える。
 *
 * ジムの日は「行った」ことだけでなくどのプログラム(A/B/C)かを文字バッジで示す
 * (ユーザーが自分でプログラムを選ぶようになったため、汎用のバーベルアイコンより
 * 情報量が多い)。バドミントン・写真はそれぞれのアイコンを添える。3つとも同日に
 * 起こり得るため、印は排他ではなく並べて表示する。
 *
 * photoDates はIndexedDBへの非同期問い合わせ結果(js/photos.js の listPhotos)を
 * 呼び出し側(fillCalendarPhotos)が渡す。初回描画時は空集合で(写真の印なしに)同期的に
 * 描画し、写真件数が判明し次第 #calendarWrap だけを差し替える。
 */
function renderCalendar(workouts, badminton, photoDates) {
  const { weeks } = buildCalendarWeeks({ workouts, badminton, photoDates, todayStr: todayStr(), weeks: CALENDAR_WEEKS });

  const headerHtml = WEEKDAY_LABELS.map((l) => `<div class="cal-wd">${l}</div>`).join('')
    + '<div class="cal-wd cal-wd-count">実施</div>';

  const bodyHtml = weeks.map((week) => {
    // その週の中に「月の1日」があれば、月境界のラベルをその週の直前に挟む。
    // grid-column:1/-1 のブロックなので、8列グリッドの中で1行まるごと使う。
    const firstOfMonth = week.days.find((d) => d.isFirstOfMonth);
    const monthLabelHtml = firstOfMonth
      ? `<div class="cal-month-label">${firstOfMonth.year}年${firstOfMonth.month}月</div>`
      : '';
    const daysHtml = week.days.map(renderCalCell).join('');
    const achieved = week.gymCount >= GYM_TARGET_PER_WEEK;
    const countHtml = `<div class="cal-count${achieved ? ' up' : ''}">${week.gymCount}/${GYM_TARGET_PER_WEEK}</div>`;
    return `${monthLabelHtml}${daysHtml}${countHtml}`;
  }).join('');

  return `<div class="cal-grid">${headerHtml}${bodyHtml}</div>`;
}

function renderCalCell(day) {
  // 月の1日だけは日付番号の代わりに「M/D」にして、月境界ラベルが無くても
  // この1マスだけ見れば月が変わったことが分かるようにする(二重の手がかり)。
  const label = day.isFirstOfMonth ? `${day.month}/${day.dayOfMonth}` : String(day.dayOfMonth);

  if (day.isFuture) {
    // 今週のうちまだ来ていない未来日。記録が存在しようがないので、休養日(中点)とは
    // 明確に区別する: 印は何も出さず、セル全体を薄くしてタップもさせない
    // (data-date を持たせない。js/dayView.js を開いても常に空の未来日になるだけで意味が無い)。
    return `<div class="cal-cell future"><span class="cal-daynum">${esc(label)}</span><span class="cal-marks"></span></div>`;
  }

  const marks = [];
  if (day.program === 'unknown') marks.push(icon('i-barbell', 'icon-sm'));
  else if (day.program) marks.push(`<span class="cal-prog cal-prog-${esc(day.program)}">${esc(day.program)}</span>`);
  if (day.hasBadminton) marks.push(icon('i-shuttle', 'icon-sm'));
  if (day.hasPhoto) marks.push(icon('i-camera', 'icon-sm'));
  const marksHtml = marks.length ? marks.join('') : '<span class="cal-dot">・</span>';

  const cls = 'cal-cell' + (day.isToday ? ' today' : '');
  // data-date でタップ判定する(js/recordTab.js の onRecordTabClick)。title属性はホバー用の
  // 補助表示として残す。セルの最小サイズはCSS(.cal-cell)側でタップ領域を確保する。
  return `<div class="${cls}" title="${esc(day.date)}" data-date="${esc(day.date)}">
    <span class="cal-daynum">${esc(label)}</span><span class="cal-marks">${marksHtml}</span></div>`;
}

/**
 * カレンダーの写真マークだけを後埋めする。IndexedDB(js/photos.js)への問い合わせは
 * 非同期なので、renderRecordTab 本体の同期的な innerHTML 代入では待たない
 * (js/settingsTab.js の fillStorageStatus と同じ考え方)。IndexedDBが使えない環境・
 * listPhotos が失敗した場合も、写真の印が無いカレンダーのまま(例外を投げない)。
 * ユーザーがこの後すぐ別タブへ切り替えても(#calendarWrapがnullを返すだけで)クラッシュしない。
 */
async function fillCalendarPhotos(workouts, badminton) {
  let photoDates;
  try {
    const photos = await listPhotos();
    photoDates = new Set(photos.map((p) => p?.date).filter((d) => typeof d === 'string'));
  } catch (err) {
    console.warn('写真の読み込みに失敗しました(カレンダーの写真マークは表示されません):', err);
    return;
  }
  const wrap = $('#calendarWrap');
  if (!wrap) return;
  wrap.innerHTML = renderCalendar(workouts, badminton, photoDates);
}
