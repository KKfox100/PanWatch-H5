/* ==========================================================================
   演示数据
   --------------------------------------------------------------------------
   说明：这里只声明「原始事实」（成本、持仓、现价、昨收），
   所有派生指标（市值 / 盈亏 / 涨跌幅 / 今日盈亏）一律在 enrich() 里算出来。
   这样任何数字改动都不会出现前后矛盾 —— 演示数据的可信度全靠这一点。

   汇率固定为演示值，不联网。
   ========================================================================== */

import { series, klines } from './utils.js';
import { toSymbol } from './symbols.js';

export const FX = { CNY: 1, USD: 7.24, HKD: 0.925 };

/** 市场元信息 */
export const MARKETS = {
  cn: { label: 'A股', short: 'A', cls: 'mkt--cn', currency: 'CNY', unit: '元' },
  hk: { label: '港股', short: 'HK', cls: 'mkt--hk', currency: 'HKD', unit: '港元' },
  us: { label: '美股', short: 'US', cls: 'mkt--us', currency: 'USD', unit: '美元' },
};

export const STYLES = ['短线', '波段', '长线'];

/* --------------------------------------------------------------------------
   持仓原始数据
   -------------------------------------------------------------------------- */

// 用 let：接上后端之后，持仓与自选整份由 D1 提供（applyUserData 会替换它）
let RAW_ACCOUNTS = [
  {
    id: 'zhaoshang',
    name: '招商证券',
    cash: 1_800_000,
    positions: [
      { code: '300418', name: '昆仑万维', market: 'cn', cost: 90.00, shares: 2000, price: 43.00, prev: 38.75, style: '波段', aiScore: 62, aiAction: '持有', tags: ['AI应用', '短剧'], agent: 'TradingAgents 深度 · 08-21 21:08', stale: true, alert: '跌破 40.00 提醒' },
      { code: '601238', name: '广汽集团', market: 'cn', cost: 8.22, shares: 465000, price: 5.53, prev: 5.714, style: '长线', aiScore: 41, aiAction: '减仓', tags: ['汽车整车', '破净'], agent: '成本待复核 · 08-20 09:15', stale: true, alert: '涨回 6.00 提醒' },
      { code: '688256', name: '寒武纪-U', market: 'cn', cost: 1060.00, shares: 1000, price: 1587.46, prev: 1389.11, style: '短线', aiScore: 88, aiAction: '加仓', tags: ['国产算力', '科创板'], agent: 'TradingAgents 深度 · 08-21 20:35', stale: true, alert: '回撤 8% 提醒' },
      { code: '002230', name: '科大讯飞', market: 'cn', cost: 48.60, shares: 30000, price: 55.42, prev: 53.80, style: '波段', aiScore: 74, aiAction: '持有', tags: ['大模型', '教育'], agent: '盘前分析 · 今日 09:02' },
      { code: '601127', name: '赛力斯', market: 'cn', cost: 82.60, shares: 2500, price: 64.81, prev: 66.68, style: '波段', aiScore: 55, aiAction: '持有', tags: ['华为链', '新能源车'], agent: '盘前分析 · 今日 09:02' },
      { code: 'NVDA', name: '英伟达', market: 'us', cost: 189.00, shares: 2000, price: 219.69, prev: 213.40, style: '长线', aiScore: 91, aiAction: '加仓', tags: ['AI芯片', '算力'], agent: '隔夜美股复盘 · 今日 08:20' },
      { code: 'MSFT', name: '微软', market: 'us', cost: 350.96, shares: 200, price: 379.48, prev: 373.20, style: '长线', aiScore: 79, aiAction: '持有', tags: ['云计算', 'Copilot'], agent: '隔夜美股复盘 · 今日 08:20' },
      { code: 'AAPL', name: '苹果', market: 'us', cost: 210.50, shares: 800, price: 228.36, prev: 226.10, style: '长线', aiScore: 68, aiAction: '持有', tags: ['消费电子'], agent: '隔夜美股复盘 · 今日 08:20' },
    ],
  },
  {
    id: 'dongfang',
    name: '东方证券',
    cash: 500_000,
    positions: [
      { code: '002594', name: '比亚迪', market: 'cn', cost: 268.40, shares: 1200, price: 291.75, prev: 288.10, style: '波段', aiScore: 76, aiAction: '持有', tags: ['新能源车', '出海'], agent: '盘前分析 · 今日 09:02' },
      { code: '600519', name: '贵州茅台', market: 'cn', cost: 1580.00, shares: 200, price: 1468.20, prev: 1475.60, style: '长线', aiScore: 58, aiAction: '观察', tags: ['白酒', '高股息'], agent: '盘前分析 · 今日 09:02' },
      { code: '600036', name: '招商银行', market: 'cn', cost: 36.20, shares: 8000, price: 42.85, prev: 42.50, style: '长线', aiScore: 71, aiAction: '持有', tags: ['银行', '高股息'], agent: '盘前分析 · 今日 09:02' },
      { code: '00700', name: '腾讯控股', market: 'hk', cost: 385.00, shares: 600, price: 452.60, prev: 445.20, style: '长线', aiScore: 85, aiAction: '加仓', tags: ['互联网', '游戏'], agent: '港股复盘 · 今日 16:35' },
      { code: '09988', name: '阿里巴巴-W', market: 'hk', cost: 105.00, shares: 3000, price: 118.40, prev: 116.20, style: '波段', aiScore: 80, aiAction: '持有', tags: ['电商', '云'], agent: '港股复盘 · 今日 16:35' },
    ],
  },
];

