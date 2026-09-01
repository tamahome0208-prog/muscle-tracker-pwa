// このファイルのテストが「何を保証しているか」の記録。
// 下の MUTATION 行は、実装を意図的にその形へ壊したときに落ちるテストの件数である。
// テストが通ることは、そのテストが何かを保証している証拠にはならない。
// 保証しているかどうかは、壊して落ちることでしか確かめられない(docs/SPEC.md §5.2)。
// 実装を変えたら、この記録も実際に壊して数え直すこと。
// MUTATION: js/barcode.js:offProductToFood serving が片方だけでも 100g へ落とさず採用する => 期待失敗 1件
// MUTATION: js/barcode.js:offProductToFood の Number.isFinite 検査を外す => 期待失敗 1件
import test from 'node:test';
import assert from 'node:assert/strict';
import { offProductToFood } from '../js/barcode.js';

// Open Food Facts の応答を食品オブジェクトへ変換する純関数。
// 外部サービスから来る信頼できない構造を解釈する場所で、判断を1つ間違えると
// カロリー(死守2項目の一方)が静かにずれる。
// 以前は fetch の中に埋まっていてテストできなかった。

const jan = '4901234567894';

test('offProductToFood: 1食分(serving)の数値が両方揃っていれば「個」単位で採用する', () => {
  const r = offProductToFood({
    status: 1,
    product: {
      product_name_ja: 'サラダチキン',
      nutriments: { 'energy-kcal_serving': 114, proteins_serving: 24.1, 'energy-kcal_100g': 105, proteins_100g: 22.3 }
    }
  }, jan);
  assert.equal(r.source, 'openfoodfacts');
  assert.equal(r.food.unit, '個');
  assert.equal(r.food.kcal, 114);
  assert.equal(r.food.protein, 24.1);
  assert.equal(r.food.name, 'サラダチキン'); // 「個」単位では名前に注記を足さない
  assert.equal(r.food.id, `jan_${jan}`);
  assert.equal(r.food.useCount, 0);
});

test('offProductToFood: servingが片方しか無ければ100gあたりへ落とし、名前と単位の両方に明記する', () => {
  // 【なぜ重要か】100gあたりの数値を「1個分」として保存すると、
  // カロリーが静かにずれる。ずれたことに気づく手がかりが画面に無ければ、
  // 利用者は誤った合計を信じたまま食事を調整してしまう。
  const r = offProductToFood({
    status: 1,
    product: {
      product_name: 'Potato Chips',
      nutriments: { 'energy-kcal_serving': 300, 'energy-kcal_100g': 554, proteins_100g: 5.6 }
    }
  }, jan);
  assert.equal(r.food.unit, '100g');
  assert.equal(r.food.kcal, 554);
  assert.equal(r.food.protein, 5.6);
  assert.match(r.food.name, /100gあたり/, '名前にも100gあたりであることを残すこと');
});

test('offProductToFood: 日本語名を英語名より優先する', () => {
  const r = offProductToFood({
    status: 1,
    product: {
      product_name: 'Salad Chicken',
      product_name_ja: 'サラダチキン',
      nutriments: { 'energy-kcal_serving': 114, proteins_serving: 24.1 }
    }
  }, jan);
  assert.equal(r.food.name, 'サラダチキン');
});

test('offProductToFood: 名前が無ければ nameMissing を立てる（勝手に「商品◯◯」と名付けない）', () => {
  const r = offProductToFood({
    status: 1,
    product: { nutriments: { 'energy-kcal_serving': 114, proteins_serving: 24.1 } }
  }, jan);
  assert.equal(r.food.name, '');
  assert.equal(r.food.nameMissing, true);
});

test('offProductToFood: 名前があれば nameMissing は false', () => {
  const r = offProductToFood({
    status: 1,
    product: { product_name_ja: 'x', nutriments: { 'energy-kcal_serving': 1, proteins_serving: 1 } }
  }, jan);
  assert.equal(r.food.nameMissing, false);
});

test('offProductToFood: 栄養値が無い商品は null（0kcalの食品として登録しない）', () => {
  assert.equal(offProductToFood({ status: 1, product: { product_name: 'x', nutriments: {} } }, jan), null);
  assert.equal(offProductToFood({ status: 1, product: { product_name: 'x' } }, jan), null);
});

test('offProductToFood: 数値として読めない値・負値は null', () => {
  // Number('たくさん') は NaN。Math.round(NaN) は NaN で、そのまま保存すると
  // 合計が NaN に伝播して画面全体が壊れる。
  const bad = [
    { 'energy-kcal_serving': 'たくさん', proteins_serving: 24.1 },
    { 'energy-kcal_serving': 114, proteins_serving: null },
    { 'energy-kcal_serving': -100, proteins_serving: 5 }
  ];
  for (const nutriments of bad) {
    assert.equal(
      offProductToFood({ status: 1, product: { product_name: 'x', nutriments } }, jan), null,
      `${JSON.stringify(nutriments)} は null を返すべき`
    );
  }
});

test('offProductToFood: status!==1 / product 欠落 / 空の応答は null', () => {
  assert.equal(offProductToFood({ status: 0 }, jan), null);
  assert.equal(offProductToFood({ status: 1 }, jan), null);
  assert.equal(offProductToFood({}, jan), null);
  assert.equal(offProductToFood(null, jan), null);
  assert.equal(offProductToFood(undefined, jan), null);
});

test('offProductToFood: タンパク質は小数第1位に丸める（表示と保存で桁が食い違わないように）', () => {
  const r = offProductToFood({
    status: 1,
    product: { product_name: 'x', nutriments: { 'energy-kcal_serving': 114.6, proteins_serving: 24.16 } }
  }, jan);
  assert.equal(r.food.kcal, 115);
  assert.equal(r.food.protein, 24.2);
});
