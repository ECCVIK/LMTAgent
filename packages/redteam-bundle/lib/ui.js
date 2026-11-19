/**
 * LMTAgent 控制台 —— Host 半侧（Cordis 插件 `lmtagent-ui`）
 *
 * 职责：为浏览器半侧提供私有 HTTP 桥接 `POST /lmtagent/api` 与增量 SSE 流 `GET /lmtagent/events`：
 *   · 资产库与事实库 op 转交 `ctx.lmtagent`（兼容 `ctx.redteam`）；
 *   · 统一设置读写、自动更新、增量 JSONL 遥测与 Git 越界回滚 / DAG 调度已模块化拆分至同级子模块；
 *   · 同源 / 回环校验（Origin / Host / Sec-Fetch-Site）严格拦截跨源请求。
 */
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import * as coreMod from './store-core.js'
import { evaluateSkillsAvailability, summarizeSkills } from './skill-availability.js'
import {
  DEFAULT_MAX_AGENTS,
  MAX_AGENTS_LIMIT,
  DEFAULT_THINKING_EFFORT,
  VALID_THINKING_EFFORTS,
  DEFAULT_MAX_DEPTH,
  MAX_DEPTH_LIMIT,
  MAX_AUTO_RETRIES_LIMIT,
  DEFAULT_AI_PLANNER_SETTINGS,
  DEFAULT_DISPATCH_POLICY,
  clampMaxAgents,
  normalizeThinkingEffort,
  clampMaxDepth,
  invalidateSettingsCache,
  invalidateSessionBindingsCache,
  invalidateEngagementCaches,
  readSettingsCached,
  writeSettings,
  resolveCachedSettingsArg,
  maxAgentsOf,
  maxAgentsSourceOf,
  saveMaxAgents,
  savePgUrl,
  thinkingEffortOf,
  saveThinkingEffort,
  maxDepthOf,
  saveMaxDepth,
  resolveRedteamSettingsRoot,
  clampIntInRange,
  readUnifiedSettings,
  writeUnifiedSettings,
  maskPgUrlSafe,
  getCachedActiveEngagementId,
  getCachedEngagementsList,
  getCachedSessionBindingEntry,
} from './settings-bridge.js'
import { handleUpdateOp } from './update-manager.js'
import {
  isUuidSessionTitle,
  isUuidEngagement,
  filterValidEngagements,
  buildValidEngagementMap,
  AGENT_ROLE_META,
  inferAgentRole,
  IncrementalSessionJsonlReader,
  sessionJsonlReader,
  approvedWorkerOverrides,
  approvedWorkerMap,
  isBareRoleName,
  setScopedWorkerOverride,
  deleteScopedWorkerOverride,
  computeWorkerLmtexMeta,
  parseJsonArraySafe,
  isSyntheticSessionId,
  createRequestFlow,
  getWorkflowDagDedup,
  resolveRootFromMap,
  parseWaveNumber,
  discoverHostSessions,
  synthesizeAgentCollaboration,
  extractAgentSessionDetail,
} from './telemetry-jsonl.js'
import { normalizeTouchedFilePath } from './telemetry-jsonl.js'
import { rollbackScopeViolations, sanitizeRepoRelativePath } from './scope-rollback.js'
import {
  validateLoopbackWindowUrl,
  resolveAppBrowserBin,
  launchStandaloneWindow,
} from './window-launcher.js'
import {
  detectDagCycles,
  computeReadyTasksForPipeline,
  computeWorkspaceUsage,
  evaluateWorkspaceBudgetGuard,
  computeWorkspacePerfMetrics,
} from './dag-scheduler.js'
import {
  extractJsonFromLlmText,
  resolveAgentModelRoute,
  fetchLlmModelCatalog,
  sampleWorkspaceContext,
  invokeDshLlmJson as invokeDshLlmJsonCore,
  clarifyWishWithAI as clarifyWishWithAICore,
  decomposeWishWithAI as decomposeWishWithAICore,
} from './llm-planner.js'
import {
  unwrapSessionIdValue,
  resolveLiveRootAgent as resolveLiveRootAgentCore,
  isRealChildSessionId as isRealChildSessionIdCore,
  resolveEngagementCwd as resolveEngagementCwdCore,
  deliverPromptToChild,
  bindWorkerSessionCompat as bindWorkerSessionCompatCore,
  startSubagentActivationSafe as startSubagentActivationSafeCore,
  sendRootFollowupMessage,
  dispatchWorkflowToDshAgents as dispatchWorkflowToDshAgentsCore,
  advanceNextWaveIfReady as advanceNextWaveIfReadyCore,
} from './dsh-dispatch.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, '..')
const HOST_BUILD_VERSION = (() => {
  try {
    const pkgRaw = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'))
    return pkgRaw && typeof pkgRaw.version === 'string' ? pkgRaw.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

const { dispatch, dispatchAsync, probePgConnection, resolvePgConfig } = coreMod
const getPgWriteProbe = coreMod.getPgWriteProbe || (() => ({
  snapshot: () => ({ mode: 'wal', totalWrites: 0, writeRatePerMin: 0, tables: [], recentEvents: [] }),
}))

/* ------------------------------------------------------------------ Host 事件序号 (eventSeq) 与 SSE 广播管理 */
let eventSeq = 1
const sseClients = new Set()

export function getEventSeq() {
  return eventSeq
}

export function bumpEventSeq(reason = 'update', extra = null) {
  eventSeq += 1
  if (sseClients.size > 0) {
    const payload = Object.assign(
      { seq: eventSeq, reason, ts: Date.now() },
      extra && typeof extra === 'object' ? extra : {},
    )
    const frame = `data: ${JSON.stringify(payload)}\n\n`
    for (const client of Array.from(sseClients)) {
      if (!client || client.writableEnded || client.destroyed) {
        sseClients.delete(client)
        continue
      }
      try {
        client.write(frame)
      } catch {
        sseClients.delete(client)
      }
    }
  }
  return eventSeq
}

/** 本包自带技能目录（dev 安装的 UI 包无 skills/ 时恒为 false）。 */
const PLUGIN_SKILLS_DIR = (() => {
  try { return resolve(fileURLToPath(new URL('../skills/', import.meta.url))) } catch { return null }
})()

const sameDir = (a, b) => {
  if (a === null || b === null) return false
  try { return resolve(a) === resolve(b) } catch { return false }
}

const skillCategoryOf = (description) => {
  const m = /^【([^】]{1,12})】/.exec(String(description || ''))
  return m === null ? '未分类' : m[1]
}

/** Cordis 插件名。 */
export const name = 'lmtagent-ui'

/** 硬依赖：事实库服务 + 浏览器 HTTP 载体 + 技能注册表 + preset 名册。 */
export const inject = ['lmtagent', 'webServer', 'skills', 'agentPresets']

const MAX_BODY_BYTES = 8 * 1024 * 1024

function tryGet(ctx, serviceName) {
  if (!ctx || typeof ctx.get !== 'function') return null
  try { return ctx.get(serviceName) ?? null } catch { return null }
}

function resolveStore(ctx) {
  if (!ctx || typeof ctx !== 'object') return null
  return ctx.lmtagent || ctx.redteam || tryGet(ctx, 'lmtagent') || tryGet(ctx, 'redteam') || null
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

let skillAvailabilityCache = null
const SKILL_AVAILABILITY_TTL_MS = 30000

async function skillAvailabilityOf(ctx, list, scope, force) {
  const now = Date.now()
  if (!force && skillAvailabilityCache !== null
    && now - skillAvailabilityCache.at < SKILL_AVAILABILITY_TTL_MS
    && skillAvailabilityCache.size === list.length) {
    return { at: skillAvailabilityCache.at, cached: true, byName: skillAvailabilityCache.byName }
  }
  const { byName } = await evaluateSkillsAvailability(ctx.skills, list, { scope })
  skillAvailabilityCache = { at: now, size: list.length, byName }
  return { at: now, cached: false, byName }
}

const PRESET_ID_CANDIDATES = ['lmtagent', 'redteam']

async function resolveRedteamScope(ctx) {
  const presets = ctx.agentPresets
  if (typeof presets?.acquireScope === 'function') {
    let lastErr = null
    for (const presetId of PRESET_ID_CANDIDATES) {
      try {
        const lease = await presets.acquireScope(presetId)
        if (lease && lease.key !== undefined) {
          const release = typeof lease?.[Symbol.asyncDispose] === 'function'
            ? () => lease[Symbol.asyncDispose]()
            : (typeof lease?.dispose === 'function' ? () => lease.dispose() : null)
          return { key: lease.key, release }
        }
      } catch (err) {
        lastErr = err
      }
    }
    if (lastErr) throw lastErr
  }
  if (typeof presets?.standingKeyFor === 'function') {
    let lastErr = null
    for (const presetId of PRESET_ID_CANDIDATES) {
      try {
        const key = await presets.standingKeyFor(presetId)
        if (key !== undefined && key !== null) return { key, release: null }
      } catch (err) {
        lastErr = err
      }
    }
    if (lastErr) throw lastErr
  }
  let seen = '（没有 agentPresets 服务）'
  if (presets) {
    const proto = Object.getPrototypeOf(presets)
    seen = Object.getOwnPropertyNames(proto)
      .filter((n) => typeof presets[n] === 'function')
      .slice(0, 16)
      .join(', ') || '（看不到任何方法）'
  }
  throw new Error('当前 DSH 的 agentPresets 缺少 acquireScope / standingKeyFor；实际可用：' + seen)
}

async function handleSkillOp(ctx, request) {
  if (request.op !== 'skillCatalog' && request.op !== 'skillRead') return undefined
  let lease
  try {
    lease = await resolveRedteamScope(ctx)
  } catch (error) {
    return { ok: false, error: '无法解析 LMTAgent preset 作用域：' + (error && error.message ? error.message : String(error)) }
  }
  try {
    return await readSkillOp(ctx, request, lease.key)
  } finally {
    if (typeof lease.release === 'function') {
      try { await lease.release() } catch { /* ignore */ }
    }
  }
}

async function readSkillOp(ctx, request, scope) {
  if (request.op === 'skillCatalog') {
    const list = await ctx.skills.list({ scope })
    const availability = await skillAvailabilityOf(ctx, list, scope, request.refresh === true)
    const bySource = new Map()
    const byDir = new Map()
    const items = list.map((s) => {
      const dir = s.resourceBase && s.resourceBase.kind === 'directory' ? s.resourceBase.path : null
      const dirLabel = dir === null ? '(非文件系统来源)' : dir
      byDir.set(dirLabel, (byDir.get(dirLabel) || 0) + 1)
      bySource.set(s.source, (bySource.get(s.source) || 0) + 1)
      const avail = availability.byName.get(s.name)
      return {
        name: s.name,
        description: s.description,
        category: skillCategoryOf(s.description),
        whenToUse: s.whenToUse || '',
        provider: s.provider,
        source: s.source,
        dir,
        modelInvocable: s.invocation ? s.invocation.modelInvocable !== false : true,
        userInvocable: s.invocation ? s.invocation.userInvocable !== false : true,
        fromPlugin: sameDir(dir, PLUGIN_SKILLS_DIR),
        availability: avail ? avail.status : 'unknown',
        problems: avail ? avail.problems : ['未检查'],
        needs_user: avail ? avail.needs_user : [],
      }
    })
    const availSummary = summarizeSkills(Array.from(availability.byName.values()))
    return {
      ok: true,
      total: items.length,
      fromPlugin: items.filter((x) => x.fromPlugin).length,
      availability: {
        summary: availSummary,
        checked_at: availability.at,
        cached: availability.cached,
        broken: Array.from(availability.byName.values()).filter((x) => x.status === 'broken')
          .map((x) => ({ name: x.name, issues: x.issues, problems: x.problems, needs_user: x.needs_user })),
        note: '可用性 = 技能文件存在 + 正文能加载 + 必需环境变量已设置 + 正文引用的本机路径存在 + 没有未填的基础设施占位符；'
          + '判定用的是运行 dsh 的这个进程的环境变量（不是 shell 里 export 的）。未列出的技能正文读不到，状态为未知。',
      },
      bySource: Array.from(bySource, ([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n),
      byDir: Array.from(byDir, ([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n),
      note: '技能由 DSH 原生注册表管理：DSH 自带根 + $DSH_HOME/skills + 项目根 .dsh/skills、.agents/skills + 各插件注册的根。本插件只自带 '
        + '了 ' + items.filter((x) => x.fromPlugin).length + ' 个（随包分发），其余来自其它来源。',
      items,
    }
  }
  if (typeof request.name !== 'string' || request.name.length === 0) {
    return { ok: false, error: 'name required' }
  }
  const skill = await ctx.skills.get(request.name, { scope })
  if (skill === undefined) return { ok: false, error: 'skill not found: ' + request.name }
  return {
    ok: true,
    name: skill.name,
    description: skill.description,
    category: skillCategoryOf(skill.description),
    whenToUse: skill.whenToUse || '',
    provider: skill.provider,
    source: skill.source,
    path: skill.path || null,
    content: skill.content || '',
  }
}

/**
 * 清洗 bootstrap / sessionBinding / sessionOnboarding 返回结果中的伪 UUID 工作区，
 * 并严格保持未初始化/未绑定会话的 `bound: null` / `current: null`（零跨会话劫持）。
 */
function handleBootstrap(store, request, result, hostSessions = null) {
  if (!result || typeof result !== 'object') return result
  const allEngs = store ? getCachedEngagementsList(store) : (Array.isArray(result.engagements) ? result.engagements : [])
  const validEngById = buildValidEngagementMap(allEngs)

  if (Array.isArray(result.engagements)) {
    result.engagements = filterValidEngagements(result.engagements)
    const realNamed = result.engagements.filter((e) => e && !isUuidEngagement(e))
    if (!request.session) {
      if (realNamed.length > 0 && (!result.current || isUuidSessionTitle(result.current) || !result.engagements.some((e) => e.id === result.current))) {
        result.current = realNamed[0].id
        try {
          if (store && typeof store.setActiveEngagement === 'function') {
            store.setActiveEngagement(realNamed[0].id)
            invalidateEngagementCaches(store)
          }
        } catch { /* ignore */ }
      }
    }
  }

  const rawReqSession = typeof request.session === 'string' ? request.session.trim() : ''
  const resolvedRootSid = String(
    result.root_session
    || (result.session_binding && result.session_binding.session)
    || (rawReqSession && typeof request.resolveRoot === 'function' ? request.resolveRoot(rawReqSession) : rawReqSession)
    || '',
  ).trim()

  const liveSessionItem = (resolvedRootSid && Array.isArray(hostSessions))
    ? (hostSessions.find((s) => s && String(s.id) === resolvedRootSid) || null)
    : null

  const normalizeBindingView = (baseObj, sid) => {
    const src = baseObj && typeof baseObj === 'object' ? baseObj : {}
    let boundId = src.bound ?? src.engagement ?? null
    let boundName = src.name ?? null
    let initState = src.init_state || src.initState || (boundId ? 'initialized' : 'uninitialized')
    let onboardingDismissed = Boolean(boundId || src.onboarding_dismissed || src.onboardingDismissed)

    if (boundId && !validEngById.has(String(boundId))) {
      boundId = null
      boundName = null
      initState = 'uninitialized'
      onboardingDismissed = false
      if (store && sid && !isSyntheticSessionId(sid) && typeof store.setSessionOnboarding === 'function') {
        try {
          store.setSessionOnboarding(sid, { action: 'unbind' })
          invalidateSessionBindingsCache(store)
        } catch { /* ignore */ }
      }
    } else if (boundId) {
      const validEng = validEngById.get(String(boundId))
      boundName = (validEng && validEng.name) || boundName || String(boundId)
      initState = 'initialized'
      onboardingDismissed = true
    } else if (initState === 'initialized') {
      initState = 'uninitialized'
    }

    const hasConversation = liveSessionItem
      ? Boolean(liveSessionItem.hasConversation)
      : Boolean(src.has_conversation ?? src.hasConversation)
    const sessionTitle = (liveSessionItem && liveSessionItem.rawTitle)
      || src.session_title || src.sessionTitle || null
    const cwd = (liveSessionItem && liveSessionItem.cwd)
      || src.cwd || null

    return {
      session: sid || src.session || null,
      root_session: sid || src.root_session || src.session || null,
      bound: boundId,
      name: boundName,
      init_state: initState,
      onboarding_dismissed: onboardingDismissed,
      has_conversation: hasConversation,
      session_title: sessionTitle,
      cwd,
      updated_at: src.updated_at || null,
    }
  }

  if (request.op === 'bootstrap' && rawReqSession) {
    const rawState = (store && resolvedRootSid && typeof store.getSessionState === 'function')
      ? store.getSessionState(resolvedRootSid)
      : (result.session_binding || {})
    const normalizedBinding = normalizeBindingView(rawState, resolvedRootSid)
    result.session_binding = normalizedBinding
    result.current = normalizedBinding.bound
  }

  if (
    request.op === 'sessionBinding'
    || request.op === 'sessionBindings'
    || request.op === 'sessionOnboarding'
  ) {
    const rawState = (store && resolvedRootSid && typeof store.getSessionState === 'function')
      ? store.getSessionState(resolvedRootSid)
      : result
    const normalizedBinding = normalizeBindingView(rawState, resolvedRootSid)
    result.session = rawReqSession || normalizedBinding.session
    result.root_session = normalizedBinding.root_session
    result.bound = normalizedBinding.bound
    result.name = normalizedBinding.name
    result.init_state = normalizedBinding.init_state
    result.onboarding_dismissed = normalizedBinding.onboarding_dismissed
    result.has_conversation = normalizedBinding.has_conversation
    result.session_title = normalizedBinding.session_title
    result.cwd = normalizedBinding.cwd
    result.current = normalizedBinding.bound
    result.session_binding = normalizedBinding

    if (result.agents && typeof result.agents === 'object') {
      for (const [k, v] of Object.entries(result.agents)) {
        if (v && v.engagement && !validEngById.has(String(v.engagement))) {
          result.agents[k] = Object.assign({}, v, {
            engagement: null,
            name: null,
            init_state: 'uninitialized',
            onboarding_dismissed: false,
          })
        }
      }
    }
  }

  if (request.op === 'bootstrap') {
    result.hostVersion = HOST_BUILD_VERSION
  }

  return result
}

export function invokeStoreMethodCompat(store, methodName, engagementId, payload) {
  if (!store || typeof store[methodName] !== 'function') return undefined
  const fn = store[methodName]
  const fnSrc = Function.prototype.toString.call(fn)
  const headerSlice = fnSrc.slice(0, 160)
  const paramMatch = /\(([^)]*)\)/.exec(headerSlice)
  const rawFirstParam = paramMatch ? paramMatch[1].split(',')[0].trim() : ''
  const cleanFirstParam = rawFirstParam.split('=')[0].trim()

  if (payload === undefined) {
    return fn.call(store, engagementId)
  }

  const mergedPayload = (payload && typeof payload === 'object' && !Array.isArray(payload))
    ? Object.assign(
      { engagement: engagementId, engagement_id: engagementId, engagementId },
      payload,
    )
    : payload

  const firstArgIsEng = /^(?:id|eng|engagement|engagementId|engagement_id)$/i.test(cleanFirstParam)
    && !rawFirstParam.includes('{')
  if (firstArgIsEng) {
    return fn.call(store, engagementId, mergedPayload)
  }
  return fn.call(store, mergedPayload, engagementId)
}

function normalizeWishGoalItem(w, idx = 0) {
  const src = w && typeof w === 'object' ? w : {}
  const waveNum = Math.min(4, Math.max(1, parseWaveNumber(src.wave ?? src.wave_key, Math.min(4, Math.floor(idx / 2) + 1))))
  const role = inferAgentRole(
    src.title || src.worker_name || src.goal || src.objective || src.assigned_goal || '',
    false,
    src.role || src.worker_role || 'exploit',
  )
  const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.exploit
  const title = String(src.title || src.worker_name || src.workerName || meta.defaultTitle).trim()
  const goal = String(
    src.assigned_goal || src.assignedGoal || src.objective || src.goal || src.description || title,
  ).trim()
  const filesOwned = parseJsonArraySafe(src.files_owned ?? src.filesOwned ?? src.files_owned_json)
  const acceptanceCriteria = String(
    src.acceptance_criteria ?? src.acceptanceCriteria ?? src.verification ?? '',
  ).trim()
  const uiPriority = ['P0', 'P1', 'P2', 'P3'].includes(src.ui_priority || src.uiPriority)
    ? (src.ui_priority || src.uiPriority)
    : 'P1'
  return {
    id: src.id || `prop-w${waveNum}-${idx + 1}`,
    wave: waveNum,
    wave_key: `wave-${waveNum}`,
    role,
    worker_role: role,
    worker_name: String(src.worker_name || src.workerName || title).trim(),
    badge: meta.badge,
    ui_priority: uiPriority,
    uiPriority,
    title,
    goal,
    objective: goal,
    assigned_goal: goal,
    assignedGoal: goal,
    files_owned: filesOwned,
    filesOwned,
    acceptance_criteria: acceptanceCriteria,
    acceptanceCriteria,
  }
}

function extractWishTitle(rawPrompt, fallback = '多智能体 4-Wave 协同交付方案') {
  const promptText = String(rawPrompt || '').trim()
  if (!promptText) return fallback
  const cleanFirstLine = promptText.split(/[\n。！？!?]/)[0].trim()
  if (!cleanFirstLine) return fallback
  return cleanFirstLine.length > 42 ? `${cleanFirstLine.slice(0, 40)}…` : cleanFirstLine
}

function buildRefinedWishSpec(rawPrompt, template = '', rawPayload = {}) {
  const promptText = String(rawPrompt || '').trim() || '构建高可靠模块化工程系统并完成自动化验证'
  const tpl = String(template || rawPayload.template_id || 'fullstack').trim().toLowerCase()
  const specTitle = String(
    rawPayload.title || rawPayload.project_name || rawPayload.projectName || extractWishTitle(promptText),
  ).trim()

  const isSecurity = /渗透|漏洞|审计|安全|redteam|cve|scan|靶标/i.test(promptText) || tpl.includes('sec') || tpl.includes('audit')
  const isDataApi = /数据|爬虫|etl|api|后端|接口|数据库|postgres|pipeline/i.test(promptText) || tpl.includes('api') || tpl.includes('backend')

  const clarifications = Array.isArray(rawPayload.clarifications) && rawPayload.clarifications.length > 0
    ? rawPayload.clarifications
    : [
      isSecurity
        ? '边界确认：严格在授权工作区与目标范围内执行非破坏性验证与代码安全审计。'
        : '架构边界：采用零外部重依赖优先策略，前后端通过结构化 JSON / SSE 增量契约通信。',
      '分片隔离：每个并发 Worker 独占绑定 `files_owned` 文件集合，严禁跨分片覆写同一源码文件。',
      '验收标准：所有改动必须通过语法检查、单元测试与契约一致性冒烟门禁后方可归档。',
    ]

  const deliverables = Array.isArray(rawPayload.deliverables) && rawPayload.deliverables.length > 0
    ? rawPayload.deliverables
    : [
      'Wave 1 需求范围界定（PRD）与交互视觉规范清单',
      'Wave 2 模块接口契约与无交集文件独占分片表（Shard Lock Matrix）',
      isDataApi
        ? 'Wave 3 核心存储层、RPC 接口层与增量流式处理实现代码'
        : 'Wave 3 核心业务引擎、桥接 API 与响应式前端视图实现代码',
      'Wave 4 CSO 安全合规审查报告与 QA 自动化回归验证基线',
    ]

  const defaultWaves = [
    {
      wave: 1,
      wave_key: 'wave-1',
      role: 'recon',
      ui_priority: 'P1',
      title: 'Wave 1 · 需求拆解与现有代码库测绘',
      goal: `围绕「${specTitle}」盘点现有工程结构、数据源入口与核心业务验收指标`,
      files_owned: ['docs/01_PRD_SURFACE.md'],
    },
    {
      wave: 1,
      wave_key: 'wave-1',
      role: 'designer',
      ui_priority: 'P1',
      title: 'Wave 1 · 交互体验与四态视觉令牌设计',
      goal: `定义「${specTitle}」的组件布局层级、空态/加载/运行/异常四态交互与样式规范`,
      files_owned: ['docs/02_DESIGN_TOKENS.md'],
    },
    {
      wave: 2,
      wave_key: 'wave-2',
      role: 'assess',
      ui_priority: 'P1',
      title: 'Wave 2 · 接口契约冻结与文件分片加锁',
      goal: '锁定跨模块数据结构、API 协议签名与 Wave 3 无交集独占文件边界',
      files_owned: ['docs/03_SHARD_CONTRACT.md'],
    },
    {
      wave: 3,
      wave_key: 'wave-3',
      role: 'exploit',
      ui_priority: 'P1',
      title: 'Wave 3 · 核心后端存储与桥接逻辑研发（Shard A）',
      goal: `按冻结契约实现「${specTitle}」的数据持久化、状态流转与服务端 API 端点`,
      files_owned: ['src/server/core.js', 'src/server/api.js'],
    },
    {
      wave: 3,
      wave_key: 'wave-3',
      role: 'exploit',
      ui_priority: 'P1',
      title: 'Wave 3 · 前端交互视图与状态联动研发（Shard B）',
      goal: `实现「${specTitle}」的前端可视化交互组件、增量状态订阅与表单闭环`,
      files_owned: ['src/client/app.js', 'src/client/styles.css'],
    },
    {
      wave: 4,
      wave_key: 'wave-4',
      role: 'qa',
      ui_priority: 'P2',
      title: 'Wave 4 · 自动化回归测试与安全合规门禁',
      goal: '对全部改动分片执行语法检查、边界用例测试与同源安全合规核验',
      files_owned: ['test/regression.test.mjs'],
    },
  ]

  const inputWaves = Array.isArray(rawPayload.proposed_waves) && rawPayload.proposed_waves.length > 0
    ? rawPayload.proposed_waves
    : (Array.isArray(rawPayload.waves) && rawPayload.waves.length > 0
      ? rawPayload.waves
      : (Array.isArray(rawPayload.goals) && rawPayload.goals.length > 0
        ? rawPayload.goals
        : (Array.isArray(rawPayload.stages) && rawPayload.stages.length > 0
          ? rawPayload.stages
          : (Array.isArray(rawPayload.subgoals) && rawPayload.subgoals.length > 0 ? rawPayload.subgoals : null))))

  const proposedWaves = (inputWaves || defaultWaves).map((w, idx) => normalizeWishGoalItem(w, idx))
  const summaryText = `已将您的需求整理为 4 个波次（共 ${proposedWaves.length} 个无冲突并发子任务）：先完成需求测绘与契约加锁，再并行推进独占文件研发，最后经自动化测试门禁验收交付。`
  const refinedPrompt = String(
    rawPayload.refined_prompt
    || rawPayload.refinedPrompt
    || `【项目目标】${specTitle}\n【原始诉求】${promptText}\n【交付策略】${summaryText}`,
  ).trim()

  return {
    title: specTitle,
    project_name: specTitle,
    projectName: specTitle,
    template: tpl,
    raw_prompt: promptText,
    refined_prompt: refinedPrompt,
    refinedPrompt,
    summary: summaryText,
    clarifications,
    deliverables,
    proposed_waves: proposedWaves,
    goals: proposedWaves,
  }
}

function sanitizeDagTelemetryCacheHit(dagData, synthNodes) {
  if (!dagData || typeof dagData !== 'object' || !dagData.telemetry || typeof dagData.telemetry !== 'object') {
    return
  }
  const nodes = Array.isArray(synthNodes) ? synthNodes : []
  const sumCacheRead = nodes.reduce((acc, n) => acc + (Number(n && n.cacheReadTokens) || 0), 0)
  const sumInput = nodes.reduce((acc, n) => acc + (Number(n && n.inputTokens) || 0), 0)
  let realHitPct = 0
  if (sumCacheRead > 0 && sumInput > 0) {
    realHitPct = Math.min(100, Math.round((sumCacheRead / Math.max(sumInput, sumCacheRead)) * 1000) / 10)
  } else {
    const explicitNodeHits = nodes
      .map((n) => Number(n && n.cacheHitPct) || 0)
      .filter((v) => v > 0)
    if (explicitNodeHits.length > 0) {
      realHitPct = Math.round((explicitNodeHits.reduce((a, b) => a + b, 0) / explicitNodeHits.length) * 10) / 10
    }
  }
  dagData.telemetry.cached_tokens = sumCacheRead
  dagData.telemetry.cache_hit_pct = realHitPct
  if (Array.isArray(dagData.telemetry.rings)) {
    dagData.telemetry.rings = dagData.telemetry.rings.map((r) => {
      if (r && r.id === 'cache') {
        return Object.assign({}, r, {
          value: realHitPct,
          display: `${realHitPct}%`,
        })
      }
      return r
    })
  }
}

function detectShardLockConflicts(locksList) {
  const ownersByFile = new Map()
  for (const entry of Array.isArray(locksList) ? locksList : []) {
    if (!entry || typeof entry !== 'object') continue
    const isActive = entry.active !== undefined
      ? Boolean(entry.active)
      : (String(entry.status || 'active').toLowerCase() === 'active')
    if (!isActive) continue
    const fp = normalizeTouchedFilePath(entry.file_path || entry.filePath || '') || String(entry.file_path || entry.filePath || '').trim()
    if (!fp) continue
    if (!ownersByFile.has(fp)) ownersByFile.set(fp, [])
    ownersByFile.get(fp).push(entry)
  }
  const conflicts = []
  for (const [filePath, holders] of ownersByFile.entries()) {
    if (holders.length > 1) {
      conflicts.push({
        file_path: filePath,
        holders: holders.map((h) => ({
          worker_task_id: h.worker_task_id ?? null,
          worker_name: h.worker_name || '',
          wave: h.wave || '',
        })),
      })
    }
  }
  return conflicts
}

function computeShardLocksFallback(store, engagementId, wfDag = null, filterOpts = null) {
  if (!engagementId) {
    return {
      ok: true,
      unbound: true,
      engagement: null,
      engagement_id: null,
      locks: [],
      shard_locks: [],
      items: [],
      active: [],
      conflicts: [],
    }
  }
  const cleanFilter = {}
  let hasFilter = false
  if (filterOpts && typeof filterOpts === 'object') {
    if (filterOpts.activeOnly !== undefined || filterOpts.active_only !== undefined) {
      cleanFilter.activeOnly = Boolean(filterOpts.activeOnly ?? filterOpts.active_only)
      hasFilter = true
    }
    if (filterOpts.status !== undefined && filterOpts.status !== null && filterOpts.status !== '') {
      cleanFilter.status = String(filterOpts.status)
      hasFilter = true
    }
    if (filterOpts.wave !== undefined && filterOpts.wave !== null && filterOpts.wave !== '') {
      cleanFilter.wave = String(filterOpts.wave)
      hasFilter = true
    }
    const wtFilter = filterOpts.worker_task_id ?? filterOpts.workerTaskId
    if (wtFilter !== undefined && wtFilter !== null && wtFilter !== '') {
      cleanFilter.worker_task_id = wtFilter
      hasFilter = true
    }
  }

  const dag = wfDag || (store && typeof store.workflowDag === 'function' ? store.workflowDag(engagementId) : null)

  let dbLocks = []
  let storeMeta = null
  if (store && typeof store.listShardLocks === 'function') {
    let res = null
    try {
      res = hasFilter
        ? invokeStoreMethodCompat(store, 'listShardLocks', engagementId, cleanFilter)
        : invokeStoreMethodCompat(store, 'listShardLocks', engagementId)
    } catch {
      res = null
    }
    if (Array.isArray(res)) {
      dbLocks = res.slice()
    } else if (res && typeof res === 'object') {
      storeMeta = res
      dbLocks = Array.isArray(res.locks)
        ? res.locks.slice()
        : (Array.isArray(res.shard_locks) ? res.shard_locks.slice() : (Array.isArray(res.items) ? res.items.slice() : []))
    }
  }

  const tasks = (dag && Array.isArray(dag.worker_tasks)) ? dag.worker_tasks : []
  const seenKeys = new Set()
  const locks = []
  for (const existing of dbLocks) {
    if (!existing || typeof existing !== 'object') continue
    const rawFp = existing.file_path || existing.filePath || existing.file_pattern || ''
    const fp = normalizeTouchedFilePath(rawFp) || String(rawFp).trim()
    const isRowActive = existing.active !== undefined
      ? Boolean(existing.active)
      : (String(existing.status || 'active').toLowerCase() === 'active')
    if (fp) {
      seenKeys.add(`${existing.worker_task_id ?? ''}::${fp}`)
      if (existing.worker_name) seenKeys.add(`name:${existing.worker_name}::${fp}`)
    }
    locks.push(Object.assign({}, existing, {
      file_path: fp || rawFp,
      file_pattern: existing.file_pattern || fp || rawFp,
      active: isRowActive,
    }))
  }

  for (const t of tasks) {
    if (!t) continue
    if (cleanFilter.worker_task_id !== undefined && String(t.id) !== String(cleanFilter.worker_task_id)) continue
    if (cleanFilter.wave && String(t.wave || '') !== cleanFilter.wave) continue
    const st = String(t.status || '').toLowerCase()
    const active = st !== 'cancelled'
      && st !== 'archived'
      && st !== 'released'
      && st !== 'interrupted'
      && st !== 'completed'
      && st !== 'done'
      && st !== 'finished'
      && st !== 'approved'
    if (cleanFilter.activeOnly && !active) continue
    if (cleanFilter.status && st !== cleanFilter.status.toLowerCase()) continue
    const files = parseJsonArraySafe(t.files_owned ?? t.files_owned_json)
    for (const f of files) {
      const norm = normalizeTouchedFilePath(f) || String(f).trim()
      if (!norm) continue
      const kId = `${t.id ?? ''}::${norm}`
      const kName = t.worker_name ? `name:${t.worker_name}::${norm}` : ''
      if (seenKeys.has(kId) || (kName && seenKeys.has(kName))) continue
      seenKeys.add(kId)
      if (kName) seenKeys.add(kName)
      locks.push({
        file_path: norm,
        file_pattern: norm,
        worker_task_id: t.id,
        worker_name: t.worker_name || `wt-${t.id}`,
        worker_role: t.worker_role || 'exploit',
        wave: t.wave || 'wave-3',
        status: active ? 'active' : (t.status || 'released'),
        active,
      })
    }
  }

  const active = locks.filter((l) => l && (l.active === true || String(l.status || '').toLowerCase() === 'active'))
  const conflicts = (storeMeta && Array.isArray(storeMeta.conflicts) && storeMeta.conflicts.length > 0)
    ? storeMeta.conflicts
    : detectShardLockConflicts(locks)

  return Object.assign(
    {},
    storeMeta || {},
    {
      ok: true,
      engagement: engagementId,
      engagement_id: engagementId,
      locks,
      shard_locks: locks,
      items: locks,
      active,
      conflicts,
    },
  )
}

function isRealDshHost(ctx) {
  if (!ctx || typeof ctx !== 'object') return false
  return Boolean(
    (ctx.fiber && ctx.root)
    || ctx.registry
    || (tryGet(ctx, 'sessionQuery') && tryGet(ctx, 'sessionProjections')),
  )
}

export {
  readUnifiedSettings,
  writeUnifiedSettings,
  isUuidSessionTitle,
  IncrementalSessionJsonlReader,
  sessionJsonlReader,
  approvedWorkerOverrides,
  approvedWorkerMap,
  computeWorkerLmtexMeta,
  resolveRootFromMap,
  extractJsonFromLlmText,
  sampleWorkspaceContext,
  rollbackScopeViolations,
  sanitizeRepoRelativePath,
  detectDagCycles,
  computeReadyTasksForPipeline,
  evaluateWorkspaceBudgetGuard,
  computeWorkspacePerfMetrics,
  validateLoopbackWindowUrl,
  resolveAppBrowserBin,
  launchStandaloneWindow,
}

const dispatchDeps = {
  resolveRootSessionId,
  isSyntheticSessionId,
  getCachedSessionBindingEntry,
  parseJsonArraySafe,
  invokeStoreMethodCompat,
  dispatch,
  normalizeThinkingEffort,
  resolveRedteamSettingsRoot,
  readUnifiedSettings,
  defaultDispatchPolicy: DEFAULT_DISPATCH_POLICY,
  parseWaveNumber,
}

export async function resolveLiveRootAgent(ctx, sessionId) {
  return resolveLiveRootAgentCore(ctx, sessionId, dispatchDeps)
}

const plannerDepsFor = (ctx, store) => ({
  resolveRedteamSettingsRoot: (r) => resolveRedteamSettingsRoot(
    r || (store && store.root) || (resolveStore(ctx) && resolveStore(ctx).root),
  ),
  readUnifiedSettings,
  defaultAiPlannerSettings: DEFAULT_AI_PLANNER_SETTINGS,
  resolveLiveRootAgent,
  clampIntInRange,
  isRealDshHost,
  normalizeWishGoalItem,
  getCachedSessionBindingEntry,
})

export async function invokeDshLlmJson(ctx, opts = {}) {
  return invokeDshLlmJsonCore(ctx, opts, plannerDepsFor(ctx, resolveStore(ctx)))
}

async function clarifyWishWithAI(ctx, store, opts = {}) {
  return clarifyWishWithAICore(ctx, store, opts, plannerDepsFor(ctx, store))
}

async function decomposeWishWithAI(ctx, store, opts = {}) {
  return decomposeWishWithAICore(ctx, store, opts, plannerDepsFor(ctx, store))
}

function isRealChildSessionId(ctx, sid) {
  return isRealChildSessionIdCore(ctx, sid, dispatchDeps)
}

function resolveEngagementCwd(ctx, store, rootAgent, sessionId, explicitCwd = '') {
  return resolveEngagementCwdCore(ctx, store, rootAgent, sessionId, explicitCwd, dispatchDeps)
}

async function bindWorkerSessionCompat(store, engId, task, childId, status = 'running') {
  return bindWorkerSessionCompatCore(store, engId, task, childId, status, dispatchDeps)
}

async function startSubagentActivationSafe(ctx, subagentsSvc, rootAgent, task, opts = {}) {
  return startSubagentActivationSafeCore(ctx, subagentsSvc, rootAgent, task, opts, dispatchDeps)
}

export async function dispatchWorkflowToDshAgents(ctx, store, opts = {}) {
  return dispatchWorkflowToDshAgentsCore(ctx, store, opts, dispatchDeps)
}

export async function advanceNextWaveIfReady(ctx, store, opts = {}) {
  return advanceNextWaveIfReadyCore(ctx, store, opts, dispatchDeps)
}

function computeWorkspaceGuardsAndPerf(store, settingsRoot, currentEng, hostSessions, reqFlow, options = {}) {
  const settings = readUnifiedSettings(settingsRoot, process.env)
  const policy = (settings && settings.dispatchPolicy) || DEFAULT_DISPATCH_POLICY
  const dag = options.dag || (currentEng ? getWorkflowDagDedup(store, currentEng, reqFlow) : null) || {}
  const scopedSessions = currentEng
    ? (Array.isArray(hostSessions) ? hostSessions.filter((s) => s && s.engagementId === currentEng) : [])
    : []
  const usage = computeWorkspaceUsage(dag, scopedSessions, { usage: options.usage })
  const budgetGuard = evaluateWorkspaceBudgetGuard(usage, policy)
  const perfMetrics = computeWorkspacePerfMetrics(dag, scopedSessions, {
    schemaLegacyBytes: options.schemaLegacyBytes,
    schemaCurrentBytes: options.schemaCurrentBytes,
    maxAgents: settings.maxAgents,
  })
  return { settings, dag, usage, budgetGuard, perfMetrics }
}

async function handleAgentsOp(ctx, request) {
  const AGENT_OPS = [
    'agentsStatus', 'hostSessions', 'setAgentsMax', 'setClusterConfig', 'setPgUrl', 'probePg',
    'pgWriteProbe', 'getSettings', 'saveSettings',
    'workflowDag', 'workflowDocWall', 'workflowAction', 'workflowRun',
    'dagCheckpoint', 'feishuNotify', 'pushFeishuNotify', 'feishuConfig', 'feishuConfigSave',
    'saveFeishuConfig', 'saveFeishuWebhook', 'feishuTestPush',
    'agentSessionDetail', 'activateAgentSession',
    'clarifyWishWithAI', 'handoffToCaptain', 'dispatchWorkerTask',
    'planApproveWorker', 'submitWorkerDigest', 'decomposeUserPrompt',
    'refineAndDecomposeWish', 'updateWorkerGoal', 'addCustomWorkerTask', 'retryWorkerTask',
    'shardLocks', 'listShardLocks',
    'rollbackScopeViolations', 'perfBenchmark',
  ]
  if (!AGENT_OPS.includes(request.op)) return undefined

  const store = resolveStore(ctx)
  const reqFlow = createRequestFlow()
  const root = (() => { try { return store && store.root } catch { return undefined } })()
  const resolvedRootSession = request.session ? resolveRootSessionId(ctx, request.session) : ''
  const explicitReqEng = String(request.engagement || request.engagement_id || request.engagementId || '').trim()

  let sessionScopedDefined = false
  let sessionBoundEngagement = null
  if (!explicitReqEng && resolvedRootSession && store) {
    sessionScopedDefined = true
    const allEngs = getCachedEngagementsList(store)
    const validEngById = buildValidEngagementMap(allEngs)
    const bState = typeof store.getSessionState === 'function'
      ? store.getSessionState(resolvedRootSession)
      : getCachedSessionBindingEntry(store, resolvedRootSession)
    const candBound = bState && (bState.bound || bState.engagement)
      ? String(bState.bound || bState.engagement).trim()
      : ''
    if (candBound && validEngById.has(candBound)) {
      sessionBoundEngagement = candBound
    }
  }

  const resolveSessionAwareEngagement = (explicitOverride = '') => {
    const exp = String(explicitOverride || explicitReqEng || '').trim()
    if (exp) return exp
    if (sessionScopedDefined) return sessionBoundEngagement
    return (store ? getCachedActiveEngagementId(store) : null) || 'default'
  }

  const activeEngagement = explicitReqEng
    || (sessionScopedDefined ? sessionBoundEngagement : ((store ? getCachedActiveEngagementId(store) : null) || 'default'))

  const DELEGATED_WORKFLOW_ACTIONS = [
    'getSettings', 'saveSettings',
    'clarifyWishWithAI', 'handoffToCaptain', 'dispatchWorkerTask',
    'planApproveWorker', 'submitWorkerDigest', 'decomposeUserPrompt',
    'refineAndDecomposeWish', 'updateWorkerGoal', 'addCustomWorkerTask', 'retryWorkerTask',
    'shardLocks', 'listShardLocks', 'feishuConfig', 'feishuConfigSave', 'saveFeishuConfig', 'saveFeishuWebhook',
    'rollbackScopeViolations', 'perfBenchmark',
  ]
  const effectiveOp = (request.op === 'workflowAction' && DELEGATED_WORKFLOW_ACTIONS.includes(request.action))
    ? request.action
    : request.op

  const mergeAgentPayload = () => Object.assign(
    {},
    request.payload && typeof request.payload === 'object' ? request.payload : {},
    request,
  )
  const resolveActionEng = (raw = request) => (
    raw.engagement || raw.engagement_id || raw.engagementId
    || (store ? getCachedActiveEngagementId(store) : null)
    || activeEngagement
  )
  const withEngIds = (engId, extra = {}) => Object.assign({}, extra, {
    engagement: engId,
    engagement_id: engId,
    engagementId: engId,
  })
  const readPgProbe = (engId) => (
    store && typeof store.pgWriteProbe === 'function'
      ? store.pgWriteProbe(engId)
      : getPgWriteProbe(engId)
  )
  const synthNetworkFields = (synth, { includeEvents = true } = {}) => ({
    agentNetwork: synth.agentNetwork,
    agent_network: synth.agentNetwork,
    nodes: synth.nodes,
    swimlanes: synth.swimlanes,
    ...(includeEvents ? {
      collabEvents: synth.collabEvents,
      collab_events: synth.collabEvents,
    } : {}),
    collabTasks: synth.collabTasks,
    collab_tasks: synth.collabTasks,
  })
  const rebuildCollab = async (engId, { invalidateEngs = false, bumpOp = '', bumpMeta, hostEng } = {}) => {
    reqFlow.dagByEng.delete(engId)
    if (invalidateEngs) invalidateEngagementCaches(store)
    if (bumpOp) bumpEventSeq(bumpOp, bumpMeta || { engagement: engId })
    const hostSessions = await discoverHostSessions(ctx, store, {
      sessionId: request.session,
      ...(hostEng !== undefined ? { engagementId: hostEng } : {}),
      autoBind: true,
      reqFlow,
      onJsonlAdvance: bumpEventSeq,
    })
    const synth = synthesizeAgentCollaboration(store, engId, hostSessions, resolvedRootSession, reqFlow)
    return { hostSessions, synth }
  }
  const invokeOrDispatchCompat = async (method, engId, payload) => {
    let res = null
    try {
      res = await invokeStoreMethodCompat(store, method, engId, payload)
    } catch { res = null }
    if (res === undefined && store) {
      try { res = dispatch(store, payload) } catch { res = null }
    }
    return res
  }
  const runWorkerMutation = async (method, opName, engId, payload, { workflowAction } = {}) => {
    if (store && typeof store[method] === 'function') {
      try {
        return await invokeStoreMethodCompat(store, method, engId, payload)
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) }
      }
    }
    if (workflowAction && store && typeof store.workflowAction === 'function') {
      try {
        return await invokeStoreMethodCompat(store, 'workflowAction', engId, Object.assign({}, payload, { action: workflowAction }))
      } catch {
        return { ok: true }
      }
    }
    if (store) {
      return dispatch(store, Object.assign({ op: opName }, payload))
    }
    return null
  }
  const buildClusterConfigFields = (cfgArg, maxOverride) => {
    const max = maxOverride !== undefined ? maxOverride : maxAgentsOf(cfgArg, process.env)
    const thinkingEffort = thinkingEffortOf(cfgArg, process.env)
    const maxDepth = maxDepthOf(cfgArg, process.env)
    return {
      max,
      maxAgents: max,
      thinking: thinkingEffort,
      thinkingEffort,
      thinking_effort: thinkingEffort,
      maxDepth,
      max_depth: maxDepth,
    }
  }

  const settingsRoot = resolveRedteamSettingsRoot(root, process.env)

  const resolveDshDispatchHandles = async (rawPayload = {}) => {
    const settings = readUnifiedSettings(settingsRoot, process.env)
    const sessionRef = String(rawPayload.session || request.session || resolvedRootSession || '').trim()
    const rootAgent = sessionRef ? await resolveLiveRootAgent(ctx, sessionRef) : null
    const subagentsSvc = tryGet(ctx, 'subagents')
    const cwd = resolveEngagementCwd(ctx, store, rootAgent, sessionRef, rawPayload.cwd)
    return { settings, sessionRef, rootAgent, subagentsSvc, cwd }
  }

  const buildFullSettingsResponse = async (opName = 'getSettings') => {
    const unified = readUnifiedSettings(settingsRoot, process.env)
    const rawFile = readSettingsCached(settingsRoot)
    const rawDbEngine = store && typeof store.dbEngineInfo === 'function'
      ? store.dbEngineInfo()
      : resolvePgConfig(settingsRoot)
    const rawPgCandidate = (rawFile && rawFile.pgUrl) || ''
    const pgUrlMasked = maskPgUrlSafe(rawPgCandidate)
      || (rawDbEngine && (rawDbEngine.pgUrlMasked || rawDbEngine.maskedUrl))
      || maskPgUrlSafe((rawDbEngine && rawDbEngine.url) || '')
    const dbEngine = Object.assign(
      {},
      rawDbEngine && typeof rawDbEngine === 'object' ? rawDbEngine : {},
      { pgUrlMasked },
    )
    const currentEng = resolveSessionAwareEngagement()
    let feishuConfig = null
    if (currentEng && store) {
      const wfDag = getWorkflowDagDedup(store, currentEng, reqFlow)
      if (wfDag && typeof wfDag === 'object') {
        feishuConfig = wfDag.feishu_config ?? wfDag.feishu ?? null
      }
    }
    const modelCatalog = await fetchLlmModelCatalog(ctx)
    const sessionRef = String(request.session || resolvedRootSession || '').trim()
    const liveRootAgent = sessionRef ? await resolveLiveRootAgent(ctx, sessionRef) : null
    const route = resolveAgentModelRoute(ctx, liveRootAgent)
    const activeSessionRoute = {
      provider: route.provider || '',
      model: route.model || '',
      reasoningEffort: route.reasoningEffort || '',
      source: route.source || 'none',
    }
    return {
      ok: true,
      op: opName,
      engagement: currentEng || null,
      active_engagement: currentEng || null,
      max: unified.maxAgents,
      maxAgents: unified.maxAgents,
      max_agents: unified.maxAgents,
      thinking: unified.thinkingEffort,
      thinkingEffort: unified.thinkingEffort,
      thinking_effort: unified.thinkingEffort,
      maxDepth: unified.maxDepth,
      max_depth: unified.maxDepth,
      aiPlanner: unified.aiPlanner,
      ai_planner: unified.aiPlanner,
      dispatchPolicy: unified.dispatchPolicy,
      dispatch_policy: unified.dispatchPolicy,
      uiPreferences: unified.uiPreferences,
      ui_preferences: unified.uiPreferences,
      settings: unified,
      db_engine: dbEngine,
      pgUrlMasked,
      feishu_config: feishuConfig,
      model_catalog: modelCatalog,
      active_session_route: activeSessionRoute,
      limit: MAX_AGENTS_LIMIT,
      max_depth_limit: MAX_DEPTH_LIMIT,
      max_auto_retries_limit: MAX_AUTO_RETRIES_LIMIT,
      valid_thinking_efforts: VALID_THINKING_EFFORTS,
    }
  }

  if (effectiveOp === 'getSettings') {
    return await buildFullSettingsResponse('getSettings')
  }

  if (effectiveOp === 'saveSettings') {
    const mergedRaw = mergeAgentPayload()
    const src = Object.assign(
      {},
      mergedRaw,
      mergedRaw.config && typeof mergedRaw.config === 'object' ? mergedRaw.config : {},
      mergedRaw.patch && typeof mergedRaw.patch === 'object' ? mergedRaw.patch : {},
      mergedRaw.settings && typeof mergedRaw.settings === 'object' ? mergedRaw.settings : {},
    )

    const hasPgUrl = Object.prototype.hasOwnProperty.call(src, 'pgUrl')
      || Object.prototype.hasOwnProperty.call(src, 'pg_url')
    if (hasPgUrl) {
      const curRaw = readSettingsCached(settingsRoot)
      const curCfg = resolvePgConfig(settingsRoot)
      const curPg = String((curRaw && curRaw.pgUrl) || (curCfg && curCfg.url) || '').trim()
      const curMasked = maskPgUrlSafe(curPg)
      const curDotMasked = curPg ? curPg.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:••••••@') : ''
      const rawNextPg = src.pgUrl !== undefined ? src.pgUrl : src.pg_url
      const nextPgTrimmed = rawNextPg === null || rawNextPg === undefined ? '' : String(rawNextPg).trim()
      const isUnchangedMasked = Boolean(nextPgTrimmed)
        && ((curMasked && nextPgTrimmed === curMasked)
          || (curDotMasked && nextPgTrimmed === curDotMasked)
          || nextPgTrimmed.includes('••••••'))
      if (!isUnchangedMasked) {
        try {
          savePgUrl(settingsRoot, nextPgTrimmed)
          if (root && root !== settingsRoot) invalidateSettingsCache(root)
          try { if (store && typeof store.close === 'function') store.close() } catch { /* ignore */ }
        } catch (err) {
          return {
            ok: false,
            op: 'saveSettings',
            error: err && err.message ? err.message : String(err),
          }
        }
      }
    }

    const patch = {}
    if (src.maxAgents !== undefined || src.max !== undefined || src.max_agents !== undefined) {
      patch.maxAgents = clampMaxAgents(src.maxAgents ?? src.max ?? src.max_agents)
    }
    const rawThinking = src.thinkingEffort ?? src.thinking_effort ?? src.thinking ?? src.effort
    if (rawThinking !== undefined) {
      patch.thinkingEffort = normalizeThinkingEffort(rawThinking)
    }
    if (src.maxDepth !== undefined || src.max_depth !== undefined || src.depth !== undefined) {
      patch.maxDepth = clampMaxDepth(src.maxDepth ?? src.max_depth ?? src.depth)
    }
    if ((src.aiPlanner && typeof src.aiPlanner === 'object') || (src.ai_planner && typeof src.ai_planner === 'object')) {
      patch.aiPlanner = src.aiPlanner || src.ai_planner
    }

    const dispatchPatchIn = Object.assign(
      {},
      (src.dispatchPolicy && typeof src.dispatchPolicy === 'object')
        ? src.dispatchPolicy
        : ((src.dispatch_policy && typeof src.dispatch_policy === 'object') ? src.dispatch_policy : {}),
    )
    for (const [camel, snake] of [
      ['speculativeWaveDispatch', 'speculative_wave_dispatch'],
      ['maxTokensPerWorkspace', 'max_tokens_per_workspace'],
      ['maxCostPerWorkspace', 'max_cost_per_workspace'],
      ['maxAutoRetries', 'max_auto_retries'],
      ['autoAdvanceWave', 'auto_advance_wave'],
      ['autoWakeOnApprove', 'auto_wake_on_approve'],
    ]) {
      if (src[camel] !== undefined && dispatchPatchIn[camel] === undefined) dispatchPatchIn[camel] = src[camel]
      if (src[snake] !== undefined && dispatchPatchIn[snake] === undefined && dispatchPatchIn[camel] === undefined) {
        dispatchPatchIn[camel] = src[snake]
      }
    }
    if (Object.keys(dispatchPatchIn).length > 0) {
      patch.dispatchPolicy = dispatchPatchIn
    }

    const uiPatchIn = Object.assign(
      {},
      (src.uiPreferences && typeof src.uiPreferences === 'object')
        ? src.uiPreferences
        : ((src.ui_preferences && typeof src.ui_preferences === 'object') ? src.ui_preferences : {}),
    )
    if (src.locale !== undefined && uiPatchIn.locale === undefined) {
      uiPatchIn.locale = src.locale
    }
    if (Object.keys(uiPatchIn).length > 0) {
      patch.uiPreferences = uiPatchIn
    }

    writeUnifiedSettings(settingsRoot, patch, process.env)
    invalidateSettingsCache(settingsRoot)
    if (root && root !== settingsRoot) invalidateSettingsCache(root)

    const feishuIn = (src.feishu_config && typeof src.feishu_config === 'object')
      ? src.feishu_config
      : ((src.feishuConfig && typeof src.feishuConfig === 'object')
        ? src.feishuConfig
        : (src.feishu && typeof src.feishu === 'object' ? src.feishu : null))
    const targetEng = resolveSessionAwareEngagement(src.engagement || src.engagement_id || src.engagementId)
    if (feishuIn && targetEng && store) {
      const feishuWebhook = String(
        feishuIn.webhook_url ?? feishuIn.webhookUrl ?? feishuIn.webhook ?? feishuIn.url ?? '',
      ).trim()
      const feishuPayload = Object.assign({}, feishuIn, {
        engagement: targetEng,
        engagement_id: targetEng,
        webhook_url: feishuWebhook,
        webhookUrl: feishuWebhook,
      })
      if (typeof store.saveFeishuConfig === 'function') {
        try { await invokeStoreMethodCompat(store, 'saveFeishuConfig', targetEng, feishuPayload) } catch { /* ignore */ }
      } else if (typeof store.workflowAction === 'function') {
        try { await invokeStoreMethodCompat(store, 'workflowAction', targetEng, Object.assign({}, feishuPayload, { action: 'feishuConfig' })) } catch { /* ignore */ }
      }
      reqFlow.dagByEng.delete(targetEng)
    }

    bumpEventSeq('saveSettings')
    const snapshot = await buildFullSettingsResponse('saveSettings')
    return Object.assign(snapshot, {
      saved: true,
      note: '统一工作台与集群设置已保存并立即生效。',
    })
  }

  if (effectiveOp === 'rollbackScopeViolations') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const sessionTarget = String(rawPayload.session || request.session || resolvedRootSession || '').trim()
    const rootAgent = sessionTarget ? await resolveLiveRootAgent(ctx, sessionTarget) : null
    const resolvedCwd = resolveEngagementCwd(ctx, store, rootAgent, sessionTarget, rawPayload.cwd)
    const workerTaskId = rawPayload.worker_task_id ?? rawPayload.workerTaskId ?? rawPayload.worker_id ?? rawPayload.workerId ?? rawPayload.id ?? null

    let filesList = parseJsonArraySafe(
      rawPayload.files ?? rawPayload.scope_violations ?? rawPayload.violations ?? rawPayload.paths ?? [],
    )
    if (filesList.length === 0 && workerTaskId && store && currentEng) {
      const dag = getWorkflowDagDedup(store, currentEng, reqFlow)
      const digests = dag && Array.isArray(dag.worker_digests) ? dag.worker_digests : []
      const matchDigest = digests.find((d) => d && String(d.worker_task_id) === String(workerTaskId))
      if (matchDigest) {
        filesList = parseJsonArraySafe(matchDigest.scope_violations ?? matchDigest.scope_violations_json)
      }
    }

    const allowDeleteUntracked = Boolean(rawPayload.allowDeleteUntracked ?? rawPayload.allow_delete_untracked ?? false)
    if (!resolvedCwd) {
      return {
        ok: false,
        op: 'rollbackScopeViolations',
        engagement: currentEng,
        error: '缺少有效的 Git 工作区路径（cwd），无法执行越界回滚。',
      }
    }

    const rb = rollbackScopeViolations({
      cwd: resolvedCwd,
      files: filesList,
      allowDeleteUntracked,
    })

    let recordResult = null
    if (rb.ok && store && typeof store.recordScopeRollback === 'function' && currentEng) {
      try {
        recordResult = store.recordScopeRollback(currentEng, workerTaskId, rb)
      } catch { recordResult = null }
    }
    reqFlow.dagByEng.delete(currentEng)
    bumpEventSeq('scope_rollback', {
      engagement: currentEng,
      workerTaskId,
      rolledBackCount: Array.isArray(rb.rolled_back) ? rb.rolled_back.length : 0,
    })

    return Object.assign(
      {
        op: 'rollbackScopeViolations',
        engagement: currentEng,
        active_engagement: currentEng,
        record_result: recordResult,
      },
      rb,
    )
  }

  if (effectiveOp === 'perfBenchmark') {
    const explicitEng = request.engagement || request.engagement_id || request.engagementId || ''
    const hostSessions = await discoverHostSessions(ctx, store, {
      sessionId: request.session,
      engagementId: explicitEng || undefined,
      autoBind: true,
      reqFlow,
      onJsonlAdvance: bumpEventSeq,
    })
    const currentEng = resolveSessionAwareEngagement(explicitEng)
    const { usage, budgetGuard, perfMetrics } = computeWorkspaceGuardsAndPerf(
      store,
      settingsRoot,
      currentEng,
      hostSessions,
      reqFlow,
      {
        schemaLegacyBytes: request.schemaLegacyBytes,
        schemaCurrentBytes: request.schemaCurrentBytes,
        usage: request.usage,
      },
    )
    return {
      ok: true,
      op: 'perfBenchmark',
      engagement: currentEng || null,
      active_engagement: currentEng || null,
      perfMetrics,
      perf_metrics: perfMetrics,
      metrics: perfMetrics,
      budgetGuard,
      budget_guard: budgetGuard,
      usage,
    }
  }

  if (effectiveOp === 'clarifyWishWithAI') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveSessionAwareEngagement(rawPayload.engagement || rawPayload.engagement_id || rawPayload.engagementId)
    const promptText = String(
      rawPayload.prompt || rawPayload.user_prompt || rawPayload.userPrompt || rawPayload.wish || rawPayload.goal || rawPayload.text || '',
    ).trim()
    if (!promptText) {
      return {
        ok: false,
        op: 'clarifyWishWithAI',
        engagement: currentEng || null,
        error: '请输入您的工程目标或需求描述，再发起 AI 智能澄清。',
      }
    }
    const clarifyRes = await clarifyWishWithAI(ctx, store, {
      prompt: promptText,
      sessionId: String(rawPayload.session || request.session || resolvedRootSession || '').trim(),
      cwd: String(rawPayload.cwd || '').trim(),
      allowStaticFallback: Boolean(rawPayload.allow_static_fallback ?? rawPayload.allowStaticFallback),
    })
    return Object.assign({ engagement: currentEng || null }, clarifyRes)
  }

  if (effectiveOp === 'handoffToCaptain') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveSessionAwareEngagement(rawPayload.engagement || rawPayload.engagement_id || rawPayload.engagementId)
    const sessionTarget = String(rawPayload.session || request.session || resolvedRootSession || '').trim()
    const promptText = String(
      rawPayload.prompt || rawPayload.user_prompt || rawPayload.userPrompt || rawPayload.wish || rawPayload.goal || rawPayload.text || '',
    ).trim()
    if (!promptText) {
      return {
        ok: false,
        op: 'handoffToCaptain',
        engagement: currentEng || null,
        error: '交由主代理讨论的需求内容不能为空。',
      }
    }
    const rootAgent = await resolveLiveRootAgent(ctx, sessionTarget)
    if (!rootAgent || typeof rootAgent.followup !== 'function') {
      return {
        ok: false,
        op: 'handoffToCaptain',
        engagement: currentEng || null,
        error: '未找到可唤醒的活跃 DSH 主代理会话（rootAgent），请确认当前聊天标签页已连接活跃会话。',
      }
    }
    const rawClar = rawPayload.clarifications_text ?? rawPayload.clarificationsText
    const clarLines = Array.isArray(rawPayload.clarifications)
      ? rawPayload.clarifications.map((x) => String(x || '').trim()).filter(Boolean).join('\n')
      : ''
    const clarText = [typeof rawClar === 'string' ? rawClar.trim() : '', clarLines].filter(Boolean).join('\n')
    const handoffText = [
      '【LMTAgent 工作台 · 交由主代理 Captain 讨论与拆解】',
      currentEng ? `- 项目工作区（engagement_id）：\`${currentEng}\`` : '',
      '',
      '以下为用户原始工程需求，请主控 Captain 直接在对话中与用户讨论确认边界，并按需完成 4-Wave 任务拆解与派发：',
      promptText,
      clarText ? `\n补充澄清信息：\n${clarText}` : '',
    ].filter(Boolean).join('\n')
    const fRes = sendRootFollowupMessage(rootAgent, handoffText)
    if (!fRes.ok) {
      return {
        ok: false,
        op: 'handoffToCaptain',
        engagement: currentEng || null,
        error: fRes.error || '发送 followup 消息唤醒主代理失败。',
      }
    }
    bumpEventSeq('handoffToCaptain', { engagement: currentEng || null, sessionId: rootAgent.id })
    return {
      ok: true,
      op: 'handoffToCaptain',
      engagement: currentEng || null,
      sessionId: rootAgent.id,
      messageId: fRes.messageId,
      dispatched: {
        mode: 'captain_handoff',
        spawned: [],
        captainNotified: true,
        rootAgentId: rootAgent.id,
      },
      note: '已将需求发送至 DSH 主代理（Captain）会话并唤醒讨论。',
    }
  }

  const resolveWorkerTaskFromDag = (engId, payloadObj) => {
    if (!store || !payloadObj || typeof payloadObj !== 'object') return null
    const rawRefs = [
      payloadObj.worker_task_id,
      payloadObj.workerTaskId,
      payloadObj.worker_id,
      payloadObj.workerId,
      payloadObj.session_id,
      payloadObj.sessionId,
      payloadObj.agentId,
      payloadObj.id,
      payloadObj.worker_name,
      payloadObj.workerName,
    ]
      .map((v) => (v !== undefined && v !== null ? String(v).trim() : ''))
      .filter(Boolean)
    if (rawRefs.length === 0) return null
    const dag = getWorkflowDagDedup(store, engId, reqFlow)
    const tasks = dag && Array.isArray(dag.worker_tasks) ? dag.worker_tasks : []
    for (const ref of rawRefs) {
      const strippedWt = ref.startsWith('wt-') ? ref.slice(3) : ''
      const hit = tasks.find((t) => {
        if (!t) return false
        const tid = String(t.id ?? '')
        const sid = String(t.session_id ?? '')
        const wname = String(t.worker_name ?? '').trim()
        return tid === ref
          || (strippedWt && tid === strippedWt)
          || `wt-${tid}` === ref
          || (sid && sid === ref)
          || (wname && wname === ref)
      })
      if (hit && hit.id !== undefined && hit.id !== null) return hit
    }
    return null
  }

  if (effectiveOp === 'planApproveWorker') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const candidateIds = [
      rawPayload.worker_id,
      rawPayload.workerId,
      rawPayload.worker_task_id,
      rawPayload.workerTaskId,
      rawPayload.session_id,
      rawPayload.sessionId,
      rawPayload.agentId,
      rawPayload.id,
      rawPayload.worker_name,
      rawPayload.workerName,
    ]
      .map((v) => (v !== undefined && v !== null ? String(v).trim() : ''))
      .filter((v) => v && !isBareRoleName(v))

    let workerKey = candidateIds[0] || ''
    if (!workerKey) {
      return {
        ok: false,
        engagement: currentEng,
        error: 'missing or bare-role worker_id for planApproveWorker',
      }
    }
    const approvalState = String(
      rawPayload.approval_state
      || rawPayload.approvalState
      || (rawPayload.decision === 'revision_required' || rawPayload.decision === 'reject' ? 'revision_required' : 'approved')
    ).trim()
    const uiPriority = approvalState === 'approved' ? 'P2' : 'P0'
    const priorityWeight = uiPriority === 'P2' ? 50 : 100
    const priorityLabel = uiPriority === 'P2' ? 'P2 已审归档' : 'P0 焦点审批'
    const nextGoal = String(
      rawPayload.next_goal
      || rawPayload.nextGoal
      || '进入下一波次契约联调与回归验证'
    ).trim()

    const storePayload = Object.assign({}, rawPayload, withEngIds(currentEng, {
      op: 'planApproveWorker',
      ...(workerKey ? {
        worker_id: workerKey,
        workerId: workerKey,
        session_id: rawPayload.session_id || rawPayload.sessionId || workerKey,
        worker_name: rawPayload.worker_name || rawPayload.workerName || workerKey,
      } : {}),
      approval_state: approvalState,
      approvalState,
      ui_priority: uiPriority,
      uiPriority,
      next_goal: nextGoal,
      nextGoal,
    }))

    const storeResult = await invokeOrDispatchCompat('approveWorkerAndDispatchNext', currentEng, storePayload)

    const approvedDbWorker = storeResult && typeof storeResult === 'object' ? storeResult.approved_worker : null
    if (!workerKey && approvedDbWorker) {
      workerKey = String(
        approvedDbWorker.session_id || approvedDbWorker.id || approvedDbWorker.worker_name || '',
      ).trim()
    }
    if (!workerKey) {
      return { ok: false, error: 'missing worker_id or session_id for planApproveWorker' }
    }

    const overrideEntry = {
      engagementId: currentEng,
      workerId: workerKey,
      approvalState,
      uiPriority,
      priorityWeight,
      priorityLabel,
      nextGoal,
      explicitApproved: approvalState === 'approved',
      approvedAt: new Date().toISOString(),
    }

    const scopedKeys = [
      workerKey,
      ...candidateIds,
      approvedDbWorker && approvedDbWorker.id !== undefined ? String(approvedDbWorker.id) : '',
      approvedDbWorker && approvedDbWorker.id !== undefined ? `wt-${approvedDbWorker.id}` : '',
      approvedDbWorker && approvedDbWorker.session_id ? String(approvedDbWorker.session_id) : '',
      approvedDbWorker && approvedDbWorker.worker_name ? String(approvedDbWorker.worker_name) : '',
    ]
    for (const k of scopedKeys) {
      setScopedWorkerOverride(currentEng, k, overrideEntry)
    }

    const { settings, rootAgent, subagentsSvc } = await resolveDshDispatchHandles(rawPayload)
    const dispatchWarnings = []
    let wokeChildId = null
    let captainNotified = false
    const matchedDagTask = approvedDbWorker || resolveWorkerTaskFromDag(currentEng, rawPayload)
    const candidateChildId = String(
      (matchedDagTask && matchedDagTask.session_id)
      || rawPayload.childId
      || rawPayload.session_id
      || rawPayload.sessionId
      || '',
    ).trim()
    const hasRealChild = isRealChildSessionId(ctx, candidateChildId)

    if (settings.dispatchPolicy.autoWakeOnApprove) {
      if (hasRealChild && rootAgent && subagentsSvc) {
        const workerLabel = (matchedDagTask && (matchedDagTask.title || matchedDagTask.worker_name)) || workerKey
        const feedback = String(rawPayload.feedback || rawPayload.reason || rawPayload.note || '').trim()
        const approvalFollowupPrompt = approvalState === 'approved'
          ? [
            `【LMTAgent 审批通过通知】你的子任务 \`${workerLabel}\`（engagement=${currentEng}）已由主控/工作台审批通过（approved）。`,
            nextGoal ? `下一步指示：${nextGoal}` : '',
            '如仍有收尾补充或跨波次交接检查请快速完成并汇报；否则可确认收工交付。',
          ].filter(Boolean).join('\n')
          : [
            `【LMTAgent 审批退回修订通知】你的子任务 \`${workerLabel}\`（engagement=${currentEng}）被标记为需修订（${approvalState}）。`,
            feedback ? `修订意见：${feedback}` : '',
            nextGoal ? `最新目标/修正指令：${nextGoal}` : '',
            '请立即根据修订意见调整实现，完成后重新提交 `lmt_workflow` submit_digest 并回报结果。',
          ].filter(Boolean).join('\n')
        try {
          await deliverPromptToChild(subagentsSvc, 'queue', rootAgent, candidateChildId, approvalFollowupPrompt)
          wokeChildId = candidateChildId
        } catch (err) {
          dispatchWarnings.push(`唤醒子代理 ${candidateChildId} 失败：${err && err.message ? err.message : String(err)}`)
        }
      } else if (hasRealChild && (!rootAgent || !subagentsSvc)) {
        dispatchWarnings.push(!rootAgent ? '未解析到活跃 rootAgent，仅完成事实库审批未唤醒智能体' : '宿主 subagents 服务不可用，仅完成事实库审批未唤醒智能体')
      }

      if (rootAgent && typeof rootAgent.followup === 'function') {
        const nextDispatched = storeResult && Array.isArray(storeResult.dispatched_next) ? storeResult.dispatched_next : []
        const captainApprovalNote = [
          `【LMTAgent 审批同步】任务 \`${workerKey}\`（engagement=${currentEng}）审批结果：${approvalState}（${priorityLabel}）。`,
          nextGoal ? `- 下一步指示：${nextGoal}` : '',
          wokeChildId ? `- 已同步唤醒子代理 childId: \`${wokeChildId}\`` : '',
          nextDispatched.length > 0
            ? `- 已解锁下游任务：${nextDispatched.map((d) => `${d.worker_name || d.title || d.id}(${d.wave || ''})`).join('、')}，请按 4-Wave 策略接续调度。`
            : '',
        ].filter(Boolean).join('\n')
        try {
          const fRes = sendRootFollowupMessage(rootAgent, captainApprovalNote)
          captainNotified = Boolean(fRes.ok)
          if (!fRes.ok && fRes.error) dispatchWarnings.push(fRes.error)
        } catch (err) {
          dispatchWarnings.push(`通知主代理 Captain 失败：${err && err.message ? err.message : String(err)}`)
        }
      }
    }

    const autoAdvanced = await advanceNextWaveIfReady(ctx, store, {
      engagementId: currentEng,
      approvedTask: matchedDagTask,
      approvalState,
      sessionId: rawPayload.session || request.session || resolvedRootSession,
      cwd: rawPayload.cwd,
      settingsRoot,
      settings,
      rootAgent,
      subagentsSvc,
      usage: rawPayload.usage,
      allowOverrideBudget: Boolean(rawPayload.allowOverrideBudget ?? rawPayload.allow_override_budget),
      retryDelayMs: rawPayload.retryDelayMs,
    })

    const dispatchedInfo = {
      mode: settings.dispatchPolicy.autoWakeOnApprove ? 'auto_wake' : 'manual',
      spawned: autoAdvanced && Array.isArray(autoAdvanced.spawned) ? autoAdvanced.spawned : [],
      wokeChildId,
      captainNotified,
      ...(dispatchWarnings.length > 0 ? { warning: dispatchWarnings.join('；') } : {}),
    }

    const { hostSessions, synth } = await rebuildCollab(currentEng, {
      bumpOp: 'planApproveWorker',
      bumpMeta: { engagement: currentEng, workerId: workerKey },
    })
    const pgProbe = readPgProbe(currentEng)

    return Object.assign(
      {},
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: true,
        op: 'planApproveWorker',
        engagement: currentEng,
        active_engagement: currentEng,
        worker_id: workerKey,
        workerId: workerKey,
        approvalState,
        approval_state: approvalState,
        uiPriority,
        ui_priority: uiPriority,
        priorityWeight,
        priority_weight: priorityWeight,
        priorityLabel,
        priority_label: priorityLabel,
        nextGoal,
        next_goal: nextGoal,
        dispatched: dispatchedInfo,
        autoAdvanced,
        host_sessions: hostSessions,
        hostSessions,
        pg_probe: pgProbe,
        pgWriteProbe: pgProbe,
      },
      synthNetworkFields(synth),
    )
  }

  if (effectiveOp === 'submitWorkerDigest') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const meta = computeWorkerLmtexMeta(rawPayload, Number(rawPayload.idx) || 0, { store, engagementId: currentEng })
    const storePayload = Object.assign({}, rawPayload, withEngIds(currentEng, {
      op: 'submitWorkerDigest',
      ui_priority: meta.uiPriority,
      uiPriority: meta.uiPriority,
      priority_weight: meta.priorityWeight,
      priorityWeight: meta.priorityWeight,
      worker_tags: meta.workerTags,
      workerTags: meta.workerTags,
      compressed_digest: meta.compressedDigest,
      compressedDigest: meta.compressedDigest,
      approval_state: meta.approvalState,
      approvalState: meta.approvalState,
      next_goal: meta.nextGoal,
      nextGoal: meta.nextGoal,
    }))

    const storeResult = await invokeOrDispatchCompat('submitWorkerDigest', currentEng, storePayload)

    const { hostSessions, synth } = await rebuildCollab(currentEng, { bumpOp: 'submitWorkerDigest' })
    const pgProbe = readPgProbe(currentEng)

    return Object.assign(
      {},
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: true,
        op: 'submitWorkerDigest',
        engagement: currentEng,
        active_engagement: currentEng,
        uiPriority: meta.uiPriority,
        ui_priority: meta.uiPriority,
        priorityWeight: meta.priorityWeight,
        priority_weight: meta.priorityWeight,
        workerTags: meta.workerTags,
        worker_tags: meta.workerTags,
        compressedDigest: meta.compressedDigest,
        compressed_digest: meta.compressedDigest,
        approvalState: meta.approvalState,
        approval_state: meta.approvalState,
        nextGoal: meta.nextGoal,
        next_goal: meta.nextGoal,
        host_sessions: hostSessions,
        hostSessions,
        pg_probe: pgProbe,
        pgWriteProbe: pgProbe,
      },
      synthNetworkFields(synth),
    )
  }

  if (effectiveOp === 'dispatchWorkerTask') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const matchedTask = resolveWorkerTaskFromDag(currentEng, rawPayload)
    if (!matchedTask) {
      return {
        ok: false,
        op: 'dispatchWorkerTask',
        engagement: currentEng,
        error: '未找到匹配的 worker_task 任务节点，无法拉起执行。',
      }
    }
    const { settings, rootAgent, subagentsSvc, cwd } = await resolveDshDispatchHandles(rawPayload)
    if (!rootAgent || !subagentsSvc || typeof subagentsSvc.startActivation !== 'function') {
      const warnMsg = !rootAgent
        ? '未解析到活跃的 DSH 主代理会话（rootAgent），无法拉起子代理。'
        : '宿主 subagents 服务不可用（缺少 startActivation），无法拉起子代理。'
      return {
        ok: false,
        op: 'dispatchWorkerTask',
        engagement: currentEng,
        worker_task_id: matchedTask.id,
        error: warnMsg,
        dispatched: {
          mode: settings.dispatchPolicy.dispatchMode,
          provider: settings.dispatchPolicy.subagentProvider,
          spawned: [],
          captainNotified: false,
          warning: warnMsg,
        },
      }
    }

    const dag = getWorkflowDagDedup(store, currentEng, reqFlow)
    const refinedPrompt = String(
      rawPayload.refined_prompt
      || rawPayload.refinedPrompt
      || (dag && dag.engagement && dag.engagement.goal)
      || '',
    ).trim()
    const extraNote = String(rawPayload.note || rawPayload.extra_note || rawPayload.extraNote || '').trim()

    let started = null
    try {
      started = await startSubagentActivationSafe(ctx, subagentsSvc, rootAgent, matchedTask, {
        provider: settings.dispatchPolicy.subagentProvider || 'spawn',
        cwd,
        engId: currentEng,
        refinedPrompt,
        maxDepth: settings.maxDepth,
        thinkingEffort: settings.thinkingEffort,
        maxAutoRetries: settings.dispatchPolicy.maxAutoRetries ?? 1,
        retryDelayMs: rawPayload.retryDelayMs,
        extraNote,
      })
    } catch (err) {
      const msg = err && err.message ? err.message : String(err)
      return {
        ok: false,
        op: 'dispatchWorkerTask',
        engagement: currentEng,
        worker_task_id: matchedTask.id,
        error: `拉起子代理失败：${msg}`,
        dispatched: {
          mode: settings.dispatchPolicy.dispatchMode,
          provider: settings.dispatchPolicy.subagentProvider,
          spawned: [],
          captainNotified: false,
          warning: msg,
        },
      }
    }

    if (!started || !started.childId) {
      return {
        ok: false,
        op: 'dispatchWorkerTask',
        engagement: currentEng,
        worker_task_id: matchedTask.id,
        error: 'subagents.startActivation 未返回有效的 childId。',
      }
    }

    await bindWorkerSessionCompat(store, currentEng, matchedTask, started.childId, 'running')
    let captainNotified = false
    if (typeof rootAgent.followup === 'function') {
      const syncMsg = [
        '【LMTAgent 工作台 · 手动拉起节点同步】',
        `- 项目工作区（engagement_id）：\`${currentEng}\``,
        `- 节点 [${matchedTask.wave || 'wave-?'} · ${matchedTask.worker_role || matchedTask.role}] \`${matchedTask.title || matchedTask.worker_name}\` (task_id=${matchedTask.id}) 已由工作台真实拉起，childId: \`${started.childId}\`。`,
        '请主控 Captain 记录该真实 childId 并避免重复派发，待其通过 `delivery: "parent"` 回传后接续审批与调度。',
      ].join('\n')
      try {
        const fRes = sendRootFollowupMessage(rootAgent, syncMsg)
        captainNotified = Boolean(fRes.ok)
      } catch { /* ignore */ }
    }

    const { hostSessions, synth } = await rebuildCollab(currentEng, {
      invalidateEngs: true,
      bumpOp: 'dispatchWorkerTask',
      bumpMeta: { engagement: currentEng, workerTaskId: matchedTask.id, childId: started.childId },
      hostEng: currentEng,
    })

    return Object.assign(
      {
        ok: true,
        op: 'dispatchWorkerTask',
        engagement: currentEng,
        active_engagement: currentEng,
        worker_task_id: matchedTask.id,
        worker_id: started.childId,
        session_id: started.childId,
        childId: started.childId,
        dispatched: {
          mode: settings.dispatchPolicy.dispatchMode,
          provider: settings.dispatchPolicy.subagentProvider || 'spawn',
          spawned: [{
            worker_task_id: matchedTask.id,
            worker_name: matchedTask.worker_name || matchedTask.title,
            role: matchedTask.worker_role || matchedTask.role,
            title: matchedTask.title || matchedTask.worker_name,
            childId: started.childId,
          }],
          captainNotified,
          rootAgentId: rootAgent.id,
        },
        host_sessions: hostSessions,
        hostSessions,
        note: `已真实拉起执行节点 ${matchedTask.title || matchedTask.worker_name}（childId: ${started.childId}）。`,
      },
      synthNetworkFields(synth),
    )
  }

  if (effectiveOp === 'refineAndDecomposeWish' || effectiveOp === 'decomposeUserPrompt') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const promptText = String(
      rawPayload.prompt || rawPayload.user_prompt || rawPayload.userPrompt || rawPayload.wish || rawPayload.goal || rawPayload.text
      || '执行多波次并发架构交付与验证',
    ).trim()
    const templateName = String(rawPayload.template || rawPayload.template_id || '').trim()
    const previewOnly = Boolean(rawPayload.preview_only ?? rawPayload.previewOnly)
    const allowStaticFallback = Boolean(rawPayload.allow_static_fallback ?? rawPayload.allowStaticFallback)
      && !isRealDshHost(ctx)
    const sessionRef = String(rawPayload.session || request.session || resolvedRootSession || '').trim()
    const cwdOverride = String(rawPayload.cwd || '').trim()

    const rawAnswers = rawPayload.answers && typeof rawPayload.answers === 'object' ? rawPayload.answers : null
    const answersLines = rawAnswers
      ? Object.entries(rawAnswers)
        .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join('；') : String(v || '')}`)
        .filter((s) => !s.endsWith(': '))
      : []
    const clarificationsText = [
      typeof (rawPayload.clarifications_text ?? rawPayload.clarificationsText) === 'string'
        ? String(rawPayload.clarifications_text ?? rawPayload.clarificationsText).trim()
        : '',
      ...(Array.isArray(rawPayload.clarifications) ? rawPayload.clarifications.map((x) => String(x || '').trim()).filter(Boolean) : []),
      ...answersLines,
    ].filter(Boolean).join('\n')

    if (previewOnly) {
      const aiRes = await decomposeWishWithAI(ctx, store, {
        prompt: promptText,
        template: templateName,
        clarificationsText,
        sessionId: sessionRef,
        cwd: cwdOverride,
      })

      if (aiRes.ok) {
        const previewGoals = aiRes.goals.map((g, idx) => normalizeWishGoalItem(g, idx))
        const projectNameText = aiRes.project_name || extractWishTitle(promptText)
        const refinedPromptText = aiRes.refined_prompt || promptText
        const summaryText = aiRes.summary || `已由 ${aiRes.model} 拆解为 ${previewGoals.length} 个无冲突并发子任务。`
        const mergedSpec = {
          title: projectNameText,
          project_name: projectNameText,
          projectName: projectNameText,
          template: templateName || 'custom',
          raw_prompt: promptText,
          refined_prompt: refinedPromptText,
          refinedPrompt: refinedPromptText,
          summary: summaryText,
          clarifications: aiRes.clarifications || [],
          deliverables: aiRes.deliverables || [],
          proposed_waves: previewGoals,
          goals: previewGoals,
          model: aiRes.model,
          provider: aiRes.provider,
          ai_generated: true,
        }
        return {
          ok: true,
          op: effectiveOp,
          preview_only: true,
          ai_generated: true,
          model: aiRes.model,
          provider: aiRes.provider,
          cwd: aiRes.cwd || '',
          engagement: currentEng,
          active_engagement: currentEng,
          prompt: promptText,
          project_name: projectNameText,
          projectName: projectNameText,
          refined_prompt: refinedPromptText,
          refinedPrompt: refinedPromptText,
          summary: summaryText,
          template: templateName || 'custom',
          goals: previewGoals,
          stages: previewGoals,
          subgoals: previewGoals,
          proposed_waves: previewGoals,
          blueprint: {
            project_name: projectNameText,
            refined_prompt: refinedPromptText,
            summary: summaryText,
            goals: previewGoals,
          },
          refined_spec: mergedSpec,
          refinedSpec: mergedSpec,
        }
      }

      if (!allowStaticFallback) {
        return {
          ok: false,
          op: effectiveOp,
          preview_only: true,
          engagement: currentEng,
          active_engagement: currentEng,
          llm_unavailable: true,
          ...(aiRes.model ? { model: aiRes.model } : {}),
          ...(aiRes.provider ? { provider: aiRes.provider } : {}),
          error: aiRes.error || 'DSH LLM 服务不可用，无法进行 AI 需求拆解。',
        }
      }

      const localSpec = buildRefinedWishSpec(promptText, templateName, rawPayload)
      const previewGoals = localSpec.proposed_waves.map((g, idx) => normalizeWishGoalItem(g, idx))
      const mergedSpec = Object.assign({}, localSpec, {
        fallback_used: true,
        proposed_waves: previewGoals,
        goals: previewGoals,
      })
      return {
        ok: true,
        fallback_used: true,
        op: effectiveOp,
        preview_only: true,
        engagement: currentEng,
        active_engagement: currentEng,
        prompt: promptText,
        project_name: localSpec.project_name,
        projectName: localSpec.project_name,
        refined_prompt: localSpec.refined_prompt,
        refinedPrompt: localSpec.refined_prompt,
        summary: localSpec.summary,
        template: templateName || localSpec.template,
        goals: previewGoals,
        stages: previewGoals,
        subgoals: previewGoals,
        proposed_waves: previewGoals,
        blueprint: {
          project_name: localSpec.project_name,
          refined_prompt: localSpec.refined_prompt,
          summary: localSpec.summary,
          goals: previewGoals,
        },
        refined_spec: mergedSpec,
        refinedSpec: mergedSpec,
      }
    }

    const callerExplicitGoals = Array.isArray(rawPayload.goals) && rawPayload.goals.length > 0
      ? rawPayload.goals
      : (Array.isArray(rawPayload.proposed_waves) && rawPayload.proposed_waves.length > 0
        ? rawPayload.proposed_waves
        : (Array.isArray(rawPayload.waves) && rawPayload.waves.length > 0
          ? rawPayload.waves
          : (Array.isArray(rawPayload.stages) && rawPayload.stages.length > 0
            ? rawPayload.stages
            : (Array.isArray(rawPayload.subgoals) && rawPayload.subgoals.length > 0 ? rawPayload.subgoals : null))))

    let aiRes = null
    if (!callerExplicitGoals) {
      aiRes = await decomposeWishWithAI(ctx, store, {
        prompt: promptText,
        template: templateName,
        clarificationsText,
        sessionId: sessionRef,
        cwd: cwdOverride,
      })
      if (!aiRes.ok && !allowStaticFallback) {
        return {
          ok: false,
          op: effectiveOp,
          preview_only: false,
          engagement: currentEng,
          active_engagement: currentEng,
          llm_unavailable: true,
          ...(aiRes.model ? { model: aiRes.model } : {}),
          ...(aiRes.provider ? { provider: aiRes.provider } : {}),
          error: aiRes.error || 'DSH LLM 服务不可用，未能生成 AI 拆解任务。',
        }
      }
    }

    const fallbackSpec = (!callerExplicitGoals && (!aiRes || !aiRes.ok) && allowStaticFallback)
      ? buildRefinedWishSpec(promptText, templateName, rawPayload)
      : null
    const sourceGoalsForStore = callerExplicitGoals
      || (aiRes && aiRes.ok ? aiRes.goals : null)
      || (fallbackSpec ? fallbackSpec.proposed_waves : null)

    const normalizedStoreGoals = sourceGoalsForStore
      ? sourceGoalsForStore.map((g, idx) => {
        const item = normalizeWishGoalItem(g, idx)
        return Object.assign({}, g && typeof g === 'object' ? g : {}, item, {
          wave: `wave-${item.wave}`,
          wave_num: item.wave,
          role: item.role,
          worker_role: item.role,
          worker_name: item.worker_name,
          title: item.title,
          goal: item.goal,
          objective: item.goal,
          description: item.goal,
          assigned_goal: item.goal,
          files_owned: item.files_owned,
          acceptance_criteria: item.acceptance_criteria,
          ui_priority: item.ui_priority,
        })
      })
      : undefined

    const resolvedProjectName = String(
      rawPayload.project_name
      || rawPayload.projectName
      || (aiRes && aiRes.project_name)
      || (fallbackSpec && fallbackSpec.project_name)
      || extractWishTitle(promptText),
    ).trim()
    const resolvedRefinedPrompt = String(
      rawPayload.refined_prompt
      || rawPayload.refinedPrompt
      || (aiRes && aiRes.refined_prompt)
      || (fallbackSpec && fallbackSpec.refined_prompt)
      || promptText,
    ).trim()
    const resolvedSummary = String(
      rawPayload.summary
      || (aiRes && aiRes.summary)
      || (fallbackSpec && fallbackSpec.summary)
      || `已确认 ${normalizedStoreGoals ? normalizedStoreGoals.length : 0} 项多波次分片任务并准备派发执行。`,
    ).trim()

    const activeSpec = {
      title: resolvedProjectName,
      project_name: resolvedProjectName,
      projectName: resolvedProjectName,
      template: templateName || (fallbackSpec && fallbackSpec.template) || 'custom',
      raw_prompt: promptText,
      refined_prompt: resolvedRefinedPrompt,
      refinedPrompt: resolvedRefinedPrompt,
      summary: resolvedSummary,
      clarifications: (aiRes && aiRes.clarifications) || (fallbackSpec && fallbackSpec.clarifications) || [],
      deliverables: (aiRes && aiRes.deliverables) || (fallbackSpec && fallbackSpec.deliverables) || [],
      proposed_waves: normalizedStoreGoals || [],
      goals: normalizedStoreGoals || [],
      ...(aiRes && aiRes.ok ? { model: aiRes.model, provider: aiRes.provider, ai_generated: true } : {}),
      ...(fallbackSpec ? { fallback_used: true } : {}),
    }

    const storePayload = Object.assign({}, rawPayload, withEngIds(currentEng, {
      op: effectiveOp,
      prompt: promptText,
      user_prompt: promptText,
      refined_prompt: resolvedRefinedPrompt,
      template: templateName,
      preview_only: false,
      require_ai: true,
      ...(aiRes && aiRes.ok ? { ai_generated: true, model: aiRes.model, provider: aiRes.provider } : {}),
      refined_spec: activeSpec,
      proposed_waves: activeSpec.proposed_waves,
      waves: rawPayload.proposed_waves || rawPayload.waves || activeSpec.proposed_waves,
    }))
    if (normalizedStoreGoals) {
      storePayload.goals = normalizedStoreGoals
    }

    let storeResult = null
    if (effectiveOp === 'refineAndDecomposeWish' && store && typeof store.refineAndDecomposeWish === 'function') {
      try {
        storeResult = await invokeStoreMethodCompat(store, 'refineAndDecomposeWish', currentEng, storePayload)
      } catch { storeResult = null }
    }
    if (!storeResult && store) {
      storeResult = await invokeOrDispatchCompat('decomposeUserPrompt', currentEng, Object.assign({}, storePayload, { op: 'decomposeUserPrompt' }))
    }
    if (storeResult && storeResult.ok === false) {
      return Object.assign({ op: effectiveOp, engagement: currentEng }, storeResult)
    }

    reqFlow.dagByEng.delete(currentEng)
    const preDispatchDag = getWorkflowDagDedup(store, currentEng, reqFlow)
    const workerTasksForDispatch = (storeResult && Array.isArray(storeResult.worker_tasks) && storeResult.worker_tasks.length > 0)
      ? storeResult.worker_tasks
      : ((preDispatchDag && Array.isArray(preDispatchDag.worker_tasks)) ? preDispatchDag.worker_tasks : [])

    const dispatched = await dispatchWorkflowToDshAgents(ctx, store, {
      engagementId: currentEng,
      sessionId: sessionRef,
      refinedPrompt: resolvedRefinedPrompt,
      userPrompt: promptText,
      workerTasks: workerTasksForDispatch,
      goals: normalizedStoreGoals || [],
      cwd: cwdOverride || (aiRes && aiRes.cwd) || '',
      settingsRoot,
      usage: rawPayload.usage,
      allowOverrideBudget: Boolean(rawPayload.allowOverrideBudget ?? rawPayload.allow_override_budget),
      retryDelayMs: rawPayload.retryDelayMs,
    })

    const { hostSessions, synth } = await rebuildCollab(currentEng, {
      invalidateEngs: true,
      bumpOp: effectiveOp,
      hostEng: currentEng,
    })
    const freshDag = getWorkflowDagDedup(store, currentEng, reqFlow)
    const pgProbe = readPgProbe(currentEng)

    const finalSpec = (storeResult && storeResult.refined_spec && typeof storeResult.refined_spec === 'object')
      ? Object.assign({}, activeSpec, storeResult.refined_spec)
      : activeSpec
    const goalsOut = (freshDag && Array.isArray(freshDag.plan_goals) && freshDag.plan_goals.length > 0)
      ? freshDag.plan_goals
      : ((storeResult && Array.isArray(storeResult.goals)) ? storeResult.goals : [])
    const workerTasksOut = (freshDag && Array.isArray(freshDag.worker_tasks) && freshDag.worker_tasks.length > 0)
      ? freshDag.worker_tasks
      : workerTasksForDispatch

    return Object.assign(
      {
        subgoals: synth.childNodes.map((c) => ({
          id: c.id,
          worker_task_id: c.worker_task_id ?? null,
          role: c.role,
          wave: c.wave,
          title: c.title,
          assigned_goal: c.assigned_goal || '',
          files_owned: c.files_owned || [],
          uiPriority: c.uiPriority,
          workerTags: c.workerTags,
          approvalState: c.approvalState,
          nextGoal: c.nextGoal,
        })),
      },
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: true,
        op: effectiveOp,
        preview_only: false,
        ai_generated: Boolean((aiRes && aiRes.ok) || rawPayload.ai_generated || callerExplicitGoals),
        ...(aiRes && aiRes.model ? { model: aiRes.model, provider: aiRes.provider } : {}),
        ...(fallbackSpec ? { fallback_used: true } : {}),
        prompt: promptText,
        refined_prompt: finalSpec.refined_prompt || resolvedRefinedPrompt,
        project_name: finalSpec.project_name || finalSpec.title,
        summary: finalSpec.summary || resolvedSummary,
        refined_spec: finalSpec,
        refinedSpec: finalSpec,
        goals: goalsOut,
        plan_goals: goalsOut,
        worker_tasks: workerTasksOut,
        proposed_waves: finalSpec.proposed_waves || activeSpec.proposed_waves,
        dispatched,
        engagement: currentEng,
        active_engagement: currentEng,
        host_sessions: hostSessions,
        hostSessions,
        pg_probe: pgProbe,
        pgWriteProbe: pgProbe,
      },
      synthNetworkFields(synth),
    )
  }

  if (effectiveOp === 'updateWorkerGoal') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const matchedTask = resolveWorkerTaskFromDag(currentEng, rawPayload)
    const resolvedGoalText = rawPayload.assigned_goal ?? rawPayload.assignedGoal ?? rawPayload.goal ?? rawPayload.objective
    const payloadWithEng = withEngIds(currentEng, rawPayload)
    if (matchedTask && matchedTask.id !== undefined && matchedTask.id !== null) {
      payloadWithEng.worker_task_id = matchedTask.id
      payloadWithEng.id = matchedTask.id
    }
    if (resolvedGoalText !== undefined) {
      payloadWithEng.assigned_goal = resolvedGoalText
      payloadWithEng.goal = resolvedGoalText
    }
    const storeResult = await runWorkerMutation('updateWorkerGoal', 'updateWorkerGoal', currentEng, payloadWithEng)
    if (storeResult && storeResult.ok === false && typeof storeResult.error === 'string') {
      return storeResult
    }

    const targetTask = (storeResult && storeResult.worker_task && typeof storeResult.worker_task === 'object')
      ? storeResult.worker_task
      : (resolveWorkerTaskFromDag(currentEng, payloadWithEng) || matchedTask)
    const childId = String((targetTask && targetTask.session_id) || rawPayload.session_id || rawPayload.sessionId || '').trim()
    const { rootAgent, subagentsSvc } = await resolveDshDispatchHandles(rawPayload)
    const warnings = []
    let wokeChildId = null
    let captainNotified = false
    let dispatchMode = 'noop'

    const agentsSvc = tryGet(ctx, 'agents')
    let liveChild = null
    if (agentsSvc && typeof agentsSvc.get === 'function' && childId) {
      try { liveChild = agentsSvc.get(childId) } catch { liveChild = null }
    }
    const childStateStr = liveChild ? String(liveChild.state || liveChild.status || '').toLowerCase() : ''
    const isRunning = liveChild
      ? (['running', 'busy', 'working', 'streaming'].includes(childStateStr) || Boolean(liveChild.busy))
      : String((targetTask && targetTask.status) || '').toLowerCase() === 'running'
    const deliverMode = isRunning ? 'steer' : 'queue'

    const goalTextStr = String(resolvedGoalText ?? (targetTask && targetTask.assigned_goal) ?? '').trim()
    const updateMsg = [
      '【LMTAgent · 子任务目标变更通知】',
      `- 任务节点：${(targetTask && (targetTask.title || targetTask.worker_name)) || payloadWithEng.worker_task_id || ''}`,
      goalTextStr ? `- 最新执行目标（assigned_goal）：${goalTextStr}` : '',
      rawPayload.files_owned ? `- 最新文件分片（files_owned）：${JSON.stringify(rawPayload.files_owned)}` : '',
      '请立刻按最新目标调整执行方案，并在完成后提交 `lmt_workflow` submit_digest。',
    ].filter(Boolean).join('\n')

    if (isRealChildSessionId(ctx, childId) && rootAgent && subagentsSvc) {
      try {
        await deliverPromptToChild(subagentsSvc, deliverMode, rootAgent, childId, updateMsg)
        wokeChildId = childId
        dispatchMode = deliverMode
      } catch (err) {
        warnings.push(`向子代理 ${childId} 投递目标变更（${deliverMode}）失败：${err && err.message ? err.message : String(err)}`)
      }
    } else if (isRealChildSessionId(ctx, childId)) {
      warnings.push(!rootAgent ? '未解析到活跃 rootAgent，仅更新事实库目标' : '宿主 subagents 服务不可用，仅更新事实库目标')
    } else {
      warnings.push('该节点尚未绑定真实 DSH 子会话 childId，仅更新事实库目标')
    }

    if (rootAgent && typeof rootAgent.followup === 'function') {
      const captainNote = [
        `【LMTAgent 目标变更同步】工作区 \`${currentEng}\` 节点 \`${(targetTask && (targetTask.title || targetTask.worker_name)) || payloadWithEng.worker_task_id || ''}\` 目标已更新。`,
        goalTextStr ? `- 新目标：${goalTextStr.slice(0, 300)}` : '',
        wokeChildId ? `- 已通过 \`${dispatchMode}Prompt\` 实时同步给 childId: \`${wokeChildId}\`` : '',
      ].filter(Boolean).join('\n')
      try {
        const fRes = sendRootFollowupMessage(rootAgent, captainNote)
        captainNotified = Boolean(fRes.ok)
      } catch { /* ignore */ }
    }

    const { synth } = await rebuildCollab(currentEng, { bumpOp: 'updateWorkerGoal', hostEng: currentEng })
    return Object.assign(
      {},
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: storeResult && storeResult.ok === false ? false : true,
        op: 'updateWorkerGoal',
        engagement: currentEng,
        dispatched: {
          mode: dispatchMode,
          spawned: [],
          wokeChildId,
          captainNotified,
          ...(warnings.length > 0 ? { warning: warnings.join('；') } : {}),
        },
      },
      synthNetworkFields(synth, { includeEvents: false }),
    )
  }

  if (effectiveOp === 'addCustomWorkerTask') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const payloadWithEng = withEngIds(currentEng, rawPayload)
    const storeResult = await runWorkerMutation('addCustomWorkerTask', 'addCustomWorkerTask', currentEng, payloadWithEng)
    if (storeResult && storeResult.ok === false && typeof storeResult.error === 'string') {
      return storeResult
    }
    const createdTask = (storeResult && storeResult.worker_task && typeof storeResult.worker_task === 'object')
      ? Object.assign({}, storeResult.worker_task)
      : resolveWorkerTaskFromDag(currentEng, {
        id: storeResult && (storeResult.worker_task_id ?? storeResult.id),
        worker_name: rawPayload.worker_name || rawPayload.workerName,
      })

    const { settings, rootAgent, subagentsSvc, cwd } = await resolveDshDispatchHandles(rawPayload)
    const shouldAutoDispatch = rawPayload.autoStart !== false && rawPayload.auto_dispatch !== false
    const spawned = []
    const warnings = []
    let captainNotified = false

    if (createdTask && shouldAutoDispatch && (settings.dispatchPolicy.dispatchMode !== 'captain_only' || rawPayload.autoStart === true)) {
      if (rootAgent && subagentsSvc && typeof subagentsSvc.startActivation === 'function') {
        const dag = getWorkflowDagDedup(store, currentEng, reqFlow)
        const refinedPrompt = String((dag && dag.engagement && dag.engagement.goal) || '').trim()
        try {
          const started = await startSubagentActivationSafe(ctx, subagentsSvc, rootAgent, createdTask, {
            provider: settings.dispatchPolicy.subagentProvider || 'spawn',
            cwd,
            engId: currentEng,
            refinedPrompt,
            maxDepth: settings.maxDepth,
            thinkingEffort: settings.thinkingEffort,
            maxAutoRetries: settings.dispatchPolicy.maxAutoRetries ?? 1,
            retryDelayMs: rawPayload.retryDelayMs,
          })
          if (started && started.childId) {
            await bindWorkerSessionCompat(store, currentEng, createdTask, started.childId, 'running')
            createdTask.session_id = started.childId
            createdTask.status = 'running'
            spawned.push({
              worker_task_id: createdTask.id,
              worker_name: createdTask.worker_name || createdTask.title,
              role: createdTask.worker_role || rawPayload.worker_role || rawPayload.role || 'exploit',
              childId: started.childId,
            })
          } else {
            warnings.push('startActivation 未返回有效的 childId')
          }
        } catch (err) {
          warnings.push(`拉起自定义子任务失败：${err && err.message ? err.message : String(err)}`)
        }
      } else {
        warnings.push(!rootAgent ? '未解析到活跃 rootAgent，自定义任务已落库等待拉起' : '宿主 subagents 服务不可用，自定义任务已落库等待拉起')
      }
    }

    if (rootAgent && typeof rootAgent.followup === 'function') {
      const taskLabel = createdTask
        ? `[${createdTask.wave || 'wave-?'} · ${createdTask.worker_role || 'exploit'}] ${createdTask.title || createdTask.worker_name} (task_id=${createdTask.id})`
        : (rawPayload.title || rawPayload.worker_name || 'custom-worker')
      const captainNote = spawned.length > 0
        ? `【LMTAgent 新增分片同步】工作区 \`${currentEng}\` 新增自定义任务 ${taskLabel}，已由工作台真实拉起 childId: \`${spawned[0].childId}\`（请勿重复派发）。`
        : `【LMTAgent 新增分片同步】工作区 \`${currentEng}\` 新增自定义任务 ${taskLabel}，请主控 Captain 按波次约束安排调度。`
      try {
        const fRes = sendRootFollowupMessage(rootAgent, captainNote)
        captainNotified = Boolean(fRes.ok)
      } catch { /* ignore */ }
    }

    const { synth } = await rebuildCollab(currentEng, {
      invalidateEngs: spawned.length > 0,
      bumpOp: 'addCustomWorkerTask',
      hostEng: currentEng,
    })
    const createdNodeId = createdTask
      ? (createdTask.session_id || `wt-${createdTask.id}`)
      : (storeResult && (storeResult.worker_id || storeResult.id)) || undefined
    return Object.assign(
      {},
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: storeResult && storeResult.ok === false ? false : true,
        op: 'addCustomWorkerTask',
        engagement: currentEng,
        worker_id: createdNodeId,
        worker_task_id: createdTask ? createdTask.id : (storeResult && storeResult.worker_task_id),
        ...(createdTask ? { worker_task: createdTask } : {}),
        ...(spawned[0] ? { childId: spawned[0].childId, session_id: spawned[0].childId } : {}),
        dispatched: {
          mode: spawned.length > 0 ? 'hybrid_auto' : settings.dispatchPolicy.dispatchMode,
          provider: settings.dispatchPolicy.subagentProvider || 'spawn',
          spawned,
          captainNotified,
          ...(warnings.length > 0 ? { warning: warnings.join('；') } : {}),
        },
      },
      synthNetworkFields(synth, { includeEvents: false }),
    )
  }

  if (effectiveOp === 'retryWorkerTask') {
    const rawPayload = mergeAgentPayload()
    const currentEng = resolveActionEng(rawPayload)
    const matchedTask = resolveWorkerTaskFromDag(currentEng, rawPayload)
    const targetWorkerKey = String(
      rawPayload.worker_task_id ?? rawPayload.worker_id ?? rawPayload.workerId ?? rawPayload.session_id ?? rawPayload.id ?? '',
    ).trim()
    if (targetWorkerKey) {
      deleteScopedWorkerOverride(currentEng, targetWorkerKey)
      if (targetWorkerKey.startsWith('wt-')) deleteScopedWorkerOverride(currentEng, targetWorkerKey.slice(3))
    }
    if (matchedTask) {
      deleteScopedWorkerOverride(currentEng, String(matchedTask.id))
      deleteScopedWorkerOverride(currentEng, `wt-${matchedTask.id}`)
      if (matchedTask.session_id) deleteScopedWorkerOverride(currentEng, String(matchedTask.session_id))
    }
    const payloadWithEng = withEngIds(currentEng, rawPayload)
    if (matchedTask && matchedTask.id !== undefined && matchedTask.id !== null) {
      payloadWithEng.worker_task_id = matchedTask.id
      payloadWithEng.id = matchedTask.id
    }
    const storeResult = await runWorkerMutation('retryWorkerTask', 'retryWorkerTask', currentEng, payloadWithEng, { workflowAction: 'retryNode' })
    if (storeResult && storeResult.ok === false && typeof storeResult.error === 'string') {
      return storeResult
    }

    const afterTask = (storeResult && storeResult.worker_task && typeof storeResult.worker_task === 'object')
      ? Object.assign({}, storeResult.worker_task)
      : (resolveWorkerTaskFromDag(currentEng, payloadWithEng) || matchedTask)
    const existingChildId = String(
      (matchedTask && matchedTask.session_id)
      || (afterTask && afterTask.session_id)
      || rawPayload.session_id
      || rawPayload.sessionId
      || '',
    ).trim()

    const { settings, rootAgent, subagentsSvc, cwd } = await resolveDshDispatchHandles(rawPayload)
    const spawned = []
    const warnings = []
    let wokeChildId = null
    let captainNotified = false
    let dispatchMode = 'noop'

    const retryReason = String(
      rawPayload.reason || rawPayload.feedback || rawPayload.note || '请基于当前项目事实库状态继续修复并完成验证交付。',
    ).trim()
    const taskLabel = (afterTask && (afterTask.title || afterTask.worker_name)) || targetWorkerKey
    const retryMsg = [
      '【LMTAgent · 子任务重试 / 续跑通知】',
      `- 任务节点：${taskLabel}`,
      `- 重试原因 / 指示：${retryReason}`,
      '请立刻恢复执行并在完成后调用 `lmt_workflow` submit_digest 提交完整结论与验证证据。',
    ].join('\n')

    if (rootAgent && subagentsSvc) {
      if (isRealChildSessionId(ctx, existingChildId)) {
        try {
          await deliverPromptToChild(subagentsSvc, 'queue', rootAgent, existingChildId, retryMsg)
          wokeChildId = existingChildId
          dispatchMode = 'queue'
        } catch (err) {
          warnings.push(`续接原 childId=${existingChildId} 失败（${err && err.message ? err.message : String(err)}），尝试重新拉起新会话`)
        }
      }
      if (!wokeChildId && typeof subagentsSvc.startActivation === 'function') {
        const dag = getWorkflowDagDedup(store, currentEng, reqFlow)
        const refinedPrompt = String((dag && dag.engagement && dag.engagement.goal) || '').trim()
        const taskForSpawn = afterTask || {
          id: targetWorkerKey,
          worker_name: targetWorkerKey,
          worker_role: rawPayload.worker_role || rawPayload.role || 'exploit',
          wave: rawPayload.wave || 'wave-3',
          title: taskLabel,
          assigned_goal: retryReason,
        }
        try {
          const started = await startSubagentActivationSafe(ctx, subagentsSvc, rootAgent, taskForSpawn, {
            provider: settings.dispatchPolicy.subagentProvider || 'spawn',
            cwd,
            engId: currentEng,
            refinedPrompt,
            maxDepth: settings.maxDepth,
            thinkingEffort: settings.thinkingEffort,
            maxAutoRetries: settings.dispatchPolicy.maxAutoRetries ?? 1,
            retryDelayMs: rawPayload.retryDelayMs,
            extraNote: retryReason,
          })
          if (started && started.childId) {
            await bindWorkerSessionCompat(store, currentEng, taskForSpawn, started.childId, 'running')
            if (afterTask) {
              afterTask.session_id = started.childId
              afterTask.status = 'running'
            }
            dispatchMode = 'spawn'
            spawned.push({
              worker_task_id: taskForSpawn.id,
              worker_name: taskForSpawn.worker_name || taskForSpawn.title,
              role: taskForSpawn.worker_role || taskForSpawn.role,
              childId: started.childId,
            })
          } else {
            warnings.push('startActivation 未返回有效的 childId')
          }
        } catch (err) {
          warnings.push(`重拉子代理失败：${err && err.message ? err.message : String(err)}`)
        }
      }
    } else {
      warnings.push(!rootAgent ? '未解析到活跃 rootAgent，仅重置事实库任务状态' : '宿主 subagents 服务不可用，仅重置事实库任务状态')
    }

    if (rootAgent && typeof rootAgent.followup === 'function') {
      const captainNote = spawned.length > 0
        ? `【LMTAgent 任务重试同步】工作区 \`${currentEng}\` 节点 \`${taskLabel}\` 已重新拉起新子会话 childId: \`${spawned[0].childId}\`（请勿重复派发）。`
        : (wokeChildId
          ? `【LMTAgent 任务重试同步】工作区 \`${currentEng}\` 节点 \`${taskLabel}\` 已通过 \`queuePrompt\` 唤醒原会话 childId: \`${wokeChildId}\`。`
          : `【LMTAgent 任务重试同步】工作区 \`${currentEng}\` 节点 \`${taskLabel}\` 已在事实库重置为待重试状态。`)
      try {
        const fRes = sendRootFollowupMessage(rootAgent, captainNote)
        captainNotified = Boolean(fRes.ok)
      } catch { /* ignore */ }
    }

    const { synth } = await rebuildCollab(currentEng, {
      invalidateEngs: spawned.length > 0,
      bumpOp: 'retryWorkerTask',
      bumpMeta: { engagement: currentEng, workerId: targetWorkerKey },
      hostEng: currentEng,
    })
    return Object.assign(
      {},
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: storeResult && storeResult.ok === false ? false : true,
        op: 'retryWorkerTask',
        engagement: currentEng,
        ...(spawned[0]
          ? { childId: spawned[0].childId, session_id: spawned[0].childId }
          : (wokeChildId ? { childId: wokeChildId, session_id: wokeChildId } : {})),
        dispatched: {
          mode: dispatchMode,
          provider: settings.dispatchPolicy.subagentProvider || 'spawn',
          spawned,
          wokeChildId,
          captainNotified,
          ...(warnings.length > 0 ? { warning: warnings.join('；') } : {}),
        },
      },
      synthNetworkFields(synth, { includeEvents: false }),
    )
  }

  if (effectiveOp === 'shardLocks' || effectiveOp === 'listShardLocks') {
    const currentEng = resolveSessionAwareEngagement()
    if (!currentEng) {
      return Object.assign({ active_engagement: null }, computeShardLocksFallback(store, null, null, request))
    }
    const wfDag = getWorkflowDagDedup(store, currentEng, reqFlow)
    return Object.assign({ active_engagement: currentEng }, computeShardLocksFallback(store, currentEng, wfDag, request))
  }

  if (request.op === 'agentSessionDetail') {
    return await extractAgentSessionDetail(ctx, store, activeEngagement || 'default', request, reqFlow, {
      onJsonlAdvance: bumpEventSeq,
    })
  }

  if (request.op === 'activateAgentSession') {
    const targetSid = String(request.sessionId || request.agentId || request.session || '').trim()
    const currentEng = explicitReqEng || sessionBoundEngagement || (store ? getCachedActiveEngagementId(store) : null) || 'default'

    let sessions = null
    let subagents = null
    try { sessions = ctx.get('sessions') } catch { sessions = null }
    try { subagents = ctx.get('subagents') } catch { subagents = null }

    const byId = new Map()
    if (sessions && typeof sessions.list === 'function') {
      try {
        for (const s of (sessions.list() || [])) {
          if (s && s.id !== undefined) byId.set(String(s.id), s)
        }
      } catch { /* ignore */ }
    }
    if (sessions && typeof sessions.get === 'function' && targetSid && !byId.has(targetSid)) {
      try {
        const got = sessions.get(targetSid)
        if (got && got.id !== undefined) byId.set(String(got.id), got)
      } catch { /* ignore */ }
    }

    let subagentParentRoot = ''
    if (targetSid && !isSyntheticSessionId(targetSid) && !byId.has(targetSid) && subagents && typeof subagents.listChildren === 'function') {
      for (const [rid, rNode] of byId.entries()) {
        const p = rNode && rNode.header && rNode.header.parentSession
        if (p) continue
        try {
          const children = await subagents.listChildren(rid)
          if (Array.isArray(children) && children.some((k) => k && String(k.id || k.sessionId || '') === targetSid)) {
            subagentParentRoot = rid
            break
          }
        } catch { /* ignore */ }
      }
    }

    const realSessionFound = Boolean(
      targetSid
      && !isSyntheticSessionId(targetSid)
      && (byId.has(targetSid) || Boolean(subagentParentRoot)),
    )

    let rootSessionId = ''
    if (realSessionFound) {
      const candidateRoot = subagentParentRoot || resolveRootFromMap(byId, targetSid)
      if (candidateRoot && !isSyntheticSessionId(candidateRoot) && byId.has(candidateRoot)) {
        rootSessionId = candidateRoot
      }
    } else if (request.session && !isSyntheticSessionId(request.session) && byId.has(String(request.session))) {
      const fallbackRoot = resolveRootFromMap(byId, String(request.session))
      if (fallbackRoot && !isSyntheticSessionId(fallbackRoot) && byId.has(fallbackRoot)) {
        rootSessionId = fallbackRoot
      }
    }

    if (store && currentEng && rootSessionId && !isSyntheticSessionId(rootSessionId)) {
      try {
        const allEngs = getCachedEngagementsList(store)
        const matchedEng = (Array.isArray(allEngs) && allEngs.find((e) => e && e.id === currentEng)) || null
        const engName = (matchedEng && matchedEng.name) || currentEng
        if (typeof store.setSessionBinding === 'function') {
          store.setSessionBinding(rootSessionId, currentEng, engName)
        } else {
          dispatch(store, {
            op: 'bindSessionEngagement',
            session: rootSessionId,
            engagement: currentEng,
            id: currentEng,
            name: engName,
          })
        }
        invalidateSessionBindingsCache(store)
        bumpEventSeq('activateAgentSession', { sessionId: targetSid, rootSessionId })
      } catch { /* ignore binding errors */ }
    }

    return {
      ok: true,
      activated: Boolean(realSessionFound),
      isRealHostSession: Boolean(realSessionFound),
      sessionId: targetSid,
      rootSessionId: rootSessionId || null,
      engagement: currentEng,
      note: realSessionFound
        ? '已激活目标 Agent 会话，可在侧边聊天框直接查看与续接对话。'
        : '当前节点为规划/归档任务节点（尚无活跃宿主会话），已在控制台定位详情。',
    }
  }

  if (request.op === 'hostSessions') {
    const explicitEng = request.engagement || request.engagement_id || request.engagementId || ''
    const hostSessions = await discoverHostSessions(ctx, store, {
      sessionId: request.session,
      engagementId: explicitEng || undefined,
      autoBind: true,
      reqFlow,
      onJsonlAdvance: bumpEventSeq,
    })
    const currentEng = resolveSessionAwareEngagement(explicitEng)
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
    return Object.assign(
      { ok: true, items: hostSessions, active_engagement: currentEng },
      synthNetworkFields(synth),
    )
  }

  if (request.op === 'pgWriteProbe') {
    const currentEng = resolveSessionAwareEngagement()
    if (!currentEng) {
      const zeroCounts = { plan_goals: 0, worker_tasks: 0, worker_digests: 0, shard_locks: 0 }
      return {
        ok: true,
        unbound: true,
        engagement: null,
        engagement_id: null,
        active_engagement: null,
        ready: false,
        counts: zeroCounts,
        row_counts: zeroCounts,
        total_rows: 0,
      }
    }
    const probe = readPgProbe(currentEng)
    return Object.assign(
      {
        ok: true,
        active_engagement: currentEng,
        counts: (probe && (probe.counts || probe.row_counts)) || {},
      },
      probe,
    )
  }

  if (request.op === 'workflowDag' || request.op === 'workflowDocWall') {
    const explicitEng = request.engagement || request.engagement_id || request.engagementId || ''
    const hostSessions = await discoverHostSessions(ctx, store, {
      sessionId: request.session,
      engagementId: explicitEng || undefined,
      autoBind: true,
      reqFlow,
      onJsonlAdvance: bumpEventSeq,
    })
    const currentEng = resolveSessionAwareEngagement(explicitEng)
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
    if (!currentEng) {
      const { budgetGuard, perfMetrics } = computeWorkspaceGuardsAndPerf(store, settingsRoot, null, hostSessions, reqFlow)
      return {
        ok: true,
        standby: true,
        unbound: true,
        engagement: null,
        active_engagement: null,
        runId: null,
        status: 'standby',
        nodes: [],
        all_nodes: [],
        active_nodes: [],
        worker_tasks: [],
        plan_goals: [],
        worker_digests: [],
        edges: [],
        activeRoles: [],
        docWall: [],
        host_sessions: hostSessions,
        agentNetwork: synth.agentNetwork,
        agent_network: synth.agentNetwork,
        swimlanes: [],
        collabEvents: [],
        collab_events: [],
        collabTasks: [],
        collab_tasks: [],
        budgetGuard,
        budget_guard: budgetGuard,
        perfMetrics,
        perf_metrics: perfMetrics,
      }
    }
    const rawDagData = getWorkflowDagDedup(store, currentEng, reqFlow)
    const { budgetGuard, perfMetrics } = computeWorkspaceGuardsAndPerf(
      store,
      settingsRoot,
      currentEng,
      hostSessions,
      reqFlow,
      { dag: rawDagData || {} },
    )
    if (rawDagData) {
      const dagData = Object.assign({}, rawDagData)
      for (const listKey of ['nodes', 'all_nodes']) {
        if (Array.isArray(dagData[listKey])) {
          dagData[listKey] = dagData[listKey].map((n, idx) => {
            const copy = Object.assign({}, n)
            computeWorkerLmtexMeta(copy, idx, { store, engagementId: currentEng })
            return copy
          })
        }
      }
      if (dagData.telemetry && typeof dagData.telemetry === 'object') {
        dagData.telemetry = Object.assign({}, dagData.telemetry)
        sanitizeDagTelemetryCacheHit(dagData, synth.nodes)
      }
      return Object.assign(
        { ok: true },
        dagData,
        synthNetworkFields(synth),
        {
          nodes: synth.childNodes.length > 0 && (!Array.isArray(dagData.active_nodes) || dagData.active_nodes.length === 0)
            ? synth.nodes
            : dagData.nodes,
          dag_role_nodes: dagData.nodes,
          host_sessions: hostSessions,
          budgetGuard,
          budget_guard: budgetGuard,
          perfMetrics,
          perf_metrics: perfMetrics,
        },
      )
    }
    return Object.assign(
      {
        ok: true,
        standby: true,
        engagement: currentEng,
        runId: null,
        status: 'standby',
        edges: [],
        activeRoles: [],
        docWall: [],
        host_sessions: hostSessions,
        budgetGuard,
        budget_guard: budgetGuard,
        perfMetrics,
        perf_metrics: perfMetrics,
      },
      synthNetworkFields(synth),
    )
  }

  if (
    effectiveOp === 'feishuConfig'
    || effectiveOp === 'feishuConfigSave'
    || effectiveOp === 'saveFeishuConfig'
    || effectiveOp === 'saveFeishuWebhook'
  ) {
    const mergedRaw = mergeAgentPayload()
    const currentEng = resolveActionEng(mergedRaw)
    const rawUrl = String(mergedRaw.webhook_url ?? mergedRaw.webhookUrl ?? mergedRaw.webhook ?? mergedRaw.url ?? '').trim()
    const feishuPayload = Object.assign({}, mergedRaw, {
      engagement: currentEng,
      engagement_id: currentEng,
      webhook_url: rawUrl,
      webhookUrl: rawUrl,
    })
    let feishuRes = null
    if (store && typeof store.saveFeishuConfig === 'function') {
      try {
        feishuRes = await invokeStoreMethodCompat(store, 'saveFeishuConfig', currentEng, feishuPayload)
      } catch (err) {
        return { ok: false, engagement: currentEng, error: err && err.message ? err.message : String(err) }
      }
    }
    if (!feishuRes && store && typeof store.workflowAction === 'function') {
      for (const action of ['feishuConfig', 'saveFeishuWebhook']) {
        try {
          feishuRes = store.workflowAction(currentEng, Object.assign({}, feishuPayload, { action }))
          if (feishuRes) break
        } catch { feishuRes = null }
      }
    }
    bumpEventSeq('feishuConfig', { engagement: currentEng })
    if (feishuRes && typeof feishuRes === 'object') {
      return Object.assign({ ok: true, engagement: currentEng, op: effectiveOp }, feishuRes)
    }
    return {
      ok: true,
      op: effectiveOp,
      action: 'feishuConfig',
      engagement: currentEng,
      feishu: {
        webhook_url: rawUrl,
        configured: Boolean(rawUrl),
        enabled: feishuPayload.enabled !== undefined ? Boolean(feishuPayload.enabled) : Boolean(rawUrl),
      },
      note: '已保存飞书群聊机器人通知配置。',
    }
  }

  const isFeishuPushOp = request.op === 'feishuNotify'
    || request.op === 'feishuTestPush'
    || request.op === 'pushFeishuNotify'
    || (request.op === 'workflowAction' && ['pushFeishuNotify', 'feishuNotify', 'feishuTestPush', 'pushFeishu'].includes(request.action))

  if (isFeishuPushOp) {
    const mergedRaw = mergeAgentPayload()
    const currentEng = resolveActionEng(mergedRaw)
    const pushPayload = Object.assign({ action: 'pushFeishuNotify' }, mergedRaw, {
      engagement: currentEng,
      engagement_id: currentEng,
      is_test: request.op === 'feishuTestPush' || request.action === 'feishuTestPush' || Boolean(request.is_test ?? request.test),
    })
    if (store && typeof store.pushFeishuNotify === 'function') {
      try {
        const pushRes = await invokeStoreMethodCompat(store, 'pushFeishuNotify', currentEng, pushPayload)
        bumpEventSeq('feishuNotify', { engagement: currentEng })
        if (pushRes && typeof pushRes === 'object') {
          return Object.assign({ engagement: currentEng }, pushRes, { ok: Boolean(pushRes.ok) })
        }
        return { ok: true, engagement: currentEng }
      } catch (err) {
        return { ok: false, engagement: currentEng, error: err && err.message ? err.message : String(err) }
      }
    }
    if (store && typeof store.workflowAction === 'function') {
      const res = await invokeStoreMethodCompat(store, 'workflowAction', currentEng, pushPayload)
      bumpEventSeq('feishuNotify', { engagement: currentEng })
      return Object.assign({ ok: true, engagement: currentEng }, res && typeof res === 'object' ? res : {})
    }
    return { ok: false, standby: true, engagement: currentEng, error: '当前存储实例未启用飞书 Webhook 推送能力' }
  }

  if (request.op === 'workflowAction' || request.op === 'workflowRun' || request.op === 'dagCheckpoint') {
    const targetEng = activeEngagement || (store ? getCachedActiveEngagementId(store) : null) || 'default'
    if (store && typeof store.workflowAction === 'function') {
      const res = Object.assign({ ok: true }, await invokeStoreMethodCompat(store, 'workflowAction', targetEng, request))
      bumpEventSeq('workflowAction', { engagement: targetEng, action: request.action || request.op })
      return res
    }
    return { ok: true, standby: true, engagement: targetEng }
  }

  if (request.op === 'setClusterConfig') {
    const src = request.config && typeof request.config === 'object' ? Object.assign({}, request, request.config) : request
    const patch = {}
    if (src.maxAgents !== undefined || src.max !== undefined || src.max_agents !== undefined) {
      patch.maxAgents = clampMaxAgents(src.maxAgents ?? src.max ?? src.max_agents)
    }
    const rawThinking = src.thinking ?? src.thinkingEffort ?? src.thinking_effort ?? src.effort
    if (rawThinking !== undefined) {
      patch.thinkingEffort = normalizeThinkingEffort(rawThinking)
    }
    if (src.maxDepth !== undefined || src.max_depth !== undefined || src.depth !== undefined) {
      patch.maxDepth = clampMaxDepth(src.maxDepth ?? src.max_depth ?? src.depth)
    }
    if (Object.keys(patch).length > 0) {
      writeSettings(root, patch)
      bumpEventSeq('setClusterConfig')
    }
    const cfgFields = buildClusterConfigFields(resolveCachedSettingsArg(root))
    return Object.assign({ ok: true }, cfgFields, {
      source: 'settings',
      limit: MAX_AGENTS_LIMIT,
      max_depth_limit: MAX_DEPTH_LIMIT,
      valid_thinking_efforts: VALID_THINKING_EFFORTS,
      note: `集群并发策略已更新：最大并发 ${cfgFields.max} · 默认思考强度 ${cfgFields.thinkingEffort} · 递归深度上限 ${cfgFields.maxDepth}（立即生效）。`,
    })
  }

  if (request.op === 'setAgentsMax') {
    const next = saveMaxAgents(root, request.max ?? request.maxAgents)
    const rawThinking = request.thinking ?? request.thinkingEffort ?? request.thinking_effort ?? request.effort
    if (rawThinking !== undefined) {
      saveThinkingEffort(root, rawThinking)
    }
    if (request.maxDepth !== undefined || request.max_depth !== undefined) {
      saveMaxDepth(root, request.maxDepth ?? request.max_depth)
    }
    bumpEventSeq('setAgentsMax')
    const cfgFields = buildClusterConfigFields(resolveCachedSettingsArg(root), next)
    return Object.assign({ ok: true }, cfgFields, {
      source: 'settings',
      limit: MAX_AGENTS_LIMIT,
      note: '已保存为 ' + next + ' 个并发执行智能体，**立即生效**（派活时按新值放行，不用重启 dsh web）。',
    })
  }

  if (request.op === 'setPgUrl') {
    const saved = savePgUrl(root, request.url)
    try { if (store && typeof store.close === 'function') store.close() } catch { /* ignore */ }
    bumpEventSeq('setPgUrl')
    const dbEngine = store && typeof store.dbEngineInfo === 'function' ? store.dbEngineInfo() : resolvePgConfig(root)
    return {
      ok: true,
      url: saved,
      db_engine: dbEngine,
      note: saved ? '已保存 PostgreSQL 连接串并重连引擎池。' : '已清除自定义 PostgreSQL 连接串，回退高并发 WAL 引擎。',
    }
  }

  if (request.op === 'probePg') {
    const cfg = resolvePgConfig(root, process.env, { pgUrl: request.url })
    const probe = probePgConnection(cfg.url || request.url)
    return Object.assign({ db_engine: cfg }, probe)
  }

  /* op === 'agentsStatus' */
  const cfgArg = resolveCachedSettingsArg(root)
  const cfgFields = buildClusterConfigFields(cfgArg)
  const maxSource = maxAgentsSourceOf(cfgArg, process.env)
  const explicitEng = request.engagement || request.engagement_id || request.engagementId || ''
  const hostSessions = await discoverHostSessions(ctx, store, {
    sessionId: request.session,
    engagementId: explicitEng || undefined,
    autoBind: true,
    reqFlow,
    onJsonlAdvance: bumpEventSeq,
  })
  const currentEng = resolveSessionAwareEngagement(explicitEng)
  const dbEngine = store && typeof store.dbEngineInfo === 'function' ? store.dbEngineInfo() : resolvePgConfig(root)
  const synth = synthesizeAgentCollaboration(store, currentEng || null, hostSessions, resolvedRootSession, reqFlow)
  const { budgetGuard, perfMetrics } = computeWorkspaceGuardsAndPerf(store, settingsRoot, currentEng, hostSessions, reqFlow)

  let effectiveChildren = synth.childNodes
  if (currentEng && effectiveChildren.length === 0) {
    effectiveChildren = []
    for (const hs of hostSessions) {
      if (!hs || hs.engagementId !== currentEng) continue
      for (const c of Array.isArray(hs.children) ? hs.children : []) {
        effectiveChildren.push(c)
      }
    }
  }
  const running = effectiveChildren.filter((c) => c.activity === 'running')
  const pgProbe = currentEng
    ? readPgProbe(currentEng)
    : {
      ok: true,
      unbound: true,
      engagement: null,
      engagement_id: null,
      ready: false,
      row_counts: { plan_goals: 0, worker_tasks: 0, worker_digests: 0, shard_locks: 0 },
      total_rows: 0,
    }

  return Object.assign(
    {
      ok: true,
      ...(!currentEng ? { unbound: true } : {}),
      max: cfgFields.max,
      maxAgents: cfgFields.max,
      used: running.length,
      free: Math.max(cfgFields.max - running.length, 0),
      running: running.slice(0, 20),
      children: effectiveChildren,
      total_children: effectiveChildren.length,
      host_sessions: hostSessions,
      hostSessions,
      active_engagement: currentEng || null,
    },
    synthNetworkFields(synth),
    {
      source: maxSource,
      limit: MAX_AGENTS_LIMIT,
      default_max: DEFAULT_MAX_AGENTS,
      thinking: cfgFields.thinkingEffort,
      thinking_effort: cfgFields.thinkingEffort,
      thinkingEffort: cfgFields.thinkingEffort,
      default_thinking_effort: DEFAULT_THINKING_EFFORT,
      valid_thinking_efforts: VALID_THINKING_EFFORTS,
      max_depth: cfgFields.maxDepth,
      maxDepth: cfgFields.maxDepth,
      default_max_depth: DEFAULT_MAX_DEPTH,
      max_depth_limit: MAX_DEPTH_LIMIT,
      db_engine: dbEngine,
      pg_probe: pgProbe,
      budgetGuard,
      budget_guard: budgetGuard,
      perfMetrics,
      perf_metrics: perfMetrics,
      note: currentEng
        ? '同一会话（工程工作区）同时最多 ' + cfgFields.max + ' 个执行智能体；按 4-Wave Bounded DAG 并发调度。'
        : '当前会话尚未绑定工程工作区；初始化后将启用 4-Wave Bounded DAG 并发调度。',
    },
  )
}

