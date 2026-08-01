import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextProgram,
  calcVolume,
  weeklyVolume,
  lastSetFor,
  isPB,
  updateBests,
  warnsBadmintonAfterLegs,
  weekKey,
  isValidDateStr,
  restorableSession,
  programStatus,
  weekFeasibility,
  daysUntilDetraining,
  distinctDatesPerWeek,
  migrateHistoricalVolume,
  PROGRAMS
} from '../js/workout.js';

test('記録が無ければ最初はA', () => {
  assert.equal(nextProgram([]), 'A');
});

test('A→B→C→A と順送りする', () => {
  assert.equal(nextProgram([{ date: '2026-07-29', program: 'A' }]), 'B');
  assert.equal(nextProgram([{ date: '2026-07-29', program: 'B' }]), 'C');
  assert.equal(nextProgram([{ date: '2026-07-29', program: 'C' }]), 'A');
});

test('日付が最新の記録を基準にする（配列順に依存しない）', () => {
  const workouts = [
    { date: '2026-07-29', program: 'B' },
    { date: '2026-07-20', program: 'C' }
  ];
  assert.equal(nextProgram(workouts), 'C');
});

test('未知のprogramの記録は無視して直近の既知programから継続する', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A' },
    { date: '2026-07-29', program: undefined }
  ];
  assert.equal(nextProgram(workouts), 'B');
});

test('nextProgram は null 要素が混ざっていても例外を投げずに無視する', () => {
  const workouts = [null, { date: '2026-07-27', program: 'A' }];
  assert.doesNotThrow(() => nextProgram(workouts));
  assert.equal(nextProgram(workouts), 'B');
});

test('総挙上量は 重量×回数 の合計', () => {
  const sets = [
    { exId: 'lat_pulldown', weight: 35, reps: 10 },
    { exId: 'lat_pulldown', weight: 35, reps: 8 },
    { exId: 'seated_row', weight: 30, reps: 10 }
  ];
  assert.equal(calcVolume(sets), 35 * 10 + 35 * 8 + 30 * 10);
});

test('補助重量（マイナス）は総挙上量に加算しない', () => {
  const sets = [{ exId: 'chin_assist', weight: -40, reps: 8 }];
  assert.equal(calcVolume(sets), 0);
});

test('自重（0kg）は回数×体重換算せず0として扱う', () => {
  assert.equal(calcVolume([{ exId: 'ab_coaster', weight: 0, reps: 15 }]), 0);
});

test('calcVolume は不正な値を0として扱いNaNを伝播させない', () => {
  const sets = [
    { exId: 'lat_pulldown', weight: 35, reps: 10 },
    { exId: 'lat_pulldown', weight: undefined, reps: 8 }
  ];
  assert.equal(calcVolume(sets), 350);
});

const LOAD_EXERCISES = [
  { id: 'chin_assist', load: 'assist' },
  { id: 'dip_assist', load: 'assist' },
  { id: 'ab_coaster', load: 'bodyweight' },
  { id: 'back_extension', load: 'bodyweight' },
  { id: 'pec_fly', load: 'external' }
];

test('context ありで assist 種目は 体重+補助重量(負値) を実効負荷にする', () => {
  const sets = [{ exId: 'chin_assist', weight: -40, reps: 8 }];
  assert.equal(calcVolume(sets, { exercises: LOAD_EXERCISES, bodyweight: 60 }), (60 - 40) * 8);
});

test('context ありで bodyweight 種目は 体重×回数 になる', () => {
  const sets = [{ exId: 'ab_coaster', weight: 0, reps: 15 }];
  assert.equal(calcVolume(sets, { exercises: LOAD_EXERCISES, bodyweight: 60 }), 60 * 15);
});

test('context ありで bodyweight 種目に外部負荷を足した場合は加算する', () => {
  const sets = [{ exId: 'back_extension', weight: 10, reps: 12 }];
  assert.equal(calcVolume(sets, { exercises: LOAD_EXERCISES, bodyweight: 60 }), (60 + 10) * 12);
});

test('context ありでも external 種目は体重を加味しない（従来どおり）', () => {
  const sets = [{ exId: 'pec_fly', weight: 20, reps: 10 }];
  assert.equal(calcVolume(sets, { exercises: LOAD_EXERCISES, bodyweight: 60 }), 20 * 10);
});

