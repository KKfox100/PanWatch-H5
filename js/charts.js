/* ==========================================================================
   图表：全部手写 SVG，零依赖
   --------------------------------------------------------------------------
   配色一律走 CSS 变量，这样切主题时图表自动跟随，不用重绘。
   ========================================================================== */

/** 把数值序列映射成 SVG 路径点 */
function toPoints(values, w, h, pad = 2) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  return values.map((v, i) => [
    pad + i * stepX,
    pad + (h - pad * 2) * (1 - (v - min) / span),
  ]);
}

function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx.toFixed(2)},${y0.toFixed(2)} ${cx.toFixed(2)},${y1.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  return d;
}

function linePath(pts) {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

/* --------------------------------------------------------------------------
   迷你走势图（列表 / 卡片内）
   -------------------------------------------------------------------------- */

/**
 * @param {number[]} values 序列
 * @param {object} opts { w, h, up, fill, color }
 *   color 显式指定时优先于 up —— 用于「市值」这类本身没有涨跌语义的指标，
 *   否则一条随机下行的装饰性曲线会和卡片的红色盈利数字自相矛盾。
 */
export function sparkline(values, opts = {}) {
  const { w = 100, h = 26, up = true, fill = true, color: forceColor } = opts;
  if (!values || values.length < 2) return '';
  const pts = toPoints(values, w, h, 1.5);
  const d = smoothPath(pts);
  const color = forceColor || (up ? 'var(--up)' : 'var(--down)');
  const gid = `sg${Math.random().toString(36).slice(2, 8)}`;
  const last = pts[pts.length - 1];

  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"
      style="height:${h}px" aria-hidden="true">
    ${fill ? `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>` : ''}
    ${fill ? `<path d="${d} L${w - 1.5},${h} L1.5,${h} Z" fill="url(#${gid})"/>` : ''}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${last[0].toFixed(2)}" cy="${last[1].toFixed(2)}" r="1.9" fill="${color}"/>
  </svg>`;
}

/* --------------------------------------------------------------------------
   面积折线图（净值曲线 / 大盘走势）
   支持双序列（策略 vs 基准）
   -------------------------------------------------------------------------- */

/**
 * @param {Array<{nav:number,benchmark?:number}>} data
 * @param {object} opts { w, h, showGrid, showAxis, labelFmt }
 */
export function areaChart(data, opts = {}) {
  const { w = 320, h = 140, showGrid = true, showAxis = true } = opts;
  if (!data || data.length < 2) return '';

  const padL = showAxis ? 34 : 2;
  const padR = 4;
  const padT = 8;
  const padB = showAxis ? 18 : 4;

  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const navVals = data.map((d) => d.nav);
  const bmVals = data.filter((d) => d.benchmark != null).map((d) => d.benchmark);
  const all = bmVals.length ? navVals.concat(bmVals) : navVals;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  // 上下各留 8% 余量
  const lo = min - span * 0.08;
  const hi = max + span * 0.08;

  const x = (i) => padL + (innerW * i) / (data.length - 1);
  const y = (v) => padT + innerH * (1 - (v - lo) / (hi - lo));

  const navPts = data.map((d, i) => [x(i), y(d.nav)]);
  const bmPts = bmVals.length ? data.map((d, i) => [x(i), y(d.benchmark)]) : [];

  const up = navVals[navVals.length - 1] >= navVals[0];
  const color = up ? 'var(--up)' : 'var(--down)';
  const gid = `ag${Math.random().toString(36).slice(2, 8)}`;

  // 网格 + Y 轴刻度
  let grid = '';
  if (showGrid) {
    for (let i = 0; i <= 3; i++) {
      const gy = padT + (innerH * i) / 3;
      const gv = hi - ((hi - lo) * i) / 3;
      grid += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${w - padR}" y2="${gy.toFixed(1)}"
        stroke="var(--line-soft)" stroke-width="1" stroke-dasharray="2 3"/>`;
      if (showAxis) {
        grid += `<text x="${padL - 6}" y="${(gy + 3.4).toFixed(1)}" text-anchor="end"
          font-size="9" fill="var(--ink-3)" font-family="var(--font-num)">${gv.toFixed(3)}</text>`;
      }
    }
  }

  const lastNav = navPts[navPts.length - 1];

  return `<svg class="chart" viewBox="0 0 ${w} ${h}" style="height:${h}px" role="img">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.26"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}
    ${bmPts.length ? `<path d="${smoothPath(bmPts)}" fill="none" stroke="var(--ink-3)"
      stroke-width="1.2" stroke-dasharray="4 3" stroke-linecap="round" opacity="0.75"/>` : ''}
    <path d="${smoothPath(navPts)} L${(w - padR).toFixed(1)},${(h - padB).toFixed(1)} L${padL},${(h - padB).toFixed(1)} Z"
      fill="url(#${gid})"/>
    <path d="${smoothPath(navPts)}" fill="none" stroke="${color}" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}"
      stroke="var(--line)" stroke-width="1"/>
    <circle cx="${lastNav[0].toFixed(1)}" cy="${lastNav[1].toFixed(1)}" r="3"
      fill="${color}" stroke="var(--surface)" stroke-width="1.5"/>
  </svg>`;
}

/* --------------------------------------------------------------------------
   K 线图（含均线）
   -------------------------------------------------------------------------- */

