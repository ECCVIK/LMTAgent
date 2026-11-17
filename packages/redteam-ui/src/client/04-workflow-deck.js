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

    const useIsomorphicLayoutEffect = (typeof React !== 'undefined' && React.useLayoutEffect)
      ? React.useLayoutEffect
      : React.useEffect

    const _p4RoleDefaults = {
      defaultTok: '0 tok', defaultTokens: 0, defaultCompressedTokens: 0, defaultCompressionPct: 85,
      defaultDur: '待命', defaultSteps: 0, defaultPct: '0%', approvalState: 'pending_approval',
      filesTouched: [], nextGoal: '继续推进下一波次契约验证与回归闭环',
    }
    const _defP4Role = (spec) => Object.assign({}, _p4RoleDefaults, spec)

    const P4_ROLE_META = {
      designer: _defP4Role({
        wave: 1, role: 'designer', avatar: 'WD', color: '#ef4444',
        defaultTitle: 'Wave1 designer 交互与设计',
        prompt: '基于项目需求梳理模块化 Bento UI 布局、设计令牌与交互视图规范。',
        output: '等待执行交互与视觉设计任务。', whatWasDone: '交互与视觉规范分片已就绪。',
      }),
      recon: _defP4Role({
        wave: 1, role: 'recon', avatar: 'WR', color: '#10b981',
        defaultTitle: 'Wave1 recon 产品与需求',
        prompt: '盘点目标项目全量业务模块、数据接口与核心功能优先级。',
        output: '等待执行需求拆解与数据源测绘。', whatWasDone: '产品与数据源测绘分片已就绪。',
      }),
      assess: _defP4Role({
        wave: 2, role: 'assess', avatar: 'WA', color: '#8b5cf6',
        defaultTitle: 'Wave2 assess 架构与分片',
        prompt: '基于 Wave 1 需求与设计产出，冻结模块接口契约并划分独占文件分片。',
        output: '等待锁定模块接口契约与独占文件分片。', whatWasDone: '系统架构与分片边界待锁定。',
      }),
      exploit: _defP4Role({
        wave: 3, role: 'exploit', avatar: 'WB', color: '#3b82f6',
        defaultTitle: 'Wave3 exploit 分片构建',
        prompt: '在独占文件分片内执行全栈编码实现与单元测试自检。',
        output: '等待执行分片代码构建与自检。', whatWasDone: '分片编码实现与单元验证就绪。',
      }),
      'vuln-scan': _defP4Role({
        wave: 4, role: 'vuln-scan', avatar: 'WC', color: '#f59e0b',
        defaultTitle: 'Wave4 vuln-scan 代码审查',
        prompt: '对各分片代码变更执行静态缺陷审查、架构边界复核与安全门禁审计。',
        output: '等待执行代码审查与安全门禁校验。', whatWasDone: '代码审查与安全门禁就绪。',
      }),
      qa: _defP4Role({
        wave: 4, role: 'qa', avatar: 'WQ', color: '#06b6d4',
        defaultTitle: 'Wave4 qa 自动化回归',
        prompt: '运行全量单元测试、UI 渲染冒烟测试与打包一致性断言。',
        output: '等待运行自动化测试套件与回归校验。', whatWasDone: '自动化回归测试套件就绪。',
      }),
      internal: _defP4Role({
        wave: 4, role: 'internal', avatar: 'WI', color: '#ec4899',
        defaultTitle: 'Wave4 internal 归档发布',
        prompt: '汇总 Wave 1–4 研发产物与交付里程碑，生成结构化交付报告。',
        output: '等待汇总研发交付报告与归档。', whatWasDone: '归档发布与交付报告就绪。',
      }),
    }

    const WAVE_PAGE_SIZE = 24

    /**
     * 缩放无关坐标测量：沿着 offsetParent 链向上累加至 stageEl，
     * 完全免疫祖先层 CSS transform: scale() 导致的 getBoundingClientRect 漂移。
     */
    function measureBoxInStage(nodeEl, stageEl) {
      if (!nodeEl || !stageEl) return null
      if (typeof nodeEl.offsetWidth !== 'number' || typeof nodeEl.offsetHeight !== 'number') return null
      const w = Number(nodeEl.offsetWidth) || 0
      const h = Number(nodeEl.offsetHeight) || 0
      if (!(w > 0) && !(h > 0)) return null
      let x = 0
      let y = 0
      let cur = nodeEl
      let guard = 0
      let reachedStage = false
      while (cur && guard < 32) {
        guard += 1
        if (cur === stageEl) {
          reachedStage = true
          break
        }
        x += Number(cur.offsetLeft) || 0
        y += Number(cur.offsetTop) || 0
        const parent = cur.offsetParent
        if (!parent) break
        if (parent !== stageEl) {
          x += Number(parent.clientLeft) || 0
          y += Number(parent.clientTop) || 0
        }
        cur = parent
      }
      if (!reachedStage) return null
      return {
        left: Math.round(x * 10) / 10,
        top: Math.round(y * 10) / 10,
        right: Math.round((x + w) * 10) / 10,
        bottom: Math.round((y + h) * 10) / 10,
        width: w,
        height: h,
        midX: Math.round((x + w / 2) * 10) / 10,
        midY: Math.round((y + h / 2) * 10) / 10,
      }
    }

    /** 将正交拐点序列转为带平滑圆角 (Q) 的 SVG path 字符串。 */
    function buildRoundedOrthogonalPath(points, radius) {
      if (!Array.isArray(points) || points.length < 2) return ''
      const dedup = []
      for (let i = 0; i < points.length; i += 1) {
        const pt = points[i]
        if (!pt || pt.length < 2) continue
        const rx = Math.round(pt[0] * 10) / 10
        const ry = Math.round(pt[1] * 10) / 10
        if (dedup.length > 0) {
          const prev = dedup[dedup.length - 1]
          if (Math.abs(prev[0] - rx) < 0.5 && Math.abs(prev[1] - ry) < 0.5) continue
        }
        dedup.push([rx, ry])
      }
      const simplified = []
      for (let i = 0; i < dedup.length; i += 1) {
        if (i > 0 && i < dedup.length - 1) {
          const a = simplified[simplified.length - 1]
          const b = dedup[i]
          const c = dedup[i + 1]
          if ((Math.abs(a[0] - b[0]) < 0.5 && Math.abs(b[0] - c[0]) < 0.5)
            || (Math.abs(a[1] - b[1]) < 0.5 && Math.abs(b[1] - c[1]) < 0.5)) {
            continue
          }
        }
        simplified.push(dedup[i])
      }
      if (simplified.length < 2) return ''
      if (simplified.length === 2) {
        return 'M ' + simplified[0][0] + ',' + simplified[0][1] + ' L ' + simplified[1][0] + ',' + simplified[1][1]
      }
      const rMax = Number(radius) > 0 ? Number(radius) : 6
      const cmds = ['M ' + simplified[0][0] + ',' + simplified[0][1]]
      for (let i = 1; i < simplified.length - 1; i += 1) {
        const prev = simplified[i - 1]
        const cur = simplified[i]
        const next = simplified[i + 1]
        const dx1 = cur[0] - prev[0]
        const dy1 = cur[1] - prev[1]
        const dx2 = next[0] - cur[0]
        const dy2 = next[1] - cur[1]
        const len1 = Math.hypot(dx1, dy1)
        const len2 = Math.hypot(dx2, dy2)
        if (len1 < 1 || len2 < 1) {
          cmds.push('L ' + cur[0] + ',' + cur[1])
          continue
        }
        const r = Math.min(rMax, len1 / 2, len2 / 2)
        const inX = Math.round((cur[0] - (dx1 / len1) * r) * 10) / 10
        const inY = Math.round((cur[1] - (dy1 / len1) * r) * 10) / 10
        const outX = Math.round((cur[0] + (dx2 / len2) * r) * 10) / 10
        const outY = Math.round((cur[1] + (dy2 / len2) * r) * 10) / 10
        cmds.push('L ' + inX + ',' + inY)
        cmds.push('Q ' + cur[0] + ',' + cur[1] + ' ' + outX + ',' + outY)
      }
      const last = simplified[simplified.length - 1]
      cmds.push('L ' + last[0] + ',' + last[1])
      return cmds.join(' ')
    }

    /**
     * 基于 Stage 坐标系精确计算 Root → Wave 与 Wave → 每个展开子卡片 的无遮挡连线。
     */
    function computeStageTreeEdges(opts) {
      const stageEl = opts.stageRef ? opts.stageRef.current : opts.stageEl
      if (!stageEl) return null
      const stageW = Math.max(0, Math.ceil(Number(stageEl.clientWidth) || Number(stageEl.scrollWidth) || Number(stageEl.offsetWidth) || 0))
      const stageH = Math.max(0, Math.ceil(Number(stageEl.clientHeight) || Number(stageEl.scrollHeight) || Number(stageEl.offsetHeight) || 0))
      if (!(stageW > 0) || !(stageH > 0)) return null

      const rootEl = opts.rootRef ? opts.rootRef.current : opts.rootEl
      const rootBox = measureBoxInStage(rootEl, stageEl)
      if (!rootBox) return null

      const treeDirection = opts.treeDirection === 'vertical' ? 'vertical' : 'horizontal'
      const waveGroups = Array.isArray(opts.waveGroups) ? opts.waveGroups : []
      const waveCardRefs = (opts.waveCardRefsObj && opts.waveCardRefsObj.current) || opts.waveCardRefs || {}
      const childCardRefs = (opts.childCardRefsObj && opts.childCardRefsObj.current) || opts.childCardRefs || {}
      const expandedMap = opts.expandedMap || {}
      const visibleChildrenByWave = opts.visibleChildrenByWave || {}
      const selAgentId = opts.selAgentId || null
      const animatingSpawnIds = opts.animatingSpawnIds || {}

      const edges = []
      const rootPort = treeDirection === 'horizontal'
        ? { x: rootBox.right, y: rootBox.midY }
        : { x: rootBox.midX, y: rootBox.bottom }

      for (let wIdx = 0; wIdx < waveGroups.length; wIdx += 1) {
        const wg = waveGroups[wIdx]
        const waveBox = measureBoxInStage(waveCardRefs[String(wg.wave)], stageEl)
        if (!waveBox) continue

        const isWaveSelected = wg.children.some((c) => c.id === selAgentId)
        const isWaveFocused = !selAgentId || selAgentId === 'root' || isWaveSelected
        const isSpawningWave = wg.children.some((c) => Boolean(animatingSpawnIds[c.id]))
        const waveWireClass = (isSpawningWave ? 'rt-wire-growing ' : '')
          + ((wg.runningInWave > 0 || isSpawningWave) ? 'rt-wire-flowing' : '')

        if (treeDirection === 'horizontal') {
          const x1 = rootBox.right
          const y1 = rootBox.midY
          const x2 = waveBox.left
          const y2 = waveBox.midY
          const dx = Math.max(20, Math.round((x2 - x1) * 0.52 * 10) / 10)
          edges.push({
            key: 'edge-root-w' + wg.wave,
            d: 'M ' + x1 + ',' + y1 + ' C ' + (x1 + dx) + ',' + y1 + ' ' + (x2 - dx) + ',' + y2 + ' ' + x2 + ',' + y2,
            startX: x1,
            startY: y1,
            endX: x2,
            endY: y2,
            color: wg.color,
            selected: isWaveSelected,
            focused: isWaveFocused,
            active: wg.runningInWave > 0,
            wireClass: waveWireClass,
          })
        } else {
          const x1 = rootBox.midX
          const y1 = rootBox.bottom
          const x2 = waveBox.midX
          const y2 = waveBox.top
          const dy = Math.max(18, Math.round((y2 - y1) * 0.52 * 10) / 10)
          edges.push({
            key: 'edge-root-w' + wg.wave,
            d: 'M ' + x1 + ',' + y1 + ' C ' + x1 + ',' + (y1 + dy) + ' ' + x2 + ',' + (y2 - dy) + ' ' + x2 + ',' + y2,
            startX: x1,
            startY: y1,
            endX: x2,
            endY: y2,
            color: wg.color,
            selected: isWaveSelected,
            focused: isWaveFocused,
            active: wg.runningInWave > 0,
            wireClass: waveWireClass,
          })
        }

        if (!expandedMap[wg.wave]) continue
        const visibleChildren = visibleChildrenByWave[wg.wave] || []
        const childItems = []
        for (let ci = 0; ci < visibleChildren.length; ci += 1) {
          const child = visibleChildren[ci]
          const cBox = measureBoxInStage(childCardRefs[child.id], stageEl)
          if (cBox) childItems.push({ child, box: cBox })
        }
        if (childItems.length === 0) continue

        if (treeDirection === 'horizontal') {
          const sortedByLeft = childItems.slice().sort((a, b) => a.box.left - b.box.left)
          const colAnchors = []
          const colRights = []
          sortedByLeft.forEach((it) => {
            let foundIdx = -1
            for (let k = 0; k < colAnchors.length; k += 1) {
              if (Math.abs(colAnchors[k] - it.box.left) <= 24) {
                foundIdx = k
                break
              }
            }
            if (foundIdx === -1) {
              foundIdx = colAnchors.length
              colAnchors.push(it.box.left)
              colRights.push(it.box.right)
            } else if (it.box.right > colRights[foundIdx]) {
              colRights[foundIdx] = it.box.right
            }
            it.colIdx = foundIdx
          })

          const sortedByTop = childItems.slice().sort((a, b) => a.box.top - b.box.top)
          const rowBands = []
          sortedByTop.forEach((it) => {
            let foundRow = -1
            for (let r = 0; r < rowBands.length; r += 1) {
              if (Math.abs(rowBands[r].anchorTop - it.box.top) <= 24) {
                foundRow = r
                break
              }
            }
            if (foundRow === -1) {
              foundRow = rowBands.length
              rowBands.push({ anchorTop: it.box.top, rowTop: it.box.top, rowBottom: it.box.bottom })
            } else {
              rowBands[foundRow].rowTop = Math.min(rowBands[foundRow].rowTop, it.box.top)
              rowBands[foundRow].rowBottom = Math.max(rowBands[foundRow].rowBottom, it.box.bottom)
            }
            it.rowIdx = foundRow
          })

          const col0Left = colAnchors[0]
          const gapToCol0 = Math.max(12, col0Left - waveBox.right)
          const busX = Math.round((waveBox.right + Math.min(24, gapToCol0 * 0.45)) * 10) / 10

          for (let ci = 0; ci < childItems.length; ci += 1) {
            const it = childItems[ci]
            const c = it.child
            const b = it.box
            const x1 = waveBox.right
            const y1 = waveBox.midY
            const x2 = b.left
            const y2 = b.midY
            let pts
            if (it.colIdx === 0) {
              pts = [[x1, y1], [busX, y1], [busX, y2], [x2, y2]]
            } else {
              const prevColRight = colRights[it.colIdx - 1]
              const colBusX = Math.round(((prevColRight + x2) / 2) * 10) / 10
              const gapY = it.rowIdx === 0
                ? Math.round((rowBands[0].rowTop - 10) * 10) / 10
                : Math.round(((rowBands[it.rowIdx - 1].rowBottom + rowBands[it.rowIdx].rowTop) / 2) * 10) / 10
              pts = [[x1, y1], [busX, y1], [busX, gapY], [colBusX, gapY], [colBusX, y2], [x2, y2]]
            }
            const d = buildRoundedOrthogonalPath(pts, 6)
            if (!d) continue
            const cSel = selAgentId === c.id
            const cFocused = !selAgentId || selAgentId === 'root' || cSel
            const cSpawn = Boolean(animatingSpawnIds[c.id])
            const cWire = (cSpawn ? 'rt-wire-growing ' : '') + ((c.status === 'running' || cSpawn) ? 'rt-wire-flowing' : '')
            edges.push({
              key: 'edge-w' + wg.wave + '-c-' + c.id,
              d,
              startX: x1,
              startY: y1,
              endX: x2,
              endY: y2,
              color: c.status === 'error' ? '#ef4444' : (c.color || wg.color),
              selected: cSel,
              focused: cFocused,
              active: c.status === 'running',
              wireClass: cWire,
            })
          }
        } else {
          const sortedKids = childItems.slice().sort((a, b) => a.box.top - b.box.top)
          const minLeft = sortedKids.reduce((m, it) => Math.min(m, it.box.left), sortedKids[0].box.left)
          const spineX = Math.round((minLeft - 12) * 10) / 10
          const trunkY = Math.round((waveBox.bottom + 14) * 10) / 10
          for (let ci = 0; ci < sortedKids.length; ci += 1) {
            const it = sortedKids[ci]
            const c = it.child
            const b = it.box
            const x1 = waveBox.midX
            const y1 = waveBox.bottom
            const x2 = b.midX
            const y2 = b.top
            let d
            if (ci === 0 && y2 > y1 + 14) {
              const dy = Math.max(12, Math.round((y2 - y1) * 0.5 * 10) / 10)
              d = 'M ' + x1 + ',' + y1 + ' C ' + x1 + ',' + (y1 + dy) + ' ' + x2 + ',' + (y2 - dy) + ' ' + x2 + ',' + y2
            } else {
              const prevBot = ci > 0 ? sortedKids[ci - 1].box.bottom : y1
              const gapY = Math.round(((prevBot + y2) / 2) * 10) / 10
              d = buildRoundedOrthogonalPath([[x1, y1], [x1, trunkY], [spineX, trunkY], [spineX, gapY], [x2, gapY], [x2, y2]], 6)
            }
            if (!d) continue
            const cSel = selAgentId === c.id
            const cFocused = !selAgentId || selAgentId === 'root' || cSel
            const cSpawn = Boolean(animatingSpawnIds[c.id])
            const cWire = (cSpawn ? 'rt-wire-growing ' : '') + ((c.status === 'running' || cSpawn) ? 'rt-wire-flowing' : '')
            edges.push({
              key: 'edge-vw' + wg.wave + '-c-' + c.id,
              d,
              startX: x1,
              startY: y1,
              endX: x2,
              endY: y2,
              color: c.status === 'error' ? '#ef4444' : (c.color || wg.color),
              selected: cSel,
              focused: cFocused,
              active: c.status === 'running',
              wireClass: cWire,
            })
          }
        }
      }

      return {
        direction: treeDirection,
        width: stageW,
        height: stageH,
        rootPort,
        edges,
      }
    }

    function useStageEdgePaths(opts) {
      const [edgeGeom, setEdgeGeom] = React.useState(null)
      const edgeGeomRef = React.useRef(null)
      const optsRef = React.useRef(opts)
      optsRef.current = opts

      const measureNow = React.useCallback(() => {
        try {
          const cur = optsRef.current
          if (!cur || !cur.enabled) return
          const next = computeStageTreeEdges(cur)
          if (!next) return
          const prev = edgeGeomRef.current
          if (
            prev
            && prev.direction === next.direction
            && Math.abs(prev.width - next.width) <= 1
            && Math.abs(prev.height - next.height) <= 1
            && prev.edges.length === next.edges.length
            && prev.edges.every((pe, idx) => {
              const ne = next.edges[idx]
              return pe.key === ne.key && pe.d === ne.d && pe.color === ne.color
                && pe.selected === ne.selected && pe.focused === ne.focused && pe.wireClass === ne.wireClass
            })
          ) {
            return
          }
          edgeGeomRef.current = next
          setEdgeGeom(next)
        } catch { /* SSR / stub safe no-op */ }
      }, [])

      useIsomorphicLayoutEffect(() => {
        if (!opts.enabled) return undefined
        measureNow()
        const rafFn = typeof requestAnimationFrame === 'function'
          ? requestAnimationFrame
          : (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame.bind(window) : null)
        const cafFn = typeof cancelAnimationFrame === 'function'
          ? cancelAnimationFrame
          : (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function' ? window.cancelAnimationFrame.bind(window) : null)

        let rafId = 0
        const scheduleMeasure = () => {
          if (!rafFn) { measureNow(); return }
          if (rafId && cafFn) cafFn(rafId)
          rafId = rafFn(() => {
            rafId = 0
            measureNow()
          })
        }

        if (rafFn) {
          rafId = rafFn(() => {
            rafId = 0
            measureNow()
          })
        }

        let ro = null
        if (typeof ResizeObserver === 'function') {
          try {
            ro = new ResizeObserver(scheduleMeasure)
            const stEl = opts.stageRef ? opts.stageRef.current : opts.stageEl
            const nlEl = opts.nodeLayerRef ? opts.nodeLayerRef.current : opts.nodeLayerEl
            const rtEl = opts.rootRef ? opts.rootRef.current : opts.rootEl
            if (stEl) ro.observe(stEl)
            if (nlEl) ro.observe(nlEl)
            if (rtEl) ro.observe(rtEl)
            const wMap = (opts.waveCardRefsObj && opts.waveCardRefsObj.current) || opts.waveCardRefs || {}
            Object.keys(wMap).forEach((k) => { if (wMap[k]) ro.observe(wMap[k]) })
            const cMap = (opts.childCardRefsObj && opts.childCardRefsObj.current) || opts.childCardRefs || {}
            Object.keys(cMap).forEach((k) => { if (cMap[k]) ro.observe(cMap[k]) })
          } catch { ro = null }
        }

        const hasWin = typeof window !== 'undefined' && typeof window.addEventListener === 'function'
        if (hasWin) {
          try { window.addEventListener('resize', scheduleMeasure) } catch { /* ignore */ }
        }

        return () => {
          if (rafId && cafFn) {
            try { cafFn(rafId) } catch { /* ignore */ }
          }
          if (ro && typeof ro.disconnect === 'function') {
            try { ro.disconnect() } catch { /* ignore */ }
          }
          if (hasWin && typeof window.removeEventListener === 'function') {
            try { window.removeEventListener('resize', scheduleMeasure) } catch { /* ignore */ }
          }
        }
      }, [opts.enabled, opts.layoutSignature, measureNow])

      return edgeGeom
    }

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

    function HarnessWorkflowDeck(props) {
      const eng = props.engagement || null
      const variant = props.variant === 'cluster' ? 'cluster' : (props.variant || 'overview')
      const isClusterVariant = variant === 'cluster'
      const activeEngagementId = eng || 'default'
      const snapshot = eng ? props.snapshot : null
      const agentsProp = eng ? props.agents : null
      const refreshKey = props.refreshKey || 0
      const hasParentDag = props.dagData !== undefined
      const hasParentDomTel = props.domTel !== undefined
      const { uiMode } = useUI()
      const isNovice = uiMode === 'novice'
      const currentSess = useSession()
      const activeSid = props.sessionId || currentSess.id || null

      const [mode, setMode] = React.useState('p4')
      const [selId, setSelId] = React.useState('plan')
      const [selAgentId, setSelAgentId] = React.useState(null)
      const [collabSearch, setCollabSearch] = React.useState('')
      const [collabSort, setCollabSort] = React.useState('asc')
      const [taskSearch, setTaskSearch] = React.useState('')
      const [taskFilter, setTaskFilter] = React.useState('all')
      const [expandedTaskId, setExpandedTaskId] = React.useState(null)
      const [customWorkerNodes, setCustomWorkerNodes] = React.useState([])
      const [workerGoalOverrides, setWorkerGoalOverrides] = React.useState({})
      const [localDagState, setLocalDagState] = React.useState(null)
      const [localAgents, setLocalAgents] = React.useState(null)
      const [localDomTel, setLocalDomTel] = React.useState(() => (hasParentDomTel ? (props.domTel || {}) : readHostDomTelemetry()))
      const dagState = hasParentDag ? (localDagState || props.dagData) : localDagState
      const domTel = hasParentDomTel ? (props.domTel || {}) : localDomTel
      const [toast, setToast] = React.useState(null)
      const [approvedWorkerMap, setApprovedWorkerMap] = React.useState({})
      const [dispatchingId, setDispatchingId] = React.useState(null)

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

      React.useEffect(() => {
        setLocalDagState(null)
        setLocalAgents(null)
        setCustomWorkerNodes([])
        setWorkerGoalOverrides({})
        setApprovedWorkerMap({})
        setDispatchingId(null)
        setSelAgentId(null)
      }, [eng])

      const onParentReload = props.onReload
      const reloadDag = React.useCallback(() => {
        if (!eng) {
          setLocalDagState(null)
          setLocalAgents(null)
          return
        }
        if (hasParentDag && typeof onParentReload === 'function') {
          onParentReload()
          return
        }
        if (!hasParentDomTel && !_isCanvasDragging) {
          setLocalDomTel(readHostDomTelemetry())
        }
        if (!agentsProp) {
          api({ op: 'agentsStatus', engagement: eng }).then((r) => {
            if (r && r.ok !== false) setLocalAgents(r)
          }, () => {})
        }
        api({ op: 'workflowDag', engagement: eng }).then((r) => {
          if (r && r.ok !== false) {
            setLocalDagState(r)
          }
        }, () => {})
      }, [eng, agentsProp, hasParentDag, hasParentDomTel, onParentReload])

      React.useEffect(() => {
        if (!hasParentDag) reloadDag()
      }, [reloadDag, refreshKey, hasParentDag])

      useHostEvents(hasParentDag ? false : eng, reloadDag, 700)

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
          roleLabel: ROLE_LABEL[roleKey] || roleKey,
          avatar: avatar,
          color: color,
          title: title,
          status: resolvedStatus,
          statusLabel: resolvedStatusLabel,
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

      if (eng) {
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
      }

      const pendingApprovalCount = fusedChildren.filter((c) => (
        c.approvalState === 'pending_approval'
        || c.approvalState === 'waiting_approval'
        || c.approvalState === 'revision_required'
      )).length

      const canvasFilteredChildren = fusedChildren.filter((c) => {
        if (canvasFilter === 'running' && c.status !== 'running') return false
        if (canvasFilter === 'pending' && c.approvalState !== 'pending_approval' && c.approvalState !== 'waiting_approval' && c.approvalState !== 'revision_required') return false
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
        || (eng ? ((activeHostSess && (activeHostSess.displayLabel || activeHostSess.title)) || sessionTitle || eng) : (sessionTitle || '待初始化会话'))
        || 'LMTAgent 主控工作台'
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
      const totalAgents = eng ? (1 + fusedChildren.length) : 0
      const runningCount = eng ? (fusedChildren.filter((c) => c.status === 'running').length + (runningAgents.length > 0 ? 1 : 0)) : 0
      const errorCount = fusedChildren.filter((c) => c.status === 'error').length

      const totalCollabEvents = fusedChildren.length * 3
      const qCollab = collabSearch.trim().toLowerCase()
      let filteredCollabCount = totalCollabEvents
      if ((selAgentId && selAgentId !== 'root') || qCollab) {
        filteredCollabCount = 0
        for (let i = 0; i < fusedChildren.length; i += 1) {
          const c = fusedChildren[i]
          if (selAgentId && selAgentId !== 'root' && c.id !== selAgentId) continue
          const titleLc = String(c.title || '').toLowerCase()
          const avatarLc = String(c.avatar || '').toLowerCase()
          if (!qCollab || titleLc.includes(qCollab) || avatarLc.includes(qCollab)) {
            filteredCollabCount += 3
          } else {
            if (('主控委派 ' + avatarLc).includes(qCollab)) filteredCollabCount += 1
            if ((avatarLc + ' 写入契约/产物').includes(qCollab)) filteredCollabCount += 1
            const doneText = c.status === 'error'
              ? (avatarLc + ' 异常待修复')
              : (c.status === 'running' ? (avatarLc + ' 正在执行分片') : (avatarLc + ' 摘要压缩写回主控'))
            if (doneText.includes(qCollab)) filteredCollabCount += 1
          }
        }
      }

      const visibleLanes = [
        {
          id: 'root', avatar: '主控', title: workspaceDisplayTitle, color: '#3b82f6', isRoot: true,
          wave: 0, role: 'plan',
          compressionPct: fusedChildren.length > 0 ? 85 : 0, approvalState: 'approved', tokenLabel: rootTokensLabel,
        },
      ].concat(fusedChildren.filter((c) => {
        if (!collabSearch.trim()) return true
        const q = collabSearch.trim().toLowerCase()
        return c.title.toLowerCase().includes(q) || c.avatar.toLowerCase().includes(q) || c.role.toLowerCase().includes(q)
      }))

      const allTasks = fusedChildren.map((c) => ({
        id: 'task-' + c.id, agentId: c.id, sessionId: c.sessionId, avatar: c.avatar, color: c.color,
        title: c.title, role: c.role, wave: c.wave,
        compressionPct: c.compressionPct, approvalState: c.approvalState,
        status: c.status === 'running' ? 'run' : (c.status === 'pending' || c.status === 'error' ? 'wait' : 'done'),
        rawStatus: c.status,
        statusBadge: c.status === 'error'
          ? '异常待修复'
          : (c.status === 'running' ? '● 进行中' : (c.status === 'pending' ? '○ 待执行' : '● 已完成')),
        prompt: c.prompt, output: c.output, tokenLabel: c.tokenLabel, durationLabel: c.durationLabel, steps: c.steps,
        assignedGoal: c.assignedGoal, filesOwned: c.filesOwned,
      }))

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

      const [panZoom, setPanZoom] = React.useState({ x: 0, y: 0, scale: 1 })
      const panRef = React.useRef({ x: 0, y: 0, scale: 1, dragging: false, startX: 0, startY: 0, rafId: 0 })
      const stageDomRef = React.useRef(null)
      const viewportDomRef = React.useRef(null)
      const treeStageDomRef = React.useRef(null)
      const treeNodeLayerDomRef = React.useRef(null)
      const rootCardDomRef = React.useRef(null)
      const waveCardDomRefs = React.useRef({})
      const childCardDomRefs = React.useRef({})

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
        const pendingInWave = children.filter((c) => c.status === 'pending').length
        const tokensInWave = children.reduce((acc, c) => acc + (Number(c.tokens) || 0), 0)
        const progressPct = children.length > 0 && (doneInWave > 0 || runningInWave > 0)
          ? Math.max(8, Math.min(100, Math.round(((doneInWave + runningInWave * 0.5) / children.length) * 100)))
          : 0
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
          pendingInWave: pendingInWave,
          tokensInWave: tokensInWave,
          tokenLabel: fmtTokNum(tokensInWave) + ' tok',
          progressPct: progressPct,
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
        if (canvasFilteredChildren.length <= 6 && wg.children.length > 0) return true
        if (wg.children.length > 4) return false
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

      const expandedMap = {}
      const visibleChildrenByWave = {}
      activeWaveGroups.forEach((wg) => {
        const exp = isWaveExpanded(wg)
        expandedMap[wg.wave] = exp
        const pageLimit = Math.max(WAVE_PAGE_SIZE, Number(wavePageLimits[wg.wave]) || WAVE_PAGE_SIZE)
        visibleChildrenByWave[wg.wave] = exp ? wg.children.slice(0, pageLimit) : []
      })

      const treeLayoutSig = [
        treeDirection,
        canvasFilter,
        canvasSearch.trim(),
        selAgentId || '',
        activeWaveGroups.map((g) => g.wave + ':' + g.children.length + ':' + (expandedMap[g.wave] ? 1 : 0) + ':' + (visibleChildrenByWave[g.wave] ? visibleChildrenByWave[g.wave].length : 0)).join('|'),
      ].join('::')

      const p4TreeVisible = Boolean(eng && (isClusterVariant ? mode === 'p4' : true) && activeWaveGroups.length > 0)
      const edgeGeom = useStageEdgePaths({
        enabled: p4TreeVisible,
        treeDirection: treeDirection,
        stageRef: treeStageDomRef,
        nodeLayerRef: treeNodeLayerDomRef,
        rootRef: rootCardDomRef,
        waveCardRefsObj: waveCardDomRefs,
        childCardRefsObj: childCardDomRefs,
        waveGroups: activeWaveGroups,
        expandedMap: expandedMap,
        visibleChildrenByWave: visibleChildrenByWave,
        selAgentId: selAgentId,
        animatingSpawnIds: animatingSpawnIds,
        layoutSignature: treeLayoutSig,
      })

      const activeEdgeGeom = (edgeGeom && edgeGeom.direction === treeDirection) ? edgeGeom : null
      const treeEdgesSvg = activeEdgeGeom && activeEdgeGeom.width > 0 && activeEdgeGeom.height > 0
        ? h('svg', {
            className: 'rt-tree-edges-svg',
            viewBox: '0 0 ' + activeEdgeGeom.width + ' ' + activeEdgeGeom.height,
            preserveAspectRatio: 'xMinYMin meet',
            'aria-hidden': 'true',
            style: {
              position: 'absolute',
              left: 0,
              top: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              zIndex: 1,
              overflow: 'visible',
              display: 'block',
            },
          },
            activeEdgeGeom.edges.map((ed) => {
              const strokeW = ed.selected ? 2.4 : (ed.active ? 2 : 1.55)
              const strokeOp = !ed.focused ? 0.28 : (ed.selected ? 0.96 : (ed.active ? 0.9 : 0.68))
              return h('g', { key: ed.key },
                h('path', {
                  d: ed.d,
                  fill: 'none',
                  stroke: ed.color,
                  strokeWidth: strokeW,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  strokeOpacity: strokeOp,
                  className: ed.wireClass || undefined,
                }),
                h('circle', {
                  cx: ed.endX,
                  cy: ed.endY,
                  r: ed.selected ? 3.5 : 2.6,
                  fill: ed.color,
                  fillOpacity: Math.min(1, strokeOp + 0.15),
                })
              )
            })
          )
        : null

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

      const handleDispatchWorkerTask = (targetAgent) => {
        if (!targetAgent || targetAgent.isRoot || dispatchingId) return
        const targetId = targetAgent.id
        setDispatchingId(targetId)
        setToast('正在拉起子代理分片：' + (targetAgent.title || targetId) + '…')
        api({
          op: 'dispatchWorkerTask',
          engagement_id: activeEngagementId,
          engagement: eng || undefined,
          session: activeSid || undefined,
          worker_id: targetId,
          session_id: targetAgent.sessionId || undefined,
          role: targetAgent.role,
          wave: targetAgent.wave,
          assigned_goal: targetAgent.assignedGoal || targetAgent.prompt,
          files_owned: Array.isArray(targetAgent.filesOwned) ? targetAgent.filesOwned : [],
        }).then((res) => {
          setDispatchingId(null)
          if (!res || res.ok === false) {
            setToast('拉起子代理失败：' + ((res && (res.message || res.error)) || '后端返回异常'))
            return
          }
          const sid = res.session_id || res.sessionId || (res.child && (res.child.session_id || res.child.id)) || (res.worker && res.worker.session_id) || ''
          setToast(res.note || ('已拉起执行：' + (targetAgent.title || targetId) + (sid ? ('（子会话 ' + sid + '）') : '')))
          reloadDag()
        }, () => {
          setDispatchingId(null)
          setToast('拉起子代理失败：请求异常')
        })
      }

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
          session: activeSid || undefined,
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
          const createdSid = (res && (res.session_id || res.sessionId)) || ''
          setCustomWorkerNodes((prev) => prev.concat([{
            id: createdId, session_id: createdSid || undefined, wave: Number(newShardWave) || 3, role: newShardRole,
            title: titleStr, assigned_goal: goalStr, files_owned: filesArr, status: (res && res.status) || 'pending',
          }]))
          setNewShardTitle(''); setNewShardGoal(''); setNewShardFiles('')
          setShowAddShardForm(false)
          setToast('已新增分片节点：' + titleStr + (createdSid ? ('（子会话 ' + createdSid + '）') : ''))
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
          session: activeSid || undefined,
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
          setToast((res && res.note) || ('已更新分片目标与独占文件：' + (targetAgent.title || targetAgent.id)))
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
          session: activeSid || undefined,
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
          const dispatchedList = Array.isArray(res && res.dispatched_sessions)
            ? res.dispatched_sessions.map((s) => (typeof s === 'string' ? s : (s && (s.session_id || s.id)))).filter(Boolean)
            : []
          const sidSuffix = dispatchedList.length > 0
            ? ('，已联动派发：' + dispatchedList.join(', '))
            : ((res && (res.session_id || res.sessionId)) ? ('（子会话 ' + (res.session_id || res.sessionId) + '）') : '')
          setToast(decision === 'revision_requested'
            ? ('已驳回重做 ' + (detailTarget.name || detailTarget.title) + '：' + nextGoalStr)
            : ('已审批通过 ' + (detailTarget.name || detailTarget.title) + '，下达目标：' + ((res && res.next_goal) || nextGoalStr) + sidSuffix))
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
          session: activeSid || undefined,
          worker_id: detailTarget.id,
        }).then((res) => {
          setRetryingBusy(false)
          if (res && res.ok === false && !/unknown op/i.test(String(res.error || ''))) {
            setToast('重跑分片失败：' + (res.error || '请稍后重试'))
            return
          }
          const sid = res && (res.session_id || res.sessionId || (res.worker && res.worker.session_id))
          setToast((res && res.note) || ('已触发单分片重跑：' + (detailTarget.title || detailTarget.id) + (sid ? ('（子会话 ' + sid + '）') : '')))
          reloadDag()
        })
      }

      const handleOpenAgentChat = (agent) => {
        const res = openAgentSessionInHostChat(agent, {
          engagement: eng,
          hostSessions: hostSessions,
          fallbackSessionId: domTel.sessionId,
        })
        setToast(res.targetSid
          ? ('已切换侧边聊天框至 Agent 会话：' + res.targetTitle)
          : ('已返回宿主聊天窗口（当前节点尚未绑定独立子会话）：' + res.targetTitle))
      }

      const resolveInspectorAgent = () => {
        if (inspectorAgentId === '__closed__') return null
        const targetId = inspectorAgentId || selAgentId || (primaryTreeChild && primaryTreeChild.id) || 'root'
        const rootObj = {
          id: 'root',
          sessionId: activeSid || sessionId || domTel.sessionId || 'root',
          name: workspaceDisplayTitle,
          wave: 0,
          role: 'plan',
          avatar: '主控',
          color: '#3b82f6',
          title: workspaceDisplayTitle,
          rawTokens: rootTokens,
          compressedTokens: rootTokens > 0 ? Math.round(rootTokens * 0.14) : 0,
          compressionPct: fusedChildren.length > 0 ? 85 : 0,
          approvalState: 'approved',
          assignedGoal: '全局需求拆解与 4-Wave 并发调度：统筹需求探索、契约锁定、分片并发构建与质量安全门禁。',
          filesOwned: [],
          compressedDigest: {
            whatWasDone: fusedChildren.length > 0
              ? ('已统筹 ' + fusedChildren.length + ' 个子智能体分片目标、摘要压缩与阶段审批派发。')
              : '主控编排器就绪 —— 可在协同与审批页输入需求一键立项并生成并行分片。',
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
        const statusOrder = { error: 0, running: 1, pending: 2, done: 3 }
        const sortByWave = (list) => list.slice().sort((a, b) => {
          if (a.isRoot && !b.isRoot) return -1
          if (!a.isRoot && b.isRoot) return 1
          const wDiff = (Number(a.wave) || 0) - (Number(b.wave) || 0)
          if (wDiff !== 0) return wDiff
          const sA = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 9
          const sB = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 9
          if (sA !== sB) return sA - sB
          return String(a.title || a.id || '').localeCompare(String(b.title || b.id || ''))
        })
        if (swimWaveFilter === 'all') return sortByWave(visibleLanes)
        if (swimWaveFilter === 'running') {
          return sortByWave(visibleLanes.filter((ln) => ln.status === 'running' || (ln.isRoot && runningCount > 0)))
        }
        const waveNum = Number(swimWaveFilter)
        return sortByWave(visibleLanes.filter((ln) => !ln.isRoot && Number(ln.wave || 1) === waveNum))
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

      const effectiveMode = isClusterVariant ? mode : 'p4'

      if (!eng) {
        return h('div', { className: 'rt-bento-card rt-p4-workbench' },
          h('div', { className: 'rt-bento-head' },
            h('span', { className: 'rt-bento-title' }, '派生树状图 & 多维协同工作台'),
            h('span', { className: 'rt-tag' }, '待初始化'),
            h('div', { className: 'rt-spacer' }),
            h('button', {
              type: 'button',
              className: 'rt-btn',
              onClick: () => setUI({ tab: 'settings' }),
            }, '设置'),
            (props.onOpenCollab || props.onOpenWishWizard)
              ? h('button', {
                  type: 'button',
                  className: 'rt-btn rt-btn-primary',
                  onClick: props.onOpenCollab || props.onOpenWishWizard,
                }, '前往协同与审批立项 →')
              : null),
          h('div', {
            className: 'rt-empty',
            style: {
              border: '1.5px dashed rgba(77,107,254,0.32)',
              borderRadius: 12,
              padding: '26px 20px',
              background: 'rgba(77,107,254,0.03)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              textAlign: 'center',
            },
          },
            h('div', { style: { fontWeight: 700, fontSize: 13.5, color: 'var(--dsw-alias-label-primary)' } },
              '当前会话尚未初始化研发任务'),
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', maxWidth: 520, lineHeight: 1.55 } },
              '请前往「协同与审批」通过 AI 澄清与拆解立项，确认后此处将实时呈现派生树与子代理协同状态。'),
            (props.onOpenCollab || props.onOpenWishWizard)
              ? h('button', {
                  type: 'button',
                  className: 'rt-btn rt-btn-primary',
                  onClick: props.onOpenCollab || props.onOpenWishWizard,
                }, '前往「协同与审批」启动立项')
              : null))
      }

      const renderTreeChildCard = (c, portSide) => {
        const isSel = selAgentId === c.id
        const isErrCard = c.status === 'error'
        const isRunCard = c.status === 'running'
        const isPendCard = c.status === 'pending'
        const isSpawning = Boolean(animatingSpawnIds[c.id])
        const isCompleting = Boolean(animatingCompleteIds[c.id])
        const isApproved = c.approvalState === 'approved'
        const isRevReq = c.approvalState === 'revision_required'
        const isBusyDispatch = dispatchingId === c.id
        const accentColor = isErrCard ? '#ef4444' : (c.color || '#3b82f6')
        const statusColor = isErrCard ? '#ef4444' : (isRunCard ? '#3b82f6' : (isPendCard ? '#f59e0b' : '#10b981'))
        const statusText = isErrCard ? '异常' : (isRunCard ? '运行中' : (isPendCard ? '待执行' : '已完成'))
        const summaryText = (c.compressedDigest && c.compressedDigest.whatWasDone) || c.output || c.assignedGoal || '等待分片执行'
        const portClass = portSide === 'top' ? 'rt-tree-port rt-tree-port-top' : 'rt-tree-port rt-tree-port-left'
        const portStyle = portSide === 'top'
          ? {
              position: 'absolute',
              top: -5,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--dsw-alias-bg-layer-1)',
              border: '2px solid ' + accentColor,
              pointerEvents: 'none',
              zIndex: 3,
            }
          : {
              position: 'absolute',
              left: -5,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--dsw-alias-bg-layer-1)',
              border: '2px solid ' + accentColor,
              pointerEvents: 'none',
              zIndex: 3,
            }
        const cardStyle = Object.assign({
          position: 'relative',
          width: '100%',
          boxSizing: 'border-box',
          border: isErrCard
            ? '1.5px solid #ef4444'
            : (isSel ? ('1.5px solid ' + accentColor) : '1px solid var(--dsw-alias-border-l1)'),
          borderRadius: 10,
          padding: '9px 10px 8px',
          background: isErrCard ? 'rgba(239,68,68,0.05)' : 'var(--dsw-alias-bg-layer-1)',
          cursor: 'pointer',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          minWidth: 0,
          boxShadow: isSel ? ('0 0 0 3px ' + accentColor + '26') : '0 2px 6px rgba(15,23,42,0.04)',
        }, portSide === 'top'
          ? { borderTop: '3.5px solid ' + accentColor }
          : { borderLeft: '3.5px solid ' + accentColor })

        return h('div', Object.assign({
          key: c.id,
          ref: (el) => {
            if (!childCardDomRefs.current) childCardDomRefs.current = {}
            if (el) childCardDomRefs.current[c.id] = el
            else delete childCardDomRefs.current[c.id]
          },
          className: 'rt-p4-node-card'
            + (isSel ? ' on' : '')
            + (isErrCard ? ' is-error' : '')
            + (isSpawning ? ' rt-anim-spawn' : '')
            + (isCompleting ? ' rt-anim-complete' : ''),
          style: cardStyle,
        }, clickable(() => openAgentInspector(c.id), {
          label: '检视子智能体 ' + c.title + ' 环节细节',
          expanded: isSel,
        })),
          h('span', { className: portClass, 'aria-hidden': 'true', style: portStyle }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 } },
            h('span', {
              style: {
                background: accentColor,
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
                minWidth: 0,
              },
              title: c.title,
            }, c.title),
            h('span', {
              style: {
                fontSize: 10,
                fontWeight: 700,
                color: statusColor,
                flex: 'none',
              },
            }, statusText)),
          h('div', {
            style: {
              fontSize: 10.5,
              color: isErrCard ? '#ef4444' : 'var(--dsw-alias-label-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            },
            title: summaryText,
          }, summaryText),
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, fontSize: 9.5, flexWrap: 'wrap' } },
            h('span', { className: 'rt-mono', style: { color: 'var(--dsw-alias-label-secondary)' } },
              c.tokenLabel + ' · ' + (c.durationLabel || '待命') + ' · ' + (c.steps || 0) + ' 步'),
            h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
              (isRevReq || !isApproved)
                ? h('span', {
                    style: {
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: isRevReq ? 'rgba(239,68,68,0.14)' : 'rgba(245,158,11,0.16)',
                      color: isRevReq ? '#ef4444' : '#d97706',
                      fontWeight: 700,
                    },
                  }, isRevReq ? '待重做' : '待审批')
                : null,
              (isPendCard && isClusterVariant)
                ? h('button', {
                    type: 'button',
                    className: 'rt-btn rt-btn-primary',
                    disabled: isBusyDispatch,
                    style: { padding: '1px 7px', fontSize: 9.5, lineHeight: '15px' },
                    onClick: (e) => {
                      if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
                      handleDispatchWorkerTask(c)
                    },
                  }, isBusyDispatch ? '拉起中…' : '拉起执行')
                : null)))
      }

      return h('div', { className: 'rt-bento-card rt-p4-workbench' },
        h('div', { className: 'rt-bento-head' },
          h('span', { className: 'rt-bento-title' }, isClusterVariant ? '派生树状图 & 多维协同工作台' : '派生树状图 & 实时工作流'),
          h('span', { className: 'rt-tag rt-tag-live' }, totalAgents + ' Agent · ' + allTasks.length + ' 协作任务'),
          pendingApprovalCount > 0
            ? h('span', { className: 'rt-tag rt-tag-warn' }, '待审批 ' + pendingApprovalCount)
            : null,
          errorCount > 0
            ? h('span', {
                className: 'rt-tag',
                style: { background: 'rgba(239,68,68,0.14)', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)', fontWeight: 700 },
              }, errorCount + ' 异常待修复')
            : null,
          selAgentId
            ? h('button', {
                type: 'button',
                className: 'rt-btn',
                style: { padding: '1px 7px', fontSize: 10.5 },
                onClick: () => setSelAgentId(null),
              }, '清除节点筛选')
            : null,
          h('div', { className: 'rt-spacer' }),
          isClusterVariant
            ? h('div', { className: 'rt-harness-modebar', role: 'group', 'aria-label': '工作流视图切换', style: { display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
                h('button', {
                  type: 'button',
                  className: 'rt-harness-modebtn' + (mode === 'p4' ? ' on' : ''),
                  onClick: () => setMode('p4'),
                }, '派生树'),
                h('button', {
                  type: 'button',
                  className: 'rt-harness-modebtn' + (mode === 'swim' ? ' on' : ''),
                  onClick: () => setMode('swim'),
                }, '泳道矩阵'),
                h('button', {
                  type: 'button',
                  className: 'rt-harness-modebtn' + (mode === 'docwall' ? ' on' : ''),
                  onClick: () => setMode('docwall'),
                }, '角色文稿'),
                (props.onOpenCollab || props.onOpenWishWizard)
                  ? h('button', {
                      type: 'button',
                      className: 'rt-btn',
                      style: { padding: '2px 8px', fontSize: 11 },
                      onClick: props.onOpenCollab || props.onOpenWishWizard,
                    }, '协同与审批' + (pendingApprovalCount > 0 ? (' (' + pendingApprovalCount + ')') : ''))
                  : null,
                h('button', {
                  type: 'button',
                  className: 'rt-btn',
                  style: { padding: '2px 8px', fontSize: 11 },
                  onClick: () => setUI({ tab: 'settings' }),
                }, '设置'))
            : h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                props.onOpenCollab
                  ? h('button', {
                      type: 'button',
                      className: 'rt-btn',
                      onClick: props.onOpenCollab,
                    }, '协同与审批' + (pendingApprovalCount > 0 ? (' (' + pendingApprovalCount + ')') : ''))
                  : null,
                props.onOpenAgents
                  ? h('button', {
                      type: 'button',
                      className: 'rt-btn',
                      onClick: props.onOpenAgents,
                    }, '完整拓扑与泳道 →')
                  : null,
                h('button', {
                  type: 'button',
                  className: 'rt-btn',
                  onClick: () => setUI({ tab: 'settings' }),
                }, '设置'))),

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
              }, '关闭'))
          : null,

        /* ── 模式 1: p4 派生树画布 + 检视器 / 泳道协同 ── */
        effectiveMode === 'p4'
          ? h('div', {
              className: 'rt-p4-split-grid rt-p4-vertical-stack rt-p4-split',
              style: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%' },
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
                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                    h('span', { style: { fontWeight: 700, fontSize: 13 } }, 'Agent 网络 · 派生树状图'),
                    h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                      isClusterVariant
                        ? '点击节点检视执行细节、编辑目标、拉起执行或审批放行'
                        : '点击任意节点预览阶段进展')),
                  h('div', { style: { display: 'inline-flex', flexWrap: 'wrap', gap: 6, fontSize: 11 } },
                    h('span', { className: 'rt-tag rt-tag-live' }, totalAgents + ' Agent'),
                    h('span', { className: 'rt-tag rt-tag-active' }, runningCount + ' 运行中'),
                    errorCount > 0 ? h('span', { className: 'rt-tag', style: { color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' } }, errorCount + ' 异常') : null,
                    h('span', { className: 'rt-tag' }, '上下文 ' + ctxSumLabel))),

                /* 画布搜索/过滤与交互式新增分片工具栏 */
                isClusterVariant
                  ? h('div', {
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
                        { k: 'running', lbl: '运行中' },
                        { k: 'pending', lbl: '待审批' + (pendingApprovalCount > 0 ? ' (' + pendingApprovalCount + ')' : '') },
                        { k: 'error', lbl: '异常阻塞' + (errorCount > 0 ? ' (' + errorCount + ')' : '') },
                      ].map((fp) => h('button', {
                        key: 'cf-' + fp.k,
                        type: 'button',
                        className: 'rt-btn' + (canvasFilter === fp.k ? ' rt-btn-primary' : ''),
                        style: { fontSize: 10.5, padding: '2px 8px' },
                        onClick: () => setCanvasFilter(fp.k),
                      }, fp.lbl)),
                      h('div', { className: 'rt-spacer' }),
                      (props.onOpenCollab || props.onOpenWishWizard)
                        ? h('button', {
                            type: 'button',
                            className: 'rt-btn',
                            style: { padding: '2px 8px', fontSize: 11, fontWeight: 600 },
                            onClick: props.onOpenCollab || props.onOpenWishWizard,
                          }, '需求拆解与审批')
                        : null,
                      h('button', {
                        type: 'button',
                        className: 'rt-btn' + (showAddShardForm ? ' rt-btn-primary' : ''),
                        style: { padding: '2px 9px', fontSize: 11, fontWeight: 600 },
                        onClick: () => setShowAddShardForm((v) => !v),
                      }, showAddShardForm ? '收起新增分片' : '+ 新增分片节点'))
                  : null,

                isClusterVariant && showAddShardForm
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

                /* 可平移与缩放的路径树画布视口 (.rt-panzoom-viewport) */
                h('div', {
                  ref: viewportDomRef,
                  className: 'rt-panzoom-viewport' + (isClusterVariant ? ' rt-panzoom-viewport-cluster' : ''),
                  onMouseDown: handleViewportMouseDown,
                  onMouseMove: handleViewportMouseMove,
                  onMouseUp: handleViewportMouseUp,
                  onMouseLeave: handleViewportMouseUp,
                  onWheel: handleViewportWheel,
                  style: { padding: '8px 6px 12px' },
                },
                  h('div', {
                    className: 'rt-panzoom-toolbar',
                    role: 'toolbar',
                    'aria-label': '路径树画布平移缩放与折叠控制',
                    style: { flexWrap: 'wrap' },
                  },
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn rt-tree-layout-setting',
                      style: { padding: '1px 8px', fontSize: 10.5, fontWeight: 600 },
                      onClick: toggleTreeDirection,
                      title: '切换开发树展开方向（横向向右派生 / 纵向向下派生）',
                    }, treeDirection === 'horizontal'
                      ? '⇄ 横向向右派生'
                      : '⇄ 纵向向下派生'),
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
                    }, '适应视口'),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn',
                      style: { padding: '1px 7px', fontSize: 10.5 },
                      onClick: resetPanZoom,
                    }, '1:1 复位'),
                    activeWaveGroups.length > 0
                      ? h('button', {
                          type: 'button',
                          className: 'rt-btn' + (allWavesExpanded ? ' rt-btn-primary' : ''),
                          style: { padding: '1px 7px', fontSize: 10.5 },
                          onClick: () => (allWavesExpanded ? (fusedChildren.length > 4 ? autoFoldWaves() : collapseAllWaves()) : expandAllWaves()),
                        }, allWavesExpanded ? '自动收起' : '全部展开')
                      : null),

                  h('div', {
                    ref: stageDomRef,
                    className: 'rt-panzoom-stage',
                    style: {
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      padding: '42px 6px 6px',
                      position: 'relative',
                      transform: `translate3d(${panZoom.x}px, ${panZoom.y}px, 0) scale(${panZoom.scale})`,
                      transformOrigin: '0 0',
                    },
                  },
                    treeDirection === 'horizontal'
                      ? h('div', {
                          ref: treeStageDomRef,
                          className: 'rt-tree-layout-horizontal rt-tree-stage',
                          style: {
                            display: 'block',
                            position: 'relative',
                            minWidth: 'max-content',
                            width: '100%',
                            padding: '24px 28px',
                            boxSizing: 'border-box',
                          },
                        },
                          treeEdgesSvg,
                          h('div', {
                            ref: treeNodeLayerDomRef,
                            className: 'rt-tree-node-layer',
                            style: {
                              position: 'relative',
                              zIndex: 2,
                              display: 'flex',
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 68,
                              width: 'max-content',
                              minWidth: '100%',
                            },
                          },
                            h('div', {
                              className: 'rt-h-root-col',
                              style: { width: 256, flex: 'none', display: 'flex', alignItems: 'center' },
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
                                h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                                  h('span', { style: { background: '#3b82f6', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 6, flex: 'none' } }, '主控'),
                                  h('span', {
                                    style: { fontWeight: 700, fontSize: 12.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                                    title: workspaceDisplayTitle,
                                  }, workspaceDisplayTitle),
                                  h('span', { className: 'rt-tag rt-tag-live', style: { margin: 0, flex: 'none' } }, runningCount > 0 ? '运行中' : (fusedChildren.length > 0 ? '协同中' : '就绪'))),
                                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: 'var(--dsw-alias-label-secondary)', gap: 6 } },
                                  h('span', { className: 'rt-mono' }, rootTokensLabel + ' · ' + rootCostLabel),
                                  h('span', { className: 'rt-mono' }, rootDuration + ' · ' + rootSteps + ' 步'),
                                  h('span', { className: 'rt-mono', style: { fontWeight: 600, color: '#3b82f6' } }, rootCtxPct)),
                                activeWaveGroups.length > 0
                                  ? h('span', {
                                      className: 'rt-tree-port rt-tree-port-right',
                                      'aria-hidden': 'true',
                                      style: {
                                        position: 'absolute',
                                        right: -5,
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        width: 9,
                                        height: 9,
                                        borderRadius: '50%',
                                        background: 'var(--dsw-alias-bg-layer-1)',
                                        border: '2px solid #3b82f6',
                                        pointerEvents: 'none',
                                        zIndex: 3,
                                      },
                                    })
                                  : null)),

                            activeWaveGroups.length > 0
                              ? h('div', {
                                  className: 'rt-h-waves-stack rt-tree-wave-row',
                                  style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 22, flex: 1, minWidth: 0 },
                                },
                                  activeWaveGroups.map((wg) => {
                                    const expanded = Boolean(expandedMap[wg.wave])
                                    const hasSelectedChild = wg.children.some((c) => c.id === selAgentId)
                                    const isSpawningWave = wg.children.some((c) => Boolean(animatingSpawnIds[c.id]))
                                    const isCompletingWave = wg.children.some((c) => Boolean(animatingCompleteIds[c.id]))
                                    const statusSummary = wg.errorInWave > 0
                                      ? (wg.errorInWave + ' 异常')
                                      : (wg.runningInWave > 0
                                        ? (wg.runningInWave + ' 运行中')
                                        : (wg.pendingInWave > 0 && wg.doneInWave === 0
                                          ? (wg.pendingInWave + ' 待执行')
                                          : (wg.doneInWave + '/' + wg.children.length + ' 完成')))
                                    const visibleWaveChildren = visibleChildrenByWave[wg.wave] || []
                                    const hiddenWaveCount = Math.max(0, wg.children.length - visibleWaveChildren.length)

                                    return h('div', {
                                      key: 'h-wave-lane-' + wg.wave,
                                      className: 'rt-wave-horizontal-lane',
                                      style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 38, minWidth: 0 },
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
                                          width: 236,
                                          flex: 'none',
                                          position: 'relative',
                                          borderLeft: '3.5px solid ' + wg.color,
                                          borderColor: (expanded || hasSelectedChild || wg.errorInWave > 0) ? wg.color : 'var(--dsw-alias-border-l1)',
                                        },
                                      }, clickable(() => toggleWaveExpand(wg.wave), {
                                        label: (expanded ? '收起 ' : '展开 ') + wg.title + ' (' + wg.children.length + ' 个节点)',
                                        expanded: expanded,
                                      })),
                                        h('span', {
                                          className: 'rt-tree-port rt-tree-port-left',
                                          'aria-hidden': 'true',
                                          style: {
                                            position: 'absolute',
                                            left: -5,
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            width: 8,
                                            height: 8,
                                            borderRadius: '50%',
                                            background: 'var(--dsw-alias-bg-layer-1)',
                                            border: '2px solid ' + wg.color,
                                            pointerEvents: 'none',
                                            zIndex: 3,
                                          },
                                        }),
                                        expanded
                                          ? h('span', {
                                              className: 'rt-tree-port rt-tree-port-right',
                                              'aria-hidden': 'true',
                                              style: {
                                                position: 'absolute',
                                                right: -5,
                                                top: '50%',
                                                transform: 'translateY(-50%)',
                                                width: 8,
                                                height: 8,
                                                borderRadius: '50%',
                                                background: 'var(--dsw-alias-bg-layer-1)',
                                                border: '2px solid ' + wg.color,
                                                pointerEvents: 'none',
                                                zIndex: 3,
                                              },
                                            })
                                          : null,
                                        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, flexWrap: 'wrap' } },
                                          h('span', {
                                            className: 'rt-tree-wave-card-badge',
                                            style: { color: wg.color, borderColor: wg.color + '55', background: wg.color + '18' },
                                          }, wg.shortLabel + ' · ' + wg.children.length + ' 节点'),
                                          h('span', {
                                            className: 'rt-mono',
                                            style: {
                                              fontSize: 10,
                                              fontWeight: 700,
                                              color: wg.errorInWave > 0 ? '#ef4444' : (wg.runningInWave > 0 ? '#3b82f6' : (wg.pendingInWave > 0 && wg.doneInWave === 0 ? '#d97706' : '#10b981')),
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
                                          h('span', null, wg.runningInWave + ' 运行 · ' + wg.doneInWave + ' 完成' + (wg.pendingInWave > 0 ? (' · ' + wg.pendingInWave + ' 待执行') : '')),
                                          h('span', null, wg.tokenLabel)),
                                        h('div', {
                                          style: { height: 4, borderRadius: 99, background: 'var(--dsw-alias-bg-layer-2)', overflow: 'hidden' },
                                        },
                                          h('div', {
                                            style: { width: wg.progressPct + '%', height: '100%', background: wg.color, borderRadius: 99 },
                                          })),
                                        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2 } },
                                          h('button', {
                                            type: 'button',
                                            className: 'rt-btn',
                                            style: { padding: '0 7px', fontSize: 10, lineHeight: '17px' },
                                            onClick: (e) => {
                                              if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
                                              toggleWaveExpand(wg.wave)
                                            },
                                          }, expanded ? '收起分片' : '展开分片'))),

                                      expanded
                                        ? h('div', {
                                            className: 'rt-wave-right-children rt-tree-expanded-grid rt-p4-children-grid',
                                            style: {
                                              display: 'grid',
                                              gridTemplateColumns: visibleWaveChildren.length > 3 ? 'repeat(2, 236px)' : '248px',
                                              rowGap: 16,
                                              columnGap: 34,
                                              alignItems: 'stretch',
                                              border: 'none',
                                              margin: 0,
                                              padding: visibleWaveChildren.length > 3 ? '12px 0 4px' : 0,
                                              background: 'transparent',
                                              flex: 'none',
                                              minWidth: 0,
                                            },
                                          },
                                            visibleWaveChildren.map((c) => renderTreeChildCard(c, 'left')),
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
                                              : null)
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
                                    flex: 1,
                                  },
                                },
                                  h('div', { style: { fontWeight: 700, fontSize: 13, color: 'var(--dsw-alias-label-primary)' } },
                                    fusedChildren.length > 0
                                      ? '当前过滤条件下没有匹配的节点'
                                      : '当前工作台尚无研发分片'),
                                  h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.55 } },
                                    fusedChildren.length > 0
                                      ? '点击上方「全部」筛选或清空搜索词即可恢复显示。'
                                      : '请前往「协同与审批」通过 AI 澄清与拆解立项生成分片，或在工具栏点击「+ 新增分片节点」。'),
                                  fusedChildren.length > 0
                                    ? h('button', {
                                        type: 'button',
                                        className: 'rt-btn',
                                        onClick: () => { setCanvasFilter('all'); setCanvasSearch('') },
                                      }, '重置筛选条件')
                                    : ((props.onOpenCollab || props.onOpenWishWizard)
                                      ? h('button', {
                                          type: 'button',
                                          className: 'rt-btn rt-btn-primary',
                                          onClick: props.onOpenCollab || props.onOpenWishWizard,
                                        }, '前往「协同与审批」立项拆解')
                                      : null))))
                      : /* ── 备选布局：纵向向下派生树 (.rt-p5-tree-stage.rt-tree-layout-vertical) ── */
                        h('div', {
                          ref: treeStageDomRef,
                          className: 'rt-p5-tree-stage rt-tree-layout-vertical rt-tree-stage',
                          style: {
                            display: 'block',
                            position: 'relative',
                            width: '100%',
                            padding: '24px 20px',
                            boxSizing: 'border-box',
                          },
                        },
                          treeEdgesSvg,
                          h('div', {
                            ref: treeNodeLayerDomRef,
                            className: 'rt-tree-node-layer',
                            style: {
                              position: 'relative',
                              zIndex: 2,
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'stretch',
                              gap: 52,
                              width: '100%',
                            },
                          },
                            h('div', Object.assign({
                              ref: rootCardDomRef,
                              className: 'rt-p4-node-card rt-p4-root-card'
                                + (selAgentId === 'root' ? ' on' : '')
                                + (hubAbsorbing ? ' rt-anim-hub-absorb' : ''),
                              style: {
                                width: 'min(340px, 94%)',
                                margin: '0 auto',
                                position: 'relative',
                                border: selAgentId === 'root' ? '1.5px solid #3b82f6' : '1px solid var(--dsw-alias-border-l1)',
                                borderTop: '3.5px solid #3b82f6',
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
                              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                                h('span', { style: { background: '#3b82f6', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 6 } }, '主控'),
                                h('span', { style: { fontWeight: 700, fontSize: 12.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, workspaceDisplayTitle),
                                h('span', { className: 'rt-tag rt-tag-live', style: { margin: 0 } }, runningCount > 0 ? '运行中' : (fusedChildren.length > 0 ? '协同中' : '就绪'))),
                              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: 'var(--dsw-alias-label-secondary)', gap: 6 } },
                                h('span', { className: 'rt-mono' }, rootTokensLabel + ' · ' + rootCostLabel),
                                h('span', { className: 'rt-mono' }, rootDuration + ' · ' + rootSteps + ' 步'),
                                h('span', { className: 'rt-mono', style: { fontWeight: 600, color: '#3b82f6' } }, rootCtxPct)),
                              activeWaveGroups.length > 0
                                ? h('span', {
                                    className: 'rt-tree-port rt-tree-port-bottom',
                                    'aria-hidden': 'true',
                                    style: {
                                      position: 'absolute',
                                      bottom: -5,
                                      left: '50%',
                                      transform: 'translateX(-50%)',
                                      width: 9,
                                      height: 9,
                                      borderRadius: '50%',
                                      background: 'var(--dsw-alias-bg-layer-1)',
                                      border: '2px solid #3b82f6',
                                      pointerEvents: 'none',
                                      zIndex: 3,
                                    },
                                  })
                                : null),

                            activeWaveGroups.length > 0
                              ? h('div', {
                                  className: 'rt-tree-wave-row rt-tree-wave-grid',
                                  style: {
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(' + Math.max(1, activeWaveGroups.length) + ', minmax(210px, 1fr))',
                                    gap: 22,
                                    alignItems: 'start',
                                  },
                                },
                                  activeWaveGroups.map((wg) => {
                                    const expanded = Boolean(expandedMap[wg.wave])
                                    const hasSelectedChild = wg.children.some((c) => c.id === selAgentId)
                                    const statusSummary = wg.errorInWave > 0
                                      ? (wg.errorInWave + ' 异常')
                                      : (wg.runningInWave > 0
                                        ? (wg.runningInWave + ' 运行中')
                                        : (wg.pendingInWave > 0 && wg.doneInWave === 0
                                          ? (wg.pendingInWave + ' 待执行')
                                          : (wg.doneInWave + '/' + wg.children.length + ' 完成')))
                                    const visibleWaveChildren = visibleChildrenByWave[wg.wave] || []
                                    const hiddenWaveCount = Math.max(0, wg.children.length - visibleWaveChildren.length)
                                    return h('div', {
                                      key: 'v-wave-col-' + wg.wave,
                                      style: { display: 'flex', flexDirection: 'column', gap: 28, minWidth: 0 },
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
                                          + (wg.errorInWave > 0 ? ' is-error' : ''),
                                        style: {
                                          position: 'relative',
                                          borderTop: '3.5px solid ' + wg.color,
                                          borderColor: (expanded || hasSelectedChild || wg.errorInWave > 0) ? wg.color : 'var(--dsw-alias-border-l1)',
                                        },
                                      }, clickable(() => toggleWaveExpand(wg.wave), {
                                        label: (expanded ? '收起 ' : '展开 ') + wg.title,
                                        expanded: expanded,
                                      })),
                                        h('span', {
                                          className: 'rt-tree-port rt-tree-port-top',
                                          'aria-hidden': 'true',
                                          style: {
                                            position: 'absolute',
                                            top: -5,
                                            left: '50%',
                                            transform: 'translateX(-50%)',
                                            width: 8,
                                            height: 8,
                                            borderRadius: '50%',
                                            background: 'var(--dsw-alias-bg-layer-1)',
                                            border: '2px solid ' + wg.color,
                                            pointerEvents: 'none',
                                            zIndex: 3,
                                          },
                                        }),
                                        expanded
                                          ? h('span', {
                                              className: 'rt-tree-port rt-tree-port-bottom',
                                              'aria-hidden': 'true',
                                              style: {
                                                position: 'absolute',
                                                bottom: -5,
                                                left: '50%',
                                                transform: 'translateX(-50%)',
                                                width: 8,
                                                height: 8,
                                                borderRadius: '50%',
                                                background: 'var(--dsw-alias-bg-layer-1)',
                                                border: '2px solid ' + wg.color,
                                                pointerEvents: 'none',
                                                zIndex: 3,
                                              },
                                            })
                                          : null,
                                        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 } },
                                          h('span', { className: 'rt-tree-wave-card-badge', style: { color: wg.color, borderColor: wg.color + '55', background: wg.color + '18' } },
                                            wg.shortLabel + ' · ' + wg.children.length + ' 节点'),
                                          h('span', {
                                            className: 'rt-mono',
                                            style: {
                                              fontSize: 10,
                                              fontWeight: 700,
                                              color: wg.errorInWave > 0 ? '#ef4444' : (wg.runningInWave > 0 ? '#3b82f6' : (wg.pendingInWave > 0 && wg.doneInWave === 0 ? '#d97706' : '#10b981')),
                                            },
                                          }, statusSummary)),
                                        h('div', { style: { fontWeight: 700, fontSize: 11.5 } }, wg.title),
                                        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, gap: 6 } },
                                          h('span', { className: 'rt-mono', style: { color: 'var(--dsw-alias-label-secondary)' } }, wg.tokenLabel),
                                          h('button', {
                                            type: 'button',
                                            className: 'rt-btn',
                                            style: { padding: '0 7px', fontSize: 10, lineHeight: '17px' },
                                            onClick: (e) => {
                                              if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
                                              toggleWaveExpand(wg.wave)
                                            },
                                          }, expanded ? '收起分片' : '展开分片'))),
                                      expanded
                                        ? h('div', {
                                            className: 'rt-wave-subtree-children rt-p4-children-grid',
                                            style: { display: 'flex', flexDirection: 'column', gap: 14, paddingLeft: 18, minWidth: 0 },
                                          },
                                            visibleWaveChildren.map((c) => renderTreeChildCard(c, 'top')),
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
                                  fusedChildren.length > 0
                                    ? '当前过滤条件下没有匹配的节点'
                                    : '当前工作台尚无研发分片 — 前往「协同与审批」立项拆解')))))),

              /* 总览轻量摘要条 (!isClusterVariant) vs 集群下方全宽流程舱 (isClusterVariant) */
              !isClusterVariant
                ? (selAgentId && activeInspectorAgent
                    ? (() => {
                        const ovSummary = (activeInspectorAgent.compressedDigest && activeInspectorAgent.compressedDigest.whatWasDone)
                          || activeInspectorAgent.output
                          || '节点已就绪，点击右侧入口可前往审批或展开完整泳道。'
                        const ovStatusLabel = activeInspectorAgent.status === 'error'
                          ? '异常待修复'
                          : (activeInspectorAgent.status === 'running'
                            ? '运行中'
                            : (activeInspectorAgent.status === 'pending' ? '待执行' : '已完成'))
                        return h('div', { className: 'rt-ov-node-strip' },
                          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 } },
                            h('span', {
                              style: {
                                background: activeInspectorAgent.color || '#3b82f6',
                                color: '#fff',
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: 5,
                                fontFamily: 'ui-monospace,Menlo,monospace',
                              },
                            }, activeInspectorAgent.avatar),
                            h('span', { style: { fontWeight: 700, fontSize: 12.5, color: 'var(--dsw-alias-label-primary)' } }, activeInspectorAgent.title),
                            h('span', { className: 'rt-tag', style: { margin: 0, fontSize: 10 } }, ovStatusLabel),
                            h('span', { className: 'rt-mono', style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
                              (activeInspectorAgent.tokenLabel || rootTokensLabel) + ' · ' + (activeInspectorAgent.durationLabel || '待命') + ' · ' + (activeInspectorAgent.steps || 0) + ' 步'),
                            h('div', { className: 'rt-spacer' }),
                            (props.onOpenCollab || props.onOpenWishWizard)
                              ? h('button', {
                                  type: 'button',
                                  className: 'rt-btn rt-btn-primary',
                                  style: { padding: '2px 9px', fontSize: 11, fontWeight: 600 },
                                  onClick: props.onOpenCollab || props.onOpenWishWizard,
                                }, '前往「协同与审批」 →')
                              : null,
                            props.onOpenAgents
                              ? h('button', {
                                  type: 'button',
                                  className: 'rt-btn',
                                  style: { padding: '2px 9px', fontSize: 11, fontWeight: 600 },
                                  onClick: props.onOpenAgents,
                                }, '查看完整泳道与检视器 →')
                              : null,
                            h('button', {
                              type: 'button',
                              className: 'rt-btn',
                              style: { padding: '1px 6px', fontSize: 11 },
                              title: '收起节点摘要',
                              onClick: () => openAgentInspector('__closed__'),
                            }, '收起')),
                          h('div', {
                            style: {
                              fontSize: 11.5,
                              color: 'var(--dsw-alias-label-secondary)',
                              lineHeight: 1.5,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            },
                          }, ovSummary))
                      })()
                    : null)
                : null)
          : null,

        /* ── 下方全宽流程舱：检视器 + 协作泳道 + 协作任务（p4 下方与 swim 专屏复用，无重复代码） ── */
        (isClusterVariant && (effectiveMode === 'p4' || effectiveMode === 'swim'))
          ? h('div', {
              className: 'rt-lower-process-deck',
              style: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', minWidth: 0 },
            },
              /* Section 1: Agent 环节执行轨迹与交互式创作/审批抽屉 (.rt-agent-inspector-drawer) */
              activeInspectorAgent
                ? (() => {
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
                    const isInspPendingExec = !activeInspectorAgent.isRoot && activeInspectorAgent.status === 'pending'
                    const isInspDispatchBusy = dispatchingId === activeInspectorAgent.id

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
                        h('span', { className: 'rt-tag', style: { margin: 0, fontSize: 10 } },
                          activeInspectorAgent.isRoot
                            ? 'Wave 0 · 主控'
                            : ('Wave ' + (activeInspectorAgent.wave || 1) + ' · ' + activeInspectorAgent.role)),
                        h('span', { className: 'rt-tag rt-mono', style: { margin: 0, fontSize: 10 } },
                          'session: ' + ((activeInspectorDetail && activeInspectorDetail.sessionId) || activeInspectorAgent.sessionId || activeInspectorAgent.id)),
                        h('span', { className: 'rt-mono', style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
                          (activeInspectorAgent.tokenLabel || rootTokensLabel) + ' · ' + (activeInspectorAgent.durationLabel || '实时') + ' · ' + (activeInspectorAgent.steps || 0) + ' 步'),
                        h('div', { className: 'rt-spacer' }),
                        isInspPendingExec
                          ? h('button', {
                              type: 'button',
                              className: 'rt-btn rt-btn-primary',
                              disabled: isInspDispatchBusy,
                              style: { padding: '3px 10px', fontSize: 11, fontWeight: 700 },
                              onClick: () => handleDispatchWorkerTask(activeInspectorAgent),
                            }, isInspDispatchBusy ? '拉起中…' : '拉起执行')
                          : null,
                        !activeInspectorAgent.isRoot
                          ? h('button', {
                              type: 'button',
                              className: 'rt-btn',
                              style: { padding: '3px 9px', fontSize: 11, fontWeight: 600 },
                              onClick: () => setEditingGoalOpen((v) => !v),
                            }, editingGoalOpen ? '收起目标编辑' : '编辑分片目标')
                          : null,
                        !activeInspectorAgent.isRoot
                          ? h('button', {
                              type: 'button',
                              className: 'rt-btn',
                              disabled: retryingBusy,
                              style: { padding: '3px 9px', fontSize: 11, fontWeight: 600 },
                              onClick: () => handleRetryWorkerTask(activeInspectorAgent),
                            }, retryingBusy ? '重跑中…' : '重跑该分片')
                          : null,
                        h('button', {
                          type: 'button',
                          className: 'rt-btn rt-btn-primary rt-jump-chat-btn',
                          style: { padding: '3px 10px', fontSize: 11, fontWeight: 700 },
                          onClick: () => handleOpenAgentChat(activeInspectorAgent),
                        }, '跳转会话聊天 ↗'),
                        h('button', {
                          type: 'button',
                          className: 'rt-btn',
                          style: { padding: '2px 7px', fontSize: 11 },
                          title: '收起检视抽屉',
                          onClick: () => openAgentInspector('__closed__'),
                        }, '收起')),

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
                            h('div', { style: { fontSize: 11, fontWeight: 700 } }, '编辑该子智能体的委派目标与独占文件分片'),
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
                              }, savingGoalBusy ? '保存中…' : '保存目标'),
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
                              'Step 1 · 委派目标'),
                            h('span', { className: 'rt-mono', style: { fontSize: 10, color: activeInspectorAgent.color || '#3b82f6', fontWeight: 700 } },
                              'Wave ' + (activeInspectorAgent.wave || 0) + ' · ' + activeInspectorAgent.role)),
                          h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.55 } },
                            (activeInspectorDetail && activeInspectorDetail.prompt) || activeInspectorAgent.assignedGoal || activeInspectorAgent.inputPrompt || activeInspectorAgent.prompt)),

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
                              'Step 2 · 核心执行'),
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
                                  color: st.status === 'error' ? '#ef4444' : (st.status === 'running' ? '#3b82f6' : (st.status === 'pending' ? '#d97706' : '#10b981')),
                                  fontWeight: 600,
                                },
                              }, st.status === 'error' ? '异常' : (st.status === 'running' ? '执行中' : (st.status === 'pending' ? '待执行' : '完成'))))))),

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
                              'Step 3 · 阶段结论与审批'),
                            h('span', {
                              style: {
                                fontSize: 9.5,
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: 99,
                                background: isInspRevReq ? 'rgba(239,68,68,0.14)' : (isInspApproved ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.16)'),
                                color: isInspRevReq ? '#ef4444' : (isInspApproved ? '#10b981' : '#d97706'),
                              },
                            }, isInspRevReq ? '已驳回重做' : (isInspApproved ? '已审批' : '待审批'))),
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
                                  `原始 ${rawTokNum} tok → 压缩后 ${compTokNum} tok (-${compPctNum}%)`)
                              : null))),

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
                        }, approvingBusy ? '提交中…' : '审批通过并下达目标'),
                        !activeInspectorAgent.isRoot
                          ? h('button', {
                              type: 'button',
                              disabled: approvingBusy,
                              className: 'rt-btn',
                              style: { padding: '3px 9px', fontSize: 11, color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' },
                              onClick: () => handlePlanApproveWorker(activeInspectorAgent, 'revision_requested'),
                            }, '驳回重做')
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
                    h('span', null, '点击派生树节点或泳道行可展开环节执行轨迹与审批抽屉'),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn',
                      style: { padding: '2px 8px', fontSize: 11 },
                      onClick: () => openAgentInspector('root'),
                    }, '展开主控预览')),

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
                  h('span', { style: { fontWeight: 700, fontSize: 13 } }, '跨 Agent 协作泳道'),
                  h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                    filteredCollabCount + '/' + totalCollabEvents + ' 条记录 · ' + swimFilteredLanes.length + ' 条泳道'),
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
                    { k: '1', lbl: 'Wave 1 立项' },
                    { k: '2', lbl: 'Wave 2 架构' },
                    { k: '3', lbl: 'Wave 3 构建' },
                    { k: '4', lbl: 'Wave 4 审查' },
                  ].map((wf) => h('button', {
                    key: 'swf-' + wf.k,
                    type: 'button',
                    className: 'rt-btn' + (swimWaveFilter === wf.k ? ' rt-btn-primary' : ''),
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
                    const laneCompPct = lane.compressionPct || 0
                    const laneApproved = (approvedWorkerMap[lane.id] && approvedWorkerMap[lane.id].approved) || lane.approvalState === 'approved'
                    const step1Text = lane.isRoot ? '全局需求拆解与多波次并发调度' : (lane.prompt || lane.title)
                    const step2Text = laneSteps + ' 步工具调用 · ' + laneTok + ' · ' + laneDur
                    const step3Text = lane.isRoot
                      ? (fusedChildren.length > 0 ? ('已统筹 ' + fusedChildren.length + ' 个子代理压缩摘要与审批') : '主控编排器就绪，等待拆解任务')
                      : ((lane.output || '等待同步产物') + (laneCompPct > 0 ? (' · 压缩 -' + laneCompPct + '%') : ''))
                    const orderedStages = collabSort === 'desc'
                      ? [
                          { key: 's3', tag: '阶段结论', text: step3Text, isConclusion: true },
                          { key: 's2', tag: '核心执行', text: step2Text, isConclusion: false },
                          { key: 's1', tag: '委派目标', text: step1Text, isConclusion: false },
                        ]
                      : [
                          { key: 's1', tag: '委派目标', text: step1Text, isConclusion: false },
                          { key: 's2', tag: '核心执行', text: step2Text, isConclusion: false },
                          { key: 's3', tag: '阶段结论', text: step3Text, isConclusion: true },
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
                          h('span', {
                            style: {
                              fontSize: 11.5,
                              fontWeight: 700,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              color: 'var(--dsw-alias-label-primary)',
                            },
                            title: lane.title,
                          }, lane.isRoot ? ('主控 · ' + lane.title) : lane.title),
                          h('span', {
                            className: 'rt-mono',
                            style: { fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                          }, (lane.isRoot ? 'Wave 0' : ('Wave ' + (lane.wave || 1) + ' · ' + lane.role))
                            + (laneCompPct > 0 ? (' · -' + laneCompPct + '%') : '')
                            + ' · ' + (laneApproved ? '已审' : '待审')))),
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
                                          : (laneStatus === 'running' ? 'rgba(59,130,246,0.14)' : (laneStatus === 'pending' ? 'rgba(245,158,11,0.14)' : 'rgba(16,185,129,0.14)')),
                                        color: laneStatus === 'error' ? '#ef4444' : (laneStatus === 'running' ? '#3b82f6' : (laneStatus === 'pending' ? '#d97706' : '#10b981')),
                                      },
                                    }, laneStatus === 'error' ? '异常待修复' : (laneStatus === 'running' ? '运行中' : (laneStatus === 'pending' ? '待执行' : '已完成')))
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
                    className: 'rt-btn' + (taskFilter === fp.k ? ' rt-btn-primary' : ''),
                    style: { padding: '2px 8px', fontSize: 11 },
                    onClick: () => setTaskFilter(fp.k),
                  }, fp.lbl))),
                filteredTasks.length === 0
                  ? h('div', { className: 'rt-empty' }, '当前暂无协作工作项 —— 在「协同与审批」拆解需求或新增分片后将自动生成。')
                  : h('div', {
                      style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 },
                    },
                      filteredTasks.map((tk) => {
                        const isExp = expandedTaskId === tk.id
                        const isPendingTask = tk.rawStatus === 'pending'
                        const isTaskBusy = dispatchingId === tk.agentId
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
                            h('span', { className: 'rt-tag', style: { margin: 0, fontSize: 10 } }, 'Wave ' + (tk.wave || 1)),
                            h('span', {
                              style: {
                                fontSize: 10.5,
                                fontWeight: 600,
                                padding: '1px 7px',
                                borderRadius: 99,
                                background: tk.rawStatus === 'error'
                                  ? 'rgba(239,68,68,0.14)'
                                  : (tk.status === 'run' ? 'rgba(59,130,246,0.14)' : (isPendingTask ? 'rgba(245,158,11,0.14)' : 'rgba(16,185,129,0.14)')),
                                color: tk.rawStatus === 'error' ? '#ef4444' : (tk.status === 'run' ? '#3b82f6' : (isPendingTask ? '#d97706' : '#10b981')),
                              },
                            }, tk.statusBadge),
                            isPendingTask
                              ? h('button', {
                                  type: 'button',
                                  className: 'rt-btn rt-btn-primary',
                                  disabled: isTaskBusy,
                                  style: { padding: '1px 7px', fontSize: 10 },
                                  onClick: (e) => {
                                    if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
                                    handleDispatchWorkerTask({
                                      id: tk.agentId,
                                      sessionId: tk.sessionId,
                                      role: tk.role,
                                      wave: tk.wave,
                                      title: tk.title,
                                      assignedGoal: tk.assignedGoal || tk.prompt,
                                      filesOwned: tk.filesOwned,
                                    })
                                  },
                                }, isTaskBusy ? '拉起中…' : '拉起执行')
                              : null),
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
                                  }, '检视环节细节'),
                                  h('button', {
                                    type: 'button',
                                    className: 'rt-btn rt-jump-chat-btn',
                                    style: { padding: '1px 7px', fontSize: 10.5 },
                                    onClick: (e) => { e.stopPropagation(); handleOpenAgentChat(tk) },
                                  }, '跳转会话聊天 ↗'),
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
                      }))))
          : null,

        /* ── 模式 2: 角色文稿视图 (Doc Wall) ── */
        effectiveMode === 'docwall'
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
                  h('button', { type: 'button', className: 'rt-btn', onClick: () => setMode('p4') }, '返回派生树')),
                h(Markdown, { className: 'rt-markdown', text: selected.docBody })))
          : null)
    }
