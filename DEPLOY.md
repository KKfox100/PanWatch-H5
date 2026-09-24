# 部署指南

本项目的部署目标形态：**Cloudflare Workers + 静态资源 + D1**。
一次 `deploy` 同时上线两件事：

- **静态资源** —— 应用本体，走 Workers 的静态资源托管
- **Worker 脚本** —— `/api/*` 下的实时行情代理与 D1 读写

**只部署静态资源也完全可行。** 把 `wrangler.jsonc` 里的 `main` 与 `d1_databases`
去掉、`run_worker_first` 去掉，就退回成纯静态站，应用会自动降级到内置演示数据
（顶栏会标出「演示」）。下文标了「可选」的步骤属于后者。

---

## 一、为什么是 Workers 而不是 Pages

Cloudflare 现在有两套静态托管：Pages 和 Workers Static Assets。
Workers Static Assets 是官方主推的方向，Pages 的新功能已经收敛到 Workers 上。
本项目用 Workers：

- `wrangler.jsonc` 里的 `assets` 字段直接声明静态目录
- **同一个 Worker 里还能挂 API 与数据库** —— 这是选它而不是 Pages 的关键：
  行情接口不给跨域，写入令牌更不能出现在前端代码里，两件事都必须在服务端做
- 单次部署、单一配置、单一域名：静态资源与 API 同源，前端不需要配 CORS
- 免费额度：每天 10 万次请求，静态资源不计入 CPU 时间；
  D1 免费版每天 500 万次读、10 万次写

---

## 二、前置准备

### 1. 一个 Cloudflare 账号

免费注册即可，不需要绑卡（Workers 免费版足够本项目的量级）。

### 2. Node 18+ 与 wrangler

```bash
cd panwatch-h5
npm install          # 只装 wrangler 一个 devDependency
```

### 3. 登录 Cloudflare

```bash
npx wrangler login
```

会打开浏览器让你授权。授权后凭据存在本地，后续部署不用重复登录。

> **CI / 无浏览器环境**：改用 API Token。
> Cloudflare 控制台 → My Profile → API Tokens → Create Token →
> 模板选 **Edit Cloudflare Workers**，然后把 Token 设为环境变量：
> ```bash
> export CLOUDFLARE_API_TOKEN=你的token
> npx wrangler deploy
> ```

---

## 三、部署

### 1. 建 D1 库（可选，只要 API 就要做）

```bash
npx wrangler d1 create panwatch-db
```

输出里会给一段配置，把 `database_id` 复制到 `wrangler.jsonc`：

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "panwatch-db",
    "database_id": "<粘到这里，替换掉那串全 0 的占位>" }
]
```

⚠️ **占位 id 不会报错，只会在运行时挂。** 仓库里的
`00000000-0000-0000-0000-000000000000` 是故意留的占位值 —— 忘了替换的话
`wrangler deploy` 照样成功，直到有请求打进来才在运行时失败。

表结构不用手工执行 `migrations/0001_init.sql`：`worker/db.js` 会在首次请求时
建表（`CREATE TABLE IF NOT EXISTS`），并只在库为空时灌一次种子数据。
想手工初始化也可以：

```bash
npx wrangler d1 execute panwatch-db --remote --file=migrations/0001_init.sql
```

### 2. 设置写入令牌（可选，但强烈建议）

```bash
npx wrangler secret put WRITE_TOKEN
```

提示时输入一个随机串（例如 `openssl rand -hex 32` 的输出）。

⚠️ **不设这个 secret 等于写接口全公开。** `wrangler.jsonc` 里的
`vars.WRITE_TOKEN` 默认是空字符串，而空 = 不校验（为了本地开发方便）。
线上必须用 secret 覆盖它 —— secret 优先级高于 `vars`。
设好之后 `PUT /api/portfolio` 这类接口要求
`Authorization: Bearer <token>`，没有就是 401。

**这个模型的边界要说清楚**：它是「单租户、无登录」。前端把令牌存在
localStorage 里，**能打开页面的人就能读到它**，所以它防的是「陌生人扫到你的
域名顺手改你的持仓」，不是防「拿到你浏览器的人」。要多人隔离就得自己加登录。

### 3. 部署

```bash
npx wrangler deploy
```

首次部署会提示创建 Worker，确认即可。成功后输出形如：

```
Uploaded panwatch-h5 (1.24 sec)
Deployed panwatch-h5 triggers (0.31 sec)
  https://panwatch-h5.<你的子域>.workers.dev
