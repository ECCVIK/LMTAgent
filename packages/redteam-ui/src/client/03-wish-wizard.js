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

    const WIZARD_ROLE_OPTIONS = [
      ['recon', 1],
      ['designer', 1],
      ['assess', 2],
      ['exploit', 3],
      ['qa', 4],
      ['vuln-scan', 4],
      ['internal', 4],
    ].map(([value, wave]) => ({ value, label: ROLE_LABEL[value] || value, wave }))

    const WIZARD_WAVE_OPTIONS = [1, 2, 3, 4]

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

    const normalizeBlueprintGoals = (rawList) => {
      if (!Array.isArray(rawList) || rawList.length === 0) {
        return []
      }
      return rawList.map((item, idx) => {
        const rawObj = (item && typeof item === 'object') ? item : { title: String(item || '') }
        const role = String(rawObj.role || rawObj.agent_role || rawObj.worker_role || 'exploit').trim()
        const roleOpt = WIZARD_ROLE_OPTIONS.find((r) => r.value === role) || WIZARD_ROLE_OPTIONS[3]
        const filesArr = Array.isArray(rawObj.files_owned)
          ? rawObj.files_owned
          : (Array.isArray(rawObj.filesOwned) ? rawObj.filesOwned : null)
        const filesStr = filesArr
          ? filesArr.join(', ')
          : String(rawObj.files_owned || rawObj.filesOwned || rawObj.shard || '')
        const parsedWave = Number(rawObj.wave_num || rawObj.wave)
        const waveNo = Number.isFinite(parsedWave) && parsedWave >= 1 && parsedWave <= 4
          ? parsedWave
          : roleOpt.wave
        return {
          id: String(rawObj.id || rawObj.worker_id || rawObj.goal_id || ('goal-' + (idx + 1))),
          wave: waveNo,
          role: roleOpt.value,
          title: String(rawObj.title || rawObj.name || rawObj.worker_name || ('阶段任务 #' + (idx + 1))),
          assignedGoal: String(rawObj.assigned_goal || rawObj.assignedGoal || rawObj.goal || rawObj.description || rawObj.title || ''),
          filesOwned: filesStr,
        }
      })
    }

    const normalizeClarifyResponse = (res) => {
      if (!res || typeof res !== 'object') return null
      const rawQuestions = res.questions || res.followups || res.clarifying_questions || res.prompts || []
      const questions = Array.isArray(rawQuestions)
        ? rawQuestions.map((q, idx) => {
            if (typeof q === 'string') {
              return { id: 'q-' + (idx + 1), text: q, options: [], multi: false }
            }
            if (!q || typeof q !== 'object') return null
            const rawOpts = q.options || q.choices || q.suggestions || []
            const options = Array.isArray(rawOpts)
              ? rawOpts.map((o) => (typeof o === 'string' ? o : String((o && (o.label || o.value || o.text)) || ''))).filter(Boolean)
              : []
            return {
              id: String(q.id || q.key || ('q-' + (idx + 1))),
              text: String(q.question || q.title || q.label || q.text || ('补充问题 #' + (idx + 1))),
              options,
              multi: Boolean(q.multi || q.multiple),
            }
          }).filter(Boolean)
        : []

      const rawDims = res.dimensions || res.clarify_dimensions || res.chips || res.suggested_dimensions || []
      const dimensions = []
      if (Array.isArray(rawDims)) {
        rawDims.forEach((d, idx) => {
          if (typeof d === 'string') {
            const lbl = d.trim()
            if (lbl) dimensions.push({ id: 'dim-' + (idx + 1), group: '', label: lbl, snippet: lbl })
            return
          }
          if (!d || typeof d !== 'object') return
          const label = String(d.label || d.name || d.title || d.value || '').trim()
          const nested = Array.isArray(d.options || d.choices) ? (d.options || d.choices) : null
          if (nested && nested.length > 0) {
            nested.forEach((opt, oi) => {
              const oLabel = typeof opt === 'string'
                ? opt.trim()
                : String((opt && (opt.label || opt.name || opt.value || opt.text)) || '').trim()
              if (!oLabel) return
              dimensions.push({
                id: 'dim-' + (idx + 1) + '-' + (oi + 1),
                group: String(d.group || d.category || label || '').trim(),
                label: oLabel,
                snippet: String((opt && (opt.snippet || opt.value)) || oLabel).trim(),
              })
            })
            return
          }
          if (!label) return
          dimensions.push({
            id: String(d.id || ('dim-' + (idx + 1))),
            group: String(d.group || d.category || '').trim(),
            label,
            snippet: String(d.snippet || d.prompt || d.description || label).trim(),
          })
        })
      }

      const summary = String(res.summary || res.analysis || res.project_summary || res.detected_context || res.note || '').trim()
      return { summary, questions, dimensions }
    }

    const extractLlmErrorInfo = (res, stage, fallbackMsg) => {
      const code = String((res && (res.error_code || res.code || res.error)) || 'request_failed')
      const msg = String((res && (res.message || res.detail || res.error_message || res.error)) || fallbackMsg)
      const isLlmUnavailable = Boolean(
        res && (
          res.llm_unavailable === true
          || res.error === 'llm_unavailable'
          || res.code === 'llm_unavailable'
          || res.error_code === 'llm_unavailable'
        )
      )
      return { stage, code, isLlmUnavailable, text: msg }
    }

    const extractWave1Sessions = (res) => {
      if (!res || typeof res !== 'object') return []
      const directList = res.wave1_sessions || res.wave1Sessions || res.dispatched_sessions || res.spawned_sessions || res.sessions
      const out = []
      const seen = new Set()
      const pushItem = (raw) => {
        if (!raw) return
        if (typeof raw === 'string') {
          if (!seen.has(raw)) {
            seen.add(raw)
            out.push({ sessionId: raw, title: '', role: '', status: 'running' })
          }
          return
        }
        if (typeof raw !== 'object') return
        const sid = String(raw.session_id || raw.sessionId || raw.id || '').trim()
        if (!sid || seen.has(sid)) return
        seen.add(sid)
        out.push({
          sessionId: sid,
          title: String(raw.title || raw.worker_name || raw.name || '').trim(),
          role: String(raw.role || raw.worker_role || '').trim(),
          status: String(raw.status || 'dispatched').trim(),
        })
      }
      if (Array.isArray(directList)) directList.forEach(pushItem)
      if (out.length === 0 && Array.isArray(res.worker_tasks)) {
        res.worker_tasks.forEach((wt) => {
          if (wt && wt.session_id && (Number(wt.wave) === 1 || String(wt.status || '').toLowerCase() === 'running')) {
            pushItem(wt)
          }
        })
      }
      return out
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

      const [clarifying, setClarifying] = React.useState(false)
      const [clarifyData, setClarifyData] = React.useState(null)
      const [clarifyAnswers, setClarifyAnswers] = React.useState({})
      const [selectedDims, setSelectedDims] = React.useState([])
      const [extraClarifyNote, setExtraClarifyNote] = React.useState('')

      const [previewing, setPreviewing] = React.useState(false)
      const [launching, setLaunching] = React.useState(false)
      const [handoffBusy, setHandoffBusy] = React.useState(false)
      const [llmError, setLlmError] = React.useState(null)
      const [dispatchReceipt, setDispatchReceipt] = React.useState(null)
      const [feedback, setFeedback] = React.useState(null)

      /* 会话切换时重置草稿与默认工作台命名，杜绝跨会话串味 */
      React.useEffect(() => {
        setHintEdited(false)
        setProjectHint(!eng ? cleanSessionHint : '')
        setStageCards([])
        setRefinedWish('')
        setClarifyData(null)
        setClarifyAnswers({})
        setSelectedDims([])
        setExtraClarifyNote('')
        setLlmError(null)
        setDispatchReceipt(null)
        setFeedback(null)
      }, [activeSid])

      React.useEffect(() => {
        if (!eng && !hintEdited) {
          setProjectHint(cleanSessionHint)
        }
      }, [eng, cleanSessionHint, hintEdited])

      const serializeClarifications = () => {
        const answers = []
        if (clarifyData && Array.isArray(clarifyData.questions)) {
          clarifyData.questions.forEach((q, idx) => {
            const qKey = q.id || ('q-' + (idx + 1))
            const val = clarifyAnswers[qKey]
            const ansText = Array.isArray(val) ? val.join('、') : String(val || '').trim()
            if (ansText) {
              answers.push({ id: qKey, question: q.text, answer: ansText })
            }
          })
        }
        const dimensions = selectedDims.slice()
        const note = String(extraClarifyNote || '').trim()
        if (answers.length === 0 && dimensions.length === 0 && !note) return undefined
        const summaryParts = answers.map((a) => a.question + '：' + a.answer)
        if (dimensions.length > 0) summaryParts.push('约束维度：' + dimensions.join('；'))
        if (note) summaryParts.push('补充说明：' + note)
        return {
          answers,
          dimensions,
          note: note || undefined,
          summary: summaryParts.join('\n'),
        }
      }

      const serializeStageCards = (cards) => cards.map((card, idx) => {
        const filesList = String(card.filesOwned || '')
          .split(/[,，\n]+/)
          .map((s) => s.trim())
          .filter(Boolean)
        const waveNo = Math.max(1, Math.min(4, Number(card.wave) || 3))
        return {
          id: card.id || ('goal-' + (idx + 1)),
          wave: waveNo,
          wave_num: waveNo,
          role: card.role || 'exploit',
          title: String(card.title || '').trim() || ('阶段 #' + (idx + 1)),
          assigned_goal: String(card.assignedGoal || card.title || '').trim(),
          assignedGoal: String(card.assignedGoal || card.title || '').trim(),
          files_owned: filesList,
          filesOwned: filesList,
        }
      })

      const ensureWorkspaceForSession = async (promptTrimmed) => {
        let targetEng = eng || ''
        const derivedProjectName = deriveProjectNameFromWish(promptTrimmed, projectHint || cleanSessionHint)
        if (targetEng) return { targetEng, derivedProjectName }
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
        return { targetEng, derivedProjectName }
      }

      const toggleQuestionOption = (qId, opt, multi) => {
        setClarifyAnswers((prev) => {
          const cur = prev[qId]
          if (multi) {
            const list = Array.isArray(cur) ? cur.slice() : (cur ? [String(cur)] : [])
            const idx = list.indexOf(opt)
            if (idx >= 0) list.splice(idx, 1)
            else list.push(opt)
            return Object.assign({}, prev, { [qId]: list })
          }
          return Object.assign({}, prev, { [qId]: cur === opt ? '' : opt })
        })
      }

      const toggleDimension = (dimSnippet) => {
        setSelectedDims((prev) => (
          prev.includes(dimSnippet)
            ? prev.filter((x) => x !== dimSnippet)
            : prev.concat([dimSnippet])
        ))
      }

      const handleClarifyWithAI = () => {
        const promptTrimmed = String(wishText || '').trim()
        if (!promptTrimmed) {
          setFeedback({ tone: 'warn', text: '请先输入需要实现的功能目标或工程需求。' })
          return
        }
        setClarifying(true)
        setLlmError(null)
        setFeedback(null)
        api({
          op: 'clarifyWishWithAI',
          engagement_id: eng || undefined,
          engagement: eng || undefined,
          session: activeSid || undefined,
          prompt: promptTrimmed,
        }).then((res) => {
          setClarifying(false)
          if (!res || res.ok === false || res.llm_unavailable === true || res.error === 'llm_unavailable' || res.code === 'llm_unavailable') {
            setLlmError(extractLlmErrorInfo(res, 'clarify', '模型服务不可用或未配置，未能获取 AI 澄清问题。'))
            return
          }
          if (!eng && !hintEdited && (res.project_name || res.projectName) && !projectHint) {
            setProjectHint(String(res.project_name || res.projectName))
          }
          const parsed = normalizeClarifyResponse(res)
          if (!parsed || (parsed.questions.length === 0 && parsed.dimensions.length === 0 && !parsed.summary)) {
            setLlmError(extractLlmErrorInfo(res, 'clarify', '模型未返回有效澄清维度，请直接重试 AI 拆解或转交主代理。'))
            return
          }
          setClarifyData(parsed)
          setClarifyAnswers({})
          setSelectedDims([])
          setFeedback({
            tone: 'ok',
            text: '已由模型生成项目专属澄清问题，选择或补充后点击「AI 拆解蓝图」。',
          })
        }).catch((err) => {
          setClarifying(false)
          setLlmError({
            stage: 'clarify',
            code: 'network_error',
            isLlmUnavailable: false,
            text: 'AI 澄清请求异常：' + (err && err.message ? err.message : String(err)),
          })
        })
      }

      const handleRefinePreview = () => {
        const promptTrimmed = String(wishText || '').trim()
        if (!promptTrimmed) {
          setFeedback({ tone: 'warn', text: '请先输入需要实现的功能目标或工程需求。' })
          return
        }
        setPreviewing(true)
        setLlmError(null)
        setDispatchReceipt(null)
        setFeedback(null)
        const clarificationsPayload = serializeClarifications()
        api({
          op: 'refineAndDecomposeWish',
          engagement_id: eng || undefined,
          engagement: eng || undefined,
          session: activeSid || undefined,
          prompt: promptTrimmed,
          clarifications: clarificationsPayload,
          preview_only: true,
        }).then((res) => {
          setPreviewing(false)
          if (!res || res.ok === false || res.llm_unavailable === true || res.error === 'llm_unavailable' || res.code === 'llm_unavailable') {
            setLlmError(extractLlmErrorInfo(res, 'decompose', '模型服务不可用或调用失败，无法生成拆解蓝图。'))
            return
          }
          const serverRefined = res.refined_prompt || res.refinedPrompt || (res.blueprint && res.blueprint.refined_prompt)
          if (serverRefined) setRefinedWish(String(serverRefined))
          if (!eng && !hintEdited && (res.project_name || res.projectName) && !projectHint) {
            setProjectHint(String(res.project_name || res.projectName))
          }
          const rawGoals = res.goals || res.stages || res.subgoals || res.proposed_waves || (res.blueprint && res.blueprint.goals) || []
          const normalized = normalizeBlueprintGoals(rawGoals)
          if (normalized.length === 0) {
            setLlmError({
              stage: 'decompose',
              code: 'empty_blueprint',
              isLlmUnavailable: false,
              text: '模型未返回有效的分片蓝图条目，请补充需求细节后重试或直交主代理接管。',
            })
            return
          }
          setStageCards(normalized)
          setFeedback({
            tone: 'ok',
            text: '已生成 ' + normalized.length + ' 个可执行分片，请核对目标、角色、Wave 与文件边界后点击「确认立项并派发」。',
          })
        }).catch((err) => {
          setPreviewing(false)
          setLlmError({
            stage: 'decompose',
            code: 'network_error',
            isLlmUnavailable: false,
            text: 'AI 拆解请求异常：' + (err && err.message ? err.message : String(err)),
          })
        })
      }

      const handleHandoffToCaptain = async () => {
        const promptTrimmed = String(wishText || '').trim()
        if (!promptTrimmed) {
          setFeedback({ tone: 'warn', text: '请先输入需求描述后再转交主代理接管。' })
          return
        }
        setHandoffBusy(true)
        setFeedback(null)
        try {
          const clarificationsPayload = serializeClarifications()
          const res = await api({
            op: 'handoffToCaptain',
            engagement_id: eng || undefined,
            engagement: eng || undefined,
            session: activeSid || undefined,
            prompt: promptTrimmed,
            clarifications: clarificationsPayload,
            goals: stageCards.length > 0 ? serializeStageCards(stageCards) : undefined,
          })
          setHandoffBusy(false)
          if (!res || res.ok === false) {
            setFeedback({
              tone: 'err',
              text: '转交主代理失败：' + ((res && (res.message || res.error)) || '后端未返回成功回执'),
            })
            return
          }
          setLlmError(null)
          const targetEng = String(res.engagement || res.engagement_id || eng || '').trim()
          if (targetEng && targetEng !== eng && typeof props.onWorkspaceCreated === 'function') {
            props.onWorkspaceCreated(targetEng, res.project_name || projectHint || cleanSessionHint || targetEng)
          }
          setDispatchReceipt({
            mode: 'handoff',
            totalGoals: stageCards.length,
            wave1Sessions: extractWave1Sessions(res),
            captainNotified: res.captain_notified !== false,
            captainNote: String(res.captain_note || res.message || res.note || '已将需求与上下文转交主代理（Captain）在当前会话接管。'),
          })
          if (typeof props.onDecomposed === 'function') {
            props.onDecomposed(res, stageCards, promptTrimmed, targetEng || eng)
          }
        } catch (err) {
          setHandoffBusy(false)
          setFeedback({ tone: 'err', text: '转交主代理异常：' + (err && err.message ? err.message : String(err)) })
        }
      }

      const updateCardField = (idx, field, val) => {
        setStageCards((prev) => prev.map((c, i) => {
          if (i !== idx) return c
          const next = Object.assign({}, c, { [field]: val })
          if (field === 'role') {
            const matched = WIZARD_ROLE_OPTIONS.find((r) => r.value === val)
            if (matched) next.wave = matched.wave
          } else if (field === 'wave') {
            next.wave = Math.max(1, Math.min(4, Number(val) || 3))
          }
          return next
        }))
      }

      const addStageCard = () => {
        setStageCards((prev) => prev.concat([{
          id: 'wish-stage-custom-' + (prev.length + 1),
          wave: 3,
          role: 'exploit',
          title: '新增研发分片 #' + (prev.length + 1),
          assignedGoal: '',
          filesOwned: '',
        }]))
      }

      const removeStageCard = (idx) => {
        setStageCards((prev) => prev.filter((_, i) => i !== idx))
      }

      const handleConfirmAndDecompose = async () => {
        const promptTrimmed = String(wishText || '').trim()
        if (!promptTrimmed && stageCards.length === 0) {
          setFeedback({ tone: 'warn', text: '请先输入需求描述并点击「AI 拆解蓝图」。' })
          return
        }
        if (stageCards.length === 0) {
          setFeedback({ tone: 'warn', text: '请先点击「AI 拆解蓝图」获取分片方案，或通过「直交主代理接管」直接调度。' })
          return
        }
        const editedGoals = serializeStageCards(stageCards)
        const clarificationsPayload = serializeClarifications()

        setLaunching(true)
        setLlmError(null)
        setDispatchReceipt(null)
        setFeedback(null)
        try {
          const { targetEng, derivedProjectName } = await ensureWorkspaceForSession(promptTrimmed)
          const finalPrompt = refinedWish ? (promptTrimmed + '\n\n【需求润色】' + refinedWish) : promptTrimmed
          const decompRes = await api({
            op: 'refineAndDecomposeWish',
            engagement_id: targetEng || 'default',
            engagement: targetEng || 'default',
            session: activeSid || undefined,
            prompt: finalPrompt || derivedProjectName,
            clarifications: clarificationsPayload,
            goals: editedGoals,
            preview_only: false,
          })

          setLaunching(false)
          if (!decompRes || decompRes.ok === false || decompRes.llm_unavailable === true || decompRes.error === 'llm_unavailable') {
            setLlmError(extractLlmErrorInfo(decompRes, 'decompose', '立项与派发失败，请检查模型配置或转交主代理接管。'))
            return
          }
          const wave1Sessions = extractWave1Sessions(decompRes)
          const captainNotified = decompRes.captain_notified ?? decompRes.captainNotified ?? decompRes.notified_captain
          const dispatchWarnings = [
            ...(Array.isArray(decompRes.warnings) ? decompRes.warnings : []),
            ...(decompRes.dispatched && Array.isArray(decompRes.dispatched.warnings) ? decompRes.dispatched.warnings : []),
          ].map((x) => String(x || '').trim()).filter(Boolean)
          const captainNote = String(
            decompRes.captain_note
            || decompRes.captain_message
            || decompRes.dispatch_summary
            || decompRes.note
            || decompRes.message
            || (captainNotified === false ? '未自动通知主代理' : '已同步写入工作流并通知主代理协同调度')
          )
          setDispatchReceipt({
            mode: 'decompose',
            totalGoals: editedGoals.length,
            wave1Sessions,
            captainNotified: captainNotified !== false,
            captainNote: dispatchWarnings.length > 0 && wave1Sessions.length === 0
              ? dispatchWarnings.join('；')
              : captainNote,
          })
          if (wave1Sessions.length === 0 && captainNotified === false) {
            setFeedback({
              tone: 'warn',
              text: '分片已写入事实库，但未拉起子代理或唤醒主代理：' + (dispatchWarnings[0] || captainNote),
            })
          } else {
            setFeedback({
              tone: 'ok',
              text: '立项成功，已写入 ' + editedGoals.length + ' 个分片' + (wave1Sessions.length > 0 ? ('，已拉起 ' + wave1Sessions.length + ' 个 Wave 1 子代理执行') : '并通知主代理协同调度') + '。',
            })
          }
          if (typeof props.onDecomposed === 'function') {
            props.onDecomposed(decompRes, editedGoals, finalPrompt || derivedProjectName, targetEng)
          }
        } catch (err) {
          setLaunching(false)
          setFeedback({ tone: 'err', text: '立项请求异常：' + (err && err.message ? err.message : String(err)) })
        }
      }

      const isAiBusy = clarifying || previewing || launching || handoffBusy

      return h('div', {
        className: 'rt-bento-card rt-wish-wizard rt-wish-wizard-card',
        style: {
          padding: isExpanded ? '12px 14px' : '8px 12px',
          border: '1px solid rgba(77, 107, 254, 0.22)',
          background: 'linear-gradient(135deg, rgba(77,107,254,0.04) 0%, rgba(16,185,129,0.02) 100%)',
        },
      },
        h('div', {
          style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
        },
          h('strong', { style: { fontSize: 13 } }, 'AI 需求澄清与蓝图立项'),
          h('div', { className: 'rt-spacer' }),
          h('button', {
            type: 'button',
            className: 'rt-btn',
            onClick: () => setManualOpen(!isExpanded),
            style: { fontWeight: 600, fontSize: 11.5, padding: '3px 10px' },
          }, isExpanded ? '收起' : '展开')),

        isExpanded ? h('div', { className: 'rt-wish-wizard-body', style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 } },
          h('textarea', {
            className: 'rt-textarea',
            rows: 3,
            value: wishText,
            onChange: (e) => setWishText(e.target.value),
            placeholder: '描述目标功能、技术栈约束与验收要求…',
            style: {
              width: '100%',
              boxSizing: 'border-box',
              fontSize: 13,
              lineHeight: 1.55,
              padding: '9px 11px',
              borderRadius: 8,
            },
          }),

          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            !eng
              ? h('input', {
                  className: 'rt-input',
                  value: projectHint,
                  onChange: (e) => { setHintEdited(true); setProjectHint(e.target.value) },
                  placeholder: '工作台名称（留空自动生成）',
                  style: { width: 210, fontSize: 12 },
                })
              : null,
            h('button', {
              type: 'button',
              className: 'rt-btn',
              disabled: isAiBusy,
              onClick: handleClarifyWithAI,
              style: { fontWeight: 600, padding: '5px 12px' },
            }, clarifying ? '分析中…' : 'AI 澄清需求'),
            h('button', {
              type: 'button',
              className: 'rt-btn',
              disabled: isAiBusy,
              onClick: handleRefinePreview,
              style: { fontWeight: 600, padding: '5px 12px' },
            }, previewing ? '拆解中…' : 'AI 拆解蓝图'),
            h('button', {
              type: 'button',
              className: 'rt-btn rt-btn-primary',
              disabled: isAiBusy || stageCards.length === 0,
              onClick: handleConfirmAndDecompose,
              style: { fontWeight: 700, padding: '5px 14px' },
            }, launching ? '立项派发中…' : '确认立项并派发')),

          (clarifying || previewing) ? h('div', {
            className: 'rt-note',
            style: {
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderColor: 'rgba(77, 107, 254, 0.45)',
              background: 'rgba(77, 107, 254, 0.07)',
            },
          },
            h('span', { className: 'rt-p5-spin', style: { color: '#4d6bfe' } }, '●'),
            h('span', { style: { fontWeight: 600 } }, '正在调用模型分析需求与项目结构…')) : null,

          feedback ? h('div', {
            className: feedback.tone === 'err' ? 'rt-err' : 'rt-note',
            style: {
              margin: 0,
              borderColor: feedback.tone === 'err' ? '#ef4444' : feedback.tone === 'warn' ? '#f59e0b' : 'rgba(16,185,129,0.45)',
            },
          }, feedback.text) : null,

          llmError ? h('div', {
            className: 'rt-err',
            style: {
              margin: 0,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid rgba(239, 68, 68, 0.42)',
              background: 'rgba(239, 68, 68, 0.06)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            },
          },
            h('div', { style: { fontWeight: 700, fontSize: 12.5 } },
              (llmError.isLlmUnavailable ? '模型服务不可用：' : 'AI 处理失败：') + llmError.text),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              llmError.stage === 'clarify'
                ? h('button', {
                    type: 'button',
                    className: 'rt-btn',
                    disabled: isAiBusy,
                    onClick: handleClarifyWithAI,
                  }, '重试 AI 澄清')
                : null,
              h('button', {
                type: 'button',
                className: 'rt-btn',
                disabled: isAiBusy,
                onClick: handleRefinePreview,
              }, '重试 AI 拆解'),
              h('button', {
                type: 'button',
                className: 'rt-btn',
                onClick: () => setUI({ tab: 'settings' }),
              }, '打开设置配置模型'),
              h('button', {
                type: 'button',
                className: 'rt-btn rt-btn-primary',
                disabled: isAiBusy,
                onClick: handleHandoffToCaptain,
              }, handoffBusy ? '正在转交…' : '直交主代理接管'))) : null,

          clarifyData ? h('div', {
            className: 'rt-wish-clarify-panel',
            style: {
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-1, rgba(255,255,255,0.5))',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            },
          },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
              h('strong', { style: { fontSize: 12 } }, 'AI 澄清追问与项目维度'),
              h('button', {
                type: 'button',
                className: 'rt-btn',
                style: { fontSize: 11, padding: '1px 7px' },
                onClick: () => setClarifyData(null),
              }, '收起澄清')),
            clarifyData.summary
              ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 } }, clarifyData.summary)
              : null,
            clarifyData.dimensions.length > 0
              ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' } },
                  clarifyData.dimensions.map((dim) => {
                    const active = selectedDims.includes(dim.snippet)
                    return h('button', {
                      key: dim.id,
                      type: 'button',
                      className: 'rt-btn' + (active ? ' rt-btn-primary' : ''),
                      style: { fontSize: 11.5, padding: '2px 9px', borderRadius: 999 },
                      title: dim.snippet,
                      onClick: () => toggleDimension(dim.snippet),
                    }, (active ? '✓ ' : '+ ') + (dim.group ? (dim.group + ' · ') : '') + dim.label)
                  }))
              : null,
            clarifyData.questions.map((q, qIdx) => {
              const qKey = q.id || ('q-' + (qIdx + 1))
              const curVal = clarifyAnswers[qKey]
              const textVal = Array.isArray(curVal) ? curVal.join('、') : String(curVal || '')
              return h('div', {
                key: qKey,
                style: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  paddingTop: 6,
                  borderTop: '1px dashed var(--dsw-alias-border-l1)',
                },
              },
                h('div', { style: { fontSize: 12, fontWeight: 600 } }, (qIdx + 1) + '. ' + q.text),
                q.options.length > 0
                  ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 5 } },
                      q.options.map((opt, oIdx) => {
                        const isPicked = Array.isArray(curVal) ? curVal.includes(opt) : curVal === opt
                        return h('button', {
                          key: qKey + '-o-' + oIdx,
                          type: 'button',
                          className: 'rt-btn' + (isPicked ? ' rt-btn-primary' : ''),
                          style: { fontSize: 11, padding: '2px 8px', borderRadius: 999 },
                          onClick: () => toggleQuestionOption(qKey, opt, q.multi),
                        }, opt)
                      }))
                  : null,
                h('input', {
                  className: 'rt-input',
                  value: textVal,
                  onChange: (e) => {
                    const v = e.target.value
                    setClarifyAnswers((prev) => Object.assign({}, prev, { [qKey]: v }))
                  },
                  placeholder: '输入补充回答…',
                  style: { fontSize: 12 },
                }))
            }),
            h('input', {
              className: 'rt-input',
              value: extraClarifyNote,
              onChange: (e) => setExtraClarifyNote(e.target.value),
              placeholder: '其他补充约束（选填）…',
              style: { fontSize: 12 },
            })) : null,

          dispatchReceipt ? h('div', {
            className: 'rt-dispatch-receipt',
            style: {
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid rgba(16, 185, 129, 0.45)',
              background: 'rgba(16, 185, 129, 0.07)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontSize: 12,
            },
          },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('strong', null, dispatchReceipt.mode === 'handoff' ? '已转交主代理接管' : '派发回执'),
              dispatchReceipt.totalGoals > 0
                ? h('span', { className: 'rt-tag rt-tag-live' }, dispatchReceipt.totalGoals + ' 个分片')
                : null,
              h('span', { className: 'rt-tag ' + (dispatchReceipt.captainNotified ? 'rt-tag-live' : '') },
                dispatchReceipt.captainNotified ? '主代理已通知' : '主代理待同步')),
            h('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, dispatchReceipt.captainNote),
            dispatchReceipt.wave1Sessions.length > 0
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                  h('span', { style: { fontWeight: 600, fontSize: 11.5 } },
                    '已拉起 Wave 1 子代理会话（' + dispatchReceipt.wave1Sessions.length + '）：'),
                  h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                    dispatchReceipt.wave1Sessions.map((ws) => h('span', {
                      key: ws.sessionId,
                      className: 'rt-tag rt-mono',
                    }, (ws.role ? (ws.role + ' · ') : '') + (ws.title ? (ws.title + ' · ') : '') + ws.sessionId))))
              : h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                  'Wave 1 任务已落库并通知主代理协调执行。')) : null,

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
              h('strong', { style: { fontSize: 12.5 } }, '拆解蓝图（' + stageCards.length + ' 个分片）'),
              h('div', { style: { display: 'inline-flex', gap: 6 } },
                h('button', { type: 'button', className: 'rt-btn', style: { fontSize: 11, padding: '2px 8px' }, onClick: addStageCard }, '+ 新增分片'),
                h('button', {
                  type: 'button',
                  className: 'rt-btn rt-btn-primary',
                  disabled: isAiBusy,
                  style: { fontSize: 11, padding: '2px 10px', fontWeight: 700 },
                  onClick: handleConfirmAndDecompose,
                }, launching ? '立项派发中…' : '确认立项并派发'))),
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
                  h('select', {
                    className: 'rt-select',
                    value: String(card.wave || 3),
                    'aria-label': '所属波次 Wave',
                    onChange: (e) => updateCardField(idx, 'wave', Number(e.target.value)),
                    style: { fontSize: 11, padding: '1px 6px', fontWeight: 600 },
                  }, WIZARD_WAVE_OPTIONS.map((w) => h('option', { key: 'w-' + w, value: String(w) }, formatWaveHeaderByMode(w, 'Wave ' + w, uiMode)))),
                  h('div', { className: 'rt-spacer' }),
                  stageCards.length > 1 ? h('button', {
                    type: 'button',
                    className: 'rt-btn',
                    style: { padding: '0 6px', fontSize: 10.5 },
                    onClick: () => removeStageCard(idx),
                  }, '移除') : null),
                h('label', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '分片标题与目标'),
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
                h('label', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '独占文件分片 (files_owned)'),
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
          api({ op: 'sessionOnboarding', session: activeSid, action: 'skip', title: cleanSessionTitle || undefined }).then(() => {
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
              || '阶段执行完毕，等待审批。'
            ).trim()
            const touchedFiles = Array.isArray(digestSrc.files_touched)
              ? digestSrc.files_touched
              : (Array.isArray(digestSrc.filesTouched) ? digestSrc.filesTouched : filesList)
            const verificationText = String(
              digestSrc.verification
              || digestSrc.test_result
              || digestSrc.verifyResult
              || raw.verification
              || (statusRaw === 'blocked' ? '存在阻塞项' : (isApproved ? '已通过验收' : '待确认放行'))
            ).trim()
            merged.push({
              id,
              sessionId: raw.session_id || raw.sessionId || id,
              wave: Number(raw.wave) || 3,
              role: roleCode,
              roleLabel: ROLE_LABEL[roleCode] || roleCode,
              title: String(raw.title || raw.name || ('分片任务 ' + id)),
              status: statusRaw || 'pending',
              approvalState: approvalRaw || (isPendingDecision ? 'pending_approval' : (isApproved ? 'approved' : 'pending_approval')),
              isPendingDecision,
              isApproved,
              filesOwned: filesList,
              assignedGoal: String(raw.assigned_goal || raw.assignedGoal || raw.prompt || ''),
              nextGoalDefault: String(raw.next_goal || raw.nextGoal || raw.assigned_goal || raw.assignedGoal || ''),
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
        const dispatchedRef = res.dispatched_session_id || res.next_session_id || res.next_worker_id || ''
        setQueueToast({
          tone: 'ok',
          text: '✓ 已审批通过「' + item.title + '」'
            + (dispatchedRef ? (' · 已派发 ' + dispatchedRef) : '')
            + (res.note ? (' · ' + res.note) : ''),
        })
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
        const retrySid = (res && (res.session_id || res.sessionId || (res.worker_task && res.worker_task.session_id))) || ''
        setQueueToast({
          tone: 'ok',
          text: '↻ 已触发「' + item.title + '」重跑分片'
            + (retrySid ? ('（子会话 ' + retrySid + '）') : '')
            + (res && res.note ? (' · ' + res.note) : ''),
        })
        loadApprovalDag()
        if (typeof props.onRefresh === 'function') props.onRefresh()
      }

      const handleJumpItemChat = (item) => {
        const res = openAgentSessionInHostChat(item, {
          engagement: eng,
          sessionId: activeSid,
          sessionTitle: cleanSessionTitle,
        })
        setQueueToast({
          tone: 'ok',
          text: res.targetSid
            ? ('已切换侧边对话至：' + res.targetTitle)
            : ('已返回侧边对话窗口：' + res.targetTitle),
        })
      }

      const showFullOnboardingCard = (!isBound && !isDismissed) || forceShowGuide
      const boundDisplayName = isBound
        ? ((engName && !isRawUuidName(engName)) ? engName : eng)
        : ''
      const hasActiveTasks = reviewItems.length > 0

      return h('div', { className: 'rt-pane rt-collab-page' },
        /* ── Card 1: 仅在未绑定工作台或主动重开指引时渲染，已绑定状态不重复占屏 ── */
        showFullOnboardingCard
          ? h('section', { className: 'rt-card rt-onboard-card' },
              h('div', { className: 'rt-onboard-head' },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                  h('span', { className: 'rt-onboard-title' }, '初始化当前会话工作台'),
                  h('span', { className: 'rt-tag rt-tag-active' }, sessionBadgeText),
                  sessionCwd
                    ? h('span', { className: 'rt-tag rt-mono', title: sessionCwd }, sessionCwd)
                    : null),
                h('button', {
                  type: 'button',
                  className: 'rt-btn',
                  onClick: handleSkipGuide,
                }, isBound ? '收起' : '跳过指引')),

              !isBound
                ? h('div', { className: 'rt-onboard-actions' },
                    h('input', {
                      className: 'rt-input',
                      value: wsNameDraft,
                      onChange: (e) => { setWsNameEdited(true); setWsNameDraft(e.target.value) },
                      placeholder: '输入工作台名称…',
                      style: { flex: '1 1 240px', minWidth: 200 },
                    }),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-btn-primary',
                      disabled: creatingWs,
                      onClick: handleCreateWorkspaceForSession,
                      style: { fontWeight: 700, padding: '6px 14px' },
                    }, creatingWs ? '正在创建…' : '创建并绑定工作台'))
                : null,

              !isBound && engagements.length > 0
                ? h('details', { className: 'rt-onboard-bind-details' },
                    h('summary', null, '关联已有项目（' + engagements.length + '）'),
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
                : null)
          : (!isBound && isDismissed
              ? h('section', { className: 'rt-card rt-onboard-card is-compact' },
                  h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 } },
                      h('span', { className: 'rt-tag' }, '待初始化'),
                      h('span', { style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 } },
                        (cleanSessionTitle || '当前会话') + ' 尚未绑定工作台')),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn' + (!hasConv ? ' rt-btn-primary' : ''),
                      onClick: handleReopenGuide,
                      style: { fontWeight: 700 },
                    }, '重新获取初始化指引')))
              : null),

        /* ── Card 2: WishRefinerWizard（真 AI 需求澄清与蓝图立项） ── */
        h('section', { className: 'rt-card rt-wish-dialogue-card' },
          h(WishRefinerWizard, {
            engagement: eng,
            engagementName: boundDisplayName,
            sessionId: activeSid,
            sessionTitle: cleanSessionTitle,
            hasActiveWork: hasActiveTasks,
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

        /* ── Card 3: ApprovalQueueCard（精简待审队列：标题 / 状态 / 审批动作） ── */
        h('section', { className: 'rt-card rt-approval-queue-wrap' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
            h('strong', { style: { fontSize: 13 } }, '阶段审批队列'),
            h('span', {
              className: 'rt-tag ' + (pendingCount > 0 ? 'rt-tag-warn' : 'rt-tag-live'),
            }, pendingCount > 0 ? ('待审批 ' + pendingCount) : '已全部处理'),
            h('div', { className: 'rt-spacer' }),
            h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
              h('button', {
                type: 'button',
                className: 'rt-btn' + (queueFilter === 'pending' ? ' rt-btn-primary' : ''),
                style: { padding: '2px 9px', fontSize: 11.5 },
                onClick: () => setQueueFilter('pending'),
              }, '待决策 (' + pendingCount + ')'),
              h('button', {
                type: 'button',
                className: 'rt-btn' + (queueFilter === 'all' ? ' rt-btn-primary' : ''),
                style: { padding: '2px 9px', fontSize: 11.5 },
                onClick: () => setQueueFilter('all'),
              }, '全部 (' + reviewItems.length + ')')),
            eng
              ? h('button', {
                  type: 'button',
                  className: 'rt-btn',
                  disabled: dagLoading,
                  style: { padding: '2px 9px', fontSize: 11.5 },
                  onClick: loadApprovalDag,
                }, dagLoading ? '同步中…' : '刷新')
              : null),

          queueToast
            ? h('div', {
                className: queueToast.tone === 'err' ? 'rt-err' : 'rt-note',
                style: { margin: '0 0 8px' },
              }, queueToast.text)
            : null,

          visibleQueueItems.length === 0
            ? h('div', { className: 'rt-empty', style: { padding: '16px 12px', margin: 0 } },
                '暂无待审批分片任务。')
            : h('div', { className: 'rt-approval-list' },
                visibleQueueItems.map((item) => {
                  const isBusy = busyItemId === item.id
                  return h('div', {
                    key: item.id,
                    className: 'rt-approval-card' + (item.isPendingDecision ? ' is-pending' : ''),
                  },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                      h('span', { className: 'rt-tag rt-tag-active' }, 'Wave ' + item.wave + ' · ' + item.roleLabel),
                      h('strong', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, item.title),
                      h('div', { className: 'rt-spacer' }),
                      h('span', {
                        className: 'rt-tag ' + (item.isApproved ? 'rt-tag-live' : (item.isPendingDecision ? 'rt-tag-warn' : '')),
                      }, item.isApproved ? '已审批' : (item.approvalState === 'revision_required' ? '待修订' : '待审批'))),

                    item.filesOwned.length > 0
                      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
                          item.filesOwned.map((fp) => h('span', { key: fp, className: 'rt-shard-lock-badge' }, fp)))
                      : null,

                    h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 } },
                      item.digest.whatDone + ' · ' + item.digest.verificationText
                      + (item.digest.touchedFiles.length > 0 ? (' · 文件：' + item.digest.touchedFiles.join(', ')) : '')),

                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                      h('input', {
                        className: 'rt-input',
                        style: { flex: '1 1 200px', minWidth: 180, fontSize: 12 },
                        value: getDraftGoalFor(item),
                        onChange: (e) => {
                          const v = e.target.value
                          setNextGoalDrafts((prev) => Object.assign({}, prev, { [item.id]: v }))
                        },
                        placeholder: '下一阶段目标或修订说明…',
                      }),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn rt-btn-primary rt-plan-approve-btn',
                        disabled: isBusy,
                        onClick: () => handleApproveItem(item),
                      }, isBusy ? '处理中…' : '审批通过'),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn',
                        disabled: isBusy,
                        onClick: () => handleRetryItem(item),
                      }, '退回重跑'),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn rt-jump-chat-btn',
                        onClick: () => handleJumpItemChat(item),
                      }, '打开对话')))
                }))))
    }
