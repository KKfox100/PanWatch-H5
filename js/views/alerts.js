/* ==========================================================================
   提醒页 · 价格提醒规则
   ========================================================================== */

import { icon } from '../icons.js';
import { esc } from '../utils.js';
import { ALERTS, MARKETS } from '../data.js';
import { pageHead, switchEl, marketBadge, emptyState } from '../ui.js';
import * as store from '../store.js';

const CHANNEL_META = {
  telegram: { label: 'Telegram', icon: 'telegram' },
  wechat: { label: '企业微信', icon: 'wechat' },
  dingtalk: { label: '钉钉', icon: 'dingtalk' },
  feishu: { label: '飞书', icon: 'send' },
  bark: { label: 'Bark', icon: 'bark' },
  webhook: { label: 'Webhook', icon: 'webhook' },
};

export function render() {
  const s = store.get();
  const list = ALERTS.map((a) => ({
    ...a,
    enabled: store.isAlertOn(a.id, a.enabled),
    marketInfo: MARKETS[a.market],
  }));

  const active = list.filter((a) => a.enabled).length;
  const firedToday = list.reduce((x, a) => x + (a.enabled ? a.fired : 0), 0);
  const covered = new Set(list.map((a) => a.code)).size;

  return `
  ${pageHead('提醒', `${active} 条启用中`, `
    <button class="icon-btn" data-act="alert-history" title="触发历史">${icon('clock')}</button>
  `)}

  <div class="stat-grid" style="margin-bottom:12px">
    <div class="stat stat--accent">
      <div class="stat__label">${icon('bell')}<span>启用中</span></div>
      <div class="stat__value">${active}<span class="unit">/ ${list.length}</span></div>
      <div class="stat__foot">共 ${list.length} 条规则</div>
    </div>
    <div class="stat stat--clay">
      <div class="stat__label">${icon('flame')}<span>今日触发</span></div>
      <div class="stat__value">${firedToday}<span class="unit">次</span></div>
      <div class="stat__foot">覆盖 ${covered} 只标的</div>
    </div>
  </div>

  <!-- 通知渠道 -->
  <div class="section-title">${icon('send')}<span>推送渠道</span>
    <span class="section-title__spacer"></span>
    <button class="section-title__more" data-nav="settings" type="button">管理 ›</button>
  </div>
  <div class="card card--pad" style="display:flex;gap:7px;flex-wrap:wrap">
    ${Object.entries(CHANNEL_META).map(([k, m]) => {
      const on = s.settings.channels[k];
      return `<span class="chip ${on ? 'chip--sage' : 'chip--outline'}">
        ${icon(m.icon)}${m.label}${on ? '' : ' · 关闭'}</span>`;
    }).join('')}
  </div>

  <!-- 规则列表 -->
  <div class="section-title">${icon('target')}<span>提醒规则</span>
    <span class="section-title__spacer"></span>
    <span class="section-title__more">条件满足即推送</span>
  </div>

  ${list.length ? list.map(alertCard).join('') : emptyState('还没有提醒规则', 'bell')}

  <button class="fab" data-act="add-alert" type="button" title="新建提醒">${icon('plus')}</button>
  `;
}

function alertCard(a) {
  const off = !a.enabled;
  return `<article class="alert-card ${off ? 'alert-card--off' : ''}" data-alert="${a.id}">
    <header class="alert-card__head">
      ${marketBadge(a.market)}
      <span class="alert-card__name">${esc(a.name)}</span>
      <span class="alert-card__code">${esc(a.code)}</span>
      <span class="alert-card__toggle">
        ${switchEl(a.enabled, `data-toggle-alert="${a.id}"`)}
      </span>
    </header>

    <div class="alert-conds">
      ${a.conds.map((c, i) => `
        <div class="alert-cond">
          ${i > 0 ? `<span class="alert-cond__logic">${a.logic}</span>` : ''}
          <span class="alert-cond__text">${esc(c.label)}</span>
        </div>
      `).join('')}
    </div>

    <div class="alert-card__foot">
      <span class="chip chip--outline">${icon('clock')}${esc(a.scope)}</span>
      <span class="chip chip--outline">冷却 ${esc(a.cooldown)}</span>
      <span class="chip chip--outline">上限 ${a.dailyCap}/日</span>
      <span class="chip chip--outline">${esc(a.repeat)}</span>
    </div>

    <div class="alert-card__foot" style="border-top:0;padding-top:0;margin-top:6px">
      <span style="display:flex;align-items:center;gap:5px">
        ${a.channels.map((c) => `<span class="chip chip--accent">${icon(CHANNEL_META[c]?.icon || 'send')}${CHANNEL_META[c]?.label || c}</span>`).join('')}
      </span>
      <span style="flex:1"></span>
      <span>已触发 <b class="num" style="color:var(--ink-2)">${a.fired}</b> 次 · 最近 ${esc(a.lastFired)}</span>
    </div>

    <div style="display:flex;gap:7px;margin-top:10px">
      <button class="btn btn--sm btn--ghost" data-act="edit-alert" data-id="${a.id}" type="button">
        ${icon('edit')}编辑</button>
      <button class="btn btn--sm btn--ghost" data-act="test-alert" data-id="${a.id}" type="button">
        ${icon('send')}测试推送</button>
      <span style="flex:1"></span>
      <button class="btn btn--sm btn--danger" data-act="del-alert" data-id="${a.id}" type="button">
        ${icon('trash')}</button>
    </div>
  </article>`;
}

