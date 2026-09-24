'use strict';

/**
 * 实时路径端到端验证（真实 Chrome + 真实 Worker + 真实 D1）
 * ------------------------------------------------------------------
 *   ./node_modules/.bin/wrangler dev --port 8791 \
 *       --persist-to "<项目外路径>" --var WRITE_TOKEN:testtoken &
 *   node scripts/e2e-live.cjs
 *
 * 和 e2e.cjs 的分工：
 *   e2e.cjs       —— 证明「没有后端时站点照旧工作」（降级路径）
 *   e2e-live.cjs  —— 证明「有后端时真的用上了后端」（本文件）
 *
 * ── 这个脚本要回答的核心问题 ────────────────────────────────────────
 * 光看到页面上有数字，什么也证明不了 —— 演示数据也长得一样。
 * 所以这里做两条**只有真数据才可能同时成立**的断言：
 *
 *   ① DOM 上那只股票的价格 ≈ /api/quotes 返回的价格
 *      （证明：接口 → 前端覆盖层 → 视图渲染，整条链路通了）
 *   ② 同一个价格 ≠ 内置演示数据里的那个值
 *      （证明：屏幕上的数字确实被替换过，不是原来那份样本）
 *
 * 少了 ②，一个「接口全挂但界面照常显示演示数据」的实现也能通过测试。
 *
 * 另外：整个流程必须零控制台报错。这里的 /api/* 全部 200，
 * 所以没有任何「预期内的 404」可以放行 —— 与 e2e.cjs 的处理不同。
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { launch, createChecker, sleep } = require('./cdp-client.cjs');

const BASE = process.env.LIVE_BASE || 'http://127.0.0.1:8791';
const TOKEN = process.env.WRITE_TOKEN || 'testtoken';
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots');
const STORE_KEY = 'panwatch-h5:v1';

const { check, failures, finish } = createChecker();

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

async function api(pathname, init) {
  const res = await fetch(BASE + pathname, init);
  let body = null;
  try { body = await res.json(); } catch { /* 非 JSON 响应 */ }
  return { status: res.status, body };
}

