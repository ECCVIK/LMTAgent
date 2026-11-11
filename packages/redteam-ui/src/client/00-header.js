/**
 * RedTeam 控制台 —— 浏览器半侧（模块化源码 · 00-header）
 *
 * 格式与外壳的模块加载器一致：window.__ModuleLoader__.load({ id, factory })。
 * id 必须等于包名（clientModules 以 manifest 包名作为浏览器模块身份）。
 * 基座外无依赖：只用平台 seed 里的 react 与 ctx.slots。
 */
window.__ModuleLoader__.load({
  id: 'dsh-redteam-ui',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const rawH = React.createElement

    /* ── Markdown 展示 ────────────────────────────────────────────────────────
       面板里的提示文案、技能正文、模型回报/证据等大量文本本身是 Markdown。
       以前直接当纯文本塞进 React，用户会看到 `**粗体**`、`` `命令` ``、`## 标题`
       这些标记符号。这里做一层**安全**的轻量渲染：只生成 React 元素，绝不拼 HTML，
       因此模型/用户内容里的 `<script>` 只会按文本显示。
       行内规则：`**粗体**`、`` `行内代码` ``；块规则：标题、列表、表格、引用、
       围栏代码块、分隔线、段落。单个 `*`（通配符/乘法/证书 SAN）保持原样，避免误伤。 */

    /** 行内 Markdown → React 节点（不处理 HTML）。 */
    const renderInline = (text, depth) => {
      if (typeof text !== 'string' || text === '') return text
      if (text.indexOf('**') < 0 && text.indexOf('`') < 0) return text
      const level = depth || 0
      if (level > 4) return text
      const re = /(`[^`\n]+`|\*\*[^\n]+?\*\*)/g
      const out = []
      let last = 0
      let m
      while ((m = re.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index))
        const token = m[0]
        if (token.charCodeAt(0) === 96) {
          out.push(rawH('code', { key: 'c' + m.index, className: 'rt-inline-code' }, token.slice(1, -1)))
        } else {
          /* 技术文本里的 /** 与 **\/ 很常见（URL 通配、glob、脱敏星号），
             不要把它们误判成 Markdown 粗体。真正的粗体两侧不会紧贴路径分隔符。 */
          const before = m.index > 0 ? text[m.index - 1] : ''
          const after = m.index + token.length < text.length ? text[m.index + token.length] : ''
          const inner = token.slice(2, -2)
          if (/[\\/]/.test(before) || /[\\/]/.test(after)
            || inner.startsWith('/') || inner.endsWith('/')
            || before === '*' || after === '*' || /^[/*\s]+$/.test(inner)) {
            out.push(token)
          } else {
            out.push(rawH('strong', { key: 'b' + m.index }, renderInline(inner, level + 1)))
          }
        }
        last = m.index + token.length
      }
      if (out.length === 0) return text
      if (last < text.length) out.push(text.slice(last))
      return rawH(React.Fragment, null, ...out)
    }

    /* 这些容器里是代码/原始报文，必须逐字显示，不能把 `*` 当 Markdown。 */
    const MD_RAW_TAGS = new Set(['pre', 'code', 'textarea', 'option', 'script', 'style'])
    const MD_RAW_CLASS = /(?:^|\s)(?:rt-mono|rt-rep-http|rt-atest-notes|rt-textarea)(?:\s|$)/

    /**
     * 包一层 createElement：字符串子节点统一走行内 Markdown。
     * 这样不用逐个改几十处 `h('div', null, x.note)`，动态字段（模型写的回报、
     * 缺陷备注、技能描述、验证记录）也会一起生效。props 里的 title/value 不动。
     */
    const h = (type, props, ...children) => {
      if (children.length > 0
        && (typeof type !== 'string' || !MD_RAW_TAGS.has(type))
        && !(props && typeof props.className === 'string' && MD_RAW_CLASS.test(props.className))) {
        let changed = false
        const mapped = children.map((child) => {
          if (typeof child !== 'string') return child
          const rich = renderInline(child)
          if (rich !== child) changed = true
          return rich
        })
        if (changed) children = mapped
      }
      return rawH(type, props, ...children)
    }

    /** 敏感值默认掩码：口令/密钥不在首屏直显，点击才展开；复制仍走原值。 */
    function SecretText(props) {
      const value = String(props.value === undefined || props.value === null ? '' : props.value)
      const [shown, setShown] = React.useState(false)
      if (value === '') return h('span', { className: 'rt-secret-none' }, props.empty || '未记录')
      return h('span', {
        className: props.className || 'rt-mono',
        style: { display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' },
      },
        h('span', { style: { wordBreak: 'break-all' } }, shown ? value : '••••••••'),
        h('button', {
          className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
          onClick: (e) => { e.stopPropagation(); setShown((v) => !v) },
        }, shown ? '隐藏' : '显示'))
    }

    const splitTableRow = (line) => {
      const s = line.trim().replace(/^\|/, '').replace(/\|$/, '')
      const cells = []
      let cur = ''
      for (let i = 0; i < s.length; i += 1) {
        const ch = s[i]
        if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i += 1; continue }
        if (ch === '|') { cells.push(cur.trim()); cur = ''; continue }
        cur += ch
      }
      cells.push(cur.trim())
      return cells
    }

    const isTableSep = (line) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)

    /**
     * 块级 Markdown 渲染（技能正文、Markdown 构建文档）。
     * 支持标题 / 段落 / 有序无序列表 / 表格 / 引用 / 围栏代码 / 分隔线。
     */
    function Markdown(props) {
      const text = String(props.text === undefined || props.text === null ? '' : props.text)
      const lines = text.replace(/\r\n?/g, '\n').split('\n')
      const out = []
      let i = 0
      let key = 0
      while (i < lines.length) {
        const line = lines[i]
        if (line.trim() === '') { i += 1; continue }

        /* 围栏代码：内部原样显示，不做行内解析 */
        const fence = /^\s*```\s*([\w.+-]*)\s*$/.exec(line)
        if (fence !== null) {
          const body = []
          i += 1
          while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { body.push(lines[i]); i += 1 }
          if (i < lines.length) i += 1
          out.push(rawH('pre', { key: 'f' + key++, className: 'rt-md-code' },
            rawH('code', fence[1] ? { 'data-lang': fence[1] } : null, body.join('\n'))))
          continue
        }

        /* 标题：`#` 在面板里也用 h2 起步，避免一个技能标题把版面撑爆 */
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading !== null) {
          out.push(rawH('h' + Math.min(heading[1].length + 1, 6), { key: 'h' + key++ },
            renderInline(heading[2])))
          i += 1
          continue
        }

        if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) {
          out.push(rawH('hr', { key: 'r' + key++ }))
          i += 1
          continue
        }

        /* 引用：内部继续按 Markdown 渲染 */
        if (/^\s*>\s?/.test(line)) {
          const body = []
          while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
            body.push(lines[i].replace(/^\s*>\s?/, ''))
            i += 1
          }
          out.push(rawH('blockquote', { key: 'q' + key++ },
            rawH(Markdown, { text: body.join('\n') })))
          continue
        }

        /* 表格：表头 + 分隔行 + 数据行 */
        if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
          const head = splitTableRow(line)
          i += 2
          const rows = []
          while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') >= 0) {
            rows.push(splitTableRow(lines[i]))
            i += 1
          }
          out.push(rawH('table', { key: 't' + key++ },
            rawH('thead', null, rawH('tr', null,
              head.map((cell, ci) => rawH('th', { key: 'th' + ci }, renderInline(cell))))),
            rawH('tbody', null, rows.map((row, ri) => rawH('tr', { key: 'tr' + ri },
              head.map((_, ci) => rawH('td', { key: 'td' + ci }, renderInline(row[ci] || ''))))))))
          continue
        }

        /* 列表：简单列表；缩进子项按同级展示，不丢内容 */
        const list = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
        if (list !== null) {
          const ordered = /^\d/.test(list[1])
          const items = []
          while (i < lines.length) {
            const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
            if (item === null) break
            let body = item[2]
            i += 1
            while (i < lines.length && lines[i].trim() !== ''
              && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])
              && !/^\s*```/.test(lines[i])
              && !/^(#{1,6})\s+/.test(lines[i])) {
              body += '\n' + lines[i].trim()
              i += 1
            }
            items.push(rawH('li', { key: 'li' + key++ }, renderInline(body)))
          }
          out.push(rawH(ordered ? 'ol' : 'ul', { key: 'l' + key++ }, items))
          continue
        }

        /* 段落：遇到空行或下一个块级结构结束；保留换行（CSS white-space: pre-wrap） */
        const para = [line]
        i += 1
        while (i < lines.length && lines[i].trim() !== ''
          && !/^\s*```/.test(lines[i])
          && !/^(#{1,6})\s+/.test(lines[i])
          && !/^\s*>\s?/.test(lines[i])
          && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])
          && !/^\s*(?:---|\*\*\*|___)\s*$/.test(lines[i])
          && !(lines[i].indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
          para.push(lines[i])
          i += 1
        }
        out.push(rawH('p', { key: 'p' + key++ }, renderInline(para.join('\n'))))
      }
      return rawH('div', { className: props.className || 'rt-markdown', style: props.style }, out)
    }

    /**
     * 把"名字"压成可比较的形态：只留字母/数字/汉字，并解掉 DSH 的路径转义。
     */
    const squashName = (value) => String(value || '')
      .replace(/~([0-9a-fA-F]{4})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/[^0-9a-zA-Z\u4e00-\u9fff]+/g, '')
      .toLowerCase()

    /**
     * 会话标题里出现的工作区 id（不依赖绑定表的兜底）。
     * 命中多个时取**名字最长**的。
     */
    const engagementByTitle = (title, list) => {
      const hay = squashName(title)
      if (hay.length < 3) return null
      const hits = (list || [])
        .map((x) => ({ x: x, key: squashName(x.name || x.id) }))
        .filter((h) => h.key.length >= 3 && (hay.includes(h.key) || h.key.includes(hay)))
        .sort((a, b) => b.key.length - a.key.length)
      return hits.length ? hits[0].x.id : null
    }

    /* 样式表在 ./styles.js（唯一维护点）。浏览器半侧不能运行期 import，
       这里放占位符，由 bundle 的 build.mjs 在生成产物时替换成正文。 */
    const CSS = '__RT_STYLES__'
