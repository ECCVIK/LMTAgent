    /* ---------------------------------------------------------- 05-overview-tab：低密度实时集群总览 + 可展开详表 */
    /**
     * 纯 SVG 轻量环形占比图（参照 p3/p4 视觉规范，零第三方图表依赖）。
     */
    function RtMiniDonut(props) {
      const segments = Array.isArray(props.segments) ? props.segments.filter((s) => (Number(s.value) || 0) > 0) : []
      const total = segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0)
      const r = 34
      const circ = 2 * Math.PI * r
      let offset = 0
      const arcs = total > 0
        ? segments.map((s, idx) => {
            const len = ((Number(s.value) || 0) / total) * circ
            const el = h('circle', {
              key: 'arc-' + idx,
              cx: 46,
              cy: 46,
              r: r,
              fill: 'none',
              stroke: s.color || '#4d6bfe',
              strokeWidth: 11,
              strokeDasharray: len.toFixed(2) + ' ' + circ.toFixed(2),
              strokeDashoffset: (-offset).toFixed(2),
              transform: 'rotate(-90 46 46)',
            })
            offset += len
            return el
          })
        : [h('circle', {
            key: 'arc-empty',
            cx: 46,
            cy: 46,
            r: r,
            fill: 'none',
            stroke: 'var(--dsw-alias-border-l1, #e2e8f0)',
            strokeWidth: 11,
          })]
      return h('div', { className: 'rt-ov-donut-box' },
        h('svg', { width: 92, height: 92, viewBox: '0 0 92 92', 'aria-hidden': 'true' }, ...arcs),
        h('div', { className: 'rt-ov-donut-center' },
          h('div', { className: 'rt-ov-donut-main' }, props.centerMain || '0'),
          props.centerSub ? h('div', { className: 'rt-ov-donut-sub' }, props.centerSub) : null))
    }

    /**
     * 多段横向比例条（mini=true 用于 4 宫格概览卡内微缩条，mini=false 用于详表主比例条）。
     */
    function RtStackedBar(props) {
      const segments = Array.isArray(props.segments) ? props.segments.filter((s) => (Number(s.value) || 0) > 0) : []
      const total = segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0)
      const cls = props.mini ? 'rt-ov-mini-bar' : 'rt-ov-seg-bar'
      const segCls = props.mini ? 'rt-ov-mini-seg' : 'rt-ov-seg-piece'
      if (total <= 0) {
        return h('div', { className: cls })
      }
      return h('div', { className: cls },
        segments.map((s, idx) => {
          const pct = Math.max(2, ((Number(s.value) || 0) / total) * 100)
          return h('div', {
            key: 'seg-' + idx,
            className: segCls,
            style: { width: pct.toFixed(2) + '%', background: s.color || '#4d6bfe' },
            title: (s.label || '') + ': ' + (s.display || String(s.value)),
          })
        }))
    }

    /**
     * LMTAgent 软件工程研发控制台 · 纯净低密度总览页（OverviewTab）：
     *   · 默认折叠态：1 行待办审批横幅 + 4 张紧凑 KPI 卡 + 派生树状图画布（彻底移除旧版 p1 渗透四阶段条）
     *   · 点击任意 KPI 卡可展开对应 p3/p4/p5 风格详细表状分析面板，再次点击即可收起
     */
    function OverviewTab(props) {
      useLocale()
      const eng = props.engagement
      const engName = props.engagementName || eng
      const snapshot = props.snapshot
      const refreshKey = props.refreshKey || 0
      const onGo = props.onGo || (() => {})
      const currentSess = useSession()
      const activeSid = props.sessionId || currentSess.id || null

      const [agents, setAgents] = React.useState(null)
      const [dagData, setDagData] = React.useState(null)
      const [domTel, setDomTel] = React.useState(() => readHostDomTelemetry())
      const [expandedKey, setExpandedKey] = React.useState(null)
      const [sessionDetail, setSessionDetail] = React.useState(null)
      const [detailLoading, setDetailLoading] = React.useState(false)
      const [err, setErr] = React.useState(null)
      const [localRefresh, setLocalRefresh] = React.useState(0)
      const loadSeq = React.useRef(0)

      const load = React.useCallback(() => {
        const mySeq = ++loadSeq.current
        setDomTel(readHostDomTelemetry())
        if (!eng) {
          setAgents(null)
          setDagData(null)
          setSessionDetail(null)
          setErr(null)
          return
        }
        setErr(null)
        Promise.all([
          api({ op: 'agentsStatus', engagement: eng, session: activeSid || undefined }),
          api({ op: 'workflowDag', engagement: eng, session: activeSid || undefined }),
        ]).then(([ag, dg]) => {
          if (mySeq !== loadSeq.current) return
          if (!ag || ag.ok === false) {
            setErr((ag && ag.error) || t('读取工作台状态失败', 'Failed to read workspace status'))
            return
          }
          setAgents(ag)
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

      /* 仅当展开「沟通与执行」或「上下文与缓存」详表时按需加载会话明细 */
      React.useEffect(() => {
        if (!eng || (expandedKey !== 'comms' && expandedKey !== 'context')) return
        let alive = true
        setDetailLoading(true)
        api({
          op: 'agentSessionDetail',
          engagement: eng,
          session: activeSid || undefined,
        }).then((res) => {
          if (!alive) return
          setDetailLoading(false)
          if (res && res.ok !== false) setSessionDetail(res)
        }, () => {
          if (alive) setDetailLoading(false)
        })
        return () => { alive = false }
      }, [eng, activeSid, expandedKey, refreshKey, localRefresh])

      const cleanSessionTitle = (props.sessionTitle && !isRawUuidName(props.sessionTitle) ? props.sessionTitle : null)
        || (currentSess.title && !isRawUuidName(currentSess.title) ? currentSess.title : null)
        || (activeSid ? (t('会话 ', 'Session ') + formatShortSessionId(activeSid)) : t('当前新会话', 'New Session'))

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
                  h('span', { className: 'rt-tag rt-tag-live' }, t('独立会话隔离', 'Session Isolated')),
                  h('span', { className: 'rt-mono', style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                    t('当前会话：', 'Session: ') + cleanSessionTitle),
                  sState && sState.cwd
                    ? h('span', { className: 'rt-tag rt-mono' }, sState.cwd)
                    : null),
                h('div', { className: 'rt-ov-standby-title' },
                  cleanSessionTitle + t(' · 未绑定工作台', ' · Unbound Workspace')),
                h('div', { className: 'rt-ov-standby-sub' },
                  t('0 运行中智能体 · 0 已拆解模块 · 每个会话拥有专属 1:1 隔离工作台。', '0 running agents · 0 shards · Each session gets an isolated 1:1 workspace.')),
                h('div', { className: 'rt-ov-standby-actions' },
                  h('button', {
                    type: 'button',
                    className: 'rt-btn rt-btn-primary',
                    onClick: () => onGo('collab'),
                  }, t('前往「协同与审批」初始化', 'Initialize in Collab & Approval')),
                  isDismissed && !hasConv
                    ? h('button', {
                        type: 'button',
                        className: 'rt-btn',
                        style: { borderColor: 'rgba(59,130,246,0.45)', color: 'var(--wb-blue-ink,#2563eb)', fontWeight: 700 },
                        onClick: () => {
                          if (typeof props.onReopenOnboarding === 'function') props.onReopenOnboarding()
                          onGo('collab')
                        },
                      }, t('重新获取初始化指引', 'Reopen Setup Guide'))
                    : null)))))
      }

      const stats = (snapshot && snapshot.stats) || {}
      const used = agents ? (Number(agents.used) || 0) : 0
      const max = agents ? (Number(agents.max) || 6) : 6
      const hostSessions = (agents && Array.isArray(agents.host_sessions)) ? agents.host_sessions : []
      const activeHostSess = hostSessions.find((hs) => hs.id === (activeSid || domTel.sessionId)) || hostSessions[0] || null
      const netChildren = (agents && agents.agentNetwork && Array.isArray(agents.agentNetwork.children))
        ? agents.agentNetwork.children
        : ((agents && Array.isArray(agents.children)) ? agents.children : [])
      const dagTasks = (dagData && Array.isArray(dagData.worker_tasks)) ? dagData.worker_tasks : []
      const dagDigests = (dagData && Array.isArray(dagData.worker_digests)) ? dagData.worker_digests : []
      const shardLocks = (dagData && Array.isArray(dagData.shard_locks))
        ? dagData.shard_locks
        : ((agents && Array.isArray(agents.shard_locks)) ? agents.shard_locks : [])
      const pgProbe = (agents && agents.pg_probe) || (dagData && dagData.pg_probe) || null
      const pgWorkerTaskCount = (pgProbe && pgProbe.row_counts && Number(pgProbe.row_counts.worker_tasks)) || 0
      const budgetGuard = (dagData && dagData.budgetGuard)
        || (agents && agents.budgetGuard)
        || (snapshot && snapshot.budgetGuard)
        || null
      const perfMetrics = (dagData && dagData.perfMetrics)
        || (agents && agents.perfMetrics)
        || (snapshot && snapshot.perfMetrics)
        || null

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
        : ((activeHostSess && activeHostSess.speedLabel) ? activeHostSess.speedLabel : (realTokens > 0 ? t('实时采样', 'Live') : '0 tok/s'))
      const cacheHitPct = domTel.cacheHitPct > 0
        ? domTel.cacheHitPct
        : (activeHostSess && Number(activeHostSess.cacheHitPct) ? Number(activeHostSess.cacheHitPct) : 0)
      const realCacheShort = domTel.cacheLabel && domTel.cacheLabel !== '待命'
        ? (getLocale() === 'en-US' ? (cacheHitPct > 0 ? ('Cache ' + cacheHitPct + '%') : 'Cache Idle') : domTel.cacheLabel)
        : (cacheHitPct > 0 ? (t('缓存 ', 'Cache ') + cacheHitPct + '%') : t('缓存待命', 'Cache Idle'))

      const ctxUsedNum = domTel.contextUsedLabel
        ? parseTokNum(domTel.contextUsedLabel)
        : ((activeHostSess && Number(activeHostSess.contextTokens)) || 0)
      const ctxMaxNum = domTel.contextMaxLabel
        ? parseTokNum(domTel.contextMaxLabel)
        : ((activeHostSess && Number(activeHostSess.contextMax)) || 421000)
      const ctxShort = domTel.contextUsedLabel
        ? (domTel.contextUsedLabel + '/' + (domTel.contextMaxLabel || '421k'))
        : (ctxUsedNum > 0 ? (fmtTokNum(ctxUsedNum) + '/' + fmtTokNum(ctxMaxNum)) : '0/421k')
      const ctxPctLabel = domTel.contextPct
        || (ctxUsedNum > 0 && ctxMaxNum > 0 ? Math.round((ctxUsedNum / ctxMaxNum) * 100) + '%' : '0%')

      const inputTok = parseTokNum(domTel.inputLabel)
      const outputTok = parseTokNum(domTel.outputLabel)
      const reasonTok = parseTokNum(domTel.reasoningLabel)
      const costText = domTel.costLabel || (activeHostSess && activeHostSess.costLabel) || t('暂无', 'N/A')

      const doneTasks = dagTasks.filter((tItem) => tItem.status === 'done' || tItem.status === 'approved' || tItem.status === 'completed').length
      const pendingCount = typeof countPendingApprovals === 'function' ? countPendingApprovals(snapshot, dagData) : 0
      const realPgWrites = (pgProbe && typeof pgProbe.total_writes === 'number')
        ? pgProbe.total_writes
        : ((Number(stats.assets) || 0) + (Number(stats.vulns) || 0) + (Number(stats.steps) || 0))
      const hasActiveWork = totalDispatchedSubagents > 0 || realPgWrites > 0

      const workspaceDisplayTitle = (engName && !isRawUuidName(engName) ? engName : null)
        || (props.sessionTitle && !isRawUuidName(props.sessionTitle) ? props.sessionTitle : null)
        || cleanSessionTitle
        || engName

      const pm = perfMetrics && typeof perfMetrics === 'object' ? perfMetrics : {}
      const digestCompPctText = Number.isFinite(Number(pm.digestCompressionRatioPct))
        ? (Number(pm.digestCompressionRatioPct) + '%')
        : (pgProbe && typeof pgProbe.compression_ratio_pct === 'number'
          ? (pgProbe.compression_ratio_pct + '%')
          : t('暂无', 'N/A'))
      const parallelEffText = Number.isFinite(Number(pm.parallelismEfficiencyPct))
        ? (Number(pm.parallelismEfficiencyPct) + '%')
        : (max > 0 ? Math.round((activeSlots / max) * 100) + '%' : t('暂无', 'N/A'))
      const schemaTokenSavedText = Number.isFinite(Number(pm.schemaTokenSavedEstimate))
        ? (fmtTokNum(Number(pm.schemaTokenSavedEstimate)) + ' tok')
        : t('暂无', 'N/A')
      const scopeComplianceText = Number.isFinite(Number(pm.scopeCompliancePct))
        ? (Number(pm.scopeCompliancePct) + '%')
        : t('暂无', 'N/A')

      const toggleCard = (key) => {
        setExpandedKey((prev) => (prev === key ? null : key))
      }

      /* ── 4 张紧凑 KPI 卡配置 ── */
      const kpiCards = [
        {
          key: 'comms',
          label: t('沟通与执行', 'Execution'),
          val: t(realRounds + ' 轮 · ' + realSteps + ' 步', realRounds + ' rounds · ' + realSteps + ' steps'),
          sub: t('输出速度 ', 'Throughput ') + realSpeedLabel,
          segments: [
            { label: t('模型输入', 'Input'), value: Math.max(inputTok, realRounds > 0 ? 60 : 0), color: '#4d6bfe' },
            { label: t('模型输出', 'Output'), value: Math.max(outputTok, realSteps > 0 ? 25 : 0), color: '#0ea5e9' },
            { label: t('思考推理', 'Reasoning'), value: reasonTok, color: '#8b5cf6' },
          ],
        },
        {
          key: 'cluster',
          label: t('并发集群', 'Concurrency'),
          val: t(activeSlots + '/' + max + ' 槽', activeSlots + '/' + max + ' slots'),
          accent: true,
          sub: t('累计调度 ' + totalDispatchedSubagents + ' 个子代理', totalDispatchedSubagents + ' subagents dispatched'),
          segments: [
            { label: t('运行中槽位', 'Active Slots'), value: activeSlots, color: '#4d6bfe' },
            { label: t('空闲可用槽位', 'Idle Slots'), value: Math.max(0, max - activeSlots), color: '#cbd5e1' },
          ],
        },
        {
          key: 'context',
          label: t('上下文与缓存', 'Context & Cache'),
          val: ctxShort + ' · ' + realCacheShort,
          sub: t('总计 ' + realTokenLabel + ' tok · 费用 ' + costText, 'Total ' + realTokenLabel + ' tok · Cost ' + costText),
          segments: [
            { label: t('缓存命中', 'Cache Hit'), value: cacheHitPct > 0 ? cacheHitPct : (realTokens > 0 ? 50 : 0), color: '#10b981' },
            { label: t('非缓存输入', 'Uncached'), value: cacheHitPct > 0 ? Math.max(0, 100 - cacheHitPct) : (realTokens > 0 ? 50 : 0), color: '#4d6bfe' },
          ],
        },
        {
          key: 'delivery',
          label: t('交付进度', 'Delivery'),
          val: dagTasks.length > 0 ? t(doneTasks + '/' + dagTasks.length + ' 分片', doneTasks + '/' + dagTasks.length + ' shards') : t('待立项拆解', 'Pending Launch'),
          sub: t('已提交摘要 ' + dagDigests.length + ' 份 · 排他锁 ' + shardLocks.length + ' 项', dagDigests.length + ' digests · ' + shardLocks.length + ' locks'),
          segments: [
            { label: t('已完成分片', 'Completed'), value: doneTasks, color: '#10b981' },
            { label: t('推进中/待审', 'In Progress / Pending'), value: Math.max(0, dagTasks.length - doneTasks), color: '#f59e0b' },
          ],
        },
      ]

      /* ── 可展开的 p3/p4/p5 风格详细面板渲染 ── */
      const renderDetailDrawer = () => {
        if (!expandedKey) return null
        const detailMeta = kpiCards.find((c) => c.key === expandedKey)
        const titleText = detailMeta ? detailMeta.label + t(' · 详细分析表', ' · Breakdown') : t('详细视图', 'Details')

        let bodyNode = null

        if (expandedKey === 'comms') {
          const msgs = (sessionDetail && Array.isArray(sessionDetail.messages)) ? sessionDetail.messages : []
          const recentSteps = msgs.slice(-8).reverse()
          const segs = [
            { label: t('输入 Token', 'Input Tokens'), value: inputTok, display: domTel.inputLabel || '0', color: '#4d6bfe' },
            { label: t('输出 Token', 'Output Tokens'), value: outputTok, display: domTel.outputLabel || '0', color: '#0ea5e9' },
            { label: t('推理 Token', 'Reasoning Tokens'), value: reasonTok, display: domTel.reasoningLabel || '0', color: '#8b5cf6' },
            { label: t('缓存命中率', 'Cache Hit'), value: Math.round(cacheHitPct * 10), display: cacheHitPct ? (cacheHitPct + '%') : t('待命', 'Idle'), color: '#10b981' },
          ]
          bodyNode = h('div', { className: 'rt-ov-detail-grid' },
            h('div', { className: 'rt-ov-detail-card' },
              h('div', { className: 'rt-ov-detail-card-head' },
                h('span', null, t('对话与吞吐统计', 'Dialogue & Throughput')),
                h('span', { className: 'rt-mono', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, realSpeedLabel)),
              h('div', { className: 'rt-ov-stat-tiles' },
                h('div', { className: 'rt-ov-stat-tile' },
                  h('div', { className: 'rt-ov-stat-tile-val' }, String(realRounds)),
                  h('div', { className: 'rt-ov-stat-tile-lbl' }, t('轮次', 'Rounds'))),
                h('div', { className: 'rt-ov-stat-tile' },
                  h('div', { className: 'rt-ov-stat-tile-val' }, String(realSteps)),
                  h('div', { className: 'rt-ov-stat-tile-lbl' }, t('步数', 'Steps'))),
                h('div', { className: 'rt-ov-stat-tile' },
                  h('div', { className: 'rt-ov-stat-tile-val' }, String(netChildren.length || domTel.subagentCount || 0)),
                  h('div', { className: 'rt-ov-stat-tile-lbl' }, t('子代理', 'Subagents'))),
                h('div', { className: 'rt-ov-stat-tile' },
                  h('div', { className: 'rt-ov-stat-tile-val' }, realTokenLabel),
                  h('div', { className: 'rt-ov-stat-tile-lbl' }, t('总 Token', 'Total Tokens')))),
              h('div', { className: 'rt-ov-donut-wrap' },
                h(RtMiniDonut, {
                  segments: segs.slice(0, 3),
                  centerMain: realTokenLabel,
                  centerSub: t('总用量', 'Total'),
                }),
                h('div', { className: 'rt-ov-legend-grid' },
                  segs.map((s) => h('div', { key: s.label, className: 'rt-ov-legend-row' },
                    h('span', { className: 'rt-ov-legend-name' },
                      h('span', { className: 'rt-ov-dot', style: { background: s.color } }),
                      s.label),
                    h('span', { className: 'rt-ov-legend-val rt-mono' }, s.display)))))),
            h('div', { className: 'rt-ov-detail-card' },
              h('div', { className: 'rt-ov-detail-card-head' },
                h('span', null, t('最近会话轮步明细', 'Recent Session Steps')),
                detailLoading ? h('span', { className: 'rt-tag' }, t('加载中…', 'Loading...')) : null),
              h('div', { className: 'rt-ov-table-wrap' },
                h('table', { className: 'rt-ov-table' },
                  h('thead', null,
                    h('tr', null,
                      h('th', null, t('角色', 'Role')),
                      h('th', null, t('摘要内容', 'Summary')),
                      h('th', null, t('时间', 'Time')))),
                  h('tbody', null,
                    recentSteps.length > 0
                      ? recentSteps.map((m, idx) => h('tr', { key: 'msg-' + idx },
                          h('td', null, h('span', { className: 'rt-tag' }, m.role || 'assistant')),
                          h('td', null, String(m.preview || m.text || m.summary || '—').slice(0, 80)),
                          h('td', { className: 'rt-mono' }, m.at ? String(m.at).slice(11, 19) : '—')))
                      : h('tr', null,
                          h('td', { colSpan: 3, style: { color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', padding: '14px' } },
                            t('暂无可展示的轮步事件，发送对话或启动子代理后将自动同步明细。', 'No step events yet. Details sync automatically once conversation or subagents start.'))))))))
        } else if (expandedKey === 'cluster') {
          const allWorkers = dagTasks.length > 0 ? dagTasks : netChildren
          bodyNode = h('div', { className: 'rt-ov-detail-card' },
            h('div', { className: 'rt-ov-detail-card-head' },
              h('span', null, t('并发槽位与子代理任务明细表（' + activeSlots + '/' + max + ' 槽占用）', 'Concurrency Slots & Worker Tasks (' + activeSlots + '/' + max + ' active)')),
              h('button', {
                type: 'button',
                className: 'rt-btn',
                style: { padding: '2px 9px', fontSize: 11 },
                onClick: () => onGo('agents'),
              }, t('前往「集群」完整视图 →', 'Full Cluster View →'))),
            h('div', { className: 'rt-ov-stat-tiles', style: { marginBottom: 8 } },
              h('div', { className: 'rt-ov-stat-tile' },
                h('div', { className: 'rt-ov-stat-tile-val' }, parallelEffText),
                h('div', { className: 'rt-ov-stat-tile-lbl' }, t('并行效率', 'Parallel Efficiency'))),
              h('div', { className: 'rt-ov-stat-tile' },
                h('div', { className: 'rt-ov-stat-tile-val' }, digestCompPctText),
                h('div', { className: 'rt-ov-stat-tile-lbl' }, t('摘要压缩率', 'Digest Compression'))),
              h('div', { className: 'rt-ov-stat-tile' },
                h('div', { className: 'rt-ov-stat-tile-val' }, schemaTokenSavedText),
                h('div', { className: 'rt-ov-stat-tile-lbl' }, t('Schema 节省 Token', 'Schema Token Saved'))),
              h('div', { className: 'rt-ov-stat-tile' },
                h('div', { className: 'rt-ov-stat-tile-val' }, scopeComplianceText),
                h('div', { className: 'rt-ov-stat-tile-lbl' }, t('分片合规率', 'Scope Compliance')))),
            h(RtStackedBar, {
              segments: [
                { label: t('活跃槽位', 'Active Slots'), value: activeSlots, display: activeSlots + t(' 槽', ' slots'), color: '#4d6bfe' },
                { label: t('空闲槽位', 'Idle Slots'), value: Math.max(0, max - activeSlots), display: Math.max(0, max - activeSlots) + t(' 槽', ' slots'), color: '#e2e8f0' },
              ],
            }),
            h('div', { className: 'rt-ov-table-wrap' },
              h('table', { className: 'rt-ov-table' },
                h('thead', null,
                  h('tr', null,
                    h('th', null, 'Wave'),
                    h('th', null, t('角色', 'Role')),
                    h('th', null, t('任务标题 / 目标', 'Task Title / Goal')),
                    h('th', null, t('状态', 'Status')),
                    h('th', null, t('独占文件分片', 'Owned Files')))),
                h('tbody', null,
                  allWorkers.length > 0
                    ? allWorkers.slice(0, 12).map((w, idx) => h('tr', { key: 'wk-' + idx },
                        h('td', { className: 'rt-mono' }, 'W' + (w.wave || w.wave_no || 1)),
                        h('td', null, h('span', { className: 'rt-tag' }, w.role || w.agent_role || 'worker')),
                        h('td', null, String(w.title || w.assigned_goal || w.goal || w.id || '—').slice(0, 64)),
                        h('td', null, String(w.status || w.activity || 'queued')),
                        h('td', { className: 'rt-mono' }, Array.isArray(w.files_owned) && w.files_owned.length > 0
                          ? w.files_owned.slice(0, 2).join(', ')
                          : '—')))
                    : h('tr', null,
                        h('td', { colSpan: 5, style: { color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', padding: '14px' } },
                          t('当前工作台尚未派发子代理，前往「协同与审批」立项后将展示并发分片明细。', 'No subagents dispatched yet. Launch in "Collab & Approval" to view shards.')))))))
        } else if (expandedKey === 'context') {
          const nonCachePct = cacheHitPct > 0 ? Math.max(0, Number((100 - cacheHitPct).toFixed(1))) : 0
          const ctxSegments = [
            { label: t('输入 Token', 'Input Tokens'), value: inputTok || (ctxUsedNum > 0 ? Math.round(ctxUsedNum * 0.7) : 0), display: domTel.inputLabel || (ctxUsedNum > 0 ? fmtTokNum(ctxUsedNum) : t('暂无采样', 'N/A')), color: '#4d6bfe' },
            { label: t('输出 Token', 'Output Tokens'), value: outputTok, display: domTel.outputLabel || '0', color: '#0ea5e9' },
            { label: t('推理 Token', 'Reasoning Tokens'), value: reasonTok, display: domTel.reasoningLabel || '0', color: '#8b5cf6' },
            { label: t('剩余可用窗口', 'Remaining Window'), value: Math.max(0, ctxMaxNum - ctxUsedNum), display: ctxMaxNum > ctxUsedNum ? fmtTokNum(ctxMaxNum - ctxUsedNum) : '0', color: '#e2e8f0' },
          ]
          const cacheSegments = [
            { label: t('缓存命中率', 'Cache Hit Rate'), value: cacheHitPct, display: cacheHitPct ? (cacheHitPct + '%') : t('待命', 'Idle'), color: '#10b981' },
            { label: t('非缓存输入', 'Uncached Input'), value: nonCachePct, display: nonCachePct ? (nonCachePct + '%') : '—', color: '#4d6bfe' },
          ]
          bodyNode = h('div', { className: 'rt-ov-detail-grid' },
            h('div', { className: 'rt-ov-detail-card' },
              h('div', { className: 'rt-ov-detail-card-head' },
                h('span', null, t('当前上下文窗口构成', 'Current Context Window Breakdown')),
                h('span', { className: 'rt-mono', style: { fontSize: 11.5 } }, ctxShort + ' (' + ctxPctLabel + ')')),
              h(RtStackedBar, { segments: ctxSegments }),
              h('div', { className: 'rt-ov-legend-grid' },
                ctxSegments.map((s) => h('div', { key: s.label, className: 'rt-ov-legend-row' },
                  h('span', { className: 'rt-ov-legend-name' },
                    h('span', { className: 'rt-ov-dot', style: { background: s.color } }),
                    s.label),
                  h('span', { className: 'rt-ov-legend-val rt-mono' }, s.display)))),
              h('div', { className: 'rt-ov-table-wrap' },
                h('table', { className: 'rt-ov-table' },
                  h('tbody', null,
                    h('tr', null,
                      h('td', null, t('会话总消耗 Token', 'Total Session Tokens')),
                      h('td', { className: 'rt-mono', style: { textAlign: 'right', fontWeight: 700 } }, realTokenLabel)),
                    h('tr', null,
                      h('td', null, t('参考费用（宿主实时采样）', 'Estimated Cost (Live)')),
                      h('td', { className: 'rt-mono', style: { textAlign: 'right', fontWeight: 700 } }, costText)),
                    h('tr', null,
                      h('td', null, t('Worker 摘要压缩率', 'Digest Compression Ratio')),
                      h('td', { className: 'rt-mono', style: { textAlign: 'right', fontWeight: 700 } }, digestCompPctText)),
                    h('tr', null,
                      h('td', null, t('Schema 预估节省 Token', 'Schema Token Saved Est.')),
                      h('td', { className: 'rt-mono', style: { textAlign: 'right', fontWeight: 700 } }, schemaTokenSavedText)),
                    h('tr', null,
                      h('td', null, t('并行效率 / 分片合规率', 'Parallel Efficiency / Scope Compliance')),
                      h('td', { className: 'rt-mono', style: { textAlign: 'right', fontWeight: 700 } }, parallelEffText + ' · ' + scopeComplianceText)))))),
            h('div', { className: 'rt-ov-detail-card' },
              h('div', { className: 'rt-ov-detail-card-head' },
                h('span', null, t('缓存读取与输入比例', 'Cache Read & Input Ratio')),
                h('span', { className: 'rt-tag' }, realCacheShort)),
              h('div', { className: 'rt-ov-donut-wrap' },
                h(RtMiniDonut, {
                  segments: cacheSegments,
                  centerMain: cacheHitPct ? (cacheHitPct + '%') : t('待命', 'Idle'),
                  centerSub: t('缓存命中', 'Cache Hit'),
                }),
                h('div', { className: 'rt-ov-legend-grid' },
                  cacheSegments.map((s) => h('div', { key: s.label, className: 'rt-ov-legend-row' },
                    h('span', { className: 'rt-ov-legend-name' },
                      h('span', { className: 'rt-ov-dot', style: { background: s.color } }),
                      s.label),
                    h('span', { className: 'rt-ov-legend-val rt-mono' }, s.display))))),
              h('div', { className: 'rt-ov-table-wrap' },
                h('table', { className: 'rt-ov-table' },
                  h('thead', null,
                    h('tr', null,
                      h('th', null, t('主机/子会话', 'Session')),
                      h('th', null, t('模型', 'Model')),
                      h('th', null, 'Token'))),
                  h('tbody', null,
                    hostSessions.length > 0
                      ? hostSessions.slice(0, 4).map((hs, idx) => h('tr', { key: 'hs-' + idx },
                          h('td', null, String(hs.title || hs.id || t('主会话', 'Main Session')).slice(0, 28)),
                          h('td', { className: 'rt-mono' }, String(hs.model || '—').slice(0, 24)),
                          h('td', { className: 'rt-mono' }, fmtTokNum(hs.tokens || 0))))
                      : h('tr', null,
                          h('td', { colSpan: 3, style: { color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', padding: '12px' } },
                            t('当前以本地 DOM 遥测为主，无多会话 Token 列表。', 'Using live local DOM telemetry; no multi-session token list.'))))))))
        } else if (expandedKey === 'delivery') {
          const waveDefs = [
            { wave: 1, name: t('Wave 1 · 立项与测绘', 'Wave 1 · Discovery'), color: '#4d6bfe' },
            { wave: 2, name: t('Wave 2 · 架构与分片', 'Wave 2 · Architecture'), color: '#8b5cf6' },
            { wave: 3, name: t('Wave 3 · 并发构建', 'Wave 3 · Parallel Build'), color: '#0ea5e9' },
            { wave: 4, name: t('Wave 4 · 审查与交付', 'Wave 4 · Review & Ship'), color: '#10b981' },
          ]
          bodyNode = h('div', { className: 'rt-ov-detail-card' },
            h('div', { className: 'rt-ov-detail-card-head' },
              h('span', null, t('4-Wave 工程交付进度与摘要明细', '4-Wave Delivery Progress & Digests')),
              h('div', { style: { display: 'inline-flex', gap: 6, flexWrap: 'wrap' } },
                h('button', { type: 'button', className: 'rt-btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: () => onGo('collab') }, t('协同与审批', 'Collab & Approval')),
                h('button', { type: 'button', className: 'rt-btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: () => onGo('assets') }, t('架构模块', 'Architecture')),
                h('button', { type: 'button', className: 'rt-btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: () => onGo('findings') }, t('质量审查', 'Quality')),
                h('button', { type: 'button', className: 'rt-btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: () => onGo('report') }, t('交付报告', 'Report')))),
            h('div', { className: 'rt-ov-wave-strip' },
              waveDefs.map((wd) => {
                const wTasks = dagTasks.filter((tItem) => Number(tItem.wave || tItem.wave_no || 1) === wd.wave)
                const wDone = wTasks.filter((tItem) => tItem.status === 'done' || tItem.status === 'approved' || tItem.status === 'completed').length
                return h('div', { key: 'wd-' + wd.wave, className: 'rt-ov-wave-cell', style: { borderTop: '3px solid ' + wd.color } },
                  h('div', { style: { fontSize: 11.5, fontWeight: 700 } }, wd.name),
                  h('div', { className: 'rt-mono', style: { fontSize: 12, fontWeight: 700, color: wd.color } },
                    wTasks.length > 0 ? t(wDone + '/' + wTasks.length + ' 完成', wDone + '/' + wTasks.length + ' done') : t('0 分片', '0 shards')))
              })),
            h('div', { className: 'rt-ov-table-wrap' },
              h('table', { className: 'rt-ov-table' },
                h('thead', null,
                  h('tr', null,
                    h('th', null, t('角色', 'Role')),
                    h('th', null, t('已提交摘要（worker_digests）', 'Submitted Digest (worker_digests)')),
                    h('th', null, t('变更文件', 'Files Touched')),
                    h('th', null, t('审批状态', 'Approval')))),
                h('tbody', null,
                  dagDigests.length > 0
                    ? dagDigests.slice(0, 10).map((d, idx) => h('tr', { key: 'dg-' + idx },
                        h('td', null, h('span', { className: 'rt-tag' }, d.role || d.agent_role || 'worker')),
                        h('td', null, String(d.what_was_done || d.summary || '—').slice(0, 72)),
                        h('td', { className: 'rt-mono' }, Array.isArray(d.files_touched) && d.files_touched.length > 0
                          ? d.files_touched.slice(0, 2).join(', ')
                          : '—'),
                        h('td', null, d.approved ? t('已审批', 'Approved') : t('待审批', 'Pending'))))
                    : h('tr', null,
                        h('td', { colSpan: 4, style: { color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', padding: '14px' } },
                          t('尚未收到 Worker 提交的执行摘要。', 'No worker digests submitted yet.')))))))
        }

        return h('section', { className: 'rt-ov-detail-drawer', 'data-detail-key': expandedKey },
          h('div', { className: 'rt-ov-detail-head' },
            h('div', { className: 'rt-ov-detail-title' },
              h('span', null, titleText),
              h('span', { className: 'rt-tag rt-mono' }, workspaceDisplayTitle)),
            h('div', { className: 'rt-ov-detail-actions' },
              h('button', {
                type: 'button',
                className: 'rt-btn',
                style: { padding: '2px 9px', fontSize: 11 },
                onClick: () => setLocalRefresh((x) => x + 1),
              }, t('刷新', 'Refresh')),
              h('button', {
                type: 'button',
                className: 'rt-btn',
                style: { padding: '2px 9px', fontSize: 11 },
                onClick: () => setExpandedKey(null),
              }, t('收起 ▴', 'Collapse ▴')))),
          bodyNode)
      }

      const showBudgetBanner = Boolean(budgetGuard && (budgetGuard.warnNearLimit || budgetGuard.tripped))

      return h('div', { className: 'rt-main rt-ov' },
        err ? h('div', { className: 'rt-err', style: { margin: '0 16px 8px' } }, err) : null,
        h('div', { className: 'rt-ov-scroll' },
          h('div', { className: 'rt-bento-stack rt-bento-workspace' },

            showBudgetBanner
              ? h('div', {
                  className: 'rt-ov-action-banner rt-budget-guard-banner ' + (budgetGuard.tripped ? 'is-tripped' : 'is-warn'),
                  role: 'alert',
                  style: {
                    border: '1px solid ' + (budgetGuard.tripped ? 'rgba(239,68,68,0.55)' : 'rgba(245,158,11,0.55)'),
                    background: budgetGuard.tripped ? 'rgba(239,68,68,0.09)' : 'rgba(245,158,11,0.09)',
                    color: budgetGuard.tripped ? '#ef4444' : '#b45309',
                  },
                },
                  h('span', { style: { fontWeight: 700 } },
                    (budgetGuard.tripped
                      ? t('预算熔断已触发：已暂停自动派发新分片。', 'Budget Circuit Breaker Tripped: auto-dispatch paused.')
                      : t('预算接近上限预警：当前工作区消耗接近设定上限。', 'Budget Warning: workspace consumption is nearing configured limit.'))
                    + (budgetGuard.reason ? (' ' + String(budgetGuard.reason)) : '')),
                  h('div', { className: 'rt-spacer' }),
                  h('button', {
                    type: 'button',
                    className: 'rt-btn' + (budgetGuard.tripped ? ' rt-btn-primary' : ''),
                    style: { padding: '3px 10px', fontSize: 11.5, fontWeight: 700 },
                    onClick: () => onGo('settings'),
                  }, t('前往设置调整预算 →', 'Adjust Budget in Settings →')))
              : null,

            /* ── 顶部 1 行行动提示横幅（待审批决策或空工作台立项引导） ── */
            pendingCount > 0
              ? h('div', { className: 'rt-ov-action-banner is-pending' },
                  h('span', { style: { fontWeight: 700 } },
                    t(pendingCount + ' 项分片产出待验收审批', pendingCount + ' shard output(s) awaiting approval')),
                  h('div', { className: 'rt-spacer' }),
                  h('button', {
                    type: 'button',
                    className: 'rt-btn rt-btn-primary',
                    style: { padding: '3px 10px', fontSize: 11.5, fontWeight: 700 },
                    onClick: () => onGo('collab'),
                  }, t('前往「协同与审批」', 'Go to Collab & Approval')))
              : (!hasActiveWork
                  ? h('div', { className: 'rt-ov-action-banner is-empty' },
                      h('span', null, t('当前工作台尚无研发任务，可前往「协同与审批」澄清需求并立项。', 'No active tasks in this workspace yet. Launch from "Collab & Approval".')),
                      h('div', { className: 'rt-spacer' }),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn rt-btn-primary',
                        style: { padding: '3px 10px', fontSize: 11.5, fontWeight: 700 },
                        onClick: () => onGo('collab'),
                      }, t('前往「协同与审批」', 'Go to Collab & Approval')))
                  : null),

            /* ── Row 1: 4 张高信噪比可展开 KPI 概览卡（折叠态保持简洁，点击展开 p3/p4/p5 风格详表） ── */
            h('div', { className: 'rt-ov-kpi-grid' },
              kpiCards.map((card) => {
                const isOpen = expandedKey === card.key
                return h('div', Object.assign({
                  key: card.key,
                  className: 'rt-ov-kpi-card is-interactive' + (isOpen ? ' is-expanded' : ''),
                }, clickable(() => toggleCard(card.key), {
                  label: (isOpen ? t('收起 ', 'Collapse ') : t('展开 ', 'Expand ')) + card.label + t('详细表', ' Details'),
                })),
                  h('div', { className: 'rt-ov-kpi-head' },
                    h('span', { className: 'rt-ov-kpi-label' }, card.label),
                    h('span', { className: 'rt-ov-kpi-toggle' }, isOpen ? t('▴ 收起', '▴ Hide') : t('▾ 详表', '▾ Details'))),
                  h('div', { className: 'rt-ov-kpi-val' + (card.accent ? ' accent' : '') }, card.val),
                  h(RtStackedBar, { mini: true, segments: card.segments }),
                  h('div', { className: 'rt-ov-kpi-sub' }, card.sub))
              })),

            /* ── 按需展开的详细表状分析面板 ── */
            renderDetailDrawer(),

            /* ── Row 2: 轻量级实时拓扑画布（variant="overview"，复用总览已拉取的 dagData 与 domTel） ── */
            h('div', { className: 'rt-bento-row-canvas' },
              h(HarnessWorkflowDeck, {
                variant: 'overview',
                engagement: eng,
                engagementName: workspaceDisplayTitle,
                snapshot: snapshot,
                agents: agents,
                dagData: dagData,
                domTel: domTel,
                onReload: load,
                refreshKey: refreshKey + localRefresh,
                onOpenCollab: () => onGo('collab'),
                onOpenAgents: () => onGo('agents'),
                onOpenWishWizard: () => onGo('collab'),
              })))))
    }