/* --------------------------------------------------------------------------
   关注列表（未持仓）
   -------------------------------------------------------------------------- */

let RAW_WATCHLIST = [
  { code: '600030', name: '中信证券', market: 'cn', price: 28.64, prev: 27.90, aiScore: 72, note: '券商板块放量' },
  { code: '300750', name: '宁德时代', market: 'cn', price: 268.30, prev: 272.15, aiScore: 69, note: '储能招标超预期' },
  { code: '601899', name: '紫金矿业', market: 'cn', price: 19.82, prev: 19.24, aiScore: 81, note: '金价创新高' },
  { code: '688111', name: '金山办公', market: 'cn', price: 312.50, prev: 305.20, aiScore: 77, note: 'AI 订阅放量' },
  { code: '00981', name: '中芯国际', market: 'hk', price: 52.85, prev: 51.30, aiScore: 83, note: '先进制程扩产' },
  { code: '03690', name: '美团-W', market: 'hk', price: 128.60, prev: 131.40, aiScore: 64, note: '外卖补贴战' },
  { code: 'TSLA', name: '特斯拉', market: 'us', price: 342.18, prev: 336.90, aiScore: 66, note: 'FSD 入华预期' },
  { code: 'AMD', name: 'AMD', market: 'us', price: 186.42, prev: 181.05, aiScore: 78, note: 'MI400 出货' },
  { code: 'GOOGL', name: '谷歌', market: 'us', price: 214.75, prev: 212.30, aiScore: 74, note: 'Gemini 3 发布' },
  { code: '600887', name: '伊利股份', market: 'cn', price: 27.36, prev: 27.88, aiScore: 52, note: '原奶价格下行' },
];

/* --------------------------------------------------------------------------
   机会页 · AI 评分选股
   -------------------------------------------------------------------------- */

export const OPPORTUNITIES = [
  {
    code: '688256', name: '寒武纪-U', market: 'cn', price: 1587.46, prev: 1389.11, score: 92,
    reason: '国产算力订单能见度提升，机构上调全年营收预期；技术面放量突破前高，MACD 零轴上金叉。',
    tags: ['国产算力', '放量突破', '机构上调'], risk: '中高',
  },
  {
    code: '601899', name: '紫金矿业', market: 'cn', price: 19.82, prev: 19.24, score: 86,
    reason: '金价创新高带动矿产金毛利扩张，铜矿二期投产；周线级别趋势完好，回踩 5 日线即获支撑。',
    tags: ['黄金', '趋势跟随', '资源'], risk: '中',
  },
  {
    code: '00981', name: '中芯国际', market: 'hk', price: 52.85, prev: 51.30, score: 84,
    reason: '先进制程扩产落地，成熟制程价格企稳；港股通连续 5 日净买入，量能温和放大。',
    tags: ['半导体', '港股通', '产能扩张'], risk: '中',
  },
  {
    code: 'NVDA', name: '英伟达', market: 'us', price: 219.69, prev: 213.40, score: 83,
    reason: 'GB300 出货节奏超预期，数据中心收入指引上调；日线沿 20 日线稳步上行，未见背离。',
    tags: ['AI芯片', '趋势跟随'], risk: '中高',
  },
  {
    code: '00700', name: '腾讯控股', market: 'hk', price: 452.60, prev: 445.20, score: 81,
    reason: '游戏流水回暖 + 视频号广告加载率提升；回购持续，估值仍低于五年中枢。',
    tags: ['互联网', '回购', '估值修复'], risk: '低',
  },
  {
    code: '688111', name: '金山办公', market: 'cn', price: 312.50, prev: 305.20, score: 78,
    reason: 'AI 订阅渗透率快速提升，B 端续费率改善；底部横盘 6 周后首次放量站上 60 日线。',
    tags: ['AI应用', '底部放量'], risk: '中',
  },
  {
    code: 'AMD', name: 'AMD', market: 'us', price: 186.42, prev: 181.05, score: 76,
    reason: 'MI400 进入量产爬坡，云厂商订单落地；相对 NVDA 估值折价明显，存在补涨空间。',
    tags: ['AI芯片', '补涨'], risk: '中高',
  },
  {
    code: '002594', name: '比亚迪', market: 'cn', price: 291.75, prev: 288.10, score: 75,
    reason: '海外销量连续三月超预期，单车利润企稳；月线级别构筑圆弧底，量价配合良好。',
    tags: ['新能源车', '出海'], risk: '中',
  },
];

/* --------------------------------------------------------------------------
   指数
   -------------------------------------------------------------------------- */

/**
 * 指数
 *
 * 每条都显式写死 `symbol`：不能靠「代码 + 市场」推。
 * `000001` 既可能是上证指数（sh000001）也可能是平安银行（sz000001），
 * 按规则推会把上证指数推成平安银行 —— 不报错，只是首页那个数字悄悄换了含义。
 *
 * 下面的 price / prev 是**离线时的占位值**：只要后端可用，applyQuotes()
 * 会用真实行情覆盖它们。
 */
export const INDICES = [
  { code: '000001', symbol: 'sh000001', name: '上证指数', price: 3428.65, prev: 3400.75, market: 'cn' },
  { code: '399001', symbol: 'sz399001', name: '深证成指', price: 11256.40, prev: 11118.60, market: 'cn' },
  { code: '399006', symbol: 'sz399006', name: '创业板指', price: 2388.15, prev: 2339.95, market: 'cn' },
  { code: 'HSI', symbol: 'hkHSI', name: '恒生指数', price: 26480.30, prev: 26600.10, market: 'hk' },
  { code: 'IXIC', symbol: 'usIXIC', name: '纳斯达克', price: 19842.55, prev: 19708.40, market: 'us' },
  { code: 'SPX', symbol: 'usINX', name: '标普500', price: 6142.20, prev: 6120.75, market: 'us' },
];

