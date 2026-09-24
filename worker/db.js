/* ==========================================================================
   D1（SQLite）数据访问层
   --------------------------------------------------------------------------
   ⚠️ 这个模块 import 了 ../js/data.js 作为**种子数据**，好处是
   「初始持仓长什么样」只有一份定义，改 data.js 不会和这里脱节。

   代价是：data.js 与它依赖的 utils.js 必须保持**模块顶层无副作用**。
   哪天有人在那边加一句 localStorage / document / window，这个 Worker
   会在 import 阶段就崩，而且报错位置看起来跟数据毫无关系。
   （当前已核对：两处 window/document 都在函数体内。）

   ── 表结构与 migrations/0001_init.sql 一致 ──────────────────────────────
   这里的 DDL 是**幂等**的，第一次请求时执行一次（每个 isolate 只跑一次）。
   这样忘了跑迁移也不会报错；迁移文件的价值是「表结构有可读、可 diff
   的定义」。
   ========================================================================== */

import { PORTFOLIO, WATCHLIST, ALERTS } from '../js/data.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS quotes (
     symbol     TEXT PRIMARY KEY,
     code       TEXT NOT NULL,
     market     TEXT NOT NULL,
     price      REAL NOT NULL,
     prev_close REAL NOT NULL,
     open       REAL,
     high       REAL,
     low        REAL,
     volume     REAL,
     amount     REAL,
     currency   TEXT,
     quoted_at  TEXT,
     fetched_at INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_quotes_fetched ON quotes (fetched_at)`,
  `CREATE TABLE IF NOT EXISTS klines (
     symbol TEXT NOT NULL,
     date   TEXT NOT NULL,
     open   REAL NOT NULL,
     close  REAL NOT NULL,
     high   REAL NOT NULL,
     low    REAL NOT NULL,
     volume REAL,
     PRIMARY KEY (symbol, date)
   )`,
  `CREATE TABLE IF NOT EXISTS kline_meta (
     symbol     TEXT PRIMARY KEY,
     fetched_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS accounts (
     id         TEXT PRIMARY KEY,
     name       TEXT NOT NULL,
     cash       REAL NOT NULL DEFAULT 0,
     sort_order INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS positions (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id TEXT NOT NULL,
     code       TEXT NOT NULL,
     market     TEXT NOT NULL,
     name       TEXT NOT NULL,
     cost       REAL NOT NULL,
     shares     REAL NOT NULL,
     style      TEXT,
     ai_score   INTEGER,
     ai_action  TEXT,
     tags       TEXT,
     agent      TEXT,
     alert      TEXT,
     stale      INTEGER NOT NULL DEFAULT 0,
     UNIQUE (account_id, code)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_positions_account ON positions (account_id)`,
  `CREATE TABLE IF NOT EXISTS watchlist (
     code       TEXT PRIMARY KEY,
     market     TEXT NOT NULL,
     name       TEXT NOT NULL,
     note       TEXT,
     ai_score   INTEGER,
     sort_order INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS alerts (
     id          TEXT PRIMARY KEY,
     code        TEXT NOT NULL,
     market      TEXT NOT NULL,
     name        TEXT NOT NULL,
     enabled     INTEGER NOT NULL DEFAULT 1,
     logic       TEXT NOT NULL DEFAULT 'OR',
     conds       TEXT NOT NULL DEFAULT '[]',
     scope       TEXT,
     cooldown    TEXT,
     daily_cap   INTEGER,
     repeat_mode TEXT,
     channels    TEXT NOT NULL DEFAULT '[]',
     fired       INTEGER NOT NULL DEFAULT 0,
     last_fired  TEXT,
     sort_order  INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
     key        TEXT PRIMARY KEY,
     value      TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS meta (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
];

/**
 * 每个 isolate 只建一次表。
 * 用一个 Promise 做 memo，这样并发请求不会各自跑一遍 DDL。
 */
let schemaReady = null;

export function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((err) => {
      schemaReady = null; // 失败就允许下次重试，别把 isolate 永久卡死
      throw err;
    });
  }
  return schemaReady;
}

/* --------------------------------------------------------------------------
   元信息
   -------------------------------------------------------------------------- */

export async function getMeta(db, key) {
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

export async function setMeta(db, key, value) {
  await db
    .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, String(value))
    .run();
}

/* --------------------------------------------------------------------------
   种子数据：第一次访问时把内置演示数据灌进库，作为可编辑的起点
   --------------------------------------------------------------------------
   为什么要把演示数据入库而不是「库里空着就用内置的」：
   因为一旦用户改了持仓，就必须有「用户那份」和「内置那份」的区分。
   入库之后库里那份就是唯一真值，前端不再猜。
   -------------------------------------------------------------------------- */

function seedPayload() {
  return {
    accounts: PORTFOLIO.accounts.map((a, i) => ({
      id: a.id,
      name: a.name,
      cash: a.cash,
      sort: i,
      positions: a.positions.map((p) => ({
        code: p.code,
        market: p.market,
        name: p.name,
        cost: p.cost,
        shares: p.shares,
        style: p.style || null,
        aiScore: p.aiScore == null ? null : p.aiScore,
        aiAction: p.aiAction || null,
        tags: Array.isArray(p.tags) ? p.tags : [],
        agent: p.agent || null,
        alert: p.alert || null,
        stale: p.stale ? 1 : 0,
      })),
    })),
    watchlist: WATCHLIST.map((w, i) => ({
      code: w.code,
      market: w.market,
      name: w.name,
      note: w.note || null,
      aiScore: w.aiScore == null ? null : w.aiScore,
      sort: i,
    })),
    alerts: ALERTS.map((a, i) => ({
      id: a.id,
      code: a.code,
      market: a.market,
      name: a.name,
      enabled: a.enabled ? 1 : 0,
      logic: a.logic || 'OR',
      conds: a.conds || [],
      scope: a.scope || null,
      cooldown: a.cooldown || null,
      dailyCap: a.dailyCap == null ? null : a.dailyCap,
      repeat: a.repeat || null,
      channels: a.channels || [],
      fired: a.fired || 0,
      lastFired: a.lastFired || null,
      sort: i,
    })),
  };
}

export async function seedIfEmpty(db) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM accounts').first();
  if (row && row.n > 0) return false;

  const { accounts, watchlist, alerts } = seedPayload();
  const stmts = [];

  accounts.forEach((a) => {
    stmts.push(
      db.prepare('INSERT INTO accounts (id, name, cash, sort_order) VALUES (?, ?, ?, ?)')
        .bind(a.id, a.name, a.cash, a.sort)
    );
    a.positions.forEach((p) => {
      stmts.push(
        db.prepare(
          `INSERT INTO positions
             (account_id, code, market, name, cost, shares, style, ai_score, ai_action, tags, agent, alert, stale)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          a.id, p.code, p.market, p.name, p.cost, p.shares, p.style,
          p.aiScore, p.aiAction, JSON.stringify(p.tags), p.agent, p.alert, p.stale
        )
      );
    });
  });

  watchlist.forEach((w) => {
    stmts.push(
      db.prepare('INSERT INTO watchlist (code, market, name, note, ai_score, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(w.code, w.market, w.name, w.note, w.aiScore, w.sort)
    );
  });

  alerts.forEach((a) => {
    stmts.push(
      db.prepare(
        `INSERT INTO alerts
           (id, code, market, name, enabled, logic, conds, scope, cooldown, daily_cap, repeat_mode, channels, fired, last_fired, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        a.id, a.code, a.market, a.name, a.enabled, a.logic, JSON.stringify(a.conds),
        a.scope, a.cooldown, a.dailyCap, a.repeat, JSON.stringify(a.channels),
        a.fired, a.lastFired, a.sort
      )
    );
  });

  stmts.push(db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').bind('seeded_at', String(Date.now())));
  await db.batch(stmts);
  return true;
}

/* --------------------------------------------------------------------------
   行情缓存
   -------------------------------------------------------------------------- */

export async function readCachedQuotes(db, symbols) {
  if (!symbols.length) return [];
  const holes = symbols.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT * FROM quotes WHERE symbol IN (${holes})`)
    .bind(...symbols)
    .all();
  return results || [];
}

/** 写行情快照。用 UPSERT：同一 symbol 只保留最新一条。 */
export async function writeQuotes(db, quotes) {
  if (!quotes.length) return;
  const stmts = quotes.map((q) =>
    db.prepare(
      `INSERT INTO quotes
         (symbol, code, market, price, prev_close, open, high, low, volume, amount, currency, quoted_at, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         price = excluded.price, prev_close = excluded.prev_close,
         open = excluded.open, high = excluded.high, low = excluded.low,
         volume = excluded.volume, amount = excluded.amount,
         currency = excluded.currency, quoted_at = excluded.quoted_at,
         fetched_at = excluded.fetched_at`
    ).bind(
      q.symbol, q.code, q.market, q.price, q.prevClose, q.open, q.high, q.low,
      q.volume, q.amount, q.currency, q.quotedAt, Date.now()
    )
  );
  await db.batch(stmts);
}

export async function readCachedKline(db, symbol) {
  const { results } = await db
    .prepare('SELECT date, open, close, high, low, volume FROM klines WHERE symbol = ? ORDER BY date ASC')
    .bind(symbol)
    .all();
  return results || [];
}

export async function writeKline(db, symbol, bars) {
  if (!bars.length) return;
  const stmts = bars.map((b) =>
    db.prepare(
      `INSERT INTO klines (symbol, date, open, close, high, low, volume)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol, date) DO UPDATE SET
         open = excluded.open, close = excluded.close, high = excluded.high,
         low = excluded.low, volume = excluded.volume`
    ).bind(symbol, b.date, b.o, b.c, b.h, b.l, b.v)
  );
  stmts.push(
    db.prepare(
      'INSERT INTO kline_meta (symbol, fetched_at) VALUES (?, ?) ON CONFLICT(symbol) DO UPDATE SET fetched_at = excluded.fetched_at'
    ).bind(symbol, Date.now())
  );
  await db.batch(stmts);
}

export async function klineFetchedAt(db, symbol) {
  const row = await db.prepare('SELECT fetched_at FROM kline_meta WHERE symbol = ?').bind(symbol).first();
  return row ? row.fetched_at : 0;
}

/* --------------------------------------------------------------------------
   业务数据读取
   -------------------------------------------------------------------------- */

export async function readPortfolio(db) {
  const { results: accs } = await db
    .prepare('SELECT id, name, cash FROM accounts ORDER BY sort_order ASC')
    .all();
  const { results: pos } = await db
    .prepare('SELECT * FROM positions ORDER BY account_id ASC, id ASC')
    .all();

  const byAccount = new Map();
  for (const p of pos || []) {
    if (!byAccount.has(p.account_id)) byAccount.set(p.account_id, []);
    let tags = [];
    try { tags = JSON.parse(p.tags || '[]'); } catch { tags = []; }
    byAccount.get(p.account_id).push({
      code: p.code,
      market: p.market,
      name: p.name,
      cost: p.cost,
      shares: p.shares,
      style: p.style,
      aiScore: p.ai_score,
      aiAction: p.ai_action,
      tags: Array.isArray(tags) ? tags : [],
      agent: p.agent,
      alert: p.alert,
      stale: !!p.stale,
    });
  }

  return (accs || []).map((a) => ({
    id: a.id,
    name: a.name,
    cash: a.cash,
    positions: byAccount.get(a.id) || [],
  }));
}

/**
 * 整体替换账户与持仓。
 * 不做增量 diff —— 持仓是一次几十行的量级，全删全插比 diff 更简单也更不容易错，
 * 而且天然处理了「删掉一个账户」「把股票从 A 账户挪到 B 账户」这类情况。
 */
export async function replacePortfolio(db, accounts) {
  const stmts = [db.prepare('DELETE FROM positions'), db.prepare('DELETE FROM accounts')];
  (accounts || []).forEach((a, i) => {
    stmts.push(
      db.prepare('INSERT INTO accounts (id, name, cash, sort_order) VALUES (?, ?, ?, ?)')
        .bind(String(a.id), String(a.name || a.id), Number(a.cash) || 0, i)
    );
    (a.positions || []).forEach((p) => {
      stmts.push(
        db.prepare(
          `INSERT INTO positions
             (account_id, code, market, name, cost, shares, style, ai_score, ai_action, tags, agent, alert, stale)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          String(a.id), String(p.code), String(p.market || 'cn'), String(p.name || p.code),
          Number(p.cost) || 0, Number(p.shares) || 0,
          p.style || null,
          p.aiScore == null ? null : Number(p.aiScore),
          p.aiAction || null,
          JSON.stringify(Array.isArray(p.tags) ? p.tags : []),
          p.agent || null, p.alert || null, p.stale ? 1 : 0
        )
      );
    });
  });
  await db.batch(stmts);
}

