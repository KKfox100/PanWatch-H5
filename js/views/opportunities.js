/* ==========================================================================
   机会页 · AI 评分选股
   ========================================================================== */

import { icon } from '../icons.js';
import { pct, price, dirClass, esc } from '../utils.js';
import { OPPORTUNITIES, MARKETS } from '../data.js';
import { pageHead, scoreBadge, marketBadge, emptyState } from '../ui.js';
import { sparkline } from '../charts.js';
import * as store from '../store.js';
import { series } from '../utils.js';

const SORTS = [
  { key: 'score', label: 'AI 评分' },
  { key: 'chg', label: '涨幅' },
  { key: 'risk', label: '风险低' },
];

const RISK_ORDER = { 低: 0, 中: 1, 中高: 2 };

export function render() {
  const s = store.get();
  const mf = s.opportunityFilter || 'all';
  const sort = s.opportunitySort || 'score';

  let items = OPPORTUNITIES.map((o) => {
    const mkt = MARKETS[o.market];
    return {
      ...o,
      marketInfo: mkt,
      currency: mkt.currency,
      chgPct: ((o.price - o.prev) / o.prev) * 100,
      spark: series(o.code, 32, o.price, 0.02),
    };
  });

  if (mf !== 'all') items = items.filter((i) => i.market === mf);

  items.sort((a, b) => {
    if (sort === 'chg') return b.chgPct - a.chgPct;
    if (sort === 'risk') return RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || b.score - a.score;
    return b.score - a.score;
  });

  const avg = items.length
    ? (items.reduce((x, i) => x + i.score, 0) / items.length).toFixed(1) : '--';
  const strong = items.filter((i) => i.score >= 80).length;

  return `
  ${pageHead('机会', `AI 评分 · 均分 ${avg}`, `
    <button class="icon-btn" data-act="rescan" title="重新扫描">${icon('refresh')}</button>
  `)}

  <div class="notice">${icon('brain')}
    <span>基于 <b>技术形态 + 资金流 + 基本面 + 情绪</b> 四维打分。评分仅供研究参考，
      <b>不构成投资建议</b>，请结合自身风险承受能力决策。</span>
  </div>

  <div class="stat-grid" style="margin-bottom:4px">
    <div class="stat stat--accent">
      <div class="stat__label">${icon('spark')}<span>强信号标的</span></div>
      <div class="stat__value">${strong}<span class="unit">只</span></div>
      <div class="stat__foot">评分 ≥ 80 分</div>
    </div>
    <div class="stat stat--sage">
      <div class="stat__label">${icon('target')}<span>入选总数</span></div>
      <div class="stat__value">${items.length}<span class="unit">只</span></div>
      <div class="stat__foot">筛选后结果</div>
    </div>
  </div>

  <div class="scroll-x" style="margin:14px 0 10px">
    <button class="filter-pill" data-filter-opp="all" aria-pressed="${mf === 'all'}" type="button">全部</button>
    ${Object.entries(MARKETS).map(([k, m]) => `
      <button class="filter-pill" data-filter-opp="${k}" aria-pressed="${mf === k}" type="button">${m.label}</button>
    `).join('')}
    <span style="width:1px;background:var(--line);margin:4px 3px"></span>
    ${SORTS.map((x) => `
      <button class="filter-pill" data-sort-opp="${x.key}" aria-pressed="${sort === x.key}" type="button">${x.label}</button>
    `).join('')}
  </div>

  ${items.length ? items.map(oppCard).join('') : emptyState('没有符合条件的标的', 'search')}

  <div style="height:8px"></div>
  `;
}

function oppCard(o) {
  const chgCls = dirClass(o.chgPct);
  const riskTone = o.risk === '低' ? 'sage' : o.risk === '中' ? 'warn' : 'up';

  return `<article class="card card--pad" style="margin-bottom:10px">
    <button data-stock="${o.code}" type="button"
      style="display:flex;align-items:flex-start;gap:11px;width:100%;text-align:left">
      <span style="flex:1;min-width:0">
        <span class="stock__row1">
          ${marketBadge(o.market)}
          <span style="font-size:15px;font-weight:680">${esc(o.name)}</span>
          <span class="stock__code">${esc(o.code)}</span>
        </span>
        <span style="display:flex;align-items:baseline;gap:8px;margin-top:5px">
          <span class="num ${chgCls}" style="font-size:19px;font-weight:700;letter-spacing:-0.4px">${price(o.price)}</span>
          <span class="num ${chgCls}" style="font-size:12.5px;font-weight:620">${pct(o.chgPct)}</span>
        </span>
      </span>
      <span style="text-align:right;flex:none">
        ${scoreBadge(o.score)}
        <span style="display:block;margin-top:5px;height:24px;width:74px">
          ${sparkline(o.spark, { w: 74, h: 24, up: o.chgPct >= 0 })}
        </span>
      </span>
    </button>

    <p style="font-size:12.5px;line-height:1.65;color:var(--ink-2);margin-top:11px">${esc(o.reason)}</p>

    <div style="display:flex;align-items:center;gap:5px;margin-top:10px;flex-wrap:wrap">
      ${o.tags.map((t) => `<span class="chip chip--accent">${esc(t)}</span>`).join('')}
      <span class="chip chip--${riskTone}">风险 ${esc(o.risk)}</span>
      <span style="flex:1"></span>
      <button class="btn btn--sm btn--ghost" data-stock="${o.code}" type="button">看详情</button>
      <button class="btn btn--sm btn--primary" data-act="add-watch-one" data-code="${o.code}" type="button">
        ${icon('plus')}关注
      </button>
    </div>
  </article>`;
}
