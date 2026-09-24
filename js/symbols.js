/* ==========================================================================
   股票代码 ↔ 上游 symbol 映射
   --------------------------------------------------------------------------
   这个模块被**两边同时使用**：

     前端（js/live.js）—— 把本地代码转成上游 symbol，去 /api/quotes 查行情
     Worker（worker/quotes.js）—— 把上游返回的 symbol 拆回代码与市场，存进 D1

   所以它必须保持**纯净**：不碰 DOM、不碰 window、不碰 localStorage。
   否则 Worker 里 import 会在模块求值阶段就抛错，而且报错位置离真正原因很远。

   上游是腾讯财经（qt.gtimg.cn），symbol 形如：
     sh600519  沪市        sz300418  深市        bj430047  北交所
     hk00700   港股        usAAPL    美股
   ========================================================================== */

/**
 * 指数必须写死 symbol，不能靠规则推。
 *
 * 反例：`000001` 既可能是**上证指数**（sh000001），也可能是**平安银行**
 * （sz000001）。按「首位数字判交易所」的规则推，上证指数会被推成
 * sz000001，于是首页显示的是平安银行的股价 —— 不报错，只是数字全错。
 * 指数是固定的一小撮，显式列出来最省事也最安全。
 */
export const INDEX_SYMBOLS = {
  '000001:cn': 'sh000001', // 上证指数（与深市 000001 平安银行重名）
  '399001:cn': 'sz399001', // 深证成指
  '399006:cn': 'sz399006', // 创业板指
  'HSI:hk': 'hkHSI',       // 恒生指数
  'IXIC:us': 'usIXIC',     // 纳斯达克综合
  'SPX:us': 'usINX',       // 标普 500（上游用的是 .INX）
  'DJI:us': 'usDJI',       // 道琼斯工业
};

const PREFIXES = ['sh', 'sz', 'bj', 'hk', 'us'];

/**
 * 本地代码 + 市场 → 上游 symbol。
 * 幂等：传进来的已经是 symbol 就原样返回，方便调用方不做判断。
 *
 * @param {string} code   如 600519 / 300418 / 00700 / AAPL，或已是 symbol
 * @param {string} market cn | hk | us
 * @returns {string|null} 无法识别时返回 null（调用方应跳过，不要拼一个假 symbol 去打上游）
 */
export function toSymbol(code, market) {
  const raw = String(code == null ? '' : code).trim();
  if (!raw) return null;

  // 已经是 symbol
  const lower = raw.toLowerCase();
  if (PREFIXES.some((p) => lower.startsWith(p)) && raw.length > 2) return raw;

  // 指数优先查表：靠规则推会把上证指数推成平安银行
  const hit = INDEX_SYMBOLS[`${raw.toUpperCase()}:${market}`] || INDEX_SYMBOLS[`${raw}:${market}`];
  if (hit) return hit;

  if (market === 'hk') return 'hk' + raw.padStart(5, '0');
  if (market === 'us') return 'us' + raw.toUpperCase();

  // A 股：六位数字，按首位判交易所
  if (/^\d{6}$/.test(raw)) {
    if (raw[0] === '6') return 'sh' + raw;                    // 沪市主板 / 科创板
    if (raw[0] === '0' || raw[0] === '3') return 'sz' + raw;  // 深市主板 / 创业板
    if (raw[0] === '8' || raw[0] === '4') return 'bj' + raw;  // 北交所
    return 'sh' + raw;
  }
  return null;
}

/**
 * 上游 symbol → { code, market }。
 * 拆不出来时返回 null —— 宁可跳过这一条，也不要往库里写一行市场不明的数据。
 */
export function fromSymbol(symbol) {
  const m = /^(sh|sz|bj|hk|us)(.+)$/i.exec(String(symbol == null ? '' : symbol).trim());
  if (!m) return null;
  const pfx = m[1].toLowerCase();
  const rest = m[2];
  const market = pfx === 'us' ? 'us' : pfx === 'hk' ? 'hk' : 'cn';
  return { code: rest, market, prefix: pfx };
}

/** symbol 是否长得合法（Worker 用它挡掉前端传来的垃圾，避免拿去打上游） */
export function isValidSymbol(symbol) {
  return /^(sh|sz|bj)\d{6}$/i.test(String(symbol || ''))
    || /^hk[A-Z0-9.]{1,10}$/i.test(String(symbol || ''))
    || /^us[A-Z0-9.\-]{1,12}$/i.test(String(symbol || ''));
}
