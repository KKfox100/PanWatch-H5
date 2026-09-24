#!/usr/bin/env node
/* ==========================================================================
   solve-tokens.mjs · 按目标对比度反解颜色
   --------------------------------------------------------------------------
   手工调色的问题：目测「够深了」通常在 3:1 左右停下，而正文要 4.5:1。
   差的那 1.5 靠眼睛判断不出来，只有算出来才知道。

   这个脚本做一件事：给定一个莫兰迪色相 + 彩度，在 OKLCH 空间里
   二分搜索明度，使该颜色对指定背景的 WCAG 对比度刚好达到目标值。

   为什么取「刚好达标的最浅值」：
     达标只规定了上限，没规定下限。在满足 4.5:1 的前提下取最浅的那个解，
     就能最大限度保留莫兰迪的低对比柔感 —— 而不是为了合规把颜色压成一团黑。
     这是审美与可访问性唯一的双赢点。

   为什么用 OKLCH 而不是 HSL：
     HSL 的 L 是「混入白/黑的比例」，不同色相下同样的 L 视觉明度差别很大，
     调出来的灰阶会一段发蓝一段发黄。OKLab 是感知均匀空间，
     固定色相与彩度后只动 L，得到的序列灰阶均匀、色相稳定。

   用法：
     node scripts/solve-tokens.mjs            # 输出候选色板表
     node scripts/solve-tokens.mjs --css      # 输出可直接粘进 tokens.css 的片段
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. sRGB ↔ OKLab / OKLCH
   -------------------------------------------------------------------------- */

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function hexToLinearRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
}

function linearRgbToHex([r, g, b]) {
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.round(clamp01(linearToSrgb(clamp01(c))) * 255).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** 线性 sRGB → OKLab（Björn Ottosson 的矩阵） */
function linearRgbToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → 线性 sRGB */
function oklabToLinearRgb([L, a, b]) {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH → 线性 sRGB；越界（出 sRGB 色域）返回 null */
function oklchToLinearRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const rgb = oklabToLinearRgb([L, C * Math.cos(h), C * Math.sin(h)]);
  if (rgb.some((c) => c < -0.0005 || c > 1.0005)) return null;
  return rgb.map(clamp01);
}

const linearRgbToOklch = (rgb) => {
  const [L, a, b] = linearRgbToOklab(rgb);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, Math.hypot(a, b), h];
};

/* --------------------------------------------------------------------------
   2. WCAG 对比度
   -------------------------------------------------------------------------- */

const luminanceOfLinear = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const contrastLinear = (la, lb) => {
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

const contrastHex = (a, b) =>
  contrastLinear(luminanceOfLinear(hexToLinearRgb(a)), luminanceOfLinear(hexToLinearRgb(b)));

/* --------------------------------------------------------------------------
   3. 反解：固定色相与彩度，二分搜索 OKLCH 明度
   --------------------------------------------------------------------------
   在浅背景上要深色前景 → 取「刚好达标的最浅解」（尽量柔和）
   在深背景上要浅色前景 → 取「刚好达标的最深解」（避免刺眼）
   两者都是「贴着达标线站」，只是方向相反。
   -------------------------------------------------------------------------- */

function solve(hue, chroma, bgHex, target, { direction = 'auto' } = {}) {
  const bgLum = luminanceOfLinear(hexToLinearRgb(bgHex));
  const dir =
    direction === 'auto' ? (bgLum > 0.18 ? 'darker' : 'lighter') : direction;

  // 目标：找到一个 L，使 contrast(bg, fg(L)) 尽可能贴近 target，
  // 且不越过达标线。contrast 对 L 单调，直接二分。
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    const rgb = oklchToLinearRgb(mid, chroma, hue);
    if (!rgb) {
      // 出色域：往明度低处退（彩度高时只有中低明度能落在 sRGB 内）
      hi = mid;
      continue;
    }
    const ratio = contrastLinear(bgLum, luminanceOfLinear(rgb));
    // 浅背景：L 越大对比越低。要「刚好达标的最浅」→ 对比刚好等于 target 时收手
    if (dir === 'darker') {
      if (ratio > target) lo = mid;
      else hi = mid;
    } else {
      if (ratio > target) hi = mid;
      else lo = mid;
    }
  }
  const L = (lo + hi) / 2;
  const rgb = oklchToLinearRgb(L, chroma, hue) ?? oklchToLinearRgb(L, chroma * 0.5, hue);
  const hex = linearRgbToHex(rgb);
  return { hex, L, C: chroma, h: hue, ratio: contrastHex(hex, bgHex), bgHex, target };
}