test('context ありでも未知のexIdは external と同じ扱いにする', () => {
  const sets = [{ exId: '存在しない', weight: 20, reps: 10 }];
  assert.equal(calcVolume(sets, { exercises: LOAD_EXERCISES, bodyweight: 60 }), 20 * 10);
});

test('context を省略すると従来どおりの挙動になる（assist/bodyweightでも体重を加味しない）', () => {
  assert.equal(calcVolume([{ exId: 'chin_assist', weight: -40, reps: 8 }]), 0);
  assert.equal(calcVolume([{ exId: 'ab_coaster', weight: 0, reps: 15 }]), 0);
});

test('bodyweight が NaN・欠損のときは0として扱い従来の挙動に劣化させる', () => {
  const sets = [{ exId: 'chin_assist', weight: -40, reps: 8 }];
  assert.equal(calcVolume(sets, { exercises: LOAD_EXERCISES, bodyweight: NaN }), 0);
  assert.equal(calcVolume(sets, { exercises: LOAD_EXERCISES }), 0);
  assert.equal(calcVolume(sets, { exercises: LOAD_EXERCISES, bodyweight: 'oops' }), 0);
});

test('bodyweight が負値でも0としてクランプする（体重データの破損が総挙上量・XPを減らさないため）', () => {
  const assistSets = [{ exId: 'chin_assist', weight: -40, reps: 8 }];
  assert.equal(calcVolume(assistSets, { exercises: LOAD_EXERCISES, bodyweight: -60 }), 0);
  const bodyweightSets = [{ exId: 'ab_coaster', weight: 0, reps: 15 }];
  assert.equal(calcVolume(bodyweightSets, { exercises: LOAD_EXERCISES, bodyweight: -60 }), 0);
});

test('loadFactor はbodyweight成分にだけ掛かる（既定1.0）', () => {
  const exercises = [{ id: 'back_extension', load: 'bodyweight', loadFactor: 0.5 }];
  const sets = [{ exId: 'back_extension', weight: 10, reps: 12 }];
  assert.equal(calcVolume(sets, { exercises, bodyweight: 60 }), (60 * 0.5 + 10) * 12);
});

test('loadFactor が無い種目は従来どおり1.0として扱う', () => {
  const exercises = [{ id: 'ab_coaster', load: 'bodyweight' }];
  const sets = [{ exId: 'ab_coaster', weight: 0, reps: 15 }];
  assert.equal(calcVolume(sets, { exercises, bodyweight: 60 }), 60 * 15);
});

test('loadFactor が不正(0以下・非数値)なら1.0にフォールバックする', () => {
  const exercises = [{ id: 'x', load: 'bodyweight', loadFactor: 0 }];
  const sets = [{ exId: 'x', weight: 0, reps: 10 }];
  assert.equal(calcVolume(sets, { exercises, bodyweight: 60 }), 600);
});

test('週次の総挙上量を月曜始まりで集計する', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A', volume: 1000 }, // 月
    { date: '2026-07-29', program: 'B', volume: 1200 }, // 水（同じ週）
    { date: '2026-08-03', program: 'C', volume: 900 }   // 翌週の月
  ];
  const weeks = weeklyVolume(workouts);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].volume, 2200);
  assert.equal(weeks[1].volume, 900);
});

test('weeklyVolume は volume が無い記録を sets から計算して集計する', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] }
  ];
  const weeks = weeklyVolume(workouts);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].volume, 300);
});

test('weeklyVolume は日付が不正な記録を例外を投げずに除外する', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A', volume: 1000 },
    { date: undefined, program: 'B', volume: 99999 }
  ];
  const weeks = weeklyVolume(workouts);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].volume, 1000);
});

test('weeklyVolume は実在しない暦日（2026-13-01等）の記録も例外を投げずに除外する', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A', volume: 1000 },
    { date: '2026-13-01', program: 'B', volume: 99999 }
  ];
  assert.doesNotThrow(() => weeklyVolume(workouts));
  const weeks = weeklyVolume(workouts);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].volume, 1000);
});

