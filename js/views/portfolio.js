/* ==========================================================================
   持仓页 · 多账户汇总 + 持仓 / 关注
   ========================================================================== */

import { icon } from '../icons.js';
import { money, pct, dirClass, hhmm, hhmmss, esc, thousands } from '../utils.js';
import { PORTFOLIO, WATCHLIST, MARKETS } from '../data.js';
import { statCard, accountCard, stockRow, pageHead, emptyState, switchEl } from '../ui.js';
import { sparkline } from '../charts.js';
import * as store from '../store.js';

export function render() {
  const s = store.get();
  const t = PORTFOLIO.total;
  const tab = s.portfolioTab;
  const mf = s.marketFilter;

  // 按市场筛选
  const accounts = PORTFOLIO.accounts.map((a) => ({
    ...a,
    positions: mf === 'all' ? a.positions : a.positions.filter((p) => p.market === mf),
  })).filter((a) => a.positions.length);

  const watch = mf === 'all' ? WATCHLIST : WATCHLIST.filter((w) => w.market === mf);

  const holdingsCount = PORTFOLIO.total.count;
  const watchCount = WATCHLIST.length;

  return `
  ${pageHead('持仓', `${hhmmss()} 更新`, `
    <button class="icon-btn" data-act="refresh" title="刷新">${icon('refresh')}</button>
    <button class="icon-btn" data-act="scan" title="全市场扫描">${icon('search')}</button>
    <button class="icon-btn icon-btn--accent" data-act="add-position" title="添加股票">${icon('plus')}</button>
  `)}

  <!-- 市场筛选 + 自动刷新 -->
  <div class="scroll-x" style="margin-bottom:11px">
    <button class="filter-pill" data-filter-market="all" aria-pressed="${mf === 'all'}" type="button">全部市场</button>
    ${Object.entries(MARKETS).map(([k, m]) => `
      <button class="filter-pill" data-filter-market="${k}" aria-pressed="${mf === k}" type="button">${m.label}</button>
    `).join('')}
    <span style="display:inline-flex;align-items:center;gap:7px;padding-left:6px;
      font-size:11.5px;color:var(--ink-3)">
      ${switchEl(s.settings.autoRefresh, 'data-act="toggle-auto-refresh"')}
      <span>自动刷新 ${s.settings.refreshSec}s</span>
    </span>
  </div>

  <!-- 汇总 -->
  <div class="stat-grid">
    ${statCard({
      label: '总市值', iconName: 'wallet', tone: 'accent',
      value: money(t.mv).replace(/[万亿].*$/, ''),
      unit: (money(t.mv).match(/[万亿]/) || [''])[0],
      // 市值本身没有涨跌语义，走势图固定用强调色，避免和右侧红色盈利数字打架
      spark: t.spark, sparkTone: 'accent',
    })}
    ${statCard({
      label: '总盈亏', iconName: 'trendUp', tone: t.pnl >= 0 ? 'up' : 'down',
      value: money(t.pnl, { sign: true }).replace(/[万亿].*$/, ''),
      unit: (money(t.pnl).match(/[万亿]/) || [''])[0],
      delta: t.pnl, deltaPct: pct(t.pnlPct),
    })}
    ${statCard({
      label: '今日盈亏', iconName: 'activity', tone: t.todayPnl >= 0 ? 'up' : 'down',
      value: money(t.todayPnl, { sign: true }).replace(/[万亿].*$/, ''),
      unit: (money(t.todayPnl).match(/[万亿]/) || [''])[0],
      delta: t.todayPnl, deltaPct: pct(t.todayPct),
    })}
    ${statCard({
      label: '可用资金', iconName: 'bank', tone: 'sage',
      value: money(t.cash).replace(/[万亿].*$/, ''),
      unit: (money(t.cash).match(/[万亿]/) || [''])[0],
      foot: `占总资产 ${(100 - t.positionRatio).toFixed(1)}%`,
    })}
  </div>

  <!-- 总资产 + 仓位 -->
  <div class="card card--pad" style="margin-top:9px">
    <div style="display:flex;align-items:baseline;gap:8px">
      <span style="font-size:11.5px;color:var(--ink-3)">总资产</span>
      <span class="num" style="font-size:22px;font-weight:700;letter-spacing:-0.5px">${money(t.totalAssets)}</span>
      <span style="margin-left:auto;font-size:11.5px;color:var(--ink-3)">
        仓位 <b class="num" style="color:var(--ink)">${t.positionRatio.toFixed(1)}%</b>
      </span>
    </div>
    <div class="bar" style="margin-top:9px">
      <div class="bar__fill" style="width:${t.positionRatio.toFixed(1)}%"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:10.5px;color:var(--ink-3)">
      <span>持仓市值 ${money(t.mv)}</span>
      <span>现金 ${money(t.cash)}</span>
    </div>
  </div>

  <!-- 持仓 / 关注 -->
  <div style="display:flex;align-items:center;margin:16px 0 10px">
    <div class="segmented">
      <button class="segmented__btn" data-tab="holdings" aria-selected="${tab === 'holdings'}" type="button">
        持仓<span class="cnt">${holdingsCount}</span>
      </button>
      <button class="segmented__btn" data-tab="watch" aria-selected="${tab === 'watch'}" type="button">
        关注<span class="cnt">${watchCount}</span>
      </button>
    </div>
    <span style="flex:1"></span>
    ${tab === 'holdings'
      ? `<button class="btn btn--sm btn--ghost" data-act="collapse-all" type="button">${icon('layers')}折叠</button>`
      : `<button class="btn btn--sm btn--primary" data-act="add-watch" type="button">${icon('plus')}加自选</button>`}
  </div>

  ${tab === 'holdings'
    ? (accounts.length
        ? accounts.map((a) => accountCard(a)).join('')
        : emptyState('该市场暂无持仓', 'wallet'))
    : (watch.length
        ? `<div class="list">${watch.map((w) => stockRow(w, { mode: 'watch' })).join('')}</div>`
        : emptyState('该市场暂无关注', 'eye'))}

  <button class="fab" data-act="add-position" type="button" title="添加股票">${icon('plus')}</button>
  `;
}

