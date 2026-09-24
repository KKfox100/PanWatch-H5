/* ==========================================================================
   模拟盘 · 净值曲线 + 绩效
   ========================================================================== */

import { icon } from '../icons.js';
import { money, pct, price, dirClass, esc, thousands, ymd } from '../utils.js';
import { PAPER, PAPER_NAV, PAPER_HOLDINGS } from '../data.js';
import { pageHead, marketBadge } from '../ui.js';
import { areaChart } from '../charts.js';
import * as store from '../store.js';

const RANGES = [
  { key: '1M', n: 22 },
  { key: '3M', n: 66 },
  { key: '6M', n: 120 },
  { key: '1Y', n: 120 },
];

export function render() {
  const s = store.get();
  const range = s.paperRange || '3M';
  const cfg = RANGES.find((r) => r.key === range) || RANGES[1];
  const data = PAPER_NAV.slice(-cfg.n);

  const first = data[0]?.nav ?? 1;
  const last = data[data.length - 1]?.nav ?? 1;
  const rangeReturn = ((last - first) / first) * 100;

  const nav = PAPER.nav;
  const navAmount = PAPER.initial * nav;
  const profit = navAmount - PAPER.initial;

  const st = PAPER.stats;

  return `
  ${pageHead('模拟盘', `${esc(PAPER.name)} · 自 ${PAPER.startedAt}`, `
    <button class="icon-btn" data-act="paper-settings" title="策略设置">${icon('gear')}</button>
  `)}

  <div class="notice">${icon('info')}
    <span>模拟盘按 AI 信号自动跟单，初始资金 <b>¥100 万</b>，不计手续费与滑点。
      用于验证策略有效性，<b>不涉及真实资金</b>。
      交易记录与策略信号均为演示数据，净值曲线是示意形状 —— 本站没有存每日快照。</span>
  </div>

  <!-- 净值主卡 -->
  <div class="chart-wrap" style="margin-bottom:10px">
    <div class="chart-wrap__head">
      <span class="chart-wrap__title">策略净值</span>
      <span class="chart-wrap__val ${dirClass(st.totalReturn)}">${nav.toFixed(4)}</span>
    </div>
    <div style="display:flex;align-items:baseline;gap:9px;margin-bottom:9px">
      <span class="num ${dirClass(profit)}" style="font-size:20px;font-weight:700">
        ${money(profit, { sign: true })}</span>
      <span class="chip chip--${st.totalReturn >= 0 ? 'up' : 'down'}">累计 ${pct(st.totalReturn)}</span>
      <span class="range-tabs">
        ${RANGES.map((r) => `
          <button data-paper-range="${r.key}" aria-pressed="${range === r.key}" type="button">${r.key}</button>
        `).join('')}
      </span>
    </div>
    ${areaChart(data, { w: 320, h: 150, showAxis: true })}
    <div style="display:flex;gap:16px;margin-top:9px;padding-top:9px;border-top:1px solid var(--line-soft)">
      <span style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink-3)">
        <i style="width:14px;height:2px;background:var(--up-fill);border-radius:var(--r-full);display:block"></i>策略净值
      </span>
      <span style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink-3)">
        <i style="width:14px;height:0;border-top:2px dashed var(--ink-3);display:block"></i>沪深300 基准
      </span>
      <span style="flex:1"></span>
      <span style="font-size:11px;color:var(--ink-3)">区间 <b class="num ${dirClass(rangeReturn)}">${pct(rangeReturn)}</b></span>
    </div>
  </div>

  <!-- 绩效指标 -->
  <div class="section-title">${icon('target')}<span>绩效指标</span></div>
  <div class="kv-grid" style="grid-template-columns:repeat(3,1fr);margin-top:0">
    ${perfCell('累计收益', pct(st.totalReturn), st.totalReturn)}
    ${perfCell('年化收益', pct(st.annualized), st.annualized)}
    ${perfCell('最大回撤', pct(st.maxDrawdown), st.maxDrawdown)}
    ${perfCell('夏普比率', st.sharpe.toFixed(2), st.sharpe - 1)}
    ${perfCell('胜率', st.winRate.toFixed(1) + '%', st.winRate - 50)}
    ${perfCell('交易次数', String(st.trades), 0, true)}
  </div>

  <!-- 持仓 -->
  <div class="section-title">${icon('wallet')}<span>模拟持仓</span>
    <span class="section-title__spacer"></span>
    <span class="section-title__more">${PAPER_HOLDINGS.length} 只</span>
  </div>
  <div class="list">
    ${PAPER_HOLDINGS.map((h) => `
      <button class="stock" data-stock="${h.code}" type="button">
        <span class="stock__id">
          <span class="stock__row1">
            ${marketBadge(h.market)}
            <span class="stock__name">${esc(h.name)}</span>
            <span class="stock__code">${esc(h.code)}</span>
          </span>
          <span class="stock__row2" style="color:var(--ink-3);font-size:11px">
            <span>成本 <b class="num" style="color:var(--ink-2)">${price(h.cost)}</b></span>
            <span>·</span>
            <span>${thousands(h.shares)} 股</span>
          </span>
          <span class="stock__row2" style="margin-top:6px">
            <span class="bar" style="width:100%">
              <span class="bar__fill ${h.pnl >= 0 ? 'bar__fill--up' : 'bar__fill--down'}"
                style="width:${(h.weight * 4).toFixed(0)}%"></span>
            </span>
            <span class="num" style="font-size:10.5px;color:var(--ink-3)">权重 ${h.weight.toFixed(1)}%</span>
          </span>
        </span>
        <span class="stock__figs">
          <div>
            <dt>现价</dt>
            <dd class="${dirClass(h.chgPct)}">${price(h.price)}</dd>
            <dd class="sub ${dirClass(h.chgPct)}">${pct(h.chgPct)}</dd>
          </div>
          <div>
            <dt>盈亏</dt>
            <dd class="${dirClass(h.pnl)}">${money(h.pnl, { sign: true })}</dd>
            <dd class="sub ${dirClass(h.pnlPct)}">${pct(h.pnlPct)}</dd>
          </div>
        </span>
      </button>
    `).join('')}
  </div>

  <!-- 最近交易 -->
  <div class="section-title">${icon('activity')}<span>最近交易</span></div>
  <div class="card card--pad" style="padding:4px 13px">
    ${PAPER.recentTrades.map((t) => `
      <div style="display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid var(--line-soft)">
        <span class="list__icon ${t.side === 'buy' ? 'list__icon--up' : 'list__icon--down'}">
          ${icon(t.side === 'buy' ? 'arrowDown' : 'arrowUp')}
        </span>
        <span style="flex:1;min-width:0">
          <span style="display:block;font-size:13px;font-weight:600">
            ${t.side === 'buy' ? '买入' : '卖出'} ${esc(t.name)}
            <span class="stock__code">${esc(t.code)}</span>
          </span>
          <span style="display:block;font-size:11px;color:var(--ink-3);margin-top:2px">
            ${esc(t.time)} · ${thousands(t.shares)} 股 @ ${price(t.price)}
          </span>
        </span>
        <span style="text-align:right;flex:none">
          ${t.pnl != null
            ? `<span class="num ${dirClass(t.pnl)}" style="font-size:13px;font-weight:650">
                 ${money(t.pnl, { sign: true })}</span>
               <span style="display:block;font-size:10.5px;color:var(--ink-3)">已实现</span>`
            : `<span class="chip chip--accent">持仓中</span>`}
        </span>
      </div>
    `).join('')}
  </div>

  <div style="height:8px"></div>
  `;
}

function perfCell(label, text, raw, neutral = false) {
  const cls = neutral ? '' : dirClass(raw);
  return `<dl class="kv">
    <dt>${label}</dt>
    <dd class="${cls}">${text}</dd>
  </dl>`;
}