test('weeklyVolume は null 要素が混ざっていても例外を投げずに無視する', () => {
  const workouts = [null, { date: '2026-07-27', program: 'A', volume: 1000 }];
  assert.doesNotThrow(() => weeklyVolume(workouts));
  const weeks = weeklyVolume(workouts);
  assert.equal(weeks.length, 1);
  assert.equal(weeks[0].volume, 1000);
});

test('weekKey は月曜始まりのISO週番号を返す', () => {
  assert.equal(weekKey('2025-12-29'), '2026-W01');
  assert.equal(weekKey('2026-07-29'), '2026-W31');
  assert.equal(weekKey('2026-12-31'), '2026-W53');
  assert.equal(weekKey('2027-01-01'), '2026-W53');
  assert.equal(weekKey('2027-01-04'), '2027-W01');
});

test('weekKey は不正な形式の日付で例外を投げる', () => {
  assert.throws(() => weekKey(undefined));
  assert.throws(() => weekKey('2026-7-9')); // ゼロ埋めなし
});

test('weekKey は桁数は合うが実在しない暦日（月13など）でも例外を投げる（Invalid Dateを黙って通さない）', () => {
  assert.throws(() => weekKey('2026-13-01'));
});

test('isValidDateStr: 実在する暦日はtrue、形式違反・実在しない暦日はfalse', () => {
  assert.equal(isValidDateStr('2026-07-29'), true);
  assert.equal(isValidDateStr('2026-13-01'), false);
  assert.equal(isValidDateStr('2026-7-9'), false);
  assert.equal(isValidDateStr(undefined), false);
  assert.equal(isValidDateStr(null), false);
});

test('前回のセットを種目ごとに引ける（同一セッション内では最後のセットを返す）', () => {
  const workouts = [
    { date: '2026-07-20', program: 'B', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] },
    {
      date: '2026-07-27',
      program: 'B',
      sets: [
        { exId: 'seated_row', weight: 32.5, reps: 12 },
        { exId: 'seated_row', weight: 32.5, reps: 10 },
        { exId: 'seated_row', weight: 35, reps: 8 }
      ]
    }
  ];
  assert.deepEqual(lastSetFor(workouts, 'seated_row'), { weight: 35, reps: 8 });
  assert.equal(lastSetFor(workouts, 'leg_press'), null);
});

test('lastSetFor は null 要素が混ざっていても例外を投げずに無視する', () => {
  const workouts = [null, { date: '2026-07-27', program: 'B', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] }];
  assert.doesNotThrow(() => lastSetFor(workouts, 'seated_row'));
  assert.deepEqual(lastSetFor(workouts, 'seated_row'), { weight: 30, reps: 10 });
});

test('記録が無ければ最初のセットはPB', () => {
  assert.equal(isPB({}, 'seated_row', 30, 10), true);
});

test('重量が上回ればPB', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  assert.equal(isPB(bests, 'seated_row', 32.5, 8), true);
});

test('同じ重量で回数が上回ればPB', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  assert.equal(isPB(bests, 'seated_row', 30, 11), true);
});

test('同じ重量で回数が同じならPBではない', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  assert.equal(isPB(bests, 'seated_row', 30, 10), false);
});

test('重量が下がれば回数が多くてもPBではない', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  assert.equal(isPB(bests, 'seated_row', 27.5, 20), false);
});

test('updateBests は元のオブジェクトを壊さない', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  const next = updateBests(bests, 'seated_row', 32.5, 8, '2026-07-29');
  assert.equal(bests.seated_row.weight, 30);
  assert.equal(next.seated_row.weight, 32.5);
  assert.equal(next.seated_row.date, '2026-07-29');
});

test('PBでなければ updateBests は同じ内容を返す', () => {
  const bests = { seated_row: { weight: 30, reps: 10, date: '2026-07-20' } };
  const next = updateBests(bests, 'seated_row', 27.5, 8, '2026-07-29');
  assert.deepEqual(next.seated_row, bests.seated_row);
  assert.notEqual(next, bests); // 内容は同じでも新しいオブジェクトを返す
});

test('updateBests は他種目のPBを保持する', () => {
  const bests = {
    seated_row: { weight: 30, reps: 10, date: '2026-07-20' },
    lat_pulldown: { weight: 40, reps: 8, date: '2026-07-15' }
  };
  const next = updateBests(bests, 'seated_row', 32.5, 8, '2026-07-29');
  assert.deepEqual(next.lat_pulldown, bests.lat_pulldown);
  assert.deepEqual(next.seated_row, { weight: 32.5, reps: 8, date: '2026-07-29' });
});

