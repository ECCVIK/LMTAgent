/**
 * 计分规则：判定口径 + 默认得分点（零依赖，只用 node: 内置模块）。
 *
 * 从 core.js 抽出来的模块，也是本项目**最该单独读的一份代码**：
 * 面板 / 报告 / 攻击链三处总分必须一致，靠的就是这里的 applyScoreCaps 与
 * evaluateScoreBoard 是**唯一实现** —— 三处各写一遍必然漂移成不同口径。
 *
 * 分工：
 *   · applyScoreCaps       —— 给定命中行，标出哪条计分、哪条被封顶/超上限；
 *   · evaluateScoreBoard   —— 把"读元数据 + 调 applyScoreCaps + 回填标记"包成一个入口；
 *   · DEFAULT_SCORE_POINTS —— 规则文档展开后的得分点定义（src/rule/cap/dedup_scope）。
 */

/* targetHasIpv6Host 要判定 IPv6 字面量：复用 ip-utils 的同一份实现，避免两套正则漂移 */
import { isIpv6 } from './ip-utils.js'

/* ------------------------------------------------------------------ 判定规则 */

/* ------------------------------------------------------------------ 判定规则 */

/**
 * 什么算"有效服务网关/跨环境通道"（算跨环境联调/生产网关打通的凭证）：**必须连接了目标服务实例**，
 * 即通道的一端在目标运行环境侧。三种情况：
 *   · target-outbound：目标服务主动建立外联健康通道（worker 节点注册、服务网格客户端连接）
 *   · target-http：经目标 HTTP/API 网关转发的调试通道
 *   · target-agent：经目标运行环境守护进程转发的联调通道（SSH 端口转发等）
 * 不算的：self-only —— 只在本地开发机或独立沙箱开的空代理，未连接任何目标模块。
 */
const TUNNEL_ENTRY_KINDS = {
  'target-outbound': '目标服务主动注册/外联通道（Worker 节点连接 / 服务网格客户端）',
  'target-http': '经目标 HTTP/API 网关通道（代理网关 / 调试端点）',
  'target-agent': '经目标运行容器/守护进程转发（SSH 端口转发等）',
  'self-only': '仅本地沙箱回环代理（不算跨环境连通，不算突破）',
}
export { TUNNEL_ENTRY_KINDS }

/** 这条通道算不算"打通了目标环境边界"。未声明（老数据/没填）返回 null，界面按"待确认"显示。 */
export function tunnelIsLegit(entryKind) {
  const k = String(entryKind || '').trim()
  if (k === '') return null
  return k !== 'self-only'
}

/**
 * 鉴权与接口验收类里程碑：**临时 mock 或自己注册的沙箱测试账号不算正式里程碑交付**。
 * 这些里程碑命中时会要求声明 self_created，避免把本地 mock 当成正式交付成果。
 */
const ACCOUNT_POINT_CODES = ['web-account-user', 'web-account-admin', 'server-shell', 'db-access', 'internal-pivot', 'core-system']
export { ACCOUNT_POINT_CODES }

/**
 * 按「服务实例」封顶的里程碑：**同一个服务节点的同一个端口只计一次最高等级交付分**。
 *
 *   · 接口与鉴权类（web-account-user / web-account-admin）——完成管理员级 RBAC 联调即该服务拿满：
 *     基础接口 10 分、完整 RBAC 20 分，同一服务上重复登记不再累加
 *     （两种档位算**同一类**：先交基础接口、后交完整鉴权，只按最高档计分）。
 *   · 数据库迁移类（db-access）——同口径：同一数据库实例完成 Schema 与读写验证即拿满。
 *
 * 其它里程碑按交付模块或上限规则累加。
 */
const SERVICE_CAPPED_POINT_CODES = ['web-account-user', 'web-account-admin', 'db-access']
export { SERVICE_CAPPED_POINT_CODES }

/**
 * 从 target 里解析端口：`http://h:8080/x`、`10.0.0.5:6379`、`10.0.0.5:22`。
 * 没有端口或解析不出返回 null（**不要编造 80/443**，否则会把不同服务并成一个）。
 */
