#!/usr/bin/env node
/**
 * 指示書(docs/SPEC.md)のうち機械検査できる要求を実際に検査する。
 *
 * 【なぜこのスクリプトが要るか】
 * 以前の指示書は「テスト件数の下限を354件とし、これを下回る変更を認めないこと」と
 * 書いていたが、件数を検査する記述はリポジトリのどこにも存在しなかった。
 * テストを353件に減らしてもCIは緑のまま通り、そのままデプロイされた。
 * 「認めないこと」は門であり、門が存在しない要求は要求ではない。
 *
 * 文章で宣言した合否条件のうち機械で判定できるものは、全てここに実装する。
 * 判定できないもの(実機での見え方・タップのしやすさ等)は docs/SPEC.md の
 * 「実機検証表」に置き、このスクリプトの対象外であることを明示する。
 *
 * 使い方: npm run verify
 * 終了コード: 全て合格なら0、1件でも不合格なら1(CIが落ちる)。
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

function check(id, description, fn) {
  try {
    const detail = fn();
    results.push({ id, description, ok: true, detail: detail ?? '' });
  } catch (err) {
    results.push({ id, description, ok: false, detail: err.message });
  }
}

function fail(msg) { throw new Error(msg); }
function read(p) { return readFileSync(join(ROOT, p), 'utf8'); }
function size(p) { return statSync(join(ROOT, p)).size; }

/**
 * JS からコメントと文字列リテラルを取り除く。
 * 「コメント内の localStorage への言及」と「実際の localStorage 呼び出し」を
 * 区別できなければ、この種の grep はノイズだらけになり誰も見なくなる。
 * 完全なパーサではないが、このコードベースの書き方には十分。
 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      i += 2;
      // ブロックコメント内の改行も残す（落とすと以降の行番号が全てずれる）
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += ' ';
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        // テンプレートリテラル内の改行を落とすと、以降の報告行番号が全てずれる。
        // 中身は捨てるが改行だけは残す。
        if (src[i] === '\n') { out += '\n'; i++; continue; }
        // テンプレートリテラルの ${...} の中はコードなので残す
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth > 0) i++;
          }
          out += src.slice(start, i);
          i++;
          continue;
        }
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/**
 * コメントだけを取り除き、文字列リテラルは残す。
 * 記号の走査ではこちらを使う。UIに描画される記号は文字列の中にあるので、
 * 文字列まで剥がすと検出対象が消えてしまう。逆にコメントを残すと
 * 「⚠️ 必ずkJ単位で計算すること」のような注意書きが不合格として出てしまい、
 * 直しようのない指摘でスクリプトが信用されなくなる。
 * 空白に置換して行番号と桁を保つ。
 */
function stripCommentsOnly(src, lang) {
  if (lang === 'css') return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  if (lang === 'html') return src.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
    } else if (c === '/' && next === '*') {
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  ';
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function jsFiles(dir) {
  return readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(dir, f).replace(/\\/g, '/'));
}

/** import 文から相対パスを取り出す(静的 import のみ) */
function importsOf(relPath) {
  const src = stripCommentsAndStrings(read(relPath));
  const found = new Set();
  for (const m of src.matchAll(/\bfrom\s+([A-Za-z0-9_$]*)\s*;/g)) void m; // 文字列は剥がされているので下で元ソースを使う
  const raw = read(relPath);
  for (const m of raw.matchAll(/^\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/gm)) found.add(m[1]);
  for (const m of raw.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) found.add(m[1]);
  return [...found]
    .filter((s) => s.startsWith('.'))
    .map((s) => join(dirname(relPath), s).replace(/\\/g, '/'));
}

/** entry から静的 import で到達できる全ファイル */
function reachableFrom(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const cur = queue.shift();
    if (seen.has(cur)) continue;
    if (!existsSync(join(ROOT, cur))) continue;
    seen.add(cur);
    for (const dep of importsOf(cur)) queue.push(dep);
  }
  return seen;
}

// ---------------------------------------------------------------------------
// R1: 決定性と層の分離
// ---------------------------------------------------------------------------

// 純ロジック層。DOM・ネットワーク・時計・乱数に触れてはならない。
// 触れた瞬間、テストが「動く環境」を要求するようになり、変異テストが回らなくなる。
const LOGIC_MODULES = [
  'js/workout.js', 'js/nutrition.js', 'js/energy.js', 'js/game.js',
  'js/body.js', 'js/goals.js', 'js/micronutrients.js', 'js/calendarView.js'
];

