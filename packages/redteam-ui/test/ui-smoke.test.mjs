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
import { resolveRootSessionId } from '../lib/index.js'

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
ok(registered !== null && registered.id === 'dsh-redteam-ui', `注册模块 id 为 dsh-redteam-ui（实际：${registered && registered.id}）`)

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
  '.rt-node-handle',
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
  /rt-ov-kpi-grid[\s\S]*沟通与执行[\s\S]*并发集群[\s\S]*上下文与缓存[\s\S]*交付里程碑/.test(source)
  && !source.includes("className: 'rt-analytics-trio'"),
  'client.js 在 OverviewTab 使用精简 .rt-ov-kpi-grid 四宫格指标卡并彻底剔除重复 .rt-analytics-trio 环形图堆砌',
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
  '.rt-n8n-diamond-pin',
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
  '跳转侧边聊天框打开该 Agent 会话',
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
  'rt-pri-badge',
  'rt-digest-box',
  'rt-plan-approve-btn',
  'planApproveWorker',
]
for (const token of V020_TREE_AND_LMTEX_TOKENS) {
  ok(source.includes(token), `client.js 包含 v0.20.0 横向/纵向开发树切换、全宽底部流程区与 lmtex 闭环标记「${token}」`)
}

const bRowKpiIdx = source.indexOf("className: 'rt-ov-kpi-grid'")
const bRowCanvasIdx = source.indexOf("className: 'rt-bento-row-canvas'")
const bRowHeroIdx = source.indexOf("className: 'rt-ov-hero'")
ok(
  bRowKpiIdx !== -1 && bRowCanvasIdx !== -1 && bRowHeroIdx !== -1 && bRowKpiIdx < bRowCanvasIdx && bRowCanvasIdx < bRowHeroIdx,
  'OverviewTab 采用 v0.22.0 极简三段结构：4-KPI 指标条 (.rt-ov-kpi-grid) -> 实时路线图画布 (.rt-bento-row-canvas) -> 四阶段里程碑条 (.rt-ov-hero)',
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
  /svg\.rt-h-wave-branch-line\s*\{[^}]*background\s*:\s*none/s.test(PANEL_CSS),
  'styles.js (PANEL_CSS) 包含 svg.rt-h-wave-branch-line 背景重置（background: none）',
)

/* ── 9. v0.22.0 1:1 会话强隔离、独立「协同与审批」页、单一视图切换器、SVG 绝对定位与 6 槽位去重契约 ── */
console.log('— 冒烟九：v0.22.0 1:1 会话强隔离、独立协同页、单一 UiModeSwitcher、SVG 几何修复与宿主槽位去重')
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
  (PANEL_CSS.includes('.rt-h-fanout-col') || source.includes('rt-h-fanout-col'))
    && (/\.rt-h-root-fanout-svg\s*\{[^}]*position\s*:\s*absolute/s.test(PANEL_CSS)
      || /rt-h-root-fanout-svg[\s\S]{0,260}position\s*:\s*['"]absolute['"]/.test(source)),
  '横向派生树扇出连线采用 .rt-h-fanout-col 容器 + .rt-h-root-fanout-svg 绝对定位几何，消除流式高度撑大错位',
)

console.log(`\n通过 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
