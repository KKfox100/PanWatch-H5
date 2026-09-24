# 盯盘侠 PanWatch · H5

> 移动端 H5 版本 · **莫兰迪配色** · 纯静态 · 可一键部署到 Cloudflare Workers

基于 [jackhuo2/PanWatch](https://github.com/jackhuo2/PanWatch)（自托管 AI 盯盘助手）改造的**独立移动端 H5 应用**。
原项目是 `FastAPI 后端 + React 前端` 的重型自托管方案；本版把界面重做成一套**零依赖、零构建、可直接上边缘节点**的移动优先 H5，开箱即是完整可交互的界面。

---

## 它和原项目的关系

| | 原项目 PanWatch | 本项目 PanWatch H5 |
|---|---|---|
| 形态 | 自托管全栈应用 | 纯静态 H5（无后端） |
| 技术栈 | Python FastAPI + React 18 + Tailwind + shadcn/ui | 原生 HTML / CSS / ES Module |
| 构建 | `pnpm build`，产物需 Node 运行时 | **无需构建**，源文件即产物 |
| 部署 | Docker（需 Python 运行时、Playwright、数据库卷） | Cloudflare Workers 静态资源 / 任意静态托管 |
| 数据 | 实时行情 + SQLite 持久化 | **内置演示数据**（本地计算，不联网） |
| 配色 | 深色 + 蓝色主调 | **莫兰迪灰调**（浅色为主，附暗色变体） |
| 体积 | 镜像数百 MB | 全站约 90 KB |

**为什么不能直接把原项目部署到 Workers**：Workers 只跑 JavaScript/WASM。
原后端依赖 `SQLAlchemy` / `APScheduler` / `Playwright` / Python 运行时，
这些在 Workers 上都跑不起来。所以本项目的做法是——
**前端独立成 H5，后端可选**（见「接入自建后端」）。

---

## 截图

移动端（390 × 844）：

| 首页 | 持仓 | 个股 AI 分析 | 模拟盘 |
|---|---|---|---|
| ![首页](docs/screenshots/h5-home.png) | ![持仓](docs/screenshots/h5-portfolio.png) | ![个股](docs/screenshots/h5-stock-ai.png) | ![模拟盘](docs/screenshots/h5-paper.png) |

| 机会 | 提醒 | 新建提醒 | 设置（深色） |
|---|---|---|---|
| ![机会](docs/screenshots/h5-opportunities.png) | ![提醒](docs/screenshots/h5-alerts.png) | ![弹层](docs/screenshots/h5-alert-sheet.png) | ![深色](docs/screenshots/h5-settings-dark.png) |

桌面端（1280 × 900，应用收窄居中）：

![桌面端](docs/screenshots/h5-desktop.png)

> 截图由 `node scripts/e2e.cjs` 在验证过程中自动产出，不是手工摆拍的。

设计规范页（`design/index.html`）：

| 概览 | 色彩 | 字体 | 组件 |
|---|---|---|---|
| ![规范概览](docs/screenshots/design-spec-top.png) | ![色彩](docs/screenshots/design-spec-color.png) | ![字体](docs/screenshots/design-spec-type.png) | ![组件](docs/screenshots/design-spec-components.png) |

> 同样由 `node scripts/e2e-design.cjs` 自动产出。

---

## 功能

底部五个主入口，加一个个股详情页和一个设置页：

| 页面 | 内容 |
|---|---|
| **首页** | 六大指数横条、总资产/总盈亏卡、账户净值曲线、AI 盘前分析（含操作建议）、持仓异动、模拟盘速览、市场快讯 |
| **持仓** | 多账户汇总（招商 / 东方）、6 张指标卡、仓位占比进度条、持仓 13 只 / 关注 10 只分段切换、A股/港股/美股市场筛选、自动刷新开关 |
| **机会** | AI 四维评分选股 8 只，按评分 / 涨幅 / 风险排序，市场筛选，含评分理由与风险等级 |
| **模拟盘** | 策略净值曲线（对比基准，4 档时间区间）、6 项绩效指标（年化/回撤/夏普/胜率）、模拟持仓权重条、最近交易流水 |
| **提醒** | 6 条价格提醒规则，条件组合 AND/OR、生效时段、冷却时间、日触发上限、重复模式、多推送渠道，规则开关 |
| **个股详情** | 行情头 + 持仓盈亏横幅、K 线（MA5/10/20 + 成交量）、技术指标共振（MA/MACD/RSI/KDJ/BOLL 信号灯）、支撑压力位、TradingAgents 七步推理链 |
| **设置** | 主题切换、莫兰迪色板预览、后端 API 配置、6 个通知渠道开关、风险偏好、数据概览 |

### 交互细节

- 全部图表是**手写 SVG**（迷你走势图、K 线、净值曲线、环形图），零图表库
- 演示数据由**原始事实**（成本、持仓、现价、昨收）实时推导，市值 / 盈亏 / 涨跌幅永远不会自相矛盾
- 每只股票的走势序列用**代码作随机种子**生成，刷新不会乱跳
- 底部弹层支持动态增删提醒条件（最多 5 条，至少保留 1 条）
- 偏好（主题 / 筛选 / 渠道开关 / 风险偏好）写入 `localStorage`，路由切换不丢
- PWA：可「添加到主屏幕」，Service Worker 预缓存全部资源，断网可用

---

## 莫兰迪设计系统

色板取自莫兰迪静物画的灰调：**所有颜色都掺入一层暖灰，饱和度压低，明度拉开但不刺眼**。

完整的交互式规范在这里 —— 浏览器直接打开 `design/index.html`（或本地服务下的
`/design/index.html`）：11 个章节、色板可点击复制令牌名、对比度是**页面加载时现算的**，
所以它永远和 `css/tokens.css` 一致。

### 每个色相拆成四个角色

v1 的根因不是「颜色不好看」，而是**一个颜色同时干四份活**：既当填充底，又当文字色，
又当胶囊底，还当胶囊上的字。结果就是文字对比度全面不达标 —— 实测 47 处缺陷。

v2 把每个色相拆成四个独立令牌，各自独立达标：

```css
--up-fill     填充底（大色块，如涨跌条、K 线）
--up-text     文字色（正文里的涨跌数字）        ← 对最暗的面 ≥ 4.5:1
--up-on-soft  胶囊文字（浅底胶囊上的字）        ← 对自家 --up-soft ≥ 4.5:1
--up-soft     胶囊底（背景，不受文字标准约束）
```

色相沿用莫兰迪灰调：主强调雾霾蓝、次强调鼠尾草绿、涨/危险陶土红、跌/成功灰绿、
警示琥珀、灰紫；涨跌严格遵循中国市场习惯 —— **涨红跌绿**。

### 色值不是手调的，是解出来的

`scripts/solve-tokens.mjs` 在 OKLCH 空间里反解：固定色相与彩度，二分搜索明度，
取**刚好达标的最浅解** —— 既合规，又保住莫兰迪的柔感。

用 OKLCH 而不是 HSL，是因为 HSL 的 L 是混色比例而非感知明度：同样的 L 值，
黄色看着很亮、蓝色看着很暗，靠手调 L 拼出来的灰阶会一段发蓝一段发黄。

两档阈值也是分开的：正文 4.5:1（WCAG 1.4.3 AA），大字与图形文字 3:1。
混为一谈要么冤枉设计，要么放过缺陷。

### 实测结果

```
受判定组合  88    达标 88    不达标 0
装饰豁免     8
```

`scripts/audit-contrast.mjs` 会同时做两件事：按 WCAG 2.1 公式验算所有前景/背景组合，
以及扫描**令牌泄漏** —— 绕过 `tokens.css` 的硬编码颜色。判据是「没名字的颜色改不动」。

装饰性元素（分隔线、进度槽）按 WCAG 1.4.11 豁免，判据是
「该元素消失后信息是否仍完整？」。但输入框和开关的描边承载「可操作」语义，
所以必须 ≥ 3:1 —— 这条边界最容易搞错。

---

## 本地运行

不需要安装任何依赖，起个静态服务即可（ES Module 对 MIME 敏感，别用 `file://` 直接打开）。

```bash
# 方式一：自带零依赖服务器（推荐）
node scripts/serve.mjs          # → http://127.0.0.1:5183

# 方式二：Python
python -m http.server 5183

# 方式三：wrangler 本地开发（行为与线上一致）
npm install
npm run dev                     # → http://127.0.0.1:8787
```

手机上看效果：把地址换成局域网 IP，或用 Chrome DevTools 的设备模拟。

### 自检与端到端测试

```bash
node scripts/check.mjs          # 静态自检：import 路径 / 资源引用 / SW 清单 / 图标名 / 事件绑定
node scripts/audit-contrast.mjs # 对比度审计 + 令牌泄漏扫描（纯 Node，不需要浏览器）
node scripts/e2e.cjs            # 应用端到端（需先起 serve.mjs）
node scripts/e2e-design.cjs     # 设计规范页端到端（同样需先起 serve.mjs）

npm run verify                  # 上面四项一次跑完
```

`e2e.cjs` 用系统已装的 Chrome 通过 CDP 驱动，**不装 Playwright**，
覆盖 12 组共 97 项断言：首屏、莫兰迪令牌、涨红跌绿、七个路由、
数据自洽、图表绘制、弹层动态增删、主题切换与对比度、持久化、
控制台零报错、桌面端居中布局，并输出移动端与桌面端截图。

---

## 部署到 Cloudflare Workers

项目已经配好 `wrangler.jsonc`，整个仓库就是站点，**没有服务端逻辑**。

```bash
npm install
npx wrangler login       # 浏览器授权一次
npm run deploy           # → https://panwatch-h5.<你的子域>.workers.dev
```

首次部署前，在 `wrangler.jsonc` 里把 `name` 改成你想要的名字
（默认 `panwatch-h5`，决定 `*.workers.dev` 子域前缀）。

几个已经处理好的细节：

- `assets.directory: "."` —— 项目根即站点根，`index.html` 直接对外
- **`.assetsignore`** —— 只发布 24 个运行时文件，`.git` / `scripts` / `docs` /
  配置文件都不上边缘（注意 `assets` 配置里**没有** `exclude` 字段，
  写在那里会被静默忽略并把整个仓库传上去）
- `not_found_handling: "single-page-application"` —— 深链回落，直接开 `#/portfolio` 也能用
- `_headers` —— HTML 短缓存（发版即生效）、静态资源长缓存、SW 绝不缓存
- 自定义域名：Cloudflare 控制台 → Workers → 你的 Worker → Settings → Domains & Routes

完整步骤见 **[DEPLOY.md](./DEPLOY.md)**。

---

## 接入自建后端（可选）

本版默认走内置演示数据。要接真实行情与 AI 分析，需要另外部署原项目的 Python 后端：

```bash
docker run -d --name panwatch -p 8000:8000 \
  -v panwatch_data:/app/data sunxiao0721/panwatch:latest
```

然后在 H5 的「设置 → 后端 API 地址」填入该地址。

**两个必须注意的点：**

1. **CORS**。浏览器直连自建后端会跨域，需在后端放开来源，或在 Workers 上加一层代理路由。
2. **Workers 跑不了这个后端**。它是 Python 应用，得放在支持 Python 的服务器上
   （VPS / 群晖 / 树莓派 / 任意容器平台）。H5 与后端是分离部署的。

数据适配层集中在 `js/data.js`：把 `RAW_ACCOUNTS` / `RAW_WATCHLIST` 这些常量
换成 `fetch(apiBase + '/api/...')` 的返回值即可，视图层不需要改动
（视图只消费 `enrich()` 之后的统一结构）。

---

## 目录结构

```
.
├── index.html              入口（含主题防闪内联脚本 + 首屏骨架）
├── sw.js                   Service Worker（必须在根目录才能拿到全站作用域）
├── _headers                Cloudflare 响应头规则（不对外提供，只被解析）
├── .assetsignore           部署排除清单（不是 wrangler 的 exclude 字段）
├── wrangler.jsonc          Workers 配置
├── design/                 交互式设计规范（独立页面，不属于应用本体）
│   ├── index.html          11 个章节：概览 / 用户与 IA / 色彩 / 字体 / 间距 /
│   │                       阴影 / 图标 / 动效 / 组件 / 页面 / 可访问性
│   ├── spec.css            规范页自己的排版层（不重复定义任何令牌）
│   └── spec.js             规范页逻辑：现算对比度、主题切换、目录、复制令牌
├── css/
│   ├── tokens.css          莫兰迪设计令牌（浅色 + 暗色 + 跟随系统）
│   ├── base.css            重置、外壳布局、顶栏底栏
│   └── components.css      指标卡 / 股票行 / 弹层 / 图表 / 表单…
├── js/
│   ├── app.js              路由、外壳、事件委托、弹层与 Toast
│   ├── store.js            状态与 localStorage 持久化
│   ├── data.js             演示数据 + 派生计算（所有数字在这里自洽）
│   ├── utils.js            格式化 / DOM / 伪随机序列
│   ├── icons.js            线性图标集（50 个）
│   ├── charts.js           手写 SVG 图表
│   ├── ui.js               共享渲染片段
│   └── views/              七个页面视图
├── public/                 manifest、图标
└── scripts/
    ├── serve.mjs           本地零依赖静态服务
    ├── check.mjs           静态自检
    ├── solve-tokens.mjs    OKLCH 反解令牌色值（改配色时用）
    ├── audit-contrast.mjs  WCAG 对比度审计 + 令牌泄漏扫描
    ├── e2e.cjs             应用端到端
    ├── e2e-design.cjs      设计规范页端到端
    ├── cdp-client.cjs      CDP 客户端
    └── gen-icons.py        生成 PWA 图标
```

---

## 免责声明

界面内所有行情、持仓、评分、AI 分析结论**均为内置演示数据**，
不来自任何真实数据源，**不构成任何投资建议**。市场有风险，决策需谨慎。

## License

MIT，与原项目一致。上游项目：[jackhuo2/PanWatch](https://github.com/jackhuo2/PanWatch)。
