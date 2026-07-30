import { bodyweightAsOf } from './body.js';

export const PROGRAMS = ['A', 'B', 'C'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 日付文字列が 'YYYY-MM-DD' 形式であり、かつ実在する暦日であるかを判定する。
 * 正規表現だけでは '2026-13-01' のように桁数は合うが実在しない日付を通してしまい、
 * weekKey に渡すと Invalid Date になる（かつては 'NaN-WNaN' という無意味な週キーを
 * 生んでいた）。workouts 等の信頼できない外部データを扱う関数（weeklyVolume,
 * weekFeasibility, programStatus, daysUntilDetraining, calcStreak,
 * initialPhaseStatus）は、weekKey を呼ぶ前に必ずこちらで弾くこと。
 */
export function isValidDateStr(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00Z');
  return !Number.isNaN(d.getTime());
}

/**
 * 日付文字列 'YYYY-MM-DD' の週キー（月曜始まり、ISO 8601週番号）を返す。例: '2026-W31'
 *
 * 不正な形式の入力（undefined・ゼロ埋め無し・'2026-13-01'のような実在しない日付など）は
 * 例外を投げる。これはプログラマのミスを黙って通さないための設計判断: 以前は不正入力で
 * 'NaN-WNaN' のような無意味なキーを返しており、文字列比較では 'N' > '2' のため週次集計の
 * 並びの最後（＝「最新週」として画面に出る位置）に紛れ込んでしまっていた。
 *
 * 一方 weeklyVolume() 等はこの関数と非対称に、不正な日付を持つ記録を例外を投げずに
 * 除外する（isValidDateStr で事前に弾いてから呼ぶ）。weeklyVolume 等はインポートされた
 * 記録など信頼できない外部データが入りうる境界であり、1件の壊れた記録のせいで週次集計
 * 全体が例外で落ちるのは避けたいため。
 */
export function weekKey(dateStr) {
  if (!isValidDateStr(dateStr)) {
    throw new Error(`weekKey: invalid date string: ${dateStr}`);
  }
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = (d.getUTCDay() + 6) % 7; // 月=0
  d.setUTCDate(d.getUTCDate() - day + 3); // その週の木曜
  const year = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * 週キーの1つ前の週キーを返す。年またぎは weekKey に計算させる。
 * weeklyVolume の系列は疎なので、消費側は「直前の要素＝先週」と決めつけず
 * この関数で隣接を確かめてから「先週比」と表示すること。
 */
export function previousWeekKey(week) {
  const [year, num] = String(week).split('-W').map(Number);
  const jan4 = Date.UTC(year, 0, 4);
  const monday = new Date(jan4);
  monday.setUTCDate(monday.getUTCDate() - ((new Date(jan4).getUTCDay() + 6) % 7) + (num - 2) * 7);
  return weekKey(monday.toISOString().slice(0, 10));
}

// a/b が null（壊れたレコード。store.importAll は配列かどうかしか検証しないため
// workouts: [null, …] が届き得る）でも例外を投げないよう optional chaining で読む。
// 日付が無い要素は '' 扱いにする(比較の並び順自体はどうでもよく、落ちないことが重要)。
function sortedByDate(workouts) {
  return [...workouts].sort((a, b) => {
    const ad = a?.date ?? '';
    const bd = b?.date ?? '';
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  });
}

/**
 * 曜日ではなく順送りで次のプログラムを決める。
 * 直近の記録の program が未知（不正値・undefined）な場合は、既知の program を持つ
 * 直近の記録まで遡って続きを決める。1件の壊れた記録のせいでローテーションが 'A' に
 * リセットされ、胸の日（A）が2連続になったり脚の日（C）が飛ばされたりする事故を防ぐため。
 */
export function nextProgram(workouts) {
  const sorted = sortedByDate(workouts).reverse();
  for (const w of sorted) {
    const index = PROGRAMS.indexOf(w?.program);
    if (index !== -1) return PROGRAMS[(index + 1) % PROGRAMS.length];
  }
  return 'A';
}

/**
 * 3プログラム全てについて「最後にやったのはいつか」「nextProgram が推す種目か」を
 * まとめて返す。PROGRAMS の順（A→B→C）で常に3件返す。
 *
 * 日付が不正・欠損な記録は（weeklyVolume 等と同様に）例外を投げずに黙って除外する。
 * workouts は storage / store.importAll から来る信頼できない外部データであり、
 * 1件の壊れた記録のせいで画面のチップ表示全体が例外で落ちるのは避けたいため。
 *
 * daysAgo は todayStr（'YYYY-MM-DD'）を基準にした暦日差。当日なら0。
 */
export function programStatus(workouts, todayStr) {
  const today = new Date(todayStr + 'T00:00:00Z');
  const recommended = nextProgram(workouts);
  const sorted = sortedByDate(workouts).reverse();

  return PROGRAMS.map((program) => {
    let lastDate = null;
    for (const w of sorted) {
      if (typeof w?.date !== 'string' || !DATE_RE.test(w.date)) continue;
      if (w.program === program) { lastDate = w.date; break; }
    }
    let daysAgo = null;
    if (lastDate !== null) {
      const d = new Date(lastDate + 'T00:00:00Z');
      daysAgo = Math.round((today - d) / (24 * 3600 * 1000));
    }
    return { program, lastDate, daysAgo, recommended: program === recommended };
  });
}

/**
 * 総挙上量 = Σ(重量 × 回数)。
 * weight/reps が数値化できない値（undefined など）でも NaN を伝播させず0として扱う
 * （防御的丸め）。NaN が混入すると reduce の結果・週合計・XP計算まで汚染され、
 * さらに JSON.stringify(NaN) は null になるため localStorage に null として永続化され
 * 以降の計算が恒久的に壊れる。
 *
 * context を省略した場合は従来どおり: 補助重量（負値）と自重（0）はそのまま
 * Math.max(0, weight) * reps で0になる。既存の呼び出し側・テストの挙動は変えない。
 *
 * context = { exercises, bodyweight } を渡すと種目の load に応じて体重を加味する:
 *  - 'external'（未知のexId・context省略時も含む） → Math.max(0, weight) * reps
 *  - 'assist' → Math.max(0, bodyweight*loadFactor + weight) * reps
 *      （weightは負の補助重量。60kgの人が-40kg補助なら実効負荷20kg）
 *  - 'bodyweight' → (bodyweight*loadFactor + Math.max(0, weight)) * reps
 *      （通常weightは0。外部負荷を足した場合はそれも加算する）
 * bodyweight が数値化できない/不正（NaN・文字列・**負値**を含む）な場合は0として扱い、
 * NaNを伝播させたり総挙上量・XPを減らしたりせず、従来どおりの挙動に緩やかに劣化させる。
 * 完了したワークアウトが体重データの破損によってXPを"減らす"ことは、設計上絶対に
 * 起きてはならない（このアプリのモチベーション機能はXP減衰・ペナルティを持たない）。
 *
 * exercises の各エントリは任意で loadFactor（既定1.0）を持てる。体重成分
 * （bodyweight * loadFactor）にだけ掛かる係数で、「アブコースターは体重の何割が
 * 実際に動くか」といった粗い近似を種目ごとに調整するためのもの。0以下・非数値なら
 * 1.0にフォールバックする（壊れたデータで体重成分が0や負になるのを防ぐ）。
 */
export function calcVolume(sets, context) {
  const exMap = context ? new Map(context.exercises?.map((e) => [e.id, e]) ?? []) : null;
  // Number(-60) は truthy なので `|| 0` だけでは負値を弾けない。Math.max(0, ...) で
  // 明示的にクランプする: 体重記録が壊れて負値になっても（js/body.js は正の有限数のみ
  // 受け付けるため通常は起きないが、多層防御として）実効負荷が負のまま計算に流れ込み
  // XPを減らす事故を防ぐ。
  const bodyweight = context ? Math.max(0, Number(context.bodyweight) || 0) : 0;

  return sets.reduce((sum, s) => {
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    const ex = exMap?.get(s.exId);
    const load = ex?.load;
    const rawLoadFactor = Number(ex?.loadFactor);
    const loadFactor = Number.isFinite(rawLoadFactor) && rawLoadFactor > 0 ? rawLoadFactor : 1;

    if (load === 'assist') return sum + Math.max(0, bodyweight * loadFactor + w) * r;
    if (load === 'bodyweight') return sum + (bodyweight * loadFactor + Math.max(0, w)) * r;
    return sum + Math.max(0, w) * r;
  }, 0);
}

/**
 * 週ごとの総挙上量。週キーの昇順で返す。
 * 返す配列は疎(sparse)である: トレーニングの無い週は要素自体が存在しないので、
 * 呼び出し側は連続した週番号の並びだとみなしてはならない（間の週を0として補完したい
 * 場合は呼び出し側で行うこと）。
 * 日付が不正な記録（weekKey が例外を投げる形式、null要素を含む）は、集計前に黙って除外する。
 */
export function weeklyVolume(workouts) {
  const map = new Map();
  for (const w of workouts) {
    if (!isValidDateStr(w?.date)) continue;
    const key = weekKey(w.date);
    const volume = w.volume ?? calcVolume(w.sets ?? []);
    map.set(key, (map.get(key) ?? 0) + volume);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, volume]) => ({ week, volume }));
}

