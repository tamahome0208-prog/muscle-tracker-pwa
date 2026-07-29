// バーコードから食品を特定する。外部に送るのはJANコード13桁のみ。

const OFF_ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product/';

export function isBarcodeSupported() {
  return 'BarcodeDetector' in globalThis;
}

/** カメラ映像からJANコードを1件読み取る。timeoutMs内に読めなければ null */
export async function scanJan(videoEl, timeoutMs = 15000) {
  if (!isBarcodeSupported()) return null;
  const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const codes = await detector.detect(videoEl);
      if (codes.length) return codes[0].rawValue;
    } catch {
      return null;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

/** ローカルのマイメニューを先に見る。無ければ Open Food Facts に問い合わせる */
export async function lookupJan(jan, foods, useOpenFoodFacts) {
  const local = foods.find((f) => f.jan === jan);
  if (local) return { source: 'local', food: local };
  if (!useOpenFoodFacts) return null;

  try {
    const res = await fetch(`${OFF_ENDPOINT}${encodeURIComponent(jan)}.json?fields=product_name,product_name_ja,nutriments`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const n = data.product.nutriments ?? {};
    const kcal = n['energy-kcal_serving'] ?? n['energy-kcal_100g'];
    const protein = n.proteins_serving ?? n.proteins_100g;
    if (kcal === undefined || protein === undefined) return null;
    return {
      source: 'openfoodfacts',
      food: {
        id: `jan_${jan}`,
        jan,
        name: data.product.product_name_ja || data.product.product_name || `商品 ${jan}`,
        unit: '個',
        kcal: Math.round(kcal),
        protein: Math.round(protein * 10) / 10,
        useCount: 0
      }
    };
  } catch {
    return null;
  }
}
