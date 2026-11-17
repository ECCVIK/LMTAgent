/**
 * LMTAgent Host Bridge — AI 规划与 LLM JSON 修复子系统
 *
 * 从 lib/index.js 拆出：
 *   - JSON 提取与截断修复（extractBalancedJsonSubstring / tryParseJsonLoose / repairTruncatedJsonObject / extractJsonFromLlmText）
 *   - 模型路由与目录查询（resolveAgentModelRoute / fetchLlmModelCatalog）
 *   - 工作区上下文采样（sampleWorkspaceContext）
 *   - DSH LLM 调用与需求澄清/拆解（invokeDshLlmJson / clarifyWishWithAI / decomposeWishWithAI）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

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

function defaultClampIntInRange(value, minVal, maxVal, fallback) {
  if (value === undefined || value === null || typeof value === 'boolean' || value === '') return fallback
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, minVal), maxVal)
}

export function extractBalancedJsonSubstring(text) {
  const s = String(text || '')
  let start = -1
  let openChar = ''
  let closeChar = ''
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (ch === '{' || ch === '[') {
      start = i
      openChar = ch
      closeChar = ch === '{' ? '}' : ']'
      break
    }
  }
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i += 1) {
    const ch = s[i]
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === openChar) depth += 1
    else if (ch === closeChar) {
      depth -= 1
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

export function tryParseJsonLoose(candidate) {
  const s = String(candidate || '').trim()
  if (!s) return undefined
  try {
    return JSON.parse(s)
  } catch { /* try trailing-comma cleanup */ }
  const noTrailingComma = s.replace(/,\s*([}\]])/g, '$1')
  if (noTrailingComma !== s) {
    try {
      return JSON.parse(noTrailingComma)
    } catch { /* ignore */ }
  }
  return undefined
}

export function repairTruncatedJsonObject(text) {
  const s = String(text || '')
  const start = s.indexOf('{')
  if (start === -1) return undefined
  let candidate = s.slice(start)
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const stack = []
    let inString = false
    let escape = false
    for (let i = 0; i < candidate.length; i += 1) {
      const ch = candidate[i]
      if (inString) {
        if (escape) { escape = false; continue }
        if (ch === '\\') { escape = true; continue }
        if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '{' || ch === '[') stack.push(ch)
      else if (ch === '}' && stack[stack.length - 1] === '{') stack.pop()
      else if (ch === ']' && stack[stack.length - 1] === '[') stack.pop()
    }
    let closed = candidate
    if (inString) {
      if (escape) closed = closed.slice(0, -1)
      closed += '"'
    }
    closed = closed.replace(/,\s*$/, '')
    const suffix = stack.slice().reverse().map((ch) => (ch === '{' ? '}' : ']')).join('')
    const parsed = tryParseJsonLoose(closed + suffix)
    if (parsed && typeof parsed === 'object') return parsed
    const lastComma = candidate.lastIndexOf(',')
    if (lastComma <= 0) break
    candidate = candidate.slice(0, lastComma)
  }
  return undefined
}

export function extractJsonFromLlmText(rawText) {
  const trimmed = String(rawText || '').trim()
  if (!trimmed) throw new Error('模型响应文本为空')

  const withoutThink = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const candidates = withoutThink && withoutThink !== trimmed ? [withoutThink, trimmed] : [trimmed]

  for (const src of candidates) {
    const direct = tryParseJsonLoose(src)
    if (direct !== undefined) return direct

    const fenceRe = /```(?:json|JSON)?\s*\r?\n?([\s\S]*?)```/g
    let match
    while ((match = fenceRe.exec(src)) !== null) {
      const fenced = tryParseJsonLoose(match[1])
      if (fenced !== undefined) return fenced
    }

    const unfenced = src.replace(/^```(?:json|JSON)?\s*\r?\n?/i, '').replace(/```\s*$/, '').trim()
    const balanced = extractBalancedJsonSubstring(unfenced)
    if (balanced) {
      const parsed = tryParseJsonLoose(balanced)
      if (parsed !== undefined) return parsed
    }

    const repaired = repairTruncatedJsonObject(unfenced)
    if (repaired !== undefined) return repaired
  }

  const preview = trimmed.replace(/\s+/g, ' ').slice(0, 120)
  throw new Error(`模型输出未包含合法的 JSON 对象（len=${trimmed.length}，预览：${preview}）`)
}

