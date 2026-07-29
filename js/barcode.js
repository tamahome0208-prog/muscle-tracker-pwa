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

    // 1食分の数値が両方揃っている場合だけ「1個」として扱う。
    // 揃っていない場合に100gあたりの数値を1個分として保存すると、
    // カロリー(死守2項目の一方)が静かにずれるため、その場合は
    // 100gあたりの数値と分かるよう unit と名前の両方に明記する。
    const n = data.product.nutriments ?? {};
    const kcalServing = n['energy-kcal_serving'];
    const proteinServing = n.proteins_serving;
    const kcal100 = n['energy-kcal_100g'];
    const protein100 = n.proteins_100g;

    let kcal, protein, unit;
    if (kcalServing !== undefined && proteinServing !== undefined) {
      kcal = kcalServing;
      protein = proteinServing;
      unit = '個';
    } else if (kcal100 !== undefined && protein100 !== undefined) {
      kcal = kcal100;
      protein = protein100;
      unit = '100g';
    } else {
      return null;
    }

    // OFF に品名が無い商品を「商品 <JAN>」のまま登録すると、ワンタップ一覧に
    // 判読できないボタンが並んでしまい、このタブの存在意義(よく食べるものが
    // 1タップで届く)を損なう。栄養値はOFFのものをそのまま使い、名前だけその場で尋ねる。
    let name = data.product.product_name_ja || data.product.product_name || '';
    if (!name) {
      name = prompt(`品名を取得できませんでした（JAN: ${jan}）\n品名を入力してください`);
      if (!name) return null;
    }
    if (unit === '100g') name = `${name}（100gあたり）`;

    return {
      source: 'openfoodfacts',
      food: {
        id: `jan_${jan}`,
        jan,
        name,
        unit,
        kcal: Math.round(kcal),
        protein: Math.round(protein * 10) / 10,
        useCount: 0
      }
    };
  } catch {
    return null;
  }
}
