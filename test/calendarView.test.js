import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarWeeks, WEEKDAY_LABELS, GYM_TARGET_PER_WEEK } from '../js/calendarView.js';
import { distinctDatesPerWeek, weekFeasibility, weekKey } from '../js/workout.js';

test('WEEKDAY_LABELS は月曜始まりで7つ', () => {
  assert.deepEqual(WEEKDAY_LABELS, ['月', '火', '水', '木', '金', '土', '日']);
});

test('既定は8週間ぶん、各週7日で返す', () => {
  const { weeks } = buildCalendarWeeks({ workouts: [], badminton: [], todayStr: '2026-08-05' });
  assert.equal(weeks.length, 8);
  for (const w of weeks) assert.equal(w.days.length, 7);
});

test('weeks を指定すればその週数になる', () => {
  const { weeks } = buildCalendarWeeks({ workouts: [], badminton: [], todayStr: '2026-08-05', weeks: 3 });
  assert.equal(weeks.length, 3);
});

test('各週の先頭は月曜日（weekKeyが日曜始まりの週を作っていないことの確認）', () => {
  // 2026-08-05は水曜日。その週の月曜は2026-08-03のはず。
  const { weeks } = buildCalendarWeeks({ workouts: [], badminton: [], todayStr: '2026-08-05' });
  const lastWeek = weeks[weeks.length - 1];
  assert.equal(lastWeek.days[0].date, '2026-08-03');
  assert.equal(lastWeek.days[6].date, '2026-08-09');
});

test('最終週は今週で、todayを含む。todayより後は isFuture:true', () => {
  const { weeks } = buildCalendarWeeks({ workouts: [], badminton: [], todayStr: '2026-08-05' });
  const lastWeek = weeks[weeks.length - 1];
  const today = lastWeek.days.find((d) => d.date === '2026-08-05');
  assert.equal(today.isToday, true);
  assert.equal(today.isFuture, false);
  const future = lastWeek.days.find((d) => d.date === '2026-08-06');
  assert.equal(future.isFuture, true);
  assert.equal(future.isToday, false);
  // 未来日には記録が存在しようがないので、印は必ず立たない
  assert.equal(future.program, null);
  assert.equal(future.hasBadminton, false);
  assert.equal(future.hasPhoto, false);
});

test('今週より前の週にはisFutureが無い（過去日はtodayStrより後にならない）', () => {
  const { weeks } = buildCalendarWeeks({ workouts: [], badminton: [], todayStr: '2026-08-05' });
  for (const w of weeks.slice(0, -1)) {
    for (const d of w.days) assert.equal(d.isFuture, false);
  }
});

test('月の1日は isFirstOfMonth:true、それ以外はfalse', () => {
  const { weeks } = buildCalendarWeeks({ workouts: [], badminton: [], todayStr: '2026-08-05' });
  const firstDays = weeks.flatMap((w) => w.days).filter((d) => d.isFirstOfMonth);
  for (const d of firstDays) assert.equal(d.dayOfMonth, 1);
  // 8週間(56日)の範囲に月初が最低1回は含まれるはず（2026-08-05から遡って8週なら8/1を含む）
  assert.ok(firstDays.some((d) => d.date === '2026-08-01'));
});

test('gymCountは distinctDatesPerWeek と一致する（同日複数記録は1回）', () => {
  const workouts = [
    { date: '2026-08-03', program: 'A' },
    { date: '2026-08-03', program: 'A' }, // 同日の重複記録
    { date: '2026-08-04', program: 'B' }
  ];
  const { weeks } = buildCalendarWeeks({ workouts, badminton: [], todayStr: '2026-08-05' });
  const lastWeek = weeks[weeks.length - 1];
  const expected = distinctDatesPerWeek(workouts).get(lastWeek.weekKey)?.size ?? 0;
  assert.equal(lastWeek.gymCount, 2); // 8/3, 8/4 の2日（8/3の重複は1日として数える）
  assert.equal(lastWeek.gymCount, expected);
});

test('gymCountは weekFeasibility の done とも一致する（今週について）', () => {
  const workouts = [
    { date: '2026-08-03', program: 'A' },
    { date: '2026-08-04', program: 'B' },
    { date: '2026-08-04', program: 'B' }
  ];
  const today = '2026-08-05';
  const { weeks } = buildCalendarWeeks({ workouts, badminton: [], todayStr: today });
  const lastWeek = weeks[weeks.length - 1];
  const feas = weekFeasibility(workouts, today);
  assert.equal(lastWeek.weekKey, weekKey(today));
  assert.equal(lastWeek.gymCount, feas.done);
});

test('記録の無い週は gymCount:0', () => {
  const { weeks } = buildCalendarWeeks({ workouts: [], badminton: [], todayStr: '2026-08-05' });
  for (const w of weeks) assert.equal(w.gymCount, 0);
});

