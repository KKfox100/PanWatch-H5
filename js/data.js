/* ==========================================================================
   演示数据
   --------------------------------------------------------------------------
   说明：这里只声明「原始事实」（成本、持仓、现价、昨收），
   所有派生指标（市值 / 盈亏 / 涨跌幅 / 今日盈亏）一律在 enrich() 里算出来。
   这样任何数字改动都不会出现前后矛盾 —— 演示数据的可信度全靠这一点。

   汇率固定为演示值，不联网。
   ========================================================================== */

import { series, klines } from './utils.js';

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

const RAW_ACCOUNTS = [
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

const RAW_WATCHLIST = [
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

export const INDICES = [
  { code: '000001', name: '上证指数', price: 3428.65, prev: 3400.75, market: 'cn' },
  { code: '399001', name: '深证成指', price: 11256.40, prev: 11118.60, market: 'cn' },
  { code: '399006', name: '创业板指', price: 2388.15, prev: 2339.95, market: 'cn' },
  { code: 'HSI', name: '恒生指数', price: 26480.30, prev: 26600.10, market: 'hk' },
  { code: 'IXIC', name: '纳斯达克', price: 19842.55, prev: 19708.40, market: 'us' },
  { code: 'SPX', name: '标普500', price: 6142.20, prev: 6120.75, market: 'us' },
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

export const ALERTS = [
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

/** 单条持仓补全派生字段 */
function enrichPosition(p) {
  const mkt = MARKETS[p.market];
  const fx = FX[mkt.currency];
  const mv = p.price * p.shares;              // 原币市值
  const costValue = p.cost * p.shares;
  const pnl = mv - costValue;                 // 原币盈亏
  const todayPnl = (p.price - p.prev) * p.shares;
  const chgPct = p.prev ? ((p.price - p.prev) / p.prev) * 100 : 0;

  return {
    ...p,
    marketInfo: mkt,
    currency: mkt.currency,
    fx,
    chgPct,
    mvLocal: mv,
    mv: mv * fx,                              // 折人民币市值
    pnlLocal: pnl,
    pnl: pnl * fx,                            // 折人民币盈亏
    pnlPct: costValue ? (pnl / costValue) * 100 : 0,
    todayPnlLocal: todayPnl,
    todayPnl: todayPnl * fx,
    todayPct: chgPct,
    costValue: costValue * fx,
    // 稳定走势序列（种子用 code，保证刷新不变）
    spark: series(p.code, 32, p.price, p.market === 'us' ? 0.014 : 0.02),
    sparkBase: p.prev,
  };
}

/** 关注列表补全 */
function enrichWatch(w) {
  const mkt = MARKETS[w.market];
  const chgPct = w.prev ? ((w.price - w.prev) / w.prev) * 100 : 0;
  return {
    ...w,
    marketInfo: mkt,
    currency: mkt.currency,
    chgPct,
    spark: series(w.code, 32, w.price, 0.018),
  };
}

/** 账户 + 组合汇总 */
function buildPortfolio() {
  const accounts = RAW_ACCOUNTS.map((a) => {
    const positions = a.positions.map(enrichPosition);
    const mv = positions.reduce((s, p) => s + p.mv, 0);
    const pnl = positions.reduce((s, p) => s + p.pnl, 0);
    const todayPnl = positions.reduce((s, p) => s + p.todayPnl, 0);
    const cost = positions.reduce((s, p) => s + p.costValue, 0);
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
      },
    };
  });

  const mv = accounts.reduce((s, a) => s + a.total.mv, 0);
  const cash = accounts.reduce((s, a) => s + a.cash, 0);
  const pnl = accounts.reduce((s, a) => s + a.total.pnl, 0);
  const todayPnl = accounts.reduce((s, a) => s + a.total.todayPnl, 0);
  const cost = accounts.reduce(
    (s, a) => s + a.positions.reduce((x, p) => x + p.costValue, 0), 0
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
      spark: series('portfolio-nav', 40, total, 0.006),
    },
  };
}

export const PORTFOLIO = buildPortfolio();
export const WATCHLIST = RAW_WATCHLIST.map(enrichWatch);

/** 指数补全 */
export const INDEX_DATA = INDICES.map((i) => ({
  ...i,
  marketInfo: MARKETS[i.market],
  chgPct: ((i.price - i.prev) / i.prev) * 100,
  chg: i.price - i.prev,
  spark: series(i.code, 28, i.price, 0.008),
}));

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

/** 模拟盘持仓补全 */
export const PAPER_HOLDINGS = PAPER.holdings.map((h) => {
  const mkt = MARKETS[h.market];
  const fx = FX[mkt.currency];
  const mv = h.price * h.shares * fx;
  const cost = h.cost * h.shares * fx;
  return {
    ...h,
    marketInfo: mkt,
    currency: mkt.currency,
    chgPct: ((h.price - h.prev) / h.prev) * 100,
    mv,
    pnl: mv - cost,
    pnlPct: ((h.price - h.cost) / h.cost) * 100,
    spark: series(h.code + ':paper', 28, h.price, 0.018),
  };
});

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

/** K 线 */
export function klineData(code, price, n = 60) {
  return klines(code, n, price, 0.02);
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
