/**
 * 工具 schema 结构与精简瘦身回归测试（零依赖）
 *
 * 跑法：node packages/redteam-tools/test/tool-schema.test.mjs
 */
import { register } from 'node:module'

const stubSource = `
function convertNode(node) {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(convertNode)
  const out = {}
  if (node.type === 'object' && node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties)) {
    const nextProps = {}
    const req = []
    for (const [k, v] of Object.entries(node.properties)) {
      if (v && typeof v === 'object' && v.required === true) req.push(k)
      nextProps[k] = convertNode(v)
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'properties' || k === 'required') continue
      out[k] = v
    }
    out.properties = nextProps
    if (Array.isArray(node.required)) out.required = node.required
    else if (req.length > 0) out.required = req
    return out
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'required' && typeof v === 'boolean') continue
    out[k] = k === 'items' ? convertNode(v) : v
  }
  return out
}
export const defineTool = (t) => {
  const properties = {}
  const required = []
  for (const [k, v] of Object.entries(t.parameters || {})) {
    if (v && typeof v === 'object' && v.required === true) required.push(k)
    properties[k] = convertNode(v)
  }
  const inputSchema = { type: 'object', additionalProperties: false, properties }
  if (required.length > 0) inputSchema.required = required
  return { ...t, inputSchema }
}
`
const stubUrl = 'data:text/javascript,' + encodeURIComponent(stubSource)
const hookSource = `export function resolve(s,c,n){if(s==="@deepseek-ai/dsh-tools")return{shortCircuit:true,url:${JSON.stringify(stubUrl)}};return n(s,c)}`
register(new URL('data:text/javascript,' + encodeURIComponent(hookSource)), import.meta.url)

const {
  apply,
  name: pluginName,
  inject: pluginInject,
  RESERVATION_TTL_MS,
  TOOL_SCHEMA_BASELINE_LEGACY_BYTES,
  sessionBindings,
  activeReservations,
  withStructuredErrors,
} = await import('../lib/index.js')
const { ROLE_ORDER, PLANNER_ROLE } = await import('../../redteam-store/lib/core.js')
const { existsSync, readdirSync } = await import('node:fs')
const { join } = await import('node:path')
const { pathToFileURL } = await import('node:url')

async function loadOfficialValidator() {
  const candidates = []
  if (process.env.DSH_TOOLS_PATH) candidates.push(process.env.DSH_TOOLS_PATH)
  const npxRoot = join(process.env.HOME || '', '.npm', '_npx')
  if (existsSync(npxRoot)) {
    for (const dir of readdirSync(npxRoot)) {
      candidates.push(join(npxRoot, dir, 'node_modules/@deepseek-ai/dsh-tools/lib/index.js'))
    }
  }
  candidates.push(join(process.cwd(), 'node_modules/@deepseek-ai/dsh-tools/lib/index.js'))
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        const mod = await import(pathToFileURL(c).href)
        if (typeof mod.assertSupportedJsonSchema === 'function') return mod
      } catch { /* next */ }
    }
  }
  return undefined
}

let pass = 0
let fail = 0
const ok = (cond, msg) => { if (cond) { pass += 1; console.log(`  ✓ ${msg}`) } else { fail += 1; console.log(`  ✗ ${msg}`) } }

ok(pluginName === 'lmtagent-tools', `插件名导出为 lmtagent-tools（${pluginName}）`)
ok(Array.isArray(pluginInject) && pluginInject.includes('lmtagent') && pluginInject.includes('tools'),
  `inject 包含 lmtagent 与 tools（${JSON.stringify(pluginInject)}）`)
ok(TOOL_SCHEMA_BASELINE_LEGACY_BYTES === 28000, `旧版 schema 基准常量为 28000`)
ok(RESERVATION_TTL_MS > 0 && sessionBindings instanceof Map && activeReservations instanceof Map && typeof withStructuredErrors === 'function',
  '保留 sessionBindings / activeReservations / RESERVATION_TTL_MS / withStructuredErrors 导出')

const tools = new Map()
apply({ lmtagent: {}, tools: { register: (t) => tools.set(t.name, t) } })

const legacyCtxTools = new Map()
apply({ redteam: {}, tools: { register: (t) => legacyCtxTools.set(t.name, t) } })
ok(legacyCtxTools.size === 12, '兼容 ctx.redteam 旧版测试桩注入（12 个工具）')

const EXPECTED_TOOLS = [
  'lmt_workflow',
  'lmt_agent_slot',
  'lmt_engagement_open',
  'lmt_session_bind',
  'lmt_session_info',
  'lmt_sessions',
  'lmt_preflight',
  'lmt_role_prompt',
  'lmt_roles',
  'lmt_artifact_record',
  'lmt_artifact_query',
  'lmt_report_export',
]