/* --------------------------------------------------------------------------
   快讯
   -------------------------------------------------------------------------- */

export const NEWS = [
  { time: '10:32', title: '央行开展 4500 亿元 MLF 操作，中标利率持平', desc: '本月 MLF 净投放 1200 亿元，流动性维持合理充裕。', tags: ['宏观', '流动性'] },
  { time: '10:05', title: '寒武纪盘中涨超 14%，成交额突破 80 亿元', desc: '国产算力板块集体走强，机构席位净买入 3.2 亿元。', tags: ['持仓相关', '寒武纪-U'] },
  { time: '09:48', title: '英伟达盘后公布 GB300 出货指引，超市场预期', desc: '数据中心业务指引上调至 480 亿美元，供应链同步受益。', tags: ['持仓相关', '英伟达'] },
  { time: '09:20', title: '国常会部署新一轮消费品以旧换新，汽车家电在列', desc: '预计拉动消费超 3000 亿元，广汽集团、比亚迪关注度提升。', tags: ['政策', '汽车'] },
  { time: '08:55', title: '北向资金早盘净买入 42.6 亿元，连续三日净流入', desc: '主要流向电子、电力设备与有色金属。', tags: ['资金面'] },
  { time: '08:30', title: '国际金价站上 2680 美元/盎司，再创历史新高', desc: '避险需求与降息预期共振，紫金矿业、山东黄金受关注。', tags: ['大宗商品', '黄金'] },
];

/* --------------------------------------------------------------------------
   价格提醒规则
   -------------------------------------------------------------------------- */

export let ALERTS = [
  {
    id: 'al_1', code: '688256', name: '寒武纪-U', market: 'cn', enabled: true,
    logic: 'OR',
    conds: [
      { field: 'price', op: '>=', value: 1650, label: '现价 ≥ ¥1650.00' },
      { field: 'pct', op: '<=', value: -5, label: '日内跌幅 ≤ -5%' },
    ],
    scope: '交易时段', cooldown: '30 分钟', dailyCap: 5, repeat: '仅一次',
    channels: ['telegram', 'wechat'], fired: 2, lastFired: '今日 10:12',
  },
  {
    id: 'al_2', code: '601238', name: '广汽集团', market: 'cn', enabled: true,
    logic: 'AND',
    conds: [
      { field: 'price', op: '>=', value: 6.0, label: '现价 ≥ ¥6.00' },
      { field: 'volumeRatio', op: '>=', value: 1.5, label: '量比 ≥ 1.5' },
    ],
    scope: '交易时段', cooldown: '60 分钟', dailyCap: 3, repeat: '可重复',
    channels: ['wechat'], fired: 0, lastFired: '—',
  },
  {
    id: 'al_3', code: 'NVDA', name: '英伟达', market: 'us', enabled: true,
    logic: 'OR',
    conds: [
      { field: 'pct', op: '>=', value: 5, label: '日内涨幅 ≥ 5%' },
      { field: 'turnover', op: '>=', value: 5e9, label: '成交额 ≥ $50.0亿' },
    ],
    scope: '全天', cooldown: '15 分钟', dailyCap: 10, repeat: '可重复',
    channels: ['telegram', 'bark'], fired: 1, lastFired: '今日 04:38',
  },
  {
    id: 'al_4', code: '600519', name: '贵州茅台', market: 'cn', enabled: false,
    logic: 'AND',
    conds: [{ field: 'price', op: '<=', value: 1450, label: '现价 ≤ ¥1450.00' }],
    scope: '交易时段', cooldown: '120 分钟', dailyCap: 2, repeat: '仅一次',
    channels: ['wechat'], fired: 0, lastFired: '—',
  },
  {
    id: 'al_5', code: '00700', name: '腾讯控股', market: 'hk', enabled: true,
    logic: 'OR',
    conds: [{ field: 'price', op: '>=', value: 470, label: '现价 ≥ HK$470.00' }],
    scope: '交易时段', cooldown: '60 分钟', dailyCap: 3, repeat: '仅一次',
    channels: ['telegram'], fired: 0, lastFired: '—',
  },
  {
    id: 'al_6', code: '300418', name: '昆仑万维', market: 'cn', enabled: false,
    logic: 'AND',
    conds: [
      { field: 'price', op: '<=', value: 40, label: '现价 ≤ ¥40.00' },
      { field: 'pct', op: '<=', value: -3, label: '日内跌幅 ≤ -3%' },
    ],
    scope: '交易时段', cooldown: '30 分钟', dailyCap: 5, repeat: '可重复',
    channels: ['wechat', 'dingtalk'], fired: 3, lastFired: '08-21 14:22',
  },
];

/* --------------------------------------------------------------------------
   模拟盘
   -------------------------------------------------------------------------- */

