    /* ---------------------------------------------------------- 02-telemetry-probe：DOM 遥测与 Token 解析 */
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

    /** 从 localStorage / 宿主值安全解包真实 sessionId（兼容 `{"sessionId":"..."}` 对象序列化格式） */
    const parseDshStoredSessionId = (raw) => {
      if (!raw) return null
      if (typeof raw === 'object') {
        const objSid = raw.sessionId || raw.id || raw.currentSessionId || ''
        return typeof objSid === 'string' && objSid.trim() ? objSid.trim() : null
      }
      let s = String(raw).trim()
      if (!s) return null
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('"') && s.endsWith('"'))) {
        try {
          const parsed = JSON.parse(s)
          if (typeof parsed === 'string') s = parsed.trim()
          else if (parsed && typeof parsed === 'object') {
            const inner = parsed.sessionId || parsed.id || parsed.currentSessionId || ''
            s = typeof inner === 'string' ? inner.trim() : ''
          }
        } catch { /* keep trimmed raw if unparseable */ }
      }
      return s && !s.startsWith('{') ? s : null
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
          const sid = parseDshStoredSessionId(window.localStorage.getItem('dsh.sessions.current'))
          if (sid) out.sessionId = sid
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