ok(tools.size === 12, `精确注册 12 个精简 lmt_* 工具（实际 ${tools.size} 个）`)
ok(Array.from(tools.keys()).every((n) => n.startsWith('lmt_')), '所有工具名称均以 lmt_ 开头')
ok(EXPECTED_TOOLS.every((n) => tools.has(n)), '包含全部 12 个规定工具')

const problems = []
const seenObjects = { count: 0 }

function checkSchema(node, path) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach((x, i) => checkSchema(x, `${path}[${i}]`)); return }

  if (node.type === 'object') {
    seenObjects.count += 1
    if (node.additionalProperties !== false) {
      problems.push(`${path}: type=object 必须显式 additionalProperties: false`)
    }
    if (node.properties !== undefined) {
      if (typeof node.properties !== 'object' || Array.isArray(node.properties)) problems.push(`${path}.properties 必须是对象`)
      else for (const [k, v] of Object.entries(node.properties)) checkSchema(v, `${path}.properties.${k}`)
    }
  }
  if (node.type === 'array') {
    if (node.items === undefined) problems.push(`${path}: type=array 必须给 items`)
    else checkSchema(node.items, `${path}.items`)
  }
  if (node.type !== undefined && !['object', 'array', 'string', 'number', 'boolean', 'integer', 'null'].includes(node.type)) {
    problems.push(`${path}: 不支持的 type=${JSON.stringify(node.type)}`)
  }
  if (node.enum !== undefined) {
    if (!Array.isArray(node.enum) || node.enum.length === 0) problems.push(`${path}.enum 必须是非空数组`)
    else if (node.enum.some((v) => typeof v !== 'string')) problems.push(`${path}.enum 只允许字符串枚举`)
  }
  for (const key of ['items', 'additionalProperties']) {
    if (key === 'items' && node.type === 'array') continue
    if (node[key] !== undefined && typeof node[key] === 'object') checkSchema(node[key], `${path}.${key}`)
  }
}

for (const [name, tool] of tools) {
  if (!tool.name || !tool.description || typeof tool.execute !== 'function') {
    problems.push(`${name}: 缺少 name/description/execute`)
    continue
  }
  if (tool.inputSchema !== undefined) checkSchema(tool.inputSchema, `${name}.inputSchema`)
  if (tool.parameters !== undefined) {
    for (const [pname, schema] of Object.entries(tool.parameters)) {
      checkSchema(schema, `${name}.parameters.${pname}`)
    }
  }
}

ok(seenObjects.count > 0, `检查到 ${seenObjects.count} 个 object 类型 schema 节点`)
ok(problems.length === 0, problems.length === 0 ? '全部 12 个工具的所有 object 节点均显式声明 additionalProperties: false 且结构合法' : `发现 ${problems.length} 处 schema 问题`)
for (const p of problems.slice(0, 20)) console.log('      · ' + p)

const official = await loadOfficialValidator()
if (official === undefined) {
  console.log('  · 未找到 DSH 的 schema 校验器（跳过官方校验，已通过完整结构自检）')
} else {
  const bad = []
  for (const [name, tool] of tools) {
    const spec = Object.assign({}, tool.parameters || {})
    try {
      const js = typeof official.parameterSchemaSpecToJsonSchema === 'function'
        ? official.parameterSchemaSpecToJsonSchema(spec)
        : spec
      official.assertSupportedJsonSchema(js)
    } catch (error) {
      bad.push(`${name}: ${error && error.message ? error.message : String(error)}`)
    }
  }
  ok(bad.length === 0, bad.length === 0
    ? `全部 ${tools.size} 个工具通过 DSH 官方 assertSupportedJsonSchema 校验`
    : `${bad.length} 个工具未通过官方校验`)
  for (const b of bad.slice(0, 10)) console.log('      · ' + b)
}

const schemaBytes = Buffer.byteLength(
  JSON.stringify(Array.from(tools.values()).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))),
)
ok(schemaBytes > 1000 && schemaBytes < 14000, `12 个工具完整序列化 Schema 体积 ${schemaBytes} bytes < 14000 bytes（较旧基准 28000 下降 ${Math.round((1 - schemaBytes / TOOL_SCHEMA_BASELINE_LEGACY_BYTES) * 100)}%）`)