export const PAPER = {
  name: 'AI 信号跟单组合',
  initial: 1_000_000,
  nav: 1.0842,
  benchmark: 1.0216,
  startedAt: '2026-03-02',
  stats: {
    totalReturn: 8.42,
    annualized: 14.86,
    maxDrawdown: -6.35,
    sharpe: 1.42,
    winRate: 61.3,
    trades: 87,
  },
  holdings: [
    { code: '688256', name: '寒武纪-U', market: 'cn', cost: 1420.00, shares: 100, price: 1587.46, prev: 1389.11, weight: 24.6 },
    { code: '601899', name: '紫金矿业', market: 'cn', cost: 17.40, shares: 6000, price: 19.82, prev: 19.24, weight: 18.4 },
    { code: '00700', name: '腾讯控股', market: 'hk', cost: 402.00, shares: 300, price: 452.60, prev: 445.20, weight: 16.8 },
    { code: 'NVDA', name: '英伟达', market: 'us', cost: 198.20, shares: 60, price: 219.69, prev: 213.40, weight: 14.2 },
    { code: '688111', name: '金山办公', market: 'cn', cost: 288.00, shares: 200, price: 312.50, prev: 305.20, weight: 9.7 },
  ],
  recentTrades: [
    { time: '今日 09:35', code: '688256', name: '寒武纪-U', side: 'buy', shares: 20, price: 1512.30, pnl: null },
    { time: '08-21 14:20', code: '601899', name: '紫金矿业', side: 'sell', shares: 2000, price: 19.68, pnl: 4560 },
    { time: '08-20 10:05', code: '00700', name: '腾讯控股', side: 'buy', shares: 100, price: 438.20, pnl: null },
    { time: '08-19 14:52', code: 'NVDA', name: '英伟达', side: 'sell', shares: 20, price: 214.85, pnl: 1330 },
    { time: '08-18 09:41', code: '688111', name: '金山办公', side: 'buy', shares: 100, price: 291.40, pnl: null },
  ],
};

/* --------------------------------------------------------------------------
   AI 盘前分析（首页用）
   -------------------------------------------------------------------------- */

export const PREMARKET = {
  generatedAt: '今日 09:02',
  summary: '隔夜美股科技板块走强，纳指涨 0.68%，英伟达 GB300 指引超预期。A 股方面，央行 MLF 净投放 1200 亿元，流动性宽松；国产算力、黄金板块有明确催化。你的持仓中 <b>寒武纪-U</b> 与 <b>英伟达</b> 直接受益，<b>广汽集团</b> 受以旧换新政策提振但技术面仍弱。',
  suggestions: [
    { action: '加仓', code: '688256', name: '寒武纪-U', reason: '放量突破前高，订单能见度提升', level: 'high' },
    { action: '持有', code: 'NVDA', name: '英伟达', reason: 'GB300 指引超预期，趋势完好', level: 'mid' },
    { action: '减仓', code: '601238', name: '广汽集团', reason: '浮亏 32.7%，量能持续萎缩', level: 'high' },
  ],
};

/** Agent 推理链（展示 TradingAgents 多 Agent 流程） */
export const AGENT_CHAIN = [
  { name: '技术分析师', desc: 'MA/MACD/RSI 共振扫描 · 识别放量突破形态', state: 'done' },
  { name: '情绪分析师', desc: '雪球/股吧情绪打分 72，龙虎榜机构净买入', state: 'done' },
  { name: '新闻分析师', desc: '检索 24h 内 18 条相关资讯，3 条为强催化', state: 'done' },
  { name: '基本面分析师', desc: '营收 YoY +128%，毛利率回升至 58.4%', state: 'done' },
  { name: '看多 / 看空辩论', desc: '3 轮交锋，看多方就估值给出反证', state: 'active' },
  { name: '风控审查', desc: '待辩论收敛后评估仓位与回撤承受度', state: 'todo' },
  { name: 'PM 决策书', desc: '整合输出最终操作建议与目标价位', state: 'todo' },
];

/* --------------------------------------------------------------------------
   派生计算
   -------------------------------------------------------------------------- */

/**
 * 当日走势（迷你走势图用的序列）
 *
 * 为什么专门做一个：`series()` 生成的是一条**随机游走**，只保证终点等于
 * 现价，起点是随机的。以前整站都是演示数据，这没问题；现在价格是真的了，
 * 把一条起点随机的曲线摆在真实价格旁边就是在误导 —— 用户会以为那是分时图。
 *
 * 这里的做法是**两端都锚在真实数据上**（起点 = 昨收，终点 = 现价），
 * 中间叠一层确定性噪声，噪声用 sin 包络在首尾归零。
 * 于是涨跌方向和幅度是真的，中间的形状是示意 —— 界面上也照这个口径标注。
 */
function daySpark(rec, n = 32) {
  const prev = Number(rec.prev);
  const price = Number(rec.price);
  /* 没有报价就没有走势可言。
     返回空数组，sparkline 会因为「不足 2 个点」什么都不画 ——
     硬凑一条 base=0 的直线会渲染出一根贴底的横线，看着像跌了 100%。 */
  if (!Number.isFinite(price) || price <= 0) return [];

  const a = Number.isFinite(prev) && prev > 0 ? prev : price;
  const b = price;
  // series(seed, n, 1, v) 的末位恒为 1；减 1 就得到末位为 0 的噪声
  const noise = series(`${rec.symbol || rec.code}:day`, n, 1, 0.004).map((v) => v - 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1);
    const envelope = Math.sin(Math.PI * t); // 首尾为 0，中段最大
    out.push(a + (b - a) * t + noise[i] * envelope * Math.abs(b || 1));
  }
  return out;
}

