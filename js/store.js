/* ==========================================================================
   状态层：本地偏好持久化 + 极简发布订阅
   --------------------------------------------------------------------------
   只持久化「用户改过的东西」（主题、筛选、提醒开关、设置），
   演示数据本身不入库，刷新后始终是干净的一份。
   ========================================================================== */

const KEY = 'panwatch-h5:v1';

const DEFAULTS = {
  theme: 'auto',              // auto | light | dark
  portfolioTab: 'holdings',   // holdings | watch
  marketFilter: 'all',        // all | cn | hk | us
  opportunityFilter: 'all',
  alertStates: {},            // { [alertId]: boolean }
  paperRange: '3M',           // 1M | 3M | 6M | 1Y
  settings: {
    // 留空 = 同源（和静态资源同一个 Worker）。自建后端时才需要填。
    apiBase: '',
    // 写入令牌。服务端设了 WRITE_TOKEN 就必须在这里填一致的，否则写操作 401。
    // ⚠️ 它存在浏览器 localStorage 里 —— 能打开这个页面的人就能读到它。
    //    这是「无登录单租户」的固有代价，别把它当成真正的账号体系。
    apiToken: '',
    refreshSec: 30,
    autoRefresh: true,
    channels: { telegram: true, wechat: true, dingtalk: false, feishu: false, bark: false, webhook: false },
    riskLevel: 'balanced',
  },
  onboarded: false,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    // 浅合并，保证新增字段有默认值
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      settings: { ...DEFAULTS.settings, ...(parsed.settings || {}),
        channels: { ...DEFAULTS.settings.channels, ...(parsed.settings?.channels || {}) } },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

let state = load();
const listeners = new Set();

export function get() {
  return state;
}

export function set(patch) {
  state = { ...state, ...patch };
  persist();
  emit();
}

export function setSetting(key, value) {
  state = { ...state, settings: { ...state.settings, [key]: value } };
  persist();
  emit();
}

/**
 * 一次合并多个设置项。
 * 和 setSetting 的区别是「来源」：这个用于把**服务端读回来的**设置灌进来，
 * 不适合表达「用户刚改了一项」。
 */
export function mergeSettings(patch) {
  if (!patch || typeof patch !== 'object') return;
  state = { ...state, settings: { ...state.settings, ...patch } };
  persist();
  emit();
}

export function setChannel(key, value) {
  state = {
    ...state,
    settings: {
      ...state.settings,
      channels: { ...state.settings.channels, [key]: value },
    },
  };
  persist();
  emit();
}

export function toggleAlert(id, value) {
  state = { ...state, alertStates: { ...state.alertStates, [id]: value } };
  persist();
  emit();
}

export function isAlertOn(id, fallback = true) {
  return state.alertStates[id] ?? fallback;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  listeners.forEach((fn) => fn(state));
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 隐私模式下 localStorage 可能不可用，静默降级 */
  }
}

export function reset() {
  state = structuredClone(DEFAULTS);
  persist();
  emit();
}

/* --------------------------------------------------------------------------
   主题：auto 时跟随系统
   -------------------------------------------------------------------------- */

export function applyTheme() {
  const t = state.theme;
  const root = document.documentElement;
  if (t === 'auto') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', t);
  }
  // 同步给浏览器 UI（地址栏配色）
  const dark = root.getAttribute('data-theme') === 'dark';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#232120' : '#efece6');
}

export function resolvedTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.theme === 'auto') applyTheme();
});
