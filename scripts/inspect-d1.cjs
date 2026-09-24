/* 直接读磁盘上的 D1 SQLite 文件，证明数据真的落盘了（而不是活在 Worker 进程内存里）。
   跑法： node scripts/inspect-d1.cjs <state 目录> */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2] || path.join(
  process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local'),
  'Temp', 'panwatch-wrangler-state'
);

const dir = path.join(root, 'v3', 'd1', 'miniflare-D1DatabaseObject');
if (!fs.existsSync(dir)) {
  console.error('找不到 D1 目录：' + dir);
  process.exit(1);
}

const file = fs.readdirSync(dir).filter((x) => x.endsWith('.sqlite') && x !== 'metadata.sqlite')[0];
if (!file) {
  console.error('目录里没有 .sqlite 文件：' + dir);
  process.exit(1);
}

const db = new DatabaseSync(path.join(dir, file), { readOnly: true });
const all = (sql) => db.prepare(sql).all();
const one = (sql) => db.prepare(sql).get();

console.log('磁盘上的 D1 文件：');
console.log('  ' + file);
console.log('  大小 ' + fs.statSync(path.join(dir, file)).size + ' 字节');
console.log();

console.log('表：' + all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .map((t) => t.name).join(', '));
console.log();

console.log('alerts：');
for (const r of all('SELECT id, code, name, enabled FROM alerts ORDER BY id')) {
  console.log('  ' + r.id + '  ' + r.code + '  ' + r.name + '  enabled=' + r.enabled);
}
console.log();

console.log('accounts：');
for (const r of all('SELECT id, name, cash FROM accounts ORDER BY sort_order')) {
  console.log('  ' + r.id + '  ' + r.name + '  cash=' + r.cash);
}
console.log();

console.log('positions（只看 600519）：');
for (const r of all("SELECT account_id, code, name, cost, shares FROM positions WHERE code='600519'")) {
  console.log('  ' + r.account_id + '  ' + r.code + '  ' + r.name + '  cost=' + r.cost + '  shares=' + r.shares);
}
console.log();

console.log('settings：');
for (const r of all('SELECT key, value FROM settings ORDER BY key')) {
  console.log('  ' + r.key + ' = ' + r.value);
}
console.log();

console.log('行情缓存：quotes ' + one('SELECT COUNT(*) AS n FROM quotes').n
  + ' 行，klines ' + one('SELECT COUNT(*) AS n FROM klines').n
  + ' 行，kline_meta ' + one('SELECT COUNT(*) AS n FROM kline_meta').n + ' 行');
const newest = one('SELECT MAX(fetched_at) AS t FROM quotes');
if (newest && newest.t) {
  console.log('  quotes 最新抓取时刻：' + new Date(newest.t).toISOString());
}
db.close();
