#!/usr/bin/env node
/**
 * Generate 4 high-resolution (2x Retina, 2880x1800 physical pixels) authentic plugin UI screenshots
 * for LMTAgent v0.22.0 README showcase using the real CSS exported from
 * packages/redteam-ui/lib/styles.js — ZERO fabricated DSH host chrome (.wb-titlebar / .wb-sidebar / .wb-chat).
 *
 * Output files:
 *   1. docs/assets/ui-overview-workbench.png
 *      - Standalone 6-group top navigation (`协同与审批` first with pending badge)
 *      - Collapsible WishRefinerWizard + Full-width 60FPS Horizontal Workflow Tree + Analytics Trio
 *   2. docs/assets/ui-agents-dag.png
 *      - Real upgraded `集群 -> 智能体与并发` (`p5`) Cluster Workbench:
 *        Compact Adaptive Concurrency & Lease Control Card + Live Horizontal Topology +
 *        Two-Step Node Inspector Drawer + Full-width P0–P3 Swimlanes
 *   3. docs/assets/ui-assets-pg.png
 *      - Architecture & File-Disjoint ShardLock Ownership Matrix + Live Fact Store & Digest Probe
 *   4. docs/assets/ui-report-v2.png
 *      - Closed-Loop Engineering Delivery Report (Doc Wall from worker_digests) + Feishu Webhook Card
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CSS } from '../packages/redteam-ui/lib/styles.js'

const STYLE_TEXT = CSS.replace(/\\n/g, '\n')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'docs', 'assets')
fs.mkdirSync(OUT_DIR, { recursive: true })

function resolveChromiumBin() {
  const candidates = [
    process.env.CHROMIUM_BIN,
    'chromium',
    'chromium-browser',
    'google-chrome',
    'google-chrome-stable',
  ].filter(Boolean)
  for (const bin of candidates) {
    try {
      execFileSync('which', [bin], { stdio: 'ignore' })
      return bin
    } catch {
      /* try next */
    }
  }
  throw new Error('No headless Chromium/Chrome binary found in PATH')
}

const VIEWPORT_ADAPTER_CSS = `
  :root {
    --dsh-frame-chrome-top: 0px;
    --dsw-alias-bg-base: #F8FAFC;
    --dsw-alias-bg-layer-1: #FFFFFF;
    --dsw-alias-bg-layer-2: #F1F5F9;
    --dsw-alias-bg-layer-3: #E2E8F0;
    --dsw-alias-border-l1: #E2E8F0;
    --dsw-alias-border-l2: #CBD5E1;
    --dsw-alias-line-primary: #CBD5E1;
    --dsw-alias-label-primary: #0F172A;
    --dsw-alias-label-secondary: #475569;
    --dsw-alias-label-tertiary: #64748B;
    --dsw-alias-brand-primary: #4D6BFE;
    --dsw-alias-brand-text: #2563EB;
    --dsw-alias-state-error-primary: #DC2626;
  }
  * { box-sizing: border-box; animation: none !important; transition: none !important; }
  html, body {
    margin: 0;
    padding: 0;
    width: 1440px;
    height: 900px;
    overflow: hidden;
    background: #F8FAFC;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  svg.rt-h-wave-branch-line, svg.rt-h-root-fanout-svg {
    background: none !important;
  }
  .rt-embed-root {
    position: relative !important;
    width: 1440px !important;
    height: 900px !important;
    display: flex !important;
    flex-direction: column !important;
    background: var(--dsw-alias-bg-base);
    overflow: hidden !important;
  }
  .rt-body {
    flex: 1;
    min-height: 0;
    overflow: hidden !important;
    display: flex;
    flex-direction: column;
  }
  .shot-canvas-card {
    background: #FFFFFF;
    border: 1px solid #CBD5E1;
    border-radius: 11px;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
  }
  .shot-canvas-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border-bottom: 1px solid #E2E8F0;
    background: #F8FAFC;
    white-space: nowrap;
  }
  .shot-panzoom-stage {
    flex: 1;
    min-height: 0;
    position: relative;
    background-color: #F8FAFC;
    background-image: radial-gradient(#CBD5E1 1px, transparent 1px);
    background-size: 16px 16px;
    display: flex;
    align-items: center;
    padding: 14px 20px;
    overflow: hidden;
  }
  .shot-h-tree {
    display: flex;
    flex-direction: row;
    align-items: center;
    width: 100%;
    gap: 0;
  }
  .shot-root-card {
    width: 220px;
    flex-shrink: 0;
    background: linear-gradient(180deg, #EFF6FF 0%, #FFFFFF 75%);
    border: 2px solid #3B82F6;
    border-radius: 10px;
    padding: 12px 14px;
    position: relative;
    box-shadow: 0 4px 14px rgba(59, 130, 246, 0.14);
  }
  .shot-waves-col {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }
  .shot-wave-lane {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0;
    min-width: 0;
  }
  .shot-wave-hub {
    width: 214px;
    flex-shrink: 0;
    background: #FFFFFF;
    border: 1.5px solid #CBD5E1;
    border-radius: 9px;
    padding: 8px 11px;
    position: relative;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
  }
  .shot-wave-hub.active {
    border-color: #3B82F6;
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.08) 0%, #FFFFFF 80%);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
  }
  .shot-children-row {
    display: flex;
    flex-direction: row;
    gap: 10px;
    flex: 1;
    min-width: 0;
    align-items: stretch;
  }
  .shot-worker-card {
    flex: 1;
    min-width: 0;
    background: #FFFFFF;
    border: 1.5px solid #E2E8F0;
    border-radius: 9px;
    padding: 8px 11px;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.03);
  }
  .shot-worker-card.p0 {
    border-color: rgba(239, 68, 68, 0.55);
    background: linear-gradient(180deg, rgba(254, 242, 242, 0.85) 0%, #FFFFFF 70%);
  }
  .shot-worker-card.selected {
    border-color: #2563EB;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
    background: linear-gradient(180deg, rgba(239, 246, 255, 0.95) 0%, #FFFFFF 75%);
  }
  .shot-trio-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .shot-mini-stat {
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 9px;
    padding: 9px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .shot-inline-input {
    width: 100%;
    border: 1px solid #93C5FD;
    background: #FFFFFF;
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 11px;
    color: #0F172A;
    font-family: inherit;
  }
  .shot-swimlane-row {
    display: grid;
    grid-template-columns: 230px minmax(0, 1fr) 96px;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid #E2E8F0;
    background: #FFFFFF;
  }
`

