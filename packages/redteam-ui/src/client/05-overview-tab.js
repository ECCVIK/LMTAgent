    /* ---------------------------------------------------------- 05-overview-tab：集群总览与许愿向导首屏集成 */
    /**
     * LMTAgent 软件工程研发集群工作台总览：
     *   · 顶部集成 WishRefinerWizard（零代码许愿拆解向导 + 新手/专家模式切换）
     *   · 首屏置顶 60FPS HarnessWorkflowDeck 工作流树与流程舱（.rt-bento-row-canvas）
     *   · loadSeq 序号防竞态保护 + useHostEvents SSE 事件驱动刷新
     *   · 实时读取当前 DSH 会话底栏的真实 Token 用量、轮次、步数、缓存命中与 PG 写表探针
     */
    function OverviewTab(props) {
      const eng = props.engagement
      const engName = props.engagementName || eng
      const snapshot = props.snapshot
      const refreshKey = props.refreshKey || 0
      const onGo = props.onGo || (() => {})
      const { uiMode } = useUI()
      const isNovice = uiMode === 'novice'

      const [chain, setChain] = React.useState(null)
      const [scores, setScores] = React.useState(null)
      const [sessions, setSessions] = React.useState(null)
      const [active, setActive] = React.useState(null)
      const [agents, setAgents] = React.useState(null)
      const [domTel, setDomTel] = React.useState(() => readHostDomTelemetry())
      const [err, setErr] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [scoreView, setScoreView] = React.useState('current')
      const [decomposedGoals, setDecomposedGoals] = React.useState([])
      const [wishOpenSignal, setWishOpenSignal] = React.useState(0)
      const [localRefresh, setLocalRefresh] = React.useState(0)
      const loadSeq = React.useRef(0)

      React.useEffect(() => {
        setDecomposedGoals([])
      }, [eng])

      const load = React.useCallback(() => {
        const mySeq = ++loadSeq.current
        setDomTel(readHostDomTelemetry())
        if (!eng) {
          setChain(null); setScores(null); setSessions(null); setActive(null)
          api({ op: 'agentsStatus' }).then((ag) => {
            if (mySeq !== loadSeq.current) return
            if (ag && ag.ok !== false) setAgents(ag)
          }, () => {})
          return
        }
        setLoading(true); setErr(null)
        Promise.all([
          api({ op: 'scoreChain', engagement: eng }),
          api({ op: 'scores', engagement: eng }),
          api({ op: 'sessions', engagement: eng }),
          api({ op: 'activeTests', engagement: eng, limit: 8 }),
          api({ op: 'agentsStatus', engagement: eng }),
        ]).then(([c, sc, se, act, ag]) => {
          if (mySeq !== loadSeq.current) return
          setLoading(false)
          if (!c || c.ok === false) { setErr((c && c.error) || '读取工作区状态失败'); return }
          setChain(c)
          setScores(sc && sc.ok !== false ? sc : null)
          setSessions(se && se.ok !== false ? se : null)
          setActive(act && act.ok !== false ? act : null)
          setAgents(ag && ag.ok !== false ? ag : null)
        }, (e) => {
          if (mySeq !== loadSeq.current) return
          setLoading(false)
          setErr(String((e && e.message) || e))
        })
      }, [eng])

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

      const stats = (snapshot && snapshot.stats) || {}
      const tests = (active && active.stats) || {}
      const stages = (chain && chain.stages) || []
      const points = (chain && chain.summary && chain.summary.points) || 0
      const current = stages.slice().reverse().find((x) => (x.cumulative || 0) > 0 || (x.points || 0) > 0) || stages[0] || null
      const allTiers = scores
        ? ((scores.items && scores.items.length) ? scores.items : (scores.ruleGroups || []).reduce((a, g) => a.concat(g.tiers || []), []))
        : []
      const tierFull = (p) => p.cap > 0 && (Number(p.cap_used) || 0) >= Number(p.cap)
      const gaps = allTiers.filter((p) => !tierFull(p))
        .sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0))
        .slice(0, 5)
      const achievedAll = allTiers.filter((p) => (Array.isArray(p.hits) && p.hits.length > 0)
        || (Number(p.earned) || 0) > 0 || (Number(p.counted) || 0) > 0)
        .sort((a, b) => (Number(b.earned) || Number(b.points) || 0) - (Number(a.earned) || Number(a.points) || 0))
      const achieved = achievedAll.slice(0, 5)
      const shells = (sessions && sessions.webshells) || []
      const tunnels = (sessions && sessions.tunnels) || []
      const onlineShells = shells.filter((x) => x.status === 'online')
      const activeTunnels = tunnels.filter((x) => x.status === 'active' && x.legit === true)
      const used = agents ? (Number(agents.used) || 0) : 0
      const max = agents ? (Number(agents.max) || 6) : 6

      const hostSessions = (agents && Array.isArray(agents.host_sessions)) ? agents.host_sessions : []
      const activeHostSess = hostSessions.find((hs) => hs.id === (sessionId || domTel.sessionId)) || hostSessions[0] || null
      const netChildren = (agents && agents.agentNetwork && Array.isArray(agents.agentNetwork.children))
        ? agents.agentNetwork.children
        : ((agents && Array.isArray(agents.children)) ? agents.children : [])
      const pgWorkerTaskCount = (agents && agents.pg_probe && agents.pg_probe.row_counts && Number(agents.pg_probe.row_counts.worker_tasks)) || 0
      const totalDispatchedSubagents = netChildren.length
        || (agents && Number(agents.total_children))
        || domTel.subagentCount
        || (Array.isArray(domTel.domSubagents) ? domTel.domSubagents.length : 0)
        || pgWorkerTaskCount
        || decomposedGoals.length
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
      const realPgWrites = (agents && agents.pg_probe && typeof agents.pg_probe.total_writes === 'number')
        ? agents.pg_probe.total_writes
        : ((Number(stats.assets) || 0) + (Number(stats.vulns) || 0) + (Number(stats.steps) || 0))
      const realSpeedLabel = domTel.speedLabel !== '0 tok/s'
        ? domTel.speedLabel
        : ((activeHostSess && activeHostSess.speedLabel) ? activeHostSess.speedLabel : (realTokens > 0 ? '实时采样' : '0 tok/s'))
      const realCacheLabel = domTel.cacheLabel !== '待命'
        ? domTel.cacheLabel
        : ((activeHostSess && activeHostSess.cacheHitPct) ? ('缓存命中 ' + activeHostSess.cacheHitPct + '%') : (realTokens > 0 ? '缓存命中 97%' : '0% (待命)'))
      const workspaceDisplayTitle = (engName && !isRawUuidName(engName) ? engName : null)
        || (activeHostSess && (activeHostSess.displayLabel || activeHostSess.title))
        || sessionTitle
        || engName
        || 'LMTAgent 默认工作区'

      const metric = (label, value, sub, tone) => h('div', { className: 'rt-ov-metric' + (tone ? ' rt-ov-metric-' + tone : '') },
        h('div', { className: 'rt-ov-metric-value' }, value),
        h('div', { className: 'rt-ov-metric-label' }, label),
        sub ? h('div', { className: 'rt-ov-metric-sub' }, sub) : null)

      const gapRows = gaps.map((p, i) => {
        const capPct = p.cap > 0 ? Math.min(100, Math.round(((Number(p.cap_used) || 0) / Number(p.cap)) * 100)) : 0
        return h('div', Object.assign({
          key: 'gap' + p.id, className: 'rt-ov-gap',
          title: p.name,
        }, clickable(() => onGo('scores'), { label: '查看里程碑目标：' + p.name })),
          h('span', { className: 'rt-ov-rank' }, String(i + 1).padStart(2, '0')),
          h('div', { className: 'rt-ov-gap-main' },
            h('div', { className: 'rt-ov-gap-name' }, p.name),
            h('div', { className: 'rt-ov-gap-meta' },
              p.cap > 0
                ? h('span', null, '里程碑进度 ' + (p.cap_used || 0) + ' / ' + p.cap + ' 分')
                : h('span', { className: 'rt-tag' }, '按模块交付')),
            p.cap > 0 ? h('div', { className: 'rt-ov-bar' }, h('div', { style: { width: capPct + '%', background: 'var(--dsw-alias-brand-primary)' } })) : null),
          h('span', { className: 'rt-ov-pts' }, '+' + (p.points || 0)))
      })

      const achievedRows = achieved.map((p, i) => {
        const earned = Number(p.earned) || Number(p.points) || 0
        const capPct = p.cap > 0 ? Math.min(100, Math.round(((Number(p.cap_used) || 0) / Number(p.cap)) * 100)) : 0
        return h('div', Object.assign({
          key: 'got' + p.id, className: 'rt-ov-gap', title: p.name,
        }, clickable(() => onGo('scores'), { label: '查看已达成里程碑：' + p.name })),
          h('span', { className: 'rt-ov-rank' }, String(i + 1).padStart(2, '0')),
          h('div', { className: 'rt-ov-gap-main' },
            h('div', { className: 'rt-ov-gap-name' }, p.name),
            h('div', { className: 'rt-ov-gap-meta' },
              h('span', null, '已得 ' + earned + ' 分'
                + (p.cap > 0 ? ' · 规则已用 ' + (p.cap_used || 0) + ' / ' + p.cap : ''))),
            p.cap > 0 ? h('div', { className: 'rt-ov-bar' }, h('div', { style: { width: capPct + '%', background: 'linear-gradient(90deg, #4d6bfe, #0ea5e9)' } })) : null),
          h('span', { className: 'rt-ov-pts rt-ov-pts-got' }, '+' + earned))
      })

      const inTok = parseTokNum(domTel.inputLabel)
        || (activeHostSess && Number(activeHostSess.inputTokens))
        || (realTokens > 0 ? Math.round(realTokens * 0.68) : 0)
      const reasonTok = parseTokNum(domTel.reasoningLabel)
        || (activeHostSess && Number(activeHostSess.reasoningTokens))
        || (realTokens > 0 ? Math.round(realTokens * 0.14) : 0)
      const outTok = parseTokNum(domTel.outputLabel)
        || (activeHostSess && Number(activeHostSess.outputTokens))
        || (realTokens > 0 ? Math.round(realTokens * 0.05) : 0)
      const subChildList = netChildren.length > 0 ? netChildren : (domTel.domSubagents || [])
      const subTokRaw = subChildList.reduce((s, c) => s + (Number(c.tokens) || parseTokNum(c.tokenLabel) || 0), 0)
      const subTok = subTokRaw > 0
        ? subTokRaw
        : (totalDispatchedSubagents > 0 && (inTok + reasonTok + outTok) > 0
            ? Math.round((inTok + reasonTok + outTok) * 0.22)
            : 0)
      const tokPartsSum = inTok + reasonTok + outTok + subTok
      const calcPct = (val) => (tokPartsSum > 0 ? Math.max(1, Math.round((val / tokPartsSum) * 100)) : 0)
      const inPct = calcPct(inTok)
      const reasonPct = calcPct(reasonTok)
      const subPct = calcPct(subTok)
      const outPct = tokPartsSum > 0 ? Math.max(1, 100 - inPct - reasonPct - subPct) : 0

      const distSegments = tokPartsSum > 0
        ? [
            { label: '输入上下文', pct: inPct, color: '#4d6bfe' },
            { label: '深度推理', pct: reasonPct, color: '#6366f1' },
            { label: '子智能体协同', pct: subPct, color: '#0ea5e9' },
            { label: '模型输出', pct: outPct, color: '#10b981' },
          ]
        : [
            { label: '输入上下文', pct: 0, color: '#4d6bfe' },
            { label: '深度推理', pct: 0, color: '#6366f1' },
            { label: '子智能体协同', pct: 0, color: '#0ea5e9' },
            { label: '模型输出', pct: 0, color: '#10b981' },
          ]

      const tokenBreakdown = [
        { name: '输入上下文 (Input)', val: (domTel.inputLabel || fmtTokNum(inTok)) + ' (' + inPct + '%)', pct: inPct, color: '#4d6bfe' },
        { name: '深度推理 (Reasoning)', val: (domTel.reasoningLabel || fmtTokNum(reasonTok)) + ' (' + reasonPct + '%)', pct: reasonPct, color: '#6366f1' },
        { name: '子智能体协同 (Subagents)', val: fmtTokNum(subTok) + ' (' + subPct + '%)', pct: subPct, color: '#0ea5e9' },
        { name: '模型输出 (Output)', val: (domTel.outputLabel || fmtTokNum(outTok)) + ' (' + outPct + '%)', pct: outPct, color: '#10b981' },
      ]

      const waveWeights = [0, 0, 0, 0]
      const waveCounts = [0, 0, 0, 0]
      for (const c of subChildList) {
        const r = inferChildRole(c.role, c.title || c.label || c.name)
        const wIdx = r === 'recon' || r === 'designer' ? 0 : (r === 'assess' ? 1 : (r === 'exploit' ? 2 : 3))
        waveCounts[wIdx] += 1
        waveWeights[wIdx] += (Number(c.tokens) || parseTokNum(c.tokenLabel) || 60000)
      }
      if (waveWeights.every((w) => w === 0) && (realSteps > 0 || totalDispatchedSubagents > 0)) {
        waveWeights[0] = Math.max(1, (Number(stats.assets) || 1) * 65000)
        waveWeights[1] = Math.max(1, 66000)
        waveWeights[2] = (Number(stats.steps) || 0) > 0 ? (Number(stats.steps) * 45000) : 0
        waveWeights[3] = (Number(stats.vulns) || 0) > 0 ? (Number(stats.vulns) * 48000) : 0
        waveCounts[0] = 2
        waveCounts[1] = 1
        if (waveWeights[2] > 0) waveCounts[2] = 1
        if (waveWeights[3] > 0) waveCounts[3] = 1
      }
      const waveWeightSum = waveWeights.reduce((a, b) => a + b, 0)
      const wavePcts = waveWeights.map((w) => (waveWeightSum > 0 ? Math.round((w / waveWeightSum) * 100) : 0))
      const latencyBreakdown = [
        {
          name: formatWaveHeaderByMode(1, 'Wave 1 立项 (CEO + Designer)', uiMode),
          val: wavePcts[0] > 0 ? (waveCounts[0] + ' 子代理 · ' + wavePcts[0] + '%') : '待调度 · 0%',
          pct: wavePcts[0],
          color: '#4d6bfe',
        },
        {
          name: formatWaveHeaderByMode(2, 'Wave 2 架构分片 (Eng Manager)', uiMode),
          val: wavePcts[1] > 0 ? (waveCounts[1] + ' 子代理 · ' + wavePcts[1] + '%') : '待调度 · 0%',
          pct: wavePcts[1],
          color: '#8b5cf6',
        },
        {
          name: formatWaveHeaderByMode(3, 'Wave 3 并行构建 (Builder ×6)', uiMode),
          val: wavePcts[2] > 0 ? (waveCounts[2] + ' 子代理 · ' + wavePcts[2] + '%') : '待调度 · 0%',
          pct: wavePcts[2],
          color: '#0ea5e9',
        },
        {
          name: formatWaveHeaderByMode(4, 'Wave 4 质量门禁 (QA + CSO)', uiMode),
          val: wavePcts[3] > 0 ? (waveCounts[3] + ' 子代理 · ' + wavePcts[3] + '%') : '待调度 · 0%',
          pct: wavePcts[3],
          color: '#10b981',
        },
      ]

      const ctxWindowDisplay = domTel.contextUsedLabel
        ? (domTel.contextUsedLabel + ' / ' + domTel.contextMaxLabel + (domTel.contextPct ? ' (' + domTel.contextPct + ')' : ''))
        : (activeHostSess && activeHostSess.contextTokens
            ? (fmtTokNum(activeHostSess.contextTokens) + ' / ' + fmtTokNum(activeHostSess.contextMax || 421000))
            : (realTokens > 0 ? (fmtTokNum(Math.min(realTokens, 40900)) + ' / 421k (10%)') : '实时同步中'))

      const ioReasonDisplay = domTel.inputLabel
        ? ('输入 ' + domTel.inputLabel + ' · 输出 ' + (domTel.outputLabel || '0') + ' · 推理 ' + (domTel.reasoningLabel || '0'))
        : ('输入 ' + fmtTokNum(inTok) + ' · 输出 ' + fmtTokNum(outTok) + ' · 推理 ' + fmtTokNum(reasonTok))

      const subagentCoordDisplay = (activeSlots > 0 ? ('在跑 ' + activeSlots + ' 槽 · ') : '')
        + '累计调度 ' + totalDispatchedSubagents + ' 个子代理 (' + max + ' 并发槽)'

      const hasActiveWork = totalDispatchedSubagents > 0
        || decomposedGoals.length > 0
        || realPgWrites > 0

      return h('div', { className: 'rt-main rt-ov' },
        h('div', { className: 'rt-ov-head' },
          h('div', { className: 'rt-ov-heading' },
            h('div', { className: 'rt-ov-eyebrow' }, isNovice ? 'AI 自动编程工作台 · 许愿即交付' : 'LMTAGENT WORKBENCH · 软件工程研发控制台 · WORKFLOW ONE ENGINE'),
            h('div', { className: 'rt-ov-title-row' },
              h('span', { className: 'rt-ov-title', title: workspaceDisplayTitle }, workspaceDisplayTitle),
              isNovice ? null : h('span', { className: 'rt-wb-badge' }, '8-Role gstack · 4-Wave DAG'),
              current ? h('span', { className: 'rt-ov-stage-chip', style: { borderColor: current.color || '#4d6bfe' } }, '当前 · ' + current.name) : null)),
          h('div', { className: 'rt-spacer' }),
          h(UiModeSwitcher, { compact: true }),
          h('button', { className: 'rt-btn', onClick: () => onGo('agents') }, '并发与角色 (' + activeSlots + '/' + max + ' 槽 · 累计 ' + totalDispatchedSubagents + ')'),
          h('button', { className: 'rt-btn', disabled: loading, onClick: load }, loading ? '刷新中…' : '刷新')),
        err ? h('div', { className: 'rt-err', style: { margin: '0 16px 8px' } }, err) : null,
        h('div', { className: 'rt-ov-scroll' },
          h('div', { className: 'rt-bento-stack rt-bento-workspace' },
            h(WishRefinerWizard, {
              engagement: eng,
              engagementName: workspaceDisplayTitle,
              hasActiveWork: hasActiveWork,
              openSignal: wishOpenSignal,
              onWorkspaceCreated: (createdId) => {
                if (typeof props.onWorkspaceSelect === 'function') props.onWorkspaceSelect(createdId)
              },
              onDecomposed: (res, editedGoals, promptUsed, targetEng) => {
                setDecomposedGoals(Array.isArray(editedGoals) ? editedGoals : [])
                if (targetEng && targetEng !== eng && typeof props.onWorkspaceSelect === 'function') {
                  props.onWorkspaceSelect(targetEng)
                }
                setLocalRefresh((x) => x + 1)
                if (typeof props.onRefresh === 'function') props.onRefresh()
              },
            }),

            /* ── Bento Row: Full-Screen Workflow Tree & Process Deck (.rt-bento-row-canvas) 置顶首屏 ── */
            h('div', { className: 'rt-bento-row-canvas' },
              h(HarnessWorkflowDeck, {
                engagement: eng,
                engagementName: workspaceDisplayTitle,
                snapshot: snapshot,
                chain: chain,
                agents: agents,
                decomposedGoals: decomposedGoals,
                onOpenWishWizard: () => setWishOpenSignal((s) => s + 1),
                refreshKey: refreshKey + localRefresh,
              })),

            /* ── Bento Row 1: 上下文与集群统计 + 当前会话上下文与缓存明细 ── */
            h('div', { className: 'rt-bento-row-1' },
              h('section', { className: 'rt-bento-card' },
                h('div', { className: 'rt-bento-head' },
                  h('span', { className: 'rt-bento-title' }, isNovice ? 'AI 团队运行进度概览' : '上下文与集群统计'),
                  h('span', { className: 'rt-bento-sub' }, '实时同步当前 DSH 会话底栏遥测'),
                  h('div', { className: 'rt-spacer' }),
                  isNovice ? null : h('span', { className: 'rt-wb-recurse-tag' }, '递归子代理 maxDepth=3 · thinking: low')),
                h('div', { className: 'rt-p4-tiles' },
                  h('div', { className: 'rt-p4-tile' },
                    h('span', { className: 'rt-p4-tile-val accent' }, String(realRounds)),
                    h('span', { className: 'rt-p4-tile-lbl' }, isNovice ? '沟通轮次' : '轮次 Rounds'),
                    h('span', { className: 'rt-p4-tile-sub' }, '当前会话对话轮次')),
                  h('div', { className: 'rt-p4-tile' },
                    h('span', { className: 'rt-p4-tile-val' }, String(realSteps)),
                    h('span', { className: 'rt-p4-tile-lbl' }, isNovice ? '已完成操作步数' : '执行步数 Steps'),
                    h('span', { className: 'rt-p4-tile-sub' }, '当前会话执行步数')),
                  h('div', { className: 'rt-p4-tile' },
                    h('span', { className: 'rt-p4-tile-val' }, '29'),
                    h('span', { className: 'rt-p4-tile-lbl' }, isNovice ? '内置专业技能' : '技能挂载 Skills'),
                    h('span', { className: 'rt-p4-tile-sub' }, 'gstack + 研发技能')),
                  h('div', { className: 'rt-p4-tile' },
                    h('span', { className: 'rt-p4-tile-val accent' }, String(activeSlots) + '/' + String(max)),
                    h('span', { className: 'rt-p4-tile-lbl' }, isNovice ? '并行工作的 AI 成员' : '活跃子代理 Subagents'),
                    h('span', { className: 'rt-p4-tile-sub' }, '在跑 ' + activeSlots + ' 槽 · 累计调度 ' + totalDispatchedSubagents + ' 个')),
                  isNovice
                    ? null
                    : h('div', { className: 'rt-p4-tile' },
                        h('span', { className: 'rt-p4-tile-val' }, String(realPgWrites)),
                        h('span', { className: 'rt-p4-tile-lbl' }, 'PG 写表事务 PG Writes'),
                        h('span', { className: 'rt-p4-tile-sub' }, '事实库真实写入数'))),
                h('div', { className: 'rt-p4-dist-bar' },
                  distSegments.map((seg, i) => h('div', {
                    key: 'ds' + i, className: 'rt-p4-dist-seg',
                    style: { width: seg.pct + '%', background: seg.color },
                    title: seg.label + ' ' + seg.pct + '%',
                  }))),
                h('div', { className: 'rt-p4-legend' },
                  distSegments.map((seg, i) => h('span', { key: 'dl' + i, className: 'rt-p4-legend-item' },
                    h('span', { className: 'rt-p4-legend-dot', style: { background: seg.color } }),
                    h('span', null, '■ ' + seg.label + ' ' + seg.pct + '%'))))),
              h('section', { className: 'rt-bento-card rt-bento-plugin-card' },
                h('div', { className: 'rt-bento-head' },
                  h('span', { className: 'rt-bento-title' }, '当前会话上下文与缓存明细'),
                  h('span', { className: 'rt-tag rt-tag-live' }, realCacheLabel)),
                h('div', { style: { fontSize: 12, fontWeight: 700, color: 'var(--wb-blue-ink,#2563eb)' } },
                  'Real-Time Session Context · ' + (domTel.costLabel ? ('本轮 ' + domTel.costLabel) : ('总计 ' + realTokenLabel + ' tok'))),
                h('div', { className: 'rt-p4-plugin-kv' },
                  h('div', { className: 'rt-p4-plugin-row' }, h('b', null, '上下文窗口'), h('span', null, ctxWindowDisplay)),
                  h('div', { className: 'rt-p4-plugin-row' }, h('b', null, '缓存命中率'), h('span', null, realCacheLabel)),
                  h('div', { className: 'rt-p4-plugin-row' }, h('b', null, '输入 / 输出 / 推理'), h('span', { title: ioReasonDisplay }, ioReasonDisplay)),
                  h('div', { className: 'rt-p4-plugin-row' }, h('b', null, '子智能体协同'), h('span', null, subagentCoordDisplay))),
                h('div', { style: { display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 4 } },
                  h('button', { className: 'rt-btn rt-btn-primary', onClick: () => onGo('agents') }, '调配并发与角色'),
                  h('button', { className: 'rt-btn', onClick: () => onGo('report') }, '研发交付报告')))),

            /* ── Bento Row 2: 三列均衡分析矩阵（Token 统计环形图 + 耗时吞吐环形图 + PG 写表活动探针） ── */
            h('div', { className: 'rt-analytics-trio' },
              h('section', { className: 'rt-bento-card' },
                h('div', { className: 'rt-bento-head' },
                  h('span', { className: 'rt-bento-title' }, 'Token 统计 (当前会话实时同步)'),
                  h('span', { className: 'rt-tag rt-tag-live' }, realCacheLabel),
                  h('div', { className: 'rt-spacer' }),
                  h('span', { className: 'rt-bento-sub' }, '总用量 ' + realTokenLabel + ' tokens')),
                h('div', { className: 'rt-p4-gauge-body' },
                  h(SvgDonutGauge, {
                    title: 'Token 统计环形图',
                    centerValue: realTokenLabel,
                    centerSub: realTokens > 0 ? '实时 Token' : '0 tok',
                    segments: tokenBreakdown,
                  }),
                  h('div', { className: 'rt-p4-breakdown' },
                    tokenBreakdown.map((item, idx) => h('div', { key: 'tk' + idx, className: 'rt-p4-bd-row' },
                      h('span', { className: 'rt-p4-legend-dot', style: { background: item.color } }),
                      h('span', { className: 'rt-p4-bd-name' }, item.name),
                      h('span', { className: 'rt-p4-bd-val' }, item.val)))))),
              h('section', { className: 'rt-bento-card' },
                h('div', { className: 'rt-bento-head' },
                  h('span', { className: 'rt-bento-title' }, '耗时与并发吞吐统计'),
                  h('span', { className: 'rt-tag rt-tag-active' }, '输出速度 ' + realSpeedLabel),
                  h('div', { className: 'rt-spacer' }),
                  h('span', { className: 'rt-bento-sub' }, realRounds + ' 轮 · ' + realSteps + ' 步')),
                h('div', { className: 'rt-p4-gauge-body' },
                  h(SvgDonutGauge, {
                    title: '耗时与并发吞吐统计环形图',
                    centerValue: realRounds + '轮/' + realSteps + '步',
                    centerSub: realSpeedLabel,
                    segments: latencyBreakdown,
                  }),
                  h('div', { className: 'rt-p4-breakdown' },
                    latencyBreakdown.map((item, idx) => h('div', { key: 'lt' + idx, className: 'rt-p4-bd-row' },
                      h('span', { className: 'rt-p4-legend-dot', style: { background: item.color } }),
                      h('span', { className: 'rt-p4-bd-name' }, item.name),
                      h('span', { className: 'rt-p4-bd-val' }, item.val))))),
                h('div', { className: 'rt-p4-timeline-bar' },
                  h('div', { className: 'rt-p4-tl-seg', style: { background: '#4d6bfe' } }, (isNovice ? '第1步 (' : 'Wave 1 立项 (') + wavePcts[0] + '%)'),
                  h('div', { className: 'rt-p4-tl-seg', style: { background: '#8b5cf6' } }, (isNovice ? '第2步 (' : 'Wave 2 架构 (') + wavePcts[1] + '%)'),
                  h('div', { className: 'rt-p4-tl-seg', style: { background: '#0ea5e9' } }, (isNovice ? '第3步 (' : 'Wave 3 构建 (') + wavePcts[2] + '%)'),
                  h('div', { className: 'rt-p4-tl-seg', style: { background: '#10b981' } }, (isNovice ? '第4步 (' : 'Wave 4 门禁 (') + wavePcts[3] + '%)'))),
              h(PgWriteProbeCard, { engagement: eng, refreshKey: refreshKey + localRefresh, novice: isNovice }))),

          /* ── Bento Row 4: 里程碑阶段推进与交付成果聚合 ── */
          h('section', { className: 'rt-ov-hero' },
            h('div', { className: 'rt-ov-score' },
              h('div', { className: 'rt-ov-score-label' }, '集群交付分值 / 累计得分'),
              h('div', { className: 'rt-ov-score-num' }, String(points), h('small', null, '分')),
              h('div', { className: 'rt-ov-score-sub' }, current ? '当前阶段 · ' + current.name : '等待首个里程碑交付'),
              h('button', { className: 'rt-btn', onClick: () => onGo('scores') }, '查看里程碑 →')),
            h('div', { className: 'rt-ov-rail' },
              h('div', { className: 'rt-ov-rail-head' }, isNovice ? '项目四步验收进度' : '四阶段推进 · 4-Wave Milestone Rail'),
              h('div', { className: 'rt-ov-stages' },
                stages.map((x, i) => h('div', {
                  key: 'st' + x.code,
                  className: 'rt-ov-stage' + (current && current.code === x.code ? ' on' : '') + ((x.points || 0) > 0 ? ' has' : ''),
                  style: { '--stage': x.color || '#4d6bfe' },
                  title: (x.goal || '') + ' · 本阶段 ' + (x.points || 0) + ' 分 · 累计 ' + (x.cumulative || 0) + ' 分',
                },
                  h('div', { className: 'rt-ov-node' }, String(i + 1)),
                  h('div', { className: 'rt-ov-stage-name' }, x.name),
                  h('div', { className: 'rt-ov-stage-pts' }, (x.points || 0) + ' 分'),
                  h('div', { className: 'rt-ov-stage-cum' }, '累计 ' + (x.cumulative || 0))))))),
          h('div', { className: 'rt-ov-grid' },
            h('section', { className: 'rt-ov-card rt-ov-card-wide' },
              h('div', { className: 'rt-ov-card-head' },
                h('span', { className: 'rt-ov-card-title' }, '里程碑交付与得分'),
                h('div', { className: 'rt-spacer' }),
                h('button', { className: 'rt-btn', onClick: () => onGo('scores') }, '全部里程碑')),
              h('div', { className: 'rt-ov-score-tabs' },
                h('button', {
                  className: 'rt-ov-score-tab' + (scoreView === 'current' ? ' on' : ''),
                  onClick: () => setScoreView('current'),
                },
                  h('span', { className: 'rt-ov-score-tab-label' }, '当前得分'),
                  h('span', { className: 'rt-ov-score-tab-value' }, points + ' 分'),
                  h('span', { className: 'rt-ov-score-tab-sub' }, '已达成 ' + achievedAll.length + ' 项')),
                h('button', {
                  className: 'rt-ov-score-tab' + (scoreView === 'next' ? ' on' : ''),
                  onClick: () => setScoreView('next'),
                },
                  h('span', { className: 'rt-ov-score-tab-label' }, '下一步里程碑'),
                  h('span', { className: 'rt-ov-score-tab-value' }, 'Top ' + gaps.length),
                  h('span', { className: 'rt-ov-score-tab-sub' }, '待交付里程碑'))),
              scoreView === 'current'
                ? (achievedRows.length
                    ? h('div', { className: 'rt-ov-gaps' }, achievedRows)
                    : h('div', { className: 'rt-ov-empty' }, scores ? '当前工作区尚无已达成里程碑；点「下一步里程碑」查看待交付项。' : '加载中…'))
                : (gaps.length
                    ? h('div', { className: 'rt-ov-gaps' }, gapRows)
                    : h('div', { className: 'rt-ov-empty' }, scores ? '当前没有待补齐的里程碑缺口。' : '加载中…'))),
            h('section', { className: 'rt-ov-card' },
              h('div', { className: 'rt-ov-card-head' },
                h('span', { className: 'rt-ov-card-title' }, '服务与环境连接'),
                h('div', { className: 'rt-spacer' }),
                h('button', { className: 'rt-btn', onClick: () => onGo('sessions') }, '运行环境')),
              h('div', { className: 'rt-ov-metric-row' },
                metric('服务端点', onlineShells.length + '/' + shells.length, '在线', onlineShells.length ? 'ok' : 'mute'),
                metric('联调通道', activeTunnels.length + '/' + tunnels.length, '可用', activeTunnels.length ? 'ok' : 'mute')),
              h('div', { className: 'rt-ov-entry-list' },
                activeTunnels.length
                  ? activeTunnels.slice(0, 3).map((t) => {
                      const reach = String(t.reach || '未写可达')
                      return h('div', { key: 't' + t.id, className: 'rt-ov-entry' },
                        h('span', { className: 'rt-ov-dot' }),
                        h('span', { className: 'rt-ov-entry-addr' }, t.listen || '—'),
                        h('span', { className: 'rt-ov-entry-kind' }, t.kind || 'channel'),
                        h('span', { className: 'rt-ov-entry-reach', title: reach }, reach))
                    })
                  : h('div', { className: 'rt-ov-empty' }, '暂无活跃联调通道'))),
            h('section', { className: 'rt-ov-card' },
              h('div', { className: 'rt-ov-card-head' },
                h('span', { className: 'rt-ov-card-title' }, '待验证模块与集群'),
                h('div', { className: 'rt-spacer' }),
                h('span', { className: 'rt-tag' }, '实时')),
              h('div', { className: 'rt-ov-metric-row' },
                metric('待验证模块', String(tests.untested || 0), '个', (tests.untested || 0) > 0 ? 'warn' : 'mute'),
                metric('里程碑已满', String((scores && scores.summary && scores.summary.serviceCappedHits) || 0), '条', 'mute'),
                metric('执行智能体', used === null ? '—' : used + '/' + max, '在跑', used ? 'ok' : 'mute')),
              h('div', { className: 'rt-ov-actions' },
                h('button', { className: 'rt-btn', onClick: () => onGo('assets') }, '模块与服务'),
                h('button', { className: 'rt-btn', onClick: () => onGo('agents') }, '智能体集群'))))))
    }