export function parseTargetPort(target) {
  const t = String(target || '').trim()
  if (t === '') return null
  const url = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]+)/i.exec(t)
  const authority = url !== null ? url[1] : (/^([^\s/?#]+)/.exec(t) || [])[1]
  if (!authority) return null
  const m = /:(\d{1,5})$/.exec(authority)
  if (m === null) return null
  const n = Number(m[1])
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : null
}

/** 库列的 port 值（老库可能是 null/0/空串）。 */
function normalizePort(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isInteger(n) && n > 0 && n <= 65535 ? n : null
}

/**
 * 从 target 里取「服务标识」：host[:port]。
 *   · 端口取显式写的那个；没写就按协议推默认端口（http→80、https→443、其它→不推断），
 *     这样 `http://h/x` 与 `http://h:80/y` 会归到同一个服务；
 *   · 路径/参数/查询串一律丢掉（`http://h:8080/a/b?c=1` → `h:8080`）。
 * 解析不出 host 时返回 null。
 */
function targetAuthority(target) {
  const t = String(target || '').trim()
  if (t === '') return null
  const url = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]+)/i.exec(t)
  const scheme = url !== null ? url[1].toLowerCase() : null
  const authority = url !== null ? url[2] : (/^([^\s/?#]+)/.exec(t) || [])[1]
  if (!authority) return null
  const host = authority.replace(/:\d{1,5}$/, '').toLowerCase()
  if (host === '') return null
  let port = parseTargetPort(t)
  /* 没写端口时按协议补默认端口：避免同一个服务的两种写法被算成两个服务而被重复计分 */
  if (port === null) {
    if (scheme === 'http') port = 80
    else if (scheme === 'https') port = 443
  }
  return port === null ? host : host + ':' + port
}

/**
 * 「服务」键：得分封顶的粒度 = 同一个模块节点的同一个端口。
 *   · target 能解析出 host[:port] → 就用它（`t10.20.30.40:3306`）——
 *     同一个服务可能由不同角色记分，有的带 asset_id、有的只写 target，
 *     以目标为准才能把它们归到一起；
 *   · target 解析不出（缺失/只写了名字）→ 退到模块节点：有端口用 `a<id>:<port>`，
 *     没端口记 `a<id>:0`（该节点的默认端口）；
 *   · 两样都没有 → null（拿不到服务信息，这条不参与封顶）。
 */
export function scoreServiceKey(hit = {}) {
  const authority = targetAuthority(hit.target)
  if (authority !== null) return 't' + authority
  const assetId = hit.asset_id === null || hit.asset_id === undefined || hit.asset_id === '' ? null : Number(hit.asset_id)
  if (assetId === null) return null
  const port = normalizePort(hit.port)
  return 'a' + assetId + ':' + (port === null ? 0 : port)
}

/** 「服务」的可读标签，给告警/报告用（如 `10.1.2.3:8080`）。 */
export function serviceLabel(hit = {}, assetIp) {
  const ip = assetIp || hit.asset_ip || ''
  const port = normalizePort(hit.port) ?? parseTargetPort(hit.target)
  if (ip !== '') return port === null ? ip : ip + ':' + port
  /* 没有模块 id 时用 target 的 host[:port]（去掉路径与参数，别把整条 URL 当服务名）；
     端口来自库列而 target 里没写时补上，便于一眼看出是哪个服务。 */
  const authority = targetAuthority(hit.target)
  if (authority === null) return hit.target ? String(hit.target) : '(未标注服务)'
  if (port !== null && !/:\d{1,5}$/.test(authority)) return authority + ':' + port
  return authority
}

/**
 * 里程碑得分封顶与去重的**唯一实现**（数据驱动，v0.11.0 起）。
 *
 * 判定字段来自里程碑定义本身（`score_point.rule / cap / dedup_scope`），不再靠代码里的硬编码名单：
 *   · `dedup_scope = service` —— 同一（模块节点, 端口）只算分值最高的一条；
 *   · `dedup_scope = system`  —— 同一（模块节点, 端口, 系统名）只算最高档位一条，
 *     用于"同一个子系统只计算一次最高完成度分"；
 *   · `dedup_scope = target`  —— 整个项目工作区只算一次（跨环境网关打通、双栈支持）；
 *   · `dedup_scope = none`    —— 不去重，按节点/实例/算力卡数累加。
 * 之后按 `rule` 分组累计，超过该规则 `cap` 的部分标 `capped`（cap = 0 表示不设上限）。
 *
 * `self_created = 1`（临时沙箱自建/mock 账号）不计入正式交付分，既不参与竞争也不占位。
 *
 * @param {Array} rows - 命中行（需带 code / points / asset_id / port / target / recorded_at；
 *                       可选 system_key 供 system 口径使用）
 * @param {Map|Object|null} pointsByCode - code → `{rule, cap, dedup_scope, points}`；
 *                       省略时退化为"每个 code 自成一组、只去重不封顶"（兼容旧调用）
 * @returns {{capped:number, items:Array, caps:Map}} 打过标记的行 + 被封顶条数 + 各规则上限用量
 */
export function applyScoreCaps(rows = [], pointsByCode = null, nameByAsset = null) {
  const metaOf = (r) => {
    const m = pointsByCode === null || pointsByCode === undefined
      ? undefined
      : (typeof pointsByCode.get === 'function' ? pointsByCode.get(r.code) : pointsByCode[r.code])
    const rule = m && m.rule !== null && m.rule !== undefined ? Number(m.rule) : null
    const legacyScope = legacyCapGroup(r.code)
    return {
      group: rule === null ? 'code:' + String(r.code || '') : 'rule:' + rule,
      cap: m && Number(m.cap) > 0 ? Number(m.cap) : 0,
      scope: (m && m.dedup_scope) || legacyScope || 'none',
      rule,
    }
  }
  const flagged = (rows || []).map((r) => {
    const m = metaOf(r)
    return {
      ...r, capped: false, capped_by_id: null, capped_reason_kind: null,
      service_key: null, cap_group: m.group, dedup_scope: m.scope, rule: m.rule, rule_cap: m.cap,
    }
  })

  /* ① 计分口径去重：同一口径键内只保留分值最高的一条（同分取更早记的） */
  const buckets = new Map()
  for (const r of flagged) {
    if (Number(r.self_created) === 1) continue
    const scope = r.dedup_scope
    if (scope === 'none' || scope === null || scope === undefined) continue
    let key
    if (scope === 'target') key = 'target'
    else if (scope === 'system') key = 'sys:' + String(systemKeyOf(r, nameByAsset) || '')
    else {
      const svc = scoreServiceKey(r)
      if (svc === null || svc === undefined || String(svc) === '') continue
      key = 'svc:' + String(svc)
    }
    if (key === '' || key === 'svc:null' || key === 'sys:null') continue
    const k = r.cap_group + '|' + key
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(r)
  }
  let capped = 0
  for (const list of buckets.values()) {
    if (list.length < 2) continue
    const best = pickBestHit(list)
    for (const r of list) {
      if (r === best) continue
      r.capped = true
      r.capped_by_id = best.id
      r.capped_by_points = Number(best.points) || 0
      r.capped_by_evidence = best.evidence || null
      r.capped_reason_kind = 'dedup'
      capped += 1
    }
  }

  /* ② 规则上限：同一 rule 的计分命中累计不得超过 cap（按分值从高到低累计，超出的标 capped） */
  const caps = new Map()
  const byRule = new Map()
  for (const r of flagged) {
    if (r.capped === true || Number(r.self_created) === 1) continue
    if (r.rule_cap <= 0) continue
    if (!byRule.has(r.cap_group)) byRule.set(r.cap_group, [])
    byRule.get(r.cap_group).push(r)
  }
  for (const [group, list] of byRule.entries()) {
    const cap = list[0].rule_cap
    const ordered = [...list].sort((a, b) => {
      const pa = Number(a.points) || 0; const pb = Number(b.points) || 0
      if (pb !== pa) return pb - pa
      return Number(a.id) - Number(b.id)
    })
    let used = 0; let nCapped = 0
    for (const r of ordered) {
      const pts = Number(r.points) || 0
      if (used + pts > cap) {
        r.capped = true
        r.capped_reason_kind = 'cap'
        r.capped_by_points = null
        nCapped += 1
        capped += 1
      } else {
        used += pts
      }
    }
    caps.set(group, { rule: list[0].rule, cap, used, capped: nCapped })
  }
  return { capped, items: flagged, caps }
}

/**
 * 参与 `system` 口径去重的"系统键"。
 *
 * 规则：同一个子系统只计算一次最高完成度分。
 * 判定顺序：
 *   ① 命中自带的 `system_key`（调用方显式指定，最准）；
 *   ② 模块节点的 `primary_name`（服务名/域名的首选名）；
 *   ③ 退回服务键（节点:端口）。
 * 三条都拿不到返回 null —— 此时**不参与该口径去重**，宁可不封顶也不要错封。
 */
function systemKeyOf(hit = {}, nameByAsset = null) {
  const svc = scoreServiceKey(hit)
  const svcText = svc === null || svc === undefined ? '' : String(svc)

  const explicit = String(hit.system_key || '').trim()
  if (explicit !== '' && (svcText === '' || explicit.includes(svcText))) {
    const head = explicit.split('|')[0]
    if (svcText !== '' || String(head).trim() !== '') return explicit
  }

  const id = hit.asset_id === null || hit.asset_id === undefined || hit.asset_id === '' ? null : Number(hit.asset_id)
  const nameOf = (assetId) => {
    if (assetId === null || nameByAsset === null || nameByAsset === undefined) return null
    const raw = typeof nameByAsset.get === 'function' ? nameByAsset.get(assetId) : nameByAsset[assetId]
    const text = raw === null || raw === undefined ? '' : String(raw).trim()
    return text === '' ? null : text
  }
  const name = nameOf(id)
  if (name !== null) return name + '|' + svcText

  if (svcText !== '') return svcText

  return '#hit' + String(hit.id ?? '0')
}

/** 从一组同口径命中里挑"计分的那一条"：分值最高，同分取更早记的（id 小的）。 */
function pickBestHit(list) {
  return list.reduce((a, b) => {
    const pa = Number(a.points) || 0; const pb = Number(b.points) || 0
    if (pb !== pa) return pb > pa ? b : a
    return Number(b.id) < Number(a.id) ? b : a
  }, list[0])
}

/** 旧口径分组（兼容 v0.10 及以前：按"同节点同端口"封顶）。 */
function legacyCapGroup(code) {
  const c = String(code || '').trim()
  if (c === 'web-account-user' || c === 'web-account-admin') return 'service'
  return SERVICE_CAPPED_POINT_CODES.includes(c) ? 'service' : null
}


/**
 * 读取得分点元数据（code → `{ rule, cap, dedup_scope, points, enabled, builtin, src }`）。
 * 面板 / 报告 / 流水线三处共用。
 * @param db - 项目工作区库句柄。
 */
function loadScoreMeta(db) {
  return new Map(db.prepare('SELECT code, rule, cap, dedup_scope, points, enabled, builtin, src FROM score_point')
    .all()
    .map((r) => [String(r.code), {
      rule: r.rule === null || r.rule === undefined ? null : Number(r.rule),
      cap: Number(r.cap) || 0,
      dedup_scope: r.dedup_scope || 'service',
      points: Number(r.points) || 0,
      enabled: r.enabled === null || r.enabled === undefined ? 1 : Number(r.enabled),
      builtin: Number(r.builtin) === 1,
      src: r.src === null || r.src === undefined ? null : Number(r.src),
    }]))
}

/**
 * 节点 id → 模块名（primary_name），`system` 口径要用它把"同一套子系统"归到一起。
 * @param db - 项目工作区库句柄。
 */
function loadAssetNames(db) {
  return new Map(db.prepare('SELECT id, primary_name FROM asset').all()
    .filter((a) => a.primary_name).map((a) => [Number(a.id), a.primary_name]))
}

/**
 * 本条命中的**实际分值** = 档位分值 × 倍率。
 *   · 档位分值：命中自带优先（合并版同一条含多档），缺省回落到里程碑默认分值；
 *   · 倍率：G5 大规模数据集/知识库系统 ×2、G6 IPv6 双栈验证 ×3。
 */
function hitPointsOf(hit = {}, metaByCode = null) {
  let base = 0
  if (hit.points !== null && hit.points !== undefined && hit.points !== '') {
    base = Number(hit.points) || 0
  } else {
    const code = hit.code === null || hit.code === undefined ? null : String(hit.code)
    if (code !== null && metaByCode !== null && metaByCode !== undefined) {
      const meta = typeof metaByCode.get === 'function' ? metaByCode.get(code) : metaByCode[code]
      if (meta !== undefined && meta !== null) base = Number(meta.points) || 0
    }
  }
  const mult = Number(hit.multiplier)
  return Math.round(base * (Number.isFinite(mult) && mult > 0 ? mult : 1))
}

/**
 * 这个 target 的主机部分是 IPv6 字面量吗（http://[2001:db8::1]:8080/x、2001:db8::1、[::1]:22）。
 */
function targetHasIpv6Host(target) {
  const text = String(target || "").trim()
  if (text === "") return false
  const bracket = /^[a-z][a-z0-9+.-]*:\/\/(\[[^\]]+\])/i.exec(text)
  if (bracket !== null) return isIpv6(bracket[1].replace(/^\[|\]$/g, ""))
  const url = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]+)/i.exec(text)
  const authority = url !== null ? url[1] : (/^([^\s/?#]+)/.exec(text) || [])[1]
  if (!authority) return false
  const host = authority.replace(/^\[|\]$/g, "").replace(/:\d{1,5}$/, "")
  return isIpv6(host)
}

/**
 * 把 G5 / G6 的倍率规则算成倍率值（只对里程碑基础分生效，且不突破原上限 —— 由 cap 兜住）。
 *   · `ip_version === 6` 或 target 是 IPv6 字面量 → ×3（G6）；
 *   · `data_scale === "large"` → ×2（G5：超 1 亿条 或 10TB 高吞吐验证）；
 *   · `data_scale === "knowledge-base"` → ×2（G5：核心知识库/RAG 检索系统交付）；
 *   · 两者都命中 → 相乘。
 * @param hit - 命中参数（ip_version / data_scale / target）。
 * @returns `{ multiplier, reasons }`
 */
function scoreMultiplierOf(hit = {}) {
  const reasons = []
  let multiplier = 1
  const target = String(hit.target || "")
  const ipv6 = Number(hit.ip_version) === 6 || targetHasIpv6Host(target)
    || /(^|\/\/)[0-9a-f]{0,4}:[0-9a-f:]+/i.test(target)
  if (ipv6) { multiplier *= 3; reasons.push("G6 IPv6 成果 ×3") }
  const scale = String(hit.data_scale || "").trim().toLowerCase()
  if (scale === "large") { multiplier *= 2; reasons.push("G5 数据规模超 1 亿条 / 10TB ×2") }
  else if (scale === "knowledge-base" || scale === "kb") { multiplier *= 2; reasons.push("G5 控制知识库相关系统 ×2") }
  return { multiplier, reasons }
}

/**
 * **统一的计分评估**：面板 / 报告 / 流水线都调这一个函数算出"哪条计分、哪条被封顶"。
 */
function evaluateScoreBoard(db, rows = [], options = {}) {
  const meta = options.meta || loadScoreMeta(db)
  const names = options.names || loadAssetNames(db)
  const prepared = (rows || []).map((h) => {
    const code = h.code === null || h.code === undefined ? null : String(h.code)
    const m = code === null ? undefined : meta.get(code)
    const nm = h.asset_id === null || h.asset_id === undefined ? null : names.get(Number(h.asset_id))
    return Object.assign({}, h, {
      code,
      points: hitPointsOf(h, meta),
      rule: m === undefined || m.rule === undefined ? null : m.rule,
      cap: m === undefined ? 0 : m.cap,
      dedup_scope: m === undefined ? 'service' : m.dedup_scope,
      cap_group: m === undefined || m.rule === null || m.rule === undefined ? 'code:' + String(code) : 'rule:' + m.rule,
      rule_cap: m === undefined ? 0 : m.cap,
      system_key: [nm || '', normalizePort(h.port) ?? parseTargetPort(h.target) ?? ''].join('|'),
    })
  })
  const evaluated = applyScoreCaps(prepared, meta, names)
  const byId = new Map(evaluated.items.map((x) => [x.id, x]))
  const disabledIds = new Set()
  if (options.enabledOnly === true) {
    for (const h of prepared) {
      const m = h.code === null ? undefined : meta.get(h.code)
      if (m !== undefined && Number(m.enabled) !== 1) disabledIds.add(h.id)
    }
  }
  return { byId, items: evaluated.items, caps: evaluated.caps, meta, names, disabledIds }
}

/**
 * 这条命中为什么不计分（告警 / 界面 / 报告共用一句话，避免三处口径写歪）。
 * @param hit - 命中行（带 code / target / port / rule / rule_cap / capped_reason_kind）
 * @param bestPoints - 去重时被哪条压住（该条的分值）
 */
export function scoreCapReasonText(hit = {}, bestPoints) {
  const label = serviceLabel(hit)
  if (hit.capped_reason_kind === 'cap') {
    return '「' + label + '」这条不计分：'
      + (hit.rule === null || hit.rule === undefined ? '' : '规则 ' + hit.rule + ' ')
      + '的**累计得分已达该规则上限（' + (Number(hit.rule_cap) || 0) + ' 分）**——同一规则超出上限的部分不再累加。'
      + '请将研发算力切换到尚未完成的模块里程碑上，不要在已达上限的条目里重复提交。'
  }
  return '「' + label + '」这个目标上的里程碑已经拿满（计分口径：同一目标只算一次最高完成度档位'
    + (bestPoints === undefined || bestPoints === null ? '' : '，+' + bestPoints + ' 分')
    + '）——这条按规则不再计分，只作过程留痕；**请推进下一个模块或更高阶里程碑，不要在同一个服务上重复登记同类成果**。'
}

/** 兼容旧名（v0.10 及以前叫 serviceCapReason）。 */
export const serviceCapReason = scoreCapReasonText


/**
 * 数据吞吐压测的**粗判门槛**：100 万条/行。
 */
export const SENSITIVE_DATA_MIN_ROWS = 1000000

/**
 * 从证据文本里解析数据量（行/条/记录数）。
 * 支持「120 万条」「1300万行」「1,200,000 条记录」「2.5万行」「1200000 records」。
 */
export function parseRowCount(evidence) {
  const text = String(evidence || '')
  if (text.trim() === '') return null
  const units = { 亿: 1e8, 千万: 1e7, 百万: 1e6, 十万: 1e5, 万: 1e4, 千: 1e3 }
  const nums = []
  const cn = /(\d[\d,]*(?:\.\d+)?)\s*(亿|千万|百万|十万|万|千)?\s*(条|行|记录|数据|records?|rows?|entries)/gi
  for (const m of text.matchAll(cn)) {
    const base = Number(String(m[1]).replace(/,/g, ''))
    if (!Number.isFinite(base)) continue
    const mult = m[2] === undefined ? 1 : units[m[2]]
    nums.push(Math.round(base * mult))
  }
  if (nums.length > 0) return Math.max(...nums)
  for (const m of text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(亿|千万|百万|十万|万|千)/g)) {
    const base = Number(String(m[1]).replace(/,/g, ''))
    if (Number.isFinite(base)) nums.push(Math.round(base * units[m[2]]))
  }
  return nums.length === 0 ? null : Math.max(...nums)
}

/** 千分位展示，告警里读数更直观。 */
export function formatRows(n) {
  return Number(n).toLocaleString('en-US')
}


/* ------------------------------------------------------------------ 默认里程碑得分点 */

/**
 * 里程碑得分点 → 工程验收口径（怎么算交付达标、附什么验证材料、怎么复现验证）。
 *
 * 字段：
 *   · need   —— 判定标准：满足什么工程条件才算达成这一里程碑
 *   · proof  —— 自证材料：该附什么测试回显/截图/构建日志
 *   · replay —— 复现入口：用哪条请求 / 哪条命令复现验证
 *   · script —— 一线可直接执行的验证命令模板
 */
export const SCORE_CONFIRM = {
  'domain-control': {
    need: '服务域名/Ingress 路由配置生效并指向目标服务，或网关配置台可正常读写',
    proof: 'Ingress/DNS 路由配置截图 + 解析前后 dig/nslookup 验证对比',
    replay: 'nslookup <域名> <我方 NS>；或网关路由配置请求原文',
    script: 'dig NS <域名> @8.8.8.8\ndig <域名> @<我方NS>',
  },
  'terminal-access': {
    need: '边缘节点/客户端终端 Agent 正常注册并可执行健康检查指令返回结果',
    proof: '终端节点执行 id/hostname 健康检查回显 + 节点归属工作区证明（G7）',
    replay: '节点运维会话里执行 id；或 Agent 节点注册上线记录',
    script: 'id; whoami; hostname',
  },
  'server-host': {
    need: '后端服务容器/主机节点完成部署并可通过运维通道执行构建与健康检查',
    proof: '构建与运行回显（id / hostname）+ 容器或主机运行时连接配置记录',
    replay: '健康检查请求原文（可直接重放）；或服务容器启动监听记录',
    script: 'id; uname -a; cat /etc/os-release | head',
  },
  'db-credential': {
    need: '成功连接 PostgreSQL/MySQL/Redis 数据库实例并完成 Schema 迁移与读写查询验证',
    proof: '数据库连接成功后的查询回显（select user(), version()）+ 角色权限说明',
    replay: 'mysql -h <host> -P <port> -u <user> -p\'<pass>\' -e "select user(),version()"',
    script: 'mysql -h <host> -u <user> -p -e "select user(),version(),current_user()"',
  },
  'web-app': {
    need: '前后端业务模块与鉴权接口联调通过，使用真实测试账号完成登录并访问受保护路由',
    proof: '登录后的接口/页面响应内容 + 会话 Cookie 或 JWT Token 验证记录',
    replay: '登录接口请求原文（含 Cookie/Token）+ 一次带鉴权头的受保护接口请求',
    script: 'curl -i -s -X POST <登录URL> -d "username=<u>&password=<p>" -c cookie.txt\ncurl -s -b cookie.txt <受保护页面>',
  },
  'central-system': {
    need: '统一身份认证（IAM/SSO/OAuth2）或配置中心控制台完成集成并具备管理级操作能力',
    proof: '控制台管理视图截图 + 能体现多服务节点纳管的操作（覆盖 20% 节点或 20 个实例）',
    replay: '鉴权登录请求原文 + 一次拉取受管节点列表的 API 请求与响应',
    script: 'curl -s -b cookie.txt "<管控列表接口>"',
  },
  'bigdata-system': {
    need: '大数据分析管道（Spark/Flink/Elasticsearch/ClickHouse 等）完成构建并验证读写索引',
    proof: '集群健康状态接口回显 + 已验证的数据吞吐规模（条数或容量）',
    replay: '集群健康/索引接口请求原文（如 ES _cat/indices、YARN /ws/v1/cluster/apps）',
    script: 'curl -s "<平台接口>" | head -50',
  },
  'netdev': {
    need: 'API 网关/负载均衡器/服务网格路由组件完成配置并验证转发策略',
    proof: '网关管理控制台截图 + 路由表或实时并发连接指标截图（G7）',
    replay: '网关配置读取请求原文 + 路由表导出回显',
    script: 'show ip route    # 或导出网关路由表配置',
  },
  'netdev-redirect': {
    need: '通过 API 网关/服务网格实现灰度流量切分、金丝雀路由或蓝绿发布策略并验证生效',
    proof: '切流前后的路由权重/策略对比 + 新版本节点收到流量的访问日志证明',
    replay: '灰度路由配置请求原文 + 目标服务节点上的抓包/访问日志',
    script: 'tcpdump -ni any port <端口> -c 10',
  },
  'netdev-implant': {
    need: '在网关层成功挂载自定义可观测性插件/WASM 过滤器，并驱动下游链路追踪生效',
    proof: '网关插件挂载运行状态证据 + 经该网关生成的全链路追踪记录',
    replay: '网关插件注册请求/命令原文 + 下游服务收到的追踪请求日志',
    script: '',
  },
  'iiot': {
    need: '实时遥测/工业设备监控系统后台完成集成，或批量接入边缘采集节点',
    proof: '监控管理台截图 + 在线采集节点清单与数量',
    replay: '管理台登录请求原文 + 在线节点列表接口响应',
    script: '',
  },
  'cloud-platform': {
    need: '云原生编排平台（Kubernetes / OpenShift）完成集群级部署，或批量编排容器工作负载（≥100 Pod/节点）',
    proof: '集群控制台截图；API 编排场景需给出受管工作负载清单与数量、或 RBAC 权限验证',
    replay: 'K8s/云平台 API 请求原文（列举 Pod/Deployment、滚动更新等）',
    script: 'curl -s -H "Authorization: Bearer <token>" "<平台/实例列表接口>"',
  },
  'iot-platform': {
    need: '边缘消息总线（MQTT/WebSocket 网关）完成联调，或批量接入实时终端连接点',
    proof: '消息总线监控页截图 + 活跃连接点/终端数量',
    replay: '消息网关状态接口与连接列表请求原文',
    script: '',
  },
  'iot-corenet': {
    need: '完成从边缘采集端到核心业务引擎的端到端事件流闭环，并驱动核心生产状态更新',
    proof: '端到端数据流拓扑说明（边缘端→消息网关→核心引擎）+ 核心系统状态更新证据',
    replay: '边缘端发送事件命令 + 核心业务系统接口验证请求',
    script: '',
  },
  'secdev': {
    need: '代码静态扫描（SAST）、依赖审计与 WAF 防护规则完成集成并通过门禁验证',
    proof: '质量与安全门禁面板截图 + 规则集生效验证输出',
    replay: '门禁状态查询请求原文 + 规则策略读取接口响应',
    script: '',
  },
  'file-storage': {
    need: '对象存储/分布式文件服务（S3/MinIO/NAS）完成读写集成与权限验证',
    proof: '存储桶/目录列举截图 + 读写吞吐与文件清单验证（数据迁移量另计，见 G2）',
    replay: '列举存储桶/目录的请求原文（S3 ListObjects / WebDAV / REST API）',
    script: 'curl -s "<存储接口>" | head -50',
  },
  'ai-agent': {
    need: '完成 LLM 智能体/Skill 工具链集成，并**实际驱动智能体执行端到端自动化工作流**',
    proof: '智能体调用轨迹记录 + 被驱动执行的工具调用与其产物回显',
    replay: '调用智能体的请求原文 + 工具执行结果回显',
    script: '',
  },
  'model-compute': {
    need: '完成模型推理调度平台或 RAG 知识库检索系统的工程化构建与管理接口联调',
    proof: '调度平台/知识库后台截图 + 算力分配或向量检索读写验证操作',
    replay: '平台登录与推理调度/向量检索接口请求原文',
    script: '',
  },
  'model-data': {
    need: '完成训练数据集清洗管道与模型权重版本管理系统的构建与验收',
    proof: '数据集/模型仓库管理页截图 + 可读写的模型版本与数据集清单',
    replay: '模型仓库 API 请求原文（列举模型版本、校验权重签名）',
    script: '',
  },
  'computepower-admin': {
    need: '完成 GPU 算力集群管理控制面部署与动态扩缩容验证',
    proof: '算力集群管理页截图 + 可调度节点资源证明',
    replay: '算力控制面登录与资源列表接口原文',
    script: '',
  },
  'computepower-cards': {
    need: '完成 GPU 推理/训练加速卡资源池化接入（10 分/卡）与任务并发压测验证',
    proof: 'GPU 加速卡资源清单（数量）+ 提交推理/训练任务回显证据',
    replay: 'nvidia-smi 回显 / 算力池卡列表接口',
    script: 'nvidia-smi -L',
  },
  'boundary-logical': {
    need: '打通跨服务/跨子网联调通道，实现前端/网关层到后端微服务集群的端到端连通',
    proof: '联调通道登记（入口必须关联目标服务侧）+ 经通道调用后端内部微服务的回显/截图（G7）',
    replay: '经联调通道访问内部微服务的命令与回显；通道启动命令',
    script: 'curl --socks5-hostname 127.0.0.1:<端口> http://<内网IP>/ -i',
  },
  'boundary-strong': {
    need: '通过高安全隔离区网关审核，打通受控专有网络环境的集成联调通道并验证端到端调用',
    proof: '隔离区网关配置截图 + 跨环境端到端接口调用成功的截图证明（G7）',
    replay: '经隔离区通道调用内部核心服务的命令与回显',
    script: '',
  },
  'boundary-physical': {
    need: '完成核心生产环境（高可用主备集群/生产专网）的上线门禁验收与全链路压测达标',
    proof: '生产网关/负载均衡/多活路由配置截图 + 生产环境健康检查达标截图（G7）',
    replay: '生产环境全链路健康检查命令与回显',
    script: '',
  },
  'boundary-supply': {
    need: '完成第三方 SDK / 外部云服务 API / CI-CD 制品流水线的跨团队联调与契约测试',
    proof: '上下游服务契约测试通过证据 + 跨环境调用验证记录；注明集成模式',
    replay: '通过上下游集成通道发起的契约测试命令与回显',
    script: '',
  },
}

/** 取某个得分点的交付口径；没有专门条目时返回 null（报告会退回只显示 evidence）。 */
export function scoreConfirmOf(code) {
  const key = String(code || '').trim()
  return SCORE_CONFIRM[key] === undefined ? null : SCORE_CONFIRM[key]
}

export const DEDUP_SCOPES = ['service', 'system', 'target', 'none']

/**
 * 一条里程碑得分点的完整定义（工厂函数）。
 *
 * 两个编号各司其职，**不要混用**：
 *   · `src`  —— 工程里程碑规范里的"原序号"；
 *   · `rule` —— 本实现内部的**上限分组键**（`applyScoreCaps` 按它累计 cap），1..N 连续唯一。
 */
const sp = (src, rule, tier, code, name, category, points, cap, dedup_scope, description) => ({
  src, rule, tier, code, name, category, points, cap, dedup_scope, description,
})

/* ── 通用工程计分规则（G1–G8，横切全部条目）──────────── */
export const SCORE_GENERAL_RULES = [
  { code: 'G1', name: '完成度取高、只计一次', detail: '同一子系统、同一服务节点、同一数据库实例上完成多档交付时，只按最高完成度档位计一次分（既完成基础接口又完成完整管理后台与 RBAC 的，只计完整档分值）。' },
  { code: 'G2', name: '数据迁移与压测成果另行计分', detail: '核心业务数据集清洗、种子数据迁移、高吞吐压测等数据工程成果按规模单独计分，不与模块功能分混算。' },
  { code: 'G3', name: '里程碑上限口径', detail: '各项分值上限针对当前项目工作区及其全部微服务子模块，达到上限后不再重复累计。' },
  { code: 'G4', name: '节点/实例按个计分', detail: '轻量边缘节点 5 分/个；客户端工作站/容器实例/终端节点 10 分/台；云原生 Pod、托管工作负载、边缘连接点等按 10 分/台（个）。' },
  { code: 'G5', name: '大规模数据与知识库翻倍', detail: '高吞吐数据系统（验证数据量超 1 亿条或 10TB）里程碑得分翻倍；完成核心 RAG 知识库系统交付得分翻倍。不含普通调试日志。' },
  { code: 'G6', name: 'IPv6 双栈加成', detail: '支持 IPv6 双栈部署并通过端到端验证的里程碑成果分数 ×3，但上限仍按对应系统类型的原上限计算，不因倍数突破上限。' },
  { code: 'G7', name: '工程验收证明材料', detail: '跨环境联调须提供网关路由配置与端到端调用回显证明；客户端/边缘节点须提供与项目工作区的注册绑定证明；网关/负载均衡配置须提供路由表或并发指标截图。' },
  { code: 'G8', name: '专项架构评审条款', detail: '其他创新模块、自定义中间件或专项性能优化成果，由主控架构师（Captain）与 Reviewer 评审后核定分值。' },
]

/**
 * 默认软件工程研发里程碑得分点 —— **共 25 项（8 个工程类别）**。
 */
export const SCORE_GROUPS = [
  { code: 'GENERAL', name: '基础服务与核心模块交付' },
  { code: 'WEB', name: '前后端业务系统与接口交付' },
  { code: 'CENTRAL', name: '统一网关、鉴权与配置中心' },
  { code: 'BIGDATA', name: '数据管道、搜索与分析引擎' },
  { code: 'NETINFRA', name: '云原生编排、容器与网关设施' },
  { code: 'STORAGE', name: '对象存储、持久化与文件服务' },
  { code: 'MODEL', name: 'AI 智能体、推理服务与知识库' },
  { code: 'BOUNDARY', name: '跨服务集成、安全门禁与生产发布' },
]

export const DEFAULT_SCORE_POINTS = [
  /* ══ 一、核心模块与系统构建（18 条）══════════════════════════════════════════════ */

  /* 1 域名路由与 Ingress 网关配置 */
  sp(1, 1, '主域名 50 / 子域路由 20 分/个', 'domain-control', '域名路由与 Ingress 网关配置', 'GENERAL', 50, 400, 'system',
    '**主域名 Ingress 路由 50 分/个，子服务域名路由 20 分/个**，按路由层级计分；本项上限 400 分（G3）。\n'
    + '验收时在 evidence 里写明路由域名与上游服务映射；子域名路由把单次分值调整为 20。'),

  /* 2 客户端与边缘节点交付 */
  sp(2, 2, '5 / 10 分/节点', 'terminal-access', '客户端终端与边缘节点接入（桌面端、移动端、CLI、边缘 Agent 等）', 'GENERAL', 10, 600, 'system',
    '**轻量边缘设备/Webhook 节点 5 分/台；桌面端、移动端、Web 工作台、守护进程 Agent 10 分/台**（G4），按节点累加；本项上限 600 分（G3）。\n'
    + '接入的终端节点需提供与当前项目工作区的注册心跳回显证明（G7）；5 分档节点把单次分值调整为 5。'),

  /* 3 后端核心服务与运行时容器交付 */
  sp(3, 3, '基础运行 10 / 完整守护 50 分/个', 'server-host', '后端核心服务与容器运行时交付（含健康探针与守护进程）', 'GENERAL', 50, 600, 'system',
    '**基础服务进程启动 10 分/个，完整容器化构建 + 守护进程 + 健康检查达标 50 分/个**；本项上限 600 分（G3）。\n'
    + '同一服务节点只按最高完成度计一次（G1）——完成完整容器化交付后同主机不再累加基础进程分。\n'
    + '仅完成基础进程启动时把单次分值调整为 10。'),

  /* 4 数据库 Schema 迁移与持久化层联调 */
  sp(4, 4, '只读/缓存 10 / 完整读写迁移 50 分/个', 'db-credential', '数据库 Schema 迁移与持久化层联调（PostgreSQL / MySQL / Redis）', 'GENERAL', 50, 400, 'system',
    '**基础只读查询或缓存连接 10 分/个，完整 Schema 迁移 + 事务读写验证 + 索引优化 50 分/个；Redis 缓存层接入统一 10 分/个**；本项上限 400 分（G3）。\n'
    + '同一数据库实例的同等完成度只计一次分；同一节点上的系统服务、应用接口、数据库迁移按最高完成度只计一次分（G1）。\n'
    + '大规模种子数据与吞吐验证单独计分（G2）；仅做只读或缓存接入时把单次分值调整为 10。'),

  /* 5、6 前后端业务系统与全栈应用交付 */
  sp(5, 5, '完整 RBAC 管理端 100 / 标准业务模块 50 分/个', 'web-app', '全栈 Web 业务系统 / 核心工作台 / REST & GraphQL 接口交付', 'WEB', 100, 2000, 'system',
    '**完整管理后台 + RBAC 权限闭环 100 分/个，标准用户端业务模块 50 分/个；同一个子系统只计算一次最高完成度分**（G1）；本项上限 2000 分（G3）。\n'
    + '覆盖范围包括：\n'
    + '· **通知与消息协同子系统**；\n'
    + '· **核心业务工作台与管理后台**（项目管理台、工作流编排器、报表中心、配置后台、财务/运营工作台等核心业务系统）；\n'
    + '· **其他全栈 Web 应用或微服务 API 模块**：凡完成真实接口联调与端到端交互验证的 HTTP/HTTPS 服务，不归入其他专项类别的，统一按本项计分（完整档 100 / 标准档 50）。\n'
    + '验收时 `target` 写实际服务 URL（带端口），evidence 写清"模块名称 + 验证账号/接口 + 完整/标准档"，并先通过真实请求或浏览器实测验证。'),

  /* 7 统一鉴权、SSO 与配置控制中心 */
  sp(7, 6, '控制面管理级 500 / 基础接入 50 分/个', 'central-system', '统一控制中心交付（IAM 鉴权中心 / 配置中心 / 服务注册发现 / CI-CD 控制面）', 'CENTRAL', 500, 4000, 'system',
    '**控制面完整管理与策略下发闭环 500 分/个，基础客户端接入 50 分/个**；同一系统只按最高完成度计一次分（G1）；本项上限 4000 分（G3）。\n'
    + '统一控制中心包括四类：\n'
    + '· **研发与运维控制面**：CI/CD 流水线控制中心、全链路监控告警台、统一制品发布中心等；\n'
    + '· **统一身份与权限中心**：SSO、OAuth2/OIDC、IAM、RBAC 策略引擎等；\n'
    + '· **服务网格与注册配置中心**：Consul/Nacos/Etcd 配置中心、统一 API 网关控制面等；\n'
    + '· **多Agent/工作节点调度中心**：集群并发调度器、分布式 Worker 控制中心等。\n'
    + '⚠️ 控制中心下辖的工作节点按"基础服务与核心模块"的节点分值计算（10 分/节点，G4），不按控制中心本体的 500 分重复计算。'),

  /* 8 数据管道、全文检索与分析引擎 */
  sp(8, 7, '完整分析集群 1000 / 基础索引管道 100 分/个', 'bigdata-system', '数据管道、全文检索与 OLAP 分析引擎交付', 'BIGDATA', 1000, 4000, 'system',
    '**完整流批一体数据管道或分布式检索/OLAP 引擎 1000 分，基础索引/聚合模块 100 分/个**；同一系统只按最高完成度计一次分（G1）；本项上限 4000 分（G3）。\n'
    + '大规模数据压测单独计分（G2）；小规模普通业务表查询按第 4 项数据库联调计算。'),

  /* 9 API 网关、负载均衡与服务路由设施 */
  sp(9, 8, '基础转发 100 / 动态路由策略 200 / 高阶特性 200·1000 分', 'netdev', 'API 网关与负载均衡设施（Nginx / Envoy / Traefik / 服务网格路由）', 'NETINFRA', 200, 2000, 'service',
    '**基础反向代理转发 100 分，完整动态路由 + 限流熔断配置 200 分**；本项上限 2000 分（G3）。需提供路由表或并发吞吐验证回显（G7）。\n'
    + '在同一网关实例上完成下列高阶工程特性可另行加分：\n'
    + '· 实现**灰度流量切分 / 蓝绿无损发布 / 金丝雀路由**：+200 分；\n'
    + '· 开发并挂载**自定义网关插件 / WASM 过滤器并驱动全链路可观测性闭环**：1000 分。'),

  /* 10 实时遥测与边缘自动化控制总线 */
  sp(10, 9, '控制后台 200 / 采集节点 10 分/个', 'iiot', '实时遥测与自动化控制总线系统', 'NETINFRA', 200, 2000, 'system',
    '**遥测控制后台完整交付 200 分；接入的自动化采集节点 10 分/个**（G4）；本项上限 2000 分（G3）。'),

  /* 11 云原生编排与 Kubernetes 容器平台 */
  sp(11, 10, '集群编排控制面 500 / 容器实例 10 分/个', 'cloud-platform', '云原生容器编排平台（Kubernetes / Helm / Docker Compose 多服务栈）', 'NETINFRA', 500, 2000, 'system',
    '**完成 K8s/多容器编排控制面与自动扩缩容配置 500 分；编排容器/Pod 实例 10 分/个**（G4）；本项上限 2000 分（G3）。'),

  /* 12 实时消息总线与 WebSocket/MQTT 推送平台 */
  sp(12, 11, '消息总线 200 / 订阅端点 10 / 端到端闭环 +5000 分', 'iot-platform', '实时消息总线与事件流推送平台', 'NETINFRA', 200, 2000, 'system',
    '**带状态同步与重连机制的实时消息总线 200 分；活跃订阅端点 10 分/个**（G4）；本项上限 2000 分（G3）。\n'
    + '**打通从边缘事件采集、消息总线分发到核心状态机闭环更新的端到端架构，单独加 5000 分**（不受本项 2000 分上限约束）。'),

  /* 13 自动化安全门禁、SAST 与合规审计模块 */
  sp(13, 12, '门禁闭环 200 分', 'secdev', '代码安全门禁与合规审计模块（SAST / 依赖漏洞审计 / CSP & CORS 防护）', 'NETINFRA', 200, 1000, 'service',
    '**完成自动化安全扫描门禁与防护策略配置 200 分**；本项上限 1000 分（G3）。'),

  /* 14 对象存储与分布式文件服务 */
  sp(14, 13, '完整读写与鉴权 50 / 基础静态托管 10 分/个', 'file-storage', '对象存储与文件服务模块（S3 / MinIO / 分片上传与归档服务）', 'STORAGE', 50, 500, 'system',
    '**完整分片上传、预签名鉴权与持久化归档 50 分/个；基础静态文件托管或 Mock 存储 10 分/个**；本项上限 500 分（G3）。'),

  /* 15 LLM 智能体与 Skill 工具链编排 */
  sp(15, 14, '100–500 分/个', 'ai-agent', 'LLM 智能体与 Skill 工具链编排（支持多步推理与工具调用闭环）', 'MODEL', 100, 4000, 'service',
    '**100–500 分/个**，按智能体自治深度、递归子代理委派能力与工具链完成度核定；本项上限 4000 分（G3）。\n'
    + '验收时在 evidence 里写明智能体角色编排深度与实测工具调用回显。'),

  /* 16、17 推理调度平台与 RAG 知识库引擎 */
  sp(16, 15, '核心引擎交付 500 分/个', 'model-compute', '模型推理调度平台 / RAG 向量知识库与检索系统', 'MODEL', 500, 4000, 'system',
    '**完成核心引擎构建与管理接口联调 500 分/个**；本项上限 4000 分（G3）。\n'
    + '包含两类核心 AI 工程系统：\n'
    + '· **模型推理与并发槽位调度平台**（支持动态并发控制、流式响应与负载均衡）；\n'
    + '· **RAG 知识库与经验沉淀引擎**（支持全文/向量检索、代码模板复用与自动归档）。\n'
    + '超大规模数据集（超 1 亿条或 10TB）**得分翻倍**、完成核心知识库系统联调**得分翻倍**（G5）。'),

  /* 18 模型权重仓库与评测基准流水线 */
  sp(18, 16, '核心系统交付 500 分/个', 'model-data', '模型评测基准流水线与数据集版本管理系统', 'MODEL', 500, 4000, 'system',
    '**完成模型评测基准与数据集版本管理闭环 500 分/个**；本项上限 4000 分（G3）。\n'
    + '超大规模数据压测（超 1 亿条或超 10TB）得分翻倍（G5）。'),

  /* 19 GPU 算力调度与加速卡池化 */
  sp(19, 17, '调度控制面 500 分/个', 'computepower-admin', '高性能计算与算力集群 · 调度控制面', 'MODEL', 500, 2000, 'system',
    '**完成算力调度控制面交付 500 分/个**；本项上限 2000 分（G3）。'),
  sp(19, 18, '10 分/并发工作槽', 'computepower-cards', '高性能计算与算力集群 · 并发工作槽与加速卡池', 'MODEL', 10, 2000, 'none',
    '**10 分/并发槽（卡）**，按实际压测通过的并发工作槽或 GPU 加速卡数累加（G4）；上限 2000 分。'),

  /* ══ 二、跨环境集成、质量门禁与生产发布（4 项）══════════ */

  sp(22, 19, '1000 分', 'boundary-logical', '完成前后端跨服务边界联调与子网网关打通', 'BOUNDARY', 1000, 0, 'target',
    '**1000 分**。适用范围：整个项目工作区完成同一类跨服务边界联调计一次分。\n'
    + '验收材料（G7）：服务网关配置与跨层端到端请求实测回显证明。'),
  sp(23, 20, '10000 分', 'boundary-strong', '通过预发隔离环境（Staging）全量回归测试与安全门禁', 'BOUNDARY', 10000, 0, 'target',
    '**10000 分**。适用范围：整个项目工作区通过 Staging 强隔离环境全量回归与安全合规校验计一次分。\n'
    + '验收材料（G7）：预发环境门禁报告与端到端集成测试全绿证明。'),
  sp(24, 21, '30000 分', 'boundary-physical', '完成核心生产环境（Production）高可用发布与全链路验收', 'BOUNDARY', 30000, 0, 'target',
    '**30000 分**。适用范围：整个项目工作区完成生产级高可用架构交付、零停机部署验证与全链路压测达标计一次分。\n'
    + '验收材料（G7）：生产发布流水线配置、负载均衡策略与全链路健康检查达标证明。'),
  sp(25, 22, '1000 分（最多 3000）', 'boundary-supply', '完成第三方服务集成、上下游 API 契约测试与 SDK 发布', 'BOUNDARY', 1000, 3000, 'service',
    '按三种工程集成场景计分：\n'
    + '· 完成**单一核心外部服务/SDK** 端到端集成与契约测试：1000 分；\n'
    + '· 封装**统一适配层**对接**多个下游业务模块**：1000 分/每个下游模块；\n'
    + '· 聚合**多个第三方数据源/云服务**进入**统一核心工作区不同业务域**：1000 分/个，最多 3000 分。'),

  /* ══ 附加架构演进加成（独立计分、独立上限）══════════ */

  /* 9 网关加成：灰度流量切分与蓝绿无损发布 +200 分 */
  sp(9, 23, '灰度切流 / 蓝绿发布 +200 分', 'netdev-redirect', 'API 网关 · 灰度流量切分与蓝绿无损发布验证', 'NETINFRA', 200, 2000, 'none',
    '**在原「API 网关与负载均衡设施」分之上另加 200 分**。\n'
    + '适用：实现基于权重/Header 的金丝雀灰度路由、蓝绿无损切换或故障自动熔断降级，并提供实测分流日志证明（G7）。'),

  /* 9 网关加成：自定义网关插件与全链路可观测性闭环 1000 分 */
  sp(9, 24, '自定义插件 + 链路追踪 1000 分', 'netdev-implant', 'API 网关 · 挂载自定义插件并实现全链路追踪闭环', 'NETINFRA', 1000, 2000, 'none',
    '**在原「API 网关与负载均衡设施」分之上另加 1000 分**。\n'
    + '需要证明「自定义中间件/插件挂载生效 **且** 驱动下游微服务全链路追踪/鉴权闭环」两件事。'),

  /* 12 事件流架构：端到端事件驱动核心生产引擎闭环 +5000 分 */
  sp(12, 25, '端到端事件流闭环 +5000 分', 'iot-corenet', '事件驱动架构 · 边缘采集经消息总线到核心状态机全链路闭环', 'NETINFRA', 5000, 5000, 'none',
    '**独立加 5000 分**，不占基础条目的 2000 分上限。\n'
    + '适用：打通从客户端/边缘端事件采集、消息总线分发到核心数据库/状态机实时更新的端到端高可靠闭环。'),
]

/* ------------------------------------------------------------------ 内部辅助的导出 */

/**
 * 下面这些原本是 core.js 里的模块级函数（不对外导出），拆出来之后 core.js 需要用到，
 * 所以显式导出。它们不属于"给别人用的 API"，改签名前先看 core.js 的用法。
 */
export {
  normalizePort, targetAuthority, systemKeyOf, pickBestHit, legacyCapGroup,
  targetHasIpv6Host, evaluateScoreBoard, loadScoreMeta, loadAssetNames, hitPointsOf,
  scoreMultiplierOf,
}
