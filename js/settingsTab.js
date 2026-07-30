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
      <div class="ex-ctrl">身長 <input type="number" id="tHeight" value="${profile.height}" style="width:80px">cm</div>
      <div class="ex-ctrl">体重 <input type="number" id="tWeight" value="${profile.weight}" style="width:80px">kg</div>
      <p class="muted">この体重はInBody記録が無いときのフォールバックです。InBody記録があれば常にそちらの最新値を優先して総挙上量・XPを計算します。</p>
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
      <p class="muted">食事写真・レシート画像・インボディ結果紙の写真の3種類がGoogleに送信されます。インボディ結果紙の写真には体重・筋肉量・体脂肪率が写っています。撮影タブの体の進捗写真や、保存済みのトレーニング記録・体重の履歴データは送信されません。無料枠内で動作します。</p>
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
    const height = Number($('#tHeight').value);
    const weight = Number($('#tWeight').value);
    const protein = Number($('#tProtein').value);
    const kcalMin = Number($('#tKcalMin').value);
    const kcalMax = Number($('#tKcalMax').value);
    const kcalFloor = Number($('#tKcalFloor').value);
    const alcoholMl = Number($('#tAlcohol').value);

    // 空欄で保存すると Number('') === 0 になり、js/nutrition.js は目標が0以下の
    // 項目を「警告なし」として扱う。このユーザーはカロリーを削りたい衝動を
    // 自覚しているため、空欄/0での保存は警告を恒久的に無効化する抜け道になる。
    for (const [label, v] of [
      ['身長', height], ['体重', weight], ['タンパク質目標', protein],
      ['カロリー下限', kcalMin], ['カロリー上限', kcalMax], ['警告ライン', kcalFloor]
    ]) {
      if (!Number.isFinite(v) || v <= 0) {
        toast(`${label}には0より大きい数値を入力してください`);
        return;
      }
    }
    if (!Number.isFinite(alcoholMl) || alcoholMl < 0) {
      toast('発泡酒の目標には0以上の数値を入力してください');
      return;
    }
    if (kcalMin > kcalMax) {
      toast('カロリー下限は上限以下にしてください');
      return;
    }
    // 1200kcalを下回る設定は拒否する。トレーニングを続ける以上、これより下は
    // 筋肉の分解が進む領域であり、警告ライン自体をそこまで下げさせない。
    if (kcalFloor < 1200) {
      toast('警告ラインは1200kcal未満にはできません（それを下回ると筋肉が分解されます）');
      return;
    }

    store.set('profile', { ...profile, height, weight, targets: { protein, kcalMin, kcalMax, kcalFloor, alcoholMl } });
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
