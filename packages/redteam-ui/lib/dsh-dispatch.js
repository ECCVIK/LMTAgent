/**
 * LMTAgent Host Bridge — DSH 会话解包、子智能体派发与波次自动推进子系统
 *
 * 从 lib/index.js 拆出：
 *   - 会话 ID 解包与根智能体解析（unwrapSessionIdValue / resolveLiveRootAgent）
 *   - 子代理预设与安全拉起（startSubagentActivationSafe / deliverPromptToChild / bindWorkerSessionCompat）
 *   - 支持 maxAutoRetries 指数退避重拉与前置错误注入
 *   - 主代理 Captain 唤醒（sendRootFollowupMessage）
 *   - 工作流派发与波次自动推进（dispatchWorkflowToDshAgents / advanceNextWaveIfReady），集成预算熔断与推测 DAG 流水线
 */
import { randomUUID } from 'node:crypto'
import { resolveAgentModelRoute } from './llm-planner.js'
import {
  computeReadyTasksForPipeline,
  computeWorkspaceUsage,
  evaluateWorkspaceBudgetGuard,
} from './dag-scheduler.js'

function tryGet(ctx, serviceName) {
  if (!ctx || typeof ctx.get !== 'function') return null
  try { return ctx.get(serviceName) ?? null } catch { return null }
}

function deepFreezeObj(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return value
  if (typeof AbortSignal !== 'undefined' && value instanceof AbortSignal) return value
  if (!Array.isArray(value)) {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return value
  }
  if (seen.has(value)) return value
  seen.add(value)
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeObj(item, seen)
  } else {
    for (const k of Object.keys(value)) {
      deepFreezeObj(value[k], seen)
    }
  }
  return Object.isFrozen(value) ? value : Object.freeze(value)
}

function defaultParseJsonArraySafe(raw) {
  if (Array.isArray(raw)) return raw.map((x) => String(x)).filter(Boolean)
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean)
  } catch { /* ignore */ }
  return []
}

function defaultParseWaveNumber(waveVal, fallbackWave = 3) {
  if (typeof waveVal === 'number' && Number.isFinite(waveVal) && waveVal >= 1) return Math.floor(waveVal)
  const m = String(waveVal || '').match(/(\d+)/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n >= 1) return n
  }
  return fallbackWave
}

function defaultNormalizeThinkingEffort(effort) {
  const s = typeof effort === 'string' ? effort.trim().toLowerCase() : ''
  return ['none', 'low', 'medium', 'high'].includes(s) ? s : 'low'
}

export function unwrapSessionIdValue(raw) {
  if (!raw) return ''
  if (typeof raw === 'object') {
    const v = raw.sessionId || raw.id || raw.currentSessionId || ''
    return typeof v === 'string' ? v.trim() : ''
  }
  let s = String(raw).trim()
  if (!s) return ''
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('"') && s.endsWith('"'))) {
    try {
      const parsed = JSON.parse(s)
      if (typeof parsed === 'string') s = parsed.trim()
      else if (parsed && typeof parsed === 'object') {
        const inner = parsed.sessionId || parsed.id || parsed.currentSessionId || ''
        s = typeof inner === 'string' ? inner.trim() : ''
      }
    } catch { /* keep trimmed */ }
  }
  return s && !s.startsWith('{') ? s : ''
}

export async function resolveLiveRootAgent(ctx, sessionId, deps = {}) {
  const sid = String(sessionId || '').trim()
  if (!sid || !ctx) return null
  const resolveRoot = deps.resolveRootSessionId
  const checkSynthetic = deps.isSyntheticSessionId || (() => false)
  const rootId = (typeof resolveRoot === 'function' ? resolveRoot(ctx, sid) : unwrapSessionIdValue(sid)) || sid
  const agentsSvc = tryGet(ctx, 'agents')
  if (agentsSvc && typeof agentsSvc.get === 'function') {
    try {
      const live = agentsSvc.get(rootId)
      if (live) return live
    } catch { /* ignore */ }
  }
  if (!checkSynthetic(rootId)) {
    const typert = tryGet(ctx, 'typert')
    const agentLookup = typert && typert.lookups && typeof typert.lookups.get === 'function'
      ? typert.lookups.get('agent')
      : null
    if (agentLookup && typeof agentLookup.resolve === 'function') {
      try {
        const recovered = await agentLookup.resolve(rootId)
        if (recovered) return recovered
      } catch { /* ignore */ }
    }
  }
  return null
}

