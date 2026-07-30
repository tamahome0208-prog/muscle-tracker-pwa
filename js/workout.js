export const PROGRAMS = ['A', 'B', 'C'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 日付文字列 'YYYY-MM-DD' の週キー（月曜始まり、ISO 8601週番号）を返す。例: '2026-W31'
 *
 * 不正な形式の入力（undefined・ゼロ埋め無しなど）は例外を投げる。これはプログラマの
 * ミスを黙って通さないための設計判断: 以前は不正入力で 'NaN-WNaN' のような無意味な
 * キーを返しており、文字列比較では 'N' > '2' のため週次集計の並びの最後（＝「最新週」
 * として画面に出る位置）に紛れ込んでしまっていた。
 *
 * 一方 weeklyVolume() はこの関数と非対称に、不正な日付を持つ記録を例外を投げずに
 * 除外する。weeklyVolume はインポートされた記録など信頼できない外部データが入りうる
 * 境界であり、1件の壊れた記録のせいで週次集計全体が例外で落ちるのは避けたいため。
 */
export function weekKey(dateStr) {
  if (typeof dateStr !== 'string' || !DATE_RE.test(dateStr)) {
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

function sortedByDate(workouts) {
  return [...workouts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
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
    const index = PROGRAMS.indexOf(w.program);
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
      if (typeof w.date !== 'string' || !DATE_RE.test(w.date)) continue;
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
 *  - 'assist' → Math.max(0, bodyweight + weight) * reps
 *      （weightは負の補助重量。60kgの人が-40kg補助なら実効負荷20kg）
 *  - 'bodyweight' → (bodyweight + Math.max(0, weight)) * reps
 *      （通常weightは0。外部負荷を足した場合はそれも加算する）
 * bodyweight が数値化できない/不正な場合は0として扱い、NaNではなく
 * 従来どおりの挙動に緩やかに劣化させる。
 */
export function calcVolume(sets, context) {
  const exMap = context ? new Map(context.exercises?.map((e) => [e.id, e]) ?? []) : null;
  const bodyweight = context ? (Number(context.bodyweight) || 0) : 0;

  return sets.reduce((sum, s) => {
    const w = Number(s.weight) || 0;
    const r = Number(s.reps) || 0;
    const load = exMap?.get(s.exId)?.load;

    if (load === 'assist') return sum + Math.max(0, bodyweight + w) * r;
    if (load === 'bodyweight') return sum + (bodyweight + Math.max(0, w)) * r;
    return sum + Math.max(0, w) * r;
  }, 0);
}

/**
 * 週ごとの総挙上量。週キーの昇順で返す。
 * 返す配列は疎(sparse)である: トレーニングの無い週は要素自体が存在しないので、
 * 呼び出し側は連続した週番号の並びだとみなしてはならない（間の週を0として補完したい
 * 場合は呼び出し側で行うこと）。
 * 日付が不正な記録（weekKey が例外を投げる形式）は、集計前に黙って除外する。
 */
export function weeklyVolume(workouts) {
  const map = new Map();
  for (const w of workouts) {
    if (typeof w.date !== 'string' || !DATE_RE.test(w.date)) continue;
    const key = weekKey(w.date);
    const volume = w.volume ?? calcVolume(w.sets ?? []);
    map.set(key, (map.get(key) ?? 0) + volume);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, volume]) => ({ week, volume }));
}

/** その種目の直近の重量・回数（同一セッション内では最後に記録したセット）。無ければ null */
export function lastSetFor(workouts, exId) {
  const sorted = sortedByDate(workouts).reverse();
  for (const w of sorted) {
    const hit = (w.sets ?? []).filter((s) => s.exId === exId).pop();
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
 * 保存されていた進行中セッション(js/store.js の 'session' キー)を、今日の
 * セッションとして復元してよいか判定する。
 *
 * date が今日と一致しない場合は古いセッションとみなして復元しない(数日前の
 * セッションが今日のexだと勘違いして蘇るのを防ぐ)。program が3種目のいずれ
 * でもない、または sets が配列でない場合も壊れたデータとして復元しない。
 * 復元しない場合は null を返し、呼び出し側は新規セッションを開始すること。
 */
export function restorableSession(stored, todayStr) {
  if (!stored || typeof stored.date !== 'string' || stored.date !== todayStr) return null;
  if (!PROGRAMS.includes(stored.program)) return null;
  if (!Array.isArray(stored.sets)) return null;
  return { program: stored.program, date: stored.date, sets: stored.sets };
}

/**
 * 今週（月曜始まり、weekKey と同じ週の切り方）が週 perWeek 回（既定3）の目標に対して
 * まだ到達可能かどうかを判定する。「達成できなかった」を罰として見せるのではなく、
 * 「あと何回・あと何日で間に合うか」という事実だけを見せるための土台。
 *
 * - done: 今週の有効な記録数（不正な日付は除外して数える。calcStreak と同じ数え方で、
 *   同日複数回の記録もそれぞれ1回として数える）。
 * - remaining: 目標に対する残り回数。0未満にはならない（達成済みなら0）。
 * - daysLeftInWeek: 今日を含む今週の残り日数（月曜なら7、日曜なら1）。
 * - stillPossible: remaining <= daysLeftInWeek。達成済み（remaining===0）なら
 *   daysLeftInWeek の値によらず常に true になる。
 *
 * todayStr は calcStreak 等と同じ前提で、アプリ内部の信頼できる値（不正な形式なら
 * weekKey が例外を投げる）。一方 workouts は storage / importAll 由来の信頼できない
 * データなので、date が欠損・不正なレコードは黙って除外する。
 */
export function weekFeasibility(workouts, todayStr, perWeek = 3) {
  const thisWeek = weekKey(todayStr);
  const done = (workouts ?? []).filter((w) => {
    if (typeof w?.date !== 'string' || !DATE_RE.test(w.date)) return false;
    return weekKey(w.date) === thisWeek;
  }).length;

  const today = new Date(todayStr + 'T00:00:00Z');
  const dayIndex = (today.getUTCDay() + 6) % 7; // 月=0 ... 日=6
  const daysLeftInWeek = 7 - dayIndex;

  const remaining = Math.max(0, perWeek - done);
  const stillPossible = remaining <= daysLeftInWeek;

  return { done, remaining, daysLeftInWeek, stillPossible };
}

/**
 * 最後にジムへ行った日から、無トレーニングによる筋力低下が測定され始めるとされる
 * 目安期間（既定14日）までの残り日数を返す。ペナルティではなく時計として扱うため、
 * 期間を過ぎても何かを減点したりはしない。呼び出し側（UI）はこの目安を「事実」として
 * ではなく「目安」として提示すること。
 *
 * - lastDate: 有効な日付を持つ記録の中で最も新しい日付。1件も無ければ null。
 *   null のときは daysSince/daysLeft も意味を持たないため null を返し、overdue は false。
 * - daysSince: 今日と lastDate の暦日差。
 * - daysLeft: windowDays - daysSince。0未満にはならない（0を「目安に達した」の表現とし、
 *   マイナス方向には伸ばさない。伸ばしても「もっと落ちている」という煽りにしかならない）。
 * - overdue: daysSince が windowDays を「超えた」場合のみ true（等しいだけでは false。
 *   ちょうど windowDays 日はまだ「目安に到達した」段階であり「過ぎた」わけではない）。
 *
 * workouts は storage / importAll 由来の信頼できないデータなので、date が欠損・不正な
 * レコードは黙って除外する。todayStr は他の集計関数と同様、アプリ内部の信頼できる値。
 */
export function daysUntilDetraining(workouts, todayStr, windowDays = 14) {
  let lastDate = null;
  for (const w of workouts ?? []) {
    if (typeof w?.date !== 'string' || !DATE_RE.test(w.date)) continue;
    if (lastDate === null || w.date > lastDate) lastDate = w.date;
  }
  if (lastDate === null) {
    return { lastDate: null, daysSince: null, daysLeft: null, overdue: false };
  }

  const today = new Date(todayStr + 'T00:00:00Z');
  const last = new Date(lastDate + 'T00:00:00Z');
  const daysSince = Math.round((today - last) / (24 * 3600 * 1000));
  const daysLeft = Math.max(0, windowDays - daysSince);
  const overdue = daysSince > windowDays;

  return { lastDate, daysSince, daysLeft, overdue };
}

/** 脚の日（C）の翌日にバドミントンを入れようとしていれば true */
export function warnsBadmintonAfterLegs(workouts, badmintonDate) {
  const target = new Date(badmintonDate + 'T00:00:00Z');
  const prev = new Date(target);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const prevStr = prev.toISOString().slice(0, 10);
  return workouts.some((w) => w.date === prevStr && w.program === 'C');
}
