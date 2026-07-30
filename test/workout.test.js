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
  restorableSession,
  programStatus,
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

test('restorableSession: 保存済みセッションの日付が今日なら復元する', () => {
  const stored = { program: 'B', date: '2026-07-29', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] };
  assert.deepEqual(restorableSession(stored, '2026-07-29'), stored);
});

test('restorableSession: 日付が今日でなければ古いセッションとして復元しない', () => {
  const stored = { program: 'B', date: '2026-07-27', sets: [{ exId: 'seated_row', weight: 30, reps: 10 }] };
  assert.equal(restorableSession(stored, '2026-07-29'), null);
});

test('restorableSession: セッションが無ければ(program/date が null)復元しない', () => {
  assert.equal(restorableSession({ program: null, date: null, sets: [] }, '2026-07-29'), null);
  assert.equal(restorableSession(null, '2026-07-29'), null);
  assert.equal(restorableSession(undefined, '2026-07-29'), null);
});

test('restorableSession: programが不正、またはsetsが配列でなければ復元しない', () => {
  assert.equal(restorableSession({ program: 'X', date: '2026-07-29', sets: [] }, '2026-07-29'), null);
  assert.equal(restorableSession({ program: 'A', date: '2026-07-29', sets: 'garbage' }, '2026-07-29'), null);
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
