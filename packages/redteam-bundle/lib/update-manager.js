/**
 * LMTAgent Host Bridge — 插件版本检测、更新预检与自包含节点重启子系统（零外部依赖）
 *
 * 从 lib/index.js 拆出：`run` / `pluginIdentity` / `profileDirOf` / `readProfilePackage` /
 * `packageManagerOf` / `updatePreflight` / `checkLatest` / `versionLess` / `restartScript` /
 * `applyUpdate` / `ensureProfileBundle` / `handleUpdateOp`。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PACKAGE_NAME = 'dsh-lmtagent'

/** 运行命令，带超时；返回 `{ code, stdout, stderr, timedOut }`。 */
export function run(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    let child
    try {
      /* env 必须显式传 process.env，cwd 必须是真实存在目录，防止 spawn 报误导性 ENOENT */
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
      done({ code: -1, stdout, stderr, timedOut: true })
    }, Math.max(Number(options.timeoutMs) || 30000, 1000))
    child.stdout.on('data', (c) => { stdout += c.toString('utf8') })
    child.stderr.on('data', (c) => { stderr += c.toString('utf8') })
    child.on('error', (error) => { clearTimeout(timer); done({ code: -1, stdout, stderr: String((error && error.message) || error) }) })
    child.on('close', (code) => { clearTimeout(timer); done({ code: code === null ? -1 : code, stdout, stderr }) })
  })
}

/** 本插件包身份（由 store 壳读取 package.json 后挂上；读不到时默认包名回退 `'dsh-lmtagent'`）。 */
export function pluginIdentity(ctx) {
  const store = (ctx && (ctx.lmtagent || ctx.redteam)) || null
  const info = store && store.plugin ? store.plugin : null
  return {
    name: (info && info.name) || DEFAULT_PACKAGE_NAME,
    version: (info && info.version) || null,
    description: (info && info.description) || 'LMTAgent · 多智能体软件工程研发与架构交付控制台',
    homepage: (info && info.homepage) || 'https://github.com/ECCVIK/LMTAgent',
  }
}

/** profile 目录：兼容路径字符串与 `file://` URL。 */
export function profileDirOf(ctx) {
  try {
    const base = ctx && ctx.baseUrl
    if (typeof base === 'string' && base.length > 0) {
      return base.startsWith('file:') ? fileURLToPath(base) : base
    }
  } catch { /* 忽略 */ }
  const home = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh')
  return join(home, 'profiles', 'web')
}

/** 读 profile 的 package.json（依赖声明 + dsh.profile.bundles）。 */
export function readProfilePackage(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch { return null }
}

/** 包管理器：profile 里有 pnpm-lock / pnpm-workspace 就用 pnpm，否则 npm。 */
export function packageManagerOf(dir) {
  if (existsSync(join(dir, 'pnpm-lock.yaml')) || existsSync(join(dir, 'pnpm-workspace.yaml'))) return 'pnpm'
  return 'npm'
}

/**
 * 更新前置检查：装的是不是发布版（profile 里能不能解析到这个包名）、
 * 有没有智能体正在跑（更新要重启 dsh web，会把它们打断）。
 */
export async function updatePreflight(ctx) {
  const dir = profileDirOf(ctx)
  const pkg = pluginIdentity(ctx)
  const profilePkg = readProfilePackage(dir)
  const deps = (profilePkg && profilePkg.dependencies) || {}
  const declared = typeof deps[pkg.name] === 'string' ? deps[pkg.name] : null
  const installedDir = join(dir, 'node_modules', pkg.name)
  const blockers = []
  const notes = []

  const installedInNodeModules = existsSync(join(installedDir, 'package.json'))
  const sourceInstall = declared === null && !installedInNodeModules
  if (sourceInstall) {
    notes.push('当前是**本地源码安装**（profile 依赖里没有 ' + pkg.name + '）：点击更新会把发布版'
      + '装进 profile 的 node_modules，本地源码改动不再生效；装完这次以后就能正常用一键更新。')
  }

  let running = []
  try {
    const subagents = ctx && typeof ctx.get === 'function' ? ctx.get('subagents') : null
    const sessions = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null
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
export async function checkLatest(ctx, dir, name = DEFAULT_PACKAGE_NAME) {
  const pkgName = name || DEFAULT_PACKAGE_NAME
  const pm = packageManagerOf(dir)
  const args = ['view', pkgName, 'version', '--json']
  const r = await run(pm, args, { cwd: dir, timeoutMs: 60000 })
  if (r.code !== 0) {
    return { ok: false, error: '查询最新版本失败（' + pm + ' view）：' + String(r.stderr || r.stdout || '').trim().slice(0, 400) }
  }
  const raw = String(r.stdout || '').trim().replace(/^"|"$/g, '')
  const latest = raw.split('\n').map((x) => x.trim().replace(/^"|"$/g, '')).filter(Boolean).pop() || null
  return { ok: latest !== null, latest, registry: pm }
}

/** `a < b`（只比较数字段；预发布后缀按"更旧"处理）。 */
export function versionLess(a, b) {
  const parse = (v) => String(v || '').split('-')[0].split('.').map((x) => Number(x) || 0)
  const [x, y] = [parse(a), parse(b)]
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] || 0) < (y[i] || 0)) return true
    if ((x[i] || 0) > (y[i] || 0)) return false
  }
  return false
}

