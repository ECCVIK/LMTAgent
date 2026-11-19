/**
 * LMTAgent UI 工作台冒烟测试（零依赖，纯 Node）
 *
 * 跑法：node packages/redteam-ui/test/ui-smoke.test.mjs
 *
 * 覆盖：
 *   ① 客户端 bundle 加载、导出契约（apply / inject / engagementByTitle）与多槽位挂载清理；
 *   ② 宿主侧 resolveRootSessionId 会话根解析契约；
 *   ③ p4 工作台组件（`Agent 网络`、`跨 Agent 协作`、`协作任务`）；
 *   ④ p5 工作台组件（`团队任务板`、`树状图`）；
 *   ⑤ 工程模式库分类（`公开接口与免鉴权数据源`、`鉴权策略与开放平台契约`）；
 *   ⑧ v0.21.0 模块化组装器、零攻防残留、许愿向导与闭环控制契约。
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  apply as applyHost,
  name as hostPluginName,
  inject as hostPluginInject,
  resolveRootSessionId,
  sanitizeRepoRelativePath,
  detectDagCycles,
  evaluateWorkspaceBudgetGuard,
  computeWorkspacePerfMetrics,
} from '../lib/index.js'
import { pluginIdentity } from '../lib/update-manager.js'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'lib', 'client.js')
const stylesPath = join(here, '..', 'lib', 'styles.js')
const source = readFileSync(clientPath, 'utf8')
const PANEL_CSS = readFileSync(stylesPath, 'utf8')

let pass = 0
let fail = 0
const ok = (cond, msg) => {
  if (cond) {
    pass += 1
    console.log(`  ✓ ${msg}`)
  } else {
    fail += 1
    console.log(`  ✗ ${msg}`)
  }
}

/* ── 1. 客户端 Bundle 加载与挂载冒烟 ─────────────────────────────────────── */
console.log('— 冒烟一：client.js 加载、导出契约与多区域槽位挂载')
const nodeRequire = createRequire(import.meta.url)
let reactStub
try {
  reactStub = nodeRequire('react')
} catch {
  reactStub = {
    createElement: (type, props, ...children) => ({
      $$typeof: 'stub',
      type,
      props: Object.assign({}, props, children.length ? { children } : {}),
    }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
    useReducer: (r, i) => [i, () => {}],
    useMemo: (f) => f(),
    useCallback: (f) => f(),
    Component: class Component {
      constructor(props) { this.props = props || {} }
      setState() {}
      forceUpdate() {}
      render() { return null }
    },
    Fragment: 'Fragment',
  }
}

const appended = []
const removed = []
const makeEl = (tag) => ({
  tagName: tag,
  textContent: '',
  attributes: {},
  setAttribute(k, v) { this.attributes[k] = v },
  append() {},
  remove() { removed.push(this) },
})
const documentStub = {
  head: { append: (el) => appended.push(el) },
  createElement: (tag) => makeEl(tag),
}

let registered = null
const windowStub = {
  __ModuleLoader__: { load: (def) => { registered = def } },
  location: { hash: '', href: 'http://127.0.0.1:3080/' },
  addEventListener: () => {},
  removeEventListener: () => {},
  open: () => null,
  setTimeout: (f, t) => setTimeout(f, t),
}

ok(/__ModuleLoader__\.load\(/.test(source), 'client.js 通过 __ModuleLoader__.load 注册')
{
  const fn = new Function('window', 'document', 'require', 'navigator', 'setTimeout', 'clearInterval', 'setInterval', 'URL', 'Blob', source)
  let threw = null
  try {
    fn(windowStub, documentStub, (name) => {
      if (name === 'react') return reactStub
      throw new Error('unexpected require: ' + name)
    }, { clipboard: { writeText: () => {} } }, setTimeout, clearInterval, setInterval, URL, Blob)
  } catch (error) {
    threw = error
  }
  ok(threw === null, 'client.js 工厂函数执行不报错' + (threw ? '：' + threw.message : ''))
}
ok(registered !== null && registered.id === 'dsh-lmtagent-ui', `注册模块 id 为 dsh-lmtagent-ui（实际：${registered && registered.id}）`)

const moduleExports = registered.factory((name) => {
  if (name === 'react') return reactStub
  throw new Error('unexpected require: ' + name)
})
ok(typeof moduleExports.apply === 'function' && Array.isArray(moduleExports.inject), '导出 apply 与 inject 数组')
ok(typeof moduleExports.engagementByTitle === 'function', '导出 engagementByTitle 会话标题反查函数')

const registeredSlots = []
const cleanups = []
moduleExports.apply({
  slots: {
    inject: (name, fn) => fn(),
    register: (meta, render) => { registeredSlots.push({ meta, render }) },
  },
  effect: (fn) => {
    const dispose = fn()
    if (typeof dispose === 'function') cleanups.push(dispose)
  },
})
ok(registeredSlots.length === 6, `apply 注册了精准去重后的 6 个工作台槽位（实际 ${registeredSlots.length} 个）`)
ok(appended.length >= 2, `apply 注入了样式标签（实际 ${appended.length} 个）`)
for (const dispose of cleanups) {
  try { dispose() } catch { /* 忽略 */ }
}
ok(removed.length >= 2, `卸载时清理了样式标签（实际 ${removed.length} 个）`)
ok(typeof PANEL_CSS === 'string' && PANEL_CSS.includes('--dsh-frame-chrome-top'), 'styles.js 导出 PANEL_CSS 且包含桌面标题栏安全边距')

/* ── 2. 宿主侧根会话解析冒烟 ─────────────────────────────────────────────── */
console.log('— 冒烟二：resolveRootSessionId 根会话解析契约')
{
  const map = { root: undefined, child: 'root', grand: 'child', selfLoop: 'selfLoop' }
  const ctx = {
    get: (name) => (name === 'sessions'
      ? { list: () => Object.entries(map).map(([id, parent]) => ({ id, header: parent ? { id, parentSession: parent } : { id } })) }
      : undefined),
  }
  ok(resolveRootSessionId(ctx, 'grand') === 'root', '多层子代理会话正确回溯到根会话 root')
  ok(resolveRootSessionId(ctx, 'selfLoop') === 'selfLoop', '自环会话受深度保护不死循环')
}

/* ── 3. p4 与 p5 工作台组件及工程模式库分类契约 ─────────────────────────── */
console.log('— 冒烟三：p4（Agent 网络 / 跨 Agent 协作 / 协作任务）与 p5（团队任务板 / 树状图）工作台组件')
const P4_WORKBENCH_COMPONENTS = ['Agent 网络', '跨 Agent 协作', '协作任务']
for (const label of P4_WORKBENCH_COMPONENTS) {
  ok(source.includes(label), `client.js 包含 p4 工作台组件「${label}」`)
}

const P5_WORKBENCH_COMPONENTS = ['团队任务板', '树状图']
for (const label of P5_WORKBENCH_COMPONENTS) {
  ok(source.includes(label), `client.js 包含 p5 工作台组件「${label}」`)
}

console.log('— 冒烟四：工程模式库（POC_CAT_NAME）分类契约')
const ENGINEERING_PATTERN_CATEGORIES = ['公开接口与免鉴权数据源', '鉴权策略与开放平台契约']
for (const category of ENGINEERING_PATTERN_CATEGORIES) {
  ok(source.includes(category), `client.js 包含工程模式分类「${category}」`)
}

/* ── 5. v0.18.0 全宽画布架构、二维坐标树与泳道矩阵契约 ──────────────────── */
console.log('— 冒烟五：v0.18.0 全宽画布架构、二维坐标树与泳道矩阵契约')
ok(
  /\.rt-p4-workbench\s*\{[^}]*flex-direction\s*:\s*column/s.test(PANEL_CSS)
    && /\.rt-p4-workbench\s*\{[^}]*grid-column\s*:\s*1\s*\/\s*-1/s.test(PANEL_CSS),
  'styles.js 定义 .rt-p4-workbench 为 flex-direction:column 与 grid-column:1 / -1（外层卡片不陷于双列网格）',
)

const V018_CSS_SELECTORS = [
  '.rt-p4-split-grid',
  '.rt-bento-row-canvas',
  '.rt-analytics-trio',
  '.rt-p5-tree-stage',
  '.rt-p5-branches-grid',
  '.rt-tree-port',
]
for (const selector of V018_CSS_SELECTORS) {
  ok(PANEL_CSS.includes(selector), `styles.js 包含 v0.18.0 布局选择器「${selector}」`)
}

const FORBIDDEN_BRACKET_BADGES = ['[主代理]', '[子代理]', '[可续接]']
for (const badge of FORBIDDEN_BRACKET_BADGES) {
  ok(!source.includes(badge), `client.js 已移除方括号硬编码徽章「${badge}」`)
}

ok(
  /rt-bento-row-canvas[\s\S]{0,400}HarnessWorkflowDeck/.test(source),
  'client.js 在 .rt-bento-row-canvas 中渲染全宽 HarnessWorkflowDeck 画布',
)
ok(
  source.includes("className: 'rt-ov-kpi-grid'")
  && /沟通与执行[\s\S]*并发集群[\s\S]*上下文与缓存[\s\S]*交付进度/.test(source)
  && !source.includes("className: 'rt-analytics-trio'")
  && !source.includes("className: 'rt-ov-hero'")
  && source.includes('rt-ov-detail-drawer'),
  'client.js 在 OverviewTab 使用精简可展开 .rt-ov-kpi-grid 四宫格指标卡 + .rt-ov-detail-drawer，并移除旧版 .rt-ov-hero 与 .rt-analytics-trio',
)
ok(
  source.includes('activeSlots') && /Math\.min\(\s*max\s*,/.test(source),
  'client.js 通过 Math.min(max, ...) 截断 activeSlots 防止并发槽按钮溢出上限',
)

/* ── 6. v0.19.0 交互式手抓平移缩放路径树、波次自动折叠、三段式环节执行链与双步跳转契约 ── */
console.log('— 冒烟六：v0.19.0 交互式手抓平移缩放路径树、波次自动折叠、三段式环节执行链与双步跳转契约')
const V019_CSS_SELECTORS = [
  '.rt-panzoom-viewport',
  '.rt-tree-wave-row',
  '.rt-tree-expanded-grid',
  '.rt-tree-edges-svg',
  '.rt-tree-port',
  '.rt-step-chain',
  '.rt-step-node',
  '.rt-agent-inspector-drawer',
  '.rt-jump-chat-btn',
]
for (const selector of V019_CSS_SELECTORS) {
  ok(PANEL_CSS.includes(selector), `styles.js 包含 v0.19.0 布局与透视抽屉选择器「${selector}」`)
}
ok(
  /repeat\(\s*auto-fill\s*,\s*minmax\(\s*215px\s*,\s*1fr\s*\)\s*\)/.test(PANEL_CSS),
  'styles.js 定义 .rt-tree-expanded-grid 自适应最小列宽 repeat(auto-fill, minmax(215px, 1fr))，确保 56+ 子代理自动折行不挤压成细条',
)

const V019_LIFECYCLE_KEYFRAMES = [
  'rt-wire-grow',
  'rt-subnode-spawn',
  'rt-sonar-ripple',
  'rt-dash-flow',
  'rt-hub-absorb',
  'rt-complete-sheen',
  'rt-check-stroke',
]
for (const kf of V019_LIFECYCLE_KEYFRAMES) {
  ok(PANEL_CSS.includes(kf), `styles.js 包含 v0.19.0 全生命周期关键帧动画「${kf}」`)
}

const V019_STEP_CHAIN_LABELS = ['委派目标', '核心执行', '阶段结论']
for (const label of V019_STEP_CHAIN_LABELS) {
  ok(source.includes(label), `client.js 包含三段式环节执行链阶段标签「${label}」`)
}

const V019_INSPECT_JUMP_TOKENS = [
  '跳转会话聊天',
  'openAgentSessionInHostChat',
  'agentSessionDetail',
]
for (const token of V019_INSPECT_JUMP_TOKENS) {
  ok(source.includes(token), `client.js 包含双步透视与宿主聊天框跳转契约「${token}」`)
}

/* ── 7. v0.20.0 60FPS 零重绘拖拽、横向向右派生树与 lmtex Plan-Worker 闭环契约 ── */
console.log('— 冒烟七：v0.20.0 60FPS 零重绘拖拽、横向向右派生树与 lmtex Plan-Worker 闭环契约')
const V020_ZERO_RENDER_TOKENS = [
  '_domTelemCache',
  '_isCanvasDragging',
  'applyStageTransform',
  'stageDomRef',
  'panRef',
]
for (const token of V020_ZERO_RENDER_TOKENS) {
  ok(source.includes(token), `client.js 包含 60FPS 零 React 重绘拖拽与 DOM 遥测缓存标记「${token}」`)
}

const V020_TREE_AND_LMTEX_TOKENS = [
  'rt-tree-layout-horizontal',
  'rt-tree-layout-vertical',
  'rt-tree-layout-setting',
  '横向向右派生',
  '纵向向下派生',
  'rt-wave-horizontal-lane',
  'rt-wave-right-children',
  'rt-lower-process-deck',
  'rt-digest-box',
  'rt-plan-approve-btn',
  'planApproveWorker',
]
for (const token of V020_TREE_AND_LMTEX_TOKENS) {
  ok(source.includes(token), `client.js 包含 v0.20.0 横向/纵向开发树切换、全宽底部流程区与 lmtex 闭环标记「${token}」`)
}

const bRowKpiIdx = source.indexOf("className: 'rt-ov-kpi-grid'")
const bRowCanvasIdx = source.indexOf("className: 'rt-bento-row-canvas'")
const bDetailIdx = source.indexOf("className: 'rt-ov-detail-drawer'")
ok(
  bRowKpiIdx !== -1 && bRowCanvasIdx !== -1 && bDetailIdx !== -1 && bRowKpiIdx < bRowCanvasIdx
  && source.includes('RtMiniDonut') && source.includes('RtStackedBar'),
  'OverviewTab 采用精简两段结构：可展开 4-KPI 指标条 (.rt-ov-kpi-grid + .rt-ov-detail-drawer) -> 实时路线图画布 (.rt-bento-row-canvas)，彻底移除旧版 .rt-ov-hero',
)

/* ── 8. v0.21.0 架构根治与零攻防残留契约 ────────────────────────────────── */
console.log('— 冒烟八：v0.21.0 架构根治与零攻防残留契约')
const assembleStylesPath = join(here, '..', 'tools', 'assemble-styles.mjs')
const assembleClientPath = join(here, '..', 'tools', 'assemble-client.mjs')
ok(existsSync(assembleStylesPath), '存在模块化样式组装脚本 packages/redteam-ui/tools/assemble-styles.mjs')
ok(existsSync(assembleClientPath), '存在模块化前端组装脚本 packages/redteam-ui/tools/assemble-client.mjs')

const FORBIDDEN_V021_OFFENSIVE_LABELS = [
  '粘进 Burp Repeater',
  'redteam_webshell_add',
]
for (const label of FORBIDDEN_V021_OFFENSIVE_LABELS) {
  ok(!source.includes(label), `client.js 不含遗留攻防 UI 标签或工具名「${label}」`)
}

const V021_CLIENT_TOKENS = [
  'rt-exit-full',
  'refineAndDecomposeWish',
  'updateWorkerGoal',
  'retryWorkerTask',
  'feishuConfig',
]
for (const token of V021_CLIENT_TOKENS) {
  ok(source.includes(token), `client.js 支持 v0.21.0 闭环控制与配置能力「${token}」`)
}

ok(
  PANEL_CSS.includes('.rt-wish-wizard'),
  'styles.js (PANEL_CSS) 包含许愿润色向导样式「.rt-wish-wizard」',
)
ok(
  /svg\.rt-tree-edges-svg\s*\{[^}]*background\s*:\s*none/s.test(PANEL_CSS),
  'styles.js (PANEL_CSS) 包含 svg.rt-tree-edges-svg 背景重置（background: none）',
)

/* ── 9. v0.22.0+ 1:1 会话强隔离、统一设置中心、单一视图切换器、阶段无缩放 SVG 几何与 6 槽位契约 ── */
console.log('— 冒烟九：v0.22.0+ 会话隔离、统一设置中心、单一 UiModeSwitcher、SVG 几何契约与噪音清理')
const uiModeMountCount = (source.match(/h\(\s*UiModeSwitcher\b/g) || []).length
ok(
  uiModeMountCount === 1,
  `全局仅在 Panel 顶栏挂载 1 处 UiModeSwitcher（消除总览与向导重复胶囊，实际 ${uiModeMountCount} 处）`,
)

const expectedSlotNames = [
  'shell.overlay',
  'main',
  'sidebar.panellist',
  'conversation.view',
  'conversation.session.header.utilities',
  'settings.section',
]
const actualSlotNames = registeredSlots.map((s) => s.meta.name)
ok(
  expectedSlotNames.every((n) => actualSlotNames.includes(n)) && actualSlotNames.length === 6,
  `宿主槽位收敛为精准 6 项（${actualSlotNames.join(', ')}）`,
)
ok(
  !source.includes('ComposerDockBar')
    && !source.includes('conversation.input.dock')
    && !source.includes('conversation.session.header.actions')
    && !source.includes('sidebar.footer.action'),
  '已彻底移除 ComposerDockBar、conversation.input.dock、header.actions 与 sidebar.footer.action 重复入口',
)
ok(
  !source.includes('WorkBuddy Cluster · p3') && source.includes('RolePromptsHubTab'),
  '集群「智能体与并发」已升级为 p5 实时工作台，并将 8 角色提示词拆分为独立 RolePromptsHubTab',
)
ok(
  source.includes('useScopedSession') && source.includes('sessionOnboarding') && source.includes('协同与审批'),
  '包含 useScopedSession 1:1 会话隔离、sessionOnboarding 跳过/重开状态机与独立「协同与审批」一级页签',
)
ok(
  /svg\.rt-tree-edges-svg\s*\{[^}]*position\s*:\s*absolute/s.test(PANEL_CSS)
    && source.includes('rt-tree-edges-svg')
    && source.includes('rt-tree-port')
    && source.includes('measureBoxInStage'),
  '派生树连线采用阶段无缩放测量 (measureBoxInStage) + 1:1 绝对定位 svg.rt-tree-edges-svg + .rt-tree-port 契约',
)

const FORBIDDEN_V023_UI_NOISE = [
  'PRIORITY_BADGE_META',
  'rt-n8n-diamond-pin',
  'WISH_STARTER_TEMPLATES',
  'P0 主控中枢',
]
for (const noise of FORBIDDEN_V023_UI_NOISE) {
  ok(!source.includes(noise), `client.js 已清理旧 UI 噪音与伪模板标记「${noise}」`)
}

ok(
  source.includes('SettingsHubTab')
    && source.includes('getSettings')
    && source.includes('saveSettings')
    && PANEL_CSS.includes('.rt-settings-shell'),
  '统一设置中心 SettingsHubTab、getSettings/saveSettings RPC 与 .rt-settings-shell 样式完整存在',
)
ok(
  source.includes('CLIENT_PLUGIN_VERSION')
    && source.includes('rt-host-version-mismatch')
    && source.includes('autoAdvanceWave')
    && source.includes('scope_violations')
    && source.includes('rt-scope-violation-warn')
    && source.includes('写盘越界警告：'),
  '包含 CLIENT_PLUGIN_VERSION 宿主版本守卫、autoAdvanceWave 设置项与写盘越界警告 UI 契约',
)

/* ── 10. v1.0.0 宿主模块化拆分、路由契约、回滚与调度基准冒烟 ─────────────────── */
console.log('— 冒烟十：v1.0.0 @lmtagent/ui 宿主插件身份、/lmtagent/* 路由与调度基准契约')
{
  const uiPkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
  ok(uiPkg.name === '@lmtagent/ui' && uiPkg.version === '1.1.1', `package.json 为 @lmtagent/ui@1.1.1（实际：${uiPkg.name}@${uiPkg.version}）`)
  ok(hostPluginName === 'lmtagent-ui', `index.js export name === "lmtagent-ui"（实际：${hostPluginName}）`)
  ok(Array.isArray(hostPluginInject) && hostPluginInject[0] === 'lmtagent', `index.js export inject 首项为 "lmtagent"（实际：${hostPluginInject.join(',')}）`)

  const regRoutes = new Map()
  const hostDisposers = []
  applyHost({
    lmtagent: null,
    skills: { list: () => [], get: async () => undefined },
    agentPresets: { standingKeyFor: async () => 'scope-smoke' },
    get: () => null,
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') hostDisposers.push(d)
    },
    webServer: {
      register(spec) {
        regRoutes.set(spec.path, spec.handler)
        return () => regRoutes.delete(spec.path)
      },
    },
  })
  ok(regRoutes.has('/lmtagent/api') && regRoutes.has('/lmtagent/events'), '注册 /lmtagent/api 与 /lmtagent/events 路由')
  ok(!regRoutes.has('/redteam/api') && !regRoutes.has('/redteam/events'), '不再注册遗留 /redteam/api 与 /redteam/events 路由')
  for (const d of hostDisposers) {
    try { d() } catch { /* ignore */ }
  }

  ok(pluginIdentity({ lmtagent: null }).name === 'dsh-lmtagent', 'update-manager 默认包名回退为 dsh-lmtagent')
  ok(sanitizeRepoRelativePath('/repo', '../evil').ok === false && sanitizeRepoRelativePath('/repo', 'src/a.js') === 'src/a.js', 'sanitizeRepoRelativePath 守卫生效')
  ok(detectDagCycles([{ id: 'a', depends_on: ['b'] }, { id: 'b', depends_on: ['a'] }]).hasCycle === true, 'detectDagCycles 检测环路生效')
  ok(evaluateWorkspaceBudgetGuard({ totalTokens: 1000 }, { maxTokensPerWorkspace: 500 }).tripped === true, 'evaluateWorkspaceBudgetGuard 熔断判定生效')
  ok(computeWorkspacePerfMetrics({}, []).schemaTokenSavedEstimate > 0, 'computeWorkspacePerfMetrics 基准计算生效')
}

console.log(`\n通过 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
