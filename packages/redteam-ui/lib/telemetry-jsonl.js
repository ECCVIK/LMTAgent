/**
 * LMTAgent Host Bridge — 增量 JSONL 读取、TokenMeter 遥测聚合、拓扑合成与 1:1 会话发现子系统（零外部依赖）
 *
 * 从 lib/index.js 拆出：
 *   - 增量 JSONL 游标读取器（IncrementalSessionJsonlReader / sessionJsonlReader）
 *   - 原生 TokenMeter 与会话消息摘要提取（readHostTokenMeter / extractSessionPreviews / extractPathsFromToolCall）
 *   - lmtex 优先级与压缩摘要计算（computeWorkerLmtexMeta / approvedWorkerOverrides）
 *   - O(N) 根会话解析与跨工作区零泄漏发现（resolveRootFromMap / discoverHostSessions / synthesizeAgentCollaboration / extractAgentSessionDetail）
 */
import { closeSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import * as coreMod from '../../redteam-store/lib/core.js'
import {
  HOST_META_TTL_MS,
  getCachedActiveEngagementId,
  getCachedEngagementsList,
  getCachedSessionBindingEntry,
  invalidateSessionBindingsCache,
} from './settings-bridge.js'

const { dispatch } = coreMod

/**
 * 判断会话标题或工作区名称是否为自动生成的原始 UUID 会话名（如 `session-c510422c-...`）。
 */
export function isUuidSessionTitle(str) {
  const s = String(str || '').trim()
  if (!s) return false
  return /^(?:[a-z0-9_-]+\s*[·-]\s*)?session-[0-9a-f]{8}-[0-9a-f]{4}/i.test(s)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    || /(?:^|[·\s_-])session-[0-9a-f]{8}-[0-9a-f]{4}/i.test(s)
}

export function isUuidEngagement(eng) {
  if (!eng || typeof eng !== 'object') return false
  return isUuidSessionTitle(eng.id) || isUuidSessionTitle(eng.name)
}

function isEngagementEmpty(eng) {
  if (!eng || typeof eng !== 'object' || !eng.stats) return true
  const st = eng.stats
  return (Number(st.assets) || 0) === 0
    && (Number(st.vulns) || 0) === 0
    && (Number(st.credentials) || 0) === 0
    && (Number(st.accesses) || 0) === 0
}

export function filterValidEngagements(engagements) {
  const list = Array.isArray(engagements) ? engagements : []
  const realNamed = list.filter((e) => e && !isUuidEngagement(e))
  if (realNamed.length === 0) return list
  return list.filter((e) => e && (!isUuidEngagement(e) || !isEngagementEmpty(e)))
}

export function buildValidEngagementMap(allEngagements) {
  const validEngagements = filterValidEngagements(Array.isArray(allEngagements) ? allEngagements : [])
  const byId = new Map()
  for (const e of validEngagements) {
    if (!e || !e.id) continue
    if (isUuidEngagement(e) && isUuidSessionTitle(e.id) && isUuidSessionTitle(e.name)) continue
    byId.set(String(e.id), e)
  }
  return byId
}

export const AGENT_ROLE_META = {
  plan: {
    role: 'plan',
    badge: '主控',
    wave: 0,
    color: '#4d6bfe',
    defaultTitle: '主控指挥 Captain',
    promptFallback: '拆解用户需求意图，按 4-Wave Bounded DAG 派发子智能体并聚合 PostgreSQL 事实库回报。',
  },
  designer: {
    role: 'designer',
    badge: 'WD',
    wave: 1,
    color: '#ef4444',
    defaultTitle: 'Wave1 designer 交互与令牌',
    promptFallback: 'Wave 1 交互与视觉设计（Designer）：输出组件树、设计令牌（Design Tokens）与四态交互规范。',
  },
  recon: {
    role: 'recon',
    badge: 'WR',
    wave: 1,
    color: '#10b981',
    defaultTitle: 'Wave1 recon 产品与数据源',
    promptFallback: 'Wave 1 产品与需求规划（CEO）：全量模块拓扑与数据源测绘，标注 P0/P1 核心边界并写入事实库。',
  },
  assess: {
    role: 'assess',
    badge: 'WA',
    wave: 2,
    color: '#8b5cf6',
    defaultTitle: 'Wave2 assess 架构与分片',
    promptFallback: 'Wave 2 系统架构与排期（Eng Manager）：锁死接口契约与文件无交集的并发开发分片。',
  },
  exploit: {
    role: 'exploit',
    badge: 'WB',
    wave: 3,
    color: '#3b82f6',
    defaultTitle: 'Wave3 exploit 全栈研发与构建',
    promptFallback: 'Wave 3 全栈研发与构建（Builder）：按独占文件分片并行编码实现、自测验证并回写事实库。',
  },
  'vuln-scan': {
    role: 'vuln-scan',
    badge: 'WC',
    wave: 4,
    color: '#f59e0b',
    defaultTitle: 'Wave4 vuln-scan 代码审查与安全',
    promptFallback: 'Wave 4 代码审查与安全（Reviewer & CSO）：审查逻辑回归、IPC/安全边界与质量红线。',
  },
  qa: {
    role: 'qa',
    badge: 'WQ',
    wave: 4,
    color: '#06b6d4',
    defaultTitle: 'Wave4 qa 质量保障与测试',
    promptFallback: 'Wave 4 质量保障与测试（QA Lead）：执行全量自动化回归测试套件与性能基准核验。',
  },
  internal: {
    role: 'internal',
    badge: 'WI',
    wave: 4,
    color: '#6366f1',
    defaultTitle: 'Wave4 internal 文档工程与发布',
    promptFallback: 'Wave 4 文档工程与发布（Doc & Release）：同步架构交付文档、CHANGELOG 与最终发布归档。',
  },
}

export function inferAgentRole(titleOrLabel, isRoot = false, explicitRole = '') {
  if (isRoot) return 'plan'
  const exp = String(explicitRole || '').trim().toLowerCase()
  if (exp && AGENT_ROLE_META[exp]) return exp
  const s = String(titleOrLabel || '').trim()
  if (!s) return 'exploit'
  if (/designer|交互|视觉|令牌|design|\bwd\b/i.test(s)) return 'designer'
  if (/recon|\bceo\b|产品|数据源|需求|测绘|\bwr\b/i.test(s)) return 'recon'
  if (/assess|架构|分片|契约|排期|\bwa\b/i.test(s)) return 'assess'
  if (/vuln[-_]?scan|\breview(?:er)?\b|\bcso\b|审查|安全|审计|\bwc\b/i.test(s)) return 'vuln-scan'
  if (/\bqa\b|测试|质量|回归|benchmark|\bwq\b/i.test(s)) return 'qa'
  if (/internal|\brelease\b|\bdoc(?:s|ument)?\b|文档|发布|归档|\bwi\b/i.test(s)) return 'internal'
  if (/exploit|\bbuilder\b|研发|构建|编码|开发|shard|\bwb\b/i.test(s)) return 'exploit'
  if (/wave\s*1/i.test(s)) return 'recon'
  if (/wave\s*2/i.test(s)) return 'assess'
  if (/wave\s*3/i.test(s)) return 'exploit'
  if (/wave\s*4/i.test(s)) return 'qa'
  return 'exploit'
}

export function inferAgentWave(titleOrLabel, role, isRoot = false) {
  if (isRoot || role === 'plan') return 0
  const m = /wave\s*([0-4])/i.exec(String(titleOrLabel || ''))
  if (m) return Number(m[1])
  return (AGENT_ROLE_META[role] && AGENT_ROLE_META[role].wave) ?? 3
}

export function parseTimestampMs(val) {
  if (val === undefined || val === null || val === '') return 0
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val < 1e12 ? val * 1000 : val
  }
  const num = Number(val)
  if (Number.isFinite(num) && num > 0) {
    return num < 1e12 ? num * 1000 : num
  }
  const parsed = Date.parse(String(val))
  return Number.isFinite(parsed) ? parsed : 0
}

export function formatDurationLabel(durationMs) {
  const ms = Math.max(0, Number(durationMs) || 0)
  if (ms <= 0) return '0s'
  const totalSec = Math.max(1, Math.round(ms / 1000))
  if (totalSec < 60) return `${totalSec}s`
  const hours = Math.floor(totalSec / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  const secs = totalSec % 60
  if (hours > 0) return `${hours}h${mins}m${secs > 0 ? secs + 's' : ''}`
  return `${mins}m${secs > 0 ? secs + 's' : ''}`
}

export function getSessionMessages(s) {
  if (!s || typeof s !== 'object') return []
  if (Array.isArray(s.messages)) return s.messages
  if (Array.isArray(s.entries)) return s.entries
  if (Array.isArray(s.history)) return s.history
  return []
}

export function getMessageRole(msg, fallbackKind = '') {
  if (!msg || typeof msg !== 'object') return String(fallbackKind || '').toLowerCase()
  return String(msg.role || msg.sender || msg.author || msg.type || fallbackKind || '').toLowerCase()
}

export function getMessageToolCalls(msg, { includeNamedPart = false } = {}) {
  if (!msg || typeof msg !== 'object') return []
  const out = []
  const tcs = msg.toolCalls || msg.tool_calls
  if (Array.isArray(tcs)) {
    for (const tc of tcs) out.push(tc)
  }
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part && typeof part === 'object'
        && (part.type === 'tool_use' || part.type === 'tool-call' || part.toolName || (includeNamedPart && part.name))) {
        out.push(part)
      }
    }
  }
  return out
}

export function getToolCallMeta(tc) {
  const obj = tc && typeof tc === 'object' ? tc : {}
  const name = String(
    obj.name || obj.toolName || obj.tool_name || (obj.function && obj.function.name) || 'workspace.tool',
  ).trim() || 'workspace.tool'
  const rawInput = obj.input ?? obj.arguments ?? obj.args ?? (obj.function && obj.function.arguments) ?? null
  return { name, rawInput }
}

export function extractMessageText(msg) {
  if (!msg) return ''
  if (typeof msg === 'string') return msg.replace(/\s+/g, ' ').trim()
  const raw = msg.content ?? msg.text ?? msg.body ?? msg.message ?? ''
  if (typeof raw === 'string' && raw.trim()) return raw.replace(/\s+/g, ' ').trim()
  if (Array.isArray(raw)) {
    const joined = raw.map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      if (typeof part.text === 'string') return part.text
      if (typeof part.content === 'string') return part.content
      if (part.type === 'tool_use' || part.type === 'tool-call' || part.name) {
        return `[工具调用] ${part.name || part.toolName || ''}`
      }
      return ''
    }).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
    if (joined) return joined
  }
  const tcs = msg.toolCalls || msg.tool_calls
  if (Array.isArray(tcs) && tcs.length > 0) {
    const names = tcs.map((t) => getToolCallMeta(t).name || 'tool').join(', ')
    return `[工具调用] ${names}`
  }
  return ''
}

export function extractSessionPreviews(s, header, role, fallbackOutput = '') {
  const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.exploit
  const messages = getSessionMessages(s)

  let promptText = String(
    (s && (s.promptPreview || s.prompt || s.delegationPrompt || s.task || s.input))
    || (header && (header.prompt || header.task || header.description))
    || ''
  ).replace(/\s+/g, ' ').trim()

  if (!promptText && messages.length > 0) {
    const firstUser = messages.find((m) => m && getMessageRole(m) === 'user') || messages[0]
    promptText = extractMessageText(firstUser)
  }
  if (!promptText) promptText = meta.promptFallback

  let outputText = String(
    (s && (s.latestOutputPreview || s.outputPreview || s.latestOutput || s.result || s.summary))
    || (header && (header.summary || header.latestOutput))
    || ''
  ).replace(/\s+/g, ' ').trim()

  if (!outputText && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]
      if (!m) continue
      const r = getMessageRole(m)
      if (r === 'assistant' || r === 'model' || r === 'tool' || (i > 0 && r !== 'user')) {
        const txt = extractMessageText(m)
        if (txt) {
          outputText = txt
          break
        }
      }
    }
  }
  if (!outputText) outputText = String(fallbackOutput || '').replace(/\s+/g, ' ').trim()

  return {
    promptPreview: promptText.slice(0, 160),
    latestOutputPreview: outputText.slice(0, 160),
  }
}

/* ------------------------------------------------------------------ 增量会话 JSONL 读取器 (Bounded LRU = 128) 与原生 tokenMeter 集成 */

const JSONL_LRU_MAX = 128
const JSONL_LARGE_THRESHOLD = 262144 // 256 KB
const JSONL_HEAD_BYTES = 16384 // 16 KB
const JSONL_TAIL_BYTES = 131072 // 128 KB
const JSONL_MAX_DELTA_BYTES = 524288 // 512 KB
const WRITE_EDIT_TOOL_RE = /(?:^|[._-])(?:write|edit|replace|patch|create_file|save_file|str_replace|apply_patch|apply_diff|notebook_edit|add_attack_file)(?:$|[._-])/i

export function normalizeTouchedFilePath(rawPath) {
  if (typeof rawPath !== 'string') return ''
  let p = rawPath.trim().replace(/^file:\/\//i, '').replace(/^['"`]+|['"`]+$/g, '').trim()
  if (!p || p.length > 260 || p.includes('\n') || p.includes('\0')) return ''
  p = p.replace(/\\/g, '/')
  const pkgIdx = p.indexOf('packages/')
  if (pkgIdx >= 0) return p.slice(pkgIdx)
  const srcIdx = p.indexOf('/src/')
  if (srcIdx >= 0) return p.slice(srcIdx + 1)
  const parts = p.split('/').filter(Boolean)
  if (parts.length > 3) return parts.slice(-3).join('/')
  return p
}

export function extractPathsFromToolCall(toolName, rawArgs, outSet) {
  if (!toolName && !rawArgs) return
  const nameStr = String(toolName || '').trim()
  const isWriteLike = WRITE_EDIT_TOOL_RE.test(nameStr) || /write|edit|replace|patch/i.test(nameStr)
  if (!isWriteLike) return
  let argsObj = rawArgs
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim()
    if (trimmed.startsWith('{')) {
      try { argsObj = JSON.parse(trimmed) } catch { argsObj = null }
    }
    if (!argsObj) {
      const patchRe = /\*\*\*\s+(?:Update|Add)\s+File:\s+([^\r\n]+)/g
      let pm
      while ((pm = patchRe.exec(trimmed)) !== null) {
        const norm = normalizeTouchedFilePath(pm[1])
        if (norm && outSet.size < 12) outSet.add(norm)
      }
      return
    }
  }
  if (!argsObj || typeof argsObj !== 'object') return
  const candidates = [
    argsObj.TargetFile,
    argsObj.target_file,
    argsObj.targetFile,
    argsObj.file_path,
    argsObj.filePath,
    argsObj.filepath,
    argsObj.path,
    argsObj.filename,
    argsObj.file,
    argsObj.uri,
  ]
  for (const c of candidates) {
    const norm = normalizeTouchedFilePath(c)
    if (norm && outSet.size < 12) outSet.add(norm)
  }
  if (Array.isArray(argsObj.files)) {
    for (const f of argsObj.files) {
      const norm = normalizeTouchedFilePath(typeof f === 'string' ? f : (f && (f.path || f.file_path || f.TargetFile)))
      if (norm && outSet.size < 12) outSet.add(norm)
    }
  }
}

export class IncrementalSessionJsonlReader {
  constructor(maxEntries = JSONL_LRU_MAX) {
    this.maxEntries = Math.max(8, Number(maxEntries) || JSONL_LRU_MAX)
    this.cache = new Map() // filePath -> cursor entry (LRU ordered)
    this.dirIndexCache = new Map() // dirPath -> { at, mtimeNs, byId: Map<sid, filePath> }
  }

  resolveDirs(store = null) {
    const dirs = []
    const addDir = (d) => {
      if (!d || typeof d !== 'string') return
      try {
        const resolved = resolve(d)
        if (!dirs.includes(resolved)) dirs.push(resolved)
      } catch { /* ignore */ }
    }
    if (process.env.DSH_SESSIONS_DIR) addDir(process.env.DSH_SESSIONS_DIR)
    if (process.env.DSH_HOME) addDir(join(process.env.DSH_HOME, 'sessions'))
    try { addDir(join(homedir(), '.dsh', 'sessions')) } catch { /* ignore */ }
    if (store && typeof store.root === 'string' && store.root) {
      addDir(join(dirname(store.root), 'sessions'))
      addDir(join(store.root, 'sessions'))
    }
    return dirs
  }