/** 单条持仓补全派生字段 */
function enrichPosition(p) {
  const mkt = MARKETS[p.market];
  const fx = FX[mkt.currency];
  const costValue = p.cost * p.shares;

  /* 有价格吗？
     数据库里只存「用户事实」—— 成本、股数，**不存价格**（价格是行情，
     存进库第二天就是错的）。所以 applyUserData 之后、applyQuotes 之前，
     这些记录没有 price。这段时间不能假装算得出来：NaN 一路传下去会让
     「总资产」显示成一个破折号，比空着更让人摸不着头脑。
     所以显式标出 hasQuote，汇总时跳过。 */
  const hasQuote = Number.isFinite(p.price) && p.price > 0;
  const hasPrev = Number.isFinite(p.prev) && p.prev > 0;

  const mv = hasQuote ? p.price * p.shares : NaN;            // 原币市值
  const pnl = hasQuote ? mv - costValue : NaN;               // 原币盈亏
  const todayPnl = hasQuote && hasPrev ? (p.price - p.prev) * p.shares : NaN;
  const chgPct = hasQuote && hasPrev ? ((p.price - p.prev) / p.prev) * 100 : NaN;

  return {
    ...p,
    marketInfo: mkt,
    currency: mkt.currency,
    fx,
    hasQuote,
    hasPrev,
    chgPct,
    mvLocal: mv,
    mv: hasQuote ? mv * fx : NaN,                            // 折人民币市值
    pnlLocal: pnl,
    pnl: hasQuote ? pnl * fx : NaN,                          // 折人民币盈亏
    // 收益率只跟成本和现价有关，与汇率无关
    pnlPct: hasQuote && costValue ? (pnl / costValue) * 100 : NaN,
    todayPnlLocal: todayPnl,
    todayPnl: Number.isFinite(todayPnl) ? todayPnl * fx : NaN,
    todayPct: chgPct,
    costValue: costValue * fx,
    // 当日走势：两端锚真实值，形状示意（见 daySpark 的说明）
    spark: daySpark(p),
    sparkBase: hasPrev ? p.prev : NaN,
  };
}

/** 关注列表补全 */
function enrichWatch(w) {
  const mkt = MARKETS[w.market];
  const hasQuote = Number.isFinite(w.price) && w.price > 0;
  const hasPrev = Number.isFinite(w.prev) && w.prev > 0;
  const chgPct = hasQuote && hasPrev ? ((w.price - w.prev) / w.prev) * 100 : NaN;
  return {
    ...w,
    marketInfo: mkt,
    currency: mkt.currency,
    hasQuote,
    chgPct,
    spark: daySpark(w),
  };
}

/**
 * 只累加有限值。
 *
 * 为什么不能直接 reduce：只要有一个持仓还没拿到报价，它的 mv 就是 NaN，
 * `0 + NaN` 还是 NaN —— 整张卡片会变成「--」。跳过它至少能显示
 * 「已拿到报价的那部分」，配合 noQuote 计数把缺口说清楚。
 */
function sumFinite(list, pick) {
  let total = 0;
  for (const x of list) {
    const v = pick(x);
    if (Number.isFinite(v)) total += v;
  }
  return total;
}

/** 账户 + 组合汇总 */
function buildPortfolio() {
  const accounts = RAW_ACCOUNTS.map((a) => {
    const positions = a.positions.map(enrichPosition);
    const mv = sumFinite(positions, (p) => p.mv);
    const pnl = sumFinite(positions, (p) => p.pnl);
    const todayPnl = sumFinite(positions, (p) => p.todayPnl);
    const cost = sumFinite(positions, (p) => p.costValue);
    return {
      ...a,
      positions,
      total: {
        mv,
        pnl,
        pnlPct: cost ? (pnl / cost) * 100 : 0,
        todayPnl,
        todayPct: mv - todayPnl > 0 ? (todayPnl / (mv - todayPnl)) * 100 : 0,
        count: positions.length,
        // 有几只还没报价 —— 界面上要说出来，否则「总市值」少算了什么没人知道
        noQuote: positions.filter((p) => !p.hasQuote).length,
      },
    };
  });

  const mv = sumFinite(accounts, (a) => a.total.mv);
  const cash = sumFinite(accounts, (a) => a.cash);
  const pnl = sumFinite(accounts, (a) => a.total.pnl);
  const todayPnl = sumFinite(accounts, (a) => a.total.todayPnl);
  const cost = sumFinite(
    accounts.flatMap((a) => a.positions), (p) => p.costValue
  );
  const total = mv + cash;

  return {
    accounts,
    total: {
      mv, cash, pnl, todayPnl, cost,
      totalAssets: total,
      pnlPct: cost ? (pnl / cost) * 100 : 0,
      todayPct: total - todayPnl > 0 ? (todayPnl / (total - todayPnl)) * 100 : 0,
      positionRatio: total ? (mv / total) * 100 : 0,
      count: accounts.reduce((s, a) => s + a.positions.length, 0),
      noQuote: accounts.reduce((s, a) => s + a.total.noQuote, 0),
      spark: series('portfolio-nav', 40, total, 0.006),
    },
  };
}

/* --------------------------------------------------------------------------
   派生结果（可被实时行情整体重建）
   --------------------------------------------------------------------------
   这几个用 `let` 导出，配合 rebuild() 在行情更新后整份重算。

   ⚠️ 视图里必须在**函数体内**访问 `PORTFOLIO.xxx` 才能读到新值。
   ESM 的实时绑定只在「读导出名的那一刻」生效；模块顶层解构
   （`const { total } = PORTFOLIO`）会把旧对象钉死，行情更新后界面不动。
   当前所有视图都符合这个要求（已逐个核对过）。
   -------------------------------------------------------------------------- */

/** 指数补全 */
function buildIndexData() {
  return INDICES.map((i) => ({
    ...i,
    marketInfo: MARKETS[i.market],
    chgPct: i.prev ? ((i.price - i.prev) / i.prev) * 100 : 0,
    chg: i.price - i.prev,
    spark: daySpark(i, 28),
  }));
}

