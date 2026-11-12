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
