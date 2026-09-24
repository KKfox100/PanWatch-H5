/* ==========================================================================
   Service Worker
   --------------------------------------------------------------------------
   策略：
   - 导航请求（HTML）→ 网络优先，离线时回落到缓存
   - 静态资源（CSS/JS/SVG）→ 缓存优先 + 后台更新（stale-while-revalidate）
   改版本号即可让所有客户端拿到新资源。
   ========================================================================== */

const VERSION = 'v1.1.0';
const CACHE = `panwatch-h5-${VERSION}`;

/* 应用外壳的路径。注意应用是哈希路由，所以外壳永远是 '/' 或 '/index.html'，
   不会出现 /portfolio 这种路径。 */
const SHELL = new URL('./index.html', self.location).pathname;
const ROOT = new URL('./', self.location).pathname;

const PRECACHE = [
  './',
  './index.html',
  './css/tokens.css',
  './css/base.css',
  './css/components.css',
  './js/app.js',
  './js/store.js',
  './js/utils.js',
  './js/icons.js',
  './js/charts.js',
  './js/ui.js',
  './js/data.js',
  './js/views/home.js',
  './js/views/portfolio.js',
  './js/views/opportunities.js',
  './js/views/paper.js',
  './js/views/alerts.js',
  './js/views/stock.js',
  './js/views/settings.js',
  './public/manifest.json',
  './public/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 只接管同源请求，跨域 API 交给浏览器
  if (url.origin !== self.location.origin) return;

  // 导航：网络优先
  if (request.mode === 'navigate') {
    // ⚠️ 只把「应用外壳」回写到固定键 SHELL，其余页面按自己的 URL 存。
    //
    // 原来的写法是不管什么导航，一律 c.put('./index.html', copy)。
    // 站点只有 index.html 时这没毛病；一旦多出 /design/index.html，
    // 用户只要打开一次设计规范页，离线外壳就被换成规范页 ——
    // 之后断网打开 / 看到的是设计规范，而不是应用。缓存被静默投毒了。
    const isShell = url.pathname === ROOT || url.pathname === SHELL;
    const cacheKey = isShell ? SHELL : request;

    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(cacheKey, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(cacheKey).then((r) => r || Response.error()))
    );
    return;
  }

  // 静态资源：缓存优先 + 后台刷新
  e.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