/**
 * 沿 `parentSession` 走到根会话 id（最多 64 层，防环）。
 */
export function resolveRootSessionId(ctx, sessionId) {
  const id = unwrapSessionIdValue(sessionId)
  if (!id) return id
  let sessions = null
  try { sessions = ctx.get('sessions') } catch { sessions = null }
  if (sessions === undefined || sessions === null || typeof sessions.list !== 'function') return id
  let list = []
  try { list = sessions.list() } catch { return id }
  const byId = new Map()
  for (const s of Array.isArray(list) ? list : []) {
    const sid = s && s.id !== undefined ? String(s.id) : ''
    if (sid) byId.set(sid, s)
  }
  return resolveRootFromMap(byId, id)
}

const DELTA_SHORT_CIRCUIT_OPS = new Set([
  'agentsStatus',
  'workflowDag',
  'pgWriteProbe',
  'consoleDigest',
  'shardLocks',
  'listShardLocks',
])

const READ_ONLY_STORE_OPS = new Set([
  'bootstrap',
  'consoleDigest',
  'sessionBinding',
  'sessionBindings',
  'stats',
  'snapshot',
  'assets',
  'asset',
  'graph',
  'attackGraph',
  'vulns',
  'vulnStats',
  'credentials',
  'access',
  'sessions',
  'webshells',
  'tunnels',
  'shots',
  'shotData',
  'domains',
  'web',
  'httpEvidence',
  'chain',
  'report',
  'scores',
  'scoreChain',
  'scoreReport',
  'activeTests',
  'testStats',
  'stages',
  'reportTargets',
  'discoveryTimeline',
  'attackFiles',
  'readAttackFile',
  'prompts',
  'dbEngine',
  'pocSearch',
  'pocList',
  'templateSearch',
  'templateStats',
  'pocGet',
  'pocStats',
  'listShardLocks',
  'shardLocks',
  'refineUserWish',
  'probeSessions',
  'perfBenchmark',
])