export function workerPresetForRole(role) {
  const r = String(role || '').trim().toLowerCase()
  const map = {
    recon: 'lmtagent-worker-recon',
    designer: 'lmtagent-worker-designer',
    assess: 'lmtagent-worker-assess',
    'vuln-scan': 'lmtagent-worker-vuln-scan',
    exploit: 'lmtagent-worker-exploit',
    qa: 'lmtagent-worker-qa',
    internal: 'lmtagent-worker-internal',
  }
  return map[r] || 'lmtagent-worker'
}

export function isPlaceholderWorkerSessionId(ctx, sid, deps = {}) {
  const s = String(sid || '').trim()
  if (!s) return true
  const checkSynthetic = deps.isSyntheticSessionId || (() => false)
  if (checkSynthetic(s)) return true
  const agentsSvc = tryGet(ctx, 'agents')
  if (agentsSvc && typeof agentsSvc.get === 'function') {
    try { if (agentsSvc.get(s)) return false } catch { /* ignore */ }
  }
  const sessionsSvc = tryGet(ctx, 'sessions')
  if (sessionsSvc && typeof sessionsSvc.get === 'function') {
    try { if (sessionsSvc.get(s)) return false } catch { /* ignore */ }
  }
  if (/^sess-[0-9a-f]{6}-w\d+$/i.test(s) || /^sess-[0-9a-z]{6,12}-\d+$/i.test(s)) {
    return true
  }
  return false
}

export function isRealChildSessionId(ctx, sid, deps = {}) {
  const s = String(sid || '').trim()
  if (!s || isPlaceholderWorkerSessionId(ctx, s, deps)) return false
  return true
}

export function resolveEngagementCwd(ctx, store, rootAgent, sessionId, explicitCwd = '', deps = {}) {
  const raw = typeof explicitCwd === 'string' ? explicitCwd.trim() : ''
  if (raw) return raw
  if (rootAgent && rootAgent.session && rootAgent.session.header && rootAgent.session.header.cwd) {
    return String(rootAgent.session.header.cwd).trim()
  }
  if (sessionId) {
    const sessionsSvc = tryGet(ctx, 'sessions')
    if (sessionsSvc && typeof sessionsSvc.get === 'function') {
      try {
        const s = sessionsSvc.get(sessionId)
        if (s && s.header && s.header.cwd) return String(s.header.cwd).trim()
      } catch { /* ignore */ }
    }
    if (store) {
      const bound = typeof deps.getCachedSessionBindingEntry === 'function'
        ? deps.getCachedSessionBindingEntry(store, sessionId)
        : (typeof store.getSessionState === 'function' ? store.getSessionState(sessionId) : null)
      if (bound && bound.cwd) return String(bound.cwd).trim()
    }
  }
  return ''
}

export function buildSelfContainedWorkerPrompt(task, engId, refinedPrompt = '', extraNote = '', deps = {}) {
  const parseArr = deps.parseJsonArraySafe || defaultParseJsonArraySafe
  const role = String((task && (task.worker_role || task.role)) || 'exploit').trim()
  const wave = String((task && (task.wave || task.wave_key)) || 'wave-1').trim()
  const taskId = task && task.id !== undefined ? String(task.id) : ''
  const workerName = String((task && (task.worker_name || task.title)) || `${role}-worker`).trim()
  const assignedGoal = String((task && (task.assigned_goal || task.assignedGoal || task.objective || task.goal || task.title)) || '').trim()
  const filesOwned = parseArr(task && (task.files_owned ?? task.filesOwned ?? task.files_owned_json))
  const acceptance = String((task && (task.acceptance_criteria || task.acceptanceCriteria)) || '').trim()
  const priorError = String(
    (deps && deps.priorError)
    || (task && (task.priorError || task.prior_error || task.error_detail))
    || '',
  ).trim()

  return [
    `你是 LMTAgent 集群执行角色 \`${role}\`（${wave} · ${workerName}）。`,
    `所属项目工作区（engagement_id）：\`${engId || 'default'}\`${taskId ? ` · 任务 ID（worker_task_id）：\`${taskId}\`` : ''}`,
    '',
    refinedPrompt ? `## 项目总体蓝图\n${String(refinedPrompt).slice(0, 1800)}\n` : '',
    `## 本次委派目标（Assigned Goal）\n${assignedGoal || workerName}`,
    '',
    `## 独占文件分片（files_owned — 严禁越界修改其他分片文件）\n${filesOwned.length > 0 ? filesOwned.map((f) => `- \`${f}\``).join('\n') : '- （遵循本角色职责范围，不修改未授权文件）'}`,
    acceptance ? `\n## 验收判据\n${acceptance}` : '',
    priorError ? `\n## 上次执行异常摘要（请优先排查并修复）\n${priorError.slice(0, 600)}` : '',
    extraNote ? `\n## 补充指令\n${extraNote}` : '',
    '',
    '## 执行与汇报纪律',
    '1. 所有研发成果、模块/缺陷/里程碑记录须写入事实库（`lmt_*` 工具），并附真实命令回显与验证证据。',
    `2. 完成后调用 \`lmt_workflow({ action: "submit_digest", engagement: ${JSON.stringify(engId || 'default')}, worker_task_id: ${JSON.stringify(taskId || workerName)}, worker_name: ${JSON.stringify(workerName)}, worker_role: ${JSON.stringify(role)}, wave: ${JSON.stringify(wave)}, what_was_done: "...", files_touched: [...], key_decisions: [...], verification: "..." })\` 提交压缩摘要，并在最终回复中给出完整结论与验证证据。`,
  ].filter(Boolean).join('\n')
}