test('脚の日（C）の翌日にバドミントンを入れると警告する', () => {
  const workouts = [{ date: '2026-07-29', program: 'C' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2026-07-30'), true);
});

test('脚の日の2日後なら警告しない', () => {
  const workouts = [{ date: '2026-07-29', program: 'C' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2026-07-31'), false);
});

test('AやBの翌日は警告しない', () => {
  const workouts = [{ date: '2026-07-29', program: 'A' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2026-07-30'), false);
});

test('月をまたぐ脚の日の翌日も警告する', () => {
  const workouts = [{ date: '2026-07-31', program: 'C' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2026-08-01'), true);
});

test('年をまたぐ脚の日の翌日も警告する', () => {
  const workouts = [{ date: '2026-12-31', program: 'C' }];
  assert.equal(warnsBadmintonAfterLegs(workouts, '2027-01-01'), true);
});

// --- restorableSession（進行中セッションの永続化/復元） ---
// startedAt(セッションを開始した暦日)が今日かどうかで判定する。date(記録対象の日付)は
// バックデート入力では今日と一致しなくてよい。

test('restorableSession: startedAtが今日なら(dateが過去でも)復元する', () => {
  const stored = { program: 'B', date: '2026-07-28', startedAt: '2026-07-29', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] };
  assert.deepEqual(restorableSession(stored, '2026-07-29'), stored);
});

test('restorableSession: dateが今日でもstartedAtが今日なら復元する(通常の当日セッション)', () => {
  const stored = { program: 'B', date: '2026-07-29', startedAt: '2026-07-29', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] };
  assert.deepEqual(restorableSession(stored, '2026-07-29'), stored);
});

test('restorableSession: startedAtが今日でなければ古いセッションとして復元しない', () => {
  const stored = { program: 'B', date: '2026-07-27', startedAt: '2026-07-27', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] };
  assert.equal(restorableSession(stored, '2026-07-29'), null);
});

test('restorableSession: セッションが無ければ(program/date/startedAt が null)復元しない', () => {
  assert.equal(restorableSession({ program: null, date: null, startedAt: null, sets: [] }, '2026-07-29'), null);
  assert.equal(restorableSession(null, '2026-07-29'), null);
  assert.equal(restorableSession(undefined, '2026-07-29'), null);
});

test('restorableSession: programが不正、またはsetsが配列でなければ復元しない', () => {
  assert.equal(restorableSession({ program: 'X', date: '2026-07-29', startedAt: '2026-07-29', sets: [] }, '2026-07-29'), null);
  assert.equal(restorableSession({ program: 'A', date: '2026-07-29', startedAt: '2026-07-29', sets: 'garbage' }, '2026-07-29'), null);
});

test('restorableSession: dateが不正な形式なら(startedAtが今日でも)復元しない', () => {
  const stored = { program: 'A', date: '2026-7-9', startedAt: '2026-07-29', sets: [] };
  assert.equal(restorableSession(stored, '2026-07-29'), null);
});

// --- programStatus（プログラム別チップ用の状態） ---

test('programStatus: 記録が無ければ全プログラム未実施でAが推奨される', () => {
  const statuses = programStatus([], '2026-07-29');
  assert.equal(statuses.length, 3);
  assert.deepEqual(statuses.map((s) => s.program), PROGRAMS);
  for (const s of statuses) {
    assert.equal(s.lastDate, null);
    assert.equal(s.daysAgo, null);
  }
  assert.deepEqual(statuses.map((s) => s.recommended), [true, false, false]);
});

test('programStatus: 各プログラムが別日に実施済みならそれぞれのdaysAgoを返す', () => {
  const workouts = [
    { date: '2026-07-26', program: 'A' }, // 3日前
    { date: '2026-07-24', program: 'B' }, // 5日前
    { date: '2026-07-19', program: 'C' }  // 10日前
  ];
  const statuses = programStatus(workouts, '2026-07-29');
  const byProgram = Object.fromEntries(statuses.map((s) => [s.program, s]));
  assert.equal(byProgram.A.daysAgo, 3);
  assert.equal(byProgram.B.daysAgo, 5);
  assert.equal(byProgram.C.daysAgo, 10);
  // 直近はA(2026-07-26)なので次はB
  assert.equal(nextProgram(workouts), 'B');
  assert.deepEqual(statuses.filter((s) => s.recommended).map((s) => s.program), ['B']);
});

test('programStatus: 同一プログラムを複数回実施していれば最新の日付が勝つ', () => {
  const workouts = [
    { date: '2026-07-10', program: 'A' },
    { date: '2026-07-27', program: 'A' } // より新しい
  ];
  const statuses = programStatus(workouts, '2026-07-29');
  const a = statuses.find((s) => s.program === 'A');
  assert.equal(a.lastDate, '2026-07-27');
  assert.equal(a.daysAgo, 2);
});

test('programStatus: dateが欠損・不正な記録は例外を投げずに無視する', () => {
  const workouts = [
    { date: undefined, program: 'A' },
    { date: '2026-7-9', program: 'B' }, // ゼロ埋めなし
    { date: '2026-07-29', program: 'C' }
  ];
  assert.doesNotThrow(() => programStatus(workouts, '2026-07-29'));
  const statuses = programStatus(workouts, '2026-07-29');
  const [a, b, c] = statuses;
  assert.equal(a.lastDate, null);
  assert.equal(b.lastDate, null);
  assert.equal(c.lastDate, '2026-07-29');
});

test('programStatus: recommendedは常にnextProgramと一致する', () => {
  const cases = [
    [],
    [{ date: '2026-07-29', program: 'A' }],
    [{ date: '2026-07-29', program: 'B' }],
    [{ date: '2026-07-29', program: 'C' }],
    [{ date: '2026-07-27', program: 'A' }, { date: '2026-07-29', program: undefined }]
  ];
  for (const workouts of cases) {
    const statuses = programStatus(workouts, '2026-07-30');
    const expected = nextProgram(workouts);
    assert.deepEqual(statuses.filter((s) => s.recommended).map((s) => s.program), [expected]);
  }
});

test('programStatus: 今日実施していればdaysAgoは0', () => {
  const workouts = [{ date: '2026-07-29', program: 'A' }];
  const statuses = programStatus(workouts, '2026-07-29');
  assert.equal(statuses.find((s) => s.program === 'A').daysAgo, 0);
});

test('programStatus: null要素が混ざっていても例外を投げずに無視する（レンダーが落ちる原因になっていた）', () => {
  const workouts = [null, { date: '2026-07-29', program: 'C' }];
  assert.doesNotThrow(() => programStatus(workouts, '2026-07-29'));
  const statuses = programStatus(workouts, '2026-07-29');
  assert.equal(statuses.find((s) => s.program === 'C').lastDate, '2026-07-29');
});

// --- weekFeasibility（今週の目標に対する達成可否） ---
// 2026-07-27(月)〜2026-08-02(日) が 2026-W31。today='2026-07-29' は同じ週の水曜(index2)で
// daysLeftInWeek = 7-2 = 5。

test('weekFeasibility: 記録が無ければ0/3、まだ十分間に合う', () => {
  const f = weekFeasibility([], '2026-07-29');
  assert.deepEqual(f, { done: 0, remaining: 3, daysLeftInWeek: 5, stillPossible: true, canFitMore: false });
});

test('weekFeasibility: 今週1回なら残り2回', () => {
  const workouts = [{ date: '2026-07-27', program: 'A' }];
  const f = weekFeasibility(workouts, '2026-07-29');
  assert.equal(f.done, 1);
  assert.equal(f.remaining, 2);
  assert.equal(f.stillPossible, true);
});

test('weekFeasibility: 今週2回なら残り1回', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A' },
    { date: '2026-07-28', program: 'B' }
  ];
  const f = weekFeasibility(workouts, '2026-07-29');
  assert.equal(f.done, 2);
  assert.equal(f.remaining, 1);
  assert.equal(f.stillPossible, true);
});

test('weekFeasibility: 今週3回で目標達成、残り0', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A' },
    { date: '2026-07-28', program: 'B' },
    { date: '2026-07-29', program: 'C' }
  ];
  const f = weekFeasibility(workouts, '2026-07-29');
  assert.equal(f.done, 3);
  assert.equal(f.remaining, 0);
  assert.equal(f.stillPossible, true);
});

test('weekFeasibility: 今週4回でも残りは0未満にならない', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A' },
    { date: '2026-07-28', program: 'B' },
    { date: '2026-07-29', program: 'C' },
    { date: '2026-07-30', program: 'A' }
  ];
  const f = weekFeasibility(workouts, '2026-07-30');
  assert.equal(f.done, 4);
  assert.equal(f.remaining, 0);
  assert.equal(f.stillPossible, true);
});

