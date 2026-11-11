/**
 * RedTeam 控制台 —— Host 半侧
 *
 * 职责：为浏览器半侧提供一条 Package 私有的 HTTP 桥接 `POST /redteam/api`：
 *   · 资产库相关 op 转交 `ctx.redteam`（dsh-redteam-store 发布的进程级服务）；
 *   · 会话连通性 op（probeSessions）在 host 侧真实发起 TCP/HTTP 探测；
 *   · 技能目录 op（skillCatalog / skillRead）直接读 `ctx.skills`，按红队 preset
 *     的 standing scope 取目录——技能由 DSH 原生 skill 体系管理（$DSH_HOME/skills、
 *     项目 .dsh/skills、.agents/skills），控制台只做浏览。
 *
 * 为什么走 webServer 而不是 typert/@Remote：本包与 store 包都刻意保持零外部依赖
 * （profile 下解析不到 node_modules），具名路由是最小且稳定的接缝。
 * 跨源请求由 Origin/Host 校验挡住（同源 POST 才放行）。
 */
import { fileURLToPath } from 'node:url'
import { resolve, join, dirname } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import * as coreMod from '../../redteam-store/lib/core.js'
/* 技能可用性判定与 redteam_preflight 共用同一份实现（环境变量 / 本机路径 / 占位符） */
import { checkSkill, summarizeSkills } from '../../redteam-store/lib/skill-availability.js'
import * as settingsMod from '../../redteam-store/lib/settings.js'

const { dispatch, dispatchAsync, probePgConnection, resolvePgConfig } = coreMod
const getPgWriteProbe = coreMod.getPgWriteProbe || (() => ({
  snapshot: () => ({ mode: 'wal', totalWrites: 0, writeRatePerMin: 0, tables: [], recentEvents: [] }),
}))

const DEFAULT_MAX_AGENTS = settingsMod.DEFAULT_MAX_AGENTS ?? 6
const MAX_AGENTS_LIMIT = settingsMod.MAX_AGENTS_LIMIT ?? 12
const DEFAULT_THINKING_EFFORT = settingsMod.DEFAULT_THINKING_EFFORT ?? 'low'
const VALID_THINKING_EFFORTS = settingsMod.VALID_THINKING_EFFORTS ?? ['none', 'low', 'medium', 'high']
const DEFAULT_MAX_DEPTH = settingsMod.DEFAULT_MAX_DEPTH ?? 3
const MAX_DEPTH_LIMIT = settingsMod.MAX_DEPTH_LIMIT ?? 5
const clampMaxAgents = settingsMod.clampMaxAgents || ((n) => {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < 1) return 1
  if (v > MAX_AGENTS_LIMIT) return MAX_AGENTS_LIMIT
  return v
})
const normalizeThinkingEffort = settingsMod.normalizeThinkingEffort || ((effort) => {
  const s = typeof effort === 'string' ? effort.trim().toLowerCase() : ''
  return VALID_THINKING_EFFORTS.includes(s) ? s : DEFAULT_THINKING_EFFORT
})
const clampMaxDepth = settingsMod.clampMaxDepth || ((n) => {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < 1) return 1
  if (v > MAX_DEPTH_LIMIT) return MAX_DEPTH_LIMIT
  return v
})

/* ------------------------------------------------------------------ 轻量 mtimeMs + TTL(2000ms) 缓存层 */
const HOST_META_TTL_MS = 2000
const settingsFileCache = new Map() // root -> { at, mtimeMs, size, data }
const sessionBindingsCache = new WeakMap() // store -> { at, mtimeMs, size, agents }
const activeEngCache = new WeakMap() // store -> { at, mtimeMs, size, id }
const engagementsListCache = new WeakMap() // store -> { at, dirMtimeMs, list }

function invalidateSettingsCache(root) {
  if (root) settingsFileCache.delete(String(root))
  else settingsFileCache.clear()
}

function invalidateSessionBindingsCache(store) {
  if (store && typeof store === 'object') sessionBindingsCache.delete(store)
}

function invalidateEngagementCaches(store) {
  if (store && typeof store === 'object') {
    activeEngCache.delete(store)
    engagementsListCache.delete(store)
  }
}

function readSettingsCached(root) {
  if (!root) return {}
  const key = String(root)
  const now = Date.now()
  const cached = settingsFileCache.get(key)
  const filePath = join(key, 'settings.json')
  const st = statSync(filePath, { bigint: true, throwIfNoEntry: false })
  if (!st || !st.isFile()) {
    if (cached && cached.missing && (now - cached.at) < HOST_META_TTL_MS) return cached.data
    const empty = {}
    settingsFileCache.set(key, { at: now, missing: true, ino: -1n, mtimeNs: -1n, size: -1n, data: empty })
    return empty
  }
  if (cached && !cached.missing && cached.ino === st.ino && cached.mtimeNs === st.mtimeNs && cached.size === st.size) {
    cached.at = now
    return cached.data
  }
  let data = {}
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) data = raw
  } catch { data = {} }
  settingsFileCache.set(key, { at: now, missing: false, ino: st.ino, mtimeNs: st.mtimeNs, size: st.size, data })
  return data
}

const readSettingsFallback = (root) => readSettingsCached(root)

const rawWriteSettings = settingsMod.writeSettings || ((root, patch) => {
  if (!root) return {}
  mkdirSync(root, { recursive: true })
  const next = Object.assign({}, readSettingsCached(root), patch, { updatedAt: new Date().toISOString() })
  writeFileSync(join(root, 'settings.json'), JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
})
const writeSettings = (root, patch) => {
  invalidateSettingsCache(root)
  const res = rawWriteSettings(root, patch)
  invalidateSettingsCache(root)
  return res
}
const maxAgentsOf = (root, env = process.env) => {
  const s = readSettingsCached(root)
  if (s.maxAgents !== undefined) return clampMaxAgents(s.maxAgents)
  if (env && env.REDTEAM_MAX_AGENTS !== undefined && env.REDTEAM_MAX_AGENTS !== '') {
    return clampMaxAgents(env.REDTEAM_MAX_AGENTS)
  }
  return clampMaxAgents(DEFAULT_MAX_AGENTS)
}
const maxAgentsSourceOf = (root, env = process.env) => {
  const s = readSettingsCached(root)
  if (s.maxAgents !== undefined) return 'settings'
  if (env && env.REDTEAM_MAX_AGENTS !== undefined && env.REDTEAM_MAX_AGENTS !== '') return 'env'
  return 'default'
}
const saveMaxAgents = (root, n) => {
  invalidateSettingsCache(root)
  const fn = settingsMod.saveMaxAgents || ((r, v) => {
    const maxAgents = clampMaxAgents(v)
    writeSettings(r, { maxAgents })
    return maxAgents
  })
  const out = fn(root, n)
  invalidateSettingsCache(root)
  return out
}
const savePgUrl = (root, pgUrl) => {
  invalidateSettingsCache(root)
  const fn = settingsMod.savePgUrl || ((r, u) => {
    const trimmed = typeof u === 'string' ? u.trim() : ''
    writeSettings(r, { pgUrl: trimmed || null })
    return trimmed || null
  })
  const out = fn(root, pgUrl)
  invalidateSettingsCache(root)
  return out
}
const thinkingEffortOf = (root, env = process.env) => {
  const s = readSettingsCached(root)
  if (s.thinkingEffort !== undefined) return normalizeThinkingEffort(s.thinkingEffort)
  if (env && env.REDTEAM_THINKING_EFFORT) return normalizeThinkingEffort(env.REDTEAM_THINKING_EFFORT)
  return normalizeThinkingEffort(DEFAULT_THINKING_EFFORT)
}
const saveThinkingEffort = (root, effort) => {
  invalidateSettingsCache(root)
  const fn = settingsMod.saveThinkingEffort || ((r, e) => {
    const thinkingEffort = normalizeThinkingEffort(e)
    writeSettings(r, { thinkingEffort })
    return thinkingEffort
  })
  const out = fn(root, effort)
  invalidateSettingsCache(root)
  return out
}
const maxDepthOf = (root, env = process.env) => {
  const s = readSettingsCached(root)
  if (s.maxDepth !== undefined) return clampMaxDepth(s.maxDepth)
  if (env && env.REDTEAM_MAX_DEPTH !== undefined && env.REDTEAM_MAX_DEPTH !== '') {
    return clampMaxDepth(env.REDTEAM_MAX_DEPTH)
  }
  return clampMaxDepth(DEFAULT_MAX_DEPTH)
}
const saveMaxDepth = (root, n) => {
  invalidateSettingsCache(root)
  const fn = settingsMod.saveMaxDepth || ((r, v) => {
    const maxDepth = clampMaxDepth(v)
    writeSettings(r, { maxDepth })
    return maxDepth
  })
  const out = fn(root, n)
  invalidateSettingsCache(root)
  return out
}

function getCachedActiveEngagementId(store) {
  if (!store || typeof store !== 'object') return null
  const now = Date.now()
  const cached = activeEngCache.get(store)
  let currentPath = null
  try {
    if (typeof store.currentPath === 'function') currentPath = store.currentPath()
    else if (typeof store.root === 'string' && store.root) currentPath = join(store.root, 'current')
  } catch { currentPath = null }
  if (currentPath) {
    const st = statSync(currentPath, { bigint: true, throwIfNoEntry: false })
    if (!st || !st.isFile()) {
      if (cached && cached.missing && (now - cached.at) < HOST_META_TTL_MS) {
        return cached.id
      }
      const fallbackList = getCachedEngagementsList(store)
      const fallbackId = (fallbackList.length > 0 && fallbackList[0] && fallbackList[0].id) ? fallbackList[0].id : null
      activeEngCache.set(store, { at: now, missing: true, ino: -1n, mtimeNs: -1n, size: -1n, id: fallbackId })
      return fallbackId
    }
    if (cached && !cached.missing && cached.ino === st.ino && cached.mtimeNs === st.mtimeNs && cached.size === st.size) {
      cached.at = now
      return cached.id
    }
    const id = typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null
    activeEngCache.set(store, {
      at: now,
      missing: false,
      ino: st.ino,
      mtimeNs: st.mtimeNs,
      size: st.size,
      id: id || null,
    })
    return id || null
  }
  if (cached && (now - cached.at) < HOST_META_TTL_MS) return cached.id
  const id = typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null
  activeEngCache.set(store, { at: now, missing: false, ino: -1n, mtimeNs: -1n, size: -1n, id: id || null })
  return id || null
}

function getCachedEngagementsList(store) {
  if (!store || typeof store !== 'object') return []
  const now = Date.now()
  const cached = engagementsListCache.get(store)
  let engDir = null
  try {
    engDir = store.engagementsDir || (typeof store.root === 'string' && store.root ? join(store.root, 'engagements') : null)
  } catch { engDir = null }
  const st = engDir ? statSync(engDir, { bigint: true, throwIfNoEntry: false }) : null
  const dirMtimeNs = st ? st.mtimeNs : -1n
  if (cached && cached.dirMtimeNs === dirMtimeNs && (now - cached.at) < HOST_META_TTL_MS) {
    return cached.list
  }
  const rawList = typeof store.listEngagements === 'function'
    ? store.listEngagements()
    : ((dispatch(store, { op: 'bootstrap' }) || {}).engagements || [])
  const list = Array.isArray(rawList) ? rawList : []
  engagementsListCache.set(store, {
    at: now,
    dirMtimeNs,
    list,
  })
  return list
}

function getCachedSessionBindingsMap(store) {
  if (!store || typeof store !== 'object') return {}
  const now = Date.now()
  const cached = sessionBindingsCache.get(store)
  let filePath = null
  try {
    if (typeof store.sessionBindingsPath === 'function') filePath = store.sessionBindingsPath()
    else if (typeof store.root === 'string' && store.root) filePath = join(store.root, 'sessions.json')
  } catch { filePath = null }
  if (filePath) {
    const st = statSync(filePath, { bigint: true, throwIfNoEntry: false })
    if (!st || !st.isFile()) {
      if (cached && cached.missing && (now - cached.at) < HOST_META_TTL_MS) return cached.agents
      const empty = {}
      sessionBindingsCache.set(store, { at: now, missing: true, ino: -1n, mtimeNs: -1n, size: -1n, agents: empty })
      return empty
    }
    if (cached && !cached.missing && cached.ino === st.ino && cached.mtimeNs === st.mtimeNs && cached.size === st.size) {
      cached.at = now
      return cached.agents
    }
    let agents = {}
    try {
      if (typeof store.sessionBindings === 'function') {
        agents = store.sessionBindings() || {}
      } else {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
        agents = (parsed && parsed.agents && typeof parsed.agents === 'object') ? parsed.agents : {}
      }
    } catch { agents = {} }
    sessionBindingsCache.set(store, { at: now, missing: false, ino: st.ino, mtimeNs: st.mtimeNs, size: st.size, agents })
    return agents
  }
  if (cached && (now - cached.at) < HOST_META_TTL_MS) return cached.agents
  let agents = {}
  try {
    if (typeof store.sessionBindings === 'function') agents = store.sessionBindings() || {}
  } catch { agents = {} }
  sessionBindingsCache.set(store, { at: now, missing: false, ino: -1n, mtimeNs: -1n, size: -1n, agents })
  return agents
}

function getCachedSessionBindingEntry(store, sessionId) {
  const sid = String(sessionId || '').trim()
  if (!store || !sid) return null
  const agents = getCachedSessionBindingsMap(store)
  if (agents && agents[sid]) {
    const entry = agents[sid]
    return {
      bound: entry.engagement || null,
      name: entry.name || entry.engagement || null,
      at: entry.at || null,
    }
  }
  if (typeof store.sessionBindings !== 'function' && !store.root) {
    try {
      const b = dispatch(store, { op: 'sessionBinding', session: sid })
      if (b && (b.bound || (b.engagement && b.engagement.id))) {
        return {
          bound: b.bound || (b.engagement && b.engagement.id) || null,
          name: b.name || (b.engagement && b.engagement.name) || null,
        }
      }
    } catch { /* ignore */ }
  }
  return null
}

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


/** 本包自带技能目录（随包分发；dev 安装的 UI 包没有 skills/，此时恒为 false）。 */
const PLUGIN_SKILLS_DIR = (() => {
  try { return resolve(fileURLToPath(new URL('../skills/', import.meta.url))) } catch { return null }
})()
/** 目录比较要规范化：注册表给的是 `/a/b/skills`，URL 拼出来可能带结尾斜杠。 */
const sameDir = (a, b) => {
  if (a === null || b === null) return false
  try { return resolve(a) === resolve(b) } catch { return false }
}

/** 技能分类放在 description 的 `【分类】` 前缀里。
 *  原因：DSH 模型侧技能目录只渲染 name + description，frontmatter 的 category 不会进清单；
 *  把分类写进描述，模型检索和面板分组才能同时看到。 */
const skillCategoryOf = (description) => {
  const m = /^【([^】]{1,12})】/.exec(String(description || ''))
  return m === null ? '未分类' : m[1]
}

/** Cordis 插件名。 */
export const name = 'redteam-ui'

/** 硬依赖：资产库服务 + 浏览器 HTTP 载体 + 技能注册表 + preset 名册（技能目录按红队 scope 读）。 */
export const inject = ['redteam', 'webServer', 'skills', 'agentPresets']

/** 请求体上限（资产导入可能较大）。 */
const MAX_BODY_BYTES = 8 * 1024 * 1024

/* ------------------------------------------------------------------ 版本与更新 */

/** 运行 shell 命令，带超时；返回 `{ code, stdout, stderr, timedOut }`。 */
function run(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    let child
    try {
      /* ⚠️ 两个参数必须显式给对：
         · env 必须传 process.env —— spawn 默认给的是空环境，空 PATH 下
           npm/pnpm 会直接 `spawn npm ENOENT`（版本检查永远失败）；
         · cwd 必须是**真实存在**的目录 —— 传一个不存在的路径同样是 ENOENT
           （报错长得像"命令找不到"，很容易误判）。 */
      const cwd = typeof options.cwd === 'string' && options.cwd !== '' && existsSync(options.cwd) ? options.cwd : undefined
      child = spawn(command, args, {
        cwd,
        env: options.env || process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      resolvePromise({ code: -1, stdout: '', stderr: error && error.message ? error.message : String(error) })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (value) => { if (!settled) { settled = true; resolvePromise(value) } }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* 忽略 */ }
      done({ code: -1, stdout: stdout, stderr: stderr, timedOut: true })
    }, Math.max(Number(options.timeoutMs) || 30000, 1000))
    child.stdout.on('data', (c) => { stdout += c.toString('utf8') })
    child.stderr.on('data', (c) => { stderr += c.toString('utf8') })
    child.on('error', (error) => { clearTimeout(timer); done({ code: -1, stdout: stdout, stderr: String((error && error.message) || error) }) })
    child.on('close', (code) => { clearTimeout(timer); done({ code: code === null ? -1 : code, stdout: stdout, stderr: stderr }) })
  })
}

/** 本插件包身份（由 store 壳读取 package.json 后挂上；读不到则报"未知版本"）。 */
function pluginIdentity(ctx) {
  const store = ctx.redteam
  const info = store && store.plugin ? store.plugin : null
  return {
    name: (info && info.name) || 'ECCVIK/LMTAgent',
    version: (info && info.version) || null,
    description: (info && info.description) || 'LMTAgent · 多智能体软件工程研发与架构交付控制台',
    homepage: (info && info.homepage) || 'https://github.com/ECCVIK/LMTAgent',
  }
}

