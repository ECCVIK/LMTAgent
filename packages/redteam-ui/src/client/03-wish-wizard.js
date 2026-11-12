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