export function resolveAgentModelRoute(ctx, rootAgent) {
  const sessionProjections = tryGet(ctx, 'sessionProjections')
  if (rootAgent && rootAgent.session) {
    if (sessionProjections && typeof sessionProjections.stateOf === 'function') {
      try {
        const proj = sessionProjections.stateOf(rootAgent.session, 'modelSelection')
        if (proj && proj.pending && proj.pending.provider && proj.pending.model) {
          return {
            provider: String(proj.pending.provider),
            model: String(proj.pending.model),
            reasoningEffort: proj.pending.reasoningEffort ? String(proj.pending.reasoningEffort) : '',
            source: 'sessionProjections.pending',
          }
        }
      } catch { /* ignore */ }
    }
    try {
      const reqCfg = typeof rootAgent.session.requestHeader === 'function'
        ? (rootAgent.session.requestHeader()?.config || null)
        : null
      if (reqCfg && reqCfg.provider && reqCfg.model) {
        return {
          provider: String(reqCfg.provider),
          model: String(reqCfg.model),
          reasoningEffort: reqCfg.reasoningEffort ? String(reqCfg.reasoningEffort) : '',
          source: 'session.requestHeader',
        }
      }
    } catch { /* ignore */ }
    if (sessionProjections && typeof sessionProjections.stateOf === 'function') {
      try {
        const proj = sessionProjections.stateOf(rootAgent.session, 'modelSelection')
        if (proj && proj.lastUsed && proj.lastUsed.provider && proj.lastUsed.model) {
          return {
            provider: String(proj.lastUsed.provider),
            model: String(proj.lastUsed.model),
            reasoningEffort: proj.lastUsed.reasoningEffort ? String(proj.lastUsed.reasoningEffort) : '',
            source: 'sessionProjections.lastUsed',
          }
        }
      } catch { /* ignore */ }
    }
  }
  if (rootAgent && rootAgent.options && rootAgent.options.provider && rootAgent.options.model) {
    return {
      provider: String(rootAgent.options.provider),
      model: String(rootAgent.options.model),
      reasoningEffort: rootAgent.options.reasoningEffort ? String(rootAgent.options.reasoningEffort) : '',
      source: 'agent.options',
    }
  }
  const defaultModelSvc = tryGet(ctx, 'agentDefaultModel')
  if (defaultModelSvc && typeof defaultModelSvc.currentSelection === 'function') {
    try {
      const sel = defaultModelSvc.currentSelection()
      if (sel && sel.provider && sel.model) {
        return {
          provider: String(sel.provider),
          model: String(sel.model),
          reasoningEffort: sel.reasoningEffort ? String(sel.reasoningEffort) : '',
          source: 'agentDefaultModel',
        }
      }
    } catch { /* ignore */ }
  }
  return { provider: '', model: '', reasoningEffort: '', source: 'none' }
}

export async function fetchLlmModelCatalog(ctx) {
  const llm = tryGet(ctx, 'llm')
  if (!llm || typeof llm.listProviders !== 'function') {
    return { available: false, groups: [] }
  }
  let providers = []
  try {
    providers = llm.listProviders() || []
  } catch { providers = [] }
  const groups = await Promise.all(
    (Array.isArray(providers) ? providers : []).map(async (p) => {
      if (!p || !p.id) return null
      let models = []
      if (typeof llm.listModels === 'function') {
        try { models = await llm.listModels(p.id) } catch { models = [] }
      }
      return {
        id: String(p.id),
        name: String(p.name || p.id),
        models: (Array.isArray(models) ? models : []).map((m) => ({
          id: String(m.id),
          name: String(m.name || m.id),
          ...(m.description ? { description: String(m.description) } : {}),
        })),
      }
    }),
  )
  return {
    available: true,
    groups: groups.filter(Boolean),
  }
}

