/* ==========================================================================
   实时数据编排层
   --------------------------------------------------------------------------
   职责边界很清楚：

     data.js —— 持有数据，知道怎么重算派生指标
     api.js  —— 只会发请求
     live.js —— 决定「什么时候拉、失败了怎么办、拉回来给谁」   ← 这个文件

   ── 一条硬约束 ──────────────────────────────────────────────────────────
   **没有后端时，站点必须和改造前一模一样地工作。**
   所以 init() 探测失败就直接返回，不抛异常、不显示错误页、不清空数据；
   所有失败都只是把 live.status 变成 offline，界面继续用内置数据，
   并在显眼处标出「演示数据」。
   ========================================================================== */

import * as api from './api.js';
import * as store from './store.js';
import { toSymbol } from './symbols.js';
import {
  collectSymbols, applyQuotes, applyUserData, applyKline, hasKline,
  rawAccounts, rawWatchlist, rawAlerts, setAlertEnabled,
} from './data.js';

export const live = {
  status: 'idle',        // idle | probing | online | offline
  serverVersion: null,
  lastSync: 0,           // 最近一次行情同步成功时刻
  lastError: null,
  quoteTtlMs: 15000,
  writeProtected: false,
  seeded: false,
  applied: 0,
  missing: 0,
  staleCount: 0,
  saving: false,
  // 成功连上过后端并灌入过它的数据吗？
  //
  // 这个标记不是为了好看，是为了不撒谎：连上过再断线时，屏幕上的持仓和价格
  // 是**服务端的数据**，只是不再更新了。这时候标「演示数据」是错的 ——
  // 那会让人以为看到的是一份干净的样本，实际上是上次同步的残留。
  // 所以离线要分成两种说法：「从没连上」（内置演示）和「连上过」（停留于上次同步）。
  everSynced: false,
};

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of [...listeners]) {
    try { fn(live); } catch { /* 某个订阅者报错不该拖垮其他订阅者 */ }
  }
}

let quoteTimer = null;
let settingsTimer = null;
let refreshing = false;

/** 只在本机生效的设置，不回写服务端 */
const LOCAL_ONLY = new Set(['apiBase', 'apiToken']);
/** 会同步到服务端的设置项 */
const SYNCED = ['refreshSec', 'autoRefresh', 'channels', 'riskLevel'];

export function isOnline() {
  return live.status === 'online';
}

/** 数据源文案。界面上必须能一眼看出现在看的是真行情还是演示数据。 */
export function sourceLabel() {
  if (live.status === 'online') {
    // 后端通了 ≠ 行情到手了。health 一成功 status 就是 online，
    // 但第一份报价可能还在路上 —— 这时候屏幕上摆的还是内置样本，
    // 说「实时」就是在撒谎。
    if (!live.lastSync) return live.lastError ? '行情不可用' : '正在拉取行情…';
    if (live.staleCount > 0) return '实时行情 · 部分延迟';
    return '实时行情';
  }
  if (live.status === 'probing') return '正在连接行情服务…';
  if (live.status === 'offline') {
    return live.everSynced ? '已断开 · 停留于上次同步' : '演示数据 · 未连接后端';
  }
  return '演示数据';
}

/** 相对时间，给「x 秒前更新」用 */
export function sinceLabel(ts = live.lastSync) {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return '刚刚';
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  return `${Math.round(s / 3600)} 小时前`;
}

/* --------------------------------------------------------------------------
   启动
   -------------------------------------------------------------------------- */

export async function init() {
  live.status = 'probing';
  live.lastError = null;
  emit();

  // 1) 探测后端。失败就是离线，直接收工 —— 站点继续用内置数据。
  try {
    const h = await api.health();
    if (!h || !h.ok) throw new Error((h && h.databaseError) || '后端未就绪');
    live.serverVersion = h.version || null;
    live.quoteTtlMs = (Number(h.quoteTtlSec) || 15) * 1000;
    live.writeProtected = !!h.writeProtected;
    live.status = 'online';
  } catch (err) {
    live.status = 'offline';
    live.lastError = String((err && err.message) || err);
    emit();
    return live;
  }
  emit();

  // 2) 取服务端数据。持仓决定了要查哪些代码，所以必须在拉行情之前。
  //
  //    ⚠️ 顺序很重要。getState 会把持仓换成本地没有价格的记录（数据库只存
  //       成本与股数，不存价格），此时任何汇总都算不出来。所以这中间
  //       **一次渲染都不能发生**：
  //         · applyUserData 本身不 emit，没问题
  //         · 但服务端设置若在这一步回灌，会触发 store 订阅 → 立即重渲染，
  //           用户就会看到一帧「总资产 --」的坏状态
  //       所以设置回灌挪到行情贴完之后（见下面第 3 步之后）。
  let remoteSettings = null;
  try {
    const st = await api.getState();
    live.seeded = !!st.seededNow;
    applyUserData({ portfolio: st.portfolio, watchlist: st.watchlist, alerts: st.alerts });
    live.everSynced = true;   // 屏幕上的持仓已经换成服务端的了
    if (st.settings && typeof st.settings === 'object') {
      const patch = {};
      for (const k of SYNCED) {
        if (st.settings[k] !== undefined && st.settings[k] !== null) patch[k] = st.settings[k];
      }
      if (Object.keys(patch).length) remoteSettings = patch;
    }
  } catch (err) {
    live.lastError = '读取服务端数据失败：' + String((err && err.message) || err);
  }

  // 3) 拉行情，然后开始定时刷新
  await refresh();

  // 3.5) 行情已经落地，这时再回灌设置。晚一步没有副作用，
  //      早一步就会在「没有价格」的空档里重渲染。
  if (remoteSettings) applyRemoteSettings(remoteSettings);

  startAuto();
  watchStore();
  return live;
}

