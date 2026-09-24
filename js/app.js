/* ==========================================================================
   PanWatch H5 · 应用外壳
   --------------------------------------------------------------------------
   职责：哈希路由、底部导航、页面渲染调度、弹层与 Toast、全局事件委托。
   ========================================================================== */

import { icon } from './icons.js';
import { h, frag, esc, hhmm, marketPhase, phaseLabel } from './utils.js';
import * as store from './store.js';
import * as liveMod from './live.js';
import { findStock } from './data.js';
import { pageHead } from './ui.js';

import * as homeView from './views/home.js';
import * as portfolioView from './views/portfolio.js';
import * as opportunitiesView from './views/opportunities.js';
import * as paperView from './views/paper.js';
import * as alertsView from './views/alerts.js';
import * as stockView from './views/stock.js';
import * as settingsView from './views/settings.js';

/* --------------------------------------------------------------------------
   路由表
   -------------------------------------------------------------------------- */

const TABS = [
  { key: 'home', label: '首页', iconName: 'home', view: homeView },
  { key: 'portfolio', label: '持仓', iconName: 'wallet', view: portfolioView },
  { key: 'opportunities', label: '机会', iconName: 'spark', view: opportunitiesView },
  { key: 'paper', label: '模拟盘', iconName: 'chart', view: paperView },
  { key: 'alerts', label: '提醒', iconName: 'bell', view: alertsView },
];

const EXTRA = {
  settings: { label: '设置', view: settingsView },
  stock: { label: '个股', view: stockView },
};

/* --------------------------------------------------------------------------
   当前路由状态
   -------------------------------------------------------------------------- */

let current = { name: 'home', param: null };