/* --------------------------------------------------------------------------
   弹层：新建 / 编辑提醒
   -------------------------------------------------------------------------- */

const FIELDS = [
  { key: 'price', label: '现价', unit: '元' },
  { key: 'pct', label: '涨跌幅', unit: '%' },
  { key: 'turnover', label: '成交额', unit: '元' },
  { key: 'volumeRatio', label: '量比', unit: '倍' },
];

/**
 * 单条条件行。
 * 导出给 app.js 复用 —— 「添加条件」按钮需要动态插入同样的结构，
 * 两边各写一份迟早会漂移。
 */
export function condRow(c = { field: 'price', op: '>=', value: '' }, index = 0, logic = 'OR') {
  return `<div class="cond-row" style="display:flex;gap:6px;align-items:center">
    <span class="alert-cond__logic">${index === 0 ? '当' : logic}</span>
    <select class="input" style="flex:1;min-width:0;height:38px" data-cond-field>
      ${FIELDS.map((f) =>
        `<option value="${f.key}" ${c.field === f.key ? 'selected' : ''}>${f.label}</option>`).join('')}
    </select>
    <select class="input" style="width:58px;flex:none;height:38px;padding:0 6px" data-cond-op>
      ${['>=', '<=', '>', '<'].map((o) =>
        `<option ${c.op === o ? 'selected' : ''}>${o}</option>`).join('')}
    </select>
    <input class="input" style="width:76px;flex:none;height:38px;padding:0 8px" type="number" step="0.01"
      placeholder="数值" value="${c.value ?? ''}" data-cond-value>
    <button class="icon-btn" data-act="remove-cond" type="button" title="删除该条件"
      style="flex:none">${icon('close')}</button>
  </div>`;
}

export { FIELDS };

export function sheetAlert(id) {
  const a = id ? ALERTS.find((x) => x.id === id) : null;
  const isEdit = !!a;

  return {
    title: isEdit ? '编辑提醒' : '新建提醒',
    body: `
      <div class="field">
        <label class="field__label">标的</label>
        <input class="input" value="${a ? esc(a.name + ' ' + a.code) : ''}"
          placeholder="搜索代码或名称" data-input="alert-stock">
      </div>

      <div class="field">
        <label class="field__label">触发条件</label>
        <div class="alert-conds" style="gap:8px" data-cond-list>
          ${(a ? a.conds : [{ field: 'price', op: '>=', value: '' }])
            .map((c, i) => condRow(c, i, a?.logic || 'OR')).join('')}
        </div>
        <button class="btn btn--sm btn--ghost" style="margin-top:8px" data-act="add-cond" type="button">
          ${icon('plus')}添加条件</button>
        <div class="field__hint">多条件时可选 AND（全部满足）或 OR（任一满足）</div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="field">
          <label class="field__label">生效时段</label>
          <select class="input" data-input="scope">
            <option ${a?.scope === '交易时段' ? 'selected' : ''}>交易时段</option>
            <option ${a?.scope === '全天' ? 'selected' : ''}>全天</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label">冷却时间</label>
          <select class="input" data-input="cooldown">
            ${['15 分钟', '30 分钟', '60 分钟', '120 分钟'].map((x) =>
              `<option ${a?.cooldown === x ? 'selected' : ''}>${x}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label">日触发上限</label>
          <input class="input" type="number" min="1" max="50" value="${a?.dailyCap ?? 5}" data-input="cap">
        </div>
        <div class="field">
          <label class="field__label">重复触发</label>
          <select class="input" data-input="repeat">
            <option ${a?.repeat === '仅一次' ? 'selected' : ''}>仅一次</option>
            <option ${a?.repeat === '可重复' ? 'selected' : ''}>可重复</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label class="field__label">推送渠道</label>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          ${Object.entries(CHANNEL_META).map(([k, m]) => {
            const on = a ? a.channels.includes(k) : k === 'wechat';
            return `<button class="filter-pill" data-channel="${k}"
              aria-pressed="${on}" type="button">${m.label}</button>`;
          }).join('')}
        </div>
        <div class="field__hint">不选则走系统默认渠道（设置 → 通知渠道）</div>
      </div>`,
    okText: isEdit ? '保存修改' : '创建提醒',
    onOk: () => ({ toast: isEdit ? '提醒已更新' : '提醒已创建' }),
  };
}

export function sheetAlertHistory() {
  const rows = ALERTS.filter((a) => a.fired > 0);
  return {
    title: '触发历史',
    body: rows.length ? `
      <div class="list">
        ${rows.map((a) => `
          <div class="list__item">
            <span class="list__icon list__icon--warn">${icon('bell')}</span>
            <span class="list__body">
              <span class="list__title">${esc(a.name)} <span class="stock__code">${esc(a.code)}</span></span>
              <span class="list__desc">${esc(a.conds[0]?.label || '')} · 共 ${a.fired} 次</span>
            </span>
            <span class="list__tail" style="font-size:11px;color:var(--ink-3)">${esc(a.lastFired)}</span>
          </div>
        `).join('')}
      </div>` : emptyState('暂无触发记录', 'clock'),
    okText: '知道了',
    onOk: () => null,
  };
}
