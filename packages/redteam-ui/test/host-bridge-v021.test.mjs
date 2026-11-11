/**
 * LMTAgent v0.21.0 — Shard 3 Host Bridge, Incremental JSONL Reader, TokenMeter & SSE 回归测试
 *
 * 运行：`node packages/redteam-ui/test/host-bridge-v021.test.mjs`
 * 约束：零外部依赖（仅用 node:* 内置模块 + 本地 redteam-store / redteam-ui）。
 */

import { mkdtempSync, writeFileSync, appendFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'

import * as coreMod from '../../redteam-store/lib/core.js'
import {
  apply,
  resolveRootFromMap,
  resolveRootSessionId,
  IncrementalSessionJsonlReader,
  computeWorkerLmtexMeta,
  invokeStoreMethodCompat,
  getEventSeq,
  bumpEventSeq,
} from '../lib/index.js'

let pass = 0
let fail = 0

function check(label, ok, detail = '') {
  if (ok) {
    pass += 1
    console.log('  ✓ ' + label)
  } else {
    fail += 1
    console.error('  ✗ ' + label + (detail ? ' — ' + detail : ''))
  }
}

function createTempWorkspace(prefix = 'lmtagent-shard3-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

function createRealStore(rootDir) {
  mkdirSync(rootDir, { recursive: true })
  if (typeof coreMod.createStore === 'function') {
    const s = coreMod.createStore(rootDir)
    if (s && s.root) return s
  }
  try {
    const s = new coreMod.RedteamStore({ root: rootDir })
    if (s && typeof s.root === 'string') return s
  } catch { /* fallback */ }
  return new coreMod.RedteamStore(rootDir)
}

/**
 * 构造轻量 Cordis 风格插件宿主模拟（捕获 routes、effects、event listeners）
 */
function createMockPluginHost({ store, sessionsSvc = null, subagentsSvc = null, tokenMeterSvc = null }) {
  const routes = new Map()
  const disposers = []
  const bus = new EventEmitter()

  const services = {
    sessions: sessionsSvc,
    subagents: subagentsSvc,
    tokenMeter: tokenMeterSvc,
  }

  const ctx = {
    redteam: store,
    skills: { list: () => [], get: async () => undefined },
    agentPresets: { standingKeyFor: async () => 'scope-test' },
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

  async function callApi(bodyRawOrObj, opts = {}) {
    const handler = routes.get('/redteam/api')
    const rawStr = typeof bodyRawOrObj === 'string'
      ? bodyRawOrObj
      : JSON.stringify(bodyRawOrObj)
    const req = new EventEmitter()
    req.method = opts.method || 'POST'
    req.headers = Object.assign(
      { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787' },
      opts.headers || {},
    )
    if (opts.omitOrigin) delete req.headers.origin
    req.socket = { remoteAddress: opts.remoteAddress || '127.0.0.1' }

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

    const p = handler(req, res)
    queueMicrotask(() => {
      if (rawStr.length > 0) req.emit('data', Buffer.from(rawStr, 'utf8'))
      req.emit('end')
    })
    await p
    const text = Buffer.concat(chunks).toString('utf8')
    let json = null
    try { json = JSON.parse(text) } catch { json = null }
    return { status: resStatus, headers: resHeaders, text, json }
  }

  async function openSse(opts = {}) {
    const handler = routes.get('/redteam/events')
    const req = new EventEmitter()
    req.method = opts.method || 'GET'
    req.headers = Object.assign(
      { host: '127.0.0.1:8787', 'sec-fetch-site': 'same-origin' },
      opts.headers || {},
    )
    if (opts.omitSecFetchSite) delete req.headers['sec-fetch-site']
    req.socket = { remoteAddress: opts.remoteAddress || '127.0.0.1' }

    let resStatus = 200
    let resHeaders = {}
    const frames = []
    const res = new EventEmitter()
    res.writableEnded = false
    res.destroyed = false
    res.flushHeaders = () => {}
    res.writeHead = (st, hdrs = {}) => {
      resStatus = st
      resHeaders = Object.assign({}, resHeaders, hdrs)
    }
    res.write = (chunk) => {
      frames.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
      return true
    }
    res.end = (chunk) => {
      if (chunk !== undefined) res.write(chunk)
      res.writableEnded = true
      res.emit('close')
    }

    await handler(req, res)
    return {
      status: resStatus,
      headers: resHeaders,
      frames,
      req,
      res,
      close() {
        res.writableEnded = true
        req.emit('close')
        res.emit('close')
      },
    }
  }

  function disposeAll() {
    while (disposers.length > 0) {
      const fn = disposers.pop()
      try { fn() } catch { /* ignore */ }
    }
  }

  return { ctx, routes, services, callApi, openSse, disposeAll }
}

async function main() {
  const tempDirs = []
  const makeTmp = (prefix) => {
    const d = createTempWorkspace(prefix)
    tempDirs.push(d)
    return d
  }

  try {
    /* ==================================================================
     * 1. O(N) resolveRootFromMap & resolveRootSessionId 线性防环解析
     * ================================================================== */
    console.log('\n— 1. O(N) resolveRootFromMap 与单次注册表扫描防环验证')
    {
      const byId = new Map()
      byId.set('root-0', { id: 'root-0', header: {} })
      let prev = 'root-0'
      for (let i = 1; i <= 12; i += 1) {
        const cur = `hop-${i}`
        byId.set(cur, { id: cur, header: { parentSession: prev } })
        prev = cur
      }
      byId.set('cycle-a', { id: 'cycle-a', header: { parentSession: 'cycle-b' } })
      byId.set('cycle-b', { id: 'cycle-b', header: { parentSession: 'cycle-a' } })
      byId.set('orphan-leaf', { id: 'orphan-leaf', header: { parentSession: 'missing-root' } })

      check('12 层子智能体链 O(1) Map 寻根到 root-0', resolveRootFromMap(byId, 'hop-12') === 'root-0')
      check('双向环（cycle-a <-> cycle-b）64 跳熔断不死循环', ['cycle-a', 'cycle-b'].includes(resolveRootFromMap(byId, 'cycle-a')))
      check('父节点缺失时停在最后已知子节点 orphan-leaf', resolveRootFromMap(byId, 'orphan-leaf') === 'orphan-leaf')
      check('空 Map 原样返回输入会话 ID', resolveRootFromMap(new Map(), 'any-id') === 'any-id')

      let listCalls = 0
      const fakeCtx = {
        get(k) {
          if (k !== 'sessions') return null
          return {
            list() {
              listCalls += 1
              return Array.from(byId.values())
            },
          }
        },
      }
      const r = resolveRootSessionId(fakeCtx, 'hop-12')
      check('resolveRootSessionId 仅调用 1 次 sessions.list()', r === 'root-0' && listCalls === 1)
    }

    /* ==================================================================
     * 2. IncrementalSessionJsonlReader：0 读缓存、增量追加、>256KB 首尾冷读、LRU 淘汰
     * ================================================================== */
    console.log('\n— 2. IncrementalSessionJsonlReader 增量流式尾随与 >256KB 首尾冷读')
    {
      const sessDir = makeTmp('lmtagent-jsonl-')
      const reader = new IncrementalSessionJsonlReader(8)

      const sidSmall = 'sess-small-001'
      const smallPath = join(sessDir, `${sidSmall}.jsonl`)
      const headLines = [
        JSON.stringify({
          type: 'header',
          model: 'deepseek-chat',
          cwd: '/home/antigravity/ECCVIK/lmtagent',
          createdAt: '2026-11-10T10:00:00.000Z',
        }),
        JSON.stringify({
          role: 'user',
          content: '请实现 Shard 3 增量 JSONL 读取器并补齐单元测试',
          timestamp: '2026-11-10T10:00:02.000Z',
        }),
        JSON.stringify({
          role: 'assistant',
          content: [
            { type: 'text', text: '正在检查只读文件与写入目标文件。' },
            { type: 'tool_use', name: 'view_file', input: { AbsolutePath: '/home/antigravity/ECCVIK/lmtagent/README.md' } },
            { type: 'tool_use', name: 'replace_file_content', input: { TargetFile: '/home/antigravity/ECCVIK/lmtagent/packages/redteam-ui/lib/index.js' } },
          ],
          usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 600 },
          timestamp: '2026-11-10T10:00:10.000Z',
        }),
      ]
      writeFileSync(smallPath, headLines.join('\n') + '\n', 'utf8')

      const firstRead = reader.readSession(sidSmall, { dirs: [sessDir] })
      check('首次冷读解析 model 与委派 Prompt', Boolean(firstRead && firstRead.model === 'deepseek-chat' && firstRead.delegationPrompt.includes('Shard 3')))
      check('仅提取真实写/改文件，过滤只读 view_file', Boolean(
        firstRead
        && firstRead.filesTouched.some((f) => f.endsWith('packages/redteam-ui/lib/index.js'))
        && !firstRead.filesTouched.some((f) => f.endsWith('README.md')),
      ))
      check('首次冷读 didAdvance 为 false，Token 汇总准确', Boolean(
        firstRead && firstRead.didAdvance === false && firstRead.inputTokens === 1200 && firstRead.outputTokens === 300 && firstRead.cacheReadTokens === 600,
      ))

      /* 游标未推进：0 磁盘重读命中缓存 */
      const cachedRead = reader.readSession(sidSmall, { dirs: [sessDir] })
      check('文件未改动时命中 statSync 游标缓存（didAdvance: false）', Boolean(
        cachedRead && cachedRead.didAdvance === false && cachedRead.inputTokens === 1200,
      ))

      /* 实时增量追加新行 */
      appendFileSync(smallPath, JSON.stringify({
        role: 'assistant',
        content: [
          { type: 'text', text: '已完成单元测试编写并通过验证。' },
          { type: 'tool_use', name: 'write_to_file', input: { TargetFile: '/home/antigravity/ECCVIK/lmtagent/packages/redteam-ui/test/host-bridge-v021.test.mjs' } },
        ],
        usage: { input_tokens: 800, output_tokens: 250, cache_read_input_tokens: 400 },
        timestamp: '2026-11-10T10:00:25.000Z',
      }) + '\n', 'utf8')

      check('checkTrackedFilesChanged 检测到活跃 JSONL 追加', reader.checkTrackedFilesChanged() === true)
      const deltaRead = reader.readSession(sidSmall, { dirs: [sessDir] })
      check('增量追加读取 didAdvance 为 true 且累加 Token 与写入文件', Boolean(
        deltaRead
        && deltaRead.didAdvance === true
        && deltaRead.inputTokens === 2000
        && deltaRead.outputTokens === 550
        && deltaRead.cacheReadTokens === 1000
        && deltaRead.filesTouched.some((f) => f.endsWith('host-bridge-v021.test.mjs'))
        && deltaRead.lastAssistantText.includes('已完成单元测试编写'),
      ))

      /* 3 参数签名兼容 readSession(sid, store, rawSession) */
      const fakeStoreWithSessions = { root: sessDir, workflowDag: () => null }
      const threeArgRead = reader.readSession('non-indexed-id', fakeStoreWithSessions, { transcriptPath: smallPath })
      check('readSession(sid, store, rawSession) 三参数调用精准提取 explicitPath', Boolean(
        threeArgRead && threeArgRead.inputTokens === 2000,
      ))

      /* >256KB 大文件冷启动（16KB Head + 128KB Tail 截断读取） */
      const sidLarge = 'sess-large-320kb'
      const largePath = join(sessDir, `${sidLarge}.jsonl`)
      const fillerChunk = 'x'.repeat(2048)
      const largeRows = [
        JSON.stringify({ type: 'header', model: 'deepseek-reasoner', createdAt: '2026-11-10T09:00:00.000Z' }),
        JSON.stringify({ role: 'user', content: '大文件头部原始委派指令：构建分布式分片锁引擎', timestamp: '2026-11-10T09:00:01.000Z' }),
      ]
      for (let i = 0; i < 165; i += 1) {
        largeRows.push(JSON.stringify({ role: 'tool', content: `log-${i}:${fillerChunk}` }))
      }
      largeRows.push(JSON.stringify({
        role: 'assistant',
        content: [
          { type: 'text', text: '大文件尾部最新结论：分片锁冲突检测全部通过。' },
          { type: 'tool_use', name: 'edit_file', input: { path: 'packages/redteam-store/lib/core.js' } },
        ],
        usage: { input_tokens: 9500, output_tokens: 1500, reasoning_tokens: 400 },
        timestamp: '2026-11-10T09:05:00.000Z',
      }))
      writeFileSync(largePath, largeRows.join('\n') + '\n', 'utf8')
      const largeRes = reader.readSession(sidLarge, { dirs: [sessDir] })
      check('>256KB 大文件首尾冷读同时保留头部委派指令与尾部最新输出/Token', Boolean(
        largeRes
        && largeRes.size > 256 * 1024
        && largeRes.model === 'deepseek-reasoner'
        && largeRes.delegationPrompt.includes('大文件头部原始委派指令')
        && largeRes.lastAssistantText.includes('大文件尾部最新结论')
        && largeRes.inputTokens === 9500
        && largeRes.filesTouched.some((f) => f.endsWith('core.js')),
      ))

      /* LRU 容量淘汰上限验证（maxEntries = 8） */
      for (let i = 0; i < 12; i += 1) {
        const p = join(sessDir, `lru-item-${i}.jsonl`)
        writeFileSync(p, JSON.stringify({ role: 'user', content: `lru ${i}` }) + '\n', 'utf8')
        reader.readFile(p)
      }
      check('Bounded LRU 严格淘汰最旧条目（cache.size <= 8）', reader.cache.size === 8 && !reader.cache.has(join(sessDir, 'lru-item-0.jsonl')))
    }

    /* ==================================================================
     * 3. 原生 TokenMeter、零伪造 94.2% 缓存率、已完成会话静态耗时与跨工作区隔离
     * ================================================================== */
    console.log('\n— 3. TokenMeter 接入、零伪造缓存命中率、静态耗时与 6 并行 UUID 子会话隔离')
    {
      const wsDir = makeTmp('lmtagent-store-iso-')
      const store = createRealStore(wsDir)
      coreMod.dispatch(store, { op: 'openEngagement', name: 'eng-alpha', note: 'Alpha 研发工作区' })
      coreMod.dispatch(store, { op: 'openEngagement', name: 'eng-beta', note: 'Beta 隔离工作区' })
      coreMod.dispatch(store, { op: 'openEngagement', name: 'eng-alpha', note: 'Alpha 研发工作区' })
      coreMod.dispatch(store, { op: 'bindSessionEngagement', session: 'root-ws-alpha', engagement: 'eng-alpha', name: 'Alpha 研发工作区' })
      coreMod.dispatch(store, { op: 'bindSessionEngagement', session: 'root-ws-beta', engagement: 'eng-beta', name: 'Beta 隔离工作区' })

      const alphaChildren = []
      for (let i = 1; i <= 6; i += 1) {
        alphaChildren.push({
          id: `uuid-exploit-worker-000${i}`,
          title: 'Wave3 exploit 全栈研发与构建',
          role: 'exploit',
          status: i === 6 ? 'shard_violation' : 'completed',
          createdAt: '2026-11-10T08:00:00.000Z',
          updatedAt: '2026-11-10T08:01:30.000Z',
          error_detail: i === 6 ? '检测到越界写入非独占文件 src/shared.js' : '',
          header: { parentSession: 'root-ws-alpha' },
        })
      }
      const betaChildren = [
        {
          id: 'uuid-beta-secret-01',
          title: 'Beta 专属敏感测绘任务',
          role: 'recon',
          status: 'running',
          createdAt: '2026-11-10T08:00:00.000Z',
          updatedAt: '2026-11-10T08:02:00.000Z',
          header: { parentSession: 'root-ws-beta' },
        },
        {
          id: 'uuid-beta-secret-02',
          title: 'Beta 专属架构任务',
          role: 'assess',
          status: 'completed',
          createdAt: '2026-11-10T08:00:00.000Z',
          updatedAt: '2026-11-10T08:03:00.000Z',
          header: { parentSession: 'root-ws-beta' },
        },
      ]

      const sessionsSvc = {
        list() {
          return [
            {
              id: 'root-ws-alpha',
              title: 'Alpha 主控会话',
              status: 'completed',
              createdAt: '2026-11-10T08:00:00.000Z',
              updatedAt: '2026-11-10T08:05:00.000Z',
              header: {},
            },
            {
              id: 'root-ws-beta',
              title: 'Beta 主控会话',
              status: 'running',
              createdAt: '2026-11-10T08:00:00.000Z',
              updatedAt: '2026-11-10T08:05:00.000Z',
              header: {},
            },
          ]
        },
      }
      const subagentsSvc = {
        async listChildren(rootId) {
          if (rootId === 'root-ws-alpha') return alphaChildren
          if (rootId === 'root-ws-beta') return betaChildren
          return []
        },
      }
      const tokenMeterSvc = {
        getSessionUsage(sid) {
          if (sid === 'uuid-exploit-worker-0001') {
            /* 0 缓存读取 —— 绝不能伪造 94.2%！ */
            return {
              inputTokens: 5000,
              outputTokens: 1200,
              reasoningTokens: 300,
              cacheReadTokens: 0,
              contextTokens: 6200,
              contextWindow: 128000,
            }
          }
          if (sid === 'uuid-exploit-worker-0002') {
            return {
              inputTokens: 4000,
              outputTokens: 800,
              cacheReadTokens: 2000,
              contextTokens: 4800,
              contextWindow: 128000,
            }
          }
          return null
        },
      }

      const host = createMockPluginHost({ store, sessionsSvc, subagentsSvc, tokenMeterSvc })
      try {
        const res1 = await host.callApi({ op: 'agentsStatus', session: 'root-ws-alpha', engagement: 'eng-alpha' })
        check('agentsStatus 返回 HTTP 200 与 ok: true', res1.status === 200 && res1.json?.ok === true)

        const netNodes = res1.json?.agentNetwork?.nodes || []
        const exploitWorkers = netNodes.filter((n) => !n.isRoot && n.role === 'exploit')
        check(
          '6 个并行同角色 exploit UUID 子会话完整保留不折叠',
          exploitWorkers.length === 6,
          `actual=${exploitWorkers.length}`,
        )
        const distinctIds = new Set(exploitWorkers.map((n) => n.id))
        check('6 个并行 exploit 子会话拥有唯一 ID 与序号标记', distinctIds.size === 6 && exploitWorkers.every((n) => n.roleSiblingCount === 6))

        const leakedBetaInNet = netNodes.some((n) => String(n.id).includes('beta-secret'))
        const alphaDag = store.workflowDag('eng-alpha')
        const leakedBetaInDb = (alphaDag.worker_tasks || []).some((t) => String(t.session_id || '').includes('beta-secret'))
        check('跨工作区严格隔离：eng-beta 子会话绝不混入 eng-alpha 拓扑或 DB', !leakedBetaInNet && !leakedBetaInDb)

        const w1 = exploitWorkers.find((n) => n.id === 'uuid-exploit-worker-0001')
        const w2 = exploitWorkers.find((n) => n.id === 'uuid-exploit-worker-0002')
        const w6 = exploitWorkers.find((n) => n.id === 'uuid-exploit-worker-0006')

        check('原生 ctx.get("tokenMeter") 精确注入 input/output/reasoning/context', Boolean(
          w1 && w1.inputTokens === 5000 && w1.outputTokens === 1200 && w1.reasoningTokens === 300 && w1.contextMax === 128000,
        ))
        check('cacheReadTokens === 0 时缓存命中率严格为 0%（绝无伪造 94.2%）', Boolean(w1 && w1.cacheHitPct === 0))
        check('cacheReadTokens === 2000 / inputTokens === 4000 时缓存命中率为 50%', Boolean(w2 && w2.cacheHitPct === 50))
        check('shard_violation 异常状态独立归入 status="error" / revision_required / P0', Boolean(
          w6 && w6.status === 'error' && w6.approvalState === 'revision_required' && w6.uiPriority === 'P0',
        ))

        /* 检验所有异常枚举值均不会误标为 completed / approved */
        for (const errSt of ['error', 'failed', 'blocked', 'timeout', 'shard_violation']) {
          const m = computeWorkerLmtexMeta({ id: `node-${errSt}`, role: 'exploit', status: errSt }, 2)
          if (m.status !== 'error' || m.approvalState !== 'revision_required' || m.uiPriority !== 'P0') {
            check(`异常枚举 ${errSt} 分离校验`, false, JSON.stringify(m))
          }
        }
        check('全部 5 类异常状态（error/failed/blocked/timeout/shard_violation）均严格分离自 completed', true)

        /* 检验 workflowDag 环图缓存命中率在无缓存读取时清零不伪造 */
        const dagZeroCacheHost = createMockPluginHost({
          store,
          sessionsSvc,
          subagentsSvc,
          tokenMeterSvc: {
            getSessionUsage: () => ({ inputTokens: 3000, outputTokens: 500, cacheReadTokens: 0 }),
          },
        })
        const wfZeroRes = await dagZeroCacheHost.callApi({ op: 'workflowDag', session: 'root-ws-alpha', engagement: 'eng-alpha' })
        dagZeroCacheHost.disposeAll()
        check('workflowDag telemetry 在 0 缓存读取时 cache_hit_pct === 0（消除 94.2% 硬编码假数据）', Boolean(
          wfZeroRes.json?.ok === true && (wfZeroRes.json?.telemetry?.cache_hit_pct ?? 0) === 0,
        ))

        /* 验证已完成历史节点耗时恒定不随 Date.now() 跳表 */
        const dur1 = w1.durationMs
        await new Promise((r) => setTimeout(r, 35))
        const res2 = await host.callApi({ op: 'agentsStatus', session: 'root-ws-alpha', engagement: 'eng-alpha' })
        const w1Second = (res2.json?.agentNetwork?.nodes || []).find((n) => n.id === 'uuid-exploit-worker-0001')
        check('已完成历史会话耗时恒定（90000ms），不随轮询实时跳动', dur1 === 90000 && w1Second?.durationMs === dur1)

        /* ==================================================================
         * 4. GET /redteam/events SSE、sinceSeq <0.1ms 短路与只读 op 不污染 seq
         * ================================================================== */
        console.log('\n— 4. GET /redteam/events SSE 实时流与 sinceSeq 短路验证')

        const postSse = await host.openSse({ method: 'POST' })
        check('POST /redteam/events 拒绝并返回 405', postSse.status === 405)

        const crossSiteSse = await host.openSse({
          headers: { host: 'example.internal:8787', 'sec-fetch-site': 'cross-site' },
          remoteAddress: '10.20.30.40',
        })
        check('跨站 sec-fetch-site=cross-site 请求被 SSE 拦截（403）', crossSiteSse.status === 403)

        const sseStream = await host.openSse({
          headers: { host: 'panel.local:8787', 'sec-fetch-site': 'same-origin' },
          remoteAddress: '10.20.30.40',
        })
        check('同源 sec-fetch-site=same-origin 建立 SSE 流（200 text/event-stream）', Boolean(
          sseStream.status === 200 && String(sseStream.headers['Content-Type'] || '').includes('text/event-stream'),
        ))
        const initFrameMatch = /^data:\s*(\{.+\})\n\n$/.exec(sseStream.frames[0] || '')
        const initFrameObj = initFrameMatch ? JSON.parse(initFrameMatch[1]) : null
        check('SSE 首帧立即下发 { seq, connected: true } 握手快照', Boolean(
          initFrameObj && initFrameObj.connected === true && typeof initFrameObj.seq === 'number',
        ))

        const seqBeforeBump = getEventSeq()
        bumpEventSeq('test_broadcast', { workerId: 'uuid-exploit-worker-0001' })
        const pushedFrameMatch = /^data:\s*(\{.+\})\n\n$/.exec(sseStream.frames[1] || '')
        const pushedFrameObj = pushedFrameMatch ? JSON.parse(pushedFrameMatch[1]) : null
        check('bumpEventSeq 单调递增并实时推送给已连接 SSE 客户端', Boolean(
          pushedFrameObj && pushedFrameObj.seq === seqBeforeBump + 1 && pushedFrameObj.reason === 'test_broadcast',
        ))

        /* 只读轮询 op sinceSeq 短路（含 shardLocks！） */
        const currentSeq = getEventSeq()
        for (const pollOp of ['agentsStatus', 'workflowDag', 'pgWriteProbe', 'consoleDigest', 'shardLocks']) {
          const t0 = performance.now()
          const scRes = await host.callApi({ op: pollOp, engagement: 'eng-alpha', sinceSeq: currentSeq })
          const elapsedMs = performance.now() - t0
          check(`sinceSeq 短路生效：${pollOp} -> unchanged: true (${elapsedMs.toFixed(3)}ms)`, Boolean(
            scRes.status === 200 && scRes.json?.ok === true && scRes.json?.unchanged === true && scRes.json?.seq === currentSeq,
          ))
        }

        /* 只读 store op 不应推进 eventSeq */
        const seqBeforeReadOnly = getEventSeq()
        await host.callApi({ op: 'snapshot', engagement: 'eng-alpha' })
        await host.callApi({ op: 'scores', engagement: 'eng-alpha' })
        check('只读 RedteamStore op（snapshot/scores）不误推进 eventSeq', getEventSeq() === seqBeforeReadOnly)

        /* ==================================================================
         * 5. POST /redteam/api 请求体守卫、ES6 签名兼容与全量 v0.21.0 协同桥接 RPC
         * ================================================================== */
        console.log('\n— 5. POST /redteam/api 安全守卫、作用域审批、许愿拆解、分片锁与飞书推送')

        const crossOriginApi = await host.callApi({ op: 'agentsStatus' }, {
          headers: { host: '127.0.0.1:8787', origin: 'https://attacker.evil' },
        })
        check('跨源 Origin POST /redteam/api 返回 403', crossOriginApi.status === 403)

        for (const badJson of ['null', '[1, 2, 3]', '42', '"plain-string"']) {
          const badRes = await host.callApi(badJson)
          check(`非对象 JSON 请求体 (${badJson}) 返回 400 不崩溃`, badRes.status === 400 && badRes.json?.ok === false)
        }

        /* invokeStoreMethodCompat ES6 Class 签名兼容测试 */
        class MockCompatStore {
          byIdFirst(engagementId, payload) {
            return { style: 'id-first', engagementId, tag: payload.tag }
          }

          byPayloadFirst(payload = {}) {
            return { style: 'payload-first', engagementId: payload.engagement_id, tag: payload.tag }
          }
        }
        const compatInst = new MockCompatStore()
        const c1 = invokeStoreMethodCompat(compatInst, 'byIdFirst', 'eng-x', { tag: 'ok1' })
        const c2 = invokeStoreMethodCompat(compatInst, 'byPayloadFirst', 'eng-y', { tag: 'ok2' })
        check('invokeStoreMethodCompat 同时兼容 (id, payload) 与 (payload = {}) ES6 方法签名', Boolean(
          c1?.style === 'id-first' && c1?.engagementId === 'eng-x' && c1?.tag === 'ok1'
          && c2?.style === 'payload-first' && c2?.engagementId === 'eng-y' && c2?.tag === 'ok2',
        ))

        /* 拒绝裸角色名审批 & 工作区作用域隔离审批 */
        const bareApprove = await host.callApi({
          op: 'planApproveWorker',
          engagement: 'eng-alpha',
          worker_id: 'exploit',
          decision: 'approved',
        })
        check('planApproveWorker 严禁裸角色名 "exploit" 全局串扰（返回 ok: false）', bareApprove.json?.ok === false)

        const scopedApprove = await host.callApi({
          op: 'planApproveWorker',
          engagement: 'eng-alpha',
          worker_id: 'uuid-exploit-worker-0001',
          approval_state: 'approved',
          next_goal: '进入 Wave 4 QA 联合门禁验证',
        })
        check('planApproveWorker 按 engagementId::workerId 精确审批并落库', Boolean(
          scopedApprove.json?.ok === true && scopedApprove.json?.approval_state === 'approved',
        ))
        const afterApproveNodes = scopedApprove.json?.nodes || []
        const n1After = afterApproveNodes.find((n) => n.id === 'uuid-exploit-worker-0001')
        const n2After = afterApproveNodes.find((n) => n.id === 'uuid-exploit-worker-0002')
        check('审批状态持久化回填至目标 Worker 且不污染兄弟 Worker', Boolean(
          n1After?.approvalState === 'approved'
          && n1After?.nextGoal?.includes('Wave 4 QA')
          && n2After?.nextGoal !== '进入 Wave 4 QA 联合门禁验证',
        ))

        /* submitWorkerDigest 持久化与回填 */
        const digestRes = await host.callApi({
          op: 'submitWorkerDigest',
          engagement: 'eng-alpha',
          worker_id: 'uuid-exploit-worker-0002',
          worker_name: 'Wave3 exploit #2',
          worker_role: 'exploit',
          wave: 'wave-3',
          what_was_done: '完成增量 JSONL 游标读取与 TokenMeter 聚合层研发',
          files_touched: ['packages/redteam-ui/lib/index.js'],
          verification: '✓ 全部断言通过',
          raw_tokens: 4800,
          compressed_tokens: 420,
        })
        check('submitWorkerDigest 写入结构化摘要并回填拓扑节点', Boolean(
          digestRes.json?.ok === true
          && (digestRes.json?.nodes || []).some((n) => n.id === 'uuid-exploit-worker-0002' && n.compressedDigest?.whatWasDone?.includes('TokenMeter')),
        ))

        /* setClusterConfig（thinking + thinkingEffort + maxAgents + maxDepth） */
        const cfgRes = await host.callApi({
          op: 'setClusterConfig',
          maxAgents: 8,
          thinking: 'high',
          maxDepth: 4,
        })
        check('setClusterConfig 同步持久化 maxAgents / thinkingEffort / maxDepth', Boolean(
          cfgRes.json?.ok === true
          && cfgRes.json?.max === 8
          && cfgRes.json?.thinking === 'high'
          && cfgRes.json?.thinkingEffort === 'high'
          && cfgRes.json?.maxDepth === 4,
        ))

        /* engagementOpen 别名（03-wish-wizard.js 兼容） */
        const openEngAlias = await host.callApi({
          op: 'engagementOpen',
          name: 'eng-wish-demo',
          note: '许愿精灵新建项目',
        })
        check('engagementOpen 别名无缝路由至 openEngagement 创建工作区', Boolean(
          openEngAlias.status === 200 && (openEngAlias.json?.engagement?.id === 'eng-wish-demo' || store.activeEngagementId() === 'eng-wish-demo'),
        ))

        /* refineAndDecomposeWish：preview_only: true 零写库 + 03-wish-wizard 字段对齐 */
        const previewRes = await host.callApi({
          op: 'refineAndDecomposeWish',
          engagement: 'eng-wish-demo',
          prompt: '构建实时多智能体架构交付看板并支持飞书机器人通知',
          template: 'fullstack',
          preview_only: true,
        })
        const dagAfterPreview = store.workflowDag('eng-wish-demo')
        check('refineAndDecomposeWish(preview_only: true) 返回可编辑波次与 refined_prompt，且数据库零写入', Boolean(
          previewRes.json?.ok === true
          && previewRes.json?.preview_only === true
          && typeof previewRes.json?.refined_prompt === 'string'
          && previewRes.json.refined_prompt.length > 0
          && Array.isArray(previewRes.json?.goals)
          && previewRes.json.goals.length >= 4
          && typeof previewRes.json.goals[0].wave === 'number'
          && (dagAfterPreview.worker_tasks || []).length === 0,
        ))

        /* refineAndDecomposeWish(preview_only: false) 落库自定义 goals（含数字 wave 与 assigned_goal） */
        const commitWishRes = await host.callApi({
          op: 'refineAndDecomposeWish',
          engagement: 'eng-wish-demo',
          prompt: '构建实时多智能体架构交付看板并支持飞书机器人通知',
          preview_only: false,
          goals: [
            {
              wave: 1,
              role: 'recon',
              title: 'Wave 1 · 需求边界测绘',
              assigned_goal: '梳理核心用户旅程与前后端接口字段',
              files_owned: ['docs/prd.md'],
            },
            {
              wave: 2,
              role: 'assess',
              title: 'Wave 2 · 分片契约冻结',
              assigned_goal: '锁定独占文件分片锁并定义测试验收基准',
              files_owned: ['docs/contract.md'],
            },
            {
              wave: 3,
              role: 'exploit',
              title: 'Wave 3 · 后端桥接实现',
              assigned_goal: '实现 SSE 推送与增量 JSONL 尾随读取',
              files_owned: ['src/bridge.js'],
            },
            {
              wave: 4,
              role: 'qa',
              title: 'Wave 4 · 回归门禁核验',
              assigned_goal: '编写无外部依赖自动化回归套件',
              files_owned: ['test/bridge.test.mjs'],
            },
          ],
        })
        check('refineAndDecomposeWish(preview_only: false) 持久化波次目标、assigned_goal 与 files_owned', Boolean(
          commitWishRes.json?.ok === true
          && Array.isArray(commitWishRes.json?.worker_tasks)
          && commitWishRes.json.worker_tasks.length === 4
          && commitWishRes.json.worker_tasks.some((t) => t.wave === 'wave-3' && String(t.assigned_goal || '').includes('SSE 推送')),
        ))

        /* shardLocks 查询独占文件锁 */
        const locksRes = await host.callApi({
          op: 'shardLocks',
          engagement: 'eng-wish-demo',
        })
        check('shardLocks 返回可序列化 locks / shard_locks / active 列表', Boolean(
          locksRes.json?.ok === true
          && Array.isArray(locksRes.json?.locks)
          && locksRes.json.locks.some((l) => String(l.file_path || '').includes('src/bridge.js')),
        ))

        /* addCustomWorkerTask / updateWorkerGoal（按 session_id 或 wt-<id>） / retryWorkerTask */
        const addTaskRes = await host.callApi({
          op: 'addCustomWorkerTask',
          engagement: 'eng-wish-demo',
          wave: 'wave-3',
          worker_role: 'exploit',
          worker_name: 'Custom Shard Worker',
          session_id: 'sess-custom-worker-99',
          assigned_goal: '初始自定义分片研发目标',
          files_owned: ['src/custom-shard.js'],
          status: 'error',
          error_detail: '模拟单测断言失败',
        })
        check('addCustomWorkerTask 新增自定义分片 Worker 并返回 worker_id', Boolean(
          addTaskRes.json?.ok === true && addTaskRes.json?.worker_task?.session_id === 'sess-custom-worker-99',
        ))

        const updGoalRes = await host.callApi({
          op: 'updateWorkerGoal',
          engagement: 'eng-wish-demo',
          worker_id: 'sess-custom-worker-99',
          assigned_goal: '修订后的自定义分片研发目标 v2',
          files_owned: ['src/custom-shard.js', 'src/custom-helper.js'],
        })
        check('updateWorkerGoal 支持按 session_id 定位并更新 assigned_goal 与 files_owned', Boolean(
          updGoalRes.json?.ok === true
          && String(updGoalRes.json?.worker_task?.assigned_goal || '').includes('修订后的自定义分片研发目标 v2'),
        ))

        const retryRes = await host.callApi({
          op: 'retryWorkerTask',
          engagement: 'eng-wish-demo',
          worker_id: 'sess-custom-worker-99',
        })
        check('retryWorkerTask 支持按 session_id 重置异常状态并清空报错详情', Boolean(
          retryRes.json?.ok === true
          && retryRes.json?.worker_task?.status !== 'error',
        ))

        /* feishuConfigSave（07-cluster-shell.js）+ feishuTestPush 真实本地 HTTP 回路验证 */
        const receivedWebhooks = []
        const webhookServer = createServer((req, res) => {
          const bufs = []
          req.on('data', (c) => bufs.push(c))
          req.on('end', () => {
            try { receivedWebhooks.push(JSON.parse(Buffer.concat(bufs).toString('utf8'))) } catch { /* ignore */ }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ code: 0, msg: 'success' }))
          })
        })
        await new Promise((resolveListen) => webhookServer.listen(0, '127.0.0.1', resolveListen))
        const webhookPort = webhookServer.address().port
        const localWebhookUrl = `http://127.0.0.1:${webhookPort}/open-apis/bot/v2/hook/test-token`

        try {
          const saveFeishuRes = await host.callApi({
            op: 'feishuConfigSave',
            engagement: 'eng-wish-demo',
            webhook_url: localWebhookUrl,
            enabled: true,
            events: ['wave_complete', 'worker_error', 'gate_approval'],
          })
          check('feishuConfigSave（07-cluster-shell 契约）成功持久化飞书配置', Boolean(
            saveFeishuRes.json?.ok === true,
          ))

          const testPushRes = await host.callApi({
            op: 'feishuTestPush',
            engagement: 'eng-wish-demo',
            title: 'LMTAgent v0.21.0 连通性自检',
            text: 'Shard 3 飞书 Webhook 异步推送验证通过',
          })
          check('feishuTestPush 真实发起异步 Webhook POST 并收到 HTTP 200 回执', Boolean(
            testPushRes.json?.ok === true && receivedWebhooks.length === 1,
          ))
        } finally {
          await new Promise((r) => webhookServer.close(r))
        }

        /* activateAgentSession 合成 ID 污染防护验证 */
        for (const synthId of ['root', 'root-main', 'sub-exploit', 'wt-1']) {
          const actSynth = await host.callApi({
            op: 'activateAgentSession',
            engagement: 'eng-alpha',
            sessionId: synthId,
          })
          const sessionsJsonPath = join(wsDir, 'sessions.json')
          const sessionsFileObj = existsSync(sessionsJsonPath)
            ? JSON.parse(readFileSync(sessionsJsonPath, 'utf8'))
            : { agents: {} }
          const polluted = Boolean(sessionsFileObj?.agents && Object.prototype.hasOwnProperty.call(sessionsFileObj.agents, synthId))
          check(`activateAgentSession 拦截合成 ID "${synthId}" 绝不污染 sessions.json`, Boolean(
            actSynth.json?.ok === true && actSynth.json?.isRealHostSession === false && !polluted,
          ))
        }

        const actReal = await host.callApi({
          op: 'activateAgentSession',
          engagement: 'eng-alpha',
          sessionId: 'uuid-exploit-worker-0001',
        })
        check('activateAgentSession 对真实子智能体 UUID 解析到根会话 root-ws-alpha 并激活', Boolean(
          actReal.json?.ok === true
          && actReal.json?.isRealHostSession === true
          && actReal.json?.rootSessionId === 'root-ws-alpha',
        ))

        /* 验证 ctx.effect dispose 清理所有 SSE 连接与定时器 */
        host.disposeAll()
        check('插件热重载/卸载时 ctx.effect 干净关闭所有活跃 SSE 客户端流', sseStream.res.writableEnded === true)
      } finally {
        host.disposeAll()
      }
    }
  } finally {
    for (const d of tempDirs) {
      try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }

  console.log(`\n通过 ${pass}/${pass + fail}`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('Fatal test error:', err)
  fail += 1
  console.log(`\n通过 ${pass}/${pass + fail}`)
  process.exit(1)
})
