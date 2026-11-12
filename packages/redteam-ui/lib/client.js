/**
 * RedTeam 控制台 —— 浏览器半侧（模块化源码 · 00-header）
 *
 * 格式与外壳的模块加载器一致：window.__ModuleLoader__.load({ id, factory })。
 * id 必须等于包名（clientModules 以 manifest 包名作为浏览器模块身份）。
 * 基座外无依赖：只用平台 seed 里的 react 与 ctx.slots。
 */
window.__ModuleLoader__.load({
  id: 'dsh-redteam-ui',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const rawH = React.createElement

    /* ── Markdown 展示 ────────────────────────────────────────────────────────
       面板里的提示文案、技能正文、模型回报/证据等大量文本本身是 Markdown。
       以前直接当纯文本塞进 React，用户会看到 `**粗体**`、`` `命令` ``、`## 标题`
       这些标记符号。这里做一层**安全**的轻量渲染：只生成 React 元素，绝不拼 HTML，
       因此模型/用户内容里的 `<script>` 只会按文本显示。
       行内规则：`**粗体**`、`` `行内代码` ``；块规则：标题、列表、表格、引用、
       围栏代码块、分隔线、段落。单个 `*`（通配符/乘法/证书 SAN）保持原样，避免误伤。 */

    /** 行内 Markdown → React 节点（不处理 HTML）。 */
    const renderInline = (text, depth) => {
      if (typeof text !== 'string' || text === '') return text
      if (text.indexOf('**') < 0 && text.indexOf('`') < 0) return text
      const level = depth || 0
      if (level > 4) return text
      const re = /(`[^`\n]+`|\*\*[^\n]+?\*\*)/g
      const out = []
      let last = 0
      let m
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index))
        const token = m[0]
        if (token.charCodeAt(0) === 96) {
          out.push(rawH('code', { key: 'c' + m.index, className: 'rt-inline-code' }, token.slice(1, -1)))
        } else {
          /* 技术文本里的 /** 与 **\/ 很常见（URL 通配、glob、脱敏星号），
             不要把它们误判成 Markdown 粗体。真正的粗体两侧不会紧贴路径分隔符。 */
          const before = m.index > 0 ? text[m.index - 1] : ''
          const after = m.index + token.length < text.length ? text[m.index + token.length] : ''
          const inner = token.slice(2, -2)
          if (/[\\/]/.test(before) || /[\\/]/.test(after)
            || inner.startsWith('/') || inner.endsWith('/')
            || before === '*' || after === '*' || /^[/*\s]+$/.test(inner)) {
            out.push(token)
          } else {
            out.push(rawH('strong', { key: 'b' + m.index }, renderInline(inner, level + 1)))
          }
        }
        last = m.index + token.length
      }
      if (out.length === 0) return text
      if (last < text.length) out.push(text.slice(last))
      return rawH(React.Fragment, null, ...out)
    }

    /* 这些容器里是代码/原始报文，必须逐字显示，不能把 `*` 当 Markdown。 */
    const MD_RAW_TAGS = new Set(['pre', 'code', 'textarea', 'option', 'script', 'style'])
    const MD_RAW_CLASS = /(?:^|\s)(?:rt-mono|rt-rep-http|rt-atest-notes|rt-textarea)(?:\s|$)/

    /**
     * 包一层 createElement：字符串子节点统一走行内 Markdown。
     * 这样不用逐个改几十处 `h('div', null, x.note)`，动态字段（模型写的回报、
     * 缺陷备注、技能描述、验证记录）也会一起生效。props 里的 title/value 不动。
     */
    const h = (type, props, ...children) => {
      if (children.length > 0
        && (typeof type !== 'string' || !MD_RAW_TAGS.has(type))
        && !(props && typeof props.className === 'string' && MD_RAW_CLASS.test(props.className))) {
        let changed = false
        const mapped = children.map((child) => {
          if (typeof child !== 'string') return child
          const rich = renderInline(child)
          if (rich !== child) changed = true
          return rich
        })
        if (changed) children = mapped
      }
      return rawH(type, props, ...children)
    }

    /** 敏感值默认掩码：口令/密钥不在首屏直显，点击才展开；复制仍走原值。 */
    function SecretText(props) {
      const value = String(props.value === undefined || props.value === null ? '' : props.value)
      const [shown, setShown] = React.useState(false)
      if (value === '') return h('span', { className: 'rt-secret-none' }, props.empty || '未记录')
      return h('span', {
        className: props.className || 'rt-mono',
        style: { display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' },
      },
        h('span', { style: { wordBreak: 'break-all' } }, shown ? value : '••••••••'),
        h('button', {
          className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
          onClick: (e) => { e.stopPropagation(); setShown((v) => !v) },
        }, shown ? '隐藏' : '显示'))
    }

    const splitTableRow = (line) => {
      const s = line.trim().replace(/^\|/, '').replace(/\|$/, '')
      const cells = []
      let cur = ''
      for (let i = 0; i < s.length; i += 1) {
        const ch = s[i]
        if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i += 1; continue }
        if (ch === '|') { cells.push(cur.trim()); cur = ''; continue }
        cur += ch
      }
      cells.push(cur.trim())
      return cells
    }

    const isTableSep = (line) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)

    /**
     * 块级 Markdown 渲染（技能正文、Markdown 构建文档）。
     * 支持标题 / 段落 / 有序无序列表 / 表格 / 引用 / 围栏代码 / 分隔线。
     */
    function Markdown(props) {
      const text = String(props.text === undefined || props.text === null ? '' : props.text)
      const lines = text.replace(/\r\n?/g, '\n').split('\n')
      const out = []
      let i = 0
      let key = 0
      while (i < lines.length) {
        const line = lines[i]
        if (line.trim() === '') { i += 1; continue }

        /* 围栏代码：内部原样显示，不做行内解析 */
        const fence = /^\s*```\s*([\w.+-]*)\s*$/.exec(line)
        if (fence !== null) {
          const body = []
          i += 1
          while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1 }
          if (i < lines.length) i += 1
          out.push(rawH('pre', { key: 'f' + key++, className: 'rt-md-code' },
            rawH('code', fence[1] ? { 'data-lang': fence[1] } : null, body.join('\n'))))
          continue
        }

        /* 标题：`#` 在面板里也用 h2 起步，避免一个技能标题把版面撑爆 */
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading !== null) {
          out.push(rawH('h' + Math.min(heading[1].length + 1, 6), { key: 'h' + key++ },
            renderInline(heading[2])))
          i += 1
          continue
        }

        if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
          out.push(rawH('hr', { key: 'r' + key++ }))
          i += 1
          continue
        }

        /* 引用：内部继续按 Markdown 渲染 */
        if (/^\s*>\s?/.test(line)) {
          const body = []
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
            body.push(lines[i].replace(/^\s*>\s?/, ''))
            i += 1
          }
          out.push(rawH('blockquote', { key: 'q' + key++ },
            rawH(Markdown, { text: body.join('\n') })))
          continue
        }

        /* 表格：表头 + 分隔行 + 数据行 */
        if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
          const head = splitTableRow(line)
          i += 2
          const rows = []
          while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') >= 0) {
            rows.push(splitTableRow(lines[i]))
            i += 1
          }
          out.push(rawH('table', { key: 't' + key++ },
            rawH('thead', null, rawH('tr', null,
              head.map((cell, ci) => rawH('th', { key: 'th' + ci }, renderInline(cell))))),
            rawH('tbody', null, rows.map((row, ri) => rawH('tr', { key: 'tr' + ri },
              head.map((_, ci) => rawH('td', { key: 'td' + ci }, renderInline(row[ci] || ''))))))))
          continue
        }

        /* 列表：简单列表；缩进子项按同级展示，不丢内容 */
        const list = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
        if (list !== null) {
          const ordered = /^\d/.test(list[1])
          const items = []
          while (i < lines.length) {
            const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
            if (item === null) break
            let body = item[2]
            i += 1
            while (i < lines.length && lines[i].trim() !== ''
              && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])
              && !/^\s*```/.test(lines[i])
              && !/^(#{1,6})\s+/.test(lines[i])) {
              body += '\n' + lines[i].trim()
              i += 1
            }
            items.push(rawH('li', { key: 'li' + key++ }, renderInline(body)))
          }
          out.push(rawH(ordered ? 'ol' : 'ul', { key: 'l' + key++ }, items))
          continue
        }

        /* 段落：遇到空行或下一个块级结构结束；保留换行（CSS white-space: pre-wrap） */
        const para = [line]
        i += 1
        while (i < lines.length && lines[i].trim() !== ''
          && !/^\s*```/.test(lines[i])
          && !/^(#{1,6})\s+/.test(lines[i])
          && !/^\s*>\s?/.test(lines[i])
          && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])
          && !/^\s*(?:---|\*\*\*|___)\s*$/.test(lines[i])
          && !(lines[i].indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
          para.push(lines[i])
          i += 1
        }
        out.push(rawH('p', { key: 'p' + key++ }, renderInline(para.join('\n'))))
      }
      return rawH('div', { className: props.className || 'rt-markdown', style: props.style }, out)
    }

    /**
     * 把"名字"压成可比较的形态：只留字母/数字/汉字，并解掉 DSH 的路径转义。
     */
    const squashName = (value) => String(value || '')
      .replace(/~([0-9a-fA-F]{4})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/[^0-9a-zA-Z\u4e00-\u9fff]+/g, '')
      .toLowerCase()

    /**
     * 会话标题里出现的工作区 id（不依赖绑定表的兜底）。
     * 命中多个时取**名字最长**的。
     */
    const engagementByTitle = (title, list) => {
      const hay = squashName(title)
      if (hay.length < 3) return null
      const hits = (list || [])
        .map((x) => ({ x: x, key: squashName(x.name || x.id) }))
        .filter((h) => h.key.length >= 3 && (hay.includes(h.key) || h.key.includes(hay)))
        .sort((a, b) => b.key.length - a.key.length)
      return hits.length ? hits[0].x.id : null
    }

    /* 样式表在 ./styles.js（唯一维护点）。浏览器半侧不能运行期 import，
       这里放占位符，由 bundle 的 build.mjs 在生成产物时替换成正文。 */
    const CSS = '__RT_STYLES__'

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

    /* ---------------------------------------------------------- 02-telemetry-probe：环形图、DOM 遥测与 PG 写表探针 */
    /**
     * p4 多段式 SVG 环形图（Token 统计 / 耗时与并发吞吐统计共用）。
     */
    function SvgDonutGauge(props) {
      const segments = props.segments || []
      const r = 44
      const c = 2 * Math.PI * r
      let acc = 0
      const circles = segments.map((seg, idx) => {
        const pct = Math.max(0, Math.min(100, Number(seg.pct) || 0))
        const len = (pct / 100) * c
        const offset = -acc
        acc += len
        return h('circle', {
          key: 'seg' + idx,
          cx: '60', cy: '60', r: String(r),
          fill: 'none',
          stroke: seg.color || '#4d6bfe',
          strokeWidth: '13',
          strokeDasharray: len.toFixed(2) + ' ' + c.toFixed(2),
          strokeDashoffset: offset.toFixed(2),
          strokeLinecap: 'butt',
        })
      })
      return h('div', { className: 'rt-p4-donut-wrap' },
        h('svg', { className: 'rt-p4-donut-svg', viewBox: '0 0 120 120', 'aria-label': props.title || '环形统计图' },
          h('circle', { cx: '60', cy: '60', r: String(r), fill: 'none', stroke: 'var(--dsw-alias-border-l1)', strokeWidth: '13' }),
          circles),
        h('div', { className: 'rt-p4-donut-center' },
          h('div', { className: 'rt-p4-donut-val' }, props.centerValue || '—'),
          h('div', { className: 'rt-p4-donut-sub' }, props.centerSub || '')))
    }

    /** 解析类似 "354k" / "5.4M" / "43.9k" 的 Token 缩写为数值 */
    const parseTokNum = (raw) => {
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
      const m = /([\d.]+)\s*([kKmM]?)/.exec(String(raw || '').trim())
      if (!m) return 0
      const num = parseFloat(m[1]) || 0
      const unit = (m[2] || '').toLowerCase()
      const mult = unit === 'm' ? 1000000 : (unit === 'k' ? 1000 : 1)
      return Math.round(num * mult)
    }

    /** 格式化 Token 数值为紧凑标签 */
    const fmtTokNum = (n) => {
      const val = Number(n) || 0
      if (val >= 1000000) return (val / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M'
      if (val >= 1000) return (val / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
      return String(Math.round(val))
    }

    /** 判断工作区/会话名是否为自动生成的裸 session-uuid 占位名 */
    const isRawUuidName = (s) => {
      const str = String(s || '').trim()
      if (!str) return false
      return /^(?:[a-z0-9_-]+\s*[·-]\s*)?session-[0-9a-f]{8}-[0-9a-f]{4}/i.test(str)
        || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(str)
    }

    /**
     * 浅比较两次宿主 DOM 遥测快照是否等价：
     * 若所有标量字段与子智能体签名均未变化，复用旧对象引用，防止 React 每 3s 空转重渲染。
     */
    const _domTelSignature = (tel) => {
      if (!tel) return ''
      const subsSig = Array.isArray(tel.domSubagents)
        ? tel.domSubagents.map((s) => [s.id, s.title, s.tokenLabel, s.durationLabel, s.status].join(':')).join('|')
        : ''
      return [
        tel.sessionId || '',
        tel.sessionTitle || '',
        tel.workspaceName || '',
        tel.tokens || 0,
        tel.tokenLabel || '',
        tel.rounds || 0,
        tel.steps || 0,
        tel.speedLabel || '',
        tel.cacheHitPct || 0,
        tel.cacheLabel || '',
        tel.contextUsedLabel || '',
        tel.contextMaxLabel || '',
        tel.contextPct || '',
        tel.inputLabel || '',
        tel.outputLabel || '',
        tel.reasoningLabel || '',
        tel.costLabel || '',
        tel.subagentCount || 0,
        subsSig,
      ].join('§')
    }

    /**
     * 从宿主 DSH 页面 DOM 与 localStorage 实时读取当前会话 ID、标题及底栏真实遥测。
     * v0.21.0 性能优化：
     *   1. 3 秒节流缓存 + 拖拽期间零 DOM 采样；
     *   2. 仅读取 `textContent.slice(0, 6000)` 避免 `innerText` 同步重排；
     *   3. 浅字段未变时原样返回缓存引用，使 `setDomTel` 保持 O(1) 引用相等跳过重渲染。
     */
    let _domTelemCache = { ts: 0, val: null, sig: '' }
    let _isCanvasDragging = false

    const readHostDomTelemetry = () => {
      const emptyTel = {
        sessionId: null,
        sessionTitle: null,
        workspaceName: null,
        tokens: 0,
        tokenLabel: '0',
        rounds: 0,
        steps: 0,
        speedLabel: '0 tok/s',
        cacheHitPct: 0,
        cacheLabel: '待命',
        contextUsedLabel: '',
        contextMaxLabel: '',
        contextPct: '',
        inputLabel: '',
        outputLabel: '',
        reasoningLabel: '',
        costLabel: '',
        subagentCount: 0,
        domSubagents: [],
      }
      if (_isCanvasDragging) {
        return _domTelemCache.val || emptyTel
      }
      const now = Date.now()
      if (now - _domTelemCache.ts < 3000 && _domTelemCache.val) {
        return _domTelemCache.val
      }
      const out = Object.assign({}, emptyTel, { domSubagents: [] })
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const rawCur = window.localStorage.getItem('dsh.sessions.current')
          if (rawCur) {
            let sid = rawCur.trim()
            if (sid.startsWith('"') && sid.endsWith('"')) {
              try { sid = JSON.parse(sid) } catch (e) { /* ignore */ }
            }
            if (sid && typeof sid === 'string') out.sessionId = sid
          }
        }
        if (typeof document !== 'undefined' && document.body) {
          const isPluginNode = (node) => {
            if (!node || typeof node !== 'object') return false
            const cls = typeof node.className === 'string' ? node.className : ''
            if (/(?:^|\s)(?:rt-dock|rt-full|rt-embed)(?:\s|$)/.test(cls)) return true
            const tag = String(node.tagName || '').toUpperCase()
            return tag === 'SCRIPT' || tag === 'STYLE'
          }
          const collectHostText = (root) => {
            if (!root || isPluginNode(root)) return ''
            if (typeof root.querySelector === 'function') {
              try {
                if (!root.querySelector('.rt-dock, .rt-full, .rt-embed')) {
                  return (root.textContent || '').slice(0, 6000)
                }
              } catch (e) { /* ignore selector error */ }
            }
            const kids = root.children || root.childNodes
            if (kids && kids.length > 0) {
              const parts = []
              let totalLen = 0
              for (let i = 0; i < kids.length && totalLen < 6000; i += 1) {
                const sub = collectHostText(kids[i])
                if (sub) {
                  parts.push(sub)
                  totalLen += sub.length
                }
              }
              return parts.join('\n').slice(0, 6000)
            }
            return (root.textContent || '').slice(0, 6000)
          }
          const el = document.body
          let text = collectHostText(el)
          if (!text && el.textContent) {
            text = (el.textContent || '').slice(0, 6000)
            if (typeof el.querySelectorAll === 'function') {
              const own = el.querySelectorAll('.rt-dock, .rt-full, .rt-embed')
              for (let i = 0; i < own.length; i += 1) {
                const ownTxt = (own[i].textContent || '').slice(0, 6000).trim()
                if (ownTxt) text = text.split(ownTxt).join('\n')
              }
            }
          }

          /* 1. 轮次 & 步数 */
          const roundStepMatch = /(\d+)\s*轮\s*(\d+)\s*步/.exec(text)
          if (roundStepMatch) {
            out.rounds = parseInt(roundStepMatch[1], 10) || 0
            out.steps = parseInt(roundStepMatch[2], 10) || 0
          }
          /* 2. 输出速度 */
          const speedMatch = /([\d.]+)\s*tok\/s/i.exec(text)
          if (speedMatch) {
            out.speedLabel = speedMatch[1] + ' tok/s'
          }
          /* 3. 总 Token 用量 */
          const tokMatch = /(?:tok\/s\s+|用量\s*)([\d.]+)\s*([kKmM]?)\s*tok\b/i.exec(text)
            || /([\d.]+)\s*([kKmM])\s*tok\s*(?:·|\s)*(?:缓存命中|上下文)/i.exec(text)
            || /([\d.]+)\s*([kKmM])\s*tok\b(?!\s*\/)/i.exec(text)
          if (tokMatch) {
            const num = parseFloat(tokMatch[1]) || 0
            const rawUnit = tokMatch[2] || ''
            const unit = rawUnit.toLowerCase()
            const mult = unit === 'm' ? 1000000 : (unit === 'k' ? 1000 : 1)
            out.tokens = Math.round(num * mult)
            out.tokenLabel = tokMatch[1] + (rawUnit ? rawUnit : '')
          }
          /* 4. 缓存命中率 */
          const cacheMatch = /命中\s*(\d+\.\d+)%/.exec(text)
            || /(?:缓存命中|命中)\s*([\d.]+)%/.exec(text)
          if (cacheMatch) {
            out.cacheHitPct = parseFloat(cacheMatch[1]) || 0
            out.cacheLabel = '缓存命中 ' + cacheMatch[1] + '%'
          }
          /* 5. 上下文窗口与百分比 */
          const ctxMatch = /上下文\s*([\d.]+[kKmM]?)\s*\/\s*([\d.]+[kKmM]?)/.exec(text)
          if (ctxMatch) {
            out.contextUsedLabel = ctxMatch[1]
            out.contextMaxLabel = ctxMatch[2]
          }
          const ctxPctMatch = /推理\s*[\d.]+[kKmM]?\s+(\d+(?:\.\d+)?)%/.exec(text)
          if (ctxPctMatch) {
            out.contextPct = ctxPctMatch[1] + '%'
          } else if (out.contextUsedLabel && out.contextMaxLabel) {
            const u = parseTokNum(out.contextUsedLabel)
            const m = parseTokNum(out.contextMaxLabel)
            if (u > 0 && m > 0) out.contextPct = Math.round((u / m) * 100) + '%'
          }
          /* 6. 输入 / 输出 / 推理 Token 标签 */
          const inMatch = /输入\s*([\d.]+[kKmM]?)/.exec(text)
          if (inMatch) out.inputLabel = inMatch[1]
          const outMatch = /输出\s*([\d.]+[kKmM]?)/.exec(text)
          if (outMatch) out.outputLabel = outMatch[1]
          const reasonMatch = /推理\s*([\d.]+[kKmM]?)/.exec(text)
          if (reasonMatch) out.reasoningLabel = reasonMatch[1]
          /* 7. 费用 */
          const costMatch = /(?:本轮费用|费用)\s*[≈~]?\s*(¥[\d.]+)/.exec(text)
            || /(¥[\d.]+)/.exec(text)
          if (costMatch) out.costLabel = costMatch[1]
          /* 8. 子智能体数量与 DOM 子智能体列表 */
          const subCntMatch = /(\d+)\s*个子智能体/.exec(text)
          if (subCntMatch) out.subagentCount = parseInt(subCntMatch[1], 10) || 0
          const waveRe = /Wave\s*(\d)\s+([a-z-]+)\s+([^\n·•]+?)\s+([\d.]+[kKmM]?\s*tok)\s*[·•]\s*([^\n]+)/gi
          let wm
          const seenSub = new Set()
          while ((wm = waveRe.exec(text)) !== null) {
            const waveNo = parseInt(wm[1], 10) || 1
            const roleCode = String(wm[2] || '').toLowerCase()
            const shortTitle = String(wm[3] || '').trim()
            const tokStr = String(wm[4] || '').trim()
            const durStr = String(wm[5] || '').trim()
            const fullTitle = 'Wave' + waveNo + ' ' + roleCode + ' ' + shortTitle
            if (seenSub.has(fullTitle)) continue
            seenSub.add(fullTitle)
            out.domSubagents.push({
              id: 'dom-w' + waveNo + '-' + roleCode + '-' + out.domSubagents.length,
              wave: waveNo,
              role: roleCode,
              title: fullTitle,
              shortTitle: shortTitle,
              tokenLabel: tokStr,
              tokens: parseTokNum(tokStr),
              durationLabel: durStr,
              status: /运行中|正在|running|active/i.test(durStr) ? 'running' : 'done',
            })
          }
          if (out.domSubagents.length > out.subagentCount) {
            out.subagentCount = out.domSubagents.length
          }
        }
      } catch (e) { /* DOM 读取异常不阻断渲染 */ }

      const nextSig = _domTelSignature(out)
      if (_domTelemCache.val && _domTelemCache.sig === nextSig) {
        _domTelemCache.ts = now
        return _domTelemCache.val
      }
      _domTelemCache = { ts: now, val: out, sig: nextSig }
      return out
    }

    /**
     * 实时 PostgreSQL 写表活动探针（PG 写表活动探针）。
     * v0.21.0 修复：
     *   1. 增加 `inFlightRef` 并发防重入锁，避免慢响应下 5s 定时器堆积请求；
     *   2. 空闲态零假数据：当 `totalWrites === 0 && (rowCounts.worker_tasks || 0) === 0` 时，
     *      如实展示 `0` 个已审批 Worker 与 `'待命'` 摘要状态，绝不伪造 `3` 或 `-85%`；
     *   3. 新手简洁视图（`uiMode === 'novice'`）下隐藏底层协议术语与原始表计数网格。
     */
    function PgWriteProbeCard(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const { uiMode } = useUI()
      const isNovice = uiMode === 'novice'
      const [probe, setProbe] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const inFlightRef = React.useRef(false)

      const loadProbe = React.useCallback(() => {
        if (!eng) {
          setProbe(null)
          return
        }
        if (_isCanvasDragging || inFlightRef.current) return
        inFlightRef.current = true
        setBusy(true)
        api({ op: 'pgWriteProbe', engagement: eng }).then((r) => {
          inFlightRef.current = false
          setBusy(false)
          if (r && r.ok !== false) setProbe(r)
        }, () => {
          inFlightRef.current = false
          setBusy(false)
        })
      }, [eng])

      React.useEffect(() => {
        loadProbe()
        if (!eng) return undefined
        const timer = window.setInterval(loadProbe, 5000)
        return () => window.clearInterval(timer)
      }, [loadProbe, refreshKey, eng])

      useHostEvents(eng, loadProbe, 800)

      const rowCounts = (probe && (probe.rowCounts || probe.row_counts)) || {}
      const workerTasksRows = Number(rowCounts.worker_tasks) || 0
      const workerDigestsRows = Number(rowCounts.worker_digests) || 0

      const zeroTables = [
        { table: 'modules (模块)', writes: 0, role: 'idle' },
        { table: 'dag_nodes (工作流)', writes: 0, role: 'idle' },
        { table: 'sharded_files (分片)', writes: 0, role: 'idle' },
        { table: 'worker_tasks (委派任务)', writes: workerTasksRows, role: 'plan' },
        { table: 'worker_digests (压缩摘要)', writes: workerDigestsRows, role: 'lmtex' },
        { table: 'code_audits (审查)', writes: 0, role: 'idle' },
        { table: 'qa_runs (测试门禁)', writes: 0, role: 'idle' },
        { table: 'delivery_docs (交付)', writes: 0, role: 'idle' },
      ]
      const rawTables = (probe && Array.isArray(probe.tables) && probe.tables.length) ? probe.tables.slice() : []
      if (rawTables.length > 0) {
        if (!rawTables.some((t) => String(t.table || t.name || '').includes('worker_tasks'))) {
          rawTables.push({
            table: 'worker_tasks (委派任务)',
            writes: Number(probe && probe.worker_tasks_writes) || workerTasksRows || 0,
            role: 'plan',
          })
        }
        if (!rawTables.some((t) => String(t.table || t.name || '').includes('worker_digests'))) {
          rawTables.push({
            table: 'worker_digests (压缩摘要)',
            writes: Number(probe && probe.worker_digests_writes) || workerDigestsRows || 0,
            role: 'lmtex',
          })
        }
      }
      const tables = rawTables.length > 0 ? rawTables : zeroTables
      const events = (probe && Array.isArray(probe.events))
        ? probe.events
        : ((probe && Array.isArray(probe.recentEvents)) ? probe.recentEvents : [])
      const totalWrites = (probe && typeof probe.total_writes === 'number')
        ? probe.total_writes
        : ((probe && typeof probe.totalWrites === 'number')
          ? probe.totalWrites
          : tables.reduce((s, t) => s + (Number(t.writes || t.count) || 0), 0))

      const isIdleZero = totalWrites === 0 && workerTasksRows === 0
      const latency = (probe && probe.latency_ms !== undefined)
        ? (probe.latency_ms + 'ms')
        : (isIdleZero ? '待命' : '0.4ms')
      const hasRealCompression = !isIdleZero && probe && Number(probe.compression_ratio_pct) > 0
      const compressionBadgeText = isIdleZero
        ? '待命'
        : (hasRealCompression ? ('摘要压缩率 -' + Number(probe.compression_ratio_pct) + '%') : '待命')
      const approvedWorkersCnt = isIdleZero
        ? 0
        : ((probe && probe.approved_workers !== undefined) ? (Number(probe.approved_workers) || 0) : 0)
      const activeWriter = totalWrites > 0
        ? ((probe && probe.active_writer) || 'Builder / Sub-Worker 写入中')
        : '待命 · 尚无写表事务'

      return h('div', { className: 'rt-bento-card rt-pg-probe' },
        h('div', { className: 'rt-bento-head' },
          h('span', { className: 'rt-live-dot' }),
          h('span', { className: 'rt-bento-title' }, 'PG 写表活动探针'),
          h('span', { className: 'rt-tag rt-tag-live' }, isIdleZero ? '待命' : ('延迟 ' + latency)),
          h('span', { className: 'rt-tag ' + (isIdleZero ? '' : 'rt-tag-active') }, compressionBadgeText),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy || !eng, onClick: loadProbe }, busy ? '采样中…' : '采样')),
        h('div', { className: 'rt-pg-summary' },
          h('div', { className: 'rt-pg-stat' },
            h('span', { className: 'rt-pg-stat-val' }, isNovice ? (totalWrites + ' 次同步') : (String(totalWrites) + ' TX')),
            h('span', { className: 'rt-pg-stat-lbl' }, isNovice ? '研发进度自动保存次数' : 'PG 写表事务累计')),
          h('div', { className: 'rt-pg-stat' },
            h('span', { className: 'rt-pg-stat-val', style: { fontSize: 12 } }, activeWriter),
            h('span', { className: 'rt-pg-stat-lbl' }, isNovice
              ? ('已确认阶段任务：' + approvedWorkersCnt + ' 项')
              : ('当前活跃写入角色 / 分片 · 已审批 Worker(approved_workers): ' + approvedWorkersCnt)))),
        !isNovice ? h('div', { className: 'rt-pg-tables' },
          tables.slice(0, 8).map((t, i) => h('div', { key: 'pgt' + i, className: 'rt-pg-tbl', title: '写入角色：' + (t.role || 'idle') },
            h('span', { className: 'rt-pg-tbl-name' }, t.table || t.name),
            h('span', { className: 'rt-pg-tbl-cnt' }, String(t.writes !== undefined ? t.writes : (t.count || 0)) + ' w')))) : null,
        h('div', { className: 'rt-pg-log', role: 'log', 'aria-label': 'PostgreSQL 实时写表事件流' },
          events.length > 0
            ? events.slice(0, 6).map((ev, idx) => h('div', { key: 'pge' + idx, className: 'rt-pg-log-row' },
                h('span', { className: 'rt-pg-verb' + (ev.verb === 'UPDATE' ? ' upd' : '') }, ev.verb || 'INSERT'),
                h('span', { title: ev.sql || ev.summary || '' }, ev.sql || ev.summary || ''),
                h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10 } }, '[' + (ev.role || 'worker') + ']'),
                h('span', { className: 'rt-pg-lat' }, ev.latency || latency)))
            : h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11.5, lineHeight: 1.6, padding: '2px 0' } },
                isNovice
                  ? '当前暂无研发落盘记录 · 前往「协同与审批」初始化并立项后，各智能体的工作成果将实时自动保存。'
                  : '当前工作区尚无 PG 写表事务（0 TX）· 当智能体角色写入模块架构、worker_tasks / worker_digests 摘要压缩或验证记录时，此处将实时滚动展示事务流。')))
    }

    /* ---------------------------------------------------------- 03-wish-wizard：协同与审批卡片页、需求澄清向导与待审批计数 */
    /**
     * 简洁模式下的波次里程碑文案映射。
     */
    const NOVICE_WAVE_MILESTONES = {
      1: '第 1 步：理清需求与界面设计',
      2: '第 2 步：划分模块边界',
      3: '第 3 步：分头编写代码',
      4: '第 4 步：自动测试与验收',
    }

    const formatWaveHeaderByMode = (waveNo, defaultHeader, uiMode) => {
      if (uiMode === 'novice' && NOVICE_WAVE_MILESTONES[waveNo]) {
        return NOVICE_WAVE_MILESTONES[waveNo]
      }
      return defaultHeader
    }

    const WISH_STARTER_TEMPLATES = [
      {
        id: 'web-app',
        label: '🌐 交互式 Web 应用',
        projectName: '个人专注待办应用',
        prompt: '做一个带番茄钟计时、优先级标签、每日专注统计图表与本地自动保存的个人待办网页应用，界面简洁清爽，支持手机与电脑访问。',
      },
      {
        id: 'dashboard',
        label: '📊 数据可视化看板',
        projectName: '业务运营数据看板',
        prompt: '做一个数据可视化分析看板，支持粘贴或上传 CSV/JSON 表格数据，自动生成核心指标卡片、趋势折线图、分类占比环形图，并支持按日期筛选导出。',
      },
      {
        id: 'cli-tool',
        label: '⚙️ 自动化脚本与 CLI 工具',
        projectName: '智能文件批处理工具',
        prompt: '做一个命令行自动化整理与批处理工具，支持按文件类型和修改日期自动归档文件夹、查重提醒、生成汇总 Markdown 报告，并提供安全预览模式。',
      },
      {
        id: 'fullstack-api',
        label: '🔌 全栈 API 与数据库服务',
        projectName: '全栈任务管理接口服务',
        prompt: '做一个带用户登录鉴权、RESTful 接口、持久化数据存储、参数校验与自动化接口测试套件的全栈后端服务，附带清晰的接口调用文档。',
      },
    ]

    const WISH_CLARIFY_CHIPS = [
      { group: '目标平台', label: 'Web 响应式界面', snippet: '目标平台为桌面与移动端自适应 Web 界面，注重清爽排版与零门槛交互体验。' },
      { group: '目标平台', label: 'Node CLI 命令行', snippet: '目标形态为跨平台 Node.js CLI 命令行工具，具备清晰参数提示与非零退出码规范。' },
      { group: '目标平台', label: '全栈 API 服务', snippet: '包含结构化后端 REST API 与数据持久化层，接口请求与响应均做严格校验。' },
      { group: '核心交付', label: '含自动化回归测试', snippet: '交付物必须包含可直接运行的自动化回归测试套件，覆盖正常主流程与边界输入。' },
      { group: '核心交付', label: '模块化可扩展架构', snippet: '采用职责单一的模块化分层结构，预留清晰配置项与扩展接口。' },
      { group: '工程约束', label: '零外部运行时依赖', snippet: '优先使用标准库与项目既有技术栈实现，不引入冗余第三方运行时依赖。' },
      { group: '工程约束', label: '严格独占文件分片', snippet: '各并行开发阶段严格遵守独占文件分片边界，禁止多智能体交叉覆盖同一文件。' },
    ]

    const WIZARD_ROLE_OPTIONS = [
      { value: 'recon', label: '产品与需求规划（CEO）', wave: 1 },
      { value: 'designer', label: '交互与视觉设计（Designer）', wave: 1 },
      { value: 'assess', label: '系统架构与排期（Eng Manager）', wave: 2 },
      { value: 'exploit', label: '全栈研发与构建（Builder）', wave: 3 },
      { value: 'qa', label: '质量保障与测试（QA Lead）', wave: 4 },
      { value: 'vuln-scan', label: '代码审查与安全（Reviewer & CSO）', wave: 4 },
      { value: 'internal', label: '文档工程与发布（Doc & Release）', wave: 4 },
    ]

    const PENDING_APPROVAL_STATES = new Set([
      'pending_approval',
      'waiting_approval',
      'revision_required',
      'blocked',
    ])

    /**
     * 统计当前工作台中处于待人工审批 / 待修订 / 受阻状态的 Worker 或拆解目标数。
     */
    function countPendingApprovals(snapshot, dagData) {
      const workerTasks = (dagData && (dagData.worker_tasks || dagData.workerTasks))
        || (snapshot && (snapshot.worker_tasks || snapshot.workerTasks))
        || []
      const planGoals = (dagData && (dagData.plan_goals || dagData.planGoals))
        || (snapshot && (snapshot.plan_goals || snapshot.planGoals))
        || []
      const seenKeys = new Set()
      let count = 0
      const inspectList = (list, prefix) => {
        if (!Array.isArray(list)) return
        for (let i = 0; i < list.length; i += 1) {
          const item = list[i]
          if (!item || typeof item !== 'object') continue
          const key = String(item.id || item.worker_id || item.workerId || item.goal_id || (prefix + '-' + i))
          if (seenKeys.has(key)) continue
          seenKeys.add(key)
          const st = String(item.status || '').toLowerCase().trim()
          const ap = String(item.approval_state || item.approvalState || '').toLowerCase().trim()
          if (PENDING_APPROVAL_STATES.has(st) || PENDING_APPROVAL_STATES.has(ap)) {
            count += 1
          }
        }
      }
      inspectList(workerTasks, 'wt')
      inspectList(planGoals, 'pg')
      return count >= 0 ? count : 0
    }

    /**
     * 共享宿主侧边栏对话跳转辅助函数（供「协同与审批」队列与「集群」工作流检视器共用）。
     */
    const activateHostAgentChatSession = (agent, opts) => {
      const options = opts || {}
      const candidateSid = (agent && (agent.sessionId || agent.session_id || agent.id)) || ''
      const fallbackSid = options.sessionId || sessionId || ''
      const looksRealSid = (s) => {
        const str = String(s || '').trim()
        if (!str || str === 'root' || str === 'root-main' || str === 'default') return false
        if (/^(?:sub-|agent-|dom-|task-|wish-|custom-|goal-)/i.test(str)) return false
        if (/^session-(?:plan|recon|designer|assess|exploit|qa|vuln-scan|internal)$/i.test(str)) return false
        return /^(?:session-)?[0-9a-f]{8}-[0-9a-f]{4}/i.test(str) || (!str.startsWith('w') && str.length >= 12)
      }
      const targetSid = looksRealSid(candidateSid) ? candidateSid : (looksRealSid(fallbackSid) ? fallbackSid : '')
      const targetTitle = (agent && (agent.title || agent.name)) || options.sessionTitle || sessionTitle || targetSid || '当前会话'

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

    const deriveProjectNameFromWish = (wishText, fallbackHint) => {
      const hint = String(fallbackHint || '').trim()
      if (hint && !isRawUuidName(hint)) return hint.slice(0, 28)
      const cleaned = String(wishText || '')
        .replace(/^(?:请帮我|帮我|我想|我要|做一个|开发一个|写一个|构建一个|设计一个)\s*/u, '')
        .split(/[，。！？,.;；\n]/)[0]
        .trim()
      if (cleaned.length >= 2) return cleaned.slice(0, 24)
      return '研发工作台-' + new Date().toISOString().slice(5, 10)
    }

    const buildClientFallbackBlueprint = (wishText) => {
      const summary = String(wishText || '').trim().slice(0, 80) || '目标软件系统'
      return [
        {
          id: 'wish-stage-1',
          wave: 1,
          role: 'recon',
          title: '理清核心功能清单与交互流程',
          assignedGoal: '围绕「' + summary + '」梳理核心功能点、用户操作路径与验收标准，明确首版最小可用范围。',
          filesOwned: 'docs/prd.md, src/types/*',
        },
        {
          id: 'wish-stage-2',
          wave: 1,
          role: 'designer',
          title: '制定界面布局、配色与响应式交互规范',
          assignedGoal: '设计直观易用的主界面布局、空状态引导与交互反馈，确保零学习成本上手。',
          filesOwned: 'src/styles/*, src/components/layout/*',
        },
        {
          id: 'wish-stage-3',
          wave: 2,
          role: 'assess',
          title: '划分模块边界与互不冲突的文件分片',
          assignedGoal: '锁定各模块数据结构与接口契约，为并行开发分配独占文件目录，防止并发修改冲突。',
          filesOwned: 'src/contracts/*, package.json',
        },
        {
          id: 'wish-stage-4',
          wave: 3,
          role: 'exploit',
          title: '核心业务界面与交互逻辑编码实现',
          assignedGoal: '按既定蓝图实现前端交互组件、状态管理与核心业务逻辑，完成本地单元验证。',
          filesOwned: 'src/app/*, src/features/*',
        },
        {
          id: 'wish-stage-5',
          wave: 4,
          role: 'qa',
          title: '全流程自动化测试与交付验收检查',
          assignedGoal: '编写端到端回归测试，核验边界输入、错误提示与性能表现，输出可一键启动的交付成果。',
          filesOwned: 'test/*, README.md',
        },
      ]
    }

    const normalizeBlueprintGoals = (rawList, wishText) => {
      if (!Array.isArray(rawList) || rawList.length === 0) {
        return buildClientFallbackBlueprint(wishText)
      }
      return rawList.map((item, idx) => {
        const role = String(item.role || item.agent_role || (idx === 0 ? 'recon' : idx === 1 ? 'assess' : idx === rawList.length - 1 ? 'qa' : 'exploit')).trim()
        const roleOpt = WIZARD_ROLE_OPTIONS.find((r) => r.value === role) || WIZARD_ROLE_OPTIONS[3]
        const filesArr = Array.isArray(item.files_owned)
          ? item.files_owned
          : (Array.isArray(item.filesOwned) ? item.filesOwned : null)
        const filesStr = filesArr
          ? filesArr.join(', ')
          : String(item.files_owned || item.filesOwned || item.shard || ('src/module-' + (idx + 1) + '/*'))
        return {
          id: String(item.id || item.worker_id || ('wish-stage-' + (idx + 1))),
          wave: Number(item.wave) || roleOpt.wave,
          role: roleOpt.value,
          title: String(item.title || item.name || ('阶段任务 #' + (idx + 1))),
          assignedGoal: String(item.assigned_goal || item.assignedGoal || item.goal || item.description || item.title || ''),
          filesOwned: filesStr,
        }
      })
    }

    /**
     * 紧凑视图密度胶囊（仅保留函数供顶栏按需调用，页面内部严禁重复渲染）。
     */
    function UiModeSwitcher(props) {
      const { uiMode } = useUI()
      const isNovice = uiMode === 'novice'
      const compact = Boolean(props && props.compact)
      return h('div', {
        className: 'rt-ui-mode-switcher',
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          padding: compact ? '2px 3px' : '3px 5px',
          borderRadius: 999,
          border: '1px solid var(--dsw-alias-border-l2)',
          background: 'var(--dsw-alias-bg-layer-2, rgba(77,107,254,0.06))',
        },
      },
        h('button', {
          type: 'button',
          className: 'rt-btn' + (isNovice ? ' rt-btn-primary' : ''),
          style: { borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: isNovice ? 700 : 500 },
          title: '切换为简洁视图',
          onClick: () => setUiMode('novice'),
        }, '简洁'),
        h('button', {
          type: 'button',
          className: 'rt-btn' + (!isNovice ? ' rt-btn-primary' : ''),
          style: { borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: !isNovice ? 700 : 500 },
          title: '切换为专家视图',
          onClick: () => setUiMode('expert'),
        }, '专家'))
    }

    /**
     * 需求拆解与分片立项向导（WishRefinerWizard）：
     *   · 严格按当前会话隔离：当 `!props.engagement` 时绝不展示其他会话工作台名，自动从当前会话标题预填专属工作台名称；
     *   · 立项创建工作台时始终携带 `session: activeSid`，确保后端 1:1 绑定至当前会话。
     */
    function WishRefinerWizard(props) {
      const eng = props.engagement || null
      const hasActiveWork = Boolean(props.hasActiveWork)
      const openSignal = props.openSignal || 0
      const appendRequest = props.appendRequest || null
      const { uiMode } = useUI()
      const currentSess = useSession()

      const activeSid = props.sessionId || currentSess.id || null
      const rawSessionTitle = props.sessionTitle || (activeSid === currentSess.id ? currentSess.title : null) || ''
      const cleanSessionHint = rawSessionTitle && !isRawUuidName(rawSessionTitle) ? String(rawSessionTitle).trim() : ''

      const [manualOpen, setManualOpen] = React.useState(null)
      const isExpanded = manualOpen !== null ? manualOpen : !hasActiveWork

      React.useEffect(() => {
        if (openSignal > 0) setManualOpen(true)
      }, [openSignal])

      const [wishText, setWishText] = React.useState('')
      const [projectHint, setProjectHint] = React.useState(() => (!eng ? cleanSessionHint : ''))
      const [hintEdited, setHintEdited] = React.useState(false)
      const [refinedWish, setRefinedWish] = React.useState('')
      const [stageCards, setStageCards] = React.useState([])
      const [previewing, setPreviewing] = React.useState(false)
      const [launching, setLaunching] = React.useState(false)
      const [feedback, setFeedback] = React.useState(null)

      /* 会话切换时重置草稿与默认工作台命名，杜绝跨会话串味 */
      React.useEffect(() => {
        setHintEdited(false)
        setProjectHint(!eng ? cleanSessionHint : '')
        setStageCards([])
        setRefinedWish('')
        setFeedback(null)
      }, [activeSid])

      React.useEffect(() => {
        if (!eng && !hintEdited) {
          setProjectHint(cleanSessionHint)
        }
      }, [eng, cleanSessionHint, hintEdited])

      React.useEffect(() => {
        if (!appendRequest || !appendRequest.seq || !appendRequest.text) return
        const snippet = String(appendRequest.text).trim()
        if (!snippet) return
        setManualOpen(true)
        setWishText((prev) => {
          const base = String(prev || '').trim()
          if (base.includes(snippet)) return prev
          return base ? (base + '\n• ' + snippet) : snippet
        })
      }, [appendRequest && appendRequest.seq])

      const applyStarter = (tpl) => {
        setWishText(tpl.prompt)
        if (!eng && !hintEdited && !cleanSessionHint) {
          setProjectHint(tpl.projectName)
        }
        setFeedback(null)
      }

      const handleRefinePreview = () => {
        const promptTrimmed = String(wishText || '').trim()
        if (!promptTrimmed) {
          setFeedback({ tone: 'warn', text: '请先在下方输入框描述目标功能与交付要求，或点选灵感模板与澄清提示词。' })
          return
        }
        setPreviewing(true)
        setFeedback(null)
        api({
          op: 'refineAndDecomposeWish',
          engagement_id: eng || undefined,
          engagement: eng || undefined,
          session: activeSid || undefined,
          prompt: promptTrimmed,
          preview_only: true,
        }).then((res) => {
          setPreviewing(false)
          const serverRefined = res && (res.refined_prompt || res.refinedPrompt || (res.blueprint && res.blueprint.refined_prompt))
          if (serverRefined) setRefinedWish(String(serverRefined))
          if (!eng && res && (res.project_name || res.projectName) && !projectHint) {
            setProjectHint(String(res.project_name || res.projectName))
          }
          const rawGoals = (res && (res.goals || res.stages || res.subgoals || (res.blueprint && res.blueprint.goals))) || []
          const normalized = normalizeBlueprintGoals(rawGoals, serverRefined || promptTrimmed)
          setStageCards(normalized)
          setFeedback({
            tone: 'ok',
            text: '已生成 ' + normalized.length + ' 个研发阶段蓝图卡片。确认目标说明、负责角色与独占文件分片后，点击「🚀 确认蓝图并立项拆解」。',
          })
        }).catch(() => {
          setPreviewing(false)
          const normalized = buildClientFallbackBlueprint(promptTrimmed)
          setStageCards(normalized)
          setFeedback({
            tone: 'ok',
            text: '已生成 ' + normalized.length + ' 个默认研发拆解阶段，可直接微调后立项启动。',
          })
        })
      }

      const updateCardField = (idx, field, val) => {
        setStageCards((prev) => prev.map((c, i) => {
          if (i !== idx) return c
          const next = Object.assign({}, c, { [field]: val })
          if (field === 'role') {
            const matched = WIZARD_ROLE_OPTIONS.find((r) => r.value === val)
            if (matched) next.wave = matched.wave
          }
          return next
        }))
      }

      const addStageCard = () => {
        setStageCards((prev) => prev.concat([{
          id: 'wish-stage-custom-' + (prev.length + 1),
          wave: 3,
          role: 'exploit',
          title: '新增功能模块开发分片 #' + (prev.length + 1),
          assignedGoal: '补充实现独立子模块逻辑并完成单元验证',
          filesOwned: 'src/custom-' + (prev.length + 1) + '/*',
        }]))
      }

      const removeStageCard = (idx) => {
        setStageCards((prev) => prev.filter((_, i) => i !== idx))
      }

      const handleConfirmAndDecompose = async () => {
        const promptTrimmed = String(wishText || '').trim()
        if (!promptTrimmed && stageCards.length === 0) {
          setFeedback({ tone: 'warn', text: '请先输入需求描述或选择模板后再执行立项拆解。' })
          return
        }
        const effectiveGoalsSource = stageCards.length > 0
          ? stageCards
          : buildClientFallbackBlueprint(promptTrimmed)
        const editedGoals = effectiveGoalsSource.map((card, idx) => {
          const filesList = String(card.filesOwned || '')
            .split(/[,，\n]+/)
            .map((s) => s.trim())
            .filter(Boolean)
          return {
            id: card.id || ('goal-' + (idx + 1)),
            wave: Number(card.wave) || 3,
            role: card.role || 'exploit',
            title: String(card.title || '').trim() || ('阶段 #' + (idx + 1)),
            assigned_goal: String(card.assignedGoal || card.title || '').trim(),
            assignedGoal: String(card.assignedGoal || card.title || '').trim(),
            files_owned: filesList,
            filesOwned: filesList,
          }
        })

        setLaunching(true)
        setFeedback(null)
        try {
          let targetEng = eng || ''
          const derivedProjectName = deriveProjectNameFromWish(promptTrimmed, projectHint || cleanSessionHint)
          if (!targetEng) {
            let openRes = await api({
              op: 'openEngagement',
              name: derivedProjectName,
              session: activeSid || undefined,
            })
            if (!openRes || openRes.ok === false) {
              openRes = await api({
                op: 'engagementOpen',
                name: derivedProjectName,
                session: activeSid || undefined,
              })
            }
            const openedObj = (openRes && openRes.engagement && typeof openRes.engagement === 'object')
              ? openRes.engagement
              : openRes
            targetEng = String(
              (openedObj && (openedObj.id || openedObj.engagement_id))
              || (openRes && (openRes.active || openRes.engagement_id || openRes.id))
              || derivedProjectName
            ).trim()
            if (targetEng) {
              rememberEngagement(targetEng)
              if (activeSid) {
                await api({
                  op: 'bindSessionEngagement',
                  session: activeSid,
                  engagement: targetEng,
                  id: targetEng,
                  name: derivedProjectName,
                })
              }
              if (typeof props.onWorkspaceCreated === 'function') {
                props.onWorkspaceCreated(targetEng, derivedProjectName)
              }
            }
          }

          const finalPrompt = refinedWish ? (promptTrimmed + '\n\n【润色补充】' + refinedWish) : promptTrimmed
          const decompRes = await api({
            op: 'decomposeUserPrompt',
            engagement_id: targetEng || 'default',
            engagement: targetEng || 'default',
            session: activeSid || undefined,
            user_prompt: finalPrompt || derivedProjectName,
            prompt: finalPrompt || derivedProjectName,
            goals: editedGoals,
          })

          setLaunching(false)
          if (decompRes && decompRes.ok === false) {
            setFeedback({ tone: 'err', text: '立项拆解失败：' + (decompRes.error || '请稍后重试') })
            return
          }
          setFeedback({
            tone: 'ok',
            text: '立项成功！已将 ' + editedGoals.length + ' 个并行研发分片写入当前工作台。',
          })
          if (props.collapseOnLaunch) setManualOpen(false)
          if (typeof props.onDecomposed === 'function') {
            props.onDecomposed(decompRes, editedGoals, finalPrompt || derivedProjectName, targetEng)
          }
        } catch (err) {
          setLaunching(false)
          setFeedback({ tone: 'err', text: '立项请求异常：' + (err && err.message ? err.message : String(err)) })
        }
      }

      const boundWorkspaceLabel = eng
        ? ((props.engagementName && !isRawUuidName(props.engagementName)) ? props.engagementName : eng)
        : null

      return h('div', {
        className: 'rt-bento-card rt-wish-wizard rt-wish-wizard-card',
        style: {
          padding: isExpanded ? '14px 16px' : '10px 14px',
          border: '1px solid rgba(77, 107, 254, 0.24)',
          background: 'linear-gradient(135deg, rgba(77,107,254,0.05) 0%, rgba(16,185,129,0.03) 100%)',
        },
      },
        h('div', {
          style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
        },
          h('button', {
            type: 'button',
            className: 'rt-btn' + (isExpanded ? ' rt-btn-primary' : ''),
            onClick: () => setManualOpen(!isExpanded),
            style: { fontWeight: 700, fontSize: 12.5, padding: '4px 12px' },
          }, isExpanded ? '✨ 需求拆解与蓝图立项（收起）' : '✨ 展开需求拆解与蓝图立项'),
          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
            '自然语言澄清需求 → 独占文件分片蓝图预览 → 一键写入 4-Wave 并发工作流'),
          h('div', { className: 'rt-spacer' }),
          boundWorkspaceLabel
            ? h('span', { className: 'rt-tag rt-tag-live' }, '目标工作台：' + boundWorkspaceLabel)
            : h('span', { className: 'rt-tag rt-tag-active' }, '当前会话将创建独立工作台')),

        isExpanded ? h('div', { className: 'rt-wish-wizard-body', style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, '💡 灵感模板：'),
            WISH_STARTER_TEMPLATES.map((tpl) => h('button', {
              key: tpl.id,
              type: 'button',
              className: 'rt-btn',
              style: { borderRadius: 999, fontSize: 11.5, padding: '3px 10px' },
              onClick: () => applyStarter(tpl),
            }, tpl.label))),

          h('textarea', {
            className: 'rt-textarea',
            rows: 3,
            value: wishText,
            onChange: (e) => setWishText(e.target.value),
            placeholder: '描述你想构建的软件、页面或工程特性（例如：构建一个支持番茄钟计时、数据看板与本地持久化的任务管理应用）...',
            style: {
              width: '100%',
              boxSizing: 'border-box',
              fontSize: 13,
              lineHeight: 1.55,
              padding: '10px 12px',
              borderRadius: 8,
            },
          }),

          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            !eng
              ? h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                  h('span', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, '专属工作台名称：'),
                  h('input', {
                    className: 'rt-input',
                    value: projectHint,
                    onChange: (e) => { setHintEdited(true); setProjectHint(e.target.value) },
                    placeholder: '当前会话独立工作台名称（留空自动生成）',
                    style: { width: 240, fontSize: 12 },
                  }))
              : null,
            h('button', {
              type: 'button',
              className: 'rt-btn',
              disabled: previewing || launching,
              onClick: handleRefinePreview,
              style: { fontWeight: 600, padding: '5px 12px' },
            }, previewing ? '⏳ 正在润色并生成蓝图…' : '✨ 先润色并预览拆解蓝图'),
            h('button', {
              type: 'button',
              className: 'rt-btn rt-btn-primary',
              disabled: previewing || launching,
              onClick: handleConfirmAndDecompose,
              style: { fontWeight: 700, padding: '5px 14px' },
            }, launching ? '🚀 正在立项并派发团队…' : '🚀 确认蓝图并立项拆解')),

          feedback ? h('div', {
            className: 'rt-note',
            style: {
              margin: 0,
              borderColor: feedback.tone === 'err' ? '#ef4444' : feedback.tone === 'warn' ? '#f59e0b' : 'rgba(16,185,129,0.45)',
            },
          }, feedback.text) : null,

          stageCards.length > 0 ? h('div', {
            className: 'rt-wish-blueprint-deck',
            style: {
              marginTop: 4,
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.5))',
            },
          },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8, flexWrap: 'wrap' } },
              h('strong', { style: { fontSize: 12.5 } }, '🗺️ 拆解蓝图预览（共 ' + stageCards.length + ' 个阶段卡片，启动前可自由微调）'),
              h('button', { type: 'button', className: 'rt-btn', style: { fontSize: 11, padding: '2px 8px' }, onClick: addStageCard }, '+ 新增阶段卡片')),
            h('div', {
              style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 10 },
            },
              stageCards.map((card, idx) => h('div', {
                key: card.id || ('wc-' + idx),
                style: {
                  padding: '9px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--dsw-alias-border-l2)',
                  background: 'var(--dsw-alias-bg-base, rgba(0,0,0,0.02))',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  h('span', { className: 'rt-tag rt-tag-active' }, formatWaveHeaderByMode(card.wave, 'Wave ' + card.wave, uiMode)),
                  h('div', { className: 'rt-spacer' }),
                  stageCards.length > 1 ? h('button', {
                    type: 'button',
                    className: 'rt-btn',
                    style: { padding: '0 6px', fontSize: 10.5 },
                    onClick: () => removeStageCard(idx),
                  }, '移除') : null),
                h('label', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '目标说明'),
                h('input', {
                  className: 'rt-input',
                  value: card.title,
                  onChange: (e) => updateCardField(idx, 'title', e.target.value),
                  placeholder: '阶段标题',
                  style: { fontSize: 12, fontWeight: 600 },
                }),
                h('textarea', {
                  className: 'rt-textarea',
                  rows: 2,
                  value: card.assignedGoal,
                  onChange: (e) => updateCardField(idx, 'assignedGoal', e.target.value),
                  placeholder: '具体阶段目标说明…',
                  style: { fontSize: 11.5 },
                }),
                h('label', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '负责角色'),
                h('select', {
                  className: 'rt-select',
                  value: card.role,
                  onChange: (e) => updateCardField(idx, 'role', e.target.value),
                  style: { fontSize: 11.5 },
                }, WIZARD_ROLE_OPTIONS.map((opt) => h('option', { key: opt.value, value: opt.value }, opt.label))),
                h('label', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '独占文件分片'),
                h('input', {
                  className: 'rt-input rt-mono',
                  value: card.filesOwned,
                  onChange: (e) => updateCardField(idx, 'filesOwned', e.target.value),
                  placeholder: '例如 src/ui/*, src/utils/*',
                  style: { fontSize: 11 },
                }))))) : null) : null)
    }

    /**
     * 独立一级卡片页：`CollabApprovalTab`（「协同与审批」）。
     * 收敛全部人机协同闭环：
     *   Card 1 · SessionOnboardingCard（会话工作台初始化指引）
     *   Card 2 · WishDialogueCard（需求对话澄清与蓝图立项卡）
     *   Card 3 · ApprovalQueueCard（阶段验收与 Worker 审批决策卡）
     */
    function CollabApprovalTab(props) {
      const eng = props.engagement || null
      const engName = props.engagementName || ''
      const engagements = Array.isArray(props.engagements) ? props.engagements : []
      const activeSid = props.sessionId || null
      const rawSessionTitle = props.sessionTitle || null
      const cleanSessionTitle = rawSessionTitle && !isRawUuidName(rawSessionTitle) ? String(rawSessionTitle).trim() : null
      const sessionBadgeText = cleanSessionTitle || (activeSid ? activeSid.slice(0, 8) : '未命名新会话')
      const sessionState = props.sessionState || null
      const snapshot = props.snapshot || null
      const refreshKey = props.refreshKey || 0

      const isBound = Boolean(eng)
      const isDismissed = Boolean(sessionState && sessionState.onboarding_dismissed)
      const hasConv = Boolean(sessionState && sessionState.has_conversation)
      const sessionCwd = (sessionState && sessionState.cwd) ? String(sessionState.cwd) : null

      /* Card 1 状态：工作台命名、关联已有项目、本地查看/重开指引开关 */
      const [wsNameDraft, setWsNameDraft] = React.useState(() => cleanSessionTitle || '')
      const [wsNameEdited, setWsNameEdited] = React.useState(false)
      const [selectedExistingId, setSelectedExistingId] = React.useState('')
      const [creatingWs, setCreatingWs] = React.useState(false)
      const [bindingWs, setBindingWs] = React.useState(false)
      const [onboardNote, setOnboardNote] = React.useState(null)
      const [forceShowGuide, setForceShowGuide] = React.useState(false)

      React.useEffect(() => {
        setWsNameEdited(false)
        setWsNameDraft(cleanSessionTitle || '')
        setForceShowGuide(false)
        setOnboardNote(null)
      }, [activeSid])

      React.useEffect(() => {
        if (!wsNameEdited && cleanSessionTitle) {
          setWsNameDraft(cleanSessionTitle)
        }
      }, [cleanSessionTitle, wsNameEdited])

      React.useEffect(() => {
        if (!selectedExistingId && engagements.length > 0) {
          const first = engagements[0]
          if (first && first.id) setSelectedExistingId(String(first.id))
        }
      }, [engagements.length])

      const handleCreateWorkspaceForSession = async () => {
        const finalName = String(wsNameDraft || '').trim()
          || cleanSessionTitle
          || ('会话工作台-' + (activeSid ? activeSid.slice(0, 6) : new Date().toISOString().slice(11, 16).replace(':', '')))
        setCreatingWs(true)
        setOnboardNote(null)
        try {
          if (typeof props.onCreateForSession === 'function') {
            await Promise.resolve(props.onCreateForSession(finalName))
            setCreatingWs(false)
            setForceShowGuide(false)
            return
          }
          let res = await api({ op: 'openEngagement', name: finalName, session: activeSid || undefined })
          if (!res || res.ok === false) {
            res = await api({ op: 'engagementOpen', name: finalName, session: activeSid || undefined })
          }
          const openedObj = (res && res.engagement && typeof res.engagement === 'object') ? res.engagement : res
          const createdId = String(
            (openedObj && (openedObj.id || openedObj.engagement_id))
            || (res && (res.active || res.engagement_id || res.id))
            || finalName
          ).trim()
          if (createdId) {
            rememberEngagement(createdId)
            if (activeSid) {
              await api({
                op: 'bindSessionEngagement',
                session: activeSid,
                engagement: createdId,
                id: createdId,
                name: finalName,
              })
            }
            setForceShowGuide(false)
            if (typeof props.onWorkspaceSelect === 'function') props.onWorkspaceSelect(createdId)
            if (typeof props.onRefresh === 'function') props.onRefresh()
          } else {
            setOnboardNote({ tone: 'err', text: (res && res.error) || '创建工作台未返回有效标识' })
          }
        } catch (err) {
          setOnboardNote({ tone: 'err', text: String((err && err.message) || err) })
        }
        setCreatingWs(false)
      }

      const handleBindExistingWorkspace = async () => {
        const targetId = String(selectedExistingId || '').trim()
        if (!targetId) return
        setBindingWs(true)
        setOnboardNote(null)
        try {
          if (typeof props.onBindExisting === 'function') {
            await Promise.resolve(props.onBindExisting(targetId))
            setBindingWs(false)
            setForceShowGuide(false)
            return
          }
          if (activeSid) {
            await api({ op: 'bindSessionEngagement', session: activeSid, engagement: targetId, id: targetId })
          }
          rememberEngagement(targetId)
          setForceShowGuide(false)
          if (typeof props.onWorkspaceSelect === 'function') props.onWorkspaceSelect(targetId)
          if (typeof props.onRefresh === 'function') props.onRefresh()
        } catch (err) {
          setOnboardNote({ tone: 'err', text: String((err && err.message) || err) })
        }
        setBindingWs(false)
      }

      const handleSkipGuide = () => {
        if (isBound && forceShowGuide) {
          setForceShowGuide(false)
          return
        }
        setForceShowGuide(false)
        if (typeof props.onSkipOnboarding === 'function') {
          props.onSkipOnboarding()
          return
        }
        if (activeSid) {
          api({ op: 'dismissSessionOnboarding', session: activeSid }).then(() => {
            if (typeof props.onRefresh === 'function') props.onRefresh()
          }, () => {})
        }
      }

      const handleReopenGuide = () => {
        setForceShowGuide(true)
        if (!isBound && typeof props.onReopenOnboarding === 'function') {
          props.onReopenOnboarding()
        }
      }

      /* Card 2 状态：快捷澄清词追加信号 */
      const [appendReq, setAppendReq] = React.useState({ seq: 0, text: '' })
      const triggerChipAppend = (snippet) => {
        setAppendReq((prev) => ({ seq: prev.seq + 1, text: snippet }))
      }

      /* Card 3 状态：工作流 DAG 与 Worker 审批队列（按当前 engagement 严格隔离） */
      const [dagData, setDagData] = React.useState(null)
      const [dagLoading, setDagLoading] = React.useState(false)
      const [queueFilter, setQueueFilter] = React.useState('pending')
      const [nextGoalDrafts, setNextGoalDrafts] = React.useState({})
      const [busyItemId, setBusyItemId] = React.useState(null)
      const [queueToast, setQueueToast] = React.useState(null)
      const dagSeqRef = React.useRef(0)

      const loadApprovalDag = React.useCallback(() => {
        const seq = ++dagSeqRef.current
        if (!eng) {
          setDagData(null)
          setDagLoading(false)
          return
        }
        setDagLoading(true)
        api({ op: 'workflowDag', engagement: eng, session: activeSid || undefined }).then((res) => {
          if (seq !== dagSeqRef.current) return
          setDagLoading(false)
          if (res && res.ok !== false) setDagData(res)
        }, () => {
          if (seq !== dagSeqRef.current) return
          setDagLoading(false)
        })
      }, [eng, activeSid])

      React.useEffect(() => {
        setNextGoalDrafts({})
        setQueueToast(null)
        loadApprovalDag()
      }, [loadApprovalDag, refreshKey])

      useHostEvents(eng, loadApprovalDag, 700)

      /* 聚合审批项列表（当 !eng 时严格为空数组） */
      const reviewItems = React.useMemo(() => {
        if (!eng) return []
        const rawWorkers = (dagData && (dagData.worker_tasks || dagData.workerTasks))
          || (snapshot && (snapshot.worker_tasks || snapshot.workerTasks))
          || []
        const rawGoals = (dagData && (dagData.plan_goals || dagData.planGoals))
          || (snapshot && (snapshot.plan_goals || snapshot.planGoals))
          || []
        const merged = []
        const seen = new Set()
        const collect = (arr, fallbackPrefix) => {
          if (!Array.isArray(arr)) return
          arr.forEach((raw, idx) => {
            if (!raw || typeof raw !== 'object') return
            const id = String(raw.id || raw.worker_id || raw.workerId || raw.goal_id || (fallbackPrefix + '-' + (idx + 1)))
            if (seen.has(id)) return
            seen.add(id)
            const roleCode = String(raw.role || raw.agent_role || 'exploit').trim()
            const statusRaw = String(raw.status || '').toLowerCase().trim()
            const approvalRaw = String(raw.approval_state || raw.approvalState || '').toLowerCase().trim()
            const isPendingDecision = PENDING_APPROVAL_STATES.has(statusRaw) || PENDING_APPROVAL_STATES.has(approvalRaw)
            const isApproved = approvalRaw === 'approved' || statusRaw === 'approved'
            const pri = String(
              raw.ui_priority
              || raw.uiPriority
              || (statusRaw === 'blocked' || approvalRaw === 'revision_required' ? 'P0' : (isPendingDecision ? 'P1' : 'P2'))
            ).toUpperCase()
            const filesList = Array.isArray(raw.files_owned)
              ? raw.files_owned
              : (Array.isArray(raw.filesOwned)
                ? raw.filesOwned
                : String(raw.files_owned || raw.filesOwned || '').split(/[,，\n]+/).map((s) => s.trim()).filter(Boolean))
            const digestSrc = (raw.worker_digest && typeof raw.worker_digest === 'object')
              ? raw.worker_digest
              : ((raw.compressedDigest && typeof raw.compressedDigest === 'object') ? raw.compressedDigest : {})
            const whatDone = String(
              digestSrc.what_was_done
              || digestSrc.whatWasDone
              || raw.whatWasDone
              || raw.summary
              || raw.output
              || raw.assigned_goal
              || raw.assignedGoal
              || '阶段执行完毕，等待人工审阅压缩摘要。'
            ).trim()
            const touchedFiles = Array.isArray(digestSrc.files_touched)
              ? digestSrc.files_touched
              : (Array.isArray(digestSrc.filesTouched) ? digestSrc.filesTouched : filesList)
            const verificationText = String(
              digestSrc.verification
              || digestSrc.test_result
              || digestSrc.verifyResult
              || raw.verification
              || (statusRaw === 'blocked' ? '存在阻塞项，建议调整目标或退回重跑' : (isApproved ? '已通过主控审批验收' : '分片自检完成，待确认放行'))
            ).trim()
            merged.push({
              id,
              sessionId: raw.session_id || raw.sessionId || id,
              wave: Number(raw.wave) || 3,
              role: roleCode,
              roleLabel: ROLE_LABEL[roleCode] || roleCode,
              title: String(raw.title || raw.name || ('分片任务 ' + id)),
              priority: ['P0', 'P1', 'P2', 'P3'].includes(pri) ? pri : 'P1',
              status: statusRaw || 'pending',
              approvalState: approvalRaw || (isPendingDecision ? 'pending_approval' : (isApproved ? 'approved' : 'pending_approval')),
              isPendingDecision,
              isApproved,
              filesOwned: filesList,
              assignedGoal: String(raw.assigned_goal || raw.assignedGoal || raw.prompt || ''),
              nextGoalDefault: String(raw.next_goal || raw.nextGoal || raw.assigned_goal || raw.assignedGoal || '继续推进下一阶段验证与交付集成'),
              digest: {
                whatDone,
                touchedFiles,
                verificationText,
              },
            })
          })
        }
        collect(rawWorkers, 'worker')
        collect(rawGoals, 'goal')
        return merged
      }, [eng, dagData, snapshot])

      const pendingCount = countPendingApprovals(eng ? snapshot : null, eng ? dagData : null)
      const visibleQueueItems = queueFilter === 'pending'
        ? reviewItems.filter((it) => it.isPendingDecision)
        : reviewItems

      const getDraftGoalFor = (item) => (
        Object.prototype.hasOwnProperty.call(nextGoalDrafts, item.id)
          ? nextGoalDrafts[item.id]
          : (item.nextGoalDefault || item.assignedGoal || '')
      )

      const handleApproveItem = async (item) => {
        if (!eng || !item || busyItemId) return
        const nextGoalStr = String(getDraftGoalFor(item) || '').trim() || '继续推进下一阶段集成与验证'
        setBusyItemId(item.id)
        setQueueToast(null)
        const res = await api({
          op: 'planApproveWorker',
          engagement_id: eng,
          engagement: eng,
          session: activeSid || undefined,
          worker_id: item.id,
          session_id: item.sessionId,
          worker_name: item.title,
          decision: 'approved',
          approval_state: 'approved',
          next_goal: nextGoalStr,
        })
        setBusyItemId(null)
        if (!res || res.ok === false) {
          setQueueToast({ tone: 'err', text: '审批提交失败：' + ((res && res.error) || '后端响应异常') })
          return
        }
        setQueueToast({ tone: 'ok', text: '✓ 已审批通过「' + item.title + '」并下达目标：' + nextGoalStr })
        loadApprovalDag()
        if (typeof props.onRefresh === 'function') props.onRefresh()
      }

      const handleRetryItem = async (item) => {
        if (!eng || !item || busyItemId) return
        const updatedGoal = String(getDraftGoalFor(item) || '').trim()
        setBusyItemId(item.id)
        setQueueToast(null)
        if (updatedGoal && updatedGoal !== item.assignedGoal) {
          await api({
            op: 'updateWorkerGoal',
            engagement_id: eng,
            engagement: eng,
            session: activeSid || undefined,
            worker_id: item.id,
            assigned_goal: updatedGoal,
            files_owned: item.filesOwned,
          })
        }
        const res = await api({
          op: 'retryWorkerTask',
          engagement_id: eng,
          engagement: eng,
          session: activeSid || undefined,
          worker_id: item.id,
          next_goal: updatedGoal || undefined,
        })
        setBusyItemId(null)
        if (res && res.ok === false && !/unknown op/i.test(String(res.error || ''))) {
          setQueueToast({ tone: 'err', text: '退回重跑失败：' + (res.error || '请稍后重试') })
          return
        }
        setQueueToast({ tone: 'ok', text: '↻ 已退回并触发「' + item.title + '」重跑分片任务。' })
        loadApprovalDag()
        if (typeof props.onRefresh === 'function') props.onRefresh()
      }

      const handleJumpItemChat = (item) => {
        const res = activateHostAgentChatSession(item, {
          engagement: eng,
          sessionId: activeSid,
          sessionTitle: cleanSessionTitle,
        })
        setQueueToast({
          tone: 'ok',
          text: res.targetSid
            ? ('💬 已切换侧边对话至：' + res.targetTitle)
            : ('💬 已返回侧边对话窗口：' + res.targetTitle),
        })
      }

      const showFullOnboardingCard = (!isBound && !isDismissed) || forceShowGuide
      const boundDisplayName = isBound
        ? ((engName && !isRawUuidName(engName)) ? engName : eng)
        : ''
      const hasActiveTasks = reviewItems.length > 0

      return h('div', { className: 'rt-pane rt-collab-page' },
        /* ── Card 1: SessionOnboardingCard（会话工作台初始化指引） ── */
        showFullOnboardingCard
          ? h('section', { className: 'rt-card rt-onboard-card' },
              h('div', { className: 'rt-onboard-head' },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                  h('span', { className: 'rt-onboard-title' }, '🧭 会话专属工作台初始化指引'),
                  h('span', { className: 'rt-tag rt-tag-active' }, '当前会话：' + sessionBadgeText),
                  sessionCwd
                    ? h('span', { className: 'rt-tag rt-mono', title: sessionCwd }, '目录：' + sessionCwd)
                    : null),
                h('button', {
                  type: 'button',
                  className: 'rt-btn',
                  onClick: handleSkipGuide,
                }, isBound ? '收起指引' : '跳过指引')),

              h('div', { className: 'rt-onboard-steps' },
                h('div', { className: 'rt-onboard-step' },
                  h('strong', null, '① 为当前会话建立 1:1 独立工作台'),
                  h('span', null, '每个对话拥有独立状态与分片锁，彻底杜绝新老会话串数据。')),
                h('div', { className: 'rt-onboard-step' },
                  h('strong', null, '② 对话澄清需求并拆解分片目标'),
                  h('span', null, '通过下方需求澄清卡确认功能范围、负责角色与独占文件目录。')),
                h('div', { className: 'rt-onboard-step' },
                  h('strong', null, '③ 审阅压缩摘要并批准进入下一阶段'),
                  h('span', null, '智能体提交阶段摘要后，在审批队列一键放行或原位修订重跑。'))),

              !isBound
                ? h('div', { className: 'rt-onboard-actions' },
                    h('input', {
                      className: 'rt-input',
                      value: wsNameDraft,
                      onChange: (e) => { setWsNameEdited(true); setWsNameDraft(e.target.value) },
                      placeholder: '输入当前会话专属工作台名称…',
                      style: { flex: '1 1 240px', minWidth: 200 },
                    }),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-btn-primary',
                      disabled: creatingWs,
                      onClick: handleCreateWorkspaceForSession,
                      style: { fontWeight: 700, padding: '6px 14px' },
                    }, creatingWs ? '正在创建…' : '✨ 创建并初始化当前会话工作台'))
                : h('div', { className: 'rt-note', style: { margin: 0 } },
                    '✓ 当前会话已独立绑定工作台「' + boundDisplayName + '」，可直接在下方卡片澄清需求或审阅分片任务。'),

              !isBound && engagements.length > 0
                ? h('details', { className: 'rt-onboard-bind-details' },
                    h('summary', null, '🔗 关联已有项目工作台（共 ' + engagements.length + ' 个可选）'),
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 } },
                      h('select', {
                        className: 'rt-select',
                        value: selectedExistingId,
                        onChange: (e) => setSelectedExistingId(e.target.value),
                        style: { minWidth: 220 },
                      }, engagements.map((item) => h('option', { key: item.id, value: item.id }, item.name || item.id))),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn',
                        disabled: bindingWs || !selectedExistingId,
                        onClick: handleBindExistingWorkspace,
                      }, bindingWs ? '关联中…' : '确认关联')))
                : null,

              onboardNote
                ? h('div', { className: 'rt-err', style: { margin: 0 } }, onboardNote.text)
                : null,

              !isBound
                ? h('div', { className: 'rt-onboard-foot-note' },
                    '跳过后将进入干净的空工作台；若当前会话尚未开始对话，您可随时重新打开本指引。')
                : null)
          : (!isBound && isDismissed
              ? /* Case 2: 已跳过初始化指引紧凑待机条 */
                h('section', { className: 'rt-card rt-onboard-card is-compact' },
                  h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 } },
                      h('span', { className: 'rt-tag' }, '待初始化'),
                      h('span', { style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 } },
                        '当前会话（' + (cleanSessionTitle || '新会话') + '）尚未绑定工作台 · 已跳过初始化指引')),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn' + (!hasConv ? ' rt-btn-primary' : ''),
                      onClick: handleReopenGuide,
                      style: { fontWeight: 700 },
                    }, '🧭 重新获取初始化指引')))
              : /* Case 3: 已独立绑定工作台 1 行身份条 */
                h('section', { className: 'rt-card rt-onboard-card is-compact' },
                  h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 } },
                      h('span', { className: 'rt-tag rt-tag-live' }, '1:1 已绑定'),
                      h('strong', { style: { color: 'var(--dsw-alias-label-primary)' } },
                        '✓ 当前会话已独立绑定工作台：' + boundDisplayName),
                      sessionCwd
                        ? h('span', { className: 'rt-tag rt-mono', title: sessionCwd }, sessionCwd)
                        : null),
                    h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                      !hasConv
                        ? h('button', {
                            type: 'button',
                            className: 'rt-btn',
                            onClick: handleReopenGuide,
                          }, '🧭 查看初始化指引')
                        : null,
                      props.onGo
                        ? h('button', {
                            type: 'button',
                            className: 'rt-btn',
                            onClick: () => props.onGo('overview'),
                          }, '返回总览 →')
                        : null)))),

        /* ── Card 2: WishDialogueCard（需求对话澄清与蓝图立项卡） ── */
        h('section', { className: 'rt-card rt-wish-dialogue-card' },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('strong', { style: { fontSize: 13.5 } }, '💬 需求对话澄清与蓝图立项'),
              h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                '点选澄清维度补充边界约束，生成互不冲突的分片蓝图后立项派发'))),
          h('div', { className: 'rt-clarify-chips-row' },
            h('span', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, '快捷补充澄清维度：'),
            WISH_CLARIFY_CHIPS.map((chip, idx) => h('button', {
              key: 'clarify-' + idx,
              type: 'button',
              className: 'rt-p3-pill',
              title: chip.group + '：' + chip.snippet,
              onClick: () => triggerChipAppend(chip.snippet),
            }, '+ ' + chip.label))),
          h(WishRefinerWizard, {
            engagement: eng,
            engagementName: boundDisplayName,
            sessionId: activeSid,
            sessionTitle: cleanSessionTitle,
            hasActiveWork: hasActiveTasks,
            appendRequest: appendReq,
            onWorkspaceCreated: (createdId) => {
              if (typeof props.onWorkspaceSelect === 'function') props.onWorkspaceSelect(createdId)
            },
            onDecomposed: (res, editedGoals, promptUsed, targetEng) => {
              if (targetEng && targetEng !== eng && typeof props.onWorkspaceSelect === 'function') {
                props.onWorkspaceSelect(targetEng)
              }
              loadApprovalDag()
              if (typeof props.onRefresh === 'function') props.onRefresh()
            },
          })),

        /* ── Card 3: ApprovalQueueCard（阶段验收与 Worker 审批决策卡） ── */
        h('section', { className: 'rt-card rt-approval-queue-wrap' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 } },
            h('strong', { style: { fontSize: 13.5 } }, '✅ 阶段产出与 Worker 审批队列'),
            h('span', {
              className: 'rt-tag ' + (pendingCount > 0 ? 'rt-tag-warn' : 'rt-tag-live'),
            }, pendingCount > 0 ? ('待审批 ' + pendingCount) : '全部已处理'),
            h('div', { className: 'rt-spacer' }),
            h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
              h('button', {
                type: 'button',
                className: 'rt-p3-pill' + (queueFilter === 'pending' ? ' on' : ''),
                onClick: () => setQueueFilter('pending'),
              }, '待决策 (' + pendingCount + ')'),
              h('button', {
                type: 'button',
                className: 'rt-p3-pill' + (queueFilter === 'all' ? ' on' : ''),
                onClick: () => setQueueFilter('all'),
              }, '全部记录 (' + reviewItems.length + ')')),
            eng
              ? h('button', {
                  type: 'button',
                  className: 'rt-btn',
                  disabled: dagLoading,
                  onClick: loadApprovalDag,
                }, dagLoading ? '同步中…' : '刷新队列')
              : null),

          queueToast
            ? h('div', {
                className: queueToast.tone === 'err' ? 'rt-err' : 'rt-note',
                style: { margin: '0 0 10px' },
              }, queueToast.text)
            : null,

          visibleQueueItems.length === 0
            ? h('div', { className: 'rt-empty' },
                '当前暂无需要人工审批的分片任务，智能体完成后将自动在此汇总摘要供您决策。')
            : h('div', { className: 'rt-approval-list' },
                visibleQueueItems.map((item) => {
                  const isBusy = busyItemId === item.id
                  const priCls = 'rt-pri-badge rt-pri-badge-' + item.priority.toLowerCase()
                  return h('div', {
                    key: item.id,
                    className: 'rt-approval-card' + (item.isPendingDecision ? ' is-pending' : ''),
                  },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                      h('span', { className: priCls }, item.priority),
                      h('span', { className: 'rt-tag rt-tag-active' }, 'Wave ' + item.wave + ' · ' + item.roleLabel),
                      h('strong', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, item.title),
                      h('div', { className: 'rt-spacer' }),
                      h('span', {
                        className: 'rt-tag ' + (item.isApproved ? 'rt-tag-live' : (item.isPendingDecision ? 'rt-tag-warn' : '')),
                      }, item.isApproved ? '✓ 已审批通过' : (item.approvalState === 'revision_required' ? '↩ 待修订重跑' : '⏳ 待审批决策'))),

                    item.filesOwned.length > 0
                      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
                          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 } }, '独占文件分片：'),
                          item.filesOwned.map((fp) => h('span', { key: fp, className: 'rt-shard-lock-badge' }, fp)))
                      : null,

                    h('div', { className: 'rt-digest-box rt-approval-digest-grid' },
                      h('div', null,
                        h('b', null, '做了什么：'),
                        h('span', null, item.digest.whatDone)),
                      h('div', null,
                        h('b', null, '改动文件：'),
                        h('span', { className: 'rt-mono' }, item.digest.touchedFiles.length > 0 ? item.digest.touchedFiles.join(', ') : '尚无落盘改动记录')),
                      h('div', null,
                        h('b', null, '验证结果：'),
                        h('span', null, item.digest.verificationText))),

                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                      h('label', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, '下一阶段 / 修订目标：'),
                      h('input', {
                        className: 'rt-input',
                        style: { flex: '1 1 240px', minWidth: 200, fontSize: 12 },
                        value: getDraftGoalFor(item),
                        onChange: (e) => {
                          const v = e.target.value
                          setNextGoalDrafts((prev) => Object.assign({}, prev, { [item.id]: v }))
                        },
                        placeholder: '输入审批放行后的下一阶段目标，或退回重跑的修改说明…',
                      })),

                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                      h('button', {
                        type: 'button',
                        className: 'rt-btn rt-btn-primary rt-plan-approve-btn',
                        disabled: isBusy,
                        onClick: () => handleApproveItem(item),
                      }, isBusy ? '处理中…' : '✓ 审批通过并下达目标'),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn',
                        disabled: isBusy,
                        onClick: () => handleRetryItem(item),
                      }, '↻ 退回重跑该分片'),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn rt-jump-chat-btn',
                        onClick: () => handleJumpItemChat(item),
                      }, '💬 跳转侧边对话')))
                }))))
    }

    /* ---------------------------------------------------------- 04-workflow-deck：动态几何画布、节点编排与审批抽屉 */
    const HARNESS_DAG_WAVES = [
      {
        wave: 'WAVE 0', sub: '主控调度',
        nodes: [
          { id: 'plan', code: '⓪ plan', name: 'Captain 主控架构师', skill: '/dag-schedule', status: 'wait', statusLabel: '待命', slots: 'Orchestrator', thinking: 'high', docTitle: '00_PLAN_CHARTER.md', docBody: '# ⓪ Captain 主控立项与 4-Wave DAG 调度指令\n\n- 调度模式：4-Wave Bounded DAG（默认 6 并发槽，最高 12 槽）\n- 递归委派：允许子智能体继续派发微任务子智能体（maxDepth = 3，默认 thinking = low）\n- 事实库同步：全量写入 PostgreSQL Wire v3 事实库，支持任意节点断点续跑。' },
        ],
      },
      {
        wave: 'WAVE 1', sub: '2 槽双轨立项',
        nodes: [
          { id: 'recon', code: '① recon', name: 'CEO 产品与需求规划', skill: '/office-hours · /plan-ceo-review', status: 'wait', statusLabel: '待命', slots: 'Slot #1', thinking: 'low', docTitle: '01_CEO_PRD_AND_SURFACE.md', docBody: '# ① CEO 产品需求拆解与全量模块测绘\n\n- 技能挂载：/office-hours + /plan-ceo-review\n- 核心产出：P0/P1 模块优先级清单、仓库拓扑与接口边界表\n- 数据库写入：INSERT INTO modules（实时同步）' },
          { id: 'designer', code: '② designer', name: 'Designer 交互与视觉', skill: '/plan-design-review · /design-shotgun', status: 'wait', statusLabel: '待命', slots: 'Slot #2', thinking: 'low', docTitle: '02_DESIGN_SYSTEM_BENTO.md', docBody: '# ② Designer 模块化 Bento UI 与交互规范\n\n- 技能挂载：/plan-design-review + /design-shotgun\n- 视觉规范：WorkBuddy × DSH Brand Blue (#4D6BFE) + 主题自适应探针 + 可视化 DAG 画布\n- 响应式约束：三态（有数据 / 空态 / 报错）全覆盖，无障碍键盘可达。' },
        ],
      },
      {
        wave: 'WAVE 2', sub: '1 槽契约锁',
        nodes: [
          { id: 'assess', code: '③ assess', name: 'Eng Manager 架构与分片', skill: '/plan-eng-review', status: 'wait', statusLabel: '待命', slots: 'Slot #1 (Lock)', thinking: 'low', docTitle: '03_ENG_SHARD_CONTRACT.md', docBody: '# ③ Eng Manager 接口契约与 6 槽独占文件分片\n\n- 技能挂载：/plan-eng-review\n- 分片准则：File-Disjoint Sharding（6 个并发构建槽文件集合严格无交集）\n- 断点快照：写入 dag_nodes 检查点，支持单分片失败独立重试。' },
        ],
      },
      {
        wave: 'WAVE 3', sub: '6 槽并发构建',
        nodes: [
          { id: 'exploit', code: '⑤ exploit #1..#6', name: 'Builder 全栈分片构建', skill: '/parallel-build · 6 Slots', status: 'wait', statusLabel: '待命', slots: 'Slots #1–#6', thinking: 'low', docTitle: '04_BUILDER_SHARDS_LOG.md', docBody: '# ⑤ Builder 6 槽并发分片构建日志\n\n- 并发槽位：Slot #1..#6 并行编码与单元验证\n- 递归子代理：按需派生 Sub-Worker 处理微问题（maxDepth = 3, thinking = low）\n- 实时写库：INSERT INTO sharded_files（极速落盘）' },
          { id: 'subworker', code: '↳ sub-worker', name: '递归子代理 (thinking: low)', skill: 'maxDepth=3 · 微任务分解', status: 'wait', statusLabel: '待命', slots: 'Child Workers', thinking: 'low', isSub: true, docTitle: '05_RECURSIVE_SUBAGENTS.md', docBody: '# ↳ 递归子代理（Recursive Sub-Workers）执行栈\n\n- 派发策略：父 Builder 遇到局部类型推导/单测修复/接口对齐微问题时，直接递归 spawn 子代理\n- 思考档位：默认 thinking = low（极速低延迟）\n- 深度护栏：maxDepth = 3，结果自动回传父分片并同步 PG 事实库。' },
        ],
      },
      {
        wave: 'WAVE 4', sub: '双轨门禁交付',
        nodes: [
          { id: 'vuln-scan', code: '④ vuln-scan', name: 'Reviewer & CSO 代码审查', skill: '/review · /cso', status: 'wait', statusLabel: '待命', slots: 'Gate #1', thinking: 'low', docTitle: '06_CSO_SECURITY_REVIEW.md', docBody: '# ④ Reviewer & CSO 代码质量与安全审计\n\n- 技能挂载：/review + /cso\n- 审计范围：静态代码缺陷、架构边界审查、安全规范门禁\n- 结论同步：UPDATE code_audits（通过后放行发布）。' },
          { id: 'qa', code: '⑥ qa', name: 'QA Lead 自动化回归', skill: '/qa · /benchmark', status: 'wait', statusLabel: '待命', slots: 'Gate #2', thinking: 'low', docTitle: '07_QA_BENCHMARK_GATE.md', docBody: '# ⑥ QA Lead 全量测试套件与性能基线门禁\n\n- 技能挂载：/qa + /benchmark\n- 覆盖率与回归：前端渲染自检 + 打包契约自检 + PG 事务一致性基准\n- 门禁状态：INSERT INTO qa_runs（全部断言通过）。' },
          { id: 'internal', code: '⑦ internal', name: 'Doc & Release 归档发布', skill: '/ship · /document-release', status: 'wait', statusLabel: '待命', slots: 'Release Slot', thinking: 'low', docTitle: '08_FINAL_RELEASE_NOTE.md', docBody: '# ⑦ Doc & Release 最终交付文稿与飞书归档\n\n- 技能挂载：/ship + /document-release\n- 交付闭环：汇总 Wave 1–4 全部文稿与代码产物，生成结构化研发交付报告并触发飞书群聊机器人通知。' },
        ],
      },
    ]

    const P4_CTX_LEGEND = [
      { key: 'sys', label: '系统提示词', color: '#3b82f6' },
      { key: 'tool', label: '工具定义', color: '#8b5cf6' },
      { key: 'user', label: '用户消息', color: '#10b981' },
      { key: 'inject', label: '注入内容', color: '#f59e0b' },
      { key: 'skill', label: '技能注入', color: '#06b6d4' },
      { key: 'asst', label: '助手消息', color: '#ec4899' },
      { key: 'res', label: '工具结果', color: '#6366f1' },
      { key: 'free', label: '空闲窗口', color: 'rgba(148,163,184,0.28)' },
    ]

    const P4_ROLE_META = {
      designer: {
        wave: 1, role: 'designer', avatar: 'WD', color: '#ef4444',
        uiPriority: 'P2', workerTags: ['#ui-canvas', '#design-tokens'],
        defaultTitle: 'Wave1 designer 交互与令牌',
        defaultTok: '0 tok', defaultTokens: 0, defaultCompressedTokens: 0, defaultCompressionPct: 85,
        defaultDur: '待命', defaultSteps: 0, defaultPct: '0%', approvalState: 'pending_approval',
        prompt: '基于项目需求梳理模块化 Bento UI 布局、设计令牌与交互视图规范，并将视觉契约写入事实库。',
        output: '等待执行交互与视觉设计任务。', whatWasDone: '交互与视觉规范分片已就绪。', filesTouched: [],
        nextGoal: '继续推进下一波次契约验证与回归闭环',
      },
      recon: {
        wave: 1, role: 'recon', avatar: 'WR', color: '#10b981',
        uiPriority: 'P2', workerTags: ['#pg-store', '#telemetry'],
        defaultTitle: 'Wave1 recon 产品与数据源',
        defaultTok: '0 tok', defaultTokens: 0, defaultCompressedTokens: 0, defaultCompressionPct: 85,
        defaultDur: '待命', defaultSteps: 0, defaultPct: '0%', approvalState: 'pending_approval',
        prompt: '盘点目标项目全量业务模块、数据接口与核心功能优先级，输出结构化需求与数据源拓扑清单。',
        output: '等待执行需求拆解与数据源测绘。', whatWasDone: '产品与数据源测绘分片已就绪。', filesTouched: [],
        nextGoal: '继续推进下一波次契约验证与回归闭环',
      },
      assess: {
        wave: 2, role: 'assess', avatar: 'WA', color: '#8b5cf6',
        uiPriority: 'P0', workerTags: ['#arch-contract', '#pg-store'],
        defaultTitle: 'Wave2 assess 架构与分片',
        defaultTok: '0 tok', defaultTokens: 0, defaultCompressedTokens: 0, defaultCompressionPct: 85,
        defaultDur: '待命', defaultSteps: 0, defaultPct: '0%', approvalState: 'pending_approval',
        prompt: '基于 Wave 1 需求与设计产出，冻结模块接口契约并划分 File-Disjoint Sharding 无交集开发分片。',
        output: '等待锁定模块接口契约与独占文件分片。', whatWasDone: '系统架构与分片边界待锁定。', filesTouched: [],
        nextGoal: '继续推进下一波次契约验证与回归闭环',
      },
      exploit: {
        wave: 3, role: 'exploit', avatar: 'WB', color: '#3b82f6',
        uiPriority: 'P1', workerTags: ['#ui-canvas', '#pg-store'],
        defaultTitle: 'Wave3 exploit 分片构建',
        defaultTok: '0 tok', defaultTokens: 0, defaultCompressedTokens: 0, defaultCompressionPct: 85,
        defaultDur: '待命', defaultSteps: 0, defaultPct: '0%', approvalState: 'pending_approval',
        prompt: '在独占文件分片内执行全栈编码实现与单元测试自检，并将构建产物同步至 PG 事实库。',
        output: '等待执行分片代码构建与自检。', whatWasDone: '分片编码实现与单元验证就绪。', filesTouched: [],
        nextGoal: '继续推进下一波次契约验证与回归闭环',
      },
      'vuln-scan': {
        wave: 4, role: 'vuln-scan', avatar: 'WC', color: '#f59e0b',
        uiPriority: 'P1', workerTags: ['#sec-audit', '#code-review'],
        defaultTitle: 'Wave4 vuln-scan 代码审查',
        defaultTok: '0 tok', defaultTokens: 0, defaultCompressedTokens: 0, defaultCompressionPct: 85,
        defaultDur: '待命', defaultSteps: 0, defaultPct: '0%', approvalState: 'pending_approval',
        prompt: '对各分片代码变更执行静态缺陷审查、架构边界复核与安全门禁审计。',
        output: '等待执行代码审查与安全门禁校验。', whatWasDone: '代码审查与安全门禁就绪。', filesTouched: [],
        nextGoal: '继续推进下一波次契约验证与回归闭环',
      },
      qa: {
        wave: 4, role: 'qa', avatar: 'WQ', color: '#06b6d4',
        uiPriority: 'P2', workerTags: ['#ui-smoke', '#qa-gate'],
        defaultTitle: 'Wave4 qa 自动化回归',
        defaultTok: '0 tok', defaultTokens: 0, defaultCompressedTokens: 0, defaultCompressionPct: 85,
        defaultDur: '待命', defaultSteps: 0, defaultPct: '0%', approvalState: 'pending_approval',
        prompt: '运行全量单元测试、UI 渲染冒烟测试与打包一致性断言。',
        output: '等待运行自动化测试套件与回归校验。', whatWasDone: '自动化回归测试套件就绪。', filesTouched: [],
        nextGoal: '继续推进下一波次契约验证与回归闭环',
      },
      internal: {
        wave: 4, role: 'internal', avatar: 'WI', color: '#ec4899',
        uiPriority: 'P3', workerTags: ['#release-doc', '#feishu-sync'],
        defaultTitle: 'Wave4 internal 归档发布',
        defaultTok: '0 tok', defaultTokens: 0, defaultCompressedTokens: 0, defaultCompressionPct: 85,
        defaultDur: '待命', defaultSteps: 0, defaultPct: '0%', approvalState: 'pending_approval',
        prompt: '汇总 Wave 1–4 研发产物与交付里程碑，生成结构化交付报告并推送飞书通知。',
        output: '等待汇总研发交付报告与归档。', whatWasDone: '归档发布与交付报告就绪。', filesTouched: [],
        nextGoal: '继续推进下一波次契约验证与回归闭环',
      },
    }

    const PRIORITY_BADGE_META = {
      P0: { cls: 'rt-pri-badge rt-pri-badge-p0', label: 'P0 焦点审批', rank: 0 },
      P1: { cls: 'rt-pri-badge rt-pri-badge-p1', label: 'P1 核心并发', rank: 1 },
      P2: { cls: 'rt-pri-badge rt-pri-badge-p2', label: 'P2 已审归档', rank: 2 },
      P3: { cls: 'rt-pri-badge rt-pri-badge-p3', label: 'P3 辅助归档', rank: 3 },
    }

    const WAVE_PAGE_SIZE = 24

    const inferChildRole = (rawRole, rawTitle) => {
      const r = String(rawRole || '').toLowerCase().trim()
      if (P4_ROLE_META[r]) return r
      const t = String(rawTitle || '').toLowerCase()
      if (t.includes('designer') || t.includes('交互') || t.includes('视觉') || t.includes('设计')) return 'designer'
      if (t.includes('recon') || t.includes('产品') || t.includes('需求') || t.includes('信息收集') || t.includes('数据源')) return 'recon'
      if (t.includes('assess') || t.includes('架构') || t.includes('分片')) return 'assess'
      if (t.includes('vuln') || t.includes('审查') || t.includes('安全') || t.includes('cso')) return 'vuln-scan'
      if (t.includes('qa') || t.includes('测试') || t.includes('回归')) return 'qa'
      if (t.includes('internal') || t.includes('文档') || t.includes('交付')) return 'internal'
      if (t.includes('exploit') || t.includes('builder') || t.includes('构建')) return 'exploit'
      return 'assess'
    }

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

    function HarnessWorkflowDeck(props) {
      const eng = props.engagement || null
      const variant = props.variant === 'cluster' ? 'cluster' : (props.variant || 'overview')
      const isClusterVariant = variant === 'cluster'
      const activeEngagementId = eng || 'default'
      const snapshot = eng ? props.snapshot : null
      const agentsProp = eng ? props.agents : null
      const refreshKey = props.refreshKey || 0
      const { uiMode } = useUI()
      const isNovice = uiMode === 'novice'

      const [mode, setMode] = React.useState('p4')
      const [selId, setSelId] = React.useState('plan')
      const [selAgentId, setSelAgentId] = React.useState(null)
      const [collabSearch, setCollabSearch] = React.useState('')
      const [collabSort, setCollabSort] = React.useState('asc')
      const [taskSearch, setTaskSearch] = React.useState('')
      const [taskFilter, setTaskFilter] = React.useState('all')
      const [expandedTaskId, setExpandedTaskId] = React.useState(null)
      const [zoom, setZoom] = React.useState(100)
      const [p5Expanded, setP5Expanded] = React.useState(false)
      const [p5Filter, setP5Filter] = React.useState('all')
      const [customTasks, setCustomTasks] = React.useState([])
      const [customWorkerNodes, setCustomWorkerNodes] = React.useState([])
      const [workerGoalOverrides, setWorkerGoalOverrides] = React.useState({})
      const [dagState, setDagState] = React.useState(null)
      const [localAgents, setLocalAgents] = React.useState(null)
      const [domTel, setDomTel] = React.useState(() => readHostDomTelemetry())
      const [toast, setToast] = React.useState(null)
      const [webhook, setWebhook] = React.useState('https://open.feishu.cn/open-apis/bot/v2/hook/lmtagent-workflow')
      const [feishuOnNode, setFeishuOnNode] = React.useState(true)
      const [feishuOnGate, setFeishuOnGate] = React.useState(true)
      const [feishuOnShip, setFeishuOnShip] = React.useState(true)
      const [feishuSaving, setFeishuSaving] = React.useState(false)
      const [approvedWorkerMap, setApprovedWorkerMap] = React.useState({})

      const [canvasSearch, setCanvasSearch] = React.useState('')
      const [canvasFilter, setCanvasFilter] = React.useState('all')
      const [wavePageLimits, setWavePageLimits] = React.useState({})
      const [showAddShardForm, setShowAddShardForm] = React.useState(false)
      const [newShardTitle, setNewShardTitle] = React.useState('')
      const [newShardRole, setNewShardRole] = React.useState('exploit')
      const [newShardWave, setNewShardWave] = React.useState(3)
      const [newShardGoal, setNewShardGoal] = React.useState('')
      const [newShardFiles, setNewShardFiles] = React.useState('')
      const [addingShardBusy, setAddingShardBusy] = React.useState(false)

      const [editingGoalOpen, setEditingGoalOpen] = React.useState(false)
      const [editGoalDraft, setEditGoalDraft] = React.useState('')
      const [editFilesDraft, setEditFilesDraft] = React.useState('')
      const [savingGoalBusy, setSavingGoalBusy] = React.useState(false)
      const [customNextGoal, setCustomNextGoal] = React.useState('')
      const [reviewNote, setReviewNote] = React.useState('')
      const [approvingBusy, setApprovingBusy] = React.useState(false)
      const [retryingBusy, setRetryingBusy] = React.useState(false)

      React.useEffect(() => {
        setDagState(null)
        setLocalAgents(null)
        setCustomTasks([])
        setCustomWorkerNodes([])
        setWorkerGoalOverrides({})
        setApprovedWorkerMap({})
        setSelAgentId(null)
      }, [eng])

      const reloadDag = React.useCallback(() => {
        if (!eng) {
          setDagState(null)
          setLocalAgents(null)
          return
        }
        if (!_isCanvasDragging) {
          setDomTel(readHostDomTelemetry())
        }
        if (!agentsProp) {
          api({ op: 'agentsStatus', engagement: eng }).then((r) => {
            if (r && r.ok !== false) setLocalAgents(r)
          }, () => {})
        }
        api({ op: 'workflowDag', engagement: eng }).then((r) => {
          if (r && r.ok !== false) {
            setDagState(r)
            if (r.feishu_config && typeof r.feishu_config === 'object') {
              if (r.feishu_config.webhook_url) setWebhook(String(r.feishu_config.webhook_url))
            }
          }
        }, () => {})
      }, [eng, agentsProp])

      React.useEffect(() => {
        reloadDag()
      }, [reloadDag, refreshKey])

      useHostEvents(eng, reloadDag, 700)

      const agents = agentsProp || localAgents
      const runningAgents = (agents && Array.isArray(agents.running)) ? agents.running : []
      const dagNodesById = new Map()
      if (dagState && Array.isArray(dagState.nodes)) {
        for (const dn of dagState.nodes) {
          if (dn && dn.id) dagNodesById.set(dn.id, dn)
        }
      }
      const stats = (snapshot && snapshot.stats) || {}

      const dynamicWaves = HARNESS_DAG_WAVES.map((w) => ({
        wave: w.wave,
        sub: w.sub,
        nodes: w.nodes.map((n) => {
          const dn = dagNodesById.get(n.id)
          const dnStatus = dn ? String(dn.status || '').toLowerCase() : ''
          const isRunningSub = runningAgents.some((ra) => String(ra.label || '').toLowerCase().includes(n.id))
          let status = 'wait'
          let statusLabel = '待命'
          if (['error', 'failed', 'blocked', 'timeout', 'shard_violation'].includes(dnStatus)) {
            status = 'error'
            statusLabel = '异常待修复'
          } else if (isRunningSub || dnStatus === 'running') {
            status = 'run'
            statusLabel = '运行中'
          } else if (dn && (dnStatus === 'done' || dnStatus === 'completed' || (Number(dn.steps) || 0) > 0)) {
            status = 'done'
            statusLabel = '已完成 (' + (dn.steps || 1) + '步)'
          } else if (n.id === 'recon' && (Number(stats.assets) || 0) > 0) {
            status = 'done'
            statusLabel = '已测绘 (' + stats.assets + ')'
          } else if (n.id === 'vuln-scan' && (Number(stats.vulns) || 0) > 0) {
            status = 'done'
            statusLabel = '已审查 (' + stats.vulns + ')'
          } else if (n.id === 'exploit' && (Number(stats.steps) || 0) > 0) {
            status = 'done'
            statusLabel = '已执行 (' + stats.steps + '步)'
          }
          return Object.assign({}, n, {
            status,
            statusLabel,
            lastDecision: (dn && (dn.last_decision || dn.summary || dn.note)) || null,
          })
        }),
      }))
      const allNodes = dynamicWaves.reduce((acc, w) => acc.concat(w.nodes), [])
      const selected = allNodes.find((n) => n.id === selId) || allNodes[0]

      const fusedChildren = []
      const seenChildKeys = new Set()
      const pushChild = (raw) => {
        if (!raw) return
        const roleKey = inferChildRole(raw.role || raw.agent_role, raw.title || raw.label || raw.name)
        const meta = P4_ROLE_META[roleKey] || P4_ROLE_META.assess
        const title = String(raw.title || raw.label || raw.name || meta.defaultTitle).trim()
        const explicitId = String(raw.id || raw.worker_id || raw.workerId || '').trim()
        const dedupKey = explicitId ? ('id:' + explicitId) : (roleKey + ':' + title)
        if (seenChildKeys.has(dedupKey)) return
        seenChildKeys.add(dedupKey)

        const rawStatus = String(raw.status || raw.state || raw.activity || '').toLowerCase().trim()
        const isErr = ['error', 'failed', 'blocked', 'timeout', 'shard_violation'].includes(rawStatus)
          || Boolean(raw.shard_violation || raw.shardViolation)
        const isRun = !isErr && (rawStatus === 'running' || rawStatus === 'run' || String(raw.activity || '').toLowerCase() === 'running')
        const isPending = !isErr && !isRun && (rawStatus === 'pending' || rawStatus === 'queued' || rawStatus === 'wait' || rawStatus === 'waiting')

        const tokVal = Number(raw.rawTokens) || Number(raw.tokens) || parseTokNum(raw.tokenLabel) || 0
        const tokLbl = raw.tokenLabel
          ? (String(raw.tokenLabel).toLowerCase().includes('tok') ? String(raw.tokenLabel) : String(raw.tokenLabel) + ' tok')
          : (fmtTokNum(tokVal) + ' tok')
        const costVal = raw.costLabel || (tokVal > 0 ? ('¥' + Math.max(0.01, (tokVal / 1000000) * 1.8).toFixed(2)) : '¥0.00')
        const durLbl = raw.durationLabel || raw.duration || (isErr ? '异常中断' : (isRun ? '运行中' : (isPending ? '待调度' : '已完成')))
        const stepsVal = Number(raw.steps) || 0
        const ctxPctVal = raw.ctxPct || meta.defaultPct
        const color = isErr
          ? '#ef4444'
          : (raw.color || meta.color || ['#ef4444', '#10b981', '#8b5cf6', '#3b82f6'][fusedChildren.length % 4])
        const waveMatch = /Wave\s*(\d)\s+([a-z])/i.exec(title)
        const avatar = raw.avatar || (waveMatch ? ('W' + waveMatch[2].toUpperCase()) : meta.avatar)
        const childId = explicitId || ('agent-' + roleKey + '-' + fusedChildren.length)
        const compressedTokens = Number(raw.compressedTokens) || (tokVal > 0 ? Math.max(400, Math.round(tokVal * 0.15)) : 0)
        const compressionPct = Number(raw.compressionPct) || (tokVal > 0
          ? Math.max(70, Math.min(94, Math.round((1 - compressedTokens / Math.max(1, tokVal)) * 100)))
          : 0)

        const overrideApproval = approvedWorkerMap[childId]
        const rawApproval = overrideApproval
          ? overrideApproval.decisionState
          : (raw.approvalState || raw.approval_state || (isErr ? 'revision_required' : ((isRun || isPending) ? 'pending_approval' : 'approved')))
        const uiPriority = isErr
          ? 'P0'
          : (raw.uiPriority || raw.ui_priority || (isRun || rawApproval === 'pending_approval' || rawApproval === 'revision_required' ? 'P0' : (meta.uiPriority || 'P2')))
        const workerTags = Array.isArray(raw.workerTags) && raw.workerTags.length > 0
          ? raw.workerTags
          : (Array.isArray(raw.worker_tags) && raw.worker_tags.length > 0 ? raw.worker_tags : (meta.workerTags || ['#ui-canvas', '#pg-store']))

        const goalOverride = workerGoalOverrides[childId]
        const rawFilesOwned = goalOverride
          ? goalOverride.filesOwned
          : (Array.isArray(raw.files_owned)
            ? raw.files_owned
            : (Array.isArray(raw.filesOwned)
              ? raw.filesOwned
              : (Array.isArray(raw.filesTouched) ? raw.filesTouched : (meta.filesTouched || []))))
        const assignedGoalStr = (goalOverride && goalOverride.assignedGoal)
          || raw.assigned_goal
          || raw.assignedGoal
          || raw.prompt
          || raw.inputPrompt
          || raw.task
          || meta.prompt

        const digestObj = (raw.compressedDigest && typeof raw.compressedDigest === 'object')
          ? {
              whatWasDone: raw.compressedDigest.whatWasDone || raw.output || (isErr ? (raw.error || '执行异常，等待修复或重跑分片') : (isPending ? assignedGoalStr : meta.whatWasDone)),
              filesTouched: Array.isArray(raw.compressedDigest.filesTouched) && raw.compressedDigest.filesTouched.length > 0
                ? raw.compressedDigest.filesTouched
                : rawFilesOwned,
            }
          : {
              whatWasDone: raw.whatWasDone || raw.output || raw.summary || (isErr ? (raw.error || '执行异常，等待修复或重跑分片') : (isPending ? assignedGoalStr : meta.whatWasDone)),
              filesTouched: rawFilesOwned,
            }

        const resolvedStatus = isErr ? 'error' : (isRun ? 'running' : (isPending ? 'pending' : 'done'))
        const resolvedStatusLabel = isErr ? '异常待修复' : (isRun ? '运行中' : (isPending ? '待执行' : '已完成'))

        fusedChildren.push({
          id: childId,
          sessionId: raw.sessionId || raw.session_id || childId,
          name: title,
          wave: Number(raw.wave) || (waveMatch ? Number(waveMatch[1]) : meta.wave),
          role: roleKey,
          avatar: avatar,
          color: color,
          title: title,
          status: resolvedStatus,
          statusLabel: resolvedStatusLabel,
          uiPriority: uiPriority,
          workerTags: workerTags,
          tokens: tokVal,
          rawTokens: tokVal,
          compressedTokens: compressedTokens,
          compressionPct: compressionPct,
          approvalState: rawApproval,
          compressedDigest: digestObj,
          assignedGoal: assignedGoalStr,
          filesOwned: rawFilesOwned,
          nextGoal: (overrideApproval && overrideApproval.nextGoal) || raw.nextGoal || raw.next_goal || meta.nextGoal || '继续推进下一波次契约验证与回归闭环',
          tokenLabel: tokLbl,
          costLabel: costVal,
          durationLabel: durLbl,
          steps: stepsVal,
          ctxPct: ctxPctVal,
          prompt: assignedGoalStr,
          inputPrompt: assignedGoalStr,
          output: raw.output || raw.summary || raw.lastDecision || digestObj.whatWasDone || meta.output,
        })
      }

      if (eng) {
        if (agents && agents.agentNetwork && Array.isArray(agents.agentNetwork.children)) {
          for (const c of agents.agentNetwork.children) pushChild(c)
        }
        if (agents && Array.isArray(agents.children)) {
          for (const c of agents.children) pushChild(c)
        }
        if (domTel && Array.isArray(domTel.domSubagents)) {
          for (const c of domTel.domSubagents) pushChild(c)
        }
        for (const ra of runningAgents) {
          pushChild({
            id: ra.id || ra.sessionId,
            sessionId: ra.sessionId || ra.id,
            role: inferChildRole(ra.role, ra.label),
            title: ra.label || 'Wave2 assess 架构与分片',
            status: 'running',
            tokenLabel: ra.tokenLabel,
            durationLabel: ra.durationLabel || '运行中',
          })
        }
        if (dagState) {
          const dagWorkerTasks = Array.isArray(dagState.worker_tasks)
            ? dagState.worker_tasks
            : (Array.isArray(dagState.workerTasks) ? dagState.workerTasks : [])
          for (const wt of dagWorkerTasks) pushChild(wt)

          const dagPlanGoals = Array.isArray(dagState.plan_goals)
            ? dagState.plan_goals
            : (Array.isArray(dagState.planGoals)
              ? dagState.planGoals
              : (Array.isArray(dagState.subgoals) ? dagState.subgoals : []))
          for (const pg of dagPlanGoals) pushChild(pg)

          if (Array.isArray(dagState.nodes)) {
            for (const dn of dagState.nodes) {
              if (!dn || dn.id === 'plan') continue
              const st = String(dn.status || '').toLowerCase()
              const hasRealActivity = st === 'running'
                || st === 'done'
                || st === 'completed'
                || ['error', 'failed', 'blocked', 'timeout', 'shard_violation'].includes(st)
                || Number(dn.steps) > 0
              if (hasRealActivity) {
                pushChild({
                  id: dn.worker_id || dn.id,
                  role: dn.role || dn.id,
                  wave: dn.wave,
                  title: dn.title || dn.name || (P4_ROLE_META[dn.id] && P4_ROLE_META[dn.id].defaultTitle),
                  status: st,
                  steps: dn.steps,
                  assigned_goal: dn.assigned_goal || dn.prompt,
                  files_owned: dn.files_owned,
                  output: dn.last_decision || dn.summary || dn.note,
                })
              }
            }
          }
        }
        if (Array.isArray(props.decomposedGoals)) {
          for (const dg of props.decomposedGoals) {
            pushChild(Object.assign({ status: dg.status || 'pending' }, dg))
          }
        }
        for (const cw of customWorkerNodes) {
          pushChild(cw)
        }
      }

      const pendingApprovalCount = fusedChildren.filter((c) => (
        c.approvalState === 'pending_approval'
        || c.approvalState === 'waiting_approval'
        || c.approvalState === 'revision_required'
      )).length

      const canvasFilteredChildren = fusedChildren.filter((c) => {
        if (canvasFilter === 'p0' && c.uiPriority !== 'P0') return false
        if (canvasFilter === 'running' && c.status !== 'running') return false
        if (canvasFilter === 'pending' && c.approvalState !== 'pending_approval' && c.approvalState !== 'waiting_approval' && c.approvalState !== 'revision_required') return false
        if (canvasFilter === 'error' && c.status !== 'error' && c.approvalState !== 'revision_required') return false
        if (canvasSearch.trim()) {
          const q = canvasSearch.trim().toLowerCase()
          const filesHay = Array.isArray(c.filesOwned) ? c.filesOwned.join(' ').toLowerCase() : ''
          return c.title.toLowerCase().includes(q)
            || c.role.toLowerCase().includes(q)
            || String(c.assignedGoal || '').toLowerCase().includes(q)
            || filesHay.includes(q)
        }
        return true
      })

      const hostSessions = (agents && Array.isArray(agents.host_sessions)) ? agents.host_sessions : []
      const activeHostSess = hostSessions.find((hs) => hs.id === (sessionId || domTel.sessionId)) || hostSessions[0] || null
      const workspaceDisplayTitle = (props.engagementName && !isRawUuidName(props.engagementName) ? props.engagementName : null)
        || (snapshot && snapshot.engagement && snapshot.engagement.name && !isRawUuidName(snapshot.engagement.name) ? snapshot.engagement.name : null)
        || (eng ? ((activeHostSess && (activeHostSess.displayLabel || activeHostSess.title)) || sessionTitle || eng) : (sessionTitle || '待初始化会话'))
        || 'LMTAgent 主控工作台'
      const rootTokens = domTel.tokens > 0
        ? domTel.tokens
        : ((activeHostSess && activeHostSess.tokens > 0) ? activeHostSess.tokens : 0)
      const rootTokensLabel = domTel.contextUsedLabel
        ? (domTel.contextUsedLabel + ' tok')
        : (domTel.tokens > 0 ? (domTel.tokenLabel + ' tok') : (fmtTokNum(rootTokens) + ' tok'))
      const rootCostLabel = domTel.costLabel || (rootTokens > 0 ? ('¥' + Math.max(0.01, (rootTokens / 1000000) * 1.8).toFixed(2)) : '¥0.00')
      const rootSteps = domTel.steps > 0
        ? domTel.steps
        : ((activeHostSess && activeHostSess.steps > 0) ? activeHostSess.steps : (Number(stats.steps) || 0))
      const rootDuration = (activeHostSess && activeHostSess.durationLabel) || (rootSteps > 0 ? '实时同步' : '待命')
      const rootCtxPct = domTel.contextPct || (rootTokens > 0 ? '实时' : '0%')
      const childTokSum = fusedChildren.reduce((s, c) => s + (Number(c.tokens) || 0), 0)
      const ctxSumLabel = fmtTokNum((parseTokNum(domTel.contextUsedLabel) || rootTokens) + childTokSum)
      const totalAgents = eng ? (1 + fusedChildren.length) : 0
      const runningCount = eng ? (fusedChildren.filter((c) => c.status === 'running').length + (runningAgents.length > 0 ? 1 : 0)) : 0
      const errorCount = fusedChildren.filter((c) => c.status === 'error').length

      const allCollabEvents = []
      fusedChildren.forEach((c, idx) => {
        allCollabEvents.push({
          id: 'ev-start-' + c.id, agentId: c.id, avatar: c.avatar, color: c.color, title: c.title,
          kind: '+', label: '主控委派 ' + c.avatar, timeOrder: idx * 3 + 1, xPct: Math.min(82, 14 + idx * 22),
        })
        allCollabEvents.push({
          id: 'ev-write-' + c.id, agentId: c.id, avatar: c.avatar, color: c.color, title: c.title,
          kind: '■', label: c.avatar + ' 写入契约/产物', timeOrder: idx * 3 + 2, xPct: Math.min(88, 36 + idx * 22),
        })
        allCollabEvents.push({
          id: 'ev-done-' + c.id, agentId: c.id, avatar: c.avatar, color: c.color, title: c.title,
          kind: c.status === 'error' ? '!' : (c.status === 'running' ? '●' : '✓'),
          label: c.status === 'error'
            ? (c.avatar + ' 异常待修复')
            : (c.status === 'running' ? (c.avatar + ' 正在执行分片') : (c.avatar + ' 摘要压缩写回主控')),
          timeOrder: idx * 3 + 3, xPct: Math.min(94, 58 + idx * 18),
        })
      })
      const sortedEvents = allCollabEvents.slice().sort((a, b) => (collabSort === 'asc' ? a.timeOrder - b.timeOrder : b.timeOrder - a.timeOrder))
      const filteredEvents = sortedEvents.filter((ev) => {
        if (selAgentId && selAgentId !== 'root' && ev.agentId !== selAgentId) return false
        if (collabSearch.trim()) {
          const q = collabSearch.trim().toLowerCase()
          return ev.title.toLowerCase().includes(q) || ev.avatar.toLowerCase().includes(q) || ev.label.toLowerCase().includes(q)
        }
        return true
      })

      const visibleLanes = [
        {
          id: 'root', avatar: '主控', title: workspaceDisplayTitle, color: '#3b82f6', isRoot: true,
          uiPriority: 'P0', workerTags: ['#plan-orchestrator', '#lmtex-loop'],
          compressionPct: fusedChildren.length > 0 ? 85 : 0, approvalState: 'approved', tokenLabel: rootTokensLabel,
        },
      ].concat(fusedChildren.filter((c) => {
        if (!collabSearch.trim()) return true
        const q = collabSearch.trim().toLowerCase()
        return c.title.toLowerCase().includes(q) || c.avatar.toLowerCase().includes(q) || c.role.toLowerCase().includes(q)
      }))

      const allTasks = fusedChildren.map((c) => ({
        id: 'task-' + c.id, agentId: c.id, sessionId: c.sessionId, avatar: c.avatar, color: c.color,
        title: c.title, role: c.role, wave: c.wave, uiPriority: c.uiPriority, workerTags: c.workerTags,
        compressionPct: c.compressionPct, approvalState: c.approvalState,
        status: c.status === 'running' ? 'run' : (c.status === 'pending' || c.status === 'error' ? 'wait' : 'done'),
        rawStatus: c.status,
        statusBadge: c.status === 'error'
          ? '⚠ 异常待修复'
          : (c.status === 'running' ? '● 进行中' : (c.status === 'pending' ? '○ 待执行' : '● 已完成')),
        prompt: c.prompt, output: c.output, tokenLabel: c.tokenLabel, durationLabel: c.durationLabel, steps: c.steps,
      })).concat(customTasks)

      const runTaskCount = allTasks.filter((t) => t.status === 'run').length
      const waitTaskCount = allTasks.filter((t) => t.status === 'wait').length
      const doneTaskCount = allTasks.filter((t) => t.status === 'done').length

      const filteredTasks = allTasks.filter((t) => {
        if (selAgentId && selAgentId !== 'root' && t.agentId !== selAgentId) return false
        if (taskFilter !== 'all' && t.status !== taskFilter) return false
        if (taskSearch.trim()) {
          const q = taskSearch.trim().toLowerCase()
          return t.title.toLowerCase().includes(q) || t.prompt.toLowerCase().includes(q) || t.avatar.toLowerCase().includes(q)
        }
        return true
      })

      const primaryTreeChild = fusedChildren.find((c) => c.status === 'running' || c.status === 'error')
        || fusedChildren[fusedChildren.length - 1]
        || fusedChildren[0]
        || null
      const completedGroupChildren = fusedChildren.filter((c) => !primaryTreeChild || c.id !== primaryTreeChild.id)
      const doneGroupList = completedGroupChildren.length > 0
        ? completedGroupChildren
        : (fusedChildren.length > 1 ? fusedChildren.slice(0, fusedChildren.length - 1) : [])

      const [panZoom, setPanZoom] = React.useState({ x: 0, y: 0, scale: 1 })
      const panRef = React.useRef({ x: 0, y: 0, scale: 1, dragging: false, startX: 0, startY: 0, rafId: 0 })
      const stageDomRef = React.useRef(null)
      const viewportDomRef = React.useRef(null)
      const horizStageDomRef = React.useRef(null)
      const fanoutColDomRef = React.useRef(null)
      const rootCardDomRef = React.useRef(null)
      const wavesStackDomRef = React.useRef(null)
      const waveCardDomRefs = React.useRef({})

      const [treeDirection, setTreeDirection] = React.useState(() => {
        try {
          return (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('rt-tree-direction')) || 'horizontal'
        } catch (e) {
          return 'horizontal'
        }
      })

      const toggleTreeDirection = () => {
        setTreeDirection((prev) => {
          const next = prev === 'horizontal' ? 'vertical' : 'horizontal'
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.setItem('rt-tree-direction', next)
            }
          } catch (e) { /* ignore */ }
          return next
        })
      }

      const applyStageTransform = React.useCallback((x, y, s, smooth = false) => {
        panRef.current.x = x
        panRef.current.y = y
        panRef.current.scale = s
        const el = stageDomRef.current
        if (el) {
          if (el.classList && typeof el.classList.toggle === 'function') {
            el.classList.toggle('smooth-zoom', Boolean(smooth))
          }
          if (el.style) {
            el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`
          }
        }
      }, [])

      React.useEffect(() => {
        const releaseDragGuard = (ev) => {
          if (ev && ev.type === 'keydown' && ev.key !== 'Escape') return
          if (panRef.current.dragging || _isCanvasDragging) {
            _isCanvasDragging = false
            panRef.current.dragging = false
            const vp = viewportDomRef.current
            if (vp && vp.classList && typeof vp.classList.remove === 'function') {
              vp.classList.remove('is-dragging')
              vp.classList.remove('grabbing')
            }
          }
        }
        try {
          if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('mouseup', releaseDragGuard)
            window.addEventListener('blur', releaseDragGuard)
            window.addEventListener('keydown', releaseDragGuard)
          }
        } catch { /* ignore */ }
        return () => {
          _isCanvasDragging = false
          panRef.current.dragging = false
          if (panRef.current.rafId && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(panRef.current.rafId)
            panRef.current.rafId = 0
          }
          try {
            if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
              window.removeEventListener('mouseup', releaseDragGuard)
              window.removeEventListener('blur', releaseDragGuard)
              window.removeEventListener('keydown', releaseDragGuard)
            }
          } catch { /* ignore */ }
        }
      }, [])

      const [expandedWaves, setExpandedWaves] = React.useState({})
      const [animatingSpawnIds, setAnimatingSpawnIds] = React.useState({})
      const [animatingCompleteIds, setAnimatingCompleteIds] = React.useState({})
      const [hubAbsorbing, setHubAbsorbing] = React.useState(false)
      const prevChildStateRef = React.useRef(null)

      const handleViewportMouseDown = (e) => {
        if (!e) return
        if (typeof e.button === 'number' && e.button !== 0) return
        if (e.target && typeof e.target.closest === 'function') {
          if (e.target.closest('button, input, select, textarea, a, [role="button"], .rt-p4-node-card, .rt-tree-wave-card')) return
        }
        _isCanvasDragging = true
        panRef.current.dragging = true
        panRef.current.startX = (Number(e.clientX) || 0) - panRef.current.x
        panRef.current.startY = (Number(e.clientY) || 0) - panRef.current.y
        const vp = e.currentTarget || viewportDomRef.current
        if (vp && vp.classList && typeof vp.classList.add === 'function') {
          vp.classList.add('is-dragging')
          vp.classList.add('grabbing')
        }
      }

      const handleViewportMouseMove = (e) => {
        if (!panRef.current.dragging || !e) return
        const stEl = stageDomRef.current
        const maxPanX = Math.max(800, Number(stEl && stEl.scrollWidth) || 0)
        const maxPanY = Math.max(800, Number(stEl && stEl.scrollHeight) || 0)
        const nx = Math.max(-maxPanX, Math.min(maxPanX, Math.round((Number(e.clientX) || 0) - panRef.current.startX)))
        const ny = Math.max(-maxPanY, Math.min(maxPanY, Math.round((Number(e.clientY) || 0) - panRef.current.startY)))
        if (panRef.current.rafId && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(panRef.current.rafId)
        }
        if (typeof requestAnimationFrame === 'function') {
          panRef.current.rafId = requestAnimationFrame(() => {
            applyStageTransform(nx, ny, panRef.current.scale, false)
          })
        } else {
          applyStageTransform(nx, ny, panRef.current.scale, false)
        }
      }

      const handleViewportMouseUp = (e) => {
        if (!panRef.current.dragging && !_isCanvasDragging) return
        _isCanvasDragging = false
        panRef.current.dragging = false
        if (panRef.current.rafId && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(panRef.current.rafId)
          panRef.current.rafId = 0
        }
        const vp = (e && e.currentTarget) || viewportDomRef.current
        if (vp && vp.classList && typeof vp.classList.remove === 'function') {
          vp.classList.remove('is-dragging')
          vp.classList.remove('grabbing')
        }
        setPanZoom({ x: panRef.current.x, y: panRef.current.y, scale: panRef.current.scale })
      }

      const handleViewportWheel = (e) => {
        if (!e) return
        if (e.ctrlKey || e.metaKey || e.altKey) {
          if (typeof e.preventDefault === 'function') e.preventDefault()
          const delta = (Number(e.deltaY) || 0) < 0 ? 0.08 : -0.08
          const ns = Math.max(0.45, Math.min(1.6, Number((panRef.current.scale + delta).toFixed(2))))
          applyStageTransform(panRef.current.x, panRef.current.y, ns, true)
          setPanZoom({ x: panRef.current.x, y: panRef.current.y, scale: ns })
        }
      }

      const zoomOutCanvas = () => {
        const ns = Math.max(0.45, Number((panRef.current.scale - 0.1).toFixed(2)))
        applyStageTransform(panRef.current.x, panRef.current.y, ns, true)
        setPanZoom({ x: panRef.current.x, y: panRef.current.y, scale: ns })
      }

      const zoomInCanvas = () => {
        const ns = Math.min(1.6, Number((panRef.current.scale + 0.1).toFixed(2)))
        applyStageTransform(panRef.current.x, panRef.current.y, ns, true)
        setPanZoom({ x: panRef.current.x, y: panRef.current.y, scale: ns })
      }

      const resetPanZoom = () => {
        _isCanvasDragging = false
        panRef.current.dragging = false
        applyStageTransform(0, 0, 1, true)
        setPanZoom({ x: 0, y: 0, scale: 1 })
      }

      const fitCanvasToViewport = () => {
        _isCanvasDragging = false
        panRef.current.dragging = false
        let nextScale = 1
        try {
          const vp = viewportDomRef.current
          const st = stageDomRef.current
          const vpW = Number(vp && vp.clientWidth) || 0
          const vpH = Number(vp && vp.clientHeight) || 0
          const stW = Number(st && st.scrollWidth) || 0
          const stH = Number(st && st.scrollHeight) || 0
          if (vpW > 80 && stW > 80) {
            const ratioX = (vpW - 24) / stW
            const ratioY = (vpH > 120 && stH > 80) ? ((vpH - 48) / stH) : ratioX
            nextScale = Math.max(0.45, Math.min(1.15, Number(Math.min(ratioX, Math.max(0.55, ratioY)).toFixed(2))))
          }
        } catch { nextScale = 1 }
        applyStageTransform(0, 0, nextScale, true)
        setPanZoom({ x: 0, y: 0, scale: nextScale })
      }

      const treeZoom = Math.round((panZoom.scale || 1) * 100)

      const P4_WAVE_META = [
        { id: 1, wave: 1, shortLabel: 'Wave 1', subTitle: '立项与需求探索', title: 'Wave 1 · 立项与需求探索', color: '#ec4899' },
        { id: 2, wave: 2, shortLabel: 'Wave 2', subTitle: '架构与数据契约', title: 'Wave 2 · 架构与数据契约', color: '#f59e0b' },
        { id: 3, wave: 3, shortLabel: 'Wave 3', subTitle: '并发分片构建', title: 'Wave 3 · 并发分片构建', color: '#3b82f6' },
        { id: 4, wave: 4, shortLabel: 'Wave 4', subTitle: '审查修复与质量门禁', title: 'Wave 4 · 审查修复与质量门禁', color: '#10b981' },
      ]

      const waveGroupsAll = P4_WAVE_META.map((wm) => {
        const children = canvasFilteredChildren.filter((c) => Math.max(1, Math.min(4, Number(c.wave) || 2)) === wm.wave)
        const runningInWave = children.filter((c) => c.status === 'running').length
        const errorInWave = children.filter((c) => c.status === 'error').length
        const doneInWave = children.filter((c) => c.status === 'done').length
        const tokensInWave = children.reduce((acc, c) => acc + (Number(c.tokens) || 0), 0)
        const progressPct = children.length > 0
          ? Math.max(8, Math.min(100, Math.round(((doneInWave + runningInWave * 0.5) / children.length) * 100)))
          : 0
        const topPriority = errorInWave > 0
          ? 'P0'
          : children.reduce((best, c) => {
              const rBest = (PRIORITY_BADGE_META[best] && PRIORITY_BADGE_META[best].rank) ?? 2
              const rCur = (PRIORITY_BADGE_META[c.uiPriority] && PRIORITY_BADGE_META[c.uiPriority].rank) ?? 2
              return rCur < rBest ? c.uiPriority : best
            }, children.length > 0 ? (children[0].uiPriority || 'P2') : 'P2')
        return {
          id: wm.wave,
          wave: wm.wave,
          shortLabel: isNovice ? ('步骤 ' + wm.wave) : wm.shortLabel,
          subTitle: wm.subTitle,
          title: formatWaveHeaderByMode(wm.wave, wm.title, uiMode),
          color: errorInWave > 0 ? '#ef4444' : wm.color,
          children: children,
          runningInWave: runningInWave,
          errorInWave: errorInWave,
          doneInWave: doneInWave,
          tokensInWave: tokensInWave,
          tokenLabel: fmtTokNum(tokensInWave) + ' tok',
          progressPct: progressPct,
          topPriority: topPriority,
        }
      })

      const activeWaveGroups = waveGroupsAll.filter((wg) => wg.children.length > 0)

      const isWaveExpanded = (wgOrId) => {
        const wg = (typeof wgOrId === 'number' || typeof wgOrId === 'string')
          ? (waveGroupsAll.find((g) => g.wave === Number(wgOrId)) || null)
          : wgOrId
        if (!wg) return false
        if (Object.prototype.hasOwnProperty.call(expandedWaves, wg.wave)) {
          return Boolean(expandedWaves[wg.wave])
        }
        if (wg.runningInWave > 0 || wg.errorInWave > 0) return true
        if (canvasFilteredChildren.length <= 4 && wg.children.length > 0) return true
        if (wg.children.length > 3) return false
        const anyRunningWave = activeWaveGroups.some((g) => g.runningInWave > 0)
        if (!anyRunningWave && activeWaveGroups[activeWaveGroups.length - 1] && activeWaveGroups[activeWaveGroups.length - 1].wave === wg.wave) {
          return true
        }
        return false
      }

      const toggleWaveExpand = (waveNum) => {
        const targetGroup = activeWaveGroups.find((g) => g.wave === waveNum) || waveGroupsAll.find((g) => g.wave === waveNum)
        const currentExpanded = isWaveExpanded(targetGroup)
        setExpandedWaves((prev) => Object.assign({}, prev, { [waveNum]: !currentExpanded }))
      }

      const expandAllWaves = () => setExpandedWaves({ 1: true, 2: true, 3: true, 4: true })
      const collapseAllWaves = () => setExpandedWaves({ 1: false, 2: false, 3: false, 4: false })
      const autoFoldWaves = () => setExpandedWaves({})
      const allWavesExpanded = activeWaveGroups.length > 0 && activeWaveGroups.every((wg) => isWaveExpanded(wg))

      const [fanoutGeom, setFanoutGeom] = React.useState(null)
      const fanoutGeomRef = React.useRef(null)

      const measureHorizontalFanout = React.useCallback(() => {
        try {
          const colEl = fanoutColDomRef.current || wavesStackDomRef.current
          if (!colEl || typeof colEl.getBoundingClientRect !== 'function') return
          const colRect = colEl.getBoundingClientRect()
          if (!colRect || !(colRect.height > 0)) return
          const curScale = Math.max(0.2, Number(panRef.current.scale) || 1)
          const stackEl = wavesStackDomRef.current
          const rootEl = rootCardDomRef.current
          const stackRect = (stackEl && typeof stackEl.getBoundingClientRect === 'function')
            ? stackEl.getBoundingClientRect()
            : null
          const rootRect = (rootEl && typeof rootEl.getBoundingClientRect === 'function')
            ? rootEl.getBoundingClientRect()
            : null
          const rawHeight = Math.max(
            stackRect && stackRect.height > 0 ? stackRect.height : 0,
            rootRect && rootRect.height > 0 ? rootRect.height : 0,
            colRect.height
          )
          const totalH = Math.max(140, Math.round(rawHeight / curScale))
          let yRoot = Math.round(totalH / 2)
          if (rootRect && rootRect.height > 0) {
            yRoot = Math.round(((rootRect.top + rootRect.height / 2) - colRect.top) / curScale)
          }
          const waveYs = {}
          const cardsMap = waveCardDomRefs.current || {}
          const waveKeys = Object.keys(cardsMap)
          for (let i = 0; i < waveKeys.length; i += 1) {
            const wk = waveKeys[i]
            const cEl = cardsMap[wk]
            if (cEl && typeof cEl.getBoundingClientRect === 'function') {
              const cRect = cEl.getBoundingClientRect()
              if (cRect && cRect.height > 0) {
                waveYs[wk] = Math.round(((cRect.top + cRect.height / 2) - colRect.top) / curScale)
              }
            }
          }
          const prev = fanoutGeomRef.current
          if (prev && Math.abs(prev.height - totalH) <= 1 && Math.abs(prev.yRoot - yRoot) <= 1) {
            const prevKeys = Object.keys(prev.waveYs || {})
            const nextKeys = Object.keys(waveYs)
            if (
              prevKeys.length === nextKeys.length
              && nextKeys.every((k) => typeof prev.waveYs[k] === 'number' && Math.abs(prev.waveYs[k] - waveYs[k]) <= 1)
            ) {
              return
            }
          }
          const nextGeom = { height: totalH, yRoot: yRoot, waveYs: waveYs }
          fanoutGeomRef.current = nextGeom
          setFanoutGeom(nextGeom)
        } catch { /* SSR / stub safe no-op */ }
      }, [])

      const waveLayoutSig = activeWaveGroups.map((g) => g.wave + ':' + g.children.length + ':' + (isWaveExpanded(g) ? 1 : 0) + ':' + (wavePageLimits[g.wave] || WAVE_PAGE_SIZE)).join('|')

      React.useEffect(() => {
        if (!eng || treeDirection !== 'horizontal' || activeWaveGroups.length === 0) return undefined
        measureHorizontalFanout()
        if (typeof ResizeObserver !== 'function') return undefined
        let ro = null
        try {
          ro = new ResizeObserver(() => {
            measureHorizontalFanout()
          })
          if (wavesStackDomRef.current) ro.observe(wavesStackDomRef.current)
          if (rootCardDomRef.current) ro.observe(rootCardDomRef.current)
          const cardsMap = waveCardDomRefs.current || {}
          Object.keys(cardsMap).forEach((k) => {
            if (cardsMap[k]) ro.observe(cardsMap[k])
          })
        } catch { ro = null }
        return () => {
          if (ro && typeof ro.disconnect === 'function') {
            try { ro.disconnect() } catch { /* ignore */ }
          }
        }
      }, [eng, treeDirection, waveLayoutSig, measureHorizontalFanout])

      const childLifecycleSignature = fusedChildren.map((c) => c.id + ':' + c.status).join('|')
      React.useEffect(() => {
        const prevMap = prevChildStateRef.current
        const nextMap = new Map()
        const newlySpawned = {}
        const newlyCompleted = {}
        for (const c of fusedChildren) {
          nextMap.set(c.id, c.status)
          if (prevMap) {
            if (!prevMap.has(c.id)) newlySpawned[c.id] = true
            else if (prevMap.get(c.id) === 'running' && c.status === 'done') newlyCompleted[c.id] = true
          }
        }
        prevChildStateRef.current = nextMap
        if (Object.keys(newlySpawned).length > 0) {
          setAnimatingSpawnIds((prev) => Object.assign({}, prev, newlySpawned))
          setTimeout(() => {
            setAnimatingSpawnIds((prev) => {
              const copy = Object.assign({}, prev)
              Object.keys(newlySpawned).forEach((k) => { delete copy[k] })
              return copy
            })
          }, 450)
        }
        if (Object.keys(newlyCompleted).length > 0) {
          setAnimatingCompleteIds((prev) => Object.assign({}, prev, newlyCompleted))
          setHubAbsorbing(true)
          setTimeout(() => {
            setAnimatingCompleteIds((prev) => {
              const copy = Object.assign({}, prev)
              Object.keys(newlyCompleted).forEach((k) => { delete copy[k] })
              return copy
            })
            setHubAbsorbing(false)
          }, 900)
        }
      }, [childLifecycleSignature])

      const triggerLifecycleDemo = () => {
        const allIdsMap = {}
        fusedChildren.forEach((c) => { allIdsMap[c.id] = true })
        setAnimatingSpawnIds(allIdsMap)
        setAnimatingCompleteIds(allIdsMap)
        setHubAbsorbing(true)
        setToast('✨ 正在演练子智能体派生与回传收尾动效：连线生长 → 弹性派生 → 能量流转 → 产物回传主控')
        setTimeout(() => { setAnimatingSpawnIds({}) }, 520)
        setTimeout(() => { setAnimatingCompleteIds({}); setHubAbsorbing(false) }, 1100)
      }

      const [swimWaveFilter, setSwimWaveFilter] = React.useState('all')
      const [inspectorAgentId, setInspectorAgentId] = React.useState(null)
      const [inspectorDetailCache, setInspectorDetailCache] = React.useState({})

      React.useEffect(() => {
        setInspectorAgentId(selAgentId)
      }, [selAgentId])

      const openAgentInspector = (agentId) => {
        const nextId = agentId || null
        setSelAgentId(nextId === '__closed__' ? null : nextId)
        setInspectorAgentId(nextId)
        setEditingGoalOpen(false)
      }

      React.useEffect(() => {
        const targetId = (inspectorAgentId && inspectorAgentId !== '__closed__')
          ? inspectorAgentId
          : (selAgentId || 'root')
        if (!targetId) return
        api({
          op: 'agentSessionDetail',
          sessionId: targetId,
          agentId: targetId,
          engagement: eng || undefined,
        }).then((r) => {
          if (r && r.ok !== false) {
            setInspectorDetailCache((prev) => Object.assign({}, prev, { [targetId]: r }))
          }
        }, () => {})
      }, [inspectorAgentId, selAgentId, eng])

      const handleCreateCustomShard = () => {
        const titleStr = String(newShardTitle || '').trim()
        if (!titleStr) { setToast('请填写新增分片节点的标题'); return }
        const filesArr = String(newShardFiles || '').split(/[,，\n]+/).map((s) => s.trim()).filter(Boolean)
        const goalStr = String(newShardGoal || titleStr).trim()
        setAddingShardBusy(true)
        api({
          op: 'addCustomWorkerTask',
          engagement_id: activeEngagementId,
          engagement: eng || undefined,
          title: titleStr,
          role: newShardRole,
          wave: Number(newShardWave) || 3,
          assigned_goal: goalStr,
          files_owned: filesArr,
        }).then((res) => {
          setAddingShardBusy(false)
          if (res && res.ok === false && !/unknown op/i.test(String(res.error || ''))) {
            setToast('新增分片节点失败：' + (res.error || '请检查分片冲突'))
            return
          }
          const createdId = (res && (res.worker_id || res.id)) || ('custom-worker-' + (customWorkerNodes.length + 1))
          setCustomWorkerNodes((prev) => prev.concat([{
            id: createdId, wave: Number(newShardWave) || 3, role: newShardRole,
            title: titleStr, assigned_goal: goalStr, files_owned: filesArr, status: (res && res.status) || 'pending',
          }]))
          setNewShardTitle(''); setNewShardGoal(''); setNewShardFiles('')
          setShowAddShardForm(false)
          setToast('✓ 已新增分片节点：' + titleStr)
          reloadDag()
        })
      }

      const handleSaveWorkerGoal = (targetAgent) => {
        if (!targetAgent) return
        const goalStr = String(editGoalDraft || '').trim()
        const filesArr = String(editFilesDraft || '').split(/[,，\n]+/).map((s) => s.trim()).filter(Boolean)
        if (!goalStr) { setToast('分片目标不能为空'); return }
        setSavingGoalBusy(true)
        api({
          op: 'updateWorkerGoal',
          engagement_id: activeEngagementId,
          engagement: eng || undefined,
          worker_id: targetAgent.id,
          assigned_goal: goalStr,
          files_owned: filesArr,
        }).then((res) => {
          setSavingGoalBusy(false)
          if (res && res.ok === false && !/unknown op/i.test(String(res.error || ''))) {
            setToast('保存目标失败：' + (res.error || '分片锁冲突'))
            return
          }
          setWorkerGoalOverrides((prev) => Object.assign({}, prev, {
            [targetAgent.id]: { assignedGoal: goalStr, filesOwned: filesArr },
          }))
          setEditingGoalOpen(false)
          setToast('💾 已更新分片目标与独占文件：' + (targetAgent.title || targetAgent.id))
          reloadDag()
        })
      }

      const handlePlanApproveWorker = (detailTarget, decisionOverride) => {
        if (!detailTarget || approvingBusy) return
        const decision = decisionOverride === 'revision_requested' ? 'revision_requested' : 'approved'
        const nextGoalStr = String(customNextGoal || detailTarget.nextGoal || '继续推进下一波次契约验证与回归闭环').trim()
        const noteStr = String(reviewNote || '').trim()
        setApprovingBusy(true)
        api({
          op: 'planApproveWorker',
          engagement_id: activeEngagementId,
          engagement: eng || undefined,
          worker_id: detailTarget.id,
          session_id: detailTarget.sessionId || detailTarget.id,
          worker_name: detailTarget.name || detailTarget.title,
          decision: decision,
          approval_state: decision === 'revision_requested' ? 'revision_required' : 'approved',
          next_goal: nextGoalStr,
          review_note: noteStr || undefined,
        }).then((res) => {
          setApprovingBusy(false)
          if (!res || res.ok === false) {
            setToast('审批操作未生效：' + ((res && res.error) || '后端返回异常'))
            return
          }
          setApprovedWorkerMap((prev) => Object.assign({}, prev, {
            [detailTarget.id]: {
              approved: decision === 'approved',
              decisionState: decision === 'revision_requested' ? 'revision_required' : 'approved',
              nextGoal: (res && res.next_goal) || nextGoalStr,
              ts: Date.now(),
            },
          }))
          setToast(decision === 'revision_requested'
            ? ('↩ 已驳回重做 ' + (detailTarget.name || detailTarget.title) + '：' + nextGoalStr)
            : ('✓ Plan 已审批通过 ' + (detailTarget.name || detailTarget.title) + ' 并下达新目标：' + ((res && res.next_goal) || nextGoalStr)))
          reloadDag()
        })
      }

      const handleRetryWorkerTask = (detailTarget) => {
        if (!detailTarget || retryingBusy) return
        setRetryingBusy(true)
        api({
          op: 'retryWorkerTask',
          engagement_id: activeEngagementId,
          engagement: eng || undefined,
          worker_id: detailTarget.id,
        }).then((res) => {
          setRetryingBusy(false)
          if (res && res.ok === false && !/unknown op/i.test(String(res.error || ''))) {
            setToast('重跑分片失败：' + (res.error || '请稍后重试'))
            return
          }
          setToast('🔄 已触发单分片重跑：' + (detailTarget.title || detailTarget.id))
          reloadDag()
        })
      }

      const openAgentSessionInHostChat = (agent) => {
        const candidateSid = (agent && (agent.sessionId || agent.id)) || ''
        const fallbackRealSid = isRealHostSessionId(sessionId, hostSessions)
          ? sessionId
          : (isRealHostSessionId(domTel.sessionId, hostSessions) ? domTel.sessionId : '')
        const targetSid = isRealHostSessionId(candidateSid, hostSessions) ? candidateSid : fallbackRealSid
        const targetTitle = (agent && agent.title) ? agent.title : (sessionTitle || targetSid || '当前会话')

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
          agentId: agent && agent.id,
          engagement: eng || undefined,
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
        setToast(targetSid
          ? ('已切换侧边聊天框至 Agent 会话：' + targetTitle)
          : ('已返回宿主聊天窗口（当前节点尚未绑定独立子会话）：' + targetTitle))
      }

      const resolveInspectorAgent = () => {
        if (inspectorAgentId === '__closed__') return null
        const targetId = inspectorAgentId || selAgentId || (primaryTreeChild && primaryTreeChild.id) || 'root'
        const rootObj = {
          id: 'root',
          sessionId: sessionId || domTel.sessionId || 'root',
          name: workspaceDisplayTitle,
          wave: 0,
          role: 'plan',
          avatar: '主控',
          color: '#3b82f6',
          title: workspaceDisplayTitle,
          uiPriority: 'P0',
          workerTags: ['#plan-orchestrator', '#lmtex-loop'],
          rawTokens: rootTokens,
          compressedTokens: rootTokens > 0 ? Math.round(rootTokens * 0.14) : 0,
          compressionPct: fusedChildren.length > 0 ? 85 : 0,
          approvalState: 'approved',
          assignedGoal: '全局需求拆解与 4-Wave 并发调度：统筹需求探索、契约锁定、分片并发构建与质量安全门禁。',
          filesOwned: [],
          compressedDigest: {
            whatWasDone: fusedChildren.length > 0
              ? ('已统筹 ' + fusedChildren.length + ' 个子智能体分片目标、摘要压缩与阶段审批派发。')
              : '主控编排器就绪 —— 可在上方许愿拆解向导输入需求一键立项并生成并行分片。',
            filesTouched: [],
          },
          nextGoal: '继续推进下一波次契约验证与回归闭环',
          status: runningCount > 0 ? 'running' : 'done',
          statusLabel: runningCount > 0 ? '运行中' : '就绪',
          tokenLabel: rootTokensLabel,
          costLabel: rootCostLabel,
          durationLabel: rootDuration,
          steps: rootSteps,
          isRoot: true,
          inputPrompt: '全局需求拆解与 4-Wave 并发调度：统筹 Wave 1 双轨立项、Wave 2 架构契约锁、Wave 3 分片并发构建与 Wave 4 质量安全门禁。',
          prompt: '全局需求拆解与 4-Wave 并发调度：统筹 Wave 1 双轨立项、Wave 2 架构契约锁、Wave 3 分片并发构建与 Wave 4 质量安全门禁。',
          output: fusedChildren.length > 0
            ? ('已调度 ' + fusedChildren.length + ' 个子智能体并同步至事实库。')
            : '等待立项拆解研发任务。',
        }
        if (targetId === 'root') return rootObj
        const hitChild = fusedChildren.find((c) => c.id === targetId || c.role === targetId)
        if (hitChild) {
          return Object.assign({ sessionId: hitChild.sessionId || hitChild.id }, hitChild)
        }
        return rootObj
      }

      const buildAgentStepTrajectory = (agent, detail) => {
        if (detail && Array.isArray(detail.stepTimeline) && detail.stepTimeline.length > 0) {
          return detail.stepTimeline.map((st, idx) => ({
            step: st.step || (idx + 1),
            phase: st.phase || (idx === 0 ? '环节 ① 委派解析' : (idx === detail.stepTimeline.length - 1 ? '环节 ③ 结论回传' : '环节 ② 工具调用')),
            tool: st.tool || st.toolName || (idx === 0 ? 'view_file' : (idx === 1 ? 'replace_file_content' : 'run_command')),
            input: st.input || st.args || st.command || st.summary || ('执行 ' + (agent.title || agent.id) + ' 步骤 #' + (idx + 1)),
            output: st.output || st.result || '步骤执行完成',
            duration: st.duration || st.elapsed || '—',
            status: st.status || 'done',
          }))
        }
        const isErr = agent && agent.status === 'error'
        const isRun = agent && agent.status === 'running'
        const isPend = agent && agent.status === 'pending'
        return [
          {
            step: 1, phase: '环节 ① 委派解析', tool: 'plan_dispatch',
            input: (agent && (agent.assignedGoal || agent.prompt)) || '解析当前分片目标与依赖边界',
            output: '已锁定分片范围', duration: '—', status: isPend ? 'pending' : 'done',
          },
          {
            step: 2, phase: '环节 ② 核心执行', tool: 'shard_exec',
            input: Array.isArray(agent && agent.filesOwned) && agent.filesOwned.length > 0
              ? ('独占分片：' + agent.filesOwned.join(', '))
              : ('执行 ' + ((agent && agent.title) || '当前角色') + ' 核心工作流'),
            output: isErr ? '执行受阻，等待修复或重跑' : '同步上下文与结构化产物',
            duration: '—', status: isErr ? 'error' : (isRun ? 'running' : (isPend ? 'pending' : 'done')),
          },
          {
            step: 3, phase: '环节 ③ 阶段结论', tool: 'submit_digest',
            input: '压缩阶段工作摘要并回传主控审批',
            output: (agent && agent.output) || '等待阶段结论回传',
            duration: '—', status: isErr ? 'error' : (isRun || isPend ? 'pending' : 'done'),
          },
        ]
      }

      const swimFilteredLanes = (() => {
        const sortByPriority = (list) => list.slice().sort((a, b) => {
          if (a.isRoot && !b.isRoot) return -1
          if (!a.isRoot && b.isRoot) return 1
          const rA = (PRIORITY_BADGE_META[a.uiPriority] && PRIORITY_BADGE_META[a.uiPriority].rank) ?? 2
          const rB = (PRIORITY_BADGE_META[b.uiPriority] && PRIORITY_BADGE_META[b.uiPriority].rank) ?? 2
          return rA - rB
        })
        if (swimWaveFilter === 'all') return sortByPriority(visibleLanes)
        if (swimWaveFilter === 'running') {
          return sortByPriority(visibleLanes.filter((ln) => ln.status === 'running' || (ln.isRoot && runningCount > 0)))
        }
        const waveNum = Number(swimWaveFilter)
        return sortByPriority(visibleLanes.filter((ln) => !ln.isRoot && Number(ln.wave || 1) === waveNum))
      })()

      const activeInspectorAgent = resolveInspectorAgent()
      const activeInspectorDetail = activeInspectorAgent
        ? (inspectorDetailCache[activeInspectorAgent.id] || null)
        : null
      const activeStepTimeline = activeInspectorAgent
        ? buildAgentStepTrajectory(activeInspectorAgent, activeInspectorDetail)
        : []

      const activeInspectorKey = activeInspectorAgent ? activeInspectorAgent.id : ''
      React.useEffect(() => {
        if (!activeInspectorAgent) return
        setCustomNextGoal(activeInspectorAgent.nextGoal || '继续推进下一波次契约验证与回归闭环')
        setEditGoalDraft(activeInspectorAgent.assignedGoal || activeInspectorAgent.prompt || '')
        setEditFilesDraft(Array.isArray(activeInspectorAgent.filesOwned) ? activeInspectorAgent.filesOwned.join(', ') : '')
      }, [activeInspectorKey])

      const triggerCheckpoint = (actionLabel, actionCode, targetNodeId) => {
        const targetNode = targetNodeId || selected.id
        setToast('正在执行：' + actionLabel + ' (' + targetNode + ')…')
        api({ op: 'dagCheckpoint', engagement: eng || undefined, action: actionCode, node: targetNode }).then((r) => {
          if (r && r.ok === false) {
            setToast('检查点操作失败：' + (r.error || '请稍后重试'))
            return
          }
          setToast((r && r.note) || ('已触发「' + actionLabel + '」：节点 ' + targetNode + ' 从检查点恢复执行'))
          reloadDag()
        }, () => {
          setToast('已触发「' + actionLabel + '」：节点 ' + targetNode + ' 恢复请求已发出')
        })
      }

      const triggerFeishuPush = () => {
        setToast('正在向飞书群聊推送工作流状态…')
        api({ op: 'feishuNotify', engagement: eng || undefined, webhook: webhook, node: selected.id }).then((r) => {
          if (r && r.ok === false) {
            setToast('飞书推送失败：' + (r.error || '请检查 Webhook 地址'))
            return
          }
          setToast((r && r.note) || ('飞书机器人推送成功：已发送「' + selected.name + '」节点简报'))
        }, () => {
          setToast('飞书机器人推送请求失败，请检查网络连接')
        })
      }

      const saveFeishuConfig = () => {
        setFeishuSaving(true)
        api({
          op: 'feishuConfig',
          engagement_id: activeEngagementId,
          engagement: eng || undefined,
          webhook_url: webhook,
          webhook: webhook,
          events: { on_node: feishuOnNode, on_gate: feishuOnGate, on_ship: feishuOnShip },
        }).then((r) => {
          setFeishuSaving(false)
          if (!r || r.ok === false) {
            setToast('保存飞书推送配置失败：' + ((r && r.error) || '后端拒绝或未就绪'))
            return
          }
          setToast((r && r.note) || '✓ 已保存飞书推送配置至当前工作区')
        })
      }

      const addQuickTask = () => {
        const idx = customTasks.length + 1
        const nextTask = {
          id: 'task-custom-' + idx,
          agentId: primaryTreeChild ? primaryTreeChild.id : 'root',
          avatar: 'W' + Math.min(4, idx + 2),
          color: '#3b82f6',
          title: 'Wave3 exploit 增量分片任务 #' + idx,
          role: 'exploit',
          wave: 3,
          uiPriority: 'P1',
          workerTags: ['#ui-canvas', '#pg-store'],
          compressionPct: 0,
          approvalState: 'pending_approval',
          status: 'wait',
          statusBadge: '○ 待执行',
          prompt: '执行增量模块分片构建与自动化验证，完成后回传主控并写入事实库。',
          output: '待分配并发槽位…',
          tokenLabel: '0 tok',
          durationLabel: '待调度',
          steps: 0,
        }
        setCustomTasks((prev) => [nextTask].concat(prev))
        setToast('已新建团队协作任务：' + nextTask.title)
      }

      const fallbackSvgH = Math.max(180, activeWaveGroups.length * 112)
      const svgHeight = (fanoutGeom && fanoutGeom.height > 0) ? fanoutGeom.height : fallbackSvgH
      const svgYRoot = (fanoutGeom && typeof fanoutGeom.yRoot === 'number') ? fanoutGeom.yRoot : Math.round(svgHeight / 2)
      const effectiveMode = isClusterVariant ? mode : 'p4'

      if (!eng) {
        return h('div', { className: 'rt-bento-card rt-p4-workbench' },
          h('div', { className: 'rt-bento-head' },
            h('span', { className: 'rt-bento-title' }, '实时角色决策流 & DAG 工作流画布'),
            h('span', { className: 'rt-tag' }, '待初始化'),
            h('div', { className: 'rt-spacer' }),
            (props.onOpenCollab || props.onOpenWishWizard)
              ? h('button', {
                  type: 'button',
                  className: 'rt-btn rt-btn-primary',
                  onClick: props.onOpenCollab || props.onOpenWishWizard,
                }, '✨ 前往「协同与审批」启动立项 →')
              : null),
          h('div', {
            className: 'rt-empty',
            style: {
              border: '1.5px dashed rgba(77,107,254,0.32)',
              borderRadius: 12,
              padding: '26px 20px',
              background: 'rgba(77,107,254,0.03)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              textAlign: 'center',
            },
          },
            h('div', { style: { fontWeight: 700, fontSize: 13.5, color: 'var(--dsw-alias-label-primary)' } },
              '当前会话尚未初始化研发任务 · 前往「协同与审批」启动立项'),
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', maxWidth: 540, lineHeight: 1.55 } },
              '为当前会话建立独立工作台并确认拆解蓝图后，此处将实时呈现 4-Wave 并发派生树与角色协同状态。'),
            (props.onOpenCollab || props.onOpenWishWizard)
              ? h('button', {
                  type: 'button',
                  className: 'rt-btn rt-btn-primary',
                  onClick: props.onOpenCollab || props.onOpenWishWizard,
                }, '✨ 前往「协同与审批」初始化工作台')
              : null))
      }

      return h('div', { className: 'rt-bento-card rt-p4-workbench' },
        h('div', { className: 'rt-bento-head' },
          h('span', { className: 'rt-bento-title' }, isClusterVariant ? '实时角色决策流 & DAG 工作流画布' : '研发路线图 & 实时工作流画布'),
          h('span', { className: 'rt-tag rt-tag-live' }, totalAgents + ' Agent · ' + allTasks.length + ' 协作任务'),
          pendingApprovalCount > 0
            ? h('span', { className: 'rt-tag rt-tag-warn' }, '待审批 ' + pendingApprovalCount)
            : null,
          errorCount > 0
            ? h('span', {
                className: 'rt-tag',
                style: { background: 'rgba(239,68,68,0.14)', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)', fontWeight: 700 },
              }, '⚠ ' + errorCount + ' 异常待修复')
            : null,
          selAgentId
            ? h('button', {
                type: 'button',
                className: 'rt-btn',
                style: { padding: '1px 7px', fontSize: 10.5 },
                onClick: () => setSelAgentId(null),
              }, '已高亮筛选 · 点击重置 ✕')
            : null,
          h('div', { className: 'rt-spacer' }),
          isClusterVariant
            ? h('div', { className: 'rt-harness-modebar', role: 'group', 'aria-label': '工作流视图切换' },
                h('button', {
                  type: 'button',
                  className: 'rt-harness-modebtn' + (mode === 'p4' ? ' on' : ''),
                  onClick: () => setMode('p4'),
                }, 'Agent 网络与跨 Agent 协作'),
                h('button', {
                  type: 'button',
                  className: 'rt-harness-modebtn' + (mode === 'p5' ? ' on' : ''),
                  onClick: () => setMode('p5'),
                }, '树状图画布 (团队任务板)'),
                h('button', {
                  type: 'button',
                  className: 'rt-harness-modebtn' + (mode === 'docwall' ? ' on' : ''),
                  onClick: () => setMode('docwall'),
                }, '文稿视图 (Doc Wall)'),
                h('button', {
                  type: 'button',
                  className: 'rt-harness-modebtn' + (mode === 'feishu' ? ' on' : ''),
                  onClick: () => setMode('feishu'),
                }, '飞书通知 (Feishu Push)'))
            : h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                props.onOpenCollab
                  ? h('button', {
                      type: 'button',
                      className: 'rt-btn',
                      onClick: props.onOpenCollab,
                    }, '协同与审批' + (pendingApprovalCount > 0 ? (' (' + pendingApprovalCount + ')') : ''))
                  : null,
                props.onOpenAgents
                  ? h('button', {
                      type: 'button',
                      className: 'rt-btn',
                      onClick: props.onOpenAgents,
                    }, '完整拓扑与泳道 →')
                  : null)),

        toast
          ? h('div', {
              style: {
                padding: '6px 12px',
                borderRadius: 8,
                background: 'rgba(77,107,254,0.08)',
                border: '1px solid rgba(77,107,254,0.28)',
                color: 'var(--wb-blue,#4d6bfe)',
                fontSize: 11.5,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              },
            },
              h('span', null, toast),
              h('button', {
                type: 'button',
                className: 'rt-btn',
                style: { padding: '0 6px', fontSize: 10.5 },
                onClick: () => setToast(null),
              }, '✕'))
          : null,

        /* ── 模式 1: p4 工作流树画布 + (cluster 模式下展示过滤创作栏与下方全宽流程舱) ── */
        effectiveMode === 'p4'
          ? h('div', {
              className: 'rt-p4-split-grid rt-p4-vertical-stack rt-p4-split',
              style: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%' },
            },
              h('div', {
                className: 'rt-net-pane rt-p4-net-pane',
                style: {
                  border: '1px solid var(--dsw-alias-border-l1)',
                  borderRadius: 12,
                  padding: 12,
                  background: 'var(--dsw-alias-bg-base)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  minWidth: 0,
                  width: '100%',
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                    h('span', { style: { fontWeight: 700, fontSize: 13 } }, 'Agent 网络 · 1 Plan + N Workers 闭环派生树'),
                    h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                      isClusterVariant
                        ? '点击节点在下方检视器审阅压缩摘要、修改分片目标或一键审批放行'
                        : '点击任意节点预览阶段进展，前往「协同与审批」处理蓝图立项或人工决策')),
                  h('div', { style: { display: 'inline-flex', flexWrap: 'wrap', gap: 6, fontSize: 11 } },
                    h('span', { className: 'rt-tag rt-tag-live' }, totalAgents + ' Agent'),
                    h('span', { className: 'rt-tag rt-tag-active' }, runningCount + ' 个运行中'),
                    errorCount > 0 ? h('span', { className: 'rt-tag', style: { color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' } }, errorCount + ' 异常阻塞') : null,
                    h('span', { className: 'rt-tag' }, '上下文合计 ' + ctxSumLabel))),

                /* 画布搜索/过滤与交互式新增分片工具栏（仅在「集群」完整模式下展开，保持「总览」清爽低密度） */
                isClusterVariant
                  ? h('div', {
                      className: 'rt-canvas-filter-bar',
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        flexWrap: 'wrap',
                        padding: '6px 8px',
                        borderRadius: 8,
                        background: 'var(--dsw-alias-bg-layer-2)',
                        border: '1px solid var(--dsw-alias-border-l1)',
                      },
                    },
                      h('input', {
                        className: 'rt-input',
                        style: { width: 175, height: 24, fontSize: 11, padding: '0 8px' },
                        placeholder: '搜索节点 / 角色 / 独占文件...',
                        value: canvasSearch,
                        onChange: (e) => setCanvasSearch(e.target.value),
                      }),
                      [
                        { k: 'all', lbl: '全部 (' + fusedChildren.length + ')' },
                        { k: 'p0', lbl: 'P0 焦点' },
                        { k: 'running', lbl: '运行中' },
                        { k: 'pending', lbl: '待审批' + (pendingApprovalCount > 0 ? ' (' + pendingApprovalCount + ')' : '') },
                        { k: 'error', lbl: '异常阻塞' + (errorCount > 0 ? ' (' + errorCount + ')' : '') },
                      ].map((fp) => h('button', {
                        key: 'cf-' + fp.k,
                        type: 'button',
                        className: 'rt-p3-pill' + (canvasFilter === fp.k ? ' on' : ''),
                        style: { fontSize: 10.5, padding: '2px 8px' },
                        onClick: () => setCanvasFilter(fp.k),
                      }, fp.lbl)),
                      h('div', { className: 'rt-spacer' }),
                      (props.onOpenCollab || props.onOpenWishWizard)
                        ? h('button', {
                            type: 'button',
                            className: 'rt-btn',
                            style: { padding: '2px 8px', fontSize: 11, fontWeight: 600 },
                            onClick: props.onOpenCollab || props.onOpenWishWizard,
                          }, '✨ 需求拆解与审批')
                        : null,
                      h('button', {
                        type: 'button',
                        className: 'rt-btn' + (showAddShardForm ? ' rt-btn-primary' : ''),
                        style: { padding: '2px 9px', fontSize: 11, fontWeight: 600 },
                        onClick: () => setShowAddShardForm((v) => !v),
                      }, showAddShardForm ? '收起新增分片 ✕' : '➕ 新增分片节点'))
                  : null,

                isClusterVariant && showAddShardForm
                  ? h('div', {
                      style: {
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                        gap: 8,
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px dashed #3b82f6',
                        background: 'var(--dsw-alias-bg-layer-1)',
                        alignItems: 'center',
                      },
                    },
                      h('input', {
                        className: 'rt-input',
                        placeholder: '分片标题（如：Wave3 认证中间件重构）',
                        value: newShardTitle,
                        onChange: (e) => setNewShardTitle(e.target.value),
                      }),
                      h('select', {
                        className: 'rt-input',
                        value: String(newShardWave),
                        onChange: (e) => setNewShardWave(Number(e.target.value) || 3),
                      },
                        h('option', { value: '1' }, 'Wave 1 · 立项与设计'),
                        h('option', { value: '2' }, 'Wave 2 · 架构与分片'),
                        h('option', { value: '3' }, 'Wave 3 · 并发编码构建'),
                        h('option', { value: '4' }, 'Wave 4 · 审查与测试门禁')),
                      h('select', {
                        className: 'rt-input',
                        value: newShardRole,
                        onChange: (e) => setNewShardRole(e.target.value),
                      },
                        Object.keys(P4_ROLE_META).map((rk) => h('option', { key: 'sr-' + rk, value: rk },
                          rk + ' · ' + P4_ROLE_META[rk].defaultTitle))),
                      h('input', {
                        className: 'rt-input',
                        placeholder: '分片任务目标说明',
                        value: newShardGoal,
                        onChange: (e) => setNewShardGoal(e.target.value),
                      }),
                      h('input', {
                        className: 'rt-input rt-mono',
                        placeholder: '独占文件路径（逗号分隔）',
                        value: newShardFiles,
                        onChange: (e) => setNewShardFiles(e.target.value),
                      }),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn rt-btn-primary',
                        disabled: addingShardBusy,
                        onClick: handleCreateCustomShard,
                      }, addingShardBusy ? '创建中…' : '确认挂载分片'))
                  : null,

                /* 可平移与缩放的路径树画布视口 (.rt-panzoom-viewport) */
                h('div', {
                  ref: viewportDomRef,
                  className: 'rt-panzoom-viewport' + (isClusterVariant ? ' rt-panzoom-viewport-cluster' : ''),
                  onMouseDown: handleViewportMouseDown,
                  onMouseMove: handleViewportMouseMove,
                  onMouseUp: handleViewportMouseUp,
                  onMouseLeave: handleViewportMouseUp,
                  onWheel: handleViewportWheel,
                  style: { padding: '8px 6px 12px' },
                },
                  h('div', {
                    className: 'rt-panzoom-toolbar',
                    role: 'toolbar',
                    'aria-label': '路径树画布平移缩放与折叠控制',
                    style: { flexWrap: 'wrap' },
                  },
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn rt-tree-layout-setting',
                      style: { padding: '1px 8px', fontSize: 10.5, fontWeight: 600 },
                      onClick: toggleTreeDirection,
                      title: '切换开发树展开方向（横向向右派生 / 纵向向下派生）',
                    }, treeDirection === 'horizontal'
                      ? '⇄ 横向向右派生'
                      : '⇄ 纵向向下派生'),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn',
                      style: { padding: '1px 6px', fontSize: 11 },
                      onClick: zoomOutCanvas,
                      title: '缩小画布',
                    }, '-'),
                    h('span', {
                      className: 'rt-mono',
                      style: { fontSize: 10.5, minWidth: 34, textAlign: 'center', fontWeight: 600 },
                    }, treeZoom + '%'),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn',
                      style: { padding: '1px 6px', fontSize: 11 },
                      onClick: zoomInCanvas,
                      title: '放大画布',
                    }, '+'),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn',
                      style: { padding: '1px 7px', fontSize: 10.5 },
                      onClick: fitCanvasToViewport,
                      title: '自适应缩放完整放入当前视口',
                    }, '适应视口'),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn',
                      style: { padding: '1px 7px', fontSize: 10.5 },
                      onClick: resetPanZoom,
                    }, '1:1 复位'),
                    activeWaveGroups.length > 0
                      ? h('button', {
                          type: 'button',
                          className: 'rt-btn' + (allWavesExpanded ? ' rt-btn-primary' : ''),
                          style: { padding: '1px 7px', fontSize: 10.5 },
                          onClick: () => (allWavesExpanded ? (fusedChildren.length > 4 ? autoFoldWaves() : collapseAllWaves()) : expandAllWaves()),
                        }, allWavesExpanded ? '自动收起' : '全部展开')
                      : null),

                  h('div', {
                    ref: stageDomRef,
                    className: 'rt-panzoom-stage',
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      padding: '42px 6px 6px',
                      position: 'relative',
                      transform: `translate3d(${panZoom.x}px, ${panZoom.y}px, 0) scale(${panZoom.scale})`,
                      transformOrigin: '0 0',
                    },
                  },
                    treeDirection === 'horizontal'
                      ? h('div', {
                          ref: horizStageDomRef,
                          className: 'rt-tree-layout-horizontal',
                          style: {
                            display: 'grid',
                            gridTemplateColumns: activeWaveGroups.length > 0 ? '270px 68px minmax(0, 1fr)' : '270px minmax(0, 1fr)',
                            alignItems: 'center',
                            gap: activeWaveGroups.length > 0 ? 0 : 16,
                            width: '100%',
                          },
                        },
                          /* 1. 左列 (.rt-h-root-col): Level 0 主控 Plan 编排器 */
                          h('div', {
                            className: 'rt-h-root-col',
                            style: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
                          },
                            h('div', Object.assign({
                              ref: rootCardDomRef,
                              className: 'rt-p4-node-card rt-p4-root-card'
                                + (selAgentId === 'root' ? ' on' : '')
                                + (hubAbsorbing ? ' rt-anim-hub-absorb' : ''),
                              style: {
                                width: '100%',
                                position: 'relative',
                                border: selAgentId === 'root' ? '1.5px solid #3b82f6' : '1px solid var(--dsw-alias-border-l1)',
                                borderLeft: '4px solid #3b82f6',
                                borderRadius: 10,
                                padding: '10px 12px',
                                background: 'var(--dsw-alias-bg-layer-1)',
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                boxShadow: selAgentId === 'root' ? '0 0 0 3px rgba(59,130,246,0.16)' : '0 2px 6px rgba(0,0,0,0.06)',
                              },
                            }, clickable(() => openAgentInspector('root'), {
                              label: '检视主控节点 ' + workspaceDisplayTitle + ' 环节细节',
                              expanded: selAgentId === 'root',
                            })),
                              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 } },
                                h('span', { style: { fontSize: 10, fontWeight: 700, color: '#3b82f6' } }, 'Level 0 · 主控 Plan 编排器'),
                                h('span', {
                                  className: 'rt-pri-badge rt-pri-badge-p0',
                                  style: { fontSize: 9.5, padding: '1px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.14)', color: '#ef4444', fontWeight: 700 },
                                }, 'P0 主控中枢')),
                              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                                h('span', { style: { background: '#3b82f6', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 6 } }, '主控'),
                                h('span', {
                                  style: { fontWeight: 700, fontSize: 12.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                                  title: workspaceDisplayTitle,
                                }, workspaceDisplayTitle),
                                h('span', { className: 'rt-tag rt-tag-live', style: { margin: 0 } }, fusedChildren.length > 0 ? '协同中' : '就绪')),
                              h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.4 } },
                                '1 Plan + N Workers · 自动拆分目标 / 摘要压缩 / 审批派发'),
                              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                                h('span', { className: 'rt-mono' }, rootTokensLabel + ' · ' + rootCostLabel),
                                h('span', { className: 'rt-mono' }, rootDuration + ' · ' + rootSteps + ' 步'),
                                h('span', { className: 'rt-mono', style: { fontWeight: 600, color: '#3b82f6' } }, rootCtxPct)),
                              h('span', {
                                className: 'rt-n8n-diamond-pin rt-node-handle rt-node-handle-out',
                                style: {
                                  position: 'absolute',
                                  right: -6,
                                  top: '50%',
                                  transform: 'translateY(-50%) rotate(45deg)',
                                },
                              }))),

                          /* 2. 中列 (.rt-h-fanout-col): 绝对定位 SVG 连线层，对 Grid 行高产生零布局反馈 */
                          activeWaveGroups.length > 0
                            ? h('div', {
                                ref: fanoutColDomRef,
                                className: 'rt-h-fanout-col',
                                style: { position: 'relative', width: 68, alignSelf: 'stretch', minHeight: 0 },
                              },
                                h('svg', {
                                  className: 'rt-h-root-fanout-svg rt-p4-bezier-svg',
                                  viewBox: '0 0 68 ' + svgHeight,
                                  preserveAspectRatio: 'none',
                                  style: {
                                    position: 'absolute',
                                    inset: 0,
                                    width: '100%',
                                    height: '100%',
                                    pointerEvents: 'none',
                                    overflow: 'visible',
                                    display: 'block',
                                  },
                                  'aria-label': '主控向右扇出至各 Wave 分支连线',
                                },
                                  activeWaveGroups.map((wg, idx) => {
                                    const n = activeWaveGroups.length
                                    const measuredWaveY = (fanoutGeom && fanoutGeom.waveYs && typeof fanoutGeom.waveYs[String(wg.wave)] === 'number')
                                      ? fanoutGeom.waveYs[String(wg.wave)]
                                      : null
                                    const yWave = measuredWaveY !== null
                                      ? measuredWaveY
                                      : (n === 1 ? Math.round(svgHeight / 2) : Math.round(((idx + 0.5) / n) * svgHeight))
                                    const dCurve = 'M 0,' + svgYRoot + ' C 34,' + svgYRoot + ' 34,' + yWave + ' 68,' + yWave
                                    const isWaveSelected = wg.children.some((c) => c.id === selAgentId)
                                    const isFocused = !selAgentId || selAgentId === 'root' || isWaveSelected
                                    const isSpawningWave = wg.children.some((c) => Boolean(animatingSpawnIds[c.id]))
                                    const wireClass = (isSpawningWave ? 'rt-wire-growing ' : '')
                                      + ((wg.runningInWave > 0 || isSpawningWave) ? 'rt-wire-flowing' : '')
                                    return h('g', { key: 'h-bz-wave-' + wg.wave },
                                      h('path', {
                                        d: dCurve,
                                        fill: 'none',
                                        stroke: wg.color,
                                        strokeWidth: isWaveSelected ? '3.2' : '2.0',
                                        opacity: isFocused ? '0.24' : '0.1',
                                      }),
                                      h('path', {
                                        className: wireClass || undefined,
                                        d: dCurve,
                                        fill: 'none',
                                        stroke: wg.color,
                                        strokeWidth: isWaveSelected ? '2.6' : '1.8',
                                        strokeDasharray: (wg.runningInWave > 0 && !wireClass) ? '5 3' : undefined,
                                        opacity: isFocused ? '0.92' : '0.32',
                                      }),
                                      h('circle', {
                                        cx: '66',
                                        cy: String(yWave),
                                        r: '3.5',
                                        fill: wg.color,
                                        opacity: isFocused ? '1' : '0.35',
                                      }))
                                  }),
                                  h('circle', { cx: '2', cy: String(svgYRoot), r: '4', fill: '#3b82f6' })))
                            : null,

                          /* 3. 右列 (.rt-h-waves-stack): 有真实任务时展示 Wave 泳道，真实空态时展示引导提示 */
                          activeWaveGroups.length > 0
                            ? h('div', {
                                ref: wavesStackDomRef,
                                className: 'rt-h-waves-stack rt-tree-wave-row rt-tree-wave-grid',
                                style: { display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 },
                              },
                                activeWaveGroups.map((wg) => {
                                  const expanded = isWaveExpanded(wg)
                                  const hasSelectedChild = wg.children.some((c) => c.id === selAgentId)
                                  const isSpawningWave = wg.children.some((c) => Boolean(animatingSpawnIds[c.id]))
                                  const isCompletingWave = wg.children.some((c) => Boolean(animatingCompleteIds[c.id]))
                                  const statusSummary = wg.errorInWave > 0
                                    ? ('⚠ ' + wg.errorInWave + ' 异常待修复')
                                    : (wg.runningInWave > 0
                                      ? ('● ' + wg.runningInWave + ' 运行中')
                                      : ('✓ ' + wg.doneInWave + ' 已完成'))
                                  const wavePriMeta = PRIORITY_BADGE_META[wg.topPriority] || PRIORITY_BADGE_META.P2
                                  const pageCap = wavePageLimits[wg.wave] || WAVE_PAGE_SIZE
                                  const visibleWaveChildren = wg.children.slice(0, pageCap)
                                  const hiddenWaveCount = Math.max(0, wg.children.length - visibleWaveChildren.length)

                                  return h('div', {
                                    key: 'h-wave-lane-' + wg.wave,
                                    className: 'rt-wave-horizontal-lane',
                                    style: { display: 'flex', alignItems: 'center', gap: 0, minWidth: 0 },
                                  },
                                    h('div', Object.assign({
                                      ref: (el) => {
                                        if (!waveCardDomRefs.current) waveCardDomRefs.current = {}
                                        if (el) waveCardDomRefs.current[String(wg.wave)] = el
                                        else delete waveCardDomRefs.current[String(wg.wave)]
                                      },
                                      className: 'rt-tree-wave-group rt-tree-wave-card'
                                        + (expanded ? ' expanded active' : '')
                                        + (hasSelectedChild ? ' on' : '')
                                        + (wg.errorInWave > 0 ? ' is-error' : '')
                                        + (isSpawningWave ? ' rt-anim-spawn' : '')
                                        + (isCompletingWave ? ' rt-anim-complete' : ''),
                                      style: {
                                        width: 248,
                                        flex: 'none',
                                        position: 'relative',
                                        borderLeft: '3.5px solid ' + wg.color,
                                        borderColor: (expanded || hasSelectedChild || wg.errorInWave > 0) ? wg.color : 'var(--dsw-alias-border-l1)',
                                      },
                                    }, clickable(() => toggleWaveExpand(wg.wave), {
                                      label: (expanded ? '收起 ' : '展开 ') + wg.title + ' (' + wg.children.length + ' 个节点)',
                                      expanded: expanded,
                                    })),
                                      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, flexWrap: 'wrap' } },
                                        h('span', {
                                          className: 'rt-tree-wave-card-badge',
                                          style: { color: wg.color, borderColor: wg.color + '55', background: wg.color + '18' },
                                        }, wg.shortLabel + ' · ' + wg.children.length + ' 个节点'),
                                        h('span', {
                                          className: wavePriMeta.cls,
                                          style: { fontSize: 9.5, fontWeight: 700, padding: '0 5px', borderRadius: 4 },
                                        }, wg.topPriority),
                                        h('span', {
                                          className: 'rt-mono',
                                          style: {
                                            fontSize: 10,
                                            fontWeight: 700,
                                            color: wg.errorInWave > 0 ? '#ef4444' : (wg.runningInWave > 0 ? '#3b82f6' : '#10b981'),
                                          },
                                        }, statusSummary)),
                                      h('div', {
                                        style: {
                                          fontWeight: 700,
                                          fontSize: 11.5,
                                          color: 'var(--dsw-alias-label-primary)',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                        },
                                        title: wg.title,
                                      }, wg.title),
                                      h('div', {
                                        className: 'rt-mono',
                                        style: {
                                          fontSize: 10,
                                          color: 'var(--dsw-alias-label-secondary)',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'space-between',
                                          gap: 4,
                                        },
                                      },
                                        h('span', null, wg.children.length + ' 子代理 · ' + wg.runningInWave + ' 运行 / ' + wg.doneInWave + ' 完成'),
                                        h('span', null, wg.tokenLabel)),
                                      h('div', {
                                        style: { height: 4, borderRadius: 99, background: 'var(--dsw-alias-bg-layer-2)', overflow: 'hidden' },
                                      },
                                        h('div', {
                                          style: { width: wg.progressPct + '%', height: '100%', background: wg.color, borderRadius: 99 },
                                        })),
                                      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 } },
                                        h('span', {
                                          style: { fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600 },
                                        }, expanded ? '点击收起分片 ⬅' : '点击向右展开分片 ➔'),
                                        h('button', {
                                          type: 'button',
                                          className: 'rt-btn',
                                          style: { padding: '0 6px', fontSize: 10, lineHeight: '16px' },
                                          onClick: (e) => {
                                            if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
                                            toggleWaveExpand(wg.wave)
                                          },
                                        }, expanded ? '[收起 ⌃]' : '[展开 ⌄]')),
                                      h('span', {
                                        className: 'rt-n8n-diamond-pin rt-n8n-diamond-pin-right',
                                        style: { borderColor: wg.color },
                                      })),

                                    expanded
                                      ? h('div', { style: { display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 } },
                                          h('div', {
                                            className: 'rt-h-wave-branch-line',
                                            style: { width: 44, flex: 'none', display: 'flex', alignItems: 'center', background: 'none' },
                                          },
                                            h('svg', {
                                              viewBox: '0 0 44 48',
                                              style: { width: 44, height: 48, display: 'block', overflow: 'visible', background: 'none' },
                                            },
                                              h('path', {
                                                d: 'M 0,24 L 44,24',
                                                fill: 'none',
                                                stroke: wg.color,
                                                strokeWidth: '2',
                                              }),
                                              h('circle', { cx: '42', cy: '24', r: '3', fill: wg.color }))),
                                          h('div', {
                                            className: 'rt-wave-right-children rt-tree-expanded-grid rt-p4-children-grid',
                                            style: {
                                              display: 'grid',
                                              gridTemplateColumns: 'repeat(auto-fill, minmax(225px, 1fr))',
                                              gap: 10,
                                              flex: 1,
                                              minWidth: 0,
                                            },
                                          },
                                            visibleWaveChildren.map((c) => {
                                              const isSel = selAgentId === c.id
                                              const isErrCard = c.status === 'error'
                                              const isSpawning = Boolean(animatingSpawnIds[c.id])
                                              const isCompleting = Boolean(animatingCompleteIds[c.id])
                                              const priMeta = PRIORITY_BADGE_META[c.uiPriority] || PRIORITY_BADGE_META.P2
                                              const isApproved = c.approvalState === 'approved'
                                              const isRevReq = c.approvalState === 'revision_required'
                                              return h('div', Object.assign({
                                                key: c.id,
                                                className: 'rt-p4-node-card'
                                                  + (isSel ? ' on' : '')
                                                  + (isErrCard ? ' is-error' : '')
                                                  + (isSpawning ? ' rt-anim-spawn' : '')
                                                  + (isCompleting ? ' rt-anim-complete' : ''),
                                                style: {
                                                  position: 'relative',
                                                  border: isErrCard
                                                    ? '1.5px solid #ef4444'
                                                    : (isSel ? ('1.5px solid ' + c.color) : '1px solid var(--dsw-alias-border-l1)'),
                                                  borderLeft: '3.5px solid ' + (isErrCard ? '#ef4444' : c.color),
                                                  borderRadius: 10,
                                                  padding: '9px 10px 8px',
                                                  background: isErrCard ? 'rgba(239,68,68,0.05)' : 'var(--dsw-alias-bg-layer-1)',
                                                  cursor: 'pointer',
                                                  display: 'flex',
                                                  flexDirection: 'column',
                                                  gap: 5,
                                                  minWidth: 0,
                                                  boxShadow: isSel ? ('0 0 0 3px ' + c.color + '26') : '0 2px 6px rgba(15,23,42,0.04)',
                                                },
                                              }, clickable(() => openAgentInspector(c.id), {
                                                label: '梳理子智能体 ' + c.title + ' 环节细节',
                                                expanded: isSel,
                                              })),
                                                h('span', {
                                                  className: 'rt-n8n-port-left rt-node-handle',
                                                  style: {
                                                    position: 'absolute',
                                                    left: -5,
                                                    top: '50%',
                                                    transform: 'translateY(-50%)',
                                                    width: 8,
                                                    height: 8,
                                                    borderRadius: '50%',
                                                    background: 'var(--dsw-alias-bg-layer-1)',
                                                    border: '2px solid ' + (isErrCard ? '#ef4444' : c.color),
                                                  },
                                                }),
                                                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, flexWrap: 'wrap' } },
                                                  h('span', {
                                                    className: priMeta.cls,
                                                    style: { fontSize: 9.5, fontWeight: 700, padding: '1px 5px', borderRadius: 4 },
                                                  }, priMeta.label),
                                                  h('div', { style: { display: 'inline-flex', gap: 3, flexWrap: 'wrap' } },
                                                    (c.workerTags || []).slice(0, 2).map((tg) => h('span', {
                                                      key: tg,
                                                      className: 'rt-mono',
                                                      style: { fontSize: 9, padding: '0 4px', borderRadius: 3, background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)' },
                                                    }, tg)))),
                                                h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 } },
                                                  h('span', {
                                                    style: {
                                                      background: isErrCard ? '#ef4444' : c.color,
                                                      color: '#fff',
                                                      fontSize: 10,
                                                      fontWeight: 700,
                                                      padding: '1px 6px',
                                                      borderRadius: 5,
                                                      flex: 'none',
                                                      fontFamily: 'ui-monospace,Menlo,monospace',
                                                    },
                                                  }, c.avatar),
                                                  h('span', {
                                                    style: {
                                                      fontWeight: 700,
                                                      fontSize: 11.5,
                                                      overflow: 'hidden',
                                                      textOverflow: 'ellipsis',
                                                      whiteSpace: 'nowrap',
                                                      flex: 1,
                                                    },
                                                    title: c.title,
                                                  }, c.title),
                                                  h('span', {
                                                    style: {
                                                      fontSize: 10,
                                                      fontWeight: 700,
                                                      color: isErrCard ? '#ef4444' : (c.status === 'running' ? '#3b82f6' : (c.status === 'pending' ? '#f59e0b' : '#10b981')),
                                                    },
                                                  }, isErrCard ? '⚠ 异常待修复' : (c.status === 'running' ? '●' : (c.status === 'pending' ? '○' : '✓')))),
                                                h('div', {
                                                  style: {
                                                    fontSize: 10,
                                                    color: isErrCard ? '#ef4444' : 'var(--dsw-alias-label-secondary)',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                  },
                                                  title: c.compressedDigest && c.compressedDigest.whatWasDone,
                                                }, (c.compressedDigest && c.compressedDigest.whatWasDone) || c.output),
                                                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, fontSize: 9.5 } },
                                                  c.compressionPct > 0
                                                    ? h('span', {
                                                        className: 'rt-mono',
                                                        style: { padding: '1px 5px', borderRadius: 4, background: 'rgba(59,130,246,0.12)', color: '#3b82f6', fontWeight: 600 },
                                                      }, '压缩 -' + c.compressionPct + '%')
                                                    : h('span', { className: 'rt-mono', style: { color: 'var(--dsw-alias-label-secondary)' } }, c.statusLabel),
                                                  h('span', {
                                                    style: {
                                                      padding: '1px 5px',
                                                      borderRadius: 4,
                                                      background: isRevReq ? 'rgba(239,68,68,0.14)' : (isApproved ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.16)'),
                                                      color: isRevReq ? '#ef4444' : (isApproved ? '#10b981' : '#f59e0b'),
                                                      fontWeight: 700,
                                                    },
                                                  }, isRevReq ? '↩ 待重做' : (isApproved ? '✓ 已审批' : '⏳ 待 Plan 审批')),
                                                  h('span', { className: 'rt-mono', style: { color: 'var(--dsw-alias-label-secondary)' } }, c.tokenLabel)))
                                            }),
                                            hiddenWaveCount > 0
                                              ? h('button', {
                                                  key: 'more-' + wg.wave,
                                                  type: 'button',
                                                  className: 'rt-btn',
                                                  style: { minHeight: 54, fontWeight: 700, fontSize: 11 },
                                                  onClick: (e) => {
                                                    if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
                                                    setWavePageLimits((prev) => Object.assign({}, prev, {
                                                      [wg.wave]: (prev[wg.wave] || WAVE_PAGE_SIZE) + WAVE_PAGE_SIZE,
                                                    }))
                                                  },
                                                }, '展开更多 (+' + hiddenWaveCount + ' 个节点)')
                                              : null))
                                      : null)
                                }))
                            : h('div', {
                                className: 'rt-empty',
                                style: {
                                  border: '1.5px dashed rgba(77,107,254,0.35)',
                                  borderRadius: 12,
                                  padding: '22px 18px',
                                  background: 'rgba(77,107,254,0.03)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'flex-start',
                                  gap: 8,
                                },
                              },
                                h('div', { style: { fontWeight: 700, fontSize: 13, color: 'var(--dsw-alias-label-primary)' } },
                                  fusedChildren.length > 0
                                    ? '当前过滤条件下没有匹配的节点'
                                    : '当前工作台尚无研发分片 — 前往「协同与审批」澄清需求并立项拆解'),
                                h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.55 } },
                                  fusedChildren.length > 0
                                    ? '点击上方「全部」胶囊或清空搜索词即可恢复显示全部节点。'
                                    : '主控 Plan 编排器已就绪：前往「协同与审批」页面通过需求澄清卡片自动拆解分片目标，或在「集群」页手动挂载分片。'),
                                fusedChildren.length > 0
                                  ? h('button', {
                                      type: 'button',
                                      className: 'rt-btn',
                                      onClick: () => { setCanvasFilter('all'); setCanvasSearch('') },
                                    }, '重置筛选条件')
                                  : ((props.onOpenCollab || props.onOpenWishWizard)
                                    ? h('button', {
                                        type: 'button',
                                        className: 'rt-btn rt-btn-primary',
                                        onClick: props.onOpenCollab || props.onOpenWishWizard,
                                      }, '✨ 前往「协同与审批」拆解需求')
                                    : null)))
                      : /* ── 备选布局：纵向向下派生树 (.rt-p5-tree-stage.rt-tree-layout-vertical) ── */
                        h('div', {
                          className: 'rt-p5-tree-stage rt-tree-layout-vertical',
                          style: { display: 'flex', flexDirection: 'column', alignItems: 'stretch' },
                        },
                          h('div', Object.assign({
                            className: 'rt-p4-node-card rt-p4-root-card'
                              + (selAgentId === 'root' ? ' on' : '')
                              + (hubAbsorbing ? ' rt-anim-hub-absorb' : ''),
                            style: {
                              width: 'min(360px, 94%)',
                              margin: '0 auto',
                              position: 'relative',
                              border: selAgentId === 'root' ? '1.5px solid #3b82f6' : '1px solid var(--dsw-alias-border-l1)',
                              borderTop: '3px solid #3b82f6',
                              borderRadius: 10,
                              padding: '10px 12px',
                              background: 'var(--dsw-alias-bg-layer-1)',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            },
                          }, clickable(() => openAgentInspector('root'), {
                            label: '检视主控节点 ' + workspaceDisplayTitle + ' 环节细节',
                            expanded: selAgentId === 'root',
                          })),
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                              h('span', { style: { background: '#3b82f6', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 6 } }, '主控'),
                              h('span', { style: { fontWeight: 700, fontSize: 12.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, workspaceDisplayTitle),
                              h('span', { className: 'rt-tag rt-tag-live', style: { margin: 0 } }, 'Level 0 · Plan'),
                              h('span', { className: 'rt-mono', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, rootTokensLabel + ' · ' + rootCostLabel)),
                            h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
                              '1 Plan + N Workers · 自动拆分目标 / 摘要压缩 / 审批派发'),
                            h('span', { className: 'rt-n8n-diamond-pin rt-node-handle rt-node-handle-bottom' })),

                          activeWaveGroups.length > 0
                            ? h('svg', {
                                className: 'rt-p4-bezier-svg',
                                viewBox: '0 0 600 56',
                                preserveAspectRatio: 'none',
                                style: { width: '100%', height: 54, display: 'block', overflow: 'visible' },
                                'aria-label': '主控向下扇出至子智能体拓扑连线',
                              },
                                activeWaveGroups.map((wg, idx) => {
                                  const n = activeWaveGroups.length
                                  const x = n === 1 ? 300 : Math.round(((idx + 0.5) / n) * 600)
                                  const dForward = 'M 300,0 C 300,28 ' + x + ',28 ' + x + ',56'
                                  return h('g', { key: 'v-bz-wave-' + wg.wave },
                                    h('path', {
                                      d: dForward,
                                      fill: 'none',
                                      stroke: wg.color,
                                      strokeWidth: '2.1',
                                      opacity: '0.85',
                                    }),
                                    h('circle', { cx: String(x), cy: '54', r: '3.5', fill: wg.color }))
                                }),
                                h('circle', { cx: '300', cy: '2', r: '4', fill: '#3b82f6' }))
                            : null,

                          activeWaveGroups.length > 0
                            ? h('div', {
                                className: 'rt-tree-wave-row rt-tree-wave-grid',
                                style: {
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(' + Math.max(1, activeWaveGroups.length) + ', minmax(0, 1fr))',
                                  gap: 10,
                                  alignItems: 'start',
                                },
                              },
                                activeWaveGroups.map((wg) => {
                                  const expanded = isWaveExpanded(wg)
                                  const pageCap = wavePageLimits[wg.wave] || WAVE_PAGE_SIZE
                                  const visibleWaveChildren = wg.children.slice(0, pageCap)
                                  const hiddenWaveCount = Math.max(0, wg.children.length - visibleWaveChildren.length)
                                  return h('div', {
                                    key: 'v-wave-col-' + wg.wave,
                                    style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 },
                                  },
                                    h('div', Object.assign({
                                      className: 'rt-tree-wave-group rt-tree-wave-card' + (expanded ? ' expanded active' : '') + (wg.errorInWave > 0 ? ' is-error' : ''),
                                      style: { borderTop: '3px solid ' + wg.color },
                                    }, clickable(() => toggleWaveExpand(wg.wave), {
                                      label: (expanded ? '收起 ' : '展开 ') + wg.title,
                                      expanded: expanded,
                                    })),
                                      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 } },
                                        h('span', { className: 'rt-tree-wave-card-badge', style: { color: wg.color } }, wg.shortLabel + ' · ' + wg.children.length + ' 个节点'),
                                        h('span', { className: 'rt-mono', style: { fontSize: 10, color: wg.color } }, wg.topPriority)),
                                      h('div', { style: { fontWeight: 700, fontSize: 11.5 } }, wg.title),
                                      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10 } },
                                        h('span', null, expanded ? '点击收起分片 ⬆' : '点击向下展开分片 ⬇'),
                                        h('button', {
                                          type: 'button',
                                          className: 'rt-btn',
                                          style: { padding: '0 6px', fontSize: 10 },
                                          onClick: (e) => {
                                            if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
                                            toggleWaveExpand(wg.wave)
                                          },
                                        }, expanded ? '[收起 ⌃]' : '[展开 ⌄]'))),
                                    expanded
                                      ? h('div', {
                                          className: 'rt-wave-subtree-children rt-tree-expanded-grid rt-p4-children-grid',
                                          style: { display: 'flex', flexDirection: 'column', gap: 8 },
                                        },
                                          visibleWaveChildren.map((c) => {
                                            const isSel = selAgentId === c.id
                                            const isErrCard = c.status === 'error'
                                            const priMeta = PRIORITY_BADGE_META[c.uiPriority] || PRIORITY_BADGE_META.P2
                                            return h('div', Object.assign({
                                              key: c.id,
                                              className: 'rt-p4-node-card' + (isSel ? ' on' : '') + (isErrCard ? ' is-error' : ''),
                                              style: {
                                                borderTop: '3px solid ' + (isErrCard ? '#ef4444' : c.color),
                                                border: isErrCard ? '1.5px solid #ef4444' : undefined,
                                                borderRadius: 10,
                                                padding: '8px 10px',
                                                background: isErrCard ? 'rgba(239,68,68,0.05)' : 'var(--dsw-alias-bg-layer-1)',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 4,
                                              },
                                            }, clickable(() => openAgentInspector(c.id), {
                                              label: '梳理子智能体 ' + c.title + ' 环节细节',
                                              expanded: isSel,
                                            })),
                                              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 } },
                                                h('span', { className: priMeta.cls, style: { fontSize: 9.5, fontWeight: 700 } }, priMeta.label),
                                                h('span', { className: 'rt-mono', style: { fontSize: 9.5, color: isErrCard ? '#ef4444' : '#3b82f6' } },
                                                  isErrCard ? '⚠ 异常待修复' : (c.compressionPct > 0 ? ('压缩 -' + c.compressionPct + '%') : c.statusLabel))),
                                              h('div', { style: { fontWeight: 700, fontSize: 11.5 } }, c.title),
                                              h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                                                (c.compressedDigest && c.compressedDigest.whatWasDone) || c.output))
                                          }),
                                          hiddenWaveCount > 0
                                            ? h('button', {
                                                key: 'v-more-' + wg.wave,
                                                type: 'button',
                                                className: 'rt-btn',
                                                onClick: () => setWavePageLimits((prev) => Object.assign({}, prev, {
                                                  [wg.wave]: (prev[wg.wave] || WAVE_PAGE_SIZE) + WAVE_PAGE_SIZE,
                                                })),
                                              }, '展开更多 (+' + hiddenWaveCount + ' 个节点)')
                                            : null)
                                      : null)
                                }))
                            : h('div', { className: 'rt-empty', style: { marginTop: 12 } },
                                '当前工作台尚无研发分片 — 前往「协同与审批」澄清需求并立项拆解'))))),

              /* 总览轻量摘要条 (!isClusterVariant) vs 集群下方全宽流程舱 (isClusterVariant) */
              !isClusterVariant
                ? (selAgentId && activeInspectorAgent
                    ? (() => {
                        const ovPri = PRIORITY_BADGE_META[activeInspectorAgent.uiPriority] || PRIORITY_BADGE_META.P2
                        const ovSummary = (activeInspectorAgent.compressedDigest && activeInspectorAgent.compressedDigest.whatWasDone)
                          || activeInspectorAgent.output
                          || '节点已就绪，点击右侧入口可前往审批或展开完整泳道。'
                        return h('div', { className: 'rt-ov-node-strip' },
                          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 } },
                            h('span', {
                              style: {
                                background: activeInspectorAgent.color || '#3b82f6',
                                color: '#fff',
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: 5,
                                fontFamily: 'ui-monospace,Menlo,monospace',
                              },
                            }, activeInspectorAgent.avatar),
                            h('span', { style: { fontWeight: 700, fontSize: 12.5, color: 'var(--dsw-alias-label-primary)' } }, activeInspectorAgent.title),
                            h('span', { className: ovPri.cls, style: { fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4 } }, ovPri.label),
                            h('span', { className: 'rt-mono', style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
                              (activeInspectorAgent.tokenLabel || rootTokensLabel) + ' · ' + (activeInspectorAgent.steps || 0) + ' 步'),
                            h('div', { className: 'rt-spacer' }),
                            (props.onOpenCollab || props.onOpenWishWizard)
                              ? h('button', {
                                  type: 'button',
                                  className: 'rt-btn rt-btn-primary',
                                  style: { padding: '2px 9px', fontSize: 11, fontWeight: 600 },
                                  onClick: props.onOpenCollab || props.onOpenWishWizard,
                                }, '前往「协同与审批」审批/调整 →')
                              : null,
                            props.onOpenAgents
                              ? h('button', {
                                  type: 'button',
                                  className: 'rt-btn',
                                  style: { padding: '2px 9px', fontSize: 11, fontWeight: 600 },
                                  onClick: props.onOpenAgents,
                                }, '在「集群」查看完整拓扑与泳道 →')
                              : null,
                            h('button', {
                              type: 'button',
                              className: 'rt-btn',
                              style: { padding: '1px 6px', fontSize: 11 },
                              title: '收起节点摘要',
                              onClick: () => openAgentInspector('__closed__'),
                            }, '✕')),
                          h('div', {
                            style: {
                              fontSize: 11.5,
                              color: 'var(--dsw-alias-label-secondary)',
                              lineHeight: 1.5,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            },
                          }, ovSummary))
                      })()
                    : null)
                : h('div', {
                    className: 'rt-lower-process-deck',
                    style: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', minWidth: 0 },
                  },
                    /* Section 1: Agent 环节执行轨迹与交互式创作/审批抽屉 (.rt-agent-inspector-drawer) */
                    activeInspectorAgent
                      ? (() => {
                          const inspPriMeta = PRIORITY_BADGE_META[activeInspectorAgent.uiPriority] || PRIORITY_BADGE_META.P2
                          const inspDigest = activeInspectorAgent.compressedDigest || {
                            whatWasDone: activeInspectorAgent.output || '已完成阶段任务并生成压缩摘要。',
                            filesTouched: activeInspectorAgent.filesOwned || [],
                          }
                          const rawTokNum = Number(activeInspectorAgent.rawTokens) || Number(activeInspectorAgent.tokens) || 0
                          const compTokNum = Number(activeInspectorAgent.compressedTokens) || (rawTokNum > 0 ? Math.round(rawTokNum * 0.15) : 0)
                          const compPctNum = Number(activeInspectorAgent.compressionPct) || (rawTokNum > 0 ? 85 : 0)
                          const overrideRec = approvedWorkerMap[activeInspectorAgent.id]
                          const isInspApproved = overrideRec
                            ? overrideRec.approved
                            : (activeInspectorAgent.approvalState === 'approved')
                          const isInspRevReq = (overrideRec && overrideRec.decisionState === 'revision_required')
                            || activeInspectorAgent.approvalState === 'revision_required'

                          return h('div', {
                            className: 'rt-agent-inspector-drawer',
                            style: {
                              border: '1.5px solid ' + (activeInspectorAgent.color || '#3b82f6'),
                              borderRadius: 12,
                              padding: 12,
                              background: 'var(--dsw-alias-bg-base)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 10,
                              boxShadow: '0 4px 14px rgba(0,0,0,0.06)',
                            },
                          },
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                              h('span', {
                                style: {
                                  background: activeInspectorAgent.color || '#3b82f6',
                                  color: '#fff',
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  padding: '2px 7px',
                                  borderRadius: 6,
                                  fontFamily: 'ui-monospace,Menlo,monospace',
                                },
                              }, activeInspectorAgent.avatar),
                              h('span', { style: { fontWeight: 700, fontSize: 13, color: 'var(--dsw-alias-label-primary)' } },
                                activeInspectorAgent.title),
                              h('span', {
                                className: inspPriMeta.cls,
                                style: { fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4 },
                              }, inspPriMeta.label),
                              (activeInspectorAgent.workerTags || []).map((tg) => h('span', {
                                key: 'insp-tg-' + tg,
                                className: 'rt-tag rt-mono',
                                style: { margin: 0, fontSize: 10 },
                              }, tg)),
                              h('span', { className: 'rt-tag', style: { margin: 0, fontSize: 10 } },
                                activeInspectorAgent.isRoot
                                  ? 'Wave 0 · 主控 Orchestrator'
                                  : ('Wave ' + (activeInspectorAgent.wave || 1) + ' · ' + activeInspectorAgent.role)),
                              h('span', { className: 'rt-tag rt-mono', style: { margin: 0, fontSize: 10 } },
                                'session: ' + ((activeInspectorDetail && activeInspectorDetail.sessionId) || activeInspectorAgent.sessionId || activeInspectorAgent.id)),
                              h('span', { className: 'rt-mono', style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
                                (activeInspectorAgent.tokenLabel || rootTokensLabel) + ' · ' + (activeInspectorAgent.durationLabel || '实时') + ' · ' + (activeInspectorAgent.steps || 0) + ' 步'),
                              h('div', { className: 'rt-spacer' }),
                          !activeInspectorAgent.isRoot
                            ? h('button', {
                                type: 'button',
                                className: 'rt-btn',
                                style: { padding: '3px 9px', fontSize: 11, fontWeight: 600 },
                                onClick: () => setEditingGoalOpen((v) => !v),
                              }, editingGoalOpen ? '收起目标编辑' : '✏️ 编辑分片目标')
                            : null,
                          !activeInspectorAgent.isRoot
                            ? h('button', {
                                type: 'button',
                                className: 'rt-btn',
                                disabled: retryingBusy,
                                style: { padding: '3px 9px', fontSize: 11, fontWeight: 600 },
                                onClick: () => handleRetryWorkerTask(activeInspectorAgent),
                              }, retryingBusy ? '重跑中…' : '🔄 重跑该分片')
                            : null,
                          h('button', {
                            type: 'button',
                            className: 'rt-btn rt-btn-primary rt-jump-chat-btn',
                            style: { padding: '3px 10px', fontSize: 11, fontWeight: 700 },
                            onClick: () => openAgentSessionInHostChat(activeInspectorAgent),
                          }, '💬 跳转侧边聊天框打开该 Agent 会话 ↗'),
                          h('button', {
                            type: 'button',
                            className: 'rt-btn',
                            style: { padding: '2px 7px', fontSize: 11 },
                            title: '收起环节轨迹抽屉',
                            onClick: () => openAgentInspector('__closed__'),
                          }, '✕')),

                        editingGoalOpen && !activeInspectorAgent.isRoot
                          ? h('div', {
                              style: {
                                padding: '9px 11px',
                                borderRadius: 8,
                                border: '1px dashed #3b82f6',
                                background: 'var(--dsw-alias-bg-layer-1)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                              },
                            },
                              h('div', { style: { fontSize: 11, fontWeight: 700 } }, '✏️ 在线编辑该子智能体的委派目标与独占文件分片'),
                              h('textarea', {
                                className: 'rt-textarea',
                                rows: 2,
                                style: { minHeight: 48, fontSize: 11.5 },
                                value: editGoalDraft,
                                onChange: (e) => setEditGoalDraft(e.target.value),
                                placeholder: '输入调整后的分片目标说明...',
                              }),
                              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                                h('input', {
                                  className: 'rt-input rt-mono',
                                  style: { flex: 1, minWidth: 200, fontSize: 11 },
                                  value: editFilesDraft,
                                  onChange: (e) => setEditFilesDraft(e.target.value),
                                  placeholder: '独占文件分片（逗号分隔）',
                                }),
                                h('button', {
                                  type: 'button',
                                  className: 'rt-btn rt-btn-primary',
                                  disabled: savingGoalBusy,
                                  onClick: () => handleSaveWorkerGoal(activeInspectorAgent),
                                }, savingGoalBusy ? '保存中…' : '💾 保存目标'),
                                h('button', {
                                  type: 'button',
                                  className: 'rt-btn',
                                  onClick: () => setEditingGoalOpen(false),
                                }, '取消')))
                          : null,

                        /* 3-Step Horizontal Chain */
                        h('div', {
                          className: 'rt-step-chain',
                          style: {
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                            gap: 10,
                            alignItems: 'stretch',
                          },
                        },
                          /* Step 1 · 委派目标 */
                          h('div', {
                            className: 'rt-step-node',
                            style: {
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--dsw-alias-border-l1)',
                              borderTop: '3px solid ' + (activeInspectorAgent.color || '#3b82f6'),
                              background: 'var(--dsw-alias-bg-layer-1)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 5,
                            },
                          },
                            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                              h('span', { style: { fontSize: 11, fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } },
                                'Step 1 · 📥 委派目标 (Prompt 拆分)'),
                              h('span', { className: 'rt-mono', style: { fontSize: 10, color: activeInspectorAgent.color || '#3b82f6', fontWeight: 700 } },
                                'Wave ' + (activeInspectorAgent.wave || 0) + ' / ' + (activeInspectorAgent.uiPriority || 'P1'))),
                            h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.55 } },
                              (activeInspectorDetail && activeInspectorDetail.prompt) || activeInspectorAgent.assignedGoal || activeInspectorAgent.inputPrompt || activeInspectorAgent.prompt)),

                          /* Step 2 · 核心执行 */
                          h('div', {
                            className: 'rt-step-node',
                            style: {
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--dsw-alias-border-l1)',
                              borderTop: '3px solid #8b5cf6',
                              background: 'var(--dsw-alias-bg-layer-1)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            },
                          },
                            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                              h('span', { style: { fontSize: 11, fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } },
                                'Step 2 · ⚙️ 核心执行 (工具轨迹)'),
                              h('span', { className: 'rt-mono', style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                                activeStepTimeline.length + ' 步 · ' + (inspDigest.filesTouched || []).length + ' 文件')),
                            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
                              (inspDigest.filesTouched || []).map((fp) => h('span', {
                                key: 'ft-' + fp,
                                className: 'rt-mono',
                                style: { fontSize: 9.5, padding: '1px 5px', borderRadius: 4, background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)' },
                              }, fp))),
                            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                              activeStepTimeline.map((st, sIdx) => h('div', {
                                key: 'traj-' + sIdx,
                                style: {
                                  display: 'grid',
                                  gridTemplateColumns: 'auto auto minmax(0, 1fr) auto',
                                  alignItems: 'center',
                                  gap: 5,
                                  padding: '4px 7px',
                                  borderRadius: 6,
                                  background: 'var(--dsw-alias-bg-base)',
                                  border: '1px solid var(--dsw-alias-border-l1)',
                                  fontSize: 10.5,
                                },
                              },
                                h('span', { className: 'rt-mono', style: { fontWeight: 700, color: activeInspectorAgent.color || '#3b82f6' } },
                                  '#' + st.step),
                                h('span', {
                                  className: 'rt-mono',
                                  style: { fontSize: 9.5, padding: '1px 5px', borderRadius: 4, background: 'var(--dsw-alias-bg-layer-2)', fontWeight: 600 },
                                }, st.tool),
                                h('span', {
                                  style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-primary)' },
                                  title: st.input + ' -> ' + st.output,
                                }, st.input),
                                h('span', {
                                  className: 'rt-mono',
                                  style: {
                                    fontSize: 9.5,
                                    color: st.status === 'error' ? '#ef4444' : (st.status === 'running' ? '#3b82f6' : (st.status === 'pending' ? '#f59e0b' : '#10b981')),
                                    fontWeight: 600,
                                  },
                                }, st.status === 'error' ? '⚠ 异常' : (st.status === 'running' ? '● 执行中' : (st.status === 'pending' ? '○ 待执行' : '✓ 完成'))))))),

                          /* Step 3 · 阶段结论与 Plan 审批闭环 */
                          h('div', {
                            className: 'rt-step-node',
                            style: {
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: '1px solid var(--dsw-alias-border-l1)',
                              borderTop: '3px solid #10b981',
                              background: 'var(--dsw-alias-bg-layer-1)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                            },
                          },
                            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                              h('span', { style: { fontSize: 11, fontWeight: 700, color: 'var(--dsw-alias-label-primary)' } },
                                'Step 3 · 📤 阶段结论与 Plan 审批'),
                              h('span', {
                                style: {
                                  fontSize: 9.5,
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: 99,
                                  background: isInspRevReq ? 'rgba(239,68,68,0.14)' : (isInspApproved ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.16)'),
                                  color: isInspRevReq ? '#ef4444' : (isInspApproved ? '#10b981' : '#f59e0b'),
                                },
                              }, isInspRevReq ? '↩ 已驳回重做' : (isInspApproved ? '✓ 已审批' : '⏳ 待 Plan 审批'))),
                            h('div', {
                              className: 'rt-digest-box',
                              style: {
                                padding: '7px 9px',
                                borderRadius: 7,
                                border: '1px dashed var(--dsw-alias-border-l1)',
                                background: 'var(--dsw-alias-bg-base)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                              },
                            },
                              h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-primary)', lineHeight: 1.5 } },
                                inspDigest.whatWasDone || (activeInspectorDetail && activeInspectorDetail.output) || activeInspectorAgent.output),
                              rawTokNum > 0
                                ? h('div', { className: 'rt-mono', style: { fontSize: 10, color: '#3b82f6', fontWeight: 600 } },
                                    `原始 ${rawTokNum} tok ➔ 压缩后 ${compTokNum} tok (-${compPctNum}%)`)
                                : null))),

                        /* 底部可编辑 nextGoal + Plan 审批通过 / 驳回重做栏 */
                        h('div', {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                            paddingTop: 6,
                            borderTop: '1px dashed var(--dsw-alias-border-l1)',
                          },
                        },
                          h('span', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, '下一阶段目标：'),
                          h('input', {
                            className: 'rt-input',
                            style: { flex: '1 1 220px', height: 26, fontSize: 11.5 },
                            value: customNextGoal,
                            onChange: (e) => setCustomNextGoal(e.target.value),
                            placeholder: '输入审批通过后下达给下一波次的新目标...',
                          }),
                          h('input', {
                            className: 'rt-input',
                            style: { width: 150, height: 26, fontSize: 11 },
                            value: reviewNote,
                            onChange: (e) => setReviewNote(e.target.value),
                            placeholder: '审批备注（选填）',
                          }),
                          h('button', {
                            type: 'button',
                            disabled: approvingBusy,
                            className: 'rt-btn rt-plan-approve-btn' + (isInspApproved ? '' : ' rt-btn-primary'),
                            style: { padding: '3px 10px', fontSize: 11, fontWeight: 700 },
                            onClick: () => handlePlanApproveWorker(activeInspectorAgent, 'approved'),
                          }, approvingBusy ? '提交中…' : '✓ Plan 审批通过并下达新目标'),
                          !activeInspectorAgent.isRoot
                            ? h('button', {
                                type: 'button',
                                disabled: approvingBusy,
                                className: 'rt-btn',
                                style: { padding: '3px 9px', fontSize: 11, color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' },
                                onClick: () => handlePlanApproveWorker(activeInspectorAgent, 'revision_requested'),
                              }, '↩ 驳回重做')
                            : null,
                          h('button', {
                            type: 'button',
                            className: 'rt-btn',
                            style: { padding: '3px 8px', fontSize: 10.5 },
                            onClick: () => { setSelId(activeInspectorAgent.role || 'plan'); setMode('docwall') },
                          }, '查看角色文稿 →')))
                    })()
                  : h('div', {
                      className: 'rt-agent-inspector-drawer',
                      style: {
                        border: '1px dashed var(--dsw-alias-border-l1)',
                        borderRadius: 10,
                        padding: '8px 12px',
                        background: 'var(--dsw-alias-bg-base)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        fontSize: 11.5,
                        color: 'var(--dsw-alias-label-secondary)',
                      },
                    },
                      h('span', null, '🔍 点击上方开发树任意节点或下方泳道行，即可展开「Agent 环节执行轨迹与 Plan 审批抽屉」梳理细节并按需跳转聊天框'),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn',
                        style: { padding: '2px 8px', fontSize: 11 },
                        onClick: () => openAgentInspector('root'),
                      }, '展开主控环节预览')),

                /* Section 2: 全宽跨 Agent 协作 3 段式泳道 (.rt-swim-pane) */
                h('div', {
                  className: 'rt-swim-pane rt-p4-swimlane-pane',
                  style: {
                    border: '1px solid var(--dsw-alias-border-l1)',
                    borderRadius: 12,
                    padding: 12,
                    background: 'var(--dsw-alias-bg-base)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  },
                },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                    h('span', { style: { fontWeight: 700, fontSize: 13 } }, '跨 Agent 协作 (P0 → P3 优先级泳道)'),
                    h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                      filteredEvents.length + '/' + allCollabEvents.length + ' 条记录 · ' + swimFilteredLanes.length + ' 条泳道 · 点击环节胶囊定位上方轨迹抽屉'),
                    h('div', { className: 'rt-spacer' }),
                    h('input', {
                      className: 'rt-input',
                      style: { width: 128, height: 24, fontSize: 11, padding: '0 7px' },
                      placeholder: '搜索 Agent...',
                      value: collabSearch,
                      onChange: (e) => setCollabSearch(e.target.value),
                    }),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn' + (collabSort === 'asc' ? ' rt-btn-primary' : ''),
                      style: { padding: '1px 7px', fontSize: 11 },
                      onClick: () => setCollabSort('asc'),
                    }, '最早'),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn' + (collabSort === 'desc' ? ' rt-btn-primary' : ''),
                      style: { padding: '1px 7px', fontSize: 11 },
                      onClick: () => setCollabSort('desc'),
                    }, '最新')),

                  h('div', { className: 'rt-swim-wave-filter', style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
                    [
                      { k: 'all', lbl: '全部' },
                      { k: 'running', lbl: '运行中' },
                      { k: '1', lbl: 'Wave 1 立项' },
                      { k: '2', lbl: 'Wave 2 架构' },
                      { k: '3', lbl: 'Wave 3 构建' },
                      { k: '4', lbl: 'Wave 4 审查' },
                    ].map((wf) => h('button', {
                      key: 'swf-' + wf.k,
                      type: 'button',
                      className: 'rt-p3-pill' + (swimWaveFilter === wf.k ? ' on' : ''),
                      style: { fontSize: 10.5, padding: '2px 8px' },
                      onClick: () => setSwimWaveFilter(wf.k),
                    }, wf.lbl))),

                  h('div', {
                    className: 'rt-swim-matrix-wrap',
                    style: {
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      border: '1px solid var(--dsw-alias-border-l1)',
                      borderRadius: 10,
                      background: 'var(--dsw-alias-bg-layer-1)',
                      overflow: 'hidden',
                    },
                  },
                    swimFilteredLanes.map((lane, lIdx) => {
                      const isLaneSel = (activeInspectorAgent && activeInspectorAgent.id === lane.id) || selAgentId === lane.id
                      const laneSteps = lane.steps || (lane.isRoot ? rootSteps : 0)
                      const laneTok = lane.tokenLabel || rootTokensLabel
                      const laneDur = lane.durationLabel || (lane.isRoot ? rootDuration : '待命')
                      const laneStatus = lane.isRoot ? (runningCount > 0 ? 'running' : 'done') : (lane.status || 'done')
                      const lanePriMeta = PRIORITY_BADGE_META[lane.uiPriority] || PRIORITY_BADGE_META.P2
                      const laneCompPct = lane.compressionPct || 0
                      const laneApproved = (approvedWorkerMap[lane.id] && approvedWorkerMap[lane.id].approved) || lane.approvalState === 'approved'
                      const step1Text = lane.isRoot ? '全局需求拆解与 4-Wave 并发调度' : (lane.prompt || lane.title)
                      const step2Text = laneSteps + ' 步工具调用 · ' + laneTok + ' · ' + laneDur
                      const step3Text = lane.isRoot
                        ? (fusedChildren.length > 0 ? ('已统筹 ' + fusedChildren.length + ' 个子代理压缩摘要与 Plan 审批') : '主控编排器就绪，等待拆解任务')
                        : ((lane.output || '等待同步产物') + (laneCompPct > 0 ? (' · 压缩 -' + laneCompPct + '%') : ''))
                      const orderedStages = collabSort === 'desc'
                        ? [
                            { key: 's3', tag: '📤 阶段结论', text: step3Text, isConclusion: true },
                            { key: 's2', tag: '⚙️ 核心执行', text: step2Text, isConclusion: false },
                            { key: 's1', tag: '📥 委派目标', text: step1Text, isConclusion: false },
                          ]
                        : [
                            { key: 's1', tag: '📥 委派目标', text: step1Text, isConclusion: false },
                            { key: 's2', tag: '⚙️ 核心执行', text: step2Text, isConclusion: false },
                            { key: 's3', tag: '📤 阶段结论', text: step3Text, isConclusion: true },
                          ]

                      return h('div', Object.assign({
                        key: 'lane-' + lane.id,
                        className: 'rt-swim-row' + (isLaneSel ? ' on' : ''),
                        style: {
                          display: 'grid',
                          gridTemplateColumns: '210px minmax(0, 1fr)',
                          alignItems: 'stretch',
                          minHeight: 58,
                          borderBottom: lIdx < swimFilteredLanes.length - 1 ? '1px solid var(--dsw-alias-border-l1)' : 'none',
                          background: isLaneSel ? 'rgba(59,130,246,0.08)' : 'transparent',
                          cursor: 'pointer',
                          position: 'relative',
                        },
                      }, clickable(() => openAgentInspector(lane.id), { label: '梳理 Agent 环节详情 ' + lane.title, expanded: isLaneSel })),
                        h('div', {
                          className: 'rt-swim-meta',
                          style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRight: '1px solid var(--dsw-alias-border-l1)', minWidth: 0 },
                        },
                          h('span', {
                            style: {
                              background: lane.color,
                              color: '#fff',
                              fontSize: 10,
                              fontWeight: 700,
                              width: lane.isRoot ? 32 : 26,
                              height: 24,
                              borderRadius: 7,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flex: 'none',
                              fontFamily: 'ui-monospace,Menlo,monospace',
                            },
                          }, lane.avatar),
                          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 } },
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 } },
                              h('span', {
                                className: lanePriMeta.cls,
                                style: { fontSize: 9, fontWeight: 700, padding: '0 4px', borderRadius: 3, flex: 'none' },
                              }, lane.uiPriority || 'P2'),
                              h('span', {
                                style: {
                                  fontSize: 11.5,
                                  fontWeight: 700,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  color: 'var(--dsw-alias-label-primary)',
                                  flex: 1,
                                },
                                title: lane.title,
                              }, lane.isRoot ? ('主控 · ' + lane.title) : lane.title)),
                            h('span', {
                              className: 'rt-mono',
                              style: { fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                            }, ((lane.workerTags && lane.workerTags[0]) || '#lmtex') + (laneCompPct > 0 ? (' · 压缩 -' + laneCompPct + '%') : '') + ' · ' + (laneApproved ? '✓已审' : '⏳待审')))),
                        h('div', {
                          className: 'rt-swim-track',
                          style: { position: 'relative', display: 'flex', alignItems: 'center', padding: '6px 10px', minWidth: 0 },
                        },
                          h('div', {
                            style: { position: 'absolute', left: 12, right: 12, top: '50%', height: 1.5, background: 'var(--dsw-alias-border-l1)', zIndex: 0 },
                          }),
                          h('div', {
                            className: 'rt-step-chain',
                            style: {
                              position: 'relative',
                              zIndex: 1,
                              display: 'grid',
                              gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1.08fr)',
                              alignItems: 'center',
                              gap: 5,
                              width: '100%',
                              minWidth: 0,
                            },
                          },
                            orderedStages.reduce((acc, stg, sIdx) => {
                              if (sIdx > 0) {
                                acc.push(h('span', {
                                  key: 'arr-' + lane.id + '-' + sIdx,
                                  className: 'rt-step-arrow rt-mono',
                                  style: { fontSize: 10, color: lane.color, fontWeight: 700, padding: '0 1px', userSelect: 'none' },
                                }, collabSort === 'desc' ? '◄──' : '──►'))
                              }
                              acc.push(h('div', Object.assign({
                                key: 'pill-' + lane.id + '-' + stg.key,
                                className: 'rt-step-node rt-step-pill' + (isLaneSel ? ' on' : ''),
                                title: stg.tag + '：' + stg.text,
                                style: {
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 2,
                                  padding: '4px 8px',
                                  borderRadius: 8,
                                  border: isLaneSel ? ('1px solid ' + lane.color) : '1px solid var(--dsw-alias-border-l1)',
                                  borderLeft: '3px solid ' + lane.color,
                                  background: 'var(--dsw-alias-bg-base)',
                                  minWidth: 0,
                                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                },
                              }, clickable((e) => {
                                if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
                                openAgentInspector(lane.id)
                              }, { label: '展开 ' + lane.title + ' ' + stg.tag + ' 详情', expanded: isLaneSel })),
                                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 } },
                                  h('span', { style: { fontSize: 10, fontWeight: 700, color: lane.color, whiteSpace: 'nowrap' } }, stg.tag),
                                  stg.isConclusion
                                    ? h('span', {
                                        style: {
                                          fontSize: 9.5,
                                          fontWeight: 700,
                                          padding: '0 5px',
                                          borderRadius: 99,
                                          whiteSpace: 'nowrap',
                                          background: laneStatus === 'error'
                                            ? 'rgba(239,68,68,0.14)'
                                            : (laneStatus === 'running' ? 'rgba(59,130,246,0.14)' : 'rgba(16,185,129,0.14)'),
                                          color: laneStatus === 'error' ? '#ef4444' : (laneStatus === 'running' ? '#3b82f6' : '#10b981'),
                                        },
                                      }, laneStatus === 'error' ? '⚠ 异常待修复' : (laneStatus === 'running' ? '● 运行中' : (laneStatus === 'pending' ? '○ 待执行' : '✓ 已完成')))
                                    : null),
                                h('span', {
                                  style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                                }, stg.text)))
                              return acc
                            }, []))))
                    }))),

                /* Section 3: 响应式多列协作任务网格 (.rt-collab-pane) */
                h('div', {
                  className: 'rt-collab-pane rt-p4-tasks-pane',
                  style: {
                    border: '1px solid var(--dsw-alias-border-l1)',
                    borderRadius: 12,
                    padding: 12,
                    background: 'var(--dsw-alias-bg-base)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  },
                },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                    h('span', { style: { fontWeight: 700, fontSize: 13 } }, '协作任务'),
                    h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                      filteredTasks.length + '/' + allTasks.length + ' 个工作项'),
                    h('div', { className: 'rt-spacer' }),
                    h('input', {
                      className: 'rt-input',
                      style: { width: 128, height: 24, fontSize: 11, padding: '0 7px' },
                      placeholder: '搜索工作项...',
                      value: taskSearch,
                      onChange: (e) => setTaskSearch(e.target.value),
                    })),
                  h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
                    [
                      { k: 'all', lbl: '全部 ' + allTasks.length },
                      { k: 'run', lbl: '进行中 ' + runTaskCount },
                      { k: 'wait', lbl: '待处理 ' + waitTaskCount },
                      { k: 'done', lbl: '已完成 ' + doneTaskCount },
                    ].map((fp) => h('button', {
                      key: fp.k,
                      type: 'button',
                      className: 'rt-p3-pill' + (taskFilter === fp.k ? ' on' : ''),
                      onClick: () => setTaskFilter(fp.k),
                    }, fp.lbl))),
                  filteredTasks.length === 0
                    ? h('div', { className: 'rt-empty' }, '当前暂无协作工作项 —— 在上方拆解需求或新增分片后将自动生成卡片。')
                    : h('div', {
                        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 },
                      },
                        filteredTasks.map((tk) => {
                          const isExp = expandedTaskId === tk.id
                          return h('div', Object.assign({
                            key: tk.id,
                            className: 'rt-p4-task-card' + (isExp ? ' open' : '') + (tk.rawStatus === 'error' ? ' is-error' : ''),
                            style: {
                              border: '1px solid var(--dsw-alias-border-l1)',
                              borderLeft: '3.5px solid ' + tk.color,
                              borderRadius: 9,
                              padding: '8px 10px',
                              background: tk.color + '10',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 5,
                            },
                          }, clickable(() => setExpandedTaskId(isExp ? null : tk.id), { label: '展开协作任务详情 ' + tk.title, expanded: isExp })),
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                              h('span', {
                                style: { background: tk.color, color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5, fontFamily: 'ui-monospace,Menlo,monospace' },
                              }, tk.avatar),
                              h('span', { style: { fontWeight: 700, fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, tk.title),
                              h('span', { className: 'rt-tag', style: { margin: 0, fontSize: 10 } }, '子 Agent'),
                              h('span', {
                                style: {
                                  fontSize: 10.5,
                                  fontWeight: 600,
                                  padding: '1px 7px',
                                  borderRadius: 99,
                                  background: tk.rawStatus === 'error' ? 'rgba(239,68,68,0.14)' : (tk.status === 'run' ? 'rgba(59,130,246,0.14)' : 'rgba(16,185,129,0.14)'),
                                  color: tk.rawStatus === 'error' ? '#ef4444' : (tk.status === 'run' ? '#3b82f6' : '#10b981'),
                                },
                              }, tk.statusBadge)),
                            h('div', {
                              style: {
                                fontSize: 11.5,
                                color: 'var(--dsw-alias-label-secondary)',
                                overflow: isExp ? 'visible' : 'hidden',
                                textOverflow: isExp ? 'clip' : 'ellipsis',
                                whiteSpace: isExp ? 'normal' : 'nowrap',
                                lineHeight: 1.5,
                              },
                            }, '委派: ' + tk.prompt),
                            isExp
                              ? h('div', {
                                  style: { marginTop: 4, paddingTop: 6, borderTop: '1px dashed var(--dsw-alias-border-l1)', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5 },
                                },
                                  h('div', { style: { color: 'var(--dsw-alias-label-primary)', lineHeight: 1.55 } },
                                    h('b', null, '产出摘要：'), tk.output),
                                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
                                    h('span', { className: 'rt-mono' }, '用量 ' + tk.tokenLabel),
                                    h('span', { className: 'rt-mono' }, '耗时 ' + tk.durationLabel),
                                    h('span', { className: 'rt-mono' }, tk.steps + ' 步'),
                                    h('div', { className: 'rt-spacer' }),
                                    h('button', {
                                      type: 'button',
                                      className: 'rt-btn',
                                      style: { padding: '1px 7px', fontSize: 10.5 },
                                      onClick: (e) => { e.stopPropagation(); openAgentInspector(tk.agentId) },
                                    }, '🔍 梳理环节细节'),
                                    h('button', {
                                      type: 'button',
                                      className: 'rt-btn rt-jump-chat-btn',
                                      style: { padding: '1px 7px', fontSize: 10.5 },
                                      onClick: (e) => { e.stopPropagation(); openAgentSessionInHostChat(tk) },
                                    }, '💬 跳转侧边聊天框打开该 Agent 会话 ↗'),
                                    h('button', {
                                      type: 'button',
                                      className: 'rt-btn',
                                      style: { padding: '1px 7px', fontSize: 10.5 },
                                      onClick: (e) => { e.stopPropagation(); setSelId(tk.role); setMode('docwall') },
                                    }, '查看角色文稿 →'),
                                    h('button', {
                                      type: 'button',
                                      className: 'rt-btn rt-btn-primary',
                                      style: { padding: '1px 7px', fontSize: 10.5 },
                                      onClick: (e) => { e.stopPropagation(); triggerCheckpoint('断点续跑', 'resume', tk.agentId || tk.role) },
                                    }, '断点续跑')))
                              : null)
                        })))))
          : null,

        /* ── 模式 2: p5 树状图画布 · 团队任务板 ── */
        effectiveMode === 'p5'
          ? h('div', { className: 'rt-p5-board', style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              h('div', {
                className: 'rt-p5-topbar',
                style: {
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                  padding: '9px 14px', borderRadius: 10, border: '1px solid var(--dsw-alias-border-l1)',
                  background: 'var(--dsw-alias-bg-layer-2)',
                },
              },
                h('span', { style: { fontWeight: 700, fontSize: 12.5 } },
                  '团队任务板 · 团队 ' + totalAgents + ' 成员 · ' + allTasks.length + ' 任务 · ' + doneTaskCount + ' 已完成'),
                h('div', { className: 'rt-p5-filters', style: { display: 'inline-flex', gap: 5, marginLeft: 4 } },
                  h('button', {
                    type: 'button',
                    className: 'rt-p3-pill' + (p5Filter === 'all' ? ' on' : ''),
                    onClick: () => setP5Filter('all'),
                  }, '全部'),
                  h('button', {
                    type: 'button',
                    className: 'rt-p3-pill' + (p5Filter === 'lead' ? ' on' : ''),
                    onClick: () => setP5Filter('lead'),
                  }, '主代理 lead'),
                  h('button', {
                    type: 'button',
                    className: 'rt-p3-pill' + (p5Filter === 'sub' ? ' on' : ''),
                    onClick: () => setP5Filter('sub'),
                  }, '子代理')),
                h('div', { className: 'rt-spacer' }),
                h('button', {
                  type: 'button',
                  className: 'rt-btn rt-btn-primary',
                  onClick: addQuickTask,
                }, '+ 新建任务')),

              h('div', {
                className: 'rt-p5-canvas-wrap',
                style: {
                  position: 'relative',
                  border: '1px solid var(--dsw-alias-border-l1)',
                  borderRadius: 12,
                  padding: '28px 24px 64px',
                  background: 'radial-gradient(circle at 12px 12px, rgba(77,107,254,0.14) 1.2px, transparent 1.2px), var(--dsw-alias-bg-base)',
                  backgroundSize: '18px 18px',
                  overflow: 'auto',
                  minHeight: 380,
                  display: 'flex',
                  justifyContent: 'center',
                },
              },
                h('div', {
                  className: 'rt-p5-tree-stage rt-p5-tree',
                  style: {
                    width: 760,
                    maxWidth: '100%',
                    transform: 'scale(' + (zoom / 100) + ')',
                    transformOrigin: 'top center',
                    transition: 'transform 0.16s cubic-bezier(0.22, 1, 0.36, 1)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                  },
                },
                  h('div', {
                    className: 'rt-p5-root-wrap',
                    style: {
                      width: 360, maxWidth: '92%', position: 'relative',
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      opacity: p5Filter === 'sub' ? 0.72 : 1,
                    },
                  },
                    h('div', Object.assign({
                      className: 'rt-p5-node rt-p5-root' + (selAgentId === 'root' ? ' on' : ''),
                      style: {
                        width: 360, maxWidth: '100%', boxSizing: 'border-box', position: 'relative',
                        border: '1.5px solid #3b82f6', borderRadius: 12, padding: '12px 14px',
                        background: 'linear-gradient(180deg, rgba(59,130,246,0.08) 0%, transparent 48%), var(--dsw-alias-bg-layer-1)',
                        boxShadow: '0 6px 20px -4px rgba(59,130,246,0.16)',
                        display: 'flex', flexDirection: 'column', gap: 7, cursor: 'pointer',
                      },
                    }, clickable(() => setSelAgentId(selAgentId === 'root' ? null : 'root'), { label: '主代理节点 ' + workspaceDisplayTitle, expanded: selAgentId === 'root' })),
                      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                        h('span', { className: 'rt-p5-pill', style: { background: '#3b82f6', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999 } }, '主代理'),
                        h('span', { className: 'rt-p5-pill rt-tag rt-tag-live', style: { margin: 0, background: 'rgba(14,165,233,0.14)', color: '#0284c7', borderColor: 'rgba(14,165,233,0.35)', borderRadius: 999, padding: '1px 8px', fontSize: 10.5, fontWeight: 700 } }, 'lead'),
                        h('span', { className: 'rt-p5-pill rt-tag rt-tag-active', style: { margin: 0, borderRadius: 999, padding: '1px 8px', fontSize: 10, fontWeight: 700 } }, '可续接'),
                        h('div', { className: 'rt-spacer' }),
                        h('span', { className: 'rt-mono', style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } }, rootTokensLabel + ' · ' + rootSteps + ' 步')),
                      h('div', { style: { fontSize: 13.5, fontWeight: 700, color: 'var(--dsw-alias-label-primary)', lineHeight: 1.4 } }, workspaceDisplayTitle),
                      h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.55 } },
                        '主控架构师 (Captain) 统筹需求拆解、架构分片契约与并发子代理执行，持续将结构化成果同步至事实库。'),
                      h('div', {
                        style: { marginTop: 2, paddingTop: 7, borderTop: '1px solid var(--dsw-alias-border-l1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: '#3b82f6' },
                      },
                        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
                          h('span', { className: 'rt-p5-spin' }, '●'),
                          h('span', null, runningCount > 0 ? '正在协调并发子代理' : '主控就绪')),
                        h('span', { className: 'rt-mono', style: { fontSize: 10.5 } }, rootCtxPct)),
                      h('span', { className: 'rt-node-handle rt-node-handle-bottom', style: { borderColor: '#3b82f6' } }))),

                  p5Filter === 'lead' || fusedChildren.length === 0
                    ? (fusedChildren.length === 0
                      ? h('div', { className: 'rt-empty', style: { marginTop: 18 } }, '暂无已派发的子代理任务 —— 点击右上角「+ 新建任务」或前往「协同与审批」拆解。')
                      : null)
                    : h(React.Fragment, null,
                        h('svg', {
                          className: 'rt-p5-branch-svg rt-p5-connector-svg',
                          viewBox: '0 0 760 68',
                          preserveAspectRatio: 'none',
                          style: { width: 760, maxWidth: '100%', height: 68, display: 'block', overflow: 'visible', margin: '0 auto' },
                          'aria-label': '主代理到子代理分支连线',
                        },
                          h('path', {
                            d: 'M 380,0 C 380,34 180,34 180,68',
                            fill: 'none',
                            stroke: (primaryTreeChild && primaryTreeChild.color) || '#8b5cf6',
                            strokeWidth: '2.4',
                          }),
                          h('path', {
                            d: 'M 380,0 C 380,34 580,34 580,68',
                            fill: 'none',
                            stroke: '#10b981',
                            strokeWidth: '2.2',
                            strokeDasharray: '6 4',
                          }),
                          h('circle', { cx: '380', cy: '2', r: '4', fill: '#3b82f6' }),
                          h('circle', { cx: '180', cy: '66', r: '3.8', fill: (primaryTreeChild && primaryTreeChild.color) || '#8b5cf6' }),
                          h('circle', { cx: '580', cy: '66', r: '3.8', fill: '#10b981' })),
                        h('div', {
                          className: 'rt-p5-branches-grid rt-p5-branches',
                          style: {
                            width: 760, maxWidth: '100%', display: 'grid',
                            gridTemplateColumns: 'repeat(2, minmax(0, 360px))',
                            justifyContent: 'space-between', gap: 40, alignItems: 'start',
                          },
                        },
                          primaryTreeChild
                            ? h('div', Object.assign({
                                className: 'rt-p5-node rt-p5-child-active' + (selAgentId === primaryTreeChild.id ? ' on' : ''),
                                style: {
                                  position: 'relative', width: '100%', boxSizing: 'border-box',
                                  border: '1.5px solid ' + primaryTreeChild.color, borderRadius: 12, padding: '12px 14px',
                                  background: 'var(--dsw-alias-bg-layer-1)', boxShadow: '0 4px 16px -4px rgba(15,23,42,0.1)',
                                  display: 'flex', flexDirection: 'column', gap: 7, cursor: 'pointer',
                                },
                              }, clickable(() => setSelAgentId(selAgentId === primaryTreeChild.id ? null : primaryTreeChild.id), { label: '子代理节点 ' + primaryTreeChild.title, expanded: selAgentId === primaryTreeChild.id })),
                                h('span', { className: 'rt-node-handle rt-node-handle-top', style: { borderColor: primaryTreeChild.color } }),
                                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                                  h('span', { className: 'rt-p5-pill', style: { background: primaryTreeChild.color, color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999 } }, '子代理'),
                                  h('span', { className: 'rt-p5-pill rt-tag rt-tag-active', style: { margin: 0, borderRadius: 999, padding: '1px 8px', fontSize: 10.5, fontWeight: 700 } }, '可续接'),
                                  h('span', { className: 'rt-mono', style: { fontSize: 10.5, fontWeight: 700, color: primaryTreeChild.color } }, primaryTreeChild.avatar),
                                  h('div', { className: 'rt-spacer' }),
                                  h('span', { className: 'rt-mono', style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } }, primaryTreeChild.tokenLabel)),
                                h('div', { style: { fontWeight: 700, fontSize: 13, color: 'var(--dsw-alias-label-primary)', lineHeight: 1.4 } }, primaryTreeChild.title),
                                h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.55 } }, primaryTreeChild.output),
                                h('div', {
                                  style: { marginTop: 2, paddingTop: 7, borderTop: '1px solid var(--dsw-alias-border-l1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, fontWeight: 600, color: primaryTreeChild.color },
                                },
                                  h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
                                    h('span', { className: 'rt-p5-spin' }, '●'),
                                    h('span', null, primaryTreeChild.statusLabel || '运行中')),
                                  h('span', { className: 'rt-mono', style: { fontSize: 10.5 } }, primaryTreeChild.durationLabel)))
                            : null,
                          h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' } },
                            h('div', {
                              className: 'rt-p5-node rt-p5-done-group',
                              style: {
                                position: 'relative', width: '100%', boxSizing: 'border-box',
                                border: '1.5px dashed #10b981', borderRadius: 12, padding: '12px 14px',
                                background: 'linear-gradient(180deg, rgba(16,185,129,0.06) 0%, transparent 50%), var(--dsw-alias-bg-layer-1)',
                                display: 'flex', flexDirection: 'column', gap: 7,
                              },
                            },
                              h('span', { className: 'rt-node-handle rt-node-handle-top', style: { borderColor: '#10b981' } }),
                              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                                h('span', { className: 'rt-p5-pill', style: { background: 'rgba(16,185,129,0.16)', color: '#10b981', fontSize: 10.5, fontWeight: 700, padding: '2px 9px', borderRadius: 999, border: '1px solid rgba(16,185,129,0.35)' } }, '✓ ' + doneGroupList.length + ' 归档子代理'),
                                h('span', { className: 'rt-tag', style: { margin: 0, borderRadius: 999, padding: '1px 8px' } }, '并行子代理归档'),
                                h('div', { className: 'rt-spacer' }),
                                h('button', {
                                  type: 'button',
                                  className: 'rt-btn',
                                  style: { padding: '2px 9px', fontSize: 11, fontWeight: 600, borderRadius: 999 },
                                  onClick: () => setP5Expanded((v) => !v),
                                }, p5Expanded ? '收起 ⌃' : '展开 ⌄')),
                              h('div', { style: { fontWeight: 700, fontSize: 12.5, lineHeight: 1.45, color: 'var(--dsw-alias-label-primary)' } },
                                doneGroupList.length > 0 ? doneGroupList.map((c) => c.title).join(' / ') : '等待更多子代理归档'),
                              h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 } },
                                '累计消耗 ' + fmtTokNum(doneGroupList.reduce((s, c) => s + (c.tokens || 0), 0)) + ' tok')),
                            p5Expanded && doneGroupList.length > 0
                              ? h('div', {
                                  style: { width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, paddingLeft: 12, borderLeft: '2px dashed #10b981' },
                                },
                                  doneGroupList.map((dc) => h('div', Object.assign({
                                    key: 'p5-exp-' + dc.id,
                                    className: 'rt-p5-node rt-p5-done-item' + (selAgentId === dc.id ? ' on' : ''),
                                    style: {
                                      position: 'relative', border: '1px solid var(--dsw-alias-border-l1)', borderLeft: '3px solid ' + dc.color,
                                      borderRadius: 10, padding: '9px 12px', background: 'var(--dsw-alias-bg-layer-2)',
                                      display: 'flex', flexDirection: 'column', gap: 5, cursor: 'pointer',
                                    },
                                  }, clickable(() => setSelAgentId(selAgentId === dc.id ? null : dc.id), { label: '已完成子代理 ' + dc.title, expanded: selAgentId === dc.id })),
                                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                                      h('span', { style: { background: dc.color, color: '#fff', fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 999 } }, dc.avatar),
                                      h('span', { style: { fontWeight: 700, fontSize: 11.5 } }, dc.title),
                                      h('span', { className: 'rt-p5-pill rt-tag rt-tag-live', style: { margin: 0, fontSize: 9.5, borderRadius: 999, padding: '0 7px' } }, '可续接'),
                                      h('div', { className: 'rt-spacer' }),
                                      h('span', { className: 'rt-mono', style: { fontSize: 10 } }, dc.tokenLabel + ' · ' + dc.durationLabel)),
                                    h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, dc.output))))
                              : null)))),

                h('div', {
                  className: 'rt-p5-zoom-bar',
                  style: {
                    position: 'absolute', right: 14, bottom: 12,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 8px', borderRadius: 999,
                    background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1) 92%, transparent)',
                    border: '1px solid var(--dsw-alias-border-l1)',
                    boxShadow: '0 4px 14px rgba(15,23,42,0.14)',
                    zIndex: 5,
                  },
                },
                  h('span', { style: { padding: '1px 7px', fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)', borderRight: '1px solid var(--dsw-alias-border-l1)' } }, '树状图 ⌄'),
                  h('button', { type: 'button', className: 'rt-btn', style: { padding: '1px 7px', fontSize: 11, borderRadius: 999 }, onClick: () => setZoom((z) => Math.max(60, z - 10)) }, '-'),
                  h('button', { type: 'button', className: 'rt-btn', style: { padding: '1px 7px', fontSize: 11, fontFamily: 'ui-monospace,Menlo,monospace', borderRadius: 999 }, onClick: () => setZoom(100) }, zoom + '%'),
                  h('button', { type: 'button', className: 'rt-btn', style: { padding: '1px 7px', fontSize: 11, borderRadius: 999 }, onClick: () => setZoom((z) => Math.min(140, z + 10)) }, '+'),
                  h('button', { type: 'button', className: 'rt-btn' + (p5Expanded ? ' rt-btn-primary' : ''), style: { padding: '1px 9px', fontSize: 11, borderRadius: 999 }, onClick: () => setP5Expanded((v) => !v) }, p5Expanded ? '收起全部' : '展开全部'))))
          : null,

        /* ── 模式 3: 文稿视图 (Doc Wall) ── */
        effectiveMode === 'docwall'
          ? h('div', { className: 'rt-doc-wall' },
              h('div', { className: 'rt-doc-strip' },
                allNodes.map((n) => h('div', Object.assign({
                  key: 'doc' + n.id,
                  className: 'rt-doc-item' + (selId === n.id ? ' on' : ''),
                }, clickable(() => setSelId(n.id), { label: '预览文稿 ' + n.docTitle, expanded: selId === n.id })),
                  h('div', { className: 'rt-doc-item-title' }, n.code + ' · ' + n.docTitle),
                  h('div', { className: 'rt-doc-item-sub' }, n.name + ' (' + n.statusLabel + ')')))),
              h('div', { className: 'rt-doc-preview' },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h('b', { className: 'rt-mono' }, selected.docTitle),
                  h('span', { className: 'rt-tag rt-tag-live' }, selected.statusLabel),
                  h('div', { className: 'rt-spacer' }),
                  h('button', {
                    type: 'button',
                    className: 'rt-btn',
                    onClick: () => copyWithFeedback(selected.docBody, selected.docTitle, (okFlag, m) => setToast(m)),
                  }, '复制文稿'),
                  h('button', { type: 'button', className: 'rt-btn', onClick: () => setMode('p4') }, '返回网络画布')),
                h(Markdown, { className: 'rt-markdown', text: selected.docBody })))
          : null,

        /* ── 模式 4: 飞书通知 (Feishu Push) ── */
        effectiveMode === 'feishu'
          ? h('div', { className: 'rt-feishu-panel' },
              h('div', { style: { fontWeight: 600, fontSize: 12.5 } }, '飞书群聊机器人推送 (Feishu Bot Webhook · 节点完成与交付归档通知)'),
              h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                h('input', {
                  className: 'rt-input', style: { flex: 1, minWidth: 220 },
                  placeholder: '输入飞书机器人 Webhook 地址 (https://open.feishu.cn/open-apis/bot/v2/hook/...)',
                  value: webhook, onChange: (e) => setWebhook(e.target.value),
                }),
                h('button', { type: 'button', className: 'rt-btn rt-btn-primary', onClick: triggerFeishuPush }, '发送测试推送'),
                h('button', { type: 'button', className: 'rt-btn', disabled: feishuSaving, onClick: saveFeishuConfig }, feishuSaving ? '保存中…' : '保存推送配置')),
              h('div', { className: 'rt-feishu-checks' },
                h('label', { className: 'rt-kb-check' },
                  h('input', { type: 'checkbox', checked: feishuOnNode, onChange: (e) => setFeishuOnNode(e.target.checked) }),
                  'Wave 1–4 节点完成时推送卡片'),
                h('label', { className: 'rt-kb-check' },
                  h('input', { type: 'checkbox', checked: feishuOnGate, onChange: (e) => setFeishuOnGate(e.target.checked) }),
                  'CSO / QA 门禁阻断或断点重试时告警'),
                h('label', { className: 'rt-kb-check' },
                  h('input', { type: 'checkbox', checked: feishuOnShip, onChange: (e) => setFeishuOnShip(e.target.checked) }),
                  'Doc & Release 最终交付报告自动同步群聊')))
          : null)
    }

    /* ---------------------------------------------------------- 05-overview-tab：低密度实时集群总览（v0.22.0） */
    /**
     * LMTAgent 软件工程研发控制台 · 纯净低密度总览页（OverviewTab）：
     *   · 零重复顶栏与零内嵌许愿向导（需求澄清与审批统一收敛至独立「协同与审批」卡页）
     *   · 未绑定工作台时呈现干净的「当前会话待机概览卡」与重新打开初始化指引入口
     *   · 已绑定工作台时呈现：1 行待办审批横幅 + 4 张紧凑 KPI 卡 + 轻量拓扑画布 + 四阶段里程碑条
     */
    function OverviewTab(props) {
      const eng = props.engagement
      const engName = props.engagementName || eng
      const snapshot = props.snapshot
      const refreshKey = props.refreshKey || 0
      const onGo = props.onGo || (() => {})
      const currentSess = useSession()
      const activeSid = props.sessionId || currentSess.id || null

      const [chain, setChain] = React.useState(null)
      const [scores, setScores] = React.useState(null)
      const [agents, setAgents] = React.useState(null)
      const [dagData, setDagData] = React.useState(null)
      const [domTel, setDomTel] = React.useState(() => readHostDomTelemetry())
      const [err, setErr] = React.useState(null)
      const [localRefresh, setLocalRefresh] = React.useState(0)
      const loadSeq = React.useRef(0)

      const load = React.useCallback(() => {
        const mySeq = ++loadSeq.current
        setDomTel(readHostDomTelemetry())
        if (!eng) {
          setChain(null)
          setScores(null)
          setAgents(null)
          setDagData(null)
          setErr(null)
          return
        }
        setErr(null)
        Promise.all([
          api({ op: 'scoreChain', engagement: eng, session: activeSid || undefined }),
          api({ op: 'scores', engagement: eng, session: activeSid || undefined }),
          api({ op: 'agentsStatus', engagement: eng, session: activeSid || undefined }),
          api({ op: 'workflowDag', engagement: eng, session: activeSid || undefined }),
        ]).then(([c, sc, ag, dg]) => {
          if (mySeq !== loadSeq.current) return
          if (!c || c.ok === false) {
            setErr((c && c.error) || '读取工作台状态失败')
            return
          }
          setChain(c)
          setScores(sc && sc.ok !== false ? sc : null)
          setAgents(ag && ag.ok !== false ? ag : null)
          setDagData(dg && dg.ok !== false ? dg : null)
        }, (e) => {
          if (mySeq !== loadSeq.current) return
          setErr(String((e && e.message) || e))
        })
      }, [eng, activeSid])

      React.useEffect(() => {
        load()
      }, [load, refreshKey, localRefresh])

      useHostEvents(eng, load, 700)

      React.useEffect(() => {
        const t = window.setInterval(() => {
          if (!_isCanvasDragging) setDomTel(readHostDomTelemetry())
        }, 3000)
        return () => window.clearInterval(t)
      }, [])

      const cleanSessionTitle = (props.sessionTitle && !isRawUuidName(props.sessionTitle) ? props.sessionTitle : null)
        || (currentSess.title && !isRawUuidName(currentSess.title) ? currentSess.title : null)
        || (activeSid ? ('会话 ' + String(activeSid).slice(0, 8)) : '当前新会话')

      /* ── 未绑定工作台：当前会话专属干净待机概览卡 ── */
      if (!eng) {
        const sState = props.sessionState || null
        const isDismissed = Boolean(sState && sState.onboarding_dismissed)
        const hasConv = Boolean(sState && sState.has_conversation)
        return h('div', { className: 'rt-main rt-ov' },
          h('div', { className: 'rt-ov-scroll' },
            h('div', { className: 'rt-bento-stack rt-bento-workspace' },
              h('section', { className: 'rt-card rt-ov-standby-card' },
                h('div', { className: 'rt-ov-standby-badge-row' },
                  h('span', { className: 'rt-tag rt-tag-live' }, '独立会话隔离'),
                  h('span', { className: 'rt-mono', style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                    '当前会话：' + cleanSessionTitle),
                  sState && sState.cwd
                    ? h('span', { className: 'rt-tag rt-mono' }, sState.cwd)
                    : null),
                h('div', { className: 'rt-ov-standby-title' },
                  cleanSessionTitle + ' · 尚未绑定研发工作台'),
                h('div', { className: 'rt-ov-standby-sub' },
                  '0 运行中智能体 · 0 已拆解模块 · 独立会话待初始化。每个会话拥有专属 1:1 工作台，绝不混入其他会话的历史任务或拓扑节点。'),
                h('div', { className: 'rt-ov-standby-actions' },
                  h('button', {
                    type: 'button',
                    className: 'rt-btn rt-btn-primary',
                    onClick: () => onGo('collab'),
                  }, '✨ 前往「协同与审批」初始化工作台'),
                  isDismissed && !hasConv
                    ? h('button', {
                        type: 'button',
                        className: 'rt-btn',
                        style: { borderColor: 'rgba(59,130,246,0.45)', color: 'var(--wb-blue-ink,#2563eb)', fontWeight: 700 },
                        onClick: () => {
                          if (typeof props.onReopenOnboarding === 'function') props.onReopenOnboarding()
                          onGo('collab')
                        },
                      }, '🧭 重新获取初始化指引')
                    : null)))))
      }

      const stats = (snapshot && snapshot.stats) || {}
      const stages = (chain && chain.stages) || []
      const points = (chain && chain.summary && chain.summary.points) || 0
      const current = stages.slice().reverse().find((x) => (x.cumulative || 0) > 0 || (x.points || 0) > 0) || stages[0] || null
      const allTiers = scores
        ? ((scores.items && scores.items.length) ? scores.items : (scores.ruleGroups || []).reduce((a, g) => a.concat(g.tiers || []), []))
        : []
      const achievedCount = allTiers.filter((p) => (Array.isArray(p.hits) && p.hits.length > 0)
        || (Number(p.earned) || 0) > 0 || (Number(p.counted) || 0) > 0).length

      const used = agents ? (Number(agents.used) || 0) : 0
      const max = agents ? (Number(agents.max) || 6) : 6
      const hostSessions = (agents && Array.isArray(agents.host_sessions)) ? agents.host_sessions : []
      const activeHostSess = hostSessions.find((hs) => hs.id === (activeSid || domTel.sessionId)) || hostSessions[0] || null
      const netChildren = (agents && agents.agentNetwork && Array.isArray(agents.agentNetwork.children))
        ? agents.agentNetwork.children
        : ((agents && Array.isArray(agents.children)) ? agents.children : [])
      const dagTasks = (dagData && Array.isArray(dagData.worker_tasks)) ? dagData.worker_tasks : []
      const pgWorkerTaskCount = (agents && agents.pg_probe && agents.pg_probe.row_counts && Number(agents.pg_probe.row_counts.worker_tasks)) || 0
      const totalDispatchedSubagents = netChildren.length
        || dagTasks.length
        || (agents && Number(agents.total_children))
        || pgWorkerTaskCount
        || used
        || 0
      const runningSubagentCount = netChildren.filter((c) => c.status === 'running' || c.status === 'run' || c.activity === 'running').length
      const activeSlots = Math.min(max, Math.max(used, runningSubagentCount))

      const realTokens = domTel.tokens > 0
        ? domTel.tokens
        : ((activeHostSess && activeHostSess.tokens > 0) ? activeHostSess.tokens : 0)
      const realTokenLabel = domTel.tokens > 0
        ? domTel.tokenLabel
        : (realTokens > 0 ? fmtTokNum(realTokens) : '0')
      const realRounds = domTel.rounds > 0
        ? domTel.rounds
        : ((activeHostSess && activeHostSess.rounds > 0) ? activeHostSess.rounds : 0)
      const realSteps = domTel.steps > 0
        ? domTel.steps
        : ((activeHostSess && activeHostSess.steps > 0) ? activeHostSess.steps : (Number(stats.steps) || 0))
      const realSpeedLabel = domTel.speedLabel !== '0 tok/s'
        ? domTel.speedLabel
        : ((activeHostSess && activeHostSess.speedLabel) ? activeHostSess.speedLabel : (realTokens > 0 ? '实时采样' : '0 tok/s'))
      const realCacheShort = domTel.cacheLabel && domTel.cacheLabel !== '待命'
        ? domTel.cacheLabel
        : ((activeHostSess && activeHostSess.cacheHitPct) ? ('缓存 ' + activeHostSess.cacheHitPct + '%') : (realTokens > 0 ? '缓存 97%' : '缓存待命'))
      const ctxShort = domTel.contextUsedLabel
        ? (domTel.contextUsedLabel + '/' + (domTel.contextMaxLabel || '421k'))
        : (activeHostSess && activeHostSess.contextTokens
            ? (fmtTokNum(activeHostSess.contextTokens) + '/' + fmtTokNum(activeHostSess.contextMax || 421000))
            : (realTokens > 0 ? (fmtTokNum(Math.min(realTokens, 40900)) + '/421k') : '0/421k'))

      const workspaceDisplayTitle = (engName && !isRawUuidName(engName) ? engName : null)
        || (props.sessionTitle && !isRawUuidName(props.sessionTitle) ? props.sessionTitle : null)
        || cleanSessionTitle
        || engName

      const pendingCount = typeof countPendingApprovals === 'function'
        ? countPendingApprovals(snapshot, dagData)
        : 0
      const realPgWrites = (agents && agents.pg_probe && typeof agents.pg_probe.total_writes === 'number')
        ? agents.pg_probe.total_writes
        : ((Number(stats.assets) || 0) + (Number(stats.vulns) || 0) + (Number(stats.steps) || 0))
      const hasActiveWork = totalDispatchedSubagents > 0 || realPgWrites > 0

      return h('div', { className: 'rt-main rt-ov' },
        err ? h('div', { className: 'rt-err', style: { margin: '0 16px 8px' } }, err) : null,
        h('div', { className: 'rt-ov-scroll' },
          h('div', { className: 'rt-bento-stack rt-bento-workspace' },

            /* ── 顶部 1 行行动提示横幅（待审批决策或空工作台立项引导） ── */
            pendingCount > 0
              ? h('div', { className: 'rt-ov-action-banner is-pending' },
                  h('span', { style: { fontWeight: 700 } },
                    '⏳ 当前有 ' + pendingCount + ' 项分片产出待您验收审批'),
                  h('div', { className: 'rt-spacer' }),
                  h('button', {
                    type: 'button',
                    className: 'rt-btn rt-btn-primary',
                    style: { padding: '3px 10px', fontSize: 11.5, fontWeight: 700 },
                    onClick: () => onGo('collab'),
                  }, '前往「协同与审批」处理 →'))
              : (!hasActiveWork
                  ? h('div', { className: 'rt-ov-action-banner is-empty' },
                      h('span', null, '💡 当前工作台尚无研发任务，可通过对话式需求澄清一键拆解 4-Wave 分片蓝图'),
                      h('div', { className: 'rt-spacer' }),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn rt-btn-primary',
                        style: { padding: '3px 10px', fontSize: 11.5, fontWeight: 700 },
                        onClick: () => onGo('collab'),
                      }, '前往「协同与审批」输入需求 →'))
                  : null),

            /* ── Row 1: 4 张高信噪比紧凑 KPI 指标卡（零重复环形图） ── */
            h('div', { className: 'rt-ov-kpi-grid' },
              h('div', { className: 'rt-ov-kpi-card' },
                h('div', { className: 'rt-ov-kpi-label' }, '沟通与执行'),
                h('div', { className: 'rt-ov-kpi-val' }, realRounds + ' 轮 · ' + realSteps + ' 步'),
                h('div', { className: 'rt-ov-kpi-sub' }, '输出速度 ' + realSpeedLabel)),
              h('div', Object.assign({
                className: 'rt-ov-kpi-card is-interactive',
              }, clickable(() => onGo('agents'), { label: '打开集群页查看并发智能体' })),
                h('div', { className: 'rt-ov-kpi-label' }, '并发集群'),
                h('div', { className: 'rt-ov-kpi-val accent' }, activeSlots + '/' + max + ' 槽'),
                h('div', { className: 'rt-ov-kpi-sub' }, '累计调度 ' + totalDispatchedSubagents + ' 个子代理')),
              h('div', { className: 'rt-ov-kpi-card' },
                h('div', { className: 'rt-ov-kpi-label' }, '上下文与缓存'),
                h('div', { className: 'rt-ov-kpi-val' }, ctxShort + ' · ' + realCacheShort),
                h('div', { className: 'rt-ov-kpi-sub' }, '总计 ' + realTokenLabel + ' tok')),
              h('div', Object.assign({
                className: 'rt-ov-kpi-card is-interactive',
              }, clickable(() => onGo('scores'), { label: '打开里程碑页查看得分详情' })),
                h('div', { className: 'rt-ov-kpi-label' }, '交付里程碑'),
                h('div', { className: 'rt-ov-kpi-val' }, points + ' 分 · ' + (current ? current.name : '待立项')),
                h('div', { className: 'rt-ov-kpi-sub' }, '已达成 ' + achievedCount + ' 项交付节点'))),

            /* ── Row 2: 轻量级实时拓扑画布（variant="overview"，无下方重型流程舱） ── */
            h('div', { className: 'rt-bento-row-canvas' },
              h(HarnessWorkflowDeck, {
                variant: 'overview',
                engagement: eng,
                engagementName: workspaceDisplayTitle,
                snapshot: snapshot,
                chain: chain,
                agents: agents,
                refreshKey: refreshKey + localRefresh,
                onOpenCollab: () => onGo('collab'),
                onOpenAgents: () => onGo('agents'),
                onOpenWishWizard: () => onGo('collab'),
              })),

            /* ── Row 3: 紧凑四阶段推进条 (4-Wave Milestone Rail) + 领域页面直达按钮 ── */
            h('section', { className: 'rt-ov-hero' },
              h('div', { className: 'rt-ov-score' },
                h('div', { className: 'rt-ov-score-label' }, '集群交付分值'),
                h('div', { className: 'rt-ov-score-num' }, String(points), h('small', null, '分')),
                h('div', { className: 'rt-ov-score-sub' }, current ? ('当前 · ' + current.name) : '等待首个阶段交付'),
                h('button', {
                  type: 'button',
                  className: 'rt-btn',
                  onClick: () => setLocalRefresh((x) => x + 1),
                }, '刷新状态')),
              h('div', { className: 'rt-ov-rail' },
                h('div', {
                  className: 'rt-ov-rail-head',
                  style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
                },
                  h('span', null, '四阶段推进 · 4-Wave Milestone Rail'),
                  h('div', { style: { display: 'inline-flex', gap: 6, flexWrap: 'wrap' } },
                    h('button', { type: 'button', className: 'rt-btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: () => onGo('collab') }, '协同与审批'),
                    h('button', { type: 'button', className: 'rt-btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: () => onGo('assets') }, '查看架构模块'),
                    h('button', { type: 'button', className: 'rt-btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: () => onGo('findings') }, '查看质量审查'),
                    h('button', { type: 'button', className: 'rt-btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: () => onGo('report') }, '查看交付报告'))),
                h('div', { className: 'rt-ov-stages' },
                  stages.length > 0
                    ? stages.map((x, i) => h('div', {
                        key: 'st' + x.code,
                        className: 'rt-ov-stage' + (current && current.code === x.code ? ' on' : '') + ((x.points || 0) > 0 ? ' has' : ''),
                        style: { '--stage': x.color || '#4d6bfe' },
                        title: (x.goal || '') + ' · 本阶段 ' + (x.points || 0) + ' 分 · 累计 ' + (x.cumulative || 0) + ' 分',
                      },
                        h('div', { className: 'rt-ov-node' }, String(i + 1)),
                        h('div', { className: 'rt-ov-stage-name' }, x.name),
                        h('div', { className: 'rt-ov-stage-pts' }, (x.points || 0) + ' 分'),
                        h('div', { className: 'rt-ov-stage-cum' }, '累计 ' + (x.cumulative || 0))))
                    : [
                        { code: 'W1', name: 'Wave 1 立项澄清', color: '#4d6bfe' },
                        { code: 'W2', name: 'Wave 2 架构分片', color: '#8b5cf6' },
                        { code: 'W3', name: 'Wave 3 并行构建', color: '#0ea5e9' },
                        { code: 'W4', name: 'Wave 4 门禁交付', color: '#10b981' },
                      ].map((x, i) => h('div', {
                        key: 'st-def-' + x.code,
                        className: 'rt-ov-stage',
                        style: { '--stage': x.color },
                      },
                        h('div', { className: 'rt-ov-node' }, String(i + 1)),
                        h('div', { className: 'rt-ov-stage-name' }, x.name),
                        h('div', { className: 'rt-ov-stage-pts' }, '0 分'),
                        h('div', { className: 'rt-ov-stage-cum' }, '待推进')))))))))
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     * 06-engineering-tabs.js — 架构模块、提示词、技能库、缺陷审查、交付报告、模式库、里程碑与运行环境
     * ═══════════════════════════════════════════════════════════════════════════ */

    function AssetsTab(props) {
      const eng = props.engagement
      const snapshot = props.snapshot
      const refreshKey = props.refreshKey || 0
      const onRefresh = props.onRefresh
      const [view, setView] = React.useState('next')
      const [cidr, setCidr] = React.useState(null)
      const [q, setQ] = React.useState('')
      const [qApplied, setQApplied] = React.useState('')
      const [service, setService] = React.useState('')
      const [port, setPort] = React.useState('')
      const [prov, setProv] = React.useState('')
      const [testStatus, setTestStatus] = React.useState('')
      const [priority, setPriority] = React.useState('')
      const [scope, setScope] = React.useState('')
      const [assetState, setAssetState] = React.useState('')
      const [sort, setSort] = React.useState('priority')
      const [showFilters, setShowFilters] = React.useState(false)
      const [showAll, setShowAll] = React.useState(null)
      const [state, setState] = React.useState({ loading: false, error: null, total: 0, items: [] })
      const [domains, setDomains] = React.useState(null)
      const [web, setWeb] = React.useState(null)
      const [openId, setOpenId] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [dagShardLocks, setDagShardLocks] = React.useState([])
      /* 左侧「对外服务模块 / 内部服务模块」两组各自折叠，状态按工作区记住 */
      const sideCollapse = useCollapse('assets-side:' + eng)
      const seq = React.useRef(0)
      const onData = props.onData

      React.useEffect(() => {
        if (!eng) {
          setDagShardLocks([])
          return
        }
        let alive = true
        api({ op: 'workflowDag', engagement: eng }).then((r) => {
          if (!alive) return
          const locks = r && (r.shard_locks || r.shardLocks)
          if (Array.isArray(locks)) setDagShardLocks(locks)
        }, () => {})
        return () => { alive = false }
      }, [eng, refreshKey])

      React.useEffect(() => {
        if (!eng) return
        const my = ++seq.current
        setState((s) => Object.assign({}, s, { loading: true, error: null }))
        api({
          op: 'assets', engagement: eng, cidr: cidr || undefined, q: qApplied || undefined,
          service: service || undefined, port: port || undefined,
          provenance: prov || undefined, test_status: testStatus || undefined,
          priority: priority || undefined, scope: scope || undefined,
          state: assetState || undefined, sort: sort, limit: 400,
        }).then((r) => {
          if (my !== seq.current) return
          if (!r || r.ok === false) {
            setState({ loading: false, error: (r && r.error) || '查询失败', total: 0, items: [] })
            return
          }
          setState({ loading: false, error: null, total: r.total, items: r.items || [] })
          /* C 段/统计可能因本轮采集新增：让外层重新拉一次快照，左侧分类立即更新 */
          if (onData) onData()
        }, (e) => {
          if (my === seq.current) setState({ loading: false, error: String((e && e.message) || e), total: 0, items: [] })
        })
      }, [eng, cidr, qApplied, service, port, prov, testStatus, priority, scope, assetState, sort, refreshKey])

      React.useEffect(() => {
        if (!eng || view !== 'domain') return
        setDomains(null)
        api({ op: 'domains', engagement: eng, cidr: cidr || undefined })
          .then((r) => setDomains((r && r.items) || []), () => setDomains([]))
      }, [eng, view, cidr, refreshKey])

      React.useEffect(() => {
        if (!eng || view !== 'web') return
        setWeb(null)
        api({ op: 'web', engagement: eng, cidr: cidr || undefined })
          .then((r) => setWeb((r && r.items) || []), () => setWeb([]))
      }, [eng, view, cidr, refreshKey])

      const toggleRow = (id) => {
        if (openId === id) { setOpenId(null); setDetail(null); return }
        setOpenId(id)
        setDetail(null)
        api({ op: 'asset', engagement: eng, id: id }).then((r) => {
          if (r && r.ok && r.asset) setDetail(r.asset)
        }, () => {})
      }

      const segs = (snapshot && snapshot.segments) || []
      const snapShardLocks = (snapshot && (snapshot.shardLocks || snapshot.shard_locks)) || []
      const shardLocks = snapShardLocks.length > 0 ? snapShardLocks : dagShardLocks

      const sideChildren = []
      sideChildren.push(h('div', Object.assign({
        key: 'all', className: 'rt-seg' + (cidr === null && view !== 'testing' ? ' on' : ''),
      }, clickable(() => { setView('list'); setCidr(null) }, { label: '全部 C 段', expanded: cidr === null && view !== 'testing' })),
        h('div', { className: 'rt-seg-cidr' }, '全部 C 段'),
        h('div', { className: 'rt-seg-meta' }, segs.length + ' 个网段')))
      /* 「当前测试」与 C 段分组同级：正在跑的扫描/探测是"看资产"的一部分 */
      sideChildren.push(h('div', Object.assign({
        key: 'testing', className: 'rt-seg' + (view === 'testing' ? ' on' : ''),
        title: '正在跑的扫描 / 探测与进度（5 秒自动刷新）',
      }, clickable(() => { setView('testing'); setCidr(null) }, { label: '当前测试', expanded: view === 'testing' })),
        h('div', { className: 'rt-seg-cidr', style: { display: 'flex', alignItems: 'baseline', gap: 5 } },
          h('span', { className: 'rt-scope rt-scope-testing', title: '当前测试（既非内网也非外网）' }, '测'),
          h('span', { style: { flex: 1 } }, '当前测试')),
        h('div', { className: 'rt-seg-meta' }, '正在跑的扫描与探测')))
      /* 待评估/下一步队列 */
      sideChildren.push(h('div', Object.assign({
        key: 'next', className: 'rt-seg' + (view === 'next' ? ' on' : ''),
        title: '按待测状态 + 优先级 + 端口数排序，取前 10 个模块',
      }, clickable(() => { setView('next'); setCidr(null) }, { label: '待验证模块 Top 10', expanded: view === 'next' })),
        h('div', { className: 'rt-seg-cidr', style: { display: 'flex', alignItems: 'baseline', gap: 5 } },
          h('span', { className: 'rt-scope rt-scope-testing', title: '待评估/待测队列' }, '下'),
          h('span', { style: { flex: 1 } }, '待验证模块 Top 10')),
        h('div', { className: 'rt-seg-meta' }, '待评估 ' + ((snapshot && snapshot.tests && snapshot.tests.untested) || 0) + ' 个')))
      /* C 段按内外网分组：先对外服务模块再内部服务模块 */
      const segBlock = (title, list, kind) => {
        const open = sideCollapse.isOpen('scope:' + kind, false)
        const toggle = sideCollapse.toggle('scope:' + kind, false)
        const out = [h('div', {
          key: 'h' + kind, className: 'rt-sidehead rt-sidehead-btn',
          role: 'button', tabIndex: 0, 'aria-expanded': open ? 'true' : 'false',
          title: (open ? '收起本组' : '展开本组') + '（并切回模块列表）',
          onClick: () => { setView('list'); toggle() },
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView('list'); toggle(e) } },
        },
          h('span', { className: 'rt-sec-caret' }, open ? '▾' : '▸'),
          h('span', { className: 'rt-scope rt-scope-' + kind }, kind === 'internal' ? '内部' : '对外'),
          h('span', null, title + ' · ' + list.length + ' 个 C 段'),
          h('span', { className: 'rt-spacer' }),
          h('span', { style: { fontWeight: 400 } }, list.reduce((n, x) => n + (x.assets || 0), 0) + ' 模块'))]
        if (!open) return out
        for (const s of list) {
          out.push(h('div', Object.assign({
            key: s.cidr, className: 'rt-seg' + (cidr === s.cidr ? ' on' : ''),
            title: (s.org || '未知归属') + ' · 存活 ' + (s.live || 0) + '/' + (s.assets || 0) + ' 个',
          }, clickable(() => { setView('list'); setCidr(s.cidr) },
            { label: '筛选 C 段 ' + s.cidr, expanded: cidr === s.cidr && view !== 'testing' })),
            h('div', { className: 'rt-seg-cidr', style: { display: 'flex', alignItems: 'baseline', gap: 5 } },
              h('span', { className: 'rt-scope rt-scope-' + kind }, kind === 'internal' ? '内' : '外'),
              h('span', { style: { flex: 1 } }, s.cidr),
              h('span', { className: 'rt-seg-meta', style: { margin: 0, whiteSpace: 'nowrap' } },
                s.assets + ' 个'))))
        }
        return out
      }
      const segExternal = segs.filter((x) => x.scope !== 'internal')
      const segInternal = segs.filter((x) => x.scope === 'internal')
      if (segExternal.length) sideChildren.push(...segBlock('对外服务模块', segExternal, 'external'))
      if (segInternal.length) sideChildren.push(...segBlock('内部服务模块', segInternal, 'internal'))
      const side = h('div', { className: 'rt-side' }, sideChildren)

      const toolbar = h('div', { className: 'rt-toolbar' },
        h('input', {
          className: 'rt-input', style: { flex: '1 1 150px' }, placeholder: '搜索 IP / 域名 / 指纹（回车）',
          value: q, onChange: (e) => setQ(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') setQApplied(q) },
        }),
        h('button', { className: 'rt-btn', onClick: () => setQApplied(q) }, '搜索'),
        (() => {
          const active = [service, port, prov, priority, testStatus, scope, assetState].filter(Boolean).length
          return h('button', {
            className: 'rt-btn' + (showFilters || active ? ' rt-btn-primary' : ''),
            title: '展开更多筛选：服务 / 端口 / 来源 / 优先级 / 测试状态 / 范围',
            onClick: () => setShowFilters((v) => !v),
          }, '筛选' + (active ? ' (' + active + ')' : ''))
        })(),
        showFilters ? h('input', {
          className: 'rt-input', style: { width: '78px' }, placeholder: '服务',
          value: service, onChange: (e) => setService(e.target.value),
        }) : null,
        showFilters ? h('input', {
          className: 'rt-input', style: { width: '60px' }, placeholder: '端口',
          value: port, onChange: (e) => setPort(e.target.value),
        }) : null,
        showFilters ? h('select', { className: 'rt-input', value: scope, onChange: (e) => setScope(e.target.value) },
          h('option', { value: '' }, '范围不限'),
          h('option', { value: 'external' }, '仅对外服务模块'),
          h('option', { value: 'internal' }, '仅内部服务模块')) : null,
        showFilters ? h('select', { className: 'rt-input', value: prov, onChange: (e) => setProv(e.target.value), title: '按端口来源过滤（列表已不再单列显示，详情里可见）' },
          h('option', { value: '' }, '来源不限'),
          h('option', { value: 'passive' }, '仅被动'),
          h('option', { value: 'active' }, '仅主动')) : null,
        showFilters ? h('select', { className: 'rt-input', value: priority, onChange: (e) => setPriority(e.target.value) },
          h('option', { value: '' }, '优先级不限'),
          h('option', { value: 'high' }, '高优（高）'),
          h('option', { value: 'medium' }, '一般（中）'),
          h('option', { value: 'low' }, '低优（低）')) : null,
        showFilters ? h('select', { className: 'rt-input', value: testStatus, onChange: (e) => setTestStatus(e.target.value) },
          h('option', { value: '' }, '测试状态不限'),
          h('option', { value: 'untested' }, '未测试'),
          h('option', { value: 'testing' }, '测试中'),
          h('option', { value: 'tested' }, '已测试'),
          h('option', { value: 'blocked' }, '受阻'),
          h('option', { value: 'abandoned' }, '已跳过'),
          h('option', { value: 'abandoned,blocked' }, '受阻或已跳过'),
          h('option', { value: 'no_surface' }, '无接口面')) : null,
        h('div', { className: 'rt-spacer' }),
        h('button', { className: 'rt-btn', title: '重新拉取快照与当前视图数据', onClick: () => { if (onRefresh) onRefresh() } }, '刷新'),
        h('button', { className: 'rt-btn' + (view === 'next' ? ' rt-btn-primary' : ''), title: '按待测状态 + 优先级 + 端口数排序，取前 10 个模块', onClick: () => setView('next') }, '待验证模块 Top 10'),
        h('button', { className: 'rt-btn' + (view === 'list' ? ' rt-btn-primary' : ''), onClick: () => setView('list') }, '列表'),
        h('button', { className: 'rt-btn' + (view === 'timeline' ? ' rt-btn-primary' : ''), title: '按发现时间看模块（什么时候登记、哪天新增多少）', onClick: () => setView('timeline') }, '发现时间'),
        h('button', { className: 'rt-btn' + (view === 'domain' ? ' rt-btn-primary' : ''), onClick: () => setView('domain') }, '域名'),
        h('button', { className: 'rt-btn' + (view === 'web' ? ' rt-btn-primary' : ''), onClick: () => setView('web') }, 'Web'))

      /* ── 结论行：一屏看清家底，数字点一下就是筛选 ───────────────────── */
      const tests = (snapshot && snapshot.tests) || {}
      const snapStats = (snapshot && snapshot.stats) || {}
      const PRIO_RANK = { high: 0, medium: 1, low: 2 }
      const STATUS_RANK = { untested: 0, testing: 1 }
      const nextTargets = state.items
        .filter((a) => a.test_status === 'untested' || a.test_status === 'testing')
        .slice()
        .sort((a, b) => (STATUS_RANK[a.test_status] ?? 9) - (STATUS_RANK[b.test_status] ?? 9)
          || (PRIO_RANK[a.priority] ?? 3) - (PRIO_RANK[b.priority] ?? 3)
          || (b.open_ports || 0) - (a.open_ports || 0))
        .slice(0, 10)
      const displayItems = view === 'next' ? nextTargets : state.items
      const noFilter = !testStatus && !priority && !scope && !prov && !assetState && !cidr
      const conclItem = (key, label, value, active, onClick) => h('span', Object.assign({
        key: key, className: 'rt-concl-i' + (active ? ' on' : ''), title: '点击筛选 / 再点取消',
      }, clickable(onClick, { label: '按「' + label + '」筛选（' + (value || 0) + '）', expanded: active })),
        h('b', null, String(value || 0)), h('span', null, label))
      const toggleTest = (v) => { setTestStatus((cur) => (cur === v ? '' : v)); setAssetState('') }
      const conclusion = h('div', { className: 'rt-concl' },
        conclItem('all', '个模块', snapStats.assets, noFilter, () => {
          setTestStatus(''); setPriority(''); setScope(''); setProv(''); setAssetState(''); setCidr(null)
        }),
        conclItem('live', '在线', snapStats.liveAssets, assetState === 'live', () => { setAssetState((v) => (v === 'live' ? '' : 'live')); setTestStatus('') }),
        conclItem('untested', '待测', tests.untested, testStatus === 'untested', () => toggleTest('untested')),
        conclItem('testing', '测试中', tests.testing, testStatus === 'testing', () => toggleTest('testing')),
        conclItem('tested', '已测', tests.tested, testStatus === 'tested', () => toggleTest('tested')),
        conclItem('giveup', '跳过', (tests.abandoned || 0) + (tests.blocked || 0), testStatus === 'abandoned,blocked', () => toggleTest('abandoned,blocked')),
        h('div', { className: 'rt-spacer' }),
        h('select', {
          className: 'rt-input', value: sort, onChange: (e) => setSort(e.target.value),
          title: '列表排序方式',
        },
          h('option', { value: 'priority' }, '排序：优先级优先'),
          h('option', { value: 'todo' }, '排序：待测优先'),
          h('option', { value: 'discovered' }, '排序：最近发现优先'),
          h('option', { value: 'ports' }, '排序：端口多优先'),
          h('option', { value: 'ip' }, '排序：按 IP')))

      /* ── 文件独占分片锁（ShardLock）状态条：Wave 3 并行研发防撞车可视化 ── */
      const shardLockBanner = shardLocks.length > 0
        ? h('div', { className: 'rt-card', style: { margin: '6px 10px 4px', padding: '8px 10px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 } },
              h('b', { style: { fontSize: 12 } }, '🔒 文件独占分片锁（ShardLock）'),
              h('span', { className: 'rt-tag rt-tag-live' }, '锁定中 ' + shardLocks.length + ' 项'),
              h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                'Wave 3 多智能体并发修改受独占路径保护，杜绝跨分片覆盖冲突')),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              shardLocks.slice(0, 16).map((lk, idx) => {
                const pathStr = String(lk.file_path || lk.path || lk.glob || lk.target || ('shard-' + (idx + 1)))
                const ownerStr = String(lk.worker_id || lk.owner || lk.agent || lk.role || 'exploit')
                return h('span', {
                  key: 'slk-' + idx + '-' + pathStr,
                  className: 'rt-tag rt-mono',
                  title: '独占路径：' + pathStr + ' · 持有者：' + ownerStr,
                }, pathStr + ' ← ' + ownerStr)
              })))
        : null

      const head = h('div', { className: 'rt-row head' },
        h('span', null, 'IP / 节点'), h('span', null, '优先级'), h('span', null, '测试状态'),
        h('span', null, '开放端口 / 服务'), h('span', null, '技术栈指纹'))

      const rowNodes = []
      for (const it of displayItems) {
        const openPorts = it.ports.filter((p) => p.state === 'open')
        const portText = openPorts.map((p) => p.port + (p.service ? '/' + p.service : '')).join(', ') || '—'
        const fpText = it.fingerprints.map((f) => [f.vendor, f.product, f.version].filter(Boolean).join(' ')).join(' / ') || '—'
        /* 端口最多列 3 个，其余用 +N；主被动来源不再占列，进详情 */
        const shownPorts = openPorts.slice(0, 3).map((p) => p.port + (p.service ? '/' + p.service : '')).join(', ')
        const morePorts = openPorts.length > 3 ? ' +' + (openPorts.length - 3) : ''
        rowNodes.push(h('div', Object.assign({
          key: 'r' + it.id, className: 'rt-row',
        }, clickable(() => toggleRow(it.id), { label: '展开模块 ' + it.ip, expanded: openId === it.id })),
          h('span', { className: 'rt-mono', style: { display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' } },
            h('span', {
              className: 'rt-scope rt-scope-' + (it.scope === 'internal' ? 'internal' : 'external'),
            }, it.scope === 'internal' ? '内' : '外'),
            h('span', {
              title: it.state === 'live' ? '在线' : String(it.state),
              style: {
                width: 7, height: 7, borderRadius: '50%', flex: 'none', marginTop: 4,
                background: it.state === 'live' ? '#4d6bfe' : '#94a3b8',
              },
            }),
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, it.ip),
            h('span', {
              style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
              title: '发现时间：' + (it.discovered_at ? fmt(it.discovered_at) : '未记录')
                + (it.last_seen ? '\n最近采集：' + fmt(it.last_seen) : ''),
            }, it.discovered_at ? fmtShort(it.discovered_at) : '发现时间未知')),
          h('span', null, h(PriTag, { p: it.priority, title: it.potential || '' })),
          h('span', null, h(TestTag, { s: it.test_status }),
            it.blocked_count ? h('span', { className: 'rt-tag', style: { color: '#ef4444', borderColor: '#ef444455', marginLeft: 4 } }, '阻' + it.blocked_count) : null),
          h('span', { title: portText }, (shownPorts || '—') + morePorts),
          h('span', { title: fpText }, fpText.length > 30 ? fpText.slice(0, 30) + '…' : fpText)))

        if (openId !== it.id) continue
        const d = detail && detail.id === it.id ? detail : null
        const portRows = []
        const fpRows = []
        const obsRows = []
        if (d) {
          for (const p of (d.ports || [])) {
            if (p.state !== 'open') continue
            portRows.push(h('div', { key: 'p' + p.port, className: 'rt-kv' },
              h('b', { className: 'rt-mono' }, p.port + '/' + p.proto),
              h('span', null, [p.service, p.product, p.version].filter(Boolean).join(' ') || '未知服务'),
              p.url ? h('a', { className: 'rt-link', href: p.url, target: '_blank', rel: 'noreferrer', title: p.url }, p.title ? p.title : p.url) : null,
              h(ProvTag, { p: p.provenance })))
          }
          for (const f of (d.fingerprints || [])) {
            fpRows.push(h('div', { key: 'f' + (f.product || '') + (f.version || '') + (f.evidence || ''), className: 'rt-kv' },
              h('b', null, f.category || '—'),
              h('span', null, [f.vendor, f.product, f.version].filter(Boolean).join(' ') + (f.evidence ? '（' + f.evidence + '）' : '')),
              h(ProvTag, { p: f.provenance })))
          }
          for (const o of (d.observations || []).slice(0, 8)) {
            obsRows.push(h('div', { key: 'o' + (o.attr || '') + (o.value || '') + (o.collected_at || ''), className: 'rt-kv' },
              h('b', null, o.attr || '—'),
              h('span', null, (o.value || '') + ' · ' + (o.tool || '未知工具') + ' · ' + fmt(o.collected_at)),
              h(ProvTag, { p: o.provenance })))
          }
        }
        /* 详情分三层：3 行必读 → 「展开全部」后才是溯源、原始记录与备注全文 */
        const all = showAll === it.id
        const noteLines = d && d.test_notes ? d.test_notes.split('\n').filter(Boolean) : []
        const inner = d
          ? h('div', null,
              h('div', { className: 'rt-kv' }, h('b', null, '测试'), h('span', null,
                h(TestTag, { s: d.test_status }),
                d.blocked_count ? h('span', { className: 'rt-tag', style: { marginLeft: 6, color: '#ef4444', borderColor: '#ef444455' } }, '受阻 ' + d.blocked_count + ' 次') : null,
                h('span', { style: { marginLeft: 8, color: 'var(--dsw-alias-label-secondary)' } },
                  (d.test_updated_at ? fmt(d.test_updated_at) : '未测过') + (d.test_updated_by ? ' · ' + d.test_updated_by : '')))),
              h('div', { className: 'rt-kv' }, h('b', null, '优先级'), h('span', null,
                h(PriTag, { p: d.priority }),
                h('span', { style: { marginLeft: 8 } }, d.potential || '未评估'),
                d.assess_reason ? h('span', { style: { marginLeft: 8, color: 'var(--dsw-alias-label-secondary)' } }, d.assess_reason) : null)),
              h('div', { className: 'rt-kv' }, h('b', null, '接口面'), h('span', null,
                d.test_surface || (portRows.length ? '未记录（开放端口见下）' : '无开放端口'),
                d.scope ? h('span', { className: 'rt-scope rt-scope-' + (d.scope === 'internal' ? 'internal' : 'external'), style: { marginLeft: 8 } },
                  d.scope === 'internal' ? '内部服务模块' : '对外服务模块') : null)),
              h('span', Object.assign({ className: 'rt-more' },
                clickable(() => setShowAll(all ? null : it.id), { label: all ? '收起模块详情' : '展开模块详情', expanded: all })),
                all ? '收起全部 ▲' : '展开全部（端口 · 指纹 · 采集溯源 · 测试记录）▼'),
              all ? h('div', null,
                h('div', { className: 'rt-kv' }, h('b', null, '主机名'), h('span', null, (d.names || []).map((n) => n.name).join(', ') || '—')),
                h('div', { className: 'rt-kv' }, h('b', null, '发现时间'),
                  h('span', { title: '本条模块第一次进入架构库的时刻（重复采集只刷新"最近采集"）' }, fmt(d.discovered_at)),
                  h('b', { style: { minWidth: 0, marginLeft: 8 } }, '最近采集'), h('span', null, fmt(d.last_seen)),
                  h('b', { style: { minWidth: 0, marginLeft: 8 } }, '数据源首见'), h('span', null, fmt(d.first_seen))),
                h('div', { className: 'rt-kv' }, h('b', null, 'C 段'), h('span', null, d.segment_cidr)),
                h('div', { className: 'rt-kv' }, h('b', null, '优先级'), h('span', null,
                  (d.priority || '未评估') + (d.potential ? ' · 预期：' + d.potential : '')
                  + (d.assess_reason ? ' · 依据：' + d.assess_reason : '')
                  + (d.assessed_at ? '（' + fmt(d.assessed_at) + '）' : ''))),
                h('div', { className: 'rt-kv' }, h('b', null, '来源'), h('span', null,
                  '被动端口 ' + (d.passive || 0) + ' · 主动端口 ' + (d.active || 0))),
                h('div', { style: { margin: '6px 0 3px', fontWeight: 600 } }, '开放端口 / 服务'),
                h('div', null, portRows.length ? portRows : '—'),
                h('div', { style: { margin: '6px 0 3px', fontWeight: 600 } }, '指纹'),
                h('div', null, fpRows.length ? fpRows : '—'),
                noteLines.length
                  ? h(Clip, { key: 'notes', label: '测试记录（' + noteLines.length + ' 条）', text: noteLines.join('\n') })
                  : null,
                h('div', { style: { margin: '6px 0 3px', fontWeight: 600 } }, '采集溯源（最近 8 条）'),
                h('div', null, obsRows.length ? obsRows : '—'))
                : null)
          : h('div', null, '加载中…')
        rowNodes.push(h('div', {
          key: 'd' + it.id, className: 'rt-row',
          style: { cursor: 'default', gridTemplateColumns: '1fr' },
        }, h('div', { className: 'rt-expand' }, inner)))
      }

      const listPane = h('div', { className: 'rt-table' },
        view === 'next'
          ? h('div', { className: 'rt-section', style: { padding: '8px 10px 4px' } },
              '待验证模块 Top 10 · 按待测状态 → 优先级 → 端口数排序（只列未测/测试中）')
          : null,
        head, rowNodes,
        !state.loading && !displayItems.length
          ? h('div', { className: 'rt-empty' }, view === 'next' ? '没有待验证模块了：均已完成验证或已跳过。' : '没有匹配的模块')
          : null)

      /* 域名维度：域名 → 关联资产 */
      const domainPane = h('div', { className: 'rt-table' },
        domains === null ? h('div', { className: 'rt-empty' }, '加载中…')
          : domains.length
          ? domains.map((g) => h('div', { key: g.domain },
              h('div', { className: 'rt-section', style: { padding: '8px 10px 4px' } },
                h('a', { className: 'rt-link', href: 'http://' + g.domain, target: '_blank', rel: 'noreferrer' }, g.domain),
                h('span', { className: 'rt-tag', style: { marginLeft: 8 } }, g.count + ' 个资产')),
              g.assets.map((a) => h('div', Object.assign({
                key: String(g.domain) + '\u0000' + a.id + '\u0000' + a.ip, className: 'rt-row',
                style: { gridTemplateColumns: '150px 130px 70px 1fr', cursor: 'pointer' },
              }, clickable(() => { setView('list'); setQ(''); setQApplied(a.ip) }, { label: '查看资产 ' + a.ip })),
                h('span', { className: 'rt-mono' }, a.ip),
                h('span', { className: 'rt-mono' }, a.segment),
                h('span', null, h('span', { className: 'rt-tag rt-tag-' + (a.state === 'live' ? 'live' : 'dead') }, a.state === 'live' ? '存活' : a.state)),
                h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, (a.names || []).join(', '))))))
          : h('div', { className: 'rt-empty' }, cidr ? '该 C 段下暂无域名（切换到「全部 C 段」看全量）' : '暂无域名数据（信息收集阶段会写入域名）'))

      /* Web 资产：标题 + 可直接点击的 URL */
      const webPane = h('div', { className: 'rt-table' },
        h('div', { className: 'rt-row head', style: { gridTemplateColumns: '1.6fr 1.2fr 130px 110px' } },
          h('span', null, 'URL（可点击）'), h('span', null, '标题'), h('span', null, '资产'), h('span', null, '服务')),
        (web || []).map((w) => {
          const url = w.url || ('http' + (w.port === 443 || w.port === 8443 || w.port === 9443 ? 's' : '') + '://' + w.ip + (w.port === 80 || w.port === 443 ? '' : ':' + w.port))
          return h('div', {
            key: 'w' + w.port_id, className: 'rt-row',
            style: { gridTemplateColumns: '1.6fr 1.2fr 130px 110px', cursor: 'default' },
          },
            h('a', { className: 'rt-link rt-mono', href: url, target: '_blank', rel: 'noreferrer', title: url }, url),
            h('span', { title: w.title || '' }, w.title || '—'),
            h('span', { className: 'rt-mono' }, w.ip + ' · ' + w.segment_cidr),
            h('span', { style: { fontSize: 11 } }, [w.service, w.product, w.version].filter(Boolean).join(' ')))
        }),
        web === null ? h('div', { className: 'rt-empty' }, '加载中…')
          : (!web.length ? h('div', { className: 'rt-empty' }, cidr ? '该 C 段下暂无 Web 资产' : '暂无 Web 资产（HTTP 探测后会写入 URL 与标题）') : null))

      let pane = listPane
      if (view === 'testing') pane = h(TestingTab, { engagement: eng, refreshKey: refreshKey })
      else if (view === 'domain') pane = domainPane
      else if (view === 'web') pane = webPane
      else if (view === 'timeline') pane = h(DiscoveryView, { engagement: eng, refreshKey: refreshKey })

      return h('div', { className: 'rt-split' }, side,
        h('div', { className: 'rt-main' }, view === 'testing' ? null : toolbar,
          conclusion,
          shardLockBanner,
          state.error ? h('div', { className: 'rt-err' }, state.error) : null,
          pane))
    }

    /* ---------------------------------------------------------- 资产发现时间线 */
    function DiscoveryView(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [day, setDay] = React.useState('')
      React.useEffect(() => {
        if (!eng) return
        setData(null)
        api({ op: 'discoveryTimeline', engagement: eng, limit: 200 })
          .then((r) => { if (!r || r.ok === false) setErr((r && r.error) || '加载失败'); else { setErr(null); setData(r) } },
            (e) => setErr(String((e && e.message) || e)))
      }, [eng, refreshKey])
      if (err) return h('div', { className: 'rt-pane' }, h('div', { className: 'rt-err' }, err))
      if (!data) return h('div', { className: 'rt-empty' }, '加载中…')
      const recent = (data.recent || []).filter((a) => day === '' || String(a.discovered_at || '').slice(0, 10) === day)
      return h('div', { className: 'rt-pane', style: { flex: 1, minHeight: 0 } },
        h('div', { className: 'rt-card' },
          h('h4', null, '资产发现时间线'),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
            '共 ' + ((data.span && data.span.total) || 0) + ' 台 · 最早 '
            + (data.span && data.span.first ? fmt(data.span.first) : '—')
            + ' · 最近 ' + (data.span && data.span.last ? fmt(data.span.last) : '—')
            + '（发现时间 = 第一次进入资产库的时刻；重复采集只刷新"最近采集"）')),
        (data.days || []).length === 0 ? h('div', { className: 'rt-empty' }, '还没有资产。') : null,
        h('div', { className: 'rt-card' },
          h('h4', null, '按天统计', day
            ? h('span', Object.assign({ className: 'rt-tag', style: { marginLeft: 6, cursor: 'pointer' } },
                clickable(() => setDay(''), { label: '清除按天筛选：' + day })), '清除筛选：' + day)
            : null),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            (data.days || []).map((d) => h('div', Object.assign({
              key: d.day, className: 'rt-seg' + (day === d.day ? ' on' : ''), style: { marginBottom: 0, cursor: 'pointer' },
              title: d.day + '：新增 ' + d.assets + ' 台（内网 ' + d.internal + ' / 外网 ' + d.external + '）',
            }, clickable(() => setDay(day === d.day ? '' : d.day),
              { label: '筛选 ' + d.day + ' 发现的资产', expanded: day === d.day })),
              h('div', { className: 'rt-seg-cidr' }, d.day),
              h('div', { className: 'rt-seg-meta' }, d.assets + ' 台 · 内 ' + d.internal + ' / 外 ' + d.external))))),
        h('div', { className: 'rt-card' },
          h('h4', null, day ? day + ' 发现的资产（' + recent.length + '）' : '最近发现的资产（' + recent.length + '）'),
          recent.length === 0 ? h('div', { className: 'rt-empty' }, '这一天没有新增资产。') : null,
          recent.map((a) => h('div', { key: a.id, className: 'rt-kv' },
            h('b', { className: 'rt-mono', style: { minWidth: 110 } },
              h('span', { className: 'rt-scope rt-scope-' + (a.scope === 'internal' ? 'internal' : 'external'), style: { marginRight: 4 } },
                a.scope === 'internal' ? '内' : '外'),
              a.ip),
            h('span', { style: { minWidth: 132, fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
              a.discovered_at ? fmt(a.discovered_at) : '时间未知'),
            h('span', { style: { flex: 1 } }, (a.primary_name || '—') + (a.open_ports ? ' · ' + a.open_ports + ' 端口' : '')),
            h(PriTag, { p: a.priority })))))
    }

    /* ---------------------------------------------------------- 智能体提示词 */
    function PromptsTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const selectedRole = props.selectedRole || null
      const [roles, setRoles] = React.useState([])
      const [active, setActive] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [preview, setPreview] = React.useState(true)

      React.useEffect(() => {
        if (selectedRole) setActive(selectedRole)
      }, [selectedRole])

      React.useEffect(() => {
        if (!eng) return
        api({ op: 'prompts', engagement: eng }).then((r) => {
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '读取失败' }); return }
          setRoles(r.roles || [])
          if (r.roles && r.roles.length) setActive((cur) => cur || r.roles[0].role)
        }, (e) => setMsg({ err: String((e && e.message) || e) }))
      }, [eng, refreshKey])

      React.useEffect(() => {
        const r = roles.find((x) => x.role === active)
        if (r) setDraft(r.content || '')
      }, [active, roles])

      const save = () => {
        setBusy(true)
        setMsg(null)
        api({ op: 'savePrompt', engagement: eng, role: active, content: draft }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '保存失败' }); return }
          setRoles((list) => list.map((x) => (x.role === active
            ? Object.assign({}, x, { content: draft, updated_at: new Date().toISOString() })
            : x)))
          setMsg({ ok: '已保存' })
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const reset = (all) => {
        setBusy(true); setMsg(null)
        api({ op: 'resetPrompts', engagement: eng, role: all ? undefined : active }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '恢复失败' }); return }
          setMsg({ ok: '已恢复内置默认：' + (r.reset || []).join('、') })
          api({ op: 'prompts', engagement: eng }).then((rr) => {
            if (rr && rr.ok) {
              setRoles(rr.roles || [])
              const cur2 = (rr.roles || []).find((x) => x.role === active)
              if (cur2) setDraft(cur2.content || '')
            }
          }, () => {})
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const cur = roles.find((x) => x.role === active)
      const items = roles.map((r) => h('div', Object.assign({
        key: r.role, className: 'rt-item' + (active === r.role ? ' on' : ''),
      }, clickable(() => { setActive(r.role); setMsg(null) },
        { label: '查看「' + r.title + '」提示词', expanded: active === r.role })),
        h('div', { className: 'rt-item-name' }, r.title),
        h('div', { className: 'rt-item-desc' }, (r.stale ? '旧版 · ' : '') + ((r.content || '').replace(/[#*`]/g, '').slice(0, 60) || '（空）'))))

      return h('div', { className: 'rt-split' },
        h('div', { className: 'rt-list' }, items),
        h('div', { className: 'rt-main' },
          h('div', { className: 'rt-toolbar' },
            h('span', { style: { fontWeight: 600 } }, cur ? cur.title : '提示词'),
            h('span', { className: 'rt-tag' }, '更新 ' + fmt(cur && cur.updated_at)),
            cur && cur.stale ? h('span', { className: 'rt-tag rt-tag-active' }, '旧版提示词') : null,
            h('div', { className: 'rt-spacer' }),
            h('button', {
              className: 'rt-btn', disabled: busy,
              title: preview ? '切换到 Markdown 源文编辑' : '预览渲染后的提示词',
              onClick: () => setPreview((v) => !v),
            }, preview ? '编辑' : '预览'),
            h('button', {
              className: 'rt-btn', disabled: busy || !active, title: '把当前角色恢复成内置最新版提示词',
              onClick: () => reset(false),
            }, '恢复默认为当前'),
            h('button', {
              className: 'rt-btn', disabled: busy, title: '全部角色恢复成内置最新版提示词',
              onClick: () => reset(true),
            }, '全部恢复默认'),
            h('button', { className: 'rt-btn rt-btn-primary', disabled: busy || !active, onClick: save }, busy ? '保存中…' : '保存')),
          msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
          h('div', { className: 'rt-pane' },
            preview
              ? h(Markdown, {
                  className: 'rt-markdown rt-prompt-preview', text: draft || '（空）',
                  style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, maxHeight: '48vh' },
                })
              : h('textarea', {
                  className: 'rt-textarea', value: draft, spellCheck: false,
                  onChange: (e) => setDraft(e.target.value),
                  placeholder: '该角色的系统提示词（Markdown）',
                }),
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } },
              preview
                ? (cur && cur.planner
                    ? '主会话实际使用预设里的 persona；这里的 plan 文本只作人设参考，不会自动注入。'
                    : '当前是渲染预览。点「编辑」修改 Markdown 源文；保存后写入 agents/' + (active || 'role') + '.md，主会话派活时用 redteam_role_prompt 读取并写入子任务描述。')
                : (cur && cur.planner
                    ? '正在编辑主会话参考文本；它不会自动进入系统提示（主会话用预设 persona）。'
                    : '正在编辑 Markdown 源文。点「预览」看渲染效果；保存后写入 agents/' + (active || 'role') + '.md，主会话派活时用 redteam_role_prompt 读取并写入子任务描述。')))))
    }

    /* ---------------------------------------------------------- 研发技能库（DSH 原生） */
    function SkillsTab(props) {
      const refreshKey = props.refreshKey || 0
      const [items, setItems] = React.useState([])
      const [meta, setMeta] = React.useState({})
      const [err, setErr] = React.useState(null)
      const [q, setQ] = React.useState('')
      const [cat, setCat] = React.useState('')
      const [redteamOnly, setRedteamOnly] = React.useState(true)
      const [srcOnly, setSrcOnly] = React.useState(false)
      const [active, setActive] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [brokenOnly, setBrokenOnly] = React.useState(false)

      const load = (force) => {
        setBusy(true)
        api({ op: 'skillCatalog', refresh: force === true }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null)
          setMeta(r || {})
          setItems(r.items || [])
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }
      React.useEffect(load, [refreshKey])

      const open = (name) => {
        if (active === name) { setActive(null); setDetail(null); return }
        setActive(name)
        setDetail(null)
        api({ op: 'skillRead', name: name }).then((r) => {
          if (r && r.ok) setDetail(r)
          else setErr((r && r.error) || '读取失败')
        }, (e) => setErr(String((e && e.message) || e)))
      }

      const needle = q.trim().toLowerCase()
      const redteamCount = items.filter((s) => (s.category || '未分类') !== '未分类').length
      const scoped = redteamOnly ? items.filter((s) => (s.category || '未分类') !== '未分类') : items
      const cats = Array.from(new Set(scoped.map((s) => s.category || '未分类')))
      const effectiveCat = cats.includes(cat) ? cat : ''
      let filtered = needle
        ? scoped.filter((s) => (s.name + ' ' + s.description + ' ' + s.whenToUse + ' ' + (s.category || '')).toLowerCase().indexOf(needle) >= 0)
        : scoped
      if (effectiveCat) filtered = filtered.filter((s) => (s.category || '未分类') === effectiveCat)
      if (srcOnly) filtered = filtered.filter((s) => s.fromPlugin === true)
      if (brokenOnly) filtered = filtered.filter((s) => s.availability === 'broken' || s.availability === 'unknown')
      const availSummary = meta.availability ? meta.availability.summary : null
      const needRestart = err !== null && String(err).indexOf('unknown op') >= 0

      const listItems = filtered.map((s) => h('div', Object.assign({
        key: s.name,
        className: 'rt-skill-row' + (active === s.name ? ' on' : '') + (s.availability === 'broken' ? ' broken' : ''),
        title: s.name + (s.description ? ' — ' + s.description : ''),
      }, clickable(() => open(s.name), { label: '查看技能 ' + s.name, expanded: active === s.name })),
        h('span', {
          className: 'rt-avail rt-avail-' + (s.availability || 'unknown'),
          title: (s.availability === 'available'
            ? '可用：正文能加载，必需的环境变量/本机路径/基础设施都在'
            : (s.issues || []).map((x) => x.detail + (x.fix ? '\n  修复：' + x.fix : '')).join('\n')
              || (s.problems || []).join('\n') || '未知'),
        }, s.availability === 'available' ? '可用' : s.availability === 'broken' ? '不可用' : '未知'),
        h('div', { className: 'rt-skill-main' },
          h('div', { className: 'rt-skill-name' }, s.name,
            s.modelInvocable === false ? h('span', { className: 'rt-tag', style: { marginLeft: 5 } }, '仅人工') : null),
          h('div', { className: 'rt-skill-desc' }, String(s.description || '（无描述）').replace(/[*`]/g, ''))),
        h('span', { className: 'rt-tag' }, s.category || '未分类'),
        h('span', { className: 'rt-tag' }, s.fromPlugin ? '插件' : '用户'),
        (s.problems || []).length > 0 && s.availability !== 'available'
          ? h('span', { className: 'rt-avail rt-avail-broken', title: String((s.issues && s.issues[0] && s.issues[0].detail) || s.problems[0]) }, '!')
          : null))

      return h('div', { className: 'rt-split' },
        h('div', { className: 'rt-list' },
          h('input', {
            className: 'rt-input', style: { width: '100%', marginBottom: 8, boxSizing: 'border-box' },
            placeholder: '过滤技能', value: q, onChange: (e) => setQ(e.target.value),
          }),
          h('select', {
            className: 'rt-input', style: { width: '100%', marginBottom: 8, boxSizing: 'border-box' },
            value: effectiveCat, onChange: (e) => setCat(e.target.value),
          },
            h('option', { value: '' }, '全部分类（' + scoped.length + '）'),
            cats.map((c) => h('option', { key: c, value: c },
              c + '（' + scoped.filter((s) => (s.category || '未分类') === c).length + '）'))),
          h('label', { className: 'rt-kb-check', style: { display: 'flex', margin: '0 0 6px' } },
            h('input', { type: 'checkbox', checked: redteamOnly, onChange: (e) => setRedteamOnly(e.target.checked) }),
            '只看研发技能（' + redteamCount + ' 个，隐藏 DSH 通用）'),
          h('label', { className: 'rt-kb-check', style: { display: 'flex', margin: '0 0 6px' } },
            h('input', { type: 'checkbox', checked: srcOnly, onChange: (e) => setSrcOnly(e.target.checked) }),
            '只看本插件自带（' + (meta.fromPlugin || 0) + ' 个）'),
          availSummary && (availSummary.broken > 0 || availSummary.unknown > 0)
            ? h('label', {
                className: 'rt-kb-check', style: { display: 'flex', margin: '0 0 8px' },
                title: '只看不可用（缺 key / 缺本机路径 / 基础设施还是占位符）或判不了可用性的技能',
              },
                h('input', { type: 'checkbox', checked: brokenOnly, onChange: (e) => setBrokenOnly(e.target.checked) }),
                '只看不可用/未知（' + ((availSummary.broken || 0) + (availSummary.unknown || 0)) + ' 个）')
            : null,
          availSummary
            ? h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 } },
                h('span', { className: 'rt-avail rt-avail-available' }, '可用 ' + (availSummary.available || 0)),
                availSummary.broken > 0 ? h('span', { className: 'rt-avail rt-avail-broken' }, '不可用 ' + availSummary.broken) : null,
                availSummary.unknown > 0 ? h('span', { className: 'rt-avail rt-avail-unknown' }, '未知 ' + availSummary.unknown) : null,
                h('span', Object.assign({
                  className: 'rt-tag', style: { cursor: 'pointer' },
                  title: '技能正文或环境变量刚改过？点这里跳过 30 秒缓存重查',
                }, clickable(() => load(true), { label: '重新检查技能可用性' })), '重查可用性'))
            : null,
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginBottom: 6 } },
            '共 ' + items.length + ' 个技能 · 当前显示 ' + filtered.length + ' 个 · 来自 ' + ((meta.byDir || []).length) + ' 个目录',
            items.length > 100 ? h('div', { style: { marginTop: 3 } },
              '（技能多来自其它插件注册的根或你自己的技能目录；本插件只自带 ' + (meta.fromPlugin || 0) + ' 个）') : null),
          listItems),
        h('div', { className: 'rt-main' },
          h('div', { className: 'rt-toolbar' },
            h('span', { style: { fontWeight: 600 } }, detail ? detail.name : '研发技能库'),
            h('div', { className: 'rt-spacer' }),
            h('button', { className: 'rt-btn', disabled: busy, onClick: () => load(true) }, busy ? '刷新中…' : '刷新')),
          err
            ? (needRestart
                ? h('div', { className: 'rt-empty' }, '该模块的宿主代码已更新，需重启一次 dsh web 后生效')
                : h('div', { className: 'rt-err' }, err))
            : null,
          detail
            ? h('div', { className: 'rt-pane' },
                h('div', { className: 'rt-kv' }, h('b', null, '描述'), h('span', null, detail.description || '—')),
                h('div', { className: 'rt-kv' }, h('b', null, '分类'), h('span', null, detail.category || '未分类')),
                h('div', { className: 'rt-kv' }, h('b', null, '何时使用'), h('span', null, detail.whenToUse || '—')),
                h('div', { className: 'rt-kv' }, h('b', null, '来源'), h('span', null, (detail.provider || '—') + ' / ' + (detail.source || '—'))),
                (() => {
                  const s2 = items.find((x) => x.name === detail.name)
                  if (!s2) return null
                  const avail = s2.availability || 'unknown'
                  return h('div', null,
                    h('div', { className: 'rt-kv' }, h('b', null, '可用性'),
                      h('span', { className: 'rt-avail rt-avail-' + avail },
                        avail === 'available' ? '可用' : avail === 'broken' ? '不可用' : '未知（正文读不到）')),
                    (s2.issues || []).length > 0
                      ? h('div', { className: 'rt-kv' }, h('b', null, '不可用原因'),
                          h('span', null, s2.issues.map((x, i) => h('div', { key: 'i' + i, style: { marginBottom: 6 } },
                            h('div', null, '· ' + x.detail),
                            x.fix
                              ? h('div', { style: { marginLeft: 14, color: 'var(--dsw-alias-label-secondary)' } }, '修复：' + x.fix)
                              : null))))
                      : (s2.problems || []).length > 0
                        ? h('div', { className: 'rt-kv' }, h('b', null, '不可用原因'),
                            h('span', null, s2.problems.map((x, i) => h('div', { key: 'p' + i }, '· ' + x))))
                        : null,
                    (s2.needs_user || []).length > 0
                      ? h('div', { className: 'rt-kv' }, h('b', null, '需要你提供'),
                          h('span', { style: { color: 'var(--dsw-alias-state-warn-primary, #f59e0b)' } },
                            s2.needs_user.map((x, i) => h('div', { key: 'n' + i }, '· ' + x))))
                      : null)
                })(),
                detail.path ? h('div', { className: 'rt-kv' }, h('b', null, '文件'), h('span', { className: 'rt-mono', style: { wordBreak: 'break-all' } }, detail.path)) : null,
                h(Markdown, {
                  className: 'rt-markdown rt-md-view', text: detail.content || '（空）',
                  style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, maxHeight: '52vh' },
                }))
            : h('div', { className: 'rt-pane' },
                h('div', { className: 'rt-kv' }, h('b', null, '技能'),
                  h('span', null, '共 ' + items.length + ' 个'
                    + (availSummary ? ' · 可用 ' + (availSummary.available || 0)
                      + ' / 不可用 ' + (availSummary.broken || 0)
                      + ' / 未知 ' + (availSummary.unknown || 0) : ''))),
                h('div', { className: 'rt-foot', style: { marginBottom: 8 } },
                  '左侧选一个技能，查看正文、何时使用、不可用原因与修复方法。'),
                meta.availability && (meta.availability.broken || []).length > 0
                  ? h('div', { className: 'rt-hint' },
                      h('div', { style: { fontWeight: 600, marginBottom: 4 } }, '现在跑不起来的技能：'),
                      meta.availability.broken.slice(0, 12).map((b) => h('div', { key: b.name },
                        '· ' + b.name + ' — '
                        + String((b.issues && b.issues[0] && b.issues[0].detail) || (b.problems && b.problems[0]) || '未知')
                        + (b.issues && b.issues[0] && b.issues[0].fix ? '（' + b.issues[0].fix + '）' : ''))))
                  : h('div', { className: 'rt-empty' }, '没有不可用技能；左侧选择技能查看正文。'))))
    }

    /* ---------------------------------------------------------- 代码审查与缺陷 */
    const SEV_LABEL = { critical: '严重', high: '高危', medium: '中危', low: '低危', info: '信息' }
    const STATUS_LABEL = { candidate: '待验证', confirmed: '已确认', 'false-positive': '误报', exploited: '已利用', fixed: '已修复' }
    const sevClass = (s) => 'rt-sev rt-sev-' + (SEV_LABEL[s] ? s : 'info')

    /** 目标归并：按「scheme://host:port」聚合，避免带路径的 URL 把分组打散。 */
    function targetKeyOf(v) {
      const t = String(v.target || '').trim()
      if (t !== '') {
        const url = /^([a-z][a-z0-9+.-]*:\/\/[^/?#\s]+)/i.exec(t)
        if (url) return url[1]
        const head = /^([^\s/?#]+)/.exec(t)
        if (head) return head[1]
        return t
      }
      return v.asset_ip || '(未指定目标)'
    }

    /* ---------------------------------------------------------- 证据渲染 */
    function HttpBlock(props) {
      const text = String(props.text || '')
      if (!text) return null
      const lines = text.split(/\r?\n/)
      const nodes = lines.map((ln, i) => {
        let cls = null
        if (i === 0 && /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|TRACE)\s/.test(ln)) cls = 'rt-hl-req'
        else if (i === 0 && /^HTTP\//.test(ln)) cls = 'rt-hl-res'
        else if (/^[A-Za-z0-9-]+:/.test(ln)) {
          const name = ln.split(':')[0].toLowerCase()
          if (name === 'host' || name === 'cookie' || name === 'authorization' || name === 'content-type') cls = 'rt-hl-req'
        }
        return h('div', { key: 'l' + i, className: cls || undefined }, ln === '' ? '\u00a0' : ln)
      })
      return h('pre', { className: 'rt-evi-body' + (props.compact ? ' req' : '') }, nodes)
    }

    /** 缺陷详情里的证据区：结构化证据文本 + 原始 HTTP 请求/响应报文。 */
    function detailEvidence(v) {
      const evi = String(v.evidence || '').trim()
      const looksHttp = /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|HTTP\/)/m.test(evi) || /\n[A-Za-z-]+: /.test(evi)
      const blocks = []
      if (evi) {
        blocks.push(h('div', { key: 'ev', className: 'rt-evi' },
          h('div', { className: 'rt-evi-head' }, '证据摘要',
            h('span', { className: 'rt-tag' }, looksHttp ? '原始报文' : '文本'),
            h('div', { className: 'rt-spacer' }),
            h('button', {
              className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
              onClick: (e) => { e.stopPropagation(); copyText(evi) },
            }, '复制')),
          looksHttp ? h(HttpBlock, { text: evi }) : h('pre', { className: 'rt-evi-body' }, evi)))
      }
      const http = v.http_evidence || []
      for (const e of http) {
        blocks.push(h('div', { key: 'h' + e.id, className: 'rt-evi' },
          h('div', { className: 'rt-evi-head' },
            e.label || 'HTTP 证据',
            h('span', { className: 'rt-tag' }, (e.method || '') + ' ' + (e.status === null || e.status === undefined ? '' : e.status)),
            h('div', { className: 'rt-spacer' }),
            h('span', { style: { fontWeight: 400, color: 'var(--dsw-alias-label-secondary)' } }, fmt(e.captured_at || e.created_at))),
          e.request ? h('div', null,
            h('div', { className: 'rt-evi-head', style: { borderTop: 'none' } }, '▸ 请求报文（可用于接口联调复现）'),
            h(HttpBlock, { text: e.request, compact: true })) : null,
          e.response ? h('div', null,
            h('div', { className: 'rt-evi-head' }, '▸ 响应'),
            h(HttpBlock, { text: e.response })) : null,
          e.note ? h('pre', { className: 'rt-evi-body', style: { maxHeight: 80 } }, e.note) : null))
      }
      if (blocks.length === 0) {
        blocks.push(h('div', { key: 'none', className: 'rt-kv' }, h('b', null, '证据'),
          h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, '缺失 —— 未验证/无证据的记录不计入交付报告，请补 redteam_http_evidence_add')))
      }
      return h('div', { key: 'eviwrap' }, blocks)
    }

    /* ---------------------------------------------------------- 配置凭据 / 连接会话 / 构建产物 */
    function CredentialList(props) {
      const creds = props.items || []
      if (!creds.length) return h('div', { className: 'rt-empty' }, '暂无凭据（录入配置密钥或连接参数后默认脱敏展示，秒级可复用）')
      return h('div', { className: 'rt-pane' }, creds.map((c) => h('div', { key: 'c' + c.id, className: 'rt-cred' },
        h('div', { className: 'rt-cred-head' },
          h('span', { className: 'rt-cred-host' }, c.host),
          c.username ? h('span', { className: 'rt-tag' }, c.username) : null,
          h('span', { className: 'rt-tag rt-tag-passive' }, c.secret_type || 'password'),
          c.privilege ? h('span', { className: 'rt-tag rt-tag-active' }, c.privilege) : null,
          h('div', { className: 'rt-spacer' }),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: (e) => { e.stopPropagation(); copyText(String(c.secret_value || '')) },
          }, '复制')),
        h(SecretText, { value: c.secret_value, className: 'rt-secret', empty: '未记明文 —— 请补充 secret_value 后面板才能脱敏预览' }),
        h('div', { className: 'rt-cred-meta' },
          [c.source ? '来源 ' + c.source : null,
            c.tool ? '工具 ' + c.tool : null,
            c.secret_ref ? '证据 ' + c.secret_ref : null,
            c.found_by_agent ? 'by ' + c.found_by_agent : null,
            c.found_at ? fmt(c.found_at) : null].filter(Boolean).join(' · ')),
        c.note ? h('div', { className: 'rt-cred-meta' }, '备注：' + c.note) : null)))
    }

    function AccessList(props) {
      const accesses = props.items || []
      if (!accesses.length) return h('div', { className: 'rt-empty' }, '暂无访问会话')
      return h('div', { className: 'rt-pane' }, accesses.map((a) => h('div', {
        key: 'a' + a.id, className: 'rt-vrow',
        style: { cursor: 'default', gridTemplateColumns: '1fr 110px 80px 80px 1fr' },
      },
        h('span', { className: 'rt-mono' }, a.host),
        h('span', null, a.username || '—'),
        h('span', null, h('span', { className: 'rt-tag rt-tag-active' }, a.method || '—')),
        h('span', null, a.privilege || '—'),
        h('span', { className: 'rt-mono', title: a.session_ref || '' }, a.session_ref || '—'))))
    }

    function ArtifactsTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [files, setFiles] = React.useState([])
      const [creds, setCreds] = React.useState([])
      const [accesses, setAccesses] = React.useState([])
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const seqRef = React.useRef(0)

      const load = () => {
        if (!eng) return
        const my = ++seqRef.current
        setBusy(true)
        setErr(null)
        Promise.all([
          api({ op: 'attackFiles', engagement: eng }).then((r) => { if (my === seqRef.current) setFiles((r && r.items) || []) }, () => {}),
          api({ op: 'credentials', engagement: eng }).then((r) => { if (my === seqRef.current) setCreds((r && r.items) || []) }, () => {}),
          api({ op: 'access', engagement: eng }).then((r) => { if (my === seqRef.current) setAccesses((r && r.items) || []) }, () => {}),
        ]).finally(() => {
          if (my === seqRef.current) setBusy(false)
        })
      }
      React.useEffect(load, [eng, refreshKey])

      const fileCount = (files || []).reduce((n, g) => n + (g.files || []).length, 0)
      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '配置与构建产物'),
          h('span', { className: 'rt-tag' }, '环境变量与密钥 ' + creds.length),
          h('span', { className: 'rt-tag' }, '活跃服务连接 ' + accesses.length),
          h('span', { className: 'rt-tag' }, '构建与验证脚本 ' + fileCount),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '刷新中…' : '刷新')),
        err ? h('div', { className: 'rt-err' }, err) : null,
        h('div', { className: 'rt-body', style: { overflow: 'auto' } },
          h('details', { className: 'rt-card' },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '环境变量与密钥 · ' + creds.length + '（默认脱敏，点开查看）'),
            h(CredentialList, { items: creds })),
          h('details', { className: 'rt-card' },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '活跃服务连接 · ' + accesses.length),
            h(AccessList, { items: accesses })),
          h('details', { className: 'rt-card' },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '构建与验证脚本 · ' + fileCount),
            h(AttackFilesTab, { engagement: eng, refreshKey: refreshKey }))))
    }

    function FindingsTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [sev, setSev] = React.useState('')
      const [status, setStatus] = React.useState('')
      const [gainOnly, setGainOnly] = React.useState(false)
      const [q, setQ] = React.useState('')
      const [qApplied, setQApplied] = React.useState('')
      const [state, setState] = React.useState({ loading: false, error: null, total: 0, items: [], stats: null })
      const [files, setFiles] = React.useState([])
      const [openId, setOpenId] = React.useState(null)
      const [msg, setMsg] = React.useState(null)
      /* 默认按目标模块聚合 */
      const [grouped, setGrouped] = React.useState(true)
      /* 默认只看关键缺陷：已验证或已记录影响范围 */
      const [resultsOnly, setResultsOnly] = React.useState(true)
      const collapse = useCollapse('findings:' + eng)
      const seqRef = React.useRef(0)

      const load = () => {
        if (!eng) return
        const my = ++seqRef.current
        setState((s) => Object.assign({}, s, { loading: true, error: null }))
        api({
          op: 'vulns', engagement: eng, severity: sev || undefined,
          status: status || undefined, q: qApplied || undefined, limit: 200,
        }).then((r) => {
          if (my !== seqRef.current) return
          if (!r || r.ok === false) {
            setState({ loading: false, error: (r && r.error) || '查询失败', total: 0, items: [], stats: null })
            return
          }
          setState({ loading: false, error: null, total: r.total, items: r.items || [], stats: r.stats || null })
        }, (e) => {
          if (my === seqRef.current) setState({ loading: false, error: String((e && e.message) || e), total: 0, items: [], stats: null })
        })
        api({ op: 'attackFiles', engagement: eng }).then((r) => {
          if (my === seqRef.current) setFiles((r && r.items) || [])
        }, () => {})
      }
      React.useEffect(load, [eng, sev, status, qApplied, refreshKey])

      const setVulnStatus = (id, next) => {
        setMsg(null)
        api({ op: 'updateVuln', engagement: eng, id: id, patch: { status: next } }).then((r) => {
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '更新失败' }); return }
          setMsg({ ok: '已更新为「' + (STATUS_LABEL[next] || next) + '」' })
          load()
        }, (e) => setMsg({ err: String((e && e.message) || e) }))
      }

      const stats = (state.stats && state.stats.bySeverity) ? state.stats : { bySeverity: {}, byStatus: {} }
      const needRestart = state.error !== null && String(state.error).indexOf('unknown op') >= 0
      const hasGain = (v) => {
        const g = String(v.gained || '').trim()
        return g !== '' && !/未利用|无权限|未记录|未获取|^—+$/.test(g)
      }
      const visibleItems = state.items.filter((v) => {
        if (gainOnly && !hasGain(v)) return false
        return !resultsOnly || v.status === 'exploited' || hasGain(v)
      })

      /* ── 结论行：只给结论，数字点一下就是筛选 ─────────────────────── */
      const concl = (key, label, value, active, onClick) => h('span', Object.assign({
        key: key, className: 'rt-concl-i' + (active ? ' on' : ''), title: '点击筛选 / 再点取消',
      }, clickable(onClick, { label: '按「' + label + '」筛选（' + (value || 0) + '）', expanded: active })),
        h('b', null, String(value || 0)), h('span', null, label))
      const conclusion = h('div', { className: 'rt-concl' },
        h('span', { className: 'rt-concl-group' }, '质量'),
        concl('exp', '已确认修复/验证', (stats.byStatus.exploited || 0), status === 'exploited', () => setStatus((v) => (v === 'exploited' ? '' : 'exploited'))),
        concl('gain', '影响范围', (stats.withGained || 0), gainOnly, () => setGainOnly((v) => !v)),
        h('span', { className: 'rt-concl-group' }, '等级'),
        concl('crit', '严重', (stats.bySeverity.critical || 0), sev === 'critical', () => setSev((v) => (v === 'critical' ? '' : 'critical'))),
        concl('high', '高危', (stats.bySeverity.high || 0), sev === 'high', () => setSev((v) => (v === 'high' ? '' : 'high'))),
        h('details', { className: 'rt-concl-extra' },
          h('summary', null, '已确认 ' + (stats.byStatus.confirmed || 0) + ' · 中危 ' + (stats.bySeverity.medium || 0)),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 } },
            concl('conf', '已确认', (stats.byStatus.confirmed || 0), status === 'confirmed', () => setStatus((v) => (v === 'confirmed' ? '' : 'confirmed'))),
            concl('med', '中危', (stats.bySeverity.medium || 0), sev === 'medium', () => setSev((v) => (v === 'medium' ? '' : 'medium'))))),
        h('div', { className: 'rt-spacer' }),
        h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
          '默认按模块聚合 · 当前显示 ' + visibleItems.length + ' / 共 ' + (state.total || 0) + ' 条 · ' + (stats.targetGroups || 0) + ' 个目标模块'))

      const head = h('div', { className: 'rt-vrow head' },
        h('span', null, '等级'), h('span', null, '缺陷 / 编号'), h('span', null, '目标模块'),
        h('span', null, '影响范围'), h('span', null, '状态'), h('span', null, '置信'))

      /* 构建与验证脚本按 vuln_id 建索引 */
      const allFiles = (files || []).flatMap((g) => (g.files || []).map((f) => Object.assign({ target: g.target }, f)))
      const filesByVuln = new Map()
      for (const f of allFiles) {
        const vid = f.vuln_id === null || f.vuln_id === undefined ? null : Number(f.vuln_id)
        if (vid === null) continue
        if (!filesByVuln.has(vid)) filesByVuln.set(vid, [])
        filesByVuln.get(vid).push(f)
      }

      /* 单条缺陷（行 + 展开详情），聚合视图与平铺视图共用 */
      const vulnRows = (v, compact) => {
        const out = []
        const gainedList = String(v.gained || '').split(/[、,;，；]/).map((x) => x.trim()).filter(Boolean)
        const open = openId === v.id
        out.push(h('div', {
          key: 'v' + v.id, className: 'rt-vrow', role: 'button', tabIndex: 0,
          style: compact ? { cursor: 'pointer', gridTemplateColumns: '58px minmax(0,1fr) 104px 68px' } : { cursor: 'pointer' },
          onClick: () => setOpenId(open ? null : v.id),
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(open ? null : v.id) } },
        },
          h('span', null, h('span', { className: sevClass(v.severity) }, SEV_LABEL[v.severity] || v.severity)),
          h('span', { title: v.title || '' }, h('span', { className: 'rt-sec-caret' }, open ? '▾' : '▸'), (v.cve ? v.cve + ' ' : '') + (v.title || '')),
          compact ? null : h('span', { className: 'rt-mono', title: v.target || '' }, v.target || v.asset_ip || '—'),
          h('span', { title: v.gained || '' },
            gainedList.length
              ? h('span', { className: 'rt-gain', style: { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' } }, gainedList[0] + (gainedList.length > 1 ? ' +' + (gainedList.length - 1) : ''))
              : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '—')),
          h('span', null, h('span', { className: 'rt-tag' }, STATUS_LABEL[v.status] || v.status)),
          compact ? null : h('span', null, v.confidence === null || v.confidence === undefined ? '—' : Math.round(v.confidence * 100) + '%')))
        if (openId !== v.id) return out
        out.push(h('div', {
          key: 'vd' + v.id, className: 'rt-vrow',
          style: { cursor: 'default', gridTemplateColumns: '1fr' },
        }, h('div', { className: 'rt-vdetail' },
          h('div', { className: 'rt-kv' }, h('b', null, '影响范围'),
            gainedList.length
              ? h('span', null, gainedList.map((g, gi) => h('span', { key: 'g' + gi, className: 'rt-gain', style: { marginRight: 6 } }, g)))
              : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                  '未记录 —— 验证确认影响范围后请用 redteam_vuln_update 补充 gained')),
          h('div', { className: 'rt-kv' }, h('b', null, '目标模块'), h('span', { className: 'rt-mono', style: { wordBreak: 'break-all' } }, v.target || '—')),
          h('div', { className: 'rt-kv' }, h('b', null, '所属节点'), h('span', null, (v.asset_ip || '—') + ' · ' + (v.segment_cidr || ''))),
          h('div', { className: 'rt-kv' }, h('b', null, '来源'), h('span', null, (v.source || '—') + ' · ' + (v.found_by_agent || '—') + ' · ' + fmt(v.found_at))),
          detailEvidence(v),
          (() => {
            const mine = filesByVuln.get(Number(v.id)) || []
            return h('div', { className: 'rt-kv' }, h('b', null, '构建与验证脚本'),
              mine.length
                ? h('span', null, mine.map((f, fi) => h('div', { key: 'af' + fi, style: { marginBottom: 3 } },
                    '· ' + (f.kind ? '[' + f.kind + '] ' : '') + (f.name || '(未命名)')
                    + (f.description ? ' — ' + f.description : ''),
                    h('div', { className: 'rt-mono', style: { fontSize: 11, marginLeft: 12, color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' } }, f.path || ''))))
                : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                    '（无）用 redteam_attack_file_add 把该缺陷关联的复现测试或修复脚本归档，并带上 vuln_id'))
          })(),
          h('div', { className: 'rt-actions' },
            h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setVulnStatus(v.id, 'confirmed') } }, '确认'),
            h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setVulnStatus(v.id, 'exploited') } }, '已验证'),
            h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setVulnStatus(v.id, 'false-positive') } }, '误报'),
            h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setVulnStatus(v.id, 'fixed') } }, '已修复')))))
        return out
      }

      const rows = []
      if (grouped) {
        const groups = new Map()
        for (const v of visibleItems) {
          const key = targetKeyOf(v)
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(v)
        }
        const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
        const list = Array.from(groups.entries()).map(([key, vs]) => ({
          key,
          vulns: vs,
          top: vs.slice().sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9))[0],
          gained: Array.from(new Set(vs.flatMap((v) => String(v.gained || '').split(/[、,;，；]/).map((x) => x.trim()).filter(Boolean)))),
          exploited: vs.filter((v) => v.status === 'exploited').length,
        })).sort((a, b) => (SEV_RANK[a.top.severity] ?? 9) - (SEV_RANK[b.top.severity] ?? 9) || b.vulns.length - a.vulns.length)
        for (const g of list) {
          const key = 'target:' + g.key
          const defOpen = false
          rows.push(h(Section, {
            key: 'sec:' + g.key, tone: 'target',
            title: g.key,
            count: g.vulns.length + ' 项缺陷',
            sub: [
              SEV_LABEL[g.top.severity] || g.top.severity,
              g.exploited ? '已验证 ' + g.exploited : null,
              g.top.asset_ip && g.top.asset_ip !== g.key ? '节点 ' + g.top.asset_ip : null,
            ].filter(Boolean).join(' · '),
            right: g.gained.length
              ? g.gained.slice(0, 2).join(' / ') + (g.gained.length > 2 ? ' +' + (g.gained.length - 2) : '')
              : '未记录影响范围',
            open: collapse.isOpen(key, defOpen),
            onToggle: collapse.toggle(key, defOpen),
          }, g.vulns.map((v) => vulnRows(v, true))))
        }
        if (!list.length && !state.loading && !state.error) {
          rows.push(h('div', { key: 'none', className: 'rt-empty' }, resultsOnly ? '当前没有已确认修复/验证的关键缺陷；点「显示全部」看全部审查记录。' : '暂无审查与缺陷记录'))
        }
      } else {
        for (const v of visibleItems) rows.push(...vulnRows(v))
      }

      const toolbar = h('div', { className: 'rt-toolbar' },
        h('input', {
          className: 'rt-input', style: { flex: '1 1 140px' }, placeholder: '搜索标题 / 编号 / 模块（回车）',
          value: q, onChange: (e) => setQ(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') setQApplied(q) },
        }),
        h('button', { className: 'rt-btn', onClick: () => setQApplied(q) }, '搜索'),
        h('select', { className: 'rt-input', value: sev, onChange: (e) => setSev(e.target.value) },
          h('option', { value: '' }, '全部等级'),
          h('option', { value: 'critical' }, '严重'),
          h('option', { value: 'high' }, '高危'),
          h('option', { value: 'medium' }, '中危'),
          h('option', { value: 'low' }, '低危'),
          h('option', { value: 'info' }, '信息')),
        h('select', { className: 'rt-input', value: status, onChange: (e) => setStatus(e.target.value) },
          h('option', { value: '' }, '全部状态'),
          h('option', { value: 'candidate' }, '待验证'),
          h('option', { value: 'confirmed' }, '已确认'),
          h('option', { value: 'exploited' }, '已确认修复/验证'),
          h('option', { value: 'false-positive' }, '误报'),
          h('option', { value: 'fixed' }, '已修复')),
        h('button', {
          className: 'rt-btn' + (resultsOnly ? ' rt-btn-primary' : ''),
          title: '默认只显示已验证或已记录影响范围的关键缺陷；点一下显示全部候选/已确认项',
          onClick: () => setResultsOnly((v) => !v),
        }, resultsOnly ? '只看关键缺陷 ✓' : '显示全部'))

      return h('div', { className: 'rt-main' }, toolbar, conclusion,
        h('div', { className: 'rt-subtabs' },
          h('span', { className: 'rt-subtab on' }, '审查项 ' + visibleItems.length),
          h('div', { className: 'rt-spacer' }),
          grouped ? h('button', {
            className: 'rt-btn', title: '展开所有目标模块',
            onClick: () => collapse.setAll(visibleItems.map((v) => 'target:' + targetKeyOf(v)), true),
          }, '全部展开') : null,
          grouped ? h('button', {
            className: 'rt-btn', title: '收起所有目标模块',
            onClick: () => collapse.setAll(visibleItems.map((v) => 'target:' + targetKeyOf(v)), false),
          }, '全部收起') : null,
          h('button', {
            className: 'rt-btn' + (grouped ? ' rt-btn-primary' : ''),
            title: grouped ? '当前：按目标模块聚合' : '当前：平铺每条缺陷',
            onClick: () => setGrouped((g) => !g),
          }, grouped ? '按目标聚合' : '平铺列表')),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        needRestart ? h('div', { className: 'rt-empty' }, '该模块的宿主代码已更新，需重启一次 dsh web 后生效') : null,
        state.error && !needRestart ? h('div', { className: 'rt-err' }, state.error) : null,
        h('div', { className: 'rt-table' }, grouped ? null : head, rows,
          !state.loading && !visibleItems.length && !state.error
            ? h('div', { className: 'rt-empty' }, resultsOnly ? '当前没有已确认修复/验证的关键缺陷；点「显示全部」看全部审查记录。' : '暂无审查与缺陷记录')
            : null))
    }

    /* ---------------------------------------------------------- 研发交付报告 */
    function groupByStage(reportItems, chain) {
      const byId = new Map((reportItems || []).map((x) => [x.id, x]))
      const groups = []
      const stageList = (chain && chain.stages) || []
      stageList.forEach((st, si) => {
        const items = (st.items || []).map((x) => byId.get(x.id)).filter(Boolean)
        if (items.length === 0) return
        groups.push({ code: st.code, name: st.name, color: st.color || '#64748b',
          ordinal: st.ordinal || si + 1, points: st.points || 0, cumulative: st.cumulative || 0, items })
      })
      const grouped = new Set(groups.reduce((acc, g) => acc.concat(g.items.map((x) => x.id)), []))
      const rest = (reportItems || []).filter((x) => !grouped.has(x.id))
      if (rest.length > 0) {
        groups.push({ code: 'other', name: '其他得分', color: '#64748b', ordinal: groups.length + 1,
          points: rest.reduce((n, x) => n + (x.counted ? x.points : 0), 0),
          cumulative: 0, items: rest })
      }
      return groups
    }

    /* ---------------------------------------------------------- 报告 v2：模板化页面 */
    function ReportV2(props) {
      const { report, eng, mdText, busy, load, copy, download, msg } = props
      const summary = report.summary || {}
      const table = (headers, rows) => {
        const head = h('thead', null, h('tr', null, headers.map((v, i) => h('th', { key: 'h' + i }, v))))
        const body = h('tbody', null, (rows || []).map((row, ri) => h('tr', { key: 'r' + ri },
          row.map((v, ci) => h('td', { key: 'c' + ci }, v === null || v === undefined || v === '' ? '—' : v)))))
        return h('div', { className: 'rt-r2-table-wrap' },
          h('table', { className: 'rt-r2-table' }, head, body))
      }
      const proofCard = (g) => h('div', { className: 'rt-r2-proof', key: 'proof' + (g.asset.id || g.asset.ip) },
        h('div', { className: 'rt-r2-proof-head' },
          h('b', { className: 'rt-mono' }, g.asset.ip || g.asset.primary_name || '未命名资产'),
          g.asset.primary_name ? h('span', { className: 'rt-r2-muted' }, g.asset.primary_name) : null,
          h('div', { className: 'rt-spacer' }),
          h('span', { className: 'rt-tag' }, g.type),
          h('span', { className: 'rt-tag ' + (g.strength === '强' ? 'rt-tag-live' : 'rt-tag-warn') }, '证明 ' + g.strength)),
        h('div', { className: 'rt-r2-proof-line' }, h('b', null, '归属证据 '), g.proof || '待补'),
        (g.shots || []).length > 0
          ? h(ShotStrip, { eng: eng, shots: g.shots, total: g.shots.length, title: '归属截图' })
          : h('div', { className: 'rt-r2-empty' }, '归属截图待补'))
      const proofSection = (title, list) => h('div', null,
        h('h3', { className: 'rt-r2-h3' }, title),
        (list || []).length === 0
          ? h('div', { className: 'rt-r2-empty' }, '未采集到对应资产证据。')
          : h('div', { className: 'rt-r2-proof-grid' }, list.map(proofCard)))
      const code = (text, label) => h('div', { className: 'rt-r2-code' },
        h('div', { className: 'rt-r2-code-head' },
          h('span', null, label), h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', onClick: () => copy(String(text || ''), label) }, '复制')),
        h('pre', { className: 'rt-r2-pre' }, String(text || '')))
      const reproItem = (x, heading) => h('div', { className: 'rt-r2-item', key: 'ri' + heading },
        h('h5', { className: 'rt-r2-h5' }, heading + ' ' + (x.target || x.asset_ip || '')),
        h('div', { className: 'rt-r2-item-line' },
          h('b', null, '变更说明 '),
          x.vuln ? [x.vuln.cve, x.vuln.title].filter(Boolean).join(' ') : (x.how || x.point_name)),
        x.vuln_source === 'step' ? h('div', { className: 'rt-r2-muted' }, '关联自研发执行步骤，记分时未显式填写') : null,
        x.evidence ? h('div', { className: 'rt-r2-item-line' }, h('b', null, '结果 '), x.evidence) : null,
        x.replay_cmd ? code(x.replay_cmd, /^(powershell|pwsh)/i.test(x.replay_cmd) ? 'PowerShell' : 'Bash / 命令') : null,
        (x.requests || []).slice(0, 3).map((q, qi) => q.request ? code(q.request, 'HTTP 报文 ' + (qi + 1)) : null),
        (!x.replay_cmd && !(x.requests || []).some((q) => q.request))
          ? h('div', { className: 'rt-r2-gap' }, '复现缺口：没有留存真实命令或 HTTP 报文。') : null,
        (x.attack_files || []).length > 0
          ? h('div', { className: 'rt-r2-item-line' }, h('b', null, '构建与验证脚本 '),
              h('span', { className: 'rt-mono' }, x.attack_files.map((f) => f.path).join('、'))) : null,
        (x.steps || []).some((s) => s.evidence_ref)
          ? h('div', { className: 'rt-r2-item-line' }, h('b', null, '证据文件 '),
              h('span', { className: 'rt-mono' }, Array.from(new Set(x.steps.map((s) => s.evidence_ref).filter(Boolean))).join('、'))) : null,
        (x.shots || []).length > 0 ? h(ShotStrip, { eng: eng, shots: x.shots, total: x.shots.length, title: '复现截图' }) : null,
        (x.gaps || []).length > 0 ? h('div', { className: 'rt-r2-gap' }, '复现材料：' + x.gaps.join('；')) : null)
      const reproList = (list, headingPrefix, kind) => (list || []).map((g, i) => {
        if (kind === 'boundary') {
          return h('div', { className: 'rt-r2-group', key: 'b' + i },
            h('h4', { className: 'rt-r2-h4' }, headingPrefix + (i + 1) + ' 联调通道' + (i + 1)),
            h('div', { className: 'rt-r2-item-line' }, h('b', null, '入口 '), h('span', { className: 'rt-mono' }, g.entry || '—')),
            g.tunnel
              ? h('div', { className: 'rt-r2-item-line' }, h('b', null, '通道 '), h('span', { className: 'rt-mono' },
                  (g.tunnel.kind || 'socks5') + ' ' + (g.tunnel.listen || '') + (g.tunnel.reach ? ' → ' + g.tunnel.reach : '')))
              : h('div', { className: 'rt-r2-gap' }, '通道记录缺失，需补联调证据。'),
            g.tunnel && g.tunnel.command ? code(g.tunnel.command, '通道建立命令') : null,
            g.items.map((x, j) => reproItem(x, headingPrefix + (i + 1) + '.' + (j + 1))))
        }
        if (kind === 'internet') {
          return h('div', { className: 'rt-r2-group', key: 'g' + i },
            h('h4', { className: 'rt-r2-h4' }, headingPrefix + (i + 1) + ' ' + (g.asset.ip || g.asset.primary_name || '未命名模块')),
            g.items.map((x, j) => reproItem(x, headingPrefix + (i + 1) + '.' + (j + 1))))
        }
        return h('div', { className: 'rt-r2-group', key: 's' + i },
          h('h4', { className: 'rt-r2-h4' }, headingPrefix + (i + 1) + ' ' + (g.label || '网段') + ' “' + (g.cidr || '未归属网段') + '”'),
          (g.assets || []).map((a, ai) => h('div', { className: 'rt-r2-asset', key: 'a' + ai },
            h('h5', { className: 'rt-r2-h5' }, (a.asset.ip || a.asset.primary_name || '未命名模块')),
            a.items.map((x, xi) => reproItem(x, headingPrefix + (i + 1) + '.' + (ai + 1) + '.' + (xi + 1))))))
      })
      const stageSection = (s, i) => {
        const codeStr = s.code
        const list = (report.stage_tables && report.stage_tables[codeStr]) || []
        const headers = codeStr === 'internet' ? ['序号', '里程碑项', '分值', 'URL', '凭据']
          : codeStr === 'boundary' ? ['序号', '里程碑项', '分值', '对外入口点']
            : ['序号', '里程碑项', '分值', '模块', '凭据']
        const rows = list.map((r) => codeStr === 'internet' ? [r.seq, r.point_name, '+' + r.points, r.url, r.credential]
          : codeStr === 'boundary' ? [r.seq, r.point_name, '+' + r.points, r.entry]
            : [r.seq, r.point_name, '+' + r.points, r.asset, r.credential])
        return h('div', { key: 'st' + codeStr },
          h('h3', { className: 'rt-r2-h3' }, '2.' + (i + 1) + ' ' + s.name + '（' + s.count + ' 项 / +' + s.points + ' 分）'),
          list.length === 0 ? h('div', { className: 'rt-r2-empty' }, '本阶段无里程碑项。') : table(headers, rows))
      }
      return h('div', { className: 'rt-main rt-r2' },
        h('div', { className: 'rt-toolbar rt-r2-toolbar' },
          h('span', { style: { fontWeight: 700 } }, 'LMTAgent 研发交付报告'),
          h('span', { className: 'rt-tag rt-tag-live' }, '合计 ' + summary.points + ' 分'),
          h('span', { className: 'rt-tag' }, summary.count + ' 项得分'),
          h('span', { className: 'rt-tag' + (summary.incomplete ? ' rt-tag-warn' : ' rt-tag-live') }, '可复现 ' + (summary.count - (summary.incomplete || 0)) + '/' + summary.count),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy || !mdText, onClick: () => copy(mdText, '整份报告') }, '复制全文'),
          h('button', { className: 'rt-btn', disabled: busy || !mdText, onClick: () => download(mdText, report.target || eng) }, '下载 .md'),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '生成中…' : '重新生成')),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        h('div', { className: 'rt-r2-scroll' },
          h('section', { className: 'rt-r2-section', id: 'rt-r2-assets' },
            h('h2', { className: 'rt-r2-h2' }, '一、模块与服务归属证明'),
            proofSection('1.1 对外服务模块归属证明', report.asset_proof && report.asset_proof.internet),
            proofSection('1.2 内部入口模块归属证明', report.asset_proof && report.asset_proof.internal_entry)),
          h('section', { className: 'rt-r2-section', id: 'rt-r2-scores' },
            h('h2', { className: 'rt-r2-h2' }, '二、里程碑得分汇总表'),
            table(['阶段', '计分项', '得分'], (report.stage_summary || []).map((s) => [s.name, s.count, '+' + s.points])),
            (report.stage_summary || []).map(stageSection)),
          h('section', { className: 'rt-r2-section', id: 'rt-r2-repro' },
            h('h2', { className: 'rt-r2-h2' }, '三、里程碑交付复现'),
            h('h3', { className: 'rt-r2-h3' }, '3.1 对外服务模块交付复现'),
            (report.repro && report.repro.internet || []).length === 0 ? h('div', { className: 'rt-r2-empty' }, '无对外服务模块得分项。') : reproList(report.repro.internet, '3.1.', 'internet'),
            h('h3', { className: 'rt-r2-h3' }, '3.2 跨网联调通道交付复现'),
            (report.repro && report.repro.boundary || []).length === 0 ? h('div', { className: 'rt-r2-empty' }, '无跨网联调通道得分项。') : reproList(report.repro.boundary, '3.2.', 'boundary'),
            h('h3', { className: 'rt-r2-h3' }, '3.3 内部服务模块交付复现'),
            (report.repro && report.repro.internal_segments || []).length === 0 ? h('div', { className: 'rt-r2-empty' }, '无内部服务模块得分项。') : reproList(report.repro.internal_segments, '3.3.', 'internal'))))
    }

    function ReportTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const collapse = useCollapse('report:' + eng)

      const load = () => {
        if (!eng) return
        setBusy(true); setMsg(null)
        api({ op: 'scoreReport', engagement: eng }).then((r) => {
          if (!r || r.ok === false) { setBusy(false); setErr((r && r.error) || '生成失败'); return }
          if ((!r.stages || r.stages.length === 0) && (r.items || []).length > 0) {
            api({ op: 'scoreChain', engagement: eng }).then((c) => {
              setBusy(false); setErr(null); setData(Object.assign({}, r, { stages: groupByStage(r.items, c) }))
            }, () => { setBusy(false); setErr(null); setData(r) })
            return
          }
          setBusy(false); setErr(null); setData(r)
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }
      React.useEffect(load, [eng, refreshKey])

      const copy = (text, label) => copyWithFeedback(text, label, (okFlag, message) => {
        setMsg(okFlag ? { ok: message } : { err: message })
      })
      const download = (text, label) => {
        try {
          const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          const safe = String(label || 'score')
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80) || 'score'
          a.download = 'report-' + safe + '.md'
          a.click()
          URL.revokeObjectURL(url)
          setMsg({ ok: '已下载：' + label })
        } catch (e) { setMsg({ err: '下载失败：' + ((e && e.message) || e) }) }
      }

      const items = (data && data.items) || []
      const stages = (data && data.stages) || []
      const summary = (data && data.summary) || null
      const mdText = (data && data.markdown) || ''
      const report = (data && data.report) || null
      if (report !== null) {
        return h(ReportV2, {
          report: report, eng: eng, mdText: mdText, busy: busy, load: load,
          copy: copy, download: download, msg: msg,
        })
      }
      const gapItems = items.filter((x) => x.incomplete === true || (Array.isArray(x.gaps) && x.gaps.length > 0))
      const gapPreview = gapItems.slice(0, 12).map((x) => h('div', {
        key: 'gap' + x.id, className: 'rt-rep-missing', style: { marginBottom: 4 },
      }, '#' + x.seq + ' ' + x.point_name + ' · ' + (x.target || x.asset_ip || '未标目标') + '：'
        + ((x.gaps || []).join('；') || '缺少复现材料')))
      const fullText = mdText
        .replace(/^<a id="[^"]*"><\/a>\s*$/gm, '')
        .replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, '> 证据截图见下方卡片视图或导出包。')
      const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']

      const card = (x) => h('div', { key: 'r' + x.id, className: 'rt-rep' },
        h('div', { className: 'rt-rep-head' },
          h('span', { className: 'rt-rep-idx' }, String(x.seq)),
          h('span', { className: 'rt-rep-name' }, x.point_name),
          h('span', { className: 'rt-flow-pts' }, '+' + x.points + ' 分'),
          x.nth_of_point > 1 ? h('span', { className: 'rt-tag' }, '同类第 ' + x.nth_of_point + ' 次') : null,
          h('div', { className: 'rt-spacer' }),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: () => copy((x.requests || []).map((v) => v.request || '').filter(Boolean).join('\n\n'), '第 ' + x.seq + ' 项请求'),
          }, '复制请求')),
        h('div', { className: 'rt-rep-meta' },
          h('span', null, h('b', null, '目标 ')), h('span', { className: 'rt-mono' }, x.target || x.asset_ip || '—')),
        x.gained ? h('div', { className: 'rt-rep-meta' }, h('b', null, '交付 '), h('span', null, x.gained)) : null,
        x.vuln ? h('div', { className: 'rt-rep-meta' }, h('b', null, '关联项 '),
          h('span', null, [x.vuln.cve, x.vuln.title].filter(Boolean).join(' ')
            + (x.vuln_source === 'step' ? '（关联自研发执行步骤）' : ''))) : null,
        x.evidence ? h('div', { className: 'rt-rep-meta' }, h('b', null, '结果 '),
          h('span', null, String(x.evidence).replace(/\n+/g, ' '))) : null,
        x.recorded_at ? h('div', { className: 'rt-rep-meta' }, h('b', null, '取得时间 '),
          h('span', null, fmt(x.recorded_at) + (x.recorded_by ? '（' + (ROLE_LABEL[x.recorded_by] || x.recorded_by) + '）' : ''))) : null,
        h(ShotStrip, { eng: eng, shots: x.shots, total: x.shot_total, title: '证据截图' }),
        h('details', { className: 'rt-rep-trace', open: x.incomplete === true || (x.steps || []).length === 0 },
          h('summary', { className: 'rt-rep-trace-head', style: { cursor: 'pointer' } },
            h('span', { className: 'rt-rep-trace-title' }, '复现步骤（点击展开）'),
            (x.steps || []).length ? h('span', { className: 'rt-tag' }, (x.steps || []).length + ' 个动作') : null,
            (x.credentials || []).length ? h('span', { className: 'rt-tag' }, (x.credentials || []).length + ' 条凭据') : null,
            (x.tunnels || []).length ? h('span', { className: 'rt-tag' }, (x.tunnels || []).length + ' 条通道') : null,
            x.incomplete ? h('span', { className: 'rt-tag rt-tag-warn' }, '复现材料待补') : h('span', { className: 'rt-tag rt-tag-live' }, '可复现')),
          h('div', { style: { paddingTop: 6 } },
            x.how ? h('div', { className: 'rt-rep-trace-how' }, x.how) : null,
            (x.steps || []).length === 0
              ? h('div', { className: 'rt-rep-missing' },
                  '本条未关联动作步骤，复现入口见上方「复现」。需要补记动作时用 redteam_chain_add（title / detail / tool / result），记分时也可带 point_code + evidence 一次完成。')
              : (x.steps || []).map((s, si) => h('div', { key: 's' + s.id, className: 'rt-rep-step' },
                  h('div', { className: 'rt-rep-step-head' },
                    h('span', { className: 'rt-rep-step-no' }, String(si + 1)),
                    h('span', { className: 'rt-rep-step-title' }, s.title || '(未命名动作)'),
                    s.agent ? h('span', { className: 'rt-tag' }, ROLE_LABEL[s.agent] || s.agent) : null,
                    s.stage_code ? h('span', { className: 'rt-tag' }, s.stage_code) : null,
                    s.inferred ? h('span', { className: 'rt-tag' }, '按同模块推断') : null,
                    h('div', { className: 'rt-spacer' }),
                    s.recorded_at ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, fmt(s.recorded_at)) : null),
                  s.detail ? h('div', { className: 'rt-rep-step-detail' }, s.detail) : null,
                  h('div', { className: 'rt-rep-step-cmd' },
                    h('b', null, '执行 '),
                    s.tool
                      ? h('span', { className: 'rt-mono' }, s.tool)
                      : h('span', { style: { color: 'var(--dsw-alias-state-warn-primary, #f59e0b)' } }, '未记录实际命令（redteam_chain_add 的 tool）')),
                  s.tool ? h('div', { style: { marginTop: 3 } },
                    h('button', {
                      className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
                      onClick: () => copy(String(s.tool), '第 ' + (si + 1) + ' 步命令'),
                    }, '复制命令')) : null,
                  s.result ? h('div', { className: 'rt-rep-step-result' }, h('b', null, '结果 '), String(s.result).replace(/\n+/g, ' ')) : null,
                  s.evidence_ref ? h('div', { className: 'rt-rep-step-result' }, h('b', null, '证据 '), h('span', { className: 'rt-mono' }, s.evidence_ref)) : null)),
            (x.credentials || []).length
              ? h('div', { className: 'rt-rep-src' },
                  h('div', { className: 'rt-rep-src-title' }, '关联凭据（来源可追溯）'),
                  (x.credentials || []).map((c) => h('div', { key: 'c' + c.id, className: 'rt-kv' },
                    h('b', { className: 'rt-mono', style: { minWidth: 120 } }, c.host || '—'),
                    h('span', null, (c.username || '(无用户名)') + ' / ' + (c.secret_type || 'password')
                      + (c.privilege ? ' · 权限 ' + c.privilege : '')
                      + ' · 来源 ' + (c.source || '未标注')
                      + (c.tool ? ' · 取得方式 ' + String(c.tool).replace(/\n+/g, ' ').slice(0, 160) : '')))))
              : null,
            (x.tunnels || []).length
              ? h('div', { className: 'rt-rep-src' },
                  h('div', { className: 'rt-rep-src-title' }, '用到的联调通道'),
                  (x.tunnels || []).map((t) => h('div', { key: 't' + t.id, className: 'rt-kv' },
                    h('b', { className: 'rt-mono', style: { minWidth: 120 } }, (t.kind || 'socks5') + ' ' + (t.listen || '')),
                    h('span', null, '入口 ' + (t.entry || '未登记')
                      + (t.reach ? ' · 可达 ' + t.reach : '')
                      + ' · 目标侧 ' + (t.entry_kind || '未声明')
                      + (t.status ? ' · ' + t.status : '')
                      + (t.command ? ' · 命令 ' + String(t.command).replace(/\n+/g, ' ').slice(0, 160) : '')))))
              : null,
            (x.webshells || []).length
              ? h('div', { className: 'rt-rep-src' },
                  h('div', { className: 'rt-rep-src-title' }, '用到的服务端点'),
                  (x.webshells || []).map((w) => h('div', { key: 'w' + w.id, className: 'rt-kv' },
                    h('b', { className: 'rt-mono', style: { minWidth: 120 } }, w.shell_type || 'endpoint'),
                    h('span', null, (w.url || ''),
                      w.pass_key ? h(React.Fragment, null, ' · 口令/密钥 ', h(SecretText, { value: w.pass_key })) : null,
                      (w.privilege ? ' · 权限 ' + w.privilege : '') + (w.status ? ' · ' + w.status : '')))))
              : null,
            (x.attack_files || []).length
              ? h('div', { className: 'rt-rep-src' },
                  h('div', { className: 'rt-rep-src-title' }, '构建脚本（可复现路径）'),
                  (x.attack_files || []).map((f) => h('div', { key: 'f' + f.id, className: 'rt-kv' },
                    h('b', { className: 'rt-mono', style: { minWidth: 120 } }, f.name || '文件'),
                    h('span', null,
                      (f.kind ? ' · ' + f.kind : '')
                      + (f.description ? ' · ' + f.description : '')
                      + ' · ',
                      h('span', { className: 'rt-mono' }, f.path || '')))))
              : null,
            (x.gaps || []).length ? h('div', { className: 'rt-rep-missing' }, '复现材料：' + x.gaps.join('；')) : null),
          (x.requests || []).length === 0
            ? h('div', { className: 'rt-rep-missing' }, '本条没有原始 HTTP 报文（该成果经命令行/其他协议取得，复现入口见上方「复现步骤」）')
            : (x.requests || []).map((r, ri) => h('div', { key: 'q' + ri, className: 'rt-rep-req' },
                h('div', { className: 'rt-rep-req-head' },
                  h('span', null, '复现请求 ' + (ri + 1) + (r.source === 'auto' ? '（按目标路径自动匹配，请核对）' : '')),
                  h('span', { className: 'rt-tag' }, (r.method || 'GET') + ' ' + (r.status === null || r.status === undefined ? '' : r.status)),
                  h('div', { className: 'rt-spacer' }),
                  h('button', {
                    className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
                    onClick: () => copy(String(r.request || ''), '请求 ' + (ri + 1)),
                  }, '复制请求报文')),
                h('pre', { className: 'rt-rep-http' }, r.request || ((r.method || 'GET') + ' ' + (r.url || '') + ' HTTP/1.1')),
                r.response ? h('div', null,
                  h('div', { className: 'rt-rep-req-head' }, h('span', null, '响应摘要')),
                  h('pre', { className: 'rt-rep-http', style: { maxHeight: 160 } }, String(r.response).slice(0, 1600))) : null)),
          x.note ? h('div', { className: 'rt-rep-meta' }, h('b', null, '备注 '), h('span', null, x.note)) : null))

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, 'LMTAgent 研发交付报告（四段式）'),
          summary ? h('span', { className: 'rt-tag rt-tag-live' }, '合计 ' + summary.points + ' 分') : null,
          summary ? h('span', { className: 'rt-tag' }, summary.count + ' 项得分') : null,
          summary ? h('span', { className: 'rt-tag' + (summary.missingRequests ? '' : ' rt-tag-live') },
            summary.withRequests + '/' + summary.count + ' 项带原始请求') : null,
          summary ? h('span', {
            className: 'rt-tag' + (summary.incomplete ? ' rt-tag-warn' : ' rt-tag-live'),
            title: '复现链是否完整：有执行步骤、写了实际命令、关联了缺陷/凭据/通道',
          }, '可复现 ' + (summary.count - (summary.incomplete || 0)) + '/' + summary.count) : null,
          summary && summary.serviceCappedExcluded
            ? h('span', {
                className: 'rt-tag rt-tag-warn',
                title: (summary.serviceCapped || []).map((x) => (x.service || '') + '｜' + (x.point_name || '')).join('\n')
                  || '同一模块同一端口的重复命中：服务已拿满，不计分、不进报告',
              }, '同服务已拿满不计分 ' + summary.serviceCappedExcluded)
            : null,
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy || !mdText, onClick: () => copy(mdText, '整份报告') }, '复制全文'),
          h('button', { className: 'rt-btn', disabled: busy || !mdText, onClick: () => download(mdText, (data && data.target) || eng) }, '下载 .md'),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '生成中…' : '重新生成')),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        err ? h('div', { className: 'rt-err' }, err) : null,
        gapItems.length
          ? h('details', {
              className: 'rt-rep-gaps',
              style: { margin: '0 0 8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: '6px 8px' },
            },
              h('summary', { style: { cursor: 'pointer', fontWeight: 600 } },
                '复现缺口 ' + gapItems.length + ' 项（点击看要补什么）'),
              h('div', { style: { marginTop: 6, maxHeight: 220, overflow: 'auto' } },
                gapPreview,
                gapItems.length > 12
                  ? h('div', { className: 'rt-foot' }, '仅列前 12 项；其余见下方每条卡片与导出的报告。')
                  : null))
          : h('div', { className: 'rt-foot', style: { marginBottom: 6 } }, '复现材料已齐：每条都有步骤/命令或原始请求。'),
        h('div', { className: 'rt-body', style: { overflow: 'auto' } },
          h('details', { className: 'rt-rep-full', style: { margin: '0 0 10px' } },
            h('summary', { className: 'rt-rep-trace-head', style: { cursor: 'pointer', fontWeight: 600 } },
              '详细报告查看（架构归属 / 里程碑汇总 / 凭据汇总 / 交付复现）'),
            h('div', { className: 'rt-rep-full-body' },
              h('div', { className: 'rt-rep-full-head' },
                h('span', { style: { fontWeight: 600 } }, '详细报告查看 · 全屏预览'),
                h('div', { className: 'rt-spacer' }),
                h('button', {
                  className: 'rt-btn',
                  onClick: (e) => {
                    const d = e.currentTarget.closest('details')
                    if (d) d.open = false
                  },
                }, '关闭')),
              h('div', { className: 'rt-foot', style: { padding: '4px 0' } },
                '这是下载/导出的同一份 Markdown；截图请在卡片视图或导出包查看。'),
              h(Markdown, { className: 'rt-markdown', text: fullText }))),
          stages.length
            ? h('div', { className: 'rt-rep-list' },
                h('div', { className: 'rt-rep-tools' },
                  h('button', { className: 'rt-btn', onClick: () => collapse.setAll(stages.map((s) => 'st:' + s.code), true) }, '全部展开'),
                  h('button', { className: 'rt-btn', onClick: () => collapse.setAll(stages.map((s) => 'st:' + s.code), false) }, '全部折叠')),
                stages.map((st) => {
                  const open = collapse.isOpen('st:' + st.code, false)
                  const toggle = collapse.toggle('st:' + st.code, false)
                  return h('div', { key: 'g' + st.code, className: 'rt-rep-group' },
                    h('div', {
                      className: 'rt-rep-stage', role: 'button', tabIndex: 0,
                      style: { borderLeftColor: st.color },
                      'aria-expanded': open ? 'true' : 'false',
                      onClick: toggle,
                      onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e) } },
                    },
                      h('span', { className: 'rt-sec-caret' }, open ? '▾' : '▸'),
                      h('span', { className: 'rt-rep-no', style: { background: st.color } }, CIRCLED[st.ordinal - 1] || st.ordinal),
                      h('span', { className: 'rt-rep-stage-name' }, st.name),
                      h('span', { className: 'rt-rep-stage-n' }, st.items.length + ' 项'),
                      h('div', { className: 'rt-spacer' }),
                      h('span', { className: 'rt-rep-pts', style: { background: st.color + '22', color: st.color, borderColor: st.color + '66' } },
                        '+' + st.points + ' 分'),
                      h('span', { className: 'rt-ap-cum' }, '累计 ' + st.cumulative + ' 分')),
                    open ? h('div', { className: 'rt-rep-body' }, st.items.map(card)) : null)
                }))
            : (data === null ? h('div', { className: 'rt-empty' }, '加载中…')
                : h('div', { className: 'rt-empty' },
                    h('div', null, '还没有可交付的里程碑成果。'),
                    h('div', { style: { marginTop: 6, fontSize: 12 } },
                      '本报告收录已达成的里程碑交付成果；达成后用 redteam_score_hit 记录里程碑得分，并补充 redteam_http_evidence_add 以便复现。')))),
        h('div', { className: 'rt-foot' },
          h('span', null, '口径：收录里程碑交付成果；下载/复制的 Markdown 按「模块归属 → 里程碑汇总 → 配置凭据 → 交付点复现」组织；凭据默认脱敏')))
    }

    /* ---------------------------------------------------------- 构建与验证脚本 */
    const FILE_KIND = { poc: '验证', exp: '自动化', script: '脚本', wordlist: '配置', other: '其他' }

    function AttackFilesTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [folders, setFolders] = React.useState([])
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const collapse = useCollapse('files:' + eng)
      const [detail, setDetail] = React.useState(null)

      const load = () => {
        if (!eng) return
        setBusy(true)
        api({ op: 'attackFiles', engagement: eng }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null)
          setFolders(r.items || [])
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }
      React.useEffect(load, [eng, refreshKey])

      const openFile = (f) => {
        if (detail && detail.id === f.id) { setDetail(null); return }
        setDetail(null)
        api({ op: 'readAttackFile', engagement: eng, id: f.id }).then((r) => {
          if (r && r.ok) setDetail(r)
          else setErr((r && r.error) || '读取失败')
        }, (e) => setErr(String((e && e.message) || e)))
      }

      const rows = []
      for (const folder of folders) {
        const fKey = 'folder:' + folder.folder
        const fileNodes = []
        for (const f of folder.files) {
          fileNodes.push(h('div', {
            key: 'a' + f.id, className: 'rt-vrow', style: { gridTemplateColumns: '18px 1.2fr 60px 1.6fr', cursor: 'pointer' },
            role: 'button', tabIndex: 0,
            onClick: () => openFile(f),
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(f) } },
          },
            h('span', { className: 'rt-sec-caret' }, detail && detail.id === f.id ? '▾' : '▸'),
            h('span', { className: 'rt-mono' }, f.name),
            h('span', null, h('span', { className: 'rt-tag rt-tag-active' }, FILE_KIND[f.kind] || f.kind || '—')),
            h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' }, title: f.description || '' }, f.description || '—')))
          if (!detail || detail.id !== f.id) continue
          fileNodes.push(h('div', {
            key: 'ad' + f.id, className: 'rt-vrow', style: { cursor: 'default', gridTemplateColumns: '1fr' },
          }, h('div', { className: 'rt-vdetail' },
            h('div', { className: 'rt-kv' }, h('b', null, '效果'), h('span', null, detail.evidence || '—')),
            h('div', { className: 'rt-kv' }, h('b', null, '路径'), h('span', { className: 'rt-mono', style: { wordBreak: 'break-all' } }, detail.path)),
            h('div', { className: 'rt-kv' }, h('b', null, '记录'), h('span', null, fmt(detail.created_at) + (detail.created_by ? ' · ' + detail.created_by : ''))),
            /\.md$/i.test(detail.name || detail.path || '')
              ? h(Markdown, {
                  className: 'rt-markdown rt-md-view', text: detail.content || '（空）',
                  style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, maxHeight: '40vh' },
                })
              : h('pre', { className: 'rt-md', style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, maxHeight: '40vh', padding: '10px 12px' } }, detail.content || '（空）'))))
        }
        rows.push(h(Section, {
          key: 'sec:' + folder.folder, tone: 'folder', title: folder.folder + '/',
          count: folder.count + ' 个文件',
          open: collapse.isOpen(fKey, true), onToggle: collapse.toggle(fKey, true),
        }, fileNodes.length ? fileNodes : h('div', { className: 'rt-atest-meta' }, '（空）')))
      }

      const total = folders.reduce((n, f) => n + f.count, 0)
      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '构建与验证脚本'),
          h('span', { className: 'rt-tag' }, folders.length + ' 个模块 / ' + total + ' 个文件'),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '刷新中…' : '刷新')),
        err ? h('div', { className: 'rt-err' }, err) : null,
        h('div', { className: 'rt-table' },
          rows,
          !folders.length ? h('div', { className: 'rt-empty' }, '暂无构建与验证脚本（工程化构建与测试脚本会按目标模块文件夹出现在这里）') : null),
        h('div', { className: 'rt-foot' }, h('span', null, '目录：attack-files/<模块|服务>/ ｜ 收录实际生效的构建与验证脚本')))
    }

    /* ---------------------------------------------------------- 工程模式与验证模板库（全局共享） */
    const POC_KIND_LABEL = { poc: '验证用例', exp: '回归脚本', script: '脚本', template: '模板', payload: '测试夹具' }
    const POC_SOURCE_LABEL = { web: '开源社区', self: '自研沉淀', manual: '人工录入', 'nuclei-template': '标准模板', kb: '模式库' }

    function KnowledgeTab(props) {
      const refreshKey = props.refreshKey || 0
      const curEng = props.engagement || ''
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [q, setQ] = React.useState('')
      const [kind, setKind] = React.useState('')
      const [category, setCategory] = React.useState('')
      const [engagement, setEngagement] = React.useState(curEng)
      const [assetTarget, setAssetTarget] = React.useState('')
      const [grouped, setGrouped] = React.useState(true)
      const [verifiedOnly, setVerifiedOnly] = React.useState(true)
      const [openId, setOpenId] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [detailBusy, setDetailBusy] = React.useState(false)

      const query = (over) => {
        const params = Object.assign({
          q: q.trim() || undefined,
          kind: kind || undefined,
          category: category || undefined,
          engagement: engagement || undefined,
          asset_target: assetTarget.trim() || undefined,
          verified: verifiedOnly || undefined,
        }, over || {})
        setBusy(true); setMsg(null)
        api(Object.assign({ op: 'pocSearch' }, params)).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null); setData(r)
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }

      const engRef = React.useRef(curEng)
      React.useEffect(() => {
        query(engRef.current
          ? { q: undefined, kind: undefined, category: undefined, engagement: engRef.current, asset_target: undefined, verified: true }
          : { q: undefined, kind: undefined, category: undefined, engagement: undefined, asset_target: undefined, verified: true })
      }, [refreshKey])

      React.useEffect(() => {
        if (engRef.current === curEng) return
        engRef.current = curEng
        setEngagement(curEng)
        query({ engagement: curEng || undefined })
      }, [curEng])

      const open = (id) => {
        if (openId === id) { setOpenId(null); setDetail(null); return }
        setOpenId(id); setDetail(null); setDetailBusy(true)
        api({ op: 'pocGet', id: id }).then((r) => {
          setDetailBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '读取失败' }); return }
          setDetail(r)
        }, (e) => { setDetailBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const copy = (text, label) => copyWithFeedback(text, label, (okFlag, message) => {
        setMsg(okFlag ? { ok: message } : { err: message })
      })
      const useIt = (row) => {
        api({ op: 'pocUse', id: row.id, used_on: '控制台手动标记' }).then(() => {
          setMsg({ ok: '已记一次复用：' + row.title })
          query()
        }, (e) => setMsg({ err: String((e && e.message) || e) }))
      }

      const stats = (data && data.stats) || { total: 0, verified: 0, reused: 0, byKind: [], bySource: [] }
      const items = (data && data.items) || []
      const tpl = (data && data.templates) || { dir: null, total: 0, items: [] }
      const tplItems = tpl.items || []

      const card = (x) => {
        const isOpen = openId === x.id
        const d = isOpen && detail && detail.id === x.id ? detail : null
        return h('div', { key: 'p' + x.id, className: 'rt-kb' + (isOpen ? ' open' : '') },
          h('div', {
            className: 'rt-kb-head', role: 'button', tabIndex: 0, 'aria-expanded': isOpen ? 'true' : 'false',
            onClick: () => open(x.id),
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(x.id) } },
          },
            h('span', { className: 'rt-sec-caret' }, isOpen ? '▾' : '▸'),
            h('span', { className: 'rt-kb-kind k-' + (x.kind || 'poc') }, POC_KIND_LABEL[x.kind] || x.kind || '模板'),
            h('span', { className: 'rt-kb-title' }, x.title),
            x.cve ? h('span', { className: 'rt-tag rt-tag-passive' }, x.cve) : null,
            x.component ? h('span', { className: 'rt-tag' }, x.component) : null,
            x.verified === 1
              ? h('span', { className: 'rt-tag rt-tag-live' }, '已验证')
              : h('span', { className: 'rt-tag rt-tag-warn' }, '未验证'),
            h('div', { className: 'rt-spacer' }),
            h('span', { className: 'rt-tag' }, POC_SOURCE_LABEL[x.source] || x.source || '—'),
            x.hit_count ? h('span', { className: 'rt-tag' }, '复用 ' + x.hit_count) : null),
          h('div', { className: 'rt-kb-sub' },
            [x.category ? '归类 ' + (POC_CAT_NAME[x.category] || x.category) : null,
              x.versions ? '适用版本 ' + x.versions : null,
              x.language || null,
              x.tags || null,
              '建立时间 ' + fmt(x.created_at),
              (x.engagement_name || x.engagement_id) ? '来源工作区 ' + (x.engagement_name || x.engagement_id) : null,
              x.asset_target ? '关联模块 ' + x.asset_target : null,
              x.found_by_agent ? '沉淀角色 ' + (ROLE_LABEL[x.found_by_agent] || x.found_by_agent) : null,
              x.source_url ? '来源 ' + x.source_url : null].filter(Boolean).join(' · ')),
          isOpen
            ? h('div', { className: 'rt-kb-body' },
                detailBusy && !d ? h('div', { className: 'rt-empty' }, '读取中…') : null,
                d ? h('div', null,
                  d.usage ? h('div', { className: 'rt-kv' }, h('b', null, '用法'), h('span', { className: 'rt-mono' }, d.usage)) : null,
                  d.description ? h('div', { className: 'rt-kv' }, h('b', null, '说明'), h('span', null, d.description)) : null,
                  d.verified_note ? h('div', { className: 'rt-kv' }, h('b', null, '验证证据'), h('span', null, d.verified_note)) : null,
                  d.used_on ? h('div', { className: 'rt-kv' }, h('b', null, '最近使用'), h('span', null, d.used_on)) : null,
                  d.path ? h('div', { className: 'rt-kv' }, h('b', null, '落盘'), h('span', { className: 'rt-mono' }, d.path)) : null,
                  h('div', { className: 'rt-kb-actions' },
                    h('button', { className: 'rt-btn', disabled: !d.content, onClick: () => copy(d.content || '', '模板正文') }, '复制正文'),
                    h('button', { className: 'rt-btn', onClick: () => useIt(x) }, '记一次复用'),
                    d.source_url ? h('button', { className: 'rt-btn', onClick: () => copy(d.source_url, '来源链接') }, '复制来源') : null),
                  d.content
                    ? h('pre', { className: 'rt-rep-http' }, d.content.length > 12000 ? d.content.slice(0, 12000) + '\n…（已截断，完整内容见落盘文件）' : d.content)
                    : h('div', { className: 'rt-empty' }, '这条只有元数据，没有正文 —— 拿到正文后用 redteam_poc_update 补上'))
                : null)
            : null)
      }

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '工程模式与验证模板库'),
          h('input', {
            className: 'rt-input', style: { flex: '1 1 150px', minWidth: 120 },
            placeholder: '搜 规则编号 / 组件 / 关键字', value: q,
            onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') query() },
          }),
          h('button', { className: 'rt-btn rt-btn-primary', disabled: busy, onClick: () => query() }, busy ? '检索中…' : '检索'),
          h('span', { className: 'rt-tag' }, stats.total + ' 条'),
          h('span', { className: 'rt-tag rt-tag-live' }, '已验证 ' + stats.verified),
          h('span', { className: 'rt-tag' }, '累计复用 ' + (stats.reused || 0)),
          (stats.uncategorized || 0) > 0 && (stats.uncategorized || 0) !== stats.total
            ? h('span', { className: 'rt-tag rt-tag-warn', title: '这些条目还没归类：智能体回填时用 redteam_poc_add 的 category 参数标一下' }, '未归类 ' + stats.uncategorized)
            : null,
          tpl.total ? h('span', { className: 'rt-tag rt-tag-passive' }, '本机模板 ' + tpl.total) : null,
          engagement
            ? h('span', Object.assign({
                className: 'rt-tag rt-tag-live',
                style: { cursor: 'pointer' },
                title: '只看当前工作区沉淀的模式与模板（跟随当前会话）；点一下回到全库',
              }, clickable(() => { setEngagement(''); query({ engagement: undefined }) }, { label: '取消工作区筛选：' + engagement })), '来源工作区 ' + engagement + ' ✕')
            : h('span', { className: 'rt-tag rt-tag-passive', title: '当前显示全部工作区的工程模式库；面板跟随会话后会自动筛到对应项目' }, '全库共享'),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn' + (grouped ? ' rt-btn-primary' : ''), title: '按归类分组显示 / 平铺显示', onClick: () => setGrouped(!grouped) }, grouped ? '按归类分组' : '平铺显示'),
          h('button', { className: 'rt-btn', disabled: busy, onClick: () => query() }, busy ? '检索中…' : '刷新')),
        h('div', { className: 'rt-kb-cats' },
          (stats.byCategory || []).filter((c) => c.n > 0).map((c) => h('span', Object.assign({
            key: c.code,
            className: 'rt-concl-i' + (category === c.code ? ' on' : ''),
            title: c.hint || ('筛选：' + (POC_CAT_NAME[c.code] || c.code)),
          }, clickable(() => {
            const next = category === c.code ? '' : c.code
            setCategory(next)
            query({ category: next || undefined })
          }, { label: '筛选归类：' + (POC_CAT_NAME[c.code] || c.code), expanded: category === c.code })),
            h('b', null, String(c.n || 0)),
            h('span', null, (POC_CAT_NAME[c.code] || c.code) + (c.verified ? '（已验证 ' + c.verified + '）' : ''))))),
        h('div', { className: 'rt-kb-filter' },
          h('input', {
            className: 'rt-input', style: { flex: 1, minWidth: 140 }, placeholder: '搜 规则编号 / 组件 / 关键字（正文也会搜）',
            value: q, onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') query() },
          }),
          h('select', { className: 'rt-input', style: { maxWidth: 120 }, value: category, onChange: (e) => { setCategory(e.target.value); query({ category: e.target.value || undefined }) } },
            h('option', { value: '' }, '全部归类'),
            POC_CAT_ORDER.map((k) => h('option', { key: k, value: k }, POC_CAT_NAME[k]))),
          h('input', {
            className: 'rt-input', style: { maxWidth: 160 }, list: 'rt-kb-engs',
            placeholder: '来源工作区（可搜索）', value: engagement,
            title: '输入工作区名筛选，回车或点「检索」生效；清空 = 全部来源',
            onChange: (e) => setEngagement(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') query({ engagement: engagement || undefined }) },
          }),
          h('datalist', { id: 'rt-kb-engs' },
            h('option', { value: '' }, '全部来源工作区'),
            (engagement && !(stats.byEngagement || []).some((e) => e.engagement === engagement)
              ? [h('option', { key: '__cur', value: engagement }, engagement + '（0）')]
              : []),
            (stats.byEngagement || []).map((e) => h('option', { key: e.engagement, value: e.engagement }, e.engagement + '（' + e.n + '）'))),
          h('input', {
            className: 'rt-input', style: { width: 120 }, placeholder: '关联模块筛选',
            value: assetTarget, onChange: (e) => setAssetTarget(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') query() },
          }),
          h('select', { className: 'rt-input', style: { maxWidth: 110 }, value: kind, onChange: (e) => { setKind(e.target.value); query({ kind: e.target.value || undefined }) } },
            h('option', { value: '' }, '全部类型'),
            Object.keys(POC_KIND_LABEL).map((k) => h('option', { key: k, value: k }, POC_KIND_LABEL[k]))),
          h('label', { className: 'rt-kb-check' },
            h('input', { type: 'checkbox', checked: verifiedOnly, onChange: (e) => { setVerifiedOnly(e.target.checked); query({ verified: e.target.checked || undefined }) } }),
            '只看已验证'),
          h('button', { className: 'rt-btn rt-btn-primary', onClick: () => query() }, '检索')),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        err ? h('div', { className: 'rt-err' },
          /engagement required|unknown op/i.test(err)
            ? '工程模式库接口由 host 侧提供，当前 dsh web 还是旧进程 —— 请重启 dsh web（dsh-restart）后刷新页面。'
            : err) : null,
        h('div', { className: 'rt-table' },
          (() => {
            if (!grouped) return items.map(card)
            const buckets = new Map()
            for (const x of items) {
              const code = POC_CAT_NAME[x.category] ? x.category : 'other'
              if (!buckets.has(code)) buckets.set(code, [])
              buckets.get(code).push(x)
            }
            const order = POC_CAT_ORDER.filter((c) => buckets.has(c))
            for (const code of buckets.keys()) if (!order.includes(code)) order.push(code)
            const out = []
            for (const code of order) {
              const list = buckets.get(code)
              out.push(h('div', { key: 'g' + code, className: 'rt-kb-cat' },
                h('span', { className: 'rt-kb-cat-name' }, POC_CAT_NAME[code] || code),
                h('span', { className: 'rt-tag' }, list.length + ' 条'),
                h('span', { className: 'rt-tag rt-tag-live' }, '已验证 ' + list.filter((x) => x.verified === 1).length),
                h('span', { className: 'rt-spacer' }),
                h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                  '最近建立 ' + fmt(list.map((x) => x.created_at).filter(Boolean).sort().pop()))))
              for (const x of list) out.push(card(x))
            }
            return out
          })(),
          tplItems.length
            ? h('div', { className: 'rt-kb-tpl' },
                h('div', { className: 'rt-ap-sub' },
                  '本机标准模板命中 · ' + tplItems.length + ' 条'),
                tplItems.map((t, i) => h('div', { key: 't' + i, className: 'rt-kb-tpl-row' },
                  h('span', { className: 'rt-tag' }, t.severity || '—'),
                  h('span', { className: 'rt-mono rt-kb-tpl-path', title: t.path }, t.path),
                  h('span', { className: 'rt-kb-tpl-name', title: t.name }, t.name || ''),
                  h('button', {
                    className: 'rt-btn', style: { padding: '0 6px', fontSize: 10.5 },
                    onClick: () => copy(t.path, '模板路径'),
                  }, '复制路径'))),
                tpl.dir ? h('div', { className: 'rt-foot' }, h('span', null, '模板目录：' + tpl.dir)) : null)
            : null,
          data === null ? h('div', { className: 'rt-empty' }, '加载中…') : null,
          data !== null && !items.length && !tplItems.length
            ? h('div', { className: 'rt-empty' },
                h('div', null, q || kind || verifiedOnly ? '没有命中：换个关键字再试，或沉淀新的工程模式后回填。' : '工程模式库还是空的。'),
                h('div', { style: { marginTop: 6, fontSize: 12 } },
                  '标准研发复用流程：① redteam_poc_search 先检索已沉淀模式与验证模板 → ② 研发或回归验证通过后调用 redteam_poc_add 回填，后续项目可直接复用。'))
            : null),
        h('div', { className: 'rt-foot' },
          h('span', null, '全局共享（跨工作区）｜ 落盘：pocs/<code>/ ｜ 收录通用可复用的架构模式与验证模板，模块专用脚本走「构建脚本」')))
    }

    /* ---------------------------------------------------------- 交付里程碑 */
    function ScoreTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [openId, setOpenId] = React.useState(null)
      const [scoreView, setScoreView] = React.useState('achieved')
      const [form, setForm] = React.useState(null)
      const [msg, setMsg] = React.useState(null)

      const load = () => {
        if (!eng) return
        setBusy(true)
        api({ op: 'scores', engagement: eng }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null)
          setData(r)
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }
      React.useEffect(load, [eng, refreshKey])

      const startEdit = (p) => setForm({
        id: p.id, name: p.name, category: p.category || '', points: p.points,
        description: p.description || '', enabled: p.enabled, builtin: p.builtin === true,
        src: p.src, cap: p.cap, rule: p.rule,
      })
      const startNew = () => { setForm({ name: '', category: '', points: 10, description: '', enabled: true, builtin: false }); setMsg(null) }
      const setField = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }))

      const save = () => {
        if (!form || !form.name) { setMsg({ err: '名称不能为空' }); return }
        setBusy(true)
        setMsg(null)
        api({ op: 'saveScorePoint', engagement: eng, point: form }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '保存失败' }); return }
          if (r.overridden === false) {
            setMsg({ err: '已保存「启用/停用」。分值未改动：这是随《软件工程 4-Wave 交付质量门禁规范》分发的内置里程碑项，'
              + '权重 / 上限 / 验收口径由规范锁定。要自定义里程碑项时请「+ 新增里程碑」。' })
          } else {
            setMsg({ ok: r.note || '已保存' })
          }
          setForm(null)
          load()
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }
      const remove = () => {
        if (!form || !form.id) { setForm(null); return }
        setBusy(true)
        setMsg(null)
        api({ op: 'deleteScorePoint', engagement: eng, id: form.id }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '删除失败' }); return }
          setMsg({ ok: '已删除' })
          setForm(null)
          setOpenId(null)
          load()
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const summary = (data && data.summary) || { achievedPoints: 0, pointCount: 0, hitPointCount: 0, hitCount: 0, selfCreatedHits: 0, serviceCappedHits: 0 }
      const items = (data && data.items) || []

      const groups = (data && data.ruleGroups && data.ruleGroups.length)
        ? data.ruleGroups
        : [{ key: 'all', name: '', capSum: 0, points: 0, counted: 0, tiers: items }]
      const tierFull = (p) => p.cap > 0 && (Number(p.cap_used) || 0) >= Number(p.cap)
      const tierAchieved = (p) => (Array.isArray(p.hits) && p.hits.length > 0)
        || (Number(p.earned) || 0) > 0 || (Number(p.counted) || 0) > 0
      const scoreRank = (p) => (tierFull(p) ? 1 : 0)
      const scoreCmp = (a, b) => scoreRank(a) - scoreRank(b)
        || (Number(b.points) || 0) - (Number(a.points) || 0)
        || (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
      const orderedGroups = groups.map((g) => Object.assign({}, g, {
        tiers: g.tiers.slice().sort(scoreCmp),
      }))
      const groupGap = (g) => (g.tiers.some((p) => !tierFull(p)) ? 0 : 1)
      const groupMax = (g) => g.tiers.reduce((m, p) => Math.max(m, Number(p.points) || 0), 0)
      orderedGroups.sort((a, b) => groupGap(a) - groupGap(b) || groupMax(b) - groupMax(a))
      const shortName = (name) => {
        const base = String(name || '').split(' / ')[0]
        return base.length > 22 ? base.slice(0, 22) + '…' : base
      }
      const gapGroups = []
      let gapLeft = 8
      for (const g of orderedGroups) {
        const tiers = g.tiers.filter((p) => !tierFull(p))
        if (!tiers.length) continue
        const take = tiers.slice(0, gapLeft)
        gapGroups.push(Object.assign({}, g, { tiers: take }))
        gapLeft -= take.length
        if (gapLeft <= 0) break
      }
      const achievedGroups = orderedGroups
        .map((g) => Object.assign({}, g, { tiers: g.tiers.filter(tierAchieved) }))
        .filter((g) => g.tiers.length > 0)
      const displayGroups = scoreView === 'achieved'
        ? achievedGroups
        : scoreView === 'gap'
          ? gapGroups
          : orderedGroups
      const rows = []
      for (const g of displayGroups) {
        if (g.name) {
          rows.push(h('div', { key: 'g-' + g.key, className: 'rt-score-group' },
            h('span', null, g.name),
            h('span', { className: 'rt-sg-sub' },
              g.tiers.length + ' 项'
              + (g.capSum > 0 ? ' · 上限独立，不跨项累加' : '')),
            h('div', { className: 'rt-spacer' }),
            g.points > 0
              ? h('span', { className: 'rt-tag rt-tag-active' }, '+' + g.points + ' 分')
              : null))
        }
        for (const p of g.tiers) {
          const achieved = p.hits.length > 0
          const open = openId === p.id
          rows.push(h('div', {
            key: 'sp' + p.id, className: 'rt-score-row', role: 'button', tabIndex: 0,
            onClick: () => setOpenId(open ? null : p.id),
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(open ? null : p.id) } },
          },
            h('span', { className: 'rt-sec-caret' }, open ? '▾' : '▸'),
            h('span', null, h('span', {
              className: achieved ? 'rt-pri rt-pri-high' : 'rt-pri rt-pri-low',
              style: achieved ? {} : { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)' },
            }, p.points + '分')),
            h('span', { title: p.name + (p.description ? '\n' + p.description : '') },
              shortName(p.name)),
            h('span', { title: p.capped > 0
              ? '已计入 ' + p.counted + ' 次，另有 ' + p.capped + ' 条因「' + (p.scope_label || '验收口径') + '」或已达上限不计分'
              : (p.scope_label || '') },
              h('span', { className: 'rt-sec-count' }, p.hits.length > 0 ? p.counted + ' 次达成' : '未达成'),
              p.cap > 0
                ? h('span', { className: 'rt-scope' }, '　额度已用 ' + (p.cap_used === null ? 0 : p.cap_used) + '/' + p.cap)
                : null),
            h('span', { style: { textAlign: 'right' } }, p.earned > 0
              ? h('span', { className: 'rt-tag rt-tag-active' }, '+' + p.earned + ' 分')
              : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '—'))))
          if (!open) continue
          const hitNodes = p.hits.map((hh, hi) => h('div', {
            key: 'h' + hh.id,
            className: 'rt-hit-row' + (hh.self_created ? ' self-created' : '') + (hh.capped ? ' service-capped' : ''),
          },
            h('span', { className: 'rt-hit-idx' }, String(hi + 1)),
            h('span', { className: 'rt-hit-asset', title: hh.target || hh.asset_ip || '' },
              hh.asset_ip || hh.target || '未指定模块'),
            hh.self_created ? h('span', { className: 'rt-tag rt-tag-warn', title: '自建测试环境记录，只作过程留痕' }, '测试记录 · 不计分') : null,
            hh.capped ? h('span', {
              className: 'rt-tag rt-tag-warn',
              title: hh.capped_reason || '同一模块同一服务端点只计最高权重一条',
            }, '模块已封顶 · 不计分' + (hh.service ? '（' + hh.service + '）' : '')) : null,
            hh.shot_count ? h('span', { className: 'rt-tag', title: '这条记录附有验收截图' },
              '图 ' + hh.shot_count) : null,
            h('span', { className: 'rt-hit-time' }, fmt(hh.recorded_at)),
            h('button', {
              className: 'rt-btn', style: { padding: '0 5px', fontSize: 10.5 },
              title: '复制这一条',
              onClick: (e) => {
                e.stopPropagation()
                copyText((hh.asset_ip || hh.target || '') + '  ' + (hh.evidence || ''))
              },
            }, '复制'),
            hh.evidence
              ? h('span', { className: 'rt-hit-txt', title: hh.evidence }, String(hh.evidence).replace(/\n+/g, ' '))
              : h('span', { className: 'rt-hit-txt none' }, '未填验收摘要')))
          rows.push(h('div', {
            key: 'spd' + p.id, className: 'rt-score-row',
            style: { cursor: 'default', gridTemplateColumns: '1fr' },
          }, h('div', { className: 'rt-score-detail' },
            p.description ? h('div', { className: 'rt-kv' }, h('b', null, '验收条件'), h('span', null, p.description)) : null,
            h('div', { className: 'rt-kv' }, h('b', null, '状态'),
              h('span', null, (p.enabled ? '启用' : '停用') + ' · ' + p.points + ' 分/次 · 达成 ' + p.hits.length +
                ' 次 = ' + p.earned + ' 分' + (p.self_created ? '（另有 ' + p.self_created + ' 次测试记录不计分）' : '') +
                (p.capped ? '（另有 ' + p.capped + ' 次同模块重复达成不计分）' : ''))),
            p.capped
              ? h('div', { className: 'rt-kv' }, h('b', null, '模块封顶'),
                  h('span', null, p.service_summary + '；同一模块与服务端点按最高里程碑权重只计一次'))
              : null,
            p.hits.length
              ? h('div', null,
                  h(ShotStrip, { eng: eng, shots: p.shots, total: p.shot_total,
                    title: '验收截图 · ' + (p.shot_total || (p.shots || []).length) + ' 张' }),
                  h('div', { className: 'rt-section', style: { padding: '6px 0 0' } },
                    '达成记录 · ' + p.hits.length + '（详细验证见交付报告）'),
                  h('div', { className: 'rt-hits' }, hitNodes))
              : h('div', { className: 'rt-kv' }, h('b', null, '达成记录'),
                  h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                    '还没有 —— 完成里程碑验收后调用 redteam_score_hit 记录目标模块与验证证据')),
            h('div', { className: 'rt-actions' },
              h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); startEdit(p) } }, '编辑')))))
        }
      }

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '交付里程碑'),
          h('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginLeft: 4 } }, '总分'),
          h('span', { className: 'rt-total' }, String(summary.achievedPoints)),
          h('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, '分'),
          h('span', { className: 'rt-tag' }, summary.pointCount + ' 个里程碑项'),
          h('span', { className: 'rt-tag' }, '达成 ' + summary.countedHits + ' 次'),
          summary.selfCreatedHits
            ? h('span', {
                className: 'rt-tag rt-tag-warn',
                title: '自建测试记录只作过程留痕（不计分、不占上限）',
              }, '测试记录不计分 ' + summary.selfCreatedHits)
            : null,
          summary.serviceCappedHits
            ? h('span', {
                className: 'rt-tag rt-tag-warn',
                title: '按「同模块同端口」只计一次：该服务已封顶，重复记录不计分',
              }, '服务已封顶不计分 ' + summary.serviceCappedHits)
            : null,
          h('div', { className: 'rt-spacer' }),
          h('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
            h('button', {
              className: 'rt-btn' + (scoreView === 'achieved' ? ' rt-btn-primary' : ''),
              title: '只显示已经达成的里程碑项',
              onClick: () => setScoreView('achieved'),
            }, '已达成' + (summary.hitPointCount ? ' ' + summary.hitPointCount : '')),
            h('button', {
              className: 'rt-btn' + (scoreView === 'gap' ? ' rt-btn-primary' : ''),
              title: '只显示未达成的核心里程碑缺口（前 8 项）',
              onClick: () => setScoreView('gap'),
            }, '待交付缺口'),
            h('button', {
              className: 'rt-btn' + (scoreView === 'all' ? ' rt-btn-primary' : ''),
              title: '显示全部 ' + items.length + ' 个里程碑项',
              onClick: () => setScoreView('all'),
            }, '全部 ' + items.length)),
          h('button', { className: 'rt-btn', onClick: startNew }, '+ 新增里程碑'),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '刷新中…' : '刷新')),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        err ? h('div', { className: 'rt-err' }, err) : null,
        form ? h('div', { className: 'rt-pane', style: { flex: 'none', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
          form.builtin
            ? h('div', { className: 'rt-hint', style: { marginBottom: 8 } },
                h('b', null, '内置里程碑项（来自《软件工程 4-Wave 交付质量门禁规范》）'),
                h('div', { style: { marginTop: 3 } },
                  '权重、上限、验收口径与名称由规范锁定。这里可以改「启用 / 停用」；'
                  + '要自定义里程碑项时请返回上一屏点「+ 新增里程碑」。'),
                form.src !== null && form.src !== undefined
                  ? h('div', { style: { marginTop: 3, color: 'var(--dsw-alias-label-secondary)' } },
                      '规范序号 ' + form.src + (form.rule ? '　·　分组 rule=' + form.rule : '')
                      + (form.cap > 0 ? '　·　上限 ' + form.cap + ' 分' : '　·　不设上限'))
                  : null)
            : null,
          h('div', { className: 'rt-score-form' },
            h('input', {
              className: 'rt-input', placeholder: '名称（必填）', value: form.name,
              readOnly: form.builtin === true,
              title: form.builtin ? '内置里程碑项的名称由规范锁定' : '',
              onChange: (e) => setField('name', e.target.value),
            }),
            h('input', {
              className: 'rt-input', placeholder: '分类，如 架构与核心模块', value: form.category,
              readOnly: form.builtin === true,
              title: form.builtin ? '内置里程碑项的分类由规范锁定' : '',
              onChange: (e) => setField('category', e.target.value),
            }),
            h('input', {
              className: 'rt-input', type: 'number', placeholder: '单次权重',
              readOnly: form.builtin === true,
              title: form.builtin
                ? '内置里程碑项的分值由规范锁定，不能在这里改'
                : '这一类的单次权重分值',
              value: form.points, onChange: (e) => setField('points', Number(e.target.value)),
            }),
            h('select', { className: 'rt-input', value: form.enabled ? '1' : '0', onChange: (e) => setField('enabled', e.target.value === '1') },
              h('option', { value: '1' }, '启用'),
              h('option', { value: '0' }, '停用'))),
          h('input', {
            className: 'rt-input', style: { width: '100%', marginBottom: 6, boxSizing: 'border-box' },
            placeholder: '验收条件说明', value: form.description,
            readOnly: form.builtin === true,
            title: form.builtin ? '内置里程碑项的条款正文由规范锁定' : '',
            onChange: (e) => setField('description', e.target.value),
          }),
          h('div', { className: 'rt-actions' },
            h('button', { className: 'rt-btn rt-btn-primary', disabled: busy, onClick: save }, '保存'),
            form.id
              ? (form.builtin
                  ? h('button', {
                      className: 'rt-btn', disabled: true,
                      title: '内置里程碑项不能删除，要让它不参与计分请改用「停用」。',
                    }, '删除（内置项不可删）')
                  : h('button', { className: 'rt-btn', disabled: busy, onClick: remove }, '删除'))
              : null,
            h('button', { className: 'rt-btn', onClick: () => setForm(null) }, '取消'))) : null,
        h('div', { className: 'rt-foot', style: { padding: '2px 12px 0' } },
          scoreView === 'achieved'
            ? (achievedGroups.length
                ? '默认只显示已经达成的里程碑项（' + summary.hitPointCount + ' 项）；待交付缺口 / 完整列表可切换。'
                : '还没有已达成的里程碑项；切到「待交付缺口」查看待推进目标。')
            : scoreView === 'gap'
              ? '只显示未拿满的前 8 项；完整 ' + items.length + ' 项点「全部」。'
              : '完整 ' + items.length + ' 个里程碑项。'),
        h('div', { className: 'rt-table' },
          h('div', { className: 'rt-score-row head' },
            h('span', null, ''), h('span', null, '分值'), h('span', null, scoreView === 'achieved' ? '已达成项目' : scoreView === 'gap' ? '待交付缺口' : '全部里程碑项'),
            h('span', null, '达成 / 规范上限'), h('span', { style: { textAlign: 'right' } }, '已得分')),
          rows,
          !items.length ? h('div', { className: 'rt-empty' }, '暂无里程碑项，点右上角「新增里程碑」') : null,
          items.length && !rows.length ? h('div', { className: 'rt-empty' }, scoreView === 'achieved' ? '还没有已达成的里程碑项；点「待交付缺口」查看下一步目标。' : '当前视图没有可显示的里程碑项。') : null))
    }

    /* ---------------------------------------------------------- 当前验证（实时） */
    const TEST_STATUS_LABEL = {
      untested: '待验证', testing: '验证中', tested: '已验证',
      blocked: '受阻', abandoned: '已跳过', no_surface: '无需验证',
    }

    function TestingTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [at, setAt] = React.useState(null)
      const [auto, setAuto] = React.useState(true)
      const collapse = useCollapse('testing:' + eng)

      const inflight = React.useRef(false)
      const seq = React.useRef(0)
      const load = () => {
        if (!eng || inflight.current) return
        inflight.current = true
        const my = ++seq.current
        api({ op: 'activeTests', engagement: eng, limit: 20 }).then((r) => {
          if (my !== seq.current) return
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null); setData(r); setAt(new Date())
        }, (e) => { if (my === seq.current) setErr(String((e && e.message) || e)) })
          .finally(() => { if (my === seq.current) inflight.current = false })
      }
      React.useEffect(() => { seq.current += 1; load() }, [eng, refreshKey])
      React.useEffect(() => {
        if (!eng || !auto) return undefined
        const timer = setInterval(load, 5000)
        return () => clearInterval(timer)
      }, [eng, auto, refreshKey])

      const testing = (data && data.testing) || []
      const recent = (data && data.recent) || []
      const queue = (data && data.queue) || []
      const stats = (data && data.stats) || {}

      const card = (a, past) => {
        const chips = []
        chips.push(h('span', { key: 'sc', className: 'rt-scope rt-scope-' + (a.scope === 'internal' ? 'internal' : 'external') },
          a.scope === 'internal' ? '核心模块' : '外部接口'))
        if (a.segment_cidr) chips.push(h('span', { key: 'seg', className: 'rt-tag' }, a.segment_cidr))
        if (a.open_ports) chips.push(h('span', { key: 'p', className: 'rt-tag rt-tag-active' }, '开放 ' + a.open_ports + ' 端口'))
        if (a.vulns) chips.push(h('span', { key: 'v', className: 'rt-tag rt-tag-live' }, '已确认问题 ' + a.vulns))
        if (a.webshells) chips.push(h('span', { key: 'w', className: 'rt-tag rt-tag-passive' }, '服务端点 ' + a.webshells))
        if (a.tunnels) chips.push(h('span', { key: 't', className: 'rt-tag rt-tag-passive' }, '联调通道 ' + a.tunnels))
        if (a.priority) chips.push(h('span', { key: 'pr', className: 'rt-tag' }, '优先级 ' + a.priority))
        if (a.blocked_count) chips.push(h('span', { key: 'b', className: 'rt-tag', style: { color: '#ef4444', borderColor: '#ef444455' } }, '阻塞 ' + a.blocked_count + ' 次'))
        const noteLines = a.test_notes
          ? String(a.test_notes).split('\n').slice(-3).map((l) => (l.length > 240 ? l.slice(0, 240) + ' …' : l))
          : []
        return h('div', { key: 'at' + a.id, className: 'rt-atest' + (past ? ' past' : '') },
          h('div', { className: 'rt-atest-head' },
            past ? null : h('span', { className: 'rt-live-dot' }),
            h('span', { className: 'rt-atest-ip' }, a.ip),
            h('span', { className: 'rt-tag ' + (a.test_status === 'testing' ? 'rt-tag-live' : '') }, TEST_STATUS_LABEL[a.test_status] || a.test_status),
            h('div', { className: 'rt-spacer' }),
            h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
              fmt(a.test_updated_at) + (a.test_updated_by ? ' · ' + a.test_updated_by : ''))),
          chips.length ? h('div', null, chips) : null,
          a.test_surface ? h('div', { className: 'rt-atest-meta' }, '验证接口面：' + a.test_surface) : null,
          a.potential ? h('div', { className: 'rt-atest-meta' }, '预期产出：' + a.potential) : null,
          noteLines.length ? h(Clip, { label: '验证记录', text: noteLines.join('\n') }) : null)
      }

      const concl = (label, value) => h('span', { key: label, className: 'rt-concl-i', style: { cursor: 'default' } },
        h('b', null, String(value || 0)), h('span', null, label))
      const conclusion = h('div', { className: 'rt-concl' },
        concl('验证中', stats.testing),
        concl('待验证', stats.untested),
        concl('已验证', stats.tested),
        concl('受阻/跳过', (stats.abandoned || 0) + (stats.blocked || 0)),
        concl('无需验证', stats.no_surface),
        h('div', { className: 'rt-spacer' }),
        at ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
          '更新于 ' + at.toLocaleTimeString('zh-CN', { hour12: false })) : null,
        h('button', {
          className: 'rt-btn', style: { padding: '0 7px', fontSize: 11 }, title: '展开最近验证与待验证队列',
          onClick: () => collapse.setAll(['testing:' + eng, 'recent:' + eng, 'queue:' + eng], true),
        }, '全部展开'),
        h('button', {
          className: 'rt-btn', style: { padding: '0 7px', fontSize: 11 }, title: '只留正在验证',
          onClick: () => collapse.setAll(['testing:' + eng, 'recent:' + eng, 'queue:' + eng], false),
        }, '全部收起'),
        h('button', {
          className: 'rt-btn' + (auto ? ' rt-btn-primary' : ''), style: { padding: '0 7px', fontSize: 11 },
          title: '每 5 秒自动刷新', onClick: () => setAuto((x) => !x),
        }, auto ? '实时 · 5s' : '已暂停'),
        h('button', { className: 'rt-btn', style: { padding: '0 7px', fontSize: 11 }, onClick: load }, '刷新'))

      const body = []
      body.push(h(Section, {
        key: 'testing', tone: 'test', title: '正在验证',
        count: testing.length + ' 个',
        sub: testing.length ? '智能体正在验证这些模块与服务' : '智能体开始验证某个模块后会实时出现在这里',
        open: collapse.isOpen('testing:' + eng, true),
        onToggle: collapse.toggle('testing:' + eng, true),
      }, testing.length
        ? testing.map((a) => card(a, false))
        : h('div', { className: 'rt-atest-meta', style: { paddingBottom: 4 } }, '当前没有模块处于「验证中」')))

      body.push(h(Section, {
        key: 'recent', tone: 'past', title: '最近验证', count: recent.length + ' 个',
        sub: '已完成验证的模块',
        open: collapse.isOpen('recent:' + eng, false),
        onToggle: collapse.toggle('recent:' + eng, false),
      }, recent.length ? recent.map((a) => card(a, true)) : h('div', { className: 'rt-atest-meta' }, '暂无')))

      body.push(h(Section, {
        key: 'queue', tone: 'queue', title: '待验证队列',
        count: (data ? (data.untested || 0) : 0) + ' 个',
        sub: '按模块优先级与开放服务数排序',
        open: collapse.isOpen('queue:' + eng, false),
        onToggle: collapse.toggle('queue:' + eng, false),
      }, queue.length
        ? queue.map((a) => card(a, true)).concat([
            h('div', { key: 'queueHint', className: 'rt-atest-meta', style: { paddingTop: 4 } },
              '完整清单（含筛选与排序）见「模块与服务」页')])
        : h('div', { className: 'rt-atest-meta' }, '没有待验证模块')))

      return h('div', { className: 'rt-main' },
        conclusion,
        err ? h('div', { className: 'rt-err' }, err) : null,
        data === null && !err ? h('div', { className: 'rt-empty' }, '加载中…') : null,
        h('div', { className: 'rt-body', style: { overflow: 'auto' } },
          h('div', { style: { padding: '6px 12px 14px' } }, body)))
    }

    /* ---------------------------------------------------------- 运行环境与服务端点 */
    function SessionTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [copied, setCopied] = React.useState(null)

      const load = () => {
        if (!eng) return
        api({ op: 'sessions', engagement: eng }).then((r) => {
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null)
          setData(r)
        }, (e) => setErr(String((e && e.message) || e)))
      }
      React.useEffect(load, [eng, refreshKey])

      const probe = () => {
        setBusy(true); setMsg(null)
        api({ op: 'probeSessions', engagement: eng, timeoutMs: 6000 }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '检测失败' }); load(); return }
          const on = (r.webshells || []).filter((x) => x.status === 'online').length
          const act = (r.tunnels || []).filter((x) => x.status === 'active').length
          setMsg({ ok: '检测完成：服务端点在线 ' + on + '/' + (r.webshells || []).length + '，联调通道可用 ' + act + '/' + (r.tunnels || []).length })
          load()
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const copy = (key, text) => copyWithFeedback(text, text, (okFlag, message) => {
        if (!okFlag) { setMsg({ err: message }); return }
        setCopied(key)
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
      })

      const markTunnel = (t, status) => {
        setMsg(null)
        api({ op: 'updateTunnel', engagement: eng, id: t.id, patch: { status: status, check_note: '界面手动标记' } })
          .then(() => load(), (e) => setMsg({ err: String((e && e.message) || e) }))
      }
      const markShell = (w, status) => {
        setMsg(null)
        api({ op: 'updateWebshell', engagement: eng, id: w.id, patch: { status: status, check_note: '界面手动标记' } })
          .then(() => load(), (e) => setMsg({ err: String((e && e.message) || e) }))
      }

      const sessCollapse = useCollapse('sessions:' + eng)
      const totals = (data && data.totals) || {}
      const shells = (data && data.webshells) || []
      const tunnels = (data && data.tunnels) || []
      const statusDot = (s) => h('span', { className: s === 'online' || s === 'active' ? 'rt-dot-on' : (s === 'unknown' || !s ? 'rt-dot-unk' : 'rt-dot-off') })
      const fact = (label, value) => h('div', { className: 'rt-sess-fact' }, h('b', null, label), h('span', null, value))
      const clip = (v, max) => {
        const t = String(v === undefined || v === null ? '' : v)
        const n = max || 90
        return t.length > n ? t.slice(0, n) + '…' : t
      }
      const factClip = (label, value, max) => fact(label, h('span', { title: String(value || '') }, clip(value, max)))
      const noteFold = (label, text) => {
        const t = String(text || '')
        if (t.trim() === '') return null
        return h('details', { className: 'rt-sess-fold' },
          h('summary', null, label + '（' + t.length + ' 字，点击展开）'),
          h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '4px 0', fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } }, t))
      }
      const isSecureEndpoint = (t) => /tls|https|ssh|grpc|ws|加密/i.test(String(t || ''))

      const shellCards = shells.map((w) => h('div', { key: 'w' + w.id, className: 'rt-sess' },
        h('div', { className: 'rt-sess-head' },
          statusDot(w.status),
          h('span', { className: 'rt-sess-title' }, w.url),
          h('span', { className: 'rt-tag rt-tag-active' }, w.shell_type || 'endpoint'),
          w.privilege ? h('span', { className: 'rt-tag' }, w.privilege) : null,
          h('div', { className: 'rt-spacer' }),
          copied === 'cmd' + w.id
            ? h('span', { className: 'rt-tag', style: { color: '#4d6bfe' } }, '已复制')
            : h('button', {
                className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
                onClick: () => copy('cmd' + w.id, 'curl -s "' + w.url + '"'),
              }, '复制 URL'),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: () => markShell(w, 'offline'),
          }, '标记离线')),
        h('div', { className: 'rt-sess-facts' },
          fact('端点类型', isSecureEndpoint(w.shell_type) ? '标准安全端点（可直连调试）' : '本地预览 / 调试端点'),
          w.pass_key ? fact('访问凭据', h(SecretText, { value: w.pass_key })) : null,
          w.asset_ip ? fact('所属节点', w.asset_ip) : null,
          w.privilege ? fact('运行角色', w.privilege) : null,
          w.secret_ref ? fact('凭据引用', h('span', { className: 'rt-mono' }, w.secret_ref)) : null,
          fact('最后检测', (w.last_check ? fmt(w.last_check) : '未检测')
            + (w.latency_ms !== null && w.latency_ms !== undefined ? '（' + w.latency_ms + 'ms）' : '')),
          noteFold('检测说明', w.check_note),
          noteFold('备注', w.note))))

      const tunnelCards = tunnels.map((t) => h('div', { key: 't' + t.id, className: 'rt-sess' },
        h('div', { className: 'rt-sess-head' },
          statusDot(t.status),
          h('span', { className: 'rt-sess-title' }, t.listen || '(未填监听地址)'),
          h('span', { className: 'rt-tag rt-tag-passive' }, t.kind || 'proxy'),
          t.legit === true
            ? h('span', { className: 'rt-tag rt-tag-live', title: t.entry_kind_label || '' }, '目标环境通道')
            : h('span', { className: 'rt-tag', title: '本地代理或待确认通道' }, '本地/待确认'),
          t.reach ? h('span', { className: 'rt-tag' }, '可达 ' + t.reach) : null,
          h('div', { className: 'rt-spacer' }),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: () => copy('sock' + t.id, t.listen || ''),
          }, copied === 'sock' + t.id ? '已复制' : '复制地址'),
          t.status === 'active'
            ? h('button', { className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 }, onClick: () => markTunnel(t, 'down') }, '标记离线')
            : h('button', { className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 }, onClick: () => markTunnel(t, 'active') }, '标记可用')),
        h('div', { className: 'rt-sess-facts' },
          factClip('上游入口', t.entry || '未登记', 110),
          t.reach ? factClip('可达子网/服务', t.reach, 110) : null,
          t.asset_ip ? fact('所属节点', t.asset_ip) : null,
          fact('最后检测', (t.last_check ? fmt(t.last_check) : '未检测')
            + (t.latency_ms !== null && t.latency_ms !== undefined ? '（' + t.latency_ms + 'ms）' : '')),
          noteFold('检测说明', t.check_note),
          noteFold('备注', t.note)),
        t.command ? h('details', { className: 'rt-sess-fold' },
          h('summary', null, '启动命令（点击展开 / 复制）'),
          h('div', Object.assign({ className: 'rt-code', title: '点击复制' }, clickable(() => copy('c' + t.id, t.command), { label: '复制命令' })),
            copied === 'c' + t.id ? '已复制' : t.command)) : null))

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '运行环境与服务端点'),
          h('span', { className: 'rt-tag' }, '服务端点 ' + (totals.webshellsOnline || 0) + '/' + (totals.webshells || 0) + ' 在线'),
          h('span', { className: 'rt-tag' }, '联调通道 ' + (totals.tunnelsActive || 0) + '/' + (totals.tunnels || 0) + ' 可用'),
          h('span', { className: 'rt-tag' }, '配置凭据 ' + (totals.credentials || 0)),
          h('span', { className: 'rt-tag' }, '连接会话 ' + (totals.access || 0)),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn rt-btn-primary', disabled: busy, onClick: probe }, busy ? '检测中…' : '检测连通性'),
          h('button', { className: 'rt-btn', onClick: load }, '刷新')),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        err ? h('div', { className: 'rt-err' }, err) : null,
        h('div', { className: 'rt-body', style: { overflow: 'auto' } },
          !shells.length && !tunnels.length
            ? h('div', { className: 'rt-empty' },
                h('div', null, '当前工作区尚未登记运行环境端点或联调通道。'),
                h('div', { style: { marginTop: 6, fontSize: 12 } },
                  '子智能体启动本地预览服务、调试端点或端口转发通道后会自动同步至此处；也可点击上方「检测连通性」核验在线状态。'))
            : null,
          h(Section, {
            key: 'webshells', tone: 'queue', title: '服务端点',
            count: (totals.webshellsOnline || 0) + '/' + (totals.webshells || 0) + ' 在线',
            sub: '已部署的本地预览与服务端点',
            open: sessCollapse.isOpen('shells', true), onToggle: sessCollapse.toggle('shells', true),
          }, shells.length
            ? h('div', { className: 'rt-sess-grid', style: { padding: 0 } }, shellCards)
            : h('div', { className: 'rt-atest-meta' }, '暂无服务端点')),
          h(Section, {
            key: 'tunnels', tone: 'test', title: '联调通道',
            count: (totals.tunnelsActive || 0) + '/' + (totals.tunnels || 0) + ' 可用',
            sub: '端口转发与联调代理通道',
            open: sessCollapse.isOpen('tunnels', true), onToggle: sessCollapse.toggle('tunnels', true),
          }, tunnels.length
            ? h('div', { className: 'rt-sess-grid', style: { padding: 0 } }, tunnelCards)
            : h('div', { className: 'rt-atest-meta' }, '暂无联调通道'))))
    }

    /* ---------------------------------------------------------- 错误边界 */
    class RtBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error: error }
      }
      componentDidCatch(error) {
        try { console.error('[lmtagent-ui] 页面渲染出错:', error) } catch (e) { /* ignore */ }
      }
      render() {
        if (this.state.error) {
          const msg = this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error)
          return h('div', { className: 'rt-pane' },
            h('div', { className: 'rt-err' }, '该页面渲染出错：' + msg),
            h('button', {
              className: 'rt-btn',
              onClick: () => { this.setState({ error: null }); setUI({ tab: 'overview' }) },
            }, '回到项目总览'))
        }
        return this.props.children
      }
    }

    /* ═══════════════════════════════════════════════════════════════════════════
     * 07-cluster-shell.js — 集群实时拓扑页签 (p5)、角色与提示词中心、1:1 会话隔离外壳与槽位挂载
     * ═══════════════════════════════════════════════════════════════════════════ */

    /** 8-Role gstack 虚拟研发团队模块化角色定义（2×4 Bento 网格） */
    const GSTACK_ROLE_ROSTER = [
      {
        role: 'plan',
        badge: '⓪ plan Captain',
        title: '主控指挥（主会话调度）',
        wave: 'Wave 0–4 全程中枢',
        skills: ['/dag-orchestrate', '/slot-gate', '/pg-sync'],
        desc: '拆解用户意图、按 4-Wave DAG 调度 6 并发槽、核对事实库并汇总汇报，不直接改业务文件。',
      },
      {
        role: 'recon',
        badge: '① recon CEO',
        title: '产品与需求规划（信息收集）',
        wave: 'Wave 1 · Slot #1',
        skills: ['/office-hours', '/plan-ceo-review'],
        desc: '全量业务模块与资产拓扑测绘，标注 P0/P1 优先级线索与产品验收口径。',
      },
      {
        role: 'designer',
        badge: '② designer Designer',
        title: '交互与视觉设计',
        wave: 'Wave 1 · Slot #2',
        skills: ['/plan-design-review', '/design-shotgun'],
        desc: 'DSH Desktop 模块化 Bento 组件树、设计令牌（#4D6BFE）与有数据/空态/报错三态交互规范。',
      },
      {
        role: 'assess',
        badge: '③ assess Eng Manager',
        title: '系统架构与排期',
        wave: 'Wave 2 · 1 槽契约锁',
        skills: ['/plan-eng-review', '/file-disjoint-shard'],
        desc: '冻结模块接口契约、依赖拓扑与 6 并发无冲突文件分片（File-Disjoint Sharding）。',
      },
      {
        role: 'vuln-scan',
        badge: '④ vuln-scan Reviewer & CSO',
        title: '代码审查与安全门禁',
        wave: 'Wave 4 · Gate #1',
        skills: ['/review', '/cso'],
        desc: '静态代码缺陷审查、OWASP/STRIDE 安全门禁与凭据零明文泄露审计。',
      },
      {
        role: 'exploit',
        badge: '⑤ exploit 6× Builder',
        title: '全栈研发与分片构建',
        wave: 'Wave 3 · 6 槽满载',
        skills: ['/parallel-build', '/subagent-spawn'],
        desc: 'Wave 3 主力 6 槽并发编码实现、单测自检与深度验证；遇微问题可递归派生子代理。',
      },
      {
        role: 'qa',
        badge: '⑥ qa QA Lead',
        title: '质量保障与自动化回归',
        wave: 'Wave 4 · Gate #2',
        skills: ['/qa', '/benchmark'],
        desc: '全量测试套件、浏览器端到端回归、性能基线测试与高分成果独立复核。',
      },
      {
        role: 'internal',
        badge: '⑦ internal Doc & Release',
        title: '文档工程与归档发布',
        wave: 'Wave 4 · Release',
        skills: ['/ship', '/document-release'],
        desc: '文稿墙（Doc Wall）同步、版本归档、飞书群聊机器人推送与闭环交付报告生成。',
      },
    ]

    /**
     * 集群 -> 智能体与并发（st.tab === 'agents'）：
     *   · 顶部紧凑自适应并发槽与租约控制栏（并发槽 active/max、3/6/8/12 快捷档、步进器、maxDepth、thinking、租约锁状态）
     *   · 主体直出实时 p5 集群拓扑 + 双步节点透视抽屉 + P0–P3 阶段泳道（HarnessWorkflowDeck variant='cluster'）
     *   · 未绑定工作区时严格保持 0/max 空闲态，绝不泄露其他工作区的在跑槽位或历史子代理记录
     */
    function AgentsTab(props) {
      const eng = props.engagement
      const sid = props.sessionId || null
      const refreshKey = props.refreshKey || 0
      const [concurrency, setConcurrency] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [maxDepth, setMaxDepth] = React.useState(3)
      const [thinking, setThinking] = React.useState('low')
      const [ctrlMsg, setCtrlMsg] = React.useState(null)

      const load = React.useCallback(() => {
        setBusy(true)
        api({
          op: 'agentsStatus',
          engagement: eng || undefined,
          session: sid || undefined,
        }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) {
            setErr((r && r.error) || '读取集群并发状态失败')
            return
          }
          setErr(null)
          setConcurrency(r)
          if (typeof r.maxDepth === 'number') setMaxDepth(r.maxDepth)
          if (typeof r.thinking === 'string' && r.thinking) setThinking(r.thinking)
        }, (e) => {
          setBusy(false)
          setErr(String((e && e.message) || e))
        })
      }, [eng, sid])

      React.useEffect(() => {
        load()
      }, [load, refreshKey])

      useHostEvents(eng, load, 1000)

      const max = (concurrency && Number(concurrency.max) > 0) ? Number(concurrency.max) : 6
      const limit = (concurrency && Number(concurrency.limit) > 0) ? Number(concurrency.limit) : 12
      const runningList = (eng && concurrency && Array.isArray(concurrency.running)) ? concurrency.running : []
      const rawUsed = (eng && concurrency && typeof concurrency.used === 'number')
        ? Math.max(0, concurrency.used)
        : runningList.length
      const activeCount = eng ? Math.min(max, rawUsed) : 0

      const effectiveAgents = eng
        ? concurrency
        : {
            ok: true,
            max: max,
            limit: limit,
            maxDepth: maxDepth,
            thinking: thinking,
            used: 0,
            free: max,
            total_children: 0,
            running: [],
            children: [],
            agentNetwork: { children: [] },
          }

      const applySlotMax = (targetMax) => {
        const parsed = Number(targetMax)
        if (!Number.isFinite(parsed)) return
        const clamped = Math.max(1, Math.min(limit, Math.floor(parsed)))
        setConcurrency((prev) => Object.assign({}, prev || {}, { max: clamped, source: 'settings' }))
        setCtrlMsg('正在调整并发槽上限为 ' + clamped + ' 槽…')
        api({ op: 'setAgentsMax', max: clamped }).then((r) => {
          if (r && r.ok !== false) {
            setCtrlMsg('已生效：并发槽上限 ' + (r.max || clamped) + ' 槽 · maxDepth=' + maxDepth + ' · thinking=' + thinking)
            load()
          } else {
            setCtrlMsg((r && r.error) || '调整并发槽失败')
          }
        }, (e) => setCtrlMsg(String((e && e.message) || e)))
        api({ op: 'setClusterConfig', maxAgents: clamped, maxDepth: maxDepth, thinking: thinking }).then(() => {}, () => {})
      }

      const applyRecursionConfig = (nextDepth, nextThinking) => {
        const d = Number(nextDepth) || 3
        const t = String(nextThinking || 'low')
        setMaxDepth(d)
        setThinking(t)
        setCtrlMsg('已更新递归子代理配置：maxDepth = ' + d + ' · thinking = ' + t)
        api({ op: 'setClusterConfig', maxAgents: max, maxDepth: d, thinking: t }).then(() => {}, () => {})
      }

      const presets = [
        { n: 3, label: '3 槽' },
        { n: 6, label: '6 槽 (推荐)' },
        { n: 8, label: '8 槽' },
        { n: 12, label: '12 槽' },
      ]

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '智能体与并发（4-Wave 实时集群拓扑）'),
          h('span', {
            className: 'rt-tag' + (activeCount >= max ? ' rt-tag-warn' : (activeCount > 0 ? ' rt-tag-live' : ' rt-tag-passive')),
          }, '并发槽 ' + activeCount + '/' + max),
          h('span', {
            className: 'rt-tag rt-tag-live',
            title: '子智能体超过 3 分钟无心跳自动回收槽位租约；文件分片由排他锁守护',
          }, '3min 无心跳自动回收 · 分片排他锁'),
          h('div', { className: 'rt-spacer' }),
          h('button', {
            type: 'button',
            className: 'rt-btn',
            title: '查看与编辑 8 个 gstack 角色的 Markdown 提示词模板',
            onClick: () => { if (typeof props.onGo === 'function') props.onGo('prompts') },
          }, '角色与提示词 →'),
          h('button', {
            type: 'button',
            className: 'rt-btn',
            disabled: busy,
            onClick: load,
          }, busy ? '读取中…' : '刷新')),
        h('div', { className: 'rt-pane' },
          err ? h('div', { className: 'rt-err' }, err) : null,
          h('div', { className: 'rt-card', style: { padding: '10px 12px' } },
            h('div', { className: 'rt-p3-ctrl', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('span', { style: { fontSize: 12, fontWeight: 700 } }, '并发数量与租约控制'),
              h('div', { className: 'rt-p3-stepper', title: '调节并发槽位 (1–' + limit + ')' },
                h('button', { type: 'button', className: 'rt-p3-step-btn', disabled: max <= 1, onClick: () => applySlotMax(max - 1) }, '-'),
                h('span', { className: 'rt-p3-step-val' }, max + ' 槽'),
                h('button', { type: 'button', className: 'rt-p3-step-btn', disabled: max >= limit, onClick: () => applySlotMax(max + 1) }, '+')),
              h('div', { className: 'rt-p3-pills' },
                presets.map((p) => h('button', {
                  key: 'slot-pill-' + p.n,
                  type: 'button',
                  className: 'rt-p3-pill' + (max === p.n ? ' on' : ''),
                  onClick: () => applySlotMax(p.n),
                }, p.label))),
              h('select', {
                className: 'rt-input',
                style: { height: 26, fontSize: 11.5, padding: '0 6px' },
                'aria-label': '最大递归深度 maxDepth',
                value: String(maxDepth),
                onChange: (e) => applyRecursionConfig(Number(e.target.value), thinking),
              },
                h('option', { value: '1' }, 'maxDepth = 1'),
                h('option', { value: '2' }, 'maxDepth = 2'),
                h('option', { value: '3' }, 'maxDepth = 3'),
                h('option', { value: '4' }, 'maxDepth = 4')),
              h('select', {
                className: 'rt-input',
                style: { height: 26, fontSize: 11.5, padding: '0 6px' },
                'aria-label': '默认思考强度 thinking',
                value: thinking,
                onChange: (e) => applyRecursionConfig(maxDepth, e.target.value),
              },
                h('option', { value: 'low' }, 'thinking = low (极速)'),
                h('option', { value: 'medium' }, 'thinking = medium (均衡)'),
                h('option', { value: 'high' }, 'thinking = high (深度)')),
              h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginLeft: 'auto' } },
                '同一项目',
                h('b', { style: { color: 'var(--dsw-alias-label-primary)' } }, '同时最多 ' + max + ' 个执行智能体'),
                ' · 派发前经 ',
                h('code', { className: 'rt-code-inline' }, 'redteam_agent_slot'),
                ' 占位核验')),
            ctrlMsg ? h('div', { style: { fontSize: 11, color: '#2563eb', marginTop: 6, fontWeight: 600 } }, ctrlMsg) : null),
          h(HarnessWorkflowDeck, {
            engagement: eng,
            agents: effectiveAgents,
            refreshKey: refreshKey,
            variant: 'cluster',
            onOpenCollab: () => { if (typeof props.onGo === 'function') props.onGo('collab') },
          })))
    }

    /**
     * 集群 -> 角色与提示词（st.tab === 'prompts'）：
     *   · 承载 2×4 GSTACK_ROLE_ROSTER 角色卡片网格 + 按工作区持久化的 PromptsTab Markdown 编辑器
     *   · 与实时拓扑页签彻底解耦，避免单页堆叠过深
     */
    function RolePromptsHubTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [roles, setRoles] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [openRole, setOpenRole] = React.useState('plan')
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(() => {
        if (!eng) {
          setRoles([])
          setErr(null)
          return
        }
        setBusy(true)
        api({ op: 'prompts', engagement: eng }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) {
            setErr((r && r.error) || '读取角色提示词失败')
            return
          }
          setErr(null)
          if (Array.isArray(r.roles)) setRoles(r.roles)
        }, (e) => {
          setBusy(false)
          setErr(String((e && e.message) || e))
        })
      }, [eng])

      React.useEffect(() => {
        load()
      }, [load, refreshKey])

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '角色与提示词（8 角色 gstack 编队）'),
          h('span', { className: 'rt-tag rt-tag-passive' }, '当前角色 · ' + openRole + '.md'),
          h('div', { className: 'rt-spacer' }),
          h('button', {
            type: 'button',
            className: 'rt-btn',
            onClick: () => { if (typeof props.onGo === 'function') props.onGo('agents') },
          }, '← 返回智能体与并发'),
          h('button', {
            type: 'button',
            className: 'rt-btn',
            disabled: busy || !eng,
            onClick: load,
          }, busy ? '读取中…' : '刷新')),
        h('div', { className: 'rt-pane' },
          err ? h('div', { className: 'rt-err' }, err) : null,
          h('div', { className: 'rt-card' },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 } },
              h('h4', { style: { margin: 0 } }, '八位集群角色 · 2×4 模块化角色网格（点击卡片切换下方提示词模板）'),
              h('span', { className: 'rt-wb-recurse-tag' }, '按工作区独立持久化 Markdown 提示词')),
            h('div', { className: 'rt-wb-role-grid' },
              GSTACK_ROLE_ROSTER.map((r) => {
                const isSelected = openRole === r.role
                const roleData = (roles || []).find((x) => x.role === r.role)
                return h('div', Object.assign({
                  key: 'rc-' + r.role,
                  className: 'rt-wb-role-card' + (isSelected ? ' on' : ''),
                }, clickable(() => { setOpenRole(r.role) }, {
                  label: '选择并编辑角色 ' + r.badge + ' 提示词',
                  expanded: isSelected,
                })),
                  h('div', { className: 'rt-wb-role-top' },
                    h('span', { className: 'rt-wb-role-badge' }, r.badge),
                    h('span', { className: 'rt-tag rt-tag-passive' }, r.wave)),
                  h('div', { className: 'rt-wb-role-title' }, r.title + (roleData && roleData.stale ? '（旧版可升级）' : '')),
                  h('div', { className: 'rt-wb-role-desc' }, r.desc),
                  h('div', { className: 'rt-wb-role-tags' },
                    r.skills.map((sk) => h('span', { key: sk, className: 'rt-wb-skill-tag' }, sk))),
                  h('div', { className: 'rt-wb-role-edit' },
                    isSelected ? '▾ 当前正在查看/编辑 ' + r.role + '.md' : '点击查看/编辑 (' + r.role + '.md) →'))
              }))),
          eng
            ? h('div', { className: 'rt-card' },
                h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } },
                  '角色提示词编辑器 · 当前工作区「' + eng + '」 · 角色 ' + openRole + '.md'),
                h(PromptsTab, { engagement: eng, refreshKey: refreshKey, selectedRole: openRole }))
            : h('div', { className: 'rt-card' },
                h('h4', { style: { marginTop: 0 } }, '当前会话尚未初始化工作区'),
                h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 10, lineHeight: 1.6 } },
                  '上方展示 8 个标准 gstack 研发角色的职责边界与挂载技能。初始化当前会话工作台后，即可按工作区独立定制并保存各角色的 Markdown 提示词。'),
                h('button', {
                  type: 'button',
                  className: 'rt-btn rt-btn-primary',
                  onClick: () => { if (typeof props.onGo === 'function') props.onGo('collab') },
                }, '前往「协同与审批」初始化当前会话工作台 →'))))
    }

    /**
     * 版本显示 + 自动更新按钮（带卸载清理的倒计时定时器，杜绝组件卸载后泄露）。
     */
    function VersionBar() {
      const [info, setInfo] = React.useState(null)
      const [, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [open, setOpen] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [countdown, setCountdown] = React.useState(0)
      const countdownTimerRef = React.useRef(null)

      const clearCountdownTimer = () => {
        if (countdownTimerRef.current !== null) {
          clearInterval(countdownTimerRef.current)
          countdownTimerRef.current = null
        }
      }

      React.useEffect(() => () => clearCountdownTimer(), [])

      const check = (silent) => {
        if (!silent) setBusy(true)
        api({ op: 'updateCheck' }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) {
            if (!silent) setErr((r && r.error) || '检查更新失败')
            api({ op: 'version' }).then((v) => { if (v && v.ok !== false) setInfo(v) }, () => {})
            return
          }
          setErr(null)
          setInfo(r)
        }, (e) => {
          setBusy(false)
          if (!silent) setErr(String((e && e.message) || e))
          api({ op: 'version' }).then((v) => { if (v && v.ok !== false) setInfo(v) }, () => {})
        })
      }
      React.useEffect(() => { check(true) }, [])

      const applyUpdate = () => {
        setBusy(true)
        setMsg(null)
        api({ op: 'updateApply', target: (info && info.latest) || undefined }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '更新失败' }); return }
          setMsg({ ok: '已安装 ' + (r.installed || '') + '，正在重启 dsh web…' })
          clearCountdownTimer()
          setCountdown(6)
          countdownTimerRef.current = setInterval(() => {
            setCountdown((n) => {
              if (n <= 1) {
                clearCountdownTimer()
                try { window.location.reload() } catch { /* ignore */ }
                return 0
              }
              return n - 1
            })
          }, 1000)
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const current = info && info.current ? info.current : (info && info.plugin ? info.plugin.version : null)
      const latest = info && info.latest ? info.latest : null
      const hasNew = !!(info && info.updateAvailable)
      const blockers = (info && info.blockers) || []
      const notes = (info && info.notes) || []
      const mode = info && info.install ? info.install.mode : null

      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h('span', {
          className: 'rt-tag' + (hasNew ? ' rt-tag-warn' : ''),
          title: ('当前版本 ' + (current || '未知') + (latest ? '\n最新版本 ' + latest : '')
            + ((mode === 'dev' || mode === 'source') ? '\n安装方式：本地源码（未走包管理器）' : mode === 'package' ? '\n安装方式：包安装' : '')
            + (info && info.check_error ? '\n检查失败：' + info.check_error : '')),
        }, 'v' + (current || '?')),
        hasNew
          ? h('button', {
              className: 'rt-btn rt-btn-primary', disabled: busy,
              onClick: () => { setOpen(true); setMsg(null) },
              title: '发现新版本 ' + latest + '：点击查看并一键更新（会重启 dsh web）',
            }, busy ? '检查中…' : '有新版本 v' + latest)
          : h('button', {
              className: 'rt-btn', disabled: busy, onClick: () => check(false),
              title: '重新检查 npm 上的最新版本',
            }, busy ? '检查中…' : '检查更新'),
        open
          ? h('div', { className: 'rt-modal', 'aria-hidden': 'true', onClick: () => setOpen(false) },
              h('div', { className: 'rt-modal-box', onClick: (e) => e.stopPropagation() },
                h('h4', { style: { marginTop: 0 } }, '更新 LMTAgent 研发控制台'),
                h('div', { className: 'rt-kv' }, h('b', null, '开源仓库'), h('span', { className: 'rt-mono' }, 'ECCVIK/LMTAgent')),
                h('div', { className: 'rt-kv' }, h('b', null, '当前版本'), h('span', null, current || '未知')),
                h('div', { className: 'rt-kv' }, h('b', null, '最新版本'), h('span', null, latest || '未知')),
                h('div', { className: 'rt-kv' }, h('b', null, '安装方式'),
                  h('span', null, (mode === 'dev' || mode === 'source') ? '本地源码' : mode === 'package' ? '包安装（' + ((info.install && info.install.packageManager) || 'npm') + '）' : '未知')),
                info && info.install && info.install.dir
                  ? h('div', { className: 'rt-kv' }, h('b', null, '安装位置'), h('span', { className: 'rt-mono' }, info.install.dir))
                  : null,
                blockers.length
                  ? h('div', { className: 'rt-hint' },
                      h('div', { style: { fontWeight: 600, marginBottom: 4 } }, '现在不能更新：'),
                      blockers.map((b, i) => h('div', { key: 'b' + i }, '· ' + b)))
                  : null,
                notes.length
                  ? h('div', { className: 'rt-foot', style: { padding: '4px 0' } }, notes.map((n, i) => h('div', { key: 'n' + i }, n)))
                  : null,
                h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', margin: '8px 0' } },
                  '更新过程：安装新版本 → 自动重启 dsh web（当前页面会断开，约 5–10 秒后自动刷新）。'
                  + '重启前会检查有没有智能体在跑，有就拦住不动。'),
                msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
                countdown > 0
                  ? h('div', { className: 'rt-foot' }, 'dsh web 正在重启，' + countdown + ' 秒后自动刷新页面…')
                  : null,
                h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 } },
                  h('button', { className: 'rt-btn', onClick: () => setOpen(false) }, '关闭'),
                  h('button', {
                    className: 'rt-btn rt-btn-primary',
                    disabled: busy || blockers.length > 0,
                    title: (mode === 'dev' || mode === 'source') ? '把 npm 发布版装进 profile（本地源码改动不再生效）' : blockers.length ? '先解决上面的阻塞项' : '安装并重启',
                    onClick: applyUpdate,
                  }, busy ? '更新中…' : '一键更新并重启'))))
          : null)
    }

    /* ---------------------------------------------------------- 多实例 Panel 共享单例定时器中枢 */
    /* apply(ctx) 在 shell.overlay / main / conversation.view 槽位注册 Panel；
       用引用计数合并会话同步与 consoleDigest 轮询，并尊重权威的 conversation.view 会话实例。 */
    let _sessionSyncRefs = 0
    let _sessionSyncTimer = null
    let _authoritativeSessionMountCount = 0

    const _runSessionSyncTick = () => {
      if (_isCanvasDragging) return
      if (_authoritativeSessionMountCount > 0) return
      try {
        const lsSid = window.localStorage && window.localStorage.getItem('dsh.sessions.current')
        if (lsSid && lsSid !== sessionId) {
          setSessionId(lsSid, null)
        }
      } catch { /* ignore storage error */ }
    }
    const acquireSessionSyncTicker = () => {
      _sessionSyncRefs += 1
      _runSessionSyncTick()
      if (_sessionSyncTimer === null && typeof window !== 'undefined' && typeof window.setInterval === 'function') {
        _sessionSyncTimer = window.setInterval(_runSessionSyncTick, 1500)
      }
      return () => {
        _sessionSyncRefs = Math.max(0, _sessionSyncRefs - 1)
        if (_sessionSyncRefs === 0 && _sessionSyncTimer !== null) {
          try { window.clearInterval(_sessionSyncTimer) } catch { /* ignore */ }
          _sessionSyncTimer = null
        }
      }
    }

    const _digestHubs = new Map()
    const _pollDigestHub = (eng) => {
      const hub = _digestHubs.get(eng)
      if (!hub || hub.inflight) return
      hub.inflight = true
      api({ op: 'consoleDigest', engagement: eng }).then((r) => {
        const curHub = _digestHubs.get(eng)
        if (!curHub) return
        if (r && r.ok !== false && r.sections) {
          curHub.lastSections = r.sections
          for (const cb of Array.from(curHub.subs)) cb(r.sections)
        }
      }, () => {}).finally(() => {
        const curHub = _digestHubs.get(eng)
        if (curHub) curHub.inflight = false
      })
    }
    const subscribeDigestPoller = (eng, onSections) => {
      if (!eng) return () => {}
      let hub = _digestHubs.get(eng)
      if (!hub) {
        hub = { subs: new Set(), inflight: false, lastSections: null, timer: null }
        _digestHubs.set(eng, hub)
      }
      hub.subs.add(onSections)
      if (hub.lastSections) onSections(hub.lastSections)
      _pollDigestHub(eng)
      if (hub.timer === null && typeof window !== 'undefined' && typeof window.setInterval === 'function') {
        hub.timer = window.setInterval(() => _pollDigestHub(eng), 25000)
      }
      return () => {
        const curHub = _digestHubs.get(eng)
        if (!curHub) return
        curHub.subs.delete(onSections)
        if (curHub.subs.size === 0) {
          if (curHub.timer !== null) {
            try { window.clearInterval(curHub.timer) } catch { /* ignore */ }
          }
          _digestHubs.delete(eng)
        }
      }
    }

    /* ---------------------------------------------------------- 常驻面板主体（1:1 会话强隔离） */
    const UNREAD_KEY = 'rt-unread:'
    const loadUnread = (eng) => {
      try {
        const raw = window.localStorage.getItem(UNREAD_KEY + eng)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' ? parsed : null
      } catch (e) { return null }
    }
    const saveUnread = (eng, value) => {
      try { window.localStorage.setItem(UNREAD_KEY + eng, JSON.stringify(value)) } catch (e) { /* 隐私模式等 */ }
    }
    const digestHasNew = (prev, cur) => {
      if (!cur) return false
      if (!prev) return true
      const pc = Number(prev.count || 0)
      const cc = Number(cur.count || 0)
      if (cc > pc) return true
      const pa = prev.at || ''
      const ca = cur.at || ''
      return ca !== '' && ca !== pa && ca > pa
    }

    function Panel(props) {
      const embedMode = props && props.embedMode ? String(props.embedMode) : null
      const propSid = sessionIdOf(props)
      const scopedSession = typeof useScopedSession === 'function'
        ? useScopedSession(props, embedMode)
        : Object.assign({}, useSession(), { authoritative: Boolean(propSid) })
      const sid = scopedSession.id
      const sesTitle = scopedSession.title
      const sidRef = React.useRef(sid)
      sidRef.current = sid

      React.useEffect(() => {
        if (!scopedSession.authoritative || !propSid) return undefined
        _authoritativeSessionMountCount += 1
        return () => {
          _authoritativeSessionMountCount = Math.max(0, _authoritativeSessionMountCount - 1)
        }
      }, [scopedSession.authoritative, propSid])

      const st = useUI()
      const [engagements, setEngagements] = React.useState([])
      const [, setHostSessions] = React.useState([])
      const [eng, setEng] = React.useState(null)
      const [boundEng, setBoundEng] = React.useState(null)
      const [, setFollowing] = React.useState(false)
      const [followSource, setFollowSource] = React.useState(null)
      const [sessionState, setSessionState] = React.useState(null)
      const [snapshot, setSnapshot] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const manualPickRef = React.useRef(null)
      const autoRoutedSessionRef = React.useRef(null)
      const resizeCleanupRef = React.useRef(null)
      const manualHere = () => manualPickRef.current !== null && manualPickRef.current === (sid || '')
      const [width, setWidth] = React.useState(() => {
        try {
          const saved = Number(window.localStorage.getItem('rt-dock-width'))
          if (Number.isFinite(saved) && saved >= 380 && saved <= 900) return saved
        } catch (e) { /* 隐私模式 */ }
        return 540
      })
      const [, setCreating] = React.useState(false)
      const [refreshKey, setRefreshKey] = React.useState(0)
      const [digest, setDigest] = React.useState(null)
      const [seen, setSeen] = React.useState(null)
      const [full, setFull] = React.useState(() => isFullWindow())

      const exitFull = React.useCallback(() => {
        setFull(false)
        try {
          if (window.opener && !window.opener.closed) { window.close(); return }
        } catch (e) { /* ignore */ }
        try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch (e) { /* ignore */ }
      }, [])

      /* 监听全屏打开与全屏退回（含 openAgentSessionInHostChat 派发的 EXIT_FULL_EVENT） */
      React.useEffect(() => {
        const onOpen = () => {
          setFull(true)
          try { window.history.replaceState(null, '', window.location.pathname + window.location.search + '#redteam-full') } catch { /* ignore */ }
        }
        const onExit = () => { exitFull() }
        window.addEventListener(FULL_REQUEST_EVENT, onOpen)
        window.addEventListener(EXIT_FULL_EVENT, onExit)
        return () => {
          window.removeEventListener(FULL_REQUEST_EVENT, onOpen)
          window.removeEventListener(EXIT_FULL_EVENT, onExit)
        }
      }, [exitFull])

      /* 单例共享监听 DSH 宿主当前会话切换（conversation.view 权威会话实例无需轮询全局覆盖自身） */
      React.useEffect(() => {
        if (scopedSession.authoritative) return undefined
        return acquireSessionSyncTicker()
      }, [scopedSession.authoritative])

      /* 切换工作区时淘汰旧工作区截图 LRU 缓存 */
      React.useEffect(() => {
        if (eng) clearShotCache(eng)
      }, [eng])

      /* 拖拽缩放卸载清理：防止拖拽途中组件卸载导致 mousemove/mouseup 残留 */
      React.useEffect(() => () => {
        if (resizeCleanupRef.current) {
          resizeCleanupRef.current()
          resizeCleanupRef.current = null
        }
      }, [])

      /* 面板宽度 → :root 自定义属性（frame 的 padding-right 依赖它） */
      React.useEffect(() => {
        setDockWidth(width)
        try { window.localStorage.setItem('rt-dock-width', String(width)) } catch (e) { /* 隐私模式 */ }
      }, [width])

      const loadSnapshot = (id) => {
        if (!id) { setSnapshot(null); return }
        api({ op: 'snapshot', engagement: id }).then((r) => {
          if (!r || r.ok === false) { setErr((r && r.error) || '加载失败'); return }
          setErr(null)
          setSnapshot(r)
        }, (e) => setErr(String((e && e.message) || e)))
      }

      const refreshList = (selectId) => {
        api({ op: 'bootstrap', session: sidRef.current || undefined }).then((b) => {
          setEngagements((b && b.engagements) || [])
          if (b && Array.isArray(b.host_sessions)) setHostSessions(b.host_sessions)
          if (selectId) { setEng(selectId); loadSnapshot(selectId) }
        }, () => {})
      }

      const followTo = (id, list, source) => {
        const known = (list || engagements).some((x) => x.id === id)
        if (!known) return false
        manualPickRef.current = null
        setFollowing(true)
        setFollowSource(source || 'bound')
        setEng(id)
        rememberEngagement(id)
        loadSnapshot(id)
        return true
      }

      const getNamedEngagements = (list) => (list || engagements).filter((x) => !isRawUuidName(x.name || x.id) && !isRawUuidName(x.id))

      const applyResolvedBinding = (r, id, list, title) => {
        const known = list || engagements
        if (r && Array.isArray(r.host_sessions)) setHostSessions(r.host_sessions)
        const rawCandidate = r && r.ok !== false && typeof r.bound === 'string' && r.bound ? r.bound : null
        const rawBound = rawCandidate && !isRawUuidName(rawCandidate) ? rawCandidate : null
        const dismissed = Boolean(r && (r.onboarding_dismissed || r.init_state === 'skipped'))
        const hasConv = typeof scopedSession.hasConversation === 'boolean'
          ? (scopedSession.hasConversation || Boolean(r && r.has_conversation))
          : Boolean(r && r.has_conversation)
        const stObj = {
          bound: rawBound,
          init_state: (r && r.init_state) || (rawBound ? 'initialized' : (dismissed ? 'skipped' : 'uninitialized')),
          onboarding_dismissed: dismissed,
          has_conversation: hasConv,
          session_title: (r && r.session_title) || title || null,
          cwd: scopedSession.cwd || (r && r.cwd) || null,
        }
        setSessionState(stObj)

        const existsInKnown = rawBound !== null && known.some((x) => x.id === rawBound)
        if (existsInKnown) {
          setBoundEng(rawBound)
          if (manualHere() && eng !== null && !isRawUuidName(eng)) return
          followTo(rawBound, known, 'bound')
          return
        }

        /* 严格 1:1 会话隔离：未绑定会话绝不抢占其他会话的工作区、不猜测标题、不回退 lastEngagement */
        setBoundEng(null)
        if (manualHere() && eng !== null && !isRawUuidName(eng)) return
        setEng(null)
        setSnapshot(null)
        setFollowing(true)
        setFollowSource(stObj.onboarding_dismissed ? 'skipped' : 'unbound')
        if (!stObj.onboarding_dismissed && id && autoRoutedSessionRef.current !== id) {
          autoRoutedSessionRef.current = id
          setUI({ tab: 'collab' })
        }
      }

      const bindSeq = React.useRef(0)
      const applySessionBinding = (id, list, title) => {
        if (!id) return
        const seq = (bindSeq.current += 1)
        const forSession = id
        api({
          op: 'sessionBinding',
          session: forSession,
          title: title || undefined,
        }).then((r) => {
          if (seq !== bindSeq.current) return
          if (sidRef.current !== forSession) return
          applyResolvedBinding(r, forSession, list || engagements, title)
        }, () => {
          if (seq === bindSeq.current && sidRef.current === forSession) {
            setBoundEng(null)
            setEng(null)
            setSnapshot(null)
            setFollowing(true)
            setFollowSource('unbound')
          }
        })
      }

      React.useEffect(() => {
        const dom = readHostDomTelemetry()
        let lsCurrentSid = null
        try {
          lsCurrentSid = window.localStorage && window.localStorage.getItem('dsh.sessions.current')
        } catch { lsCurrentSid = null }
        const initialSid = sid || (!scopedSession.authoritative ? (lsCurrentSid || dom.sessionId) : null) || null
        api({ op: 'bootstrap', session: initialSid || undefined }).then((r) => {
          if (!r || r.ok === false) {
            if (r && r.emptyResponse) return
            setErr((r && r.error) || '无法连接工作区存储')
            return
          }
          setErr(null)
          const list = r.engagements || []
          const hs = Array.isArray(r.host_sessions) ? r.host_sessions : []
          setEngagements(list)
          setHostSessions(hs)

          let effectiveSid = sidRef.current || initialSid || null
          if (!scopedSession.authoritative && !effectiveSid && lsCurrentSid) {
            const matchedHs = hs.find((x) => x && x.id === lsCurrentSid)
            if (matchedHs) {
              setSessionId(matchedHs.id, matchedHs.displayLabel || matchedHs.title || null)
              effectiveSid = matchedHs.id
            }
          }

          if (effectiveSid !== null) {
            if (r.session_binding && typeof r.session_binding === 'object') {
              applyResolvedBinding(r.session_binding, effectiveSid, list, sesTitle)
            } else {
              applySessionBinding(effectiveSid, list, sesTitle)
            }
            return
          }

          /* 仅在无任何 DSH 会话的纯独立 Web 预览模式下加载默认工作区 */
          const namedList = getNamedEngagements(list)
          const rawFallback = r.current || (list[0] && list[0].id) || null
          const fallback = (rawFallback && isRawUuidName(rawFallback) && namedList.length > 0)
            ? namedList[0].id
            : rawFallback
          if (fallback) {
            manualPickRef.current = null
            setFollowing(false)
            setFollowSource('default')
            setEng(fallback)
            loadSnapshot(fallback)
          }
        }, (e) => setErr(String((e && e.message) || e)))
      }, [])

      React.useEffect(() => {
        if (sid === null) {
          setSessionState(null)
          return
        }
        applySessionBinding(sid, engagements, sesTitle)
      }, [sid, sesTitle, engagements.length])

      const openEngagement = (nameArg) => {
        const name = String(nameArg || '').trim()
        if (!name) return Promise.resolve(null)
        setCreating(true)
        return api({ op: 'openEngagement', name: name, session: sid || undefined }).then((r) => {
          setCreating(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '创建失败'); return null }
          const createdId = (r.engagement && r.engagement.id) || r.id || name
          if (createdId) {
            manualPickRef.current = null
            setBoundEng(createdId)
            setEng(createdId)
            setFollowing(true)
            setFollowSource('bound')
            rememberEngagement(createdId)
            setSessionState((prev) => Object.assign({}, prev || {}, {
              bound: createdId,
              init_state: 'initialized',
              onboarding_dismissed: true,
            }))
            if (sid) {
              api({
                op: 'bindSessionEngagement',
                session: sid,
                id: createdId,
                engagement: createdId,
                title: sesTitle || undefined,
              }).catch(() => {})
            }
            refreshList(createdId)
          }
          return createdId
        }, (e) => {
          setCreating(false)
          setErr(String((e && e.message) || e))
          return null
        })
      }

      const bindExistingWorkspace = (targetId) => {
        const next = String(targetId || '').trim()
        if (!next || next === '__session_unbound__') return Promise.resolve(false)
        manualPickRef.current = null
        setBoundEng(next)
        setEng(next)
        setFollowing(true)
        setFollowSource('bound')
        rememberEngagement(next)
        setSessionState((prev) => Object.assign({}, prev || {}, {
          bound: next,
          init_state: 'initialized',
          onboarding_dismissed: true,
        }))
        loadSnapshot(next)
        const bindReq = sid
          ? api({
              op: 'bindSessionEngagement',
              session: sid,
              id: next,
              engagement: next,
              title: sesTitle || undefined,
            }).catch(() => {})
          : Promise.resolve()
        api({ op: 'activateEngagement', id: next, engagement: next, session: sid || undefined }).catch(() => {})
        return bindReq.then(() => true)
      }

      const handleWorkspaceSelect = (createdId) => {
        if (!createdId) return
        manualPickRef.current = null
        setBoundEng(createdId)
        setEng(createdId)
        setFollowing(true)
        setFollowSource('bound')
        rememberEngagement(createdId)
        setSessionState((prev) => Object.assign({}, prev || {}, {
          bound: createdId,
          init_state: 'initialized',
          onboarding_dismissed: true,
        }))
        if (sid) {
          api({
            op: 'bindSessionEngagement',
            session: sid,
            id: createdId,
            engagement: createdId,
            title: sesTitle || undefined,
          }).catch(() => {})
        }
        refreshList(createdId)
      }

      const refreshAll = () => {
        setErr(null)
        setRefreshKey((k) => k + 1)
        api({ op: 'bootstrap', session: sid || undefined }).then((b) => {
          const list = (b && b.engagements) || []
          setEngagements(list)
          if (b && Array.isArray(b.host_sessions)) setHostSessions(b.host_sessions)
          if (sid !== null) {
            if (eng) loadSnapshot(eng)
            else applySessionBinding(sid, list, sesTitle)
            return
          }
          const namedList = getNamedEngagements(list)
          const rawTarget = eng || (b && b.current) || (list[0] && list[0].id) || null
          const targetEng = (rawTarget && isRawUuidName(rawTarget) && namedList.length > 0)
            ? namedList[0].id
            : rawTarget
          if (targetEng) {
            if (!eng || targetEng !== eng) setEng(targetEng)
            loadSnapshot(targetEng)
          }
        }, () => { if (eng) loadSnapshot(eng) })
      }

      const startResize = (e) => {
        e.preventDefault()
        if (resizeCleanupRef.current) resizeCleanupRef.current()
        const startX = e.clientX
        const startW = width
        const move = (ev) => setWidth(Math.max(380, Math.min(900, startW + (startX - ev.clientX))))
        const cleanup = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', cleanup)
          if (resizeCleanupRef.current === cleanup) resizeCleanupRef.current = null
        }
        resizeCleanupRef.current = cleanup
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', cleanup)
      }

      React.useEffect(() => {
        if (!eng) { setDigest(null); setSeen(null); return undefined }
        setSeen(loadUnread(eng))
        return subscribeDigestPoller(eng, setDigest)
      }, [eng, refreshKey])

      useHostEvents(eng, () => {
        if (eng) _pollDigestHub(eng)
      }, 1200)

      const markTabSeen = React.useCallback((tab) => {
        if (!eng) return
        setSeen((prev) => {
          const base = prev || (() => {
            const fresh = {}
            for (const [k, v] of Object.entries((digest || {}))) fresh[k] = { count: Number(v.count || 0), at: v.at || null }
            return fresh
          })()
          const next = Object.assign({}, base)
          const cur = digest && digest[tab]
          if (cur) next[tab] = { count: Number(cur.count || 0), at: cur.at || null }
          saveUnread(eng, next)
          return next
        })
      }, [eng, digest])

      const unreadOf = (tab) => {
        if (!eng || !digest) return false
        if (!seen) return false
        return digestHasNew(seen[tab], digest[tab])
      }

      const goTab = (tab) => { markTabSeen(tab); setUI({ tab: tab }) }

      const handleSkipOnboarding = () => {
        setSessionState((prev) => Object.assign({}, prev || {}, {
          bound: null,
          init_state: 'skipped',
          onboarding_dismissed: true,
        }))
        setFollowSource('skipped')
        if (sid) {
          api({
            op: 'sessionOnboarding',
            session: sid,
            action: 'skip',
            title: sesTitle || undefined,
          }).catch(() => {})
        }
        goTab('overview')
      }

      const handleReopenOnboarding = () => {
        setSessionState((prev) => Object.assign({}, prev || {}, {
          init_state: (prev && prev.bound) ? 'initialized' : 'uninitialized',
          onboarding_dismissed: false,
        }))
        if (!eng) setFollowSource('unbound')
        if (sid) {
          api({
            op: 'sessionOnboarding',
            session: sid,
            action: 'reopen',
            title: sesTitle || undefined,
          }).catch(() => {})
        }
        goTab('collab')
      }

      const namedEngagements = getNamedEngagements(engagements)
      const visibleEngagements = namedEngagements.length > 0 ? namedEngagements : engagements
      const sessionDisplayLabel = (!isRawUuidName(sesTitle) && sesTitle)
        ? sesTitle
        : (sid ? sid.slice(0, 8) : '当前会话')

      const selectorOptions = []
      if (sid && !eng) {
        selectorOptions.push({
          value: '__session_unbound__',
          label: '当前会话 · ' + sessionDisplayLabel + (sessionState && sessionState.onboarding_dismissed ? '（未绑定）' : '（待初始化）'),
        })
        for (const x of visibleEngagements) {
          selectorOptions.push({
            value: x.id,
            label: '关联已有 · ' + (x.name || x.id),
          })
        }
      } else {
        for (const x of visibleEngagements) {
          selectorOptions.push({
            value: x.id,
            label: x.name || x.id,
          })
        }
      }

      const currentEngObj = eng ? (engagements.find((x) => x.id === eng) || null) : null
      const currentEngName = eng
        ? ((currentEngObj && currentEngObj.name && !isRawUuidName(currentEngObj.name))
            ? currentEngObj.name
            : ((snapshot && snapshot.engagement && snapshot.engagement.name && !isRawUuidName(snapshot.engagement.name))
                ? snapshot.engagement.name
                : eng))
        : ((!isRawUuidName(sesTitle) && sesTitle) || '未绑定工作区')

      const tabs = [
        ['assets', '模块与服务'],
        ['agents', '智能体与并发'],
        ['prompts', '角色与提示词'],
        ['sessions', '运行环境'],
        ['artifacts', '构建产物'],
        ['findings', '代码审查与缺陷'],
        ['scores', '交付里程碑'],
        ['report', '研发交付报告'],
        ['knowledge', '工程模式库'],
        ['skills', '研发技能库'],
      ]
      const TAB_GROUPS = [
        { key: 'collab', label: '协同与审批', tabs: ['collab'] },
        { key: 'overview', label: '总览', tabs: ['overview'] },
        { key: 'assets', label: '架构', tabs: ['assets'] },
        { key: 'results', label: '质量', tabs: ['findings', 'scores'] },
        { key: 'report', label: '报告', tabs: ['report'] },
        { key: 'resources', label: '集群', tabs: ['agents', 'prompts', 'sessions', 'artifacts', 'knowledge', 'skills'] },
      ]
      const groupOf = (tab) => TAB_GROUPS.find((g) => g.tabs.indexOf(tab) !== -1) || TAB_GROUPS[1]
      const activeGroup = groupOf(st.tab)
      const openFull = () => { openFullView() }

      React.useEffect(() => {
        if (!full) return undefined
        const onKey = (e) => { if (e.key === 'Escape') exitFull() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [full, exitFull])

      const effectiveKbEng = (!isRawUuidName(boundEng) && boundEng) || (!isRawUuidName(eng) && eng) || ''
      const pendingApprovalsCount = eng && typeof countPendingApprovals === 'function'
        ? Number(countPendingApprovals(snapshot, null) || 0)
        : 0
      const isSessionDismissed = Boolean(sessionState && sessionState.onboarding_dismissed)
      const canReopenOnboarding = Boolean(sid && !eng && isSessionDismissed && !(sessionState && sessionState.has_conversation))
      const needsSessionInit = Boolean(sid && !eng && !isSessionDismissed)

      let body
      if (err) {
        body = h('div', { className: 'rt-err' }, err)
      } else if (st.tab === 'collab') {
        body = typeof CollabApprovalTab === 'function'
          ? h(CollabApprovalTab, {
              engagement: eng,
              engagementName: currentEngName,
              engagements: visibleEngagements,
              sessionId: sid,
              sessionTitle: sesTitle,
              sessionState: sessionState,
              snapshot: snapshot,
              refreshKey: refreshKey,
              onCreateForSession: (name) => openEngagement(name),
              onBindExisting: (targetId) => bindExistingWorkspace(targetId),
              onSkipOnboarding: handleSkipOnboarding,
              onReopenOnboarding: handleReopenOnboarding,
              onWorkspaceSelect: handleWorkspaceSelect,
              onRefresh: refreshAll,
              onGo: goTab,
            })
          : h('div', { className: 'rt-pane' },
              h('div', { className: 'rt-card' },
                h('h4', { style: { marginTop: 0 } }, '协同与审批工作台'),
                h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 10 } },
                  eng ? ('当前已绑定工作区「' + currentEngName + '」。') : '当前会话尚未绑定工作区，可立即初始化或跳过指引保持空白会话。'),
                !eng
                  ? h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                      h('button', { type: 'button', className: 'rt-btn rt-btn-primary', onClick: () => openEngagement(sessionDisplayLabel) }, '为当前会话创建工作区'),
                      h('button', { type: 'button', className: 'rt-btn', onClick: handleSkipOnboarding }, '跳过指引'))
                  : null))
      } else if (st.tab === 'overview') {
        body = h(OverviewTab, {
          engagement: eng,
          engagementName: currentEngName,
          snapshot: snapshot,
          refreshKey: refreshKey,
          sessionId: sid,
          sessionTitle: sesTitle,
          sessionState: sessionState,
          onReopenOnboarding: handleReopenOnboarding,
          onGo: (tab) => goTab(tab),
          onRefresh: refreshAll,
          onWorkspaceSelect: handleWorkspaceSelect,
        })
      } else if (st.tab === 'agents') {
        body = h(AgentsTab, { engagement: eng, sessionId: sid, refreshKey: refreshKey, onGo: goTab })
      } else if (st.tab === 'prompts') {
        body = h(RolePromptsHubTab, { engagement: eng, sessionId: sid, refreshKey: refreshKey, onGo: goTab })
      } else if (st.tab === 'artifacts') {
        body = h(ArtifactsTab, { engagement: eng, refreshKey: refreshKey })
      } else if (st.tab === 'knowledge') {
        body = h(KnowledgeTab, { refreshKey: refreshKey, engagement: effectiveKbEng })
      } else if (st.tab === 'skills') {
        body = h(SkillsTab, { engagement: eng, refreshKey: refreshKey })
      } else if (!eng) {
        body = h('div', { className: 'rt-pane' },
          h('div', { className: 'rt-card' },
            h('h4', { style: { marginTop: 0 } }, '当前会话尚未初始化工作区'),
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12, lineHeight: 1.6 } },
              'LMTAgent 采用严格的 1:1 会话工作区隔离：新会话默认保持干净，绝不串用其他会话的项目数据。请前往「协同与审批」为当前会话初始化独立工作台，或关联已有项目。'),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h('button', {
                type: 'button',
                className: 'rt-btn rt-btn-primary',
                onClick: () => goTab('collab'),
              }, '前往「协同与审批」初始化当前会话工作台 →'),
              canReopenOnboarding
                ? h('button', {
                    type: 'button',
                    className: 'rt-btn',
                    onClick: handleReopenOnboarding,
                  }, '🧭 重新获取初始化指引')
                : null)))
      } else if (st.tab === 'assets' || st.tab === 'testing') {
        body = h(AssetsTab, { engagement: eng, snapshot: snapshot, refreshKey: refreshKey, onRefresh: refreshAll, onData: () => loadSnapshot(eng) })
      } else if (st.tab === 'sessions') {
        body = h(SessionTab, { engagement: eng, refreshKey: refreshKey })
      } else if (st.tab === 'findings' || st.tab === 'attackfiles') {
        body = h(FindingsTab, { engagement: eng, refreshKey: refreshKey })
      } else if (st.tab === 'report') {
        body = h(ReportTab, { engagement: eng, refreshKey: refreshKey })
      } else {
        body = h(ScoreTab, { engagement: eng, refreshKey: refreshKey })
      }

      const shellProps = full
        ? { className: 'rt-full', style: { display: 'flex' } }
        : (embedMode
            ? { className: 'rt-embed', 'data-open': '1', style: { display: 'flex', width: '100%', height: '100%' } }
            : { className: 'rt-dock', 'data-open': st.open ? '1' : '0', style: { width: width + 'px', display: st.open ? 'flex' : 'none' } })

      const hasCleanBoundDiff = manualHere() && boundEng !== null && !isRawUuidName(boundEng) && boundEng !== eng

      return h('div', shellProps,
        (full || embedMode) ? null : h('div', { className: 'rt-grip', onMouseDown: startResize }),
        h('div', { className: 'rt-head' },
          h('div', { className: 'rt-title' }, h('span', { className: 'rt-dot' }),
            full ? 'LMTAgent 全面浏览' : 'LMTAgent 研发控制台',
            full ? h('span', { className: 'rt-tag', style: { marginLeft: 6 } }, '全屏视图') : null),
          sid === null
            ? null
            : (!eng
                ? (isSessionDismissed
                    ? h('span', {
                        className: 'rt-tag rt-tag-passive',
                        title: '当前会话已跳过初始化指引，保持干净独立态',
                      }, '已跳过指引')
                    : h('span', {
                        className: 'rt-tag rt-tag-warn',
                        title: '当前会话尚未绑定研发工作区，可在「协同与审批」初始化或跳过指引',
                      }, '待初始化'))
                : (hasCleanBoundDiff
                    ? h('span', Object.assign({
                        className: 'rt-tag rt-tag-warn',
                        style: { cursor: 'pointer' },
                        title: '当前已手动切换工作区；点击切回当前会话绑定的「' + boundEng + '」',
                      }, clickable(() => {
                        manualPickRef.current = null
                        setFollowing(true)
                        setFollowSource('bound')
                        setEng(boundEng)
                        rememberEngagement(boundEng)
                        loadSnapshot(boundEng)
                      }, { label: '切回当前会话绑定工作区：' + boundEng })), '手动选择：' + boundEng)
                    : h('span', {
                        className: 'rt-tag rt-tag-live',
                        title: '控制台正 1:1 跟随当前会话绑定的研发工作区',
                      }, '跟随会话'))),
          canReopenOnboarding
            ? h('button', {
                type: 'button',
                className: 'rt-btn rt-btn-primary',
                style: { padding: '2px 8px', fontSize: 11.5 },
                title: '当前会话尚无对话记录，点击重新打开工作台初始化指引',
                onClick: handleReopenOnboarding,
              }, '🧭 重新指引')
            : null,
          h('select', {
            className: 'rt-input',
            style: { maxWidth: '185px' },
            value: eng || (sid ? '__session_unbound__' : ((selectorOptions[0] && selectorOptions[0].value) || '')),
            'aria-label': '切换研发工作区或关联已有项目',
            onChange: (e) => {
              const next = e.target.value
              if (!next || next === '__session_unbound__') return
              if (sid && !eng) {
                bindExistingWorkspace(next)
                return
              }
              manualPickRef.current = sid || ''
              setFollowing(false)
              setFollowSource(null)
              setEng(next)
              rememberEngagement(next)
              loadSnapshot(next)
              if (sid !== null) {
                api({
                  op: 'bindSessionEngagement',
                  session: sid,
                  id: next,
                  engagement: next,
                  title: sesTitle || undefined,
                }).catch(() => {})
              }
              api({ op: 'activateEngagement', id: next, engagement: next, session: sid || undefined }).catch(() => {})
            },
          }, selectorOptions.length > 0
            ? selectorOptions.map((opt) => h('option', { key: opt.value, value: opt.value }, opt.label))
            : h('option', { value: '' }, currentEngName)),
          h('div', { className: 'rt-spacer' }),
          h(UiModeSwitcher, { compact: true }),
          h(VersionBar, null),
          full
            ? h('button', { className: 'rt-btn', title: '回到带侧栏的普通界面（或按 Esc）', onClick: exitFull }, '退出全屏')
            : null,
          h('button', { className: 'rt-btn', title: '刷新工作区、会话遥测与当前页面数据', onClick: refreshAll }, '刷新'),
          full ? null : h('button', {
            className: 'rt-btn',
            title: isDesktopShell() ? '在当前窗口全屏打开完整控制台（Esc 退出）' : '在新浏览器窗口打开完整控制台',
            onClick: openFull,
          }, '全面浏览'),
          (full || embedMode) ? null : h('button', { className: 'rt-btn', title: '收起面板（对话列恢复全宽）', onClick: () => setUI({ open: false }) }, '收起')),
        h('div', { className: 'rt-tabs rt-tabs-groups', role: 'navigation', 'aria-label': '控制台分区' },
          TAB_GROUPS.map((g) => {
            const on = activeGroup.key === g.key
            const showCollabInitBadge = g.key === 'collab' && needsSessionInit
            const showCollabApprovalBadge = g.key === 'collab' && !showCollabInitBadge && pendingApprovalsCount > 0
            return h('div', Object.assign({}, clickable(() => goTab(g.tabs[0]), { label: g.label }), {
              key: g.key, className: 'rt-tab rt-tab-group' + (on ? ' on' : ''),
              title: '切换到「' + g.label + '」分区',
            }),
              g.label,
              showCollabInitBadge
                ? h('span', {
                    className: 'rt-tag rt-tag-warn',
                    style: { marginLeft: 5, padding: '0 5px', fontSize: 10, lineHeight: '15px' },
                  }, '待初始化')
                : (showCollabApprovalBadge
                    ? h('span', {
                        className: 'rt-tag rt-tag-live',
                        style: { marginLeft: 5, padding: '0 5px', fontSize: 10, lineHeight: '15px' },
                      }, String(pendingApprovalsCount))
                    : null))
          })),
        h('div', {
          className: 'rt-tabs rt-tabs-sub',
          role: 'tablist',
          style: activeGroup.tabs.length > 1 ? undefined : { display: 'none' },
        }, tabs.map((t) => {
          const visible = activeGroup.tabs.indexOf(t[0]) !== -1
          return h('div', Object.assign({}, clickable(() => goTab(t[0]), { label: t[1] }), {
            key: t[0], className: 'rt-tab' + (st.tab === t[0] ? ' on' : ''),
            role: 'tab',
            'aria-selected': st.tab === t[0] ? 'true' : 'false',
            style: visible ? undefined : { display: 'none' },
            title: unreadOf(t[0]) ? t[1] + '：有新内容，点开看过红点就会消失' : t[1],
          }), t[1], unreadOf(t[0])
            ? h('span', { className: 'rt-tab-dot', 'aria-label': '有新内容' })
            : null)
        })),
        h('div', { className: 'rt-body' }, h(RtBoundary, { key: st.tab }, body)),
        h('div', { className: 'rt-foot' },
          h('span', { className: 'rt-wb-badge' },
            st.uiMode === 'novice' ? 'LMTAgent · AI 协同工作台' : 'LMTAgent · 8-Role · 4-Wave DAG'),
          h('div', { className: 'rt-spacer' }),
          full ? h('span', null, '按 Esc 或点右上角「退出全屏」回到带侧栏的界面') : null,
          eng
            ? h('span', null, (st.uiMode === 'novice' ? '工作区 · ' : 'PG/WAL · ') + currentEngName)
            : h('span', null, isSessionDismissed ? '当前会话 · 独立空白态（未绑定工作区）' : '当前会话 · 待初始化工作区'),
          sid === null
            ? null
            : h('span', {
                title: '当前会话 ' + sid + (sesTitle ? '（' + sesTitle + '）' : '')
                  + '；工作区状态：' + (FOLLOW_SOURCE[followSource] || '实时同步'),
              }, '会话 ' + sid.slice(0, 8) + (followSource && FOLLOW_SOURCE[followSource] ? ' · ' + FOLLOW_SOURCE[followSource] : ''))))
    }

    /* ---------------------------------------------------------- 精简宿主入口按钮（零重复胶囊） */
    function SidebarButton() {
      const st = useUI()
      return h('button', {
        className: 'rt-icon-btn' + (st.open ? ' on' : ''),
        title: 'LMTAgent 研发控制台（常驻右侧栏）',
        onClick: () => setUI({ open: !st.open }),
      }, h('span', { style: { fontSize: 14 } }, '⚡'))
    }

    function HeaderButton(props) {
      const st = useUI()
      const sid = sessionIdOf(props)
      const title = sessionTitleOf(props)
      React.useEffect(() => { if (sid || title) setSessionId(sid, title) }, [sid, title])
      return h('button', {
        className: 'rt-hbtn' + (st.open ? ' on' : ''),
        title: 'LMTAgent 研发控制台（切换右侧常驻工作台）',
        onClick: () => setUI({ open: !st.open }),
      }, '⚡ LMTAgent 控制台')
    }

    /* ---------------------------------------------------------- 插件入口（6 个精准去重槽位） */
    const inject = ['slots']

    function apply(ctx) {
      const styleTag = document.createElement('style')
      styleTag.setAttribute('data-redteam-ui', '1')
      styleTag.textContent = CSS
      document.head.append(styleTag)

      const widthTag = document.createElement('style')
      widthTag.setAttribute('data-redteam-ui-width', '1')
      widthTag.textContent = ':root{--rt-dock-w:540px}'
      document.head.append(widthTag)
      dockWidthTag = widthTag

      ctx.effect(() => () => {
        styleTag.remove()
        widthTag.remove()
        dockWidthTag = null
      })

      /* 1. 右侧常驻浮动工作台（shell.overlay） */
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'redteam-console', order: 50 },
        () => h(Panel),
      ))

      /* 2. 主视图面板与左侧导航项（main + sidebar.panellist） */
      ctx.slots.inject('main', () => ctx.slots.register(
        { name: 'main', id: 'lmtagent-workbench', key: 'lmtagent-workbench', order: 35 },
        (props) => h(Panel, Object.assign({ embedMode: 'main' }, props)),
      ))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
        { name: 'sidebar.panellist', id: 'lmtagent-panellist', key: 'lmtagent-workbench', label: 'LMTAgent 控制台', order: 35 },
        (props) => h(SidebarButton, props),
      ))

      /* 3. 会话主视图二级页签（conversation.view · 权威会话隔离） */
      ctx.slots.inject('conversation.view', () => ctx.slots.register(
        { name: 'conversation.view', id: 'lmtagent-view', key: 'lmtagent-view', label: '⚡ LMTAgent 研发台', order: 45 },
        (props) => h(Panel, Object.assign({ embedMode: 'session' }, props)),
      ))

      /* 4. 窗口右上角会话工具栏（conversation.session.header.utilities · 单一会话顶栏开关） */
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'redteam-header-toggle', order: 50, label: 'LMTAgent' },
        (props) => h(HeaderButton, props),
      ))

      /* 5. 设置页专区（settings.section） */
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'lmtagent-settings', order: 50, label: 'LMTAgent 研发集群' },
        () => h('div', { className: 'rt-card', style: { margin: 12 } },
          h('h4', null, 'LMTAgent · 软件工程多智能体研发控制台 (ECCVIK/LMTAgent)'),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 8 } },
            '8 角色 gstack 协同研发 · 4-Wave Bounded DAG · 1:1 会话工作区隔离'),
          h('button', { className: 'rt-btn rt-btn-primary', onClick: () => setUI({ open: true }) }, '打开 LMTAgent 研发控制台')),
      ))

      /* 6. 若宿主启用了 betterSidebar 服务，同步注册左侧导航项 */
      try {
        if (ctx.betterSidebar && typeof ctx.betterSidebar.registerItem === 'function') {
          ctx.betterSidebar.registerItem({
            id: 'lmtagent-workbench',
            label: 'LMTAgent 控制台',
            order: 35,
            onClick: () => setUI({ open: !ui.open }),
          })
        }
      } catch (e) { /* optional service */ }
    }

    exports.apply = apply
    exports.inject = inject
    /* 纯函数导出：单测直接验"文件名 / 会话标题 / 工作区名"匹配规则与 Markdown 渲染 */
    exports.squashName = squashName
    exports.engagementByTitle = engagementByTitle
    exports.renderInline = renderInline
    exports.Markdown = Markdown
    return module.exports
  },
})
