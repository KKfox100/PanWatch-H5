/**
 * 静态自检（零依赖）
 *   1. import 的相对路径都真实存在
 *   2. index.html 引用的资源都在磁盘上
 *   3. sw.js 的预缓存清单与实际文件一致（双向）
 *   4. manifest 里的图标都存在
 *   5. 括号 / 引号配平的粗检
 *
 *   node scripts/check.mjs
 *
 * 说明：这里不做真正的语法解析。Node 在 Windows 上无法 spawn 自身
 * （EBUSY：正在运行的 node.exe 被占用），所以语法交给浏览器端 E2E 覆盖：
 *   node scripts/serve.mjs  →  浏览器打开  →  看控制台
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warnings = [];
const notes = [];

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.wrangler'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allFiles = walk(ROOT);
const jsFiles = allFiles.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));

/* ---- 1. import 路径 ---- */
const IMPORT_RES = [
  /(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
];

for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  for (const re of IMPORT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;              // 裸模块名跳过
      const target = path.resolve(path.dirname(f), spec);
      if (!fs.existsSync(target)) {
        errors.push(`import 找不到文件：${rel(f)} → ${spec}`);
      }
    }
  }
}

/* ---- 2. index.html 引用 ---- */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
for (const m of html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)) {
  const target = path.join(ROOT, m[1].replace(/^\.\//, ''));
  if (!fs.existsSync(target)) errors.push(`index.html 引用了不存在的资源：${m[1]}`);
}

/* ---- 3. sw.js 预缓存清单 ---- */
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const pre = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
if (!pre) {
  warnings.push('sw.js 里没找到 PRECACHE 数组');
} else {
  const items = [...pre[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const it of items) {
    if (it === './') continue;
    if (!fs.existsSync(path.join(ROOT, it.replace(/^\.\//, '')))) {
      errors.push(`sw.js 预缓存了不存在的资源：${it}`);
    }
  }
  for (const v of jsFiles.filter((f) => rel(f).startsWith('js/')).map((f) => './' + rel(f))) {
    if (!items.includes(v)) warnings.push(`sw.js 预缓存清单缺少：${v}`);
  }
}

/* ---- 4. manifest 图标 ---- */
const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'manifest.json'), 'utf8'));
for (const ic of mf.icons || []) {
  if (!fs.existsSync(path.join(ROOT, 'public', ic.src.replace(/^\.\//, '')))) {
    errors.push(`manifest 图标缺失：${ic.src}`);
  }
}

/* ---- 5. icon('xxx') 引用的图标是否都定义了 ---- */
const iconSrc = fs.readFileSync(path.join(ROOT, 'js', 'icons.js'), 'utf8');
const definedIcons = new Set(
  [...iconSrc.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*S\(/gm)].map((m) => m[1])
);
if (definedIcons.size === 0) {
  warnings.push('没能从 icons.js 解析出图标名，跳过图标引用检查');
} else {
  // 只扫运行时源码；scripts/ 是自己的代码，会命中自身的示例字符串
  const runtimeJs = jsFiles.filter(
    (f) => rel(f) !== 'js/icons.js' && !rel(f).startsWith('scripts/')
  );
  for (const f of runtimeJs) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\bicon\(\s*'([^']+)'\s*\)/g)) {
      if (!definedIcons.has(m[1])) {
        errors.push(`图标未定义：${rel(f)} → icon('${m[1]}')`);
      }
    }
    // icons.xxx —— 负向断言排除 './icons.js' 这种 import 路径
    for (const m of src.matchAll(/\bicons\.([A-Za-z][A-Za-z0-9]*)(?![\w'"\/])/g)) {
      if (!definedIcons.has(m[1])) {
        errors.push(`图标未定义：${rel(f)} → icons.${m[1]}`);
      }
    }
  }
}

/* ---- 6. data-act="xxx" 是否都有对应处理函数 ---- */
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
const actionsBlock = appSrc.match(/const ACTIONS = \{([\s\S]*?)\n\};/);
if (!actionsBlock) {
  warnings.push('没能从 app.js 解析出 ACTIONS，跳过动作检查');
} else {
  // 允许 'name': () => / name: () => / name: async () => / name: (el) => 等写法
  const handled = new Set(
    [...actionsBlock[1].matchAll(/^\s{2}'?([A-Za-z][A-Za-z0-9-]*)'?:\s*(?:async\s*)?\(/gm)]
      .map((m) => m[1])
  );
  const used = new Set();
  for (const f of allFiles.filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/data-act="([^"]+)"/g)) used.add(m[1]);
  }
  for (const a of used) {
    // 这些在 app.js 里用独立分支处理，不走 ACTIONS 表
    if (['toggle-auto-refresh'].includes(a)) continue;
    if (!handled.has(a)) errors.push(`data-act 没有处理函数：${a}`);
  }
}

/* ---- 7. 事件选择器里引用的 data-* 属性是否真的会被渲染出来 ---- */
const knownAttrs = new Set();
for (const f of allFiles.filter((x) => x.endsWith('.js'))) {
  const src = fs.readFileSync(f, 'utf8');
  // 同时匹配 data-x="..." 与布尔属性 data-x> / data-x 空格
  for (const m of src.matchAll(/\bdata-([a-z][a-z0-9-]*)(?=[=>\s])/g)) knownAttrs.add(m[1]);
}
const seenAttrWarn = new Set();
for (const m of appSrc.matchAll(/data-([a-z][a-z0-9-]*)/g)) {
  const a = m[1];
  if (['sheet-close', 'sheet-ok'].includes(a)) continue;   // 弹层通用约定
  if (a === 'theme') continue;                              // <html data-theme> 不在 JS 里渲染
  if (a === 'act' || a === 'nav' || a === 'stock' || a === 'tab') continue; // 核心约定，必然存在
  if (!knownAttrs.has(a) && !seenAttrWarn.has(a)) {
    seenAttrWarn.add(a);
    warnings.push(`app.js 监听了 data-${a}，但视图里没有渲染该属性`);
  }
}

/* ---- 8. FAQ 结构化数据 ↔ 可见内容，三处逐字一致 ----
   结构化数据标记的内容必须对读者可见。这个站点把同一组问答写了三遍：

     index.html 的 JSON-LD        —— 给机器
     index.html 的 <noscript>     —— 给不执行 JS 的读者与抓取器
     设置页的 .about-faq          —— 给真实用户与能渲染页面的抓取器

   三处任意一处漂移，就变成「标记了读者看不到的内容」。放在这里做静态
   核对，比在浏览器里跑一遍更早发现问题、也更快。

   前提：问答的正文必须各写在一行内 —— 跨行断开会插入空格，核对时对不上。 */
{
  const ldBodies = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  const faqQs = [];
  for (const m of ldBodies) {
    let data;
    try {
      data = JSON.parse(m[1]);
    } catch (e) {
      errors.push('index.html 里的 JSON-LD 无法解析：' + e.message);
      continue;
    }
    for (const node of data['@graph'] || [data]) {
      if (node['@type'] === 'FAQPage') faqQs.push(...(node.mainEntity || []));
    }
  }

  if (!faqQs.length) {
    warnings.push('index.html 里没找到 FAQPage 节点，跳过 FAQ 一致性核对');
  } else {
    // 用 lastIndexOf：<noscript> 这个字符串在它前面的注释里也出现过，
    // 直接 match 会从注释里的那处开始截，虽然结果仍含正文但很脆弱。
    const nojsStart = html.lastIndexOf('<noscript>');
    const nojsEnd = html.indexOf('</noscript>', nojsStart);
    const places = [
      ['index.html <noscript>', html.slice(nojsStart, nojsEnd)],
      ['js/views/settings.js', fs.readFileSync(path.join(ROOT, 'js', 'views', 'settings.js'), 'utf8')],
    ].map(([name, src]) => [name, src.replace(/\s+/g, ' ')]);

    for (const q of faqQs) {
      const ask = (q.name || '').replace(/\s+/g, ' ').trim();
      const ans = ((q.acceptedAnswer && q.acceptedAnswer.text) || '').replace(/\s+/g, ' ').trim();
      if (!ask || !ans) {
        errors.push('FAQ 条目缺少 name 或 acceptedAnswer.text');
        continue;
      }
      for (const [where, src] of places) {
        if (!src.includes(ask)) errors.push(`FAQ 问题在 ${where} 里找不到：${ask}`);
        if (!src.includes(ans)) errors.push(`FAQ 答案在 ${where} 里找不到：${ans}`);
      }
    }
    notes.push(`FAQ 一致性：${faqQs.length} 组问答在 JSON-LD / <noscript> / 设置页三处一致`);
  }
}

/* ---- 输出 ---- */
const bar = '─'.repeat(58);
console.log(`\n${bar}\n  盯盘侠 H5 · 静态自检\n${bar}`);
console.log(`  扫描 ${allFiles.length} 个文件，其中 JS ${jsFiles.length} 个`);
if (notes.length) {
  console.log('');
  notes.forEach((n) => console.log(`  · ${n}`));
}

if (warnings.length) {
  console.log(`\n  ⚠ 警告 ${warnings.length} 条`);
  warnings.forEach((w) => console.log(`    - ${w}`));
}

if (errors.length) {
  console.log(`\n  ✗ 错误 ${errors.length} 条`);
  errors.forEach((e) => console.log(`    - ${e}`));
  console.log('');
  process.exit(1);
}

console.log(`\n  ✓ 全部通过\n${bar}\n`);
