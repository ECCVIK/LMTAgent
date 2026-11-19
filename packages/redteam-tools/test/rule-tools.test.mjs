/**
 * 判定规则的"工具层"回归测试（零依赖，lmt_* 工具集）
 *
 * 跑法：node packages/redteam-tools/test/rule-tools.test.mjs
 */
import { register } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

register(new URL('data:text/javascript,export function resolve(s,c,n){if(s==="@deepseek-ai/dsh-tools")return{shortCircuit:true,url:"data:text/javascript,export const defineTool=(t)=>t"};return n(s,c)}'), import.meta.url)

const { apply } = await import('../lib/index.js')
const { RedteamStore } = await import('../../redteam-store/lib/core.js')

const root = mkdtempSync(join(tmpdir(), 'lmt-rule-tools-'))
const store = new RedteamStore(root)
store.openEngagement('工具规则测试')
const tools = new Map()
apply({ lmtagent: store, tools: { register: (t) => tools.set(t.name, t) } })
const call = async (n, a) => JSON.parse(await tools.get(n).execute(a || {}, { agent: { session: { id: 's1' } } }))
let pass = 0
let fail = 0
const ok = (cond, msg) => { if (cond) { pass += 1; console.log(`  ✓ ${msg}`) } else { fail += 1; console.log(`  ✗ ${msg}`) } }

