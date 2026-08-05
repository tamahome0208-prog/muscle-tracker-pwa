import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowBackupReminder, MEANINGFUL_RECORD_COUNT, REMINDER_INTERVAL_DAYS } from '../js/backupReminder.js';

const NONE = { lastExportDate: null, backupReminderDismissedAt: null };

test('しきい値未満のデータ量では出さない', () => {
  assert.equal(shouldShowBackupReminder(MEANINGFUL_RECORD_COUNT - 1, NONE, '2026-08-04'), false);
});

test('しきい値以上かつ未エクスポートなら出す', () => {
  assert.equal(shouldShowBackupReminder(MEANINGFUL_RECORD_COUNT, NONE, '2026-08-04'), true);
});

test('直近にエクスポート済みなら出さない', () => {
  const settings = { lastExportDate: '2026-08-01', backupReminderDismissedAt: null };
  assert.equal(shouldShowBackupReminder(20, settings, '2026-08-04'), false); // 3日前
});

test('エクスポートから14日以上経てば再び出す', () => {
  const settings = { lastExportDate: '2026-07-20', backupReminderDismissedAt: null };
  assert.equal(shouldShowBackupReminder(20, settings, '2026-08-04'), true); // 15日前
});

test('エクスポートからちょうど14日ならまだ出す(14日以上の境界)', () => {
  const settings = { lastExportDate: '2026-07-21', backupReminderDismissedAt: null };
  assert.equal(shouldShowBackupReminder(20, settings, '2026-08-04'), true); // ちょうど14日
});

test('閉じた直後は14日間出さない', () => {
  const settings = { lastExportDate: null, backupReminderDismissedAt: '2026-08-01' };
  assert.equal(shouldShowBackupReminder(20, settings, '2026-08-04'), false); // 3日前に閉じた
});

test('閉じてから14日経てば再び出す(未エクスポートのまま)', () => {
  const settings = { lastExportDate: null, backupReminderDismissedAt: '2026-07-20' };
  assert.equal(shouldShowBackupReminder(20, settings, '2026-08-04'), true); // 15日前
});

test('壊れた日付(手編集・古いインポート等)は未設定として扱い、出す方向に倒す', () => {
  const settings = { lastExportDate: 'garbage', backupReminderDismissedAt: 'also-garbage' };
  assert.equal(shouldShowBackupReminder(20, settings, '2026-08-04'), true);
});

test('settings自体がundefinedでも例外を投げない', () => {
  assert.equal(shouldShowBackupReminder(20, undefined, '2026-08-04'), true);
});

test('REMINDER_INTERVAL_DAYSは14日(2週間に一度のリズム)', () => {
  assert.equal(REMINDER_INTERVAL_DAYS, 14);
});
