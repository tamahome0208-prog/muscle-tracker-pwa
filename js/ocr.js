// 食事写真・レシート・インボディ結果紙をGemini APIに送る。体の進捗写真(js/photos.js)はこのモジュールを通らない。

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// fibre(食物繊維g)・vitaminD(ビタミンDµg)・calcium(カルシウムmg)・salt(食塩相当量g)は
// このアプリが二次的に(死守2項目ではなく参考値として)追跡する4項目
// (js/micronutrients.js 参照)。確認画面で必ず数値を見せて修正できるようにするが、
// 手入力(js/mealTab.js の openItemForm)には追加しない — OCRなら写真から自動推定できるが、
// 手入力にまで4項目を追加すると「立ったまま入力する」前提のこのアプリで
// 入力の手間だけが増え、誰も埋めないフィールドが増えるだけになる。
const MEAL_PROMPT = `この写真に写っている食べ物を推定してください。
日本の一般的な食品の栄養値を使い、1品ごとに名前・カロリー(kcal)・タンパク質(g)・脂質(g)・炭水化物(g)・
食物繊維(g)・ビタミンD(µg)・カルシウム(mg)・食塩相当量(g)を返してください。
飲み物にアルコールが含まれる場合は alcoholMl にmL数を入れてください。
JSONのみを返してください。説明文は不要です。
形式: {"items":[{"name":"...","kcal":0,"protein":0,"fat":0,"carb":0,"fibre":0,"vitaminD":0,"calcium":0,"salt":0,"alcoholMl":0}]}`;

const RECEIPT_PROMPT = `このレシートから飲食物の品目だけを抽出してください。
日用品・雑貨・レジ袋などの食べ物でないものは除外してください。
各品目について日本の一般的な栄養値でカロリー(kcal)・タンパク質(g)・脂質(g)・炭水化物(g)・
食物繊維(g)・ビタミンD(µg)・カルシウム(mg)・食塩相当量(g)を推定してください。
アルコール飲料は alcoholMl にmL数を入れてください。
JSONのみを返してください。説明文は不要です。
形式: {"items":[{"name":"...","kcal":0,"protein":0,"fat":0,"carb":0,"fibre":0,"vitaminD":0,"calcium":0,"salt":0,"alcoholMl":0}]}`;

const INBODY_PROMPT = `このインボディ（体組成計）の結果紙から3つの数値だけを読み取ってください。
体重(kg)、骨格筋量または筋肉量(kg)、体脂肪率(%)の3つです。
JSONのみを返してください。説明文は不要です。
形式: {"weight":0,"muscle":0,"fatPct":0}`;

export class OcrError extends Error {}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new OcrError('画像を読み込めませんでした'));
    reader.readAsDataURL(blob);
  });
}

async function callGeminiRaw(prompt, blob, apiKey) {
  if (!apiKey) throw new OcrError('APIキーが設定されていません');
  if (!navigator.onLine) throw new OcrError('オフラインのため解析できません');

  const base64 = await blobToBase64(blob);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  let res;
  try {
    // APIキーはURLのクエリ文字列ではなくヘッダーで送る。クエリは経路上の
    // プロキシ/アクセスログに残りやすく、資格情報の漏洩経路として最も
    // 警戒すべき箇所のひとつ。
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: blob.type || 'image/jpeg', data: base64 } }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });
  } catch {
    throw new OcrError('解析に失敗しました（通信エラー）');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new OcrError(`解析に失敗しました（HTTP ${res.status}）`);

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new OcrError('解析結果を読み取れませんでした');

  return text;
}

/** モデルの出力から品目配列を取り出す。数値でない値は0に落として必ず配列を返す */
export function parseItems(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OcrError('解析結果の形式が不正です');
  }
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  if (items.length === 0) throw new OcrError('食べ物を認識できませんでした');
  return items.map((i) => ({
    name: String(i.name ?? '不明'),
    kcal: Number(i.kcal) || 0,
    protein: Number(i.protein) || 0,
    fat: Number(i.fat) || 0,
    carb: Number(i.carb) || 0,
    fibre: Number(i.fibre) || 0,
    vitaminD: Number(i.vitaminD) || 0,
    calcium: Number(i.calcium) || 0,
    salt: Number(i.salt) || 0,
    alcoholMl: Number(i.alcoholMl) || 0
  }));
}

export async function analyzeMealPhoto(blob, apiKey) {
  return parseItems(await callGeminiRaw(MEAL_PROMPT, blob, apiKey));
}

export async function analyzeReceipt(blob, apiKey) {
  return parseItems(await callGeminiRaw(RECEIPT_PROMPT, blob, apiKey));
}

/** インボディ結果紙から体重・筋肉量・体脂肪率を読み取る */
export async function analyzeInbody(blob, apiKey) {
  const text = await callGeminiRaw(INBODY_PROMPT, blob, apiKey);
  return parseBody(text);
}

/** モデル出力から体組成3項目を取り出す。1つでも欠けていれば失敗させる */
export function parseBody(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OcrError('解析結果の形式が不正です');
  }
  const weight = Number(parsed?.weight);
  const muscle = Number(parsed?.muscle);
  const fatPct = Number(parsed?.fatPct);
  if (![weight, muscle, fatPct].every((n) => Number.isFinite(n) && n > 0)) {
    throw new OcrError('数値を読み取れませんでした');
  }
  return { weight, muscle, fatPct };
}
