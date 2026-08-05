// このモジュールの契約(store.js を利用する全モジュールが前提としてよいこと):
//
// 1. get() が返す値は常にコピーである。呼び出し側がその場で mutate しても、
//    set() を呼ばない限り永続化(localStorage)にもキャッシュにも反映されない。
//    例: const w = store.get('workouts'); w.push(x); // ここではまだ何も保存されていない
//        store.set('workouts', w);                    // この行で初めて保存される
//
// 2. 参照の同一性は保証されない。
//    store.get('workouts')[0] !== store.get('workouts')[0] (呼ぶたびに新しいコピー)。
//    そのため `===` によるオブジェクト比較や、エンティティそのものをキーにした
//    Set/Map には依存しないこと。id などのプリミティブ値で同一性を判定すること。

export const SCHEMA_VERSION = 1;

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// targets.kcalFloor の既定値の根拠(js/energy.js の eaFloorKcal を参照):
// 以前は「男性は1,500kcalを下回るべきでない」という出典不明の固定値だった。
// これをEA(エネルギー可用性)フロア = 30 × FFM(kg) + 運動消費kcal (ACSM/AND/DC 2016)
// に置き換える。ただしDEFAULTSはモジュール読み込み時に一度だけ確定する静的な値であり、
// 実際のFFM(InBody記録が必要)はまだ存在しないため、ここでは「新規インストール直後、
// InBody記録も運動記録もまだ無い状態」を仮定した保守的な初期値を計算しておく:
//   仮のFFM = 60kg × (1 − 20%) = 48kg (このユーザー属性=162cm/60kg/初心者男性の
//   体脂肪率として一般的なレンジの目安であり、実測ではない)
//   運動消費 = 0kcal (記録がまだ無い時点での保守的な下限。運動記録が増えるほど
//   js/nutrition.js の achievement() が計算する実際のEAフロアはこれより高くなる)
//   floor = 30 × 48 + 0 = 1,440kcal
// InBody記録が入り次第、achievement() はこの静的な既定値を使わず実測FFMベースの
// EAフロアに自動的に切り替わる(js/nutrition.js 参照)。この値はあくまで
// 「まだ何も記録していない最初の数日」のためのプレースホルダーであり、
// targets.kcalFloor は引き続きユーザーが設定タブで上書き可能。
const DEFAULT_KCAL_FLOOR = 1440;

export const DEFAULTS = deepFreeze({
  profile: {
    height: 162,
    weight: 60,
    // age/sex: js/energy.js の rmrTenHaaf(FFM不明時のフォールバック基礎代謝式)に必要。
    // このアプリは単一ユーザー(男性)前提だが実年齢は把握していないため、
    // 35歳を暫定の既定値とする(このアプリの研究メモが基礎代謝の計算例として使っている
    // 年齢でもある)。実年齢が分かっている場合は正確な値に置き換えることが望ましいが、
    // 現状の設定タブにはage入力欄が無いため、当面はこの既定値で計算される。
    age: 35,
    sex: 'male',
    startDate: null,
    targets: { protein: 100, kcalMin: 1700, kcalMax: 1800, kcalFloor: DEFAULT_KCAL_FLOOR, alcoholMl: 500 },
    // ALDH2(アルコール分解酵素)のフラッシング(飲酒で顔が赤くなる)質問への回答。
    // null = 未回答(js/mealTab.js が食事タブで一度だけ質問を出す)。
    // 'yes' / 'no' / 'skipped' のいずれかになった後は自動では二度と質問を出さない
    // (設定タブからいつでも再回答できる。js/settingsTab.js 参照)。
    aldh2Flushing: null,
    // 'yes' 回答時に一度だけ出す注記(js/mealTab.js)を閉じたかどうか。
    // 「今日は消したが明日また出る」という日次の再表示はしない(ブリーフの要求通り、
    // 毎日繰り返さない)。設定タブで回答を'yes'に変更した場合はこのフラグを
    // falseに戻し、少なくとも一度は再度目にするようにする。
    aldh2NoticeDismissed: false,
    // 目標(js/goals.js)。ユーザーは細マッチョ(写真で示された、痩せ型で筋肉の輪郭が見える体型)を
    // 目的として明言している。研究メモが示す翻訳(体脂肪8〜12%・FFMI 20〜21、162cmでは
    // 体重ほぼ現状維持のままFFM約54kgへ)のうち、レンジの中央値をデフォルトとして計算しておく:
    //   targetBodyFatPct: 10 (8〜12%の中央)
    //   targetFfmKg: 54 (体重60kg・体脂肪10%相当。研究メモの試算をそのまま採用)
    // この既定値は隠さず設定タブに表示し、いつでも上書きできるようにすること
    // (ブリーフの要求: 「the default must be visible and editable, not hidden」)。
    // 目標はユーザーのものであり、このアプリはクランプも拒否もしない
    // (js/goals.js の bodyFatGoalTension が緊張関係を説明はするが、値そのものは変えない)。
    goal: { targetBodyFatPct: 10, targetFfmKg: 54 }
  },
  workouts: [],
  exercises: [],
  meals: [],
  foods: [],
  body: [],
  badminton: [],
  game: {
    xp: { chest: 0, back: 0, shoulder: 0, leg: 0, arm: 0, abs: 0 },
    streakWeeks: 0,
    lastWeekKey: null,
    bests: {},
    badges: []
  },
  settings: {
    geminiKey: '', useOpenFoodFacts: true, photoReminder: true, wakeLock: true,
    // エクスポートを最後に行った日('YYYY-MM-DD')。未エクスポートなら null。
    // js/backupReminder.js の shouldShowBackupReminder がこれを見て「最近バックアップしたか」を判定する。
    lastExportDate: null,
    // バックアップリマインダー(js/homeTab.js)を最後に「あとで」で閉じた日。
    // 閉じてから一定期間(js/backupReminder.js の REMINDER_INTERVAL_DAYS)は再表示しない。
    backupReminderDismissedAt: null
  },
  // 進行中（未終了）のトレーニングセッション。Androidがバックグラウンドで
  // ページを破棄しても記録済みのセットを失わないための永続化用の場所。
  // date は「記録される対象の日付」(過去日の場合もある)、startedAt は
  // 「実際にこのセッションを開始した暦日」。startedAt が今日でなければ
  // 古いセッションとして復元時に破棄する（js/workout.js の restorableSession
  // を参照）。date だけで判定すると、過去日を選んでバックデート入力を始めた
  // セッションが「date=今日ではない」という理由で誤って古いものとして
  // 破棄されてしまう。
  session: { program: null, date: null, startedAt: null, sets: [] }
});