```

打开这个地址就能用了。

### 改名字

`wrangler.jsonc` 里的 `name` 决定 Worker 名和 `*.workers.dev` 子域前缀：

```jsonc
{ "name": "panwatch-h5" }
```

改成别的名字后重新 `deploy` 会创建一个**新的** Worker，
旧的那个不会自动删除，需要到控制台手动清理。
D1 库不跟着改名走，`database_id` 是独立标识，不用改。

### 本地预览（行为与线上一致）

```bash
npm run dev -- --persist-to "C:/Temp/panwatch-state"
```

默认端口 8787。`wrangler dev` 会按线上同样的规则处理 `_headers`、404 行为、
`/api/*` 路由和 D1，所以它是比 `python -m http.server` 更可靠的预检 ——
后者既不会跑 Worker，也不会处理 `_headers`。

> ⚠️ **本地开发一定要加 `--persist-to`，把状态目录挪出项目根。**
>
> 默认状态目录是 `.wrangler/state`，就在项目根下；而
> `assets.directory: "."` 让 `wrangler dev` 的文件监听覆盖**整个项目根**。
> 于是：D1 每写一次 → 触发重载 → 重载又写状态文件 → 再触发重载……
> 每秒重载几十次，请求全被丢在间隙里。
>
> 症状很有迷惑性：**所有请求超时（curl exit 28）**，而日志里只有一行行
> `Reloading local server`，看起来像是网络问题或代码死循环。接口、静态页
> 全都打不开，很难联想到是文件监听自激。
>
> 注意 `.assetsignore` **管不了这件事** —— 它只影响上传清单，不影响 dev 的文件监听。
>
> ```bash
> npm run dev -- --persist-to "C:/Temp/panwatch-state"     # Windows
> npm run dev -- --persist-to "/tmp/panwatch-state"        # macOS / Linux
> ```
>
> 想顺带设一个本地令牌，再加 `--var WRITE_TOKEN:testtoken`。

---

## 四、只部署静态资源（不用 API）

不需要实时行情与持久化时，把 `wrangler.jsonc` 精简成：

```jsonc
{
  "name": "panwatch-h5",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": ".",
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page"
  },
  "observability": { "enabled": true }
}
```

同时从 `.assetsignore` 里删掉 `worker/`、`migrations/` 两行（不删也无害，
只是它们本来就不会被引用），`worker/` 与 `migrations/` 目录可以整个删掉。

应用启动时探测 `/api/health` 会失败，然后**静默退回内置演示数据** ——
不抛异常、不显示错误页、不清空已有数据，行为与改造前完全一致。
顶栏的数据源标识会显示灰色的「演示」，鼠标悬停能看到原因。
这是刻意设计的两条硬约束：

- **没有后端时，站点必须和改造前一模一样地工作**
- **顶栏始终标出当前数据是「实时」还是「演示」** —— 这两种数据长得一模一样，
  不标出来就等于在误导

---

## 五、已配置好的部署细节

这些都在仓库里了，列出来是为了改的时候知道自己在改什么。

### `wrangler.jsonc`

```jsonc
{
  "name": "panwatch-h5",
  "compatibility_date": "2026-09-01",
  "main": "worker/index.js",                           // API + D1（可选）
  "assets": {
    "directory": ".",                                  // 项目根即站点根
    "binding": "ASSETS",                               // Worker 里转发静态资源用
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "404-page",                  // 未知路径返回真 404
    "run_worker_first": ["/api", "/api/*"]             // 见下，少一行接口就全 404
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "panwatch-db", "database_id": "<建库后填>" }
  ],
  "observability": { "enabled": true },
  "vars": { "QUOTE_TTL": "15", "WRITE_TOKEN": "" }
}
```

- **`directory: "."`** —— `index.html` 在根目录，站点根直接对外，路径最干净
- **`not_found_handling: "404-page"`** —— 未知路径返回 `404.html` 的内容
  与**真实的 404 状态码**。

  ⚠️ **不要改成 `"single-page-application"`。** 本项目是哈希路由，真实 URL
  只有 `/` 和 `/design/index.html`，`#` 后面的内容根本不会发给服务器 ——
  SPA 回退在这里没有任何用处，只会让任意乱输的路径都返回 200 + 首页内容。
  搜索引擎会把它们当成无限多份重复页面收录，也就是**软 404（soft 404）**。

  这个坑很隐蔽：站点看着一切正常，只是搜索结果的质量在慢慢被稀释。
  同理，`scripts/serve.mjs` 也**不做** SPA 回退 —— 本地行为必须与线上一致，
  否则这类问题在开发阶段永远发现不了。

- **`run_worker_first: ["/api", "/api/*"]`** —— 这行是「接口全部 404」的元凶。
  不写它，`/api/*` 会先被当成一个找不到的静态资源，直接返回 `404.html`，
  **Worker 根本不会被调用**。

  ⚠️ 这个故障最难查的地方是**它没有任何日志**：请求确实到了边缘，但没进
  Worker，所以 `wrangler tail` 和 `observability` 里一条记录都没有。
  你会以为是路由写错了、binding 名字错了，或者 dev 环境的问题。

  为什么写两条：`/api/*` 的 glob **不匹配裸路径 `/api` 本身**，两个都要列。
  另外 `binding: "ASSETS"` 也不能省 —— 静态资源没被 `run_worker_first`
  截获时仍然由平台直接返回，但 Worker 里要主动 `env.ASSETS.fetch()` 转发
  （本项目在 `worker/index.js` 里这么做，这样 CORS 头能统一加）。

> ⚠️ **`assets` 里没有 `exclude` 字段。** 写成
> ```jsonc
> "assets": { "directory": ".", "exclude": ["scripts/**"] }   // ✗ 无效
> ```
> wrangler 只会打印一句 `Unexpected fields found in assets field: "exclude"`，
> 然后**照样把整个仓库传上去 —— 包括 `.git` 里的提交历史**。
> 排除文件要用根目录的 `.assetsignore`（见下）。

### `.assetsignore`

放在静态资源目录的根（本项目即项目根），语法与 `.gitignore` 相同。
wrangler 会跳过匹配的文件。

```
.git/                 # 不写这行，提交历史会被公开
node_modules/
.wrangler/
scripts/              # 工具链不上线
wrangler.jsonc
package.json
docs/
*.md
LICENSE
worker/               # 服务端代码，跑在 Worker 里，不该作为静态资源对外
migrations/
```

`worker/` 与 `migrations/` 这两行不影响 Worker 的运行 ——
`main` 指向的模块由 wrangler 打包进 Worker bundle，与静态资源清单无关。
它们只是防止 `.js` 源码被当成静态文件挂到公网。

排除后真正上边缘的运行时文件分四组：

- **应用本体 28 个**：`index.html`、`404.html`、`sw.js`、`css/*`（3 个）、
  `js/*`（9 个，含新增的 `api.js` / `live.js` / `symbols.js`）、
  `js/views/*`（7 个）、`public/*`（6 个）。
- **抓取资产 4 个**：`robots.txt`、`sitemap.xml`、`llms.txt`、`llms-full.txt`
  （作用见 README 的「SEO 与 LLMO」一节）。
- **设计规范页 3 个**：`design/index.html`、`design/spec.css`、`design/spec.js`。
- **`_headers`** 不计入：它**不会作为静态资源对外提供** —— wrangler 内置
  就把它排除了（连同 `_redirects`），因为它的用途是被解析成响应头规则。

`design/` 是**故意不排除**的 —— 它是交付物的一部分，上线后
`https://<你的域名>/design/index.html` 可以直接分享给别人看设计规范。
它能独立工作，是因为它复用了应用自己的 `css/*` 和 `js/*`（都在上面那 28 个里），
页面里没有自己的副本。不想公开的话，在 `.assetsignore` 里加一行 `design/` 即可。

**验证排除是否真的生效**（这一步很关键，因为默认输出会误导你）：

```bash
WRANGLER_LOG=debug npx wrangler deploy --dry-run 2>&1 | grep "Ignoring asset:"
```

⚠️ 部署日志里的 `✨ Read 233 files from the assets directory` 是**过滤前**的
计数 —— 看起来像是 `.assetsignore` 完全没生效，其实它只是日志位置的问题。
真正被排除的文件记在 debug 级别。别被那个数字骗了。

### `_headers`

Cloudflare 的静态资源托管会读根目录的 `_headers` 文件（语法与 Pages 一致）。
注意它**不会**作为静态资源对外提供 —— wrangler 内置就把它排除了
（连同 `_redirects`），因为它的用途是被解析成响应头规则。

| 路径 | 策略 | 原因 |
|---|---|---|
| 全局 | `Content-Language: zh-CN` | 站点是简体中文，显式声明省得抓取器猜 |
| `/index.html` | `max-age=0, must-revalidate` | **发版必须立刻生效**，否则用户拿到旧 HTML 配新 JS 会白屏 |
| `/404.html` | `max-age=0, must-revalidate` + `X-Robots-Tag: noindex` | 404 页不该被收录，也不该被缓存。注意 `_headers` 按**请求路径**匹配，而 404 页是被任意路径触发返回的 —— 这条规则只覆盖「直接访问 `/404.html`」，真正的保证是页面里的 `<meta name="robots">` 与 HTTP 404 状态码本身 |
| `/css/*`、`/js/*`、`/public/*` | `max-age=604800` | 静态资源内容稳定，长缓存省流量 |
| `/sw.js` | `max-age=0, must-revalidate` | **Service Worker 绝不能被缓存**，否则永远更新不了 |
| `/robots.txt`、`/sitemap.xml`、`/llms.txt`、`/llms-full.txt` | 钉死 `Content-Type`，`max-age=3600` | 抓取器拿到 `text/html` 的 `robots.txt` 会**静默忽略整份文件** —— 没有任何报错，只是那些规则不再生效 |

⚠️ **`_headers` 管不到 `/api/*`。** 它只作用于静态资源的响应；
Worker 返回的响应由 Worker 自己设头。本项目在 `worker/api.js` 里统一加了
`Cache-Control: no-store` —— 这一条**不能省**：行情响应带 TTL 语义，
一旦被中间层缓存住，价格就会停在某个时刻，而页面看起来一切正常。
（前端 Service Worker 那边也有一道防线：`sw.js` 里 `/api/*` 直接放行、
不经过 cache-first 分支。原因同样是这个 —— `/api/quotes` 恰好是同源 GET、
状态 200、`type: basic`，四个条件全中缓存分支，写进去之后用户看到的价格
永远停在第一次拉取的那一刻，且**页面上没有任何地方看得出哪里坏了**。）

Cloudflare 对静态资源的默认缓存策略已经是 `public, max-age=0, must-revalidate`
（每次都带 `ETag` 回源校验），所以 `_headers` 的作用主要是**放宽**静态资源的
缓存、以及补上安全响应头。

另外统一加了 `X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、
`Referrer-Policy`、`Permissions-Policy` 和 HSTS。

> 如果你的 JS 文件名带内容哈希（本项目没有构建步骤，所以不带），
> 可以把 `max-age` 提到一年并加 `immutable`。
> 限制：最多 100 条规则，每条规则单行上限 2000 字符。

### Service Worker 的位置

`sw.js` **必须在项目根目录**。

Service Worker 的默认作用域是「脚本所在目录」。放在 `public/sw.js` 下会有两个后果：
作用域被限死在 `/public/*`（控制不到页面），
而且 `navigator.serviceWorker.register('./sw.js')` 会解析到 `/sw.js` 直接 404。

---

## 六、绑定自定义域名

1. 把域名接入 Cloudflare（Nameserver 改到 Cloudflare）
2. 控制台 → **Workers & Pages** → 选中 `panwatch-h5`
3. **Settings** → **Domains & Routes** → **Add** → **Custom Domain**
4. 填 `panwatch.你的域名.com`，Cloudflare 会自动配好 DNS 和证书

自定义域名下 Worker 依然可用，`_headers` 规则同样生效。

---

## 七、更新与回滚

### 更新

改完代码直接：

```bash
npx wrangler deploy
```

Workers 是**原子替换**，新版本瞬间全量生效，没有滚动发布的中间态。

⚠️ 但因为 Service Worker 的存在，**老用户可能需要刷新两次**：
第一次刷新时旧的 SW 还在控制页面，它在后台拉新资源；
第二次刷新才由新 SW 接管。想立刻生效可以在浏览器里
DevTools → Application → Service Workers → Unregister。

发新版时记得把 `sw.js` 里的 `VERSION` 加一位，
这样 `activate` 钩子会清掉旧缓存：

```js
const VERSION = 'v1.2.0';   // 改这里
```

⚠️ 改前端代码时**一定要动这个版本号**。改了 `js/*.js` 却不改 `VERSION`，
新 HTML 配旧 JS 会直接白屏 —— 而且因为 SW 的 cache-first 策略，
用户刷新也修不好，只能清缓存。

### 数据库结构变更

`worker/db.js` 用的是 `CREATE TABLE IF NOT EXISTS`，**不会**改动已存在的表。
所以给表加列时必须手工执行：

```bash
npx wrangler d1 execute panwatch-db --remote --file=migrations/0002_xxx.sql
```

⚠️ **回滚 Worker 版本不会回滚数据库。** 新版本加了一列、回滚到旧版本之后，
旧代码面对多出来的那一列通常还能跑（SQLite 不在乎），但如果新版本**删了或改了**
列，回滚就会直接失败。改结构前先导一份：

```bash
npx wrangler d1 export panwatch-db --remote --output=backup.sql
```

本地那份（`.wrangler/state` 或 `--persist-to` 指到的目录）是**独立的**，
与线上完全无关 —— 本地跑通不代表线上有数据。

### 回滚

控制台 → Workers → `panwatch-h5` → **Deployments** →
找到上一个版本 → **Rollback**。

或命令行：

```bash
npx wrangler deployments list
npx wrangler rollback [deployment-id]
```

---

## 八、验证部署结果

部署完建议跑一遍这几项：

```bash
# 1. 首页 200，且返回的是 HTML
curl -sI https://panwatch-h5.<子域>.workers.dev/ | head -5

# 2. 静态资源 200 且 MIME 正确（必须是 text/javascript，不是 text/plain）
curl -sI https://panwatch-h5.<子域>.workers.dev/js/app.js | grep -i content-type

# 3. 响应头生效
curl -sI https://panwatch-h5.<子域>.workers.dev/index.html | grep -i cache-control

# 4. 未知路径必须返回真 404（不是 200 + 首页）
#    如果这里是 200，说明 not_found_handling 又被改回了 SPA 回退，会造软 404
curl -sI https://panwatch-h5.<子域>.workers.dev/anything-not-exist | head -3

# 5. 抓取资产可达，且 MIME 正确
for p in robots.txt sitemap.xml llms.txt llms-full.txt; do
  curl -s -o /dev/null -w "$p  %{http_code}  %{content_type}\n" \
    https://panwatch-h5.<子域>.workers.dev/$p
done

# 6. 无 JS 回退内容确实在页面里（这是语言模型唯一能看到的东西）
curl -s https://panwatch-h5.<子域>.workers.dev/ | grep -c "nojs__badge"

# 7. 接口活着（只有配了后端才该是 200；纯静态部署下这里必然 404，属预期）
curl -s https://panwatch-h5.<子域>.workers.dev/api/health
#    期望：{"ok":true,"version":"...","database":"ok","writeProtected":true,...}

# 8. 行情真的通到上游了（不是缓存里的空壳）
curl -s "https://panwatch-h5.<子域>.workers.dev/api/quotes?symbols=sh600519,sh000001"
#    期望：missing:0，且 600519 是千元级、000001 是三千点级（见下方「指数」一条）

# 9. 写接口确实被挡住（没设 token 的话这条会是 200，那就该去设 secret 了）
curl -s -o /dev/null -w "%{http_code}\n" -X PUT \
  -H "Content-Type: application/json" -d '{"positions":[]}' \
  https://panwatch-h5.<子域>.workers.dev/api/portfolio
#    期望：401

# 10. 接口响应头不能被缓存
curl -sI "https://panwatch-h5.<子域>.workers.dev/api/quotes?symbols=sh600519" | grep -i cache-control
#    期望：no-store
```

第 4 项和第 6 项是最容易在部署后被无声破坏的两项：前者一改配置就退化成软 404，
后者只要有人「顺手清理」一下 `<noscript>` 就会让站点在语言模型眼里变成空白。

第 7～10 项则对应另一类故障 —— **接口挂了但界面看起来完全正常**。
前端的降级逻辑会把任何后端问题都当成「没有后端」，安静地退回内置演示数据。
这是刻意的（没后端时站点必须照常可用），但代价是**部署出错时不会有任何报错**。
所以判断标准只有一个：**打开页面，看顶栏的数据源标识**。
写着「实时」才是真的接通了；写着「演示」就是没连上，不管接口看起来多正常。

浏览器里再确认：控制台无报错、顶栏数据源标识是「实时」（不是「演示」）、
DevTools → Application → Manifest 能读到、Service Worker 状态为 activated、
切到手机模拟器布局正常。
再把浏览器 JavaScript 关掉刷新一次 —— 应该看到一篇完整的说明文章，
而不是一个永远转不完的骨架屏。

---

## 九、常见问题

**部署后样式全丢，页面是白底黑字**
CSS 没加载。检查 `curl -I .../css/tokens.css` 是否 200。
多半是 `assets.exclude` 里的 glob 写得太宽，把 `css/` 或 `js/` 也排除了。

**控制台报 `Failed to load module script: MIME type`**
JS 的 Content-Type 不对。Workers 按扩展名推断，`.js` 应该是 `text/javascript`。
如果用了非常规扩展名（如 `.mjs` 放错位置），需要显式处理。

**改了代码部署了，浏览器还是旧的**
Service Worker 缓存。DevTools → Application → Service Workers → 勾选
"Update on reload"，或点 Unregister 后强刷。

**`wrangler deploy` 报 10021 / authentication error**
登录态过期。重新 `npx wrangler login`，或检查 `CLOUDFLARE_API_TOKEN` 是否有
`Workers Scripts: Edit` 权限。

**部署成功了，但接口全部 404，`wrangler tail` 里一条日志都没有**
`assets.run_worker_first` 少了，或者漏了裸路径 `/api`。
没有它 `/api/*` 会被当成找不到的静态资源直接返回 `404.html`，
**请求根本没进 Worker**，所以日志为空。两条都要写：

```jsonc
"run_worker_first": ["/api", "/api/*"]
```

**接口 200，但页面顶栏写着「演示」，价格一直不动**
说明前端没接上后端。按顺序查：

1. 页面是不是用 `https://` 打开的、域名和接口同一个（同源）？
2. DevTools → Network 里 `/api/health` 的返回是不是 `ok:true`？
3. **Service Worker 缓存**：DevTools → Application → Service Workers → Unregister
   后强刷。旧版 `sw.js` 会把 `/api/quotes` 当静态资源缓存住（同源 GET + 200
   正好命中 cache-first 分支），价格就永远停在第一次拉取的那一刻。
   新版已在 `sw.js` 里对 `/api/*` 直接放行，但如果浏览器还挂着旧 SW，
   问题依旧。顺手把 `sw.js` 的 `VERSION` 加一位再部署。
4. 顶栏标识上鼠标悬停会给出原因（「未连接后端」/「行情不可用」/「连接已断开」），
   设置页 → 实时状态卡里还有更细的字段。

**接口 200 但 `missing` 不为 0，某几只股票没价格**
上游对停牌股、退市股、代码写错的股会返回价格 0。适配器会把
`price <= 0` 的记录直接丢掉（返回 0 而不是报错，才是更危险的），
所以表现为 `missing` 计数上升。用
`curl ".../api/quotes?symbols=<那只股>"` 单独确认。

**指数价格看起来对，但其实是另一只股票**
A 股代码 `000001` 既可能是上证指数（`sh000001`）也可能是平安银行（`sz000001`）。
按「首位判交易所」的规则推会把指数推成平安银行 —— **不报错，只是数字悄悄换了含义**。
所以指数代码在上游 symbol 映射表里是**写死**的（`js/symbols.js` 的 `INDEX_SYMBOLS`）。
判断方法：上证指数是三千点级，平安银行是十元级。标普 500 的上游代码是
`usINX`（不是 `usSPX`），同样写死。

**A 股成交量/成交额差了 100 倍或 10000 倍**
上游单位不统一：A 股的成交量是「手」（要 ×100 才等于股）、成交额是「万元」
（要 ×10000 才等于元）；港股和美股则直接是「股」和「元」。
`worker/quotes.js` 里按市场分别换算，改这块时别把两条分支写反。

**本地 `wrangler dev` 所有请求都超时，日志里只有 `Reloading local server`**
状态目录在项目根，文件监听自激重载。加 `--persist-to` 把状态挪出去，
见「三、部署 → 本地预览」。

**`wrangler deploy` 成功，但一访问接口就 500 / 报 D1 错误**
`wrangler.jsonc` 里的 `database_id` 还是那串全 0 的占位值。
执行 `npx wrangler d1 create panwatch-db` 并把真实 id 填进去。

**想部署到子路径（如 `example.com/panwatch/`）**
Workers 的静态资源挂在域名根，不支持子路径挂载。
要么用子域名（推荐），要么在 Workers 前面加一层路由规则改写。

---

## 十、其他部署方式

**要保留实时行情与持久化，基本只有 Cloudflare 一条路**（或用别的
Workers 兼容运行时）。原因不是绑定，而是 D1 与静态资源同源带来的两点便利：
接口不用配 CORS、部署只有一步。想搬走的话，`worker/` 是标准 ESM，
D1 那层换掉 `worker/db.js` 即可（它只用了 `env.DB.prepare(...).bind(...).run()`
这一小组 API）。

**只部署静态资源的话，纯静态站到处都是家**：

| 平台 | 命令 / 方式 |
|---|---|
| Vercel | `npx vercel deploy`，框架选 Other |
| Netlify | 拖拽整个目录到 Netlify Drop |
| GitHub Pages | 推到仓库，Settings → Pages → 选分支根目录 |
| 自建 Nginx | `cp -r . /var/www/panwatch-h5`。**别配 SPA 回落**（会造软 404，理由见「五」），配好 MIME，并让未知路径真的返回 404 状态码 |

⚠️ 这些平台**不会**跑 `worker/`，所以没有 `/api/*` ——
应用会自动降级到内置演示数据，顶栏标「演示」。
如果希望静态托管上也有行情，需要另找一台能跑 Node 的机器部署 `worker/`，
再在设置页 → 「后端地址与令牌」里填入它的完整地址（前端支持跨源后端，
此时那个后端要自己处理 CORS 与 token 校验）。

除了 Cloudflare 之外的平台也不认 `_headers` 文件，
需要把缓存策略改写到对应平台的配置里（`vercel.json` / `netlify.toml` / nginx.conf）。
