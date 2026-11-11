/**
 * LMTAgent v0.21.0 闭环状态机、分片独占锁、交互式编排与 PG 引擎安全回归测试（零外部依赖）。
 *
 * 运行方式：
 *   node packages/redteam-store/test/closed-loop-and-shardlock.test.mjs
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RedteamStore,
  POC_CATEGORIES,
  dispatch,
  dispatchAsync,
  fileMatchesShardPattern,
  shardPatternsOverlap,
} from '../lib/core.js'
import {
  PG_CLUSTER_TABLES,
  TABLE_ALIAS_MAP,
  PgWriteActivityProbe,
  quotePgLiteral,
  interpolatePgParams,
  translateSqlToPg,
} from '../lib/pg-engine.js'

let pass = 0
let fail = 0
const ok = (cond, msg) => {
  if (cond) {
    pass += 1
    console.log('  ✓ ' + msg)
  } else {
    fail += 1
    console.error('  ✗ ' + msg)
  }
}

const root = mkdtempSync(join(tmpdir(), 'lmt-closedloop-shard-'))

try {
  const store = new RedteamStore(root)

  /* ═══════════════════════════════════════════════════════════════════════
     1. Schema 外键完整性、TEXT 时间戳、engineering_memories 与 POC_CATEGORIES
     ═══════════════════════════════════════════════════════════════════════ */
  console.log('— 1. Schema 外键完整性、知识库记忆表与工程分类扩展')
  const eng = store.openEngagement('v021-closedloop-test')
  const id = eng.id
  const db = store.db(id)

  const fkRow = db.prepare('PRAGMA foreign_keys').get()
  ok(Number(fkRow?.foreign_keys) === 1, 'openEngagement + migrate 后 PRAGMA foreign_keys 始终保持 ON (1)')

  /* 触发闭环表确保逻辑后再次核验 PRAGMA foreign_keys 仍为 1 */
  const idleDag = store.workflowDag(id)
  const fkAfterDag = db.prepare('PRAGMA foreign_keys').get()
  ok(Number(fkAfterDag?.foreign_keys) === 1, 'workflowDag / #ensureClosedLoopTables 后 PRAGMA foreign_keys 仍保持 ON (1)')

  /* 核验空闲状态下 workflowDag 不伪造 94.2 / 91.5 / 98.0 指标 */
  ok(idleDag.hasStarted === false, '全新空项目 workflowDag.hasStarted 为 false')
  ok(
    idleDag.telemetry.cache_hit_pct === 0
      && idleDag.telemetry.parallel_efficiency_pct === 0
      && idleDag.telemetry.gate_pass_rate_pct === 0,
    '空闲状态下遥测比率严格为 0（绝不返回硬编码 94.2 / 91.5 / 98.0）',
  )

  /* engineering_memories 表在知识库中存在且可读写 */
  const kb = store.kb()
  kb.prepare(`
    INSERT INTO engineering_memories (
      id, engagement_id, engagement_name, category, module_path, title, summary,
      decisions_json, patterns_json, tags_json, created_by, hit_count, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'mem-arch-1',
    id,
    'v021-closedloop-test',
    'architecture',
    'packages/redteam-store/lib/core.js',
    '4-Wave Bounded DAG 分片隔离契约',
    '每个 Wave 3 Builder 持有独立文件锁，禁止跨分片写文件',
    JSON.stringify(['保持 PRAGMA foreign_keys = ON']),
    JSON.stringify(['Use shard_locks before editing files']),
    JSON.stringify(['dag', 'shard_locks']),
    'plan',
    3,
    new Date().toISOString(),
    new Date().toISOString(),
  )
  const memRow = kb.prepare('SELECT * FROM engineering_memories WHERE id = ?').get('mem-arch-1')
  ok(memRow && memRow.category === 'architecture' && Number(memRow.hit_count) === 3, 'knowledge.db 包含 engineering_memories 表并支持跨会话架构记忆读写')

  const catCodes = new Set(POC_CATEGORIES.map((c) => c.code))
  for (const requiredCat of ['architecture', 'frontend', 'backend', 'database', 'testing', 'devops', 'rce', 'tunnel', 'other']) {
    ok(catCodes.has(requiredCat), `POC_CATEGORIES 包含分类 '${requiredCat}'`)
  }

  /* ═══════════════════════════════════════════════════════════════════════
     2. Wish Refiner Wizard + decomposeUserPrompt + 自动获取不相交分片锁
     ═══════════════════════════════════════════════════════════════════════ */
  console.log('— 2. refineUserWish 模糊愿望精炼与 decomposeUserPrompt 不相交 shard_locks 注册')
  const wishPreview = store.refineUserWish({
    engagement_id: id,
    wish: '构建实时分片锁监控面板、PostgreSQL 协议健壮层与自动化回归套件',
  })
  ok(wishPreview.ok === true && Boolean(wishPreview.refined_spec), 'refineUserWish 支持 wish 参数并返回 refined_spec')
  ok(
    Array.isArray(wishPreview.refined_spec.clarifications)
      && wishPreview.refined_spec.clarifications.length >= 2
      && Array.isArray(wishPreview.refined_spec.acceptance_criteria)
      && wishPreview.refined_spec.acceptance_criteria.length >= 3,
    'refined_spec 含结构化 clarifications 与 acceptance_criteria',
  )

  const decompRes = store.decomposeUserPrompt({
    engagement_id: id,
    wish: '构建实时分片锁监控面板、PostgreSQL 协议健壮层与自动化回归套件',
  })
  ok(
    decompRes.ok === true
      && Boolean(decompRes.refined_spec)
      && decompRes.goals.length >= 4
      && decompRes.worker_tasks.length >= 2,
    'decomposeUserPrompt 支持 wish 参数并返回 refined_spec、4-Wave goals 与并行 worker_tasks',
  )
  ok(
    decompRes.worker_tasks.every((wt) => Array.isArray(wt.files_owned) && wt.files_owned.length > 0),
    '每个生成的 worker_task 均填充非空且互不相交的 files_owned 数组',
  )

  const initialLocks = store.listShardLocks(id, { status: 'active' })
  ok(initialLocks.length >= decompRes.worker_tasks.length, `已为拆解出的分片自动注册 ${initialLocks.length} 条活跃 shard_locks`)

  /* 验证生成的不同 Worker 分片模式互不重叠 */
  const [workerA, workerB] = decompRes.worker_tasks
  const crossOverlap = workerA.files_owned.some((pa) =>
    workerB.files_owned.some((pb) => shardPatternsOverlap(pa, pb)),
  )
  ok(crossOverlap === false, '自动生成的不同 Builder 分片 files_owned 互不重叠')

  /* ═══════════════════════════════════════════════════════════════════════
     3. 分片独占锁冲突拦截与同 Worker 幂等重入
     ═══════════════════════════════════════════════════════════════════════ */
  console.log('— 3. acquireShardLocks 跨 Worker 冲突拒绝与同 Worker 幂等重入')
  ok(fileMatchesShardPattern('packages/ui/components/Button.tsx', 'packages/ui/**') === true, 'glob 模式匹配子目录文件')
  ok(shardPatternsOverlap('packages/ui/**', 'packages/ui/Button.tsx') === true, '重叠 glob 与具体文件路径可被精准检出')

  const sameWorkerRelock = store.acquireShardLocks({
    engagement_id: id,
    worker_task_id: workerA.id,
    worker_name: workerA.worker_name,
    wave: workerA.wave,
    files_owned: workerA.files_owned,
  })
  ok(sameWorkerRelock.ok === true && sameWorkerRelock.conflicts.length === 0, '同一 Worker 重复申请自身持有的分片锁保持幂等通过')

  const conflictLock = store.acquireShardLocks({
    engagement_id: id,
    worker_task_id: workerB.id,
    worker_name: workerB.worker_name,
    wave: 'wave-3',
    files_owned: [workerA.files_owned[0]],
  })
  ok(
    conflictLock.ok === false && conflictLock.conflicts.length > 0,
    '不同 Worker 申请已被占用的分片路径时立即拒绝并返回 conflicts 详情',
  )

  /* ═══════════════════════════════════════════════════════════════════════
     4. submitWorkerDigest Token 估算与运行期分片越界告警
     ═══════════════════════════════════════════════════════════════════════ */
  console.log('— 4. submitWorkerDigest Token 别名/估算公式与运行期分片越界检测')
  /* 4a) 未传 token 数字时按 turns * 450 + tool_calls * 320 + whatWasDone.length * 2 诚实估算 */
  const cleanFileA = workerA.files_owned[0].replace(/\/\*\*$/, '/index.js').replace(/\/\*$/, '/index.js')
  const cleanSummaryText = '完成核心模块契约实现并通过全部边界断言验证，消除了外键与空字节截断隐患。'
  const digestClean = store.submitWorkerDigest({
    engagement_id: id,
    worker_task_id: workerA.id,
    whatWasDone: cleanSummaryText,
    filesTouched: [cleanFileA],
    keyDecisions: ['保持 PRAGMA foreign_keys = ON', '采用单遍 SQL 词法扫描器'],
    turns: 4,
    tool_calls: 5,
  })
  const expectedRaw = 4 * 450 + 5 * 320 + cleanSummaryText.length * 2
  const expectedCompressed = Math.max(48, Math.ceil(cleanSummaryText.length / 3.5))
  ok(
    digestClean.raw_tokens === expectedRaw && digestClean.compressed_tokens === expectedCompressed,
    `未传 token 时按真实公式估算 (${digestClean.raw_tokens} -> ${digestClean.compressed_tokens})`,
  )
  ok(digestClean.shard_conflict.violated === false, 'Worker 在自身 files_owned 范围内修改文件不触发越界告警')

  /* 4b) Worker B 触碰 Worker A 锁定的文件 -> 触发运行期分片越界告警 */
  const digestViolated = store.submitWorkerDigest({
    engagement_id: id,
    worker_task_id: workerB.id,
    what_was_done: '更新组件并顺手改动了另一分片入口文件',
    files_touched: [cleanFileA],
    raw_tokens_estimate: 12000,
    digest_tokens_estimate: 420,
  })
  ok(
    digestViolated.raw_tokens === 12000 && digestViolated.compressed_tokens === 420,
    '支持 raw_tokens_estimate 与 digest_tokens_estimate 字段读取',
  )
  ok(
    digestViolated.shard_conflict && digestViolated.shard_conflict.violated === true && digestViolated.shard_conflict.details.length >= 1,
    '触碰其他活跃 Worker 锁定文件或越出 files_owned 时返回 shard_conflict.violated = true',
  )
  const taskBAfterViolation = db.prepare('SELECT error_detail FROM worker_tasks WHERE id = ?').get(workerB.id)
  ok(
    String(taskBAfterViolation?.error_detail || '').includes('shard_warning'),
    'worker_tasks.error_detail 持久化记录 shard_warning 越界详情',
  )

  /* ═══════════════════════════════════════════════════════════════════════
     5. approveWorkerAndDispatchNext 闭环状态机修复
     ═══════════════════════════════════════════════════════════════════════ */
  console.log('— 5. approveWorkerAndDispatchNext 打回语义、防误批、锁释放与幂等派发')
  /* 5a) P0 修复：decision = 'revision_requested' 必须变为 'revision_required'（绝不能误判为 approved！） */
  const revRes = store.approveWorkerAndDispatchNext({
    engagement_id: id,
    worker_task_id: workerB.id,
    decision: 'revision_requested',
    review_note: '请回滚越界修改的文件并仅在自身分片内提交变更',
  })
  ok(
    revRes.decision === 'revision_required' && revRes.approval_state === 'revision_required',
    "decision='revision_requested' 严格映射为 'revision_required'（修复误变 approved 的 P0 缺陷）",
  )
  ok(
    revRes.review_note === '请回滚越界修改的文件并仅在自身分片内提交变更' && revRes.followup_worker === null,
    'review_note 完整保留且打回修订时不派发下游 Worker',
  )
  const workerBLocksStillActive = store.listShardLocks(id, { worker_task_id: workerB.id, status: 'active' })
  ok(workerBLocksStillActive.length > 0, '打回修订时该 Worker 持有的分片锁保持 active 不提前释放')

  /* 5b) 显式传入不存在的 worker_task_id 时绝不随机捞取其他 Worker 误批，而是干净地 upsert 指定 Worker */
  const explicitNewApprove = store.approveWorkerAndDispatchNext({
    engagement_id: id,
    worker_task_id: 'wt-explicit-external-99',
    worker_name: 'ExternalQA#99',
    decision: 'approved',
    review_note: '独立外部验证通过',
  })
  ok(
    explicitNewApprove.approved_worker_id === 'wt-explicit-external-99',
    '显式传入未知 worker_task_id 时精确 upsert 指定 Worker，绝不误批库内其他待审 Worker',
  )
  const taskBStillRevision = db.prepare('SELECT approval_state FROM worker_tasks WHERE id = ?').get(workerB.id)
  const taskAStillPending = db.prepare('SELECT approval_state FROM worker_tasks WHERE id = ?').get(workerA.id)
  ok(
    taskBStillRevision.approval_state === 'revision_required' && taskAStillPending.approval_state === 'pending_approval',
    '其他已有 Worker 的审批状态未受显式新 Worker 审批污染',
  )

  /* 5c) 审批通过 Worker A：自动释放其活跃分片锁 + 连续重复点击 next_goal 保持幂等不产生重复 sess-* 行 */
  const nextGoalText = '进入 Wave 4 执行端到端回归测试门禁与安全审计'
  const approveA1 = store.approveWorkerAndDispatchNext({
    engagement_id: id,
    worker_task_id: workerA.id,
    decision: 'approved',
    review_note: '核心契约验收通过',
    next_goal: nextGoalText,
    next_wave: 'wave-4',
    next_role: 'qa',
  })
  const locksAAfterApprove = store.listShardLocks(id, { worker_task_id: workerA.id, status: 'active' })
  const releasedLocksA = store.listShardLocks(id, { worker_task_id: workerA.id, status: 'released' })
  ok(
    locksAAfterApprove.length === 0 && releasedLocksA.length > 0 && approveA1.released_locks >= 1,
    'Worker 审批通过后自动释放其名下所有 active shard_locks (status = released)',
  )
  ok(Boolean(approveA1.followup_worker && approveA1.followup_worker.id), '首次审批通过并指定 next_goal 时创建下游跟进 Worker')

  const approveA2 = store.approveWorkerAndDispatchNext({
    engagement_id: id,
    worker_task_id: workerA.id,
    decision: 'approved',
    review_note: '重复点击确认',
    next_goal: nextGoalText,
    next_wave: 'wave-4',
    next_role: 'qa',
  })
  ok(
    approveA2.followup_reused === true
      && approveA2.followup_worker.id === approveA1.followup_worker.id
      && approveA2.followup_worker.session_id === approveA1.followup_worker.session_id,
    '60s 内或已存在 pending/running 同目标跟进任务时幂等复用已有行，不重复插入 sess-*',
  )

  /* ═══════════════════════════════════════════════════════════════════════
     6. 交互式编排方法（直接调用 + workflowAction + dispatch / dispatchAsync）
     ═══════════════════════════════════════════════════════════════════════ */
  console.log('— 6. updateWorkerGoal / addCustomWorkerTask / retryWorkerTask / Feishu 真实推送')
  const customAdd = dispatch(store, {
    op: 'addCustomWorkerTask',
    engagement_id: id,
    worker_name: 'DevOpsShard#7',
    worker_role: 'internal',
    wave: 'wave-4',
    assigned_goal: '编写发布流水线校验脚本',
    ui_priority: 'P1',
    files_owned: ['scripts/ci-verify/**'],
    tags: ['devops', 'wave-4'],
  })
  ok(
    customAdd.ok === true && customAdd.worker_task.worker_name === 'DevOpsShard#7' && customAdd.locks.locks.length === 1,
    'dispatch(addCustomWorkerTask) 创建自定义分片 Worker 并自动锁定归属路径',
  )

  const goalUpd = store.workflowAction(id, {
    action: 'update_goal',
    worker_task_id: customAdd.worker_task.id,
    assigned_goal: '编写发布流水线校验脚本并生成 SBOM 清单',
    title: 'CI & SBOM 门禁',
    ui_priority: 'P0',
    files_owned: ['scripts/ci-verify/**', 'scripts/sbom/**'],
  })
  ok(
    goalUpd.ok === true
      && goalUpd.worker_task.ui_priority === 'P0'
      && goalUpd.worker_task.files_owned.length === 2,
    'workflowAction(update_goal) 同步更新任务目标、优先级与分片锁集合',
  )

  /* retryWorkerTask 将处于 revision_required 且带 error_detail 的 Worker B 重置为 running / in_progress / P0 / 清空报错 */
  const retryRes = store.workflowAction(id, {
    action: 'retry_worker',
    worker_task_id: workerB.id,
    reason: '已收敛修改范围后重新执行',
  })
  ok(
    retryRes.ok === true
      && retryRes.worker_task.status === 'running'
      && retryRes.worker_task.approval_state === 'in_progress'
      && retryRes.worker_task.ui_priority === 'P0'
      && retryRes.worker_task.error_detail === '',
    "workflowAction(retry_worker) 重置 status='running'、approval_state='in_progress'、ui_priority='P0'、error_detail=''",
  )

  /* 飞书配置保存（含 op: 'feishuConfig' 无 action 参数兼容）与真实本地 HTTP Webhook 推送 */
  const receivedBodies = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      try { receivedBodies.push(JSON.parse(raw)) } catch { receivedBodies.push({ raw }) }
      if (req.url === '/fail500') {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ code: 500, msg: 'mock error' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ code: 0, msg: 'success' }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const webhookOkUrl = `http://127.0.0.1:${port}/feishu-hook`

  try {
    const cfgViaAction = store.workflowAction(id, {
      op: 'feishuConfig',
      webhook_url: webhookOkUrl,
      enabled: true,
      events: { wave_complete: true, gate_alert: true },
    })
    ok(
      cfgViaAction.ok === true && cfgViaAction.feishu.webhook_url === webhookOkUrl && cfgViaAction.feishu.configured === true,
      "workflowAction({ op: 'feishuConfig' }) 持久化飞书配置且绝不抛 unknown workflowAction",
    )

    const pushOk = await dispatchAsync(store, {
      op: 'pushFeishuNotify',
      engagement_id: id,
      node_id: 'exploit',
      summary: 'Wave 3 分片构建与单元测试全部绿灯',
    })
    ok(
      pushOk.ok === true
        && pushOk.pushed === true
        && pushOk.status === 'delivered'
        && pushOk.http_status === 200
        && receivedBodies.length === 1
        && receivedBodies[0]?.msg_type === 'interactive',
      'pushFeishuNotify 向有效 http:// Webhook 发起真实 POST 并记录 HTTP 200 状态与飞书交互卡片载荷',
    )

    const push500 = await store.pushFeishuNotify(id, {
      webhook_url: `http://127.0.0.1:${port}/fail500`,
      summary: '测试远端 500 响应记录',
    })
    ok(
      push500.ok === false && push500.status === 'http_error' && push500.http_status === 500,
      'pushFeishuNotify 遇到远端非 2xx 时如实记录 status=http_error 与真实 HTTP 状态码',
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }

  /* 端口关闭后测试网络异常捕获 */
  const pushNetErr = await store.pushFeishuNotify(id, {
    webhook_url: `http://127.0.0.1:${port}/unreachable`,
    timeout_ms: 1000,
  })
  ok(
    pushNetErr.ok === false && pushNetErr.status === 'network_error' && Boolean(pushNetErr.error),
    'pushFeishuNotify 在网络不可达时优雅捕获异常并在元数据中记录 network_error，绝不崩溃',
  )

  /* ═══════════════════════════════════════════════════════════════════════
     7. workflowDag 活跃闭环聚合、合成 Markdown DocWall 与工程交付复现报告标题
     ═══════════════════════════════════════════════════════════════════════ */
  console.log('— 7. workflowDag 闭环态势、合成文稿墙与工程交付复现报告校验')
  const activeDag = store.workflowDag(id)
  ok(
    activeDag.hasStarted === true && activeDag.steps_count === 0,
    '即使 attack_step 为空，只要存在 plan_goals / worker_tasks 即正确判定 hasStarted = true',
  )
  ok(
    activeDag.docWall.some((d) => d.id === 'deliverable-plan-charter' && d.content.includes('4-Wave 目标蓝图'))
      && activeDag.docWall.some((d) => String(d.id).startsWith('deliverable-digest-') && d.content.includes('阶段交付摘要')),
    'docWall 从 plan_goals + shard_locks + worker_digests 自动合成结构化 Markdown 工程交付文稿',
  )
  ok(
    activeDag.telemetry.cache_hit_pct > 0
      && activeDag.telemetry.cache_hit_pct !== 94.2
      && activeDag.telemetry.parallel_efficiency_pct > 0
      && activeDag.telemetry.parallel_efficiency_pct !== 91.5
      && activeDag.telemetry.gate_pass_rate_pct > 0
      && activeDag.telemetry.gate_pass_rate_pct !== 98.0,
    `遥测指标由真实库表数据动态计算 (cache=${activeDag.telemetry.cache_hit_pct}%, parallel=${activeDag.telemetry.parallel_efficiency_pct}%, gate=${activeDag.telemetry.gate_pass_rate_pct}%)`,
  )

  /* scoreReport 标题与硬编码演练分值移除校验 */
  store.addScoreHit(id, {
    code: 'server-host',
    points: 50,
    target: 'http://10.0.0.8:8080/',
    evidence: '验证服务交付节点',
    note: '档位校正说明样本',
  })
  const simpleRep = store.scoreReport(id)
  const legacyRep = store.scoreReport(id, { layout: 'legacy' })
  ok(
    simpleRep.markdown.includes('工程交付复现报告') && legacyRep.markdown.includes('工程交付复现报告'),
    'scoreReport 默认与 legacy 布局均使用「工程交付复现报告」标题',
  )
  ok(
    !simpleRep.markdown.includes('16180')
      && !simpleRep.markdown.includes('16090')
      && !legacyRep.markdown.includes('16180')
      && !legacyRep.markdown.includes('16090')
      && !legacyRep.markdown.includes('红队成果复现报告'),
    'scoreReport 已彻底清除硬编码演练数字 16180 / 16090 与旧标题「红队成果复现报告」',
  )

  /* syncHostWorkersToPg 容量上限校验 (_syncedWorkerSig <= 512) */
  const manyWorkers = Array.from({ length: 530 }, (_, idx) => ({
    session_id: `cap-sess-${idx}`,
    worker_name: `CapWorker#${idx}`,
    assigned_goal: `批量同步上限测试 #${idx}`,
    status: 'running',
  }))
  store.syncHostWorkersToPg(id, manyWorkers)
  ok(store._syncedWorkerSig.size <= 512, `syncHostWorkersToPg 签名缓存严格封顶 512 条 (当前 ${store._syncedWorkerSig.size})`)

  /* ═══════════════════════════════════════════════════════════════════════
     8. pg-engine.js 协议安全、SQL 单遍词法转换与探针 LRU 上限回归
     ═══════════════════════════════════════════════════════════════════════ */
  console.log('— 8. pg-engine NUL 字节剥离、字符串内占位符保护、IS NOT DISTINCT FROM 与探针上限')
  ok(
    PG_CLUSTER_TABLES.some((t) => t.table === 'shard_locks') && TABLE_ALIAS_MAP.shard_locks === 'shard_locks',
    'PG_CLUSTER_TABLES 与 TABLE_ALIAS_MAP 均已注册 shard_locks 表',
  )

  const nulQuoted = quotePgLiteral('hello\x00world\x00!')
  ok(!nulQuoted.includes('\x00') && nulQuoted === "'helloworld!'", 'quotePgLiteral 剥离 \\x00 NUL 字节防止 C-string 查询报文截断')

  const interpolated = interpolatePgParams(
    "SELECT '$1 stays literal', col FROM worker_tasks WHERE id = $1 AND note = '$2 literal'",
    ['wt-100', 'should-not-appear'],
  )
  ok(
    interpolated.includes("'$1 stays literal'")
      && interpolated.includes("'$2 literal'")
      && interpolated.includes("'wt-100'")
      && !interpolated.includes('should-not-appear'),
    'interpolatePgParams 单遍扫描跳过单引号字符串字面量，绝不破坏字符串内的 $1 / $2',
  )

  const pgTranslated = translateSqlToPg(
    "SELECT * FROM vuln WHERE note = 'literal ? inside string' AND asset_id IS ? AND poc_fts MATCH ?",
  )
  ok(
    pgTranslated.sql.includes("'literal ? inside string'")
      && pgTranslated.sql.includes('asset_id IS NOT DISTINCT FROM $1')
      && pgTranslated.sql.includes("websearch_to_tsquery('simple'")
      && pgTranslated.sql.includes('$2')
      && pgTranslated.paramCount === 2,
    "translateSqlToPg 保护字符串内 '?'、将 'IS ?' 转为 'IS NOT DISTINCT FROM $1' 并升级 websearch_to_tsquery",
  )

  const probeTest = new PgWriteActivityProbe()
  for (let i = 0; i < 80; i += 1) {
    probeTest.record(`eng-${i}`, { table: 'shard_locks', op: 'INSERT', summary: `test-${i}` })
  }
  ok(
    probeTest.engagements.size <= 64 && !probeTest.engagements.has('eng-0') && probeTest.engagements.has('eng-79'),
    `PgWriteActivityProbe.engagements 严格限制在 64 个槽位以内并淘汰最旧条目 (当前 ${probeTest.engagements.size})`,
  )

  store.close()
} finally {
  rmSync(root, { recursive: true, force: true })
}

console.log(`\n通过 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
