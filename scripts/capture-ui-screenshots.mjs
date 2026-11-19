#!/usr/bin/env node
/**
 * Render and capture 8 authentic bilingual UI screenshots (4 zh-CN + 4 en-US) into docs/assets/
 * directly from the compiled packages/redteam-ui/lib/client.js and styles.js using headless
 * Edge/Chrome/Chromium (zero fabricated host chrome or static mock HTML).
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CSS } from '../packages/redteam-ui/lib/styles.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'docs', 'assets')
fs.mkdirSync(OUT_DIR, { recursive: true })

function findPlaywrightChromium() {
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'ms-playwright') : null,
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean)
  for (const dir of cacheRoots) {
    if (!fs.existsSync(dir)) continue
    try {
      const entries = fs.readdirSync(dir).filter((d) => /^chromium-\d+/.test(d)).sort().reverse()
      for (const entry of entries) {
        for (const sub of ['chrome-win64/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
          const p = path.join(dir, entry, sub)
          if (fs.existsSync(p)) return p
        }
      }
    } catch { /* ignore */ }
  }
  return null
}

function resolveBrowserBin() {
  const candidates = [
    process.env.CHROMIUM_BIN,
    findPlaywrightChromium(),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'chromium',
    'chromium-browser',
    'google-chrome',
  ].filter(Boolean)
  for (const bin of candidates) {
    if (path.isAbsolute(bin)) {
      if (fs.existsSync(bin)) return bin
      continue
    }
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which'
      execFileSync(cmd, [bin], { stdio: 'ignore' })
      return bin
    } catch { /* try next */ }
  }
  throw new Error('No headless Edge/Chrome/Chromium binary found')
}

const CLIENT_JS = fs.readFileSync(path.join(ROOT, 'packages', 'redteam-ui', 'lib', 'client.js'), 'utf8')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const REACT_UMD_CANDIDATES = [
  path.join(DSH_HOME, 'profiles', 'desktop', 'node_modules', 'react', 'umd', 'react.production.min.js'),
  path.join(DSH_HOME, 'profiles', 'web', 'node_modules', 'react', 'umd', 'react.production.min.js'),
]
const LOCAL_REACT_JS = REACT_UMD_CANDIDATES.find((p) => fs.existsSync(p))
  ? fs.readFileSync(REACT_UMD_CANDIDATES.find((p) => fs.existsSync(p)), 'utf8')
  : null
let LOCAL_REACT_DOM_JS = null

async function ensureReactDomJs() {
  if (LOCAL_REACT_DOM_JS) return LOCAL_REACT_DOM_JS
  const cacheFile = path.join(os.tmpdir(), 'lmt-react-dom-18.3.1.min.js')
  if (fs.existsSync(cacheFile)) {
    LOCAL_REACT_DOM_JS = fs.readFileSync(cacheFile, 'utf8')
    return LOCAL_REACT_DOM_JS
  }
  const urls = [
    'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
    'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
    'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
  ]
  for (const u of urls) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(10000) })
      if (res.ok) {
        const text = await res.text()
        if (text.length > 50000) {
          fs.writeFileSync(cacheFile, text, 'utf8')
          LOCAL_REACT_DOM_JS = text
          return text
        }
      }
    } catch { /* try next */ }
  }
  throw new Error('Failed to fetch react-dom UMD bundle')
}

const MOCK_ENG_ID = 'orderflow-v2'
const MOCK_SESSION_ID = 'orderflow-sess-1000'