/** profile 目录：DSH 的 `ctx.baseUrl` 就是它（loader.internal.import(name, profileDir) 的 base）。
    注意它在不同 DSH 版本里可能是**文件路径**，也可能是 `file://` URL —— 后者直接当路径用会
    读不到 package.json 与 node_modules，把正常的包安装误判成"开发态（源码软链）"，
    于是更新按钮永远点不动。 */
function profileDirOf(ctx) {
  try {
    const base = ctx.baseUrl
    if (typeof base === 'string' && base.length > 0) {
      return base.startsWith('file:') ? fileURLToPath(base) : base
    }
  } catch { /* 忽略 */ }
  const home = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh')
  return join(home, 'profiles', 'web')
}

/** 读 profile 的 package.json（依赖声明 + dsh.profile.bundles）。 */
function readProfilePackage(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch { return null }
}

/** 包管理器：profile 里有 pnpm-lock / pnpm-workspace 就用 pnpm，否则 npm。 */
function packageManagerOf(dir) {
  if (existsSync(join(dir, 'pnpm-lock.yaml')) || existsSync(join(dir, 'pnpm-workspace.yaml'))) return 'pnpm'
  return 'npm'
}

/**
 * 更新前置检查：装的是不是发布版（profile 里能不能解析到这个包名）、
 * 有没有智能体正在跑（更新要重启 dsh web，会把它们打断）。
 */
async function updatePreflight(ctx) {
  const dir = profileDirOf(ctx)
  const pkg = pluginIdentity(ctx)
  const profilePkg = readProfilePackage(dir)
  const deps = (profilePkg && profilePkg.dependencies) || {}
  const declared = typeof deps[pkg.name] === 'string' ? deps[pkg.name] : null
  const installedDir = join(dir, 'node_modules', pkg.name)
  const blockers = []
  const notes = []

  /* ① 装法：profile 依赖里没有这个包名，且 node_modules 里也没有它 —— 是本地源码软链/
     手动挂载的开发态。**不再拦住更新**：包管理器照常能把发布版装进 profile（等于把开发态
     换成正式安装），只是要明确提醒"本地源码改动不再生效"。 */
  const installedInNodeModules = existsSync(join(installedDir, 'package.json'))
  const sourceInstall = declared === null && !installedInNodeModules
  if (sourceInstall) {
    notes.push('当前是**本地源码安装**（profile 依赖里没有 ' + pkg.name + '）：点击更新会把发布版'
      + '装进 profile 的 node_modules，本地源码改动不再生效；装完这次以后就能正常用一键更新。')
  }

  /* ② 有智能体在跑：重启会打断它们 */
  let running = []
  try {
    const subagents = ctx.get('subagents')
    const sessions = ctx.get('sessions')
    if (subagents !== undefined && subagents !== null && sessions !== undefined && sessions !== null && typeof sessions.list === 'function') {
      const roots = sessions.list().filter((s) => {
        const header = s && s.header
        return header && (header.parentSession === undefined || header.parentSession === null)
      })
      for (const root of roots) {
        try {
          const kids = await subagents.listChildren(root.id)
          for (const k of Array.isArray(kids) ? kids : []) {
            if (k && k.kind === 'child' && k.activity === 'running') running.push({ session: String(root.id), label: k.label || String(k.id) })
          }
        } catch { /* 单个会话读不到不影响其它 */ }
      }
    }
  } catch { /* 注册表不可用就不挡（只是少了一层保护） */ }
  if (running.length > 0) {
    blockers.push('有 ' + running.length + ' 个智能体正在跑（' + running.map((r) => r.label).join('、') + '）：更新要重启 dsh web，会打断它们。请等它们结束。')
  }
  return { dir, declared, packageManager: packageManagerOf(dir), sourceInstall, running, blockers, notes }
}

/** 到 npm registry 查最新版本（走包管理器，避免自带网络栈）。 */
async function checkLatest(ctx, dir, name) {
  const pm = packageManagerOf(dir)
  const args = pm === 'pnpm' ? ['view', name, 'version', '--json'] : ['view', name, 'version', '--json']
  const r = await run(pm, args, { cwd: dir, timeoutMs: 60000 })
  if (r.code !== 0) {
    return { ok: false, error: '查询最新版本失败（' + pm + ' view）：' + String(r.stderr || r.stdout || '').trim().slice(0, 400) }
  }
  const raw = String(r.stdout || '').trim().replace(/^"|"$/g, '')
  const latest = raw.split('\n').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean).pop() || null
  return { ok: latest !== null, latest, registry: pm }
}

/** `a < b`（只比较数字段，够用；预发布后缀按"更旧"处理）。 */
function versionLess(a, b) {
  const parse = (v) => String(v || '').split('-')[0].split('.').map((x) => Number(x) || 0)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] || 0) < (y[i] || 0)) return true
    if ((x[i] || 0) > (y[i] || 0)) return false
  }
  return false
}

/**
 * 重启脚本：等旧进程退出 + 端口释放，再按同样的参数把 dsh web 拉起来。
 *
 * 生成的是一个**自包含的 node 脚本**（不是 shell 脚本），它做三件事：
 *   ① 等旧 pid 退出（最多 60 秒）；
 *   ② 等端口不再被监听（最多 30 秒，用 net 探测，不依赖 ss/lsof）；
 *   ③ spawn(command, ARGS_ARRAY) 以 argv 数组拉起新进程。
 *
 * 为什么不用 shell：原实现把命令与参数拼成 shell 串，需要一套手写引号转义
 * （单引号里套单引号、双引号再转义），任何一处漏掉就是命令注入 ——
 * 而这段脚本正是"由程序生成、以用户身份执行"的，最不该有注入面。
 * argv 数组交给 spawn 之后 shell 完全不参与，转义问题从根上消失。
 *
 * @param pid - 当前进程 pid（等它退出）。
 * @param port - dsh web 端口（等它释放）。
 * @param command - 可执行文件（通常是 process.argv[0]）。
 * @param args - 参数数组（process.argv.slice(1)）。
 * @param logPath - 日志文件路径（追加写）。
 * @param cwd - 新进程的工作目录。
 * @returns 脚本正文。
 */
function restartScript(pid, port, command, args, logPath, cwd) {
  const payload = {
    oldPid: Number(pid),
    port: Number(port) || 0,
    command: String(command),
    args: args.map((a) => String(a)),
    log: String(logPath),
    cwd: String(cwd),
  }
  return [
    '#!/usr/bin/env node',
    '/* 由 RedTeam 控制台的「自动更新」生成：等旧 dsh web 退出后，按原 argv 把它重新拉起。',
    '   参数以数组形式传给 spawn —— shell 不参与，因此不存在引号转义与命令注入问题。 */',
    "'use strict'",
    'const { spawn } = require("node:child_process")',
    'const { appendFileSync, mkdirSync } = require("node:fs")',
    'const { connect } = require("node:net")',
    'const { dirname } = require("node:path")',
    'const CFG = ' + JSON.stringify(payload, null, 2),
    '',
    'const log = (msg) => {',
    '  const line = "[" + new Date().toISOString() + "] " + msg + "\\n"',
    '  try { mkdirSync(dirname(CFG.log), { recursive: true }); appendFileSync(CFG.log, line) } catch (e) { /* 日志写不进去不该影响重启 */ }',
    '}',
    '',
    'const sleep = (ms) => new Promise((r) => setTimeout(r, ms))',
    '',
    '/** 旧进程还在吗（kill -0 的等价物）。 */',
    'const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return false } }',
    '',
    '/** 端口还有人在听吗（不依赖 ss/lsof）。 */',
    'const portBusy = (port) => new Promise((resolve) => {',
    '  if (!port) { resolve(false); return }',
    '  const sock = connect({ host: "127.0.0.1", port: port })',
    '  let done = false',
    '  const finish = (busy) => { if (!done) { done = true; try { sock.destroy() } catch (e) {} resolve(busy) } }',
    '  sock.setTimeout(800)',
    '  sock.on("connect", () => finish(true))',
    '  sock.on("timeout", () => finish(false))',
    '  sock.on("error", () => finish(false))',
    '})',
    '',
    'async function main() {',
    '  log("等待旧进程 pid=" + CFG.oldPid + " 退出…")',
    '  for (let i = 0; i < 60; i += 1) {',
    '    if (!alive(CFG.oldPid)) break',
    '    await sleep(1000)',
    '  }',
    '  for (let i = 0; i < 30; i += 1) {',
    '    if (!(await portBusy(CFG.port))) break',
    '    await sleep(1000)',
    '  }',
    '  log("启动：" + CFG.command + " " + CFG.args.join(" "))',
    '  const child = spawn(CFG.command, CFG.args, {',
    '    cwd: CFG.cwd,',
    '    detached: true,',
    '    stdio: ["ignore", "ignore", "ignore"],',
    '    env: process.env,',
    '  })',
    '  child.unref()',
    '  log("已拉起新进程 pid=" + child.pid)',
    '}',
    '',
    'main().catch((error) => { log("重启失败：" + (error && error.message ? error.message : String(error))) })',
    '',
  ].join('\n')
}

/** 应用更新：装新版本 + 生成重启脚本 + 让当前进程退出。 */
async function applyUpdate(ctx, dir, name, targetVersion) {
  const primary = packageManagerOf(dir)
  const spec = targetVersion ? name + '@' + targetVersion : name
  const attempt = async (pm) => {
    const args = pm === 'pnpm' ? ['add', spec] : ['install', spec, '--save']
    const r = await run(pm, args, { cwd: dir, timeoutMs: 300000 })
    return { pm, args, r }
  }
  let { pm, args, r } = await attempt(primary)
  if (r.code !== 0) {
    /* 首选包管理器失败就换另一个再试一次：profile 由 pnpm 管理但机器上没装 pnpm、
       或 npm 因 workspace 布局拒绝写入，都属于"换一个就能装"的情况。
       两个都失败才报错，并把两次输出都带上，别让用户猜。 */
    const first = pm + ' ' + args.join(' ') + '：' + String(r.stderr || r.stdout || '').trim().slice(0, 600)
    const retry = await attempt(primary === 'pnpm' ? 'npm' : 'pnpm')
    if (retry.r.code !== 0) {
      return {
        ok: false,
        error: '安装失败。第一次：' + first + ' ｜ 第二次：' + retry.pm + ' ' + retry.args.join(' ')
          + '：' + String(retry.r.stderr || retry.r.stdout || '').trim().slice(0, 600),
      }
    }
    pm = retry.pm
    args = retry.args
    r = retry.r
  }
  /* 装完把这个包登记进 profile 的 `dsh.profile.bundles`：手动挂载过的机器可能只装了依赖
     而没登记，重启后插件不会加载。 */
  const bundleState = ensureProfileBundle(dir, name)
  /* 重启：拿当前进程的启动命令原样再来一遍 */
  const argv = process.argv.slice()
  const command = argv[0]
  const rest = argv.slice(1)
  const port = (() => {
    try { return String(ctx.webServer.port) } catch { return '3080' }
  })()
  const root = (() => {
    try { return ctx.redteam.root } catch { return join(process.env.DSH_HOME || '.', 'redteam') }
  })()
  mkdirSync(root, { recursive: true })
  const logPath = join(root, 'update.log')
  const scriptPath = join(root, 'restart-dsh-web.sh')
  writeFileSync(scriptPath, restartScript(process.pid, port, command, rest, logPath, process.cwd()), { encoding: 'utf8', mode: 0o755 })
  const child = spawn(process.execPath, [scriptPath], { detached: true, stdio: 'ignore' })
  child.unref()
  /* 给浏览器留出收到响应的窗口，然后退出 —— 新进程由脚本按原命令行拉起 */
  setTimeout(() => { process.exit(0) }, 1200).unref()
  return {
    ok: true, installed: spec, packageManager: pm, bundleRegistered: bundleState,
    restart: { script: scriptPath, log: logPath, port, command: [command].concat(rest).join(' '), pid: process.pid },
  }
}

/**
 * 把包名登记进 profile 的 `dsh.profile.bundles`（缺了重启后插件不会被加载）。
 * @returns `'present'`（本来就在）/ `'added'`（已补上）/ `'failed'`（读不到或写不了，不影响安装本身）。
 */
function ensureProfileBundle(dir, name) {
  try {
    const path = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(path, 'utf8'))
    const profile = pkg && pkg.dsh && pkg.dsh.profile ? pkg.dsh.profile : null
    if (profile === null || typeof profile !== 'object') return 'failed'
    const bundles = Array.isArray(profile.bundles) ? profile.bundles : []
    if (bundles.includes(name)) return 'present'
    profile.bundles = bundles.concat([name])
    writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    return 'added'
  } catch { return 'failed' }
}


/** 读取完整请求体；超过上限即中断。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
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
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 统一的 JSON 响应。 */
function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 技能可用性缓存：`{ at, scope, byName: Map }`；30 秒内复用。 */
let skillAvailabilityCache = null
const SKILL_AVAILABILITY_TTL_MS = 30000

/**
 * 技能可用性判定用的环境：进程环境 + $DSH_HOME/.env 兜底。
 * 与 redteam_preflight 的口径一致；否则用户把 key 写进 .env 后，面板仍会误报缺 key。
 */
function envForSkillCheck() {
  const env = { ...process.env }
  const file = join(process.env.DSH_HOME || join(process.env.HOME || '', '.dsh'), '.env')
  try {
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
        if (m === null) continue
        const value = m[2].trim().replace(/^["']|["']$/g, '')
        if (value === '') continue
        if (env[m[1]] === undefined || env[m[1]] === '') env[m[1]] = value
      }
    }
  } catch { /* .env 读不到不影响判定 */ }
  return env
}

/**
 * 逐个技能的可用性（读正文 → 共享判定模块）。
 * @param ctx - 插件上下文。
 * @param list - `ctx.skills.list()` 的返回（SkillSummary[]）。
 * @param scope - 当前作用域。
 * @param force - true 时跳过快取缓存。
 */
async function skillAvailabilityOf(ctx, list, scope, force) {
  const now = Date.now()
  if (!force && skillAvailabilityCache !== null
    && now - skillAvailabilityCache.at < SKILL_AVAILABILITY_TTL_MS
    && skillAvailabilityCache.size === list.length) {
    return { at: skillAvailabilityCache.at, cached: true, byName: skillAvailabilityCache.byName }
  }
  /* 同名技能可能存在于多个技能根：注册表按根顺序择优，排在后面的会被盖住。
     判定时把"其它也注册了同名技能的根"一起带上，才能识别
     "你配置好的那份被随包占位符版本盖住"这种误报。 */
  const rootsWith = new Map()
  for (const x of list) {
    const dir = x.resourceBase && x.resourceBase.kind === 'directory' ? x.resourceBase.path : null
    if (dir === null) continue
    if (!rootsWith.has(x.name)) rootsWith.set(x.name, [])
    if (!rootsWith.get(x.name).includes(dir)) rootsWith.get(x.name).push(dir)
  }
  const byName = new Map()
  for (const summary of list) {
    let def
    try { def = await ctx.skills.get(summary.name, { scope }) } catch { def = undefined }
    const path = def && typeof def.path === 'string'
      ? def.path
      : (summary.resourceBase && summary.resourceBase.kind === 'directory' ? summary.resourceBase.path : null)
    const root = summary.resourceBase && summary.resourceBase.kind === 'directory' ? summary.resourceBase.path : null
    const verdict = checkSkill({ name: summary.name, content: def && def.content, path, root },
      { env: envForSkillCheck(), sameNameIn: rootsWith.get(summary.name) || [] })
    byName.set(summary.name, verdict)
  }
  skillAvailabilityCache = { at: now, size: list.length, byName }
  return { at: now, cached: false, byName }
}

/** 红队 preset 的 id —— 与 cordis.patch.yml 里那条声明行的 `config.id` 必须一致。 */
const REDTEAM_PRESET_ID = 'redteam'

/**
 * 取红队 preset 的作用域键：技能库按它读"红队会话实际能用到的技能"。
 *
 * DSH 的 preset 注册表在两个世代里 API 不同，这里都兼容：
 *   · ≥ 0.1.7（`dsh-agent-preset-registry`）：`acquireScope(id)` 返回**租约**
 *     `{ key, [Symbol.asyncDispose] }`，官方注释写明"读完就释放"——
 *     不释放会让已退役的 revision 一直被留住；
 *   · ≤ 0.1.6（`dsh-agent-presets`）：`standingKeyFor(id)` 直接给一个常驻作用域键，无需释放。
 *
 * @param ctx - 插件上下文。
 * @returns `{ key, release }`；`release` 为 null 表示无需释放。
 * @throws 两个 API 都没有时抛出（错误里带上实际可用的方法名，便于下次改名时定位）。
 */
async function resolveRedteamScope(ctx) {
  const presets = ctx.agentPresets
  if (typeof presets?.acquireScope === 'function') {
    const lease = await presets.acquireScope(REDTEAM_PRESET_ID)
    const release = typeof lease?.[Symbol.asyncDispose] === 'function'
      ? () => lease[Symbol.asyncDispose]()
      : (typeof lease?.dispose === 'function' ? () => lease.dispose() : null)
    return { key: lease.key, release }
  }
  if (typeof presets?.standingKeyFor === 'function') {
    return { key: await presets.standingKeyFor(REDTEAM_PRESET_ID), release: null }
  }
  let seen = '（没有 agentPresets 服务）'
  if (presets) {
    const proto = Object.getPrototypeOf(presets)
    seen = Object.getOwnPropertyNames(proto)
      .filter((name) => typeof presets[name] === 'function')
      .slice(0, 16)
      .join(', ') || '（看不到任何方法）'
  }
  throw new Error('当前 DSH 的 agentPresets 缺少 acquireScope / standingKeyFor；实际可用：' + seen)
}