/**
 * 重启脚本：等旧进程退出 + 端口释放，再按同样的参数把 dsh web 拉起来（以 argv 数组交给 spawn，无 shell 注入面）。
 */
export function restartScript(pid, port, command, args, logPath, cwd) {
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
    '/* 由 LMTAgent 控制台的「自动更新」生成：等旧 dsh web 退出后，按原 argv 把它重新拉起。',
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
    'const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return false } }',
    '',
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

/**
 * 把包名登记进 profile 的 `dsh.profile.bundles`（缺了重启后插件不会被加载）。
 * @returns `'present'` / `'added'` / `'failed'`
 */
export function ensureProfileBundle(dir, name = DEFAULT_PACKAGE_NAME) {
  const pkgName = name || DEFAULT_PACKAGE_NAME
  try {
    const path = join(dir, 'package.json')
    const pkg = JSON.parse(readFileSync(path, 'utf8'))
    const profile = pkg && pkg.dsh && pkg.dsh.profile ? pkg.dsh.profile : null
    if (profile === null || typeof profile !== 'object') return 'failed'
    const bundles = Array.isArray(profile.bundles) ? profile.bundles : []
    if (bundles.includes(pkgName)) return 'present'
    profile.bundles = bundles.concat([pkgName])
    writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    return 'added'
  } catch { return 'failed' }
}

/** 应用更新：装新版本 + 生成重启脚本 + 让当前进程退出。 */
export async function applyUpdate(ctx, dir, name = DEFAULT_PACKAGE_NAME, targetVersion = null) {
  const pkgName = name || DEFAULT_PACKAGE_NAME
  const primary = packageManagerOf(dir)
  const spec = targetVersion ? pkgName + '@' + targetVersion : pkgName
  const attempt = async (pm) => {
    const args = pm === 'pnpm' ? ['add', spec] : ['install', spec, '--save']
    const r = await run(pm, args, { cwd: dir, timeoutMs: 300000 })
    return { pm, args, r }
  }
  let { pm, args, r } = await attempt(primary)
  if (r.code !== 0) {
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
  const bundleState = ensureProfileBundle(dir, pkgName)
  const argv = process.argv.slice()
  const command = argv[0]
  const rest = argv.slice(1)
  const port = (() => {
    try { return String(ctx.webServer.port) } catch { return '3080' }
  })()
  const store = (ctx && (ctx.lmtagent || ctx.redteam)) || null
  const root = (() => {
    try { return store.root } catch { return join(process.env.DSH_HOME || '.', 'lmtagent') }
  })()
  mkdirSync(root, { recursive: true })
  const logPath = join(root, 'update.log')
  const scriptPath = join(root, 'restart-dsh-web.sh')
  writeFileSync(scriptPath, restartScript(process.pid, port, command, rest, logPath, process.cwd()), { encoding: 'utf8', mode: 0o755 })
  const child = spawn(process.execPath, [scriptPath], { detached: true, stdio: 'ignore' })
  child.unref()
  setTimeout(() => { process.exit(0) }, 1200).unref()
  return {
    ok: true, installed: spec, packageManager: pm, bundleRegistered: bundleState,
    restart: { script: scriptPath, log: logPath, port, command: [command].concat(rest).join(' '), pid: process.pid },
  }
}

/**
 * 版本与更新类 RPC op（`version` / `updateCheck` / `updateApply`）。
 */
export async function handleUpdateOp(ctx, request, hostBuildVersion = '0.0.0') {
  if (!['version', 'updateCheck', 'updateApply'].includes(request.op)) return undefined
  const pkg = pluginIdentity(ctx)
  const pre = await updatePreflight(ctx)
  if (request.op === 'version') {
    const check = await checkLatest(ctx, pre.dir, pkg.name)
    return {
      ok: true,
      hostVersion: hostBuildVersion,
      plugin: pkg,
      install: {
        mode: pre.sourceInstall ? 'source' : 'package',
        dir: pre.dir,
        declared: pre.declared,
        packageManager: pre.packageManager,
      },
      latest: check && check.ok ? check.latest : null,
      updateAvailable: check && check.ok && pkg.version ? versionLess(pkg.version, check.latest) : false,
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
  if (pre.blockers.length > 0) {
    return { ok: false, error: '现在不能更新：' + pre.blockers.join(' '), blockers: pre.blockers, notes: pre.notes }
  }
  const rawTarget = typeof request.target === 'string' ? request.target.trim() : ''
  if (rawTarget !== '' && !/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(rawTarget)) {
    return {
      ok: false,
      current: pkg.version,
      error: 'updateApply 的 target 必须是纯版本号（如 1.0.0），收到 ' + JSON.stringify(rawTarget)
        + '。不接受包名、路径、URL 或 npm 参数 —— 它会原样传给包管理器，等于允许远程指定安装内容。',
    }
  }
  const result = await applyUpdate(ctx, pre.dir, pkg.name, rawTarget || null)
  if (result.ok !== true) return Object.assign({ current: pkg.version }, result)
  return Object.assign({ current: pkg.version, latest: request.target || null }, result, {
    note: '已安装，正在重启 dsh web（页面会在几秒内断开，重启完成后刷新即可看到新版本）。重启日志：' + result.restart.log,
  })
}