/**
 * その種目の直近の重量・回数（同一セッション内では最後に記録したセット）。無ければ null。
 * workouts に null 要素（壊れたレコード）が混ざっていても例外を投げず読み飛ばす。
 */
export function lastSetFor(workouts, exId) {
  const sorted = sortedByDate(workouts).reverse();
  for (const w of sorted) {
    const hit = (w?.sets ?? []).filter((s) => s.exId === exId).pop();
    if (hit) return { weight: hit.weight, reps: hit.reps };
  }
  return null;
}

/** 重量優先、同重量なら回数で自己ベストを判定する */
export function isPB(bests, exId, weight, reps) {
  const best = bests[exId];
  if (!best) return true;
  if (weight > best.weight) return true;
  if (weight === best.weight && reps > best.reps) return true;
  return false;
}

/**
 * PBのときだけ更新した新しい bests を返す（元は変更しない）。
 * これは浅いコピー（shallow copy）である: 更新していない種目のエントリは入力の
 * オブジェクトと参照を共有している。呼び出し側は `next[otherExId].reps++` のような
 * 入れ子側の書き換えをしてはならない（元の bests を壊してしまう）。
 */
export function updateBests(bests, exId, weight, reps, date) {
  if (!isPB(bests, exId, weight, reps)) return { ...bests };
  return { ...bests, [exId]: { weight, reps, date } };
}

