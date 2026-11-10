/**
 * 工程交付报告验证与命令复现工具（纯函数，零依赖）。
 *
 * 目标：让软件工程交付报告里**每一条研发里程碑与质量门禁记录**都具备可直接执行的验证入口
 * （终端验证命令、接口调试请求报文或标准化测试命令模板）。
 *
 * 两条基本原则：
 *   · **合成的报文或命令必须明确标注来源**（`synthesized: true`）—— 根据 URL/参数合成的等效请求
 *     与实测录制的原始报文在证明等级上严格区分，方便审查与 QA 人员核验。
 *   · 仅在上下文信息充足（存在明确 URL 或 curl/httpie 命令）时合成，信息不足时保持为空并给出补充指引。
 */

/**
 * 从 target 里解析出 scheme / host / port / path，用于生成标准验证请求。
 * 显式处理 IPv6 方括号语法（如 `http://[2001:db8::1]:8080/api`）。
 *
 * @param target - 形如 `http://h:8080/p` / `10.0.0.5:5432` / `[::1]:3000` 的目标地址或模块标识。
 * @returns `{ scheme, host, port, path, authority }`；无法解析时返回 null。
 */
function parseTarget(target) {
  const t = String(target || '').trim()
  if (t === '') return null
  const url = /^([a-z][a-z0-9+.-]*):\/\/([^/?#\s]+)([^?#\s]*)?/i.exec(t)
  if (url !== null) {
    const scheme = url[1].toLowerCase()
    const authority = url[2]
    const path = url[3] && url[3] !== '' ? url[3] : '/'
    const bracket = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(authority)
    if (bracket !== null) {
      return {
        scheme, host: bracket[1], port: bracket[2] === undefined ? (scheme === 'https' ? 443 : 80) : Number(bracket[2]),
        path, authority, ipv6: true,
      }
    }
    const portMatch = /:(\d{1,5})$/.exec(authority)
    const host = portMatch === null ? authority : authority.slice(0, -portMatch[0].length)
    return {
      scheme, host,
      port: portMatch === null ? (scheme === 'https' ? 443 : 80) : Number(portMatch[1]),
      path, authority, ipv6: false,
    }
  }
  const bracket = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(t)
  if (bracket !== null) {
    return { scheme: null, host: bracket[1], port: bracket[2] === undefined ? null : Number(bracket[2]), path: null, authority: t, ipv6: true }
  }
  const bare = /^([^\s/?#:]+)(?::(\d{1,5}))?$/.exec(t)
  if (bare !== null) {
    return { scheme: null, host: bare[1], port: bare[2] === undefined ? null : Number(bare[2]), path: null, authority: t, ipv6: false }
  }
  const head = /^([^\s/?#]+)/.exec(t)
  if (head === null) return null
  return { scheme: null, host: head[1], port: null, path: null, authority: t, ipv6: false }
}

/** 识别命令所属工具类别（用于判断能否直接作为复现命令展示）。 */
function commandKind(tool) {
  const t = String(tool || '').trim()
  if (t === '') return null
  if (/^curl\b/i.test(t)) return 'curl'
  if (/^http(ie| x)?\b/i.test(t) || /^http\s/i.test(t)) return 'httpie'
  if (/^(eslint|tsc|vitest|jest|playwright|pytest)\b/i.test(t)) return 'scanner'
  if (/^(npm|pnpm|yarn)\s+(run|test|build)\b/i.test(t)) return 'script'
  if (/^(python|python3|java|go run|node)\b/i.test(t)) return 'script'
  return 'other'
}

/**
 * 从一条 curl 命令中提取 URL、方法、请求头与请求体（用于生成可重放的 HTTP 调试报文）。
 */
function parseCurl(tool) {
  const t = String(tool || '').trim()
  if (!/^curl\b/i.test(t)) return null
  const urlMatch = /(https?:\/\/[^\s'"]+)/i.exec(t)
  if (urlMatch === null) return null
  const methodMatch = /(?:-X|--request)\s+([A-Z]+)/i.exec(t)
  const dataMatch = /(?:-d|--data(?:-raw|-binary|-urlencode)?)\s+(?:'([^']*)'|"([^"]*)"|(\S+))/i.exec(t)
  const headerMatches = Array.from(t.matchAll(/(?:-H|--header)\s+(?:'([^']*)'|"([^"]*)")/gi))
    .map((m) => m[1] !== undefined ? m[1] : m[2])
    .filter((x) => typeof x === 'string' && x.includes(':'))
  const cookieMatch = /(?:-b|--cookie)\s+(?:'([^']*)'|"([^"]*)"|(\S+))/i.exec(t)
  const data = dataMatch === null ? null : (dataMatch[1] ?? dataMatch[2] ?? dataMatch[3] ?? null)
  const method = methodMatch !== null ? methodMatch[1].toUpperCase() : (data === null ? 'GET' : 'POST')
  return {
    url: urlMatch[1], method, data,
    headers: headerMatches,
    cookie: cookieMatch === null ? null : (cookieMatch[1] ?? cookieMatch[2] ?? cookieMatch[3] ?? null),
    insecure: /(^|\s)-k(\s|$)|--insecure/.test(t),
    followRedirect: /(^|\s)-L(\s|$)|--location/.test(t),
  }
}

/**
 * 合成一条标准 HTTP/1.1 调试请求报文。
 * @param options - `{ url, method, data, headers, cookie, insecure, followRedirect }`
 * @returns 报文文本，信息不足时返回 null。
 */
function buildHttpRequest(options = {}) {
  const target = parseTarget(options.url)
  if (target === null) return null
  const scheme = target.scheme || 'http'
  const hostText = target.ipv6 ? '[' + target.host + ']' : target.host
  const defaultPort = scheme === 'https' ? 443 : 80
  const hostHeader = (target.port !== null && target.port !== defaultPort)
    ? hostText + ':' + target.port
    : hostText
  const path = options.path !== undefined && options.path !== null && options.path !== ''
    ? options.path
    : (target.path || '/')
  const method = String(options.method || (options.data === undefined || options.data === null ? 'GET' : 'POST')).toUpperCase()
  const lines = [method + ' ' + path + ' HTTP/1.1', 'Host: ' + hostHeader]
  const headers = Array.isArray(options.headers) ? options.headers.slice() : []
  const hasHeader = (name) => headers.some((h) => String(h).toLowerCase().startsWith(name.toLowerCase() + ':'))
  if (!hasHeader('User-Agent')) headers.push('User-Agent: Mozilla/5.0')
  if (!hasHeader('Accept')) headers.push('Accept: */*')
  if (options.cookie && !hasHeader('Cookie')) headers.push('Cookie: ' + options.cookie)
  const body = options.data === undefined || options.data === null ? '' : String(options.data)
  if (body !== '' && !hasHeader('Content-Type')) {
    headers.push(/^\{.*\}$/.test(body.trim()) ? 'Content-Type: application/json' : 'Content-Type: application/x-www-form-urlencoded')
  }
  if (body !== '' && !hasHeader('Content-Length')) headers.push('Content-Length: ' + Buffer.byteLength(body, 'utf8'))
  if (!hasHeader('Connection')) headers.push('Connection: close')
  return [lines[0], ...headers, '', body].join('\r\n')
}

/**
 * 合成一条可直接在终端运行的 curl 验证命令。
 */
function buildCurlCommand(options = {}) {
  const raw = String(options.tool || '').trim()
  if (commandKind(raw) === 'curl') return raw
  const target = parseTarget(options.url)
  if (target === null) return null
  const scheme = target.scheme || 'http'
  const hostText = target.ipv6 ? '[' + target.host + ']' : target.host
  const defaultPort = scheme === 'https' ? 443 : 80
  const hostPart = target.port !== null && target.port !== defaultPort
    ? hostText + ':' + target.port
    : hostText
  const url = scheme + '://' + hostPart + (options.path || target.path || '/')
  const parts = ['curl -i -s' + (options.insecure ? ' -k' : '') + (options.followRedirect ? ' -L' : '')]
  if (options.method && String(options.method).toUpperCase() !== 'GET') parts.push('-X ' + String(options.method).toUpperCase())
  if (options.cookie) parts.push("-b '" + options.cookie + "'")
  for (const h of (options.headers || [])) {
    const line = String(h || '').trim()
    if (line === '' || /^host:/i.test(line) || /^content-length:/i.test(line)) continue
    parts.push("-H '" + line.replace(/'/g, "'\\''") + "'")
  }
  if (options.data !== undefined && options.data !== null && options.data !== '') parts.push("-d '" + String(options.data).replace(/'/g, "'\\''") + "'")
  parts.push("'" + url + "'")
  return parts.join(' ')
}

/**
 * 用当前里程碑记录中已知的上下文参数填充验证命令模板中的占位符。
 *
 * @param template - 含 `<占位符>` 的命令模板。
 * @param values - `{ host, port, user, pass, url, listen }` 等已知上下文值。
 * @returns `{ cmd, filled, remaining }`：填充后的命令 + 已替换项 + 剩余未替换占位符。
 */
function fillTemplate(template, values = {}) {
  let cmd = String(template || '')
  const filled = []
  const table = [
    [/<host>/gi, values.host],
    [/<ip>/gi, values.host],
    [/<port>/gi, values.port],
    [/<user(name)?>/gi, values.user],
    [/<账号>/g, values.user],
    [/<用户名>/g, values.user],
    [/<pass(word)?>/gi, values.pass],
    [/<口令>/g, values.pass],
    [/<密钥>/g, values.pass],
    [/<pwd>/gi, values.pass],
    [/<url>/gi, values.url],
    [/<域名>/g, values.host],
    [/<目标IP>/g, values.host],
    [/<内网IP>/g, values.host],
    [/<端口>/g, values.port],
    [/<listen端口>/g, values.port],
    [/<u>/g, values.user],
    [/<p>/g, values.pass],
  ]
  for (const [re, value] of table) {
    if (value === undefined || value === null || String(value) === '') continue
    const needle = new RegExp(re.source, re.flags.replace('g', ''))
    if (!needle.test(cmd)) continue
    cmd = cmd.replace(new RegExp(re.source, re.flags), String(value))
    filled.push(re.source.replace(/[\\<>?()/]|gi$/g, '') + ' → ' + String(value))
  }
  const remaining = Array.from(new Set(Array.from(cmd.matchAll(/<[^>\s]{1,24}>/g)).map((m) => m[0])))
  return { cmd, filled, remaining }
}

export { parseTarget, commandKind, parseCurl, buildHttpRequest, buildCurlCommand, fillTemplate }