/* --------------------------------------------------------------------------
   行情刷新
   -------------------------------------------------------------------------- */

export async function refresh() {
  if (live.status !== 'online' || refreshing) return live;
  refreshing = true;
  try {
    const symbols = collectSymbols();
    if (!symbols.length) return live;

    const res = await api.getQuotes(symbols);
    const map = {};
    for (const q of res.quotes || []) map[q.symbol] = q;

    const r = applyQuotes(map);
    live.applied = r.applied;
    live.missing = r.missing;
    live.staleCount = r.staleCount;
    live.lastSync = Date.now();
    live.everSynced = true;
    // 上游报错但缓存兜住了 —— 记下来，但不降级成离线
    live.lastError = res.upstreamError ? `上游异常：${res.upstreamError}` : null;
  } catch (err) {
    // 单次失败不翻成 offline：可能只是这一批超时，界面上还有上一次的价格。
    // 真正的离线判定只发生在启动探测。
    live.lastError = String((err && err.message) || err);
  } finally {
    refreshing = false;
    emit();
  }
  return live;
}

export function startAuto() {
  stopAuto();
  const s = store.get().settings;
  if (!s.autoRefresh) return;
  const sec = Math.max(5, Number(s.refreshSec) || 30);
  quoteTimer = setInterval(() => {
    // 后台标签页不刷：既省上游配额，也避免用户切回来看到一堆过期数据
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    refresh();
  }, sec * 1000);
}

export function stopAuto() {
  if (quoteTimer) clearInterval(quoteTimer);
  quoteTimer = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && live.status === 'online') refresh();
  });
}

/* --------------------------------------------------------------------------
   K 线（详情页）
   -------------------------------------------------------------------------- */

/**
 * 取某只股票的真实日 K。
 * 已经拿到过就不重复请求 —— K 线是按天的，同一会话里没必要来回拉。
 *
 * ⚠️ 这个函数会在 render() 里被调用，而它失败时又会 emit() 触发 render()。
 *    如果不记住「试过了」，请求失败就会变成：
 *      render → loadKline 失败 → emit → render → loadKline 失败 → …
 *    一秒几十次打到上游。所以失败也要登记，一次会话只试一次。
 *
 * @returns {Promise<boolean>} 是否新拿到了数据
 */
const klineTried = new Set();

export async function loadKline(code, market) {
  if (live.status !== 'online') return false;
  const symbol = toSymbol(code, market);
  if (!symbol || hasKline(symbol) || klineTried.has(symbol)) return false;
  klineTried.add(symbol);   // 先登记再发请求
  try {
    const res = await api.getKline(symbol, 60);
    if (applyKline(symbol, res.bars)) {
      emit();
      return true;
    }
  } catch (err) {
    live.lastError = 'K 线加载失败：' + String((err && err.message) || err);
    emit();
  }
  return false;
}

/* --------------------------------------------------------------------------
   写回服务端
   -------------------------------------------------------------------------- */

function describeWriteError(err) {
  if (err && err.status === 401) {
    return '写入被拒绝：需要 token。请到「设置 → 后端 API」填入与服务端 WRITE_TOKEN 一致的令牌。';
  }
  return String((err && err.message) || err);
}

async function write(label, fn) {
  if (live.status !== 'online') {
    return { ok: false, reason: '当前是离线演示模式，改动只保留在本机浏览器里。' };
  }
  live.saving = true;
  emit();
  try {
    await fn();
    live.lastError = null;
    return { ok: true };
  } catch (err) {
    live.lastError = `${label}失败：${describeWriteError(err)}`;
    return { ok: false, reason: live.lastError };
  } finally {
    live.saving = false;
    emit();
  }
}

export const savePortfolio = () => write('保存持仓', () => api.putPortfolio(rawAccounts()));
export const saveWatchlist = () => write('保存自选', () => api.putWatchlist(rawWatchlist()));
export const saveAlerts = () => write('保存提醒', () => api.putAlerts(rawAlerts()));

/** 开关一条提醒：先改本地（界面立刻响应），再回写 */
export function toggleAlert(id, enabled) {
  setAlertEnabled(id, enabled);
  return saveAlerts();
}

/* --------------------------------------------------------------------------
   设置同步
   -------------------------------------------------------------------------- */

let suppressStoreWatch = false;

function syncableSettings() {
  const s = store.get().settings;
  const out = {};
  for (const k of SYNCED) out[k] = s[k];
  return out;
}

function pushSettings() {
  if (live.status !== 'online') return;
  clearTimeout(settingsTimer);
  // 防抖：拖动滑块这类操作会连发很多次变更，没必要每次都打接口
  settingsTimer = setTimeout(() => {
    api.putSettings(syncableSettings()).catch((err) => {
      live.lastError = '设置同步失败：' + describeWriteError(err);
      emit();
    });
  }, 800);
}

let storeWatched = false;
function watchStore() {
  if (storeWatched) return;
  storeWatched = true;
  store.subscribe(() => {
    if (suppressStoreWatch) return;
    pushSettings();
  });
}

/**
 * 把服务端读回来的设置合并进本地。
 * 期间要抑制回写，否则「读回来 → 触发订阅 → 又写回去」会形成一次多余往返。
 */
export function applyRemoteSettings(patch) {
  suppressStoreWatch = true;
  try {
    store.mergeSettings(patch);
  } finally {
    suppressStoreWatch = false;
  }
}

/** 手动触发一次全量同步（设置页的「立即同步」） */
export async function syncNow() {
  if (live.status !== 'online') return refresh();
  await refresh();
  pushSettings();
  return live;
}