function parseHash() {
  const raw = (location.hash || '#/home').replace(/^#\/?/, '');
  const [name, param] = raw.split('/');
  if (TABS.some((t) => t.key === name)) return { name, param: param || null };
  if (EXTRA[name]) return { name, param: param || null };
  return { name: 'home', param: null };
}

function go(name, param) {
  const hash = param ? `#/${name}/${param}` : `#/${name}`;
  if (location.hash === hash) { render(); return; }
  location.hash = hash;
}

function back() {
  if (history.length > 1) history.back();
  else go('home');
}

/* --------------------------------------------------------------------------
   渲染
   -------------------------------------------------------------------------- */

const appEl = document.getElementById('app');
let pageEl = null;

function buildShell() {
  appEl.innerHTML = `
    <header class="appbar">
      <div class="appbar__inner">
        <div class="brand">
          <span class="brand__mark">${icon('trendUp')}</span>
          <span class="brand__name">盯盘侠</span>
          <span class="brand__ver">H5</span>
        </div>
        <span class="appbar__spacer"></span>
        <!-- 数据源标识：必须一眼看出现在看的是真行情还是演示数据。
             点击 = 立即刷新。 -->
        <button class="srcchip" data-src-chip data-act="refresh" type="button" title="行情数据源">
          <span class="srcchip__dot"></span><span data-src-label>演示</span>
        </button>
        <span class="chip chip--outline" data-phase></span>
        <button class="icon-btn" data-nav="settings" title="设置">${icon('gear')}</button>
      </div>
    </header>
    <main class="page" id="page"></main>
    <nav class="tabbar" role="tablist">
      ${TABS.map((t) => `
        <a class="tabbar__item" href="#/${t.key}" data-tab="${t.key}" role="tab">
          ${icon(t.iconName)}<span>${t.label}</span>
        </a>
      `).join('')}
    </nav>
    <div class="toast-host" id="toasts"></div>
  `;
  pageEl = document.getElementById('page');
}

function render(preserveScroll = false) {
  const y = preserveScroll ? window.scrollY : 0;
  const { name, param } = current;
  const view = TABS.find((t) => t.key === name)?.view || EXTRA[name]?.view;
  if (!view) { go('home'); return; }

  pageEl.innerHTML = view.render(param);

  // 高亮底部导航
  document.querySelectorAll('.tabbar__item').forEach((el) => {
    const on = el.dataset.tab === name;
    if (on) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });

  // 顶栏时段
  const phaseEl = document.querySelector('[data-phase]');
  if (phaseEl) {
    const p = marketPhase();
    phaseEl.textContent = `${phaseLabel(p)} ${hhmm()}`;
  }

  updateSourceChip();

  // 个股详情页：顺手拉一次真实日 K。
  // 不 await —— 拿到了会触发重渲染，没必要把首屏卡在网络上。
  if (name === 'stock' && param) {
    const s = findStock(param);
    if (s) liveMod.loadKline(s.code, s.market);
  }

  if (preserveScroll) window.scrollTo(0, y);
  else window.scrollTo(0, 0);

  document.title = titleFor(name, param);
}

function titleFor(name, param) {
  if (name === 'stock' && param) {
    const t = TABS.find((x) => x.key === name);
    return `${param} · 盯盘侠 H5`;
  }
  const t = TABS.find((x) => x.key === name);
  return t ? `${t.label} · 盯盘侠 H5` : '盯盘侠 PanWatch H5';
}

/* --------------------------------------------------------------------------
   数据源标识（顶栏）

   这不是装饰。整站的价格有两个来源：
     · 内置演示数据 —— 固定的样本值，永远不动
     · 后端实时行情 —— 来自腾讯财经，随盘变动

   两者长得一模一样。如果不标出来，用户会把一条固定的假价格当成实时价格
   去决策 —— 这比页面报错严重得多。所以这个小标签是硬需求：
   一眼能看出「现在看的是真的还是假的」，点击还能立刻重拉一次。
   -------------------------------------------------------------------------- */

function updateSourceChip() {
  const chip = document.querySelector('[data-src-chip]');
  if (!chip) return;
  const label = chip.querySelector('[data-src-label]');
  const st = liveMod.live;

  // 默认按「离线演示」渲染：没有后端是正常状态，不该看着像故障
  let mod = 'srcchip--offline';
  let text = '演示';
  let tip = '未连接后端，当前显示内置演示数据';

  if (st.status === 'probing') {
    mod = 'srcchip--probing';
    text = '连接中';
    tip = '正在探测行情服务…';
  } else if (st.status === 'online') {
    if (!st.lastSync) {
      /* 后端通了，但第一份行情还没落地 —— 屏幕上的价格还是内置样本。
         这个窗口通常不到一秒，但截图/弱网下会被看到，而且此时说「实时」
         是假的。所以宁可先说「同步中」。 */
      if (st.lastError) {
        mod = 'srcchip--stale';
        text = '无行情';
        tip = `后端已连接，但拉不到行情：${st.lastError}`;
      } else {
        mod = 'srcchip--probing';
        text = '同步中';
        tip = '后端已连接，正在拉取第一份行情…';
      }
    } else {
      // 标签只放最短的词 —— 顶栏宽度很紧张，完整说明交给 title。
      // 「在线」用蓝点而不是绿点：绿在全站已经表示「跌」了。
      mod = st.staleCount > 0 ? 'srcchip--stale' : 'srcchip--online';
      text = st.staleCount > 0 ? '延迟' : '实时';
      tip = `行情源：腾讯财经 · 更新于 ${liveMod.sinceLabel()}`;
      if (st.staleCount > 0) tip += `（${st.staleCount} 个代码暂时回落到缓存）`;
      if (st.applied) tip += ` · 已覆盖 ${st.applied} 个报价`;
      if (st.missing) tip += ` · ${st.missing} 个代码暂无报价`;
      if (st.lastError) tip += ` · 最近异常：${st.lastError}`;
    }
  } else if (st.status === 'offline') {
    // 「连上过再断线」和「从没连上」必须分开说：
    // 前者屏幕上摆的是服务端的旧数据，只是不再更新了；
    // 后者才是干干净净的内置演示样本。混为一谈就是撒谎。
    if (st.everSynced) {
      mod = 'srcchip--stale';
      text = '已断开';
      tip = '与后端的连接已断开，屏幕上是上次同步的数据，不会再更新';
    } else {
      text = '演示';
      tip = '未连接后端，当前显示内置演示数据';
    }
    if (st.lastError) tip += ` · ${st.lastError}`;
  }

  // 只改 class 字符串里的 srcchip 前缀段，避免把基类覆盖掉
  chip.className = `srcchip ${mod}`;
  if (label) label.textContent = text;
  chip.title = `${tip} · 点击立即刷新`;
  chip.setAttribute('aria-label', `行情数据源：${text}`);
}

/* --------------------------------------------------------------------------
   Toast
   -------------------------------------------------------------------------- */

function toast(msg, iconName = 'check') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = h(`<div class="toast">${icon(iconName)}<span>${esc(msg)}</span></div>`);
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 240);
  }, 2000);
}

