/**
 * LMTAgent 工作台样式表（由 tools/assemble-styles.mjs 从 src/styles/*.css 自动组装生成）。
 * 请修改 packages/redteam-ui/src/styles/*.css 后运行：
 *   node packages/redteam-ui/tools/assemble-styles.mjs
 */
export const CSS = String.raw`
:root{
  --rt-dock-w:540px;
  --wb-blue:#4d6bfe;
  --wb-blue-soft:rgba(77,107,254,.12);
  --wb-blue-ink:#1e40af;
  --wb-blue-pill:#dbeafe;

  --rt-bg-card:var(--dsw-alias-bg-layer-1,#ffffff);
  --rt-bg-subtle:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#f1f5f9) 68%,transparent);
  --rt-border:var(--dsw-alias-border-l1,#e2e8f0);
  --rt-shadow-card:0 2px 10px -4px rgba(15,23,42,.06),0 8px 24px -18px rgba(77,107,254,.18);
}

body[data-ds-dark-theme]{
  --wb-blue:#5b78ff;
  --wb-blue-soft:rgba(91,120,255,.16);
  --wb-blue-ink:#93c5fd;
  --wb-blue-pill:rgba(77,107,254,.2);

  --rt-bg-card:var(--dsw-alias-bg-layer-1,#1e293b);
  --rt-bg-subtle:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#273549) 75%,transparent);
  --rt-border:var(--dsw-alias-border-l1,rgba(148,163,184,.22));
  --rt-shadow-card:0 4px 14px rgba(0,0,0,.28);
}

div:has(> [data-shell-overlay] .rt-dock[data-open="1"])[data-details-collapsed],
div:has(> [data-shell-overlay] .rt-dock[data-open="1"])[data-rightbar-collapsed]{padding-right:min(var(--rt-dock-w),45vw)}
.rt-dock{position:fixed;top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px)));right:0;bottom:0;z-index:80;display:flex;flex-direction:column;
  background:radial-gradient(960px 440px at 100% 0%,rgba(77,107,254,.09),transparent 64%),radial-gradient(640px 320px at 0% 100%,rgba(14,165,233,.05),transparent 60%),var(--dsw-alias-bg-base);
  border-left:1px solid var(--dsw-alias-border-l1);
  box-shadow:-12px 0 32px rgba(15,23,42,.18);pointer-events:auto;color:var(--dsw-alias-label-primary);
  font-size:13px;line-height:1.5;transition:transform .18s ease,opacity .18s ease}
.rt-embed{flex:1;min-height:0;height:100%;width:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;overflow:hidden}

div:has(> [data-shell-overlay] .rt-dock[data-open="1"])[data-rightbar-fullscreen] .rt-dock{
  transform:translateX(100%);opacity:0;pointer-events:none}
.rt-grip{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:col-resize;background:transparent;z-index:2}
.rt-head{display:flex;align-items:center;gap:8px;padding:11px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,transparent);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.rt-title{font-weight:700;font-size:14.5px;letter-spacing:-.01em;display:flex;align-items:center;gap:6px;white-space:nowrap}
.rt-dot{width:8px;height:8px;border-radius:50%;background:#4d6bfe;box-shadow:0 0 0 3px rgba(77,107,254,.22)}
.rt-spacer{flex:1}
.rt-btn{border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 72%,transparent);color:inherit;
  border-radius:8px;padding:4px 10px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;white-space:nowrap;
  transition:background .15s,border-color .15s,color .15s,box-shadow .15s}
.rt-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:rgba(77,107,254,.45);color:var(--dsw-alias-label-primary)}
.rt-btn:disabled{opacity:.5;cursor:default}
.rt-btn-primary{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);border-color:#4d6bfe;color:#fff;box-shadow:0 2px 6px rgba(77,107,254,.28)}
.rt-btn-primary:hover{background:linear-gradient(135deg,#5b78ff 0%,#3b82f6 100%);color:#fff;filter:brightness(1.06)}
.rt-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-tabs-groups{border-bottom:none;padding:10px 14px 2px;gap:6px}
.rt-tab-group{border:1px solid transparent;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:600;transition:background .15s,color .15s,border-color .15s,box-shadow .15s}
.rt-tabs-groups .rt-tab-group{font-size:12px;padding:4px 10px;color:var(--dsw-alias-label-secondary)}
.rt-tab-group:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.rt-tab-group.on,.rt-tabs-groups .rt-tab-group.on{
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;border-color:#4d6bfe;
  box-shadow:0 2px 8px rgba(77,107,254,.28)}
.rt-tabs-sub{padding:4px 14px 0;gap:2px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
.rt-tab{padding:5px 10px;border-radius:7px 7px 0 0;cursor:pointer;font-size:12.5px;color:var(--dsw-alias-label-secondary);
  display:inline-flex;align-items:center;gap:5px;transition:background .15s,color .15s}
.rt-tab:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}
.rt-tab.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font-weight:600;box-shadow:inset 0 -2px 0 #4d6bfe}
.rt-tab-dot{width:7px;height:7px;border-radius:50%;background:#ef4444;flex:none;
  box-shadow:0 0 0 2px color-mix(in srgb, #ef4444 22%, transparent)}
.rt-body{flex:1;min-height:0;display:flex;flex-direction:column}
.rt-split{flex:1;min-height:0;display:flex}
.rt-side{width:200px;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:10px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 32%,transparent)}
.rt-main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.rt-toolbar{display:flex;gap:7px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap;align-items:center;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 84%,transparent)}
.rt-toolbar>span:first-child{font-size:13.5px;font-weight:700;letter-spacing:-.01em}
.rt-toolbar .rt-input{max-width:320px}
.rt-input{background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,var(--dsw-alias-bg-layer-2));border:1px solid var(--dsw-alias-border-l1);color:inherit;
  border-radius:8px;padding:5px 9px;font-size:12px;font-family:inherit;outline:none;min-width:0;transition:border-color .15s,box-shadow .15s}
.rt-input:hover{border-color:var(--dsw-alias-border-l2)}
.rt-input:focus{border-color:#4d6bfe;box-shadow:0 0 0 3px rgba(77,107,254,.16)}
.rt-pane{flex:1;overflow:auto;padding:12px}
.rt-textarea{width:100%;min-height:260px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);
  color:inherit;border-radius:6px;padding:8px;font-size:12.5px;font-family:ui-monospace,Menlo,monospace;
  line-height:1.6;resize:vertical;outline:none;box-sizing:border-box}
.rt-textarea:focus{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-list{width:210px;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:10px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 32%,transparent)}
.rt-empty{margin:18px auto;max-width:440px;padding:26px 18px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px;
  border:1px dashed color-mix(in srgb,var(--dsw-alias-border-l2) 75%,transparent);
  border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 35%,transparent)}
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
  background:radial-gradient(960px 440px at 100% 0%,rgba(77,107,254,.09),transparent 64%),radial-gradient(640px 320px at 0% 100%,rgba(14,165,233,.05),transparent 60%),var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;border-top:3px solid var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-full .rt-head{padding:12px 18px}
.rt-full .rt-tabs{padding:10px 18px 0;gap:6px;flex-wrap:wrap}
.rt-full .rt-side{width:260px}
.rt-full .rt-list{width:280px}
.rt-full .rt-row{grid-template-columns:190px 90px 130px 1.4fr 1.2fr}
.rt-full .rt-vrow{grid-template-columns:80px minmax(0,1.6fr) 200px 150px 90px 64px}
.rt-full .rt-pane{padding:18px}
.rt-full .rt-textarea{min-height:60vh}
.rt-full .rt-foot{padding:10px 18px;font-size:12px}
.rt-full .rt-body{max-width:1600px;width:100%;margin:0 auto;padding-left:20px;padding-right:20px;flex:1;min-height:0;display:flex;flex-direction:column}
.rt-subtabs{display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
.rt-subtab{padding:5px 10px;border-radius:7px 7px 0 0;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);transition:background .12s,color .12s}
.rt-subtab:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}
.rt-subtab.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font-weight:600;box-shadow:inset 0 -2px 0 #4d6bfe}

.rt-modal{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.rt-modal-box{width:min(560px,92vw);max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px;font-size:12.5px;line-height:1.7;
  box-shadow:0 18px 48px rgba(0,0,0,.35);color:var(--dsw-alias-label-primary)}
.rt-modal-box .rt-kv b{min-width:76px}

.rt-dock *::-webkit-scrollbar,.rt-full *::-webkit-scrollbar{width:8px;height:8px}
.rt-dock *::-webkit-scrollbar-thumb,.rt-full *::-webkit-scrollbar-thumb{
  background:color-mix(in srgb,var(--dsw-alias-label-secondary) 32%,transparent);border-radius:99px;border:2px solid transparent;background-clip:padding-box}
.rt-dock *::-webkit-scrollbar-thumb:hover,.rt-full *::-webkit-scrollbar-thumb:hover{
  background:color-mix(in srgb,var(--dsw-alias-label-secondary) 50%,transparent);background-clip:padding-box}
.rt-dock *::-webkit-scrollbar-track,.rt-full *::-webkit-scrollbar-track{background:transparent}

body[data-ds-dark-theme] .rt-btn-primary,
body[data-ds-dark-theme] .rt-tab-group.on,
body[data-ds-dark-theme] .rt-tabs-groups .rt-tab-group.on{
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;border-color:#4d6bfe;
  box-shadow:0 2px 10px rgba(77,107,254,.35)}
body[data-ds-dark-theme] .rt-btn-primary:hover,
body[data-ds-dark-theme] .rt-tab-group.on:hover,
body[data-ds-dark-theme] .rt-tabs-groups .rt-tab-group.on:hover{
  background:linear-gradient(135deg,#5b78ff 0%,#3b82f6 100%);color:#fff}
body[data-ds-dark-theme] .rt-btn-primary{filter:none}

.rt-harness-modebar{display:inline-flex;align-items:center;gap:4px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.rt-harness-modebtn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;padding:4px 9px;border-radius:6px;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .14s,color .14s}
.rt-harness-modebtn:hover{color:var(--dsw-alias-label-primary)}
.rt-harness-modebtn.on{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;box-shadow:0 1px 4px rgba(77,107,254,.3)}

.rt-wish-wizard,
.rt-bento-card.rt-wish-wizard{
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:12px 14px;
  border-radius:12px;
  border:1px solid var(--rt-border,var(--dsw-alias-border-l1));
  background:var(--rt-bg-card,var(--dsw-alias-bg-layer-1));
  box-shadow:0 1px 4px rgba(15,23,42,.05);
  box-sizing:border-box;
  width:100%;
  min-width:0;
}
body[data-ds-dark-theme] .rt-wish-wizard,
body[data-ds-dark-theme] .rt-bento-card.rt-wish-wizard{
  background:var(--dsw-alias-bg-layer-1);
  border-color:rgba(148,163,184,.22);
  box-shadow:0 3px 10px rgba(0,0,0,.22);
}
.rt-wish-wizard-body{
  display:flex;
  flex-direction:column;
  gap:8px;
  min-width:0;
  box-sizing:border-box;
}
.rt-wish-blueprint-deck{
  padding:10px 12px;
  border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  box-sizing:border-box;
  min-width:0;
}
body[data-ds-dark-theme] .rt-wish-blueprint-deck{
  border-color:rgba(148,163,184,.2);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 86%,var(--dsw-alias-bg-base));
}

.rt-p4-workbench{
  display:flex;
  flex-direction:column;
  gap:10px;
  grid-column:1 / -1;
  width:100%;
  box-sizing:border-box;
  margin:0;
}
.rt-p4-split-grid,
.rt-p4-vertical-stack{
  display:grid;
  grid-template-columns:1fr;
  gap:12px;
  padding:12px 14px;
  align-items:stretch;
  width:100%;
  box-sizing:border-box;
}

.rt-net-pane{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px;
  padding:10px 12px;
  background:var(--dsw-alias-bg-layer-1);
  display:flex;
  flex-direction:column;
  gap:8px;
  min-width:0;
  box-shadow:0 1px 6px -2px rgba(15,23,42,.05);
}

.rt-p5-topbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:6px;
  flex-wrap:wrap;
  padding:8px 12px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 60%,var(--dsw-alias-bg-layer-1));
}
.rt-p5-filters{
  display:inline-flex;
  align-items:center;
  gap:4px;
  flex-wrap:wrap;
}
.rt-p5-connector-svg{
  display:block;
  width:100%;
  height:56px;
  overflow:visible;
  pointer-events:none;
  flex:none;
}

.rt-tree-stage,
.rt-tree-vertical-stage,
.rt-p5-tree-stage{
  position:relative;
  box-sizing:border-box;
}
.rt-tree-stage{
  width:100%;
  min-width:max-content;
  display:flex;
  flex-direction:column;
  align-items:stretch;
}
.rt-tree-vertical-stage{
  width:100%;
  display:flex;
  flex-direction:column;
  align-items:center;
}
.rt-p5-tree-stage{
  width:760px;
  max-width:100%;
  margin:0 auto;
  display:flex;
  flex-direction:column;
  align-items:center;
  transform-origin:top center;
  transition:transform .16s cubic-bezier(.22,1,.36,1);
}
svg.rt-tree-edges-svg{
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  display:block;
  overflow:visible;
  pointer-events:none;
  z-index:1;
  background:none;
}
.rt-tree-node-layer{
  position:relative;
  z-index:2;
  width:100%;
  min-width:0;
  box-sizing:border-box;
}
.rt-tree-edge-path{
  fill:none;
  stroke:var(--rt-edge-color,var(--dsw-alias-border-l2,#94a3b8));
  stroke-width:1.85;
  stroke-linecap:round;
  stroke-linejoin:round;
  transition:stroke .16s ease,stroke-width .16s ease,opacity .16s ease;
}
body[data-ds-dark-theme] .rt-tree-edge-path{
  stroke:var(--rt-edge-color,rgba(148,163,184,.5));
}
.rt-tree-edge-path.is-running{
  stroke:var(--rt-edge-color,var(--wb-blue,#3b82f6));
  stroke-width:2.2;
  stroke-dasharray:6 5;
  animation:rt-dash-flow 0.9s linear infinite;
}
body[data-ds-dark-theme] .rt-tree-edge-path.is-running{
  stroke:var(--rt-edge-color,#60a5fa);
}
.rt-tree-edge-path.is-done{
  stroke:var(--rt-edge-color,#10b981);
  stroke-width:2;
  stroke-dasharray:none;
  opacity:.9;
}
body[data-ds-dark-theme] .rt-tree-edge-path.is-done{
  stroke:var(--rt-edge-color,#34d399);
}
.rt-tree-edge-path.is-error{
  stroke:#ef4444;
  stroke-width:2.2;
  stroke-dasharray:4 3;
  opacity:.95;
}
body[data-ds-dark-theme] .rt-tree-edge-path.is-error{
  stroke:#f87171;
}
.rt-tree-edge-path.is-active{
  stroke-width:2.6;
  opacity:1;
}
.rt-tree-edge-path.is-dimmed{
  opacity:.24;
}
@media (prefers-reduced-motion: reduce){
  .rt-tree-edge-path.is-running{
    animation:none;
  }
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
  gap:28px;
  align-items:start;
  position:relative;
}
@media(max-width:680px){
  .rt-p5-branches-grid{
    grid-template-columns:1fr;
    gap:14px;
  }
}

.rt-tree-port,
.rt-node-handle{
  width:6px;
  height:6px;
  border-radius:50%;
  background:var(--dsw-alias-bg-layer-1);
  border:1.5px solid var(--wb-blue,#3b82f6);
  position:absolute;
  z-index:3;
  pointer-events:none;
  box-sizing:border-box;
  box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base);
}
body[data-ds-dark-theme] .rt-tree-port,
body[data-ds-dark-theme] .rt-node-handle{
  background:var(--dsw-alias-bg-layer-2);
  border-color:#60a5fa;
}
.rt-tree-port-left{
  left:-4px;
  right:auto;
  top:50%;
  transform:translateY(-50%);
}
.rt-tree-port-right{
  right:-4px;
  left:auto;
  top:50%;
  transform:translateY(-50%);
}
.rt-tree-port-top,
.rt-node-handle-top{
  top:-4px;
  bottom:auto;
  left:50%;
  transform:translateX(-50%);
}
.rt-tree-port-bottom,
.rt-node-handle-bottom{
  bottom:-4px;
  top:auto;
  left:50%;
  transform:translateX(-50%);
}
.rt-tree-port.is-done{border-color:#10b981}
.rt-tree-port.is-error{border-color:#ef4444}

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

.rt-panzoom-viewport,
.rt-panzoom-viewport *{
  box-sizing: border-box;
}
.rt-panzoom-viewport{
  position: relative;
  width: 100%;
  min-height: 280px;
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
  border-radius: 10px;
  background: radial-gradient(circle at 12px 12px, rgba(59,130,246,0.11) 1.1px, transparent 1.1px), var(--dsw-alias-bg-base);
  background-size: 18px 18px;
}
.rt-panzoom-viewport.rt-panzoom-viewport-cluster{
  min-height: 340px;
  max-height: 580px;
}
body[data-ds-dark-theme] .rt-panzoom-viewport{
  background: radial-gradient(circle at 12px 12px, rgba(96,165,250,0.15) 1.1px, transparent 1.1px), var(--dsw-alias-bg-base);
  background-size: 18px 18px;
  border-color: rgba(148,163,184,0.22);
}
.rt-panzoom-viewport.grabbing{
  cursor: grabbing;
}
.rt-panzoom-toolbar{
  position: absolute;
  right: 8px;
  top: 8px;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--rt-bg-card, #ffffff);
  border: 1px solid var(--rt-border, var(--dsw-alias-border-l1));
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.08);
}
body[data-ds-dark-theme] .rt-panzoom-toolbar{
  background: var(--dsw-alias-bg-layer-2, #1e293b);
  border-color: rgba(148,163,184,0.24);
  box-shadow: 0 4px 12px rgba(0,0,0,0.34);
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

.rt-tree-layout-setting{
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

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
  gap: 4px;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.04);
}
body[data-ds-dark-theme] .rt-p4-node-card{
  background: var(--dsw-alias-bg-layer-2);
  border-color: rgba(148, 163, 184, 0.22);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24);
}
.rt-p4-node-card:hover{
  border-color: #3b82f6;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -4px rgba(59, 130, 246, 0.18);
}
.rt-p4-node-card.on{
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2), 0 4px 12px -4px rgba(59, 130, 246, 0.18);
  background: color-mix(in srgb, rgba(59, 130, 246, 0.07) 100%, var(--dsw-alias-bg-layer-1));
}
body[data-ds-dark-theme] .rt-p4-node-card.on{
  border-color: #60a5fa;
  background: color-mix(in srgb, rgba(59, 130, 246, 0.14) 100%, var(--dsw-alias-bg-layer-2));
}

.rt-tree-layout-horizontal{
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 44px;
  min-width: max-content;
  padding: 14px 18px;
  box-sizing: border-box;
}
.rt-h-root-col{
  width: 248px;
  flex-shrink: 0;
  align-self: center;
  position: relative;
  box-sizing: border-box;
}
.rt-h-waves-stack{
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
}
.rt-wave-horizontal-lane{
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 36px;
  position: relative;
  box-sizing: border-box;
}
.rt-wave-horizontal-lane > .rt-tree-wave-card,
.rt-tree-layout-horizontal .rt-tree-wave-card{
  width: 248px;
  flex-shrink: 0;
  position: relative;
  box-sizing: border-box;
}
.rt-wave-right-children{
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 10px;
  align-items: stretch;
  padding: 2px 0;
  box-sizing: border-box;
}
.rt-wave-right-children > *,
.rt-wave-right-children .rt-p4-node-card{
  width: 228px;
  flex-shrink: 0;
  position: relative;
  box-sizing: border-box;
}

.rt-tree-layout-vertical{
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  width: 100%;
  padding: 16px 14px;
  box-sizing: border-box;
}
.rt-tree-wave-row{
  display: grid;
  grid-template-columns: repeat(4, minmax(215px, 1fr));
  gap: 12px;
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
  gap: 5px;
  min-width: 0;
  width: 100%;
  position: relative;
  box-sizing: border-box;
}
.rt-wave-subtree-children{
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-top: 6px;
  padding: 6px;
  border-radius: 9px;
  border: 1px dashed var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  position: relative;
  box-sizing: border-box;
  min-width: 0;
}
body[data-ds-dark-theme] .rt-wave-subtree-children{
  border-color: rgba(148, 163, 184, 0.24);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 86%, var(--dsw-alias-bg-base));
}
.rt-tree-wave-card{
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.14s ease, background 0.16s ease;
  box-shadow: 0 1px 5px rgba(15,23,42,0.04);
}
body[data-ds-dark-theme] .rt-tree-wave-card{
  background: var(--dsw-alias-bg-layer-2);
  border-color: rgba(148,163,184,0.22);
  box-shadow: 0 2px 10px rgba(0,0,0,0.24);
}
.rt-tree-wave-card:hover{
  border-color: #3b82f6;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -4px rgba(59,130,246,0.16);
}
body[data-ds-dark-theme] .rt-tree-wave-card:hover{
  border-color: #60a5fa;
  box-shadow: 0 4px 14px -4px rgba(59,130,246,0.28);
}
.rt-tree-wave-card.active,.rt-tree-wave-card.on,.rt-tree-wave-card.expanded{
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59,130,246,0.2), 0 4px 14px -4px rgba(59,130,246,0.18);
  background: color-mix(in srgb, rgba(59,130,246,0.06) 100%, var(--dsw-alias-bg-layer-1));
}
body[data-ds-dark-theme] .rt-tree-wave-card.active,
body[data-ds-dark-theme] .rt-tree-wave-card.on,
body[data-ds-dark-theme] .rt-tree-wave-card.expanded{
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(96,165,250,0.25), 0 6px 16px -4px rgba(37,99,235,0.3);
  background: color-mix(in srgb, rgba(59,130,246,0.13) 100%, var(--dsw-alias-bg-layer-2));
}
.rt-tree-wave-card-badge{
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: #2563eb;
  background: rgba(59,130,246,0.1);
  border: 1px solid rgba(59,130,246,0.26);
  white-space: nowrap;
}
body[data-ds-dark-theme] .rt-tree-wave-card-badge{
  color: #93c5fd;
  background: rgba(59,130,246,0.2);
  border-color: rgba(96,165,250,0.36);
}
.rt-tree-expanded-grid{
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 8px;
  width: 100%;
  margin-top: 6px;
  padding: 8px;
  border-radius: 9px;
  border: 1px dashed var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  box-sizing: border-box;
}
body[data-ds-dark-theme] .rt-tree-expanded-grid{
  border-color: rgba(148,163,184,0.24);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 86%, var(--dsw-alias-bg-base));
}

.rt-canvas-filter-bar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:6px;
  flex-wrap:wrap;
  padding:6px 10px;
  border-radius:9px;
  border:1px solid var(--rt-border,var(--dsw-alias-border-l1));
  background:var(--rt-bg-subtle,color-mix(in srgb,var(--dsw-alias-bg-layer-2) 65%,transparent));
  box-sizing:border-box;
}
.rt-p4-node-card.is-error,
.rt-tree-wave-card.is-error{
  border-color:#ef4444;
  background:color-mix(in srgb,rgba(239,68,68,.08) 100%,var(--rt-bg-card,var(--dsw-alias-bg-layer-1)));
  box-shadow:0 2px 8px -2px rgba(239,68,68,.18);
}
.rt-p4-node-card.is-error:hover,
.rt-tree-wave-card.is-error:hover{
  border-color:#dc2626;
  box-shadow:0 4px 12px -4px rgba(239,68,68,.26);
}
.rt-p4-node-card.is-error.on{
  border-color:#dc2626;
  box-shadow:0 0 0 2px rgba(239,68,68,.24),0 4px 12px -4px rgba(239,68,68,.24);
}
body[data-ds-dark-theme] .rt-p4-node-card.is-error,
body[data-ds-dark-theme] .rt-tree-wave-card.is-error{
  border-color:#f87171;
  background:color-mix(in srgb,rgba(239,68,68,.15) 100%,var(--dsw-alias-bg-layer-2));
  box-shadow:0 3px 10px rgba(0,0,0,.32),0 0 0 1px rgba(248,113,113,.2);
}

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
body[data-ds-dark-theme] .rt-shard-lock-badge{
  color:#93c5fd;
  background:rgba(59,130,246,.2);
  border-color:rgba(96,165,250,.36);
}

.rt-pane.rt-collab-page{
  display:flex;
  flex-direction:column;
  gap:12px;
  padding:12px 14px 20px;
  max-width:1180px;
  width:100%;
  margin:0 auto;
  box-sizing:border-box;
}
.rt-collab-page > .rt-card{
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:12px 14px;
  border-radius:11px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 1px 6px rgba(15,23,42,.04);
  box-sizing:border-box;
}
body[data-ds-dark-theme] .rt-collab-page > .rt-card{
  background:var(--dsw-alias-bg-layer-2);
  border-color:rgba(148,163,184,.2);
  box-shadow:0 4px 12px rgba(0,0,0,.24);
}
.rt-card.rt-onboard-card{
  border-color:rgba(77,107,254,.28);
  background:var(--dsw-alias-bg-layer-1);
}
.rt-card.rt-onboard-card.is-compact{
  padding:9px 14px;
  gap:5px;
}
body[data-ds-dark-theme] .rt-card.rt-onboard-card{
  border-color:rgba(96,165,250,.3);
  background:var(--dsw-alias-bg-layer-2);
}
.rt-onboard-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  flex-wrap:wrap;
}
.rt-onboard-title{
  font-size:14px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
}
.rt-onboard-steps{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:8px;
}
@media(max-width:820px){
  .rt-onboard-steps{
    grid-template-columns:1fr;
  }
}
.rt-onboard-step{
  display:flex;
  flex-direction:column;
  gap:3px;
  padding:8px 10px;
  border-radius:9px;
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
  line-height:1.45;
  color:var(--dsw-alias-label-secondary);
}
.rt-onboard-actions{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
}
.rt-onboard-bind-details{
  font-size:12px;
  color:var(--dsw-alias-label-secondary);
  padding:7px 10px;
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
.rt-clarify-chips-row{
  display:flex;
  align-items:center;
  gap:5px;
  flex-wrap:wrap;
  margin-bottom:4px;
}
.rt-approval-list{
  display:flex;
  flex-direction:column;
  gap:8px;
}
.rt-approval-card{
  display:flex;
  flex-direction:column;
  gap:7px;
  padding:10px 12px;
  border-radius:9px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);
  box-sizing:border-box;
}
.rt-approval-card.is-pending{
  border-left:3px solid #f59e0b;
}
body[data-ds-dark-theme] .rt-approval-card{
  background:rgba(15,23,42,.42);
  border-color:rgba(148,163,184,.2);
}
.rt-approval-digest-grid{
  display:flex;
  flex-direction:column;
  gap:4px;
  padding:7px 9px;
  border-radius:8px;
  background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-border-l1);
  font-size:12px;
  line-height:1.45;
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

.rt-ov-standby-card{
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:10px;
  padding:18px 20px;
  border-radius:12px;
  border:1.5px dashed rgba(77,107,254,.32);
  background:var(--dsw-alias-bg-layer-1);
}
body[data-ds-dark-theme] .rt-ov-standby-card{
  border-color:rgba(96,165,250,.35);
  background:var(--dsw-alias-bg-layer-2);
}
.rt-ov-standby-badge-row{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
}
.rt-ov-standby-title{
  font-size:16px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
}
.rt-ov-standby-sub{
  font-size:12.5px;
  line-height:1.55;
  color:var(--dsw-alias-label-secondary);
  max-width:740px;
}
.rt-ov-standby-actions{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  margin-top:2px;
}
.rt-ov-action-banner{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  padding:8px 12px;
  border-radius:9px;
  font-size:12.5px;
  border:1px solid rgba(77,107,254,.26);
  background:rgba(77,107,254,.05);
  color:var(--dsw-alias-label-primary);
}
.rt-ov-action-banner.is-pending{
  border-color:rgba(245,158,11,.4);
  background:rgba(245,158,11,.09);
}
body[data-ds-dark-theme] .rt-ov-action-banner{
  border-color:rgba(96,165,250,.3);
  background:rgba(59,130,246,.12);
}
body[data-ds-dark-theme] .rt-ov-action-banner.is-pending{
  border-color:rgba(251,191,36,.4);
  background:rgba(245,158,11,.15);
}
.rt-ov-kpi-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:10px;
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
  gap:5px;
  padding:11px 13px;
  border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  box-sizing:border-box;
  min-width:0;
  transition:border-color .14s ease,background-color .14s ease,box-shadow .14s ease;
}
.rt-ov-kpi-card.is-interactive{
  cursor:pointer;
}
.rt-ov-kpi-card.is-interactive:hover{
  border-color:rgba(77,107,254,.55);
  box-shadow:0 2px 8px rgba(15,23,42,.04);
}
.rt-ov-kpi-card.is-expanded{
  border-color:#4d6bfe;
  background:color-mix(in srgb,#4d6bfe 4%,var(--dsw-alias-bg-layer-1));
  box-shadow:0 0 0 1px rgba(77,107,254,.2);
}
body[data-ds-dark-theme] .rt-ov-kpi-card{
  background:var(--dsw-alias-bg-layer-2);
  border-color:rgba(148,163,184,.2);
}
body[data-ds-dark-theme] .rt-ov-kpi-card.is-expanded{
  border-color:#60a5fa;
  background:rgba(59,130,246,.1);
}
.rt-ov-kpi-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:6px;
}
.rt-ov-kpi-label{
  font-size:11.5px;
  font-weight:600;
  color:var(--dsw-alias-label-secondary);
}
.rt-ov-kpi-toggle{
  font-size:10.5px;
  font-weight:600;
  padding:1px 6px;
  border-radius:999px;
  color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l1);
  white-space:nowrap;
}
.rt-ov-kpi-card.is-expanded .rt-ov-kpi-toggle{
  color:#2563eb;
  border-color:rgba(77,107,254,.35);
  background:rgba(77,107,254,.08);
}
body[data-ds-dark-theme] .rt-ov-kpi-card.is-expanded .rt-ov-kpi-toggle{
  color:#93c5fd;
  background:rgba(59,130,246,.16);
}
.rt-ov-kpi-val{
  font-size:15px;
  font-weight:700;
  font-variant-numeric:tabular-nums;
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
.rt-ov-mini-bar{
  display:flex;
  align-items:center;
  width:100%;
  height:5px;
  border-radius:999px;
  overflow:hidden;
  background:var(--dsw-alias-bg-layer-2);
  gap:1px;
}
body[data-ds-dark-theme] .rt-ov-mini-bar{
  background:rgba(148,163,184,.16);
}
.rt-ov-mini-seg{
  height:100%;
  min-width:2px;
  border-radius:1px;
}
.rt-ov-detail-drawer{
  display:flex;
  flex-direction:column;
  gap:12px;
  padding:14px 16px;
  border-radius:12px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
}
body[data-ds-dark-theme] .rt-ov-detail-drawer{
  background:var(--dsw-alias-bg-layer-2);
  border-color:rgba(148,163,184,.22);
}
.rt-ov-detail-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  flex-wrap:wrap;
  padding-bottom:8px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
}
.rt-ov-detail-title{
  display:flex;
  align-items:center;
  gap:8px;
  font-size:13px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
}
.rt-ov-detail-actions{
  display:flex;
  align-items:center;
  gap:6px;
}
.rt-ov-detail-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
}
@media(max-width:880px){
  .rt-ov-detail-grid{
    grid-template-columns:1fr;
  }
}
.rt-ov-detail-card{
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:12px;
  border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  min-width:0;
}
body[data-ds-dark-theme] .rt-ov-detail-card{
  background:rgba(15,23,42,.35);
  border-color:rgba(148,163,184,.18);
}
.rt-ov-detail-card-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  font-size:12px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
}
.rt-ov-stat-tiles{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:8px;
}
@media(max-width:640px){
  .rt-ov-stat-tiles{
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
}
.rt-ov-stat-tile{
  padding:8px 10px;
  border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  display:flex;
  flex-direction:column;
  gap:2px;
}
.rt-ov-stat-tile-val{
  font-size:16px;
  font-weight:700;
  font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-primary);
}
.rt-ov-stat-tile-lbl{
  font-size:10.5px;
  color:var(--dsw-alias-label-secondary);
}
.rt-ov-seg-bar{
  display:flex;
  width:100%;
  height:10px;
  border-radius:999px;
  overflow:hidden;
  background:var(--dsw-alias-bg-layer-2);
  gap:1px;
}
.rt-ov-seg-piece{
  height:100%;
  min-width:3px;
}
.rt-ov-donut-wrap{
  display:flex;
  align-items:center;
  gap:14px;
  flex-wrap:wrap;
}
.rt-ov-donut-box{
  position:relative;
  width:92px;
  height:92px;
  flex-shrink:0;
}
.rt-ov-donut-center{
  position:absolute;
  inset:0;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  pointer-events:none;
}
.rt-ov-donut-main{
  font-size:13px;
  font-weight:700;
  font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-primary);
}
.rt-ov-donut-sub{
  font-size:9.5px;
  color:var(--dsw-alias-label-secondary);
}
.rt-ov-legend-grid{
  flex:1;
  min-width:180px;
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:6px 14px;
}
@media(max-width:520px){
  .rt-ov-legend-grid{
    grid-template-columns:1fr;
  }
}
.rt-ov-legend-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  font-size:11.5px;
  min-width:0;
}
.rt-ov-legend-name{
  display:inline-flex;
  align-items:center;
  gap:6px;
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.rt-ov-dot{
  width:7px;
  height:7px;
  border-radius:50%;
  flex-shrink:0;
}
.rt-ov-legend-val{
  font-variant-numeric:tabular-nums;
  font-weight:600;
  color:var(--dsw-alias-label-primary);
  white-space:nowrap;
}
.rt-ov-table-wrap{
  width:100%;
  overflow-x:auto;
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:8px;
}
.rt-ov-table{
  width:100%;
  border-collapse:collapse;
  font-size:11.5px;
}
.rt-ov-table th{
  text-align:left;
  font-weight:600;
  font-size:10.5px;
  color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-2);
  padding:6px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  white-space:nowrap;
}
.rt-ov-table td{
  padding:6px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
  vertical-align:middle;
}
.rt-ov-table tr:last-child td{
  border-bottom:none;
}
.rt-ov-wave-strip{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:8px;
}
@media(max-width:720px){
  .rt-ov-wave-strip{
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
}
.rt-ov-wave-cell{
  padding:8px 10px;
  border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  display:flex;
  flex-direction:column;
  gap:4px;
}
.rt-ov-node-strip{
  display:flex;
  flex-direction:column;
  gap:4px;
  padding:8px 12px;
  border-radius:9px;
  border:1px solid rgba(59,130,246,.3);
  background:var(--dsw-alias-bg-layer-1);
  box-sizing:border-box;
}
body[data-ds-dark-theme] .rt-ov-node-strip{
  border-color:rgba(96,165,250,.34);
  background:var(--dsw-alias-bg-layer-2);
}

.rt-lower-process-deck{
  display:flex;
  flex-direction:column;
  gap:12px;
  width:100%;
  min-width:0;
  box-sizing:border-box;
}

.rt-swim-pane{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px;
  padding:10px 12px;
  background:var(--dsw-alias-bg-layer-1);
  display:flex;
  flex-direction:column;
  gap:6px;
  width:100%;
  min-width:0;
  box-sizing:border-box;
  box-shadow:0 1px 6px -2px rgba(15,23,42,.05);
}
.rt-swim-row{
  display:grid;
  grid-template-columns:156px minmax(200px,1fr);
  align-items:stretch;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  min-height:46px;
  position:relative;
  transition:background .12s;
}
.rt-swim-row:last-child{border-bottom:0}
.rt-swim-row:hover{background:color-mix(in srgb,#4d6bfe 4%,var(--dsw-alias-bg-layer-2))}
.rt-swim-row.on{background:rgba(77,107,254,.06)}
.rt-swim-track{
  position:relative;
  display:flex;
  align-items:center;
  gap:10px;
  padding:6px 12px;
  min-height:38px;
  min-width:200px;
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
.rt-swim-matrix-wrap{
  position:relative;
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:9px;
  background:var(--dsw-alias-bg-layer-1);
  overflow:hidden;
}

.rt-collab-pane{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px;
  padding:10px 12px;
  background:var(--dsw-alias-bg-layer-1);
  display:flex;
  flex-direction:column;
  gap:6px;
  width:100%;
  min-width:0;
  box-sizing:border-box;
  box-shadow:0 1px 6px -2px rgba(15,23,42,.05);
}

.rt-step-chain{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:6px;
  align-items:stretch;
  width:100%;
  padding:4px 0;
  box-sizing:border-box;
  position:relative;
}
@media(max-width:520px){
  .rt-step-chain{
    grid-template-columns:1fr;
  }
}
.rt-step-node{
  display:flex;
  align-items:stretch;
  gap:5px;
  min-width:0;
  position:relative;
}
.rt-step-pill{
  display:flex;
  flex-direction:column;
  gap:2px;
  padding:6px 8px;
  border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);
  min-width:0;
  flex:1;
  position:relative;
  transition:border-color 0.15s ease,transform 0.14s ease,box-shadow 0.15s ease;
}
body[data-ds-dark-theme] .rt-step-pill{
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 88%,var(--dsw-alias-bg-base));
  border-color:rgba(148,163,184,0.22);
}
.rt-step-pill:hover{
  border-color:var(--wb-blue,#4d6bfe);
  transform:translateY(-1px);
  box-shadow:0 3px 8px -2px rgba(59,130,246,0.14);
}
body[data-ds-dark-theme] .rt-step-pill:hover{
  border-color:#60a5fa;
  box-shadow:0 3px 10px -2px rgba(59,130,246,0.24);
}
.rt-step-arrow{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  flex:none;
  font-size:11px;
  font-weight:700;
  color:var(--dsw-alias-label-secondary);
  opacity:0.78;
  user-select:none;
}
body[data-ds-dark-theme] .rt-step-arrow{
  color:#93c5fd;
  opacity:0.85;
}
.rt-agent-inspector-drawer{
  width:100%;
  box-sizing:border-box;
  border:1px solid color-mix(in srgb,var(--wb-blue,#3b82f6) 42%,var(--dsw-alias-border-l1));
  border-left:3px solid var(--wb-blue,#3b82f6);
  border-radius:10px;
  padding:10px 12px;
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 4px 14px -6px rgba(15,23,42,0.12);
  display:flex;
  flex-direction:column;
  gap:8px;
  animation:rt-subnode-spawn 0.3s cubic-bezier(0.22,1,0.36,1);
}
body[data-ds-dark-theme] .rt-agent-inspector-drawer{
  border-color:rgba(96,165,250,0.4);
  border-left-color:#60a5fa;
  background:var(--dsw-alias-bg-layer-2);
  box-shadow:0 6px 18px -6px rgba(0,0,0,0.4);
}
.rt-jump-chat-btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:5px;
  padding:4px 10px;
  border-radius:7px;
  font-size:11.5px;
  font-weight:600;
  color:#ffffff;
  background:var(--wb-blue,#3b82f6);
  border:1px solid #2563eb;
  cursor:pointer;
  box-shadow:0 1px 4px rgba(59,130,246,0.22);
  transition:transform 0.14s ease,box-shadow 0.14s ease,background 0.14s ease;
}
.rt-jump-chat-btn:hover{
  transform:translateY(-1px);
  background:#2563eb;
  box-shadow:0 3px 10px rgba(59,130,246,0.28);
}
body[data-ds-dark-theme] .rt-jump-chat-btn{
  background:#4d6bfe;
  border-color:#60a5fa;
  box-shadow:0 2px 8px rgba(59,130,246,0.32);
}

.rt-digest-box{
  display:flex;
  flex-direction:column;
  gap:5px;
  padding:8px 10px;
  border-radius:8px;
  border:1px solid color-mix(in srgb,#10b981 30%,var(--dsw-alias-border-l1));
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);
  font-size:11.5px;
  line-height:1.5;
  box-sizing:border-box;
}
body[data-ds-dark-theme] .rt-digest-box{
  border-color:rgba(52,211,153,0.32);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 90%,var(--dsw-alias-bg-base));
}
.rt-plan-approve-btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:5px;
  padding:4px 10px;
  border-radius:7px;
  font-size:11.5px;
  font-weight:600;
  color:#ffffff;
  background:#10b981;
  border:1px solid #059669;
  cursor:pointer;
  box-shadow:0 1px 4px rgba(16,185,129,0.22);
  transition:transform 0.14s ease,box-shadow 0.14s ease,background 0.14s ease;
}
.rt-plan-approve-btn:hover{
  transform:translateY(-1px);
  background:#059669;
  box-shadow:0 3px 10px rgba(16,185,129,0.28);
}
body[data-ds-dark-theme] .rt-plan-approve-btn{
  background:#10b981;
  border-color:#34d399;
  box-shadow:0 2px 8px rgba(16,185,129,0.3);
}

.rt-seg,.rt-item{padding:7px 8px;border-radius:8px;cursor:pointer;margin-bottom:4px;border:1px solid transparent;transition:background .12s,border-color .12s,box-shadow .12s}
.rt-seg:hover,.rt-item:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 85%,transparent)}
.rt-seg.on,.rt-item.on{background:rgba(77,107,254,.1);border-color:rgba(77,107,254,.45)}
.rt-seg-cidr{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
.rt-seg-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.rt-table{flex:1;overflow:auto}
.rt-row{display:grid;grid-template-columns:150px 74px 104px 1.15fr 1fr;gap:8px;padding:6px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;cursor:pointer;font-size:12.5px;transition:background .12s}
.rt-row.head,.rt-vrow.head,.rt-score-row.head{cursor:default;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;position:sticky;top:0;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 78%,var(--dsw-alias-bg-layer-1));z-index:1;letter-spacing:.02em}
.rt-row.head:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-mono{font-family:ui-monospace,Menlo,monospace}
.rt-tag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;margin-right:4px;font-weight:500;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);white-space:nowrap}
.rt-tag-passive{color:#6366f1;border-color:#6366f155;background:#6366f11a}
.rt-tag-active{color:#0ea5e9;border-color:#0ea5e955;background:#0ea5e91a}
.rt-tag-live{color:#4d6bfe;border-color:#4d6bfe55;background:#4d6bfe1a}
.rt-tag-warn{color:#ef4444;border-color:#ef444455;background:#ef44441a}
.rt-hint{border-radius:9px;padding:7px 9px;margin-bottom:8px;font-size:11.5px;line-height:1.6;
  border:1px solid #ef444488;background:#ef44440f;color:var(--dsw-alias-label-primary)}
.rt-hint b{color:#ef4444}
.rt-tag-dead{color:var(--dsw-alias-label-secondary)}
.rt-expand{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-kv{display:flex;gap:8px;margin-bottom:3px;align-items:baseline}
.rt-kv b{color:var(--dsw-alias-label-primary);font-weight:600;min-width:64px;flex:none}
.rt-card{border:1px solid var(--dsw-alias-border-l1);border-radius:11px;padding:11px 13px;margin-bottom:10px;
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 1px 3px rgba(15,23,42,.04)}
.rt-card h4{margin:0 0 6px;font-size:12.5px;letter-spacing:-.005em}
.rt-item-name{font-weight:600;font-size:12.5px}
.rt-item-desc{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rt-test{display:inline-block;padding:0 5px;border-radius:999px;font-size:11px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.rt-test-testing{color:#0ea5e9;border-color:#0ea5e955;background:#0ea5e91a}
.rt-test-tested{color:#4d6bfe;border-color:#4d6bfe55;background:#4d6bfe1a}
.rt-test-blocked{color:#fff;background:#ef4444;border-color:#ef4444}
.rt-test-abandoned{color:#94a3b8;border-color:#94a3b855;background:#94a3b81a}
.rt-test-no_surface{color:#6366f1;border-color:#6366f155;background:#6366f11a}
.rt-pri{display:inline-block;padding:0 6px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
.rt-pri-high{color:#fff;background:#4d6bfe}
.rt-pri-medium{color:#fff;background:#0ea5e9}
.rt-pri-low{color:#fff;background:#94a3b8}
.rt-score-row{display:grid;grid-template-columns:16px 62px minmax(0,1fr) 116px 66px;gap:8px;padding:7px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;font-size:12.5px;cursor:pointer;transition:background .12s}
.rt-row:hover,.rt-vrow:hover,.rt-score-row:hover{background:color-mix(in srgb,#4d6bfe 6%,var(--dsw-alias-bg-layer-2))}
.rt-score-detail{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-score-group{display:flex;align-items:center;gap:8px;padding:7px 10px;margin:6px 8px 3px;border-radius:8px;
  font-size:12px;font-weight:600;border-top:none;background:linear-gradient(90deg,rgba(77,107,254,.09),transparent 72%)}
.rt-score-group .rt-sg-sub{font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-sess-facts{display:flex;flex-direction:column;gap:2px;margin-top:5px}
.rt-sess-fact{display:flex;gap:6px;font-size:11.5px;line-height:1.5}
.rt-sess-fact>b{flex:none;min-width:62px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.rt-sess-fact>span{min-width:0;overflow-wrap:anywhere}
.rt-sess-fold{margin-top:6px;font-size:11.5px}
.rt-sess-fold>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);user-select:none}
.rt-sess-fold>summary:hover{color:var(--dsw-alias-label-primary)}
.rt-score-row .rt-scope{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.rt-score-form{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px}
.rt-score-form input,.rt-score-form select{width:100%;box-sizing:border-box}
.rt-vrow{display:grid;grid-template-columns:62px minmax(0,1fr) 132px 108px 74px 52px;gap:8px;padding:6px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;font-size:12.5px;cursor:pointer;transition:background .12s}
.rt-vdetail{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-vdetail .rt-kv{margin-bottom:4px}
.rt-actions{display:flex;gap:6px;margin-top:6px}
.rt-section{padding:8px 10px 2px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.rt-link{color:var(--wb-blue,var(--dsw-alias-brand-primary));text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-link:hover{text-decoration:underline}
.rt-sev{display:inline-block;padding:1px 7px;border-radius:5px;font-size:11px;font-weight:600;border:1px solid transparent;letter-spacing:.01em}
.rt-sev-critical{color:#fff;background:#b91c1c}.rt-sev-high{color:#fff;background:#ef4444}
.rt-sev-medium{color:#7c2d12;background:#fdba74}.rt-sev-low{color:#1e3a8a;background:#bfdbfe}
.rt-sev-info{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1)}
.rt-dot-on{display:inline-block;width:7px;height:7px;border-radius:50%;background:#4d6bfe;box-shadow:0 0 0 3px #4d6bfe33}
.rt-dot-off{display:inline-block;width:7px;height:7px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 3px #ef444433}
.rt-dot-unk{display:inline-block;width:7px;height:7px;border-radius:50%;background:#94a3b8;box-shadow:0 0 0 3px #94a3b833}
.rt-sess-grid{display:grid;grid-template-columns:1fr;gap:8px;padding:10px 12px}
.rt-sess,.rt-cred,.rt-rep,.rt-kb{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);
  box-shadow:0 1px 2px rgba(0,0,0,.035);transition:border-color .12s,box-shadow .12s}
.rt-sess:hover,.rt-cred:hover,.rt-rep:hover,.rt-kb:hover{border-color:rgba(77,107,254,.38);box-shadow:0 2px 8px rgba(37,99,235,.08)}
.rt-sess{padding:10px 11px}
.rt-sess-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-sess-title{font-weight:600;font-size:12.5px;font-family:ui-monospace,Menlo,monospace;word-break:break-all}
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
.rt-sidehead{padding:7px 8px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:5px}
.rt-sidehead-btn{cursor:pointer;outline:none;padding:6px 6px 5px;border-radius:5px;user-select:none}
.rt-sidehead-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.rt-sidehead-btn:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-scope{display:inline-block;padding:0 4px;border-radius:3px;font-size:10px;font-weight:700;line-height:15px;flex:none}
.rt-scope-internal{color:var(--wb-blue-ink,#1e40af);background:var(--wb-blue-pill,#dbeafe)}
.rt-scope-external{color:#0ea5e9;background:rgba(14,165,233,.14)}
.rt-scope-testing{color:#6366f1;background:rgba(99,102,241,.14)}
.rt-hits{display:flex;flex-direction:column;gap:6px;margin-top:7px}
.rt-hit-idx{width:16px;height:16px;border-radius:50%;background:#4d6bfe;color:#fff;font-size:10.5px;font-weight:700;
  display:inline-flex;align-items:center;justify-content:center;flex:none}
.rt-hit-time{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-cred{border-left:3px solid #0ea5e9;padding:7px 9px;margin-bottom:7px}
.rt-cred-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-cred-host{font-family:ui-monospace,Menlo,monospace;font-weight:600;font-size:12.5px;word-break:break-all}
.rt-secret{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;background:color-mix(in srgb,var(--wb-blue,#4d6bfe) 10%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);
  border:1px solid #4d6bfe55;border-radius:5px;padding:6px 9px;margin-top:6px;white-space:pre-wrap;word-break:break-all;user-select:all;cursor:text}
.rt-secret-none{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--dsw-alias-state-error-primary);
  border:1px dashed var(--dsw-alias-state-error-primary);border-radius:5px;padding:5px 9px;margin-top:6px}
.rt-cred-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:5px;word-break:break-word}
.rt-live-dot{width:8px;height:8px;border-radius:50%;background:#4d6bfe;flex:none;animation:rt-pulse 1.6s ease-in-out infinite}
.rt-live-dot.idle{background:#94a3b8;animation:none}
.rt-atest{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:6px;
  padding:7px 10px;background:var(--dsw-alias-bg-layer-2);margin-bottom:6px}
.rt-atest.past{border-left-color:#94a3b8;opacity:.85}
.rt-atest-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-atest-ip{font-family:ui-monospace,Menlo,monospace;font-weight:600;font-size:12.5px;word-break:break-all}
.rt-atest-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:3px;word-break:break-word}
.rt-atest-notes{font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;
  word-break:break-word;background:var(--dsw-alias-bg-base);border-radius:4px;padding:5px 7px;margin-top:4px;max-height:76px;overflow:auto}
.rt-concl{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 70%,transparent);flex-wrap:wrap}
.rt-concl-i{display:inline-flex;align-items:baseline;gap:4px;padding:2px 9px;border-radius:999px;cursor:pointer;
  border:1px solid transparent;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 58%,transparent);transition:background .12s,border-color .12s}
.rt-concl-i:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.rt-concl-i.on{border-color:#4d6bfe;background:rgba(77,107,254,.11)}
.rt-concl-i b{font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:700}
.rt-concl-i>span{color:var(--dsw-alias-label-secondary);font-size:11.5px}
.rt-more{color:var(--wb-blue,var(--dsw-alias-brand-primary));font-size:11.5px;cursor:pointer;user-select:none;margin-top:4px;display:inline-block}
.rt-more:hover{text-decoration:underline}

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
.rt-sec-body>.rt-atest:last-child{margin-bottom:2px}

.rt-clip{margin-top:6px}
.rt-clip-head{display:flex;align-items:center;gap:6px}
.rt-clip-label{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:600}
.rt-clip-body{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;line-height:1.65;white-space:pre-wrap;
  word-break:break-word;background:var(--dsw-alias-bg-base);border-radius:5px;padding:6px 8px;margin-top:3px}
.rt-clip:not(.open) .rt-clip-body{max-height:46px;overflow:hidden;
  -webkit-mask-image:linear-gradient(180deg,#000 55%,transparent);mask-image:linear-gradient(180deg,#000 55%,transparent)}
.rt-clip.open .rt-clip-body{max-height:340px;overflow:auto}
.rt-flow-pts{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;font-weight:700;color:#1e40af;
  background:#dbeafe;border:1px solid #4d6bfe55;border-radius:10px;padding:0 8px;white-space:nowrap}
.rt-rep-list{padding:10px 12px 14px}
.rt-rep-tools{display:flex;gap:6px;justify-content:flex-end;margin-bottom:8px}
.rt-rep{border-left:3px solid #4d6bfe;padding:9px 11px;margin-bottom:10px}
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
.rt-rep-trace{margin-top:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px 10px;background:var(--dsw-alias-bg-base)}
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
.rt-rep-step-cmd .rt-mono{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:2px 6px;word-break:break-all}
.rt-rep-step-result{font-size:11.5px;margin-top:3px;word-break:break-word}
.rt-rep-src{margin-top:6px;padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l1)}
.rt-rep-src-title{font-weight:600;font-size:12px;margin-bottom:3px}
.rt-ap-cum{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-ap-sub{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:6px 0 3px}
.rt-hit-row{display:flex;flex-wrap:wrap;align-items:center;gap:2px 7px;font-size:11.5px;padding:4px 7px;border-radius:5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);margin-bottom:3px}
.rt-hit-asset{font-family:ui-monospace,Menlo,monospace;font-weight:600;flex:0 1 auto;max-width:100%;overflow-wrap:anywhere;word-break:break-word}
.rt-hit-txt{flex:1 1 100%;color:var(--dsw-alias-label-primary);line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
.rt-hit-txt.none{color:var(--dsw-alias-state-error-primary)}
.rt-hit-row .rt-hit-time{flex:none;margin-left:auto}
.rt-hit-row.self-created{opacity:.72;border-left:3px solid #ef444488}
.rt-hit-row.service-capped{opacity:.72;border-left:3px solid #f59e0b88}
.rt-hit-row.service-capped .rt-hit-idx{background:#f59e0b}
.rt-rep-group{margin-bottom:14px}
.rt-rep-stage{display:flex;align-items:center;gap:8px;padding:7px 10px;margin-bottom:7px;
  background:var(--dsw-alias-bg-layer-2);border-left:4px solid #64748b;border-radius:6px;cursor:pointer;outline:none;user-select:none}
.rt-rep-stage:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-rep-stage:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-rep-no{width:20px;height:20px;border-radius:5px;color:#fff;font-size:11px;font-weight:700;flex:none;
  display:inline-flex;align-items:center;justify-content:center}
.rt-rep-stage-name{font-weight:700;font-size:13px}
.rt-rep-stage-n{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-rep-pts{font-size:11px;font-weight:600;padding:1px 6px;border-radius:5px;border:1px solid transparent;flex:none}
.rt-rep-body{padding-left:6px}

.rt-kb-filter{display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-kb-cats{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-kb-cat{display:flex;align-items:center;gap:7px;padding:7px 10px;background:var(--dsw-alias-bg-layer-2);
  border-bottom:1px solid var(--dsw-alias-border-l1);position:sticky;top:0;z-index:1}
.rt-kb-cat-name{font-weight:600;font-size:12.5px}
.rt-avail{display:inline-block;padding:0 5px;border-radius:999px;font-size:10.5px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.rt-avail-available{color:#4d6bfe;border-color:#4d6bfe55;background:#4d6bfe1a}
.rt-avail-broken{color:#ef4444;border-color:#ef444455;background:#ef44441a}
.rt-avail-unknown{color:#94a3b8;border-color:#94a3b855;background:#94a3b81a}
.rt-kb-check{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer}
.rt-kb{margin:0 0 8px;overflow:hidden}
.rt-kb.open{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-kb-head{display:flex;align-items:center;gap:7px;padding:8px 10px;cursor:pointer;outline:none;flex-wrap:wrap}
.rt-kb-head:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-kb-head:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-kb-title{font-weight:600;font-size:12.5px;overflow-wrap:anywhere}
.rt-kb-kind{font-size:10px;font-weight:700;letter-spacing:.4px;padding:1px 5px;border-radius:4px;
  color:#fff;background:#64748b;flex:none}
.rt-kb-kind.k-exp{background:#2563eb}.rt-kb-kind.k-poc{background:#4d6bfe}.rt-kb-kind.k-template{background:#6366f1}
.rt-kb-kind.k-script{background:#0ea5e9}.rt-kb-kind.k-payload{background:#0284c7}
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

.rt-markdown{flex:1;overflow:auto;padding:12px 14px;font-size:12.5px;line-height:1.7;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);word-break:break-word}
.rt-markdown>:first-child{margin-top:0}
.rt-markdown>:last-child{margin-bottom:0}
.rt-markdown h1,.rt-markdown h2,.rt-markdown h3,.rt-markdown h4,.rt-markdown h5,.rt-markdown h6{margin:12px 0 6px;font-weight:600;line-height:1.35}
.rt-markdown h1{font-size:16px}.rt-markdown h2{font-size:14px}.rt-markdown h3{font-size:13px}.rt-markdown h4,.rt-markdown h5,.rt-markdown h6{font-size:12.5px}
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
.rt-markdown th,.rt-markdown td{border:1px solid var(--dsw-alias-border-l1);padding:4px 7px;text-align:left;vertical-align:top;word-break:break-word;overflow-wrap:anywhere}
.rt-markdown th{background:var(--dsw-alias-bg-layer-1);font-weight:600}
.rt-markdown blockquote{margin:0 0 9px;padding:4px 10px;border-left:3px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.rt-markdown hr{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:10px 0}
.rt-markdown strong{font-weight:600}

.rt-shots{margin:8px 0 4px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1)}
.rt-shots-head{display:flex;align-items:baseline;gap:8px;font-size:11.5px;margin-bottom:6px}
.rt-shots-n{color:var(--dsw-alias-label-secondary)}
.rt-shot-row{display:flex;gap:8px;flex-wrap:wrap}
.rt-shot{display:flex;flex-direction:column;gap:3px;max-width:220px}
.rt-shot-thumb{border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:#0b1020;object-fit:contain;display:block;width:auto;max-width:216px}
.rt-shot-loading{display:flex;align-items:center;justify-content:center;width:150px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-shot-cap{display:flex;align-items:center;gap:5px;font-size:10.5px;overflow-wrap:anywhere}
.rt-shot-label{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}
.rt-shot-zoom{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.82);display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:10px;cursor:zoom-out;padding:18px}
.rt-shot-zoom img{max-width:96vw;max-height:86vh;border-radius:6px;box-shadow:0 18px 48px rgba(0,0,0,.5)}
.rt-shot-zoom-cap{color:#e5e7eb;font-size:12px;text-align:center;max-width:90vw;overflow-wrap:anywhere}

.rt-skill-row{display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer;min-width:0}
.rt-skill-row:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-skill-row.on{background:var(--dsw-alias-bg-layer-2);border-left:2px solid var(--dsw-alias-brand-primary)}
.rt-skill-row.broken{background:rgba(245,158,11,.06)}
.rt-skill-main{flex:1;min-width:0}
.rt-skill-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-skill-desc{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-concl-group{font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-secondary);border-left:2px solid rgba(77,107,254,.4);padding-left:7px;margin:0 2px}
.rt-concl-extra{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-concl-extra summary{cursor:pointer;white-space:nowrap}

.rt-rep-full[open]::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:9997}
.rt-rep-full[open]>.rt-rep-full-body{position:fixed;inset:3vh 3vw;z-index:9998;background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px 16px;overflow:auto;
  box-shadow:0 24px 64px rgba(0,0,0,.4);max-width:none}
.rt-rep-full[open]>.rt-rep-full-body .rt-markdown{max-height:none}
.rt-rep-full-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}

.rt-ov{padding:0;min-height:0}
.rt-ov-scroll{overflow:auto;padding:14px 18px 20px;flex:1;min-height:0}

.rt-wb-badge{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:600;
  color:var(--wb-blue,#4d6bfe);background:rgba(77,107,254,.1);border:1px solid rgba(77,107,254,.28)}

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

.rt-bento-stack{display:flex;flex-direction:column;gap:12px;margin-bottom:12px}
.rt-bento-row-canvas{display:grid;grid-template-columns:1fr;gap:12px}
.rt-analytics-trio{display:grid}
@media(min-width:1180px){.rt-full .rt-bento-row-canvas{grid-template-columns:1fr}}
.rt-bento-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 1px 6px -2px rgba(15,23,42,.05);min-width:0;display:flex;flex-direction:column;gap:8px}
.rt-bento-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rt-bento-title{font-size:13.5px;font-weight:700;letter-spacing:-.01em;display:flex;align-items:center;gap:6px}

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

.rt-p3-ctrl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.rt-p3-stepper{display:inline-flex;align-items:center;gap:4px}
.rt-p3-step-btn{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;cursor:pointer;padding:0;line-height:1}
.rt-p3-step-btn:hover:not(:disabled){border-color:var(--wb-blue,#4d6bfe);color:var(--wb-blue-ink,#1e40af)}
.rt-p3-step-btn:disabled{opacity:.45;cursor:default}
.rt-p3-step-val{font-size:11.5px;font-weight:600;min-width:34px;text-align:center;font-family:ui-monospace,Menlo,monospace}
.rt-p3-pills{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
.rt-filter-pill,
.rt-p3-pill{
  display:inline-flex;
  align-items:center;
  gap:4px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-secondary);
  border-radius:999px;
  padding:2px 8px;
  font-size:11px;
  line-height:1.35;
  font-weight:500;
  cursor:pointer;
  font-family:inherit;
  transition:border-color .14s ease,background .14s ease,color .14s ease;
}
.rt-filter-pill:hover,
.rt-p3-pill:hover{
  border-color:var(--dsw-alias-border-l2,#94a3b8);
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);
}
.rt-filter-pill.on,
.rt-p3-pill.on{
  background:var(--wb-blue-soft,rgba(77,107,254,.12));
  border-color:color-mix(in srgb,var(--wb-blue,#4d6bfe) 45%,transparent);
  color:var(--wb-blue-ink,#1e40af);
  font-weight:600;
}
body[data-ds-dark-theme] .rt-filter-pill.on,
body[data-ds-dark-theme] .rt-p3-pill.on{
  color:#93c5fd;
  background:rgba(91,120,255,.22);
  border-color:rgba(96,165,250,.46);
}

.rt-wb-role-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:8px}
@media(min-width:1180px){.rt-full .rt-wb-role-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.rt-wb-role-card{border:1px solid var(--dsw-alias-border-l1);border-top:3px solid #4d6bfe;border-radius:10px;padding:10px 12px;
  background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px;min-width:0;cursor:pointer;transition:border-color .14s,box-shadow .14s,transform .12s}
.rt-wb-role-card:hover{border-color:#4d6bfe;box-shadow:0 4px 12px rgba(77,107,254,.12);transform:translateY(-1px)}
.rt-wb-role-card.on{border-color:#4d6bfe;background:rgba(77,107,254,.07);box-shadow:0 0 0 1px rgba(77,107,254,.28)}
.rt-wb-role-badge{font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:700;color:var(--wb-blue-ink,#2563eb);background:rgba(77,107,254,.12);border:1px solid rgba(77,107,254,.28);border-radius:999px;padding:1px 7px;white-space:nowrap}
.rt-wb-role-desc{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rt-wb-skill-tag{font-family:ui-monospace,Menlo,monospace;font-size:10px;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--wb-blue-ink,#2563eb);white-space:nowrap}
.rt-wb-recurse-tag{font-size:9.5px;padding:1px 6px;border-radius:99px;background:rgba(99,102,241,.12);color:#4f46e5;border:1px solid rgba(99,102,241,.28);font-weight:600;white-space:nowrap}

body[data-ds-dark-theme] .rt-bento-card,
body[data-ds-dark-theme] .rt-wb-role-card{
  background:var(--dsw-alias-bg-layer-1);
  border-color:var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
}
body[data-ds-dark-theme] .rt-gain{
  background:rgba(77,107,254,.16);
  color:#93c5fd;
  border-color:rgba(77,107,254,.35);
}
@media(max-width:640px){.rt-wb-role-grid{grid-template-columns:1fr}.rt-doc-wall{grid-template-columns:1fr}}

.rt-settings-shell{
  display:flex;
  flex-direction:column;
  gap:12px;
  width:100%;
  max-width:960px;
  margin:0 auto;
  padding:10px 12px 18px;
  box-sizing:border-box;
  min-width:0;
}
.rt-dock .rt-settings-shell{
  max-width:100%;
  padding:8px 10px 16px;
  gap:10px;
}
.rt-full .rt-settings-shell{
  padding:16px 22px 26px;
  gap:16px;
}
.rt-settings-section{
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:12px 14px;
  border-radius:12px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);
  box-shadow:0 1px 4px rgba(15,23,42,.04);
  box-sizing:border-box;
  min-width:0;
}
.rt-full .rt-settings-section{
  padding:14px 18px;
  gap:12px;
}
body[data-ds-dark-theme] .rt-settings-section{
  background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-border-l1,rgba(148,163,184,.2));
  box-shadow:0 4px 12px rgba(0,0,0,.22);
}
.rt-settings-section-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  flex-wrap:wrap;
  padding-bottom:8px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
}
.rt-settings-section-title{
  margin:0;
  font-size:13.5px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
  display:inline-flex;
  align-items:center;
  gap:6px;
}
.rt-settings-badge{
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:2px 8px;
  border-radius:999px;
  font-size:11px;
  font-weight:600;
  line-height:1.35;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap;
}
.rt-settings-badge.is-ok{
  color:#059669;
  background:rgba(16,185,129,.12);
  border-color:rgba(16,185,129,.3);
}
.rt-settings-badge.is-warn{
  color:#b45309;
  background:rgba(245,158,11,.12);
  border-color:rgba(245,158,11,.32);
}
body[data-ds-dark-theme] .rt-settings-badge.is-ok{
  color:#34d399;
  background:rgba(16,185,129,.2);
  border-color:rgba(52,211,153,.36);
}
body[data-ds-dark-theme] .rt-settings-badge.is-warn{
  color:#fbbf24;
  background:rgba(245,158,11,.2);
  border-color:rgba(251,191,36,.38);
}
.rt-settings-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
  gap:10px 12px;
  align-items:start;
  width:100%;
  min-width:0;
  box-sizing:border-box;
}
.rt-dock .rt-settings-grid{
  grid-template-columns:1fr;
  gap:10px;
}
.rt-full .rt-settings-grid{
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px 16px;
}
@media(max-width:720px){
  .rt-settings-grid,
  .rt-full .rt-settings-grid{
    grid-template-columns:1fr;
  }
}
.rt-settings-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px 12px;
  flex-wrap:wrap;
  padding:8px 0;
  border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 68%,transparent);
  min-width:0;
  box-sizing:border-box;
}
.rt-settings-row:first-child{
  padding-top:0;
}
.rt-settings-row:last-child{
  border-bottom:0;
  padding-bottom:0;
}
.rt-settings-row.is-full,
.rt-settings-field.is-full{
  grid-column:1 / -1;
}
.rt-settings-field{
  display:flex;
  flex-direction:column;
  gap:5px;
  min-width:0;
  flex:1 1 200px;
  box-sizing:border-box;
}
.rt-settings-field > label,
.rt-settings-label{
  font-size:12px;
  font-weight:600;
  color:var(--dsw-alias-label-primary);
  line-height:1.4;
}
.rt-settings-field input,
.rt-settings-field select,
.rt-settings-field textarea{
  width:100%;
  min-width:0;
  box-sizing:border-box;
}
.rt-settings-hint{
  font-size:11.5px;
  line-height:1.5;
  color:var(--dsw-alias-label-secondary);
  margin:0;
  overflow-wrap:anywhere;
}
.rt-settings-actions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:8px;
  flex-wrap:wrap;
  margin-top:4px;
  min-width:0;
}
.rt-settings-row > .rt-settings-actions{
  margin-top:0;
  flex:none;
}

@keyframes rt-pulse{
  0%,100%{opacity:1;box-shadow:0 0 0 0 #4d6bfe66}
  50%{opacity:.5;box-shadow:0 0 0 5px #4d6bfe00}
}
@keyframes rt-p5-pulse{
  0%,100%{opacity:1;transform:scale(1)}
  50%{opacity:.45;transform:scale(.92)}
}
@keyframes rt-wire-grow{
  from{stroke-dashoffset:240;opacity:0.25}
  to{stroke-dashoffset:0;opacity:1}
}
@keyframes rt-subnode-spawn{
  0%{opacity:0;transform:translateY(-14px) scale(0.84);filter:blur(3px)}
  65%{opacity:1;transform:translateY(2px) scale(1.02);filter:blur(0)}
  100%{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}
}
@keyframes rt-sonar-ripple{to{opacity:0}}
@keyframes rt-dash-flow{
  to{stroke-dashoffset:-24}
}
@keyframes rt-hub-absorb{
  0%{transform:scale(1)}
  50%{transform:scale(1.03);box-shadow:0 0 0 6px rgba(16,185,129,0.22)}
  100%{transform:scale(1)}
}
@keyframes rt-complete-sheen{
  0%{background-position:-200% 0}
  100%{background-position:200% 0}
}
@keyframes rt-check-stroke{to{stroke-dashoffset:0}}

.rt-p5-spin{
  display:inline-block;
  animation:rt-p5-pulse 1.4s ease-in-out infinite;
}
.rt-anim-spawn{
  animation:rt-subnode-spawn 0.38s cubic-bezier(0.34,1.56,0.64,1) both;
}
.rt-anim-complete{
  background-image:linear-gradient(110deg,transparent 35%,rgba(16,185,129,0.16) 50%,transparent 65%);
  background-size:200% 100%;
  animation:rt-complete-sheen 1.2s ease-out 1;
}
body[data-ds-dark-theme] .rt-anim-complete{
  background-image:linear-gradient(110deg,transparent 35%,rgba(52,211,153,0.22) 50%,transparent 65%);
}
.rt-anim-hub-absorb{
  animation:rt-hub-absorb 0.52s cubic-bezier(0.34,1.56,0.64,1) 1;
}
.rt-wire-flowing{
  stroke-dasharray:6 6;
  animation:rt-dash-flow 0.9s linear infinite;
}
.rt-wire-growing{
  stroke-dasharray:240;
  animation:rt-wire-grow 0.45s cubic-bezier(0.22,1,0.36,1) forwards;
}

@media (prefers-reduced-motion: reduce){
  .rt-live-dot,
  .rt-p5-spin,
  .rt-anim-spawn,
  .rt-anim-complete,
  .rt-anim-hub-absorb,
  .rt-wire-flowing,
  .rt-wire-growing,
  .rt-agent-inspector-drawer{
    animation:none !important;
  }
  .rt-dock,
  .rt-panzoom-stage.smooth-zoom,
  .rt-p4-node-card,
  .rt-tree-wave-card{
    transition:none !important;
  }
}
`
