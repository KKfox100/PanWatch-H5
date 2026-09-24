/* ==========================================================================
   后端 API 客户端
   --------------------------------------------------------------------------
   约定：**任何失败都不抛到调用方之外** 是不可能的，所以这里保持
   「正常路径抛异常、由 live.js 统一兜住」—— 抛异常是对的，
   因为静默吞掉错误会让「后端挂了」表现成「数据是 0」，更难查。

   同源优先：apiBase 留空时用相对路径 /api/*，也就是和静态资源同一个
   Worker。这样部署一次就有后端，不需要额外配置。
   ========================================================================== */

import * as store from './store.js';

/** 超时。行情接口上游偶尔会慢，但超过这个时间还不如让用户看到降级状态。 */
const TIMEOUT_MS = 12000;

function base() {
  const b = String(store.get().settings.apiBase || '').trim();
  return b.replace(/\/+$/, ''); // 留空 = 同源
}

function token() {
  return String(store.get().settings.apiToken || '').trim();
}

export function hasToken() {
  return !!token();
}

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && token()) headers.Authorization = `Bearer ${token()}`;

  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    init.signal = AbortSignal.timeout(TIMEOUT_MS);
  }

  const res = await fetch(base() + path, init);

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error(
      (data && (data.message || data.error)) || `接口返回 ${res.status}`
    );
    err.status = res.status;
    err.code = data && data.error;
    throw err;
  }
  return data;
}

/* ---- 读 ---- */

export const health = () => request('/api/health');
export const getState = () => request('/api/state');

export function getQuotes(symbols) {
  if (!symbols.length) return Promise.resolve({ quotes: [] });
  return request('/api/quotes?symbols=' + encodeURIComponent(symbols.join(',')));
}

export function getKline(symbol, days = 60) {
  return request(`/api/kline?symbol=${encodeURIComponent(symbol)}&days=${days}`);
}

/* ---- 写（需要 token） ---- */

export const putPortfolio = (accounts) =>
  request('/api/portfolio', { method: 'PUT', body: { accounts }, auth: true });

export const putWatchlist = (watchlist) =>
  request('/api/watchlist', { method: 'PUT', body: { watchlist }, auth: true });

export const putAlerts = (alerts) =>
  request('/api/alerts', { method: 'PUT', body: { alerts }, auth: true });

export const putSettings = (settings) =>
  request('/api/settings', { method: 'PUT', body: { settings }, auth: true });
