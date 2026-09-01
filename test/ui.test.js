// このファイルのテストが「何を保証しているか」の記録。
// 下の MUTATION 行は、実装を意図的にその形へ壊したときに落ちるテストの件数である。
// テストが通ることは、そのテストが何かを保証している証拠にはならない。
// 保証しているかどうかは、壊して落ちることでしか確かめられない(docs/SPEC.md §5.2)。
// 実装を変えたら、この記録も実際に壊して数え直すこと。
// MUTATION: js/ui.js:esc の < > を置換対象から外す => 期待失敗 2件
// MUTATION: js/ui.js:esc の ?? '' を外す(null/undefined を素通し) => 期待失敗 1件
import test from 'node:test';
import assert from 'node:assert/strict';
import { esc } from '../js/ui.js';

// js/ui.js の大半は DOM に触れるためテストできないが、esc() だけは純関数であり、
// かつこのアプリの XSS 防御の中核でもある。
// 食品名は OCR・バーコード照会・利用者入力から来る外部文字列で、
// それが innerHTML に入る経路が実際にある(js/mealTab.js, js/dayView.js 等)。
// scripts/verify-spec.mjs の R1.3.2 は「esc() を通しているか」を検査するが、
// esc() 自体が正しいかは検査していない。ここで押さえる。

test('esc: HTMLの構文を壊す5文字をすべて実体参照へ変換する', () => {
  assert.equal(esc('<'), '&lt;');
  assert.equal(esc('>'), '&gt;');
  assert.equal(esc('&'), '&amp;');
  assert.equal(esc('"'), '&quot;');
  assert.equal(esc("'"), '&#39;');
});

test('esc: スクリプトタグを無害化する', () => {
  const attacked = '<script>alert(1)</script>';
  const escaped = esc(attacked);
  assert.equal(escaped, '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.ok(!escaped.includes('<'), 'エスケープ後に生の < が残ってはならない');
});

test('esc: 属性値を抜け出す攻撃を無害化する', () => {
  // <button data-food="${f.id}"> のような属性への埋め込みが実在するため、
  // " と ' の両方をエスケープできなければ属性を抜け出される。
  const escaped = esc('" onclick="alert(1)');
  assert.ok(!escaped.includes('"'), 'エスケープ後に生の " が残ってはならない');
  const single = esc("' onclick='alert(1)");
  assert.ok(!single.includes("'"), "エスケープ後に生の ' が残ってはならない");
});

test('esc: & を二重エスケープせず、1回だけ変換する', () => {
  assert.equal(esc('a & b'), 'a &amp; b');
  // 既にエスケープ済みの文字列を再度通すと &amp;lt; になる（＝二重エスケープ）。
  // これは仕様どおりの挙動で、呼び出し側が2回通さないことを前提にしている。
  assert.equal(esc('&lt;'), '&amp;lt;');
});

test('esc: null / undefined は空文字にする（"undefined" と表示しない）', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('esc: 数値・真偽値は文字列化する', () => {
  assert.equal(esc(0), '0');
  assert.equal(esc(60.5), '60.5');
  assert.equal(esc(false), 'false');
});

test('esc: 日本語・記号を含む通常の食品名はそのまま通す', () => {
  assert.equal(esc('からあげ（100gあたり）'), 'からあげ（100gあたり）');
  assert.equal(esc('発泡酒500ml'), '発泡酒500ml');
});
