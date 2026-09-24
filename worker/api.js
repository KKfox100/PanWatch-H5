/* ==========================================================================
   API 端点
   --------------------------------------------------------------------------
   单租户模型：读公开，写要 token。

   ── 为什么写操作必须要有 token ──────────────────────────────────────────
   这是「单租户」的固有代价：整站共享一份数据，任何人打开站点都能看到
   同一份持仓。如果写入不设防，任何访客都能把你的持仓删掉。
   token 放在环境变量里，绝不进前端代码 —— 这也是为什么必须有一个
   Worker：浏览器直接调行情接口不仅跨域被拦，也没法藏任何凭据。

   ── 行情缓存策略 ────────────────────────────────────────────────────
   TTL 内直接读库；过期才回源。回源失败时**返回过期的缓存**而不是报错，
   并在每条上标出 ageMs，让前端能显示「数据可能延迟」。
   展示一分钟前的价格，比展示一个错误页好得多。
   ========================================================================== */

import { isValidSymbol, toSymbol } from '../js/symbols.js';
import { fetchQuotes, fetchKline } from './quotes.js';
import * as db from './db.js';

const MAX_SYMBOLS = 120;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // 行情是实时数据，任何一层缓存都不该留
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

/** 定长比较，避免用 token 的响应时间反推正确前缀 */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 写操作鉴权。
 * WRITE_TOKEN 为空表示**不校验** —— 这是本地开发的便利，部署时必须设。
 * 返回 null 表示放行，否则返回一个 401 响应。
 */
function guardWrite(request, env) {
  const expected = String(env.WRITE_TOKEN || '').trim();
  if (!expected) return null;

  const auth = String(request.headers.get('Authorization') || '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  const given = String((m ? m[1] : '') || request.headers.get('X-PanWatch-Token') || '').trim();

  if (given && safeEqual(given, expected)) return null;
  return json(
    {
      error: 'unauthorized',
      message: '写入需要 token。请在「设置 → 后端 API」里填入与服务端 WRITE_TOKEN 一致的令牌。',
    },
    401
  );
}

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

/** 解析 symbols 查询参数：逗号分隔，逐个校验，去重，限量 */
function parseSymbols(raw) {
  return [...new Set(
    String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && isValidSymbol(s))
  )].slice(0, MAX_SYMBOLS);
}

/* --------------------------------------------------------------------------
   行情
   -------------------------------------------------------------------------- */

async function handleQuotes(request, env, url) {
  const symbols = parseSymbols(url.searchParams.get('symbols'));
  if (!symbols.length) {
    return json({ error: 'bad_request', message: 'symbols 参数为空或全部不合法' }, 400);
  }

  const ttlMs = num(env.QUOTE_TTL, 15) * 1000;
  // 注意区分两个时刻：
  //   requestStart —— 用来判断「缓存够不够新」
  //   servedAt     —— 用来算 ageMs（数据有多旧）
  // 用 requestStart 去减 fetched_at 会得到负数：回源写库发生在它之后。
  const requestStart = Date.now();

  const cached = await db.readCachedQuotes(env.DB, symbols);
  const cacheMap = new Map(cached.map((c) => [c.symbol, c]));

  const stale = symbols.filter((s) => {
    const c = cacheMap.get(s);
    return !c || requestStart - c.fetched_at > ttlMs;
  });

  let live = [];
  let upstreamError = null;
  if (stale.length) {
    try {
      live = await fetchQuotes(stale);
      await db.writeQuotes(env.DB, live);
    } catch (err) {
      upstreamError = String((err && err.message) || err);
    }
  }

  // 重新读一次：刚写进去的也要参与合并，这样只有一条合并逻辑
  const fresh = live.length ? await db.readCachedQuotes(env.DB, symbols) : cached;
  const bySymbol = new Map((fresh || []).map((c) => [c.symbol, c]));
  const servedAt = Date.now();

  const quotes = symbols
    .map((s) => {
      const c = bySymbol.get(s);
      if (!c) return null;
      // 夹到 0：写入时刻可能比这里的 servedAt 还晚几毫秒（同一个请求内），
      // 负数会让前端显示「-0 秒前」这种莫名其妙的东西
      const ageMs = Math.max(0, servedAt - c.fetched_at);
      return {
        symbol: c.symbol,
        code: c.code,
        market: c.market,
        price: c.price,
        prevClose: c.prev_close,
        open: c.open,
        high: c.high,
        low: c.low,
        volume: c.volume,
        amount: c.amount,
        currency: c.currency,
        quotedAt: c.quoted_at,
        fetchedAt: c.fetched_at,
        ageMs,
        // 超出 TTL 就是「拿的是旧价」—— 前端据此显示延迟提示
        stale: ageMs > ttlMs,
      };
    })
    .filter(Boolean);

  if (!quotes.length) {
    return json(
      {
        error: 'upstream_unavailable',
        message: upstreamError
          ? `行情上游不可用：${upstreamError}`
          : '暂时取不到行情，且本地也没有缓存',
      },
      502
    );
  }

  return json({
    quotes,
    requested: symbols.length,
    missing: symbols.length - quotes.length,
    ttlMs,
    upstreamError,
    // 这里曾经写成 now —— 变量根本不存在。整个接口会抛 ReferenceError 变成 500，
    // 而前端的降级逻辑会把它当成「后端不可用」，安静地退回演示数据：
    // 界面一切正常，只是价格永远不动。查了半天才发现是这个笔误。
    serverTime: servedAt,
  });
}

