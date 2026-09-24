/* ==========================================================================
   首页 · 今日概览
   ========================================================================== */

import { icon } from '../icons.js';
import { money, pct, price, dirClass, hhmm, marketPhase, phaseLabel, esc } from '../utils.js';
import { PORTFOLIO, INDEX_DATA, NEWS, PREMARKET, PAPER, PAPER_NAV } from '../data.js';
import { statCard, stockRow, pageHead, actionChip } from '../ui.js';
import { sparkline, areaChart } from '../charts.js';

export function render() {
  const t = PORTFOLIO.total;
  const phase = marketPhase();

  // 今日涨跌最大的三只持仓（持仓速览）
  const all = PORTFOLIO.accounts.flatMap((a) => a.positions);
  const movers = [...all].sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct)).slice(0, 4);

  const navSeries = PAPER_NAV.slice(-40);

  return `
  ${pageHead('今日概览', `${phaseLabel(phase)} · 更新于 ${hhmm()}`, `
    <button class="icon-btn" data-act="refresh" title="刷新">${icon('refresh')}</button>
  `)}

  <!-- 指数横条 -->
  <div class="index-strip">
    ${INDEX_DATA.map((i) => `
      <button class="index-card" data-stock="${i.code}" data-index="1" type="button">
        <div class="index-card__name">${esc(i.name)}</div>
        <div class="index-card__val">${price(i.price)}</div>
        <div class="index-card__pct ${dirClass(i.chgPct)}">${pct(i.chgPct)}</div>
      </button>
    `).join('')}
  </div>

  <!-- 资产总览 -->
  <div class="section-title">${icon('wallet')}<span>我的资产</span>
    <span class="section-title__spacer"></span>
    <span class="section-title__more">${t.count} 只持仓</span>
  </div>

  <div class="stat-grid">
    ${statCard({
      label: '总资产', iconName: 'layers', tone: 'accent',
      value: money(t.totalAssets).replace(/[万亿].*$/, ''),
      unit: (money(t.totalAssets).match(/[万亿]/) || [''])[0],
      delta: t.todayPnl,
      // 只放今日金额，百分比留给持仓页 —— 两段拼一起在半宽卡片里必然折行
      deltaPct: `今日 ${money(t.todayPnl, { sign: true })}`,
      foot: `<span>市值 ${money(t.mv)}</span><span>现金 ${money(t.cash)}</span>`,
      footSplit: true,
    })}
    ${statCard({
      label: '总盈亏', iconName: t.pnl >= 0 ? 'trendUp' : 'trendDown',
      tone: t.pnl >= 0 ? 'up' : 'down',
      value: money(t.pnl, { sign: true }).replace(/[万亿].*$/, ''),
      unit: (money(t.pnl).match(/[万亿]/) || [''])[0],
      delta: t.pnl,
      deltaPct: pct(t.pnlPct),
      foot: `成本 ${money(t.cost)}`,
    })}
  </div>

  <!-- 净值走势 -->
  <!-- 账户净值走势
       ⚠️ 这条曲线是伪随机生成的**示意形状**，不是真实历史净值 ——
          本站没有存每日快照。顶栏说「实时」指的是报价，不包括这条曲线，
          所以必须在这里单独标出来。右侧那个百分比倒是真的（持仓今日涨跌）。 -->
  <div class="section-title">${icon('activity')}<span>账户净值走势</span>
    <span class="section-title__spacer"></span>
    <span class="chip chip--outline">曲线示意</span>
  </div>
  <div class="chart-wrap">
    <div class="chart-wrap__head">
      <span class="chart-wrap__title">近 40 个交易日</span>
      <span class="chart-wrap__val ${dirClass(t.todayPct)}">${pct(t.todayPct)}</span>
    </div>
    ${areaChart(navSeries.map((d, i) => ({ nav: d.nav * 1000 })), { w: 320, h: 130, showAxis: true })}
    <div class="field__hint" style="margin-top:8px">
      曲线形状为示意，未存每日快照；右侧百分比是持仓的今日涨跌。
    </div>
  </div>

  <!-- AI 盘前分析 -->
  <div class="section-title">${icon('brain')}<span>AI 盘前分析</span>
    <span class="section-title__spacer"></span>
    <span class="chip chip--outline">演示内容</span>
    <span class="section-title__more">${esc(PREMARKET.generatedAt)}</span>
  </div>

  <div class="ai-block">
    <div class="ai-block__head">${icon('brain')}<span class="ai-block__title">今日策略摘要</span></div>
    <div class="ai-block__body">${PREMARKET.summary}</div>
    <div style="margin-top:11px;display:flex;flex-direction:column;gap:7px">
      ${PREMARKET.suggestions.map((s) => `
        <button class="list__item" style="padding:9px 10px;background:var(--surface);border-radius:var(--r-sm);border:1px solid var(--line-soft)"
          data-stock="${s.code}" type="button">
          <span class="list__body">
            <span class="list__title" style="font-size:12.5px">${esc(s.name)}
              <span class="stock__code">${esc(s.code)}</span></span>
            <span class="list__desc" style="white-space:normal">${esc(s.reason)}</span>
          </span>
          <span class="list__tail">${actionChip(s.action)}${icon('chevronRight')}</span>
        </button>
      `).join('')}
    </div>
  </div>

  <!-- 异动速览 -->
  <div class="section-title">${icon('flame')}<span>持仓异动</span>
    <span class="section-title__spacer"></span>
    <button class="section-title__more" data-nav="portfolio" type="button">全部持仓 ›</button>
  </div>
  <div class="list">
    ${movers.map((s) => stockRow(s, { mode: 'watch' })).join('')}
  </div>

  <!-- 模拟盘 -->
  <div class="section-title">${icon('chart')}<span>模拟盘</span>
    <span class="section-title__spacer"></span>
    <button class="section-title__more" data-nav="paper" type="button">详情 ›</button>
  </div>
  <div class="card card--pad">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:620">${esc(PAPER.name)}</div>
        <div style="font-size:11px;color:var(--ink-3);margin-top:2px">净值 ${PAPER.nav.toFixed(4)} · 自 ${PAPER.startedAt}</div>
      </div>
      <div style="text-align:right">
        <div class="num ${dirClass(PAPER.stats.totalReturn)}" style="font-size:18px;font-weight:680">
          ${pct(PAPER.stats.totalReturn)}</div>
        <div style="font-size:10.5px;color:var(--ink-3)">累计收益</div>
      </div>
    </div>
    <div style="margin-top:10px">${sparkline(PAPER_NAV.slice(-30).map((d) => d.nav), { w: 300, h: 38, up: true })}</div>
  </div>

  <!-- 快讯 -->
  <div class="section-title">${icon('news')}<span>市场快讯</span>
    <span class="section-title__spacer"></span>
    <span class="section-title__more">实时</span>
  </div>
  <div class="card card--pad">
    ${NEWS.map((n) => `
      <article class="news">
        <time class="news__time">${esc(n.time)}</time>
        <div class="news__body">
          <h3 class="news__title">${esc(n.title)}</h3>
          <p class="news__desc">${esc(n.desc)}</p>
          <div class="news__tags">
            ${n.tags.map((t) => `<span class="chip ${t.includes('持仓') ? 'chip--accent' : 'chip--outline'}">${esc(t)}</span>`).join('')}
          </div>
        </div>
      </article>
    `).join('')}
  </div>

  <div style="height:8px"></div>
  `;
}
