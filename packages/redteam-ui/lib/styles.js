/**
 * RedTeam 控制台样式表（唯一维护点）。
 *
 * 为什么单独一个文件：原来这 500 多行 CSS 以一个巨型模板串塞在 client.js 里，
 * 夹在组件代码中间，编辑器不高亮、改样式要在 3600 行里翻。
 *
 * ⚠️ 浏览器半侧是手写 bundle，运行期**不能** import 这个文件：模块身份靠
 * `window.__ModuleLoader__.load({ id, factory })`，基座外只能 require react。
 * 所以 client.js 里留了一行占位 `const CSS = '__RT_STYLES__'`，
 * 由 `packages/redteam-bundle/tools/build.mjs` 在生成 lib/client.js 时
 * 把占位符替换成这里的正文 —— 源码可读，产物仍是单文件自包含。
 *
 * 改样式只改这里，然后跑：node packages/redteam-bundle/tools/build.mjs
 */
export const CSS = String.raw`
:root{--rt-dock-w:540px;--wb-blue:#4d6bfe;--wb-blue-deep:#2563eb;--wb-blue-cyan:#0ea5e9;--wb-blue-soft:rgba(77,107,254,.12);--wb-blue-ring:rgba(77,107,254,.32);--wb-blue-ink:#1e40af;--wb-blue-pill:#dbeafe}
body[data-ds-dark-theme]{--wb-blue:#5b78ff;--wb-blue-deep:#3b82f6;--wb-blue-cyan:#38bdf8;--wb-blue-soft:rgba(91,120,255,.16);--wb-blue-ring:rgba(91,120,255,.38);--wb-blue-ink:#93c5fd;--wb-blue-pill:rgba(77,107,254,.2)}
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
.rt-seg{padding:7px 8px;border-radius:6px;cursor:pointer;margin-bottom:4px;border:1px solid transparent}
.rt-seg:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-seg.on{background:var(--dsw-alias-bg-layer-2);border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-seg-cidr{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
.rt-seg-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.rt-toolbar{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap;align-items:center}
.rt-input{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:inherit;
  border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;outline:none;min-width:0}
.rt-input:focus{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
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
/* 纪律提示条：不满足交付要求（非冰蝎/哥斯拉马、没有 suo5 隧道）时顶在区块最上方 */
.rt-hint{border-radius:6px;padding:7px 9px;margin-bottom:8px;font-size:11.5px;line-height:1.6;
  border:1px dashed #ef444488;background:#ef44440f;color:var(--dsw-alias-label-primary)}
.rt-hint b{color:#ef4444}
.rt-tag-dead{color:var(--dsw-alias-label-secondary)}
.rt-expand{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-kv{display:flex;gap:8px;margin-bottom:3px;align-items:baseline}
.rt-kv b{color:var(--dsw-alias-label-primary);font-weight:600;min-width:64px;flex:none}
/* 图谱视图已移除（见 AssetsTab：资产关系由「域名维度」与 redteam_attack_path 工具承担） */
.rt-pane{flex:1;overflow:auto;padding:12px}
.rt-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-2)}
.rt-card h4{margin:0 0 6px;font-size:13px}
.rt-textarea{width:100%;min-height:260px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);
  color:inherit;border-radius:6px;padding:8px;font-size:12.5px;font-family:ui-monospace,Menlo,monospace;
  line-height:1.6;resize:vertical;outline:none;box-sizing:border-box}
.rt-textarea:focus{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-list{width:210px;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:8px}
.rt-item{padding:7px 8px;border-radius:6px;cursor:pointer;margin-bottom:4px;border:1px solid transparent}
.rt-item:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-item.on{background:var(--dsw-alias-bg-layer-2);border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-item-name{font-weight:600;font-size:12.5px}
.rt-item-desc{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
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
@keyframes rt-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 #4d6bfe66}50%{opacity:.5;box-shadow:0 0 0 5px #4d6bfe00}}
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
.rt-subtabs{display:flex;gap:4px;padding:6px 10px 0;border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center}
.rt-subtab{padding:4px 10px;border-radius:6px 6px 0 0;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-subtab.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font-weight:600}
.rt-sevbar{width:3px;border-radius:2px;align-self:stretch;flex:none;margin-right:2px}
/* ── 折叠层次体系 ─────────────────────────────────────────────────────────────
   L1 折叠头 .rt-sec   ：通栏、无圆角无边框、左色条、深底 —— 永远是"扁"的
   L2 内容卡 .rt-atest/.rt-hit/.rt-cred/.rt-evi：内缩、有边框、圆角 —— 立起来
   L3 详情/长文本 .rt-clip-body / .rt-evi-body ：无边框、最浅、等宽
   L4 子项容器 .rt-sec-body：左缩进 + 竖引导线，表明"属于上面那个头"
   ──────────────────────────────────────────────────────────────────────────── */
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
/* ── 全链路攻击路径图 ─────────────────────────────────────────────── */
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
/* 按服务封顶/自建而不计分的命中：分值标灰（+0），避免看着像又加了分 */
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
/* 资产与内容都自适应换行：长域名/长口令/长结果一律换行显示，不截断成省略号 */
.rt-hit-asset{font-family:ui-monospace,Menlo,monospace;font-weight:600;flex:0 1 auto;max-width:100%;
  overflow-wrap:anywhere;word-break:break-word}
.rt-hit-txt{flex:1 1 100%;color:var(--dsw-alias-label-primary);line-height:1.55;
  white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
.rt-hit-txt.none{color:var(--dsw-alias-state-error-primary)}
.rt-hit-row .rt-hit-time{flex:none;margin-left:auto}
/* 自己注册/自建的账号：留痕但不计分，整行压暗 */
.rt-hit-row.self-created{opacity:.72;border-left:3px solid #ef444488}
/* 同一资产同一端口的重复账号/库权限：服务已拿满，不计分（只作留痕） */
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
/* 折叠后仍要能一眼看到"这一阶段拿了多少分"，所以分数留在头上 */
.rt-rep-pts{font-size:11px;font-weight:600;padding:1px 6px;border-radius:5px;border:1px solid transparent;flex:none}
.rt-rep-body{padding-left:6px}
/* ── 知识库（POC/EXP） ──────────────────────────────────────────── */
.rt-kb-filter{display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
/* 知识库归类总览：一行标签，点一下按该类筛选 */
.rt-kb-cats{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
/* 知识库分组标题（按归类分组时每组一条） */
.rt-kb-cat{display:flex;align-items:center;gap:7px;padding:7px 10px;background:var(--dsw-alias-bg-layer-2);
  border-bottom:1px solid var(--dsw-alias-border-l1);position:sticky;top:0;z-index:1}
.rt-kb-cat-name{font-weight:600;font-size:12.5px}
/* 技能可用性徽章（技能库页签） */
.rt-avail{display:inline-block;padding:0 5px;border-radius:4px;font-size:10.5px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.rt-avail-available{color:#4d6bfe;border-color:#4d6bfe55;background:#4d6bfe1a}
.rt-avail-broken{color:#ef4444;border-color:#ef444455;background:#ef44441a}
.rt-avail-unknown{color:#94a3b8;border-color:#94a3b855;background:#94a3b81a}
/* 版本 / 更新弹窗 */
.rt-modal{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.rt-modal-box{width:min(560px,92vw);max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px;font-size:12.5px;line-height:1.7;
  box-shadow:0 18px 48px rgba(0,0,0,.35);color:var(--dsw-alias-label-primary)}
.rt-modal-box .rt-kv b{min-width:76px}
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
/* 本机 nuclei 模板命中：路径要能完整看到（复制成命令直接跑） */
.rt-kb-tpl{margin-top:12px;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:8px}
.rt-kb-tpl-row{display:flex;align-items:center;gap:7px;font-size:11.5px;padding:3px 7px;border-radius:5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);margin-bottom:3px}
.rt-kb-tpl-path{flex:0 1 auto;font-weight:600;overflow-wrap:anywhere}
.rt-kb-tpl-name{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.rt-md{flex:1;overflow:auto;margin:0;padding:14px 16px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;
  line-height:1.65;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-base)}
/* ── Markdown 渲染视图：技能正文 / .md 攻击文件 / 行内强调 ─────────────────────
   面板里的提示、技能文档、模型回报本身就是 Markdown；之前当纯文本渲染会把
   星号粗体、反引号代码、井号标题直接露出来。.rt-markdown 是块级视图，
   .rt-inline-code 是行内代码。 */
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
.rt-weblink{display:block;font-size:11.5px;margin-top:1px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rt-weblink{display:block;font-size:11.5px;margin-top:1px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* ── 证据截图：得分点里最多 3 张代表图，点开全屏 ─────────────────────────── */
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
/* 技能库紧凑行：状态 / 名称+一句话 / 来源 */
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


/* 报告四段式全文：展开即全屏预览，不再挤在侧栏里 */
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

/* ══════════════════════════════════════════════════════════════════
   WorkBuddy × DSH Brand Blue 统一视觉层（#4D6BFE / #2563EB）
   ══════════════════════════════════════════════════════════════════ */
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

/* 卡片 / 分栏（WorkBuddy Bento Card） */
.rt-card{
  border-radius:12px;padding:12px 14px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-layer-1) 95%,transparent),var(--dsw-alias-bg-layer-1));
  box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px -18px rgba(37,99,235,.18);
}
.rt-card h4{font-size:12.5px;letter-spacing:-.005em}
.rt-side,.rt-list{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 32%,transparent);padding:10px}
.rt-seg,.rt-item{border-radius:8px;transition:background .12s,border-color .12s,box-shadow .12s}
.rt-seg:hover,.rt-item:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 85%,transparent)}
.rt-seg.on,.rt-item.on{
  background:rgba(77,107,254,.1);
  border-color:rgba(77,107,254,.45);
}

/* 表格 / 列表行 */
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
.rt-subtabs{padding:8px 12px 0;gap:4px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
.rt-subtab{border-radius:7px 7px 0 0;padding:5px 10px;transition:background .12s,color .12s}
.rt-subtab:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}
.rt-subtab.on{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 -2px 0 #4d6bfe}

/* 徽章 / 状态 */
.rt-tag{border-radius:999px;padding:1px 7px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);font-weight:500}
.rt-sev{border-radius:5px;padding:1px 7px;letter-spacing:.01em}
.rt-test,.rt-pri,.rt-avail{border-radius:999px}

/* 空态 / 提示 */
.rt-empty{
  margin:18px auto;max-width:440px;padding:26px 18px;
  border:1px dashed color-mix(in srgb,var(--dsw-alias-border-l2) 75%,transparent);
  border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 35%,transparent);
}
.rt-hint{border-radius:9px;border-style:solid;border-width:1px}

/* 业务卡片 */
.rt-sess,.rt-cred,.rt-rep,.rt-kb{border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.035);transition:border-color .12s,box-shadow .12s}
.rt-sess:hover,.rt-cred:hover,.rt-rep:hover,.rt-kb:hover{border-color:rgba(77,107,254,.38);box-shadow:0 2px 8px rgba(37,99,235,.08)}
.rt-kb-head{padding:8px 10px}
.rt-sess{padding:10px 11px}
.rt-cred{padding:7px 9px}

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
   p4 Modular Bento UI + p2 Theme-Adaptive PG Write Probe + p3 Concurrency + LMTAgent
   ══════════════════════════════════════════════════════════════════ */
/* Dock 侧边栏（默认 540px）中采用宽敞单列流式布局，仅在全面浏览（.rt-full）大屏下并排分栏 */
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

/* LMTAgent Mode Bar, Real-Time Role Decision Cards, Visual DAG Canvas, Doc Wall & Feishu Push */
.rt-harness-modebar{display:inline-flex;align-items:center;gap:4px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.rt-harness-modebtn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;padding:4px 9px;border-radius:6px;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .14s,color .14s}
.rt-harness-modebtn:hover{color:var(--dsw-alias-label-primary)}
.rt-harness-modebtn.on{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;box-shadow:0 1px 4px rgba(77,107,254,.3)}
.rt-standby-card{border:1px dashed var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));border-radius:12px;padding:18px 20px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);display:flex;flex-direction:column;gap:8px}
.rt-standby-title{font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:8px}
.rt-standby-desc{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.rt-role-decision-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.rt-role-decision-card{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:10px;padding:11px 13px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px;min-width:0}
.rt-dag-canvas{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);
  background:radial-gradient(circle at 12px 12px,rgba(77,107,254,.12) 1px,transparent 1px),var(--dsw-alias-bg-base);background-size:16px 16px}
.rt-dag-wave-row{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap}
.rt-dag-wave-label{width:84px;flex:none;display:flex;flex-direction:column;justify-content:center;padding:6px 8px;border-radius:8px;
  background:rgba(77,107,254,.08);border-left:3px solid #4d6bfe;font-size:10.5px;font-weight:700;color:var(--wb-blue-ink,#2563eb)}
.rt-dag-nodes{flex:1;min-width:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:8px}
.rt-dag-node{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:9px;padding:8px 10px;
  background:var(--dsw-alias-bg-layer-1);cursor:pointer;display:flex;flex-direction:column;gap:3px;transition:border-color .14s,box-shadow .14s,transform .12s;min-width:0}
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

/* Doc Wall */
.rt-doc-wall{display:grid;grid-template-columns:185px minmax(0,1fr);gap:10px;min-height:240px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base)}
.rt-doc-strip{border-right:1px solid var(--dsw-alias-border-l1);padding:8px;display:flex;flex-direction:column;gap:4px;background:var(--dsw-alias-bg-layer-2);overflow:auto}
.rt-doc-item{padding:7px 9px;border-radius:7px;cursor:pointer;border:1px solid transparent;display:flex;flex-direction:column;gap:2px}
.rt-doc-item:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-doc-item.on{background:rgba(77,107,254,.12);border-color:rgba(77,107,254,.45)}
.rt-doc-item-title{font-size:11.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-doc-item-sub{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-doc-preview{padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0;overflow:auto;max-height:320px}

/* Feishu Push Panel */
.rt-feishu-panel{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;gap:8px}
.rt-feishu-checks{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px}

/* p2 Real-Time PG Write Probe — 100% Theme-Adaptive (No light/dark mismatch) */
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

/* Dark theme cohesive overrides for all cards, probes, and badges */
body[data-ds-dark-theme] .rt-wb-wave,
body[data-ds-dark-theme] .rt-wb-slot,
body[data-ds-dark-theme] .rt-bento-card,
body[data-ds-dark-theme] .rt-dag-node,
body[data-ds-dark-theme] .rt-wb-role-card,
body[data-ds-dark-theme] .rt-role-decision-card,
body[data-ds-dark-theme] .rt-pg-probe{
  background:var(--dsw-alias-bg-layer-1);
  border-color:var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
}
body[data-ds-dark-theme] .rt-pg-stat,
body[data-ds-dark-theme] .rt-pg-tbl,
body[data-ds-dark-theme] .rt-pg-log,
body[data-ds-dark-theme] .rt-standby-card{
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

/* Composer Dock Bar */
.rt-composer-dock{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11.5px;margin:2px 0}
@media(max-width:640px){.rt-wb-role-grid{grid-template-columns:1fr}.rt-doc-wall{grid-template-columns:1fr}}

/* ══════════════════════════════════════════════════════════════════
   v0.17.0 — p4 Three-Pane Agent Collaboration Workbench + Swimlane + p5 Zoomable Tree Canvas
   ══════════════════════════════════════════════════════════════════ */

/* 1. Full-Width Workbench Outer Card & p4 Inner Split Grid */
.rt-p4-workbench{
  display:flex;
  flex-direction:column;
  gap:14px;
  grid-column:1 / -1;
  width:100%;
  box-sizing:border-box;
  margin:0;
}
.rt-p4-split-grid{
  display:grid;
  grid-template-columns:1fr;
  gap:14px;
  align-items:stretch;
  width:100%;
}
@media(min-width:960px){
  .rt-p4-split-grid{
    grid-template-columns:minmax(380px,0.94fr) minmax(440px,1.06fr);
    gap:16px;
    align-items:start;
  }
}
.rt-p4-right,.rt-p4-right-col{
  display:flex;
  flex-direction:column;
  gap:14px;
  min-width:0;
}

/* Left Pane — Agent 网络 (.rt-net-pane) */
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

/* Top-Right Pane — 跨 Agent 协作 Swimlane Sequence Chart (.rt-swim-pane) */
.rt-swim-pane{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:12px;
  padding:12px 14px;
  background:var(--dsw-alias-bg-layer-1);
  display:flex;
  flex-direction:column;
  gap:8px;
  min-width:0;
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

/* Bottom-Right Pane — 协作任务 Work Items (.rt-collab-pane) */
.rt-collab-pane{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:12px;
  padding:12px 14px;
  background:var(--dsw-alias-bg-layer-1);
  display:flex;
  flex-direction:column;
  gap:8px;
  min-width:0;
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

/* 2. p5 Interactive Zoomable Tree Canvas Styles (.rt-p5-*) */
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
@keyframes rt-p5-pulse{
  0%,100%{opacity:1;transform:scale(1)}
  50%{opacity:.45;transform:scale(.92)}
}
.rt-p5-spin{
  display:inline-block;
  animation:rt-p5-pulse 1.4s ease-in-out infinite;
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
  position:relative;
  display:flex;
  flex-direction:column;
  align-items:center;
}
.rt-p5-branches-grid{
  width:760px;
  max-width:100%;
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
.rt-node-handle-top{
  top:-5px;
}
.rt-node-handle-bottom{
  bottom:-5px;
}
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
.rt-swim-matrix-wrap{
  position:relative;
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px;
  background:var(--dsw-alias-bg-layer-1);
  overflow:hidden;
}

/* 3. Concurrency Slot Matrix & Pattern Drawer Styles */
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
`