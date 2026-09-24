'use strict';

/**
 * 设计规范页验证（真实 Chrome，零依赖）
 * ------------------------------------------------------------------
 *   node scripts/serve.mjs &          # 先起本地服务
 *   node scripts/e2e-design.cjs       # 再跑这个
 *
 * 规范页和应用的验证目标不同，所以单独一套：
 *
 *   应用  → 「功能对不对」：路由、数据、交互、持久化。
 *   规范页 → 「说的和做的一致吗」：页面上的对比度是**现算**的，
 *            色板读的是 CSS 变量本身。所以最危险的失败模式不是报错，
 *            而是悄悄显示一个错的数字，或者把 undefined 渲染成文字 ——
 *            设计规范一旦说错话，比没有规范更糟。
 *
 * 因此这里重点验三件事：
 *   ① 零控制台报错（模块导入路径写错会在这里暴露）
 *   ② 页面上不出现 undefined / NaN / [object Object]
 *   ③ 现算出来的对比度，与独立实现的 WCAG 公式算出的值一致
 */

const path = require('path');
const fs = require('fs');
const { launch, createChecker, sleep } = require('./cdp-client.cjs');

const BASE = process.env.BASE || 'http://127.0.0.1:5183';
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots');

const { check, failures, finish } = createChecker();

const SECTIONS = [
  'overview', 'habits', 'color', 'type', 'space',
  'elevation', 'icons', 'motion', 'components', 'pages', 'a11y',
];

/* ------------------------------------------------------------------ *
 * 独立实现的对比度（不复用页面里的代码 —— 复用就变成自己验自己）
 * ------------------------------------------------------------------ */

