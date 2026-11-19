/**
 * 知识库工具回归测试（零依赖，lmt_artifact_record / lmt_artifact_query）
 *
 * 跑法：node packages/redteam-tools/test/poc-tools.test.mjs
 */
import { register } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

register(new URL(
  'data:text/javascript,export function resolve(s,c,n){if(s==="@deepseek-ai/dsh-tools")return{shortCircuit:true,url:"data:text/javascript,export const defineTool=(t)=>t"};return n(s,c)}',
), import.meta.url)

const { apply } = await import('../lib/index.js')
const { RedteamStore } = await import('../../redteam-store/lib/core.js')

let pass = 0
let fail = 0
const ok = (cond, msg) => { if (cond) { pass += 1; console.log(`  ✓ ${msg}`) } else { fail += 1; console.log(`  ✗ ${msg}`) } }

const root = mkdtempSync(join(tmpdir(), 'lmt-poctools-'))
let store
let other
try {
  store = new RedteamStore(root)
  store.openEngagement('工具测试工作区')
  const tools = new Map()
  apply({ lmtagent: store, tools: { register: (t) => tools.set(t.name, t) } })
  const exec = (name, args) => tools.get(name).execute(args, { agent: { session: { id: 's1' } } })
  const call = async (name, args) => JSON.parse(await exec(name, args || {}))

  /* 1) 工具齐全 */
  ok(tools.size === 12 && tools.has('lmt_artifact_query') && tools.has('lmt_artifact_record'),
    `工具集精简为 12 个且含 lmt_artifact_query / lmt_artifact_record（实际 ${tools.size}）`)

  /* 2) 两层都没有 → 给出联网检索或自行编写回填指引 */
  const empty = await call('lmt_artifact_query', { kind: 'pattern', q: 'zzz-这个组件不存在-zzz' })
  ok(empty.count === 0 && (empty.templates || []).length === 0 && /互联网|自行编写/.test(empty.hint),
    '两层都没命中时，给出联网搜索或自行编写然后回填的指引')

  /* 2b) 本机 nuclei 模板库也算现成模板 */
  const tpl = await call('lmt_artifact_query', { kind: 'pattern', q: 'CVE-2023-21839' })
  if (tpl.local_templates && tpl.local_templates.total > 0) {
    ok(tpl.local_templates.dir && (tpl.templates || []).length > 0, `本机模板库纳入检索（${tpl.local_templates.total} 条）`)
    ok((tpl.templates || []).some((t) => /CVE-2023-21839/i.test(t.path)), '按 CVE 能命中模板文件路径')
    ok(/命中现成的/.test(tpl.hint), '模板命中时提示直接复用')
  } else {
    console.log('  · 本机没有 nuclei 模板目录，跳过模板库断言')
  }

  /* 3) 落库：互联网来源 + 已验证 */
  const added = await call('lmt_artifact_record', {
    kind: 'pattern',
    title: 'Weblogic T3 反序列化 CVE-2023-21839',
    subkind: 'exp',
    cve: 'CVE-2023-21839',
    component: 'Weblogic',
    versions: '12.2.1.3 / 12.2.1.4 / 14.1.1',
    language: 'python',
    source: 'web',
    description: 'T3 协议反序列化',
    usage: 'python3 poc.py -t https://TARGET:7001',
    content: 'import socket\n# payload',
    verified: true,
    verified_note: '10.1.2.3:7001 返回命令回显',
    tags: 'java,反序列化,rce',
    agent: 'vuln-scan',
  })
  ok(added.ok === true && added.created === true, `新增 pattern 成功（${added.code}）`)
  ok(added.verified === true, '验证状态被记录')
  ok(/\.py$/.test(added.path || ''), '正文按语言落盘为 .py 文件')

  /* 4) 检索：关键字 / CVE / 正文 / 只查已验证 */
  const byKeyword = await call('lmt_artifact_query', { kind: 'pattern', q: 'weblogic' })
  ok(byKeyword.count === 1 && byKeyword.items[0].code === added.code, '按组件关键字能检索到')
  ok(byKeyword.hint.startsWith('命中现成的'), '知识库命中时提示直接取用')
  const byCve = await call('lmt_artifact_query', { kind: 'pattern', cve: '2023-21839' })
  ok(byCve.count === 1, '按 CVE 编号能检索到')
  const byBody = await call('lmt_artifact_query', { kind: 'pattern', q: 'socket' })
  ok(byBody.count === 1, '正文关键词也能检索到（FTS 覆盖 content）')
  const onlyVerified = await call('lmt_artifact_query', { kind: 'pattern', verified: true })
  ok(onlyVerified.count === 1, '可按已验证过滤')

  /* 5) 取全文 + 复用计数 + 补验证结论 */
  const got = await call('lmt_artifact_query', { kind: 'pattern', code: added.code })
  ok(got.content.includes('import socket'), 'lmt_artifact_query(kind=pattern, code) 能取到完整正文')
  const used = await call('lmt_artifact_record', { kind: 'pattern', action: 'use', code: added.code, used_on: '工具测试工作区' })
  ok(used.hit_count === 1, '复用计数 +1')
  const updated = await call('lmt_artifact_record', { kind: 'pattern', action: 'update', code: added.code, verified_note: '复核通过' })
  ok(updated.verified === true && updated.verified_note === '复核通过', '可补验证结论')

  /* 6) 未验证的条目 verified=0 */
  const selfMade = await call('lmt_artifact_record', {
    kind: 'pattern', title: '泛微 OA 前台 SQL 注入', subkind: 'poc', component: '泛微 OA', source: 'self', content: 'sqlmap -u ...',
  })
  const selfRow = await call('lmt_artifact_query', { kind: 'pattern', code: selfMade.code })
  ok(selfRow.verified === 0, '未验证条目 verified=0（不会被误当可直接用）')

  /* 7) 跨工作区共享：换一个工作区（兼容 ctx.redteam 桩）仍能检索到 */
  other = new RedteamStore(root)
  other.openEngagement('另一个工作区')
  const tools2 = new Map()
  apply({ redteam: other, tools: { register: (t) => tools2.set(t.name, t) } })
  const shared = JSON.parse(await tools2.get('lmt_artifact_query').execute({ kind: 'pattern', q: 'weblogic' }, { agent: { session: { id: 's2' } } }))
  ok(shared.count === 1, '知识库跨工作区共享（新工作区/新会话也能命中）')

  /* 8) 同 code 再存合并刷新，不产生重复条目 */
  const again = await call('lmt_artifact_record', {
    kind: 'pattern', title: 'Weblogic T3 反序列化 CVE-2023-21839', code: added.code, content: '# v2', subkind: 'exp',
  })
  const all = await call('lmt_artifact_query', { kind: 'pattern' })
  ok(again.created === false && all.count === 2, '同 code 再存是合并刷新，不产生重复条目')
  ok((await call('lmt_artifact_query', { kind: 'pattern', code: added.code })).content === '# v2', '合并时正文被更新')
} finally {
  try { other && other.close() } catch {}
  try { store && store.close() } catch {}
  rmSync(root, { recursive: true, force: true })
}

console.log(`\n通过 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
