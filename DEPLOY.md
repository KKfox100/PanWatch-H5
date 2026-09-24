# 部署指南

本项目的部署目标形态：**Cloudflare Workers + 静态资源托管**。
全站是纯静态文件，没有服务端逻辑，所以 Workers 只负责把资源从全球边缘节点发出去。

---

## 一、为什么是 Workers 而不是 Pages

Cloudflare 现在有两套静态托管：Pages 和 Workers Static Assets。
Workers Static Assets 是官方主推的方向，Pages 的新功能已经收敛到 Workers 上。
本项目用 Workers：

- `wrangler.jsonc` 里的 `assets` 字段直接声明静态目录，**不需要写 Worker 脚本**
- 单次部署、单一配置、单一域名
- 免费额度：每天 10 万次请求，静态资源不计入 CPU 时间

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

### 本地预览（行为与线上一致）

```bash
npm run dev      # → http://127.0.0.1:8787
```

`wrangler dev` 会按线上同样的规则处理 `_headers`、SPA 回落和资源路径，
所以它是比 `python -m http.server` 更可靠的预检。

---

## 四、已配置好的部署细节

这些都在仓库里了，列出来是为了改的时候知道自己在改什么。

### `wrangler.jsonc`

```jsonc
{
  "name": "panwatch-h5",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": ".",                                  // 项目根即站点根
    "html_handling": "auto-trailing-slash",
    "not_found_handling": "single-page-application"    // 深链回落
  },
  "observability": { "enabled": true }
}
```

- **`directory: "."`** —— `index.html` 在根目录，站点根直接对外，路径最干净
- **`not_found_handling: "single-page-application"`** ——
  哈希路由其实不需要它（`#/portfolio` 的 `#` 后面不会发给服务器），
  但加上它可以兜住将来改成 history 路由的情况，以及用户手抖输错路径

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
```

排除后真正上边缘的只有 24 个运行时文件：`index.html`、`sw.js`、
`css/*`（3 个）、`js/*`（7 个）、`js/views/*`（7 个）、`public/*`（5 个）。

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
| `/index.html` | `max-age=0, must-revalidate` | **发版必须立刻生效**，否则用户拿到旧 HTML 配新 JS 会白屏 |
| `/css/*`、`/js/*`、`/public/*` | `max-age=604800` | 静态资源内容稳定，长缓存省流量 |
| `/sw.js` | `max-age=0, must-revalidate` | **Service Worker 绝不能被缓存**，否则永远更新不了 |

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

## 五、绑定自定义域名

1. 把域名接入 Cloudflare（Nameserver 改到 Cloudflare）
2. 控制台 → **Workers & Pages** → 选中 `panwatch-h5`
3. **Settings** → **Domains & Routes** → **Add** → **Custom Domain**
4. 填 `panwatch.你的域名.com`，Cloudflare 会自动配好 DNS 和证书

自定义域名下 Worker 依然可用，`_headers` 规则同样生效。

---

## 六、更新与回滚

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
const VERSION = 'v1.0.1';   // 改这里
```

### 回滚

控制台 → Workers → `panwatch-h5` → **Deployments** →
找到上一个版本 → **Rollback**。

或命令行：

```bash
npx wrangler deployments list
npx wrangler rollback [deployment-id]
```

---

## 七、验证部署结果

部署完建议跑一遍这几项：

```bash
# 1. 首页 200，且返回的是 HTML
curl -sI https://panwatch-h5.<子域>.workers.dev/ | head -5

# 2. 静态资源 200 且 MIME 正确（必须是 text/javascript，不是 text/plain）
curl -sI https://panwatch-h5.<子域>.workers.dev/js/app.js | grep -i content-type

# 3. 响应头生效
curl -sI https://panwatch-h5.<子域>.workers.dev/index.html | grep -i cache-control

# 4. 深链能开（应返回 200 而不是 404）
curl -sI https://panwatch-h5.<子域>.workers.dev/anything-not-exist | head -3
```

浏览器里再确认：控制台无报错、DevTools → Application → Manifest 能读到、
Service Worker 状态为 activated、切到手机模拟器布局正常。

---

## 八、常见问题

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

**想部署到子路径（如 `example.com/panwatch/`）**
Workers 的静态资源挂在域名根，不支持子路径挂载。
要么用子域名（推荐），要么在 Workers 前面加一层路由规则改写。

---

## 九、其他部署方式

不想用 Cloudflare 也行，纯静态站到处都是家：

| 平台 | 命令 / 方式 |
|---|---|
| Vercel | `npx vercel deploy`，框架选 Other |
| Netlify | 拖拽整个目录到 Netlify Drop |
| GitHub Pages | 推到仓库，Settings → Pages → 选分支根目录 |
| 自建 Nginx | `cp -r . /var/www/panwatch-h5`，注意配 SPA 回落和 MIME |

除了 Cloudflare 之外的平台不认 `_headers` 文件，
需要把缓存策略改写到对应平台的配置里（`vercel.json` / `netlify.toml` / nginx.conf）。