test('weekFeasibility: 境界（達成可否が切り替わる日） 残り2回・土曜はまだ間に合う', () => {
  const workouts = [{ date: '2026-07-27', program: 'A' }]; // 今週1回、残り2回
  const f = weekFeasibility(workouts, '2026-08-01'); // 土曜、daysLeftInWeek=2
  assert.equal(f.remaining, 2);
  assert.equal(f.daysLeftInWeek, 2);
  assert.equal(f.stillPossible, true);
});

test('weekFeasibility: 境界（達成可否が切り替わる日） 残り2回・日曜はもう間に合わない', () => {
  const workouts = [{ date: '2026-07-27', program: 'A' }]; // 今週1回、残り2回
  const f = weekFeasibility(workouts, '2026-08-02'); // 日曜、daysLeftInWeek=1
  assert.equal(f.remaining, 2);
  assert.equal(f.daysLeftInWeek, 1);
  assert.equal(f.stillPossible, false);
  // 週3回の目標そのものには届かなくても、今日という1日はまだ残っているので
  // 「締め」（罰の言い方）ではなく「まだ入る」を示す第三の状態になる。
  assert.equal(f.canFitMore, true);
});

// --- weekFeasibility の3状態（達成／まだ入る／締め）の境界日テスト ---
// 「今週は0回で締め」を土曜に出していたのが元のバグ。土曜(daysLeftInWeek=2)・
// 日曜(daysLeftInWeek=1)のどちらも、月曜始まりの定義上「今日」という1日は
// 必ず残っているため、canFitMore は true になり「締め」は出ない。