function isLoopbackHostHeader(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader.trim()) return false
  const h = hostHeader.trim().toLowerCase()
  return /^localhost(?::\d+)?$/.test(h)
    || /^127\.0\.0\.1(?::\d+)?$/.test(h)
    || /^\[::1\](?::\d+)?$/.test(h)
}

function isSameOriginUrl(urlStr, host) {
  if (typeof urlStr !== 'string' || !urlStr || typeof host !== 'string' || !host) return false
  try {
    const parsedHost = new URL(urlStr).host
    return Boolean(parsedHost && parsedHost === host)
  } catch {
    return false
  }
}

function isLoopbackRemote(req) {
  const remote = req && req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : ''
  return remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
}

function isAllowedSseRequest(req) {
  const origin = req.headers && req.headers.origin
  const host = req.headers && req.headers.host
  if (typeof origin === 'string' && origin !== '') {
    return isSameOriginUrl(origin, host)
  }
  const secFetchSite = req.headers && req.headers['sec-fetch-site']
  if (typeof secFetchSite === 'string' && secFetchSite !== '') {
    const sf = secFetchSite.trim().toLowerCase()
    if (sf === 'same-origin' || sf === 'none') return true
    return false
  }
  const referer = req.headers && req.headers.referer
  if (isSameOriginUrl(referer, host)) return true
  return isLoopbackRemote(req) || isLoopbackHostHeader(host)
}

