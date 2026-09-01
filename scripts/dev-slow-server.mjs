#!/usr/bin/env node
/**
 * 「半死の回線」を再現するための開発用サーバー。テスト専用で、本番には関与しない。
 *
 * 【なぜ必要か】docs/SPEC.md の R6.2.5 / R6.2.6 は、このアプリが最も壊れやすい
 * ネットワーク状態を扱う。ジムの不安定Wi-Fiは「TCPは張れるが応答が返らない」状態で、
 * 機内モード(fetch が即座に reject する)とは別物である。
 * サーバーを止めるだけでは前者を再現できない — 接続拒否は即座に失敗するので、
 * Service Worker の catch 節がすぐ走り、タイムアウトの経路を一度も通らない。
 *
 * このサーバーは応答を任意の時間だけ遅らせることで、その状態を作る。
 *
 * 使い方:
 *   node scripts/dev-slow-server.mjs [port] [初期遅延ms]
 *   curl "http://localhost:8081/__delay?ms=99999"   遅延を変更(半死の回線にする)
 *   curl "http://localhost:8081/__delay?ms=0"       正常に戻す
 *
 * __delay だけは常に遅延なしで応答する(制御用のため)。
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8081;
let delayMs = Number(process.argv[3]) || 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // 遅延の変更。これ自体は遅らせない(遅らせると設定を戻せなくなる)
  if (url.pathname === '/__delay') {
    delayMs = Number(url.searchParams.get('ms')) || 0;
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`delay=${delayMs}ms\n`);
    return;
  }

  // ディレクトリトラバーサルを塞ぐ。開発用でもここは緩めない
  // (テスト用サーバーの穴が、そのまま本番の設定へコピーされることがある)。
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  const filePath = join(ROOT, rel === '' ? 'index.html' : rel);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  if (delayMs > 0) await sleep(delayMs);

  try {
    const s = await stat(filePath);
    const target = s.isDirectory() ? join(filePath, 'index.html') : filePath;
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      // Service Worker の挙動を見たいので、ブラウザのHTTPキャッシュは効かせない
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
}).listen(PORT, () => {
  console.log(`slow-server: http://localhost:${PORT} (delay=${delayMs}ms, root=${ROOT})`);
  console.log(`  遅延変更: curl "http://localhost:${PORT}/__delay?ms=99999"`);
});
