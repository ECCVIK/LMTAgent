    /* ═══════════════════════════════════════════════════════════════════════════
     * 06-engineering-tabs.js — 架构模块、提示词、技能库、缺陷审查、交付报告、模式库、里程碑与运行环境
     * ═══════════════════════════════════════════════════════════════════════════ */

    function AssetsTab(props) {
      useLocale()
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
      const segs = (snapshot && snapshot.segments) || []
      const snapShardLocks = (snapshot && (snapshot.shardLocks || snapshot.shard_locks)) || []
      const hasSnapShardLocks = snapShardLocks.length > 0
      const [dagShardLocks, setDagShardLocks] = React.useState([])
      /* 左侧「对外服务模块 / 内部服务模块」两组各自折叠，状态按工作区记住 */
      const sideCollapse = useCollapse('assets-side:' + eng)
      const seq = React.useRef(0)
      const onData = props.onData

      React.useEffect(() => {
        if (!eng || hasSnapShardLocks) {
          setDagShardLocks([])
          return
        }
        let alive = true
        api({ op: 'shardLocks', engagement: eng }).then((r) => {
          if (!alive) return
          const locks = r && (r.shard_locks || r.shardLocks || r.locks)
          if (Array.isArray(locks)) setDagShardLocks(locks)
        }, () => {})
        return () => { alive = false }
      }, [eng, refreshKey, hasSnapShardLocks])

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
            setState({ loading: false, error: (r && r.error) || t('查询失败', 'Query failed'), total: 0, items: [] })
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

      const shardLocks = snapShardLocks.length > 0 ? snapShardLocks : dagShardLocks

      const sideChildren = []
      sideChildren.push(h('div', Object.assign({
        key: 'all', className: 'rt-seg' + (cidr === null && view !== 'testing' ? ' on' : ''),
      }, clickable(() => { setView('list'); setCidr(null) }, { label: t('全部 C 段', 'All Groups'), expanded: cidr === null && view !== 'testing' })),
        h('div', { className: 'rt-seg-cidr' }, t('全部 C 段', 'All Groups')),
        h('div', { className: 'rt-seg-meta' }, segs.length + t(' 个网段', ' groups'))))
      /* 「当前测试」与 C 段分组同级：正在跑的扫描/探测是"看资产"的一部分 */
      sideChildren.push(h('div', Object.assign({
        key: 'testing', className: 'rt-seg' + (view === 'testing' ? ' on' : ''),
        title: t('正在跑的扫描 / 探测与进度（5 秒自动刷新）', 'Active checks / probes & progress (auto-refresh every 5s)'),
      }, clickable(() => { setView('testing'); setCidr(null) }, { label: t('当前测试', 'Active Checks'), expanded: view === 'testing' })),
        h('div', { className: 'rt-seg-cidr', style: { display: 'flex', alignItems: 'baseline', gap: 5 } },
          h('span', { className: 'rt-scope rt-scope-testing', title: t('当前测试（既非内网也非外网）', 'Active checks (neither internal nor external)') }, t('测', 'RUN')),
          h('span', { style: { flex: 1 } }, t('当前测试', 'Active Checks'))),
        h('div', { className: 'rt-seg-meta' }, t('正在跑的扫描与探测', 'Running scans & probes'))))
      /* 待评估/下一步队列 */
      sideChildren.push(h('div', Object.assign({
        key: 'next', className: 'rt-seg' + (view === 'next' ? ' on' : ''),
        title: t('按待测状态 + 优先级 + 端口数排序，取前 10 个模块', 'Top 10 modules sorted by status + priority + ports'),
      }, clickable(() => { setView('next'); setCidr(null) }, { label: t('待验证模块 Top 10', 'Top 10 Pending'), expanded: view === 'next' })),
        h('div', { className: 'rt-seg-cidr', style: { display: 'flex', alignItems: 'baseline', gap: 5 } },
          h('span', { className: 'rt-scope rt-scope-testing', title: t('待评估/待测队列', 'Pending verification queue') }, t('下', 'NEXT')),
          h('span', { style: { flex: 1 } }, t('待验证模块 Top 10', 'Top 10 Pending'))),
        h('div', { className: 'rt-seg-meta' }, t('待评估 ', 'Pending ') + ((snapshot && snapshot.tests && snapshot.tests.untested) || 0) + t(' 个', ''))))
      /* C 段按内外网分组：先对外服务模块再内部服务模块 */
      const segBlock = (title, list, kind) => {
        const open = sideCollapse.isOpen('scope:' + kind, false)
        const toggle = sideCollapse.toggle('scope:' + kind, false)
        const out = [h('div', {
          key: 'h' + kind, className: 'rt-sidehead rt-sidehead-btn',
          role: 'button', tabIndex: 0, 'aria-expanded': open ? 'true' : 'false',
          title: (open ? t('收起本组', 'Collapse group') : t('展开本组', 'Expand group')) + t('（并切回模块列表）', ' (switch back to module list)'),
          onClick: () => { setView('list'); toggle() },
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView('list'); toggle(e) } },
        },
          h('span', { className: 'rt-sec-caret' }, open ? '▾' : '▸'),
          h('span', { className: 'rt-scope rt-scope-' + kind }, kind === 'internal' ? t('内部', 'INT') : t('对外', 'EXT')),
          h('span', null, title + ' · ' + list.length + t(' 个 C 段', ' groups')),
          h('span', { className: 'rt-spacer' }),
          h('span', { style: { fontWeight: 400 } }, list.reduce((n, x) => n + (x.assets || 0), 0) + t(' 模块', ' modules')))]
        if (!open) return out
        for (const s of list) {
          out.push(h('div', Object.assign({
            key: s.cidr, className: 'rt-seg' + (cidr === s.cidr ? ' on' : ''),
            title: (s.org || t('未知归属', 'Unknown owner')) + t(' · 存活 ', ' · Live ') + (s.live || 0) + '/' + (s.assets || 0) + t(' 个', ''),
          }, clickable(() => { setView('list'); setCidr(s.cidr) },
            { label: t('筛选 C 段 ', 'Filter group ') + s.cidr, expanded: cidr === s.cidr && view !== 'testing' })),
            h('div', { className: 'rt-seg-cidr', style: { display: 'flex', alignItems: 'baseline', gap: 5 } },
              h('span', { className: 'rt-scope rt-scope-' + kind }, kind === 'internal' ? t('内', 'I') : t('外', 'E')),
              h('span', { style: { flex: 1 } }, s.cidr),
              h('span', { className: 'rt-seg-meta', style: { margin: 0, whiteSpace: 'nowrap' } },
                s.assets + t(' 个', '')))))
        }
        return out
      }
      const segExternal = segs.filter((x) => x.scope !== 'internal')
      const segInternal = segs.filter((x) => x.scope === 'internal')
      if (segExternal.length) sideChildren.push(...segBlock(t('对外服务模块', 'External Modules'), segExternal, 'external'))
      if (segInternal.length) sideChildren.push(...segBlock(t('内部服务模块', 'Internal Modules'), segInternal, 'internal'))
      const side = h('div', { className: 'rt-side' }, sideChildren)

      const toolbar = h('div', { className: 'rt-toolbar' },
        h('input', {
          className: 'rt-input', style: { flex: '1 1 150px' }, placeholder: t('搜索 IP / 域名 / 指纹（回车）', 'Search host / domain / stack (Enter)'),
          value: q, onChange: (e) => setQ(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') setQApplied(q) },
        }),
        h('button', { className: 'rt-btn', onClick: () => setQApplied(q) }, t('搜索', 'Search')),
        (() => {
          const active = [service, port, prov, priority, testStatus, scope, assetState].filter(Boolean).length
          return h('button', {
            className: 'rt-btn' + (showFilters || active ? ' rt-btn-primary' : ''),
            title: t('展开更多筛选：服务 / 端口 / 来源 / 优先级 / 测试状态 / 范围', 'More filters: service / port / source / priority / status / scope'),
            onClick: () => setShowFilters((v) => !v),
          }, t('筛选', 'Filter') + (active ? ' (' + active + ')' : ''))
        })(),
        showFilters ? h('input', {
          className: 'rt-input', style: { width: '78px' }, placeholder: t('服务', 'Service'),
          value: service, onChange: (e) => setService(e.target.value),
        }) : null,
        showFilters ? h('input', {
          className: 'rt-input', style: { width: '60px' }, placeholder: t('端口', 'Port'),
          value: port, onChange: (e) => setPort(e.target.value),
        }) : null,
        showFilters ? h('select', { className: 'rt-input', value: scope, onChange: (e) => setScope(e.target.value) },
          h('option', { value: '' }, t('范围不限', 'Any Scope')),
          h('option', { value: 'external' }, t('仅对外服务模块', 'External Only')),
          h('option', { value: 'internal' }, t('仅内部服务模块', 'Internal Only'))) : null,
        showFilters ? h('select', { className: 'rt-input', value: prov, onChange: (e) => setProv(e.target.value), title: t('按端口来源过滤（列表已不再单列显示，详情里可见）', 'Filter by provenance (shown in details)') },
          h('option', { value: '' }, t('来源不限', 'Any Source')),
          h('option', { value: 'passive' }, t('仅被动', 'Passive Only')),
          h('option', { value: 'active' }, t('仅主动', 'Active Only'))) : null,
        showFilters ? h('select', { className: 'rt-input', value: priority, onChange: (e) => setPriority(e.target.value) },
          h('option', { value: '' }, t('优先级不限', 'Any Priority')),
          h('option', { value: 'high' }, t('高优（高）', 'High')),
          h('option', { value: 'medium' }, t('一般（中）', 'Medium')),
          h('option', { value: 'low' }, t('低优（低）', 'Low'))) : null,
        showFilters ? h('select', { className: 'rt-input', value: testStatus, onChange: (e) => setTestStatus(e.target.value) },
          h('option', { value: '' }, t('测试状态不限', 'Any Status')),
          h('option', { value: 'untested' }, t('未测试', 'Pending')),
          h('option', { value: 'testing' }, t('测试中', 'Testing')),
          h('option', { value: 'tested' }, t('已测试', 'Tested')),
          h('option', { value: 'blocked' }, t('受阻', 'Blocked')),
          h('option', { value: 'abandoned' }, t('已跳过', 'Skipped')),
          h('option', { value: 'abandoned,blocked' }, t('受阻或已跳过', 'Blocked or Skipped')),
          h('option', { value: 'no_surface' }, t('无接口面', 'No Surface'))) : null,
        h('div', { className: 'rt-spacer' }),
        h('button', { className: 'rt-btn', title: t('重新拉取快照与当前视图数据', 'Refresh snapshot and view data'), onClick: () => { if (onRefresh) onRefresh() } }, t('刷新', 'Refresh')),
        h('button', { className: 'rt-btn' + (view === 'next' ? ' rt-btn-primary' : ''), title: t('按待测状态 + 优先级 + 端口数排序，取前 10 个模块', 'Top 10 modules sorted by pending status + priority + ports'), onClick: () => setView('next') }, t('待验证模块 Top 10', 'Top 10 Pending')),
        h('button', { className: 'rt-btn' + (view === 'list' ? ' rt-btn-primary' : ''), onClick: () => setView('list') }, t('列表', 'List')),
        h('button', { className: 'rt-btn' + (view === 'timeline' ? ' rt-btn-primary' : ''), title: t('按发现时间看模块（什么时候登记、哪天新增多少）', 'View modules by discovery timeline'), onClick: () => setView('timeline') }, t('发现时间', 'Timeline')),
        h('button', { className: 'rt-btn' + (view === 'domain' ? ' rt-btn-primary' : ''), onClick: () => setView('domain') }, t('域名', 'Domains')),
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
      const toggleTest = (v) => { setTestStatus((cur) => (cur === v ? '' : v)); setAssetState('') }
      const conclusion = h('div', { className: 'rt-concl' },
        ConclItem('all', t('个模块', 'Modules'), snapStats.assets, noFilter, () => {
          setTestStatus(''); setPriority(''); setScope(''); setProv(''); setAssetState(''); setCidr(null)
        }),
        ConclItem('live', t('在线', 'Live'), snapStats.liveAssets, assetState === 'live', () => { setAssetState((v) => (v === 'live' ? '' : 'live')); setTestStatus('') }),
        ConclItem('untested', t('待测', 'Pending'), tests.untested, testStatus === 'untested', () => toggleTest('untested')),
        ConclItem('testing', t('测试中', 'Testing'), tests.testing, testStatus === 'testing', () => toggleTest('testing')),
        ConclItem('tested', t('已测', 'Tested'), tests.tested, testStatus === 'tested', () => toggleTest('tested')),
        ConclItem('giveup', t('跳过', 'Skipped'), (tests.abandoned || 0) + (tests.blocked || 0), testStatus === 'abandoned,blocked', () => toggleTest('abandoned,blocked')),
        h('div', { className: 'rt-spacer' }),
        h('select', {
          className: 'rt-input', value: sort, onChange: (e) => setSort(e.target.value),
          title: t('列表排序方式', 'Sort order'),
        },
          h('option', { value: 'priority' }, t('排序：优先级优先', 'Sort: Priority')),
          h('option', { value: 'todo' }, t('排序：待测优先', 'Sort: Pending')),
          h('option', { value: 'discovered' }, t('排序：最近发现优先', 'Sort: Recently Discovered')),
          h('option', { value: 'ports' }, t('排序：端口多优先', 'Sort: Most Ports')),
          h('option', { value: 'ip' }, t('排序：按 IP', 'Sort: By Host'))))

      /* ── 文件独占分片锁（ShardLock）状态条：Wave 3 并行研发防撞车可视化 ── */
      const shardLockBanner = shardLocks.length > 0
        ? h('div', { className: 'rt-card', style: { margin: '6px 10px 4px', padding: '8px 10px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 } },
              h('b', { style: { fontSize: 12 } }, t('文件独占分片锁（ShardLock）', 'Exclusive Shard Locks (ShardLock)')),
              h('span', { className: 'rt-tag rt-tag-live' }, t('锁定中 ', 'Locked ') + shardLocks.length + t(' 项', '')),
              h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                t('Wave 3 并行分片独占路径保护', 'Wave 3 parallel shard exclusive path guard'))),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              shardLocks.slice(0, 16).map((lk, idx) => {
                const pathStr = String(lk.file_path || lk.path || lk.glob || lk.target || ('shard-' + (idx + 1)))
                const ownerStr = String(lk.worker_id || lk.owner || lk.agent || lk.role || 'exploit')
                return h('span', {
                  key: 'slk-' + idx + '-' + pathStr,
                  className: 'rt-tag rt-mono',
                  title: t('独占路径：', 'Exclusive path: ') + pathStr + t(' · 持有者：', ' · Owner: ') + ownerStr,
                }, pathStr + ' ← ' + ownerStr)
              })))
        : null

      const head = h('div', { className: 'rt-row head' },
        h('span', null, t('IP / 节点', 'Host / Module')), h('span', null, t('优先级', 'Priority')), h('span', null, t('测试状态', 'Test Status')),
        h('span', null, t('开放端口 / 服务', 'Open Ports / Services')), h('span', null, t('技术栈指纹', 'Stack Fingerprint')))

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
        }, clickable(() => toggleRow(it.id), { label: t('展开模块 ', 'Expand module ') + it.ip, expanded: openId === it.id })),
          h('span', { className: 'rt-mono', style: { display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'wrap' } },
            h('span', {
              className: 'rt-scope rt-scope-' + (it.scope === 'internal' ? 'internal' : 'external'),
            }, it.scope === 'internal' ? t('内', 'I') : t('外', 'E')),
            h('span', {
              title: it.state === 'live' ? t('在线', 'Live') : String(it.state),
              style: {
                width: 7, height: 7, borderRadius: '50%', flex: 'none', marginTop: 4,
                background: it.state === 'live' ? '#4d6bfe' : '#94a3b8',
              },
            }),
            h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, it.ip),
            h('span', {
              style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
              title: t('发现时间：', 'Discovered: ') + (it.discovered_at ? fmt(it.discovered_at) : t('未记录', 'Unknown'))
                + (it.last_seen ? t('\n最近采集：', '\nLast seen: ') + fmt(it.last_seen) : ''),
            }, it.discovered_at ? fmtShort(it.discovered_at) : t('发现时间未知', 'Time unknown'))),
          h('span', null, h(PriTag, { p: it.priority, title: it.potential || '' })),
          h('span', null, h(TestTag, { s: it.test_status }),
            it.blocked_count ? h('span', { className: 'rt-tag', style: { color: '#ef4444', borderColor: '#ef444455', marginLeft: 4 } }, t('阻', 'Blk ') + it.blocked_count) : null),
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
              h('span', null, [p.service, p.product, p.version].filter(Boolean).join(' ') || t('未知服务', 'Unknown service')),
              p.url ? h('a', { className: 'rt-link', href: p.url, target: '_blank', rel: 'noreferrer', title: p.url }, p.title ? p.title : p.url) : null,
              h(ProvTag, { p: p.provenance })))
          }
          for (const f of (d.fingerprints || [])) {
            fpRows.push(h('div', { key: 'f' + (f.product || '') + (f.version || '') + (f.evidence || ''), className: 'rt-kv' },
              h('b', null, f.category || '—'),
              h('span', null, [f.vendor, f.product, f.version].filter(Boolean).join(' ') + (f.evidence ? ' (' + f.evidence + ')' : '')),
              h(ProvTag, { p: f.provenance })))
          }
          for (const o of (d.observations || []).slice(0, 8)) {
            obsRows.push(h('div', { key: 'o' + (o.attr || '') + (o.value || '') + (o.collected_at || ''), className: 'rt-kv' },
              h('b', null, o.attr || '—'),
              h('span', null, (o.value || '') + ' · ' + (o.tool || t('未知工具', 'Unknown tool')) + ' · ' + fmt(o.collected_at)),
              h(ProvTag, { p: o.provenance })))
          }
        }
        /* 详情分三层：3 行必读 → 「展开全部」后才是溯源、原始记录与备注全文 */
        const all = showAll === it.id
        const noteLines = d && d.test_notes ? d.test_notes.split('\n').filter(Boolean) : []
        const inner = d
          ? h('div', null,
              h('div', { className: 'rt-kv' }, h('b', null, t('测试', 'Status')), h('span', null,
                h(TestTag, { s: d.test_status }),
                d.blocked_count ? h('span', { className: 'rt-tag', style: { marginLeft: 6, color: '#ef4444', borderColor: '#ef444455' } }, t('受阻 ', 'Blocked ') + d.blocked_count + t(' 次', 'x')) : null,
                h('span', { style: { marginLeft: 8, color: 'var(--dsw-alias-label-secondary)' } },
                  (d.test_updated_at ? fmt(d.test_updated_at) : t('未测过', 'Not tested')) + (d.test_updated_by ? ' · ' + d.test_updated_by : '')))),
              h('div', { className: 'rt-kv' }, h('b', null, t('优先级', 'Priority')), h('span', null,
                h(PriTag, { p: d.priority }),
                h('span', { style: { marginLeft: 8 } }, d.potential || t('未评估', 'Unassessed')),
                d.assess_reason ? h('span', { style: { marginLeft: 8, color: 'var(--dsw-alias-label-secondary)' } }, d.assess_reason) : null)),
              h('div', { className: 'rt-kv' }, h('b', null, t('接口面', 'Surface')), h('span', null,
                d.test_surface || (portRows.length ? t('未记录（开放端口见下）', 'Unrecorded (see open ports below)') : t('无开放端口', 'No open ports')),
                d.scope ? h('span', { className: 'rt-scope rt-scope-' + (d.scope === 'internal' ? 'internal' : 'external'), style: { marginLeft: 8 } },
                  d.scope === 'internal' ? t('内部服务模块', 'Internal Module') : t('对外服务模块', 'External Module')) : null)),
              h('span', Object.assign({ className: 'rt-more' },
                clickable(() => setShowAll(all ? null : it.id), { label: all ? t('收起模块详情', 'Collapse module details') : t('展开模块详情', 'Expand module details'), expanded: all })),
                all ? t('收起全部 ▲', 'Collapse All ▲') : t('展开全部（端口 · 指纹 · 采集溯源 · 测试记录）▼', 'Expand All (Ports · Stack · Provenance · Notes) ▼')),
              all ? h('div', null,
                h('div', { className: 'rt-kv' }, h('b', null, t('主机名', 'Hostnames')), h('span', null, (d.names || []).map((n) => n.name).join(', ') || '—')),
                h('div', { className: 'rt-kv' }, h('b', null, t('发现时间', 'Discovered')),
                  h('span', { title: t('本条模块第一次进入架构库的时刻（重复采集只刷新"最近采集"）', 'First recorded in architecture registry (rescan refreshes Last Seen only)') }, fmt(d.discovered_at)),
                  h('b', { style: { minWidth: 0, marginLeft: 8 } }, t('最近采集', 'Last Seen')), h('span', null, fmt(d.last_seen)),
                  h('b', { style: { minWidth: 0, marginLeft: 8 } }, t('数据源首见', 'First Seen')), h('span', null, fmt(d.first_seen))),
                h('div', { className: 'rt-kv' }, h('b', null, t('C 段', 'Group')), h('span', null, d.segment_cidr)),
                h('div', { className: 'rt-kv' }, h('b', null, t('优先级', 'Priority')), h('span', null,
                  (d.priority ? priLabel(d.priority) : t('未评估', 'Unassessed')) + (d.potential ? t(' · 预期：', ' · Expected: ') + d.potential : '')
                  + (d.assess_reason ? t(' · 依据：', ' · Reason: ') + d.assess_reason : '')
                  + (d.assessed_at ? ' (' + fmt(d.assessed_at) + ')' : ''))),
                h('div', { className: 'rt-kv' }, h('b', null, t('来源', 'Provenance')), h('span', null,
                  t('被动端口 ', 'Passive ports ') + (d.passive || 0) + t(' · 主动端口 ', ' · Active ports ') + (d.active || 0))),
                h('div', { style: { margin: '6px 0 3px', fontWeight: 600 } }, t('开放端口 / 服务', 'Open Ports / Services')),
                h('div', null, portRows.length ? portRows : '—'),
                h('div', { style: { margin: '6px 0 3px', fontWeight: 600 } }, t('指纹', 'Fingerprints')),
                h('div', null, fpRows.length ? fpRows : '—'),
                noteLines.length
                  ? h(Clip, { key: 'notes', label: t('测试记录（', 'Test Notes (') + noteLines.length + t(' 条）', ')'), text: noteLines.join('\n') })
                  : null,
                h('div', { style: { margin: '6px 0 3px', fontWeight: 600 } }, t('采集溯源（最近 8 条）', 'Observations (Latest 8)')),
                h('div', null, obsRows.length ? obsRows : '—'))
                : null)
          : h('div', null, t('加载中…', 'Loading…'))
        rowNodes.push(h('div', {
          key: 'd' + it.id, className: 'rt-row',
          style: { cursor: 'default', gridTemplateColumns: '1fr' },
        }, h('div', { className: 'rt-expand' }, inner)))
      }

      const listPane = h('div', { className: 'rt-table' },
        view === 'next'
          ? h('div', { className: 'rt-section', style: { padding: '8px 10px 4px' } },
              t('待验证模块 Top 10 · 按待测状态 → 优先级 → 端口数排序（只列未测/测试中）', 'Top 10 Pending Modules · Sorted by Status → Priority → Ports (Pending/Testing only)'))
          : null,
        head, rowNodes,
        !state.loading && !displayItems.length
          ? h('div', { className: 'rt-empty' }, view === 'next' ? t('没有待验证模块了：均已完成验证或已跳过。', 'No pending modules: all completed or skipped.') : t('没有匹配的模块', 'No matching modules'))
          : null)

      /* 域名维度：域名 → 关联资产 */
      const domainPane = h('div', { className: 'rt-table' },
        domains === null ? h('div', { className: 'rt-empty' }, t('加载中…', 'Loading…'))
          : domains.length
          ? domains.map((g) => h('div', { key: g.domain },
              h('div', { className: 'rt-section', style: { padding: '8px 10px 4px' } },
                h('a', { className: 'rt-link', href: 'http://' + g.domain, target: '_blank', rel: 'noreferrer' }, g.domain),
                h('span', { className: 'rt-tag', style: { marginLeft: 8 } }, g.count + t(' 个资产', ' hosts'))),
              g.assets.map((a) => h('div', Object.assign({
                key: String(g.domain) + '\u0000' + a.id + '\u0000' + a.ip, className: 'rt-row',
                style: { gridTemplateColumns: '150px 130px 70px 1fr', cursor: 'pointer' },
              }, clickable(() => { setView('list'); setQ(''); setQApplied(a.ip) }, { label: t('查看资产 ', 'View host ') + a.ip })),
                h('span', { className: 'rt-mono' }, a.ip),
                h('span', { className: 'rt-mono' }, a.segment),
                h('span', null, h('span', { className: 'rt-tag rt-tag-' + (a.state === 'live' ? 'live' : 'dead') }, a.state === 'live' ? t('存活', 'Live') : a.state)),
                h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, (a.names || []).join(', '))))))
          : h('div', { className: 'rt-empty' }, cidr ? t('该 C 段下暂无域名（切换到「全部 C 段」看全量）', 'No domains in this group (switch to All Groups to view all)') : t('暂无域名数据（信息收集阶段会写入域名）', 'No domains recorded yet (populated during discovery)')))

      /* Web 资产：标题 + 可直接点击的 URL */
      const webPane = h('div', { className: 'rt-table' },
        h('div', { className: 'rt-row head', style: { gridTemplateColumns: '1.6fr 1.2fr 130px 110px' } },
          h('span', null, t('URL（可点击）', 'URL (Clickable)')), h('span', null, t('标题', 'Title')), h('span', null, t('资产', 'Host')), h('span', null, t('服务', 'Service'))),
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
        web === null ? h('div', { className: 'rt-empty' }, t('加载中…', 'Loading…'))
          : (!web.length ? h('div', { className: 'rt-empty' }, cidr ? t('该 C 段下暂无 Web 资产', 'No Web endpoints in this group') : t('暂无 Web 资产（HTTP 探测后会写入 URL 与标题）', 'No Web endpoints yet (populated after HTTP probes)')) : null))

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
      useLocale()
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [day, setDay] = React.useState('')
      React.useEffect(() => {
        if (!eng) return
        setData(null)
        api({ op: 'discoveryTimeline', engagement: eng, limit: 200 })
          .then((r) => { if (!r || r.ok === false) setErr((r && r.error) || t('加载失败', 'Load failed')); else { setErr(null); setData(r) } },
            (e) => setErr(String((e && e.message) || e)))
      }, [eng, refreshKey])
      if (err) return h('div', { className: 'rt-pane' }, h('div', { className: 'rt-err' }, err))
      if (!data) return h('div', { className: 'rt-empty' }, t('加载中…', 'Loading…'))
      const recent = (data.recent || []).filter((a) => day === '' || String(a.discovered_at || '').slice(0, 10) === day)
      return h('div', { className: 'rt-pane', style: { flex: 1, minHeight: 0 } },
        h('div', { className: 'rt-card' },
          h('h4', null, t('资产发现时间线', 'Module Discovery Timeline')),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } },
            t('共 ', 'Total ') + ((data.span && data.span.total) || 0) + t(' 台 · 最早 ', ' · First ')
            + (data.span && data.span.first ? fmt(data.span.first) : '—')
            + t(' · 最近 ', ' · Latest ') + (data.span && data.span.last ? fmt(data.span.last) : '—')
            + t('（发现时间 = 第一次进入资产库的时刻；重复采集只刷新"最近采集"）', ' (Discovered = first registered time; rescans update Last Seen only)'))),
        (data.days || []).length === 0 ? h('div', { className: 'rt-empty' }, t('还没有资产。', 'No modules registered yet.')) : null,
        h('div', { className: 'rt-card' },
          h('h4', null, t('按天统计', 'Daily Breakdown'), day
            ? h('span', Object.assign({ className: 'rt-tag', style: { marginLeft: 6, cursor: 'pointer' } },
                clickable(() => setDay(''), { label: t('清除按天筛选：', 'Clear day filter: ') + day })), t('清除筛选：', 'Clear filter: ') + day)
            : null),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
            (data.days || []).map((d) => h('div', Object.assign({
              key: d.day, className: 'rt-seg' + (day === d.day ? ' on' : ''), style: { marginBottom: 0, cursor: 'pointer' },
              title: d.day + t('：新增 ', ': added ') + d.assets + t(' 台（内网 ', ' (Internal ') + d.internal + t(' / 外网 ', ' / External ') + d.external + ')',
            }, clickable(() => setDay(day === d.day ? '' : d.day),
              { label: t('筛选 ', 'Filter ') + d.day + t(' 发现的资产', ' discoveries'), expanded: day === d.day })),
              h('div', { className: 'rt-seg-cidr' }, d.day),
              h('div', { className: 'rt-seg-meta' }, d.assets + t(' 台 · 内 ', ' · Int ') + d.internal + t(' / 外 ', ' / Ext ') + d.external))))),
        h('div', { className: 'rt-card' },
          h('h4', null, day ? day + t(' 发现的资产（', ' Discoveries (') + recent.length + ')' : t('最近发现的资产（', 'Recent Discoveries (') + recent.length + ')'),
          recent.length === 0 ? h('div', { className: 'rt-empty' }, t('这一天没有新增资产。', 'No new modules discovered on this day.')) : null,
          recent.map((a) => h('div', { key: a.id, className: 'rt-kv' },
            h('b', { className: 'rt-mono', style: { minWidth: 110 } },
              h('span', { className: 'rt-scope rt-scope-' + (a.scope === 'internal' ? 'internal' : 'external'), style: { marginRight: 4 } },
                a.scope === 'internal' ? t('内', 'I') : t('外', 'E')),
              a.ip),
            h('span', { style: { minWidth: 132, fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
              a.discovered_at ? fmt(a.discovered_at) : t('时间未知', 'Time unknown')),
            h('span', { style: { flex: 1 } }, (a.primary_name || '—') + (a.open_ports ? ' · ' + a.open_ports + t(' 端口', ' ports') : '')),
            h(PriTag, { p: a.priority })))))
    }

    /* ---------------------------------------------------------- 智能体提示词 */
    function PromptsTab(props) {
      useLocale()
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
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || t('读取失败', 'Read failed') }); return }
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
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || t('保存失败', 'Save failed') }); return }
          setRoles((list) => list.map((x) => (x.role === active
            ? Object.assign({}, x, { content: draft, updated_at: new Date().toISOString() })
            : x)))
          setMsg({ ok: t('已保存', 'Saved') })
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const reset = (all) => {
        setBusy(true); setMsg(null)
        api({ op: 'resetPrompts', engagement: eng, role: all ? undefined : active }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || t('恢复失败', 'Reset failed') }); return }
          setMsg({ ok: t('已恢复内置默认：', 'Reset to built-in defaults: ') + (r.reset || []).join(', ') })
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
        { label: t('查看「', 'View "') + r.title + t('」提示词', '" prompt'), expanded: active === r.role })),
        h('div', { className: 'rt-item-name' }, r.title),
        h('div', { className: 'rt-item-desc' }, (r.stale ? t('旧版 · ', 'Legacy · ') : '') + ((r.content || '').replace(/[#*`]/g, '').slice(0, 60) || t('（空）', '(empty)')))))

      return h('div', { className: 'rt-split' },
        h('div', { className: 'rt-list' }, items),
        h('div', { className: 'rt-main' },
          h('div', { className: 'rt-toolbar' },
            h('span', { style: { fontWeight: 600 } }, cur ? cur.title : t('提示词', 'Prompts')),
            h('span', { className: 'rt-tag' }, t('更新 ', 'Updated ') + fmt(cur && cur.updated_at)),
            cur && cur.stale ? h('span', { className: 'rt-tag rt-tag-active' }, t('旧版提示词', 'Legacy Prompt')) : null,
            h('div', { className: 'rt-spacer' }),
            h('button', {
              className: 'rt-btn', disabled: busy,
              title: preview ? t('切换到 Markdown 源文编辑', 'Switch to Markdown source editor') : t('预览渲染后的提示词', 'Preview rendered prompt'),
              onClick: () => setPreview((v) => !v),
            }, preview ? t('编辑', 'Edit') : t('预览', 'Preview')),
            h('button', {
              className: 'rt-btn', disabled: busy || !active, title: t('把当前角色恢复成内置最新版提示词', 'Reset current role to latest built-in prompt'),
              onClick: () => reset(false),
            }, t('恢复默认为当前', 'Reset Current')),
            h('button', {
              className: 'rt-btn', disabled: busy, title: t('全部角色恢复成内置最新版提示词', 'Reset all roles to latest built-in prompts'),
              onClick: () => reset(true),
            }, t('全部恢复默认', 'Reset All')),
            h('button', { className: 'rt-btn rt-btn-primary', disabled: busy || !active, onClick: save }, busy ? t('保存中…', 'Saving…') : t('保存', 'Save'))),
          msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
          h('div', { className: 'rt-pane' },
            preview
              ? h(Markdown, {
                  className: 'rt-markdown rt-prompt-preview', text: draft || t('（空）', '(empty)'),
                  style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, maxHeight: '48vh' },
                })
              : h('textarea', {
                  className: 'rt-textarea', value: draft, spellCheck: false,
                  onChange: (e) => setDraft(e.target.value),
                  placeholder: t('该角色的系统提示词（Markdown）', 'System prompt for this role (Markdown)'),
                }),
            h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } },
              cur && cur.planner
                ? t('主会话实际使用预设 persona；此处 plan 文本仅作参考。', 'Primary session uses preset persona; this plan text is for reference only.')
                : t('保存后写入 agents/' + (active || 'role') + '.md，派活时通过 lmt_role_prompt 读取。',
                    'Saved to agents/' + (active || 'role') + '.md; loaded by lmt_role_prompt on dispatch.')))))
    }

    /* ---------------------------------------------------------- 研发技能库（DSH 原生） */
    function SkillsTab(props) {
      useLocale()
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
          if (!r || r.ok === false) { setErr((r && r.error) || t('读取失败', 'Read failed')); return }
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
          else setErr((r && r.error) || t('读取失败', 'Read failed'))
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
      const catLabel = (c) => (!c || c === '未分类') ? t('未分类', 'Uncategorized') : c

      const listItems = filtered.map((s) => h('div', Object.assign({
        key: s.name,
        className: 'rt-skill-row' + (active === s.name ? ' on' : '') + (s.availability === 'broken' ? ' broken' : ''),
        title: s.name + (s.description ? ' — ' + s.description : ''),
      }, clickable(() => open(s.name), { label: t('查看技能 ', 'View skill ') + s.name, expanded: active === s.name })),
        h('span', {
          className: 'rt-avail rt-avail-' + (s.availability || 'unknown'),
          title: (s.availability === 'available'
            ? t('可用：正文能加载，必需的环境变量/本机路径/基础设施都在', 'Available: body loads cleanly and required env/paths/services are ready')
            : (s.issues || []).map((x) => x.detail + (x.fix ? t('\n  修复：', '\n  Fix: ') + x.fix : '')).join('\n')
              || (s.problems || []).join('\n') || t('未知', 'Unknown')),
        }, s.availability === 'available' ? t('可用', 'Ready') : s.availability === 'broken' ? t('不可用', 'Broken') : t('未知', 'Unknown')),
        h('div', { className: 'rt-skill-main' },
          h('div', { className: 'rt-skill-name' }, s.name,
            s.modelInvocable === false ? h('span', { className: 'rt-tag', style: { marginLeft: 5 } }, t('仅人工', 'Manual')) : null),
          h('div', { className: 'rt-skill-desc' }, String(s.description || t('（无描述）', '(no description)')).replace(/[*`]/g, ''))),
        h('span', { className: 'rt-tag' }, catLabel(s.category)),
        h('span', { className: 'rt-tag' }, s.fromPlugin ? t('插件', 'Plugin') : t('用户', 'User')),
        (s.problems || []).length > 0 && s.availability !== 'available'
          ? h('span', { className: 'rt-avail rt-avail-broken', title: String((s.issues && s.issues[0] && s.issues[0].detail) || s.problems[0]) }, '!')
          : null))

      return h('div', { className: 'rt-split' },
        h('div', { className: 'rt-list' },
          h('input', {
            className: 'rt-input', style: { width: '100%', marginBottom: 8, boxSizing: 'border-box' },
            placeholder: t('过滤技能', 'Filter skills'), value: q, onChange: (e) => setQ(e.target.value),
          }),
          h('select', {
            className: 'rt-input', style: { width: '100%', marginBottom: 8, boxSizing: 'border-box' },
            value: effectiveCat, onChange: (e) => setCat(e.target.value),
          },
            h('option', { value: '' }, t('全部分类', 'All Categories') + ' (' + scoped.length + ')'),
            cats.map((c) => h('option', { key: c, value: c },
              catLabel(c) + ' (' + scoped.filter((s) => (s.category || '未分类') === c).length + ')'))),
          h('label', { className: 'rt-kb-check', style: { display: 'flex', margin: '0 0 6px' } },
            h('input', { type: 'checkbox', checked: redteamOnly, onChange: (e) => setRedteamOnly(e.target.checked) }),
            t('只看研发技能（' + redteamCount + ' 个，隐藏 DSH 通用）', 'Engineering skills only (' + redteamCount + ', hide host generic)')),
          h('label', { className: 'rt-kb-check', style: { display: 'flex', margin: '0 0 6px' } },
            h('input', { type: 'checkbox', checked: srcOnly, onChange: (e) => setSrcOnly(e.target.checked) }),
            t('只看本插件自带（' + (meta.fromPlugin || 0) + ' 个）', 'Built-in plugin skills only (' + (meta.fromPlugin || 0) + ')')),
          availSummary && (availSummary.broken > 0 || availSummary.unknown > 0)
            ? h('label', {
                className: 'rt-kb-check', style: { display: 'flex', margin: '0 0 8px' },
                title: t('只看不可用（缺 key / 缺本机路径 / 基础设施还是占位符）或判不了可用性的技能', 'Show only broken or unknown-availability skills'),
              },
                h('input', { type: 'checkbox', checked: brokenOnly, onChange: (e) => setBrokenOnly(e.target.checked) }),
                t('只看不可用/未知（' + ((availSummary.broken || 0) + (availSummary.unknown || 0)) + ' 个）', 'Broken / Unknown only (' + ((availSummary.broken || 0) + (availSummary.unknown || 0)) + ')'))
            : null,
          availSummary
            ? h('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 } },
                h('span', { className: 'rt-avail rt-avail-available' }, t('可用 ', 'Ready ') + (availSummary.available || 0)),
                availSummary.broken > 0 ? h('span', { className: 'rt-avail rt-avail-broken' }, t('不可用 ', 'Broken ') + availSummary.broken) : null,
                availSummary.unknown > 0 ? h('span', { className: 'rt-avail rt-avail-unknown' }, t('未知 ', 'Unknown ') + availSummary.unknown) : null,
                h('span', Object.assign({
                  className: 'rt-tag', style: { cursor: 'pointer' },
                  title: t('技能正文或环境变量刚改过？点这里跳过 30 秒缓存重查', 'Re-check skill availability bypassing the 30s cache'),
                }, clickable(() => load(true), { label: t('重新检查技能可用性', 'Re-check skill availability') })), t('重查可用性', 'Re-check')))
            : null,
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginBottom: 6 } },
            t('共 ' + items.length + ' 个技能 · 当前显示 ' + filtered.length + ' 个 · 来自 ' + ((meta.byDir || []).length) + ' 个目录',
              'Total ' + items.length + ' skills · Showing ' + filtered.length + ' · From ' + ((meta.byDir || []).length) + ' dirs'),
            items.length > 100 ? h('div', { style: { marginTop: 3 } },
              t('（技能多来自其它插件注册的根或你自己的技能目录；本插件只自带 ' + (meta.fromPlugin || 0) + ' 个）',
                '(Many skills come from other plugins or your custom dir; this plugin includes ' + (meta.fromPlugin || 0) + ')')) : null),
          listItems),
        h('div', { className: 'rt-main' },
          h('div', { className: 'rt-toolbar' },
            h('span', { style: { fontWeight: 600 } }, detail ? detail.name : t('研发技能库', 'Skill Library')),
            h('div', { className: 'rt-spacer' }),
            h('button', { className: 'rt-btn', disabled: busy, onClick: () => load(true) }, busy ? t('刷新中…', 'Refreshing…') : t('刷新', 'Refresh'))),
          err
            ? (needRestart
                ? h('div', { className: 'rt-empty' }, t('该模块的宿主代码已更新，需重启一次 dsh web 后生效', 'Host plugin code updated; restart dsh web to apply'))
                : h('div', { className: 'rt-err' }, err))
            : null,
          detail
            ? h('div', { className: 'rt-pane' },
                h('div', { className: 'rt-kv' }, h('b', null, t('描述', 'Description')), h('span', null, detail.description || '—')),
                h('div', { className: 'rt-kv' }, h('b', null, t('分类', 'Category')), h('span', null, catLabel(detail.category))),
                h('div', { className: 'rt-kv' }, h('b', null, t('何时使用', 'When to Use')), h('span', null, detail.whenToUse || '—')),
                h('div', { className: 'rt-kv' }, h('b', null, t('来源', 'Source')), h('span', null, (detail.provider || '—') + ' / ' + (detail.source || '—'))),
                (() => {
                  const s2 = items.find((x) => x.name === detail.name)
                  if (!s2) return null
                  const avail = s2.availability || 'unknown'
                  return h('div', null,
                    h('div', { className: 'rt-kv' }, h('b', null, t('可用性', 'Availability')),
                      h('span', { className: 'rt-avail rt-avail-' + avail },
                        avail === 'available' ? t('可用', 'Ready') : avail === 'broken' ? t('不可用', 'Broken') : t('未知（正文读不到）', 'Unknown (unreadable)'))),
                    (s2.issues || []).length > 0
                      ? h('div', { className: 'rt-kv' }, h('b', null, t('不可用原因', 'Issues')),
                          h('span', null, s2.issues.map((x, i) => h('div', { key: 'i' + i, style: { marginBottom: 6 } },
                            h('div', null, '· ' + x.detail),
                            x.fix
                              ? h('div', { style: { marginLeft: 14, color: 'var(--dsw-alias-label-secondary)' } }, t('修复：', 'Fix: ') + x.fix)
                              : null))))
                      : (s2.problems || []).length > 0
                        ? h('div', { className: 'rt-kv' }, h('b', null, t('不可用原因', 'Issues')),
                            h('span', null, s2.problems.map((x, i) => h('div', { key: 'p' + i }, '· ' + x))))
                        : null,
                    (s2.needs_user || []).length > 0
                      ? h('div', { className: 'rt-kv' }, h('b', null, t('需要你提供', 'Action Needed')),
                          h('span', { style: { color: 'var(--dsw-alias-state-warn-primary, #f59e0b)' } },
                            s2.needs_user.map((x, i) => h('div', { key: 'n' + i }, '· ' + x))))
                      : null)
                })(),
                detail.path ? h('div', { className: 'rt-kv' }, h('b', null, t('文件', 'File')), h('span', { className: 'rt-mono', style: { wordBreak: 'break-all' } }, detail.path)) : null,
                h(Markdown, {
                  className: 'rt-markdown rt-md-view', text: detail.content || t('（空）', '(empty)'),
                  style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, maxHeight: '52vh' },
                }))
            : h('div', { className: 'rt-pane' },
                h('div', { className: 'rt-kv' }, h('b', null, t('技能', 'Skills')),
                  h('span', null, t('共 ', 'Total ') + items.length + t(' 个', '')
                    + (availSummary ? ' · ' + t('可用 ', 'Ready ') + (availSummary.available || 0)
                      + ' / ' + t('不可用 ', 'Broken ') + (availSummary.broken || 0)
                      + ' / ' + t('未知 ', 'Unknown ') + (availSummary.unknown || 0) : ''))),
                h('div', { className: 'rt-foot', style: { marginBottom: 8 } },
                  t('从左侧选择技能查看正文与可用性。', 'Select a skill on the left to inspect its prompt and availability.')),
                meta.availability && (meta.availability.broken || []).length > 0
                  ? h('div', { className: 'rt-hint' },
                      h('div', { style: { fontWeight: 600, marginBottom: 4 } }, t('现在跑不起来的技能：', 'Unavailable skills:')),
                      meta.availability.broken.slice(0, 12).map((b) => h('div', { key: b.name },
                        '· ' + b.name + ' — '
                        + String((b.issues && b.issues[0] && b.issues[0].detail) || (b.problems && b.problems[0]) || t('未知', 'Unknown'))
                        + (b.issues && b.issues[0] && b.issues[0].fix ? ' (' + b.issues[0].fix + ')' : ''))))
                  : h('div', { className: 'rt-empty' }, t('没有不可用技能；左侧选择技能查看正文。', 'All skills available; select a skill on the left to read.')))))
    }

    /* ---------------------------------------------------------- 代码审查与缺陷 */
    const SEV_LABEL = { critical: '严重', high: '高危', medium: '中危', low: '低危', info: '信息' }
    const SEV_LABEL_EN = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' }
    const STATUS_LABEL = { candidate: '待验证', confirmed: '已确认', 'false-positive': '误报', exploited: '已利用', fixed: '已修复' }
    const STATUS_LABEL_EN = { candidate: 'Pending', confirmed: 'Confirmed', 'false-positive': 'False Positive', exploited: 'Verified', fixed: 'Fixed' }
    const sevLabel = (s) => t(SEV_LABEL[s] || s, SEV_LABEL_EN[s] || s)
    const vulnStatusLabel = (s) => t(STATUS_LABEL[s] || s, STATUS_LABEL_EN[s] || s)
    const sevClass = (s) => 'rt-sev rt-sev-' + (SEV_LABEL[s] ? s : 'info')

    /** 目标归并：按「scheme://host:port」聚合，避免带路径的 URL 把分组打散。 */
    function targetKeyOf(v) {
      const targetStr = String(v.target || '').trim()
      if (targetStr !== '') {
        const url = /^([a-z][a-z0-9+.-]*:\/\/[^/?#\s]+)/i.exec(targetStr)
        if (url) return url[1]
        const head = /^([^\s/?#]+)/.exec(targetStr)
        if (head) return head[1]
        return targetStr
      }
      return v.asset_ip || t('(未指定目标)', '(No target specified)')
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
          h('div', { className: 'rt-evi-head' }, t('证据摘要', 'Evidence Summary'),
            h('span', { className: 'rt-tag' }, looksHttp ? t('原始报文', 'Raw HTTP') : t('文本', 'Text')),
            h('div', { className: 'rt-spacer' }),
            h('button', {
              className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
              onClick: (e) => { e.stopPropagation(); copyText(evi) },
            }, t('复制', 'Copy'))),
          looksHttp ? h(HttpBlock, { text: evi }) : h('pre', { className: 'rt-evi-body' }, evi)))
      }
      const http = v.http_evidence || []
      for (const e of http) {
        blocks.push(h('div', { key: 'h' + e.id, className: 'rt-evi' },
          h('div', { className: 'rt-evi-head' },
            e.label || t('HTTP 证据', 'HTTP Evidence'),
            h('span', { className: 'rt-tag' }, (e.method || '') + ' ' + (e.status === null || e.status === undefined ? '' : e.status)),
            h('div', { className: 'rt-spacer' }),
            h('span', { style: { fontWeight: 400, color: 'var(--dsw-alias-label-secondary)' } }, fmt(e.captured_at || e.created_at))),
          e.request ? h('div', null,
            h('div', { className: 'rt-evi-head', style: { borderTop: 'none' } }, t('▸ 请求报文（可用于接口联调复现）', '▸ Request (reproducible payload)')),
            h(HttpBlock, { text: e.request, compact: true })) : null,
          e.response ? h('div', null,
            h('div', { className: 'rt-evi-head' }, t('▸ 响应', '▸ Response')),
            h(HttpBlock, { text: e.response })) : null,
          e.note ? h('pre', { className: 'rt-evi-body', style: { maxHeight: 80 } }, e.note) : null))
      }
      if (blocks.length === 0) {
        blocks.push(h('div', { key: 'none', className: 'rt-kv' }, h('b', null, t('证据', 'Evidence')),
          h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } },
            t('缺失 —— 未验证/无证据的记录不计入交付报告，请补 lmt_artifact_record (kind=evidence)', 'Missing — unverified/no-evidence items are excluded from reports; add via lmt_artifact_record (kind=evidence)'))))
      }
      return h('div', { key: 'eviwrap' }, blocks)
    }

    /* ---------------------------------------------------------- 配置凭据 / 连接会话 / 构建产物 */
    function CredentialList(props) {
      useLocale()
      const creds = props.items || []
      if (!creds.length) return h('div', { className: 'rt-empty' }, t('暂无凭据（录入配置密钥或连接参数后默认脱敏展示，秒级可复用）', 'No credentials yet (secrets are masked by default when saved)'))
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
          }, t('复制', 'Copy'))),
        h(SecretText, { value: c.secret_value, className: 'rt-secret', empty: t('未记明文 —— 请补充 secret_value 后面板才能脱敏预览', 'No plaintext — set secret_value to enable masked preview') }),
        h('div', { className: 'rt-cred-meta' },
          [c.source ? t('来源 ', 'Source ') + c.source : null,
            c.tool ? t('工具 ', 'Tool ') + c.tool : null,
            c.secret_ref ? t('证据 ', 'Ref ') + c.secret_ref : null,
            c.found_by_agent ? 'by ' + c.found_by_agent : null,
            c.found_at ? fmt(c.found_at) : null].filter(Boolean).join(' · ')),
        c.note ? h('div', { className: 'rt-cred-meta' }, t('备注：', 'Note: ') + c.note) : null)))
    }

    function AccessList(props) {
      useLocale()
      const accesses = props.items || []
      if (!accesses.length) return h('div', { className: 'rt-empty' }, t('暂无访问会话', 'No active access sessions'))
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
      useLocale()
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
          h('span', { style: { fontWeight: 600 } }, t('配置与构建产物', 'Config & Build Artifacts')),
          h('span', { className: 'rt-tag' }, t('环境变量与密钥 ', 'Env & Keys ') + creds.length),
          h('span', { className: 'rt-tag' }, t('活跃服务连接 ', 'Active Connections ') + accesses.length),
          h('span', { className: 'rt-tag' }, t('构建与验证脚本 ', 'Build & Verification Scripts ') + fileCount),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? t('刷新中…', 'Refreshing…') : t('刷新', 'Refresh'))),
        err ? h('div', { className: 'rt-err' }, err) : null,
        h('div', { className: 'rt-body', style: { overflow: 'auto' } },
          h('details', { className: 'rt-card' },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, t('环境变量与密钥 · ', 'Env & Keys · ') + creds.length + t('（默认脱敏，点开查看）', ' (masked by default; click to expand)')),
            h(CredentialList, { items: creds })),
          h('details', { className: 'rt-card' },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, t('活跃服务连接 · ', 'Active Connections · ') + accesses.length),
            h(AccessList, { items: accesses })),
          h('details', { className: 'rt-card' },
            h('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, t('构建与验证脚本 · ', 'Build & Verification Scripts · ') + fileCount),
            h(AttackFilesTab, { engagement: eng, refreshKey: refreshKey }))))
    }

    function FindingsTab(props) {
      useLocale()
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
            setState({ loading: false, error: (r && r.error) || t('查询失败', 'Query failed'), total: 0, items: [], stats: null })
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
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || t('更新失败', 'Update failed') }); return }
          setMsg({ ok: t('已更新为「', 'Updated to "') + vulnStatusLabel(next) + t('」', '"') })
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
      const conclusion = h('div', { className: 'rt-concl' },
        h('span', { className: 'rt-concl-group' }, t('质量', 'Quality')),
        ConclItem('exp', t('已确认修复/验证', 'Verified / Fixed'), (stats.byStatus.exploited || 0), status === 'exploited', () => setStatus((v) => (v === 'exploited' ? '' : 'exploited'))),
        ConclItem('gain', t('影响范围', 'Impact Scope'), (stats.withGained || 0), gainOnly, () => setGainOnly((v) => !v)),
        h('span', { className: 'rt-concl-group' }, t('等级', 'Severity')),
        ConclItem('crit', t('严重', 'Critical'), (stats.bySeverity.critical || 0), sev === 'critical', () => setSev((v) => (v === 'critical' ? '' : 'critical'))),
        ConclItem('high', t('高危', 'High'), (stats.bySeverity.high || 0), sev === 'high', () => setSev((v) => (v === 'high' ? '' : 'high'))),
        h('details', { className: 'rt-concl-extra' },
          h('summary', null, t('已确认 ', 'Confirmed ') + (stats.byStatus.confirmed || 0) + t(' · 中危 ', ' · Medium ') + (stats.bySeverity.medium || 0)),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 4 } },
            ConclItem('conf', t('已确认', 'Confirmed'), (stats.byStatus.confirmed || 0), status === 'confirmed', () => setStatus((v) => (v === 'confirmed' ? '' : 'confirmed'))),
            ConclItem('med', t('中危', 'Medium'), (stats.bySeverity.medium || 0), sev === 'medium', () => setSev((v) => (v === 'medium' ? '' : 'medium'))))),
        h('div', { className: 'rt-spacer' }),
        h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
          t('默认按模块聚合 · 当前显示 ', 'Grouped by module · Showing ') + visibleItems.length + t(' / 共 ', ' / ') + (state.total || 0) + t(' 条 · ', ' · ') + (stats.targetGroups || 0) + t(' 个目标模块', ' target groups')))

      const head = h('div', { className: 'rt-vrow head' },
        h('span', null, t('等级', 'Severity')), h('span', null, t('缺陷 / 编号', 'Finding / ID')), h('span', null, t('目标模块', 'Module')),
        h('span', null, t('影响范围', 'Impact')), h('span', null, t('状态', 'Status')), h('span', null, t('置信', 'Conf.')))

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
        out.push(h('div', Object.assign({
          key: 'v' + v.id, className: 'rt-vrow',
          style: compact ? { cursor: 'pointer', gridTemplateColumns: '58px minmax(0,1fr) 104px 68px' } : { cursor: 'pointer' },
        }, clickable(() => setOpenId(open ? null : v.id))),
          h('span', null, h('span', { className: sevClass(v.severity) }, sevLabel(v.severity))),
          h('span', { title: v.title || '' }, h('span', { className: 'rt-sec-caret' }, open ? '▾' : '▸'), (v.cve ? v.cve + ' ' : '') + (v.title || '')),
          compact ? null : h('span', { className: 'rt-mono', title: v.target || '' }, v.target || v.asset_ip || '—'),
          h('span', { title: v.gained || '' },
            gainedList.length
              ? h('span', { className: 'rt-gain', style: { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' } }, gainedList[0] + (gainedList.length > 1 ? ' +' + (gainedList.length - 1) : ''))
              : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '—')),
          h('span', null, h('span', { className: 'rt-tag' }, vulnStatusLabel(v.status))),
          compact ? null : h('span', null, v.confidence === null || v.confidence === undefined ? '—' : Math.round(v.confidence * 100) + '%')))
        if (openId !== v.id) return out
        out.push(h('div', {
          key: 'vd' + v.id, className: 'rt-vrow',
          style: { cursor: 'default', gridTemplateColumns: '1fr' },
        }, h('div', { className: 'rt-vdetail' },
          h('div', { className: 'rt-kv' }, h('b', null, t('影响范围', 'Impact Scope')),
            gainedList.length
              ? h('span', null, gainedList.map((g, gi) => h('span', { key: 'g' + gi, className: 'rt-gain', style: { marginRight: 6 } }, g)))
              : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                  t('未记录 —— 验证确认影响范围后请用 lmt_artifact_record 补充 gained', 'Not recorded — update gained via lmt_artifact_record after verification'))),
          h('div', { className: 'rt-kv' }, h('b', null, t('目标模块', 'Module')), h('span', { className: 'rt-mono', style: { wordBreak: 'break-all' } }, v.target || '—')),
          h('div', { className: 'rt-kv' }, h('b', null, t('所属节点', 'Host')), h('span', null, (v.asset_ip || '—') + ' · ' + (v.segment_cidr || ''))),
          h('div', { className: 'rt-kv' }, h('b', null, t('来源', 'Source')), h('span', null, (v.source || '—') + ' · ' + (v.found_by_agent || '—') + ' · ' + fmt(v.found_at))),
          detailEvidence(v),
          (() => {
            const mine = filesByVuln.get(Number(v.id)) || []
            return h('div', { className: 'rt-kv' }, h('b', null, t('构建与验证脚本', 'Build & Verification Scripts')),
              mine.length
                ? h('span', null, mine.map((f, fi) => h('div', { key: 'af' + fi, style: { marginBottom: 3 } },
                    '· ' + (f.kind ? '[' + f.kind + '] ' : '') + (f.name || t('(未命名)', '(unnamed)'))
                    + (f.description ? ' — ' + f.description : ''),
                    h('div', { className: 'rt-mono', style: { fontSize: 11, marginLeft: 12, color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere' } }, f.path || ''))))
                : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                    t('（无）用 lmt_artifact_record (kind=evidence) 把该缺陷关联的复现测试或修复脚本归档，并带上 vuln_id', '(none) Attach repro/fix scripts with lmt_artifact_record (kind=evidence) and vuln_id')))
          })(),
          h('div', { className: 'rt-actions' },
            h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setVulnStatus(v.id, 'confirmed') } }, t('确认', 'Confirm')),
            h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setVulnStatus(v.id, 'exploited') } }, t('已验证', 'Verified')),
            h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setVulnStatus(v.id, 'false-positive') } }, t('误报', 'False Positive')),
            h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); setVulnStatus(v.id, 'fixed') } }, t('已修复', 'Fixed'))))))
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
            count: g.vulns.length + t(' 项缺陷', ' findings'),
            sub: [
              sevLabel(g.top.severity),
              g.exploited ? t('已验证 ', 'Verified ') + g.exploited : null,
              g.top.asset_ip && g.top.asset_ip !== g.key ? t('节点 ', 'Host ') + g.top.asset_ip : null,
            ].filter(Boolean).join(' · '),
            right: g.gained.length
              ? g.gained.slice(0, 2).join(' / ') + (g.gained.length > 2 ? ' +' + (g.gained.length - 2) : '')
              : t('未记录影响范围', 'No impact recorded'),
            open: collapse.isOpen(key, defOpen),
            onToggle: collapse.toggle(key, defOpen),
          }, g.vulns.map((v) => vulnRows(v, true))))
        }
        if (!list.length && !state.loading && !state.error) {
          rows.push(h('div', { key: 'none', className: 'rt-empty' }, resultsOnly ? t('当前没有已确认修复/验证的关键缺陷；点「显示全部」看全部审查记录。', 'No verified/fixed key findings; click "Show All" to inspect all records.') : t('暂无审查与缺陷记录', 'No review or defect records yet')))
        }
      } else {
        for (const v of visibleItems) rows.push(...vulnRows(v))
      }

      const toolbar = h('div', { className: 'rt-toolbar' },
        h('input', {
          className: 'rt-input', style: { flex: '1 1 140px' }, placeholder: t('搜索标题 / 编号 / 模块（回车）', 'Search title / ID / module (Enter)'),
          value: q, onChange: (e) => setQ(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') setQApplied(q) },
        }),
        h('button', { className: 'rt-btn', onClick: () => setQApplied(q) }, t('搜索', 'Search')),
        h('select', { className: 'rt-input', value: sev, onChange: (e) => setSev(e.target.value) },
          h('option', { value: '' }, t('全部等级', 'All Severities')),
          h('option', { value: 'critical' }, t('严重', 'Critical')),
          h('option', { value: 'high' }, t('高危', 'High')),
          h('option', { value: 'medium' }, t('中危', 'Medium')),
          h('option', { value: 'low' }, t('低危', 'Low')),
          h('option', { value: 'info' }, t('信息', 'Info'))),
        h('select', { className: 'rt-input', value: status, onChange: (e) => setStatus(e.target.value) },
          h('option', { value: '' }, t('全部状态', 'All Statuses')),
          h('option', { value: 'candidate' }, t('待验证', 'Pending')),
          h('option', { value: 'confirmed' }, t('已确认', 'Confirmed')),
          h('option', { value: 'exploited' }, t('已确认修复/验证', 'Verified / Fixed')),
          h('option', { value: 'false-positive' }, t('误报', 'False Positive')),
          h('option', { value: 'fixed' }, t('已修复', 'Fixed'))),
        h('button', {
          className: 'rt-btn' + (resultsOnly ? ' rt-btn-primary' : ''),
          title: t('默认只显示已验证或已记录影响范围的关键缺陷；点一下显示全部候选/已确认项', 'Show only verified or impact-recorded key findings; click to show all'),
          onClick: () => setResultsOnly((v) => !v),
        }, resultsOnly ? t('只看关键缺陷 ✓', 'Key Findings Only ✓') : t('显示全部', 'Show All')))

      return h('div', { className: 'rt-main' }, toolbar, conclusion,
        h('div', { className: 'rt-subtabs' },
          h('span', { className: 'rt-subtab on' }, t('审查项 ', 'Items ') + visibleItems.length),
          h('div', { className: 'rt-spacer' }),
          grouped ? h('button', {
            className: 'rt-btn', title: t('展开所有目标模块', 'Expand all target modules'),
            onClick: () => collapse.setAll(visibleItems.map((v) => 'target:' + targetKeyOf(v)), true),
          }, t('全部展开', 'Expand All')) : null,
          grouped ? h('button', {
            className: 'rt-btn', title: t('收起所有目标模块', 'Collapse all target modules'),
            onClick: () => collapse.setAll(visibleItems.map((v) => 'target:' + targetKeyOf(v)), false),
          }, t('全部收起', 'Collapse All')) : null,
          h('button', {
            className: 'rt-btn' + (grouped ? ' rt-btn-primary' : ''),
            title: grouped ? t('当前：按目标模块聚合', 'Current: Grouped by module') : t('当前：平铺每条缺陷', 'Current: Flat list'),
            onClick: () => setGrouped((g) => !g),
          }, grouped ? t('按目标聚合', 'Group by Module') : t('平铺列表', 'Flat List'))),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        needRestart ? h('div', { className: 'rt-empty' }, t('该模块的宿主代码已更新，需重启一次 dsh web 后生效', 'Host plugin code updated; restart dsh web to apply')) : null,
        state.error && !needRestart ? h('div', { className: 'rt-err' }, state.error) : null,
        h('div', { className: 'rt-table' }, grouped ? null : head, rows,
          !state.loading && !visibleItems.length && !state.error
            ? h('div', { className: 'rt-empty' }, resultsOnly ? t('当前没有已确认修复/验证的关键缺陷；点「显示全部」看全部审查记录。', 'No verified/fixed key findings; click "Show All" to inspect all records.') : t('暂无审查与缺陷记录', 'No review or defect records yet'))
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
        groups.push({ code: 'other', name: t('其他得分', 'Other Milestones'), color: '#64748b', ordinal: groups.length + 1,
          points: rest.reduce((n, x) => n + (x.counted ? x.points : 0), 0),
          cumulative: 0, items: rest })
      }
      return groups
    }

    /* ---------------------------------------------------------- 报告 v2：模板化页面 */
    function ReportV2(props) {
      useLocale()
      const { report, eng, mdText, busy, load, copy, download, msg } = props
      const summary = report.summary || {}
      const table = (headers, rows) => {
        const head = h('thead', null, h('tr', null, headers.map((v, i) => h('th', { key: 'h' + i }, v))))
        const body = h('tbody', null, (rows || []).map((row, ri) => h('tr', { key: 'r' + ri },
          row.map((v, ci) => h('td', { key: 'c' + ci }, v === null || v === undefined || v === '' ? '—' : v)))))
        return h('div', { className: 'rt-r2-table-wrap' },
          h('table', { className: 'rt-r2-table' }, head, body))
      }
      const strengthLabel = (s) => s === '强' ? t('强', 'Strong') : (s === '弱' ? t('弱', 'Weak') : s)
      const proofCard = (g) => h('div', { className: 'rt-r2-proof', key: 'proof' + (g.asset.id || g.asset.ip) },
        h('div', { className: 'rt-r2-proof-head' },
          h('b', { className: 'rt-mono' }, g.asset.ip || g.asset.primary_name || t('未命名资产', 'Unnamed Module')),
          g.asset.primary_name ? h('span', { className: 'rt-r2-muted' }, g.asset.primary_name) : null,
          h('div', { className: 'rt-spacer' }),
          h('span', { className: 'rt-tag' }, g.type),
          h('span', { className: 'rt-tag ' + (g.strength === '强' ? 'rt-tag-live' : 'rt-tag-warn') }, t('证明 ', 'Proof ') + strengthLabel(g.strength))),
        h('div', { className: 'rt-r2-proof-line' }, h('b', null, t('归属证据 ', 'Ownership Proof ')), g.proof || t('待补', 'Pending')),
        (g.shots || []).length > 0
          ? h(ShotStrip, { eng: eng, shots: g.shots, total: g.shots.length, title: t('归属截图', 'Ownership Screenshots') })
          : h('div', { className: 'rt-r2-empty' }, t('归属截图待补', 'Ownership screenshots pending')))
      const proofSection = (title, list) => h('div', null,
        h('h3', { className: 'rt-r2-h3' }, title),
        (list || []).length === 0
          ? h('div', { className: 'rt-r2-empty' }, t('未采集到对应资产证据。', 'No matching module proof collected.'))
          : h('div', { className: 'rt-r2-proof-grid' }, list.map(proofCard)))
      const code = (text, label) => h('div', { className: 'rt-r2-code' },
        h('div', { className: 'rt-r2-code-head' },
          h('span', null, label), h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', onClick: () => copy(String(text || ''), label) }, t('复制', 'Copy'))),
        h('pre', { className: 'rt-r2-pre' }, String(text || '')))
      const reproItem = (x, heading) => h('div', { className: 'rt-r2-item', key: 'ri' + heading },
        h('h5', { className: 'rt-r2-h5' }, heading + ' ' + (x.target || x.asset_ip || '')),
        h('div', { className: 'rt-r2-item-line' },
          h('b', null, t('变更说明 ', 'Change Summary ')),
          x.vuln ? [x.vuln.cve, x.vuln.title].filter(Boolean).join(' ') : (x.how || x.point_name)),
        x.vuln_source === 'step' ? h('div', { className: 'rt-r2-muted' }, t('关联自研发执行步骤，记分时未显式填写', 'Linked from engineering step')) : null,
        x.evidence ? h('div', { className: 'rt-r2-item-line' }, h('b', null, t('结果 ', 'Result ')), x.evidence) : null,
        x.replay_cmd ? code(x.replay_cmd, /^(powershell|pwsh)/i.test(x.replay_cmd) ? 'PowerShell' : t('Bash / 命令', 'Bash / Command')) : null,
        (x.requests || []).slice(0, 3).map((q, qi) => q.request ? code(q.request, t('HTTP 报文 ', 'HTTP Request ') + (qi + 1)) : null),
        (!x.replay_cmd && !(x.requests || []).some((q) => q.request))
          ? h('div', { className: 'rt-r2-gap' }, t('复现缺口：没有留存真实命令或 HTTP 报文。', 'Repro gap: no replay command or HTTP payload recorded.')) : null,
        (x.attack_files || []).length > 0
          ? h('div', { className: 'rt-r2-item-line' }, h('b', null, t('构建与验证脚本 ', 'Build & Verification Scripts ')),
              h('span', { className: 'rt-mono' }, x.attack_files.map((f) => f.path).join(', '))) : null,
        (x.steps || []).some((s) => s.evidence_ref)
          ? h('div', { className: 'rt-r2-item-line' }, h('b', null, t('证据文件 ', 'Evidence Files ')),
              h('span', { className: 'rt-mono' }, Array.from(new Set(x.steps.map((s) => s.evidence_ref).filter(Boolean))).join(', '))) : null,
        (x.shots || []).length > 0 ? h(ShotStrip, { eng: eng, shots: x.shots, total: x.shots.length, title: t('复现截图', 'Repro Screenshots') }) : null,
        (x.gaps || []).length > 0 ? h('div', { className: 'rt-r2-gap' }, t('复现材料：', 'Missing Repro: ') + x.gaps.join('; ')) : null)
      const reproList = (list, headingPrefix, kind) => (list || []).map((g, i) => {
        if (kind === 'boundary') {
          return h('div', { className: 'rt-r2-group', key: 'b' + i },
            h('h4', { className: 'rt-r2-h4' }, headingPrefix + (i + 1) + t(' 联调通道', ' Bridge Channel ') + (i + 1)),
            h('div', { className: 'rt-r2-item-line' }, h('b', null, t('入口 ', 'Entry ')), h('span', { className: 'rt-mono' }, g.entry || '—')),
            g.tunnel
              ? h('div', { className: 'rt-r2-item-line' }, h('b', null, t('通道 ', 'Channel ')), h('span', { className: 'rt-mono' },
                  (g.tunnel.kind || 'socks5') + ' ' + (g.tunnel.listen || '') + (g.tunnel.reach ? ' → ' + g.tunnel.reach : '')))
              : h('div', { className: 'rt-r2-gap' }, t('通道记录缺失，需补联调证据。', 'Channel record missing; add bridge proof.')),
            g.tunnel && g.tunnel.command ? code(g.tunnel.command, t('通道建立命令', 'Channel Setup Command')) : null,
            g.items.map((x, j) => reproItem(x, headingPrefix + (i + 1) + '.' + (j + 1))))
        }
        if (kind === 'internet') {
          return h('div', { className: 'rt-r2-group', key: 'g' + i },
            h('h4', { className: 'rt-r2-h4' }, headingPrefix + (i + 1) + ' ' + (g.asset.ip || g.asset.primary_name || t('未命名模块', 'Unnamed Module'))),
            g.items.map((x, j) => reproItem(x, headingPrefix + (i + 1) + '.' + (j + 1))))
        }
        return h('div', { className: 'rt-r2-group', key: 's' + i },
          h('h4', { className: 'rt-r2-h4' }, headingPrefix + (i + 1) + ' ' + (g.label || t('网段', 'Group')) + ' "' + (g.cidr || t('未归属网段', 'Unassigned')) + '"'),
          (g.assets || []).map((a, ai) => h('div', { className: 'rt-r2-asset', key: 'a' + ai },
            h('h5', { className: 'rt-r2-h5' }, (a.asset.ip || a.asset.primary_name || t('未命名模块', 'Unnamed Module'))),
            a.items.map((x, xi) => reproItem(x, headingPrefix + (i + 1) + '.' + (ai + 1) + '.' + (xi + 1))))))
      })
      const stageSection = (s, i) => {
        const codeStr = s.code
        const list = (report.stage_tables && report.stage_tables[codeStr]) || []
        const headers = codeStr === 'internet' ? [t('序号', '#'), t('里程碑项', 'Milestone'), t('分值', 'Pts'), 'URL', t('凭据', 'Creds')]
          : codeStr === 'boundary' ? [t('序号', '#'), t('里程碑项', 'Milestone'), t('分值', 'Pts'), t('对外入口点', 'External Entry')]
            : [t('序号', '#'), t('里程碑项', 'Milestone'), t('分值', 'Pts'), t('模块', 'Module'), t('凭据', 'Creds')]
        const rows = list.map((r) => codeStr === 'internet' ? [r.seq, r.point_name, '+' + r.points, r.url, r.credential]
          : codeStr === 'boundary' ? [r.seq, r.point_name, '+' + r.points, r.entry]
            : [r.seq, r.point_name, '+' + r.points, r.asset, r.credential])
        return h('div', { key: 'st' + codeStr },
          h('h3', { className: 'rt-r2-h3' }, '2.' + (i + 1) + ' ' + s.name + ' (' + s.count + t(' 项', ' items') + ' / +' + s.points + t(' 分', ' pts') + ')'),
          list.length === 0 ? h('div', { className: 'rt-r2-empty' }, t('本阶段无里程碑项。', 'No milestones in this stage.')) : table(headers, rows))
      }
      return h('div', { className: 'rt-main rt-r2' },
        h('div', { className: 'rt-toolbar rt-r2-toolbar' },
          h('span', { style: { fontWeight: 700 } }, t('LMTAgent 研发交付报告', 'LMTAgent Delivery Report')),
          h('span', { className: 'rt-tag rt-tag-live' }, t('合计 ', 'Total ') + summary.points + t(' 分', ' pts')),
          h('span', { className: 'rt-tag' }, summary.count + t(' 项得分', ' achieved')),
          h('span', { className: 'rt-tag' + (summary.incomplete ? ' rt-tag-warn' : ' rt-tag-live') }, t('可复现 ', 'Reproducible ') + (summary.count - (summary.incomplete || 0)) + '/' + summary.count),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy || !mdText, onClick: () => copy(mdText, t('整份报告', 'Full Report')) }, t('复制全文', 'Copy All')),
          h('button', { className: 'rt-btn', disabled: busy || !mdText, onClick: () => download(mdText, report.target || eng) }, t('下载 .md', 'Download .md')),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? t('生成中…', 'Generating…') : t('重新生成', 'Regenerate'))),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        h('div', { className: 'rt-r2-scroll' },
          h('section', { className: 'rt-r2-section', id: 'rt-r2-assets' },
            h('h2', { className: 'rt-r2-h2' }, t('一、模块与服务归属证明', '1. Module & Service Ownership')),
            proofSection(t('1.1 对外服务模块归属证明', '1.1 External Service Ownership'), report.asset_proof && report.asset_proof.internet),
            proofSection(t('1.2 内部入口模块归属证明', '1.2 Internal Entry Ownership'), report.asset_proof && report.asset_proof.internal_entry)),
          h('section', { className: 'rt-r2-section', id: 'rt-r2-scores' },
            h('h2', { className: 'rt-r2-h2' }, t('二、里程碑得分汇总表', '2. Milestone Summary')),
            table([t('阶段', 'Stage'), t('计分项', 'Items'), t('得分', 'Points')], (report.stage_summary || []).map((s) => [s.name, s.count, '+' + s.points])),
            (report.stage_summary || []).map(stageSection)),
          h('section', { className: 'rt-r2-section', id: 'rt-r2-repro' },
            h('h2', { className: 'rt-r2-h2' }, t('三、里程碑交付复现', '3. Milestone Reproduction')),
            h('h3', { className: 'rt-r2-h3' }, t('3.1 对外服务模块交付复现', '3.1 External Module Reproduction')),
            (report.repro && report.repro.internet || []).length === 0 ? h('div', { className: 'rt-r2-empty' }, t('无对外服务模块得分项。', 'No external module items.')) : reproList(report.repro.internet, '3.1.', 'internet'),
            h('h3', { className: 'rt-r2-h3' }, t('3.2 跨网联调通道交付复现', '3.2 Bridge Channel Reproduction')),
            (report.repro && report.repro.boundary || []).length === 0 ? h('div', { className: 'rt-r2-empty' }, t('无跨网联调通道得分项。', 'No bridge channel items.')) : reproList(report.repro.boundary, '3.2.', 'boundary'),
            h('h3', { className: 'rt-r2-h3' }, t('3.3 内部服务模块交付复现', '3.3 Internal Module Reproduction')),
            (report.repro && report.repro.internal_segments || []).length === 0 ? h('div', { className: 'rt-r2-empty' }, t('无内部服务模块得分项。', 'No internal module items.')) : reproList(report.repro.internal_segments, '3.3.', 'internal'))))
    }

    function ReportTab(props) {
      useLocale()
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
          if (!r || r.ok === false) { setBusy(false); setErr((r && r.error) || t('生成失败', 'Generation failed')); return }
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
          setMsg({ ok: t('已下载：', 'Downloaded: ') + label })
        } catch (e) { setMsg({ err: t('下载失败：', 'Download failed: ') + ((e && e.message) || e) }) }
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
      }, '#' + x.seq + ' ' + x.point_name + ' · ' + (x.target || x.asset_ip || t('未标目标', 'Untargeted')) + ': '
        + ((x.gaps || []).join('; ') || t('缺少复现材料', 'Missing repro artifacts'))))
      const fullText = mdText
        .replace(/^<a id="[^"]*"><\/a>\s*$/gm, '')
        .replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, t('> 证据截图见下方卡片视图或导出包。', '> Screenshots are shown in card view or export bundle.'))
      const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳']

      const card = (x) => h('div', { key: 'r' + x.id, className: 'rt-rep' },
        h('div', { className: 'rt-rep-head' },
          h('span', { className: 'rt-rep-idx' }, String(x.seq)),
          h('span', { className: 'rt-rep-name' }, x.point_name),
          h('span', { className: 'rt-flow-pts' }, '+' + x.points + t(' 分', ' pts')),
          x.nth_of_point > 1 ? h('span', { className: 'rt-tag' }, t('同类第 ' + x.nth_of_point + ' 次', 'Occurrence #' + x.nth_of_point)) : null,
          h('div', { className: 'rt-spacer' }),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: () => copy((x.requests || []).map((v) => v.request || '').filter(Boolean).join('\n\n'), t('第 ' + x.seq + ' 项请求', 'Request #' + x.seq)),
          }, t('复制请求', 'Copy Request'))),
        h('div', { className: 'rt-rep-meta' },
          h('span', null, h('b', null, t('目标 ', 'Target '))), h('span', { className: 'rt-mono' }, x.target || x.asset_ip || '—')),
        x.gained ? h('div', { className: 'rt-rep-meta' }, h('b', null, t('交付 ', 'Delivered ')), h('span', null, x.gained)) : null,
        x.vuln ? h('div', { className: 'rt-rep-meta' }, h('b', null, t('关联项 ', 'Linked Item ')),
          h('span', null, [x.vuln.cve, x.vuln.title].filter(Boolean).join(' ')
            + (x.vuln_source === 'step' ? t('（关联自研发执行步骤）', ' (linked from engineering step)') : ''))) : null,
        x.evidence ? h('div', { className: 'rt-rep-meta' }, h('b', null, t('结果 ', 'Result ')),
          h('span', null, String(x.evidence).replace(/\n+/g, ' '))) : null,
        x.recorded_at ? h('div', { className: 'rt-rep-meta' }, h('b', null, t('取得时间 ', 'Recorded ')),
          h('span', null, fmt(x.recorded_at) + (x.recorded_by ? ' (' + roleLabel(x.recorded_by) + ')' : ''))) : null,
        h(ShotStrip, { eng: eng, shots: x.shots, total: x.shot_total, title: t('证据截图', 'Evidence Screenshots') }),
        h('details', { className: 'rt-rep-trace', open: x.incomplete === true || (x.steps || []).length === 0 },
          h('summary', { className: 'rt-rep-trace-head', style: { cursor: 'pointer' } },
            h('span', { className: 'rt-rep-trace-title' }, t('复现步骤（点击展开）', 'Reproduction Steps (click to expand)')),
            (x.steps || []).length ? h('span', { className: 'rt-tag' }, (x.steps || []).length + t(' 个动作', ' steps')) : null,
            (x.credentials || []).length ? h('span', { className: 'rt-tag' }, (x.credentials || []).length + t(' 条凭据', ' creds')) : null,
            (x.tunnels || []).length ? h('span', { className: 'rt-tag' }, (x.tunnels || []).length + t(' 条通道', ' channels')) : null,
            x.incomplete ? h('span', { className: 'rt-tag rt-tag-warn' }, t('复现材料待补', 'Repro Incomplete')) : h('span', { className: 'rt-tag rt-tag-live' }, t('可复现', 'Reproducible'))),
          h('div', { style: { paddingTop: 6 } },
            x.how ? h('div', { className: 'rt-rep-trace-how' }, x.how) : null,
            (x.steps || []).length === 0
              ? h('div', { className: 'rt-rep-missing' },
                  t('本条未关联动作步骤，复现入口见上方「复现」。需要补记动作时用 lmt_artifact_record（title / detail / tool / result），也可带 point_code + evidence 一次完成。',
                    'No linked action steps. Add steps with lmt_artifact_record (title / detail / tool / result) or include point_code + evidence when recording.'))
              : (x.steps || []).map((s, si) => h('div', { key: 's' + s.id, className: 'rt-rep-step' },
                  h('div', { className: 'rt-rep-step-head' },
                    h('span', { className: 'rt-rep-step-no' }, String(si + 1)),
                    h('span', { className: 'rt-rep-step-title' }, s.title || t('(未命名动作)', '(unnamed step)')),
                    s.agent ? h('span', { className: 'rt-tag' }, roleLabel(s.agent)) : null,
                    s.stage_code ? h('span', { className: 'rt-tag' }, s.stage_code) : null,
                    s.inferred ? h('span', { className: 'rt-tag' }, t('按同模块推断', 'Inferred by module')) : null,
                    h('div', { className: 'rt-spacer' }),
                    s.recorded_at ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, fmt(s.recorded_at)) : null),
                  s.detail ? h('div', { className: 'rt-rep-step-detail' }, s.detail) : null,
                  h('div', { className: 'rt-rep-step-cmd' },
                    h('b', null, t('执行 ', 'Run ')),
                    s.tool
                      ? h('span', { className: 'rt-mono' }, s.tool)
                      : h('span', { style: { color: 'var(--dsw-alias-state-warn-primary, #f59e0b)' } }, t('未记录实际命令（lmt_artifact_record 的 tool）', 'No command recorded (tool in lmt_artifact_record)'))),
                  s.tool ? h('div', { style: { marginTop: 3 } },
                    h('button', {
                      className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
                      onClick: () => copy(String(s.tool), t('第 ' + (si + 1) + ' 步命令', 'Step ' + (si + 1) + ' Command')),
                    }, t('复制命令', 'Copy Command'))) : null,
                  s.result ? h('div', { className: 'rt-rep-step-result' }, h('b', null, t('结果 ', 'Result ')), String(s.result).replace(/\n+/g, ' ')) : null,
                  s.evidence_ref ? h('div', { className: 'rt-rep-step-result' }, h('b', null, t('证据 ', 'Evidence ')), h('span', { className: 'rt-mono' }, s.evidence_ref)) : null)),
            (x.credentials || []).length
              ? h('div', { className: 'rt-rep-src' },
                  h('div', { className: 'rt-rep-src-title' }, t('关联凭据（来源可追溯）', 'Linked Credentials (Traceable)')),
                  (x.credentials || []).map((c) => h('div', { key: 'c' + c.id, className: 'rt-kv' },
                    h('b', { className: 'rt-mono', style: { minWidth: 120 } }, c.host || '—'),
                    h('span', null, (c.username || t('(无用户名)', '(no user)')) + ' / ' + (c.secret_type || 'password')
                      + (c.privilege ? t(' · 权限 ', ' · Role ') + c.privilege : '')
                      + t(' · 来源 ', ' · Source ') + (c.source || t('未标注', 'Unspecified'))
                      + (c.tool ? t(' · 取得方式 ', ' · Via ') + String(c.tool).replace(/\n+/g, ' ').slice(0, 160) : '')))))
              : null,
            (x.tunnels || []).length
              ? h('div', { className: 'rt-rep-src' },
                  h('div', { className: 'rt-rep-src-title' }, t('用到的联调通道', 'Bridge Channels Used')),
                  (x.tunnels || []).map((tn) => h('div', { key: 't' + tn.id, className: 'rt-kv' },
                    h('b', { className: 'rt-mono', style: { minWidth: 120 } }, (tn.kind || 'socks5') + ' ' + (tn.listen || '')),
                    h('span', null, t('入口 ', 'Entry ') + (tn.entry || t('未登记', 'Unregistered'))
                      + (tn.reach ? t(' · 可达 ', ' · Reach ') + tn.reach : '')
                      + t(' · 目标侧 ', ' · Target side ') + (tn.entry_kind || t('未声明', 'Undeclared'))
                      + (tn.status ? ' · ' + tn.status : '')
                      + (tn.command ? t(' · 命令 ', ' · Cmd ') + String(tn.command).replace(/\n+/g, ' ').slice(0, 160) : '')))))
              : null,
            (x.webshells || []).length
              ? h('div', { className: 'rt-rep-src' },
                  h('div', { className: 'rt-rep-src-title' }, t('用到的服务端点', 'Service Endpoints Used')),
                  (x.webshells || []).map((w) => h('div', { key: 'w' + w.id, className: 'rt-kv' },
                    h('b', { className: 'rt-mono', style: { minWidth: 120 } }, w.shell_type || 'endpoint'),
                    h('span', null, (w.url || ''),
                      w.pass_key ? h(React.Fragment, null, t(' · 口令/密钥 ', ' · Secret '), h(SecretText, { value: w.pass_key })) : null,
                      (w.privilege ? t(' · 权限 ', ' · Role ') + w.privilege : '') + (w.status ? ' · ' + w.status : '')))))
              : null,
            (x.attack_files || []).length
              ? h('div', { className: 'rt-rep-src' },
                  h('div', { className: 'rt-rep-src-title' }, t('构建脚本（可复现路径）', 'Build Scripts (Reproducible Paths)')),
                  (x.attack_files || []).map((f) => h('div', { key: 'f' + f.id, className: 'rt-kv' },
                    h('b', { className: 'rt-mono', style: { minWidth: 120 } }, f.name || t('文件', 'File')),
                    h('span', null,
                      (f.kind ? ' · ' + f.kind : '')
                      + (f.description ? ' · ' + f.description : '')
                      + ' · ',
                      h('span', { className: 'rt-mono' }, f.path || '')))))
              : null,
            (x.gaps || []).length ? h('div', { className: 'rt-rep-missing' }, t('复现材料：', 'Missing Repro: ') + x.gaps.join('; ')) : null),
          (x.requests || []).length === 0
            ? h('div', { className: 'rt-rep-missing' }, t('本条没有原始 HTTP 报文（该成果经命令行/其他协议取得，复现入口见上方「复现步骤」）', 'No raw HTTP payload (verified via CLI/other protocol; see Reproduction Steps above)'))
            : (x.requests || []).map((r, ri) => h('div', { key: 'q' + ri, className: 'rt-rep-req' },
                h('div', { className: 'rt-rep-req-head' },
                  h('span', null, t('复现请求 ', 'Repro Request ') + (ri + 1) + (r.source === 'auto' ? t('（按目标路径自动匹配，请核对）', ' (auto-matched by target path; please verify)') : '')),
                  h('span', { className: 'rt-tag' }, (r.method || 'GET') + ' ' + (r.status === null || r.status === undefined ? '' : r.status)),
                  h('div', { className: 'rt-spacer' }),
                  h('button', {
                    className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
                    onClick: () => copy(String(r.request || ''), t('请求 ', 'Request ') + (ri + 1)),
                  }, t('复制请求报文', 'Copy Request'))),
                h('pre', { className: 'rt-rep-http' }, r.request || ((r.method || 'GET') + ' ' + (r.url || '') + ' HTTP/1.1')),
                r.response ? h('div', null,
                  h('div', { className: 'rt-rep-req-head' }, h('span', null, t('响应摘要', 'Response Summary'))),
                  h('pre', { className: 'rt-rep-http', style: { maxHeight: 160 } }, String(r.response).slice(0, 1600))) : null)),
          x.note ? h('div', { className: 'rt-rep-meta' }, h('b', null, t('备注 ', 'Note ')), h('span', null, x.note)) : null))

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, t('LMTAgent 研发交付报告（四段式）', 'LMTAgent Delivery Report (4-Stage)')),
          summary ? h('span', { className: 'rt-tag rt-tag-live' }, t('合计 ', 'Total ') + summary.points + t(' 分', ' pts')) : null,
          summary ? h('span', { className: 'rt-tag' }, summary.count + t(' 项得分', ' achieved')) : null,
          summary ? h('span', { className: 'rt-tag' + (summary.missingRequests ? '' : ' rt-tag-live') },
            summary.withRequests + '/' + summary.count + t(' 项带原始请求', ' with raw requests')) : null,
          summary ? h('span', {
            className: 'rt-tag' + (summary.incomplete ? ' rt-tag-warn' : ' rt-tag-live'),
            title: t('复现链是否完整：有执行步骤、写了实际命令、关联了缺陷/凭据/通道', 'Completeness of reproduction chain: steps, commands, linked items'),
          }, t('可复现 ', 'Reproducible ') + (summary.count - (summary.incomplete || 0)) + '/' + summary.count) : null,
          summary && summary.serviceCappedExcluded
            ? h('span', {
                className: 'rt-tag rt-tag-warn',
                title: (summary.serviceCapped || []).map((x) => (x.service || '') + ' | ' + (x.point_name || '')).join('\n')
                  || t('同一模块同一端口的重复命中：服务已拿满，不计分、不进报告', 'Duplicate hits on the same module & port: capped'),
              }, t('同服务已拿满不计分 ', 'Service-capped ') + summary.serviceCappedExcluded)
            : null,
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy || !mdText, onClick: () => copy(mdText, t('整份报告', 'Full Report')) }, t('复制全文', 'Copy All')),
          h('button', { className: 'rt-btn', disabled: busy || !mdText, onClick: () => download(mdText, (data && data.target) || eng) }, t('下载 .md', 'Download .md')),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? t('生成中…', 'Generating…') : t('重新生成', 'Regenerate'))),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        err ? h('div', { className: 'rt-err' }, err) : null,
        gapItems.length
          ? h('details', {
              className: 'rt-rep-gaps',
              style: { margin: '0 0 8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, padding: '6px 8px' },
            },
              h('summary', { style: { cursor: 'pointer', fontWeight: 600 } },
                t('复现缺口 ' + gapItems.length + ' 项（点击看要补什么）', 'Repro Gaps: ' + gapItems.length + ' items (click for details)')),
              h('div', { style: { marginTop: 6, maxHeight: 220, overflow: 'auto' } },
                gapPreview,
                gapItems.length > 12
                  ? h('div', { className: 'rt-foot' }, t('仅列前 12 项，其余见下方卡片。', 'Showing first 12 items; see cards below for the rest.'))
                  : null))
          : h('div', { className: 'rt-foot', style: { marginBottom: 6 } }, t('复现材料完整。', 'Reproduction artifacts complete.')),
        h('div', { className: 'rt-body', style: { overflow: 'auto' } },
          h('details', { className: 'rt-rep-full', style: { margin: '0 0 10px' } },
            h('summary', { className: 'rt-rep-trace-head', style: { cursor: 'pointer', fontWeight: 600 } },
              t('详细报告查看（架构归属 / 里程碑汇总 / 凭据汇总 / 交付复现）', 'Full Report Preview (Ownership / Milestones / Credentials / Reproduction)')),
            h('div', { className: 'rt-rep-full-body' },
              h('div', { className: 'rt-rep-full-head' },
                h('span', { style: { fontWeight: 600 } }, t('详细报告查看 · 全屏预览', 'Detailed Report · Full Preview')),
                h('div', { className: 'rt-spacer' }),
                h('button', {
                  className: 'rt-btn',
                  onClick: (e) => {
                    const d = e.currentTarget.closest('details')
                    if (d) d.open = false
                  },
                }, t('关闭', 'Close'))),
              h('div', { className: 'rt-foot', style: { padding: '4px 0' } },
                t('与导出 Markdown 同源；截图见卡片视图。', 'Same source as exported Markdown; screenshots shown in card view.')),
              h(Markdown, { className: 'rt-markdown', text: fullText }))),
          stages.length
            ? h('div', { className: 'rt-rep-list' },
                h('div', { className: 'rt-rep-tools' },
                  h('button', { className: 'rt-btn', onClick: () => collapse.setAll(stages.map((s) => 'st:' + s.code), true) }, t('全部展开', 'Expand All')),
                  h('button', { className: 'rt-btn', onClick: () => collapse.setAll(stages.map((s) => 'st:' + s.code), false) }, t('全部折叠', 'Collapse All'))),
                stages.map((st) => {
                  const open = collapse.isOpen('st:' + st.code, false)
                  const toggle = collapse.toggle('st:' + st.code, false)
                  return h('div', { key: 'g' + st.code, className: 'rt-rep-group' },
                    h('div', Object.assign({
                      className: 'rt-rep-stage',
                      style: { borderLeftColor: st.color },
                    }, clickable(toggle, { expanded: open })),
                      h('span', { className: 'rt-sec-caret' }, open ? '▾' : '▸'),
                      h('span', { className: 'rt-rep-no', style: { background: st.color } }, CIRCLED[st.ordinal - 1] || st.ordinal),
                      h('span', { className: 'rt-rep-stage-name' }, st.name),
                      h('span', { className: 'rt-rep-stage-n' }, st.items.length + t(' 项', ' items')),
                      h('div', { className: 'rt-spacer' }),
                      h('span', { className: 'rt-rep-pts', style: { background: st.color + '22', color: st.color, borderColor: st.color + '66' } },
                        '+' + st.points + t(' 分', ' pts')),
                      h('span', { className: 'rt-ap-cum' }, t('累计 ', 'Cumul. ') + st.cumulative + t(' 分', ' pts'))),
                    open ? h('div', { className: 'rt-rep-body' }, st.items.map(card)) : null)
                }))
            : (data === null ? h('div', { className: 'rt-empty' }, t('加载中…', 'Loading…'))
                : h('div', { className: 'rt-empty' },
                    h('div', null, t('暂无可交付的里程碑成果。', 'No deliverable milestone results yet.')),
                    h('div', { style: { marginTop: 6, fontSize: 12 } },
                      t('达成后使用 lmt_artifact_record 补充交付与验证记录。', 'Record milestones via lmt_artifact_record once completed.'))))),
        h('div', { className: 'rt-foot' },
          h('span', null, t('按「模块归属 → 里程碑汇总 → 凭据 → 交付复现」组织，凭据默认脱敏', 'Organized by Ownership → Milestones → Credentials → Reproduction; secrets masked by default'))))
    }

    /* ---------------------------------------------------------- 构建与验证脚本 */
    const FILE_KIND = { poc: '验证', exp: '自动化', script: '脚本', wordlist: '配置', other: '其他' }
    const FILE_KIND_EN = { poc: 'Verify', exp: 'Automation', script: 'Script', wordlist: 'Config', other: 'Other' }
    const fileKindLabel = (k) => t(FILE_KIND[k] || k || '—', FILE_KIND_EN[k] || k || '—')

    function AttackFilesTab(props) {
      useLocale()
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
          if (!r || r.ok === false) { setErr((r && r.error) || t('读取失败', 'Read failed')); return }
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
          else setErr((r && r.error) || t('读取失败', 'Read failed'))
        }, (e) => setErr(String((e && e.message) || e)))
      }

      const rows = []
      for (const folder of folders) {
        const fKey = 'folder:' + folder.folder
        const fileNodes = []
        for (const f of folder.files) {
          fileNodes.push(h('div', Object.assign({
            key: 'a' + f.id, className: 'rt-vrow', style: { gridTemplateColumns: '18px 1.2fr 60px 1.6fr', cursor: 'pointer' },
          }, clickable(() => openFile(f))),
            h('span', { className: 'rt-sec-caret' }, detail && detail.id === f.id ? '▾' : '▸'),
            h('span', { className: 'rt-mono' }, f.name),
            h('span', null, h('span', { className: 'rt-tag rt-tag-active' }, fileKindLabel(f.kind))),
            h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' }, title: f.description || '' }, f.description || '—')))
          if (!detail || detail.id !== f.id) continue
          fileNodes.push(h('div', {
            key: 'ad' + f.id, className: 'rt-vrow', style: { cursor: 'default', gridTemplateColumns: '1fr' },
          }, h('div', { className: 'rt-vdetail' },
            h('div', { className: 'rt-kv' }, h('b', null, t('效果', 'Effect')), h('span', null, detail.evidence || '—')),
            h('div', { className: 'rt-kv' }, h('b', null, t('路径', 'Path')), h('span', { className: 'rt-mono', style: { wordBreak: 'break-all' } }, detail.path)),
            h('div', { className: 'rt-kv' }, h('b', null, t('记录', 'Recorded')), h('span', null, fmt(detail.created_at) + (detail.created_by ? ' · ' + detail.created_by : ''))),
            /\.md$/i.test(detail.name || detail.path || '')
              ? h(Markdown, {
                  className: 'rt-markdown rt-md-view', text: detail.content || t('（空）', '(empty)'),
                  style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, maxHeight: '40vh' },
                })
              : h('pre', { className: 'rt-md', style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 6, maxHeight: '40vh', padding: '10px 12px' } }, detail.content || t('（空）', '(empty)')))))
        }
        rows.push(h(Section, {
          key: 'sec:' + folder.folder, tone: 'folder', title: folder.folder + '/',
          count: folder.count + t(' 个文件', ' files'),
          open: collapse.isOpen(fKey, true), onToggle: collapse.toggle(fKey, true),
        }, fileNodes.length ? fileNodes : h('div', { className: 'rt-atest-meta' }, t('（空）', '(empty)'))))
      }

      const total = folders.reduce((n, f) => n + f.count, 0)
      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, t('构建与验证脚本', 'Build & Verification Scripts')),
          h('span', { className: 'rt-tag' }, folders.length + t(' 个模块 / ', ' modules / ') + total + t(' 个文件', ' files')),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? t('刷新中…', 'Refreshing…') : t('刷新', 'Refresh'))),
        err ? h('div', { className: 'rt-err' }, err) : null,
        h('div', { className: 'rt-table' },
          rows,
          !folders.length ? h('div', { className: 'rt-empty' }, t('暂无构建与验证脚本', 'No build or verification scripts yet')) : null),
        h('div', { className: 'rt-foot' }, h('span', null, t('目录：attack-files/<模块|服务>/', 'Directory: attack-files/<module|service>/'))))
    }

    /* ---------------------------------------------------------- 工程模式与验证模板库（全局共享） */
    const POC_KIND_LABEL = { poc: '验证用例', exp: '回归脚本', script: '脚本', template: '模板', payload: '测试夹具' }
    const POC_KIND_LABEL_EN = { poc: 'Test Case', exp: 'Regression', script: 'Script', template: 'Template', payload: 'Fixture' }
    const POC_SOURCE_LABEL = { web: '开源社区', self: '自研沉淀', manual: '人工录入', 'nuclei-template': '标准模板', kb: '模式库' }
    const POC_SOURCE_LABEL_EN = { web: 'Open Source', self: 'In-House', manual: 'Manual', 'nuclei-template': 'Template', kb: 'Pattern KB' }
    const pocKindLabel = (k) => t(POC_KIND_LABEL[k] || k || '模板', POC_KIND_LABEL_EN[k] || k || 'Template')
    const pocSourceLabel = (s) => t(POC_SOURCE_LABEL[s] || s || '—', POC_SOURCE_LABEL_EN[s] || s || '—')

    function KnowledgeTab(props) {
      useLocale()
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
          if (!r || r.ok === false) { setErr((r && r.error) || t('读取失败', 'Read failed')); return }
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
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || t('读取失败', 'Read failed') }); return }
          setDetail(r)
        }, (e) => { setDetailBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const copy = (text, label) => copyWithFeedback(text, label, (okFlag, message) => {
        setMsg(okFlag ? { ok: message } : { err: message })
      })
      const useIt = (row) => {
        api({ op: 'pocUse', id: row.id, used_on: t('控制台手动标记', 'Marked manually in UI') }).then(() => {
          setMsg({ ok: t('已记一次复用：', 'Recorded reuse: ') + row.title })
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
          h('div', Object.assign({
            className: 'rt-kb-head',
          }, clickable(() => open(x.id), { expanded: isOpen })),
            h('span', { className: 'rt-sec-caret' }, isOpen ? '▾' : '▸'),
            h('span', { className: 'rt-kb-kind k-' + (x.kind || 'poc') }, pocKindLabel(x.kind)),
            h('span', { className: 'rt-kb-title' }, x.title),
            x.cve ? h('span', { className: 'rt-tag rt-tag-passive' }, x.cve) : null,
            x.component ? h('span', { className: 'rt-tag' }, x.component) : null,
            x.verified === 1
              ? h('span', { className: 'rt-tag rt-tag-live' }, t('已验证', 'Verified'))
              : h('span', { className: 'rt-tag rt-tag-warn' }, t('未验证', 'Unverified')),
            h('div', { className: 'rt-spacer' }),
            h('span', { className: 'rt-tag' }, pocSourceLabel(x.source)),
            x.hit_count ? h('span', { className: 'rt-tag' }, t('复用 ', 'Reused ') + x.hit_count) : null),
          h('div', { className: 'rt-kb-sub' },
            [x.category ? t('归类 ', 'Category ') + pocCatLabel(x.category) : null,
              x.versions ? t('适用版本 ', 'Versions ') + x.versions : null,
              x.language || null,
              x.tags || null,
              t('建立时间 ', 'Created ') + fmt(x.created_at),
              (x.engagement_name || x.engagement_id) ? t('来源工作区 ', 'Workspace ') + (x.engagement_name || x.engagement_id) : null,
              x.asset_target ? t('关联模块 ', 'Module ') + x.asset_target : null,
              x.found_by_agent ? t('沉淀角色 ', 'Author ') + roleLabel(x.found_by_agent) : null,
              x.source_url ? t('来源 ', 'Source ') + x.source_url : null].filter(Boolean).join(' · ')),
          isOpen
            ? h('div', { className: 'rt-kb-body' },
                detailBusy && !d ? h('div', { className: 'rt-empty' }, t('读取中…', 'Loading…')) : null,
                d ? h('div', null,
                  d.usage ? h('div', { className: 'rt-kv' }, h('b', null, t('用法', 'Usage')), h('span', { className: 'rt-mono' }, d.usage)) : null,
                  d.description ? h('div', { className: 'rt-kv' }, h('b', null, t('说明', 'Notes')), h('span', null, d.description)) : null,
                  d.verified_note ? h('div', { className: 'rt-kv' }, h('b', null, t('验证证据', 'Proof')), h('span', null, d.verified_note)) : null,
                  d.used_on ? h('div', { className: 'rt-kv' }, h('b', null, t('最近使用', 'Last Used')), h('span', null, d.used_on)) : null,
                  d.path ? h('div', { className: 'rt-kv' }, h('b', null, t('落盘', 'Disk Path')), h('span', { className: 'rt-mono' }, d.path)) : null,
                  h('div', { className: 'rt-kb-actions' },
                    h('button', { className: 'rt-btn', disabled: !d.content, onClick: () => copy(d.content || '', t('模板正文', 'Template Body')) }, t('复制正文', 'Copy Body')),
                    h('button', { className: 'rt-btn', onClick: () => useIt(x) }, t('记一次复用', 'Record Reuse')),
                    d.source_url ? h('button', { className: 'rt-btn', onClick: () => copy(d.source_url, t('来源链接', 'Source URL')) }, t('复制来源', 'Copy Source')) : null),
                  d.content
                    ? h('pre', { className: 'rt-rep-http' }, d.content.length > 12000 ? d.content.slice(0, 12000) + t('\n…（已截断，完整内容见落盘文件）', '\n… (truncated; see disk file for full content)') : d.content)
                    : h('div', { className: 'rt-empty' }, t('这条只有元数据，没有正文 —— 拿到正文后用 lmt_artifact_record (kind=pattern) 补上', 'Metadata only; add body with lmt_artifact_record (kind=pattern)')))
                : null)
            : null)
      }

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, t('工程模式与验证模板库', 'Engineering Pattern & Template KB')),
          h('input', {
            className: 'rt-input', style: { flex: '1 1 150px', minWidth: 120 },
            placeholder: t('搜 规则编号 / 组件 / 关键字', 'Search rule ID / component / keyword'), value: q,
            onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') query() },
          }),
          h('button', { className: 'rt-btn rt-btn-primary', disabled: busy, onClick: () => query() }, busy ? t('检索中…', 'Searching…') : t('检索', 'Search')),
          h('span', { className: 'rt-tag' }, stats.total + t(' 条', ' entries')),
          h('span', { className: 'rt-tag rt-tag-live' }, t('已验证 ', 'Verified ') + stats.verified),
          h('span', { className: 'rt-tag' }, t('累计复用 ', 'Reused ') + (stats.reused || 0)),
          (stats.uncategorized || 0) > 0 && (stats.uncategorized || 0) !== stats.total
            ? h('span', { className: 'rt-tag rt-tag-warn', title: t('这些条目还没归类：智能体回填时用 lmt_artifact_record 的 category 参数标一下', 'Uncategorized entries; set category via lmt_artifact_record') }, t('未归类 ', 'Uncategorized ') + stats.uncategorized)
            : null,
          tpl.total ? h('span', { className: 'rt-tag rt-tag-passive' }, t('本机模板 ', 'Local Templates ') + tpl.total) : null,
          engagement
            ? h('span', Object.assign({
                className: 'rt-tag rt-tag-live',
                style: { cursor: 'pointer' },
                title: t('只看当前工作区沉淀的模式与模板（跟随当前会话）；点一下回到全库', 'Filtered to current workspace; click to show all'),
              }, clickable(() => { setEngagement(''); query({ engagement: undefined }) }, { label: t('取消工作区筛选：', 'Clear workspace filter: ') + engagement })), t('来源工作区 ', 'Workspace ') + engagement + ' ✕')
            : h('span', { className: 'rt-tag rt-tag-passive', title: t('当前显示全部工作区的工程模式库；面板跟随会话后会自动筛到对应项目', 'Showing patterns across all workspaces') }, t('全库共享', 'Shared Across All')),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn' + (grouped ? ' rt-btn-primary' : ''), title: t('按归类分组显示 / 平铺显示', 'Group by category / Flat list'), onClick: () => setGrouped(!grouped) }, grouped ? t('按归类分组', 'Grouped') : t('平铺显示', 'Flat')),
          h('button', { className: 'rt-btn', disabled: busy, onClick: () => query() }, busy ? t('检索中…', 'Searching…') : t('刷新', 'Refresh'))),
        h('div', { className: 'rt-kb-cats' },
          (stats.byCategory || []).filter((c) => c.n > 0).map((c) => h('span', Object.assign({
            key: c.code,
            className: 'rt-concl-i' + (category === c.code ? ' on' : ''),
            title: c.hint || (t('筛选：', 'Filter: ') + pocCatLabel(c.code)),
          }, clickable(() => {
            const next = category === c.code ? '' : c.code
            setCategory(next)
            query({ category: next || undefined })
          }, { label: t('筛选归类：', 'Filter category: ') + pocCatLabel(c.code), expanded: category === c.code })),
            h('b', null, String(c.n || 0)),
            h('span', null, pocCatLabel(c.code) + (c.verified ? ' (' + t('已验证 ', 'verified ') + c.verified + ')' : ''))))),
        h('div', { className: 'rt-kb-filter' },
          h('input', {
            className: 'rt-input', style: { flex: 1, minWidth: 140 }, placeholder: t('搜 规则编号 / 组件 / 关键字（正文也会搜）', 'Search rule ID / component / keyword (full-text)'),
            value: q, onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') query() },
          }),
          h('select', { className: 'rt-input', style: { maxWidth: 120 }, value: category, onChange: (e) => { setCategory(e.target.value); query({ category: e.target.value || undefined }) } },
            h('option', { value: '' }, t('全部归类', 'All Categories')),
            POC_CAT_ORDER.map((k) => h('option', { key: k, value: k }, pocCatLabel(k)))),
          h('input', {
            className: 'rt-input', style: { maxWidth: 160 }, list: 'rt-kb-engs',
            placeholder: t('来源工作区（可搜索）', 'Workspace (searchable)'), value: engagement,
            title: t('输入工作区名筛选，回车或点「检索」生效；清空 = 全部来源', 'Filter by workspace; empty = all'),
            onChange: (e) => setEngagement(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') query({ engagement: engagement || undefined }) },
          }),
          h('datalist', { id: 'rt-kb-engs' },
            h('option', { value: '' }, t('全部来源工作区', 'All Workspaces')),
            (engagement && !(stats.byEngagement || []).some((e) => e.engagement === engagement)
              ? [h('option', { key: '__cur', value: engagement }, engagement + ' (0)')]
              : []),
            (stats.byEngagement || []).map((e) => h('option', { key: e.engagement, value: e.engagement }, e.engagement + ' (' + e.n + ')'))),
          h('input', {
            className: 'rt-input', style: { width: 120 }, placeholder: t('关联模块筛选', 'Filter by module'),
            value: assetTarget, onChange: (e) => setAssetTarget(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') query() },
          }),
          h('select', { className: 'rt-input', style: { maxWidth: 110 }, value: kind, onChange: (e) => { setKind(e.target.value); query({ kind: e.target.value || undefined }) } },
            h('option', { value: '' }, t('全部类型', 'All Kinds')),
            Object.keys(POC_KIND_LABEL).map((k) => h('option', { key: k, value: k }, pocKindLabel(k)))),
          h('label', { className: 'rt-kb-check' },
            h('input', { type: 'checkbox', checked: verifiedOnly, onChange: (e) => { setVerifiedOnly(e.target.checked); query({ verified: e.target.checked || undefined }) } }),
            t('只看已验证', 'Verified Only')),
          h('button', { className: 'rt-btn rt-btn-primary', onClick: () => query() }, t('检索', 'Search'))),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        err ? h('div', { className: 'rt-err' },
          /engagement required|unknown op/i.test(err)
            ? t('工程模式库接口由 host 侧提供，当前 dsh web 还是旧进程 —— 请重启 dsh web（dsh-restart）后刷新页面。', 'Pattern KB API is served by host; restart dsh web (dsh-restart) and reload.')
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
                h('span', { className: 'rt-kb-cat-name' }, pocCatLabel(code)),
                h('span', { className: 'rt-tag' }, list.length + t(' 条', ' entries')),
                h('span', { className: 'rt-tag rt-tag-live' }, t('已验证 ', 'Verified ') + list.filter((x) => x.verified === 1).length),
                h('span', { className: 'rt-spacer' }),
                h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                  t('最近建立 ', 'Latest ') + fmt(list.map((x) => x.created_at).filter(Boolean).sort().pop()))))
              for (const x of list) out.push(card(x))
            }
            return out
          })(),
          tplItems.length
            ? h('div', { className: 'rt-kb-tpl' },
                h('div', { className: 'rt-ap-sub' },
                  t('本机标准模板命中 · ', 'Local Template Matches · ') + tplItems.length + t(' 条', '')),
                tplItems.map((tplItem, i) => h('div', { key: 't' + i, className: 'rt-kb-tpl-row' },
                  h('span', { className: 'rt-tag' }, tplItem.severity || '—'),
                  h('span', { className: 'rt-mono rt-kb-tpl-path', title: tplItem.path }, tplItem.path),
                  h('span', { className: 'rt-kb-tpl-name', title: tplItem.name }, tplItem.name || ''),
                  h('button', {
                    className: 'rt-btn', style: { padding: '0 6px', fontSize: 10.5 },
                    onClick: () => copy(tplItem.path, t('模板路径', 'Template Path')),
                  }, t('复制路径', 'Copy Path')))),
                tpl.dir ? h('div', { className: 'rt-foot' }, h('span', null, t('模板目录：', 'Template Dir: ') + tpl.dir)) : null)
            : null,
          data === null ? h('div', { className: 'rt-empty' }, t('加载中…', 'Loading…')) : null,
          data !== null && !items.length && !tplItems.length
            ? h('div', { className: 'rt-empty' },
                h('div', null, q || kind || verifiedOnly ? t('没有命中，请换个关键字再试。', 'No matches; try another query.') : t('工程模式库暂无记录。', 'No patterns in KB yet.')),
                h('div', { style: { marginTop: 6, fontSize: 12 } },
                  t('通过 lmt_artifact_query 检索复用，验证通过后由 lmt_artifact_record (kind=pattern) 回填。', 'Search with lmt_artifact_query and contribute back via lmt_artifact_record (kind=pattern).')))
            : null),
        h('div', { className: 'rt-foot' },
          h('span', null, t('全局共享（跨工作区）· 落盘 pocs/<code>/', 'Globally shared across workspaces · stored in pocs/<code>/'))))
    }

    /* ---------------------------------------------------------- 交付里程碑 */
    function ScoreTab(props) {
      useLocale()
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
          if (!r || r.ok === false) { setErr((r && r.error) || t('读取失败', 'Read failed')); return }
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
        if (!form || !form.name) { setMsg({ err: t('名称不能为空', 'Name is required') }); return }
        setBusy(true)
        setMsg(null)
        api({ op: 'saveScorePoint', engagement: eng, point: form }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || t('保存失败', 'Save failed') }); return }
          if (r.overridden === false) {
            setMsg({ err: t('已保存「启用/停用」。分值未改动：这是随《软件工程 4-Wave 交付质量门禁规范》分发的内置里程碑项，'
              + '权重 / 上限 / 验收口径由规范锁定。要自定义里程碑项时请「+ 新增里程碑」。',
              'Saved enabled state. Weight unchanged: built-in milestones are locked by the 4-Wave Delivery Quality Gate Spec. Click "+ Add Milestone" to create a custom one.') })
          } else {
            setMsg({ ok: r.note || t('已保存', 'Saved') })
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
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || t('删除失败', 'Delete failed') }); return }
          setMsg({ ok: t('已删除', 'Deleted') })
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
              g.tiers.length + t(' 项', ' items')
              + (g.capSum > 0 ? t(' · 上限独立，不跨项累加', ' · Independent caps') : '')),
            h('div', { className: 'rt-spacer' }),
            g.points > 0
              ? h('span', { className: 'rt-tag rt-tag-active' }, '+' + g.points + t(' 分', ' pts'))
              : null))
        }
        for (const p of g.tiers) {
          const achieved = p.hits.length > 0
          const open = openId === p.id
          rows.push(h('div', Object.assign({
            key: 'sp' + p.id, className: 'rt-score-row',
          }, clickable(() => setOpenId(open ? null : p.id))),
            h('span', { className: 'rt-sec-caret' }, open ? '▾' : '▸'),
            h('span', null, h('span', {
              className: achieved ? 'rt-pri rt-pri-high' : 'rt-pri rt-pri-low',
              style: achieved ? {} : { background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-secondary)' },
            }, p.points + t('分', 'pt'))),
            h('span', { title: p.name + (p.description ? '\n' + p.description : '') },
              shortName(p.name)),
            h('span', { title: p.capped > 0
              ? t('已计入 ' + p.counted + ' 次，另有 ' + p.capped + ' 条因「' + (p.scope_label || '验收口径') + '」或已达上限不计分',
                  'Counted ' + p.counted + '; ' + p.capped + ' excluded due to scope/cap')
              : (p.scope_label || '') },
              h('span', { className: 'rt-sec-count' }, p.hits.length > 0 ? p.counted + t(' 次达成', 'x achieved') : t('未达成', 'Pending')),
              p.cap > 0
                ? h('span', { className: 'rt-scope' }, t('　额度已用 ', ' · Quota ') + (p.cap_used === null ? 0 : p.cap_used) + '/' + p.cap)
                : null),
            h('span', { style: { textAlign: 'right' } }, p.earned > 0
              ? h('span', { className: 'rt-tag rt-tag-active' }, '+' + p.earned + t(' 分', ' pts'))
              : h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '—'))))
          if (!open) continue
          const hitNodes = p.hits.map((hh, hi) => h('div', {
            key: 'h' + hh.id,
            className: 'rt-hit-row' + (hh.self_created ? ' self-created' : '') + (hh.capped ? ' service-capped' : ''),
          },
            h('span', { className: 'rt-hit-idx' }, String(hi + 1)),
            h('span', { className: 'rt-hit-asset', title: hh.target || hh.asset_ip || '' },
              hh.asset_ip || hh.target || t('未指定模块', 'No module specified')),
            hh.self_created ? h('span', { className: 'rt-tag rt-tag-warn', title: t('自建测试环境记录，只作过程留痕', 'Local test env record, trace only') }, t('测试记录 · 不计分', 'Test Record · Unscored')) : null,
            hh.capped ? h('span', {
              className: 'rt-tag rt-tag-warn',
              title: hh.capped_reason || t('同一模块同一服务端点只计最高权重一条', 'One highest-weight score per module & endpoint'),
            }, t('模块已封顶 · 不计分', 'Capped · Unscored') + (hh.service ? ' (' + hh.service + ')' : '')) : null,
            hh.shot_count ? h('span', { className: 'rt-tag', title: t('这条记录附有验收截图', 'Includes verification screenshot') },
              t('图 ', 'Img ') + hh.shot_count) : null,
            h('span', { className: 'rt-hit-time' }, fmt(hh.recorded_at)),
            h('button', {
              className: 'rt-btn', style: { padding: '0 5px', fontSize: 10.5 },
              title: t('复制这一条', 'Copy this entry'),
              onClick: (e) => {
                e.stopPropagation()
                copyText((hh.asset_ip || hh.target || '') + '  ' + (hh.evidence || ''))
              },
            }, t('复制', 'Copy')),
            hh.evidence
              ? h('span', { className: 'rt-hit-txt', title: hh.evidence }, String(hh.evidence).replace(/\n+/g, ' '))
              : h('span', { className: 'rt-hit-txt none' }, t('未填验收摘要', 'No verification summary'))))
          rows.push(h('div', {
            key: 'spd' + p.id, className: 'rt-score-row',
            style: { cursor: 'default', gridTemplateColumns: '1fr' },
          }, h('div', { className: 'rt-score-detail' },
            p.description ? h('div', { className: 'rt-kv' }, h('b', null, t('验收条件', 'Criteria')), h('span', null, p.description)) : null,
            h('div', { className: 'rt-kv' }, h('b', null, t('状态', 'Status')),
              h('span', null, (p.enabled ? t('启用', 'Enabled') : t('停用', 'Disabled')) + ' · ' + p.points + t(' 分/次 · 达成 ', ' pts/hit · Hit ') + p.hits.length +
                t(' 次 = ', 'x = ') + p.earned + t(' 分', ' pts') + (p.self_created ? t('（另有 ' + p.self_created + ' 次测试记录不计分）', ' (' + p.self_created + ' unscored test records)') : '') +
                (p.capped ? t('（另有 ' + p.capped + ' 次同模块重复达成不计分）', ' (' + p.capped + ' capped duplicates)') : ''))),
            p.capped
              ? h('div', { className: 'rt-kv' }, h('b', null, t('模块封顶', 'Module Cap')),
                  h('span', null, p.service_summary + t('；同一模块与服务端点按最高里程碑权重只计一次', '; highest milestone counts once per module & endpoint')))
              : null,
            p.hits.length
              ? h('div', null,
                  h(ShotStrip, { eng: eng, shots: p.shots, total: p.shot_total,
                    title: t('验收截图 · ', 'Verification Screenshots · ') + (p.shot_total || (p.shots || []).length) + t(' 张', '') }),
                  h('div', { className: 'rt-section', style: { padding: '6px 0 0' } },
                    t('达成记录 · ', 'Achieved Records · ') + p.hits.length + t('（详细验证见交付报告）', ' (see Delivery Report for details)')),
                  h('div', { className: 'rt-hits' }, hitNodes))
              : h('div', { className: 'rt-kv' }, h('b', null, t('达成记录', 'Records')),
                  h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } },
                    t('还没有 —— 完成里程碑验收后调用 lmt_artifact_record 记录目标模块与验证证据', 'None yet — record with lmt_artifact_record after verification'))),
            h('div', { className: 'rt-actions' },
              h('button', { className: 'rt-btn', onClick: (e) => { e.stopPropagation(); startEdit(p) } }, t('编辑', 'Edit'))))))
        }
      }

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, t('交付里程碑', 'Delivery Milestones')),
          h('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', marginLeft: 4 } }, t('总分', 'Score')),
          h('span', { className: 'rt-total' }, String(summary.achievedPoints)),
          h('span', { style: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)' } }, t('分', 'pts')),
          h('span', { className: 'rt-tag' }, summary.pointCount + t(' 个里程碑项', ' milestones')),
          h('span', { className: 'rt-tag' }, t('达成 ', 'Achieved ') + summary.countedHits + t(' 次', 'x')),
          summary.selfCreatedHits
            ? h('span', {
                className: 'rt-tag rt-tag-warn',
                title: t('自建测试记录只作过程留痕（不计分、不占上限）', 'Local test records are trace-only'),
              }, t('测试记录不计分 ', 'Test-only ') + summary.selfCreatedHits)
            : null,
          summary.serviceCappedHits
            ? h('span', {
                className: 'rt-tag rt-tag-warn',
                title: t('按「同模块同端口」只计一次：该服务已封顶，重复记录不计分', 'Capped once per module & port'),
              }, t('服务已封顶不计分 ', 'Capped ') + summary.serviceCappedHits)
            : null,
          h('div', { className: 'rt-spacer' }),
          h('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
            h('button', {
              className: 'rt-btn' + (scoreView === 'achieved' ? ' rt-btn-primary' : ''),
              title: t('只显示已经达成的里程碑项', 'Show achieved milestones only'),
              onClick: () => setScoreView('achieved'),
            }, t('已达成', 'Achieved') + (summary.hitPointCount ? ' ' + summary.hitPointCount : '')),
            h('button', {
              className: 'rt-btn' + (scoreView === 'gap' ? ' rt-btn-primary' : ''),
              title: t('只显示未达成的核心里程碑缺口（前 8 项）', 'Show top 8 remaining milestone gaps'),
              onClick: () => setScoreView('gap'),
            }, t('待交付缺口', 'Pending Gaps')),
            h('button', {
              className: 'rt-btn' + (scoreView === 'all' ? ' rt-btn-primary' : ''),
              title: t('显示全部 ' + items.length + ' 个里程碑项', 'Show all ' + items.length + ' milestones'),
              onClick: () => setScoreView('all'),
            }, t('全部 ', 'All ') + items.length)),
          h('button', { className: 'rt-btn', onClick: startNew }, t('+ 新增里程碑', '+ Add Milestone')),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? t('刷新中…', 'Refreshing…') : t('刷新', 'Refresh'))),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        err ? h('div', { className: 'rt-err' }, err) : null,
        form ? h('div', { className: 'rt-pane', style: { flex: 'none', borderBottom: '1px solid var(--dsw-alias-border-l1)' } },
          form.builtin
            ? h('div', { className: 'rt-hint', style: { marginBottom: 8 } },
                h('b', null, t('内置里程碑项（来自《软件工程 4-Wave 交付质量门禁规范》）', 'Built-in Milestone (4-Wave Delivery Quality Gate Spec)')),
                h('div', { style: { marginTop: 3 } },
                  t('权重、上限、验收口径与名称由规范锁定。这里可以改「启用 / 停用」；'
                    + '要自定义里程碑项时请返回上一屏点「+ 新增里程碑」。',
                    'Weight, cap, criteria, and name are spec-locked. You may toggle Enabled/Disabled or click "+ Add Milestone" for custom items.')),
                form.src !== null && form.src !== undefined
                  ? h('div', { style: { marginTop: 3, color: 'var(--dsw-alias-label-secondary)' } },
                      t('规范序号 ', 'Spec #') + form.src + (form.rule ? t('　·　分组 rule=', ' · rule=') + form.rule : '')
                      + (form.cap > 0 ? t('　·　上限 ', ' · cap ') + form.cap + t(' 分', ' pts') : t('　·　不设上限', ' · Uncapped')))
                  : null)
            : null,
          h('div', { className: 'rt-score-form' },
            h('input', {
              className: 'rt-input', placeholder: t('名称（必填）', 'Name (required)'), value: form.name,
              readOnly: form.builtin === true,
              title: form.builtin ? t('内置里程碑项的名称由规范锁定', 'Built-in name is locked') : '',
              onChange: (e) => setField('name', e.target.value),
            }),
            h('input', {
              className: 'rt-input', placeholder: t('分类，如 架构与核心模块', 'Category, e.g. Core Architecture'), value: form.category,
              readOnly: form.builtin === true,
              title: form.builtin ? t('内置里程碑项的分类由规范锁定', 'Built-in category is locked') : '',
              onChange: (e) => setField('category', e.target.value),
            }),
            h('input', {
              className: 'rt-input', type: 'number', placeholder: t('单次权重', 'Points'),
              readOnly: form.builtin === true,
              title: form.builtin
                ? t('内置里程碑项的分值由规范锁定，不能在这里改', 'Built-in points cannot be modified')
                : t('这一类的单次权重分值', 'Points per hit'),
              value: form.points, onChange: (e) => setField('points', Number(e.target.value)),
            }),
            h('select', { className: 'rt-input', value: form.enabled ? '1' : '0', onChange: (e) => setField('enabled', e.target.value === '1') },
              h('option', { value: '1' }, t('启用', 'Enabled')),
              h('option', { value: '0' }, t('停用', 'Disabled')))),
          h('input', {
            className: 'rt-input', style: { width: '100%', marginBottom: 6, boxSizing: 'border-box' },
            placeholder: t('验收条件说明', 'Acceptance criteria'), value: form.description,
            readOnly: form.builtin === true,
            title: form.builtin ? t('内置里程碑项的条款正文由规范锁定', 'Built-in description is locked') : '',
            onChange: (e) => setField('description', e.target.value),
          }),
          h('div', { className: 'rt-actions' },
            h('button', { className: 'rt-btn rt-btn-primary', disabled: busy, onClick: save }, t('保存', 'Save')),
            form.id
              ? (form.builtin
                  ? h('button', {
                      className: 'rt-btn', disabled: true,
                      title: t('内置里程碑项不能删除，要让它不参与计分请改用「停用」。', 'Built-in items cannot be deleted; disable instead.'),
                    }, t('删除（内置项不可删）', 'Delete (Built-in Locked)'))
                  : h('button', { className: 'rt-btn', disabled: busy, onClick: remove }, t('删除', 'Delete')))
              : null,
            h('button', { className: 'rt-btn', onClick: () => setForm(null) }, t('取消', 'Cancel')))) : null,
        h('div', { className: 'rt-foot', style: { padding: '2px 12px 0' } },
          scoreView === 'achieved'
            ? (achievedGroups.length
                ? t('默认只显示已经达成的里程碑项（' + summary.hitPointCount + ' 项）；待交付缺口 / 完整列表可切换。',
                    'Showing achieved milestones (' + summary.hitPointCount + '); switch to Pending Gaps or All.')
                : t('还没有已达成的里程碑项；切到「待交付缺口」查看待推进目标。', 'No achieved milestones yet; switch to Pending Gaps to inspect targets.'))
            : scoreView === 'gap'
              ? t('只显示未拿满的前 8 项；完整 ' + items.length + ' 项点「全部」。', 'Showing top 8 open items; click All for all ' + items.length + '.')
              : t('完整 ' + items.length + ' 个里程碑项。', 'All ' + items.length + ' milestones.')),
        h('div', { className: 'rt-table' },
          h('div', { className: 'rt-score-row head' },
            h('span', null, ''), h('span', null, t('分值', 'Pts')), h('span', null, scoreView === 'achieved' ? t('已达成项目', 'Achieved') : scoreView === 'gap' ? t('待交付缺口', 'Pending Gaps') : t('全部里程碑项', 'All Milestones')),
            h('span', null, t('达成 / 规范上限', 'Hits / Spec Cap')), h('span', { style: { textAlign: 'right' } }, t('已得分', 'Earned'))),
          rows,
          !items.length ? h('div', { className: 'rt-empty' }, t('暂无里程碑项，点右上角「新增里程碑」', 'No milestones yet; click "+ Add Milestone"')) : null,
          items.length && !rows.length ? h('div', { className: 'rt-empty' }, scoreView === 'achieved' ? t('还没有已达成的里程碑项；点「待交付缺口」查看下一步目标。', 'No achieved milestones yet; switch to Pending Gaps.') : t('当前视图没有可显示的里程碑项。', 'No milestones in this view.')) : null))
    }

    /* ---------------------------------------------------------- 当前验证（实时） */
    function TestingTab(props) {
      useLocale()
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
          if (!r || r.ok === false) { setErr((r && r.error) || t('读取失败', 'Read failed')); return }
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
          a.scope === 'internal' ? t('核心模块', 'Core Module') : t('外部接口', 'External API')))
        if (a.segment_cidr) chips.push(h('span', { key: 'seg', className: 'rt-tag' }, a.segment_cidr))
        if (a.open_ports) chips.push(h('span', { key: 'p', className: 'rt-tag rt-tag-active' }, t('开放 ', 'Open ') + a.open_ports + t(' 端口', ' ports')))
        if (a.vulns) chips.push(h('span', { key: 'v', className: 'rt-tag rt-tag-live' }, t('已确认问题 ', 'Confirmed ') + a.vulns))
        if (a.webshells) chips.push(h('span', { key: 'w', className: 'rt-tag rt-tag-passive' }, t('服务端点 ', 'Endpoints ') + a.webshells))
        if (a.tunnels) chips.push(h('span', { key: 't', className: 'rt-tag rt-tag-passive' }, t('联调通道 ', 'Channels ') + a.tunnels))
        if (a.priority) chips.push(h('span', { key: 'pr', className: 'rt-tag' }, t('优先级 ', 'Priority ') + priLabel(a.priority)))
        if (a.blocked_count) chips.push(h('span', { key: 'b', className: 'rt-tag', style: { color: '#ef4444', borderColor: '#ef444455' } }, t('阻塞 ', 'Blocked ') + a.blocked_count + t(' 次', 'x')))
        const noteLines = a.test_notes
          ? String(a.test_notes).split('\n').slice(-3).map((l) => (l.length > 240 ? l.slice(0, 240) + ' …' : l))
          : []
        return h('div', { key: 'at' + a.id, className: 'rt-atest' + (past ? ' past' : '') },
          h('div', { className: 'rt-atest-head' },
            past ? null : h('span', { className: 'rt-live-dot' }),
            h('span', { className: 'rt-atest-ip' }, a.ip),
            h('span', { className: 'rt-tag ' + (a.test_status === 'testing' ? 'rt-tag-live' : '') }, testLabel(a.test_status)),
            h('div', { className: 'rt-spacer' }),
            h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
              fmt(a.test_updated_at) + (a.test_updated_by ? ' · ' + a.test_updated_by : ''))),
          chips.length ? h('div', null, chips) : null,
          a.test_surface ? h('div', { className: 'rt-atest-meta' }, t('验证接口面：', 'Surface: ') + a.test_surface) : null,
          a.potential ? h('div', { className: 'rt-atest-meta' }, t('预期产出：', 'Expected: ') + a.potential) : null,
          noteLines.length ? h(Clip, { label: t('验证记录', 'Verification Notes'), text: noteLines.join('\n') }) : null)
      }

      const conclusion = h('div', { className: 'rt-concl' },
        ConclItem('testing', t('验证中', 'Testing'), stats.testing),
        ConclItem('untested', t('待验证', 'Pending'), stats.untested),
        ConclItem('tested', t('已验证', 'Verified'), stats.tested),
        ConclItem('blocked', t('受阻/跳过', 'Blocked/Skipped'), (stats.abandoned || 0) + (stats.blocked || 0)),
        ConclItem('no_surface', t('无需验证', 'No Surface'), stats.no_surface),
        h('div', { className: 'rt-spacer' }),
        at ? h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
          t('更新于 ', 'Updated ') + at.toLocaleTimeString(getLocale() === 'en-US' ? 'en-US' : 'zh-CN', { hour12: false })) : null,
        h('button', {
          className: 'rt-btn', style: { padding: '0 7px', fontSize: 11 }, title: t('展开最近验证与待验证队列', 'Expand recent & queue'),
          onClick: () => collapse.setAll(['testing:' + eng, 'recent:' + eng, 'queue:' + eng], true),
        }, t('全部展开', 'Expand All')),
        h('button', {
          className: 'rt-btn', style: { padding: '0 7px', fontSize: 11 }, title: t('只留正在验证', 'Keep active only'),
          onClick: () => collapse.setAll(['testing:' + eng, 'recent:' + eng, 'queue:' + eng], false),
        }, t('全部收起', 'Collapse All')),
        h('button', {
          className: 'rt-btn' + (auto ? ' rt-btn-primary' : ''), style: { padding: '0 7px', fontSize: 11 },
          title: t('每 5 秒自动刷新', 'Auto-refresh every 5s'), onClick: () => setAuto((x) => !x),
        }, auto ? t('实时 · 5s', 'Live · 5s') : t('已暂停', 'Paused')),
        h('button', { className: 'rt-btn', style: { padding: '0 7px', fontSize: 11 }, onClick: load }, t('刷新', 'Refresh')))

      const body = []
      body.push(h(Section, {
        key: 'testing', tone: 'test', title: t('正在验证', 'Currently Testing'),
        count: testing.length + t(' 个', ''),
        sub: testing.length ? t('智能体正在验证这些模块与服务', 'Agents actively verifying these modules') : t('智能体开始验证某个模块后会实时出现在这里', 'Appears live once an agent begins testing'),
        open: collapse.isOpen('testing:' + eng, true),
        onToggle: collapse.toggle('testing:' + eng, true),
      }, testing.length
        ? testing.map((a) => card(a, false))
        : h('div', { className: 'rt-atest-meta', style: { paddingBottom: 4 } }, t('当前没有模块处于「验证中」', 'No modules currently testing'))))

      body.push(h(Section, {
        key: 'recent', tone: 'past', title: t('最近验证', 'Recently Verified'), count: recent.length + t(' 个', ''),
        sub: t('已完成验证的模块', 'Completed verification modules'),
        open: collapse.isOpen('recent:' + eng, false),
        onToggle: collapse.toggle('recent:' + eng, false),
      }, recent.length ? recent.map((a) => card(a, true)) : h('div', { className: 'rt-atest-meta' }, t('暂无', 'None'))))

      body.push(h(Section, {
        key: 'queue', tone: 'queue', title: t('待验证队列', 'Verification Queue'),
        count: (data ? (data.untested || 0) : 0) + t(' 个', ''),
        sub: t('按模块优先级与开放服务数排序', 'Sorted by module priority and open services'),
        open: collapse.isOpen('queue:' + eng, false),
        onToggle: collapse.toggle('queue:' + eng, false),
      }, queue.length
        ? queue.map((a) => card(a, true)).concat([
            h('div', { key: 'queueHint', className: 'rt-atest-meta', style: { paddingTop: 4 } },
              t('完整清单（含筛选与排序）见「模块与服务」页', 'See "Modules & Services" for the full filtered list'))])
        : h('div', { className: 'rt-atest-meta' }, t('没有待验证模块', 'No pending modules'))))

      return h('div', { className: 'rt-main' },
        conclusion,
        err ? h('div', { className: 'rt-err' }, err) : null,
        data === null && !err ? h('div', { className: 'rt-empty' }, t('加载中…', 'Loading…')) : null,
        h('div', { className: 'rt-body', style: { overflow: 'auto' } },
          h('div', { style: { padding: '6px 12px 14px' } }, body)))
    }

    /* ---------------------------------------------------------- 运行环境与服务端点 */
    function SessionTab(props) {
      useLocale()
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
          if (!r || r.ok === false) { setErr((r && r.error) || t('读取失败', 'Read failed')); return }
          setErr(null)
          setData(r)
        }, (e) => setErr(String((e && e.message) || e)))
      }
      React.useEffect(load, [eng, refreshKey])

      const probe = () => {
        setBusy(true); setMsg(null)
        api({ op: 'probeSessions', engagement: eng, timeoutMs: 6000 }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || t('检测失败', 'Probe failed') }); load(); return }
          const on = (r.webshells || []).filter((x) => x.status === 'online').length
          const act = (r.tunnels || []).filter((x) => x.status === 'active').length
          setMsg({ ok: t('检测完成：服务端点在线 ' + on + '/' + (r.webshells || []).length + '，联调通道可用 ' + act + '/' + (r.tunnels || []).length,
            'Probe complete: Endpoints online ' + on + '/' + (r.webshells || []).length + ', Bridge channels active ' + act + '/' + (r.tunnels || []).length) })
          load()
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
      }

      const copy = (key, text) => copyWithFeedback(text, text, (okFlag, message) => {
        if (!okFlag) { setMsg({ err: message }); return }
        setCopied(key)
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
      })

      const markTunnel = (tn, status) => {
        setMsg(null)
        api({ op: 'updateTunnel', engagement: eng, id: tn.id, patch: { status: status, check_note: t('界面手动标记', 'Marked manually in UI') } })
          .then(() => load(), (e) => setMsg({ err: String((e && e.message) || e) }))
      }
      const markShell = (w, status) => {
        setMsg(null)
        api({ op: 'updateWebshell', engagement: eng, id: w.id, patch: { status: status, check_note: t('界面手动标记', 'Marked manually in UI') } })
          .then(() => load(), (e) => setMsg({ err: String((e && e.message) || e) }))
      }

      const sessCollapse = useCollapse('sessions:' + eng)
      const totals = (data && data.totals) || {}
      const shells = (data && data.webshells) || []
      const tunnels = (data && data.tunnels) || []
      const statusDot = (s) => h('span', { className: s === 'online' || s === 'active' ? 'rt-dot-on' : (s === 'unknown' || !s ? 'rt-dot-unk' : 'rt-dot-off') })
      const fact = (label, value) => h('div', { className: 'rt-sess-fact' }, h('b', null, label), h('span', null, value))
      const clip = (v, max) => {
        const str = String(v === undefined || v === null ? '' : v)
        const n = max || 90
        return str.length > n ? str.slice(0, n) + '…' : str
      }
      const factClip = (label, value, max) => fact(label, h('span', { title: String(value || '') }, clip(value, max)))
      const noteFold = (label, text) => {
        const str = String(text || '')
        if (str.trim() === '') return null
        return h('details', { className: 'rt-sess-fold' },
          h('summary', null, label + ' (' + str.length + t(' 字，点击展开)', ' chars, click to expand)')),
          h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', padding: '4px 0', fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } }, str))
      }
      const isSecureEndpoint = (st) => /tls|https|ssh|grpc|ws|加密/i.test(String(st || ''))

      const shellCards = shells.map((w) => h('div', { key: 'w' + w.id, className: 'rt-sess' },
        h('div', { className: 'rt-sess-head' },
          statusDot(w.status),
          h('span', { className: 'rt-sess-title' }, w.url),
          h('span', { className: 'rt-tag rt-tag-active' }, w.shell_type || 'endpoint'),
          w.privilege ? h('span', { className: 'rt-tag' }, w.privilege) : null,
          h('div', { className: 'rt-spacer' }),
          copied === 'cmd' + w.id
            ? h('span', { className: 'rt-tag', style: { color: '#4d6bfe' } }, t('已复制', 'Copied'))
            : h('button', {
                className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
                onClick: () => copy('cmd' + w.id, 'curl -s "' + w.url + '"'),
              }, t('复制 URL', 'Copy URL')),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: () => markShell(w, 'offline'),
          }, t('标记离线', 'Mark Offline'))),
        h('div', { className: 'rt-sess-facts' },
          fact(t('端点类型', 'Endpoint Type'), isSecureEndpoint(w.shell_type) ? t('标准安全端点（可直连调试）', 'Secure endpoint (direct debuggable)') : t('本地预览 / 调试端点', 'Local preview / debug endpoint')),
          w.pass_key ? fact(t('访问凭据', 'Access Secret'), h(SecretText, { value: w.pass_key })) : null,
          w.asset_ip ? fact(t('所属节点', 'Host'), w.asset_ip) : null,
          w.privilege ? fact(t('运行角色', 'Role'), w.privilege) : null,
          w.secret_ref ? fact(t('凭据引用', 'Secret Ref'), h('span', { className: 'rt-mono' }, w.secret_ref)) : null,
          fact(t('最后检测', 'Last Check'), (w.last_check ? fmt(w.last_check) : t('未检测', 'Unchecked'))
            + (w.latency_ms !== null && w.latency_ms !== undefined ? ' (' + w.latency_ms + 'ms)' : '')),
          noteFold(t('检测说明', 'Check Notes'), w.check_note),
          noteFold(t('备注', 'Notes'), w.note))))

      const tunnelCards = tunnels.map((tn) => h('div', { key: 't' + tn.id, className: 'rt-sess' },
        h('div', { className: 'rt-sess-head' },
          statusDot(tn.status),
          h('span', { className: 'rt-sess-title' }, tn.listen || t('(未填监听地址)', '(No listen addr)')),
          h('span', { className: 'rt-tag rt-tag-passive' }, tn.kind || 'proxy'),
          tn.legit === true
            ? h('span', { className: 'rt-tag rt-tag-live', title: tn.entry_kind_label || '' }, t('目标环境通道', 'Target Env Channel'))
            : h('span', { className: 'rt-tag', title: t('本地代理或待确认通道', 'Local proxy or pending channel') }, t('本地/待确认', 'Local / Pending')),
          tn.reach ? h('span', { className: 'rt-tag' }, t('可达 ', 'Reach ') + tn.reach) : null,
          h('div', { className: 'rt-spacer' }),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: () => copy('sock' + tn.id, tn.listen || ''),
          }, copied === 'sock' + tn.id ? t('已复制', 'Copied') : t('复制地址', 'Copy Addr')),
          tn.status === 'active'
            ? h('button', { className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 }, onClick: () => markTunnel(tn, 'down') }, t('标记离线', 'Mark Down'))
            : h('button', { className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 }, onClick: () => markTunnel(tn, 'active') }, t('标记可用', 'Mark Active'))),
        h('div', { className: 'rt-sess-facts' },
          factClip(t('上游入口', 'Upstream Entry'), tn.entry || t('未登记', 'Unregistered'), 110),
          tn.reach ? factClip(t('可达子网/服务', 'Reachable Targets'), tn.reach, 110) : null,
          tn.asset_ip ? fact(t('所属节点', 'Host'), tn.asset_ip) : null,
          fact(t('最后检测', 'Last Check'), (tn.last_check ? fmt(tn.last_check) : t('未检测', 'Unchecked'))
            + (tn.latency_ms !== null && tn.latency_ms !== undefined ? ' (' + tn.latency_ms + 'ms)' : '')),
          noteFold(t('检测说明', 'Check Notes'), tn.check_note),
          noteFold(t('备注', 'Notes'), tn.note)),
        tn.command ? h('details', { className: 'rt-sess-fold' },
          h('summary', null, t('启动命令（点击展开 / 复制）', 'Launch Command (expand / copy)')),
          h('div', Object.assign({ className: 'rt-code', title: t('点击复制', 'Click to copy') }, clickable(() => copy('c' + tn.id, tn.command), { label: t('复制命令', 'Copy command') })),
            copied === 'c' + tn.id ? t('已复制', 'Copied') : tn.command)) : null))

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, t('运行环境与服务端点', 'Runtime & Endpoints')),
          h('span', { className: 'rt-tag' }, t('服务端点 ', 'Endpoints ') + (totals.webshellsOnline || 0) + '/' + (totals.webshells || 0) + t(' 在线', ' online')),
          h('span', { className: 'rt-tag' }, t('联调通道 ', 'Channels ') + (totals.tunnelsActive || 0) + '/' + (totals.tunnels || 0) + t(' 可用', ' active')),
          h('span', { className: 'rt-tag' }, t('配置凭据 ', 'Creds ') + (totals.credentials || 0)),
          h('span', { className: 'rt-tag' }, t('连接会话 ', 'Access ') + (totals.access || 0)),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn rt-btn-primary', disabled: busy, onClick: probe }, busy ? t('检测中…', 'Probing…') : t('检测连通性', 'Probe Connectivity')),
          h('button', { className: 'rt-btn', onClick: load }, t('刷新', 'Refresh'))),
        msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
        err ? h('div', { className: 'rt-err' }, err) : null,
        h('div', { className: 'rt-body', style: { overflow: 'auto' } },
          !shells.length && !tunnels.length
            ? h('div', { className: 'rt-empty' },
                h('div', null, t('当前工作区暂无运行环境端点或联调通道。', 'No runtime endpoints or bridge channels in this workspace.')),
                h('div', { style: { marginTop: 6, fontSize: 12 } },
                  t('子智能体启动服务或转发通道后将同步于此，可点「检测连通性」核验。', 'Subagent services and tunnels appear here; click "Probe Connectivity" to verify.')))
            : null,
          h(Section, {
            key: 'webshells', tone: 'queue', title: t('服务端点', 'Service Endpoints'),
            count: (totals.webshellsOnline || 0) + '/' + (totals.webshells || 0) + t(' 在线', ' online'),
            sub: t('已部署的本地预览与服务端点', 'Deployed local preview & service endpoints'),
            open: sessCollapse.isOpen('shells', true), onToggle: sessCollapse.toggle('shells', true),
          }, shells.length
            ? h('div', { className: 'rt-sess-grid', style: { padding: 0 } }, shellCards)
            : h('div', { className: 'rt-atest-meta' }, t('暂无服务端点', 'No service endpoints'))),
          h(Section, {
            key: 'tunnels', tone: 'test', title: t('联调通道', 'Bridge Channels'),
            count: (totals.tunnelsActive || 0) + '/' + (totals.tunnels || 0) + t(' 可用', ' active'),
            sub: t('端口转发与联调代理通道', 'Port forwarding & proxy bridge channels'),
            open: sessCollapse.isOpen('tunnels', true), onToggle: sessCollapse.toggle('tunnels', true),
          }, tunnels.length
            ? h('div', { className: 'rt-sess-grid', style: { padding: 0 } }, tunnelCards)
            : h('div', { className: 'rt-atest-meta' }, t('暂无联调通道', 'No bridge channels')))))
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
            h('div', { className: 'rt-err' }, t('该页面渲染出错：', 'Render error: ') + msg),
            h('button', {
              className: 'rt-btn',
              onClick: () => { this.setState({ error: null }); setUI({ tab: 'overview' }) },
            }, t('回到项目总览', 'Back to Overview')))
        }
        return this.props.children
      }
    }

    /* ---------------------------------------------------------- 统一设置中心 */
    const normalizeModelCatalog = (raw) => {
      if (!raw) return []
      const groups = []
      const pushModel = (bucket, m) => {
        if (!m) return
        if (typeof m === 'string') {
          const s = m.trim()
          if (s) bucket.push({ id: s, name: s })
          return
        }
        if (typeof m === 'object') {
          const mid = String(m.id || m.model || m.name || '').trim()
          if (mid) bucket.push({ id: mid, name: String(m.name || m.label || mid) })
        }
      }
      const rawGroups = Array.isArray(raw)
        ? raw
        : (Array.isArray(raw.groups) ? raw.groups : (Array.isArray(raw.providers) ? raw.providers : null))
      if (rawGroups) {
        const byProv = new Map()
        for (const item of rawGroups) {
          if (!item || typeof item !== 'object') continue
          if (Array.isArray(item.models)) {
            const pid = String(item.id || item.provider || item.name || '').trim()
            if (!pid) continue
            const models = []
            for (const m of item.models) pushModel(models, m)
            groups.push({ id: pid, name: String(item.name || item.label || pid), models })
          } else if (item.provider && (item.model || item.id)) {
            const pid = String(item.provider).trim()
            if (!byProv.has(pid)) byProv.set(pid, { id: pid, name: String(item.providerName || pid), models: [] })
            pushModel(byProv.get(pid).models, item)
          }
        }
        for (const g of byProv.values()) groups.push(g)
        return groups
      }
      if (typeof raw === 'object') {
        for (const [pid, list] of Object.entries(raw)) {
          if (!Array.isArray(list)) continue
          const models = []
          for (const m of list) pushModel(models, m)
          groups.push({ id: pid, name: pid, models })
        }
      }
      return groups
    }

    function SettingsHubTab(props) {
      useLocale()
      const eng = props.engagement || null
      const engagements = Array.isArray(props.engagements) ? props.engagements : []
      const activeSid = props.sessionId || null
      const refreshKey = props.refreshKey || 0
      const compact = Boolean(props.compact)
      const onRefresh = typeof props.onRefresh === 'function' ? props.onRefresh : (() => {})
      const onGo = typeof props.onGo === 'function'
        ? props.onGo
        : ((tab) => setUI({ open: true, tab: tab }))

      const uiState = useUI()
      const [loading, setLoading] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [err, setErr] = React.useState(null)
      const [saveMsg, setSaveMsg] = React.useState(null)

      /* ① AI 需求拆解与模型设置 */
      const [modelCatalog, setModelCatalog] = React.useState([])
      const [sessionRoute, setSessionRoute] = React.useState(null)
      const [modelMode, setModelMode] = React.useState('follow_session')
      const [provider, setProvider] = React.useState('')
      const [model, setModel] = React.useState('')
      const [reasoningEffort, setReasoningEffort] = React.useState('low')
      const [timeoutSec, setTimeoutSec] = React.useState(60)
      const [scanRepoContext, setScanRepoContext] = React.useState(true)
      const [customConstraints, setCustomConstraints] = React.useState('')

      /* ② 集群并发与派发策略 */
      const [maxAgents, setMaxAgents] = React.useState(6)
      const [maxLimit, setMaxLimit] = React.useState(12)
      const [thinkingEffort, setThinkingEffort] = React.useState('low')
      const [maxDepth, setMaxDepth] = React.useState(3)
      const [dispatchMode, setDispatchMode] = React.useState('hybrid_auto')
      const [subagentProvider, setSubagentProvider] = React.useState('spawn')
      const [autoWakeOnApprove, setAutoWakeOnApprove] = React.useState(true)
      const [autoAdvanceWave, setAutoAdvanceWave] = React.useState(false)
      const [maxTokensPerWorkspace, setMaxTokensPerWorkspace] = React.useState(0)
      const [maxCostPerWorkspace, setMaxCostPerWorkspace] = React.useState(0)
      const [maxAutoRetries, setMaxAutoRetries] = React.useState(0)
      const [speculativeWaveDispatch, setSpeculativeWaveDispatch] = React.useState(false)

      /* ③ 存储与 PostgreSQL 连接 */
      const [dbEngine, setDbEngine] = React.useState(null)
      const [pgUrlMasked, setPgUrlMasked] = React.useState('')
      const [pgUrlConfigured, setPgUrlConfigured] = React.useState(false)
      const [pgUrlDraft, setPgUrlDraft] = React.useState('')
      const [pgBusy, setPgBusy] = React.useState(false)
      const [pgMsg, setPgMsg] = React.useState(null)

      /* ④ 通知集成（飞书机器人） */
      const targetFeishuEng = eng || (engagements[0] && engagements[0].id) || 'default'
      const [feishuWebhook, setFeishuWebhook] = React.useState('')
      const [feishuOnNode, setFeishuOnNode] = React.useState(true)
      const [feishuOnGate, setFeishuOnGate] = React.useState(true)
      const [feishuOnShip, setFeishuOnShip] = React.useState(true)
      const [feishuBusy, setFeishuBusy] = React.useState(false)
      const [feishuMsg, setFeishuMsg] = React.useState(null)

      /* ⑤ 界面偏好与角色预设 */
      const [defaultViewMode, setDefaultViewMode] = React.useState(() => uiState.uiMode || 'novice')
      const [defaultTreeDirection, setDefaultTreeDirection] = React.useState(() => {
        try {
          return (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('rt-tree-direction')) || 'horizontal'
        } catch { return 'horizontal' }
      })
      const [uiLocalePref, setUiLocalePref] = React.useState(() => {
        const stored = readStoredLocale()
        return stored || (_syncedUiLocale === 'zh-CN' || _syncedUiLocale === 'en-US' ? _syncedUiLocale : 'auto')
      })
      const [verNote, setVerNote] = React.useState(null)

      const loadSeq = React.useRef(0)

      const applySettingsPayload = React.useCallback((res, isInitialLoad) => {
        if (!res || typeof res !== 'object') return
        const cfg = (res.settings && typeof res.settings === 'object') ? res.settings : res
        const ai = cfg.aiPlanner || cfg.ai_planner || res.aiPlanner || res.ai_planner || {}
        const rawDp = cfg.dispatchPolicy || cfg.dispatch_policy || res.dispatchPolicy || res.dispatch_policy || null
        const dp = rawDp || {}
        const rawUip = cfg.uiPreferences || cfg.ui_preferences || res.uiPreferences || res.ui_preferences || null
        const uip = rawUip || {}

        const catalog = normalizeModelCatalog(res.model_catalog || res.modelCatalog || cfg.model_catalog)
        if (isInitialLoad || catalog.length > 0) setModelCatalog(catalog)
        if (isInitialLoad || res.active_session_route !== undefined || res.activeSessionRoute !== undefined) {
          setSessionRoute(res.active_session_route || res.activeSessionRoute || null)
        }

        if (isInitialLoad || cfg.aiPlanner || cfg.ai_planner || res.aiPlanner || res.ai_planner) {
          const rawMode = String(ai.modelMode ?? ai.model_mode ?? 'follow_session').trim().toLowerCase()
          setModelMode(rawMode === 'custom' ? 'custom' : 'follow_session')
          const nextProv = String(ai.provider || '').trim()
          const nextMod = String(ai.model || '').trim()
          if (nextProv) {
            setProvider(nextProv)
          } else if (catalog.length > 0) {
            setProvider(catalog[0].id)
          } else {
            setProvider('')
          }
          if (nextMod) {
            setModel(nextMod)
          } else if (catalog.length > 0 && catalog[0].models.length > 0) {
            setModel(catalog[0].models[0].id)
          } else {
            setModel('')
          }

          const rawRe = String(ai.reasoningEffort ?? ai.reasoning_effort ?? 'low').trim().toLowerCase()
          setReasoningEffort(['none', 'low', 'medium', 'high'].includes(rawRe) ? rawRe : 'low')
          const tMs = Number(ai.timeoutMs ?? ai.timeout_ms)
          setTimeoutSec(Number.isFinite(tMs) && tMs > 0 ? Math.max(15, Math.min(180, Math.round(tMs / 1000))) : 60)
          setScanRepoContext((ai.scanRepoContext ?? ai.scan_repo_context) !== false)
          setCustomConstraints(String(ai.customConstraints ?? ai.custom_constraints ?? ''))
        }

        const rawMax = Number(cfg.maxAgents ?? cfg.max_agents ?? cfg.max ?? res.maxAgents ?? res.max)
        if (Number.isFinite(rawMax) && rawMax >= 1) setMaxAgents(Math.max(1, Math.min(12, Math.floor(rawMax))))
        const rawLim = Number(cfg.limit ?? res.limit)
        if (Number.isFinite(rawLim) && rawLim >= 1) setMaxLimit(rawLim)
        const rawThink = String(cfg.thinkingEffort ?? cfg.thinking_effort ?? cfg.thinking ?? res.thinkingEffort ?? '').trim().toLowerCase()
        if (['low', 'medium', 'high'].includes(rawThink)) {
          setThinkingEffort(rawThink)
        } else if (isInitialLoad) {
          setThinkingEffort('low')
        }
        const rawDepth = Number(cfg.maxDepth ?? cfg.max_depth ?? res.maxDepth)
        if (Number.isFinite(rawDepth) && rawDepth >= 1) setMaxDepth(Math.max(1, Math.min(5, Math.floor(rawDepth))))

        if (rawDp || isInitialLoad) {
          const rawDm = String(dp.dispatchMode ?? dp.dispatch_mode ?? 'hybrid_auto').trim().toLowerCase()
          setDispatchMode(rawDm === 'captain_only' ? 'captain_only' : 'hybrid_auto')
          const rawSubProv = String(dp.subagentProvider ?? dp.subagent_provider ?? 'spawn').trim().toLowerCase()
          setSubagentProvider(rawSubProv === 'fork' ? 'fork' : 'spawn')
          setAutoWakeOnApprove((dp.autoWakeOnApprove ?? dp.auto_wake_on_approve) !== false)
          setAutoAdvanceWave(Boolean(dp.autoAdvanceWave ?? dp.auto_advance_wave))
          const rawTokCap = Number(dp.maxTokensPerWorkspace ?? dp.max_tokens_per_workspace)
          if (Number.isFinite(rawTokCap) && rawTokCap >= 0) setMaxTokensPerWorkspace(Math.floor(rawTokCap))
          else if (isInitialLoad) setMaxTokensPerWorkspace(0)
          const rawCostCap = Number(dp.maxCostPerWorkspace ?? dp.max_cost_per_workspace)
          if (Number.isFinite(rawCostCap) && rawCostCap >= 0) setMaxCostPerWorkspace(rawCostCap)
          else if (isInitialLoad) setMaxCostPerWorkspace(0)
          const rawRetries = Number(dp.maxAutoRetries ?? dp.max_auto_retries)
          if (Number.isFinite(rawRetries) && rawRetries >= 0) setMaxAutoRetries(Math.max(0, Math.min(3, Math.floor(rawRetries))))
          else if (isInitialLoad) setMaxAutoRetries(0)
          setSpeculativeWaveDispatch(Boolean(dp.speculativeWaveDispatch ?? dp.speculative_wave_dispatch))
        }

        if (isInitialLoad || res.db_engine || res.dbEngine || cfg.db_engine || res.pgUrlConfigured !== undefined || cfg.pgUrlConfigured !== undefined) {
          const engInfo = res.db_engine || res.dbEngine || cfg.db_engine || null
          setDbEngine(engInfo)
          const masked = String(cfg.pgUrlMasked ?? res.pgUrlMasked ?? (engInfo && (engInfo.urlMasked || engInfo.maskedUrl)) ?? '')
          const configured = Boolean(
            cfg.pgUrlConfigured
            ?? res.pgUrlConfigured
            ?? (engInfo && (engInfo.configured || engInfo.mode === 'postgresql' || engInfo.engine === 'postgresql')),
          )
          setPgUrlMasked(masked)
          setPgUrlConfigured(configured)
        }

        const fCfg = res.feishu_config || res.feishuConfig || res.feishu || cfg.feishu_config || null
        if (fCfg && typeof fCfg === 'object') {
          setFeishuWebhook(String(fCfg.webhook_url ?? fCfg.webhookUrl ?? fCfg.webhook ?? ''))
          const ev = fCfg.events
          if (Array.isArray(ev)) {
            setFeishuOnNode(ev.includes('on_node') || ev.includes('wave_complete'))
            setFeishuOnGate(ev.includes('on_gate') || ev.includes('gate_approval') || ev.includes('gate_alert'))
            setFeishuOnShip(ev.includes('on_ship') || ev.includes('milestone_hit') || ev.includes('daily_digest'))
          } else if (ev && typeof ev === 'object') {
            setFeishuOnNode((ev.on_node ?? ev.wave_complete) !== false)
            setFeishuOnGate((ev.on_gate ?? ev.gate_approval ?? ev.gate_alert) !== false)
            setFeishuOnShip((ev.on_ship ?? ev.milestone_hit ?? ev.daily_digest) !== false)
          }
        }

        if (rawUip || isInitialLoad) {
          const rawVm = String(uip.defaultViewMode ?? uip.default_view_mode ?? uiState.uiMode ?? 'novice').trim().toLowerCase()
          setDefaultViewMode(rawVm === 'expert' ? 'expert' : 'novice')
          const rawTd = String(uip.defaultTreeDirection ?? uip.default_tree_direction ?? 'horizontal').trim().toLowerCase()
          setDefaultTreeDirection(rawTd === 'vertical' ? 'vertical' : 'horizontal')
          if (uip.locale !== undefined || uip.uiLocale !== undefined || uip.ui_locale !== undefined) {
            const rawLoc = String(uip.locale ?? uip.uiLocale ?? uip.ui_locale ?? 'auto').trim()
            const normLoc = normalizeLocalePref(rawLoc)
            setUiLocalePref(readStoredLocale() || normLoc)
            syncLocaleFromSettings(normLoc)
          }
        }
      }, [uiState.uiMode])

      const loadSettings = React.useCallback(() => {
        const my = ++loadSeq.current
        setLoading(true)
        setErr(null)
        api({
          op: 'getSettings',
          engagement: eng || undefined,
          session: activeSid || undefined,
        }).then((r) => {
          if (my !== loadSeq.current) return
          setLoading(false)
          if (!r || r.ok === false) {
            setErr((r && r.error) || t('读取设置失败', 'Failed to load settings'))
            return
          }
          applySettingsPayload(r, true)
        }, (e) => {
          if (my !== loadSeq.current) return
          setLoading(false)
          setErr(String((e && e.message) || e))
        })
      }, [eng, activeSid, applySettingsPayload])

      React.useEffect(() => {
        loadSettings()
      }, [loadSettings, refreshKey])

      const selectedGroup = React.useMemo(() => {
        if (modelCatalog.length === 0) return null
        return modelCatalog.find((g) => g.id === provider) || modelCatalog[0]
      }, [modelCatalog, provider])

      const modelOptions = React.useMemo(() => {
        const list = selectedGroup && Array.isArray(selectedGroup.models) ? selectedGroup.models.slice() : []
        if (model && !list.some((m) => m.id === model)) {
          list.unshift({ id: model, name: model })
        }
        return list
      }, [selectedGroup, model])

      const handleProviderChange = (nextProv) => {
        setProvider(nextProv)
        const grp = modelCatalog.find((g) => g.id === nextProv)
        if (grp && Array.isArray(grp.models) && grp.models.length > 0) {
          if (!grp.models.some((m) => m.id === model)) {
            setModel(grp.models[0].id)
          }
        }
      }

      const handleSaveAll = () => {
        setSaving(true)
        setSaveMsg(null)
        setErr(null)
        const sec = Math.max(15, Math.min(180, Math.round(Number(timeoutSec) || 60)))
        const cleanTokCap = Math.max(0, Math.floor(Number(maxTokensPerWorkspace) || 0))
        const cleanCostCap = Math.max(0, Number(maxCostPerWorkspace) || 0)
        const cleanRetries = Math.max(0, Math.min(3, Math.floor(Number(maxAutoRetries) || 0)))
        const cleanLocale = normalizeLocalePref(uiLocalePref)
        api({
          op: 'saveSettings',
          engagement: eng || undefined,
          session: activeSid || undefined,
          maxAgents: maxAgents,
          thinkingEffort: thinkingEffort,
          maxDepth: maxDepth,
          aiPlanner: {
            modelMode: modelMode === 'custom' ? 'custom' : 'follow_session',
            provider: provider.trim(),
            model: model.trim(),
            reasoningEffort: reasoningEffort,
            timeoutMs: sec * 1000,
            scanRepoContext: Boolean(scanRepoContext),
            customConstraints: customConstraints,
          },
          dispatchPolicy: {
            dispatchMode: dispatchMode === 'captain_only' ? 'captain_only' : 'hybrid_auto',
            subagentProvider: subagentProvider === 'fork' ? 'fork' : 'spawn',
            autoWakeOnApprove: Boolean(autoWakeOnApprove),
            autoAdvanceWave: Boolean(autoAdvanceWave),
            maxTokensPerWorkspace: cleanTokCap,
            maxCostPerWorkspace: cleanCostCap,
            maxAutoRetries: cleanRetries,
            speculativeWaveDispatch: Boolean(speculativeWaveDispatch),
          },
          uiPreferences: {
            defaultViewMode: defaultViewMode === 'expert' ? 'expert' : 'novice',
            defaultTreeDirection: defaultTreeDirection === 'vertical' ? 'vertical' : 'horizontal',
            locale: cleanLocale,
          },
        }).then((r) => {
          setSaving(false)
          if (!r || r.ok === false) {
            setSaveMsg({ err: (r && r.error) || t('保存设置失败', 'Failed to save settings') })
            return
          }
          applySettingsPayload(r, false)
          setUiMode(defaultViewMode === 'expert' ? 'expert' : 'novice')
          syncLocaleFromSettings(cleanLocale)
          setLocale(cleanLocale)
          try {
            if (typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.setItem('rt-tree-direction', defaultTreeDirection === 'vertical' ? 'vertical' : 'horizontal')
            }
          } catch { /* ignore */ }
          setSaveMsg({ ok: (r && r.note) || t('设置已保存并立即生效', 'Settings saved and applied') })
          onRefresh()
        }, (e) => {
          setSaving(false)
          setSaveMsg({ err: String((e && e.message) || e) })
        })
      }

      const handleProbePg = () => {
        setPgBusy(true)
        setPgMsg(null)
        api({ op: 'probePg', url: pgUrlDraft.trim() || undefined }).then((r) => {
          setPgBusy(false)
          if (r && r.db_engine) setDbEngine(r.db_engine)
          if (!r || r.ok === false) {
            setPgMsg({ err: (r && (r.error || r.message || r.note)) || t('PostgreSQL 连接探测失败', 'PostgreSQL connection probe failed') })
            return
          }
          setPgMsg({ ok: (r && (r.note || r.message)) || t('PostgreSQL 连接探测成功', 'PostgreSQL connection probe succeeded') })
        }, (e) => {
          setPgBusy(false)
          setPgMsg({ err: String((e && e.message) || e) })
        })
      }

      const handleSavePgUrl = (nextUrl) => {
        const clean = String(nextUrl || '').trim()
        setPgBusy(true)
        setPgMsg(null)
        api({ op: 'setPgUrl', url: clean }).then((r) => {
          setPgBusy(false)
          if (!r || r.ok === false) {
            setPgMsg({ err: (r && r.error) || t('更新 PostgreSQL 连接失败', 'Failed to update PostgreSQL connection') })
            return
          }
          if (r.db_engine) setDbEngine(r.db_engine)
          setPgUrlConfigured(Boolean(r.url || clean))
          if (!clean) {
            setPgUrlDraft('')
            setPgUrlMasked('')
          }
          setPgMsg({ ok: (r && r.note) || (clean ? t('PostgreSQL 连接已保存', 'PostgreSQL connection saved') : t('已切换回本地引擎', 'Switched back to local SQLite engine')) })
          onRefresh()
        }, (e) => {
          setPgBusy(false)
          setPgMsg({ err: String((e && e.message) || e) })
        })
      }

      const handleSaveFeishu = () => {
        const url = String(feishuWebhook || '').trim()
        setFeishuBusy(true)
        setFeishuMsg(null)
        api({
          op: 'feishuConfig',
          engagement: targetFeishuEng,
          engagement_id: targetFeishuEng,
          webhook_url: url,
          webhook: url,
          enabled: Boolean(url),
          events: {
            on_node: feishuOnNode,
            wave_complete: feishuOnNode,
            on_gate: feishuOnGate,
            gate_approval: feishuOnGate,
            gate_alert: feishuOnGate,
            on_ship: feishuOnShip,
            milestone_hit: feishuOnShip,
          },
        }).then((r) => {
          setFeishuBusy(false)
          if (!r || r.ok === false) {
            setFeishuMsg({ err: (r && r.error) || t('保存飞书配置失败', 'Failed to save Feishu config') })
            return
          }
          setFeishuMsg({ ok: (r && r.note) || t('飞书配置已保存', 'Feishu config saved') })
        }, (e) => {
          setFeishuBusy(false)
          setFeishuMsg({ err: String((e && e.message) || e) })
        })
      }

      const handleTestFeishu = () => {
        setFeishuBusy(true)
        setFeishuMsg(null)
        api({
          op: 'feishuTestPush',
          engagement: targetFeishuEng,
          engagement_id: targetFeishuEng,
          webhook_url: String(feishuWebhook || '').trim() || undefined,
          title: t('LMTAgent 飞书连接测试', 'LMTAgent Feishu Connection Test'),
          text: t('来自工作区「' + targetFeishuEng + '」的连通性测试推送', 'Connectivity test push from workspace "' + targetFeishuEng + '"'),
        }).then((r) => {
          setFeishuBusy(false)
          if (!r || r.ok === false) {
            setFeishuMsg({ err: (r && r.error) || t('测试推送失败', 'Test push failed') })
            return
          }
          setFeishuMsg({ ok: (r && r.note) || t('测试推送已发送', 'Test push sent') })
        }, (e) => {
          setFeishuBusy(false)
          setFeishuMsg({ err: String((e && e.message) || e) })
        })
      }

      const checkVersionQuick = () => {
        setVerNote(t('正在检查版本…', 'Checking version…'))
        api({ op: 'updateCheck' }).then((r) => {
          if (r && r.ok !== false) {
            setVerNote(t('当前 v', 'Current v') + (r.current || '?') + (r.updateAvailable && r.latest ? (t(' · 可升级至 v', ' · Update available v') + r.latest) : t(' · 已是最新', ' · Up to date')))
            return
          }
          api({ op: 'version' }).then((v) => {
            const cur = v && v.plugin ? v.plugin.version : (v && v.current)
            setVerNote(t('当前版本 v', 'Current v') + (cur || '?'))
          }, () => setVerNote(t('版本检查暂不可用', 'Version check unavailable')))
        }, () => setVerNote(t('版本检查暂不可用', 'Version check unavailable')))
      }

      const routeLabel = (() => {
        if (!sessionRoute) return t('跟随当前会话默认模型', 'Follow Active Session Model')
        if (typeof sessionRoute === 'string') return sessionRoute
        const p = sessionRoute.provider ? String(sessionRoute.provider) : ''
        const m = sessionRoute.model ? String(sessionRoute.model) : ''
        if (p && m) return p + ' / ' + m
        return String(sessionRoute.label || m || p || t('跟随当前会话默认模型', 'Follow Active Session Model'))
      })()

      const isPgActive = Boolean(
        pgUrlConfigured
        || (dbEngine && (dbEngine.mode === 'postgresql' || dbEngine.engine === 'postgresql' || dbEngine.type === 'postgresql')),
      )
      const dbStatusLabel = (() => {
        if (dbEngine && typeof dbEngine === 'string') {
          return dbEngine === 'SQLite WAL 本地引擎' ? t('SQLite WAL 本地引擎', 'SQLite WAL Local Engine') : dbEngine
        }
        if (dbEngine && (dbEngine.label || dbEngine.mode || dbEngine.engine)) {
          if (dbEngine.label === 'SQLite WAL 本地引擎') return t('SQLite WAL 本地引擎', 'SQLite WAL Local Engine')
          return String(dbEngine.label || (isPgActive ? 'PostgreSQL' : t('SQLite WAL 本地引擎', 'SQLite WAL Local Engine')))
        }
        return isPgActive ? t('PostgreSQL 已配置', 'PostgreSQL Configured') : t('SQLite WAL 本地引擎', 'SQLite WAL Local Engine')
      })()

      const slotPresets = [3, 6, 8, 12]

      const shellBody = h('div', { className: 'rt-settings-shell' },
        err ? h('div', { className: 'rt-err' }, err) : null,
        saveMsg ? h('div', { className: saveMsg.err ? 'rt-err' : 'rt-note', style: { margin: 0 } }, saveMsg.err || saveMsg.ok) : null,

        /* ① AI 需求拆解与模型设置 */
        h('section', { className: 'rt-settings-section' },
          h('div', { className: 'rt-settings-section-head' },
            h('h4', { className: 'rt-settings-section-title' }, t('AI 需求拆解与模型设置', 'AI Decomposition & Model Settings')),
            h('span', { className: 'rt-settings-badge' }, routeLabel)),
          h('div', { className: 'rt-settings-grid' },
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('模型选择策略', 'Model Selection Strategy')),
              h('select', {
                className: 'rt-select',
                value: modelMode,
                onChange: (e) => setModelMode(e.target.value),
              },
                h('option', { value: 'follow_session' }, t('跟随当前会话 / 默认模型', 'Follow Current Session / Default')),
                h('option', { value: 'custom' }, t('自定义指定模型', 'Custom Model')))),
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('规划推理深度', 'Planning Reasoning Depth')),
              h('select', {
                className: 'rt-select',
                value: reasoningEffort,
                onChange: (e) => setReasoningEffort(e.target.value),
              },
                h('option', { value: 'none' }, t('none（关闭推理）', 'none (Off)')),
                h('option', { value: 'low' }, t('low（快速）', 'low (Fast)')),
                h('option', { value: 'medium' }, t('medium（均衡）', 'medium (Balanced)')),
                h('option', { value: 'high' }, t('high（深度）', 'high (Deep)')))),
            modelMode === 'custom'
              ? h('div', { className: 'rt-settings-field' },
                  h('label', null, 'Provider'),
                  modelCatalog.length > 0
                    ? h('select', {
                        className: 'rt-select',
                        value: (selectedGroup && selectedGroup.id) || provider,
                        onChange: (e) => handleProviderChange(e.target.value),
                      },
                        provider && !modelCatalog.some((g) => g.id === provider)
                          ? h('option', { value: provider }, provider)
                          : null,
                        modelCatalog.map((g) => h('option', { key: 'pv-' + g.id, value: g.id }, g.name)))
                    : h('input', {
                        className: 'rt-input',
                        value: provider,
                        placeholder: t('如 deepseek / openai', 'e.g. deepseek / openai'),
                        onChange: (e) => setProvider(e.target.value),
                      }))
              : null,
            modelMode === 'custom'
              ? h('div', { className: 'rt-settings-field' },
                  h('label', null, 'Model'),
                  modelOptions.length > 0
                    ? h('select', {
                        className: 'rt-select',
                        value: model,
                        onChange: (e) => setModel(e.target.value),
                      }, modelOptions.map((m) => h('option', { key: 'md-' + m.id, value: m.id }, m.name)))
                    : h('input', {
                        className: 'rt-input',
                        value: model,
                        placeholder: t('如 deepseek-chat', 'e.g. deepseek-chat'),
                        onChange: (e) => setModel(e.target.value),
                      }))
              : null,
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('拆解超时（秒）', 'Refine Timeout (sec)')),
              h('input', {
                type: 'number',
                min: 15,
                max: 180,
                className: 'rt-input',
                value: String(timeoutSec),
                onChange: (e) => setTimeoutSec(Number(e.target.value) || 60),
              })),
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('工作区上下文', 'Workspace Context')),
              h('label', { className: 'rt-kb-check', style: { marginTop: 4 } },
                h('input', {
                  type: 'checkbox',
                  checked: scanRepoContext,
                  onChange: (e) => setScanRepoContext(e.target.checked),
                }),
                t('拆解前自动扫描项目目录结构', 'Auto-scan repository layout before decomposition'))),
            h('div', { className: 'rt-settings-field is-full' },
              h('label', null, t('全局拆解工程约束', 'Global Engineering Constraints')),
              h('textarea', {
                className: 'rt-textarea',
                rows: 3,
                value: customConstraints,
                placeholder: t('填写全局代码规范、技术栈限制或路径禁改规则…', 'Global coding standards, stack limits, or protected path rules…'),
                onChange: (e) => setCustomConstraints(e.target.value),
              })))),

        /* ② 集群并发与任务派发策略 */
        h('section', { className: 'rt-settings-section' },
          h('div', { className: 'rt-settings-section-head' },
            h('h4', { className: 'rt-settings-section-title' }, t('集群并发与任务派发策略', 'Cluster Concurrency & Dispatch Policy')),
            h('span', { className: 'rt-settings-badge' }, maxAgents + t(' 槽', ' slots') + ' · depth ' + maxDepth + ' · ' + thinkingEffort)),
          h('div', { className: 'rt-settings-grid' },
            h('div', { className: 'rt-settings-field is-full' },
              h('label', null, t('并发槽位上限（1–' + maxLimit + '）', 'Max Concurrency Slots (1-' + maxLimit + ')')),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                h('div', { className: 'rt-p3-stepper' },
                  h('button', {
                    type: 'button', className: 'rt-p3-step-btn', disabled: maxAgents <= 1,
                    onClick: () => setMaxAgents((v) => Math.max(1, v - 1)),
                  }, '-'),
                  h('span', { className: 'rt-p3-step-val' }, maxAgents + t(' 槽', ' slots')),
                  h('button', {
                    type: 'button', className: 'rt-p3-step-btn', disabled: maxAgents >= maxLimit,
                    onClick: () => setMaxAgents((v) => Math.min(maxLimit, v + 1)),
                  }, '+')),
                h('div', { className: 'rt-p3-pills' },
                  slotPresets.filter((n) => n <= maxLimit).map((n) => h('button', {
                    key: 'cfg-slot-' + n,
                    type: 'button',
                    className: 'rt-p3-pill' + (maxAgents === n ? ' on' : ''),
                    onClick: () => setMaxAgents(n),
                  }, n + t(' 槽', ' slots')))))),
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('子代理思考强度', 'Subagent Thinking Effort')),
              h('select', {
                className: 'rt-select',
                value: thinkingEffort,
                onChange: (e) => setThinkingEffort(e.target.value),
              },
                h('option', { value: 'low' }, t('low（快速响应）', 'low (Fast)')),
                h('option', { value: 'medium' }, t('medium（均衡）', 'medium (Balanced)')),
                h('option', { value: 'high' }, t('high（深度思考）', 'high (Deep)')))),
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('递归深度上限', 'Max Spawn Depth')),
              h('select', {
                className: 'rt-select',
                value: String(maxDepth),
                onChange: (e) => setMaxDepth(Number(e.target.value) || 3),
              }, [1, 2, 3, 4, 5].map((d) => h('option', { key: 'md-' + d, value: String(d) }, 'maxDepth = ' + d)))),
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('立项默认派发方式', 'Default Dispatch Mode')),
              h('select', {
                className: 'rt-select',
                value: dispatchMode,
                onChange: (e) => setDispatchMode(e.target.value),
              },
                h('option', { value: 'hybrid_auto' }, t('方案 A 混合编排（hybrid_auto）', 'Hybrid Orchestration (hybrid_auto)')),
                h('option', { value: 'captain_only' }, t('纯主代理接管（captain_only）', 'Captain Only (captain_only)')))),
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('子代理载体', 'Subagent Provider')),
              h('select', {
                className: 'rt-select',
                value: subagentProvider,
                onChange: (e) => setSubagentProvider(e.target.value),
              },
                h('option', { value: 'spawn' }, t('spawn（独立子代理）', 'spawn (Isolated Subagent)')),
                h('option', { value: 'fork' }, t('fork（分叉上下文）', 'fork (Forked Context)')))),
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('单工作区 Token 上限 (0=不限)', 'Workspace Token Cap (0=Unlimited)')),
              h('input', {
                type: 'number',
                min: 0,
                step: 10000,
                className: 'rt-input',
                value: String(maxTokensPerWorkspace),
                onChange: (e) => {
                  const v = Number(e.target.value)
                  setMaxTokensPerWorkspace(Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
                },
              })),
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('单工作区费用上限 (0=不限)', 'Workspace Cost Cap (0=Unlimited)')),
              h('input', {
                type: 'number',
                min: 0,
                step: 0.5,
                className: 'rt-input',
                value: String(maxCostPerWorkspace),
                onChange: (e) => {
                  const v = Number(e.target.value)
                  setMaxCostPerWorkspace(Number.isFinite(v) && v >= 0 ? v : 0)
                },
              })),
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('失败自动重试次数 (0-3)', 'Auto-Retry on Failure (0-3)')),
              h('select', {
                className: 'rt-select',
                value: String(maxAutoRetries),
                onChange: (e) => {
                  const v = Number(e.target.value)
                  setMaxAutoRetries(Number.isFinite(v) ? Math.max(0, Math.min(3, Math.floor(v))) : 0)
                },
              },
                [0, 1, 2, 3].map((r) => h('option', { key: 'ar-' + r, value: String(r) }, r === 0 ? t('0（不自动重试）', '0 (Disabled)') : String(r))))),
            h('div', { className: 'rt-settings-field is-full' },
              h('label', { className: 'rt-kb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: autoWakeOnApprove,
                  onChange: (e) => setAutoWakeOnApprove(e.target.checked),
                }),
                t('门禁审批通过后自动唤醒目标子会话继续执行', 'Auto-wake target sub-session after gate approval'))),
            h('div', { className: 'rt-settings-field is-full' },
              h('label', { className: 'rt-kb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: autoAdvanceWave,
                  onChange: (e) => setAutoAdvanceWave(e.target.checked),
                }),
                t('Wave 间自动接力推进（当前 Wave 全部审批后自动拉起下一波次）', 'Auto-advance across waves when all gates in current wave are approved'))),
            h('div', { className: 'rt-settings-field is-full' },
              h('label', { className: 'rt-kb-check' },
                h('input', {
                  type: 'checkbox',
                  checked: speculativeWaveDispatch,
                  onChange: (e) => setSpeculativeWaveDispatch(e.target.checked),
                }),
                t('实验性：DAG 投机式波次流水线', 'Experimental: Speculative DAG Pipelining'))))),

        /* ③ 存储与 PostgreSQL 连接 */
        h('section', { className: 'rt-settings-section' },
          h('div', { className: 'rt-settings-section-head' },
            h('h4', { className: 'rt-settings-section-title' }, t('存储与 PostgreSQL 连接', 'Storage & PostgreSQL Connection')),
            h('span', { className: 'rt-settings-badge ' + (isPgActive ? 'is-ok' : '') },
              dbStatusLabel + (pgUrlMasked ? ' · ' + pgUrlMasked : ''))),
          h('div', { className: 'rt-settings-field is-full' },
            h('label', null, t('PostgreSQL 连接串（留空则使用本地 SQLite WAL 引擎）', 'PostgreSQL Connection String (leave blank for local SQLite WAL)')),
            h('input', {
              className: 'rt-input rt-mono',
              value: pgUrlDraft,
              placeholder: pgUrlMasked || 'postgresql://user:pass@127.0.0.1:5432/lmtagent',
              onChange: (e) => setPgUrlDraft(e.target.value),
            })),
          pgMsg ? h('div', { className: pgMsg.err ? 'rt-err' : 'rt-note', style: { margin: 0 } }, pgMsg.err || pgMsg.ok) : null,
          h('div', { className: 'rt-settings-actions' },
            h('button', { type: 'button', className: 'rt-btn', disabled: pgBusy, onClick: handleProbePg }, pgBusy ? t('探测中…', 'Probing…') : t('测试连通', 'Probe')),
            h('button', {
              type: 'button',
              className: 'rt-btn rt-btn-primary',
              disabled: pgBusy || !pgUrlDraft.trim(),
              onClick: () => handleSavePgUrl(pgUrlDraft),
            }, t('保存连接', 'Save Connection')),
            h('button', {
              type: 'button',
              className: 'rt-btn',
              disabled: pgBusy,
              onClick: () => handleSavePgUrl(''),
            }, t('清除回本地引擎', 'Reset to SQLite')))),

        /* ④ 通知集成（飞书机器人） */
        h('section', { className: 'rt-settings-section' },
          h('div', { className: 'rt-settings-section-head' },
            h('h4', { className: 'rt-settings-section-title' }, t('通知集成（飞书机器人）', 'Notifications (Feishu Webhook)')),
            h('span', { className: 'rt-settings-badge' }, t('工作区：', 'Workspace: ') + targetFeishuEng)),
          h('div', { className: 'rt-settings-field is-full' },
            h('label', null, t('飞书 Webhook 地址', 'Feishu Webhook URL')),
            h('input', {
              className: 'rt-input rt-mono',
              value: feishuWebhook,
              placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/...',
              onChange: (e) => setFeishuWebhook(e.target.value),
            })),
          h('div', { className: 'rt-settings-row' },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' } },
              h('label', { className: 'rt-kb-check' },
                h('input', { type: 'checkbox', checked: feishuOnNode, onChange: (e) => setFeishuOnNode(e.target.checked) }),
                t('节点完成', 'Node Done')),
              h('label', { className: 'rt-kb-check' },
                h('input', { type: 'checkbox', checked: feishuOnGate, onChange: (e) => setFeishuOnGate(e.target.checked) }),
                t('门禁审批', 'Gate Approval')),
              h('label', { className: 'rt-kb-check' },
                h('input', { type: 'checkbox', checked: feishuOnShip, onChange: (e) => setFeishuOnShip(e.target.checked) }),
                t('交付归档', 'Ship / Delivery'))),
            h('div', { className: 'rt-settings-actions' },
              h('button', { type: 'button', className: 'rt-btn', disabled: feishuBusy, onClick: handleSaveFeishu }, t('保存通知', 'Save Notifications')),
              h('button', { type: 'button', className: 'rt-btn rt-btn-primary', disabled: feishuBusy, onClick: handleTestFeishu }, t('发送测试推送', 'Send Test Push')))),
          feishuMsg ? h('div', { className: feishuMsg.err ? 'rt-err' : 'rt-note', style: { margin: 0 } }, feishuMsg.err || feishuMsg.ok) : null),

        /* ⑤ 界面偏好与角色预设管理 */
        h('section', { className: 'rt-settings-section' },
          h('div', { className: 'rt-settings-section-head' },
            h('h4', { className: 'rt-settings-section-title' }, t('界面偏好与角色预设管理', 'UI Preferences & Role Presets')),
            verNote ? h('span', { className: 'rt-settings-badge' }, verNote) : null),
          h('div', { className: 'rt-settings-grid' },
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('默认视图模式', 'Default View Mode')),
              h('select', {
                className: 'rt-select',
                value: defaultViewMode,
                onChange: (e) => setDefaultViewMode(e.target.value),
              },
                h('option', { value: 'novice' }, t('协同模式（简洁）', 'Collaborative (Simple)')),
                h('option', { value: 'expert' }, t('工程模式（专家）', 'Engineering (Expert)')))),
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('派生树默认排版方向', 'Spawn Tree Direction')),
              h('select', {
                className: 'rt-select',
                value: defaultTreeDirection,
                onChange: (e) => setDefaultTreeDirection(e.target.value),
              },
                h('option', { value: 'horizontal' }, t('横向向右派生', 'Horizontal (Left to Right)')),
                h('option', { value: 'vertical' }, t('纵向向下派生', 'Vertical (Top to Bottom)')))),
            h('div', { className: 'rt-settings-field' },
              h('label', null, t('界面语言', 'Interface Language')),
              h('select', {
                className: 'rt-select',
                value: uiLocalePref,
                onChange: (e) => {
                  const next = normalizeLocalePref(e.target.value)
                  setUiLocalePref(next)
                  setLocale(next)
                },
              },
                h('option', { value: 'auto' }, t('跟随浏览器（自动）', 'Auto (Browser)')),
                h('option', { value: 'zh-CN' }, '简体中文 (zh-CN)'),
                h('option', { value: 'en-US' }, 'English (en-US)')))),
          h('div', { className: 'rt-settings-row' },
            h('p', { className: 'rt-settings-hint' }, t('管理 8 位 gstack 研发角色的提示词模板或检查控制台版本。', 'Manage the 8 gstack engineering role prompt templates or check console version.')),
            h('div', { className: 'rt-settings-actions' },
              h('button', {
                type: 'button',
                className: 'rt-btn',
                onClick: () => onGo('prompts'),
              }, t('前往「角色与提示词」', 'Open Roles & Prompts')),
              h('button', {
                type: 'button',
                className: 'rt-btn',
                onClick: checkVersionQuick,
              }, t('检查版本', 'Check Version'))))),

        /* 底部统一保存条 */
        h('div', { className: 'rt-settings-actions' },
          h('button', {
            type: 'button',
            className: 'rt-btn',
            disabled: loading || saving,
            onClick: loadSettings,
          }, loading ? t('加载中…', 'Loading…') : t('重新读取', 'Reload')),
          h('button', {
            type: 'button',
            className: 'rt-btn rt-btn-primary',
            disabled: saving,
            onClick: handleSaveAll,
          }, saving ? t('保存中…', 'Saving…') : t('保存设置', 'Save Settings'))))

      if (compact) return shellBody

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, t('统一设置中心', 'Unified Settings')),
          h('span', { className: 'rt-tag rt-tag-passive' }, eng ? (t('工作区：', 'Workspace: ') + eng) : t('全局设置', 'Global Settings')),
          h('div', { className: 'rt-spacer' }),
          h('button', { type: 'button', className: 'rt-btn', disabled: loading, onClick: loadSettings }, loading ? t('读取中…', 'Loading…') : t('刷新', 'Refresh')),
          h('button', { type: 'button', className: 'rt-btn rt-btn-primary', disabled: saving, onClick: handleSaveAll }, saving ? t('保存中…', 'Saving…') : t('保存设置', 'Save Settings'))),
        h('div', { className: 'rt-pane', style: { overflow: 'auto' } }, shellBody))
    }