export async function deliverPromptToChild(subagentsSvc, mode, rootAgent, childId, text, signal) {
  if (!subagentsSvc || !rootAgent || !childId) {
    throw new Error('缺少 subagents 服务、活跃 rootAgent 或目标 childId')
  }
  const content = [{ type: 'text', text: String(text || '') }]
  const source = { kind: 'user' }
  const sig = signal || AbortSignal.timeout(30000)
  const deliveryMode = mode === 'steer' ? 'steer' : 'queue'

  if (deliveryMode === 'steer' && typeof subagentsSvc.steerPrompt === 'function') {
    return await subagentsSvc.steerPrompt(rootAgent, childId, content, source, sig)
  }
  if (deliveryMode === 'queue' && typeof subagentsSvc.queuePrompt === 'function') {
    return await subagentsSvc.queuePrompt(rootAgent, childId, content, source, sig)
  }
  if (subagentsSvc.manager && typeof subagentsSvc.manager[deliveryMode === 'steer' ? 'steerPrompt' : 'queuePrompt'] === 'function') {
    return await subagentsSvc.manager[deliveryMode === 'steer' ? 'steerPrompt' : 'queuePrompt'](rootAgent, childId, content, source, sig)
  }
  const deliverSym = Symbol.for('dsh.subagent.deliverPrompt')
  if (typeof subagentsSvc[deliverSym] === 'function') {
    return await subagentsSvc[deliverSym](rootAgent, childId, content, source, sig, deliveryMode)
  }
  if (typeof subagentsSvc.queuePrompt === 'function') {
    return await subagentsSvc.queuePrompt(rootAgent, childId, content, source, sig)
  }
  if (typeof subagentsSvc.sendMessage === 'function') {
    return await subagentsSvc.sendMessage(rootAgent, childId, content, { signal: sig })
  }
  throw new Error(`subagents 服务不支持 ${deliveryMode}Prompt 续接投递`)
}

export async function bindWorkerSessionCompat(store, engId, task, childId, status = 'running', deps = {}) {
  if (!store || !engId || !childId) return false
  const taskId = task && task.id !== undefined && task.id !== null ? task.id : undefined
  const workerName = task && task.worker_name ? String(task.worker_name) : undefined
  const payload = {
    engagement: engId,
    engagement_id: engId,
    engagementId: engId,
    ...(taskId !== undefined ? { worker_task_id: taskId, id: taskId } : {}),
    ...(workerName ? { worker_name: workerName } : {}),
    session_id: String(childId),
    sessionId: String(childId),
    status,
    approval_state: 'working',
  }
  let bound = false
  if (typeof store.bindWorkerSession === 'function') {
    try {
      const res = typeof deps.invokeStoreMethodCompat === 'function'
        ? await deps.invokeStoreMethodCompat(store, 'bindWorkerSession', engId, payload)
        : await store.bindWorkerSession(engId, payload)
      if (res && res.ok !== false) bound = true
    } catch { /* fall through */ }
  }
  if (!bound && typeof deps.dispatch === 'function') {
    try {
      const res = deps.dispatch(store, Object.assign({ op: 'bindWorkerSession' }, payload))
      if (res && res.ok !== false) bound = true
    } catch { /* fall through */ }
  }
  if (typeof store.db === 'function' && taskId !== undefined) {
    try {
      const db = store.db(engId)
      if (db && typeof db.prepare === 'function') {
        const info = db.prepare(
          "UPDATE worker_tasks SET session_id = ?, status = ?, approval_state = CASE WHEN approval_state IN ('approved','pending_approval') THEN approval_state ELSE 'working' END, updated_at = ? WHERE engagement_id = ? AND CAST(id AS TEXT) = ?",
        ).run(String(childId), status, new Date().toISOString(), String(engId), String(taskId))
        if (info && info.changes > 0) bound = true
      }
    } catch { /* ignore */ }
  }
  return bound
}

