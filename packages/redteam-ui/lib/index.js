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

  return {
    id: sid,
    parentId,
    parent: parentId,
    rawTitle,
    title,
    label,
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
    durationMs,
    durationLabel,
    promptPreview: previews.promptPreview,
    latestOutputPreview: previews.latestOutputPreview,
    outputPreview: previews.latestOutputPreview,
    createdAt: startMs > 0 ? new Date(startMs).toISOString() : (wfNode && wfNode.updated_at) || null,
    updatedAt: endMs > 0 ? new Date(endMs).toISOString() : (wfNode && wfNode.updated_at) || null,
  }
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
      })
      kids.push(childTelemetry)
    }

    kids.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))

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
              }))
            }
            item.children.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))
            item.running_children = item.children.filter((c) => c.activity === 'running').length
          }
        } catch { /* ignore */ }
      }
    } catch { /* 自动绑定异常不影响会话发现 */ }
  }

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
      if (filtered.length > 0) return filtered
    }
  }

  return items
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
    }, { isRoot: true, parentId: null, workflowNode: planWfNode })

  const childNodes = Array.isArray(primaryHost && primaryHost.children)
    ? primaryHost.children.map((c) => Object.assign({}, c, { parentId: rootNode.id, parent: rootNode.id }))
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
    })
    childNodes.push(synthChild)
    existingRoles.add(role)
  }

  childNodes.sort((a, b) => (a.wave - b.wave) || String(a.id).localeCompare(String(b.id)))

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
  rootNode.children = childNodes
  rootNode.running_children = childNodes.filter((c) => c.activity === 'running').length

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
          label: `完成回报 ${child.title || child.label}`,
          at: child.updatedAt || new Date().toISOString(),
        })
      }
    }
  }

  /* 生成泳道列表（swimlanes）：[rootLane, ...childLanes] */
  const buildLane = (node, isRootLane = false) => {
    const laneEvents = collabEvents.filter((e) => e.fromId === node.id || e.toId === node.id || e.childId === node.id)
    return {
      id: node.id,
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
      durationMs: node.durationMs,
      durationLabel: node.durationLabel,
      taskCount: isRootLane ? Math.max(1, childNodes.length) : 1,
      eventCount: isRootLane ? collabEvents.length : laneEvents.length,
      color: node.color,
    }
  }
  const swimlanes = [buildLane(rootNode, true), ...childNodes.map((c) => buildLane(c, false))]

  /* 生成协作任务卡片列表（collabTasks）：供 p4 右下「协作任务」与 p5 树图画布使用 */
  const collabTasks = childNodes.map((child) => ({
    id: child.id,
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
    color: child.color,
  }))

  const runningCount = (rootNode.activity === 'running' ? 1 : 0)
    + childNodes.filter((c) => c.activity === 'running').length
  const totalContextTokens = (Number(rootNode.contextTokens || rootNode.tokens || 0))
    + childNodes.reduce((sum, c) => sum + Number(c.contextTokens || c.tokens || 0), 0)

  const agentNetwork = {
    root: rootNode,
    children: childNodes,
    totalAgents: 1 + childNodes.length,
    runningCount,
    totalContextTokens,
    teamTasksCount: childNodes.length,
  }

  return {
    agentNetwork,
    swimlanes,
    collabEvents,
    collabTasks,
    rootNode,
    childNodes,
  }
}

async function handleAgentsOp(ctx, request) {
  const AGENT_OPS = [
    'agentsStatus', 'hostSessions', 'setAgentsMax', 'setClusterConfig', 'setPgUrl', 'probePg',
    'pgWriteProbe', 'workflowDag', 'workflowDocWall', 'workflowAction', 'workflowRun',
    'dagCheckpoint', 'feishuNotify', 'feishuConfig', 'feishuTestPush',
  ]
  if (!AGENT_OPS.includes(request.op)) return undefined
  /* 并发上限与工具侧的闸门读同一份设置（settings.json → REDTEAM_MAX_AGENTS → 默认 6），
     改完立即生效、不需要重启 —— 派活时 redteam_agent_slot 每次现读。 */
  const store = ctx.redteam
  const root = (() => { try { return store && store.root } catch { return undefined } })()
  const resolvedRootSession = request.session ? resolveRootSessionId(ctx, request.session) : ''
  const activeEngagement = request.engagement
    || (store && typeof store.activeEngagementId === 'function' ? store.activeEngagementId() : null)
    || 'default'

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
      return Object.assign({ ok: true }, store.workflowDag(currentEng), {
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
      nodes: [],
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
