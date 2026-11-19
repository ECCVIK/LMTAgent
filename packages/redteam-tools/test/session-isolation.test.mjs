/**
 * LMTAgent v1.0.0 会话隔离、并发闸门、4-Wave DAG（含 check_scope）与环境预检回归测试（零依赖）
 *
 * 跑法：node packages/redteam-tools/test/session-isolation.test.mjs
 */
import { register } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

register(new URL('data:text/javascript,export function resolve(s,c,n){if(s==="@deepseek-ai/dsh-tools")return{shortCircuit:true,url:"data:text/javascript,export const defineTool=(t)=>t"};return n(s,c)}'), import.meta.url)

const { apply } = await import('../lib/index.js')
const { RedteamStore, POC_CATEGORIES, dispatch } = await import('../../redteam-store/lib/core.js')

let pass = 0
let fail = 0
const ok = (cond, msg) => { if (cond) { pass += 1; console.log(`  ✓ ${msg}`) } else { fail += 1; console.log(`  ✗ ${msg}`) } }

function makeSession(store, id, parentSession) {
  return {
    id,
    header: parentSession === undefined ? { id } : { id, parentSession },
    store: { get: (sid) => store.get(sid) },
  }
}

delete process.env.FOFA_KEY
delete process.env.REDTEAM_MAX_AGENTS
delete process.env.LMTAGENT_MAX_AGENTS
const root = mkdtempSync(join(tmpdir(), 'lmt-v100-iso-'))
const store = new RedteamStore(join(root, 'lmtagent'))

