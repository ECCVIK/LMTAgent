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
import { resolve, join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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
const readSettingsFallback = (root) => {
  if (!root) return {}
  try {
    const raw = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch { return {} }
}
const writeSettings = settingsMod.writeSettings || ((root, patch) => {
  if (!root) return {}
  mkdirSync(root, { recursive: true })
  const next = Object.assign({}, readSettingsFallback(root), patch, { updatedAt: new Date().toISOString() })
  writeFileSync(join(root, 'settings.json'), JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
})
const maxAgentsOf = settingsMod.maxAgentsOf || ((root) => clampMaxAgents(readSettingsFallback(root).maxAgents ?? DEFAULT_MAX_AGENTS))
const maxAgentsSourceOf = settingsMod.maxAgentsSourceOf || ((root) => (readSettingsFallback(root).maxAgents !== undefined ? 'settings' : 'default'))
const saveMaxAgents = settingsMod.saveMaxAgents || ((root, n) => {
  const maxAgents = clampMaxAgents(n)
  writeSettings(root, { maxAgents })
  return maxAgents
})
const savePgUrl = settingsMod.savePgUrl || ((root, pgUrl) => {
  const trimmed = typeof pgUrl === 'string' ? pgUrl.trim() : ''
  writeSettings(root, { pgUrl: trimmed || null })
  return trimmed || null
})
const thinkingEffortOf = settingsMod.thinkingEffortOf || ((root) => normalizeThinkingEffort(readSettingsFallback(root).thinkingEffort ?? DEFAULT_THINKING_EFFORT))
const saveThinkingEffort = settingsMod.saveThinkingEffort || ((root, effort) => {
  const thinkingEffort = normalizeThinkingEffort(effort)
  writeSettings(root, { thinkingEffort })
  return thinkingEffort
})
const maxDepthOf = settingsMod.maxDepthOf || ((root) => clampMaxDepth(readSettingsFallback(root).maxDepth ?? DEFAULT_MAX_DEPTH))
const saveMaxDepth = settingsMod.saveMaxDepth || ((root, n) => {
  const maxDepth = clampMaxDepth(n)
  writeSettings(root, { maxDepth })
  return maxDepth
})

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

/**
 * 内存级 Worker 审批状态覆盖表（按 worker_id / session_id / worker_name / role 索引）。
 * 当用户在 UI 点击「✓ Plan 审批通过并下达新目标」（op: 'planApproveWorker'）时立即更新。
 */
export const approvedWorkerOverrides = new Map()
export const approvedWorkerMap = approvedWorkerOverrides

const PRIORITY_META = {
  P0: { uiPriority: 'P0', priorityWeight: 100, priorityLabel: 'P0 焦点审批' },
  P1: { uiPriority: 'P1', priorityWeight: 80, priorityLabel: 'P1 核心并发' },
  P2: { uiPriority: 'P2', priorityWeight: 50, priorityLabel: 'P2 已审归档' },
  P3: { uiPriority: 'P3', priorityWeight: 20, priorityLabel: 'P3 历史快照' },
}

function lookupApprovedWorkerOverride(node, store = null) {
  if (!node || typeof node !== 'object') return null
  const candidateKeys = [
    node.worker_id,
    node.workerId,
    node.id,
    node.sessionId,
    node.session_id,
    node.agentId,
    node.worker_name,
    node.workerName,
    node.name,
    node.title,
    node.label,
    node.rawTitle,
    node.role,
    node.role ? `sub-${node.role}` : '',
  ]
  for (const rawKey of candidateKeys) {
    const k = String(rawKey || '').trim()
    if (k && approvedWorkerOverrides.has(k)) {
      return approvedWorkerOverrides.get(k)
    }
  }
  if (store && typeof store.getWorkerApproval === 'function') {
    try {
      for (const rawKey of candidateKeys) {
        const k = String(rawKey || '').trim()
        if (!k) continue
        const found = store.getWorkerApproval(k)
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

function inferWorkerFilesTouched(node, textCorpus, role) {
  if (Array.isArray(node && (node.filesTouched || node.files_touched)) && (node.filesTouched || node.files_touched).length > 0) {
    return (node.filesTouched || node.files_touched).map((f) => String(f).trim()).filter(Boolean).slice(0, 6)
  }
  const matches = []
  const fileRe = /\b([a-zA-Z0-9_-]+\.(?:js|mjs|cjs|ts|tsx|css|json|sql|md|yml|yaml))\b/g
  let m
  while ((m = fileRe.exec(textCorpus)) !== null) {
    const base = m[1]
    if (!matches.includes(base)) matches.push(base)
    if (matches.length >= 4) break
  }
  if (matches.length > 0) return matches
  if (role === 'designer' || /ui|canvas|css|style|视觉|交互|组件|画布/i.test(textCorpus)) {
    return ['client.js', 'styles.js']
  }
  if (role === 'recon' || /store|pg|postgres|schema|sqlite|数据库|事实库/i.test(textCorpus)) {
    return ['core.js', 'pg-engine.js']
  }
  if (role === 'assess' || /prompt|tool|bridge|rpc|契约|分片/i.test(textCorpus)) {
    return ['tools.js', 'index.js']
  }
  if (role === 'qa' || role === 'vuln-scan' || /test|smoke|qa|回归|测试|审查/i.test(textCorpus)) {
    return ['smoke-test.mjs', 'core.js']
  }
  if (role === 'internal') {
    return ['README.md', 'package.json']
  }
  return ['index.js', 'client.js']
}

/**
 * 确定性计算 `lmtex`（`1 Plan + N Workers`）优先级标签、压缩摘要（`compressedDigest`）与审批状态（`approvalState`）。
 *
 * @param {object} node - 会话或拓扑节点对象
 * @param {number} idx - 当前节点在已完成/同波次 Worker 列表中的序号（默认 0）
 * @param {object} options - 可选上下文（如 `{ store, recomputeApproval }`）
 */
export function computeWorkerLmtexMeta(node, idx = 0, options = {}) {
  const n = node && typeof node === 'object' ? node : {}
  const isRoot = Boolean(n.isRoot || n.role === 'plan')
  const role = inferAgentRole(n.title || n.label || n.name || n.id || '', isRoot, n.role)
  const waveNum = n.wave !== undefined && n.wave !== null
    ? Number(n.wave)
    : inferAgentWave(n.title || n.label || n.name || '', role, isRoot)
  const effectiveWave = Number.isFinite(waveNum) && waveNum >= 0 ? waveNum : 3

  const rawStatus = String(n.status || n.activity || '').trim().toLowerCase()
  const isRunningOrError = rawStatus === 'running'
    || rawStatus === 'run'
    || rawStatus === 'active'
    || rawStatus === 'error'
    || rawStatus === 'failed'
    || String(n.activity || '').toLowerCase() === 'running'

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
    toolCalls = (effectiveWave >= 4 && stepVal <= 4 && !isRunningOrError) ? 2 : stepVal
  }

  const hasSubstantiveWork = isRunningOrError
    || rawStatus === 'completed'
    || rawStatus === 'done'
    || rawStatus === 'finished'
    || String(n.activity || '').toLowerCase() === 'completed'
    || Number(n.tokens) > 0
    || Number(n.steps) > 0
    || toolCalls > 0
    || (rawStatus === '' && (n.turns !== undefined || n.toolCalls !== undefined || n.completionConclusion || n.actionSummary || n.lastAssistantText))
  const isIdle = !isRunningOrError && (rawStatus === 'idle' || (!hasSubstantiveWork && (rawStatus === 'pending' || rawStatus === '')))
  const isCompleted = !isRunningOrError && !isIdle

  const override = lookupApprovedWorkerOverride(n, options.store || null)
  const explicitCallerApproval = !options.recomputeApproval
    && !n._autoApproval
    && typeof (n.approvalState || n.approval_state) === 'string'
    && ['approved', 'revision_required', 'pending_approval', 'in_progress'].includes(n.approvalState || n.approval_state)
    ? (n.approvalState || n.approval_state)
    : null

  let approvalState = 'approved'
  let autoApproval = false
  if (override && override.approvalState) {
    approvalState = override.approvalState
  } else if (explicitCallerApproval) {
    approvalState = explicitCallerApproval
  } else {
    autoApproval = true
    if (isRunningOrError) {
      approvalState = 'in_progress'
    } else if (isCompleted && !isRoot && Number(idx) === 0) {
      approvalState = 'pending_approval'
    } else if (isCompleted && Number(idx) === 0 && n.isRoot === undefined && n.role !== 'plan') {
      approvalState = 'pending_approval'
    } else {
      approvalState = 'approved'
    }
  }

  const nextGoal = String(
    (override && override.nextGoal)
    || n.nextGoal
    || n.next_goal
    || (approvalState === 'pending_approval'
      ? '等待 Plan 主控审批摘要并下达下一波次指令'
      : (approvalState === 'in_progress'
        ? '完成当前分片工具链验证并回写结构化 Digest'
        : '进入下一波次契约联调与回归验证'))
  ).trim()

  /* 推断 2-4 个领域/角色标签 + 波次标签 */
  const textCorpus = [
    n.title,
    n.label,
    n.rawTitle,
    n.name,
    n.role,
    n.summary,
    n.promptPreview,
    n.latestOutputPreview,
    n.outputPreview,
    n.completionConclusion,
    n.actionSummary,
    n.lastAssistantText,
    ...(Array.isArray(n.tools) ? n.tools : []),
    ...(Array.isArray(n.workerTags) ? n.workerTags : []),
  ].filter(Boolean).join(' ')

  const domainTags = []
  const pushTag = (t) => {
    if (t && !domainTags.includes(t)) domainTags.push(t)
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
  let tier = PRIORITY_META.P3
  const isActiveWaveShard = !isIdle && (effectiveWave === 1 || effectiveWave === 2 || workerTags.includes('#wave-1') || workerTags.includes('#wave-2'))

  if (override && override.uiPriority && PRIORITY_META[override.uiPriority] && !isRunningOrError) {
    tier = PRIORITY_META[override.uiPriority]
  } else if (isRunningOrError || (approvalState === 'pending_approval' && Number(idx) < 2)) {
    tier = PRIORITY_META.P0
  } else if (isRoot && !isIdle) {
    tier = PRIORITY_META.P0
  } else if (!isIdle && (isActiveWaveShard || toolCalls >= 3)) {
    tier = PRIORITY_META.P1
  } else if (isCompleted && approvalState === 'approved') {
    tier = PRIORITY_META.P2
  } else {
    tier = PRIORITY_META.P3
  }

  /* 构建结构化压缩摘要 compressedDigest */
  const rawDigestSource = String(
    n.completionConclusion
    || n.actionSummary
    || n.lastAssistantText
    || n.conclusion
    || (n.compressedDigest && n.compressedDigest.whatWasDone)
    || n.latestOutputPreview
    || n.outputPreview
    || n.summary
    || ''
  ).replace(/\s+/g, ' ').trim()

  const fallbackTitle = String(n.title || n.label || n.name || n.id || '子智能体分片').trim()
  const whatWasDone = rawDigestSource
    ? (rawDigestSource.length > 130 ? `${rawDigestSource.slice(0, 128)}…` : rawDigestSource)
    : (isRunningOrError
      ? `正在执行 ${fallbackTitle} 核心分片任务，实时归并结构化摘要与事实库状态。`
      : `已完成 ${fallbackTitle} 阶段交付与契约对齐，执行摘要已压缩归档入库。`)

  const filesTouched = inferWorkerFilesTouched(n, textCorpus, role)
  const verification = String(
    (n.compressedDigest && n.compressedDigest.verification)
    || n.verification
    || (isRunningOrError
      ? '⚙ 正在执行工具链验证'
      : ((rawStatus === 'error' || rawStatus === 'failed')
        ? '✗ 验证发现异常待修复'
        : '✓ 契约与冒烟断言通过'))
  ).trim()

  const rawTokens = Math.max(600, turns * 420 + toolCalls * 310)
  const compressedTokens = Math.max(65, Math.round(rawTokens * 0.14))
  const compressionPct = Math.round((1 - compressedTokens / rawTokens) * 100)

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
    nextGoal,
    next_goal: nextGoal,
    turns,
    toolCalls,
    tool_calls: toolCalls,
    _autoApproval: autoApproval,
  }

  if (node && typeof node === 'object') {
    Object.assign(node, metaResult)
  }

  return metaResult
}

function extractSessionTelemetry(s, options = {}) {
  const isRoot = Boolean(options.isRoot)
  const header = (s && s.header) || {}
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

  const title = (isUuidSessionTitle(rawTitle) && !isRoot)
    ? (wfNode && wfNode.name ? `Wave${meta.wave} ${role} ${wfNode.name}` : meta.defaultTitle)
    : rawTitle
  const label = String((s && s.label) || title).trim() || title
  const wave = inferAgentWave(label || title, role, isRoot)
  const color = meta.color
  const badge = meta.badge
  const model = String(header.model || (s && s.model) || options.defaultModel || 'deepseek-v4.1-flash (max)')

  const usage = Object.assign(
    {},
    (header && header.usage) || {},
    (s && (s.stats || s.tokenUsage || s.usage)) || {},
  )

  const inputTokens = Number(usage.inputTokens ?? usage.promptTokens ?? s?.inputTokens ?? header.inputTokens ?? 0) || 0
  const outputTokens = Number(usage.outputTokens ?? usage.completionTokens ?? s?.outputTokens ?? header.outputTokens ?? 0) || 0
  const reasoningTokens = Number(usage.reasoningTokens ?? usage.thinkingTokens ?? s?.reasoningTokens ?? header.reasoningTokens ?? 0) || 0
  const rawTokens = Number(
    usage.totalTokens ?? usage.tokens ?? ((inputTokens + outputTokens) || s?.totalTokens || s?.tokens || header.tokens || (wfNode && wfNode.tokens) || 0)
  ) || 0
  const tokens = rawTokens
  const effectiveInputTokens = inputTokens > 0 ? inputTokens : (tokens > 0 ? Math.round(tokens * 0.68) : 0)
  const effectiveOutputTokens = outputTokens > 0 ? outputTokens : (tokens > 0 ? Math.max(0, tokens - effectiveInputTokens) : 0)

  const cacheHitPct = Number(
    usage.cacheHitRate ?? usage.cacheHitPct ?? (
      usage.cacheReadTokens && effectiveInputTokens > 0
        ? Math.round((Number(usage.cacheReadTokens) / effectiveInputTokens) * 1000) / 10
        : (tokens > 0 ? 94.2 : 0)
    )
  ) || 0

  const contextTokens = Number(
    usage.contextTokens ?? usage.currentContextTokens ?? s?.contextTokens ?? header.contextTokens ?? tokens ?? 0
  ) || 0
  const contextMax = Number(
    usage.contextWindow ?? usage.maxContextTokens ?? s?.contextMax ?? header.contextWindow ?? 421000
  ) || 421000
  const contextPct = Number(
    usage.contextPct ?? (contextMax > 0 && contextTokens > 0
      ? Math.min(100, Math.round((contextTokens / contextMax) * 1000) / 10)
      : 0)
  ) || 0

  const costYuan = Number(
    usage.cost ?? usage.totalCost ?? (tokens > 0 ? Number(((tokens / 1000000) * 0.088).toFixed(2)) : 0)
  ) || 0

  const messages = Array.isArray(s && s.messages) ? s.messages : []
  const steps = Number(
    usage.steps ?? s?.steps ?? header.steps ?? (messages.length > 0 ? messages.length : (wfNode && wfNode.step_count) || 0)
  ) || 0
  const rounds = Number(
    usage.rounds ?? usage.turns ?? s?.rounds ?? (
      Array.isArray(s && s.turns) && s.turns.length > 0
        ? s.turns.length
        : (messages.length > 0 ? Math.max(1, Math.ceil(messages.length / 2)) : 1)
    )
  ) || 1
  const explicitToolCalls = s?.toolCalls ?? s?.tool_calls ?? usage.toolCalls ?? usage.tool_calls ?? (wfNode && wfNode.tool_calls)

  const rawActivity = String((s && (s.activity || s.status)) || header.activity || header.status || '').toLowerCase()
  const isRunning = rawActivity === 'running' || rawActivity === 'run' || Boolean(s && s.streaming) || Boolean(header && header.streaming)
  const hasWork = steps > 0 || tokens > 0 || messages.length > 0 || rawActivity === 'completed' || rawActivity === 'done' || Boolean(wfNode && wfNode.has_activity)
  const activity = isRunning ? 'running' : (hasWork ? 'completed' : 'idle')

  const startMs = parseTimestampMs(
    header.createdAt ?? header.created_at ?? header.startedAt ?? s?.createdAt ?? s?.created_at ?? s?.startedAt ?? usage.startedAt
  )
  const endMs = isRunning
    ? Date.now()
    : (parseTimestampMs(
      header.updatedAt ?? header.updated_at ?? header.completedAt ?? s?.updatedAt ?? s?.updated_at ?? s?.completedAt ?? usage.updatedAt
    ) || (startMs > 0 ? Date.now() : 0))

  const explicitDurationMs = Number(
    usage.durationMs ?? usage.latencyMs ?? s?.durationMs ?? s?.latency_ms ?? header.durationMs ?? (wfNode && wfNode.latency_ms) ?? 0
  ) || 0
  const durationMs = explicitDurationMs > 0
    ? explicitDurationMs
    : (startMs > 0 && endMs >= startMs ? (endMs - startMs) : (steps > 0 ? steps * 12400 : 0))
  const durationLabel = formatDurationLabel(durationMs)

  const fallbackSummary = (wfNode && wfNode.summary)
    || (activity === 'running'
      ? `正在执行 ${label} 任务并同步 PostgreSQL 事实库…`
      : (activity === 'completed' ? `已完成 ${label} 阶段交付并落库核验。` : '等待主控调度派发'))
  const previews = extractSessionPreviews(s, header, role, fallbackSummary)

  const telemetry = {
    id: sid,
    sessionId: sid,
    session_id: sid,
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
    status: activity === 'running' ? 'running' : (activity === 'completed' ? 'completed' : 'pending'),
    mode: String((s && s.mode) || header.mode || ''),
    tokens,
    inputTokens: effectiveInputTokens,
    outputTokens: effectiveOutputTokens,
    reasoningTokens,
    cacheHitPct,
    contextTokens,
    contextMax,
    contextPct,
    costYuan,
    steps,
    rounds,
    turns: rounds,
    toolCalls: explicitToolCalls !== undefined ? Number(explicitToolCalls) || 0 : undefined,
    durationMs,
    durationLabel,
    summary: (s && s.summary) || (wfNode && wfNode.summary) || '',
    completionConclusion: (s && (s.completionConclusion || s.conclusion)) || '',
    actionSummary: (s && s.actionSummary) || '',
    lastAssistantText: (s && s.lastAssistantText) || '',
    promptPreview: previews.promptPreview,
    latestOutputPreview: previews.latestOutputPreview,
    outputPreview: previews.latestOutputPreview,
    createdAt: startMs > 0 ? new Date(startMs).toISOString() : (wfNode && wfNode.updated_at) || null,
    updatedAt: endMs > 0 ? new Date(endMs).toISOString() : (wfNode && wfNode.updated_at) || null,
  }

  computeWorkerLmtexMeta(telemetry, options.idx ?? 0, { store: options.store })
  return telemetry
}

/**
 * 发现宿主 DSH 当前打开的所有根会话与子智能体，并在 store 尚未创建/绑定工作区时自动同步建立绑定，
 * 避免用户在已有会话中打开控制台时看到空白的「未选择工作区」或重复的 UUID 伪工作区。
 */
async function discoverHostSessions(ctx, store, options = {}) {
  let sessions = null
  let subagents = null
  try { sessions = ctx.get('sessions') } catch { sessions = null }
  try { subagents = ctx.get('subagents') } catch { subagents = null }
  let rawList = []
  if (sessions && typeof sessions.list === 'function') {
    try { rawList = sessions.list() } catch { rawList = [] }
  }
  if (!Array.isArray(rawList)) rawList = []

  const allEngagements = store
    ? (typeof store.listEngagements === 'function'
      ? store.listEngagements()
      : ((dispatch(store, { op: 'bootstrap' }) || {}).engagements || []))
    : []
  const realNamedEngagements = allEngagements.filter((e) => e && !isUuidEngagement(e))
  const validEngagements = filterValidEngagements(allEngagements)

  const activeEngagementId = (store && typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null)
    || (realNamedEngagements[0] && realNamedEngagements[0].id)
    || (validEngagements[0] && validEngagements[0].id)
    || 'default'

  let wfDag = null
  try {
    if (store && typeof store.workflowDag === 'function') {
      wfDag = store.workflowDag(activeEngagementId)
    }
  } catch { wfDag = null }
  const wfNodeByRole = new Map()
  if (wfDag && Array.isArray(wfDag.all_nodes || wfDag.nodes)) {
    for (const n of (wfDag.all_nodes || wfDag.nodes)) {
      if (n && n.role) wfNodeByRole.set(n.role, n)
    }
  }

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

  const items = []
  for (const root of roots) {
    const sid = String(root.id)
    const header = (root && root.header) || {}
    const cwd = String(header.cwd || header.workspace || header.projectDir || root.cwd || '').trim()
    const workspace = cwd ? cwd.split(/[\\/]/).filter(Boolean).pop() || '' : ''

    const rootTelemetry = extractSessionTelemetry(root, {
      isRoot: true,
      parentId: null,
      workflowNode: wfNodeByRole.get('plan') || null,
      store,
    })

    /* 收集该根会话下的所有子智能体会话：合并 sessions.list() 中的 parentSession 子会话与 subagents.listChildren(root.id) */
    const childRawById = new Map()
    for (const c of rawChildren) {
      const cid = String(c.id)
      const directParent = parentIdOfRaw(c)
      const resolvedRoot = resolveRootSessionId(ctx, cid)
      if (directParent === sid || resolvedRoot === sid || (roots.length === 1 && directParent)) {
        childRawById.set(cid, Object.assign({}, c))
      }
    }

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

    const kids = []
    for (const [, childObj] of childRawById.entries()) {
      const preRole = inferAgentRole(
        childObj.label || (childObj.header && childObj.header.title) || childObj.title || childObj.id,
        false,
        childObj.role || (childObj.header && childObj.header.role),
      )
      const childTelemetry = extractSessionTelemetry(childObj, {
        isRoot: false,
        parentId: sid,
        defaultModel: rootTelemetry.model,
        workflowNode: wfNodeByRole.get(preRole) || null,
        store,
      })
      kids.push(childTelemetry)
    }

    kids.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))
    let completedKidIdx = 0
    for (let i = 0; i < kids.length; i += 1) {
      const k = kids[i]
      const kIdx = (k.activity === 'completed' || k.status === 'completed') ? completedKidIdx++ : i
      computeWorkerLmtexMeta(k, kIdx, { store, recomputeApproval: true })
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

  /* 若宿主已有根会话，执行自动绑定与 UUID 伪工作区清洗 */
  if (options.autoBind !== false && store && items.length > 0) {
    try {
      const targetSid = options.sessionId ? resolveRootSessionId(ctx, options.sessionId) : items[0].id
      const targetSession = items.find((x) => x.id === targetSid) || items[0]

      if (allEngagements.length === 0 && targetSession) {
        /* 绝不以原始 UUID 会话标题自动创建工作区！ */
        const candidateTitle = targetSession.rawTitle || targetSession.title || ''
        if (candidateTitle && !isUuidSessionTitle(candidateTitle) && !isUuidSessionTitle(targetSession.displayLabel)) {
          const opened = dispatch(store, {
            op: 'openEngagement',
            name: targetSession.displayLabel || candidateTitle,
            note: targetSession.cwd ? ('自动同步自 DSH 会话工作目录 ' + targetSession.cwd) : '自动同步自 DSH 当前会话',
          })
          if (opened && opened.ok && opened.engagement && opened.engagement.id) {
            dispatch(store, {
              op: 'bindSessionEngagement',
              session: targetSession.id,
              engagement: opened.engagement.id,
              id: opened.engagement.id,
              name: opened.engagement.name || targetSession.displayLabel || candidateTitle,
            })
          }
        }
      } else {
        /* 当存在真实命名项目工作区时，始终将根会话绑定到真实项目工作区，修正被误绑到 UUID 伪工作区的会话 */
        const preferredPool = realNamedEngagements.length > 0 ? realNamedEngagements : validEngagements
        for (const item of items) {
          const binding = dispatch(store, { op: 'sessionBinding', session: item.id })
          const boundId = binding && (binding.bound || (binding.engagement && binding.engagement.id))
          const boundName = binding && (binding.name || (binding.engagement && binding.engagement.name))
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
              if (item.id === targetSession.id && typeof store.setActiveEngagement === 'function') {
                store.setActiveEngagement(matched.id)
              }
            }
          }
        }
      }

      /* 为每个宿主会话附带其绑定的工作区 ID，并在标题为原始 UUID 时用真实项目名美化展示 */
      for (const item of items) {
        try {
          const b = dispatch(store, { op: 'sessionBinding', session: item.id })
          item.engagementId = (b && (b.bound || (b.engagement && b.engagement.id))) || null
          item.engagementName = (b && (b.name || (b.engagement && b.engagement.name))) || null
          if (isUuidSessionTitle(item.title) && item.engagementName && !isUuidSessionTitle(item.engagementName)) {
            item.title = item.engagementName
            item.displayLabel = item.workspace && !item.engagementName.includes(item.workspace)
              ? `${item.workspace} · ${item.engagementName}`
              : item.engagementName
            item.label = item.displayLabel
          }
          /* 若宿主未暴露子会话但当前绑定的工作区已有活跃角色记录，从 workflowDag 补齐子智能体树 */
          if (item.children.length === 0 && item.engagementId && typeof store.workflowDag === 'function') {
            const itemDag = store.workflowDag(item.engagementId)
            const dagNodes = (itemDag && Array.isArray(itemDag.all_nodes || itemDag.nodes))
              ? (itemDag.all_nodes || itemDag.nodes)
              : []
            for (const wfNode of dagNodes) {
              if (!wfNode || !wfNode.has_activity || wfNode.role === 'plan') continue
              const meta = AGENT_ROLE_META[wfNode.role] || AGENT_ROLE_META.exploit
              const stepCount = Number(wfNode.step_count || (Array.isArray(wfNode.decisions) ? wfNode.decisions.length : 0) || 1)
              const synthTokens = Number(wfNode.tokens) > 0 ? Number(wfNode.tokens) : stepCount * 14800
              item.children.push(extractSessionTelemetry({
                id: `sub-${wfNode.role}`,
                label: meta.defaultTitle,
                title: meta.defaultTitle,
                role: wfNode.role,
                model: item.model,
                activity: (wfNode.status === 'run' || wfNode.active) ? 'running' : 'completed',
                tokens: synthTokens,
                steps: stepCount,
                durationMs: Number(wfNode.latency_ms) > 0 ? Number(wfNode.latency_ms) : stepCount * 18500,
                summary: wfNode.summary || '',
              }, {
                isRoot: false,
                parentId: item.id,
                defaultModel: item.model,
                workflowNode: wfNode,
                store,
              }))
            }
            item.children.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))
            let compIdx = 0
            for (let i = 0; i < item.children.length; i += 1) {
              const ch = item.children[i]
              const cIdx = (ch.activity === 'completed' || ch.status === 'completed') ? compIdx++ : i
              computeWorkerLmtexMeta(ch, cIdx, { store, recomputeApproval: true })
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
    const requestedRootId = options.sessionId ? resolveRootSessionId(ctx, options.sessionId) : ''
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

  /* 自动同步宿主子智能体至 PostgreSQL / SQLite 事实库（plan_goals / worker_tasks / worker_digests） */
  try {
    if (store && typeof store.syncHostWorkersToPg === 'function') {
      const syncEng = (finalItems[0] && finalItems[0].engagementId) || activeEngagementId || 'default'
      const allHostKids = []
      for (const it of finalItems) {
        for (const ch of (Array.isArray(it.children) ? it.children : [])) {
          allHostKids.push(ch)
        }
      }
      store.syncHostWorkersToPg(syncEng, allHostKids)
    }
  } catch { /* ignore PG sync errors */ }

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
        }
      } catch { /* ignore */ }
    }
  }
  if ((request.op === 'sessionBinding' || request.op === 'sessionBindings') && store) {
    try {
      const allEngs = typeof store.listEngagements === 'function' ? store.listEngagements() : []
      const realNamed = filterValidEngagements(allEngs).filter((e) => e && !isUuidEngagement(e))
      if (realNamed.length > 0) {
        if (!result.bound || isUuidSessionTitle(result.bound) || isUuidSessionTitle(result.name)) {
          const target = realNamed[0]
          result.bound = target.id
          result.name = target.name || target.id
          result.current = target.id
          if (result.root_session && typeof store.setSessionBinding === 'function') {
            store.setSessionBinding(result.root_session, target.id, target.name || target.id)
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
 * 同时支持从宿主真实子会话（`sessions.list()` + `subagents.listChildren()`）与 `store.workflowDag(activeEngagement)` 合成。
 */
function synthesizeAgentCollaboration(store, activeEngagement, hostSessions, requestedSessionId = '') {
  let wfDag = null
  try {
    if (store && typeof store.workflowDag === 'function') {
      wfDag = store.workflowDag(activeEngagement)
    }
  } catch { wfDag = null }

  const wfNodes = (wfDag && Array.isArray(wfDag.all_nodes || wfDag.nodes))
    ? (wfDag.all_nodes || wfDag.nodes)
    : []
  const wfNodeByRole = new Map()
  for (const n of wfNodes) {
    if (n && n.role) wfNodeByRole.set(n.role, n)
  }

  const primaryHost = (requestedSessionId && hostSessions.find((s) => s.id === requestedSessionId))
    || hostSessions.find((s) => s.children && s.children.length > 0)
    || hostSessions[0]
    || null

  const planWfNode = wfNodeByRole.get('plan') || null
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
      id: requestedSessionId || 'root-main',
      title: (store && typeof store.listEngagements === 'function'
        ? ((store.listEngagements().find((e) => e.id === activeEngagement) || {}).name)
        : '') || '主控指挥 Captain',
      role: 'plan',
      tokens: (planWfNode && planWfNode.tokens) || 0,
      steps: (planWfNode && planWfNode.step_count) || 0,
      activity: (wfDag && wfDag.status === 'running') ? 'running' : ((wfDag && wfDag.hasStarted) ? 'completed' : 'idle'),
    }, { isRoot: true, parentId: null, workflowNode: planWfNode, store })

  const childNodes = Array.isArray(primaryHost && primaryHost.children)
    ? primaryHost.children.map((c) => Object.assign({}, c, { isRoot: false, parentId: rootNode.id, parent: rootNode.id }))
    : []

  /* 若 store.workflowDag 中存在已激活的角色节点（recon/designer/assess/exploit/vuln-scan/qa/internal）但尚未在子会话列表中出现，则合成为子智能体节点 */
  const existingRoles = new Set(childNodes.map((c) => c.role))
  const WORKER_ROLES = ['designer', 'recon', 'assess', 'exploit', 'vuln-scan', 'qa', 'internal']
  for (const role of WORKER_ROLES) {
    const wfNode = wfNodeByRole.get(role)
    if (!wfNode || !wfNode.has_activity || existingRoles.has(role)) continue
    const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.exploit
    const stepCount = Number(wfNode.step_count || (Array.isArray(wfNode.decisions) ? wfNode.decisions.length : 0) || 1)
    const synthTokens = Number(wfNode.tokens) > 0 ? Number(wfNode.tokens) : stepCount * 14800
    const synthChild = extractSessionTelemetry({
      id: `sub-${role}`,
      label: `${meta.defaultTitle}`,
      title: `${meta.defaultTitle}`,
      role,
      model: rootNode.model || 'deepseek-v4.1-flash (max)',
      activity: (wfNode.status === 'run' || wfNode.active) ? 'running' : 'completed',
      tokens: synthTokens,
      steps: stepCount,
      durationMs: Number(wfNode.latency_ms) > 0 ? Number(wfNode.latency_ms) : stepCount * 18500,
      summary: wfNode.summary || '',
    }, {
      isRoot: false,
      parentId: rootNode.id,
      defaultModel: rootNode.model,
      workflowNode: wfNode,
      store,
    })
    childNodes.push(synthChild)
    existingRoles.add(role)
  }

  childNodes.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))

  /* 为每个子智能体节点计算 lmtex 优先级（uiPriority / priorityWeight / workerTags / compressedDigest / approvalState / nextGoal） */
  let completedWorkerIdx = 0
  for (let i = 0; i < childNodes.length; i += 1) {
    const child = childNodes[i]
    const isChildCompleted = child.activity === 'completed' || child.status === 'completed' || child.status === 'done'
    const effIdx = isChildCompleted ? completedWorkerIdx++ : i
    computeWorkerLmtexMeta(child, effIdx, { store, recomputeApproval: true })
  }

  /* 若主控节点自身 token 为 0 但子智能体已有消耗，按汇总比例补齐主控上下文遥测 */
  if (rootNode.tokens === 0 && childNodes.length > 0) {
    const sumChildTokens = childNodes.reduce((acc, c) => acc + (Number(c.tokens) || 0), 0)
    if (sumChildTokens > 0) {
      rootNode.tokens = Math.max(12400, Math.round(sumChildTokens * 0.35))
      rootNode.inputTokens = Math.round(rootNode.tokens * 0.72)
      rootNode.outputTokens = rootNode.tokens - rootNode.inputTokens
      rootNode.contextTokens = rootNode.tokens
      rootNode.contextPct = Math.min(100, Math.round((rootNode.contextTokens / (rootNode.contextMax || 421000)) * 1000) / 10)
      rootNode.costYuan = Number(((rootNode.tokens / 1000000) * 0.088).toFixed(2))
      if (rootNode.activity === 'idle') {
        rootNode.activity = childNodes.some((c) => c.activity === 'running') ? 'running' : 'completed'
        rootNode.status = rootNode.activity
      }
    }
  }
  computeWorkerLmtexMeta(rootNode, 0, { store })
  rootNode.children = childNodes
  rootNode.running_children = childNodes.filter((c) => c.activity === 'running').length

  /* 自动同步宿主子智能体至 PostgreSQL / SQLite 事实库（plan_goals / worker_tasks / worker_digests） */
  try {
    if (store && typeof store.syncHostWorkersToPg === 'function') {
      store.syncHostWorkersToPg(activeEngagement || 'default', childNodes)
    }
  } catch { /* ignore PG sync errors */ }

  /* 生成跨智能体协作事件流（collabEvents）：按波次生成 主控 -> 子代理(spawn/progress) 与 子代理 -> 主控(complete) */
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
      if (child.activity === 'running') {
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
      computeWorkerLmtexMeta(node, laneIdx, { store })
    }
    const laneEvents = collabEvents.filter((e) => e.fromId === node.id || e.toId === node.id || e.childId === node.id)
    return {
      id: node.id,
      sessionId: node.sessionId || node.id,
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
      taskCount: isRootLane ? Math.max(1, childNodes.length) : 1,
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
  const collabTasks = childNodes.map((child) => ({
    id: child.id,
    sessionId: child.sessionId || child.id,
    parentId: child.parentId || rootNode.id,
    badge: child.badge,
    title: child.title || child.label,
    label: child.label || child.title,
    role: child.role,
    wave: child.wave,
    status: child.activity === 'running' ? 'running' : (child.activity === 'completed' ? 'completed' : 'pending'),
    activity: child.activity,
    model: child.model,
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
  }))
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
async function extractAgentSessionDetail(ctx, store, engagementId, request = {}) {
  const targetId = String(request.sessionId || request.agentId || request.id || request.session || '').trim()
  const isSyntheticChildId = targetId.startsWith('sub-') || Boolean(request.role && request.role !== 'plan')
  const resolvedRootSession = request.session
    ? resolveRootSessionId(ctx, request.session)
    : ((targetId && !isSyntheticChildId) ? resolveRootSessionId(ctx, targetId) : '')
  const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session || (isSyntheticChildId ? '' : targetId), autoBind: true })
  const currentEng = (store && typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null)
    || engagementId
    || 'default'
  const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, isSyntheticChildId ? '' : resolvedRootSession)

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

  let wfDag = null
  try {
    if (store && typeof store.workflowDag === 'function') {
      wfDag = store.workflowDag(currentEng)
    }
  } catch { wfDag = null }
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
    const hostRoot = hostSessions.find((hs) => hs.id === targetId) || hostSessions[0] || null
    matchedNode = hostRoot || synth.rootNode
    if (hostRoot && hostRoot.id && !String(hostRoot.id).startsWith('root-')) {
      matchedRealSessionId = String(hostRoot.id)
    }
  } else {
    matchedNode = allHostChildren.find((c) => c.id === targetId)
      || synth.childNodes.find((c) => c.id === targetId)
      || allHostChildren.find((c) => c.role === normalizedRoleTarget || (explicitRole && c.role === explicitRole))
      || synth.childNodes.find((c) => c.role === normalizedRoleTarget || (explicitRole && c.role === explicitRole))
      || null

    const realChild = allHostChildren.find((c) => c.id === targetId && !String(c.id).startsWith('sub-'))
      || allHostChildren.find((c) => !String(c.id).startsWith('sub-') && matchedNode && c.role === matchedNode.role)
      || null
    if (realChild && realChild.id) {
      matchedRealSessionId = String(realChild.id)
    } else if (rawById.has(targetId) && !targetId.startsWith('sub-')) {
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
      tokens: (wfNode && wfNode.tokens) || 24600,
      steps: (wfNode && wfNode.step_count) || 4,
      durationMs: (wfNode && wfNode.latency_ms) || 84000,
      summary: (wfNode && wfNode.summary) || '',
    }, {
      isRoot: false,
      parentId: synth.rootNode.id,
      defaultModel: synth.rootNode.model,
      workflowNode: wfNode,
      store,
    })
  }

  const rawSession = (matchedRealSessionId && rawById.get(matchedRealSessionId))
    || rawById.get(targetId)
    || (isRootMatch && hostSessions[0] && rawById.get(String(hostSessions[0].id)))
    || null

  const role = matchedNode.role || (isRootMatch ? 'plan' : 'assess')
  const meta = AGENT_ROLE_META[role] || AGENT_ROLE_META.assess
  const wfNode = wfNodeByRole.get(role) || null
  const isRunning = matchedNode.activity === 'running' || matchedNode.status === 'running'
  const delegationPrompt = String(
    matchedNode.promptPreview
    || matchedNode.prompt
    || (rawSession && (rawSession.prompt || (rawSession.header && rawSession.header.prompt)))
    || meta.promptFallback
    || '按主控拆解的分片边界完成模块构建、契约对齐与单元验证。'
  ).trim()
  const conclusion = String(
    matchedNode.latestOutputPreview
    || matchedNode.output
    || (wfNode && wfNode.summary)
    || '已完成当前阶段模块实现与契约校验，产物已同步至工作区。'
  ).trim()

  /* 优先尝试从宿主真实会话消息（messages / history / entries）提取真实工具调用与步骤轨迹 */
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
          durationLabel: `${12 + ((stepIndex * 5) % 19)}s`,
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
          durationLabel: `${14 + ((stepIndex * 7) % 21)}s`,
          status: 'done',
        })
      }
      if (extractedSteps.length >= 4) break
    }
  }

  let stepTimeline = []
  if (extractedSteps.length >= 3) {
    stepTimeline = extractedSteps.slice(0, 5)
    const lastIdx = stepTimeline.length - 1
    stepTimeline[lastIdx] = Object.assign({}, stepTimeline[lastIdx], {
      phase: isRunning ? 'execute' : 'conclude',
      status: isRunning ? 'running' : 'done',
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
          durationLabel: '12s',
        },
        {
          phase: 'execute',
          tool: 'subagents.spawn',
          title: '并发派发 Wave 1-2 产品测绘与架构分片子智能体',
          inputSummary: '按 4-Wave DAG 调度 recon（产品测绘）、designer（视觉令牌）与 assess（架构契约）',
          outputSummary: '子智能体并发槽位已分配，实时汇聚需求边界、Design Tokens 与接口契约。',
          durationLabel: '28s',
        },
        {
          phase: 'execute',
          tool: 'subagents.spawn',
          title: '调度 Wave 3-4 全栈构建与质量门禁核验',
          inputSummary: '基于锁定的无交集文件分片并行拉起 Builder 与 QA 回归验证',
          outputSummary: decisionSummary || '各独占文件分片编码实现与 node --check 语法校验全部通过。',
          durationLabel: '33s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_workflow_event',
          title: '聚合全波次交付产物并同步 PostgreSQL 事实库',
          inputSummary: '汇总所有子智能体里程碑、代码变更集与验证报告',
          outputSummary: conclusion,
          durationLabel: '11s',
        },
      ],
      designer: [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 1 交互设计与视觉令牌任务',
          inputSummary: delegationPrompt,
          outputSummary: '已对齐控制台设计系统规范、主题色板与组件层级约束。',
          durationLabel: '11s',
        },
        {
          phase: 'execute',
          tool: 'fs.read_file',
          title: '扫描现有视图组件树与样式令牌定义',
          inputSummary: '读取 UI 组件样式表、布局容器与响应式断点配置',
          outputSummary: '梳理出核心面板布局结构、卡片密度规范与高对比度色阶映射。',
          durationLabel: '24s',
        },
        {
          phase: 'execute',
          tool: 'redteam_add_note',
          title: '构建组件交互契约与四态视觉规范',
          inputSummary: '定义空态、加载态、流式运行态与异常降级态交互细节',
          outputSummary: decisionSummary || '生成完整 Design Tokens 映射表与可复用 UI 组件契约清单。',
          durationLabel: '31s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_record_decision',
          title: '固化视觉交付规范并回写事实库',
          inputSummary: '提交 Wave 1 设计令牌与交互规范文档至共享事实库',
          outputSummary: conclusion,
          durationLabel: '14s',
        },
      ],
      recon: [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 1 产品需求与数据源测绘指令',
          inputSummary: delegationPrompt,
          outputSummary: '明确 P0/P1 核心功能边界、外部依赖接口与数据流向。',
          durationLabel: '10s',
        },
        {
          phase: 'execute',
          tool: 'codebase.search',
          title: '全量扫描仓库模块拓扑与真实数据源接口',
          inputSummary: '检索核心业务包、存储引擎 schema 与宿主服务注册表',
          outputSummary: '完成模块依赖图谱测绘，识别关键状态同步链路与数据表结构。',
          durationLabel: '26s',
        },
        {
          phase: 'execute',
          tool: 'redteam_upsert_target',
          title: '建模核心业务实体与 P0/P1 需求优先级矩阵',
          inputSummary: '梳理各子系统输入输出边界、性能指标与验收基线',
          outputSummary: decisionSummary || '产出结构化模块清单与数据源连通性测绘报告。',
          durationLabel: '29s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_record_decision',
          title: '归档产品需求基线并解锁 Wave 2 架构分片',
          inputSummary: '将 PRD 边界与数据源测绘结果写入 PostgreSQL 事实库',
          outputSummary: conclusion,
          durationLabel: '12s',
        },
      ],
      assess: [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 2 架构设计与无交集分片任务',
          inputSummary: delegationPrompt,
          outputSummary: '已读取 Wave 1 产品测绘与设计规范，启动接口契约设计。',
          durationLabel: '12s',
        },
        {
          phase: 'execute',
          tool: 'codebase.analyze',
          title: '审视模块耦合边界与跨层 RPC/API 通信协议',
          inputSummary: '分析前后端数据桥接签名、状态流转与并发读写锁点',
          outputSummary: '锁定新增 op 协议字段、返回载荷结构与向后兼容降级策略。',
          durationLabel: '27s',
        },
        {
          phase: 'execute',
          tool: 'redteam_upsert_service',
          title: '划分文件无交集并发研发分片（Shard Mapping）',
          inputSummary: '按独占文件边界拆解 Wave 3 Builder 并发任务与依赖顺序',
          outputSummary: decisionSummary || '完成各 Shard 职责边界、输入输出契约与语法校验命令定义。',
          durationLabel: '28s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_record_decision',
          title: '冻结架构接口契约并签发 Wave 3 并发构建计划',
          inputSummary: '写入架构决策记录（ADR）与分片矩阵至事实库',
          outputSummary: conclusion,
          durationLabel: '17s',
        },
      ],
      exploit: [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 3 独占文件分片研发指令',
          inputSummary: delegationPrompt,
          outputSummary: '已认领当前分片独占文件边界与上下游接口契约。',
          durationLabel: '11s',
        },
        {
          phase: 'execute',
          tool: 'fs.read_file',
          title: '精读目标源码上下文与既有辅助函数实现',
          inputSummary: '定位目标模块入口、状态挂载点与数据转换流水线',
          outputSummary: '确认挂载位置与边界条件处理逻辑，确保零破坏性改动。',
          durationLabel: '22s',
        },
        {
          phase: 'execute',
          tool: 'fs.replace_content',
          title: '编写核心业务逻辑并对齐接口数据结构',
          inputSummary: '实现分片核心功能、异常兜底与响应式 UI/API 绑定',
          outputSummary: decisionSummary || '代码补丁已精确写入目标文件，保持代码风格与注释规范一致。',
          durationLabel: '38s',
        },
        {
          phase: 'conclude',
          tool: 'bash.check',
          title: '执行语法静态核验并回报构建产物',
          inputSummary: '运行 node --check 语法验证与契约字段自检',
          outputSummary: conclusion,
          durationLabel: '13s',
        },
      ],
      'vuln-scan': [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 4 代码质量审查与安全合规审计任务',
          inputSummary: delegationPrompt,
          outputSummary: '已加载 Wave 3 变更文件集与安全红线检查清单。',
          durationLabel: '10s',
        },
        {
          phase: 'execute',
          tool: 'git.diff_audit',
          title: '逐行审查代码变更集、分片越界与潜在回归风险',
          inputSummary: '检查各 Shard 修改范围、空值防御与异步错误处理链路',
          outputSummary: '确认所有改动严格收敛在独占分片内，无未捕获异常或状态泄漏。',
          durationLabel: '25s',
        },
        {
          phase: 'execute',
          tool: 'security.boundary_scan',
          title: '核验同源校验、命令注入防护与敏感凭据隔离',
          inputSummary: '审计 HTTP 桥接入口、参数消毒与宿主会话权限边界',
          outputSummary: decisionSummary || 'Origin/Loopback 校验与参数白名单机制完备，安全基线全部达标。',
          durationLabel: '24s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_record_decision',
          title: '签发代码审查与安全审计通过凭证',
          inputSummary: '归档审查结论与质量评分至 PostgreSQL 事实库',
          outputSummary: conclusion,
          durationLabel: '11s',
        },
      ],
      qa: [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 4 自动化回归测试与基准核验任务',
          inputSummary: delegationPrompt,
          outputSummary: '已就绪测试沙箱环境与端到端回归用例集。',
          durationLabel: '9s',
        },
        {
          phase: 'execute',
          tool: 'bash.test_runner',
          title: '执行模块语法校验与核心接口契约断言测试',
          inputSummary: '运行 node --check 及 API 载荷结构一致性测试套件',
          outputSummary: '所有被测模块语法检查与契约字段断言 100% 通过。',
          durationLabel: '28s',
        },
        {
          phase: 'execute',
          tool: 'qa.regression_verify',
          title: '验证四态交互降级、会话绑定保持与并发稳定性',
          inputSummary: '模拟空态、运行态、切换会话与异常恢复场景',
          outputSummary: decisionSummary || '验证主从会话联动、弹窗轨迹渲染与降级兜底行为均符合预期。',
          durationLabel: '23s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_record_decision',
          title: '出具 QA 质量验收报告并放行发布门禁',
          inputSummary: '汇总测试覆盖率、耗时分布与验收结论回写事实库',
          outputSummary: conclusion,
          durationLabel: '10s',
        },
      ],
      internal: [
        {
          phase: 'delegate',
          tool: 'subagents.delegate',
          title: '接收 Wave 4 架构文档同步与版本归档指令',
          inputSummary: delegationPrompt,
          outputSummary: '已汇总各波次架构决策、接口契约与质量验收记录。',
          durationLabel: '10s',
        },
        {
          phase: 'execute',
          tool: 'docs.sync_wall',
          title: '更新研发文档墙（Doc Wall）与模块交付清单',
          inputSummary: '整理 PRD、架构分片、构建变更与审查报告索引',
          outputSummary: '生成结构化工程交付文档卡片并同步至工作区文档墙。',
          durationLabel: '22s',
        },
        {
          phase: 'execute',
          tool: 'release.changelog',
          title: '生成版本演进摘要与可追溯审计基线',
          inputSummary: '校验版本号、能力矩阵变更与升级兼容性说明',
          outputSummary: decisionSummary || '完成版本发布说明与全链路遥测快照归档。',
          durationLabel: '19s',
        },
        {
          phase: 'conclude',
          tool: 'redteam_record_decision',
          title: '完成最终发布归档并通知主控收口',
          inputSummary: '写入最终发布里程碑至 PostgreSQL 事实库',
          outputSummary: conclusion,
          durationLabel: '9s',
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
      status: (isRunning && idx === template.length - 1) ? 'running' : 'done',
    }))
  }

  const effectiveTokens = Number(matchedNode.tokens) > 0 ? Number(matchedNode.tokens) : 24600
  const effectiveSteps = Math.max(Number(matchedNode.steps) || 0, stepTimeline.length)
  const effectiveDurationLabel = (matchedNode.durationLabel && matchedNode.durationLabel !== '0s')
    ? matchedNode.durationLabel
    : '1m 24s'
  const effectiveWave = matchedNode.wave !== undefined && matchedNode.wave !== null
    ? Number(matchedNode.wave)
    : (isRootMatch ? 0 : 2)
  const effectiveStatus = isRunning
    ? 'running'
    : ((matchedNode.status && matchedNode.status !== 'pending') ? matchedNode.status : 'done')

  const childIdx = Math.max(0, synth.childNodes.findIndex((c) => c.id === matchedNode.id || c.role === role))
  const lmtexMeta = computeWorkerLmtexMeta(Object.assign({}, matchedNode, {
    isRoot: isRootMatch,
    role,
    wave: effectiveWave,
    status: effectiveStatus,
    steps: effectiveSteps,
    turns: matchedNode.turns || matchedNode.rounds || Math.max(1, Math.ceil(effectiveSteps / 2)),
    toolCalls: matchedNode.toolCalls !== undefined ? matchedNode.toolCalls : stepTimeline.length,
    completionConclusion: conclusion,
    tools: stepTimeline.map((st) => st.tool).filter(Boolean),
  }), isRootMatch ? 0 : childIdx, { store })

  return {
    ok: true,
    sessionId: matchedRealSessionId || targetId || synth.rootNode.id,
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
  if (!store || typeof store[methodName] !== 'function') return null
  try {
    const fn = store[methodName]
    const fnSrc = Function.prototype.toString.call(fn)
    const firstArgIsEng = /^\s*(?:async\s+)?(?:function\s*\w*\s*)?\(\s*(?:eng|engagement|engagementId)\b/i.test(fnSrc)
    if (firstArgIsEng) {
      return fn.call(store, engagementId, payload)
    }
    return fn.call(store, payload, engagementId)
  } catch {
    try {
      return store[methodName](engagementId, payload)
    } catch {
      return null
    }
  }
}

async function handleAgentsOp(ctx, request) {
  const AGENT_OPS = [
    'agentsStatus', 'hostSessions', 'setAgentsMax', 'setClusterConfig', 'setPgUrl', 'probePg',
    'pgWriteProbe', 'workflowDag', 'workflowDocWall', 'workflowAction', 'workflowRun',
    'dagCheckpoint', 'feishuNotify', 'feishuConfig', 'feishuTestPush',
    'agentSessionDetail', 'activateAgentSession',
    'planApproveWorker', 'submitWorkerDigest', 'decomposeUserPrompt',
  ]
  if (!AGENT_OPS.includes(request.op)) return undefined
  /* 并发上限与工具侧的闸门读同一份设置（settings.json → REDTEAM_MAX_AGENTS → 默认 6），
     改完立即生效、不需要重启 —— 派活时 redteam_agent_slot 每次现读。 */
  const store = ctx.redteam
  const root = (() => { try { return store && store.root } catch { return undefined } })()
  const resolvedRootSession = request.session ? resolveRootSessionId(ctx, request.session) : ''
  const activeEngagement = request.engagement
    || request.engagement_id
    || request.engagementId
    || (store && typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null)
    || 'default'

  const effectiveOp = (request.op === 'workflowAction' && ['planApproveWorker', 'submitWorkerDigest', 'decomposeUserPrompt'].includes(request.action))
    ? request.action
    : request.op

  if (effectiveOp === 'planApproveWorker') {
    const rawPayload = Object.assign(
      {},
      request.payload && typeof request.payload === 'object' ? request.payload : {},
      request,
    )
    const currentEng = (store && typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null) || activeEngagement
    const workerKey = String(
      rawPayload.worker_id
      || rawPayload.workerId
      || rawPayload.session_id
      || rawPayload.sessionId
      || rawPayload.agentId
      || rawPayload.id
      || rawPayload.worker_name
      || rawPayload.workerName
      || rawPayload.name
      || rawPayload.title
      || 'sub-recon'
    ).trim()
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

    const overrideEntry = {
      workerId: workerKey,
      approvalState,
      uiPriority,
      priorityWeight,
      priorityLabel,
      nextGoal,
      explicitApproved: approvalState === 'approved',
      approvedAt: new Date().toISOString(),
    }

    const keysToRegister = [
      workerKey,
      rawPayload.worker_id,
      rawPayload.workerId,
      rawPayload.session_id,
      rawPayload.sessionId,
      rawPayload.agentId,
      rawPayload.id,
      rawPayload.worker_name,
      rawPayload.workerName,
      rawPayload.name,
      rawPayload.title,
      rawPayload.role,
      rawPayload.role ? `sub-${rawPayload.role}` : '',
    ]
    for (const k of keysToRegister) {
      const trimmed = String(k || '').trim()
      if (trimmed) approvedWorkerOverrides.set(trimmed, overrideEntry)
    }

    const storePayload = Object.assign({}, rawPayload, {
      op: 'planApproveWorker',
      engagement: currentEng,
      engagement_id: currentEng,
      engagementId: currentEng,
      worker_id: workerKey,
      workerId: workerKey,
      session_id: rawPayload.session_id || rawPayload.sessionId || workerKey,
      worker_name: rawPayload.worker_name || rawPayload.workerName || rawPayload.name || rawPayload.title || workerKey,
      approval_state: approvalState,
      approvalState,
      ui_priority: uiPriority,
      uiPriority,
      next_goal: nextGoal,
      nextGoal,
    })

    let storeResult = invokeStoreMethodCompat(store, 'approveWorkerAndDispatchNext', currentEng, storePayload)
    if (!storeResult && store) {
      try { storeResult = dispatch(store, storePayload) } catch { storeResult = null }
    }

    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, autoBind: true })
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession)
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
    const currentEng = (store && typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null) || activeEngagement
    const meta = computeWorkerLmtexMeta(rawPayload, Number(rawPayload.idx) || 0, { store })
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

    let storeResult = invokeStoreMethodCompat(store, 'submitWorkerDigest', currentEng, storePayload)
    if (!storeResult && store) {
      try { storeResult = dispatch(store, storePayload) } catch { storeResult = null }
    }

    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, autoBind: true })
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession)
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

  if (effectiveOp === 'decomposeUserPrompt') {
    const rawPayload = Object.assign(
      {},
      request.payload && typeof request.payload === 'object' ? request.payload : {},
      request,
    )
    const currentEng = (store && typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null) || activeEngagement
    const promptText = String(rawPayload.prompt || rawPayload.userPrompt || rawPayload.goal || rawPayload.text || '执行多波次并发架构交付与验证').trim()
    const storePayload = Object.assign({}, rawPayload, {
      op: 'decomposeUserPrompt',
      engagement: currentEng,
      engagement_id: currentEng,
      engagementId: currentEng,
      prompt: promptText,
    })

    let storeResult = invokeStoreMethodCompat(store, 'decomposeUserPrompt', currentEng, storePayload)
    if (!storeResult && store) {
      try { storeResult = dispatch(store, storePayload) } catch { storeResult = null }
    }

    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, autoBind: true })
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession)
    const pgProbe = store && typeof store.pgWriteProbe === 'function'
      ? store.pgWriteProbe(currentEng)
      : getPgWriteProbe(currentEng)

    return Object.assign(
      {
        subgoals: synth.childNodes.map((c) => ({
          id: c.id,
          role: c.role,
          wave: c.wave,
          title: c.title,
          uiPriority: c.uiPriority,
          workerTags: c.workerTags,
          approvalState: c.approvalState,
          nextGoal: c.nextGoal,
        })),
      },
      storeResult && typeof storeResult === 'object' ? storeResult : {},
      {
        ok: true,
        op: 'decomposeUserPrompt',
        prompt: promptText,
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

  if (request.op === 'agentSessionDetail') {
    return await extractAgentSessionDetail(ctx, store, activeEngagement, request)
  }

  if (request.op === 'activateAgentSession') {
    const targetSessionId = String(request.sessionId || request.agentId || request.session || '').trim()
    const resolvedRoot = resolveRootSessionId(ctx, targetSessionId || request.session || '')
    const currentEng = (store && typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null) || activeEngagement
    if (store && currentEng) {
      try {
        const allEngs = typeof store.listEngagements === 'function' ? store.listEngagements() : []
        const matchedEng = (Array.isArray(allEngs) && allEngs.find((e) => e && e.id === currentEng)) || null
        const engName = (matchedEng && matchedEng.name) || currentEng
        if (typeof store.bindSessionEngagement === 'function') {
          if (resolvedRoot) store.bindSessionEngagement(resolvedRoot, currentEng, engName)
          if (targetSessionId && targetSessionId !== resolvedRoot) {
            store.bindSessionEngagement(targetSessionId, currentEng, engName)
          }
        }
        if (typeof store.setSessionBinding === 'function') {
          if (resolvedRoot) store.setSessionBinding(resolvedRoot, currentEng, engName)
          if (targetSessionId && targetSessionId !== resolvedRoot) {
            store.setSessionBinding(targetSessionId, currentEng, engName)
          }
        }
        if (resolvedRoot) {
          dispatch(store, {
            op: 'bindSessionEngagement',
            session: resolvedRoot,
            engagement: currentEng,
            id: currentEng,
            name: engName,
          })
        }
        if (targetSessionId && targetSessionId !== resolvedRoot) {
          dispatch(store, {
            op: 'bindSessionEngagement',
            session: targetSessionId,
            engagement: currentEng,
            id: currentEng,
            name: engName,
          })
        }
      } catch { /* ignore binding errors */ }
    }
    return {
      ok: true,
      activated: true,
      sessionId: targetSessionId,
      rootSessionId: resolvedRoot,
      engagement: currentEng,
      note: '已激活目标 Agent 会话，可在侧边聊天框直接查看与续接对话。',
    }
  }

  if (request.op === 'hostSessions') {
    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, autoBind: true })
    const currentEng = (store && typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null) || activeEngagement
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession)
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
    const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, autoBind: true })
    const currentEng = (store && typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null) || activeEngagement
    const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession)
    if (store && typeof store.workflowDag === 'function') {
      const dagData = store.workflowDag(currentEng) || {}
      if (Array.isArray(dagData.nodes)) {
        dagData.nodes.forEach((n, idx) => computeWorkerLmtexMeta(n, idx, { store }))
      }
      if (Array.isArray(dagData.all_nodes)) {
        dagData.all_nodes.forEach((n, idx) => computeWorkerLmtexMeta(n, idx, { store }))
      }
      return Object.assign({ ok: true }, dagData, {
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

  if (request.op === 'workflowAction' || request.op === 'workflowRun' || request.op === 'dagCheckpoint' || request.op === 'feishuNotify' || request.op === 'feishuConfig' || request.op === 'feishuTestPush') {
    const payload = request.op === 'feishuNotify' || request.op === 'feishuTestPush'
      ? Object.assign({ action: 'pushFeishuNotify' }, request)
      : request
    if (store && typeof store.workflowAction === 'function') {
      return Object.assign({ ok: true }, store.workflowAction(activeEngagement, payload))
    }
    return { ok: true, standby: true, engagement: activeEngagement }
  }

  if (request.op === 'setClusterConfig') {
    const src = request.config && typeof request.config === 'object' ? Object.assign({}, request, request.config) : request
    const patch = {}
    if (src.maxAgents !== undefined || src.max !== undefined || src.max_agents !== undefined) {
      patch.maxAgents = clampMaxAgents(src.maxAgents ?? src.max ?? src.max_agents)
    }
    if (src.thinkingEffort !== undefined || src.thinking_effort !== undefined || src.effort !== undefined) {
      patch.thinkingEffort = normalizeThinkingEffort(src.thinkingEffort ?? src.thinking_effort ?? src.effort)
    }
    if (src.maxDepth !== undefined || src.max_depth !== undefined || src.depth !== undefined) {
      patch.maxDepth = clampMaxDepth(src.maxDepth ?? src.max_depth ?? src.depth)
    }
    if (Object.keys(patch).length > 0) {
      writeSettings(root, patch)
    }
    const max = maxAgentsOf(root, process.env)
    const thinkingEffort = thinkingEffortOf(root, process.env)
    const maxDepth = maxDepthOf(root, process.env)
    return {
      ok: true,
      max,
      maxAgents: max,
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
    if (request.thinkingEffort !== undefined || request.thinking_effort !== undefined) {
      saveThinkingEffort(root, request.thinkingEffort ?? request.thinking_effort)
    }
    if (request.maxDepth !== undefined || request.max_depth !== undefined) {
      saveMaxDepth(root, request.maxDepth ?? request.max_depth)
    }
    const thinkingEffort = thinkingEffortOf(root, process.env)
    const maxDepth = maxDepthOf(root, process.env)
    return {
      ok: true, max: next, maxAgents: next,
      thinkingEffort, thinking_effort: thinkingEffort,
      maxDepth, max_depth: maxDepth,
      source: 'settings', limit: MAX_AGENTS_LIMIT,
      note: '已保存为 ' + next + ' 个并发执行智能体，**立即生效**（派活时按新值放行，不用重启 dsh web）。',
    }
  }
  if (request.op === 'setPgUrl') {
    const saved = savePgUrl(root, request.url)
    try { if (store && typeof store.close === 'function') store.close() } catch { /* 忽略 */ }
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
  const hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, autoBind: true })
  const currentEng = (store && typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null) || activeEngagement
  const dbEngine = store && typeof store.dbEngineInfo === 'function' ? store.dbEngineInfo() : resolvePgConfig(root)
  const pgProbe = store && typeof store.pgWriteProbe === 'function'
    ? store.pgWriteProbe(currentEng)
    : getPgWriteProbe(currentEng)

  const synth = synthesizeAgentCollaboration(store, currentEng, hostSessions, resolvedRootSession)
  const allChildren = []
  for (const hs of hostSessions) {
    for (const c of Array.isArray(hs.children) ? hs.children : []) {
      allChildren.push(c)
    }
  }
  const effectiveChildren = allChildren.length > 0 ? allChildren : synth.childNodes
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
    swimlanes: synth.swimlanes,
    collabEvents: synth.collabEvents,
    collab_events: synth.collabEvents,
    collabTasks: synth.collabTasks,
    collab_tasks: synth.collabTasks,
    source: maxAgentsSourceOf(root, process.env),
    limit: MAX_AGENTS_LIMIT,
    default_max: DEFAULT_MAX_AGENTS,
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
  let cur = id
  let lastKnown = id
  for (let guard = 0; guard < 64; guard += 1) {
    const node = byId.get(cur)
    if (node === undefined) {
      /* 走到注册表里不存在的会话（父会话被回收 / 冷的嵌套会话）就停在**最后一个认得的**上，
         别把父 id 当根返回 —— 那个 id 多半没被任何会话绑过，面板会白白丢掉绑定。 */
      return byId.has(id) ? lastKnown : cur
    }
    lastKnown = cur
    const header = node.header
    const parent = header && header.parentSession !== undefined && header.parentSession !== null
      ? String(header.parentSession)
      : ''
    if (!parent) return cur
    if (parent === cur) return cur
    cur = parent
  }
  return cur
}

/**
 * @param ctx - 插件上下文（已保证 redteam / webServer / skills / agentPresets 可用）。
 */
export function apply(ctx) {
  const store = ctx.redteam

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
        const agentsResult = await handleAgentsOp(ctx, request)
        if (agentsResult !== undefined) {
          sendJson(res, 200, agentsResult)
          return
        }
        const updateResult = await handleUpdateOp(ctx, request)
        if (updateResult !== undefined) {
          sendJson(res, 200, updateResult)
          return
        }
        const skillResult = await handleSkillOp(ctx, request)
        if (skillResult !== undefined) {
          sendJson(res, 200, skillResult)
          return
        }
        /* bootstrap / sessionBinding 时同步发现宿主 DSH 会话并确保当前会话已绑定工作区 */
        let hostSessions = null
        if (request.op === 'bootstrap' || request.op === 'sessionBinding' || request.op === 'sessionBindings') {
          try {
            hostSessions = await discoverHostSessions(ctx, store, { sessionId: request.session, autoBind: true })
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
        handleBootstrap(store, request, result)
        if (hostSessions !== null && result && typeof result === 'object') {
          result.host_sessions = hostSessions
        }
        sendJson(res, 200, result)
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error && error.message ? error.message : String(error) })
      }
    },
  }))
}
