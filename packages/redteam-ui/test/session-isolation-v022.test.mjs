/**
 * LMTAgent v0.22.0 — Backend Session 1:1 Isolation State Machine & Stale Lease Reaper Test Suite
 *
 * Run:
 *   node --test packages/redteam-ui/test/session-isolation-v022.test.mjs
 *
 * Zero external dependencies (uses built-in node:test, node:assert/strict, node:fs, node:events).
 */

import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'

import * as coreMod from '../../redteam-store/lib/core.js'
import { apply } from '../lib/index.js'

const tempDirs = []
const activeHosts = []

function makeTempDir(prefix = 'lmtagent-v022-iso-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createStoreInstance(rootDir) {
  mkdirSync(rootDir, { recursive: true })
  if (typeof coreMod.createStore === 'function') {
    const s = coreMod.createStore(rootDir)
    if (s && s.root) return s
  }
  return new coreMod.RedteamStore(rootDir)
}

function createMockPluginHost({ store, getSessions = () => [], getSubagents = () => [] }) {
  const routes = new Map()
  const disposers = []
  const bus = new EventEmitter()

  const services = {
    sessions: {
      list: () => getSessions(),
    },
    subagents: {
      list: () => getSubagents(),
    },
    tokenMeter: null,
  }

  const ctx = {
    redteam: store,
    skills: { list: () => [], get: async () => undefined },
    agentPresets: { standingKeyFor: async () => 'scope-v022-test' },
    get(name) {
      return services[name] ?? null
    },
    on(evt, fn) {
      bus.on(evt, fn)
      return () => bus.off(evt, fn)
    },
    emit(evt, payload) {
      bus.emit(evt, payload)
    },
    effect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') disposers.push(cleanup)
    },
    webServer: {
      register(spec) {
        routes.set(spec.path, spec.handler)
        return () => routes.delete(spec.path)
      },
    },
  }

  apply(ctx)

  async function callApi(payload, opts = {}) {
    const handler = routes.get('/redteam/api')
    const rawBody = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const req = new EventEmitter()
    req.method = opts.method || 'POST'
    req.headers = Object.assign(
      { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787' },
      opts.headers || {},
    )
    req.socket = { remoteAddress: '127.0.0.1' }

    let resStatus = 200
    let resHeaders = {}
    const chunks = []
    const res = new EventEmitter()
    res.writableEnded = false
    res.writeHead = (st, hdrs = {}) => {
      resStatus = st
      resHeaders = Object.assign({}, resHeaders, hdrs)
    }
    res.setHeader = (k, v) => { resHeaders[k] = v }
    res.write = (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))
      return true
    }
    res.end = (chunk) => {
      if (chunk !== undefined) res.write(chunk)
      res.writableEnded = true
      res.emit('close')
    }

    const done = handler(req, res)
    queueMicrotask(() => {
      if (rawBody.length > 0) req.emit('data', Buffer.from(rawBody, 'utf8'))
      req.emit('end')
    })
    await done

    const text = Buffer.concat(chunks).toString('utf8')
    let json = null
    try { json = JSON.parse(text) } catch { json = null }
    return { status: resStatus, headers: resHeaders, text, json }
  }

  function disposeAll() {
    while (disposers.length > 0) {
      const fn = disposers.pop()
      try { fn() } catch { /* ignore */ }
    }
  }

  const host = { ctx, routes, callApi, disposeAll }
  activeHosts.push(host)
  return host
}

