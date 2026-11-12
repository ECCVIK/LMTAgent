    /* ---------------------------------------------------------- 01-core-rpc：桥接、事件流与全局状态 */
    /** 是否在「全面浏览」独立窗口里（URL hash 标记，复用同一套界面代码）。 */
    const isFullWindow = () => {
      try { return String(window.location.hash || '') === '#redteam-full' } catch { return false }
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
    const openFullView = () => {
      if (isDesktopShell()) { requestFullInPlace(); return }
      let win = null
      try { win = window.open(window.location.href.split('#')[0] + '#redteam-full', '_blank') } catch { win = null }
      if (win === null || win === undefined) requestFullInPlace()
    }

    /* Host 递增变更序号（配合可选 sinceSeq 与 SSE /redteam/events 增量感知） */
    let _lastHostSeq = 0
    const getLastHostSeq = () => _lastHostSeq

    /**
     * 统一 RPC 桥接 `POST /redteam/api`：
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
      return fetch('/redteam/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyObj),
      }).then((res) => {
        if (res && typeof res.text === 'function') {
          return res.text().then((txt) => {
            if (!txt || !txt.trim()) return { ok: false, emptyResponse: true, error: '后端服务正在就绪，请稍候点击「刷新」重试' }
            try {
              const parsed = JSON.parse(txt)
              if (parsed && typeof parsed === 'object' && Number.isFinite(Number(parsed.seq))) {
                const s = Number(parsed.seq)
                if (s > _lastHostSeq) _lastHostSeq = s
              }
              return parsed
            } catch {
              return { ok: false, emptyResponse: true, error: '后端响应格式异常（HTTP ' + (res.status || 0) + '）' }
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
        return { ok: false, error: '未知响应' }
      }).catch((err) => ({
        ok: false,
        error: err && err.message ? err.message : String(err || '网络请求异常'),
      }))
    }

    /* ── SSE `/redteam/events` 单例订阅总线（无轮询风暴地感知宿主/存储变更） ── */
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
        const url = _lastHostSeq > 0 ? ('/redteam/events?sinceSeq=' + _lastHostSeq) : '/redteam/events'
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
     * 监听宿主 `/redteam/events` SSE 推送（带节流合并，避免高频写表触发渲染风暴）。
     * 在没有 EventSource 的环境（如 Node 测试桩）下自动安全降级为空操作。
     */
    function useHostEvents(engagement, onRefresh, throttleMs) {
      const cbRef = React.useRef(onRefresh)
      cbRef.current = onRefresh
      const engRef = React.useRef(engagement)
      engRef.current = engagement
      const minGap = Number(throttleMs) > 0 ? Number(throttleMs) : 600

      React.useEffect(() => {
        const hasES = (typeof EventSource === 'function')
          || (typeof window !== 'undefined' && window && typeof window.EventSource === 'function')
        if (!hasES) return undefined
        let lastFire = 0
        let trailingTimer = null
        const listener = (payload) => {
          if (payload && (payload.type === 'heartbeat' || payload.type === 'ping')) return
          const targetEng = payload && (payload.engagement_id || payload.engagement)
          if (targetEng && engRef.current && targetEng !== engRef.current) return
          const now = Date.now()
          const elapsed = now - lastFire
          if (elapsed >= minGap) {
            lastFire = now
            if (typeof cbRef.current === 'function') cbRef.current(payload)
          } else if (!trailingTimer && typeof setTimeout === 'function') {
            trailingTimer = setTimeout(() => {
              trailingTimer = null
              lastFire = Date.now()
              if (typeof cbRef.current === 'function') cbRef.current(payload)
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
      }, [engagement, minGap])
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
    const SHOT_KIND = { screenshot: '现场截图', card: '记录生成的证据摘录' }

    /** 单张图：点一下全屏放大（固定定位，不受所在容器限制）。 */
    const ShotImage = ({ eng, shot, height }) => {
      const [zoom, setZoom] = React.useState(false)
      const src = shotSrc(eng, shot.id)
      if (src === null) { loadShot(eng, shot.id) }
      const card = shot.kind === 'card'
      return h('div', { className: 'rt-shot' },
        src === null
          ? h('div', { className: 'rt-shot-thumb rt-shot-loading', style: { height: (height || 96) + 'px' } }, '载入中…')
          : h('img', {
              className: 'rt-shot-thumb', src: src, alt: shot.label || ('证据 ' + shot.id),
              style: { height: (height || 96) + 'px', cursor: 'zoom-in' },
              onClick: () => setZoom(true),
            }),
        h('div', { className: 'rt-shot-cap' },
          h('span', { className: 'rt-tag ' + (card ? 'rt-tag-warn' : 'rt-tag-live'), title: card
            ? '由当日记录生成的证据摘录，不是现场截图 —— 报告里同样会标注'
            : '现场截图' }, SHOT_KIND[shot.kind] || shot.kind || '证据'),
          h('span', { className: 'rt-shot-label', title: shot.label || shot.note || '' },
            shot.label || shot.target || ('#' + shot.id))),
        zoom
          ? h('div', { className: 'rt-shot-zoom', onClick: () => setZoom(false) },
              h('img', { src: src, alt: shot.label || '' }),
              h('div', { className: 'rt-shot-zoom-cap' }, (shot.label || shot.target || '')
                + (card ? '　·　由当日记录生成（非现场截图）' : '')
                + (shot.captured_at ? '　·　' + fmt(shot.captured_at) : '')
                + '　·　点击任意处关闭'))
          : null)
    }

    /** 一个里程碑项的证据图条：最多 3 张（超过的部分只报数，不铺开）。 */
    const ShotStrip = ({ eng, shots, total, title }) => {
      const list = shots || []
      if (list.length === 0) return null
      return h('div', { className: 'rt-shots' },
        h('div', { className: 'rt-shots-head' },
          h('b', null, title || '证据截图'),
          h('span', { className: 'rt-shots-n' }, '显示 ' + list.length + ' 张'
            + (total && total > list.length ? '（该项共 ' + total + ' 张，取代表图）' : ''))),
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

    const LAST_ENG_KEY = 'rt-last-engagement'
    const lastEngagement = () => {
      try { return window.localStorage.getItem(LAST_ENG_KEY) || null } catch (e) { return null }
    }
    const rememberEngagement = (id) => {
      try { if (id) window.localStorage.setItem(LAST_ENG_KEY, id) } catch (e) { /* 隐私模式：不记也能用 */ }
    }

    const FOLLOW_SOURCE = {
      bound: '落盘绑定',
      title: '会话标题',
      last: '上次选择',
      default: '默认单位',
      unbound: '待初始化',
      skipped: '已跳过指引',
    }

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

    const fmt = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '—')
    const fmtShort = (s) => {
      const t = String(s || '').replace('T', ' ')
      return t.length >= 16 ? t.slice(5, 16) : (t || '—')
    }
    const provLabel = (p) => (p === 'passive' ? '被动' : p === 'active' ? '主动' : '未知')

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
      const message = okFlag ? '已复制：' + label : '复制失败（浏览器未授权剪贴板）—— 请手动选中文本复制'
      if (typeof onResult === 'function') onResult(okFlag, message)
      return okFlag
    }

    function ProvTag(props) {
      if (!props.p) return h('span', { className: 'rt-tag' }, '未知')
      return h('span', { className: 'rt-tag rt-tag-' + props.p }, provLabel(props.p))
    }

    const TEST_LABEL = { untested: '待验证', testing: '验证中', tested: '已验证', blocked: '受阻', abandoned: '已跳过', no_surface: '无需验证' }
    const PRI_LABEL = { high: '高', medium: '中', low: '低' }

    function PriTag(props) {
      if (!props.p) return h('span', { className: 'rt-tag' }, '未评')
      return h('span', { className: 'rt-pri rt-pri-' + props.p, title: props.title || '' }, PRI_LABEL[props.p] || props.p)
    }

    function TestTag(props) {
      const st = props.s || 'untested'
      return h('span', { className: 'rt-test rt-test-' + st }, TEST_LABEL[st] || st)
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
          }, '复制'),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: (e) => { e.stopPropagation(); setOpen((v) => !v) },
          }, open ? '收起' : '展开')),
        h('div', { className: 'rt-clip-body' }, text))
    }