/* --------------------------------------------------------------------------
   底部弹层
   -------------------------------------------------------------------------- */

let sheetEls = [];

function openSheet(cfg) {
  if (typeof cfg === 'string') return;         // 视图返回 null/undefined 时忽略
  const { title, body, okText = '确定', onOk } = cfg;
  closeSheet();

  const mask = h(`<div class="sheet-mask" data-sheet-close></div>`);
  const sheet = h(`<section class="sheet" role="dialog" aria-modal="true">
    <div class="sheet__handle"></div>
    <header class="sheet__head">
      <span class="sheet__title">${esc(title)}</span>
      <span style="flex:1"></span>
      <button class="icon-btn" data-sheet-close title="关闭">${icon('close')}</button>
    </header>
    <div class="sheet__body">${body}</div>
    <footer class="sheet__foot">
      <button class="btn btn--ghost" data-sheet-close type="button">取消</button>
      <button class="btn btn--primary" style="flex:1" data-sheet-ok type="button">${esc(okText)}</button>
    </footer>
  </section>`);

  document.body.appendChild(mask);
  document.body.appendChild(sheet);
  sheetEls = [mask, sheet];

  sheet.querySelector('[data-sheet-ok]').addEventListener('click', () => {
    const res = onOk ? onOk(sheet) : null;
    closeSheet();
    if (res?.toast) toast(res.toast);
    else if (res === undefined) toast('已提交');
  });
}

function closeSheet() {
  sheetEls.forEach((el) => el.remove());
  sheetEls = [];
}

/* --------------------------------------------------------------------------
   交互动作分发
   -------------------------------------------------------------------------- */