try {
  /* 自己注册的账号：记录但明确不计分 */
  const self = await call('lmt_artifact_record', {
    kind: 'evidence', code: 'web-app', points: 50, target: 'http://t/register', evidence: '自建 ztest/1', self_created: true,
  })
  ok(self.counted === false && /自己注册|不计分/.test(self.warning || ''), 'score_hit：自建账号 counted=false 且给出原因')
  ok(self.summary.achievedPoints === 0 && self.summary.selfCreatedHits === 1, 'score_hit：自建账号不加分，summary 单独计数')

  /* 拿到别人已有的账号：照常计分 */
  const real = await call('lmt_artifact_record', {
    kind: 'evidence', code: 'web-app', points: 50, target: 'http://t/admin', evidence: '普通账号 tomcat/Tomcat@2024（普通档 50）',
  })
  ok(real.counted === true && real.summary.achievedPoints === 50,
    'score_hit：拿到已有账号照常计分（普通档 50 分）')

  /* 服务封顶：同一资产同一端口只算一次 */
  const cappedBase = real.summary.achievedPoints
  await call('lmt_artifact_record', {
    kind: 'evidence', code: 'web-app', points: 50, target: 'http://t:80/a', evidence: '普通账号 u2/x（普通档 50）',
  })
  const dup2 = await call('lmt_artifact_record', {
    kind: 'evidence', code: 'web-app', points: 50, target: 'http://t:80/b', evidence: '普通账号 u3/y（普通档 50）',
  })
  ok(dup2.counted === false && dup2.capped_by_service === true,
    'score_hit：同一个系统刷第二个账号 → counted=false（同一系统只算最高权限一次）')
  ok(/已经拿满|只算一次/.test(dup2.warning || ''), 'score_hit：封顶时把原因写进 warning')
  ok(dup2.summary.achievedPoints === cappedBase, 'score_hit：被顶掉的重复命中不给总分加分')
  ok(dup2.service === 't:80', 'score_hit：返回服务去重标签')

  const better = await call('lmt_artifact_record', {
    kind: 'evidence', code: 'web-app', points: 100, target: 'http://t:80/admin', evidence: '管理员 admin/Admin@2024（管理员档 100）',
  })
  ok(better.counted === true, 'score_hit：同一系统升级管理员 → 该条计分')
  ok(better.summary.achievedPoints === 100, `score_hit：按最高权限算（实际 ${better.summary.achievedPoints}）`)

  const otherPort = await call('lmt_artifact_record', {
    kind: 'evidence', code: 'web-app', points: 50, target: 'http://t:9090/a', evidence: '普通账号 u9/z（普通档 50）',
  })
  ok(otherPort.counted === true, 'score_hit：换端口（另一个服务）照常计分')

  const dbDup = await call('lmt_artifact_record', {
    kind: 'evidence', code: 'db-credential', points: 50, target: '10.0.0.5:3306', evidence: 'MySQL root/root（管理员档 50）',
  })
  const dbDup2 = await call('lmt_artifact_record', {
    kind: 'evidence', code: 'db-credential', points: 10, target: '10.0.0.5:3306', evidence: 'MySQL app/app（普通档 10）',
  })
  ok(dbDup.counted === true && dbDup2.counted === false, 'score_hit：同一个库刷第二个账号同样封顶')

  const board = await call('lmt_artifact_query', { kind: 'scores' })
  ok(board.summary.serviceCappedHits >= 2 && board.items.some((p) => p.capped > 0),
    'lmt_artifact_query(kind=scores)：单独计数被封顶条目')

  const chain = await call('lmt_artifact_query', { kind: 'chain' })
  ok(chain.totals.serviceCappedHits >= 2 && chain.stages.some((s) => s.scored.some((x) => x.capped === true)),
    'lmt_artifact_query(kind=chain)：链路里标出被封顶的命中（capped=true）')

  /* 隧道：自己 VPS 上的不算突破 */
  const t1 = await call('lmt_artifact_record', {
    kind: 'tunnel', subkind: 'socks5', listen: '127.0.0.1:1080', entry: 'my vps', entry_kind: 'self-only',
  })
  ok(t1.legit === false && /self-only/.test(t1.warning || ''), 'tunnel：self-only 标注不算突破并给出原因')
  const t2 = await call('lmt_artifact_record', {
    kind: 'tunnel', subkind: 'frp', listen: '127.0.0.1:1081', entry: '目标反弹到我的VPS', entry_kind: 'target-outbound',
  })
  ok(t2.legit === true, 'tunnel：目标侧连出 → 算真隧道')
  const t3 = await call('lmt_artifact_record', {
    kind: 'tunnel', subkind: 'socks5', listen: '127.0.0.1:1082',
  })
  ok(t3.legit === null && /entry_kind/.test(t3.warning || ''), 'tunnel：未声明 entry_kind → 待确认并提示补上')

  /* 会话总览与隧道列表都要暴露判定 */
  const sess = await call('lmt_sessions', {})
  ok(sess.totals.tunnelsLegit === 1 && sess.totals.tunnelsSelfOnly === 1, 'lmt_sessions：分开统计目标侧通道与自建通道')
  ok(sess.tunnels.every((t) => 'legit' in t && 'entry_kind' in t), 'lmt_sessions：每条隧道都带 entry_kind / legit')
  ok(/不算突破/.test(sess.hint || ''), 'lmt_sessions：提示里写清 legit=false 不算突破')
  ok(Array.isArray(sess.engagements) && sess.session_states !== undefined, 'lmt_sessions：同时返回 engagements 与 sessionStates')

  const list = await call('lmt_artifact_query', { kind: 'tunnels' })
  ok(list.items.map((t) => String(t.legit)).join(',') === 'null,true,false',
    `lmt_artifact_query(kind=tunnels)：逐条给出 legit 判定（实际 ${list.items.map((t) => String(t.legit)).join(',')}）`)

  /* finding 带 request 时自动存 HTTP 证据 */
  const vulnWithReq = await call('lmt_artifact_record', {
    kind: 'finding', title: '越权读取用户列表', severity: 'high', status: 'confirmed',
    target: 'http://api.example:8443/api/users', evidence: '返回 200 且含 12000 条姓名/手机号',
    request: 'GET /api/users HTTP/1.1\nHost: api.example:8443', response: 'HTTP/1.1 200 OK\n\n[...]',
  })
  ok(vulnWithReq.http_evidence_id > 0, 'finding：request 自动保存 HTTP 证据')

  /* milestone 带 command 时自动生成动作记录 */
  const stepSelf = await call('lmt_artifact_record', {
    kind: 'milestone', code: 'web-app', target: 'http://self.example:8443/admin',
    evidence: '自建 ztest20 授权管理员', self_created: true, command: 'curl -X POST http://self.example:8443/register',
  })
  ok(stepSelf.counted === false && stepSelf.step_id, 'milestone：自建账号计 0 分，且 command 自动生成动作记录')

  const stepReal = await call('lmt_artifact_record', {
    kind: 'milestone', code: 'web-app', target: 'http://real.example:8443/admin',
    evidence: '厂商账号 svc-demo/Demo@2024', command: 'curl -X POST http://real.example:8443/login',
  })
  ok(stepReal.counted === true && stepReal.step_id, 'milestone：真实账号照常计分，且 command 自动生成动作记录')

  const hitWithVuln = await call('lmt_artifact_record', {
    kind: 'milestone', code: 'web-app', target: 'http://api.example:8443/api/users',
    evidence: '越权读取 12000 条用户数据', vuln_id: vulnWithReq.id,
  })
  ok(hitWithVuln.counted === true, 'milestone：关联带原始请求的漏洞后正常计分')

  const repAuto = await call('lmt_report_export', { format: 'markdown' })
  ok(String(repAuto.markdown || '').includes('curl -X POST http://real.example:8443/login'), '自动动作记录进入 lmt_report_export 报告复现')
  ok(String(repAuto.markdown || '').includes('GET /api/users HTTP/1.1'), 'finding 的 request 自动进入 lmt_report_export 报告复现')

  const repJson = await call('lmt_report_export', { format: 'json' })
  ok(repJson.format === 'json' && Array.isArray(repJson.items) && repJson.items.length > 0, 'lmt_report_export 支持 format=json 结构化导出')

  /* 批量落库 / 范围 / 数据证明 / 清理台账 / 立足点探测 */
  const engId = store.listEngagements()[0].id
  const preScope = await call('lmt_preflight', { check_host: '10.9.1.1' })
  ok(preScope.scope_check && preScope.scope_check.status === 'unscoped', 'lmt_preflight(check_host)：未配置范围时如实返回 unscoped')

  const batchAssets = await call('lmt_artifact_record', {
    kind: 'assets',
    items: [
      { ip: '10.9.1.1', provenance: 'passive', tool: 'fofa', ports: [{ port: 80, service: 'http', title: '测试站点' }] },
      { ip: '10.9.1.2', provenance: 'passive', tool: 'fofa' },
    ],
  })
  ok(batchAssets.ok && batchAssets.counts.assets === 2, 'batch assets：一次导入 2 个资产')

  const firstAsset = store.listAssets(engId, { ip: '10.9.1.1', limit: 1 }).items[0]
  const batchAssess = await call('lmt_artifact_record', {
    kind: 'assess',
    items: [{ asset_id: firstAsset.id, priority: 'high', potential: 'server-host', reason: 'P0 RCE 候选' }],
  })
  ok(batchAssess.ok && batchAssess.assessed === 1 && batchAssess.results[0].priority === 'high', 'batch assess：一次评估 1 条')

  const batchVulns = await call('lmt_artifact_record', {
    kind: 'vulns',
    items: [{
      title: '测试 RCE', severity: 'critical', target: '10.9.1.1:80', evidence: 'id=0',
      request: 'GET / HTTP/1.1\nHost: 10.9.1.1', response: 'HTTP/1.1 200 OK',
    }],
  })
  ok(batchVulns.ok && batchVulns.inserted === 1 && batchVulns.results[0].http_evidence_id > 0, 'batch vulns：批量漏洞 + request 自动 HTTP 证据')

  const proof = await call('lmt_artifact_record', {
    kind: 'data_proof', target: '10.9.1.1', source: 'api', interface: '/api/users',
    fields: ['姓名', '身份证号', '手机号'], row_count: 12000, sample: '张* / 110*** / 138****',
  })
  ok(proof.ok && proof.proof.meets_threshold === true, 'data_proof：12000 条三要素达到门槛')

  const proofList = await call('lmt_artifact_query', { kind: 'data_proofs' })
  ok(proofList.total === 1 && proofList.items[0].fields.length === 3, 'data_proofs：可查询字段与条数')

  const cleanupAdd = await call('lmt_artifact_record', {
    kind: 'cleanup', action: 'add', subkind: 'webshell', target: '10.9.1.1', location: '/upload/x.jsp',
  })
  ok(cleanupAdd.ok && cleanupAdd.item.id > 0, 'cleanup：登记待清理项')

  const cleanupList = await call('lmt_artifact_query', { kind: 'cleanup' })
  ok(cleanupList.total === 1 && cleanupList.items[0].status === 'open', 'cleanup：默认 open 待清理')

  const cleanupDone = await call('lmt_artifact_record', {
    kind: 'cleanup', action: 'update', id: cleanupAdd.item.id, status: 'done',
  })
  ok(cleanupDone.item.status === 'done', 'cleanup：可标记 done')

  const pivot = await call('lmt_preflight', { listen: '127.0.0.1:1', probe_targets: ['10.9.1.1:80'], timeoutMs: 1000 })
  ok(pivot.probe && pivot.probe.ok && pivot.probe.reachable === 0, 'lmt_preflight(probe_targets)：隧道不可达时如实返回 0 可达')
} finally {
  try { store.close() } catch {}
  rmSync(root, { recursive: true, force: true })
}

console.log(`\n通过 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