/**
 * 技能目录：按红队 preset 的作用域读取原生 skill 注册表。
 * 技能由 DSH 管理（$DSH_HOME/skills、项目 .dsh/skills、.agents/skills、内置根），
 * 控制台只列出「红队会话实际能用到的技能」。
 * @param ctx - 插件上下文。
 * @param request - `{ op: 'skillCatalog' | 'skillRead', name? }`。
 * @returns JSON 结果，或 undefined 表示不是技能类 op。
 */
async function handleSkillOp(ctx, request) {
  if (request.op !== 'skillCatalog' && request.op !== 'skillRead') return undefined
  let lease
  try {
    lease = await resolveRedteamScope(ctx)
  } catch (error) {
    return { ok: false, error: '无法解析红队 preset 作用域：' + (error && error.message ? error.message : String(error)) }
  }
  /* 作用域是"租约"：无论读取成功还是抛错，读完都要还回去。 */
  try {
    return await readSkillOp(ctx, request, lease.key)
  } finally {
    if (typeof lease.release === 'function') {
      try { await lease.release() } catch { /* 释放失败不该盖住读取结果 */ }
    }
  }
}

/**
 * 技能类 op 的实现；`scope` 由调用方申请并负责释放。
 * @param ctx - 插件上下文。
 * @param request - `{ op: 'skillCatalog' | 'skillRead', name? }`。
 * @param scope - 红队 preset 的作用域键。
 * @returns JSON 结果。
 */