const WORKSPACE_SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', '.next', '.nuxt',
  '.cache', 'coverage', '.turbo', 'tmp', '.venv', 'venv', '__pycache__', '.idea',
])

export function sampleWorkspaceContext(ctx, rootAgent, cwdOverride = '', options = {}) {
  const scanEnabled = options.scanRepoContext !== undefined ? Boolean(options.scanRepoContext) : true
  let resolvedCwd = typeof cwdOverride === 'string' ? cwdOverride.trim() : ''
  if (!resolvedCwd && rootAgent && rootAgent.session && rootAgent.session.header && rootAgent.session.header.cwd) {
    resolvedCwd = String(rootAgent.session.header.cwd).trim()
  }
  if (!resolvedCwd && options.sessionId) {
    const sessionsSvc = tryGet(ctx, 'sessions')
    if (sessionsSvc) {
      try {
        const direct = typeof sessionsSvc.get === 'function' ? sessionsSvc.get(options.sessionId) : null
        if (direct && direct.header && direct.header.cwd) resolvedCwd = String(direct.header.cwd).trim()
      } catch { /* ignore */ }
      if (!resolvedCwd && typeof sessionsSvc.list === 'function') {
        try {
          const hit = (sessionsSvc.list() || []).find((s) => s && String(s.id) === String(options.sessionId))
          if (hit) resolvedCwd = String((hit.header && hit.header.cwd) || hit.cwd || '').trim()
        } catch { /* ignore */ }
      }
    }
    if (!resolvedCwd && options.store) {
      const bound = typeof options.getCachedSessionBindingEntry === 'function'
        ? options.getCachedSessionBindingEntry(options.store, options.sessionId)
        : (typeof options.store.getSessionState === 'function' ? options.store.getSessionState(options.sessionId) : null)
      if (bound && bound.cwd) resolvedCwd = String(bound.cwd).trim()
    }
  }
  if (!scanEnabled || !resolvedCwd || !existsSync(resolvedCwd)) {
    return { cwd: resolvedCwd, summary: '', entries: [] }
  }
  try {
    const st = statSync(resolvedCwd)
    if (!st.isDirectory()) return { cwd: resolvedCwd, summary: '', entries: [] }
  } catch {
    return { cwd: resolvedCwd, summary: '', entries: [] }
  }

  const lines = [`工作区根目录: ${resolvedCwd}`]
  const treeLines = []
  const topEntries = []
  try {
    const dirents = readdirSync(resolvedCwd, { withFileTypes: true })
      .filter((d) => d && d.name && !WORKSPACE_SKIP_DIRS.has(d.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .slice(0, 40)
    for (const d of dirents) {
      if (d.isDirectory()) {
        topEntries.push(`${d.name}/`)
        treeLines.push(`- ${d.name}/`)
        try {
          const sub = readdirSync(join(resolvedCwd, d.name), { withFileTypes: true })
            .filter((sd) => sd && sd.name && !WORKSPACE_SKIP_DIRS.has(sd.name))
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
            .slice(0, 20)
          for (const sd of sub) {
            const rel = `${d.name}/${sd.name}${sd.isDirectory() ? '/' : ''}`
            topEntries.push(rel)
            treeLines.push(`  - ${rel}`)
          }
        } catch { /* ignore unreadable subdir */ }
      } else {
        topEntries.push(d.name)
        treeLines.push(`- ${d.name}`)
      }
    }
  } catch { /* ignore */ }

  if (treeLines.length > 0) {
    lines.push('目录结构（1-2 层）:')
    lines.push(...treeLines.slice(0, 90))
  }

  const pkgPath = join(resolvedCwd, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg && typeof pkg === 'object') {
        const pkgBrief = {
          name: pkg.name || undefined,
          description: pkg.description || undefined,
          workspaces: pkg.workspaces || undefined,
          scripts: pkg.scripts ? Object.keys(pkg.scripts).slice(0, 12) : undefined,
          dependencies: pkg.dependencies ? Object.keys(pkg.dependencies).slice(0, 20) : undefined,
          devDependencies: pkg.devDependencies ? Object.keys(pkg.devDependencies).slice(0, 15) : undefined,
        }
        lines.push('package.json 概要: ' + JSON.stringify(pkgBrief))
      }
    } catch { /* ignore */ }
  }

  for (const readmeName of ['README.md', 'readme.md', 'README.zh.md']) {
    const rp = join(resolvedCwd, readmeName)
    if (existsSync(rp)) {
      try {
        const rawReadme = readFileSync(rp, 'utf8').trim()
        if (rawReadme) {
          lines.push(`${readmeName} 节选:\n${rawReadme.slice(0, 1400)}`)
          break
        }
      } catch { /* ignore */ }
    }
  }

  let summary = lines.join('\n')
  const MAX_BYTES = 6000
  if (Buffer.byteLength(summary, 'utf8') > MAX_BYTES) {
    let end = Math.min(summary.length, MAX_BYTES)
    while (end > 0 && Buffer.byteLength(summary.slice(0, end), 'utf8') > MAX_BYTES - 32) {
      end -= 64
    }
    summary = summary.slice(0, Math.max(0, end)) + '\n... (已按 6KB 上限截断)'
  }

  return {
    cwd: resolvedCwd,
    summary,
    entries: topEntries,
  }
}

