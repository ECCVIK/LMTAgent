    /* ═══════════════════════════════════════════════════════════════════════════
     * 06-engineering-tabs.js — 架构模块、提示词、技能库、缺陷审查、交付报告、模式库、里程碑与运行环境
     * ═══════════════════════════════════════════════════════════════════════════ */

    function AssetsTab(props) {
      const eng = props.engagement
      const snapshot = props.snapshot
      const refreshKey = props.refreshKey || 0
      const onRefresh = props.onRefresh
      const [view, setView] = React.useState('next')
      const [cidr, setCidr] = React.useState(null)
      const [q, setQ] = React.useState('')
      const [qApplied, setQApplied] = React.useState('')
      const [service, setService] = React.useState('')
      const [port, setPort] = React.useState('')
      const [prov, setProv] = React.useState('')
      const [testStatus, setTestStatus] = React.useState('')
      const [priority, setPriority] = React.useState('')
      const [scope, setScope] = React.useState('')
      const [assetState, setAssetState] = React.useState('')
      const [sort, setSort] = React.useState('priority')
      const [showFilters, setShowFilters] = React.useState(false)
      const [showAll, setShowAll] = React.useState(null)
      const [state, setState] = React.useState({ loading: false, error: null, total: 0, items: [] })
      const [domains, setDomains] = React.useState(null)
      const [web, setWeb] = React.useState(null)
      const [openId, setOpenId] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [dagShardLocks, setDagShardLocks] = React.useState([])
      /* 左侧「对外服务模块 / 内部服务模块」两组各自折叠，状态按工作区记住 */
      const sideCollapse = useCollapse('assets-side:' + eng)
      const seq = React.useRef(0)
      const onData = props.onData

      React.useEffect(() => {
        if (!eng) {
          setDagShardLocks([])
          return
        }
        let alive = true
        api({ op: 'workflowDag', engagement: eng }).then((r) => {
          if (!alive) return
          const locks = r && (r.shard_locks || r.shardLocks)
          if (Array.isArray(locks)) setDagShardLocks(locks)
        }, () => {})
        return () => { alive = false }
      }, [eng, refreshKey])

      React.useEffect(() => {
        if (!eng) return
        const my = ++seq.current
        setState((s) => Object.assign({}, s, { loading: true, error: null }))
        api({
          op: 'assets', engagement: eng, cidr: cidr || undefined, q: qApplied || undefined,
          service: service || undefined, port: port || undefined,
          provenance: prov || undefined, test_status: testStatus || undefined,
          priority: priority || undefined, scope: scope || undefined,
          state: assetState || undefined, sort: sort, limit: 400,
        }).then((r) => {
          if (my !== seq.current) return
          if (!r || r.ok === false) {
            setState({ loading: false, error: (r && r.error) || '查询失败', total: 0, items: [] })
            return
          }
          setState({ loading: false, error: null, total: r.total, items: r.items || [] })
          /* C 段/统计可能因本轮采集新增：让外层重新拉一次快照，左侧分类立即更新 */
          if (onData) onData()
        }, (e) => {
          if (my === seq.current) setState({ loading: false, error: String((e && e.message) || e), total: 0, items: [] })
        })
      }, [eng, cidr, qApplied, service, port, prov, testStatus, priority, scope, assetState, sort, refreshKey])

      React.useEffect(() => {
        if (!eng || view !== 'domain') return
        setDomains(null)
        api({ op: 'domains', engagement: eng, cidr: cidr || undefined })
          .then((r) => setDomains((r && r.items) || []), () => setDomains([]))
      }, [eng, view, cidr, refreshKey])

      React.useEffect(() => {
        if (!eng || view !== 'web') return
        setWeb(null)
        api({ op: 'web', engagement: eng, cidr: cidr || undefined })
          .then((r) => setWeb((r && r.items) || []), () => setWeb([]))
      }, [eng, view, cidr, refreshKey])

      const toggleRow = (id) => {
        if (openId === id) { setOpenId(null); setDetail(null); return }
        setOpenId(id)
        setDetail(null)
        api({ op: 'asset', engagement: eng, id: id }).then((r) => {
          if (r && r.ok && r.asset) setDetail(r.asset)
        }, () => {})
      }

      const segs = (snapshot && snapshot.segments) || []
      const snapShardLocks = (snapshot && (snapshot.shardLocks || snapshot.shard_locks)) || []
      const shardLocks = snapShardLocks.length > 0 ? snapShardLocks : dagShardLocks

      const sideChildren = []
      sideChildren.push(h('div', Object.assign({
        key: 'all', className: 'rt-seg' + (cidr === null && view !== 'testing' ? ' on' : ''),
      }, clickable(() => { setView('list'); setCidr(null) }, { label: '全部 C 段', expanded: cidr === null && view !== 'testing' })),
        h('div', { className: 'rt-seg-cidr' }, '全部 C 段'),
        h('div', { className: 'rt-seg-meta' }, segs.length + ' 个网段')))
      /* 「当前测试」与 C 段分组同级：正在跑的扫描/探测是"看资产"的一部分 */
      sideChildren.push(h('div', Object.assign({
        key: 'testing', className: 'rt-seg' + (view === 'testing' ? ' on' : ''),
        title: '正在跑的扫描 / 探测与进度（5 秒自动刷新）',
      }, clickable(() => { setView('testing'); setCidr(null) }, { label: '当前测试', expanded: view === 'testing' })),
        h('div', { className: 'rt-seg-cidr', style: { display: 'flex', alignItems: 'baseline', gap: 5 } },
          h('span', { className: 'rt-scope rt-scope-testing', title: '当前测试（既非内网也非外网）' }, '测'),
          h('span', { style: { flex: 1 } }, '当前测试')),
        h('div', { className: 'rt-seg-meta' }, '正在跑的扫描与探测')))
      /* 待评估/下一步队列 */
      sideChildren.push(h('div', Object.assign({
        key: 'next', className: 'rt-seg' + (view === 'next' ? ' on' : ''),
        title: '按待测状态 + 优先级 + 端口数排序，取前 10 个模块',
      }, clickable(() => { setView('next'); setCidr(null) }, { label: '待验证模块 Top 10', expanded: view === 'next' })),
        h('div', { className: 'rt-seg-cidr', style: { display: 'flex', alignItems: 'baseline', gap: 5 } },
          h('span', { className: 'rt-scope rt-scope-testing', title: '待评估/待测队列' }, '下'),
          h('span', { style: { flex: 1 } }, '待验证模块 Top 10')),
        h('div', { className: 'rt-seg-meta' }, '待评估 ' + ((snapshot && snapshot.tests && snapshot.tests.untested) || 0) + ' 个')))
      /* C 段按内外网分组：先对外服务模块再内部服务模块 */
      const segBlock = (title, list, kind) => {
        const open = sideCollapse.isOpen('scope:' + kind, false)
        const toggle = sideCollapse.toggle('scope:' + kind, false)
        const out = [h('div', {
          key: 'h' + kind, className: 'rt-sidehead rt-sidehead-btn',
          role: 'button', tabIndex: 0, 'aria-expanded': open ? 'true' : 'false',
          title: (open ? '收起本组' : '展开本组') + '（并切回模块列表）',
          onClick: () => { setView('list'); toggle() },
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView('list'); toggle(e) } },
        },
          h('span', { className: 'rt-sec-caret' }, open ? '▾' : '▸'),
          h('span', { className: 'rt-scope rt-scope-' + kind }, kind === 'internal' ? '内部' : '对外'),
          h('span', null, title + ' · ' + list.length + ' 个 C 段'),
          h('span', { className: 'rt-spacer' }),
          h('span', { style: { fontWeight: 400 } }, list.reduce((n, x) => n + (x.assets || 0), 0) + ' 模块'))]
        if (!open) return out
        for (const s of list) {
          out.push(h('div', Object.assign({
            key: s.cidr, className: 'rt-seg' + (cidr === s.cidr ? ' on' : ''),
            title: (s.org || '未知归属') + ' · 存活 ' + (s.live || 0) + '/' + (s.assets || 0) + ' 个',
          }, clickable(() => { setView('list'); setCidr(s.cidr) },
            { label: '筛选 C 段 ' + s.cidr, expanded: cidr === s.cidr && view !== 'testing' })),
            h('div', { className: 'rt-seg-cidr', style: { display: 'flex', alignItems: 'baseline', gap: 5 } },
              h('span', { className: 'rt-scope rt-scope-' + kind }, kind === 'internal' ? '内' : '外'),
              h('span', { style: { flex: 1 } }, s.cidr),
              h('span', { className: 'rt-seg-meta', style: { margin: 0, whiteSpace: 'nowrap' } },
                s.assets + ' 个'))))
        }
        return out
      }
      const segExternal = segs.filter((x) => x.scope !== 'internal')
      const segInternal = segs.filter((x) => x.scope === 'internal')
      if (segExternal.length) sideChildren.push(...segBlock('对外服务模块', segExternal, 'external'))
      if (segInternal.length) sideChildren.push(...segBlock('内部服务模块', segInternal, 'internal'))
      const side = h('div', { className: 'rt-side' }, sideChildren)

      const toolbar = h('div', { className: 'rt-toolbar' },
        h('input', {
          className: 'rt-input', style: { flex: '1 1 150px' }, placeholder: '搜索 IP / 域名 / 指纹（回车）',
          value: q, onChange: (e) => setQ(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') setQApplied(q) },
        }),
        h('button', { className: 'rt-btn', onClick: () => setQApplied(q) }, '搜索'),
        (() => {
          const active = [service, port, prov, priority, testStatus, scope, assetState].filter(Boolean).length
          return h('button', {
            className: 'rt-btn' + (showFilters || active ? ' rt-btn-primary' : ''),
            title: '展开更多筛选：服务 / 端口 / 来源 / 优先级 / 测试状态 / 范围',
            onClick: () => setShowFilters((v) => !v),
          }, '筛选' + (active ? ' (' + active + ')' : ''))
        })(),
        showFilters ? h('input', {
          className: 'rt-input', style: { width: '78px' }, placeholder: '服务',
          value: service, onChange: (e) => setService(e.target.value),
        }) : null,
        showFilters ? h('input', {
          className: 'rt-input', style: { width: '60px' }, placeholder: '端口',
          value: port, onChange: (e) => setPort(e.target.value),
        }) : null,
        showFilters ? h('select', { className: 'rt-input', value: scope, onChange: (e) => setScope(e.target.value) },
          h('option', { value: '' }, '范围不限'),
          h('option', { value: 'external' }, '仅对外服务模块'),
          h('option', { value: 'internal' }, '仅内部服务模块')) : null,
        showFilters ? h('select', { className: 'rt-input', value: prov, onChange: (e) => setProv(e.target.value), title: '按端口来源过滤（列表已不再单列显示，详情里可见）' },
          h('option', { value: '' }, '来源不限'),
          h('option', { value: 'passive' }, '仅被动'),
          h('option', { value: 'active' }, '仅主动')) : null,
        showFilters ? h('select', { className: 'rt-input', value: priority, onChange: (e) => setPriority(e.target.value) },
          h('option', { value: '' }, '优先级不限'),
          h('option', { value: 'high' }, '高优（高）'),
          h('option', { value: 'medium' }, '一般（中）'),
          h('option', { value: 'low' }, '低优（低）')) : null,
        showFilters ? h('select', { className: 'rt-input', value: testStatus, onChange: (e) => setTestStatus(e.target.value) },
          h('option', { value: '' }, '测试状态不限'),
          h('option', { value: 'untested' }, '未测试'),
          h('option', { value: 'testing' }, '测试中'),
          h('option', { value: 'tested' }, '已测试'),
          h('option', { value: 'blocked' }, '受阻'),
          h('option', { value: 'abandoned' }, '已跳过'),
          h('option', { value: 'abandoned,blocked' }, '受阻或已跳过'),
          h('option', { value: 'no_surface' }, '无接口面')) : null,
        h('div', { className: 'rt-spacer' }),
        h('button', { className: 'rt-btn', title: '重新拉取快照与当前视图数据', onClick: () => { if (onRefresh) onRefresh() } }, '刷新'),
        h('button', { className: 'rt-btn' + (view === 'next' ? ' rt-btn-primary' : ''), title: '按待测状态 + 优先级 + 端口数排序，取前 10 个模块', onClick: () => setView('next') }, '待验证模块 Top 10'),
        h('button', { className: 'rt-btn' + (view === 'list' ? ' rt-btn-primary' : ''), onClick: () => setView('list') }, '列表'),
        h('button', { className: 'rt-btn' + (view === 'timeline' ? ' rt-btn-primary' : ''), title: '按发现时间看模块（什么时候登记、哪天新增多少）', onClick: () => setView('timeline') }, '发现时间'),
        h('button', { className: 'rt-btn' + (view === 'domain' ? ' rt-btn-primary' : ''), onClick: () => setView('domain') }, '域名'),
        h('button', { className: 'rt-btn' + (view === 'web' ? ' rt-btn-primary' : ''), onClick: () => setView('web') }, 'Web'))

      /* ── 结论行：一屏看清家底，数字点一下就是筛选 ───────────────────── */
      const tests = (snapshot && snapshot.tests) || {}
      const snapStats = (snapshot && snapshot.stats) || {}
      const PRIO_RANK = { high: 0, medium: 1, low: 2 }
      const STATUS_RANK = { untested: 0, testing: 1 }
      const nextTargets = state.items
        .filter((a) => a.test_status === 'untested' || a.test_status === 'testing')
        .slice()
        .sort((a, b) => (STATUS_RANK[a.test_status] ?? 9) - (STATUS_RANK[b.test_status] ?? 9)
          || (PRIO_RANK[a.priority] ?? 3) - (PRIO_RANK[b.priority] ?? 3)
          || (b.open_ports || 0) - (a.open_ports || 0))
        .slice(0, 10)
      const displayItems = view === 'next' ? nextTargets : state.items
      const noFilter = !testStatus && !priority && !scope && !prov && !assetState && !cidr
      const conclItem = (key, label, value, active, onClick) => h('span', Object.assign({
        key: key, className: 'rt-concl-i' + (active ? ' on' : ''), title: '点击筛选 / 再点取消',
      }, clickable(onClick, { label: '按「' + label + '」筛选（' + (value || 0) + '）', expanded: active })),
        h('b', null, String(value || 0)), h('span', null, label))
      const toggleTest = (v) => { setTestStatus((cur) => (cur === v ? '' : v)); setAssetState('') }
      const conclusion = h('div', { className: 'rt-concl' },
        conclItem('all', '个模块', snapStats.assets, noFilter, () => {
          setTestStatus(''); setPriority(''); setScope(''); setProv(''); setAssetState(''); setCidr(null)
        }),
        conclItem('live', '在线', snapStats.liveAssets, assetState === 'live', () => { setAssetState((v) => (v === 'live' ? '' : 'live')); setTestStatus('') }),
        conclItem('untested', '待测', tests.untested, testStatus === 'untested', () => toggleTest('untested')),
        conclItem('testing', '测试中', tests.testing, testStatus === 'testing', () => toggleTest('testing')),
        conclItem('tested', '已测', tests.tested, testStatus === 'tested', () => toggleTest('tested')),
        conclItem('giveup', '跳过', (tests.abandoned || 0) + (tests.blocked || 0), testStatus === 'abandoned,blocked', () => toggleTest('abandoned,blocked')),
        h('div', { className: 'rt-spacer' }),
        h('select', {
          className: 'rt-input', value: sort, onChange: (e) => setSort(e.target.value),
          title: '列表排序方式',
        },
          h('option', { value: 'priority' }, '排序：优先级优先'),
          h('option', { value: 'todo' }, '排序：待测优先'),
          h('option', { value: 'discovered' }, '排序：最近发现优先'),
          h('option', { value: 'ports' }, '排序：端口多优先'),
          h('option', { value: 'ip' }, '排序：按 IP')))

      /* ── 文件独占分片锁（ShardLock）状态条：Wave 3 并行研发防撞车可视化 ── */
      const shardLockBanner = shardLocks.length > 0
        ? h('div', { className: 'rt-card', style: { margin: '6px 10px 4px', padding: '8px 10px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 } },
              h('b', { style: { fontSize: 12 } }, '🔒 文件独占分片锁（ShardLock）'),
              h('span', { className: 'rt-tag rt-tag-live' }, '锁定中 ' + shardLocks.length + ' 项'),
              h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                'Wave 3 多智能体并发修改受独占路径保护，杜绝跨分片覆盖冲突')),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              shardLocks.slice(0, 16).map((lk, idx) => {
                const pathStr = String(lk.file_path || lk.path || lk.glob || lk.target || ('shard-' + (idx + 1)))
                const ownerStr = String(lk.worker_id || lk.owner || lk.agent || lk.role || 'exploit')
                return h('span', {
                  key: 'slk-' + idx + '-' + pathStr,
                  className: 'rt-tag rt-mono',
                  title: '独占路径：' + pathStr + ' · 持有者：' + ownerStr,
                }, pathStr + ' ← ' + ownerStr)
              })))
        : null

      const head = h('div', { className: 'rt-row head' },
        h('span', null, 'IP / 节点'), h('span', null, '优先级'), h('span', null, '测试状态'),
        h('span', null, '开放端口 / 服务'), h('span', null, '技术栈指纹'))

      const rowNodes = []
      for (const it of displayItems) {
        const openPorts = it.ports.filter((p) => p.state === 'open')
        const portText = openPorts.map((p) => p.port + (p.service ? '/' + p.service : '')).join(', ') || '—'
        const fpText = it.fingerprints.map((f) => [f.vendor, f.product, f.version].filter(Boolean).join(' ')).join(' / ') || '—'
        /* 端口最多列 3 个，其余用 +N；主被动来源不再占列，进详情 */
        const shownPorts = openPorts.slice(0, 3).map((p) => p.port + (p.service ? '/' + p.service : '')).join(', ')
        const morePorts = openPorts.length > 3 ? ' +' + (openPorts.length - 3) : ''
        rowNodes.push(h('div', Object.assign({
          key: 'r' + it.id, className: 'rt-row',
        }, clickable(() => toggleRow(it.id), { label: '展开模块 ' + it.ip, expanded: openId === it.id })),
          h('span', { className: 'rt-mono', style: { display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' } },
            h('span', {
              className: 'rt-scope rt-scope-' + (it.scope === 'internal' ? 'internal' : 'external'),
            }, it.scope === 'internal' ? '内' : '外'),
            h('span', {
              title: it.state === 'live' ? '在线' : String(it.state),
              style: {
                width: 7, height: 7, borderRadius: '50%', flex: 'none', marginTop: 4,
                background: it.state === 'live' ? '#4d6bfe' : '#94a3b8',
              },
            }),
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, it.ip),
            h('span', {
              style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
              title: '发现时间：' + (it.discovered_at ? fmt(it.discovered_at) : '未记录')
                + (it.last_seen ? '\n最近采集：' + fmt(it.last_seen) : ''),
            }, it.discovered_at ? fmtShort(it.discovered_at) : '发现时间未知')),
          h('span', null, h(PriTag, { p: it.priority, title: it.potential || '' })),
          h('span', null, h(TestTag, { s: it.test_status }),
            it.blocked_count ? h('span', { className: 'rt-tag', style: { color: '#ef4444', borderColor: '#ef444455', marginLeft: 4 } }, '阻' + it.blocked_count) : null),
          h('span', { title: portText }, (shownPorts || '—') + morePorts),
          h('span', { title: fpText }, fpText.length > 30 ? fpText.slice(0, 30) + '…' : fpText)))

        if (openId !== it.id) continue
        const d = detail && detail.id === it.id ? detail : null
        const portRows = []
        const fpRows = []
        const obsRows = []
        if (d) {
          for (const p of (d.ports || [])) {
            if (p.state !== 'open') continue
            portRows.push(h('div', { key: 'p' + p.port, className: 'rt-kv' },
              h('b', { className: 'rt-mono' }, p.port + '/' + p.proto),
              h('span', null, [p.service, p.product, p.version].filter(Boolean).join(' ') || '未知服务'),
              p.url ? h('a', { className: 'rt-link', href: p.url, target: '_blank', rel: 'noreferrer', title: p.url }, p.title ? p.title : p.url) : null,
              h(ProvTag, { p: p.provenance })))
          }
          for (const f of (d.fingerprints || [])) {
            fpRows.push(h('div', { key: 'f' + (f.product || '') + (f.version || '') + (f.evidence || ''), className: 'rt-kv' },
              h('b', null, f.category || '—'),
              h('span', null, [f.vendor, f.product, f.version].filter(Boolean).join(' ') + (f.evidence ? '（' + f.evidence + '）' : '')),
              h(ProvTag, { p: f.provenance })))
          }
          for (const o of (d.observations || []).slice(0, 8)) {
            obsRows.push(h('div', { key: 'o' + (o.attr || '') + (o.value || '') + (o.collected_at || ''), className: 'rt-kv' },
              h('b', null, o.attr || '—'),
              h('span', null, (o.value || '') + ' · ' + (o.tool || '未知工具') + ' · ' + fmt(o.collected_at)),
              h(ProvTag, { p: o.provenance })))
          }
        }
        /* 详情分三层：3 行必读 → 「展开全部」后才是溯源、原始记录与备注全文 */
        const all = showAll === it.id
        const noteLines = d && d.test_notes ? d.test_notes.split('\n').filter(Boolean) : []
        const inner = d
          ? h('div', null,
              h('div', { className: 'rt-kv' }, h('b', null, '测试'), h('span', null,
                h(TestTag, { s: d.test_status }),
                d.blocked_count ? h('span', { className: 'rt-tag', style: { marginLeft: 6, color: '#ef4444', borderColor: '#ef444455' } }, '受阻 ' + d.blocked_count + ' 次') : null,
                h('span', { style: { marginLeft: 8, color: 'var(--dsw-alias-label-secondary)' } },
                  (d.test_updated_at ? fmt(d.test_updated_at) : '未测过') + (d.test_updated_by ? ' · ' + d.test_updated_by : '')))),
              h('div', { className: 'rt-kv' }, h('b', null, '优先级'), h('span', null,
                h(PriTag, { p: d.priority }),
                h('span', { style: { marginLeft: 8 } }, d.potential || '未评估'),
                d.assess_reason ? h('span', { style: { marginLeft: 8, color: 'var(--dsw-alias-label-secondary)' } }, d.assess_reason) : null)),
              h('div', { className: 'rt-kv' }, h('b', null, '接口面'), h('span', null,
                d.test_surface || (portRows.length ? '未记录（开放端口见下）' : '无开放端口'),
                d.scope ? h('span', { className: 'rt-scope rt-scope-' + (d.scope === 'internal' ? 'internal' : 'external'), style: { marginLeft: 8 } },
                  d.scope === 'internal' ? '内部服务模块' : '对外服务模块') : null)),
              h('span', Object.assign({ className: 'rt-more' },
                clickable(() => setShowAll(all ? null : it.id), { label: all ? '收起模块详情' : '展开模块详情', expanded: all })),
                all ? '收起全部 ▲' : '展开全部（端口 · 指纹 · 采集溯源 · 测试记录）▼'),
              all ? h('div', null,
                h('div', { className: 'rt-kv' }, h('b', null, '主机名'), h('span', null, (d.names || []).map((n) => n.name).join(', ') || '—')),
                h('div', { className: 'rt-kv' }, h('b', null, '发现时间'),
                  h('span', { title: '本条模块第一次进入架构库的时刻（重复采集只刷新"最近采集"）' }, fmt(d.discovered_at)),
                  h('b', { style: { minWidth: 0, marginLeft: 8 } }, '最近采集'), h('span', null, fmt(d.last_seen)),
                  h('b', { style: { minWidth: 0, marginLeft: 8 } }, '数据源首见'), h('span', null, fmt(d.first_seen))),
                h('div', { className: 'rt-kv' }, h('b', null, 'C 段'), h('span', null, d.segment_cidr)),
                h('div', { className: 'rt-kv' }, h('b', null, '优先级'), h('span', null,
                  (d.priority || '未评估') + (d.potential ? ' · 预期：' + d.potential : '')
                  + (d.assess_reason ? ' · 依据：' + d.assess_reason : '')
                  + (d.assessed_at ? '（' + fmt(d.assessed_at) + '）' : ''))),
                h('div', { className: 'rt-kv' }, h('b', null, '来源'), h('span', null,
                  '被动端口 ' + (d.passive || 0) + ' · 主动端口 ' + (d.active || 0))),
                h('div', { style: { margin: '6px 0 3px', fontWeight: 600 } }, '开放端口 / 服务'),
                h('div', null, portRows.length ? portRows : '—'),
                h('div', { style: { margin: '6px 0 3px', fontWeight: 600 } }, '指纹'),
                h('div', null, fpRows.length ? fpRows : '—'),
                noteLines.length
                  ? h(Clip, { key: 'notes', label: '测试记录（' + noteLines.length + ' 条）', text: noteLines.join('\n') })
                  : null,
                h('div', { style: { margin: '6px 0 3px', fontWeight: 600 } }, '采集溯源（最近 8 条）'),
                h('div', null, obsRows.length ? obsRows : '—'))
                : null)
          : h('div', null, '加载中…')
        rowNodes.push(h('div', {
          key: 'd' + it.id, className: 'rt-row',
          style: { cursor: 'default', gridTemplateColumns: '1fr' },
        }, h('div', { className: 'rt-expand' }, inner)))
      }

      const listPane = h('div', { className: 'rt-table' },
        view === 'next'
          ? h('div', { className: 'rt-section', style: { padding: '8px 10px 4px' } },
              '待验证模块 Top 10 · 按待测状态 → 优先级 → 端口数排序（只列未测/测试中）')
          : null,
        head, rowNodes,
        !state.loading && !displayItems.length
          ? h('div', { className: 'rt-empty' }, view === 'next' ? '没有待验证模块了：均已完成验证或已跳过。' : '没有匹配的模块')
          : null)

      /* 域名维度：域名 → 关联资产 */
      const domainPane = h('div', { className: 'rt-table' },
        domains === null ? h('div', { className: 'rt-empty' }, '加载中…')
          : domains.length
          ? domains.map((g) => h('div', { key: g.domain },
              h('div', { className: 'rt-section', style: { padding: '8px 10px 4px' } },
                h('a', { className: 'rt-link', href: 'http://' + g.domain, target: '_blank', rel: 'noreferrer' }, g.domain),
                h('span', { className: 'rt-tag', style: { marginLeft: 8 } }, g.count + ' 个资产')),
              g.assets.map((a) => h('div', Object.assign({
                key: String(g.domain) + '\u0000' + a.id + '\u0000' + a.ip, className: 'rt-row',
                style: { gridTemplateColumns: '150px 130px 70px 1fr', cursor: 'pointer' },
              }, clickable(() => { setView('list'); setQ(''); setQApplied(a.ip) }, { label: '查看资产 ' + a.ip })),
                h('span', { className: 'rt-mono' }, a.ip),
                h('span', { className: 'rt-mono' }, a.segment),
                h('span', null, h('span', { className: 'rt-tag rt-tag-' + (a.state === 'live' ? 'live' : 'dead') }, a.state === 'live' ? '存活' : a.state)),
                h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, (a.names || []).join(', '))))))
          : h('div', { className: 'rt-empty' }, cidr ? '该 C 段下暂无域名（切换到「全部 C 段」看全量）' : '暂无域名数据（信息收集阶段会写入域名）'))

      /* Web 资产：标题 + 可直接点击的 URL */
      const webPane = h('div', { className: 'rt-table' },
        h('div', { className: 'rt-row head', style: { gridTemplateColumns: '1.6fr 1.2fr 130px 110px' } },
          h('span', null, 'URL（可点击）'), h('span', null, '标题'), h('span', null, '资产'), h('span', null, '服务')),
        (web || []).map((w) => {
          const url = w.url || ('http' + (w.port === 443 || w.port === 8443 || w.port === 9443 ? 's' : '') + '://' + w.ip + (w.port === 80 || w.port === 443 ? '' : ':' + w.port))
          return h('div', {
            key: 'w' + w.port_id, className: 'rt-row',
            style: { gridTemplateColumns: '1.6fr 1.2fr 130px 110px', cursor: 'default' },
          },
            h('a', { className: 'rt-link rt-mono', href: url, target: '_blank', rel: 'noreferrer', title: url }, url),
            h('span', { title: w.title || '' }, w.title || '—'),
            h('span', { className: 'rt-mono' }, w.ip + ' · ' + w.segment_cidr),
            h('span', { style: { fontSize: 11 } }, [w.service, w.product, w.version].filter(Boolean).join(' ')))
        }),
        web === null ? h('div', { className: 'rt-empty' }, '加载中…')
          : (!web.length ? h('div', { className: 'rt-empty' }, cidr ? '该 C 段下暂无 Web 资产' : '暂无 Web 资产（HTTP 探测后会写入 URL 与标题）') : null))

      let pane = listPane
      if (view === 'testing') pane = h(TestingTab, { engagement: eng, refreshKey: refreshKey })
      else if (view === 'domain') pane = domainPane
      else if (view === 'web') pane = webPane
      else if (view === 'timeline') pane = h(DiscoveryView, { engagement: eng, refreshKey: refreshKey })

      return h('div', { className: 'rt-split' }, side,
        h('div', { className: 'rt-main' }, view === 'testing' ? null : toolbar,
          conclusion,
          shardLockBanner,
          state.error ? h('div', { className: 'rt-err' }, state.error) : null,
          pane))
    }

    /* ---------------------------------------------------------- 资产发现时间线 */
    function DiscoveryView(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [day, setDay] = React.useState('')
      React.useEffect(() => {
        if (!eng) return
        setData(null)
        api({ op: 'discoveryTimeline', engagement: eng, limit: 200 })
          .then((r) => { if (!r || r.ok === false) setErr((r && r.error) || '加载失败'); else { setErr(null); setData(r) } },
            (e) => setErr(String((e && e.message) || e)))
      }, [eng, refreshKey])
      if (err) return h('div', { className: 'rt-pane' }, h('div', { className: 'rt-err' }, err))
      if (!data) return h('div', { className: 'rt-empty' }, '加载中…')
      const recent = (data.recent || []).filter((a) => day === '' || String(a.discovered_at || '').slice(0, 10) === day)
      return h('div', { className: 'rt-pane', style: { flex: 1, minHeight: 0 } },
        h('div', { className: 'rt-card' },
          h('h4', null, '资产发现时间线'),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
            '共 ' + ((data.span && data.span.total) || 0) + ' 台 · 最早 '
            + (data.span && data.span.first ? fmt(data.span.first) : '—')
            + ' · 最近 ' + (data.span && data.span.last ? fmt(data.span.last) : '—')
            + '（发现时间 = 第一次进入资产库的时刻；重复采集只刷新"最近采集"）')),
        (data.days || []).length === 0 ? h('div', { className: 'rt-empty' }, '还没有资产。') : null,
        h('div', { className: 'rt-card' },
          h('h4', null, '按天统计', day
            ? h('span', Object.assign({ className: 'rt-tag', style: { marginLeft: 6, cursor: 'pointer' } },
                clickable(() => setDay(''), { label: '清除按天筛选：' + day })), '清除筛选：' + day)
            : null),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            (data.days || []).map((d) => h('div', Object.assign({
              key: d.day, className: 'rt-seg' + (day === d.day ? ' on' : ''), style: { marginBottom: 0, cursor: 'pointer' },
              title: d.day + '：新增 ' + d.assets + ' 台（内网 ' + d.internal + ' / 外网 ' + d.external + '）',
            }, clickable(() => setDay(day === d.day ? '' : d.day),
              { label: '筛选 ' + d.day + ' 发现的资产', expanded: day === d.day })),
              h('div', { className: 'rt-seg-cidr' }, d.day),
              h('div', { className: 'rt-seg-meta' }, d.assets + ' 台 · 内 ' + d.internal + ' / 外 ' + d.external))))),
        h('div', { className: 'rt-card' },
          h('h4', null, day ? day + ' 发现的资产（' + recent.length + '）' : '最近发现的资产（' + recent.length + '）'),
          recent.length === 0 ? h('div', { className: 'rt-empty' }, '这一天没有新增资产。') : null,
          recent.map((a) => h('div', { key: a.id, className: 'rt-kv' },
            h('b', { className: 'rt-mono', style: { minWidth: 110 } },
              h('span', { className: 'rt-scope rt-scope-' + (a.scope === 'internal' ? 'internal' : 'external'), style: { marginRight: 4 } },
                a.scope === 'internal' ? '内' : '外'),
              a.ip),
            h('span', { style: { minWidth: 132, fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
              a.discovered_at ? fmt(a.discovered_at) : '时间未知'),
            h('span', { style: { flex: 1 } }, (a.primary_name || '—') + (a.open_ports ? ' · ' + a.open_ports + ' 端口' : '')),
            h(PriTag, { p: a.priority })))))
    }

    /* ---------------------------------------------------------- 智能体提示词 */
    function PromptsTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const selectedRole = props.selectedRole || null
      const [roles, setRoles] = React.useState([])
      const [active, setActive] = React.useState(null)
      const [draft, setDraft] = React.useState('')
      const [msg, setMsg] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [preview, setPreview] = React.useState(true)

      React.useEffect(() => {
        if (selectedRole) setActive(selectedRole)
      }, [selectedRole])

      React.useEffect(() => {
        if (!eng) return
        api({ op: 'prompts', engagement: eng }).then((r) => {
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '读取失败' }); return }
          setRoles(r.roles || [])
          if (r.roles && r.roles.length) setActive((cur) => cur || r.roles[0].role)
        }, (e) => setMsg({ err: String((e && e.message) || e) }))
      }, [eng, refreshKey])

      React.useEffect(() => {
        const r = roles.find((x) => x.role === active)
        if (r) setDraft(r.content || '')
      }, [active, roles])

      const save = () => {
        setBusy(true)
        setMsg(null)
        api({ op: 'savePrompt', engagement: eng, role: active, content: draft }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '保存失败' }); return }
          setRoles((list) => list.map((x) => (x.role === active
            ? Object.assign({}, x, { content: draft, updated_at: new Date().toISOString() })
            : x)))
          setMsg({ ok: '已保存' })
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const reset = (all) => {
        setBusy(true); setMsg(null)
        api({ op: 'resetPrompts', engagement: eng, role: all ? undefined : active }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '恢复失败' }); return }
          setMsg({ ok: '已恢复内置默认：' + (r.reset || []).join('、') })
          api({ op: 'prompts', engagement: eng }).then((rr) => {
            if (rr && rr.ok) {
              setRoles(rr.roles || [])
              const cur2 = (rr.roles || []).find((x) => x.role === active)
              if (cur2) setDraft(cur2.content || '')
            }
          }, () => {})
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const cur = roles.find((x) => x.role === active)
      const items = roles.map((r) => h('div', Object.assign({
        key: r.role, className: 'rt-item' + (active === r.role ? ' on' : ''),
      }, clickable(() => { setActive(r.role); setMsg(null) },
        { label: '查看「' + r.title + '」提示词', expanded: active === r.role })),
        h('div', { className: 'rt-item-name' }, r.title),
        h('div', { className: 'rt-item-desc' }, (r.stale ? '旧版 · ' : '') + ((r.content || '').replace(/[#*`]/g, '').slice(0, 60) || '（空）'))))

      return h('div', { className: 'rt-split' },
        h('div', { className: 'rt-list' }, items),
        h('div', { className: 'rt-main' },
          h('div', { className: 'rt-toolbar' },
            h('span', { style: { fontWeight: 600 } }, cur ? cur.title : '提示词'),
            h('span', { className: 'rt-tag' }, '更新 ' + fmt(cur && cur.updated_at)),
            cur && cur.stale ? h('span', { className: 'rt-tag rt-tag-active' }, '旧版提示词') : null,
            h('div', { className: 'rt-spacer' }),
            h('button', {
              className: 'rt-btn', disabled: busy,
              title: preview ? '切换到 Markdown 源文编辑' : '预览渲染后的提示词',
              onClick: () => setPreview((v) => !v),
            }, preview ? '编辑' : '预览'),
            h('button', {
              className: 'rt-btn', disabled: busy || !active, title: '把当前角色恢复成内置最新版提示词',
              onClick: () => reset(false),
            }, '恢复默认为当前'),
            h('button', {
              className: 'rt-btn', disabled: busy, title: '全部角色恢复成内置最新版提示词',
              onClick: () => reset(true),
            }, '全部恢复默认'),
            h('button', { className: 'rt-btn rt-btn-primary', disabled: busy || !active, onClick: save }, busy ? '保存中…' : '保存')),
          msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
          h('div', { className: 'rt-pane' },
            preview
              ? h(Markdown, {
                  className: 'rt-markdown rt-prompt-preview', text: draft || '（空）',
                  style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, maxHeight: '48vh' },
                })
              : h('textarea', {
                  className: 'rt-textarea', value: draft, spellCheck: false,
                  onChange: (e) => setDraft(e.target.value),
                  placeholder: '该角色的系统提示词（Markdown）',
                }),
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } },
              preview
                ? (cur && cur.planner
                    ? '主会话实际使用预设里的 persona；这里的 plan 文本只作人设参考，不会自动注入。'
                    : '当前是渲染预览。点「编辑」修改 Markdown 源文；保存后写入 agents/' + (active || 'role') + '.md，主会话派活时用 redteam_role_prompt 读取并写入子任务描述。')
                : (cur && cur.planner
                    ? '正在编辑主会话参考文本；它不会自动进入系统提示（主会话用预设 persona）。'
                    : '正在编辑 Markdown 源文。点「预览」看渲染效果；保存后写入 agents/' + (active || 'role') + '.md，主会话派活时用 redteam_role_prompt 读取并写入子任务描述。')))))
    }

    /* ---------------------------------------------------------- 研发技能库（DSH 原生） */
    function SkillsTab(props) {
      const refreshKey = props.refreshKey || 0
      const [items, setItems] = React.useState([])
      const [meta, setMeta] = React.useState({})
      const [err, setErr] = React.useState(null)
      const [q, setQ] = React.useState('')
      const [cat, setCat] = React.useState('')
      const [redteamOnly, setRedteamOnly] = React.useState(true)
      const [srcOnly, setSrcOnly] = React.useState(false)
      const [active, setActive] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [brokenOnly, setBrokenOnly] = React.useState(false)

      const load = (force) => {
        setBusy(true)
        api({ op: 'skillCatalog', refresh: force === true }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null)
          setMeta(r || {})
          setItems(r.items || [])
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }
      React.useEffect(load, [refreshKey])

      const open = (name) => {
        if (active === name) { setActive(null); setDetail(null); return }
        setActive(name)
        setDetail(null)
        api({ op: 'skillRead', name: name }).then((r) => {
          if (r && r.ok) setDetail(r)
          else setErr((r && r.error) || '读取失败')
        }, (e) => setErr(String((e && e.message) || e)))
      }

      const needle = q.trim().toLowerCase()
      const redteamCount = items.filter((s) => (s.category || '未分类') !== '未分类').length
      const scoped = redteamOnly ? items.filter((s) => (s.category || '未分类') !== '未分类') : items
      const cats = Array.from(new Set(scoped.map((s) => s.category || '未分类')))
      const effectiveCat = cats.includes(cat) ? cat : ''
      let filtered = needle
        ? scoped.filter((s) => (s.name + ' ' + s.description + ' ' + s.whenToUse + ' ' + (s.category || '')).toLowerCase().indexOf(needle) >= 0)
        : scoped
      if (effectiveCat) filtered = filtered.filter((s) => (s.category || '未分类') === effectiveCat)
      if (srcOnly) filtered = filtered.filter((s) => s.fromPlugin === true)
      if (brokenOnly) filtered = filtered.filter((s) => s.availability === 'broken' || s.availability === 'unknown')
      const availSummary = meta.availability ? meta.availability.summary : null
      const needRestart = err !== null && String(err).indexOf('unknown op') >= 0

      const listItems = filtered.map((s) => h('div', Object.assign({
        key: s.name,
        className: 'rt-skill-row' + (active === s.name ? ' on' : '') + (s.availability === 'broken' ? ' broken' : ''),
        title: s.name + (s.description ? ' — ' + s.description : ''),
      }, clickable(() => open(s.name), { label: '查看技能 ' + s.name, expanded: active === s.name })),
        h('span', {
          className: 'rt-avail rt-avail-' + (s.availability || 'unknown'),
          title: (s.availability === 'available'
            ? '可用：正文能加载，必需的环境变量/本机路径/基础设施都在'
            : (s.issues || []).map((x) => x.detail + (x.fix ? '\n  修复：' + x.fix : '')).join('\n')
              || (s.problems || []).join('\n') || '未知'),
        }, s.availability === 'available' ? '可用' : s.availability === 'broken' ? '不可用' : '未知'),
        h('div', { className: 'rt-skill-main' },
          h('div', { className: 'rt-skill-name' }, s.name,
            s.modelInvocable === false ? h('span', { className: 'rt-tag', style: { marginLeft: 5 } }, '仅人工') : null),
          h('div', { className: 'rt-skill-desc' }, String(s.description || '（无描述）').replace(/[*`]/g, ''))),
        h('span', { className: 'rt-tag' }, s.category || '未分类'),
        h('span', { className: 'rt-tag' }, s.fromPlugin ? '插件' : '用户'),
        (s.problems || []).length > 0 && s.availability !== 'available'
          ? h('span', { className: 'rt-avail rt-avail-broken', title: String((s.issues && s.issues[0] && s.issues[0].detail) || s.problems[0]) }, '!')
          : null))

      return h('div', { className: 'rt-split' },
        h('div', { className: 'rt-list' },
          h('input', {
            className: 'rt-input', style: { width: '100%', marginBottom: 8, boxSizing: 'border-box' },
            placeholder: '过滤技能', value: q, onChange: (e) => setQ(e.target.value),
          }),
          h('select', {
            className: 'rt-input', style: { width: '100%', marginBottom: 8, boxSizing: 'border-box' },
            value: effectiveCat, onChange: (e) => setCat(e.target.value),
          },
            h('option', { value: '' }, '全部分类（' + scoped.length + '）'),
            cats.map((c) => h('option', { key: c, value: c },
              c + '（' + scoped.filter((s) => (s.category || '未分类') === c).length + '）'))),
          h('label', { className: 'rt-kb-check', style: { display: 'flex', margin: '0 0 6px' } },
            h('input', { type: 'checkbox', checked: redteamOnly, onChange: (e) => setRedteamOnly(e.target.checked) }),
            '只看研发技能（' + redteamCount + ' 个，隐藏 DSH 通用）'),
          h('label', { className: 'rt-kb-check', style: { display: 'flex', margin: '0 0 6px' } },
            h('input', { type: 'checkbox', checked: srcOnly, onChange: (e) => setSrcOnly(e.target.checked) }),
            '只看本插件自带（' + (meta.fromPlugin || 0) + ' 个）'),
          availSummary && (availSummary.broken > 0 || availSummary.unknown > 0)
            ? h('label', {
                className: 'rt-kb-check', style: { display: 'flex', margin: '0 0 8px' },
                title: '只看不可用（缺 key / 缺本机路径 / 基础设施还是占位符）或判不了可用性的技能',
              },
                h('input', { type: 'checkbox', checked: brokenOnly, onChange: (e) => setBrokenOnly(e.target.checked) }),
                '只看不可用/未知（' + ((availSummary.broken || 0) + (availSummary.unknown || 0)) + ' 个）')
            : null,
          availSummary
            ? h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 } },
                h('span', { className: 'rt-avail rt-avail-available' }, '可用 ' + (availSummary.available || 0)),
                availSummary.broken > 0 ? h('span', { className: 'rt-avail rt-avail-broken' }, '不可用 ' + availSummary.broken) : null,
                availSummary.unknown > 0 ? h('span', { className: 'rt-avail rt-avail-unknown' }, '未知 ' + availSummary.unknown) : null,
                h('span', Object.assign({
                  className: 'rt-tag', style: { cursor: 'pointer' },
                  title: '技能正文或环境变量刚改过？点这里跳过 30 秒缓存重查',
                }, clickable(() => load(true), { label: '重新检查技能可用性' })), '重查可用性'))
            : null,
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginBottom: 6 } },
            '共 ' + items.length + ' 个技能 · 当前显示 ' + filtered.length + ' 个 · 来自 ' + ((meta.byDir || []).length) + ' 个目录',
            items.length > 100 ? h('div', { style: { marginTop: 3 } },
              '（技能多来自其它插件注册的根或你自己的技能目录；本插件只自带 ' + (meta.fromPlugin || 0) + ' 个）') : null),
          listItems),
        h('div', { className: 'rt-main' },
          h('div', { className: 'rt-toolbar' },
            h('span', { style: { fontWeight: 600 } }, detail ? detail.name : '研发技能库'),
            h('div', { className: 'rt-spacer' }),
            h('button', { className: 'rt-btn', disabled: busy, onClick: () => load(true) }, busy ? '刷新中…' : '刷新')),
          err
            ? (needRestart
                ? h('div', { className: 'rt-empty' }, '该模块的宿主代码已更新，需重启一次 dsh web 后生效')
                : h('div', { className: 'rt-err' }, err))
            : null,
          detail
            ? h('div', { className: 'rt-pane' },
                h('div', { className: 'rt-kv' }, h('b', null, '描述'), h('span', null, detail.description || '—')),
                h('div', { className: 'rt-kv' }, h('b', null, '分类'), h('span', null, detail.category || '未分类')),
                h('div', { className: 'rt-kv' }, h('b', null, '何时使用'), h('span', null, detail.whenToUse || '—')),
                h('div', { className: 'rt-kv' }, h('b', null, '来源'), h('span', null, (detail.provider || '—') + ' / ' + (detail.source || '—'))),
                (() => {
                  const s2 = items.find((x) => x.name === detail.name)
                  if (!s2) return null
                  const avail = s2.availability || 'unknown'
                  return h('div', null,
                    h('div', { className: 'rt-kv' }, h('b', null, '可用性'),
                      h('span', { className: 'rt-avail rt-avail-' + avail },
                        avail === 'available' ? '可用' : avail === 'broken' ? '不可用' : '未知（正文读不到）')),
                    (s2.issues || []).length > 0
                      ? h('div', { className: 'rt-kv' }, h('b', null, '不可用原因'),
                          h('span', null, s2.issues.map((x, i) => h('div', { key: 'i' + i, style: { marginBottom: 6 } },
                            h('div', null, '· ' + x.detail),
                            x.fix
                              ? h('div', { style: { marginLeft: 14, color: 'var(--dsw-alias-label-secondary)' } }, '修复：' + x.fix)
                              : null))))
                      : (s2.problems || []).length > 0
                        ? h('div', { className: 'rt-kv' }, h('b', null, '不可用原因'),
                            h('span', null, s2.problems.map((x, i) => h('div', { key: 'p' + i }, '· ' + x))))
                        : null,
                    (s2.needs_user || []).length > 0
                      ? h('div', { className: 'rt-kv' }, h('b', null, '需要你提供'),
                          h('span', { style: { color: 'var(--dsw-alias-state-warn-primary, #f59e0b)' } },
                            s2.needs_user.map((x, i) => h('div', { key: 'n' + i }, '· ' + x))))
                      : null)
                })(),
                detail.path ? h('div', { className: 'rt-kv' }, h('b', null, '文件'), h('span', { className: 'rt-mono', style: { wordBreak: 'break-all' } }, detail.path)) : null,
                h(Markdown, {
                  className: 'rt-markdown rt-md-view', text: detail.content || '（空）',
                  style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, maxHeight: '52vh' },
                }))
            : h('div', { className: 'rt-pane' },
                h('div', { className: 'rt-kv' }, h('b', null, '技能'),
                  h('span', null, '共 ' + items.length + ' 个'
                    + (availSummary ? ' · 可用 ' + (availSummary.available || 0)
                      + ' / 不可用 ' + (availSummary.broken || 0)
                      + ' / 未知 ' + (availSummary.unknown || 0) : ''))),
                h('div', { className: 'rt-foot', style: { marginBottom: 8 } },
                  '左侧选一个技能，查看正文、何时使用、不可用原因与修复方法。'),
                meta.availability && (meta.availability.broken || []).length > 0
                  ? h('div', { className: 'rt-hint' },
                      h('div', { style: { fontWeight: 600, marginBottom: 4 } }, '现在跑不起来的技能：'),
                      meta.availability.broken.slice(0, 12).map((b) => h('div', { key: b.name },
                        '· ' + b.name + ' — '
                        + String((b.issues && b.issues[0] && b.issues[0].detail) || (b.problems && b.problems[0]) || '未知')
                        + (b.issues && b.issues[0] && b.issues[0].fix ? '（' + b.issues[0].fix + '）' : ''))))
                  : h('div', { className: 'rt-empty' }, '没有不可用技能；左侧选择技能查看正文。'))))
    }

    /* ---------------------------------------------------------- 代码审查与缺陷 */
    const SEV_LABEL = { critical: '严重', high: '高危', medium: '中危', low: '低危', info: '信息' }
    const STATUS_LABEL = { candidate: '待验证', confirmed: '已确认', 'false-positive': '误报', exploited: '已利用', fixed: '已修复' }
    const sevClass = (s) => 'rt-sev rt-sev-' + (SEV_LABEL[s] ? s : 'info')

    /** 目标归并：按「scheme://host:port」聚合，避免带路径的 URL 把分组打散。 */
    function targetKeyOf(v) {
      const t = String(v.target || '').trim()
      if (t !== '') {
        const url = /^([a-z][a-z0-9+.-]*:\/\/[^/?#\s]+)/i.exec(t)
        if (url) return url[1]
        const head = /^([^\s/?#]+)/.exec(t)
        if (head) return head[1]
        return t
      }
      return v.asset_ip || '(未指定目标)'
    }

    /* ---------------------------------------------------------- 证据渲染 */
    function HttpBlock(props) {
      const text = String(props.text || '')
      if (!text) return null
      const lines = text.split(/\r?\n/)
      const nodes = lines.map((ln, i) => {
        let cls = null
        if (i === 0 && /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|TRACE)\s/.test(ln)) cls = 'rt-hl-req'
        else if (i === 0 && /^HTTP\//.test(ln)) cls = 'rt-hl-res'
        else if (/^[A-Za-z0-9-]+:/.test(ln)) {
          const name = ln.split(':')[0].toLowerCase()
          if (name === 'host' || name === 'cookie' || name === 'authorization' || name === 'content-type') cls = 'rt-hl-req'
        }
        return h('div', { key: 'l' + i, className: cls || undefined }, ln === '' ? '\u00a0' : ln)
      })
      return h('pre', { className: 'rt-evi-body' + (props.compact ? ' req' : '') }, nodes)
    }

    /** 缺陷详情里的证据区：结构化证据文本 + 原始 HTTP 请求/响应报文。 */
    function detailEvidence(v) {
      const evi = String(v.evidence || '').trim()
      const looksHttp = /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|HTTP\/)/m.test(evi) || /\n[A-Za-z-]+: /.test(evi)
      const blocks = []
      if (evi) {
        blocks.push(h('div', { key: 'ev', className: 'rt-evi' },
          h('div', { className: 'rt-evi-head' }, '证据摘要',
            h('span', { className: 'rt-tag' }, looksHttp ? '原始报文' : '文本'),
            h('div', { className: 'rt-spacer' }),
            h('button', {
              className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
              onClick: (e) => { e.stopPropagation(); copyText(evi) },
            }, '复制')),
          looksHttp ? h(HttpBlock, { text: evi }) : h('pre', { className: 'rt-evi-body' }, evi)))
      }
      const http = v.http_evidence || []
      for (const e of http) {
        blocks.push(h('div', { key: 'h' + e.id, className: 'rt-evi' },
          h('div', { className: 'rt-evi-head' },
            e.label || 'HTTP 证据',
            h('span', { className: 'rt-tag' }, (e.method || '') + ' ' + (e.status === null || e.status === undefined ? '' : e.status)),
            h('div', { className: 'rt-spacer' }),
            h('span', { style: { fontWeight: 400, color: 'var(--dsw-alias-label-secondary)' } }, fmt(e.captured_at || e.created_at))),
          e.request ? h('div', null,
            h('div', { className: 'rt-evi-head', style: { borderTop: 'none' } }, '▸ 请求报文（可用于接口联调复现）'),
            h(HttpBlock, { text: e.request, compact: true })) : null,
          e.response ? h('div', null,
            h('div', { className: 'rt-evi-head' }, '▸ 响应'),
            h(HttpBlock, { text: e.response })) : null,
          e.note ? h('pre', { className: 'rt-evi-body', style: { maxHeight: 80 } }, e.note) : null))
      }
      if (blocks.length === 0) {
        blocks.push(h('div', { key: 'none', className: 'rt-kv' }, h('b', null, '证据'),
          h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, '缺失 —— 未验证/无证据的记录不计入交付报告，请补 redteam_http_evidence_add')))
      }
      return h('div', { key: 'eviwrap' }, blocks)
    }

    /* ---------------------------------------------------------- 配置凭据 / 连接会话 / 构建产物 */
    function CredentialList(props) {
      const creds = props.items || []
      if (!creds.length) return h('div', { className: 'rt-empty' }, '暂无凭据（录入配置密钥或连接参数后默认脱敏展示，秒级可复用）')
      return h('div', { className: 'rt-pane' }, creds.map((c) => h('div', { key: 'c' + c.id, className: 'rt-cred' },
        h('div', { className: 'rt-cred-head' },
          h('span', { className: 'rt-cred-host' }, c.host),
          c.username ? h('span', { className: 'rt-tag' }, c.username) : null,
          h('span', { className: 'rt-tag rt-tag-passive' }, c.secret_type || 'password'),
          c.privilege ? h('span', { className: 'rt-tag rt-tag-active' }, c.privilege) : null,
          h('div', { className: 'rt-spacer' }),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: (e) => { e.stopPropagation(); copyText(String(c.secret_value || '')) },
          }, '复制')),
        h(SecretText, { value: c.secret_value, className: 'rt-secret', empty: '未记明文 —— 请补充 secret_value 后面板才能脱敏预览' }),
        h('div', { className: 'rt-cred-meta' },
          [c.source ? '来源 ' + c.source : null,
            c.tool ? '工具 ' + c.tool : null,
            c.secret_ref ? '证据 ' + c.secret_ref : null,
            c.found_by_agent ? 'by ' + c.found_by_agent : null,
            c.found_at ? fmt(c.found_at) : null].filter(Boolean).join(' · ')),
        c.note ? h('div', { className: 'rt-cred-meta' }, '备注：' + c.note) : null)))
    }

    function AccessList(props) {
      const accesses = props.items || []
      if (!accesses.length) return h('div', { className: 'rt-empty' }, '暂无访问会话')
      return h('div', { className: 'rt-pane' }, accesses.map((a) => h('div', {
        key: 'a' + a.id, className: 'rt-vrow',
        style: { cursor: 'default', gridTemplateColumns: '1fr 110px 80px 80px 1fr' },
      },
        h('span', { className: 'rt-mono' }, a.host),
        h('span', null, a.username || '—'),
        h('span', null, h('span', { className: 'rt-tag rt-tag-active' }, a.method || '—')),
        h('span', null, a.privilege || '—'),
        h('span', { className: 'rt-mono', title: a.session_ref || '' }, a.session_ref || '—'))))
    }

    function ArtifactsTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [files, setFiles] = React.useState([])
      const [creds, setCreds] = React.useState([])
      const [accesses, setAccesses] = React.useState([])
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const seqRef = React.useRef(0)

      const load = () => {
        if (!eng) return
        const my = ++seqRef.current
        setBusy(true)
        setErr(null)
        Promise.all([
          api({ op: 'attackFiles', engagement: eng }).then((r) => { if (my === seqRef.current) setFiles((r && r.items) || []) }, () => {}),
          api({ op: 'credentials', engagement: eng }).then((r) => { if (my === seqRef.current) setCreds((r && r.items) || []) }, () => {}),
          api({ op: 'access', engagement: eng }).then((r) => { if (my === seqRef.current) setAccesses((r && r.items) || []) }, () => {}),
        ]).finally(() => {
          if (my === seqRef.current) setBusy(false)
        })
      }
      React.useEffect(load, [eng, refreshKey])

      const fileCount = (files || []).reduce((n, g) => n + (g.files || []).length, 0)
      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '配置与构建产物'),
          h('span', { className: 'rt-tag' }, '环境变量与密钥 ' + creds.length),
          h('span', { className: 'rt-tag' }, '活跃服务连接 ' + accesses.length),
          h('span', { className: 'rt-tag' }, '构建与验证脚本 ' + fileCount),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '刷新中…' : '刷新')),
        err ? h('div', { className: 'rt-err' }, err) : null,
        h('div', { className: 'rt-body', style: { overflow: 'auto' } },
          h('details', { className: 'rt-card' },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '环境变量与密钥 · ' + creds.length + '（默认脱敏，点开查看）'),
            h(CredentialList, { items: creds })),
          h('details', { className: 'rt-card' },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '活跃服务连接 · ' + accesses.length),
            h(AccessList, { items: accesses })),
          h('details', { className: 'rt-card' },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, '构建与验证脚本 · ' + fileCount),
            h(AttackFilesTab, { engagement: eng, refreshKey: refreshKey }))))
    }

    function FindingsTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [sev, setSev] = React.useState('')
      const [status, setStatus] = React.useState('')
      const [gainOnly, setGainOnly] = React.useState(false)
      const [q, setQ] = React.useState('')
      const [qApplied, setQApplied] = React.useState('')
      const [state, setState] = React.useState({ loading: false, error: null, total: 0, items: [], stats: null })
      const [files, setFiles] = React.useState([])
      const [openId, setOpenId] = React.useState(null)
      const [msg, setMsg] = React.useState(null)
      /* 默认按目标模块聚合 */
      const [grouped, setGrouped] = React.useState(true)
      /* 默认只看关键缺陷：已验证或已记录影响范围 */
      const [resultsOnly, setResultsOnly] = React.useState(true)
      const collapse = useCollapse('findings:' + eng)
      const seqRef = React.useRef(0)

      const load = () => {
        if (!eng) return
        const my = ++seqRef.current
        setState((s) => Object.assign({}, s, { loading: true, error: null }))
        api({
          op: 'vulns', engagement: eng, severity: sev || undefined,
          status: status || undefined, q: qApplied || undefined, limit: 200,
        }).then((r) => {
          if (my !== seqRef.current) return
          if (!r || r.ok === false) {
            setState({ loading: false, error: (r && r.error) || '查询失败', total: 0, items: [], stats: null })
            return
          }
          setState({ loading: false, error: null, total: r.total, items: r.items || [], stats: r.stats || null })
        }, (e) => {
          if (my === seqRef.current) setState({ loading: false, error: String((e && e.message) || e), total: 0, items: [], stats: null })
        })
        api({ op: 'attackFiles', engagement: eng }).then((r) => {
          if (my === seqRef.current) setFiles((r && r.items) || [])
        }, () => {})
      }
      React.useEffect(load, [eng, sev, status, qApplied, refreshKey])

      const setVulnStatus = (id, next) => {
        setMsg(null)
        api({ op: 'updateVuln', engagement: eng, id: id, patch: { status: next } }).then((r) => {
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '更新失败' }); return }
          setMsg({ ok: '已更新为「' + (STATUS_LABEL[next] || next) + '」' })
          load()
        }, (e) => setMsg({ err: String((e && e.message) || e) }))
      }

      const stats = (state.stats && state.stats.bySeverity) ? state.stats : { bySeverity: {}, byStatus: {} }
      const needRestart = state.error !== null && String(state.error).indexOf('unknown op') >= 0
      const hasGain = (v) => {
        const g = String(v.gained || '').trim()
        return g !== '' && !/未利用|无权限|未记录|未获取|^—+$/.test(g)
      }
      const visibleItems = state.items.filter((v) => {
        if (gainOnly && !hasGain(v)) return false
        return !resultsOnly || v.status === 'exploited' || hasGain(v)
      })

      /* ── 结论行：只给结论，数字点一下就是筛选 ─────────────────────── */
      const concl = (key, label, value, active, onClick) => h('span', Object.assign({
        key: key, className: 'rt-concl-i' + (active ? ' on' : ''), title: '点击筛选 / 再点取消',
      }, clickable(onClick, { label: '按「' + label + '」筛选（' + (value || 0) + '）', expanded: active })),
        h('b', null, String(value || 0)), h('span', null, label))
      const conclusion = h('div', { className: 'rt-concl' },
        h('span', { className: 'rt-concl-group' }, '质量'),
        concl('exp', '已确认修复/验证', (stats.byStatus.exploited || 0), status === 'exploited', () => setStatus((v) => (v === 'exploited' ? '' : 'exploited'))),
        concl('gain', '影响范围', (stats.withGained || 0), gainOnly, () => setGainOnly((v) => !v)),
        h('span', { className: 'rt-concl-group' }, '等级'),
        concl('crit', '严重', (stats.bySeverity.critical || 0), sev === 'critical', () => setSev((v) => (v === 'critical' ? '' : 'critical'))),
        concl('high', '高危', (stats.bySeverity.high || 0), sev === 'high', () => setSev((v) => (v === 'high' ? '' : 'high'))),
        h('details', { className: 'rt-concl-extra' },
          h('summary', null, '已确认 ' + (stats.byStatus.confirmed || 0) + ' · 中危 ' + (stats.bySeverity.medium || 0)),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 } },
            concl('conf', '已确认', (stats.byStatus.confirmed || 0), status === 'confirmed', () => setStatus((v) => (v === 'confirmed' ? '' : 'confirmed'))),
            concl('med', '中危', (stats.bySeverity.medium || 0), sev === 'medium', () => setSev((v) => (v === 'medium' ? '' : 'medium'))))),
        h('div', { className: 'rt-spacer' }),
        h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
          '默认按模块聚合 · 当前显示 ' + visibleItems.length + ' / 共 ' + (state.total || 0) + ' 条 · ' + (stats.targetGroups || 0) + ' 个目标模块'))

      const head = h('div', { className: 'rt-vrow head' },
        h('span', null, '等级'), h('span', null, '缺陷 / 编号'), h('span', null, '目标模块'),
        h('span', null, '影响范围'), h('span', null, '状态'), h('span', null, '置信'))

      /* 构建与验证脚本按 vuln_id 建索引 */
      const allFiles = (files || []).flatMap((g) => (g.files || []).map((f) => Object.assign({ target: g.target }, f)))
      const filesByVuln = new Map()
      for (const f of allFiles) {
        const vid = f.vuln_id === null || f.vuln_id === undefined ? null : Number(f.vuln_id)
        if (vid === null) continue
        if (!filesByVuln.has(vid)) filesByVuln.set(vid, [])
        filesByVuln.get(vid).push(f)
      }

      /* 单条缺陷（行 + 展开详情），聚合视图与平铺视图共用 */
      const vulnRows = (v, compact) => {
        const out = []
        const gainedList = String(v.gained || '').split(/[、,;，；]/).map((x) => x.trim()).filter(Boolean)
        const open = openId === v.id
        out.push(h('div', {
          key: 'v' + v.id, className: 'rt-vrow', role: 'button', tabIndex: 0,
          style: compact ? { cursor: 'pointer', gridTemplateColumns: '58px minmax(0,1fr) 104px 68px' } : { cursor: 'pointer' },
          onClick: () => setOpenId(open ? null : v.id),
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(open ? null : v.id) } },
        },
          h('span', null, h('span', { className: sevClass(v.severity) }, SEV_LABEL[v.severity] || v.severity)),
          h('span', { title: v.title || '' }, h('span', { className: 'rt-sec-caret' }, open ? '▾' : '▸'), (v.cve ? v.cve + ' ' : '') + (v.title || '')),
          compact ? null : h('span', { className: 'rt-mono', title: v.target || '' }, v.target || v.asset_ip || '—'),
          h('span', { title: v.gained || '' },
            gainedList.length
              ? h('span', { className: 'rt-gain', style: { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' } }, gainedList[0] + (gainedList.length > 1 ? ' +' + (gainedList.length - 1) : ''))
              : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '—')),
          h('span', null, h('span', { className: 'rt-tag' }, STATUS_LABEL[v.status] || v.status)),
          compact ? null : h('span', null, v.confidence === null || v.confidence === undefined ? '—' : Math.round(v.confidence * 100) + '%')))
        if (openId !== v.id) return out
        out.push(h('div', {
          key: 'vd' + v.id, className: 'rt-vrow',
          style: { cursor: 'default', gridTemplateColumns: '1fr' },
        }, h('div', { className: 'rt-vdetail' },
          h('div', { className: 'rt-kv' }, h('b', null, '影响范围'),
            gainedList.length
              ? h('span', null, gainedList.map((g, gi) => h('span', { key: 'g' + gi, className: 'rt-gain', style: { marginRight: 6 } }, g)))
              : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                  '未记录 —— 验证确认影响范围后请用 redteam_vuln_update 补充 gained')),
          h('div', { className: 'rt-kv' }, h('b', null, '目标模块'), h('span', { className: 'rt-mono', style: { wordBreak: 'break-all' } }, v.target || '—')),
          h('div', { className: 'rt-kv' }, h('b', null, '所属节点'), h('span', null, (v.asset_ip || '—') + ' · ' + (v.segment_cidr || ''))),
          h('div', { className: 'rt-kv' }, h('b', null, '来源'), h('span', null, (v.source || '—') + ' · ' + (v.found_by_agent || '—') + ' · ' + fmt(v.found_at))),
          detailEvidence(v),
          (() => {
            const mine = filesByVuln.get(Number(v.id)) || []
            return h('div', { className: 'rt-kv' }, h('b', null, '构建与验证脚本'),
              mine.length
                ? h('span', null, mine.map((f, fi) => h('div', { key: 'af' + fi, style: { marginBottom: 3 } },
                    '· ' + (f.kind ? '[' + f.kind + '] ' : '') + (f.name || '(未命名)')
                    + (f.description ? ' — ' + f.description : ''),
                    h('div', { className: 'rt-mono', style: { fontSize: 11, marginLeft: 12, color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' } }, f.path || ''))))
                : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                    '（无）用 redteam_attack_file_add 把该缺陷关联的复现测试或修复脚本归档，并带上 vuln_id'))
          })(),
          h('div', { className: 'rt-actions' },
            h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setVulnStatus(v.id, 'confirmed') } }, '确认'),
            h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setVulnStatus(v.id, 'exploited') } }, '已验证'),
            h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setVulnStatus(v.id, 'false-positive') } }, '误报'),
            h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setVulnStatus(v.id, 'fixed') } }, '已修复')))))
        return out
      }

      const rows = []
      if (grouped) {
        const groups = new Map()
        for (const v of visibleItems) {
          const key = targetKeyOf(v)
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(v)
        }
        const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
        const list = Array.from(groups.entries()).map(([key, vs]) => ({
          key,
          vulns: vs,
          top: vs.slice().sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9))[0],
          gained: Array.from(new Set(vs.flatMap((v) => String(v.gained || '').split(/[、,;，；]/).map((x) => x.trim()).filter(Boolean)))),
          exploited: vs.filter((v) => v.status === 'exploited').length,
        })).sort((a, b) => (SEV_RANK[a.top.severity] ?? 9) - (SEV_RANK[b.top.severity] ?? 9) || b.vulns.length - a.vulns.length)
        for (const g of list) {
          const key = 'target:' + g.key
          const defOpen = false
          rows.push(h(Section, {
            key: 'sec:' + g.key, tone: 'target',
            title: g.key,
            count: g.vulns.length + ' 项缺陷',
            sub: [
              SEV_LABEL[g.top.severity] || g.top.severity,
              g.exploited ? '已验证 ' + g.exploited : null,
              g.top.asset_ip && g.top.asset_ip !== g.key ? '节点 ' + g.top.asset_ip : null,
            ].filter(Boolean).join(' · '),
            right: g.gained.length
              ? g.gained.slice(0, 2).join(' / ') + (g.gained.length > 2 ? ' +' + (g.gained.length - 2) : '')
              : '未记录影响范围',
            open: collapse.isOpen(key, defOpen),
            onToggle: collapse.toggle(key, defOpen),
          }, g.vulns.map((v) => vulnRows(v, true))))
        }
        if (!list.length && !state.loading && !state.error) {
          rows.push(h('div', { key: 'none', className: 'rt-empty' }, resultsOnly ? '当前没有已确认修复/验证的关键缺陷；点「显示全部」看全部审查记录。' : '暂无审查与缺陷记录'))
        }
      } else {
        for (const v of visibleItems) rows.push(...vulnRows(v))
      }

      const toolbar = h('div', { className: 'rt-toolbar' },
        h('input', {
          className: 'rt-input', style: { flex: '1 1 140px' }, placeholder: '搜索标题 / 编号 / 模块（回车）',
          value: q, onChange: (e) => setQ(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') setQApplied(q) },
        }),
        h('button', { className: 'rt-btn', onClick: () => setQApplied(q) }, '搜索'),
        h('select', { className: 'rt-input', value: sev, onChange: (e) => setSev(e.target.value) },
          h('option', { value: '' }, '全部等级'),
          h('option', { value: 'critical' }, '严重'),
          h('option', { value: 'high' }, '高危'),
          h('option', { value: 'medium' }, '中危'),
          h('option', { value: 'low' }, '低危'),
          h('option', { value: 'info' }, '信息')),
        h('select', { className: 'rt-input', value: status, onChange: (e) => setStatus(e.target.value) },
          h('option', { value: '' }, '全部状态'),
          h('option', { value: 'candidate' }, '待验证'),
          h('option', { value: 'confirmed' }, '已确认'),
          h('option', { value: 'exploited' }, '已确认修复/验证'),
          h('option', { value: 'false-positive' }, '误报'),
          h('option', { value: 'fixed' }, '已修复')),
        h('button', {
          className: 'rt-btn' + (resultsOnly ? ' rt-btn-primary' : ''),
          title: '默认只显示已验证或已记录影响范围的关键缺陷；点一下显示全部候选/已确认项',
          onClick: () => setResultsOnly((v) => !v),
        }, resultsOnly ? '只看关键缺陷 ✓' : '显示全部'))

      return h('div', { className: 'rt-main' }, toolbar, conclusion,
        h('div', { className: 'rt-subtabs' },
          h('span', { className: 'rt-subtab on' }, '审查项 ' + visibleItems.length),
          h('div', { className: 'rt-spacer' }),
          grouped ? h('button', {
            className: 'rt-btn', title: '展开所有目标模块',
            onClick: () => collapse.setAll(visibleItems.map((v) => 'target:' + targetKeyOf(v)), true),
          }, '全部展开') : null,
          grouped ? h('button', {
            className: 'rt-btn', title: '收起所有目标模块',
            onClick: () => collapse.setAll(visibleItems.map((v) => 'target:' + targetKeyOf(v)), false),
          }, '全部收起') : null,
          h('button', {
            className: 'rt-btn' + (grouped ? ' rt-btn-primary' : ''),
            title: grouped ? '当前：按目标模块聚合' : '当前：平铺每条缺陷',
            onClick: () => setGrouped((g) => !g),
          }, grouped ? '按目标聚合' : '平铺列表')),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        needRestart ? h('div', { className: 'rt-empty' }, '该模块的宿主代码已更新，需重启一次 dsh web 后生效') : null,
        state.error && !needRestart ? h('div', { className: 'rt-err' }, state.error) : null,
        h('div', { className: 'rt-table' }, grouped ? null : head, rows,
          !state.loading && !visibleItems.length && !state.error
            ? h('div', { className: 'rt-empty' }, resultsOnly ? '当前没有已确认修复/验证的关键缺陷；点「显示全部」看全部审查记录。' : '暂无审查与缺陷记录')
            : null))
    }

    /* ---------------------------------------------------------- 研发交付报告 */
    function groupByStage(reportItems, chain) {
      const byId = new Map((reportItems || []).map((x) => [x.id, x]))
      const groups = []
      const stageList = (chain && chain.stages) || []
      stageList.forEach((st, si) => {
        const items = (st.items || []).map((x) => byId.get(x.id)).filter(Boolean)
        if (items.length === 0) return
        groups.push({ code: st.code, name: st.name, color: st.color || '#64748b',
          ordinal: st.ordinal || si + 1, points: st.points || 0, cumulative: st.cumulative || 0, items })
      })
      const grouped = new Set(groups.reduce((acc, g) => acc.concat(g.items.map((x) => x.id)), []))
      const rest = (reportItems || []).filter((x) => !grouped.has(x.id))
      if (rest.length > 0) {
        groups.push({ code: 'other', name: '其他得分', color: '#64748b', ordinal: groups.length + 1,
          points: rest.reduce((n, x) => n + (x.counted ? x.points : 0), 0),
          cumulative: 0, items: rest })
      }
      return groups
    }

    /* ---------------------------------------------------------- 报告 v2：模板化页面 */
    function ReportV2(props) {
      const { report, eng, mdText, busy, load, copy, download, msg } = props
      const summary = report.summary || {}
      const table = (headers, rows) => {
        const head = h('thead', null, h('tr', null, headers.map((v, i) => h('th', { key: 'h' + i }, v))))
        const body = h('tbody', null, (rows || []).map((row, ri) => h('tr', { key: 'r' + ri },
          row.map((v, ci) => h('td', { key: 'c' + ci }, v === null || v === undefined || v === '' ? '—' : v)))))
        return h('div', { className: 'rt-r2-table-wrap' },
          h('table', { className: 'rt-r2-table' }, head, body))
      }
      const proofCard = (g) => h('div', { className: 'rt-r2-proof', key: 'proof' + (g.asset.id || g.asset.ip) },
        h('div', { className: 'rt-r2-proof-head' },
          h('b', { className: 'rt-mono' }, g.asset.ip || g.asset.primary_name || '未命名资产'),
          g.asset.primary_name ? h('span', { className: 'rt-r2-muted' }, g.asset.primary_name) : null,
          h('div', { className: 'rt-spacer' }),
          h('span', { className: 'rt-tag' }, g.type),
          h('span', { className: 'rt-tag ' + (g.strength === '强' ? 'rt-tag-live' : 'rt-tag-warn') }, '证明 ' + g.strength)),
        h('div', { className: 'rt-r2-proof-line' }, h('b', null, '归属证据 '), g.proof || '待补'),
        (g.shots || []).length > 0
          ? h(ShotStrip, { eng: eng, shots: g.shots, total: g.shots.length, title: '归属截图' })
          : h('div', { className: 'rt-r2-empty' }, '归属截图待补'))
      const proofSection = (title, list) => h('div', null,
        h('h3', { className: 'rt-r2-h3' }, title),
        (list || []).length === 0
          ? h('div', { className: 'rt-r2-empty' }, '未采集到对应资产证据。')
          : h('div', { className: 'rt-r2-proof-grid' }, list.map(proofCard)))
      const code = (text, label) => h('div', { className: 'rt-r2-code' },
        h('div', { className: 'rt-r2-code-head' },
          h('span', null, label), h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', onClick: () => copy(String(text || ''), label) }, '复制')),
        h('pre', { className: 'rt-r2-pre' }, String(text || '')))
      const reproItem = (x, heading) => h('div', { className: 'rt-r2-item', key: 'ri' + heading },
        h('h5', { className: 'rt-r2-h5' }, heading + ' ' + (x.target || x.asset_ip || '')),
        h('div', { className: 'rt-r2-item-line' },
          h('b', null, '变更说明 '),
          x.vuln ? [x.vuln.cve, x.vuln.title].filter(Boolean).join(' ') : (x.how || x.point_name)),
        x.vuln_source === 'step' ? h('div', { className: 'rt-r2-muted' }, '关联自研发执行步骤，记分时未显式填写') : null,
        x.evidence ? h('div', { className: 'rt-r2-item-line' }, h('b', null, '结果 '), x.evidence) : null,
        x.replay_cmd ? code(x.replay_cmd, /^(powershell|pwsh)/i.test(x.replay_cmd) ? 'PowerShell' : 'Bash / 命令') : null,
        (x.requests || []).slice(0, 3).map((q, qi) => q.request ? code(q.request, 'HTTP 报文 ' + (qi + 1)) : null),
        (!x.replay_cmd && !(x.requests || []).some((q) => q.request))
          ? h('div', { className: 'rt-r2-gap' }, '复现缺口：没有留存真实命令或 HTTP 报文。') : null,
        (x.attack_files || []).length > 0
          ? h('div', { className: 'rt-r2-item-line' }, h('b', null, '构建与验证脚本 '),
              h('span', { className: 'rt-mono' }, x.attack_files.map((f) => f.path).join('、'))) : null,
        (x.steps || []).some((s) => s.evidence_ref)
          ? h('div', { className: 'rt-r2-item-line' }, h('b', null, '证据文件 '),
              h('span', { className: 'rt-mono' }, Array.from(new Set(x.steps.map((s) => s.evidence_ref).filter(Boolean))).join('、'))) : null,
        (x.shots || []).length > 0 ? h(ShotStrip, { eng: eng, shots: x.shots, total: x.shots.length, title: '复现截图' }) : null,
        (x.gaps || []).length > 0 ? h('div', { className: 'rt-r2-gap' }, '复现材料：' + x.gaps.join('；')) : null)
      const reproList = (list, headingPrefix, kind) => (list || []).map((g, i) => {
        if (kind === 'boundary') {
          return h('div', { className: 'rt-r2-group', key: 'b' + i },
            h('h4', { className: 'rt-r2-h4' }, headingPrefix + (i + 1) + ' 联调通道' + (i + 1)),
            h('div', { className: 'rt-r2-item-line' }, h('b', null, '入口 '), h('span', { className: 'rt-mono' }, g.entry || '—')),
            g.tunnel
              ? h('div', { className: 'rt-r2-item-line' }, h('b', null, '通道 '), h('span', { className: 'rt-mono' },
                  (g.tunnel.kind || 'socks5') + ' ' + (g.tunnel.listen || '') + (g.tunnel.reach ? ' → ' + g.tunnel.reach : '')))
              : h('div', { className: 'rt-r2-gap' }, '通道记录缺失，需补联调证据。'),
            g.tunnel && g.tunnel.command ? code(g.tunnel.command, '通道建立命令') : null,
            g.items.map((x, j) => reproItem(x, headingPrefix + (i + 1) + '.' + (j + 1))))
        }
        if (kind === 'internet') {
          return h('div', { className: 'rt-r2-group', key: 'g' + i },
            h('h4', { className: 'rt-r2-h4' }, headingPrefix + (i + 1) + ' ' + (g.asset.ip || g.asset.primary_name || '未命名模块')),
            g.items.map((x, j) => reproItem(x, headingPrefix + (i + 1) + '.' + (j + 1))))
        }
        return h('div', { className: 'rt-r2-group', key: 's' + i },
          h('h4', { className: 'rt-r2-h4' }, headingPrefix + (i + 1) + ' ' + (g.label || '网段') + ' “' + (g.cidr || '未归属网段') + '”'),
          (g.assets || []).map((a, ai) => h('div', { className: 'rt-r2-asset', key: 'a' + ai },
            h('h5', { className: 'rt-r2-h5' }, (a.asset.ip || a.asset.primary_name || '未命名模块')),
            a.items.map((x, xi) => reproItem(x, headingPrefix + (i + 1) + '.' + (ai + 1) + '.' + (xi + 1))))))
      })
      const stageSection = (s, i) => {
        const codeStr = s.code
        const list = (report.stage_tables && report.stage_tables[codeStr]) || []
        const headers = codeStr === 'internet' ? ['序号', '里程碑项', '分值', 'URL', '凭据']
          : codeStr === 'boundary' ? ['序号', '里程碑项', '分值', '对外入口点']
            : ['序号', '里程碑项', '分值', '模块', '凭据']
        const rows = list.map((r) => codeStr === 'internet' ? [r.seq, r.point_name, '+' + r.points, r.url, r.credential]
          : codeStr === 'boundary' ? [r.seq, r.point_name, '+' + r.points, r.entry]
            : [r.seq, r.point_name, '+' + r.points, r.asset, r.credential])
        return h('div', { key: 'st' + codeStr },
          h('h3', { className: 'rt-r2-h3' }, '2.' + (i + 1) + ' ' + s.name + '（' + s.count + ' 项 / +' + s.points + ' 分）'),
          list.length === 0 ? h('div', { className: 'rt-r2-empty' }, '本阶段无里程碑项。') : table(headers, rows))
      }
      return h('div', { className: 'rt-main rt-r2' },
        h('div', { className: 'rt-toolbar rt-r2-toolbar' },
          h('span', { style: { fontWeight: 700 } }, 'LMTAgent 研发交付报告'),
          h('span', { className: 'rt-tag rt-tag-live' }, '合计 ' + summary.points + ' 分'),
          h('span', { className: 'rt-tag' }, summary.count + ' 项得分'),
          h('span', { className: 'rt-tag' + (summary.incomplete ? ' rt-tag-warn' : ' rt-tag-live') }, '可复现 ' + (summary.count - (summary.incomplete || 0)) + '/' + summary.count),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy || !mdText, onClick: () => copy(mdText, '整份报告') }, '复制全文'),
          h('button', { className: 'rt-btn', disabled: busy || !mdText, onClick: () => download(mdText, report.target || eng) }, '下载 .md'),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '生成中…' : '重新生成')),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        h('div', { className: 'rt-r2-scroll' },
          h('section', { className: 'rt-r2-section', id: 'rt-r2-assets' },
            h('h2', { className: 'rt-r2-h2' }, '一、模块与服务归属证明'),
            proofSection('1.1 对外服务模块归属证明', report.asset_proof && report.asset_proof.internet),
            proofSection('1.2 内部入口模块归属证明', report.asset_proof && report.asset_proof.internal_entry)),
          h('section', { className: 'rt-r2-section', id: 'rt-r2-scores' },
            h('h2', { className: 'rt-r2-h2' }, '二、里程碑得分汇总表'),
            table(['阶段', '计分项', '得分'], (report.stage_summary || []).map((s) => [s.name, s.count, '+' + s.points])),
            (report.stage_summary || []).map(stageSection)),
          h('section', { className: 'rt-r2-section', id: 'rt-r2-repro' },
            h('h2', { className: 'rt-r2-h2' }, '三、里程碑交付复现'),
            h('h3', { className: 'rt-r2-h3' }, '3.1 对外服务模块交付复现'),
            (report.repro && report.repro.internet || []).length === 0 ? h('div', { className: 'rt-r2-empty' }, '无对外服务模块得分项。') : reproList(report.repro.internet, '3.1.', 'internet'),
            h('h3', { className: 'rt-r2-h3' }, '3.2 跨网联调通道交付复现'),
            (report.repro && report.repro.boundary || []).length === 0 ? h('div', { className: 'rt-r2-empty' }, '无跨网联调通道得分项。') : reproList(report.repro.boundary, '3.2.', 'boundary'),
            h('h3', { className: 'rt-r2-h3' }, '3.3 内部服务模块交付复现'),
            (report.repro && report.repro.internal_segments || []).length === 0 ? h('div', { className: 'rt-r2-empty' }, '无内部服务模块得分项。') : reproList(report.repro.internal_segments, '3.3.', 'internal'))))
    }

    function ReportTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const collapse = useCollapse('report:' + eng)

      const load = () => {
        if (!eng) return
        setBusy(true); setMsg(null)
        api({ op: 'scoreReport', engagement: eng }).then((r) => {
          if (!r || r.ok === false) { setBusy(false); setErr((r && r.error) || '生成失败'); return }
          if ((!r.stages || r.stages.length === 0) && (r.items || []).length > 0) {
            api({ op: 'scoreChain', engagement: eng }).then((c) => {
              setBusy(false); setErr(null); setData(Object.assign({}, r, { stages: groupByStage(r.items, c) }))
            }, () => { setBusy(false); setErr(null); setData(r) })
            return
          }
          setBusy(false); setErr(null); setData(r)
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }
      React.useEffect(load, [eng, refreshKey])

      const copy = (text, label) => copyWithFeedback(text, label, (okFlag, message) => {
        setMsg(okFlag ? { ok: message } : { err: message })
      })
      const download = (text, label) => {
        try {
          const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          const safe = String(label || 'score')
            .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80) || 'score'
          a.download = 'report-' + safe + '.md'
          a.click()
          URL.revokeObjectURL(url)
          setMsg({ ok: '已下载：' + label })
        } catch (e) { setMsg({ err: '下载失败：' + ((e && e.message) || e) }) }
      }

      const items = (data && data.items) || []
      const stages = (data && data.stages) || []
      const summary = (data && data.summary) || null
      const mdText = (data && data.markdown) || ''
      const report = (data && data.report) || null
      if (report !== null) {
        return h(ReportV2, {
          report: report, eng: eng, mdText: mdText, busy: busy, load: load,
          copy: copy, download: download, msg: msg,
        })
      }
      const gapItems = items.filter((x) => x.incomplete === true || (Array.isArray(x.gaps) && x.gaps.length > 0))
      const gapPreview = gapItems.slice(0, 12).map((x) => h('div', {
        key: 'gap' + x.id, className: 'rt-rep-missing', style: { marginBottom: 4 },
      }, '#' + x.seq + ' ' + x.point_name + ' · ' + (x.target || x.asset_ip || '未标目标') + '：'
        + ((x.gaps || []).join('；') || '缺少复现材料')))
      const fullText = mdText
        .replace(/^<a id="[^"]*"><\/a>\s*$/gm, '')
        .replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, '> 证据截图见下方卡片视图或导出包。')
      const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']

      const card = (x) => h('div', { key: 'r' + x.id, className: 'rt-rep' },
        h('div', { className: 'rt-rep-head' },
          h('span', { className: 'rt-rep-idx' }, String(x.seq)),
          h('span', { className: 'rt-rep-name' }, x.point_name),
          h('span', { className: 'rt-flow-pts' }, '+' + x.points + ' 分'),
          x.nth_of_point > 1 ? h('span', { className: 'rt-tag' }, '同类第 ' + x.nth_of_point + ' 次') : null,
          h('div', { className: 'rt-spacer' }),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: () => copy((x.requests || []).map((v) => v.request || '').filter(Boolean).join('\n\n'), '第 ' + x.seq + ' 项请求'),
          }, '复制请求')),
        h('div', { className: 'rt-rep-meta' },
          h('span', null, h('b', null, '目标 ')), h('span', { className: 'rt-mono' }, x.target || x.asset_ip || '—')),
        x.gained ? h('div', { className: 'rt-rep-meta' }, h('b', null, '交付 '), h('span', null, x.gained)) : null,
        x.vuln ? h('div', { className: 'rt-rep-meta' }, h('b', null, '关联项 '),
          h('span', null, [x.vuln.cve, x.vuln.title].filter(Boolean).join(' ')
            + (x.vuln_source === 'step' ? '（关联自研发执行步骤）' : ''))) : null,
        x.evidence ? h('div', { className: 'rt-rep-meta' }, h('b', null, '结果 '),
          h('span', null, String(x.evidence).replace(/\n+/g, ' '))) : null,
        x.recorded_at ? h('div', { className: 'rt-rep-meta' }, h('b', null, '取得时间 '),
          h('span', null, fmt(x.recorded_at) + (x.recorded_by ? '（' + (ROLE_LABEL[x.recorded_by] || x.recorded_by) + '）' : ''))) : null,
        h(ShotStrip, { eng: eng, shots: x.shots, total: x.shot_total, title: '证据截图' }),
        h('details', { className: 'rt-rep-trace', open: x.incomplete === true || (x.steps || []).length === 0 },
          h('summary', { className: 'rt-rep-trace-head', style: { cursor: 'pointer' } },
            h('span', { className: 'rt-rep-trace-title' }, '复现步骤（点击展开）'),
            (x.steps || []).length ? h('span', { className: 'rt-tag' }, (x.steps || []).length + ' 个动作') : null,
            (x.credentials || []).length ? h('span', { className: 'rt-tag' }, (x.credentials || []).length + ' 条凭据') : null,
            (x.tunnels || []).length ? h('span', { className: 'rt-tag' }, (x.tunnels || []).length + ' 条通道') : null,
            x.incomplete ? h('span', { className: 'rt-tag rt-tag-warn' }, '复现材料待补') : h('span', { className: 'rt-tag rt-tag-live' }, '可复现')),
          h('div', { style: { paddingTop: 6 } },
            x.how ? h('div', { className: 'rt-rep-trace-how' }, x.how) : null,
            (x.steps || []).length === 0
              ? h('div', { className: 'rt-rep-missing' },
                  '本条未关联动作步骤，复现入口见上方「复现」。需要补记动作时用 redteam_chain_add（title / detail / tool / result），记分时也可带 point_code + evidence 一次完成。')
              : (x.steps || []).map((s, si) => h('div', { key: 's' + s.id, className: 'rt-rep-step' },
                  h('div', { className: 'rt-rep-step-head' },
                    h('span', { className: 'rt-rep-step-no' }, String(si + 1)),
                    h('span', { className: 'rt-rep-step-title' }, s.title || '(未命名动作)'),
                    s.agent ? h('span', { className: 'rt-tag' }, ROLE_LABEL[s.agent] || s.agent) : null,
                    s.stage_code ? h('span', { className: 'rt-tag' }, s.stage_code) : null,
                    s.inferred ? h('span', { className: 'rt-tag' }, '按同模块推断') : null,
                    h('div', { className: 'rt-spacer' }),
                    s.recorded_at ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, fmt(s.recorded_at)) : null),
                  s.detail ? h('div', { className: 'rt-rep-step-detail' }, s.detail) : null,
                  h('div', { className: 'rt-rep-step-cmd' },
                    h('b', null, '执行 '),
                    s.tool
                      ? h('span', { className: 'rt-mono' }, s.tool)
                      : h('span', { style: { color: 'var(--dsw-alias-state-warn-primary, #f59e0b)' } }, '未记录实际命令（redteam_chain_add 的 tool）')),
                  s.tool ? h('div', { style: { marginTop: 3 } },
                    h('button', {
                      className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
                      onClick: () => copy(String(s.tool), '第 ' + (si + 1) + ' 步命令'),
                    }, '复制命令')) : null,
                  s.result ? h('div', { className: 'rt-rep-step-result' }, h('b', null, '结果 '), String(s.result).replace(/\n+/g, ' ')) : null,
                  s.evidence_ref ? h('div', { className: 'rt-rep-step-result' }, h('b', null, '证据 '), h('span', { className: 'rt-mono' }, s.evidence_ref)) : null)),
            (x.credentials || []).length
              ? h('div', { className: 'rt-rep-src' },
                  h('div', { className: 'rt-rep-src-title' }, '关联凭据（来源可追溯）'),
                  (x.credentials || []).map((c) => h('div', { key: 'c' + c.id, className: 'rt-kv' },
                    h('b', { className: 'rt-mono', style: { minWidth: 120 } }, c.host || '—'),
                    h('span', null, (c.username || '(无用户名)') + ' / ' + (c.secret_type || 'password')
                      + (c.privilege ? ' · 权限 ' + c.privilege : '')
                      + ' · 来源 ' + (c.source || '未标注')
                      + (c.tool ? ' · 取得方式 ' + String(c.tool).replace(/\n+/g, ' ').slice(0, 160) : '')))))
              : null,
            (x.tunnels || []).length
              ? h('div', { className: 'rt-rep-src' },
                  h('div', { className: 'rt-rep-src-title' }, '用到的联调通道'),
                  (x.tunnels || []).map((t) => h('div', { key: 't' + t.id, className: 'rt-kv' },
                    h('b', { className: 'rt-mono', style: { minWidth: 120 } }, (t.kind || 'socks5') + ' ' + (t.listen || '')),
                    h('span', null, '入口 ' + (t.entry || '未登记')
                      + (t.reach ? ' · 可达 ' + t.reach : '')
                      + ' · 目标侧 ' + (t.entry_kind || '未声明')
                      + (t.status ? ' · ' + t.status : '')
                      + (t.command ? ' · 命令 ' + String(t.command).replace(/\n+/g, ' ').slice(0, 160) : '')))))
              : null,
            (x.webshells || []).length
              ? h('div', { className: 'rt-rep-src' },
                  h('div', { className: 'rt-rep-src-title' }, '用到的服务端点'),
                  (x.webshells || []).map((w) => h('div', { key: 'w' + w.id, className: 'rt-kv' },
                    h('b', { className: 'rt-mono', style: { minWidth: 120 } }, w.shell_type || 'endpoint'),
                    h('span', null, (w.url || ''),
                      w.pass_key ? h(React.Fragment, null, ' · 口令/密钥 ', h(SecretText, { value: w.pass_key })) : null,
                      (w.privilege ? ' · 权限 ' + w.privilege : '') + (w.status ? ' · ' + w.status : '')))))
              : null,
            (x.attack_files || []).length
              ? h('div', { className: 'rt-rep-src' },
                  h('div', { className: 'rt-rep-src-title' }, '构建脚本（可复现路径）'),
                  (x.attack_files || []).map((f) => h('div', { key: 'f' + f.id, className: 'rt-kv' },
                    h('b', { className: 'rt-mono', style: { minWidth: 120 } }, f.name || '文件'),
                    h('span', null,
                      (f.kind ? ' · ' + f.kind : '')
                      + (f.description ? ' · ' + f.description : '')
                      + ' · ',
                      h('span', { className: 'rt-mono' }, f.path || '')))))
              : null,
            (x.gaps || []).length ? h('div', { className: 'rt-rep-missing' }, '复现材料：' + x.gaps.join('；')) : null),
          (x.requests || []).length === 0
            ? h('div', { className: 'rt-rep-missing' }, '本条没有原始 HTTP 报文（该成果经命令行/其他协议取得，复现入口见上方「复现步骤」）')
            : (x.requests || []).map((r, ri) => h('div', { key: 'q' + ri, className: 'rt-rep-req' },
                h('div', { className: 'rt-rep-req-head' },
                  h('span', null, '复现请求 ' + (ri + 1) + (r.source === 'auto' ? '（按目标路径自动匹配，请核对）' : '')),
                  h('span', { className: 'rt-tag' }, (r.method || 'GET') + ' ' + (r.status === null || r.status === undefined ? '' : r.status)),
                  h('div', { className: 'rt-spacer' }),
                  h('button', {
                    className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
                    onClick: () => copy(String(r.request || ''), '请求 ' + (ri + 1)),
                  }, '复制请求报文')),
                h('pre', { className: 'rt-rep-http' }, r.request || ((r.method || 'GET') + ' ' + (r.url || '') + ' HTTP/1.1')),
                r.response ? h('div', null,
                  h('div', { className: 'rt-rep-req-head' }, h('span', null, '响应摘要')),
                  h('pre', { className: 'rt-rep-http', style: { maxHeight: 160 } }, String(r.response).slice(0, 1600))) : null)),
          x.note ? h('div', { className: 'rt-rep-meta' }, h('b', null, '备注 '), h('span', null, x.note)) : null))

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, 'LMTAgent 研发交付报告（四段式）'),
          summary ? h('span', { className: 'rt-tag rt-tag-live' }, '合计 ' + summary.points + ' 分') : null,
          summary ? h('span', { className: 'rt-tag' }, summary.count + ' 项得分') : null,
          summary ? h('span', { className: 'rt-tag' + (summary.missingRequests ? '' : ' rt-tag-live') },
            summary.withRequests + '/' + summary.count + ' 项带原始请求') : null,
          summary ? h('span', {
            className: 'rt-tag' + (summary.incomplete ? ' rt-tag-warn' : ' rt-tag-live'),
            title: '复现链是否完整：有执行步骤、写了实际命令、关联了缺陷/凭据/通道',
          }, '可复现 ' + (summary.count - (summary.incomplete || 0)) + '/' + summary.count) : null,
          summary && summary.serviceCappedExcluded
            ? h('span', {
                className: 'rt-tag rt-tag-warn',
                title: (summary.serviceCapped || []).map((x) => (x.service || '') + '｜' + (x.point_name || '')).join('\n')
                  || '同一模块同一端口的重复命中：服务已拿满，不计分、不进报告',
              }, '同服务已拿满不计分 ' + summary.serviceCappedExcluded)
            : null,
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy || !mdText, onClick: () => copy(mdText, '整份报告') }, '复制全文'),
          h('button', { className: 'rt-btn', disabled: busy || !mdText, onClick: () => download(mdText, (data && data.target) || eng) }, '下载 .md'),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '生成中…' : '重新生成')),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        err ? h('div', { className: 'rt-err' }, err) : null,
        gapItems.length
          ? h('details', {
              className: 'rt-rep-gaps',
              style: { margin: '0 0 8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: '6px 8px' },
            },
              h('summary', { style: { cursor: 'pointer', fontWeight: 600 } },
                '复现缺口 ' + gapItems.length + ' 项（点击看要补什么）'),
              h('div', { style: { marginTop: 6, maxHeight: 220, overflow: 'auto' } },
                gapPreview,
                gapItems.length > 12
                  ? h('div', { className: 'rt-foot' }, '仅列前 12 项；其余见下方每条卡片与导出的报告。')
                  : null))
          : h('div', { className: 'rt-foot', style: { marginBottom: 6 } }, '复现材料已齐：每条都有步骤/命令或原始请求。'),
        h('div', { className: 'rt-body', style: { overflow: 'auto' } },
          h('details', { className: 'rt-rep-full', style: { margin: '0 0 10px' } },
            h('summary', { className: 'rt-rep-trace-head', style: { cursor: 'pointer', fontWeight: 600 } },
              '详细报告查看（架构归属 / 里程碑汇总 / 凭据汇总 / 交付复现）'),
            h('div', { className: 'rt-rep-full-body' },
              h('div', { className: 'rt-rep-full-head' },
                h('span', { style: { fontWeight: 600 } }, '详细报告查看 · 全屏预览'),
                h('div', { className: 'rt-spacer' }),
                h('button', {
                  className: 'rt-btn',
                  onClick: (e) => {
                    const d = e.currentTarget.closest('details')
                    if (d) d.open = false
                  },
                }, '关闭')),
              h('div', { className: 'rt-foot', style: { padding: '4px 0' } },
                '这是下载/导出的同一份 Markdown；截图请在卡片视图或导出包查看。'),
              h(Markdown, { className: 'rt-markdown', text: fullText }))),
          stages.length
            ? h('div', { className: 'rt-rep-list' },
                h('div', { className: 'rt-rep-tools' },
                  h('button', { className: 'rt-btn', onClick: () => collapse.setAll(stages.map((s) => 'st:' + s.code), true) }, '全部展开'),
                  h('button', { className: 'rt-btn', onClick: () => collapse.setAll(stages.map((s) => 'st:' + s.code), false) }, '全部折叠')),
                stages.map((st) => {
                  const open = collapse.isOpen('st:' + st.code, false)
                  const toggle = collapse.toggle('st:' + st.code, false)
                  return h('div', { key: 'g' + st.code, className: 'rt-rep-group' },
                    h('div', {
                      className: 'rt-rep-stage', role: 'button', tabIndex: 0,
                      style: { borderLeftColor: st.color },
                      'aria-expanded': open ? 'true' : 'false',
                      onClick: toggle,
                      onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e) } },
                    },
                      h('span', { className: 'rt-sec-caret' }, open ? '▾' : '▸'),
                      h('span', { className: 'rt-rep-no', style: { background: st.color } }, CIRCLED[st.ordinal - 1] || st.ordinal),
                      h('span', { className: 'rt-rep-stage-name' }, st.name),
                      h('span', { className: 'rt-rep-stage-n' }, st.items.length + ' 项'),
                      h('div', { className: 'rt-spacer' }),
                      h('span', { className: 'rt-rep-pts', style: { background: st.color + '22', color: st.color, borderColor: st.color + '66' } },
                        '+' + st.points + ' 分'),
                      h('span', { className: 'rt-ap-cum' }, '累计 ' + st.cumulative + ' 分')),
                    open ? h('div', { className: 'rt-rep-body' }, st.items.map(card)) : null)
                }))
            : (data === null ? h('div', { className: 'rt-empty' }, '加载中…')
                : h('div', { className: 'rt-empty' },
                    h('div', null, '还没有可交付的里程碑成果。'),
                    h('div', { style: { marginTop: 6, fontSize: 12 } },
                      '本报告收录已达成的里程碑交付成果；达成后用 redteam_score_hit 记录里程碑得分，并补充 redteam_http_evidence_add 以便复现。')))),
        h('div', { className: 'rt-foot' },
          h('span', null, '口径：收录里程碑交付成果；下载/复制的 Markdown 按「模块归属 → 里程碑汇总 → 配置凭据 → 交付点复现」组织；凭据默认脱敏')))
    }

    /* ---------------------------------------------------------- 构建与验证脚本 */
    const FILE_KIND = { poc: '验证', exp: '自动化', script: '脚本', wordlist: '配置', other: '其他' }

    function AttackFilesTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [folders, setFolders] = React.useState([])
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const collapse = useCollapse('files:' + eng)
      const [detail, setDetail] = React.useState(null)

      const load = () => {
        if (!eng) return
        setBusy(true)
        api({ op: 'attackFiles', engagement: eng }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null)
          setFolders(r.items || [])
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }
      React.useEffect(load, [eng, refreshKey])

      const openFile = (f) => {
        if (detail && detail.id === f.id) { setDetail(null); return }
        setDetail(null)
        api({ op: 'readAttackFile', engagement: eng, id: f.id }).then((r) => {
          if (r && r.ok) setDetail(r)
          else setErr((r && r.error) || '读取失败')
        }, (e) => setErr(String((e && e.message) || e)))
      }

      const rows = []
      for (const folder of folders) {
        const fKey = 'folder:' + folder.folder
        const fileNodes = []
        for (const f of folder.files) {
          fileNodes.push(h('div', {
            key: 'a' + f.id, className: 'rt-vrow', style: { gridTemplateColumns: '18px 1.2fr 60px 1.6fr', cursor: 'pointer' },
            role: 'button', tabIndex: 0,
            onClick: () => openFile(f),
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(f) } },
          },
            h('span', { className: 'rt-sec-caret' }, detail && detail.id === f.id ? '▾' : '▸'),
            h('span', { className: 'rt-mono' }, f.name),
            h('span', null, h('span', { className: 'rt-tag rt-tag-active' }, FILE_KIND[f.kind] || f.kind || '—')),
            h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' }, title: f.description || '' }, f.description || '—')))
          if (!detail || detail.id !== f.id) continue
          fileNodes.push(h('div', {
            key: 'ad' + f.id, className: 'rt-vrow', style: { cursor: 'default', gridTemplateColumns: '1fr' },
          }, h('div', { className: 'rt-vdetail' },
            h('div', { className: 'rt-kv' }, h('b', null, '效果'), h('span', null, detail.evidence || '—')),
            h('div', { className: 'rt-kv' }, h('b', null, '路径'), h('span', { className: 'rt-mono', style: { wordBreak: 'break-all' } }, detail.path)),
            h('div', { className: 'rt-kv' }, h('b', null, '记录'), h('span', null, fmt(detail.created_at) + (detail.created_by ? ' · ' + detail.created_by : ''))),
            /\.md$/i.test(detail.name || detail.path || '')
              ? h(Markdown, {
                  className: 'rt-markdown rt-md-view', text: detail.content || '（空）',
                  style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, maxHeight: '40vh' },
                })
              : h('pre', { className: 'rt-md', style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, maxHeight: '40vh', padding: '10px 12px' } }, detail.content || '（空）'))))
        }
        rows.push(h(Section, {
          key: 'sec:' + folder.folder, tone: 'folder', title: folder.folder + '/',
          count: folder.count + ' 个文件',
          open: collapse.isOpen(fKey, true), onToggle: collapse.toggle(fKey, true),
        }, fileNodes.length ? fileNodes : h('div', { className: 'rt-atest-meta' }, '（空）')))
      }

      const total = folders.reduce((n, f) => n + f.count, 0)
      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '构建与验证脚本'),
          h('span', { className: 'rt-tag' }, folders.length + ' 个模块 / ' + total + ' 个文件'),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '刷新中…' : '刷新')),
        err ? h('div', { className: 'rt-err' }, err) : null,
        h('div', { className: 'rt-table' },
          rows,
          !folders.length ? h('div', { className: 'rt-empty' }, '暂无构建与验证脚本（工程化构建与测试脚本会按目标模块文件夹出现在这里）') : null),
        h('div', { className: 'rt-foot' }, h('span', null, '目录：attack-files/<模块|服务>/ ｜ 收录实际生效的构建与验证脚本')))
    }

    /* ---------------------------------------------------------- 工程模式与验证模板库（全局共享） */
    const POC_KIND_LABEL = { poc: '验证用例', exp: '回归脚本', script: '脚本', template: '模板', payload: '测试夹具' }
    const POC_SOURCE_LABEL = { web: '开源社区', self: '自研沉淀', manual: '人工录入', 'nuclei-template': '标准模板', kb: '模式库' }

    function KnowledgeTab(props) {
      const refreshKey = props.refreshKey || 0
      const curEng = props.engagement || ''
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [q, setQ] = React.useState('')
      const [kind, setKind] = React.useState('')
      const [category, setCategory] = React.useState('')
      const [engagement, setEngagement] = React.useState(curEng)
      const [assetTarget, setAssetTarget] = React.useState('')
      const [grouped, setGrouped] = React.useState(true)
      const [verifiedOnly, setVerifiedOnly] = React.useState(true)
      const [openId, setOpenId] = React.useState(null)
      const [detail, setDetail] = React.useState(null)
      const [detailBusy, setDetailBusy] = React.useState(false)

      const query = (over) => {
        const params = Object.assign({
          q: q.trim() || undefined,
          kind: kind || undefined,
          category: category || undefined,
          engagement: engagement || undefined,
          asset_target: assetTarget.trim() || undefined,
          verified: verifiedOnly || undefined,
        }, over || {})
        setBusy(true); setMsg(null)
        api(Object.assign({ op: 'pocSearch' }, params)).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null); setData(r)
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }

      const engRef = React.useRef(curEng)
      React.useEffect(() => {
        query(engRef.current
          ? { q: undefined, kind: undefined, category: undefined, engagement: engRef.current, asset_target: undefined, verified: true }
          : { q: undefined, kind: undefined, category: undefined, engagement: undefined, asset_target: undefined, verified: true })
      }, [refreshKey])

      React.useEffect(() => {
        if (engRef.current === curEng) return
        engRef.current = curEng
        setEngagement(curEng)
        query({ engagement: curEng || undefined })
      }, [curEng])

      const open = (id) => {
        if (openId === id) { setOpenId(null); setDetail(null); return }
        setOpenId(id); setDetail(null); setDetailBusy(true)
        api({ op: 'pocGet', id: id }).then((r) => {
          setDetailBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '读取失败' }); return }
          setDetail(r)
        }, (e) => { setDetailBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const copy = (text, label) => copyWithFeedback(text, label, (okFlag, message) => {
        setMsg(okFlag ? { ok: message } : { err: message })
      })
      const useIt = (row) => {
        api({ op: 'pocUse', id: row.id, used_on: '控制台手动标记' }).then(() => {
          setMsg({ ok: '已记一次复用：' + row.title })
          query()
        }, (e) => setMsg({ err: String((e && e.message) || e) }))
      }

      const stats = (data && data.stats) || { total: 0, verified: 0, reused: 0, byKind: [], bySource: [] }
      const items = (data && data.items) || []
      const tpl = (data && data.templates) || { dir: null, total: 0, items: [] }
      const tplItems = tpl.items || []

      const card = (x) => {
        const isOpen = openId === x.id
        const d = isOpen && detail && detail.id === x.id ? detail : null
        return h('div', { key: 'p' + x.id, className: 'rt-kb' + (isOpen ? ' open' : '') },
          h('div', {
            className: 'rt-kb-head', role: 'button', tabIndex: 0, 'aria-expanded': isOpen ? 'true' : 'false',
            onClick: () => open(x.id),
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(x.id) } },
          },
            h('span', { className: 'rt-sec-caret' }, isOpen ? '▾' : '▸'),
            h('span', { className: 'rt-kb-kind k-' + (x.kind || 'poc') }, POC_KIND_LABEL[x.kind] || x.kind || '模板'),
            h('span', { className: 'rt-kb-title' }, x.title),
            x.cve ? h('span', { className: 'rt-tag rt-tag-passive' }, x.cve) : null,
            x.component ? h('span', { className: 'rt-tag' }, x.component) : null,
            x.verified === 1
              ? h('span', { className: 'rt-tag rt-tag-live' }, '已验证')
              : h('span', { className: 'rt-tag rt-tag-warn' }, '未验证'),
            h('div', { className: 'rt-spacer' }),
            h('span', { className: 'rt-tag' }, POC_SOURCE_LABEL[x.source] || x.source || '—'),
            x.hit_count ? h('span', { className: 'rt-tag' }, '复用 ' + x.hit_count) : null),
          h('div', { className: 'rt-kb-sub' },
            [x.category ? '归类 ' + (POC_CAT_NAME[x.category] || x.category) : null,
              x.versions ? '适用版本 ' + x.versions : null,
              x.language || null,
              x.tags || null,
              '建立时间 ' + fmt(x.created_at),
              (x.engagement_name || x.engagement_id) ? '来源工作区 ' + (x.engagement_name || x.engagement_id) : null,
              x.asset_target ? '关联模块 ' + x.asset_target : null,
              x.found_by_agent ? '沉淀角色 ' + (ROLE_LABEL[x.found_by_agent] || x.found_by_agent) : null,
              x.source_url ? '来源 ' + x.source_url : null].filter(Boolean).join(' · ')),
          isOpen
            ? h('div', { className: 'rt-kb-body' },
                detailBusy && !d ? h('div', { className: 'rt-empty' }, '读取中…') : null,
                d ? h('div', null,
                  d.usage ? h('div', { className: 'rt-kv' }, h('b', null, '用法'), h('span', { className: 'rt-mono' }, d.usage)) : null,
                  d.description ? h('div', { className: 'rt-kv' }, h('b', null, '说明'), h('span', null, d.description)) : null,
                  d.verified_note ? h('div', { className: 'rt-kv' }, h('b', null, '验证证据'), h('span', null, d.verified_note)) : null,
                  d.used_on ? h('div', { className: 'rt-kv' }, h('b', null, '最近使用'), h('span', null, d.used_on)) : null,
                  d.path ? h('div', { className: 'rt-kv' }, h('b', null, '落盘'), h('span', { className: 'rt-mono' }, d.path)) : null,
                  h('div', { className: 'rt-kb-actions' },
                    h('button', { className: 'rt-btn', disabled: !d.content, onClick: () => copy(d.content || '', '模板正文') }, '复制正文'),
                    h('button', { className: 'rt-btn', onClick: () => useIt(x) }, '记一次复用'),
                    d.source_url ? h('button', { className: 'rt-btn', onClick: () => copy(d.source_url, '来源链接') }, '复制来源') : null),
                  d.content
                    ? h('pre', { className: 'rt-rep-http' }, d.content.length > 12000 ? d.content.slice(0, 12000) + '\n…（已截断，完整内容见落盘文件）' : d.content)
                    : h('div', { className: 'rt-empty' }, '这条只有元数据，没有正文 —— 拿到正文后用 redteam_poc_update 补上'))
                : null)
            : null)
      }

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '工程模式与验证模板库'),
          h('input', {
            className: 'rt-input', style: { flex: '1 1 150px', minWidth: 120 },
            placeholder: '搜 规则编号 / 组件 / 关键字', value: q,
            onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') query() },
          }),
          h('button', { className: 'rt-btn rt-btn-primary', disabled: busy, onClick: () => query() }, busy ? '检索中…' : '检索'),
          h('span', { className: 'rt-tag' }, stats.total + ' 条'),
          h('span', { className: 'rt-tag rt-tag-live' }, '已验证 ' + stats.verified),
          h('span', { className: 'rt-tag' }, '累计复用 ' + (stats.reused || 0)),
          (stats.uncategorized || 0) > 0 && (stats.uncategorized || 0) !== stats.total
            ? h('span', { className: 'rt-tag rt-tag-warn', title: '这些条目还没归类：智能体回填时用 redteam_poc_add 的 category 参数标一下' }, '未归类 ' + stats.uncategorized)
            : null,
          tpl.total ? h('span', { className: 'rt-tag rt-tag-passive' }, '本机模板 ' + tpl.total) : null,
          engagement
            ? h('span', Object.assign({
                className: 'rt-tag rt-tag-live',
                style: { cursor: 'pointer' },
                title: '只看当前工作区沉淀的模式与模板（跟随当前会话）；点一下回到全库',
              }, clickable(() => { setEngagement(''); query({ engagement: undefined }) }, { label: '取消工作区筛选：' + engagement })), '来源工作区 ' + engagement + ' ✕')
            : h('span', { className: 'rt-tag rt-tag-passive', title: '当前显示全部工作区的工程模式库；面板跟随会话后会自动筛到对应项目' }, '全库共享'),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn' + (grouped ? ' rt-btn-primary' : ''), title: '按归类分组显示 / 平铺显示', onClick: () => setGrouped(!grouped) }, grouped ? '按归类分组' : '平铺显示'),
          h('button', { className: 'rt-btn', disabled: busy, onClick: () => query() }, busy ? '检索中…' : '刷新')),
        h('div', { className: 'rt-kb-cats' },
          (stats.byCategory || []).filter((c) => c.n > 0).map((c) => h('span', Object.assign({
            key: c.code,
            className: 'rt-concl-i' + (category === c.code ? ' on' : ''),
            title: c.hint || ('筛选：' + (POC_CAT_NAME[c.code] || c.code)),
          }, clickable(() => {
            const next = category === c.code ? '' : c.code
            setCategory(next)
            query({ category: next || undefined })
          }, { label: '筛选归类：' + (POC_CAT_NAME[c.code] || c.code), expanded: category === c.code })),
            h('b', null, String(c.n || 0)),
            h('span', null, (POC_CAT_NAME[c.code] || c.code) + (c.verified ? '（已验证 ' + c.verified + '）' : ''))))),
        h('div', { className: 'rt-kb-filter' },
          h('input', {
            className: 'rt-input', style: { flex: 1, minWidth: 140 }, placeholder: '搜 规则编号 / 组件 / 关键字（正文也会搜）',
            value: q, onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') query() },
          }),
          h('select', { className: 'rt-input', style: { maxWidth: 120 }, value: category, onChange: (e) => { setCategory(e.target.value); query({ category: e.target.value || undefined }) } },
            h('option', { value: '' }, '全部归类'),
            POC_CAT_ORDER.map((k) => h('option', { key: k, value: k }, POC_CAT_NAME[k]))),
          h('input', {
            className: 'rt-input', style: { maxWidth: 160 }, list: 'rt-kb-engs',
            placeholder: '来源工作区（可搜索）', value: engagement,
            title: '输入工作区名筛选，回车或点「检索」生效；清空 = 全部来源',
            onChange: (e) => setEngagement(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') query({ engagement: engagement || undefined }) },
          }),
          h('datalist', { id: 'rt-kb-engs' },
            h('option', { value: '' }, '全部来源工作区'),
            (engagement && !(stats.byEngagement || []).some((e) => e.engagement === engagement)
              ? [h('option', { key: '__cur', value: engagement }, engagement + '（0）')]
              : []),
            (stats.byEngagement || []).map((e) => h('option', { key: e.engagement, value: e.engagement }, e.engagement + '（' + e.n + '）'))),
          h('input', {
            className: 'rt-input', style: { width: 120 }, placeholder: '关联模块筛选',
            value: assetTarget, onChange: (e) => setAssetTarget(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') query() },
          }),
          h('select', { className: 'rt-input', style: { maxWidth: 110 }, value: kind, onChange: (e) => { setKind(e.target.value); query({ kind: e.target.value || undefined }) } },
            h('option', { value: '' }, '全部类型'),
            Object.keys(POC_KIND_LABEL).map((k) => h('option', { key: k, value: k }, POC_KIND_LABEL[k]))),
          h('label', { className: 'rt-kb-check' },
            h('input', { type: 'checkbox', checked: verifiedOnly, onChange: (e) => { setVerifiedOnly(e.target.checked); query({ verified: e.target.checked || undefined }) } }),
            '只看已验证'),
          h('button', { className: 'rt-btn rt-btn-primary', onClick: () => query() }, '检索')),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        err ? h('div', { className: 'rt-err' },
          /engagement required|unknown op/i.test(err)
            ? '工程模式库接口由 host 侧提供，当前 dsh web 还是旧进程 —— 请重启 dsh web（dsh-restart）后刷新页面。'
            : err) : null,
        h('div', { className: 'rt-table' },
          (() => {
            if (!grouped) return items.map(card)
            const buckets = new Map()
            for (const x of items) {
              const code = POC_CAT_NAME[x.category] ? x.category : 'other'
              if (!buckets.has(code)) buckets.set(code, [])
              buckets.get(code).push(x)
            }
            const order = POC_CAT_ORDER.filter((c) => buckets.has(c))
            for (const code of buckets.keys()) if (!order.includes(code)) order.push(code)
            const out = []
            for (const code of order) {
              const list = buckets.get(code)
              out.push(h('div', { key: 'g' + code, className: 'rt-kb-cat' },
                h('span', { className: 'rt-kb-cat-name' }, POC_CAT_NAME[code] || code),
                h('span', { className: 'rt-tag' }, list.length + ' 条'),
                h('span', { className: 'rt-tag rt-tag-live' }, '已验证 ' + list.filter((x) => x.verified === 1).length),
                h('span', { className: 'rt-spacer' }),
                h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                  '最近建立 ' + fmt(list.map((x) => x.created_at).filter(Boolean).sort().pop()))))
              for (const x of list) out.push(card(x))
            }
            return out
          })(),
          tplItems.length
            ? h('div', { className: 'rt-kb-tpl' },
                h('div', { className: 'rt-ap-sub' },
                  '本机标准模板命中 · ' + tplItems.length + ' 条'),
                tplItems.map((t, i) => h('div', { key: 't' + i, className: 'rt-kb-tpl-row' },
                  h('span', { className: 'rt-tag' }, t.severity || '—'),
                  h('span', { className: 'rt-mono rt-kb-tpl-path', title: t.path }, t.path),
                  h('span', { className: 'rt-kb-tpl-name', title: t.name }, t.name || ''),
                  h('button', {
                    className: 'rt-btn', style: { padding: '0 6px', fontSize: 10.5 },
                    onClick: () => copy(t.path, '模板路径'),
                  }, '复制路径'))),
                tpl.dir ? h('div', { className: 'rt-foot' }, h('span', null, '模板目录：' + tpl.dir)) : null)
            : null,
          data === null ? h('div', { className: 'rt-empty' }, '加载中…') : null,
          data !== null && !items.length && !tplItems.length
            ? h('div', { className: 'rt-empty' },
                h('div', null, q || kind || verifiedOnly ? '没有命中：换个关键字再试，或沉淀新的工程模式后回填。' : '工程模式库还是空的。'),
                h('div', { style: { marginTop: 6, fontSize: 12 } },
                  '标准研发复用流程：① redteam_poc_search 先检索已沉淀模式与验证模板 → ② 研发或回归验证通过后调用 redteam_poc_add 回填，后续项目可直接复用。'))
            : null),
        h('div', { className: 'rt-foot' },
          h('span', null, '全局共享（跨工作区）｜ 落盘：pocs/<code>/ ｜ 收录通用可复用的架构模式与验证模板，模块专用脚本走「构建脚本」')))
    }

    /* ---------------------------------------------------------- 交付里程碑 */
    function ScoreTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [openId, setOpenId] = React.useState(null)
      const [scoreView, setScoreView] = React.useState('achieved')
      const [form, setForm] = React.useState(null)
      const [msg, setMsg] = React.useState(null)

      const load = () => {
        if (!eng) return
        setBusy(true)
        api({ op: 'scores', engagement: eng }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null)
          setData(r)
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
      }
      React.useEffect(load, [eng, refreshKey])

      const startEdit = (p) => setForm({
        id: p.id, name: p.name, category: p.category || '', points: p.points,
        description: p.description || '', enabled: p.enabled, builtin: p.builtin === true,
        src: p.src, cap: p.cap, rule: p.rule,
      })
      const startNew = () => { setForm({ name: '', category: '', points: 10, description: '', enabled: true, builtin: false }); setMsg(null) }
      const setField = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }))

      const save = () => {
        if (!form || !form.name) { setMsg({ err: '名称不能为空' }); return }
        setBusy(true)
        setMsg(null)
        api({ op: 'saveScorePoint', engagement: eng, point: form }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '保存失败' }); return }
          if (r.overridden === false) {
            setMsg({ err: '已保存「启用/停用」。分值未改动：这是随《软件工程 4-Wave 交付质量门禁规范》分发的内置里程碑项，'
              + '权重 / 上限 / 验收口径由规范锁定。要自定义里程碑项时请「+ 新增里程碑」。' })
          } else {
            setMsg({ ok: r.note || '已保存' })
          }
          setForm(null)
          load()
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }
      const remove = () => {
        if (!form || !form.id) { setForm(null); return }
        setBusy(true)
        setMsg(null)
        api({ op: 'deleteScorePoint', engagement: eng, id: form.id }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '删除失败' }); return }
          setMsg({ ok: '已删除' })
          setForm(null)
          setOpenId(null)
          load()
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const summary = (data && data.summary) || { achievedPoints: 0, pointCount: 0, hitPointCount: 0, hitCount: 0, selfCreatedHits: 0, serviceCappedHits: 0 }
      const items = (data && data.items) || []

      const groups = (data && data.ruleGroups && data.ruleGroups.length)
        ? data.ruleGroups
        : [{ key: 'all', name: '', capSum: 0, points: 0, counted: 0, tiers: items }]
      const tierFull = (p) => p.cap > 0 && (Number(p.cap_used) || 0) >= Number(p.cap)
      const tierAchieved = (p) => (Array.isArray(p.hits) && p.hits.length > 0)
        || (Number(p.earned) || 0) > 0 || (Number(p.counted) || 0) > 0
      const scoreRank = (p) => (tierFull(p) ? 1 : 0)
      const scoreCmp = (a, b) => scoreRank(a) - scoreRank(b)
        || (Number(b.points) || 0) - (Number(a.points) || 0)
        || (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
      const orderedGroups = groups.map((g) => Object.assign({}, g, {
        tiers: g.tiers.slice().sort(scoreCmp),
      }))
      const groupGap = (g) => (g.tiers.some((p) => !tierFull(p)) ? 0 : 1)
      const groupMax = (g) => g.tiers.reduce((m, p) => Math.max(m, Number(p.points) || 0), 0)
      orderedGroups.sort((a, b) => groupGap(a) - groupGap(b) || groupMax(b) - groupMax(a))
      const shortName = (name) => {
        const base = String(name || '').split(' / ')[0]
        return base.length > 22 ? base.slice(0, 22) + '…' : base
      }
      const gapGroups = []
      let gapLeft = 8
      for (const g of orderedGroups) {
        const tiers = g.tiers.filter((p) => !tierFull(p))
        if (!tiers.length) continue
        const take = tiers.slice(0, gapLeft)
        gapGroups.push(Object.assign({}, g, { tiers: take }))
        gapLeft -= take.length
        if (gapLeft <= 0) break
      }
      const achievedGroups = orderedGroups
        .map((g) => Object.assign({}, g, { tiers: g.tiers.filter(tierAchieved) }))
        .filter((g) => g.tiers.length > 0)
      const displayGroups = scoreView === 'achieved'
        ? achievedGroups
        : scoreView === 'gap'
          ? gapGroups
          : orderedGroups
      const rows = []
      for (const g of displayGroups) {
        if (g.name) {
          rows.push(h('div', { key: 'g-' + g.key, className: 'rt-score-group' },
            h('span', null, g.name),
            h('span', { className: 'rt-sg-sub' },
              g.tiers.length + ' 项'
              + (g.capSum > 0 ? ' · 上限独立，不跨项累加' : '')),
            h('div', { className: 'rt-spacer' }),
            g.points > 0
              ? h('span', { className: 'rt-tag rt-tag-active' }, '+' + g.points + ' 分')
              : null))
        }
        for (const p of g.tiers) {
          const achieved = p.hits.length > 0
          const open = openId === p.id
          rows.push(h('div', {
            key: 'sp' + p.id, className: 'rt-score-row', role: 'button', tabIndex: 0,
            onClick: () => setOpenId(open ? null : p.id),
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(open ? null : p.id) } },
          },
            h('span', { className: 'rt-sec-caret' }, open ? '▾' : '▸'),
            h('span', null, h('span', {
              className: achieved ? 'rt-pri rt-pri-high' : 'rt-pri rt-pri-low',
              style: achieved ? {} : { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)' },
            }, p.points + '分')),
            h('span', { title: p.name + (p.description ? '\n' + p.description : '') },
              shortName(p.name)),
            h('span', { title: p.capped > 0
              ? '已计入 ' + p.counted + ' 次，另有 ' + p.capped + ' 条因「' + (p.scope_label || '验收口径') + '」或已达上限不计分'
              : (p.scope_label || '') },
              h('span', { className: 'rt-sec-count' }, p.hits.length > 0 ? p.counted + ' 次达成' : '未达成'),
              p.cap > 0
                ? h('span', { className: 'rt-scope' }, '　额度已用 ' + (p.cap_used === null ? 0 : p.cap_used) + '/' + p.cap)
                : null),
            h('span', { style: { textAlign: 'right' } }, p.earned > 0
              ? h('span', { className: 'rt-tag rt-tag-active' }, '+' + p.earned + ' 分')
              : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '—'))))
          if (!open) continue
          const hitNodes = p.hits.map((hh, hi) => h('div', {
            key: 'h' + hh.id,
            className: 'rt-hit-row' + (hh.self_created ? ' self-created' : '') + (hh.capped ? ' service-capped' : ''),
          },
            h('span', { className: 'rt-hit-idx' }, String(hi + 1)),
            h('span', { className: 'rt-hit-asset', title: hh.target || hh.asset_ip || '' },
              hh.asset_ip || hh.target || '未指定模块'),
            hh.self_created ? h('span', { className: 'rt-tag rt-tag-warn', title: '自建测试环境记录，只作过程留痕' }, '测试记录 · 不计分') : null,
            hh.capped ? h('span', {
              className: 'rt-tag rt-tag-warn',
              title: hh.capped_reason || '同一模块同一服务端点只计最高权重一条',
            }, '模块已封顶 · 不计分' + (hh.service ? '（' + hh.service + '）' : '')) : null,
            hh.shot_count ? h('span', { className: 'rt-tag', title: '这条记录附有验收截图' },
              '图 ' + hh.shot_count) : null,
            h('span', { className: 'rt-hit-time' }, fmt(hh.recorded_at)),
            h('button', {
              className: 'rt-btn', style: { padding: '0 5px', fontSize: 10.5 },
              title: '复制这一条',
              onClick: (e) => {
                e.stopPropagation()
                copyText((hh.asset_ip || hh.target || '') + '  ' + (hh.evidence || ''))
              },
            }, '复制'),
            hh.evidence
              ? h('span', { className: 'rt-hit-txt', title: hh.evidence }, String(hh.evidence).replace(/\n+/g, ' '))
              : h('span', { className: 'rt-hit-txt none' }, '未填验收摘要')))
          rows.push(h('div', {
            key: 'spd' + p.id, className: 'rt-score-row',
            style: { cursor: 'default', gridTemplateColumns: '1fr' },
          }, h('div', { className: 'rt-score-detail' },
            p.description ? h('div', { className: 'rt-kv' }, h('b', null, '验收条件'), h('span', null, p.description)) : null,
            h('div', { className: 'rt-kv' }, h('b', null, '状态'),
              h('span', null, (p.enabled ? '启用' : '停用') + ' · ' + p.points + ' 分/次 · 达成 ' + p.hits.length +
                ' 次 = ' + p.earned + ' 分' + (p.self_created ? '（另有 ' + p.self_created + ' 次测试记录不计分）' : '') +
                (p.capped ? '（另有 ' + p.capped + ' 次同模块重复达成不计分）' : ''))),
            p.capped
              ? h('div', { className: 'rt-kv' }, h('b', null, '模块封顶'),
                  h('span', null, p.service_summary + '；同一模块与服务端点按最高里程碑权重只计一次'))
              : null,
            p.hits.length
              ? h('div', null,
                  h(ShotStrip, { eng: eng, shots: p.shots, total: p.shot_total,
                    title: '验收截图 · ' + (p.shot_total || (p.shots || []).length) + ' 张' }),
                  h('div', { className: 'rt-section', style: { padding: '6px 0 0' } },
                    '达成记录 · ' + p.hits.length + '（详细验证见交付报告）'),
                  h('div', { className: 'rt-hits' }, hitNodes))
              : h('div', { className: 'rt-kv' }, h('b', null, '达成记录'),
                  h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                    '还没有 —— 完成里程碑验收后调用 redteam_score_hit 记录目标模块与验证证据')),
            h('div', { className: 'rt-actions' },
              h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); startEdit(p) } }, '编辑')))))
        }
      }

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '交付里程碑'),
          h('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginLeft: 4 } }, '总分'),
          h('span', { className: 'rt-total' }, String(summary.achievedPoints)),
          h('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, '分'),
          h('span', { className: 'rt-tag' }, summary.pointCount + ' 个里程碑项'),
          h('span', { className: 'rt-tag' }, '达成 ' + summary.countedHits + ' 次'),
          summary.selfCreatedHits
            ? h('span', {
                className: 'rt-tag rt-tag-warn',
                title: '自建测试记录只作过程留痕（不计分、不占上限）',
              }, '测试记录不计分 ' + summary.selfCreatedHits)
            : null,
          summary.serviceCappedHits
            ? h('span', {
                className: 'rt-tag rt-tag-warn',
                title: '按「同模块同端口」只计一次：该服务已封顶，重复记录不计分',
              }, '服务已封顶不计分 ' + summary.serviceCappedHits)
            : null,
          h('div', { className: 'rt-spacer' }),
          h('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
            h('button', {
              className: 'rt-btn' + (scoreView === 'achieved' ? ' rt-btn-primary' : ''),
              title: '只显示已经达成的里程碑项',
              onClick: () => setScoreView('achieved'),
            }, '已达成' + (summary.hitPointCount ? ' ' + summary.hitPointCount : '')),
            h('button', {
              className: 'rt-btn' + (scoreView === 'gap' ? ' rt-btn-primary' : ''),
              title: '只显示未达成的核心里程碑缺口（前 8 项）',
              onClick: () => setScoreView('gap'),
            }, '待交付缺口'),
            h('button', {
              className: 'rt-btn' + (scoreView === 'all' ? ' rt-btn-primary' : ''),
              title: '显示全部 ' + items.length + ' 个里程碑项',
              onClick: () => setScoreView('all'),
            }, '全部 ' + items.length)),
          h('button', { className: 'rt-btn', onClick: startNew }, '+ 新增里程碑'),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '刷新中…' : '刷新')),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        err ? h('div', { className: 'rt-err' }, err) : null,
        form ? h('div', { className: 'rt-pane', style: { flex: 'none', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
          form.builtin
            ? h('div', { className: 'rt-hint', style: { marginBottom: 8 } },
                h('b', null, '内置里程碑项（来自《软件工程 4-Wave 交付质量门禁规范》）'),
                h('div', { style: { marginTop: 3 } },
                  '权重、上限、验收口径与名称由规范锁定。这里可以改「启用 / 停用」；'
                  + '要自定义里程碑项时请返回上一屏点「+ 新增里程碑」。'),
                form.src !== null && form.src !== undefined
                  ? h('div', { style: { marginTop: 3, color: 'var(--dsw-alias-label-secondary)' } },
                      '规范序号 ' + form.src + (form.rule ? '　·　分组 rule=' + form.rule : '')
                      + (form.cap > 0 ? '　·　上限 ' + form.cap + ' 分' : '　·　不设上限'))
                  : null)
            : null,
          h('div', { className: 'rt-score-form' },
            h('input', {
              className: 'rt-input', placeholder: '名称（必填）', value: form.name,
              readOnly: form.builtin === true,
              title: form.builtin ? '内置里程碑项的名称由规范锁定' : '',
              onChange: (e) => setField('name', e.target.value),
            }),
            h('input', {
              className: 'rt-input', placeholder: '分类，如 架构与核心模块', value: form.category,
              readOnly: form.builtin === true,
              title: form.builtin ? '内置里程碑项的分类由规范锁定' : '',
              onChange: (e) => setField('category', e.target.value),
            }),
            h('input', {
              className: 'rt-input', type: 'number', placeholder: '单次权重',
              readOnly: form.builtin === true,
              title: form.builtin
                ? '内置里程碑项的分值由规范锁定，不能在这里改'
                : '这一类的单次权重分值',
              value: form.points, onChange: (e) => setField('points', Number(e.target.value)),
            }),
            h('select', { className: 'rt-input', value: form.enabled ? '1' : '0', onChange: (e) => setField('enabled', e.target.value === '1') },
              h('option', { value: '1' }, '启用'),
              h('option', { value: '0' }, '停用'))),
          h('input', {
            className: 'rt-input', style: { width: '100%', marginBottom: 6, boxSizing: 'border-box' },
            placeholder: '验收条件说明', value: form.description,
            readOnly: form.builtin === true,
            title: form.builtin ? '内置里程碑项的条款正文由规范锁定' : '',
            onChange: (e) => setField('description', e.target.value),
          }),
          h('div', { className: 'rt-actions' },
            h('button', { className: 'rt-btn rt-btn-primary', disabled: busy, onClick: save }, '保存'),
            form.id
              ? (form.builtin
                  ? h('button', {
                      className: 'rt-btn', disabled: true,
                      title: '内置里程碑项不能删除，要让它不参与计分请改用「停用」。',
                    }, '删除（内置项不可删）')
                  : h('button', { className: 'rt-btn', disabled: busy, onClick: remove }, '删除'))
              : null,
            h('button', { className: 'rt-btn', onClick: () => setForm(null) }, '取消'))) : null,
        h('div', { className: 'rt-foot', style: { padding: '2px 12px 0' } },
          scoreView === 'achieved'
            ? (achievedGroups.length
                ? '默认只显示已经达成的里程碑项（' + summary.hitPointCount + ' 项）；待交付缺口 / 完整列表可切换。'
                : '还没有已达成的里程碑项；切到「待交付缺口」查看待推进目标。')
            : scoreView === 'gap'
              ? '只显示未拿满的前 8 项；完整 ' + items.length + ' 项点「全部」。'
              : '完整 ' + items.length + ' 个里程碑项。'),
        h('div', { className: 'rt-table' },
          h('div', { className: 'rt-score-row head' },
            h('span', null, ''), h('span', null, '分值'), h('span', null, scoreView === 'achieved' ? '已达成项目' : scoreView === 'gap' ? '待交付缺口' : '全部里程碑项'),
            h('span', null, '达成 / 规范上限'), h('span', { style: { textAlign: 'right' } }, '已得分')),
          rows,
          !items.length ? h('div', { className: 'rt-empty' }, '暂无里程碑项，点右上角「新增里程碑」') : null,
          items.length && !rows.length ? h('div', { className: 'rt-empty' }, scoreView === 'achieved' ? '还没有已达成的里程碑项；点「待交付缺口」查看下一步目标。' : '当前视图没有可显示的里程碑项。') : null))
    }

    /* ---------------------------------------------------------- 当前验证（实时） */
    const TEST_STATUS_LABEL = {
      untested: '待验证', testing: '验证中', tested: '已验证',
      blocked: '受阻', abandoned: '已跳过', no_surface: '无需验证',
    }

    function TestingTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [at, setAt] = React.useState(null)
      const [auto, setAuto] = React.useState(true)
      const collapse = useCollapse('testing:' + eng)

      const inflight = React.useRef(false)
      const seq = React.useRef(0)
      const load = () => {
        if (!eng || inflight.current) return
        inflight.current = true
        const my = ++seq.current
        api({ op: 'activeTests', engagement: eng, limit: 20 }).then((r) => {
          if (my !== seq.current) return
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null); setData(r); setAt(new Date())
        }, (e) => { if (my === seq.current) setErr(String((e && e.message) || e)) })
          .finally(() => { if (my === seq.current) inflight.current = false })
      }
      React.useEffect(() => { seq.current += 1; load() }, [eng, refreshKey])
      React.useEffect(() => {
        if (!eng || !auto) return undefined
        const timer = setInterval(load, 5000)
        return () => clearInterval(timer)
      }, [eng, auto, refreshKey])

      const testing = (data && data.testing) || []
      const recent = (data && data.recent) || []
      const queue = (data && data.queue) || []
      const stats = (data && data.stats) || {}

      const card = (a, past) => {
        const chips = []
        chips.push(h('span', { key: 'sc', className: 'rt-scope rt-scope-' + (a.scope === 'internal' ? 'internal' : 'external') },
          a.scope === 'internal' ? '核心模块' : '外部接口'))
        if (a.segment_cidr) chips.push(h('span', { key: 'seg', className: 'rt-tag' }, a.segment_cidr))
        if (a.open_ports) chips.push(h('span', { key: 'p', className: 'rt-tag rt-tag-active' }, '开放 ' + a.open_ports + ' 端口'))
        if (a.vulns) chips.push(h('span', { key: 'v', className: 'rt-tag rt-tag-live' }, '已确认问题 ' + a.vulns))
        if (a.webshells) chips.push(h('span', { key: 'w', className: 'rt-tag rt-tag-passive' }, '服务端点 ' + a.webshells))
        if (a.tunnels) chips.push(h('span', { key: 't', className: 'rt-tag rt-tag-passive' }, '联调通道 ' + a.tunnels))
        if (a.priority) chips.push(h('span', { key: 'pr', className: 'rt-tag' }, '优先级 ' + a.priority))
        if (a.blocked_count) chips.push(h('span', { key: 'b', className: 'rt-tag', style: { color: '#ef4444', borderColor: '#ef444455' } }, '阻塞 ' + a.blocked_count + ' 次'))
        const noteLines = a.test_notes
          ? String(a.test_notes).split('\n').slice(-3).map((l) => (l.length > 240 ? l.slice(0, 240) + ' …' : l))
          : []
        return h('div', { key: 'at' + a.id, className: 'rt-atest' + (past ? ' past' : '') },
          h('div', { className: 'rt-atest-head' },
            past ? null : h('span', { className: 'rt-live-dot' }),
            h('span', { className: 'rt-atest-ip' }, a.ip),
            h('span', { className: 'rt-tag ' + (a.test_status === 'testing' ? 'rt-tag-live' : '') }, TEST_STATUS_LABEL[a.test_status] || a.test_status),
            h('div', { className: 'rt-spacer' }),
            h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
              fmt(a.test_updated_at) + (a.test_updated_by ? ' · ' + a.test_updated_by : ''))),
          chips.length ? h('div', null, chips) : null,
          a.test_surface ? h('div', { className: 'rt-atest-meta' }, '验证接口面：' + a.test_surface) : null,
          a.potential ? h('div', { className: 'rt-atest-meta' }, '预期产出：' + a.potential) : null,
          noteLines.length ? h(Clip, { label: '验证记录', text: noteLines.join('\n') }) : null)
      }

      const concl = (label, value) => h('span', { key: label, className: 'rt-concl-i', style: { cursor: 'default' } },
        h('b', null, String(value || 0)), h('span', null, label))
      const conclusion = h('div', { className: 'rt-concl' },
        concl('验证中', stats.testing),
        concl('待验证', stats.untested),
        concl('已验证', stats.tested),
        concl('受阻/跳过', (stats.abandoned || 0) + (stats.blocked || 0)),
        concl('无需验证', stats.no_surface),
        h('div', { className: 'rt-spacer' }),
        at ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
          '更新于 ' + at.toLocaleTimeString('zh-CN', { hour12: false })) : null,
        h('button', {
          className: 'rt-btn', style: { padding: '0 7px', fontSize: 11 }, title: '展开最近验证与待验证队列',
          onClick: () => collapse.setAll(['testing:' + eng, 'recent:' + eng, 'queue:' + eng], true),
        }, '全部展开'),
        h('button', {
          className: 'rt-btn', style: { padding: '0 7px', fontSize: 11 }, title: '只留正在验证',
          onClick: () => collapse.setAll(['testing:' + eng, 'recent:' + eng, 'queue:' + eng], false),
        }, '全部收起'),
        h('button', {
          className: 'rt-btn' + (auto ? ' rt-btn-primary' : ''), style: { padding: '0 7px', fontSize: 11 },
          title: '每 5 秒自动刷新', onClick: () => setAuto((x) => !x),
        }, auto ? '实时 · 5s' : '已暂停'),
        h('button', { className: 'rt-btn', style: { padding: '0 7px', fontSize: 11 }, onClick: load }, '刷新'))

      const body = []
      body.push(h(Section, {
        key: 'testing', tone: 'test', title: '正在验证',
        count: testing.length + ' 个',
        sub: testing.length ? '智能体正在验证这些模块与服务' : '智能体开始验证某个模块后会实时出现在这里',
        open: collapse.isOpen('testing:' + eng, true),
        onToggle: collapse.toggle('testing:' + eng, true),
      }, testing.length
        ? testing.map((a) => card(a, false))
        : h('div', { className: 'rt-atest-meta', style: { paddingBottom: 4 } }, '当前没有模块处于「验证中」')))

      body.push(h(Section, {
        key: 'recent', tone: 'past', title: '最近验证', count: recent.length + ' 个',
        sub: '已完成验证的模块',
        open: collapse.isOpen('recent:' + eng, false),
        onToggle: collapse.toggle('recent:' + eng, false),
      }, recent.length ? recent.map((a) => card(a, true)) : h('div', { className: 'rt-atest-meta' }, '暂无')))

      body.push(h(Section, {
        key: 'queue', tone: 'queue', title: '待验证队列',
        count: (data ? (data.untested || 0) : 0) + ' 个',
        sub: '按模块优先级与开放服务数排序',
        open: collapse.isOpen('queue:' + eng, false),
        onToggle: collapse.toggle('queue:' + eng, false),
      }, queue.length
        ? queue.map((a) => card(a, true)).concat([
            h('div', { key: 'queueHint', className: 'rt-atest-meta', style: { paddingTop: 4 } },
              '完整清单（含筛选与排序）见「模块与服务」页')])
        : h('div', { className: 'rt-atest-meta' }, '没有待验证模块')))

      return h('div', { className: 'rt-main' },
        conclusion,
        err ? h('div', { className: 'rt-err' }, err) : null,
        data === null && !err ? h('div', { className: 'rt-empty' }, '加载中…') : null,
        h('div', { className: 'rt-body', style: { overflow: 'auto' } },
          h('div', { style: { padding: '6px 12px 14px' } }, body)))
    }

    /* ---------------------------------------------------------- 运行环境与服务端点 */
    function SessionTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [copied, setCopied] = React.useState(null)

      const load = () => {
        if (!eng) return
        api({ op: 'sessions', engagement: eng }).then((r) => {
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null)
          setData(r)
        }, (e) => setErr(String((e && e.message) || e)))
      }
      React.useEffect(load, [eng, refreshKey])

      const probe = () => {
        setBusy(true); setMsg(null)
        api({ op: 'probeSessions', engagement: eng, timeoutMs: 6000 }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '检测失败' }); load(); return }
          const on = (r.webshells || []).filter((x) => x.status === 'online').length
          const act = (r.tunnels || []).filter((x) => x.status === 'active').length
          setMsg({ ok: '检测完成：服务端点在线 ' + on + '/' + (r.webshells || []).length + '，联调通道可用 ' + act + '/' + (r.tunnels || []).length })
          load()
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const copy = (key, text) => copyWithFeedback(text, text, (okFlag, message) => {
        if (!okFlag) { setMsg({ err: message }); return }
        setCopied(key)
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
      })

      const markTunnel = (t, status) => {
        setMsg(null)
        api({ op: 'updateTunnel', engagement: eng, id: t.id, patch: { status: status, check_note: '界面手动标记' } })
          .then(() => load(), (e) => setMsg({ err: String((e && e.message) || e) }))
      }
      const markShell = (w, status) => {
        setMsg(null)
        api({ op: 'updateWebshell', engagement: eng, id: w.id, patch: { status: status, check_note: '界面手动标记' } })
          .then(() => load(), (e) => setMsg({ err: String((e && e.message) || e) }))
      }

      const sessCollapse = useCollapse('sessions:' + eng)
      const totals = (data && data.totals) || {}
      const shells = (data && data.webshells) || []
      const tunnels = (data && data.tunnels) || []
      const statusDot = (s) => h('span', { className: s === 'online' || s === 'active' ? 'rt-dot-on' : (s === 'unknown' || !s ? 'rt-dot-unk' : 'rt-dot-off') })
      const fact = (label, value) => h('div', { className: 'rt-sess-fact' }, h('b', null, label), h('span', null, value))
      const clip = (v, max) => {
        const t = String(v === undefined || v === null ? '' : v)
        const n = max || 90
        return t.length > n ? t.slice(0, n) + '…' : t
      }
      const factClip = (label, value, max) => fact(label, h('span', { title: String(value || '') }, clip(value, max)))
      const noteFold = (label, text) => {
        const t = String(text || '')
        if (t.trim() === '') return null
        return h('details', { className: 'rt-sess-fold' },
          h('summary', null, label + '（' + t.length + ' 字，点击展开）'),
          h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '4px 0', fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } }, t))
      }
      const isSecureEndpoint = (t) => /tls|https|ssh|grpc|ws|加密/i.test(String(t || ''))

      const shellCards = shells.map((w) => h('div', { key: 'w' + w.id, className: 'rt-sess' },
        h('div', { className: 'rt-sess-head' },
          statusDot(w.status),
          h('span', { className: 'rt-sess-title' }, w.url),
          h('span', { className: 'rt-tag rt-tag-active' }, w.shell_type || 'endpoint'),
          w.privilege ? h('span', { className: 'rt-tag' }, w.privilege) : null,
          h('div', { className: 'rt-spacer' }),
          copied === 'cmd' + w.id
            ? h('span', { className: 'rt-tag', style: { color: '#4d6bfe' } }, '已复制')
            : h('button', {
                className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
                onClick: () => copy('cmd' + w.id, 'curl -s "' + w.url + '"'),
              }, '复制 URL'),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: () => markShell(w, 'offline'),
          }, '标记离线')),
        h('div', { className: 'rt-sess-facts' },
          fact('端点类型', isSecureEndpoint(w.shell_type) ? '标准安全端点（可直连调试）' : '本地预览 / 调试端点'),
          w.pass_key ? fact('访问凭据', h(SecretText, { value: w.pass_key })) : null,
          w.asset_ip ? fact('所属节点', w.asset_ip) : null,
          w.privilege ? fact('运行角色', w.privilege) : null,
          w.secret_ref ? fact('凭据引用', h('span', { className: 'rt-mono' }, w.secret_ref)) : null,
          fact('最后检测', (w.last_check ? fmt(w.last_check) : '未检测')
            + (w.latency_ms !== null && w.latency_ms !== undefined ? '（' + w.latency_ms + 'ms）' : '')),
          noteFold('检测说明', w.check_note),
          noteFold('备注', w.note))))

      const tunnelCards = tunnels.map((t) => h('div', { key: 't' + t.id, className: 'rt-sess' },
        h('div', { className: 'rt-sess-head' },
          statusDot(t.status),
          h('span', { className: 'rt-sess-title' }, t.listen || '(未填监听地址)'),
          h('span', { className: 'rt-tag rt-tag-passive' }, t.kind || 'proxy'),
          t.legit === true
            ? h('span', { className: 'rt-tag rt-tag-live', title: t.entry_kind_label || '' }, '目标环境通道')
            : h('span', { className: 'rt-tag', title: '本地代理或待确认通道' }, '本地/待确认'),
          t.reach ? h('span', { className: 'rt-tag' }, '可达 ' + t.reach) : null,
          h('div', { className: 'rt-spacer' }),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: () => copy('sock' + t.id, t.listen || ''),
          }, copied === 'sock' + t.id ? '已复制' : '复制地址'),
          t.status === 'active'
            ? h('button', { className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 }, onClick: () => markTunnel(t, 'down') }, '标记离线')
            : h('button', { className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 }, onClick: () => markTunnel(t, 'active') }, '标记可用')),
        h('div', { className: 'rt-sess-facts' },
          factClip('上游入口', t.entry || '未登记', 110),
          t.reach ? factClip('可达子网/服务', t.reach, 110) : null,
          t.asset_ip ? fact('所属节点', t.asset_ip) : null,
          fact('最后检测', (t.last_check ? fmt(t.last_check) : '未检测')
            + (t.latency_ms !== null && t.latency_ms !== undefined ? '（' + t.latency_ms + 'ms）' : '')),
          noteFold('检测说明', t.check_note),
          noteFold('备注', t.note)),
        t.command ? h('details', { className: 'rt-sess-fold' },
          h('summary', null, '启动命令（点击展开 / 复制）'),
          h('div', Object.assign({ className: 'rt-code', title: '点击复制' }, clickable(() => copy('c' + t.id, t.command), { label: '复制命令' })),
            copied === 'c' + t.id ? '已复制' : t.command)) : null))

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '运行环境与服务端点'),
          h('span', { className: 'rt-tag' }, '服务端点 ' + (totals.webshellsOnline || 0) + '/' + (totals.webshells || 0) + ' 在线'),
          h('span', { className: 'rt-tag' }, '联调通道 ' + (totals.tunnelsActive || 0) + '/' + (totals.tunnels || 0) + ' 可用'),
          h('span', { className: 'rt-tag' }, '配置凭据 ' + (totals.credentials || 0)),
          h('span', { className: 'rt-tag' }, '连接会话 ' + (totals.access || 0)),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn rt-btn-primary', disabled: busy, onClick: probe }, busy ? '检测中…' : '检测连通性'),
          h('button', { className: 'rt-btn', onClick: load }, '刷新')),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        err ? h('div', { className: 'rt-err' }, err) : null,
        h('div', { className: 'rt-body', style: { overflow: 'auto' } },
          !shells.length && !tunnels.length
            ? h('div', { className: 'rt-empty' },
                h('div', null, '当前工作区尚未登记运行环境端点或联调通道。'),
                h('div', { style: { marginTop: 6, fontSize: 12 } },
                  '子智能体启动本地预览服务、调试端点或端口转发通道后会自动同步至此处；也可点击上方「检测连通性」核验在线状态。'))
            : null,
          h(Section, {
            key: 'webshells', tone: 'queue', title: '服务端点',
            count: (totals.webshellsOnline || 0) + '/' + (totals.webshells || 0) + ' 在线',
            sub: '已部署的本地预览与服务端点',
            open: sessCollapse.isOpen('shells', true), onToggle: sessCollapse.toggle('shells', true),
          }, shells.length
            ? h('div', { className: 'rt-sess-grid', style: { padding: 0 } }, shellCards)
            : h('div', { className: 'rt-atest-meta' }, '暂无服务端点')),
          h(Section, {
            key: 'tunnels', tone: 'test', title: '联调通道',
            count: (totals.tunnelsActive || 0) + '/' + (totals.tunnels || 0) + ' 可用',
            sub: '端口转发与联调代理通道',
            open: sessCollapse.isOpen('tunnels', true), onToggle: sessCollapse.toggle('tunnels', true),
          }, tunnels.length
            ? h('div', { className: 'rt-sess-grid', style: { padding: 0 } }, tunnelCards)
            : h('div', { className: 'rt-atest-meta' }, '暂无联调通道'))))
    }

    /* ---------------------------------------------------------- 错误边界 */
    class RtBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error: error }
      }
      componentDidCatch(error) {
        try { console.error('[lmtagent-ui] 页面渲染出错:', error) } catch (e) { /* ignore */ }
      }
      render() {
        if (this.state.error) {
          const msg = this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error)
          return h('div', { className: 'rt-pane' },
            h('div', { className: 'rt-err' }, '该页面渲染出错：' + msg),
            h('button', {
              className: 'rt-btn',
              onClick: () => { this.setState({ error: null }); setUI({ tab: 'overview' }) },
            }, '回到项目总览'))
        }
        return this.props.children
      }
    }