test('weekFeasibility: 土曜・今週0回 → 目標には届かないが2日残っているので前向きな状態になる', () => {
  const f = weekFeasibility([], '2026-08-01'); // 土曜
  assert.equal(f.done, 0);
  assert.equal(f.remaining, 3);
  assert.equal(f.daysLeftInWeek, 2);
  assert.equal(f.stillPossible, false); // 3回は物理的に間に合わない
  assert.equal(f.canFitMore, true);     // が、まだ2日ある
});

test('weekFeasibility: 日曜・今週0回 → 今日という1日は残っているので締めにはしない', () => {
  const f = weekFeasibility([], '2026-08-02'); // 日曜（今週最後の日）
  assert.equal(f.done, 0);
  assert.equal(f.remaining, 3);
  assert.equal(f.daysLeftInWeek, 1);
  assert.equal(f.stillPossible, false);
  assert.equal(f.canFitMore, true);
});

test('weekFeasibility: 週の途中（達成状態）は canFitMore を立てない', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A' },
    { date: '2026-07-28', program: 'B' },
    { date: '2026-07-29', program: 'C' }
  ];
  const f = weekFeasibility(workouts, '2026-07-29'); // 水曜、既に3回達成
  assert.equal(f.stillPossible, true);
  assert.equal(f.canFitMore, false);
});

test('weekFeasibility: 同じ日に複数回の記録があってもジム1回として数える（チップの誤操作対策）', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A' },
    { date: '2026-07-27', program: 'B' } // 同日2件目
  ];
  const f = weekFeasibility(workouts, '2026-07-29');
  assert.equal(f.done, 1);
  assert.equal(f.remaining, 2);
});

test('weekFeasibility: 月をまたぐ週でも同じ週として数える', () => {
  const workouts = [{ date: '2026-07-31', program: 'A' }]; // 金（7月）
  const f = weekFeasibility(workouts, '2026-08-01'); // 土（8月）同じ2026-W31
  assert.equal(f.done, 1);
  assert.equal(f.remaining, 2);
});

