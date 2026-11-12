/**
 * LMTAgent 工作台样式表（由 tools/assemble-styles.mjs 从 src/styles/*.css 自动组装生成）。
 * 请修改 packages/redteam-ui/src/styles/*.css 后运行：
 *   node packages/redteam-ui/tools/assemble-styles.mjs
 */
export const CSS = String.raw`
/* ══════════════════════════════════════════════════════════════════
   00-tokens.css — LMTAgent Theme-Adaptive Design Tokens (DSH Light & Dark)
   ══════════════════════════════════════════════════════════════════ */
:root{
  --rt-dock-w:540px;
  --wb-blue:#4d6bfe;
  --wb-blue-deep:#2563eb;
  --wb-blue-cyan:#0ea5e9;
  --wb-blue-soft:rgba(77,107,254,.12);
  --wb-blue-ring:rgba(77,107,254,.32);
  --wb-blue-ink:#1e40af;
  --wb-blue-pill:#dbeafe;

  --rt-bg-base:var(--dsw-alias-bg-base,#f8fafc);
  --rt-bg-card:var(--dsw-alias-bg-layer-1,#ffffff);
  --rt-bg-elevated:var(--dsw-alias-bg-layer-2,#f1f5f9);
  --rt-bg-subtle:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#f1f5f9) 68%,transparent);
  --rt-border:var(--dsw-alias-border-l1,#e2e8f0);
  --rt-border-strong:var(--dsw-alias-border-l2,#cbd5e1);
  --rt-text-primary:var(--dsw-alias-label-primary,#0f172a);
  --rt-text-secondary:var(--dsw-alias-label-secondary,#475569);
  --rt-text-muted:#64748b;

  --rt-success:#059669;
  --rt-success-soft:rgba(16,185,129,.12);
  --rt-success-border:rgba(16,185,129,.32);
  --rt-warning:#d97706;
  --rt-warning-soft:rgba(245,158,11,.12);
  --rt-warning-border:rgba(245,158,11,.34);
  --rt-danger:#dc2626;
  --rt-danger-soft:rgba(239,68,68,.1);
  --rt-danger-border:rgba(239,68,68,.38);

  --rt-radius-sm:6px;
  --rt-radius-md:10px;
  --rt-radius-lg:14px;
  --rt-shadow-card:0 2px 10px -4px rgba(15,23,42,.06),0 8px 24px -18px rgba(77,107,254,.18);
  --rt-shadow-float:0 8px 24px -6px rgba(15,23,42,.12);
}

body[data-ds-dark-theme]{
  --wb-blue:#5b78ff;
  --wb-blue-deep:#3b82f6;
  --wb-blue-cyan:#38bdf8;
  --wb-blue-soft:rgba(91,120,255,.16);
  --wb-blue-ring:rgba(91,120,255,.38);
  --wb-blue-ink:#93c5fd;
  --wb-blue-pill:rgba(77,107,254,.2);

  --rt-bg-base:var(--dsw-alias-bg-base,#0f172a);
  --rt-bg-card:var(--dsw-alias-bg-layer-1,#1e293b);
  --rt-bg-elevated:var(--dsw-alias-bg-layer-2,#273549);
  --rt-bg-subtle:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#273549) 75%,transparent);
  --rt-border:var(--dsw-alias-border-l1,rgba(148,163,184,.22));
  --rt-border-strong:var(--dsw-alias-border-l2,rgba(148,163,184,.34));
  --rt-text-primary:var(--dsw-alias-label-primary,#f1f5f9);
  --rt-text-secondary:var(--dsw-alias-label-secondary,#94a3b8);
  --rt-text-muted:#94a3b8;

  --rt-success:#34d399;
  --rt-success-soft:rgba(16,185,129,.2);
  --rt-success-border:rgba(52,211,153,.4);
  --rt-warning:#fbbf24;
  --rt-warning-soft:rgba(245,158,11,.2);
  --rt-warning-border:rgba(251,191,36,.4);
  --rt-danger:#f87171;
  --rt-danger-soft:rgba(239,68,68,.18);
  --rt-danger-border:rgba(248,113,113,.44);

  --rt-shadow-card:0 4px 14px rgba(0,0,0,.28);
  --rt-shadow-float:0 10px 28px -6px rgba(0,0,0,.46);
}

/* ══════════════════════════════════════════════════════════════════
   01-shell.css — Dock Overlay, Fullscreen Chrome Clearance, Header, 2-Tier Tabs & View Mode Toggle
   ══════════════════════════════════════════════════════════════════ */
/* 右侧栏收起时给 frame 加内边距，中栏主动收窄且最多让出 45vw。属性名跨 DSH 版本兼容：
   旧版 details 栏 data-details-collapsed，新版 rightbar 栏 data-rightbar-collapsed。 */
div:has(> [data-shell-overlay] .rt-dock[data-open="1"])[data-details-collapsed],
div:has(> [data-shell-overlay] .rt-dock[data-open="1"])[data-rightbar-collapsed]{padding-right:min(var(--rt-dock-w),45vw)}
/* Windows Electron 的桌面标题栏是 webview 上方的 chrome（含最小化/最大化/关闭）。
   面板是 fixed dock overlay，不能从 y=0 起，否则会盖住系统按钮，按钮也会落在拖拽区里。
   用 DSH 布局发布的 chrome 高度变量；普通 web 没有变量时回退 0。 */
.rt-dock{position:fixed;top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px)));right:0;bottom:0;z-index:80;display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l1);
  box-shadow:-12px 0 32px rgba(15,23,42,.18);pointer-events:auto;color:var(--dsw-alias-label-primary);
  font-size:13px;line-height:1.5;transition:transform .18s ease,opacity .18s ease}
.rt-embed{flex:1;min-height:0;height:100%;width:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;overflow:hidden}
/* 右侧栏全屏时让位：滑出隐藏。仅在 data-rightbar-fullscreen 时隐藏，避免 DSH Desktop 无 collapsed 属性导致面板被强制隐藏。 */
div:has(> [data-shell-overlay] .rt-dock[data-open="1"])[data-rightbar-fullscreen] .rt-dock{
  transform:translateX(100%);opacity:0;pointer-events:none}
.rt-grip{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:col-resize;background:transparent;z-index:2}
.rt-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-title{font-weight:600;font-size:14px;display:flex;align-items:center;gap:6px;white-space:nowrap}
.rt-dot{width:8px;height:8px;border-radius:50%;background:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-spacer{flex:1}
.rt-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:inherit;
  border-radius:6px;padding:3px 9px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap}
.rt-btn:hover{border-color:var(--dsw-alias-border-l2)}
.rt-btn-primary{background:var(--wb-blue,var(--dsw-alias-brand-primary));border-color:var(--wb-blue,var(--dsw-alias-brand-primary));color:var(--dsw-alias-bg-base)}
.rt-btn-primary:hover{opacity:.9}
.rt-btn:disabled{opacity:.5;cursor:default}
.rt-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-tabs-groups{border-bottom:none;padding-bottom:0}
.rt-tabs-groups .rt-tab-group{font-size:12px;padding:4px 10px;color:var(--dsw-alias-label-secondary)}
.rt-tabs-groups .rt-tab-group.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.rt-tabs-sub{padding-top:2px;padding-bottom:0}
.rt-tab{padding:6px 12px;border-radius:6px 6px 0 0;cursor:pointer;font-size:12.5px;color:var(--dsw-alias-label-secondary);
  display:inline-flex;align-items:center;gap:5px}
.rt-tab.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font-weight:600}
/* 未读红点：该页签有新内容（新资产/新漏洞/新得分/新步骤…），点开看过就消失 */
.rt-tab-dot{width:7px;height:7px;border-radius:50%;background:#ef4444;flex:none;
  box-shadow:0 0 0 2px color-mix(in srgb, #ef4444 22%, transparent)}
.rt-body{flex:1;min-height:0;display:flex;flex-direction:column}
.rt-split{flex:1;min-height:0;display:flex}
.rt-side{width:200px;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:8px}
.rt-main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.rt-toolbar{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap;align-items:center}
.rt-input{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:inherit;
  border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;outline:none;min-width:0}
.rt-input:focus{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-pane{flex:1;overflow:auto;padding:12px}
.rt-textarea{width:100%;min-height:260px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);
  color:inherit;border-radius:6px;padding:8px;font-size:12.5px;font-family:ui-monospace,Menlo,monospace;
  line-height:1.6;resize:vertical;outline:none;box-sizing:border-box}
.rt-textarea:focus{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-list{width:210px;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:8px}
.rt-empty{padding:24px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.rt-err{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:6px 10px}
.rt-foot{padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;
  color:var(--dsw-alias-label-secondary);display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.rt-icon-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;border:1px solid var(--dsw-alias-border-l1);
  background:transparent;color:inherit;border-radius:6px;padding:6px 8px;cursor:pointer;font-family:inherit;font-size:12.5px}
.rt-icon-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-icon-btn.on{border-color:var(--wb-blue,var(--dsw-alias-brand-primary));color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-hbtn{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;border-radius:6px;
  padding:2px 8px;font-size:12px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px}
.rt-hbtn:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-hbtn.on{border-color:var(--wb-blue,var(--dsw-alias-brand-primary));color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-full{position:fixed;top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px)));right:0;bottom:0;left:0;z-index:60;display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;
  border-top:3px solid var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-full .rt-head{padding:12px 18px}
.rt-full .rt-tabs{padding:10px 18px 0;gap:6px;flex-wrap:wrap}
.rt-full .rt-side{width:260px}
.rt-full .rt-list{width:280px}
.rt-full .rt-row{grid-template-columns:190px 90px 130px 1.4fr 1.2fr}
.rt-full .rt-vrow{grid-template-columns:80px minmax(0,1.6fr) 200px 150px 90px 64px}
.rt-full .rt-pane{padding:18px}
.rt-full .rt-textarea{min-height:60vh}
.rt-full .rt-foot{padding:10px 18px;font-size:12px}
.rt-full .rt-body{max-width:1400px;width:100%;margin:0 auto;flex:1;min-height:0;display:flex;flex-direction:column}
.rt-subtabs{display:flex;gap:4px;padding:6px 10px 0;border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center}
.rt-subtab{padding:4px 10px;border-radius:6px 6px 0 0;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-subtab.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font-weight:600}
/* 版本 / 更新弹窗 */
.rt-modal{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.rt-modal-box{width:min(560px,92vw);max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px;font-size:12.5px;line-height:1.7;
  box-shadow:0 18px 48px rgba(0,0,0,.35);color:var(--dsw-alias-label-primary)}
.rt-modal-box .rt-kv b{min-width:76px}

/* WorkBuddy × DSH Brand Blue 统一视觉层（Shell 部分） */
.rt-dock,.rt-full{
  background:
    radial-gradient(960px 440px at 100% 0%, rgba(77,107,254,.09), transparent 64%),
    radial-gradient(640px 320px at 0% 100%, rgba(14,165,233,.05), transparent 60%),
    var(--dsw-alias-bg-base);
}
.rt-head{
  padding:11px 14px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,transparent);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
}
.rt-title{font-weight:700;letter-spacing:-.01em;font-size:14.5px}
.rt-dot{background:#4d6bfe;box-shadow:0 0 0 3px rgba(77,107,254,.22)}

/* 一级分区：WorkBuddy 胶囊分段器；二级页签：DSH 蓝底部高亮 */
.rt-tabs-groups{padding:10px 14px 2px;gap:6px}
.rt-tab-group{
  border:1px solid transparent;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:600;transition:background .15s,color .15s,border-color .15s,box-shadow .15s;
}
.rt-tab-group:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.rt-tab-group.on{
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;border-color:#4d6bfe;
  box-shadow:0 2px 8px rgba(77,107,254,.28);
}
.rt-tabs-sub{padding:4px 14px 0;gap:2px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
.rt-tab{border-radius:7px 7px 0 0;padding:5px 10px;transition:background .15s,color .15s}
.rt-tab:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}
.rt-tab.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:inset 0 -2px 0 #4d6bfe}

/* 页面工具栏 */
.rt-toolbar{
  padding:10px 14px;gap:7px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 84%,transparent);
  border-bottom:1px solid var(--dsw-alias-border-l1);
}
.rt-toolbar>span:first-child{font-size:13.5px;font-weight:700;letter-spacing:-.01em}

/* 按钮 / 输入 */
.rt-btn{
  border-radius:8px;padding:4px 10px;font-weight:500;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 72%,transparent);
  transition:background .15s,border-color .15s,color .15s,box-shadow .15s;
}
.rt-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:rgba(77,107,254,.45);color:var(--dsw-alias-label-primary)}
.rt-btn-primary{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);border-color:#4d6bfe;color:#fff;box-shadow:0 2px 6px rgba(77,107,254,.28)}
.rt-btn-primary:hover{color:#fff;filter:brightness(1.06)}
.rt-input{
  border-radius:8px;padding:5px 9px;
  background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,var(--dsw-alias-bg-layer-2));
  transition:border-color .15s,box-shadow .15s;
}
.rt-input:hover{border-color:var(--dsw-alias-border-l2)}
.rt-input:focus{border-color:#4d6bfe;box-shadow:0 0 0 3px rgba(77,107,254,.16)}
.rt-side,.rt-list{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 32%,transparent);padding:10px}
.rt-subtabs{padding:8px 12px 0;gap:4px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
.rt-subtab{border-radius:7px 7px 0 0;padding:5px 10px;transition:background .12s,color .12s}
.rt-subtab:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}
.rt-subtab.on{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 -2px 0 #4d6bfe}
.rt-empty{
  margin:18px auto;max-width:440px;padding:26px 18px;
  border:1px dashed color-mix(in srgb,var(--dsw-alias-border-l2) 75%,transparent);
  border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 35%,transparent);
}

/* 滚动条 */
.rt-dock *::-webkit-scrollbar,.rt-full *::-webkit-scrollbar{width:8px;height:8px}
.rt-dock *::-webkit-scrollbar-thumb,.rt-full *::-webkit-scrollbar-thumb{
  background:color-mix(in srgb,var(--dsw-alias-label-secondary) 32%,transparent);border-radius:99px;border:2px solid transparent;background-clip:padding-box;
}
.rt-dock *::-webkit-scrollbar-thumb:hover,.rt-full *::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 50%,transparent);background-clip:padding-box}
.rt-dock *::-webkit-scrollbar-track,.rt-full *::-webkit-scrollbar-track{background:transparent}

.rt-tabs-groups .rt-tab-group.on{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;border-color:#4d6bfe}

/* 全屏内容别只占中间 1400，数据页可用更宽；工具条输入不要无限拉长 */
.rt-full .rt-body{max-width:1600px;padding-left:20px;padding-right:20px}
.rt-toolbar .rt-input{max-width:320px}

/* 深色与浅色主题均采用 DSH 品牌蓝作为主操作与选中胶囊 */
body[data-ds-dark-theme] .rt-btn-primary,
body[data-ds-dark-theme] .rt-tab-group.on,
body[data-ds-dark-theme] .rt-tabs-groups .rt-tab-group.on{
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);
  color:#fff;
  border-color:#4d6bfe;
  box-shadow:0 2px 10px rgba(77,107,254,.35);
}
body[data-ds-dark-theme] .rt-btn-primary:hover,
body[data-ds-dark-theme] .rt-tab-group.on:hover,
body[data-ds-dark-theme] .rt-tabs-groups .rt-tab-group.on:hover{
  background:linear-gradient(135deg,#5b78ff 0%,#3b82f6 100%);
  color:#fff;
}
body[data-ds-dark-theme] .rt-btn-primary{filter:none}

.rt-btn-primary,
.rt-tab-group.on,
.rt-tabs-groups .rt-tab-group.on{
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);
  color:#fff;
  border-color:#4d6bfe;
}
.rt-btn-primary:hover,
.rt-tabs-groups .rt-tab-group.on:hover{
  background:linear-gradient(135deg,#5b78ff 0%,#3b82f6 100%);
  color:#fff;
}

/* LMTAgent Mode Bar & Composer Dock Bar */
.rt-harness-modebar{display:inline-flex;align-items:center;gap:4px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.rt-harness-modebtn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;padding:4px 9px;border-radius:6px;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .14s,color .14s}
.rt-harness-modebtn:hover{color:var(--dsw-alias-label-primary)}
.rt-harness-modebtn.on{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;box-shadow:0 1px 4px rgba(77,107,254,.3)}
.rt-composer-dock{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11.5px;margin:2px 0}

/* v0.21.0 Header View-Mode Toggle Group (🌱 新手简洁 / 🔧 专家视图) */
.rt-mode-switch,
.rt-view-mode-bar{
  display:inline-flex;
  align-items:center;
  gap:3px;
  padding:2px;
  border-radius:999px;
  background:var(--rt-bg-elevated,var(--dsw-alias-bg-layer-2));
  border:1px solid var(--rt-border,var(--dsw-alias-border-l1));
  flex-shrink:0;
}

/* ══════════════════════════════════════════════════════════════════
   02-wizard.css — v0.21.0 Novice Wish Refiner, Plan Blueprint Wizard & Zero-Fake-Data Empty Hero
   ══════════════════════════════════════════════════════════════════ */

/* Mode Switch Pill (🌱 新手简洁 / 🔧 专家视图) */
.rt-mode-switch-pill{
  display:inline-flex;
  align-items:center;
  gap:5px;
  padding:3px 11px;
  border-radius:999px;
  border:1px solid transparent;
  background:transparent;
  color:var(--rt-text-secondary,var(--dsw-alias-label-secondary));
  font-size:11.5px;
  font-weight:600;
  font-family:inherit;
  line-height:1.4;
  cursor:pointer;
  white-space:nowrap;
  transition:background .15s ease,color .15s ease,border-color .15s ease,box-shadow .15s ease,transform .12s ease;
}
.rt-mode-switch-pill:hover{
  color:var(--rt-text-primary,var(--dsw-alias-label-primary));
  background:color-mix(in srgb,var(--wb-blue,#4d6bfe) 8%,transparent);
}
.rt-mode-switch-pill.on,
.rt-mode-switch-pill.active{
  color:#ffffff;
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);
  border-color:#4d6bfe;
  box-shadow:0 2px 8px rgba(77,107,254,.28);
}
.rt-mode-switch-pill.novice.on,
.rt-mode-switch-pill.is-novice.on{
  background:linear-gradient(135deg,#10b981 0%,#059669 100%);
  border-color:#059669;
  box-shadow:0 2px 8px rgba(16,185,129,.28);
}
body[data-ds-dark-theme] .rt-mode-switch-pill.on,
body[data-ds-dark-theme] .rt-mode-switch-pill.active{
  background:linear-gradient(135deg,#5b78ff 0%,#3b82f6 100%);
  border-color:#60a5fa;
  color:#ffffff;
}
body[data-ds-dark-theme] .rt-mode-switch-pill.novice.on,
body[data-ds-dark-theme] .rt-mode-switch-pill.is-novice.on{
  background:linear-gradient(135deg,#34d399 0%,#10b981 100%);
  border-color:#34d399;
  color:#ffffff;
}

/* Novice Wish Refiner & Plan Wizard Container */
.rt-wish-wizard{
  display:flex;
  flex-direction:column;
  gap:14px;
  padding:18px 20px;
  border-radius:14px;
  border:1px solid color-mix(in srgb,var(--wb-blue,#4d6bfe) 30%,var(--rt-border,var(--dsw-alias-border-l1)));
  background:
    radial-gradient(540px 220px at 100% 0%,rgba(77,107,254,.1),transparent 70%),
    radial-gradient(420px 180px at 0% 100%,rgba(16,185,129,.07),transparent 65%),
    var(--rt-bg-card,var(--dsw-alias-bg-layer-1));
  box-shadow:var(--rt-shadow-card);
  box-sizing:border-box;
  width:100%;
}
body[data-ds-dark-theme] .rt-wish-wizard{
  background:
    radial-gradient(540px 220px at 100% 0%,rgba(91,120,255,.16),transparent 70%),
    radial-gradient(420px 180px at 0% 100%,rgba(16,185,129,.1),transparent 65%),
    var(--dsw-alias-bg-layer-1);
  border-color:rgba(96,165,250,.32);
}
.rt-wish-wizard-head{
  display:flex;
  align-items:flex-start;
  justify-content:space-between;
  gap:10px;
  flex-wrap:wrap;
}
.rt-wish-wizard-title{
  font-size:15px;
  font-weight:700;
  letter-spacing:-.01em;
  color:var(--rt-text-primary,var(--dsw-alias-label-primary));
  display:flex;
  align-items:center;
  gap:8px;
}
.rt-wish-wizard-sub{
  font-size:12px;
  color:var(--rt-text-secondary,var(--dsw-alias-label-secondary));
  line-height:1.55;
  margin-top:2px;
}
.rt-wish-wizard-actions{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  flex-wrap:wrap;
  padding-top:4px;
}

/* Wish Input Textarea */
.rt-wish-textarea{
  width:100%;
  min-height:96px;
  max-height:280px;
  resize:vertical;
  box-sizing:border-box;
  padding:11px 13px;
  border-radius:10px;
  border:1.5px solid var(--rt-border,var(--dsw-alias-border-l1));
  background:var(--rt-bg-base,var(--dsw-alias-bg-base));
  color:var(--rt-text-primary,var(--dsw-alias-label-primary));
  font-family:inherit;
  font-size:13px;
  line-height:1.6;
  outline:none;
  transition:border-color .16s ease,box-shadow .16s ease,background .16s ease;
}
.rt-wish-textarea::placeholder{
  color:var(--rt-text-secondary,var(--dsw-alias-label-secondary));
  opacity:.78;
}
.rt-wish-textarea:hover{
  border-color:var(--rt-border-strong,var(--dsw-alias-border-l2));
}
.rt-wish-textarea:focus{
  border-color:var(--wb-blue,#4d6bfe);
  box-shadow:0 0 0 3px var(--wb-blue-soft,rgba(77,107,254,.16));
}

/* Quick Starter Wish Templates */
.rt-wish-templates{
  display:flex;
  align-items:center;
  flex-wrap:wrap;
  gap:7px;
}
.rt-wish-template-chip{
  display:inline-flex;
  align-items:center;
  gap:5px;
  padding:4px 11px;
  border-radius:999px;
  border:1px solid var(--rt-border,var(--dsw-alias-border-l1));
  background:var(--rt-bg-elevated,var(--dsw-alias-bg-layer-2));
  color:var(--rt-text-secondary,var(--dsw-alias-label-secondary));
  font-size:11.5px;
  font-weight:600;
  font-family:inherit;
  cursor:pointer;
  white-space:nowrap;
  transition:border-color .14s ease,background .14s ease,color .14s ease,transform .12s ease,box-shadow .14s ease;
}
.rt-wish-template-chip:hover{
  border-color:var(--wb-blue,#4d6bfe);
  color:var(--rt-text-primary,var(--dsw-alias-label-primary));
  background:var(--wb-blue-soft,rgba(77,107,254,.12));
  transform:translateY(-1px);
}
.rt-wish-template-chip.on,
.rt-wish-template-chip.active{
  border-color:var(--wb-blue,#4d6bfe);
  background:linear-gradient(135deg,rgba(77,107,254,.16),rgba(14,165,233,.1));
  color:var(--wb-blue-ink,#1e40af);
  box-shadow:0 2px 6px rgba(77,107,254,.16);
}
body[data-ds-dark-theme] .rt-wish-template-chip.on,
body[data-ds-dark-theme] .rt-wish-template-chip.active{
  color:#93c5fd;
  border-color:#60a5fa;
  background:rgba(59,130,246,.22);
}

/* Blueprint Wave/Goal Shards Grid */
.rt-wish-blueprint-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(235px,1fr));
  gap:12px;
  width:100%;
  box-sizing:border-box;
}
.rt-wish-goal-card{
  display:flex;
  flex-direction:column;
  gap:7px;
  padding:12px 14px;
  border-radius:11px;
  border:1.5px solid var(--rt-border,var(--dsw-alias-border-l1));
  border-left:3.5px solid var(--wb-blue,#4d6bfe);
  background:var(--rt-bg-card,var(--dsw-alias-bg-layer-1));
  color:var(--rt-text-primary,var(--dsw-alias-label-primary));
  min-width:0;
  box-sizing:border-box;
  transition:border-color .15s ease,box-shadow .15s ease,transform .12s ease;
}
.rt-wish-goal-card:hover{
  border-color:var(--wb-blue,#4d6bfe);
  box-shadow:0 4px 14px -4px rgba(77,107,254,.18);
  transform:translateY(-1px);
}
.rt-wish-goal-card.on,
.rt-wish-goal-card.active{
  border-color:var(--wb-blue,#4d6bfe);
  box-shadow:0 0 0 2px var(--wb-blue-ring,rgba(77,107,254,.28));
}
.rt-wish-goal-card.is-approved{
  border-left-color:var(--rt-success,#059669);
}
body[data-ds-dark-theme] .rt-wish-goal-card{
  background:var(--dsw-alias-bg-layer-2);
  border-color:rgba(148,163,184,.22);
  border-left-color:#60a5fa;
}
.rt-wish-goal-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:6px;
  flex-wrap:wrap;
}
.rt-wish-goal-title{
  font-size:12.5px;
  font-weight:700;
  color:var(--rt-text-primary,var(--dsw-alias-label-primary));
  line-height:1.4;
}
.rt-wish-goal-meta{
  font-size:11px;
  color:var(--rt-text-secondary,var(--dsw-alias-label-secondary));
  line-height:1.5;
  word-break:break-word;
}
.rt-wish-goal-files{
  display:flex;
  flex-wrap:wrap;
  gap:4px;
  margin-top:auto;
  padding-top:3px;
}

/* Zero-Fake-Data Empty Canvas Hero & Standby Card */
.rt-standby-card{
  border:1px dashed var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));
  border-radius:12px;
  padding:18px 20px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);
  display:flex;
  flex-direction:column;
  gap:8px;
}
body[data-ds-dark-theme] .rt-standby-card{
  background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
}
.rt-standby-title{
  font-size:13px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
  display:flex;
  align-items:center;
  gap:8px;
}
.rt-standby-desc{
  font-size:12px;
  color:var(--dsw-alias-label-secondary);
  line-height:1.6;
}
.rt-canvas-empty-hero{
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  text-align:center;
  gap:12px;
  min-height:260px;
  padding:32px 24px;
  margin:8px auto;
  max-width:580px;
  border-radius:14px;
  border:1.5px dashed color-mix(in srgb,var(--wb-blue,#4d6bfe) 35%,var(--rt-border,var(--dsw-alias-border-l1)));
  background:
    radial-gradient(360px 160px at 50% 0%,rgba(77,107,254,.08),transparent 72%),
    var(--rt-bg-card,var(--dsw-alias-bg-layer-1));
  box-sizing:border-box;
}
body[data-ds-dark-theme] .rt-canvas-empty-hero{
  background:
    radial-gradient(360px 160px at 50% 0%,rgba(91,120,255,.15),transparent 72%),
    var(--dsw-alias-bg-layer-1);
  border-color:rgba(96,165,250,.32);
}
.rt-canvas-empty-icon{
  width:44px;
  height:44px;
  border-radius:12px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  font-size:20px;
  background:var(--wb-blue-soft,rgba(77,107,254,.12));
  color:var(--wb-blue,#4d6bfe);
  border:1px solid color-mix(in srgb,var(--wb-blue,#4d6bfe) 28%,transparent);
}
.rt-canvas-empty-title{
  font-size:15px;
  font-weight:700;
  color:var(--rt-text-primary,var(--dsw-alias-label-primary));
  letter-spacing:-.01em;
}
.rt-canvas-empty-desc{
  font-size:12.5px;
  color:var(--rt-text-secondary,var(--dsw-alias-label-secondary));
  line-height:1.65;
  max-width:460px;
}
.rt-canvas-empty-actions{
  display:flex;
  align-items:center;
  justify-content:center;
  flex-wrap:wrap;
  gap:8px;
  margin-top:4px;
}

/* ══════════════════════════════════════════════════════════════════
   03-canvas.css — 60FPS Pan-Zoom Viewport, Horizontal/Vertical Workflow Trees,
   Agent Network, p5 Tree Stage, Filter Bar, Add-Worker Bar & Error/Shard States
   ══════════════════════════════════════════════════════════════════ */

/* Visual DAG Canvas */
.rt-dag-canvas{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);
  background:radial-gradient(circle at 12px 12px,rgba(77,107,254,.12) 1px,transparent 1px),var(--dsw-alias-bg-base);background-size:16px 16px}
.rt-dag-wave-row{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap}
.rt-dag-wave-label{width:84px;flex:none;display:flex;flex-direction:column;justify-content:center;padding:6px 8px;border-radius:8px;
  background:rgba(77,107,254,.08);border-left:3px solid #4d6bfe;font-size:10.5px;font-weight:700;color:var(--wb-blue-ink,#2563eb)}
.rt-dag-nodes{flex:1;min-width:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:8px}
.rt-dag-node{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:9px;padding:8px 10px;
  background:var(--dsw-alias-bg-layer-1);cursor:pointer;display:flex;flex-direction:column;gap:3px;transition:border-color .14s,box-shadow .14s,transform .12s;min-width:0}
body[data-ds-dark-theme] .rt-dag-node{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}
.rt-dag-node:hover{border-color:#4d6bfe;transform:translateY(-1px)}
.rt-dag-node.on{border-color:#4d6bfe;background:rgba(77,107,254,.08);box-shadow:0 0 0 2px rgba(77,107,254,.22)}
.rt-dag-node.sub{border-left-style:dashed;border-left-color:#6366f1;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 70%,transparent)}
.rt-dag-node-top{display:flex;align-items:center;justify-content:space-between;gap:4px}
.rt-dag-node-code{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;font-weight:700;color:var(--wb-blue-ink,#2563eb)}
.rt-dag-node-st{font-size:9.5px;padding:0 6px;border-radius:99px;font-weight:600;white-space:nowrap}
.rt-dag-node-st.done{color:#059669;background:rgba(16,185,129,.12)}
.rt-dag-node-st.run{color:var(--wb-blue-ink,#2563eb);background:rgba(77,107,254,.15)}
.rt-dag-node-st.wait{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.rt-dag-node-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-dag-node-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-dag-inspector{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2);font-size:12px;display:flex;flex-direction:column;gap:6px}
.rt-dag-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}

/* Full-Width Workbench Outer Card & p4 Inner Split Grid */
.rt-p4-workbench{
  display:flex;
  flex-direction:column;
  gap:14px;
  grid-column:1 / -1;
  width:100%;
  box-sizing:border-box;
  margin:0;
}
.rt-p4-split-grid,
.rt-p4-vertical-stack{
  display:grid;
  grid-template-columns:1fr;
  gap:18px;
  padding:16px 18px;
  align-items:stretch;
  width:100%;
  box-sizing:border-box;
}

/* Agent 网络 (.rt-net-pane) */
.rt-net-pane{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:12px;
  padding:12px 14px;
  background:var(--dsw-alias-bg-layer-1);
  display:flex;
  flex-direction:column;
  gap:10px;
  min-width:0;
  box-shadow:0 2px 10px -4px rgba(15,23,42,.06);
}
.rt-net-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  flex-wrap:wrap;
}
.rt-net-pills{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
}
.rt-net-pill,.rt-net-pills>span{
  display:inline-flex;
  align-items:center;
  gap:5px;
  padding:2px 9px;
  border-radius:999px;
  font-size:11px;
  font-weight:600;
  background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap;
}
.rt-net-pill-run,.rt-net-pills>span.rt-net-pill-run{
  color:#059669;
  background:rgba(16,185,129,.12);
  border-color:rgba(16,185,129,.35);
}
body[data-ds-dark-theme] .rt-net-pill-run,
body[data-ds-dark-theme] .rt-net-pills>span.rt-net-pill-run{
  color:#34d399;
  background:rgba(16,185,129,.18);
  border-color:rgba(52,211,153,.38);
}

/* 8-Segment Context Legend (.rt-ctx-legend) */
.rt-ctx-legend{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:5px 10px;
  padding:6px 10px;
  border-radius:8px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 68%,transparent);
  border:1px solid var(--dsw-alias-border-l1);
  font-size:10.5px;
  color:var(--dsw-alias-label-secondary);
}
.rt-ctx-legend-item,.rt-ctx-legend>span{
  display:inline-flex;
  align-items:center;
  gap:4px;
  white-space:nowrap;
}
.rt-ctx-legend-dot{
  width:7px;
  height:7px;
  border-radius:2px;
  flex:none;
  display:inline-block;
}
.ctx-sys{background:#64748b}
.ctx-tools{background:#f59e0b}
.ctx-user{background:#10b981}
.ctx-inject{background:#8b5cf6}
.ctx-skill{background:#f97316}
.ctx-asst{background:#06b6d4}
.ctx-res{background:#14b8a6}
.ctx-free{background:#e2e8f0}
body[data-ds-dark-theme] .ctx-free{background:rgba(148,163,184,.24)}

/* Agent Network Topology Tree (.rt-net-tree) */
.rt-net-tree{
  position:relative;
  display:flex;
  flex-direction:column;
  align-items:stretch;
  padding:10px 8px;
  border-radius:10px;
  background:radial-gradient(var(--dsw-alias-border-l1) 1px,transparent 1px),var(--dsw-alias-bg-base);
  background-size:16px 16px;
  border:1px solid var(--dsw-alias-border-l1);
  overflow-x:auto;
}
.rt-net-root-row{
  display:flex;
  justify-content:center;
  align-items:center;
  padding:2px 6px;
  z-index:1;
}
.rt-net-root-row .rt-net-node{
  width:min(100%,290px);
  min-width:210px;
}
.rt-net-svg-layer{
  display:block;
  width:100%;
  height:48px;
  flex:none;
  overflow:visible;
  pointer-events:none;
}
.rt-net-children-row{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(148px,1fr));
  gap:8px;
  padding:2px 2px 4px;
  z-index:1;
  align-items:stretch;
}

/* Agent Network Node Card (.rt-net-node) */
.rt-net-node{
  border-radius:10px;
  border:1.5px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  padding:9px 10px;
  display:flex;
  flex-direction:column;
  gap:6px;
  min-width:0;
  cursor:pointer;
  position:relative;
  transition:border-color .15s ease,box-shadow .15s ease,transform .12s ease;
  box-shadow:0 2px 6px rgba(15,23,42,.04);
}
.rt-net-node:hover{
  border-color:#4d6bfe;
  transform:translateY(-1px);
  box-shadow:0 4px 12px rgba(77,107,254,.12);
}
.rt-net-node.role-wd{border-color:#ef4444}
.rt-net-node.role-wr{border-color:#10b981}
.rt-net-node.role-wa{border-color:#8b5cf6}
.rt-net-node.role-wb{border-color:#3b82f6}
.rt-net-node.role-wc{border-color:#f59e0b}
.rt-net-node.role-wq{border-color:#06b6d4}
.rt-net-node.role-wp{border-color:#6366f1}
.rt-net-node.role-wf{border-color:#ec4899}
.rt-net-node.active,.rt-net-node.on{
  border-color:#4d6bfe;
  box-shadow:0 0 0 3px rgba(77,107,254,.22),0 4px 14px rgba(77,107,254,.16);
  background:linear-gradient(180deg,rgba(77,107,254,.07),transparent 72%),var(--dsw-alias-bg-layer-1);
}
.rt-net-node-head{
  display:flex;
  align-items:center;
  gap:7px;
  min-width:0;
}
.rt-net-node-title{
  font-size:12px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  flex:1;
  min-width:0;
}
.rt-net-node-sub{
  font-size:10.5px;
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.rt-net-avatar{
  width:22px;
  height:22px;
  border-radius:50%;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  font-size:9.5px;
  font-weight:700;
  color:#fff;
  background:#4d6bfe;
  flex:none;
  letter-spacing:-.02em;
  font-family:ui-monospace,Menlo,monospace;
  box-shadow:0 1px 3px rgba(15,23,42,.16);
}
.rt-net-avatar.role-wd,.role-wd .rt-net-avatar{background:#ef4444}
.rt-net-avatar.role-wr,.role-wr .rt-net-avatar{background:#10b981}
.rt-net-avatar.role-wa,.role-wa .rt-net-avatar{background:#8b5cf6}
.rt-net-avatar.role-wb,.role-wb .rt-net-avatar{background:#3b82f6}
.rt-net-avatar.role-wc,.role-wc .rt-net-avatar{background:#f59e0b}
.rt-net-avatar.role-wq,.role-wq .rt-net-avatar{background:#06b6d4}
.rt-net-avatar.role-wp,.role-wp .rt-net-avatar{background:#6366f1}
.rt-net-avatar.role-wf,.role-wf .rt-net-avatar{background:#ec4899}

.rt-ctx-bar{
  display:flex;
  width:100%;
  height:6px;
  border-radius:999px;
  overflow:hidden;
  background:#e2e8f0;
  gap:1px;
}
body[data-ds-dark-theme] .rt-ctx-bar{
  background:rgba(148,163,184,.2);
}
.rt-ctx-bar>span,.rt-ctx-bar>div,.rt-ctx-seg{
  height:100%;
  min-width:2px;
  transition:width .25s ease;
}
.rt-net-foot{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:6px;
  font-size:10.5px;
  color:var(--dsw-alias-label-secondary);
  font-family:ui-monospace,Menlo,monospace;
  margin-top:auto;
  padding-top:2px;
}
.rt-net-foot b,.rt-net-pct{
  font-weight:700;
  color:var(--dsw-alias-label-primary);
}

/* p5 Interactive Zoomable Tree Canvas Styles (.rt-p5-*) */
.rt-p5-wrap{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:14px;
  background:var(--dsw-alias-bg-layer-1);
  overflow:hidden;
  display:flex;
  flex-direction:column;
  margin:10px 0 14px;
  box-shadow:0 2px 12px -4px rgba(15,23,42,.07);
}
.rt-p5-topbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  flex-wrap:wrap;
  padding:10px 14px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 60%,var(--dsw-alias-bg-layer-1));
}
.rt-p5-topbar-title{
  font-size:13.5px;
  font-weight:700;
  display:flex;
  align-items:center;
  gap:7px;
  color:var(--dsw-alias-label-primary);
}
.rt-p5-filters{
  display:inline-flex;
  align-items:center;
  gap:5px;
  flex-wrap:wrap;
}
.rt-p5-viewport{
  position:relative;
  min-height:360px;
  max-height:640px;
  overflow:auto;
  background:radial-gradient(var(--dsw-alias-border-l1) 1px,transparent 1px),var(--dsw-alias-bg-base);
  background-size:18px 18px;
  padding:22px 16px 56px;
  display:flex;
  flex-direction:column;
  align-items:center;
}
.rt-p5-stage{
  transform-origin:top center;
  transition:transform .15s ease;
  display:flex;
  flex-direction:column;
  align-items:center;
  min-width:min-content;
  position:relative;
  z-index:1;
}
.rt-p5-Connector-svg,.rt-p5-connector-svg{
  display:block;
  width:100%;
  height:56px;
  overflow:visible;
  pointer-events:none;
  flex:none;
}
.rt-p5-children,.rt-p5-row{
  display:flex;
  align-items:flex-start;
  justify-content:center;
  gap:14px;
  flex-wrap:wrap;
}
.rt-p5-card{
  width:clamp(250px,270px,290px);
  min-width:250px;
  max-width:290px;
  border-radius:12px;
  border:1.5px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 4px 14px -4px rgba(15,23,42,.08),0 1px 3px rgba(15,23,42,.04);
  display:flex;
  flex-direction:column;
  overflow:hidden;
  transition:border-color .15s ease,box-shadow .15s ease,transform .14s ease;
  cursor:pointer;
}
.rt-p5-card:hover{
  border-color:rgba(77,107,254,.55);
  box-shadow:0 8px 22px -6px rgba(77,107,254,.16);
  transform:translateY(-1px);
}
.rt-p5-card.active,.rt-p5-card.on{
  border-color:#4d6bfe;
  box-shadow:0 0 0 3px rgba(77,107,254,.2),0 8px 22px -6px rgba(77,107,254,.2);
}
.rt-p5-card.root{
  border:1.5px solid #4d6bfe;
  background:linear-gradient(180deg,rgba(77,107,254,.1) 0%,transparent 46%),var(--dsw-alias-bg-layer-1);
  box-shadow:0 6px 20px -6px rgba(77,107,254,.22);
}
.rt-p5-card.group{
  border:1.5px dashed var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 72%,var(--dsw-alias-bg-layer-1));
}
.rt-p5-card-head{
  display:flex;
  align-items:center;
  gap:5px;
  flex-wrap:wrap;
  padding:9px 11px 6px;
}
.rt-p5-badge{
  font-size:10px;
  font-weight:700;
  padding:1px 7px;
  border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap;
}
.rt-p5-badge.primary{
  color:#fff;
  background:linear-gradient(135deg,#4d6bfe,#2563eb);
  border-color:#4d6bfe;
}
.rt-p5-badge.resume{
  color:#0284c7;
  background:rgba(14,165,233,.12);
  border-color:rgba(14,165,233,.3);
}
.rt-p5-badge.done{
  color:#059669;
  background:rgba(16,185,129,.12);
  border-color:rgba(16,185,129,.3);
}
.rt-p5-card-title,.rt-p5-title{
  font-size:12.5px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
  padding:0 11px;
  line-height:1.4;
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
  overflow:hidden;
}
.rt-p5-snippet{
  font-size:11.5px;
  color:var(--dsw-alias-label-secondary);
  line-height:1.55;
  padding:6px 11px 9px;
  display:-webkit-box;
  -webkit-line-clamp:3;
  -webkit-box-orient:vertical;
  overflow:hidden;
  word-break:break-word;
}
.rt-p5-status{
  margin-top:auto;
  padding:7px 11px;
  border-top:1px solid var(--dsw-alias-border-l1);
  background:linear-gradient(90deg,rgba(77,107,254,.09),rgba(14,165,233,.04) 70%,transparent);
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:6px;
  font-size:11px;
  font-weight:600;
  color:var(--wb-blue-ink,#2563eb);
}
body[data-ds-dark-theme] .rt-p5-status{
  color:#93c5fd;
  background:linear-gradient(90deg,rgba(77,107,254,.16),rgba(14,165,233,.06) 70%,transparent);
}
.rt-p5-status.done{
  background:linear-gradient(90deg,rgba(16,185,129,.09),transparent);
  color:#059669;
}
body[data-ds-dark-theme] .rt-p5-status.done{
  color:#34d399;
}
.rt-p5-zoombar{
  position:sticky;
  bottom:10px;
  align-self:flex-end;
  margin-left:auto;
  margin-right:12px;
  z-index:10;
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:4px 8px;
  border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 90%,transparent);
  backdrop-filter:blur(8px);
  -webkit-backdrop-filter:blur(8px);
  box-shadow:0 4px 12px rgba(15,23,42,.12);
  font-size:11px;
  color:var(--dsw-alias-label-primary);
}
.rt-p5-zoombar button,.rt-p5-zoom-btn{
  border:1px solid transparent;
  background:transparent;
  color:inherit;
  border-radius:6px;
  padding:2px 6px;
  font-size:11.5px;
  font-weight:600;
  cursor:pointer;
  font-family:ui-monospace,Menlo,monospace;
  transition:background .12s,border-color .12s;
}
.rt-p5-zoombar button:hover,.rt-p5-zoom-btn:hover{
  background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-border-l1);
  color:#4d6bfe;
}
.rt-p5-tree-stage{
  width:760px;
  max-width:100%;
  margin:0 auto;
  display:flex;
  flex-direction:column;
  align-items:center;
  position:relative;
  transform-origin:top center;
  transition:transform .16s cubic-bezier(.22,1,.36,1);
}
.rt-p5-root-wrap{
  width:360px;
  max-width:92%;
  min-width:0;
  box-sizing:border-box;
  position:relative;
  display:flex;
  flex-direction:column;
  align-items:center;
}
.rt-p5-branches-grid{
  width:760px;
  max-width:100%;
  min-width:0;
  box-sizing:border-box;
  display:grid;
  grid-template-columns:repeat(2,minmax(0,360px));
  justify-content:space-between;
  gap:40px;
  align-items:start;
  position:relative;
}
@media(max-width:680px){
  .rt-p5-branches-grid{
    grid-template-columns:1fr;
    gap:20px;
  }
}
.rt-node-handle{
  width:9px;
  height:9px;
  border-radius:50%;
  background:var(--dsw-alias-bg-layer-1);
  border:2px solid #3b82f6;
  position:absolute;
  left:50%;
  transform:translateX(-50%);
  z-index:3;
  box-shadow:0 0 0 2px var(--dsw-alias-bg-base);
}
.rt-node-handle-top{top:-5px}
.rt-node-handle-bottom{bottom:-5px}
.rt-node-handle-right{left:auto;right:-5px;top:50%;transform:translateY(-50%)}
.rt-node-handle-left{left:-5px;top:50%;transform:translateY(-50%)}
.rt-p5-pill{
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:2px 8px;
  border-radius:999px;
  font-size:10.5px;
  font-weight:700;
  line-height:1.3;
  letter-spacing:0.01em;
}

/* 60FPS Hand-Grab Pan & Zoom Viewport (Zero CSS Transition Drag Lag, GPU Layer Isolation) */
.rt-panzoom-viewport,
.rt-panzoom-viewport *{
  box-sizing: border-box;
}
.rt-panzoom-viewport{
  position: relative;
  width: 100%;
  min-height: 300px;
  height: auto;
  max-height: 520px;
  contain: layout style paint;
  box-sizing: border-box;
  overflow: hidden;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: radial-gradient(circle at 12px 12px, rgba(59,130,246,0.13) 1.2px, transparent 1.2px), var(--dsw-alias-bg-base);
  background-size: 18px 18px;
}
.rt-panzoom-viewport.rt-panzoom-viewport-cluster{
  min-height: 360px;
  max-height: 600px;
}
body[data-ds-dark-theme] .rt-panzoom-viewport{
  background: radial-gradient(circle at 12px 12px, rgba(96,165,250,0.18) 1.2px, transparent 1.2px), var(--dsw-alias-bg-base);
  background-size: 18px 18px;
  border-color: rgba(148,163,184,0.22);
}
.rt-panzoom-viewport.grabbing{
  cursor: grabbing;
}
.rt-panzoom-toolbar{
  position: absolute;
  right: 10px;
  top: 10px;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 5px;
  padding: 5px 10px;
  border-radius: 999px;
  background: var(--rt-bg-card, #ffffff);
  border: 1px solid var(--rt-border, var(--dsw-alias-border-l1));
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08);
}
body[data-ds-dark-theme] .rt-panzoom-toolbar{
  background: var(--dsw-alias-bg-layer-2, #1e293b);
  border-color: rgba(148,163,184,0.24);
  box-shadow: 0 6px 16px rgba(0,0,0,0.38);
}
.rt-panzoom-stage{
  transition: none;
  will-change: transform;
  transform-origin: 0 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  position: relative;
}
.rt-panzoom-stage.smooth-zoom{
  transition: transform 0.16s cubic-bezier(0.22, 1, 0.36, 1);
}

/* Toolbar Tree Layout Settings Switcher */
.rt-tree-layout-setting{
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rt-tree-dir-btn{
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  color: var(--wb-blue-ink, #2563eb);
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  transition: background 0.14s ease, border-color 0.14s ease, transform 0.12s ease, box-shadow 0.14s ease;
}
.rt-tree-dir-btn:hover{
  background: rgba(59, 130, 246, 0.18);
  border-color: #3b82f6;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.2);
}
.rt-tree-dir-btn.active,
.rt-tree-dir-btn.on{
  color: #ffffff;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border-color: #2563eb;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.28);
}
body[data-ds-dark-theme] .rt-tree-dir-btn{
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.18);
  border-color: rgba(96, 165, 250, 0.38);
}
body[data-ds-dark-theme] .rt-tree-dir-btn.active,
body[data-ds-dark-theme] .rt-tree-dir-btn.on{
  color: #ffffff;
  background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
  border-color: #60a5fa;
}

/* Box-Sizing Overlap Guard & Hierarchical Auto-Folding Wave Path Tree */
.rt-tree-wave-group,
.rt-tree-wave-card,
.rt-p4-node-card,
.rt-p5-root-wrap,
.rt-p5-branches-grid,
.rt-tree-wave-row{
  box-sizing: border-box;
  min-width: 0;
}
.rt-p4-node-card{
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1.5px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
}
body[data-ds-dark-theme] .rt-p4-node-card{
  background: var(--dsw-alias-bg-layer-2);
  border-color: rgba(148, 163, 184, 0.22);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.26);
}
.rt-p4-node-card:hover{
  border-color: #3b82f6;
  transform: translateY(-1px);
  box-shadow: 0 6px 14px -4px rgba(59, 130, 246, 0.18);
}
.rt-p4-node-card.active,
.rt-p4-node-card.on{
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.22), 0 6px 16px -4px rgba(59, 130, 246, 0.2);
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.08) 0%, transparent 68%), var(--dsw-alias-bg-layer-1);
}
body[data-ds-dark-theme] .rt-p4-node-card.active,
body[data-ds-dark-theme] .rt-p4-node-card.on{
  border-color: #60a5fa;
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.16) 0%, transparent 70%), var(--dsw-alias-bg-layer-2);
}

/* Horizontal Left-to-Right Tree Derivation Mode (Default ➔ 横向向右派生) */
.rt-tree-layout-horizontal{
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0;
  min-width: max-content;
  padding: 20px 28px;
  box-sizing: border-box;
}
.rt-h-root-col{
  width: 270px;
  flex-shrink: 0;
  align-self: center;
  position: relative;
  box-sizing: border-box;
}
.rt-h-fanout-col{
  position: relative;
  width: 68px;
  flex-shrink: 0;
  align-self: stretch;
  min-height: 0;
  box-sizing: border-box;
}
.rt-h-root-fanout-svg{
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  overflow: visible;
  pointer-events: none;
}
.rt-h-waves-stack{
  display: flex;
  flex-direction: column;
  gap: 18px;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
}
.rt-wave-horizontal-lane{
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 0;
  position: relative;
  box-sizing: border-box;
}
.rt-wave-horizontal-lane > .rt-tree-wave-card,
.rt-tree-layout-horizontal .rt-tree-wave-card{
  width: 270px;
  flex-shrink: 0;
  position: relative;
  box-sizing: border-box;
}
.rt-n8n-diamond-pin-right{
  position: absolute;
  right: -6px;
  top: 50%;
  width: 10px;
  height: 10px;
  transform: translateY(-50%) rotate(45deg);
  background: var(--dsw-alias-bg-layer-1);
  border: 2px solid #3b82f6;
  border-radius: 2px;
  z-index: 3;
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-base);
}
body[data-ds-dark-theme] .rt-n8n-diamond-pin-right{
  background: var(--dsw-alias-bg-layer-2);
  border-color: #60a5fa;
}
.rt-h-wave-branch-line{
  width: 44px;
  height: 2px;
  align-self: center;
  flex-shrink: 0;
  position: relative;
  background: linear-gradient(90deg, #3b82f6, #60a5fa);
  overflow: visible;
}
/* Fix v0.20 44×48px solid blue rectangle bug when .rt-h-wave-branch-line is or wraps an SVG */
.rt-h-wave-branch-line:has(> svg){
  background: none;
  height: auto;
}
svg.rt-h-wave-branch-line{
  background: none !important;
  height: auto;
  overflow: visible;
  pointer-events: none;
}
.rt-wave-right-children{
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 14px;
  align-items: stretch;
  padding: 4px 0;
  box-sizing: border-box;
}
.rt-wave-right-children > *,
.rt-wave-right-children .rt-p4-node-card,
.rt-wave-right-children .rt-net-node{
  width: 248px;
  flex-shrink: 0;
  position: relative;
  box-sizing: border-box;
}
.rt-n8n-port-left{
  position: absolute;
  left: -5px;
  top: 50%;
  transform: translateY(-50%);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--dsw-alias-bg-layer-1);
  border: 2px solid #3b82f6;
  z-index: 3;
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-base);
}
body[data-ds-dark-theme] .rt-n8n-port-left{
  background: var(--dsw-alias-bg-layer-2);
  border-color: #60a5fa;
}

/* Vertical Top-Down Fallback Mode (⬇ 纵向向下派生) */
.rt-tree-layout-vertical{
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 24px 20px;
  box-sizing: border-box;
}
.rt-tree-wave-row{
  display: grid;
  grid-template-columns: repeat(4, minmax(230px, 1fr));
  gap: 18px;
  align-items: start;
  width: 100%;
  position: relative;
  box-sizing: border-box;
  min-width: 0;
}
.rt-tree-wave-grid{
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 10px;
  width: 100%;
  align-items: start;
  box-sizing: border-box;
}
.rt-tree-wave-group{
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  width: 100%;
  position: relative;
  box-sizing: border-box;
}
.rt-wave-subtree-children{
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  margin-top: 8px;
  padding: 8px;
  border-radius: 10px;
  border: 1px dashed var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  position: relative;
  box-sizing: border-box;
  min-width: 0;
}
body[data-ds-dark-theme] .rt-wave-subtree-children{
  border-color: rgba(148, 163, 184, 0.26);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 85%, var(--dsw-alias-bg-base));
}
.rt-tree-wave-card{
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1.5px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.14s ease, background 0.16s ease;
  box-shadow: 0 2px 8px rgba(15,23,42,0.05);
}
body[data-ds-dark-theme] .rt-tree-wave-card{
  background: var(--dsw-alias-bg-layer-2);
  border-color: rgba(148,163,184,0.22);
  box-shadow: 0 4px 14px rgba(0,0,0,0.28);
}
.rt-tree-wave-card:hover{
  border-color: #3b82f6;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px -4px rgba(59,130,246,0.18);
}
body[data-ds-dark-theme] .rt-tree-wave-card:hover{
  border-color: #60a5fa;
  box-shadow: 0 6px 18px -4px rgba(59,130,246,0.32);
}
.rt-tree-wave-card.active,.rt-tree-wave-card.on,.rt-tree-wave-card.expanded{
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59,130,246,0.22), 0 6px 18px -4px rgba(59,130,246,0.2);
  background: linear-gradient(180deg, rgba(59,130,246,0.08) 0%, transparent 65%), var(--dsw-alias-bg-layer-1);
}
body[data-ds-dark-theme] .rt-tree-wave-card.active,
body[data-ds-dark-theme] .rt-tree-wave-card.on,
body[data-ds-dark-theme] .rt-tree-wave-card.expanded{
  border-color: #60a5fa;
  box-shadow: 0 0 0 3px rgba(96,165,250,0.28), 0 8px 20px -4px rgba(37,99,235,0.34);
  background: linear-gradient(180deg, rgba(59,130,246,0.16) 0%, transparent 70%), var(--dsw-alias-bg-layer-2);
}
.rt-tree-wave-card-badge{
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: #2563eb;
  background: rgba(59,130,246,0.12);
  border: 1px solid rgba(59,130,246,0.28);
  white-space: nowrap;
}
body[data-ds-dark-theme] .rt-tree-wave-card-badge{
  color: #93c5fd;
  background: rgba(59,130,246,0.22);
  border-color: rgba(96,165,250,0.38);
}
.rt-tree-expanded-grid{
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 10px;
  width: 100%;
  margin-top: 8px;
  padding: 10px;
  border-radius: 10px;
  border: 1px dashed var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  box-sizing: border-box;
}
body[data-ds-dark-theme] .rt-tree-expanded-grid{
  border-color: rgba(148,163,184,0.26);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 85%, var(--dsw-alias-bg-base));
}
.rt-n8n-diamond-pin{
  position: absolute;
  left: 50%;
  bottom: -6px;
  width: 10px;
  height: 10px;
  transform: translateX(-50%) rotate(45deg);
  background: var(--dsw-alias-bg-layer-1);
  border: 2px solid #3b82f6;
  border-radius: 2px;
  z-index: 3;
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-base);
}
body[data-ds-dark-theme] .rt-n8n-diamond-pin{
  background: var(--dsw-alias-bg-layer-2);
  border-color: #60a5fa;
}

/* v0.21.0 Canvas Filter Pills, + 新增分片 Bar, Error/Shard-Violation Card States & Shard Lock Badge */
.rt-canvas-filter-bar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  flex-wrap:wrap;
  padding:8px 12px;
  border-radius:10px;
  border:1px solid var(--rt-border,var(--dsw-alias-border-l1));
  background:var(--rt-bg-subtle,color-mix(in srgb,var(--dsw-alias-bg-layer-2) 65%,transparent));
  box-sizing:border-box;
}
.rt-canvas-filter-pill{
  display:inline-flex;
  align-items:center;
  gap:5px;
  padding:3px 10px;
  border-radius:999px;
  border:1px solid var(--rt-border,var(--dsw-alias-border-l1));
  background:var(--rt-bg-card,var(--dsw-alias-bg-layer-1));
  color:var(--rt-text-secondary,var(--dsw-alias-label-secondary));
  font-size:11px;
  font-weight:600;
  font-family:inherit;
  cursor:pointer;
  white-space:nowrap;
  transition:background .14s ease,border-color .14s ease,color .14s ease;
}
.rt-canvas-filter-pill:hover{
  border-color:var(--wb-blue,#4d6bfe);
  color:var(--rt-text-primary,var(--dsw-alias-label-primary));
}
.rt-canvas-filter-pill.on,
.rt-canvas-filter-pill.active{
  color:#ffffff;
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);
  border-color:#4d6bfe;
}
.rt-canvas-filter-pill.is-error-filter.on{
  background:linear-gradient(135deg,#ef4444 0%,#dc2626 100%);
  border-color:#dc2626;
}

/* + 新增分片 Inline Form / Bar */
.rt-add-worker-bar{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  padding:10px 12px;
  border-radius:10px;
  border:1px dashed color-mix(in srgb,var(--wb-blue,#4d6bfe) 45%,var(--rt-border,var(--dsw-alias-border-l1)));
  background:linear-gradient(90deg,rgba(77,107,254,.07),rgba(14,165,233,.03)),var(--rt-bg-card,var(--dsw-alias-bg-layer-1));
  box-sizing:border-box;
  width:100%;
}
body[data-ds-dark-theme] .rt-add-worker-bar{
  background:linear-gradient(90deg,rgba(91,120,255,.14),rgba(56,189,248,.05)),var(--dsw-alias-bg-layer-2);
  border-color:rgba(96,165,250,.4);
}
.rt-add-worker-bar input,
.rt-add-worker-bar select{
  min-width:120px;
  box-sizing:border-box;
}
.rt-add-worker-bar .rt-add-worker-goal{
  flex:1 1 220px;
}

/* Error / Failed / Shard-Violation Red Card States */
.rt-p4-node-card.is-error,
.rt-p4-node-card.is-failed,
.rt-p4-node-card.is-violation,
.rt-net-node.is-error,
.rt-tree-wave-card.is-error{
  border-color:#ef4444;
  background:linear-gradient(180deg,rgba(239,68,68,.1) 0%,transparent 68%),var(--rt-bg-card,var(--dsw-alias-bg-layer-1));
  box-shadow:0 2px 10px -2px rgba(239,68,68,.2);
}
.rt-p4-node-card.is-error:hover,
.rt-p4-node-card.is-failed:hover,
.rt-p4-node-card.is-violation:hover,
.rt-net-node.is-error:hover,
.rt-tree-wave-card.is-error:hover{
  border-color:#dc2626;
  box-shadow:0 6px 16px -4px rgba(239,68,68,.3);
}
.rt-p4-node-card.is-error.on,
.rt-p4-node-card.is-error.active,
.rt-p4-node-card.is-failed.on,
.rt-p4-node-card.is-violation.on{
  border-color:#dc2626;
  box-shadow:0 0 0 3px rgba(239,68,68,.24),0 6px 16px -4px rgba(239,68,68,.28);
}
body[data-ds-dark-theme] .rt-p4-node-card.is-error,
body[data-ds-dark-theme] .rt-p4-node-card.is-failed,
body[data-ds-dark-theme] .rt-p4-node-card.is-violation,
body[data-ds-dark-theme] .rt-net-node.is-error,
body[data-ds-dark-theme] .rt-tree-wave-card.is-error{
  border-color:#f87171;
  background:linear-gradient(180deg,rgba(239,68,68,.18) 0%,transparent 70%),var(--dsw-alias-bg-layer-2);
  box-shadow:0 4px 14px rgba(0,0,0,.35),0 0 0 1px rgba(248,113,113,.22);
}

/* Shard Ownership Lock Badge */
.rt-shard-lock-badge{
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:1px 7px;
  border-radius:999px;
  font-size:10px;
  font-weight:700;
  font-family:ui-monospace,Menlo,monospace;
  color:var(--wb-blue-ink,#1e40af);
  background:var(--wb-blue-soft,rgba(77,107,254,.12));
  border:1px solid color-mix(in srgb,var(--wb-blue,#4d6bfe) 30%,transparent);
  white-space:nowrap;
  max-width:100%;
  overflow:hidden;
  text-overflow:ellipsis;
}
.rt-shard-lock-badge.is-conflict,
.rt-shard-lock-badge.is-violation{
  color:var(--rt-danger,#dc2626);
  background:var(--rt-danger-soft,rgba(239,68,68,.12));
  border-color:var(--rt-danger-border,rgba(239,68,68,.38));
}
.rt-shard-lock-badge.is-clean,
.rt-shard-lock-badge.is-released{
  color:var(--rt-success,#059669);
  background:var(--rt-success-soft,rgba(16,185,129,.12));
  border-color:var(--rt-success-border,rgba(16,185,129,.32));
}
body[data-ds-dark-theme] .rt-shard-lock-badge{
  color:#93c5fd;
  background:rgba(59,130,246,.2);
  border-color:rgba(96,165,250,.36);
}
body[data-ds-dark-theme] .rt-shard-lock-badge.is-conflict,
body[data-ds-dark-theme] .rt-shard-lock-badge.is-violation{
  color:#f87171;
  background:rgba(239,68,68,.22);
  border-color:rgba(248,113,113,.44);
}

/* ---------------------------------------------------------- v0.22.0 Collab & Approval Card Page + Clean Overview Styles */
.rt-pane.rt-collab-page{
  display:flex;
  flex-direction:column;
  gap:16px;
  padding:16px 20px 28px;
  max-width:1180px;
  width:100%;
  margin:0 auto;
  box-sizing:border-box;
}
.rt-collab-page > .rt-card{
  display:flex;
  flex-direction:column;
  gap:12px;
  padding:16px 18px;
  border-radius:12px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 2px 10px rgba(15,23,42,.04);
  box-sizing:border-box;
}
body[data-ds-dark-theme] .rt-collab-page > .rt-card{
  background:var(--dsw-alias-bg-layer-2);
  border-color:rgba(148,163,184,.2);
  box-shadow:0 6px 18px rgba(0,0,0,.28);
}

/* Card 1: Session Onboarding Guide */
.rt-card.rt-onboard-card{
  border-color:rgba(77,107,254,.32);
  background:linear-gradient(135deg,rgba(77,107,254,.06) 0%,rgba(14,165,233,.03) 100%),var(--dsw-alias-bg-layer-1);
}
.rt-card.rt-onboard-card.is-compact{
  padding:11px 16px;
  gap:6px;
}
body[data-ds-dark-theme] .rt-card.rt-onboard-card{
  border-color:rgba(96,165,250,.34);
  background:linear-gradient(135deg,rgba(59,130,246,.14) 0%,rgba(14,165,233,.06) 100%),var(--dsw-alias-bg-layer-2);
}
.rt-onboard-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  flex-wrap:wrap;
}
.rt-onboard-title{
  font-size:14.5px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
}
.rt-onboard-steps{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:10px;
}
@media(max-width:820px){
  .rt-onboard-steps{
    grid-template-columns:1fr;
  }
}
.rt-onboard-step{
  display:flex;
  flex-direction:column;
  gap:4px;
  padding:10px 12px;
  border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);
}
body[data-ds-dark-theme] .rt-onboard-step{
  background:rgba(15,23,42,.45);
  border-color:rgba(148,163,184,.18);
}
.rt-onboard-step strong{
  font-size:12px;
  color:var(--dsw-alias-label-primary);
}
.rt-onboard-step span{
  font-size:11.5px;
  line-height:1.5;
  color:var(--dsw-alias-label-secondary);
}
.rt-onboard-actions{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
}
.rt-onboard-bind-details{
  font-size:12px;
  color:var(--dsw-alias-label-secondary);
  padding:8px 12px;
  border-radius:8px;
  border:1px dashed var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);
}
.rt-onboard-bind-details > summary{
  cursor:pointer;
  font-weight:600;
  color:var(--wb-blue-ink,#2563eb);
}
body[data-ds-dark-theme] .rt-onboard-bind-details > summary{
  color:#93c5fd;
}
.rt-onboard-foot-note{
  font-size:11.5px;
  color:var(--dsw-alias-label-secondary);
}

/* Card 2: Clarification Quick-Chips */
.rt-clarify-chips-row{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
  margin-bottom:4px;
}

/* Card 3: Approval Queue Cards */
.rt-approval-list{
  display:flex;
  flex-direction:column;
  gap:12px;
}
.rt-approval-card{
  display:flex;
  flex-direction:column;
  gap:9px;
  padding:12px 14px;
  border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);
  box-sizing:border-box;
}
.rt-approval-card.is-pending{
  border-left:3.5px solid #f59e0b;
}
body[data-ds-dark-theme] .rt-approval-card{
  background:rgba(15,23,42,.42);
  border-color:rgba(148,163,184,.2);
}
.rt-approval-digest-grid{
  display:flex;
  flex-direction:column;
  gap:4px;
  padding:8px 10px;
  border-radius:8px;
  background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-border-l1);
  font-size:12px;
  line-height:1.5;
}
body[data-ds-dark-theme] .rt-approval-digest-grid{
  background:rgba(30,41,59,.65);
  border-color:rgba(148,163,184,.18);
}
.rt-tag-warn{
  color:#b45309;
  background:rgba(245,158,11,.15);
  border-color:rgba(245,158,11,.35);
}
body[data-ds-dark-theme] .rt-tag-warn{
  color:#fbbf24;
  background:rgba(245,158,11,.2);
  border-color:rgba(251,191,36,.38);
}

/* Clean Overview Tab (v0.22.0) */
.rt-ov-standby-card{
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:12px;
  padding:26px 24px;
  border-radius:14px;
  border:1.5px dashed rgba(77,107,254,.36);
  background:linear-gradient(135deg,rgba(77,107,254,.05) 0%,rgba(16,185,129,.03) 100%),var(--dsw-alias-bg-layer-1);
}
body[data-ds-dark-theme] .rt-ov-standby-card{
  border-color:rgba(96,165,250,.38);
  background:linear-gradient(135deg,rgba(59,130,246,.12) 0%,rgba(16,185,129,.05) 100%),var(--dsw-alias-bg-layer-2);
}
.rt-ov-standby-badge-row{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
}
.rt-ov-standby-title{
  font-size:17px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
}
.rt-ov-standby-sub{
  font-size:12.5px;
  line-height:1.6;
  color:var(--dsw-alias-label-secondary);
  max-width:740px;
}
.rt-ov-standby-actions{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
  margin-top:2px;
}

.rt-ov-action-banner{
  display:flex;
  align-items:center;
  gap:10px;
  flex-wrap:wrap;
  padding:9px 14px;
  border-radius:10px;
  font-size:12.5px;
  border:1px solid rgba(77,107,254,.28);
  background:rgba(77,107,254,.06);
  color:var(--dsw-alias-label-primary);
}
.rt-ov-action-banner.is-pending{
  border-color:rgba(245,158,11,.42);
  background:rgba(245,158,11,.1);
}
body[data-ds-dark-theme] .rt-ov-action-banner{
  border-color:rgba(96,165,250,.32);
  background:rgba(59,130,246,.14);
}
body[data-ds-dark-theme] .rt-ov-action-banner.is-pending{
  border-color:rgba(251,191,36,.42);
  background:rgba(245,158,11,.18);
}

.rt-ov-kpi-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:12px;
}
@media(max-width:920px){
  .rt-ov-kpi-grid{
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
}
@media(max-width:520px){
  .rt-ov-kpi-grid{
    grid-template-columns:1fr;
  }
}
.rt-ov-kpi-card{
  display:flex;
  flex-direction:column;
  gap:4px;
  padding:12px 14px;
  border-radius:12px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  box-sizing:border-box;
  min-width:0;
}
.rt-ov-kpi-card.is-interactive{
  cursor:pointer;
  transition:border-color .14s ease,transform .12s ease;
}
.rt-ov-kpi-card.is-interactive:hover{
  border-color:#3b82f6;
  transform:translateY(-1px);
}
body[data-ds-dark-theme] .rt-ov-kpi-card{
  background:var(--dsw-alias-bg-layer-2);
  border-color:rgba(148,163,184,.2);
}
.rt-ov-kpi-label{
  font-size:11.5px;
  font-weight:600;
  color:var(--dsw-alias-label-secondary);
}
.rt-ov-kpi-val{
  font-size:15px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.rt-ov-kpi-val.accent{
  color:var(--wb-blue-ink,#2563eb);
}
body[data-ds-dark-theme] .rt-ov-kpi-val.accent{
  color:#93c5fd;
}
.rt-ov-kpi-sub{
  font-size:11px;
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}

.rt-ov-node-strip{
  display:flex;
  flex-direction:column;
  gap:5px;
  padding:10px 14px;
  border-radius:10px;
  border:1px solid rgba(59,130,246,.34);
  background:linear-gradient(90deg,rgba(59,130,246,.07) 0%,transparent 100%),var(--dsw-alias-bg-layer-1);
  box-sizing:border-box;
}
body[data-ds-dark-theme] .rt-ov-node-strip{
  border-color:rgba(96,165,250,.38);
  background:linear-gradient(90deg,rgba(59,130,246,.16) 0%,transparent 100%),var(--dsw-alias-bg-layer-2);
}

/* ══════════════════════════════════════════════════════════════════
   04-inspector-swimlane.css — Lower Process Deck, Swimlane Sequence Chart,
   Collaboration Work Items, Agent Inspector Drawer, Editable Goals & Node Retry
   ══════════════════════════════════════════════════════════════════ */

.rt-lower-process-deck,
.rt-p4-right,
.rt-p4-right-col{
  display:flex;
  flex-direction:column;
  gap:16px;
  width:100%;
  min-width:0;
  box-sizing:border-box;
}
.rt-collab-grid{
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(300px, 1fr));
  gap:12px;
  width:100%;
  box-sizing:border-box;
}

/* 跨 Agent 协作 Swimlane Sequence Chart (.rt-swim-pane) */
.rt-swim-pane{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:12px;
  padding:12px 14px;
  background:var(--dsw-alias-bg-layer-1);
  display:flex;
  flex-direction:column;
  gap:8px;
  width:100%;
  min-width:0;
  box-sizing:border-box;
  box-shadow:0 2px 10px -4px rgba(15,23,42,.06);
}
.rt-swim-toolbar{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
  padding-bottom:6px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  font-size:11.5px;
  color:var(--dsw-alias-label-secondary);
}
.rt-swim-search{
  flex:1;
  min-width:100px;
  max-width:200px;
  background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
  border-radius:6px;
  padding:3px 8px;
  font-size:11.5px;
  font-family:inherit;
  outline:none;
  transition:border-color .15s,box-shadow .15s;
}
.rt-swim-search:focus{
  border-color:#4d6bfe;
  box-shadow:0 0 0 2px rgba(77,107,254,.16);
}
.rt-swim-table{
  position:relative;
  display:flex;
  flex-direction:column;
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:9px;
  background:var(--dsw-alias-bg-base);
  overflow-x:auto;
  overflow-y:hidden;
}
.rt-swim-row{
  display:grid;
  grid-template-columns:170px minmax(220px,1fr);
  align-items:stretch;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  min-height:54px;
  position:relative;
  transition:background .12s;
}
.rt-swim-row:last-child{border-bottom:0}
.rt-swim-row:hover{background:color-mix(in srgb,#4d6bfe 4%,var(--dsw-alias-bg-layer-2))}
.rt-swim-row.active,.rt-swim-row.on{background:rgba(77,107,254,.07)}
.rt-swim-agent{
  width:170px;
  box-sizing:border-box;
  padding:6px 9px;
  border-right:1px solid var(--dsw-alias-border-l1);
  display:flex;
  align-items:flex-start;
  gap:7px;
  min-width:0;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 82%,transparent);
  z-index:2;
}
.rt-swim-agent-info,.rt-swim-agent-body{
  flex:1;
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:1px;
}
.rt-swim-agent-title,.rt-swim-agent-name{
  font-size:11.5px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.rt-swim-agent-meta,.rt-swim-agent-sub{
  font-size:9.5px;
  color:var(--dsw-alias-label-secondary);
  font-family:ui-monospace,Menlo,monospace;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  line-height:1.35;
}
.rt-swim-track{
  position:relative;
  display:flex;
  align-items:center;
  gap:14px;
  padding:8px 14px;
  min-height:44px;
  min-width:220px;
  z-index:1;
}
.rt-swim-track::before{
  content:'';
  position:absolute;
  left:10px;
  right:10px;
  top:50%;
  height:1.5px;
  background:var(--dsw-alias-border-l1);
  z-index:0;
  pointer-events:none;
}
.rt-swim-ev{
  position:relative;
  z-index:2;
  width:20px;
  height:20px;
  border-radius:6px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  font-size:11px;
  font-weight:700;
  font-family:ui-monospace,Menlo,monospace;
  color:#fff;
  background:#4d6bfe;
  border:1.5px solid var(--dsw-alias-bg-base);
  box-shadow:0 1px 4px rgba(15,23,42,.18);
  cursor:pointer;
  flex:none;
  transition:transform .12s ease,box-shadow .12s ease;
}
.rt-swim-ev:hover{
  transform:scale(1.14);
  box-shadow:0 2px 8px rgba(77,107,254,.35);
}
.rt-swim-ev.role-wd{background:#ef4444}
.rt-swim-ev.role-wr{background:#10b981}
.rt-swim-ev.role-wa{background:#8b5cf6}
.rt-swim-ev.role-wb{background:#3b82f6}
.rt-swim-ev.role-wc{background:#f59e0b}
.rt-swim-ev.role-wq{background:#06b6d4}
.rt-swim-ev.role-wp{background:#6366f1}
.rt-swim-ev.role-wf{background:#ec4899}
.rt-swim-ev.done{background:#10b981}
.rt-swim-ev.warn,.rt-swim-ev.stop{background:#f59e0b}
.rt-swim-svg{
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  pointer-events:none;
  z-index:1;
  overflow:visible;
}
.rt-swim-matrix-wrap{
  position:relative;
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px;
  background:var(--dsw-alias-bg-layer-1);
  overflow:hidden;
}

/* 协作任务 Work Items (.rt-collab-pane) */
.rt-collab-pane{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:12px;
  padding:12px 14px;
  background:var(--dsw-alias-bg-layer-1);
  display:flex;
  flex-direction:column;
  gap:8px;
  width:100%;
  min-width:0;
  box-sizing:border-box;
  box-shadow:0 2px 10px -4px rgba(15,23,42,.06);
}
.rt-collab-tabs{
  display:flex;
  align-items:center;
  gap:5px;
  flex-wrap:wrap;
}
.rt-collab-tab,.rt-collab-tabs>button,.rt-collab-tabs>span{
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-secondary);
  border-radius:999px;
  padding:2px 10px;
  font-size:11px;
  font-weight:600;
  cursor:pointer;
  font-family:inherit;
  transition:background .14s,color .14s,border-color .14s;
}
.rt-collab-tab:hover,.rt-collab-tabs>button:hover{
  border-color:#4d6bfe;
  color:var(--dsw-alias-label-primary);
}
.rt-collab-tab.on,.rt-collab-tab.active,.rt-collab-tabs>button.on,.rt-collab-tabs>button.active,.rt-collab-tabs>span.on{
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);
  border-color:#4d6bfe;
  color:#fff;
}
.rt-collab-list{
  display:flex;
  flex-direction:column;
  gap:8px;
  max-height:360px;
  overflow-y:auto;
  padding-right:2px;
}
.rt-collab-item{
  border:1px solid var(--dsw-alias-border-l1);
  border-left:3px solid #4d6bfe;
  border-radius:10px;
  padding:9px 11px;
  background:rgba(77,107,254,.05);
  display:flex;
  flex-direction:column;
  gap:5px;
  min-width:0;
  transition:border-color .14s,box-shadow .14s;
}
.rt-collab-item:hover{
  box-shadow:0 2px 8px rgba(15,23,42,.06);
}
.rt-collab-item.role-wa{background:rgba(139,92,246,.06);border-left-color:#8b5cf6;border-color:rgba(139,92,246,.26)}
.rt-collab-item.role-wd{background:rgba(239,68,68,.06);border-left-color:#ef4444;border-color:rgba(239,68,68,.26)}
.rt-collab-item.role-wr{background:rgba(16,185,129,.06);border-left-color:#10b981;border-color:rgba(16,185,129,.26)}
.rt-collab-item.role-wb{background:rgba(59,130,246,.06);border-left-color:#3b82f6;border-color:rgba(59,130,246,.26)}
.rt-collab-item.role-wc{background:rgba(245,158,11,.06);border-left-color:#f59e0b;border-color:rgba(245,158,11,.26)}
.rt-collab-item.role-wq{background:rgba(6,182,212,.06);border-left-color:#06b6d4;border-color:rgba(6,182,212,.26)}
.rt-collab-item.role-wp{background:rgba(99,102,241,.06);border-left-color:#6366f1;border-color:rgba(99,102,241,.26)}
.rt-collab-item.role-wf{background:rgba(236,72,153,.06);border-left-color:#ec4899;border-color:rgba(236,72,153,.26)}
.rt-collab-head{
  display:flex;
  align-items:center;
  gap:7px;
  flex-wrap:wrap;
}
.rt-collab-title{
  font-size:12px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
  flex:1;
  min-width:0;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.rt-collab-status{
  font-size:10.5px;
  font-weight:600;
  padding:1px 7px;
  border-radius:999px;
  white-space:nowrap;
  display:inline-flex;
  align-items:center;
  gap:4px;
}
.rt-collab-status.run{color:#2563eb;background:rgba(77,107,254,.14)}
.rt-collab-status.done{color:#059669;background:rgba(16,185,129,.14)}
.rt-collab-status.wait{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
body[data-ds-dark-theme] .rt-collab-status.run{color:#93c5fd;background:rgba(77,107,254,.2)}
body[data-ds-dark-theme] .rt-collab-status.done{color:#34d399;background:rgba(16,185,129,.2)}
.rt-collab-desc{
  font-size:11.5px;
  color:var(--dsw-alias-label-secondary);
  line-height:1.55;
  word-break:break-word;
}
.rt-collab-desc:not(.open){
  display:-webkit-box;
  -webkit-line-clamp:2;
  -webkit-box-orient:vertical;
  overflow:hidden;
}

/* 3-Stage Step Chain & Two-Step Inspector Drawer */
.rt-step-chain{
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  align-items: center;
  width: 100%;
  padding: 6px 10px;
  box-sizing: border-box;
  position: relative;
}
.rt-step-node{
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  position: relative;
}
.rt-step-pill{
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  min-width: 0;
  flex: 1;
  position: relative;
  transition: border-color 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
}
body[data-ds-dark-theme] .rt-step-pill{
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 88%, var(--dsw-alias-bg-base));
  border-color: rgba(148,163,184,0.22);
}
.rt-step-pill:hover{
  border-color: #3b82f6;
  transform: translateY(-1px);
  box-shadow: 0 4px 10px -2px rgba(59,130,246,0.16);
}
body[data-ds-dark-theme] .rt-step-pill:hover{
  border-color: #60a5fa;
  box-shadow: 0 4px 12px -2px rgba(59,130,246,0.3);
}
.rt-step-arrow{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  font-size: 11px;
  font-weight: 700;
  color: var(--dsw-alias-label-secondary);
  opacity: 0.78;
  user-select: none;
}
body[data-ds-dark-theme] .rt-step-arrow{
  color: #93c5fd;
  opacity: 0.85;
}
.rt-agent-inspector-drawer{
  width: 100%;
  box-sizing: border-box;
  border: 1.5px solid #3b82f6;
  border-radius: 12px;
  padding: 12px 14px;
  background: linear-gradient(180deg, rgba(59,130,246,0.08) 0%, transparent 46%), var(--dsw-alias-bg-layer-1);
  box-shadow: 0 8px 24px -6px rgba(59,130,246,0.22);
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: rt-subnode-spawn 0.36s cubic-bezier(0.34, 1.56, 0.64, 1);
}
body[data-ds-dark-theme] .rt-agent-inspector-drawer{
  border-color: #60a5fa;
  background: linear-gradient(180deg, rgba(59,130,246,0.16) 0%, transparent 52%), var(--dsw-alias-bg-layer-2);
  box-shadow: 0 10px 28px -6px rgba(0,0,0,0.45), 0 0 0 1px rgba(96,165,250,0.22);
}
.rt-jump-chat-btn{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  color: #ffffff;
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border: 1px solid #2563eb;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(59,130,246,0.28);
  transition: transform 0.14s ease, box-shadow 0.14s ease, opacity 0.14s ease;
}
.rt-jump-chat-btn:hover{
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(59,130,246,0.38);
}
body[data-ds-dark-theme] .rt-jump-chat-btn{
  background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
  border-color: #60a5fa;
  box-shadow: 0 2px 12px rgba(59,130,246,0.42);
}

/* lmtex Worker Priority Badges (P0~P3), Domain Tags, Compressed Digest Pill & Plan Approval Button */
.rt-pri-badge{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 10px;
  line-height: 1.3;
  padding: 1px 6px;
  border-radius: 999px;
  font-family: ui-monospace, Menlo, monospace;
  white-space: nowrap;
  box-sizing: border-box;
}
.rt-pri-badge-p0{
  background: rgba(239, 68, 68, 0.14);
  color: #dc2626;
  border: 1px solid rgba(239, 68, 68, 0.35);
  font-weight: 700;
}
.rt-pri-badge-p1{
  background: rgba(37, 99, 235, 0.12);
  color: #2563eb;
  border: 1px solid rgba(37, 99, 235, 0.3);
  font-weight: 700;
}
.rt-pri-badge-p2{
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.3);
  font-weight: 600;
}
.rt-pri-badge-p3{
  background: rgba(100, 116, 139, 0.12);
  color: #475569;
  border: 1px solid rgba(100, 116, 139, 0.25);
}
body[data-ds-dark-theme] .rt-pri-badge-p0{
  color: #f87171;
  background: rgba(239, 68, 68, 0.22);
  border-color: rgba(248, 113, 113, 0.42);
}
body[data-ds-dark-theme] .rt-pri-badge-p1{
  color: #93c5fd;
  background: rgba(37, 99, 235, 0.22);
  border-color: rgba(96, 165, 250, 0.42);
}
body[data-ds-dark-theme] .rt-pri-badge-p2{
  color: #34d399;
  background: rgba(16, 185, 129, 0.2);
  border-color: rgba(52, 211, 153, 0.38);
}
body[data-ds-dark-theme] .rt-pri-badge-p3{
  color: #cbd5e1;
  background: rgba(100, 116, 139, 0.24);
  border-color: rgba(148, 163, 184, 0.34);
}
.rt-worker-tag-pill{
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  font-family: ui-monospace, Menlo, monospace;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1);
  white-space: nowrap;
  box-sizing: border-box;
}
.rt-digest-box{
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid rgba(16, 185, 129, 0.32);
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.08), rgba(59, 130, 246, 0.04)), var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 11.5px;
  line-height: 1.55;
  box-sizing: border-box;
}
body[data-ds-dark-theme] .rt-digest-box{
  border-color: rgba(52, 211, 153, 0.35);
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.14), rgba(59, 130, 246, 0.08)), var(--dsw-alias-bg-layer-2);
}
.rt-digest-pill{
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  font-family: ui-monospace, Menlo, monospace;
  color: #059669;
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.32);
  white-space: nowrap;
}
body[data-ds-dark-theme] .rt-digest-pill{
  color: #34d399;
  background: rgba(16, 185, 129, 0.22);
  border-color: rgba(52, 211, 153, 0.4);
}
.rt-plan-approve-btn{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  color: #ffffff;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  border: 1px solid #059669;
  cursor: pointer;
  box-shadow: 0 2px 10px rgba(16, 185, 129, 0.28);
  transition: transform 0.14s ease, box-shadow 0.14s ease, opacity 0.14s ease;
}
.rt-plan-approve-btn:hover{
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.38);
}
body[data-ds-dark-theme] .rt-plan-approve-btn{
  background: linear-gradient(135deg, #34d399 0%, #10b981 100%);
  border-color: #34d399;
  box-shadow: 0 2px 12px rgba(16, 185, 129, 0.4);
}

/* v0.21.0 Inline Editable Goal / nextGoal Inputs & Single-Node Retry Button */
.rt-goal-edit-row{
  display:flex;
  align-items:center;
  gap:7px;
  flex-wrap:wrap;
  width:100%;
  box-sizing:border-box;
}
.rt-goal-edit-input{
  flex:1 1 200px;
  width:100%;
  min-width:0;
  box-sizing:border-box;
  padding:6px 10px;
  border-radius:8px;
  border:1.5px solid var(--rt-border,var(--dsw-alias-border-l1));
  background:var(--rt-bg-base,var(--dsw-alias-bg-base));
  color:var(--rt-text-primary,var(--dsw-alias-label-primary));
  font-size:12px;
  font-family:inherit;
  line-height:1.5;
  outline:none;
  transition:border-color .15s ease,box-shadow .15s ease;
}
.rt-goal-edit-input:hover{
  border-color:var(--rt-border-strong,var(--dsw-alias-border-l2));
}
.rt-goal-edit-input:focus{
  border-color:var(--wb-blue,#4d6bfe);
  box-shadow:0 0 0 3px var(--wb-blue-soft,rgba(77,107,254,.16));
}
.rt-node-retry-btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:5px;
  padding:5px 11px;
  border-radius:8px;
  font-size:11.5px;
  font-weight:700;
  font-family:inherit;
  color:#ffffff;
  background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);
  border:1px solid #d97706;
  cursor:pointer;
  white-space:nowrap;
  box-shadow:0 2px 8px rgba(245,158,11,.26);
  transition:transform .14s ease,box-shadow .14s ease,opacity .14s ease;
}
.rt-node-retry-btn:hover{
  transform:translateY(-1px);
  box-shadow:0 4px 12px rgba(245,158,11,.36);
}
.rt-node-retry-btn:disabled{
  opacity:.55;
  cursor:default;
  transform:none;
}
body[data-ds-dark-theme] .rt-node-retry-btn{
  background:linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%);
  border-color:#fbbf24;
  color:#0f172a;
}

/* ══════════════════════════════════════════════════════════════════
   05-tabs.css — Bento Analytics Cards, PgWriteProbeCard, ShardLock Table,
   Concurrency & Role Cards, Software Engineering Review, Report & DocWall
   ══════════════════════════════════════════════════════════════════ */
.rt-seg{padding:7px 8px;border-radius:6px;cursor:pointer;margin-bottom:4px;border:1px solid transparent}
.rt-seg:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-seg.on{background:var(--dsw-alias-bg-layer-2);border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-seg-cidr{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
.rt-seg-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.rt-table{flex:1;overflow:auto}
.rt-row{display:grid;grid-template-columns:150px 74px 104px 1.15fr 1fr;gap:8px;padding:6px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;cursor:pointer;font-size:12.5px}
.rt-row:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-row.head{cursor:default;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;position:sticky;top:0;
  background:var(--dsw-alias-bg-layer-1);z-index:1}
.rt-row.head:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-mono{font-family:ui-monospace,Menlo,monospace}
.rt-tag{display:inline-block;padding:0 5px;border-radius:4px;font-size:11px;margin-right:4px;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-tag-passive{color:#6366f1;border-color:#6366f155;background:#6366f11a}
.rt-tag-active{color:#0ea5e9;border-color:#0ea5e955;background:#0ea5e91a}
.rt-tag-live{color:#4d6bfe;border-color:#4d6bfe55;background:#4d6bfe1a}
.rt-tag-warn{color:#ef4444;border-color:#ef444455;background:#ef44441a}
/* 纪律提示条：不满足交付要求时顶在区块最上方 */
.rt-hint{border-radius:6px;padding:7px 9px;margin-bottom:8px;font-size:11.5px;line-height:1.6;
  border:1px dashed #ef444488;background:#ef44440f;color:var(--dsw-alias-label-primary)}
.rt-hint b{color:#ef4444}
.rt-tag-dead{color:var(--dsw-alias-label-secondary)}
.rt-expand{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-kv{display:flex;gap:8px;margin-bottom:3px;align-items:baseline}
.rt-kv b{color:var(--dsw-alias-label-primary);font-weight:600;min-width:64px;flex:none}
.rt-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-2)}
.rt-card h4{margin:0 0 6px;font-size:13px}
.rt-item{padding:7px 8px;border-radius:6px;cursor:pointer;margin-bottom:4px;border:1px solid transparent}
.rt-item:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-item.on{background:var(--dsw-alias-bg-layer-2);border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-item-name{font-weight:600;font-size:12.5px}
.rt-item-desc{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rt-test{display:inline-block;padding:0 5px;border-radius:4px;font-size:11px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.rt-test-testing{color:#0ea5e9;border-color:#0ea5e955;background:#0ea5e91a}
.rt-test-tested{color:#4d6bfe;border-color:#4d6bfe55;background:#4d6bfe1a}
.rt-test-blocked{color:#fff;background:#ef4444;border-color:#ef4444}
.rt-test-abandoned{color:#94a3b8;border-color:#94a3b855;background:#94a3b81a}
.rt-test-no_surface{color:#6366f1;border-color:#6366f155;background:#6366f11a}
.rt-pri{display:inline-block;padding:0 6px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap}
.rt-pri-high{color:#fff;background:#4d6bfe}
.rt-pri-medium{color:#fff;background:#0ea5e9}
.rt-pri-low{color:#fff;background:#94a3b8}
.rt-score-row{display:grid;grid-template-columns:16px 62px minmax(0,1fr) 116px 66px;gap:8px;padding:7px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;font-size:12.5px;cursor:pointer}
.rt-score-row:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-score-row.head{cursor:default;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;
  position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);z-index:1}
.rt-score-detail{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
/* 得分目标按合并版的 8 个类别分组：类别头 + 组内按分值升序 */
.rt-score-group{display:flex;align-items:center;gap:8px;padding:7px 10px 5px;margin-top:2px;
  font-size:12px;font-weight:600;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.rt-score-group:first-child{border-top:none}
.rt-score-group .rt-sg-sub{font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary)}
/* ── 会话与入口：每张卡片分「标题行 / 关键事实 / 可用命令 / 备注」四段，避免一行糊在一起 ── */
.rt-sess-facts{display:flex;flex-direction:column;gap:2px;margin-top:5px}
.rt-sess-fact{display:flex;gap:6px;font-size:11.5px;line-height:1.5}
.rt-sess-fact>b{flex:none;min-width:62px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.rt-sess-fact>span{min-width:0;overflow-wrap:anywhere}
.rt-sess-cmd{margin-top:6px}
.rt-sess-cmd>b{display:block;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:3px;font-weight:600}
.rt-sess-fold{margin-top:6px;font-size:11.5px}
.rt-sess-fold>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);user-select:none}
.rt-sess-fold>summary:hover{color:var(--dsw-alias-label-primary)}
.rt-score-row .rt-scope{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.rt-score-form{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px}
.rt-score-form input,.rt-score-form select{width:100%;box-sizing:border-box}
.rt-vrow{display:grid;grid-template-columns:62px minmax(0,1fr) 132px 108px 74px 52px;gap:8px;padding:6px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;font-size:12.5px;cursor:pointer}
.rt-vrow:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-vrow.head{cursor:default;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;
  position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);z-index:1}
.rt-vdetail{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-vdetail .rt-kv{margin-bottom:4px}
.rt-actions{display:flex;gap:6px;margin-top:6px}
.rt-section{padding:8px 10px 2px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.rt-link{color:var(--wb-blue,var(--dsw-alias-brand-primary));text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-link:hover{text-decoration:underline}
.rt-chain{flex:1;overflow:auto;padding:10px 12px}
.rt-step{display:flex;gap:10px;padding:8px 6px;border-left:2px solid var(--dsw-alias-border-l1);margin-left:6px}
.rt-step:last-child{border-left-color:transparent}
.rt-step-dot{width:22px;height:22px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:700;color:#fff;background:#64748b;margin-left:-13px}
.rt-step-body{min-width:0}
.rt-step-title{font-weight:600;font-size:13px}
.rt-step-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:2px;word-break:break-word}
.rt-stage-recon{background:#4d6bfe}
.rt-stage-vuln{background:#0ea5e9}
.rt-stage-exploit{background:#2563eb}
.rt-stage-access{background:#4d6bfe}
.rt-stage-pivot{background:#6366f1}
.rt-stage-data{background:#0284c7}
.rt-stage-other{background:#64748b}
.rt-step-head{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.rt-step-time{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:auto;white-space:nowrap}
.rt-step-detail{font-size:12px;margin-top:5px;white-space:pre-wrap;word-break:break-word;
  border-left:2px solid var(--dsw-alias-border-l1);padding:2px 0 2px 9px;line-height:1.6}
.rt-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;padding:1px 7px;border-radius:5px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);margin:4px 5px 0 0;max-width:100%}
.rt-chip>i{font-style:normal;color:var(--dsw-alias-label-secondary);font-size:10.5px}
.rt-chip>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px}
.rt-stage-tag{display:inline-block;padding:0 6px;border-radius:4px;font-size:11px;color:#fff;font-weight:600}
.rt-st-recon{background:#4d6bfe}.rt-st-vuln{background:#0ea5e9}.rt-st-exploit{background:#2563eb}
.rt-st-access{background:#4d6bfe}.rt-st-pivot{background:#6366f1}.rt-st-data{background:#0284c7}.rt-st-other{background:#64748b}
.rt-sev{display:inline-block;padding:0 6px;border-radius:4px;font-size:11px;font-weight:600;border:1px solid transparent}
.rt-sev-critical{color:#fff;background:#b91c1c}.rt-sev-high{color:#fff;background:#ef4444}
.rt-sev-medium{color:#7c2d12;background:#fdba74}.rt-sev-low{color:#1e3a8a;background:#bfdbfe}
.rt-sev-info{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1)}
.rt-dot-on{display:inline-block;width:7px;height:7px;border-radius:50%;background:#4d6bfe;box-shadow:0 0 0 3px #4d6bfe33}
.rt-dot-off{display:inline-block;width:7px;height:7px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 3px #ef444433}
.rt-dot-unk{display:inline-block;width:7px;height:7px;border-radius:50%;background:#94a3b8;box-shadow:0 0 0 3px #94a3b833}
.rt-sess-grid{display:grid;grid-template-columns:1fr;gap:8px;padding:10px 12px}
.rt-sess{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:9px 10px;background:var(--dsw-alias-bg-layer-2)}
.rt-sess-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-sess-title{font-weight:600;font-size:12.5px;font-family:ui-monospace,Menlo,monospace;word-break:break-all}
.rt-sess-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:3px;word-break:break-word}
.rt-code{font-family:ui-monospace,Menlo,monospace;font-size:11px;background:var(--dsw-alias-bg-base);
  border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:1px 5px;cursor:pointer;word-break:break-all}
.rt-code:hover{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-evi{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;margin-top:8px}
.rt-evi-head{display:flex;align-items:center;gap:8px;padding:5px 9px;background:var(--dsw-alias-bg-layer-2);
  font-size:11.5px;font-weight:600;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-evi-body{margin:0;padding:9px 11px;font-family:ui-monospace,Menlo,monospace;font-size:11.5px;line-height:1.6;
  white-space:pre-wrap;word-break:break-word;max-height:340px;overflow:auto;background:var(--dsw-alias-bg-base)}
.rt-evi-body.req{max-height:220px}
.rt-hl-req{color:#4d6bfe;font-weight:600}
.rt-hl-res{color:#0ea5e9;font-weight:600}
.rt-gain{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:12px;
  color:var(--wb-blue-ink,#1e40af);background:var(--wb-blue-pill,#dbeafe);border:1px solid #4d6bfe55}
.rt-total{font-size:20px;font-weight:700;font-family:ui-monospace,Menlo,monospace}
.rt-sidehead{padding:7px 8px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);
  display:flex;align-items:center;gap:5px}
.rt-sidehead-btn{cursor:pointer;outline:none;padding:6px 6px 5px;border-radius:5px;user-select:none}
.rt-sidehead-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.rt-sidehead-btn:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-scope{display:inline-block;padding:0 4px;border-radius:3px;font-size:10px;font-weight:700;line-height:15px;flex:none}
.rt-scope-internal{color:var(--wb-blue-ink,#1e40af);background:var(--wb-blue-pill,#dbeafe)}
.rt-scope-external{color:#0ea5e9;background:rgba(14,165,233,.14)}
/* 「当前测试」的标记：既不是内网也不是外网，用蓝紫单独区分 */
.rt-scope-testing{color:#6366f1;background:rgba(99,102,241,.14)}
.rt-hits{display:flex;flex-direction:column;gap:6px;margin-top:7px}
.rt-hit{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:6px;
  padding:7px 9px;background:var(--dsw-alias-bg-layer-2)}
.rt-hit-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-hit-idx{width:16px;height:16px;border-radius:50%;background:#4d6bfe;color:#fff;font-size:10.5px;font-weight:700;
  display:inline-flex;align-items:center;justify-content:center;flex:none}
.rt-hit-target{font-family:ui-monospace,Menlo,monospace;font-weight:600;font-size:12px;word-break:break-all}
.rt-hit-time{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-hit-evi{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;line-height:1.65;white-space:pre-wrap;word-break:break-word;
  background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:6px 8px;margin-top:5px}
.rt-hit-note{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:4px}
.rt-cred{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #0ea5e9;border-radius:6px;
  padding:8px 10px;background:var(--dsw-alias-bg-layer-2);margin-bottom:7px}
.rt-cred-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-cred-host{font-family:ui-monospace,Menlo,monospace;font-weight:600;font-size:12.5px;word-break:break-all}
.rt-secret{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;background:color-mix(in srgb,var(--wb-blue,#4d6bfe) 10%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);
  border:1px solid #4d6bfe55;border-radius:5px;padding:6px 9px;margin-top:6px;white-space:pre-wrap;word-break:break-all;
  user-select:all;cursor:text}
.rt-secret-none{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--dsw-alias-state-error-primary);
  border:1px dashed var(--dsw-alias-state-error-primary);border-radius:5px;padding:5px 9px;margin-top:6px}
.rt-cred-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:5px;word-break:break-word}
.rt-stage-score{background:#4d6bfe}
.rt-counted{font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:700;color:var(--wb-blue-ink,#1e40af);background:var(--wb-blue-pill,#dbeafe);border:1px solid #4d6bfe55;border-radius:9px;padding:0 7px}
.rt-scorepts{font-size:11.5px;font-weight:700;color:var(--wb-blue-ink,#1e40af);background:var(--wb-blue-pill,#dbeafe);border:1px solid #4d6bfe55;
  border-radius:10px;padding:0 7px;white-space:nowrap}
.rt-livebar{display:flex;align-items:center;gap:7px;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);flex-wrap:wrap}
.rt-live-dot{width:8px;height:8px;border-radius:50%;background:#4d6bfe;flex:none;animation:rt-pulse 1.6s ease-in-out infinite}
.rt-live-dot.idle{background:#94a3b8;animation:none}
.rt-live-body{padding:8px 12px 2px;max-height:44vh;overflow:auto}
.rt-atest{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:6px;
  padding:7px 10px;background:var(--dsw-alias-bg-layer-2);margin-bottom:6px}
.rt-atest.past{border-left-color:#94a3b8;opacity:.85}
.rt-atest-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-atest-ip{font-family:ui-monospace,Menlo,monospace;font-weight:600;font-size:12.5px;word-break:break-all}
.rt-atest-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:3px;word-break:break-word}
.rt-atest-notes{font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;
  word-break:break-word;background:var(--dsw-alias-bg-base);border-radius:4px;padding:5px 7px;margin-top:4px;max-height:76px;overflow:auto}
.rt-concl{display:flex;align-items:center;gap:4px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);flex-wrap:wrap}
.rt-concl-i{display:inline-flex;align-items:baseline;gap:4px;padding:2px 8px;border-radius:6px;cursor:pointer;
  border:1px solid transparent}
.rt-concl-i:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.rt-concl-i.on{border-color:var(--wb-blue,var(--dsw-alias-brand-primary));background:var(--dsw-alias-bg-layer-1)}
.rt-concl-i b{font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:700}
.rt-concl-i>span{color:var(--dsw-alias-label-secondary);font-size:11.5px}
.rt-more{color:var(--wb-blue,var(--dsw-alias-brand-primary));font-size:11.5px;cursor:pointer;user-select:none;margin-top:4px;display:inline-block}
.rt-more:hover{text-decoration:underline}
.rt-sevbar{width:3px;border-radius:2px;align-self:stretch;flex:none;margin-right:2px}

/* ── 折叠层次体系 ───────────────────────────────────────────────────────────── */
.rt-sec-wrap{margin:0}
.rt-sec{display:flex;align-items:center;gap:8px;padding:7px 12px 7px 9px;cursor:pointer;
  background:var(--dsw-alias-bg-layer-2);border-left:3px solid var(--dsw-alias-border-l2);
  border-top:1px solid var(--dsw-alias-border-l1);user-select:none;outline:none}
.rt-sec:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-sec:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-sec.flat{cursor:default}
.rt-sec.flat:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-sec-caret{flex:none;width:11px;font-size:10px;color:var(--dsw-alias-label-secondary);text-align:center}
.rt-sec-title{font-weight:600;font-size:13px;white-space:nowrap}
.rt-sec-count{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-sec-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-sec-right{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none}
.rt-sec.t-stage{border-left-color:#6366f1}
.rt-sec.t-target{border-left-color:#0ea5e9}
.rt-sec.t-folder{border-left-color:#64748b}
.rt-sec.t-test{border-left-color:#4d6bfe}
.rt-sec.t-queue{border-left-color:#0ea5e9}
.rt-sec.t-past{border-left-color:#94a3b8}
.rt-sec-body{margin-left:12px;border-left:1px solid var(--dsw-alias-border-l1);padding:7px 0 3px 10px}
.rt-sec-body>.rt-atest:last-child,.rt-sec-body>.rt-hit:last-child{margin-bottom:2px}
/* 长文本折叠（L3）：默认预览 2 行并渐隐，展开后限高滚动 */
.rt-clip{margin-top:6px}
.rt-clip-head{display:flex;align-items:center;gap:6px}
.rt-clip-label{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:600}
.rt-clip-body{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;line-height:1.65;white-space:pre-wrap;
  word-break:break-word;background:var(--dsw-alias-bg-base);border-radius:5px;padding:6px 8px;margin-top:3px}
.rt-clip:not(.open) .rt-clip-body{max-height:46px;overflow:hidden;
  -webkit-mask-image:linear-gradient(180deg,#000 55%,transparent);mask-image:linear-gradient(180deg,#000 55%,transparent)}
.rt-clip.open .rt-clip-body{max-height:340px;overflow:auto}
.rt-flow{padding:10px 12px 16px}
.rt-flow-start,.rt-flow-end{font-size:11.5px;color:var(--dsw-alias-label-secondary);padding:4px 0}
.rt-flow-end{font-weight:600;color:var(--dsw-alias-label-primary)}
.rt-flow-link{display:flex;align-items:center;gap:8px;padding:3px 0 3px 10px}
.rt-flow-arrow{color:var(--dsw-alias-border-l2);font-size:11px;flex:none}
.rt-flow-action{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-flow-action.inferred{opacity:.7;font-style:italic}
.rt-flow-node{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:8px;
  padding:8px 11px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;outline:none}
.rt-flow-node:hover{border-color:var(--dsw-alias-border-l2)}
.rt-flow-node:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-flow-node.overflow{border-left-color:#94a3b8;opacity:.75}
.rt-flow-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rt-flow-idx{width:18px;height:18px;border-radius:50%;background:#4d6bfe;color:#fff;font-size:11px;font-weight:700;
  display:inline-flex;align-items:center;justify-content:center;flex:none}
.rt-flow-node.overflow .rt-flow-idx{background:#94a3b8}
.rt-flow-name{font-weight:600;font-size:13px}
.rt-flow-pts{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;font-weight:700;color:#1e40af;
  background:#dbeafe;border:1px solid #4d6bfe55;border-radius:10px;padding:0 8px;white-space:nowrap}
.rt-flow-pts.off{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1)}
.rt-flow-times{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-flow-target{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;margin-top:4px;word-break:break-all;
  color:var(--dsw-alias-label-secondary)}
.rt-flow-gain{font-size:12px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-flow-detail{margin-top:7px;padding-top:7px;border-top:1px dashed var(--dsw-alias-border-l1)}
.rt-hflow-wrap{flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto}
.rt-hflow{display:flex;align-items:center;gap:0;padding:16px 12px;overflow-x:auto;flex-wrap:nowrap}
.rt-hflow-item{display:flex;align-items:center;flex:none}
.rt-hflow-start,.rt-hflow-end{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;padding:0 4px}
.rt-hflow-end{font-weight:600;color:var(--dsw-alias-label-primary)}
.rt-hflow-arrow{color:var(--dsw-alias-border-l2);padding:0 5px;font-size:13px;flex:none}
.rt-hflow-node{display:flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);
  border-left:3px solid #4d6bfe;border-radius:7px;padding:5px 8px;background:var(--dsw-alias-bg-layer-2);
  cursor:pointer;white-space:nowrap;outline:none}
.rt-hflow-node:hover{border-color:var(--dsw-alias-border-l2)}
.rt-hflow-node:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-hflow-node.overflow{border-left-color:#94a3b8;opacity:.72}
.rt-hflow-node.open{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-hflow-pts{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;font-weight:700;color:#1e40af;background:#dbeafe;
  border-radius:8px;padding:0 6px}
.rt-hflow-node.overflow .rt-hflow-pts{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.rt-hflow-name{font-size:11.5px}
.rt-hflow-n{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.rt-rep-list{padding:10px 12px 14px}
.rt-rep-tools{display:flex;gap:6px;justify-content:flex-end;margin-bottom:8px}
.rt-rep{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:8px;
  padding:9px 11px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-2)}
.rt-rep-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rt-rep-idx{font-size:15px;color:#4d6bfe;font-weight:700;flex:none}
.rt-rep-name{font-weight:600;font-size:13px}
.rt-rep-meta{font-size:12px;margin-top:4px;color:var(--dsw-alias-label-secondary);word-break:break-word}
.rt-rep-meta b{color:var(--dsw-alias-label-primary);font-weight:600;margin-right:2px}
.rt-rep-missing{font-size:11.5px;color:var(--dsw-alias-state-error-primary);margin-top:6px;
  border:1px dashed var(--dsw-alias-state-error-primary);border-radius:5px;padding:5px 8px}
.rt-rep-req{margin-top:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;overflow:hidden}
.rt-rep-req-head{display:flex;align-items:center;gap:7px;padding:4px 8px;font-size:11.5px;font-weight:600;
  background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-rep-http{margin:0;padding:8px 10px;font-family:ui-monospace,Menlo,monospace;font-size:11.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;background:var(--dsw-alias-bg-base)}
/* ── 报告里的「这一步怎么来的」：动作步骤 / 命令 / 凭据 / 隧道 ───────────── */
.rt-rep-trace{margin-top:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px 10px;
  background:var(--dsw-alias-bg-base)}
.rt-rep-trace-head{display:flex;align-items:center;gap:7px;margin-bottom:5px}
.rt-rep-trace-title{font-weight:600;font-size:12.5px}
.rt-rep-trace-how{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}
.rt-rep-step{border-left:2px solid var(--dsw-alias-border-l1);padding:2px 0 6px 9px;margin-bottom:6px}
.rt-rep-step-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.rt-rep-step-no{width:17px;height:17px;border-radius:50%;background:var(--wb-blue,var(--dsw-alias-brand-primary));color:#fff;
  font-size:10.5px;display:flex;align-items:center;justify-content:center;flex:none}
.rt-rep-step-title{font-weight:600;font-size:12.5px}
.rt-rep-step-detail{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.rt-rep-step-cmd{font-size:11.5px;margin-top:4px;display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap}
.rt-rep-step-cmd .rt-mono{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);
  border-radius:5px;padding:2px 6px;word-break:break-all}
.rt-rep-step-result{font-size:11.5px;margin-top:3px;word-break:break-word}
.rt-rep-src{margin-top:6px;padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l1)}
.rt-rep-src-title{font-weight:600;font-size:12px;margin-bottom:3px}
/* ── 全链路架构/路径图 ─────────────────────────────────────────────── */
.rt-ap{padding:10px 12px 18px;overflow:auto}
.rt-ap-stage{margin-bottom:2px}
.rt-ap-head{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--dsw-alias-bg-layer-2);
  border-left:4px solid #64748b;border-top:1px solid var(--dsw-alias-border-l1);border-radius:6px 6px 0 0}
.rt-ap-no{width:20px;height:20px;border-radius:5px;color:#fff;font-size:11px;font-weight:700;flex:none;
  display:inline-flex;align-items:center;justify-content:center}
.rt-ap-name{font-weight:700;font-size:13.5px}
.rt-ap-en{font-size:10px;color:var(--dsw-alias-label-secondary);letter-spacing:.3px}
.rt-ap-phase{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-ap-goal{display:flex;align-items:baseline;gap:8px;padding:6px 10px 6px 9px;font-size:12px;
  border-left:4px solid #64748b;background:var(--dsw-alias-bg-layer-1)}
.rt-ap-goal-tag{font-size:10.5px;font-weight:700;border:1px solid;border-radius:4px;padding:0 5px;white-space:nowrap;flex:none}
.rt-ap-result{padding:7px 10px 3px;border-left:4px solid transparent}
.rt-ap-result-head{display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap}
.rt-ap-pts{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;font-weight:700;color:#1e40af;background:#dbeafe;
  border:1px solid #4d6bfe55;border-radius:10px;padding:0 7px;white-space:nowrap}
.rt-ap-pts.off{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1)}
.rt-ap-pts.uncounted{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1)}
.rt-ap-nth{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-ap-hit{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:6px;
  padding:6px 9px;margin-bottom:5px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;outline:none}
.rt-ap-hit:hover{border-color:var(--dsw-alias-border-l2)}
.rt-ap-hit:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-ap-hit.overflow{border-left-color:#94a3b8;opacity:.75}
.rt-ap-hit-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-ap-hit-name{font-weight:600;font-size:12.5px}
.rt-ap-hit-target{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);
  margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46%}
.rt-ap-act{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:3px}
.rt-ap-act.inferred{font-style:italic;opacity:.75}
.rt-ap-none{font-size:11.5px;color:var(--dsw-alias-label-secondary);padding:2px 0 4px}
.rt-ap-trans{display:flex;align-items:center;gap:7px;padding:2px 0 2px 14px}
.rt-ap-trans-t{font-size:11px;color:var(--dsw-alias-label-secondary)}
/* 横向路径图 */
.rt-ap-h{display:flex;align-items:stretch;padding:10px 12px 14px;overflow-x:auto;flex:1;min-height:0}
.rt-ap-col{display:flex;align-items:stretch;flex:none}
.rt-ap-col-arrow{align-self:center;color:var(--dsw-alias-border-l2);padding:0 6px;font-size:12px;flex:none}
.rt-hcol{width:228px;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);
  border-top:3px solid #64748b;border-radius:7px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.rt-hcol-goal{font-size:11px;color:var(--dsw-alias-label-secondary);padding:5px 8px;line-height:1.45;
  border-bottom:1px solid var(--dsw-alias-border-l1);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rt-hcol-body{padding:6px 8px;flex:1;min-height:0;overflow:auto}
.rt-hcol-hit{display:flex;align-items:center;gap:5px;font-size:11px;margin-bottom:3px}
.rt-hcol-hit.off{opacity:.6}
.rt-hcol-pts{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;font-weight:700;color:#1e40af;background:#dbeafe;
  border-radius:7px;padding:0 5px;flex:none}
.rt-hcol-hit.off .rt-hcol-pts{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.rt-hcol-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-hcol-none{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-hcol-secs{display:flex;flex-wrap:wrap;gap:3px;margin-top:6px}
.rt-hcol-sec{font-size:10px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);
  border-radius:4px;padding:0 4px}
.rt-hcol-attck{font-family:ui-monospace,Menlo,monospace;font-size:9.5px;color:var(--dsw-alias-label-secondary);
  padding:4px 8px;border-top:1px solid var(--dsw-alias-border-l1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-ap-cum{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-ap-sub{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:6px 0 3px}
.rt-ap-assets,.rt-ap-tunnels{display:flex;flex-direction:column;gap:3px}
.rt-ap-asset{display:flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 6px;border-radius:5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.rt-ap-tunnel{display:flex;align-items:center;gap:6px;font-size:11.5px;padding:4px 7px;border-radius:5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe}
.rt-hcol-sub{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-bottom:2px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;gap:5px;align-items:center}
.rt-hcol-sub.off{opacity:.6}
.rt-hit-row{display:flex;flex-wrap:wrap;align-items:center;gap:2px 7px;font-size:11.5px;padding:4px 7px;border-radius:5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);margin-bottom:3px}
.rt-hit-asset{font-family:ui-monospace,Menlo,monospace;font-weight:600;flex:0 1 auto;max-width:100%;
  overflow-wrap:anywhere;word-break:break-word}
.rt-hit-txt{flex:1 1 100%;color:var(--dsw-alias-label-primary);line-height:1.55;
  white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
.rt-hit-txt.none{color:var(--dsw-alias-state-error-primary)}
.rt-hit-row .rt-hit-time{flex:none;margin-left:auto}
.rt-hit-row.self-created{opacity:.72;border-left:3px solid #ef444488}
.rt-hit-row.service-capped{opacity:.72;border-left:3px solid #f59e0b88}
.rt-hit-row.service-capped .rt-hit-idx{background:#f59e0b}
.rt-rep-group{margin-bottom:14px}
.rt-rep-stage{display:flex;align-items:center;gap:8px;padding:7px 10px;margin-bottom:7px;
  background:var(--dsw-alias-bg-layer-2);border-left:4px solid #64748b;border-radius:6px;
  cursor:pointer;outline:none;user-select:none}
.rt-rep-stage:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-rep-stage:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-rep-no{width:20px;height:20px;border-radius:5px;color:#fff;font-size:11px;font-weight:700;flex:none;
  display:inline-flex;align-items:center;justify-content:center}
.rt-rep-stage-name{font-weight:700;font-size:13px}
.rt-rep-stage-n{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-rep-pts{font-size:11px;font-weight:600;padding:1px 6px;border-radius:5px;border:1px solid transparent;flex:none}
.rt-rep-body{padding-left:6px}
/* ── 工程模式库 / 知识库 ──────────────────────────────────────────── */
.rt-kb-filter{display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-kb-cats{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-kb-cat{display:flex;align-items:center;gap:7px;padding:7px 10px;background:var(--dsw-alias-bg-layer-2);
  border-bottom:1px solid var(--dsw-alias-border-l1);position:sticky;top:0;z-index:1}
.rt-kb-cat-name{font-weight:600;font-size:12.5px}
/* 技能可用性徽章（技能库页签） */
.rt-avail{display:inline-block;padding:0 5px;border-radius:4px;font-size:10.5px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.rt-avail-available{color:#4d6bfe;border-color:#4d6bfe55;background:#4d6bfe1a}
.rt-avail-broken{color:#ef4444;border-color:#ef444455;background:#ef44441a}
.rt-avail-unknown{color:#94a3b8;border-color:#94a3b855;background:#94a3b81a}
.rt-kb-check{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer}
.rt-kb{border:1px solid var(--dsw-alias-border-l1);border-radius:7px;margin:0 0 8px;overflow:hidden;
  background:var(--dsw-alias-bg-layer-2)}
.rt-kb.open{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-kb-head{display:flex;align-items:center;gap:7px;padding:7px 9px;cursor:pointer;outline:none;flex-wrap:wrap}
.rt-kb-head:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-kb-head:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-kb-title{font-weight:600;font-size:12.5px;overflow-wrap:anywhere}
.rt-kb-kind{font-size:10px;font-weight:700;letter-spacing:.4px;padding:1px 5px;border-radius:4px;
  color:#fff;background:#64748b;flex:none}
.rt-kb-kind.k-exp{background:#2563eb}
.rt-kb-kind.k-poc{background:#4d6bfe}
.rt-kb-kind.k-template{background:#6366f1}
.rt-kb-kind.k-script{background:#0ea5e9}
.rt-kb-kind.k-payload{background:#0284c7}
.rt-kb-sub{font-size:11px;color:var(--dsw-alias-label-secondary);padding:0 9px 7px;overflow-wrap:anywhere}
.rt-kb-body{padding:0 9px 9px}
.rt-kb-actions{display:flex;gap:6px;margin:7px 0}
.rt-kb-body .rt-kv span{overflow-wrap:anywhere;word-break:break-word}
.rt-kb-tpl{margin-top:12px;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:8px}
.rt-kb-tpl-row{display:flex;align-items:center;gap:7px;font-size:11.5px;padding:3px 7px;border-radius:5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);margin-bottom:3px}
.rt-kb-tpl-path{flex:0 1 auto;font-weight:600;overflow-wrap:anywhere}
.rt-kb-tpl-name{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.rt-md{flex:1;overflow:auto;margin:0;padding:14px 16px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;
  line-height:1.65;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-base)}
/* ── Markdown 渲染视图 ───────────────────────────────────────────── */
.rt-markdown{flex:1;overflow:auto;padding:12px 14px;font-size:12.5px;line-height:1.7;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);word-break:break-word}
.rt-markdown>:first-child{margin-top:0}
.rt-markdown>:last-child{margin-bottom:0}
.rt-markdown h1,.rt-markdown h2,.rt-markdown h3,.rt-markdown h4,.rt-markdown h5,.rt-markdown h6{
  margin:12px 0 6px;font-weight:600;line-height:1.35}
.rt-markdown h1{font-size:16px}
.rt-markdown h2{font-size:14px}
.rt-markdown h3{font-size:13px}
.rt-markdown h4,.rt-markdown h5,.rt-markdown h6{font-size:12.5px}
.rt-markdown p{margin:0 0 8px;white-space:pre-wrap}
.rt-markdown ul,.rt-markdown ol{margin:0 0 8px;padding-left:20px}
.rt-markdown li{margin:2px 0;white-space:pre-wrap}
.rt-markdown li>p{margin:0}
.rt-markdown code,.rt-inline-code{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);
  border-radius:4px;padding:0 3px;white-space:pre-wrap;word-break:break-word}
.rt-markdown pre{margin:0 0 9px;padding:8px 10px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);
  border-radius:6px;background:var(--dsw-alias-bg-layer-1);font-family:ui-monospace,Menlo,monospace;
  font-size:11.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.rt-markdown pre code{background:none;border:0;padding:0;font-size:inherit}
.rt-markdown table{border-collapse:collapse;table-layout:fixed;width:100%;margin:0 0 10px;font-size:11.5px}
.rt-markdown th,.rt-markdown td{border:1px solid var(--dsw-alias-border-l1);padding:4px 7px;
  text-align:left;vertical-align:top;word-break:break-word;overflow-wrap:anywhere}
.rt-markdown th{background:var(--dsw-alias-bg-layer-1);font-weight:600}
.rt-markdown blockquote{margin:0 0 9px;padding:4px 10px;border-left:3px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.rt-markdown hr{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:10px 0}
.rt-markdown strong{font-weight:600}
.rt-weblink{display:block;font-size:11.5px;margin-top:1px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* ── 验证/验收截图：最多 3 张代表图，点开全屏 ─────────────────────────── */
.rt-shots{margin:8px 0 4px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;
  background:var(--dsw-alias-bg-layer-1)}
.rt-shots-head{display:flex;align-items:baseline;gap:8px;font-size:11.5px;margin-bottom:6px}
.rt-shots-n{color:var(--dsw-alias-label-secondary)}
.rt-shot-row{display:flex;gap:8px;flex-wrap:wrap}
.rt-shot{display:flex;flex-direction:column;gap:3px;max-width:220px}
.rt-shot-thumb{border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:#0b1020;
  object-fit:contain;display:block;width:auto;max-width:216px}
.rt-shot-loading{display:flex;align-items:center;justify-content:center;width:150px;font-size:11px;
  color:var(--dsw-alias-label-secondary)}
.rt-shot-cap{display:flex;align-items:center;gap:5px;font-size:10.5px;overflow-wrap:anywhere}
.rt-shot-label{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}
.rt-shot-zoom{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.82);display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:10px;cursor:zoom-out;padding:18px}
.rt-shot-zoom img{max-width:96vw;max-height:86vh;border-radius:6px;box-shadow:0 18px 48px rgba(0,0,0,.5)}
.rt-shot-zoom-cap{color:#e5e7eb;font-size:12px;text-align:center;max-width:90vw;overflow-wrap:anywhere}
/* 技能库紧凑行 */
.rt-skill-row{display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer;min-width:0}
.rt-skill-row:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-skill-row.on{background:var(--dsw-alias-bg-layer-2);border-left:2px solid var(--dsw-alias-brand-primary)}
.rt-skill-row.broken{background:rgba(245,158,11,.06)}
.rt-skill-main{flex:1;min-width:0}
.rt-skill-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-skill-desc{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-concl-group{font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:0 2px 0 4px}
.rt-concl-extra{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-concl-extra summary{cursor:pointer;white-space:nowrap}

/* 报告四段式全文：展开即全屏预览 */
.rt-rep-full[open]::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:9997}
.rt-rep-full[open]>.rt-rep-full-body{position:fixed;inset:3vh 3vw;z-index:9998;background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px 16px;overflow:auto;
  box-shadow:0 24px 64px rgba(0,0,0,.4);max-width:none}
.rt-rep-full[open]>.rt-rep-full-body .rt-markdown{max-height:none}
.rt-rep-full-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}

/* ── 态势总览 ───────────────────────────────────────────────────── */
.rt-ov{padding:0;min-height:0}
.rt-ov-head{display:flex;align-items:center;gap:10px;padding:14px 18px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-ov-heading{min-width:0}
.rt-ov-eyebrow{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin-bottom:2px}
.rt-ov-title-row{display:flex;align-items:center;gap:8px;min-width:0}
.rt-ov-title{font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}
.rt-ov-stage-chip{font-size:10.5px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-ov-scroll{overflow:auto;padding:14px 18px 20px;flex:1;min-height:0}
.rt-ov-hero{display:grid;grid-template-columns:minmax(210px,250px) minmax(0,1fr);gap:12px}
.rt-ov-score{position:relative;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:16px;background:
  linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent),transparent 62%),
  var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:3px;min-height:148px}
.rt-ov-score::after{content:'';position:absolute;right:-26px;bottom:-36px;width:120px;height:120px;border-radius:50%;
  border:18px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);pointer-events:none}
.rt-ov-score-label{font-size:11px;color:var(--dsw-alias-label-secondary);letter-spacing:.06em}
.rt-ov-score-num{font-size:46px;line-height:1.05;font-weight:750;letter-spacing:-1.5px;color:var(--dsw-alias-brand-primary);font-variant-numeric:tabular-nums}
.rt-ov-score-num small{font-size:13px;font-weight:500;margin-left:4px;letter-spacing:0;color:var(--dsw-alias-label-secondary)}
.rt-ov-score-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.rt-ov-score .rt-btn{align-self:flex-start;margin-top:auto}
.rt-ov-rail{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:12px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.rt-ov-rail-head{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.rt-ov-stages{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px}
.rt-ov-stage{position:relative;min-width:0;padding:9px 8px 8px;border:1px solid var(--dsw-alias-border-l1);border-top:3px solid var(--stage,var(--dsw-alias-border-l1));border-radius:9px;background:var(--dsw-alias-bg-layer-1)}
.rt-ov-stage.on{background:var(--dsw-alias-bg-layer-2);box-shadow:0 0 0 1px color-mix(in srgb,var(--stage,var(--dsw-alias-brand-primary)) 35%,transparent)}
.rt-ov-node{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;color:#fff;background:var(--stage,var(--dsw-alias-label-secondary));opacity:.72;margin-bottom:7px}
.rt-ov-stage.has .rt-ov-node{opacity:1}
.rt-ov-stage.on .rt-ov-node{box-shadow:0 0 0 3px color-mix(in srgb,var(--stage,var(--dsw-alias-brand-primary)) 22%,transparent)}
.rt-ov-stage-name{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}
.rt-ov-stage-pts{font-size:12.5px;font-weight:700;margin-top:3px;color:var(--stage,var(--dsw-alias-label-primary));font-variant-numeric:tabular-nums}
.rt-ov-stage-cum{font-size:9.5px;color:var(--dsw-alias-label-secondary);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-ov-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}
.rt-ov-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px;min-width:0}
.rt-ov-card-wide{grid-column:1/-1}
.rt-ov-card-head{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.rt-ov-card-title{font-size:13px;font-weight:700}
.rt-ov-card-sub{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.rt-ov-gaps{display:flex;flex-direction:column;gap:1px}
.rt-ov-gap{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:8px;cursor:pointer;min-width:0}
.rt-ov-gap:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-ov-rank{width:20px;flex:none;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;letter-spacing:.04em}
.rt-ov-gap-main{flex:1;min-width:0}
.rt-ov-gap-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-ov-gap-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:2px;display:flex;align-items:center;gap:6px;min-height:15px}
.rt-ov-bar{height:4px;border-radius:99px;background:var(--dsw-alias-border-l1);overflow:hidden;margin-top:4px}
.rt-ov-bar>div{height:100%;border-radius:99px}
.rt-ov-pts{flex:none;font-size:12.5px;font-weight:700;color:var(--dsw-alias-brand-primary);font-variant-numeric:tabular-nums}
.rt-ov-metric-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.rt-ov-card:last-child .rt-ov-metric-row{grid-template-columns:repeat(3,minmax(0,1fr))}
.rt-ov-metric{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 9px;background:var(--dsw-alias-bg-layer-2);min-width:0}
.rt-ov-metric-value{font-size:20px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.rt-ov-metric-label{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-ov-metric-sub{font-size:9.5px;color:var(--dsw-alias-label-secondary);opacity:.8}
.rt-ov-metric-ok .rt-ov-metric-value{color:#4d6bfe}
.rt-ov-metric-warn .rt-ov-metric-value{color:#f59e0b}
.rt-ov-metric-mute .rt-ov-metric-value{color:var(--dsw-alias-label-secondary)}
.rt-ov-entry-list{margin-top:7px}
.rt-ov-entry{display:grid;grid-template-columns:8px 104px 54px minmax(0,1fr);align-items:center;gap:6px;padding:5px 0;border-top:1px solid var(--dsw-alias-border-l1);min-width:0}
.rt-ov-dot{width:6px;height:6px;border-radius:50%;background:#4d6bfe;box-shadow:0 0 0 2px rgba(77,107,254,.2)}
.rt-ov-entry-addr{font-family:ui-monospace,Menlo,monospace;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-ov-entry-kind{font-size:9.5px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 5px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-ov-entry-reach{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-ov-actions{display:flex;gap:6px;margin-top:8px}
.rt-ov-empty{font-size:11.5px;color:var(--dsw-alias-label-secondary);padding:8px 0}
@media(max-width:980px){.rt-ov-hero{grid-template-columns:1fr}.rt-ov-grid{grid-template-columns:1fr}.rt-ov-card-wide{grid-column:auto}.rt-ov-score{min-height:0}}

/* WorkBuddy × DSH Brand Blue 统一视觉层（卡片 / 表格 / 徽章部分） */
.rt-card{
  border-radius:12px;padding:12px 14px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-layer-1) 95%,transparent),var(--dsw-alias-bg-layer-1));
  box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px -18px rgba(37,99,235,.18);
}
.rt-card h4{font-size:12.5px;letter-spacing:-.005em}
.rt-seg,.rt-item{border-radius:8px;transition:background .12s,border-color .12s,box-shadow .12s}
.rt-seg:hover,.rt-item:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 85%,transparent)}
.rt-seg.on,.rt-item.on{
  background:rgba(77,107,254,.1);
  border-color:rgba(77,107,254,.45);
}
.rt-row,.rt-vrow,.rt-score-row{transition:background .12s}
.rt-row:hover,.rt-vrow:hover,.rt-score-row:hover{background:color-mix(in srgb,#4d6bfe 6%,var(--dsw-alias-bg-layer-2))}
.rt-row.head,.rt-vrow.head,.rt-score-row.head{
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 78%,var(--dsw-alias-bg-layer-1));
  letter-spacing:.02em;
}
.rt-score-group{
  border-radius:8px;margin:6px 8px 3px;padding:7px 10px;border-top:none;
  background:linear-gradient(90deg,rgba(77,107,254,.09),transparent 72%);
}
.rt-concl{padding:8px 12px;gap:6px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 70%,transparent)}
.rt-concl-i{border-radius:999px;border:1px solid transparent;padding:2px 9px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 58%,transparent);transition:background .12s,border-color .12s}
.rt-concl-i:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.rt-concl-i.on{border-color:#4d6bfe;background:rgba(77,107,254,.11)}
.rt-concl-group{border-left:2px solid rgba(77,107,254,.4);padding-left:7px;margin-left:2px}
.rt-tag{border-radius:999px;padding:1px 7px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);font-weight:500}
.rt-sev{border-radius:5px;padding:1px 7px;letter-spacing:.01em}
.rt-test,.rt-pri,.rt-avail{border-radius:999px}
.rt-hint{border-radius:9px;border-style:solid;border-width:1px}
.rt-sess,.rt-cred,.rt-rep,.rt-kb{border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.035);transition:border-color .12s,box-shadow .12s}
.rt-sess:hover,.rt-cred:hover,.rt-rep:hover,.rt-kb:hover{border-color:rgba(77,107,254,.38);box-shadow:0 2px 8px rgba(37,99,235,.08)}
.rt-kb-head{padding:8px 10px}
.rt-sess{padding:10px 11px}
.rt-cred{padding:7px 9px}

/* 态势：当前得分 / 下一步得分 两个可切换卡片 */
.rt-ov-score-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:4px 0 8px}
.rt-ov-score-tab{display:flex;flex-direction:column;gap:2px;text-align:left;font-family:inherit;color:inherit;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 11px;background:var(--dsw-alias-bg-layer-1);transition:background .15s,border-color .15s,box-shadow .15s}
.rt-ov-score-tab:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-ov-score-tab.on{border-color:#4d6bfe;background:rgba(77,107,254,.08);box-shadow:inset 0 0 0 1px rgba(77,107,254,.28)}
.rt-ov-score-tab-label{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.rt-ov-score-tab-value{font-size:17px;font-weight:750;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.rt-ov-score-tab-sub{font-size:9.5px;color:var(--dsw-alias-label-secondary)}
.rt-ov-pts-got{color:#4d6bfe}

/* ── WorkBuddy × DSH Blue 4-Wave DAG 流水线与 8 角色工作台卡片 ──────────── */
.rt-wb-dag{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:8px 0 10px}
.rt-wb-wave{border:1px solid var(--dsw-alias-border-l1);border-top:3px solid #4d6bfe;border-radius:10px;padding:10px 12px;
  background:linear-gradient(180deg,rgba(77,107,254,.07),transparent 75%),var(--dsw-alias-bg-layer-1);min-width:0;
  box-shadow:0 1px 3px rgba(15,23,42,.03)}
.rt-wb-wave:nth-child(2){border-top-color:#0ea5e9}
.rt-wb-wave:nth-child(3){border-top-color:#2563eb;background:linear-gradient(180deg,rgba(37,99,235,.1),transparent 75%),var(--dsw-alias-bg-layer-1)}
.rt-wb-wave:nth-child(4){border-top-color:#6366f1}
.rt-wb-wave-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px}
.rt-wb-wave-tag,.rt-wb-wave-no{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--wb-blue-ink,#2563eb);background:rgba(77,107,254,.12);border:1px solid rgba(77,107,254,.25);padding:1px 7px;border-radius:999px;font-family:ui-monospace,Menlo,monospace}
.rt-wb-wave-slots{font-size:10px;font-family:ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-secondary)}
.rt-wb-wave-title{font-size:12px;font-weight:700;color:var(--dsw-alias-label-primary)}
.rt-wb-wave-roles,.rt-wb-wave-desc{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.45}
.rt-wb-slots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:8px 0 6px}
.rt-wb-slot{display:flex;align-items:center;gap:6px;padding:6px 9px;border-radius:8px;font-size:11px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.rt-wb-slot.on{border-color:rgba(77,107,254,.42);background:linear-gradient(135deg,rgba(77,107,254,.12),rgba(14,165,233,.06));
  color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 2px 6px rgba(77,107,254,.1)}
.rt-wb-badge{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:600;
  color:var(--wb-blue,#4d6bfe);background:rgba(77,107,254,.1);border:1px solid rgba(77,107,254,.28)}
@media(max-width:720px){.rt-wb-dag{grid-template-columns:1fr}.rt-wb-slots{grid-template-columns:repeat(2,minmax(0,1fr))}}

/* ── 报告 v2：模板化交付报告 ─────────────────────────────────────────── */
.rt-r2{display:flex;flex-direction:column;min-height:0;height:100%}
.rt-r2-toolbar{flex-wrap:wrap}
.rt-r2-scroll{flex:1;min-height:0;overflow:auto;padding:14px 16px 28px}
.rt-r2-section{margin:0 0 26px}
.rt-r2-h2{font-size:16px;font-weight:700;margin:0 0 10px;padding-bottom:7px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-r2-h3{font-size:13px;font-weight:700;margin:14px 0 7px}
.rt-r2-h4{font-size:12.5px;font-weight:700;margin:12px 0 5px}
.rt-r2-h5{font-size:12px;font-weight:600;margin:10px 0 4px}
.rt-r2-proof-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}
.rt-r2-proof{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:10px 11px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.rt-r2-proof-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-r2-proof-line{font-size:12px;margin-top:6px;line-height:1.55;word-break:break-word}
.rt-r2-muted{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.rt-r2-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:7px 0}
.rt-r2-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin:7px 0}
.rt-r2-table{width:100%;border-collapse:collapse;font-size:11.5px;min-width:520px}
.rt-r2-table th,.rt-r2-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);text-align:left;vertical-align:top;word-break:break-word}
.rt-r2-table th{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-weight:600;white-space:nowrap}
.rt-r2-table tr:last-child td{border-bottom:0}
.rt-r2-code{border:1px solid var(--dsw-alias-border-l1);border-radius:7px;margin:6px 0;overflow:hidden}
.rt-r2-code-head{display:flex;align-items:center;gap:6px;padding:4px 7px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-r2-pre{margin:0;padding:8px;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:11px;line-height:1.5;font-family:ui-monospace,Menlo,monospace;background:var(--dsw-alias-bg-base)}
.rt-r2-item{border-left:2px solid rgba(77,107,254,.45);padding:2px 0 3px 9px;margin:8px 0 10px}
.rt-r2-item-line{font-size:11.5px;line-height:1.6;margin-top:3px;word-break:break-word}
.rt-r2-gap{border:1px dashed var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);border-radius:5px;padding:5px 7px;margin-top:5px;font-size:11.5px}
.rt-r2-group{border-top:1px dashed var(--dsw-alias-border-l1);padding-top:4px;margin-top:8px}
.rt-r2-asset{margin-left:4px}
@media(max-width:720px){.rt-r2-scroll{padding:10px}.rt-r2-table{min-width:460px}}

/* ══════════════════════════════════════════════════════════════════
   p4 Modular Bento UI + p2 Theme-Adaptive PG Write Probe + p3 Concurrency + DocWall
   ══════════════════════════════════════════════════════════════════ */
.rt-bento-stack{display:flex;flex-direction:column;gap:14px;margin-bottom:14px}
.rt-bento-row-1,.rt-bento-row-2,.rt-bento-row-3,.rt-bento-row-canvas,.rt-analytics-trio{display:grid;grid-template-columns:1fr;gap:14px}
@media(min-width:1180px){
  .rt-full .rt-bento-row-1{grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr)}
  .rt-full .rt-bento-row-2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .rt-full .rt-bento-row-3{grid-template-columns:1fr}
  .rt-full .rt-bento-row-canvas{grid-template-columns:1fr}
  .rt-full .rt-analytics-trio{grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch}
}
.rt-bento-card{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:16px 18px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-layer-1) 96%,transparent),var(--dsw-alias-bg-layer-1));
  box-shadow:0 2px 10px -4px rgba(15,23,42,.06),0 8px 24px -18px rgba(77,107,254,.18);min-width:0;display:flex;flex-direction:column;gap:10px}
.rt-bento-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rt-bento-title{font-size:13.5px;font-weight:700;letter-spacing:-.01em;display:flex;align-items:center;gap:6px}
.rt-bento-sub{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-p4-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:8px}
.rt-p4-tile{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:9px 10px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 65%,transparent);min-width:0;display:flex;flex-direction:column;gap:3px}
.rt-p4-tile-val{font-size:17px;font-weight:750;line-height:1.15;font-family:ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.rt-p4-tile-val.accent{color:var(--wb-blue,#4d6bfe)}
.rt-p4-tile-lbl{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-p4-tile-sub{font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-p4-dist-bar{display:flex;height:7px;border-radius:99px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);gap:1px}
.rt-p4-dist-seg{height:100%;transition:width .25s ease}
.rt-p4-legend{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-p4-legend-item{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.rt-p4-legend-dot{width:7px;height:7px;border-radius:2px;flex:none}
.rt-bento-plugin-card{background:linear-gradient(135deg,rgba(77,107,254,.1),rgba(14,165,233,.05) 65%,transparent),var(--dsw-alias-bg-layer-1)}
.rt-p4-plugin-kv{display:flex;flex-direction:column;gap:5px;font-size:11.5px}
.rt-p4-plugin-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px dashed color-mix(in srgb,var(--dsw-alias-border-l1) 70%,transparent)}
.rt-p4-plugin-row:last-child{border-bottom:0}
.rt-p4-plugin-row b{color:var(--dsw-alias-label-secondary);font-weight:600;flex:none}
.rt-p4-plugin-row span{font-family:ui-monospace,Menlo,monospace;font-size:11px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* p4 Dual SVG Ring Gauges */
.rt-p4-gauge-body{display:grid;grid-template-columns:116px minmax(0,1fr);gap:14px;align-items:center}
.rt-p4-donut-wrap{position:relative;width:112px;height:112px;display:flex;align-items:center;justify-content:center;margin:0 auto}
.rt-p4-donut-svg{width:112px;height:112px;transform:rotate(-90deg)}
.rt-p4-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none}
.rt-p4-donut-val{font-size:15px;font-weight:750;font-family:ui-monospace,Menlo,monospace;line-height:1.1;color:var(--dsw-alias-label-primary)}
.rt-p4-donut-sub{font-size:9.5px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.rt-p4-breakdown{display:flex;flex-direction:column;gap:6px;min-width:0}
.rt-p4-bd-row{display:flex;align-items:center;gap:6px;font-size:11.5px;min-width:0}
.rt-p4-bd-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}
.rt-p4-bd-val{font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary);flex:none}
.rt-p4-timeline-bar{display:grid;grid-template-columns:1.1fr 1fr 2.4fr 1.3fr;gap:4px;margin-top:4px}
.rt-p4-tl-seg{border-radius:6px;padding:4px 6px;font-size:10px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}

/* Real-Time Role Decision Cards, Doc Wall & Feishu Push */
.rt-role-decision-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.rt-role-decision-card{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:10px;padding:11px 13px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px;min-width:0}
.rt-doc-wall{display:grid;grid-template-columns:185px minmax(0,1fr);gap:10px;min-height:240px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base)}
.rt-doc-strip{border-right:1px solid var(--dsw-alias-border-l1);padding:8px;display:flex;flex-direction:column;gap:4px;background:var(--dsw-alias-bg-layer-2);overflow:auto}
.rt-doc-item{padding:7px 9px;border-radius:7px;cursor:pointer;border:1px solid transparent;display:flex;flex-direction:column;gap:2px}
.rt-doc-item:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-doc-item.on{background:rgba(77,107,254,.12);border-color:rgba(77,107,254,.45)}
.rt-doc-item-title{font-size:11.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-doc-item-sub{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-doc-preview{padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0;overflow:auto;max-height:320px}
.rt-feishu-panel{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;gap:8px}
.rt-feishu-checks{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px}

/* p2 Real-Time PG Write Probe — 100% Theme-Adaptive */
.rt-pg-probe{display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.rt-pg-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.rt-pg-stat{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:2px}
.rt-pg-stat-val{font-size:15px;font-weight:750;font-family:ui-monospace,Menlo,monospace;color:var(--wb-blue,#4d6bfe)}
.rt-pg-stat-lbl{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.rt-pg-tables{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.rt-pg-tbl{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}
.rt-pg-tbl-name{font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-pg-tbl-cnt{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--wb-blue-ink,#2563eb);background:var(--wb-blue-soft,rgba(77,107,254,.12));padding:1px 6px;border-radius:99px;flex:none}
.rt-pg-log{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.6;max-height:168px;overflow:auto;display:flex;flex-direction:column;gap:4px}
.rt-pg-log-row{display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}
.rt-pg-verb{padding:1px 5px;border-radius:4px;font-size:9.5px;font-weight:700;background:var(--wb-blue-soft,rgba(77,107,254,.15));color:var(--wb-blue-ink,#2563eb);flex:none}
.rt-pg-verb.upd{background:rgba(14,165,233,.16);color:var(--wb-blue-cyan,#0284c7)}
.rt-pg-lat{margin-left:auto;color:#10b981;font-size:10px;flex:none}

/* p3 Inline Concurrency & Recursive Subagent Controller + Role Card Grid */
.rt-p3-ctrl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;border-radius:10px;border:1px solid rgba(77,107,254,.28);background:linear-gradient(90deg,rgba(77,107,254,.08),rgba(14,165,233,.04))}
.rt-p3-stepper{display:inline-flex;align-items:center;gap:4px}
.rt-p3-stepbtn{width:24px;height:24px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.rt-p3-stepbtn:hover{border-color:#4d6bfe;color:#4d6bfe}
.rt-p3-pills{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
.rt-p3-pill{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit}
.rt-p3-pill:hover{border-color:#4d6bfe;color:var(--dsw-alias-label-primary)}
.rt-p3-pill.on{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);border-color:#4d6bfe;color:#fff}
.rt-wb-role-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:8px}
@media(min-width:1180px){.rt-full .rt-wb-role-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.rt-wb-role-card{border:1px solid var(--dsw-alias-border-l1);border-top:3px solid #4d6bfe;border-radius:10px;padding:11px 12px;
  background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px;min-width:0;cursor:pointer;transition:border-color .14s,box-shadow .14s,transform .12s}
.rt-wb-role-card:hover{border-color:#4d6bfe;box-shadow:0 4px 12px rgba(77,107,254,.12);transform:translateY(-1px)}
.rt-wb-role-card.on{border-color:#4d6bfe;background:rgba(77,107,254,.07);box-shadow:0 0 0 1px rgba(77,107,254,.28)}
.rt-wb-role-head{display:flex;align-items:center;justify-content:space-between;gap:4px;flex-wrap:wrap}
.rt-wb-role-badge{font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:700;color:var(--wb-blue-ink,#2563eb);background:rgba(77,107,254,.12);border:1px solid rgba(77,107,254,.28);border-radius:999px;padding:1px 7px;white-space:nowrap}
.rt-wb-role-name{font-size:12.5px;font-weight:700;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-wb-role-desc{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rt-wb-role-skills{display:flex;flex-wrap:wrap;gap:4px;margin-top:auto;padding-top:3px}
.rt-wb-skill-tag{font-family:ui-monospace,Menlo,monospace;font-size:10px;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--wb-blue-ink,#2563eb);white-space:nowrap}
.rt-wb-recurse-tag{font-size:9.5px;padding:1px 6px;border-radius:99px;background:rgba(99,102,241,.12);color:#4f46e5;border:1px solid rgba(99,102,241,.28);font-weight:600;white-space:nowrap}

/* Dark theme cohesive overrides for cards, probes, and badges */
body[data-ds-dark-theme] .rt-wb-wave,
body[data-ds-dark-theme] .rt-wb-slot,
body[data-ds-dark-theme] .rt-bento-card,
body[data-ds-dark-theme] .rt-wb-role-card,
body[data-ds-dark-theme] .rt-role-decision-card,
body[data-ds-dark-theme] .rt-pg-probe{
  background:var(--dsw-alias-bg-layer-1);
  border-color:var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
}
body[data-ds-dark-theme] .rt-pg-stat,
body[data-ds-dark-theme] .rt-pg-tbl,
body[data-ds-dark-theme] .rt-pg-log{
  background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
}
body[data-ds-dark-theme] .rt-gain,
body[data-ds-dark-theme] .rt-counted,
body[data-ds-dark-theme] .rt-scorepts{
  background:rgba(77,107,254,.16);
  color:#93c5fd;
  border-color:rgba(77,107,254,.35);
}
@media(max-width:640px){.rt-wb-role-grid{grid-template-columns:1fr}.rt-doc-wall{grid-template-columns:1fr}}

/* Concurrency Slot Matrix & Pattern Drawer Styles */
.rt-slot-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
  gap:8px;
  margin:8px 0;
}
.rt-slot-card{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:9px;
  padding:8px 10px;
  background:var(--dsw-alias-bg-layer-1);
  display:flex;
  flex-direction:column;
  gap:4px;
  min-width:0;
  font-size:11.5px;
  transition:border-color .14s,box-shadow .14s;
}
.rt-slot-card.on,.rt-slot-card.running{
  border-color:#4d6bfe;
  background:linear-gradient(135deg,rgba(77,107,254,.1),rgba(14,165,233,.05)),var(--dsw-alias-bg-layer-1);
  box-shadow:0 2px 8px rgba(77,107,254,.12);
}
.rt-slot-card.done,.rt-wb-slot.done{
  border:1px solid rgba(99,102,241,.4);
  background:linear-gradient(135deg,rgba(99,102,241,.09),rgba(77,107,254,.04)),var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);
  box-shadow:0 1px 4px rgba(99,102,241,.08);
}
.rt-slot-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:6px;
}
.rt-slot-role{
  font-family:ui-monospace,Menlo,monospace;
  font-size:10px;
  font-weight:700;
  padding:1px 6px;
  border-radius:999px;
  color:var(--wb-blue-ink,#2563eb);
  background:rgba(77,107,254,.12);
  border:1px solid rgba(77,107,254,.26);
  white-space:nowrap;
}
.rt-slot-chip{
  font-family:ui-monospace,Menlo,monospace;
  font-size:10px;
  color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:6px;
  padding:1px 6px;
  display:inline-flex;
  align-items:center;
  gap:4px;
  white-space:nowrap;
}
.rt-pattern-form{
  border:1px solid rgba(77,107,254,.32);
  border-radius:10px;
  padding:11px 13px;
  margin:8px 0;
  background:linear-gradient(180deg,rgba(77,107,254,.06),transparent 80%),var(--dsw-alias-bg-layer-2);
  display:flex;
  flex-direction:column;
  gap:8px;
}
.rt-pattern-form-row,.rt-pattern-row{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
  gap:8px;
  align-items:center;
}
.rt-pattern-form input,.rt-pattern-form select,.rt-pattern-form textarea{
  width:100%;
  box-sizing:border-box;
}
.rt-pattern-form-actions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:6px;
  margin-top:2px;
}

/* v0.21.0 ShardLock Ownership Table & Clean Software Engineering Review Styles */
.rt-shard-table-wrap{
  width:100%;
  overflow-x:auto;
  border:1px solid var(--rt-border,var(--dsw-alias-border-l1));
  border-radius:10px;
  background:var(--rt-bg-card,var(--dsw-alias-bg-layer-1));
  box-sizing:border-box;
}
.rt-shard-table{
  width:100%;
  border-collapse:collapse;
  font-size:11.5px;
  min-width:480px;
}
.rt-shard-table th,
.rt-shard-table td{
  padding:7px 10px;
  border-bottom:1px solid var(--rt-border,var(--dsw-alias-border-l1));
  text-align:left;
  vertical-align:middle;
  word-break:break-word;
}
.rt-shard-table th{
  position:sticky;
  top:0;
  z-index:1;
  background:var(--rt-bg-elevated,var(--dsw-alias-bg-layer-2));
  color:var(--rt-text-secondary,var(--dsw-alias-label-secondary));
  font-size:11px;
  font-weight:700;
  white-space:nowrap;
}
.rt-shard-table tr:last-child td{
  border-bottom:0;
}
.rt-shard-table tbody tr:hover{
  background:color-mix(in srgb,var(--wb-blue,#4d6bfe) 5%,var(--rt-bg-elevated,var(--dsw-alias-bg-layer-2)));
}
.rt-shard-table tr.is-conflict,
.rt-shard-table tr.is-violation{
  background:var(--rt-danger-soft,rgba(239,68,68,.1));
}
.rt-shard-glob{
  display:inline-block;
  padding:1px 6px;
  border-radius:5px;
  font-family:ui-monospace,Menlo,monospace;
  font-size:11px;
  background:var(--rt-bg-elevated,var(--dsw-alias-bg-layer-2));
  border:1px solid var(--rt-border,var(--dsw-alias-border-l1));
  color:var(--rt-text-primary,var(--dsw-alias-label-primary));
}
.rt-eng-review-card{
  border:1px solid var(--rt-border,var(--dsw-alias-border-l1));
  border-left:3px solid var(--wb-blue,#4d6bfe);
  border-radius:10px;
  padding:10px 12px;
  background:var(--rt-bg-card,var(--dsw-alias-bg-layer-1));
  display:flex;
  flex-direction:column;
  gap:6px;
}
.rt-eng-review-card.is-critical,
.rt-eng-review-card.is-high{
  border-left-color:var(--rt-danger,#dc2626);
}
.rt-eng-review-card.is-passed{
  border-left-color:var(--rt-success,#059669);
}

/* ══════════════════════════════════════════════════════════════════
   06-animations.css — Lifecycle Keyframes, Wire/Node Animation Utilities & Reduced Motion
   ══════════════════════════════════════════════════════════════════ */
@keyframes rt-pulse{
  0%,100%{opacity:1;box-shadow:0 0 0 0 #4d6bfe66}
  50%{opacity:.5;box-shadow:0 0 0 5px #4d6bfe00}
}
@keyframes rt-p5-pulse{
  0%,100%{opacity:1;transform:scale(1)}
  50%{opacity:.45;transform:scale(.92)}
}
@keyframes rt-wire-grow{
  from { stroke-dashoffset: 240; opacity: 0.25; }
  to { stroke-dashoffset: 0; opacity: 1; }
}
@keyframes rt-subnode-spawn{
  0% { opacity: 0; transform: translateY(-14px) scale(0.84); filter: blur(3px); }
  65% { opacity: 1; transform: translateY(2px) scale(1.02); filter: blur(0); }
  100% { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
}
@keyframes rt-sonar-ripple{
  0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.45); opacity: 1; }
  100% { box-shadow: 0 0 0 12px rgba(59,130,246,0); opacity: 0; }
}
@keyframes rt-dash-flow{
  to { stroke-dashoffset: -24; }
}
@keyframes rt-hub-absorb{
  0% { transform: scale(1); }
  50% { transform: scale(1.03); box-shadow: 0 0 0 6px rgba(16,185,129,0.22); }
  100% { transform: scale(1); }
}
@keyframes rt-complete-sheen{
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes rt-check-stroke{
  from { stroke-dashoffset: 32; }
  to { stroke-dashoffset: 0; }
}

.rt-p5-spin{
  display:inline-block;
  animation:rt-p5-pulse 1.4s ease-in-out infinite;
}
.rt-anim-spawn{
  animation: rt-subnode-spawn 0.38s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.rt-anim-complete{
  background-image: linear-gradient(110deg, transparent 35%, rgba(16,185,129,0.16) 50%, transparent 65%);
  background-size: 200% 100%;
  animation: rt-complete-sheen 1.2s ease-out 1;
}
body[data-ds-dark-theme] .rt-anim-complete{
  background-image: linear-gradient(110deg, transparent 35%, rgba(52,211,153,0.22) 50%, transparent 65%);
}
.rt-anim-hub-absorb{
  animation: rt-hub-absorb 0.52s cubic-bezier(0.34, 1.56, 0.64, 1) 1;
}
.rt-wire-flowing{
  stroke-dasharray: 6 6;
  animation: rt-dash-flow 0.9s linear infinite;
}
.rt-wire-growing{
  stroke-dasharray: 240;
  animation: rt-wire-grow 0.45s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
.rt-sonar-ring{
  border-radius: inherit;
  animation: rt-sonar-ripple 1.6s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

@media (prefers-reduced-motion: reduce){
  .rt-live-dot,
  .rt-p5-spin,
  .rt-anim-spawn,
  .rt-anim-complete,
  .rt-anim-hub-absorb,
  .rt-wire-flowing,
  .rt-wire-growing,
  .rt-sonar-ring,
  .rt-agent-inspector-drawer{
    animation: none !important;
  }
  .rt-dock,
  .rt-panzoom-stage.smooth-zoom,
  .rt-p4-node-card,
  .rt-tree-wave-card,
  .rt-net-node,
  .rt-p5-card{
    transition: none !important;
  }
}
`
