/* ==========================================================================
   设置页
   ========================================================================== */

import { icon } from '../icons.js';
import { esc, thousands } from '../utils.js';
import { PORTFOLIO, WATCHLIST, OPPORTUNITIES, ALERTS } from '../data.js';
import { pageHead, settingRow, switchEl } from '../ui.js';
import * as store from '../store.js';
import { live, sinceLabel, isOnline, sourceLabel, init as reconnect } from '../live.js';

/** 与 worker/wrangler 配置里的 APP_VERSION 对齐 */
const APP_VERSION = 'v0.2.0-h5';

/** 本页自用的小键值对（ui.js 里的 kv 是给行情页用的，格式不同） */
function kvRow(label, value, cls = '') {
  return `<dl class="kv"><dt>${esc(label)}</dt><dd class="${cls}">${value}</dd></dl>`;
}

const CHANNELS = [
  { key: 'telegram', label: 'Telegram', desc: 'Bot Token + Chat ID', iconName: 'telegram', tone: 'accent' },
  { key: 'wechat', label: '企业微信', desc: '群机器人 Webhook', iconName: 'wechat', tone: 'sage' },
  { key: 'dingtalk', label: '钉钉', desc: '自定义机器人', iconName: 'dingtalk', tone: 'accent' },
  { key: 'feishu', label: '飞书', desc: '自定义机器人', iconName: 'send', tone: 'accent' },
  { key: 'bark', label: 'Bark', desc: 'iOS 推送', iconName: 'bark', tone: 'warn' },
  { key: 'webhook', label: '自定义 Webhook', desc: 'POST JSON 到你的地址', iconName: 'webhook', tone: 'lilac' },
];

const THEMES = [
  { key: 'auto', label: '跟随系统', iconName: 'globe' },
  { key: 'light', label: '浅色', iconName: 'sun' },
  { key: 'dark', label: '深色', iconName: 'moon' },
];

/** 莫兰迪色板预览 */
const PALETTE = [
  { name: '雾霾蓝', v: 'var(--accent-fill)' },
  { name: '鼠尾草', v: 'var(--sage-fill)' },
  { name: '陶土', v: 'var(--morandi-clay)' },
  { name: '豆沙粉', v: 'var(--morandi-rose)' },
  { name: '灰紫', v: 'var(--morandi-lilac)' },
  { name: '沙', v: 'var(--morandi-sand)' },
  { name: '暖石灰', v: 'var(--morandi-stone)' },
  { name: '苔', v: 'var(--morandi-moss)' },
];