export async function invokeDshLlmJson(ctx, { sessionId, system, prompt, maxTokens = 4096, signal } = {}, deps = {}) {
  const llm = tryGet(ctx, 'llm')
  if (!llm || (typeof llm.prepareCall !== 'function' && typeof llm.stream !== 'function')) {
    return {
      ok: false,
      llm_unavailable: true,
      error: '当前宿主未注册 DSH LLM 服务（ctx.get("llm") 不可用），无法调用大模型生成方案。',
    }
  }

  const resolveSettingsRoot = deps.resolveRedteamSettingsRoot || ((r) => (typeof r === 'string' ? r : ''))
  const readSettings = deps.readUnifiedSettings || (() => ({ aiPlanner: deps.defaultAiPlannerSettings || {} }))
  const clampInt = deps.clampIntInRange || defaultClampIntInRange
  const resolveRootAgent = deps.resolveLiveRootAgent || (async (c, sid) => {
    const agentsSvc = tryGet(c, 'agents')
    return (agentsSvc && typeof agentsSvc.get === 'function' && sid) ? agentsSvc.get(sid) : null
  })

  const settingsRoot = resolveSettingsRoot(tryGet(ctx, 'redteam')?.root)
  const settings = readSettings(settingsRoot, process.env)
  const aiCfg = settings.aiPlanner || deps.defaultAiPlannerSettings || {
    modelMode: 'inherit',
    provider: '',
    model: '',
    reasoningEffort: '',
    timeoutMs: 60000,
    scanRepoContext: true,
    customConstraints: '',
  }

  let route
  let effort = ''
  if (aiCfg.modelMode === 'custom' && aiCfg.provider && aiCfg.model) {
    route = {
      provider: aiCfg.provider,
      model: aiCfg.model,
      source: 'settings.custom',
    }
    effort = aiCfg.reasoningEffort || ''
  } else {
    const rootAgent = await resolveRootAgent(ctx, sessionId)
    route = resolveAgentModelRoute(ctx, rootAgent)
    effort = route.reasoningEffort || aiCfg.reasoningEffort || ''
  }

  if (!route || !route.provider || !route.model) {
    return {
      ok: false,
      llm_unavailable: true,
      error: '未解析到有效的 DSH 模型路由（provider/model 为空）。请先在主会话中选定模型，或在设置页配置自定义 AI Planner 模型。',
    }
  }

  const userMsg = deepFreezeObj({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(prompt || '') }],
    source: { kind: 'redteam-planner' },
  })

  const timeoutMs = clampInt(aiCfg.timeoutMs, 50, 300000, 60000)
  const ownTimeout = AbortSignal.timeout(timeoutMs)
  const timeoutSignal = (signal && typeof AbortSignal.any === 'function')
    ? AbortSignal.any([signal, ownTimeout])
    : (signal || ownTimeout)

  const wantEffort = (effort && effort !== 'none' && effort !== 'off') ? effort : ''

  try {
    let call
    if (typeof llm.prepareCall === 'function') {
      const prepareWithEffort = (eff) => llm.prepareCall(
        { provider: route.provider, model: route.model, maxTokens },
        timeoutSignal,
        (controls, modelInfo) => {
          if (!eff) return { ...controls }
          const efforts = modelInfo && modelInfo.reasoning && modelInfo.reasoning.efforts
          if (Array.isArray(efforts) && efforts.length > 0 && !efforts.some((e) => e && e.id === eff)) {
            return { ...controls }
          }
          if (modelInfo && modelInfo.id && modelInfo.reasoning === undefined) {
            return { ...controls }
          }
          return { ...controls, reasoningEffort: eff }
        },
      )

      try {
        call = await prepareWithEffort(wantEffort)
      } catch (prepErr) {
        const errCode = prepErr && (prepErr.code || (prepErr.failure && prepErr.failure.code))
        const errMsg = prepErr && prepErr.message ? String(prepErr.message) : ''
        if (wantEffort && (errCode === 'UNSUPPORTED_REASONING_EFFORT' || /UNSUPPORTED_REASONING_EFFORT|reasoning.?effort/i.test(errMsg))) {
          call = await prepareWithEffort('')
        } else {
          throw prepErr
        }
      }
    } else {
      call = {
        config: { provider: route.provider, model: route.model, maxTokens },
        stream: (opts) => llm.stream(opts),
      }
    }

    const options = deepFreezeObj({
      ...call.config,
      messages: [userMsg],
      system: String(system || ''),
      purpose: 'redteam-planner',
      signal: timeoutSignal,
    })

    const deltasByIndex = new Map()
    const blocksByIndex = new Map()
    const indexOrder = []
    let finishReason = ''
    const ensureIndex = (idx) => {
      const key = idx ?? 0
      if (!deltasByIndex.has(key) && !blocksByIndex.has(key)) indexOrder.push(key)
      return key
    }

    for await (const chunk of call.stream(options)) {
      if (!chunk || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta') {
        const key = ensureIndex(chunk.index)
        deltasByIndex.set(key, (deltasByIndex.get(key) || '') + String(chunk.text || ''))
      } else if (chunk.type === 'block-end') {
        if (chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') {
          const key = ensureIndex(chunk.index)
          blocksByIndex.set(key, chunk.block.text)
        }
      } else if (chunk.type === 'finish') {
        const kind = chunk.reason && chunk.reason.kind
        if (kind) finishReason = String(kind)
        if (kind === 'error' || kind === 'aborted') {
          const failure = chunk.reason.failure || {}
          const errMsg = failure.message || chunk.reason.message || (typeof chunk.reason.error === 'string' ? chunk.reason.error : '') || `LLM 调用异常终止 (${kind})`
          const err = new Error(errMsg)
          if (failure.code || chunk.reason.code) err.code = failure.code || chunk.reason.code
          throw err
        }
      }
    }

    const assembledText = indexOrder
      .map((k) => (blocksByIndex.has(k) ? blocksByIndex.get(k) : (deltasByIndex.get(k) || '')))
      .join('')
      .trim()

    if (!assembledText) {
      return {
        ok: false,
        llm_unavailable: true,
        provider: route.provider,
        model: `${route.provider}/${route.model}`,
        error: `大模型（${route.provider}/${route.model}）返回内容为空（finish=${finishReason || 'unknown'}），未生成结构化 JSON。`,
      }
    }

    let parsed
    try {
      parsed = extractJsonFromLlmText(assembledText)
    } catch (parseErr) {
      const msg = parseErr && parseErr.message ? parseErr.message : String(parseErr)
      throw new Error(finishReason ? `${msg}（finish=${finishReason}）` : msg)
    }
    return {
      ok: true,
      data: parsed,
      rawText: assembledText,
      provider: route.provider,
      model: `${route.provider}/${route.model}`,
      modelId: route.model,
      reasoningEffort: (call.config && call.config.reasoningEffort) || '',
      routeSource: route.source,
    }
  } catch (err) {
    const errMsg = err && err.message ? err.message : String(err)
    const isTimeout = Boolean(err && (err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout|aborted/i.test(errMsg)))
    return {
      ok: false,
      llm_unavailable: true,
      provider: route.provider,
      model: `${route.provider}/${route.model}`,
      error: isTimeout
        ? `大模型请求超时（${timeoutMs}ms，模型 ${route.provider}/${route.model}）：${errMsg}`
        : `大模型调用或 JSON 解析失败（${route.provider}/${route.model}）：${errMsg}`,
    }
  }
}