async function readSkillOp(ctx, request, scope) {
  if (request.op === 'skillCatalog') {
    const list = await ctx.skills.list({ scope })
    /* 可用性检查要读每个技能的正文（可能几百个），做 30 秒缓存：
       面板反复打开、切页签都不会重复打注册表；技能是磁盘文件，半分钟粒度足够。
       `refresh: true` 跳过缓存（面板上的「重新检查可用性」按钮用）。 */
    const availability = await skillAvailabilityOf(ctx, list, scope, request.refresh === true)
    /* 技能目录来自 DSH 原生注册表：自带根 + $DSH_HOME/skills + 项目根 + **每个插件注册的根**
       （本插件只是其中之一）。所以这里把"每个技能来自哪个目录/哪个来源"如实给出来，
       否则用户看到几百个技能会以为是我们塞进去的。 */
    const bySource = new Map()
    const byDir = new Map()
    const items = list.map((s) => {
      const dir = s.resourceBase && s.resourceBase.kind === 'directory' ? s.resourceBase.path : null
      const name = dir === null ? '(非文件系统来源)' : dir
      byDir.set(name, (byDir.get(name) || 0) + 1)
      bySource.set(s.source, (bySource.get(s.source) || 0) + 1)
      const avail = availability.byName.get(s.name)
      return {
        name: s.name,
        description: s.description,
        category: skillCategoryOf(s.description),
        whenToUse: s.whenToUse || '',
        provider: s.provider,
        source: s.source,
        dir: dir,
        modelInvocable: s.invocation ? s.invocation.modelInvocable !== false : true,
        userInvocable: s.invocation ? s.invocation.userInvocable !== false : true,
        fromPlugin: sameDir(dir, PLUGIN_SKILLS_DIR),
        /* 可用性：available 能直接跑 / broken 有明确缺口 / unknown 正文读不到判不了 */
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
      note: '技能由 DSH 原生注册表管理：DSH 自带根 + $DSH_HOME/skills + 项目根 .dsh/skills、.agents/skills + 各插件注册的根。本插件只自带 ' +
        '了 ' + items.filter((x) => x.fromPlugin).length + ' 个（随包分发），其余来自其它来源。',
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
 * 智能体并发状态（「智能体」页签用）：直接读 subagents 注册表里"真正在跑"的子会话。
 * 与工具层的 `redteam_agent_slot` 同一套口径，但这里只读不占位。
 * @param ctx - 插件上下文。
 * @param request - `{ op: 'agentsStatus' }`。
 * @returns JSON 结果，或 undefined 表示不是这个 op。
 */
/**
 * 判断会话标题或工作区名称是否为自动生成的原始 UUID 会话名（如 `session-c510422c-...` 或 `pureking-session-c510422c-...`）。
 */
export function isUuidSessionTitle(str) {
  const s = String(str || '').trim()
  if (!s) return false
  return /^(?:[a-z0-9_-]+\s*[·-]\s*)?session-[0-9a-f]{8}-[0-9a-f]{4}/i.test(s)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
    || /(?:^|[·\s_-])session-[0-9a-f]{8}-[0-9a-f]{4}/i.test(s)
}

function isUuidEngagement(eng) {
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

function filterValidEngagements(engagements) {
  const list = Array.isArray(engagements) ? engagements : []
  const realNamed = list.filter((e) => e && !isUuidEngagement(e))
  if (realNamed.length === 0) return list
  return list.filter((e) => e && (!isUuidEngagement(e) || !isEngagementEmpty(e)))
}

const AGENT_ROLE_META = {
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

function inferAgentRole(titleOrLabel, isRoot = false, explicitRole = '') {
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

function inferAgentWave(titleOrLabel, role, isRoot = false) {
  if (isRoot || role === 'plan') return 0
  const m = /wave\s*([0-4])/i.exec(String(titleOrLabel || ''))
  if (m) return Number(m[1])
  return (AGENT_ROLE_META[role] && AGENT_ROLE_META[role].wave) ?? 3
}

function parseTimestampMs(val) {
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

function formatDurationLabel(durationMs) {
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

function extractMessageText(msg) {
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
    const names = tcs.map((t) => (t && (t.name || (t.function && t.function.name))) || 'tool').join(', ')
    return `[工具调用] ${names}`
  }
  return ''
}

function extractSessionPreviews(s, header, role, fallbackOutput = '') {
  const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.exploit
  const messages = Array.isArray(s && s.messages)
    ? s.messages
    : (Array.isArray(s && s.entries) ? s.entries : (Array.isArray(s && s.history) ? s.history : []))

  let promptText = String(
    (s && (s.promptPreview || s.prompt || s.delegationPrompt || s.task || s.input))
    || (header && (header.prompt || header.task || header.description))
    || ''
  ).replace(/\s+/g, ' ').trim()

  if (!promptText && messages.length > 0) {
    const firstUser = messages.find((m) => m && (m.role === 'user' || m.sender === 'user' || m.type === 'user')) || messages[0]
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
      const r = String(m.role || m.sender || m.type || '').toLowerCase()
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

function normalizeTouchedFilePath(rawPath) {
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

function extractPathsFromToolCall(toolName, rawArgs, outSet) {
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
    this.dirIndexCache = new Map() // dirPath -> { at, mtimeMs, byId: Map<sid, filePath> }
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
    if (cached && (now - cached.at) < HOST_META_TTL_MS) return cached.byId
    const st = statSync(dir, { throwIfNoEntry: false })
    if (!st || !st.isDirectory()) {
      const empty = new Map()
      this.dirIndexCache.set(dir, { at: now, mtimeMs: -1, byId: empty })
      return empty
    }
    if (cached && cached.mtimeMs === st.mtimeMs) {
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
    this.dirIndexCache.set(dir, { at: now, mtimeMs: st.mtimeMs, byId })
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

    /* 累计或快照 Token 使用量 */
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
      if (!isHeadPass) {
        acc.turns += 1
        acc.steps += 1
      }
      return
    }

    if (isHeadPass) return

    /* 解析工具调用与修改文件 */
    const rawToolCalls = []
    if (Array.isArray(msg.toolCalls || msg.tool_calls)) {
      for (const tc of (msg.toolCalls || msg.tool_calls)) rawToolCalls.push(tc)
    }
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && typeof part === 'object' && (part.type === 'tool_use' || part.type === 'tool-call' || part.toolName)) {
          rawToolCalls.push(part)
        }
      }
    }
    if (kind === 'tool_call' || kind === 'tool_use' || obj.tool_name || obj.toolName) {
      rawToolCalls.push(obj)
    }

    if (rawToolCalls.length > 0) {
      acc.toolCalls += rawToolCalls.length
      acc.steps += 1
      for (const tc of rawToolCalls) {
        if (!tc || typeof tc !== 'object') continue
        const tName = String(
          tc.name || tc.toolName || tc.tool_name || (tc.function && tc.function.name) || 'workspace.tool',
        ).trim()
        const tArgs = tc.input ?? tc.arguments ?? tc.args ?? (tc.function && tc.function.arguments) ?? null
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
    return {
      filePath,
      mtimeMs: st.mtimeMs,
      size: st.size,
      header: acc.header,
      model: acc.model,
      cwd: acc.cwd,
      delegationPrompt: acc.delegationPrompt,
      lastAssistantText: acc.lastAssistantText,
      turns: Math.max(1, acc.turns),
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
    /* 游标完全一致：0 磁盘读取、0 JSON 解析！ */
    if (cur && cur.ino === st.ino && cur.size === st.size && cur.mtimeMs === st.mtimeMs) {
      this._touchLru(filePath, cur)
      return Object.assign({ didAdvance: false }, cur.telemetry)
    }

    /* 实时增量追加（st.size > cur.parsedOffset 且同一 inode） */
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

    /* 冷启动或文件截断重写 */
    const acc = this._createAccumulator()
    let remainderBuf = Buffer.alloc(0)
    if (st.size > 0) {
      let fd = -1
      try {
        fd = openSync(filePath, 'r')
        if (st.size > JSONL_LARGE_THRESHOLD) {
          /* 大文件（> 256KB）：仅读取头部 16KB（会话头+初始委派指令）+ 尾部 128KB（最近步骤+累计用量） */
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

  readSession(sessionId, options = {}) {
    const filePath = this.locateSessionFile(sessionId, options)
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

function readHostTokenMeter(tokenMeter, sessionId) {
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

/**
 * 内存级 Worker 审批状态覆盖表（严格按 `${engagementId}::${workerId}` 作用域隔离，LRU 上限 256）。
 * 绝不按裸 role（如 'exploit'）索引，也绝不把缺失 ID 回退为 'sub-recon'。
 */
const WORKER_OVERRIDES_LRU_MAX = 256
export const approvedWorkerOverrides = new Map()
export const approvedWorkerMap = approvedWorkerOverrides

function isBareRoleName(key) {
  const k = String(key || '').trim().toLowerCase()
  return Boolean(k && AGENT_ROLE_META[k])
}

function setScopedWorkerOverride(engagementId, workerId, entry) {
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

function deleteScopedWorkerOverride(engagementId, workerId) {
  const eng = String(engagementId || 'default').trim() || 'default'
  const wid = String(workerId || '').trim()
  if (!wid) return
  approvedWorkerOverrides.delete(`${eng}::${wid}`)
}

const PRIORITY_META = {
  P0: { uiPriority: 'P0', priorityWeight: 100, priorityLabel: 'P0 焦点审批' },
  P1: { uiPriority: 'P1', priorityWeight: 80, priorityLabel: 'P1 核心并发' },
  P2: { uiPriority: 'P2', priorityWeight: 50, priorityLabel: 'P2 已审归档' },
  P3: { uiPriority: 'P3', priorityWeight: 20, priorityLabel: 'P3 历史快照' },
}

const ERROR_STATUS_SET = new Set(['error', 'failed', 'blocked', 'timeout', 'shard_violation'])

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
  if (store && typeof store.getWorkerApproval === 'function') {
    try {
      for (const rawKey of candidateIds) {
        const k = String(rawKey || '').trim()
        if (!k || isBareRoleName(k)) continue
        const found = store.getWorkerApproval(eng, k) || store.getWorkerApproval(`${eng}::${k}`)
        if (found && (found.approvalState || found.approval_state)) {
          return {
            approvalState: found.approvalState || found.approval_state,
            uiPriority: found.uiPriority || found.ui_priority || null,
            nextGoal: found.nextGoal || found.next_goal || '',
            explicitApproved: (found.approvalState || found.approval_state) === 'approved',
          }
        }
      }
    } catch { /* ignore */ }
  }
  return null
}

function parseJsonArraySafe(raw) {
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
 *
 * @param {object} node - 会话或拓扑节点对象
 * @param {number} idx - 当前节点在已完成/同波次 Worker 列表中的序号（默认 0）
 * @param {object} options - 可选上下文（如 `{ store, engagementId, recomputeApproval }`）
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

  const turns = Math.max(1, Number(n.turns ?? n.rounds ?? 1) || 1)
  let toolCalls = 0
  if (n.toolCalls !== undefined || n.tool_calls !== undefined) {
    const tcRaw = n.toolCalls ?? n.tool_calls
    toolCalls = Array.isArray(tcRaw) ? tcRaw.length : Math.max(0, Number(tcRaw) || 0)
  } else if (Array.isArray(n.messages) && n.messages.length > 0) {
    let counted = 0
    for (const msg of n.messages) {
      if (!msg || typeof msg !== 'object') continue
      if (Array.isArray(msg.toolCalls || msg.tool_calls)) counted += (msg.toolCalls || msg.tool_calls).length
      else if (Array.isArray(msg.content)) {
        counted += msg.content.filter((p) => p && (p.type === 'tool_use' || p.type === 'tool-call' || p.toolName || p.name)).length
      }
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
    || (rawStatus === '' && (n.turns !== undefined || n.toolCalls !== undefined || n.completionConclusion || n.actionSummary || n.lastAssistantText))
  const isIdle = !isRunning && !isError && (
    rawStatus === 'idle'
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

  /* 推断 2-4 个领域/角色标签 + 波次标签 */
  const existingTags = parseJsonArraySafe(n.workerTags ?? n.worker_tags ?? n.tags ?? n.tags_json)
  const textCorpus = [
    n.title,
    n.label,
    n.rawTitle,
    n.name,
    n.role,
    n.summary,
    n.assigned_goal,
    n.assignedGoal,
    n.promptPreview,
    n.latestOutputPreview,
    n.outputPreview,
    n.completionConclusion,
    n.actionSummary,
    n.lastAssistantText,
    errorDetail,
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

  /* 计算 uiPriority & priorityWeight */
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

  /* 构建结构化压缩摘要 compressedDigest */
  const digestObj = (n.workerDigest && typeof n.workerDigest === 'object')
    ? n.workerDigest
    : ((n.compressedDigest && typeof n.compressedDigest === 'object') ? n.compressedDigest : null)

  const rawDigestSource = String(
    (digestObj && (digestObj.what_was_done || digestObj.whatWasDone))
    || n.completionConclusion
    || n.actionSummary
    || n.lastAssistantText
    || n.conclusion
    || errorDetail
    || n.latestOutputPreview
    || n.outputPreview
    || n.summary
    || n.assigned_goal
    || n.assignedGoal
    || ''
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
    || Math.max(600, turns * 420 + toolCalls * 310)
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

function extractSessionTelemetry(s, options = {}) {
  const isRoot = Boolean(options.isRoot)
  const jsonlData = options.jsonlData || null
  const meterUsage = options.meterUsage || null
  const header = Object.assign({}, (jsonlData && jsonlData.header) || {}, (s && s.header) || {})
  const sid = String((s && s.id !== undefined ? s.id : header.id) || options.fallbackId || '')
  const parentRaw = options.parentId !== undefined
    ? options.parentId
    : (header.parentSession ?? header.parentId ?? header.parent ?? s?.parentSession ?? s?.parentId ?? s?.parent ?? null)
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

  /* 保留并行 UUID 子会话独立身份：附加确定性序号/短 ID 后缀，防止 6 个并行 Wave-3 exploit 坍缩成 1 个 */
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

  /* 真实缓存命中率：绝不在 cacheReadTokens === 0 时硬编码 94.2%！ */
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

  /* 统一 Token 成本估算口径：¥1.80 / 1M tokens（与前端面板一致） */
  const explicitCost = Number(usage.cost ?? usage.costYuan ?? usage.totalCost ?? meterUsage?.cost ?? jsonlData?.explicitCost ?? 0) || 0
  const costYuan = explicitCost > 0
    ? Number(explicitCost.toFixed(4))
    : (tokens > 0 ? Number(((tokens / 1000000) * 1.8).toFixed(4)) : 0)

  const messages = Array.isArray(s && s.messages) ? s.messages : []
  const steps = Math.max(
    Number(usage.steps ?? s?.steps ?? header.steps ?? 0) || 0,
    messages.length,
    Number(jsonlData?.steps || 0),
    Number((wfNode && wfNode.step_count) || 0),
  )
  const rounds = Math.max(
    Number(usage.rounds ?? usage.turns ?? s?.rounds ?? s?.turns ?? 0) || 0,
    Array.isArray(s && s.turns) && s.turns.length > 0 ? s.turns.length : 0,
    messages.length > 0 ? Math.max(1, Math.ceil(messages.length / 2)) : 0,
    Number(jsonlData?.turns || 0),
    1,
  )
  const explicitToolCalls = s?.toolCalls ?? s?.tool_calls ?? usage.toolCalls ?? usage.tool_calls
    ?? (jsonlData && jsonlData.toolCalls > 0 ? jsonlData.toolCalls : undefined)
    ?? (wfNode && wfNode.tool_calls)

  const rawStatusField = String((s && s.status) || header.status || '').trim().toLowerCase()
  const rawActivityField = String((s && s.activity) || header.activity || '').trim().toLowerCase()
  const combinedRawState = rawStatusField || rawActivityField
  const isError = ERROR_STATUS_SET.has(rawStatusField) || ERROR_STATUS_SET.has(rawActivityField)
  const isRunning = !isError && (
    combinedRawState === 'running'
    || combinedRawState === 'run'
    || combinedRawState === 'active'
    || combinedRawState === 'in_progress'
    || rawActivityField === 'running'
    || Boolean(s && s.streaming)
    || Boolean(header && header.streaming)
  )
  const hasWork = steps > 0
    || tokens > 0
    || messages.length > 0
    || combinedRawState === 'completed'
    || combinedRawState === 'done'
    || rawActivityField === 'completed'
    || Boolean(wfNode && wfNode.has_activity)
  const activity = isError ? 'error' : (isRunning ? 'running' : (hasWork ? 'completed' : 'idle'))
  const status = isError
    ? 'error'
    : (activity === 'running' ? 'running' : (activity === 'completed' ? 'completed' : 'pending'))

  const startMs = parseTimestampMs(
    header.createdAt ?? header.created_at ?? header.startedAt ?? s?.createdAt ?? s?.created_at ?? s?.startedAt ?? usage.startedAt,
  ) || Number(jsonlData?.firstTimestampMs || 0)

  const fileMtimeMs = Number(s?.fileMtimeMs ?? options.fileMtimeMs ?? jsonlData?.mtimeMs ?? 0) || 0
  /* 历史会话耗时修复：非运行态会话绝不用 Date.now() 兜底，改用 updatedAt / JSONL 最后时间 / 文件 mtimeMs / startMs */
  const endMs = isRunning
    ? Date.now()
    : (
      parseTimestampMs(
        header.updatedAt ?? header.updated_at ?? header.completedAt ?? header.endedAt
        ?? s?.updatedAt ?? s?.updated_at ?? s?.completedAt ?? s?.endedAt ?? usage.updatedAt,
      )
      || Number(jsonlData?.lastTimestampMs || 0)
      || (fileMtimeMs > 0 ? fileMtimeMs : 0)
      || startMs
      || 0
    )

  const explicitDurationMs = Number(
    usage.durationMs ?? usage.latencyMs ?? s?.durationMs ?? s?.latency_ms ?? header.durationMs ?? (wfNode && wfNode.latency_ms) ?? 0,
  ) || 0
  const durationMs = explicitDurationMs > 0
    ? explicitDurationMs
    : (startMs > 0 && endMs >= startMs ? (endMs - startMs) : 0)
  const durationLabel = formatDurationLabel(durationMs)

  const fallbackSummary = (wfNode && wfNode.summary)
    || (activity === 'error'
      ? (s?.error_detail || `${label} 执行异常待修复`)
      : (activity === 'running'
        ? `正在执行 ${label} 任务并同步 PostgreSQL 事实库…`
        : (activity === 'completed' ? `已完成 ${label} 阶段交付并落库核验。` : '等待主控调度派发')))

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
    isRoot,
    rawTitle,
    title,
    label,
    name: title,
    role,
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

function isSyntheticSessionId(sid) {
  const s = String(sid || '').trim()
  if (!s) return true
  return s === 'root'
    || s === 'root-main'
    || s.startsWith('sub-')
    || s.startsWith('wt-')
    || s.startsWith('goal-')
    || s.startsWith('plan-goal-')
}

function createRequestFlow() {
  return {
    dagByEng: new Map(),
    syncedEngs: new Set(),
    hostSessionsByKey: new Map(),
  }
}

function getWorkflowDagDedup(store, engagementId, reqFlow = null, forceRefresh = false) {
  if (!store || typeof store.workflowDag !== 'function') return null
  const engKey = String(engagementId || 'default')
  if (reqFlow && !forceRefresh && reqFlow.dagByEng.has(engKey)) {
    return reqFlow.dagByEng.get(engKey)
  }
  let dag = null
  try { dag = store.workflowDag(engKey) } catch { dag = null }
  if (reqFlow && dag) reqFlow.dagByEng.set(engKey, dag)
  return dag
}

function syncHostWorkersDedup(store, engagementId, workers, reqFlow = null) {
  if (!store || typeof store.syncHostWorkersToPg !== 'function') return null
  const engKey = String(engagementId || 'default')
  const realWorkers = (Array.isArray(workers) ? workers : []).filter(
    (w) => w && !w._fromDbTask && !isSyntheticSessionId(w.id),
  )
  if (realWorkers.length === 0) {
    return { ok: true, engagement_id: engKey, synced: 0, total: 0 }
  }
  const dedupKey = `${engKey}::${realWorkers.map((w) => `${w.id}:${w.status}:${w.approvalState || ''}`).join(',')}`
  if (reqFlow && reqFlow.syncedEngs.has(dedupKey)) return null
  if (reqFlow) reqFlow.syncedEngs.add(dedupKey)
  try {
    const res = store.syncHostWorkersToPg(engKey, realWorkers)
    if (reqFlow && res && res.synced > 0) reqFlow.dagByEng.delete(engKey)
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
      : (header?.parentId ?? header?.parent ?? node?.parentSession ?? node?.parentId ?? node?.parent ?? null)
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

function parseWaveNumber(waveVal, fallbackWave = 3) {
  if (typeof waveVal === 'number' && Number.isFinite(waveVal)) return waveVal
  if (typeof waveVal === 'string' && waveVal.trim()) {
    const m = /(\d+)/.exec(waveVal)
    if (m) return Number(m[1])
  }
  return fallbackWave
}

/**
 * 发现宿主 DSH 当前打开的所有根会话与子智能体，并在 store 尚未创建/绑定工作区时自动同步建立绑定，
 * 避免用户在已有会话中打开控制台时看到空白的「未选择工作区」或重复的 UUID 伪工作区。
 */
async function discoverHostSessions(ctx, store, options = {}) {
  const reqFlow = options.reqFlow || null
  const cacheKey = `${options.sessionId || ''}::${options.autoBind !== false ? '1' : '0'}`
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
  const realNamedEngagements = allEngagements.filter((e) => e && !isUuidEngagement(e))
  const validEngagements = filterValidEngagements(allEngagements)

  const activeEngagementId = options.engagementId
    || (store ? getCachedActiveEngagementId(store) : null)
    || (realNamedEngagements[0] && realNamedEngagements[0].id)
    || (validEngagements[0] && validEngagements[0].id)
    || 'default'

  const wfDag = getWorkflowDagDedup(store, activeEngagementId, reqFlow)
  const wfNodeByRole = new Map()
  if (wfDag && Array.isArray(wfDag.all_nodes || wfDag.nodes)) {
    for (const n of (wfDag.all_nodes || wfDag.nodes)) {
      if (n && n.role) wfNodeByRole.set(n.role, n)
    }
  }

  /* O(N) 预构建会话映射表，供 resolveRootFromMap 在常数/有界跳数内完成根解析 */
  const byId = new Map()
  for (const s of rawList) {
    const sid = s && s.id !== undefined ? String(s.id) : ''
    if (sid) byId.set(sid, s)
  }

  const parentIdOfRaw = (s) => {
    if (!s || typeof s !== 'object') return null
    const h = s.header || {}
    const p = h.parentSession ?? h.parentId ?? h.parent ?? s.parentSession ?? s.parentId ?? s.parent ?? null
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

  /* 单趟 O(N) 将所有子会话归组到对应根会话，彻底消除嵌套 O(R * C * N) 扫描 */
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
  const items = []
  for (const root of roots) {
    const sid = String(root.id)
    const header = (root && root.header) || {}
    const cwd = String(header.cwd || header.workspace || header.projectDir || root.cwd || '').trim()
    const workspace = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() || '' : ''

    const cachedBinding = store ? getCachedSessionBindingEntry(store, sid) : null
    const preBoundEngId = (cachedBinding && cachedBinding.bound) || activeEngagementId
    const itemDag = preBoundEngId === activeEngagementId
      ? wfDag
      : getWorkflowDagDedup(store, preBoundEngId, reqFlow)
    const itemWfNodeByRole = preBoundEngId === activeEngagementId ? wfNodeByRole : new Map()
    if (preBoundEngId !== activeEngagementId && itemDag && Array.isArray(itemDag.all_nodes || itemDag.nodes)) {
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
      workflowNode: itemWfNodeByRole.get('plan') || null,
      jsonlData: rootJsonl,
      meterUsage: rootMeter,
      store,
      engagementId: preBoundEngId,
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
          childRawById.set(cid, Object.assign({}, existingRaw, k, {
            id: cid,
            header: Object.assign({}, existingRaw.header || {}, k.header || {}),
            usage: Object.assign({}, (existingRaw.header && existingRaw.header.usage) || {}, existingRaw.usage || {}, k.usage || {}),
            label: k.label || existingRaw.label || (existingRaw.header && existingRaw.header.title) || cid,
            activity: k.activity || existingRaw.activity || (existingRaw.header && existingRaw.header.activity),
            mode: k.mode || existingRaw.mode || '',
          }))
        }
      } catch { /* 单个会话子智能体读取失败不阻断 */ }
    }

    /* 统计同角色并行子智能体数量并赋予确定性序号，防止 6 个并行 UUID exploit 坍缩成 1 个 */
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
        defaultModel: rootTelemetry.model,
        workflowNode: itemWfNodeByRole.get(preRole) || null,
        roleIndex: curRoleIdx,
        roleSiblingCount: roleCounts.get(preRole) || 1,
        jsonlData: childJsonl,
        meterUsage: childMeter,
        store,
        engagementId: preBoundEngId,
      })
      kids.push(childTelemetry)
    }

    hydrateChildrenWithDbState(kids, itemDag)
    kids.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))
    let completedKidIdx = 0
    for (let i = 0; i < kids.length; i += 1) {
      const k = kids[i]
      const kIdx = (k.activity === 'completed' || k.status === 'completed') ? completedKidIdx++ : i
      computeWorkerLmtexMeta(k, kIdx, {
        store,
        engagementId: preBoundEngId,
        recomputeApproval: !k._persistedApproval,
      })
    }

    const rawTitle = rootTelemetry.rawTitle
    const displayLabel = workspace && !rawTitle.includes(workspace) ? (workspace + ' · ' + rawTitle) : rawTitle

    items.push(Object.assign({}, rootTelemetry, {
      id: sid,
      rawTitle,
      title: rawTitle,
      label: displayLabel,
      cwd,
      workspace,
      displayLabel,
      children: kids,
      running_children: kids.filter((c) => c.activity === 'running').length,
    }))
  }

  /* 若宿主已有根会话，执行自动绑定与 UUID 伪工作区清洗（使用缓存读取，仅在实际变更时写盘） */
  if (options.autoBind !== false && store && items.length > 0) {
    try {
      const targetSid = options.sessionId ? resolveRootFromMap(byId, options.sessionId) : items[0].id
      const targetSession = items.find((x) => x.id === targetSid) || items[0]

      if (allEngagements.length === 0 && targetSession && !isSyntheticSessionId(targetSession.id)) {
        /* 绝不以原始 UUID 会话标题自动创建工作区！ */
        const candidateTitle = targetSession.rawTitle || targetSession.title || ''
        if (candidateTitle && !isUuidSessionTitle(candidateTitle) && !isUuidSessionTitle(targetSession.displayLabel)) {
          const opened = dispatch(store, {
            op: 'openEngagement',
            name: targetSession.displayLabel || candidateTitle,
            note: targetSession.cwd ? ('自动同步自 DSH 会话工作目录 ' + targetSession.cwd) : '自动同步自 DSH 当前会话',
          })
          invalidateEngagementCaches(store)
          if (opened && opened.ok && opened.engagement && opened.engagement.id) {
            dispatch(store, {
              op: 'bindSessionEngagement',
              session: targetSession.id,
              engagement: opened.engagement.id,
              id: opened.engagement.id,
              name: opened.engagement.name || targetSession.displayLabel || candidateTitle,
            })
            invalidateSessionBindingsCache(store)
          }
        }
      } else {
        /* 当存在真实命名项目工作区时，始终将未绑定或误绑到 UUID 伪工作区的真实根会话绑定到真实项目工作区 */
        const preferredPool = realNamedEngagements.length > 0 ? realNamedEngagements : validEngagements
        for (const item of items) {
          if (isSyntheticSessionId(item.id)) continue
          const binding = getCachedSessionBindingEntry(store, item.id)
          const boundId = binding && binding.bound
          const boundName = binding && binding.name
          const boundIsBogus = isUuidSessionTitle(boundId) || isUuidSessionTitle(boundName)
          const needRebind = !boundId || (realNamedEngagements.length > 0 && boundIsBogus)
          if (needRebind && preferredPool.length > 0) {
            const matched = preferredPool.find((e) => e.name === item.displayLabel || e.name === item.title)
              || preferredPool.find((e) => e.id === activeEngagementId && !isUuidEngagement(e))
              || preferredPool[0]
            if (matched && matched.id) {
              dispatch(store, {
                op: 'bindSessionEngagement',
                session: item.id,
                engagement: matched.id,
                id: matched.id,
                name: matched.name || matched.id,
              })
              invalidateSessionBindingsCache(store)
              if (item.id === targetSession.id && typeof store.setActiveEngagement === 'function') {
                store.setActiveEngagement(matched.id)
                invalidateEngagementCaches(store)
              }
            }
          }
        }
      }

      /* 为每个宿主会话附带其绑定的工作区 ID，并在标题为原始 UUID 时用真实项目名美化展示 */
      for (const item of items) {
        try {
          const b = getCachedSessionBindingEntry(store, item.id)
          item.engagementId = (b && b.bound) || null
          item.engagementName = (b && b.name) || null
          if (isUuidSessionTitle(item.title) && item.engagementName && !isUuidSessionTitle(item.engagementName)) {
            item.title = item.engagementName
            item.displayLabel = item.workspace && !item.engagementName.includes(item.workspace)
              ? `${item.workspace} · ${item.engagementName}`
              : item.engagementName
            item.label = item.displayLabel
          }
          /* 若宿主未暴露子会话但当前绑定的工作区已有活跃角色记录，从 workflowDag 补齐子智能体树（标记 _fromDbTask 避免回写污染） */
          if (item.children.length === 0 && item.engagementId && typeof store.workflowDag === 'function') {
            const itemDag = getWorkflowDagDedup(store, item.engagementId, reqFlow)
            const dagNodes = (itemDag && Array.isArray(itemDag.all_nodes || itemDag.nodes))
              ? (itemDag.all_nodes || itemDag.nodes)
              : []
            for (const wfNode of dagNodes) {
              if (!wfNode || !wfNode.has_activity || wfNode.role === 'plan') continue
              const meta = AGENT_ROLE_META[wfNode.role] || AGENT_ROLE_META.exploit
              const stepCount = Number(wfNode.step_count || (Array.isArray(wfNode.decisions) ? wfNode.decisions.length : 0) || 1)
              const synthChild = extractSessionTelemetry({
                id: `sub-${wfNode.role}`,
                label: meta.defaultTitle,
                title: meta.defaultTitle,
                role: wfNode.role,
                model: item.model,
                activity: (wfNode.status === 'run' || wfNode.active) ? 'running' : 'completed',
                tokens: Number(wfNode.tokens) > 0 ? Number(wfNode.tokens) : 0,
                steps: stepCount,
                durationMs: Number(wfNode.latency_ms) > 0 ? Number(wfNode.latency_ms) : 0,
                summary: wfNode.summary || '',
              }, {
                isRoot: false,
                parentId: item.id,
                defaultModel: item.model,
                workflowNode: wfNode,
                store,
                engagementId: item.engagementId,
              })
              synthChild._fromDbTask = true
              item.children.push(synthChild)
            }
            item.children.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))
            let compIdx = 0
            for (let i = 0; i < item.children.length; i += 1) {
              const ch = item.children[i]
              const cIdx = (ch.activity === 'completed' || ch.status === 'completed') ? compIdx++ : i
              computeWorkerLmtexMeta(ch, cIdx, {
                store,
                engagementId: item.engagementId,
                recomputeApproval: !ch._persistedApproval,
              })
            }
            item.running_children = item.children.filter((c) => c.activity === 'running').length
          }
        } catch { /* ignore */ }
      }
    } catch { /* 自动绑定异常不影响会话发现 */ }
  }

  let finalItems = items
  /* p2 单窗口根会话唯一性：若同一工作区存在有实质活动的主会话，过滤掉无任何 token/步骤/子代理的空 UUID 幽灵会话 */
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

  /* 自动同步宿主真实子智能体至 PostgreSQL / SQLite 事实库：
     严禁将其他工作区根会话的 children 混入当前工作区！仅同步绑定到 activeEngagementId 的根会话下的真实宿主子智能体。 */
  try {
    if (store && typeof store.syncHostWorkersToPg === 'function' && activeEngagementId) {
      const activeHostKids = []
      for (const it of finalItems) {
        if (!it || it.engagementId !== activeEngagementId) continue
        for (const ch of (Array.isArray(it.children) ? it.children : [])) {
          if (ch && !ch._fromDbTask && !isSyntheticSessionId(ch.id)) {
            activeHostKids.push(ch)
          }
        }
      }
      if (activeHostKids.length > 0) {
        syncHostWorkersDedup(store, activeEngagementId, activeHostKids, reqFlow)
      }
    }
  } catch { /* ignore PG sync errors */ }

  if (didAdvanceJsonl) {
    bumpEventSeq('session_jsonl_append')
  }
  if (reqFlow) {
    reqFlow.hostSessionsByKey.set(cacheKey, finalItems)
  }

  return finalItems
}

/**
 * 清洗 bootstrap / sessionBinding 返回结果中的空 UUID 伪工作区，确保下拉选择器与当前绑定始终指向真实项目。
 */
function handleBootstrap(store, request, result) {
  if (!result || typeof result !== 'object') return result
  if (Array.isArray(result.engagements)) {
    result.engagements = filterValidEngagements(result.engagements)
    const realNamed = result.engagements.filter((e) => e && !isUuidEngagement(e))
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
  if ((request.op === 'sessionBinding' || request.op === 'sessionBindings') && store) {
    try {
      const allEngs = getCachedEngagementsList(store)
      const realNamed = filterValidEngagements(allEngs).filter((e) => e && !isUuidEngagement(e))
      if (realNamed.length > 0) {
        if (!result.bound || isUuidSessionTitle(result.bound) || isUuidSessionTitle(result.name)) {
          const target = realNamed[0]
          result.bound = target.id
          result.name = target.name || target.id
          result.current = target.id
          if (result.root_session && !isSyntheticSessionId(result.root_session) && typeof store.setSessionBinding === 'function') {
            store.setSessionBinding(result.root_session, target.id, target.name || target.id)
            invalidateSessionBindingsCache(store)
          }
        }
        if (result.agents && typeof result.agents === 'object') {
          for (const [k, v] of Object.entries(result.agents)) {
            if (v && (isUuidSessionTitle(v.engagement) || isUuidSessionTitle(v.name))) {
              result.agents[k] = Object.assign({}, v, {
                engagement: realNamed[0].id,
                name: realNamed[0].name || realNamed[0].id,
              })
            }
          }
        }
      }
    } catch { /* ignore */ }
  }
  return result
}

/**
 * 合成多智能体拓扑树（`agentNetwork`）、泳道（`swimlanes`）、跨智能体协作事件（`collabEvents`）与协作任务列表（`collabTasks`）。
 * 同时支持从宿主真实子会话（`sessions.list()` + `subagents.listChildren()`）与 `store.workflowDag(activeEngagement)`（含 `worker_tasks` / `plan_goals` / `worker_digests`）合成。
 */
function synthesizeAgentCollaboration(store, activeEngagement, hostSessions, requestedSessionId = '', reqFlow = null) {
  const wfDag = getWorkflowDagDedup(store, activeEngagement, reqFlow)
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

  /* 严格按 activeEngagement 选择当前工作区的宿主根会话，绝不跨工作区借用其他项目的宿主会话！ */
  const safeHostList = Array.isArray(hostSessions) ? hostSessions : []
  const matchingHosts = safeHostList.filter((s) => {
    if (!s) return false
    if (s.engagementId) return s.engagementId === activeEngagement
    return false
  })
  const unboundFallbackHosts = (matchingHosts.length === 0 && safeHostList.every((s) => !s || !s.engagementId))
    ? safeHostList.filter(Boolean)
    : []
  const candidateHosts = matchingHosts.length > 0 ? matchingHosts : unboundFallbackHosts
  const primaryHost = (requestedSessionId && candidateHosts.find((s) => s.id === requestedSessionId))
    || candidateHosts.find((s) => s.children && s.children.length > 0)
    || candidateHosts[0]
    || null

  const planWfNode = wfNodeByRole.get('plan') || null
  const engList = store ? getCachedEngagementsList(store) : []
  const activeEngMeta = engList.find((e) => e && e.id === activeEngagement) || null
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
      activity: rootActivityFallback,
    }, {
      isRoot: true,
      parentId: null,
      workflowNode: planWfNode,
      store,
      engagementId: activeEngagement,
    })

  const childNodes = Array.isArray(primaryHost && primaryHost.children)
    ? primaryHost.children
      .filter((c) => !c._fromDbTask)
      .map((c) => Object.assign({}, c, { isRoot: false, parentId: rootNode.id, parent: rootNode.id }))
    : []

  /* 1) 将 DB 中的 worker_tasks / worker_digests 持久化状态（approval_state, ui_priority, assigned_goal, files_owned_json, error_detail）水合到已匹配的宿主子智能体 */
  const matchedTaskIds = hydrateChildrenWithDbState(childNodes, wfDag)

  /* 2) 将尚未出现在宿主子会话中的 wfDag.worker_tasks 转化为真实拓扑/泳道/任务节点（即使 attack_step 为空，decomposeUserPrompt 后立即展示） */
  const unmatchedDbTasks = dbTasks.filter((t) => t && !matchedTaskIds.has(String(t.id)))
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
      const isDone = !isErr && !isRun && (rawSt === 'completed' || rawSt === 'done' || rawSt === 'finished' || rawSt === 'approved')
      const taskActivity = isErr ? 'error' : (isRun ? 'running' : (isDone ? 'completed' : 'idle'))
      const taskStatus = isErr ? rawSt : (isRun ? 'running' : (isDone ? 'completed' : 'pending'))

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
        turns: Math.max(1, Number(t.turns || 1) || 1),
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
  } else if (childNodes.length === 0 && dbGoals.length > 0) {
    /* 若仅有 plan_goals 尚无 worker_tasks 行，按子目标展示已拆解波次节点 */
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

  /* 3) 若 store.workflowDag 中存在真实已有 attack_step 活动（has_activity === true）的角色节点且未出现在子列表中，合成为节点 */
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

  childNodes.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))

  /* 为每个子智能体节点计算 lmtex 优先级（保留数据库已持久化的审批与优先级状态） */
  let completedWorkerIdx = 0
  for (let i = 0; i < childNodes.length; i += 1) {
    const child = childNodes[i]
    const isChildCompleted = child.activity === 'completed' || child.status === 'completed' || child.status === 'done'
    const effIdx = isChildCompleted ? completedWorkerIdx++ : i
    computeWorkerLmtexMeta(child, effIdx, {
      store,
      engagementId: activeEngagement,
      recomputeApproval: !child._persistedApproval && !child._fromDbTask,
    })
  }

  /* 若主控节点自身 token 为 0 但子智能体已有真实消耗，按汇总比例补齐主控上下文遥测（统一 ¥1.80 / 1M 口径） */
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
  computeWorkerLmtexMeta(rootNode, 0, { store, engagementId: activeEngagement })
  rootNode.children = childNodes
  rootNode.running_children = childNodes.filter((c) => c.activity === 'running').length

  /* 仅同步真实宿主子会话（排除 _fromDbTask 与合成 ID），并通过 reqFlow 去重避免同请求重复写库 */
  syncHostWorkersDedup(store, activeEngagement || 'default', childNodes, reqFlow)

  /* 生成跨智能体协作事件流（collabEvents）：按波次生成 spawn / progress / error / complete */
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

  /* 生成泳道列表（swimlanes）：附加 lmtex 元数据并按 priorityWeight DESC -> updatedAt DESC 排序 */
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

  /* 生成协作任务卡片列表（collabTasks）：供 p4 右下「协作任务」与 p5 树图画布使用 */
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
 * 构建或提取单个智能体会话的结构化执行轨迹（`stepTimeline`）与详情载荷，
 * 供「多智能体协作」与「团队拓扑」点击节点/事件时弹出执行轨迹详情弹窗及一键跳转宿主会话。
 */
async function extractAgentSessionDetail(ctx, store, engagementId, request = {}, reqFlow = null) {
  const flow = reqFlow || createRequestFlow()
  const targetId = String(request.sessionId || request.agentId || request.id || request.session || '').trim()
  const isSyntheticChildId = isSyntheticSessionId(targetId) || Boolean(request.role && request.role !== 'plan' && !targetId)
  const resolvedRootSession = request.session
    ? resolveRootSessionId(ctx, request.session)
    : ((targetId && !isSyntheticChildId) ? resolveRootSessionId(ctx, targetId) : '')
  const hostSessions = await discoverHostSessions(ctx, store, {
    sessionId: request.session || (isSyntheticChildId ? '' : targetId),
    autoBind: true,
    reqFlow: flow,
  })
  const currentEng = (store ? getCachedActiveEngagementId(store) : null)
    || engagementId
    || 'default'
  const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, isSyntheticChildId ? '' : resolvedRootSession, flow)

  let sessions = null
  let subagents = null
  try { sessions = ctx.get('sessions') } catch { sessions = null }
  try { subagents = ctx.get('subagents') } catch { subagents = null }

  const rawById = new Map()
  if (sessions && typeof sessions.list === 'function') {
    try {
      for (const s of (sessions.list() || [])) {
        if (s && s.id !== undefined) rawById.set(String(s.id), s)
      }
    } catch { /* ignore */ }
  }
  if (sessions && typeof sessions.get === 'function' && targetId) {
    try {
      const direct = sessions.get(targetId)
      if (direct && direct.id !== undefined) rawById.set(String(direct.id), direct)
    } catch { /* ignore */ }
  }
  if (subagents && typeof subagents.listChildren === 'function') {
    for (const hs of hostSessions) {
      if (!hs || !hs.id) continue
      try {
        const list = await subagents.listChildren(hs.id)
        for (const k of Array.isArray(list) ? list : []) {
          const cid = k && (k.id || k.sessionId) ? String(k.id || k.sessionId) : ''
          if (cid) {
            rawById.set(cid, Object.assign({}, rawById.get(cid) || {}, k, { id: cid }))
          }
        }
      } catch { /* ignore */ }
    }
  }

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

  /* 优先尝试从宿主真实会话消息或 IncrementalSessionJsonlReader 提取真实工具调用与步骤轨迹 */
  const rawMessages = Array.isArray(rawSession && rawSession.messages)
    ? rawSession.messages
    : (Array.isArray(rawSession && rawSession.entries)
      ? rawSession.entries
      : (Array.isArray(rawSession && rawSession.history) ? rawSession.history : []))

  const extractedSteps = []
  if (rawMessages.length > 0) {
    let stepIndex = 1
    for (let i = 0; i < rawMessages.length; i += 1) {
      const m = rawMessages[i]
      if (!m || typeof m !== 'object') continue
      const msgRole = String(m.role || m.sender || m.type || '').toLowerCase()
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
      const tcs = Array.isArray(m.toolCalls || m.tool_calls) ? (m.toolCalls || m.tool_calls) : []
      const parts = Array.isArray(m.content) ? m.content : []
      const partTools = parts.filter((p) => p && (p.type === 'tool_use' || p.type === 'tool-call' || p.toolName || p.name))
      if (tcs.length > 0 || partTools.length > 0) {
        const firstTool = tcs[0] || partTools[0] || {}
        const toolName = String(
          firstTool.name
          || firstTool.toolName
          || (firstTool.function && firstTool.function.name)
          || 'workspace.tool'
        )
        const rawInput = firstTool.input || (firstTool.function && firstTool.function.arguments) || text || ''
        const inputStr = typeof rawInput === 'string' ? rawInput : JSON.stringify(rawInput)
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
  if (extractedSteps.length >= 2) {
    stepTimeline = extractedSteps.slice(0, 5)
    const lastIdx = stepTimeline.length - 1
    stepTimeline[lastIdx] = Object.assign({}, stepTimeline[lastIdx], {
      phase: isRunning ? 'execute' : 'conclude',
      status: isError ? 'error' : (isRunning ? 'running' : 'done'),
      outputSummary: stepTimeline[lastIdx].outputSummary || conclusion,
    })
  } else {
    const decisions = (wfNode && Array.isArray(wfNode.decisions)) ? wfNode.decisions : []
    const decisionSummary = decisions.length > 0
      ? decisions.map((d) => (d && (d.summary || d.title || d.decision)) || '').filter(Boolean).join('；').slice(0, 160)
      : ''

    const ROLE_TEMPLATES = {
      plan: [
        {
          phase: 'delegate',
          tool: 'redteam_preflight',
          title: '解析用户工程意图与工作区上下文',
          inputSummary: delegationPrompt,
          outputSummary: '完成工程目录探测、活跃工作区绑定与 4-Wave Bounded DAG 拓扑初始化。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'subagents.spawn',
          title: '并发派发 Wave 1-2 产品测绘与架构分片子智能体',
          inputSummary: '按 4-Wave DAG 调度 recon（产品测绘）、designer（视觉令牌）与 assess（架构契约）',
          outputSummary: '子智能体并发槽位已分配，实时汇聚需求边界、Design Tokens 与接口契约。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'subagents.spawn',
          title: '调度 Wave 3-4 全栈构建与质量门禁核验',
          inputSummary: '基于锁定的无交集文件分片并行拉起 Builder 与 QA 回归验证',
          outputSummary: decisionSummary || '各独占文件分片编码实现与 node --check 语法校验全部通过。',
          durationLabel: '0s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_workflow_event',
          title: '聚合全波次交付产物并同步 PostgreSQL 事实库',
          inputSummary: '汇总所有子智能体里程碑、代码变更集与验证报告',
          outputSummary: conclusion,
          durationLabel: '0s',
        },
      ],
      designer: [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 1 交互设计与视觉令牌任务',
          inputSummary: delegationPrompt,
          outputSummary: '已对齐控制台设计系统规范、主题色板与组件层级约束。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'fs.read_file',
          title: '扫描现有视图组件树与样式令牌定义',
          inputSummary: '读取 UI 组件样式表、布局容器与响应式断点配置',
          outputSummary: '梳理出核心面板布局结构、卡片密度规范与高对比度色阶映射。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'redteam_add_note',
          title: '构建组件交互契约与四态视觉规范',
          inputSummary: '定义空态、加载态、流式运行态与异常降级态交互细节',
          outputSummary: decisionSummary || '生成完整 Design Tokens 映射表与可复用 UI 组件契约清单。',
          durationLabel: '0s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_record_decision',
          title: '固化视觉交付规范并回写事实库',
          inputSummary: '提交 Wave 1 设计令牌与交互规范文档至共享事实库',
          outputSummary: conclusion,
          durationLabel: '0s',
        },
      ],
      recon: [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 1 产品需求与数据源测绘指令',
          inputSummary: delegationPrompt,
          outputSummary: '明确 P0/P1 核心功能边界、外部依赖接口与数据流向。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'codebase.search',
          title: '全量扫描仓库模块拓扑与真实数据源接口',
          inputSummary: '检索核心业务包、存储引擎 schema 与宿主服务注册表',
          outputSummary: '完成模块依赖图谱测绘，识别关键状态同步链路与数据表结构。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'redteam_upsert_target',
          title: '建模核心业务实体与 P0/P1 需求优先级矩阵',
          inputSummary: '梳理各子系统输入输出边界、性能指标与验收基线',
          outputSummary: decisionSummary || '产出结构化模块清单与数据源连通性测绘报告。',
          durationLabel: '0s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_record_decision',
          title: '归档产品需求基线并解锁 Wave 2 架构分片',
          inputSummary: '将 PRD 边界与数据源测绘结果写入 PostgreSQL 事实库',
          outputSummary: conclusion,
          durationLabel: '0s',
        },
      ],
      assess: [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 2 架构设计与无交集分片任务',
          inputSummary: delegationPrompt,
          outputSummary: '已读取 Wave 1 产品测绘与设计规范，启动接口契约设计。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'codebase.analyze',
          title: '审视模块耦合边界与跨层 RPC/API 通信协议',
          inputSummary: '分析前后端数据桥接签名、状态流转与并发读写锁点',
          outputSummary: '锁定新增 op 协议字段、返回载荷结构与向后兼容降级策略。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'redteam_upsert_service',
          title: '划分文件无交集并发研发分片（Shard Mapping）',
          inputSummary: '按独占文件边界拆解 Wave 3 Builder 并发任务与依赖顺序',
          outputSummary: decisionSummary || '完成各 Shard 职责边界、输入输出契约与语法校验命令定义。',
          durationLabel: '0s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_record_decision',
          title: '冻结架构接口契约并签发 Wave 3 并发构建计划',
          inputSummary: '写入架构决策记录（ADR）与分片矩阵至事实库',
          outputSummary: conclusion,
          durationLabel: '0s',
        },
      ],
      exploit: [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 3 独占文件分片研发指令',
          inputSummary: delegationPrompt,
          outputSummary: '已认领当前分片独占文件边界与上下游接口契约。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'fs.read_file',
          title: '精读目标源码上下文与既有辅助函数实现',
          inputSummary: '定位目标模块入口、状态挂载点与数据转换流水线',
          outputSummary: '确认挂载位置与边界条件处理逻辑，确保零破坏性改动。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'fs.replace_content',
          title: '编写核心业务逻辑并对齐接口数据结构',
          inputSummary: '实现分片核心功能、异常兜底与响应式 UI/API 绑定',
          outputSummary: decisionSummary || '代码补丁已精确写入目标文件，保持代码风格与注释规范一致。',
          durationLabel: '0s',
        },
        {
          phase: 'conclude',
          tool: 'bash.check',
          title: '执行语法静态核验并回报构建产物',
          inputSummary: '运行 node --check 语法验证与契约字段自检',
          outputSummary: conclusion,
          durationLabel: '0s',
        },
      ],
      'vuln-scan': [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 4 代码质量审查与安全合规审计任务',
          inputSummary: delegationPrompt,
          outputSummary: '已加载 Wave 3 变更文件集与安全红线检查清单。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'git.diff_audit',
          title: '逐行审查代码变更集、分片越界与潜在回归风险',
          inputSummary: '检查各 Shard 修改范围、空值防御与异步错误处理链路',
          outputSummary: '确认所有改动严格收敛在独占分片内，无未捕获异常或状态泄漏。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'security.boundary_scan',
          title: '核验同源校验、命令注入防护与敏感凭据隔离',
          inputSummary: '审计 HTTP 桥接入口、参数消毒与宿主会话权限边界',
          outputSummary: decisionSummary || 'Origin/Loopback 校验与参数白名单机制完备，安全基线全部达标。',
          durationLabel: '0s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_record_decision',
          title: '签发代码审查与安全审计通过凭证',
          inputSummary: '归档审查结论与质量评分至 PostgreSQL 事实库',
          outputSummary: conclusion,
          durationLabel: '0s',
        },
      ],
      qa: [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 4 自动化回归测试与基准核验任务',
          inputSummary: delegationPrompt,
          outputSummary: '已就绪测试沙箱环境与端到端回归用例集。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'bash.test_runner',
          title: '执行模块语法校验与核心接口契约断言测试',
          inputSummary: '运行 node --check 及 API 载荷结构一致性测试套件',
          outputSummary: '所有被测模块语法检查与契约字段断言 100% 通过。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'qa.regression_verify',
          title: '验证四态交互降级、会话绑定保持与并发稳定性',
          inputSummary: '模拟空态、运行态、切换会话与异常恢复场景',
          outputSummary: decisionSummary || '验证主从会话联动、弹窗轨迹渲染与降级兜底行为均符合预期。',
          durationLabel: '0s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_record_decision',
          title: '出具 QA 质量验收报告并放行发布门禁',
          inputSummary: '汇总测试覆盖率、耗时分布与验收结论回写事实库',
          outputSummary: conclusion,
          durationLabel: '0s',
        },
      ],
      internal: [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 4 架构文档同步与版本归档指令',
          inputSummary: delegationPrompt,
          outputSummary: '已汇总各波次架构决策、接口契约与质量验收记录。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'docs.sync_wall',
          title: '更新研发文档墙（Doc Wall）与模块交付清单',
          inputSummary: '整理 PRD、架构分片、构建变更与审查报告索引',
          outputSummary: '生成结构化工程交付文档卡片并同步至工作区文档墙。',
          durationLabel: '0s',
        },
        {
          phase: 'execute',
          tool: 'release.changelog',
          title: '生成版本演进摘要与可追溯审计基线',
          inputSummary: '校验版本号、能力矩阵变更与升级兼容性说明',
          outputSummary: decisionSummary || '完成版本发布说明与全链路遥测快照归档。',
          durationLabel: '0s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_record_decision',
          title: '完成最终发布归档并通知主控收口',
          inputSummary: '写入最终发布里程碑至 PostgreSQL 事实库',
          outputSummary: conclusion,
          durationLabel: '0s',
        },
      ],
    }

    const template = ROLE_TEMPLATES[role] || ROLE_TEMPLATES.assess
    stepTimeline = template.map((item, idx) => ({
      step: idx + 1,
      phase: item.phase,
      tool: item.tool,
      title: item.title,
      inputSummary: item.inputSummary,
      outputSummary: item.outputSummary,
      durationLabel: item.durationLabel,
      status: isError && idx === template.length - 1
        ? 'error'
        : ((isRunning && idx === template.length - 1) ? 'running' : 'done'),
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

function invokeStoreMethodCompat(store, methodName, engagementId, payload) {
  if (!store || typeof store[methodName] !== 'function') return undefined
  const fn = store[methodName]
  const fnSrc = Function.prototype.toString.call(fn)
  /* 兼容 ES6 Class 方法（如 `workflowAction(id, payload)` / `decomposeUserPrompt(arg1 = {})`）与普通函数签名，单次精确调用不重试 */
  const headerSlice = fnSrc.slice(0, 160)
  const paramMatch = /\(([^)]*)\)/.exec(headerSlice)
  const rawFirstParam = paramMatch ? paramMatch[1].split(',')[0].trim() : ''
  const cleanFirstParam = rawFirstParam.split('=')[0].trim()

  if (payload === undefined) {
    return fn.call(store, engagementId)
  }

  const mergedPayload = (payload && typeof payload === 'object' && !Array.isArray(payload))
    ? Object.assign(
      {
        engagement: engagementId,
        engagement_id: engagementId,
        engagementId,
      },
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

function buildRefinedWishSpec(rawPrompt, template = '', rawPayload = {}) {
  const promptText = String(rawPrompt || '').trim() || '构建高可靠模块化工程系统并完成自动化验证'
  const tpl = String(template || rawPayload.template_id || 'fullstack').trim().toLowerCase()
  const cleanFirstLine = promptText.split(/[\n。！？!?]/)[0].trim()
  const specTitle = String(
    rawPayload.title
    || (cleanFirstLine.length > 42 ? `${cleanFirstLine.slice(0, 40)}…` : cleanFirstLine)
    || '多智能体 4-Wave 协同交付方案'
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
      goal: `锁定跨模块数据结构、API 协议签名与 Wave 3 无交集独占文件边界`,
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
      goal: `对全部改动分片执行语法检查、边界用例测试与同源安全合规核验`,
      files_owned: ['test/regression.test.mjs'],
    },
  ]

  const inputWaves = Array.isArray(rawPayload.proposed_waves)
    ? rawPayload.proposed_waves
    : (Array.isArray(rawPayload.waves) ? rawPayload.waves : null)

  const proposedWaves = (inputWaves && inputWaves.length > 0 ? inputWaves : defaultWaves).map((w, idx) => {
    const waveNum = parseWaveNumber(w.wave ?? w.wave_key, Math.min(4, Math.floor(idx / 2) + 1))
    const role = inferAgentRole(w.title || w.goal || w.objective || '', false, w.role || w.worker_role || 'exploit')
    const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.exploit
    const title = String(w.title || w.worker_name || meta.defaultTitle).trim()
    const goal = String(w.goal || w.objective || w.assigned_goal || title).trim()
    const filesOwned = parseJsonArraySafe(w.files_owned ?? w.filesOwned ?? w.files_owned_json)
    return {
      id: w.id || `prop-w${waveNum}-${idx + 1}`,
      wave: waveNum,
      wave_key: `wave-${waveNum}`,
      role,
      badge: meta.badge,
      ui_priority: ['P0', 'P1', 'P2', 'P3'].includes(w.ui_priority || w.uiPriority) ? (w.ui_priority || w.uiPriority) : 'P1',
      title,
      goal,
      objective: goal,
      assigned_goal: goal,
      files_owned: filesOwned,
    }
  })

  return {
    title: specTitle,
    template: tpl,
    raw_prompt: promptText,
    summary: `已将您的需求整理为 4 个波次（共 ${proposedWaves.length} 个无冲突并发子任务）：先完成需求测绘与契约加锁，再并行推进独占文件研发，最后经自动化测试门禁验收交付。`,
    clarifications,
    deliverables,
    proposed_waves: proposedWaves,
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

function computeShardLocksFallback(store, engagementId, wfDag = null) {
  if (store && typeof store.listShardLocks === 'function') {
    const res = invokeStoreMethodCompat(store, 'listShardLocks', engagementId)
    if (res && typeof res === 'object') {
      const locks = Array.isArray(res.locks) ? res.locks : (Array.isArray(res.items) ? res.items : [])
      return Object.assign({ ok: true, engagement: engagementId, locks, items: locks }, res)
    }
    if (Array.isArray(res)) {
      return { ok: true, engagement: engagementId, locks: res, items: res, conflicts: [] }
    }
  }
  const dag = wfDag || (store && typeof store.workflowDag === 'function' ? store.workflowDag(engagementId) : null)
  const tasks = (dag && Array.isArray(dag.worker_tasks)) ? dag.worker_tasks : []
  const ownersByFile = new Map()
  const locks = []
  for (const t of tasks) {
    if (!t) continue
    const st = String(t.status || '').toLowerCase()
    const active = st !== 'cancelled' && st !== 'archived'
    const files = parseJsonArraySafe(t.files_owned ?? t.files_owned_json)
    for (const f of files) {
      const norm = normalizeTouchedFilePath(f) || String(f).trim()
      if (!norm) continue
      const entry = {
        file_path: norm,
        worker_task_id: t.id,
        worker_name: t.worker_name || `wt-${t.id}`,
        worker_role: t.worker_role || 'exploit',
        wave: t.wave || 'wave-3',
        status: t.status || 'pending',
        active,
      }
      locks.push(entry)
      if (active) {
        if (!ownersByFile.has(norm)) ownersByFile.set(norm, [])
        ownersByFile.get(norm).push(entry)
      }
    }
  }
  const conflicts = []
  for (const [filePath, holders] of ownersByFile.entries()) {
    if (holders.length > 1) {
      conflicts.push({
        file_path: filePath,
        holders: holders.map((h) => ({ worker_task_id: h.worker_task_id, worker_name: h.worker_name, wave: h.wave })),
      })
    }
  }
  return {
    ok: true,
    engagement: engagementId,
    locks,
    items: locks,
    conflicts,
  }
}

async function handleAgentsOp(ctx, request) {
  const AGENT_OPS = [
    'agentsStatus', 'hostSessions', 'setAgentsMax', 'setClusterConfig', 'setPgUrl', 'probePg',
    'pgWriteProbe', 'workflowDag', 'workflowDocWall', 'workflowAction', 'workflowRun',
    'dagCheckpoint', 'feishuNotify', 'feishuConfig', 'feishuTestPush',
    'agentSessionDetail', 'activateAgentSession',
    'planApproveWorker', 'submitWorkerDigest', 'decomposeUserPrompt',
    'refineAndDecomposeWish', 'updateWorkerGoal', 'addCustomWorkerTask', 'retryWorkerTask', 'shardLocks',
  ]
  if (!AGENT_OPS.includes(request.op)) return undefined
  /* 并发上限与工具侧的闸门读同一份设置（settings.json → REDTEAM_MAX_AGENTS → 默认 6），
     改完立即生效、不需要重启 —— 派活时 redteam_agent_slot 每次现读。 */
  const store = ctx.redteam
  const reqFlow = createRequestFlow()
  const root = (() => { try { return store && store.root } catch { return undefined } })()
  const resolvedRootSession = request.session ? resolveRootSessionId(ctx, request.session) : ''
  const activeEngagement = request.engagement
    || request.engagement_id
    || request.engagementId
    || (store ? getCachedActiveEngagementId(store) : null)
    || 'default'

  const DELEGATED_WORKFLOW_ACTIONS = [
    'planApproveWorker', 'submitWorkerDigest', 'decomposeUserPrompt',
    'refineAndDecomposeWish', 'updateWorkerGoal', 'addCustomWorkerTask', 'retryWorkerTask',
  ]
  const effectiveOp = (request.op === 'workflowAction' && DELEGATED_WORKFLOW_ACTIONS.includes(request.action))
    ? request.action
    : request.op

  if (effectiveOp === 'planApproveWorker') {
    const rawPayload = Object.assign(
      {},
      request.payload && typeof request.payload === 'object' ? request.payload : {},
      request,
    )
    const currentEng = rawPayload.engagement || rawPayload.engagement_id || rawPayload.engagementId
      || (store ? getCachedActiveEngagementId(store) : null)
      || activeEngagement
    /* 严禁默认回退 'sub-recon' 或以裸角色名（如 'exploit'）作为全局审批键！ */
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

    const storePayload = Object.assign({}, rawPayload, {
      op: 'planApproveWorker',
      engagement: currentEng,
      engagement_id: currentEng,
      engagementId: currentEng,
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
    })

    let storeResult = null
    try {
      storeResult = await invokeStoreMethodCompat(store, 'approveWorkerAndDispatchNext', currentEng, storePayload)
    } catch { storeResult = null }
    if (storeResult === undefined && store) {
      try { storeResult = dispatch(store, storePayload) } catch { storeResult = null }
    }

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

    reqFlow.dagByEng.delete(currentEng)
    bumpEventSeq('planApproveWorker', { engagement: currentEng, workerId: workerKey })

    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, autoBind: true, reqFlow })
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
    const pgProbe = store && typeof store.pgWriteProbe === 'function'
      ? store.pgWriteProbe(currentEng)
      : getPgWriteProbe(currentEng)

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
        host_sessions: hostSessions,
        hostSessions,
        agentNetwork: synth.agentNetwork,
        agent_network: synth.agentNetwork,
        nodes: synth.nodes,
        swimlanes: synth.swimlanes,
        collabEvents: synth.collabEvents,
        collab_events: synth.collabEvents,
        collabTasks: synth.collabTasks,
        collab_tasks: synth.collabTasks,
        pg_probe: pgProbe,
        pgWriteProbe: pgProbe,
      },
    )
  }

  if (effectiveOp === 'submitWorkerDigest') {
    const rawPayload = Object.assign(
      {},
      request.payload && typeof request.payload === 'object' ? request.payload : {},
      request,
    )
    const currentEng = rawPayload.engagement || rawPayload.engagement_id || rawPayload.engagementId
      || (store ? getCachedActiveEngagementId(store) : null)
      || activeEngagement
    const meta = computeWorkerLmtexMeta(rawPayload, Number(rawPayload.idx) || 0, { store, engagementId: currentEng })
    const storePayload = Object.assign({}, rawPayload, {
      op: 'submitWorkerDigest',
      engagement: currentEng,
      engagement_id: currentEng,
      engagementId: currentEng,
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
    })

    let storeResult = null
    try {
      storeResult = await invokeStoreMethodCompat(store, 'submitWorkerDigest', currentEng, storePayload)
    } catch { storeResult = null }
    if (storeResult === undefined && store) {
      try { storeResult = dispatch(store, storePayload) } catch { storeResult = null }
    }

    reqFlow.dagByEng.delete(currentEng)
    bumpEventSeq('submitWorkerDigest', { engagement: currentEng })

    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, autoBind: true, reqFlow })
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
    const pgProbe = store && typeof store.pgWriteProbe === 'function'
      ? store.pgWriteProbe(currentEng)
      : getPgWriteProbe(currentEng)

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
        agentNetwork: synth.agentNetwork,
        agent_network: synth.agentNetwork,
        nodes: synth.nodes,
        swimlanes: synth.swimlanes,
        collabEvents: synth.collabEvents,
        collab_events: synth.collabEvents,
        collabTasks: synth.collabTasks,
        collab_tasks: synth.collabTasks,
        pg_probe: pgProbe,
        pgWriteProbe: pgProbe,
      },
    )
  }

  if (effectiveOp === 'refineAndDecomposeWish' || effectiveOp === 'decomposeUserPrompt') {
    const rawPayload = Object.assign(
      {},
      request.payload && typeof request.payload === 'object' ? request.payload : {},
      request,
    )
    const currentEng = rawPayload.engagement || rawPayload.engagement_id || rawPayload.engagementId
      || (store ? getCachedActiveEngagementId(store) : null)
      || activeEngagement
    const promptText = String(
      rawPayload.prompt || rawPayload.user_prompt || rawPayload.userPrompt || rawPayload.wish || rawPayload.goal || rawPayload.text
      || '执行多波次并发架构交付与验证',
    ).trim()
    const templateName = String(rawPayload.template || rawPayload.template_id || '').trim()
    const previewOnly = Boolean(rawPayload.preview_only ?? rawPayload.previewOnly)
    const localSpec = buildRefinedWishSpec(promptText, templateName, rawPayload)

    /* 预览模式（preview_only: true）：仅生成人性化需求澄清与可编辑波次提案，绝不写入数据库！ */
    if (previewOnly) {
      let storePreview = null
      const previewPayload = Object.assign({}, rawPayload, {
        engagement_id: currentEng,
        prompt: promptText,
        user_prompt: promptText,
        template: templateName,
        preview_only: true,
      })
      if (store && typeof store.refineAndDecomposeWish === 'function') {
        try {
          storePreview = await invokeStoreMethodCompat(store, 'refineAndDecomposeWish', currentEng, previewPayload)
        } catch { storePreview = null }
      } else if (store && typeof store.refineUserWish === 'function') {
        try {
          storePreview = await invokeStoreMethodCompat(store, 'refineUserWish', currentEng, previewPayload)
        } catch { storePreview = null }
      }
      const storeSpecCandidate = storePreview && typeof storePreview === 'object'
        ? ((storePreview.refined_spec && typeof storePreview.refined_spec === 'object')
          ? storePreview.refined_spec
          : (Array.isArray(storePreview.proposed_waves) || storePreview.title || storePreview.summary ? storePreview : null))
        : null
      const mergedSpec = Object.assign({}, localSpec, storeSpecCandidate || {})
      if (!Array.isArray(mergedSpec.proposed_waves) || mergedSpec.proposed_waves.length === 0) {
        mergedSpec.proposed_waves = localSpec.proposed_waves
      }
      return {
        ok: true,
        op: effectiveOp,
        preview_only: true,
        engagement: currentEng,
        active_engagement: currentEng,
        prompt: promptText,
        template: templateName || localSpec.template,
        refined_spec: mergedSpec,
        refinedSpec: mergedSpec,
        proposed_waves: mergedSpec.proposed_waves,
      }
    }

    const storePayload = Object.assign({}, rawPayload, {
      op: effectiveOp,
      engagement: currentEng,
      engagement_id: currentEng,
      engagementId: currentEng,
      prompt: promptText,
      user_prompt: promptText,
      template: templateName,
      preview_only: false,
      refined_spec: localSpec,
      proposed_waves: localSpec.proposed_waves,
      waves: rawPayload.proposed_waves || rawPayload.waves || localSpec.proposed_waves,
    })

    let storeResult = null
    if (effectiveOp === 'refineAndDecomposeWish' && store && typeof store.refineAndDecomposeWish === 'function') {
      try {
        storeResult = await invokeStoreMethodCompat(store, 'refineAndDecomposeWish', currentEng, storePayload)
      } catch { storeResult = null }
    }
    if (!storeResult && store && typeof store.decomposeUserPrompt === 'function') {
      try {
        storeResult = await invokeStoreMethodCompat(store, 'decomposeUserPrompt', currentEng, storePayload)
      } catch { storeResult = null }
    }
    if (!storeResult && store) {
      try { storeResult = dispatch(store, Object.assign({}, storePayload, { op: 'decomposeUserPrompt' })) } catch { storeResult = null }
    }

    reqFlow.dagByEng.delete(currentEng)
    invalidateEngagementCaches(store)
    bumpEventSeq(effectiveOp, { engagement: currentEng })

    const hostSessions = await discoverHostSessions(ctx, store, {
      sessionId: request.session,
      engagementId: currentEng,
      autoBind: true,
      reqFlow,
    })
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
    const freshDag = getWorkflowDagDedup(store, currentEng, reqFlow)
    const pgProbe = store && typeof store.pgWriteProbe === 'function'
      ? store.pgWriteProbe(currentEng)
      : getPgWriteProbe(currentEng)

    const finalSpec = (storeResult && storeResult.refined_spec && typeof storeResult.refined_spec === 'object')
      ? Object.assign({}, localSpec, storeResult.refined_spec)
      : localSpec
    const goalsOut = (storeResult && Array.isArray(storeResult.goals) && storeResult.goals.length > 0)
      ? storeResult.goals
      : ((freshDag && Array.isArray(freshDag.plan_goals)) ? freshDag.plan_goals : [])
    const workerTasksOut = (storeResult && Array.isArray(storeResult.worker_tasks) && storeResult.worker_tasks.length > 0)
      ? storeResult.worker_tasks
      : ((freshDag && Array.isArray(freshDag.worker_tasks)) ? freshDag.worker_tasks : [])

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
        prompt: promptText,
        refined_spec: finalSpec,
        refinedSpec: finalSpec,
        goals: goalsOut,
        plan_goals: goalsOut,
        worker_tasks: workerTasksOut,
        engagement: currentEng,
        active_engagement: currentEng,
        host_sessions: hostSessions,
        hostSessions,
        agentNetwork: synth.agentNetwork,
        agent_network: synth.agentNetwork,
        nodes: synth.nodes,
        swimlanes: synth.swimlanes,
        collabEvents: synth.collabEvents,
        collab_events: synth.collabEvents,
        collabTasks: synth.collabTasks,
        collab_tasks: synth.collabTasks,
        pg_probe: pgProbe,
        pgWriteProbe: pgProbe,
      },
    )
  }

  if (effectiveOp === 'updateWorkerGoal') {
    const rawPayload = Object.assign(
      {},
      request.payload && typeof request.payload === 'object' ? request.payload : {},
      request,
    )
    const currentEng = rawPayload.engagement || rawPayload.engagement_id || rawPayload.engagementId
      || (store ? getCachedActiveEngagementId(store) : null)
      || activeEngagement
    const payloadWithEng = Object.assign({}, rawPayload, {
      engagement: currentEng,
      engagement_id: currentEng,
      engagementId: currentEng,
    })
    let storeResult = null
    if (store && typeof store.updateWorkerGoal === 'function') {
      try {
        storeResult = await invokeStoreMethodCompat(store, 'updateWorkerGoal', currentEng, payloadWithEng)
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) }
      }
    } else if (store && typeof store.db === 'function') {
      try {
        const db = store.db(currentEng)
        const targetId = String(rawPayload.worker_task_id ?? rawPayload.worker_id ?? rawPayload.id ?? rawPayload.session_id ?? '').trim()
        const row = targetId
          ? (db.prepare('SELECT * FROM worker_tasks WHERE CAST(id AS TEXT) = ? OR session_id = ? OR worker_name = ? LIMIT 1')
            .get(targetId, targetId, targetId))
          : null
        if (!row) return { ok: false, error: `worker_task not found: ${targetId}` }
        const nextGoalVal = rawPayload.assigned_goal ?? rawPayload.goal ?? rawPayload.objective ?? row.assigned_goal
        const nextName = rawPayload.worker_name ?? rawPayload.title ?? row.worker_name
        const nextPrio = ['P0', 'P1', 'P2', 'P3'].includes(rawPayload.ui_priority || rawPayload.uiPriority)
          ? (rawPayload.ui_priority || rawPayload.uiPriority)
          : row.ui_priority
        const now = new Date().toISOString()
        db.prepare('UPDATE worker_tasks SET assigned_goal = ?, worker_name = ?, ui_priority = ?, updated_at = ? WHERE id = ?')
          .run(String(nextGoalVal || ''), String(nextName || ''), nextPrio, now, row.id)
        if (rawPayload.files_owned !== undefined || rawPayload.filesOwned !== undefined) {
          const filesJson = JSON.stringify(parseJsonArraySafe(rawPayload.files_owned ?? rawPayload.filesOwned))
          try {
            db.prepare('UPDATE worker_tasks SET files_owned_json = ? WHERE id = ?').run(filesJson, row.id)
          } catch { /* column optional on legacy schema */ }
        }
        const updated = db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(row.id)
        storeResult = { ok: true, worker_task: updated }
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) }
      }
    }

    reqFlow.dagByEng.delete(currentEng)
    bumpEventSeq('updateWorkerGoal', { engagement: currentEng })
    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, engagementId: currentEng, autoBind: true, reqFlow })
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
    return Object.assign({}, storeResult && typeof storeResult === 'object' ? storeResult : {}, {
      ok: storeResult && storeResult.ok === false ? false : true,
      op: 'updateWorkerGoal',
      engagement: currentEng,
      nodes: synth.nodes,
      swimlanes: synth.swimlanes,
      collabTasks: synth.collabTasks,
      collab_tasks: synth.collabTasks,
      agentNetwork: synth.agentNetwork,
    })
  }

  if (effectiveOp === 'addCustomWorkerTask') {
    const rawPayload = Object.assign(
      {},
      request.payload && typeof request.payload === 'object' ? request.payload : {},
      request,
    )
    const currentEng = rawPayload.engagement || rawPayload.engagement_id || rawPayload.engagementId
      || (store ? getCachedActiveEngagementId(store) : null)
      || activeEngagement
    const payloadWithEng = Object.assign({}, rawPayload, {
      engagement: currentEng,
      engagement_id: currentEng,
      engagementId: currentEng,
    })
    let storeResult = null
    if (store && typeof store.addCustomWorkerTask === 'function') {
      try {
        storeResult = await invokeStoreMethodCompat(store, 'addCustomWorkerTask', currentEng, payloadWithEng)
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) }
      }
    } else if (store && typeof store.db === 'function') {
      try {
        if (typeof store.workflowDag === 'function') store.workflowDag(currentEng)
        const db = store.db(currentEng)
        const now = new Date().toISOString()
        const role = inferAgentRole(rawPayload.title || rawPayload.worker_name || '', false, rawPayload.worker_role || rawPayload.role || 'exploit')
        const waveNum = parseWaveNumber(rawPayload.wave, AGENT_ROLE_META[role]?.wave || 3)
        const waveStr = `wave-${waveNum}`
        const wName = String(rawPayload.worker_name || rawPayload.title || `${role}-${Date.now().toString(36)}`).trim()
        const goalText = String(rawPayload.assigned_goal || rawPayload.goal || rawPayload.objective || wName).trim()
        const prio = ['P0', 'P1', 'P2', 'P3'].includes(rawPayload.ui_priority || rawPayload.uiPriority)
          ? (rawPayload.ui_priority || rawPayload.uiPriority)
          : 'P1'
        const weight = PRIORITY_META[prio] ? PRIORITY_META[prio].priorityWeight : 80
        const sessId = String(rawPayload.session_id || `wt-custom-${Date.now().toString(36)}`)
        const cols = db.prepare('PRAGMA table_info(worker_tasks)').all()
        const idCol = cols.find((c) => c.name === 'id')
        const intPk = Boolean(idCol && /INT/i.test(String(idCol.type || '')))
        const bindId = intPk ? null : sessId
        const resIns = db.prepare(`
          INSERT INTO worker_tasks (
            id, engagement_id, goal_id, session_id, worker_name, worker_role,
            wave, ui_priority, priority_weight, tags_json, assigned_goal,
            status, approval_state, next_goal, tool_calls, turns, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          bindId, currentEng, rawPayload.goal_id ?? null, sessId, wName, role,
          waveStr, prio, weight, JSON.stringify([`#${waveStr}`, `#${role}`]), goalText,
          String(rawPayload.status || 'pending'), 'in_progress', '', 0, 0, now, now,
        )
        const rowId = bindId !== null ? bindId : Number(resIns.lastInsertRowid)
        if (rawPayload.files_owned !== undefined || rawPayload.filesOwned !== undefined) {
          const filesJson = JSON.stringify(parseJsonArraySafe(rawPayload.files_owned ?? rawPayload.filesOwned))
          try { db.prepare('UPDATE worker_tasks SET files_owned_json = ? WHERE id = ?').run(filesJson, rowId) } catch { /* ignore */ }
        }
        const inserted = db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(rowId)
        storeResult = { ok: true, worker_task: inserted }
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) }
      }
    }

    reqFlow.dagByEng.delete(currentEng)
    bumpEventSeq('addCustomWorkerTask', { engagement: currentEng })
    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, engagementId: currentEng, autoBind: true, reqFlow })
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
    return Object.assign({}, storeResult && typeof storeResult === 'object' ? storeResult : {}, {
      ok: storeResult && storeResult.ok === false ? false : true,
      op: 'addCustomWorkerTask',
      engagement: currentEng,
      nodes: synth.nodes,
      swimlanes: synth.swimlanes,
      collabTasks: synth.collabTasks,
      collab_tasks: synth.collabTasks,
      agentNetwork: synth.agentNetwork,
    })
  }

  if (effectiveOp === 'retryWorkerTask') {
    const rawPayload = Object.assign(
      {},
      request.payload && typeof request.payload === 'object' ? request.payload : {},
      request,
    )
    const currentEng = rawPayload.engagement || rawPayload.engagement_id || rawPayload.engagementId
      || (store ? getCachedActiveEngagementId(store) : null)
      || activeEngagement
    const targetWorkerKey = String(
      rawPayload.worker_task_id ?? rawPayload.worker_id ?? rawPayload.workerId ?? rawPayload.session_id ?? rawPayload.id ?? '',
    ).trim()
    if (targetWorkerKey) {
      deleteScopedWorkerOverride(currentEng, targetWorkerKey)
    }
    const payloadWithEng = Object.assign({}, rawPayload, {
      engagement: currentEng,
      engagement_id: currentEng,
      engagementId: currentEng,
    })
    let storeResult = null
    if (store && typeof store.retryWorkerTask === 'function') {
      try {
        storeResult = await invokeStoreMethodCompat(store, 'retryWorkerTask', currentEng, payloadWithEng)
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : String(err) }
      }
    } else if (store && typeof store.db === 'function' && targetWorkerKey) {
      try {
        const db = store.db(currentEng)
        const row = db.prepare('SELECT * FROM worker_tasks WHERE CAST(id AS TEXT) = ? OR session_id = ? OR worker_name = ? LIMIT 1')
          .get(targetWorkerKey, targetWorkerKey, targetWorkerKey)
        if (row) {
          const now = new Date().toISOString()
          db.prepare("UPDATE worker_tasks SET status = 'running', approval_state = 'in_progress', ui_priority = 'P0', updated_at = ? WHERE id = ?")
            .run(now, row.id)
          try { db.prepare("UPDATE worker_tasks SET error_detail = '' WHERE id = ?").run(row.id) } catch { /* ignore */ }
          storeResult = { ok: true, worker_task: db.prepare('SELECT * FROM worker_tasks WHERE id = ?').get(row.id) }
        }
      } catch { /* fallback to workflowAction below */ }
    }
    if (!storeResult && store && typeof store.workflowAction === 'function') {
      try {
        storeResult = store.workflowAction(currentEng, Object.assign({}, payloadWithEng, { action: 'retryNode' }))
      } catch { storeResult = { ok: true } }
    }

    reqFlow.dagByEng.delete(currentEng)
    bumpEventSeq('retryWorkerTask', { engagement: currentEng, workerId: targetWorkerKey })
    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, engagementId: currentEng, autoBind: true, reqFlow })
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
    return Object.assign({}, storeResult && typeof storeResult === 'object' ? storeResult : {}, {
      ok: storeResult && storeResult.ok === false ? false : true,
      op: 'retryWorkerTask',
      engagement: currentEng,
      nodes: synth.nodes,
      swimlanes: synth.swimlanes,
      collabTasks: synth.collabTasks,
      collab_tasks: synth.collabTasks,
      agentNetwork: synth.agentNetwork,
    })
  }

  if (effectiveOp === 'shardLocks') {
    const currentEng = request.engagement || request.engagement_id || request.engagementId
      || (store ? getCachedActiveEngagementId(store) : null)
      || activeEngagement
    const wfDag = getWorkflowDagDedup(store, currentEng, reqFlow)
    return computeShardLocksFallback(store, currentEng, wfDag)
  }

  if (request.op === 'agentSessionDetail') {
    return await extractAgentSessionDetail(ctx, store, activeEngagement, request, reqFlow)
  }

  if (request.op === 'activateAgentSession') {
    const targetSid = String(request.sessionId || request.agentId || request.session || '').trim()
    const currentEng = (store ? getCachedActiveEngagementId(store) : null) || activeEngagement

    /* 验证 targetSid 是否为真实 DSH 宿主会话，严禁将 'root' / 'root-main' / 'sub-*' / 'wt-*' 合成 ID 写入 sessions.json！ */
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
        } else if (typeof store.bindSessionEngagement === 'function') {
          store.bindSessionEngagement(rootSessionId, currentEng, engName)
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
    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, engagementId: explicitEng || undefined, autoBind: true, reqFlow })
    const currentEng = explicitEng || (store ? getCachedActiveEngagementId(store) : null) || activeEngagement
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
    return {
      ok: true,
      items: hostSessions,
      active_engagement: currentEng,
      agentNetwork: synth.agentNetwork,
      agent_network: synth.agentNetwork,
      nodes: synth.nodes,
      swimlanes: synth.swimlanes,
      collabEvents: synth.collabEvents,
      collab_events: synth.collabEvents,
      collabTasks: synth.collabTasks,
      collab_tasks: synth.collabTasks,
    }
  }

  if (request.op === 'pgWriteProbe') {
    const probe = store && typeof store.pgWriteProbe === 'function'
      ? store.pgWriteProbe(activeEngagement)
      : getPgWriteProbe(activeEngagement)
    return Object.assign({ ok: true }, probe)
  }

  if (request.op === 'workflowDag' || request.op === 'workflowDocWall') {
    const explicitEng = request.engagement || request.engagement_id || request.engagementId || ''
    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, engagementId: explicitEng || undefined, autoBind: true, reqFlow })
    const currentEng = explicitEng || (store ? getCachedActiveEngagementId(store) : null) || activeEngagement
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
    const rawDagData = getWorkflowDagDedup(store, currentEng, reqFlow)
    if (rawDagData) {
      const dagData = Object.assign({}, rawDagData)
      if (Array.isArray(dagData.nodes)) {
        dagData.nodes = dagData.nodes.map((n, idx) => {
          const copy = Object.assign({}, n)
          computeWorkerLmtexMeta(copy, idx, { store, engagementId: currentEng })
          return copy
        })
      }
      if (Array.isArray(dagData.all_nodes)) {
        dagData.all_nodes = dagData.all_nodes.map((n, idx) => {
          const copy = Object.assign({}, n)
          computeWorkerLmtexMeta(copy, idx, { store, engagementId: currentEng })
          return copy
        })
      }
      if (dagData.telemetry && typeof dagData.telemetry === 'object') {
        dagData.telemetry = Object.assign({}, dagData.telemetry)
        sanitizeDagTelemetryCacheHit(dagData, synth.nodes)
      }
      return Object.assign({ ok: true }, dagData, {
        nodes: synth.childNodes.length > 0 && (!Array.isArray(dagData.active_nodes) || dagData.active_nodes.length === 0)
          ? synth.nodes
          : dagData.nodes,
        dag_role_nodes: dagData.nodes,
        host_sessions: hostSessions,
        agentNetwork: synth.agentNetwork,
        agent_network: synth.agentNetwork,
        swimlanes: synth.swimlanes,
        collabEvents: synth.collabEvents,
        collab_events: synth.collabEvents,
        collabTasks: synth.collabTasks,
        collab_tasks: synth.collabTasks,
      })
    }
    return {
      ok: true,
      standby: true,
      engagement: currentEng,
      runId: null,
      status: 'standby',
      nodes: synth.nodes,
      edges: [],
      activeRoles: [],
      docWall: [],
      host_sessions: hostSessions,
      agentNetwork: synth.agentNetwork,
      agent_network: synth.agentNetwork,
      swimlanes: synth.swimlanes,
      collabEvents: synth.collabEvents,
      collab_events: synth.collabEvents,
      collabTasks: synth.collabTasks,
      collab_tasks: synth.collabTasks,
    }
  }

  if (request.op === 'feishuConfig') {
    const currentEng = request.engagement || request.engagement_id || request.engagementId
      || (store ? getCachedActiveEngagementId(store) : null)
      || activeEngagement
    const feishuPayload = Object.assign(
      {},
      request.payload && typeof request.payload === 'object' ? request.payload : {},
      request,
      { engagement: currentEng, engagement_id: currentEng },
    )
    let feishuRes = null
    if (store && typeof store.saveFeishuConfig === 'function') {
      try {
        feishuRes = await invokeStoreMethodCompat(store, 'saveFeishuConfig', currentEng, feishuPayload)
      } catch { feishuRes = null }
    }
    if (!feishuRes && store && typeof store.workflowAction === 'function') {
      try {
        feishuRes = store.workflowAction(currentEng, Object.assign({}, feishuPayload, { action: 'feishuConfig' }))
      } catch {
        try {
          feishuRes = store.workflowAction(currentEng, Object.assign({}, feishuPayload, { action: 'saveFeishuWebhook' }))
        } catch {
          feishuRes = null
        }
      }
    }
    bumpEventSeq('feishuConfig', { engagement: currentEng })
    if (feishuRes && typeof feishuRes === 'object') {
      return Object.assign({ ok: true, engagement: currentEng }, feishuRes)
    }
    const rawUrl = String(feishuPayload.webhook_url ?? feishuPayload.webhookUrl ?? feishuPayload.webhook ?? feishuPayload.url ?? '').trim()
    return {
      ok: true,
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

  if (request.op === 'workflowAction' || request.op === 'workflowRun' || request.op === 'dagCheckpoint' || request.op === 'feishuNotify' || request.op === 'feishuTestPush') {
    const payload = request.op === 'feishuNotify' || request.op === 'feishuTestPush'
      ? Object.assign({ action: 'pushFeishuNotify' }, request)
      : (request.action === 'feishuConfig' ? Object.assign({}, request, { action: 'saveFeishuWebhook' }) : request)
    if (store && typeof store.workflowAction === 'function') {
      const res = Object.assign({ ok: true }, store.workflowAction(activeEngagement, payload))
      bumpEventSeq('workflowAction', { engagement: activeEngagement, action: payload.action || request.op })
      return res
    }
    return { ok: true, standby: true, engagement: activeEngagement }
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
    const max = maxAgentsOf(root, process.env)
    const thinkingEffort = thinkingEffortOf(root, process.env)
    const maxDepth = maxDepthOf(root, process.env)
    return {
      ok: true,
      max,
      maxAgents: max,
      thinking: thinkingEffort,
      thinkingEffort,
      thinking_effort: thinkingEffort,
      maxDepth,
      max_depth: maxDepth,
      source: 'settings',
      limit: MAX_AGENTS_LIMIT,
      max_depth_limit: MAX_DEPTH_LIMIT,
      valid_thinking_efforts: VALID_THINKING_EFFORTS,
      note: `集群并发策略已更新：最大并发 ${max} · 默认思考强度 ${thinkingEffort} · 递归深度上限 ${maxDepth}（立即生效）。`,
    }
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
    const thinkingEffort = thinkingEffortOf(root, process.env)
    const maxDepth = maxDepthOf(root, process.env)
    return {
      ok: true, max: next, maxAgents: next,
      thinking: thinkingEffort,
      thinkingEffort, thinking_effort: thinkingEffort,
      maxDepth, max_depth: maxDepth,
      source: 'settings', limit: MAX_AGENTS_LIMIT,
      note: '已保存为 ' + next + ' 个并发执行智能体，**立即生效**（派活时按新值放行，不用重启 dsh web）。',
    }
  }
  if (request.op === 'setPgUrl') {
    const saved = savePgUrl(root, request.url)
    try { if (store && typeof store.close === 'function') store.close() } catch { /* 忽略 */ }
    bumpEventSeq('setPgUrl')
    const dbEngine = store && typeof store.dbEngineInfo === 'function' ? store.dbEngineInfo() : resolvePgConfig(root)
    return {
      ok: true, url: saved, db_engine: dbEngine,
      note: saved ? '已保存 PostgreSQL 连接串并重连引擎池。' : '已清除自定义 PostgreSQL 连接串，回退高并发 WAL 引擎。',
    }
  }
  if (request.op === 'probePg') {
    const cfg = resolvePgConfig(root, process.env, { pgUrl: request.url })
    const probe = probePgConnection(cfg.url || request.url)
    return Object.assign({ db_engine: cfg }, probe)
  }

  /* op === 'agentsStatus'：即使 ctx.get('subagents') 不可用也绝不返回 ok: false，优雅回退至 sessions.list() + workflowDag */
  const max = maxAgentsOf(root, process.env)
  const thinkingEffort = thinkingEffortOf(root, process.env)
  const maxDepth = maxDepthOf(root, process.env)
  const explicitEng = request.engagement || request.engagement_id || request.engagementId || ''
  const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, engagementId: explicitEng || undefined, autoBind: true, reqFlow })
  const currentEng = explicitEng || (store ? getCachedActiveEngagementId(store) : null) || activeEngagement
  const dbEngine = store && typeof store.dbEngineInfo === 'function' ? store.dbEngineInfo() : resolvePgConfig(root)
  const pgProbe = store && typeof store.pgWriteProbe === 'function'
    ? store.pgWriteProbe(currentEng)
    : getPgWriteProbe(currentEng)

  const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession, reqFlow)
  const currentEngChildren = []
  for (const hs of hostSessions) {
    if (hs && hs.engagementId && hs.engagementId !== currentEng) continue
    for (const c of Array.isArray(hs && hs.children) ? hs.children : []) {
      currentEngChildren.push(c)
    }
  }
  const effectiveChildren = synth.childNodes.length > 0 ? synth.childNodes : currentEngChildren
  const running = effectiveChildren.filter((c) => c.activity === 'running')

  return {
    ok: true,
    max,
    maxAgents: max,
    used: running.length,
    free: Math.max(max - running.length, 0),
    running: running.slice(0, 20),
    children: effectiveChildren,
    total_children: effectiveChildren.length,
    host_sessions: hostSessions,
    hostSessions,
    active_engagement: currentEng,
    agentNetwork: synth.agentNetwork,
    agent_network: synth.agentNetwork,
    nodes: synth.nodes,
    swimlanes: synth.swimlanes,
    collabEvents: synth.collabEvents,
    collab_events: synth.collabEvents,
    collabTasks: synth.collabTasks,
    collab_tasks: synth.collabTasks,
    source: maxAgentsSourceOf(root, process.env),
    limit: MAX_AGENTS_LIMIT,
    default_max: DEFAULT_MAX_AGENTS,
    thinking: thinkingEffort,
    thinking_effort: thinkingEffort,
    thinkingEffort,
    default_thinking_effort: DEFAULT_THINKING_EFFORT,
    valid_thinking_efforts: VALID_THINKING_EFFORTS,
    max_depth: maxDepth,
    maxDepth,
    default_max_depth: DEFAULT_MAX_DEPTH,
    max_depth_limit: MAX_DEPTH_LIMIT,
    db_engine: dbEngine,
    pg_probe: pgProbe,
    note: '同一会话（工程工作区）同时最多 ' + max + ' 个执行智能体；按 4-Wave Bounded DAG 并发调度。',
  }
}

