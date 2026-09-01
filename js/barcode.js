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

/**
 * Open Food Facts の応答(JSONをパースしたオブジェクト)を、このアプリの食品オブジェクトへ
 * 変換する純関数。fetch を含む lookupJan から切り出してある。
 *
 * 【なぜ切り出したか】この変換はネットワークとは無関係な純粋なロジックだが、
 * 以前は fetch の中に埋まっていたためテストできなかった。
 * ここは「外部サービスから来た信頼できない構造」を解釈する場所で、
 * 判断を1つ間違えるとカロリー(死守2項目の一方)が静かにずれる。
 * テストできない場所に置いてよいロジックではない。
 *
 * 変換できなければ null を返す(呼び出し側は「見つからなかった」として扱う)。
 */
export function offProductToFood(data, jan) {
  if (data?.status !== 1 || !data.product) return null;

  // 1食分の数値が両方揃っている場合だけ「1個」として扱う。
  // 揃っていない場合に100gあたりの数値を1個分として保存すると、
  // カロリー(死守2項目の一方)が静かにずれるため、その場合は
  // 100gあたりの数値と分かるよう unit と名前の両方に明記する。
  // 【undefined だけを「無い」とみなしてはならない】
  // 以前は `!== undefined` で分岐していたが、OFF は値が無いフィールドに null を
  // 返すことがある。null は undefined ではないので serving 側の分岐に入り、
  // その後 Number(null) === 0 が有限数として通り、**0kcalの食品として登録される**。
  // 数値として読めないものは全て「無い」に寄せる。
  // 空文字と非数値文字列も同様(OFFは文字列で数値を返す場合があるため、
  // 数値に変換できる文字列は受け入れる)。
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const n = data.product.nutriments ?? {};
  const kcalServing = num(n['energy-kcal_serving']);
  const proteinServing = num(n.proteins_serving);
  const kcal100 = num(n['energy-kcal_100g']);
  const protein100 = num(n.proteins_100g);

  let kcal, protein, unit;
  if (kcalServing !== null && proteinServing !== null) {
    kcal = kcalServing;
    protein = proteinServing;
    unit = '個';
  } else if (kcal100 !== null && protein100 !== null) {
    kcal = kcal100;
    protein = protein100;
    unit = '100g';
  } else {
    return null;
  }

  // 負値は明らかに壊れたデータ。0kcalの食品として登録するより
  // 「見つからなかった」として扱う方がよい(0kcalの記録が静かに増える害の方が大きい)。
  if (kcal < 0 || protein < 0) return null;

  // OFF に品名が無い商品を「商品 <JAN>」のまま登録すると、ワンタップ一覧に
  // 判読できないボタンが並んでしまい、このタブの存在意義(よく食べるものが
  // 1タップで届く)を損なう。栄養値はOFFのものをそのまま使い、名前だけ後で尋ねる。
  //
  // 【通信層はUIを出さない】以前はここで prompt() を出して品名を尋ねていた。
  // このモジュールは fetch を担当する層であり、画面を持つべきではない。
  // prompt() はボタン寸法をアプリが制御できず、汗ばんだ手で立ったまま文字を
  // 打たせることになる(R4.1.4)。「名前が無い」という事実だけを返し、
  // どう尋ねるかは UI層(js/mealTab.js)が決める。
  let name = data.product.product_name_ja || data.product.product_name || '';
  const nameMissing = !name;
  if (unit === '100g' && name) name = `${name}（100gあたり）`;

  return {
    source: 'openfoodfacts',
    food: {
      id: `jan_${jan}`,
      jan,
      name,
      nameMissing,
      unit,
      kcal: Math.round(kcal),
      protein: Math.round(protein * 10) / 10,
      useCount: 0
    }
  };
}

/** ローカルのマイメニューを先に見る。無ければ Open Food Facts に問い合わせる */
export async function lookupJan(jan, foods, useOpenFoodFacts) {
  const local = foods.find((f) => f.jan === jan);
  if (local) return { source: 'local', food: local };
  if (!useOpenFoodFacts) return null;

  try {
    const res = await fetch(`${OFF_ENDPOINT}${encodeURIComponent(jan)}.json?fields=product_name,product_name_ja,nutriments`);
    if (!res.ok) return null;
    return offProductToFood(await res.json(), jan);
  } catch {
    return null;
  }
}
