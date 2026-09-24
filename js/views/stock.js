/* ==========================================================================
   个股详情页
   ========================================================================== */

import { icon } from '../icons.js';
import { money, pct, price, dirClass, esc, thousands, hhmm } from '../utils.js';
import { findStock, technicals, klineData, ALERTS, AGENT_CHAIN, MARKETS } from '../data.js';
import { pageHead, marketBadge, scoreBadge, actionChip, techRow, emptyState } from '../ui.js';
import { klineChart, sparkline } from '../charts.js';
import * as store from '../store.js';

const RANGES = [
  { key: '1D', n: 30 },
  { key: '1W', n: 40 },
  { key: '1M', n: 60 },
  { key: '3M', n: 80 },
];

export function render(code) {
  const s = findStock(code);
  if (!s) {
    return `${pageHead('未找到标的', esc(code))}
      <div class="empty">${icon('search')}<div>演示数据中没有 ${esc(code)}</div></div>
      <button class="btn btn--ghost btn--block" data-nav="portfolio" type="button">返回持仓</button>`;
  }

  const st = store.get();
  const tab = st.stockTab || 'overview';
  const range = st.stockRange || '1M';
  const cfg = RANGES.find((r) => r.key === range) || RANGES[2];

  const chgCls = dirClass(s.chgPct);
  const bars = klineData(s.code, s.price, cfg.n);
  const tech = technicals(s.code, s.price);

  const held = s.held;
  const relatedAlerts = ALERTS.filter((a) => a.code === s.code);

  return `
  ${pageHead(s.name, `${s.code} · ${s.marketInfo.label}`, `
    <button class="icon-btn" data-act="refresh" title="刷新">${icon('refresh')}</button>
    <button class="icon-btn" data-act="add-alert-for" data-code="${s.code}" title="加提醒">${icon('bell')}</button>
  `)}

  <button class="btn btn--sm btn--ghost" data-back="1" type="button" style="margin-bottom:11px">
    ${icon('chevronLeft')}返回</button>

  <!-- 行情头 -->
  <div class="hero">
    <div class="hero__top">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:7px">
          ${marketBadge(s.market)}
          <span class="hero__name">${esc(s.name)}</span>
        </div>
        <div class="hero__meta">
          <span>${esc(s.code)}</span>
          <span>·</span>
          <span>${esc(s.marketInfo.label)}</span>
          ${s.style ? `<span>·</span><span>${esc(s.style)}</span>` : ''}
          <span>·</span>
          <span>${hhmm()} 更新</span>
        </div>
      </div>
      <div style="text-align:right;flex:none">
        <div class="hero__price ${chgCls}">${price(s.price)}</div>
        <div class="hero__chg ${chgCls}">
          ${s.chg !== undefined ? '' : (s.price - s.prev >= 0 ? '+' : '') + (s.price - s.prev).toFixed(2)}
          ${pct(s.chgPct)}
        </div>
      </div>
    </div>

    <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:11px">
      ${(s.tags || []).map((t) => `<span class="chip chip--outline">${esc(t)}</span>`).join('')}
      ${s.aiScore ? scoreBadge(s.aiScore) : ''}
      ${s.aiAction ? actionChip(s.aiAction) : ''}
    </div>

    ${held && s.pnl !== undefined ? `
      <div class="pnl-banner">
        <div class="pnl-banner__col">
          <dt>持仓盈亏</dt>
          <dd class="${dirClass(s.pnl)}">${money(s.pnl, { sign: true })}</dd>
        </div>
        <div class="pnl-banner__col">
          <dt>收益率</dt>
          <dd class="${dirClass(s.pnlPct)}">${pct(s.pnlPct)}</dd>
        </div>
        <div class="pnl-banner__col">
          <dt>市值</dt>
          <dd>${money(s.mv)}</dd>
        </div>
      </div>
    ` : ''}

    <div class="kv-grid">
      ${kv('今开', price(s.prev * (1 + (s.chgPct / 100) * 0.3)))}
      ${kv('昨收', price(s.prev))}
      ${kv('最高', price(s.price * 1.012))}
      ${kv('最低', price(s.price * 0.986))}
      ${kv('成交量', thousands(Math.round(s.price * 12)) + ' 手')}
      ${kv('换手率', (0.8 + Math.abs(s.chgPct) * 0.4).toFixed(2) + '%')}
    </div>
  </div>

  <!-- 标签页 -->
  <div class="tabs">
    ${[
      { k: 'overview', label: '行情' },
      { k: 'tech', label: '技术面' },
      { k: 'ai', label: 'AI 分析' },
      { k: 'alerts', label: `提醒${relatedAlerts.length ? ` ${relatedAlerts.length}` : ''}` },
    ].map((t) => `
      <button class="tabs__btn" data-stock-tab="${t.k}" aria-selected="${tab === t.k}" type="button">
        ${t.label}</button>
    `).join('')}
  </div>

  ${tab === 'overview' ? renderOverview(s, bars, range) : ''}
  ${tab === 'tech' ? renderTech(s, tech) : ''}
  ${tab === 'ai' ? renderAI(s, tech) : ''}
  ${tab === 'alerts' ? renderAlerts(s, relatedAlerts) : ''}

  <div style="height:8px"></div>
  `;
}

