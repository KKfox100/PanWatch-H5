# 更新日志

## 0.2.0-h5 — 2026-09-24

数据从「纯演示」改为**实时行情 + SQLite 持久化**（可选后端）。

一句话概括这一版的设计前提：**实时数据和演示数据长得一模一样。**
所以整版的重点不是「把数据换成真的」，而是**让用户随时能分清现在看的是哪一种**，
以及**在没有后端时表现得和改造前完全一样**。

### 新增

- **Worker 后端**（`worker/`，与静态资源同一次部署，不需要另外找服务器）
  - `worker/index.js` —— `/api/*` 交给 API，其余转发静态资源
  - `worker/api.js` —— 端点与写入鉴权
  - `worker/db.js` —— D1 数据访问层，首次请求运行时建表 + 只在库为空时灌种子
  - `worker/quotes.js` —— 腾讯财经适配器
- **D1（托管 SQLite）**：9 张表（`quotes` / `klines` / `kline_meta` / `accounts` /
  `positions` / `watchlist` / `alerts` / `settings` / `meta`）。
  **持仓只存成本与股数这类「用户事实」，不存价格** —— 价格是行情的派生值，
  存两份必然会不一致
- **实时行情**：腾讯财经（`qt.gtimg.cn`），免费无 key，A股/港股/美股一次请求全拿。
  15 秒 TTL 缓存，过期才回源
- **真实日 K**：`web.ifzq.gtimg.cn`，A 股取前复权（`qfqday`）、港美股取不复权（`day`），
  300 秒缓存
- **API 端点**：`GET /api/health|quotes|kline|state`（公开）、
  `PUT /api/portfolio|watchlist|alerts|settings`（需 token）
- **写入 token 鉴权**：`Authorization: Bearer` 与 `X-PanWatch-Token` 两种头，
  用定长比较避免时间侧信道。读公开、写要 token
- **前端实时层**：`js/live.js`（何时拉、失败怎么办、拉回来给谁）、
  `js/api.js`（12 秒超时）、`js/symbols.js`（前后端共用的代码 ↔ 上游 symbol 映射）
- **数据源标识**：顶栏常驻一枚 chip，明确标出「实时 / 延迟 / 同步中 / 演示 / 已断开」，
  悬停给出原因。**这是这一版最重要的一处 UI** —— 没有它，两种数据无从区分
- **设置页新增实时状态卡**：服务端版本 / 最近同步 / 已覆盖报价数 / 写入鉴权 /
  立即同步 / 「后端地址与令牌」配置行
- **四个新脚本**：`e2e-live.cjs`（真实 Worker + 真实 D1，10 组 54 项断言）、
  `inspect-d1.cjs`（用 `node:sqlite` 直接读磁盘文件）、
  新增 `npm run e2e:live`

### 变更

- `wrangler.jsonc` 从「纯静态资源」改为「Worker + 静态资源」，
  新增 `main`、`d1_databases`、`vars`
- `js/data.js` 从「演示数据源」变为「演示数据是兜底、行情是覆盖层」，
  新增 `collectSymbols` / `applyQuotes` / `applyUserData` / `applyKline` / `rebuild`
- `sw.js` 的 `VERSION` → `v1.2.0`，预缓存加入三个新 js
- `package.json` 版本 → `0.2.0-h5`

### 修正

- **`worker/api.js` 里的 `serverTime: now`**（`now` 从未定义）→ `/api/quotes`
  整个 500。最麻烦的地方是前端把它当成「后端不可用」**安静地退回演示数据**，
  界面一切正常，只是价格永远不动。改为 `serverTime: servedAt`
- **无报价持仓污染整个汇总**：数据库只存成本/股数，`applyUserData` 之后、
  `applyQuotes` 之前持仓没有 `price`，`NaN` 一路传播让总资产/总盈亏变成「--」。
  修法：显式标 `hasQuote`、汇总用 `sumFinite` 跳过非有限值、
  **并新增 `noQuote` 计数把缺口说出来** —— 「悄悄少算」比「显示 --」更危险
- **`daySpark` 在没有报价时返回 `[]`**（原来会凑一条 `base=0` 的直线，
  渲染出一根贴底横线，看着像跌了 100%）
- **顶栏在行情落地前就声称「实时」**：`health` 成功即 online，但第一份报价
  可能还在路上 —— 这时候说「实时」就是在撒谎。新增 `!lastSync` 分支
