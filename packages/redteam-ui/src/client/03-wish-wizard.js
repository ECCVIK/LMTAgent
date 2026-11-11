    /* ---------------------------------------------------------- 03-wish-wizard：许愿式拆解向导与新手/专家视图切换 */
    /**
     * 新手简洁视图下的波次里程碑白话映射（隐藏底层术语，直译为人类易懂的 4 步研发里程碑）。
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

    const WIZARD_ROLE_OPTIONS = [
      { value: 'recon', label: '产品与需求规划（CEO）', wave: 1 },
      { value: 'designer', label: '交互与视觉设计（Designer）', wave: 1 },
      { value: 'assess', label: '系统架构与排期（Eng Manager）', wave: 2 },
      { value: 'exploit', label: '全栈研发与构建（Builder）', wave: 3 },
      { value: 'qa', label: '质量保障与测试（QA Lead）', wave: 4 },
      { value: 'vuln-scan', label: '代码审查与安全（Reviewer & CSO）', wave: 4 },
      { value: 'internal', label: '文档工程与发布（Doc & Release）', wave: 4 },
    ]

    const deriveProjectNameFromWish = (wishText, fallbackHint) => {
      const hint = String(fallbackHint || '').trim()
      if (hint && !isRawUuidName(hint)) return hint.slice(0, 28)
      const cleaned = String(wishText || '')
        .replace(/^(?:请帮我|帮我|我想|我要|做一个|开发一个|写一个|构建一个|设计一个)\s*/u, '')
        .split(/[，。！？,.;；\n]/)[0]
        .trim()
      if (cleaned.length >= 2) return cleaned.slice(0, 24)
      return '心愿研发项目-' + new Date().toISOString().slice(5, 10)
    }

    const buildClientFallbackBlueprint = (wishText) => {
      const summary = String(wishText || '').trim().slice(0, 80) || '用户目标软件系统'
      return [
        {
          id: 'wish-stage-1',
          wave: 1,
          role: 'recon',
          title: '理清核心功能清单与页面交互流程',
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
          assignedGoal: '锁定各模块数据结构与接口契约，为并行开发分配独占文件目录，防止多人改同一文件冲突。',
          filesOwned: 'src/contracts/*, package.json',
        },
        {
          id: 'wish-stage-4',
          wave: 3,
          role: 'exploit',
          title: '核心业务界面与交互逻辑编码实现',
          assignedGoal: '按既定蓝图实现全部前端交互组件、状态管理与核心业务逻辑，完成本地自测。',
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
     * 顶部「🌱 新手简洁视图 ⇄ 🔧 专家全量视图」一键切换条。
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
          gap: 6,
          padding: compact ? '2px 4px' : '3px 6px',
          borderRadius: 999,
          border: '1px solid var(--dsw-alias-border-l2)',
          background: 'var(--dsw-alias-bg-layer-2, rgba(77,107,254,0.06))',
        },
      },
        h('button', {
          type: 'button',
          className: 'rt-btn' + (isNovice ? ' rt-btn-primary' : ''),
          style: { borderRadius: 999, padding: '2px 9px', fontSize: 11.5, fontWeight: isNovice ? 700 : 500 },
          title: '隐藏底层数据库协议与复杂指标，用直白步骤展示研发进度',
          onClick: () => setUiMode('novice'),
        }, '🌱 新手简洁视图'),
        h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '⇄'),
        h('button', {
          type: 'button',
          className: 'rt-btn' + (!isNovice ? ' rt-btn-primary' : ''),
          style: { borderRadius: 999, padding: '2px 9px', fontSize: 11.5, fontWeight: !isNovice ? 700 : 500 },
          title: '切换新手简洁视图 / 专家全量视图（🌱 新手简洁视图 ⇄ 🔧 专家全量视图）',
          onClick: () => setUiMode('expert'),
        }, '🔧 专家全量视图'))
    }

    /**
     * 零代码「✨ 许愿拆解向导」（WishRefinerWizard）：
     *   1. 当工作区尚无活跃 Worker 与拆解目标时默认展开欢迎向导；已有任务时可收起并通过「✨ 许愿拆解向导」随时呼出；
     *   2. 支持大白话输入 + 4 个一键灵感模板；
     *   3. 「✨ 先润色并预览拆解蓝图」-> 调用 `refineAndDecomposeWish` 生成可自由编辑的阶段卡片（目标说明 + 负责角色 + 独占文件分片）；
     *   4. 「🚀 确认蓝图并立项拆解」-> 若未打开工作区则自动创建并绑定当前会话，随后调用 `decomposeUserPrompt` 立即灌入下方 60FPS 工作流画布。
     */
    function WishRefinerWizard(props) {
      const eng = props.engagement
      const hasActiveWork = Boolean(props.hasActiveWork)
      const openSignal = props.openSignal || 0
      const { uiMode } = useUI()
      const currentSess = useSession()

      const [manualOpen, setManualOpen] = React.useState(null)
      const isExpanded = manualOpen !== null ? manualOpen : !hasActiveWork

      React.useEffect(() => {
        if (openSignal > 0) setManualOpen(true)
      }, [openSignal])

      const [wishText, setWishText] = React.useState('')
      const [projectHint, setProjectHint] = React.useState('')
      const [refinedWish, setRefinedWish] = React.useState('')
      const [stageCards, setStageCards] = React.useState([])
      const [previewing, setPreviewing] = React.useState(false)
      const [launching, setLaunching] = React.useState(false)
      const [feedback, setFeedback] = React.useState(null)

      const applyStarter = (tpl) => {
        setWishText(tpl.prompt)
        setProjectHint(tpl.projectName)
        setFeedback(null)
      }

      const handleRefinePreview = () => {
        const promptTrimmed = String(wishText || '').trim()
        if (!promptTrimmed) {
          setFeedback({ tone: 'warn', text: '请先在下方输入框用大白话写下你想做的软件、网页或工具，或点击任一灵感模板。' })
          return
        }
        setPreviewing(true)
        setFeedback(null)
        api({
          op: 'refineAndDecomposeWish',
          engagement_id: eng || undefined,
          engagement: eng || undefined,
          prompt: promptTrimmed,
          preview_only: true,
        }).then((res) => {
          setPreviewing(false)
          const serverRefined = res && (res.refined_prompt || res.refinedPrompt || (res.blueprint && res.blueprint.refined_prompt))
          if (serverRefined) setRefinedWish(String(serverRefined))
          if (res && (res.project_name || res.projectName) && !projectHint) {
            setProjectHint(String(res.project_name || res.projectName))
          }
          const rawGoals = (res && (res.goals || res.stages || res.subgoals || (res.blueprint && res.blueprint.goals))) || []
          const normalized = normalizeBlueprintGoals(rawGoals, serverRefined || promptTrimmed)
          setStageCards(normalized)
          setFeedback({
            tone: 'ok',
            text: '已生成 ' + normalized.length + ' 个研发阶段蓝图卡片！你可以直接修改任意卡片的目标说明、负责角色或独占文件分片，确认无误后点击「🚀 确认蓝图并立项拆解」。',
          })
        }).catch(() => {
          setPreviewing(false)
          const normalized = buildClientFallbackBlueprint(promptTrimmed)
          setStageCards(normalized)
          setFeedback({
            tone: 'ok',
            text: '已为您生成 ' + normalized.length + ' 个默认研发拆解阶段，可直接微调后立项启动。',
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
          setFeedback({ tone: 'warn', text: '请先输入你的想法或选择一个模板后再立项拆解。' })
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
          const derivedProjectName = deriveProjectNameFromWish(promptTrimmed, projectHint)
          if (!targetEng) {
            let openRes = await api({ op: 'engagementOpen', name: derivedProjectName })
            if (!openRes || openRes.ok === false) {
              openRes = await api({ op: 'openEngagement', name: derivedProjectName })
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
              const activeSid = (currentSess && currentSess.id) || (readHostDomTelemetry().sessionId) || ''
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
            session: (currentSess && currentSess.id) || undefined,
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
            text: '立项成功！已将 ' + editedGoals.length + ' 个并行研发任务装填至下方工作流画布。',
          })
          setManualOpen(false)
          if (typeof props.onDecomposed === 'function') {
            props.onDecomposed(decompRes, editedGoals, finalPrompt || derivedProjectName, targetEng)
          }
        } catch (err) {
          setLaunching(false)
          setFeedback({ tone: 'err', text: '立项请求异常：' + (err && err.message ? err.message : String(err)) })
        }
      }

      return h('div', {
        className: 'rt-bento-card rt-wish-wizard-card',
        style: {
          marginBottom: 12,
          padding: isExpanded ? '14px 16px' : '9px 14px',
          border: '1px solid rgba(77, 107, 254, 0.28)',
          background: 'linear-gradient(135deg, rgba(77,107,254,0.06) 0%, rgba(16,185,129,0.04) 100%)',
        },
      },
        /* 顶栏：向导折叠/展开开关 + 新手/专家模式切换器 */
        h('div', {
          style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
        },
          h('button', {
            type: 'button',
            className: 'rt-btn' + (isExpanded ? ' rt-btn-primary' : ''),
            onClick: () => setManualOpen(!isExpanded),
            style: { fontWeight: 700, fontSize: 12.5, padding: '4px 12px' },
          }, isExpanded ? '✨ 许愿拆解向导（收起）' : '✨ 许愿拆解向导'),
          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
            uiMode === 'novice'
              ? '不懂编程也能做软件：说出你的想法，AI 团队自动分工设计、写代码与测试验收'
              : '零代码需求润色 → File-Disjoint 独占文件分片蓝图预览 → 一键写入 4-Wave DAG 并发队列'),
          h('div', { className: 'rt-spacer' }),
          h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }, title: '🌱 新手简洁视图 ⇄ 🔧 专家全量视图' },
            '🌱 新手简洁视图 ⇄ 🔧 专家全量视图'),
          h(UiModeSwitcher, { compact: true })),

        /* 展开态：许愿输入框 + 4 个一键模板 + 双按钮 + 可编辑阶段蓝图卡片 */
        isExpanded ? h('div', { className: 'rt-wish-wizard-body', style: { marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 } },
          /* 4 个一键灵感模板 */
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('span', { style: { fontSize: 11.5, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, '💡 一键套用灵感模板：'),
            WISH_STARTER_TEMPLATES.map((tpl) => h('button', {
              key: tpl.id,
              type: 'button',
              className: 'rt-btn',
              style: { borderRadius: 999, fontSize: 11.5, padding: '3px 10px' },
              onClick: () => applyStarter(tpl),
            }, tpl.label))),

          /* 自然语言许愿框 */
          h('textarea', {
            className: 'rt-textarea',
            rows: 3,
            value: wishText,
            onChange: (e) => setWishText(e.target.value),
            placeholder: '用大白话描述你想做的软件、网页或工具（例如：做一个带番茄钟和数据统计的个人待办网页应用）...',
            style: {
              width: '100%',
              boxSizing: 'border-box',
              fontSize: 13,
              lineHeight: 1.55,
              padding: '10px 12px',
              borderRadius: 8,
            },
          }),

          /* 项目名称可选自定义 + 双主操作按钮 */
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            !eng ? h('input', {
              className: 'rt-input',
              value: projectHint,
              onChange: (e) => setProjectHint(e.target.value),
              placeholder: '可选：项目名称（留空将根据描述自动命名）',
              style: { width: 250, fontSize: 12 },
            }) : h('span', { className: 'rt-tag rt-tag-live' }, '当前工作区：' + (props.engagementName || eng)),
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

          /* 可编辑阶段蓝图卡片网格 */
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
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } },
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