const ACTIONS = {
  /* 顶栏数据源标识 + 首页/持仓页/个股页的刷新按钮，共用这一个动作。
     离线时必须说实话 —— 不能弹一句「行情已刷新」然后价格一动没动。 */
  refresh: async () => {
    if (!liveMod.isOnline()) {
      toast('未连接后端，当前显示内置演示数据', 'info');
      return;
    }
    toast('正在刷新行情…', 'refresh');
    await liveMod.syncNow();
    const s = liveMod.live;
    if (s.lastError && !s.applied) toast(`刷新失败：${s.lastError}`, 'warn');
    else toast(`已同步 · ${liveMod.sinceLabel()}`, 'check');
  },
  scan: () => openSheet(portfolioView.sheetScan()),
  'add-position': () => openSheet(portfolioView.sheetAddPosition()),
  'add-watch': () => toast('请从机会页或搜索结果添加关注', 'search'),
  'add-watch-one': (el) => toast(`已关注 ${el.dataset.code}`),
  'collapse-all': () => toast('演示版未实现折叠，仅作示意', 'info'),
  'rescan': () => toast('已重新扫描，共 8 只命中', 'spark'),
  'alert-history': () => openSheet(alertsView.sheetAlertHistory()),
  'add-alert': () => openSheet(alertsView.sheetAlert()),
  'add-alert-for': (el) => openSheet(alertsView.sheetAlert()),
  'edit-alert': (el) => openSheet(alertsView.sheetAlert(el.dataset.id)),

  // 提醒弹层里动态增删条件行。
  // 复用视图导出的 condRow，避免两边结构各写一份后漂移。
  'add-cond': (el) => {
    const list = el.closest('.sheet')?.querySelector('[data-cond-list]');
    if (!list) return;
    const idx = list.querySelectorAll('.cond-row').length;
    if (idx >= 5) { toast('最多 5 个条件', 'warn'); return; }
    list.appendChild(h(alertsView.condRow({ field: 'price', op: '>=', value: '' }, idx, 'OR')));
  },
  'remove-cond': (el) => {
    const row = el.closest('.cond-row');
    const list = row?.parentElement;
    if (!row || !list) return;
    if (list.querySelectorAll('.cond-row').length <= 1) {
      toast('至少保留一个条件', 'warn');
      return;
    }
    row.remove();
    // 首行的前缀标签要重新落回「当」
    const first = list.querySelector('.cond-row .alert-cond__logic');
    if (first) first.textContent = '当';
  },

  'test-alert': () => toast('测试推送已发送', 'send'),
  'del-alert': (el) => {
    const id = el.dataset.id;
    openSheet({
      title: '删除提醒',
      body: `<div class="notice">${icon('warn')}
        <span>删除后该规则立即失效，且无法恢复。</span></div>
        <p style="font-size:13px;color:var(--ink-2)">确定删除这条提醒规则吗？</p>`,
      okText: '确认删除',
      onOk: () => { store.toggleAlert(id, false); return { toast: '提醒已删除' }; },
    });
  },
  'edit-api': () => openSheet(settingsView.sheetApi()),
  'test-api': () => {
    const v = store.get().settings.apiBase;
    toast(v ? '正在测试连接…' : '未配置地址', v ? 'wifi' : 'warn');
  },
  'paper-settings': () => openSheet({
    title: '模拟盘策略设置',
    body: `
      <div class="notice">${icon('info')}
        <span>模拟盘按 AI 评分阈值自动调仓，评分跌破阈值则触发卖出。</span></div>
      <div class="field">
        <label class="field__label">买入评分阈值</label>
        <input class="input" type="number" value="80" data-input="buy-threshold">
        <div class="field__hint">评分 ≥ 该值时买入，默认 80 分</div>
      </div>
      <div class="field">
        <label class="field__label">卖出评分阈值</label>
        <input class="input" type="number" value="60" data-input="sell-threshold">
        <div class="field__hint">评分 ≤ 该值时卖出，默认 60 分</div>
      </div>
      <div class="field">
        <label class="field__label">单票仓位上限</label>
        <input class="input" type="number" value="25" data-input="max-weight">
        <div class="field__hint">占模拟盘净值比例，默认 25%</div>
      </div>`,
    okText: '保存策略',
    onOk: () => ({ toast: '策略已保存' }),
  }),
  'deep-analysis': (el) => {
    openSheet({
      title: 'TradingAgents 深度分析',
      body: `
        <div class="notice">${icon('brain')}
          <span>将启动 <b>4 位分析师 → 看多看空辩论 → 风控审查 → PM 决策</b> 的完整推理链，
            预计耗时 3-5 分钟，单次成本约 $0.05。</span></div>
        <div class="card card--pad" style="margin-bottom:11px">
          <div style="font-size:13px;font-weight:620;margin-bottom:8px">分析队列</div>
          <div class="chain">
            ${['技术分析师', '情绪分析师', '新闻分析师', '基本面分析师', '看多/看空辩论', '风控审查', 'PM 决策书']
              .map((n, i) => `
                <div class="chain__step chain__step--${i < 2 ? 'done' : i === 2 ? 'active' : 'todo'}">
                  <span class="chain__dot">${icon(i < 2 ? 'check' : i === 2 ? 'play' : 'clock')}</span>
                  <span class="chain__body"><span class="chain__name">${n}</span></span>
                </div>`).join('')}
          </div>
        </div>
        <div style="font-size:11.5px;color:var(--ink-3);line-height:1.6">
          演示版本不会真正调用 LLM。真实部署时需在「设置 → 后端 API 地址」填入自建 PanWatch 后端，
          并在后端配置 OpenAI 兼容的模型服务。
        </div>`,
      okText: '启动分析',
      onOk: () => ({ toast: '分析任务已提交（演示）' }),
    });
  },
  'open-upstream': () => window.open('https://github.com/jackhuo2/PanWatch', '_blank', 'noopener'),
  'open-repo': () => window.open('https://github.com/KKfox100/PanWatch-H5', '_blank', 'noopener'),
  share: async () => {
    const data = { title: '盯盘侠 PanWatch H5', text: 'AI 盯盘助手移动端', url: location.href };
    if (navigator.share) {
      try { await navigator.share(data); } catch { /* 用户取消 */ }
    } else {
      try {
        await navigator.clipboard.writeText(location.href);
        toast('链接已复制');
      } catch { toast('请手动复制地址栏链接', 'info'); }
    }
  },
  'reset-store': () => {
    openSheet({
      title: '重置本地偏好',
      body: `<div class="notice">${icon('warn')}
        <span>将恢复默认主题、筛选条件与通知渠道设置。演示数据本身不受影响。</span></div>`,
      okText: '确认重置',
      onOk: () => { store.reset(); store.applyTheme(); return { toast: '已恢复默认设置' }; },
    });
  },
};