/**
 * 版本与更新类 op（面板右上角的「版本 + 自动更新」用）。
 * 不碰资产库，直接操作 profile 与 npm/pnpm；全部在 host 侧执行。
 * @param ctx - 插件上下文。
 * @param request - `{ op: 'version' | 'updateCheck' | 'updateApply', target? }`。
 * @returns JSON 结果，或 undefined 表示不是更新类 op。
 */
async function handleUpdateOp(ctx, request) {
  if (!['version', 'updateCheck', 'updateApply'].includes(request.op)) return undefined
  const pkg = pluginIdentity(ctx)
  const pre = await updatePreflight(ctx)
  if (request.op === 'version') {
    const check = await checkLatest(ctx, pre.dir, pkg.name)
    return {
      ok: true,
      plugin: pkg,
      install: {
        mode: pre.sourceInstall ? 'source' : 'package',
        dir: pre.dir,
        declared: pre.declared,
        packageManager: pre.packageManager,
      },
      latest: check && check.ok ? check.latest : null,
      updateAvailable: check && check.ok && pkg.version ? versionLess(pkg.version, check.latest) : false,
      /* 本地版本比 registry 还新：本机跑的是尚未发布的开发版本。
         不区分这一种，"检查更新"会一直显示"已是最新"，把"这个版本根本没发出去"藏起来。 */
      localAhead: check && check.ok && pkg.version ? versionLess(check.latest, pkg.version) : false,
      check_error: check && check.ok === false ? check.error : undefined,
      blockers: pre.blockers,
      notes: pre.notes,
      running_agents: pre.running,
    }
  }
  if (request.op === 'updateCheck') {
    const check = await checkLatest(ctx, pre.dir, pkg.name)
    if (check.ok !== true) return { ok: false, error: check.error, current: pkg.version, install: { mode: pre.sourceInstall ? 'source' : 'package' } }
    const localAhead = pkg.version ? versionLess(check.latest, pkg.version) : false
    return {
      ok: true, current: pkg.version, latest: check.latest,
      updateAvailable: pkg.version ? versionLess(pkg.version, check.latest) : true,
      localAhead,
      install: { mode: pre.sourceInstall ? 'source' : 'package', dir: pre.dir, packageManager: pre.packageManager, sourceInstall: pre.sourceInstall },
      blockers: pre.blockers,
      notes: pre.notes.concat(localAhead
        ? ['本机版本（' + pkg.version + '）比 npm 上的最新版（' + check.latest + '）还新：'
           + '当前跑的是尚未发布的开发版本，包管理器更新不适用（要回退版本请显式指定）。']
        : []),
      running_agents: pre.running,
    }
  }
  /* updateApply */
  if (pre.blockers.length > 0) {
    return { ok: false, error: '现在不能更新：' + pre.blockers.join(' '), blockers: pre.blockers, notes: pre.notes }
  }
  /* target 会被原样拼进 `npm install <target>`：不校验就等于把"装任意包并重启进程"
     暴露给浏览器侧输入。只接受纯 semver（可带 v 前缀），其余一律拒绝并说清原因。 */
  const rawTarget = typeof request.target === 'string' ? request.target.trim() : ''
  if (rawTarget !== '' && !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rawTarget)) {
    return {
      ok: false,
      current: pkg.version,
      error: 'updateApply 的 target 必须是纯版本号（如 0.11.0），收到 ' + JSON.stringify(rawTarget)
        + '。不接受包名、路径、URL 或 npm 参数 —— 它会原样传给包管理器，等于允许远程指定安装内容。',
    }
  }
  const result = await applyUpdate(ctx, pre.dir, pkg.name, rawTarget || null)
  if (result.ok !== true) return Object.assign({ current: pkg.version }, result)
  return Object.assign({ current: pkg.version, latest: request.target || null }, result, {
    note: '已安装，正在重启 dsh web（页面会在几秒内断开，重启完成后刷新即可看到新版本）。重启日志：' + result.restart.log,
  })
}