function renderPluginPanelShell({ activeGroup, activeTab, bodyHtml, uiMode = 'expert', unboundHeader = false }) {
  const isNovice = uiMode === 'novice'
  const groups = [
    { key: 'collab', label: '协同与审批', badge: unboundHeader ? '待初始化' : '1' },
    { key: 'overview', label: '总览' },
    { key: 'assets', label: '架构' },
    { key: 'results', label: '质量' },
    { key: 'report', label: '报告' },
    { key: 'resources', label: '集群' },
  ]
  const subTabsByGroup = {
    collab: [['collab', '协同与审批']],
    overview: [['overview', '总览']],
    assets: [['assets', '模块与服务']],
    results: [
      ['findings', '代码审查与缺陷'],
      ['scores', '交付里程碑'],
    ],
    report: [['report', '研发交付报告']],
    resources: [
      ['agents', '智能体与并发'],
      ['prompts', '角色与提示词'],
      ['sessions', '运行环境'],
      ['artifacts', '构建产物'],
      ['knowledge', '工程模式库'],
      ['skills', '研发技能库'],
    ],
  }
  const subTabs = subTabsByGroup[activeGroup] || []

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>${STYLE_TEXT}</style>
  <style>${VIEWPORT_ADAPTER_CSS}</style>
</head>
<body>
  <div class="rt-embed rt-embed-root" data-open="1">
    <div class="rt-head" style="padding:8px 16px;gap:8px">
      <div class="rt-title" style="font-size:13.5px"><span class="rt-dot"></span>LMTAgent 研发控制台</div>
      <span class="rt-tag ${unboundHeader ? 'rt-tag-warn' : 'rt-tag-live'}">${unboundHeader ? '待初始化' : '跟随会话'}</span>
      <select class="rt-input" style="max-width:255px;font-size:12px">
        <option>${unboundHeader ? '当前会话 · exa 下载紫色晶石官包（待初始化）' : 'LMTAgent v0.22.0 研发集群'}</option>
      </select>
      <div class="rt-spacer"></div>
      <div class="rt-ui-mode-switcher" style="display:inline-flex;align-items:center;gap:6px;padding:2px 4px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)">
        <button type="button" class="rt-btn${isNovice ? ' rt-btn-primary' : ''}" style="border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:${isNovice ? 700 : 500}">🌱 新手简洁视图</button>
        <span style="font-size:11px;color:var(--dsw-alias-label-tertiary)">⇄</span>
        <button type="button" class="rt-btn${!isNovice ? ' rt-btn-primary' : ''}" style="border-radius:999px;padding:2px 9px;font-size:11.5px;font-weight:${!isNovice ? 700 : 500}">🔧 专家全量视图</button>
      </div>
      <span class="rt-tag">v0.22.0</span>
      <button class="rt-btn">检查更新</button>
      <button class="rt-btn">刷新</button>
      <button class="rt-btn">全面浏览</button>
    </div>

    <div class="rt-tabs rt-tabs-groups" role="navigation" style="padding:5px 16px 0">
      ${groups.map((g) => `<div class="rt-tab rt-tab-group${g.key === activeGroup ? ' on' : ''}">${g.label}${g.badge ? `<span class="rt-tag rt-tag-live" style="margin-left:5px;padding:0 5px;font-size:10px;line-height:15px">${g.badge}</span>` : ''}</div>`).join('')}
    </div>
    ${subTabs.length > 1 ? `<div class="rt-tabs rt-tabs-sub" role="tablist" style="padding:2px 16px 0">
      ${subTabs.map(([k, label]) => `<div class="rt-tab${k === activeTab ? ' on' : ''}" role="tab">${label}</div>`).join('')}
    </div>` : ''}

    <div class="rt-body">
      ${bodyHtml}
    </div>

    <div class="rt-foot" style="padding:5px 16px;font-size:11px">
      <span class="rt-wb-badge">${isNovice ? 'LMTAgent · AI 协同工作台' : 'LMTAgent · 8-Role · 4-Wave DAG'}</span>
      <div class="rt-spacer"></div>
      <span>${isNovice ? '工作区 · ' : 'PG/WAL · '}LMTAgent v0.22.0 研发集群</span>
      <span>会话 9f41c8a2 · 落盘绑定</span>
    </div>
  </div>
</body>
</html>`
}

// 1. Shot 1: Standalone `协同与审批` (`CollabApprovalTab`) — Session 1:1 Onboarding Guide + Wish Clarification + Approval Queue
const overviewBody = `
  <div class="rt-pane rt-collab-page" style="padding:14px 18px;display:flex;flex-direction:column;gap:12px;height:100%;overflow:hidden;background:#F8FAFC">
    <!-- Card 1: SessionOnboardingCard -->
    <div class="rt-card rt-onboard-card" style="margin:0;padding:13px 16px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
        <span style="font-size:13.5px;font-weight:800;color:#0F172A">🧭 会话专属工作台初始化指引</span>
        <span class="rt-tag rt-tag-warn">当前会话 · exa 下载紫色晶石官包（待初始化）</span>
        <span class="rt-mono" style="font-size:11px;color:#475569;background:#F1F5F9;padding:1px 7px;border-radius:5px">cwd: /workspace/pureking/exa-purple-pkg</span>
        <div class="rt-spacer"></div>
        <button class="rt-btn" style="font-size:11.5px;padding:3px 10px">🧭 未对话时可随时重开指引</button>
        <button class="rt-btn" style="font-size:11.5px;padding:3px 10px">跳过指引</button>
      </div>
      <div class="rt-onboard-steps" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:10px">
        <div style="padding:8px 10px;border-radius:8px;background:#FFFFFF;border:1px solid #DBEAFE">
          <div style="font-size:11.5px;font-weight:700;color:#1D4ED8">① 1:1 独立会话工作台隔离</div>
          <div style="font-size:11px;color:#475569;margin-top:2px">按当前点开的 DSH 会话独立建库，彻底杜绝跨会话串台覆盖旧项目</div>
        </div>
        <div style="padding:8px 10px;border-radius:8px;background:#FFFFFF;border:1px solid #DBEAFE">
          <div style="font-size:11.5px;font-weight:700;color:#1D4ED8">② 对话澄清与无交集分片</div>
          <div style="font-size:11px;color:#475569;margin-top:2px">消除模糊口语歧义，预生成 Wave 1–4 目标与 ShardLock 文件排他边界</div>
        </div>
        <div style="padding:8px 10px;border-radius:8px;background:#FFFFFF;border:1px solid #DBEAFE">
          <div style="font-size:11.5px;font-weight:700;color:#1D4ED8">③ 摘要验收与闭环推进</div>
          <div style="font-size:11px;color:#475569;margin-top:2px">Worker 完成后压缩 85%+ 摘要汇总至此，支持一键批准或退回单分片重跑</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <input class="rt-input" style="flex:1;font-size:12px;height:30px" value="exa 下载紫色晶石官包" />
        <button class="rt-btn rt-btn-primary" style="font-weight:700;font-size:12px;height:30px;padding:0 14px">✨ 创建并初始化当前会话工作台</button>
        <button class="rt-btn" style="font-size:11.5px;height:30px;padding:0 12px">🔗 显式关联已有工作台…</button>
      </div>
    </div>

    <!-- Card 2: WishDialogueCard -->
    <div class="rt-card" style="margin:0;padding:13px 16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:13px;font-weight:800;color:#0F172A">💬 需求澄清对话与 4-Wave 分片立项</span>
        <span class="rt-tag rt-tag-live">归属工作台：当前会话独立新建</span>
        <div class="rt-spacer"></div>
        <span style="font-size:11px;color:#64748B">点击下方澄清维度可快速补全验收边界</span>
      </div>
      <div class="rt-clarify-chips-row" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        <span class="rt-tag" style="background:#EFF6FF;color:#1D4ED8;border-color:#BFDBFE">+ 明确目标运行平台与技术栈</span>
        <span class="rt-tag" style="background:#EFF6FF;color:#1D4ED8;border-color:#BFDBFE">+ 补充核心交付页面与接口契约</span>
        <span class="rt-tag" style="background:#EFF6FF;color:#1D4ED8;border-color:#BFDBFE">+ 约束并发上限与自动化测试门禁</span>
      </div>
      <div style="border:1px solid #CBD5E1;border-radius:8px;padding:8px 11px;background:#FFFFFF;font-size:12px;color:#0F172A;line-height:1.55;margin-bottom:8px">
        构建紫色晶石官包高速下载与 SHA-256 校验命令行及 Web 面板：支持断点续传、镜像源测速切换、解压完整性校验与自动化冒烟测试。
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:11.5px;color:#475569">已预览拆解：<b>Wave 1 立项</b> · <b>Wave 2 分片锁</b> · <b>Wave 3 并行构建 (3 槽)</b> · <b>Wave 4 回归验收</b></span>
        <div class="rt-spacer"></div>
        <button class="rt-btn" style="font-size:11.5px;padding:4px 11px">✨ 润色并预览分片蓝图</button>
        <button class="rt-btn rt-btn-primary" style="font-weight:700;font-size:12px;padding:4px 14px">🚀 确认蓝图并立项派发</button>
      </div>
    </div>

    <!-- Card 3: ApprovalQueueCard -->
    <div class="rt-card rt-approval-card" style="margin:0;padding:13px 16px;border-color:rgba(245,158,11,0.45);background:linear-gradient(180deg,#FFFBEB 0%,#FFFFFF 38%)">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <span style="font-size:13px;font-weight:800;color:#0F172A">✅ 阶段产出与 Worker 审批决策队列</span>
        <span class="rt-pri-badge rt-pri-badge-p0">1 项待审批</span>
        <span class="rt-digest-pill">📦 worker_digest 压缩 -86% (省 3,690 tok)</span>
        <div class="rt-spacer"></div>
        <button class="rt-btn" style="font-size:11px;padding:2px 9px">待决策 (1)</button>
        <button class="rt-btn" style="font-size:11px;padding:2px 9px">全部记录 (4)</button>
      </div>
      <div class="rt-approval-digest-grid" style="display:grid;grid-template-columns:1.25fr 1fr;gap:10px;align-items:center">
        <div style="padding:9px 11px;border-radius:8px;background:#F8FAFC;border:1px solid #E2E8F0;font-size:11.5px;line-height:1.55;color:#1E293B">
          <div><b>⑤ Worker #1 (Builder · #mirror-downloader)</b> · <span class="rt-mono" style="font-size:10.5px;color:#2563EB">独占 src/downloader/**</span></div>
          <div style="margin-top:3px;color:#475569"><b>完成摘要：</b>实现分块并发拉取、HTTP Range 断点续传与 SHA-256 流式校验，单测 18/18 通过。</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <input class="shot-inline-input" value="下一目标：交由 QA Lead 执行端到端校验并生成交付报告" />
          <div style="display:flex;gap:6px">
            <button class="rt-btn rt-btn-primary" style="flex:1;background:#059669;border-color:#059669;font-weight:700;font-size:11.5px">✓ 审批通过并下达目标</button>
            <button class="rt-btn" style="font-size:11px">↻ 退回重跑</button>
            <button class="rt-btn" style="font-size:11px">💬 跳转对话 ↗</button>
          </div>
        </div>
      </div>
    </div>
  </div>
`


// 2. Shot 2: Upgraded `集群 -> 智能体与并发` (`p5`) Cluster Workbench
const agentsBody = `
  <div class="rt-main">
    <div class="rt-toolbar" style="padding:7px 16px;gap:8px">
      <span style="font-weight:700;font-size:12.5px">智能体与并发（4-Wave 实时集群拓扑）</span>
      <span class="rt-tag rt-tag-live">并发槽 4/6</span>
      <span class="rt-tag rt-tag-live">3min 无心跳自动回收 · 分片排他锁</span>
      <div class="rt-spacer"></div>
      <button class="rt-btn" style="font-size:11.5px">角色与提示词 →</button>
      <button class="rt-btn" style="font-size:11.5px">刷新</button>
    </div>

    <div style="padding:10px 16px;display:flex;flex-direction:column;gap:9px;flex:1;min-height:0;overflow:hidden;background:#F8FAFC">
      <div class="rt-card" style="margin:0;padding:9px 14px">
        <div class="rt-p3-ctrl" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:700">并发数量与租约控制</span>
          <div class="rt-p3-stepper">
            <button class="rt-p3-step-btn">-</button>
            <span class="rt-p3-step-val">6 槽</span>
            <button class="rt-p3-step-btn">+</button>
          </div>
          <div class="rt-p3-pills">
            <button class="rt-p3-pill">3 槽</button>
            <button class="rt-p3-pill on">6 槽 (推荐)</button>
            <button class="rt-p3-pill">8 槽</button>
            <button class="rt-p3-pill">12 槽</button>
          </div>
          <select class="rt-input" style="height:26px;font-size:11.5px;padding:0 8px"><option>maxDepth = 3</option></select>
          <select class="rt-input" style="height:26px;font-size:11.5px;padding:0 8px"><option>thinking = low (极速)</option></select>
          <span style="font-size:11.5px;color:#475569;margin-left:auto">同一项目<b>同时最多 6 个执行智能体</b> · 派发前经 <code class="rt-code-inline">redteam_agent_slot</code> 占位核验</span>
        </div>
      </div>

      <div style="background:#FFFFFF;border:1px solid #CBD5E1;border-radius:10px;padding:10px 14px;background-image:radial-gradient(#E2E8F0 1px, transparent 1px);background-size:15px 15px">
        <div style="display:flex;align-items:center;gap:0">
          <div class="shot-wave-hub active" style="width:196px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span class="rt-tree-wave-card-badge">Wave 3 · 树状图</span>
              <span style="font-size:10px;color:#2563EB;font-weight:700">4/6 槽运行</span>
            </div>
            <div style="font-weight:800;font-size:11.5px;color:#0F172A;margin-top:3px">Builder 并发分片拓扑</div>
            <div style="font-size:10px;color:#475569;margin-top:2px">点击节点联动下方双步透视抽屉</div>
            <span class="rt-n8n-diamond-pin-right"></span>
          </div>

          <svg class="rt-h-wave-branch-line" width="38" height="86" viewBox="0 0 38 86" style="width:38px;height:86px;flex-shrink:0">
            <path d="M0 43 C19 43, 19 18, 38 18" fill="none" stroke="#2563EB" stroke-width="2.4" />
            <path d="M0 43 L38 43" fill="none" stroke="#0EA5E9" stroke-width="2" />
            <path d="M0 43 C19 43, 19 68, 38 68" fill="none" stroke="#10B981" stroke-width="2" />
          </svg>

          <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:10px;flex:1">
            <div class="shot-worker-card selected" style="padding:8px 11px">
              <span class="rt-n8n-port-left"></span>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <b style="font-size:11.2px;color:#1D4ED8">⑤ Shard #1 · #ui-canvas</b>
                <span class="rt-pri-badge rt-pri-badge-p0">P0 焦点审批</span>
              </div>
              <div style="font-size:10px;color:#334155">完成 p5 集群工作台重构与 SVG 连线绝对定位</div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
                <span class="rt-digest-pill">📦 -86% (4.2K→590 tok)</span>
                <span style="font-size:9.8px;color:#2563EB;font-weight:700">▼ 当前检视中</span>
              </div>
            </div>

            <div class="shot-worker-card" style="padding:8px 11px">
              <span class="rt-n8n-port-left"></span>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <b style="font-size:11.2px;color:#0F172A">⑤ Shard #2 · #session-iso</b>
                <span class="rt-pri-badge rt-pri-badge-p1">P1 核心并发</span>
              </div>
              <div style="font-size:10px;color:#0284C7;font-weight:600">↳ 派生 Sub-Worker #2a (depth:1 · low)</div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
                <span class="rt-worker-tag-pill">🔒 shard_locks (162s)</span>
                <span style="font-size:9.8px;color:#059669;font-weight:700">● 编码中 · 1m42s</span>
              </div>
            </div>

            <div class="shot-worker-card" style="padding:8px 11px">
              <span class="rt-n8n-port-left"></span>
              <div style="display:flex;justify-content:space-between;align-items:center">
                <b style="font-size:11.2px;color:#0F172A">⑤ Shard #3 · #collab-tab</b>
                <span class="rt-pri-badge rt-pri-badge-p2">P2 已审归档</span>
              </div>
              <div style="font-size:10px;color:#334155">独立「协同与审批」页签与跳过/重开指引闭环</div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
                <span class="rt-digest-pill">📦 -87% 已归档</span>
                <span style="font-size:9.8px;color:#059669;font-weight:700">✓ Plan 已审</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="rt-agent-inspector-drawer" style="padding:10px 14px;gap:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;white-space:nowrap">
          <div style="display:flex;align-items:center;gap:7px">
            <span style="font-size:13px">🔎</span>
            <b style="font-size:12.2px;color:#0F172A">两步式节点透视与闭环审批抽屉 · ⑤ Shard #1 (exploit#1)</b>
            <span class="rt-pri-badge rt-pri-badge-p0">P0 焦点审批</span>
            <span class="rt-worker-tag-pill">🔒 独占 packages/redteam-ui/src/client/07-cluster-shell.js</span>
          </div>
          <button class="rt-jump-chat-btn" style="padding:4px 11px;font-size:11px">💬 跳转侧边聊天框打开该 Agent 会话 ↗</button>
        </div>

        <div style="display:grid;grid-template-columns:1.05fr 1.05fr 1.25fr;gap:10px;align-items:stretch">
          <div style="background:#FFFFFF;border:1px solid #CBD5E1;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;justify-content:space-between;gap:6px">
            <div>
              <div style="font-weight:700;font-size:10.5px;color:#2563EB;margin-bottom:3px">📥 委派目标（支持原位改写与单分片重跑）</div>
              <div style="font-size:10.8px;color:#1E293B;line-height:1.45">将集群页升级为实时 p5 拓扑工作台，拆分角色与提示词独立子页，收敛 6 个宿主槽位。</div>
            </div>
            <div style="display:flex;gap:6px">
              <button class="rt-btn" style="padding:3px 9px;font-size:10.8px;font-weight:700;color:#2563EB;border-color:#93C5FD">✏️ 编辑目标</button>
              <button class="rt-btn" style="padding:3px 9px;font-size:10.8px;font-weight:700;color:#B45309;border-color:#FCD34D;background:#FFFBEB">🔄 重跑该分片</button>
            </div>
          </div>

          <div class="rt-digest-box" style="padding:8px 10px;gap:5px;justify-content:space-between">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b style="font-size:10.5px;color:#065F46">📤 压缩摘要 (worker_digest)</b>
              <span class="rt-digest-pill">-86% · 省 3,690 tok</span>
            </div>
            <div style="font-size:10.5px;color:#1E293B;line-height:1.45">
              <b>what_was_done</b>: 移除旧 12 槽方块墙与跨会话抢占回退，直连 HarnessWorkflowDeck<br/>
              <b>verification</b>: <code>tabs-render + ui-smoke + client-load</code> 全部通过
            </div>
          </div>

          <div style="background:#F0FDF4;border:1px solid rgba(16,185,129,0.4);border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;justify-content:space-between;gap:6px">
            <div style="font-weight:700;font-size:10.5px;color:#065F46">✅ 主控 Plan 验收并自定义下一目标 (nextGoal)</div>
            <input class="shot-inline-input" value="下一目标：联调 Wave 4 全量回归套件并同步更新交付文稿墙" />
            <button class="rt-plan-approve-btn" style="width:100%;padding:5px 10px;font-size:11.2px">✓ Plan 审批通过并下达新目标</button>
          </div>
        </div>
      </div>

      <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;padding:8px 14px;display:flex;flex-direction:column;gap:5px;flex:1;min-height:0">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-weight:800;font-size:11.5px;color:#0F172A">🏊 团队任务板 · 全宽跨 Agent 3 段式执行泳道（P0 → P1 → P2 → P3 优先级排序）</span>
          <span style="font-size:10.2px;color:#64748B">点击任意泳道同步切换上方节点透视抽屉</span>
        </div>

        <div class="shot-swimlane-row" style="border-color:rgba(239,68,68,0.35);background:#FEF2F2">
          <div style="display:flex;align-items:center;gap:6px;white-space:nowrap">
            <span class="rt-pri-badge rt-pri-badge-p0">P0</span>
            <b style="font-size:11px;color:#0F172A">⑤ Shard #1 (#ui-canvas)</b>
          </div>
          <div class="rt-step-chain" style="padding:0">
            <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 8px;font-size:10.2px"><b>委派目标</b><span>p5 集群拓扑升级与槽位收敛</span></div><span class="rt-step-arrow">➔</span></div>
            <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 8px;font-size:10.2px"><b>核心执行</b><span>独占写入 5 个前端与测试文件</span></div><span class="rt-step-arrow">➔</span></div>
            <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 8px;font-size:10.2px;border-color:#10B981"><b>阶段结论</b><span>待 Plan 审批 (-86% Digest)</span></div></div>
          </div>
          <span class="rt-digest-pill" style="justify-self:end">待审批 ⏳</span>
        </div>

        <div class="shot-swimlane-row">
          <div style="display:flex;align-items:center;gap:6px;white-space:nowrap">
            <span class="rt-pri-badge rt-pri-badge-p1">P1</span>
            <b style="font-size:11px;color:#0F172A">⑤ Shard #2 (#session-iso)</b>
          </div>
          <div class="rt-step-chain" style="padding:0">
            <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 8px;font-size:10.2px"><b>委派目标</b><span>1:1 会话绑定与初始化引导卡</span></div><span class="rt-step-arrow">➔</span></div>
            <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 8px;font-size:10.2px;border-color:#3B82F6"><b>核心执行</b><span>递归派生 Sub #2a 校验边界</span></div><span class="rt-step-arrow">➔</span></div>
            <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 8px;font-size:10.2px"><b>阶段结论</b><span>实时流式同步 (TTL 162s)</span></div></div>
          </div>
          <span class="rt-tag rt-tag-live" style="justify-self:end">运行中 ⚡</span>
        </div>

        <div class="shot-swimlane-row" style="opacity:0.94">
          <div style="display:flex;align-items:center;gap:6px;white-space:nowrap">
            <span class="rt-pri-badge rt-pri-badge-p2">P2</span>
            <b style="font-size:10.8px;color:#0F172A">③ Eng Manager (#shard-lock)</b>
          </div>
          <div class="rt-step-chain" style="padding:0">
            <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 8px;font-size:10px"><b>委派目标</b><span>冻结跨分片接口与独占文件边界</span></div><span class="rt-step-arrow">➔</span></div>
            <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 8px;font-size:10px"><b>核心执行</b><span>登记 shard_locks 排他表</span></div><span class="rt-step-arrow">➔</span></div>
            <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 8px;font-size:10px"><b>阶段结论</b><span>Plan 已审批归档 (-88%)</span></div></div>
          </div>
          <span class="rt-pri-badge rt-pri-badge-p2" style="justify-self:end">已审归档 ✓</span>
        </div>
      </div>
    </div>
  </div>
`

// 3. Shot 3: File-Disjoint ShardLock Ownership Matrix + Fact Store Live Write & Digest Probe
const assetsBody = `
  <div class="rt-main">
    <div class="rt-toolbar" style="gap:8px;padding:8px 16px">
      <input class="rt-input" style="width:240px;font-family:monospace;font-size:11.5px" value="table:shard_locks,worker_digests" />
      <span class="rt-tag rt-tag-live">🔒 6 独占分片锁零冲突</span>
      <span class="rt-digest-pill">📦 -86% 摘要压缩 (省 31.2K tok)</span>
      <div class="rt-spacer"></div>
      <span class="rt-tag rt-tag-active">3min 无心跳自动回收 · 0.4ms</span>
      <button class="rt-btn rt-btn-primary" style="padding:4px 11px;font-size:11.5px">+ 校验分片排他锁</button>
    </div>

    <div class="rt-split" style="flex:1;min-height:0">
      <div class="rt-list" style="width:340px">
        <div class="rt-section">🔒 ShardLock 文件独占所有权矩阵 (shard_locks)</div>
        <div class="rt-item on">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #1 · store/session-onboarding</span>
            <span class="rt-tag rt-tag-live">TTL 168s</span>
          </div>
          <div class="rt-item-desc">Owner: <code>worker#1</code> · 独占 <code>packages/redteam-store/**</code></div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #2 · client/collab-and-deck</span>
            <span class="rt-tag rt-tag-live">TTL 162s</span>
          </div>
          <div class="rt-item-desc">Owner: <code>worker#2</code> · 独占 <code>01-core-rpc..05-overview-tab</code></div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #3 · client/cluster-shell-p5</span>
            <span class="rt-tag rt-tag-live">TTL 174s</span>
          </div>
          <div class="rt-item-desc">Owner: <code>worker#3</code> · 独占 <code>07-cluster-shell + tests + shots</code></div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #4 · ui/src/styles</span>
            <span class="rt-tag rt-tag-active">已释放 ✓</span>
          </div>
          <div class="rt-item-desc">Owner: <code>worker#1</code> · 独占 <code>src/styles/01-shell..03-canvas</code></div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #5 · tools/workflow-slot</span>
            <span class="rt-tag rt-tag-active">已释放 ✓</span>
          </div>
          <div class="rt-item-desc">Owner: <code>worker#2</code> · 独占 <code>packages/redteam-tools/**</code></div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #6 · qa/regression-gate</span>
            <span class="rt-tag rt-tag-passive">待调度</span>
          </div>
          <div class="rt-item-desc">Owner: <code>qa#1</code> · 独占 Wave 4 端到端冒烟与打包校验</div>
        </div>
      </div>

      <div class="rt-pane" style="padding:14px 18px;gap:12px;overflow:hidden">
        <div style="display:grid;grid-template-columns:repeat(4, minmax(0, 1fr));gap:10px">
          <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:8px;padding:10px 12px">
            <div style="font-size:10.5px;color:#64748B">session_onboarding 隔离表</div>
            <div style="font-size:16px;font-weight:800;color:#2563EB;margin-top:3px">1:1 强绑定</div>
            <div style="font-size:10px;color:#059669">新会话零串流污染</div>
          </div>
          <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:8px;padding:10px 12px">
            <div style="font-size:10.5px;color:#64748B">worker_tasks 任务流</div>
            <div style="font-size:16px;font-weight:800;color:#0284C7;margin-top:3px">6 + 2 递归</div>
            <div style="font-size:10px;color:#475569">3min 僵尸租约自动回收</div>
          </div>
          <div style="background:#ECFDF5;border:1px solid rgba(16,185,129,0.38);border-radius:8px;padding:10px 12px">
            <div style="font-size:10.5px;color:#065F46;font-weight:700">worker_digests 压缩比</div>
            <div style="font-size:16px;font-weight:800;color:#059669;margin-top:3px">-86.2%</div>
            <div style="font-size:10px;color:#047857">36.2K → 5.0K tok</div>
          </div>
          <div style="background:#FFFBEB;border:1px solid rgba(245,158,11,0.38);border-radius:8px;padding:10px 12px">
            <div style="font-size:10.5px;color:#92400E;font-weight:700">shard_locks 冲突拦截</div>
            <div style="font-size:16px;font-weight:800;color:#B45309;margin-top:3px">0 越界写</div>
            <div style="font-size:10px;color:#B45309">分片排他锁实时守护</div>
          </div>
        </div>

        <div class="rt-card" style="margin:0;padding:12px 14px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px">
            <span class="rt-tag rt-tag-live">● LIVE PROBE</span>
            <b style="font-size:12.5px;color:#0F172A">事实库实时写表与摘要压缩事务流</b>
            <span class="rt-mono" style="margin-left:auto;font-size:10.5px;color:#059669;font-weight:700">SSE Push · 0 锁冲突</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:11px">
            <div class="rt-atest-row" style="padding:6px 10px">
              <span class="rt-mono" style="width:150px;font-weight:700;color:#2563EB">session_onboarding</span>
              <span class="rt-tag rt-tag-live" style="width:82px;text-align:center">ISOLATE</span>
              <span style="flex:1;color:#334155">记录会话级 <code>initialized / skipped / uninitialized</code> 状态，杜绝跨会话项目串流</span>
              <span class="rt-mono" style="color:#059669;font-weight:700">0.2ms</span>
            </div>
            <div class="rt-atest-row" style="padding:6px 10px;background:#FFFBEB;border-color:rgba(245,158,11,0.3)">
              <span class="rt-mono" style="width:150px;font-weight:700;color:#B45309">shard_locks</span>
              <span class="rt-tag rt-tag-active" style="width:82px;text-align:center">ACQUIRE</span>
              <span style="flex:1;color:#334155"><code>worker#1..#3</code> 锁定互不重叠文件分片（3min 无心跳自动释放租约）</span>
              <span class="rt-mono" style="color:#059669;font-weight:700">0.2ms</span>
            </div>
            <div class="rt-atest-row" style="padding:6px 10px">
              <span class="rt-mono" style="width:150px;font-weight:700;color:#0284C7">worker_tasks</span>
              <span class="rt-tag rt-tag-live" style="width:82px;text-align:center">UPSERT</span>
              <span style="flex:1;color:#334155"><code>worker#1</code> 流转至 <b>P0 焦点审批</b>，同步推送到「协同与审批」待办角标</span>
              <span class="rt-mono" style="color:#059669;font-weight:700">0.4ms</span>
            </div>
            <div class="rt-atest-row" style="padding:6px 10px;background:#ECFDF5;border-color:rgba(16,185,129,0.32)">
              <span class="rt-mono" style="width:150px;font-weight:700;color:#059669">worker_digests</span>
              <span class="rt-digest-pill" style="width:82px;justify-content:center">-86% ZIP</span>
              <span style="flex:1;color:#065F46">压缩轨迹 <code>4,280 → 590 tok</code>（what_was_done + verification）</span>
              <span class="rt-mono" style="color:#059669;font-weight:700">0.4ms</span>
            </div>
          </div>
        </div>

        <div class="rt-card" style="margin:0;padding:12px 14px">
          <h4 style="margin:0 0 8px;font-size:12px">🛡️ 运行时文件排他锁与会话隔离契约 · ShardLock &amp; Session Guard</h4>
          <div class="rt-kv"><b>1:1 会话工作区强隔离</b><span>未绑定工作区的新会话默认进入「协同与审批」初始化向导；跳过后保持干净空白态，无历史消息时可一键重新唤起指引</span></div>
          <div class="rt-kv"><b>跨分片冲突校验</b><span>任一 Worker 声明重叠文件路径立即触发 <code>SHARD_LOCK_CONFLICT</code> 拒绝越界写入</span></div>
          <div class="rt-kv"><b>3min 僵尸槽自动回收</b><span>子代理异常中断或超过 3 分钟无心跳更新，自动回收并发槽位与文件排他锁，消除伪长耗时悬挂</span></div>
        </div>
      </div>
    </div>
  </div>
`

// 4. Shot 4: Closed-Loop Delivery Report (Doc Wall) + Feishu Webhook Delivery Card
const reportBody = `
  <div class="rt-main">
    <div class="rt-toolbar" style="gap:8px;padding:8px 16px;flex-wrap:nowrap;white-space:nowrap">
      <span style="font-weight:800;font-size:12px;color:#0F172A">📄 闭环研发交付文稿墙 (worker_digests 聚合报告)</span>
      <span class="rt-digest-pill">📦 8 份摘要 (-86%)</span>
      <span class="rt-tag rt-tag-live">📨 飞书已送达 ✓</span>
      <div class="rt-spacer"></div>
      <button class="rt-btn" style="padding:3px 9px;font-size:11px">⚙️ feishuConfig</button>
      <button class="rt-btn" style="padding:3px 9px;font-size:11px">复制 Markdown</button>
      <button class="rt-btn rt-btn-primary" style="padding:3px 10px;font-size:11px">导出交付报告</button>
    </div>

    <div class="rt-split" style="flex:1;min-height:0">
      <div class="rt-list" style="width:310px">
        <div class="rt-section">闭环阶段目标与 Digest 产物 (8)</div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">⓪ WishRefiner 立项总纲</span>
            <span class="rt-pri-badge rt-pri-badge-p2">Plan</span>
          </div>
          <div class="rt-item-desc">需求润色 + 4 阶段无冲突分片蓝图</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">① 1:1 会话隔离与引导契约</span>
            <span class="rt-digest-pill">-85%</span>
          </div>
          <div class="rt-item-desc">recon · 消除跨会话串流与跳过/重开闭环</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">③ ShardLock 分片所有权矩阵</span>
            <span class="rt-digest-pill">-88%</span>
          </div>
          <div class="rt-item-desc">assess · 排他文件锁与 3min 心跳回收</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">⑤ p5 集群工作台与槽位去重</span>
            <span class="rt-digest-pill">-86%</span>
          </div>
          <div class="rt-item-desc">exploit · 独立协同页 + 6 宿主槽位收敛</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">⑥ QA 自动化回归验收单</span>
            <span class="rt-tag rt-tag-live">ALL PASS</span>
          </div>
          <div class="rt-item-desc">qa · 渲染/冒烟/会话隔离断言全绿</div>
        </div>
        <div class="rt-item on">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">⑦ v0.22.0 闭环交付总报告</span>
            <span class="rt-tag rt-tag-live">当前浏览</span>
          </div>
          <div class="rt-item-desc">internal 自动汇编 worker_digests</div>
        </div>
        <div class="rt-item" style="background:#ECFDF5;border-color:rgba(16,185,129,0.35)">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name" style="color:#047857">📨 飞书 Webhook 推送回执</span>
            <span class="rt-tag rt-tag-live">200 OK</span>
          </div>
          <div class="rt-item-desc" style="color:#065F46">HMAC-SHA256 签名通过 · 卡片已送达</div>
        </div>
      </div>

      <div class="rt-pane" style="padding:14px 18px;gap:12px;overflow:hidden">
        <div class="rt-card" style="margin:0;padding:12px 16px;background:linear-gradient(135deg, rgba(77,107,254,0.08), rgba(16,185,129,0.05));border-color:rgba(77,107,254,0.3)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
            <div>
              <div style="font-size:14.5px;font-weight:800;color:#0F172A">⑦ LMTAgent v0.22.0 研发集群闭环交付总报告</div>
              <div style="font-size:11.2px;color:#475569;margin-top:3px">由 <code>internal</code> 聚合 <code>plan_goals + worker_digests</code> 自动生成 · 上下文累计压缩节省 31.2K Tokens (-86%)</div>
            </div>
            <span class="rt-wb-badge" style="font-size:11px;padding:5px 11px;white-space:nowrap">Plan 闭环签发 ✓</span>
          </div>
        </div>

        <div class="rt-card" style="margin:0;padding:12px 16px">
          <h4 style="margin:0 0 8px;font-size:12px">一、worker_digests 结构化交付核验清单</h4>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:11.2px">
            <div class="rt-atest-row" style="padding:6px 10px">
              <span class="rt-pri-badge rt-pri-badge-p2">Goal 1</span>
              <span style="flex:1"><b>1:1 会话工作区隔离与初始化引导闭环</b>（新会话不串流旧项目 · 支持跳过指引与无对话时一键重新指引）</span>
              <span class="rt-tag rt-tag-live">已验收</span>
            </div>
            <div class="rt-atest-row" style="padding:6px 10px">
              <span class="rt-pri-badge rt-pri-badge-p2">Goal 2</span>
              <span style="flex:1"><b>独立「协同与审批」一级分区与顶栏单一视图切换</b>（消除重复胶囊与挤占首屏向导，集中处理审批待办）</span>
              <span class="rt-tag rt-tag-live">已验收</span>
            </div>
            <div class="rt-atest-row" style="padding:6px 10px">
              <span class="rt-pri-badge rt-pri-badge-p2">Goal 3</span>
              <span style="flex:1"><b>集群「智能体与并发」升级实时 p5 拓扑 + 3min 僵尸槽自动回收</b>（拆分「角色与提示词」独立子页，修复 SVG 连线错位）</span>
              <span class="rt-tag rt-tag-live">已验收</span>
            </div>
            <div class="rt-atest-row" style="padding:6px 10px">
              <span class="rt-pri-badge rt-pri-badge-p2">Goal 4</span>
              <span style="flex:1"><b>宿主槽位精准去重（6 槽位）与真实插件面板截图</b>（移除伪造宿主窗口壳层，100% 呈现真实 LMTAgent 面板）</span>
              <span class="rt-tag rt-tag-live">ALL PASS</span>
            </div>
          </div>
        </div>

        <div class="rt-card" style="margin:0;padding:12px 16px;background:linear-gradient(135deg, #ECFDF5 0%, #F0F9FF 100%);border-color:rgba(16,185,129,0.42)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:6px;font-weight:800;font-size:12px;color:#065F46">
              <span>📨 飞书群聊机器人实时推送卡片 (Feishu Webhook Delivery · feishuConfig)</span>
            </div>
            <span class="rt-mono" style="font-size:10.5px;color:#059669;font-weight:700">HTTP 200 OK · StatusCode: 0 · 34ms</span>
          </div>
          <div class="rt-kv"><b>Webhook 端点</b><span class="rt-mono">https://open.feishu.cn/open-apis/bot/v2/hook/lmtagent-v0220-cluster (HMAC-SHA256 已签名)</span></div>
          <div class="rt-kv"><b>交互卡片载荷</b><span><code>msg_type: "interactive"</code> · 含 4 阶段目标达成率、Digest 压缩率 <b>-86%</b>、ShardLock 零冲突证明与回归测试摘要</span></div>
          <div class="rt-kv"><b>一键重推与持久化</b><span>支持配置 <code>feishuConfig</code> 密钥并在交付报告生成后自动或手动触发飞书群聊战报推送</span></div>
        </div>
      </div>
    </div>
  </div>
`

const SHOTS = [
  {
    file: 'ui-overview-workbench.png',
    activeGroup: 'collab',
    activeTab: 'collab',
    bodyHtml: overviewBody,
    uiMode: 'novice',
    unboundHeader: true,
  },
  {
    file: 'ui-agents-dag.png',
    activeGroup: 'resources',
    activeTab: 'agents',
    bodyHtml: agentsBody,
    uiMode: 'expert',
  },
  {
    file: 'ui-assets-pg.png',
    activeGroup: 'assets',
    activeTab: 'assets',
    bodyHtml: assetsBody,
    uiMode: 'expert',
  },
  {
    file: 'ui-report-v2.png',
    activeGroup: 'report',
    activeTab: 'report',
    bodyHtml: reportBody,
    uiMode: 'novice',
  },
]

const chromiumBin = resolveChromiumBin()
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmtagent-ui-shots-v022-'))

try {
  for (const shot of SHOTS) {
    const htmlPath = path.join(tmpDir, shot.file.replace(/\.png$/, '.html'))
    const outPath = path.join(OUT_DIR, shot.file)
    const html = renderPluginPanelShell({
      activeGroup: shot.activeGroup,
      activeTab: shot.activeTab,
      bodyHtml: shot.bodyHtml,
      uiMode: shot.uiMode,
      unboundHeader: Boolean(shot.unboundHeader),
    })
    fs.writeFileSync(htmlPath, html, 'utf8')
    execFileSync(chromiumBin, [
      '--headless',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--hide-scrollbars',
      '--window-size=1440,900',
      '--force-device-scale-factor=2',
      `--screenshot=${outPath}`,
      `file://${htmlPath}`,
    ], { stdio: 'pipe' })
    const stat = fs.statSync(outPath)
    console.log(`✓ Generated ${shot.file} (${(stat.size / 1024).toFixed(1)} KB)`)
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
}