function kv(label, value, cls = '') {
  return `<dl class="kv"><dt>${label}</dt><dd class="${cls}">${value}</dd></dl>`;
}

/* --------------------------------------------------------------------------
   行情
   -------------------------------------------------------------------------- */

function renderOverview(s, bars, range) {
  const up = s.chgPct >= 0;
  return `
  <div class="chart-wrap">
    <div class="chart-wrap__head">
      <span class="chart-wrap__title">K 线</span>
      <span class="range-tabs">
        ${RANGES.map((r) => `
          <button data-stock-range="${r.key}" aria-pressed="${range === r.key}" type="button">${r.key}</button>
        `).join('')}
      </span>
    </div>
    ${klineChart(bars, { w: 320, h: 170 })}
    <div style="display:flex;gap:14px;margin-top:8px;padding-top:8px;border-top:1px solid var(--line-soft);
      font-size:10.5px;color:var(--ink-3)">
      <span style="display:flex;align-items:center;gap:5px">
        <i style="width:12px;height:2px;background:var(--accent-fill);display:block;border-radius:var(--r-full)"></i>MA5</span>
      <span style="display:flex;align-items:center;gap:5px">
        <i style="width:12px;height:2px;background:var(--warn-fill);display:block;border-radius:var(--r-full)"></i>MA10</span>
      <span style="display:flex;align-items:center;gap:5px">
        <i style="width:12px;height:2px;background:var(--morandi-lilac);display:block;border-radius:var(--r-full)"></i>MA20</span>
      <span style="flex:1"></span>
      <span>红涨绿跌</span>
    </div>
  </div>

  <div class="section-title">${icon('activity')}<span>近 30 日走势</span></div>
  <div class="card card--pad">
    ${sparkline(s.spark || [], { w: 300, h: 64, up })}
    <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:var(--ink-3)">
      <span>30 日前</span>
      <span class="num ${dirClass(s.chgPct)}">区间 ${pct(s.chgPct)}</span>
      <span>今日</span>
    </div>
  </div>

  ${s.agent ? `
    <div class="notice" style="margin-top:12px">${icon('clock')}
      <span>最近一次 Agent 分析：<b>${esc(s.agent)}</b>${s.stale ? ' · 结果可能已过期，建议重新分析' : ''}</span>
    </div>
    <button class="btn btn--primary btn--block" data-act="deep-analysis" data-code="${s.code}" type="button">
      ${icon('brain')}触发 TradingAgents 深度分析
    </button>
  ` : ''}
  `;
}

