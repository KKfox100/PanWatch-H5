/**
 * 本地静态预览服务（零依赖）
 * 用途：不装 wrangler 也能起一个和线上行为接近的本地服务，
 *       特别是要保证 .js 走正确的 MIME（ES Module 对 MIME 很敏感）。
 *
 *   node scripts/serve.mjs [port]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || process.env.PORT || 5183);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonc': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let rel = decodeURIComponent(url.pathname);

  // 目录 → index.html（对应 wrangler 的 html_handling: auto-trailing-slash）
  if (rel.endsWith('/')) rel += 'index.html';

  let file = path.join(ROOT, rel);

  // 防目录穿越
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  /* 找不到就返回 404.html，状态码是 404。
   *
   * 这里原本有一句「没有扩展名且文件不存在 → index.html」的 SPA 回退，
   * 已经删掉 —— 它和 wrangler.jsonc 的 not_found_handling 保持一致：
   * 本项目是哈希路由，真实 URL 只有 / 与 /design/index.html，
   * 回退只会把任意乱敲的地址变成「返回 200、内容与应用首页相同」的软 404。
   *
   * 本地服务必须和线上行为一致，否则「本地通过、线上被收录一堆垃圾页」
   * 这类问题在开发阶段永远发现不了。 */
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const nf = path.join(ROOT, '404.html');
    if (fs.existsSync(nf)) {
      res.writeHead(404, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Robots-Tag': 'noindex',
      });
      res.end(fs.readFileSync(nf));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    }
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  盯盘侠 H5 本地预览\n  → http://127.0.0.1:${PORT}\n`);
});