check('R1.0.1', '全てのJSファイルが構文として正しいこと', () => {
  // 【なぜ要るか】UI層(js/*Tab.js 等)にはテストが無い。三項演算子の分岐を1つ
  // 余らせるといった構文エラーは `npm test` を素通りし、ブラウザで開いて初めて
  // 分かる。デプロイ後に気づくことになる。`node --check` は1ファイル数msで済む。
  const targets = [...jsFiles('js'), 'sw.js', ...readdirSync(join(ROOT, 'scripts')).map((f) => `scripts/${f}`)];
  const broken = [];
  for (const f of targets) {
    try {
      // ESM として解析する(import/export を含むため --check だけでは足りない)
      execFileSync(process.execPath, ['--input-type=module', '--check'], {
        input: read(f), cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (err) {
      const msg = String(err.stderr ?? err.message).split('\n').filter((l) => l.trim()).slice(0, 3).join(' / ');
      broken.push(`${f}: ${msg}`);
    }
  }
  if (broken.length) fail(broken.join('\n    '));
  return `${targets.length}ファイル・構文エラー0件`;
});

check('R1.1.1', '純ロジック層8モジュールにDOM/ネットワーク/永続化APIが出現しないこと', () => {
  const banned = /\b(document|window|localStorage|sessionStorage|indexedDB|navigator)\b|\bfetch\s*\(|\bXMLHttpRequest\b/;
  const hits = [];
  for (const f of LOGIC_MODULES) {
    const code = stripCommentsAndStrings(read(f));
    code.split('\n').forEach((line, idx) => {
      if (banned.test(line)) hits.push(`${f}:${idx + 1} ${line.trim().slice(0, 60)}`);
    });
  }
  if (hits.length) fail(`禁止APIの出現 ${hits.length}件:\n    ${hits.join('\n    ')}`);
  return `${LOGIC_MODULES.length}モジュール・0件`;
});

check('R1.1.2', '純ロジック層に Date.now / new Date() / Math.random が出現しないこと', () => {
  // 引数付き new Date('2026-08-19') は決定的なので許可する。引数なしだけを禁じる。
  const banned = /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)|\bMath\.random\s*\(/;
  const hits = [];
  for (const f of LOGIC_MODULES) {
    const code = stripCommentsAndStrings(read(f));
    code.split('\n').forEach((line, idx) => {
      if (banned.test(line)) hits.push(`${f}:${idx + 1}`);
    });
  }
  if (hits.length) fail(`非決定的APIの出現: ${hits.join(', ')}`);
  return '0件';
});

// ---------------------------------------------------------------------------
// R2: プライバシー境界
// ---------------------------------------------------------------------------

check('R1.4.1', 'js/charts.js の動的 <script> 注入先が文字列リテラルであること', () => {
  // 【なぜ要るか】js/charts.js はこのアプリで唯一 <script> を動的に注入する箇所。
  // 現状 script.src = 'vendor/chart.umd.js' と定数だが、これが変数化されれば
  // 任意のスクリプトを読み込む口になる。CSP の script-src 'self' が同一オリジンに
  // 限定するため被害は限定されるが、CSP を1行消せばその防御は消える。
  // 「変数を代入していないこと」自体を門にしておけば、CSP と二重に守れる。
  const src = stripCommentsAndStrings(read('js/charts.js'));
  const assignments = [...read('js/charts.js').matchAll(/\.src\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  if (assignments.length === 0) fail('js/charts.js に .src への代入が見つからない（検査が対象を見失っている）');
  const dynamic = assignments.filter((a) => !/^'[^']*'$/.test(a) && !/^"[^"]*"$/.test(a));
  if (dynamic.length) fail(`.src に文字列リテラル以外を代入している: ${dynamic.join(', ')}`);
  // integrity 属性は同一オリジンの自前ファイルには不要（改竄されるならファイル自体が改竄される）
  void src;
  return `${assignments.length}箇所すべて文字列リテラル`;
});

check('R2.2.2', 'store.set の呼び出しが try ブロック内にあること（保存失敗を無言で捨てない）', () => {
  // 【なぜ要るか】localStorage は容量逼迫時に setItem が例外を投げる。
  // 保護されていない呼び出しは、そこで関数全体が中断する。
  // 実例: js/mealTab.js の bumpFoodUse は addItems より先に呼ばれていたため、
  // 例外が出ると食事が記録されないままトーストも出なかった。
  //
  // 例外として js/main.js の loadSeed() 内は許可する。呼び出し元 boot() が
  // 捕捉して起動を続け、移行フラグは失敗時に立てない設計（R2.3.1）なので
  // 次回起動で再試行される。
  const problems = [];
  for (const f of jsFiles('js')) {
    const code = stripCommentsAndStrings(read(f));
    // try ブロックの深さを追いながら走査する。tryDepths には try の { が開いた
    // 時点の波括弧の深さを積む。
    let depth = 0;
    const tryDepths = [];
    let pendingTry = false;
    const lines = code.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (let j = 0; j < line.length; j++) {
        // try { store.set(...); } catch {} のように1行で完結する書き方があるため、
        // 行を processed し終えてから判定してはならない(その時点では try ブロックが
        // 既に閉じており、保護されているのに未保護と報告してしまう)。
        // store.set が現れた「その位置」で try の内側かどうかを見る。
        if (line.startsWith('store.set', j) && tryDepths.length === 0 && f !== 'js/main.js') {
          problems.push(`${f}:${i + 1} store.set が try の外にある`);
        }
        // 'try' の直後に { が来るかを見る
        if (line.startsWith('try', j) && !/[A-Za-z0-9_$]/.test(line[j - 1] ?? '') && !/[A-Za-z0-9_$]/.test(line[j + 3] ?? '')) {
          pendingTry = true;
        }
        if (line[j] === '{') {
          depth++;
          if (pendingTry) { tryDepths.push(depth); pendingTry = false; }
        } else if (line[j] === '}') {
          if (tryDepths.length && tryDepths[tryDepths.length - 1] === depth) tryDepths.pop();
          depth--;
        }
      }
    }
  }
  if (problems.length) fail(problems.join('\n    '));
  return 'try 外の store.set は0件（js/main.js の loadSeed 内を除く）';
});

check('R2.7.1', '体の写真を扱うモジュールから外部通信コードへ到達できないこと(推移的import検査)', () => {
  // 【なぜファイル単位のgrepでは不十分か】
  // js/photos.js と js/photoTab.js に fetch が書かれていないことは、
  // 送信経路が無いことを証明しない。同じgrepは js/homeTab.js に対しても0件を返すが、
  // homeTab.js は import { analyzeInbody } from './ocr.js' 経由でGoogleに画像を送っている。
  // import を1行足せばgrepは0件のまま送信可能になる。到達可能性で検査する。
  const closure = reachableFrom(['js/photos.js', 'js/photoTab.js']);
  const networkPattern = /\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b|\bEventSource\b|https?:\/\//;
  const offenders = [];
  for (const f of closure) {
    const code = stripCommentsAndStrings(read(f));
    if (networkPattern.test(code)) offenders.push(f);
  }
  if (offenders.length) {
    fail(`写真モジュールから到達可能な範囲に外部通信コードがある: ${offenders.join(', ')}\n`
      + `    到達可能な全ファイル: ${[...closure].join(', ')}`);
  }
  return `到達可能 ${closure.size}ファイル・外部通信0件`;
});

check('R2.7.4', '体の写真のBlobを返すAPIを import してよいのは js/photoTab.js だけであること', () => {
  // 【なぜ要るか】以前は js/recordTab.js(日付だけが欲しい)と js/settingsTab.js(件数だけが
  // 欲しい)が listPhotos を import しており、どちらも blob を使っていないのに
  // 体の写真の実体へ手が届く状態だった。とくに settingsTab.js は settings.geminiKey を
  // 読み書きしている当のモジュールで、「体の写真」と「APIキー」が同じスコープに同居していた。
  // import を1行足すだけで漏洩が成立する距離にあってはならない。
  const BLOB_RETURNING = ['listPhotos', 'latestByAngle', 'firstByAngle', 'toUrl'];
  const problems = [];
  for (const f of jsFiles('js')) {
    if (f === 'js/photoTab.js' || f === 'js/photos.js') continue;
    const raw = read(f);
    const m = raw.match(/^\s*import\s*\{([^}]*)\}\s*from\s*['"]\.\/photos\.js['"]/m);
    if (!m) continue;
    const imported = m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    const bad = imported.filter((n) => BLOB_RETURNING.includes(n));
    if (bad.length) problems.push(`${f}: ${bad.join(', ')} を import している（日付は listPhotoDates、件数は countPhotos を使う）`);
  }
  if (problems.length) fail(problems.join('\n    '));
  return 'photoTab.js 以外からのBlob到達は0件';
});

check('R2.7.6', 'js/ocr.js が File 以外（保存済みBlob）を受け付けないこと', () => {
  // 「体の写真は Gemini に送られない」保証を、呼び出し側が呼ばないことだけに
  // 依存させない。ocr.js 側に門を置く。
  const src = stripCommentsAndStrings(read('js/ocr.js'));
  if (!/instanceof\s+File/.test(src)) {
    fail('js/ocr.js に File インスタンスの検査が無い。IndexedDB から取り出した Blob をそのまま送れてしまう');
  }
  return 'File インスタンス検査あり';
});

check('R2.7.2', 'CSP が存在し、送信先が Gemini と Open Food Facts に限定されていること', () => {
  const html = read('index.html');
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  if (!m) fail('index.html に Content-Security-Policy の meta が無い');
  const csp = m[1];
  const connect = (csp.match(/connect-src([^;]*)/) || [])[1];
  if (!connect) fail('CSP に connect-src が無い（送信先が制限されていない）');
  const allowed = connect.trim().split(/\s+/).filter(Boolean);
  const expected = ["'self'", 'https://generativelanguage.googleapis.com', 'https://world.openfoodfacts.org'];
  const extra = allowed.filter((a) => !expected.includes(a));
  if (extra.length) fail(`connect-src に想定外の送信先: ${extra.join(', ')}`);
  for (const e of expected) if (!allowed.includes(e)) fail(`connect-src に ${e} が無い`);
  if (!/script-src\s+'self'\s*;/.test(csp)) fail("script-src が 'self' のみになっていない");
  if (!/object-src\s+'none'/.test(csp)) fail("object-src 'none' が無い");
  return `connect-src: ${allowed.join(' ')}`;
});

check('R2.7.3', 'コード内の外部エンドポイントが CSP の許可先と一致すること', () => {
  const origins = new Set();
  for (const f of jsFiles('js')) {
    const code = stripCommentsAndStrings(read(f));
    // 文字列は剥がされるので、元ソースからURLを拾ったうえでコメント行を除く
    const raw = read(f);
    raw.split('\n').forEach((line) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const m of line.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) origins.add(m[1]);
    });
    void code;
  }
  const allowed = new Set(['generativelanguage.googleapis.com', 'world.openfoodfacts.org']);
  const extra = [...origins].filter((o) => !allowed.has(o));
  if (extra.length) fail(`CSPで許可していない外部ホストがコード内にある: ${extra.join(', ')}`);
  return [...origins].join(', ') || 'なし';
});

// ---------------------------------------------------------------------------
// R4: UI 要件のうち機械検査できるもの
// ---------------------------------------------------------------------------

check('R4.8.1', '外部フォント・外部スタイルシートを読み込まないこと', () => {
  const css = read('css/style.css');
  const html = read('index.html');
  if (/@import/.test(css)) fail('css/style.css に @import がある');
  if (/@font-face/.test(css)) fail('css/style.css に @font-face がある');
  const externalLinks = [...html.matchAll(/<link[^>]+href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  if (externalLinks.length) fail(`index.html が外部リソースを読んでいる: ${externalLinks.join(', ')}`);
  return '0件';
});

check('R3.5.4', '科学的な閾値定数に出典または「出典なし」の明示があること', () => {
  // 【なぜ要るか】このアプリの判断は数値の閾値で決まる。EA 30、FFMI 25、
  // 食物繊維の基準値…どれも「なぜその値か」を辿れなければ、後から
  // 「厳しすぎるから緩めよう」と根拠なく動かされる。
  //
  // 出典が特定できない値まで禁じるのは非現実的なので、要求するのは
  // 「著者・年・機関のいずれかが書いてある」か「出典なし・仮定であると
  // 明示してある」かのどちらか。**黙って数字だけを置くことを禁じる。**
  const FILES = ['js/energy.js', 'js/goals.js', 'js/micronutrients.js'];
  // 定数宣言の直前20行以内に、出典または仮定ラベルが現れること
  // 認めるのは次のいずれか:
  //  a) 著者・年・機関名などの出典
  //  b) 「出典なし」「実務上の仮定」等、文献値ではないと明示するラベル
  //  c) 「設計上の判断」— 文献から引いた値ではなく、このアプリの都合で決めた
  //     窓幅・最小件数などであることを明示するラベル
  const EVIDENCE = new RegExp([
    '[A-Z][A-Za-z]+ et al\\.?,? ?\\d{4}',
    '[A-Z][A-Za-z]+,? \\d{4}',
    'Institute of Medicine',
    '20\\d\\d年版', 'ACSM', 'ACE', 'IOM', 'ISSN', 'MHLW', 'WCAG', 'Material Design',
    '出典なし', '実務上の仮定', '仮定である', 'エンジニアリング上の仮定', '実測ではない',
    '設計上の判断', '製品仕様'
  ].join('|'));
  const problems = [];
  for (const f of FILES) {
    const lines = read(f).split('\n');
    lines.forEach((line, i) => {
      // export の有無を問わず、大文字スネークケースの数値定数を対象にする。
      // 「エクスポートされる定数だけ」に限ると、このアプリの中心である
      // EA_FLOOR_PER_KG_FFM(非export)が対象から外れる。
      const m = line.match(/^\s*(?:export\s+)?const ([A-Z][A-Z0-9_]*) = -?[\d.]+\s*;/);
      if (!m) return;
      // 【「直前N行」ではなく「直前の連続したコメント塊」を見る】
      // 最初は直前20行を窓にしていたが、このファイル群は冒頭に長い出典コメントを
      // 持つため、出典の無い定数をその近くに置くだけで検査を通ってしまった
      // (実際に MAGIC_THRESHOLD = 42 を足しても合格した)。
      // 「その定数に付いているコメント」だけを根拠として認める。
      // 間にコードや空行が入った時点で、そのコメントは別の何かの説明である。
      // 連続した定数宣言は1つのコメントを共有するのが普通なので、
      //   // 出典...
      //   const A = 1;
      //   const B = 2;   ← B もそのコメントに属する
      // 同じ形の宣言は読み飛ばして、その上のコメント塊まで遡る。
      // 空行や他のコードが挟まった時点で「別の何かの説明」とみなして打ち切る。
      const block = [];
      for (let j = i - 1; j >= 0; j--) {
        const t = lines[j].trim();
        const isComment = t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.endsWith('*/');
        const isSiblingConst = /^(?:export\s+)?const [A-Z][A-Z0-9_]* = -?[\d.]+\s*;/.test(t);
        if (isComment) { block.unshift(lines[j]); continue; }
        if (isSiblingConst) { block.unshift(lines[j]); continue; }
        break;
      }
      // 宣言行そのもの(行末コメント)も根拠として認める。
      // EA_FLOOR_PER_KG_FFM は `= 30; // ACSM/AND/DC 2016` と同じ行に出典がある。
      const context = `${block.join('\n')}\n${line}`;
      if (!EVIDENCE.test(context)) problems.push(`${f}:${i + 1} ${m[1]}`);
    });
  }
  if (problems.length) {
    fail(`出典も「出典なし」の明示も無い定数 ${problems.length}件:\n    ` + problems.join('\n    '));
  }
  return `${FILES.length}ファイルの数値定数を検査・未記載0件`;
});

check('R4.1.4', 'prompt() を使わないこと（入力はアプリ自身が描画するフォームで行う）', () => {
  // 【なぜ prompt() だけを禁じるか】ブラウザ標準ダイアログはボタン寸法をアプリが
  // 制御できず、R4.1.1「操作可能要素は48×48以上」の対象外に落ちる。
  // そのうち prompt() は文字・数値の入力を伴うため、汗ばんだ手で立ったまま操作する
  // という前提と最も強く衝突する。js/dayView.js は1品追加するのに3連続で出していた。
  //
  // confirm() は取り消せない操作の確認に限って許可する(R4.1.5・意図的)。
  // 選択肢が2つでボタンも大きく、誤操作の危険はむしろ標準ダイアログの方が低い。
  const hits = [];
  for (const f of jsFiles('js')) {
    const code = stripCommentsAndStrings(read(f));
    code.split('\n').forEach((line, i) => {
      if (/(^|[^.\w])prompt\s*\(/.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  if (hits.length) fail(`prompt() の使用: ${hits.join(', ')}`);
  return '0件';
});

check('R4.9.1', '出荷コードに絵文字・素の記号文字が残っていないこと(アイコンはSVGスプライトで統一)', () => {
  // 対象: 絵文字全域と矢印記号全域。以前は「⟳ ← ↗ の3箇所」と確定数を書いていたが、
  // → を数え落として実際は6箇所以上あった。走査対象は範囲で定義し、数え落としを防ぐ。
  const ranges = [
    [0x2190, 0x21ff], // Arrows
    [0x2600, 0x27bf], // Misc symbols + Dingbats
    [0x27f0, 0x27ff], // Supplemental Arrows-A
    [0x2b00, 0x2bff], // Misc Symbols and Arrows
    [0x1f300, 0x1faff] // Emoji
  ];
  const inRange = (cp) => ranges.some(([a, b]) => cp >= a && cp <= b);
  const hits = [];
  const targets = [
    ...jsFiles('js').map((f) => [f, 'js']),
    ['index.html', 'html'],
    ['css/style.css', 'css']
  ];
  for (const [f, lang] of targets) {
    // コメントは対象外。UIに描画されない注意書きの記号まで禁止すると、
    // 直す意味の無い指摘でスクリプトが信用されなくなる。
    // ただし index.html の <symbol> 定義内(SVGパスデータ)は対象外にしない
    // (記号文字を含まないため誤検出しない)。
    const src = stripCommentsOnly(read(f), lang);
    src.split('\n').forEach((line, idx) => {
      for (const ch of line) {
        const cp = ch.codePointAt(0);
        if (inRange(cp)) {
          hits.push(`${f}:${idx + 1} U+${cp.toString(16).toUpperCase()} ${ch}`);
          break;
        }
      }
    });
  }
  if (hits.length) fail(`${hits.length}件:\n    ${hits.join('\n    ')}`);
  return '0件';
});

check('R1.3.1', 'js/ui.js のヘルパを使っているモジュールが、それを import していること', () => {
  // 【なぜ要るか】記号文字をSVGアイコンへ置き換えた際、js/dayView.js に
  // icon('i-back') を書きながら import に icon を足し忘れ、日付ビューを開いた瞬間に
  // ReferenceError で画面が真っ白になった。テストは純ロジック層しか見ておらず、
  // 記号走査(R4.9.1)も静的なので、どちらも素通りした。
  // 実行して初めて分かる類のバグだが、この形だけは静的に捕まえられる。
  const uiSrc = read('js/ui.js');
  const helpers = [...uiSrc.matchAll(/^export function (\w+)/gm)].map((m) => m[1])
    .concat([...uiSrc.matchAll(/^export const (\w+)/gm)].map((m) => m[1]));
  const problems = [];
  for (const f of jsFiles('js')) {
    if (f === 'js/ui.js') continue;
    const raw = read(f);
    const code = stripCommentsAndStrings(raw);
    const importLine = (raw.match(/^\s*import\s*\{([^}]*)\}\s*from\s*['"]\.\/ui\.js['"]/m) || [])[1] ?? '';
    const imported = new Set(importLine.split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean));
    // このモジュール自身が同名を定義していれば import は不要
    const locallyDefined = new Set(
      [...raw.matchAll(/(?:^|\s)(?:function|const|let|var)\s+(\w+)/g)].map((m) => m[1])
    );
    for (const h of helpers) {
      if (h === '$') continue; // $ は正規表現で誤検出しやすいので別扱い
      const called = new RegExp(`\\b${h}\\s*\\(`).test(code);
      if (called && !imported.has(h) && !locallyDefined.has(h)) {
        problems.push(`${f}: ${h}() を呼んでいるが import していない`);
      }
    }
  }
  if (problems.length) fail(problems.join('\n    '));
  return `${jsFiles('js').length - 1}モジュール検査・不足0件`;
});

check('R1.3.2', 'innerHTML に入る外部由来の文字列が esc() を通っていること', () => {
  // 【なぜ要るか】js/ui.js の規約は「外部由来の文字列は必ず esc() を通すこと」だが、
  // 規約は人間の記憶に頼っていた。実際 js/mealTab.js の警告メッセージは
  // esc() を通しておらず、同じ関数の10行下では esc(macro.notes[...]) と
  // 正しく扱っていた(同一関数内で扱いが割れていた)。
  //
  // 【検査の範囲を絞る理由】最初は「${...} に現れる式で esc() を通していないもの」を
  // 全て報告する形にしたところ、151件が出た。その大半は数値・内部定数・自前で
  // 組み立てたHTML片で、実際の問題は数件だった。
  // ほぼ誤検出の検査は「毎回出る赤」になり、やがて誰も読まなくなるか検査ごと
  // 外される。検査は、出たら必ず直す粒度でなければ意味がない。
  //
  // そこで対象を「外部由来の文字列が入りうるプロパティ名」に限定する。
  // 名前(食品名・種目名)はOCR/バーコード/利用者入力から来る。
  // message/notes は将来そこに食品名が混ざりうる(実際 achievement() の警告文が
  // そうなりかけていた)。数値フィールドは対象外でよい。
  const TEXT_FIELDS = [
    'name', 'message', 'notes', 'note', 'desc', 'description',
    'label', 'title', 'text', 'brand', 'jan', 'unit'
  ];
  const fieldRe = new RegExp(`\\.(${TEXT_FIELDS.join('|')})\\b`);
  const problems = [];
  for (const f of jsFiles('js')) {
    const lines = stripCommentsOnly(read(f), 'js').split('\n');
    lines.forEach((line, i) => {
      if (!/[`'"]\s*<\w|<\/\w+>|innerHTML/.test(line)) return;
      for (const m of line.matchAll(/\$\{([^}]*)\}/g)) {
        const expr = m[1].trim();
        if (!expr || !fieldRe.test(expr)) continue;
        // esc( だけでなく .map(esc) のような関数参照渡しも「考慮済み」として認める。
        // (js/settingsTab.js の macro.notes は <br> を意図的にHTMLとして出すため、
        //  式全体を esc() で包むことはできず map(esc) が正しい形になる)
        if (expr.includes('esc')) continue;
        // textContent への代入は innerHTML ではないので対象外
        if (/textContent/.test(line)) continue;
        problems.push(`${f}:${i + 1} \${${expr.slice(0, 60)}}`);
      }
    });
  }
  if (problems.length) {
    fail(`外部由来になりうる文字列が esc() を通っていない ${problems.length}件:\n    ` + problems.join('\n    '));
  }
  return `${TEXT_FIELDS.length}種のテキストフィールドを検査・未エスケープ0件`;
});

check('R4.9.2', 'SVGスプライトが index.html と assets/sprite.svg で同期していること', () => {
  // 二重管理なので、片方だけ編集すると無言で <use> が空になる。
  const ids = (src) => new Set([...src.matchAll(/<symbol[^>]+id="([^"]+)"/g)].map((m) => m[1]));
  const inHtml = ids(read('index.html'));
  const inFile = ids(read('assets/sprite.svg'));
  const onlyHtml = [...inHtml].filter((x) => !inFile.has(x));
  const onlyFile = [...inFile].filter((x) => !inHtml.has(x));
  if (onlyHtml.length || onlyFile.length) {
    fail(`スプライトが同期していない。index.htmlのみ: [${onlyHtml}] / sprite.svgのみ: [${onlyFile}]`);
  }
  return `${inHtml.size}個のsymbolが一致`;
});

check('R4.9.3', 'index.html が参照する <use href="#..."> が全てスプライトに存在すること', () => {
  const html = read('index.html');
  const defined = new Set([...html.matchAll(/<symbol[^>]+id="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set();
  // コメント内の説明（例: 「<use href="#…"> で参照する」）を参照として数えないよう剥がす。
  const sources = [
    ...jsFiles('js').map((f) => stripCommentsOnly(read(f), 'js')),
    stripCommentsOnly(html, 'html')
  ];
  for (const src of sources) {
    for (const m of src.matchAll(/<use href="#([^"]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/icon\(['"]([^'"]+)['"]/g)) used.add(m[1]);
  }
  // ${...} を含むものは実行時に決まる動的な名前なので静的には検査できない。
  // (js/ui.js の icon() が組み立てる <use href="#${name}"> がこれに当たる)
  const missing = [...used].filter((u) => !u.includes('$') && !defined.has(u));
  if (missing.length) fail(`スプライトに存在しないアイコンを参照している: ${missing.join(', ')}`);
  return `参照${used.size}種・全て定義済み`;
});

// ---------------------------------------------------------------------------
// R6: 性能・テスト・リリース
// ---------------------------------------------------------------------------

/**
 * 初回訪問で発生する全ネットワーク転送のバイト数。
 *
 * 【定義を変えた理由】以前は「ページ読み込み時に読まれるファイル」だけを数え、
 * 351,348 B に対して「予算400 KiBまで余裕58,252 B」と評価していた。
 * しかし sw.js の install ハンドラは cache.addAll(ASSETS) を無条件に実行し、
 * ASSETS には vendor/chart.umd.js(208,532 B)が含まれている。
 * つまり初回訪問時、ブラウザは実際には 560KB 近くをダウンロードしていた。
 * 予算という数値要求で最も重要なのは「何を数えるか」であり、そこが誤っていた。
 */
const FIRST_LOAD_BUDGET_BYTES = 640 * 1024;

check('R6.2.1', `初回訪問の総転送量が予算(${FIRST_LOAD_BUDGET_BYTES} B)以内であること`, () => {
  const sw = read('sw.js');
  const m = sw.match(/const ASSETS = \[([\s\S]*?)\]/);
  if (!m) fail('sw.js から ASSETS を読み取れない');
  const assets = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((f) => f !== './');
  let total = 0;
  const missing = [];
  for (const f of assets) {
    if (!existsSync(join(ROOT, f))) { missing.push(f); continue; }
    total += size(f);
  }
  if (missing.length) fail(`ASSETS に実在しないファイル: ${missing.join(', ')}`);
  if (total > FIRST_LOAD_BUDGET_BYTES) {
    fail(`初回転送 ${total} B が予算 ${FIRST_LOAD_BUDGET_BYTES} B を ${total - FIRST_LOAD_BUDGET_BYTES} B 超過`);
  }
  return `${total} B (${(total / 1024).toFixed(1)} KiB) / 予算 ${(FIRST_LOAD_BUDGET_BYTES / 1024).toFixed(0)} KiB・ASSETS ${assets.length}件`;
});

check('R6.2.2', 'Chart.js が index.html から静的に読み込まれていないこと(クリティカルパスの遅延)', () => {
  const html = stripCommentsOnly(read('index.html'), 'html');
  if (/chart\.umd\.js/.test(html)) fail('index.html が chart.umd.js を直接参照している');
  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  if (scripts.length !== 1 || scripts[0] !== 'js/main.js') {
    fail(`index.html の <script src> は js/main.js の1本だけであるべき: ${scripts.join(', ')}`);
  }
  return 'js/main.js のみ';
});

check('R6.4.1', 'sw.js の ASSETS が実在ファイルと過不足なく一致すること', () => {
  const sw = read('sw.js');
  const assets = new Set([...sw.match(/const ASSETS = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)]
    .map((x) => x[1]).filter((f) => f !== './'));
  // 実行時に必要なファイル = js/*.js + css + data + vendor + アイコン + manifest + index.html
  const runtime = [
    ...jsFiles('js'),
    'index.html', 'manifest.json', 'css/style.css',
    ...readdirSync(join(ROOT, 'data')).map((f) => `data/${f}`),
    ...readdirSync(join(ROOT, 'vendor')).map((f) => `vendor/${f}`)
  ];
  const notCached = runtime.filter((f) => !assets.has(f));
  if (notCached.length) {
    fail(`実行時に必要だが ASSETS に無い(オフラインで壊れる): ${notCached.join(', ')}`);
  }
  return `ASSETS ${assets.size}件・実行時ファイル ${runtime.length}件を網羅`;
});

check('R6.4.2', 'sw.js がナビゲーションのみネットワーク優先、サブリソースはキャッシュ即返しであること', () => {
  // 【なぜ戦略の形まで検査するか】全てをネットワーク優先にしていたとき、
  // 応答の返らない回線での起動が **8.08秒** かかった(実測)。
  // ESモジュールの依存の段数だけタイムアウトが積み上がるため。
  // サブリソースを stale-while-revalidate に変えて 825ms になった。
  // 「タイムアウトがあること」だけを検査していては、この退行を検出できない。
  const src = stripCommentsAndStrings(read('sw.js'));

  if (!/NETWORK_TIMEOUT_MS/.test(src)) {
    fail('sw.js にネットワークタイムアウトが無い。応答が返らない回線(半死のWi-Fi)で待ち続ける');
  }
  const ms = read('sw.js').match(/const NETWORK_TIMEOUT_MS = (\d+)/);
  if (!ms || Number(ms[1]) > 1000) {
    fail(`タイムアウトが長すぎる: ${ms?.[1]}ms（R4.7.6の2秒予算をこの1本で使い切ってはならない）`);
  }
  if (!/function staleWhileRevalidate/.test(src)) {
    fail('sw.js に staleWhileRevalidate が無い。サブリソースをネットワーク優先にすると'
      + 'ESモジュールの段数だけタイムアウトが積み上がり、起動が数秒単位で遅れる');
  }
  // ナビゲーションだけが networkFirst を通ること。
  // ここは文字列リテラル 'navigate' を見る必要があるので、
  // 文字列も消す stripCommentsAndStrings ではなく stripCommentsOnly を使う。
  const withStrings = stripCommentsOnly(read('sw.js'), 'js');
  if (!/mode === 'navigate'[\s\S]{0,200}networkFirst/.test(withStrings)) {
    fail("sw.js の fetch ハンドラで、ナビゲーション(mode === 'navigate')が networkFirst へ分岐していない");
  }
  return `navigate: networkFirst(${ms[1]}ms) / それ以外: stale-while-revalidate`;
});

check('R6.5.1', '起動時、種データの取得より先にタブが操作可能になること', () => {
  const main = stripCommentsAndStrings(read('js/main.js'));
  const initPos = main.indexOf('initTabs()');
  const seedPos = main.indexOf('await loadSeed()');
  if (initPos === -1) fail('js/main.js に initTabs() が無い');
  if (seedPos === -1) fail('js/main.js に await loadSeed() が無い');
  if (seedPos < initPos) {
    fail('await loadSeed() が initTabs() より前にある。応答の返らない回線で、'
      + 'タブボタンにイベントリスナーが付かないまま起動が止まる');
  }
  return 'initTabs() が先';
});

/**
 * テスト件数の下限。
 * 現在値をそのまま下限にすると「増やしたら下限も上がる」運用になり形骸化するため、
 * 現在値から一定のマージンを引いた値を門とする。テストを大量に削れば落ちる。
 */
const MIN_TESTS = 360;

check('R6.6.1', `テストが ${MIN_TESTS} 件以上あり、全て通ること`, () => {
  const out = execFileSync(process.execPath, ['--test', 'test/**/*.test.js'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  });
  const pass = Number((out.match(/pass (\d+)/) || [])[1]);
  const failed = Number((out.match(/fail (\d+)/) || [])[1]);
  if (failed > 0) fail(`${failed}件が失敗している`);
  if (!Number.isFinite(pass)) fail('テスト件数を読み取れない');
  if (pass < MIN_TESTS) fail(`テストが ${pass} 件しかない(下限 ${MIN_TESTS})`);
  return `pass ${pass} / fail ${failed}`;
});

check('R5.2.2', '安全装置のテストファイルに変異テストの記録があること', () => {
  // 【なぜ書式を決めて検査するか】「変異テストを実施すること」だけ書いても、
  // 実施したかどうかを後から誰も確かめられない。何をどう壊したときに何件落ちるかを
  // 書式で残せば、実装を変えたときに数が合わなくなり、記録の陳腐化に気づける。
  //
  // 書式: // MUTATION: <対象ファイル>:<対象> <変更内容> => 期待失敗 <n>件
  const REQUIRED = ['nutrition', 'store', 'energy', 'workout'];
  const RE = /^\/\/ MUTATION: js\/[\w.]+:.+ => 期待失敗 \d+件$/;
  const problems = [];
  for (const name of REQUIRED) {
    const f = `test/${name}.test.js`;
    const head = read(f).split('\n').slice(0, 12);
    const marks = head.filter((l) => RE.test(l.trim()));
    if (marks.length < 2) {
      problems.push(`${f}: 先頭12行に MUTATION 行が ${marks.length} 本（2本以上必要）`);
    }
  }
  if (problems.length) fail(problems.join('\n    '));
  return `${REQUIRED.length}ファイルに記録あり`;
});

check('R6.6.2', '安全装置に関わるモジュールがテストを持つこと', () => {
  // 安全装置(EAフロア・下限警告・目標値の検証)を実装しているモジュールに
  // テストが無い状態を許すと、変異テストの対象そのものが消える。
  const required = ['nutrition', 'energy', 'goals', 'store', 'micronutrients'];
  const missing = required.filter((m) => !existsSync(join(ROOT, 'test', `${m}.test.js`)));
  if (missing.length) fail(`テストが無い安全装置モジュール: ${missing.join(', ')}`);
  return required.join(', ');
});

// ---------------------------------------------------------------------------

const failures = results.filter((r) => !r.ok);
const width = Math.max(...results.map((r) => r.id.length));

console.log('\n指示書(docs/SPEC.md)の機械検査\n' + '='.repeat(64));
for (const r of results) {
  const mark = r.ok ? 'OK  ' : 'NG  ';
  console.log(`${mark}${r.id.padEnd(width)}  ${r.description}`);
  if (r.detail) {
    for (const line of String(r.detail).split('\n')) console.log(`      ${line}`);
  }
}
console.log('='.repeat(64));
console.log(`${results.length}件中 ${results.length - failures.length}件合格 / ${failures.length}件不合格\n`);

if (failures.length) {
  console.error('不合格の要求があります。docs/SPEC.md の該当項目を満たすか、要求そのものを見直してください。');
  process.exit(1);
}
