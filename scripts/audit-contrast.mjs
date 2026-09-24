#!/usr/bin/env node
/* ==========================================================================
   audit-contrast.mjs · WCAG 2.1 对比度实测 + 令牌泄漏扫描
   --------------------------------------------------------------------------
   做两件事：
     A. 解析 css/tokens.css，对「实际会同时出现在屏幕上的前景/背景组合」
        逐一计算对比度并判定。
     B. 扫描其余 CSS 文件里硬编码的颜色值，找出绕过了令牌体系的那些 ——
        它们通常是「撞到问题就地打补丁」的残留，是设计系统腐化的起点。

   为什么不用现成库：
     - 只需要 WCAG 2.1 相对亮度一个公式，二十行写完；
     - 组合清单是「设计决策」，必须显式声明（哪层文字压在哪层面板上），
       交给库去猜反而会漏掉真实场景。

   阈值（WCAG 2.1）：
     正文文字          ≥ 4.5 : 1   SC 1.4.3 Level AA
     大字 / 图形文字   ≥ 3.0 : 1   SC 1.4.3（≥24px，或 ≥18.66px 且 bold）
     非文本 UI 组件    ≥ 3.0 : 1   SC 1.4.11
     装饰性元素        无要求        SC 1.4.11 明确豁免
       └ 判据：该元素消失后信息是否仍然完整？是 → 装饰。

   大字判定单独成列：同一个色能当 28px 的涨跌数字，不代表能当 12px 的标签。
   把两者混为一谈，要么冤枉了设计，要么放过了缺陷。

   用法：
     node scripts/audit-contrast.mjs            # 打印报告
     node scripts/audit-contrast.mjs --json     # 额外写 docs/contrast-audit.json
     node scripts/audit-contrast.mjs --md       # 额外写 docs/contrast-audit.md
   ========================================================================== */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const CSS_DIR = join(ROOT, 'css');
const TOKENS_FILE = 'tokens.css';

/* --------------------------------------------------------------------------
   1. 解析 CSS
   -------------------------------------------------------------------------- */

/** 去掉块注释，避免注释里的 #hex 被误当成声明。 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** 把选择器 + 声明块拆出来（内容里不允许再嵌套 { }）。 */
function blocks(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripComments(css))) !== null) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

/**
 * 提取三套主题的令牌表：{ light: {name: value}, dark: {...} }
 *  - `:root { }`                              → light
 *  - `[data-theme="dark"] { }`                 → dark
 *  - `@media (prefers-color-scheme: dark)` 内  → 与 dark 重复，跳过
 *
 * 令牌值可能是 `var(--other)` 别名（v2 的兼容层就是这么写的），
 * 所以要解析一层间接引用，否则别名令牌会被当成「没有值」丢掉。
 */
