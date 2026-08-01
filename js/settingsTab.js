import { $, onShow, toast, esc, todayStr } from './ui.js';
import {
  estimateFfmKg, eaFloorKcal, dailyExerciseKcal,
  macroTargets, estimateMaintenance, equationMaintenanceEstimate
} from './energy.js';
import { latestBody, currentBodyweight } from './body.js';
import { microTargetsForAge, applyAldh2Answer, alcoholGrams, ALCOHOL_RISK_G } from './micronutrients.js';

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
      <div class="ex-ctrl">身長 <input type="number" inputmode="decimal" id="tHeight" value="${profile.height}" style="width:80px">cm</div>
      <div class="ex-ctrl">体重 <input type="number" inputmode="decimal" id="tWeight" value="${profile.weight}" style="width:80px">kg</div>
      <p class="muted">この体重はInBody記録が無いときのフォールバックです。InBody記録があれば常にそちらの最新値を優先して総挙上量・XPを計算します。</p>
      <div class="ex-ctrl">年齢 <input type="number" inputmode="numeric" id="tAge" value="${profile.age}" style="width:80px">歳</div>
      <p class="muted">基礎代謝の計算式、および食物繊維・カルシウムの基準値(日本人の食事摂取基準2025年版は18-29歳/30-49歳で異なる値を定めている)の年代判定に使います。</p>
      <div class="ex-ctrl">タンパク質 <input type="number" inputmode="decimal" id="tProtein" value="${t.protein}" style="width:80px">g</div>
      <div class="ex-ctrl">カロリー下限 <input type="number" inputmode="numeric" id="tKcalMin" value="${t.kcalMin}" style="width:90px"></div>
      <div class="ex-ctrl">カロリー上限 <input type="number" inputmode="numeric" id="tKcalMax" value="${t.kcalMax}" style="width:90px"></div>
      <div class="ex-ctrl">警告ライン <input type="number" inputmode="numeric" id="tKcalFloor" value="${t.kcalFloor}" style="width:90px"></div>
      <div class="ex-ctrl">アルコール量の目安 <input type="number" inputmode="numeric" id="tAlcohol" value="${t.alcoholMl}" style="width:90px">ml</div>
      <p class="muted">純アルコール換算で約${Math.round(alcoholGrams(t.alcoholMl))}g/日相当です(度数5%換算。食事タブ・上のバーには常にこの純アルコール(g)換算で表示されます)。
        参考: MHLW「飲酒ガイドライン」(2024)は男性で生活習慣病のリスクが高まる目安を1日${ALCOHOL_RISK_G}gとしています。危険という意味ではなく、比較のための目安です。</p>
      <p class="muted">警告ラインを下回った日は「食べなさすぎ」の警告が出ます。摂取を削るほど筋肉が落ちるため、下限側を守る設計です。</p>
      <button id="btnSaveTargets" class="primary">保存</button>
    </div>

    <div class="card">
      ${renderMacroCard()}
    </div>

    <div class="card">
      ${renderMicroCard(profile)}
    </div>

    <div class="card">
      <h2 style="margin-top:0">体質に関する質問</h2>
      <p class="muted">お酒を飲むと顔が赤くなりますか？　食事タブで一度だけお聞きする質問ですが、ここからいつでも回答を変更できます。</p>
      <select id="tAldh2">
        <option value="" ${profile.aldh2Flushing == null ? 'selected' : ''}>未回答</option>
        <option value="yes" ${profile.aldh2Flushing === 'yes' ? 'selected' : ''}>はい(顔が赤くなる)</option>
        <option value="no" ${profile.aldh2Flushing === 'no' ? 'selected' : ''}>いいえ</option>
        <option value="skipped" ${profile.aldh2Flushing === 'skipped' ? 'selected' : ''}>あとで(食事タブでは聞かない)</option>
      </select>
      <button id="btnSaveAldh2" class="primary" style="margin-left:8px">保存</button>
    </div>

    <div class="card">
      <h2 style="margin-top:0">写真・レシート解析</h2>
      <div class="ex-ctrl">Gemini APIキー <input type="password" id="geminiKey" value="${esc(settings.geminiKey)}" style="flex:1"></div>
      <p class="muted">食事写真・レシート画像・インボディ結果紙の写真の3種類がGoogleに送信されます。インボディ結果紙の写真には体重・筋肉量・体脂肪率が写っています。撮影タブの体の進捗写真や、保存済みのトレーニング記録・体重の履歴データは送信されません。無料枠内で動作します。</p>
      <label class="ex-ctrl"><input type="checkbox" id="useOff" ${settings.useOpenFoodFacts ? 'checked' : ''}>
        バーコード検索でOpen Food Factsに問い合わせる（送信するのはJANコード13桁のみ）</label>
      <label class="ex-ctrl"><input type="checkbox" id="useWakeLock" ${settings.wakeLock ? 'checked' : ''}>
        トレーニング中は画面を常にオンにする（バッテリーを消費します）</label>
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
    const age = Number($('#tAge').value);
    const protein = Number($('#tProtein').value);
    const kcalMin = Number($('#tKcalMin').value);
    const kcalMax = Number($('#tKcalMax').value);
    const kcalFloor = Number($('#tKcalFloor').value);
    const alcoholMl = Number($('#tAlcohol').value);

    // 空欄で保存すると Number('') === 0 になり、js/nutrition.js は目標が0以下の
    // 項目を「警告なし」として扱う。このユーザーはカロリーを削りたい衝動を
    // 自覚しているため、空欄/0での保存は警告を恒久的に無効化する抜け道になる。
    for (const [label, v] of [
      ['身長', height], ['体重', weight], ['年齢', age], ['タンパク質目標', protein],
      ['カロリー下限', kcalMin], ['カロリー上限', kcalMax], ['警告ライン', kcalFloor]
    ]) {
      if (!Number.isFinite(v) || v <= 0) {
        toast(`${label}には0より大きい数値を入力してください`);
        return;
      }
    }
    if (age < 18 || age > 100) {
      toast('年齢には18〜100の範囲で入力してください');
      return;
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

    // EA(エネルギー可用性)フロア(js/energy.js の eaFloorKcal: 30 × FFM + 運動消費kcal、
    // ACSM/AND/DC 2016)より低い警告ラインを設定しようとしていないか確認する。
    // ブロックはしない(このユーザー自身がEAフロアを下回る値を意図的に設定したい
    // 場面もありうるため)が、その場合に何が起きるか(EAの目安を下回っても警告が
    // 出なくなる)を数字付きで伝える。
    // InBody記録が無くても estimateFfmKg が今保存しようとしている体重から概算FFMを
    // 返すため判定は続ける(体組成未計測=判定しない、という以前の回帰と同じ問題を
    // ここでも避ける)。ただし概算FFMを使った場合はその旨を文言に明記する。
    const body = store.get('body');
    const latest = latestBody(body);
    const weightForExercise = currentBodyweight(body, { ...profile, weight });
    const ffmResult = estimateFfmKg(latest, weightForExercise);
    let floorWarning = null;
    if (ffmResult) {
      const { ffmKg, estimated } = ffmResult;
      const exerciseKcal = dailyExerciseKcal(store.get('workouts'), store.get('badminton'), todayStr(), weightForExercise);
      const eaFloor = eaFloorKcal(ffmKg, exerciseKcal);
      if (Number.isFinite(eaFloor) && eaFloor > 0 && kcalFloor < eaFloor) {
        const basis = estimated ? '(体組成未計測のため体重からの概算FFM)' : '';
        floorWarning = `保存しました。ただしエネルギー可用性(EA)の目安では約${Math.round(eaFloor)}kcalが警告ラインの目安です${basis}。これより低く設定すると、その目安を下回っても「食べなさすぎ」警告が出ません`;
      }
    }

    // profile.weight はInBody記録が無いときのvolume計算のフォールバックそのものに
    // なったため、ここでの保存失敗を黙って無視できない(他の保存パスと同様に
    // try/catchで失敗を検知し、ボタンが何も言わずに無反応になるのを防ぐ)。
    try {
      store.set('profile', { ...profile, height, weight, age, targets: { protein, kcalMin, kcalMax, kcalFloor, alcoholMl } });
    } catch {
      toast('保存できませんでした（端末の空き容量を確認してください）');
      return;
    }
    toast(floorWarning ?? '目標を保存しました', floorWarning ? 6000 : undefined);
  });

  $('#btnSaveAldh2').addEventListener('click', () => {
    const value = $('#tAldh2').value;
    const answer = value === '' ? null : value;
    try {
      store.set('profile', applyAldh2Answer(store.get('profile'), answer));
    } catch {
      toast('保存できませんでした（端末の空き容量を確認してください）');
      return;
    }
    toast('回答を保存しました');
  });

  $('#btnSaveSettings').addEventListener('click', () => {
    try {
      store.set('settings', {
        ...settings,
        geminiKey: $('#geminiKey').value.trim(),
        useOpenFoodFacts: $('#useOff').checked,
        wakeLock: $('#useWakeLock').checked
      });
    } catch {
      toast('保存できませんでした（端末の空き容量を確認してください）');
      return;
    }
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

/**
 * PFC(タンパク質・脂質・炭水化物)の計算目標カード(js/energy.js の macroTargets)。
 * 式そのものを画面に出す方針(js/recordTab.js の renderEnergyCard と同じ考え方):
 * 数字だけ見せて仕組みを隠すと、このユーザーがまた「もっと削ってもいいはず」と
 * 思ったときに検算できない。
 *
 * energyKcal には targets.kcalMin(このアプリが「最低限ここまでは食べる」としている値)を使う。
 * inDeficit は推定維持カロリー(estimateMaintenance)と比べて、kcalMinがそれを下回っていれば
 * 赤字期とみなす。維持カロリーが不明(データ不足)なら赤字だと決めつけない(false)。
 *
 * status: 'energyTooLow' のときは、緩和後もなお炭水化物が目安に届かないという結果を
 * そのまま算式つきで表示し、数値を静かに帳尻合わせしない(このユーザーが1,200kcal台への
 * 削減を繰り返し提案してきた経緯を踏まえた設計)。
 */
function renderMacroCard() {
  const profile = store.get('profile');
  const targets = profile.targets;
  const body = store.get('body');
  const latest = latestBody(body);
  const weightForExercise = currentBodyweight(body, profile);
  const ffmResult = estimateFfmKg(latest, weightForExercise);
  const ffmKg = ffmResult ? ffmResult.ffmKg : null;
  const ffmEstimated = ffmResult ? ffmResult.estimated : false;
  const exerciseKcal = dailyExerciseKcal(store.get('workouts'), store.get('badminton'), todayStr(), weightForExercise);

  if (!ffmResult) {
    return `<h2 style="margin-top:0">PFC目標(計算値)</h2>
      <p class="muted">体重が記録されていないため、タンパク質・脂質・炭水化物の目標を計算できません。</p>`;
  }

  const equationEstimate = equationMaintenanceEstimate({
    ffmKg,
    weightKg: profile.weight,
    heightM: profile.height / 100,
    ageYears: profile.age,
    isMale: profile.sex === 'male',
    exerciseKcalPerDay: exerciseKcal
  });
  const maintenance = estimateMaintenance(store.get('meals'), body, todayStr(), equationEstimate);
  const inDeficit = Number.isFinite(maintenance.kcal) && targets.kcalMin < maintenance.kcal;

  const macro = macroTargets({ energyKcal: targets.kcalMin, ffmKg, weightKg: weightForExercise, inDeficit });
  if (!macro) {
    return `<h2 style="margin-top:0">PFC目標(計算値)</h2>
      <p class="muted">目標エネルギー・体重・FFMのいずれかが不正なため計算できません。</p>`;
  }

  const ffmLabel = ffmEstimated ? `${ffmKg.toFixed(1)}kg(推定)` : `${ffmKg.toFixed(1)}kg`;
  const perFfmCoef = inDeficit ? 2.8 : 2.4;

  const statusBlock = macro.status === 'energyTooLow'
    ? `<p class="warn danger" style="margin:8px 0">
         <strong>カロリー目標(${targets.kcalMin}kcal)が低すぎます。</strong><br>
         タンパク質(${macro.proteinG.toFixed(1)}g)・脂質(${macro.fatG.toFixed(1)}g)を下限まで下げても、
         炭水化物は ${targets.kcalMin} − 4×${macro.proteinG.toFixed(1)} − 9×${macro.fatG.toFixed(1)} = ${(macro.carbG * 4).toFixed(1)}kcal
         (÷4 = ${macro.carbG.toFixed(1)}g、体重1kgあたり${macro.carbPerKg.toFixed(1)}g)にしかならず、
         目安の体重×3g(${(3 * weightForExercise).toFixed(0)}g)に届きません。数値を静かに帳尻合わせせず、
         そのままお見せしています。カロリー目標そのものを引き上げてください。</p>`
    : macro.status === 'relaxed'
      ? `<p class="muted">炭水化物の目安を満たすため、タンパク質・脂質の一部を下限まで緩めています(下記の注記参照)。</p>`
      : '';

  const notesBlock = macro.notes.length
    ? `<p class="muted">${macro.notes.map(esc).join('<br>')}</p>`
    : '';

  return `<h2 style="margin-top:0">PFC目標(計算値)</h2>
    <p class="muted">除脂肪量(FFM) ${ffmLabel} ・ 体重 ${weightForExercise.toFixed(1)}kg ・
      目標エネルギー ${targets.kcalMin}kcal(${inDeficit ? 'エネルギー赤字期の目安' : '通常時の目安'})</p>
    <p>タンパク質: <strong>${macro.proteinG.toFixed(1)}g</strong>
      <span class="muted">= ${perFfmCoef}×FFM、[体重×1.6, 体重×2.2]の範囲にクランプ</span></p>
    <p>脂質: <strong>${macro.fatG.toFixed(1)}g</strong>
      <span class="muted">= max(体重×0.5, 20%E÷9)</span></p>
    <p>炭水化物: <strong>${macro.carbG.toFixed(1)}g</strong>(体重1kgあたり${macro.carbPerKg.toFixed(1)}g)
      <span class="muted">= (E − 4×タンパク質 − 9×脂質) ÷ 4</span></p>
    ${statusBlock}
    ${notesBlock}
    <p class="muted">出典の要点: タンパク質はRefalo/Trexler/Helms 2025・Morton 2018・ISSN 2017・Helms 2014に基づきFFM基準・赤字期は係数を引き上げ。
      脂質はACSM 2016・Ruiz-Castellano 2021・日本人の食事摂取基準2025年版の20〜30%Eの下限を採用。
      炭水化物はACSM 2016の運動量別レンジ(軽度3〜5g/kg)の下限をトリップワイヤーにしています。</p>`;
}

/**
 * 食物繊維・ビタミンD・カルシウム・食塩相当量の基準値(js/micronutrients.js の
 * microTargetsForAge)を、根拠となる年代区分つきで表示するだけのカード。
 * 食事タブの参考栄養素カードが「今日どれだけ摂ったか」を見せるのに対し、
 * こちらは「その基準値がどこから来ているか(年代・出典)」を確認する場所として分ける。
 */
function renderMicroCard(profile) {
  const t = microTargetsForAge(profile.age);
  const bandLabel = t.band === '18-29' ? '18〜29歳' : '30〜49歳';
  return `<h2 style="margin-top:0">参考栄養素の基準値</h2>
    <p class="muted">年齢${profile.age}歳 → ${bandLabel}の基準値を使用しています(日本人の食事摂取基準2025年版)。</p>
    <p>食物繊維: <strong>${t.fibreG}g/日</strong> <span class="muted">目標量</span></p>
    <p>ビタミンD: <strong>${t.vitaminDUg}µg/日</strong> <span class="muted">目安量(耐容上限量 ${t.vitaminDUlUg}µg)</span></p>
    <p>カルシウム: <strong>${t.calciumMg}mg/日</strong> <span class="muted">推奨量(耐容上限量 ${t.calciumUlMg}mg)</span></p>
    <p>食塩相当量: <strong>${t.saltG}g未満/日</strong> <span class="muted">目標量(重症化予防の目安 ${t.saltSevereG}g)</span></p>
    <p class="muted">いずれも実測ではなく基準値です。食事タブの「参考栄養素」カードで今日の実際の記録と見比べられます。</p>`;
}