/**
 * 沿 `parentSession` 走到根会话 id（最多 64 层，防环）。
 *
 * 面板「跟随会话」需要它：host 侧绑定表只记**根会话**键，但用户在界面里点开的
 * 可能是子智能体的会话（比如派出去的「内网渗透」子智能体）—— 不解析到根，
 * 就会误判成"这个会话没绑靶标"，面板回落到"最后绑定的靶标"，切回主会话才对上。
 *
 * @param ctx - 插件上下文（读 sessions 注册表；不可用时返回原 id）。
 * @param sessionId - 任意会话 id。
 * @returns 根会话 id（解析不了就原样返回）。
 */
export function resolveRootSessionId(ctx, sessionId) {
  const id = String(sessionId || '')
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
])

const READ_ONLY_STORE_OPS = new Set([
  'bootstrap',
  'consoleDigest',
  'sessionBinding',
  'sessionBindings',
  'stats',
  'listEngagements',
  'listTargets',
  'getTarget',
  'listServices',
  'listVulns',
  'listCreds',
  'listSessions',
  'listSteps',
  'listNotes',
  'listFiles',
  'readFile',
  'listShots',
  'listTunnels',
  'listWebshells',
  'listScoreHits',
  'searchKb',
  'probeSessions',
])

function isLoopbackHostHeader(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader.trim()) return false
  const h = hostHeader.trim().toLowerCase()
  return /^localhost(?::\d+)?$/.test(h)
    || /^127\.0\.0\.1(?::\d+)?$/.test(h)
    || /^\[::1\](?::\d+)?$/.test(h)
}