/** 模拟盘持仓补全 */
function buildPaperHoldings() {
  return PAPER.holdings.map((h) => {
    const mkt = MARKETS[h.market];
    const fx = FX[mkt.currency];
    const mv = h.price * h.shares * fx;
    const cost = h.cost * h.shares * fx;
    return {
      ...h,
      marketInfo: mkt,
      currency: mkt.currency,
      chgPct: h.prev ? ((h.price - h.prev) / h.prev) * 100 : 0,
      mv,
      pnl: mv - cost,
      pnlPct: h.cost ? ((h.price - h.cost) / h.cost) * 100 : 0,
      spark: daySpark({ ...h, symbol: toSymbol(h.code, h.market) }, 28),
    };
  });
}

export let PORTFOLIO = buildPortfolio();
export let WATCHLIST = RAW_WATCHLIST.map(enrichWatch);
export let INDEX_DATA = buildIndexData();

/** 模拟盘净值曲线 */
export const PAPER_NAV = (() => {
  const n = 120;
  const out = [];
  let nav = 1;
  let bm = 1;
  // 用固定种子生成，保证每次一致
  const seedSeries = series('paper-nav', n, 1, 0.012);
  const bmSeries = series('paper-bm', n, 1, 0.010);
  // 归一化到起点 1
  const s0 = seedSeries[0];
  const b0 = bmSeries[0];
  for (let i = 0; i < n; i++) {
    nav = seedSeries[i] / s0;
    bm = bmSeries[i] / b0;
    out.push({ i, nav: nav * PAPER.nav, benchmark: bm * PAPER.benchmark });
  }
  return out;
})();

export let PAPER_HOLDINGS = buildPaperHoldings();

/** 找股票：先在持仓里找，再在关注/机会里找 */
export function findStock(code) {
  for (const a of PORTFOLIO.accounts) {
    const p = a.positions.find((x) => x.code === code);
    if (p) return { ...p, held: true, accountId: a.id, accountName: a.name };
  }
  const w = WATCHLIST.find((x) => x.code === code);
  if (w) return { ...w, held: false, aiAction: '观察', tags: [w.note] };
  const o = OPPORTUNITIES.find((x) => x.code === code);
  if (o) {
    const mkt = MARKETS[o.market];
    return {
      ...o, ...mkt ? {} : {},
      marketInfo: mkt,
      currency: mkt.currency,
      held: false,
      chgPct: ((o.price - o.prev) / o.prev) * 100,
      aiAction: '观察',
      spark: series(o.code, 32, o.price, 0.02),
    };
  }
  const ph = PAPER_HOLDINGS.find((x) => x.code === code);
  if (ph) return { ...ph, held: true, accountName: '模拟盘' };
  return null;
}

/** 技术指标（由走势序列推导，保证与图形一致） */
export function technicals(code, price) {
  const s = series(code + ':tech', 60, price, 0.02);
  const last = price;
  const ma = (n) => s.slice(-n).reduce((a, b) => a + b, 0) / n;
  const ma5 = ma(5), ma10 = ma(10), ma20 = ma(20), ma60 = ma(60);

  // 用序列构造一个确定性的 RSI / KDJ / MACD
  let gain = 0, loss = 0;
  for (let i = 1; i < s.length; i++) {
    const d = s[i] - s[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  const rs = loss === 0 ? 100 : gain / loss;
  const rsi = 100 - 100 / (1 + rs);

  const macd = (ma(12) - ma(26));
  const signal = macd * 0.82;

  const hi = Math.max(...s.slice(-9));
  const lo = Math.min(...s.slice(-9));
  const k = hi === lo ? 50 : ((last - lo) / (hi - lo)) * 100;
  const d = k * 0.9 + 5;

  const bollMid = ma20;
  const sd = Math.sqrt(s.slice(-20).reduce((a, b) => a + (b - bollMid) ** 2, 0) / 20);

  const rows = [
    { name: 'MA', value: `MA5 ${ma5.toFixed(2)}`, signal: ma5 > ma10 && ma10 > ma20 ? 'bull' : ma5 < ma10 && ma10 < ma20 ? 'bear' : 'flat', label: ma5 > ma10 && ma10 > ma20 ? '多头排列' : ma5 < ma10 && ma10 < ma20 ? '空头排列' : '纠缠', strength: ma5 > ma10 && ma10 > ma20 ? 4 : ma5 < ma10 && ma10 < ma20 ? 4 : 2 },
    { name: 'MACD', value: macd.toFixed(3), signal: macd > signal ? 'bull' : 'bear', label: macd > signal ? '金叉向上' : '死叉向下', strength: Math.abs(macd - signal) / (price * 0.004) > 3 ? 4 : 3 },
    { name: 'RSI', value: rsi.toFixed(1), signal: rsi > 70 ? 'bear' : rsi < 30 ? 'bull' : 'flat', label: rsi > 70 ? '超买' : rsi < 30 ? '超卖' : '中性', strength: rsi > 70 || rsi < 30 ? 4 : 2 },
    { name: 'KDJ', value: `K ${k.toFixed(0)}`, signal: k > 80 ? 'bear' : k < 20 ? 'bull' : 'flat', label: k > 80 ? '高位钝化' : k < 20 ? '低位金叉' : '中性', strength: k > 80 || k < 20 ? 3 : 2 },
    { name: 'BOLL', value: `${(bollMid + 2 * sd).toFixed(2)}`, signal: last > bollMid + 2 * sd ? 'bear' : last < bollMid - 2 * sd ? 'bull' : 'flat', label: last > bollMid + 2 * sd ? '突破上轨' : last < bollMid - 2 * sd ? '跌破下轨' : '通道内运行', strength: 3 },
  ];

  const bulls = rows.filter((r) => r.signal === 'bull').length;
  const bears = rows.filter((r) => r.signal === 'bear').length;
  const resonance = bulls >= 3 ? 'bull' : bears >= 3 ? 'bear' : 'flat';

  return { rows, bulls, bears, resonance, ma5, ma10, ma20, ma60, rsi, k, d, macd, signal, bollMid, sd };
}

/**
 * K 线。
 *
 * 真实日 K 由 /api/kline 灌入（applyKline）。拿到之前用本地生成的兜底，
 * 所以离线打开时详情页照样有图，只是图是假的 —— klineIsLive() 用来区分，
 * 界面据此标注来源。
 *
 * 参数从 (code, price, n) 改成 (code, market, price, n)：要定位真实 K 线
 * 就必须知道市场（600519 和 00700 的 symbol 规则不同）。
 */
export function klineData(code, market, price, n = 60) {
  const symbol = toSymbol(code, market);
  const real = symbol ? liveKlines.get(symbol) : null;
  if (real && real.length >= 5) {
    // 只取 {o,h,l,c}：图表只认这四个字段
    return real.slice(-n).map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c }));
  }
  return klines(code, n, price, 0.02);
}

