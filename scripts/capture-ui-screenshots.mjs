#!/usr/bin/env node
/**
 * Generate 4 high-resolution (2x Retina) UI screenshots for README showcase
 * using the real STYLE_TEXT from packages/redteam-ui/lib/styles.js and
 * headless Chromium.
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
    height: 42px;
    background: #0F172A;
    color: #F8FAFC;
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 12px;
    border-bottom: 1px solid #1E293B;
    flex-shrink: 0;
  }
  .wb-traffic { display: flex; gap: 7px; margin-right: 8px; }
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
    width: 230px;
    background: #F1F5F9;
    border-right: 1px solid #E2E8F0;
    display: flex;
    flex-direction: column;
    padding: 12px 10px;
    gap: 6px;
    flex-shrink: 0;
  }
  .wb-side-sec {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748B;
    padding: 6px 8px 2px;
  }
  .wb-side-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12.5px;
    color: #334155;
    font-weight: 500;
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
  }
  /* Center DSH Chat / Orchestration Stream */
  .wb-chat {
    width: 450px;
    background: #FFFFFF;
    border-right: 1px solid #E2E8F0;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }
  .wb-chat-head {
    height: 46px;
    padding: 0 16px;
    border-bottom: 1px solid #E2E8F0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    font-weight: 600;
    color: #0F172A;
  }
  .wb-chat-body {
    flex: 1;
    padding: 14px 16px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: linear-gradient(180deg, #F8FAFC 0%, #FFFFFF 100%);
  }
  .wb-msg-user {
    align-self: flex-end;
    max-width: 90%;
    background: linear-gradient(135deg, #4D6BFE, #2563EB);
    color: #FFFFFF;
    padding: 10px 14px;
    border-radius: 12px 12px 2px 12px;
    font-size: 12.5px;
    line-height: 1.55;
    box-shadow: 0 4px 12px rgba(77, 107, 254, 0.22);
  }
  .wb-msg-agent {
    background: #FFFFFF;
    border: 1px solid #E2E8F0;
    border-radius: 12px;
    padding: 12px 14px;
    font-size: 12px;
    line-height: 1.6;
    color: #1E293B;
    box-shadow: 0 2px 6px rgba(15, 23, 42, 0.03);
  }
  .wb-msg-agent-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    color: #0F172A;
    margin-bottom: 6px;
    font-size: 12px;
  }
  .wb-tool-call {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-radius: 7px;
    background: #F8FAFC;
    border: 1px solid #E2E8F0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: #334155;
    margin-top: 5px;
  }
  .wb-tool-call b { color: #2563EB; }
  /* Override .rt-dock so it fills the remaining 760px right pane cleanly */
  .rt-dock {
    position: relative !important;
    top: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    width: 760px !important;
    height: 100% !important;
    flex: 1 !important;
  }
`

function renderWorkbenchShell({ activeGroup, activeTab, bodyHtml, chatHtml }) {
  const groups = [
    ['overview', '态势'],
    ['assets', '资产'],
    ['results', '成果'],
    ['report', '报告'],
    ['resources', '资源'],
  ]
  const subTabsByGroup = {
    overview: [['overview', '全局态势']],
    assets: [['assets', '资产测绘']],
    results: [['findings', '漏洞战果'], ['scores', '得分目标']],
    report: [['report', '报告']],
    resources: [
      ['agents', '智能体'],
      ['sessions', '会话隧道'],
      ['artifacts', '凭据与文件'],
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
        <span>DSH Desktop · LMTAgent Software Factory Cluster</span>
      </div>
      <span class="wb-pill">WorkBuddy × DSH Blue UI</span>
      <span class="wb-pill wb-pill-pg">PostgreSQL 16 Wire v3 · GIN tsvector</span>
      <div style="flex:1"></div>
      <span style="font-size:11.5px;color:#94A3B8;font-family:monospace">ECCVIK/lmtagent · v0.15.1</span>
    </div>

    <div class="wb-workspace">
      <div class="wb-sidebar">
        <div class="wb-side-sec">DSH 工作空间</div>
        <div class="wb-side-item active"><span class="wb-side-dot"></span>dsh-desktop 核心插件集群</div>
        <div class="wb-side-item"><span>📦</span>payment-gateway-v3</div>
        <div class="wb-side-item"><span>🛡️</span>cloud-iam-audit</div>

        <div class="wb-side-sec" style="margin-top:10px">8-Role gstack 编队</div>
        <div class="wb-side-item active"><span class="wb-side-dot"></span>⓪ plan · Captain 主控</div>
        <div class="wb-side-item"><span>①</span>recon · CEO 需求规划</div>
        <div class="wb-side-item"><span>②</span>designer · UI 规范</div>
        <div class="wb-side-item"><span>③</span>assess · Eng Manager</div>
        <div class="wb-side-item"><span>④</span>vuln-scan · CSO 审查</div>
        <div class="wb-side-item active"><span class="wb-side-dot"></span>⑤ exploit · 6× Builder</div>
        <div class="wb-side-item"><span>⑥</span>qa · QA Lead 门禁</div>
        <div class="wb-side-item"><span>⑦</span>internal · Release 发布</div>

        <div style="flex:1"></div>
        <div style="padding:10px;border-radius:10px;background:#FFFFFF;border:1px solid #E2E8F0;font-size:11px;color:#475569;line-height:1.6">
          <div style="font-weight:700;color:#0F172A;margin-bottom:3px">PostgreSQL 事实库引擎</div>
          <div>Schema: <code style="color:#2563EB">rt_dsh_desktop</code></div>
          <div>Concurrency: <b style="color:#2563EB">6 / 6 Active Slots</b></div>
          <div>WAL Sync: <span style="color:#0284C7">0.4ms mmap</span></div>
        </div>
      </div>

      <div class="wb-chat">
        <div class="wb-chat-head">
          <span>💬 主会话 · Captain (plan) 意图拆解与 4-Wave 调度</span>
          <span class="rt-icon-btn on"><span style="font-size:13px">⛨</span><span>RedTeam</span></span>
        </div>
        <div class="wb-chat-body">
          ${chatHtml}
        </div>
      </div>

      <div class="rt-dock" data-open="1">
        <div class="rt-head">
          <div class="rt-title"><span class="rt-dot"></span>RedTeam 控制台</div>
          <span class="rt-tag rt-tag-live">跟随会话</span>
          <select class="rt-input" style="max-width:175px"><option>dsh-desktop 核心插件集群</option></select>
          <div class="rt-spacer"></div>
          <span class="rt-tag">v0.15.1</span>
          <button class="rt-btn">检查更新</button>
          <button class="rt-btn">刷新</button>
          <button class="rt-btn">全面浏览</button>
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
          <span class="rt-wb-badge">PGSQL Wire v3 · 4-Wave DAG · 6 Slots</span>
          <div class="rt-spacer"></div>
          <span>SQLite · dsh-desktop 核心插件集群</span>
          <span>会话 9f8a2c1e · 落盘绑定</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`
}

const DEFAULT_CHAT_HTML = `
  <div class="wb-msg-user">
    重构 dsh-desktop 插件市场与多智能体研发集群模块，接入 PostgreSQL 高并发事实库，按 4-Wave Bounded DAG 满载 6 并发执行并完成 QA 门禁与发布报告。
  </div>
  <div class="wb-msg-agent">
    <div class="wb-msg-agent-head">
      <span class="rt-dot"></span>
      <span>Captain (plan) · 4-Wave Bounded DAG 调度器</span>
      <span class="rt-tag rt-tag-live" style="margin-left:auto">Wave 3 Running</span>
    </div>
    <div>已完成 <b>Wave 1</b>（CEO 需求边界 + Designer UI 令牌）与 <b>Wave 2</b>（Eng Manager 无冲突 6 分片契约冻结），正在满载调度 <b>Wave 3（6/6 Builder 并发槽）</b>：</div>
    <div class="wb-tool-call"><span><b>redteam_agent_slot</b>(action="acquire", role="exploit", slots=6)</span><span style="color:#2563EB;font-weight:600">✓ 6/6 槽就绪</span></div>
    <div class="wb-tool-call"><span><b>subagent</b>(role="exploit#1..6", shard="file-disjoint")</span><span style="color:#0284C7;font-weight:600">⚡ 并行编码中</span></div>
    <div class="wb-tool-call"><span><b>redteam_kb_search</b>(engine="pgsql-gin", query="cordis plugin")</span><span style="color:#2563EB;font-weight:600">✓ 1.2ms 命中</span></div>
  </div>
  <div class="wb-msg-agent">
    <div class="wb-msg-agent-head">
      <span class="rt-dot" style="background:#0EA5E9"></span>
      <span>PostgreSQL Wire v3 事实库实时流</span>
      <span class="rt-tag rt-tag-passive" style="margin-left:auto">Schema: rt_dsh_desktop</span>
    </div>
    <div style="font-size:11.5px;color:#475569">
      · 48 个核心模块已入库 · P0 关键链路 100% 覆盖<br/>
      · 已确认 14 项架构重构成果与安全加固 · 得分达成率 96%<br/>
      · Wave 4（` + '`vuln-scan`' + ` CSO + ` + '`qa`' + ` QA Lead）将在分片合并后自动接棒。
    </div>
  </div>
`

// 1. Overview Tab
const overviewBody = `
  <div class="rt-ov">
    <div class="rt-ov-next">
      <span class="rt-tag rt-tag-live">建议下一步</span>
      <span class="rt-ov-next-text">Wave 3 的 6 个 Builder 分片已完成 88%，可进入「成果 → 漏洞战果」与「报告」核对 CSO 安全审计与 QA 回归基线</span>
      <button class="rt-btn rt-btn-primary">打开 漏洞战果 →</button>
    </div>

    <div class="rt-ov-grid">
      <div class="rt-ov-card">
        <div class="rt-ov-card-head">
          <span class="rt-ov-card-title">目标与覆盖</span>
          <span class="rt-ov-card-link">查看资产 →</span>
        </div>
        <div class="rt-ov-big">42 / 48 <span class="rt-ov-big-sub">已测模块（88%）</span></div>
        <div style="height:6px;border-radius:4px;background:rgba(148,163,184,0.2);overflow:hidden">
          <div style="width:88%;height:100%;background:linear-gradient(90deg, #4D6BFE, #0EA5E9)"></div>
        </div>
        <div class="rt-ov-sub">队列 0 · 构建中 6 · IP/服务节点 36 · 仓库分片 12</div>
      </div>

      <div class="rt-ov-card">
        <div class="rt-ov-card-head">
          <span class="rt-ov-card-title">已确认成果</span>
          <span class="rt-ov-card-link">查看成果 →</span>
        </div>
        <div class="rt-ov-big">14 <span class="rt-ov-big-sub">项已闭环交付 · 待复核 2</span></div>
        <div class="rt-ov-sub">
          <span class="rt-sev rt-sev-critical" style="margin-right:4px">CRITICAL 3</span>
          <span class="rt-sev rt-sev-high" style="margin-right:4px">HIGH 6</span>
          <span class="rt-sev rt-sev-medium" style="margin-right:4px">MEDIUM 5</span>
        </div>
        <div class="rt-ov-sub">验证证据链 / 单测快照 38 份</div>
      </div>

      <div class="rt-ov-card">
        <div class="rt-ov-card-head">
          <span class="rt-ov-card-title">会话与通道</span>
          <span class="rt-ov-card-link">管理通道 →</span>
        </div>
        <div class="rt-ov-big">6 <span class="rt-ov-big-sub">个活跃调试入口（4 端点 + 2 隧道）</span></div>
        <div class="rt-ov-sub">沙箱端点 4/4 在线 · 内网代理隧道 2/2 可用</div>
        <div class="rt-ov-sub">已验证跨边界联调通道 6 条</div>
      </div>

      <div class="rt-ov-card">
        <div class="rt-ov-card-head">
          <span class="rt-ov-card-title">凭据与敏感文件</span>
          <span class="rt-ov-card-link">查看凭据 →</span>
        </div>
        <div class="rt-ov-big">18 <span class="rt-ov-big-sub">配置项 · 24 份架构契约</span></div>
        <div class="rt-ov-sub">PostgreSQL 连接池、Cordis 插件签名与环境变量已托管</div>
      </div>

      <div class="rt-ov-card">
        <div class="rt-ov-card-head">
          <span class="rt-ov-card-title">得分与任务</span>
          <span class="rt-ov-card-link">查看得分 →</span>
        </div>
        <div class="rt-ov-big">960 <span class="rt-ov-big-sub">分（已达成 12/13 里程碑）</span></div>
        <div class="rt-ov-sub">进行中 6 · 待派发 1 · 已完成 28</div>
      </div>

      <div class="rt-ov-card">
        <div class="rt-ov-card-head">
          <span class="rt-ov-card-title">报告就绪度</span>
          <span class="rt-ov-card-link">打开报告 →</span>
        </div>
        <div class="rt-ov-big"><span style="color:#4D6BFE">已就绪</span> <span class="rt-ov-big-sub">28/28 项全部通过</span></div>
        <div class="rt-ov-sub">可一键导出 HTML / Word (.docx) / Markdown 交付报告</div>
      </div>
    </div>

    <div class="rt-ov-rail" style="margin-top:12px">
      <div class="rt-ov-rail-head">研发与演练主线（4-Wave Bounded DAG 实时流水线）</div>
      <div class="rt-ov-stages">
        <div class="rt-ov-stage has" style="--stage:#4D6BFE">
          <div class="rt-ov-node">1</div>
          <div class="rt-ov-stage-name">Wave 1 · 需求与测绘</div>
          <div class="rt-ov-stage-pts">48 模块 · 36 节点</div>
          <div class="rt-ov-stage-cum">✓ CEO + Designer 已完成</div>
        </div>
        <div class="rt-ov-stage has" style="--stage:#0EA5E9">
          <div class="rt-ov-node">2</div>
          <div class="rt-ov-stage-name">Wave 2 · 架构分片锁</div>
          <div class="rt-ov-stage-pts">42 / 48 已覆盖</div>
          <div class="rt-ov-stage-cum">✓ Eng Manager 6 分片冻结</div>
        </div>
        <div class="rt-ov-stage has on" style="--stage:#2563EB">
          <div class="rt-ov-node">3</div>
          <div class="rt-ov-stage-name">Wave 3 · 6 槽并发构建</div>
          <div class="rt-ov-stage-pts">14 成果 · 6 通道</div>
          <div class="rt-ov-stage-cum">⚡ 6× Builder 并行冲刺中</div>
        </div>
        <div class="rt-ov-stage has" style="--stage:#6366F1">
          <div class="rt-ov-node">4</div>
          <div class="rt-ov-stage-name">Wave 4 · 门禁与报告</div>
          <div class="rt-ov-stage-pts">960 分 · 报告就绪</div>
          <div class="rt-ov-stage-cum">✓ CSO + QA + Release 闭环</div>
        </div>
      </div>
    </div>
  </div>
`

// 2. Agents & 4-Wave DAG Tab
const agentsBody = `
  <div class="rt-main">
    <div class="rt-toolbar">
      <span style="font-weight:600">研发集群智能体（8 角色 · 4-Wave DAG）</span>
      <span class="rt-tag rt-tag-passive">并发上限 6</span>
      <span class="rt-tag rt-tag-live">在跑 6 / 剩余 0</span>
      <span class="rt-tag rt-tag-live">PG 引擎已连接</span>
      <div class="rt-spacer"></div>
      <button class="rt-btn">刷新</button>
    </div>
    <div class="rt-pane">
      <div class="rt-card">
        <h4>编队状态 · 6 并发槽实时监控 (WorkBuddy Cluster)</h4>
        <div class="rt-wb-slots" style="margin-bottom:8px">
          <div class="rt-wb-slot on"><span class="rt-dot"></span><span class="rt-mono">SLOT #1</span><span>exploit · Shard-UI</span></div>
          <div class="rt-wb-slot on"><span class="rt-dot"></span><span class="rt-mono">SLOT #2</span><span>exploit · Shard-PG</span></div>
          <div class="rt-wb-slot on"><span class="rt-dot"></span><span class="rt-mono">SLOT #3</span><span>exploit · Shard-DAG</span></div>
          <div class="rt-wb-slot on"><span class="rt-dot"></span><span class="rt-mono">SLOT #4</span><span>exploit · Shard-Store</span></div>
          <div class="rt-wb-slot on"><span class="rt-dot"></span><span class="rt-mono">SLOT #5</span><span>vuln-scan · CSO Audit</span></div>
          <div class="rt-wb-slot on"><span class="rt-dot"></span><span class="rt-mono">SLOT #6</span><span>qa · E2E Benchmark</span></div>
        </div>
        <div style="font-size:11.5px;color:#475569">
          当前 6 个并发槽满载运行中 · 文件无交集分片锁（File-Disjoint Sharding）已启用 · 零写冲突
        </div>
      </div>

      <div class="rt-card">
        <h4>4-Wave Bounded DAG 最优执行排布与并发规则（默认 6 并发）</h4>
        <div class="rt-wb-dag">
          <div class="rt-wb-wave">
            <div class="rt-wb-wave-head">
              <span class="rt-wb-wave-tag">WAVE 1 · 2 SLOTS</span>
              <span class="rt-wb-wave-title">双轨立项</span>
            </div>
            <div class="rt-wb-wave-roles">recon (CEO) + designer (Designer) 并行拆解需求与 UI 规范</div>
          </div>
          <div class="rt-wb-wave">
            <div class="rt-wb-wave-head">
              <span class="rt-wb-wave-tag">WAVE 2 · 1 SLOT</span>
              <span class="rt-wb-wave-title">架构单点锁</span>
            </div>
            <div class="rt-wb-wave-roles">assess (Eng Manager) 冻结接口契约与 File-Disjoint 6 分片</div>
          </div>
          <div class="rt-wb-wave">
            <div class="rt-wb-wave-head">
              <span class="rt-wb-wave-tag">WAVE 3 · 6 SLOTS</span>
              <span class="rt-wb-wave-title">满载并发构建</span>
            </div>
            <div class="rt-wb-wave-roles">最多 6× exploit (Builder) 独占分片并行编码与验证</div>
          </div>
          <div class="rt-wb-wave">
            <div class="rt-wb-wave-head">
              <span class="rt-wb-wave-tag">WAVE 4 · 2→1 SLOTS</span>
              <span class="rt-wb-wave-title">双轨门禁与收尾</span>
            </div>
            <div class="rt-wb-wave-roles">vuln-scan (CSO) + qa (QA Lead) 审计后由 internal 交付</div>
          </div>
        </div>
      </div>

      <div class="rt-card">
        <h4>八位集群角色（gstack 虚拟研发团队对齐）</h4>
        <div style="font-size:11.8px;line-height:1.72;color:#1E293B">
          <b>⓪ 主控指挥 plan（Captain）</b> —— 拆解用户意图、按 4-Wave DAG 调度 6 并发槽、核对 PostgreSQL 事实库<br/>
          <b>① 产品与需求规划 recon（CEO）</b> —— <code>/office-hours</code> + <code>/plan-ceo-review</code>，全量模块与资产测绘（P0/P1 标注）<br/>
          <b>② 交互与视觉设计 designer（Designer）</b> —— <code>/plan-design-review</code> + <code>/design-shotgun</code>，WorkBuddy × DSH Blue 规范<br/>
          <b>③ 系统架构与排期 assess（Eng Manager）</b> —— <code>/plan-eng-review</code>，架构边界锁定与 6 并发无冲突文件分片<br/>
          <b>④ 代码审查与安全 vuln-scan（Reviewer &amp; CSO）</b> —— <code>/review</code> + <code>/cso</code>，静态代码缺陷与 OWASP/STRIDE 审计<br/>
          <b>⑤ 全栈研发与构建 exploit（Builder）</b> —— Wave 3 主力 6 槽并发编码实现、单测构建与深度验证<br/>
          <b>⑥ 质量保障与测试 qa（QA Lead）</b> —— <code>/qa</code> + <code>/benchmark</code>，全量测试套件、端到端回归与独立复核<br/>
          <b>⑦ 文档工程与发布 internal（Doc &amp; Release）</b> —— <code>/ship</code> + <code>/document-release</code>，文档同步、版本归档与闭环交付
        </div>
      </div>
    </div>
  </div>
`

// 3. Assets & PostgreSQL Topology Tab
const assetsBody = `
  <div class="rt-main">
    <div class="rt-toolbar">
      <input class="rt-input" style="width:185px" value="package:redteam-* OR pg-engine" />
      <span class="rt-tag rt-tag-live">全部 48</span>
      <span class="rt-tag rt-tag-active">P0 核心 12</span>
      <span class="rt-tag rt-tag-passive">已验证 42</span>
      <div class="rt-spacer"></div>
      <span class="rt-tag rt-tag-live">PG GIN FTS · 0.8ms</span>
      <button class="rt-btn rt-btn-primary">+ 新增模块/资产</button>
    </div>
    <div style="height:4px;background:rgba(148,163,184,0.18);overflow:hidden">
      <div style="width:88%;height:100%;background:linear-gradient(90deg, #4D6BFE, #0EA5E9)"></div>
    </div>
    <div class="rt-split">
      <div class="rt-list" style="width:255px">
        <div class="rt-section">Wave 3 高并发分片模块 (6)</div>
        <div class="rt-item on">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">pg-engine.js</span>
            <span class="rt-tag rt-tag-live">P0 · 已验证</span>
          </div>
          <div class="rt-item-desc">PostgreSQL Wire v3 + Schema Isolation + 256MB mmap WAL</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">styles.js</span>
            <span class="rt-tag rt-tag-live">P0 · 已验证</span>
          </div>
          <div class="rt-item-desc">WorkBuddy × DSH Brand Blue (#4D6BFE) Design Tokens</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">client.js</span>
            <span class="rt-tag rt-tag-live">P0 · 已验证</span>
          </div>
          <div class="rt-item-desc">4-Wave DAG Cards + 6-Slot Concurrency Meter + Overview</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">concurrency.js</span>
            <span class="rt-tag rt-tag-live">P0 · 已验证</span>
          </div>
          <div class="rt-item-desc">DEFAULT_MAX_AGENTS = 6 · MAX_AGENTS_LIMIT = 12 Gatekeeper</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">prompts.js</span>
            <span class="rt-tag rt-tag-active">P1 · 已验证</span>
          </div>
          <div class="rt-item-desc">8-Role gstack Prompt Contracts (Captain + 7 Specialists)</div>
        </div>
        <div class="rt-item">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
            <span class="rt-item-name">build.mjs</span>
            <span class="rt-tag rt-tag-passive">P1 · 构建器</span>
          </div>
          <div class="rt-item-desc">Single-Package Cordis Bundle Compiler &amp; Preset Generator</div>
        </div>
      </div>

      <div class="rt-pane">
        <div class="rt-card">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span class="rt-sev rt-sev-critical">P0 CORE</span>
            <b style="font-size:13.5px">packages/redteam-store/lib/pg-engine.js</b>
            <span class="rt-tag rt-tag-live" style="margin-left:auto">PostgreSQL 16 Ready</span>
          </div>
          <div class="rt-kv"><b>所属分片</b><span>Shard #2 (exploit-db) · 独占写入锁已确认</span></div>
          <div class="rt-kv"><b>协议栈</b><span class="rt-mono">PostgreSQL Wire Protocol v3 (SCRAM-SHA-256 / Cleartext / Trust)</span></div>
          <div class="rt-kv"><b>隔离模型</b><span class="rt-mono">CREATE SCHEMA IF NOT EXISTS rt_&lt;engagement_id&gt;</span></div>
          <div class="rt-kv"><b>全文索引</b><span class="rt-mono">GIN (to_tsvector('simple', title || ' ' || body))</span></div>
          <div class="rt-kv"><b>本地加速</b><span class="rt-mono">PRAGMA journal_mode=WAL; mmap_size=268435456; busy_timeout=15000</span></div>
        </div>

        <div class="rt-card">
          <h4>架构师 (assess) 与 CSO (vuln-scan) 联合验证记录</h4>
          <div class="rt-atest-row">
            <span class="rt-tag rt-tag-live">PASS</span>
            <span style="flex:1"><b>6 并发槽同时写入压测</b> · 1,200 次事务零 SQLITE_BUSY / 零锁超时</span>
            <span class="rt-mono" style="font-size:11px;color:#64748B">12ms</span>
          </div>
          <div class="rt-atest-row">
            <span class="rt-tag rt-tag-live">PASS</span>
            <span style="flex:1"><b>PG Wire v3 连接池探针</b> · 自动识别 REDTEAM_PG_URL 并建立 Schema 隔离</span>
            <span class="rt-mono" style="font-size:11px;color:#64748B">4ms</span>
          </div>
          <div class="rt-atest-row">
            <span class="rt-tag rt-tag-live">PASS</span>
            <span style="flex:1"><b>全部 18 个测试套件回归</b> · 888 条断言 100% 通过</span>
            <span class="rt-mono" style="font-size:11px;color:#64748B">6.4s</span>
          </div>
        </div>
      </div>
    </div>
  </div>
`

// 4. Report V2 Tab
const reportBody = `
  <div class="rt-main">
    <div class="rt-toolbar">
      <span style="font-weight:600">工程交付与安全审计报告（V2 标准版）</span>
      <span class="rt-tag rt-tag-live">就绪 28 / 28</span>
      <div class="rt-spacer"></div>
      <button class="rt-btn">复制 Markdown</button>
      <button class="rt-btn">导出 Word (.docx)</button>
      <button class="rt-btn rt-btn-primary">导出独立 HTML 报告</button>
    </div>
    <div class="rt-pane">
      <div class="rt-card" style="background:linear-gradient(135deg, rgba(77,107,254,0.08), rgba(14,165,233,0.04));border-color:rgba(77,107,254,0.28)">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:15px;font-weight:700;color:#0F172A">DSH Desktop 软件研发集群交付报告 · v0.15.1</div>
            <div style="font-size:12px;color:#475569;margin-top:3px">由 internal (Doc &amp; Release) 汇总 8 角色 4-Wave DAG 事实库自动生成 · 零人工拼接</div>
          </div>
          <span class="rt-wb-badge" style="font-size:11.5px;padding:4px 10px">QA &amp; CSO 双重签发 ✓</span>
        </div>
      </div>

      <div class="rt-card">
        <h4>一、4-Wave Bounded DAG 执行效能摘要</h4>
        <div class="rt-kv"><b>Wave 1 · 立项与设计</b><span><code>recon</code> (CEO) + <code>designer</code> (Designer) 2 槽并行 · 产出 48 模块拓扑与 WorkBuddy × DSH Blue 规范</span></div>
        <div class="rt-kv"><b>Wave 2 · 架构分片锁</b><span><code>assess</code> (Eng Manager) 1 槽单点冻结 · 划分 6 个 File-Disjoint 无交集开发分片</span></div>
        <div class="rt-kv"><b>Wave 3 · 满载并发构建</b><span>6× <code>exploit</code> (Builder) 6 槽满载并行 · 完成 PG 引擎、UI 升级、18 套单测与 Bundle 打包</span></div>
        <div class="rt-kv"><b>Wave 4 · 门禁与发布</b><span><code>vuln-scan</code> (CSO) + <code>qa</code> (QA Lead) 审计 888 条断言全绿 → <code>internal</code> 归档发布</span></div>
      </div>

      <div class="rt-card">
        <h4>二、核心架构交付物与安全审计清单</h4>
        <div class="rt-atest-row">
          <span class="rt-sev rt-sev-critical">ARCH-01</span>
          <span style="flex:1"><b>PostgreSQL 高并发双模存储引擎</b>（Wire Protocol v3 + Schema 隔离 + 256MB mmap WAL）</span>
          <span class="rt-tag rt-tag-live">已验收</span>
        </div>
        <div class="rt-atest-row">
          <span class="rt-sev rt-sev-high">ARCH-02</span>
          <span style="flex:1"><b>8 角色 gstack 研发团队内化</b>（Captain + CEO/Designer/EM/CSO/Builder/QA/Release）</span>
          <span class="rt-tag rt-tag-live">已验收</span>
        </div>
        <div class="rt-atest-row">
          <span class="rt-sev rt-sev-high">UI-03</span>
          <span style="flex:1"><b>WorkBuddy × DSH Brand Blue (#4D6BFE) 视觉系统</b>（响应式玻璃态顶栏 + 6 槽监控 + DAG 卡片）</span>
          <span class="rt-tag rt-tag-live">已验收</span>
        </div>
        <div class="rt-atest-row">
          <span class="rt-sev rt-sev-medium">QA-04</span>
          <span style="flex:1"><b>全链路自动化回归门禁</b>（18 个测试文件 · 888 条断言 · 零保密信息泄露校验）</span>
          <span class="rt-tag rt-tag-live">888/888 PASS</span>
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
