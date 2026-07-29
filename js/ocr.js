// 食事写真とレシートだけをGemini APIに送る。体の写真はこのモジュールを通らない。

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const MEAL_PROMPT = `この写真に写っている食べ物を推定してください。
日本の一般的な食品の栄養値を使い、1品ごとに名前・カロリー(kcal)・タンパク質(g)を返してください。
飲み物にアルコールが含まれる場合は alcoholMl にmL数を入れてください。
JSONのみを返してください。説明文は不要です。
形式: {"items":[{"name":"...","kcal":0,"protein":0,"alcoholMl":0}]}`;

const RECEIPT_PROMPT = `このレシートから飲食物の品目だけを抽出してください。
日用品・雑貨・レジ袋などの食べ物でないものは除外してください。
各品目について日本の一般的な栄養値でカロリー(kcal)とタンパク質(g)を推定してください。
アルコール飲料は alcoholMl にmL数を入れてください。
JSONのみを返してください。説明文は不要です。
形式: {"items":[{"name":"...","kcal":0,"protein":0,"alcoholMl":0}]}`;

export class OcrError extends Error {}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new OcrError('画像を読み込めませんでした'));
    reader.readAsDataURL(blob);
  });
}

async function callGemini(prompt, blob, apiKey) {
  if (!apiKey) throw new OcrError('APIキーが設定されていません');
  if (!navigator.onLine) throw new OcrError('オフラインのため解析できません');

  const base64 = await blobToBase64(blob);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);

  let res;
  try {
    res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  return parseItems(text);
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
    alcoholMl: Number(i.alcoholMl) || 0
  }));
}

export function analyzeMealPhoto(blob, apiKey) {
  return callGemini(MEAL_PROMPT, blob, apiKey);
}

export function analyzeReceipt(blob, apiKey) {
  return callGemini(RECEIPT_PROMPT, blob, apiKey);
}
