-- ==========================================================================
-- PanWatch H5 · D1 (SQLite) 表结构
-- --------------------------------------------------------------------------
-- 本地：npx wrangler d1 execute panwatch-db --local  --file=./migrations/0001_init.sql
-- 线上：npx wrangler d1 execute panwatch-db --remote --file=./migrations/0001_init.sql
--
-- 其实 worker/db.js 在第一次请求时也会执行一遍同样的 DDL（CREATE TABLE
-- IF NOT EXISTS，幂等），所以忘了跑迁移也不会报错。这个文件的价值是
-- 「表结构有一个可读、可 diff、可进版本库的定义」。
--
-- 单租户模型：整站共享一份数据，写操作用 WRITE_TOKEN 保护。
-- 所以表里**没有 user_id** —— 这是刻意的，不是漏了。
-- 要做多用户的话，每张业务表加 user_id 并把它放进所有主键与索引。
-- ==========================================================================

PRAGMA foreign_keys = ON;

-- --------------------------------------------------------------------------
-- 行情快照缓存
-- --------------------------------------------------------------------------
-- 上游行情按秒变，但没必要每个访客、每次刷新都去打一次上游。
-- 这里存最近一次抓取结果，TTL 内直接读库返回，过期才回源。
-- 顺带得到一份可回溯的行情记录（排查「刚才那个价格哪来的」很有用）。
CREATE TABLE IF NOT EXISTS quotes (
  symbol     TEXT PRIMARY KEY,   -- 带市场前缀：sh600519 / sz300418 / hk00700 / usAAPL
  code       TEXT NOT NULL,      -- 不带前缀：600519 / 00700 / AAPL
  market     TEXT NOT NULL,      -- cn | hk | us
  price      REAL NOT NULL,
  prev_close REAL NOT NULL,
  open       REAL,
  high       REAL,
  low        REAL,
  volume     REAL,               -- 统一成「股」（A股上游给的是手，已 ×100）
  amount     REAL,               -- 统一成「元/港元/美元」（A股上游给的是万元，已 ×10000）
  currency   TEXT,
  quoted_at  TEXT,               -- 上游时间戳，已归一成 YYYY-MM-DD HH:MM:SS
  fetched_at INTEGER NOT NULL    -- 本机抓取时刻，unix ms，用于算 TTL
);

CREATE INDEX IF NOT EXISTS idx_quotes_fetched ON quotes (fetched_at);

-- --------------------------------------------------------------------------
-- 日 K 线缓存
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS klines (
  symbol TEXT NOT NULL,
  date   TEXT NOT NULL,          -- YYYY-MM-DD
  open   REAL NOT NULL,
  close  REAL NOT NULL,
  high   REAL NOT NULL,
  low    REAL NOT NULL,
  volume REAL,
  PRIMARY KEY (symbol, date)
);

-- K 线的抓取时刻单独存一张表：K 线是「按天」的数据，
-- 但「什么时候抓的」跟日期无关，混进 klines 会让每行都冗余一份。
CREATE TABLE IF NOT EXISTS kline_meta (
  symbol     TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL
);

-- --------------------------------------------------------------------------
-- 账户 / 持仓
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  cash       REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- 只存「原始事实」（成本、股数），市值 / 盈亏 / 涨跌幅一律由前端实时算 ——
-- 存派生值就会遇到「行情变了但库里的市值还是旧的」这种自相矛盾。
CREATE TABLE IF NOT EXISTS positions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code       TEXT NOT NULL,
  market     TEXT NOT NULL,
  name       TEXT NOT NULL,
  cost       REAL NOT NULL,
  shares     REAL NOT NULL,
  style      TEXT,
  ai_score   INTEGER,
  ai_action  TEXT,
  tags       TEXT,                        -- JSON 数组
  agent      TEXT,
  alert      TEXT,
  stale      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, code)
);

CREATE INDEX IF NOT EXISTS idx_positions_account ON positions (account_id);

-- --------------------------------------------------------------------------
-- 自选
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watchlist (
  code       TEXT PRIMARY KEY,
  market     TEXT NOT NULL,
  name       TEXT NOT NULL,
  note       TEXT,
  ai_score   INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- --------------------------------------------------------------------------
-- 价格提醒规则
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  market      TEXT NOT NULL,
  name        TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  logic       TEXT NOT NULL DEFAULT 'OR',
  conds       TEXT NOT NULL DEFAULT '[]', -- JSON 数组
  scope       TEXT,
  cooldown    TEXT,
  daily_cap   INTEGER,
  -- 列名不叫 repeat：那是 SQL 里用得很凶的词，避开它省得哪天加引号加漏了
  repeat_mode TEXT,
  channels    TEXT NOT NULL DEFAULT '[]', -- JSON 数组
  fired       INTEGER NOT NULL DEFAULT 0,
  last_fired  TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- --------------------------------------------------------------------------
-- 设置（键值对，值统一存 JSON 文本）
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- --------------------------------------------------------------------------
-- 元信息
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
