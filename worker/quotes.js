/* ==========================================================================
   腾讯财经行情适配器
   --------------------------------------------------------------------------
   两个上游接口，都是免费、无需 API key 的公开接口：

     实时报价  https://qt.gtimg.cn/q=sh600519,sz300418,hk00700,usAAPL
     日 K 线   https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=...

   ── 三个必须知道的坑 ───────────────────────────────────────────────────

   ① **返回是 GBK 编码，而 Workers 的 TextDecoder 不支持 GBK。**
      解不出来中文名。解法是干脆不要上游的名字 —— 应用本来就有一份
      本地名称（持仓 / 自选 / 机会池都带 name），用本地的那份即可。
      字段切分不受影响：分隔符 `~` 是 ASCII 0x7E，而 UTF-8 的续字节
      范围是 0x80–0xBF，所以 `~` 永远不可能被当成多字节字符的一部分吞掉。

   ② **字段靠固定下标，不是键值对。** 上游返回的是
      `v_sh600519="1~贵州茅台~600519~1237.00~..."` 这种字符串。
      下标写错不会报错，只会静默给出错的价格 —— 所以每个下标都标了注释。

   ③ **三个市场的单位不一样，不统一就会差 100 / 10000 倍。**
        A 股：成交量是「手」（×100 才是股），成交额是「万元」（×10000 才是元）
        港股 / 美股：成交量是「股」，成交额是「元 / 美元」
      这里统一成「股」和「元」，市场之间的数字才可比。

   ── 出错时的策略 ─────────────────────────────────────────────────────
   一律**返回空结果而不抛异常**，让上层用缓存兜底。行情接口挂掉不该
   导致整个站点打不开 —— 展示上一分钟的价格，比展示一个错误页好得多。
   ========================================================================== */

import { fromSymbol, isValidSymbol } from '../js/symbols.js';

const QUOTE_ENDPOINT = 'https://qt.gtimg.cn/q=';
const KLINE_ENDPOINT = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get';

const CURRENCY = { cn: 'CNY', hk: 'HKD', us: 'USD' };

/** 一次最多查多少个 symbol。上游没有明确限制，但 URL 有长度上限。 */
const MAX_BATCH = 60;

/**
 * 按字节解码。
 *
 * 优先 latin1：它是 1 字节 ↔ 1 字符的直映，不存在「多字节序列吞掉分隔符」
 * 的可能，切分字段最稳。Workers 若不支持这个编码标签就退回 UTF-8
 * （同样安全，理由见文件头 ①）。
 */
function decode(buf) {
  try {
    return new TextDecoder('latin1').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/** 宽松数字解析：拿不到就返回 null，绝不用 0 冒充 */
function num(v) {
  const n = Number.parseFloat(String(v == null ? '' : v).trim());
  return Number.isFinite(n) ? n : null;
}

/** 上游时间戳归一成 `YYYY-MM-DD HH:MM:SS`。三个市场三种格式。 */
function normTime(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s); // 20260924150814
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  m = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})$/.exec(s); // 2026/09/24 14:53:17
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;                     // 2026-09-23 16:08:05
  return null;
}

/** 带超时的 fetch。上游卡住时不能把我们的请求也拖死。 */
async function getText(url, timeoutMs = 6000) {
  const init = { headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'PanWatch-H5/0.2' } };
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    init.signal = AbortSignal.timeout(timeoutMs);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`上游 HTTP ${res.status}`);
  return decode(await res.arrayBuffer());
}

/* --------------------------------------------------------------------------
   实时报价
   -------------------------------------------------------------------------- */

/**
 * 把一条上游记录解析成统一的行情对象。
 * 返回 null 表示这条不可用（停牌、代码不存在、字段缺失）——
 * 上层应当跳过它，保留自己已有的价格。
 */
