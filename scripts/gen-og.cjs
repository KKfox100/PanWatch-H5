'use strict';

/**
 * 生成 Open Graph 分享图（1200 × 630）
 * ------------------------------------------------------------------
 *   node scripts/gen-og.cjs
 *
 * 思路：不画图，而是把 scripts/og-card.html 渲染出来截屏。
 *
 * 为什么这么做：那张卡片直接 link 应用的 css/tokens.css，用的是同一套
 * 色板、字号、阴影与圆角。改了令牌重跑一次，分享图自动跟着变 ——
 * 用画图工具做的话，分享图和界面迟早会分叉，而且没人会发现。
 *
 * 用 file:// 打开就够：卡片只需要 CSS（<link> 在 file:// 下正常解析），
 * 不需要 ES Module，所以不必先起本地服务。
 */

const path = require('path');
const fs = require('fs');
const { launch, sleep } = require('./cdp-client.cjs');

const W = 1200;
const H = 630;
const SRC = path.join(__dirname, 'og-card.html');
const OUT = path.join(__dirname, '..', 'public', 'og.png');

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error('找不到卡片源文件：' + SRC);
    process.exit(1);
  }

  // file:// 需要绝对路径，Windows 上还要把反斜杠转成正斜杠
  const url = 'file:///' + SRC.replace(/\\/g, '/');

  const b = await launch({ width: W, height: H });
  try {
    // 明确钉死视口。headless 下窗口尺寸约等于视口，但依赖这个巧合
    // 会让截图尺寸随 Chrome 版本漂移，所以显式覆盖。
    await b.send('Emulation.setDeviceMetricsOverride', {
      width: W,
      height: H,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await b.goto(url);

    // 等样式真正生效：--bg 解析出来才算数（否则截到的是无样式的裸 HTML）
    let styled = false;
    for (let i = 0; i < 60; i++) {
      const bg = await b.eval(
        `getComputedStyle(document.body).backgroundColor`
      );
      if (bg && bg !== 'rgba(0, 0, 0, 0)') { styled = true; break; }
      await sleep(100);
    }
    if (!styled) throw new Error('样式表没生效（body 背景色始终透明）');

    // 等中文字体就位。字体没加载完就截图，中文会渲染成方框 ——
    // 而这个尺寸下这种错误在缩略图里看不出来，只有点开大图才发现。
    await b.eval(`document.fonts.ready`);
    await sleep(400);

    // 尺寸自检：截图前先确认视口真的对，否则产出会静默变形
    const vp = await b.eval(`({ w: window.innerWidth, h: window.innerHeight })`);
    if (vp.w !== W || vp.h !== H) {
      throw new Error(`视口尺寸不符：期望 ${W}x${H}，实际 ${vp.w}x${vp.h}`);
    }

    await b.shot(OUT);

    const size = fs.statSync(OUT).size;
    console.log(`✅ 已生成 ${path.relative(path.join(__dirname, '..'), OUT)}`);
    console.log(`   ${W} × ${H} · ${(size / 1024).toFixed(1)} KB`);
  } finally {
    await b.close();
  }
})().catch((err) => {
  console.error('生成失败：' + (err && err.message ? err.message : err));
  process.exit(1);
});