test('GYM_TARGET_PER_WEEKは3（週3回の目標と揃える）', () => {
  assert.equal(GYM_TARGET_PER_WEEK, 3);
});

// --- program の印 ---

test('programがA/B/Cのいずれかで一意なら、その文字を返す', () => {
  const workouts = [{ date: '2026-08-03', program: 'C' }];
  const { weeks } = buildCalendarWeeks({ workouts, badminton: [], todayStr: '2026-08-05' });
  const day = weeks[weeks.length - 1].days.find((d) => d.date === '2026-08-03');
  assert.equal(day.program, 'C');
});

test('記録の無い日は program:null', () => {
  const { weeks } = buildCalendarWeeks({ workouts: [], badminton: [], todayStr: '2026-08-05' });
  const day = weeks[weeks.length - 1].days.find((d) => d.date === '2026-08-03');
  assert.equal(day.program, null);
});

test('programが不正/欠損な記録は unknown（無かったことにはしない）', () => {
  const workouts = [{ date: '2026-08-03', program: 'X' }, { date: '2026-08-04' }];
  const { weeks } = buildCalendarWeeks({ workouts, badminton: [], todayStr: '2026-08-05' });
  const days = weeks[weeks.length - 1].days;
  assert.equal(days.find((d) => d.date === '2026-08-03').program, 'unknown');
  assert.equal(days.find((d) => d.date === '2026-08-04').program, 'unknown');
});

test('同日に異なるprogramが複数あれば unknown（どちらか一方を嘘で決め打ちしない）', () => {
  const workouts = [
    { date: '2026-08-03', program: 'A' },
    { date: '2026-08-03', program: 'B' }
  ];
  const { weeks } = buildCalendarWeeks({ workouts, badminton: [], todayStr: '2026-08-05' });
  const day = weeks[weeks.length - 1].days.find((d) => d.date === '2026-08-03');
  assert.equal(day.program, 'unknown');
});

test('null要素・日付欠損の壊れたworkoutsレコードは例外を投げずに無視する', () => {
  const workouts = [null, { program: 'A' }, { date: '2026-13-40', program: 'B' }, { date: '2026-08-03', program: 'A' }];
  const { weeks } = buildCalendarWeeks({ workouts, badminton: [], todayStr: '2026-08-05' });
  const day = weeks[weeks.length - 1].days.find((d) => d.date === '2026-08-03');
  assert.equal(day.program, 'A');
});

// --- バドミントン・写真 ---

test('badmintonの日は hasBadminton:true', () => {
  const badminton = [{ date: '2026-08-04' }];
  const { weeks } = buildCalendarWeeks({ workouts: [], badminton, todayStr: '2026-08-05' });
  const day = weeks[weeks.length - 1].days.find((d) => d.date === '2026-08-04');
  assert.equal(day.hasBadminton, true);
});

test('null要素・日付欠損のbadmintonレコードは例外を投げずに無視する', () => {
  const badminton = [null, {}, { date: 'garbage' }];
  assert.doesNotThrow(() => buildCalendarWeeks({ workouts: [], badminton, todayStr: '2026-08-05' }));
});

test('photoDatesにある日は hasPhoto:true、無ければfalse', () => {
  const photoDates = new Set(['2026-08-03']);
  const { weeks } = buildCalendarWeeks({ workouts: [], badminton: [], photoDates, todayStr: '2026-08-05' });
  const days = weeks[weeks.length - 1].days;
  assert.equal(days.find((d) => d.date === '2026-08-03').hasPhoto, true);
  assert.equal(days.find((d) => d.date === '2026-08-04').hasPhoto, false);
});

test('photoDatesを省略しても例外を投げず、全てfalseになる', () => {
  const { weeks } = buildCalendarWeeks({ workouts: [], badminton: [], todayStr: '2026-08-05' });
  for (const d of weeks[weeks.length - 1].days) assert.equal(d.hasPhoto, false);
});

test('同じ日にジム・バドミントン・写真が揃っても全部同時に立つ', () => {
  const workouts = [{ date: '2026-08-03', program: 'A' }];
  const badminton = [{ date: '2026-08-03' }];
  const photoDates = new Set(['2026-08-03']);
  const { weeks } = buildCalendarWeeks({ workouts, badminton, photoDates, todayStr: '2026-08-05' });
  const day = weeks[weeks.length - 1].days.find((d) => d.date === '2026-08-03');
  assert.equal(day.program, 'A');
  assert.equal(day.hasBadminton, true);
  assert.equal(day.hasPhoto, true);
});

// --- 年またぎ（weekKeyの年境界と整合するか） ---

test('年をまたぐ週でも weekKey と整合する', () => {
  const { weeks } = buildCalendarWeeks({ workouts: [], badminton: [], todayStr: '2026-01-01', weeks: 4 });
  for (const w of weeks) assert.equal(w.weekKey, weekKey(w.days[0].date));
});
