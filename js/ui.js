/* ==========================================================================
   共享渲染片段
   --------------------------------------------------------------------------
   把反复出现的结构（指标卡、股票行、标签…）收敛成函数，
   避免每个视图各写一套导致样式漂移。
   ========================================================================== */

import { icon } from './icons.js';
import { money, pct, price, dirClass, dir, curSymbol, esc, thousands } from './utils.js';
import { MARKETS } from './data.js';
import { sparkline } from './charts.js';

/** 市场徽标 A / HK / US */
export function marketBadge(market) {
  const m = MARKETS[market];
  if (!m) return '';
  return `<span class="mkt ${m.cls}" title="${m.label}">${m.short}</span>`;
}

/** AI 评分徽标 */
export function scoreBadge(score) {
  const cls = score >= 80 ? 'high' : score >= 65 ? 'mid' : 'low';
  return `<span class="score score--${cls}">${score}<small>分</small></span>`;
}

/** AI 动作标签 */
export function actionChip(action) {
  const map = {
    加仓: 'chip--up', 持有: 'chip--accent', 减仓: 'chip--down',
    观察: 'chip--outline', 买入: 'chip--up', 卖出: 'chip--down',
  };
  const cls = map[action] || 'chip--outline';
  return `<span class="chip ${cls}">${esc(action)}</span>`;
}

/** 指标卡
 *
 *  delta     —— 数值，只用来判方向（决定涨跌色）。
 *  deltaPct  —— 字符串，是真正显示在卡片上的那行字。
 *               两者是分开的：首页把「今日 +2,341」放进去，持仓页放「+1.27%」。
 *
 *  ⚠️ 必须同时给。只给 delta 不给 deltaPct 的话，模板里插值的
 *     undefined 会被原样渲染成「undefined」四个字母显示在卡片上 ——
 *     这是模板字符串最典型的翻车方式，所以这里显式挡一道。
 */
export function statCard({ label, iconName, value, unit, delta, deltaPct, foot, footSplit, tone = '', spark, sparkTone }) {
  const toneCls = tone ? ` stat--${tone}` : '';
  const hasDelta = delta !== undefined && delta !== null;
  const hasDeltaText = deltaPct !== undefined && deltaPct !== null && deltaPct !== '';
  const d = hasDelta ? dir(delta) : null;

  // 迷你走势图的颜色：显式 sparkTone 优先，其次跟 delta 走，
  // 都没有时用强调色 —— 绝不拿「序列最后一位是否高于第一位」来猜涨跌，
  // 那会让一条装饰性曲线和卡片上的盈利数字对着干。
  const sparkColor = sparkTone === 'accent' ? 'var(--accent-fill)'
    : sparkTone === 'sage' ? 'var(--sage-fill)'
    : sparkTone === 'up' ? 'var(--up-fill)'
    : sparkTone === 'down' ? 'var(--down-fill)'
    : null;
  const sparkUp = hasDelta ? delta >= 0 : true;

  return `<div class="stat${toneCls}">
    <div class="stat__label">${iconName ? icon(iconName) : ''}<span>${esc(label)}</span></div>
    <div class="stat__value ${d ? dirClass(delta) : ''}">${value}${unit ? `<span class="unit">${unit}</span>` : ''}</div>
    ${hasDelta && hasDeltaText
      ? `<div class="stat__delta stat__delta--${d}">${deltaPct}</div>` : ''}
    ${foot ? `<div class="stat__foot${footSplit ? ' stat__foot--split' : ''}">${foot}</div>` : ''}
    ${spark ? `<div class="stat__spark">${sparkline(spark, { w: 140, h: 26, up: sparkUp, color: sparkColor })}</div>` : ''}
  </div>`;
}

/**
 * 股票行
 * @param {object} s 股票对象（已 enrich）
 * @param {object} opts { mode:'hold'|'watch', showAccount }
 */