/**
 * 保存されていた進行中セッション(js/store.js の 'session' キー)を、今日
 * 開始されたセッションとして復元してよいか判定する。
 *
 * 判定は date ではなく startedAt(実際にこのセッションを開始した暦日)で行う。
 * date は「記録される対象の日付」であり、過去日を選んでバックデート入力を
 * 始めた場合は today と一致しない(それが本来の使い方)。startedAt が今日と
 * 一致しない場合だけ古いセッションとみなして復元しない(数日前に開始した
 * セッションが今日のものだと勘違いして蘇るのを防ぐ、という元の保護は維持する)。
 * date が(不正な形式も含め)無効、program が3種目のいずれでもない、または
 * sets が配列でない場合も壊れたデータとして復元しない。
 * 復元しない場合は null を返し、呼び出し側は新規セッションを開始すること。
 */
export function restorableSession(stored, todayStr) {
  if (!stored || typeof stored.startedAt !== 'string' || stored.startedAt !== todayStr) return null;
  if (!isValidDateStr(stored.date)) return null;
  if (!PROGRAMS.includes(stored.program)) return null;
  if (!Array.isArray(stored.sets)) return null;
  return { program: stored.program, date: stored.date, startedAt: stored.startedAt, sets: stored.sets };
}

/**
 * 週キーごとに「実施した日付の集合」を集計する。同じ日に複数回の記録（例: チップの
 * 誤操作で同一プログラムを2回記録してしまった等）があっても、ジムへ行った回数は1回
 * として数える。weekFeasibility・game.js の initialPhaseStatus / calcStreak が
 * 共通してこの数え方をするための土台（1つのバグを3箇所で別々に踏まないための共通化）。
 * date が欠損・不正・null要素は黙って除外する。
 */
