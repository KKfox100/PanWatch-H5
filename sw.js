/* ==========================================================================
   Service Worker
   --------------------------------------------------------------------------
   策略：
   - 导航请求（HTML）→ 网络优先，离线时回落到缓存
   - 静态资源（CSS/JS/SVG）→ 缓存优先 + 后台更新（stale-while-revalidate）
   改版本号即可让所有客户端拿到新资源。
   ========================================================================== */

const VERSION = 'v1.0.0';
const CACHE = `panwatch-h5-${VERSION}`;

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
    e.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || Response.error()))
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