  _indexDir(dir) {
    const now = Date.now()
    const cached = this.dirIndexCache.get(dir)
    const st = statSync(dir, { bigint: true, throwIfNoEntry: false })
    if (!st || !st.isDirectory()) {
      if (cached && cached.missing && (now - cached.at) < HOST_META_TTL_MS) return cached.byId
      const empty = new Map()
      this.dirIndexCache.set(dir, { at: now, missing: true, mtimeNs: -1n, byId: empty })
      return empty
    }
    if (cached && !cached.missing && cached.mtimeNs === st.mtimeNs) {
      cached.at = now
      return cached.byId
    }
    const byId = new Map()
    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const ent of entries) {
        const full = join(dir, ent.name)
        if (ent.isFile() && ent.name.endsWith('.jsonl')) {
          const baseId = ent.name.slice(0, -6)
          if (baseId) byId.set(baseId, full)
        } else if (ent.isDirectory()) {
          for (const subName of ['session.jsonl', 'transcript.jsonl', 'messages.jsonl', `${ent.name}.jsonl`]) {
            const subPath = join(full, subName)
            const subSt = statSync(subPath, { throwIfNoEntry: false })
            if (subSt && subSt.isFile()) {
              byId.set(ent.name, subPath)
              break
            }
          }
        }
      }
    } catch { /* ignore dir read failure */ }
    this.dirIndexCache.set(dir, { at: now, missing: false, mtimeNs: st.mtimeNs, byId })
    return byId
  }

  locateSessionFile(sessionId, options = {}) {
    if (options.explicitPath && typeof options.explicitPath === 'string') {
      const st = statSync(options.explicitPath, { throwIfNoEntry: false })
      if (st && st.isFile()) return options.explicitPath
    }
    const sid = String(sessionId || '').trim()
    if (!sid || sid.startsWith('sub-') || sid === 'root' || sid === 'root-main') return null
    const dirs = Array.isArray(options.dirs) && options.dirs.length > 0
      ? options.dirs
      : this.resolveDirs(options.store || null)
    for (const dir of dirs) {
      const idx = this._indexDir(dir)
      const exact = idx.get(sid)
      if (exact) return exact
      const directCandidate = join(dir, `${sid}.jsonl`)
      const directSt = statSync(directCandidate, { throwIfNoEntry: false })
      if (directSt && directSt.isFile()) {
        idx.set(sid, directCandidate)
        return directCandidate
      }
      for (const [k, fp] of idx.entries()) {
        if (k.endsWith(sid) || sid.endsWith(k)) return fp
      }
    }
    return null
  }

  _touchLru(filePath, entry) {
    this.cache.delete(filePath)
    this.cache.set(filePath, entry)
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey === undefined) break
      this.cache.delete(oldestKey)
    }
  }

  _createAccumulator() {
    return {
      header: {},
      model: '',
      cwd: '',
      delegationPrompt: '',
      lastAssistantText: '',
      userMessages: 0,
      hasHeadUser: false,
      turns: 0,
      steps: 0,
      toolCalls: 0,
      sumInputTokens: 0,
      sumOutputTokens: 0,
      sumReasoningTokens: 0,
      sumCacheReadTokens: 0,
      sumUncachedInputTokens: 0,
      explicitTotalTokens: 0,
      contextTokens: 0,
      contextMax: 0,
      explicitCost: 0,
      firstTimestampMs: 0,
      lastTimestampMs: 0,
      filesTouchedSet: new Set(),
      toolsSet: new Set(),
      firstDelegateStep: null,
      recentSteps: [],
    }
  }

  _foldEntry(acc, obj, isHeadPass = false) {
    if (!obj || typeof obj !== 'object') return
    const ts = parseTimestampMs(
      obj.timestamp ?? obj.created_at ?? obj.createdAt ?? obj.ts ?? obj.time ?? (obj.message && obj.message.timestamp),
    )
    if (ts > 0) {
      if (acc.firstTimestampMs === 0 || ts < acc.firstTimestampMs) acc.firstTimestampMs = ts
      if (ts > acc.lastTimestampMs) acc.lastTimestampMs = ts
    }

    const kind = String(obj.type || obj.kind || '').toLowerCase()
    if (kind === 'header' || kind === 'session' || kind === 'meta' || kind === 'init' || obj.header) {
      const h = (obj.header && typeof obj.header === 'object') ? obj.header : obj
      acc.header = Object.assign({}, acc.header, h)
      if (!acc.model && h.model) acc.model = String(h.model)
      if (!acc.cwd && (h.cwd || h.workspace || h.projectDir)) {
        acc.cwd = String(h.cwd || h.workspace || h.projectDir)
      }
      if (!acc.delegationPrompt && (h.prompt || h.delegationPrompt || h.task)) {
        acc.delegationPrompt = String(h.prompt || h.delegationPrompt || h.task).replace(/\s+/g, ' ').trim()
      }
    }

    const msg = (obj.message && typeof obj.message === 'object') ? obj.message : obj
    if (!acc.model && msg.model) acc.model = String(msg.model)
    const role = String(msg.role || obj.role || obj.sender || kind || '').toLowerCase()

    const u = msg.usage || obj.usage || obj.tokenUsage || obj.stats || (obj.result && obj.result.usage) || null
    if (u && typeof u === 'object') {
      const inTok = Number(u.inputTokens ?? u.input_tokens ?? u.promptTokens ?? u.prompt_tokens ?? 0) || 0
      const outTok = Number(u.outputTokens ?? u.output_tokens ?? u.completionTokens ?? u.completion_tokens ?? 0) || 0
      const reasonTok = Number(u.reasoningTokens ?? u.reasoning_tokens ?? u.thinkingTokens ?? u.thinking_tokens ?? 0) || 0
      const cacheRead = Number(
        u.cacheReadTokens ?? u.cache_read_tokens ?? u.cacheReadInputTokens ?? u.cache_read_input_tokens
        ?? u.cachedTokens ?? u.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0,
      ) || 0
      const cacheCreate = Number(u.cacheWriteTokens ?? u.cache_creation_input_tokens ?? u.prompt_cache_miss_tokens ?? 0) || 0
      const totTok = Number(u.totalTokens ?? u.total_tokens ?? u.tokens ?? 0) || 0
      const ctxWin = Number(u.contextWindow ?? u.maxContextTokens ?? u.context_window ?? 0) || 0
      const ctxTok = Number(u.contextTokens ?? u.currentContextTokens ?? 0) || 0
      const costVal = Number(u.cost ?? u.costYuan ?? u.totalCost ?? 0) || 0

      if (!isHeadPass) {
        if (kind === 'summary' || kind === 'session_summary' || u.cumulative === true) {
          acc.explicitTotalTokens = Math.max(acc.explicitTotalTokens, totTok, inTok + outTok)
          acc.sumInputTokens = Math.max(acc.sumInputTokens, inTok)
          acc.sumOutputTokens = Math.max(acc.sumOutputTokens, outTok)
          acc.sumReasoningTokens = Math.max(acc.sumReasoningTokens, reasonTok)
          acc.sumCacheReadTokens = Math.max(acc.sumCacheReadTokens, cacheRead)
        } else {
          acc.sumInputTokens += inTok
          acc.sumOutputTokens += outTok
          acc.sumReasoningTokens += reasonTok
          acc.sumCacheReadTokens += cacheRead
          acc.sumUncachedInputTokens += Math.max(0, cacheCreate > 0 ? cacheCreate : (inTok - cacheRead))
          if (totTok > acc.explicitTotalTokens && inTok === 0 && outTok === 0) {
            acc.explicitTotalTokens = totTok
          }
        }
        const turnContext = ctxTok > 0 ? ctxTok : (inTok + cacheRead + outTok)
        if (turnContext > 0) acc.contextTokens = turnContext
        if (ctxWin > 0) acc.contextMax = ctxWin
        if (costVal > 0) acc.explicitCost = Math.max(acc.explicitCost, costVal)
      }
    }

    const text = extractMessageText(msg)
    if (role === 'user' || role === 'human') {
      if (!acc.delegationPrompt && text) {
        acc.delegationPrompt = text
      }
      if (!acc.firstDelegateStep && text) {
        acc.firstDelegateStep = {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收任务委派与上下文指令',
          inputSummary: text.slice(0, 180),
          outputSummary: '已完成上下文装载与分片边界确认。',
          status: 'done',
        }
      }
      if (isHeadPass) {
        acc.hasHeadUser = true
      } else {
        acc.userMessages += 1
        acc.turns += 1
        acc.steps += 1
      }
      return
    }

    if (isHeadPass) return

    const rawToolCalls = getMessageToolCalls(msg)
    if (kind === 'tool_call' || kind === 'tool_use' || obj.tool_name || obj.toolName) {
      rawToolCalls.push(obj)
    }

    if (rawToolCalls.length > 0) {
      acc.toolCalls += rawToolCalls.length
      acc.steps += 1
      if ((role === 'assistant' || role === 'model') && text && !text.startsWith('[工具调用]')) {
        const cleanedText = text.replace(/\s*\[工具调用\][^\n]*$/g, '').trim()
        if (cleanedText) acc.lastAssistantText = cleanedText
      }
      for (const tc of rawToolCalls) {
        if (!tc || typeof tc !== 'object') continue
        const { name: tName, rawInput: tArgs } = getToolCallMeta(tc)
        if (tName && acc.toolsSet.size < 16) acc.toolsSet.add(tName)
        extractPathsFromToolCall(tName, tArgs, acc.filesTouchedSet)
        const argPreview = typeof tArgs === 'string'
          ? tArgs
          : (tArgs && typeof tArgs === 'object' ? JSON.stringify(tArgs) : '')
        acc.recentSteps.push({
          phase: 'execute',
          tool: tName,
          title: `调用工具 ${tName}`,
          inputSummary: (argPreview || `执行 ${tName}`).replace(/\s+/g, ' ').trim().slice(0, 180),
          outputSummary: (text && !text.startsWith('[工具调用]') ? text : '工具调用已执行并同步上下文。').slice(0, 180),
          status: 'done',
        })
        if (acc.recentSteps.length > 8) acc.recentSteps.shift()
      }
    } else if (role === 'assistant' || role === 'model') {
      acc.steps += 1
      if (acc.turns === 0) acc.turns = 1
      if (text) {
        acc.lastAssistantText = text
        acc.recentSteps.push({
          phase: 'execute',
          tool: 'agent.reasoning',
          title: '阶段推理与产物输出',
          inputSummary: '综合当前代码上下文与契约约束推进实现',
          outputSummary: text.slice(0, 180),
          status: 'done',
        })
        if (acc.recentSteps.length > 8) acc.recentSteps.shift()
      }
    }
  }

  _foldBufferLines(acc, buf, isHeadPass = false) {
    if (!buf || buf.length === 0) return Buffer.alloc(0)
    const endsWithNewline = buf[buf.length - 1] === 0x0a
    const lastNl = buf.lastIndexOf(0x0a)
    let completePart = buf
    let remainder = Buffer.alloc(0)

    if (!endsWithNewline) {
      const trailing = lastNl >= 0 ? buf.subarray(lastNl + 1) : buf
      const trailingStr = trailing.toString('utf8').trim()
      if (trailingStr) {
        let validJson = null
        try { validJson = JSON.parse(trailingStr) } catch { validJson = null }
        if (validJson && typeof validJson === 'object') {
          completePart = lastNl >= 0 ? buf.subarray(0, lastNl) : Buffer.alloc(0)
          if (completePart.length > 0) {
            const lines = completePart.toString('utf8').split('\n')
            for (const line of lines) {
              const t = line.trim()
              if (!t) continue
              try { this._foldEntry(acc, JSON.parse(t), isHeadPass) } catch { /* skip malformed line */ }
            }
          }
          this._foldEntry(acc, validJson, isHeadPass)
          return Buffer.alloc(0)
        }
        remainder = Buffer.from(trailing)
      }
      completePart = lastNl >= 0 ? buf.subarray(0, lastNl) : Buffer.alloc(0)
    }

    if (completePart.length > 0) {
      const text = completePart.toString('utf8')
      const lines = text.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          this._foldEntry(acc, parsed, isHeadPass)
        } catch { /* skip malformed line */ }
      }
    }
    return remainder
  }

  _materializeTelemetry(acc, st, filePath) {
    const totalTokens = Math.max(acc.explicitTotalTokens, acc.sumInputTokens + acc.sumOutputTokens)
    const stepSummaries = []
    if (acc.firstDelegateStep) stepSummaries.push(acc.firstDelegateStep)
    for (const rs of acc.recentSteps.slice(-4)) stepSummaries.push(rs)
    const effectiveUserMessages = acc.userMessages || (acc.hasHeadUser ? 1 : 0)
    const effectiveTurns = acc.turns > 0
      ? acc.turns
      : ((acc.hasHeadUser || acc.steps > 0 || totalTokens > 0) ? 1 : 0)
    return {
      filePath,
      mtimeMs: st.mtimeMs,
      size: st.size,
      header: acc.header,
      model: acc.model,
      cwd: acc.cwd,
      delegationPrompt: acc.delegationPrompt,
      lastAssistantText: acc.lastAssistantText,
      userMessages: effectiveUserMessages,
      turns: effectiveTurns,
      steps: acc.steps,
      toolCalls: acc.toolCalls,
      inputTokens: acc.sumInputTokens,
      outputTokens: acc.sumOutputTokens,
      reasoningTokens: acc.sumReasoningTokens,
      cacheReadTokens: acc.sumCacheReadTokens,
      uncachedInputTokens: acc.sumUncachedInputTokens,
      totalTokens,
      contextTokens: acc.contextTokens,
      contextMax: acc.contextMax,
      explicitCost: acc.explicitCost,
      firstTimestampMs: acc.firstTimestampMs,
      lastTimestampMs: acc.lastTimestampMs,
      filesTouched: Array.from(acc.filesTouchedSet),
      tools: Array.from(acc.toolsSet),
      stepSummaries,
    }
  }

  readFile(filePath) {
    if (!filePath || typeof filePath !== 'string') return null
    const st = statSync(filePath, { throwIfNoEntry: false })
    if (!st || !st.isFile()) {
      this.cache.delete(filePath)
      return null
    }

    const cur = this.cache.get(filePath)
    if (cur && cur.ino === st.ino && cur.size === st.size && cur.mtimeMs === st.mtimeMs) {
      this._touchLru(filePath, cur)
      return Object.assign({ didAdvance: false }, cur.telemetry)
    }

    if (cur && cur.ino === st.ino && st.size > cur.parsedOffset) {
      let fd = -1
      try {
        fd = openSync(filePath, 'r')
        const rawDelta = st.size - cur.parsedOffset
        const readLen = Math.min(JSONL_MAX_DELTA_BYTES, rawDelta)
        const readOffset = st.size - readLen
        const buf = Buffer.allocUnsafe(readLen)
        const bytesRead = readSync(fd, buf, 0, readLen, readOffset)
        let chunk = buf.subarray(0, bytesRead)
        if (readOffset > cur.parsedOffset) {
          const firstNl = chunk.indexOf(0x0a)
          chunk = firstNl >= 0 ? chunk.subarray(firstNl + 1) : Buffer.alloc(0)
        } else if (cur.remainderBuf && cur.remainderBuf.length > 0) {
          chunk = Buffer.concat([cur.remainderBuf, chunk])
        }
        const remainderBuf = this._foldBufferLines(cur.acc, chunk, false)
        const telemetry = this._materializeTelemetry(cur.acc, st, filePath)
        const updated = {
          ino: st.ino,
          size: st.size,
          mtimeMs: st.mtimeMs,
          parsedOffset: st.size,
          remainderBuf,
          acc: cur.acc,
          telemetry,
        }
        this._touchLru(filePath, updated)
        return Object.assign({ didAdvance: true }, telemetry)
      } catch {
        return cur ? Object.assign({ didAdvance: false }, cur.telemetry) : null
      } finally {
        if (fd >= 0) {
          try { closeSync(fd) } catch { /* ignore */ }
        }
      }
    }

    const acc = this._createAccumulator()
    let remainderBuf = Buffer.alloc(0)
    if (st.size > 0) {
      let fd = -1
      try {
        fd = openSync(filePath, 'r')
        if (st.size > JSONL_LARGE_THRESHOLD) {
          const headBuf = Buffer.allocUnsafe(JSONL_HEAD_BYTES)
          const headRead = readSync(fd, headBuf, 0, JSONL_HEAD_BYTES, 0)
          const headSlice = headBuf.subarray(0, headRead)
          const lastHeadNl = headSlice.lastIndexOf(0x0a)
          const cleanHead = lastHeadNl >= 0 ? headSlice.subarray(0, lastHeadNl + 1) : headSlice
          this._foldBufferLines(acc, cleanHead, true)

          const tailLen = Math.min(JSONL_TAIL_BYTES, st.size)
          const tailOffset = st.size - tailLen
          const tailBuf = Buffer.allocUnsafe(tailLen)
          const tailRead = readSync(fd, tailBuf, 0, tailLen, tailOffset)
          let tailSlice = tailBuf.subarray(0, tailRead)
          if (tailOffset > 0) {
            const firstNl = tailSlice.indexOf(0x0a)
            tailSlice = firstNl >= 0 ? tailSlice.subarray(firstNl + 1) : Buffer.alloc(0)
          }
          remainderBuf = this._foldBufferLines(acc, tailSlice, false)
        } else {
          const buf = Buffer.allocUnsafe(st.size)
          const bytesRead = readSync(fd, buf, 0, st.size, 0)
          remainderBuf = this._foldBufferLines(acc, buf.subarray(0, bytesRead), false)
        }
      } catch {
        return null
      } finally {
        if (fd >= 0) {
          try { closeSync(fd) } catch { /* ignore */ }
        }
      }
    }

    const telemetry = this._materializeTelemetry(acc, st, filePath)
    const entry = {
      ino: st.ino,
      size: st.size,
      mtimeMs: st.mtimeMs,
      parsedOffset: st.size,
      remainderBuf,
      acc,
      telemetry,
    }
    this._touchLru(filePath, entry)
    return Object.assign({ didAdvance: Boolean(cur) }, telemetry)
  }

  readSession(sessionId, options = {}, rawSession = null) {
    let normOpts = {}
    const isStoreLike = Boolean(
      rawSession !== null
      || (
        options
        && typeof options === 'object'
        && !Array.isArray(options)
        && (
          typeof options.workflowDag === 'function'
          || typeof options.listEngagements === 'function'
          || typeof options.activeEngagementId === 'function'
          || (typeof options.root === 'string' && options.dirs === undefined && options.explicitPath === undefined && options.store === undefined)
        )
      ),
    )
    if (isStoreLike) {
      const explicitPath = extractExplicitJsonlPath(rawSession) || undefined
      normOpts = {
        store: (options && typeof options === 'object') ? options : null,
        explicitPath,
      }
    } else if (options && typeof options === 'object') {
      normOpts = Object.assign({}, options)
      if (!normOpts.explicitPath && normOpts.session) {
        const extracted = extractExplicitJsonlPath(normOpts.session)
        if (extracted) normOpts.explicitPath = extracted
      }
    }
    const filePath = this.locateSessionFile(sessionId, normOpts)
    if (!filePath) return null
    return this.readFile(filePath)
  }

  checkTrackedFilesChanged() {
    let changed = false
    for (const [filePath, cur] of Array.from(this.cache.entries())) {
      const st = statSync(filePath, { throwIfNoEntry: false })
      if (!st || !st.isFile()) {
        this.cache.delete(filePath)
        changed = true
        continue
      }
      if (st.ino !== cur.ino || st.size !== cur.size || st.mtimeMs !== cur.mtimeMs) {
        changed = true
      }
    }
    return changed
  }
}

