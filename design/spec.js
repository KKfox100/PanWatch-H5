/* ==========================================================================
   盯盘侠 PanWatch · 设计规范页逻辑
   --------------------------------------------------------------------------
   两条原则贯穿全文：

   1. 数字是算出来的，不是抄进来的。
      对比度在页面加载时用 WCAG 2.1 公式现算，读的是 CSS 变量本身。
      所以规范页永远和 tokens.css 一致 —— 改令牌，这里的数字立刻跟着变。

   2. 组件是应用自己的组件。
      演示区用的 class、渲染函数、图表都 import 自 ../js/，
      不是另画一套。另画一套的下场是规范好看、实现走样。
   ========================================================================== */

import { icons } from '../js/icons.js';
import {
  PORTFOLIO, WATCHLIST, OPPORTUNITIES, INDEX_DATA, ALERTS,
  PAPER, PAPER_NAV, PAPER_HOLDINGS, AGENT_CHAIN,
} from '../js/data.js';
import {
  statCard, stockRow, accountCard, settingRow, switchEl,
  emptyState, techRow, scoreBadge, marketBadge, actionChip,
} from '../js/ui.js';
import { sparkline, donut, hbars, areaChart, DONUT_COLORS } from '../js/charts.js';
import { money, price, pct, dirClass } from '../js/utils.js';

/* ==========================================================================
   1 · WCAG 2.1 对比度
   ========================================================================== */

