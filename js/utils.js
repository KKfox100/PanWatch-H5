/* ==========================================================================
   工具层：格式化、DOM、图标、伪随机
   ========================================================================== */

/* --------------------------------------------------------------------------
   数值格式化
   -------------------------------------------------------------------------- */

/** 千分位 */
export function thousands(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '--';
  return Number(n).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * 按中国习惯把金额压缩成「万 / 亿」。
 * 45.2 万、3.09 亿 这种读起来比 452000 快得多。
 */
export function money(n, opts = {}) {
  const { sign = false, digits = 2 } = opts;
  if (n === null || n === undefined || Number.isNaN(n)) return '--';
  const v = Number(n);
  const abs = Math.abs(v);
  const s = sign && v > 0 ? '+' : v < 0 ? '-' : '';
  let body;
  if (abs >= 1e8) body = (abs / 1e8).toFixed(digits) + '亿';
  else if (abs >= 1e4) body = (abs / 1e4).toFixed(digits) + '万';
  else body = abs.toFixed(abs < 100 ? 2 : 0);
  return s + body;
}

/** 价格：自动决定小数位（A股2位，美股2位，港股2位，指数2位） */
export function price(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '--';
  return Number(n).toLocaleString('zh-CN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 涨跌幅：带符号，固定两位 */
export function pct(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '--';
  const v = Number(n);
  return (v > 0 ? '+' : '') + v.toFixed(digits) + '%';
}

/** 带符号数值 */
export function signed(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return '--';
  const v = Number(n);
  return (v > 0 ? '+' : '') + thousands(v, digits);
}

/** 涨跌方向 */
export function dir(n) {
  if (n > 0) return 'up';
  if (n < 0) return 'down';
  return 'flat';
}

/** 涨跌对应的 CSS 类 */
export function dirClass(n) {
  const d = dir(n);
  return d === 'up' ? 'up' : d === 'down' ? 'down' : 'flat';
}

/** 货币符号 */
export function curSymbol(code) {
  return code === 'USD' ? '$' : code === 'HKD' ? 'HK$' : '¥';
}

/* --------------------------------------------------------------------------
   DOM
   -------------------------------------------------------------------------- */

/** 用 HTML 字符串创建元素（只取第一个根节点） */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** 批量创建：返回 DocumentFragment */
export function frag(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** HTML 转义，防止数据里的尖括号破坏结构 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** 事件委托 */
export function delegate(root, type, selector, handler) {
  root.addEventListener(type, (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) handler(e, el);
  });
}

/* --------------------------------------------------------------------------
   伪随机：给每只股票生成稳定的走势序列
   用字符串做种子，同一只股票每次刷新走势一致，不会乱跳。
   -------------------------------------------------------------------------- */

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 生成一段随机游走序列，终点强制落在 endValue 上。
 * 这样迷你走势图的末端一定等于当前价，视觉上自洽。
 */
export function series(seed, n, endValue, volatility = 0.02) {
  const rnd = mulberry32(hashSeed(seed));
  const out = [];
  let v = endValue;
  // 从终点往回推，保证最后一个点就是 endValue
  for (let i = 0; i < n; i++) {
    out.unshift(v);
    const drift = (rnd() - 0.5) * volatility * 2;
    v = v / (1 + drift);
  }
  return out;
}

/** 生成 K 线数据：[{o,h,l,c}] */
export function klines(seed, n, endValue, volatility = 0.018) {
  const rnd = mulberry32(hashSeed(seed + ':k'));
  const closes = series(seed, n, endValue, volatility);
  const out = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const o = i === 0 ? c * (1 - (rnd() - 0.5) * volatility) : closes[i - 1];
    const hi = Math.max(o, c) * (1 + rnd() * volatility * 0.7);
    const lo = Math.min(o, c) * (1 - rnd() * volatility * 0.7);
    out.push({ o, h: hi, l: lo, c });
  }
  return out;
}

/* --------------------------------------------------------------------------
   时间
   -------------------------------------------------------------------------- */

export function hhmm(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function hhmmss(d = new Date()) {
  return `${hhmm(d)}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 交易时段判断（A股：9:30-11:30, 13:00-15:00，简化版不考虑节假日） */
export function marketPhase(d = new Date()) {
  const day = d.getDay();
  if (day === 0 || day === 6) return 'closed';
  const m = d.getHours() * 60 + d.getMinutes();
  if (m >= 570 && m <= 690) return 'open';
  if (m > 690 && m < 780) return 'break';
  if (m >= 780 && m <= 900) return 'open';
  if (m < 570) return 'pre';
  return 'post';
}

export function phaseLabel(p) {
  return { open: '交易中', break: '午间休市', pre: '盘前', post: '已收盘', closed: '休市' }[p] || '--';
}

/* --------------------------------------------------------------------------
   杂项
   -------------------------------------------------------------------------- */

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function sum(arr, fn = (x) => x) {
  return arr.reduce((a, b) => a + (fn(b) || 0), 0);
}

/** 简易防抖 */
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** 随机 ID */
export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
