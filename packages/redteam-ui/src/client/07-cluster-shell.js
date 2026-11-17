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
     *   · 顶部并发槽快捷控制 + 前往设置页调参入口
     *   · p5 实时协作树：阶段无缩放 DOM 测量 + 1:1 SVG 边覆盖 (.rt-tree-edges-svg)
     *   · 下方承接 4-Wave DAG 与检视器（HarnessWorkflowDeck variant='cluster'）
     *   · 未绑定工作区时严格保持 0/max 空闲态，零跨工作区泄露
     */
    const p5UseLayoutEffect = React.useLayoutEffect || React.useEffect

    const p5MeasureBox = (nodeEl, stageEl) => {
      if (typeof measureBoxInStage === 'function') return measureBoxInStage(nodeEl, stageEl)
      if (!nodeEl || !stageEl) return null
      let left = 0
      let top = 0
      let cur = nodeEl
      while (cur && cur !== stageEl) {
        left += Number(cur.offsetLeft) || 0
        top += Number(cur.offsetTop) || 0
        cur = cur.offsetParent
      }
      if (cur !== stageEl) return null
      const width = Number(nodeEl.offsetWidth) || 0
      const height = Number(nodeEl.offsetHeight) || 0
      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        midX: left + width / 2,
        midY: top + height / 2,
      }
    }

    function ClusterP5Tree(props) {
      const eng = props.engagement || null
      const agents = props.agents || {}
      const [filter, setFilter] = React.useState('all')
      const [zoom, setZoom] = React.useState(100)
      const [edgeGeom, setEdgeGeom] = React.useState(null)

      const stageRef = React.useRef(null)
      const rootRef = React.useRef(null)
      const childRefs = React.useRef({})

      const children = React.useMemo(() => {
        const net = (agents.agentNetwork && Array.isArray(agents.agentNetwork.children)) ? agents.agentNetwork.children : []
        const rawList = []
        if (Array.isArray(agents.running)) rawList.push.apply(rawList, agents.running)
        if (Array.isArray(agents.children)) rawList.push.apply(rawList, agents.children)
        rawList.push.apply(rawList, net)
        const seen = new Set()
        const out = []
        for (const item of rawList) {
          if (!item || typeof item !== 'object') continue
          const id = String(item.session_id || item.sessionId || item.id || item.worker_task_id || item.worker_name || out.length)
          if (seen.has(id)) continue
          seen.add(id)
          const st = String(item.status || (item.running ? 'running' : 'done')).toLowerCase()
          const isRunning = st === 'running' || st === 'active' || st === 'in_progress' || Boolean(item.running)
          const isError = st === 'error' || st === 'failed' || st === 'blocked'
          const role = String(item.worker_role || item.role || 'worker').trim()
          const title = String(item.title || item.worker_name || role || id).trim()
          const sessionId = String(item.session_id || item.sessionId || '').trim()
          out.push({
            id,
            title,
            role,
            wave: item.wave || '',
            goal: String(item.assigned_goal || item.goal || item.objective || '').trim(),
            status: isError ? 'error' : (isRunning ? 'running' : 'done'),
            statusLabel: isError ? '异常' : (isRunning ? '运行中' : '已完成'),
            sessionId,
            color: isError ? '#ef4444' : (isRunning ? '#3b82f6' : '#10b981'),
          })
        }
        return out
      }, [agents])

      const showChildren = filter !== 'lead' ? children : []
      const showRoot = filter !== 'sub'
      const runningCount = children.filter((c) => c.status === 'running').length
      const layoutSig = String(eng || '') + '|' + filter + '|' + zoom + '|' + showChildren.map((c) => c.id + ':' + c.status).join(',')

      const measureEdges = React.useCallback(() => {
        try {
          const stEl = stageRef.current
          if (!stEl || !showRoot || showChildren.length === 0) {
            setEdgeGeom(null)
            return
          }
          const w = Number(stEl.offsetWidth) || 0
          const hPx = Number(stEl.offsetHeight) || 0
          const rootBox = p5MeasureBox(rootRef.current, stEl)
          if (!(w > 0) || !(hPx > 0) || !rootBox) return
          const x1 = Math.round(rootBox.midX * 10) / 10
          const y1 = Math.round(rootBox.bottom * 10) / 10
          const edges = []
          for (const c of showChildren) {
            const cBox = p5MeasureBox(childRefs.current[c.id], stEl)
            if (!cBox) continue
            const x2 = Math.round(cBox.midX * 10) / 10
            const y2 = Math.round(cBox.top * 10) / 10
            const dy = Math.max(18, Math.round((y2 - y1) * 0.52 * 10) / 10)
            edges.push({
              key: 'p5-' + c.id,
              d: 'M ' + x1 + ',' + y1 + ' C ' + x1 + ',' + (y1 + dy) + ' ' + x2 + ',' + (y2 - dy) + ' ' + x2 + ',' + y2,
              endX: x2,
              endY: y2,
              color: c.color,
              cls: c.status === 'error' ? 'is-error' : (c.status === 'running' ? 'is-running' : 'is-done'),
            })
          }
          setEdgeGeom({ w, h: hPx, startX: x1, startY: y1, edges })
        } catch { /* ignore stub DOM without layout metrics */ }
      }, [showRoot, showChildren])

      p5UseLayoutEffect(() => {
        measureEdges()
        const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(measureEdges) : null
        let ro = null
        if (typeof ResizeObserver === 'function') {
          try {
            ro = new ResizeObserver(measureEdges)
            if (stageRef.current) ro.observe(stageRef.current)
            if (rootRef.current) ro.observe(rootRef.current)
            Object.keys(childRefs.current).forEach((k) => { if (childRefs.current[k]) ro.observe(childRefs.current[k]) })
          } catch { ro = null }
        }
        return () => {
          if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
          if (ro && typeof ro.disconnect === 'function') ro.disconnect()
        }
      }, [layoutSig, measureEdges])

      if (!eng) return null

      return h('div', { className: 'rt-p5-board', style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'rt-p5-topbar' },
          h('span', { style: { fontWeight: 700, fontSize: 12.5 } },
            '团队任务板 · ' + (1 + children.length) + ' 成员 · ' + runningCount + ' 运行中'),
          h('div', { className: 'rt-p5-filters' },
            [
              { k: 'all', lbl: '全部' },
              { k: 'lead', lbl: '主代理 Captain' },
              { k: 'sub', lbl: '子代理 (' + children.length + ')' },
            ].map((fp) => h('button', {
              key: 'p5f-' + fp.k,
              type: 'button',
              className: 'rt-p3-pill' + (filter === fp.k ? ' on' : ''),
              onClick: () => setFilter(fp.k),
            }, fp.lbl))),
          h('div', { className: 'rt-spacer' }),
          h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
            h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '树状图'),
            h('button', { type: 'button', className: 'rt-btn', style: { padding: '1px 7px', fontSize: 11 }, onClick: () => setZoom((z) => Math.max(70, z - 10)) }, '-'),
            h('button', { type: 'button', className: 'rt-btn', style: { padding: '1px 7px', fontSize: 11 }, onClick: () => setZoom(100) }, zoom + '%'),
            h('button', { type: 'button', className: 'rt-btn', style: { padding: '1px 7px', fontSize: 11 }, onClick: () => setZoom((z) => Math.min(130, z + 10)) }, '+'))),
        h('div', {
          className: 'rt-p5-canvas-wrap',
          style: {
            border: '1px solid var(--dsw-alias-border-l1)',
            borderRadius: 12,
            padding: '20px 16px 24px',
            background: 'var(--dsw-alias-bg-base)',
            overflow: 'auto',
          },
        },
          h('div', {
            ref: stageRef,
            className: 'rt-p5-tree-stage',
            style: { transform: 'scale(' + (zoom / 100) + ')', gap: 36 },
          },
            edgeGeom && edgeGeom.edges.length > 0
              ? h('svg', {
                  className: 'rt-tree-edges-svg',
                  viewBox: '0 0 ' + edgeGeom.w + ' ' + edgeGeom.h,
                  preserveAspectRatio: 'none',
                  'aria-hidden': 'true',
                },
                  h('circle', { cx: edgeGeom.startX, cy: edgeGeom.startY, r: 3.5, fill: '#3b82f6' }),
                  edgeGeom.edges.map((ed) => h('g', { key: ed.key },
                    h('path', {
                      className: 'rt-tree-edge-path ' + ed.cls,
                      d: ed.d,
                      style: { '--rt-edge-color': ed.color },
                    }),
                    h('circle', { cx: ed.endX, cy: ed.endY, r: 3.2, fill: ed.color }))))
              : null,
            h('div', { className: 'rt-tree-node-layer', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 36 } },
              showRoot
                ? h('div', { className: 'rt-p5-root-wrap' },
                    h('div', {
                      ref: rootRef,
                      className: 'rt-p5-node rt-p5-root',
                      style: {
                        width: '100%',
                        position: 'relative',
                        border: '1.5px solid #3b82f6',
                        borderRadius: 10,
                        padding: '10px 12px',
                        background: 'var(--dsw-alias-bg-layer-1)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      },
                    },
                      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                        h('span', { className: 'rt-p5-pill', style: { background: '#3b82f6', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999 } }, '主代理'),
                        h('strong', { style: { fontSize: 12.5 } }, 'Captain 主控架构师'),
                        h('div', { className: 'rt-spacer' }),
                        h('span', { className: 'rt-tag rt-tag-live', style: { margin: 0 } }, runningCount > 0 ? '协调中' : '就绪')),
                      h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                        '工作区 ' + eng + ' · 统筹 4-Wave 分片调度与摘要审批'),
                      showChildren.length > 0 ? h('span', { className: 'rt-tree-port rt-tree-port-bottom' }) : null))
                : null,
              showChildren.length > 0
                ? h('div', { className: 'rt-p5-branches-grid' },
                    showChildren.map((c) => h('div', Object.assign({
                      key: 'p5c-' + c.id,
                      ref: (el) => {
                        if (el) childRefs.current[c.id] = el
                        else delete childRefs.current[c.id]
                      },
                      className: 'rt-p5-node',
                      style: {
                        position: 'relative',
                        border: '1.5px solid ' + c.color,
                        borderRadius: 10,
                        padding: '10px 12px',
                        background: 'var(--dsw-alias-bg-layer-1)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 5,
                        cursor: c.sessionId ? 'pointer' : 'default',
                      },
                    }, c.sessionId ? clickable(() => { openAgentSessionInHostChat(c.sessionId, c.title) }, { label: '打开子代理 ' + c.title }) : {}),
                      showRoot ? h('span', { className: 'rt-tree-port rt-tree-port-top' }) : null,
                      h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                        h('span', { className: 'rt-p5-pill', style: { background: c.color, color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999 } }, c.role),
                        c.wave ? h('span', { className: 'rt-tag rt-tag-passive', style: { margin: 0 } }, c.wave) : null,
                        h('div', { className: 'rt-spacer' }),
                        h('span', { style: { fontSize: 10.5, fontWeight: 600, color: c.color } }, c.statusLabel)),
                      h('div', { style: { fontWeight: 700, fontSize: 12.5 } }, c.title),
                      c.goal ? h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.45 } }, c.goal) : null)))
                : filter !== 'lead'
                    ? h('div', { className: 'rt-empty', style: { width: '100%' } }, '尚无已派发的子代理任务。')
                    : null))))
    }

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
            setCtrlMsg('已生效：并发槽上限 ' + (r.max || clamped) + ' 槽')
            load()
          } else {
            setCtrlMsg((r && r.error) || '调整并发槽失败')
          }
        }, (e) => setCtrlMsg(String((e && e.message) || e)))
      }

      const presets = [
        { n: 3, label: '3 槽' },
        { n: 6, label: '6 槽 (推荐)' },
        { n: 8, label: '8 槽' },
        { n: 12, label: '12 槽' },
      ]

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '智能体与并发'),
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
              h('span', { className: 'rt-tag rt-tag-passive' }, '深度 ' + maxDepth + ' · 思考 ' + thinking),
              h('button', {
                type: 'button',
                className: 'rt-btn',
                onClick: () => { if (typeof props.onGo === 'function') props.onGo('settings') },
              }, '在设置页调整全部参数 →'),
              h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginLeft: 'auto' } },
                '同一项目',
                h('b', { style: { color: 'var(--dsw-alias-label-primary)' } }, '同时最多 ' + max + ' 个执行智能体'),
                ' · 经 ',
                h('code', { className: 'rt-code-inline' }, 'redteam_agent_slot'),
                ' 核验')),
            ctrlMsg ? h('div', { style: { fontSize: 11, color: '#2563eb', marginTop: 6, fontWeight: 600 } }, ctrlMsg) : null),
          h(ClusterP5Tree, {
            engagement: eng,
            agents: effectiveAgents,
            onOpenCollab: () => { if (typeof props.onGo === 'function') props.onGo('collab') },
            onOpenSettings: () => { if (typeof props.onGo === 'function') props.onGo('settings') },
          }),
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
              h('h4', { style: { margin: 0 } }, '8 角色 gstack 编队'),
              h('span', { className: 'rt-wb-recurse-tag' }, '按工作区持久化模板')),
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
                    isSelected ? '当前 · ' + r.role + '.md' : '编辑 ' + r.role + '.md →'))
              }))),
          eng
            ? h('div', { className: 'rt-card' },
                h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } },
                  '角色提示词 · ' + eng + ' · ' + openRole + '.md'),
                h(PromptsTab, { engagement: eng, refreshKey: refreshKey, selectedRole: openRole }))
            : h('div', { className: 'rt-card' },
                h('h4', { style: { marginTop: 0 } }, '当前会话尚未初始化工作区'),
                h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 10, lineHeight: 1.55 } },
                  '初始化当前会话工作台后，可按工作区独立编辑各角色提示词。'),
                h('button', {
                  type: 'button',
                  className: 'rt-btn rt-btn-primary',
                  onClick: () => { if (typeof props.onGo === 'function') props.onGo('collab') },
                }, '前往「协同与审批」初始化 →'))))
    }

    /**
     * 版本显示 + 自动更新按钮（带卸载清理的倒计时定时器，杜绝组件卸载后泄露）。
     */
    function VersionBar() {
      const [info, setInfo] = React.useState(null)
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
            api({ op: 'version' }).then((v) => { if (v && v.ok !== false) setInfo(v) }, () => {})
            return
          }
          setInfo(r)
        }, () => {
          setBusy(false)
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
        const lsSid = window.localStorage && parseDshStoredSessionId(window.localStorage.getItem('dsh.sessions.current'))
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
        hub = { subs: new Set(), inflight: false, lastSections: null, timer: null, unsubSse: null }
        _digestHubs.set(eng, hub)
      }
      hub.subs.add(onSections)
      if (hub.lastSections) onSections(hub.lastSections)
      _pollDigestHub(eng)
      if (hub.timer === null && typeof window !== 'undefined' && typeof window.setInterval === 'function') {
        hub.timer = window.setInterval(() => _pollDigestHub(eng), 25000)
      }
      if (hub.unsubSse === null) {
        hub.unsubSse = subscribeHostEvents(eng, () => _pollDigestHub(eng), 1200)
      }
      return () => {
        const curHub = _digestHubs.get(eng)
        if (!curHub) return
        curHub.subs.delete(onSections)
        if (curHub.subs.size === 0) {
          if (curHub.timer !== null) {
            try { window.clearInterval(curHub.timer) } catch { /* ignore */ }
          }
          if (typeof curHub.unsubSse === 'function') curHub.unsubSse()
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
      const [eng, setEng] = React.useState(null)
      const [boundEng, setBoundEng] = React.useState(null)
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
          if (selectId) { setEng(selectId); loadSnapshot(selectId) }
        }, () => {})
      }

      const followTo = (id, list, source) => {
        const known = (list || engagements).some((x) => x.id === id)
        if (!known) return false
        manualPickRef.current = null
        setFollowSource(source || 'bound')
        setEng(id)
        loadSnapshot(id)
        return true
      }

      const getNamedEngagements = (list) => (list || engagements).filter((x) => !isRawUuidName(x.name || x.id) && !isRawUuidName(x.id))

      const applyResolvedBinding = (r, id, list, title) => {
        const known = list || engagements
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
            setFollowSource('unbound')
          }
        })
      }

      React.useEffect(() => {
        const dom = readHostDomTelemetry()
        let lsCurrentSid = null
        try {
          lsCurrentSid = window.localStorage && parseDshStoredSessionId(window.localStorage.getItem('dsh.sessions.current'))
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
        return api({ op: 'openEngagement', name: name, session: sid || undefined }).then((r) => {
          if (!r || r.ok === false) { setErr((r && r.error) || '创建失败'); return null }
          const createdId = (r.engagement && r.engagement.id) || r.id || name
          if (createdId) {
            manualPickRef.current = null
            setBoundEng(createdId)
            setEng(createdId)
            setFollowSource('bound')
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
        setFollowSource('bound')
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
        setFollowSource('bound')
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
        ['settings', '设置'],
      ]
      const TAB_GROUPS = [
        { key: 'collab', label: '协同与审批', tabs: ['collab'] },
        { key: 'overview', label: '总览', tabs: ['overview'] },
        { key: 'assets', label: '架构', tabs: ['assets'] },
        { key: 'results', label: '质量', tabs: ['findings', 'scores'] },
        { key: 'report', label: '报告', tabs: ['report'] },
        { key: 'resources', label: '集群', tabs: ['agents', 'prompts', 'sessions', 'artifacts', 'knowledge', 'skills'] },
        { key: 'settings', label: '设置', tabs: ['settings'] },
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
      if (st.tab === 'settings') {
        body = typeof SettingsHubTab === 'function'
          ? h(SettingsHubTab, {
              engagement: eng,
              engagements: visibleEngagements,
              sessionId: sid,
              refreshKey: refreshKey,
              onRefresh: refreshAll,
              onGo: goTab,
              compact: false,
            })
          : h('div', { className: 'rt-pane' }, h('div', { className: 'rt-empty' }, '设置中心尚未加载'))
      } else if (err) {
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
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12, lineHeight: 1.55 } },
              '按会话 1:1 隔离工作区；请前往「协同与审批」初始化或关联已有项目。'),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h('button', {
                type: 'button',
                className: 'rt-btn rt-btn-primary',
                onClick: () => goTab('collab'),
              }, '前往「协同与审批」初始化 →'),
              canReopenOnboarding
                ? h('button', {
                    type: 'button',
                    className: 'rt-btn',
                    onClick: handleReopenOnboarding,
                  }, '重新获取初始化指引')
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
                        setFollowSource('bound')
                        setEng(boundEng)
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
                title: '重新打开工作台初始化指引',
                onClick: handleReopenOnboarding,
              }, '重新指引')
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
              setFollowSource(null)
              setEng(next)
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
            ? h('button', { className: 'rt-btn', title: '退出全屏（Esc）', onClick: exitFull }, '退出全屏')
            : null,
          h('button', { className: 'rt-btn', title: '刷新当前数据', onClick: refreshAll }, '刷新'),
          h('button', {
            type: 'button',
            className: 'rt-btn' + (st.tab === 'settings' ? ' rt-btn-primary' : ''),
            title: '打开统一设置中心',
            onClick: () => goTab('settings'),
          }, '设置'),
          full ? null : h('button', {
            className: 'rt-btn',
            title: isDesktopShell() ? '当前窗口全屏查看（Esc 退出）' : '新窗口打开',
            onClick: openFull,
          }, '全面浏览'),
          (full || embedMode) ? null : h('button', { className: 'rt-btn', title: '收起面板', onClick: () => setUI({ open: false }) }, '收起')),
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
            st.uiMode === 'novice' ? 'LMTAgent · 协同工作台' : 'LMTAgent · 4-Wave DAG'),
          h('div', { className: 'rt-spacer' }),
          full ? h('span', null, 'Esc 退出全屏') : null,
          eng
            ? h('span', null, (st.uiMode === 'novice' ? '工作区 · ' : 'PG/WAL · ') + currentEngName)
            : h('span', null, isSessionDismissed ? '当前会话 · 独立空白态（未绑定工作区）' : '当前会话 · 待初始化工作区'),
          sid === null
            ? null
            : h('span', {
                title: '当前会话 ' + sid + (sesTitle ? '（' + sesTitle + '）' : ''),
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
        () => h('div', { style: { margin: 12, display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
            h('div', null,
              h('div', { style: { fontWeight: 700, fontSize: 13 } }, 'LMTAgent 统一设置中心'),
              h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                'AI 规划、并发派发、存储、飞书与界面偏好')),
            h('button', {
              type: 'button',
              className: 'rt-btn rt-btn-primary',
              onClick: () => setUI({ open: true, tab: 'settings' }),
            }, '打开完整控制台')),
          typeof SettingsHubTab === 'function'
            ? h(SettingsHubTab, {
                compact: true,
                onGo: (tab) => setUI({ open: true, tab: tab || 'settings' }),
              })
            : null),
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