/** 这条 K 线是真数据还是本地生成的兜底 */
export function klineIsLive(code, market) {
  const symbol = toSymbol(code, market);
  const real = symbol ? liveKlines.get(symbol) : null;
  return !!(real && real.length >= 5);
}

/** 组合按市场分布 */
export function allocationByMarket() {
  const map = {};
  for (const a of PORTFOLIO.accounts) {
    for (const p of a.positions) {
      const k = p.market;
      map[k] = (map[k] || 0) + p.mv;
    }
  }
  const total = Object.values(map).reduce((s, v) => s + v, 0) || 1;
  return Object.entries(map).map(([k, v]) => ({
    key: k,
    label: MARKETS[k].label,
    value: v,
    pct: (v / total) * 100,
  })).sort((a, b) => b.value - a.value);
}

/* ==========================================================================
   实时行情覆盖层
   --------------------------------------------------------------------------
   职责分工：
     data.js  —— 持有数据、知道怎么重算派生指标
     live.js  —— 知道什么时候去拉、失败了怎么办

   这里只做「给我一份行情，我把它贴上去并重算」，不碰网络。
   这样即使没有后端，这一层也完全不参与，站点行为与改造前一致。
   ========================================================================== */

/** symbol → 最近一次行情快照 */
const liveQuotes = new Map();
/** symbol → 真实日 K 线（{date,o,h,l,c,v}） */
const liveKlines = new Map();

/** 供 UI 显示「数据是哪来的、多旧」 */
export const liveMeta = {
  quotesAt: 0,      // 最近一次行情写入本地的时刻（unix ms）
  applied: 0,       // 本轮覆盖了几条标的
  missing: 0,       // 有代码但拿不到行情的条数
  staleCount: 0,    // 行情超出 TTL（拿的是旧价）的条数
  online: false,
};

/** 一条记录对应的上游 symbol。指数靠显式 symbol 字段，其余按代码 + 市场推。 */
function symbolOf(rec) {
  return rec.symbol || toSymbol(rec.code, rec.market);
}

/**
 * 汇总所有需要行情的标的。
 * 前端用它拼出一次批量请求 —— 一次请求拿全，不要一只股票一个请求。
 */
export function collectSymbols() {
  const out = new Set();
  const push = (rec) => {
    const s = symbolOf(rec);
    if (s) out.add(s);
  };
  RAW_ACCOUNTS.forEach((a) => a.positions.forEach(push));
  RAW_WATCHLIST.forEach(push);
  OPPORTUNITIES.forEach(push);
  INDICES.forEach(push);
  PAPER.holdings.forEach(push);
  return [...out];
}

/**
 * 用行情覆盖本地价格，然后重算全部派生指标。
 *
 * 只覆盖 price / prev / 开高低量 —— 成本、股数是用户的事实，行情改不了它们。
 * 拿不到行情的标的**保持原值不动**：宁可显示旧价，也不要因为一次网络抖动
 * 把用户的持仓市值清成 0。
 */
export function applyQuotes(quoteMap) {
  let applied = 0;
  let missing = 0;
  let stale = 0;

  const patch = (rec) => {
    const s = symbolOf(rec);
    const q = s ? quoteMap[s] : null;
    if (!q || !(q.price > 0)) {
      missing++;
      return;
    }
    rec.price = q.price;
    if (q.prevClose > 0) rec.prev = q.prevClose;
    if (q.open != null) rec.open = q.open;
    if (q.high != null) rec.high = q.high;
    if (q.low != null) rec.low = q.low;
    if (q.volume != null) rec.volume = q.volume;
    if (q.amount != null) rec.amount = q.amount;
    if (q.quotedAt) rec.quotedAt = q.quotedAt;
    rec.live = true;
    rec.quoteStale = !!q.stale;
    if (q.stale) stale++;
    applied++;
  };

  RAW_ACCOUNTS.forEach((a) => a.positions.forEach(patch));
  RAW_WATCHLIST.forEach(patch);
  OPPORTUNITIES.forEach(patch);
  INDICES.forEach(patch);
  PAPER.holdings.forEach(patch);

  liveMeta.quotesAt = Date.now();
  liveMeta.applied = applied;
  liveMeta.missing = missing;
  liveMeta.staleCount = stale;

  rebuild();
  return { applied, missing, stale };
}