async function handleKline(request, env, url) {
  const symbol = String(url.searchParams.get('symbol') || '').trim();
  if (!isValidSymbol(symbol)) {
    return json({ error: 'bad_request', message: 'symbol 不合法' }, 400);
  }
  const days = Math.min(Math.max(num(url.searchParams.get('days'), 60), 5), 250);
  // K 线按天变，但盘中最后一根一直在动，所以 TTL 不能太长
  const ttlMs = num(env.KLINE_TTL, 300) * 1000;
  const requestStart = Date.now();

  const fetchedAt = await db.klineFetchedAt(env.DB, symbol);
  let source = 'cache';
  let upstreamError = null;

  if (!fetchedAt || requestStart - fetchedAt > ttlMs) {
    try {
      const bars = await fetchKline(symbol, days);
      if (bars.length) {
        await db.writeKline(env.DB, symbol, bars);
        source = 'live';
      }
    } catch (err) {
      upstreamError = String((err && err.message) || err);
    }
  }

  const rows = await db.readCachedKline(env.DB, symbol);
  if (!rows.length) {
    return json(
      { error: 'upstream_unavailable', message: upstreamError || '取不到 K 线，且本地无缓存' },
      502
    );
  }

  const meta = await db.klineFetchedAt(env.DB, symbol);
  const servedAt = Date.now();
  return json({
    symbol,
    bars: rows.slice(-days).map((r) => ({
      date: r.date, o: r.open, c: r.close, h: r.high, l: r.low, v: r.volume,
    })),
    source,
    fetchedAt: meta,
    ageMs: Math.max(0, servedAt - (meta || 0)),
    upstreamError,
    serverTime: servedAt,
  });
}

/* --------------------------------------------------------------------------
   业务数据
   -------------------------------------------------------------------------- */

/** 一次性取回启动所需的全部状态，省掉 4 个往返 */
async function handleState(env) {
  const seeded = await db.seedIfEmpty(env.DB);
  const [portfolio, watchlist, alerts, settings] = await Promise.all([
    db.readPortfolio(env.DB),
    db.readWatchlist(env.DB),
    db.readAlerts(env.DB),
    db.readSettings(env.DB),
  ]);
  return json({
    portfolio,
    watchlist,
    alerts,
    settings,
    seededNow: seeded,
    writeProtected: !!String(env.WRITE_TOKEN || '').trim(),
    serverTime: Date.now(),
  });
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
   路由
   -------------------------------------------------------------------------- */

export async function handleApi(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/api';
  const method = request.method.toUpperCase();

  if (!env.DB) {
    return json(
      {
        error: 'no_database',
        message: '没有绑定 D1 数据库。请在 wrangler.jsonc 的 d1_databases 里配好 binding "DB"，并执行 npx wrangler d1 create panwatch-db。',
      },
      503
    );
  }

  await db.ensureSchema(env.DB);

  // 健康检查：前端启动时用它探测后端是否可用
  if (path === '/api/health' && method === 'GET') {
    let dbOk = true;
    let dbError = null;
    try {
      await env.DB.prepare('SELECT 1').first();
    } catch (err) {
      dbOk = false;
      dbError = String((err && err.message) || err);
    }
    return json({
      ok: dbOk,
      service: env.APP_NAME || 'PanWatch H5',
      version: env.APP_VERSION || '0.0.0',
      database: dbOk ? 'ok' : 'error',
      databaseError: dbError,
      writeProtected: !!String(env.WRITE_TOKEN || '').trim(),
      quoteTtlSec: num(env.QUOTE_TTL, 15),
      serverTime: Date.now(),
    }, dbOk ? 200 : 503);
  }

  if (path === '/api/quotes' && method === 'GET') return handleQuotes(request, env, url);
  if (path === '/api/kline' && method === 'GET') return handleKline(request, env, url);
  if (path === '/api/state' && method === 'GET') return handleState(env);

  // ---- 写操作 ----
  if (path === '/api/portfolio' && method === 'PUT') {
    const denied = guardWrite(request, env);
    if (denied) return denied;
    const body = await readBody(request);
    if (!body || !Array.isArray(body.accounts)) {
      return json({ error: 'bad_request', message: 'body.accounts 必须是数组' }, 400);
    }
    await db.replacePortfolio(env.DB, body.accounts);
    return json({ ok: true, accounts: await db.readPortfolio(env.DB) });
  }

  if (path === '/api/watchlist' && method === 'PUT') {
    const denied = guardWrite(request, env);
    if (denied) return denied;
    const body = await readBody(request);
    if (!body || !Array.isArray(body.watchlist)) {
      return json({ error: 'bad_request', message: 'body.watchlist 必须是数组' }, 400);
    }
    await db.replaceWatchlist(env.DB, body.watchlist);
    return json({ ok: true, watchlist: await db.readWatchlist(env.DB) });
  }

  if (path === '/api/alerts' && method === 'PUT') {
    const denied = guardWrite(request, env);
    if (denied) return denied;
    const body = await readBody(request);
    if (!body || !Array.isArray(body.alerts)) {
      return json({ error: 'bad_request', message: 'body.alerts 必须是数组' }, 400);
    }
    await db.replaceAlerts(env.DB, body.alerts);
    return json({ ok: true, alerts: await db.readAlerts(env.DB) });
  }

  if (path === '/api/settings' && method === 'PUT') {
    const denied = guardWrite(request, env);
    if (denied) return denied;
    const body = await readBody(request);
    if (!body || typeof body.settings !== 'object' || body.settings === null) {
      return json({ error: 'bad_request', message: 'body.settings 必须是对象' }, 400);
    }
    await db.writeSettings(env.DB, body.settings);
    return json({ ok: true, settings: await db.readSettings(env.DB) });
  }

  return json({ error: 'not_found', message: `没有这个接口：${method} ${path}` }, 404);
}

/** 供 Worker 入口复用的符号工具（避免入口再 import 一次 symbols.js） */
export { toSymbol };