function toRgb(input) {
  const s = String(input).trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  return (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
}

function luminance(input) {
  const v = toRgb(input).map((x) => {
    const c = x / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ------------------------------------------------------------------ */

async function main() {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

  const b = await launch({ width: 1440, height: 1000 });
  try {
    console.log('规范页：http://127.0.0.1:5183/design/index.html\n');

    /* ============ 1. 加载与模块 ============ */
    console.log('[1] 加载与模块导入');
    await b.goto(BASE + '/design/index.html');

    // 等 spec.js 真正跑完：目录是它生成的
    let tocCount = 0;
    for (let i = 0; i < 60; i++) {
      tocCount = await b.eval(`document.querySelectorAll('.spec-toc__list a').length`);
      if (tocCount > 0) break;
      await sleep(100);
    }
    check('spec.js 已执行（目录已生成）', tocCount > 0, 'toc=' + tocCount);

    const errs = b.consoleErrors();
    check('页面无控制台报错', errs.length === 0, errs.slice(0, 3).join(' | '));

    /* ============ 2. 章节完整 ============ */
    console.log('\n[2] 章节完整性');
    const secIds = await b.eval(
      `Array.from(document.querySelectorAll('section.sec')).map((s) => s.id)`
    );
    check('共 11 个章节', secIds.length === 11, 'count=' + secIds.length);
    for (const id of SECTIONS) {
      check(`章节 #${id} 存在`, secIds.includes(id));
    }
    check('目录链接数与章节数一致', tocCount === 11, `toc=${tocCount} sec=11`);

    /* ============ 3. 无脏值 ============ */
    console.log('\n[3] 无脏值泄漏');
    // 只查可见正文，忽略 <script>/<style>
    const dirty = await b.eval(`(() => {
      const bad = [];
      const walker = document.createTreeWalker(
        document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) => {
            const p = n.parentElement;
            if (!p) return NodeFilter.FILTER_REJECT;
            const tag = p.tagName.toLowerCase();
            if (tag === 'script' || tag === 'style') return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        });
      let n;
      while ((n = walker.nextNode())) {
        const t = n.nodeValue || '';
        const m = t.match(/undefined|NaN|\\[object Object\\]/);
        if (m) bad.push((m[0]) + ' @ ' + (n.parentElement.className || n.parentElement.tagName));
      }
      return bad.slice(0, 8);
    })()`);
    check('页面文字里没有 undefined / NaN / [object Object]',
      dirty.length === 0, dirty.join(' | '));

    /* ============ 4. 色板与现算对比度 ============ */
    console.log('\n[4] 色板与现算对比度');
    //
    // 色板卡有三种，显示的比值是**不同的问题**，混着算必然误报：
    //
    //   ① 文字色板（语义色的 -fill，6 张）：chip 里写着「示例文字」。
    //      比值 = 该文字色 对 自家填充底 → 大字标准 3:1。
    //
    //   ② 配对色板（-text / -on-soft / 中性面 / 描边，25 张）：chip 里没有文字，
    //      写的是比值本身，文本里带「（对 --xxx）」。比值 = 该色 对 它声明的承托面。
    //      承托面各不相同 —— 文字色对最暗的嵌入块（最不利面），
    //      描边对页面底，中性面彼此相邻比。所以基准面必须从卡片上读，不能猜。
    //
    //   ③ 纯背景色板（语义色的 -soft，6 张）：不给比值，标记为装饰豁免。
    //
    // 下面按 chip 里到底写了什么来分流 ①②，再各自用独立公式复核。
    // ③ 没有比值，自然落在外面。
    const swatches = await b.eval(`(() => {
      const cs = getComputedStyle(document.documentElement);
      const resolve = (t) => (t ? cs.getPropertyValue(t).trim() : '');
      return Array.from(document.querySelectorAll('[data-token]')).map((el) => {
        const chip = el.querySelector('.sw__chip');
        const ratioEl = el.querySelector('.sw__ratio');
        const text = ratioEl ? ratioEl.textContent.trim() : '';
        const m = text.match(/^([\\d.]+):1/);
        const against = (text.match(/（对\\s*(--[\\w-]+)）/) || [])[1] || null;
        const token = el.getAttribute('data-token');
        return {
          token,
          chipText: chip ? chip.textContent.trim() : '',
          bg: chip ? getComputedStyle(chip).backgroundColor : null,
          color: chip ? getComputedStyle(chip).color : null,
          text,
          ratio: m ? Number(m[1]) : null,
          against,
          againstVal: resolve(against),
          tokenVal: resolve(token),
        };
      });
    })()`);
    check('色板卡片已渲染（≥ 20 个）', swatches.length >= 20, 'count=' + swatches.length);

    const withRatio = swatches.filter((s) => s.ratio !== null && !Number.isNaN(s.ratio));
    check('多数色板带现算对比度值', withRatio.length >= swatches.length * 0.6,
      `${withRatio.length}/${swatches.length}`);

    // 分流
    const textSwatches = withRatio.filter((s) => s.chipText === '示例文字');
    const surfaceSwatches = withRatio.filter((s) => s.chipText !== '示例文字');

    // 文字色板：独立复算「文字色 on 承托面」
    let mismatches = [];
    for (const s of textSwatches) {
      if (!s.color || !s.bg) continue;
      const expected = contrastRatio(s.color, s.bg);
      if (Math.abs(expected - s.ratio) > 0.06) {
        mismatches.push(`${s.token}: 页面 ${s.ratio} vs 独立 ${expected.toFixed(2)} (${s.color} on ${s.bg})`);
      }
    }
    check('文字色板数量合理（≥ 5，当前 6 个 -fill）',
      textSwatches.length >= 5, 'count=' + textSwatches.length);
    check('文字色板：现算对比度与独立公式一致（容差 0.06）',
      mismatches.length === 0, mismatches.slice(0, 3).join(' | '));

    // 面色板 / 配对色板：独立复算「该色 vs 它声明承托的那个面」
    let surfMismatch = [];
    for (const s of surfaceSwatches) {
      if (!s.tokenVal || !s.againstVal) continue;
      const expected = contrastRatio(s.tokenVal, s.againstVal);
      if (Math.abs(expected - s.ratio) > 0.06) {
        surfMismatch.push(`${s.token} vs ${s.against}: 页面 ${s.ratio} vs 独立 ${expected.toFixed(2)}`);
      }
    }
    check('配对色板数量合理（≥ 20）',
      surfaceSwatches.length >= 20, 'count=' + surfaceSwatches.length);
    check('配对色板：现算对比度与独立公式一致（容差 0.06）',
      surfMismatch.length === 0, surfMismatch.slice(0, 3).join(' | '));

    // 每个配对色板都必须声明「对谁」—— 没有 against 就没法复核，等于没验
    const noAgainst = surfaceSwatches.filter((s) => !s.against || !s.againstVal);
    check('配对色板都声明了对比基准面', noAgainst.length === 0,
      noAgainst.map((s) => s.token).join(', '));

    // 两类合起来必须覆盖全部带比值的色板 —— 防止出现「既不认作文字也不认作面」的漏网卡片
    check('每张带比值的色板都被归入某一类',
      textSwatches.length + surfaceSwatches.length === withRatio.length,
      `${textSwatches.length} + ${surfaceSwatches.length} vs ${withRatio.length}`);

    const fails = swatches.filter((s) => s.text.includes('不达标'));
    check('色板中没有「不达标」判定', fails.length === 0,
      fails.map((f) => f.token).join(', '));

    // chip 自己那行标签也必须读得出来。
    // 这是规范页最容易自我打脸的地方：一个专门讲对比度的页面，
    // 色板里 15 张卡的标签却印在同色底上（--ink 那张是 1:1，字完全消失）。
    // 检查方式是取 chip 的**计算后**前景/背景色，用本脚本的独立公式算。
    const chipContrast = await b.eval(`(() => {
      return Array.from(document.querySelectorAll('[data-token]')).map((el) => {
        const chip = el.querySelector('.sw__chip');
        if (!chip) return null;
        const t = chip.textContent.trim();
        if (!t) return null;   // 纯背景色板没有标签，不适用
        const cs = getComputedStyle(chip);
        return { token: el.getAttribute('data-token'), label: t, color: cs.color, bg: cs.backgroundColor };
      }).filter(Boolean);
    })()`);
    check('色板 chip 标签数量合理（≥ 25）', chipContrast.length >= 25,
      'count=' + chipContrast.length);
    const unreadable = chipContrast
      .map((c) => ({ ...c, r: contrastRatio(c.color, c.bg) }))
      .filter((c) => c.r < 3);
    check('每张色板的 chip 标签对自己底色 ≥ 3:1',
      unreadable.length === 0,
      unreadable.map((u) => `${u.token} ${u.r.toFixed(2)}:1`).join(', '));

    /* ============ 5. 各章节确实有内容 ============ */
    console.log('\n[5] 各章节挂载点非空');
    // 这些 id 是 spec.js 的挂载点。id 对不上 → 内容静默消失，
    // 页面不报错、只是空着 —— 所以必须逐个点名验。
    const MOUNTS = {
      'sw-surfaces': '中性面色板',
      'sw-text': '文字色板',
      'semantic-blocks': '语义色块',
      'sw-lines': '描边色板',
      'typescale': '字阶',
      'spacing': '间距',
      'icon-grid': '图标网格',
      'component-blocks': '组件演示',
      'page-blocks': '页面预览',
    };
    const mounts = await b.eval(`(() => {
      const ids = ${JSON.stringify(Object.keys(MOUNTS))};
      const out = {};
      for (const id of ids) {
        const el = document.getElementById(id);
        out[id] = el ? el.children.length : -1;
      }
      return out;
    })()`);
    for (const [id, label] of Object.entries(MOUNTS)) {
      const n = mounts[id];
      check(`${label} 已渲染（#${id}）`, n > 0, n === -1 ? '挂载点不存在' : 'children=' + n);
    }

    // 所有 <tbody id="..."> 都该被填满。空表格不会报错，
    // 但会让人以为「这个规范还没写」—— 所以逐个查行数。
    const emptyTbodies = await b.eval(`(() => {
      return Array.from(document.querySelectorAll('tbody[id]'))
        .filter((t) => t.children.length === 0)
        .map((t) => t.id);
    })()`);
    check('所有表格挂载点都有数据行', emptyTbodies.length === 0,
      emptyTbodies.length ? '空表：' + emptyTbodies.join(', ') : '');

    const typeRows = await b.eval(`(() => ({
      scale: document.querySelectorAll('#typescale .ts-row').length,
      weights: document.querySelectorAll('#weights tr').length,
      lineheights: document.querySelectorAll('#lineheights tr').length,
      letterspacings: document.querySelectorAll('#letterspacings tr').length,
      spacings: document.querySelectorAll('#spacing .space-row').length,
      zindex: document.querySelectorAll('#zindex tr').length,
      durations: document.querySelectorAll('#durations tr').length,
      easings: document.querySelectorAll('#easings [data-ease-demo]').length,
      radii: document.querySelectorAll('#radii .radius-demo').length,
      shadows: document.querySelectorAll('#shadows .shadow-demo').length,
    }))()`);
    // 期望值来自 spec.js 的常量定义，改动令牌时这里要同步 —— 这正是它的价值
    check('字阶 8 档已渲染', typeRows.scale === 8, 'scale=' + typeRows.scale);
    check('字重 3 档已渲染', typeRows.weights === 3, 'weights=' + typeRows.weights);
    check('行高 4 档已渲染', typeRows.lineheights === 4, 'lineheights=' + typeRows.lineheights);
    check('字距 3 档已渲染', typeRows.letterspacings === 3, 'ls=' + typeRows.letterspacings);
    check('间距 9 档已渲染', typeRows.spacings === 9, 'spacings=' + typeRows.spacings);
    check('圆角 6 档已渲染', typeRows.radii === 6, 'radii=' + typeRows.radii);
    check('阴影 4 档已渲染', typeRows.shadows === 4, 'shadows=' + typeRows.shadows);
    check('缓动 4 档已渲染', typeRows.easings === 4, 'easings=' + typeRows.easings);
    check('层级 5 档已渲染', typeRows.zindex === 5, 'zindex=' + typeRows.zindex);
    check('动效时长 3 档已渲染', typeRows.durations === 3, 'durations=' + typeRows.durations);

    const iconCount = await b.eval(`document.querySelectorAll('#icon-grid svg').length`);
    check('图标网格渲染了 SVG（≥ 40）', iconCount >= 40, 'icons=' + iconCount);

    // 用户习惯与可访问性两章：条目数必须等于数据条数
    const habits = await b.eval(`document.querySelectorAll('#habit-rows tr').length`);
    check('用户习惯条目已渲染（8 条）', habits === 8, 'habits=' + habits);
    const a11yRows = await b.eval(`document.querySelectorAll('#a11y-rows tr').length`);
    check('可访问性检查项已渲染（> 0）', a11yRows > 0, 'a11y=' + a11yRows);

    /* ============ 6. 组件是真的组件 ============ */
    console.log('\n[6] 组件演示区');
    const comp = await b.eval(`(() => {
      const c = document.getElementById('component-blocks');
      if (!c) return null;
      return {
        stat: c.querySelectorAll('.stat').length,
        chip: c.querySelectorAll('.chip').length,
        btn: c.querySelectorAll('.btn').length,
        chartSvg: c.querySelectorAll('svg.chart, svg').length,
        meter: c.querySelectorAll('.meter').length,
        techRow: c.querySelectorAll('.tech-row').length,
        list: c.querySelectorAll('.list').length,
        notice: c.querySelectorAll('.notice').length,
        aiBlock: c.querySelectorAll('.ai-block').length,
        score: c.querySelectorAll('.score').length,
        mkt: c.querySelectorAll('.mkt').length,
      };
    })()`);
    check('组件区存在挂载点', comp !== null);
    check('渲染了指标卡（4 张）', comp && comp.stat === 4, 'stat=' + (comp && comp.stat));
    check('渲染了胶囊', comp && comp.chip > 0, 'chip=' + (comp && comp.chip));
    check('渲染了按钮', comp && comp.btn > 0, 'btn=' + (comp && comp.btn));
    check('渲染了图表 SVG', comp && comp.chartSvg > 0, 'svg=' + (comp && comp.chartSvg));
    check('渲染了分布条（进度 3 + 板块 5）', comp && comp.meter === 8, 'meter=' + (comp && comp.meter));
    check('渲染了技术指标行 5 条', comp && comp.techRow === 5, 'techRow=' + (comp && comp.techRow));
    check('渲染了提示条', comp && comp.notice > 0, 'notice=' + (comp && comp.notice));
    check('渲染了 AI 结论块', comp && comp.aiBlock > 0, 'aiBlock=' + (comp && comp.aiBlock));
    check('渲染了评分徽标', comp && comp.score > 0, 'score=' + (comp && comp.score));
    // 市场徽标不只出现在「市场徽标」那个演示块里 ——
    // 个股行、账户卡也会带，所以这里只要求「至少 3 个」而不是恰好 3 个。
    check('渲染了市场徽标（≥ 3）', comp && comp.mkt >= 3, 'mkt=' + (comp && comp.mkt));

    /* ============ 7. 页面预览 iframe ============ */
    console.log('\n[7] 页面预览');
    // iframe 是 loading="lazy"，且位置在页面靠下 —— 不滚过去它们根本不会加载，
    // 里面自然是空的。所以先滚到页面章节，再轮询等应用启动。
    await b.eval(`document.getElementById('pages').scrollIntoView()`);
    let frameBooted = 0;
    for (let i = 0; i < 60; i++) {
      frameBooted = await b.eval(`(() => {
        let n = 0;
        for (const f of document.querySelectorAll('#page-blocks iframe')) {
          try {
            if (f.contentDocument && f.contentDocument.querySelectorAll('.tabbar__item').length) n++;
          } catch (e) { /* 跨域忽略 */ }
        }
        return n;
      })()`);
      if (frameBooted === 4) break;
      await sleep(150);
    }
    check('4 个预览框内部都渲染出了应用', frameBooted === 4, `${frameBooted}/4`);

    const frames = await b.eval(`(() => {
      const root = document.getElementById('page-blocks');
      return Array.from(root ? root.querySelectorAll('iframe') : []).map((f) => {
        let title = '';
        try { title = f.contentDocument?.querySelector('.page-head__title')?.textContent.trim() || ''; } catch (e) {}
        return { src: f.getAttribute('src') || '', h: f.clientHeight, title };
      });
    })()`);
    check('页面章节有 4 个预览框', frames.length === 4, 'count=' + frames.length);
    check('预览框都有 src', frames.every((f) => f.src), JSON.stringify(frames.map((f) => f.src)));
    check('预览框有可见高度', frames.every((f) => f.h > 100), JSON.stringify(frames.map((f) => f.h)));
    check('4 个预览框分别落在不同路由',
      new Set(frames.map((f) => f.src)).size === 4,
      JSON.stringify(frames.map((f) => f.src)));
    check('预览框内部标题非空', frames.every((f) => f.title),
      JSON.stringify(frames.map((f) => f.title)));

    /* ============ 8. 主题切换 ============ */
    console.log('\n[8] 主题切换');
    const before = await b.eval(
      `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`
    );
    await b.eval(`document.querySelector('[data-theme-set="dark"]').click()`);
    await sleep(300);
    const after = await b.eval(`(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
      pressed: document.querySelector('[data-theme-set="dark"]').getAttribute('aria-pressed'),
    }))()`);
    check('切深色后 data-theme=dark', after.theme === 'dark', String(after.theme));
    check('切深色后 --bg 真的变了', after.bg !== before && !!after.bg, `${before} → ${after.bg}`);
    check('深色按钮 aria-pressed=true', after.pressed === 'true', String(after.pressed));

    const darkFails = await b.eval(`(() => {
      return Array.from(document.querySelectorAll('.sw__ratio'))
        .map((e) => e.textContent.trim())
        .filter((t) => t.includes('不达标'));
    })()`);
    check('深色下没有「不达标」判定', darkFails.length === 0, darkFails.slice(0, 3).join(' | '));

    // 深色下 chip 标签同样要可读 —— 浅色过、深色挂是最常见的情况，
    // 因为标签色往往只按浅色主题挑。
    const darkChip = await b.eval(`(() => {
      return Array.from(document.querySelectorAll('[data-token]')).map((el) => {
        const chip = el.querySelector('.sw__chip');
        if (!chip) return null;
        const t = chip.textContent.trim();
        if (!t) return null;
        const cs = getComputedStyle(chip);
        return { token: el.getAttribute('data-token'), color: cs.color, bg: cs.backgroundColor };
      }).filter(Boolean);
    })()`);
    const darkUnreadable = darkChip
      .map((c) => ({ ...c, r: contrastRatio(c.color, c.bg) }))
      .filter((c) => c.r < 3);
    check('深色下每张色板的 chip 标签仍 ≥ 3:1',
      darkUnreadable.length === 0,
      darkUnreadable.map((u) => `${u.token} ${u.r.toFixed(2)}:1`).join(', '));

    const darkSwatchBg = await b.eval(`(() => {
      const el = document.querySelector('[data-token="--surface"] .sw__chip');
      return el ? getComputedStyle(el).backgroundColor : '';
    })()`);
    check('深色下色板跟着换（--surface 变暗）',
      darkSwatchBg && toRgb(darkSwatchBg).reduce((a, c) => a + c, 0) < 300, darkSwatchBg);

    await b.eval(`document.querySelector('[data-theme-set="light"]').click()`);
    await sleep(300);
    const backLight = await b.eval(
      `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`
    );
    check('切回浅色', backLight === before, `${backLight} vs ${before}`);

    /* ============ 9. 无横向溢出 ============ */
    console.log('\n[9] 布局');
    const overflow = await b.eval(`(() => ({
      docW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
      wide: Array.from(document.querySelectorAll('body *'))
        .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 2)
        .slice(0, 5)
        .map((e) => (e.className || e.tagName) + ' @' + Math.round(e.getBoundingClientRect().right)),
    }))()`);
    check('页面没有横向溢出',
      overflow.docW <= overflow.winW + 2,
      `doc=${overflow.docW} win=${overflow.winW} ${overflow.wide.join(', ')}`);

    /* ============ 截图 ============ */
    // 截图前必须显式滚到目标位置 —— 前面几节把页面滚到过 #pages，
    // 不重置的话「首屏」截图拍到的其实是页面章节。
    const shotAt = async (id, file) => {
      if (id) {
        await b.eval(`document.getElementById(${JSON.stringify(id)}).scrollIntoView()`);
      } else {
        await b.eval(`window.scrollTo(0, 0)`);
      }
      await sleep(400);
      await b.shot(path.join(SHOTS, file));
    };
    await shotAt(null, 'design-spec-top.png');
    await shotAt('color', 'design-spec-color.png');
    await shotAt('type', 'design-spec-type.png');
    await shotAt('components', 'design-spec-components.png');
    await shotAt('pages', 'design-spec-pages.png');
    console.log('\n截图已写入 docs/screenshots/');

    /* ============ 10. Service Worker 不能把外壳缓存投毒 ============ */
    console.log('\n[10] Service Worker 与离线外壳');
    //
    // 这里验的是一个很容易被忽略的耦合：
    // 站点原本只有 index.html，SW 的导航分支就顺手把**任何**导航响应
    // 都写回 './index.html' 这个固定键。多出 /design/index.html 之后，
    // 只要访问一次规范页，离线外壳就被换成了规范页 ——
    // 之后断网打开应用，看到的是设计规范而不是应用。
    //
    // 缓存被投毒时页面不会报错、不会变慢，只是「离线时打开了错的页面」，
    // 所以必须专门测。
    await b.goto(BASE + '/');
    // 等 SW 真正接管当前页（skipWaiting + clients.claim 之后）
    let controlled = false;
    for (let i = 0; i < 60; i++) {
      controlled = await b.eval(`!!navigator.serviceWorker.controller`);
      if (controlled) break;
      await sleep(150);
    }
    check('SW 已接管页面', controlled === true);

    // 关键一步：访问规范页（受 SW 接管的导航）
    await b.goto(BASE + '/design/index.html');
    await sleep(600);

    const cacheState = await b.eval(`(async () => {
      const shellUrl = new URL('/index.html', location.href).href;
      const keys = await caches.keys();
      const c = await caches.open(keys[0]);
      const shell = await c.match(shellUrl);
      const shellText = shell ? await shell.text() : '';
      const designUrl = new URL('/design/index.html', location.href).href;
      const design = await c.match(designUrl);
      const designText = design ? await design.text() : '';
      return {
        cacheKeys: keys,
        hasShell: !!shell,
        shellIsApp: /id="app"|tabbar/.test(shellText),
        shellIsDesign: /spec-toc/.test(shellText),
        shellLen: shellText.length,
        hasDesign: !!design,
        designIsDesign: /spec-toc/.test(designText),
      };
    })()`);

    check('缓存里存在应用外壳', cacheState.hasShell === true,
      JSON.stringify(cacheState.cacheKeys));
    check('访问规范页后，离线外壳仍是应用（未被投毒）',
      cacheState.shellIsApp === true && cacheState.shellIsDesign === false,
      `isApp=${cacheState.shellIsApp} isDesign=${cacheState.shellIsDesign} len=${cacheState.shellLen}`);
    check('规范页按自己的 URL 单独入缓存',
      cacheState.hasDesign === true && cacheState.designIsDesign === true,
      `hasDesign=${cacheState.hasDesign} isDesign=${cacheState.designIsDesign}`);
  } finally {
    await b.close();
  }

  finish('设计规范页验证');
}

main().catch((err) => {
  console.error('\n运行失败：' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