export const sessionJsonlReader = new IncrementalSessionJsonlReader(JSONL_LRU_MAX)

function extractExplicitJsonlPath(s) {
  if (!s || typeof s !== 'object') return null
  const h = s.header || {}
  const candidate = s.jsonlPath || s.transcriptPath || s.filePath || s.logPath || s.path
    || h.jsonlPath || h.transcriptPath || h.filePath || h.logPath || h.path || null
  return typeof candidate === 'string' && candidate.endsWith('.jsonl') ? candidate : null
}

export function readHostTokenMeter(tokenMeter, sessionId) {
  const sid = String(sessionId || '').trim()
  if (!tokenMeter || !sid) return null
  let raw = null
  try {
    if (typeof tokenMeter.getSessionUsage === 'function') raw = tokenMeter.getSessionUsage(sid)
    else if (typeof tokenMeter.getUsage === 'function') raw = tokenMeter.getUsage(sid)
    else if (typeof tokenMeter.session === 'function') raw = tokenMeter.session(sid)
    else if (typeof tokenMeter.summary === 'function') raw = tokenMeter.summary(sid)
    else if (typeof tokenMeter.get === 'function') raw = tokenMeter.get(sid)
    else if (tokenMeter.bySession instanceof Map) raw = tokenMeter.bySession.get(sid)
    else if (tokenMeter.sessions && typeof tokenMeter.sessions === 'object') raw = tokenMeter.sessions[sid]
    else if (typeof tokenMeter.snapshot === 'function') {
      const snap = tokenMeter.snapshot()
      raw = (snap && snap.sessions && snap.sessions[sid]) || (snap && snap[sid]) || null
    }
  } catch { raw = null }
  if (!raw || typeof raw !== 'object' || typeof raw.then === 'function') return null
  const u = (raw.usage && typeof raw.usage === 'object') ? Object.assign({}, raw, raw.usage) : raw
  return {
    inputTokens: Number(u.inputTokens ?? u.input_tokens ?? u.promptTokens ?? u.prompt_tokens ?? 0) || 0,
    outputTokens: Number(u.outputTokens ?? u.output_tokens ?? u.completionTokens ?? u.completion_tokens ?? 0) || 0,
    reasoningTokens: Number(u.reasoningTokens ?? u.reasoning_tokens ?? u.thinkingTokens ?? u.thinking_tokens ?? 0) || 0,
    cacheReadTokens: Number(
      u.cacheReadTokens ?? u.cache_read_tokens ?? u.cacheReadInputTokens ?? u.cache_read_input_tokens
      ?? u.cachedTokens ?? u.cached_tokens ?? u.prompt_cache_hit_tokens ?? 0,
    ) || 0,
    uncachedInputTokens: Number(u.uncachedInputTokens ?? u.prompt_cache_miss_tokens ?? 0) || 0,
    totalTokens: Number(u.totalTokens ?? u.total_tokens ?? u.tokens ?? 0) || 0,
    cacheHitPct: u.cacheHitPct ?? u.cacheHitRate ?? u.cache_hit_pct ?? undefined,
    contextTokens: Number(u.contextTokens ?? u.context_tokens ?? u.currentContextTokens ?? 0) || 0,
    contextMax: Number(u.contextWindow ?? u.maxContextTokens ?? u.context_window ?? u.contextMax ?? 0) || 0,
    cost: Number(u.cost ?? u.costYuan ?? u.totalCost ?? u.cost_yuan ?? 0) || 0,
  }
}

const WORKER_OVERRIDES_LRU_MAX = 256
export const approvedWorkerOverrides = new Map()
export const approvedWorkerMap = approvedWorkerOverrides

export function isBareRoleName(key) {
  const k = String(key || '').trim().toLowerCase()
  return Boolean(k && AGENT_ROLE_META[k])
}

export function setScopedWorkerOverride(engagementId, workerId, entry) {
  const eng = String(engagementId || 'default').trim() || 'default'
  const wid = String(workerId || '').trim()
  if (!wid || isBareRoleName(wid)) return false
  const scopedKey = `${eng}::${wid}`
  approvedWorkerOverrides.delete(scopedKey)
  approvedWorkerOverrides.set(scopedKey, entry)
  while (approvedWorkerOverrides.size > WORKER_OVERRIDES_LRU_MAX) {
    const oldest = approvedWorkerOverrides.keys().next().value
    if (oldest === undefined) break
    approvedWorkerOverrides.delete(oldest)
  }
  return true
}

export function deleteScopedWorkerOverride(engagementId, workerId) {
  const eng = String(engagementId || 'default').trim() || 'default'
  const wid = String(workerId || '').trim()
  if (!wid) return
  approvedWorkerOverrides.delete(`${eng}::${wid}`)
}

export const PRIORITY_META = {
  P0: { uiPriority: 'P0', priorityWeight: 100, priorityLabel: 'P0 焦点审批' },
  P1: { uiPriority: 'P1', priorityWeight: 80, priorityLabel: 'P1 核心并发' },
  P2: { uiPriority: 'P2', priorityWeight: 50, priorityLabel: 'P2 已审归档' },
  P3: { uiPriority: 'P3', priorityWeight: 20, priorityLabel: 'P3 历史快照' },
}

export const ERROR_STATUS_SET = new Set(['error', 'failed', 'blocked', 'timeout', 'shard_violation'])

function lookupApprovedWorkerOverride(node, store = null, explicitEngagementId = '') {
  if (!node || typeof node !== 'object') return null
  const eng = String(
    explicitEngagementId
    || node.engagement_id
    || node.engagementId
    || (store ? getCachedActiveEngagementId(store) : '')
    || 'default',
  ).trim() || 'default'

  const candidateIds = [
    node.worker_task_id,
    node.workerTaskId,
    node.worker_id,
    node.workerId,
    node.id,
    node.sessionId,
    node.session_id,
    node.agentId,
  ]
  for (const rawKey of candidateIds) {
    const k = String(rawKey || '').trim()
    if (!k || isBareRoleName(k)) continue
    const scopedKey = `${eng}::${k}`
    if (approvedWorkerOverrides.has(scopedKey)) {
      const val = approvedWorkerOverrides.get(scopedKey)
      approvedWorkerOverrides.delete(scopedKey)
      approvedWorkerOverrides.set(scopedKey, val)
      return val
    }
  }
  return null
}

export function parseJsonArraySafe(raw) {
  if (Array.isArray(raw)) return raw.map((x) => String(x || '').trim()).filter(Boolean)
  if (typeof raw === 'string' && raw.trim()) {
    const t = raw.trim()
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t)
        if (Array.isArray(arr)) return arr.map((x) => String(x || '').trim()).filter(Boolean)
      } catch { /* ignore */ }
    }
    return t.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)
  }
  return []
}

