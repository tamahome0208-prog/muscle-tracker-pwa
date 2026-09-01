// このファイルのテストが「何を保証しているか」の記録。
// 下の MUTATION 行は、実装を意図的にその形へ壊したときに落ちるテストの件数である。
// テストが通ることは、そのテストが何かを保証している証拠にはならない。
// 保証しているかどうかは、壊して落ちることでしか確かめられない(docs/SPEC.md §5.2)。
// 実装を変えたら、この記録も実際に壊して数え直すこと。
// MUTATION: js/ocr.js:parseBody の「全項目が正の有限数」検査を外す => 期待失敗 2件
// MUTATION: js/ocr.js:parseItems の items.length===0 検査を外す => 期待失敗 1件
// MUTATION: js/ocr.js:callGeminiRaw の instanceof File 検査を外す => 期待失敗 ?件
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseItems, parseBody, OcrError, analyzeMealPhoto, analyzeReceipt, analyzeInbody } from '../js/ocr.js';

// js/ocr.js の parseItems / parseBody は、Gemini が返した文字列を解釈する純関数。
// このアプリで「外部から来た信頼できない文字列」を最初に受け取る場所であり、
// ここが甘いと壊れた値がそのまま食事記録・体組成記録として保存される。
// DOM にもネットワークにも触れないので、UI層と違ってそのままテストできる。

// --- parseItems（食事写真・レシートの解析結果） ---

test('parseItems: 正常なJSONから品目を取り出し、欠けたフィールドは0で埋める', () => {
  const items = parseItems(JSON.stringify({
    items: [{ name: '唐揚げ', kcal: 600, protein: 35 }]
  }));
  assert.equal(items.length, 1);
  assert.equal(items[0].name, '唐揚げ');
  assert.equal(items[0].kcal, 600);
  assert.equal(items[0].protein, 35);
  // 未指定の栄養素は0。ここで undefined を残すと、合計時に NaN へ伝播する。
  for (const k of ['fat', 'carb', 'fibre', 'vitaminD', 'calcium', 'salt', 'alcoholMl']) {
    assert.equal(items[0][k], 0, `${k} は0で埋まるべき`);
  }
});

test('parseItems: JSONとして読めない文字列は OcrError', () => {
  assert.throws(() => parseItems('これはJSONではない'), OcrError);
  assert.throws(() => parseItems(''), OcrError);
});

test('parseItems: items が空・非配列なら OcrError（黙って0件を返さない）', () => {
  // 0件を静かに返すと、利用者は「解析できた」と思ったまま何も記録されない。
  assert.throws(() => parseItems(JSON.stringify({ items: [] })), OcrError);
  assert.throws(() => parseItems(JSON.stringify({ items: 'からあげ' })), OcrError);
  assert.throws(() => parseItems(JSON.stringify({})), OcrError);
});

test('parseItems: 非数値の栄養素は NaN にせず0にする', () => {
  const items = parseItems(JSON.stringify({
    items: [{ name: 'x', kcal: 'たくさん', protein: null, fat: undefined }]
  }));
  assert.equal(items[0].kcal, 0);
  assert.equal(items[0].protein, 0);
  assert.equal(items[0].fat, 0);
  assert.ok(Number.isFinite(items[0].kcal));
});

test('parseItems: name が無ければ「不明」にする（undefined を画面に出さない）', () => {
  const items = parseItems(JSON.stringify({ items: [{ kcal: 100 }] }));
  assert.equal(items[0].name, '不明');
});

// --- parseBody（InBody結果紙の解析結果） ---

test('parseBody: 3項目そろっていれば数値で返す', () => {
  const v = parseBody(JSON.stringify({ weight: 60.2, muscle: 28.5, fatPct: 19.8 }));
  assert.deepEqual(v, { weight: 60.2, muscle: 28.5, fatPct: 19.8 });
});

test('parseBody: 1項目でも欠ければ OcrError（部分的な記録を保存させない）', () => {
  // 【なぜ全項目必須か】js/body.js は欠損値を0として扱うため、weight だけ欠けた
  // レコードを保存すると「開始比 +59.8kg」のような、実際の値と大きくずれた
  // 差分が表示される。3項目そろわない記録は保存させない。
  assert.throws(() => parseBody(JSON.stringify({ muscle: 28.5, fatPct: 19.8 })), OcrError);
  assert.throws(() => parseBody(JSON.stringify({ weight: 60.2, fatPct: 19.8 })), OcrError);
  assert.throws(() => parseBody(JSON.stringify({ weight: 60.2, muscle: 28.5 })), OcrError);
});

test('parseBody: 0以下・非数値は読み取り失敗として扱う', () => {
  assert.throws(() => parseBody(JSON.stringify({ weight: 0, muscle: 28.5, fatPct: 19.8 })), OcrError);
  assert.throws(() => parseBody(JSON.stringify({ weight: -60, muscle: 28.5, fatPct: 19.8 })), OcrError);
  assert.throws(() => parseBody(JSON.stringify({ weight: '60kg', muscle: 28.5, fatPct: 19.8 })), OcrError);
});

test('parseBody: JSONとして読めない文字列は OcrError', () => {
  assert.throws(() => parseBody('読み取れませんでした'), OcrError);
});

// --- 【プライバシー】保存済みの体の写真を送信できないこと（R2.7.6） ---
// 「体の写真は Gemini に送られない」保証を、呼び出し側が呼ばないことだけに
// 依存させない。ocr.js 側に門を置く。
// 食事写真・レシート・InBody結果紙はいずれも <input type="file"> 由来で File だが、
// 体の進捗写真は js/photos.js が canvas.toBlob で作って IndexedDB に保存した素の Blob。

test('analyzeMealPhoto / analyzeReceipt / analyzeInbody: File でない Blob を拒否する', async () => {
  const storedPhoto = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
  for (const [name, fn] of [
    ['analyzeMealPhoto', analyzeMealPhoto],
    ['analyzeReceipt', analyzeReceipt],
    ['analyzeInbody', analyzeInbody]
  ]) {
    await assert.rejects(
      () => fn(storedPhoto, 'dummy-key'),
      (err) => err instanceof OcrError && /その場で選択した画像ファイル/.test(err.message),
      `${name} は保存済みBlobを拒否しなければならない`
    );
  }
});

test('analyzeInbody: File なら型の検査は通り、次の検査(APIキー)へ進む', async () => {
  // 型の検査が「常に落ちる」のでは機能を殺しているだけなので、
  // 正しい入力では通ることも確かめる。
  const picked = new File([new Uint8Array([1, 2, 3])], 'inbody.jpg', { type: 'image/jpeg' });
  await assert.rejects(
    () => analyzeInbody(picked, ''),
    (err) => err instanceof OcrError && /APIキー/.test(err.message)
  );
});