- **「连上过再断线」与「从没连上」分开说**：前者屏幕上是服务端数据只是不再更新，
  标「演示数据」会让人误以为是干净的样本。新增 `everSynced`
- **`loadKline` 失败会雪崩**：失败也 `emit()` → `render()` → 再次调用 → 再失败，
  一秒几十次打到上游。加 `klineTried` Set，一次会话只试一次
- **`sw.js` 会把 `/api/quotes` 写进 Cache Storage**（同源 GET + 200 + `type: basic`
  恰好命中 cache-first 分支），价格永远停在第一次拉取的那一刻，
  且页面上看不出哪里坏了。加 `/api/*` 直接放行
- **`e2e.cjs` 的控制台断言**从「按数量放行」改为「按 URL 精确放行」：
  浏览器为失败请求打的日志 text 里**不含 URL**，只能按数量放行，
  那等于把真正的资源 404 一起放过去了。给 CDP 客户端加 `consoleErrorEntries()`
  返回 `{text, url}`，精确放行 `/api/health`，并**同时断言降级路径真的生效**

### 工程约束（新增，已写进代码注释与测试）

- **没有后端时，站点必须和改造前一模一样地工作** —— `init()` 探测失败直接返回，
  不抛异常、不显示错误页、不清空数据
- **顶栏始终标出当前数据是「实时」还是「演示」**
- **上游单位必须归一**：A 股成交量是「手」（×100）、成交额是「万元」（×10000）；
  港美股是「股」和「元」。不统一会差 100 / 10000 倍
- **指数代码必须写死上游 symbol**：`000001` 既可能是上证指数（`sh000001`）
  也可能是平安银行（`sz000001`），按规则推会把指数推成平安银行 ——
  不报错，只是数字悄悄换了含义。标普 500 是 `usINX`（不是 `usSPX`）
- **停牌/无效代码要挡掉**：上游返回价格 0，不能当成「跌到 0」
- **行情失败返回过期缓存而不是报错**：展示一分钟前的价格比展示错误页好得多，
  但要带上 `ageMs` 让上层能标出「延迟」
- **`/api/*` 绝不能进 Service Worker 缓存**
- **K 线 / 净值曲线 / AI 分析必须标注是「真实日 K」还是「示意曲线」**

---

## 0.1.0-h5 — 2026-09-24

