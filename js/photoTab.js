import { $, onShow, toast, todayStr, icon, esc } from './ui.js';
import { ANGLES, savePhoto, listPhotos, latestByAngle, firstByAngle, toUrl, isAvailable, deletePhoto } from './photos.js';
import { BADGES, checkBadges, calcStreak } from './game.js';

let store;
let stream = null;
let currentAngle = 'front';
let ghostUrl = null;
let compareUrls = [];
let timelineUrls = [];

export function initPhotoTab(s) {
  store = s;
  onShow('photo', renderPhotoTab);
}

export async function renderPhotoTab() {
  if (!(await isAvailable())) {
    $('#tab-photo').innerHTML = '<div class="card">この端末では写真機能を利用できません（IndexedDBが使えません）。他の機能は通常どおり使えます。</div>';
    return;
  }

  $('#tab-photo').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">撮影</h2>
      <div class="chips" id="angleChips">
        ${ANGLES.map((a) => `<button data-angle="${a.id}" class="${a.id === currentAngle ? 'primary' : ''}">${esc(a.label)}</button>`).join('')}
      </div>
      <div class="photo-stage" id="stage" style="margin-top:8px">
        <video id="cam" playsinline muted></video>
        <img class="ghost hidden" id="ghost" alt="">
      </div>
      <p class="muted">前回の写真を薄く重ねています。輪郭を合わせて撮ると比較できる写真になります。</p>
      <div class="chips">
        <button id="btnShoot" class="primary">${icon('i-camera')} 撮影</button>
        <button id="btnFile">ファイルから</button>
      </div>
      <input type="file" id="filePicker" accept="image/*" class="hidden">
    </div>
    <div class="card">
      <h2 style="margin-top:0">比較</h2>
      <div class="chips">
        <button data-cmp="first">開始時と比較</button>
        <button data-cmp="3m">3ヶ月前と比較</button>
      </div>
      <div id="compareArea" style="margin-top:8px"></div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">タイムライン</h2>
      <div id="timeline"></div>
    </div>`;

  $('#angleChips').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-angle]');
    if (!btn) return;
    currentAngle = btn.dataset.angle;
    await renderPhotoTab();
  });

  $('#btnShoot').addEventListener('click', shoot);
  $('#btnFile').addEventListener('click', () => $('#filePicker').click());
  $('#filePicker').addEventListener('change', onFilePicked);
  // 再描画のたびにハンドラが積み重ならないよう onclick 代入にする
  $('#tab-photo').onclick = onCompareClick;

  await startCamera();
  await showGhost();
  await renderTimeline();
}

async function startCamera() {
  // renderPhotoTab はアングル切り替えのたびに呼ばれる。ここで前回のstreamを
  // 止めておかないと、切り替えるたびにMediaStreamがリークし続け、Android側の
  // カメラインジケータが点灯したままになり他アプリからカメラが使えなくなる。
  stopCamera();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const cam = $('#cam');
    cam.srcObject = stream;
    await cam.play();
  } catch {
    // カメラが使えなくてもファイル選択で記録できるようにする
    $('#cam').classList.add('hidden');
    toast('カメラを使えないため、ファイル選択で登録してください');
  }
}

export function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

/** 前回の同アングル写真を半透明で重ねる。構図を揃えるための補助 */
async function showGhost() {
  const prev = await latestByAngle(currentAngle);
  const ghost = $('#ghost');
  // 差し替え前に必ず前回のURLを解放する。しないたびに1枚分のBlobが
  // メモリに残り続け、写真タブを訪れるたびに写真の枚数分メモリが積み上がる。
  if (ghostUrl) {
    URL.revokeObjectURL(ghostUrl);
    ghostUrl = null;
  }
  if (!prev) {
    ghost.classList.add('hidden');
    return;
  }
  ghostUrl = toUrl(prev);
  ghost.src = ghostUrl;
  ghost.classList.remove('hidden');
}

async function shoot() {
  const cam = $('#cam');
  if (!stream) {
    toast('カメラが使えません');
    return;
  }
  const canvas = document.createElement('canvas');
  canvas.width = cam.videoWidth;
  canvas.height = cam.videoHeight;
  canvas.getContext('2d').drawImage(cam, 0, 0);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.95));
  try {
    await savePhoto({ date: todayStr(), angle: currentAngle, source: blob });
  } catch {
    toast('保存できませんでした（端末の空き容量を確認してください）');
    return;
  }
  toast('保存しました');
  await showGhost();
  await renderTimeline();
}

async function onFilePicked(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await savePhoto({ date: todayStr(), angle: currentAngle, source: file });
  } catch {
    toast('保存できませんでした（端末の空き容量を確認してください）');
    e.target.value = '';
    return;
  }
  e.target.value = '';
  toast('保存しました');
  await showGhost();
  await renderTimeline();
}

async function onCompareClick(e) {
  const btn = e.target.closest('[data-cmp]');
  if (!btn) return;

  // 前回の比較で作った2枚分のURLをここで必ず解放する(早期returnする分岐でも)。
  for (const u of compareUrls) URL.revokeObjectURL(u);
  compareUrls = [];

  const after = await latestByAngle(currentAngle);
  const before = btn.dataset.cmp === 'first'
    ? await firstByAngle(currentAngle)
    : await photoNearMonthsAgo(currentAngle, 3);

  if (!before || !after || before.id === after.id) {
    $('#compareArea').innerHTML = '<p class="muted">比較には同じアングルの写真が2枚以上必要です。</p>';
    return;
  }

  const bodyAt = (date) => {
    const hit = [...store.get('body')].sort((a, b) => (a.date < b.date ? -1 : 1))
      .filter((b) => b.date <= date).pop();
    return hit ? `筋肉量 ${hit.muscle}kg / 体脂肪 ${hit.fatPct}%` : '体組成の記録なし';
  };

  const beforeUrl = toUrl(before);
  const afterUrl = toUrl(after);
  compareUrls = [beforeUrl, afterUrl];

  $('#compareArea').innerHTML = `
    <div class="compare">
      <img src="${beforeUrl}" alt="">
      <img class="after" id="afterImg" src="${afterUrl}" alt="">
    </div>
    <input type="range" id="cmpRange" min="0" max="100" value="50">
    <div class="muted">${before.date}: ${bodyAt(before.date)}</div>
    <div class="muted">${after.date}: ${bodyAt(after.date)}</div>`;

  $('#cmpRange').addEventListener('input', (ev) => {
    $('#afterImg').style.clipPath = `inset(0 ${100 - ev.target.value}% 0 0)`;
  });

  grantCompareBadge();
}

async function photoNearMonthsAgo(angle, months) {
  const target = new Date();
  target.setMonth(target.getMonth() - months);
  const targetStr = target.toISOString().slice(0, 10);
  const all = (await listPhotos()).filter((p) => p.angle === angle);
  if (all.length === 0) return null;
  return all.reduce((best, p) =>
    Math.abs(new Date(p.date) - new Date(targetStr)) < Math.abs(new Date(best.date) - new Date(targetStr)) ? p : best);
}

function grantCompareBadge() {
  const game = store.get('game');
  const earned = checkBadges({
    workouts: store.get('workouts'), body: store.get('body'),
    streak: calcStreak(store.get('workouts'), todayStr()),
    xp: game.xp, comparedPhotos: true, badges: game.badges
  });
  if (earned.length === 0) return;
  // 保存に失敗したまま「称号解放」のトーストを出すと、次回起動時に称号が
  // 消えている(獲得した記憶だけが残る)という最も裏切りの大きい壊れ方になる。
  // 保存できたときだけ祝う。
  try {
    store.set('game', { ...game, badges: [...game.badges, ...earned] });
  } catch {
    toast('称号を保存できませんでした（端末の空き容量を確認してください）');
    return;
  }
  for (const id of earned) {
    const badge = BADGES.find((b) => b.id === id);
    if (badge) toast(`称号解放「${badge.name}」`, 3000, '', 'i-crest');
  }
}

async function renderTimeline() {
  const all = await listPhotos();
  // 再描画のたびに写真枚数分のURLを新規発行するので、直前の分を必ず解放する。
  // しないと写真タブに来るたびに全写真ぶんのBlobが積み上がる。
  for (const u of timelineUrls) URL.revokeObjectURL(u);
  timelineUrls = all.map((p) => toUrl(p));
  $('#timeline').innerHTML = all.length === 0
    ? '<p class="muted">まだ写真がありません</p>'
    : all.map((p, idx) => `
        <div class="ex">
          <div class="ex-head">
            <span>${p.date} / ${esc(ANGLES.find((a) => a.id === p.angle)?.label ?? p.angle)}</span>
            <button data-delphoto="${p.id}">削除</button>
          </div>
          <img src="${timelineUrls[idx]}" style="width:80px;border-radius:6px" alt="">
        </div>`).join('');

  $('#timeline').onclick = async (e) => {
    const btn = e.target.closest('[data-delphoto]');
    if (!btn) return;
    if (!confirm('この写真を削除しますか？（元に戻せません）')) return;
    await deletePhoto(Number(btn.dataset.delphoto));
    await renderTimeline();
    await showGhost();
  };
}
