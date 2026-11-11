    /* ═══════════════════════════════════════════════════════════════════════════
     * 07-cluster-shell.js — 8 角色集群页签、版本更新条、单例定时器中枢、常驻控制台外壳与导出闭合
     * ═══════════════════════════════════════════════════════════════════════════ */

    /** 8-Role gstack 虚拟研发团队模块化角色定义（2×4 Bento 网格） */
    const GSTACK_ROLE_ROSTER = [
      {
        role: 'plan',
        badge: '⓪ plan Captain',
        title: '主控指挥（主会话调度）',
        wave: 'Wave 0–4 全程中枢',
        skills: ['/dag-orchestrate', '/slot-gate', '/pg-sync'],
        desc: '拆解用户意图、按 4-Wave DAG 调度 6 并发槽、核对 PostgreSQL 事实库并汇总汇报，不直接改业务文件。',
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
     * 智能体页签：统一并发数量与编队状态控制器（消除原 3 处重复步进条）
     * + 递归子代理派发配置（maxDepth=3, thinking=low）
     * + 2×4 模块化 gstack 角色卡片网格 + 按需展开的工作流画布预览 + 角色提示词编辑器。
     */
    function AgentsTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [roles, setRoles] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [openRole, setOpenRole] = React.useState('plan')
      const [promptOpen, setPromptOpen] = React.useState(false)
      const [showEmbeddedDeck, setShowEmbeddedDeck] = React.useState(false)
      const [concurrency, setConcurrency] = React.useState(null)
      const [draftMax, setDraftMax] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [maxDepth, setMaxDepth] = React.useState(3)
      const [thinking, setThinking] = React.useState('low')
      const [ctrlMsg, setCtrlMsg] = React.useState(null)
      const [activeWave, setActiveWave] = React.useState(0)

      const load = () => {
        setBusy(true)
        api({ op: eng ? 'prompts' : 'bootstrap', engagement: eng || undefined }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null)
          if (r.roles) setRoles(r.roles)
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
        api({ op: 'agentsStatus', engagement: eng || undefined }).then((r) => {
          if (r && r.ok !== false) {
            setConcurrency(r)
            if (r.max) setDraftMax(String(r.max))
            if (typeof r.maxDepth === 'number') setMaxDepth(r.maxDepth)
            if (typeof r.thinking === 'string' && r.thinking) setThinking(r.thinking)
          }
        }, () => {})
      }
      React.useEffect(load, [eng, refreshKey])

      const domTel = readHostDomTelemetry()
      const used = concurrency ? concurrency.used : null
      const max = concurrency ? concurrency.max : 6
      const limit = (concurrency && concurrency.limit) || 12
      const dbEngine = (concurrency && concurrency.db_engine) || null
      const sourceLabel = concurrency && concurrency.source === 'settings'
        ? '面板中设置'
        : (concurrency && concurrency.source === 'env' ? '环境变量 REDTEAM_MAX_AGENTS' : '默认值')

      const applySlotMax = (targetMax) => {
        const parsed = Number(targetMax)
        if (!Number.isFinite(parsed)) return
        const clamped = Math.max(1, Math.min(limit, Math.floor(parsed)))
        setDraftMax(String(clamped))
        setConcurrency((prev) => Object.assign({}, prev || {}, { max: clamped, source: 'settings' }))
        setCtrlMsg('正在调整并发槽上限为 ' + clamped + ' 槽…')
        api({ op: 'setAgentsMax', max: clamped }).then((r) => {
          if (r && r.ok !== false) {
            setCtrlMsg('已生效：并发槽上限 ' + (r.max || clamped) + ' 槽 · 递归深度 maxDepth=' + maxDepth + ' · thinking=' + thinking)
            load()
          } else {
            setCtrlMsg((r && r.error) || '调整并发槽失败')
          }
        }, (e) => setCtrlMsg(String((e && e.message) || e)))
        api({ op: 'setClusterConfig', maxAgents: clamped, maxDepth: maxDepth, thinking: thinking }).then(() => {}, () => {})
      }

      const applyRecursionConfig = (nextDepth, nextThinking) => {
        const d = Number(nextDepth) || 3
        const t = String(nextThinking || 'low')
        setMaxDepth(d)
        setThinking(t)
        setCtrlMsg('已更新递归子代理配置：maxDepth = ' + d + ' · 默认思考强度 thinking = ' + t)
        api({ op: 'setClusterConfig', maxAgents: max, maxDepth: d, thinking: t }).then(() => {}, () => {})
      }

      const presets = [
        { n: 3, label: '3 槽' },
        { n: 6, label: '6 槽 (推荐)' },
        { n: 8, label: '8 槽' },
        { n: 12, label: '12 槽' },
      ]

      const runningList = (concurrency && concurrency.running) || []
      const netChildren = (concurrency && concurrency.agentNetwork && Array.isArray(concurrency.agentNetwork.children))
        ? concurrency.agentNetwork.children
        : (concurrency && Array.isArray(concurrency.children) ? concurrency.children : [])
      const allWaveJobs = []
      const seenJobKeys = new Set()
      const pushWaveJob = (item, fallbackStatus) => {
        if (!item) return
        const label = String(item.label || item.title || item.role || '子智能体').trim()
        const key = String(item.id || label).toLowerCase()
        if (seenJobKeys.has(key)) return
        seenJobKeys.add(key)
        const wMatch = /Wave\s*(\d)/i.exec(label)
        const waveNum = Number(item.wave) || (wMatch ? Number(wMatch[1]) : 1)
        const role = item.role || (/designer/i.test(label) ? 'designer' : /recon/i.test(label) ? 'recon' : /assess/i.test(label) ? 'assess' : /exploit/i.test(label) ? 'exploit' : /vuln/i.test(label) ? 'vuln-scan' : /qa/i.test(label) ? 'qa' : 'recon')
        const rawSt = String(item.status || fallbackStatus || 'completed').toLowerCase()
        const status = rawSt === 'running' || rawSt === 'in_progress' || rawSt === 'active'
          ? 'running'
          : (/error|failed|blocked|timeout|shard_violation/.test(rawSt) ? 'error' : 'completed')
        allWaveJobs.push({
          id: item.id || ('job-' + allWaveJobs.length),
          wave: waveNum,
          role: role,
          label: label,
          status: status,
          tokensLabel: item.tokensLabel || (item.tokens ? fmtTokNum(item.tokens) + ' tok' : ''),
          durationLabel: item.durationLabel || item.activity || (status === 'running' ? '运行中' : (status === 'error' ? '异常待修复' : '已完成')),
          mode: item.mode || '',
        })
      }
      for (const r of runningList) pushWaveJob(r, 'running')
      for (const c of netChildren) pushWaveJob(c, c.status || 'completed')
      for (const d of (domTel.domSubagents || [])) pushWaveJob(d, d.status || 'completed')

      const completedWaveJobs = allWaveJobs.filter((j) => j.status !== 'running')
      const draftNum = Number(draftMax)
      const draftInvalid = !Number.isFinite(draftNum) || Math.floor(draftNum) !== draftNum || draftNum < 1 || draftNum > limit

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '研发集群智能体（8 角色 · 4-Wave DAG）'),
          h('span', { className: 'rt-tag rt-tag-passive' }, '并发上限 ' + max),
          used === null
            ? h('span', { className: 'rt-tag' }, '占用未知')
            : h('span', { className: 'rt-tag' + (used >= max ? ' rt-tag-warn' : ' rt-tag-live') },
                '在跑 ' + used + (completedWaveJobs.length ? ' · 已完成 ' + completedWaveJobs.length + ' 子代理' : '') + ' / 剩余 ' + Math.max(max - used, 0)),
          h('span', { className: 'rt-wb-recurse-tag', title: '允许子智能体针对局部微问题继续递归派生子智能体' },
            '递归子代理派发 · maxDepth = ' + maxDepth + ' · thinking = ' + thinking),
          dbEngine
            ? h('span', { className: 'rt-tag ' + (dbEngine.configured ? 'rt-tag-live' : 'rt-tag-passive') },
                dbEngine.configured ? 'PG 引擎已连接' : 'PG 兼容高并发 WAL')
            : null,
          h('div', { className: 'rt-spacer' }),
          h('button', {
            className: 'rt-btn' + (showEmbeddedDeck ? ' rt-btn-primary' : ''),
            title: '总览页已全幅承载工作流画布；此处默认收起避免双倍高度滚动，按需可展开预览',
            onClick: () => setShowEmbeddedDeck((v) => !v),
          }, showEmbeddedDeck ? '收起工作流画布预览' : '🗺️ 展开工作流画布预览'),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '读取中…' : '刷新')),
        h('div', { className: 'rt-pane' },
          err ? h('div', { className: 'rt-err' }, err) : null,
          (() => {
            const slotCount = Math.max(1, Math.min(max || 6, 12))
            const activeCount = typeof used === 'number' ? used : runningList.length
            const slots = Array.from({ length: slotCount }, (_, idx) => {
              const job = allWaveJobs[idx] || runningList[idx]
              const isRunning = idx < activeCount || (job && job.status === 'running')
              const isError = !isRunning && !!(job && job.status === 'error')
              const isDone = !isRunning && !isError && !!job
              return h('div', {
                key: 'slot' + idx,
                className: 'rt-wb-slot' + (isRunning ? ' on' : ''),
                style: isError
                  ? { borderColor: 'rgba(239,68,68,0.45)', background: 'rgba(239,68,68,0.06)' }
                  : (isDone ? { borderColor: 'rgba(59,130,246,0.38)', background: 'rgba(59,130,246,0.06)' } : undefined),
              },
                h('span', {
                  className: 'rt-dot',
                  style: isRunning
                    ? undefined
                    : (isError
                        ? { background: '#ef4444', boxShadow: '0 0 0 2px rgba(239,68,68,0.18)' }
                        : (isDone
                            ? { background: '#3b82f6', boxShadow: '0 0 0 2px rgba(59,130,246,0.18)' }
                            : { background: 'var(--dsw-alias-line-primary)', boxShadow: 'none' })),
                }),
                h('span', { className: 'rt-mono' }, 'SLOT #' + (idx + 1)),
                isRunning
                  ? h('span', { className: 'rt-tag rt-tag-live', style: { padding: '0 5px', fontSize: 10 } }, 'RUNNING')
                  : (isError
                      ? h('span', { className: 'rt-tag rt-tag-warn', style: { padding: '0 5px', fontSize: 10, color: '#dc2626' } }, 'ERROR · W' + (job.wave || 1))
                      : (isDone
                          ? h('span', { className: 'rt-tag rt-tag-passive', style: { padding: '0 5px', fontSize: 10, color: '#2563eb' } }, 'DONE · W' + (job.wave || 1))
                          : null)),
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  job ? (job.label + (job.tokensLabel ? ' · ' + job.tokensLabel : '')) : (isRunning ? 'Active' : 'Idle')))
            })
            return h('div', { className: 'rt-card' },
              h('h4', null, '并发数量与编队状态 · ' + slotCount + ' 并发槽实时监控 (WorkBuddy Cluster · p3 自适应并发控制器)'),
              h('div', { style: { fontSize: 12, lineHeight: 1.75, marginBottom: 8, color: 'var(--dsw-alias-label-secondary)' } },
                '同一项目',
                h('b', { style: { color: 'var(--dsw-alias-label-primary)' } }, '同时最多 ' + max + ' 个执行智能体'),
                '（来源：' + sourceLabel + '）· 派发前通过 ',
                h('code', { className: 'rt-code-inline' }, 'redteam_agent_slot'),
                ' 占位核验，改完立即生效，无需重启。'),
              h('div', { className: 'rt-p3-ctrl', style: { marginBottom: 10 } },
                h('span', { style: { fontSize: 11.5, fontWeight: 700 } }, '并发槽自调节'),
                h('div', { className: 'rt-p3-stepper', title: '调节并发槽位 (1–' + limit + ')' },
                  h('button', { className: 'rt-p3-step-btn', disabled: max <= 1, onClick: () => applySlotMax(max - 1) }, '-'),
                  h('span', { className: 'rt-p3-step-val' }, max + ' 槽'),
                  h('button', { className: 'rt-p3-step-btn', disabled: max >= limit, onClick: () => applySlotMax(max + 1) }, '+')),
                h('input', {
                  className: 'rt-p3-slider',
                  type: 'range', min: 1, max: limit, value: max,
                  onChange: (e) => applySlotMax(Number(e.target.value)),
                }),
                h('div', { className: 'rt-p3-pills' },
                  presets.map((p) => h('button', {
                    key: 'card-p' + p.n,
                    className: 'rt-p3-pill' + (max === p.n ? ' on' : ''),
                    onClick: () => applySlotMax(p.n),
                  }, p.label))),
                h('input', {
                  className: 'rt-input', style: { width: 68 }, type: 'number', min: 1, max: limit,
                  value: draftMax === '' ? String(max) : draftMax,
                  title: '直接输入并发槽数（1 – ' + limit + '）',
                  onChange: (e) => setDraftMax(e.target.value),
                  onKeyDown: (e) => { if (e.key === 'Enter' && !draftInvalid) applySlotMax(draftNum) },
                }),
                h('button', {
                  className: 'rt-btn rt-btn-primary',
                  disabled: busy || draftInvalid,
                  onClick: () => applySlotMax(draftNum),
                }, '保存'),
                h('div', { className: 'rt-p3-recurse-bar' },
                  h('span', { className: 'rt-wb-recurse-tag' }, '递归子代理派发'),
                  h('select', {
                    className: 'rt-input', style: { height: 24, fontSize: 11, padding: '0 6px' },
                    value: String(maxDepth),
                    onChange: (e) => applyRecursionConfig(Number(e.target.value), thinking),
                  },
                    h('option', { value: '1' }, '最大递归深度 maxDepth = 1'),
                    h('option', { value: '2' }, '最大递归深度 maxDepth = 2'),
                    h('option', { value: '3' }, '最大递归深度 maxDepth = 3'),
                    h('option', { value: '4' }, '最大递归深度 maxDepth = 4')),
                  h('select', {
                    className: 'rt-input', style: { height: 24, fontSize: 11, padding: '0 6px' },
                    value: thinking,
                    onChange: (e) => applyRecursionConfig(maxDepth, e.target.value),
                  },
                    h('option', { value: 'low' }, '默认思考强度 thinking = low (默认极速)'),
                    h('option', { value: 'medium' }, '思考强度 thinking = medium (均衡)'),
                    h('option', { value: 'high' }, '思考强度 thinking = high (深度)')))),
              ctrlMsg ? h('div', { style: { fontSize: 11, color: '#2563eb', marginBottom: 6, fontWeight: 600 } }, ctrlMsg) : null,
              h('div', { className: 'rt-wb-slots', style: { marginBottom: 8 } }, slots),
              allWaveJobs.length
                ? h('div', { style: { fontSize: 12, lineHeight: 1.8 } }, allWaveJobs.map((x, i) => h('div', { key: 'run' + i, style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                    h('span', { className: 'rt-tag ' + (x.status === 'running' ? 'rt-tag-live' : (x.status === 'error' ? 'rt-tag-warn' : 'rt-tag-passive')) },
                      x.status === 'running' ? (x.durationLabel || 'running') : (x.status === 'error' ? ('ERROR · Wave ' + x.wave) : ('DONE · Wave ' + x.wave))),
                    h('b', null, x.label || '子智能体'),
                    x.tokensLabel ? h('span', { className: 'rt-mono', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, x.tokensLabel) : null,
                    x.durationLabel && x.status !== 'running' ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '· ' + x.durationLabel) : null,
                    x.mode ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '· ' + x.mode) : null)))
                : h('div', { className: 'rt-foot' }, '当前没有在跑的执行智能体；派活后这里会显示角色、波次与 Token 遥测。'))
          })(),
          showEmbeddedDeck
            ? h(HarnessWorkflowDeck, { engagement: eng, agents: concurrency, refreshKey: refreshKey })
            : null,
          h('div', { className: 'rt-card' },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 } },
              h('h4', { style: { margin: 0 } }, '八位集群角色 · 2×4 模块化角色网格（gstack 虚拟研发团队对齐 · 点击卡片编辑提示词）'),
              h('span', { className: 'rt-wb-recurse-tag' }, '全员支持递归子代理派发 · maxDepth = ' + maxDepth + ' · thinking: ' + thinking)),
            h('div', { className: 'rt-wb-role-grid' },
              GSTACK_ROLE_ROSTER.map((r) => {
                const isSelected = openRole === r.role
                const roleData = (roles || []).find((x) => x.role === r.role)
                return h('div', Object.assign({
                  key: 'rc-' + r.role,
                  className: 'rt-wb-role-card' + (isSelected ? ' on' : ''),
                }, clickable(() => { setOpenRole(r.role); setPromptOpen(true) }, {
                  label: '选择并编辑角色 ' + r.badge + ' 提示词',
                  expanded: isSelected,
                })),
                  h('div', { className: 'rt-wb-role-top' },
                    h('span', { className: 'rt-wb-role-badge' }, r.badge),
                    h('span', { className: 'rt-tag rt-tag-passive' }, r.wave)),
                  h('div', { className: 'rt-wb-role-title' }, r.title + (roleData && roleData.stale ? '（旧版可升级）' : '')),
                  h('div', { className: 'rt-wb-role-desc' }, r.desc),
                  h('div', { className: 'rt-wb-role-tags' },
                    r.skills.map((sk) => h('span', { key: sk, className: 'rt-wb-skill-tag' }, sk)),
                    h('span', { className: 'rt-wb-recurse-tag' }, '可递归派发 · thinking: ' + thinking)),
                  h('div', { className: 'rt-wb-role-edit' },
                    isSelected ? '▾ 当前正在编辑 ' + r.role + '.md 提示词' : '点击编辑角色提示词 (' + r.role + '.md) →'))
              }))),
          (() => {
            const waveDefs = [
              { wave: 1, tag: 'WAVE 1 · 2 SLOTS', title: '双轨立项', roles: ['recon', 'designer'], desc: 'recon (CEO) + designer (Designer) 并行拆解需求与 UI 规范', shardHint: '产品范围矩阵 + Bento 组件树与设计令牌 (#4D6BFE)' },
              { wave: 2, tag: 'WAVE 2 · 1 SLOT', title: '架构单点锁', roles: ['assess'], desc: 'assess (Eng Manager) 冻结接口契约与 File-Disjoint 6 分片', shardHint: '冻结 API Schema 与互不重叠的独占文件分片' },
              { wave: 3, tag: 'WAVE 3 · 6 SLOTS', title: '满载并发构建', roles: ['exploit'], desc: '最多 6× exploit (Builder) 独占分片并行编码与递归子代理验证', shardHint: 'Shard 1–6 文件独占构建 · maxDepth=' + maxDepth + ' · thinking=' + thinking },
              { wave: 4, tag: 'WAVE 4 · 2→1 SLOTS', title: '双轨门禁与收尾', roles: ['vuln-scan', 'qa', 'internal'], desc: 'vuln-scan (CSO) + qa (QA Lead) 审计后由 internal 交付', shardHint: '静态审查 + 端到端回归 + Doc Wall 与飞书同步' },
            ]
            const filteredJobs = activeWave === 0
              ? allWaveJobs
              : allWaveJobs.filter((j) => j.wave === activeWave)
            return h('div', { className: 'rt-card' },
              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 8 } },
                h('h4', { style: { margin: 0 } }, 'Wave 1–4 并行任务与文件分片检查器 (File-Disjoint Shard Inspector)'),
                h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                  '同一项目',
                  h('b', null, '同时最多 ' + max + ' 个执行智能体'),
                  ' · 派发前通过 ',
                  h('code', { className: 'rt-code-inline' }, 'redteam_agent_slot'),
                  ' 占位核验')),
              h('div', { className: 'rt-wb-dag', style: { marginBottom: 8 } },
                waveDefs.map((w) => {
                  const wJobs = allWaveJobs.filter((j) => j.wave === w.wave)
                  const isSel = activeWave === w.wave
                  return h('div', Object.assign({
                    key: 'wi-' + w.wave,
                    className: 'rt-wb-wave',
                    style: {
                      cursor: 'pointer',
                      borderColor: isSel ? '#4d6bfe' : undefined,
                      background: isSel ? 'rgba(77,107,254,0.06)' : undefined,
                    },
                  }, clickable(() => setActiveWave(isSel ? 0 : w.wave), {
                    label: '筛选 Wave ' + w.wave + ' 任务与分片',
                    expanded: isSel,
                  })),
                    h('div', { className: 'rt-wb-wave-head' },
                      h('span', { className: 'rt-wb-wave-tag' }, w.tag),
                      h('span', { className: 'rt-wb-wave-title' }, w.title),
                      h('span', { className: 'rt-tag ' + (wJobs.length ? 'rt-tag-live' : 'rt-tag-passive'), style: { marginLeft: 'auto', fontSize: 10 } },
                        wJobs.length ? wJobs.length + ' 子代理' : '待调度')),
                    h('div', { className: 'rt-wb-wave-roles' }, w.desc),
                    h('div', { style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', marginTop: 4 } }, '交付物：' + w.shardHint))
                })),
              filteredJobs.length > 0
                ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6 } },
                    filteredJobs.map((j) => h('div', Object.assign({
                      key: 'wj-' + j.id,
                      className: 'rt-wb-role-card',
                      style: { padding: '7px 10px' },
                    }, clickable(() => { setOpenRole(j.role || 'plan'); setPromptOpen(true) }, {
                      label: '定位到角色 ' + (j.role || 'plan') + ' 提示词',
                    })),
                      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 } },
                        h('span', { className: 'rt-wb-role-badge' }, 'Wave ' + j.wave + ' · ' + j.role),
                        h('span', { className: 'rt-tag ' + (j.status === 'running' ? 'rt-tag-live' : (j.status === 'error' ? 'rt-tag-warn' : 'rt-tag-passive')) },
                          j.status === 'running' ? '● 进行中' : (j.status === 'error' ? '✕ 异常待修复' : '✓ 已完成'))),
                      h('div', { style: { fontWeight: 600, fontSize: 12, marginTop: 3 } }, j.label),
                      h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 2 } },
                        [j.tokensLabel, j.durationLabel].filter(Boolean).join(' · ')))))
                : h('div', { className: 'rt-foot' },
                    activeWave === 0
                      ? '点击上方任意 Wave 卡片可筛选对应波次的并行子代理与分片任务；点击角色卡片可直接编辑对应提示词。'
                      : 'Wave ' + activeWave + ' 暂无已登记子代理记录，点击已选中卡片可切回全部波次。'))
          })(),
          h('details', { className: 'rt-card', open: promptOpen || undefined },
            h('summary', Object.assign({
              style: { cursor: 'pointer', fontWeight: 600 },
            }, clickable(() => setPromptOpen((v) => !v), {
              label: '展开或收起角色提示词编辑器',
              expanded: promptOpen,
            })), '角色提示词（按工作区存，点开或点击上方 8 角色卡片直接编辑 · 当前选中：' + openRole + '）'),
            h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', margin: '4px 0 6px' } },
              '点击上方 2×4 角色卡片即可定位到对应角色的 Markdown 提示词；改完点保存，只影响当前工作区。'),
            h(PromptsTab, { engagement: eng, refreshKey: refreshKey, selectedRole: openRole }))))
    }

    /**
     * 版本显示 + 自动更新按钮（带卸载清理的倒计时定时器，杜绝组件卸载后泄露）。
     */
    function VersionBar() {
      const [info, setInfo] = React.useState(null)
      const [, setErr] = React.useState(null)
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
            if (!silent) setErr((r && r.error) || '检查更新失败')
            api({ op: 'version' }).then((v) => { if (v && v.ok !== false) setInfo(v) }, () => {})
            return
          }
          setErr(null)
          setInfo(r)
        }, (e) => {
          setBusy(false)
          if (!silent) setErr(String((e && e.message) || e))
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
    /* apply(ctx) 在 shell.overlay / main / conversation.view 三个槽位同时注册 Panel；
       用引用计数合并会话同步与 consoleDigest 轮询，杜绝 3 倍重复定时器风暴。 */
    let _sessionSyncRefs = 0
    let _sessionSyncTimer = null
    const _runSessionSyncTick = () => {
      if (_isCanvasDragging) return
      try {
        const lsSid = window.localStorage && window.localStorage.getItem('dsh.sessions.current')
        if (lsSid && lsSid !== sessionId) {
          setSessionId(lsSid, sessionTitle)
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
        hub = { subs: new Set(), inflight: false, lastSections: null, timer: null }
        _digestHubs.set(eng, hub)
      }
      hub.subs.add(onSections)
      if (hub.lastSections) onSections(hub.lastSections)
      _pollDigestHub(eng)
      if (hub.timer === null && typeof window !== 'undefined' && typeof window.setInterval === 'function') {
        hub.timer = window.setInterval(() => _pollDigestHub(eng), 25000)
      }
      return () => {
        const curHub = _digestHubs.get(eng)
        if (!curHub) return
        curHub.subs.delete(onSections)
        if (curHub.subs.size === 0) {
          if (curHub.timer !== null) {
            try { window.clearInterval(curHub.timer) } catch { /* ignore */ }
          }
          _digestHubs.delete(eng)
        }
      }
    }

    /* ---------------------------------------------------------- 常驻面板主体 */
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
      const propTitle = sessionTitleOf(props)
      React.useEffect(() => {
        if (propSid || propTitle) setSessionId(propSid, propTitle)
      }, [propSid, propTitle])

      const st = useUI()
      const session = useSession()
      const sid = session.id
      const sesTitle = session.title
      const [engagements, setEngagements] = React.useState([])
      const [hostSessions, setHostSessions] = React.useState([])
      const [eng, setEng] = React.useState(null)
      const [boundEng, setBoundEng] = React.useState(null)
      const [following, setFollowing] = React.useState(false)
      const [followSource, setFollowSource] = React.useState(null)
      const [snapshot, setSnapshot] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [newName, setNewName] = React.useState('')
      const manualPickRef = React.useRef(null)
      const resizeCleanupRef = React.useRef(null)
      const manualHere = () => manualPickRef.current !== null && manualPickRef.current === sessionId
      const [width, setWidth] = React.useState(() => {
        try {
          const saved = Number(window.localStorage.getItem('rt-dock-width'))
          if (Number.isFinite(saved) && saved >= 380 && saved <= 900) return saved
        } catch (e) { /* 隐私模式 */ }
        return 540
      })
      const [creating, setCreating] = React.useState(false)
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

      /* 单例共享监听 DSH 宿主当前会话切换 */
      React.useEffect(() => acquireSessionSyncTicker(), [])

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
        api({ op: 'bootstrap', session: sessionId || undefined }).then((b) => {
          setEngagements((b && b.engagements) || [])
          if (b && Array.isArray(b.host_sessions)) setHostSessions(b.host_sessions)
          if (selectId) { setEng(selectId); loadSnapshot(selectId) }
        }, () => {})
      }

      const followTo = (id, list, source) => {
        const known = (list || engagements).some((x) => x.id === id)
        if (!known) return false
        manualPickRef.current = null
        setFollowing(true)
        setFollowSource(source || 'bound')
        setEng(id)
        rememberEngagement(id)
        loadSnapshot(id)
        return true
      }

      const getNamedEngagements = (list) => (list || engagements).filter((x) => !isRawUuidName(x.name || x.id) && !isRawUuidName(x.id))

      const bindSeq = React.useRef(0)
      const applySessionBinding = (id, list, title) => {
        const known = list || engagements
        if (!known.length) return
        const seq = (bindSeq.current += 1)
        const forSession = id
        api({ op: 'sessionBinding', session: id }).then((r) => {
          if (seq !== bindSeq.current) return
          if (sessionId !== forSession) return
          if (r && Array.isArray(r.host_sessions)) setHostSessions(r.host_sessions)
          const namedList = getNamedEngagements(known)
          const rawBound = r && r.ok !== false && typeof r.bound === 'string' && r.bound ? r.bound : null
          const bound = (rawBound && isRawUuidName(rawBound) && namedList.length > 0)
            ? namedList[0].id
            : rawBound
          if (rawBound && isRawUuidName(rawBound) && namedList.length > 0 && id) {
            api({ op: 'bindSessionEngagement', session: id, id: namedList[0].id, engagement: namedList[0].id }).catch(() => {})
          }
          setBoundEng(bound)
          if (bound === null) setFollowing(false)
          if (manualHere() && eng !== null && !isRawUuidName(eng)) return
          if (bound !== null && followTo(bound, known, 'bound')) return
          const byTitle = engagementByTitle(title, known)
          if (byTitle !== null && followTo(byTitle, known, 'title')) return
          if (namedList.length > 0 && followTo(namedList[0].id, known, 'bound')) return
          const last = lastEngagement()
          if (last !== null && followTo(last, known, 'last')) return
        }, () => { if (seq === bindSeq.current) setBoundEng(null) })
      }

      React.useEffect(() => {
        const dom = readHostDomTelemetry()
        const initialSid = sessionId || dom.sessionId || undefined
        api({ op: 'bootstrap', session: initialSid }).then((r) => {
          if (!r || r.ok === false) {
            if (r && r.emptyResponse) return
            setErr((r && r.error) || '无法连接工作区存储')
            return
          }
          setErr(null)
          const list = r.engagements || []
          const hs = Array.isArray(r.host_sessions) ? r.host_sessions : []
          setEngagements(list)
          setHostSessions(hs)
          if (!sessionId && hs.length > 0 && hs[0].id) {
            setSessionId(hs[0].id, hs[0].displayLabel || hs[0].title)
          }
          const namedList = getNamedEngagements(list)
          const rawFallback = r.current || (list[0] && list[0].id) || null
          const fallback = (rawFallback && isRawUuidName(rawFallback) && namedList.length > 0)
            ? namedList[0].id
            : rawFallback
          if (fallback) {
            manualPickRef.current = null
            setFollowing(false)
            setFollowSource('default')
            setEng(fallback)
            loadSnapshot(fallback)
            if (rawFallback && isRawUuidName(rawFallback) && namedList.length > 0 && initialSid) {
              api({ op: 'bindSessionEngagement', session: initialSid, id: fallback, engagement: fallback }).catch(() => {})
            }
          }
          if (sessionId !== null) applySessionBinding(sessionId, list, sessionTitle)
        }, (e) => setErr(String((e && e.message) || e)))
      }, [])

      React.useEffect(() => {
        if (!eng || !isRawUuidName(eng)) return
        const namedList = getNamedEngagements(engagements)
        if (!namedList.length) return
        const preferred = namedList[0].id
        if (preferred && preferred !== eng) {
          manualPickRef.current = null
          setBoundEng(preferred)
          setFollowing(true)
          setFollowSource('bound')
          setEng(preferred)
          rememberEngagement(preferred)
          loadSnapshot(preferred)
          if (sid) {
            api({ op: 'bindSessionEngagement', session: sid, id: preferred, engagement: preferred }).catch(() => {})
          }
        }
      }, [eng, engagements, sid])

      React.useEffect(() => {
        if (sid === null || !engagements.length) return
        applySessionBinding(sid, engagements, sesTitle)
      }, [sid, sesTitle, engagements.length])

      const openEngagement = (nameArg) => {
        const name = String(nameArg || newName).trim()
        if (!name) return
        setCreating(true)
        api({ op: 'openEngagement', name: name }).then((r) => {
          setCreating(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '创建失败'); return }
          setNewName('')
          const createdId = r.engagement && r.engagement.id
          if (createdId && sid) {
            api({ op: 'bindSessionEngagement', session: sid, id: createdId, engagement: createdId }).catch(() => {})
          }
          refreshList(createdId)
        }, (e) => { setCreating(false); setErr(String((e && e.message) || e)) })
      }

      const refreshAll = () => {
        setErr(null)
        setRefreshKey((k) => k + 1)
        api({ op: 'bootstrap', session: sid || undefined }).then((b) => {
          const list = (b && b.engagements) || []
          setEngagements(list)
          if (b && Array.isArray(b.host_sessions)) setHostSessions(b.host_sessions)
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

      useHostEvents(eng, () => {
        if (eng) _pollDigestHub(eng)
      }, 1200)

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

      const selectorOptions = []
      const seenEngIds = new Set()
      const namedEngagements = getNamedEngagements(engagements)
      const visibleEngagements = namedEngagements.length > 0 ? namedEngagements : engagements
      for (const x of visibleEngagements) {
        seenEngIds.add(x.id)
        selectorOptions.push({ value: x.id, label: x.name || x.id })
      }
      if (!boundEng && !eng) {
        for (const hs of hostSessions) {
          if (hs.id === sid) continue
          if (hs.engagementId && seenEngIds.has(hs.engagementId)) continue
          if (isRawUuidName(hs.displayLabel || hs.title || hs.id)) continue
          selectorOptions.push({
            value: 'host:' + hs.id,
            label: '会话 · ' + (hs.displayLabel || hs.title || hs.id),
            hostSession: hs,
          })
        }
      }
      const currentEngObj = engagements.find((x) => x.id === eng) || null
      const currentEngName = (currentEngObj && currentEngObj.name && !isRawUuidName(currentEngObj.name))
        ? currentEngObj.name
        : ((snapshot && snapshot.engagement && snapshot.engagement.name && !isRawUuidName(snapshot.engagement.name))
            ? snapshot.engagement.name
            : ((!isRawUuidName(sesTitle) && sesTitle) || (namedEngagements[0] && namedEngagements[0].name) || eng || 'LMTAgent 默认工作区'))

      const tabs = [
        ['assets', '模块与服务'], ['agents', '智能体与并发'], ['sessions', '运行环境'],
        ['artifacts', '构建产物'],
        ['findings', '代码审查与缺陷'],
        ['scores', '交付里程碑'], ['report', '研发交付报告'],
        ['knowledge', '工程模式库'],
        ['skills', '研发技能库'],
      ]
      const TAB_GROUPS = [
        { key: 'overview', label: '总览', tabs: ['overview'] },
        { key: 'assets', label: '架构', tabs: ['assets'] },
        { key: 'results', label: '质量', tabs: ['findings', 'scores'] },
        { key: 'report', label: '报告', tabs: ['report'] },
        { key: 'resources', label: '集群', tabs: ['agents', 'sessions', 'artifacts', 'knowledge', 'skills'] },
      ]
      const groupOf = (tab) => TAB_GROUPS.find((g) => g.tabs.indexOf(tab) !== -1) || TAB_GROUPS[1]
      const activeGroup = groupOf(st.tab)
      const goTab = (tab) => { markTabSeen(tab); setUI({ tab: tab }) }
      const openFull = () => { openFullView() }

      React.useEffect(() => {
        if (!full) return undefined
        const onKey = (e) => { if (e.key === 'Escape') exitFull() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [full, exitFull])

      const effectiveKbEng = (!isRawUuidName(boundEng) && boundEng) || (!isRawUuidName(eng) && eng) || ''

      let body
      if (err) body = h('div', { className: 'rt-err' }, err)
      else if (st.tab === 'overview') body = h(OverviewTab, {
        engagement: eng, engagementName: currentEngName, snapshot: snapshot, refreshKey: refreshKey,
        onGo: (tab) => goTab(tab),
        onRefresh: refreshAll,
        onWorkspaceSelect: (createdId) => {
          if (!createdId) return
          setEng(createdId)
          rememberEngagement(createdId)
          refreshList(createdId)
        },
      })
      else if (st.tab === 'artifacts') body = h(ArtifactsTab, { engagement: eng, refreshKey: refreshKey })
      else if (st.tab === 'knowledge') body = h(KnowledgeTab, { refreshKey: refreshKey, engagement: effectiveKbEng })
      else if (!eng) {
        body = h('div', { className: 'rt-pane' },
          h('div', { className: 'rt-card' },
            h('h4', null, '初始化研发工作区'),
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 8 } },
              '输入软件工程项目或会话工作区名称，创建工作区并启动 8 角色多智能体协同研发。'),
            h('div', { style: { display: 'flex', gap: 8 } },
              h('input', {
                className: 'rt-input', style: { flex: 1 }, placeholder: '例如：LMTAgent 核心引擎重构',
                value: newName, onChange: (e) => setNewName(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Enter') openEngagement() },
              }),
              h('button', { className: 'rt-btn rt-btn-primary', disabled: creating, onClick: () => openEngagement() },
                creating ? '创建中…' : '创建工作区'))))
      } else if (st.tab === 'assets') body = h(AssetsTab, { engagement: eng, snapshot: snapshot, refreshKey: refreshKey, onRefresh: refreshAll, onData: () => loadSnapshot(eng) })
      else if (st.tab === 'testing') body = h(AssetsTab, { engagement: eng, snapshot: snapshot, refreshKey: refreshKey, onRefresh: refreshAll, onData: () => loadSnapshot(eng) })
      else if (st.tab === 'agents') body = h(AgentsTab, { engagement: eng, refreshKey: refreshKey })
      else if (st.tab === 'sessions') body = h(SessionTab, { engagement: eng, refreshKey: refreshKey })
      else if (st.tab === 'findings') body = h(FindingsTab, { engagement: eng, refreshKey: refreshKey })
      else if (st.tab === 'report') body = h(ReportTab, { engagement: eng, refreshKey: refreshKey })
      else if (st.tab === 'attackfiles') body = h(FindingsTab, { engagement: eng, refreshKey: refreshKey })
      else if (st.tab === 'scores') body = h(ScoreTab, { engagement: eng, refreshKey: refreshKey })
      else if (st.tab === 'prompts') body = h(AgentsTab, { engagement: eng, refreshKey: refreshKey })
      else body = h(SkillsTab, { engagement: eng, refreshKey: refreshKey })

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
            : (hasCleanBoundDiff
                ? h('span', Object.assign({
                    className: 'rt-tag rt-tag-warn',
                    style: { cursor: 'pointer' },
                    title: '当前已切换工作区；点击切回当前会话绑定的「' + boundEng + '」',
                  }, clickable(() => {
                    manualPickRef.current = null
                    setFollowing(true)
                    setFollowSource('bound')
                    setEng(boundEng); rememberEngagement(boundEng); loadSnapshot(boundEng)
                  }, { label: '切回当前会话绑定工作区：' + boundEng })), '手动选择：' + boundEng)
                : (boundEng !== null && !isRawUuidName(boundEng) && boundEng === eng && !manualHere()
                    ? h('span', { className: 'rt-tag rt-tag-live', title: '控制台正跟随当前 DSH 会话绑定的工作区：切换会话会自动同步' }, '跟随会话')
                    : (following && followSource === 'title'
                        ? h('span', {
                            className: 'rt-tag rt-tag-live',
                            title: '按当前会话标题自动关联到工作区「' + eng + '」',
                          }, '跟随会话 · 按标题')
                        : h('span', {
                            className: 'rt-tag rt-tag-live',
                            title: '控制台已与当前 DSH 会话实时同步，可在下拉框自由切换工作区。',
                          }, '已同步当前会话')))),
          h('select', {
            className: 'rt-input',
            style: { maxWidth: '185px' },
            value: eng || (selectorOptions[0] && selectorOptions[0].value) || '',
            'aria-label': '切换研发工作区或会话',
            onChange: (e) => {
              const next = e.target.value
              if (!next) return
              if (next.startsWith('host:')) {
                const rawSid = next.slice(5)
                const hs = hostSessions.find((x) => x.id === rawSid)
                if (hs) {
                  setSessionId(hs.id, hs.displayLabel || hs.title)
                  openEngagement(hs.displayLabel || hs.title || hs.id)
                }
                return
              }
              manualPickRef.current = sid || ''
              setFollowing(false)
              setFollowSource(null)
              setEng(next)
              rememberEngagement(next)
              loadSnapshot(next)
              if (sid !== null) {
                api({ op: 'bindSessionEngagement', session: sid, id: next, engagement: next }).catch(() => {})
              }
              api({ op: 'activateEngagement', id: next, engagement: next, session: sid || undefined }).catch(() => {})
            },
          }, selectorOptions.length > 0
            ? selectorOptions.map((opt) => h('option', { key: opt.value, value: opt.value }, opt.label))
            : h('option', { value: '' }, currentEngName)),
          h('div', { className: 'rt-spacer' }),
          h(VersionBar, null),
          full
            ? h('button', { className: 'rt-btn', title: '回到带侧栏的普通界面（或按 Esc）', onClick: exitFull }, '退出全屏')
            : null,
          h('button', { className: 'rt-btn', title: '刷新工作区、会话遥测与当前页面数据', onClick: refreshAll }, '刷新'),
          full ? null : h('button', {
            className: 'rt-btn',
            title: isDesktopShell() ? '在当前窗口全屏打开完整控制台（Esc 退出）' : '在新浏览器窗口打开完整控制台',
            onClick: openFull,
          }, '全面浏览'),
          (full || embedMode) ? null : h('button', { className: 'rt-btn', title: '收起面板（对话列恢复全宽）', onClick: () => setUI({ open: false }) }, '收起')),
        h('div', { className: 'rt-tabs rt-tabs-groups', role: 'navigation', 'aria-label': '控制台分区' },
          TAB_GROUPS.map((g) => {
            const on = activeGroup.key === g.key
            return h('div', Object.assign({}, clickable(() => goTab(g.tabs[0]), { label: g.label }), {
              key: g.key, className: 'rt-tab rt-tab-group' + (on ? ' on' : ''),
              title: '切换到「' + g.label + '」分区',
            }), g.label)
          })),
        h('div', { className: 'rt-tabs rt-tabs-sub', role: 'tablist' }, tabs.map((t) => {
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
            st.uiMode === 'novice' ? 'LMTAgent · AI 协同工作台' : 'LMTAgent · PGSQL Wire v3 · 4-Wave DAG'),
          h('div', { className: 'rt-spacer' }),
          full ? h('span', null, '按 Esc 或点右上角「退出全屏」回到带侧栏的界面') : null,
          h('span', null, (st.uiMode === 'novice' ? '工作区 · ' : 'PG/WAL · ') + currentEngName),
          sid === null
            ? null
            : h('span', { title: '当前会话 ' + sid + (sessionTitle ? '（' + sessionTitle + '）' : '')
                + '；工作区来源：' + (FOLLOW_SOURCE[followSource] || '实时同步') },
                '会话 ' + sid.slice(0, 8) + (followSource ? ' · ' + (FOLLOW_SOURCE[followSource] || '') : ''))))
    }

    /* ---------------------------------------------------------- 入口按钮与底部工具条 */
    function SidebarButton(props) {
      const st = useUI()
      return h('button', {
        className: 'rt-icon-btn' + (st.open ? ' on' : ''),
        title: 'LMTAgent 研发控制台（常驻右侧栏）',
        onClick: () => setUI({ open: !st.open }),
      }, h('span', { style: { fontSize: 14 } }, '⚡'), props && props.wide ? h('span', null, 'LMTAgent') : null)
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

    function ComposerDockBar(props) {
      const st = useUI()
      const sid = sessionIdOf(props)
      const title = sessionTitleOf(props)
      React.useEffect(() => { if (sid || title) setSessionId(sid, title) }, [sid, title])
      return h('div', { className: 'rt-composer-dock' },
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
          h('span', { className: 'rt-dot' }),
          h('b', { style: { color: 'var(--dsw-alias-label-primary)' } }, 'LMTAgent 研发集群'),
          h('span', { className: 'rt-tag rt-tag-live' }, st.uiMode === 'novice' ? 'AI 自动协同' : '8-Role · 4-Wave DAG')),
        h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
          h('button', {
            className: 'rt-btn' + (st.open ? ' rt-btn-primary' : ''),
            onClick: () => setUI({ open: !st.open }),
          }, st.open ? '收起研发控制台' : '⚡ 唤起 LMTAgent 控制台'),
          h('button', {
            className: 'rt-btn',
            onClick: openFullView,
          }, '全面浏览')))
    }

    function FullButton(props) {
      const desktop = isDesktopShell()
      return h('button', {
        className: 'rt-icon-btn',
        title: desktop
          ? '全面浏览：在当前窗口全屏打开完整 LMTAgent 控制台（Esc 退出）'
          : '全面浏览：在新窗口打开完整 LMTAgent 控制台（当前窗口不受影响；新窗口内按 Esc 退出）',
        onClick: openFullView,
      }, h('span', { style: { fontSize: 14 } }, '⛶'), props && props.wide ? h('span', null, '全面浏览') : null)
    }

    /* ---------------------------------------------------------- 插件入口（全槽位覆盖） */
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

      /* 2. Circle 1：左侧边栏顶部面板列表（sidebar.panellist + main 主视图面板） */
      ctx.slots.inject('main', () => ctx.slots.register(
        { name: 'main', id: 'lmtagent-workbench', key: 'lmtagent-workbench', order: 35 },
        (props) => h(Panel, Object.assign({ embedMode: 'main' }, props)),
      ))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
        { name: 'sidebar.panellist', id: 'lmtagent-panellist', key: 'lmtagent-workbench', label: 'LMTAgent 控制台', order: 35 },
        (props) => h(SidebarButton, Object.assign({ wide: true }, props)),
      ))

      /* 3. Circle 2 Row 2：会话主视图二级页签 */
      ctx.slots.inject('conversation.view', () => ctx.slots.register(
        { name: 'conversation.view', id: 'lmtagent-view', key: 'lmtagent-view', label: '⚡ LMTAgent 研发台', order: 45 },
        (props) => h(Panel, Object.assign({ embedMode: 'session' }, props)),
      ))

      /* 4. Circle 2 Row 1：会话顶部动作胶囊 */
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
        { name: 'conversation.session.header.actions', id: 'lmtagent-session-action', label: 'LMTAgent 控制台', order: 20 },
        (props) => h(HeaderButton, props),
      ))

      /* 5. Circle 3：窗口右上角会话工具栏 */
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'redteam-header-toggle', order: 50, label: 'LMTAgent' },
        (props) => h(HeaderButton, props),
      ))

      /* 6. 左侧边栏底部快捷按钮 */
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'redteam-toggle', order: 50, label: 'LMTAgent' },
        (props) => h(SidebarButton, props),
      ))
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'redteam-full', order: 51, label: '全面浏览' },
        (props) => h(FullButton, props),
      ))

      /* 7. 对话输入框上方快捷唤起条 */
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
        { name: 'conversation.input.dock', id: 'lmtagent-input-dock', order: 50, label: 'LMTAgent' },
        (props) => h(ComposerDockBar, props),
      ))

      /* 8. 设置页专区 */
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'lmtagent-settings', order: 50, label: 'LMTAgent 研发集群' },
        () => h('div', { className: 'rt-card', style: { margin: 12 } },
          h('h4', null, 'LMTAgent · 软件工程多智能体研发控制台 (ECCVIK/LMTAgent)'),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 8 } },
            '8 角色 gstack 协同研发 · 4-Wave Bounded DAG · PostgreSQL Wire v3 事实库'),
          h('button', { className: 'rt-btn rt-btn-primary', onClick: () => setUI({ open: true }) }, '打开 LMTAgent 研发控制台')),
      ))

      /* 9. 若宿主启用了 betterSidebar 服务，同步注册左侧导航项 */
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
