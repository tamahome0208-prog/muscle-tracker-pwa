import test from 'node:test';
import assert from 'node:assert/strict';
import { ageBand, microTargetsForAge, alcoholGrams, AGE_BANDS, DEFAULT_ALCOHOL_ABV_PCT, applyAldh2Answer } from '../js/micronutrients.js';

test('ageBand: 18-29歳はYOUNG帯になる', () => {
  assert.equal(ageBand(25), AGE_BANDS.YOUNG);
  assert.equal(ageBand(18), AGE_BANDS.YOUNG);
  assert.equal(ageBand(29), AGE_BANDS.YOUNG);
});

test('ageBand: 30歳以上はMID帯になる', () => {
  assert.equal(ageBand(30), AGE_BANDS.MID);
  assert.equal(ageBand(35), AGE_BANDS.MID);
  assert.equal(ageBand(60), AGE_BANDS.MID);
});

test('ageBand: 不正/未指定な年齢はMID帯にフォールバックする', () => {
  assert.equal(ageBand(undefined), AGE_BANDS.MID);
  assert.equal(ageBand(null), AGE_BANDS.MID);
  assert.equal(ageBand('abc'), AGE_BANDS.MID);
  assert.equal(ageBand(-5), AGE_BANDS.MID);
});

test('microTargetsForAge: 25歳(YOUNG帯)は食物繊維20g・カルシウム800mg', () => {
  const t = microTargetsForAge(25);
  assert.equal(t.band, AGE_BANDS.YOUNG);
  assert.equal(t.fibreG, 20);
  assert.equal(t.calciumMg, 800);
  assert.equal(t.vitaminDUg, 9.0);
  assert.equal(t.saltG, 7.5);
});

test('microTargetsForAge: 35歳(MID帯)は食物繊維22g・カルシウム750mg', () => {
  const t = microTargetsForAge(35);
  assert.equal(t.band, AGE_BANDS.MID);
  assert.equal(t.fibreG, 22);
  assert.equal(t.calciumMg, 750);
  // ビタミンD・食塩相当量は年代で変わらない(数値表の通り)
  assert.equal(t.vitaminDUg, 9.0);
  assert.equal(t.saltG, 7.5);
});

test('alcoholGrams: 500ml・5%は20g(MHLW式: ml × 度数% ÷ 100 × 0.8)', () => {
  assert.equal(alcoholGrams(500, 5), 20);
});

test('alcoholGrams: 度数未指定なら既定値(5%, このユーザーの実際の飲酒習慣)を使う', () => {
  assert.equal(DEFAULT_ALCOHOL_ABV_PCT, 5);
  assert.equal(alcoholGrams(500), 20);
});

test('alcoholGrams: 不正な入力(0以下・非数値)は0を返す(例外を投げない)', () => {
  assert.equal(alcoholGrams(0), 0);
  assert.equal(alcoholGrams(-100), 0);
  assert.equal(alcoholGrams('oops'), 0);
  assert.equal(alcoholGrams(500, 0), 0);
  assert.equal(alcoholGrams(500, 'oops'), 0);
});

// --- ALDH2フラッシング質問の回答保存 ---

test('applyAldh2Answer: 初回回答(null→yes)は通知の既読フラグを立てない(まだ見せていないため)', () => {
  const profile = { aldh2Flushing: null, aldh2NoticeDismissed: false };
  const next = applyAldh2Answer(profile, 'yes');
  assert.equal(next.aldh2Flushing, 'yes');
  assert.equal(next.aldh2NoticeDismissed, false);
});

test('applyAldh2Answer: no/skippedを保存しても通知フラグには触れない', () => {
  const profile = { aldh2Flushing: null, aldh2NoticeDismissed: false };
  assert.equal(applyAldh2Answer(profile, 'no').aldh2Flushing, 'no');
  assert.equal(applyAldh2Answer(profile, 'skipped').aldh2Flushing, 'skipped');
});

test('applyAldh2Answer: 一度yesを閉じた後、noを経てまたyesに変えると通知を再び見せる(dismissedをfalseに戻す)', () => {
  const afterDismiss = { aldh2Flushing: 'yes', aldh2NoticeDismissed: true };
  const changedToNo = applyAldh2Answer(afterDismiss, 'no');
  assert.equal(changedToNo.aldh2NoticeDismissed, true); // yes以外への変更ではリセットしない
  const backToYes = applyAldh2Answer(changedToNo, 'yes');
  assert.equal(backToYes.aldh2Flushing, 'yes');
  assert.equal(backToYes.aldh2NoticeDismissed, false, '一度閉じた通知でも、noを経て再度yesに変えたら少なくとも一度は見せ直す');
});

test('applyAldh2Answer: 既にyesのまま据え置き保存した場合は、閉じた通知を再度出さない', () => {
  const dismissed = { aldh2Flushing: 'yes', aldh2NoticeDismissed: true };
  const stillYes = applyAldh2Answer(dismissed, 'yes');
  assert.equal(stillYes.aldh2NoticeDismissed, true, '据え置き保存で毎回通知が復活すると"一度だけ"の約束が崩れる');
});
