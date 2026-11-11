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
      const eng = props.engagement
      const activeEngagementId = eng || (props.snapshot && props.snapshot.engagement && props.snapshot.engagement.id) || 'default'
      const snapshot = props.snapshot
      const agentsProp = props.agents
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

      const reloadDag = React.useCallback(() => {
        if (!_isCanvasDragging) {
          setDomTel(readHostDomTelemetry())
        }
        if (!agentsProp) {
          api({ op: 'agentsStatus', engagement: eng || undefined }).then((r) => {
            if (r && r.ok !== false) setLocalAgents(r)
          }, () => {})
        }
        if (!eng) return
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

      const canvasFilteredChildren = fusedChildren.filter((c) => {
        if (canvasFilter === 'p0' && c.uiPriority !== 'P0') return false
        if (canvasFilter === 'running' && c.status !== 'running') return false
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
        || (activeHostSess && (activeHostSess.displayLabel || activeHostSess.title))
        || sessionTitle
        || eng
        || 'LMTAgent 主控工作区'
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
      const totalAgents = 1 + fusedChildren.length
      const runningCount = fusedChildren.filter((c) => c.status === 'running').length + (runningAgents.length > 0 ? 1 : 0)
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
      const fanoutGeomSigRef = React.useRef('')

      const measureHorizontalFanout = React.useCallback(() => {
        try {
          const stageEl = horizStageDomRef.current
          if (!stageEl || typeof stageEl.getBoundingClientRect !== 'function') return
          const stRect = stageEl.getBoundingClientRect()
          if (!stRect || !(stRect.height > 0)) return
          const curScale = Math.max(0.2, Number(panRef.current.scale) || 1)
          const totalH = Math.max(140, Math.round(stRect.height / curScale))
          let yRoot = Math.round(totalH / 2)
          const rootEl = rootCardDomRef.current
          if (rootEl && typeof rootEl.getBoundingClientRect === 'function') {
            const rRect = rootEl.getBoundingClientRect()
            if (rRect && rRect.height > 0) {
              yRoot = Math.round(((rRect.top + rRect.height / 2) - stRect.top) / curScale)
            }
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
                waveYs[wk] = Math.round(((cRect.top + cRect.height / 2) - stRect.top) / curScale)
              }
            }
          }
          const sig = totalH + ':' + yRoot + ':' + Object.keys(waveYs).sort().map((k) => k + '=' + waveYs[k]).join(',')
          if (sig !== fanoutGeomSigRef.current) {
            fanoutGeomSigRef.current = sig
            setFanoutGeom({ height: totalH, yRoot: yRoot, waveYs: waveYs })
          }
        } catch { /* SSR / stub safe no-op */ }
      }, [])

      const waveLayoutSig = activeWaveGroups.map((g) => g.wave + ':' + g.children.length + ':' + (isWaveExpanded(g) ? 1 : 0) + ':' + (wavePageLimits[g.wave] || WAVE_PAGE_SIZE)).join('|')

      React.useEffect(() => {
        if (treeDirection !== 'horizontal') return undefined
        measureHorizontalFanout()
        if (typeof ResizeObserver !== 'function') return undefined
        let ro = null
        try {
          ro = new ResizeObserver(() => {
            measureHorizontalFanout()
          })
          if (horizStageDomRef.current) ro.observe(horizStageDomRef.current)
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
      }, [treeDirection, waveLayoutSig, measureHorizontalFanout])

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
      return h('div', { className: 'rt-bento-card rt-p4-workbench' },
        h('div', { className: 'rt-bento-head' },
          h('span', { className: 'rt-bento-title' }, isNovice ? '项目推进全景图 & 任务看板' : '实时角色决策流 & DAG 工作流画布'),
          h('span', { className: 'rt-tag rt-tag-live' }, totalAgents + ' Agent · ' + allTasks.length + ' 协作任务'),
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
          h(UiModeSwitcher, null),
          h('div', { className: 'rt-harness-modebar', role: 'group', 'aria-label': '工作流视图切换' },
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
            }, '飞书通知 (Feishu Push)'))),

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

        /* ── 模式 1: p4 全屏置顶工作流树 + 画布过滤创作栏 + 下方全宽流程舱 ── */
        mode === 'p4'
          ? h('div', {
              className: 'rt-p4-split-grid rt-p4-vertical-stack rt-p4-split',
              style: { display: 'flex', flexDirection: 'column', gap: 14, width: '100%' },
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
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                    h('span', { style: { fontWeight: 700, fontSize: 13 } },
                      isNovice ? 'Agent 网络 · 项目执行路线图' : 'Agent 网络 · 1 Plan + N Workers 闭环派生树'),
                    h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                      isNovice
                        ? '点击任意阶段或任务卡片，在下方查看进展、调整目标或一键审批进入下一步'
                        : '默认横向向右派生 (──►)，点击节点在下方抽屉审阅压缩摘要与 Plan 审批，不直接跳出当前视图'))),

                h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 11 } },
                  h('span', { className: 'rt-tag rt-tag-live' }, totalAgents + ' Agent'),
                  h('span', { className: 'rt-tag rt-tag-active' }, runningCount + ' 个运行中'),
                  errorCount > 0 ? h('span', { className: 'rt-tag', style: { color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' } }, errorCount + ' 异常阻塞') : null,
                  h('span', { className: 'rt-tag' }, '上下文合计 ' + ctxSumLabel),
                  isNovice
                    ? null
                    : h('span', { className: 'rt-tag rt-tag-passive' },
                        '团队 · ' + totalAgents + ' 成员 · ' + allTasks.length + ' 任务' + (fusedChildren.length > 0 ? ' · 摘要压缩 -85%' : ' · 待命'))),

                /* 画布搜索/过滤与交互式新增分片工具栏 (.rt-canvas-filter-bar) */
                h('div', {
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
                    { k: 'error', lbl: '异常阻塞' + (errorCount > 0 ? ' (' + errorCount + ')' : '') },
                  ].map((fp) => h('button', {
                    key: 'cf-' + fp.k,
                    type: 'button',
                    className: 'rt-p3-pill' + (canvasFilter === fp.k ? ' on' : ''),
                    style: { fontSize: 10.5, padding: '2px 8px' },
                    onClick: () => setCanvasFilter(fp.k),
                  }, fp.lbl)),
                  h('div', { className: 'rt-spacer' }),
                  props.onOpenWishWizard
                    ? h('button', {
                        type: 'button',
                        className: 'rt-btn',
                        style: { padding: '2px 8px', fontSize: 11, fontWeight: 600 },
                        onClick: props.onOpenWishWizard,
                      }, '✨ 许愿拆解向导')
                    : null,
                  h('button', {
                    type: 'button',
                    className: 'rt-btn' + (showAddShardForm ? ' rt-btn-primary' : ''),
                    style: { padding: '2px 9px', fontSize: 11, fontWeight: 600 },
                    onClick: () => setShowAddShardForm((v) => !v),
                  }, showAddShardForm ? '收起新增分片 ✕' : '➕ 新增分片节点')),

                showAddShardForm
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

                isNovice
                  ? null
                  : h('div', {
                      style: {
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '4px 10px',
                        fontSize: 10.5,
                        color: 'var(--dsw-alias-label-secondary)',
                        padding: '5px 8px',
                        borderRadius: 8,
                        background: 'var(--dsw-alias-bg-layer-2)',
                      },
                    },
                      P4_CTX_LEGEND.map((lg) => h('span', { key: lg.key, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                        h('span', { style: { width: 7, height: 7, borderRadius: 2, background: lg.color, display: 'inline-block' } }),
                        h('span', null, lg.label))),
                      h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, color: '#3b82f6', fontWeight: 600 } }, '-- 运行中')),

                /* 可手抓平移与滚轮缩放的路径树画布视口 (.rt-panzoom-viewport) */
                h('div', {
                  ref: viewportDomRef,
                  className: 'rt-panzoom-viewport',
                  onMouseDown: handleViewportMouseDown,
                  onMouseMove: handleViewportMouseMove,
                  onMouseUp: handleViewportMouseUp,
                  onMouseLeave: handleViewportMouseUp,
                  onWheel: handleViewportWheel,
                  style: { padding: '8px 6px 12px', minHeight: activeWaveGroups.length > 0 ? 320 : 210 },
                },
                  h('div', {
                    className: 'rt-panzoom-toolbar',
                    role: 'toolbar',
                    'aria-label': '路径树画布平移缩放与折叠控制',
                    style: { flexWrap: 'wrap' },
                  },
                    h('span', {
                      className: 'rt-mono',
                      style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)', padding: '0 4px' },
                    }, '✋ 60FPS 零重绘拖拽'),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn rt-tree-layout-setting',
                      style: { padding: '1px 8px', fontSize: 10.5, fontWeight: 600 },
                      onClick: toggleTreeDirection,
                      title: '切换开发树展开方向（横向向右派生 / 纵向向下派生）',
                    }, treeDirection === 'horizontal'
                      ? '⚙️ 树布局: ➔ 横向向右派生 (切换纵向备选)'
                      : '⚙️ 树布局: ⬇ 纵向向下派生 (切换横向默认)'),
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
                    }, '🎯 适应视口'),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn',
                      style: { padding: '1px 7px', fontSize: 10.5 },
                      onClick: resetPanZoom,
                    }, '1:1 居中复位'),
                    activeWaveGroups.length > 0
                      ? h('button', {
                          type: 'button',
                          className: 'rt-btn' + (allWavesExpanded ? ' rt-btn-primary' : ''),
                          style: { padding: '1px 7px', fontSize: 10.5 },
                          onClick: () => (allWavesExpanded ? (fusedChildren.length > 4 ? autoFoldWaves() : collapseAllWaves()) : expandAllWaves()),
                        }, allWavesExpanded ? '自动折叠' : '全部展开')
                      : null,
                    activeWaveGroups.length > 0
                      ? h('button', {
                          type: 'button',
                          className: 'rt-btn',
                          style: {
                            padding: '1px 8px',
                            fontSize: 10.5,
                            color: '#3b82f6',
                            borderColor: 'rgba(59,130,246,0.45)',
                            fontWeight: 600,
                          },
                          onClick: triggerLifecycleDemo,
                        }, '✨ 演练派生与收尾动效')
                      : null),

                  h('div', {
                    ref: stageDomRef,
                    className: 'rt-panzoom-stage rt-net-tree',
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      padding: '42px 6px 6px',
                      position: 'relative',
                      transform: `translate3d(${panZoom.x}px, ${panZoom.y}px, 0) scale(${panZoom.scale})`,
                      transformOrigin: 'center top',
                    },
                  },
                    treeDirection === 'horizontal'
                      ? h('div', {
                          ref: horizStageDomRef,
                          className: 'rt-p5-tree-stage rt-tree-layout-horizontal',
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
                                h('span', { style: { fontSize: 10, fontWeight: 700, color: '#3b82f6' } },
                                  isNovice ? '项目总指挥 (主控 AI)' : 'Level 0 · 主控 Plan 编排器'),
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
                                isNovice
                                  ? '负责拆解需求蓝图、协调各步骤编码与验收汇总'
                                  : '1 Plan + N Workers · 自动拆分目标 / 摘要压缩 / 审批派发'),
                              h('div', {
                                className: 'rt-ctx-bar',
                                style: { display: 'flex', height: 6, borderRadius: 99, overflow: 'hidden', background: 'var(--dsw-alias-bg-layer-2)', gap: 1 },
                              },
                                [14, 10, 8, 6, 9, 16, 18, 19].map((pct, i) => h('div', {
                                  key: 'rcb-h-' + i,
                                  style: { width: pct + '%', background: P4_CTX_LEGEND[i].color, height: '100%' },
                                }))),
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

                          /* 2. 中列 (.rt-h-root-fanout-svg): 动态测量三次贝塞尔连线，精确锚定每张 Wave 卡片中心 */
                          activeWaveGroups.length > 0
                            ? h('svg', {
                                className: 'rt-h-root-fanout-svg rt-p4-bezier-svg',
                                viewBox: '0 0 68 ' + svgHeight,
                                style: { width: 68, height: svgHeight, display: 'block', overflow: 'visible', alignSelf: 'stretch' },
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
                                h('circle', { cx: '2', cy: String(svgYRoot), r: '4', fill: '#3b82f6' }))
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
                                    : '尚未拆解研发任务 — 在上方输入需求一键拆解并派发子代理'),
                                h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.55 } },
                                  fusedChildren.length > 0
                                    ? '点击上方「全部」胶囊或清空搜索词即可恢复显示全部节点。'
                                    : '主控 Plan 编排器已就绪：使用上方「✨ 许愿拆解向导」用自然语言描述目标，或点击「➕ 新增分片节点」手动挂载开发分片。'),
                                fusedChildren.length > 0
                                  ? h('button', {
                                      type: 'button',
                                      className: 'rt-btn',
                                      onClick: () => { setCanvasFilter('all'); setCanvasSearch('') },
                                    }, '重置筛选条件')
                                  : (props.onOpenWishWizard
                                    ? h('button', {
                                        type: 'button',
                                        className: 'rt-btn rt-btn-primary',
                                        onClick: props.onOpenWishWizard,
                                      }, '✨ 打开许愿拆解向导')
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
                                '尚未拆解研发任务 — 在上方输入需求一键拆解并派发子代理'))))),

              /* 下方全宽流程舱 (.rt-lower-process-deck) */
              h('div', {
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
                          isNovice
                            ? null
                            : h('span', { className: 'rt-tag rt-mono', style: { margin: 0, fontSize: 10 } },
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
                      { k: '1', lbl: isNovice ? '第 1 步' : 'Wave 1 立项' },
                      { k: '2', lbl: isNovice ? '第 2 步' : 'Wave 2 架构' },
                      { k: '3', lbl: isNovice ? '第 3 步' : 'Wave 3 构建' },
                      { k: '4', lbl: isNovice ? '第 4 步' : 'Wave 4 审查' },
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
        mode === 'p5'
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
                      ? h('div', { className: 'rt-empty', style: { marginTop: 18 } }, '暂无已派发的子代理任务 —— 点击右上角「+ 新建任务」或使用上方许愿向导拆解。')
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
        mode === 'docwall'
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
        mode === 'feishu'
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
