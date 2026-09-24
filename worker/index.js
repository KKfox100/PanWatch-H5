/* ==========================================================================
   PanWatch H5 · Worker 入口
   --------------------------------------------------------------------------
   只有一件事：把 /api/* 交给接口层，其余原样交给静态资源。

   路由分工靠 wrangler.jsonc 的 `assets.run_worker_first: ["/api", "/api/*"]`。
   没有那一行的话，/api/* 会先被当成「找不到的静态资源」直接返回 404.html，
   这个 Worker 根本不会被调用 —— 表现是接口全 404 而日志里一条都没有。

   下面的 `env.ASSETS.fetch` 是兜底：即使哪天路由配置被改错，
   静态站点也不会整个挂掉。
   ========================================================================== */

import { handleApi } from './api.js';

/**
 * 跨域头。
 *
 * 同源部署时用不到，但如果有人把静态站点挂在 GitHub Pages、只把接口
 * 指到这边，就需要它。这里放宽到 `*` 是安全的：鉴权走 Authorization
 * 头而不是 Cookie，所以不存在「浏览器自动带上凭据」的 CSRF 风险。
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-PanWatch-Token',
  'Access-Control-Max-Age': '86400',
};

function withCors(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS });
      }
      try {
        return withCors(await handleApi(request, env, ctx));
      } catch (err) {
        // 兜底：接口层任何未捕获的异常都变成结构化 JSON，
        // 而不是 Cloudflare 那张 HTML 错误页 —— 前端才解析得动。
        return new Response(
          JSON.stringify({
            error: 'internal_error',
            message: String((err && err.message) || err),
          }),
          { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS } }
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};