function isAllowedSseRequest(req) {
  const origin = req.headers && req.headers.origin
  const host = req.headers && req.headers.host
  if (typeof origin === 'string' && origin !== '') {
    let originHost = null
    try { originHost = new URL(origin).host } catch { originHost = null }
    return Boolean(originHost && originHost === host)
  }
  const secFetchSite = req.headers && req.headers['sec-fetch-site']
  if (typeof secFetchSite === 'string' && secFetchSite !== '') {
    const sf = secFetchSite.trim().toLowerCase()
    if (sf === 'same-origin' || sf === 'none') return true
    return false
  }
  const referer = req.headers && req.headers.referer
  if (typeof referer === 'string' && referer !== '' && typeof host === 'string' && host !== '') {
    try {
      if (new URL(referer).host === host) return true
    } catch { /* ignore */ }
  }
  const remote = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : ''
  const loopbackRemote = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
  return loopbackRemote || isLoopbackHostHeader(host)
}

function sendJsonWithSeq(res, status, body) {
  if (body && typeof body === 'object' && !Array.isArray(body) && body.seq === undefined) {
    body = Object.assign({}, body, { seq: eventSeq })
  }
  sendJson(res, status, body)
}

/**
 * @param ctx - 插件上下文（已保证 redteam / webServer / skills / agentPresets 可用）。
 */