/* --------------------------------------------------------------------------
   4. 色板规格
   --------------------------------------------------------------------------
   色相取自莫兰迪静物画：暖灰 75°、雾霾蓝 245°、鼠尾草 145°、
   陶土 35°、琥珀 70°、灰紫 305°、灰青 195°。
   彩度压得很低（0.01–0.06），这是莫兰迪「掺了灰」的本质。
   -------------------------------------------------------------------------- */

const HUE = {
  neutral: 75, // 暖灰 —— 文字与中性面
  blue: 245, // 雾霾蓝 —— 主强调
  sage: 145, // 鼠尾草绿 —— 次强调
  clay: 35, // 陶土红 —— 涨 / 危险
  amber: 70, // 琥珀 —— 警示
  lilac: 305, // 灰紫
  teal: 195, // 灰青
};

// 浅色主题的中性面。命名按「空间角色」而非编号 ——
// 数字编号看不出该用哪一个，角色名一眼就知道。
const LIGHT = {
  bg: '#efece6', // 页面底
  surface: '#f7f4f0', // 卡片面（比页面亮）
  'surface-raised': '#fdfcfa', // 浮层 / 弹层（再亮一档）
  'surface-sunken': '#ece7df', // 卡内嵌入块（比卡片暗）
  'surface-well': '#ddd6ca', // 进度槽 / 最深嵌入
  line: '#ded7cc',
  'line-soft': '#eae5dd',
  'line-strong': '#c9c0b1',
};

const DARK = {
  bg: '#232120',
  surface: '#2a2726',
  'surface-raised': '#332f2e',
  'surface-sunken': '#1e1c1b',
  'surface-well': '#191817',
  line: '#3b3735',
  'line-soft': '#332f2e',
  'line-strong': '#5a534d',
};

/**
 * 文字解算的基准面 —— 取「最不利的那个面」。
 *
 *   浅色主题：面越暗，深色文字越吃亏 → 最不利是 surface-sunken
 *   暗色主题：面越亮，浅色文字越吃亏 → 最不利是 surface-raised
 *
 * 按最不利面解，得到的是一个**强保证**：任何一层文字放到任何一层
 * 中性面上都达标。比「恰好压在卡片面上够用」稳得多 ——
 * 后者只要有人把标签挪进嵌入块就破了。
 */
const TEXT_BASE = {
  light: LIGHT['surface-sunken'],
  dark: DARK['surface-raised'],
};

/**
 * 文字层级的目标对比度。
 * 基准面用 --surface-2（实际承载文字的最深中性面）。
 * 设计约束：--surface-3 / --surface-4 是纯容器（进度槽、内嵌块），不放文字。
 * 把这条约束写死，比假装「文字可以放任何地方」更诚实，也更容易守。
 */
const TEXT_TARGETS = [
  { name: 'ink', target: 10.5, chroma: 0.012, note: '主文字' },
  { name: 'ink-2', target: 6.6, chroma: 0.013, note: '次文字' },
  { name: 'ink-3', target: 4.6, chroma: 0.014, note: '三级文字 / 占位' },
];

/**
 * 描边里唯一需要达标的那个：交互控件边框。
 *
 * 分隔线是装饰性的，WCAG 1.4.11 明确豁免 —— 所以 --line / --line-soft
 * 刻意做得很淡（1.1–1.3:1），它们只负责「分组」，不承载信息。
 * 但输入框、开关、可点区域的边框承载着「这里可以操作」的信息，
 * 属于非文本 UI 组件，要 ≥3:1。这两件事必须分开，不能共用一个值。
 *
 * 最不利基准面的取法（这里容易想反）：
 *   contrast = (亮者+0.05) / (暗者+0.05)，所以拉低对比的是**与前景同向**的那一端。
 *   浅色主题描边比面暗 → 面越暗，对比越低 → 最不利是最暗的 --surface-sunken
 *   暗色主题描边比面亮 → 面越亮，对比越低 → 最不利是最亮的 --surface-raised
 * 直觉上会去拿最亮的面算浅色主题，那是反的：拿最亮面算出来的值
 * 放到页面上只有 2.65:1。
 */