export async function resolveSafeChildAgentOptions(ctx, rootAgent, thinkingEffort, signal, deps = {}) {
  const normEffort = deps.normalizeThinkingEffort || defaultNormalizeThinkingEffort
  const effort = normEffort(thinkingEffort)
  if (!effort || effort === 'none' || effort === 'off') return {}
  const llm = tryGet(ctx, 'llm')
  const route = resolveAgentModelRoute(ctx, rootAgent)
  if (llm && typeof llm.resolveCallConfig === 'function' && route.provider && route.model) {
    try {
      await llm.resolveCallConfig({
        provider: route.provider,
        model: route.model,
        reasoningEffort: effort,
      }, signal)
      return { reasoningEffort: effort }
    } catch (err) {
      const errCode = err && (err.code || (err.failure && err.failure.code))
      const errMsg = err && err.message ? String(err.message) : ''
      if (errCode === 'UNSUPPORTED_REASONING_EFFORT' || /UNSUPPORTED_REASONING_EFFORT|reasoning.?effort/i.test(errMsg)) {
        return {}
      }
    }
  }
  return { reasoningEffort: effort }
}

export async function startSubagentActivationSafe(ctx, subagentsSvc, rootAgent, task, opts = {}, deps = {}) {
  const providerName = opts.provider || 'spawn'
  const providerObj = typeof subagentsSvc.getProvider === 'function' ? subagentsSvc.getProvider(providerName) : null
  const supportsPreset = providerName !== 'fork'
    && (!providerObj || (providerObj.capabilities?.agentPreset !== false && !providerObj.inheritsParentContext))
  const sig = opts.signal || AbortSignal.timeout(30000)
  const agentOptions = await resolveSafeChildAgentOptions(ctx, rootAgent, opts.thinkingEffort, sig, deps)

  const rawMaxRetries = opts.maxAutoRetries ?? (opts.policy && opts.policy.maxAutoRetries)
  const maxAutoRetries = rawMaxRetries !== undefined && rawMaxRetries !== null && Number.isFinite(Number(rawMaxRetries))
    ? Math.max(0, Math.min(3, Math.floor(Number(rawMaxRetries))))
    : 1

  const activateOnce = async (priorErr) => {
    const promptDeps = priorErr ? Object.assign({}, deps, { priorError: priorErr }) : deps
    const reqObj = {
      parent: rootAgent,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      prompt: [{
        type: 'text',
        text: buildSelfContainedWorkerPrompt(task, opts.engId, opts.refinedPrompt, opts.extraNote, promptDeps),
      }],
      ...(supportsPreset ? { agentPreset: workerPresetForRole(task.worker_role || task.role) } : {}),
      ...(opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {}),
      ...(Object.keys(agentOptions).length > 0 ? { agentOptions } : {}),
    }
    const spec = {
      provider: providerName,
      delivery: 'parent',
      label: String(task.title || task.worker_name || `worker-${task.id || '1'}`),
      request: reqObj,
      signal: sig,
    }

    let started
    try {
      started = await subagentsSvc.startActivation(spec)
    } catch (err) {
      const msg = err && err.message ? String(err.message) : ''
      if (supportsPreset && /preset/i.test(msg)) {
        const fallbackReq = Object.assign({}, reqObj)
        if (fallbackReq.agentPreset !== 'lmtagent-worker') {
          fallbackReq.agentPreset = 'lmtagent-worker'
        } else {
          delete fallbackReq.agentPreset
        }
        started = await subagentsSvc.startActivation(Object.assign({}, spec, { request: fallbackReq }))
      } else {
        throw err
      }
    }
    if (!started || !started.childId) {
      throw new Error('startActivation 未返回有效的 childId')
    }
    return started
  }

  let priorError = ''
  for (let attempt = 0; attempt <= maxAutoRetries; attempt += 1) {
    try {
      const res = await activateOnce(priorError)
      if (attempt > 0) {
        return Object.assign({}, res, { retryAttempts: attempt, priorError })
      }
      return res
    } catch (err) {
      const msg = err && err.message ? String(err.message) : String(err)
      if (attempt >= maxAutoRetries || (sig && sig.aborted)) {
        throw err
      }
      priorError = msg.slice(0, 400)
      const delayMs = opts.retryDelayMs !== undefined
        ? Math.max(0, Number(opts.retryDelayMs) || 0)
        : (1500 * (attempt + 1))
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
  }
}

export function sendRootFollowupMessage(rootAgent, text) {
  if (!rootAgent || typeof rootAgent.followup !== 'function') {
    return { ok: false, error: 'rootAgent 不支持 followup 唤醒' }
  }
  const msg = deepFreezeObj({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(text || '') }],
    source: { kind: 'user' },
  })
  rootAgent.followup(msg)
  return { ok: true, messageId: msg.id }
}

