/* ==========================================================================
   图标集：统一 1.7 描边的线性风格，尺寸由 CSS 控制
   ========================================================================== */

const S = (path, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}${extra}</svg>`;

export const icons = {
  /* ---- 导航 ---- */
  home: S('<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20a1 1 0 0 0 1 1h3.2v-5.4h4.6V21h3.2a1 1 0 0 0 1-1V9.5"/>'),
  wallet: S('<path d="M3 8.5A2.5 2.5 0 0 1 5.5 6H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5v-8Z"/><path d="M3 9.5h13.5a1.5 1.5 0 0 1 0 3H17"/><circle cx="17.6" cy="11" r=".9" fill="currentColor" stroke="none"/>'),
  spark: S('<path d="M12 3.2l1.9 4.9 4.9 1.9-4.9 1.9L12 16.8l-1.9-4.9L5.2 10l4.9-1.9L12 3.2Z"/><path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z"/>'),
  chart: S('<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15.5V11"/><path d="M12 15.5V7.5"/><path d="M16 15.5v-6"/>'),
  bell: S('<path d="M18 8.6a6 6 0 1 0-12 0c0 5-2 6.4-2 6.4h16s-2-1.4-2-6.4Z"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/>'),
  gear: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 6.3 19.4l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.6 13.7H3.5a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 6.3l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 10.3 3.6V3.5a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.87 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 20.4 10.3h.1a2 2 0 1 1 0 4h-.1Z"/>'),

  /* ---- 动作 ---- */
  plus: S('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  minus: S('<path d="M5 12h14"/>'),
  close: S('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>'),
  refresh: S('<path d="M20.5 12a8.5 8.5 0 1 1-2.5-6"/><path d="M20.5 4.5V10h-5.4"/>'),
  chevronRight: S('<path d="M9 5.5 15.5 12 9 18.5"/>'),
  chevronLeft: S('<path d="M15 5.5 8.5 12 15 18.5"/>'),
  arrowUp: S('<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>'),
  arrowDown: S('<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>'),
  trendUp: S('<path d="M3.5 16.5 9 11l3.5 3.5L20.5 6.5"/><path d="M15.5 6.5h5v5"/>'),
  trendDown: S('<path d="M3.5 7.5 9 13l3.5-3.5 8-8"/><path d="M15.5 17.5h5v-5"/>'),
  check: S('<path d="M5 12.5 10 17.5 19.5 7"/>'),
  search: S('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
  filter: S('<path d="M4 6h16"/><path d="M7 12h10"/><path d="M10 18h4"/>'),
  trash: S('<path d="M4.5 7h15"/><path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7"/><path d="M6.5 7l.8 12.1A1.9 1.9 0 0 0 9.2 21h5.6a1.9 1.9 0 0 0 1.9-1.9L17.5 7"/>'),
  edit: S('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M14.5 6.5 17.5 9.5"/>'),
  eye: S('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
  moon: S('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>'),
  sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>'),
  logout: S('<path d="M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3"/><path d="M15.5 8.5 19 12l-3.5 3.5"/><path d="M19 12H9"/>'),
  external: S('<path d="M14 4h6v6"/><path d="M20 4l-8.5 8.5"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>'),
  share: S('<circle cx="17.5" cy="6" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="M8.8 10.8l6.4-3.6M8.8 13.2l6.4 3.6"/>'),
  download: S('<path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>'),
  upload: S('<path d="M12 16V5"/><path d="M7.5 9.5 12 5l4.5 4.5"/><path d="M4.5 19.5h15"/>'),
  key: S('<circle cx="8" cy="15.5" r="3.5"/><path d="M10.6 13 20 3.6"/><path d="M17 6.6l2 2"/><path d="M14.5 9.1l2 2"/>'),
  shield: S('<path d="M12 3.5 5 6.2v5.1c0 4.2 2.9 7.6 7 8.7 4.1-1.1 7-4.5 7-8.7V6.2L12 3.5Z"/><path d="M9 12l2 2 4-4"/>'),
  server: S('<rect x="3.5" y="4" width="17" height="6.5" rx="1.6"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.6"/><path d="M7 7.2h.01M7 16.8h.01"/>'),
  wifi: S('<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M6 12.4a9 9 0 0 1 12 0"/><path d="M9.4 15.8a4 4 0 0 1 5.2 0"/><circle cx="12" cy="19.2" r="1" fill="currentColor" stroke="none"/>'),

  /* ---- 业务 ---- */
  brain: S('<path d="M9.5 4.5A3 3 0 0 0 6.5 7.5a2.8 2.8 0 0 0-1.6 5 2.9 2.9 0 0 0 1.9 4.7A3 3 0 0 0 12 19V5.5a1 1 0 0 0-1-1h-1.5Z"/><path d="M14.5 4.5a3 3 0 0 1 3 3 2.8 2.8 0 0 1 1.6 5 2.9 2.9 0 0 1-1.9 4.7A3 3 0 0 1 12 19"/>'),
  book: S('<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11a2 2 0 0 1 2 2v13a1.6 1.6 0 0 0-1.6-1.6H4V5.5Z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13a2 2 0 0 0-2 2v13a1.6 1.6 0 0 1 1.6-1.6H20V5.5Z"/>'),
  bank: S('<path d="M3.5 9.5 12 4.5l8.5 5"/><path d="M5.5 9.5v8M9.5 9.5v8M14.5 9.5v8M18.5 9.5v8"/><path d="M3 20h18"/>'),
  clock: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  target: S('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r=".8" fill="currentColor" stroke="none"/>'),
  flame: S('<path d="M12 3s4.5 4 4.5 8a4.5 4.5 0 1 1-9 0c0-1.3.5-2.4 1.2-3.3 0 0 .6 1.4 1.8 1.4 1.4 0 1.5-2.4 1.5-6.1Z"/>'),
  droplet: S('<path d="M12 3.5s5.5 6 5.5 10a5.5 5.5 0 1 1-11 0c0-4 5.5-10 5.5-10Z"/>'),
  layers: S('<path d="M12 3.5 3.5 8 12 12.5 20.5 8 12 3.5Z"/><path d="M3.5 12.5 12 17l8.5-4.5"/><path d="M3.5 16.5 12 21l8.5-4.5"/>'),
  cpu: S('<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><path d="M10 3.5v3M14 3.5v3M10 17.5v3M14 17.5v3M3.5 10h3M3.5 14h3M17.5 10h3M17.5 14h3"/>'),
  info: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>'),
  warn: S('<path d="M12 4.5 21 19.5H3L12 4.5Z"/><path d="M12 10v4"/><circle cx="12" cy="16.8" r=".9" fill="currentColor" stroke="none"/>'),
  send: S('<path d="M20.5 3.5 3.5 10.5l6.8 2.7 2.7 6.8 7.5-16.5Z"/><path d="M10.3 13.2 20.5 3.5"/>'),
  telegram: S('<path d="M20.5 4.5 2.8 11.3l5 1.7 1.9 5.6 2.9-3.3 4.2 3.2 3.7-14Z"/>'),
  wechat: S('<path d="M9 4.5c-3.6 0-6.5 2.2-6.5 5 0 1.6.9 3 2.3 3.9l-.6 2 2.3-1.2c.8.2 1.6.4 2.5.4h.6"/><path d="M15 9.5c3 0 5.5 1.9 5.5 4.3 0 1.4-.8 2.6-2 3.4l.5 1.8-2-1c-.6.2-1.3.3-2 .3-3 0-5.5-1.9-5.5-4.3S12 9.5 15 9.5Z"/>'),
  dingtalk: S('<path d="M12 3.5 4 12l3.5 3.5L12 20.5l8-8.5-3.5-3.5L12 3.5Z"/><path d="M9 12h6"/>'),
  bark: S('<path d="M6 9.5a6 6 0 0 1 12 0v3l1.5 3H4.5L6 12.5v-3Z"/><path d="M10 18.5a2 2 0 0 0 4 0"/>'),
  webhook: S('<circle cx="12" cy="7" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><circle cx="18" cy="17.5" r="2.5"/><path d="M10.6 9 7.4 15.4M13.4 9l3.2 6.4M8.5 17.5h7"/>'),
  news: S('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M7 9h6M7 12.5h10M7 16h7"/>'),
  calendar: S('<rect x="3.5" y="5.5" width="17" height="15" rx="2"/><path d="M3.5 10h17"/><path d="M8 3.5v4M16 3.5v4"/>'),
  pie: S('<path d="M12 3.5V12l7.4 4.3A8.5 8.5 0 1 0 12 3.5Z"/>'),
  activity: S('<path d="M3 12h4l2.5-6 4 12L16 12h5"/>'),
  lock: S('<rect x="4.5" y="10" width="15" height="10.5" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>'),
  globe: S('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.6 3.6 5.4 3.6 8.5S14.4 18.4 12 20.5c-2.4-2.1-3.6-5.4-3.6-8.5S9.6 6.1 12 3.5Z"/>'),
  palette: S('<path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-.9 2-1.8 0-1.5-1.4-1.7-1.4-2.8 0-.8.7-1.4 1.6-1.4h1.6a4.7 4.7 0 0 0 4.7-4.7c0-3.5-3.8-6.3-8.5-6.3Z"/><circle cx="8" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1" fill="currentColor" stroke="none"/>'),
  file: S('<path d="M13.5 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-5.5-5.5Z"/><path d="M13.5 3.5V9H19"/>'),
  play: S('<path d="M7 5.5 18 12 7 18.5v-13Z"/>'),
  pause: S('<rect x="7" y="5.5" width="3.5" height="13" rx="1"/><rect x="13.5" y="5.5" width="3.5" height="13" rx="1"/>'),
  user: S('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
  robot: S('<rect x="4.5" y="8" width="15" height="11" rx="2.5"/><path d="M12 4.5V8"/><circle cx="12" cy="3.6" r="1.1"/><path d="M9 12.5v2M15 12.5v2"/><path d="M2.5 12v3M21.5 12v3"/>'),
};

/** 取图标 SVG 字符串，找不到时返回空字符串 */
export function icon(name) {
  return icons[name] || '';
}