/** 把 "1,237.00" 这类显示值还原成数字 */
function parseNum(text) {
  const n = Number(String(text || '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/** 切路由。哈希跳转不触发 load 事件，所以只能改 hash 再轮询。
 *  waitFor 要返回**字符串**（比如标题），返回空串表示还没到位。
 *  不要返回布尔值 —— 那样拿到的是 true，没法再跟期望值比对。 */
async function hashTo(b, hash, waitFor) {
  await b.eval(`(() => { location.hash = ${JSON.stringify(hash)}; return true; })()`);
  if (!waitFor) { await sleep(260); return null; }
  for (let i = 0; i < 70; i++) {
    const t = await b.eval(waitFor);
    if (t) return t;
    await sleep(80);
  }
  return null;
}

/** 页面标题，用作切页完成的判据 */
const TITLE = `document.querySelector('.page-head__title')?.textContent.trim() || ''`;

/** 轮询直到表达式为真 */
async function until(b, expr, tries = 90) {
  for (let i = 0; i < tries; i++) {
    if (await b.eval(expr)) return true;
    await sleep(120);
  }
  return false;
}

/** 页面上当前所有 toast 的文案 */
const TOASTS = `[...document.querySelectorAll('#toasts .toast')].map(e => e.textContent.trim())`;

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });

  // 直接从源码引入 —— 顺便验证「data.js / symbols.js 是纯模块」这条约束
  // 仍然成立（Worker 依赖它：一旦有人在里面加一句 document，Worker 会在
  // import 阶段就崩）。
  const data = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'data.js')).href);
  const symbols = await import(pathToFileURL(path.join(__dirname, '..', 'js', 'symbols.js')).href);

  /* ============ 1. 后端本身 ============ */
  console.log('\n[1] 后端与 D1');
  const health = await api('/api/health');
  check('GET /api/health 返回 200', health.status === 200, JSON.stringify(health.body));
  check('D1 已绑定且可用', health.body && health.body.database === 'ok',
    JSON.stringify(health.body));
  check('服务端上报了版本号', !!(health.body && health.body.version),
    String(health.body && health.body.version));
  check('服务端声明写入受保护（WRITE_TOKEN 已设）',
    !!(health.body && health.body.writeProtected));

  const state0 = await api('/api/state');
  check('GET /api/state 返回 200', state0.status === 200);
  const st = state0.body || {};
  const posCount = (st.portfolio || []).reduce((n, a) => n + (a.positions || []).length, 0);
  check('服务端有持仓数据', posCount > 0, `持仓 ${posCount} 只`);
  check('服务端有提醒规则', Array.isArray(st.alerts) && st.alerts.length > 0,
    `提醒 ${(st.alerts || []).length} 条`);

  /* ============ 2. 行情接口：真实且单位正确 ============ */
  console.log('\n[2] 行情接口');
  // 600519 贵州茅台：A股，用来验单位换算（手→股、万元→元）
  // sh000001 上证指数：用来验「指数不能被按规则推成平安银行」
  const PROBE = ['sh600519', 'hk00700', 'usAAPL', 'sh000001'];
  const q = await api('/api/quotes?symbols=' + PROBE.join(','));
  check('GET /api/quotes 返回 200', q.status === 200, JSON.stringify(q.body).slice(0, 200));
  const qm = new Map(((q.body && q.body.quotes) || []).map((x) => [x.symbol, x]));
  check(`四个标的都拿到了报价（${qm.size}/4）`, qm.size === PROBE.length,
    '缺：' + PROBE.filter((s) => !qm.has(s)).join(','));

  const mt = qm.get('sh600519');
  check('A股报价价格为正', !!(mt && mt.price > 0), JSON.stringify(mt && mt.price));
  // 成交量：上游给「手」，接口必须 ×100 变成「股」。
  // 判断依据不是「大于某个数」，而是「量级对得上」——茅台日成交量在
  // 百万股这个量级。如果忘了 ×100，会掉到几万股，一眼能看出来。
  check('A股成交量已从「手」换算成「股」（量级 ≥ 1e6）',
    !!(mt && mt.volume >= 1e6), 'volume=' + (mt && mt.volume));
  check('A股成交额已从「万元」换算成「元」（量级 ≥ 1e8）',
    !!(mt && mt.amount >= 1e8), 'amount=' + (mt && mt.amount));
  check('A股开高低齐全且落在合理区间',
    !!(mt && mt.open > 0 && mt.high >= mt.low && mt.low > 0),
    JSON.stringify(mt && { open: mt.open, high: mt.high, low: mt.low }));

  const idx = qm.get('sh000001');
  // 上证指数在 3000 点上下；平安银行在 10 元上下。
  // 这条断言的作用是：如果指数被按「首位 0 → 深交所」的规则推成 sz000001，
  // 价格会变成个位数 —— 不报错，只是数字悄悄换了含义。
  check('sh000001 解析为上证指数（价位在千点级，不是平安银行）',
    !!(idx && idx.price > 500), 'price=' + (idx && idx.price));

  /* ============ 3. 浏览器接上后端 ============ */
  console.log('\n[3] 浏览器接入后端');
  const b = await launch({ width: 390, height: 844 });
  await b.setMobile(390, 844);
  await b.goto(BASE + '/');

  const styled = await until(b,
    `getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() !== ''`);
  check('样式表已生效', styled);

  // 顶栏标识必须从「演示」翻成「实时」—— 这是用户唯一的判据
  const online = await until(b,
    `document.querySelector('[data-src-label]')?.textContent.trim() === '实时'`);
  const chip = await b.eval(`(() => {
    const el = document.querySelector('[data-src-chip]');
    return { label: document.querySelector('[data-src-label]')?.textContent.trim(),
             cls: el ? el.className : '', title: el ? el.title : '' };
  })()`);
  check('顶栏数据源标识变成「实时」', online, JSON.stringify(chip));
  check('标识带 srcchip--online 样式（视觉上可区分）',
    /srcchip--online/.test(chip.cls), chip.cls);
  check('标识的提示里写明行情源与更新时间',
    /腾讯财经/.test(chip.title) && /更新于/.test(chip.title), chip.title);

  await b.shot(path.join(SHOTS, 'live-home.png'));

  /* ============ 3.5 首页汇总不能是坏值 ============
     这一节是补写回来的：第一版脚本只看了持仓页，结果漏掉了一个真实 bug ——
     数据库只存成本与股数、不存价格，所以 getState 之后、行情贴上去之前，
     持仓是没有价格的。那段空档里如果发生一次渲染，总资产就会变成「--」。
     当时首页截图就是这样：顶栏写着「实时」，总资产却是一个破折号。

     断言分两层，缺一不可：
       a) 首页的汇总必须是真实数字（不是「--」）
       b) 首页指数卡片必须等于接口返回的指数值（而不是 data.js 里的演示价） */
  console.log('\n[3.5] 首页汇总与指数');
  const homeVals = await b.eval(`(() => {
    const out = { cards: {}, indexes: {} };
    document.querySelectorAll('.stat').forEach((el) => {
      const label = el.querySelector('.stat__label')?.textContent.trim();
      const val = el.querySelector('.stat__value')?.textContent.trim();
      if (label) out.cards[label] = val;
    });
    document.querySelectorAll('.index-card').forEach((el) => {
      out.indexes[el.querySelector('.index-card__name')?.textContent.trim()] =
        el.querySelector('.index-card__val')?.textContent.trim();
    });
    return out;
  })()`);

  check('首页渲染出资产汇总卡', Object.keys(homeVals.cards).length > 0,
    JSON.stringify(homeVals.cards));
  const brokenCards = Object.entries(homeVals.cards)
    .filter(([, v]) => !v || /^[-—]+$/.test(v))
    .map(([k]) => k);
  check('首页汇总卡都是真实数字（没有「--」）', brokenCards.length === 0,
    brokenCards.join(', ') + ' | ' + JSON.stringify(homeVals.cards));

  // 指数卡必须跟着接口走。data.js 里的演示价是 3428.65（上证），
  // 接口此刻给的是 3888.37 —— 只要还是前者，就说明覆盖层没生效。
  const idxRes = await api('/api/quotes?symbols=sh000001,sz399001,sz399006');
  const idxMap = new Map(((idxRes.body && idxRes.body.quotes) || []).map((x) => [x.symbol, x]));
  const IDX_EXPECT = [
    ['上证指数', 'sh000001', 3428.65],
    ['深证成指', 'sz399001', 11256.4],
    ['创业板指', 'sz399006', 2388.15],
  ];
  for (const [name, sym, demoVal] of IDX_EXPECT) {
    const domVal = parseNum(homeVals.indexes[name]);
    const apiVal = idxMap.get(sym) ? idxMap.get(sym).price : NaN;
    const matchesApi = Number.isFinite(domVal) && Number.isFinite(apiVal) &&
      Math.abs(domVal - apiVal) / apiVal <= 0.005;
    check(`首页「${name}」等于接口值（不是演示价 ${demoVal}）`, matchesApi,
      `DOM=${domVal} API=${apiVal} 演示=${demoVal}`);
  }

  /* ============ 4. 真实价格真的进了 DOM ============ */
  console.log('\n[4] DOM 里的价格是不是真的');
  // 挑一只在持仓里的 A 股：600519 贵州茅台（演示价 1468.2，与实时价差得远）
  const CODE = '600519';
  const demoRec = data.findStock(CODE);
  check('演示数据里能找到 600519', !!demoRec, String(CODE));
  const demoSym = symbols.toSymbol(demoRec.code, demoRec.market);
  check('symbols.js 能把 600519 推成 sh600519', demoSym === 'sh600519', String(demoSym));

  const t = await hashTo(b, '#/portfolio', TITLE);
  check('切到持仓页', t === '持仓', String(t));
  await until(b, `document.querySelectorAll('.stock').length > 0`);

  // 持仓页的汇总同样不能出现「--」，而且不该再挂着「有 N 只取不到报价」的提示
  // （所有 29 个标的都能拿到报价，noQuote 应该是 0）
  const pfVals = await b.eval(`(() => {
    const cards = {};
    document.querySelectorAll('.stat').forEach((el) => {
      const label = el.querySelector('.stat__label')?.textContent.trim();
      const val = el.querySelector('.stat__value')?.textContent.trim();
      if (label) cards[label] = val;
    });
    return { cards, warn: /暂时取不到报价/.test(document.body.innerText) };
  })()`);
  const brokenPf = Object.entries(pfVals.cards)
    .filter(([, v]) => !v || /^[-—]+$/.test(v)).map(([k]) => k);
  check('持仓页汇总卡都是真实数字（没有「--」）', brokenPf.length === 0,
    brokenPf.join(', ') + ' | ' + JSON.stringify(pfVals.cards));
  check('所有标的都拿到报价时，不显示「取不到报价」提示', pfVals.warn === false);

  const row = await b.eval(`(() => {
    const el = document.querySelector('.stock[data-stock=${JSON.stringify(CODE)}]');
    if (!el) return null;
    const dd = el.querySelector('.stock__figs > div:first-child dd');
    return { price: dd ? dd.textContent.trim() : null };
  })()`);
  check(`持仓页渲染出 ${CODE} 这一行`, !!(row && row.price), JSON.stringify(row));

  const domPrice = parseNum(row && row.price);
  const apiNow = await api('/api/quotes?symbols=' + demoSym);
  const apiPrice = apiNow.body && apiNow.body.quotes && apiNow.body.quotes[0]
    ? apiNow.body.quotes[0].price : NaN;
  check('接口此刻也能取到该标的的价格', apiPrice > 0, 'apiPrice=' + apiPrice);

  // ① DOM ≈ 接口。容忍 0.5%：两次请求之间上游价格理论上可能微动。
  const diffPct = Math.abs(domPrice - apiPrice) / apiPrice * 100;
  check('DOM 价格与接口价格一致（≤0.5%）', diffPct <= 0.5,
    `DOM=${domPrice} API=${apiPrice} 差 ${diffPct.toFixed(3)}%`);

  // ② DOM ≠ 演示价。少了这条，一个「接口全挂、界面照旧显示演示数据」的
  //    实现也能通过上面那条（只要它也去请求了一次接口）。
  const demoPrice = demoRec.price;
  const sameAsDemo = Math.abs(domPrice - demoPrice) < 0.01;
  check('DOM 价格已经不是内置演示价（证明数据被替换过）', !sameAsDemo,
    `DOM=${domPrice} 演示价=${demoPrice}`);
  console.log(`      实时 ${domPrice}  vs  演示 ${demoPrice}`);

  await b.shot(path.join(SHOTS, 'live-portfolio.png'));

  /* ============ 5. 个股页的真实日 K ============ */
  console.log('\n[5] 个股页 K 线');
  await hashTo(b, '#/stock/' + CODE, `document.querySelector('.hero__name')?.textContent.trim() || ''`);
  const kOk = await until(b,
    `[...document.querySelectorAll('.chart-wrap .chip')].some(e => /真实日 K/.test(e.textContent))`);
  const kChip = await b.eval(
    `[...document.querySelectorAll('.chart-wrap .chip')].map(e => e.textContent.trim()).join('|')`);
  check('K 线标注为「真实日 K」', kOk, String(kChip));

  const bars = await api('/api/kline?symbol=' + demoSym + '&days=5');
  const barList = (bars.body && bars.body.bars) || [];
  check('K 线接口返回 ≥5 根', barList.length >= 5, 'count=' + barList.length);
  const last = barList[barList.length - 1];
  check('K 线字段完整（日期 + 开收高低）',
    !!(last && last.date && last.o > 0 && last.c > 0 && last.h >= last.l),
    JSON.stringify(last));
  check('K 线最后一根的收盘价与实时报价同量级（说明是同一只标的）',
    !!(last && apiPrice > 0 && Math.abs(last.c - apiPrice) / apiPrice < 0.05),
    `K线收盘=${last && last.c} 实时=${apiPrice}`);
  await b.shot(path.join(SHOTS, 'live-stock-kline.png'));

  /* ============ 6. 设置页的实时状态卡 ============ */
  console.log('\n[6] 设置页状态卡');
  await hashTo(b, '#/settings', TITLE);
  const card = await b.eval(`(() => {
    const txt = document.body.innerText;
    return {
      source: /实时行情/.test(txt),
      tencent: /腾讯财经/.test(txt),
      protected: /需要令牌/.test(txt),
      version: /0\\.2\\.0-h5/.test(txt),
      // 不能再出现「纯静态 H5，默认使用内置演示数据」这类已经过时的说法
      staleClaim: /纯静态 H5|不需要服务器或数据库/.test(txt),
    };
  })()`);
  check('状态卡显示「实时行情」', card.source, JSON.stringify(card));
  check('状态卡写明行情源为腾讯财经', card.tencent);
  check('状态卡显示「需要令牌」（服务端已设 WRITE_TOKEN）', card.protected);
  check('状态卡显示服务端版本', card.version);
  check('设置页没有残留「纯静态/不需要数据库」的过时说法', !card.staleClaim);
  await b.shot(path.join(SHOTS, 'live-settings.png'));

  /* ============ 7. 写入鉴权：无 token 必须被拒 ============ */
  console.log('\n[7] 写入鉴权（无 token）');
  // 清掉本地偏好，确保 apiToken 是空的
  await b.eval(`(() => { localStorage.removeItem(${JSON.stringify(STORE_KEY)}); return true; })()`);
  await b.goto(BASE + '/');
  await until(b, `document.querySelector('[data-src-label]')?.textContent.trim() === '实时'`);
  await hashTo(b, '#/alerts', `document.querySelectorAll('[data-toggle-alert]').length ? 'ok' : ''`);

  const before = await b.eval(`(() => {
    const el = document.querySelector('[data-toggle-alert]');
    return el ? { id: el.dataset.toggleAlert, on: el.getAttribute('aria-checked') === 'true' } : null;
  })()`);
  check('提醒页渲染出开关', !!(before && before.id), JSON.stringify(before));

  const stateBefore = await api('/api/state');
  const alertBefore = ((stateBefore.body || {}).alerts || []).find((a) => a.id === before.id);
  check('该提醒在服务端存在', !!alertBefore, String(before.id));

  await b.eval(`(() => {
    document.querySelector('[data-toggle-alert]').click(); return true; })()`);
  await sleep(2200);   // 等请求往返 + toast 出现

  const toasts7 = await b.eval(TOASTS);
  check('无 token 写入时给出了明确提示',
    toasts7.some((x) => /token|令牌|拒绝/i.test(x)), JSON.stringify(toasts7));

  const stateAfter7 = await api('/api/state');
  const alertAfter7 = ((stateAfter7.body || {}).alerts || []).find((a) => a.id === before.id);
  check('无 token 时服务端数据**没有**被改动',
    !!alertAfter7 && alertAfter7.enabled === alertBefore.enabled,
    `before=${alertBefore.enabled} after=${alertAfter7 && alertAfter7.enabled}`);

  /* ============ 8. 写入鉴权：填对 token 后必须成功 ============ */
  console.log('\n[8] 写入鉴权（正确 token）');
  await b.eval(`(() => {
    const raw = localStorage.getItem(${JSON.stringify(STORE_KEY)});
    const s = raw ? JSON.parse(raw) : {};
    s.settings = Object.assign({}, s.settings, { apiToken: ${JSON.stringify(TOKEN)} });
    localStorage.setItem(${JSON.stringify(STORE_KEY)}, JSON.stringify(s));
    return true;
  })()`);
  await b.goto(BASE + '/');
  await until(b, `document.querySelector('[data-src-label]')?.textContent.trim() === '实时'`);
  await hashTo(b, '#/alerts', `document.querySelectorAll('[data-toggle-alert]').length ? 'ok' : ''`);

  const flip = await b.eval(`(() => {
    const el = document.querySelector('[data-toggle-alert]');
    return { id: el.dataset.toggleAlert, on: el.getAttribute('aria-checked') === 'true' };
  })()`);
  await b.eval(`(() => { document.querySelector('[data-toggle-alert]').click(); return true; })()`);
  await sleep(2600);

  const stateAfter8 = await api('/api/state');
  const alertAfter8 = ((stateAfter8.body || {}).alerts || []).find((a) => a.id === flip.id);
  check('带正确 token 后，改动落到了 D1 里',
    !!alertAfter8 && alertAfter8.enabled === !flip.on,
    `点前=${flip.on} 点后(服务端)=${alertAfter8 && alertAfter8.enabled}`);

  const toasts8 = await b.eval(TOASTS);
  check('带 token 写入时没有再报「需要令牌」',
    !toasts8.some((x) => /需要 token|令牌/.test(x)), JSON.stringify(toasts8));

  /* ============ 9. 刷新按钮真的会重新拉 ============ */
  console.log('\n[9] 手动刷新');
  await hashTo(b, '#/portfolio', TITLE);
  const ttl = (health.body && health.body.quoteTtlSec) || 15;
  // 等 TTL 过去，再点刷新，这样才真的会回源
  await sleep((ttl + 1) * 1000);
  await b.eval(`(() => { document.querySelector('[data-act="refresh"]').click(); return true; })()`);
  const refreshed = await until(b, `${TOASTS}.some(x => /已同步|刷新失败/.test(x))`, 60);
  const toasts9 = await b.eval(TOASTS);
  check('点刷新后给出了同步结果', refreshed, JSON.stringify(toasts9));
  check('刷新提示里带相对时间或失败原因',
    toasts9.some((x) => /已同步 ·|刷新失败/.test(x)), JSON.stringify(toasts9));

  /* ============ 10. 控制台必须干净 ============ */
  console.log('\n[10] 控制台');
  const errs = b.consoleErrorEntries().filter(
    (e) => !/favicon|DevTools|Autofill|third-party cookie|Permissions policy/i.test(e.text)
  );
  // 这里不像 e2e.cjs 那样放行任何东西：所有 /api/* 都返回 200，
  // 出现 404 就说明真的有问题。
  check('全程无控制台报错', errs.length === 0,
    errs.slice(0, 5).map((e) => `${e.url || '(无URL)'} :: ${e.text}`).join(' | '));

  await b.close();
  finish('实时行情 + D1 持久化验证');
})().catch((err) => {
  console.error('\n脚本异常：', err && err.stack ? err.stack : err);
  process.exit(1);
});
