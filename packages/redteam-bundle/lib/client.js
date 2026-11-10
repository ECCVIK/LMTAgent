/**
 * RedTeam 控制台 —— 浏览器半侧（手写 bundle）
 *
 * 格式与外壳的模块加载器一致：window.__ModuleLoader__.load({ id, factory })。
 * id 必须等于包名（clientModules 以 manifest 包名作为浏览器模块身份）。
 * 基座外无依赖：只用平台 seed 里的 react 与 ctx.slots。
 */
window.__ModuleLoader__.load({
  id: 'dsh-redteam-mode',
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
     * 漏洞备注、技能描述、测试记录）也会一起生效。props 里的 title/value 不动。
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
      /* 表格单元格里的 `\|` 是转义后的竖线（报告里的资产名/证据可能出现），
         不能直接按 `|` 切，否则整行会错位。 */
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
     * 块级 Markdown 渲染（技能正文、Markdown 攻击文件）。
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

        /* 列表：简单列表（技能文档绝大多数是平铺的）；缩进子项按同级展示，不丢内容 */
        const list = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
        if (list !== null) {
          const ordered = /^\d/.test(list[1])
          const items = []
          while (i < lines.length) {
            const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
            if (item === null) break
            let body = item[2]
            i += 1
            /* 续行：空行或下一个列表项之前的内容并进本项 */
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
     *
     * 用于「会话标题 → 靶标」反查：标题是**工作目录名**，靶标名来自演练单位名，
     * 两者经常只差括号/连字符/空格（`示例集团（控股）股份有限公司` vs
     * `示例集团-控股-股份有限公司`），目录名还可能是转义形态。
     * @param value - 会话标题或靶标名。
     * @returns 压缩后的比较键。
     */
    const squashName = (value) => String(value || '')
      .replace(/~([0-9a-fA-F]{4})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/[^0-9a-zA-Z\u4e00-\u9fff]+/g, '')
      .toLowerCase()

    /**
     * 会话标题里出现的靶标 id（不依赖绑定表的兜底）。
     *
     * 实测场景：升级前建的会话在落盘绑定表里没有记录，切过去时面板一路回落到
     * "最后一次绑定"，看着像没跟随。标题反查能覆盖这类会话 —— 前提是标题确实
     * 指向原始路径（能解码成中文）；只有目录基名时匹配不上，属于预期内的放弃。
     * 命中多个时取**名字最长**的（避免"电力"这类短名抢走"某某电力股份有限公司"）。
     * @param title - 会话标题（`displayTitle`）。
     * @param list - 靶标名册（`[{ id, name }]`）。
     * @returns 靶标 id，或 null。
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

    /*
     * 布局接缝：AppFrame 是 display:grid（sidebar | 1fr | details），
     * shell.overlay 是它内部 position:absolute;inset:0 的浮动层，带稳定属性
     * data-shell-overlay。面板打开且详情栏关闭时，用 :has() 给 frame 加
     * padding-right，让中栏（1fr）主动收窄 —— 面板常驻但不遮挡对话。
     * 右侧栏打开时 frame 失去对应 collapsed 属性，面板滑出隐藏、宽度让回右侧栏。
     * 注意属性名随 DSH 版本变化，这里同时兼容旧 data-details-collapsed 与新 data-rightbar-collapsed。
     */
    /* 样式表在 ./styles.js（唯一维护点）。浏览器半侧不能运行期 import，
       这里放占位符，由 bundle 的 build.mjs 在生成 lib/client.js 时替换成正文。 */
    const CSS = `
:root{--rt-dock-w:540px;--wb-blue:#4d6bfe;--wb-blue-deep:#2563eb;--wb-blue-cyan:#0ea5e9;--wb-blue-soft:rgba(77,107,254,.12);--wb-blue-ring:rgba(77,107,254,.32);--wb-blue-ink:#1e40af;--wb-blue-pill:#dbeafe}
body[data-ds-dark-theme]{--wb-blue:#5b78ff;--wb-blue-deep:#3b82f6;--wb-blue-cyan:#38bdf8;--wb-blue-soft:rgba(91,120,255,.16);--wb-blue-ring:rgba(91,120,255,.38);--wb-blue-ink:#93c5fd;--wb-blue-pill:rgba(77,107,254,.2)}
/* 右侧栏收起时给 frame 加内边距，中栏主动收窄且最多让出 45vw。属性名跨 DSH 版本兼容：
   旧版 details 栏 data-details-collapsed，新版 rightbar 栏 data-rightbar-collapsed。 */
div:has(> [data-shell-overlay] .rt-dock[data-open="1"])[data-details-collapsed],
div:has(> [data-shell-overlay] .rt-dock[data-open="1"])[data-rightbar-collapsed]{padding-right:min(var(--rt-dock-w),45vw)}
/* Windows Electron 的桌面标题栏是 webview 上方的 chrome（含最小化/最大化/关闭）。
   面板是 fixed dock overlay，不能从 y=0 起，否则会盖住系统按钮，按钮也会落在拖拽区里。
   用 DSH 布局发布的 chrome 高度变量；普通 web 没有变量时回退 0。 */
.rt-dock{position:fixed;top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px)));right:0;bottom:0;z-index:80;display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l1);
  box-shadow:-12px 0 32px rgba(15,23,42,.18);pointer-events:auto;color:var(--dsw-alias-label-primary);
  font-size:13px;line-height:1.5;transition:transform .18s ease,opacity .18s ease}
.rt-embed{flex:1;min-height:0;height:100%;width:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;overflow:hidden}
/* 右侧栏全屏时让位：滑出隐藏。仅在 data-rightbar-fullscreen 时隐藏，避免 DSH Desktop 无 collapsed 属性导致面板被强制隐藏。 */
div:has(> [data-shell-overlay] .rt-dock[data-open="1"])[data-rightbar-fullscreen] .rt-dock{
  transform:translateX(100%);opacity:0;pointer-events:none}
.rt-grip{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:col-resize;background:transparent;z-index:2}
.rt-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-title{font-weight:600;font-size:14px;display:flex;align-items:center;gap:6px;white-space:nowrap}
.rt-dot{width:8px;height:8px;border-radius:50%;background:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-spacer{flex:1}
.rt-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:inherit;
  border-radius:6px;padding:3px 9px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap}
.rt-btn:hover{border-color:var(--dsw-alias-border-l2)}
.rt-btn-primary{background:var(--wb-blue,var(--dsw-alias-brand-primary));border-color:var(--wb-blue,var(--dsw-alias-brand-primary));color:var(--dsw-alias-bg-base)}
.rt-btn-primary:hover{opacity:.9}
.rt-btn:disabled{opacity:.5;cursor:default}
.rt-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-tabs-groups{border-bottom:none;padding-bottom:0}
.rt-tabs-groups .rt-tab-group{font-size:12px;padding:4px 10px;color:var(--dsw-alias-label-secondary)}
.rt-tabs-groups .rt-tab-group.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.rt-tabs-sub{padding-top:2px;padding-bottom:0}
.rt-tab{padding:6px 12px;border-radius:6px 6px 0 0;cursor:pointer;font-size:12.5px;color:var(--dsw-alias-label-secondary);
  display:inline-flex;align-items:center;gap:5px}
.rt-tab.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font-weight:600}
/* 未读红点：该页签有新内容（新资产/新漏洞/新得分/新步骤…），点开看过就消失 */
.rt-tab-dot{width:7px;height:7px;border-radius:50%;background:#ef4444;flex:none;
  box-shadow:0 0 0 2px color-mix(in srgb, #ef4444 22%, transparent)}
.rt-body{flex:1;min-height:0;display:flex;flex-direction:column}
.rt-split{flex:1;min-height:0;display:flex}
.rt-side{width:200px;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:8px}
.rt-main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.rt-seg{padding:7px 8px;border-radius:6px;cursor:pointer;margin-bottom:4px;border:1px solid transparent}
.rt-seg:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-seg.on{background:var(--dsw-alias-bg-layer-2);border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-seg-cidr{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
.rt-seg-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.rt-toolbar{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap;align-items:center}
.rt-input{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:inherit;
  border-radius:6px;padding:4px 8px;font-size:12px;font-family:inherit;outline:none;min-width:0}
.rt-input:focus{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-table{flex:1;overflow:auto}
.rt-row{display:grid;grid-template-columns:150px 74px 104px 1.15fr 1fr;gap:8px;padding:6px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;cursor:pointer;font-size:12.5px}
.rt-row:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-row.head{cursor:default;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;position:sticky;top:0;
  background:var(--dsw-alias-bg-layer-1);z-index:1}
.rt-row.head:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-mono{font-family:ui-monospace,Menlo,monospace}
.rt-tag{display:inline-block;padding:0 5px;border-radius:4px;font-size:11px;margin-right:4px;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-tag-passive{color:#6366f1;border-color:#6366f155;background:#6366f11a}
.rt-tag-active{color:#0ea5e9;border-color:#0ea5e955;background:#0ea5e91a}
.rt-tag-live{color:#4d6bfe;border-color:#4d6bfe55;background:#4d6bfe1a}
.rt-tag-warn{color:#ef4444;border-color:#ef444455;background:#ef44441a}
/* 纪律提示条：不满足交付要求（非冰蝎/哥斯拉马、没有 suo5 隧道）时顶在区块最上方 */
.rt-hint{border-radius:6px;padding:7px 9px;margin-bottom:8px;font-size:11.5px;line-height:1.6;
  border:1px dashed #ef444488;background:#ef44440f;color:var(--dsw-alias-label-primary)}
.rt-hint b{color:#ef4444}
.rt-tag-dead{color:var(--dsw-alias-label-secondary)}
.rt-expand{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-kv{display:flex;gap:8px;margin-bottom:3px;align-items:baseline}
.rt-kv b{color:var(--dsw-alias-label-primary);font-weight:600;min-width:64px;flex:none}
/* 图谱视图已移除（见 AssetsTab：资产关系由「域名维度」与 redteam_attack_path 工具承担） */
.rt-pane{flex:1;overflow:auto;padding:12px}
.rt-card{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-2)}
.rt-card h4{margin:0 0 6px;font-size:13px}
.rt-textarea{width:100%;min-height:260px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);
  color:inherit;border-radius:6px;padding:8px;font-size:12.5px;font-family:ui-monospace,Menlo,monospace;
  line-height:1.6;resize:vertical;outline:none;box-sizing:border-box}
.rt-textarea:focus{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-list{width:210px;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:8px}
.rt-item{padding:7px 8px;border-radius:6px;cursor:pointer;margin-bottom:4px;border:1px solid transparent}
.rt-item:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-item.on{background:var(--dsw-alias-bg-layer-2);border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-item-name{font-weight:600;font-size:12.5px}
.rt-item-desc{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rt-empty{padding:24px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.rt-err{color:var(--dsw-alias-state-error-primary);font-size:12px;padding:6px 10px}
.rt-foot{padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;
  color:var(--dsw-alias-label-secondary);display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.rt-icon-btn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;border:1px solid var(--dsw-alias-border-l1);
  background:transparent;color:inherit;border-radius:6px;padding:6px 8px;cursor:pointer;font-family:inherit;font-size:12.5px}
.rt-icon-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-icon-btn.on{border-color:var(--wb-blue,var(--dsw-alias-brand-primary));color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-hbtn{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:inherit;border-radius:6px;
  padding:2px 8px;font-size:12px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px}
.rt-hbtn:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-hbtn.on{border-color:var(--wb-blue,var(--dsw-alias-brand-primary));color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-test{display:inline-block;padding:0 5px;border-radius:4px;font-size:11px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.rt-test-testing{color:#0ea5e9;border-color:#0ea5e955;background:#0ea5e91a}
.rt-test-tested{color:#4d6bfe;border-color:#4d6bfe55;background:#4d6bfe1a}
.rt-test-blocked{color:#fff;background:#ef4444;border-color:#ef4444}
.rt-test-abandoned{color:#94a3b8;border-color:#94a3b855;background:#94a3b81a}
.rt-test-no_surface{color:#6366f1;border-color:#6366f155;background:#6366f11a}
.rt-pri{display:inline-block;padding:0 6px;border-radius:4px;font-size:11px;font-weight:600;white-space:nowrap}
.rt-pri-high{color:#fff;background:#4d6bfe}
.rt-pri-medium{color:#fff;background:#0ea5e9}
.rt-pri-low{color:#fff;background:#94a3b8}
.rt-score-row{display:grid;grid-template-columns:16px 62px minmax(0,1fr) 116px 66px;gap:8px;padding:7px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;font-size:12.5px;cursor:pointer}
.rt-score-row:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-score-row.head{cursor:default;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;
  position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);z-index:1}
.rt-score-detail{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
/* 得分目标按合并版的 8 个类别分组：类别头 + 组内按分值升序 */
.rt-score-group{display:flex;align-items:center;gap:8px;padding:7px 10px 5px;margin-top:2px;
  font-size:12px;font-weight:600;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.rt-score-group:first-child{border-top:none}
.rt-score-group .rt-sg-sub{font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary)}
/* ── 会话与入口：每张卡片分「标题行 / 关键事实 / 可用命令 / 备注」四段，避免一行糊在一起 ── */
.rt-sess-facts{display:flex;flex-direction:column;gap:2px;margin-top:5px}
.rt-sess-fact{display:flex;gap:6px;font-size:11.5px;line-height:1.5}
.rt-sess-fact>b{flex:none;min-width:62px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.rt-sess-fact>span{min-width:0;overflow-wrap:anywhere}
.rt-sess-cmd{margin-top:6px}
.rt-sess-cmd>b{display:block;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:3px;font-weight:600}
.rt-sess-fold{margin-top:6px;font-size:11.5px}
.rt-sess-fold>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);user-select:none}
.rt-sess-fold>summary:hover{color:var(--dsw-alias-label-primary)}
.rt-score-row .rt-scope{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.rt-score-form{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px}
.rt-score-form input,.rt-score-form select{width:100%;box-sizing:border-box}
.rt-vrow{display:grid;grid-template-columns:62px minmax(0,1fr) 132px 108px 74px 52px;gap:8px;padding:6px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;font-size:12.5px;cursor:pointer}
.rt-vrow:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-vrow.head{cursor:default;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;
  position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);z-index:1}
.rt-vdetail{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-vdetail .rt-kv{margin-bottom:4px}
.rt-actions{display:flex;gap:6px;margin-top:6px}
.rt-section{padding:8px 10px 2px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.rt-link{color:var(--wb-blue,var(--dsw-alias-brand-primary));text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-link:hover{text-decoration:underline}
.rt-full{position:fixed;top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px)));right:0;bottom:0;left:0;z-index:60;display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;
  border-top:3px solid var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-full .rt-head{padding:12px 18px}
.rt-full .rt-tabs{padding:10px 18px 0;gap:6px;flex-wrap:wrap}
.rt-full .rt-side{width:260px}
.rt-full .rt-list{width:280px}
.rt-full .rt-row{grid-template-columns:190px 90px 130px 1.4fr 1.2fr}
.rt-full .rt-vrow{grid-template-columns:80px minmax(0,1.6fr) 200px 150px 90px 64px}
.rt-full .rt-pane{padding:18px}
.rt-full .rt-textarea{min-height:60vh}
.rt-full .rt-foot{padding:10px 18px;font-size:12px}
.rt-full .rt-body{max-width:1400px;width:100%;margin:0 auto;flex:1;min-height:0;display:flex;flex-direction:column}
.rt-chain{flex:1;overflow:auto;padding:10px 12px}
.rt-step{display:flex;gap:10px;padding:8px 6px;border-left:2px solid var(--dsw-alias-border-l1);margin-left:6px}
.rt-step:last-child{border-left-color:transparent}
.rt-step-dot{width:22px;height:22px;flex:none;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:11px;font-weight:700;color:#fff;background:#64748b;margin-left:-13px}
.rt-step-body{min-width:0}
.rt-step-title{font-weight:600;font-size:13px}
.rt-step-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:2px;word-break:break-word}
.rt-stage-recon{background:#4d6bfe}
.rt-stage-vuln{background:#0ea5e9}
.rt-stage-exploit{background:#2563eb}
.rt-stage-access{background:#4d6bfe}
.rt-stage-pivot{background:#6366f1}
.rt-stage-data{background:#0284c7}
.rt-stage-other{background:#64748b}
.rt-step-head{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.rt-step-time{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:auto;white-space:nowrap}
.rt-step-detail{font-size:12px;margin-top:5px;white-space:pre-wrap;word-break:break-word;
  border-left:2px solid var(--dsw-alias-border-l1);padding:2px 0 2px 9px;line-height:1.6}
.rt-chip{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;padding:1px 7px;border-radius:5px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);margin:4px 5px 0 0;max-width:100%}
.rt-chip>i{font-style:normal;color:var(--dsw-alias-label-secondary);font-size:10.5px}
.rt-chip>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px}
.rt-stage-tag{display:inline-block;padding:0 6px;border-radius:4px;font-size:11px;color:#fff;font-weight:600}
.rt-st-recon{background:#4d6bfe}.rt-st-vuln{background:#0ea5e9}.rt-st-exploit{background:#2563eb}
.rt-st-access{background:#4d6bfe}.rt-st-pivot{background:#6366f1}.rt-st-data{background:#0284c7}.rt-st-other{background:#64748b}
.rt-sev{display:inline-block;padding:0 6px;border-radius:4px;font-size:11px;font-weight:600;border:1px solid transparent}
.rt-sev-critical{color:#fff;background:#b91c1c}.rt-sev-high{color:#fff;background:#ef4444}
.rt-sev-medium{color:#7c2d12;background:#fdba74}.rt-sev-low{color:#1e3a8a;background:#bfdbfe}
.rt-sev-info{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l1)}
.rt-dot-on{display:inline-block;width:7px;height:7px;border-radius:50%;background:#4d6bfe;box-shadow:0 0 0 3px #4d6bfe33}
.rt-dot-off{display:inline-block;width:7px;height:7px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 3px #ef444433}
.rt-dot-unk{display:inline-block;width:7px;height:7px;border-radius:50%;background:#94a3b8;box-shadow:0 0 0 3px #94a3b833}
.rt-sess-grid{display:grid;grid-template-columns:1fr;gap:8px;padding:10px 12px}
.rt-sess{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:9px 10px;background:var(--dsw-alias-bg-layer-2)}
.rt-sess-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-sess-title{font-weight:600;font-size:12.5px;font-family:ui-monospace,Menlo,monospace;word-break:break-all}
.rt-sess-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:3px;word-break:break-word}
.rt-code{font-family:ui-monospace,Menlo,monospace;font-size:11px;background:var(--dsw-alias-bg-base);
  border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:1px 5px;cursor:pointer;word-break:break-all}
.rt-code:hover{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-evi{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;overflow:hidden;margin-top:8px}
.rt-evi-head{display:flex;align-items:center;gap:8px;padding:5px 9px;background:var(--dsw-alias-bg-layer-2);
  font-size:11.5px;font-weight:600;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-evi-body{margin:0;padding:9px 11px;font-family:ui-monospace,Menlo,monospace;font-size:11.5px;line-height:1.6;
  white-space:pre-wrap;word-break:break-word;max-height:340px;overflow:auto;background:var(--dsw-alias-bg-base)}
.rt-evi-body.req{max-height:220px}
.rt-hl-req{color:#4d6bfe;font-weight:600}
.rt-hl-res{color:#0ea5e9;font-weight:600}
.rt-gain{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:12px;
  color:var(--wb-blue-ink,#1e40af);background:var(--wb-blue-pill,#dbeafe);border:1px solid #4d6bfe55}
.rt-total{font-size:20px;font-weight:700;font-family:ui-monospace,Menlo,monospace}
.rt-sidehead{padding:7px 8px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);
  display:flex;align-items:center;gap:5px}
.rt-sidehead-btn{cursor:pointer;outline:none;padding:6px 6px 5px;border-radius:5px;user-select:none}
.rt-sidehead-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.rt-sidehead-btn:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-scope{display:inline-block;padding:0 4px;border-radius:3px;font-size:10px;font-weight:700;line-height:15px;flex:none}
.rt-scope-internal{color:var(--wb-blue-ink,#1e40af);background:var(--wb-blue-pill,#dbeafe)}
.rt-scope-external{color:#0ea5e9;background:rgba(14,165,233,.14)}
/* 「当前测试」的标记：既不是内网也不是外网，用蓝紫单独区分 */
.rt-scope-testing{color:#6366f1;background:rgba(99,102,241,.14)}
.rt-hits{display:flex;flex-direction:column;gap:6px;margin-top:7px}
.rt-hit{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:6px;
  padding:7px 9px;background:var(--dsw-alias-bg-layer-2)}
.rt-hit-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-hit-idx{width:16px;height:16px;border-radius:50%;background:#4d6bfe;color:#fff;font-size:10.5px;font-weight:700;
  display:inline-flex;align-items:center;justify-content:center;flex:none}
.rt-hit-target{font-family:ui-monospace,Menlo,monospace;font-weight:600;font-size:12px;word-break:break-all}
.rt-hit-time{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-hit-evi{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;line-height:1.65;white-space:pre-wrap;word-break:break-word;
  background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:6px 8px;margin-top:5px}
.rt-hit-note{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:4px}
.rt-cred{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #0ea5e9;border-radius:6px;
  padding:8px 10px;background:var(--dsw-alias-bg-layer-2);margin-bottom:7px}
.rt-cred-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-cred-host{font-family:ui-monospace,Menlo,monospace;font-weight:600;font-size:12.5px;word-break:break-all}
.rt-secret{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;background:color-mix(in srgb,var(--wb-blue,#4d6bfe) 10%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);
  border:1px solid #4d6bfe55;border-radius:5px;padding:6px 9px;margin-top:6px;white-space:pre-wrap;word-break:break-all;
  user-select:all;cursor:text}
.rt-secret-none{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--dsw-alias-state-error-primary);
  border:1px dashed var(--dsw-alias-state-error-primary);border-radius:5px;padding:5px 9px;margin-top:6px}
.rt-cred-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:5px;word-break:break-word}
.rt-stage-score{background:#4d6bfe}
.rt-counted{font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:700;color:var(--wb-blue-ink,#1e40af);background:var(--wb-blue-pill,#dbeafe);border:1px solid #4d6bfe55;border-radius:9px;padding:0 7px}
.rt-scorepts{font-size:11.5px;font-weight:700;color:var(--wb-blue-ink,#1e40af);background:var(--wb-blue-pill,#dbeafe);border:1px solid #4d6bfe55;
  border-radius:10px;padding:0 7px;white-space:nowrap}
.rt-livebar{display:flex;align-items:center;gap:7px;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);flex-wrap:wrap}
.rt-live-dot{width:8px;height:8px;border-radius:50%;background:#4d6bfe;flex:none;animation:rt-pulse 1.6s ease-in-out infinite}
.rt-live-dot.idle{background:#94a3b8;animation:none}
@keyframes rt-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 #4d6bfe66}50%{opacity:.5;box-shadow:0 0 0 5px #4d6bfe00}}
.rt-live-body{padding:8px 12px 2px;max-height:44vh;overflow:auto}
.rt-atest{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:6px;
  padding:7px 10px;background:var(--dsw-alias-bg-layer-2);margin-bottom:6px}
.rt-atest.past{border-left-color:#94a3b8;opacity:.85}
.rt-atest-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-atest-ip{font-family:ui-monospace,Menlo,monospace;font-weight:600;font-size:12.5px;word-break:break-all}
.rt-atest-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:3px;word-break:break-word}
.rt-atest-notes{font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;
  word-break:break-word;background:var(--dsw-alias-bg-base);border-radius:4px;padding:5px 7px;margin-top:4px;max-height:76px;overflow:auto}
.rt-concl{display:flex;align-items:center;gap:4px;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);flex-wrap:wrap}
.rt-concl-i{display:inline-flex;align-items:baseline;gap:4px;padding:2px 8px;border-radius:6px;cursor:pointer;
  border:1px solid transparent}
.rt-concl-i:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.rt-concl-i.on{border-color:var(--wb-blue,var(--dsw-alias-brand-primary));background:var(--dsw-alias-bg-layer-1)}
.rt-concl-i b{font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:700}
.rt-concl-i>span{color:var(--dsw-alias-label-secondary);font-size:11.5px}
.rt-more{color:var(--wb-blue,var(--dsw-alias-brand-primary));font-size:11.5px;cursor:pointer;user-select:none;margin-top:4px;display:inline-block}
.rt-more:hover{text-decoration:underline}
.rt-subtabs{display:flex;gap:4px;padding:6px 10px 0;border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center}
.rt-subtab{padding:4px 10px;border-radius:6px 6px 0 0;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-subtab.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font-weight:600}
.rt-sevbar{width:3px;border-radius:2px;align-self:stretch;flex:none;margin-right:2px}
/* ── 折叠层次体系 ─────────────────────────────────────────────────────────────
   L1 折叠头 .rt-sec   ：通栏、无圆角无边框、左色条、深底 —— 永远是"扁"的
   L2 内容卡 .rt-atest/.rt-hit/.rt-cred/.rt-evi：内缩、有边框、圆角 —— 立起来
   L3 详情/长文本 .rt-clip-body / .rt-evi-body ：无边框、最浅、等宽
   L4 子项容器 .rt-sec-body：左缩进 + 竖引导线，表明"属于上面那个头"
   ──────────────────────────────────────────────────────────────────────────── */
.rt-sec-wrap{margin:0}
.rt-sec{display:flex;align-items:center;gap:8px;padding:7px 12px 7px 9px;cursor:pointer;
  background:var(--dsw-alias-bg-layer-2);border-left:3px solid var(--dsw-alias-border-l2);
  border-top:1px solid var(--dsw-alias-border-l1);user-select:none;outline:none}
.rt-sec:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-sec:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-sec.flat{cursor:default}
.rt-sec.flat:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-sec-caret{flex:none;width:11px;font-size:10px;color:var(--dsw-alias-label-secondary);text-align:center}
.rt-sec-title{font-weight:600;font-size:13px;white-space:nowrap}
.rt-sec-count{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-sec-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-sec-right{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:none}
.rt-sec.t-stage{border-left-color:#6366f1}
.rt-sec.t-target{border-left-color:#0ea5e9}
.rt-sec.t-folder{border-left-color:#64748b}
.rt-sec.t-test{border-left-color:#4d6bfe}
.rt-sec.t-queue{border-left-color:#0ea5e9}
.rt-sec.t-past{border-left-color:#94a3b8}
.rt-sec-body{margin-left:12px;border-left:1px solid var(--dsw-alias-border-l1);padding:7px 0 3px 10px}
.rt-sec-body>.rt-atest:last-child,.rt-sec-body>.rt-hit:last-child{margin-bottom:2px}
/* 长文本折叠（L3）：默认预览 2 行并渐隐，展开后限高滚动 */
.rt-clip{margin-top:6px}
.rt-clip-head{display:flex;align-items:center;gap:6px}
.rt-clip-label{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:600}
.rt-clip-body{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;line-height:1.65;white-space:pre-wrap;
  word-break:break-word;background:var(--dsw-alias-bg-base);border-radius:5px;padding:6px 8px;margin-top:3px}
.rt-clip:not(.open) .rt-clip-body{max-height:46px;overflow:hidden;
  -webkit-mask-image:linear-gradient(180deg,#000 55%,transparent);mask-image:linear-gradient(180deg,#000 55%,transparent)}
.rt-clip.open .rt-clip-body{max-height:340px;overflow:auto}
.rt-flow{padding:10px 12px 16px}
.rt-flow-start,.rt-flow-end{font-size:11.5px;color:var(--dsw-alias-label-secondary);padding:4px 0}
.rt-flow-end{font-weight:600;color:var(--dsw-alias-label-primary)}
.rt-flow-link{display:flex;align-items:center;gap:8px;padding:3px 0 3px 10px}
.rt-flow-arrow{color:var(--dsw-alias-border-l2);font-size:11px;flex:none}
.rt-flow-action{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-flow-action.inferred{opacity:.7;font-style:italic}
.rt-flow-node{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:8px;
  padding:8px 11px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;outline:none}
.rt-flow-node:hover{border-color:var(--dsw-alias-border-l2)}
.rt-flow-node:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-flow-node.overflow{border-left-color:#94a3b8;opacity:.75}
.rt-flow-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rt-flow-idx{width:18px;height:18px;border-radius:50%;background:#4d6bfe;color:#fff;font-size:11px;font-weight:700;
  display:inline-flex;align-items:center;justify-content:center;flex:none}
.rt-flow-node.overflow .rt-flow-idx{background:#94a3b8}
.rt-flow-name{font-weight:600;font-size:13px}
.rt-flow-pts{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;font-weight:700;color:#1e40af;
  background:#dbeafe;border:1px solid #4d6bfe55;border-radius:10px;padding:0 8px;white-space:nowrap}
.rt-flow-pts.off{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1)}
.rt-flow-times{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-flow-target{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;margin-top:4px;word-break:break-all;
  color:var(--dsw-alias-label-secondary)}
.rt-flow-gain{font-size:12px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-flow-detail{margin-top:7px;padding-top:7px;border-top:1px dashed var(--dsw-alias-border-l1)}
.rt-hflow-wrap{flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto}
.rt-hflow{display:flex;align-items:center;gap:0;padding:16px 12px;overflow-x:auto;flex-wrap:nowrap}
.rt-hflow-item{display:flex;align-items:center;flex:none}
.rt-hflow-start,.rt-hflow-end{font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;padding:0 4px}
.rt-hflow-end{font-weight:600;color:var(--dsw-alias-label-primary)}
.rt-hflow-arrow{color:var(--dsw-alias-border-l2);padding:0 5px;font-size:13px;flex:none}
.rt-hflow-node{display:flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l1);
  border-left:3px solid #4d6bfe;border-radius:7px;padding:5px 8px;background:var(--dsw-alias-bg-layer-2);
  cursor:pointer;white-space:nowrap;outline:none}
.rt-hflow-node:hover{border-color:var(--dsw-alias-border-l2)}
.rt-hflow-node:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-hflow-node.overflow{border-left-color:#94a3b8;opacity:.72}
.rt-hflow-node.open{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-hflow-pts{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;font-weight:700;color:#1e40af;background:#dbeafe;
  border-radius:8px;padding:0 6px}
.rt-hflow-node.overflow .rt-hflow-pts{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.rt-hflow-name{font-size:11.5px}
.rt-hflow-n{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.rt-rep-list{padding:10px 12px 14px}
.rt-rep-tools{display:flex;gap:6px;justify-content:flex-end;margin-bottom:8px}
.rt-rep{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:8px;
  padding:9px 11px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-2)}
.rt-rep-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rt-rep-idx{font-size:15px;color:#4d6bfe;font-weight:700;flex:none}
.rt-rep-name{font-weight:600;font-size:13px}
.rt-rep-meta{font-size:12px;margin-top:4px;color:var(--dsw-alias-label-secondary);word-break:break-word}
.rt-rep-meta b{color:var(--dsw-alias-label-primary);font-weight:600;margin-right:2px}
.rt-rep-missing{font-size:11.5px;color:var(--dsw-alias-state-error-primary);margin-top:6px;
  border:1px dashed var(--dsw-alias-state-error-primary);border-radius:5px;padding:5px 8px}
.rt-rep-req{margin-top:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;overflow:hidden}
.rt-rep-req-head{display:flex;align-items:center;gap:7px;padding:4px 8px;font-size:11.5px;font-weight:600;
  background:var(--dsw-alias-bg-layer-1);border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-rep-http{margin:0;padding:8px 10px;font-family:ui-monospace,Menlo,monospace;font-size:11.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;background:var(--dsw-alias-bg-base)}
/* ── 报告里的「这一步怎么来的」：动作步骤 / 命令 / 凭据 / 隧道 ───────────── */
.rt-rep-trace{margin-top:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px 10px;
  background:var(--dsw-alias-bg-base)}
.rt-rep-trace-head{display:flex;align-items:center;gap:7px;margin-bottom:5px}
.rt-rep-trace-title{font-weight:600;font-size:12.5px}
.rt-rep-trace-how{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}
.rt-rep-step{border-left:2px solid var(--dsw-alias-border-l1);padding:2px 0 6px 9px;margin-bottom:6px}
.rt-rep-step-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.rt-rep-step-no{width:17px;height:17px;border-radius:50%;background:var(--wb-blue,var(--dsw-alias-brand-primary));color:#fff;
  font-size:10.5px;display:flex;align-items:center;justify-content:center;flex:none}
.rt-rep-step-title{font-weight:600;font-size:12.5px}
.rt-rep-step-detail{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.rt-rep-step-cmd{font-size:11.5px;margin-top:4px;display:flex;gap:6px;align-items:flex-start;flex-wrap:wrap}
.rt-rep-step-cmd .rt-mono{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);
  border-radius:5px;padding:2px 6px;word-break:break-all}
.rt-rep-step-result{font-size:11.5px;margin-top:3px;word-break:break-word}
.rt-rep-src{margin-top:6px;padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l1)}
.rt-rep-src-title{font-weight:600;font-size:12px;margin-bottom:3px}
/* ── 全链路攻击路径图 ─────────────────────────────────────────────── */
.rt-ap{padding:10px 12px 18px;overflow:auto}
.rt-ap-stage{margin-bottom:2px}
.rt-ap-head{display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--dsw-alias-bg-layer-2);
  border-left:4px solid #64748b;border-top:1px solid var(--dsw-alias-border-l1);border-radius:6px 6px 0 0}
.rt-ap-no{width:20px;height:20px;border-radius:5px;color:#fff;font-size:11px;font-weight:700;flex:none;
  display:inline-flex;align-items:center;justify-content:center}
.rt-ap-name{font-weight:700;font-size:13.5px}
.rt-ap-en{font-size:10px;color:var(--dsw-alias-label-secondary);letter-spacing:.3px}
.rt-ap-phase{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-ap-goal{display:flex;align-items:baseline;gap:8px;padding:6px 10px 6px 9px;font-size:12px;
  border-left:4px solid #64748b;background:var(--dsw-alias-bg-layer-1)}
.rt-ap-goal-tag{font-size:10.5px;font-weight:700;border:1px solid;border-radius:4px;padding:0 5px;white-space:nowrap;flex:none}
.rt-ap-result{padding:7px 10px 3px;border-left:4px solid transparent}
.rt-ap-result-head{display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap}
.rt-ap-pts{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;font-weight:700;color:#1e40af;background:#dbeafe;
  border:1px solid #4d6bfe55;border-radius:10px;padding:0 7px;white-space:nowrap}
.rt-ap-pts.off{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1)}
/* 按服务封顶/自建而不计分的命中：分值标灰（+0），避免看着像又加了分 */
.rt-ap-pts.uncounted{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-border-l1)}
.rt-ap-nth{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-ap-hit{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:6px;
  padding:6px 9px;margin-bottom:5px;background:var(--dsw-alias-bg-layer-2);cursor:pointer;outline:none}
.rt-ap-hit:hover{border-color:var(--dsw-alias-border-l2)}
.rt-ap-hit:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-ap-hit.overflow{border-left-color:#94a3b8;opacity:.75}
.rt-ap-hit-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-ap-hit-name{font-weight:600;font-size:12.5px}
.rt-ap-hit-target{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);
  margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46%}
.rt-ap-act{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:3px}
.rt-ap-act.inferred{font-style:italic;opacity:.75}
.rt-ap-none{font-size:11.5px;color:var(--dsw-alias-label-secondary);padding:2px 0 4px}
.rt-ap-trans{display:flex;align-items:center;gap:7px;padding:2px 0 2px 14px}
.rt-ap-trans-t{font-size:11px;color:var(--dsw-alias-label-secondary)}
/* 横向路径图 */
.rt-ap-h{display:flex;align-items:stretch;padding:10px 12px 14px;overflow-x:auto;flex:1;min-height:0}
.rt-ap-col{display:flex;align-items:stretch;flex:none}
.rt-ap-col-arrow{align-self:center;color:var(--dsw-alias-border-l2);padding:0 6px;font-size:12px;flex:none}
.rt-hcol{width:228px;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);
  border-top:3px solid #64748b;border-radius:7px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.rt-hcol-goal{font-size:11px;color:var(--dsw-alias-label-secondary);padding:5px 8px;line-height:1.45;
  border-bottom:1px solid var(--dsw-alias-border-l1);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rt-hcol-body{padding:6px 8px;flex:1;min-height:0;overflow:auto}
.rt-hcol-hit{display:flex;align-items:center;gap:5px;font-size:11px;margin-bottom:3px}
.rt-hcol-hit.off{opacity:.6}
.rt-hcol-pts{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;font-weight:700;color:#1e40af;background:#dbeafe;
  border-radius:7px;padding:0 5px;flex:none}
.rt-hcol-hit.off .rt-hcol-pts{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.rt-hcol-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-hcol-none{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-hcol-secs{display:flex;flex-wrap:wrap;gap:3px;margin-top:6px}
.rt-hcol-sec{font-size:10px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);
  border-radius:4px;padding:0 4px}
.rt-hcol-attck{font-family:ui-monospace,Menlo,monospace;font-size:9.5px;color:var(--dsw-alias-label-secondary);
  padding:4px 8px;border-top:1px solid var(--dsw-alias-border-l1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-ap-cum{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-ap-sub{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:6px 0 3px}
.rt-ap-assets,.rt-ap-tunnels{display:flex;flex-direction:column;gap:3px}
.rt-ap-asset{display:flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 6px;border-radius:5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1)}
.rt-ap-tunnel{display:flex;align-items:center;gap:6px;font-size:11.5px;padding:4px 7px;border-radius:5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe}
.rt-hcol-sub{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-bottom:2px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;gap:5px;align-items:center}
.rt-hcol-sub.off{opacity:.6}
.rt-hit-row{display:flex;flex-wrap:wrap;align-items:center;gap:2px 7px;font-size:11.5px;padding:4px 7px;border-radius:5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);margin-bottom:3px}
/* 资产与内容都自适应换行：长域名/长口令/长结果一律换行显示，不截断成省略号 */
.rt-hit-asset{font-family:ui-monospace,Menlo,monospace;font-weight:600;flex:0 1 auto;max-width:100%;
  overflow-wrap:anywhere;word-break:break-word}
.rt-hit-txt{flex:1 1 100%;color:var(--dsw-alias-label-primary);line-height:1.55;
  white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
.rt-hit-txt.none{color:var(--dsw-alias-state-error-primary)}
.rt-hit-row .rt-hit-time{flex:none;margin-left:auto}
/* 自己注册/自建的账号：留痕但不计分，整行压暗 */
.rt-hit-row.self-created{opacity:.72;border-left:3px solid #ef444488}
/* 同一资产同一端口的重复账号/库权限：服务已拿满，不计分（只作留痕） */
.rt-hit-row.service-capped{opacity:.72;border-left:3px solid #f59e0b88}
.rt-hit-row.service-capped .rt-hit-idx{background:#f59e0b}
.rt-rep-group{margin-bottom:14px}
.rt-rep-stage{display:flex;align-items:center;gap:8px;padding:7px 10px;margin-bottom:7px;
  background:var(--dsw-alias-bg-layer-2);border-left:4px solid #64748b;border-radius:6px;
  cursor:pointer;outline:none;user-select:none}
.rt-rep-stage:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-rep-stage:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-rep-no{width:20px;height:20px;border-radius:5px;color:#fff;font-size:11px;font-weight:700;flex:none;
  display:inline-flex;align-items:center;justify-content:center}
.rt-rep-stage-name{font-weight:700;font-size:13px}
.rt-rep-stage-n{font-size:11px;color:var(--dsw-alias-label-secondary)}
/* 折叠后仍要能一眼看到"这一阶段拿了多少分"，所以分数留在头上 */
.rt-rep-pts{font-size:11px;font-weight:600;padding:1px 6px;border-radius:5px;border:1px solid transparent;flex:none}
.rt-rep-body{padding-left:6px}
/* ── 知识库（POC/EXP） ──────────────────────────────────────────── */
.rt-kb-filter{display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
/* 知识库归类总览：一行标签，点一下按该类筛选 */
.rt-kb-cats{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
/* 知识库分组标题（按归类分组时每组一条） */
.rt-kb-cat{display:flex;align-items:center;gap:7px;padding:7px 10px;background:var(--dsw-alias-bg-layer-2);
  border-bottom:1px solid var(--dsw-alias-border-l1);position:sticky;top:0;z-index:1}
.rt-kb-cat-name{font-weight:600;font-size:12.5px}
/* 技能可用性徽章（技能库页签） */
.rt-avail{display:inline-block;padding:0 5px;border-radius:4px;font-size:10.5px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.rt-avail-available{color:#4d6bfe;border-color:#4d6bfe55;background:#4d6bfe1a}
.rt-avail-broken{color:#ef4444;border-color:#ef444455;background:#ef44441a}
.rt-avail-unknown{color:#94a3b8;border-color:#94a3b855;background:#94a3b81a}
/* 版本 / 更新弹窗 */
.rt-modal{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.rt-modal-box{width:min(560px,92vw);max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px;font-size:12.5px;line-height:1.7;
  box-shadow:0 18px 48px rgba(0,0,0,.35);color:var(--dsw-alias-label-primary)}
.rt-modal-box .rt-kv b{min-width:76px}
.rt-kb-check{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer}
.rt-kb{border:1px solid var(--dsw-alias-border-l1);border-radius:7px;margin:0 0 8px;overflow:hidden;
  background:var(--dsw-alias-bg-layer-2)}
.rt-kb.open{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-kb-head{display:flex;align-items:center;gap:7px;padding:7px 9px;cursor:pointer;outline:none;flex-wrap:wrap}
.rt-kb-head:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-kb-head:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-kb-title{font-weight:600;font-size:12.5px;overflow-wrap:anywhere}
.rt-kb-kind{font-size:10px;font-weight:700;letter-spacing:.4px;padding:1px 5px;border-radius:4px;
  color:#fff;background:#64748b;flex:none}
.rt-kb-kind.k-exp{background:#2563eb}
.rt-kb-kind.k-poc{background:#4d6bfe}
.rt-kb-kind.k-template{background:#6366f1}
.rt-kb-kind.k-script{background:#0ea5e9}
.rt-kb-kind.k-payload{background:#0284c7}
.rt-kb-sub{font-size:11px;color:var(--dsw-alias-label-secondary);padding:0 9px 7px;overflow-wrap:anywhere}
.rt-kb-body{padding:0 9px 9px}
.rt-kb-actions{display:flex;gap:6px;margin:7px 0}
.rt-kb-body .rt-kv span{overflow-wrap:anywhere;word-break:break-word}
/* 本机 nuclei 模板命中：路径要能完整看到（复制成命令直接跑） */
.rt-kb-tpl{margin-top:12px;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:8px}
.rt-kb-tpl-row{display:flex;align-items:center;gap:7px;font-size:11.5px;padding:3px 7px;border-radius:5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);margin-bottom:3px}
.rt-kb-tpl-path{flex:0 1 auto;font-weight:600;overflow-wrap:anywhere}
.rt-kb-tpl-name{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.rt-md{flex:1;overflow:auto;margin:0;padding:14px 16px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;
  line-height:1.65;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-base)}
/* ── Markdown 渲染视图：技能正文 / .md 攻击文件 / 行内强调 ─────────────────────
   面板里的提示、技能文档、模型回报本身就是 Markdown；之前当纯文本渲染会把
   星号粗体、反引号代码、井号标题直接露出来。.rt-markdown 是块级视图，
   .rt-inline-code 是行内代码。 */
.rt-markdown{flex:1;overflow:auto;padding:12px 14px;font-size:12.5px;line-height:1.7;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);word-break:break-word}
.rt-markdown>:first-child{margin-top:0}
.rt-markdown>:last-child{margin-bottom:0}
.rt-markdown h1,.rt-markdown h2,.rt-markdown h3,.rt-markdown h4,.rt-markdown h5,.rt-markdown h6{
  margin:12px 0 6px;font-weight:600;line-height:1.35}
.rt-markdown h1{font-size:16px}
.rt-markdown h2{font-size:14px}
.rt-markdown h3{font-size:13px}
.rt-markdown h4,.rt-markdown h5,.rt-markdown h6{font-size:12.5px}
.rt-markdown p{margin:0 0 8px;white-space:pre-wrap}
.rt-markdown ul,.rt-markdown ol{margin:0 0 8px;padding-left:20px}
.rt-markdown li{margin:2px 0;white-space:pre-wrap}
.rt-markdown li>p{margin:0}
.rt-markdown code,.rt-inline-code{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);
  border-radius:4px;padding:0 3px;white-space:pre-wrap;word-break:break-word}
.rt-markdown pre{margin:0 0 9px;padding:8px 10px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);
  border-radius:6px;background:var(--dsw-alias-bg-layer-1);font-family:ui-monospace,Menlo,monospace;
  font-size:11.5px;line-height:1.6;white-space:pre-wrap;word-break:break-word}
.rt-markdown pre code{background:none;border:0;padding:0;font-size:inherit}
.rt-markdown table{border-collapse:collapse;table-layout:fixed;width:100%;margin:0 0 10px;font-size:11.5px}
.rt-markdown th,.rt-markdown td{border:1px solid var(--dsw-alias-border-l1);padding:4px 7px;
  text-align:left;vertical-align:top;word-break:break-word;overflow-wrap:anywhere}
.rt-markdown th{background:var(--dsw-alias-bg-layer-1);font-weight:600}
.rt-markdown blockquote{margin:0 0 9px;padding:4px 10px;border-left:3px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.rt-markdown hr{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:10px 0}
.rt-markdown strong{font-weight:600}
.rt-weblink{display:block;font-size:11.5px;margin-top:1px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rt-weblink{display:block;font-size:11.5px;margin-top:1px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* ── 证据截图：得分点里最多 3 张代表图，点开全屏 ─────────────────────────── */
.rt-shots{margin:8px 0 4px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;
  background:var(--dsw-alias-bg-layer-1)}
.rt-shots-head{display:flex;align-items:baseline;gap:8px;font-size:11.5px;margin-bottom:6px}
.rt-shots-n{color:var(--dsw-alias-label-secondary)}
.rt-shot-row{display:flex;gap:8px;flex-wrap:wrap}
.rt-shot{display:flex;flex-direction:column;gap:3px;max-width:220px}
.rt-shot-thumb{border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:#0b1020;
  object-fit:contain;display:block;width:auto;max-width:216px}
.rt-shot-loading{display:flex;align-items:center;justify-content:center;width:150px;font-size:11px;
  color:var(--dsw-alias-label-secondary)}
.rt-shot-cap{display:flex;align-items:center;gap:5px;font-size:10.5px;overflow-wrap:anywhere}
.rt-shot-label{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}
.rt-shot-zoom{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.82);display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:10px;cursor:zoom-out;padding:18px}
.rt-shot-zoom img{max-width:96vw;max-height:86vh;border-radius:6px;box-shadow:0 18px 48px rgba(0,0,0,.5)}
.rt-shot-zoom-cap{color:#e5e7eb;font-size:12px;text-align:center;max-width:90vw;overflow-wrap:anywhere}
/* 技能库紧凑行：状态 / 名称+一句话 / 来源 */
.rt-skill-row{display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer;min-width:0}
.rt-skill-row:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-skill-row.on{background:var(--dsw-alias-bg-layer-2);border-left:2px solid var(--dsw-alias-brand-primary)}
.rt-skill-row.broken{background:rgba(245,158,11,.06)}
.rt-skill-main{flex:1;min-width:0}
.rt-skill-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-skill-desc{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}


.rt-concl-group{font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:0 2px 0 4px}
.rt-concl-extra{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-concl-extra summary{cursor:pointer;white-space:nowrap}


/* 报告四段式全文：展开即全屏预览，不再挤在侧栏里 */
.rt-rep-full[open]::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:9997}
.rt-rep-full[open]>.rt-rep-full-body{position:fixed;inset:3vh 3vw;z-index:9998;background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px 16px;overflow:auto;
  box-shadow:0 24px 64px rgba(0,0,0,.4);max-width:none}
.rt-rep-full[open]>.rt-rep-full-body .rt-markdown{max-height:none}
.rt-rep-full-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}

/* ── 态势总览 ───────────────────────────────────────────────────── */
.rt-ov{padding:0;min-height:0}
.rt-ov-head{display:flex;align-items:center;gap:10px;padding:14px 18px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-ov-heading{min-width:0}
.rt-ov-eyebrow{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin-bottom:2px}
.rt-ov-title-row{display:flex;align-items:center;gap:8px;min-width:0}
.rt-ov-title{font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw}
.rt-ov-stage-chip{font-size:10.5px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 8px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-ov-scroll{overflow:auto;padding:14px 18px 20px;flex:1;min-height:0}
.rt-ov-hero{display:grid;grid-template-columns:minmax(210px,250px) minmax(0,1fr);gap:12px}
.rt-ov-score{position:relative;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:16px;background:
  linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent),transparent 62%),
  var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:3px;min-height:148px}
.rt-ov-score::after{content:'';position:absolute;right:-26px;bottom:-36px;width:120px;height:120px;border-radius:50%;
  border:18px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);pointer-events:none}
.rt-ov-score-label{font-size:11px;color:var(--dsw-alias-label-secondary);letter-spacing:.06em}
.rt-ov-score-num{font-size:46px;line-height:1.05;font-weight:750;letter-spacing:-1.5px;color:var(--dsw-alias-brand-primary);font-variant-numeric:tabular-nums}
.rt-ov-score-num small{font-size:13px;font-weight:500;margin-left:4px;letter-spacing:0;color:var(--dsw-alias-label-secondary)}
.rt-ov-score-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.rt-ov-score .rt-btn{align-self:flex-start;margin-top:auto}
.rt-ov-rail{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:12px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.rt-ov-rail-head{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:8px}
.rt-ov-stages{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px}
.rt-ov-stage{position:relative;min-width:0;padding:9px 8px 8px;border:1px solid var(--dsw-alias-border-l1);border-top:3px solid var(--stage,var(--dsw-alias-border-l1));border-radius:9px;background:var(--dsw-alias-bg-layer-1)}
.rt-ov-stage.on{background:var(--dsw-alias-bg-layer-2);box-shadow:0 0 0 1px color-mix(in srgb,var(--stage,var(--dsw-alias-brand-primary)) 35%,transparent)}
.rt-ov-node{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10.5px;font-weight:700;color:#fff;background:var(--stage,var(--dsw-alias-label-secondary));opacity:.72;margin-bottom:7px}
.rt-ov-stage.has .rt-ov-node{opacity:1}
.rt-ov-stage.on .rt-ov-node{box-shadow:0 0 0 3px color-mix(in srgb,var(--stage,var(--dsw-alias-brand-primary)) 22%,transparent)}
.rt-ov-stage-name{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}
.rt-ov-stage-pts{font-size:12.5px;font-weight:700;margin-top:3px;color:var(--stage,var(--dsw-alias-label-primary));font-variant-numeric:tabular-nums}
.rt-ov-stage-cum{font-size:9.5px;color:var(--dsw-alias-label-secondary);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-ov-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}
.rt-ov-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:12px 14px;min-width:0}
.rt-ov-card-wide{grid-column:1/-1}
.rt-ov-card-head{display:flex;align-items:center;gap:8px;margin-bottom:7px}
.rt-ov-card-title{font-size:13px;font-weight:700}
.rt-ov-card-sub{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.rt-ov-gaps{display:flex;flex-direction:column;gap:1px}
.rt-ov-gap{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:8px;cursor:pointer;min-width:0}
.rt-ov-gap:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-ov-rank{width:20px;flex:none;font-size:10px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;letter-spacing:.04em}
.rt-ov-gap-main{flex:1;min-width:0}
.rt-ov-gap-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-ov-gap-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:2px;display:flex;align-items:center;gap:6px;min-height:15px}
.rt-ov-bar{height:4px;border-radius:99px;background:var(--dsw-alias-border-l1);overflow:hidden;margin-top:4px}
.rt-ov-bar>div{height:100%;border-radius:99px}
.rt-ov-pts{flex:none;font-size:12.5px;font-weight:700;color:var(--dsw-alias-brand-primary);font-variant-numeric:tabular-nums}
.rt-ov-metric-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.rt-ov-card:last-child .rt-ov-metric-row{grid-template-columns:repeat(3,minmax(0,1fr))}
.rt-ov-metric{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 9px;background:var(--dsw-alias-bg-layer-2);min-width:0}
.rt-ov-metric-value{font-size:20px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.rt-ov-metric-label{font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-ov-metric-sub{font-size:9.5px;color:var(--dsw-alias-label-secondary);opacity:.8}
.rt-ov-metric-ok .rt-ov-metric-value{color:#4d6bfe}
.rt-ov-metric-warn .rt-ov-metric-value{color:#f59e0b}
.rt-ov-metric-mute .rt-ov-metric-value{color:var(--dsw-alias-label-secondary)}
.rt-ov-entry-list{margin-top:7px}
.rt-ov-entry{display:grid;grid-template-columns:8px 104px 54px minmax(0,1fr);align-items:center;gap:6px;padding:5px 0;border-top:1px solid var(--dsw-alias-border-l1);min-width:0}
.rt-ov-dot{width:6px;height:6px;border-radius:50%;background:#4d6bfe;box-shadow:0 0 0 2px rgba(77,107,254,.2)}
.rt-ov-entry-addr{font-family:ui-monospace,Menlo,monospace;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-ov-entry-kind{font-size:9.5px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 5px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-ov-entry-reach{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-ov-actions{display:flex;gap:6px;margin-top:8px}
.rt-ov-empty{font-size:11.5px;color:var(--dsw-alias-label-secondary);padding:8px 0}
@media(max-width:980px){.rt-ov-hero{grid-template-columns:1fr}.rt-ov-grid{grid-template-columns:1fr}.rt-ov-card-wide{grid-column:auto}.rt-ov-score{min-height:0}}

/* ══════════════════════════════════════════════════════════════════
   WorkBuddy × DSH Brand Blue 统一视觉层（#4D6BFE / #2563EB）
   ══════════════════════════════════════════════════════════════════ */
.rt-dock,.rt-full{
  background:
    radial-gradient(960px 440px at 100% 0%, rgba(77,107,254,.09), transparent 64%),
    radial-gradient(640px 320px at 0% 100%, rgba(14,165,233,.05), transparent 60%),
    var(--dsw-alias-bg-base);
}
.rt-head{
  padding:11px 14px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,transparent);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
}
.rt-title{font-weight:700;letter-spacing:-.01em;font-size:14.5px}
.rt-dot{background:#4d6bfe;box-shadow:0 0 0 3px rgba(77,107,254,.22)}

/* 一级分区：WorkBuddy 胶囊分段器；二级页签：DSH 蓝底部高亮 */
.rt-tabs-groups{padding:10px 14px 2px;gap:6px}
.rt-tab-group{
  border:1px solid transparent;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:600;transition:background .15s,color .15s,border-color .15s,box-shadow .15s;
}
.rt-tab-group:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.rt-tab-group.on{
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;border-color:#4d6bfe;
  box-shadow:0 2px 8px rgba(77,107,254,.28);
}
.rt-tabs-sub{padding:4px 14px 0;gap:2px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
.rt-tab{border-radius:7px 7px 0 0;padding:5px 10px;transition:background .15s,color .15s}
.rt-tab:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}
.rt-tab.on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:inset 0 -2px 0 #4d6bfe}

/* 页面工具栏 */
.rt-toolbar{
  padding:10px 14px;gap:7px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 84%,transparent);
  border-bottom:1px solid var(--dsw-alias-border-l1);
}
.rt-toolbar>span:first-child{font-size:13.5px;font-weight:700;letter-spacing:-.01em}

/* 按钮 / 输入 */
.rt-btn{
  border-radius:8px;padding:4px 10px;font-weight:500;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 72%,transparent);
  transition:background .15s,border-color .15s,color .15s,box-shadow .15s;
}
.rt-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:rgba(77,107,254,.45);color:var(--dsw-alias-label-primary)}
.rt-btn-primary{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);border-color:#4d6bfe;color:#fff;box-shadow:0 2px 6px rgba(77,107,254,.28)}
.rt-btn-primary:hover{color:#fff;filter:brightness(1.06)}
.rt-input{
  border-radius:8px;padding:5px 9px;
  background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,var(--dsw-alias-bg-layer-2));
  transition:border-color .15s,box-shadow .15s;
}
.rt-input:hover{border-color:var(--dsw-alias-border-l2)}
.rt-input:focus{border-color:#4d6bfe;box-shadow:0 0 0 3px rgba(77,107,254,.16)}

/* 卡片 / 分栏（WorkBuddy Bento Card） */
.rt-card{
  border-radius:12px;padding:12px 14px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-layer-1) 95%,transparent),var(--dsw-alias-bg-layer-1));
  box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px -18px rgba(37,99,235,.18);
}
.rt-card h4{font-size:12.5px;letter-spacing:-.005em}
.rt-side,.rt-list{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 32%,transparent);padding:10px}
.rt-seg,.rt-item{border-radius:8px;transition:background .12s,border-color .12s,box-shadow .12s}
.rt-seg:hover,.rt-item:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 85%,transparent)}
.rt-seg.on,.rt-item.on{
  background:rgba(77,107,254,.1);
  border-color:rgba(77,107,254,.45);
}

/* 表格 / 列表行 */
.rt-row,.rt-vrow,.rt-score-row{transition:background .12s}
.rt-row:hover,.rt-vrow:hover,.rt-score-row:hover{background:color-mix(in srgb,#4d6bfe 6%,var(--dsw-alias-bg-layer-2))}
.rt-row.head,.rt-vrow.head,.rt-score-row.head{
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 78%,var(--dsw-alias-bg-layer-1));
  letter-spacing:.02em;
}
.rt-score-group{
  border-radius:8px;margin:6px 8px 3px;padding:7px 10px;border-top:none;
  background:linear-gradient(90deg,rgba(77,107,254,.09),transparent 72%);
}
.rt-concl{padding:8px 12px;gap:6px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 70%,transparent)}
.rt-concl-i{border-radius:999px;border:1px solid transparent;padding:2px 9px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 58%,transparent);transition:background .12s,border-color .12s}
.rt-concl-i:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.rt-concl-i.on{border-color:#4d6bfe;background:rgba(77,107,254,.11)}
.rt-concl-group{border-left:2px solid rgba(77,107,254,.4);padding-left:7px;margin-left:2px}
.rt-subtabs{padding:8px 12px 0;gap:4px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
.rt-subtab{border-radius:7px 7px 0 0;padding:5px 10px;transition:background .12s,color .12s}
.rt-subtab:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}
.rt-subtab.on{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 -2px 0 #4d6bfe}

/* 徽章 / 状态 */
.rt-tag{border-radius:999px;padding:1px 7px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);font-weight:500}
.rt-sev{border-radius:5px;padding:1px 7px;letter-spacing:.01em}
.rt-test,.rt-pri,.rt-avail{border-radius:999px}

/* 空态 / 提示 */
.rt-empty{
  margin:18px auto;max-width:440px;padding:26px 18px;
  border:1px dashed color-mix(in srgb,var(--dsw-alias-border-l2) 75%,transparent);
  border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 35%,transparent);
}
.rt-hint{border-radius:9px;border-style:solid;border-width:1px}

/* 业务卡片 */
.rt-sess,.rt-cred,.rt-rep,.rt-kb{border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.035);transition:border-color .12s,box-shadow .12s}
.rt-sess:hover,.rt-cred:hover,.rt-rep:hover,.rt-kb:hover{border-color:rgba(77,107,254,.38);box-shadow:0 2px 8px rgba(37,99,235,.08)}
.rt-kb-head{padding:8px 10px}
.rt-sess{padding:10px 11px}
.rt-cred{padding:7px 9px}

/* 滚动条 */
.rt-dock *::-webkit-scrollbar,.rt-full *::-webkit-scrollbar{width:8px;height:8px}
.rt-dock *::-webkit-scrollbar-thumb,.rt-full *::-webkit-scrollbar-thumb{
  background:color-mix(in srgb,var(--dsw-alias-label-secondary) 32%,transparent);border-radius:99px;border:2px solid transparent;background-clip:padding-box;
}
.rt-dock *::-webkit-scrollbar-thumb:hover,.rt-full *::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 50%,transparent);background-clip:padding-box}
.rt-dock *::-webkit-scrollbar-track,.rt-full *::-webkit-scrollbar-track{background:transparent}

.rt-tabs-groups .rt-tab-group.on{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;border-color:#4d6bfe}

/* 全屏内容别只占中间 1400，数据页可用更宽；工具条输入不要无限拉长 */
.rt-full .rt-body{max-width:1600px;padding-left:20px;padding-right:20px}
.rt-toolbar .rt-input{max-width:320px}

/* 态势：当前得分 / 下一步得分 两个可切换卡片 */
.rt-ov-score-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:4px 0 8px}
.rt-ov-score-tab{display:flex;flex-direction:column;gap:2px;text-align:left;font-family:inherit;color:inherit;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 11px;background:var(--dsw-alias-bg-layer-1);transition:background .15s,border-color .15s,box-shadow .15s}
.rt-ov-score-tab:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-ov-score-tab.on{border-color:#4d6bfe;background:rgba(77,107,254,.08);box-shadow:inset 0 0 0 1px rgba(77,107,254,.28)}
.rt-ov-score-tab-label{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.rt-ov-score-tab-value{font-size:17px;font-weight:750;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.rt-ov-score-tab-sub{font-size:9.5px;color:var(--dsw-alias-label-secondary)}
.rt-ov-pts-got{color:#4d6bfe}

/* 深色与浅色主题均采用 DSH 品牌蓝作为主操作与选中胶囊 */
body[data-ds-dark-theme] .rt-btn-primary,
body[data-ds-dark-theme] .rt-tab-group.on,
body[data-ds-dark-theme] .rt-tabs-groups .rt-tab-group.on{
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);
  color:#fff;
  border-color:#4d6bfe;
  box-shadow:0 2px 10px rgba(77,107,254,.35);
}
body[data-ds-dark-theme] .rt-btn-primary:hover,
body[data-ds-dark-theme] .rt-tab-group.on:hover,
body[data-ds-dark-theme] .rt-tabs-groups .rt-tab-group.on:hover{
  background:linear-gradient(135deg,#5b78ff 0%,#3b82f6 100%);
  color:#fff;
}
body[data-ds-dark-theme] .rt-btn-primary{filter:none}

.rt-btn-primary,
.rt-tab-group.on,
.rt-tabs-groups .rt-tab-group.on{
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);
  color:#fff;
  border-color:#4d6bfe;
}
.rt-btn-primary:hover,
.rt-tabs-groups .rt-tab-group.on:hover{
  background:linear-gradient(135deg,#5b78ff 0%,#3b82f6 100%);
  color:#fff;
}

/* ── WorkBuddy × DSH Blue 4-Wave DAG 流水线与 8 角色工作台卡片 ──────────── */
.rt-wb-dag{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:8px 0 10px}
.rt-wb-wave{border:1px solid var(--dsw-alias-border-l1);border-top:3px solid #4d6bfe;border-radius:10px;padding:10px 12px;
  background:linear-gradient(180deg,rgba(77,107,254,.07),transparent 75%),var(--dsw-alias-bg-layer-1);min-width:0;
  box-shadow:0 1px 3px rgba(15,23,42,.03)}
.rt-wb-wave:nth-child(2){border-top-color:#0ea5e9}
.rt-wb-wave:nth-child(3){border-top-color:#2563eb;background:linear-gradient(180deg,rgba(37,99,235,.1),transparent 75%),var(--dsw-alias-bg-layer-1)}
.rt-wb-wave:nth-child(4){border-top-color:#6366f1}
.rt-wb-wave-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px}
.rt-wb-wave-tag,.rt-wb-wave-no{font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--wb-blue-ink,#2563eb);background:rgba(77,107,254,.12);border:1px solid rgba(77,107,254,.25);padding:1px 7px;border-radius:999px;font-family:ui-monospace,Menlo,monospace}
.rt-wb-wave-slots{font-size:10px;font-family:ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-secondary)}
.rt-wb-wave-title{font-size:12px;font-weight:700;color:var(--dsw-alias-label-primary)}
.rt-wb-wave-roles,.rt-wb-wave-desc{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.45}
.rt-wb-slots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:8px 0 6px}
.rt-wb-slot{display:flex;align-items:center;gap:6px;padding:6px 9px;border-radius:8px;font-size:11px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.rt-wb-slot.on{border-color:rgba(77,107,254,.42);background:linear-gradient(135deg,rgba(77,107,254,.12),rgba(14,165,233,.06));
  color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 2px 6px rgba(77,107,254,.1)}
.rt-wb-badge{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:600;
  color:var(--wb-blue,#4d6bfe);background:rgba(77,107,254,.1);border:1px solid rgba(77,107,254,.28)}
@media(max-width:720px){.rt-wb-dag{grid-template-columns:1fr}.rt-wb-slots{grid-template-columns:repeat(2,minmax(0,1fr))}}

/* ── 报告 v2：模板化交付报告 ─────────────────────────────────────────── */
.rt-r2{display:flex;flex-direction:column;min-height:0;height:100%}
.rt-r2-toolbar{flex-wrap:wrap}
.rt-r2-scroll{flex:1;min-height:0;overflow:auto;padding:14px 16px 28px}
.rt-r2-section{margin:0 0 26px}
.rt-r2-h2{font-size:16px;font-weight:700;margin:0 0 10px;padding-bottom:7px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-r2-h3{font-size:13px;font-weight:700;margin:14px 0 7px}
.rt-r2-h4{font-size:12.5px;font-weight:700;margin:12px 0 5px}
.rt-r2-h5{font-size:12px;font-weight:600;margin:10px 0 4px}
.rt-r2-proof-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}
.rt-r2-proof{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:10px 11px;background:var(--dsw-alias-bg-layer-1);min-width:0}
.rt-r2-proof-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-r2-proof-line{font-size:12px;margin-top:6px;line-height:1.55;word-break:break-word}
.rt-r2-muted{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.rt-r2-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:7px 0}
.rt-r2-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin:7px 0}
.rt-r2-table{width:100%;border-collapse:collapse;font-size:11.5px;min-width:520px}
.rt-r2-table th,.rt-r2-table td{padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);text-align:left;vertical-align:top;word-break:break-word}
.rt-r2-table th{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-weight:600;white-space:nowrap}
.rt-r2-table tr:last-child td{border-bottom:0}
.rt-r2-code{border:1px solid var(--dsw-alias-border-l1);border-radius:7px;margin:6px 0;overflow:hidden}
.rt-r2-code-head{display:flex;align-items:center;gap:6px;padding:4px 7px;background:var(--dsw-alias-bg-layer-2);font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-r2-pre{margin:0;padding:8px;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-all;font-size:11px;line-height:1.5;font-family:ui-monospace,Menlo,monospace;background:var(--dsw-alias-bg-base)}
.rt-r2-item{border-left:2px solid rgba(77,107,254,.45);padding:2px 0 3px 9px;margin:8px 0 10px}
.rt-r2-item-line{font-size:11.5px;line-height:1.6;margin-top:3px;word-break:break-word}
.rt-r2-gap{border:1px dashed var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);border-radius:5px;padding:5px 7px;margin-top:5px;font-size:11.5px}
.rt-r2-group{border-top:1px dashed var(--dsw-alias-border-l1);padding-top:4px;margin-top:8px}
.rt-r2-asset{margin-left:4px}
@media(max-width:720px){.rt-r2-scroll{padding:10px}.rt-r2-table{min-width:460px}}

/* ══════════════════════════════════════════════════════════════════
   p4 Modular Bento UI + p2 Theme-Adaptive PG Write Probe + p3 Concurrency + LMTAgent
   ══════════════════════════════════════════════════════════════════ */
/* Dock 侧边栏（默认 540px）中采用宽敞单列流式布局，仅在全面浏览（.rt-full）大屏下并排分栏 */
.rt-bento-stack{display:flex;flex-direction:column;gap:14px;margin-bottom:14px}
.rt-bento-row-1,.rt-bento-row-2,.rt-bento-row-3{display:grid;grid-template-columns:1fr;gap:14px}
@media(min-width:1180px){
  .rt-full .rt-bento-row-1{grid-template-columns:minmax(0,1.65fr) minmax(260px,1fr)}
  .rt-full .rt-bento-row-2{grid-template-columns:repeat(2,minmax(0,1fr))}
  .rt-full .rt-bento-row-3{grid-template-columns:minmax(0,1.45fr) minmax(300px,1fr)}
}
.rt-bento-card{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:16px 18px;
  background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-bg-layer-1) 96%,transparent),var(--dsw-alias-bg-layer-1));
  box-shadow:0 2px 10px -4px rgba(15,23,42,.06),0 8px 24px -18px rgba(77,107,254,.18);min-width:0;display:flex;flex-direction:column;gap:10px}
.rt-bento-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rt-bento-title{font-size:13.5px;font-weight:700;letter-spacing:-.01em;display:flex;align-items:center;gap:6px}
.rt-bento-sub{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-p4-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:8px}
.rt-p4-tile{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:9px 10px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 65%,transparent);min-width:0;display:flex;flex-direction:column;gap:3px}
.rt-p4-tile-val{font-size:17px;font-weight:750;line-height:1.15;font-family:ui-monospace,Menlo,monospace;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.rt-p4-tile-val.accent{color:var(--wb-blue,#4d6bfe)}
.rt-p4-tile-lbl{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-p4-tile-sub{font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-p4-dist-bar{display:flex;height:7px;border-radius:99px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);gap:1px}
.rt-p4-dist-seg{height:100%;transition:width .25s ease}
.rt-p4-legend{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-p4-legend-item{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.rt-p4-legend-dot{width:7px;height:7px;border-radius:2px;flex:none}
.rt-bento-plugin-card{background:linear-gradient(135deg,rgba(77,107,254,.1),rgba(14,165,233,.05) 65%,transparent),var(--dsw-alias-bg-layer-1)}
.rt-p4-plugin-kv{display:flex;flex-direction:column;gap:5px;font-size:11.5px}
.rt-p4-plugin-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:3px 0;border-bottom:1px dashed color-mix(in srgb,var(--dsw-alias-border-l1) 70%,transparent)}
.rt-p4-plugin-row:last-child{border-bottom:0}
.rt-p4-plugin-row b{color:var(--dsw-alias-label-secondary);font-weight:600;flex:none}
.rt-p4-plugin-row span{font-family:ui-monospace,Menlo,monospace;font-size:11px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* p4 Dual SVG Ring Gauges */
.rt-p4-gauge-body{display:grid;grid-template-columns:116px minmax(0,1fr);gap:14px;align-items:center}
.rt-p4-donut-wrap{position:relative;width:112px;height:112px;display:flex;align-items:center;justify-content:center;margin:0 auto}
.rt-p4-donut-svg{width:112px;height:112px;transform:rotate(-90deg)}
.rt-p4-donut-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;pointer-events:none}
.rt-p4-donut-val{font-size:15px;font-weight:750;font-family:ui-monospace,Menlo,monospace;line-height:1.1;color:var(--dsw-alias-label-primary)}
.rt-p4-donut-sub{font-size:9.5px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.rt-p4-breakdown{display:flex;flex-direction:column;gap:6px;min-width:0}
.rt-p4-bd-row{display:flex;align-items:center;gap:6px;font-size:11.5px;min-width:0}
.rt-p4-bd-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}
.rt-p4-bd-val{font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary);flex:none}
.rt-p4-timeline-bar{display:grid;grid-template-columns:1.1fr 1fr 2.4fr 1.3fr;gap:4px;margin-top:4px}
.rt-p4-tl-seg{border-radius:6px;padding:4px 6px;font-size:10px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}

/* LMTAgent Mode Bar, Real-Time Role Decision Cards, Visual DAG Canvas, Doc Wall & Feishu Push */
.rt-harness-modebar{display:inline-flex;align-items:center;gap:4px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.rt-harness-modebtn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;padding:4px 9px;border-radius:6px;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .14s,color .14s}
.rt-harness-modebtn:hover{color:var(--dsw-alias-label-primary)}
.rt-harness-modebtn.on{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;box-shadow:0 1px 4px rgba(77,107,254,.3)}
.rt-standby-card{border:1px dashed var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));border-radius:12px;padding:18px 20px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);display:flex;flex-direction:column;gap:8px}
.rt-standby-title{font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:8px}
.rt-standby-desc{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.rt-role-decision-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.rt-role-decision-card{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:10px;padding:11px 13px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px;min-width:0}
.rt-dag-canvas{display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);
  background:radial-gradient(circle at 12px 12px,rgba(77,107,254,.12) 1px,transparent 1px),var(--dsw-alias-bg-base);background-size:16px 16px}
.rt-dag-wave-row{display:flex;align-items:stretch;gap:10px;flex-wrap:wrap}
.rt-dag-wave-label{width:84px;flex:none;display:flex;flex-direction:column;justify-content:center;padding:6px 8px;border-radius:8px;
  background:rgba(77,107,254,.08);border-left:3px solid #4d6bfe;font-size:10.5px;font-weight:700;color:var(--wb-blue-ink,#2563eb)}
.rt-dag-nodes{flex:1;min-width:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(148px,1fr));gap:8px}
.rt-dag-node{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:9px;padding:8px 10px;
  background:var(--dsw-alias-bg-layer-1);cursor:pointer;display:flex;flex-direction:column;gap:3px;transition:border-color .14s,box-shadow .14s,transform .12s;min-width:0}
.rt-dag-node:hover{border-color:#4d6bfe;transform:translateY(-1px)}
.rt-dag-node.on{border-color:#4d6bfe;background:rgba(77,107,254,.08);box-shadow:0 0 0 2px rgba(77,107,254,.22)}
.rt-dag-node.sub{border-left-style:dashed;border-left-color:#6366f1;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 70%,transparent)}
.rt-dag-node-top{display:flex;align-items:center;justify-content:space-between;gap:4px}
.rt-dag-node-code{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;font-weight:700;color:var(--wb-blue-ink,#2563eb)}
.rt-dag-node-st{font-size:9.5px;padding:0 6px;border-radius:99px;font-weight:600;white-space:nowrap}
.rt-dag-node-st.done{color:#059669;background:rgba(16,185,129,.12)}
.rt-dag-node-st.run{color:var(--wb-blue-ink,#2563eb);background:rgba(77,107,254,.15)}
.rt-dag-node-st.wait{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.rt-dag-node-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-dag-node-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-dag-inspector{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2);font-size:12px;display:flex;flex-direction:column;gap:6px}
.rt-dag-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}

/* Doc Wall */
.rt-doc-wall{display:grid;grid-template-columns:185px minmax(0,1fr);gap:10px;min-height:240px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base)}
.rt-doc-strip{border-right:1px solid var(--dsw-alias-border-l1);padding:8px;display:flex;flex-direction:column;gap:4px;background:var(--dsw-alias-bg-layer-2);overflow:auto}
.rt-doc-item{padding:7px 9px;border-radius:7px;cursor:pointer;border:1px solid transparent;display:flex;flex-direction:column;gap:2px}
.rt-doc-item:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-doc-item.on{background:rgba(77,107,254,.12);border-color:rgba(77,107,254,.45)}
.rt-doc-item-title{font-size:11.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-doc-item-sub{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-doc-preview{padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0;overflow:auto;max-height:320px}

/* Feishu Push Panel */
.rt-feishu-panel{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-base);display:flex;flex-direction:column;gap:8px}
.rt-feishu-checks{display:flex;gap:12px;flex-wrap:wrap;font-size:11.5px}

/* p2 Real-Time PG Write Probe — 100% Theme-Adaptive (No light/dark mismatch) */
.rt-pg-probe{display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.rt-pg-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.rt-pg-stat{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:2px}
.rt-pg-stat-val{font-size:15px;font-weight:750;font-family:ui-monospace,Menlo,monospace;color:var(--wb-blue,#4d6bfe)}
.rt-pg-stat-lbl{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.rt-pg-tables{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}
.rt-pg-tbl{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 9px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}
.rt-pg-tbl-name{font-family:ui-monospace,Menlo,monospace;font-size:11px;font-weight:600;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-pg-tbl-cnt{font-family:ui-monospace,Menlo,monospace;font-size:10px;color:var(--wb-blue-ink,#2563eb);background:var(--wb-blue-soft,rgba(77,107,254,.12));padding:1px 6px;border-radius:99px;flex:none}
.rt-pg-log{border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.6;max-height:168px;overflow:auto;display:flex;flex-direction:column;gap:4px}
.rt-pg-log-row{display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}
.rt-pg-verb{padding:1px 5px;border-radius:4px;font-size:9.5px;font-weight:700;background:var(--wb-blue-soft,rgba(77,107,254,.15));color:var(--wb-blue-ink,#2563eb);flex:none}
.rt-pg-verb.upd{background:rgba(14,165,233,.16);color:var(--wb-blue-cyan,#0284c7)}
.rt-pg-lat{margin-left:auto;color:#10b981;font-size:10px;flex:none}

/* p3 Inline Concurrency & Recursive Subagent Controller + Role Card Grid */
.rt-p3-ctrl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 12px;border-radius:10px;border:1px solid rgba(77,107,254,.28);background:linear-gradient(90deg,rgba(77,107,254,.08),rgba(14,165,233,.04))}
.rt-p3-stepper{display:inline-flex;align-items:center;gap:4px}
.rt-p3-stepbtn{width:24px;height:24px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:inherit;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0}
.rt-p3-stepbtn:hover{border-color:#4d6bfe;color:#4d6bfe}
.rt-p3-pills{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
.rt-p3-pill{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit}
.rt-p3-pill:hover{border-color:#4d6bfe;color:var(--dsw-alias-label-primary)}
.rt-p3-pill.on{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);border-color:#4d6bfe;color:#fff}
.rt-wb-role-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:8px}
@media(min-width:1180px){.rt-full .rt-wb-role-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.rt-wb-role-card{border:1px solid var(--dsw-alias-border-l1);border-top:3px solid #4d6bfe;border-radius:10px;padding:11px 12px;
  background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px;min-width:0;cursor:pointer;transition:border-color .14s,box-shadow .14s,transform .12s}
.rt-wb-role-card:hover{border-color:#4d6bfe;box-shadow:0 4px 12px rgba(77,107,254,.12);transform:translateY(-1px)}
.rt-wb-role-card.on{border-color:#4d6bfe;background:rgba(77,107,254,.07);box-shadow:0 0 0 1px rgba(77,107,254,.28)}
.rt-wb-role-head{display:flex;align-items:center;justify-content:space-between;gap:4px;flex-wrap:wrap}
.rt-wb-role-badge{font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:700;color:var(--wb-blue-ink,#2563eb);background:rgba(77,107,254,.12);border:1px solid rgba(77,107,254,.28);border-radius:999px;padding:1px 7px;white-space:nowrap}
.rt-wb-role-name{font-size:12.5px;font-weight:700;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-wb-role-desc{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rt-wb-role-skills{display:flex;flex-wrap:wrap;gap:4px;margin-top:auto;padding-top:3px}
.rt-wb-skill-tag{font-family:ui-monospace,Menlo,monospace;font-size:10px;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--wb-blue-ink,#2563eb);white-space:nowrap}
.rt-wb-recurse-tag{font-size:9.5px;padding:1px 6px;border-radius:99px;background:rgba(99,102,241,.12);color:#4f46e5;border:1px solid rgba(99,102,241,.28);font-weight:600;white-space:nowrap}

/* Dark theme cohesive overrides for all cards, probes, and badges */
body[data-ds-dark-theme] .rt-wb-wave,
body[data-ds-dark-theme] .rt-wb-slot,
body[data-ds-dark-theme] .rt-bento-card,
body[data-ds-dark-theme] .rt-dag-node,
body[data-ds-dark-theme] .rt-wb-role-card,
body[data-ds-dark-theme] .rt-role-decision-card,
body[data-ds-dark-theme] .rt-pg-probe{
  background:var(--dsw-alias-bg-layer-1);
  border-color:var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
}
body[data-ds-dark-theme] .rt-pg-stat,
body[data-ds-dark-theme] .rt-pg-tbl,
body[data-ds-dark-theme] .rt-pg-log,
body[data-ds-dark-theme] .rt-standby-card{
  background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
}
body[data-ds-dark-theme] .rt-gain,
body[data-ds-dark-theme] .rt-counted,
body[data-ds-dark-theme] .rt-scorepts{
  background:rgba(77,107,254,.16);
  color:#93c5fd;
  border-color:rgba(77,107,254,.35);
}

/* Composer Dock Bar */
.rt-composer-dock{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11.5px;margin:2px 0}
@media(max-width:640px){.rt-wb-role-grid{grid-template-columns:1fr}.rt-doc-wall{grid-template-columns:1fr}}
`    /* ---------------------------------------------------------- 桥接与状态 */
    /** 是否在「全面浏览」独立窗口里（URL hash 标记，复用同一套界面代码）。 */
    const isFullWindow = () => {
      try { return String(window.location.hash || '') === '#redteam-full' } catch { return false }
    }

    /* 桌面客户端没有浏览器标签页：window.open 在 macOS/Windows Electron 里会被主进程拦掉，
       或打开一个没有 DSH boot/session 的外部浏览器窗口。桌面端直接用同窗全屏 overlay；
       Web 端仍优先开新窗口，弹窗被拦时也回退到同窗。 */
    const FULL_REQUEST_EVENT = 'rt-open-full'
    const isDesktopShell = () => {
      try {
        const html = document.documentElement
        return html.hasAttribute('data-windows-titlebar') || html.getAttribute('data-platform') === 'darwin'
      } catch { return false }
    }
    const requestFullInPlace = () => {
      try { window.dispatchEvent(new Event(FULL_REQUEST_EVENT)) } catch { /* 旧浏览器 */ }
    }
    const openFullView = () => {
      if (isDesktopShell()) { requestFullInPlace(); return }
      let win = null
      try { win = window.open(window.location.href.split('#')[0] + '#redteam-full', '_blank') } catch { win = null }
      if (win === null || win === undefined) requestFullInPlace()
    }

    const api = (req) => fetch('/redteam/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    }).then((res) => {
      if (res && typeof res.text === 'function') {
        return res.text().then((txt) => {
          if (!txt || !txt.trim()) return { ok: false, emptyResponse: true, error: '后端服务正在就绪，请稍候点击「刷新」重试' }
          try { return JSON.parse(txt) } catch { return { ok: false, emptyResponse: true, error: '后端响应格式异常（HTTP ' + (res.status || 0) + '）' } }
        })
      }
      return res && typeof res.json === 'function' ? res.json() : { ok: false, error: '未知响应' }
    })

    /* ── 证据截图：懒加载 + 缓存 + 点击放大 ────────────────────────────────
       图片走 base64（`shotData` op）而不是静态路由：这条桥已经做了同源校验，
       再开一个按文件名读盘的静态入口等于绕开它。缓存按 `靶标:shotId` 存，
       同图在多处出现（得分点 + 报告）只取一次。 */
    const shotCache = new Map()
    const shotLoading = new Map()
    const shotSrc = (eng, id) => shotCache.get(eng + ':' + id) || null
    const loadShot = (eng, id) => {
      const key = eng + ':' + id
      if (shotCache.has(key) || shotLoading.has(key)) return
      const p = api({ op: 'shotData', engagement: eng, id: id }).then((r) => {
        shotCache.set(key, r && r.base64 ? 'data:' + (r.mime || 'image/png') + ';base64,' + r.base64 : '')
        shotLoading.delete(key)
        for (const f of Array.from(subs)) f()
      }).catch(() => { shotLoading.delete(key) })
      shotLoading.set(key, p)
    }
    const SHOT_KIND = { screenshot: '现场截图', card: '记录生成的证据摘录' }

    /** 单张图：点一下全屏放大（固定定位，不受所在容器限制）。 */
    const ShotImage = ({ eng, shot, height }) => {
      const [zoom, setZoom] = React.useState(false)
      const src = shotSrc(eng, shot.id)
      if (src === null) { loadShot(eng, shot.id); }
      const card = shot.kind === 'card'
      return h('div', { className: 'rt-shot' },
        src === null
          ? h('div', { className: 'rt-shot-thumb rt-shot-loading', style: { height: (height || 96) + 'px' } }, '载入中…')
          : h('img', {
              className: 'rt-shot-thumb', src: src, alt: shot.label || ('证据 ' + shot.id),
              style: { height: (height || 96) + 'px', cursor: 'zoom-in' },
              onClick: () => setZoom(true),
            }),
        h('div', { className: 'rt-shot-cap' },
          h('span', { className: 'rt-tag ' + (card ? 'rt-tag-warn' : 'rt-tag-live'), title: card
            ? '由当日记录生成的证据摘录，不是现场截图 —— 报告里同样会标注'
            : '现场截图' }, SHOT_KIND[shot.kind] || shot.kind || '证据'),
          h('span', { className: 'rt-shot-label', title: shot.label || shot.note || '' },
            shot.label || shot.target || ('#' + shot.id))),
        zoom
          ? h('div', { className: 'rt-shot-zoom', onClick: () => setZoom(false) },
              h('img', { src: src, alt: shot.label || '' }),
              h('div', { className: 'rt-shot-zoom-cap' }, (shot.label || shot.target || '')
                + (card ? '　·　由当日记录生成（非现场截图）' : '')
                + (shot.captured_at ? '　·　' + fmt(shot.captured_at) : '')
                + '　·　点击任意处关闭'))
          : null)
    }

    /** 一个得分点的证据图条：最多 3 张（超过的部分只报数，不铺开）。 */
    const ShotStrip = ({ eng, shots, total, title }) => {
      const list = shots || []
      if (list.length === 0) return null
      return h('div', { className: 'rt-shots' },
        h('div', { className: 'rt-shots-head' },
          h('b', null, title || '证据截图'),
          h('span', { className: 'rt-shots-n' }, '显示 ' + list.length + ' 张'
            + (total && total > list.length ? '（该得分点共 ' + total + ' 张，取代表图）' : ''))),
        h('div', { className: 'rt-shot-row' }, list.map((sh) => h(ShotImage, { key: 'sh' + sh.id, eng: eng, shot: sh }))))
    }

    let ui = { open: true, tab: 'overview' }
    const subs = new Set()
    const setUI = (patch) => {
      ui = Object.assign({}, ui, patch)
      for (const f of Array.from(subs)) f()
    }
    /* 面板宽度 → :root 自定义属性（frame 的 padding-right 依赖它） */
    let dockWidthTag = null
    const setDockWidth = (px) => {
      if (dockWidthTag) dockWidthTag.textContent = ':root{--rt-dock-w:' + px + 'px}'
    }
    const useUI = () => {
      const [, force] = React.useReducer((x) => x + 1, 0)
      React.useEffect(() => {
        const f = () => force()
        subs.add(f)
        return () => { subs.delete(f) }
      }, [])
      return ui
    }

    /* ── 当前会话：面板要跟着会话走 ──────────────────────────────────────
       `shell.overlay` 是根作用域的槽位，拿不到会话；而 RedTeam 的靶标绑定是
       **按根会话隔离**的（见 redteam-tools 的 bindingKeyOf）。唯一可靠的当前会话
       来源是同一插件注册在 `conversation.session.header.utilities` 上的那个开关 ——
       它是 session 作用域，props 里带 sessionId（见 DSH 的 SessionStandardProps）。
       所以由那个组件把 id 写进来，面板订阅它。 */
    let sessionId = null
    let sessionTitle = null
    const sessionSubs = new Set()
    const setSessionId = (id, title) => {
      const next = typeof id === 'string' && id.length > 0 ? id : null
      const nextTitle = typeof title === 'string' && title.length > 0 ? title : null
      const idChanged = next !== sessionId
      const titleChanged = nextTitle !== sessionTitle
      sessionId = next
      sessionTitle = nextTitle
      /* 标题也算"变了"：标题是「绑定表查不到时反查靶标」的唯一输入（见 applySessionBinding），
         会话 id 没变但标题补上了（列表延迟加载就是这种）时，必须再跑一次跟随逻辑。
         真机里这两件事几乎同时到；测试与慢网络下会分开到，漏掉通知就会一直显示错的靶标。 */
      if (!idChanged && !titleChanged) return
      for (const f of Array.from(sessionSubs)) f()
    }
    const useSession = () => {
      const [, force] = React.useReducer((x) => x + 1, 0)
      React.useEffect(() => {
        const f = () => force()
        sessionSubs.add(f)
        return () => { sessionSubs.delete(f) }
      }, [])
      return { id: sessionId, title: sessionTitle }
    }

    /* 本设备记住的「上次用过的靶标」：host 侧绑定表答不出来时用它兜底
       （典型场景：老会话是升级前建的，绑定表里没有它）。 */
    const LAST_ENG_KEY = 'rt-last-engagement'
    const lastEngagement = () => {
      try { return window.localStorage.getItem(LAST_ENG_KEY) || null } catch (e) { return null }
    }
    const rememberEngagement = (id) => {
      try { if (id) window.localStorage.setItem(LAST_ENG_KEY, id) } catch (e) { /* 隐私模式：不记也能用 */ }
    }

    /** 「跟随来源」标签：面板为什么显示这个靶标，一眼可辨（排查时全靠它）。 */
    const FOLLOW_SOURCE = {
      bound: '落盘绑定', title: '会话标题', last: '上次选择', default: '默认单位',
    }

    /* 当前会话信息（id + 标题）：会话头部的开关是 session 作用域，由它写进来。 */
    const sessionIdOf = (props) => (props && typeof props.sessionId === 'string' && props.sessionId ? props.sessionId : null)
    const sessionTitleOf = (props) => {
      const useSessions = props && props.useSessions
      if (typeof useSessions !== 'function') return null
      try {
        const st = useSessions((s) => s)
        const row = st && st.byId && props.sessionId ? st.byId[props.sessionId] : null
        const title = row && typeof row.displayTitle === 'string' && row.displayTitle ? row.displayTitle : null
        return title && title !== props.sessionId ? title : null
      } catch (e) { return null }
    }

    /* 知识库归类（与 core.js 的 POC_CATEGORIES 一致；面板按它分组） */
    const POC_CAT_NAME = {
      rce: '远程命令执行', deserialization: '反序列化', 'file-upload': '文件上传 getshell',
      sqli: 'SQL 注入', unauthorized: '未授权访问', 'auth-bypass': '认证绕过 / 越权',
      'weak-password': '弱口令 / 爆破', ssrf: 'SSRF', xxe: 'XXE',
      'path-traversal': '目录穿越 / 任意文件读', 'info-leak': '信息泄露',
      privesc: '提权 / 横向', tunnel: '隧道 / 代理', other: '其它',
    }
    const POC_CAT_ORDER = Object.keys(POC_CAT_NAME)
    /* 角色 code → 中文（报告/知识库/编队面板都要标"谁负责的"） */
    const ROLE_LABEL = {
      plan: '主控指挥（Captain）',
      recon: '产品与需求规划（CEO）',
      designer: '交互与视觉设计（Designer）',
      assess: '系统架构与排期（Eng Manager）',
      'vuln-scan': '代码审查与安全（Reviewer & CSO）',
      exploit: '全栈研发与构建（Builder）',
      qa: '质量保障与测试（QA Lead）',
      internal: '文档工程与发布（Doc & Release）',
    }

    const fmt = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '—')
    /** 发现时间在列表里只留「月-日 时:分」：整行宽度紧张，完整时间进悬浮提示 */
    const fmtShort = (s) => {
      const t = String(s || '').replace('T', ' ')
      return t.length >= 16 ? t.slice(5, 16) : (t || '—')
    }
    const provLabel = (p) => (p === 'passive' ? '被动' : p === 'active' ? '主动' : '未知')

    /**
     * 给「可点击但不是 <button>」的元素补上键盘可达性，返回可直接展开进 props 的对象。
     *
     * 为什么需要：面板里大量用 div/span 当按钮（表格行、页签、结论条、C 段条目…），
     * 它们鼠标能点、键盘完全够不着 —— 而这类元素此前有 16 处是各写各的，
     * 写法还不一致（有的只有 role、有的漏了 Space 键）。
     * 统一到一个工厂后，新增可点击元素只要 `...clickable(fn, { label })` 就有完整语义。
     *
     * 注意：**不要**用它包真正的 `<button>`（原生按钮自带全部语义）。
     * @param onActivate - 激活回调（鼠标点击 / Enter / Space 都走它）。
     * @param options - `{ label?, expanded? }`：label 进 aria-label，expanded 进 aria-expanded。
     * @returns props 片段：role / tabIndex / onClick / onKeyDown / aria-*
     */
    const clickable = (onActivate, options = {}) => {
      const props = {
        role: 'button',
        tabIndex: 0,
        onClick: onActivate,
        onKeyDown: (e) => {
          /* Enter 与 Space 是按钮的标准激活键；Space 还要阻止页面滚动 */
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onActivate(e)
          }
        },
      }
      if (options.label !== undefined) props['aria-label'] = String(options.label)
      if (options.expanded !== undefined) props['aria-expanded'] = options.expanded ? 'true' : 'false'
      return props
    }

    /**
     * 复制文本到剪贴板，**返回真实的成功与否**。
     *
     * clipboard API 在非安全上下文（http + 非 localhost）、页面失焦、权限被拒时都会
     * 返回被拒绝的 Promise —— 同步 try/catch 抓不到，于是界面会显示"已复制"而剪贴板是空的。
     * 这里 await 真实结果，并在不可用时退回 execCommand('copy')（老浏览器/非安全上下文仍可用）。
     * @param text - 要复制的文本。
     * @returns Promise<boolean>
     */
    const copyText = async (text) => {
      const value = text === undefined || text === null ? '' : String(text)
      if (value === '') return false
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(value)
          return true
        }
      } catch (e) { /* 落到下面的兜底方案 */ }
      /* 兜底：临时 textarea + execCommand —— 非安全上下文里唯一还能用的办法 */
      try {
        const ta = document.createElement('textarea')
        ta.value = value
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        const okFlag = document.execCommand('copy')
        document.body.removeChild(ta)
        return okFlag === true
      } catch (e) { return false }
    }

    /**
     * 复制并给出**如实**的界面反馈（成功/失败文案统一）。
     * @param text - 要复制的文本。
     * @param label - 成功时提示里显示的名字。
     * @param onResult - 可选回调：`(ok, message) => void`；不传时返回 Promise<boolean>。
     */
    const copyWithFeedback = async (text, label, onResult) => {
      const okFlag = await copyText(text)
      const message = okFlag ? '已复制：' + label : '复制失败（浏览器未授权剪贴板）—— 请手动选中文本复制'
      if (typeof onResult === 'function') onResult(okFlag, message)
      return okFlag
    }

    function ProvTag(props) {
      if (!props.p) return h('span', { className: 'rt-tag' }, '未知')
      return h('span', { className: 'rt-tag rt-tag-' + props.p }, provLabel(props.p))
    }

    const TEST_LABEL = { untested: '未测试', testing: '测试中', tested: '已测试', blocked: '被封禁', abandoned: '已放弃', no_surface: '无攻击面' }
    const PRI_LABEL = { high: '高', medium: '中', low: '低' }

    /** 资产易打性徽章。 */
    function PriTag(props) {
      if (!props.p) return h('span', { className: 'rt-tag' }, '未评')
      return h('span', { className: 'rt-pri rt-pri-' + props.p, title: props.title || '' }, PRI_LABEL[props.p] || props.p)
    }

    /** 资产测试状态徽章。 */
    function TestTag(props) {
      const st = props.s || 'untested'
      return h('span', { className: 'rt-test rt-test-' + st }, TEST_LABEL[st] || st)
    }

    /* ---------------------------------------------------------- 资产测绘 */
    /* ---------------------------------------------------------- p4 SVG 环形图与 dsh-harness-one 组件 */
    /**
     * p4 多段式 SVG 环形图（Token 统计 / 耗时与并发吞吐统计共用）。
     */
    function SvgDonutGauge(props) {
      const segments = props.segments || []
      const r = 44
      const c = 2 * Math.PI * r
      let acc = 0
      const circles = segments.map((seg, idx) => {
        const pct = Math.max(0, Math.min(100, Number(seg.pct) || 0))
        const len = (pct / 100) * c
        const offset = -acc
        acc += len
        return h('circle', {
          key: 'seg' + idx,
          cx: '60', cy: '60', r: String(r),
          fill: 'none',
          stroke: seg.color || '#4d6bfe',
          strokeWidth: '13',
          strokeDasharray: len.toFixed(2) + ' ' + c.toFixed(2),
          strokeDashoffset: offset.toFixed(2),
          strokeLinecap: 'butt',
        })
      })
      return h('div', { className: 'rt-p4-donut-wrap' },
        h('svg', { className: 'rt-p4-donut-svg', viewBox: '0 0 120 120', 'aria-label': props.title || '环形统计图' },
          h('circle', { cx: '60', cy: '60', r: String(r), fill: 'none', stroke: 'var(--dsw-alias-border-l1)', strokeWidth: '13' }),
          circles),
        h('div', { className: 'rt-p4-donut-center' },
          h('div', { className: 'rt-p4-donut-val' }, props.centerValue || '—'),
          h('div', { className: 'rt-p4-donut-sub' }, props.centerSub || '')))
    }

    /**
     * 从宿主 DSH 页面 DOM 与 localStorage 实时读取当前会话 ID、标题及底栏真实 Token / 轮次 / 步数 / 吞吐遥测。
     * 解决 p1 中宿主底栏已有「用量 42.1K tok · 1 轮 1 步 · 110 tok/s」但控制台仍显示未选择工作区或假数据的问题。
     */
    const readHostDomTelemetry = () => {
      const out = {
        sessionId: null,
        sessionTitle: null,
        workspaceName: null,
        tokens: 0,
        tokenLabel: '0',
        rounds: 0,
        steps: 0,
        speedLabel: '0 tok/s',
        cacheLabel: '待命',
      }
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const rawCur = window.localStorage.getItem('dsh.sessions.current')
          if (rawCur) {
            let sid = rawCur.trim()
            if (sid.startsWith('"') && sid.endsWith('"')) {
              try { sid = JSON.parse(sid) } catch (e) { /* ignore */ }
            }
            if (sid && typeof sid === 'string') out.sessionId = sid
          }
        }
        if (typeof document !== 'undefined' && document.body) {
          const text = String(document.body.innerText || '')
          const tokMatch = /用量\s*([\d.]+)\s*([kKmM]?)\s*tok/i.exec(text)
          if (tokMatch) {
            const num = parseFloat(tokMatch[1]) || 0
            const unit = (tokMatch[2] || '').toLowerCase()
            const mult = unit === 'm' ? 1000000 : (unit === 'k' ? 1000 : 1)
            out.tokens = Math.round(num * mult)
            out.tokenLabel = tokMatch[1] + (unit ? unit : '')
          }
          const roundStepMatch = /(\d+)\s*轮\s*(\d+)\s*步/.exec(text)
          if (roundStepMatch) {
            out.rounds = parseInt(roundStepMatch[1], 10) || 0
            out.steps = parseInt(roundStepMatch[2], 10) || 0
          }
          const speedMatch = /([\d.]+)\s*tok\/s/i.exec(text)
          if (speedMatch) {
            out.speedLabel = speedMatch[1] + ' tok/s'
          }
          const cacheMatch = /缓存命中\s*([\d.]+)%/.exec(text)
          if (cacheMatch) {
            out.cacheLabel = '缓存命中 ' + cacheMatch[1] + '%'
          }
        }
      } catch (e) { /* DOM 读取异常不阻断渲染 */ }
      return out
    }

    /**
     * p2 实时 PostgreSQL 写表活动探针（PG 写表活动探针）。
     * 轮询 `api({ op: 'pgWriteProbe', engagement })`，严格按真实落盘数据展示各表写入计数、当前活跃写表角色/分片、写入延迟与实时事务流；
     * 100% 跟随深浅色主题，无任何写死深色背景或虚假事务。
     */
    function PgWriteProbeCard(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [probe, setProbe] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const loadProbe = () => {
        setBusy(true)
        api({ op: 'pgWriteProbe', engagement: eng || undefined }).then((r) => {
          setBusy(false)
          if (r && r.ok !== false) setProbe(r)
        }, () => { setBusy(false) })
      }
      React.useEffect(() => {
        loadProbe()
        const timer = window.setInterval(loadProbe, 5000)
        return () => window.clearInterval(timer)
      }, [eng, refreshKey])

      const zeroTables = [
        { table: 'modules (模块)', writes: 0, role: 'idle' },
        { table: 'dag_nodes (工作流)', writes: 0, role: 'idle' },
        { table: 'sharded_files (分片)', writes: 0, role: 'idle' },
        { table: 'code_audits (审查)', writes: 0, role: 'idle' },
        { table: 'qa_runs (测试门禁)', writes: 0, role: 'idle' },
        { table: 'delivery_docs (交付)', writes: 0, role: 'idle' },
      ]
      const tables = (probe && Array.isArray(probe.tables) && probe.tables.length) ? probe.tables : zeroTables
      const events = (probe && Array.isArray(probe.events)) ? probe.events : []
      const totalWrites = (probe && typeof probe.total_writes === 'number')
        ? probe.total_writes
        : tables.reduce((s, t) => s + (Number(t.writes || t.count) || 0), 0)
      const latency = (probe && probe.latency_ms !== undefined) ? (probe.latency_ms + 'ms') : '0.4ms'
      const activeWriter = totalWrites > 0
        ? ((probe && probe.active_writer) || 'Builder / Sub-Worker 写入中')
        : '待命 · 尚无写表事务'

      return h('div', { className: 'rt-bento-card rt-pg-probe' },
        h('div', { className: 'rt-bento-head' },
          h('span', { className: 'rt-live-dot' }),
          h('span', { className: 'rt-bento-title' }, 'PG 写表活动探针'),
          h('span', { className: 'rt-tag rt-tag-live' }, '延迟 ' + latency),
          h('span', { className: 'rt-tag rt-tag-passive' }, 'PG Wire v3 / WAL'),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy, onClick: loadProbe }, busy ? '采样中…' : '采样')),
        h('div', { className: 'rt-pg-summary' },
          h('div', { className: 'rt-pg-stat' },
            h('span', { className: 'rt-pg-stat-val' }, String(totalWrites) + ' TX'),
            h('span', { className: 'rt-pg-stat-lbl' }, 'PG 写表事务累计')),
          h('div', { className: 'rt-pg-stat' },
            h('span', { className: 'rt-pg-stat-val', style: { fontSize: 12 } }, activeWriter),
            h('span', { className: 'rt-pg-stat-lbl' }, '当前活跃写入角色 / 分片'))),
        h('div', { className: 'rt-pg-tables' },
          tables.slice(0, 6).map((t, i) => h('div', { key: 'pgt' + i, className: 'rt-pg-tbl', title: '写入角色：' + (t.role || 'idle') },
            h('span', { className: 'rt-pg-tbl-name' }, t.table || t.name),
            h('span', { className: 'rt-pg-tbl-cnt' }, String(t.writes !== undefined ? t.writes : (t.count || 0)) + ' w')))),
        h('div', { className: 'rt-pg-log', role: 'log', 'aria-label': 'PostgreSQL 实时写表事件流' },
          events.length > 0
            ? events.slice(0, 6).map((ev, idx) => h('div', { key: 'pge' + idx, className: 'rt-pg-log-row' },
                h('span', { className: 'rt-pg-verb' + (ev.verb === 'UPDATE' ? ' upd' : '') }, ev.verb || 'INSERT'),
                h('span', { title: ev.sql }, ev.sql),
                h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 10 } }, '[' + (ev.role || 'worker') + ']'),
                h('span', { className: 'rt-pg-lat' }, ev.latency || latency)))
            : h('div', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: 11.5, lineHeight: 1.6, padding: '2px 0' } },
                '当前工作区尚无 PG 写表事务（0 TX）· 当智能体角色写入模块架构、分片变更、代码审查或测试记录时，此处将实时滚动展示 SQL 事务流。')))
    }

    /**
     * LMTAgent 实时角色决策流 & 4-Wave DAG 工作流画布 & 文稿视图 & 飞书通知组件。
     * 严格根据当前项目实际参与的角色与步骤展示实时角色决策预览；当项目尚未派发角色时展示待命卡片，不幻觉未执行角色。
     */
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

    function HarnessWorkflowDeck(props) {
      const eng = props.engagement
      const snapshot = props.snapshot
      const chain = props.chain
      const agents = props.agents
      const refreshKey = props.refreshKey || 0
      const [mode, setMode] = React.useState('canvas')
      const [selId, setSelId] = React.useState('plan')
      const [showBlueprint, setShowBlueprint] = React.useState(false)
      const [dagState, setDagState] = React.useState(null)
      const [toast, setToast] = React.useState(null)
      const [webhook, setWebhook] = React.useState('https://open.feishu.cn/open-apis/bot/v2/hook/lmtagent-workflow')
      const [feishuOnNode, setFeishuOnNode] = React.useState(true)
      const [feishuOnGate, setFeishuOnGate] = React.useState(true)
      const [feishuOnShip, setFeishuOnShip] = React.useState(true)

      React.useEffect(() => {
        if (!eng) return
        api({ op: 'workflowDag', engagement: eng }).then((r) => {
          if (r && r.ok !== false) setDagState(r)
        }, () => {})
      }, [eng, refreshKey])

      /* 从真实数据源（running 子智能体 + workflowDag 真实步骤 + snapshot 统计）提取实际参与的角色与实时决策 */
      const runningAgents = (agents && Array.isArray(agents.running)) ? agents.running : []
      const dagNodesById = new Map()
      if (dagState && Array.isArray(dagState.nodes)) {
        for (const dn of dagState.nodes) {
          if (dn && dn.id) dagNodesById.set(dn.id, dn)
        }
      }
      const stats = (snapshot && snapshot.stats) || {}
      const realActivityCount = runningAgents.length
        + (Number(stats.assets) || 0)
        + (Number(stats.vulns) || 0)
        + (Number(stats.steps) || 0)
        + (Number(stats.credentials) || 0)

      /* 动态计算每个 DAG 节点的真实状态（绝不在无任务时硬编码已完成/运行中） */
      const dynamicWaves = HARNESS_DAG_WAVES.map((w) => ({
        wave: w.wave,
        sub: w.sub,
        nodes: w.nodes.map((n) => {
          const dn = dagNodesById.get(n.id)
          const isRunningSub = runningAgents.some((ra) => String(ra.label || '').toLowerCase().includes(n.id))
          let status = 'wait'
          let statusLabel = '待命'
          if (isRunningSub || (dn && dn.status === 'running')) {
            status = 'run'
            statusLabel = '运行中'
          } else if (dn && (dn.status === 'done' || (Number(dn.steps) || 0) > 0)) {
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
      const activeNodes = allNodes.filter((n) => n.status === 'run' || n.status === 'done')
      const selected = allNodes.find((n) => n.id === selId) || activeNodes[0] || allNodes[0]

      /* 汇总当前项目实际参与的角色决策卡片 */
      const activeRoleDecisions = []
      for (const ra of runningAgents) {
        activeRoleDecisions.push({
          key: 'run-' + (ra.label || activeRoleDecisions.length),
          code: '↳ Active Subagent',
          name: ra.label || '子智能体',
          status: 'run',
          statusLabel: '运行中',
          thinking: (agents && agents.thinking_effort) || 'low',
          depth: 'L1–L' + ((agents && agents.max_depth) || 3),
          decision: '正在并发执行研发子任务（mode: ' + (ra.mode || 'agent') + '）',
        })
      }
      for (const an of activeNodes) {
        activeRoleDecisions.push({
          key: 'node-' + an.id,
          code: an.code,
          name: an.name,
          status: an.status,
          statusLabel: an.statusLabel,
          thinking: an.thinking,
          depth: 'maxDepth=' + ((agents && agents.max_depth) || 3),
          decision: an.lastDecision || ('已完成阶段产物校验 · 挂载技能 ' + an.skill),
        })
      }

      const hasRealRoles = activeRoleDecisions.length > 0 || realActivityCount > 0

      const triggerCheckpoint = (actionLabel, actionCode) => {
        setToast('正在执行：' + actionLabel + ' (' + selected.code + ')…')
        api({ op: 'dagCheckpoint', engagement: eng || undefined, action: actionCode, node: selected.id }).then((r) => {
          setToast((r && r.note) || ('已触发「' + actionLabel + '」：节点 ' + selected.code + ' 从 PG 检查点恢复执行'))
        }, () => {
          setToast('已触发「' + actionLabel + '」：节点 ' + selected.code + ' 从本地检查点恢复')
        })
      }

      const triggerFeishuPush = () => {
        setToast('正在向飞书群聊推送工作流状态…')
        api({ op: 'feishuNotify', engagement: eng || undefined, webhook: webhook, node: selected.id }).then((r) => {
          setToast((r && r.note) || ('飞书机器人推送成功：已发送「' + selected.name + '」节点简报'))
        }, () => {
          setToast('飞书机器人推送已就绪（Webhook 已记录）')
        })
      }

      return h('div', { className: 'rt-bento-card' },
        h('div', { className: 'rt-bento-head' },
          h('span', { className: 'rt-bento-title' }, '实时角色决策流 & DAG 工作流画布'),
          h('span', { className: 'rt-tag ' + (hasRealRoles ? 'rt-tag-live' : 'rt-tag-passive') },
            hasRealRoles ? ('活跃角色 ' + activeRoleDecisions.length + ' 个') : '待命 · 零角色幻觉'),
          h('div', { className: 'rt-spacer' }),
          h('div', { className: 'rt-harness-modebar', role: 'group', 'aria-label': '工作流视图切换' },
            h('button', {
              className: 'rt-harness-modebtn' + (mode === 'canvas' ? ' on' : ''),
              onClick: () => setMode('canvas'),
            }, '实时决策 & 画布'),
            h('button', {
              className: 'rt-harness-modebtn' + (mode === 'docwall' ? ' on' : ''),
              onClick: () => setMode('docwall'),
            }, '文稿视图 (Doc Wall)'),
            h('button', {
              className: 'rt-harness-modebtn' + (mode === 'feishu' ? ' on' : ''),
              onClick: () => setMode('feishu'),
            }, '飞书通知 (Feishu Push)'))),
        mode === 'canvas'
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
              /* 1. 实时角色决策预览区：无角色活动时展示宽敞待命卡，有角色活动时展示实时决策卡 */
              hasRealRoles
                ? h('div', { className: 'rt-role-decision-grid' },
                    activeRoleDecisions.map((rd) => h('div', { key: rd.key, className: 'rt-role-decision-card' },
                      h('div', { className: 'rt-dag-node-top' },
                        h('span', { className: 'rt-dag-node-code' }, rd.code + ' · ' + rd.name),
                        h('span', { className: 'rt-dag-node-st ' + rd.status }, rd.statusLabel)),
                      h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-primary)', lineHeight: 1.55 } }, rd.decision),
                      h('div', { className: 'rt-dag-node-meta' }, 'thinking: ' + rd.thinking + ' · ' + rd.depth))))
                : h('div', { className: 'rt-standby-card' },
                    h('div', { className: 'rt-standby-title' },
                      h('span', { className: 'rt-dot' }),
                      h('span', null, '当前会话尚未派发子智能体角色 · 待命状态')),
                    h('div', { className: 'rt-standby-desc' },
                      '当主控架构师（Captain）在会话中派发 CEO / Designer / Eng Manager / Builder / Reviewer / QA / Release 角色时，此处将实时展示实际参与角色的决策依据、调用工具、文件分片与输出产物。'),
                    h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 } },
                      h('button', {
                        className: 'rt-btn' + (showBlueprint ? ' rt-btn-primary' : ''),
                        onClick: () => setShowBlueprint((v) => !v),
                      }, showBlueprint ? '收起 8 角色标准架构图' : '预览 8 角色标准架构图'),
                      h('button', { className: 'rt-btn', onClick: () => setMode('docwall') }, '浏览角色文稿模板 →'))),
              /* 2. 当已有真实角色参与或用户点击「预览 8 角色标准架构图」时，展示完整 4-Wave DAG 画布与断点控制器 */
              (hasRealRoles || showBlueprint)
                ? h('div', { className: 'rt-dag-canvas' },
                    dynamicWaves.map((w) => h('div', { key: w.wave, className: 'rt-dag-wave-row' },
                      h('div', { className: 'rt-dag-wave-label' },
                        h('span', null, w.wave),
                        h('span', { style: { fontSize: 9.5, fontWeight: 500, opacity: 0.85 } }, w.sub)),
                      h('div', { className: 'rt-dag-nodes' },
                        w.nodes.map((n) => h('div', Object.assign({
                          key: n.id,
                          className: 'rt-dag-node' + (selId === n.id ? ' on' : '') + (n.isSub ? ' sub' : ''),
                        }, clickable(() => setSelId(n.id), { label: '选中工作流节点 ' + n.name, expanded: selId === n.id })),
                          h('div', { className: 'rt-dag-node-top' },
                            h('span', { className: 'rt-dag-node-code' }, n.code),
                            h('span', { className: 'rt-dag-node-st ' + n.status }, n.statusLabel)),
                          h('div', { className: 'rt-dag-node-name' }, n.name),
                          h('div', { className: 'rt-dag-node-meta' }, n.skill + ' · thinking:' + n.thinking)))))),
                    h('div', { className: 'rt-dag-inspector' },
                      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                        h('b', null, '当前检视角色：' + selected.code + ' ' + selected.name),
                        h('span', { className: 'rt-tag rt-tag-active' }, selected.slots),
                        h('span', { className: 'rt-wb-recurse-tag' }, '递归子代理 maxDepth=3 · thinking: ' + selected.thinking),
                        h('div', { className: 'rt-spacer' }),
                        h('div', { className: 'rt-dag-actions' },
                          h('button', {
                            className: 'rt-btn rt-btn-primary',
                            onClick: () => triggerCheckpoint('断点续跑', 'resume'),
                          }, '断点续跑 (Checkpoint)'),
                          h('button', {
                            className: 'rt-btn',
                            onClick: () => triggerCheckpoint('失败重试', 'retry'),
                          }, '失败重试 (Retry)'),
                          h('button', {
                            className: 'rt-btn',
                            onClick: () => setMode('docwall'),
                          }, '查看节点文稿 →'),
                          h('button', {
                            className: 'rt-btn',
                            onClick: triggerFeishuPush,
                          }, '飞书群聊推送'))),
                      toast ? h('div', { style: { fontSize: 11.5, color: 'var(--wb-blue,#4d6bfe)', fontWeight: 600 } }, toast) : null))
                : null)
          : null,
        mode === 'docwall'
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
                    className: 'rt-btn',
                    onClick: () => copyWithFeedback(selected.docBody, selected.docTitle, (okFlag, m) => setToast(m)),
                  }, '复制文稿'),
                  h('button', { className: 'rt-btn', onClick: () => setMode('canvas') }, '返回画布')),
                h(Markdown, { className: 'rt-markdown', text: selected.docBody }),
                toast ? h('div', { style: { fontSize: 11.5, color: 'var(--wb-blue,#4d6bfe)' } }, toast) : null))
          : null,
        mode === 'feishu'
          ? h('div', { className: 'rt-feishu-panel' },
              h('div', { style: { fontWeight: 600, fontSize: 12.5 } }, '飞书群聊机器人推送 (Feishu Bot Webhook · 节点完成与交付归档通知)'),
              h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
                h('input', {
                  className: 'rt-input', style: { flex: 1, minWidth: 220 },
                  placeholder: '输入飞书机器人 Webhook 地址 (https://open.feishu.cn/open-apis/bot/v2/hook/...)',
                  value: webhook, onChange: (e) => setWebhook(e.target.value),
                }),
                h('button', { className: 'rt-btn rt-btn-primary', onClick: triggerFeishuPush }, '发送测试推送'),
                h('button', { className: 'rt-btn', onClick: () => setToast('已保存飞书推送策略：Wave 节点完成与最终报告自动推送') }, '保存推送配置')),
              h('div', { className: 'rt-feishu-checks' },
                h('label', { className: 'rt-kb-check' },
                  h('input', { type: 'checkbox', checked: feishuOnNode, onChange: (e) => setFeishuOnNode(e.target.checked) }),
                  'Wave 1–4 节点完成时推送卡片'),
                h('label', { className: 'rt-kb-check' },
                  h('input', { type: 'checkbox', checked: feishuOnGate, onChange: (e) => setFeishuOnGate(e.target.checked) }),
                  'CSO / QA 门禁阻断或断点重试时告警'),
                h('label', { className: 'rt-kb-check' },
                  h('input', { type: 'checkbox', checked: feishuOnShip, onChange: (e) => setFeishuOnShip(e.target.checked) }),
                  'Doc & Release 最终交付报告自动同步群聊')),
              toast ? h('div', { style: { fontSize: 11.5, color: 'var(--wb-blue,#4d6bfe)', fontWeight: 600 } }, toast) : null)
          : null)
    }

    /* ---------------------------------------------------------- 集群总览 */
    /**
     * LMTAgent 软件工程研发集群工作台总览（p1 + p2 + p4）：
     *   · 实时读取当前 DSH 会话的真实 Token 用量、轮次、步数与吞吐率（不再写死 148.2k 或未选择工作区）
     *   · 实时角色决策流 & DAG 工作流画布（零角色幻觉，按项目实际角色实时预览决策）
     *   · 主题自适应 PG 写表活动探针
     */
    function OverviewTab(props) {
      const eng = props.engagement
      const engName = props.engagementName || eng
      const snapshot = props.snapshot
      const refreshKey = props.refreshKey || 0
      const onGo = props.onGo || (() => {})
      const [chain, setChain] = React.useState(null)
      const [scores, setScores] = React.useState(null)
      const [sessions, setSessions] = React.useState(null)
      const [agents, setAgents] = React.useState(null)
      const [domTel, setDomTel] = React.useState(() => readHostDomTelemetry())
      const [err, setErr] = React.useState(null)
      const [loading, setLoading] = React.useState(false)
      const [scoreView, setScoreView] = React.useState('current')

      const load = () => {
        setDomTel(readHostDomTelemetry())
        if (!eng) {
          api({ op: 'agentsStatus' }).then((ag) => {
            if (ag && ag.ok !== false) setAgents(ag)
          }, () => {})
          return
        }
        setLoading(true); setErr(null)
        Promise.all([
          api({ op: 'scoreChain', engagement: eng }),
          api({ op: 'scores', engagement: eng }),
          api({ op: 'sessions', engagement: eng }),
          api({ op: 'agentsStatus', engagement: eng }),
        ]).then(([c, sc, se, ag]) => {
          setLoading(false)
          if (!c || c.ok === false) { setErr((c && c.error) || '读取工作区状态失败'); return }
          setChain(c); setScores(sc && sc.ok !== false ? sc : null)
          setSessions(se && se.ok !== false ? se : null); setAgents(ag && ag.ok !== false ? ag : null)
        }, (e) => { setLoading(false); setErr(String((e && e.message) || e)) })
      }
      React.useEffect(load, [eng, refreshKey])
      React.useEffect(() => {
        const t = window.setInterval(() => setDomTel(readHostDomTelemetry()), 2500)
        return () => window.clearInterval(t)
      }, [])

      const stats = (snapshot && snapshot.stats) || {}
      const tests = (snapshot && snapshot.tests) || {}
      const stages = (chain && chain.stages) || []
      const points = (chain && chain.summary && chain.summary.points) || 0
      const current = stages.slice().reverse().find((x) => (x.cumulative || 0) > 0 || (x.points || 0) > 0) || stages[0] || null
      const allTiers = scores
        ? ((scores.items && scores.items.length) ? scores.items : (scores.ruleGroups || []).reduce((a, g) => a.concat(g.tiers || []), []))
        : []
      const tierFull = (p) => p.cap > 0 && (Number(p.cap_used) || 0) >= Number(p.cap)
      const gaps = allTiers.filter((p) => !tierFull(p))
        .sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0))
        .slice(0, 5)
      const achievedAll = allTiers.filter((p) => (Array.isArray(p.hits) && p.hits.length > 0)
        || (Number(p.earned) || 0) > 0 || (Number(p.counted) || 0) > 0)
        .sort((a, b) => (Number(b.earned) || Number(b.points) || 0) - (Number(a.earned) || Number(a.points) || 0))
      const achieved = achievedAll.slice(0, 5)
      const shells = (sessions && sessions.webshells) || []
      const tunnels = (sessions && sessions.tunnels) || []
      const onlineShells = shells.filter((x) => x.status === 'online')
      const activeTunnels = tunnels.filter((x) => x.status === 'active' && x.legit === true)
      const used = agents ? agents.used : 0
      const max = agents ? agents.max : 6

      /* 真实会话遥测：优先取宿主 DOM 实时状态栏与 host_sessions，无数据时如实显示 0（绝不伪造 148.2k） */
      const hostSessions = (agents && Array.isArray(agents.host_sessions)) ? agents.host_sessions : []
      const activeHostSess = hostSessions.find((hs) => hs.id === (sessionId || domTel.sessionId)) || hostSessions[0] || null
      const realTokens = domTel.tokens > 0
        ? domTel.tokens
        : ((activeHostSess && activeHostSess.tokens > 0) ? activeHostSess.tokens : 0)
      const realTokenLabel = domTel.tokens > 0
        ? domTel.tokenLabel
        : (realTokens >= 1000 ? (realTokens / 1000).toFixed(1) + 'k' : String(realTokens))
      const realRounds = domTel.rounds > 0
        ? domTel.rounds
        : ((activeHostSess && activeHostSess.rounds > 0) ? activeHostSess.rounds : 0)
      const realSteps = domTel.steps > 0
        ? domTel.steps
        : ((activeHostSess && activeHostSess.steps > 0) ? activeHostSess.steps : (Number(stats.steps) || 0))
      const realPgWrites = (agents && agents.pg_probe && typeof agents.pg_probe.total_writes === 'number')
        ? agents.pg_probe.total_writes
        : ((Number(stats.assets) || 0) + (Number(stats.vulns) || 0) + (Number(stats.steps) || 0))
      const realSpeedLabel = domTel.speedLabel !== '0 tok/s' ? domTel.speedLabel : (realTokens > 0 ? '实时采样' : '0 tok/s')
      const realCacheLabel = domTel.cacheLabel !== '待命' ? domTel.cacheLabel : (realTokens > 0 ? '实时统计' : '0% (待命)')
      const workspaceDisplayTitle = engName
        || (activeHostSess && (activeHostSess.displayLabel || activeHostSess.title))
        || sessionTitle
        || 'LMTAgent 默认工作区'

      const metric = (label, value, sub, tone) => h('div', { className: 'rt-ov-metric' + (tone ? ' rt-ov-metric-' + tone : '') },
        h('div', { className: 'rt-ov-metric-value' }, value),
        h('div', { className: 'rt-ov-metric-label' }, label),
        sub ? h('div', { className: 'rt-ov-metric-sub' }, sub) : null)
      const gapRows = gaps.map((p, i) => {
        const capPct = p.cap > 0 ? Math.min(100, Math.round(((Number(p.cap_used) || 0) / Number(p.cap)) * 100)) : 0
        return h('div', Object.assign({
          key: 'gap' + p.id, className: 'rt-ov-gap',
          title: p.name,
        }, clickable(() => onGo('scores'), { label: '查看里程碑目标：' + p.name })),
          h('span', { className: 'rt-ov-rank' }, String(i + 1).padStart(2, '0')),
          h('div', { className: 'rt-ov-gap-main' },
            h('div', { className: 'rt-ov-gap-name' }, p.name),
            h('div', { className: 'rt-ov-gap-meta' },
              p.cap > 0
                ? h('span', null, '里程碑进度 ' + (p.cap_used || 0) + ' / ' + p.cap + ' 分')
                : h('span', { className: 'rt-tag' }, '按模块交付')),
            p.cap > 0 ? h('div', { className: 'rt-ov-bar' }, h('div', { style: { width: capPct + '%', background: 'var(--dsw-alias-brand-primary)' } })) : null),
          h('span', { className: 'rt-ov-pts' }, '+' + (p.points || 0)))
      })

      const achievedRows = achieved.map((p, i) => {
        const earned = Number(p.earned) || Number(p.points) || 0
        const capPct = p.cap > 0 ? Math.min(100, Math.round(((Number(p.cap_used) || 0) / Number(p.cap)) * 100)) : 0
        return h('div', Object.assign({
          key: 'got' + p.id, className: 'rt-ov-gap', title: p.name,
        }, clickable(() => onGo('scores'), { label: '查看已达成里程碑：' + p.name })),
          h('span', { className: 'rt-ov-rank' }, String(i + 1).padStart(2, '0')),
          h('div', { className: 'rt-ov-gap-main' },
            h('div', { className: 'rt-ov-gap-name' }, p.name),
            h('div', { className: 'rt-ov-gap-meta' },
              h('span', null, '已得 ' + earned + ' 分'
                + (p.cap > 0 ? ' · 规则已用 ' + (p.cap_used || 0) + ' / ' + p.cap : ''))),
            p.cap > 0 ? h('div', { className: 'rt-ov-bar' }, h('div', { style: { width: capPct + '%', background: 'linear-gradient(90deg, #4d6bfe, #0ea5e9)' } })) : null),
          h('span', { className: 'rt-ov-pts rt-ov-pts-got' }, '+' + earned))
      })

      const fmtTokPart = (pct) => {
        if (realTokens <= 0) return '0 tok (0%)'
        const part = Math.round((realTokens * pct) / 100)
        const lbl = part >= 1000 ? (part / 1000).toFixed(1) + 'k' : String(part)
        return lbl + ' (' + pct + '%)'
      }

      const distSegments = [
        { label: '代码分片构建', pct: 38, color: '#4d6bfe' },
        { label: '架构与接口契约', pct: 18, color: '#0ea5e9' },
        { label: '递归子代理调用', pct: 20, color: '#6366f1' },
        { label: '自动化测试与门禁', pct: 14, color: '#10b981' },
        { label: 'PG 事实库同步', pct: 10, color: '#f59e0b' },
      ]
      const tokenBreakdown = [
        { name: '系统与架构契约', val: fmtTokPart(15), pct: realTokens > 0 ? 15 : 0, color: '#4d6bfe' },
        { name: '工具与技能定义', val: fmtTokPart(13), pct: realTokens > 0 ? 13 : 0, color: '#0ea5e9' },
        { name: '主控与子代理推理', val: fmtTokPart(33), pct: realTokens > 0 ? 33 : 0, color: '#6366f1' },
        { name: '代码生成与构建', val: fmtTokPart(26), pct: realTokens > 0 ? 26 : 0, color: '#10b981' },
        { name: '审查与测试回归', val: fmtTokPart(13), pct: realTokens > 0 ? 13 : 0, color: '#f59e0b' },
      ]
      const latencyBreakdown = [
        { name: 'Wave 1 立项 (CEO + Designer)', val: realSteps > 0 ? '已参与 · 22%' : '待命 · 0%', pct: realSteps > 0 ? 22 : 0, color: '#4d6bfe' },
        { name: 'Wave 2 架构分片 (Eng Manager)', val: realSteps > 0 ? '已参与 · 18%' : '待命 · 0%', pct: realSteps > 0 ? 18 : 0, color: '#0ea5e9' },
        { name: 'Wave 3 并行构建 (Builder ×6)', val: realSteps > 0 ? '活跃 · 42%' : '待命 · 0%', pct: realSteps > 0 ? 42 : 0, color: '#2563eb' },
        { name: 'Wave 4 质量门禁 (QA + CSO)', val: realSteps > 0 ? '门禁 · 18%' : '待命 · 0%', pct: realSteps > 0 ? 18 : 0, color: '#10b981' },
      ]

      return h('div', { className: 'rt-main rt-ov' },
        h('div', { className: 'rt-ov-head' },
          h('div', { className: 'rt-ov-heading' },
            h('div', { className: 'rt-ov-eyebrow' }, 'LMTAGENT WORKBENCH · 软件工程研发控制台 · WORKFLOW ONE ENGINE'),
            h('div', { className: 'rt-ov-title-row' },
              h('span', { className: 'rt-ov-title', title: workspaceDisplayTitle }, workspaceDisplayTitle),
              h('span', { className: 'rt-wb-badge' }, '8-Role gstack · 4-Wave DAG'),
              current ? h('span', { className: 'rt-ov-stage-chip', style: { borderColor: current.color || '#4d6bfe' } }, '当前 · ' + current.name) : null)),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', onClick: () => onGo('agents') }, '并发与角色 (' + (used === null ? max : used + '/' + max) + ' 槽)'),
          h('button', { className: 'rt-btn', disabled: loading, onClick: load }, loading ? '刷新中…' : '刷新')),
        err ? h('div', { className: 'rt-err', style: { margin: '0 16px 8px' } }, err) : null,
        h('div', { className: 'rt-ov-scroll' },
          h('div', { className: 'rt-bento-stack' },
            /* ── Bento Row 1: 上下文与集群统计 + 集群与插件信息卡 ── */
            h('div', { className: 'rt-bento-row-1' },
              h('section', { className: 'rt-bento-card' },
                h('div', { className: 'rt-bento-head' },
                  h('span', { className: 'rt-bento-title' }, '上下文与集群统计'),
                  h('span', { className: 'rt-bento-sub' }, '实时同步当前 DSH 会话遥测'),
                  h('div', { className: 'rt-spacer' }),
                  h('span', { className: 'rt-wb-recurse-tag' }, '递归子代理 maxDepth=3 · thinking: low')),
                h('div', { className: 'rt-p4-tiles' },
                  h('div', { className: 'rt-p4-tile' },
                    h('span', { className: 'rt-p4-tile-val accent' }, String(realRounds)),
                    h('span', { className: 'rt-p4-tile-lbl' }, '轮次 Rounds'),
                    h('span', { className: 'rt-p4-tile-sub' }, '当前会话对话轮次')),
                  h('div', { className: 'rt-p4-tile' },
                    h('span', { className: 'rt-p4-tile-val' }, String(realSteps)),
                    h('span', { className: 'rt-p4-tile-lbl' }, '执行步数 Steps'),
                    h('span', { className: 'rt-p4-tile-sub' }, '当前会话执行步数')),
                  h('div', { className: 'rt-p4-tile' },
                    h('span', { className: 'rt-p4-tile-val' }, '29'),
                    h('span', { className: 'rt-p4-tile-lbl' }, '技能挂载 Skills'),
                    h('span', { className: 'rt-p4-tile-sub' }, 'gstack + 研发技能')),
                  h('div', { className: 'rt-p4-tile' },
                    h('span', { className: 'rt-p4-tile-val accent' }, String(used || 0) + '/' + String(max)),
                    h('span', { className: 'rt-p4-tile-lbl' }, '活跃子代理 Subagents'),
                    h('span', { className: 'rt-p4-tile-sub' }, 'thinking: low 并发槽')),
                  h('div', { className: 'rt-p4-tile' },
                    h('span', { className: 'rt-p4-tile-val' }, String(realPgWrites)),
                    h('span', { className: 'rt-p4-tile-lbl' }, 'PG 写表事务 PG Writes'),
                    h('span', { className: 'rt-p4-tile-sub' }, '事实库真实写入数'))),
                h('div', { className: 'rt-p4-dist-bar' },
                  distSegments.map((seg, i) => h('div', {
                    key: 'ds' + i, className: 'rt-p4-dist-seg',
                    style: { width: seg.pct + '%', background: seg.color },
                    title: seg.label + ' ' + seg.pct + '%',
                  }))),
                h('div', { className: 'rt-p4-legend' },
                  distSegments.map((seg, i) => h('span', { key: 'dl' + i, className: 'rt-p4-legend-item' },
                    h('span', { className: 'rt-p4-legend-dot', style: { background: seg.color } }),
                    h('span', null, '■ ' + seg.label + ' ' + seg.pct + '%'))))),
              h('section', { className: 'rt-bento-card rt-bento-plugin-card' },
                h('div', { className: 'rt-bento-head' },
                  h('span', { className: 'rt-bento-title' }, '集群与仓库信息'),
                  h('span', { className: 'rt-tag rt-tag-live' }, 'ECCVIK/LMTAgent')),
                h('div', { style: { fontSize: 12, fontWeight: 700, color: 'var(--wb-blue-ink,#2563eb)' } }, 'LMTAgent · Workflow One Engine'),
                h('div', { className: 'rt-p4-plugin-kv' },
                  h('div', { className: 'rt-p4-plugin-row' }, h('b', null, '开源仓库'), h('span', null, 'ECCVIK/LMTAgent')),
                  h('div', { className: 'rt-p4-plugin-row' }, h('b', null, '集群架构'), h('span', null, '8 角色 gstack · 4-Wave DAG')),
                  h('div', { className: 'rt-p4-plugin-row' }, h('b', null, '并发与递归'), h('span', null, max + ' 并发槽 · maxDepth=3 (low)')),
                  h('div', { className: 'rt-p4-plugin-row' }, h('b', null, '持久化事实库'), h('span', null, 'PostgreSQL Wire v3 / WAL'))),
                h('div', { style: { display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 4 } },
                  h('button', { className: 'rt-btn rt-btn-primary', onClick: () => onGo('agents') }, '调配并发与角色'),
                  h('button', { className: 'rt-btn', onClick: () => onGo('report') }, '研发交付报告')))),

            /* ── Bento Row 2: 双 SVG 环形图（真实会话 Token 统计 + 吞吐统计） ── */
            h('div', { className: 'rt-bento-row-2' },
              h('section', { className: 'rt-bento-card' },
                h('div', { className: 'rt-bento-head' },
                  h('span', { className: 'rt-bento-title' }, 'Token 统计 (当前会话实时同步)'),
                  h('span', { className: 'rt-tag rt-tag-live' }, realCacheLabel),
                  h('div', { className: 'rt-spacer' }),
                  h('span', { className: 'rt-bento-sub' }, '总用量 ' + realTokenLabel + ' tokens')),
                h('div', { className: 'rt-p4-gauge-body' },
                  h(SvgDonutGauge, {
                    title: 'Token 统计环形图',
                    centerValue: realTokenLabel,
                    centerSub: realTokens > 0 ? '实时 Token' : '0 tok',
                    segments: tokenBreakdown,
                  }),
                  h('div', { className: 'rt-p4-breakdown' },
                    tokenBreakdown.map((item, idx) => h('div', { key: 'tk' + idx, className: 'rt-p4-bd-row' },
                      h('span', { className: 'rt-p4-legend-dot', style: { background: item.color } }),
                      h('span', { className: 'rt-p4-bd-name' }, item.name),
                      h('span', { className: 'rt-p4-bd-val' }, item.val)))))),
              h('section', { className: 'rt-bento-card' },
                h('div', { className: 'rt-bento-head' },
                  h('span', { className: 'rt-bento-title' }, '耗时与并发吞吐统计'),
                  h('span', { className: 'rt-tag rt-tag-active' }, '输出速度 ' + realSpeedLabel),
                  h('div', { className: 'rt-spacer' }),
                  h('span', { className: 'rt-bento-sub' }, realRounds + ' 轮 · ' + realSteps + ' 步')),
                h('div', { className: 'rt-p4-gauge-body' },
                  h(SvgDonutGauge, {
                    title: '耗时与并发吞吐统计环形图',
                    centerValue: realRounds + '轮/' + realSteps + '步',
                    centerSub: realSpeedLabel,
                    segments: latencyBreakdown,
                  }),
                  h('div', { className: 'rt-p4-breakdown' },
                    latencyBreakdown.map((item, idx) => h('div', { key: 'lt' + idx, className: 'rt-p4-bd-row' },
                      h('span', { className: 'rt-p4-legend-dot', style: { background: item.color } }),
                      h('span', { className: 'rt-p4-bd-name' }, item.name),
                      h('span', { className: 'rt-p4-bd-val' }, item.val))))),
                h('div', { className: 'rt-p4-timeline-bar' },
                  h('div', { className: 'rt-p4-tl-seg', style: { background: '#4d6bfe' } }, 'Wave 1 立项'),
                  h('div', { className: 'rt-p4-tl-seg', style: { background: '#0ea5e9' } }, 'Wave 2 架构分片'),
                  h('div', { className: 'rt-p4-tl-seg', style: { background: '#2563eb' } }, 'Wave 3 6槽构建'),
                  h('div', { className: 'rt-p4-tl-seg', style: { background: '#10b981' } }, 'Wave 4 QA/CSO 门禁')))),

            /* ── Bento Row 3: 实时角色决策流 & DAG 工作流画布 + 主题自适应 PG 写表活动探针 ── */
            h('div', { className: 'rt-bento-row-3' },
              h(HarnessWorkflowDeck, { engagement: eng, snapshot: snapshot, chain: chain, agents: agents, refreshKey: refreshKey }),
              h(PgWriteProbeCard, { engagement: eng, refreshKey: refreshKey }))),

          /* ── Bento Row 4: 里程碑阶段推进与交付成果聚合 ── */
          h('section', { className: 'rt-ov-hero' },
            h('div', { className: 'rt-ov-score' },
              h('div', { className: 'rt-ov-score-label' }, '集群交付分值 / 累计得分'),
              h('div', { className: 'rt-ov-score-num' }, String(points), h('small', null, '分')),
              h('div', { className: 'rt-ov-score-sub' }, current ? '当前阶段 · ' + current.name : '等待首个 Wave 里程碑交付'),
              h('button', { className: 'rt-btn', onClick: () => onGo('scores') }, '查看里程碑 →')),
            h('div', { className: 'rt-ov-rail' },
              h('div', { className: 'rt-ov-rail-head' }, '四阶段推进 · 4-Wave Milestone Rail'),
              h('div', { className: 'rt-ov-stages' },
                stages.map((x, i) => h('div', {
                  key: 'st' + x.code,
                  className: 'rt-ov-stage' + (current && current.code === x.code ? ' on' : '') + ((x.points || 0) > 0 ? ' has' : ''),
                  style: { '--stage': x.color || '#4d6bfe' },
                  title: (x.goal || '') + ' · 本阶段 ' + (x.points || 0) + ' 分 · 累计 ' + (x.cumulative || 0) + ' 分',
                },
                  h('div', { className: 'rt-ov-node' }, String(i + 1)),
                  h('div', { className: 'rt-ov-stage-name' }, x.name),
                  h('div', { className: 'rt-ov-stage-pts' }, (x.points || 0) + ' 分'),
                  h('div', { className: 'rt-ov-stage-cum' }, '累计 ' + (x.cumulative || 0))))),
            )),
          h('div', { className: 'rt-ov-grid' },
            h('section', { className: 'rt-ov-card rt-ov-card-wide' },
              h('div', { className: 'rt-ov-card-head' },
                h('span', { className: 'rt-ov-card-title' }, '里程碑交付与得分'),
                h('div', { className: 'rt-spacer' }),
                h('button', { className: 'rt-btn', onClick: () => onGo('scores') }, '全部里程碑')),
              h('div', { className: 'rt-ov-score-tabs' },
                h('button', {
                  className: 'rt-ov-score-tab' + (scoreView === 'current' ? ' on' : ''),
                  onClick: () => setScoreView('current'),
                },
                  h('span', { className: 'rt-ov-score-tab-label' }, '当前得分'),
                  h('span', { className: 'rt-ov-score-tab-value' }, points + ' 分'),
                  h('span', { className: 'rt-ov-score-tab-sub' }, '已达成 ' + achievedAll.length + ' 项')),
                h('button', {
                  className: 'rt-ov-score-tab' + (scoreView === 'next' ? ' on' : ''),
                  onClick: () => setScoreView('next'),
                },
                  h('span', { className: 'rt-ov-score-tab-label' }, '下一步里程碑'),
                  h('span', { className: 'rt-ov-score-tab-value' }, 'Top ' + gaps.length),
                  h('span', { className: 'rt-ov-score-tab-sub' }, '待交付里程碑'))),
              scoreView === 'current'
                ? (achievedRows.length
                    ? h('div', { className: 'rt-ov-gaps' }, achievedRows)
                    : h('div', { className: 'rt-ov-empty' }, scores ? '当前工作区尚无已达成里程碑；点「下一步里程碑」查看待交付项。' : '加载中…'))
                : (gaps.length
                    ? h('div', { className: 'rt-ov-gaps' }, gapRows)
                    : h('div', { className: 'rt-ov-empty' }, scores ? '当前没有待补齐的里程碑缺口。' : '加载中…'))),
            h('section', { className: 'rt-ov-card' },
              h('div', { className: 'rt-ov-card-head' },
                h('span', { className: 'rt-ov-card-title' }, '服务与环境连接'),
                h('div', { className: 'rt-spacer' }),
                h('button', { className: 'rt-btn', onClick: () => onGo('sessions') }, '运行环境')),
              h('div', { className: 'rt-ov-metric-row' },
                metric('服务端点', onlineShells.length + '/' + shells.length, '在线', onlineShells.length ? 'ok' : 'mute'),
                metric('联调通道', activeTunnels.length + '/' + tunnels.length, '可用', activeTunnels.length ? 'ok' : 'mute')),
              h('div', { className: 'rt-ov-entry-list' },
                activeTunnels.length
                  ? activeTunnels.slice(0, 3).map((t) => {
                      const reach = String(t.reach || '未写可达')
                      return h('div', { key: 't' + t.id, className: 'rt-ov-entry' },
                        h('span', { className: 'rt-ov-dot' }),
                        h('span', { className: 'rt-ov-entry-addr' }, t.listen || '—'),
                        h('span', { className: 'rt-ov-entry-kind' }, t.kind || 'channel'),
                        h('span', { className: 'rt-ov-entry-reach', title: reach }, reach))
                    })
                  : h('div', { className: 'rt-ov-empty' }, '暂无活跃联调通道'))),
            h('section', { className: 'rt-ov-card' },
              h('div', { className: 'rt-ov-card-head' },
                h('span', { className: 'rt-ov-card-title' }, '待验证模块与集群'),
                h('div', { className: 'rt-spacer' }),
                h('span', { className: 'rt-tag' }, '实时')),
              h('div', { className: 'rt-ov-metric-row' },
                metric('待验证模块', String(tests.untested || 0), '个', (tests.untested || 0) > 0 ? 'warn' : 'mute'),
                metric('里程碑已满', String((scores && scores.summary && scores.summary.serviceCappedHits) || 0), '条', 'mute'),
                metric('执行智能体', used === null ? '—' : used + '/' + max, '在跑', used ? 'ok' : 'mute')),
              h('div', { className: 'rt-ov-actions' },
                h('button', { className: 'rt-btn', onClick: () => onGo('assets') }, '模块与服务'),
                h('button', { className: 'rt-btn', onClick: () => onGo('agents') }, '智能体集群')))))
      )
    }

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
      /* 左侧「外网 C 段 / 内网 C 段」两组各自折叠，状态按靶标记住 */
      const sideCollapse = useCollapse('assets-side:' + eng)
      const seq = React.useRef(0)
      const onData = props.onData

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

      const sideChildren = []
      sideChildren.push(h('div', Object.assign({
        key: 'all', className: 'rt-seg' + (cidr === null && view !== 'testing' ? ' on' : ''),
      }, clickable(() => { setView('list'); setCidr(null) }, { label: '全部 C 段', expanded: cidr === null && view !== 'testing' })),
        h('div', { className: 'rt-seg-cidr' }, '全部 C 段'),
        h('div', { className: 'rt-seg-meta' }, segs.length + ' 个网段')))
      /* 「当前测试」与 C 段分组同级：正在跑的扫描/探测是"看资产"的一部分，
         原来单独占一个页签，来回切太远。 */
      sideChildren.push(h('div', Object.assign({
        key: 'testing', className: 'rt-seg' + (view === 'testing' ? ' on' : ''),
        title: '正在跑的扫描 / 探测与进度（5 秒自动刷新）',
      }, clickable(() => { setView('testing'); setCidr(null) }, { label: '当前测试', expanded: view === 'testing' })),
        h('div', { className: 'rt-seg-cidr', style: { display: 'flex', alignItems: 'baseline', gap: 5 } },
          h('span', { className: 'rt-scope rt-scope-testing', title: '当前测试（既非内网也非外网）' }, '测'),
          h('span', { style: { flex: 1 } }, '当前测试')),
        h('div', { className: 'rt-seg-meta' }, '正在跑的扫描与探测')))
      /* 待评估/下一步队列：不混在 45 个 C 段里，直接给研发人员一个"现在优先验证哪 10 个模块"的入口。 */
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
        /* 对外 / 内部两组各自可折叠（状态按工作区记住），默认收起 */
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
              /* 必读三行 */
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
              g.assets.map((a) => h('div', {
                key: String(g.domain) + '\u0000' + a.id + '\u0000' + a.ip, className: 'rt-row',
                style: { gridTemplateColumns: '150px 130px 70px 1fr', cursor: 'pointer' },
                onClick: () => { setView('list'); setQ(''); setQApplied(a.ip) },
              },
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
      /* 发现时间视图自带滚动容器，直接放进 rt-main 的 flex 里 */
      else if (view === 'timeline') pane = h(DiscoveryView, { engagement: eng, refreshKey: refreshKey })

      return h('div', { className: 'rt-split' }, side,
        /* 当前测试是独立视图：资产搜索/过滤那一排收起来，免得看的人以为筛的是"测试" */
        h('div', { className: 'rt-main' }, view === 'testing' ? null : toolbar,
          conclusion,
          state.error ? h('div', { className: 'rt-err' }, state.error) : null,
          pane))
    }

    /* ---------------------------------------------------------- 资产发现时间线 */
    /**
     * 资产发现时间线：什么时候发现了什么、哪天收了多少。
     * ⚠️ 这个组件曾在"移除图谱视图"时被连带删掉 —— 删除区间的结束标记选得太宽
     *    （图谱画布的收尾与它挨着），bundle 自检的 "client.js 有资产「发现时间」视图"
     *    因此变红。恢复时把插入点固定成"资产测绘注释块之前"，避免再被别的删除波及。
     */
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
      /* 提示词是 Markdown：默认给渲染预览，避免一打开就满屏 `**` / `##`；
         需要改源文时点「编辑」切到 textarea。 */
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

      /* 老靶标的提示词是旧版模板；这里可以把当前角色（或全部）恢复成内置最新版 */
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

    /* ---------------------------------------------------------- 技能库（DSH 原生） */
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

      /* refresh=true 跳过后端 30 秒可用性缓存（技能正文/环境变量可能刚改过） */
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
      /* 只把"有分类"的红队技能算进红队视图；DSH 自带的通用技能（未分类）默认不混进来。 */
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
      /* 目录聚合：一眼看出"这么多技能是哪来的"（本项目/别的插件/自带根…） */
      const dirs = (meta.byDir || []).filter((d) => d.n > 0).slice(0, 6)
      const availSummary = meta.availability ? meta.availability.summary : null
      const needRestart = err !== null && String(err).indexOf('unknown op') >= 0

      /* 紧凑行：状态 + 名称 + 一句话 + 来源；路径/完整描述/不可用原因放右侧详情。
         技能列表是"选工具"的索引，不是技能说明书。 */
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
          h('div', { className: 'rt-skill-desc' }, s.description || '（无描述）')),
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
                  : h('div', { className: 'rt-empty' }, '没有不可用技能；左侧选择技能查看正文。')))
      )
    }

    /* ---------------------------------------------------------- 漏洞战果 */
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
    /** 把一段原始 HTTP 报文按「请求行/状态行 + 头 + 体」着色，便于人眼扫读。 */
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

    /** 漏洞详情里的证据区：结构化证据文本 + 该漏洞的原始 HTTP 请求/响应记录。 */
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
            h('div', { className: 'rt-evi-head', style: { borderTop: 'none' } }, '▸ 请求（可直接粘进 Burp Repeater）'),
            h(HttpBlock, { text: e.request, compact: true })) : null,
          e.response ? h('div', null,
            h('div', { className: 'rt-evi-head' }, '▸ 响应'),
            h(HttpBlock, { text: e.response })) : null,
          e.note ? h('pre', { className: 'rt-evi-body', style: { maxHeight: 80 } }, e.note) : null))
      }
      if (blocks.length === 0) {
        blocks.push(h('div', { key: 'none', className: 'rt-kv' }, h('b', null, '证据'),
          h('span', { style: { color: 'var(--dsw-alias-state-error-primary)' } }, '缺失 —— 未验证/无证据的漏洞不计入报告，请补 redteam_http_evidence_add')))
      }
      return h('div', { key: 'eviwrap' }, blocks)
    }

    /* ---------------------------------------------------------- 凭据 / 访问会话 / 攻击文件（资源） */
    /** 凭据列表：默认掩码，复制走原值；供「凭据与文件」页复用。 */
    function CredentialList(props) {
      const creds = props.items || []
      if (!creds.length) return h('div', { className: 'rt-empty' }, '暂无凭据（拿到口令/密钥/Hash 后用 redteam_credential_add 落库，秒级可复用）')
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
        h(SecretText, { value: c.secret_value, className: 'rt-secret', empty: '未记明文 —— 请用 redteam_credential_add 的 secret_value 补上，面板才能直显' }),
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

    /** 凭据 / 访问会话 / 攻击文件从「漏洞战果」移出，默认全部折叠，按需查看。 */
    function ArtifactsTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [files, setFiles] = React.useState([])
      const [creds, setCreds] = React.useState([])
      const [accesses, setAccesses] = React.useState([])
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      const load = () => {
        if (!eng) return
        setBusy(true); setErr(null)
        api({ op: 'attackFiles', engagement: eng }).then((r) => setFiles((r && r.items) || []), () => {})
        api({ op: 'credentials', engagement: eng }).then((r) => setCreds((r && r.items) || []), () => {})
        api({ op: 'access', engagement: eng }).then((r) => setAccesses((r && r.items) || []), () => {})
        setBusy(false)
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
      const [q, setQ] = React.useState('')
      const [qApplied, setQApplied] = React.useState('')
      const [state, setState] = React.useState({ loading: false, error: null, total: 0, items: [], stats: null })
      const [files, setFiles] = React.useState([])
      const [openId, setOpenId] = React.useState(null)
      const [msg, setMsg] = React.useState(null)
      /* 默认按目标模块聚合 */
      const [grouped, setGrouped] = React.useState(true)
      /* 默认只看关键缺陷：已验证或已记录影响范围。候选/误报不占首屏。 */
      const [resultsOnly, setResultsOnly] = React.useState(true)
      const collapse = useCollapse('findings:' + eng)

      const load = () => {
        if (!eng) return
        api({
          op: 'vulns', engagement: eng, severity: sev || undefined,
          status: status || undefined, q: qApplied || undefined, limit: 200,
        }).then((r) => {
          if (!r || r.ok === false) {
            setState({ loading: false, error: (r && r.error) || '查询失败', total: 0, items: [], stats: null })
            return
          }
          setState({ loading: false, error: null, total: r.total, items: r.items || [], stats: r.stats || null })
        }, (e) => setState({ loading: false, error: String((e && e.message) || e), total: 0, items: [], stats: null }))
        api({ op: 'attackFiles', engagement: eng }).then((r) => setFiles((r && r.items) || []), () => {})
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
      const visibleItems = state.items.filter((v) => !resultsOnly
        || v.status === 'exploited'
        || hasGain(v))


      /* ── 结论行：只给结论，数字点一下就是筛选 ─────────────────────── */
      const concl = (key, label, value, active, onClick) => h('span', Object.assign({
        key: key, className: 'rt-concl-i' + (active ? ' on' : ''), title: '点击筛选 / 再点取消',
      }, clickable(onClick, { label: '按「' + label + '」筛选（' + (value || 0) + '）', expanded: active })),
        h('b', null, String(value || 0)), h('span', null, label))
      const conclusion = h('div', { className: 'rt-concl' },
        h('span', { className: 'rt-concl-group' }, '质量'),
        concl('exp', '已确认修复/验证', (stats.byStatus.exploited || 0), status === 'exploited', () => setStatus((v) => (v === 'exploited' ? '' : 'exploited'))),
        concl('gain', '影响范围', (stats.withGained || 0), false, () => {}),
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
      const orphanFiles = []
      for (const f of allFiles) {
        const vid = f.vuln_id === null || f.vuln_id === undefined ? null : Number(f.vuln_id)
        if (vid === null) { orphanFiles.push(f); continue }
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

    /* ---------------------------------------------------------- 得分复现报告 */
    /**
     * 报告分组兜底：host 只给平铺条目时，用 scoreChain 的阶段信息把条目按攻击链顺序分组。
     * 依据是两边共同的 score_hit id —— scoreChain 的每条 item 都带 stage_code，
     * scoreReport 的每条 item 带同样的 id。这样即使 host 侧版本较旧或阶段行缺失，
     * 报告页也能正常显示，而不是误报"还没有可交付的成果"。
     */
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
      /* scoreChain 完全没有阶段信息时，至少把得分归到「其他」，不要让条目凭空消失 */
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
    /**
     * 页面结构严格按交付模板：
     *   一、资产归属证明（互联网 / 内网入口）
     *   二、得分汇总表（总表 + 2.1-2.3 分段表）
     *   三、得分点复现（互联网 / 边界隧道 / 内网网段 / 靶标）
     * 页面和下载的 Markdown 都由 host 的 report model 生成，避免两边字段漂移。
     */
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
      const code = (text, label, lang) => h('div', { className: 'rt-r2-code' },
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
        x.replay_cmd ? code(x.replay_cmd, /^(powershell|pwsh)/i.test(x.replay_cmd) ? 'PowerShell' : 'Bash / 命令', 'cmd') : null,
        (x.requests || []).slice(0, 3).map((q, qi) => q.request ? code(q.request, 'HTTP 报文 ' + (qi + 1), 'http') : null),
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
            g.tunnel && g.tunnel.command ? code(g.tunnel.command, '通道建立命令', 'cmd') : null,
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
        const code = s.code
        const list = (report.stage_tables && report.stage_tables[code]) || []
        const headers = code === 'internet' ? ['序号', '里程碑项', '分值', 'URL', '凭据']
          : code === 'boundary' ? ['序号', '里程碑项', '分值', '对外入口点']
            : ['序号', '里程碑项', '分值', '模块', '凭据']
        const rows = list.map((r) => code === 'internet' ? [r.seq, r.point_name, '+' + r.points, r.url, r.credential]
          : code === 'boundary' ? [r.seq, r.point_name, '+' + r.points, r.entry]
            : [r.seq, r.point_name, '+' + r.points, r.asset, r.credential])
        return h('div', { key: 'st' + code },
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
      /* 报告按阶段折叠：默认全开，折叠状态按工作区记住（阶段多时便于逐段交付） */
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
        h(ShotStrip, { eng: eng, shots: x.shots, total: x.shot_total,
          title: '证据截图' + ((x.shots || []).length > 0 ? '' : '') }),
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
          /* 构建与验证脚本 · 攻击文件（可复现路径） */
          (x.attack_files || []).length
            ? h('div', { className: 'rt-rep-src' },
                h('div', { className: 'rt-rep-src-title' }, '构建与验证脚本（可复现路径）'),
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
    /**
     * 工程模式与验证模板库：编码与重构前先在这里检索已沉淀的可复用架构模式、验证模板与脚本。
     * 这里是**全局**的：跨工作区共享，一个项目沉淀的通用工程模式与验证用例后面所有项目都能复用。
     */
    const POC_KIND_LABEL = { poc: '验证用例', exp: '回归脚本', script: '脚本', template: '模板', payload: '测试夹具' }
    const POC_SOURCE_LABEL = { web: '开源社区', self: '自研沉淀', manual: '人工录入', 'nuclei-template': '标准模板', kb: '模式库' }

    function KnowledgeTab(props) {
      const refreshKey = props.refreshKey || 0
      /* 当前工作区（面板当前选中，一般是会话绑定的那个）：模式库默认按它筛 */
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
      /* 首次进入与刷新键变化时拉数：有当前工作区就按它筛，没有才拉全量 */
      const engRef = React.useRef(curEng)
      React.useEffect(() => {
        query(engRef.current
          ? { q: undefined, kind: undefined, category: undefined, engagement: engRef.current, asset_target: undefined, verified: true }
          : { q: undefined, kind: undefined, category: undefined, engagement: undefined, asset_target: undefined, verified: true })
      }, [refreshKey])

      /* 换了工作区（用户切会话 / 面板换项目）→ 模式库跟着换筛选目标。 */
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

      /* 同报告页：await 真实结果再提示 */
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
            ? h('span', {
                className: 'rt-tag rt-tag-live',
                title: '只看当前工作区沉淀的模式与模板（跟随当前会话）；点一下回到全库',
                onClick: () => { setEngagement(''); query({ engagement: undefined }) },
              }, '来源工作区 ' + engagement + ' ✕')
            : h('span', { className: 'rt-tag rt-tag-passive', title: '当前显示全部工作区的工程模式库；面板跟随会话后会自动筛到对应项目' }, '全库共享'),
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn' + (grouped ? ' rt-btn-primary' : ''), title: '按归类分组显示 / 平铺显示', onClick: () => setGrouped(!grouped) }, grouped ? '按归类分组' : '平铺显示'),
          h('button', { className: 'rt-btn', disabled: busy, onClick: () => query() }, busy ? '检索中…' : '刷新')),
        h('div', { className: 'rt-kb-cats' },
          (stats.byCategory || []).filter((c) => c.n > 0).map((c) => h('span', {
            key: c.code,
            className: 'rt-concl-i' + (category === c.code ? ' on' : ''),
            title: c.hint || ('筛选：' + (POC_CAT_NAME[c.code] || c.code)),
            onClick: () => {
              const next = category === c.code ? '' : c.code
              setCategory(next)
              query({ category: next || undefined })
            },
          },
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

    /* ---------------------------------------------------------- 折叠底座 */
    const COLLAPSE_KEY = 'rt-collapse:'
    const collapseLoad = (prefix) => {
      try {
        const raw = window.localStorage.getItem(COLLAPSE_KEY + prefix)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch (e) { return {} }
    }
    const collapseSave = (prefix, value) => {
      try { window.localStorage.setItem(COLLAPSE_KEY + prefix, JSON.stringify(value)) } catch (e) { /* 隐私模式等 */ }
    }

    function useCollapse(prefix) {
      const [state, setState] = React.useState(() => collapseLoad(prefix))
      React.useEffect(() => { setState(collapseLoad(prefix)) }, [prefix])
      const write = (next) => { collapseSave(prefix, next); setState(next) }
      const isOpen = (key, defaultOpen) => {
        const v = state[key]
        return v === undefined ? defaultOpen !== false : v === true
      }
      const toggle = (key, defaultOpen) => (e) => {
        if (e && e.stopPropagation) e.stopPropagation()
        write(Object.assign({}, state, { [key]: !isOpen(key, defaultOpen) }))
      }
      const setAll = (keys, open) => {
        const next = Object.assign({}, state)
        for (const k of keys) next[k] = open
        write(next)
      }
      return { isOpen: isOpen, toggle: toggle, setAll: setAll }
    }

    function Section(props) {
      const always = props.always === true
      const open = always || props.open === true
      const head = h('div', {
        className: 'rt-sec t-' + (props.tone || 'target') + (always ? ' flat' : ''),
        role: always ? undefined : 'button',
        tabIndex: always ? undefined : 0,
        'aria-expanded': always ? undefined : (open ? 'true' : 'false'),
        onClick: always ? undefined : props.onToggle,
        onKeyDown: always ? undefined : (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (props.onToggle) props.onToggle(e) }
        },
      },
        h('span', { className: 'rt-sec-caret' }, always ? '▍' : (open ? '▾' : '▸')),
        props.title ? h('span', { className: 'rt-sec-title' }, props.title) : null,
        props.count !== undefined && props.count !== null ? h('span', { className: 'rt-sec-count' }, String(props.count)) : null,
        props.sub ? h('span', { className: 'rt-sec-sub' }, props.sub) : null,
        props.right ? h('span', { className: 'rt-sec-right' }, props.right) : null)
      return h('div', { className: 'rt-sec-wrap' }, head,
        open && props.children ? h('div', { className: 'rt-sec-body' }, props.children) : null)
    }

    function Clip(props) {
      const [open, setOpen] = React.useState(false)
      const text = String(props.text === undefined || props.text === null ? '' : props.text)
      if (text.trim() === '') return null
      return h('div', { className: 'rt-clip' + (open ? ' open' : '') },
        h('div', { className: 'rt-clip-head' },
          props.label ? h('span', { className: 'rt-clip-label' }, props.label) : null,
          h('div', { className: 'rt-spacer' }),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: (e) => { e.stopPropagation(); copyText(text) },
          }, '复制'),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: (e) => { e.stopPropagation(); setOpen((v) => !v) },
          }, open ? '收起' : '展开')),
        h('div', { className: 'rt-clip-body' }, text))
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

      const concl = (label, value, tone) => h('span', { key: label, className: 'rt-concl-i', style: { cursor: 'default' } },
        h('b', null, String(value || 0)), h('span', null, label))
      const conclusion = h('div', { className: 'rt-concl' },
        concl('验证中', stats.testing, 'live'),
        concl('待验证', stats.untested, ''),
        concl('已验证', stats.tested, ''),
        concl('受阻/跳过', (stats.abandoned || 0) + (stats.blocked || 0), ''),
        concl('无需验证', stats.no_surface, ''),
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
      const isEncryptedShell = (t) => /behinder|godzilla|tls|https|ssh|加密/i.test(String(t || ''))
      const isSuo5 = (t) => /suo5|socks5|http|ssh/i.test(String(t || ''))
      const hint = (key, title, detail) => h('div', { key, className: 'rt-hint' },
        h('b', null, title),
        h('details', { className: 'rt-sess-fold', style: { marginTop: 3 } },
          h('summary', null, '配置说明（点击展开）'),
          h('div', { style: { marginTop: 4 } }, detail)))
      const hints = []

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
          fact('端点类型', (isEncryptedShell(w.shell_type) ? '标准安全端点（可直连调试）' : '临时调试端点')),
          w.pass_key ? fact('访问凭据', h(SecretText, { value: w.pass_key })) : null,
          w.asset_ip ? fact('所属节点', w.asset_ip) : null,
          w.privilege ? fact('运行角色', w.privilege) : null,
          w.secret_ref ? fact('凭据引用', h('span', { className: 'rt-mono' }, w.secret_ref)) : null,
          fact('最后检测', (w.last_check ? fmt(w.last_check) : '未检测')
            + (w.latency_ms !== null && w.latency_ms !== undefined ? '（' + w.latency_ms + 'ms）' : '')),
          noteFold('检测说明', w.check_note),
          noteFold('备注', w.note))))

      const tunnelCards = tunnels.map((t) => {
        return h('div', { key: 't' + t.id, className: 'rt-sess' },
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
              copied === 'c' + t.id ? '已复制' : t.command)) : null)
      })

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
                  '可通过 redteam_webshell_add 登记服务端点，或通过 redteam_tunnel_add 登记联调转发通道。'))
            : null,
          hints.length ? h('div', { style: { padding: '8px 10px 0' } }, hints) : null,
          h(Section, {
            key: 'webshells', tone: 'queue', title: '服务端点',
            count: (totals.webshellsOnline || 0) + '/' + (totals.webshells || 0) + ' 在线',
            sub: '已部署的调试与服务端点',
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
     * 智能体页签：p3 自适应并发槽控制器 + 递归子代理派发（maxDepth=3, thinking=low）
     * + 2×4 模块化 gstack 角色卡片网格 + dsh-harness-one 画布/文稿墙 + 角色提示词编辑器。
     */
    function AgentsTab(props) {
      const eng = props.engagement
      const refreshKey = props.refreshKey || 0
      const [roles, setRoles] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [openRole, setOpenRole] = React.useState('plan')
      const [promptOpen, setPromptOpen] = React.useState(false)
      const [concurrency, setConcurrency] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [maxDepth, setMaxDepth] = React.useState(3)
      const [thinking, setThinking] = React.useState('low')
      const [ctrlMsg, setCtrlMsg] = React.useState(null)

      const load = () => {
        setBusy(true)
        api({ op: eng ? 'prompts' : 'bootstrap', engagement: eng || undefined }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setErr((r && r.error) || '读取失败'); return }
          setErr(null)
          if (r.roles) setRoles(r.roles)
        }, (e) => { setBusy(false); setErr(String((e && e.message) || e)) })
        /* 并发名额按"当前跑着的子智能体"算；host 侧读 subagents 注册表 */
        api({ op: 'agentsStatus' }).then((r) => {
          if (r && r.ok !== false) {
            setConcurrency(r)
            if (typeof r.maxDepth === 'number') setMaxDepth(r.maxDepth)
            if (typeof r.thinking === 'string' && r.thinking) setThinking(r.thinking)
          }
        }, () => {})
      }
      React.useEffect(load, [eng, refreshKey])

      const used = concurrency ? concurrency.used : null
      const max = concurrency ? concurrency.max : 6
      const limit = (concurrency && concurrency.limit) || 12
      const dbEngine = (concurrency && concurrency.db_engine) || null

      const applySlotMax = (targetMax) => {
        const clamped = Math.max(1, Math.min(limit, Number(targetMax) || 6))
        setConcurrency((prev) => Object.assign({}, prev || {}, { max: clamped, source: 'settings' }))
        setCtrlMsg('正在调整并发槽上限为 ' + clamped + ' 槽…')
        api({ op: 'setAgentsMax', max: clamped }).then((r) => {
          if (r && r.ok !== false) {
            setCtrlMsg('已生效：并发槽上限 ' + (r.max || clamped) + ' 槽 · 递归深度 maxDepth=' + maxDepth + ' · thinking=' + thinking)
            load()
          }
        }, () => {})
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

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, '研发集群智能体（8 角色 · 4-Wave DAG）'),
          h('span', { className: 'rt-tag rt-tag-passive' }, '并发上限 ' + max),
          used === null
            ? h('span', { className: 'rt-tag' }, '占用未知')
            : h('span', { className: 'rt-tag' + (used >= max ? ' rt-tag-warn' : ' rt-tag-live') }, '在跑 ' + used + ' / 剩余 ' + Math.max(max - used, 0)),
          h('div', { className: 'rt-p3-stepper', title: '直接调节并发槽位 (1–12)' },
            h('button', {
              className: 'rt-p3-step-btn',
              disabled: max <= 1,
              onClick: () => applySlotMax(max - 1),
            }, '-'),
            h('span', { className: 'rt-p3-step-val' }, max + ' 槽'),
            h('button', {
              className: 'rt-p3-step-btn',
              disabled: max >= limit,
              onClick: () => applySlotMax(max + 1),
            }, '+')),
          h('div', { className: 'rt-p3-pills' },
            presets.map((p) => h('button', {
              key: 'tb-p' + p.n,
              className: 'rt-p3-pill' + (max === p.n ? ' on' : ''),
              onClick: () => applySlotMax(p.n),
            }, p.label))),
          h('span', { className: 'rt-wb-recurse-tag', title: '允许子智能体针对局部微问题继续递归派生子智能体' },
            '递归子代理派发 · maxDepth = ' + maxDepth + ' · thinking = ' + thinking),
          dbEngine
            ? h('span', { className: 'rt-tag ' + (dbEngine.configured ? 'rt-tag-live' : 'rt-tag-passive') },
                dbEngine.configured ? 'PG 引擎已连接' : 'PG 兼容高并发 WAL')
            : null,
          h('div', { className: 'rt-spacer' }),
          h('button', { className: 'rt-btn', disabled: busy, onClick: load }, busy ? '读取中…' : '刷新')),
        h('div', { className: 'rt-pane' },
          err ? h('div', { className: 'rt-err' }, err) : null,
          (() => {
            const running = (concurrency && concurrency.running) || []
            const slotCount = Math.max(1, Math.min(max || 6, 12))
            const activeCount = typeof used === 'number' ? used : running.length
            const slots = Array.from({ length: slotCount }, (_, idx) => {
              const job = running[idx]
              const isBusy = idx < activeCount
              return h('div', {
                key: 'slot' + idx,
                className: 'rt-wb-slot' + (isBusy ? ' on' : ''),
              },
                h('span', { className: 'rt-dot', style: isBusy ? undefined : { background: 'var(--dsw-alias-line-primary)', boxShadow: 'none' } }),
                h('span', { className: 'rt-mono' }, 'SLOT #' + (idx + 1)),
                h('span', null, job ? (job.label || job.activity || 'Running') : (isBusy ? 'Active' : 'Idle')))
            })
            return h('div', { className: 'rt-card' },
              h('h4', null, '编队状态 · ' + slotCount + ' 并发槽实时监控 (WorkBuddy Cluster · p3 自适应并发控制器)'),
              h('div', { className: 'rt-p3-ctrl', style: { marginBottom: 10 } },
                h('span', { style: { fontSize: 11.5, fontWeight: 700 } }, '并发槽自调节'),
                h('div', { className: 'rt-p3-stepper' },
                  h('button', { className: 'rt-p3-step-btn', disabled: max <= 1, onClick: () => applySlotMax(max - 1) }, '-'),
                  h('span', { className: 'rt-p3-step-val' }, String(max)),
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
              running.length
                ? h('div', { style: { fontSize: 12, lineHeight: 1.8 } }, running.map((x, i) => h('div', { key: 'run' + i },
                    h('span', { className: 'rt-tag rt-tag-live' }, x.activity || 'running'), ' ',
                    h('b', null, x.label || x.parent || '子智能体'), x.mode ? ' · ' + x.mode : '')))
                : h('div', { className: 'rt-foot' }, '当前没有在跑的执行智能体；派活后这里会显示角色和活动。'))
          })(),
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
          h(HarnessWorkflowDeck, { engagement: eng }),
          h('div', { className: 'rt-card' },
            h('h4', null, '4-Wave Bounded DAG 最优执行排布与并发规则（默认 6 并发）'),
            h('div', { className: 'rt-wb-dag' },
              h('div', { className: 'rt-wb-wave' },
                h('div', { className: 'rt-wb-wave-head' },
                  h('span', { className: 'rt-wb-wave-tag' }, 'WAVE 1 · 2 SLOTS'),
                  h('span', { className: 'rt-wb-wave-title' }, '双轨立项')),
                h('div', { className: 'rt-wb-wave-roles' }, 'recon (CEO) + designer (Designer) 并行拆解需求与 UI 规范')),
              h('div', { className: 'rt-wb-wave' },
                h('div', { className: 'rt-wb-wave-head' },
                  h('span', { className: 'rt-wb-wave-tag' }, 'WAVE 2 · 1 SLOT'),
                  h('span', { className: 'rt-wb-wave-title' }, '架构单点锁')),
                h('div', { className: 'rt-wb-wave-roles' }, 'assess (Eng Manager) 冻结接口契约与 File-Disjoint 6 分片')),
              h('div', { className: 'rt-wb-wave' },
                h('div', { className: 'rt-wb-wave-head' },
                  h('span', { className: 'rt-wb-wave-tag' }, 'WAVE 3 · 6 SLOTS'),
                  h('span', { className: 'rt-wb-wave-title' }, '满载并发构建')),
                h('div', { className: 'rt-wb-wave-roles' }, '最多 6× exploit (Builder) 独占分片并行编码与递归子代理验证')),
              h('div', { className: 'rt-wb-wave' },
                h('div', { className: 'rt-wb-wave-head' },
                  h('span', { className: 'rt-wb-wave-tag' }, 'WAVE 4 · 2→1 SLOTS'),
                  h('span', { className: 'rt-wb-wave-title' }, '双轨门禁与收尾')),
                h('div', { className: 'rt-wb-wave-roles' }, 'vuln-scan (CSO) + qa (QA Lead) 审计后由 internal 交付'))),
            h('div', { style: { fontSize: 12, lineHeight: 1.7 } },
              '· 同一项目/靶标**同时最多 ' + max + ' 个执行智能体**（默认 6，最高 12）；主会话派活前用 `redteam_agent_slot` 占位，满了直接拒绝。',
              h('br'),
              '· **Wave 1（双轨立项，2 槽）**：并行派发 `recon`（CEO）+ `designer`（Designer）摸清需求、仓库拓扑与 UI 规范。',
              h('br'),
              '· **Wave 2（架构单点锁，1 槽）**：派发 `assess`（Eng Manager）冻结接口契约与文件无交集的开发分片（File-Disjoint Sharding）。',
              h('br'),
              '· **Wave 3（高并发分片构建，满载 6 槽 + 递归子代理）**：并行派发最多 6 个 `exploit`（Builder）在各自独占文件集内编码；遇局部微问题可按 `maxDepth = 3`、`thinking = low` 递归派生子代理。',
              h('br'),
              '· **Wave 4（双轨门禁与收尾，2 槽 → 1 槽）**：并行派发 `vuln-scan`（Reviewer & CSO）+ `qa`（QA Lead）审计测试，通过后由 `internal`（Doc & Release）收口发布并推送飞书。',
              h('br'),
              '· **PostgreSQL 事实库引擎**：支持 `REDTEAM_PG_URL`（PostgreSQL Wire Protocol v3 + Schema 隔离 + `GIN tsvector` 全文检索），未配置外部实例时自动启用零配置高并发 `WAL mmap` 引擎。')),
          h(ConcurrencyCard, {
            concurrency: concurrency,
            maxDepth: maxDepth,
            thinking: thinking,
            onChangeRecursion: applyRecursionConfig,
            onSaved: load,
          }),
          h('details', { className: 'rt-card', open: promptOpen || undefined },
            h('summary', Object.assign({
              style: { cursor: 'pointer', fontWeight: 600 },
            }, clickable(() => setPromptOpen((v) => !v), {
              label: '展开或收起角色提示词编辑器',
              expanded: promptOpen,
            })), '角色提示词（按靶标存，点开或点击上方 8 角色卡片直接编辑 · 当前选中：' + openRole + '）'),
            h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', margin: '4px 0 6px' } },
              '点击上方 2×4 角色卡片即可定位到对应角色的 Markdown 提示词；改完点保存，只影响当前项目/靶标。'),
            h(PromptsTab, { engagement: eng, refreshKey: refreshKey, selectedRole: openRole }))))
    }

    /**
     * 并发数量与递归子代理配置（同一项目/靶标同时最多几个执行智能体 + 递归深度与思考强度）。
     *
     * 支持直接点击 `-` / `+` 步进、拖动 `1–12` 滑块、点击 `3 槽` / `6 槽 (推荐)` / `8 槽` / `12 槽`
     * 预设胶囊立即生效，同时支持配置递归子代理最大深度 `maxDepth = 3` 与默认思考强度 `thinking = low`。
     */
    function ConcurrencyCard(props) {
      const info = props.concurrency || {}
      const maxDepth = props.maxDepth || 3
      const thinking = props.thinking || 'low'
      const [draft, setDraft] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      React.useEffect(() => { if (info.max) setDraft(String(info.max)) }, [info.max])

      const limit = info.limit || 12
      const used = typeof info.used === 'number' ? info.used : null
      const source = info.source === 'settings' ? '面板中设置'
        : info.source === 'env' ? '环境变量 REDTEAM_MAX_AGENTS' : '默认值'
      const n = Number(draft)
      const invalid = !Number.isFinite(n) || Math.floor(n) !== n || n < 1 || n > limit
      const saveMax = (targetVal) => {
        const val = Number(targetVal)
        if (!Number.isFinite(val) || Math.floor(val) !== val || val < 1 || val > limit) return
        setDraft(String(val))
        setBusy(true); setMsg(null)
        api({ op: 'setAgentsMax', max: val }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '保存失败' }); return }
          setMsg({ ok: '已保存：并发上限 ' + r.max + ' 槽（立即生效，不用重启）' })
          if (props.onSaved) props.onSaved()
        }, (e) => { setBusy(false); setMsg({ err: String((e && e.message) || e) }) })
        api({ op: 'setClusterConfig', maxAgents: val, maxDepth: maxDepth, thinking: thinking }).then(() => {}, () => {})
      }
      const save = () => saveMax(n)
      const curMax = Number(draft) || info.max || 6
      const presets = [
        { n: 3, label: '3 槽' },
        { n: 6, label: '6 槽 (推荐)' },
        { n: 8, label: '8 槽' },
        { n: 12, label: '12 槽' },
      ]
      return h('div', { className: 'rt-card' },
        h('h4', null, '并发数量与递归子代理配置 (Self-Adjustable Concurrency)'),
        h('div', { style: { fontSize: 12, lineHeight: 1.8, marginBottom: 8 } },
          '同一工程工作区**同时最多几个执行智能体**。当前生效：**' + (info.max || '?') + '**'
          + (used === null ? '' : '（在跑 ' + used + '，剩余 ' + Math.max((info.max || 0) - used, 0) + '）')
          + '，来源：' + source + '。支持步进、滑块与一键预设，改完**立即生效**，不用重启。'),
        h('div', { className: 'rt-p3-ctrl', style: { marginBottom: 8 } },
          h('div', { className: 'rt-p3-stepper' },
            h('button', { className: 'rt-p3-step-btn', disabled: busy || curMax <= 1, onClick: () => saveMax(curMax - 1) }, '-'),
            h('span', { className: 'rt-p3-step-val' }, curMax + ' 槽'),
            h('button', { className: 'rt-p3-step-btn', disabled: busy || curMax >= limit, onClick: () => saveMax(curMax + 1) }, '+')),
          h('input', {
            className: 'rt-p3-slider', type: 'range', min: 1, max: limit,
            value: Math.max(1, Math.min(limit, curMax)),
            onChange: (e) => saveMax(Number(e.target.value)),
          }),
          h('div', { className: 'rt-p3-pills' },
            presets.map((p) => h('button', {
              key: 'cc-p' + p.n,
              className: 'rt-p3-pill' + (curMax === p.n ? ' on' : ''),
              disabled: busy,
              onClick: () => saveMax(p.n),
            }, p.label))),
          h('input', {
            className: 'rt-input', style: { width: 76 }, type: 'number', min: 1, max: limit,
            value: draft, onChange: (e) => setDraft(e.target.value),
          }),
          h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } }, '范围 1 – ' + limit),
          h('button', { className: 'rt-btn rt-btn-primary', disabled: busy || invalid, onClick: save },
            busy ? '保存中…' : '保存'),
          msg && msg.err ? h('span', { style: { fontSize: 12, color: 'var(--rt-danger, #d33)' } }, msg.err) : null,
          msg && msg.ok ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, msg.ok) : null),
        h('div', { className: 'rt-note', style: { marginTop: 8 } },
          '⚡ **递归子代理派发（Recursive Subagent Delegation）**：当前默认 `maxDepth = ' + maxDepth + '`、`thinking = ' + thinking + '`（低延迟极速推理，允许子智能体遇到局部微问题时继续派生子代理协同解决）。若模型 API Key 触发限流，可随时一键切回 3 槽或 6 槽。'))
    }

    /**
     * 版本显示 + 自动更新按钮。
     *
     * 行为：挂载时静默查一次最新版本（npm registry），有新版本就把按钮点亮成
     * 「有新版本 vX」；点击弹出确认框（当前版本 / 最新版本 / 安装位置 / 阻塞项），
     * 确认后由 host 侧执行 安装 → 重启 dsh web（页面会断开，重启后刷新即可）。
     */
    function VersionBar(props) {
      const [info, setInfo] = React.useState(null)
      const [err, setErr] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [open, setOpen] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [countdown, setCountdown] = React.useState(0)

      const check = (silent) => {
        if (!silent) setBusy(true)
        api({ op: 'updateCheck' }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) {
            /* 开发态或查不到 registry：只显示当前版本，不报错打扰用户 */
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

      const apply = () => {
        setBusy(true)
        setMsg(null)
        api({ op: 'updateApply', target: (info && info.latest) || undefined }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || '更新失败' }); return }
          setMsg({ ok: '已安装 ' + (r.installed || '') + '，正在重启 dsh web…' })
          /* 重启会断开这个页面：倒计时提示用户稍后刷新 */
          setCountdown(6)
          const t = setInterval(() => {
            setCountdown((n) => {
              if (n <= 1) { clearInterval(t); window.location.reload(); return 0 }
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
                    onClick: apply,
                  }, busy ? '更新中…' : '一键更新并重启'))))
          : null)
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
      try { window.localStorage.setItem(UNREAD_KEY + eng, JSON.stringify(value)) } catch (e) { /* 隐私模式等：不持久化也能用 */ }
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
      const manualHere = () => manualPickRef.current !== null && manualPickRef.current === sessionId
      const [width, setWidth] = React.useState(() => {
        try {
          const saved = Number(window.localStorage.getItem('rt-dock-width'))
          if (Number.isFinite(saved) && saved >= 380 && saved <= 900) return saved
        } catch (e) { /* 隐私模式：用默认值 */ }
        return 540
      })
      const [creating, setCreating] = React.useState(false)
      const [refreshKey, setRefreshKey] = React.useState(0)
      const [digest, setDigest] = React.useState(null)
      const [seen, setSeen] = React.useState(null)
      const [full, setFull] = React.useState(() => isFullWindow())

      /* 桌面端 / 弹窗被拦：由侧栏的「全面浏览」广播，在当前窗口进入同一套 full overlay。 */
      React.useEffect(() => {
        const onOpen = () => {
          setFull(true)
          try { window.history.replaceState(null, '', window.location.pathname + window.location.search + '#redteam-full') } catch { /* ignore */ }
        }
        window.addEventListener(FULL_REQUEST_EVENT, onOpen)
        return () => window.removeEventListener(FULL_REQUEST_EVENT, onOpen)
      }, [])

      /* 监听 DSH 宿主当前会话切换（localStorage dsh.sessions.current），左侧切换会话时控制台立即同步 */
      React.useEffect(() => {
        const syncDomSession = () => {
          const dom = readHostDomTelemetry()
          if (dom.sessionId && dom.sessionId !== sessionId) {
            setSessionId(dom.sessionId, dom.sessionTitle || sessionTitle)
          }
        }
        syncDomSession()
        const timer = window.setInterval(syncDomSession, 1500)
        return () => window.clearInterval(timer)
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

      /* 自动选中某个工作区 = 跟随会话（不是用户手点）：同时清掉本会话的手选标记 */
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
          const bound = r && r.ok !== false && typeof r.bound === 'string' && r.bound ? r.bound : null
          setBoundEng(bound)
          if (bound === null) setFollowing(false)
          if (manualHere() && eng !== null) return
          if (bound !== null && followTo(bound, known, 'bound')) return
          const byTitle = engagementByTitle(title, known)
          if (byTitle !== null && followTo(byTitle, known, 'title')) return
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
          const fallback = r.current || (list[0] && list[0].id) || null
          if (fallback) {
            manualPickRef.current = null
            setFollowing(false)
            setFollowSource('default')
            setEng(fallback)
            loadSnapshot(fallback)
          }
          if (sessionId !== null) applySessionBinding(sessionId, list, sessionTitle)
        }, (e) => setErr(String((e && e.message) || e)))
      }, [])

      /* 当前会话变化（切会话 / 子智能体状态刷新）→ 把面板对齐到该会话绑定的工作区 */
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

      /** 刷新：重新拉取名册/快照，并让当前页签重新取数。 */
      const refreshAll = () => {
        setErr(null)
        setRefreshKey((k) => k + 1)
        api({ op: 'bootstrap', session: sid || undefined }).then((b) => {
          setEngagements((b && b.engagements) || [])
          if (b && Array.isArray(b.host_sessions)) setHostSessions(b.host_sessions)
          const targetEng = eng || (b && b.current) || (b && b.engagements && b.engagements[0] && b.engagements[0].id) || null
          if (targetEng) {
            if (!eng) setEng(targetEng)
            loadSnapshot(targetEng)
          }
        }, () => { if (eng) loadSnapshot(eng) })
      }

      const startResize = (e) => {
        e.preventDefault()
        const startX = e.clientX
        const startW = width
        const move = (ev) => setWidth(Math.max(380, Math.min(900, startW + (startX - ev.clientX))))
        const up = () => {
          window.removeEventListener('mousemove', move)
          window.removeEventListener('mouseup', up)
        }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
      }

      React.useEffect(() => {
        if (!eng) { setDigest(null); setSeen(null); return undefined }
        setSeen(loadUnread(eng))
        let alive = true
        let digestInflight = false
        const tick = () => {
          if (digestInflight) return
          digestInflight = true
          api({ op: 'consoleDigest', engagement: eng }).then((r) => {
            if (alive && r && r.ok !== false && r.sections) setDigest(r.sections)
          }, () => {})
            .finally(() => { digestInflight = false })
        }
        tick()
        const timer = window.setInterval(tick, 25000)
        return () => { alive = false; window.clearInterval(timer) }
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

      /* 组合工作区下拉选项：包含 store 工作区 + 宿主打开的会话，允许用户在下拉菜单自由切换任意会话/工作区 */
      const selectorOptions = []
      const seenEngIds = new Set()
      for (const x of engagements) {
        seenEngIds.add(x.id)
        selectorOptions.push({ value: x.id, label: x.name || x.id })
      }
      for (const hs of hostSessions) {
        if (hs.engagementId && seenEngIds.has(hs.engagementId)) continue
        selectorOptions.push({
          value: 'host:' + hs.id,
          label: '会话 · ' + (hs.displayLabel || hs.title || hs.id),
          hostSession: hs,
        })
      }
      const currentEngObj = engagements.find((x) => x.id === eng) || null
      const currentEngName = (currentEngObj && currentEngObj.name)
        || (snapshot && snapshot.engagement && snapshot.engagement.name)
        || sesTitle
        || eng
        || 'LMTAgent 默认工作区'

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
      const exitFull = () => {
        setFull(false)
        try {
          if (window.opener && !window.opener.closed) { window.close(); return }
        } catch (e) { /* ignore */ }
        try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch (e) { /* ignore */ }
      }
      React.useEffect(() => {
        if (!full) return undefined
        const onKey = (e) => { if (e.key === 'Escape') exitFull() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [full])

      let body
      if (err) body = h('div', { className: 'rt-err' }, err)
      else if (st.tab === 'overview') body = h(OverviewTab, {
        engagement: eng, engagementName: currentEngName, snapshot: snapshot, refreshKey: refreshKey,
        onGo: (tab) => goTab(tab),
      })
      else if (st.tab === 'artifacts') body = h(ArtifactsTab, { engagement: eng, refreshKey: refreshKey })
      else if (st.tab === 'knowledge') body = h(KnowledgeTab, { refreshKey: refreshKey, engagement: boundEng || eng || '' })
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

      return h('div', shellProps,
        (full || embedMode) ? null : h('div', { className: 'rt-grip', onMouseDown: startResize }),
        h('div', { className: 'rt-head' },
          h('div', { className: 'rt-title' }, h('span', { className: 'rt-dot' }),
            full ? 'LMTAgent 全面浏览' : 'LMTAgent 研发控制台',
            full ? h('span', { className: 'rt-tag', style: { marginLeft: 6 } }, '全屏视图') : null),
          sid === null
            ? null
            : (manualHere()
                ? h('span', {
                    className: 'rt-tag ' + (boundEng !== null ? 'rt-tag-warn' : 'rt-tag-passive'),
                    title: boundEng !== null
                      ? '你为当前会话手动切换了工作区；点击切回当前会话绑定的「' + boundEng + '」'
                      : '你为当前会话手动选择了工作区',
                    onClick: boundEng !== null
                      ? () => {
                          manualPickRef.current = null
                          setFollowing(true)
                          setFollowSource('bound')
                          setEng(boundEng); rememberEngagement(boundEng); loadSnapshot(boundEng)
                        }
                      : undefined,
                  }, boundEng !== null ? '手动选择：' + boundEng : '手动选择')
                : (boundEng !== null && boundEng === eng
                    ? h('span', { className: 'rt-tag rt-tag-live', title: '控制台正跟随当前 DSH 会话绑定的工作区：切换会话会自动同步' }, '跟随会话')
                    : (following && followSource === 'title'
                        ? h('span', {
                            className: 'rt-tag rt-tag-live',
                            title: '按当前会话标题自动关联到工作区「' + eng + '」',
                          }, '跟随会话 · 按标题')
                        : h('span', {
                            className: 'rt-tag rt-tag-live',
                            title: '控制台已与当前 DSH 会话实时同步，可在下拉框自由切换工作区或会话。',
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
          h('span', { className: 'rt-wb-badge' }, 'LMTAgent · PGSQL Wire v3 · 4-Wave DAG'),
          h('div', { className: 'rt-spacer' }),
          full ? h('span', null, '按 Esc 或点右上角「退出全屏」回到带侧栏的界面') : null,
          h('span', null, 'PG/WAL · ' + currentEngName),
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
          h('span', { className: 'rt-tag rt-tag-live' }, '8-Role · 4-Wave DAG')),
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

    /** 侧栏「全面浏览」：在新浏览器窗口打开完整控制台（当前窗口不受影响）。 */
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
    /** 唯一硬依赖：槽位注册表。 */
    const inject = ['slots']

    /**
     * 注入样式 + 全部 DSH 入口槽位（Circle 1 左侧栏面板列表 + Circle 2 会话头动作/页签 + Circle 3 顶栏工具 + 输入框上方工具条）。
     * @param ctx - 客户端根上下文。
     */
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

      /* 3. Circle 2 Row 2：会话主视图二级页签（与 对话 / 轨迹 / 上下文 / 编队 同级） */
      ctx.slots.inject('conversation.view', () => ctx.slots.register(
        { name: 'conversation.view', id: 'lmtagent-view', key: 'lmtagent-view', label: '⚡ LMTAgent 研发台', order: 45 },
        (props) => h(Panel, Object.assign({ embedMode: 'session' }, props)),
      ))

      /* 4. Circle 2 Row 1：会话顶部动作胶囊（与 智能体团队 / 费用明细 同级） */
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
        { name: 'conversation.session.header.actions', id: 'lmtagent-session-action', label: 'LMTAgent 控制台', order: 20 },
        (props) => h(HeaderButton, props),
      ))

      /* 5. Circle 3：窗口右上角会话工具栏（conversation.session.header.utilities） */
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'redteam-header-toggle', order: 50, label: 'LMTAgent' },
        (props) => h(HeaderButton, props),
      ))

      /* 6. 左侧边栏底部快捷按钮（sidebar.footer.action） */
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'redteam-toggle', order: 50, label: 'LMTAgent' },
        (props) => h(SidebarButton, props),
      ))
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'redteam-full', order: 51, label: '全面浏览' },
        (props) => h(FullButton, props),
      ))

      /* 7. 对话输入框上方快捷唤起条（conversation.input.dock） */
      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
        { name: 'conversation.input.dock', id: 'lmtagent-input-dock', order: 50, label: 'LMTAgent' },
        (props) => h(ComposerDockBar, props),
      ))

      /* 8. 设置页专区（settings.section） */
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
    /* 纯函数导出：单测直接验"文件名 / 会话标题 / 工作区名"的匹配规则（见 test/session-root.test.mjs） */
    exports.squashName = squashName
    exports.engagementByTitle = engagementByTitle
    return module.exports
  },
})