function fixtureForLocale(lang) {
  const en = lang === 'en-US'
  const tasks = [
    {
      id: 101, wave: 'wave-1', wave_num: 1, role: 'recon', worker_role: 'recon',
      worker_name: 'wt-w1-recon',
      title: en ? 'Map Order Domain & API Boundaries' : '盘点订单模块接口与数据表边界',
      assigned_goal: en ? 'Audit order, inventory, and webhook API contracts and dependency topology' : '梳理现有订单、库存与支付回调接口，输出模块依赖拓扑与数据流说明',
      status: 'approved', session_id: 'child-recon-101', tokens: 24100, duration_ms: 18400,
      files_owned: ['docs/architecture/**', 'src/domain/order-schema.ts'],
      depends_on: [],
    },
    {
      id: 102, wave: 'wave-1', wave_num: 1, role: 'designer', worker_role: 'designer',
      worker_name: 'wt-w1-designer',
      title: en ? 'Define Console Table & Filter Tokens' : '制定控制台列表与状态流交互规范',
      assigned_goal: en ? 'Define order status badges, filter bar states, and detail drawer specs' : '定义订单状态标签、筛选控件与表单校验交互契约',
      status: 'approved', session_id: 'child-design-102', tokens: 19300, duration_ms: 15200,
      files_owned: ['docs/ui-spec.md', 'src/web/tokens.css'],
      depends_on: [],
    },
    {
      id: 201, wave: 'wave-2', wave_num: 2, role: 'assess', worker_role: 'assess',
      worker_name: 'wt-w2-assess',
      title: en ? 'Freeze OpenAPI & ShardLock Ownership' : '冻结 OpenAPI 契约与 ShardLock 文件分片',
      assigned_goal: en ? 'Lock REST API schemas and assign file-disjoint Wave 3 slices' : '固化订单创建/取消/退款 API Schema，并分配 Wave 3 无交集写盘分片',
      status: 'approved', session_id: 'child-assess-201', tokens: 31200, duration_ms: 21500,
      files_owned: ['api/openapi.yaml', 'src/contracts/**'],
      depends_on: ['wt-w1-recon', 'wt-w1-designer'],
    },
    {
      id: 301, wave: 'wave-3', wave_num: 3, role: 'exploit', worker_role: 'exploit',
      worker_name: 'wt-w3-api',
      title: en ? 'Build Idempotent Order State Machine' : '实现订单状态机与幂等下单服务',
      assigned_goal: en ? 'Implement order state transitions, stock holds, and unit tests' : '实现订单状态机流转、库存预占与幂等键校验单元测试',
      status: 'running', session_id: 'child-api-301', tokens: 48600, duration_ms: 34100,
      files_owned: ['src/services/order/**', 'test/order-service.test.mjs'],
      depends_on: ['wt-w2-assess'],
    },
    {
      id: 302, wave: 'wave-3', wave_num: 3, role: 'exploit', worker_role: 'exploit',
      worker_name: 'wt-w3-ui',
      title: en ? 'Build Order Workbench Table & Drawer' : '实现订单工作台列表与筛选视图',
      assigned_goal: en ? 'Implement order workbench table, filter pills, and detail drawer' : '开发订单列表、状态筛选及详情抽屉组件并接入 API',
      status: 'done', approval_state: 'pending_approval', session_id: 'child-ui-302', tokens: 39800, duration_ms: 29400,
      files_owned: ['src/web/orders/**'],
      depends_on: ['wt-w2-assess'],
    },
    {
      id: 401, wave: 'wave-4', wave_num: 4, role: 'qa', worker_role: 'qa',
      worker_name: 'wt-w4-qa',
      title: en ? 'Run Full Regression & Build Gate' : '运行全量回归测试与构建门禁',
      assigned_goal: en ? 'Run integration suites, check-no-confidential, and verify coverage' : '执行集成测试、静态检查并验证覆盖率达标',
      status: 'queued', session_id: null, tokens: 0, duration_ms: 0,
      files_owned: ['test/e2e/**'],
      depends_on: ['wt-w3-api', 'wt-w3-ui'],
    },
  ]

  const digests = [
    {
      id: 1, worker_task_id: 101, role: 'recon', worker_role: 'recon', worker_name: 'wt-w1-recon',
      what_was_done: en
        ? 'Mapped 14 order and webhook endpoints and documented state transition invariants.'
        : '完成订单与支付模块 14 个核心接口盘点，输出域模型与状态流边界说明。',
      files_touched: ['docs/architecture/order-flow.md', 'src/domain/order-schema.ts'],
      verification: en ? 'Schema validation script passed' : 'Schema 校验脚本通过',
      approved: true, approved_at: '2026-11-19T00:10:00Z',
      scope_ok: true, scope_violations: [],
    },
    {
      id: 2, worker_task_id: 302, role: 'exploit', worker_role: 'exploit', worker_name: 'wt-w3-ui',
      what_was_done: en
        ? 'Implemented OrderList view and drawer filters; also modified shared theme tokens outside shard.'
        : '完成订单列表、多条件筛选与状态流转抽屉；同步调整全局共享样式令牌。',
      files_touched: ['src/web/orders/OrderList.tsx', 'src/web/tokens.css'],
      verification: en ? 'UI unit suite passed 28/28' : 'npm run test:ui 通过 28/28',
      approved: false,
      scope_ok: false,
      scope_violations: ['src/web/tokens.css'],
    },
  ]

  tasks[4].worker_digest = digests[1]

  const shardLocks = [
    { id: 1, worker_name: 'wt-w3-api', pattern: 'src/services/order/**', role: 'exploit', status: 'locked', ttl_sec: 112 },
    { id: 2, worker_name: 'wt-w3-ui', pattern: 'src/web/orders/**', role: 'exploit', status: 'released', ttl_sec: 0 },
    { id: 3, worker_name: 'wt-w4-qa', pattern: 'test/e2e/**', role: 'qa', status: 'queued', ttl_sec: 120 },
  ]

  const children = [
    { id: 'child-recon-101', parentSessionId: MOCK_SESSION_ID, role: 'recon', title: en ? 'Wave 1 · Map Order APIs' : 'Wave 1 · 盘点订单模块接口', status: 'done', tokens: 24100, durationMs: 18400 },
    { id: 'child-design-102', parentSessionId: MOCK_SESSION_ID, role: 'designer', title: en ? 'Wave 1 · UI Token Specs' : 'Wave 1 · 交互规范设计', status: 'done', tokens: 19300, durationMs: 15200 },
    { id: 'child-assess-201', parentSessionId: MOCK_SESSION_ID, role: 'assess', title: en ? 'Wave 2 · Lock Shards' : 'Wave 2 · 冻结契约与分片', status: 'done', tokens: 31200, durationMs: 21500 },
    { id: 'child-api-301', parentSessionId: MOCK_SESSION_ID, role: 'exploit', title: en ? 'Wave 3 · Order State Service' : 'Wave 3 · 订单状态机服务', status: 'running', tokens: 48600, durationMs: 34100 },
    { id: 'child-ui-302', parentSessionId: MOCK_SESSION_ID, role: 'exploit', title: en ? 'Wave 3 · Order Workbench UI' : 'Wave 3 · 订单工作台视图', status: 'done', tokens: 39800, durationMs: 29400 },
  ]

  return {
    en,
    sessionTitle: en ? 'OrderFlow Full-Stack Refactor' : 'OrderFlow 订单闭环重构',
    engName: en ? 'OrderFlow Cluster' : 'OrderFlow 研发集群',
    tasks,
    digests,
    shardLocks,
    children,
    budgetGuard: {
      tripped: false,
      warnNearLimit: false,
      usedTokens: 163000,
      maxTokens: 500000,
      usedCost: 0.42,
      maxCost: 5,
      reason: '',
    },
    perfMetrics: {
      digestCompressionRatioPct: 84.6,
      parallelismEfficiencyPct: 83.3,
      schemaTokenSavedEstimate: 16355,
      scopeCompliancePct: 83.3,
    },
  }
}