首个版本。基于 [jackhuo2/PanWatch](https://github.com/jackhuo2/PanWatch) 重做的移动端 H5。

### 新增

- **独立 H5 应用**：原生 HTML / CSS / ES Module，无构建步骤，源文件即产物
- **莫兰迪配色**：完整设计令牌体系，浅色 / 深色 / 跟随系统三态
  - 涨红跌绿沿用中国市场习惯，并做低饱和处理（涨 `#b56a5e` / 跌 `#6d9174`）
  - 文字用暖炭灰、背景用燕麦米白，避免高对比破坏灰调
  - 阴影极淡且带暖色
- **七个页面**：首页、持仓、机会、模拟盘、提醒、个股详情、设置
- **手写 SVG 图表**：迷你走势图、K 线（含 MA5/10/20 与成交量）、净值曲线（双序列对比）、环形图，零图表库
- **演示数据层**：由原始事实（成本/持仓/现价/昨收）实时推导派生指标，数字永远自洽；
  走势序列以股票代码为随机种子，刷新不跳变
- **技术指标共振**：MA / MACD / RSI / KDJ / BOLL 五指标信号灯，含支撑压力位计算
- **TradingAgents 推理链**：七步流程可视化（4 分析师 → 辩论 → 风控 → PM 决策）
- **价格提醒**：条件组合 AND/OR、生效时段、冷却时间、日触发上限、重复模式、6 个推送渠道
- **PWA**：manifest + Service Worker 预缓存，可添加到主屏幕，断网可用
- **本地持久化**：主题 / 筛选 / 渠道开关 / 风险偏好写入 localStorage

### 部署

- `wrangler.jsonc` 配置 Cloudflare Workers 静态资源托管，`npx wrangler deploy` 一条命令上线
- **`.assetsignore`** 排除非运行时文件，最终只上传 33 个资源。
  ⚠️ `assets` 配置里没有 `exclude` 字段，写在那里只会得到一句警告然后被静默忽略，
  把整个仓库（含 `.git` 提交历史）一起传到边缘
- `_headers` 处理缓存策略：HTML 短缓存（发版即生效）、静态资源长缓存、SW 绝不缓存
- `not_found_handling: "404-page"` —— 未知路径返回真 404。
  ⚠️ **不能**用 `single-page-application`：哈希路由下它只会造出软 404（见下）
- 已用 `wrangler deploy --dry-run` 验证：零配置警告，上传清单符合预期

### 工具链

- `scripts/serve.mjs` — 零依赖本地静态服务
- `scripts/check.mjs` — 静态自检：import 路径、资源引用、SW 预缓存清单双向比对、
  图标名引用、`data-act` 处理函数覆盖、`data-*` 监听属性是否存在
- `scripts/e2e.cjs` — 真实 Chrome 端到端（CDP 驱动，不装 Playwright），
  12 组共 97 项断言，含莫兰迪令牌、涨跌语义方向、对比度、数据自洽、弹层动态增删、持久化
- `scripts/gen-icons.py` — 生成 PWA 图标（4 倍超采样）

### SEO 与 LLMO

这个应用 100% 客户端渲染，而 GPTBot / ClaudeBot / PerplexityBot / CCBot
基本都不执行 JavaScript —— 不处理的话，站点在语言模型眼里只有一具骨架屏。
补齐分三层：

- **机器可读层**：`robots.txt`（通配放行 + 显式许可 17 个 AI 抓取器）、
  `sitemap.xml`（只列 2 个真实 URL，哈希路由不进 sitemap）、
  `llms.txt`（免责声明放在前 600 字符内）、`llms-full.txt`
  （架构 / 工程约束 / 令牌全表 / 对比度实测）、`_headers` 给它们钉死 MIME
- **无 JS 回退内容**：`index.html` 的 `<noscript>` 扩成完整语义化文章
  （h1 + 5 个 h2 分节 + 功能清单 + FAQ 定义列表），并内嵌 `<style>` 隐藏
  `min-height: 100dvh` 的骨架屏 —— 否则它会把整篇文章顶出首屏
- **结构化数据**：`@graph` 装 `WebSite` / `WebApplication` / `FAQPage` 三个
  互引实体；`WebApplication` 带 `disambiguatingDescription`，明确声明
  站内行情均为伪随机演示数据、不构成投资建议
- **设置页新增「关于本项目」**：实质散文 + FAQ 定义列表，让 FAQPage 标记的
  内容对真实用户可见（Google 要求标记的内容必须能被读者看到）
- **修正软 404**：`not_found_handling` 改为 `404-page` 并补上真正的 `404.html`；
  `scripts/serve.mjs` 同步去掉 SPA 回退，保证本地与线上行为一致
- **地址收敛**：`<html data-site-origin>` 作为唯一真值来源，
  `npm run set-origin` 一次性替换 6 个文件里的绝对地址并校验
- **OG 卡片**：`scripts/gen-og.cjs` 用 CDP 渲染 `scripts/og-card.html`，
  产出 1200×630 的 `public/og.png`

### 工具链（补充）

- `scripts/e2e-seo.cjs` — SEO / LLMO 端到端，9 组共 99 项断言。第 8 组用
  `Emulation.setScriptExecutionDisabled` **真的关掉 JavaScript** 再导航，
  用 DOM 域确认回退内容成了真实节点，并用 `DOM.getBoxModel` 验它落在首屏内 ——
  只验 `display !== 'none'` 会漏掉「在 DOM 里但被顶出视口」这种缺陷
- `scripts/check.mjs` 新增第 8 项：FAQ 问答在 JSON-LD / `<noscript>` / 设置页
  三处逐字一致，改一处忘改另一处直接报错
- `scripts/gen-og.cjs`、`scripts/set-origin.cjs`

### 已知限制（v0.1.0 当时的状态）

- 数据全部为内置演示数据，不联网
- 无后端：真实行情与 AI 分析需自行部署上游 Python 后端并在设置里填入地址
- 模拟盘与提醒仅界面演示，不产生实际推送

> **v0.2.0 的进展**：实时行情与 SQLite 持久化已内置（见上），
> 前两条不再成立 —— 部署 Worker + D1 即可拿到真实行情，无需另找服务器。
> 第三条仍然成立，且**界面已明确标注**：模拟盘、AI 盘前分析、净值曲线
> 都带「演示内容」/「示意曲线」标记。K 线在接通后端后是**真实日 K**，
> 未接通时标「示意曲线」。
>
> 仍属限制的两项：写入令牌存在 localStorage（单租户、无登录，
> 能打开页面的人就能读到它）；提醒只在页面内触发，不产生真实推送。