const STROKE_TARGETS = [
  { name: 'line-strong', target: 3.05, chroma: 0.012, note: '交互控件描边' },
];

/** 语义色：每个色相要三个角色 —— 填充底、文字色、浅底胶囊 */
const SEMANTIC_SPECS = [
  { key: 'accent', hue: HUE.blue, chroma: 0.038, soft: '#e2e8ec', label: '主强调 · 雾霾蓝' },
  { key: 'sage', hue: HUE.sage, chroma: 0.036, soft: '#e4eae1', label: '次强调 · 鼠尾草' },
  { key: 'up', hue: HUE.clay, chroma: 0.062, soft: '#f2e3df', label: '涨 / 危险 · 陶土红' },
  { key: 'down', hue: HUE.teal, chroma: 0.040, soft: '#e1e8e4', label: '跌 / 成功 · 灰绿', hueOverride: 160 },
  { key: 'warn', hue: HUE.amber, chroma: 0.062, soft: '#f4e9d9', label: '警示 · 琥珀' },
  { key: 'lilac', hue: HUE.lilac, chroma: 0.032, soft: '#eae5ee', label: '灰紫' },
];

/**
 * 暗色主题的胶囊底。
 * 不能用浅色那套 —— 背景色本身也要跟着主题翻转，
 * 否则「暗色下的浅底」会变成一个刺眼的亮块。
 * 保持同样的色相，只把明度压到深色区，并保留极低彩度。
 */
const DARK_SOFT = {
  accent: '#313a42',
  sage: '#333a32',
  up: '#44302c',
  down: '#2b3930',
  warn: '#3f3529',
  lilac: '#38333c',
};

/** 反白文字：浅色主题用近白，暗色主题用近黑（取 --ink-inverse 的实际值） */
const INVERSE = { light: '#fbf9f6', dark: '#232120' };

/* --------------------------------------------------------------------------
   5. 生成
   -------------------------------------------------------------------------- */

const solved = { light: {}, dark: {} };

for (const t of TEXT_TARGETS) {
  solved.light[t.name] = solve(HUE.neutral, t.chroma, TEXT_BASE.light, t.target);
  solved.dark[t.name] = solve(HUE.neutral, t.chroma, TEXT_BASE.dark, t.target);
}

for (const s of STROKE_TARGETS) {
  // 浅色：描边比面暗，最不利是最暗的面
  solved.light[s.name] = solve(HUE.neutral, s.chroma, LIGHT['surface-sunken'], s.target);
  // 暗色：描边比面亮，最不利是最亮的面
  solved.dark[s.name] = solve(HUE.neutral, s.chroma, DARK['surface-raised'], s.target, {
    direction: 'lighter',
  });
}

for (const s of SEMANTIC_SPECS) {
  const hue = s.hueOverride ?? s.hue;
  solved.light[s.key] = {
    // 填充底：要能压住反白文字（浅色主题下按钮文字是近白）
    fill: solve(hue, s.chroma, INVERSE.light, 4.6, { direction: 'darker' }),
    // 文字色：压在卡片面上要达标
    text: solve(hue, s.chroma, TEXT_BASE.light, 4.6),
    // 胶囊文字：压在自家浅底上要达标
    onSoft: solve(hue, s.chroma, s.soft, 4.6),
  };
  solved.dark[s.key] = {
    // 暗色下反白文字是近黑，所以填充底要往「亮」的方向解
    fill: solve(hue, s.chroma * 0.85, INVERSE.dark, 4.6, { direction: 'lighter' }),
    text: solve(hue, s.chroma * 0.85, TEXT_BASE.dark, 4.6, { direction: 'lighter' }),
    onSoft: solve(hue, s.chroma * 0.85, DARK_SOFT[s.key], 4.6, { direction: 'lighter' }),
  };
}

/* --------------------------------------------------------------------------
   6. 输出
   -------------------------------------------------------------------------- */

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

