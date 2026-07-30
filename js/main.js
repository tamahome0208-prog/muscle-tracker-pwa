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
    const res = await fetch('data/exercises.json');
    // キャプティブポータル/404はHTMLを200以外、あるいは200でもJSONでない本文を返す。
    // res.ok を見ずに .json() すると SyntaxError で loadSeed() 全体が失敗し、
    // (以前は)initTabs() が一度も呼ばれず全タブが無反応になっていた。
    if (!res.ok) throw new Error(`種目マスタの取得に失敗しました (status ${res.status})`);
    store.set('exercises', await res.json());
    // 新規インストールは既に最新のmasterそのものなので、次回起動時に無駄な
    // 再同期(下のexercisesSyncedV2分岐)を走らせないよう、ここでフラグも立てる。
    store.set('profile', { ...store.get('profile'), exercisesSyncedV2: true });
  } else if (!store.get('profile').exercisesSyncedV2) {
    // 既存インストールは種目マスタが「体重を考慮した総挙上量」対応より前の
    // シードのまま localStorage に残っており、load フィールドを持たない場合がある。
    // 種目データはユーザーが編集するUIを持たない参照データ(見た目上のキャッシュ)
    // なので、id が一致すれば data/exercises.json の内容で丸ごと置き換えてよい。
    //
    // 以前は exercises.some(e => !e.load) をトリガーにしていたが、これだと
    // 「loadフィールドの移行(前回のデプロイ)は既に完了しているが、loadFactorの
    // ような後から master に増えたフィールドはまだ持っていない」端末が
    // 二度とこの分岐を通らず、loadFactor が既存ユーザーの端末には永久に届かない
    // ことが実機検証で分かった。そのため js/main.js の profile.volumeModelMigrated
    // と同じ「一度きりの移行フラグ」方式に変更し、フィールド単位ではなく
    // 「一度だけ丸ごと再同期する」動作を保証する。
    //
    // この移行専用に try/catch で囲む: キャプティブポータル等でこのfetchが
    // 失敗しても、起動中のインストール済みアプリを丸ごと落とさず今回の移行だけ
    // スキップする。失敗時はフラグを立てないので次回起動時に自動的に再試行される。
    try {
      const res = await fetch('data/exercises.json');
      if (!res.ok) throw new Error(`種目マスタの取得に失敗しました (status ${res.status})`);
      const master = await res.json();
      const masterById = new Map(master.map((e) => [e.id, e]));
      store.set('exercises', exercises.map((e) => {
        const found = masterById.get(e.id);
        if (found) return { ...found };
        // master に無い(削除・改名された)idはそのまま保持しつつ、load だけは
        // 'external' にフォールバックする(undefinedのままだとJSON.stringifyが
        // キー自体を落とし、他のロジックがload欠損を検知できなくなるため)。
        return { ...e, load: e.load ?? 'external' };
      }));
      store.set('profile', { ...store.get('profile'), exercisesSyncedV2: true });
    } catch (err) {
      console.warn('種目マスタの同期に失敗しました。今回の起動はスキップします:', err);
    }
  }

  if (store.get('foods').length === 0) {
    const res = await fetch('data/foods.json');
    if (res.ok) store.set('foods', await res.json());
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
  } catch (err) {
    console.error('store.validate() に失敗しました:', err);
  }

  try {
    await loadSeed();
  } catch (err) {
    // loadSeed() が失敗しても(キャプティブポータル等)、それだけを理由に
    // initTabs() をスキップしてはならない。以前はここで例外が外側の catch まで
    // 伝播し、initTabs() が一度も呼ばれずタブボタンのイベントリスナーが1つも
    // 付かないまま終わっていた。ローカルのデータ自体は無事なので、通常起動を続ける。
    console.warn('起動時のデータ読み込みに失敗しました。今回はスキップして通常起動します:', err);
  }

  try {
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
    // 各タブの init 自体が例外を投げた場合(プログラムのバグ)は、initTabs() が
    // 呼ばれずタブボタンのイベントリスナーが1つも付かないまま終わる。
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
