import { $, onShow, toast, esc } from './ui.js';

let store;

export function initSettingsTab(s) {
  store = s;
  onShow('settings', renderSettingsTab);
}

export function renderSettingsTab() {
  const profile = store.get('profile');
  const settings = store.get('settings');
  const t = profile.targets;

  $('#tab-settings').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">目標</h2>
      <div class="ex-ctrl">タンパク質 <input type="number" id="tProtein" value="${t.protein}" style="width:80px">g</div>
      <div class="ex-ctrl">カロリー下限 <input type="number" id="tKcalMin" value="${t.kcalMin}" style="width:90px"></div>
      <div class="ex-ctrl">カロリー上限 <input type="number" id="tKcalMax" value="${t.kcalMax}" style="width:90px"></div>
      <div class="ex-ctrl">警告ライン <input type="number" id="tKcalFloor" value="${t.kcalFloor}" style="width:90px"></div>
      <div class="ex-ctrl">発泡酒 <input type="number" id="tAlcohol" value="${t.alcoholMl}" style="width:90px">ml</div>
      <p class="muted">警告ラインを下回った日は「食べなさすぎ」の警告が出ます。摂取を削るほど筋肉が落ちるため、下限側を守る設計です。</p>
      <button id="btnSaveTargets" class="primary">保存</button>
    </div>

    <div class="card">
      <h2 style="margin-top:0">写真・レシート解析</h2>
      <div class="ex-ctrl">Gemini APIキー <input type="password" id="geminiKey" value="${esc(settings.geminiKey)}" style="flex:1"></div>
      <p class="muted">食事写真とレシート画像だけがGoogleに送信されます。体の写真・体重・トレ記録は送信されません。無料枠内で動作します。</p>
      <label class="ex-ctrl"><input type="checkbox" id="useOff" ${settings.useOpenFoodFacts ? 'checked' : ''}>
        バーコード検索でOpen Food Factsに問い合わせる（送信するのはJANコード13桁のみ）</label>
      <button id="btnSaveSettings" class="primary">保存</button>
    </div>

    <div class="card">
      <h2 style="margin-top:0">バックアップ</h2>
      <div class="chips">
        <button id="btnExport">エクスポート</button>
        <button id="btnImport">インポート</button>
      </div>
      <p class="muted">記録データをJSONで書き出します。体の写真は含まれません（端末内のIndexedDBにのみ保存されます）。</p>
      <input type="file" id="importFile" accept="application/json" class="hidden">
    </div>`;

  $('#btnSaveTargets').addEventListener('click', () => {
    store.set('profile', {
      ...profile,
      targets: {
        protein: Number($('#tProtein').value),
        kcalMin: Number($('#tKcalMin').value),
        kcalMax: Number($('#tKcalMax').value),
        kcalFloor: Number($('#tKcalFloor').value),
        alcoholMl: Number($('#tAlcohol').value)
      }
    });
    toast('目標を保存しました');
  });

  $('#btnSaveSettings').addEventListener('click', () => {
    store.set('settings', {
      ...settings,
      geminiKey: $('#geminiKey').value.trim(),
      useOpenFoodFacts: $('#useOff').checked
    });
    toast('設定を保存しました');
  });

  $('#btnExport').addEventListener('click', () => {
    const blob = new Blob([store.exportAll()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `muscle-tracker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#btnImport').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm('現在の記録を上書きします。よろしいですか？')) return;
    try {
      store.importAll(await file.text());
      toast('インポートしました');
      location.reload();
    } catch (err) {
      toast(err.message);
    }
  });
}
