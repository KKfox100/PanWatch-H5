'use strict';

/**
 * 一次性替换全站的绝对地址
 * ------------------------------------------------------------------
 *   node scripts/set-origin.cjs https://你的域名
 *
 * 为什么需要这个脚本：
 * canonical 可以用相对路径，但 og:url、JSON-LD 的 url / @id、sitemap 的 loc
 * 按规范要求绝对地址。它们在 6 个文件里出现几十次 —— 手改必漏，
 * 而漏掉的表现非常隐蔽：分享卡片指向旧域名、知识图谱把实体拼错，
 * 页面上看不出任何异常。
 *
 * 真值来源是 index.html 里的 <html data-site-origin="...">。
 * 脚本读出当前值，把全站所有出现处替换成新值，改完再核对一遍。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** 需要同步的文件。加新文件时记得补进来 —— 下面的核对步骤会兜住漏网。 */
const FILES = [
  'index.html',
  'design/index.html',
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  'llms-full.txt',
];

/** 从 index.html 的 data-site-origin 读出当前地址 */
function readCurrentOrigin() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/data-site-origin="([^"]+)"/);
  if (!m) {
    console.error('index.html 里找不到 data-site-origin 属性 —— 它是全站地址的真值来源。');
    process.exit(1);
  }
  return m[1].replace(/\/+$/, '');
}

function main() {
  const arg = process.argv[2];

  if (!arg || arg === '-h' || arg === '--help') {
    console.log('用法：node scripts/set-origin.cjs <https://你的域名>');
    console.log('');
    console.log('当前地址：' + readCurrentOrigin());
    process.exit(arg ? 0 : 1);
  }

  // 规范化：补协议、去掉尾部斜杠
  let next = arg.trim();
  if (!/^https?:\/\//.test(next)) next = 'https://' + next;
  next = next.replace(/\/+$/, '');

  try {
    // 校验是不是合法 URL —— 写错了要在这里拦住，不能带着坏地址改一圈文件
    const u = new URL(next);
    if (u.pathname !== '/' || u.search || u.hash) {
      console.error('只接受站点根地址，不要带路径或参数：' + next);
      process.exit(1);
    }
  } catch (e) {
    console.error('不是合法的 URL：' + next);
    process.exit(1);
  }

  const prev = readCurrentOrigin();
  if (prev === next) {
    console.log(`地址没有变化，仍是 ${next}`);
    process.exit(0);
  }

  console.log(`替换：${prev}  →  ${next}\n`);

  let totalHits = 0;
  for (const rel of FILES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
      console.log(`  跳过（文件不存在）  ${rel}`);
      continue;
    }
    const before = fs.readFileSync(file, 'utf8');
    const hits = before.split(prev).length - 1;
    if (hits === 0) {
      console.log(`  —                  ${rel}（无出现）`);
      continue;
    }
    fs.writeFileSync(file, before.split(prev).join(next), 'utf8');
    totalHits += hits;
    console.log(`  ✓ ${String(hits).padStart(2)} 处           ${rel}`);
  }

  // 核对：替换完再扫一遍，确认旧地址一处不剩、新地址处处对得上
  const leftovers = [];
  for (const rel of FILES) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) continue;
    const txt = fs.readFileSync(file, 'utf8');
    if (txt.includes(prev)) leftovers.push(rel);
  }

  console.log('');
  if (leftovers.length) {
    console.error('✗ 这些文件里仍残留旧地址：' + leftovers.join(', '));
    process.exit(1);
  }

  console.log(`✅ 共替换 ${totalHits} 处，旧地址已无残留`);
  console.log('');
  console.log('别忘了同步 <lastmod>：sitemap.xml 里的日期要与本次发版时间一致。');
  console.log('改完跑一次 npm run verify 复核。');
}

main();
