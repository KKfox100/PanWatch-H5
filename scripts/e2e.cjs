'use strict';

/**
 * 端到端验证（真实 Chrome，零依赖）
 * ------------------------------------------------------------------
 *   node scripts/serve.mjs &        # 先起本地服务
 *   node scripts/e2e.cjs            # 再跑这个
 *
 * 覆盖：首屏渲染、七个页面路由、莫兰迪令牌、涨红跌绿、主题切换、
 *       提醒开关、筛选、弹层开合与动态增删条件、底部导航可见性、
 *       控制台零报错。同时输出移动端截图。
 *
 * 两个必须注意的坑：
 *   ① 哈希路由**不会**触发 load 事件，所以切页不能用 Page.navigate，
 *      否则必然「页面加载超时」。要用 location.hash + 轮询目标标题。
 *   ② 等 load 事件不等于样式表生效，量 --bg 才作数（见 waitStyled）。
 */

const path = require('path');
const fs = require('fs');
const { launch, createChecker, sleep } = require('./cdp-client.cjs');

const BASE = process.env.BASE || 'http://127.0.0.1:5183';
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots');

const { check, failures, finish } = createChecker();

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** 等样式表真正生效：--bg 解析出来才算数 */
async function waitStyled(b) {
  for (let i = 0; i < 60; i++) {
    const v = await b.eval(
      `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`
    );
    if (v) return v;
    await sleep(100);
  }
  throw new Error('样式表始终没生效（--bg 为空）');
}

/** 冻结动画，避免量到过渡中间态 */
async function freeze(b) {
  await b.eval(`(() => {
    if (document.getElementById('e2e-freeze')) return true;
    const s = document.createElement('style');
    s.id = 'e2e-freeze';
    s.textContent = '*{transition:none !important;animation:none !important}';
    document.head.appendChild(s);
    return true;
  })()`);
}

/** '#rrggbb' 或 'rgb(...)' → [r,g,b]，按十六进制解析 */
function toRgb(input) {
  const s = String(input).trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }
  return (s.match(/\d+/g) || []).slice(0, 3).map(Number);
}

/** 饱和度代理：最大通道 − 最小通道 */
const chroma = (input) => {
  const v = toRgb(input);
  return Math.max(...v) - Math.min(...v);
};

/** 相对亮度（WCAG） */
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

/** 首次真导航（会触发 load），之后一律走哈希 */
async function openApp(b) {
  await b.goto(BASE + '/');
  await waitStyled(b);
  await freeze(b);
}

/** 切页：改 hash + 轮询到目标标题出现 */
async function navTo(b, key, expectTitle) {
  await b.eval(`(() => { location.hash = ${JSON.stringify('#/' + key)}; return true; })()`);
  let title = '';
  for (let i = 0; i < 60; i++) {
    title = await b.eval(
      `document.querySelector('.page-head__title')?.textContent.trim() || ''`
    );
    if (!expectTitle || title === expectTitle) break;
    await sleep(70);
  }
  await freeze(b);
  return title;
}

/** 轮询某个选择器出现 */
async function waitFor(b, expr, label) {
  for (let i = 0; i < 60; i++) {
    if (await b.eval(expr)) return true;
    await sleep(70);
  }
  throw new Error('等待超时：' + label);
}

/**
 * 真正的整页刷新。
 * 不能用 Page.navigate 到「当前同一个 URL」—— 那不会触发 load 事件，
 * 只会等到超时，而看起来像应用挂了。
 */