export function render() {
  const s = store.get();
  const online = isOnline();
  const stale = live.staleCount > 0;

  return `
  ${pageHead('设置', online ? '已连接后端 · 实时行情' : '未连接后端 · 内置演示数据', '')}

  <!-- 账户 -->
  <div class="card card--pad" style="margin-bottom:12px;display:flex;align-items:center;gap:12px">
    <span style="width:46px;height:46px;border-radius:14px;display:grid;place-items:center;
      background:linear-gradient(140deg,var(--accent-fill),var(--sage-fill));color:var(--ink-inverse);flex:none">
      <span style="width:22px;height:22px">${icon('user')}</span>
    </span>
    <span style="flex:1;min-width:0">
      <span style="display:block;font-size:15px;font-weight:680">${online ? '单租户共享数据' : '演示账户'}</span>
      <span style="display:block;font-size:11.5px;color:var(--ink-3);margin-top:2px">
        ${PORTFOLIO.accounts.length} 个券商账户 · ${PORTFOLIO.total.count} 只持仓 · ${WATCHLIST.length} 只关注</span>
    </span>
    <span class="chip chip--${online ? (stale ? 'warn' : 'accent') : 'outline'}">
      ${online ? (stale ? '实时 · 延迟' : '实时行情') : '演示数据'}</span>
  </div>

  <!-- 外观 -->
  <div class="section-title">${icon('palette')}<span>外观</span></div>
  <div class="card card--pad">
    <div class="field__label">主题</div>
    <div class="segmented" style="width:100%;margin-bottom:14px">
      ${THEMES.map((t) => `
        <button class="segmented__btn" data-theme-set="${t.key}"
          aria-selected="${s.theme === t.key}" type="button"
          style="flex:1;display:flex;align-items:center;justify-content:center;gap:5px">
          <span style="width:14px;height:14px;display:inline-block">${icon(t.iconName)}</span>${t.label}
        </button>
      `).join('')}
    </div>

    <div class="field__label">莫兰迪色板</div>
    <div style="display:flex;gap:7px;flex-wrap:wrap">
      ${PALETTE.map((p) => `
        <span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--ink-3)">
          <i style="width:20px;height:20px;border-radius:6px;background:${p.v};display:block;
            box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)"></i>${p.name}</span>
      `).join('')}
    </div>
    <div class="field__hint" style="margin-top:9px">
      涨跌沿用中国市场习惯：<b class="up">涨红</b> / <b class="down">跌绿</b>，并做了低饱和处理以适应莫兰迪灰调。
    </div>
  </div>

  <!-- 数据与连接 -->
  <div class="section-title">${icon('server')}<span>数据与连接</span></div>

  <!-- 实时状态卡 ——
       全站唯一能确认「这些数字到底是不是真的」的地方。
       顶栏那个小标识只说结论，这里说清楚来龙去脉。 -->
  <div class="card card--pad" style="margin-bottom:12px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:11px">
      <span class="list__icon list__icon--${online ? 'accent' : 'warn'}">
        ${icon(online ? 'wifi' : 'info')}</span>
      <span style="flex:1;min-width:0">
        <span style="display:block;font-size:14px;font-weight:680">${esc(sourceLabel())}</span>
        <span style="display:block;font-size:11.5px;color:var(--ink-3);margin-top:2px">
          ${online
            ? `行情源：腾讯财经（qt.gtimg.cn）· 更新于 ${sinceLabel()}`
            : live.everSynced
              ? '与后端的连接已断开，屏幕上是上次同步的数据'
              : '所有行情、持仓与评分均为内置演示数据'}</span>
      </span>
    </div>

    <div class="kv-grid" style="grid-template-columns:repeat(2,1fr)">
      ${kvRow('服务端版本', live.serverVersion ? esc(live.serverVersion) : '—')}
      ${kvRow('最近同步', live.lastSync ? sinceLabel() : '—')}
      ${kvRow('已覆盖报价', online ? `${live.applied} 条` : '—')}
      ${kvRow('写入鉴权', live.writeProtected ? '需要令牌' : (online ? '未启用' : '—'))}
    </div>

    ${live.lastError ? `<div class="notice" style="margin-top:11px">${icon('warn')}
      <span>${esc(live.lastError)}</span></div>` : ''}

    <button class="btn btn--sm btn--ghost" data-act="refresh" type="button" style="margin-top:11px">
      ${icon('refresh')}立即同步</button>

    <div class="field__hint" style="margin-top:9px">
      ${online
        ? `读取公开；写入（改持仓、自选、提醒）需要令牌。数据存放在 Cloudflare D1 上，全站共享一份。`
        : `没有探测到后端，站点按纯静态模式运行 —— 不联网、不上传任何数据，
           所有改动只留在本机浏览器里。`}
    </div>
  </div>

  <div class="list" style="margin-bottom:12px">
    ${settingRow({
      iconName: 'server', tone: 'accent',
      title: '后端地址',
      desc: s.settings.apiBase
        ? esc(s.settings.apiBase)
        : '同源（与静态资源同一个 Worker）',
      tail: `<button class="btn btn--sm btn--ghost" data-act="edit-api" type="button">配置</button>`,
    })}
    ${settingRow({
      iconName: 'shield', tone: live.writeProtected ? 'sage' : 'warn',
      title: '写入令牌',
      desc: s.settings.apiToken
        ? `已填写 · ${'•'.repeat(Math.min(12, s.settings.apiToken.length))}`
        : (live.writeProtected ? '未填写 · 写入会被拒绝' : '未设置'),
      tail: `<button class="btn btn--sm btn--ghost" data-act="edit-api" type="button">配置</button>`,
    })}
    ${settingRow({
      iconName: 'refresh',
      title: '自动刷新',
      desc: `每 ${s.settings.refreshSec} 秒拉取一次行情`,
      tail: switchEl(s.settings.autoRefresh, 'data-setting-toggle="autoRefresh"'),
    })}
    ${settingRow({
      iconName: 'clock',
      title: '刷新间隔',
      desc: '服务端有 15 秒缓存，比这更密不会更快',
      tail: `<select class="input" style="width:88px;height:32px;font-size:12px" data-setting-input="refreshSec">
        ${[10, 15, 30, 60, 120].map((n) =>
          `<option value="${n}" ${s.settings.refreshSec === n ? 'selected' : ''}>${n}s</option>`).join('')}
      </select>`,
    })}
  </div>

  <!-- 通知渠道 -->
  <div class="section-title">${icon('send')}<span>通知渠道</span>
    <span class="section-title__spacer"></span>
    <span class="section-title__more">
      ${Object.values(s.settings.channels).filter(Boolean).length} / ${CHANNELS.length} 已启用</span>
  </div>
  <div class="list" style="margin-bottom:12px">
    ${CHANNELS.map((c) => settingRow({
      iconName: c.iconName, tone: c.tone,
      title: c.label, desc: c.desc,
      tail: switchEl(!!s.settings.channels[c.key], `data-channel-toggle="${c.key}"`),
    })).join('')}
  </div>

  <!-- 风险偏好 -->
  <div class="section-title">${icon('shield')}<span>风险偏好</span></div>
  <div class="card card--pad" style="margin-bottom:12px">
    <div class="segmented" style="width:100%">
      ${[
        { k: 'conservative', label: '保守' },
        { k: 'balanced', label: '平衡' },
        { k: 'aggressive', label: '激进' },
      ].map((r) => `
        <button class="segmented__btn" data-risk="${r.k}"
          aria-selected="${s.settings.riskLevel === r.k}" type="button"
          style="flex:1;justify-content:center">${r.label}</button>
      `).join('')}
    </div>
    <div class="field__hint" style="margin-top:9px">
      影响 AI 建议的仓位上限与止损幅度：保守 ≤ 15% 单票仓位，激进 ≤ 40%。
    </div>
  </div>

  <!-- 数据统计 -->
  <div class="section-title">${icon('file')}<span>数据概览</span></div>
  <div class="kv-grid" style="grid-template-columns:repeat(2,1fr);margin-top:0;margin-bottom:12px">
    <dl class="kv"><dt>持仓标的</dt><dd>${PORTFOLIO.total.count} 只</dd></dl>
    <dl class="kv"><dt>关注标的</dt><dd>${WATCHLIST.length} 只</dd></dl>
    <dl class="kv"><dt>机会池</dt><dd>${OPPORTUNITIES.length} 只</dd></dl>
    <dl class="kv"><dt>提醒规则</dt><dd>${ALERTS.length} 条</dd></dl>
    <dl class="kv"><dt>组合市值</dt><dd>${thousands(Math.round(PORTFOLIO.total.mv / 10000))} 万</dd></dl>
    <dl class="kv"><dt>数据来源</dt><dd>${online ? '实时行情' : '内置演示'}</dd></dl>
  </div>

  <!-- 关于 -->
  <div class="section-title">${icon('info')}<span>关于</span></div>
  <div class="list" style="margin-bottom:12px">
    ${settingRow({
      iconName: 'spark', tone: 'accent',
      title: '盯盘侠 PanWatch · H5',
      desc: '自托管 AI 盯盘助手的移动端 H5 版本',
      tail: `<span class="chip chip--outline">${APP_VERSION}</span>`,
    })}
    ${settingRow({
      iconName: 'globe',
      title: '上游项目',
      desc: 'github.com/jackhuo2/PanWatch',
      tail: `<span class="list__chev">${icon('external')}</span>`,
      attrs: 'data-act="open-upstream"',
    })}
    ${settingRow({
      iconName: 'server',
      title: '本版仓库',
      desc: 'github.com/KKfox100/PanWatch-H5',
      tail: `<span class="list__chev">${icon('external')}</span>`,
      attrs: 'data-act="open-repo"',
    })}
    ${settingRow({
      iconName: 'wifi', tone: 'sage',
      title: '部署平台',
      desc: 'Cloudflare Workers + D1（SQLite）',
      tail: `<span class="chip chip--sage">全球边缘</span>`,
    })}
    ${settingRow({
      iconName: 'share',
      title: '分享 / 添加到主屏幕',
      desc: '支持 PWA，可安装为独立 App',
      tail: `<button class="btn btn--sm btn--ghost" data-act="share" type="button">分享</button>`,
    })}
  </div>

  <!-- 关于本项目 ——
       这段散文有两个用途：一是让用户（以及会执行 JS 的抓取器）在应用内
       读到项目到底是什么；二是给 index.html 里的 FAQPage 结构化数据提供
       「对读者可见」的实体依据 —— Google 要求标记的内容必须能被读者看到，
       不能只活在 <script> 里。

       下面的问答与 index.html 的 JSON-LD、<noscript> 三处必须逐字一致，
       scripts/check.mjs 会核对。注意 dt/dd 必须各占一行：跨行断开会插入
       空格，核对时对不上。另外问答正文里**不要放 HTML 标签** ——
       JSON-LD 那份是纯文本，带标签就对不上了。 -->
  <div class="section-title">${icon('book')}<span>关于本项目</span></div>
  <div class="card card--pad about-prose" style="margin-bottom:12px">
    <p>
      「盯盘侠 PanWatch H5」是自托管 AI 盯盘助手 <strong>PanWatch</strong> 的移动端版本：
      把持仓、自选、提醒与模拟盘搬进浏览器，打开网页就能用，不需要安装 App。
    </p>
    <p>
      数据有两种来源，界面会明确标出当前用的是哪一种。<strong>配了后端</strong>时，
      一个 Cloudflare Worker 从腾讯财经拉取 A股 / 港股 / 美股的实时行情，
      缓存进 D1（也就是托管的 SQLite），持仓、自选、提醒这些用户数据也持久化在那里；
      <strong>没有后端</strong>时，站点按纯静态模式运行，所有数字都是内置的演示数据，
      由确定性伪随机序列生成，不联网，也不构成投资建议。
    </p>
    <p>
      工程上刻意保持<strong>零构建、零运行时依赖</strong>：没有打包步骤，没有框架，
      图表是手写的 SVG。前端与 Worker 共用同一份代码 ——
      <code>js/symbols.js</code> 同时被浏览器和 Worker 引入，
      所以「股票代码 ↔ 上游 symbol 怎么换算」只有一处定义，不会两边漂移。
      源码基于
      <a href="https://github.com/jackhuo2/PanWatch" target="_blank" rel="noopener">jackhuo2/PanWatch</a>
      改造，以 MIT 许可开源在
      <a href="https://github.com/KKfox100/PanWatch-H5" target="_blank" rel="noopener">KKfox100/PanWatch-H5</a>。
    </p>
  </div>

  <div class="section-title">${icon('info')}<span>常见问题</span></div>
  <div class="card card--pad" style="margin-bottom:14px">
    <dl class="about-faq">
      <dt>盯盘侠 PanWatch H5 需要服务器或数据库吗？</dt>
      <dd>看怎么用。默认部署是纯静态站点，没有后端，数据全部内置；再配上一个 Cloudflare Worker 与 D1 数据库，它就会拉取真实行情，并把持仓、自选、提醒持久化进 D1。两种模式共用同一份前端代码，没探测到后端时会自动回落到演示数据。</dd>
      <dt>它连接真实的行情数据源吗？</dt>
      <dd>配了后端就连接。Worker 从腾讯财经拉取 A股、港股、美股的实时行情，缓存进 D1 并按 15 秒的有效期刷新；页面顶栏会明确标出当前显示的是「实时」还是「演示」。没有后端时不联网，所有数字都是内置的演示数据。</dd>
      <dt>支持哪些股票市场？</dt>
      <dd>A股、港股、美股。多币种持仓会按内置汇率折算成人民币，统一计算市值与盈亏。</dd>
      <dt>为什么界面配色是灰调的？</dt>
      <dd>色板取自莫兰迪静物画的灰调，所有颜色都掺入一层暖灰并压低饱和度。涨跌仍严格遵循中国市场习惯：涨红跌绿。全部配色按 WCAG 2.1 验算过对比度。</dd>
      <dt>可以自己部署吗？</dt>
      <dd>可以。项目以 MIT 许可开源，一条 wrangler 命令即可部署到 Cloudflare Workers；要用实时行情，再建一个 D1 数据库并跑一次建表脚本。</dd>
    </dl>
  </div>

  <div class="section-title">${icon('warn')}<span>数据管理</span></div>
  <div class="list" style="margin-bottom:14px">
    ${settingRow({
      iconName: 'refresh', tone: 'warn',
      title: '重置本地偏好',
      desc: '恢复默认主题、筛选与通知设置',
      tail: `<button class="btn btn--sm btn--danger" data-act="reset-store" type="button">重置</button>`,
    })}
  </div>

  <div style="text-align:center;font-size:11px;color:var(--ink-3);line-height:1.7;padding-bottom:8px">
    <div>盯盘侠 PanWatch H5 · 莫兰迪主题</div>
    <div>基于 <b>jackhuo2/PanWatch</b> 改造 · MIT License</div>
    <div style="margin-top:6px">
      ${online ? '行情来自腾讯财经，仅供参考，不构成投资建议' : '当前为演示数据，不构成投资建议'}</div>
  </div>
  `;
}