export function stockRow(s, opts = {}) {
  const { mode = 'hold' } = opts;
  const chgCls = dirClass(s.chgPct);

  if (mode === 'watch') {
    return `<button class="stock stock--slim" data-stock="${s.code}" type="button">
      <span class="stock__id">
        <span class="stock__row1">
          ${marketBadge(s.market)}
          <span class="stock__name">${esc(s.name)}</span>
          <span class="stock__code">${esc(s.code)}</span>
        </span>
        <span class="stock__row2">
          ${s.aiScore ? scoreBadge(s.aiScore) : ''}
          ${s.note ? `<span class="chip chip--outline">${esc(s.note)}</span>` : ''}
        </span>
      </span>
      <span class="stock__figs">
        <div>
          <dt>现价</dt>
          <dd class="${chgCls}">${price(s.price)}</dd>
        </div>
        <div>
          <dt>涨跌</dt>
          <dd class="${chgCls}">${pct(s.chgPct)}</dd>
        </div>
      </span>
      <span class="list__chev">${icon('chevronRight')}</span>
    </button>`;
  }

  // 持仓模式：现价 / 涨跌 / 市值 / 盈亏
  return `<button class="stock" data-stock="${s.code}" type="button">
    <span class="stock__id">
      <span class="stock__row1">
        ${marketBadge(s.market)}
        <span class="stock__name">${esc(s.name)}</span>
        <span class="stock__code">${esc(s.code)}</span>
      </span>
      <span class="stock__row2">
        ${actionChip(s.aiAction)}
        ${s.alert ? `<span class="chip chip--warn">${icon('bell')}${esc(s.alert)}</span>` : ''}
        ${s.stale ? `<span class="chip chip--outline">分析已过期</span>` : ''}
      </span>
      <span class="stock__row2" style="margin-top:5px;color:var(--ink-3);font-size:11px">
        <span>成本 <b class="num" style="color:var(--ink-2)">${price(s.cost)}</b></span>
        <span>·</span>
        <span>持仓 <b class="num" style="color:var(--ink-2)">${thousands(s.shares)}</b></span>
        ${s.currency !== 'CNY' ? `<span>·</span><span>${s.currency}</span>` : ''}
      </span>
    </span>
    <span class="stock__figs">
      <div>
        <dt>现价</dt>
        <dd class="${chgCls}">${price(s.price)}</dd>
        <dd class="sub ${chgCls}">${pct(s.chgPct)}</dd>
      </div>
      <div>
        <dt>盈亏</dt>
        <dd class="${dirClass(s.pnl)}">${money(s.pnl, { sign: true })}</dd>
        <dd class="sub ${dirClass(s.pnlPct)}">${pct(s.pnlPct)}</dd>
      </div>
    </span>
  </button>`;
}

/** 账户分组卡 */
export function accountCard(acc, mode = 'hold') {
  const t = acc.total;
  return `<section class="account">
    <header class="account__head">
      <span class="account__icon">${icon('bank')}</span>
      <span class="account__name">${esc(acc.name)}</span>
      <span class="account__count">${t.count} 只</span>
      <dl class="account__sum">
        <div><dt>市值</dt><dd>${money(t.mv)}</dd></div>
        <div><dt>盈亏</dt><dd class="${dirClass(t.pnl)}">${money(t.pnl, { sign: true })}</dd></div>
        <div><dt>今日</dt><dd class="${dirClass(t.todayPnl)}">${money(t.todayPnl, { sign: true })}</dd></div>
      </dl>
    </header>
    ${acc.positions.map((p) => stockRow(p, { mode })).join('')}
  </section>`;
}

/** 设置项列表行 */
export function settingRow({ iconName, title, desc, tail = '', tone = '', attrs = '' }) {
  return `<div class="list__item" ${attrs}>
    <span class="list__icon ${tone ? `list__icon--${tone}` : ''}">${icon(iconName)}</span>
    <span class="list__body">
      <span class="list__title">${esc(title)}</span>
      ${desc ? `<span class="list__desc">${desc}</span>` : ''}
    </span>
    <span class="list__tail">${tail}</span>
  </div>`;
}

/** 开关 */
export function switchEl(on, attrs = '') {
  return `<span class="switch" role="switch" aria-checked="${on}" tabindex="0" ${attrs}></span>`;
}

/** 页面标题 */
export function pageHead(title, sub, right = '') {
  return `<div class="page-head">
    <div>
      <h1 class="page-head__title">${esc(title)}</h1>
      ${sub ? `<div class="page-head__sub">${sub}</div>` : ''}
    </div>
    <div class="page-head__spacer"></div>
    ${right}
  </div>`;
}

/** 空态 */
export function emptyState(text, iconName = 'search') {
  return `<div class="empty">${icon(iconName)}<div>${esc(text)}</div></div>`;
}

/** 技术指标共振行 */
export function techRow(r) {
  const cls = r.signal === 'bull' ? 'up' : r.signal === 'bear' ? 'down' : 'flat';
  const sigCls = r.signal === 'bull' ? 'on-up' : r.signal === 'bear' ? 'on-down' : '';
  const bars = Array.from({ length: 5 }, (_, i) =>
    `<i class="${i < r.strength ? sigCls : ''}"></i>`).join('');
  return `<div class="tech-row">
    <span class="tech-row__name">${r.name}</span>
    <span class="tech-row__val">${r.value}</span>
    <span class="sig">${bars}</span>
    <span class="tech-row__signal"><span class="chip chip--${r.signal === 'bull' ? 'up' : r.signal === 'bear' ? 'down' : 'outline'}">${r.label}</span></span>
  </div>`;
}

/** 金额 + 单位（用于卡片主数值） */
export function moneyParts(v) {
  const s = money(v, { sign: true });
  const m = s.match(/^([+-]?[\d.]+)(.*)$/);
  if (!m) return { value: s, unit: '' };
  return { value: m[1], unit: m[2] };
}

export { dirClass, pct, price, money, curSymbol };