function sendJsonWithSeq(res, status, body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && body.seq === undefined) {
    body = Object.assign({}, body, { seq: eventSeq })
  }
  sendJson(res, status, body)
}

/**
 * @param ctx - 插件上下文（已保证 lmtagent/redteam / webServer / skills / agentPresets 可用）。
 */
export function apply(ctx) {
  const store = resolveStore(ctx)

  ctx.effect(() => {
    const disposers = []
    if (typeof ctx.on === 'function') {
      for (const evtName of ['subagent/start', 'subagent/end']) {
        try {
          const off = ctx.on(evtName, (evtPayload) => {
            const sid = evtPayload && (evtPayload.id || evtPayload.sessionId)
              ? String(evtPayload.id || evtPayload.sessionId)
              : undefined
            bumpEventSeq(evtName, sid ? { sessionId: sid } : null)
          })
          if (typeof off === 'function') disposers.push(off)
        } catch { /* ignore */ }
      }
    }

    const mtimeTimer = setInterval(() => {
      try {
        if (sessionJsonlReader.checkTrackedFilesChanged()) {
          bumpEventSeq('session_mtime')
        }
      } catch { /* ignore */ }
    }, 1500)
    if (mtimeTimer && typeof mtimeTimer.unref === 'function') mtimeTimer.unref()

    return () => {
      clearInterval(mtimeTimer)
      for (const d of disposers) {
        try { d() } catch { /* ignore */ }
      }
      for (const client of Array.from(sseClients)) {
        sseClients.delete(client)
        try { client.end() } catch { /* ignore */ }
      }
    }
  })

  /* GET /lmtagent/events：轻量级 SSE 增量事件流（初始 seq 握手 + 15s 保活心跳） */
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/lmtagent/events',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'GET only' })
        return
      }
      if (!isAllowedSseRequest(req)) {
        sendJson(res, 403, { ok: false, error: 'cross-origin SSE request rejected' })
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      if (typeof res.flushHeaders === 'function') res.flushHeaders()
      res.write(`data: ${JSON.stringify({ seq: eventSeq, connected: true, ts: Date.now() })}\n\n`)
      sseClients.add(res)

      const heartbeat = setInterval(() => {
        if (res.writableEnded || res.destroyed) {
          clearInterval(heartbeat)
          sseClients.delete(res)
          return
        }
        try {
          res.write(': ping\n\n')
        } catch {
          clearInterval(heartbeat)
          sseClients.delete(res)
        }
      }, 15000)
      if (heartbeat && typeof heartbeat.unref === 'function') heartbeat.unref()

      const cleanupClient = () => {
        clearInterval(heartbeat)
        sseClients.delete(res)
      }
      if (typeof req.on === 'function') req.on('close', cleanupClient)
      if (typeof res.on === 'function') {
        res.on('close', cleanupClient)
        res.on('error', cleanupClient)
      }
    },
  }))

  /* POST /lmtagent/api：统一同源 JSON RPC 桥接 */
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/lmtagent/api',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST only' })
        return
      }
      const origin = req.headers.origin
      const host = req.headers.host
      if (typeof origin === 'string' && origin !== '') {
        if (!isSameOriginUrl(origin, host)) {
          sendJson(res, 403, { ok: false, error: 'cross-origin request rejected' })
          return
        }
      } else if (!isLoopbackRemote(req)) {
        sendJson(res, 403, { ok: false, error: 'request without Origin is only accepted from loopback' })
        return
      }
      try {
        const raw = await readBody(req)
        const request = raw.trim() ? JSON.parse(raw) : {}
        if (!request || typeof request !== 'object' || Array.isArray(request)) {
          sendJson(res, 400, { ok: false, error: 'invalid JSON request object' })
          return
        }
        if (request.op === 'engagementOpen') {
          request.op = 'openEngagement'
          if (!request.name && (request.id || request.engagement)) {
            request.name = String(request.id || request.engagement)
          }
        }

        if (
          request.sinceSeq !== undefined
          && request.sinceSeq !== null
          && request.sinceSeq !== ''
          && DELTA_SHORT_CIRCUIT_OPS.has(request.op)
        ) {
          if (Number(request.sinceSeq) === eventSeq && sessionJsonlReader.checkTrackedFilesChanged()) {
            bumpEventSeq('session_mtime')
          }
          if (Number(request.sinceSeq) === eventSeq) {
            sendJson(res, 200, { ok: true, unchanged: true, seq: eventSeq })
            return
          }
        }

        if (request.op === 'openStandaloneWindow') {
          const launchRes = launchStandaloneWindow({
            url: request.url,
            host: req.headers.host,
            session: request.session,
            engagement: request.engagement,
            tab: request.tab,
            width: request.width,
            height: request.height,
          })
          sendJsonWithSeq(res, launchRes.ok ? 200 : 400, launchRes)
          return
        }

        const agentsResult = await handleAgentsOp(ctx, request)
        if (agentsResult !== undefined) {
          sendJsonWithSeq(res, 200, agentsResult)
          return
        }
        const updateResult = await handleUpdateOp(ctx, request, HOST_BUILD_VERSION)
        if (updateResult !== undefined) {
          sendJsonWithSeq(res, 200, updateResult)
          return
        }
        const skillResult = await handleSkillOp(ctx, request)
        if (skillResult !== undefined) {
          sendJsonWithSeq(res, 200, skillResult)
          return
        }

        let hostSessions = null
        const reqFlow = createRequestFlow()
        const isPreDiscoverOp = request.op === 'bootstrap'
          || request.op === 'sessionBinding'
          || request.op === 'sessionBindings'
        if (isPreDiscoverOp) {
          try {
            hostSessions = await discoverHostSessions(ctx, store, {
              sessionId: request.session,
              autoBind: true,
              reqFlow,
              onJsonlAdvance: bumpEventSeq,
            })
          } catch { hostSessions = [] }
        }

        const withRoot = typeof request.session === 'string' && request.session
          ? Object.assign({}, request, { resolveRoot: (sid) => resolveRootSessionId(ctx, sid) })
          : request
        const result = await dispatchAsync(store, withRoot)
        if (request.op && !READ_ONLY_STORE_OPS.has(request.op)) {
          invalidateEngagementCaches(store)
          invalidateSessionBindingsCache(store)
          bumpEventSeq(String(request.op))
        }
        const isPostDiscoverSessionOp = request.op === 'sessionOnboarding'
          || (Boolean(request.session) && (
            request.op === 'openEngagement'
            || request.op === 'bindSessionEngagement'
            || request.op === 'activateEngagement'
          ))
        if (isPostDiscoverSessionOp) {
          try {
            hostSessions = await discoverHostSessions(ctx, store, {
              sessionId: request.session,
              autoBind: true,
              reqFlow: createRequestFlow(),
              onJsonlAdvance: bumpEventSeq,
            })
          } catch { hostSessions = [] }
        }
        handleBootstrap(store, withRoot, result, hostSessions)
        if (
          request.op === 'openEngagement'
          && request.session
          && result
          && typeof result === 'object'
          && store
          && typeof store.getSessionState === 'function'
        ) {
          const rSid = typeof withRoot.resolveRoot === 'function'
            ? withRoot.resolveRoot(request.session)
            : String(request.session)
          const st = store.getSessionState(rSid)
          result.session = request.session
          result.root_session = rSid
          result.bound = st.bound
          result.init_state = st.init_state
          result.onboarding_dismissed = st.onboarding_dismissed
          result.session_binding = st
        }
        if (hostSessions !== null && result && typeof result === 'object') {
          result.host_sessions = hostSessions
        }
        sendJsonWithSeq(res, 200, result)
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error && error.message ? error.message : String(error) })
      }
    },
  }))
}