test('weekFeasibility: 年をまたぐ週でも同じ週として数える', () => {
  const workouts = [{ date: '2026-12-31', program: 'A' }]; // 木（2026年）2026-W53
  const f = weekFeasibility(workouts, '2027-01-01'); // 金（2027年）同じ2026-W53
  assert.equal(f.done, 1);
  assert.equal(f.remaining, 2);
});

test('weekFeasibility: 先週の記録は今週にカウントしない', () => {
  const workouts = [{ date: '2026-07-20', program: 'A' }]; // 先週の月曜
  const f = weekFeasibility(workouts, '2026-07-29');
  assert.equal(f.done, 0);
  assert.equal(f.remaining, 3);
});

test('weekFeasibility: 日付が欠損・不正な記録は例外を投げずに除外する', () => {
  const workouts = [
    { date: undefined, program: 'A' },
    { date: '2026-7-9', program: 'B' }, // ゼロ埋めなし
    { date: '2026-07-27', program: 'C' }
  ];
  assert.doesNotThrow(() => weekFeasibility(workouts, '2026-07-29'));
  const f = weekFeasibility(workouts, '2026-07-29');
  assert.equal(f.done, 1);
});

// --- daysUntilDetraining（最後のジムから目安21日までの残り） ---
// 既定値は21日（js/workout.js 内のコメントに根拠となる研究を記載）。
// 14日を裏付ける研究は無いため、境界テストも21日基準に合わせてある。

test('daysUntilDetraining: 記録が無ければ lastDate は null で overdue も false', () => {
  const d = daysUntilDetraining([], '2026-07-29');
  assert.deepEqual(d, { lastDate: null, daysSince: null, daysLeft: null, overdue: false });
});

test('daysUntilDetraining: 20日経過なら残り1日でoverdueではない', () => {
  const workouts = [{ date: '2026-07-09', program: 'A' }];
  const d = daysUntilDetraining(workouts, '2026-07-29');
  assert.equal(d.daysSince, 20);
  assert.equal(d.daysLeft, 1);
  assert.equal(d.overdue, false);
});

test('daysUntilDetraining: 21日経過（目安ちょうど）は残り0だがoverdueではない', () => {
  const workouts = [{ date: '2026-07-08', program: 'A' }];
  const d = daysUntilDetraining(workouts, '2026-07-29');
  assert.equal(d.daysSince, 21);
  assert.equal(d.daysLeft, 0);
  assert.equal(d.overdue, false);
});

test('daysUntilDetraining: 22日経過は残り0でoverdue', () => {
  const workouts = [{ date: '2026-07-07', program: 'A' }];
  const d = daysUntilDetraining(workouts, '2026-07-29');
  assert.equal(d.daysSince, 22);
  assert.equal(d.daysLeft, 0);
  assert.equal(d.overdue, true);
});

test('daysUntilDetraining: 最新の記録を基準にする（配列順に依存しない）', () => {
  const workouts = [
    { date: '2026-07-14', program: 'A' },
    { date: '2026-07-27', program: 'B' } // より新しい
  ];
  const d = daysUntilDetraining(workouts, '2026-07-29');
  assert.equal(d.lastDate, '2026-07-27');
  assert.equal(d.daysSince, 2);
});

test('daysUntilDetraining: 日付が欠損・不正な記録は例外を投げずに除外する', () => {
  const workouts = [
    { date: undefined, program: 'A' },
    { date: '2026-7-9', program: 'B' }, // ゼロ埋めなし
    { date: '2026-07-27', program: 'C' }
  ];
  assert.doesNotThrow(() => daysUntilDetraining(workouts, '2026-07-29'));
  const d = daysUntilDetraining(workouts, '2026-07-29');
  assert.equal(d.lastDate, '2026-07-27');
});

test('daysUntilDetraining: 未来日付の記録はdaysSince/daysLeftを負・過大にせずクランプする', () => {
  const workouts = [{ date: '2026-08-05', program: 'A' }]; // todayより後
  const d = daysUntilDetraining(workouts, '2026-07-29');
  assert.equal(d.daysSince, 0);
  assert.equal(d.daysLeft, 21);
  assert.equal(d.overdue, false);
});

test('daysUntilDetraining: windowDays は呼び出し側から設定可能', () => {
  const workouts = [{ date: '2026-07-19', program: 'A' }];
  const d = daysUntilDetraining(workouts, '2026-07-29', 14); // 10日経過をwindow=14で見る
  assert.equal(d.daysSince, 10);
  assert.equal(d.daysLeft, 4);
  assert.equal(d.overdue, false);
});