/* --------------------------------------------------------------------------
   弹层：后端地址与写入令牌
   -------------------------------------------------------------------------- */

export function sheetApi() {
  const s = store.get();
  return {
    title: '后端地址与令牌',
    body: `
      <div class="notice">${icon('info')}
        <span><b>留空 = 同源</b>：静态资源和 API 由同一个 Cloudflare Worker 提供，
          这是本项目的标准部署方式，通常不需要填。</span>
      </div>

      <div class="field">
        <label class="field__label">API Base URL</label>
        <input class="input" placeholder="留空即同源"
          value="${esc(s.settings.apiBase)}" data-input="api-base">
        <div class="field__hint">
          只有把后端单独部署在别的域名时才需要填。跨域需要后端放开来源，
          否则浏览器会拦下请求。
        </div>
      </div>

      <div class="field">
        <label class="field__label">写入令牌（WRITE_TOKEN）</label>
        <input class="input" type="password" placeholder="与服务端 WRITE_TOKEN 一致"
          value="${esc(s.settings.apiToken)}" data-input="api-token" autocomplete="off">
        <div class="field__hint">
          读取行情和持仓是公开的；<b>改</b>持仓、自选、提醒要带这个令牌。
          服务端用 <code>npx wrangler secret put WRITE_TOKEN</code> 设置，
          两边一致才写得进去。
        </div>
      </div>

      <div class="notice">${icon('warn')}
        <span>令牌存在浏览器 localStorage 里 —— 能打开这个页面的人就能读到它。
          这是「单租户、无登录」方案的固有代价，<b>别把它当成真正的账号体系</b>。
          要多人隔离就得自己加登录。</span>
      </div>

      <div class="field">
        <label class="field__label">连通性</label>
        <button class="btn btn--sm btn--ghost" data-act="test-api" type="button">${icon('wifi')}测试连接</button>
      </div>`,
    okText: '保存',
    onOk: (root) => {
      const base = root.querySelector('[data-input="api-base"]')?.value.trim() || '';
      const token = root.querySelector('[data-input="api-token"]')?.value.trim() || '';
      store.setSetting('apiBase', base);
      store.setSetting('apiToken', token);
      // 地址或令牌变了就重新探测一次，让顶栏那个标识立刻反映真实状态，
      // 而不是等用户下次刷新页面才知道自己填错了。
      // 不 await —— 弹层要立刻关掉；探测结果通过订阅自动重渲染。
      reconnect();
      return { toast: '已保存，正在重新连接…' };
    },
  };
}

export { CHANNELS, THEMES };
