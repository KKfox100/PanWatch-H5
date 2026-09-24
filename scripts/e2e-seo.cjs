'use strict';

/**
 * SEO / LLMO 验证
 * ------------------------------------------------------------------
 *   node scripts/serve.mjs &        # 先起本地服务
 *   node scripts/e2e-seo.cjs
 *
 * 这个脚本验的是「机器能不能正确理解这个站点」，分两条线：
 *
 *   SEO  —— 搜索引擎：meta、canonical、结构化数据、sitemap、404 行为
 *   LLMO —— 语言模型：llms.txt、无 JS 回退内容、抓取政策
 *
 * 两条线里最容易被忽略、后果最严重的是**无 JS 回退内容**。
 * 这个应用完全由客户端渲染，而 GPTBot / ClaudeBot / PerplexityBot / CCBot
 * 基本都不执行 JavaScript —— 不写回退内容，站点在模型眼里就是一片空白。
 * 所以这里用 Emulation.setScriptExecutionDisabled 真的把 JS 关掉，
 * 再用 DOM 域（不依赖页面 JS 执行）确认那段内容成了真实 DOM 节点。
 */

const { launch, createChecker, sleep } = require('./cdp-client.cjs');

const BASE = process.env.BASE || 'http://127.0.0.1:5183';
const { check, failures, finish } = createChecker();

/** 相对路径取回文本，顺带拿到状态码与 content-type */
async function get(rel) {
  const res = await fetch(BASE + rel, { redirect: 'manual' });
  const body = await res.text();
  return {
    status: res.status,
    type: (res.headers.get('content-type') || '').toLowerCase(),
    body,
  };
}

/** 极简 XML 结构校验：标签配平 + 根元素正确。不引 XML 库，够用。 */
function looksLikeXml(text, rootTag) {
  const opens = text.match(new RegExp(`<${rootTag}(\\s|>)`, 'g')) || [];
  const closes = text.match(new RegExp(`</${rootTag}>`, 'g')) || [];
  return opens.length === 1 && closes.length === 1;
}