const KEY_PREFIX = 'mt.';
const isArrayKey = (key) => Array.isArray(DEFAULTS[key]);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// プレーンオブジェクトは再帰的にマージし、配列やプリミティブは丸ごと置き換える。
// 保存済みデータに一部の項目しか無くても、後から DEFAULTS に増えたネストした項目を補える。
function deepMerge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const result = { ...base };
  for (const key of Object.keys(override)) {
    result[key] = isPlainObject(base[key]) && isPlainObject(override[key])
      ? deepMerge(base[key], override[key])
      : override[key];
  }
  return result;
}

function isValidFor(key, value) {
  if (!(key in DEFAULTS)) return false;
  return isArrayKey(key) ? Array.isArray(value) : isPlainObject(value);
}

// importAll 専用のレコード形状チェック。isValidFor は「配列かどうか」しか見ないため、
// 手編集やスキーマの古いバックアップで datetime/items を欠いた meals レコードが
// 混ざっていても素通りしてしまう(js/mealTab.js が後段でそれを前提に描画して落ちる)。
// バックアップ全体を無効として弾くのはここだけの役割で、通常の store.set() の
// 挙動(既存テストが前提にしている)は変えない。
const IMPORT_RECORD_VALIDATORS = {
  meals: (m) => m != null && typeof m.datetime === 'string' && Array.isArray(m.items)
};

function isValidRecordShapeFor(key, value) {
  const validator = IMPORT_RECORD_VALIDATORS[key];
  if (!validator) return true;
  return Array.isArray(value) && value.every(validator);
}