console.log('— 关键工具规则与参数契约')
const wf = tools.get('lmt_workflow')
ok(['refine_wish', 'decompose', 'submit_digest', 'approve_worker', 'update_goal', 'add_worker', 'retry_worker', 'sync_workers', 'check_scope', 'dag', 'status'].every((a) => wf.parameters.action.enum.includes(a)),
  'lmt_workflow.action 覆盖 4-Wave DAG 全部编排与 check_scope 动作')
ok(wf.parameters.depends_on !== undefined && wf.parameters.candidate_path !== undefined && wf.parameters.path !== undefined && wf.parameters.file !== undefined,
  'lmt_workflow 支持 depends_on 与 check_scope 的 candidate_path/path/file 参数')

const slot = tools.get('lmt_agent_slot')
ok(['status', 'acquire', 'heartbeat', 'release', 'list_locks'].every((a) => slot.parameters.action.enum.includes(a)),
  'lmt_agent_slot.action 支持 status/acquire/heartbeat/release/list_locks')
ok(slot.parameters.files_owned !== undefined && slot.parameters.worker_task_id !== undefined && slot.parameters.wave !== undefined,
  'lmt_agent_slot 支持 files_owned / worker_task_id / wave')

const rec = tools.get('lmt_artifact_record')
ok(['module', 'contract', 'finding', 'evidence', 'pattern'].every((k) => rec.parameters.kind.enum.includes(k)),
  'lmt_artifact_record.kind 覆盖 module/contract/finding/evidence/pattern')
ok(String(rec.description).includes('自己注册的账号不算得分权限') && rec.parameters.self_created !== undefined,
  'lmt_artifact_record 保留自建账号不计分（self_created）防作弊红线')
ok(/同一系统只算最高权限一次/.test(String(rec.description)) && rec.parameters.points !== undefined && rec.parameters.port !== undefined,
  'lmt_artifact_record 保留系统权限封顶（points/port）红线')
ok(String(rec.description).includes('不算隧道') && rec.parameters.entry_kind.enum.includes('self-only'),
  'lmt_artifact_record 保留隧道 self-only 红线')
ok(rec.parameters.data_scale.enum.includes('large') && rec.parameters.ip_version.enum.includes('6') && rec.parameters.boundary.additionalProperties === false,
  'lmt_artifact_record 支持 data_scale / ip_version / boundary(additionalProperties:false)')

const qry = tools.get('lmt_artifact_query')
ok(['module', 'finding', 'pattern', 'timeline', 'stats', 'chain', 'graph'].every((k) => qry.parameters.kind.enum.includes(k)),
  'lmt_artifact_query.kind 覆盖 module/finding/pattern/timeline/stats/chain/graph')
ok(qry.parameters.offset !== undefined && qry.parameters.assessed.enum.includes('no') && qry.parameters.sort.enum.includes('unassessed'),
  'lmt_artifact_query 支持 offset 分页与 assessed=no / sort=unassessed')

const rolePrompt = tools.get('lmt_role_prompt')
ok(Array.isArray(rolePrompt.parameters.role.enum)
  && ROLE_ORDER.every((r) => rolePrompt.parameters.role.enum.includes(r))
  && rolePrompt.parameters.role.enum.includes(PLANNER_ROLE),
'lmt_role_prompt.role 枚举覆盖全部 8 个角色（含 assess / plan）')
ok(rolePrompt.parameters.reset && rolePrompt.parameters.reset.type === 'boolean',
  'lmt_role_prompt 支持 reset 布尔参数')

const rolesRes = JSON.parse(await tools.get('lmt_roles').execute({}, {}))
ok(rolesRes.ok === true && Array.isArray(rolesRes.roles) && rolesRes.roles.length === 8 && rolesRes.roles.every((r) => typeof r.wave === 'number'),
  'lmt_roles 返回 8 个角色及 Wave 波次归属')

console.log('— 角色工具裁剪（profile）')
const collect = (profile) => {
  const map = new Map()
  apply({ lmtagent: {}, tools: { register: (t) => map.set(t.name, t) } }, { profile })
  return map
}
const reconTools = collect('recon')
const internalTools = collect('internal')
ok(collect('all').size === 12, 'profile=all 保留全部 12 个工具')
ok(reconTools.size === 9 && !reconTools.has('lmt_report_export') && !reconTools.has('lmt_engagement_open') && reconTools.has('lmt_artifact_record'),
  `执行角色 profile=recon 裁掉立项/报告导出，保留 9 个核心工具（实际 ${reconTools.size}）`)
ok(internalTools.size === 10 && internalTools.has('lmt_report_export') && !internalTools.has('lmt_engagement_open'),
  `收尾角色 profile=internal 保留 lmt_report_export（实际 ${internalTools.size}）`)

console.log(`\n通过 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
