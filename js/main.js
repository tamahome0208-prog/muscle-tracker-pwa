import { createStore } from './store.js';
import { initTabs, todayStr, esc } from './ui.js';
import { initMealTab } from './mealTab.js';
import { initWorkoutTab } from './workoutTab.js';
import { initPhotoTab, stopCamera } from './photoTab.js';
import { initRecordTab } from './recordTab.js';
import { initHomeTab } from './homeTab.js';
import { initSettingsTab } from './settingsTab.js';

export const store = createStore();

async function loadSeed() {
  const exercises = store.get('exercises');
  if (exercises.length === 0) {
    store.set('exercises', await (await fetch('data/exercises.json')).json());
  } else if (exercises.some((e) => !e.load)) {
    // 既存インストールは種目マスタが「体重を考慮した総挙上量」対応より前の
    // シードのまま localStorage に残っており、load フィールドを持たない。
    // 種目データはユーザーが編集するUIを持たない参照データなので、
    // data/exercises.json から id 一致で load だけを補ってやり直しの
    // シードとせず安全に移行できる。これをしないとアシスト/自重種目の
    // 総挙上量・XPが既存ユーザーの端末では恒久的に0のままになる。
    const master = await (await fetch('data/exercises.json')).json();
    const loadById = new Map(master.map((e) => [e.id, e.load]));
    store.set('exercises', exercises.map((e) => ({ ...e, load: loadById.get(e.id) ?? e.load })));
  }
  if (store.get('foods').length === 0) {
    store.set('foods', await (await fetch('data/foods.json')).json());
  }
  const profile = store.get('profile');
  if (!profile.startDate) {
    store.set('profile', { ...profile, startDate: todayStr() });
  }
}

async function boot() {
  try {
    const repaired = store.validate();
    if (repaired.length) {
      console.warn('破損したデータを初期化しました:', repaired);
    }
    await loadSeed();
    initMealTab(store);
    initWorkoutTab(store);
    initPhotoTab(store);
    initRecordTab(store);
    initHomeTab(store);
    initSettingsTab(store);
    initTabs();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    document.querySelectorAll('#tabbar button').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab !== 'photo') stopCamera();
      });
    });
  } catch (err) {
    // store.validate() や loadSeed() がここで例外を投げると、initTabs() が
    // 一度も呼ばれずタブボタンのイベントリスナーが1つも付かないまま終わる。
    // その結果、画面には6つのタブボタンがあるのに何を押しても反応しない
    // 「死んだアプリ」になる。最低限の説明だけは #tab-home に描画する。
    console.error('起動に失敗しました:', err);
    const home = document.querySelector('#tab-home');
    if (home) {
      home.innerHTML = `
        <div class="card">
          <h2 style="margin-top:0">起動できませんでした</h2>
          <p class="muted">データの読み込み中にエラーが発生しました。一度ページを再読み込みしてください。</p>
          <p class="muted">改善しない場合は、設定タブのバックアップ機能を使えるなら復元をお試しください。</p>
          <p class="muted">詳細: ${esc(err?.message ?? String(err))}</p>
        </div>`;
    }
  }
}

boot();