export function klineChart(bars, opts = {}) {
  const { w = 320, h = 160, ma = [5, 10, 20] } = opts;
  if (!bars || bars.length < 2) return '';

  const padL = 34, padR = 4, padT = 8, padB = 18;
  const volH = 30;                        // 成交量高度
  const priceH = h - padT - padB - volH - 6;
  const innerW = w - padL - padR;

  const lows = bars.map((b) => b.l);
  const highs = bars.map((b) => b.h);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const span = max - min || 1;
  const lo = min - span * 0.06;
  const hi = max + span * 0.06;

  const slot = innerW / bars.length;
  const bw = Math.max(1.6, slot * 0.62);
  const x = (i) => padL + slot * i + slot / 2;
  const y = (v) => padT + priceH * (1 - (v - lo) / (hi - lo));

  // 均线
  const maPath = (n) => {
    const pts = [];
    for (let i = n - 1; i < bars.length; i++) {
      const slice = bars.slice(i - n + 1, i + 1);
      pts.push([x(i), y(slice.reduce((a, b) => a + b.c, 0) / n)]);
    }
    return pts.length > 1 ? linePath(pts) : '';
  };
  const maColors = ['var(--accent)', 'var(--warn)', 'var(--morandi-lilac)'];

  // 成交量
  const vols = bars.map((b) => Math.abs(b.c - b.o) / (b.c || 1));
  const vMax = Math.max(...vols) || 1;
  let volBars = '';
  bars.forEach((b, i) => {
    const vh = Math.max(1, (vols[i] / vMax) * (volH - 4));
    const up = b.c >= b.o;
    volBars += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(h - padB - vh).toFixed(1)}"
      width="${bw.toFixed(1)}" height="${vh.toFixed(1)}" rx="0.6"
      fill="${up ? 'var(--up)' : 'var(--down)'}" opacity="0.34"/>`;
  });

  // 蜡烛
  let candles = '';
  bars.forEach((b, i) => {
    const up = b.c >= b.o;
    const color = up ? 'var(--up)' : 'var(--down)';
    const yo = y(b.o), yc = y(b.c);
    const top = Math.min(yo, yc);
    const bh = Math.max(1, Math.abs(yc - yo));
    candles += `<line x1="${x(i).toFixed(1)}" y1="${y(b.h).toFixed(1)}" x2="${x(i).toFixed(1)}"
      y2="${y(b.l).toFixed(1)}" stroke="${color}" stroke-width="1" opacity="0.85"/>`;
    candles += `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${top.toFixed(1)}"
      width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="0.6"
      fill="${up ? 'var(--up)' : 'var(--down)'}"/>`;
  });

  // Y 轴刻度
  let axis = '';
  for (let i = 0; i <= 2; i++) {
    const gy = padT + (priceH * i) / 2;
    const gv = hi - ((hi - lo) * i) / 2;
    axis += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${w - padR}" y2="${gy.toFixed(1)}"
      stroke="var(--line-soft)" stroke-width="1" stroke-dasharray="2 3"/>`;
    axis += `<text x="${padL - 6}" y="${(gy + 3.4).toFixed(1)}" text-anchor="end"
      font-size="9" fill="var(--ink-3)" font-family="var(--font-num)">${gv.toFixed(gv > 100 ? 0 : 2)}</text>`;
  }

  return `<svg class="chart" viewBox="0 0 ${w} ${h}" style="height:${h}px" role="img">
    ${axis}
    ${ma.map((n, i) => {
      const d = maPath(n);
      return d ? `<path d="${d}" fill="none" stroke="${maColors[i]}" stroke-width="1.1"
        stroke-linecap="round" opacity="0.9"/>` : '';
    }).join('')}
    ${candles}
    ${volBars}
    <line x1="${padL}" y1="${h - padB}" x2="${w - padR}" y2="${h - padB}"
      stroke="var(--line)" stroke-width="1"/>
  </svg>`;
}

/* --------------------------------------------------------------------------
   环形图（资产分布）
   -------------------------------------------------------------------------- */

const DONUT_COLORS = [
  'var(--accent)', 'var(--accent-2)', 'var(--morandi-clay)',
  'var(--morandi-lilac)', 'var(--morandi-sand)', 'var(--morandi-teal)',
];

/**
 * @param {Array<{label:string,pct:number,value:number}>} items
 */
export function donut(items, opts = {}) {
  const { size = 116, thickness = 15 } = opts;
  const total = items.reduce((s, i) => s + i.pct, 0) || 1;
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const C = 2 * Math.PI * r;

  let offset = 0;
  const arcs = items.map((it, i) => {
    const frac = it.pct / total;
    const len = C * frac;
    const el = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
      stroke="${DONUT_COLORS[i % DONUT_COLORS.length]}" stroke-width="${thickness}"
      stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${cx} ${cy})" stroke-linecap="butt"/>`;
    offset += len;
    return el;
  }).join('');

  return `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px;flex:none" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="${thickness}"/>
    ${arcs}
  </svg>`;
}

export { DONUT_COLORS };

/* --------------------------------------------------------------------------
   横向条形（板块 / 行业分布）
   -------------------------------------------------------------------------- */

export function hbars(items, opts = {}) {
  const { max } = opts;
  const top = max ?? Math.max(...items.map((i) => Math.abs(i.value))) ?? 1;
  return items.map((it, i) => {
    const w = (Math.abs(it.value) / top) * 100;
    const color = it.value >= 0 ? 'var(--up)' : 'var(--down)';
    return `<div class="meter" style="margin-bottom:9px">
      <span class="meter__label" style="width:74px">${it.label}</span>
      <span class="bar"><span class="bar__fill" style="width:${w.toFixed(1)}%;background:${color}"></span></span>
      <span class="meter__val" style="width:62px">${it.text}</span>
    </div>`;
  }).join('');
}
