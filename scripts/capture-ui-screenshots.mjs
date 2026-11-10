#!/usr/bin/env node
/**
 * Generate 4 high-resolution (2x Retina) UI screenshots for README showcase
 * using the real STYLE_TEXT from packages/redteam-ui/lib/styles.js plus
 * self-contained Modular Bento & dsh-harness-one Visual DAG styles in SHELL_CSS.
 *
 * Output files:
 *   - docs/assets/ui-overview-workbench.png
 *   - docs/assets/ui-agents-dag.png
 *   - docs/assets/ui-assets-pg.png
 *   - docs/assets/ui-report-v2.png
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

const SHELL_CSS = `
  :root {
    --dsw-alias-bg-base: #F8FAFC;
    --dsw-alias-bg-layer-1: #FFFFFF;
    --dsw-alias-bg-layer-2: #F1F5F9;
    --dsw-alias-bg-layer-3: #E2E8F0;
    --dsw-alias-border-l1: #E2E8F0;
    --dsw-alias-line-primary: #CBD5E1;
    --dsw-alias-label-primary: #0F172A;
    --dsw-alias-label-secondary: #475569;
    --dsw-alias-label-tertiary: #64748B;
    --dsw-alias-brand-primary: #4D6BFE;
    --dsw-alias-brand-text: #2563EB;
    --dsw-alias-state-error-primary: #DC2626;
  }
  * { box-sizing: border-box; }
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
  .wb-window {
    width: 1440px;
    height: 900px;
    display: flex;
    flex-direction: column;
    background: #F8FAFC;
    overflow: hidden;
  }
  /* Top macOS/DSH Desktop Titlebar */
  .wb-titlebar {
    height: 40px;
    background: #0F172A;
    color: #F8FAFC;
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 10px;
    border-bottom: 1px solid #1E293B;
    flex-shrink: 0;
  }
  .wb-traffic { display: flex; gap: 7px; margin-right: 6px; }
  .wb-traffic span { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
  .wb-traffic .c-red { background: #EF4444; }
  .wb-traffic .c-amber { background: #F59E0B; }
  .wb-traffic .c-green { background: #10B981; }
  .wb-brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: -0.01em;
    color: #F8FAFC;
  }
  .wb-brand-logo {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    background: linear-gradient(135deg, #4D6BFE, #0EA5E9);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 800;
    color: #fff;
    box-shadow: 0 2px 8px rgba(77, 107, 254, 0.45);
  }
  .wb-pill {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(77, 107, 254, 0.18);
    color: #93C5FD;
    border: 1px solid rgba(77, 107, 254, 0.35);
    font-weight: 600;
  }
  .wb-pill-pg {
    background: rgba(14, 165, 233, 0.16);
    color: #7DD3FC;
    border-color: rgba(14, 165, 233, 0.35);
  }
  .wb-workspace {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  /* Left DSH Desktop Activity Rail + Session Sidebar */
  .wb-sidebar {
    width: 238px;
    background: #F1F5F9;
    border-right: 1px solid #E2E8F0;
    display: flex;
    flex-direction: column;
    padding: 10px 9px;
    gap: 4px;
    flex-shrink: 0;
  }
  .wb-side-sec {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748B;
    padding: 4px 8px 2px;
  }
  .wb-side-item {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5.5px 9px;
    border-radius: 7px;
    font-size: 12px;
    color: #334155;
    font-weight: 500;
    white-space: nowrap;
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

  /* p2: Bottom-Left PostgreSQL Write Activity Probe Widget */
  .wb-pg-probe {
    padding: 8px 9px;
    border-radius: 10px;
    background: #0F172A;
    border: 1px solid #1E293B;
    color: #E2E8F0;
    font-size: 10px;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.14);
  }
  .wb-pg-probe-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .wb-pg-probe-title {
    font-weight: 700;
    font-size: 10.8px;
    color: #F8FAFC;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .wb-pg-live-badge {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 9.2px;
    color: #34D399;
    background: rgba(16, 185, 129, 0.14);
    border: 1px solid rgba(16, 185, 129, 0.35);
    padding: 1px 6px;
    border-radius: 999px;
    font-weight: 600;
    margin-bottom: 5px;
    display: inline-block;
  }
  .wb-pg-row {
    display: grid;
    grid-template-columns: 48px 52px 1fr 25px;
    align-items: center;
    gap: 3px;
    padding: 2.5px 0;
    border-top: 1px solid rgba(148, 163, 184, 0.12);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 9px;
  }
  .wb-pg-tbl { color: #93C5FD; font-weight: 600; white-space: nowrap; }
  .wb-pg-op {
    font-size: 8.5px;
    padding: 0 3px;
    border-radius: 3px;
    text-align: center;
    font-weight: 700;
    white-space: nowrap;
  }
  .wb-pg-op.ins { background: rgba(77, 107, 254, 0.25); color: #93C5FD; }
  .wb-pg-op.upd { background: rgba(14, 165, 233, 0.25); color: #7DD3FC; }
  .wb-pg-op.spw { background: rgba(16, 185, 129, 0.24); color: #6EE7B7; }
  .wb-pg-op.ups { background: rgba(139, 92, 246, 0.25); color: #C4B5FD; }
  .wb-pg-role { color: #CBD5E1; font-size: 8.8px; white-space: nowrap; }
  .wb-pg-lat { color: #38BDF8; text-align: right; font-size: 8.8px; white-space: nowrap; }
  .wb-pg-bar {
    grid-column: 1 / -1;
    height: 2.5px;
    background: rgba(148, 163, 184, 0.15);
    border-radius: 2px;
    overflow: hidden;
    margin-top: 1px;
  }
  .wb-pg-bar > span {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #4D6BFE, #0EA5E9);
  }

  /* Center DSH Chat / Orchestration Stream */
  .wb-chat {
    width: 406px;
    background: #FFFFFF;
    border-right: 1px solid #E2E8F0;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .wb-chat-head {
    height: 44px;
    padding: 0 12px;
    border-bottom: 1px solid #E2E8F0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    color: #0F172A;
    white-space: nowrap;
  }
  .wb-chat-head .rt-icon-btn {
    width: auto !important;
    flex: 0 0 auto !important;
    padding: 4px 10px !important;
    font-size: 11.5px !important;
  }
  .wb-chat-body {
    flex: 1;
    padding: 12px 13px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 100%);
  }
  .wb-msg-user {
    align-self: flex-end;
    max-width: 94%;
    background: linear-gradient(135deg, #4D6BFE, #2563EB);
    color: #FFFFFF;
    padding: 9px 12px;
    border-radius: 12px 12px 2px 12px;
    font-size: 11.8px;
    line-height: 1.5;
    box-shadow: 0 4px 12px rgba(77, 107, 254, 0.22);
  }
  .wb-msg-agent {
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 11px;
    padding: 10px 12px;
    font-size: 11.2px;
    line-height: 1.55;
    color: #1E293B;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.03);
  }
  .wb-msg-agent-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    color: #0F172A;
    margin-bottom: 5px;
    font-size: 11.3px;
    white-space: nowrap;
  }
  .wb-tool-call {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 4.5px 8px;
    border-radius: 6px;
    background: #F8FAFC;
    border: 1px solid #E2E8F0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10px;
    color: #334155;
    margin-top: 4px;
    white-space: nowrap;
  }
  .wb-tool-call b { color: #2563EB; }

  /* Override .rt-dock so it fills the remaining 796px right pane cleanly */
  .rt-dock {
    position: relative !important;
    top: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 796px !important;
    height: 100% !important;
    flex: 1 !important;
  }
  .rt-toolbar {
    flex-wrap: nowrap !important;
    white-space: nowrap;
  }

  /* p4 Modular Bento Dashboard Styles (Shot 1) */
  .bento-wrap {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 9px;
    height: 100%;
    overflow: hidden;
    background: #F8FAFC;
  }
  .bento-card {
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 11px;
    padding: 10px 12px;
    box-shadow: 0 1px 4px rgba(15, 23, 42, 0.03);
    min-width: 0;
  }
  .bento-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 7px;
  }
  .bento-title {
    font-size: 12px;
    font-weight: 700;
    color: #0F172A;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .bento-top-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 212px;
    gap: 10px;
    align-items: stretch;
  }
  .bento-top-grid > * { min-width: 0; }
  .bento-kpi-row {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 5px;
    margin-bottom: 8px;
  }
  .bento-kpi {
    background: #F8FAFC;
    border: 1px solid #E2E8F0;
    border-radius: 8px;
    padding: 5px 7px;
    min-width: 0;
  }
  .bento-kpi-val {
    font-size: 13.5px;
    font-weight: 800;
    color: #0F172A;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }
  .bento-kpi-lbl {
    font-size: 9.5px;
    color: #64748B;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bento-bars-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 8px;
  }
  .bento-bar-box {
    background: #F8FAFC;
    border: 1px solid #E2E8F0;
    border-radius: 8px;
    padding: 6px 8px;
    min-width: 0;
  }
  .bento-bar-track {
    height: 7px;
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    gap: 1px;
    margin-bottom: 5px;
    background: #E2E8F0;
  }
  .bento-legend-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 4px;
    font-size: 9.6px;
    color: #334155;
    white-space: nowrap;
  }
  .bento-sq {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 2px;
    margin-right: 4px;
  }
  .bento-plugin-box {
    background: linear-gradient(145deg, #F8FAFC, #EFF6FF);
    border: 1px solid rgba(77, 107, 254, 0.25);
    border-radius: 9px;
    padding: 7px 9px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    font-size: 10px;
    min-width: 0;
  }
  .bento-plugin-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    padding: 2px 0;
    border-bottom: 1px dashed rgba(148, 163, 184, 0.25);
    white-space: nowrap;
  }
  .bento-plugin-row:last-child { border-bottom: none; }
  .bento-mid-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 9px;
  }
  .bento-donut-layout {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .bento-donut-svg-wrap {
    position: relative;
    width: 104px;
    height: 104px;
    flex-shrink: 0;
  }
  .bento-donut-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    pointer-events: none;
  }
  .bento-donut-big {
    font-size: 13.5px;
    font-weight: 800;
    color: #0F172A;
    line-height: 1.1;
  }
  .bento-donut-sub {
    font-size: 9px;
    color: #64748B;
    margin-top: 2px;
  }
  .bento-donut-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3.5px;
    font-size: 10px;
    min-width: 0;
  }
  .bento-donut-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #334155;
    white-space: nowrap;
  }
  .bento-donut-item b {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #0F172A;
    font-size: 10px;
  }
  .bento-pg-stream-grid {
    display: grid;
    grid-template-columns: 298px minmax(0, 1fr);
    gap: 9px;
    align-items: stretch;
    flex: 1;
  }
  .bento-pg-stream-grid > * { min-width: 0; }
  .bento-sql-feed {
    background: #0F172A;
    border-radius: 8px;
    padding: 8px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 9.6px;
    color: #CBD5E1;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 4px;
    min-width: 0;
  }
  .bento-sql-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    white-space: nowrap;
  }
  .bento-sql-line > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* p3 & dsh-harness-one Visual DAG Styles (Shot 2) */
  .dag-stepper {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #F1F5F9;
    border: 1px solid #CBD5E1;
    border-radius: 7px;
    padding: 2px 6px;
    font-size: 11px;
    font-weight: 700;
    color: #0F172A;
  }
  .dag-step-btn {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    background: #FFFFFF;
    border: 1px solid #CBD5E1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #2563EB;
    font-weight: 800;
    font-size: 11px;
  }
  .dag-pill-group {
    display: inline-flex;
    background: #F1F5F9;
    border: 1px solid #CBD5E1;
    border-radius: 6px;
    padding: 1px;
    gap: 2px;
  }
  .dag-pill {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    color: #475569;
    font-weight: 600;
  }
  .dag-pill.on {
    background: #4D6BFE;
    color: #FFFFFF;
  }
  .dag-canvas {
    position: relative;
    width: 100%;
    height: 282px;
    background-color: #F8FAFC;
    background-image: radial-gradient(#CBD5E1 1px, transparent 1px);
    background-size: 14px 14px;
    border: 1px solid #E2E8F0;
    border-radius: 10px;
    overflow: hidden;
  }
  .dag-node {
    position: absolute;
    background: #FFFFFF;
    border: 1.5px solid #CBD5E1;
    border-radius: 8px;
    padding: 5px 7px;
    font-size: 9.8px;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05);
    z-index: 2;
  }
  .dag-node.done { border-color: #4D6BFE; background: #F8FAFF; }
  .dag-node.run {
    border-color: #0EA5E9;
    background: linear-gradient(135deg, #EFF6FF, #F0F9FF);
    box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.14);
  }
  .dag-node.sub {
    border: 1.5px dashed #0EA5E9;
    background: #F0F9FF;
  }
  .dag-node-title {
    font-weight: 700;
    color: #0F172A;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 4px;
    font-size: 9.6px;
    white-space: nowrap;
  }
  .dag-node-desc {
    color: #64748B;
    font-size: 9px;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .gstack-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 7px;
  }
  .gstack-card {
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 9px;
    padding: 7px 8px;
    font-size: 10px;
    display: flex;
    flex-direction: column;
    gap: 3.5px;
    min-width: 0;
  }
  .gstack-card.active {
    border-color: rgba(77, 107, 254, 0.45);
    background: linear-gradient(180deg, #FFFFFF 0%, #F8FAFF 100%);
  }
  .gstack-skill {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 9px;
    color: #2563EB;
    background: rgba(77, 107, 254, 0.08);
    padding: 1px 4px;
    border-radius: 4px;
    display: inline-block;
  }
`

function renderWorkbenchShell({ activeGroup, activeTab, bodyHtml, chatHtml }) {
  const groups = [
    ['overview', '态势'],
    ['assets', '资产'],
    ['results', '交付'],
    ['report', '报告'],
    ['resources', '资源'],
  ]
  const subTabsByGroup = {
    overview: [['overview', '全局态势']],
    assets: [['assets', '分片与写表探针']],
    results: [['deliverables', '构建产物'], ['gates', '质量门禁']],
    report: [['report', '文稿主从墙']],
    resources: [
      ['agents', '智能体编排'],
      ['sessions', '工作流通道'],
      ['artifacts', '契约与配置'],
      ['knowledge', '知识库'],
      ['skills', '技能库'],
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
        <span class="wb-brand-logo">D</span>
        <span>DSH Desktop · LMTAgent Multi-Agent Software Factory</span>
      </div>
      <span class="wb-pill">WorkBuddy × DSH Blue UI</span>
      <span class="wb-pill wb-pill-pg">PostgreSQL 16 Wire v3 · Live Probe</span>
      <span class="wb-pill">dsh-harness-one · 递归子代理 (thinking: low)</span>
      <div style="flex:1"></div>
      <span style="font-size:11.5px;color:#94A3B8;font-family:monospace">ECCVIK/lmtagent · v0.15.1</span>
    </div>

    <div class="wb-workspace">
      <div class="wb-sidebar">
        <div class="wb-side-sec">DSH 研发工作空间</div>
        <div class="wb-side-item active"><span class="wb-side-dot"></span>dsh-desktop 核心插件集群</div>
        <div class="wb-side-item"><span>📦</span>dsh-harness-one 编排引擎</div>
        <div class="wb-side-item"><span>🛡️</span>pg-wire-v3 存储内核</div>

        <div class="wb-side-sec" style="margin-top:4px">8-Role gstack 编队</div>
        <div class="wb-side-item active"><span class="wb-side-dot"></span>⓪ plan · Captain 主控</div>
        <div class="wb-side-item"><span>①</span>recon · CEO 需求规划</div>
        <div class="wb-side-item"><span>②</span>designer · UI 规范</div>
        <div class="wb-side-item"><span>③</span>assess · Eng Manager</div>
        <div class="wb-side-item"><span>④</span>vuln-scan · CSO 审查</div>
        <div class="wb-side-item active"><span class="wb-side-dot"></span>⑤ exploit · 6× Builder + Sub</div>
        <div class="wb-side-item"><span>⑥</span>qa · QA Lead 门禁</div>
        <div class="wb-side-item"><span>⑦</span>internal · Release 文稿</div>

        <div style="flex:1"></div>

        <!-- p2: Live PostgreSQL Write Activity Probe in Bottom-Left Sidebar -->
        <div class="wb-pg-probe">
          <div class="wb-pg-probe-head">
            <span class="wb-pg-probe-title">⚡ PG 写表活动探针</span>
            <span style="font-family:monospace;font-size:9px;color:#94A3B8">rt_dsh</span>
          </div>
          <div class="wb-pg-live-badge">● LIVE · 42 writes/min · 0.4ms</div>

          <div class="wb-pg-row">
            <span class="wb-pg-tbl">modules</span>
            <span class="wb-pg-op ins">INSERT</span>
            <span class="wb-pg-role">exploit#2</span>
            <span class="wb-pg-lat">0.3ms</span>
            <div class="wb-pg-bar"><span style="width:88%"></span></div>
          </div>
          <div class="wb-pg-row">
            <span class="wb-pg-tbl">dag_nodes</span>
            <span class="wb-pg-op upd">UPDATE</span>
            <span class="wb-pg-role">plan</span>
            <span class="wb-pg-lat">0.4ms</span>
            <div class="wb-pg-bar"><span style="width:74%"></span></div>
          </div>
          <div class="wb-pg-row">
            <span class="wb-pg-tbl">subagents</span>
            <span class="wb-pg-op spw">SPAWN(low)</span>
            <span class="wb-pg-role">exploit#1→sub</span>
            <span class="wb-pg-lat">0.5ms</span>
            <div class="wb-pg-bar"><span style="width:92%"></span></div>
          </div>
          <div class="wb-pg-row">
            <span class="wb-pg-tbl">qa_runs</span>
            <span class="wb-pg-op ins">INSERT</span>
            <span class="wb-pg-role">qa</span>
            <span class="wb-pg-lat">0.4ms</span>
            <div class="wb-pg-bar"><span style="width:65%"></span></div>
          </div>
          <div class="wb-pg-row">
            <span class="wb-pg-tbl">doc_wall</span>
            <span class="wb-pg-op ups">UPSERT</span>
            <span class="wb-pg-role">internal</span>
            <span class="wb-pg-lat">0.6ms</span>
            <div class="wb-pg-bar"><span style="width:79%"></span></div>
          </div>
        </div>
      </div>

      <div class="wb-chat">
        <div class="wb-chat-head">
          <span>💬 主会话 · Captain (plan) 递归 DAG 调度</span>
          <span class="rt-icon-btn on"><span style="font-size:12px">⛨</span><span>Cluster</span></span>
        </div>
        <div class="wb-chat-body">
          ${chatHtml}
        </div>
      </div>

      <div class="rt-dock" data-open="1">
        <div class="rt-head">
          <div class="rt-title"><span class="rt-dot"></span>DSH 研发集群控制台</div>
          <span class="rt-tag rt-tag-live">跟随会话</span>
          <select class="rt-input" style="max-width:170px"><option>dsh-desktop 核心插件集群</option></select>
          <div class="rt-spacer"></div>
          <span class="rt-tag">v0.15.1</span>
          <button class="rt-btn">并发 6/12</button>
          <button class="rt-btn">刷新</button>
          <button class="rt-btn">文稿墙</button>
        </div>

        <div class="rt-tabs rt-tabs-groups">
          ${groups.map(([k, label]) => `<div class="rt-tab rt-tab-group${k === activeGroup ? ' on' : ''}">${label}</div>`).join('')}
        </div>
        ${subTabs.length > 1 || activeGroup !== 'overview' ? `<div class="rt-tabs rt-tabs-sub">
          ${subTabs.map(([k, label]) => `<div class="rt-tab${k === activeTab ? ' on' : ''}">${label}</div>`).join('')}
        </div>` : ''}

        <div class="rt-body">
          ${bodyHtml}
        </div>

        <div class="rt-foot">
          <span class="rt-wb-badge">PGSQL Wire v3 · 6+4 Recursive Slots (thinking: low)</span>
          <div class="rt-spacer"></div>
          <span>Schema: rt_dsh_desktop · 1,480 TX</span>
          <span>飞书 Webhook 已就绪</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`
}

const DEFAULT_CHAT_HTML = `
  <div class="wb-msg-user">
    重构 dsh-desktop 研发集群控制台：升级模块化 Bento 统计面板、左下角 PG 实时写表探针、可调节 6/12 并发槽与 thinking: low 递归子代理，并生成主从文稿墙与飞书群聊战报。
  </div>
  <div class="wb-msg-agent">
    <div class="wb-msg-agent-head">
      <span class="rt-dot"></span>
      <span>Captain (plan) · Workflow One 调度器</span>
      <span class="rt-tag rt-tag-live" style="margin-left:auto">Wave 3 · 6+4 槽</span>
    </div>
    <div>已完成 <b>Wave 1</b>（CEO PRD + Designer UI 令牌）与 <b>Wave 2</b>（Eng Manager 6 分片契约），当前调度 <b>6 个主 Builder 槽 + 4 个递归子代理 (thinking: low)</b>：</div>
    <div class="wb-tool-call"><span><b>redteam_agent_slot</b>(action="set_limit", max=6)</span><span style="color:#2563EB;font-weight:600">✓ 6/12 槽生效</span></div>
    <div class="wb-tool-call"><span><b>subagent_spawn</b>(role="exploit#1", think="low")</span><span style="color:#0284C7;font-weight:600">↳ Sub #1a</span></div>
    <div class="wb-tool-call"><span><b>pg_write_probe</b>(schema="rt_dsh", wal="0.4ms")</span><span style="color:#10B981;font-weight:600">● 42 w/min</span></div>
  </div>
  <div class="wb-msg-agent">
    <div class="wb-msg-agent-head">
      <span class="rt-dot" style="background:#0EA5E9"></span>
      <span>PostgreSQL Wire v3 事实库写表探针流</span>
      <span class="rt-tag rt-tag-passive" style="margin-left:auto">0.4ms WAL</span>
    </div>
    <div style="font-size:11px;color:#475569;line-height:1.55">
      · <b>modules / file_shards</b>：6 个无交集分片锁全部校验通过（零写冲突）<br/>
      · <b>subagents</b>：4 个递归子代理以 <code>thinking: low</code> 轻量模式完成辅助编码<br/>
      · <b>qa_runs / doc_wall</b>：18 套件 888 断言全绿，文稿墙与飞书通知已同步归档。
    </div>
  </div>
`

// 1. Shot 1: Overview Tab — p1 Software Dev Cluster + p4 Modular Bento Dashboard (Token & Latency Ring Gauges)
const overviewBody = `
  <div class="bento-wrap">
    <!-- Top Bento Card: 集群上下文与编队统计 -->
    <div class="bento-card">
      <div class="bento-head">
        <div class="bento-title">
          <span class="rt-dot"></span>
          <span>集群上下文与编队统计</span>
          <span class="rt-tag rt-tag-live">Software Dev Cluster · Zero-Conflict Shards</span>
        </div>
        <span style="font-size:10.5px;color:#64748B;font-family:monospace">Session #9f8a2c1e · 4-Wave DAG</span>
      </div>

      <div class="bento-top-grid">
        <div>
          <div class="bento-kpi-row">
            <div class="bento-kpi">
              <div class="bento-kpi-val">18 <span style="font-size:10px;font-weight:600;color:#475569">轮次</span></div>
              <div class="bento-kpi-lbl">18 轮次 · 主从交互</div>
            </div>
            <div class="bento-kpi">
              <div class="bento-kpi-val">312 <span style="font-size:10px;font-weight:600;color:#475569">步</span></div>
              <div class="bento-kpi-lbl">312 DAG 步数</div>
            </div>
            <div class="bento-kpi">
              <div class="bento-kpi-val">29 <span style="font-size:10px;font-weight:600;color:#475569">项</span></div>
              <div class="bento-kpi-lbl">29 技能加载 (gstack)</div>
            </div>
            <div class="bento-kpi" style="border-color:rgba(14,165,233,0.35);background:#F0F9FF">
              <div class="bento-kpi-val" style="color:#0284C7">6 + 4 <span style="font-size:9.5px;font-weight:700">low</span></div>
              <div class="bento-kpi-lbl">6 + 4 递归子代理 (thinking: low)</div>
            </div>
            <div class="bento-kpi" style="border-color:rgba(77,107,254,0.3);background:#F8FAFF">
              <div class="bento-kpi-val" style="color:#2563EB">1,480</div>
              <div class="bento-kpi-lbl">1,480 PG 写表事务</div>
            </div>
          </div>

          <div class="bento-bars-grid">
            <div class="bento-bar-box">
              <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;color:#0F172A;margin-bottom:4px">
                <span>上下文载荷结构</span>
                <span style="color:#2563EB">128K Window · 76%</span>
              </div>
              <div class="bento-bar-track">
                <div style="width:68%;background:#4D6BFE"></div>
                <div style="width:14%;background:#0EA5E9"></div>
                <div style="width:11%;background:#10B981"></div>
                <div style="width:7%;background:#8B5CF6"></div>
              </div>
              <div class="bento-legend-grid">
                <span><b style="color:#4D6BFE">■</b> 代码分片读写 68%</span>
                <span><b style="color:#0EA5E9">■</b> 架构契约 14%</span>
                <span><b style="color:#10B981">■</b> 测试门禁 11%</span>
                <span><b style="color:#8B5CF6">■</b> 文稿产物 7%</span>
              </div>
            </div>

            <div class="bento-bar-box">
              <div style="display:flex;justify-content:space-between;font-size:10px;font-weight:700;color:#0F172A;margin-bottom:4px">
                <span>多智能体算力占比</span>
                <span style="color:#0284C7">6 主槽 + 4 递归槽</span>
              </div>
              <div class="bento-bar-track">
                <div style="width:54%;background:#4D6BFE"></div>
                <div style="width:22%;background:#0EA5E9"></div>
                <div style="width:16%;background:#10B981"></div>
                <div style="width:8%;background:#6366F1"></div>
              </div>
              <div class="bento-legend-grid">
                <span><b style="color:#4D6BFE">■</b> exploit (Builder) 54%</span>
                <span><b style="color:#0EA5E9">■</b> Sub-Worker (low) 22%</span>
                <span><b style="color:#10B981">■</b> qa / cso 16%</span>
                <span><b style="color:#6366F1">■</b> plan / assess 8%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Right-side Plugin & Orchestrator Info Card -->
        <div class="bento-plugin-box">
          <div style="font-weight:800;color:#0F172A;font-size:10.8px;margin-bottom:3px;display:flex;align-items:center;justify-content:space-between">
            <span>集群与引擎信息</span>
            <span class="rt-tag rt-tag-live" style="font-size:8.8px;padding:1px 5px">ONLINE</span>
          </div>
          <div class="bento-plugin-row"><span style="color:#64748B">插件</span><b style="color:#0F172A">dsh-redteam-mode v0.15.1</b></div>
          <div class="bento-plugin-row"><span style="color:#64748B">引擎</span><b style="color:#2563EB">Workflow One DAG</b></div>
          <div class="bento-plugin-row"><span style="color:#64748B">递归</span><b style="color:#0284C7">递归派发 maxDepth: 3</b></div>
          <div class="bento-plugin-row"><span style="color:#64748B">思考</span><b style="color:#10B981">默认思考: low</b></div>
          <div class="bento-plugin-row"><span style="color:#64748B">并发槽</span><b style="color:#0F172A">6 / 12 自适应调节</b></div>
        </div>
      </div>
    </div>

    <!-- Middle Bento Row: 2 Columns with SVG Donut Ring Charts -->
    <div class="bento-mid-row">
      <!-- Left Card: Token 统计 -->
      <div class="bento-card">
        <div class="bento-head">
          <div class="bento-title">Token 统计</div>
          <span class="rt-tag rt-tag-live">缓存命中 97.8%</span>
        </div>
        <div class="bento-donut-layout">
          <div class="bento-donut-svg-wrap">
            <svg width="104" height="104" viewBox="0 0 108 108" style="transform:rotate(-90deg)">
              <circle cx="54" cy="54" r="42" fill="none" stroke="#F1F5F9" stroke-width="13" />
              <!-- 44.0% Builder (#4D6BFE) -->
              <circle cx="54" cy="54" r="42" fill="none" stroke="#4D6BFE" stroke-width="13" stroke-dasharray="116.11 263.89" stroke-dashoffset="0" />
              <!-- 19.4% Recursive Subagent low (#0EA5E9) -->
              <circle cx="54" cy="54" r="42" fill="none" stroke="#0EA5E9" stroke-width="13" stroke-dasharray="51.20 263.89" stroke-dashoffset="-116.11" />
              <!-- 16.5% Tools & Skills (#6366F1) -->
              <circle cx="54" cy="54" r="42" fill="none" stroke="#6366F1" stroke-width="13" stroke-dasharray="43.54 263.89" stroke-dashoffset="-167.31" />
              <!-- 8.1% Captain & Design (#8B5CF6) -->
              <circle cx="54" cy="54" r="42" fill="none" stroke="#8B5CF6" stroke-width="13" stroke-dasharray="21.38 263.89" stroke-dashoffset="-210.85" />
              <!-- 7.8% QA & CSO (#10B981) -->
              <circle cx="54" cy="54" r="42" fill="none" stroke="#10B981" stroke-width="13" stroke-dasharray="20.58 263.89" stroke-dashoffset="-232.23" />
              <!-- 4.2% System & Contract (#F59E0B) -->
              <circle cx="54" cy="54" r="42" fill="none" stroke="#F59E0B" stroke-width="13" stroke-dasharray="11.08 263.89" stroke-dashoffset="-252.81" />
            </svg>
            <div class="bento-donut-center">
              <div class="bento-donut-big">38.6M</div>
              <div class="bento-donut-sub">总用量</div>
            </div>
          </div>
          <div class="bento-donut-list">
            <div class="bento-donut-item"><span><i class="bento-sq" style="background:#F59E0B"></i>系统与架构契约</span><b>4.2%</b></div>
            <div class="bento-donut-item"><span><i class="bento-sq" style="background:#6366F1"></i>工具与技能定义</span><b>16.5%</b></div>
            <div class="bento-donut-item"><span><i class="bento-sq" style="background:#8B5CF6"></i>主控与设计规划</span><b>8.1%</b></div>
            <div class="bento-donut-item"><span><i class="bento-sq" style="background:#4D6BFE"></i>6× Builder 并发编码</span><b>44.0%</b></div>
            <div class="bento-donut-item"><span><i class="bento-sq" style="background:#0EA5E9"></i>递归子代理 (thinking: low)</span><b>19.4%</b></div>
            <div class="bento-donut-item"><span><i class="bento-sq" style="background:#10B981"></i>QA 与安全门禁</span><b>7.8%</b></div>
          </div>
        </div>
      </div>

      <!-- Right Card: 耗时与并发吞吐统计 -->
      <div class="bento-card">
        <div class="bento-head">
          <div class="bento-title">耗时与并发吞吐统计</div>
          <span class="rt-tag rt-tag-active">输出速度 142 tok/s</span>
        </div>
        <div class="bento-donut-layout">
          <div class="bento-donut-svg-wrap">
            <svg width="104" height="104" viewBox="0 0 108 108" style="transform:rotate(-90deg)">
              <circle cx="54" cy="54" r="42" fill="none" stroke="#F1F5F9" stroke-width="13" />
              <!-- 64.8% Wave 3 (#4D6BFE) -->
              <circle cx="54" cy="54" r="42" fill="none" stroke="#4D6BFE" stroke-width="13" stroke-dasharray="171.00 263.89" stroke-dashoffset="0" />
              <!-- 17.6% Wave 4 (#10B981) -->
              <circle cx="54" cy="54" r="42" fill="none" stroke="#10B981" stroke-width="13" stroke-dasharray="46.45 263.89" stroke-dashoffset="-171.00" />
              <!-- 11.2% Wave 1 (#0EA5E9) -->
              <circle cx="54" cy="54" r="42" fill="none" stroke="#0EA5E9" stroke-width="13" stroke-dasharray="29.56 263.89" stroke-dashoffset="-217.45" />
              <!-- 6.4% Wave 2 (#6366F1) -->
              <circle cx="54" cy="54" r="42" fill="none" stroke="#6366F1" stroke-width="13" stroke-dasharray="16.89 263.89" stroke-dashoffset="-247.01" />
            </svg>
            <div class="bento-donut-center">
              <div class="bento-donut-big">42m 18s</div>
              <div class="bento-donut-sub">活跃总时长</div>
            </div>
          </div>
          <div class="bento-donut-list">
            <div class="bento-donut-item"><span><i class="bento-sq" style="background:#0EA5E9"></i>Wave 1 双轨立项</span><b>11.2%</b></div>
            <div class="bento-donut-item"><span><i class="bento-sq" style="background:#6366F1"></i>Wave 2 架构分片锁</span><b>6.4%</b></div>
            <div class="bento-donut-item"><span><i class="bento-sq" style="background:#4D6BFE"></i>Wave 3 6槽+递归构建</span><b>64.8%</b></div>
            <div class="bento-donut-item"><span><i class="bento-sq" style="background:#10B981"></i>Wave 4 QA/CSO/发布</span><b>17.6%</b></div>
            <div style="margin-top:3px">
              <div style="font-size:9px;color:#64748B;margin-bottom:2px;display:flex;justify-content:space-between">
                <span>4-Wave 并发时序流水线</span>
                <span style="color:#2563EB;font-weight:700">6.2× 加速比</span>
              </div>
              <div class="bento-bar-track" style="margin-bottom:0;height:6px">
                <div style="width:11.2%;background:#0EA5E9"></div>
                <div style="width:6.4%;background:#6366F1"></div>
                <div style="width:64.8%;background:#4D6BFE"></div>
                <div style="width:17.6%;background:#10B981"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Bento Card: PG 事实库实时写表活动探针 · Live Table Write Stream -->
    <div class="bento-card" style="flex:1;display:flex;flex-direction:column;gap:6px">
      <div class="bento-head" style="margin-bottom:0">
        <div class="bento-title">
          <span style="color:#10B981">●</span>
          <span>PG 事实库实时写表活动探针 · Live Table Write Stream</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="rt-tag rt-tag-live">42 writes/min · 0.4ms mmap WAL</span>
          <span class="rt-tag rt-tag-passive">0 SQLITE_BUSY / 0 死锁</span>
        </div>
      </div>

      <div class="bento-pg-stream-grid">
        <div style="display:flex;flex-direction:column;justify-content:space-between;gap:4px;font-size:9.6px">
          <div style="padding:4.5px 8px;border-radius:6px;background:#F8FAFC;border:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center;white-space:nowrap">
            <span><b style="color:#2563EB">rt_dsh.modules</b> · <code>exploit#2</code></span><span class="rt-mono" style="color:#10B981;font-weight:700">INSERT · 0.3ms</span>
          </div>
          <div style="padding:4.5px 8px;border-radius:6px;background:#F8FAFC;border:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center;white-space:nowrap">
            <span><b style="color:#2563EB">rt_dsh.dag_nodes</b> · <code>plan</code></span><span class="rt-mono" style="color:#0284C7;font-weight:700">UPDATE · 0.4ms</span>
          </div>
          <div style="padding:4.5px 8px;border-radius:6px;background:#F0F9FF;border:1px solid rgba(14,165,233,0.3);display:flex;justify-content:space-between;align-items:center;white-space:nowrap">
            <span><b style="color:#0284C7">rt_dsh.subagents</b> · <code>sub#1a(low)</code></span><span class="rt-mono" style="color:#0284C7;font-weight:700">SPAWN · 0.5ms</span>
          </div>
          <div style="padding:4.5px 8px;border-radius:6px;background:#F8FAFC;border:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center;white-space:nowrap">
            <span><b style="color:#2563EB">rt_dsh.file_shards</b> · <code>assess</code></span><span class="rt-mono" style="color:#10B981;font-weight:700">UPSERT · 0.3ms</span>
          </div>
          <div style="padding:4.5px 8px;border-radius:6px;background:#F8FAFC;border:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center;white-space:nowrap">
            <span><b style="color:#2563EB">rt_dsh.qa_runs</b> · <code>qa (888✓)</code></span><span class="rt-mono" style="color:#10B981;font-weight:700">INSERT · 0.4ms</span>
          </div>
          <div style="padding:4.5px 8px;border-radius:6px;background:#F8FAFC;border:1px solid #E2E8F0;display:flex;justify-content:space-between;align-items:center;white-space:nowrap">
            <span><b style="color:#2563EB">rt_dsh.doc_wall</b> · <code>internal</code></span><span class="rt-mono" style="color:#8B5CF6;font-weight:700">UPSERT · 0.6ms</span>
          </div>
        </div>

        <div class="bento-sql-feed">
          <div class="bento-sql-line">
            <span><b style="color:#38BDF8">[11:21:04.12]</b> <span style="color:#93C5FD">INSERT INTO rt_dsh.modules</span> VALUES ('pg-engine', 'VERIFIED')</span>
            <span style="color:#34D399;flex-shrink:0">0.3ms</span>
          </div>
          <div class="bento-sql-line">
            <span><b style="color:#38BDF8">[11:21:04.29]</b> <span style="color:#93C5FD">UPDATE rt_dsh.dag_nodes</span> SET status='RUN' WHERE wave=3</span>
            <span style="color:#34D399;flex-shrink:0">0.4ms</span>
          </div>
          <div class="bento-sql-line">
            <span><b style="color:#38BDF8">[11:21:04.48]</b> <span style="color:#6EE7B7">INSERT INTO rt_dsh.subagents</span> VALUES ('exploit#1', 1, 'low')</span>
            <span style="color:#34D399;flex-shrink:0">0.5ms</span>
          </div>
          <div class="bento-sql-line">
            <span><b style="color:#38BDF8">[11:21:05.02]</b> <span style="color:#C4B5FD">UPSERT INTO rt_dsh.file_shards</span> VALUES ('shard-3', 'LOCKED')</span>
            <span style="color:#34D399;flex-shrink:0">0.3ms</span>
          </div>
          <div class="bento-sql-line">
            <span><b style="color:#38BDF8">[11:21:05.39]</b> <span style="color:#93C5FD">INSERT INTO rt_dsh.qa_runs</span> VALUES (18, 888, 'PASS_100%')</span>
            <span style="color:#34D399;flex-shrink:0">0.4ms</span>
          </div>
          <div class="bento-sql-line">
            <span><b style="color:#38BDF8">[11:21:05.84]</b> <span style="color:#C4B5FD">UPSERT INTO rt_dsh.doc_wall</span> VALUES ('v2_report', 'FEISHU_OK')</span>
            <span style="color:#34D399;flex-shrink:0">0.6ms</span>
          </div>
        </div>
      </div>
    </div>
  </div>
`

// 2. Shot 2: Agents & Visual Multi-Agent DAG Canvas + Self-Adjustable Concurrency + Recursive Subagents (thinking: low)
const agentsBody = `
  <div class="rt-main">
    <!-- p3: Self-Adjustable Concurrency Toolbar + Recursive Depth + Default Thinking Effort Selector -->
    <div class="rt-toolbar" style="gap:6px;padding:8px 12px">
      <span style="font-weight:700;font-size:12px;color:#0F172A">并发槽调节</span>
      <div class="dag-stepper">
        <span class="dag-step-btn">-</span>
        <span style="padding:0 4px;font-family:monospace;color:#2563EB">6 / 12 槽</span>
        <span class="dag-step-btn">+</span>
      </div>
      <div class="dag-pill-group">
        <span class="dag-pill">3</span>
        <span class="dag-pill on">6</span>
        <span class="dag-pill">8</span>
        <span class="dag-pill">12</span>
      </div>
      <span class="rt-tag rt-tag-live">递归派发 maxDepth: 3</span>
      <div style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#334155;margin-left:auto">
        <span style="font-weight:600">思考模式:</span>
        <div class="dag-pill-group">
          <span class="dag-pill on">low ✓</span>
          <span class="dag-pill">medium</span>
          <span class="dag-pill">high</span>
        </div>
      </div>
    </div>

    <div class="rt-pane" style="padding:10px 12px;gap:9px;overflow:hidden">
      <!-- dsh-harness-one Visual Multi-Agent DAG Canvas -->
      <div class="rt-card" style="padding:9px 11px;margin:0">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;white-space:nowrap">
          <div style="display:flex;align-items:center;gap:6px">
            <span class="rt-dot"></span>
            <span style="font-weight:700;font-size:12px;color:#0F172A">可视化多智能体 DAG 编排画布 (dsh-harness-one)</span>
          </div>
          <div style="display:flex;gap:5px">
            <button class="rt-btn rt-btn-primary" style="font-size:10px;padding:3px 7px">▶ 启动工作流</button>
            <button class="rt-btn" style="font-size:10px;padding:3px 7px">↻ 断点续跑 (Recovery)</button>
            <button class="rt-btn" style="font-size:10px;padding:3px 7px">📄 切换文稿墙</button>
            <button class="rt-btn" style="font-size:10px;padding:3px 7px;color:#0284C7;border-color:rgba(14,165,233,0.4)">🔔 飞书通知已开启</button>
          </div>
        </div>

        <div class="dag-canvas">
          <!-- SVG Bezier Edges connecting the 5 columns -->
          <svg width="750" height="282" viewBox="0 0 750 282" style="position:absolute;inset:0;z-index:1;pointer-events:none">
            <defs>
              <linearGradient id="edgeActive" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#4D6BFE" />
                <stop offset="100%" stop-color="#0EA5E9" />
              </linearGradient>
            </defs>
            <!-- Col 1 (Captain x=116, y=132) -> Col 2 (CEO y=46, Designer y=126) -->
            <path d="M 116 132 C 126 132, 124 46, 134 46" fill="none" stroke="url(#edgeActive)" stroke-width="2" />
            <path d="M 116 132 C 126 132, 124 126, 134 126" fill="none" stroke="url(#edgeActive)" stroke-width="2" />
            <!-- CEO & Designer -> Eng Manager (y=206) -->
            <path d="M 194 68 L 194 184" fill="none" stroke="#4D6BFE" stroke-width="1.5" stroke-dasharray="3 2" />
            <!-- Col 2 (Eng Manager x=256, y=206) -> Col 3 Builders (x=274, y=42 & y=110) -->
            <path d="M 256 46 C 266 46, 264 42, 274 42" fill="none" stroke="url(#edgeActive)" stroke-width="2" />
            <path d="M 256 126 C 266 126, 264 110, 274 110" fill="none" stroke="url(#edgeActive)" stroke-width="2" />
            <path d="M 256 206 C 266 206, 264 42, 274 42" fill="none" stroke="url(#edgeActive)" stroke-width="2" />
            <path d="M 256 206 C 266 206, 264 110, 274 110" fill="none" stroke="url(#edgeActive)" stroke-width="2" />
            <!-- Builder -> Recursive Child Subagents (thinking: low) -->
            <path d="M 358 64 C 358 140, 264 176, 274 176" fill="none" stroke="#0EA5E9" stroke-width="1.8" stroke-dasharray="4 3" />
            <path d="M 358 132 C 358 205, 264 236, 274 236" fill="none" stroke="#0EA5E9" stroke-width="1.8" stroke-dasharray="4 3" />
            <!-- Col 3 (x=444) -> Col 4 (CSO x=462 y=78, QA x=462 y=168) -->
            <path d="M 444 42 C 454 42, 452 78, 462 78" fill="none" stroke="url(#edgeActive)" stroke-width="2" />
            <path d="M 444 110 C 454 110, 452 168, 462 168" fill="none" stroke="url(#edgeActive)" stroke-width="2" />
            <path d="M 444 176 C 454 176, 452 78, 462 78" fill="none" stroke="#0EA5E9" stroke-width="1.6" stroke-dasharray="3 3" />
            <path d="M 444 236 C 454 236, 452 168, 462 168" fill="none" stroke="#0EA5E9" stroke-width="1.6" stroke-dasharray="3 3" />
            <!-- Col 4 (x=586) -> Col 5 (Release x=604 y=78, Feishu x=604 y=168) -->
            <path d="M 586 78 C 596 78, 594 78, 604 78" fill="none" stroke="#4D6BFE" stroke-width="2" />
            <path d="M 586 168 C 596 168, 594 78, 604 78" fill="none" stroke="#4D6BFE" stroke-width="2" />
            <path d="M 668 102 L 668 146" fill="none" stroke="#10B981" stroke-width="2" />
          </svg>

          <!-- Col 1: Captain -->
          <div class="dag-node done" style="left:8px;top:110px;width:108px">
            <div class="dag-node-title"><span>⓪ Captain (plan)</span><span style="color:#2563EB">✓</span></div>
            <div class="dag-node-desc">主控拆解 · 6/12 槽分配</div>
          </div>

          <!-- Col 2: CEO, Designer, Eng Manager -->
          <div class="dag-node done" style="left:134px;top:24px;width:122px">
            <div class="dag-node-title"><span>① CEO (recon)</span><span style="color:#2563EB">✓</span></div>
            <div class="dag-node-desc">PRD 文稿 · 48 模块测绘</div>
          </div>
          <div class="dag-node done" style="left:134px;top:104px;width:122px">
            <div class="dag-node-title"><span>② Designer</span><span style="color:#2563EB">✓</span></div>
            <div class="dag-node-desc">DSH Blue · Bento 规范</div>
          </div>
          <div class="dag-node done" style="left:134px;top:184px;width:122px">
            <div class="dag-node-title"><span>③ Eng Manager</span><span style="color:#2563EB">✓</span></div>
            <div class="dag-node-desc">assess · 6 分片无冲突锁</div>
          </div>

          <!-- Col 3: Builders #1..#6 + Recursive Child Subagents (thinking: low) -->
          <div class="dag-node run" style="left:274px;top:20px;width:170px">
            <div class="dag-node-title"><span>⑤ Builder #1..#3 (exploit)</span><span style="color:#0284C7">⚡3槽</span></div>
            <div class="dag-node-desc">PG 引擎 / DAG 并发 / Bento UI</div>
          </div>
          <div class="dag-node run" style="left:274px;top:88px;width:170px">
            <div class="dag-node-title"><span>⑤ Builder #4..#6 (exploit)</span><span style="color:#0284C7">⚡3槽</span></div>
            <div class="dag-node-desc">工作台客户端 / 提示词 / 打包</div>
          </div>
          <div class="dag-node sub" style="left:274px;top:156px;width:170px">
            <div class="dag-node-title"><span style="color:#0284C7">↳ Sub-Worker #1a · thinking: low</span></div>
            <div class="dag-node-desc">递归子代理 (depth:1) · PG 探针</div>
          </div>
          <div class="dag-node sub" style="left:274px;top:216px;width:170px">
            <div class="dag-node-title"><span style="color:#0284C7">↳ Sub-Worker #2a · thinking: low</span></div>
            <div class="dag-node-desc">递归子代理 (depth:1) · 断言快照</div>
          </div>

          <!-- Col 4: CSO & QA Lead -->
          <div class="dag-node done" style="left:462px;top:56px;width:124px">
            <div class="dag-node-title"><span>④ CSO (vuln-scan)</span><span style="color:#2563EB">✓</span></div>
            <div class="dag-node-desc">STRIDE 架构安全审查</div>
          </div>
          <div class="dag-node run" style="left:462px;top:146px;width:124px">
            <div class="dag-node-title"><span>⑥ QA Lead</span><span style="color:#10B981">888✓</span></div>
            <div class="dag-node-desc">18 测试套件全量门禁</div>
          </div>

          <!-- Col 5: Release & Feishu Notification -->
          <div class="dag-node done" style="left:604px;top:56px;width:130px">
            <div class="dag-node-title"><span>⑦ Release (internal)</span><span style="color:#2563EB">✓</span></div>
            <div class="dag-node-desc">V2 报告 · 文稿主从墙</div>
          </div>
          <div class="dag-node run" style="left:604px;top:146px;width:130px;border-color:#10B981;background:#ECFDF5">
            <div class="dag-node-title"><span style="color:#047857">📨 飞书群聊通知</span><span style="color:#059669">已推</span></div>
            <div class="dag-node-desc" style="color:#065F46">Webhook 战报自动送达</div>
          </div>
        </div>
      </div>

      <!-- Modular 2x4 Grid of the 8 gstack Roles -->
      <div class="rt-card" style="padding:9px 11px;margin:0">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span style="font-weight:700;font-size:11.5px;color:#0F172A">8 角色 gstack 虚拟研发团队矩阵（支持 Subagent 递归派发 · 默认 thinking: low）</span>
          <span class="rt-tag rt-tag-live">在跑 6 主槽 + 4 递归子代理</span>
        </div>
        <div class="gstack-grid">
          <div class="gstack-card active">
            <div style="display:flex;justify-content:space-between;font-weight:700;color:#0F172A"><span>⓪ Captain (plan)</span><span style="color:#2563EB">主控</span></div>
            <div><span class="gstack-skill">workflow-dag</span> <span class="gstack-skill">slot-6/12</span></div>
            <div style="color:#0284C7;font-size:9.2px;font-weight:600">可递归派发 · thinking: low</div>
          </div>
          <div class="gstack-card">
            <div style="display:flex;justify-content:space-between;font-weight:700;color:#0F172A"><span>① CEO (recon)</span><span style="color:#10B981">Wave 1</span></div>
            <div><span class="gstack-skill">/office-hours</span> <span class="gstack-skill">/plan-ceo</span></div>
            <div style="color:#64748B;font-size:9.2px">产物: ① CEO PRD 文稿</div>
          </div>
          <div class="gstack-card">
            <div style="display:flex;justify-content:space-between;font-weight:700;color:#0F172A"><span>② Designer</span><span style="color:#10B981">Wave 1</span></div>
            <div><span class="gstack-skill">/plan-design</span> <span class="gstack-skill">#4D6BFE</span></div>
            <div style="color:#64748B;font-size:9.2px">产物: ② UI 令牌与 Bento 规范</div>
          </div>
          <div class="gstack-card">
            <div style="display:flex;justify-content:space-between;font-weight:700;color:#0F172A"><span>③ Eng Manager</span><span style="color:#10B981">Wave 2</span></div>
            <div><span class="gstack-skill">/plan-eng</span> <span class="gstack-skill">file-disjoint</span></div>
            <div style="color:#64748B;font-size:9.2px">产物: ③ 6 分片无冲突契约</div>
          </div>
          <div class="gstack-card">
            <div style="display:flex;justify-content:space-between;font-weight:700;color:#0F172A"><span>④ CSO (vuln-scan)</span><span style="color:#2563EB">Wave 4</span></div>
            <div><span class="gstack-skill">/review</span> <span class="gstack-skill">/cso-stride</span></div>
            <div style="color:#0284C7;font-size:9.2px;font-weight:600">可递归派发 · thinking: low</div>
          </div>
          <div class="gstack-card active">
            <div style="display:flex;justify-content:space-between;font-weight:700;color:#0F172A"><span>⑤ Builder (exploit)</span><span style="color:#0284C7">6 槽满载</span></div>
            <div><span class="gstack-skill">6× parallel</span> <span class="gstack-skill">sub-spawn</span></div>
            <div style="color:#0284C7;font-size:9.2px;font-weight:600">可递归派发 · thinking: low</div>
          </div>
          <div class="gstack-card active">
            <div style="display:flex;justify-content:space-between;font-weight:700;color:#0F172A"><span>⑥ QA Lead (qa)</span><span style="color:#10B981">888 PASS</span></div>
            <div><span class="gstack-skill">/qa</span> <span class="gstack-skill">/benchmark</span></div>
            <div style="color:#0284C7;font-size:9.2px;font-weight:600">可递归派发 · thinking: low</div>
          </div>
          <div class="gstack-card">
            <div style="display:flex;justify-content:space-between;font-weight:700;color:#0F172A"><span>⑦ Release (internal)</span><span style="color:#2563EB">Wave 4</span></div>
            <div><span class="gstack-skill">/ship</span> <span class="gstack-skill">feishu-bot</span></div>
            <div style="color:#64748B;font-size:9.2px">产物: ⑦ V2 报告 + 飞书推送</div>
          </div>
        </div>
      </div>
    </div>
  </div>
`

// 3. Shot 3: Assets & PostgreSQL Wire v3 Live Table Write Probe & File-Disjoint Sharding Topology
const assetsBody = `
  <div class="rt-main">
    <div class="rt-toolbar" style="gap:6px;padding:8px 12px">
      <input class="rt-input" style="width:165px" value="shard:1..6 OR rt_dsh.*" />
      <span class="rt-tag rt-tag-live">6 大无冲突分片</span>
      <span class="rt-tag rt-tag-active">48 核心模块</span>
      <span class="rt-tag rt-tag-passive">PG 探针 42 writes/min</span>
      <div class="rt-spacer"></div>
      <span class="rt-tag rt-tag-live">PG 16 Wire v3 · 0.4ms</span>
      <button class="rt-btn rt-btn-primary" style="padding:4px 9px">+ 注册分片锁</button>
    </div>
    <div style="height:4px;background:rgba(148,163,184,0.18);overflow:hidden">
      <div style="width:100%;height:100%;background:linear-gradient(90deg, #4D6BFE, #0EA5E9, #10B981)"></div>
    </div>
    <div class="rt-split">
      <!-- Left Pane: 6 File-Disjoint Shards (Shard #1..#6) -->
      <div class="rt-list" style="width:252px">
        <div class="rt-section">File-Disjoint 6 并发无交集分片</div>
        <div class="rt-item on">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #1 · pg-engine.js</span>
            <span class="rt-tag rt-tag-live">exploit#1+sub</span>
          </div>
          <div class="rt-item-desc">PostgreSQL 16 Wire v3 + 实时写表探针 + WAL</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #2 · concurrency.js</span>
            <span class="rt-tag rt-tag-live">exploit#2+sub</span>
          </div>
          <div class="rt-item-desc">6/12 自适应并发槽 + maxDepth:3 递归子代理 (low)</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #3 · styles.js</span>
            <span class="rt-tag rt-tag-live">exploit#3</span>
          </div>
          <div class="rt-item-desc">DSH Brand Blue (#4D6BFE) + Bento 与 DAG 样式令牌</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #4 · client.js</span>
            <span class="rt-tag rt-tag-live">exploit#4</span>
          </div>
          <div class="rt-item-desc">Bento 环形图仪表盘 + DAG 画布 + 文稿主从墙</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #5 · prompts.js</span>
            <span class="rt-tag rt-tag-active">exploit#5</span>
          </div>
          <div class="rt-item-desc">8-Role gstack 提示词契约 + 递归 thinking: low 规范</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">Shard #6 · build &amp; tests</span>
            <span class="rt-tag rt-tag-passive">exploit#6 · QA</span>
          </div>
          <div class="rt-item-desc">Cordis 单包产物构建器 + 18 套件 888 断言门禁</div>
        </div>
      </div>

      <!-- Right Pane: PostgreSQL 16 Live Table Write Probe & Shard Contract Inspector -->
      <div class="rt-pane">
        <div class="rt-card">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;white-space:nowrap">
            <span class="rt-tag rt-tag-live">● LIVE PROBE</span>
            <b style="font-size:12px;color:#0F172A">PostgreSQL 16 实时写表探针 (rt_dsh_desktop)</b>
            <span class="rt-mono" style="margin-left:auto;font-size:10.5px;color:#2563EB;font-weight:700">1,480 TX · 0 冲突</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:5px;font-size:11px">
            <div class="rt-atest-row" style="padding:5px 8px">
              <span class="rt-mono" style="width:108px;font-weight:700;color:#2563EB">rt_dsh.modules</span>
              <span class="rt-tag rt-tag-live" style="width:72px;text-align:center">INSERT</span>
              <span style="flex:1;color:#334155">Writer: <code>exploit#2</code> · 48 模块拓扑与依赖入库</span>
              <span class="rt-mono" style="color:#10B981;font-weight:700">0.3ms</span>
            </div>
            <div class="rt-atest-row" style="padding:5px 8px">
              <span class="rt-mono" style="width:108px;font-weight:700;color:#2563EB">rt_dsh.dag_nodes</span>
              <span class="rt-tag rt-tag-active" style="width:72px;text-align:center">UPDATE</span>
              <span style="flex:1;color:#334155">Writer: <code>plan (Captain)</code> · 4-Wave 节点状态流转</span>
              <span class="rt-mono" style="color:#10B981;font-weight:700">0.4ms</span>
            </div>
            <div class="rt-atest-row" style="padding:5px 8px;background:#F0F9FF;border-color:rgba(14,165,233,0.3)">
              <span class="rt-mono" style="width:108px;font-weight:700;color:#0284C7">rt_dsh.subagents</span>
              <span class="rt-tag rt-tag-live" style="width:72px;text-align:center">SPAWN(low)</span>
              <span style="flex:1;color:#0F172A">Writer: <code>exploit#1→sub#1a</code> · 递归子代理 (low)</span>
              <span class="rt-mono" style="color:#0284C7;font-weight:700">0.5ms</span>
            </div>
            <div class="rt-atest-row" style="padding:5px 8px">
              <span class="rt-mono" style="width:108px;font-weight:700;color:#2563EB">rt_dsh.qa_runs</span>
              <span class="rt-tag rt-tag-live" style="width:72px;text-align:center">INSERT</span>
              <span style="flex:1;color:#334155">Writer: <code>qa (QA Lead)</code> · 18 测试套件 888 断言快照</span>
              <span class="rt-mono" style="color:#10B981;font-weight:700">0.4ms</span>
            </div>
            <div class="rt-atest-row" style="padding:5px 8px">
              <span class="rt-mono" style="width:108px;font-weight:700;color:#2563EB">rt_dsh.doc_wall</span>
              <span class="rt-tag rt-tag-passive" style="width:72px;text-align:center">UPSERT</span>
              <span style="flex:1;color:#334155">Writer: <code>internal</code> · 7 份主从墙文稿与飞书回执</span>
              <span class="rt-mono" style="color:#10B981;font-weight:700">0.6ms</span>
            </div>
          </div>
        </div>

        <div class="rt-card">
          <h4>分片契约检查器 · Shard #1 (packages/redteam-store/lib/pg-engine.js)</h4>
          <div class="rt-kv"><b>独占分片锁</b><span><code>Shard #1</code> · 归属 <code>exploit#1</code> 及递归子代理 <code>sub#1a (thinking: low)</code></span></div>
          <div class="rt-kv"><b>协议与隔离</b><span class="rt-mono">PostgreSQL Wire v3 (SCRAM-SHA-256) · CREATE SCHEMA rt_dsh_desktop</span></div>
          <div class="rt-kv"><b>全文检索引擎</b><span class="rt-mono">GIN (to_tsvector('simple', title || ' ' || body)) · 0.4ms 命中</span></div>
          <div class="rt-kv"><b>双模回退加速</b><span class="rt-mono">SQLite WAL + mmap_size=268435456 + busy_timeout=15000</span></div>
        </div>
      </div>
    </div>
  </div>
`

// 4. Shot 4: Report V2 Tab — dsh-harness-one Doc Wall (文稿视图：运行产物主从墙) & Feishu Bot Delivery
const reportBody = `
  <div class="rt-main">
    <div class="rt-toolbar" style="gap:5px;padding:8px 12px">
      <span style="font-weight:700;font-size:11.8px;color:#0F172A">📄 文稿视图：运行产物主从墙 (Doc Wall)</span>
      <span class="rt-tag rt-tag-live">7 份文稿已归档</span>
      <span class="rt-tag rt-tag-active">飞书已送达 ✓</span>
      <div class="rt-spacer"></div>
      <button class="rt-btn" style="padding:3px 7px;font-size:11px">复制 Markdown</button>
      <button class="rt-btn" style="padding:3px 7px;font-size:11px">导出 Word (.docx)</button>
      <button class="rt-btn rt-btn-primary" style="padding:3px 8px;font-size:11px">导出独立 HTML</button>
    </div>

    <div class="rt-split">
      <!-- Left Strip: Ordered Execution Nodes (Doc Wall Master List) -->
      <div class="rt-list" style="width:236px">
        <div class="rt-section">DAG 节点运行产物列表 (7)</div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">① CEO PRD 文稿</span>
            <span class="rt-tag rt-tag-passive">recon</span>
          </div>
          <div class="rt-item-desc">软件研发集群定位与 48 模块边界</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">② Designer UI 令牌规范</span>
            <span class="rt-tag rt-tag-passive">designer</span>
          </div>
          <div class="rt-item-desc">DSH Blue #4D6BFE · 模块化 Bento 规范</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">③ Eng Manager 6 分片契约</span>
            <span class="rt-tag rt-tag-passive">assess</span>
          </div>
          <div class="rt-item-desc">File-Disjoint 6 分片锁与递归子代理</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">⑤ Builder 代码变更摘要</span>
            <span class="rt-tag rt-tag-active">6+4 槽</span>
          </div>
          <div class="rt-item-desc">6 主槽 + 4 递归子代理 (thinking: low)</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">⑥ QA 888 断言回归报告</span>
            <span class="rt-tag rt-tag-live">888 PASS</span>
          </div>
          <div class="rt-item-desc">18 测试套件 100% 通过 · 零冲突校验</div>
        </div>
        <div class="rt-item on">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name">⑦ V2 最终交付报告</span>
            <span class="rt-tag rt-tag-live">当前浏览</span>
          </div>
          <div class="rt-item-desc">internal 汇总全链路事实库自动签发</div>
        </div>
        <div class="rt-item" style="background:#ECFDF5;border-color:rgba(16,185,129,0.35)">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <span class="rt-item-name" style="color:#047857">📨 飞书群聊推送记录</span>
            <span class="rt-tag rt-tag-live">200 OK</span>
          </div>
          <div class="rt-item-desc" style="color:#065F46">Webhook 战报卡片自动推送回执</div>
        </div>
      </div>

      <!-- Right Large Card: Rendered V2 Engineering & QA Delivery Report + Feishu Bot Delivery Card -->
      <div class="rt-pane">
        <div class="rt-card" style="background:linear-gradient(135deg, rgba(77,107,254,0.08), rgba(14,165,233,0.04));border-color:rgba(77,107,254,0.28)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div>
              <div style="font-size:13.5px;font-weight:800;color:#0F172A">⑦ DSH Desktop 软件研发集群 V2 最终交付报告 · v0.15.1</div>
              <div style="font-size:11px;color:#475569;margin-top:2px">由 <code>internal</code> 汇总 8 角色 4-Wave DAG 与 PostgreSQL 事实库自动生成 · 零人工拼接</div>
            </div>
            <span class="rt-wb-badge" style="font-size:11px;padding:4px 9px;white-space:nowrap">QA &amp; CSO 联合签发 ✓</span>
          </div>
        </div>

        <div class="rt-card">
          <h4>一、核心架构升级与研发集群交付清单</h4>
          <div class="rt-atest-row">
            <span class="rt-tag rt-tag-live">P1/P4</span>
            <span style="flex:1"><b>模块化 Bento 统计仪表盘</b>（38.6M Token 环形图 + 42m 18s 耗时环形图 + 集群上下文进度条）</span>
            <span class="rt-tag rt-tag-live">已验收</span>
          </div>
          <div class="rt-atest-row">
            <span class="rt-tag rt-tag-live">P2</span>
            <span style="flex:1"><b>PostgreSQL 实时写表活动探针</b>（左下角常驻探针 + <code>modules/dag_nodes/subagents/qa_runs/doc_wall</code> 监控）</span>
            <span class="rt-tag rt-tag-live">已验收</span>
          </div>
          <div class="rt-atest-row">
            <span class="rt-tag rt-tag-live">P3</span>
            <span style="flex:1"><b>6/12 自适应并发调节与递归子代理</b>（支持子代理再派发子代理 <code>maxDepth: 3</code>，默认 <code>thinking: low</code>）</span>
            <span class="rt-tag rt-tag-live">已验收</span>
          </div>
          <div class="rt-atest-row">
            <span class="rt-tag rt-tag-live">DAG</span>
            <span style="flex:1"><b>dsh-harness-one 可视化 DAG 与主从文稿墙</b>（节点连线画布 + 断点续跑 + 18 套件 888 断言 PASS）</span>
            <span class="rt-tag rt-tag-live">888/888 PASS</span>
          </div>
        </div>

        <!-- Feishu Webhook Delivered Card -->
        <div class="rt-card" style="background:linear-gradient(135deg, #ECFDF5 0%, #F0F9FF 100%);border-color:rgba(16,185,129,0.4)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:12px;color:#065F46">
              <span>📨 飞书机器人自动推送状态卡片 (Feishu Webhook Delivered ✓)</span>
            </div>
            <span class="rt-mono" style="font-size:10.5px;color:#059669;font-weight:700">HTTP 200 OK · 38ms</span>
          </div>
          <div class="rt-kv"><b>Webhook 通道</b><span class="rt-mono">https://open.feishu.cn/open-apis/bot/v2/hook/dsh-cluster-v0151</span></div>
          <div class="rt-kv"><b>推送战报摘要</b><span>「DSH 研发集群 v0.15.1」6+4 递归并发构建完成 · 1,480 次 PG 写表零冲突 · 888 条断言全绿</span></div>
          <div class="rt-kv"><b>附带文稿链接</b><span>① PRD · ② UI 规范 · ③ 6 分片契约 · ⑥ QA 报告 · ⑦ V2 最终交付报告（一键直达文稿墙）</span></div>
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
  },
  {
    file: 'ui-agents-dag.png',
    activeGroup: 'resources',
    activeTab: 'agents',
    bodyHtml: agentsBody,
  },
  {
    file: 'ui-assets-pg.png',
    activeGroup: 'assets',
    activeTab: 'assets',
    bodyHtml: assetsBody,
  },
  {
    file: 'ui-report-v2.png',
    activeGroup: 'report',
    activeTab: 'report',
    bodyHtml: reportBody,
  },
]

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ui-shots-'))

for (const shot of SHOTS) {
  const htmlPath = path.join(tmpDir, shot.file.replace(/\.png$/, '.html'))
  const outPath = path.join(OUT_DIR, shot.file)
  const html = renderWorkbenchShell({
    activeGroup: shot.activeGroup,
    activeTab: shot.activeTab,
    bodyHtml: shot.bodyHtml,
    chatHtml: DEFAULT_CHAT_HTML,
  })
  fs.writeFileSync(htmlPath, html, 'utf8')
  execFileSync('chromium', [
    '--headless',
    '--no-sandbox',
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
