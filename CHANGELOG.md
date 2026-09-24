# 更新日志

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
- **`.assetsignore`** 排除非运行时文件，最终只上传 24 个资源。
  ⚠️ `assets` 配置里没有 `exclude` 字段，写在那里只会得到一句警告然后被静默忽略，
  把整个仓库（含 `.git` 提交历史）一起传到边缘
- `_headers` 处理缓存策略：HTML 短缓存（发版即生效）、静态资源长缓存、SW 绝不缓存
- `not_found_handling: single-page-application` 支持深链
- 已用 `wrangler deploy --dry-run` 验证：零配置警告，上传清单符合预期

### 工具链

- `scripts/serve.mjs` — 零依赖本地静态服务
- `scripts/check.mjs` — 静态自检：import 路径、资源引用、SW 预缓存清单双向比对、
  图标名引用、`data-act` 处理函数覆盖、`data-*` 监听属性是否存在
- `scripts/e2e.cjs` — 真实 Chrome 端到端（CDP 驱动，不装 Playwright），
  12 组共 80 项断言，含莫兰迪令牌、涨跌语义方向、对比度、数据自洽、弹层动态增删、持久化
- `scripts/gen-icons.py` — 生成 PWA 图标（4 倍超采样）

### 已知限制

- 数据全部为内置演示数据，不联网
- 无后端：真实行情与 AI 分析需自行部署上游 Python 后端并在设置里填入地址
- 模拟盘与提醒仅界面演示，不产生实际推送