export async function readWatchlist(db) {
  const { results } = await db
    .prepare('SELECT code, market, name, note, ai_score FROM watchlist ORDER BY sort_order ASC')
    .all();
  return (results || []).map((w) => ({
    code: w.code, market: w.market, name: w.name, note: w.note, aiScore: w.ai_score,
  }));
}

export async function replaceWatchlist(db, rows) {
  const stmts = [db.prepare('DELETE FROM watchlist')];
  (rows || []).forEach((w, i) => {
    stmts.push(
      db.prepare('INSERT INTO watchlist (code, market, name, note, ai_score, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(String(w.code), String(w.market || 'cn'), String(w.name || w.code),
          w.note || null, w.aiScore == null ? null : Number(w.aiScore), i)
    );
  });
  await db.batch(stmts);
}

export async function readAlerts(db) {
  const { results } = await db
    .prepare('SELECT * FROM alerts ORDER BY sort_order ASC')
    .all();
  return (results || []).map((a) => {
    let conds = [], channels = [];
    try { conds = JSON.parse(a.conds || '[]'); } catch { conds = []; }
    try { channels = JSON.parse(a.channels || '[]'); } catch { channels = []; }
    return {
      id: a.id, code: a.code, market: a.market, name: a.name,
      enabled: !!a.enabled, logic: a.logic,
      conds: Array.isArray(conds) ? conds : [],
      scope: a.scope, cooldown: a.cooldown, dailyCap: a.daily_cap,
      repeat: a.repeat_mode, channels: Array.isArray(channels) ? channels : [],
      fired: a.fired, lastFired: a.last_fired,
    };
  });
}