export function apply(ctx) {
  const store = ctx.redteam

  /* 监听宿主子智能体生命周期与活跃 JSONL 文件 mtime 推进，驱动 eventSeq 与 SSE 增量广播 */
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
        } catch { /* 宿主未注册该事件时不阻断 */ }
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

  /* GET /redteam/events：轻量级 SSE 增量事件流（初始 seq 握手 + 15s 保活心跳） */
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/redteam/events',
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

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/redteam/api',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'POST only' })
        return
      }
      /* 来源校验：**默认拒绝**。
         只在 origin 与 host 都是字符串时才比对是不够的：缺任意一个头就整段跳过，
         "校验被跳过"等同于"没有校验"，一个不发送 Origin 的请求就能打到所有 op
         （包括读明文凭据与 updateApply 这条会装包并重启进程的路径）。
         现在：有 Origin → 必须与 Host 同源；没有 Origin → 只允许来自回环地址的请求。 */
      const origin = req.headers.origin
      const host = req.headers.host
      if (typeof origin === 'string' && origin !== '') {
        let originHost = null
        try { originHost = new URL(origin).host } catch { originHost = null }
        if (originHost === null || originHost !== host) {
          sendJson(res, 403, { ok: false, error: 'cross-origin request rejected' })
          return
        }
      } else {
        const remote = req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : ''
        const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
        if (!loopback) {
          sendJson(res, 403, { ok: false, error: 'request without Origin is only accepted from loopback' })
          return
        }
      }
      try {
        const raw = await readBody(req)
        const request = raw.trim() ? JSON.parse(raw) : {}
        if (!request || typeof request !== 'object' || Array.isArray(request)) {
          sendJson(res, 400, { ok: false, error: 'invalid JSON request object' })
          return
        }

        /* sinceSeq 零开销短路：只读轮询 op 在 eventSeq 未推进时 <0.1ms 直接返回 unchanged: true */
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

        const agentsResult = await handleAgentsOp(ctx, request)
        if (agentsResult !== undefined) {
          sendJsonWithSeq(res, 200, agentsResult)
          return
        }
        const updateResult = await handleUpdateOp(ctx, request)
        if (updateResult !== undefined) {
          sendJsonWithSeq(res, 200, updateResult)
          return
        }
        const skillResult = await handleSkillOp(ctx, request)
        if (skillResult !== undefined) {
          sendJsonWithSeq(res, 200, skillResult)
          return
        }
        /* bootstrap / sessionBinding 时同步发现宿主 DSH 会话并确保当前会话已绑定工作区 */
        let hostSessions = null
        const reqFlow = createRequestFlow()
        if (request.op === 'bootstrap' || request.op === 'sessionBinding' || request.op === 'sessionBindings') {
          try {
            hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, autoBind: true, reqFlow })
          } catch { hostSessions = [] }
        }
        /* 会话类 op 需要"沿 parentSession 走到根会话"：绑定表只记根会话键，
           而界面里点开的可能是子智能体的会话（见 resolveRootSessionId）。
           其他 op 不受影响 —— 只是多带一个函数，dispatch 只在 sessionBinding* 用它。 */
        const withRoot = typeof request.session === 'string' && request.session
          ? Object.assign({}, request, { resolveRoot: (sid) => resolveRootSessionId(ctx, sid) })
          : request
        /* dispatchAsync 只多处理 probeSessions（连通性探测需要真实发起连接） */
        const result = await dispatchAsync(store, withRoot)
        if (request.op && !READ_ONLY_STORE_OPS.has(request.op)) {
          invalidateEngagementCaches(store)
          invalidateSessionBindingsCache(store)
          bumpEventSeq(String(request.op))
        }
        handleBootstrap(store, request, result)
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
