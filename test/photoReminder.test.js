// このファイルのテストが「何を保証しているか」の記録。
// 下の MUTATION 行は、実装を意図的にその形へ壊したときに落ちるテストの件数である。
// テストが通ることは、そのテストが何かを保証している証拠にはならない。
// 保証しているかどうかは、壊して落ちることでしか確かめられない(docs/SPEC.md §5.2)。
// 実装を変えたら、この記録も実際に壊して数え直すこと。
// MUTATION: js/photoReminder.js:PHOTO_INTERVAL_DAYS 42->7 => 期待失敗 2件
// MUTATION: js/photoReminder.js:settings.photoReminder のOFF判定を外す => 期待失敗 1件
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldShowPhotoReminder, PHOTO_INTERVAL_DAYS } from '../js/photoReminder.js';

// 【なぜこの機能が要るか】
// settings.photoReminder は元から DEFAULTS に存在したが、どこからも読まれていない
// 死んだ設定だった(書いたまま繋いでいない)。
//
// このユーザーの目標は細マッチョ = 見た目である。
// 体重や体脂肪率の数字は測定誤差に埋もれる(js/goals.js がまさにそう述べており、
// トレンドの表示に10週分の記録を要求している)のに対し、
// 写真は3ヶ月で明確に変わる。**最も効く証拠が、撮り忘れで残らない。**

const SETTINGS = { photoReminder: true, photoReminderDismissedAt: null };

test('PHOTO_INTERVAL_DAYS は42日（6週間）', () => {
  // 【なぜ6週間か】毎週撮っても見た目はほぼ変わらず、撮る意味を感じなくなる。
  // 一方3ヶ月空けると、その間の変化を後から取り返せない。
  // js/goals.js が体組成のトレンドに8〜12週を要求していることとも整合する
  // (数字が動いたと言える頃には、写真も並べて見比べられる)。
  assert.equal(PHOTO_INTERVAL_DAYS, 42);
});

test('写真が1枚も無く、記録を始めて日が経っていれば出す', () => {
  // 開始直後に出すと「まだ何も無いのに」となるので、開始から42日は待つ。
  assert.equal(shouldShowPhotoReminder(null, '2026-07-01', SETTINGS, '2026-08-19'), true);
});

test('写真が1枚も無くても、始めたばかりなら出さない', () => {
  assert.equal(shouldShowPhotoReminder(null, '2026-08-01', SETTINGS, '2026-08-19'), false);
});

test('最後の撮影から42日以上経っていれば出す', () => {
  assert.equal(shouldShowPhotoReminder('2026-07-01', '2026-01-01', SETTINGS, '2026-08-19'), true);
});

test('最後の撮影から42日未満なら出さない', () => {
  assert.equal(shouldShowPhotoReminder('2026-08-01', '2026-01-01', SETTINGS, '2026-08-19'), false);
});

test('設定でOFFにしていたら、条件を満たしても出さない', () => {
  const off = { ...SETTINGS, photoReminder: false };
  assert.equal(shouldShowPhotoReminder('2026-01-01', '2026-01-01', off, '2026-08-19'), false);
});

test('「あとで」で閉じてから42日間は出さない', () => {
  const dismissed = { ...SETTINGS, photoReminderDismissedAt: '2026-08-01' };
  assert.equal(shouldShowPhotoReminder('2026-01-01', '2026-01-01', dismissed, '2026-08-19'), false);
  // 42日経てばまた出る
  assert.equal(shouldShowPhotoReminder('2026-01-01', '2026-01-01', dismissed, '2026-09-15'), true);
});

test('開始日が未設定なら出さない（いつから数えるか決められない）', () => {
  assert.equal(shouldShowPhotoReminder(null, null, SETTINGS, '2026-08-19'), false);
});

test('壊れた日付は「未設定」として扱い、例外を投げない', () => {
  assert.equal(shouldShowPhotoReminder('いつか', '2026-07-01', SETTINGS, '2026-08-19'), true);
  assert.equal(shouldShowPhotoReminder(null, 'いつか', SETTINGS, '2026-08-19'), false);
  const broken = { ...SETTINGS, photoReminderDismissedAt: 'いつか' };
  assert.equal(shouldShowPhotoReminder('2026-01-01', '2026-01-01', broken, '2026-08-19'), true);
});

test('settings が丸ごと欠けていても既定でONとして扱う', () => {
  // photoReminder は DEFAULTS で true。settings を読めない状況でも、
  // 「撮り忘れを放置する」より「出す」方に倒す(閉じれば42日は黙る)。
  assert.equal(shouldShowPhotoReminder('2026-01-01', '2026-01-01', null, '2026-08-19'), true);
  assert.equal(shouldShowPhotoReminder('2026-01-01', '2026-01-01', undefined, '2026-08-19'), true);
});