export async function replaceAlerts(db, rows) {
  const stmts = [db.prepare('DELETE FROM alerts')];
  (rows || []).forEach((a, i) => {
    stmts.push(
      db.prepare(
        `INSERT INTO alerts
           (id, code, market, name, enabled, logic, conds, scope, cooldown, daily_cap, repeat_mode, channels, fired, last_fired, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        String(a.id), String(a.code), String(a.market || 'cn'), String(a.name || a.code),
        a.enabled ? 1 : 0, a.logic || 'OR',
        JSON.stringify(Array.isArray(a.conds) ? a.conds : []),
        a.scope || null, a.cooldown || null,
        a.dailyCap == null ? null : Number(a.dailyCap),
        a.repeat || null,
        JSON.stringify(Array.isArray(a.channels) ? a.channels : []),
        Number(a.fired) || 0, a.lastFired || null, i
      )
    );
  });
  await db.batch(stmts);
}

/* --------------------------------------------------------------------------
   设置：键值对，值统一 JSON
   -------------------------------------------------------------------------- */

export async function readSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of results || []) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

export async function writeSettings(db, patch) {
  const entries = Object.entries(patch || {});
  if (!entries.length) return;
  const now = Date.now();
  await db.batch(
    entries.map(([k, v]) =>
      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).bind(k, JSON.stringify(v), now)
    )
  );
}