/* --------------------------------------------------------------------------
   全局事件
   -------------------------------------------------------------------------- */

function bindEvents() {
  /* 委托绑在 document 而不是 #app 上。
     弹层是 append 到 document.body 的（它必须脱离 #app 才能盖住顶栏和底栏），
     绑在 #app 上就收不到弹层内部的点击 —— 表现为「添加条件」「渠道选择」
     这些按钮完全没反应，而且控制台一声不吭。 */
  document.addEventListener('click', (e) => {
    const t = e.target;

    // 关闭弹层
    if (t.closest('[data-sheet-close]')) { closeSheet(); return; }

    // 返回
    if (t.closest('[data-back]')) { back(); return; }

    // 动作
    const actEl = t.closest('[data-act]');
    if (actEl) {
      const fn = ACTIONS[actEl.dataset.act];
      if (fn) { e.preventDefault(); fn(actEl); return; }
    }

    // 底部导航 / 顶栏导航
    const navEl = t.closest('[data-nav]');
    if (navEl) {
      const k = navEl.dataset.nav;
      if (k === 'settings') { go('settings'); }
      else { go(k); }
      return;
    }

    // 市场筛选（持仓页）
    const fm = t.closest('[data-filter-market]');
    if (fm) { store.set({ marketFilter: fm.dataset.filterMarket }); return; }

    // 市场筛选（机会页）
    const fo = t.closest('[data-filter-opp]');
    if (fo) { store.set({ opportunityFilter: fo.dataset.filterOpp }); return; }

    // 机会排序
    const so = t.closest('[data-sort-opp]');
    if (so) { store.set({ opportunitySort: so.dataset.sortOpp }); return; }

    // 持仓/关注切换
    const tb = t.closest('[data-tab]');
    if (tb && tb.classList.contains('segmented__btn')) {
      store.set({ portfolioTab: tb.dataset.tab }); return;
    }

    // 个股标签页
    const st = t.closest('[data-stock-tab]');
    if (st) { store.set({ stockTab: st.dataset.stockTab }); return; }

    // K 线区间
    const sr = t.closest('[data-stock-range]');
    if (sr) { store.set({ stockRange: sr.dataset.stockRange }); return; }

    // 模拟盘区间
    const pr = t.closest('[data-paper-range]');
    if (pr) { store.set({ paperRange: pr.dataset.paperRange }); return; }

    // 主题
    const th = t.closest('[data-theme-set]');
    if (th) { store.set({ theme: th.dataset.themeSet }); store.applyTheme(); return; }

    // 风险偏好
    const rk = t.closest('[data-risk]');
    if (rk) { store.setSetting('riskLevel', rk.dataset.risk); toast('风险偏好已更新'); return; }

    // 自动刷新开关。
    // 持仓页用 data-act，设置页用 data-setting-toggle —— 两个选择器都得认。
    // 只认前者的话，设置页那个开关点了完全没反应（而且控制台一声不吭）。
    const ta = t.closest('[data-act="toggle-auto-refresh"], [data-setting-toggle="autoRefresh"]');
    if (ta) {
      const next = !store.get().settings.autoRefresh;
      store.setSetting('autoRefresh', next);
      // 立刻启停轮询，不用等 800ms 的设置防抖
      if (next) liveMod.startAuto(); else liveMod.stopAuto();
      toast(next ? '已开启自动刷新' : '已关闭自动刷新');
      return;
    }

    // 提醒开关
    const al = t.closest('[data-toggle-alert]');
    if (al) {
      const id = al.dataset.toggleAlert;
      const next = !(al.getAttribute('aria-checked') === 'true');
      // 两份都写：
      //   store.alertStates 是历史遗留的本地覆盖层，界面读的是它；
      //   data.js 的 ALERTS[].enabled 才是要持久化进 D1 的事实。
      store.toggleAlert(id, next);
      liveMod.toggleAlert(id, next).then((res) => {
        // 离线时不提示「没保存」—— 顶栏已经写着「演示」了，每点一次弹一次太吵。
        // 但真出错（比如 token 不对）必须说，因为那是用户能修的东西。
        if (res && !res.ok && res.reason && liveMod.isOnline()) toast(res.reason, 'warn');
      });
      toast(next ? '提醒已启用' : '提醒已关闭');
      return;
    }

    // 通知渠道开关
    const ct = t.closest('[data-channel-toggle]');
    if (ct) {
      const k = ct.dataset.channelToggle;
      store.setChannel(k, !store.get().settings.channels[k]);
      return;
    }

    // 提醒弹层里的渠道 pill
    const cp = t.closest('[data-channel]');
    if (cp) {
      const on = cp.getAttribute('aria-pressed') === 'true';
      cp.setAttribute('aria-pressed', String(!on));
      return;
    }

    // 风格 pill
    const sp = t.closest('[data-style]');
    if (sp) {
      sp.parentElement.querySelectorAll('[data-style]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
      sp.setAttribute('aria-pressed', 'true');
      return;
    }

    // 股票行 → 详情
    const sk = t.closest('[data-stock]');
    if (sk) {
      if (sk.dataset.index) { toast('指数详情暂未开放', 'info'); return; }
      go('stock', sk.dataset.stock);
      return;
    }
  });

  // 下拉选择（设置页 / 弹层内）—— 同样要绑在 document 上
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-setting-input]');
    if (el) {
      const k = el.dataset.settingInput;
      store.setSetting(k, Number(el.value));
      toast('已保存');
    }
  });

  // 哈希路由
  window.addEventListener('hashchange', () => {
    current = parseHash();
    store.set({ stockTab: store.get().stockTab || 'overview' });
    render();
  });

  // 状态变化 → 重渲染（保留滚动位置）
  store.subscribe(() => {
    if (sheetEls.length) return;   // 弹层打开时不重绘底层，避免打断输入
    render(true);
  });
}