export async function dispatchWorkflowToDshAgents(ctx, store, opts = {}, deps = {}) {
  const resolveSettingsRoot = deps.resolveRedteamSettingsRoot || ((r) => (typeof r === 'string' ? r : ''))
  const readSettings = deps.readUnifiedSettings || (() => ({
    maxAgents: 6,
    thinkingEffort: 'low',
    maxDepth: 3,
    dispatchPolicy: deps.defaultDispatchPolicy || {
      dispatchMode: 'hybrid_auto',
      subagentProvider: 'spawn',
      autoWakeOnApprove: true,
      maxAutoRetries: 1,
    },
  }))
  const parseWave = deps.parseWaveNumber || defaultParseWaveNumber
  const parseArr = deps.parseJsonArraySafe || defaultParseJsonArraySafe

  const engId = String(opts.engagementId || opts.engagement || '').trim()
  const sessionId = String(opts.sessionId || opts.session || '').trim()
  const settingsRoot = opts.settingsRoot || resolveSettingsRoot(store && store.root)
  const settings = opts.settings || readSettings(settingsRoot, process.env)
  const policy = settings.dispatchPolicy || deps.defaultDispatchPolicy || {
    dispatchMode: 'hybrid_auto',
    subagentProvider: 'spawn',
    autoWakeOnApprove: true,
    maxAutoRetries: 1,
  }

  /* 工作区级 Token / 费用预算熔断校验 */
  const dag = opts.dag || (store && engId && typeof store.workflowDag === 'function' ? store.workflowDag(engId) : null)
  const usage = computeWorkspaceUsage(dag, opts.hostSessions, { usage: opts.usage })
  const budget = evaluateWorkspaceBudgetGuard(usage, policy)
  if (budget.tripped && !opts.allowOverrideBudget) {
    return {
      ok: false,
      mode: 'budget_blocked',
      budget_exceeded: true,
      budget,
      spawned: [],
      error: budget.reason || '工作区 Token 或费用预算已达上限，已熔断子代理派发',
    }
  }

  const clusterCfg = {
    maxAgents: settings.maxAgents,
    thinkingEffort: settings.thinkingEffort,
    maxDepth: settings.maxDepth,
  }

  const subagentsSvc = tryGet(ctx, 'subagents')
  const rootAgent = await resolveLiveRootAgent(ctx, sessionId, deps)
  const resolvedCwd = resolveEngagementCwd(ctx, store, rootAgent, sessionId, opts.cwd, deps)

  const tasks = Array.isArray(opts.workerTasks) ? opts.workerTasks : []
  const spawned = []
  const errors = []
  const warnings = []

  const canStartSubagents = Boolean(
    policy.dispatchMode === 'hybrid_auto'
    && rootAgent
    && subagentsSvc
    && typeof subagentsSvc.startActivation === 'function',
  )

  if (canStartSubagents) {
    const wave1Targets = tasks
      .filter((t) => {
        if (!t || typeof t !== 'object') return false
        if (parseWave(t.wave ?? t.wave_key, 3) !== 1) return false
        const st = String(t.status || '').toLowerCase()
        if (['completed', 'done', 'finished', 'approved', 'cancelled', 'archived'].includes(st)) return false
        if (st === 'running' && isRealChildSessionId(ctx, t.session_id, deps)) return false
        return true
      })
      .slice(0, Math.max(1, clusterCfg.maxAgents))

    const settled = await Promise.allSettled(
      wave1Targets.map(async (task) => {
        const started = await startSubagentActivationSafe(ctx, subagentsSvc, rootAgent, task, {
          provider: policy.subagentProvider || 'spawn',
          cwd: resolvedCwd,
          engId,
          refinedPrompt: opts.refinedPrompt || '',
          maxDepth: clusterCfg.maxDepth,
          thinkingEffort: clusterCfg.thinkingEffort,
          maxAutoRetries: policy.maxAutoRetries ?? 1,
          retryDelayMs: opts.retryDelayMs,
          signal: opts.signal,
        }, deps)
        if (started && started.childId) {
          await bindWorkerSessionCompat(store, engId, task, started.childId, 'running', deps)
          return {
            worker_task_id: task.id,
            worker_name: task.worker_name || task.title,
            role: task.worker_role || task.role,
            title: task.title || task.worker_name,
            childId: started.childId,
            files_owned: parseArr(task.files_owned ?? task.files_owned_json),
          }
        }
        throw new Error('startActivation 未返回有效的 childId')
      }),
    )

    for (let i = 0; i < settled.length; i += 1) {
      const r = settled[i]
      const task = wave1Targets[i]
      if (r.status === 'fulfilled') {
        spawned.push(r.value)
      } else {
        const msg = r.reason && r.reason.message ? r.reason.message : String(r.reason)
        errors.push({
          worker_task_id: task && task.id,
          worker_name: task && (task.worker_name || task.title),
          error: msg,
        })
      }
    }
    if (errors.length > 0) {
      warnings.push(`部分 Wave 1 子代理拉起失败（${errors.length}/${wave1Targets.length}）：${errors.map((e) => `${e.worker_name}: ${e.error}`).join('; ')}`)
    }
  } else {
    if (policy.dispatchMode === 'hybrid_auto' && (!subagentsSvc || typeof subagentsSvc.startActivation !== 'function')) {
      warnings.push('宿主 subagents 服务不可用，已降级为仅唤醒主代理 Captain 统筹派发。')
    }
    if (!rootAgent) {
      warnings.push('未解析到活跃的宿主根代理会话（rootAgent），任务已写入事实库，请在打开会话后手动唤醒或拉起。')
    }
  }

  let captainNotified = false
  if (rootAgent && typeof rootAgent.followup === 'function') {
    const wave2Plus = tasks.filter((t) => parseWave(t && (t.wave ?? t.wave_key), 3) > 1)
    let syncText = ''
    if (spawned.length > 0) {
      syncText = [
        `【LMTAgent 控制台 · 方案 A 混合协同状态同步】`,
        `- 项目工作区（engagement_id）：\`${engId}\``,
        opts.userPrompt ? `- 用户需求：${String(opts.userPrompt).slice(0, 600)}` : '',
        '',
        '以下 **Wave 1 子代理已由控制台通过 `subagents.startActivation` 真实拉起并正在后台运行（严禁 Captain 重复派发 Wave 1）**：',
        ...spawned.map((s) => `- [Wave 1 · ${s.role}] \`${s.worker_name}\` → 真实子会话 childId: \`${s.childId}\`${s.files_owned.length ? ` · 分片: ${s.files_owned.join(', ')}` : ''}`),
        '',
        wave2Plus.length > 0
          ? `后续待编排波次（Wave 2–4，共 ${wave2Plus.length} 项）：\n` + wave2Plus.map((t) => `- [${t.wave || 'wave-?'} · ${t.worker_role || t.role}] ${t.title || t.worker_name} (task_id=${t.id})`).join('\n')
          : '',
        '',
        '请主控 Captain 耐心等待上述 Wave 1 子代理通过 `delivery: "parent"` 完成汇报（或 `send_message` 回传），核验事实库摘要后通过 `lmt_workflow` 执行审批并接管 Wave 2–4 的协同调度！',
      ].filter(Boolean).join('\n')
    } else {
      syncText = [
        `【LMTAgent 控制台 · 主代理全权调度通知】`,
        `- 项目工作区（engagement_id）：\`${engId}\``,
        opts.refinedPrompt ? `- 蓝图规格说明：\n${String(opts.refinedPrompt).slice(0, 1500)}` : '',
        '',
        `已写入 ${tasks.length} 项 4-Wave 分片任务到事实库（\`worker_tasks\`）：`,
        ...tasks.map((t) => `- [${t.wave || 'wave-?'} · ${t.worker_role || t.role}] ${t.title || t.worker_name} (task_id=${t.id}) · 目标: ${String(t.assigned_goal || '').slice(0, 160)}`),
        '',
        '请主控 Captain 按照 4-Wave Bounded DAG 与 `lmt_agent_slot` 并发闸门开始派发与闭环编排。',
      ].filter(Boolean).join('\n')
    }
    try {
      const fRes = sendRootFollowupMessage(rootAgent, syncText)
      captainNotified = Boolean(fRes.ok)
      if (!fRes.ok && fRes.error) warnings.push(fRes.error)
    } catch (err) {
      warnings.push(`唤醒主代理 Captain 失败：${err && err.message ? err.message : String(err)}`)
    }
  }

  const effectiveMode = spawned.length > 0
    ? 'hybrid_auto'
    : (policy.dispatchMode === 'captain_only' ? 'captain_only' : (canStartSubagents ? 'hybrid_auto' : 'captain_only'))

  return {
    mode: effectiveMode,
    provider: policy.subagentProvider || 'spawn',
    spawned,
    budget,
    ...(errors.length > 0 ? { errors } : {}),
    captainNotified,
    rootAgentId: rootAgent ? rootAgent.id : null,
    ...(warnings.length > 0 ? { warning: warnings.join('；') } : {}),
  }
}