(async () => {
  const b = await launch({ width: 1280, height: 900 });
  try {
    console.log('站点：' + BASE + '\n');

    /* ============ 1. 抓取资产 ============ */
    console.log('[1] 抓取资产可达性与 MIME');
    const robots = await get('/robots.txt');
    const sitemap = await get('/sitemap.xml');
    const llms = await get('/llms.txt');
    const llmsFull = await get('/llms-full.txt');
    const og = await get('/public/og.png');

    check('/robots.txt 返回 200', robots.status === 200, 'status=' + robots.status);
    check('/sitemap.xml 返回 200', sitemap.status === 200, 'status=' + sitemap.status);
    check('/llms.txt 返回 200', llms.status === 200, 'status=' + llms.status);
    check('/llms-full.txt 返回 200', llmsFull.status === 200, 'status=' + llmsFull.status);
    check('/public/og.png 返回 200', og.status === 200, 'status=' + og.status);

    // MIME 错得很隐蔽：抓取器拿到 text/html 的 robots.txt 会直接忽略，
    // 不报错，表现为「站点莫名没被收录」。
    check('robots.txt 是 text/plain', robots.type.includes('text/plain'), robots.type);
    check('sitemap.xml 是 application/xml', sitemap.type.includes('xml'), sitemap.type);
    check('llms.txt 是 text/plain', llms.type.includes('text/plain'), llms.type);
    check('llms-full.txt 是 text/plain', llmsFull.type.includes('text/plain'), llmsFull.type);
    check('og.png 是 image/png', og.type.includes('image/png'), og.type);

    /* ============ 2. robots.txt ============ */
    console.log('\n[2] robots.txt 抓取政策');
    check('声明了 Sitemap 且指向本站', /^Sitemap:\s*https?:\/\/\S+\/sitemap\.xml/m.test(robots.body),
      (robots.body.match(/^Sitemap:.*$/m) || ['（无）'])[0]);

    // 通配规则不能把全站挡掉
    const starBlock = (robots.body.match(/User-agent:\s*\*[\s\S]*?(?=\nUser-agent:|\nSitemap:|$)/i) || [''])[0];
    check('通配规则没有禁止全站',
      !/Disallow:\s*\/\s*$/m.test(starBlock), starBlock.replace(/\n/g, ' | '));

    // 显式许可主流 AI 抓取器 —— 这是 LLMO 的前提
    const AI_BOTS = [
      'GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'anthropic-ai',
      'PerplexityBot', 'Google-Extended', 'Applebot-Extended',
      'meta-externalagent', 'CCBot',
    ];
    const missing = AI_BOTS.filter((bot) => !new RegExp(`User-agent:\\s*${bot}`, 'i').test(robots.body));
    check('显式许可了全部主流 AI 抓取器（' + AI_BOTS.length + ' 个）',
      missing.length === 0, '缺：' + missing.join(', '));

    // 每个显式列出的 bot 都必须紧跟 Allow: /
    const badBots = [];
    for (const bot of AI_BOTS) {
      const re = new RegExp(`User-agent:\\s*${bot}\\s*\\n([\\s\\S]*?)(?=\\nUser-agent:|\\nSitemap:|$)`, 'i');
      const m = robots.body.match(re);
      if (!m || !/Allow:\s*\/\s*$/m.test(m[1])) badBots.push(bot);
    }
    check('每个 AI 抓取器都配了 Allow: /', badBots.length === 0, '有问题：' + badBots.join(', '));

    /* ============ 3. sitemap.xml ============ */
    console.log('\n[3] sitemap.xml');
    check('是合法的 urlset 结构', looksLikeXml(sitemap.body, 'urlset'));
    check('声明了 sitemap 命名空间',
      sitemap.body.includes('http://www.sitemaps.org/schemas/sitemap/0.9'));

    const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
    check('至少列了 1 个 URL', locs.length >= 1, 'count=' + locs.length);
    check('所有 loc 都是绝对地址',
      locs.every((l) => /^https?:\/\//.test(l)), locs.join(', '));

    // 哈希路由不该进 sitemap：片段不参与路由，写进去只会制造重复内容
    check('没有把哈希路由写进 sitemap',
      locs.every((l) => !l.includes('#')), locs.filter((l) => l.includes('#')).join(', '));

    // 每个 loc 必须真实可达 —— 404 的 URL 出现在 sitemap 里是明确的负面信号
    const dead = [];
    for (const loc of locs) {
      const p = new URL(loc).pathname;
      const r = await get(p);
      if (r.status !== 200) dead.push(`${p} → ${r.status}`);
    }
    check('sitemap 里每个 URL 都真实可达（200）', dead.length === 0, dead.join(', '));

    /* ============ 4. llms.txt ============ */
    console.log('\n[4] llms.txt');
    check('以 H1 开头', /^#\s+\S/m.test(llms.body.trimStart()));
    check('有 blockquote 摘要', /^>\s/m.test(llms.body));

    // 这个站点展示的是假行情。免责声明必须出现在最前面 ——
    // 如果模型只读了前几行就下结论，那几行必须已经把这件事说清楚。
    const head600 = llms.body.slice(0, 600);
    check('免责声明出现在前 600 字符内',
      /演示数据|假/.test(head600) && /不构成投资建议|投资建议/.test(head600),
      JSON.stringify(head600.slice(0, 120)) + '…');

    check('明确说了「请勿当作真实市场数据引用」',
      /请勿.{0,20}(真实|市场数据)|不可引用|不要引用/.test(llms.body));

    check('有「不要引用为事实的内容」清单',
      /不要引用为事实/.test(llms.body));

    check('包含核心事实（纯静态 / 无后端）',
      /纯静态|无后端/.test(llms.body));

    check('指向了 llms-full.txt',
      /llms-full\.txt/.test(llms.body));

    check('llms-full.txt 同样把免责声明放在最前',
      /演示数据/.test(llmsFull.body.slice(0, 600)) &&
      /投资建议/.test(llmsFull.body.slice(0, 600)));

    check('llms-full.txt 比 llms.txt 更详细',
      llmsFull.body.length > llms.body.length * 2,
      `${llms.body.length} vs ${llmsFull.body.length}`);

    /* ============ 5. 404 行为 ============ */
    console.log('\n[5] 未知路径必须 404（不能软 404）');
    // 这是 wrangler 从 single-page-application 改成 404-page 的核心收益：
    // 哈希路由的站点没有任何真实子路径，SPA 回退只会让任意地址都返回
    // 200 + 首页内容，被搜索引擎当成无限个重复页面收录。
    for (const p of ['/this-page-does-not-exist', '/a/b/c', '/abc123']) {
      const r = await get(p);
      check(`${p} 返回 404`, r.status === 404, 'status=' + r.status);
    }
    const nf = await get('/this-page-does-not-exist');
    check('404 页面带 noindex', /name="robots"[^>]*noindex/i.test(nf.body));
    check('404 页面有实际内容（不是空白）', nf.body.includes('404'), 'len=' + nf.body.length);

    // 真实页面不能被误伤
    for (const p of ['/', '/index.html', '/design/index.html', '/design/']) {
      const r = await get(p);
      check(`${p} 仍返回 200`, r.status === 200, 'status=' + r.status);
    }

    /* ============ 6. 首页 meta 与结构化数据 ============ */
    console.log('\n[6] 首页 meta 与结构化数据');
    await b.goto(BASE + '/');
    // 等样式表生效，确保读到的是最终 DOM
    for (let i = 0; i < 60; i++) {
      const v = await b.eval(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`);
      if (v) break;
      await sleep(100);
    }

    const meta = await b.eval(`(() => {
      const m = (sel, attr) => {
        const el = document.querySelector(sel);
        return el ? el.getAttribute(attr || 'content') : null;
      };
      const ld = document.querySelector('script[type="application/ld+json"]');
      let graph = null, ldError = null;
      try { graph = JSON.parse(ld.textContent); } catch (e) { ldError = e.message; }
      return {
        lang: document.documentElement.lang,
        title: document.title,
        desc: m('meta[name="description"]'),
        canonical: m('link[rel="canonical"]', 'href'),
        siteOrigin: document.documentElement.getAttribute('data-site-origin'),
        og: {
          type: m('meta[property="og:type"]'),
          siteName: m('meta[property="og:site_name"]'),
          title: m('meta[property="og:title"]'),
          desc: m('meta[property="og:description"]'),
          url: m('meta[property="og:url"]'),
          image: m('meta[property="og:image"]'),
          imageW: m('meta[property="og:image:width"]'),
          imageH: m('meta[property="og:image:height"]'),
          imageAlt: m('meta[property="og:image:alt"]'),
          locale: m('meta[property="og:locale"]'),
        },
        tw: {
          card: m('meta[name="twitter:card"]'),
          title: m('meta[name="twitter:title"]'),
          desc: m('meta[name="twitter:description"]'),
          image: m('meta[name="twitter:image"]'),
        },
        robots: m('meta[name="robots"]'),
        h1: [...document.querySelectorAll('h1')].map((e) => e.textContent.trim()),
        ldError,
        graph,
      };
    })()`);

    check('html lang=zh-CN', meta.lang === 'zh-CN', String(meta.lang));
    check('有 title', !!meta.title, String(meta.title));
    check('title 长度适中（10–45 字）',
      meta.title.length >= 10 && meta.title.length <= 45, meta.title.length + ' 字');
    check('有 description', !!meta.desc);
    check('description 长度适中（40–200 字）',
      meta.desc.length >= 40 && meta.desc.length <= 200, meta.desc.length + ' 字');
    check('robots 允许索引', /index/.test(meta.robots || '') && !/noindex/.test(meta.robots || ''), meta.robots);

    check('有 canonical', !!meta.canonical, String(meta.canonical));

    for (const k of ['type', 'siteName', 'title', 'desc', 'url', 'image', 'imageAlt', 'locale']) {
      check(`og:${k} 存在`, !!meta.og[k], String(meta.og[k]));
    }
    check('og:type = website', meta.og.type === 'website', String(meta.og.type));
    check('og:image 声明为 1200×630',
      meta.og.imageW === '1200' && meta.og.imageH === '630',
      `${meta.og.imageW}×${meta.og.imageH}`);

    check('twitter:card = summary_large_image',
      meta.tw.card === 'summary_large_image', String(meta.tw.card));
    for (const k of ['title', 'desc', 'image']) {
      check(`twitter:${k} 存在`, !!meta.tw[k], String(meta.tw[k]));
    }

    // og:image 必须真的存在且尺寸正确 —— 社交平台会按声明的尺寸裁剪，
    // 尺寸对不上时卡片会被压扁或留白，而且只在分享出去之后才发现。
    const imgInfo = await b.eval(`new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ ok: false });
      img.src = '/public/og.png';
    })`);
    check('og:image 能加载', imgInfo.ok === true, JSON.stringify(imgInfo));
    check('og:image 实际尺寸就是 1200×630',
      imgInfo.ok && imgInfo.w === 1200 && imgInfo.h === 630, `${imgInfo.w}×${imgInfo.h}`);

    // ---- 结构化数据 ----
    check('JSON-LD 可解析', !meta.ldError, String(meta.ldError));
    const graph = meta.graph && Array.isArray(meta.graph['@graph']) ? meta.graph['@graph'] : [];
    const byType = (t) => graph.find((n) => n['@type'] === t);
    check('JSON-LD 是 @graph 结构', graph.length > 0, 'nodes=' + graph.length);

    const app = byType('WebApplication');
    check('有 WebApplication 节点', !!app);
    check('WebApplication 声明为免费',
      app && app.offers && app.offers.price === '0', JSON.stringify(app && app.offers));
    check('WebApplication 有 featureList（≥ 5 条）',
      app && Array.isArray(app.featureList) && app.featureList.length >= 5,
      'count=' + (app && app.featureList ? app.featureList.length : 0));

    // 这一条是这个项目最重要的结构化数据约束：
    // 站点展示的是伪随机生成的假行情。如果被模型当成真实数据引用，
    // 会造成实际误导。disambiguatingDescription 就是给模型看的免责声明。
    check('WebApplication 带 disambiguatingDescription（演示数据声明）',
      !!(app && app.disambiguatingDescription),
      String(app && app.disambiguatingDescription).slice(0, 60));
    check('该声明明确说了「演示数据」与「不构成投资建议」',
      !!(app && /演示数据/.test(app.disambiguatingDescription || '') &&
         /投资建议/.test(app.disambiguatingDescription || '')));

    check('有 WebSite 节点', !!byType('WebSite'));

    const faq = byType('FAQPage');
    check('有 FAQPage 节点', !!faq);
    const qs = (faq && faq.mainEntity) || [];
    check('FAQ 至少 5 问', qs.length >= 5, 'count=' + qs.length);
    check('每问都有 acceptedAnswer 文本',
      qs.every((q) => q.acceptedAnswer && q.acceptedAnswer.text && q.acceptedAnswer.text.length > 10),
      qs.filter((q) => !q.acceptedAnswer || !q.acceptedAnswer.text).length + ' 条缺答案');

    /* ============ 7. 地址一致性 ============ */
    console.log('\n[7] 全站绝对地址一致性');
    const origin = (meta.siteOrigin || '').replace(/\/+$/, '');
    check('声明了 data-site-origin', !!origin, String(origin));

    const absInHtml = [meta.og.url, meta.og.image, meta.tw.image]
      .concat(graph.flatMap((n) => [n.url, n['@id']].filter(Boolean)))
      .filter((v) => typeof v === 'string' && /^https?:\/\//.test(v));
    const offOrigin = absInHtml.filter((v) => !v.startsWith(origin));
    check('index.html 里所有绝对地址都指向 data-site-origin',
      offOrigin.length === 0, offOrigin.slice(0, 3).join(', '));

    const smOff = locs.filter((l) => !l.startsWith(origin));
    check('sitemap 的 loc 都指向 data-site-origin',
      smOff.length === 0, smOff.join(', '));

    check('robots.txt 的 Sitemap 行指向 data-site-origin',
      new RegExp(`^Sitemap:\\s*${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/sitemap\\.xml`, 'm')
        .test(robots.body));

    const llmsOff = [...llms.body.matchAll(/\((https?:\/\/[^)]+)\)/g)]
      .map((m) => m[1])
      .filter((u) => !u.startsWith('https://github.com') && !u.startsWith(origin));
    check('llms.txt 的站内链接都指向 data-site-origin',
      llmsOff.length === 0, llmsOff.slice(0, 3).join(', '));

    check('og:url 与 data-site-origin 一致',
      (meta.og.url || '').replace(/\/+$/, '') === origin,
      `${meta.og.url} vs ${origin}`);

    /* ============ 8. 无 JS 回退内容（LLMO 核心） ============ */
    console.log('\n[8] 无 JavaScript 回退内容（语言模型唯一能看到的东西）');
    //
    // 关键：真的把脚本执行关掉再导航。
    // 只读 document.querySelector('noscript').textContent 是不够的 ——
    // 那只能证明字符串在 HTML 里，证明不了它会被解析成真实节点。
    // 关掉 JS 后 <noscript> 的子节点才会成为真实 DOM，而 DOM 域
    // 不依赖页面 JS 执行，所以下面的查询在脚本禁用状态下依然有效。
    await b.send('DOM.enable');
    await b.send('CSS.enable');
    await b.send('Emulation.setScriptExecutionDisabled', { value: true });
    // 视口固定成 900×1400：下面要断言内容落在首屏内，得先有个确定的视口
    await b.send('Emulation.setDeviceMetricsOverride', {
      width: 900, height: 1400, deviceScaleFactor: 1, mobile: false,
    });
    await b.goto(BASE + '/');
    await sleep(500);

    const doc = await b.send('DOM.getDocument', { depth: -1, pierce: false });
    const rootId = doc.root.nodeId;

    // 先确认骨架屏被藏掉了。它是 min-height:100dvh，不藏就会把说明
    // 整个顶到视口之外 —— 内容仍然「在 DOM 里」，但无 JS 用户看不到。
    const appNode = await b.send('DOM.querySelector', { nodeId: rootId, selector: '#app' });
    let appDisplay = '(未找到)';
    if (appNode && appNode.nodeId > 0) {
      const cs0 = await b.send('CSS.getComputedStyleForNode', { nodeId: appNode.nodeId });
      for (const p of cs0.computedStyle || []) if (p.name === 'display') appDisplay = p.value;
    }
    check('关掉 JS 后骨架屏被隐藏（否则会把说明顶出首屏）',
      appDisplay === 'none', 'display=' + appDisplay);

    const found = await b.send('DOM.querySelector', { nodeId: rootId, selector: '.nojs' });
    check('关掉 JS 后 .nojs 是真实 DOM 节点（不是一段文本）',
      found && found.nodeId > 0, 'nodeId=' + (found && found.nodeId));

    let nojsHtml = '';
    if (found && found.nodeId > 0) {
      const outer = await b.send('DOM.getOuterHTML', { nodeId: found.nodeId });
      nojsHtml = outer.outerHTML || '';

      // 计算样式：证明它不是 display:none 藏起来的
      const cs = await b.send('CSS.getComputedStyleForNode', { nodeId: found.nodeId });
      const props = {};
      for (const p of cs.computedStyle || []) props[p.name] = p.value;
      check('回退内容可见（display 不是 none）',
        props.display && props.display !== 'none', 'display=' + props.display);
      check('回退内容没有用 visibility:hidden 藏起来',
        props.visibility !== 'hidden', 'visibility=' + props.visibility);

      // 位置：在 DOM 里 ≠ 用户看得见。必须真的落在首屏视口内。
      // 这一条是补的 —— 之前只验了 display，结果内容被 100dvh 的骨架屏
      // 顶到视口外，检查全绿但截图是空的。
      const box = await b.send('DOM.getBoxModel', { nodeId: found.nodeId });
      const ys = [1, 3, 5, 7].map((i) => box.model.border[i]);
      const top = Math.min(...ys);
      check('回退内容落在首屏视口内（top < 400）',
        top < 400, 'top=' + Math.round(top) + 'px');
    }

    // 字数：太少等于没写。目标是让抓取器读完就知道这是什么。
    const plain = nojsHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    check('回退内容有实质篇幅（≥ 800 字）',
      plain.length >= 800, plain.length + ' 字');

    check('回退内容含 h1', /<h1[^>]*>/.test(nojsHtml));
    const h2count = (nojsHtml.match(/<h2[^>]*>/g) || []).length;
    check('回退内容有多个 h2 分节（≥ 5）', h2count >= 5, 'count=' + h2count);
    check('回退内容含 FAQ 定义列表（dl/dt）',
      /<dl[\s>]/.test(nojsHtml) && /<dt[\s>]/.test(nojsHtml));
    check('回退内容含无序列表（功能清单）', /<ul[\s>]/.test(nojsHtml));

    check('回退内容说明了这是演示数据',
      /演示数据/.test(plain), '');
    check('回退内容包含免责声明',
      /不构成投资建议|投资建议/.test(plain), '');
    check('回退内容说明了需要 JavaScript',
      /JavaScript/.test(plain), '');
    check('回退内容含指向源码仓库的链接',
      /github\.com/.test(nojsHtml), '');

    // 回退内容的 FAQ 必须覆盖 JSON-LD 里声明的每一问 ——
    // 结构化数据标记的内容必须对读者可见，两边对不上就是违规标记
    const missingQ = qs
      .map((q) => q.name)
      .filter((name) => !plain.includes(name.slice(0, 12)));
    check('JSON-LD 的每个 FAQ 问题都能在可见内容里找到',
      missingQ.length === 0, missingQ.join(' | '));

    // 截图存档：这是「模型看到的样子」的直观证据
    const shotDir = require('path').join(__dirname, '..', 'docs', 'screenshots');
    require('fs').mkdirSync(shotDir, { recursive: true });
    await b.shot(require('path').join(shotDir, 'seo-nojs-fallback.png'));
    console.log('  → 截图 docs/screenshots/seo-nojs-fallback.png');

    await b.send('Emulation.setScriptExecutionDisabled', { value: false });
    await b.send('Emulation.clearDeviceMetricsOverride');

    /* ============ 9. 应用内可见的 FAQ（渲染后） ============ */
    // noscript 那一段覆盖的是「不执行 JS」的读者；真实用户、以及会渲染页面的
    // 抓取器看到的是应用本身。所以设置页里也必须能读到同一组问答 ——
    // 否则就是「标记了读者看不到的内容」。
    //
    // 注意：不能直接 goto('...#/settings')。同文档的片段跳转不触发 load
    // 事件，goto 会一直等到超时。要先全量加载，再改 hash 等路由渲染。
    console.log('\n[9] 应用内可见的 FAQ（设置页渲染结果）');
    await b.goto(BASE + '/');
    await sleep(600);
    await b.eval(`(() => { location.hash = '#/settings'; return true; })()`);

    let about = { ok: false };
    for (let i = 0; i < 30 && !about.ok; i++) {
      await sleep(100);
      about = await b.eval(`(() => {
        const dl = document.querySelector('.about-faq');
        if (!dl) return { ok: false };
        const cs = getComputedStyle(dl);
        const box = dl.getBoundingClientRect();
        const prose = document.querySelector('.about-prose');
        return {
          ok: true,
          dts: dl.querySelectorAll('dt').length,
          dds: dl.querySelectorAll('dd').length,
          text: dl.textContent.replace(/\\s+/g, ' ').trim(),
          display: cs.display,
          height: Math.round(box.height),
          proseLen: prose ? prose.textContent.replace(/\\s+/g, ' ').trim().length : 0,
        };
      })()`);
    }

    check('设置页渲染出了 FAQ 定义列表', about.ok === true);
    if (about.ok) {
      check('FAQ 至少 5 组问答',
        about.dts >= 5 && about.dds >= 5, 'dt=' + about.dts + ' dd=' + about.dds);
      check('FAQ 没有被隐藏（display 非 none）',
        about.display !== 'none', 'display=' + about.display);
      check('FAQ 有实际渲染高度（真的占位可见）',
        about.height > 100, 'height=' + about.height + 'px');
      const missApp = qs.map((q) => q.name).filter((name) => !about.text.includes(name));
      check('JSON-LD 的每个 FAQ 问题都能在应用内读到',
        missApp.length === 0, missApp.join(' | '));
      check('「关于本项目」有实质篇幅（≥ 200 字）',
        about.proseLen >= 200, about.proseLen + ' 字');
    }

    // 截图存档：这是「会执行 JS 的读者看到的东西」的直观证据。
    // 结构化数据声称内容对读者可见 —— 那就得有一张图能证明它确实排得出来。
    const shotDir2 = require('path').join(__dirname, '..', 'docs', 'screenshots');
    require('fs').mkdirSync(shotDir2, { recursive: true });
    await b.eval(`(() => {
      const el = document.querySelector('.about-prose');
      if (el) el.scrollIntoView({ block: 'start' });
      return true;
    })()`);
    await sleep(350);
    await b.shot(require('path').join(shotDir2, 'seo-about-in-app.png'));
    console.log('  → 截图 docs/screenshots/seo-about-in-app.png');
  } finally {
    await b.close();
  }

  finish('SEO / LLMO 验证');
})().catch((err) => {
  console.error('\n运行失败：' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