export function distinctDatesPerWeek(workouts) {
  const map = new Map(); // week -> Set<date>
  for (const w of workouts ?? []) {
    if (!isValidDateStr(w?.date)) continue;
    const key = weekKey(w.date);
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(w.date);
  }
  return map;
}

/**
 * 今週（月曜始まり、weekKey と同じ週の切り方）が週 perWeek 回（既定3）の目標に対して
 * まだ到達可能かどうかを判定する。「達成できなかった」を罰として見せるのではなく、
 * 「あと何回・あと何日で間に合うか」という事実だけを見せるための土台。
 *
 * - done: 今週の実施日数（不正な日付は除外。同日複数回の記録は1回として数える。
 *   distinctDatesPerWeek を参照）。
 * - remaining: 目標に対する残り回数。0未満にはならない（達成済みなら0）。
 * - daysLeftInWeek: 今日を含む今週の残り日数（月曜なら7、日曜なら1）。
 * - stillPossible: remaining <= daysLeftInWeek（週3回の目標そのものにまだ届く）。
 *   達成済み（remaining===0）なら daysLeftInWeek の値によらず常に true になる。
 * - canFitMore: 目標には届かない(stillPossible===false)としても、今週にまだ
 *   1日でも残っていれば true。「今週は◯回で締め」という区切り（罰）の言い方ではなく
 *   「まだ入る」という前向きな言い方をこちらのケースで使うため。daysLeftInWeek は
 *   月曜始まりの定義上つねに1以上（日曜でも今日という1日は残っている）なので、
 *   stillPossible===false のときは事実上つねに true になる。
 *   ＝この土台の上では「今週はもう1回も入らない」という締め切りの状態は起こらない。
 *
 * todayStr は calcStreak 等と同じ前提で、アプリ内部の信頼できる値（不正な形式なら
 * weekKey が例外を投げる）。一方 workouts は storage / importAll 由来の信頼できない
 * データなので、date が欠損・不正なレコードは黙って除外する。
 */
export function weekFeasibility(workouts, todayStr, perWeek = 3) {
  const thisWeek = weekKey(todayStr);
  const done = distinctDatesPerWeek(workouts).get(thisWeek)?.size ?? 0;

  const today = new Date(todayStr + 'T00:00:00Z');
  const dayIndex = (today.getUTCDay() + 6) % 7; // 月=0 ... 日=6
  const daysLeftInWeek = 7 - dayIndex;

  const remaining = Math.max(0, perWeek - done);
  const stillPossible = remaining <= daysLeftInWeek;
  const canFitMore = !stillPossible && daysLeftInWeek > 0;

  return { done, remaining, daysLeftInWeek, stillPossible, canFitMore };
}