function mockOpResponse(body, lang) {
  const f = fixtureForLocale(lang)
  const op = body.op || ''
  if (op === 'version' || op === 'updateCheck') {
    return {
      ok: true,
      current: '1.0.0',
      hostVersion: '1.0.0',
      latest: '1.0.0',
      hasUpdate: false,
      plugin: { name: 'dsh-lmtagent', version: '1.0.0' },
    }
  }
  if (op === 'sessionBinding') {
    return {
      ok: true,
      session: MOCK_SESSION_ID,
      root_session: MOCK_SESSION_ID,
      bound: MOCK_ENG_ID,
      init_state: 'initialized',
      onboarding_dismissed: true,
      has_conversation: true,
      session_title: f.sessionTitle,
      cwd: 'D:/Projects/OrderFlow',
    }
  }
  if (op === 'bootstrap') {
    return {
      ok: true,
      hostVersion: '1.0.0',
      active: MOCK_ENG_ID,
      engagements: [{ id: MOCK_ENG_ID, name: f.engName, cwd: 'D:/Projects/OrderFlow' }],
      host_sessions: [{
        id: MOCK_SESSION_ID,
        title: f.sessionTitle,
        displayLabel: f.sessionTitle,
        model: 'opencode-go/deepseek-v4.1-flash',
        tokens: 163000,
        contextTokens: 74200,
        contextMax: 421000,
        cacheHitPct: 68.4,
        rounds: 6,
        steps: 19,
        speedLabel: '128 tok/s',
        costLabel: '$0.42',
      }],
      session_binding: {
        session: MOCK_SESSION_ID,
        root_session: MOCK_SESSION_ID,
        bound: MOCK_ENG_ID,
        init_state: 'initialized',
        onboarding_dismissed: true,
        has_conversation: true,
        cwd: 'D:/Projects/OrderFlow',
      },
    }
  }
  if (op === 'snapshot') {
    return {
      ok: true,
      engagement: { id: MOCK_ENG_ID, name: f.engName, cwd: 'D:/Projects/OrderFlow' },
      stats: { assets: 14, vulns: 2, steps: 19, pocs: 8 },
      assets: [
        { id: 1, value: 'src/services/order/state-machine.ts', kind: 'service', role: 'exploit', scope: 'internal' },
        { id: 2, value: 'src/web/orders/OrderList.tsx', kind: 'ui', role: 'exploit', scope: 'internal' },
        { id: 3, value: 'api/openapi.yaml', kind: 'contract', role: 'assess', scope: 'internal' },
      ],
      vulns: [],
      budgetGuard: f.budgetGuard,
      perfMetrics: f.perfMetrics,
    }
  }
  if (op === 'agentsStatus') {
    return {
      ok: true,
      used: 2,
      max: 6,
      total_children: f.children.length,
      host_sessions: [{
        id: MOCK_SESSION_ID,
        title: f.sessionTitle,
        model: 'opencode-go/deepseek-v4.1-flash',
        tokens: 163000,
        contextTokens: 74200,
        contextMax: 421000,
        cacheHitPct: 68.4,
        rounds: 6,
        steps: 19,
        speedLabel: '128 tok/s',
        costLabel: '$0.42',
      }],
      agentNetwork: {
        root: { id: MOCK_SESSION_ID, title: f.en ? 'Captain · OrderFlow' : '主控 · OrderFlow', status: 'running', tokens: 163000 },
        children: f.children,
      },
      children: f.children,
      shard_locks: f.shardLocks,
      budgetGuard: f.budgetGuard,
      perfMetrics: f.perfMetrics,
      pg_probe: {
        mode: 'wal',
        total_writes: 84,
        compression_ratio_pct: 84.6,
        approved_workers: 3,
        pending_approvals: 1,
        row_counts: { worker_tasks: 6, worker_digests: 2, shard_locks: 3, plan_goals: 4 },
      },
    }
  }
  if (op === 'workflowDag') {
    return {
      ok: true,
      engagement: MOCK_ENG_ID,
      plan_goals: [{ id: 1, title: f.en ? 'OrderFlow State Machine & Workbench' : 'OrderFlow 订单闭环与工作台', status: 'active' }],
      worker_tasks: f.tasks,
      worker_digests: f.digests,
      shard_locks: f.shardLocks,
      budgetGuard: f.budgetGuard,
      perfMetrics: f.perfMetrics,
    }
  }
  if (op === 'agentSessionDetail') {
    return {
      ok: true,
      sessionId: MOCK_SESSION_ID,
      messages: [
        { role: 'user', preview: f.en ? 'Refactor order state machine and workbench filter drawer with tests' : '重构订单状态机与工作台筛选抽屉，补齐幂等测试', at: '2026-11-19T00:08:11Z' },
        { role: 'assistant', preview: f.en ? 'Wave 1-2 discovery and ShardLock complete; running Wave 3 parallel workers' : '已完成 Wave 1–2 测绘与分片锁定，拉起 Wave 3 并发实现子代理', at: '2026-11-19T00:12:40Z' },
      ],
    }
  }
  if (op === 'getSettings') {
    return {
      ok: true,
      maxAgents: 6,
      maxAgentsSource: 'settings.json',
      maxDepth: 3,
      thinkingEffort: 'low',
      maxTokensPerWorkspace: 500000,
      maxCostPerWorkspace: 5,
      maxAutoRetries: 2,
      speculativeWaveDispatch: true,
      pgUrlConfigured: false,
      pgUrlMasked: '',
      aiPlanner: {
        modelMode: 'follow_session',
        provider: 'opencode-go',
        model: 'deepseek-v4.1-flash',
        reasoningEffort: 'low',
        timeoutMs: 60000,
        scanRepoContext: true,
        customConstraints: f.en
          ? 'Strictly enforce File-Disjoint Sharding and zero external runtime dependencies.'
          : '严格遵守 File-Disjoint Sharding 与零外部运行时依赖约束。',
      },
      dispatchPolicy: {
        dispatchMode: 'hybrid_auto',
        subagentProvider: 'spawn',
        autoWakeOnApprove: true,
        autoAdvanceWave: true,
        speculativeWaveDispatch: true,
        maxTokensPerWorkspace: 500000,
        maxCostPerWorkspace: 5,
        maxAutoRetries: 2,
      },
      uiPreferences: {
        defaultViewMode: 'expert',
        defaultTreeDirection: 'horizontal',
        locale: lang,
      },
      activeSessionRoute: {
        provider: 'opencode-go',
        model: 'deepseek-v4.1-flash',
        reasoningEffort: 'low',
      },
      modelCatalog: [
        { provider: 'opencode-go', id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
        { provider: 'deepseek', id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
      ],
      dbEngine: { mode: 'wal', label: 'SQLite WAL (256MB mmap)' },
    }
  }
  if (op === 'prompts') {
    return {
      ok: true,
      roles: [
        { role: 'plan', title: f.en ? 'Captain / Orchestrator' : 'Captain / 总指挥', stale: false, content: f.en ? 'Clarifies specs, orchestrates 4-Wave DAG, approves digests.' : '负责需求澄清、4-Wave 拆解与摘要审批。' },
        { role: 'exploit', title: f.en ? 'Builder / Full-Stack' : 'Builder / 全栈构建', stale: false, content: f.en ? 'Implements within exclusive files_owned and submits digest.' : '在独占 files_owned 边界内编码并提交 digest。' },
      ],
    }
  }
  if (op === 'consoleDigest') {
    return { ok: true, pendingCount: 1, seq: 1 }
  }
  return { ok: true }
}

function buildHtml(tab, expandKey, lang) {
  const f = fixtureForLocale(lang)
  const reactTag = LOCAL_REACT_JS
    ? `<script>${LOCAL_REACT_JS}</script>`
    : `<script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>`
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8" />
<title>LMTAgent v1.0.0 UI Capture</title>
<style>
  :root {
    --dsh-frame-chrome-top: 0px;
    --dsw-alias-bg-base: #f8fafc;
    --dsw-alias-bg-layer-1: #ffffff;
    --dsw-alias-bg-layer-2: #f1f5f9;
    --dsw-alias-bg-layer-3: #e2e8f0;
    --dsw-alias-border-l1: #e2e8f0;
    --dsw-alias-border-l2: #cbd5e1;
    --dsw-alias-label-primary: #0f172a;
    --dsw-alias-label-secondary: #64748b;
    --dsw-alias-brand-primary: #4d6bfe;
  }
  * { box-sizing: border-box; }
  html, body, #app { margin: 0; padding: 0; width: 100%; height: 100vh; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; background: #f8fafc; color: #0f172a; }
  ${CSS.replace(/\\n/g, '\n')}
</style>
${reactTag}
<script src="/react-dom.js"></script>
</head>
<body>
<div id="app"></div>
<script>
  window.localStorage.setItem('dsh.sessions.current', '${MOCK_SESSION_ID}');
  window.localStorage.setItem('rt_ui_mode', 'expert');
  window.localStorage.setItem('lmt_ui_locale', ${JSON.stringify(lang)});

  const _origFetch = window.fetch.bind(window);
  window.fetch = async (url, init) => {
    const u = String(url || '');
    if (u.includes('/lmtagent/api') || u.includes('/lmtagent/op') || u.includes('/redteam/api') || u.includes('/redteam/op')) {
      const body = init && init.body ? JSON.parse(init.body) : {};
      const res = await _origFetch('/mock-op?lang=' + encodeURIComponent(${JSON.stringify(lang)}), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res;
    }
    if (u.includes('/lmtagent/events') || u.includes('/redteam/events')) {
      return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return _origFetch(url, init);
  };

  let _loadedFactory = null;
  window.__ModuleLoader__ = {
    load(spec) {
      _loadedFactory = spec && spec.factory;
    }
  };
</script>
<script src="/client.js"></script>
<script>
  try { (function mountRealPlugin() {
    const exportsObj = _loadedFactory((name) => {
      if (name === 'react') return window.React;
      throw new Error('Unexpected require: ' + name);
    });
    const slots = {};
    const ctx = {
      effect(fn) { try { fn(); } catch {} },
      slots: {
        register(meta, render) { return { meta, render }; },
        inject(name, factory) { slots[name] = factory(); },
      },
      sessions: {
        useSessions(sel) {
          return sel({ byId: { '${MOCK_SESSION_ID}': { id: '${MOCK_SESSION_ID}', title: ${JSON.stringify(f.sessionTitle)}, displayTitle: ${JSON.stringify(f.sessionTitle)} } } });
        }
      },
    };
    exportsObj.apply(ctx);
    const mainSlot = slots['main'];
    const root = window.ReactDOM.createRoot(document.getElementById('app'));
    root.render(mainSlot.render({ sessionId: '${MOCK_SESSION_ID}', sessionTitle: ${JSON.stringify(f.sessionTitle)} }));

    const targetTab = ${JSON.stringify(tab)};
    const expandKey = ${JSON.stringify(expandKey || '')};
    const clickTab = () => {
      const candidates = {
        overview: ['总览', 'Overview'],
        collab: ['协同与审批', 'Collab'],
        agents: ['集群', 'Cluster'],
        settings: ['设置', 'Settings'],
      }[targetTab] || [];
      const btns = Array.from(document.querySelectorAll('.rt-tab-group, .rt-tab'));
      const btn = btns.find((b) => {
        const txt = (b.textContent || '').trim();
        return candidates.some((c) => txt.startsWith(c));
      });
      if (btn && targetTab !== 'overview') btn.click();
      if (targetTab === 'collab') {
        setTimeout(() => {
          const wizBtn = document.querySelector('.rt-wish-wizard-card button');
          if (wizBtn && /展开|Expand/.test(wizBtn.textContent || '')) wizBtn.click();
        }, 320);
      }
      if (expandKey) {
        setTimeout(() => {
          const cards = Array.from(document.querySelectorAll('.rt-ov-kpi-card'));
          const card = cards.find((c) => (c.textContent || '').includes(expandKey));
          if (card) card.click();
        }, 350);
      }
    };
    setTimeout(clickTab, 450);
  })(); } catch (e) { window.__mountErr = String(e && e.stack ? e.stack : e); }
</script>
</body>
</html>`
}

function launchHeadlessCdp(browserBin, userDataDir) {
  return new Promise((resolve, reject) => {
    const proc = spawn(browserBin, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--window-size=1440,900',
      'about:blank',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let resolved = false
    const timer = setTimeout(() => {
      if (!resolved) {
        try { proc.kill() } catch {}
        reject(new Error('Timed out waiting for browser DevTools CDP'))
      }
    }, 15000)
    proc.stderr.on('data', (chunk) => {
      const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(chunk.toString())
      if (m && !resolved) {
        resolved = true
        clearTimeout(timer)
        resolve({ proc, cdpPort: Number(m[1]) })
      }
    })
    proc.on('exit', (code) => {
      if (!resolved) {
        clearTimeout(timer)
        reject(new Error(`Browser exited early with code ${code}`))
      }
    })
  })
}

async function openCdpSession(cdpPort) {
  let pageTarget = null
  for (let i = 0; i < 30; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json()
    pageTarget = targets.find((t) => t.type === 'page') || targets[0]
    if (pageTarget && pageTarget.webSocketDebuggerUrl) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
    throw new Error('No CDP page target found')
  }
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  let seq = 0
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
  return { ws, send }
}

async function main() {
  const reactDomJs = await ensureReactDomJs()
  const browserBin = resolveBrowserBin()
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1')
    if (u.pathname === '/react-dom.js') {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
      res.end(reactDomJs)
      return
    }
    if (u.pathname === '/client.js') {
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
      res.end(CLIENT_JS)
      return
    }
    if (u.pathname === '/mock-op' && req.method === 'POST') {
      const lang = u.searchParams.get('lang') === 'en-US' ? 'en-US' : 'zh-CN'
      let buf = ''
      req.on('data', (c) => { buf += c })
      req.on('end', () => {
        let body = {}
        try { body = JSON.parse(buf || '{}') } catch {}
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(mockOpResponse(body, lang)))
      })
      return
    }
    const tab = u.searchParams.get('tab') || 'overview'
    const expand = u.searchParams.get('expand') || ''
    const lang = u.searchParams.get('lang') === 'en-US' ? 'en-US' : 'zh-CN'
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(buildHtml(tab, expand, lang))
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lmt-shot-edge-'))
  let browserProc = null
  let cdp = null

  const shots = [
    { file: 'ui-overview-workbench.png', query: '?lang=zh-CN&tab=overview&expand=' + encodeURIComponent('上下文与缓存') },
    { file: 'ui-agents-dag.png', query: '?lang=zh-CN&tab=agents' },
    { file: 'ui-assets-pg.png', query: '?lang=zh-CN&tab=collab' },
    { file: 'ui-report-v2.png', query: '?lang=zh-CN&tab=settings' },
    { file: 'ui-overview-workbench-en.png', query: '?lang=en-US&tab=overview&expand=' + encodeURIComponent('Context & Cache') },
    { file: 'ui-agents-dag-en.png', query: '?lang=en-US&tab=agents' },
    { file: 'ui-assets-pg-en.png', query: '?lang=en-US&tab=collab' },
    { file: 'ui-report-v2-en.png', query: '?lang=en-US&tab=settings' },
  ]

  try {
    const launched = await launchHeadlessCdp(browserBin, userDataDir)
    browserProc = launched.proc
    cdp = await openCdpSession(launched.cdpPort)
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    })

    for (const s of shots) {
      const outPath = path.join(OUT_DIR, s.file)
      const url = `http://127.0.0.1:${port}/${s.query}`
      await cdp.send('Page.navigate', { url })
      await new Promise((r) => setTimeout(r, 1500))
      const evalRes = await cdp.send('Runtime.evaluate', {
        expression: `({ rootLen: (document.getElementById('app')?.innerHTML || '').length, tabs: document.querySelectorAll('.rt-tab').length, err: document.querySelector('.rt-err:not(.rt-scope-violation-warn):not(.rt-host-version-mismatch)')?.textContent || '', mountErr: window.__mountErr || '' })`,
        returnByValue: true,
      })
      const val = evalRes.result?.value || {}
      console.log(`State for ${s.file}:`, JSON.stringify(val))
      if (!val.rootLen || val.err || val.mountErr) {
        throw new Error(`Screenshot pre-check failed for ${s.file}: ${JSON.stringify(val)}`)
      }
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'))
      console.log(`Captured ${s.file} (${fs.statSync(outPath).size} bytes)`)
    }
  } finally {
    try { if (cdp && cdp.ws) cdp.ws.close() } catch {}
    try { if (browserProc) browserProc.kill() } catch {}
    server.close()
    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch {}
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