const pad = (s, n, align = 'left') => {
  const w = [...String(s)].reduce((a, c) => a + (/[\u2e80-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1), 0);
  const gap = Math.max(0, n - w);
  return align === 'left' ? s + ' '.repeat(gap) : ' '.repeat(gap) + s;
};

const args = process.argv.slice(2);

if (args.includes('--css')) {
  /* 直接产出可粘贴的片段 */
  const out = [];
  const fmt = (v) => v.hex.padEnd(9) + `/* ${v.ratio.toFixed(2)}:1 */`;
  out.push('/* ---- 文字层级（基准面 --surface-2，目标见注释） ---- */');
  for (const t of TEXT_TARGETS) {
    out.push(
      `  --${t.name}:`.padEnd(22) +
        `${solved.light[t.name].hex};`.padEnd(12) +
        `/* ${t.note} · 目标 ${t.target}:1，实测 ${solved.light[t.name].ratio.toFixed(2)}:1 */`
    );
  }
  out.push('');
  out.push('/* ---- 语义色：填充底 / 文字色 / 胶囊文字 ---- */');
  for (const s of SEMANTIC_SPECS) {
    const L = solved.light[s.key];
    out.push(`  /* ${s.label} */`);
    out.push(`  --${s.key}-fill:`.padEnd(22) + `${L.fill.hex};`.padEnd(12) + `/* 白字压其上 ${contrastHex('#ffffff', L.fill.hex).toFixed(2)}:1 */`);
    out.push(`  --${s.key}-text:`.padEnd(22) + `${L.text.hex};`.padEnd(12) + `/* 卡片面上 ${L.text.ratio.toFixed(2)}:1 */`);
    out.push(`  --${s.key}-on-soft:`.padEnd(22) + `${L.onSoft.hex};`.padEnd(12) + `/* 自家浅底上 ${L.onSoft.ratio.toFixed(2)}:1 */`);
    out.push(`  --${s.key}-soft:`.padEnd(22) + `${s.soft};`.padEnd(12) + `/* 胶囊底 */`);
    out.push('');
  }
  console.log(out.join('\n'));
} else {
  console.log('');
  console.log(C.bold('  PanWatch H5 · 令牌反解结果'));
  console.log(C.dim('  固定色相与彩度，二分搜索 OKLCH 明度，取「刚好达标的最浅/最深解」'));
  console.log(C.dim('  基准面：浅色 --surface-2 = ' + TEXT_BASE.light + ' ｜ 暗色 = ' + TEXT_BASE.dark));

  for (const themeName of ['light', 'dark']) {
    console.log('');
    console.log(C.bold(C.cyan(`  ── ${themeName === 'light' ? '浅色 · 莫兰迪日' : '暗色 · 莫兰迪夜'} ──`)));
    console.log(C.dim(`    ${pad('令牌', 22)}${pad('色值', 11)}${pad('OKLCH L', 10)}${pad('对比度', 10)}目标`));
    for (const t of TEXT_TARGETS) {
      const v = solved[themeName][t.name];
      console.log(
        `    ${pad('--' + t.name, 22)}${pad(v.hex, 11)}${pad(v.L.toFixed(3), 10)}` +
          `${pad(v.ratio.toFixed(2) + ':1', 10)}${v.target}`
      );
    }
    for (const s of STROKE_TARGETS) {
      const v = solved[themeName][s.name];
      console.log(
        `    ${pad('--' + s.name, 22)}${pad(v.hex, 11)}${pad(v.L.toFixed(3), 10)}` +
          `${pad(v.ratio.toFixed(2) + ':1', 10)}${s.target}`
      );
    }
    for (const s of SEMANTIC_SPECS) {
      const v = solved[themeName][s.key];
      const rows = [
        [`--${s.key}-fill`, v.fill],
        [`--${s.key}-text`, v.text],
        [`--${s.key}-on-soft`, v.onSoft],
      ];
      for (const [n, r] of rows) {
        console.log(
          `    ${pad(n, 22)}${pad(r.hex, 11)}${pad(r.L.toFixed(3), 10)}${pad(r.ratio.toFixed(2) + ':1', 10)}4.6`
        );
      }
    }
  }
  console.log('');
}
