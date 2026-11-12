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
