#!/usr/bin/env node
/**
 * Generate 4 high-resolution (2x Retina, 2880x1800 physical pixels) UI screenshots
 * for LMTAgent v0.21.0 README showcase using the real STYLE_TEXT from
 * packages/redteam-ui/lib/styles.js plus v0.21.0 workbench shell styles.
 *
 * Output files:
 *   1. docs/assets/ui-overview-workbench.png
 *      - Collapsible WishRefinerWizard (🌱 新手简洁 ⇄ 🔧 专家视图)
 *      - Full-screen 60FPS Horizontal Left-to-Right Workflow Tree (➔ 横向向右派生)
 *        with ⚙️ 树布局设置, P0~P3 badges, #ui-canvas / #pg-store tags & -86% digest pills
 *   2. docs/assets/ui-agents-dag.png
 *      - Expanded Wave 3 horizontal derivation
 *      - Full-width Two-Step Node Inspector Drawer (✏️ 编辑目标 + editable nextGoal +
 *        ✓ Plan 审批通过并下达新目标 + 🔄 重跑该分片 + 💬 跳转侧边聊天框打开该 Agent 会话 ↗)
 *      - Full-width P0 → P3 3-stage Swimlanes
 *   3. docs/assets/ui-assets-pg.png
 *      - File-Disjoint ShardLock Ownership Matrix (shard_locks + 120s TTL lease)
 *      - Theme-Adaptive PostgreSQL 16 Live Write & Digest Compression Probe
 *        (plan_goals / worker_tasks / worker_digests + -86% Token savings)
 *   4. docs/assets/ui-report-v2.png
 *      - lmtex Closed-Loop Doc Wall (研发交付文稿主从墙) synthesized from worker_digests
 *      - Real Feishu Webhook Delivery Card (feishuConfig)
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

const SHELL_CSS = `
  :root {
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
    background: #0F172A;
    font-family: -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  svg.rt-h-wave-branch-line {
    background: none !important;
  }
  .wb-window {
    width: 1440px;
    height: 900px;
    display: flex;
    flex-direction: column;
    background: #F8FAFC;
    overflow: hidden;
  }
  /* Top DSH Desktop Titlebar */
  .wb-titlebar {
    height: 38px;
    background: #0F172A;
    color: #F8FAFC;
    display: flex;
    align-items: center;
    padding: 0 14px;
    gap: 9px;
    border-bottom: 1px solid #1E293B;
    flex-shrink: 0;
  }
  .wb-traffic { display: flex; gap: 6px; margin-right: 4px; }
  .wb-traffic span { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
  .wb-traffic .c-red { background: #EF4444; }
  .wb-traffic .c-amber { background: #F59E0B; }
  .wb-traffic .c-green { background: #10B981; }
  .wb-brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-size: 12.5px;
    letter-spacing: -0.01em;
    color: #F8FAFC;
  }
  .wb-brand-logo {
    width: 21px;
    height: 21px;
    border-radius: 6px;
    background: linear-gradient(135deg, #4D6BFE, #0EA5E9);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11.5px;
    font-weight: 800;
    color: #fff;
    box-shadow: 0 2px 8px rgba(77, 107, 254, 0.45);
  }
  .wb-pill {
    font-size: 10.5px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(77, 107, 254, 0.18);
    color: #93C5FD;
    border: 1px solid rgba(77, 107, 254, 0.35);
    font-weight: 600;
    white-space: nowrap;
  }
  .wb-pill-pg {
    background: rgba(16, 185, 129, 0.16);
    color: #6EE7B7;
    border-color: rgba(16, 185, 129, 0.35);
  }
  .wb-workspace {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  /* Left DSH Session & Role Sidebar (216px) */
  .wb-sidebar {
    width: 216px;
    background: #F1F5F9;
    border-right: 1px solid #E2E8F0;
    display: flex;
    flex-direction: column;
    padding: 9px 8px;
    gap: 3.5px;
    flex-shrink: 0;
  }
  .wb-side-sec {
    font-size: 9.8px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748B;
    padding: 4px 7px 2px;
  }
  .wb-side-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 7px;
    font-size: 11.5px;
    color: #334155;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .wb-side-item.active {
    background: #FFFFFF;
    color: #2563EB;
    font-weight: 600;
    border: 1px solid rgba(77, 107, 254, 0.25);
    box-shadow: 0 2px 6px rgba(77, 107, 254, 0.08);
  }
  .wb-side-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #4D6BFE;
    box-shadow: 0 0 0 3px rgba(77, 107, 254, 0.18);
    flex-shrink: 0;
  }
  .wb-pg-probe {
    padding: 7px 8px;
    border-radius: 9px;
    background: #FFFFFF;
    border: 1px solid #CBD5E1;
    color: #0F172A;
    font-size: 9.5px;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
  }
  .wb-pg-probe-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .wb-pg-live-badge {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 8.8px;
    color: #059669;
    background: rgba(16, 185, 129, 0.12);
    border: 1px solid rgba(16, 185, 129, 0.32);
    padding: 1px 5px;
    border-radius: 999px;
    font-weight: 600;
    margin-bottom: 4px;
    display: inline-block;
  }
  .wb-pg-row {
    display: grid;
    grid-template-columns: 66px 46px 1fr;
    align-items: center;
    gap: 3px;
    padding: 2px 0;
    border-top: 1px solid #E2E8F0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 8.6px;
  }
  .wb-pg-tbl { color: #2563EB; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wb-pg-op {
    font-size: 8px;
    padding: 0 3px;
    border-radius: 3px;
    text-align: center;
    font-weight: 700;
    white-space: nowrap;
  }
  .wb-pg-op.ins { background: rgba(77, 107, 254, 0.12); color: #2563EB; }
  .wb-pg-op.upd { background: rgba(14, 165, 233, 0.14); color: #0284C7; }
  .wb-pg-op.lck { background: rgba(245, 158, 11, 0.15); color: #B45309; }
  .wb-pg-op.dig { background: rgba(16, 185, 129, 0.14); color: #059669; }
  .wb-pg-lat { color: #059669; text-align: right; font-weight: 700; white-space: nowrap; }

  /* Center DSH Host Chat Stream (328px) */
  .wb-chat {
    width: 328px;
    background: #FFFFFF;
    border-right: 1px solid #E2E8F0;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .wb-chat-head {
    height: 42px;
    padding: 0 11px;
    border-bottom: 1px solid #E2E8F0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    font-size: 11.5px;
    font-weight: 600;
    color: #0F172A;
    white-space: nowrap;
  }
  .wb-chat-body {
    flex: 1;
    padding: 10px 11px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 100%);
  }
  .wb-msg-user {
    align-self: flex-end;
    max-width: 96%;
    background: linear-gradient(135deg, #4D6BFE, #2563EB);
    color: #FFFFFF;
    padding: 8px 11px;
    border-radius: 11px 11px 2px 11px;
    font-size: 11px;
    line-height: 1.48;
    box-shadow: 0 4px 12px rgba(77, 107, 254, 0.2);
  }
  .wb-msg-agent {
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 10px;
    padding: 8.5px 10px;
    font-size: 10.6px;
    line-height: 1.5;
    color: #1E293B;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.03);
  }
  .wb-msg-agent-head {
    display: flex;
    align-items: center;
    gap: 5px;
    font-weight: 700;
    color: #0F172A;
    margin-bottom: 4px;
    font-size: 10.8px;
    white-space: nowrap;
  }
  .wb-tool-call {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 5px;
    padding: 3.5px 7px;
    border-radius: 6px;
    background: #F8FAFC;
    border: 1px solid #E2E8F0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 9.3px;
    color: #334155;
    margin-top: 3.5px;
    white-space: nowrap;
  }
  .wb-tool-call b { color: #2563EB; }

  /* Right LMTAgent Dock Console (896px wide!) */
  .rt-dock {
    position: relative !important;
    top: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 896px !important;
    max-width: none !important;
    height: 100% !important;
    flex: 1 !important;
    box-shadow: none !important;
  }
  .rt-body {
    flex: 1;
    min-height: 0;
    overflow: hidden !important;
    display: flex;
    flex-direction: column;
  }

  /* v0.21.0 WishRefinerWizard Card */
  .rt-wish-wizard {
    background: linear-gradient(135deg, rgba(77, 107, 254, 0.07) 0%, rgba(14, 165, 233, 0.05) 55%, #FFFFFF 100%);
    border: 1.5px solid rgba(77, 107, 254, 0.34);
    border-radius: 11px;
    padding: 9px 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
    box-shadow: 0 3px 10px rgba(77, 107, 254, 0.07);
  }
  .wiz-mode-switch {
    display: inline-flex;
    align-items: center;
    background: #F1F5F9;
    border: 1px solid #CBD5E1;
    border-radius: 999px;
    padding: 1.5px;
    gap: 2px;
    font-size: 10px;
    font-weight: 700;
  }
  .wiz-mode-pill {
    padding: 2px 8px;
    border-radius: 999px;
    color: #475569;
    white-space: nowrap;
  }
  .wiz-mode-pill.on {
    background: #4D6BFE;
    color: #FFFFFF;
    box-shadow: 0 1px 4px rgba(77, 107, 254, 0.3);
  }
  .wiz-grid {
    display: grid;
    grid-template-columns: 1.05fr 1.35fr auto;
    gap: 8px;
    align-items: stretch;
  }
  .wiz-box {
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 8px;
    padding: 6px 9px;
    font-size: 10.3px;
    line-height: 1.45;
    color: #1E293B;
    min-width: 0;
  }

  /* v0.21.0 Horizontal Workflow Tree Stage (60FPS Pan/Zoom Viewport) */
  .v21-canvas-card {
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
  .v21-canvas-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 11px;
    border-bottom: 1px solid #E2E8F0;
    background: #F8FAFC;
    white-space: nowrap;
  }
  .v21-panzoom-stage {
    flex: 1;
    min-height: 0;
    position: relative;
    background-color: #F8FAFC;
    background-image: radial-gradient(#CBD5E1 1px, transparent 1px);
    background-size: 15px 15px;
    display: flex;
    align-items: center;
    padding: 10px 14px;
    overflow: hidden;
  }
  .v21-h-tree {
    display: flex;
    flex-direction: row;
    align-items: center;
    width: 100%;
    gap: 0;
  }
  .v21-root-card {
    width: 176px;
    flex-shrink: 0;
    background: linear-gradient(180deg, #EFF6FF 0%, #FFFFFF 75%);
    border: 2px solid #3B82F6;
    border-radius: 10px;
    padding: 9px 10px;
    position: relative;
    box-shadow: 0 4px 14px rgba(59, 130, 246, 0.14);
  }
  .v21-waves-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }
  .v21-wave-lane {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0;
    min-width: 0;
  }
  .v21-wave-hub {
    width: 172px;
    flex-shrink: 0;
    background: #FFFFFF;
    border: 1.5px solid #CBD5E1;
    border-radius: 9px;
    padding: 6.5px 9px;
    position: relative;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
  }
  .v21-wave-hub.active {
    border-color: #3B82F6;
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.08) 0%, #FFFFFF 80%);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16);
  }
  .v21-children-row {
    display: flex;
    flex-direction: row;
    gap: 8px;
    flex: 1;
    min-width: 0;
    align-items: stretch;
  }
  .v21-worker-card {
    flex: 1;
    min-width: 0;
    background: #FFFFFF;
    border: 1.5px solid #E2E8F0;
    border-radius: 9px;
    padding: 6px 8px;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 3.5px;
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.03);
  }
  .v21-worker-card.p0 {
    border-color: rgba(239, 68, 68, 0.55);
    background: linear-gradient(180deg, rgba(254, 242, 242, 0.85) 0%, #FFFFFF 70%);
  }
  .v21-worker-card.selected {
    border-color: #2563EB;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
    background: linear-gradient(180deg, rgba(239, 246, 255, 0.95) 0%, #FFFFFF 75%);
  }
  .v21-trio-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .v21-mini-stat {
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 9px;
    padding: 7px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .v21-inline-input {
    width: 100%;
    border: 1px solid #93C5FD;
    background: #FFFFFF;
    border-radius: 6px;
    padding: 4px 7px;
    font-size: 10.3px;
    color: #0F172A;
    font-family: inherit;
  }
  .v21-swimlane-row {
    display: grid;
    grid-template-columns: 186px minmax(0, 1fr) 82px;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 8px;
    border: 1px solid #E2E8F0;
    background: #FFFFFF;
  }
`

function renderWorkbenchShell({ activeGroup, activeTab, bodyHtml, chatHtml, modeLabel = '🔧 专家视图' }) {
  const groups = [
    ['overview', '总览'],
    ['assets', '架构'],
    ['results', '质量'],
    ['report', '报告'],
    ['resources', '集群'],
  ]
  const subTabsByGroup = {
    overview: [['overview', '全局总览']],
    assets: [['assets', '模块与分片锁']],
    results: [['findings', '代码审查与缺陷'], ['scores', '交付里程碑']],
    report: [['report', '研发交付报告']],
    resources: [
      ['agents', '智能体与并发'],
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
  <style>${SHELL_CSS}</style>
</head>
<body>
  <div class="wb-window">
    <div class="wb-titlebar">
      <div class="wb-traffic"><span class="c-red"></span><span class="c-amber"></span><span class="c-green"></span></div>
      <div class="wb-brand">
        <span class="wb-brand-logo">L</span>
        <span>DSH Desktop · LMTAgent Closed-Loop Software Engineering Cluster</span>
      </div>
      <span class="wb-pill">lmtex · 1 Plan + N Workers</span>
      <span class="wb-pill wb-pill-pg">ShardLock 120s 租约 · PG 16 Digest -86%</span>
      <span class="wb-pill">SSE 实时流 · maxDepth: 3</span>
      <div style="flex:1"></div>
      <span style="font-size:11px;color:#94A3B8;font-family:monospace">ECCVIK/LMTAgent · v0.21.0</span>
    </div>

    <div class="wb-workspace">
      <div class="wb-sidebar">
        <div class="wb-side-sec">DSH 研发工作空间 (SSE 实时流)</div>
        <div class="wb-side-item active"><span class="wb-side-dot"></span>LMTAgent v0.21.0 研发集群</div>
        <div class="wb-side-item"><span>✨</span>WishRefiner 许愿润色向导</div>
        <div class="wb-side-item"><span>🔒</span>ShardLock 文件排他锁引擎</div>
        <div class="wb-side-item" style="background:rgba(77,107,254,0.1);color:#2563EB;font-weight:700"><span>⚡</span>LMTAgent 研发控制台</div>

        <div class="wb-side-sec" style="margin-top:3px">8 角色 gstack 闭环协同流</div>
        <div class="wb-side-item active"><span class="wb-side-dot"></span>⓪ plan · Captain 闭环主控</div>
        <div class="wb-side-item"><span>①</span>recon · CEO 需求润色</div>
        <div class="wb-side-item"><span>②</span>designer · 双模式交互</div>
        <div class="wb-side-item"><span>③</span>assess · 分片锁切分</div>
        <div class="wb-side-item"><span>④</span>vuln-scan · 架构审查</div>
        <div class="wb-side-item active"><span class="wb-side-dot"></span>⑤ exploit · 6+2 并发构建</div>
        <div class="wb-side-item"><span>⑥</span>qa · 20 套件回归门禁</div>
        <div class="wb-side-item"><span>⑦</span>internal · 文稿墙 &amp; 飞书</div>

        <div style="flex:1"></div>

        <div class="wb-pg-probe">
          <div class="wb-pg-probe-head">
            <span style="font-weight:700;font-size:10.2px;color:#0F172A">⚡ PG 写表与摘要压缩探针</span>
            <span style="font-family:monospace;font-size:8.5px;color:#64748B">SSE Live</span>
          </div>
          <div class="wb-pg-live-badge">● 节省 31.2K tok (-86%) · 0.4ms</div>

          <div class="wb-pg-row">
            <span class="wb-pg-tbl">plan_goals</span>
            <span class="wb-pg-op ins">DECOMP</span>
            <span class="wb-pg-lat">4 Goals</span>
          </div>
          <div class="wb-pg-row">
            <span class="wb-pg-tbl">shard_locks</span>
            <span class="wb-pg-op lck">LOCK×6</span>
            <span class="wb-pg-lat">0 冲突</span>
          </div>
          <div class="wb-pg-row">
            <span class="wb-pg-tbl">worker_tasks</span>
            <span class="wb-pg-op upd">P0..P3</span>
            <span class="wb-pg-lat">6+2 槽</span>
          </div>
          <div class="wb-pg-row">
            <span class="wb-pg-tbl">worker_digests</span>
            <span class="wb-pg-op dig">-86%</span>
            <span class="wb-pg-lat">590 tok</span>
          </div>
        </div>
      </div>

      <div class="wb-chat">
        <div class="wb-chat-head">
          <span>💬 主会话 · Captain 许愿拆解与审批</span>
          <span class="rt-hbtn on" style="font-size:10.5px;padding:2px 7px">⚡ 控制台</span>
        </div>
        <div class="wb-chat-body">
          ${chatHtml}
        </div>
      </div>

      <div class="rt-dock" data-open="1">
        <div class="rt-head" style="padding:8px 11px;gap:6px">
          <div class="rt-title" style="font-size:13px"><span class="rt-dot"></span>LMTAgent 研发控制台</div>
          <span class="rt-tag rt-tag-live">SSE 实时流</span>
          <div class="wiz-mode-switch">
            <span class="wiz-mode-pill${modeLabel.includes('新手') ? ' on' : ''}">🌱 新手简洁</span>
            <span class="wiz-mode-pill${modeLabel.includes('专家') ? ' on' : ''}">🔧 专家视图</span>
          </div>
          <div class="rt-spacer"></div>
          <span class="rt-tag" style="font-family:monospace;font-weight:700;color:#2563EB">v0.21.0</span>
          <button class="rt-btn" style="padding:2px 8px;font-size:11px">并发 6/12</button>
          <button class="rt-btn rt-exit-full" style="padding:2px 8px;font-size:11px">✕ 退出全屏 (Esc)</button>
        </div>

        <div class="rt-tabs rt-tabs-groups" style="padding:5px 11px 0">
          ${groups.map(([k, label]) => `<div class="rt-tab rt-tab-group${k === activeGroup ? ' on' : ''}">${label}</div>`).join('')}
        </div>
        ${subTabs.length > 1 || activeGroup !== 'overview' ? `<div class="rt-tabs rt-tabs-sub" style="padding:2px 11px 0">
          ${subTabs.map(([k, label]) => `<div class="rt-tab${k === activeTab ? ' on' : ''}" style="padding:4px 10px;font-size:11.8px">${label}</div>`).join('')}
        </div>` : ''}

        <div class="rt-body">
          ${bodyHtml}
        </div>

        <div class="rt-foot" style="padding:4px 11px;font-size:10.5px">
          <span class="rt-wb-badge">LMTAgent v0.21.0 · WishRefiner + ShardLock + SSE</span>
          <div class="rt-spacer"></div>
          <span>.jsonl 增量尾读 · tokenMeter 已接入</span>
          <span>20 Suites PASS · 零假数据契约</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`
}

const DEFAULT_CHAT_HTML = `
  <div class="wb-msg-user">
    我想给团队做一个带分片防冲突锁、实时工作流画布和飞书自动战报推送的研发控制台，请先帮我润色需求并拆解目标派发子代理！
  </div>
  <div class="wb-msg-agent">
    <div class="wb-msg-agent-head">
      <span class="rt-dot"></span>
      <span>Captain (plan) · Step 0 许愿润色完成</span>
      <span class="rt-tag rt-tag-live" style="margin-left:auto">1 Plan + 6 Workers</span>
    </div>
    <div>已通过 <b>WishRefinerWizard</b> 消除模糊表述，拆解为 4 个阶段目标与 6 个文件无交集分片，并登记 <code>shard_locks</code>（120s 租约自动续期）：</div>
    <div class="wb-tool-call"><span><b>refineAndDecomposeWish</b>(goals=4)</span><span style="color:#2563EB;font-weight:700">✓ 已立项</span></div>
    <div class="wb-tool-call"><span><b>shard_lock.acquire</b>(shards=6, ttl=120s)</span><span style="color:#059669;font-weight:700">🔒 0 冲突</span></div>
    <div class="wb-tool-call"><span><b>subagent_spawn</b>(depth="1..3", think="low")</span><span style="color:#0284C7;font-weight:700">↳ 6+2 槽</span></div>
  </div>
  <div class="wb-msg-agent">
    <div class="wb-msg-agent-head">
      <span class="rt-dot" style="background:#10B981"></span>
      <span>Worker 摘要压缩回传 &amp; Plan 闭环审批</span>
      <span class="rt-tag rt-tag-passive" style="margin-left:auto">-86% Digest</span>
    </div>
    <div style="font-size:10.3px;color:#475569;line-height:1.48">
      · <b>Worker #1 (#ui-canvas)</b> 已提交压缩摘要（<code>4,280 → 590 tok</code>），处于 <b style="color:#DC2626">P0 焦点审批</b><br/>
      · 支持在右侧抽屉原位 <b>编辑目标</b>、<b>重跑该分片</b> 或输入 <code>nextGoal</code> <b>审批通过并下达新目标</b><br/>
      · <b>GET /redteam/events</b> SSE 实时推送画布变更，零轮询闪烁。
    </div>
  </div>
`

// 1. Shot 1: Overview Tab — Collapsible WishRefinerWizard + Full-Screen 60FPS Horizontal Workflow Tree
const overviewBody = `
  <div style="padding:9px 11px;display:flex;flex-direction:column;gap:8px;height:100%;overflow:hidden;background:#F8FAFC">
    <!-- Step 0: Collapsible WishRefinerWizard -->
    <div class="rt-wish-wizard">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:13px">✨</span>
          <span style="font-weight:800;font-size:12px;color:#0F172A">Step 0 · 许愿润色与目标拆解向导 (WishRefinerWizard)</span>
          <span class="rt-tag rt-tag-live">空白态零假数据 · 真实立项驱动</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <div class="wiz-mode-switch">
            <span class="wiz-mode-pill">🌱 新手简洁</span>
            <span class="wiz-mode-pill on">🔧 专家视图</span>
          </div>
          <button class="rt-btn" style="padding:2px 7px;font-size:10.5px">收起向导 ▲</button>
        </div>
      </div>

      <div class="wiz-grid">
        <div class="wiz-box">
          <div style="font-weight:700;color:#475569;font-size:9.8px;margin-bottom:3px">🗣️ 原始自然语言许愿 (Raw Wish)</div>
          <div style="color:#0F172A">“帮我升级多智能体工作台：加上防改乱文件的排他锁、横向派生工作流树、单分片重跑和飞书交付通知。”</div>
        </div>
        <div class="wiz-box" style="border-color:rgba(77,107,254,0.35);background:#F8FAFF">
          <div style="display:flex;justify-content:space-between;font-weight:700;color:#2563EB;font-size:9.8px;margin-bottom:3px">
            <span>🎯 AI 润色契约与无交集分片拆解 (4 Goals · 6 Shards)</span>
            <span>0 路径重叠 ✓</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px">
            <span class="rt-worker-tag-pill">#ui-canvas · styles/client 模块化</span>
            <span class="rt-worker-tag-pill">#pg-store · shard_locks 120s 租约</span>
            <span class="rt-worker-tag-pill">#sse-events · .jsonl 增量尾读</span>
            <span class="rt-worker-tag-pill">#qa-gate · 20 Suites 门禁 &amp; 飞书</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;justify-content:center;gap:5px">
          <button class="rt-btn rt-btn-primary" style="padding:6px 11px;font-size:11px;font-weight:700">✨ 润色并拆解派发</button>
          <span style="font-size:9.5px;color:#059669;text-align:center;font-weight:600">✓ 已写入 plan_goals</span>
        </div>
      </div>
    </div>

    <!-- Main Full-Screen 60FPS Horizontal Left-to-Right Workflow Tree -->
    <div class="v21-canvas-card">
      <div class="v21-canvas-bar">
        <span class="rt-dot"></span>
        <span style="font-weight:800;font-size:11.8px;color:#0F172A">工作流派生树画布 (HarnessWorkflowDeck · 60FPS GPU 零重绘拖拽)</span>
        <span class="rt-tree-wave-card-badge">➔ 横向向右派生</span>
        <button class="rt-btn rt-tree-layout-setting" style="padding:2px 8px;font-size:10.5px;font-weight:600;border-color:#93C5FD;color:#2563EB">⚙️ 树布局设置</button>
        <div class="rt-spacer"></div>
        <span style="font-size:10px;color:#64748B;font-family:monospace">ResizeObserver 精准连线 · 缩放 100%</span>
        <button class="rt-btn" style="padding:2px 7px;font-size:10px">适应视口</button>
      </div>

      <div class="v21-panzoom-stage">
        <div class="v21-h-tree">
          <!-- Level 0 Root: Captain Plan -->
          <div class="v21-root-card">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
              <span class="rt-pri-badge rt-pri-badge-p1">Level 0 · 主控</span>
              <span style="font-size:10px;color:#059669;font-weight:700">● 闭环调度中</span>
            </div>
            <div style="font-weight:800;font-size:12px;color:#0F172A">⓪ Captain (plan)</div>
            <div style="font-size:10px;color:#475569;margin-top:3px;line-height:1.4">
              1 Plan + 6 Workers<br/>
              递归深度 <code>maxDepth: 3</code>
            </div>
            <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">
              <span class="rt-digest-pill">📦 省 31.2K tok</span>
            </div>
            <span class="rt-n8n-diamond-pin-right"></span>
          </div>

          <!-- Dynamic ResizeObserver Cubic Bezier Fanout SVG -->
          <svg class="rt-h-root-fanout-svg" width="54" height="390" viewBox="0 0 54 390" style="width:54px;height:390px">
            <path d="M 0 195 C 27 195, 27 42, 54 42" fill="none" stroke="#3B82F6" stroke-width="2" />
            <path d="M 0 195 C 27 195, 27 132, 54 132" fill="none" stroke="#3B82F6" stroke-width="2" />
            <path d="M 0 195 C 27 195, 27 242, 54 242" fill="none" stroke="#2563EB" stroke-width="2.5" stroke-dasharray="5 3" />
            <path d="M 0 195 C 27 195, 27 348, 54 348" fill="none" stroke="#94A3B8" stroke-width="1.8" stroke-dasharray="3 3" />
          </svg>

          <!-- 4 Horizontal Waves Stack -->
          <div class="v21-waves-col">
            <!-- Wave 1 -->
            <div class="v21-wave-lane">
              <div class="v21-wave-hub">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span class="rt-tree-wave-card-badge">Wave 1 · 立项</span>
                  <span style="font-size:9.5px;color:#059669;font-weight:700">2/2 完成 ✓</span>
                </div>
                <div style="font-weight:700;font-size:10.8px;color:#0F172A;margin-top:3px">需求与双模式交互规范</div>
                <span class="rt-n8n-diamond-pin-right"></span>
              </div>
              <svg class="rt-h-wave-branch-line" width="28" height="24" viewBox="0 0 28 24" style="width:28px;height:24px"><path d="M0 12 L28 12" stroke="#3B82F6" stroke-width="2" fill="none"/></svg>
              <div class="v21-children-row">
                <div class="v21-worker-card">
                  <span class="rt-n8n-port-left"></span>
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <b style="font-size:10.5px;color:#0F172A">① CEO (recon)</b>
                    <span class="rt-pri-badge rt-pri-badge-p2">P2 已审归档</span>
                  </div>
                  <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
                    <span class="rt-worker-tag-pill">#prd-spec</span>
                    <span class="rt-digest-pill">📦 -85% Digest</span>
                  </div>
                </div>
                <div class="v21-worker-card">
                  <span class="rt-n8n-port-left"></span>
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <b style="font-size:10.5px;color:#0F172A">② Designer</b>
                    <span class="rt-pri-badge rt-pri-badge-p2">P2 已审归档</span>
                  </div>
                  <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
                    <span class="rt-worker-tag-pill">#ui-canvas</span>
                    <span class="rt-digest-pill">📦 -84% Digest</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Wave 2 -->
            <div class="v21-wave-lane">
              <div class="v21-wave-hub">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span class="rt-tree-wave-card-badge">Wave 2 · 架构</span>
                  <span style="font-size:9.5px;color:#059669;font-weight:700">1/1 完成 ✓</span>
                </div>
                <div style="font-weight:700;font-size:10.8px;color:#0F172A;margin-top:3px">ShardLock 6 分片排他契约</div>
                <span class="rt-n8n-diamond-pin-right"></span>
              </div>
              <svg class="rt-h-wave-branch-line" width="28" height="24" viewBox="0 0 28 24" style="width:28px;height:24px"><path d="M0 12 L28 12" stroke="#3B82F6" stroke-width="2" fill="none"/></svg>
              <div class="v21-children-row">
                <div class="v21-worker-card">
                  <span class="rt-n8n-port-left"></span>
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <b style="font-size:10.5px;color:#0F172A">③ Eng Manager (assess) · 无交集文件所有权矩阵</b>
                    <span class="rt-pri-badge rt-pri-badge-p2">P2 已审归档</span>
                  </div>
                  <div style="display:flex;gap:5px;align-items:center">
                    <span class="rt-worker-tag-pill">#pg-store</span>
                    <span class="rt-worker-tag-pill">#shard-lock</span>
                    <span class="rt-digest-pill">📦 -88% (3.8K→450 tok)</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Wave 3 (Expanded Active Horizontal Derivation) -->
            <div class="v21-wave-lane">
              <div class="v21-wave-hub active">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span class="rt-tree-wave-card-badge">Wave 3 · 构建</span>
                  <span style="font-size:9.5px;color:#2563EB;font-weight:800">展开 6+2 槽 ▾</span>
                </div>
                <div style="font-weight:800;font-size:10.8px;color:#0F172A;margin-top:3px">Builder 并发分片 + 递归子代理</div>
                <div style="font-size:9.3px;color:#0284C7;margin-top:2px">🔒 6 排他锁活跃 · 1 待 Plan 审批</div>
                <span class="rt-n8n-diamond-pin-right"></span>
              </div>
              <svg class="rt-h-wave-branch-line" width="28" height="40" viewBox="0 0 28 40" style="width:28px;height:40px"><path d="M0 20 L28 20" stroke="#2563EB" stroke-width="2.4" fill="none"/></svg>
              <div class="v21-children-row">
                <div class="v21-worker-card p0">
                  <span class="rt-n8n-port-left"></span>
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:3px">
                    <b style="font-size:10.3px;color:#0F172A">⑤ Worker #1 · UI</b>
                    <span class="rt-pri-badge rt-pri-badge-p0">P0 焦点审批</span>
                  </div>
                  <div style="font-size:9.4px;color:#475569">模块化 src/ + 动态连线</div>
                  <div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:1px">
                    <span class="rt-worker-tag-pill">#ui-canvas</span>
                    <span class="rt-digest-pill">📦 -86%</span>
                  </div>
                </div>
                <div class="v21-worker-card selected">
                  <span class="rt-n8n-port-left"></span>
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:3px">
                    <b style="font-size:10.3px;color:#0F172A">⑤ Worker #2 · PG</b>
                    <span class="rt-pri-badge rt-pri-badge-p1">P1 核心并发</span>
                  </div>
                  <div style="font-size:9.4px;color:#0284C7;font-weight:600">↳ Sub #2a (depth:1, low)</div>
                  <div style="display:flex;gap:3px;flex-wrap:wrap;margin-top:1px">
                    <span class="rt-worker-tag-pill">#pg-store</span>
                    <span class="rt-digest-pill">🔒 112s</span>
                  </div>
                </div>
                <div class="v21-worker-card" style="flex:0.78;background:#F8FAFC;border-style:dashed">
                  <span class="rt-n8n-port-left"></span>
                  <div style="font-weight:700;font-size:10px;color:#334155">+4 并发分片胶囊</div>
                  <div style="font-size:9.2px;color:#64748B">Worker #3..#6 独占推进</div>
                  <div style="display:flex;gap:3px;flex-wrap:wrap">
                    <span class="rt-pri-badge rt-pri-badge-p1">P1×3</span>
                    <span class="rt-pri-badge rt-pri-badge-p3">P3×1</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Wave 4 -->
            <div class="v21-wave-lane">
              <div class="v21-wave-hub">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span class="rt-tree-wave-card-badge">Wave 4 · 门禁</span>
                  <span style="font-size:9.5px;color:#475569;font-weight:700">20 Suites 候命</span>
                </div>
                <div style="font-weight:700;font-size:10.8px;color:#0F172A;margin-top:3px">QA 全量回归与飞书战报</div>
                <span class="rt-n8n-diamond-pin-right"></span>
              </div>
              <svg class="rt-h-wave-branch-line" width="28" height="24" viewBox="0 0 28 24" style="width:28px;height:24px"><path d="M0 12 L28 12" stroke="#94A3B8" stroke-width="1.8" stroke-dasharray="3 3" fill="none"/></svg>
              <div class="v21-children-row">
                <div class="v21-worker-card">
                  <span class="rt-n8n-port-left"></span>
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <b style="font-size:10.5px;color:#0F172A">⑥ QA Lead (qa)</b>
                    <span class="rt-pri-badge rt-pri-badge-p1">P1 核心并发</span>
                  </div>
                  <div style="display:flex;gap:4px;align-items:center">
                    <span class="rt-worker-tag-pill">#qa-gate</span>
                    <span style="font-size:9.5px;color:#059669;font-weight:700">20 Suites PASS</span>
                  </div>
                </div>
                <div class="v21-worker-card">
                  <span class="rt-n8n-port-left"></span>
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <b style="font-size:10.5px;color:#0F172A">⑦ Release · 文稿墙</b>
                    <span class="rt-pri-badge rt-pri-badge-p3">P3 历史快照</span>
                  </div>
                  <div style="display:flex;gap:4px;align-items:center">
                    <span class="rt-worker-tag-pill">#feishu-hook</span>
                    <span style="font-size:9.5px;color:#2563EB;font-weight:600">Webhook 就绪</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Analytics Trio Strip -->
    <div class="v21-trio-strip">
      <div class="v21-mini-stat">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b style="font-size:10.8px;color:#0F172A">📊 Token 遥测 (tokenMeter + 尾读)</b>
          <span class="rt-tag rt-tag-live" style="font-size:9px">命中 98.1%</span>
        </div>
        <div style="font-size:10px;color:#475569">当前会话 <b style="color:#2563EB">38.4K tok</b> · .jsonl 字节偏移增量扫描</div>
      </div>
      <div class="v21-mini-stat">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b style="font-size:10.8px;color:#0F172A">⏱️ 并发槽与 120s 租约守护</b>
          <span class="rt-tag rt-tag-active" style="font-size:9px">6 / 12 槽活跃</span>
        </div>
        <div style="font-size:10px;color:#475569">递归子代理 <b style="color:#0284C7">depth ≤ 3</b> · 超时僵尸锁自动回收</div>
      </div>
      <div class="v21-mini-stat">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b style="font-size:10.8px;color:#0F172A">🐘 PG 16 写表与 Digest 压缩探针</b>
          <span class="rt-digest-pill">-86% 压缩</span>
        </div>
        <div style="font-size:10px;color:#475569">累计节省 <b style="color:#059669">31.2K tok</b> · <code>shard_locks</code> 0 写冲突</div>
      </div>
    </div>
  </div>
`

// 2. Shot 2: Expanded Wave 3 Horizontal Derivation + Two-Step Node Inspector Drawer + Full-Width P0->P3 Swimlanes
const agentsBody = `
  <div style="padding:8px 11px;display:flex;flex-direction:column;gap:8px;height:100%;overflow:hidden;background:#F8FAFC">
    <!-- Top Concurrency, Layout & Lease Toolbar -->
    <div style="display:flex;align-items:center;gap:6px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:9px;padding:6px 10px;white-space:nowrap">
      <span style="font-weight:800;font-size:11.2px;color:#0F172A">并发槽 6/12</span>
      <span class="rt-tag rt-tag-live">120s 租约自动回收</span>
      <span class="rt-tag rt-tag-active">maxDepth: 3 · thinking: low ✓</span>
      <span class="rt-tree-wave-card-badge">➔ 横向向右派生 · Wave 3 已展开</span>
      <div class="rt-spacer"></div>
      <button class="rt-btn rt-tree-layout-setting" style="padding:2px 8px;font-size:10.5px">⚙️ 树布局设置</button>
    </div>

    <!-- Upper Expanded Wave 3 Horizontal Derivation Strip -->
    <div style="background:#FFFFFF;border:1px solid #CBD5E1;border-radius:10px;padding:9px 12px;background-image:radial-gradient(#E2E8F0 1px, transparent 1px);background-size:14px 14px">
      <div style="display:flex;align-items:center;gap:0">
        <div class="v21-wave-hub active" style="width:168px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="rt-tree-wave-card-badge">Wave 3 · 展开</span>
            <span style="font-size:9.5px;color:#2563EB;font-weight:700">6+2 分片</span>
          </div>
          <div style="font-weight:800;font-size:11px;color:#0F172A;margin-top:3px">Builder 并发编码波次</div>
          <div style="font-size:9.3px;color:#475569;margin-top:2px">点击任意分片在下方透视与审批</div>
          <span class="rt-n8n-diamond-pin-right"></span>
        </div>

        <svg class="rt-h-wave-branch-line" width="34" height="84" viewBox="0 0 34 84" style="width:34px;height:84px">
          <path d="M0 42 C17 42, 17 18, 34 18" fill="none" stroke="#2563EB" stroke-width="2.4" />
          <path d="M0 42 L34 42" fill="none" stroke="#0EA5E9" stroke-width="2" />
          <path d="M0 42 C17 42, 17 68, 34 68" fill="none" stroke="#10B981" stroke-width="2" />
        </svg>

        <div style="display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:8px;flex:1">
          <div class="v21-worker-card selected" style="padding:7px 9px">
            <span class="rt-n8n-port-left"></span>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b style="font-size:10.8px;color:#1D4ED8">⑤ Worker #1 · #ui-canvas</b>
              <span class="rt-pri-badge rt-pri-badge-p0">P0 焦点审批</span>
            </div>
            <div style="font-size:9.6px;color:#334155">已完成 src/ 模块化组装与动态贝塞尔连线</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
              <span class="rt-digest-pill">📦 -86% (4.2K→590 tok)</span>
              <span style="font-size:9.2px;color:#2563EB;font-weight:700">▼ 当前检视中</span>
            </div>
          </div>

          <div class="v21-worker-card" style="padding:7px 9px">
            <span class="rt-n8n-port-left"></span>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b style="font-size:10.8px;color:#0F172A">⑤ Worker #2 · #pg-store</b>
              <span class="rt-pri-badge rt-pri-badge-p1">P1 核心并发</span>
            </div>
            <div style="font-size:9.6px;color:#0284C7;font-weight:600">↳ 派生 Sub-Worker #2a (depth:1 · low)</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
              <span class="rt-worker-tag-pill">🔒 shard_locks (108s)</span>
              <span style="font-size:9.2px;color:#059669;font-weight:700">● 编码中</span>
            </div>
          </div>

          <div class="v21-worker-card" style="padding:7px 9px">
            <span class="rt-n8n-port-left"></span>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <b style="font-size:10.8px;color:#0F172A">⑤ Worker #3 · #sse-stream</b>
              <span class="rt-pri-badge rt-pri-badge-p2">P2 已审归档</span>
            </div>
            <div style="font-size:9.6px;color:#334155">GET /redteam/events + .jsonl 增量尾读</div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
              <span class="rt-digest-pill">📦 -87% 已归档</span>
              <span style="font-size:9.2px;color:#059669;font-weight:700">✓ Plan 已审</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Middle Full-Width Two-Step Node Inspector Drawer -->
    <div class="rt-agent-inspector-drawer" style="padding:10px 12px;gap:8px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;white-space:nowrap">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:13px">🔎</span>
          <b style="font-size:12px;color:#0F172A">两步式节点透视与闭环审批抽屉 · ⑤ Worker #1 (exploit#1)</b>
          <span class="rt-pri-badge rt-pri-badge-p0">P0 焦点审批</span>
          <span class="rt-worker-tag-pill">🔒 独占 packages/redteam-ui/src/*</span>
        </div>
        <button class="rt-jump-chat-btn" style="padding:4px 10px;font-size:11px">💬 跳转侧边聊天框打开该 Agent 会话 ↗</button>
      </div>

      <div style="display:grid;grid-template-columns:1.05fr 1.05fr 1.25fr;gap:8px;align-items:stretch">
        <!-- Col 1: Edit Goal & Retry Shard -->
        <div style="background:#FFFFFF;border:1px solid #CBD5E1;border-radius:8px;padding:7px 9px;display:flex;flex-direction:column;justify-content:space-between;gap:5px">
          <div>
            <div style="font-weight:700;font-size:10px;color:#2563EB;margin-bottom:3px">📥 委派目标 (支持原位改写单点重跑)</div>
            <div style="font-size:10.2px;color:#1E293B;line-height:1.42">拆分 styles/client 模块化源码目录，接入 ResizeObserver 动态计算水平贝塞尔锚点。</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="rt-btn" style="padding:3px 8px;font-size:10.5px;font-weight:700;color:#2563EB;border-color:#93C5FD">✏️ 编辑目标</button>
            <button class="rt-btn" style="padding:3px 8px;font-size:10.5px;font-weight:700;color:#B45309;border-color:#FCD34D;background:#FFFBEB">🔄 重跑该分片</button>
          </div>
        </div>

        <!-- Col 2: Compressed Worker Digest -->
        <div class="rt-digest-box" style="padding:7px 9px;gap:4px;justify-content:space-between">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <b style="font-size:10px;color:#065F46">📤 压缩摘要 (worker_digest)</b>
            <span class="rt-digest-pill">-86% · 省 3,690 tok</span>
          </div>
          <div style="font-size:10px;color:#1E293B;line-height:1.42">
            <b>what_was_done</b>: 完成 assemble-styles/client 零依赖组装器与全屏自适应边界<br/>
            <b>verification</b>: <code>ui-smoke.test.mjs</code> 100% 通过
          </div>
        </div>

        <!-- Col 3: Editable nextGoal + Plan Approve -->
        <div style="background:#F0FDF4;border:1px solid rgba(16,185,129,0.4);border-radius:8px;padding:7px 9px;display:flex;flex-direction:column;justify-content:space-between;gap:5px">
          <div style="font-weight:700;font-size:10px;color:#065F46">✅ 主控 Plan 验收并自定义下一目标 (nextGoal)</div>
          <input class="v21-inline-input" value="下一目标：联调 Wave 4 QA 冒烟八契约并生成闭环文稿墙" />
          <button class="rt-plan-approve-btn" style="width:100%;padding:4.5px 10px;font-size:11px">✓ Plan 审批通过并下达新目标</button>
        </div>
      </div>
    </div>

    <!-- Lower Full-Width P0 -> P3 3-Stage Swimlanes -->
    <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:10px;padding:8px 11px;display:flex;flex-direction:column;gap:5px;flex:1;min-height:0">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <span style="font-weight:800;font-size:11.2px;color:#0F172A">🏊 全宽跨 Agent 3 段式执行泳道（按 P0 → P1 → P2 → P3 优先级排序 · 零窄栏截断）</span>
        <span style="font-size:9.8px;color:#64748B">点击任意泳道同步切换上方探针抽屉</span>
      </div>

      <div class="v21-swimlane-row" style="border-color:rgba(239,68,68,0.35);background:#FEF2F2">
        <div style="display:flex;align-items:center;gap:5px;white-space:nowrap">
          <span class="rt-pri-badge rt-pri-badge-p0">P0</span>
          <b style="font-size:10.5px;color:#0F172A">⑤ Worker #1 (#ui-canvas)</b>
        </div>
        <div class="rt-step-chain" style="padding:0">
          <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 7px;font-size:9.8px"><b>委派目标</b><span>UI 模块化与动态连线</span></div><span class="rt-step-arrow">➔</span></div>
          <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 7px;font-size:9.8px"><b>核心执行</b><span>写入 4 个分片文件 (0 冲突)</span></div><span class="rt-step-arrow">➔</span></div>
          <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 7px;font-size:9.8px;border-color:#10B981"><b>阶段结论</b><span>待 Plan 审批 (-86% Digest)</span></div></div>
        </div>
        <span class="rt-digest-pill" style="justify-self:end">待审批 ⏳</span>
      </div>

      <div class="v21-swimlane-row">
        <div style="display:flex;align-items:center;gap:5px;white-space:nowrap">
          <span class="rt-pri-badge rt-pri-badge-p1">P1</span>
          <b style="font-size:10.5px;color:#0F172A">⑤ Worker #2 (#pg-store)</b>
        </div>
        <div class="rt-step-chain" style="padding:0">
          <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 7px;font-size:9.8px"><b>委派目标</b><span>ShardLock 排他锁与租约表</span></div><span class="rt-step-arrow">➔</span></div>
          <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 7px;font-size:9.8px;border-color:#3B82F6"><b>核心执行</b><span>递归派生 Sub #2a 压测中</span></div><span class="rt-step-arrow">➔</span></div>
          <div class="rt-step-node"><div class="rt-step-pill" style="padding:3px 7px;font-size:9.8px"><b>阶段结论</b><span>实时流式同步 (TTL 108s)</span></div></div>
        </div>
        <span class="rt-tag rt-tag-live" style="justify-self:end">运行中 ⚡</span>
      </div>

      <div class="v21-swimlane-row" style="opacity:0.94">
        <div style="display:flex;align-items:center;gap:5px;white-space:nowrap">
          <span class="rt-pri-badge rt-pri-badge-p2">P2</span>
          <b style="font-size:10.4px;color:#0F172A">③ Eng Manager (#shard-lock)</b>
        </div>
        <div class="rt-step-chain" style="padding:0">
          <div class="rt-step-node"><div class="rt-step-pill" style="padding:2.5px 7px;font-size:9.6px"><b>委派目标</b><span>6 分片无交集边界切分</span></div><span class="rt-step-arrow">➔</span></div>
          <div class="rt-step-node"><div class="rt-step-pill" style="padding:2.5px 7px;font-size:9.6px"><b>核心执行</b><span>登记 shard_locks 排他表</span></div><span class="rt-step-arrow">➔</span></div>
          <div class="rt-step-node"><div class="rt-step-pill" style="padding:2.5px 7px;font-size:9.6px"><b>阶段结论</b><span>Plan 已审批归档 (-88%)</span></div></div>
        </div>
        <span class="rt-pri-badge rt-pri-badge-p2" style="justify-self:end">已审归档 ✓</span>
      </div>

      <div class="v21-swimlane-row" style="opacity:0.86;background:#F8FAFC">
        <div style="display:flex;align-items:center;gap:5px;white-space:nowrap">
          <span class="rt-pri-badge rt-pri-badge-p3">P3</span>
          <b style="font-size:10.4px;color:#475569">① CEO / ② Designer (Wave 1)</b>
        </div>
        <div class="rt-step-chain" style="padding:0">
          <div class="rt-step-node"><div class="rt-step-pill" style="padding:2.5px 7px;font-size:9.6px"><b>委派目标</b><span>许愿润色与双模式规范</span></div><span class="rt-step-arrow">➔</span></div>
          <div class="rt-step-node"><div class="rt-step-pill" style="padding:2.5px 7px;font-size:9.6px"><b>核心执行</b><span>产出结构化 PRD 与令牌</span></div><span class="rt-step-arrow">➔</span></div>
          <div class="rt-step-node"><div class="rt-step-pill" style="padding:2.5px 7px;font-size:9.6px"><b>阶段结论</b><span>历史波次基线快照 (-85%)</span></div></div>
        </div>
        <span class="rt-pri-badge rt-pri-badge-p3" style="justify-self:end">历史快照</span>
      </div>
    </div>
  </div>
`

// 3. Shot 3: File-Disjoint ShardLock Ownership Matrix (shard_locks) + PostgreSQL 16 Live Write & Digest Compression Probe
const assetsBody = `
  <div class="rt-main">
    <div class="rt-toolbar" style="gap:6px;padding:7px 11px">
      <input class="rt-input" style="width:205px;font-family:monospace;font-size:11px" value="table:shard_locks,worker_digests" />
      <span class="rt-tag rt-tag-live">🔒 6 独占分片锁零冲突</span>
      <span class="rt-digest-pill">📦 -86% 摘要压缩 (省 31.2K tok)</span>
      <div class="rt-spacer"></div>
      <span class="rt-tag rt-tag-active">PG 16 Wire v3 · 0.4ms</span>
      <button class="rt-btn rt-btn-primary" style="padding:3px 9px;font-size:11px">+ 校验分片排他锁</button>
    </div>

    <div class="rt-split" style="flex:1;min-height:0">
      <!-- Left Pane: File-Disjoint ShardLock Ownership Matrix (shard_locks) -->
      <div class="rt-list" style="width:288px">
        <div class="rt-section">🔒 ShardLock 文件独占所有权矩阵 (shard_locks)</div>
        <div class="rt-item on">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #1 · store/pg-engine</span>
            <span class="rt-tag rt-tag-live">TTL 114s</span>
          </div>
          <div class="rt-item-desc">Owner: <code>worker#1</code> · 独占 <code>packages/redteam-store/**</code></div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #2 · tools/workflow</span>
            <span class="rt-tag rt-tag-live">TTL 109s</span>
          </div>
          <div class="rt-item-desc">Owner: <code>worker#2</code> · 独占 <code>packages/redteam-tools/**</code></div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #3 · ui/host-bridge</span>
            <span class="rt-tag rt-tag-live">TTL 116s</span>
          </div>
          <div class="rt-item-desc">Owner: <code>worker#3</code> · 独占 <code>redteam-ui/lib/index.js</code></div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #4 · ui/src/styles</span>
            <span class="rt-tag rt-tag-active">已释放 ✓</span>
          </div>
          <div class="rt-item-desc">Owner: <code>worker#4</code> · 独占 <code>assemble-styles + styles/*</code></div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #5 · ui/src/client</span>
            <span class="rt-tag rt-tag-live">TTL 105s</span>
          </div>
          <div class="rt-item-desc">Owner: <code>worker#5</code> · 独占 <code>assemble-client + client/*</code></div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #6 · smoke &amp; docs</span>
            <span class="rt-tag rt-tag-live">TTL 118s</span>
          </div>
          <div class="rt-item-desc">Owner: <code>worker#6</code> · 独占 <code>ui-smoke + README + shots</code></div>
        </div>
      </div>

      <!-- Right Pane: PostgreSQL 16 Live Write & Digest Compression Probe -->
      <div class="rt-pane" style="padding:10px 12px;gap:9px;overflow:hidden">
        <!-- Compression & Fact Table KPI Row -->
        <div style="display:grid;grid-template-columns:repeat(4, minmax(0, 1fr));gap:7px">
          <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:8px;padding:7px 9px">
            <div style="font-size:9.5px;color:#64748B">plan_goals 阶段目标</div>
            <div style="font-size:14px;font-weight:800;color:#2563EB;margin-top:2px">4 Goals</div>
            <div style="font-size:9px;color:#059669">Step 0 润色立项</div>
          </div>
          <div style="background:#FFFFFF;border:1px solid #E2E8F0;border-radius:8px;padding:7px 9px">
            <div style="font-size:9.5px;color:#64748B">worker_tasks 任务流</div>
            <div style="font-size:14px;font-weight:800;color:#0284C7;margin-top:2px">6 + 2 递归</div>
            <div style="font-size:9px;color:#475569">P0×1 · P1×4 · P2×3</div>
          </div>
          <div style="background:#ECFDF5;border:1px solid rgba(16,185,129,0.38);border-radius:8px;padding:7px 9px">
            <div style="font-size:9.5px;color:#065F46;font-weight:700">worker_digests 压缩比</div>
            <div style="font-size:14px;font-weight:800;color:#059669;margin-top:2px">-86.2%</div>
            <div style="font-size:9px;color:#047857">36.2K → 5.0K tok</div>
          </div>
          <div style="background:#FFFBEB;border:1px solid rgba(245,158,11,0.38);border-radius:8px;padding:7px 9px">
            <div style="font-size:9.5px;color:#92400E;font-weight:700">shard_locks 冲突拦截</div>
            <div style="font-size:14px;font-weight:800;color:#B45309;margin-top:2px">0 越界写</div>
            <div style="font-size:9px;color:#B45309">120s 租约自动回收</div>
          </div>
        </div>

        <!-- Live Table Write Stream -->
        <div class="rt-card" style="margin:0;padding:9px 11px">
          <div style="display:flex;align-items:center;gap:7px;margin-bottom:7px">
            <span class="rt-tag rt-tag-live">● LIVE PROBE</span>
            <b style="font-size:11.8px;color:#0F172A">主题自适应 PostgreSQL 16 实时写表与摘要压缩事务流</b>
            <span class="rt-mono" style="margin-left:auto;font-size:10px;color:#059669;font-weight:700">SSE Push · 0 SQLITE_BUSY</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:4.5px;font-size:10.4px">
            <div class="rt-atest-row" style="padding:4.5px 8px">
              <span class="rt-mono" style="width:122px;font-weight:700;color:#2563EB">plan_goals</span>
              <span class="rt-tag rt-tag-live" style="width:76px;text-align:center">DECOMPOSE</span>
              <span style="flex:1;color:#334155"><code>WishRefiner</code> 拆解 4 阶段目标并绑定验收标准</span>
              <span class="rt-mono" style="color:#059669;font-weight:700">0.3ms</span>
            </div>
            <div class="rt-atest-row" style="padding:4.5px 8px;background:#FFFBEB;border-color:rgba(245,158,11,0.3)">
              <span class="rt-mono" style="width:122px;font-weight:700;color:#B45309">shard_locks</span>
              <span class="rt-tag rt-tag-active" style="width:76px;text-align:center">ACQUIRE</span>
              <span style="flex:1;color:#334155"><code>worker#1..#6</code> 锁定无交集文件集合（TTL=120s 心跳续期）</span>
              <span class="rt-mono" style="color:#059669;font-weight:700">0.2ms</span>
            </div>
            <div class="rt-atest-row" style="padding:4.5px 8px">
              <span class="rt-mono" style="width:122px;font-weight:700;color:#0284C7">worker_tasks</span>
              <span class="rt-tag rt-tag-live" style="width:76px;text-align:center">UPSERT</span>
              <span style="flex:1;color:#334155"><code>worker#1</code> 状态流转至 <b>P0 焦点审批</b>，递归树 <code>depth=1</code></span>
              <span class="rt-mono" style="color:#059669;font-weight:700">0.4ms</span>
            </div>
            <div class="rt-atest-row" style="padding:4.5px 8px;background:#ECFDF5;border-color:rgba(16,185,129,0.32)">
              <span class="rt-mono" style="width:122px;font-weight:700;color:#059669">worker_digests</span>
              <span class="rt-digest-pill" style="width:76px;justify-content:center">-86% ZIP</span>
              <span style="flex:1;color:#065F46">压缩轨迹 <code>4,280 → 590 tok</code>（what_was_done + verification）</span>
              <span class="rt-mono" style="color:#059669;font-weight:700">0.4ms</span>
            </div>
          </div>
        </div>

        <!-- Runtime ShardLock Contract Card -->
        <div class="rt-card" style="margin:0;padding:9px 11px">
          <h4 style="margin:0 0 6px;font-size:11.5px">🛡️ 运行时文件排他锁契约详情 · ShardLock Engine</h4>
          <div class="rt-kv"><b>跨分片冲突校验</b><span>任一 Worker 声明重叠路径立即触发 <code>SHARD_LOCK_CONFLICT</code> 拒绝抢跑，保障并行零踩踏</span></div>
          <div class="rt-kv"><b>120s 租约自动回收</b><span>子代理异常中断或超时未续约满 <code>120s</code>，自动释放并发槽位与文件排他锁</span></div>
          <div class="rt-kv"><b>双模存储无缝切换</b><span class="rt-mono">PostgreSQL 16 Wire v3 (GIN tsvector) ⇄ SQLite 256MB mmap WAL</span></div>
        </div>
      </div>
    </div>
  </div>
`

// 4. Shot 4: lmtex Closed-Loop Doc Wall (generated from worker_digests) + Real Feishu Webhook Delivery Card
const reportBody = `
  <div class="rt-main">
    <div class="rt-toolbar" style="gap:5px;padding:7px 11px;flex-wrap:nowrap;white-space:nowrap">
      <span style="font-weight:800;font-size:11.3px;color:#0F172A">📄 lmtex 闭环研发交付文稿墙 (worker_digests)</span>
      <span class="rt-digest-pill">📦 8 份摘要 (-86%)</span>
      <span class="rt-tag rt-tag-live">📨 飞书已送达 ✓</span>
      <div class="rt-spacer"></div>
      <button class="rt-btn" style="padding:2px 7px;font-size:10.2px">⚙️ feishuConfig</button>
      <button class="rt-btn" style="padding:2px 7px;font-size:10.2px">复制 MD</button>
      <button class="rt-btn rt-btn-primary" style="padding:2px 8px;font-size:10.2px">导出 HTML</button>
    </div>

    <div class="rt-split" style="flex:1;min-height:0">
      <!-- Left Master List: Closed-Loop Digests by Wave -->
      <div class="rt-list" style="width:248px">
        <div class="rt-section">闭环阶段目标与 Digest 产物 (8)</div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">⓪ WishRefiner 立项总纲</span>
            <span class="rt-pri-badge rt-pri-badge-p2">Plan</span>
          </div>
          <div class="rt-item-desc">原始许愿润色 + 4 阶段无冲突目标</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">① CEO 空白态零假数据契约</span>
            <span class="rt-digest-pill">-85%</span>
          </div>
          <div class="rt-item-desc">recon · 清除演示残留与双模式边界</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">③ ShardLock 6 分片所有权表</span>
            <span class="rt-digest-pill">-88%</span>
          </div>
          <div class="rt-item-desc">assess · 排他文件锁与 120s 租约</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">⑤ Builder 6 分片编码摘要</span>
            <span class="rt-digest-pill">-86%</span>
          </div>
          <div class="rt-item-desc">exploit#1..6 · 模块化 UI + SSE 流</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">⑥ QA 20 套件门禁验收单</span>
            <span class="rt-tag rt-tag-live">20 PASS</span>
          </div>
          <div class="rt-item-desc">qa · 含冒烟八与敏感词零命中校验</div>
        </div>
        <div class="rt-item on">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">⑦ v0.21.0 闭环交付总报告</span>
            <span class="rt-tag rt-tag-live">当前浏览</span>
          </div>
          <div class="rt-item-desc">internal 自动汇编 worker_digests</div>
        </div>
        <div class="rt-item" style="background:#ECFDF5;border-color:rgba(16,185,129,0.35)">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name" style="color:#047857">📨 飞书 Webhook 推送回执</span>
            <span class="rt-tag rt-tag-live">200 OK</span>
          </div>
          <div class="rt-item-desc" style="color:#065F46">签名校验通过 · 富文本卡片直达群聊</div>
        </div>
      </div>

      <!-- Right Detail Pane: Synthesized Digest Report + Real Feishu Webhook Card -->
      <div class="rt-pane" style="padding:10px 12px;gap:9px;overflow:hidden">
        <div class="rt-card" style="margin:0;padding:9px 12px;background:linear-gradient(135deg, rgba(77,107,254,0.08), rgba(16,185,129,0.05));border-color:rgba(77,107,254,0.3)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div>
              <div style="font-size:13px;font-weight:800;color:#0F172A">⑦ LMTAgent v0.21.0 全栈研发集群闭环交付总报告</div>
              <div style="font-size:10.5px;color:#475569;margin-top:2px">由 <code>internal</code> 聚合 <code>plan_goals + worker_digests</code> 自动生成 · 上下文累计压缩节省 31.2K Tokens (-86%)</div>
            </div>
            <span class="rt-wb-badge" style="font-size:10.5px;padding:4px 9px;white-space:nowrap">Plan 闭环签发 ✓</span>
          </div>
        </div>

        <div class="rt-card" style="margin:0;padding:9px 12px">
          <h4 style="margin:0 0 6px;font-size:11.5px">一、worker_digests 结构化交付核验清单</h4>
          <div style="display:flex;flex-direction:column;gap:4.5px;font-size:10.5px">
            <div class="rt-atest-row" style="padding:4.5px 8px">
              <span class="rt-pri-badge rt-pri-badge-p2">Goal 1</span>
              <span style="flex:1"><b>Step 0 许愿润色向导与双模式视图</b>（<code>WishRefinerWizard</code> + <code>🌱 新手简洁 / 🔧 专家视图</code> + 空白态零假数据）</span>
              <span class="rt-tag rt-tag-live">已验收</span>
            </div>
            <div class="rt-atest-row" style="padding:4.5px 8px">
              <span class="rt-pri-badge rt-pri-badge-p2">Goal 2</span>
              <span style="flex:1"><b>运行时 ShardLock 排他锁与 120s 租约回收</b>（防越界写冲突 + 递归子代理深度感知 + 僵尸槽位自动释放）</span>
              <span class="rt-tag rt-tag-live">已验收</span>
            </div>
            <div class="rt-atest-row" style="padding:4.5px 8px">
              <span class="rt-pri-badge rt-pri-badge-p2">Goal 3</span>
              <span style="flex:1"><b>动态 ResizeObserver 连线 + 原位编辑/单点重跑</b>（<code>updateWorkerGoal</code> / <code>retryWorkerTask</code> / <code>nextGoal</code>）</span>
              <span class="rt-tag rt-tag-live">已验收</span>
            </div>
            <div class="rt-atest-row" style="padding:4.5px 8px">
              <span class="rt-pri-badge rt-pri-badge-p2">Goal 4</span>
              <span style="flex:1"><b>前端 src/ 模块化组装 + .jsonl 增量尾读 + SSE 实时流</b>（<code>build.mjs --check</code> 同步 + 20 套件全绿）</span>
              <span class="rt-tag rt-tag-live">20/20 PASS</span>
            </div>
          </div>
        </div>

        <!-- Real Feishu Webhook Delivery Card -->
        <div class="rt-card" style="margin:0;padding:9px 12px;background:linear-gradient(135deg, #ECFDF5 0%, #F0F9FF 100%);border-color:rgba(16,185,129,0.42)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:6px;font-weight:800;font-size:11.5px;color:#065F46">
              <span>📨 飞书群聊机器人实时推送卡片 (Feishu Webhook Delivery · feishuConfig)</span>
            </div>
            <span class="rt-mono" style="font-size:10px;color:#059669;font-weight:700">HTTP 200 OK · StatusCode: 0 · 34ms</span>
          </div>
          <div class="rt-kv"><b>Webhook 端点</b><span class="rt-mono">https://open.feishu.cn/open-apis/bot/v2/hook/lmtagent-v0210-cluster (HMAC-SHA256 已签名)</span></div>
          <div class="rt-kv"><b>交互卡片载荷</b><span><code>msg_type: "interactive"</code> · 含 4 阶段目标达成率、Digest 压缩率 <b>-86%</b>、ShardLock 零冲突证明与 20 套件回归摘要</span></div>
          <div class="rt-kv"><b>一键重推与持久化</b><span>支持在控制台顶栏配置 <code>feishuConfig</code> 密钥并在文稿墙任意节点完成后自动/手动触发群聊战报推送</span></div>
        </div>
      </div>
    </div>
  </div>
`

const SHOTS = [
  {
    file: 'ui-overview-workbench.png',
    activeGroup: 'overview',
    activeTab: 'overview',
    bodyHtml: overviewBody,
    modeLabel: '🔧 专家视图',
  },
  {
    file: 'ui-agents-dag.png',
    activeGroup: 'resources',
    activeTab: 'agents',
    bodyHtml: agentsBody,
    modeLabel: '🔧 专家视图',
  },
  {
    file: 'ui-assets-pg.png',
    activeGroup: 'assets',
    activeTab: 'assets',
    bodyHtml: assetsBody,
    modeLabel: '🔧 专家视图',
  },
  {
    file: 'ui-report-v2.png',
    activeGroup: 'report',
    activeTab: 'report',
    bodyHtml: reportBody,
    modeLabel: '🌱 新手简洁',
  },
]

const chromiumBin = resolveChromiumBin()
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ui-shots-v021-'))

for (const shot of SHOTS) {
  const htmlPath = path.join(tmpDir, shot.file.replace(/\.png$/, '.html'))
  const outPath = path.join(OUT_DIR, shot.file)
  const html = renderWorkbenchShell({
    activeGroup: shot.activeGroup,
    activeTab: shot.activeTab,
    bodyHtml: shot.bodyHtml,
    chatHtml: DEFAULT_CHAT_HTML,
    modeLabel: shot.modeLabel,
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