/**
 * 审批通过任务后自动推进下一波次（或启用 `speculativeWaveDispatch` 时按 `computeReadyTasksForPipeline` 推测推进所有非重叠可就绪下游节点），
 * 并在执行前强制校验 `evaluateWorkspaceBudgetGuard`。
 */
export async function advanceNextWaveIfReady(ctx, store, opts = {}, deps = {}) {
  const resolveSettingsRoot = deps.resolveRedteamSettingsRoot || ((r) => (typeof r === 'string' ? r : ''))
  const readSettings = deps.readUnifiedSettings || (() => ({
    maxAgents: 6,
    thinkingEffort: 'low',
    maxDepth: 3,
    dispatchPolicy: deps.defaultDispatchPolicy || {
      dispatchMode: 'hybrid_auto',
      subagentProvider: 'spawn',
      autoWakeOnApprove: true,
      autoAdvanceWave: false,
      speculativeWaveDispatch: false,
      maxAutoRetries: 1,
    },
  }))
  const parseWave = deps.parseWaveNumber || defaultParseWaveNumber
  const parseArr = deps.parseJsonArraySafe || defaultParseJsonArraySafe

  const settingsRoot = opts.settingsRoot || resolveSettingsRoot(store && store.root)
  const settings = opts.settings || readSettings(settingsRoot, process.env)
  const policy = (settings && settings.dispatchPolicy) || {}

  if (!policy.autoAdvanceWave) {
    return { triggered: false, reason: 'disabled', spawned: [] }
  }
  if (opts.approvalState && String(opts.approvalState).trim() !== 'approved') {
    return { triggered: false, reason: 'not_approved', spawned: [] }
  }

  const engId = String(opts.engagementId || opts.engagement || '').trim()
  if (!engId) {
    return { triggered: false, reason: 'missing_engagement', spawned: [] }
  }

  const dag = opts.dag || (store && typeof store.workflowDag === 'function' ? store.workflowDag(engId) : null)
  const usage = computeWorkspaceUsage(dag, opts.hostSessions, { usage: opts.usage })
  const budget = evaluateWorkspaceBudgetGuard(usage, policy)
  if (budget.tripped && !opts.allowOverrideBudget) {
    return {
      ok: false,
      triggered: false,
      reason: 'budget_exceeded',
      budget_exceeded: true,
      budget,
      spawned: [],
      error: budget.reason || '工作区 Token 或费用预算已达上限，已停止自动推进',
    }
  }

  const currentWave = opts.currentWave
    ? parseWave(opts.currentWave, 0)
    : (opts.approvedTask ? parseWave(opts.approvedTask.wave ?? opts.approvedTask.wave_key, 0) : 0)

  const tasks = dag && Array.isArray(dag.worker_tasks) ? dag.worker_tasks : []
  const maxAgents = Math.max(1, Number(settings.maxAgents) || 6)
  const runningCount = tasks.filter((t) => (
    t && String(t.status || '').trim().toLowerCase() === 'running' && isRealChildSessionId(ctx, t.session_id, deps)
  )).length
  const availableSlots = Math.max(0, maxAgents - runningCount)

  let nextWave = currentWave + 1
  let nextWaveTargets = []

  if (policy.speculativeWaveDispatch) {
    const pipeline = computeReadyTasksForPipeline(dag || { worker_tasks: tasks }, Object.assign({}, policy, {
      availableSlots,
    }))
    if (pipeline.cycleDetected) {
      return {
        triggered: false,
        reason: 'dag_cycle_detected',
        cycleNodes: pipeline.cycleNodes,
        spawned: [],
      }
    }
    nextWaveTargets = pipeline.readyTasks
      .filter((t) => !(String(t.status || '').trim().toLowerCase() === 'running' && isRealChildSessionId(ctx, t.session_id, deps)))
      .slice(0, maxAgents)
    if (nextWaveTargets.length === 0) {
      return {
        triggered: false,
        reason: pipeline.blockedByShardLock.length > 0 ? 'blocked_by_shard_lock' : 'no_ready_tasks',
        currentWave,
        pipeline,
        spawned: [],
      }
    }
    nextWave = parseWave(nextWaveTargets[0].wave ?? nextWaveTargets[0].wave_key, Math.max(1, currentWave) + 1)
  } else {
    if (currentWave < 1) {
      return { triggered: false, reason: 'unknown_wave', spawned: [] }
    }
    const waveKTasks = tasks.filter((t) => t && parseWave(t.wave ?? t.wave_key, 0) === currentWave)
    if (waveKTasks.length === 0) {
      return { triggered: false, reason: 'no_wave_tasks', currentWave, spawned: [] }
    }

    const DONE_STATUSES = new Set(['done', 'approved', 'completed'])
    const allWaveKDone = waveKTasks.every((t) => {
      const st = String(t.status || '').trim().toLowerCase()
      const ap = String(t.approval_state || '').trim().toLowerCase()
      return DONE_STATUSES.has(st) || ap === 'approved'
    })
    if (!allWaveKDone) {
      return { triggered: false, reason: 'wave_incomplete', currentWave, spawned: [] }
    }

    const SKIP_NEXT_STATUSES = new Set(['completed', 'done', 'finished', 'approved', 'cancelled', 'archived'])
    nextWaveTargets = tasks
      .filter((t) => {
        if (!t || typeof t !== 'object') return false
        if (parseWave(t.wave ?? t.wave_key, 0) !== nextWave) return false
        const st = String(t.status || '').trim().toLowerCase()
        if (SKIP_NEXT_STATUSES.has(st)) return false
        if (st === 'running' && isRealChildSessionId(ctx, t.session_id, deps)) return false
        return true
      })
      .slice(0, Math.max(1, availableSlots || maxAgents))

    if (nextWaveTargets.length === 0) {
      return { triggered: false, reason: 'no_next_wave_tasks', currentWave, nextWave, spawned: [] }
    }
  }

  const sessionId = String(opts.sessionId || opts.session || '').trim()
  const subagentsSvc = opts.subagentsSvc || tryGet(ctx, 'subagents')
  const rootAgent = opts.rootAgent || (sessionId ? await resolveLiveRootAgent(ctx, sessionId, deps) : null)
  if (!rootAgent || !subagentsSvc || typeof subagentsSvc.startActivation !== 'function') {
    return {
      triggered: false,
      reason: !rootAgent ? 'no_root_agent' : 'no_subagents_service',
      currentWave,
      nextWave,
      spawned: [],
    }
  }

  const resolvedCwd = resolveEngagementCwd(ctx, store, rootAgent, sessionId, opts.cwd, deps)
  const spawned = []
  const errors = []

  const settled = await Promise.allSettled(
    nextWaveTargets.map(async (task) => {
      const started = await startSubagentActivationSafe(ctx, subagentsSvc, rootAgent, task, {
        provider: policy.subagentProvider || 'spawn',
        cwd: resolvedCwd,
        engId,
        refinedPrompt: opts.refinedPrompt || '',
        maxDepth: settings.maxDepth,
        thinkingEffort: settings.thinkingEffort,
        maxAutoRetries: policy.maxAutoRetries ?? 1,
        retryDelayMs: opts.retryDelayMs,
        signal: opts.signal,
      }, deps)
      if (started && started.childId) {
        await bindWorkerSessionCompat(store, engId, task, started.childId, 'running', deps)
        return {
          worker_task_id: task.id,
          worker_name: task.worker_name || task.title,
          role: task.worker_role || task.role,
          title: task.title || task.worker_name,
          wave: task.wave || `wave-${nextWave}`,
          childId: started.childId,
          files_owned: parseArr(task.files_owned ?? task.files_owned_json),
        }
      }
      throw new Error('startActivation 未返回有效的 childId')
    }),
  )

  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i]
    const task = nextWaveTargets[i]
    if (r.status === 'fulfilled') {
      spawned.push(r.value)
    } else {
      errors.push({
        worker_task_id: task && task.id,
        worker_name: task && (task.worker_name || task.title),
        error: r.reason && r.reason.message ? r.reason.message : String(r.reason),
      })
    }
  }

  let captainNotified = false
  if (spawned.length > 0 && rootAgent && typeof rootAgent.followup === 'function') {
    const modeTitle = policy.speculativeWaveDispatch
      ? `【LMTAgent 控制台 · 推测 DAG 流水线自动推进下游可就绪节点】`
      : `【LMTAgent 控制台 · Wave ${currentWave} 已全部审批，自动推进至 Wave ${nextWave}】`
    const syncText = [
      modeTitle,
      `- 项目工作区（engagement_id）：\`${engId}\``,
      `以下 **子代理已自动通过 \`subagents.startActivation\` 拉起**：`,
      ...spawned.map((s) => `- [${s.wave || `Wave ${nextWave}`} · ${s.role}] \`${s.worker_name}\` → childId: \`${s.childId}\`${s.files_owned.length ? ` · 分片: ${s.files_owned.join(', ')}` : ''}`),
      '请主控 Captain 持续跟踪上述子代理执行与汇总状态。',
    ].join('\n')
    try {
      const fRes = sendRootFollowupMessage(rootAgent, syncText)
      captainNotified = Boolean(fRes.ok)
    } catch { /* ignore */ }
  }

  return {
    triggered: spawned.length > 0,
    mode: policy.speculativeWaveDispatch ? 'speculative' : 'barrier',
    currentWave,
    nextWave,
    spawned,
    budget,
    ...(errors.length > 0 ? { errors } : {}),
    captainNotified,
  }
}