export async function clarifyWishWithAI(ctx, store, opts = {}, deps = {}) {
  const promptText = String(opts.prompt || '').trim()
  if (!promptText) {
    return { ok: false, op: 'clarifyWishWithAI', error: '请先输入工程需求描述后再执行 AI 需求澄清。' }
  }
  const resolveSettingsRoot = deps.resolveRedteamSettingsRoot || ((r) => (typeof r === 'string' ? r : ''))
  const readSettings = deps.readUnifiedSettings || (() => ({ aiPlanner: { scanRepoContext: true, customConstraints: '' } }))
  const resolveRootAgent = deps.resolveLiveRootAgent || (async () => null)
  const checkRealHost = deps.isRealDshHost || (() => false)

  const settingsRoot = resolveSettingsRoot(store && store.root)
  const settings = readSettings(settingsRoot, process.env)
  const rootAgent = await resolveRootAgent(ctx, opts.sessionId)
  const wsCtx = sampleWorkspaceContext(ctx, rootAgent, opts.cwd, {
    scanRepoContext: settings.aiPlanner.scanRepoContext,
    sessionId: opts.sessionId,
    store,
    getCachedSessionBindingEntry: deps.getCachedSessionBindingEntry,
  })

  const system = [
    '你是 LMTAgent 软件工程多智能体集群的 AI 规划分析师。',
    '根据用户的原始工程需求与工作区代码上下文，提出 2-4 个高价值的工程澄清问题（如目标形态、数据持久化/接口契约、测试门禁与架构约束），帮助用户在派发多智能体前消除关键歧义。',
    '必须只输出严格的 JSON 对象，不要包含额外解释文本：',
    '{',
    '  "detected_context": "一句话概述探测到的项目技术栈、已有目录结构或纯新建工程判断",',
    '  "questions": [',
    '    {',
    '      "id": "q1",',
    '      "question": "具体中文澄清问题",',
    '      "multi": false,',
    '      "options": [',
    '        { "label": "简短选项名称（含推荐标注）", "value": "可拼接进工程需求规格的完整约束描述" }',
    '      ]',
    '    }',
    '  ]',
    '}',
  ].join('\n')

  const promptParts = [`【用户原始需求】\n${promptText}`]
  if (wsCtx.summary) promptParts.push(`【工作区上下文采样】\n${wsCtx.summary}`)
  if (settings.aiPlanner.customConstraints) {
    promptParts.push(`【全局自定义工程约束】\n${settings.aiPlanner.customConstraints}`)
  }

  const llmRes = await invokeDshLlmJson(ctx, {
    sessionId: opts.sessionId,
    system,
    prompt: promptParts.join('\n\n'),
    maxTokens: 2048,
    signal: opts.signal,
  }, deps)

  if (!llmRes.ok) {
    const allowFallback = Boolean(opts.allowStaticFallback) && !checkRealHost(ctx)
    if (!allowFallback) return Object.assign({ op: 'clarifyWishWithAI' }, llmRes)
    return {
      ok: true,
      op: 'clarifyWishWithAI',
      fallback_used: true,
      model: 'static-test-fallback',
      detected_context: wsCtx.summary ? `已扫描目录 ${wsCtx.cwd}` : '测试环境静态回退上下文',
      cwd: wsCtx.cwd || '',
      questions: [
        {
          id: 'q1',
          question: '请确认本次交付的核心工程形态与运行边界：',
          multi: false,
          options: [
            { label: '模块化标准库实现（推荐）', value: '优先复用现有目录与零外部依赖方案，补齐单元测试。' },
            { label: '全栈接口与界面联动', value: '同时实现后端数据持久化、RPC 接口与前端交互视图。' },
          ],
        },
      ],
    }
  }

  const data = llmRes.data && typeof llmRes.data === 'object' ? llmRes.data : {}
  const rawQuestions = Array.isArray(data.questions) ? data.questions : []
  const questions = rawQuestions
    .filter((q) => q && typeof q === 'object' && (q.question || q.title))
    .slice(0, 6)
    .map((q, idx) => ({
      id: String(q.id || `q-${idx + 1}`),
      question: String(q.question || q.title).trim(),
      multi: Boolean(q.multi ?? q.is_multi_select),
      options: (Array.isArray(q.options) ? q.options : [])
        .map((opt) => {
          if (typeof opt === 'string') return { label: opt, value: opt }
          if (!opt || typeof opt !== 'object') return null
          const label = String(opt.label || opt.text || opt.value || '').trim()
          const value = String(opt.value || opt.snippet || opt.label || '').trim()
          return label ? { label, value: value || label } : null
        })
        .filter(Boolean),
    }))

  return {
    ok: true,
    op: 'clarifyWishWithAI',
    model: llmRes.model,
    provider: llmRes.provider,
    detected_context: String(data.detected_context || data.detectedContext || (wsCtx.cwd ? `已探测工作区：${wsCtx.cwd}` : '通用软件工程上下文')).trim(),
    cwd: wsCtx.cwd || '',
    questions,
  }
}