/**
 * 最後にジムへ行った日から、無トレーニングによる筋力低下が測定され始めるとされる
 * 目安期間（既定14日）までの残り日数を返す。ペナルティではなく時計として扱うため、
 * 期間を過ぎても何かを減点したりはしない。呼び出し側（UI）はこの目安を「事実」として
 * ではなく「目安」として提示すること。
 *
 * - lastDate: 有効な日付を持つ記録の中で最も新しい日付。1件も無ければ null。
 *   null のときは daysSince/daysLeft も意味を持たないため null を返し、overdue は false。
 * - daysSince: 今日と lastDate の暦日差。0未満にはならない（未来日付の壊れた記録が
 *   紛れ込んでも「マイナス◯日前」という無意味な表示にしない。多層防御: 未来日付は
 *   そもそも記録される想定が無いが、importAll は日付の実在性までは検証しない）。
 * - daysLeft: windowDays - daysSince。0未満にはならない（0を「目安に達した」の表現とし、
 *   マイナス方向には伸ばさない。伸ばしても「もっと落ちている」という煽りにしかならない）。
 *   daysSince を上のとおりクランプするため、daysLeft が windowDays を超えることもない。
 * - overdue: daysSince が windowDays を「超えた」場合のみ true（等しいだけでは false。
 *   ちょうど windowDays 日はまだ「目安に到達した」段階であり「過ぎた」わけではない）。
 *
 * workouts は storage / importAll 由来の信頼できないデータなので、date が欠損・不正な
 * レコードは黙って除外する。todayStr は他の集計関数と同様、アプリ内部の信頼できる値。
 */
export function daysUntilDetraining(workouts, todayStr, windowDays = 14) {
  let lastDate = null;
  for (const w of workouts ?? []) {
    if (!isValidDateStr(w?.date)) continue;
    if (lastDate === null || w.date > lastDate) lastDate = w.date;
  }
  if (lastDate === null) {
    return { lastDate: null, daysSince: null, daysLeft: null, overdue: false };
  }

  const today = new Date(todayStr + 'T00:00:00Z');
  const last = new Date(lastDate + 'T00:00:00Z');
  const daysSince = Math.max(0, Math.round((today - last) / (24 * 3600 * 1000)));
  const daysLeft = Math.max(0, windowDays - daysSince);
  const overdue = daysSince > windowDays;

  return { lastDate, daysSince, daysLeft, overdue };
}

/**
 * 脚の日（C）の翌日にバドミントンを入れようとしていれば true。
 * workouts に null 要素（壊れたレコード）が混ざっていても例外を投げず読み飛ばす。
 */
export function warnsBadmintonAfterLegs(workouts, badmintonDate) {
  const target = new Date(badmintonDate + 'T00:00:00Z');
  const prev = new Date(target);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const prevStr = prev.toISOString().slice(0, 10);
  return (workouts ?? []).some((w) => w?.date === prevStr && w?.program === 'C');
}

/**
 * 総挙上量の会計モデル変更（体重を考慮した計算の導入）に伴う、保存済みワークアウトの
 * volume 一度きりの再計算。通常運用では「volumeは保存時にスタンプされ、後から遡って
 * 再計算しない」という原則が成り立つ（history/badges 等がそれを前提にしている）が、
 * これは会計モデル自体が変わった一度きりの移行でありその例外にあたる
 * （js/main.js の起動時マイグレーションから、二重実行を防ぐガード付きで一度だけ呼ぶ）。
 *
 * 各ワークアウトの体重は、そのワークアウトの日付「時点」で有効だった体重
 * （bodyweightAsOf: その日付以前で最新のInBody記録、無ければprofile.weight）を使う。
 * 今日の体重を過去のワークアウトに使うと、何ヶ月も前のワークアウトの総挙上量が今の
 * 体重が変わるたびに変わってしまい、履歴の意味が保てなくなるため。
 *
 * date が不正・sets が配列でない壊れたレコードは volume に触れずそのまま返す
 * （import 由来の壊れたデータでマイグレーション自体が落ちるのを防ぐ）。null 要素も
 * そのまま返す。
 */
export function migrateHistoricalVolume(workouts, exercises, bodyRecords, profile) {
  return (workouts ?? []).map((w) => {
    if (!w || !isValidDateStr(w.date) || !Array.isArray(w.sets)) return w;
    const bodyweight = bodyweightAsOf(bodyRecords, w.date, profile);
    return { ...w, volume: calcVolume(w.sets, { exercises, bodyweight }) };
  });
}