/* --------------------------------------------------------------------------
   技术面
   -------------------------------------------------------------------------- */

function renderTech(s, tech) {
  const resCls = tech.resonance === 'bull' ? 'up' : tech.resonance === 'bear' ? 'down' : 'flat';
  const resText = tech.resonance === 'bull' ? '多头共振' : tech.resonance === 'bear' ? '空头共振' : '信号中性';

  return `
  <div class="card card--pad" style="margin-bottom:11px">
    <div style="display:flex;align-items:center;gap:10px">
      <span class="list__icon list__icon--${tech.resonance === 'bull' ? 'up' : tech.resonance === 'bear' ? 'down' : 'accent'}">
        ${icon(tech.resonance === 'bull' ? 'trendUp' : tech.resonance === 'bear' ? 'trendDown' : 'activity')}
      </span>
      <span style="flex:1">
        <span style="display:block;font-size:14px;font-weight:680" class="${resCls}">${resText}</span>
        <span style="display:block;font-size:11.5px;color:var(--ink-3);margin-top:2px">
          ${tech.bulls} 项看多 · ${tech.bears} 项看空 · 共 ${tech.rows.length} 项指标</span>
      </span>
      <span class="chip chip--${tech.resonance === 'bull' ? 'up' : tech.resonance === 'bear' ? 'down' : 'outline'}">
        强度 ${Math.max(tech.bulls, tech.bears)}/${tech.rows.length}</span>
    </div>
  </div>

  <div class="section-title">${icon('layers')}<span>指标明细</span>
    <span class="section-title__spacer"></span>
    <span class="section-title__more">信号灯 = 强度</span>
  </div>
  <div class="card card--pad" style="padding:4px 13px">
    ${tech.rows.map(techRow).join('')}
  </div>

  <div class="section-title">${icon('target')}<span>支撑与压力</span></div>
  <div class="card card--pad">
    ${[
      { label: '强压力', value: s.price * 1.08, tone: 'down' },
      { label: '弱压力', value: s.price * 1.035, tone: 'down' },
      { label: '当前价', value: s.price, tone: 'accent' },
      { label: '弱支撑', value: s.price * 0.968, tone: 'up' },
      { label: '强支撑', value: s.price * 0.92, tone: 'up' },
    ].map((r) => {
      const offset = ((r.value - s.price) / s.price) * 100;
      const left = 50 + Math.max(-46, Math.min(46, offset * 4));
      return `<div class="meter" style="margin-bottom:11px">
        <span class="meter__label">${r.label}</span>
        <span style="flex:1;position:relative;height:6px">
          <span style="position:absolute;inset:0;background:var(--surface-well);border-radius:var(--r-full)"></span>
          <span style="position:absolute;left:${left.toFixed(1)}%;top:-2px;width:3px;height:10px;
            border-radius:2px;background:var(--${r.tone === 'accent' ? 'accent' : r.tone})"></span>
        </span>
        <span class="meter__val" style="width:66px">${price(r.value)}</span>
      </div>`;
    }).join('')}
    <div style="font-size:10.5px;color:var(--ink-3);margin-top:2px">
      基于近 60 日高低点与成交密集区计算，仅供参考
    </div>
  </div>
  `;
}

/* --------------------------------------------------------------------------
   AI 分析
   -------------------------------------------------------------------------- */

