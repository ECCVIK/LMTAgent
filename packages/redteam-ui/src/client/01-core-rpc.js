    /* ---------------------------------------------------------- 01-core-rpc：桥接、事件流与全局状态 */
    /** 是否在「独立桌面应用窗」中运行（`/lmtagent/window` 专属无壳层独立进程窗口）。 */
    const isDedicatedStandaloneWindow = () => {
      try {
        if (typeof window === 'undefined') return false
        if (window.__LMT_STANDALONE_WINDOW__ === true) return true
        return String((window.location && window.location.pathname) || '') === '/lmtagent/window'
      } catch { return false }
    }

    /** 是否在「全面浏览」或独立窗口里（URL hash 或专属独立路径）。 */
    const isFullWindow = () => {
      try {
        if (isDedicatedStandaloneWindow()) return true
        const hashVal = String(window.location.hash || '')
        return hashVal === '#lmtagent-full' || hashVal === '#redteam-full'
      } catch { return false }
    }

    const FULL_REQUEST_EVENT = 'rt-open-full'
    const EXIT_FULL_EVENT = 'rt-exit-full'
    const isDesktopShell = () => {
      try {
        const html = document.documentElement
        return html.hasAttribute('data-windows-titlebar') || html.getAttribute('data-platform') === 'darwin'
      } catch { return false }
    }
    const requestFullInPlace = () => {
      try { window.dispatchEvent(new Event(FULL_REQUEST_EVENT)) } catch { /* 旧浏览器 */ }
    }
    const exitFullInPlace = () => {
      try { window.dispatchEvent(new Event(EXIT_FULL_EVENT)) } catch { /* 旧浏览器 */ }
    }
    const formatShortSessionId = (sid) => {
      const raw = String(sid || '').trim()
      if (!raw) return ''
      const stripped = raw.replace(/^session-/i, '')
      return (stripped || raw).slice(0, 8)
    }

    const readStandaloneUrlParams = () => {
      try {
        const search = String((typeof window !== 'undefined' && window.location && window.location.search) || '')
        if (!search) return { session: null, engagement: null, tab: null }
        const p = new URLSearchParams(search)
        return {
          session: p.get('lmt_session') || null,
          engagement: p.get('lmt_eng') || null,
          tab: p.get('lmt_tab') || null,
        }
      } catch {
        return { session: null, engagement: null, tab: null }
      }
    }

    const openStandaloneWindow = (opts) => {
      const options = opts && typeof opts === 'object' ? opts : {}
      const baseHref = (() => {
        try { return String(window.location.href || '').split('#')[0] } catch { return '' }
      })()
      const payload = {
        op: 'openStandaloneWindow',
        url: baseHref || undefined,
        session: options.session || undefined,
        engagement: options.engagement || undefined,
        tab: options.tab || undefined,
        locale: options.locale || (typeof getLocale === 'function' ? getLocale() : undefined),
      }
      const fallbackPopup = (targetUrl) => {
        const href = targetUrl || (baseHref ? (baseHref + '#lmtagent-full') : '#lmtagent-full')
        let win = null
        try {
          if (typeof window !== 'undefined' && typeof window.open === 'function') {
            win = window.open(href, 'lmtagent-standalone', 'popup=yes,width=1440,height=920')
          }
        } catch { win = null }
        if (win === null || win === undefined) {
          requestFullInPlace()
          return { ok: true, launched: false, mode: 'in-place-full' }
        }
        return { ok: true, launched: true, mode: 'popup', url: href }
      }
      return api(payload).then((res) => {
        if (res && res.ok && res.launched) {
          try { if (typeof setUI === 'function') setUI({ open: false }) } catch { /* ignore */ }
          return res
        }
        return fallbackPopup(res && res.url ? res.url : null)
      }).catch(() => fallbackPopup(null))
    }

    const openFullView = (opts) => openStandaloneWindow(opts)

    /* Host 递增变更序号（配合可选 sinceSeq 与 SSE /lmtagent/events 增量感知） */
    let _lastHostSeq = 0

    /**
     * 统一 RPC 桥接 `POST /lmtagent/api`：
     *   1. 防御性双参保护：若误用 `api('opName', payloadObj)`，自动合并为 `{ op: arg0, ...arg1 }`；
     *   2. 支持可选 `sinceSeq`（显式传入 `sinceSeq` 或 `withSinceSeq: true` 时附带最近序号）；
     *   3. 自动记录响应中的 `seq` 供后续增量轮询或 SSE 对齐。
     */
    const api = (req, extraPayload) => {
      let bodyObj
      if (typeof req === 'string') {
        bodyObj = Object.assign(
          { op: req },
          (extraPayload && typeof extraPayload === 'object') ? extraPayload : {}
        )
      } else if (req && typeof req === 'object') {
        bodyObj = (extraPayload && typeof extraPayload === 'object')
          ? Object.assign({}, req, extraPayload)
          : req
      } else {
        bodyObj = {}
      }
      if (bodyObj.withSinceSeq === true) {
        const cloned = Object.assign({}, bodyObj)
        delete cloned.withSinceSeq
        if (cloned.sinceSeq === undefined && _lastHostSeq > 0) {
          cloned.sinceSeq = _lastHostSeq
        }
        bodyObj = cloned
      }
      if (typeof fetch !== 'function') {
        return Promise.resolve({ ok: false, error: 'fetch unavailable' })
      }
      return fetch('/lmtagent/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyObj),
      }).then((res) => {
        if (res && typeof res.text === 'function') {
          return res.text().then((txt) => {
            if (!txt || !txt.trim()) return { ok: false, emptyResponse: true, error: t('后端服务正在就绪，请稍候点击「刷新」重试', 'Backend service is starting up; please retry with Refresh.') }
            try {
              const parsed = JSON.parse(txt)
              if (parsed && typeof parsed === 'object' && Number.isFinite(Number(parsed.seq))) {
                const s = Number(parsed.seq)
                if (s > _lastHostSeq) _lastHostSeq = s
              }
              return parsed
            } catch {
              return { ok: false, emptyResponse: true, error: t('后端响应格式异常（HTTP ' + (res.status || 0) + '）', 'Invalid backend response (HTTP ' + (res.status || 0) + ')') }
            }
          })
        }
        if (res && typeof res.json === 'function') {
          return res.json().then((parsed) => {
            if (parsed && typeof parsed === 'object' && Number.isFinite(Number(parsed.seq))) {
              const s = Number(parsed.seq)
              if (s > _lastHostSeq) _lastHostSeq = s
            }
            return parsed
          })
        }
        return { ok: false, error: t('未知响应', 'Unknown response') }
      }).catch((err) => ({
        ok: false,
        error: err && err.message ? err.message : String(err || t('网络请求异常', 'Network request failed')),
      }))
    }

    /* ── SSE `/lmtagent/events` 单例订阅总线（无轮询风暴地感知宿主/存储变更） ── */
    const _sseListeners = new Set()
    let _sseSource = null
    let _sseReconnectTimer = null

    const _notifySseListeners = (evtPayload) => {
      if (evtPayload && typeof evtPayload === 'object' && Number.isFinite(Number(evtPayload.seq))) {
        const s = Number(evtPayload.seq)
        if (s > _lastHostSeq) _lastHostSeq = s
      }
      for (const fn of Array.from(_sseListeners)) {
        try { fn(evtPayload || {}) } catch { /* 单个订阅异常不影响全局 */ }
      }
    }

    const _ensureSseConnected = () => {
      if (_sseSource || _sseListeners.size === 0) return
      const ES = (typeof EventSource === 'function')
        ? EventSource
        : (typeof window !== 'undefined' && window && typeof window.EventSource === 'function' ? window.EventSource : null)
      if (!ES) return
      try {
        const url = _lastHostSeq > 0 ? ('/lmtagent/events?sinceSeq=' + _lastHostSeq) : '/lmtagent/events'
        const src = new ES(url)
        _sseSource = src
        const handleMsg = (ev) => {
          let data = {}
          try { data = ev && ev.data ? JSON.parse(ev.data) : {} } catch { data = { raw: ev && ev.data } }
          _notifySseListeners(data)
        }
        src.onmessage = handleMsg
        if (typeof src.addEventListener === 'function') {
          src.addEventListener('change', handleMsg)
          src.addEventListener('update', handleMsg)
          src.addEventListener('dag', handleMsg)
        }
        src.onerror = () => {
          try { src.close() } catch { /* ignore */ }
          if (_sseSource === src) _sseSource = null
          if (_sseListeners.size > 0 && !_sseReconnectTimer && typeof setTimeout === 'function') {
            _sseReconnectTimer = setTimeout(() => {
              _sseReconnectTimer = null
              _ensureSseConnected()
            }, 5000)
          }
        }
      } catch {
        _sseSource = null
      }
    }

    const _teardownSseIfIdle = () => {
      if (_sseListeners.size > 0) return
      if (_sseReconnectTimer && typeof clearTimeout === 'function') {
        clearTimeout(_sseReconnectTimer)
        _sseReconnectTimer = null
      }
      if (_sseSource) {
        try { _sseSource.close() } catch { /* ignore */ }
        _sseSource = null
      }
    }

    /**
     * 订阅宿主 `/lmtagent/events` SSE 推送（带节流合并，避免高频写表触发渲染风暴）。
     * 传入 `engagement === false` 可显式禁用（如由父组件托管刷新的子画布）；在无 EventSource 环境下自动安全降级。
     */
    const subscribeHostEvents = (engagement, onRefresh, throttleMs) => {
      if (engagement === false) return () => {}
      const hasES = (typeof EventSource === 'function')
        || (typeof window !== 'undefined' && window && typeof window.EventSource === 'function')
      if (!hasES) return () => {}
      const minGap = Number(throttleMs) > 0 ? Number(throttleMs) : 600
      let lastFire = 0
      let trailingTimer = null
      const listener = (payload) => {
        if (payload && (payload.type === 'heartbeat' || payload.type === 'ping')) return
        const targetEng = payload && (payload.engagement_id || payload.engagement)
        if (targetEng && engagement && targetEng !== engagement) return
        const now = Date.now()
        const elapsed = now - lastFire
        if (elapsed >= minGap) {
          lastFire = now
          if (typeof onRefresh === 'function') onRefresh(payload)
        } else if (!trailingTimer && typeof setTimeout === 'function') {
          trailingTimer = setTimeout(() => {
            trailingTimer = null
            lastFire = Date.now()
            if (typeof onRefresh === 'function') onRefresh(payload)
          }, Math.max(120, minGap - elapsed))
        }
      }
      _sseListeners.add(listener)
      _ensureSseConnected()
      return () => {
        if (trailingTimer && typeof clearTimeout === 'function') clearTimeout(trailingTimer)
        _sseListeners.delete(listener)
        _teardownSseIfIdle()
      }
    }

    /**
     * React Hook 封装：按工作区订阅宿主 `/lmtagent/events` SSE 推送。
     */
    function useHostEvents(engagement, onRefresh, throttleMs) {
      const cbRef = React.useRef(onRefresh)
      cbRef.current = onRefresh
      const minGap = Number(throttleMs) > 0 ? Number(throttleMs) : 600

      React.useEffect(
        () => subscribeHostEvents(engagement, (payload) => {
          if (typeof cbRef.current === 'function') cbRef.current(payload)
        }, minGap),
        [engagement, minGap]
      )
    }

    /* ── 证据截图：有界 LRU 缓存（上限 64 条，切换工作区时清理）+ 点击放大 ── */
    const SHOT_CACHE_MAX = 64
    const shotCache = new Map()
    const shotLoading = new Map()
    let _shotCacheEng = null

    const clearShotCache = (nextEng) => {
      if (nextEng !== undefined) {
        if (_shotCacheEng === nextEng) return
        _shotCacheEng = nextEng
      }
      shotCache.clear()
      shotLoading.clear()
    }

    const shotCacheSet = (key, val) => {
      if (shotCache.has(key)) shotCache.delete(key)
      while (shotCache.size >= SHOT_CACHE_MAX) {
        const oldestKey = shotCache.keys().next().value
        if (oldestKey === undefined) break
        shotCache.delete(oldestKey)
      }
      shotCache.set(key, val)
    }

    const shotSrc = (eng, id) => {
      const key = eng + ':' + id
      if (!shotCache.has(key)) return null
      const val = shotCache.get(key)
      /* LRU 访问提权 */
      shotCache.delete(key)
      shotCache.set(key, val)
      return val || null
    }

    const loadShot = (eng, id) => {
      if (_shotCacheEng !== null && eng && _shotCacheEng !== eng) {
        clearShotCache(eng)
      } else if (_shotCacheEng === null && eng) {
        _shotCacheEng = eng
      }
      const key = eng + ':' + id
      if (shotCache.has(key) || shotLoading.has(key)) return
      const p = api({ op: 'shotData', engagement: eng, id: id }).then((r) => {
        shotCacheSet(key, r && r.base64 ? 'data:' + (r.mime || 'image/png') + ';base64,' + r.base64 : '')
        shotLoading.delete(key)
        for (const f of Array.from(subs)) f()
      }).catch(() => { shotLoading.delete(key) })
      shotLoading.set(key, p)
    }
    const shotKindLabel = (kind) => {
      if (kind === 'screenshot') return t('现场截图', 'Live Screenshot')
      if (kind === 'card') return t('记录生成的证据摘录', 'Generated Evidence Card')
      return kind || t('证据', 'Evidence')
    }

    /** 单张图：点一下全屏放大（固定定位，不受所在容器限制）。 */
    const ShotImage = ({ eng, shot, height }) => {
      useLocale()
      const [zoom, setZoom] = React.useState(false)
      const src = shotSrc(eng, shot.id)
      if (src === null) { loadShot(eng, shot.id) }
      const card = shot.kind === 'card'
      return h('div', { className: 'rt-shot' },
        src === null
          ? h('div', { className: 'rt-shot-thumb rt-shot-loading', style: { height: (height || 96) + 'px' } }, t('载入中…', 'Loading...'))
          : h('img', {
              className: 'rt-shot-thumb', src: src, alt: shot.label || (t('证据 ', 'Evidence ') + shot.id),
              style: { height: (height || 96) + 'px', cursor: 'zoom-in' },
              onClick: () => setZoom(true),
            }),
        h('div', { className: 'rt-shot-cap' },
          h('span', { className: 'rt-tag ' + (card ? 'rt-tag-warn' : 'rt-tag-live'), title: card
            ? t('由当日记录生成的证据摘录，不是现场截图 —— 报告里同样会标注', 'Evidence card generated from session logs (not a live screenshot)')
            : t('现场截图', 'Live Screenshot') }, shotKindLabel(shot.kind)),
          h('span', { className: 'rt-shot-label', title: shot.label || shot.note || '' },
            shot.label || shot.target || ('#' + shot.id))),
        zoom
          ? h('div', { className: 'rt-shot-zoom', onClick: () => setZoom(false) },
              h('img', { src: src, alt: shot.label || '' }),
              h('div', { className: 'rt-shot-zoom-cap' }, (shot.label || shot.target || '')
                + (card ? t('　·　由当日记录生成（非现场截图）', ' · Generated from log (not live screenshot)') : '')
                + (shot.captured_at ? '　·　' + fmt(shot.captured_at) : '')
                + t('　·　点击任意处关闭', ' · Click anywhere to close')))
          : null)
    }

    /** 一个里程碑项的证据图条：最多 3 张（超过的部分只报数，不铺开）。 */
    const ShotStrip = ({ eng, shots, total, title }) => {
      useLocale()
      const list = shots || []
      if (list.length === 0) return null
      return h('div', { className: 'rt-shots' },
        h('div', { className: 'rt-shots-head' },
          h('b', null, title || t('证据截图', 'Evidence Screenshots')),
          h('span', { className: 'rt-shots-n' }, t('显示 ' + list.length + ' 张', 'Showing ' + list.length)
            + (total && total > list.length ? t('（该项共 ' + total + ' 张，取代表图）', ' (' + total + ' total, sample)') : ''))),
        h('div', { className: 'rt-shot-row' }, list.map((sh) => h(ShotImage, { key: 'sh' + sh.id, eng: eng, shot: sh }))))
    }

    /* ── 全局 UI Store（含新手/专家视图模式持久化 `rt-ui-mode`） ────────────── */
    const UI_MODE_KEY = 'rt-ui-mode'
    const readInitialUiMode = () => {
      try {
        const saved = window.localStorage.getItem(UI_MODE_KEY)
        return saved === 'novice' ? 'novice' : 'expert'
      } catch {
        return 'expert'
      }
    }

    let ui = { open: true, tab: 'overview', uiMode: readInitialUiMode() }
    const subs = new Set()
    const setUI = (patch) => {
      if (patch && (patch.uiMode === 'novice' || patch.uiMode === 'expert')) {
        try { window.localStorage.setItem(UI_MODE_KEY, patch.uiMode) } catch { /* ignore */ }
      }
      ui = Object.assign({}, ui, patch)
      for (const f of Array.from(subs)) f()
    }
    const setUiMode = (mode) => {
      const next = mode === 'novice' ? 'novice' : 'expert'
      setUI({ uiMode: next })
    }

    /* 面板宽度 → :root 自定义属性（frame 的 padding-right 依赖它） */
    let dockWidthTag = null
    const setDockWidth = (px) => {
      if (dockWidthTag) dockWidthTag.textContent = ':root{--rt-dock-w:' + px + 'px}'
    }
    const useUI = () => {
      const [, force] = React.useReducer((x) => x + 1, 0)
      React.useEffect(() => {
        const f = () => force()
        subs.add(f)
        return () => { subs.delete(f) }
      }, [])
      return ui
    }

    /* ── 当前会话：面板跟着会话走 ────────────────────────────────────────── */
    let sessionId = null
    let sessionTitle = null
    const sessionSubs = new Set()
    const setSessionId = (id, title) => {
      const next = typeof id === 'string' && id.length > 0 ? id : null
      const nextTitle = typeof title === 'string' && title.length > 0 ? title : null
      const idChanged = next !== sessionId
      const titleChanged = nextTitle !== sessionTitle
      sessionId = next
      sessionTitle = nextTitle
      if (!idChanged && !titleChanged) return
      for (const f of Array.from(sessionSubs)) f()
    }
    const useSession = () => {
      const [, force] = React.useReducer((x) => x + 1, 0)
      React.useEffect(() => {
        const f = () => force()
        sessionSubs.add(f)
        return () => { sessionSubs.delete(f) }
      }, [])
      return { id: sessionId, title: sessionTitle }
    }

    const FOLLOW_SOURCE = {
      bound: '落盘绑定',
      title: '会话标题',
      last: '上次选择',
      default: '默认单位',
      unbound: '待初始化',
      skipped: '已跳过指引',
    }
    const FOLLOW_SOURCE_EN = {
      bound: 'Bound',
      title: 'Session Title',
      last: 'Last Picked',
      default: 'Default',
      unbound: 'Pending Init',
      skipped: 'Guide Skipped',
    }
    const followSourceLabel = (src) => (
      getLocale() === 'en-US'
        ? (FOLLOW_SOURCE_EN[src] || FOLLOW_SOURCE[src] || src || '')
        : (FOLLOW_SOURCE[src] || src || '')
    )

    const sessionIdOf = (props) => (props && typeof props.sessionId === 'string' && props.sessionId ? props.sessionId : null)
    const sessionTitleOf = (props) => {
      const useSessions = props && props.useSessions
      if (typeof useSessions !== 'function') return null
      try {
        const st = useSessions((s) => s)
        const row = st && st.byId && props.sessionId ? st.byId[props.sessionId] : null
        const title = row && typeof row.displayTitle === 'string' && row.displayTitle ? row.displayTitle : null
        return title && title !== props.sessionId ? title : null
      } catch (e) { return null }
    }

    const sessionMetaOf = (props) => {
      const id = sessionIdOf(props)
      const useSessions = props && props.useSessions
      let row = null
      if (typeof useSessions === 'function') {
        try {
          const st = useSessions((s) => s)
          row = st && st.byId && id ? st.byId[id] : null
        } catch (e) { row = null }
      }
      const rawTitle = row && typeof row.displayTitle === 'string' && row.displayTitle
        ? row.displayTitle
        : (row && typeof row.title === 'string' && row.title ? row.title : null)
      const title = rawTitle && rawTitle !== id ? rawTitle : null
      const cwd = (row && (row.cwd || row.workspace || (row.header && row.header.cwd))) || null
      const blank = Boolean(row && row.blank)
      const hasConversation = (row && typeof row.blank === 'boolean')
        ? !row.blank
        : (row && Array.isArray(row.messages)
          ? row.messages.length > 0
          : (Number((row && (row.turnCount || row.turns)) || 0) > 0 ? true : undefined))
      return {
        id: id,
        title: title,
        cwd: cwd,
        blank: blank,
        hasConversation: hasConversation,
      }
    }

    function useScopedSession(props, embedMode) {
      const globalSess = useSession()
      const propSid = sessionIdOf(props)
      const meta = sessionMetaOf(props)
      const isScoped = Boolean((embedMode === 'session' || propSid) && propSid)
      const resolvedTitle = meta.title || (globalSess.id === propSid ? globalSess.title : null)

      React.useEffect(() => {
        if (isScoped && propSid) {
          setSessionId(propSid, meta.title || (globalSess.id === propSid ? globalSess.title : null))
        }
      }, [isScoped, propSid, meta.title])

      if (isScoped) {
        return {
          id: propSid,
          title: resolvedTitle,
          cwd: meta.cwd,
          hasConversation: meta.hasConversation,
          authoritative: true,
        }
      }
      return {
        id: globalSess.id,
        title: globalSess.title,
        cwd: null,
        hasConversation: undefined,
        authoritative: false,
      }
    }

    /* 工程模式库归类（与 core.js 的 POC_CATEGORIES 一致；面板按它分组） */
    const POC_CAT_NAME = {
      rce: '核心计算引擎与业务算法', sqli: '数据模型与持久化查询规范', deserialization: '跨端协议与数据序列化契约',
      'file-upload': '静态资源与文件处理流水线', 'auth-bypass': '鉴权策略与开放平台契约', unauthorized: '公开接口与免鉴权数据源',
      'weak-password': '环境配置与密钥防呆基线', ssrf: '服务端代理与跨域网关适配', xxe: '结构化文档与配置解析器',
      'path-traversal': '文件系统边界与路径校验', 'info-leak': '数据脱敏与隐私合规防护', privesc: '并发调度与权限分层模型',
      tunnel: '跨进程通信与联调网关桥接', other: '通用工程模式与组件复刻模板',
    }
    const POC_CAT_NAME_EN = {
      rce: 'Core Compute & Business Algorithms', sqli: 'Data Models & Persistence Queries', deserialization: 'Cross-End Serialization Contracts',
      'file-upload': 'Static Assets & File Pipelines', 'auth-bypass': 'Auth Policies & Open Platform Contracts', unauthorized: 'Public APIs & Unauthenticated Sources',
      'weak-password': 'Env Config & Secret Guardrails', ssrf: 'Server Proxies & CORS Gateways', xxe: 'Structured Docs & Config Parsers',
      'path-traversal': 'Filesystem Boundaries & Path Checks', 'info-leak': 'Data Masking & Privacy Compliance', privesc: 'Concurrency Scheduling & RBAC Models',
      tunnel: 'IPC & Debug Tunnel Bridges', other: 'General Patterns & Component Templates',
    }
    const pocCatLabel = (code) => (
      getLocale() === 'en-US'
        ? (POC_CAT_NAME_EN[code] || POC_CAT_NAME[code] || code)
        : (POC_CAT_NAME[code] || code)
    )
    const POC_CAT_ORDER = Object.keys(POC_CAT_NAME)
    const ROLE_LABEL = {
      plan: '主控指挥（Captain）',
      recon: '产品与需求规划（CEO）',
      designer: '交互与视觉设计（Designer）',
      assess: '系统架构与排期（Eng Manager）',
      'vuln-scan': '代码审查与安全（Reviewer & CSO）',
      exploit: '全栈研发与构建（Builder）',
      qa: '质量保障与测试（QA Lead）',
      internal: '文档工程与发布（Doc & Release）',
    }
    const ROLE_LABEL_EN = {
      plan: 'Captain (Orchestrator)',
      recon: 'Product & Planning (CEO)',
      designer: 'UI & Visual Design (Designer)',
      assess: 'Architecture & Sharding (Eng Manager)',
      'vuln-scan': 'Code Review & Security (Reviewer & CSO)',
      exploit: 'Full-Stack Build (Builder)',
      qa: 'QA & Verification (QA Lead)',
      internal: 'Docs & Release (Doc & Release)',
    }
    const roleLabel = (role) => (
      getLocale() === 'en-US'
        ? (ROLE_LABEL_EN[role] || ROLE_LABEL[role] || role)
        : (ROLE_LABEL[role] || role)
    )

    const fmt = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '—')
    const fmtShort = (s) => {
      const tStr = String(s || '').replace('T', ' ')
      return tStr.length >= 16 ? tStr.slice(5, 16) : (tStr || '—')
    }
    const provLabel = (p) => (p === 'passive' ? t('被动', 'Passive') : p === 'active' ? t('主动', 'Active') : t('未知', 'Unknown'))

    /**
     * 给「可点击但不是 <button>」的元素补上键盘可达性。
     */
    const clickable = (onActivate, options = {}) => {
      const props = {
        role: 'button',
        tabIndex: 0,
        onClick: onActivate,
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onActivate(e)
          }
        },
      }
      if (options.label !== undefined) props['aria-label'] = String(options.label)
      if (options.expanded !== undefined) props['aria-expanded'] = options.expanded ? 'true' : 'false'
      return props
    }

    const copyText = async (text) => {
      const value = text === undefined || text === null ? '' : String(text)
      if (value === '') return false
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(value)
          return true
        }
      } catch (e) { /* 落到兜底方案 */ }
      try {
        const ta = document.createElement('textarea')
        ta.value = value
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        const okFlag = document.execCommand('copy')
        document.body.removeChild(ta)
        return okFlag === true
      } catch (e) { return false }
    }

    const copyWithFeedback = async (text, label, onResult) => {
      const okFlag = await copyText(text)
      const message = okFlag
        ? t('已复制：' + label, 'Copied: ' + label)
        : t('复制失败（浏览器未授权剪贴板）—— 请手动选中文本复制', 'Copy failed (clipboard permission denied) — please copy manually')
      if (typeof onResult === 'function') onResult(okFlag, message)
      return okFlag
    }

    function ProvTag(props) {
      useLocale()
      if (!props.p) return h('span', { className: 'rt-tag' }, t('未知', 'Unknown'))
      return h('span', { className: 'rt-tag rt-tag-' + props.p }, provLabel(props.p))
    }

    const TEST_LABEL = { untested: '待验证', testing: '验证中', tested: '已验证', blocked: '受阻', abandoned: '已跳过', no_surface: '无需验证' }
    const TEST_LABEL_EN = { untested: 'Untested', testing: 'Testing', tested: 'Verified', blocked: 'Blocked', abandoned: 'Skipped', no_surface: 'No Surface' }
    const testLabel = (st) => (getLocale() === 'en-US' ? (TEST_LABEL_EN[st] || TEST_LABEL[st] || st) : (TEST_LABEL[st] || st))

    const PRI_LABEL = { high: '高', medium: '中', low: '低' }
    const PRI_LABEL_EN = { high: 'High', medium: 'Med', low: 'Low' }
    const priLabel = (p) => (getLocale() === 'en-US' ? (PRI_LABEL_EN[p] || PRI_LABEL[p] || p) : (PRI_LABEL[p] || p))

    function PriTag(props) {
      useLocale()
      if (!props.p) return h('span', { className: 'rt-tag' }, t('未评', 'Unrated'))
      return h('span', { className: 'rt-pri rt-pri-' + props.p, title: props.title || '' }, priLabel(props.p))
    }

    function TestTag(props) {
      useLocale()
      const st = props.s || 'untested'
      return h('span', { className: 'rt-test rt-test-' + st }, testLabel(st))
    }

    const PENDING_APPROVAL_STATES = new Set([
      'pending_approval',
      'waiting_approval',
      'revision_required',
      'blocked',
    ])

    const ConclItem = (key, label, value, active, onClick) => h('span', Object.assign({
      key: key,
      className: 'rt-concl-i' + (active ? ' on' : ''),
      style: onClick ? undefined : { cursor: 'default' },
      title: onClick ? t('点击筛选 / 再点取消', 'Click to filter / click again to clear') : undefined,
    }, onClick ? clickable(onClick, { label: t('按「' + label + '」筛选（' + (value || 0) + '）', 'Filter by "' + label + '" (' + (value || 0) + ')'), expanded: active }) : {}),
      h('b', null, String(value || 0)), h('span', null, label))

    const isRealHostSessionId = (sid, hostSessionList) => {
      const s = String(sid || '').trim()
      if (!s || s === 'root' || s === 'root-main' || s === 'default') return false
      if (/^(?:sub-|agent-|dom-|task-|wish-|custom-|goal-)/i.test(s)) return false
      if (/^session-(?:plan|recon|designer|assess|exploit|qa|vuln-scan|internal)$/i.test(s)) return false
      if (Array.isArray(hostSessionList) && hostSessionList.length > 0) {
        for (let i = 0; i < hostSessionList.length; i += 1) {
          const hs = hostSessionList[i]
          if (!hs) continue
          if (hs.id === s || hs.sessionId === s) return true
          if (Array.isArray(hs.children) && hs.children.some((ch) => ch && (ch.id === s || ch.sessionId === s))) {
            return true
          }
        }
      }
      return /^(?:session-)?[0-9a-f]{8}-[0-9a-f]{4}/i.test(s) || (!s.startsWith('w') && s.length >= 12)
    }

    /**
     * 共享宿主侧边栏对话跳转辅助函数（供「协同与审批」与「集群」工作流检视器共用）。
     */
    const openAgentSessionInHostChat = (agent, opts) => {
      const options = opts || {}
      const hostSessions = options.hostSessions
      const candidateSid = (agent && (agent.sessionId || agent.session_id || agent.id)) || ''
      const primarySid = options.sessionId !== undefined ? options.sessionId : sessionId
      const fallbackRealSid = isRealHostSessionId(primarySid, hostSessions)
        ? primarySid
        : (isRealHostSessionId(options.fallbackSessionId, hostSessions) ? options.fallbackSessionId : '')
      const targetSid = isRealHostSessionId(candidateSid, hostSessions) ? candidateSid : fallbackRealSid
      const targetTitle = (agent && (agent.title || agent.name)) || options.sessionTitle || sessionTitle || targetSid || t('当前会话', 'Current Session')

      if (targetSid) {
        setSessionId(targetSid, targetTitle)
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem('dsh.sessions.current', targetSid)
          }
        } catch (e) { /* ignore */ }
      }

      api({
        op: 'activateAgentSession',
        sessionId: targetSid || candidateSid || undefined,
        agentId: agent && (agent.id || agent.worker_id),
        engagement: options.engagement || undefined,
      }).catch(() => {})

      try {
        if (targetSid && typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
          const candidates = document.querySelectorAll(
            '[data-session-id],[data-id],a[href*="session"],[role="treeitem"],[role="option"],li'
          )
          const normTitle = String(targetTitle || '').trim().toLowerCase()
          for (let i = 0; i < candidates.length; i += 1) {
            const el = candidates[i]
            if (!el || typeof el.click !== 'function') continue
            if (typeof el.closest === 'function' && el.closest('.rt-dock, .rt-full, .rt-embed')) continue
            const dsId = (typeof el.getAttribute === 'function')
              ? (el.getAttribute('data-session-id') || el.getAttribute('data-id') || el.getAttribute('href') || '')
              : ''
            const txt = String(el.textContent || '').trim().toLowerCase()
            if (
              (dsId && dsId.includes(targetSid)) ||
              (txt && txt.includes(String(targetSid).toLowerCase())) ||
              (normTitle && txt && (txt === normTitle || txt.includes(normTitle)))
            ) {
              el.click()
              break
            }
          }
        }
      } catch (e) { /* ignore */ }

      exitFullInPlace()
      return { targetSid, targetTitle }
    }

    /* ── 共享折叠底座与文本折叠剪贴框（供各工程页签统一复用） ─────────────── */
    const COLLAPSE_KEY = 'rt-collapse:'
    const collapseLoad = (prefix) => {
      try {
        const raw = window.localStorage.getItem(COLLAPSE_KEY + prefix)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch (e) { return {} }
    }
    const collapseSave = (prefix, value) => {
      try { window.localStorage.setItem(COLLAPSE_KEY + prefix, JSON.stringify(value)) } catch (e) { /* ignore */ }
    }

    function useCollapse(prefix) {
      const [state, setState] = React.useState(() => collapseLoad(prefix))
      React.useEffect(() => { setState(collapseLoad(prefix)) }, [prefix])
      const write = (next) => { collapseSave(prefix, next); setState(next) }
      const isOpen = (key, defaultOpen) => {
        const v = state[key]
        return v === undefined ? defaultOpen !== false : v === true
      }
      const toggle = (key, defaultOpen) => (e) => {
        if (e && e.stopPropagation) e.stopPropagation()
        write(Object.assign({}, state, { [key]: !isOpen(key, defaultOpen) }))
      }
      const setAll = (keys, open) => {
        const next = Object.assign({}, state)
        for (const k of keys) next[k] = open
        write(next)
      }
      return { isOpen: isOpen, toggle: toggle, setAll: setAll }
    }

    function Section(props) {
      const always = props.always === true
      const open = always || props.open === true
      const head = h('div', {
        className: 'rt-sec t-' + (props.tone || 'target') + (always ? ' flat' : ''),
        role: always ? undefined : 'button',
        tabIndex: always ? undefined : 0,
        'aria-expanded': always ? undefined : (open ? 'true' : 'false'),
        onClick: always ? undefined : props.onToggle,
        onKeyDown: always ? undefined : (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (props.onToggle) props.onToggle(e) }
        },
      },
        h('span', { className: 'rt-sec-caret' }, always ? '▍' : (open ? '▾' : '▸')),
        props.title ? h('span', { className: 'rt-sec-title' }, props.title) : null,
        props.count !== undefined && props.count !== null ? h('span', { className: 'rt-sec-count' }, String(props.count)) : null,
        props.sub ? h('span', { className: 'rt-sec-sub' }, props.sub) : null,
        props.right ? h('span', { className: 'rt-sec-right' }, props.right) : null)
      return h('div', { className: 'rt-sec-wrap' }, head,
        open && props.children ? h('div', { className: 'rt-sec-body' }, props.children) : null)
    }

    function Clip(props) {
      useLocale()
      const [open, setOpen] = React.useState(false)
      const text = String(props.text === undefined || props.text === null ? '' : props.text)
      if (text.trim() === '') return null
      return h('div', { className: 'rt-clip' + (open ? ' open' : '') },
        h('div', { className: 'rt-clip-head' },
          props.label ? h('span', { className: 'rt-clip-label' }, props.label) : null,
          h('div', { className: 'rt-spacer' }),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: (e) => { e.stopPropagation(); copyText(text) },
          }, t('复制', 'Copy')),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: (e) => { e.stopPropagation(); setOpen((v) => !v) },
          }, open ? t('收起', 'Collapse') : t('展开', 'Expand'))),
        h('div', { className: 'rt-clip-body' }, text))
    }