/**
 * 用 D1 里的数据替换本地持仓 / 自选 / 提醒。
 *
 * 空数组也算数 —— 用户真的把持仓删光了，界面就该是空的。
 * 「数组为空就保留演示数据」看着更友好，实际是让用户删不掉东西。
 */
export function applyUserData({ portfolio, watchlist, alerts } = {}) {
  let changed = false;

  if (Array.isArray(portfolio)) {
    RAW_ACCOUNTS = portfolio.map((a) => ({
      id: a.id,
      name: a.name,
      cash: Number(a.cash) || 0,
      positions: (a.positions || []).map((p) => ({
        code: String(p.code),
        market: p.market || 'cn',
        name: p.name || String(p.code),
        cost: Number(p.cost) || 0,
        shares: Number(p.shares) || 0,
        style: p.style || undefined,
        aiScore: p.aiScore == null ? undefined : p.aiScore,
        aiAction: p.aiAction || undefined,
        tags: Array.isArray(p.tags) ? p.tags : [],
        agent: p.agent || undefined,
        alert: p.alert || undefined,
        stale: !!p.stale,
      })),
    }));
    changed = true;
  }

  if (Array.isArray(watchlist)) {
    RAW_WATCHLIST = watchlist.map((w) => ({
      code: String(w.code),
      market: w.market || 'cn',
      name: w.name || String(w.code),
      note: w.note || undefined,
      aiScore: w.aiScore == null ? undefined : w.aiScore,
    }));
    changed = true;
  }

  if (Array.isArray(alerts)) {
    ALERTS = alerts.map((a) => ({ ...a }));
    changed = true;
  }

  if (changed) rebuild();
  return changed;
}

/** 灌入真实日 K 线（详情页用） */
export function applyKline(symbol, bars) {
  if (!symbol || !Array.isArray(bars) || !bars.length) return false;
  liveKlines.set(symbol, bars);
  return true;
}

/** 本地有没有这条 K 线 */
export function hasKline(symbol) {
  return liveKlines.has(symbol);
}

/** 整体重算派生结果。行情一变、用户数据一变，都走这里。 */
function rebuild() {
  PORTFOLIO = buildPortfolio();
  WATCHLIST = RAW_WATCHLIST.map(enrichWatch);
  INDEX_DATA = buildIndexData();
  PAPER_HOLDINGS = buildPaperHoldings();
}

/* --------------------------------------------------------------------------
   回写用的原始数据
   --------------------------------------------------------------------------
   必须导出「原始事实」而不是 PORTFOLIO / WATCHLIST —— 那两份是派生结果，
   带着 mv / pnl / spark 这些算出来的字段。把它们回写到 D1 会造成
   「库里存了市值」这种自相矛盾：下次行情一变，库里的市值就是错的，
   而且没人知道它对应哪个时刻的价格。
   -------------------------------------------------------------------------- */

/** 账户 + 持仓（只有成本、股数这些用户事实） */
export function rawAccounts() {
  return RAW_ACCOUNTS.map((a) => ({
    id: a.id,
    name: a.name,
    cash: a.cash,
    positions: a.positions.map((p) => ({
      code: p.code,
      market: p.market,
      name: p.name,
      cost: p.cost,
      shares: p.shares,
      style: p.style,
      aiScore: p.aiScore,
      aiAction: p.aiAction,
      tags: p.tags,
      agent: p.agent,
      alert: p.alert,
      stale: p.stale,
    })),
  }));
}

export function rawWatchlist() {
  return RAW_WATCHLIST.map((w) => ({
    code: w.code, market: w.market, name: w.name, note: w.note, aiScore: w.aiScore,
  }));
}

export function rawAlerts() {
  return ALERTS.map((a) => ({ ...a }));
}

/**
 * 改一条持仓的成本 / 股数，或删掉它。
 * 只动原始事实，派生指标由 rebuild() 重算 —— 这样不会出现
 * 「改了股数但市值没跟着变」。
 */
export function updatePosition(accountId, code, patch) {
  const acct = RAW_ACCOUNTS.find((a) => a.id === accountId);
  if (!acct) return false;
  const idx = acct.positions.findIndex((p) => p.code === code);
  if (idx < 0) return false;

  if (patch === null) {
    acct.positions.splice(idx, 1);
  } else {
    const p = acct.positions[idx];
    if (patch.cost != null && Number.isFinite(Number(patch.cost))) p.cost = Number(patch.cost);
    if (patch.shares != null && Number.isFinite(Number(patch.shares))) p.shares = Number(patch.shares);
    if (patch.style != null) p.style = patch.style;
  }
  rebuild();
  return true;
}

/** 改一条自选的备注 / 评分；patch 为 null 表示移除 */
export function updateWatch(code, patch) {
  const idx = RAW_WATCHLIST.findIndex((w) => w.code === code);
  if (idx < 0) return false;
  if (patch === null) RAW_WATCHLIST.splice(idx, 1);
  else {
    const w = RAW_WATCHLIST[idx];
    if (patch.note != null) w.note = patch.note;
    if (patch.aiScore != null) w.aiScore = Number(patch.aiScore);
  }
  rebuild();
  return true;
}

/** 开关一条提醒规则 */
export function setAlertEnabled(id, enabled) {
  const a = ALERTS.find((x) => x.id === id);
  if (!a) return false;
  a.enabled = !!enabled;
  return true;
}