/* --------------------------------------------------------------------------
   底部弹层：添加股票 / 全市场扫描
   -------------------------------------------------------------------------- */

export function sheetAddPosition() {
  return {
    title: '添加股票',
    body: `
      <div class="field">
        <label class="field__label">股票代码或名称</label>
        <input class="input" placeholder="如 600519 / 贵州茅台 / NVDA" data-input="stock-query">
        <div class="field__hint">支持 A 股（6 位数字）、港股（5 位数字）、美股（字母代码）</div>
      </div>
      <div class="field">
        <label class="field__label">账户</label>
        <select class="input" data-input="account">
          ${PORTFOLIO.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field">
          <label class="field__label">成本价</label>
          <input class="input" type="number" step="0.01" placeholder="0.00" data-input="cost">
        </div>
        <div class="field">
          <label class="field__label">持仓数量</label>
          <input class="input" type="number" step="100" placeholder="0" data-input="shares">
        </div>
      </div>
      <div class="field">
        <label class="field__label">交易风格</label>
        <div class="scroll-x" style="margin:0">
          <button class="filter-pill" aria-pressed="true" data-style="短线" type="button">短线</button>
          <button class="filter-pill" aria-pressed="false" data-style="波段" type="button">波段</button>
          <button class="filter-pill" aria-pressed="false" data-style="长线" type="button">长线</button>
        </div>
        <div class="field__hint">风格会影响 AI 建议的持仓周期与止损幅度</div>
      </div>
      <div class="notice">${icon('info')}
        <span>这是<b>演示版本</b>，数据保存在本地浏览器，不会上传到任何服务器。</span>
      </div>`,
    okText: '添加持仓',
    onOk: () => ({ toast: '已添加（演示数据，刷新后重置）' }),
  };
}

export function sheetScan() {
  const rows = WATCHLIST.slice(0, 6);
  return {
    title: '全市场扫描',
    body: `
      <div class="notice">${icon('cpu')}
        <span>扫描 A 股 / 港股 / 美股全市场，按 <b>技术形态 + 资金流 + 基本面</b> 三维打分，筛出评分 ≥ 65 的标的。</span>
      </div>
      <div class="meter" style="margin-bottom:12px">
        <span class="meter__label" style="width:52px">进度</span>
        <span class="bar"><span class="bar__fill" style="width:100%"></span></span>
        <span class="meter__val" style="width:36px">100%</span>
      </div>
      <div class="section-title" style="margin-top:4px">${icon('spark')}<span>命中 ${rows.length} 只</span></div>
      <div class="list">
        ${rows.map((w) => stockRow(w, { mode: 'watch' })).join('')}
      </div>`,
    okText: '全部加入关注',
    onOk: () => ({ toast: `已加入 ${rows.length} 只到关注列表` }),
  };
}