try {
  const registry = new Map()
  const main1 = makeSession(registry, 'main1')
  const recon1 = makeSession(registry, 'recon1', 'main1')
  const main2 = makeSession(registry, 'main2')
  for (const s of [main1, recon1, main2]) registry.set(s.id, s)

  const tools = new Map()
  apply({
    lmtagent: store,
    tools: { register: (t) => tools.set(t.name, t) },
    get: (name) => (name === 'subagents' ? { listChildren: async () => [] } : undefined),
    on: () => {},
  })
  const call = async (n, a, session) => JSON.parse(await tools.get(n).execute(a || {}, { agent: { session: session || main1 } }))

  console.log('— 会话隔离与 lmt_session_bind 动作')
  const opened1 = await call('lmt_engagement_open', { name: '甲公司' }, main1)
  ok(opened1.ok === true && opened1.bind_current === false, 'lmt_engagement_open：有会话 id 时默认 bind_current=false（不踩全局指针）')
  ok(opened1.engagement.id === (await call('lmt_session_info', {}, main1)).session.bound_engagement,
    '主会话 A：open 后绑定到本会话')
  const inherited = await call('lmt_session_info', {}, recon1)
  ok(inherited.session.root_session === 'main1' && inherited.session.bound_engagement === opened1.engagement.id,
    '子智能体：沿父链继承同一个工作区（root_session = 父会话）')
  const opened2 = await call('lmt_engagement_open', { name: '乙公司' }, main2)
  ok(opened2.engagement.id !== opened1.engagement.id, '主会话 B：可以同时开另一个工作区')
  const stillA = await call('lmt_session_info', {}, main1)
  const stillChild = await call('lmt_session_info', {}, recon1)
  ok(stillA.session.bound_engagement === opened1.engagement.id && stillChild.session.bound_engagement === opened1.engagement.id,
    '主会话 B open 之后，A 与其子智能体的绑定不受影响（不串写）')

  const stranger = makeSession(registry, 'main3')
  registry.set('main3', stranger)
  store.setActiveEngagement(opened1.engagement.id)
  let strangerErr = null
  try {
    const r = await call('lmt_artifact_query', { kind: 'module' }, stranger)
    if (r && r.ok === false) strangerErr = String(r.error || '')
  } catch (error) { strangerErr = error && error.message ? error.message : String(error) }
  ok(strangerErr !== null && /尚未绑定项目工作区|已被另一个会话占用/.test(strangerErr),
    '未绑定的会话不会被静默塞进别人的工作区（明确报错并要求显式绑定）')

  const bound = await call('lmt_session_bind', { engagement: '乙公司' }, stranger)
  ok(bound.ok === true && bound.engagement.id === opened2.engagement.id, 'lmt_session_bind：可以把已有工作区绑到本会话')

  const tempSess = makeSession(registry, 'main4')
  registry.set('main4', tempSess)
  await call('lmt_session_bind', { engagement: '甲公司', action: 'bind' }, tempSess)
  const unbound = await call('lmt_session_bind', { action: 'unbind' }, tempSess)
  ok(unbound.ok === true && unbound.session.bound_engagement === null, 'lmt_session_bind(action=unbind)：正确解绑')
  const skipped = await call('lmt_session_bind', { action: 'skip' }, tempSess)
  ok(skipped.ok === true && store.getSessionState('main4').init_state === 'skipped', 'lmt_session_bind(action=skip)：记录 skipped 状态')
  const reopened = await call('lmt_session_bind', { action: 'reopen' }, tempSess)
  ok(reopened.ok === true && store.getSessionState('main4').init_state === 'uninitialized', 'lmt_session_bind(action=reopen)：重置为 uninitialized')

  console.log('— 落盘绑定（sessions.json 与面板跟随会话）')
  const bindFile = store.sessionBindingsPath()
  ok(existsSync(bindFile), 'open/bind 之后写出 sessions.json')
  const onDisk = JSON.parse(readFileSync(bindFile, 'utf8'))
  ok(onDisk.agents.main1 && onDisk.agents.main1.engagement === opened1.engagement.id, '落盘键是根会话：main1 → 甲公司')
  ok(onDisk.agents.recon1 === undefined, '子智能体不单独落盘（沿父链继承，只记根会话）')
  ok(store.sessionBinding('main1') === opened1.engagement.id, 'sessionBinding(根会话) 读出绑定工作区')
  ok(store.sessionBinding('main3') === opened2.engagement.id, 'lmt_session_bind 也会落盘（main3 → 乙公司）')

  const viewChild = dispatch(store, { op: 'sessionBinding', session: 'recon1' })
  ok(viewChild.bound === null, '子会话 id 问绑定（无解析器）返回 null')
  const viewChildRoot = dispatch(store, { op: 'sessionBinding', session: 'recon1', resolveRoot: (sid) => (sid === 'recon1' ? 'main1' : sid) })
  ok(viewChildRoot.bound === opened1.engagement.id && viewChildRoot.root_session === 'main1',
    '子会话经 resolveRoot 解析到根会话读到父会话工作区')

  const doomed = store.openEngagement('待删工作区', [], { bindCurrent: false })
  store.setSessionBinding('ghost', doomed.id, '待删工作区')
  ok(store.sessionBinding('ghost') === doomed.id, '指向存在工作区的绑定可读出')
  try { store.close() } catch {}
  rmSync(store.dirOf(doomed.id), { recursive: true, force: true })
  store.setSessionBinding('main1', opened1.engagement.id, '甲公司')
  ok(store.sessionBinding('ghost') === undefined, '工作区目录删掉后，指向它的绑定在下一次写入时被清理')
  ok(store.sessionBinding('main1') === opened1.engagement.id, '清理不影响其它会话的绑定')

  console.log('— 资产发现时间与查询')
  await call('lmt_artifact_record', {
    kind: 'module', ip: '10.9.9.9', state: 'live', provenance: 'active', tool: 'nmap', primary_name: 'oa.jia.com',
    ports: [{ port: 8080, service: 'http', title: 'OA 登录', url: 'http://10.9.9.9:8080/' }],
  }, main1)
  const first = store.listAssets(opened1.engagement.id, { ip: '10.9.9.9' }).items[0]
  ok(typeof first.discovered_at === 'string' && first.discovered_at.length > 10, 'module：自动记录发现时间')
  ok(first.discovered_at === first.first_seen, 'module：首次入库时发现时间 = 数据源首见')
  await new Promise((r) => setTimeout(r, 8))
  await call('lmt_artifact_record', {
    kind: 'module', ip: '10.9.9.9', state: 'live', provenance: 'passive', tool: 'fofa',
    ports: [{ port: 443, service: 'https', title: 'OA 门户' }],
  }, main1)
  const second = store.listAssets(opened1.engagement.id, { ip: '10.9.9.9' }).items[0]
  ok(second.discovered_at === first.discovered_at, '重复采集不覆盖发现时间')
  ok(second.last_seen !== first.last_seen, '重复采集刷新 last_seen')
  const tl = await call('lmt_artifact_query', { kind: 'timeline' }, main1)
  ok(tl.days.length === 1 && tl.days[0].assets === 1, 'lmt_artifact_query(timeline)：按天聚合')
  ok(tl.days[0].internal === 1 && tl.days[0].external === 0, 'lmt_artifact_query(timeline)：区分内网/外网')
  const statsQ = await call('lmt_artifact_query', { kind: 'stats' }, main1)
  ok(statsQ.ok === true && statsQ.stats.assets === 1, 'lmt_artifact_query(stats)：返回工作区与里程碑统计')

  console.log('— 报告溯源与边界硬门槛')
  const asset = store.listAssets(opened1.engagement.id, { ip: '10.9.9.9' }).items[0]
  const vuln = store.addVuln(opened1.engagement.id, {
    asset_id: asset.id, cve: 'CVE-2021-22205', title: '致远OA 文件上传 RCE', severity: 'critical',
    status: 'exploited', target: 'http://10.9.9.9:8080/', evidence: '上传返回 200', gained: '服务器权限', agent: 'vuln-scan',
  })
  store.addHttpEvidence(opened1.engagement.id, {
    vuln_id: vuln.id, asset_id: asset.id, label: '上传 POC', method: 'POST', url: 'http://10.9.9.9:8080/upload',
    status: 200, request: 'POST /upload HTTP/1.1\nHost: 10.9.9.9:8080\n\n--payload--', response: 'ok',
  })
  store.addCredential(opened1.engagement.id, {
    asset_id: asset.id, host: '10.9.9.9', username: 'admin', secret_value: 'Admin@123',
    source: '注入拖库', tool: 'sqlmap -u "http://10.9.9.9:8080/api?id=1" --dump', privilege: '管理员', agent: 'exploit',
  })
  const step = store.addChainStep(opened1.engagement.id, {
    stage_code: 'internet', title: '上传探针并验证连接', detail: '后台模板上传点绕过',
    tool: 'curl -F "file=@probe.jsp" http://10.9.9.9:8080/upload', result: 'uid=0(root)', agent: 'exploit', vuln_id: vuln.id,
  })
  store.addChainStep(opened1.engagement.id, {
    stage_code: 'boundary-logical', title: 'suo5 建 socks5 隧道',
    tool: 'suo5-linux-amd64 -t http://10.9.9.9:8080/probe.jsp -l 1080', result: 'socks5 127.0.0.1:1080 通内网', agent: 'exploit',
    asset_id: asset.id,
  })
  store.addTunnel(opened1.engagement.id, {
    asset_id: asset.id, kind: 'suo5', listen: '127.0.0.1:1080', entry: 'http://10.9.9.9:8080/probe.jsp',
    reach: '10.9.9.0/24', entry_kind: 'target-http', command: 'suo5-linux-amd64 -t ... -l 1080', agent: 'exploit',
  })
  await call('lmt_artifact_record', {
    kind: 'milestone', code: 'server-host', asset_id: asset.id, vuln_id: vuln.id, step_id: step.id,
    target: 'http://10.9.9.9:8080/', evidence: '10.9.9.9｜主机调试端点可用',
  }, main1)

  const boundaryDenied = await call('lmt_artifact_record', {
    kind: 'milestone', code: 'boundary-logical', asset_id: asset.id, target: '10.9.9.9', evidence: '10.9.9.9｜suo5 隧道可达',
  }, main1)
  ok(boundaryDenied.ok === false && /boundary/.test(boundaryDenied.error || ''),
    '边界硬门槛：缺 boundary 对象时拒绝记 boundary-*')
  const sameZone = await call('lmt_artifact_record', {
    kind: 'milestone', code: 'boundary-logical', asset_id: asset.id, target: '10.9.9.9', evidence: '同区隧道',
    boundary: { entry_zone: 'DMZ', target_zone: 'dmz', isolation: 'firewall', target_asset: '10.9.9.9:22' },
  }, main1)
  ok(sameZone.ok === false && /相同/.test(sameZone.error || ''), '边界硬门槛：入口区=落点区时拒绝')
  const supplyNoScope = await call('lmt_artifact_record', {
    kind: 'milestone', code: 'boundary-supply', asset_id: asset.id, target: '10.9.9.9', evidence: '供应商通道',
    boundary: { entry_zone: '供应商', target_zone: '主防单位', isolation: 'supply', target_asset: '10.9.9.9:22' },
  }, main1)
  ok(supplyNoScope.ok === false && /scope_confirmed/.test(supplyNoScope.error || ''), '边界硬门槛：boundary-supply 未确认授权范围时拒绝')

  await call('lmt_artifact_record', {
    kind: 'milestone', code: 'boundary-logical', asset_id: asset.id, target: '10.9.9.9', evidence: '10.9.9.9｜suo5 隧道可达 10.9.9.0/24',
    boundary: { entry_zone: '互联网', target_zone: '办公网', isolation: 'firewall', target_asset: '10.9.9.9:22（SSH banner 实测）' },
  }, main1)
  const exported = await call('lmt_report_export', { format: 'markdown' }, main1)
  ok(exported.ok === true && exported.markdown.includes('## 三、得分点复现') && exported.markdown.includes('POST /upload HTTP/1.1') && exported.markdown.includes('curl -i -s -X POST'),
    'lmt_report_export：输出完整 Markdown 工程交付报告（含复现命令）')

  console.log('— 知识库归类与溯源')
  const poc = await call('lmt_artifact_record', {
    kind: 'pattern', title: '致远OA 文件上传 RCE', subkind: 'exp', category: 'file-upload', cve: 'CVE-2021-22205',
    component: '致远OA', versions: 'A8 <= 8.1', source: 'self', content: 'print("poc")',
    verified: true, verified_note: '10.9.9.9:8080 上传成功', engagement: opened1.engagement.id,
    asset_target: '10.9.9.9:8080', agent: 'exploit',
  }, main1)
  ok(poc.category === 'file-upload' && poc.asset_target === '10.9.9.9:8080', 'pattern：归类与来源节点落库')
  const searched = await call('lmt_artifact_query', { kind: 'pattern', category: 'file-upload' }, main1)
  ok(searched.items.length === 1 && searched.items[0].engagement && searched.items[0].created_at, 'pattern：按归类检索并返回来源工作区')
  const stats = store.pocStats()
  ok(stats.byCategory.length === POC_CATEGORIES.length, `pocStats：内置归类表完整（${POC_CATEGORIES.length} 类）`)

  console.log('— 并发闸门 + ShardLock + Heartbeat')
  const st = await call('lmt_agent_slot', { action: 'status' }, main1)
  ok(st.max === 6 && st.used === 0 && st.free === 6, 'lmt_agent_slot：默认上限 6、空闲 6')
  const a1 = await call('lmt_agent_slot', {
    action: 'acquire', label: '需求收敛', worker_task_id: 'wt-slot-1', wave: 'wave-1', files_owned: ['packages/ui/**'],
  }, main1)
  const overlap = await call('lmt_agent_slot', {
    action: 'acquire', label: '冲突任务', worker_task_id: 'wt-slot-conflict', wave: 'wave-1', files_owned: ['packages/ui/lib/index.js'],
  }, main1)
  ok(overlap.ok === false && overlap.conflicts.length > 0, 'lmt_agent_slot：重叠 files_owned 被拦截并拒绝')
  const locksNow = await call('lmt_agent_slot', { action: 'list_locks' }, main1)
  ok(locksNow.ok === true && locksNow.shard_locks.some((l) => l.file_pattern === 'packages/ui/**'),
    'lmt_agent_slot(list_locks)：持久化 shard_locks 可查')
  const hb = await call('lmt_agent_slot', { action: 'heartbeat', key: a1.slot }, main1)
  ok(hb.ok === true && hb.renewed === true && hb.expires_at >= a1.expires_at, 'lmt_agent_slot(heartbeat)：租约续期成功')

  const a2 = await call('lmt_agent_slot', { action: 'acquire', label: '设计审查' }, main1)
  const a3 = await call('lmt_agent_slot', { action: 'acquire', label: '架构拆解' }, main1)
  const a4 = await call('lmt_agent_slot', { action: 'acquire', label: '全栈构建-1' }, main1)
  const a5 = await call('lmt_agent_slot', { action: 'acquire', label: '全栈构建-2' }, main1)
  const a6 = await call('lmt_agent_slot', { action: 'acquire', label: '全栈构建-3' }, main1)
  ok(a1.ok && a2.ok && a3.ok && a4.ok && a5.ok && a6.ok, 'lmt_agent_slot：六次占位都成功')
  const a7 = await call('lmt_agent_slot', { action: 'acquire', label: '第七个' }, main1)
  ok(a7.ok === false && /并发已满/.test(a7.error), 'lmt_agent_slot：第 7 个被拒（硬约束生效）')
  const rel = await call('lmt_agent_slot', { action: 'release', key: a1.slot }, main1)
  const locksAfterRel = await call('lmt_agent_slot', { action: 'list_locks' }, main1)
  ok(rel.released === true && !locksAfterRel.shard_locks.some((l) => l.worker_task_id === 'wt-slot-1'),
    'lmt_agent_slot(release)：同时释放内存槽位与持久化 shard_locks')
  const a8 = await call('lmt_agent_slot', { action: 'acquire', label: '补位' }, main1)
  ok(a8.ok === true, 'lmt_agent_slot：释放后可以再占位')
  const other = await call('lmt_agent_slot', { action: 'status' }, main2)
  ok(other.used === 0 && other.free === 6, 'lmt_agent_slot：并发计数按根会话隔离')

  console.log('— lmt_workflow（4-Wave DAG + depends_on + check_scope）')
  const wishRes = await call('lmt_workflow', { action: 'refine_wish', user_prompt: '实现 4-Wave 分片调度与实时检测' }, main1)
  ok(wishRes.ok === true && Boolean(wishRes.refined_spec), 'lmt_workflow(refine_wish)：返回结构化规格')

  const decompRes = await call('lmt_workflow', {
    action: 'decompose',
    user_prompt: '实现工具精简与测试',
    goals: [
      {
        id: 'wt-core', wave: 'wave-2', role: 'assess', worker_name: 'Wave2 assess',
        assigned_goal: '冻结存储契约', files_owned: ['packages/redteam-store/**'],
      },
      {
        id: 'wt-tools', wave: 'wave-3', role: 'exploit', worker_name: 'Wave3 tools',
        assigned_goal: '重构 12 工具', files_owned: ['packages/redteam-tools/**'],
        depends_on: ['wt-core'],
      },
    ],
  }, main1)
  ok(decompRes.ok === true && decompRes.worker_tasks.length === 2, 'lmt_workflow(decompose)：创建双波次分片任务')
  const toolsTask = decompRes.worker_tasks.find((t) => t.worker_name === 'Wave3 tools')
  const coreTask = decompRes.worker_tasks.find((t) => t.worker_name === 'Wave2 assess')

  const scopeIn = await call('lmt_workflow', {
    action: 'check_scope', worker_task_id: String(toolsTask.id), worker_name: 'Wave3 tools',
    candidate_path: 'packages/redteam-tools/lib/index.js',
  }, main1)
  ok(scopeIn.ok === true && scopeIn.allowed === true && scopeIn.reason === 'in_owned_scope',
    'lmt_workflow(check_scope)：自身 files_owned 内路径放行')

  const scopeLockedByOther = await call('lmt_workflow', {
    action: 'check_scope', worker_task_id: String(toolsTask.id), worker_name: 'Wave3 tools',
    candidate_path: 'packages/redteam-store/lib/core.js',
  }, main1)
  ok(scopeLockedByOther.ok === false && scopeLockedByOther.allowed === false && scopeLockedByOther.reason === 'locked_by_other',
    'lmt_workflow(check_scope)：其他活跃 Worker 锁定路径被拦截（locked_by_other）')

  const scopeOutside = await call('lmt_workflow', {
    action: 'check_scope', worker_task_id: String(toolsTask.id), worker_name: 'Wave3 tools',
    path: 'README.md',
  }, main1)
  ok(scopeOutside.ok === false && scopeOutside.allowed === false && scopeOutside.reason === 'outside_files_owned',
    'lmt_workflow(check_scope)：越出 files_owned 路径被拦截（outside_files_owned）')

  const addWorkerRes = await call('lmt_workflow', {
    action: 'add_worker', worker_name: 'Wave4 qa', role: 'qa', wave: 'wave-4',
    assigned_goal: '执行全量单测', files_owned: ['packages/redteam-bundle/**'],
    depends_on: [String(toolsTask.id)],
  }, main1)
  ok(addWorkerRes.ok === true && addWorkerRes.worker_task.depends_on.includes(String(toolsTask.id)),
    'lmt_workflow(add_worker)：支持 depends_on 依赖落库')

  const digestRes = await call('lmt_workflow', {
    action: 'submit_digest', worker_task_id: String(coreTask.id), worker_name: 'Wave2 assess',
    what_was_done: '完成契约冻结', files_touched: ['packages/redteam-store/lib/core.js'],
    key_decisions: ['保持 1:1 隔离'], verification: '84/84 通过',
  }, main1)
  ok(digestRes.ok === true && digestRes.compression_pct > 0, 'lmt_workflow(submit_digest)：压缩摘要写回成功')

  const appRes = await call('lmt_workflow', {
    action: 'approve_worker', worker_task_id: String(coreTask.id), decision: 'approved', next_goal: '进入 Wave 3',
  }, main1)
  ok(appRes.ok === true && appRes.approval_state === 'approved', 'lmt_workflow(approve_worker)：审批通过并释放锁')

  const dagStatus = await call('lmt_workflow', { action: 'dag' }, main1)
  ok(dagStatus.ok === true && dagStatus.hasStarted === true && Array.isArray(dagStatus.nodes),
    'lmt_workflow(dag)：返回 workflowDag 实时拓扑')

  console.log('— lmt_roles 与 lmt_role_prompt')
  const rolesOut = await call('lmt_roles', {}, main1)
  ok(rolesOut.ok === true && rolesOut.roles.length === 8, 'lmt_roles：列出 8 个角色与波次')
  const promptRead = await call('lmt_role_prompt', { role: 'assess' }, main1)
  ok(promptRead.ok === true && typeof promptRead.prompt === 'string' && promptRead.prompt.length > 50, 'lmt_role_prompt：读取 assess 角色提示词')
  const promptReset = await call('lmt_role_prompt', { role: 'assess', reset: true }, main1)
  ok(promptReset.ok === true && Array.isArray(promptReset.reset) && promptReset.reset.includes('assess'), 'lmt_role_prompt(reset=true)：重置角色提示词')

  console.log('— 技能与资源预检（lmt_preflight）')
  const preMissing = await call('lmt_preflight', {}, main1)
  ok(preMissing.ok === false && /技能注册表不可用/.test(preMissing.error), 'lmt_preflight：技能注册表缺失时如实说明')
  ok(typeof preMissing.maxAgents === 'number' && typeof preMissing.maxDepth === 'number' && typeof preMissing.thinkingEffort === 'string' && Boolean(preMissing.db_engine),
    'lmt_preflight：即使无技能注册表仍返回 maxAgents/maxDepth/thinkingEffort/db_engine')

  const skillsDir = join(root, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  writeFileSync(join(skillsDir, 'fofa-recon.md'), '# FOFA\nKEY = os.environ["FOFA_KEY"]\n', 'utf8')
  writeFileSync(join(skillsDir, 'good-skill.md'), '# 不需要外部资源\n', 'utf8')
  const skillsStub = {
    list: async () => [
      { name: 'fofa-recon', description: 'FOFA 测绘', resourceBase: { kind: 'directory', path: skillsDir } },
      { name: 'good-skill', description: '可用的技能', resourceBase: { kind: 'directory', path: skillsDir } },
    ],
    get: async (name) => (name === 'fofa-recon'
      ? { name, description: 'FOFA 测绘', path: join(skillsDir, 'fofa-recon.md'), content: 'KEY = os.environ["FOFA_KEY"]\n' }
      : { name, description: '可用的技能', path: join(skillsDir, 'good-skill.md'), content: '# 不需要外部资源\n' }),
  }
  const toolsWithSkills = new Map()
  const savedDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  apply({
    lmtagent: store,
    tools: { register: (t) => toolsWithSkills.set(t.name, t) },
    get: (name) => (name === 'subagents' ? { listChildren: async () => [] } : name === 'skills' ? skillsStub : undefined),
    on: () => {},
  })
  const pre = JSON.parse(await toolsWithSkills.get('lmt_preflight').execute({}, { agent: { session: main1 } }))
  if (savedDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedDshHome

  ok(pre.ok === false && pre.skills_broken === 1 && pre.skills_available === 1 && pre.skills_total === 2,
    `lmt_preflight：summarizeSkills 统计准确（available=${pre.skills_available}, broken=${pre.skills_broken}, total=${pre.skills_total}）`)
  ok(pre.broken[0].name === 'fofa-recon' && pre.broken[0].needs_user.some((x) => x.includes('FOFA_KEY')),
    'lmt_preflight：缺 key 技能标为 broken 并指出 FOFA_KEY')
  ok(pre.available.includes('good-skill'), 'lmt_preflight：可用技能照常列出')
  ok(pre.db_engine && typeof pre.db_engine.engine === 'string' && Boolean(pre.workspace_root),
    'lmt_preflight：返回 workspace_root 与 db_engine')
  ok(pre.prompts && pre.prompts.stale_count === 0, 'lmt_preflight：返回 prompts.stale_count')

  mkdirSync(join(root, 'lmtagent'), { recursive: true })
  writeFileSync(join(root, 'lmtagent', '.setup-complete'), 'completed_at=test\n', 'utf8')
  writeFileSync(join(root, '.env'), 'FOFA_KEY=test-key-1234\n', 'utf8')
  process.env.DSH_HOME = root
  delete process.env.FOFA_KEY
  const pre2 = JSON.parse(await toolsWithSkills.get('lmt_preflight').execute({}, { agent: { session: main1 } }))
  if (savedDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = savedDshHome
  ok(pre2.onboarding.first_run === false && pre2.onboarding.configured.fofa_key.startsWith('configured'),
    'lmt_preflight：读取 $DSH_HOME/.env 里的 FOFA_KEY')
} finally {
  try { store.close() } catch {}
  rmSync(root, { recursive: true, force: true })
}

console.log(`\n通过 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