function inferWorkerFilesTouched(node, textCorpus) {
  if (node && typeof node === 'object') {
    const direct = parseJsonArraySafe(
      node.filesTouched
      ?? node.files_touched
      ?? node.files_touched_json
      ?? (node.workerDigest && (node.workerDigest.files_touched || node.workerDigest.files_touched_json))
      ?? (node.compressedDigest && node.compressedDigest.filesTouched),
    )
    if (direct.length > 0) return direct.slice(0, 8)
    const owned = parseJsonArraySafe(node.filesOwned ?? node.files_owned ?? node.files_owned_json)
    if (owned.length > 0) return owned.slice(0, 8)
  }
  if (typeof textCorpus === 'string' && textCorpus.trim()) {
    const matches = []
    const fileRe = /(?:^|[\s`'"([,:])((?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_-]+\.(?:js|mjs|cjs|ts|tsx|jsx|css|scss|html|json|sql|md|yml|yaml|py|go|rs|sh))\b/g
    let m
    while ((m = fileRe.exec(textCorpus)) !== null) {
      const cleaned = normalizeTouchedFilePath(m[1])
      if (cleaned && !matches.includes(cleaned)) matches.push(cleaned)
      if (matches.length >= 6) break
    }
    if (matches.length > 0) return matches
  }
  return []
}

function cleanSessionShortId(sid) {
  const s = String(sid || '').trim()
  if (!s) return ''
  const stripped = s.replace(/^(?:[a-z0-9_-]*[·-])?session-/i, '')
  return (stripped || s).slice(0, 6)
}

/**
 * 确定性计算 `lmtex`（`1 Plan + N Workers`）优先级标签、压缩摘要（`compressedDigest`）与审批状态（`approvalState`）。
 */
export function computeWorkerLmtexMeta(node, idx = 0, options = {}) {
  const n = node && typeof node === 'object' ? node : {}
  const isRoot = Boolean(n.isRoot || n.role === 'plan')
  const role = inferAgentRole(n.title || n.label || n.name || n.id || '', isRoot, n.role)
  const waveRaw = n.wave
  let parsedWave = NaN
  if (typeof waveRaw === 'number') parsedWave = waveRaw
  else if (typeof waveRaw === 'string' && waveRaw.trim()) {
    const wm = /(\d+)/.exec(waveRaw)
    if (wm) parsedWave = Number(wm[1])
  }
  const waveNum = Number.isFinite(parsedWave)
    ? parsedWave
    : inferAgentWave(n.title || n.label || n.name || '', role, isRoot)
  const effectiveWave = Number.isFinite(waveNum) && waveNum >= 0 ? waveNum : 3

  const rawStatus = String(n.status || '').trim().toLowerCase()
  const rawActivity = String(n.activity || '').trim().toLowerCase()
  const isError = ERROR_STATUS_SET.has(rawStatus)
    || ERROR_STATUS_SET.has(rawActivity)
    || Boolean(n.shardViolation || n.shard_violation)
  const isRunning = !isError && (
    rawStatus === 'running'
    || rawStatus === 'run'
    || rawStatus === 'active'
    || rawStatus === 'in_progress'
    || rawActivity === 'running'
    || rawActivity === 'run'
  )

  const rawTurnsVal = n.turns ?? n.rounds
  const turns = (
    rawTurnsVal === 0
    && !isRunning
    && Number(n.tokens || 0) === 0
    && Number(n.steps || 0) === 0
    && Number(n.userMessages || n.user_messages || 0) === 0
  )
    ? 0
    : Math.max(1, Number(rawTurnsVal ?? 1) || 1)
  let toolCalls = 0
  if (n.toolCalls !== undefined || n.tool_calls !== undefined) {
    const tcRaw = n.toolCalls ?? n.tool_calls
    toolCalls = Array.isArray(tcRaw) ? tcRaw.length : Math.max(0, Number(tcRaw) || 0)
  } else if (Array.isArray(n.messages) && n.messages.length > 0) {
    let counted = 0
    for (const msg of n.messages) {
      counted += getMessageToolCalls(msg, { includeNamedPart: true }).length
    }
    toolCalls = counted > 0 ? counted : Math.max(0, Number(n.steps) || 0)
  } else if (Number(n.steps) > 0) {
    const stepVal = Number(n.steps) || 0
    toolCalls = (effectiveWave >= 4 && stepVal <= 4 && !isRunning && !isError) ? 2 : stepVal
  }

  const hasSubstantiveWork = isRunning
    || isError
    || rawStatus === 'completed'
    || rawStatus === 'done'
    || rawStatus === 'finished'
    || rawActivity === 'completed'
    || Number(n.tokens) > 0
    || Number(n.steps) > 0
    || toolCalls > 0
    || (rawStatus === '' && (Number(n.turns) > 0 || n.toolCalls !== undefined || n.completionConclusion || n.actionSummary || n.lastAssistantText))
  const isIdle = !isRunning && !isError && (
    rawStatus === 'idle'
    || rawStatus === 'interrupted'
    || rawActivity === 'interrupted'
    || rawStatus === 'planned'
    || rawStatus === 'queued'
    || rawStatus === 'standby'
    || (!hasSubstantiveWork && (rawStatus === 'pending' || rawStatus === ''))
  )
  const isCompleted = !isRunning && !isError && !isIdle

  const override = lookupApprovedWorkerOverride(n, options.store || null, options.engagementId || '')
  const rawCallerApproval = String(n.approvalState || n.approval_state || '').trim()
  const normalizedCallerApproval = rawCallerApproval === 'working'
    ? (isRunning ? 'in_progress' : (isError ? 'revision_required' : null))
    : (['approved', 'revision_required', 'pending_approval', 'in_progress'].includes(rawCallerApproval) ? rawCallerApproval : null)
  const explicitCallerApproval = !options.recomputeApproval && !n._autoApproval ? normalizedCallerApproval : null

  let approvalState = 'approved'
  let autoApproval = false
  if (override && override.approvalState) {
    approvalState = override.approvalState
  } else if (isError) {
    approvalState = 'revision_required'
  } else if (explicitCallerApproval) {
    approvalState = explicitCallerApproval
  } else {
    autoApproval = true
    if (isRunning) {
      approvalState = 'in_progress'
    } else if (isCompleted && !isRoot && Number(idx) === 0) {
      approvalState = 'pending_approval'
    } else if (isCompleted && Number(idx) === 0 && n.isRoot === undefined && n.role !== 'plan') {
      approvalState = 'pending_approval'
    } else {
      approvalState = 'approved'
    }
  }

  const errorDetail = String(n.error_detail || n.errorDetail || '').trim()
  const nextGoal = String(
    (override && override.nextGoal)
    || n.nextGoal
    || n.next_goal
    || (isError
      ? (errorDetail ? `修复异常：${errorDetail.slice(0, 120)}` : '修复执行异常或分片越界问题后重新提交验证')
      : (approvalState === 'pending_approval'
        ? '等待 Plan 主控审批摘要并下达下一波次指令'
        : (approvalState === 'in_progress'
          ? '完成当前分片工具链验证并回写结构化 Digest'
          : (n.assigned_goal || n.assignedGoal || '进入下一波次契约联调与回归验证'))))
  ).trim()

  const existingTags = parseJsonArraySafe(n.workerTags ?? n.worker_tags ?? n.tags ?? n.tags_json)
  const textCorpus = [
    n.title, n.label, n.rawTitle, n.name, n.role, n.summary,
    n.assigned_goal, n.assignedGoal, n.promptPreview, n.latestOutputPreview, n.outputPreview,
    n.completionConclusion, n.actionSummary, n.lastAssistantText, errorDetail,
    ...(Array.isArray(n.tools) ? n.tools : []),
    ...existingTags,
  ].filter(Boolean).join(' ')

  const domainTags = []
  const pushTag = (t) => {
    if (t && !domainTags.includes(t)) domainTags.push(t)
  }
  for (const et of existingTags) {
    if (et.startsWith('#') && !/^#wave-\d+$/.test(et)) pushTag(et)
  }

  if (/\bui\b|canvas|css|style|视觉|交互|令牌|组件|画布|泳道|拓扑|designer|60fps|render|视图/i.test(textCorpus)) {
    pushTag('#ui-canvas')
    pushTag('#60fps')
  }
  if (/store|\bpg\b|postgres|schema|sqlite|wal|数据库|事实库|落库|存储|digest|测绘|数据源|recon/i.test(textCorpus)) {
    pushTag('#pg-store')
    pushTag('#digest')
  }
  if (/prompt|tool|bridge|rpc|api|index\.js|契约|桥接|分片|调度|架构|assess|plan|captain|主控/i.test(textCorpus)) {
    pushTag('#prompt-contract')
    pushTag('#rpc-bridge')
  }
  if (/test|smoke|\bqa\b|回归|测试|审查|安全|门禁|验证|基准|vuln|review|audit/i.test(textCorpus)) {
    pushTag('#qa-gate')
    pushTag('#smoke-test')
  }

  if (domainTags.length === 0) {
    if (role === 'designer') { pushTag('#ui-canvas'); pushTag('#60fps') }
    else if (role === 'recon') { pushTag('#pg-store'); pushTag('#digest') }
    else if (role === 'assess' || role === 'plan') { pushTag('#prompt-contract'); pushTag('#rpc-bridge') }
    else if (role === 'qa' || role === 'vuln-scan') { pushTag('#qa-gate'); pushTag('#smoke-test') }
    else if (role === 'internal') { pushTag('#digest'); pushTag('#qa-gate') }
    else { pushTag('#rpc-bridge'); pushTag('#ui-canvas') }
  }

  const waveTag = effectiveWave >= 1 && effectiveWave <= 4
    ? `#wave-${effectiveWave}`
    : `#wave-${Math.min(4, Math.max(1, effectiveWave || 1))}`
  const workerTags = [...domainTags.slice(0, 3), waveTag]
  if (workerTags.length < 2) {
    if (!workerTags.includes('#rpc-bridge')) workerTags.unshift('#rpc-bridge')
  }

  const persistedPriority = !options.recomputeApproval
    && typeof (n.ui_priority || n.uiPriority) === 'string'
    && PRIORITY_META[n.ui_priority || n.uiPriority]
    ? PRIORITY_META[n.ui_priority || n.uiPriority]
    : null

  let tier = PRIORITY_META.P3
  const isActiveWaveShard = !isIdle && (effectiveWave === 1 || effectiveWave === 2 || workerTags.includes('#wave-1') || workerTags.includes('#wave-2'))

  if (isError) {
    tier = PRIORITY_META.P0
  } else if (override && override.uiPriority && PRIORITY_META[override.uiPriority] && !isRunning) {
    tier = PRIORITY_META[override.uiPriority]
  } else if (persistedPriority && !isRunning && approvalState !== 'pending_approval') {
    tier = persistedPriority
  } else if (isRunning || (approvalState === 'pending_approval' && Number(idx) < 2)) {
    tier = PRIORITY_META.P0
  } else if (isRoot && !isIdle) {
    tier = PRIORITY_META.P0
  } else if (!isIdle && (isActiveWaveShard || toolCalls >= 3)) {
    tier = PRIORITY_META.P1
  } else if (isCompleted && approvalState === 'approved') {
    tier = PRIORITY_META.P2
  } else if (persistedPriority) {
    tier = persistedPriority
  } else {
    tier = PRIORITY_META.P3
  }

  const digestObj = (n.workerDigest && typeof n.workerDigest === 'object')
    ? n.workerDigest
    : ((n.compressedDigest && typeof n.compressedDigest === 'object') ? n.compressedDigest : null)

  const rawDigestSource = String(
    (digestObj && (digestObj.what_was_done || digestObj.whatWasDone))
    || n.completionConclusion || n.actionSummary || n.lastAssistantText || n.conclusion
    || errorDetail || n.latestOutputPreview || n.outputPreview || n.summary
    || n.assigned_goal || n.assignedGoal || ''
  ).replace(/\s+/g, ' ').trim()

  const fallbackTitle = String(n.title || n.label || n.name || n.id || '子智能体分片').trim()
  const whatWasDone = rawDigestSource
    ? (rawDigestSource.length > 130 ? `${rawDigestSource.slice(0, 128)}…` : rawDigestSource)
    : (isError
      ? `执行 ${fallbackTitle} 时发生异常或分片越界，等待修订重试。`
      : (isRunning
        ? `正在执行 ${fallbackTitle} 核心分片任务，实时归并结构化摘要与事实库状态。`
        : (isIdle
          ? `已编排 ${fallbackTitle} 分片目标，等待上游波次完成后调度执行。`
          : `已完成 ${fallbackTitle} 阶段交付与契约对齐，执行摘要已压缩归档入库。`)))

  const filesTouched = inferWorkerFilesTouched(n, textCorpus)
  const verification = String(
    (isError ? '✗ 执行异常或分片越界待修复' : '')
    || (digestObj && digestObj.verification)
    || n.verification
    || (isRunning
      ? '⚙ 正在执行工具链验证'
      : (isIdle ? '⏳ 待调度执行验证' : '✓ 契约与冒烟断言通过'))
  ).trim()

  const rawTokens = Number(digestObj && (digestObj.raw_tokens ?? digestObj.rawTokens))
    || Math.max(600, Math.max(1, turns) * 420 + toolCalls * 310)
  const compressedTokens = Number(digestObj && (digestObj.compressed_tokens ?? digestObj.compressedTokens))
    || Math.max(65, Math.round(rawTokens * 0.14))
  const compressionPct = Number(digestObj && (digestObj.compression_pct ?? digestObj.compressionPct))
    || Math.round((1 - compressedTokens / Math.max(1, rawTokens)) * 100)

  const compressedDigest = {
    whatWasDone,
    filesTouched,
    verification,
    rawTokens,
    compressedTokens,
    compressionPct,
  }

  const metaResult = {
    uiPriority: tier.uiPriority,
    ui_priority: tier.uiPriority,
    priorityWeight: tier.priorityWeight,
    priority_weight: tier.priorityWeight,
    priorityLabel: tier.priorityLabel,
    priority_label: tier.priorityLabel,
    workerTags,
    worker_tags: workerTags,
    compressedDigest,
    compressed_digest: compressedDigest,
    approvalState,
    approval_state: approvalState,
    verification,
    nextGoal,
    next_goal: nextGoal,
    turns,
    toolCalls,
    tool_calls: toolCalls,
    _autoApproval: autoApproval,
  }
  if (isError) {
    metaResult.status = 'error'
    metaResult.isError = true
    if (errorDetail) {
      metaResult.error_detail = errorDetail
      metaResult.errorDetail = errorDetail
    }
  }

  if (node && typeof node === 'object') {
    Object.assign(node, metaResult)
  }

  return metaResult
}

const STALE_SESSION_RUNNING_MS = 180_000

export function extractSessionTelemetry(s, options = {}) {
  const isRoot = Boolean(options.isRoot)
  const jsonlData = options.jsonlData || null
  const meterUsage = options.meterUsage || null
  const header = Object.assign({}, (jsonlData && jsonlData.header) || {}, (s && s.header) || {})
  const sid = String((s && s.id !== undefined ? s.id : header.id) || options.fallbackId || '')
  const parentRaw = options.parentId !== undefined
    ? options.parentId
    : (
      header.parentSession ?? header.parentSessionId ?? header.parent_session_id ?? header.parentId ?? header.parent
      ?? s?.parentSession ?? s?.parentSessionId ?? s?.parent_session_id ?? s?.parentId ?? s?.parent ?? null
    )
  const parentId = !isRoot && parentRaw !== undefined && parentRaw !== null && String(parentRaw).trim() !== ''
    ? String(parentRaw).trim()
    : null

  const rawTitle = String(
    (s && (s.label || s.displayTitle || s.title))
    || header.title || header.name || header.label
    || sid
  ).trim() || sid

  const role = inferAgentRole(rawTitle, isRoot, (s && s.role) || header.role || options.role)
  const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.exploit
  const wfNode = options.workflowNode || null

  const rawIsUuid = isUuidSessionTitle(rawTitle)
  const shortSid = cleanSessionShortId(sid)
  const roleIdx = Number.isInteger(options.roleIndex) ? options.roleIndex : null
  const roleSiblings = Number(options.roleSiblingCount) || 0

  let title = rawTitle
  if (rawIsUuid && !isRoot) {
    const baseTitle = (wfNode && wfNode.name) ? `Wave${meta.wave} ${role} ${wfNode.name}` : meta.defaultTitle
    if (roleSiblings > 1 && roleIdx !== null) {
      title = `${baseTitle} #${roleIdx + 1}${shortSid ? ` · ${shortSid}` : ''}`
    } else if (shortSid) {
      title = `${baseTitle} · ${shortSid}`
    } else {
      title = baseTitle
    }
  }
  const explicitLabel = String((s && s.label) || '').trim()
  const label = (explicitLabel && !isUuidSessionTitle(explicitLabel)) ? explicitLabel : title
  const workerName = String(
    (s && (s.worker_name || s.workerName))
    || (!isRoot && rawIsUuid
      ? `${role}${roleIdx !== null ? `#${roleIdx + 1}` : ''}${shortSid ? `-${shortSid}` : ''}`
      : label)
  ).trim()

  const wave = options.wave !== undefined && options.wave !== null
    ? Number(options.wave)
    : inferAgentWave(label || title, role, isRoot)
  const color = meta.color
  const badge = meta.badge
  const model = String(
    header.model || (s && s.model) || (jsonlData && jsonlData.model) || options.defaultModel || 'deepseek-v4.1-flash (max)',
  )

  const usage = Object.assign(
    {},
    (header && header.usage) || {},
    (s && (s.stats || s.tokenUsage || s.usage)) || {},
  )

  const inputTokens = Math.max(
    Number(usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? s?.inputTokens ?? header.inputTokens ?? 0) || 0,
    Number(meterUsage?.inputTokens || 0),
    Number(jsonlData?.inputTokens || 0),
  )
  const outputTokens = Math.max(
    Number(usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? s?.outputTokens ?? header.outputTokens ?? 0) || 0,
    Number(meterUsage?.outputTokens || 0),
    Number(jsonlData?.outputTokens || 0),
  )
  const reasoningTokens = Math.max(
    Number(usage.reasoningTokens ?? usage.reasoning_tokens ?? usage.thinkingTokens ?? s?.reasoningTokens ?? header.reasoningTokens ?? 0) || 0,
    Number(meterUsage?.reasoningTokens || 0),
    Number(jsonlData?.reasoningTokens || 0),
  )
  const cacheReadTokens = Math.max(
    Number(
      usage.cacheReadTokens ?? usage.cache_read_tokens ?? usage.cacheReadInputTokens ?? usage.cache_read_input_tokens
      ?? usage.cachedTokens ?? usage.cached_tokens ?? usage.prompt_cache_hit_tokens ?? s?.cacheReadTokens ?? 0,
    ) || 0,
    Number(meterUsage?.cacheReadTokens || 0),
    Number(jsonlData?.cacheReadTokens || 0),
  )
  const rawTokens = Math.max(
    Number(usage.totalTokens ?? usage.total_tokens ?? usage.tokens ?? 0) || 0,
    inputTokens + outputTokens,
    Number(meterUsage?.totalTokens || 0),
    Number(jsonlData?.totalTokens || 0),
    Number(s?.totalTokens ?? s?.tokens ?? header.tokens ?? (wfNode && wfNode.tokens) ?? 0) || 0,
  )
  const tokens = rawTokens
  const effectiveInputTokens = inputTokens > 0 ? inputTokens : (tokens > 0 ? Math.round(tokens * 0.68) : 0)
  const effectiveOutputTokens = outputTokens > 0 ? outputTokens : (tokens > 0 ? Math.max(0, tokens - effectiveInputTokens) : 0)

  const explicitCacheHit = usage.cacheHitRate ?? usage.cacheHitPct ?? usage.cache_hit_pct ?? s?.cacheHitPct ?? meterUsage?.cacheHitPct
  let cacheHitPct = 0
  if (explicitCacheHit !== undefined && explicitCacheHit !== null && Number.isFinite(Number(explicitCacheHit))) {
    cacheHitPct = Math.max(0, Math.min(100, Math.round(Number(explicitCacheHit) * 10) / 10))
  } else if (cacheReadTokens > 0) {
    const uncached = Math.max(
      Number(usage.uncachedInputTokens ?? usage.prompt_cache_miss_tokens ?? 0) || 0,
      Number(meterUsage?.uncachedInputTokens || 0),
      Number(jsonlData?.uncachedInputTokens || 0),
    )
    const denom = Math.max(effectiveInputTokens, cacheReadTokens + uncached)
    cacheHitPct = denom > 0 ? Math.min(100, Math.round((cacheReadTokens / denom) * 1000) / 10) : 0
  }

  const contextTokens = Math.max(
    Number(usage.contextTokens ?? usage.currentContextTokens ?? s?.contextTokens ?? header.contextTokens ?? 0) || 0,
    Number(meterUsage?.contextTokens || 0),
    Number(jsonlData?.contextTokens || 0),
    tokens,
  )
  const contextMax = Number(
    usage.contextWindow
    ?? usage.maxContextTokens
    ?? s?.contextMax
    ?? header.contextWindow
    ?? (meterUsage && meterUsage.contextMax > 0 ? meterUsage.contextMax : undefined)
    ?? (jsonlData && jsonlData.contextMax > 0 ? jsonlData.contextMax : undefined)
    ?? 421000,
  ) || 421000
  const contextPct = Number(
    usage.contextPct ?? (contextMax > 0 && contextTokens > 0
      ? Math.min(100, Math.round((contextTokens / contextMax) * 1000) / 10)
      : 0),
  ) || 0

  const explicitCost = Number(usage.cost ?? usage.costYuan ?? usage.totalCost ?? meterUsage?.cost ?? jsonlData?.explicitCost ?? 0) || 0
  const costYuan = explicitCost > 0
    ? Number((explicitCost).toFixed(4))
    : (tokens > 0 ? Number(((tokens / 1000000) * 1.8).toFixed(4)) : 0)

  const messages = getSessionMessages(s)
  const msgUserCount = messages.filter((m) => {
    const r = getMessageRole(m)
    return r === 'user' || r === 'human'
  }).length
  const userMessages = Math.max(
    Number(usage.userMessages ?? usage.user_messages ?? s?.userMessages ?? s?.user_messages ?? header.userMessages ?? 0) || 0,
    msgUserCount,
    Number(jsonlData?.userMessages || 0),
  )
  const steps = Math.max(
    Number(usage.steps ?? s?.steps ?? header.steps ?? 0) || 0,
    messages.length,
    Number(jsonlData?.steps || 0),
    Number((wfNode && wfNode.step_count) || 0),
  )
  const explicitRounds = Math.max(
    Number(usage.rounds ?? usage.turns ?? s?.rounds ?? s?.turns ?? 0) || 0,
    Array.isArray(s && s.turns) && s.turns.length > 0 ? s.turns.length : 0,
    messages.length > 0 ? Math.max(1, Math.ceil(messages.length / 2)) : 0,
    Number(jsonlData?.turns || 0),
  )
  const hasExplicitZeroTurns = Boolean(
    (s && (s.turns === 0 || s.rounds === 0))
    || (jsonlData && jsonlData.turns === 0 && s?.turns === undefined && s?.rounds === undefined),
  )
  const rounds = explicitRounds > 0
    ? explicitRounds
    : (((isRoot || hasExplicitZeroTurns) && steps === 0 && tokens === 0 && userMessages === 0) ? 0 : 1)
  const explicitToolCalls = s?.toolCalls ?? s?.tool_calls ?? usage.toolCalls ?? usage.tool_calls
    ?? (jsonlData && jsonlData.toolCalls > 0 ? jsonlData.toolCalls : undefined)
    ?? (wfNode && wfNode.tool_calls)

  const startMs = parseTimestampMs(
    header.createdAt ?? header.created_at ?? header.startedAt ?? s?.createdAt ?? s?.created_at ?? s?.startedAt ?? usage.startedAt,
  ) || Number(jsonlData?.firstTimestampMs || 0)
  const updatedAtMs = parseTimestampMs(
    header.updatedAt ?? header.updated_at ?? header.completedAt ?? header.endedAt
    ?? s?.updatedAt ?? s?.updated_at ?? s?.completedAt ?? s?.endedAt ?? usage.updatedAt,
  ) || 0
  const fileMtimeMs = Number(s?.fileMtimeMs ?? options.fileMtimeMs ?? jsonlData?.mtimeMs ?? 0) || 0
  const lastActivityMs = Math.max(
    Number((jsonlData && jsonlData.mtimeMs) || 0),
    Number((jsonlData && jsonlData.lastTimestampMs) || 0),
    updatedAtMs,
    fileMtimeMs,
    startMs,
  )

  const rawStatusField = String((s && s.status) || header.status || '').trim().toLowerCase()
  const rawActivityField = String((s && s.activity) || header.activity || '').trim().toLowerCase()
  const combinedRawState = rawStatusField || rawActivityField
  const isError = ERROR_STATUS_SET.has(rawStatusField) || ERROR_STATUS_SET.has(rawActivityField)
  const isStreaming = Boolean((s && s.streaming) || (header && header.streaming))
  const parentClosed = Boolean(
    options.parentClosed
    || s?.closed
    || header.closed
    || rawStatusField === 'closed'
    || rawActivityField === 'closed',
  )
  let isRunning = !isError && (
    combinedRawState === 'running'
    || combinedRawState === 'run'
    || combinedRawState === 'active'
    || combinedRawState === 'in_progress'
    || rawActivityField === 'running'
    || isStreaming
  )

  let reapedAsStale = false
  let staleStatusOverride = ''
  if (
    isRunning
    && !isStreaming
    && (
      Boolean(options.parentClosed)
      || (lastActivityMs > 0 && (Date.now() - lastActivityMs > STALE_SESSION_RUNNING_MS))
    )
  ) {
    isRunning = false
    reapedAsStale = true
    staleStatusOverride = (steps > 0 || tokens > 0 || userMessages > 0) ? 'completed' : 'interrupted'
  }

  const isInterrupted = staleStatusOverride === 'interrupted'
    || combinedRawState === 'interrupted'
    || rawActivityField === 'interrupted'
  const hasWork = steps > 0
    || tokens > 0
    || messages.length > 0
    || userMessages > 0
    || combinedRawState === 'completed'
    || combinedRawState === 'done'
    || rawActivityField === 'completed'
    || Boolean(wfNode && wfNode.has_activity)
  const status = isError
    ? 'error'
    : (staleStatusOverride
      ? staleStatusOverride
      : (isInterrupted
        ? 'interrupted'
        : (isRunning ? 'running' : (hasWork ? 'completed' : 'pending'))))
  const activity = isError
    ? 'error'
    : (staleStatusOverride
      ? staleStatusOverride
      : (isInterrupted
        ? 'interrupted'
        : (isRunning ? 'running' : (hasWork ? 'completed' : 'idle'))))

  const endMs = isRunning
    ? Date.now()
    : (reapedAsStale
      ? (lastActivityMs || startMs || 0)
      : (
        updatedAtMs
        || Number(jsonlData?.lastTimestampMs || 0)
        || (fileMtimeMs > 0 ? fileMtimeMs : 0)
        || startMs
        || 0
      ))

  const explicitDurationMs = Number(
    usage.durationMs ?? usage.latencyMs ?? s?.durationMs ?? s?.duration_ms ?? s?.latency_ms ?? header.durationMs ?? (wfNode && wfNode.latency_ms) ?? 0,
  ) || 0
  const rawSpanMs = startMs > 0 && endMs >= startMs ? (endMs - startMs) : 0
  const computedSpanMs = (status === 'interrupted' && explicitDurationMs === 0 && rawSpanMs > STALE_SESSION_RUNNING_MS)
    ? 0
    : rawSpanMs
  const durationMs = (reapedAsStale && explicitDurationMs > Math.max(computedSpanMs, STALE_SESSION_RUNNING_MS))
    ? computedSpanMs
    : (explicitDurationMs > 0 ? explicitDurationMs : computedSpanMs)
  const durationLabel = formatDurationLabel(durationMs)

  const fallbackSummary = (wfNode && wfNode.summary)
    || (activity === 'error'
      ? (s?.error_detail || `${label} 执行异常待修复`)
      : (activity === 'running'
        ? `正在执行 ${label} 任务并同步 PostgreSQL 事实库…`
        : (activity === 'interrupted'
          ? `${label} 会话租约超时已回收。`
          : (activity === 'completed' ? `已完成 ${label} 阶段交付并落库核验。` : '等待主控调度派发'))))

  const enrichedSessionForPreview = (jsonlData && (jsonlData.delegationPrompt || jsonlData.lastAssistantText))
    ? Object.assign({}, s, {
      prompt: (s && (s.promptPreview || s.prompt || s.delegationPrompt)) || jsonlData.delegationPrompt || '',
      latestOutput: (s && (s.latestOutputPreview || s.outputPreview || s.latestOutput)) || jsonlData.lastAssistantText || '',
    })
    : s
  const previews = extractSessionPreviews(enrichedSessionForPreview, header, role, fallbackSummary)

  const mergedFilesTouched = [
    ...parseJsonArraySafe(s && (s.filesTouched ?? s.files_touched ?? s.files_touched_json)),
    ...((jsonlData && Array.isArray(jsonlData.filesTouched)) ? jsonlData.filesTouched : []),
  ].filter((v, i, arr) => v && arr.indexOf(v) === i).slice(0, 8)

  const telemetry = {
    id: sid,
    sessionId: sid,
    session_id: sid,
    worker_name: workerName,
    workerName,
    parentId,
    parent: parentId,
    parentClosed,
    isRoot,
    rawTitle,
    title,
    label,
    name: title,
    role,
    roleIndex: roleIdx,
    roleSiblingCount: roleSiblings || 1,
    badge,
    wave,
    color,
    model,
    activity,
    status,
    mode: String((s && s.mode) || header.mode || ''),
    tokens,
    inputTokens: effectiveInputTokens,
    outputTokens: effectiveOutputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheHitPct,
    contextTokens,
    contextMax,
    contextPct,
    costYuan,
    steps,
    rounds,
    turns: rounds,
    userMessages,
    user_messages: userMessages,
    toolCalls: explicitToolCalls !== undefined ? Number(explicitToolCalls) || 0 : undefined,
    filesTouched: mergedFilesTouched,
    files_touched: mergedFilesTouched,
    tools: (jsonlData && Array.isArray(jsonlData.tools) && jsonlData.tools.length > 0)
      ? jsonlData.tools
      : (Array.isArray(s && s.tools) ? s.tools : undefined),
    durationMs,
    durationLabel,
    summary: (s && s.summary) || (wfNode && wfNode.summary) || '',
    completionConclusion: (s && (s.completionConclusion || s.conclusion)) || '',
    actionSummary: (s && s.actionSummary) || '',
    lastAssistantText: (s && s.lastAssistantText) || (jsonlData && jsonlData.lastAssistantText) || '',
    error_detail: (s && (s.error_detail || s.errorDetail)) || '',
    promptPreview: previews.promptPreview,
    latestOutputPreview: previews.latestOutputPreview,
    outputPreview: previews.latestOutputPreview,
    createdAt: startMs > 0 ? new Date(startMs).toISOString() : (wfNode && wfNode.updated_at) || null,
    updatedAt: endMs > 0 ? new Date(endMs).toISOString() : (wfNode && wfNode.updated_at) || null,
  }

  computeWorkerLmtexMeta(telemetry, options.idx ?? 0, {
    store: options.store,
    engagementId: options.engagementId || '',
    recomputeApproval: options.recomputeApproval,
  })
  return telemetry
}

export function isSyntheticSessionId(sid) {
  const s = String(sid || '').trim()
  if (!s) return true
  return s === 'root'
    || s === 'root-main'
    || s.startsWith('sub-')
    || s.startsWith('wt-')
    || s.startsWith('goal-')
    || s.startsWith('plan-goal-')
}

export function createRequestFlow() {
  return {
    dagByEng: new Map(),
    syncedEngs: new Set(),
    hostSessionsByKey: new Map(),
    rawSessionById: new Map(),
  }
}

export function getWorkflowDagDedup(store, engagementId, reqFlow = null, forceRefresh = false) {
  if (!store || typeof store.workflowDag !== 'function' || !engagementId) return null
  const engKey = String(engagementId)
  if (reqFlow && !forceRefresh && reqFlow.dagByEng.has(engKey)) {
    return reqFlow.dagByEng.get(engKey)
  }
  let dag = null
  try { dag = store.workflowDag(engKey) } catch { dag = null }
  if (reqFlow && dag) reqFlow.dagByEng.set(engKey, dag)
  return dag
}

function syncHostWorkersDedup(store, engagementId, workers, reqFlow = null) {
  if (!store || typeof store.syncHostWorkersToPg !== 'function' || !engagementId) return null
  const engKey = String(engagementId)
  const realWorkers = (Array.isArray(workers) ? workers : []).filter(
    (w) => w && !w._fromDbTask && !isSyntheticSessionId(w.id),
  )
  if (realWorkers.length === 0) {
    return { ok: true, engagement_id: engKey, synced: 0, total: 0 }
  }
  const liveRunningIds = new Set(
    realWorkers
      .filter((w) => w && (w.activity === 'running' || w.status === 'running'))
      .map((w) => String(w.id)),
  )
  const dedupKey = `${engKey}::${realWorkers.map((w) => `${w.id}:${w.status}:${w.approvalState || ''}`).join(',')}`
  if (reqFlow && reqFlow.syncedEngs.has(dedupKey)) return null
  if (reqFlow) reqFlow.syncedEngs.add(dedupKey)
  try {
    const res = store.syncHostWorkersToPg(engKey, realWorkers, { liveRunningIds })
    if (reqFlow && res && (res.synced > 0 || res.reaped_workers > 0)) reqFlow.dagByEng.delete(engKey)
    return res
  } catch {
    return null
  }
}

/**
 * 基于预构建 `byId` Map 执行 O(1)/线性（最多 64 跳）根会话查找，彻底消除嵌套 `sessions.list()` 轮询风暴。
 */
export function resolveRootFromMap(byId, sessionId) {
  const id = String(sessionId || '')
  if (!id || !(byId instanceof Map) || byId.size === 0) return id
  let cur = id
  let lastKnown = id
  for (let guard = 0; guard < 64; guard += 1) {
    const node = byId.get(cur)
    if (node === undefined) {
      return byId.has(id) ? lastKnown : cur
    }
    lastKnown = cur
    const header = node && node.header ? node.header : null
    const rawParent = (header && header.parentSession !== undefined && header.parentSession !== null)
      ? header.parentSession
      : (
        header?.parentSessionId ?? header?.parent_session_id ?? header?.parentId ?? header?.parent
        ?? node?.parentSession ?? node?.parentSessionId ?? node?.parent_session_id ?? node?.parentId ?? node?.parent ?? null
      )
    const parent = rawParent !== undefined && rawParent !== null ? String(rawParent).trim() : ''
    if (!parent) return cur
    if (parent === cur) return cur
    cur = parent
  }
  return cur
}

function hydrateChildrenWithDbState(children, wfDag) {
  if (!Array.isArray(children) || children.length === 0 || !wfDag || typeof wfDag !== 'object') {
    return new Set()
  }
  const dbTasks = Array.isArray(wfDag.worker_tasks) ? wfDag.worker_tasks : []
  const dbDigests = Array.isArray(wfDag.worker_digests) ? wfDag.worker_digests : []
  if (dbTasks.length === 0 && dbDigests.length === 0) return new Set()

  const digestByTaskId = new Map()
  const digestByWorkerName = new Map()
  for (const d of dbDigests) {
    if (!d || typeof d !== 'object') continue
    if (d.worker_task_id !== undefined && d.worker_task_id !== null) {
      const k = String(d.worker_task_id)
      if (!digestByTaskId.has(k)) digestByTaskId.set(k, d)
    }
    if (d.worker_name) {
      const nk = String(d.worker_name).trim()
      if (nk && !digestByWorkerName.has(nk)) digestByWorkerName.set(nk, d)
    }
  }

  const matchedTaskIds = new Set()
  for (const child of children) {
    if (!child || typeof child !== 'object') continue
    const cid = String(child.id || child.sessionId || '').trim()
    const wName = String(child.worker_name || child.workerName || child.title || '').trim()
    const dbTask = dbTasks.find((t) => {
      if (!t || matchedTaskIds.has(String(t.id))) return false
      if (cid && (String(t.session_id || '') === cid || String(t.id || '') === cid)) return true
      if (wName && t.worker_name && String(t.worker_name).trim() === wName) return true
      return false
    })
    if (!dbTask) continue
    matchedTaskIds.add(String(dbTask.id))

    const linkedDigest = digestByTaskId.get(String(dbTask.id))
      || (dbTask.worker_name ? digestByWorkerName.get(String(dbTask.worker_name).trim()) : null)
      || (wName ? digestByWorkerName.get(wName) : null)
      || null

    child.worker_task_id = dbTask.id
    if (dbTask.goal_id !== undefined && dbTask.goal_id !== null) child.goal_id = dbTask.goal_id
    if (dbTask.assigned_goal) {
      child.assigned_goal = dbTask.assigned_goal
      child.assignedGoal = dbTask.assigned_goal
    }
    const filesOwned = parseJsonArraySafe(dbTask.files_owned ?? dbTask.files_owned_json)
    if (filesOwned.length > 0) {
      child.filesOwned = filesOwned
      child.files_owned = filesOwned
      child.files_owned_json = typeof dbTask.files_owned_json === 'string'
        ? dbTask.files_owned_json
        : JSON.stringify(filesOwned)
    }
    const errDetail = String(dbTask.error_detail || dbTask.errorDetail || '').trim()
    if (errDetail) {
      child.error_detail = errDetail
      child.errorDetail = errDetail
    }
    const dbStatus = String(dbTask.status || '').trim().toLowerCase()
    if (ERROR_STATUS_SET.has(dbStatus)) {
      child.status = dbStatus
      child.activity = 'error'
    } else if (dbStatus === 'interrupted' && child.activity !== 'running' && child.activity !== 'completed') {
      child.status = 'interrupted'
      child.activity = 'interrupted'
    }
    const dbApproval = String(dbTask.approval_state || '').trim()
    if (['approved', 'revision_required', 'pending_approval'].includes(dbApproval)) {
      child.approval_state = dbApproval
      child.approvalState = dbApproval
      child._persistedApproval = true
    }
    const dbPrio = String(dbTask.ui_priority || '').trim()
    if (PRIORITY_META[dbPrio]) {
      child.ui_priority = dbPrio
      child.uiPriority = dbPrio
    }
    if (dbTask.next_goal) {
      child.next_goal = dbTask.next_goal
      child.nextGoal = dbTask.next_goal
    }
    const dbTags = parseJsonArraySafe(dbTask.tags ?? dbTask.tags_json)
    if (dbTags.length > 0) {
      child.workerTags = dbTags
      child.worker_tags = dbTags
    }
    if (linkedDigest) {
      child.workerDigest = linkedDigest
      const digestFiles = parseJsonArraySafe(linkedDigest.files_touched ?? linkedDigest.files_touched_json)
      if (digestFiles.length > 0) {
        const combined = [...(Array.isArray(child.filesTouched) ? child.filesTouched : []), ...digestFiles]
          .filter((v, idx, arr) => v && arr.indexOf(v) === idx)
          .slice(0, 8)
        child.filesTouched = combined
        child.files_touched = combined
      }
    }
  }

  return matchedTaskIds
}

export function parseWaveNumber(waveVal, fallbackWave = 3) {
  if (typeof waveVal === 'number' && Number.isFinite(waveVal)) return waveVal
  if (typeof waveVal === 'string' && waveVal.trim()) {
    const m = /(\d+)/.exec(waveVal)
    if (m) return Number(m[1])
  }
  return fallbackWave
}

/**
 * 发现宿主 DSH 当前打开的所有根会话与子智能体，严格维护 1:1 会话绑定隔离。
 */
export async function discoverHostSessions(ctx, store, options = {}) {
  const reqFlow = options.reqFlow || null
  const cacheKey = `${options.sessionId || ''}::${options.engagementId || ''}::${options.autoBind !== false ? '1' : '0'}`
  if (reqFlow && reqFlow.hostSessionsByKey.has(cacheKey)) {
    return reqFlow.hostSessionsByKey.get(cacheKey)
  }

  let sessions = null
  let subagents = null
  let tokenMeter = null
  try { sessions = ctx.get('sessions') } catch { sessions = null }
  try { subagents = ctx.get('subagents') } catch { subagents = null }
  try { tokenMeter = ctx.get('tokenMeter') } catch { tokenMeter = null }

  let rawList = []
  if (sessions && typeof sessions.list === 'function') {
    try { rawList = sessions.list() } catch { rawList = [] }
  }
  if (!Array.isArray(rawList)) rawList = []

  const allEngagements = store ? getCachedEngagementsList(store) : []
  const validEngById = buildValidEngagementMap(allEngagements)

  const byId = new Map()
  for (const s of rawList) {
    const sid = s && s.id !== undefined ? String(s.id) : ''
    if (sid) {
      byId.set(sid, s)
      if (reqFlow) reqFlow.rawSessionById.set(sid, s)
    }
  }

  const parentIdOfRaw = (s) => {
    if (!s || typeof s !== 'object') return null
    const h = s.header || {}
    const p = h.parentSession ?? h.parentSessionId ?? h.parent_session_id ?? h.parentId ?? h.parent
      ?? s.parentSession ?? s.parentSessionId ?? s.parent_session_id ?? s.parentId ?? s.parent ?? null
    return p !== undefined && p !== null && String(p).trim() !== '' ? String(p).trim() : null
  }

  const rootsMap = new Map()
  const rawChildren = []
  for (const s of rawList) {
    if (!s || s.id === undefined) continue
    const sid = String(s.id)
    const pid = parentIdOfRaw(s)
    if (!pid && s.kind !== 'child' && !s.isSubagent) {
      if (!rootsMap.has(sid)) rootsMap.set(sid, s)
    } else {
      rawChildren.push(s)
    }
  }
  const roots = Array.from(rootsMap.values())

  const groupedChildrenByRoot = new Map()
  for (const c of rawChildren) {
    const cid = String(c.id)
    const directParent = parentIdOfRaw(c)
    const resolvedRoot = resolveRootFromMap(byId, cid)
    const targetRootId = rootsMap.has(resolvedRoot)
      ? resolvedRoot
      : (directParent && rootsMap.has(directParent)
        ? directParent
        : (roots.length === 1 && directParent ? String(roots[0].id) : ''))
    if (targetRootId) {
      if (!groupedChildrenByRoot.has(targetRootId)) groupedChildrenByRoot.set(targetRootId, new Map())
      groupedChildrenByRoot.get(targetRootId).set(cid, Object.assign({}, c))
    }
  }

  let didAdvanceJsonl = false
  let bindingsMutated = false
  const items = []
  for (const root of roots) {
    const sid = String(root.id)
    const header = (root && root.header) || {}
    const cwd = String(header.cwd || header.workspace || header.projectDir || root.cwd || '').trim()
    const workspace = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() || '' : ''

    let cachedBinding = store ? getCachedSessionBindingEntry(store, sid) : null
    const rawBoundId = cachedBinding && cachedBinding.bound ? String(cachedBinding.bound).trim() : ''
    let sessionBoundEngId = null
    let sessionBoundEngName = null

    if (rawBoundId) {
      const validEng = validEngById.get(rawBoundId)
      const nameIsBogus = isUuidSessionTitle(cachedBinding && cachedBinding.name) && !validEng
      if (validEng && !nameIsBogus) {
        sessionBoundEngId = rawBoundId
        sessionBoundEngName = validEng.name || (cachedBinding && cachedBinding.name) || rawBoundId
      } else if (store && !isSyntheticSessionId(sid)) {
        try {
          if (typeof store.setSessionOnboarding === 'function') {
            store.setSessionOnboarding(sid, { action: 'unbind' })
          } else if (typeof store.setSessionBinding === 'function') {
            store.setSessionBinding(sid, null, null)
          }
          invalidateSessionBindingsCache(store)
          bindingsMutated = true
          cachedBinding = getCachedSessionBindingEntry(store, sid)
        } catch { /* ignore */ }
      }
    }

    const itemDag = sessionBoundEngId ? getWorkflowDagDedup(store, sessionBoundEngId, reqFlow) : null
    const itemWfNodeByRole = new Map()
    if (itemDag && Array.isArray(itemDag.all_nodes || itemDag.nodes)) {
      for (const n of (itemDag.all_nodes || itemDag.nodes)) {
        if (n && n.role) itemWfNodeByRole.set(n.role, n)
      }
    }

    const rootJsonl = sessionJsonlReader.readSession(sid, store, root)
    if (rootJsonl && rootJsonl.didAdvance) didAdvanceJsonl = true
    const rootMeter = readHostTokenMeter(tokenMeter, sid)

    const rootTelemetry = extractSessionTelemetry(root, {
      isRoot: true,
      parentId: null,
      workflowNode: sessionBoundEngId ? (itemWfNodeByRole.get('plan') || null) : null,
      jsonlData: rootJsonl,
      meterUsage: rootMeter,
      store,
      engagementId: sessionBoundEngId || '',
    })

    const childRawById = groupedChildrenByRoot.get(sid) ? new Map(groupedChildrenByRoot.get(sid)) : new Map()

    if (subagents && typeof subagents.listChildren === 'function') {
      try {
        const list = await subagents.listChildren(root.id)
        for (const k of Array.isArray(list) ? list : []) {
          if (!k) continue
          const cid = String(k.id || k.sessionId || '')
          if (!cid) continue
          const existingRaw = childRawById.get(cid) || byId.get(cid) || {}
          const mergedRaw = Object.assign({}, existingRaw, k, {
            id: cid,
            header: Object.assign({}, existingRaw.header || {}, k.header || {}),
            usage: Object.assign({}, (existingRaw.header && existingRaw.header.usage) || {}, existingRaw.usage || {}, k.usage || {}),
            label: k.label || existingRaw.label || (existingRaw.header && existingRaw.header.title) || cid,
            activity: k.activity || existingRaw.activity || (existingRaw.header && existingRaw.header.activity),
            mode: k.mode || existingRaw.mode || '',
          })
          childRawById.set(cid, mergedRaw)
          if (reqFlow) reqFlow.rawSessionById.set(cid, mergedRaw)
        }
      } catch { /* ignore per-session error */ }
    }

    const orderedRawChildren = Array.from(childRawById.entries())
      .sort(([idA], [idB]) => String(idA).localeCompare(String(idB)))
    const roleCounts = new Map()
    const childPreRoles = new Map()
    for (const [cid, childObj] of orderedRawChildren) {
      const preRole = inferAgentRole(
        childObj.label || (childObj.header && childObj.header.title) || childObj.title || cid,
        false,
        childObj.role || (childObj.header && childObj.header.role),
      )
      childPreRoles.set(cid, preRole)
      roleCounts.set(preRole, (roleCounts.get(preRole) || 0) + 1)
    }

    const roleSeenIdx = new Map()
    const kids = []
    for (const [cid, childObj] of orderedRawChildren) {
      const preRole = childPreRoles.get(cid) || 'exploit'
      const curRoleIdx = roleSeenIdx.get(preRole) || 0
      roleSeenIdx.set(preRole, curRoleIdx + 1)
      const childJsonl = sessionJsonlReader.readSession(cid, store, childObj)
      if (childJsonl && childJsonl.didAdvance) didAdvanceJsonl = true
      const childMeter = readHostTokenMeter(tokenMeter, cid)

      const childTelemetry = extractSessionTelemetry(childObj, {
        isRoot: false,
        parentId: sid,
        parentClosed: rootTelemetry.parentClosed,
        defaultModel: rootTelemetry.model,
        workflowNode: sessionBoundEngId ? (itemWfNodeByRole.get(preRole) || null) : null,
        roleIndex: curRoleIdx,
        roleSiblingCount: roleCounts.get(preRole) || 1,
        jsonlData: childJsonl,
        meterUsage: childMeter,
        store,
        engagementId: sessionBoundEngId || '',
      })
      kids.push(childTelemetry)
    }

    if (sessionBoundEngId && itemDag) {
      hydrateChildrenWithDbState(kids, itemDag)
    }
    kids.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))
    let completedKidIdx = 0
    for (let i = 0; i < kids.length; i += 1) {
      const k = kids[i]
      const kIdx = (k.activity === 'completed' || k.status === 'completed') ? completedKidIdx++ : i
      computeWorkerLmtexMeta(k, kIdx, {
        store,
        engagementId: sessionBoundEngId || '',
        recomputeApproval: !k._persistedApproval,
      })
    }

    const rawTitle = rootTelemetry.rawTitle
    let displayTitle = rawTitle
    let displayLabel = workspace && !rawTitle.includes(workspace) ? (workspace + ' · ' + rawTitle) : rawTitle
    if (isUuidSessionTitle(displayTitle) && sessionBoundEngName && !isUuidSessionTitle(sessionBoundEngName)) {
      displayTitle = sessionBoundEngName
      displayLabel = workspace && !sessionBoundEngName.includes(workspace)
        ? `${workspace} · ${sessionBoundEngName}`
        : sessionBoundEngName
    }

    const hasDbDagActivity = Boolean(
      sessionBoundEngId
      && itemDag
      && Array.isArray(itemDag.all_nodes || itemDag.nodes)
      && (itemDag.all_nodes || itemDag.nodes).some((n) => n && n.has_activity && n.role !== 'plan'),
    )
    const hasConversation = Boolean(
      rootTelemetry.turns > 0
      || rootTelemetry.userMessages > 0
      || rootTelemetry.steps > 0
      || rootTelemetry.tokens > 0
      || kids.length > 0
      || hasDbDagActivity,
    )

    const persistedInitState = sessionBoundEngId
      ? 'initialized'
      : (cachedBinding && cachedBinding.init_state === 'skipped' ? 'skipped' : 'uninitialized')
    const onboardingDismissed = sessionBoundEngId
      ? true
      : Boolean(cachedBinding && cachedBinding.onboarding_dismissed)

    if (
      store
      && !isSyntheticSessionId(sid)
      && cachedBinding
      && typeof store.setSessionOnboarding === 'function'
      && (
        Boolean(cachedBinding.has_conversation) !== hasConversation
        || (rawTitle && cachedBinding.session_title !== rawTitle)
        || (cwd && cachedBinding.cwd !== cwd)
      )
    ) {
      try {
        store.setSessionOnboarding(sid, {
          action: 'sync',
          title: rawTitle || undefined,
          cwd: cwd || undefined,
          hasConversation,
        })
        bindingsMutated = true
      } catch { /* ignore */ }
    }

    items.push(Object.assign({}, rootTelemetry, {
      id: sid,
      rawTitle,
      title: displayTitle,
      label: displayLabel,
      cwd,
      workspace,
      displayLabel,
      engagementId: sessionBoundEngId,
      engagementName: sessionBoundEngName,
      hasConversation,
      has_conversation: hasConversation,
      initState: persistedInitState,
      init_state: persistedInitState,
      onboardingDismissed,
      onboarding_dismissed: onboardingDismissed,
      children: kids,
      running_children: kids.filter((c) => c.activity === 'running').length,
    }))
  }

  if (bindingsMutated) {
    invalidateSessionBindingsCache(store)
  }

  let finalItems = items
  if (items.length > 1) {
    const requestedRootId = options.sessionId ? resolveRootFromMap(byId, options.sessionId) : ''
    const hasActivePrimary = items.some((x) => !isUuidSessionTitle(x.rawTitle) || x.tokens > 0 || x.steps > 0 || x.children.length > 0)
    if (hasActivePrimary) {
      const filtered = items.filter((x) => (
        x.id === requestedRootId
        || !isUuidSessionTitle(x.rawTitle)
        || x.tokens > 0
        || x.steps > 0
        || x.children.length > 0
      ))
      if (filtered.length > 0) finalItems = filtered
    }
  }

  try {
    if (store && typeof store.syncHostWorkersToPg === 'function') {
      const kidsByEng = new Map()
      for (const it of finalItems) {
        if (!it || !it.engagementId) continue
        if (!kidsByEng.has(it.engagementId)) kidsByEng.set(it.engagementId, [])
        const bucket = kidsByEng.get(it.engagementId)
        for (const ch of (Array.isArray(it.children) ? it.children : [])) {
          if (ch && !ch._fromDbTask && !isSyntheticSessionId(ch.id)) {
            bucket.push(ch)
          }
        }
      }
      for (const [engId, engKids] of kidsByEng.entries()) {
        if (engKids.length > 0) {
          syncHostWorkersDedup(store, engId, engKids, reqFlow)
        }
      }
    }
  } catch { /* ignore PG sync errors */ }

  if (didAdvanceJsonl) {
    const notifier = options.onJsonlAdvance || options.bumpEventSeq
    if (typeof notifier === 'function') notifier('session_jsonl_append')
  }
  if (reqFlow) {
    reqFlow.hostSessionsByKey.set(cacheKey, finalItems)
  }

  return finalItems
}

/**
 * 合成多智能体拓扑树（`agentNetwork`）、泳道（`swimlanes`）、跨智能体协作事件（`collabEvents`）与协作任务列表（`collabTasks`）。
 */
export function synthesizeAgentCollaboration(store, activeEngagement, hostSessions, requestedSessionId = '', reqFlow = null) {
  const wfDag = activeEngagement ? getWorkflowDagDedup(store, activeEngagement, reqFlow) : null
  const wfNodes = (wfDag && Array.isArray(wfDag.all_nodes || wfDag.nodes))
    ? (wfDag.all_nodes || wfDag.nodes)
    : []
  const wfNodeByRole = new Map()
  for (const n of wfNodes) {
    if (n && n.role) wfNodeByRole.set(n.role, n)
  }

  const dbTasks = (wfDag && Array.isArray(wfDag.worker_tasks)) ? wfDag.worker_tasks : []
  const dbGoals = (wfDag && Array.isArray(wfDag.plan_goals)) ? wfDag.plan_goals : []
  const dbDigests = (wfDag && Array.isArray(wfDag.worker_digests)) ? wfDag.worker_digests : []

  const goalById = new Map()
  for (const g of dbGoals) {
    if (g && g.id !== undefined && g.id !== null) goalById.set(String(g.id), g)
  }
  const digestByTaskId = new Map()
  const digestByWorkerName = new Map()
  for (const d of dbDigests) {
    if (!d || typeof d !== 'object') continue
    if (d.worker_task_id !== undefined && d.worker_task_id !== null) {
      const tk = String(d.worker_task_id)
      if (!digestByTaskId.has(tk)) digestByTaskId.set(tk, d)
    }
    if (d.worker_name) {
      const nk = String(d.worker_name).trim()
      if (nk && !digestByWorkerName.has(nk)) digestByWorkerName.set(nk, d)
    }
  }

  const safeHostList = Array.isArray(hostSessions) ? hostSessions : []
  let primaryHost = null
  if (!activeEngagement) {
    primaryHost = (requestedSessionId && safeHostList.find((s) => s && s.id === requestedSessionId)) || null
  } else {
    const matchingHosts = safeHostList.filter((s) => s && s.engagementId === activeEngagement)
    const unboundFallbackHosts = (!requestedSessionId && matchingHosts.length === 0 && safeHostList.every((s) => !s || !s.engagementId))
      ? safeHostList.filter(Boolean)
      : []
    const candidateHosts = matchingHosts.length > 0 ? matchingHosts : unboundFallbackHosts
    primaryHost = (requestedSessionId && candidateHosts.find((s) => s.id === requestedSessionId))
      || candidateHosts.find((s) => s.children && s.children.length > 0)
      || candidateHosts[0]
      || null
  }

  const planWfNode = activeEngagement ? (wfNodeByRole.get('plan') || null) : null
  const engList = (store && activeEngagement) ? getCachedEngagementsList(store) : []
  const activeEngMeta = activeEngagement ? (engList.find((e) => e && e.id === activeEngagement) || null) : null
  const dbHasRunning = dbTasks.some((t) => {
    const st = String(t && t.status || '').toLowerCase()
    return st === 'running' || st === 'run' || st === 'in_progress'
  })
  const rootActivityFallback = (wfDag && wfDag.status === 'running') || dbHasRunning
    ? 'running'
    : ((wfDag && wfDag.hasStarted) ? 'completed' : 'idle')

  const rootNode = primaryHost
    ? Object.assign({}, primaryHost, {
      isRoot: true,
      parentId: null,
      role: 'plan',
      badge: '主控',
      wave: 0,
      color: '#4d6bfe',
    })
    : extractSessionTelemetry({
      id: (requestedSessionId && !isSyntheticSessionId(requestedSessionId)) ? requestedSessionId : 'root-main',
      title: (activeEngMeta && activeEngMeta.name) || '主控指挥 Captain',
      role: 'plan',
      tokens: (planWfNode && planWfNode.tokens) || 0,
      steps: (planWfNode && planWfNode.step_count) || 0,
      turns: activeEngagement ? undefined : 0,
      activity: activeEngagement ? rootActivityFallback : 'idle',
    }, {
      isRoot: true,
      parentId: null,
      workflowNode: planWfNode,
      store,
      engagementId: activeEngagement || '',
    })

  const childNodes = Array.isArray(primaryHost && primaryHost.children)
    ? primaryHost.children
      .filter((c) => !c._fromDbTask)
      .map((c) => Object.assign({}, c, { isRoot: false, parentId: rootNode.id, parent: rootNode.id }))
    : []

  const matchedTaskIds = activeEngagement ? hydrateChildrenWithDbState(childNodes, wfDag) : new Set()

  const unmatchedDbTasks = activeEngagement ? dbTasks.filter((t) => t && !matchedTaskIds.has(String(t.id))) : []
  if (unmatchedDbTasks.length > 0) {
    const dbRoleCounts = new Map()
    for (const t of unmatchedDbTasks) {
      const r = inferAgentRole(t.worker_name || t.assigned_goal || '', false, t.worker_role || t.role)
      dbRoleCounts.set(r, (dbRoleCounts.get(r) || 0) + 1)
    }
    const dbRoleIdx = new Map()
    for (const t of unmatchedDbTasks) {
      const tRole = inferAgentRole(t.worker_name || t.assigned_goal || '', false, t.worker_role || t.role)
      const curIdx = dbRoleIdx.get(tRole) || 0
      dbRoleIdx.set(tRole, curIdx + 1)
      const meta = AGENT_ROLE_META[tRole] || AGENT_ROLE_META.exploit
      const linkedGoal = (t.goal_id !== undefined && t.goal_id !== null) ? goalById.get(String(t.goal_id)) : null
      const linkedDigest = digestByTaskId.get(String(t.id))
        || (t.worker_name ? digestByWorkerName.get(String(t.worker_name).trim()) : null)
        || null
      const waveNum = parseWaveNumber(t.wave ?? (linkedGoal && linkedGoal.wave), meta.wave)
      const rawSt = String(t.status || 'pending').trim().toLowerCase()
      const isErr = ERROR_STATUS_SET.has(rawSt)
      const isRun = !isErr && (rawSt === 'running' || rawSt === 'run' || rawSt === 'active' || rawSt === 'in_progress')
      const isInterrupted = !isErr && !isRun && rawSt === 'interrupted'
      const isDone = !isErr && !isRun && !isInterrupted && (rawSt === 'completed' || rawSt === 'done' || rawSt === 'finished' || rawSt === 'approved')
      const taskActivity = isErr ? 'error' : (isRun ? 'running' : (isInterrupted ? 'interrupted' : (isDone ? 'completed' : 'idle')))
      const taskStatus = isErr ? rawSt : (isRun ? 'running' : (isInterrupted ? 'interrupted' : (isDone ? 'completed' : 'pending')))

      const filesOwned = parseJsonArraySafe(t.files_owned ?? t.files_owned_json)
      const filesTouched = parseJsonArraySafe(
        (linkedDigest && (linkedDigest.files_touched ?? linkedDigest.files_touched_json))
        ?? t.files_touched
        ?? t.files_touched_json,
      )
      const taskIdStr = String(t.session_id || (t.id !== undefined ? `wt-${t.id}` : `sub-${tRole}-${curIdx + 1}`)).trim()
      const displayTitle = String(
        t.title
        || (linkedGoal && linkedGoal.title)
        || (t.worker_name && !isUuidSessionTitle(t.worker_name) ? t.worker_name : '')
        || meta.defaultTitle
      ).trim()
      const assignedGoal = String(t.assigned_goal || (linkedGoal && linkedGoal.objective) || displayTitle).trim()
      const dbTags = parseJsonArraySafe(t.tags ?? t.tags_json)

      const dbChild = extractSessionTelemetry({
        id: taskIdStr,
        worker_name: t.worker_name || displayTitle,
        label: displayTitle,
        title: displayTitle,
        role: tRole,
        model: rootNode.model || 'deepseek-v4.1-flash (max)',
        activity: taskActivity,
        status: taskStatus,
        tokens: Number(t.tokens || (linkedDigest && linkedDigest.raw_tokens) || 0) || 0,
        steps: Number(t.steps || t.turns || 0) || 0,
        turns: isInterrupted && Number(t.turns || 0) === 0 ? 0 : Math.max(1, Number(t.turns || 1) || 1),
        toolCalls: Number(t.tool_calls ?? 0) || 0,
        durationMs: Number(t.latency_ms || t.duration_ms || 0) || 0,
        summary: (linkedDigest && linkedDigest.what_was_done) || assignedGoal,
        prompt: assignedGoal,
        latestOutput: (linkedDigest && linkedDigest.what_was_done) || t.error_detail || assignedGoal,
        filesTouched,
        error_detail: t.error_detail || '',
        createdAt: t.created_at || (linkedGoal && linkedGoal.created_at) || null,
        updatedAt: t.updated_at || (linkedGoal && linkedGoal.updated_at) || null,
      }, {
        isRoot: false,
        parentId: rootNode.id,
        defaultModel: rootNode.model,
        wave: waveNum,
        roleIndex: curIdx,
        roleSiblingCount: dbRoleCounts.get(tRole) || 1,
        workflowNode: (isRun || isDone) ? (wfNodeByRole.get(tRole) || null) : null,
        store,
        engagementId: activeEngagement,
      })

      dbChild._fromDbTask = true
      dbChild.worker_task_id = t.id
      dbChild.goal_id = t.goal_id ?? null
      dbChild.assigned_goal = assignedGoal
      dbChild.assignedGoal = assignedGoal
      dbChild.filesOwned = filesOwned
      dbChild.files_owned = filesOwned
      dbChild.files_owned_json = typeof t.files_owned_json === 'string' ? t.files_owned_json : JSON.stringify(filesOwned)
      if (t.error_detail) {
        dbChild.error_detail = String(t.error_detail)
        dbChild.errorDetail = String(t.error_detail)
      }
      if (taskActivity === 'idle') {
        dbChild.activity = 'idle'
        dbChild.status = 'pending'
      } else if (taskActivity === 'interrupted') {
        dbChild.activity = 'interrupted'
        dbChild.status = 'interrupted'
      } else if (taskActivity === 'error') {
        dbChild.activity = 'error'
        dbChild.status = 'error'
      }
      const dbApproval = String(t.approval_state || '').trim()
      if (['approved', 'revision_required', 'pending_approval'].includes(dbApproval)) {
        dbChild.approval_state = dbApproval
        dbChild.approvalState = dbApproval
        dbChild._persistedApproval = true
      }
      const dbPrio = String(t.ui_priority || '').trim()
      if (PRIORITY_META[dbPrio]) {
        dbChild.ui_priority = dbPrio
        dbChild.uiPriority = dbPrio
      }
      if (t.next_goal) {
        dbChild.next_goal = t.next_goal
        dbChild.nextGoal = t.next_goal
      }
      if (dbTags.length > 0) {
        dbChild.workerTags = dbTags
        dbChild.worker_tags = dbTags
      }
      if (linkedDigest) {
        dbChild.workerDigest = linkedDigest
      }
      childNodes.push(dbChild)
    }
  } else if (activeEngagement && childNodes.length === 0 && dbGoals.length > 0) {
    const subGoals = dbGoals.filter((g) => g && g.parent_goal_id !== null && g.parent_goal_id !== undefined)
    const goalsToRender = subGoals.length > 0 ? subGoals : dbGoals
    for (let gi = 0; gi < goalsToRender.length; gi += 1) {
      const g = goalsToRender[gi]
      const gRole = inferAgentRole(g.title || g.objective || '', false, g.role)
      const meta = AGENT_ROLE_META[gRole] || AGENT_ROLE_META.exploit
      const waveNum = parseWaveNumber(g.wave, meta.wave)
      const gStatus = String(g.status || 'pending').toLowerCase()
      const gRun = gStatus === 'running' || gStatus === 'in_progress'
      const gDone = gStatus === 'completed' || gStatus === 'done' || gStatus === 'approved'
      const goalChild = extractSessionTelemetry({
        id: `plan-goal-${g.id ?? (gi + 1)}`,
        label: g.title || meta.defaultTitle,
        title: g.title || meta.defaultTitle,
        role: gRole,
        model: rootNode.model || 'deepseek-v4.1-flash (max)',
        activity: gRun ? 'running' : (gDone ? 'completed' : 'idle'),
        status: gRun ? 'running' : (gDone ? 'completed' : 'pending'),
        tokens: 0,
        steps: 0,
        summary: g.objective || g.title || '',
        prompt: g.objective || g.user_prompt || '',
        createdAt: g.created_at || null,
        updatedAt: g.updated_at || null,
      }, {
        isRoot: false,
        parentId: rootNode.id,
        defaultModel: rootNode.model,
        wave: waveNum,
        store,
        engagementId: activeEngagement,
      })
      goalChild._fromDbTask = true
      goalChild.goal_id = g.id
      goalChild.assigned_goal = g.objective || g.title || ''
      goalChild.assignedGoal = goalChild.assigned_goal
      if (!gRun && !gDone) {
        goalChild.activity = 'idle'
        goalChild.status = 'pending'
      }
      childNodes.push(goalChild)
    }
  }

  if (activeEngagement) {
    const existingRoles = new Set(childNodes.map((c) => c.role))
    const WORKER_ROLES = ['designer', 'recon', 'assess', 'exploit', 'vuln-scan', 'qa', 'internal']
    for (const role of WORKER_ROLES) {
      const wfNode = wfNodeByRole.get(role)
      if (!wfNode || !wfNode.has_activity || existingRoles.has(role)) continue
      const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.exploit
      const stepCount = Number(wfNode.step_count || (Array.isArray(wfNode.decisions) ? wfNode.decisions.length : 0) || 1)
      const synthChild = extractSessionTelemetry({
        id: `sub-${role}`,
        label: `${meta.defaultTitle}`,
        title: `${meta.defaultTitle}`,
        role,
        model: rootNode.model || 'deepseek-v4.1-flash (max)',
        activity: (wfNode.status === 'run' || wfNode.active) ? 'running' : 'completed',
        tokens: Number(wfNode.tokens) > 0 ? Number(wfNode.tokens) : 0,
        steps: stepCount,
        durationMs: Number(wfNode.latency_ms) > 0 ? Number(wfNode.latency_ms) : 0,
        summary: wfNode.summary || '',
      }, {
        isRoot: false,
        parentId: rootNode.id,
        defaultModel: rootNode.model,
        workflowNode: wfNode,
        store,
        engagementId: activeEngagement,
      })
      synthChild._fromDbTask = true
      childNodes.push(synthChild)
      existingRoles.add(role)
    }
  }

  childNodes.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))

  let completedWorkerIdx = 0
  for (let i = 0; i < childNodes.length; i += 1) {
    const child = childNodes[i]
    const isChildCompleted = child.activity === 'completed' || child.status === 'completed' || child.status === 'done'
    const effIdx = isChildCompleted ? completedWorkerIdx++ : i
    computeWorkerLmtexMeta(child, effIdx, {
      store,
      engagementId: activeEngagement || '',
      recomputeApproval: !child._persistedApproval && !child._fromDbTask,
    })
  }

  if (rootNode.tokens === 0 && childNodes.length > 0) {
    const sumChildTokens = childNodes.reduce((acc, c) => acc + (Number(c.tokens) || 0), 0)
    if (sumChildTokens > 0) {
      rootNode.tokens = Math.round(sumChildTokens * 0.35)
      rootNode.inputTokens = Math.round(rootNode.tokens * 0.72)
      rootNode.outputTokens = Math.max(0, rootNode.tokens - rootNode.inputTokens)
      rootNode.contextTokens = rootNode.tokens
      rootNode.contextPct = Math.min(100, Math.round((rootNode.contextTokens / (rootNode.contextMax || 421000)) * 1000) / 10)
      rootNode.costYuan = Number(((rootNode.tokens / 1000000) * 1.8).toFixed(4))
    }
    if (rootNode.activity === 'idle') {
      if (childNodes.some((c) => c.activity === 'running')) {
        rootNode.activity = 'running'
        rootNode.status = 'running'
      } else if (childNodes.some((c) => c.activity === 'completed')) {
        rootNode.activity = 'completed'
        rootNode.status = 'completed'
      }
    }
  }
  computeWorkerLmtexMeta(rootNode, 0, { store, engagementId: activeEngagement || '' })
  rootNode.children = childNodes
  rootNode.running_children = childNodes.filter((c) => c.activity === 'running').length

  if (activeEngagement) {
    syncHostWorkersDedup(store, activeEngagement, childNodes, reqFlow)
  }

  const collabEvents = []
  let seq = 1
  const waves = Array.from(new Set(childNodes.map((c) => c.wave))).sort((a, b) => a - b)
  for (const w of waves) {
    const waveChildren = childNodes.filter((c) => c.wave === w)
    for (const child of waveChildren) {
      collabEvents.push({
        id: `ev-spawn-${child.id}`,
        seq: seq++,
        type: 'spawn',
        symbol: '+',
        fromId: rootNode.id,
        toId: child.id,
        rootId: rootNode.id,
        childId: child.id,
        badge: child.badge,
        role: child.role,
        wave: child.wave,
        color: child.color,
        uiPriority: child.uiPriority,
        priorityWeight: child.priorityWeight,
        workerTags: child.workerTags,
        approvalState: child.approvalState,
        label: `派发 ${child.title || child.label}`,
        at: child.createdAt || rootNode.updatedAt || new Date().toISOString(),
      })
    }
    for (const child of waveChildren) {
      if (child.status === 'error' || child.activity === 'error') {
        collabEvents.push({
          id: `ev-error-${child.id}`,
          seq: seq++,
          type: 'error',
          symbol: '✗',
          fromId: child.id,
          toId: rootNode.id,
          rootId: rootNode.id,
          childId: child.id,
          badge: child.badge,
          role: child.role,
          wave: child.wave,
          color: '#ef4444',
          uiPriority: child.uiPriority,
          priorityWeight: child.priorityWeight,
          workerTags: child.workerTags,
          approvalState: child.approvalState,
          compressedDigest: child.compressedDigest,
          label: child.error_detail ? `异常阻断：${child.error_detail}` : `执行异常或分片越界：${child.title || child.label}`,
          at: child.updatedAt || new Date().toISOString(),
        })
      } else if (child.activity === 'running') {
        collabEvents.push({
          id: `ev-progress-${child.id}`,
          seq: seq++,
          type: 'progress',
          symbol: '·',
          fromId: rootNode.id,
          toId: child.id,
          rootId: rootNode.id,
          childId: child.id,
          badge: child.badge,
          role: child.role,
          wave: child.wave,
          color: child.color,
          uiPriority: child.uiPriority,
          priorityWeight: child.priorityWeight,
          workerTags: child.workerTags,
          approvalState: child.approvalState,
          label: child.latestOutputPreview || `执行中 (${child.steps} 步)`,
          at: child.updatedAt || new Date().toISOString(),
        })
      } else if (child.activity === 'completed') {
        collabEvents.push({
          id: `ev-complete-${child.id}`,
          seq: seq++,
          type: 'complete',
          symbol: '✓',
          fromId: child.id,
          toId: rootNode.id,
          rootId: rootNode.id,
          childId: child.id,
          badge: child.badge,
          role: child.role,
          wave: child.wave,
          color: child.color,
          uiPriority: child.uiPriority,
          priorityWeight: child.priorityWeight,
          workerTags: child.workerTags,
          approvalState: child.approvalState,
          compressedDigest: child.compressedDigest,
          label: `完成回报 ${child.title || child.label}`,
          at: child.updatedAt || new Date().toISOString(),
        })
      }
    }
  }

  const buildLane = (node, isRootLane = false, laneIdx = 0) => {
    if (!node.uiPriority || !node.compressedDigest) {
      computeWorkerLmtexMeta(node, laneIdx, { store, engagementId: activeEngagement })
    }
    const laneEvents = collabEvents.filter((e) => e.fromId === node.id || e.toId === node.id || e.childId === node.id)
    const filesOwned = parseJsonArraySafe(node.filesOwned ?? node.files_owned ?? node.files_owned_json)
    return {
      id: node.id,
      sessionId: node.sessionId || node.id,
      worker_task_id: node.worker_task_id ?? null,
      goal_id: node.goal_id ?? null,
      parentId: node.parentId || null,
      isRoot: isRootLane,
      badge: node.badge,
      title: node.title || node.label,
      label: node.label || node.title,
      role: node.role,
      wave: node.wave,
      model: node.model,
      activity: node.activity,
      status: node.status,
      tokens: node.tokens,
      inputTokens: node.inputTokens,
      outputTokens: node.outputTokens,
      reasoningTokens: node.reasoningTokens,
      cacheHitPct: node.cacheHitPct,
      contextTokens: node.contextTokens,
      contextMax: node.contextMax,
      contextPct: node.contextPct,
      costYuan: node.costYuan,
      steps: node.steps,
      rounds: node.rounds,
      turns: node.turns,
      toolCalls: node.toolCalls,
      durationMs: node.durationMs,
      durationLabel: node.durationLabel,
      taskCount: isRootLane ? childNodes.length : 1,
      eventCount: isRootLane ? collabEvents.length : laneEvents.length,
      color: node.color,
      uiPriority: node.uiPriority,
      ui_priority: node.uiPriority,
      priorityWeight: node.priorityWeight,
      priority_weight: node.priorityWeight,
      priorityLabel: node.priorityLabel,
      priority_label: node.priorityLabel,
      workerTags: node.workerTags,
      worker_tags: node.workerTags,
      compressedDigest: node.compressedDigest,
      compressed_digest: node.compressedDigest,
      approvalState: node.approvalState,
      approval_state: node.approvalState,
      assignedGoal: node.assigned_goal || node.assignedGoal || '',
      assigned_goal: node.assigned_goal || node.assignedGoal || '',
      filesOwned,
      files_owned: filesOwned,
      filesTouched: node.filesTouched || (node.compressedDigest && node.compressedDigest.filesTouched) || [],
      files_touched: node.filesTouched || (node.compressedDigest && node.compressedDigest.filesTouched) || [],
      error_detail: node.error_detail || '',
      errorDetail: node.error_detail || '',
      nextGoal: node.nextGoal,
      next_goal: node.nextGoal,
      promptPreview: node.promptPreview,
      latestOutputPreview: node.latestOutputPreview,
      createdAt: node.createdAt || null,
      updatedAt: node.updatedAt || null,
    }
  }
  const swimlanes = [buildLane(rootNode, true, 0), ...childNodes.map((c, idx) => buildLane(c, false, idx))]
  swimlanes.sort((a, b) => {
    if ((b.priorityWeight || 0) !== (a.priorityWeight || 0)) {
      return (b.priorityWeight || 0) - (a.priorityWeight || 0)
    }
    const tb = parseTimestampMs(b.updatedAt)
    const ta = parseTimestampMs(a.updatedAt)
    if (tb !== ta) return tb - ta
    if (Boolean(b.isRoot) !== Boolean(a.isRoot)) return b.isRoot ? 1 : -1
    return (a.wave || 0) - (b.wave || 0)
  })

  const collabTasks = childNodes.map((child) => {
    const filesOwned = parseJsonArraySafe(child.filesOwned ?? child.files_owned ?? child.files_owned_json)
    const cardStatus = (child.status === 'error' || child.activity === 'error')
      ? 'error'
      : (child.activity === 'running' ? 'running' : (child.activity === 'completed' ? 'completed' : 'pending'))
    return {
      id: child.id,
      sessionId: child.sessionId || child.id,
      worker_task_id: child.worker_task_id ?? null,
      goal_id: child.goal_id ?? null,
      parentId: child.parentId || rootNode.id,
      badge: child.badge,
      title: child.title || child.label,
      label: child.label || child.title,
      role: child.role,
      wave: child.wave,
      status: cardStatus,
      activity: child.activity,
      model: child.model,
      assignedGoal: child.assigned_goal || child.assignedGoal || '',
      assigned_goal: child.assigned_goal || child.assignedGoal || '',
      filesOwned,
      files_owned: filesOwned,
      filesTouched: child.filesTouched || (child.compressedDigest && child.compressedDigest.filesTouched) || [],
      files_touched: child.filesTouched || (child.compressedDigest && child.compressedDigest.filesTouched) || [],
      error_detail: child.error_detail || '',
      errorDetail: child.error_detail || '',
      promptPreview: child.promptPreview,
      outputPreview: child.latestOutputPreview,
      latestOutputPreview: child.latestOutputPreview,
      tokens: child.tokens,
      inputTokens: child.inputTokens,
      outputTokens: child.outputTokens,
      reasoningTokens: child.reasoningTokens,
      cacheHitPct: child.cacheHitPct,
      contextTokens: child.contextTokens,
      contextMax: child.contextMax,
      contextPct: child.contextPct,
      costYuan: child.costYuan,
      durationMs: child.durationMs,
      durationLabel: child.durationLabel,
      steps: child.steps,
      rounds: child.rounds,
      turns: child.turns,
      toolCalls: child.toolCalls,
      color: child.color,
      uiPriority: child.uiPriority,
      ui_priority: child.uiPriority,
      priorityWeight: child.priorityWeight,
      priority_weight: child.priorityWeight,
      priorityLabel: child.priorityLabel,
      priority_label: child.priorityLabel,
      workerTags: child.workerTags,
      worker_tags: child.workerTags,
      compressedDigest: child.compressedDigest,
      compressed_digest: child.compressedDigest,
      approvalState: child.approvalState,
      approval_state: child.approvalState,
      nextGoal: child.nextGoal,
      next_goal: child.nextGoal,
      createdAt: child.createdAt || null,
      updatedAt: child.updatedAt || null,
    }
  })
  collabTasks.sort((a, b) => {
    if ((b.priorityWeight || 0) !== (a.priorityWeight || 0)) {
      return (b.priorityWeight || 0) - (a.priorityWeight || 0)
    }
    return parseTimestampMs(b.updatedAt) - parseTimestampMs(a.updatedAt)
  })

  const runningCount = (rootNode.activity === 'running' ? 1 : 0)
    + childNodes.filter((c) => c.activity === 'running').length
  const totalContextTokens = (Number(rootNode.contextTokens || rootNode.tokens || 0))
    + childNodes.reduce((sum, c) => sum + Number(c.contextTokens || c.tokens || 0), 0)

  const nodes = [rootNode, ...childNodes]
  const agentNetwork = {
    root: rootNode,
    children: childNodes,
    nodes,
    totalAgents: 1 + childNodes.length,
    runningCount,
    totalContextTokens,
    teamTasksCount: childNodes.length,
  }

  return {
    agentNetwork,
    nodes,
    swimlanes,
    collabEvents,
    collabTasks,
    rootNode,
    childNodes,
  }
}