after(() => {
  while (activeHosts.length > 0) {
    const h = activeHosts.pop()
    try { h.disposeAll() } catch { /* ignore */ }
  }
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

describe('LMTAgent v0.22.0 — Backend Session 1:1 Isolation & Stale Lease Reaper', () => {
  it('1. Opening a second DSH session keeps bound: null, init_state: uninitialized, current: null with zero cross-session hijack', async () => {
    const wsDir = makeTempDir('v022-hijack-')
    const storeRoot = join(wsDir, 'redteam')
    const store = createStoreInstance(storeRoot)

    const opened = store.openEngagement('轻记 微信小程序', ['app.qingji.local'])
    const qingjiId = opened.id
    assert.ok(qingjiId, 'created primary engagement id')
    store.setSessionBinding('sess-qingji-root', qingjiId, '轻记 微信小程序', {
      title: '轻记 微信小程序研发',
      cwd: '/workspace/qingji-miniapp',
      hasConversation: true,
    })
    // Seed a bogus deleted UUID binding on a third session to ensure it cleans up to unbound rather than hijacking
    store.setSessionBinding('sess-stale-deleted', '00000000-0000-4000-8000-deadbeef0001', '已删除旧工程')

    const nowIso = new Date().toISOString()
    const hostSessionsList = [
      {
        id: 'sess-qingji-root',
        title: '轻记 微信小程序研发',
        cwd: '/workspace/qingji-miniapp',
        status: 'idle',
        turns: 4,
        steps: 8,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: 'sess-qingji-worker-1',
        parentSessionId: 'sess-qingji-root',
        title: '轻记架构师子代理',
        cwd: '/workspace/qingji-miniapp',
        status: 'idle',
        turns: 2,
        steps: 3,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: 'sess-exa-purple',
        title: 'exa 下载紫色晶石官包',
        cwd: '/workspace/exa-purple-pkg',
        status: 'idle',
        turns: 1,
        steps: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: 'sess-exa-worker-1',
        parentSessionId: 'sess-exa-purple',
        title: 'exa 检索子任务',
        cwd: '/workspace/exa-purple-pkg',
        status: 'idle',
        turns: 1,
        steps: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: 'sess-stale-deleted',
        title: '历史失效工程会话',
        cwd: '/workspace/legacy-dir',
        status: 'idle',
        turns: 0,
        steps: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]

    const host = createMockPluginHost({
      store,
      getSessions: () => hostSessionsList,
    })

    // Bootstrap for the second session ('exa 下载紫色晶石官包')
    const bootRes = await host.callApi({ op: 'bootstrap', session: 'sess-exa-purple', force: true })
    assert.equal(bootRes.status, 200)
    assert.equal(bootRes.json.ok, true)
    assert.equal(bootRes.json.current, null, 'bootstrap current MUST be null for unbound session')
    assert.ok(bootRes.json.session_binding, 'bootstrap includes session_binding')
    assert.equal(bootRes.json.session_binding.bound, null, 'session_binding.bound MUST be null')
    assert.equal(bootRes.json.session_binding.init_state, 'uninitialized')
    assert.equal(bootRes.json.session_binding.onboarding_dismissed, false)
    assert.equal(bootRes.json.session_binding.cwd, '/workspace/exa-purple-pkg')

    // sessionBinding op for the second session
    const bindRes = await host.callApi({ op: 'sessionBinding', session: 'sess-exa-purple', force: true })
    assert.equal(bindRes.status, 200)
    assert.equal(bindRes.json.ok, true)
    assert.equal(bindRes.json.bound, null, 'sessionBinding bound MUST remain null')
    assert.equal(bindRes.json.name, null)
    assert.equal(bindRes.json.init_state, 'uninitialized')
    assert.equal(bindRes.json.onboarding_dismissed, false)
    assert.equal(bindRes.json.session_title, 'exa 下载紫色晶石官包')
    assert.equal(bindRes.json.cwd, '/workspace/exa-purple-pkg')

    // Verify host_sessions items preserve strict 1:1 bindings without cross-session hijack
    const exaHostItem = bindRes.json.host_sessions.find((s) => s.id === 'sess-exa-purple')
    const qingjiHostItem = bindRes.json.host_sessions.find((s) => s.id === 'sess-qingji-root')
    const deletedHostItem = bindRes.json.host_sessions.find((s) => s.id === 'sess-stale-deleted')

    assert.ok(exaHostItem, 'found sess-exa-purple in host_sessions')
    assert.equal(exaHostItem.engagementId, null)
    assert.equal(exaHostItem.initState, 'uninitialized')
    assert.equal(exaHostItem.onboardingDismissed, false)
    assert.equal(exaHostItem.cwd, '/workspace/exa-purple-pkg')

    assert.ok(qingjiHostItem, 'found sess-qingji-root in host_sessions')
    assert.equal(qingjiHostItem.engagementId, qingjiId)
    assert.equal(qingjiHostItem.initState, 'initialized')
    assert.equal(qingjiHostItem.onboardingDismissed, true)

    assert.ok(deletedHostItem, 'found sess-stale-deleted in host_sessions')
    assert.equal(deletedHostItem.engagementId, null, 'bogus deleted engagement binding cleaned up to null')
    assert.equal(deletedHostItem.initState, 'uninitialized')

    // Verify child subagent sessions resolve to their respective root sessions' bindings
    const qingjiChildBind = await host.callApi({ op: 'sessionBinding', session: 'sess-qingji-worker-1' })
    assert.equal(qingjiChildBind.json.root_session, 'sess-qingji-root')
    assert.equal(qingjiChildBind.json.bound, qingjiId)

    const exaChildBind = await host.callApi({ op: 'sessionBinding', session: 'sess-exa-worker-1' })
    assert.equal(exaChildBind.json.root_session, 'sess-exa-purple')
    assert.equal(exaChildBind.json.bound, null)

    // Verify bootstrap for bound session still returns its bound engagement
    const qingjiBoot = await host.callApi({ op: 'bootstrap', session: 'sess-qingji-root' })
    assert.equal(qingjiBoot.json.current, qingjiId)
    assert.equal(qingjiBoot.json.session_binding.bound, qingjiId)
    assert.equal(qingjiBoot.json.session_binding.init_state, 'initialized')

    // Verify legacy bootstrap with NO session still falls back to global active engagement
    const globalBoot = await host.callApi({ op: 'bootstrap' })
    assert.equal(globalBoot.json.current, qingjiId)
  })

  it('2. sessionOnboarding state transitions (skip -> reopen -> openEngagement auto-bind -> unbind)', async () => {
    const wsDir = makeTempDir('v022-onboard-')
    const storeRoot = join(wsDir, 'redteam')
    const store = createStoreInstance(storeRoot)

    const qingji = store.openEngagement('轻记 微信小程序')
    store.setSessionBinding('sess-qingji-root', qingji.id, '轻记 微信小程序')

    const nowIso = new Date().toISOString()
    const host = createMockPluginHost({
      store,
      getSessions: () => [
        {
          id: 'sess-qingji-root',
          title: '轻记 微信小程序',
          cwd: '/workspace/qingji',
          status: 'idle',
          turns: 3,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        {
          id: 'sess-exa-purple',
          title: 'exa 下载紫色晶石官包',
          cwd: '/workspace/exa-purple',
          status: 'idle',
          turns: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
    })

    // Step A: skip onboarding on sess-exa-purple
    const skipRes = await host.callApi({
      op: 'sessionOnboarding',
      session: 'sess-exa-purple',
      action: 'skip',
      title: 'exa 下载紫色晶石官包',
      cwd: '/workspace/exa-purple',
      hasConversation: true,
    })
    assert.equal(skipRes.status, 200)
    assert.equal(skipRes.json.ok, true)
    assert.equal(skipRes.json.bound, null)
    assert.equal(skipRes.json.init_state, 'skipped')
    assert.equal(skipRes.json.onboarding_dismissed, true)

    const afterSkipBoot = await host.callApi({ op: 'bootstrap', session: 'sess-exa-purple', force: true })
    assert.equal(afterSkipBoot.json.current, null)
    assert.equal(afterSkipBoot.json.session_binding.init_state, 'skipped')
    assert.equal(afterSkipBoot.json.session_binding.onboarding_dismissed, true)

    // Step B: reopen onboarding modal on sess-exa-purple
    const reopenRes = await host.callApi({
      op: 'sessionOnboarding',
      session: 'sess-exa-purple',
      action: 'reopen',
    })
    assert.equal(reopenRes.status, 200)
    assert.equal(reopenRes.json.ok, true)
    assert.equal(reopenRes.json.bound, null)
    assert.equal(reopenRes.json.init_state, 'uninitialized')
    assert.equal(reopenRes.json.onboarding_dismissed, false)

    // Step C: openEngagement with session auto-binds sess-exa-purple and marks initialized
    const openExaRes = await host.callApi({
      op: 'openEngagement',
      name: '紫色晶石官包工程',
      scope: ['pkg.purple-crystal.local'],
      session: 'sess-exa-purple',
    })
    assert.equal(openExaRes.status, 200)
    assert.equal(openExaRes.json.ok, true)
    const exaEngId = openExaRes.json.engagement?.id
    assert.ok(exaEngId && exaEngId !== qingji.id, 'created distinct engagement for second session')
    assert.equal(openExaRes.json.bound, exaEngId)
    assert.equal(openExaRes.json.session_binding.bound, exaEngId)
    assert.equal(openExaRes.json.session_binding.init_state, 'initialized')
    assert.equal(openExaRes.json.session_binding.onboarding_dismissed, true)

    // Verify both sessions remain independently bound to their own engagements
    const exaBoot = await host.callApi({ op: 'bootstrap', session: 'sess-exa-purple', force: true })
    assert.equal(exaBoot.json.current, exaEngId)
    assert.equal(exaBoot.json.session_binding.bound, exaEngId)
    assert.equal(exaBoot.json.session_binding.init_state, 'initialized')

    const qingjiBoot = await host.callApi({ op: 'bootstrap', session: 'sess-qingji-root' })
    assert.equal(qingjiBoot.json.current, qingji.id)
    assert.equal(qingjiBoot.json.session_binding.bound, qingji.id)

    // Step D: unbind resets sess-exa-purple cleanly back to uninitialized
    const unbindRes = await host.callApi({
      op: 'sessionOnboarding',
      session: 'sess-exa-purple',
      action: 'unbind',
    })
    assert.equal(unbindRes.status, 200)
    assert.equal(unbindRes.json.bound, null)
    assert.equal(unbindRes.json.name, null)
    assert.equal(unbindRes.json.init_state, 'uninitialized')
    assert.equal(unbindRes.json.onboarding_dismissed, false)
  })

  it('3. has_conversation accurately distinguishes 0-turn blank JSONL session from session with user messages/turns', async () => {
    const wsDir = makeTempDir('v022-hasconv-')
    const sessionsDir = join(wsDir, 'sessions')
    const storeRoot = join(wsDir, 'redteam')
    mkdirSync(sessionsDir, { recursive: true })
    const store = createStoreInstance(storeRoot)

    const nowIso = new Date().toISOString()

    // Blank session JSONL: metadata line only, zero user messages / assistant turns / tool calls
    const blankJsonlPath = join(sessionsDir, 'sess-blank-zero.jsonl')
    writeFileSync(
      blankJsonlPath,
      JSON.stringify({ type: 'session_created', sessionId: 'sess-blank-zero', cwd: '/workspace/blank', timestamp: nowIso }) + '\n',
      'utf8',
    )

    // Active conversation JSONL: real user message + assistant response
    const chatJsonlPath = join(sessionsDir, 'sess-with-chat.jsonl')
    writeFileSync(
      chatJsonlPath,
      [
        JSON.stringify({ type: 'session_created', sessionId: 'sess-with-chat', cwd: '/workspace/chat', timestamp: nowIso }),
        JSON.stringify({ role: 'user', content: '请帮我初始化前端构建配置并检查 TypeScript 编译选项', timestamp: nowIso }),
        JSON.stringify({ role: 'assistant', content: '好的，正在检查 tsconfig.json 与打包配置。', usage: { input_tokens: 120, output_tokens: 48 }, timestamp: nowIso }),
      ].join('\n') + '\n',
      'utf8',
    )

    const host = createMockPluginHost({
      store,
      getSessions: () => [
        {
          id: 'sess-blank-zero',
          title: 'New Chat',
          cwd: '/workspace/blank',
          transcriptPath: blankJsonlPath,
          status: 'idle',
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        {
          id: 'sess-with-chat',
          title: '初始化前端构建配置',
          cwd: '/workspace/chat',
          transcriptPath: chatJsonlPath,
          status: 'idle',
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
    })

    const blankBind = await host.callApi({ op: 'sessionBinding', session: 'sess-blank-zero', force: true })
    assert.equal(blankBind.status, 200)
    assert.equal(blankBind.json.has_conversation, false, '0-turn blank JSONL session MUST have has_conversation: false')
    const blankItem = blankBind.json.host_sessions.find((s) => s.id === 'sess-blank-zero')
    assert.ok(blankItem)
    assert.equal(blankItem.hasConversation, false)
    assert.equal(blankItem.turns, 0)

    const chatBind = await host.callApi({ op: 'sessionBinding', session: 'sess-with-chat', force: true })
    assert.equal(chatBind.status, 200)
    assert.equal(chatBind.json.has_conversation, true, 'JSONL session with user message MUST have has_conversation: true')
    const chatItem = chatBind.json.host_sessions.find((s) => s.id === 'sess-with-chat')
    assert.ok(chatItem)
    assert.equal(chatItem.hasConversation, true)
    assert.ok(chatItem.turns >= 1, 'turns >= 1 for session with user prompt')
    assert.ok(chatItem.userMessages >= 1, 'userMessages >= 1 for session with user prompt')
  })

  it('4. agentsStatus, workflowDag, pgWriteProbe & shardLocks for an unbound session return clean zero-state without leaking another project workers', async () => {
    const wsDir = makeTempDir('v022-noleak-')
    const storeRoot = join(wsDir, 'redteam')
    const store = createStoreInstance(storeRoot)

    const qingji = store.openEngagement('轻记 微信小程序')
    const qingjiId = qingji.id
    store.setSessionBinding('sess-qingji-root', qingjiId, '轻记 微信小程序')

    // Seed active worker task & shard lock inside 轻记 微信小程序
    const createdWorker = store.addCustomWorkerTask({
      engagement_id: qingjiId,
      session_id: 'sess-qingji-live-worker',
      worker_name: '后端接口工程师',
      worker_role: 'assess',
      assigned_goal: '实现微信小程序云函数鉴权中间件',
      status: 'running',
      files_owned: ['packages/api/auth.js'],
    })
    assert.equal(createdWorker.ok, true)
    assert.equal(createdWorker.shard_locks.length, 1)

    const nowMs = Date.now()
    const recentIso = new Date(nowMs - 5_000).toISOString()

    const host = createMockPluginHost({
      store,
      getSessions: () => [
        {
          id: 'sess-qingji-root',
          title: '轻记 微信小程序',
          cwd: '/workspace/qingji',
          status: 'running',
          streaming: true,
          turns: 5,
          steps: 10,
          createdAt: recentIso,
          updatedAt: new Date(nowMs).toISOString(),
        },
        {
          id: 'sess-qingji-live-worker',
          parentSessionId: 'sess-qingji-root',
          title: '后端接口工程师',
          role: 'assess',
          cwd: '/workspace/qingji',
          status: 'running',
          streaming: true,
          turns: 2,
          steps: 4,
          createdAt: recentIso,
          updatedAt: new Date(nowMs).toISOString(),
        },
        {
          id: 'sess-exa-unbound',
          title: 'exa 下载紫色晶石官包',
          cwd: '/workspace/exa-purple',
          status: 'idle',
          turns: 1,
          steps: 1,
          createdAt: recentIso,
          updatedAt: recentIso,
        },
      ],
    })

    // Unbound session queries MUST return clean zero-state
    const unboundAgents = await host.callApi({ op: 'agentsStatus', session: 'sess-exa-unbound', force: true })
    assert.equal(unboundAgents.status, 200)
    assert.equal(unboundAgents.json.ok, true)
    assert.equal(unboundAgents.json.active_engagement, null)
    assert.equal(unboundAgents.json.used, 0, 'unbound session MUST report used: 0')
    assert.deepEqual(unboundAgents.json.running, [], 'unbound session MUST report running: []')
    assert.deepEqual(unboundAgents.json.children, [], 'unbound session MUST not leak other project children')
    assert.deepEqual(unboundAgents.json.agentNetwork.children, [])

    const unboundDag = await host.callApi({ op: 'workflowDag', session: 'sess-exa-unbound' })
    assert.equal(unboundDag.status, 200)
    assert.equal(unboundDag.json.ok, true)
    assert.equal(unboundDag.json.active_engagement, null)
    assert.deepEqual(unboundDag.json.nodes, [])
    assert.deepEqual(unboundDag.json.worker_tasks, [])

    const unboundProbe = await host.callApi({ op: 'pgWriteProbe', session: 'sess-exa-unbound' })
    assert.equal(unboundProbe.status, 200)
    assert.equal(unboundProbe.json.active_engagement, null)
    assert.equal(unboundProbe.json.counts.worker_tasks, 0)

    const unboundLocks = await host.callApi({ op: 'shardLocks', session: 'sess-exa-unbound' })
    assert.equal(unboundLocks.status, 200)
    assert.equal(unboundLocks.json.active_engagement, null)
    assert.deepEqual(unboundLocks.json.locks, [])

    // Meanwhile, bound session ('sess-qingji-root') still sees its own live running workers!
    const boundAgents = await host.callApi({ op: 'agentsStatus', session: 'sess-qingji-root', force: true })
    assert.equal(boundAgents.status, 200)
    assert.equal(boundAgents.json.active_engagement, qingjiId)
    assert.equal(boundAgents.json.used, 1, 'bound session accurately sees its 1 live subagent worker')
    assert.equal(boundAgents.json.running.length, 1)
    assert.equal(boundAgents.json.running[0].id, 'sess-qingji-live-worker')
  })

  it('5. Stale 17h16m16s RUNNING worker_tasks, shard_locks, DAG nodes & child sessions are reaped and freeze duration at actual runtime', async () => {
    const wsDir = makeTempDir('v022-reaper-')
    const storeRoot = join(wsDir, 'redteam')
    const store = createStoreInstance(storeRoot)

    const opened = store.openEngagement('分布式构建流水线工程')
    const engId = opened.id
    store.setSessionBinding('sess-pipeline-root', engId, '分布式构建流水线工程')

    const nowMs = Date.now()
    // 17h 16m 16s ago = 62,176,000 ms ago
    const staleStartMs = nowMs - ((17 * 3600) + (16 * 60) + 16) * 1000
    // Actual work lasted 42 seconds before stalling 17h15m34s ago
    const staleLastActiveMs = staleStartMs + 42_000
    const staleStartIso = new Date(staleStartMs).toISOString()
    const staleLastActiveIso = new Date(staleLastActiveMs).toISOString()

    // Insert stale running worker A (had turns & tool calls -> should reap to 'completed')
    const workerWithWork = store.addCustomWorkerTask({
      engagement_id: engId,
      session_id: 'sess-stale-worker-done',
      worker_name: '模块编译子代理',
      worker_role: 'assess',
      assigned_goal: '编译核心存储包并生成类型声明',
      status: 'running',
      files_owned: ['packages/core/index.ts'],
    }).worker_task

    // Insert stale running worker B (0 turns & 0 tool calls -> should reap to 'interrupted')
    const workerEmpty = store.addCustomWorkerTask({
      engagement_id: engId,
      session_id: 'sess-stale-worker-empty',
      worker_name: '静态检查子代理',
      worker_role: 'qa',
      assigned_goal: '启动增量 lint 扫描',
      status: 'running',
    }).worker_task

    // Backdate timestamps & turns/tool_calls in SQLite to 17h16m16s ago to simulate orphaned lease
    const db = store.db(engId)
    db.prepare('UPDATE worker_tasks SET turns = 4, tool_calls = 7, created_at = ?, updated_at = ? WHERE id = ?')
      .run(staleStartIso, staleLastActiveIso, workerWithWork.id)
    db.prepare('UPDATE worker_tasks SET turns = 0, tool_calls = 0, created_at = ?, updated_at = ? WHERE id = ?')
      .run(staleStartIso, staleStartIso, workerEmpty.id)
    db.prepare("UPDATE shard_locks SET acquired_at = ? WHERE status = 'active'")
      .run(staleStartIso)

    // Seed a stale 'run' node in workflow-dag.json from 17h ago
    const wfPath = join(store.dirOf(engId), 'workflow-dag.json')
    writeFileSync(
      wfPath,
      JSON.stringify({
        engagement: engId,
        run_seq: 1,
        status: 'running',
        current_wave: 2,
        updated_at: staleLastActiveIso,
        nodes: [
          {
            id: 'assess',
            code: '③ assess',
            role: 'assess',
            name: '模块编译子代理',
            wave: 2,
            status: 'run',
            state: 'run',
            active: true,
            tokens: 1850,
            step_count: 7,
            latency_ms: 62_176_000,
            updated_at: staleLastActiveIso,
          },
        ],
        edges: [],
      }, null, 2) + '\n',
      'utf8',
    )

    const host = createMockPluginHost({
      store,
      getSessions: () => [
        {
          id: 'sess-pipeline-root',
          title: '分布式构建流水线工程',
          cwd: '/workspace/pipeline',
          status: 'idle',
          streaming: false,
          turns: 6,
          steps: 12,
          createdAt: staleStartIso,
          updatedAt: staleLastActiveIso,
        },
        {
          id: 'sess-stale-worker-done',
          parentSessionId: 'sess-pipeline-root',
          title: '模块编译子代理',
          cwd: '/workspace/pipeline',
          status: 'running', // Stale ghost 'running' flag left behind 17h ago!
          streaming: false,
          turns: 4,
          steps: 7,
          tokens: 1850,
          createdAt: staleStartIso,
          updatedAt: staleLastActiveIso,
        },
        {
          id: 'sess-stale-worker-empty',
          parentSessionId: 'sess-pipeline-root',
          title: '静态检查子代理',
          cwd: '/workspace/pipeline',
          status: 'running', // Stale ghost 'running' flag with 0 steps
          streaming: false,
          turns: 0,
          steps: 0,
          tokens: 0,
          createdAt: staleStartIso,
          updatedAt: staleStartIso,
        },
      ],
    })

    // Query agentsStatus -> triggers host telemetry liveness check + DB lease reaper
    const agentsRes = await host.callApi({ op: 'agentsStatus', session: 'sess-pipeline-root', force: true })
    assert.equal(agentsRes.status, 200)
    assert.equal(agentsRes.json.ok, true)
    assert.equal(agentsRes.json.used, 0, 'all 17h-stale ghost RUNNING slots MUST be reaped (used === 0)')
    assert.deepEqual(agentsRes.json.running, [], 'running array MUST be empty after reaping 17h-old workers')

    const childDone = agentsRes.json.children.find((c) => c.id === 'sess-stale-worker-done')
    const childEmpty = agentsRes.json.children.find((c) => c.id === 'sess-stale-worker-empty')
    assert.ok(childDone, 'found sess-stale-worker-done in children history')
    assert.equal(childDone.status, 'completed')
    assert.equal(childDone.activity, 'completed')
    assert.equal(childDone.durationMs, 42_000, 'durationMs capped at actual 42s runtime instead of 17h16m16s')
    assert.equal(childDone.durationLabel, '42s', 'durationLabel frozen at 42s')
    assert.ok(!String(childDone.durationLabel).includes('17h'), 'durationLabel MUST NOT tick 17h')

    assert.ok(childEmpty, 'found sess-stale-worker-empty in children history')
    assert.equal(childEmpty.status, 'interrupted')
    assert.equal(childEmpty.activity, 'interrupted')
    assert.ok(!String(childEmpty.durationLabel).includes('17h'), 'empty stale worker durationLabel MUST NOT tick 17h')

    // Verify DB worker_tasks & shard_locks & workflow-dag.json were reaped cleanly
    const dagRes = await host.callApi({ op: 'workflowDag', session: 'sess-pipeline-root' })
    assert.equal(dagRes.status, 200)
    assert.equal(dagRes.json.ok, true)

    const dbTasksBySession = new Map(dagRes.json.worker_tasks.map((w) => [w.session_id, w]))
    assert.equal(dbTasksBySession.get('sess-stale-worker-done')?.status, 'completed')
    assert.equal(dbTasksBySession.get('sess-stale-worker-empty')?.status, 'interrupted')

    const persistedWf = JSON.parse(readFileSync(wfPath, 'utf8'))
    assert.notEqual(persistedWf.status, 'running', 'workflow-dag.json root status sanitized out of running')
    assert.equal(persistedWf.nodes[0].status, 'done', 'stale workflow-dag.json node with output sanitized from run to done')
    assert.equal(persistedWf.nodes[0].active, false)
    assert.ok(persistedWf.nodes[0].latency_ms <= 180_000, 'stale latency_ms bounded')

    const activeLocks = store.listShardLocks(engId, { status: 'active' })
    assert.equal(activeLocks.length, 0, '17h-old active shard lock MUST be released')
    const releasedLocks = store.listShardLocks(engId, { status: 'released' })
    assert.equal(releasedLocks.length, 1)
    assert.ok(releasedLocks[0].released_at, 'released_at timestamp recorded on reaped shard lock')
  })

  after(() => {
    console.log('\n通过 5/5')
  })
})

