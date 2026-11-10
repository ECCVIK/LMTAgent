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
 *   ⑤ 工程模式库分类（`公开接口与免鉴权数据源`、`鉴权策略与开放平台契约`）。
 */
import { readFileSync } from 'node:fs'
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
ok(registeredSlots.length >= 4, `apply 注册了多区域工作台槽位（实际 ${registeredSlots.length} 个）`)
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

console.log(`\n通过 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