/**
 * 构建或提取单个智能体会话的结构化执行轨迹（`stepTimeline`）与详情载荷。
 */
export async function extractAgentSessionDetail(ctx, store, engagementId, request = {}, reqFlow = null, options = {}) {
  const flow = reqFlow || createRequestFlow()
  const targetId = String(request.sessionId || request.agentId || request.id || request.session || '').trim()
  const isSyntheticChildId = isSyntheticSessionId(targetId) || Boolean(request.role && request.role !== 'plan' && !targetId)
  const hostSessions = await discoverHostSessions(ctx, store, {
    sessionId: request.session || (isSyntheticChildId ? '' : targetId),
    autoBind: true,
    reqFlow: flow,
    onJsonlAdvance: options.onJsonlAdvance,
  })
  const rawById = flow.rawSessionById
  let sessions = null
  try { sessions = ctx.get('sessions') } catch { sessions = null }
  if (sessions && typeof sessions.get === 'function' && targetId && !isSyntheticChildId) {
    try {
      const direct = sessions.get(targetId)
      if (direct && direct.id !== undefined) {
        rawById.set(String(direct.id), Object.assign({}, rawById.get(String(direct.id)) || {}, direct))
      }
    } catch { /* ignore */ }
  }
  const resolvedRootSession = request.session
    ? resolveRootFromMap(rawById, String(request.session))
    : ((targetId && !isSyntheticChildId) ? resolveRootFromMap(rawById, targetId) : '')
  const currentEng = (store ? getCachedActiveEngagementId(store) : null)
    || engagementId
    || 'default'
  const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, isSyntheticChildId ? '' : resolvedRootSession, flow)

  const wfDag = getWorkflowDagDedup(store, currentEng, flow)
  const wfNodeByRole = new Map()
  if (wfDag && Array.isArray(wfDag.all_nodes || wfDag.nodes)) {
    for (const n of (wfDag.all_nodes || wfDag.nodes)) {
      if (n && n.role) wfNodeByRole.set(n.role, n)
    }
  }

  const allHostChildren = []
  for (const hs of hostSessions) {
    for (const c of Array.isArray(hs && hs.children) ? hs.children : []) {
      if (c) allHostChildren.push(c)
    }
  }

  const normalizedRoleTarget = targetId.replace(/^sub-/, '').toLowerCase()
  const explicitRole = String(request.role || '').trim().toLowerCase()

  let isRootMatch = false
  let matchedNode = null
  let matchedRealSessionId = ''

  if (!targetId || targetId === synth.rootNode.id || targetId === 'root-main' || hostSessions.some((hs) => hs.id === targetId)) {
    isRootMatch = true
    const hostRoot = hostSessions.find((hs) => hs.id === targetId) || (synth.rootNode && !isSyntheticSessionId(synth.rootNode.id) ? synth.rootNode : null)
    matchedNode = hostRoot || synth.rootNode
    if (hostRoot && hostRoot.id && !isSyntheticSessionId(hostRoot.id)) {
      matchedRealSessionId = String(hostRoot.id)
    }
  } else {
    matchedNode = synth.childNodes.find((c) => c.id === targetId || String(c.worker_task_id || '') === targetId)
      || allHostChildren.find((c) => c.id === targetId)
      || synth.childNodes.find((c) => c.role === normalizedRoleTarget || (explicitRole && c.role === explicitRole))
      || allHostChildren.find((c) => c.role === normalizedRoleTarget || (explicitRole && c.role === explicitRole))
      || null

    const realChild = allHostChildren.find((c) => c.id === targetId && !isSyntheticSessionId(c.id))
      || allHostChildren.find((c) => !isSyntheticSessionId(c.id) && matchedNode && c.id === matchedNode.id)
      || null
    if (realChild && realChild.id) {
      matchedRealSessionId = String(realChild.id)
    } else if (rawById.has(targetId) && !isSyntheticSessionId(targetId)) {
      matchedRealSessionId = targetId
    }
  }

  if (!matchedNode) {
    const fallbackRole = inferAgentRole(request.title || targetId, false, explicitRole || normalizedRoleTarget)
    const meta = AGENT_ROLE_META[fallbackRole] || AGENT_ROLE_META.assess
    const wfNode = wfNodeByRole.get(fallbackRole) || null
    matchedNode = extractSessionTelemetry({
      id: targetId || `sub-${fallbackRole}`,
      title: request.title || meta.defaultTitle,
      label: request.title || meta.defaultTitle,
      role: fallbackRole,
      tokens: (wfNode && wfNode.tokens) || 0,
      steps: (wfNode && wfNode.step_count) || 0,
      durationMs: (wfNode && wfNode.latency_ms) || 0,
      summary: (wfNode && wfNode.summary) || '',
    }, {
      isRoot: false,
      parentId: synth.rootNode.id,
      defaultModel: synth.rootNode.model,
      workflowNode: wfNode,
      store,
      engagementId: currentEng,
    })
  }

  const rawSession = (matchedRealSessionId && rawById.get(matchedRealSessionId))
    || rawById.get(targetId)
    || null
  const jsonlDetail = (matchedRealSessionId || (!isSyntheticSessionId(targetId) && targetId))
    ? sessionJsonlReader.readSession(matchedRealSessionId || targetId, store, rawSession)
    : null

  const role = matchedNode.role || (isRootMatch ? 'plan' : 'assess')
  const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.assess
  const wfNode = wfNodeByRole.get(role) || null
  const isError = matchedNode.status === 'error' || matchedNode.activity === 'error'
  const isRunning = !isError && (matchedNode.activity === 'running' || matchedNode.status === 'running')
  const delegationPrompt = String(
    matchedNode.assigned_goal
    || matchedNode.promptPreview
    || matchedNode.prompt
    || (jsonlDetail && jsonlDetail.delegationPrompt)
    || (rawSession && (rawSession.prompt || (rawSession.header && rawSession.header.prompt)))
    || meta.promptFallback
    || '按主控拆解的分片边界完成模块构建、契约对齐与单元验证。'
  ).trim()
  const conclusion = String(
    matchedNode.error_detail
    || (jsonlDetail && jsonlDetail.lastAssistantText)
    || matchedNode.latestOutputPreview
    || matchedNode.output
    || (wfNode && wfNode.summary)
    || '已完成当前阶段模块实现与契约校验，产物已同步至工作区。'
  ).trim()

  const rawMessages = getSessionMessages(rawSession)

  const extractedSteps = []
  if (rawMessages.length > 0) {
    let stepIndex = 1
    for (let i = 0; i < rawMessages.length; i += 1) {
      const m = rawMessages[i]
      if (!m || typeof m !== 'object') continue
      const msgRole = getMessageRole(m)
      const text = extractMessageText(m)
      if (i === 0 || (msgRole === 'user' && extractedSteps.length === 0)) {
        extractedSteps.push({
          step: stepIndex++,
          phase: 'delegate',
          tool: isRootMatch ? 'session.user_prompt' : 'subagents.delegate',
          title: isRootMatch ? '接收用户需求指令与工程上下文' : `接收主控派发指令（${meta.badge}）`,
          inputSummary: (text || delegationPrompt).slice(0, 180),
          outputSummary: '已完成上下文装载、分片边界确认与工具链就绪检查。',
          durationLabel: '8s',
          status: 'done',
        })
        continue
      }
      const msgToolCalls = getMessageToolCalls(m, { includeNamedPart: true })
      if (msgToolCalls.length > 0) {
        const { name: toolName, rawInput } = getToolCallMeta(msgToolCalls[0])
        const inputPayload = rawInput ?? (text || '')
        const inputStr = typeof inputPayload === 'string' ? inputPayload : JSON.stringify(inputPayload)
        extractedSteps.push({
          step: stepIndex++,
          phase: 'execute',
          tool: toolName,
          title: `调用工具 ${toolName} 执行工程操作`,
          inputSummary: (inputStr || `执行 ${toolName}`).replace(/\s+/g, ' ').trim().slice(0, 180),
          outputSummary: (text || '工具执行成功，产物已写入上下文。').slice(0, 180),
          durationLabel: '0s',
          status: 'done',
        })
      } else if (text && (msgRole === 'assistant' || msgRole === 'model')) {
        extractedSteps.push({
          step: stepIndex++,
          phase: 'execute',
          tool: isRootMatch ? 'captain.orchestrate' : `${role}.reasoning`,
          title: isRootMatch ? '主控阶段性综合研判与调度' : `${matchedNode.title || meta.defaultTitle} 推进执行`,
          inputSummary: '基于当前工作区代码结构与上游契约进行推理实现',
          outputSummary: text.slice(0, 180),
          durationLabel: '0s',
          status: 'done',
        })
      }
      if (extractedSteps.length >= 4) break
    }
  } else if (jsonlDetail && Array.isArray(jsonlDetail.stepSummaries) && jsonlDetail.stepSummaries.length > 0) {
    extractedSteps.push({
      step: 1,
      phase: 'delegate',
      tool: isRootMatch ? 'session.user_prompt' : 'subagents.delegate',
      title: isRootMatch ? '接收用户需求指令与工程上下文' : `接收主控派发指令（${meta.badge}）`,
      inputSummary: delegationPrompt.slice(0, 180),
      outputSummary: '已从增量 JSONL 轨迹装载会话上下文。',
      durationLabel: '0s',
      status: 'done',
    })
    for (const sItem of jsonlDetail.stepSummaries.slice(-4)) {
      extractedSteps.push({
        step: extractedSteps.length + 1,
        phase: sItem.phase || 'execute',
        tool: sItem.tool || `${role}.step`,
        title: sItem.title || `调用工具 ${sItem.tool || 'step'}`,
        inputSummary: String(sItem.inputSummary || '').slice(0, 180),
        outputSummary: String(sItem.outputSummary || conclusion).slice(0, 180),
        durationLabel: '0s',
        status: 'done',
      })
    }
  }

  let stepTimeline = []
  if (extractedSteps.length > 0) {
    stepTimeline = extractedSteps.slice(0, 5)
    const lastIdx = stepTimeline.length - 1
    stepTimeline[lastIdx] = Object.assign({}, stepTimeline[lastIdx], {
      phase: isRunning ? 'execute' : 'conclude',
      status: isError ? 'error' : (isRunning ? 'running' : 'done'),
      outputSummary: stepTimeline[lastIdx].outputSummary || conclusion,
    })
  } else if (wfNode && Array.isArray(wfNode.decisions) && wfNode.decisions.length > 0) {
    stepTimeline = wfNode.decisions.slice(0, 5).map((d, idx, arr) => ({
      step: idx + 1,
      phase: idx === 0 ? 'delegate' : (idx === arr.length - 1 && !isRunning ? 'conclude' : 'execute'),
      tool: String((d && (d.tool || d.action)) || `${role}.step`),
      title: String((d && (d.title || d.summary || d.decision)) || `执行步骤 #${idx + 1}`),
      inputSummary: delegationPrompt.slice(0, 180),
      outputSummary: String((d && (d.summary || d.decision)) || conclusion).slice(0, 180),
      durationLabel: '0s',
      status: isError && idx === arr.length - 1 ? 'error' : (isRunning && idx === arr.length - 1 ? 'running' : 'done'),
    }))
  }

  const effectiveTokens = Number(matchedNode.tokens) > 0 ? Number(matchedNode.tokens) : 0
  const effectiveSteps = Math.max(Number(matchedNode.steps) || 0, extractedSteps.length)
  const effectiveDurationLabel = matchedNode.durationLabel || '0s'
  const effectiveWave = matchedNode.wave !== undefined && matchedNode.wave !== null
    ? Number(matchedNode.wave)
    : (isRootMatch ? 0 : 2)
  const effectiveStatus = isError
    ? 'error'
    : (isRunning
      ? 'running'
      : ((matchedNode.status && matchedNode.status !== 'pending') ? matchedNode.status : 'done'))

  const childIdx = Math.max(0, synth.childNodes.findIndex((c) => c.id === matchedNode.id || c.role === role))
  const lmtexMeta = computeWorkerLmtexMeta(Object.assign({}, matchedNode, {
    isRoot: isRootMatch,
    role,
    wave: effectiveWave,
    status: effectiveStatus,
    steps: effectiveSteps,
    turns: matchedNode.turns || matchedNode.rounds || Math.max(1, Math.ceil(Math.max(1, effectiveSteps) / 2)),
    toolCalls: matchedNode.toolCalls !== undefined ? matchedNode.toolCalls : extractedSteps.length,
    completionConclusion: conclusion,
    tools: (Array.isArray(matchedNode.tools) && matchedNode.tools.length > 0)
      ? matchedNode.tools
      : extractedSteps.map((st) => st.tool).filter(Boolean),
  }), isRootMatch ? 0 : childIdx, { store, engagementId: currentEng })

  return {
    ok: true,
    sessionId: matchedRealSessionId || targetId || synth.rootNode.id,
    isRealHostSession: Boolean(matchedRealSessionId),
    agentId: targetId || matchedNode.id || synth.rootNode.id,
    isRoot: isRootMatch,
    title: matchedNode.title || matchedNode.label || '子智能体执行会话',
    role: role || 'assess',
    wave: effectiveWave,
    model: matchedNode.model || 'deepseek-v4.1',
    status: effectiveStatus,
    tokens: effectiveTokens,
    steps: effectiveSteps,
    durationLabel: effectiveDurationLabel,
    delegationPrompt,
    assigned_goal: matchedNode.assigned_goal || delegationPrompt,
    files_owned: parseJsonArraySafe(matchedNode.filesOwned ?? matchedNode.files_owned ?? matchedNode.files_owned_json),
    files_touched: matchedNode.filesTouched || lmtexMeta.compressedDigest.filesTouched || [],
    error_detail: matchedNode.error_detail || '',
    stepTimeline,
    conclusion,
    uiPriority: lmtexMeta.uiPriority,
    ui_priority: lmtexMeta.uiPriority,
    priorityWeight: lmtexMeta.priorityWeight,
    priority_weight: lmtexMeta.priorityWeight,
    priorityLabel: lmtexMeta.priorityLabel,
    priority_label: lmtexMeta.priorityLabel,
    workerTags: lmtexMeta.workerTags,
    worker_tags: lmtexMeta.workerTags,
    compressedDigest: lmtexMeta.compressedDigest,
    compressed_digest: lmtexMeta.compressedDigest,
    approvalState: lmtexMeta.approvalState,
    approval_state: lmtexMeta.approvalState,
    nextGoal: lmtexMeta.nextGoal,
    next_goal: lmtexMeta.nextGoal,
  }
}