export async function decomposeWishWithAI(ctx, store, opts = {}, deps = {}) {
  const promptText = String(opts.prompt || '').trim()
  const resolveSettingsRoot = deps.resolveRedteamSettingsRoot || ((r) => (typeof r === 'string' ? r : ''))
  const readSettings = deps.readUnifiedSettings || (() => ({
    maxAgents: 6,
    maxDepth: 3,
    thinkingEffort: 'low',
    aiPlanner: { scanRepoContext: true, customConstraints: '' },
  }))
  const resolveRootAgent = deps.resolveLiveRootAgent || (async () => null)
  const normalizeGoal = deps.normalizeWishGoalItem || ((g) => g)

  const settingsRoot = resolveSettingsRoot(store && store.root)
  const settings = readSettings(settingsRoot, process.env)
  const rootAgent = await resolveRootAgent(ctx, opts.sessionId)
  const wsCtx = sampleWorkspaceContext(ctx, rootAgent, opts.cwd, {
    scanRepoContext: settings.aiPlanner.scanRepoContext,
    sessionId: opts.sessionId,
    store,
    getCachedSessionBindingEntry: deps.getCachedSessionBindingEntry,
  })

  const system = [
    '你是 LMTAgent 软件工程多智能体集群的首席架构师（AI Planner）。',
    '请把用户需求拆解为可立即由多智能体并行落地的 4-Wave Bounded DAG 蓝图（按需 3-8 个任务，简单需求精简、复杂工程充实），严格遵守 File-Disjoint Sharding（同一波次及并行子任务之间的 files_owned 绝对不能有文件路径/通配符交集）。',
    '可用执行角色（role）与波次对应关系：',
    '- wave 1: recon（需求/代码库测绘与数据源核验）、designer（UI/UX 设计令牌与交互规范）',
    '- wave 2: assess（架构契约冻结与无交集分片锁定）',
    `- wave 3: exploit（全栈研发构建分片，Wave 3 并发数不超过 ${settings.maxAgents}，每个分片独占互不重叠的 files_owned）`,
    '- wave 4: vuln-scan（代码审查与安全审计）、qa（自动化测试与构建门禁）、internal（文档与发布归档）',
    '若提供了真实工作区目录结构，files_owned 必须尽可能贴合该仓库真实存在或合理的路径！',
    '禁止输出 <think>、解释性文字或 Markdown 代码块围栏，直接以 { 开头、以 } 结尾；每个字段保持简洁精炼，避免冗长截断。',
    '必须只输出严格合法的 JSON 对象，结构如下：',
    '{',
    '  "project_name": "简明中文/英文工程名",',
    '  "refined_prompt": "润色后的完整结构化工程规格说明",',
    '  "summary": "一句话总结 4-Wave 分片交付策略",',
    '  "clarifications": ["关键边界确认要点1", "要点2"],',
    '  "deliverables": ["核心交付物1", "交付物2"],',
    '  "goals": [',
    '    {',
    '      "wave": 1,',
    '      "role": "recon",',
    '      "title": "Wave 1 · 任务简明标题",',
    '      "assigned_goal": "包含上下文、范围与完成标准的自包含执行指令",',
    '      "files_owned": ["exact/path/or/dir/**"],',
    '      "acceptance_criteria": "可核验的验收测试或交付判据"',
    '    }',
    '  ]',
    '}',
  ].join('\n')

  const promptParts = [`【用户工程需求】\n${promptText}`]
  if (opts.template) promptParts.push(`【期望模板风格】${opts.template}`)
  if (opts.clarificationsText) promptParts.push(`【用户澄清补充】\n${opts.clarificationsText}`)
  if (wsCtx.summary) promptParts.push(`【工作区上下文采样】\n${wsCtx.summary}`)
  if (settings.aiPlanner.customConstraints) {
    promptParts.push(`【全局自定义工程约束】\n${settings.aiPlanner.customConstraints}`)
  }
  promptParts.push(`【集群并发配额】maxAgents=${settings.maxAgents}, maxDepth=${settings.maxDepth}, thinkingEffort=${settings.thinkingEffort}`)

  const llmRes = await invokeDshLlmJson(ctx, {
    sessionId: opts.sessionId,
    system,
    prompt: promptParts.join('\n\n'),
    maxTokens: 8192,
    signal: opts.signal,
  }, deps)

  if (!llmRes.ok) {
    return Object.assign({ cwd: wsCtx.cwd || '' }, llmRes)
  }

  const raw = llmRes.data && typeof llmRes.data === 'object' ? llmRes.data : {}
  const rawList = Array.isArray(raw.goals) && raw.goals.length > 0
    ? raw.goals
    : (Array.isArray(raw.proposed_waves) && raw.proposed_waves.length > 0
      ? raw.proposed_waves
      : (Array.isArray(raw.waves) ? raw.waves : []))

  if (rawList.length === 0) {
    return {
      ok: false,
      llm_unavailable: true,
      model: llmRes.model,
      provider: llmRes.provider,
      error: `大模型（${llmRes.model}）返回的 JSON 缺少有效的 goals 任务列表。`,
    }
  }

  const goals = rawList.map((g, idx) => normalizeGoal(g, idx))
  const projectName = String(raw.project_name || raw.projectName || raw.title || '').trim()
  const refinedPrompt = String(raw.refined_prompt || raw.refinedPrompt || promptText).trim()
  const summary = String(
    raw.summary || `已由 ${llmRes.model} 拆解为 ${goals.length} 个无冲突并发子任务。`,
  ).trim()

  return {
    ok: true,
    ai_generated: true,
    model: llmRes.model,
    provider: llmRes.provider,
    cwd: wsCtx.cwd || '',
    project_name: projectName,
    refined_prompt: refinedPrompt,
    summary,
    clarifications: Array.isArray(raw.clarifications) ? raw.clarifications.map(String) : [],
    deliverables: Array.isArray(raw.deliverables) ? raw.deliverables.map(String) : [],
    goals,
  }
}