async function reload(b) {
  b.events = [];
  await b.send('Page.reload', { ignoreCache: false });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (b.events.some((e) => e.method === 'Page.loadEventFired')) return;
    await sleep(60);
  }
  throw new Error('整页刷新超时');
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await launch({ width: 390, height: 844 });

  try {
    await b.setMobile(390, 844);

    /* ============ 1. 首屏 ============ */
    console.log('\n[1] 首屏与设计令牌');
    await openApp(b);

    const bg = await b.eval(
      `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`
    );
    check('莫兰迪底色令牌已生效（--bg = #efece6）', bg.toLowerCase() === '#efece6', bg);

    const brand = await b.eval(`document.querySelector('.brand__name')?.textContent || ''`);
    check('品牌名渲染为「盯盘侠」', brand === '盯盘侠', brand);

    const tabs = await b.eval(
      `Array.from(document.querySelectorAll('.tabbar__item')).map(e => e.textContent.trim())`
    );
    check('底部导航 5 个入口', tabs.length === 5, JSON.stringify(tabs));
    check('导航项文案正确',
      JSON.stringify(tabs) === JSON.stringify(['首页', '持仓', '机会', '模拟盘', '提醒']),
      JSON.stringify(tabs));

    const statCount = await b.eval(`document.querySelectorAll('.stat').length`);
    check('首页指标卡已渲染', statCount >= 2, 'count=' + statCount);

    const newsCount = await b.eval(`document.querySelectorAll('.news').length`);
    check('快讯列表已渲染 6 条', newsCount === 6, 'count=' + newsCount);

    const idxCount = await b.eval(`document.querySelectorAll('.index-card').length`);
    check('指数横条已渲染 6 个', idxCount === 6, 'count=' + idxCount);

    const navVis = await b.eval(`(() => {
      const r = document.querySelector('.tabbar').getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
    })()`);
    check('底部导航在首屏视口内可见',
      navVis.top < navVis.vh && navVis.bottom > 0,
      JSON.stringify(navVis));

    /* ============ 2. 莫兰迪语义色 ============ */
    console.log('\n[2] 莫兰迪配色与涨跌语义');
    // 注意：v2 令牌按「角色」拆开了。填充用 -fill，当文字用 -text。
    // 这里取 -fill 做色相判断（色相与 -text 一致），取 -text 验证文字着色。
    const palette = await b.eval(`(() => {
      const cs = getComputedStyle(document.documentElement);
      const g = (n) => cs.getPropertyValue(n).trim();
      return { bg: g('--bg'), surface: g('--surface'), ink: g('--ink'),
               up: g('--up-fill'), down: g('--down-fill'), accent: g('--accent-fill'),
               rose: g('--morandi-rose'), sage: g('--morandi-sage') };
    })()`);

    check('强调色与涨跌色都是低饱和（莫兰迪特征）',
      ['up', 'down', 'accent'].every((k) => chroma(palette[k]) <= 90),
      JSON.stringify({
        up: chroma(palette.up), down: chroma(palette.down), accent: chroma(palette.accent),
      }));

    const upRgb = toRgb(palette.up);
    const downRgb = toRgb(palette.down);
    check('涨色偏红（中国市场习惯：涨红）',
      upRgb[0] > upRgb[1] && upRgb[0] > upRgb[2], `${palette.up} → rgb(${upRgb})`);
    check('跌色偏绿（中国市场习惯：跌绿）',
      downRgb[1] > downRgb[0] && downRgb[1] > downRgb[2], `${palette.down} → rgb(${downRgb})`);

    const inkRgb = toRgb(palette.ink);
    check('正文用暖炭灰而非纯黑（非 #000）',
      Math.min(...inkRgb) > 30, `${palette.ink} → rgb(${inkRgb})`);

    const lightContrast = contrastRatio(palette.ink, palette.bg);
    check('浅色模式正文对比度 ≥ 4.5:1',
      lightContrast >= 4.5, lightContrast.toFixed(2) + ':1');

    // 实际渲染出来的涨跌元素是否套上了对应颜色
    const applied = await b.eval(`(() => {
      const upEl = document.querySelector('.index-card__pct.up');
      const downEl = document.querySelector('.index-card__pct.down');
      const cs = getComputedStyle(document.documentElement);
      return {
        up: upEl ? getComputedStyle(upEl).color : null,
        down: downEl ? getComputedStyle(downEl).color : null,
        upVar: cs.getPropertyValue('--up-text').trim(),
        downVar: cs.getPropertyValue('--down-text').trim(),
      };
    })()`);
    check('指数卡上真实存在涨/跌着色元素',
      !!applied.up && !!applied.down, JSON.stringify(applied));
    check('涨色元素用的是 --up-text 角色',
      applied.up && applied.upVar &&
      toRgb(applied.up).join() === toRgb(applied.upVar).join(),
      `${applied.up} vs ${applied.upVar}`);
    check('跌色元素用的是 --down-text 角色',
      applied.down && applied.downVar &&
      toRgb(applied.down).join() === toRgb(applied.downVar).join(),
      `${applied.down} vs ${applied.downVar}`);

    /* v2 的核心承诺：渲染出来的文字，对比度必须真的达标。
       只验令牌不够 —— 令牌对了但组件用错角色，用户看到的还是糊的。
       下面挑几处上一版真实翻车的地方，按实际渲染的颜色算。

       注意：主按钮不在首页。首页只有指标卡和快讯，没有 .btn--primary；
       持仓页的主按钮也只在「关注」页签下才渲染（持仓页签换成了 ghost 折叠按钮）。
       所以主按钮单独去个股详情页取 —— 那里的三个主按钮是无条件渲染的。 */
    const pickExpr = `(sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      // 往上找第一个不透明的背景色，作为实际承托面
      let n = el, bg = 'rgba(0, 0, 0, 0)';
      while (n && (bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent')) {
        bg = getComputedStyle(n).backgroundColor;
        n = n.parentElement;
      }
      return { color: cs.color, bg, sel };
    }`;

    const rendered = await b.eval(`(() => {
      const pick = ${pickExpr};
      return {
        tab: pick('.tabbar__item:not([aria-current="page"])'),
        tabActive: pick('.tabbar__item[aria-current="page"]'),
        statLabel: pick('.stat__label'),
      };
    })()`);

    const renderChecks = [
      ['底栏未选中标签（上一版 2.71:1 不达标）', rendered.tab],
      ['底栏选中标签', rendered.tabActive],
      ['指标卡标签（上一版 2.77:1 不达标）', rendered.statLabel],
    ];
    for (const [label, r] of renderChecks) {
      if (!r) { check(label, false, '元素未找到'); continue; }
      const cr = contrastRatio(r.color, r.bg);
      check(`${label} 渲染对比度 ≥ 4.5:1`, cr >= 4.5,
        `${r.color} on ${r.bg} = ${cr.toFixed(2)}:1`);
    }

    // 主按钮：切到个股详情页再取
    await b.eval(`(() => { location.hash = '#/stock/688256'; return true; })()`);
    await waitFor(b, `!!document.querySelector('.btn--primary')`, '个股页主按钮渲染');
    const primary = await b.eval(`(() => {
      const pick = ${pickExpr};
      return pick('.btn--primary');
    })()`);
    if (!primary) {
      check('主按钮文字（上一版 3.05:1 不达标）', false, '个股页未找到 .btn--primary');
    } else {
      const cr = contrastRatio(primary.color, primary.bg);
      check('主按钮文字（上一版 3.05:1 不达标）渲染对比度 ≥ 4.5:1', cr >= 4.5,
        `${primary.color} on ${primary.bg} = ${cr.toFixed(2)}:1`);
    }

    /* ============ 3. 路由 ============ */
    console.log('\n[3] 七个页面路由');
    const routes = [
      ['portfolio', '持仓'],
      ['opportunities', '机会'],
      ['paper', '模拟盘'],
      ['alerts', '提醒'],
      ['settings', '设置'],
      ['home', '今日概览'],
    ];
    for (const [key, expect] of routes) {
      const title = await navTo(b, key, expect);
      check(`#/${key} 渲染出「${expect}」`, title === expect, title);
    }

    /* ============ 4. 持仓页 ============ */
    console.log('\n[4] 持仓页数据与汇总自洽');
    await navTo(b, 'portfolio', '持仓');

    const p = await b.eval(`(() => ({
      cards: document.querySelectorAll('.stat').length,
      accounts: document.querySelectorAll('.account').length,
      rows: document.querySelectorAll('.stock').length,
      totalTxt: document.querySelector('.card--pad .num')?.textContent.trim() || '',
      segs: Array.from(document.querySelectorAll('.segmented__btn')).map(e => e.textContent.trim()),
      splits: Array.from(document.querySelectorAll('.card--pad span'))
        .map(e => e.textContent.trim())
        .filter(t => t.includes('持仓市值') || t.includes('现金')),
      ratio: (document.querySelector('.card--pad .bar__fill')?.style.width) || '',
    }))()`);
    check('持仓页 4 张汇总卡', p.cards === 4, 'count=' + p.cards);
    check('渲染 2 个券商账户分组', p.accounts === 2, 'count=' + p.accounts);
    check('持仓行数量 = 8 + 5 = 13', p.rows === 13, 'count=' + p.rows);
    check('持仓/关注分段控件存在',
      p.segs.length === 2 && p.segs[0].startsWith('持仓') && p.segs[1].startsWith('关注'),
      JSON.stringify(p.segs));
    check('总资产显示为「万」量级', /万/.test(p.totalTxt), p.totalTxt);
    check('给出市值/现金拆分', p.splits.length === 2, JSON.stringify(p.splits));
    check('仓位占比进度条有宽度', /%$/.test(p.ratio), p.ratio);

    // 半宽卡片里文字一旦折行就会显得很挤，这里锁住「不折行」
    const overflow = await b.eval(`(() => {
      const bad = [];
      document.querySelectorAll('.stat').forEach((card) => {
        const chip = card.querySelector('.stat__delta');
        if (chip && chip.getClientRects().length > 1) {
          bad.push('delta:' + chip.textContent.trim());
        }
        const v = card.querySelector('.stat__value');
        if (v && v.scrollWidth > v.clientWidth + 1) bad.push('value:' + v.textContent.trim());
        // 拆分的底部信息：每个片段必须独占一个行盒（不能词内断行）
        card.querySelectorAll('.stat__foot--split > span').forEach((s) => {
          if (s.getClientRects().length > 1) bad.push('foot:' + s.textContent.trim());
        });
      });
      return bad;
    })()`);
    check('汇总卡内的数值、涨跌徽标与底部信息都不折行',
      overflow.length === 0, JSON.stringify(overflow));

    // 市值走势图必须是中性强调色，不能是红/绿（否则和盈亏数字自相矛盾）
    const sparkColor = await b.eval(`(() => {
      const card = Array.from(document.querySelectorAll('.stat'))
        .find(c => c.textContent.includes('总市值'));
      const p = card?.querySelector('.stat__spark path[stroke]');
      return p ? p.getAttribute('stroke') : null;
    })()`);
    check('总市值走势图用中性强调色（非涨跌红绿）',
      sparkColor === 'var(--accent-fill)', String(sparkColor));

    // 汇总卡数字与账户明细求和不矛盾
    const sum = await b.eval(`(() => {
      const num = (s) => {
        const m = String(s).match(/-?[\\d.]+/);
        return m ? Number(m[0]) : 0;
      };
      const accts = Array.from(document.querySelectorAll('.account'));
      const mvSum = accts.reduce((a, el) => a + num(el.querySelectorAll('.account__sum dd')[0].textContent), 0);
      const cardMv = num(document.querySelectorAll('.stat__value')[0].textContent);
      return { mvSum: Number(mvSum.toFixed(2)), cardMv: Number(cardMv.toFixed(2)) };
    })()`);
    check('账户市值之和 = 汇总卡总市值（±0.02 万）',
      Math.abs(sum.mvSum - sum.cardMv) <= 0.02,
      JSON.stringify(sum));

    await b.eval(`Array.from(document.querySelectorAll('.segmented__btn')).find(e => e.textContent.includes('关注')).click()`);
    await sleep(200);
    await freeze(b);
    const watchRows = await b.eval(`document.querySelectorAll('.stock').length`);
    check('切到关注 tab 后渲染 10 只', watchRows === 10, 'count=' + watchRows);

    await b.eval(`document.querySelector('[data-filter-market="us"]').click()`);
    await sleep(200);
    await freeze(b);
    const usRows = await b.eval(`document.querySelectorAll('.stock').length`);
    check('筛选「美股」后只剩 3 只', usRows === 3, 'count=' + usRows);

    await b.eval(`document.querySelector('[data-filter-market="all"]').click()`);
    await sleep(150);
    await b.eval(`Array.from(document.querySelectorAll('.segmented__btn')).find(e => e.textContent.includes('持仓')).click()`);
    await sleep(200);
    await freeze(b);
    await b.shot(path.join(SHOTS, 'h5-portfolio.png'));

    /* ============ 5. 个股详情 ============ */
    console.log('\n[5] 个股详情与图表');
    await b.eval(`document.querySelector('.stock[data-stock="688256"]').click()`);
    await waitFor(b, `!!document.querySelector('.hero__name')`, '个股详情渲染');
    await freeze(b);

    const detail = await b.eval(`(() => ({
      hash: location.hash,
      name: document.querySelector('.hero__name')?.textContent.trim() || '',
      price: document.querySelector('.hero__price')?.textContent.trim() || '',
      chg: document.querySelector('.hero__chg')?.textContent.trim() || '',
      kline: !!document.querySelector('.chart-wrap svg'),
      tabs: Array.from(document.querySelectorAll('.tabs__btn')).map(e => e.textContent.trim()),
      kv: document.querySelectorAll('.kv').length,
      pnl: !!document.querySelector('.pnl-banner'),
    }))()`);
    check('路由跳到 #/stock/688256', detail.hash === '#/stock/688256', detail.hash);
    check('详情页标题为寒武纪-U', detail.name === '寒武纪-U', detail.name);
    check('价格渲染为 1,587.46', detail.price === '1,587.46', detail.price);
    check('涨幅显示 +14.28%', detail.chg.includes('+14.28%'), detail.chg);
    check('K 线 SVG 已绘制', detail.kline);
    check('详情页 4 个标签页', detail.tabs.length === 4, JSON.stringify(detail.tabs));
    check('行情键值对已渲染（≥6 项）', detail.kv >= 6, 'count=' + detail.kv);
    check('持仓标的显示盈亏横幅', detail.pnl);

    // 元信息里的每个 token 必须独占一行盒 —— 否则会出现「A\n股」这种词内断行
    const metaWrap = await b.eval(`(() => {
      const spans = Array.from(document.querySelectorAll('.hero__meta > span'));
      return {
        total: spans.length,
        wrapped: spans.filter(s => s.getClientRects().length > 1).map(s => s.textContent.trim()),
        overflow: (() => {
          const el = document.querySelector('.hero__meta');
          return el ? el.scrollWidth > el.clientWidth + 1 : false;
        })(),
      };
    })()`);
    check('行情头元信息未出现词内断行',
      metaWrap.wrapped.length === 0, JSON.stringify(metaWrap));
    check('行情头元信息未横向溢出', metaWrap.overflow === false, JSON.stringify(metaWrap));

    const heroOverflow = await b.eval(`(() => {
      const bad = [];
      document.querySelectorAll('.hero__price, .hero__name').forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 1) bad.push(el.textContent.trim());
      });
      return bad;
    })()`);
    check('行情头大字号价格/名称未溢出', heroOverflow.length === 0, JSON.stringify(heroOverflow));

    await b.eval(`document.querySelector('[data-stock-tab="tech"]').click()`);
    await sleep(200);
    await freeze(b);
    const tech = await b.eval(`(() => ({
      rows: document.querySelectorAll('.tech-row').length,
      sigs: document.querySelectorAll('.sig i').length,
      on: document.querySelectorAll('.sig i.on-up, .sig i.on-down').length,
      resonance: document.querySelector('.card--pad .list__icon')?.className || '',
    }))()`);
    check('技术面渲染 5 项指标', tech.rows === 5, 'count=' + tech.rows);
    check('信号灯共 25 格（5 指标 × 5 格）', tech.sigs === 25, 'count=' + tech.sigs);
    check('有信号灯被点亮', tech.on > 0, 'count=' + tech.on);

    await b.eval(`document.querySelector('[data-stock-tab="ai"]').click()`);
    await sleep(200);
    await freeze(b);
    const ai = await b.eval(`(() => ({
      block: !!document.querySelector('.ai-block'),
      steps: document.querySelectorAll('.chain__step').length,
      done: document.querySelectorAll('.chain__step--done').length,
      active: document.querySelectorAll('.chain__step--active').length,
      body: document.querySelector('.ai-block__body')?.textContent.trim().length || 0,
    }))()`);
    check('AI 分析块已渲染', ai.block);
    check('Agent 推理链 7 步', ai.steps === 7, 'count=' + ai.steps);
    check('推理链含 4 步已完成 + 1 步进行中',
      ai.done === 4 && ai.active === 1, JSON.stringify(ai));
    check('AI 分析正文有实际内容', ai.body > 80, 'len=' + ai.body);

    await b.shot(path.join(SHOTS, 'h5-stock-ai.png'));

    await b.eval(`document.querySelector('[data-back]').click()`);
    await waitFor(b, `location.hash === '#/portfolio'`, '返回持仓页');
    check('返回按钮回到持仓页', true);

    /* ============ 6. 提醒页 ============ */
    console.log('\n[6] 提醒页开关与弹层');
    await navTo(b, 'alerts', '提醒');

    const before = await b.eval(`document.querySelectorAll('.alert-card').length`);
    check('渲染 6 条提醒规则', before === 6, 'count=' + before);

    const switchRes = await b.eval(`(() => {
      const sw = document.querySelector('[data-toggle-alert="al_1"]');
      const was = sw.getAttribute('aria-checked');
      sw.click();
      return { was, now: document.querySelector('[data-toggle-alert="al_1"]').getAttribute('aria-checked') };
    })()`);
    check('点击开关后 aria-checked 翻转',
      switchRes.was === 'true' && switchRes.now === 'false',
      JSON.stringify(switchRes));

    await sleep(200);
    await freeze(b);
    const offStyle = await b.eval(`(() => {
      const c = document.querySelector('[data-alert="al_1"]');
      return { cls: c.className, opacity: getComputedStyle(c).opacity };
    })()`);
    check('关闭后的规则卡片有置灰样式',
      offStyle.cls.includes('alert-card--off') && Number(offStyle.opacity) < 1,
      JSON.stringify(offStyle));

    await b.eval(`document.querySelector('[data-toggle-alert="al_1"]').click()`);
    await sleep(200);

    // 弹层：新建提醒 + 动态增删条件（事件委托是否覆盖弹层）
    await b.eval(`document.querySelector('[data-act="add-alert"]').click()`);
    await sleep(300);
    const sheetOpen = await b.eval(`(() => ({
      sheet: !!document.querySelector('.sheet'),
      conds: document.querySelectorAll('.cond-row').length,
      channels: document.querySelectorAll('.sheet [data-channel]').length,
      inBody: document.querySelector('.sheet')?.parentElement === document.body,
    }))()`);
    check('新建提醒弹层已打开', sheetOpen.sheet);
    check('弹层挂在 body 下（脱离 #app）', sheetOpen.inBody);
    check('弹层内初始 1 个条件行', sheetOpen.conds === 1, 'count=' + sheetOpen.conds);
    check('弹层内 6 个渠道可选', sheetOpen.channels === 6, 'count=' + sheetOpen.channels);

    await b.eval(`document.querySelector('[data-act="add-cond"]').click()`);
    await sleep(150);
    await b.eval(`document.querySelector('[data-act="add-cond"]').click()`);
    await sleep(150);
    const added = await b.eval(`document.querySelectorAll('.cond-row').length`);
    check('点击「添加条件」后变 3 行（弹层内委托生效）', added === 3, 'count=' + added);

    const chRes = await b.eval(`(() => {
      const el = document.querySelector('.sheet [data-channel="telegram"]');
      const was = el.getAttribute('aria-pressed');
      el.click();
      return { was, now: document.querySelector('.sheet [data-channel="telegram"]').getAttribute('aria-pressed') };
    })()`);
    check('弹层内渠道按钮可切换', chRes.was !== chRes.now, JSON.stringify(chRes));

    await b.shot(path.join(SHOTS, 'h5-alert-sheet.png'));

    await b.eval(`document.querySelector('.sheet [data-act="remove-cond"]').click()`);
    await sleep(150);
    const removed = await b.eval(`document.querySelectorAll('.cond-row').length`);
    check('点击删除条件后变 2 行', removed === 2, 'count=' + removed);

    const firstLabel = await b.eval(
      `document.querySelector('.cond-row .alert-cond__logic').textContent.trim()`
    );
    check('首行前缀保持「当」', firstLabel === '当', firstLabel);

    // 至少保留一条：连点删除直到只剩一条，再点一次不应减少
    await b.eval(`document.querySelector('.sheet [data-act="remove-cond"]').click()`);
    await sleep(150);
    await b.eval(`document.querySelector('.sheet [data-act="remove-cond"]').click()`);
    await sleep(150);
    const lastOne = await b.eval(`document.querySelectorAll('.cond-row').length`);
    check('条件删到 1 条后不再减少', lastOne === 1, 'count=' + lastOne);

    await b.eval(`document.querySelector('.sheet [data-sheet-close]').click()`);
    await sleep(250);
    const closed = await b.eval(`!!document.querySelector('.sheet')`);
    check('弹层可关闭', closed === false);

    /* ============ 7. 主题切换 ============ */
    console.log('\n[7] 主题切换');
    await navTo(b, 'settings', '设置');

    await b.eval(`document.querySelector('[data-theme-set="dark"]').click()`);
    await sleep(300);
    await freeze(b);
    const dark = await b.eval(`(() => {
      const cs = getComputedStyle(document.documentElement);
      return { theme: document.documentElement.getAttribute('data-theme'),
               bg: cs.getPropertyValue('--bg').trim(),
               ink: cs.getPropertyValue('--ink').trim() };
    })()`);
    check('切到深色后 data-theme=dark', dark.theme === 'dark', dark.theme);
    check('深色背景为暖棕灰 #232120', dark.bg.toLowerCase() === '#232120', dark.bg);
    check('深色文字提亮为 #eae4dd', dark.ink.toLowerCase() === '#eae4dd', dark.ink);
    check('深色模式正文对比度 ≥ 4.5:1',
      contrastRatio(dark.ink, dark.bg) >= 4.5,
      contrastRatio(dark.ink, dark.bg).toFixed(2) + ':1');

    const darkSemantic = await b.eval(`(() => {
      const cs = getComputedStyle(document.documentElement);
      return { up: cs.getPropertyValue('--up-text').trim(), down: cs.getPropertyValue('--down-text').trim() };
    })()`);
    check('深色模式涨跌色同样低饱和且方向正确',
      chroma(darkSemantic.up) <= 90 && chroma(darkSemantic.down) <= 90 &&
      toRgb(darkSemantic.up)[0] > toRgb(darkSemantic.up)[1] &&
      toRgb(darkSemantic.down)[1] > toRgb(darkSemantic.down)[0],
      JSON.stringify(darkSemantic));

    await b.shot(path.join(SHOTS, 'h5-settings-dark.png'));

    await b.eval(`document.querySelector('[data-theme-set="light"]').click()`);
    await sleep(300);
    await freeze(b);
    const lightAgain = await b.eval(`document.documentElement.getAttribute('data-theme')`);
    check('切回浅色', lightAgain === 'light', lightAgain);

    /* ============ 8. 机会页 ============ */
    console.log('\n[8] 机会页排序与筛选');
    await navTo(b, 'opportunities', '机会');

    const scores = await b.eval(
      `Array.from(document.querySelectorAll('.score')).map(e => Number(e.textContent.replace(/\\D/g,'')))`
    );
    check('默认按 AI 评分降序',
      scores.length === 8 && scores.every((v, i) => i === 0 || scores[i - 1] >= v),
      JSON.stringify(scores));

    await b.eval(`document.querySelector('[data-sort-opp="chg"]').click()`);
    await sleep(250);
    await freeze(b);
    const pctVals = await b.eval(`(() => {
      return Array.from(document.querySelectorAll('.card--pad')).map(c => {
        const el = Array.from(c.querySelectorAll('span'))
          .find(s => /^[+-]\\d+\\.\\d+%$/.test(s.textContent.trim()));
        return el ? Number(el.textContent.trim().replace('%','')) : null;
      }).filter(v => v !== null);
    })()`);
    check('切换为按涨幅排序后确实降序',
      pctVals.length === 8 && pctVals.every((v, i) => i === 0 || pctVals[i - 1] >= v),
      JSON.stringify(pctVals));

    await b.eval(`document.querySelector('[data-sort-opp="risk"]').click()`);
    await sleep(250);
    await freeze(b);
    const riskOrder = await b.eval(
      `Array.from(document.querySelectorAll('.card--pad')).map(c => {
        const el = Array.from(c.querySelectorAll('.chip')).find(x => x.textContent.includes('风险'));
        return el ? el.textContent.trim() : '';
      })`
    );
    const rank = { '风险 低': 0, '风险 中': 1, '风险 中高': 2 };
    check('按风险排序后低风险在前',
      riskOrder.length === 8 && riskOrder.every((v, i) => i === 0 || rank[riskOrder[i - 1]] <= rank[v]),
      JSON.stringify(riskOrder));

    await b.eval(`document.querySelector('[data-filter-opp="hk"]').click()`);
    await sleep(250);
    await freeze(b);
    const hkCount = await b.eval(`document.querySelectorAll('.card--pad').length`);
    check('筛选港股后剩 2 只', hkCount === 2, 'count=' + hkCount);

    /* ============ 9. 模拟盘 ============ */
    console.log('\n[9] 模拟盘');
    await navTo(b, 'paper', '模拟盘');

    const paper = await b.eval(`(() => ({
      svg: !!document.querySelector('.chart-wrap svg'),
      perf: document.querySelectorAll('.kv').length,
      holdings: document.querySelectorAll('.stock').length,
      trades: document.querySelectorAll('.list__icon').length,
      ranges: document.querySelectorAll('[data-paper-range]').length,
      weights: document.querySelectorAll('.stock .bar__fill').length,
    }))()`);
    check('净值曲线 SVG 已绘制', paper.svg);
    check('绩效指标 6 项', paper.perf === 6, 'count=' + paper.perf);
    check('模拟持仓 5 只', paper.holdings === 5, 'count=' + paper.holdings);
    check('最近交易 5 条', paper.trades === 5, 'count=' + paper.trades);
    check('净值区间切换 4 档', paper.ranges === 4, 'count=' + paper.ranges);
    check('持仓权重条已渲染 5 条', paper.weights === 5, 'count=' + paper.weights);

    const before1M = await b.eval(
      `document.querySelector('.chart-wrap svg path[stroke]')?.getAttribute('d')?.length || 0`
    );
    await b.eval(`document.querySelector('[data-paper-range="1M"]').click()`);
    await sleep(300);
    await freeze(b);
    const after1M = await b.eval(
      `document.querySelector('.chart-wrap svg path[stroke]')?.getAttribute('d')?.length || 0`
    );
    check('切换净值区间后曲线重绘（路径长度变化）',
      after1M !== before1M && after1M > 0, `${before1M} → ${after1M}`);

    await b.shot(path.join(SHOTS, 'h5-paper.png'));

    /* ============ 10. 持久化 ============ */
    console.log('\n[10] 本地偏好持久化');
    await navTo(b, 'settings', '设置');
    await b.eval(`document.querySelector('[data-channel-toggle="dingtalk"]').click()`);
    await sleep(250);
    await navTo(b, 'home', '今日概览');
    await navTo(b, 'settings', '设置');
    const persisted = await b.eval(
      `document.querySelector('[data-channel-toggle="dingtalk"]').getAttribute('aria-checked')`
    );
    check('渠道开关在路由切换后保持开启', persisted === 'true', persisted);

    // 刷新整页后仍在（localStorage 真落了盘）
    await reload(b);
    await waitStyled(b);
    await waitFor(b, `!!document.querySelector('[data-channel-toggle="dingtalk"]')`, '设置页');
    await freeze(b);
    const afterReload = await b.eval(
      `document.querySelector('[data-channel-toggle="dingtalk"]').getAttribute('aria-checked')`
    );
    check('整页刷新后偏好仍在（localStorage 落盘）', afterReload === 'true', afterReload);

    // 顺带验证：刷新后主题也保持（主题是另一条独立链路：内联脚本 + store）
    await b.eval(`document.querySelector('[data-theme-set="dark"]').click()`);
    await sleep(250);
    await reload(b);
    await waitStyled(b);
    const themeAfterReload = await b.eval(`document.documentElement.getAttribute('data-theme')`);
    check('刷新后深色主题保持（内联脚本防闪生效）', themeAfterReload === 'dark', themeAfterReload);
    await b.eval(`document.querySelector('[data-theme-set="light"]').click()`);
    await sleep(250);

    /* ============ 11. 控制台 ============ */
    console.log('\n[11] 控制台与资源');
    const seen = [];
    for (const k of ['portfolio', 'opportunities', 'paper', 'alerts', 'settings', 'home']) {
      await navTo(b, k);
      seen.push(k);
    }
    const errs = b.consoleErrors().filter((e) =>
      !/favicon|DevTools|Autofill|third-party cookie|Permissions policy/i.test(e)
    );
    check('遍历 6 个页面无控制台报错', errs.length === 0, errs.slice(0, 4).join(' | '));

    const assets = await b.eval(`(async () => {
      // 注意：_headers 不在列表里 —— Cloudflare 会把它解析成响应头规则，
      // 本身不作为静态资源对外提供（wrangler 内置就把它排除了）。
      const urls = ['./css/tokens.css','./css/base.css','./css/components.css',
                    './js/app.js','./js/views/stock.js','./public/manifest.json',
                    './public/icon-192.png','./public/icon-512.png','./sw.js'];
      const out = {};
      for (const u of urls) {
        try { const r = await fetch(u); out[u] = r.status; } catch (e) { out[u] = 'ERR'; }
      }
      return out;
    })()`);
    const badAssets = Object.entries(assets).filter(([, s]) => s !== 200);
    check('全部关键资源返回 200', badAssets.length === 0, JSON.stringify(badAssets));

    const swOk = await b.eval(
      `navigator.serviceWorker.getRegistration().then(r => r ? r.scope : null)`
    );
    check('Service Worker 注册成功且作用域为站点根',
      typeof swOk === 'string' && swOk.endsWith('/'), String(swOk));

    /* ============ 12. 桌面端 ============ */
    console.log('\n[12] 桌面端居中布局');
    await b.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 900, deviceScaleFactor: 1, mobile: false,
    });
    await navTo(b, 'portfolio', '持仓');

    const desktop = await b.eval(`(() => {
      const app = document.getElementById('app').getBoundingClientRect();
      const nav = document.querySelector('.tabbar').getBoundingClientRect();
      return { appW: Math.round(app.width), appLeft: Math.round(app.left),
               navW: Math.round(nav.width), navLeft: Math.round(nav.left),
               vw: window.innerWidth };
    })()`);
    check('大屏下应用收窄到 460px', desktop.appW === 460, JSON.stringify(desktop));
    check('大屏下应用水平居中',
      Math.abs(desktop.appLeft - (desktop.vw - desktop.appW) / 2) <= 2,
      JSON.stringify(desktop));
    check('底栏宽度与应用一致并对齐',
      desktop.navW === desktop.appW && desktop.navLeft === desktop.appLeft,
      JSON.stringify(desktop));

    await b.shot(path.join(SHOTS, 'h5-desktop.png'));

    await b.setMobile(390, 844);
    for (const [k, name] of [['home', 'h5-home.png'], ['alerts', 'h5-alerts.png'], ['opportunities', 'h5-opportunities.png']]) {
      await navTo(b, k);
      await b.shot(path.join(SHOTS, name));
    }
  } catch (err) {
    console.error('\n运行时异常：', err.message);
    failures.push('运行时异常: ' + err.message);
  } finally {
    await b.close();
  }

  finish('盯盘侠 H5 端到端验证');
})();