export function createStore(storage = globalThis.localStorage) {
  const cache = new Map();

  // get/set で同じ正規化を通す: 配列はそのまま(クローンのみ)、オブジェクトは DEFAULTS と再帰マージ。
  function normalize(key, value) {
    if (isArrayKey(key)) return clone(value);
    const merged = deepMerge(DEFAULTS[key], value);
    // game.badges はネストしたフィールドのため、isValidFor は game オブジェクト
    // そのものが object であることしか検証できない。壊れたJSON編集やインポートで
    // badges が配列以外(数値・文字列等)に化けていても、ここで正規化しておけば
    // .includes/spread を使う全呼び出し側(js/workoutTab.js, js/photoTab.js 等)を
    // 個別にガードしなくて済む。
    if (key === 'game' && !Array.isArray(merged.badges)) merged.badges = [];
    return merged;
  }

  // 保存済みJSONを読み、パース失敗・型不一致を破損として検出したうえで正規化まで行う。
  function readValidated(key) {
    const raw = storage.getItem(KEY_PREFIX + key);
    if (raw === null) return { ok: true, value: clone(DEFAULTS[key]) };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, value: clone(DEFAULTS[key]) };
    }
    if (!isValidFor(key, parsed)) return { ok: false, value: clone(DEFAULTS[key]) };
    return { ok: true, value: normalize(key, parsed) };
  }

  function get(key) {
    if (!(key in DEFAULTS)) throw new Error(`未知のキー: ${key}`);
    if (!cache.has(key)) {
      const { value } = readValidated(key);
      cache.set(key, clone(value));
    }
    // キャッシュの実体ではなくスナップショットを返す。呼び出し側が set せずに mutate しても
    // キャッシュ/永続化には影響しない(= set し忘れによる「リロードで消えるゴーストデータ」を防ぐ)。
    return clone(cache.get(key));
  }

  function set(key, value) {
    if (!(key in DEFAULTS)) throw new Error(`未知のキー: ${key}`);
    if (!isValidFor(key, value)) {
      const expected = isArrayKey(key) ? '配列' : 'オブジェクト';
      throw new Error(`不正な値です(${key}): ${expected} を指定してください`);
    }
    const normalized = normalize(key, value);
    // 先に永続化し、成功した場合のみキャッシュを更新する。
    // setItem が QuotaExceededError 等で失敗した場合、キャッシュは古いままになり
    // get() が「保存済み」と偽って答えることがない。
    storage.setItem(KEY_PREFIX + key, JSON.stringify(normalized));
    cache.set(key, clone(normalized));
    return clone(normalized);
  }

  function validate() {
    const repaired = [];
    for (const key of Object.keys(DEFAULTS)) {
      const { ok, value } = readValidated(key);
      if (!ok) {
        repaired.push(key);
        storage.setItem(KEY_PREFIX + key, JSON.stringify(value));
        cache.set(key, clone(value));
      }
    }
    storage.setItem(KEY_PREFIX + 'schemaVersion', String(SCHEMA_VERSION));
    return repaired;
  }

  function exportAll() {
    const out = { schemaVersion: SCHEMA_VERSION };
    for (const key of Object.keys(DEFAULTS)) out[key] = get(key);
    // Gemini APIキーはバックアップ(端末外に持ち出される可能性が高いファイル)には含めない。
    if (out.settings) out.settings = { ...out.settings, geminiKey: '' };
    return JSON.stringify(out, null, 2);
  }

  function importAll(json) {
    let data;
    try {
      data = JSON.parse(json);
    } catch {
      throw new Error('インポートに失敗しました: JSONとして読めません');
    }
    if (!isPlainObject(data)) {
      throw new Error('インポートに失敗しました: 形式が不正です');
    }

    const targetKeys = Object.keys(DEFAULTS).filter((key) => key in data);

    // 書き込み前に全キーの形式を検証する。1つでも不正なら何も書き込まずに例外を投げる。
    for (const key of targetKeys) {
      if (!isValidFor(key, data[key])) {
        throw new Error(`インポートに失敗しました: ${key} の形式が不正です`);
      }
      if (!isValidRecordShapeFor(key, data[key])) {
        throw new Error(`インポートに失敗しました: ${key} のレコード形式が不正です`);
      }
    }

    // Gemini APIキーが空でインポートされた場合は、端末に既にある値を維持する
    // (同じ端末へ復元する際にキーを入れ直さずに済むように)。
    if (targetKeys.includes('settings') && !data.settings.geminiKey) {
      data.settings = { ...data.settings, geminiKey: get('settings').geminiKey };
    }

    const previousRaw = new Map();
    for (const key of targetKeys) previousRaw.set(key, storage.getItem(KEY_PREFIX + key));

    const applied = [];
    try {
      for (const key of targetKeys) {
        set(key, data[key]);
        applied.push(key);
      }
    } catch (err) {
      // 途中で setItem が失敗した場合、書き込み済みだった分を元の値に戻してから再スローする。
      // ロールバック自体の setItem/removeItem も(容量逼迫時などに)失敗しうるため、
      // 1件ずつ try/catch で囲んで残りの復元を続行し、元の例外(原因)を消さずに再スローする。
      const failedRollbacks = [];
      for (const key of applied) {
        try {
          const prev = previousRaw.get(key);
          if (prev === null) storage.removeItem(KEY_PREFIX + key);
          else storage.setItem(KEY_PREFIX + key, prev);
          cache.delete(key);
        } catch {
          failedRollbacks.push(key);
        }
      }
      if (failedRollbacks.length > 0) {
        err.message += ` (ロールバックにも失敗したキー: ${failedRollbacks.join(', ')})`;
      }
      throw err;
    }
  }

  return { get, set, validate, exportAll, importAll };
}