function renderAI(s, tech) {
  const bull = tech.resonance === 'bull';
  return `
  <div class="ai-block" style="margin-bottom:11px">
    <div class="ai-block__head">${icon('brain')}
      <span class="ai-block__title">TradingAgents 多 Agent 决策</span>
      <span style="flex:1"></span>
      <span class="chip chip--accent">4 分析师 + 辩论 + 风控</span>
    </div>
    <div class="ai-block__body">
      <b>${esc(s.name)}（${esc(s.code)}）</b>当前技术面呈<b>${bull ? '多头共振' : tech.resonance === 'bear' ? '空头共振' : '中性震荡'}</b>，
      ${tech.bulls} 项指标看多、${tech.bears} 项看空。MA5/MA10/MA20 分别为
      <b>${tech.ma5.toFixed(2)} / ${tech.ma10.toFixed(2)} / ${tech.ma20.toFixed(2)}</b>，
      RSI 读数 <b>${tech.rsi.toFixed(1)}</b>${tech.rsi > 70 ? '（超买，注意回调风险）' : tech.rsi < 30 ? '（超卖，存在反弹机会）' : '（处于中性区间）'}。
      MACD 位于零轴${tech.macd > 0 ? '上方' : '下方'}，与信号线${tech.macd > tech.signal ? '金叉' : '死叉'}。
    </div>
  </div>

  <div class="section-title">${icon('robot')}<span>Agent 推理链</span>
    <span class="section-title__spacer"></span>
    <span class="section-title__more">预计 3-5 分钟</span>
  </div>
  <div class="card card--pad">
    <div class="chain">
      ${AGENT_CHAIN.map((c) => `
        <div class="chain__step chain__step--${c.state}">
          <span class="chain__dot">${icon(c.state === 'done' ? 'check' : c.state === 'active' ? 'play' : 'clock')}</span>
          <span class="chain__body">
            <span class="chain__name">${esc(c.name)}</span>
            <span class="chain__desc">${esc(c.desc)}</span>
          </span>
        </div>
      `).join('')}
    </div>
    <button class="btn btn--primary btn--block" style="margin-top:12px"
      data-act="deep-analysis" data-code="${s.code}" type="button">
      ${icon('brain')}重新运行完整分析
    </button>
    <div style="font-size:10.5px;color:var(--ink-3);text-align:center;margin-top:8px">
      单次成本约 $0.05 · 使用 deepseek-chat
    </div>
  </div>

  <div class="notice" style="margin-top:12px">${icon('warn')}
    <span>以上内容由 AI 生成，<b>不构成任何投资建议</b>。市场有风险，决策需谨慎。</span>
  </div>
  `;
}

/* --------------------------------------------------------------------------
   提醒
   -------------------------------------------------------------------------- */

function renderAlerts(s, list) {
  if (!list.length) {
    return `<div class="card card--pad">
      ${emptyState('该标的暂无提醒规则', 'bell')}
      <button class="btn btn--primary btn--block" data-act="add-alert-for" data-code="${s.code}" type="button">
        ${icon('plus')}为 ${esc(s.name)} 新建提醒
      </button>
    </div>`;
  }

  return `
  ${list.map((a) => `
    <article class="alert-card">
      <header class="alert-card__head">
        <span class="list__icon list__icon--warn">${icon('bell')}</span>
        <span class="alert-card__name">${esc(a.name)}</span>
        <span style="flex:1"></span>
        <span class="chip chip--${store.isAlertOn(a.id, a.enabled) ? 'sage' : 'outline'}">
          ${store.isAlertOn(a.id, a.enabled) ? '启用中' : '已关闭'}</span>
      </header>
      <div class="alert-conds">
        ${a.conds.map((c, i) => `
          <div class="alert-cond">
            ${i > 0 ? `<span class="alert-cond__logic">${a.logic}</span>` : ''}
            <span class="alert-cond__text">${esc(c.label)}</span>
          </div>`).join('')}
      </div>
      <div class="alert-card__foot">
        <span>${esc(a.scope)} · 冷却 ${esc(a.cooldown)} · ${esc(a.repeat)}</span>
        <span style="flex:1"></span>
        <span>已触发 ${a.fired} 次</span>
      </div>
    </article>
  `).join('')}
  <button class="btn btn--ghost btn--block" data-act="add-alert-for" data-code="${s.code}" type="button">
    ${icon('plus')}再建一条提醒
  </button>
  `;
}

export { RANGES };