const srgbToLinear = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** 支持 #rgb / #rrggbb / rgb() / rgba()。自定义属性可能是 rgb() 形式。 */
function toRgb(color) {
  const s = String(color).trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(/[,\s/]+/).slice(0, 3).map(Number);
  return null;
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((c) => srgbToLinear(c / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

function contrast(a, b) {
  const la = luminance(toRgb(a));
  const lb = luminance(toRgb(b));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const r2 = (n) => Math.round(n * 100) / 100;

/* ==========================================================================
   2 · 读取令牌
   --------------------------------------------------------------------------
   直接问浏览器要 CSS 变量的当前值。这样主题一换，读到的就是新主题的值，
   对比度表会自动重算 —— 不需要为浅色/深色各维护一份数据。
   ========================================================================== */

let TOKENS = {};

function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  // 遍历 :root 上所有自定义属性。CSSStyleDeclaration 里自定义属性
  // 排在前面，用 length + item() 遍历是最稳的方式。
  for (let i = 0; i < cs.length; i++) {
    const name = cs.item(i);
    if (name && name.startsWith('--')) out[name] = cs.getPropertyValue(name).trim();
  }
  TOKENS = out;
  return out;
}

const tk = (name) => TOKENS[name] || '';

/* ==========================================================================
   3 · 内容数据
   ========================================================================== */

const HABITS = [
  ['单手操作，拇指够不到顶部', '手机 6.7 寸，拇指舒适区在下半屏', '关键操作（刷新、切换、主按钮）落在下半屏；导航固定在底栏，不用顶栏抽屉'],
  ['只看数字，不读标签', '打开后先扫颜色，再找数字，标签最后才看', '数字用等宽字体 + 大字号；标签降到 --ink-3；一屏内先给三个核心数字'],
  ['涨跌色是第一识别信号', '中国市场习惯：红涨绿跌', '严格红涨绿跌，但颜色不是唯一通道 —— 同时给 +/− 符号与 ▲▼ 箭头'],
  ['扫视而非阅读', '每次停留 20–60 秒，不会读完一段话', '信息分层：首屏只放结论，推导过程折进二级页；AI 结论必须附来源'],
  ['怕误触（真金白银）', '交易类应用误触代价高', '破坏性操作二次确认，且确认按钮不与触发按钮同位；列表行高 ≥56px'],
  ['夜间看盘占比高', '20:00 后是第二使用高峰', '深色模式用暖棕灰而非纯黑 —— 纯黑底上的浅字有光晕，久看眼睛累'],
  ['对「跳变」敏感', '数字刷新时位置抖动会让人重新找位置', '数字全部 tabular-nums；走势图用确定性伪随机，刷新不跳'],
  ['不信任「看起来很厉害」的 AI', '金融 AI 结论需要可验证', 'AI 结论附数据来源与推导链；不给裸结论，给可追溯的判断过程'],
];

const PRINCIPLES = [
  ['数字优先', '数字是内容，标签是注释。字号、字重、色彩的预算优先给数字，标签一律降级到 --ink-3。'],
  ['颜色不单独承载信息', '涨跌同时用颜色 + 符号 + 箭头。色觉障碍用户占男性约 8%，只靠颜色等于对这部分人隐藏信息。'],
  ['一屏三数', '任何页面首屏只允许三个视觉焦点，其余降级。快查型用户只待 40 秒，四个焦点等于没有焦点。'],
  ['拇指可达', '主操作落在下半屏。顶栏只放低频动作（设置、返回），不放需要频繁点的按钮。'],
  ['误触有代价', '破坏性操作必须二次确认，且确认按钮不与触发按钮同位 —— 连点两下的习惯会让同位确认形同虚设。'],
  ['柔和但不含糊', '莫兰迪是低饱和，不是低对比。装饰可以淡到 1.1:1，信息必须达到 4.5:1。两者界线要划清。'],
  ['刷新不跳', '数字等宽、图表确定性。任何一次刷新都不该让用户重新找位置。'],
];

const IA_TREE = [
  ['盯盘侠 H5', 0],
  ['首页 · 今日概览', 1],
  ['总资产 / 今日盈亏 / 持仓数', 2, '首屏三数'],
  ['持仓速览 Top 3', 2],
  ['大盘指数横滑', 2],
  ['今日提醒', 2],
  ['持仓', 1],
  ['账户分组（招商 / 东方）', 2],
  ['个股行 → 个股详情', 2],
  ['市场配置环形图', 2],
  ['机会', 1],
  ['AI 扫描结果（按评分降序）', 2],
  ['筛选：全部 / 高置信 / 板块 / 市场', 2],
  ['模拟盘', 1],
  ['净值曲线（4 档区间）', 2],
  ['绩效指标 6 项', 2],
  ['持仓权重条', 2],
  ['提醒', 1],
  ['条件列表（开关）', 2],
  ['已触发记录', 2],
  ['渠道设置（6 个渠道）', 2],
  ['个股详情', 1, '二级页'],
  ['价格 + 涨跌', 2],
  ['K 线 + 均线', 2],
  ['技术指标 MA / MACD / RSI / KDJ / BOLL', 2],
  ['信号与 AI 分析', 2],
  ['设置', 1, '二级页'],
  ['主题 · 浅色 / 深色 / 跟随系统', 2],
  ['数据源 · 上游 API', 2],
  ['提醒渠道', 2],
];

/* 字阶：与 tokens.css 一一对应 */
const TYPE_SCALE = [
  ['--fs-3xl', '超大数字 · 总资产', '¥1,847.32万'],
  ['--fs-2xl', '大数字 · 现价、指标值', '+29.44万'],
  ['--fs-xl', '卡片标题、页面标题', '今日概览'],
  ['--fs-lg', '列表主文字、小标题', '贵州茅台'],
  ['--fs-md', '正文（基准）', '持仓集中度偏高，建议分散'],
  ['--fs-sm', '次要正文、列表副标题', '招商证券 · 8 只持仓'],
  ['--fs-xs', '脚注、标签、时间戳', '更新于 14:32:08'],
  ['--fs-2xs', '单位、角标（全站最小）', '万元 · 人民币'],
];

const WEIGHTS = [
  ['--fw-regular', '400', '长段落、说明文字。中文正文用 400 即可，加粗反而降低可读性。'],
  ['--fw-medium', '500', '列表主文字、按钮、标签。需要「比正文重一点但不到标题」的场合。'],
  ['--fw-bold', '600', '标题、数字、强调。数字用 600 比 700 更耐看，700 在小字号下会糊。'],
];

const LINE_HEIGHTS = [
  ['--lh-tight', '1.15', '大号数字。数字没有下伸部，可以压得很紧。'],
  ['--lh-snug', '1.3', '标题、单行强调文字。'],
  ['--lh-normal', '1.45', '正文默认。中文需要比英文更松。'],
  ['--lh-relaxed', '1.6', '长段落、说明文字、AI 结论。'],
];

const LETTER_SPACINGS = [
  ['--ls-tight', '-0.01em', '大号数字与标题。字号越大字距越显松，需要收紧。'],
  ['--ls-normal', '0', '正文默认。'],
  ['--ls-wide', '0.02em', '小号数字、全大写标签。字号越小越容易挤，需要放宽。'],
];

const SPACING = ['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-8', '--sp-10', '--sp-12'];
const SPACING_USE = {
  '--sp-1': '图标与文字之间',
  '--sp-2': '标签内边距、紧密元素间',
  '--sp-3': '列表行内边距',
  '--sp-4': '卡片内边距、页面左右边距',
  '--sp-5': '卡片之间',
  '--sp-6': '区块之间',
  '--sp-8': '大区块之间',
  '--sp-10': '章节之间',
  '--sp-12': '页面首尾留白',
};

const RADII = [
  ['--r-xs', '徽标、小标签'],
  ['--r-sm', '按钮、输入框'],
  ['--r-md', '内嵌块'],
  ['--r-lg', '卡片'],
  ['--r-xl', '弹层顶部'],
  ['--r-full', '胶囊、圆形按钮'],
];

const SHADOWS = [
  ['--shadow-1', '卡片静置'],
  ['--shadow-2', '卡片悬停、浮起元素'],
  ['--shadow-3', '弹层、手机预览框'],
  ['--shadow-nav', '底栏（多一条向上实线）'],
];

const ZINDEX = [
  ['--z-sticky', '页面内的粘性元素（区块标题）'],
  ['--z-nav', '顶栏、底栏'],
  ['--z-overlay', '遮罩层'],
  ['--z-sheet', '底部弹层'],
  ['--z-toast', '轻提示（最上层，不可被遮挡）'],
];

const DURATIONS = [
  ['--dur-fast', '120ms', '微反馈：按下、开关翻转、颜色变化。快到几乎感觉不到，但少了会觉得「没反应」。'],
  ['--dur', '200ms', '默认：状态切换、展开收起、页面进入。'],
  ['--dur-slow', '320ms', '入场：弹层升起、抽屉推出。再慢就明显卡了。'],
];

const EASINGS = [
  ['--ease', 'cubic-bezier(0.32, 0.72, 0.28, 1)', '默认 · 出场'],
  ['--ease-out', 'cubic-bezier(0, 0, 0.2, 1)', '入场 · 快起慢停'],
  ['--ease-in', 'cubic-bezier(0.4, 0, 1, 1)', '退场 · 慢起快走'],
  ['--ease-spring', 'cubic-bezier(0.34, 1.4, 0.64, 1)', '回弹 · 仅强调'],
];

const A11Y_SEMANTICS = [
  ['底栏导航', '用 <code>nav</code> + <code>aria-current="page"</code> 标记当前页，不用纯 class 区分。屏幕阅读器靠这个读出「第 3 项，共 5 项，当前页」。'],
  ['开关', '用 <code>role="switch"</code> + <code>aria-checked</code>，不用 checkbox —— 视觉是开关就必须是开关语义。'],
  ['分段控件 / 标签页', '用 <code>aria-selected</code>，容器加 <code>role="tablist"</code>。'],
  ['图标按钮', '图标本身 <code>aria-hidden="true"</code>，把语义放到按钮的 <code>aria-label</code> 上。否则读屏会念出「图片」这种无用信息。'],
  ['涨跌数字', '视觉靠颜色，但语义要靠文字：读屏念「上涨 2.14%」而不是「加 2.14 百分比」。'],
  ['加载中', '容器加 <code>aria-busy="true"</code>，并给出文字说明，不要只转圈。'],
  ['焦点可见', '所有可交互元素保留 <code>:focus-visible</code> 焦点环。全局 <code>outline: none</code> 是最常见的可访问性事故。'],
  ['弹层', '打开时焦点移入弹层，关闭时归还给触发元素；<code>Esc</code> 可关。'],
  ['动态区域', 'Toast 与提醒触发用 <code>aria-live="polite"</code>，让读屏在不打断的前提下播报。'],
];

/* 对比度校验清单：与 scripts/audit-contrast.mjs 的判定范围一致 */
const A11Y_GROUPS = [
  {
    name: '文字 / 中性面层级',
    kind: 'body',
    pairs: [
      ...['--bg', '--surface-raised', '--surface', '--surface-sunken'].flatMap((bg) => [
        ['主文字', '--ink', bg],
        ['次文字', '--ink-2', bg],
        ['三级文字', '--ink-3', bg],
      ]),
    ],
  },
  {
    name: '语义色当文字（压在卡片面与嵌入块上）',
    kind: 'body',
    pairs: ['--up-text', '--down-text', '--flat-text', '--warn-text', '--accent-text', '--sage-text', '--lilac-text']
      .flatMap((fg) => [[fg, fg, '--surface'], [fg, fg, '--surface-sunken']]),
  },
  {
    name: '反白文字（填充块上）',
    kind: 'large',
    pairs: [
      ['主按钮 / 徽标', '--ink-inverse', '--accent-fill'],
      ['次按钮 / 徽标', '--ink-inverse', '--sage-fill'],
      ['涨色徽标', '--ink-inverse', '--up-fill'],
      ['跌色徽标', '--ink-inverse', '--down-fill'],
      ['警示徽标', '--ink-inverse', '--warn-fill'],
      ['灰紫徽标', '--ink-inverse', '--lilac-fill'],
    ],
  },
  {
    name: '浅底深字（胶囊）',
    kind: 'body',
    pairs: [
      ['强调胶囊', '--accent-on-soft', '--accent-soft'],
      ['次强调胶囊', '--sage-on-soft', '--sage-soft'],
      ['涨胶囊', '--up-on-soft', '--up-soft'],
      ['跌胶囊', '--down-on-soft', '--down-soft'],
      ['警示胶囊', '--warn-on-soft', '--warn-soft'],
      ['灰紫胶囊', '--lilac-on-soft', '--lilac-soft'],
    ],
  },
  {
    name: '非文本 UI（SC 1.4.11）',
    kind: 'ui',
    pairs: [
      ['焦点环 · 卡片面', '--accent-fill', '--surface'],
      ['焦点环 · 页面底', '--accent-fill', '--bg'],
      ['控件描边 · 卡片面', '--line-strong', '--surface'],
      ['控件描边 · 嵌入块', '--line-strong', '--surface-sunken'],
      ['涨跌填充 · 涨', '--up-fill', '--surface'],
      ['涨跌填充 · 跌', '--down-fill', '--surface'],
    ],
  },
  {
    name: '装饰（豁免判定）',
    kind: 'deco',
    pairs: [
      ['主分隔线', '--line', '--surface'],
      ['弱分隔线', '--line-soft', '--surface'],
      ['进度槽 / 拖拽条', '--surface-well', '--surface'],
      ['内嵌块', '--surface-sunken', '--surface'],
    ],
  },
];

const THRESHOLD = { body: 4.5, large: 3.0, ui: 3.0 };

/* ==========================================================================
   4 · 渲染：小工具
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

/** 转义，避免内容里的 < > 破坏结构 */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** 判定一个比值属于哪一档 */
function verdictOf(ratio, kind) {
  if (kind === 'deco') return 'deco';
  return ratio >= THRESHOLD[kind] ? 'pass' : ratio >= 3.0 ? 'large' : 'fail';
}

const VERDICT_TEXT = { pass: '达标', large: '仅大字', fail: '不达标', deco: '豁免' };

/** 色卡：色块 + 令牌名 + 十六进制 + 实测比值 */
function swatchCard({ token, name, note, against, kind = 'body', textToken }) {
  const bg = tk(token);
  const fg = textToken ? tk(textToken) : null;
  const ratio = fg ? r2(contrast(fg, bg)) : against ? r2(contrast(bg, tk(against))) : null;
  const v = ratio === null ? 'deco' : verdictOf(ratio, kind);

  /* chip 里那行比值文字，必须自己看得清。
   *
   * 这里踩过一个坑：原先一律用 var(--ink) 当标签色。遇到 --ink 自己当底色的
   * 卡片，就成了深灰压深灰 —— 1:1，字彻底消失；--ink-2 / --ink-3 也好不到哪去
   * （1.59:1 / 2.28:1）。一个讲对比度的页面，自己 15 张色板的标签读不出来。
   *
   * 修法：拿 --ink 与 --ink-inverse 两个候选各算一次，取对比度高的那个。
   * 这两个色在每个主题里都是「深到极致」和「浅到极致」，所以无论底色落在哪一段，
   * 总有一个能读 —— 不需要再引入新的颜色令牌。
   */
  const labelVar = (() => {
    const ink = tk('--ink');
    const inv = tk('--ink-inverse');
    if (!ink || !inv || !bg) return '--ink';
    return contrast(ink, bg) >= contrast(inv, bg) ? '--ink' : '--ink-inverse';
  })();

  const node = el(`
    <button type="button" class="sw" data-token="${esc(token)}" title="点击复制 ${esc(token)}">
      <span class="sw__chip" style="background:var(${esc(token)});color:${fg ? `var(${esc(textToken)})` : `var(${labelVar})`}">
        ${fg ? '示例文字' : (ratio === null ? '' : ratio.toFixed(2) + ':1')}
      </span>
      <span class="sw__meta">
        <span class="sw__name">${esc(name)}</span>
        <span class="sw__hex">${esc(token)} · ${esc(bg)}</span>
        ${ratio !== null ? `<span class="sw__ratio" data-v="${v}">${ratio.toFixed(2)}:1 · ${VERDICT_TEXT[v]}${against ? '（对 ' + esc(against) + '）' : ''}</span>` : ''}
        ${note ? `<span class="sw__hex" style="margin-top:4px">${esc(note)}</span>` : ''}
      </span>
    </button>
  `);
  return node;
}

/* ==========================================================================
   5 · 渲染各章节
   ========================================================================== */

function renderHabits() {
  $('#habit-rows').innerHTML = HABITS.map(
    ([a, b, c]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td>${esc(c)}</td></tr>`
  ).join('');
}

function renderPrinciples() {
  $('#principles').innerHTML = PRINCIPLES.map(
    ([t, d], i) => `
      <div class="rule">
        <span class="rule__no">${String(i + 1).padStart(2, '0')}</span>
        <div class="rule__body">
          <p class="rule__title">${esc(t)}</p>
          <p class="rule__desc">${esc(d)}</p>
        </div>
      </div>`
  ).join('');
}

function renderIA() {
  $('#ia-tree').innerHTML = IA_TREE.map(([label, depth, tag]) => {
    const indent = '│  '.repeat(depth);
    const branch = depth === 0 ? '' : depth === 1 ? '├─ ' : '│  ├─ ';
    const bold = depth <= 1;
    const text = bold ? `<b>${esc(label)}</b>` : esc(label);
    const tail = tag ? `  <i>← ${esc(tag)}</i>` : '';
    return indent + branch + text + tail;
  }).join('\n');
}

function renderSurfaces() {
  const box = $('#sw-surfaces');
  const items = [
    ['--bg', '页面底', '燕麦米白 · 最暗的一层', '--surface'],
    ['--surface', '卡片面', '比页面亮一档', '--surface'],
    ['--surface-raised', '浮层 / 顶底栏', '再亮一档，也是浅色主题的反白文字色', '--surface'],
    ['--surface-sunken', '嵌入块', '卡内嵌入，比卡片暗', '--surface'],
    ['--surface-well', '进度槽', '最深，不放文字', '--surface'],
  ];
  box.innerHTML = '';
  for (const [token, name, note, against] of items) {
    box.appendChild(swatchCard({ token, name, note, against, kind: 'deco' }));
  }
}

function renderText() {
  const box = $('#sw-text');
  const items = [
    ['--ink', '主文字', '标题、数字、正文', '--surface-sunken'],
    ['--ink-2', '次文字', '说明、副标题', '--surface-sunken'],
    ['--ink-3', '三级文字', '脚注、时间戳、占位符、导航标签', '--surface-sunken'],
    ['--ink-inverse', '反白文字', '压在填充底上（此处对主强调底）', '--accent-fill'],
  ];
  box.innerHTML = '';
  for (const [token, name, note, against] of items) {
    box.appendChild(swatchCard({ token, name, note, against, kind: 'body' }));
  }
}

function renderSemantic() {
  const HUE_LABEL = {
    accent: '主强调 · 雾霾蓝', sage: '次强调 · 鼠尾草绿', up: '涨 / 危险 · 陶土红',
    down: '跌 / 成功 · 灰绿', warn: '警示 · 琥珀', lilac: '灰紫',
  };
  const box = $('#semantic-blocks');
  box.innerHTML = '';

  for (const hue of ['accent', 'sage', 'up', 'down', 'warn', 'lilac']) {
    const section = el(`
      <div style="margin-bottom:var(--sp-6)">
        <p class="subsub" style="margin-top:0">${esc(HUE_LABEL[hue])}</p>
        <div class="swatches"></div>
      </div>
    `);
    const grid = $('.swatches', section);

    grid.appendChild(swatchCard({
      token: `--${hue}-fill`, name: '填充底', note: '白字压其上',
      textToken: '--ink-inverse', kind: 'large',
    }));
    grid.appendChild(swatchCard({
      token: `--${hue}-text`, name: '文字色', note: '压在嵌入块上（最不利面）',
      against: '--surface-sunken', kind: 'body',
    }));
    grid.appendChild(swatchCard({
      token: `--${hue}-on-soft`, name: '胶囊文字', note: '压在自家浅底上',
      against: `--${hue}-soft`, kind: 'body',
    }));
    grid.appendChild(swatchCard({
      token: `--${hue}-soft`, name: '胶囊底', note: '背景，不受对比度约束', kind: 'deco',
    }));

    box.appendChild(section);
  }
}

function renderLines() {
  const box = $('#sw-lines');
  const items = [
    ['--line-soft', '弱分隔线', '仅装饰 · 去掉后信息仍完整', '--surface', 'deco'],
    ['--line', '主分隔线', '仅装饰 · 分组用', '--surface', 'deco'],
    ['--line-emphasis', '装饰性强调线', '滚动条、拖拽条、步骤点', '--surface', 'deco'],
    ['--line-strong', '交互控件描边', '输入框、开关 —— 承载「可操作」，需 ≥3:1', '--surface-sunken', 'ui'],
  ];
  box.innerHTML = '';
  for (const [token, name, note, against, kind] of items) {
    box.appendChild(swatchCard({ token, name, note, against, kind }));
  }
}

function renderTypeScale() {
  const box = $('#typescale');
  box.innerHTML = TYPE_SCALE.map(([token, use, sample]) => {
    const px = tk(token);
    return `
      <div class="ts-row">
        <div class="ts-row__meta"><b>${esc(token)}</b>${esc(px)}<br>${esc(use)}</div>
        <div class="ts-row__demo" style="font-size:var(${esc(token)});font-weight:var(--fw-medium)">${esc(sample)}</div>
      </div>`;
  }).join('');
}

function renderSimpleTable(id, rows) {
  const box = $(id);
  if (!box) return;
  box.innerHTML = rows.map(([a, b, c]) =>
    `<tr><td class="mono">${esc(a)}</td><td class="mono">${esc(b)}</td><td>${c ?? ''}</td></tr>`
  ).join('');
}

function renderSpacing() {
  const box = $('#spacing');
  const max = parseFloat(tk('--sp-12'));
  box.innerHTML = SPACING.map((token) => {
    const px = parseFloat(tk(token));
    const pct = Math.round((px / max) * 100);
    return `
      <div class="space-row">
        <span class="space-row__name">${esc(token)}</span>
        <span class="space-row__val">${esc(tk(token))}</span>
        <span style="display:flex;align-items:center;gap:var(--sp-3)">
          <span class="space-bar" style="width:${pct}%"></span>
          <span style="font-size:var(--fs-2xs);color:var(--ink-3)">${esc(SPACING_USE[token] || '')}</span>
        </span>
      </div>`;
  }).join('');
}

function renderRadii() {
  $('#radii').innerHTML = RADII.map(([token, use]) => `
    <div>
      <div class="radius-demo" style="border-radius:var(${esc(token)})">${esc(tk(token))}</div>
      <p class="ts-row__meta" style="margin-top:var(--sp-2)"><b>${esc(token)}</b>${esc(use)}</p>
    </div>`).join('');
}

function renderShadows() {
  $('#shadows').innerHTML = SHADOWS.map(([token, use]) => `
    <div>
      <div class="shadow-demo" style="box-shadow:var(${esc(token)})">${esc(token)}</div>
      <p class="ts-row__meta" style="margin-top:var(--sp-3)">${esc(use)}</p>
    </div>`).join('');
}

function renderIcons() {
  const box = $('#icon-grid');
  const names = Object.keys(icons);
  box.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:var(--sp-2)">
      ${names.map((n) => `
        <div style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:var(--sp-3) var(--sp-2);border-radius:var(--r-sm);background:var(--surface-sunken)">
          <span style="width:21px;height:21px;color:var(--ink-2);display:block">${icons[n]}</span>
          <span style="font-size:var(--fs-2xs);font-family:var(--font-num);color:var(--ink-3);word-break:break-all;text-align:center">${esc(n)}</span>
        </div>`).join('')}
    </div>
    <p class="note" style="margin-top:var(--sp-4)">共 ${names.length} 个图标，全部手写 SVG，零图标库。</p>
  `;
}

function renderEasings() {
  $('#easings').innerHTML = EASINGS.map(([token, value, use]) => `
    <div class="panel" style="padding:var(--sp-4)">
      <p class="panel__title" style="margin-bottom:var(--sp-2)">${esc(use)}</p>
      <div style="height:34px;display:flex;align-items:center">
        <span data-ease-demo="${esc(token)}" style="width:18px;height:18px;border-radius:50%;background:var(--accent-fill);display:block"></span>
      </div>
      <p class="ts-row__meta" style="margin-top:var(--sp-2)"><b>${esc(token)}</b><span style="word-break:break-all">${esc(value)}</span></p>
    </div>`).join('');
}

/* ==========================================================================
   6 · 组件演示
   ========================================================================== */

/** 一个演示块：标题 + 说明 + 舞台 */
function demo(title, desc, body, opts = {}) {
  const node = el(`
    <div style="margin-bottom:var(--sp-8)">
      <h3 class="subsub" style="margin-top:0">${esc(title)}</h3>
      ${desc ? `<p class="note" style="margin-bottom:var(--sp-3)">${desc}</p>` : ''}
      <div class="panel">
        <div class="stage ${opts.col ? 'stage--col' : ''} ${opts.plain ? 'stage--plain' : ''}">${body}</div>
      </div>
    </div>
  `);
  return node;
}

/** 状态行：左侧标状态名，右侧放实例 */
function stateRow(name, inner) {
  return `<div class="state-grid"><span class="state-grid__name">${esc(name)}</span><span>${inner}</span></div>`;
}

function renderComponents() {
  const box = $('#component-blocks');
  box.innerHTML = '';

  /* ---- 按钮 ---- */
  box.appendChild(demo('按钮', '主按钮用于页面唯一的最高优先级动作，一个页面最多一个。次级动作用次级按钮，第三层用幽灵按钮。', `
    ${stateRow('主按钮', `<button class="btn btn--primary">开始扫描</button>`)}
    ${stateRow('次级', `<button class="btn">刷新数据</button>`)}
    ${stateRow('幽灵', `<button class="btn btn--ghost">查看全部</button>`)}
    ${stateRow('危险', `<button class="btn btn--danger">清空模拟盘</button>`)}
    ${stateRow('小尺寸', `<button class="btn btn--primary btn--sm">买入</button>`)}
    ${stateRow('禁用', `<button class="btn btn--primary" disabled style="opacity:.45;cursor:not-allowed">不可用</button>`)}
    ${stateRow('加载中', `<button class="btn btn--primary" aria-busy="true" style="pointer-events:none">
      <span class="skel" style="width:14px;height:14px;border-radius:50%;background:color-mix(in srgb, var(--ink-inverse) 45%, transparent)"></span>扫描中</button>`)}
    ${stateRow('块级', `<button class="btn btn--primary btn--block">整行按钮</button>`)}
  `, { col: true }));

  /* ---- 胶囊 ---- */
  const chips = ['accent', 'sage', 'up', 'down', 'warn', 'lilac', 'clay', 'outline']
    .map((k) => `<span class="chip chip--${k}">${{ accent: '港股通', sage: '沪股通', up: '涨停', down: '跌停', warn: '高波动', lilac: '科创板', clay: '主板', outline: '自选' }[k]}</span>`)
    .join('');
  box.appendChild(demo('胶囊标签', '用于分类与状态。底色是对应色相的 <code>-soft</code>，文字用 <code>-on-soft</code> —— 两个角色都独立达标。', chips));

  /* ---- 市场徽标 / 动作标签 ---- */
  box.appendChild(demo('市场徽标与动作标签', `市场徽标是三个字母缩写，窄列里比中文标签省一半宽度；动作标签把 AI 建议映射到色相 —— <code>actionChip()</code> 内部查表，传中文动作即可，未收录的动作自动落到描边款。`, `
    <div style="width:100%;display:flex;flex-direction:column;gap:var(--sp-4)">
      <div style="display:flex;gap:var(--sp-2);align-items:center">
        ${['cn', 'hk', 'us'].map((m) => marketBadge(m)).join('')}
        <span class="note" style="font-size:var(--fs-2xs);color:var(--ink-3)">marketBadge('cn' | 'hk' | 'us')</span>
      </div>
      <div style="display:flex;gap:var(--sp-2);align-items:center;flex-wrap:wrap">
        ${['加仓', '持有', '减仓', '观察', '买入', '卖出'].map((a) => actionChip(a)).join('')}
        <span class="note" style="font-size:var(--fs-2xs);color:var(--ink-3)">actionChip(动作)</span>
      </div>
    </div>
  `, { col: true }));

  /* ---- 数值排版 ---- */
  // price() 负责千分位与固定小数位，dirClass() 负责把涨跌映射成 class。
  // 规范页必须演示这两个，因为「数字怎么对齐、颜色从哪来」是金融 UI 最容易走样的地方。
  const NUM_ROWS = [
    { code: '600519', name: '贵州茅台', v: 1687.4, chg: 2.34 },
    { code: '300750', name: '宁德时代', v: 214.86, chg: -1.27 },
    { code: '00700', name: '腾讯控股', v: 412.6, chg: 0 },
  ];
  box.appendChild(demo('数值排版', `价格用 <code>price()</code> 输出千分位，涨跌用 <code>dirClass()</code> 映射到 <code>up</code>/<code>down</code>/<code>flat</code> 三个 class。等宽数字保证小数点竖直对齐 —— 用比例字体会让价格列左右跳动。`, `
    <div style="width:100%;display:flex;flex-direction:column;gap:var(--sp-2)">
      ${NUM_ROWS.map((r) => `<div style="display:flex;align-items:baseline;gap:var(--sp-3)">
        <span style="flex:1;font-size:var(--fs-sm);color:var(--ink-2)">${esc(r.name)}</span>
        <span style="font-family:var(--font-num);font-size:var(--fs-md);font-variant-numeric:tabular-nums">${price(r.v)}</span>
        <span class="${dirClass(r.chg)}" style="width:74px;text-align:right;font-family:var(--font-num);font-size:var(--fs-sm);font-weight:var(--fw-medium)">${pct(r.chg)}</span>
      </div>`).join('')}
    </div>
  `, { col: true }));

  /* ---- 指标卡 ---- */
  const statRow = PORTFOLIO.total;
  // 今日盈亏卡的走势：用净值序列的最近一段，而不是复用总资产那条 ——
  // 同一个序列画两张卡，看起来像有两个数据源，实际只有一个。
  const spark30 = PAPER_NAV.slice(-30).map((p) => p.nav);
  box.appendChild(demo('指标卡', '首页的核心。数字用等宽字体，涨跌色直接取 <code>-text</code> 角色。走势图必须显式指定语义色，不能靠 delta 正负推断 —— 否则盈利时可能画出绿线。', `
    <div class="stat-grid" style="width:100%">
      ${statCard({ label: '总资产', iconName: 'wallet', value: money(statRow.mv), unit: '元', tone: 'accent', spark: statRow.spark, sparkTone: 'accent' })}
      ${statCard({ label: '今日盈亏', iconName: 'trendUp', value: money(statRow.todayPnl), delta: statRow.todayPnl, deltaPct: pct(statRow.todayPct), foot: '较昨收', spark: spark30, sparkTone: 'up' })}
      ${statCard({ label: '持仓盈亏', iconName: 'chart', value: money(statRow.pnl), delta: statRow.pnl, deltaPct: pct(statRow.pnlPct), foot: '累计' })}
      ${statCard({ label: '持仓数', iconName: 'wallet', value: String(PORTFOLIO.accounts.reduce((n, a) => n + a.positions.length, 0)), unit: '只', foot: PORTFOLIO.accounts.length + ' 个账户' })}
    </div>
  `, { col: true }));

  /* ---- 个股行 ---- */
  const stocks = WATCHLIST.slice(0, 3);
  box.appendChild(demo('个股行', '列表的最小单元。左侧代码与名称，右侧价格与涨跌。整行可点，行高 56px 保证触控目标。', `
    <div class="list" style="width:100%">
      ${stocks.map((s) => stockRow(s, { mode: 'watch' })).join('')}
    </div>
  `, { col: true }));

  /* ---- 账户卡 ---- */
  box.appendChild(demo('账户卡', '按券商分组。展开后显示市值与盈亏汇总，用 <code>dl</code> 语义而非纯 div。', `
    <div style="width:100%">${accountCard(PORTFOLIO.accounts[0])}</div>
  `, { col: true }));

  /* ---- 列表行 ---- */
  box.appendChild(demo('列表行', '设置、渠道、菜单都用这个。左侧图标用 <code>-soft</code> 底 + <code>-on-soft</code> 图标，右侧尾部内容右对齐。', `
    <div class="list" style="width:100%">
      ${settingRow({ iconName: 'bell', title: '提醒渠道', desc: '微信、邮件、短信', tail: '6 个已开启' })}
      ${settingRow({ iconName: 'server', title: '数据源', desc: '上游 API 地址', tail: '演示数据' })}
      ${settingRow({ iconName: 'shield', title: '隐私', desc: '数据仅存本机', tone: 'warn' })}
    </div>
  `, { col: true }));

  /* ---- 开关 ---- */
  box.appendChild(demo('开关', '用 <code>role="switch"</code> + <code>aria-checked</code>。开态底色用 <code>--accent-fill</code>（对卡片面 4.42:1，满足非文本 UI 的 3:1）。', `
    ${stateRow('开', switchEl(true))}
    ${stateRow('关', switchEl(false))}
    ${stateRow('禁用', switchEl(true, 'aria-disabled="true" style="opacity:.45;pointer-events:none"'))}
  `, { col: true }));

  /* ---- 分段控件 ---- */
  box.appendChild(demo('分段控件', '2–4 个互斥选项。用 <code>aria-selected</code> 表达选中，不用纯视觉。超过 4 个改用横向滚动的标签页。', `
    <div class="segmented">
      <button class="segmented__btn" aria-selected="true">全部</button>
      <button class="segmented__btn">高置信</button>
      <button class="segmented__btn">低风险</button>
    </div>
  `));

  /* ---- 输入框 ---- */
  box.appendChild(demo('输入框', '边框用 <code>--line-strong</code> —— 承载「可输入」的信息，必须 ≥3:1。聚焦时边框变强调色并加焦点环。', `
    ${stateRow('默认', `<div class="input" style="width:100%"><input type="text" placeholder="输入股票代码或名称" value=""></div>`)}
    ${stateRow('已填', `<div class="input" style="width:100%"><input type="text" value="600519"></div>`)}
    ${stateRow('聚焦', `<div class="input" style="width:100%;border-color:var(--accent-fill);box-shadow:var(--focus-ring)"><input type="text" value="600519"></div>`)}
    ${stateRow('错误', `<div class="input" style="width:100%;border-color:var(--up-text)"><input type="text" value="60051" aria-invalid="true"></div>`)}
    ${stateRow('禁用', `<div class="input" style="width:100%;opacity:.5"><input type="text" value="不可编辑" disabled></div>`)}
  `, { col: true }));

  /* ---- 提示条 ---- */
  box.appendChild(demo('提示条', '四种语义各一套 <code>-soft</code> 底 + <code>-on-soft</code> 文字。图标不只是装饰，它承担了「这是哪类信息」的第一识别。', `
    <div style="width:100%;display:flex;flex-direction:column;gap:var(--sp-2)">
      <div class="notice"><span style="width:15px;height:15px;flex:none;color:var(--accent-text)">${icons.info}</span><span><b>信息</b> · 演示数据不联网，所有数字为内置样例。</span></div>
      <div class="notice" style="background:var(--warn-soft);border-color:transparent;color:var(--warn-on-soft)"><span style="width:15px;height:15px;flex:none">${icons.warn}</span><span><b>警示</b> · 持仓集中度 68%，高于建议的 50%。</span></div>
      <div class="notice" style="background:var(--up-soft);border-color:transparent;color:var(--up-on-soft)"><span style="width:15px;height:15px;flex:none">${icons.warn}</span><span><b>危险</b> · 该操作会清空模拟盘全部记录。</span></div>
      <div class="notice" style="background:var(--down-soft);border-color:transparent;color:var(--down-on-soft)"><span style="width:15px;height:15px;flex:none">${icons.check}</span><span><b>成功</b> · 已保存 3 条提醒条件。</span></div>
    </div>
  `, { col: true }));

  /* ---- 空状态 ---- */
  box.appendChild(demo('空状态', '空状态要给出下一步动作，不能只说「暂无数据」。一句话说明为什么空 + 一个可点的出口。', `
    <div style="width:100%">${emptyState('还没有持仓记录', 'wallet')}</div>
  `, { col: true }));

  /* ---- 骨架屏 ---- */
  box.appendChild(demo('骨架屏', '只在首次加载时用，且必须保持与真实内容相同的尺寸 —— 否则内容到位时布局会跳，比直接白屏更让人不适。', `
    <div style="width:100%;display:flex;flex-direction:column;gap:var(--sp-3)">
      <div style="display:flex;gap:var(--sp-3);align-items:center">
        <span class="skel" style="width:30px;height:30px;border-radius:var(--r-sm)"></span>
        <span style="flex:1;display:flex;flex-direction:column;gap:6px">
          <span class="skel" style="width:46%;height:11px"></span>
          <span class="skel" style="width:28%;height:11px"></span>
        </span>
        <span class="skel" style="width:58px;height:13px"></span>
      </div>
      <div style="display:flex;gap:var(--sp-3);align-items:center">
        <span class="skel" style="width:30px;height:30px;border-radius:var(--r-sm)"></span>
        <span style="flex:1;display:flex;flex-direction:column;gap:6px">
          <span class="skel" style="width:38%;height:11px"></span>
          <span class="skel" style="width:22%;height:11px"></span>
        </span>
        <span class="skel" style="width:58px;height:13px"></span>
      </div>
    </div>
  `, { col: true }));

  /* ---- 进度 / 评分条 ---- */
  box.appendChild(demo('进度条与评分', '权重条用色相区分涨跌；评分徽标用三档语义色。所有条的底槽用 <code>--surface-well</code>（装饰，豁免对比度）。', `
    <div style="width:100%;display:flex;flex-direction:column;gap:var(--sp-3)">
      <div class="meter">
        <span class="meter__label">贵州茅台</span>
        <span class="bar"><span class="bar__fill bar__fill--up" style="width:34%"></span></span>
        <span class="meter__val">34.2%</span>
      </div>
      <div class="meter">
        <span class="meter__label">宁德时代</span>
        <span class="bar"><span class="bar__fill bar__fill--sage" style="width:22%"></span></span>
        <span class="meter__val">22.1%</span>
      </div>
      <div class="meter">
        <span class="meter__label">中国平安</span>
        <span class="bar"><span class="bar__fill bar__fill--down" style="width:15%"></span></span>
        <span class="meter__val">14.8%</span>
      </div>
      <div style="display:flex;gap:var(--sp-2);margin-top:var(--sp-2)">
        ${scoreBadge(88)} ${scoreBadge(64)} ${scoreBadge(32)}
        <span class="note" style="font-size:var(--fs-2xs);align-self:center;color:var(--ink-3)">评分徽标 · 高 / 中 / 低</span>
      </div>
    </div>
  `, { col: true }));

  /* ---- 环形图 ---- */
  // donut() 只吃 { label, pct }，颜色由 charts.js 内置的 DONUT_COLORS 决定。
  // 自己传 color 是无效的 —— 图例必须读同一个数组，否则色块和弧线对不上。
  const alloc = [
    { label: 'A 股', pct: 62, value: 62 },
    { label: '港股', pct: 24, value: 24 },
    { label: '美股', pct: 14, value: 14 },
  ];
  box.appendChild(demo('环形图', '手写 SVG，零图表库。环形用于表达「占比构成」，不适合表达趋势 —— 趋势要用面积图或 K 线。颜色由 <code>DONUT_COLORS</code> 统一分配，图例与弧线读同一个源。', `
    <div style="display:flex;gap:var(--sp-6);align-items:center;flex-wrap:wrap">
      ${donut(alloc, { size: 118, thickness: 15 })}
      <div style="display:flex;flex-direction:column;gap:var(--sp-2)">
        ${alloc.map((a, i) => `<span style="display:flex;align-items:center;gap:var(--sp-2);font-size:var(--fs-sm)">
          <i style="width:10px;height:10px;border-radius:2px;background:${DONUT_COLORS[i % DONUT_COLORS.length]};display:block"></i>
          ${esc(a.label)} <b style="font-family:var(--font-num);font-weight:var(--fw-medium)">${a.pct}%</b>
        </span>`).join('')}
      </div>
    </div>
  `));

  /* ---- 走势图 / 面积图 ---- */
  // areaChart 吃的是 [{ nav, benchmark? }]，PAPER_NAV 正是这个形状 ——
  // 不要自己映射成 {x,y}，那会让 nav / benchmark 两条线全部丢失。
  box.appendChild(demo('走势图', '迷你走势图与面积图都是手写 SVG。颜色从 CSS 变量取，所以切主题会自动跟随。面积图直接吃 <code>{ nav, benchmark }</code> 序列，自动画策略与基准双线。', `
    <div style="display:flex;gap:var(--sp-6);flex-wrap:wrap;align-items:flex-end">
      <div>
        <p class="ts-row__meta" style="margin-bottom:var(--sp-2)"><b>迷你走势</b>sparkline</p>
        ${sparkline(PORTFOLIO.total.spark, { w: 96, h: 30, color: 'var(--accent-fill)', fill: true })}
      </div>
      <div>
        <p class="ts-row__meta" style="margin-bottom:var(--sp-2)"><b>上涨走势</b>up</p>
        ${sparkline(spark30, { w: 96, h: 30, up: true, fill: true })}
      </div>
      <div>
        <p class="ts-row__meta" style="margin-bottom:var(--sp-2)"><b>下跌走势</b>down</p>
        ${sparkline(spark30.map((v) => -v), { w: 96, h: 30, up: false, fill: true })}
      </div>
      <div style="flex:1;min-width:220px">
        <p class="ts-row__meta" style="margin-bottom:var(--sp-2)"><b>面积图</b>净值曲线</p>
        ${areaChart(PAPER_NAV, { w: 240, h: 74, showGrid: false })}
      </div>
    </div>
  `));

  /* ---- 板块分布条 ---- */
  // hbars 吃 [{ label, value, text }]，正负决定色相（正涨负跌）。
  // 它复用 .meter 的 class，所以和上面「进度条」是同一种视觉语言。
  const SECTORS = [
    { label: '半导体', value: 3.42, text: '+3.42%' },
    { label: '白酒', value: 1.86, text: '+1.86%' },
    { label: '新能源', value: 0.74, text: '+0.74%' },
    { label: '医药', value: -0.92, text: '-0.92%' },
    { label: '地产', value: -2.15, text: '-2.15%' },
  ];
  box.appendChild(demo('板块分布条', '板块涨跌的横向条。长度按绝对值归一，色相按正负区分 —— 但右侧始终带符号数字，颜色只是强化，不是唯一线索。', `
    <div style="width:100%">${hbars(SECTORS)}</div>
  `, { col: true }));

  /* ---- 技术指标行 ---- */
  // signal 是枚举 'bull' | 'bear' | 'neutral'，不是中文 ——
  // techRow 用它选 chip 的色角色，中文会一路掉到 outline 分支。
  const TECH = [
    { name: 'MA', value: '多头排列', signal: 'bull', strength: 5, label: '金叉' },
    { name: 'MACD', value: 'DIF 上穿', signal: 'bull', strength: 4, label: '金叉' },
    { name: 'RSI', value: '58.2', signal: 'neutral', strength: 3, label: '中性' },
    { name: 'KDJ', value: '42.7', signal: 'bear', strength: 2, label: '死叉' },
    { name: 'BOLL', value: '中轨上方', signal: 'bull', strength: 4, label: '偏强' },
  ];
  box.appendChild(demo('技术指标行', '指标值 + 信号强度条 + 徽标。信号用色相表达方向，但徽标文字本身写清楚「金叉」「死叉」，不靠颜色单独传达 —— 色盲用户读文字同样完整。', `
    <div style="width:100%;display:flex;flex-direction:column;gap:var(--sp-2)">
      ${TECH.map((r) => techRow(r)).join('')}
    </div>
  `, { col: true }));

  /* ---- AI 结论块 ---- */
  box.appendChild(demo('AI 结论块', 'AI 给结论必须附推导链。金融场景里「看起来很厉害但无法验证」的结论等于没有价值，反而增加风险。', `
    <div class="ai-block" style="width:100%">
      <div class="ai-block__head">
        <span style="width:16px;height:16px;color:var(--accent-text)">${icons.spark}</span>
        <span class="ai-block__title">AI 深度分析</span>
        <span class="tag">7 步推导</span>
      </div>
      <div class="ai-block__body">
        <p>持仓集中度 68%，高于建议阈值。招商证券账户中白酒板块占 41%，与近期板块相关性 0.82 —— 若板块回调，账户整体回撤会放大。</p>
        <p style="margin-top:var(--sp-3);color:var(--ink-3);font-size:var(--fs-xs)">依据：13 只持仓 · 60 日相关性矩阵 · 板块权重</p>
      </div>
    </div>
  `, { col: true }));

  /* ---- 弹层 ---- */
  box.appendChild(demo('底部弹层', '挂在 <code>document.body</code> 下，脱离应用容器 —— 否则会被顶栏和底栏盖住。事件委托因此必须绑在 document 上，绑在容器上会导致弹层内按钮静默失效。', `
    <div style="width:100%;position:relative;height:250px;background:var(--bg);border-radius:var(--r-md);overflow:hidden">
      <div style="position:absolute;inset:0;background:var(--overlay)"></div>
      <div class="sheet" style="position:absolute;left:0;right:0;bottom:0;transform:none;max-width:none">
        <span class="sheet__handle"></span>
        <div class="sheet__head">
          <span class="sheet__title">新建提醒</span>
        </div>
        <div class="sheet__body">
          <div class="field">
            <span class="field__label">条件</span>
            <div class="alert-cond" style="margin-bottom:var(--sp-2)">
              <span class="alert-cond__logic">当</span>
              <span class="alert-cond__text">现价 高于 1800.00</span>
            </div>
            <p class="field__hint">满足全部条件时触发。条件之间是「且」的关系。</p>
          </div>
        </div>
        <div class="sheet__foot">
          <button class="btn btn--ghost btn--block">取消</button>
          <button class="btn btn--primary btn--block">保存</button>
        </div>
      </div>
    </div>
  `, { plain: true }));

  /* ---- Toast ---- */
  box.appendChild(demo('轻提示', '短暂反馈，不打断操作。用 <code>aria-live="polite"</code> 让读屏播报。最多显示一条 —— 排队出现的 Toast 用户根本来不及看。', `
    <div style="display:flex;flex-direction:column;gap:var(--sp-2)">
      <div class="toast" style="position:static;transform:none">已复制到剪贴板</div>
      <div class="toast" style="position:static;transform:none">已刷新 13 只持仓</div>
    </div>
  `, { col: true }));

  /* ---- FAB ---- */
  box.appendChild(demo('浮动按钮', '全站唯一的最高优先级动作。位置固定在右下、底栏之上，拇指最容易够到的地方。底色用 <code>--accent-fill</code>，白字 4.84:1。', `
    <div style="display:flex;align-items:center;gap:var(--sp-5)">
      <span class="fab" style="position:static;transform:none">${icons.spark}<span>AI 扫描</span></span>
      <span class="note" style="font-size:var(--fs-xs)">滚动时收缩为圆形，只留图标</span>
    </div>
  `));
}

/* ==========================================================================
   7 · 页面预览
   ========================================================================== */

const PAGES = [
  ['首页 · 今日概览', 'home', '快查型用户 40 秒内要看到三个数：今天赚了多少、总资产多少、持仓几只。其余全部降级 —— 指数横滑、持仓只给 Top 3、提醒只给未读。'],
  ['持仓', 'portfolio', '回答「我的钱都在哪」。按券商分组是真实用户的心智模型 —— 他们记得的是「招商那个账户」，不是「持仓列表第 3 行」。'],
  ['个股详情', 'stock', '从任何列表点进来。首屏是价格与涨跌，往下是 K 线、五项技术指标、信号与 AI 分析。这一页允许信息密度高，因为用户是主动进来的。'],
  ['提醒', 'alerts', '条件盯守型用户的主场。每个条件可独立开关，关闭的卡片整体降级（不删除）—— 用户需要看到「我设过这个」。'],
];

function renderPages() {
  const box = $('#page-blocks');
  box.innerHTML = '';
  for (const [title, hash, desc] of PAGES) {
    const node = el(`
      <div style="margin-bottom:var(--sp-8)">
        <h3 class="subsub" style="margin-top:0">${esc(title)}</h3>
        <p class="note" style="margin-bottom:var(--sp-4)">${esc(desc)}</p>
        <div class="phones">
          <div class="phone">
            <p class="phone__label">实时预览</p>
            <div class="phone__frame">
              <iframe src="../index.html#/${esc(hash)}" title="${esc(title)} 实时预览" loading="lazy"></iframe>
            </div>
            <p class="phone__cap">这是真实运行的应用，不是截图。改代码这里立刻变。</p>
          </div>
        </div>
      </div>
    `);
    box.appendChild(node);
  }
}

/* ==========================================================================
   8 · 可访问性实测
   ========================================================================== */

function renderA11y() {
  const rows = [];
  let pass = 0, fail = 0, largeOnly = 0, exempt = 0;

  for (const group of A11Y_GROUPS) {
    for (const [label, fgToken, bgToken] of group.pairs) {
      const fg = tk(fgToken);
      const bg = tk(bgToken);
      if (!fg || !bg) continue;
      const ratio = r2(contrast(fg, bg));
      const v = verdictOf(ratio, group.kind);
      rows.push({ group: group.name, label, fgToken, bgToken, fg, bg, ratio, kind: group.kind, v });
      if (v === 'pass') pass++;
      else if (v === 'fail') fail++;
      else if (v === 'large') largeOnly++;
      else exempt++;
    }
  }

  const judged = pass + fail + largeOnly;
  const themeName = document.documentElement.getAttribute('data-theme') === 'dark' ? '深色' : '浅色';

  $('#a11y-summary').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:var(--sp-6);align-items:baseline">
      <div>
        <p class="panel__title" style="margin-bottom:4px">当前主题</p>
        <p style="font-size:var(--fs-xl);font-weight:var(--fw-bold)">${themeName}</p>
      </div>
      <div>
        <p class="panel__title" style="margin-bottom:4px">受判定组合</p>
        <p style="font-size:var(--fs-xl);font-weight:var(--fw-bold);font-family:var(--font-num)">${judged}</p>
      </div>
      <div>
        <p class="panel__title" style="margin-bottom:4px">达标</p>
        <p style="font-size:var(--fs-xl);font-weight:var(--fw-bold);font-family:var(--font-num);color:var(--down-text)">${pass}</p>
      </div>
      <div>
        <p class="panel__title" style="margin-bottom:4px">不达标</p>
        <p style="font-size:var(--fs-xl);font-weight:var(--fw-bold);font-family:var(--font-num);color:${fail ? 'var(--up-text)' : 'var(--ink-3)'}">${fail}</p>
      </div>
      <div>
        <p class="panel__title" style="margin-bottom:4px">装饰豁免</p>
        <p style="font-size:var(--fs-xl);font-weight:var(--fw-bold);font-family:var(--font-num);color:var(--ink-3)">${exempt}</p>
      </div>
    </div>
    <p class="note" style="margin-top:var(--sp-4)">
      数值在页面加载时现算，读的是 CSS 变量的当前值。切换上方主题按钮，整张表会按新主题重算。
    </p>
  `;

  let lastGroup = '';
  $('#a11y-rows').innerHTML = rows.map((r) => {
    const head = r.group !== lastGroup
      ? `<tr><td colspan="5" style="background:var(--surface-sunken);font-size:var(--fs-2xs);font-family:var(--font-num);color:var(--ink-3);letter-spacing:var(--ls-wide);padding:var(--sp-2) var(--sp-3)">${esc(r.group)}</td></tr>`
      : '';
    lastGroup = r.group;
    return `${head}
      <tr>
        <td>${esc(r.label)}<br><span class="mono" style="color:var(--ink-3)">${esc(r.fgToken)} / ${esc(r.bgToken)}</span></td>
        <td><span class="sample" style="background:${esc(r.bg)};color:${esc(r.fg)}">示例 Aa 8.8</span></td>
        <td class="mono">${r.ratio.toFixed(2)}:1</td>
        <td class="mono">${r.kind === 'deco' ? '—' : THRESHOLD[r.kind].toFixed(1)}</td>
        <td><span class="ratio-badge" data-v="${r.v}">${VERDICT_TEXT[r.v]}</span></td>
      </tr>`;
  }).join('');

  renderSimpleTable('#a11y-semantics', A11Y_SEMANTICS.map(([a, b]) => [a, '', b]));
}

/* ==========================================================================
   9 · 交互
   ========================================================================== */

const STORE_KEY = 'panwatch-h5:v1';

function currentThemeSetting() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw).settings || {}).theme || 'system' : 'system';
  } catch { return 'system'; }
}

function applyTheme(mode) {
  if (mode === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    data.settings = { ...(data.settings || {}), theme: mode };
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch { /* 隐私模式下写不了，忽略 */ }
}

function syncThemeButtons() {
  const mode = currentThemeSetting();
  document.querySelectorAll('[data-theme-set]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.themeSet === mode));
  });
}

function initTheme() {
  syncThemeButtons();
  document.querySelectorAll('[data-theme-set]').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.themeSet);
      syncThemeButtons();
      // 主题变了，令牌值全变 → 重算所有依赖令牌的渲染
      rerender();
    });
  });

  // 跟随系统时，系统主题变化也要重算
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (currentThemeSetting() === 'system') rerender();
  });
}

/** 目录高亮：用 IntersectionObserver，比 scroll 事件省 */
function initTOC() {
  const links = Array.from(document.querySelectorAll('.spec-toc__list a'));
  const targets = links
    .map((a) => document.querySelector(a.getAttribute('href')))
    .filter(Boolean);
  if (!targets.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (!visible.length) return;
      const id = '#' + visible[0].target.id;
      links.forEach((a) => a.setAttribute('aria-current', String(a.getAttribute('href') === id)));
    },
    { rootMargin: '-72px 0px -60% 0px', threshold: 0 }
  );
  targets.forEach((t) => io.observe(t));
}

/** 点色卡复制令牌名 */
function initCopy() {
  document.addEventListener('click', async (e) => {
    const sw = e.target.closest('.sw');
    if (!sw) return;
    const token = sw.dataset.token;
    try {
      await navigator.clipboard.writeText(token);
    } catch {
      // 非安全上下文下 clipboard 不可用，退回 execCommand
      const ta = document.createElement('textarea');
      ta.value = token;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* 放弃 */ }
      ta.remove();
    }
    sw.dataset.copied = 'true';
    setTimeout(() => { delete sw.dataset.copied; }, 1400);
  });
}

/** 缓动演示：把小球推到右边再弹回，循环播放 */
function initEasingDemos() {
  const dots = Array.from(document.querySelectorAll('[data-ease-demo]'));
  if (!dots.length) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const ease = (token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim();

  setInterval(() => {
    dots.forEach((dot) => {
      const token = dot.dataset.easeDemo;
      dot.style.transition = `transform 520ms ${ease(token)}`;
      dot.style.transform = dot.style.transform === 'translateX(180px)' ? 'none' : 'translateX(180px)';
    });
  }, 900);
}

/* ==========================================================================
   10 · 启动
   ========================================================================== */

function renderAll() {
  readTokens();

  renderHabits();
  renderPrinciples();
  renderIA();
  renderSurfaces();
  renderText();
  renderSemantic();
  renderLines();
  renderTypeScale();
  renderSimpleTable('#weights', WEIGHTS);
  renderSimpleTable('#lineheights', LINE_HEIGHTS);
  renderSimpleTable('#letterspacings', LETTER_SPACINGS);
  renderSpacing();
  renderRadii();
  renderShadows();
  renderSimpleTable('#zindex', ZINDEX);
  renderIcons();
  renderSimpleTable('#durations', DURATIONS);
  renderEasings();
  renderComponents();
  renderPages();
  renderA11y();
}

function rerender() {
  // 主题切换只影响「依赖令牌值」的部分：色板、对比度表、缓动。
  // 内容型章节（习惯、原则、IA、字阶尺寸）不随主题变，不必重渲染 ——
  // 重渲染还会把 iframe 里的预览页刷掉。
  renderSurfaces();
  renderText();
  renderSemantic();
  renderLines();
  renderA11y();
}

renderAll();
initTheme();
initTOC();
initCopy();
initEasingDemos();