/* --------------------------------------------------------------------------
   启动
   -------------------------------------------------------------------------- */

function boot() {
  store.applyTheme();
  current = parseHash();
  buildShell();
  bindEvents();
  render();

  /* 实时层。
     刻意不 await —— 探测后端可能要几秒（失败还要等到 12s 超时），
     首屏绝不能等它。init() 内部失败就是离线，界面继续用内置数据，
     顶栏那个标识会说明「现在看的是演示数据」。

     订阅它而不是在每个视图里手动刷新：行情一变，全站的价格、市值、
     盈亏、K 线都得跟着动。preserveScroll 必须为 true —— 否则每 30 秒
     自动刷新一次就把正在看列表的用户弹回页首。 */
  liveMod.subscribe(() => {
    if (sheetEls.length) return;   // 弹层打开时不重绘底层，避免打断输入
    render(true);
  });
  liveMod.init();

  // 时段变化时刷新顶栏标签（每分钟）
  setInterval(() => {
    const phaseEl = document.querySelector('[data-phase]');
    if (phaseEl) phaseEl.textContent = `${phaseLabel(marketPhase())} ${hhmm()}`;
  }, 60000);

  // PWA
  // sw.js 必须放在站点根目录：Service Worker 的默认作用域是「脚本所在目录」，
  // 放在 /public/ 下就只能控制 /public/*，注册时还会因为路径解析到 /sw.js 而 404。
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* 离线能力不可用不影响主流程 */ });
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { go, toast };