function parseOne(symbol, body) {
  const f = String(body).split('~');
  // 下标：0=未知 1=名称(GBK，不用) 2=代码 3=现价 4=昨收 5=今开 6=成交量
  //       30=时间戳 31=涨跌 32=涨跌% 33=最高 34=最低 37=成交额
  const price = num(f[3]);
  const prev = num(f[4]);

  // 停牌或代码无效时上游会把价格留空 / 给 0。
  // 这里必须挡掉：0 会一路传下去把用户的持仓市值和盈亏全部清零，
  // 而且看起来「有数据」，比报错更难发现。
  if (price == null || price <= 0) return null;

  const parsed = fromSymbol(symbol);
  if (!parsed) return null;
  const { code, market } = parsed;

  const isCn = market === 'cn';
  const rawVol = num(f[6]);
  const rawAmt = num(f[37]);

  return {
    symbol,
    code,
    market,
    // 上游名称是 GBK，这里不取；名称由前端用本地数据补
    price,
    // 昨收缺失时退化成现价（涨跌幅变 0），好过 null 让整个计算链断掉
    prevClose: prev == null || prev <= 0 ? price : prev,
    open: num(f[5]),
    high: num(f[33]),
    low: num(f[34]),
    // 统一成「股」：A 股上游给的是手
    volume: rawVol == null ? null : (isCn ? rawVol * 100 : rawVol),
    // 统一成「元」：A 股上游给的是万元
    amount: rawAmt == null ? null : (isCn ? rawAmt * 10000 : rawAmt),
    currency: CURRENCY[market] || 'CNY',
    quotedAt: normTime(f[30]),
  };
}

/**
 * 批量取行情。返回可用记录数组（可能少于请求数量）。
 * @param {string[]} symbols 上游 symbol，如 ['sh600519','hk00700']
 */
export async function fetchQuotes(symbols) {
  const list = [...new Set((symbols || []).filter(isValidSymbol))];
  if (!list.length) return [];

  const out = [];
  const errors = [];

  for (let i = 0; i < list.length; i += MAX_BATCH) {
    const batch = list.slice(i, i + MAX_BATCH);
    try {
      const text = await getText(QUOTE_ENDPOINT + batch.join(','));
      // v_sh600519="1~贵州茅台~600519~1237.00~..."
      for (const m of text.matchAll(/v_([A-Za-z0-9._]+)="([^"]*)"/g)) {
        const rec = parseOne(m[1], m[2]);
        if (rec) out.push(rec);
      }
    } catch (err) {
      errors.push(String((err && err.message) || err));
    }
  }

  // 全批都失败才算失败；部分失败时用成功的那些，并让上层知道
  if (!out.length && errors.length) {
    const e = new Error('行情上游不可用：' + errors[0]);
    e.upstream = true;
    throw e;
  }
  return out;
}

/* --------------------------------------------------------------------------
   日 K 线
   -------------------------------------------------------------------------- */

/**
 * 取日 K 线（最多 60 根）。
 *
 * 返回顺序是**从旧到新**，与前端 klines() 的输出一致。
 * 上游数组格式是 [日期, 开, 收, 高, 低, 量] —— 注意是「开收高低」不是
 * 「开高低收」。港股/美股的那一行后面还会多挂一个除权信息的对象，
 * 所以只取前 6 个元素，不要按长度判断。
 */
export async function fetchKline(symbol, days = 60) {
  if (!isValidSymbol(symbol)) return [];
  const n = Math.min(Math.max(Number(days) || 60, 1), 250);
  const url = `${KLINE_ENDPOINT}?param=${encodeURIComponent(symbol)},day,,,${n},qfq`;

  const text = await getText(url, 8000);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return [];
  }
  if (payload.code !== 0 || !payload.data) return [];

  const node = payload.data[symbol];
  if (!node) return [];

  // A 股给的是前复权 qfqday；港股 / 美股没有复权概念，给 day。
  const rows = node.qfqday || node.day || node.hfqday || [];
  const parsed = fromSymbol(symbol);
  const isCn = parsed && parsed.market === 'cn';

  return rows
    .map((r) => {
      if (!Array.isArray(r) || r.length < 5) return null;
      const [date, open, close, high, low, volume] = r;
      const o = num(open), c = num(close), h = num(high), l = num(low);
      if (!date || o == null || c == null || h == null || l == null) return null;
      const v = num(volume);
      return {
        date: String(date),
        o, c, h, l,
        // 与报价一样统一成「股」
        v: v == null ? null : (isCn ? v * 100 : v),
      };
    })
    .filter(Boolean);
}