function parseTokens(css) {
  const raw = { light: {}, dark: {} };
  const alias = { light: {}, dark: {} };

  for (const { selector, body } of blocks(css)) {
    let target = null;
    if (/:root/.test(selector) && !/data-theme/.test(selector)) target = 'light';
    else if (/\[data-theme=["']dark["']\]/.test(selector)) target = 'dark';
    if (!target) continue;

    const decl = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let d;
    while ((d = decl.exec(body)) !== null) {
      const name = d[1];
      const value = d[2].trim();
      if (/^#[0-9a-fA-F]{3,8}$/.test(value)) raw[target][name] = normalizeHex(value);
      else {
        const v = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
        if (v) alias[target][name] = v[1];
      }
    }
  }

  // 解析别名：最多跟 4 层，避免环形引用时死循环
  const resolve = (target, name, depth = 0) => {
    if (raw[target][name]) return raw[target][name];
    if (depth > 4) return null;
    const next = alias[target][name];
    if (!next) return null;
    return resolve(target, next, depth + 1);
  };

  const themes = { light: {}, dark: {} };
  for (const t of ['light', 'dark']) {
    for (const name of [...Object.keys(raw[t]), ...Object.keys(alias[t])]) {
      const v = resolve(t, name);
      if (v) themes[t][name] = v;
    }
    // 暗色主题没覆盖的令牌继承浅色（与浏览器层叠行为一致）
    for (const [name, v] of Object.entries(themes.light)) {
      if (!themes[t][name]) themes[t][name] = v;
    }
  }
  return themes;
}

/* --------------------------------------------------------------------------
   2. 颜色与对比度
   -------------------------------------------------------------------------- */

/** #rgb / #rrggbb → 小写 #rrggbb（8 位忽略 alpha，本表不含半透明色） */
function normalizeHex(hex) {
  let h = hex.replace('#', '').toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 8) h = h.slice(0, 6);
  return '#' + h;
}

const parseHex = (hex) => {
  const h = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

/** sRGB 单通道 → 线性光 */
const linearize = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** WCAG 2.1 相对亮度 */
const luminance = (rgb) => {
  const [r, g, b] = rgb.map(linearize);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** 对比度 (L1+0.05)/(L2+0.05)，L1 为较亮者 */
function contrast(a, b) {
  const la = luminance(parseHex(a));
  const lb = luminance(parseHex(b));
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* --------------------------------------------------------------------------
   3. 待测组合清单 —— 设计决策，必须显式声明
   --------------------------------------------------------------------------
   kind 决定正文阈值：
     'body'  正文            4.5
     'large' 大字 / 图形文字   3.0
     'ui'    非文本 UI 组件    3.0
     'deco'  装饰性（豁免，仅记录）
   任何 kind 都会额外计算「大字是否达标」，输出为独立一列。
   -------------------------------------------------------------------------- */

const SURFACES = [
  ['页面底', '--bg'],
  ['顶底栏', '--surface-raised'],
  ['卡片面', '--surface'],
  ['嵌入块', '--surface-sunken'],
];

const TEXT_LEVELS = [
  ['主文字', '--ink', 'body'],
  ['次文字', '--ink-2', 'body'],
  ['三级文字', '--ink-3', 'body'],
];

/** 语义色当文字色（涨跌数字、状态标签）—— 用的是各色相的 -text 角色 */
const SEMANTIC_TEXT = [
  ['涨 · 陶土红', '--up-text'],
  ['跌 · 灰绿', '--down-text'],
  ['平 · 中性', '--flat-text'],
  ['警示 · 琥珀', '--warn-text'],
  ['主强调 · 雾霾蓝', '--accent-text'],
  ['次强调 · 鼠尾草', '--sage-text'],
  ['灰紫', '--lilac-text'],
];

/** 实心填充 + 反白文字（按钮、徽标、FAB）—— 每个色相的 -fill 角色 */
const INVERSE = [
  ['主按钮 / 徽标', '--ink-inverse', '--accent-fill'],
  ['次按钮 / 徽标', '--ink-inverse', '--sage-fill'],
  ['涨色徽标', '--ink-inverse', '--up-fill'],
  ['跌色徽标', '--ink-inverse', '--down-fill'],
  ['警示徽标', '--ink-inverse', '--warn-fill'],
  ['灰紫徽标', '--ink-inverse', '--lilac-fill'],
];

/** 浅底 + 同色系深字（胶囊标签、提示块）—— -on-soft 压 -soft */
const SOFT = [
  ['强调胶囊', '--accent-on-soft', '--accent-soft'],
  ['次强调胶囊', '--sage-on-soft', '--sage-soft'],
  ['涨胶囊', '--up-on-soft', '--up-soft'],
  ['跌胶囊', '--down-on-soft', '--down-soft'],
  ['警示胶囊', '--warn-on-soft', '--warn-soft'],
  ['灰紫胶囊', '--lilac-on-soft', '--lilac-soft'],
];

/** 非文本 UI：焦点环、交互控件描边 —— SC 1.4.11 真管辖的范围 */
const UI = [
  ['焦点环 · 卡片面', '--accent-fill', '--surface'],
  ['焦点环 · 页面底', '--accent-fill', '--bg'],
  ['控件描边 · 卡片面', '--line-strong', '--surface'],
  ['控件描边 · 页面底', '--line-strong', '--bg'],
  ['涨跌填充 · 涨', '--up-fill', '--surface'],
  ['涨跌填充 · 跌', '--down-fill', '--surface'],
];

/** 装饰性：豁免判定，仅记录数值 */
const DECO = [
  ['主分隔线', '--line', '--surface'],
  ['弱分隔线', '--line-soft', '--surface'],
  ['进度槽 / 拖拽条', '--surface-well', '--surface'],
  ['内嵌块', '--surface-sunken', '--surface'],
];

/* --------------------------------------------------------------------------
   4. 执行判定
   -------------------------------------------------------------------------- */

const RULES = { body: 4.5, large: 3.0, ui: 3.0 };

function auditTheme(label, theme, base) {
  const rows = [];
  const pick = (n) => theme[n] ?? base[n] ?? null;

  const add = (group, text, fgName, bgName, kind) => {
    const fg = pick(fgName);
    const bg = pick(bgName);
    if (!fg || !bg) return;
    const ratio = Math.round(contrast(fg, bg) * 100) / 100;
    const need = kind === 'deco' ? null : RULES[kind];
    rows.push({
      group,
      label: text,
      fgName,
      bgName,
      fg,
      bg,
      ratio,
      kind,
      need,
      // 正文判定：deco 不判，其余按各自阈值
      verdict: need === null ? 'N/A' : ratio >= need ? 'PASS' : 'FAIL',
      // 大字判定独立计算，供「能当大数字但不能当小标签」这类结论使用
      largeOk: ratio >= 3.0,
    });
  };

  for (const [sLabel, sName] of SURFACES) {
    for (const [tLabel, tName, kind] of TEXT_LEVELS) {
      add('文字 / 面板层级', `${tLabel} · ${sLabel}`, tName, sName, kind);
    }
  }
  for (const [l, n] of SEMANTIC_TEXT) add('语义色当文字', `${l} · 卡片面`, n, '--surface', 'body');
  for (const [l, n] of SEMANTIC_TEXT) add('语义色当文字', `${l} · 嵌入块`, n, '--surface-sunken', 'body');
  for (const [l, f, b] of INVERSE) add('反白文字（填充块）', l, f, b, 'large');
  for (const [l, f, b] of SOFT) add('浅底深字（胶囊）', l, f, b, 'body');
  for (const [l, f, b] of UI) add('非文本 UI（1.4.11）', l, f, b, 'ui');
  for (const [l, f, b] of DECO) add('装饰（豁免）', l, f, b, 'deco');

  return { label, rows };
}

/* --------------------------------------------------------------------------
   5. 令牌泄漏扫描
   --------------------------------------------------------------------------
   其余 CSS 文件里出现的字面色值，若不在令牌表中，即为泄漏。
   判据：设计系统里任何一个颜色都应当有名字 —— 没名字的颜色改不动。

   必须按 CSS 属性区分前景 / 背景：
     color / fill / stroke            → 前景，才谈得上对比度
     background / border / box-shadow → 背景或装饰，对比度无意义
   不区分的话，一个浅色背景会被拿去跟卡片面比，算出 1.15:1 这种噪音。
   -------------------------------------------------------------------------- */

const FG_PROPS = new Set(['color', 'fill', 'stroke']);
const BG_PROPS = new Set([
  'background', 'background-color', 'border', 'border-color', 'border-top',
  'border-bottom', 'border-left', 'border-right', 'box-shadow', 'outline-color',
]);

/** 从选择器判断这条声明属于哪套主题 */
const themeOf = (sel) => (/data-theme\s*=\s*["']?dark/.test(sel) ? 'dark' : 'light');

function scanLeaks(tokenValues, themes) {
  const known = new Set(tokenValues);
  const files = readdirSync(CSS_DIR).filter((f) => f.endsWith('.css') && f !== TOKENS_FILE);
  const raw = []; // 每一处硬编码色
  // 规则块索引：用来把同一个 { } 内的前景/背景配成对，
  // 无论它们是硬编码还是 var(--token)，都能还原出真实对比度。
  const blocks = new Map();

  for (const file of files) {
    const lines = readFileSync(join(CSS_DIR, file), 'utf8').split('\n');
    let selector = '(root)';

    lines.forEach((line, i) => {
      const clean = line.replace(/\/\*[\s\S]*?\*\//g, '');
      const selMatch = clean.match(/^([^{}/][^{}]*?)\s*\{/);
      if (selMatch) selector = selMatch[1].trim();

      // 先把 { 换成 ; 再按 ; 拆。否则 `.chip-x { background: #abc; color: #def }`
      // 里第一条声明会带着选择器前缀，匹配不上「属性: 值」，整条被丢掉。
      for (const decl of clean.replace(/\{/g, ';').split(';')) {
        const dm = decl.match(/^\s*([a-zA-Z-]+)\s*:\s*(.+)$/);
        if (!dm) continue;
        const prop = dm[1].toLowerCase();
        const role = FG_PROPS.has(prop) ? 'fg' : BG_PROPS.has(prop) ? 'bg' : null;
        if (!role) continue;

        const theme = themeOf(selector);
        const key = `${file}|${selector}|${theme}`;
        if (!blocks.has(key)) {
          blocks.set(key, { selector, theme, file, line: i + 1, fg: [], bg: [] });
        }
        const block = blocks.get(key);
        const bucket = block[role];

        const push = (ref, leak) => {
          if (!bucket.some((x) => x.ref === ref)) bucket.push({ ref, leak });
        };

        // 字面色值
        const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
        let hm;
        while ((hm = hexRe.exec(dm[2])) !== null) {
          const hex = normalizeHex(hm[0]);
          const leak = !known.has(hex);
          push(hex, leak);
          if (leak) raw.push({ hex, file, line: i + 1, selector, prop, role, theme });
        }
        // var(--token) 引用：本身不是泄漏，但配对时要能解析出真色
        const varRe = /var\(\s*(--[\w-]+)/g;
        let vm;
        while ((vm = varRe.exec(dm[2])) !== null) push('var:' + vm[1], false);
      }
    });
  }

  const r2 = (a, b) => Math.round(contrast(a, b) * 100) / 100;

  /* ---- 按色值聚合 ---- */
  const byHex = new Map();
  for (const u of raw) {
    if (!byHex.has(u.hex)) byHex.set(u.hex, []);
    byHex.get(u.hex).push(u);
  }

  const leaks = [...byHex.entries()]
    .map(([hex, uses]) => {
      const fgUses = uses.filter((u) => u.role === 'fg');
      const themesUsed = [...new Set(uses.map((u) => u.theme))];

      // 前景色只在它实际所属的那套主题背景上判定，
      // 否则暗色专用的浅色会被拿去跟浅色卡片比，算出假缺陷。
      const ratios = {};
      for (const t of themesUsed) {
        const th = themes[t] ?? themes.light;
        ratios[t] = { card: r2(hex, th['--surface']), bg: r2(hex, th['--bg']) };
      }

      let worst = null;
      let worstWhere = null;
      if (fgUses.length) {
        for (const [t, r] of Object.entries(ratios)) {
          for (const [where, v] of Object.entries(r)) {
            if (worst === null || v < worst) {
              worst = v;
              worstWhere = `${t === 'dark' ? '暗色' : '浅色'}/${where === 'card' ? '卡片面' : '页面底'}`;
            }
          }
        }
      }

      return {
        hex,
        uses,
        fgCount: fgUses.length,
        bgCount: uses.filter((u) => u.role === 'bg').length,
        themesUsed,
        ratios,
        worst,
        worstWhere,
        worstVerdict:
          worst === null ? null : worst >= 4.5 ? 'PASS' : worst >= 3.0 ? 'LARGE-ONLY' : 'FAIL',
      };
    })
    .sort((a, b) => b.uses.length - a.uses.length || (a.worst ?? 99) - (b.worst ?? 99));

  /* ---- 同规则块内的真实配对 ----
     硬编码色的对比度拿 --surface 当基准只是估算：它真正的背景往往是
     同一个 { } 里的另一条声明（可能是色值，也可能是 var(--token)）。
     把两端都解析出来，才是这批「临时补丁色」的真实表现。 */
  const resolve = (ref, theme) => {
    if (!ref.startsWith('var:')) return ref;
    const name = ref.slice(4);
    return themes[theme]?.[name] ?? themes.light?.[name] ?? null;
  };

  const seen = new Set();
  const pairs = [];
  for (const block of blocks.values()) {
    for (const f of block.fg) {
      for (const b of block.bg) {
        if (!f.leak && !b.leak) continue; // 全令牌配对已在主表覆盖
        const fg = resolve(f.ref, block.theme);
        const bg = resolve(b.ref, block.theme);
        if (!fg || !bg) continue;
        const key = `${fg}|${bg}|${block.selector}|${block.theme}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ratio = r2(fg, bg);
        pairs.push({
          fg,
          bg,
          fgRef: f.ref,
          bgRef: b.ref,
          ratio,
          theme: block.theme,
          file: block.file,
          line: block.line,
          selector: block.selector,
          verdict: ratio >= 4.5 ? 'PASS' : ratio >= 3.0 ? 'LARGE-ONLY' : 'FAIL',
        });
      }
    }
  }
  pairs.sort((a, b) => a.ratio - b.ratio);

  return { leaks, pairs };
}

/* --------------------------------------------------------------------------
   6. 主流程
   -------------------------------------------------------------------------- */

const tokenCss = readFileSync(join(CSS_DIR, TOKENS_FILE), 'utf8');
const themes = parseTokens(tokenCss);
const tokenValues = new Set([...Object.values(themes.light), ...Object.values(themes.dark)]);

const results = [
  auditTheme('浅色 · 莫兰迪日', themes.light, themes.light),
  auditTheme('暗色 · 莫兰迪夜', themes.dark, themes.light),
];
const allRows = results.flatMap((r) => r.rows.map((x) => ({ theme: r.label, ...x })));
const { leaks, pairs } = scanLeaks(tokenValues, themes);

/* --------------------------------------------------------------------------
   7. 输出
   -------------------------------------------------------------------------- */

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

/** 中文按 2 列宽计算，让表格在终端里对齐 */
function pad(s, n, align = 'left') {
  const width = [...String(s)].reduce(
    (w, ch) => w + (/[\u2e80-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1),
    0
  );
  const gap = Math.max(0, n - width);
  return align === 'left' ? s + ' '.repeat(gap) : ' '.repeat(gap) + s;
}

console.log('');
console.log(C.bold('  PanWatch H5 · 配色对比度审计（WCAG 2.1）'));
console.log(C.dim(`  令牌来源  css/${TOKENS_FILE}`));
console.log(C.dim('  正文 ≥4.5 · 大字/图形文字 ≥3.0 · 非文本 UI ≥3.0 · 装饰豁免'));

for (const { label, rows } of results) {
  console.log('');
  console.log(C.bold(C.cyan(`  ── ${label} ──`)));
  let lastGroup = '';
  for (const r of rows) {
    if (r.group !== lastGroup) {
      console.log('');
      console.log(C.dim(`  ${r.group}`));
      console.log(
        C.dim(`    ${pad('', 24)}${pad('前景', 10)}${pad('背景', 10)}${pad('对比度', 10, 'right')}  ${pad('阈值', 5)}${pad('判定', 8)}大字`)
      );
      lastGroup = r.group;
    }
    const v =
      r.verdict === 'FAIL' ? C.red('✗ FAIL') : r.verdict === 'PASS' ? C.green('✓ PASS') : C.dim('  豁免 ');
    const large = r.kind === 'deco' ? C.dim('  — ') : r.largeOk ? C.green(' ✓') : C.red(' ✗');
    console.log(
      `    ${pad(r.label, 24)}${pad(r.fg, 10)}${pad(r.bg, 10)}` +
        `${pad(r.ratio.toFixed(2) + ':1', 10, 'right')}  ${pad(r.need ? r.need.toFixed(1) : '—', 5)}${v}${large}`
    );
  }
}

const judged = allRows.filter((r) => r.verdict !== 'N/A');
const fails = judged.filter((r) => r.verdict === 'FAIL');
const passes = judged.filter((r) => r.verdict === 'PASS');
const exempt = allRows.filter((r) => r.verdict === 'N/A');

console.log('');
console.log(C.bold('  ── 汇总 ──'));
console.log(`    受判定组合  ${judged.length}    ${C.green('达标 ' + passes.length)}    ${fails.length ? C.red('不达标 ' + fails.length) : C.green('不达标 0')}`);
console.log(`    装饰豁免    ${exempt.length}`);

if (fails.length) {
  console.log('');
  console.log(C.bold(C.red('  不达标明细（差距从大到小）')));
  const sorted = [...fails].sort((a, b) => a.ratio - b.ratio);
  for (const r of sorted) {
    const gap = (r.need - r.ratio).toFixed(2);
    const largeTag = r.largeOk ? C.yellow(' [大字可用]') : C.red(' [大字亦不可用]');
    console.log(
      `    ${pad(r.label, 24)}${C.red(pad(r.ratio.toFixed(2) + ':1', 8))}` +
        `${C.dim('需 ' + r.need.toFixed(1) + '，差 ' + pad(gap, 5))}${largeTag}${C.dim('  ' + r.theme)}`
    );
  }
}

if (leaks.length) {
  console.log('');
  console.log(C.bold(C.yellow('  ── 令牌泄漏（绕过 tokens.css 的硬编码颜色） ──')));
  console.log(
    C.dim(
      `    ${pad('色值', 10)}${pad('次数', 6)}${pad('角色', 10)}${pad('主题', 6)}${pad('卡片面', 9)}${pad('页面底', 9)}判定        首次出现`
    )
  );
  for (const l of leaks) {
    const role =
      l.fgCount && l.bgCount ? '前/背景' : l.fgCount ? '前景' : l.bgCount ? '背景' : '其他';
    const s = l.uses[0];
    const ratioOf = (t) => (l.ratios[t] ? l.ratios[t].card.toFixed(2) + ':1' : '—');
    const bgOf = (t) => (l.ratios[t] ? l.ratios[t].bg.toFixed(2) + ':1' : '—');
    const verdict =
      l.worstVerdict === 'FAIL'
        ? C.red('✗ 不达标')
        : l.worstVerdict === 'LARGE-ONLY'
          ? C.yellow('△ 仅大字')
          : l.worstVerdict === 'PASS'
            ? C.green('✓ 达标')
            : C.dim('—');

    l.themesUsed.forEach((t, idx) => {
      console.log(
        `    ${pad(idx === 0 ? l.hex : '', 10)}${pad(idx === 0 ? '×' + l.uses.length : '', 6)}` +
          `${pad(idx === 0 ? role : '', 10)}${pad(t === 'dark' ? '暗色' : '浅色', 6)}` +
          `${pad(ratioOf(t), 9)}${pad(bgOf(t), 9)}` +
          `${pad('', 0)}${idx === 0 ? verdict : ''}` +
          (idx === 0 ? `    ${C.dim(s.file + ':' + s.line + '  ' + s.prop)}` : '')
      );
    });
  }
  console.log(
    C.dim(
      `    共 ${leaks.length} 个色值、${leaks.reduce((n, l) => n + l.uses.length, 0)} 处使用未纳入令牌体系；` +
        `其中 ${leaks.filter((l) => l.fgCount).length} 个当前景色用`
    )
  );
}

if (pairs.length) {
  console.log('');
  console.log(C.bold(C.yellow('  ── 硬编码色的真实配对（同一规则块内的前景/背景） ──')));
  for (const p of pairs) {
    const v =
      p.verdict === 'FAIL' ? C.red('✗ 不达标') : p.verdict === 'LARGE-ONLY' ? C.yellow('△ 仅大字') : C.green('✓ 达标');
    console.log(
      `    ${pad(p.fg, 10)}${C.dim('on')} ${pad(p.bg, 10)}${pad(p.ratio.toFixed(2) + ':1', 10, 'right')}` +
        `${v}  ${C.dim((p.theme === 'dark' ? '暗色 ' : '浅色 ') + p.selector + '  ' + p.file + ':' + p.line)}`
    );
  }
}

console.log('');

/* ---- 可选产物 ---- */
const args = process.argv.slice(2);
const outDir = join(ROOT, 'docs');
if ((args.includes('--json') || args.includes('--md')) && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });

if (args.includes('--json')) {
  writeFileSync(
    join(outDir, 'contrast-audit.json'),
    JSON.stringify(
      {
        generatedFrom: `css/${TOKENS_FILE}`,
        standard: 'WCAG 2.1',
        thresholds: { body: 4.5, large: 3.0, ui: 3.0 },
        summary: {
          judged: judged.length,
          pass: passes.length,
          fail: fails.length,
          exempt: exempt.length,
          leaks: leaks.length,
          leakUses: leaks.reduce((n, l) => n + l.uses.length, 0),
        },
        rows: allRows,
        leaks,
      },
      null,
      2
    ),
    'utf8'
  );
  console.log(C.dim('  → docs/contrast-audit.json'));
}

if (args.includes('--md')) {
  const L = [
    '# PanWatch H5 · 配色对比度审计（WCAG 2.1）',
    '',
    '> 由 `scripts/audit-contrast.mjs` 从 `css/tokens.css` 自动生成，请勿手工编辑。',
    '',
    '阈值：正文 ≥4.5:1 · 大字/图形化文字 ≥3.0:1 · 非文本 UI ≥3.0:1 · 装饰性元素豁免（SC 1.4.11）',
    '',
    `**受判定 ${judged.length} 组：达标 ${passes.length}，不达标 ${fails.length}**；另 ${exempt.length} 组装饰性组合豁免。`,
    '',
  ];
  for (const { label, rows } of results) {
    L.push(`## ${label}`, '', '| 分组 | 组合 | 前景 | 背景 | 对比度 | 阈值 | 判定 | 大字 |', '| --- | --- | --- | --- | ---: | ---: | :--: | :--: |');
    for (const r of rows) {
      const v = r.verdict === 'FAIL' ? '❌' : r.verdict === 'PASS' ? '✅' : '—';
      const lg = r.kind === 'deco' ? '—' : r.largeOk ? '✅' : '❌';
      L.push(
        `| ${r.group} | ${r.label} | \`${r.fg}\` | \`${r.bg}\` | ${r.ratio.toFixed(2)}:1 | ` +
          `${r.need ? r.need.toFixed(1) : '—'} | ${v} | ${lg} |`
      );
    }
    L.push('');
  }
  L.push('## 令牌泄漏', '', '以下颜色出现在 `css/` 的其他文件中，但未纳入 `tokens.css` 令牌体系：', '');
  L.push('| 色值 | 次数 | 角色 | 主题 | 卡片面 | 页面底 | 判定 | 首次出现 |', '| --- | ---: | --- | --- | ---: | ---: | :--: | --- |');
  for (const l of leaks) {
    const role = l.fgCount && l.bgCount ? '前景+背景' : l.fgCount ? '前景' : l.bgCount ? '背景' : '其他';
    const v =
      l.worstVerdict === 'FAIL' ? '❌' : l.worstVerdict === 'LARGE-ONLY' ? '⚠️ 仅大字' : l.worstVerdict === 'PASS' ? '✅' : '—';
    const s = l.uses[0];
    l.themesUsed.forEach((t, idx) => {
      const r = l.ratios[t];
      L.push(
        `| ${idx === 0 ? '`' + l.hex + '`' : ''} | ${idx === 0 ? l.uses.length : ''} | ` +
          `${idx === 0 ? role : ''} | ${t === 'dark' ? '暗色' : '浅色'} | ` +
          `${r ? r.card.toFixed(2) + ':1' : '—'} | ${r ? r.bg.toFixed(2) + ':1' : '—'} | ` +
          `${idx === 0 ? v : ''} | ${idx === 0 ? '`' + s.file + ':' + s.line + '` (' + s.prop + ')' : ''} |`
      );
    });
  }
  L.push('');
  writeFileSync(join(outDir, 'contrast-audit.md'), L.join('\n'), 'utf8');
  console.log(C.dim('  → docs/contrast-audit.md'));
}

process.exit(fails.length ? 1 : 0);