// --- distinctDatesPerWeek（同日複数記録の水増し防止の共通土台） ---

test('distinctDatesPerWeek: 同じ日の複数記録は1件として数える', () => {
  const workouts = [
    { date: '2026-07-27', program: 'A' },
    { date: '2026-07-27', program: 'B' },
    { date: '2026-07-28', program: 'C' }
  ];
  const map = distinctDatesPerWeek(workouts);
  assert.equal(map.get('2026-W31').size, 2);
});

test('distinctDatesPerWeek: 日付が欠損・不正・null要素は例外を投げずに除外する', () => {
  const workouts = [null, { date: undefined, program: 'A' }, { date: '2026-07-27', program: 'C' }];
  assert.doesNotThrow(() => distinctDatesPerWeek(workouts));
  const map = distinctDatesPerWeek(workouts);
  assert.equal(map.get('2026-W31').size, 1);
});

// --- migrateHistoricalVolume（総挙上量の会計モデル移行の一度きりの再計算） ---

test('migrateHistoricalVolume: そのワークアウト日付「以前」で最新の体重記録を使って再計算する', () => {
  const exercises = [{ id: 'ab_coaster', load: 'bodyweight' }];
  const workouts = [
    { date: '2026-04-01', program: 'C', sets: [{ exId: 'ab_coaster', weight: 0, reps: 15 }], volume: 0 }
  ];
  const body = [
    { date: '2026-03-01', weight: 60, muscle: 45, fatPct: 20 }, // 4/1時点で有効
    { date: '2026-06-01', weight: 65, muscle: 45, fatPct: 20 }  // 4/1より後なので使わない
  ];
  const migrated = migrateHistoricalVolume(workouts, exercises, body, { weight: 999 });
  assert.equal(migrated[0].volume, 60 * 15);
});

test('migrateHistoricalVolume: そのワークアウト日以前に体重記録が無ければprofile.weightを使う', () => {
  const exercises = [{ id: 'ab_coaster', load: 'bodyweight' }];
  const workouts = [
    { date: '2026-01-01', program: 'C', sets: [{ exId: 'ab_coaster', weight: 0, reps: 15 }], volume: 0 }
  ];
  const body = [{ date: '2026-03-01', weight: 60, muscle: 45, fatPct: 20 }]; // ワークアウトより後
  const migrated = migrateHistoricalVolume(workouts, exercises, body, { weight: 70 });
  assert.equal(migrated[0].volume, 70 * 15);
});

test('migrateHistoricalVolume: 今日の体重ではなく過去の体重を使う（今の体重が変わっても過去のvolumeは変わらない）', () => {
  const exercises = [{ id: 'ab_coaster', load: 'bodyweight' }];
  const workouts = [
    { date: '2026-04-01', program: 'C', sets: [{ exId: 'ab_coaster', weight: 0, reps: 15 }], volume: 0 }
  ];
  const body = [{ date: '2026-03-01', weight: 60, muscle: 45, fatPct: 20 }];
  const withTodaysHeavierWeight = migrateHistoricalVolume(workouts, exercises, body, { weight: 999 });
  assert.equal(withTodaysHeavierWeight[0].volume, 60 * 15); // profileの999ではなく当時の記録(60)を使う
});

test('migrateHistoricalVolume: 壊れたレコード（null・sets非配列）はそのまま返す', () => {
  const workouts = [null, { date: '2026-04-01', program: 'C', sets: 'garbage', volume: 999 }];
  const migrated = migrateHistoricalVolume(workouts, [], [], { weight: 60 });
  assert.equal(migrated[0], null);
  assert.equal(migrated[1].volume, 999);
});

test('migrateHistoricalVolume: external種目は体重を加味しないので値は変わらない', () => {
  const exercises = [{ id: 'lat_pulldown', load: 'external' }];
  const workouts = [
    { date: '2026-04-01', program: 'B', sets: [{ exId: 'lat_pulldown', weight: 30, reps: 10 }], volume: 999 }
  ];
  const migrated = migrateHistoricalVolume(workouts, exercises, [], { weight: 60 });
  assert.equal(migrated[0].volume, 300);
});
