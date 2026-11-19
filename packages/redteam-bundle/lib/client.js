
window.__ModuleLoader__.load({
  id: 'dsh-lmtagent',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const rawH = React.createElement

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

    const MD_RAW_TAGS = new Set(['pre', 'code', 'textarea', 'option', 'script', 'style'])
    const MD_RAW_CLASS = /(?:^|\s)(?:rt-mono|rt-rep-http|rt-atest-notes|rt-textarea)(?:\s|$)/

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

    function SecretText(props) {
      const value = String(props.value === undefined || props.value === null ? '' : props.value)
      const [shown, setShown] = React.useState(false)
      if (value === '') return h('span', { className: 'rt-secret-none' }, props.empty || t('未记录', 'Not recorded'))
      return h('span', {
        className: props.className || 'rt-mono',
        style: { display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: '100%' },
      },
        h('span', { style: { wordBreak: 'break-all' } }, shown ? value : '••••••••'),
        h('button', {
          className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
          onClick: (e) => { e.stopPropagation(); setShown((v) => !v) },
        }, shown ? t('隐藏', 'Hide') : t('显示', 'Show')))
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

    function Markdown(props) {
      const text = String(props.text === undefined || props.text === null ? '' : props.text)
      const lines = text.replace(/\r\n?/g, '\n').split('\n')
      const out = []
      let i = 0
      let key = 0
      while (i < lines.length) {
        const line = lines[i]
        if (line.trim() === '') { i += 1; continue }

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

    const squashName = (value) => String(value || '')
      .replace(/~([0-9a-fA-F]{4})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/[^0-9a-zA-Z\u4e00-\u9fff]+/g, '')
      .toLowerCase()

    const engagementByTitle = (title, list) => {
      const hay = squashName(title)
      if (hay.length < 3) return null
      const hits = (list || [])
        .map((x) => ({ x: x, key: squashName(x.name || x.id) }))
        .filter((h) => h.key.length >= 3 && (hay.includes(h.key) || h.key.includes(hay)))
        .sort((a, b) => b.key.length - a.key.length)
      return hits.length ? hits[0].x.id : null
    }

    const CLIENT_PLUGIN_VERSION = '1.1.0'
    const CSS = `
:root{
  --rt-dock-w:540px;
  --wb-blue:#4d6bfe;
  --wb-blue-soft:rgba(77,107,254,.12);
  --wb-blue-ink:#1e40af;
  --wb-blue-pill:#dbeafe;

  --rt-bg-card:var(--dsw-alias-bg-layer-1,#ffffff);
  --rt-bg-subtle:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#f1f5f9) 68%,transparent);
  --rt-border:var(--dsw-alias-border-l1,#e2e8f0);
  --rt-shadow-card:0 2px 10px -4px rgba(15,23,42,.06),0 8px 24px -18px rgba(77,107,254,.18);
}

body[data-ds-dark-theme]{
  --wb-blue:#5b78ff;
  --wb-blue-soft:rgba(91,120,255,.16);
  --wb-blue-ink:#93c5fd;
  --wb-blue-pill:rgba(77,107,254,.2);

  --rt-bg-card:var(--dsw-alias-bg-layer-1,#1e293b);
  --rt-bg-subtle:color-mix(in srgb,var(--dsw-alias-bg-layer-2,#273549) 75%,transparent);
  --rt-border:var(--dsw-alias-border-l1,rgba(148,163,184,.22));
  --rt-shadow-card:0 4px 14px rgba(0,0,0,.28);
}

div:has(> [data-shell-overlay] .rt-dock[data-open="1"])[data-details-collapsed],
div:has(> [data-shell-overlay] .rt-dock[data-open="1"])[data-rightbar-collapsed]{padding-right:min(var(--rt-dock-w),45vw)}
.rt-dock{position:fixed;top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px)));right:0;bottom:0;z-index:80;display:flex;flex-direction:column;
  background:radial-gradient(960px 440px at 100% 0%,rgba(77,107,254,.09),transparent 64%),radial-gradient(640px 320px at 0% 100%,rgba(14,165,233,.05),transparent 60%),var(--dsw-alias-bg-base);
  border-left:1px solid var(--dsw-alias-border-l1);
  box-shadow:-12px 0 32px rgba(15,23,42,.18);pointer-events:auto;color:var(--dsw-alias-label-primary);
  font-size:13px;line-height:1.5;transition:transform .18s ease,opacity .18s ease}
.rt-embed{flex:1;min-height:0;height:100%;width:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;overflow:hidden}

div:has(> [data-shell-overlay] .rt-dock[data-open="1"])[data-rightbar-fullscreen] .rt-dock{
  transform:translateX(100%);opacity:0;pointer-events:none}
.rt-grip{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:col-resize;background:transparent;z-index:2}
.rt-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 88%,transparent);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.rt-title{font-weight:700;font-size:14.5px;letter-spacing:-.01em;display:flex;align-items:center;gap:6px;white-space:nowrap}
.rt-dot{width:8px;height:8px;border-radius:50%;background:#4d6bfe;box-shadow:0 0 0 3px rgba(77,107,254,.22)}
.rt-spacer{flex:1}
.rt-btn{border:1px solid var(--dsw-alias-border-l1);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 72%,transparent);color:inherit;
  border-radius:8px;padding:4px 10px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;white-space:nowrap;
  transition:background .15s,border-color .15s,color .15s,box-shadow .15s}
.rt-btn:hover{background:var(--dsw-alias-bg-layer-2);border-color:rgba(77,107,254,.45);color:var(--dsw-alias-label-primary)}
.rt-btn:disabled{opacity:.5;cursor:default}
.rt-btn-primary{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);border-color:#4d6bfe;color:#fff;box-shadow:0 2px 6px rgba(77,107,254,.28)}
.rt-btn-primary:hover{background:linear-gradient(135deg,#5b78ff 0%,#3b82f6 100%);color:#fff;filter:brightness(1.06)}
.rt-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-tabs-groups{border-bottom:none;padding:10px 14px 2px;gap:6px}
.rt-tab-group{border:1px solid transparent;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:600;transition:background .15s,color .15s,border-color .15s,box-shadow .15s}
.rt-tabs-groups .rt-tab-group{font-size:12px;padding:4px 10px;color:var(--dsw-alias-label-secondary)}
.rt-tab-group:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.rt-tab-group.on,.rt-tabs-groups .rt-tab-group.on{
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;border-color:#4d6bfe;
  box-shadow:0 2px 8px rgba(77,107,254,.28)}
.rt-tabs-sub{padding:4px 14px 0;gap:2px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
.rt-tab{padding:5px 10px;border-radius:7px 7px 0 0;cursor:pointer;font-size:12.5px;color:var(--dsw-alias-label-secondary);
  display:inline-flex;align-items:center;gap:5px;transition:background .15s,color .15s}
.rt-tab:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}
.rt-tab.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font-weight:600;box-shadow:inset 0 -2px 0 #4d6bfe}
.rt-tab-dot{width:7px;height:7px;border-radius:50%;background:#ef4444;flex:none;
  box-shadow:0 0 0 2px color-mix(in srgb, #ef4444 22%, transparent)}
.rt-body{flex:1;min-height:0;display:flex;flex-direction:column}
.rt-split{flex:1;min-height:0;display:flex}
.rt-side{width:200px;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:10px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 32%,transparent)}
.rt-main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden}
.rt-toolbar{display:flex;gap:7px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap;align-items:center;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 84%,transparent)}
.rt-toolbar>span:first-child{font-size:13.5px;font-weight:700;letter-spacing:-.01em}
.rt-toolbar .rt-input{max-width:320px}
.rt-input{background:color-mix(in srgb,var(--dsw-alias-bg-base) 55%,var(--dsw-alias-bg-layer-2));border:1px solid var(--dsw-alias-border-l1);color:inherit;
  border-radius:8px;padding:5px 9px;font-size:12px;font-family:inherit;outline:none;min-width:0;transition:border-color .15s,box-shadow .15s}
.rt-input:hover{border-color:var(--dsw-alias-border-l2)}
.rt-input:focus{border-color:#4d6bfe;box-shadow:0 0 0 3px rgba(77,107,254,.16)}
.rt-pane{flex:1;overflow:auto;padding:12px}
.rt-textarea{width:100%;min-height:260px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);
  color:inherit;border-radius:6px;padding:8px;font-size:12.5px;font-family:ui-monospace,Menlo,monospace;
  line-height:1.6;resize:vertical;outline:none;box-sizing:border-box}
.rt-textarea:focus{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-list{width:210px;flex:none;border-right:1px solid var(--dsw-alias-border-l1);overflow:auto;padding:10px;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 32%,transparent)}
.rt-empty{margin:18px auto;max-width:440px;padding:26px 18px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px;
  border:1px dashed color-mix(in srgb,var(--dsw-alias-border-l2) 75%,transparent);
  border-radius:12px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 35%,transparent)}
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
.rt-full{position:fixed;top:var(--dsh-frame-chrome-top,var(--dsh-frame-top-clearance,var(--dsh-windows-titlebar-height,0px)));right:0;bottom:0;left:0;z-index:9999;display:flex;flex-direction:column;
  background:radial-gradient(960px 440px at 100% 0%,rgba(77,107,254,.09),transparent 64%),radial-gradient(640px 320px at 0% 100%,rgba(14,165,233,.05),transparent 60%),var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;border-top:3px solid var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-full .rt-head{padding:12px 18px}
.rt-full .rt-tabs{padding:10px 18px 0;gap:6px;flex-wrap:wrap}
.rt-full .rt-side{width:260px}
.rt-full .rt-list{width:280px}
.rt-full .rt-row{grid-template-columns:190px 90px 130px 1.4fr 1.2fr}
.rt-full .rt-vrow{grid-template-columns:80px minmax(0,1.6fr) 200px 150px 90px 64px}
.rt-full .rt-pane{padding:18px}
.rt-full .rt-textarea{min-height:60vh}
.rt-full .rt-foot{padding:10px 18px;font-size:12px}
.rt-full .rt-body{max-width:1600px;width:100%;margin:0 auto;padding-left:20px;padding-right:20px;flex:1;min-height:0;display:flex;flex-direction:column}
.rt-subtabs{display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 55%,transparent)}
.rt-subtab{padding:5px 10px;border-radius:7px 7px 0 0;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);transition:background .12s,color .12s}
.rt-subtab:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}
.rt-subtab.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);font-weight:600;box-shadow:inset 0 -2px 0 #4d6bfe}

.rt-modal{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
.rt-modal-box{width:min(560px,92vw);max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:14px 16px;font-size:12.5px;line-height:1.7;
  box-shadow:0 18px 48px rgba(0,0,0,.35);color:var(--dsw-alias-label-primary)}
.rt-modal-box .rt-kv b{min-width:76px}

.rt-dock *::-webkit-scrollbar,.rt-full *::-webkit-scrollbar{width:8px;height:8px}
.rt-dock *::-webkit-scrollbar-thumb,.rt-full *::-webkit-scrollbar-thumb{
  background:color-mix(in srgb,var(--dsw-alias-label-secondary) 32%,transparent);border-radius:99px;border:2px solid transparent;background-clip:padding-box}
.rt-dock *::-webkit-scrollbar-thumb:hover,.rt-full *::-webkit-scrollbar-thumb:hover{
  background:color-mix(in srgb,var(--dsw-alias-label-secondary) 50%,transparent);background-clip:padding-box}
.rt-dock *::-webkit-scrollbar-track,.rt-full *::-webkit-scrollbar-track{background:transparent}

body[data-ds-dark-theme] .rt-btn-primary,
body[data-ds-dark-theme] .rt-tab-group.on,
body[data-ds-dark-theme] .rt-tabs-groups .rt-tab-group.on{
  background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;border-color:#4d6bfe;
  box-shadow:0 2px 10px rgba(77,107,254,.35)}
body[data-ds-dark-theme] .rt-btn-primary:hover,
body[data-ds-dark-theme] .rt-tab-group.on:hover,
body[data-ds-dark-theme] .rt-tabs-groups .rt-tab-group.on:hover{
  background:linear-gradient(135deg,#5b78ff 0%,#3b82f6 100%);color:#fff}
body[data-ds-dark-theme] .rt-btn-primary{filter:none}

.rt-harness-modebar{display:inline-flex;align-items:center;gap:4px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}
.rt-harness-modebtn{border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:600;padding:4px 9px;border-radius:6px;cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .14s,color .14s}
.rt-harness-modebtn:hover{color:var(--dsw-alias-label-primary)}
.rt-harness-modebtn.on{background:linear-gradient(135deg,#4d6bfe 0%,#2563eb 100%);color:#fff;box-shadow:0 1px 4px rgba(77,107,254,.3)}

.rt-wish-wizard,
.rt-bento-card.rt-wish-wizard{
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:12px 14px;
  border-radius:12px;
  border:1px solid var(--rt-border,var(--dsw-alias-border-l1));
  background:var(--rt-bg-card,var(--dsw-alias-bg-layer-1));
  box-shadow:0 1px 4px rgba(15,23,42,.05);
  box-sizing:border-box;
  width:100%;
  min-width:0;
}
body[data-ds-dark-theme] .rt-wish-wizard,
body[data-ds-dark-theme] .rt-bento-card.rt-wish-wizard{
  background:var(--dsw-alias-bg-layer-1);
  border-color:rgba(148,163,184,.22);
  box-shadow:0 3px 10px rgba(0,0,0,.22);
}
.rt-wish-wizard-body{
  display:flex;
  flex-direction:column;
  gap:8px;
  min-width:0;
  box-sizing:border-box;
}
.rt-wish-blueprint-deck{
  padding:10px 12px;
  border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  box-sizing:border-box;
  min-width:0;
}
body[data-ds-dark-theme] .rt-wish-blueprint-deck{
  border-color:rgba(148,163,184,.2);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 86%,var(--dsw-alias-bg-base));
}

.rt-p4-workbench{
  display:flex;
  flex-direction:column;
  gap:10px;
  grid-column:1 / -1;
  width:100%;
  box-sizing:border-box;
  margin:0;
}
.rt-p4-split-grid,
.rt-p4-vertical-stack{
  display:grid;
  grid-template-columns:1fr;
  gap:12px;
  padding:12px 14px;
  align-items:stretch;
  width:100%;
  box-sizing:border-box;
}

.rt-net-pane{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px;
  padding:10px 12px;
  background:var(--dsw-alias-bg-layer-1);
  display:flex;
  flex-direction:column;
  gap:8px;
  min-width:0;
  box-shadow:0 1px 6px -2px rgba(15,23,42,.05);
}

.rt-p5-topbar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:6px;
  flex-wrap:wrap;
  padding:8px 12px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 60%,var(--dsw-alias-bg-layer-1));
}
.rt-p5-filters{
  display:inline-flex;
  align-items:center;
  gap:4px;
  flex-wrap:wrap;
}

.rt-tree-stage,
.rt-p5-tree-stage{
  position:relative;
  box-sizing:border-box;
}
.rt-tree-stage{
  width:100%;
  min-width:max-content;
  display:flex;
  flex-direction:column;
  align-items:stretch;
}
.rt-p5-tree-stage{
  width:760px;
  max-width:100%;
  margin:0 auto;
  display:flex;
  flex-direction:column;
  align-items:center;
  transform-origin:top center;
  transition:transform .16s cubic-bezier(.22,1,.36,1);
}
svg.rt-tree-edges-svg{
  position:absolute;
  inset:0;
  width:100%;
  height:100%;
  display:block;
  overflow:visible;
  pointer-events:none;
  z-index:1;
  background:none;
}
.rt-tree-node-layer{
  position:relative;
  z-index:2;
  width:100%;
  min-width:0;
  box-sizing:border-box;
}
.rt-tree-edge-path{
  fill:none;
  stroke:var(--rt-edge-color,var(--dsw-alias-border-l2,#94a3b8));
  stroke-width:1.85;
  stroke-linecap:round;
  stroke-linejoin:round;
  transition:stroke .16s ease,stroke-width .16s ease,opacity .16s ease;
}
body[data-ds-dark-theme] .rt-tree-edge-path{
  stroke:var(--rt-edge-color,rgba(148,163,184,.5));
}
.rt-tree-edge-path.is-running{
  stroke:var(--rt-edge-color,var(--wb-blue,#3b82f6));
  stroke-width:2.2;
  stroke-dasharray:6 5;
  animation:rt-dash-flow 0.9s linear infinite;
}
body[data-ds-dark-theme] .rt-tree-edge-path.is-running{
  stroke:var(--rt-edge-color,#60a5fa);
}
.rt-tree-edge-path.is-done{
  stroke:var(--rt-edge-color,#10b981);
  stroke-width:2;
  stroke-dasharray:none;
  opacity:.9;
}
body[data-ds-dark-theme] .rt-tree-edge-path.is-done{
  stroke:var(--rt-edge-color,#34d399);
}
.rt-tree-edge-path.is-error{
  stroke:#ef4444;
  stroke-width:2.2;
  stroke-dasharray:4 3;
  opacity:.95;
}
body[data-ds-dark-theme] .rt-tree-edge-path.is-error{
  stroke:#f87171;
}
.rt-tree-edge-path.is-active{
  stroke-width:2.6;
  opacity:1;
}
.rt-tree-edge-path.is-dimmed{
  opacity:.24;
}
@media (prefers-reduced-motion: reduce){
  .rt-tree-edge-path.is-running{
    animation:none;
  }
}

.rt-p5-root-wrap{
  width:360px;
  max-width:92%;
  min-width:0;
  box-sizing:border-box;
  position:relative;
  display:flex;
  flex-direction:column;
  align-items:center;
}
.rt-p5-branches-grid{
  width:760px;
  max-width:100%;
  min-width:0;
  box-sizing:border-box;
  display:grid;
  grid-template-columns:repeat(2,minmax(0,360px));
  justify-content:space-between;
  gap:28px;
  align-items:start;
  position:relative;
}
@media(max-width:680px){
  .rt-p5-branches-grid{
    grid-template-columns:1fr;
    gap:14px;
  }
}

.rt-tree-port{
  width:6px;
  height:6px;
  border-radius:50%;
  background:var(--dsw-alias-bg-layer-1);
  border:1.5px solid var(--wb-blue,#3b82f6);
  position:absolute;
  z-index:3;
  pointer-events:none;
  box-sizing:border-box;
  box-shadow:0 0 0 1.5px var(--dsw-alias-bg-base);
}
body[data-ds-dark-theme] .rt-tree-port{
  background:var(--dsw-alias-bg-layer-2);
  border-color:#60a5fa;
}
.rt-tree-port-left{
  left:-4px;
  right:auto;
  top:50%;
  transform:translateY(-50%);
}
.rt-tree-port-right{
  right:-4px;
  left:auto;
  top:50%;
  transform:translateY(-50%);
}
.rt-tree-port-top{
  top:-4px;
  bottom:auto;
  left:50%;
  transform:translateX(-50%);
}
.rt-tree-port-bottom{
  bottom:-4px;
  top:auto;
  left:50%;
  transform:translateX(-50%);
}
.rt-tree-port.is-done{border-color:#10b981}
.rt-tree-port.is-error{border-color:#ef4444}

.rt-p5-pill{
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:2px 8px;
  border-radius:999px;
  font-size:10.5px;
  font-weight:700;
  line-height:1.3;
  letter-spacing:0.01em;
}

.rt-panzoom-viewport,
.rt-panzoom-viewport *{
  box-sizing: border-box;
}
.rt-panzoom-viewport{
  position: relative;
  width: 100%;
  min-height: 280px;
  height: auto;
  max-height: 520px;
  contain: layout style paint;
  box-sizing: border-box;
  overflow: hidden;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  background: radial-gradient(circle at 12px 12px, rgba(59,130,246,0.11) 1.1px, transparent 1.1px), var(--dsw-alias-bg-base);
  background-size: 18px 18px;
}
.rt-panzoom-viewport.rt-panzoom-viewport-cluster{
  min-height: 340px;
  max-height: 580px;
}
body[data-ds-dark-theme] .rt-panzoom-viewport{
  background: radial-gradient(circle at 12px 12px, rgba(96,165,250,0.15) 1.1px, transparent 1.1px), var(--dsw-alias-bg-base);
  background-size: 18px 18px;
  border-color: rgba(148,163,184,0.22);
}
.rt-panzoom-viewport.grabbing{
  cursor: grabbing;
}
.rt-panzoom-toolbar{
  position: absolute;
  right: 8px;
  top: 8px;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--rt-bg-card, #ffffff);
  border: 1px solid var(--rt-border, var(--dsw-alias-border-l1));
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.08);
}
body[data-ds-dark-theme] .rt-panzoom-toolbar{
  background: var(--dsw-alias-bg-layer-2, #1e293b);
  border-color: rgba(148,163,184,0.24);
  box-shadow: 0 4px 12px rgba(0,0,0,0.34);
}
.rt-panzoom-stage{
  transition: none;
  will-change: transform;
  transform-origin: 0 0;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  position: relative;
}
.rt-panzoom-stage.smooth-zoom{
  transition: transform 0.16s cubic-bezier(0.22, 1, 0.36, 1);
}

.rt-tree-layout-setting{
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.rt-tree-wave-group,
.rt-tree-wave-card,
.rt-p4-node-card,
.rt-p5-root-wrap,
.rt-p5-branches-grid,
.rt-tree-wave-row{
  box-sizing: border-box;
  min-width: 0;
}
.rt-p4-node-card{
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.12s ease;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.04);
}
body[data-ds-dark-theme] .rt-p4-node-card{
  background: var(--dsw-alias-bg-layer-2);
  border-color: rgba(148, 163, 184, 0.22);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.24);
}
.rt-p4-node-card:hover{
  border-color: #3b82f6;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -4px rgba(59, 130, 246, 0.18);
}
.rt-p4-node-card.on{
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2), 0 4px 12px -4px rgba(59, 130, 246, 0.18);
  background: color-mix(in srgb, rgba(59, 130, 246, 0.07) 100%, var(--dsw-alias-bg-layer-1));
}
body[data-ds-dark-theme] .rt-p4-node-card.on{
  border-color: #60a5fa;
  background: color-mix(in srgb, rgba(59, 130, 246, 0.14) 100%, var(--dsw-alias-bg-layer-2));
}

.rt-tree-layout-horizontal{
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 44px;
  min-width: max-content;
  padding: 14px 18px;
  box-sizing: border-box;
}
.rt-h-root-col{
  width: 248px;
  flex-shrink: 0;
  align-self: center;
  position: relative;
  box-sizing: border-box;
}
.rt-h-waves-stack{
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
}
.rt-wave-horizontal-lane{
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 36px;
  position: relative;
  box-sizing: border-box;
}
.rt-wave-horizontal-lane > .rt-tree-wave-card,
.rt-tree-layout-horizontal .rt-tree-wave-card{
  width: 248px;
  flex-shrink: 0;
  position: relative;
  box-sizing: border-box;
}
.rt-wave-right-children{
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 10px;
  align-items: stretch;
  padding: 2px 0;
  box-sizing: border-box;
}
.rt-wave-right-children > *,
.rt-wave-right-children .rt-p4-node-card{
  width: 228px;
  flex-shrink: 0;
  position: relative;
  box-sizing: border-box;
}

.rt-tree-layout-vertical{
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  width: 100%;
  padding: 16px 14px;
  box-sizing: border-box;
}
.rt-tree-wave-row{
  display: grid;
  grid-template-columns: repeat(4, minmax(215px, 1fr));
  gap: 12px;
  align-items: start;
  width: 100%;
  position: relative;
  box-sizing: border-box;
  min-width: 0;
}
.rt-tree-wave-grid{
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 10px;
  width: 100%;
  align-items: start;
  box-sizing: border-box;
}
.rt-tree-wave-group{
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  width: 100%;
  position: relative;
  box-sizing: border-box;
}
.rt-wave-subtree-children{
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  margin-top: 6px;
  padding: 6px;
  border-radius: 9px;
  border: 1px dashed var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  position: relative;
  box-sizing: border-box;
  min-width: 0;
}
body[data-ds-dark-theme] .rt-wave-subtree-children{
  border-color: rgba(148, 163, 184, 0.24);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 86%, var(--dsw-alias-bg-base));
}
.rt-tree-wave-card{
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  min-width: 0;
  box-sizing: border-box;
  transition: border-color 0.16s ease, box-shadow 0.16s ease, transform 0.14s ease, background 0.16s ease;
  box-shadow: 0 1px 5px rgba(15,23,42,0.04);
}
body[data-ds-dark-theme] .rt-tree-wave-card{
  background: var(--dsw-alias-bg-layer-2);
  border-color: rgba(148,163,184,0.22);
  box-shadow: 0 2px 10px rgba(0,0,0,0.24);
}
.rt-tree-wave-card:hover{
  border-color: #3b82f6;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px -4px rgba(59,130,246,0.16);
}
body[data-ds-dark-theme] .rt-tree-wave-card:hover{
  border-color: #60a5fa;
  box-shadow: 0 4px 14px -4px rgba(59,130,246,0.28);
}
.rt-tree-wave-card.active,.rt-tree-wave-card.on,.rt-tree-wave-card.expanded{
  border-color: #3b82f6;
  box-shadow: 0 0 0 2px rgba(59,130,246,0.2), 0 4px 14px -4px rgba(59,130,246,0.18);
  background: color-mix(in srgb, rgba(59,130,246,0.06) 100%, var(--dsw-alias-bg-layer-1));
}
body[data-ds-dark-theme] .rt-tree-wave-card.active,
body[data-ds-dark-theme] .rt-tree-wave-card.on,
body[data-ds-dark-theme] .rt-tree-wave-card.expanded{
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(96,165,250,0.25), 0 6px 16px -4px rgba(37,99,235,0.3);
  background: color-mix(in srgb, rgba(59,130,246,0.13) 100%, var(--dsw-alias-bg-layer-2));
}
.rt-tree-wave-card-badge{
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  color: #2563eb;
  background: rgba(59,130,246,0.1);
  border: 1px solid rgba(59,130,246,0.26);
  white-space: nowrap;
}
body[data-ds-dark-theme] .rt-tree-wave-card-badge{
  color: #93c5fd;
  background: rgba(59,130,246,0.2);
  border-color: rgba(96,165,250,0.36);
}
.rt-tree-expanded-grid{
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
  gap: 8px;
  width: 100%;
  margin-top: 6px;
  padding: 8px;
  border-radius: 9px;
  border: 1px dashed var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  box-sizing: border-box;
}
body[data-ds-dark-theme] .rt-tree-expanded-grid{
  border-color: rgba(148,163,184,0.24);
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 86%, var(--dsw-alias-bg-base));
}

.rt-canvas-filter-bar{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:6px;
  flex-wrap:wrap;
  padding:6px 10px;
  border-radius:9px;
  border:1px solid var(--rt-border,var(--dsw-alias-border-l1));
  background:var(--rt-bg-subtle,color-mix(in srgb,var(--dsw-alias-bg-layer-2) 65%,transparent));
  box-sizing:border-box;
}
.rt-p4-node-card.is-error,
.rt-tree-wave-card.is-error{
  border-color:#ef4444;
  background:color-mix(in srgb,rgba(239,68,68,.08) 100%,var(--rt-bg-card,var(--dsw-alias-bg-layer-1)));
  box-shadow:0 2px 8px -2px rgba(239,68,68,.18);
}
.rt-p4-node-card.is-error:hover,
.rt-tree-wave-card.is-error:hover{
  border-color:#dc2626;
  box-shadow:0 4px 12px -4px rgba(239,68,68,.26);
}
.rt-p4-node-card.is-error.on{
  border-color:#dc2626;
  box-shadow:0 0 0 2px rgba(239,68,68,.24),0 4px 12px -4px rgba(239,68,68,.24);
}
body[data-ds-dark-theme] .rt-p4-node-card.is-error,
body[data-ds-dark-theme] .rt-tree-wave-card.is-error{
  border-color:#f87171;
  background:color-mix(in srgb,rgba(239,68,68,.15) 100%,var(--dsw-alias-bg-layer-2));
  box-shadow:0 3px 10px rgba(0,0,0,.32),0 0 0 1px rgba(248,113,113,.2);
}

.rt-shard-lock-badge{
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:1px 7px;
  border-radius:999px;
  font-size:10px;
  font-weight:700;
  font-family:ui-monospace,Menlo,monospace;
  color:var(--wb-blue-ink,#1e40af);
  background:var(--wb-blue-soft,rgba(77,107,254,.12));
  border:1px solid color-mix(in srgb,var(--wb-blue,#4d6bfe) 30%,transparent);
  white-space:nowrap;
  max-width:100%;
  overflow:hidden;
  text-overflow:ellipsis;
}
body[data-ds-dark-theme] .rt-shard-lock-badge{
  color:#93c5fd;
  background:rgba(59,130,246,.2);
  border-color:rgba(96,165,250,.36);
}

.rt-pane.rt-collab-page{
  display:flex;
  flex-direction:column;
  gap:12px;
  padding:12px 14px 20px;
  max-width:1180px;
  width:100%;
  margin:0 auto;
  box-sizing:border-box;
}
.rt-collab-page > .rt-card{
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:12px 14px;
  border-radius:11px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 1px 6px rgba(15,23,42,.04);
  box-sizing:border-box;
}
body[data-ds-dark-theme] .rt-collab-page > .rt-card{
  background:var(--dsw-alias-bg-layer-2);
  border-color:rgba(148,163,184,.2);
  box-shadow:0 4px 12px rgba(0,0,0,.24);
}
.rt-card.rt-onboard-card{
  border-color:rgba(77,107,254,.28);
  background:var(--dsw-alias-bg-layer-1);
}
.rt-card.rt-onboard-card.is-compact{
  padding:9px 14px;
  gap:5px;
}
body[data-ds-dark-theme] .rt-card.rt-onboard-card{
  border-color:rgba(96,165,250,.3);
  background:var(--dsw-alias-bg-layer-2);
}
.rt-onboard-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  flex-wrap:wrap;
}
.rt-onboard-title{
  font-size:14px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
}
.rt-onboard-actions{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
}
.rt-onboard-bind-details{
  font-size:12px;
  color:var(--dsw-alias-label-secondary);
  padding:7px 10px;
  border-radius:8px;
  border:1px dashed var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);
}
.rt-onboard-bind-details > summary{
  cursor:pointer;
  font-weight:600;
  color:var(--wb-blue-ink,#2563eb);
}
body[data-ds-dark-theme] .rt-onboard-bind-details > summary{
  color:#93c5fd;
}
.rt-approval-list{
  display:flex;
  flex-direction:column;
  gap:8px;
}
.rt-approval-card{
  display:flex;
  flex-direction:column;
  gap:7px;
  padding:10px 12px;
  border-radius:9px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base);
  box-sizing:border-box;
}
.rt-approval-card.is-pending{
  border-left:3px solid #f59e0b;
}
body[data-ds-dark-theme] .rt-approval-card{
  background:rgba(15,23,42,.42);
  border-color:rgba(148,163,184,.2);
}
.rt-tag-warn{
  color:#b45309;
  background:rgba(245,158,11,.15);
  border-color:rgba(245,158,11,.35);
}
body[data-ds-dark-theme] .rt-tag-warn{
  color:#fbbf24;
  background:rgba(245,158,11,.2);
  border-color:rgba(251,191,36,.38);
}

.rt-ov-standby-card{
  display:flex;
  flex-direction:column;
  align-items:flex-start;
  gap:10px;
  padding:18px 20px;
  border-radius:12px;
  border:1.5px dashed rgba(77,107,254,.32);
  background:var(--dsw-alias-bg-layer-1);
}
body[data-ds-dark-theme] .rt-ov-standby-card{
  border-color:rgba(96,165,250,.35);
  background:var(--dsw-alias-bg-layer-2);
}
.rt-ov-standby-badge-row{
  display:flex;
  align-items:center;
  gap:6px;
  flex-wrap:wrap;
}
.rt-ov-standby-title{
  font-size:16px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
}
.rt-ov-standby-sub{
  font-size:12.5px;
  line-height:1.55;
  color:var(--dsw-alias-label-secondary);
  max-width:740px;
}
.rt-ov-standby-actions{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  margin-top:2px;
}
.rt-ov-action-banner{
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  padding:8px 12px;
  border-radius:9px;
  font-size:12.5px;
  border:1px solid rgba(77,107,254,.26);
  background:rgba(77,107,254,.05);
  color:var(--dsw-alias-label-primary);
}
.rt-ov-action-banner.is-pending{
  border-color:rgba(245,158,11,.4);
  background:rgba(245,158,11,.09);
}
body[data-ds-dark-theme] .rt-ov-action-banner{
  border-color:rgba(96,165,250,.3);
  background:rgba(59,130,246,.12);
}
body[data-ds-dark-theme] .rt-ov-action-banner.is-pending{
  border-color:rgba(251,191,36,.4);
  background:rgba(245,158,11,.15);
}
.rt-ov-kpi-grid{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:10px;
}
@media(max-width:920px){
  .rt-ov-kpi-grid{
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
}
@media(max-width:520px){
  .rt-ov-kpi-grid{
    grid-template-columns:1fr;
  }
}
.rt-ov-kpi-card{
  display:flex;
  flex-direction:column;
  gap:5px;
  padding:11px 13px;
  border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  box-sizing:border-box;
  min-width:0;
  transition:border-color .14s ease,background-color .14s ease,box-shadow .14s ease;
}
.rt-ov-kpi-card.is-interactive{
  cursor:pointer;
}
.rt-ov-kpi-card.is-interactive:hover{
  border-color:rgba(77,107,254,.55);
  box-shadow:0 2px 8px rgba(15,23,42,.04);
}
.rt-ov-kpi-card.is-expanded{
  border-color:#4d6bfe;
  background:color-mix(in srgb,#4d6bfe 4%,var(--dsw-alias-bg-layer-1));
  box-shadow:0 0 0 1px rgba(77,107,254,.2);
}
body[data-ds-dark-theme] .rt-ov-kpi-card{
  background:var(--dsw-alias-bg-layer-2);
  border-color:rgba(148,163,184,.2);
}
body[data-ds-dark-theme] .rt-ov-kpi-card.is-expanded{
  border-color:#60a5fa;
  background:rgba(59,130,246,.1);
}
.rt-ov-kpi-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:6px;
}
.rt-ov-kpi-label{
  font-size:11.5px;
  font-weight:600;
  color:var(--dsw-alias-label-secondary);
}
.rt-ov-kpi-toggle{
  font-size:10.5px;
  font-weight:600;
  padding:1px 6px;
  border-radius:999px;
  color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-2);
  border:1px solid var(--dsw-alias-border-l1);
  white-space:nowrap;
}
.rt-ov-kpi-card.is-expanded .rt-ov-kpi-toggle{
  color:#2563eb;
  border-color:rgba(77,107,254,.35);
  background:rgba(77,107,254,.08);
}
body[data-ds-dark-theme] .rt-ov-kpi-card.is-expanded .rt-ov-kpi-toggle{
  color:#93c5fd;
  background:rgba(59,130,246,.16);
}
.rt-ov-kpi-val{
  font-size:15px;
  font-weight:700;
  font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-primary);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.rt-ov-kpi-val.accent{
  color:var(--wb-blue-ink,#2563eb);
}
body[data-ds-dark-theme] .rt-ov-kpi-val.accent{
  color:#93c5fd;
}
.rt-ov-kpi-sub{
  font-size:11px;
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.rt-ov-mini-bar{
  display:flex;
  align-items:center;
  width:100%;
  height:5px;
  border-radius:999px;
  overflow:hidden;
  background:var(--dsw-alias-bg-layer-2);
  gap:1px;
}
body[data-ds-dark-theme] .rt-ov-mini-bar{
  background:rgba(148,163,184,.16);
}
.rt-ov-mini-seg{
  height:100%;
  min-width:2px;
  border-radius:1px;
}
.rt-ov-detail-drawer{
  display:flex;
  flex-direction:column;
  gap:12px;
  padding:14px 16px;
  border-radius:12px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
}
body[data-ds-dark-theme] .rt-ov-detail-drawer{
  background:var(--dsw-alias-bg-layer-2);
  border-color:rgba(148,163,184,.22);
}
.rt-ov-detail-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:10px;
  flex-wrap:wrap;
  padding-bottom:8px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
}
.rt-ov-detail-title{
  display:flex;
  align-items:center;
  gap:8px;
  font-size:13px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
}
.rt-ov-detail-actions{
  display:flex;
  align-items:center;
  gap:6px;
}
.rt-ov-detail-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
}
@media(max-width:880px){
  .rt-ov-detail-grid{
    grid-template-columns:1fr;
  }
}
.rt-ov-detail-card{
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:12px;
  border-radius:10px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  min-width:0;
}
body[data-ds-dark-theme] .rt-ov-detail-card{
  background:rgba(15,23,42,.35);
  border-color:rgba(148,163,184,.18);
}
.rt-ov-detail-card-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  font-size:12px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
}
.rt-ov-stat-tiles{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:8px;
}
@media(max-width:640px){
  .rt-ov-stat-tiles{
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
}
.rt-ov-stat-tile{
  padding:8px 10px;
  border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  display:flex;
  flex-direction:column;
  gap:2px;
}
.rt-ov-stat-tile-val{
  font-size:16px;
  font-weight:700;
  font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-primary);
}
.rt-ov-stat-tile-lbl{
  font-size:10.5px;
  color:var(--dsw-alias-label-secondary);
}
.rt-ov-seg-bar{
  display:flex;
  width:100%;
  height:10px;
  border-radius:999px;
  overflow:hidden;
  background:var(--dsw-alias-bg-layer-2);
  gap:1px;
}
.rt-ov-seg-piece{
  height:100%;
  min-width:3px;
}
.rt-ov-donut-wrap{
  display:flex;
  align-items:center;
  gap:14px;
  flex-wrap:wrap;
}
.rt-ov-donut-box{
  position:relative;
  width:92px;
  height:92px;
  flex-shrink:0;
}
.rt-ov-donut-center{
  position:absolute;
  inset:0;
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  pointer-events:none;
}
.rt-ov-donut-main{
  font-size:13px;
  font-weight:700;
  font-variant-numeric:tabular-nums;
  color:var(--dsw-alias-label-primary);
}
.rt-ov-donut-sub{
  font-size:9.5px;
  color:var(--dsw-alias-label-secondary);
}
.rt-ov-legend-grid{
  flex:1;
  min-width:180px;
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:6px 14px;
}
@media(max-width:520px){
  .rt-ov-legend-grid{
    grid-template-columns:1fr;
  }
}
.rt-ov-legend-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  font-size:11.5px;
  min-width:0;
}
.rt-ov-legend-name{
  display:inline-flex;
  align-items:center;
  gap:6px;
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.rt-ov-dot{
  width:7px;
  height:7px;
  border-radius:50%;
  flex-shrink:0;
}
.rt-ov-legend-val{
  font-variant-numeric:tabular-nums;
  font-weight:600;
  color:var(--dsw-alias-label-primary);
  white-space:nowrap;
}
.rt-ov-table-wrap{
  width:100%;
  overflow-x:auto;
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:8px;
}
.rt-ov-table{
  width:100%;
  border-collapse:collapse;
  font-size:11.5px;
}
.rt-ov-table th{
  text-align:left;
  font-weight:600;
  font-size:10.5px;
  color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-2);
  padding:6px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  white-space:nowrap;
}
.rt-ov-table td{
  padding:6px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
  vertical-align:middle;
}
.rt-ov-table tr:last-child td{
  border-bottom:none;
}
.rt-ov-wave-strip{
  display:grid;
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:8px;
}
@media(max-width:720px){
  .rt-ov-wave-strip{
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
}
.rt-ov-wave-cell{
  padding:8px 10px;
  border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  display:flex;
  flex-direction:column;
  gap:4px;
}
.rt-ov-node-strip{
  display:flex;
  flex-direction:column;
  gap:4px;
  padding:8px 12px;
  border-radius:9px;
  border:1px solid rgba(59,130,246,.3);
  background:var(--dsw-alias-bg-layer-1);
  box-sizing:border-box;
}
body[data-ds-dark-theme] .rt-ov-node-strip{
  border-color:rgba(96,165,250,.34);
  background:var(--dsw-alias-bg-layer-2);
}

.rt-lower-process-deck{
  display:flex;
  flex-direction:column;
  gap:12px;
  width:100%;
  min-width:0;
  box-sizing:border-box;
}

.rt-swim-pane{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px;
  padding:10px 12px;
  background:var(--dsw-alias-bg-layer-1);
  display:flex;
  flex-direction:column;
  gap:6px;
  width:100%;
  min-width:0;
  box-sizing:border-box;
  box-shadow:0 1px 6px -2px rgba(15,23,42,.05);
}
.rt-swim-row{
  display:grid;
  grid-template-columns:156px minmax(200px,1fr);
  align-items:stretch;
  border-bottom:1px solid var(--dsw-alias-border-l1);
  min-height:46px;
  position:relative;
  transition:background .12s;
}
.rt-swim-row:last-child{border-bottom:0}
.rt-swim-row:hover{background:color-mix(in srgb,#4d6bfe 4%,var(--dsw-alias-bg-layer-2))}
.rt-swim-row.on{background:rgba(77,107,254,.06)}
.rt-swim-track{
  position:relative;
  display:flex;
  align-items:center;
  gap:10px;
  padding:6px 12px;
  min-height:38px;
  min-width:200px;
  z-index:1;
}
.rt-swim-track::before{
  content:'';
  position:absolute;
  left:10px;
  right:10px;
  top:50%;
  height:1.5px;
  background:var(--dsw-alias-border-l1);
  z-index:0;
  pointer-events:none;
}
.rt-swim-matrix-wrap{
  position:relative;
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:9px;
  background:var(--dsw-alias-bg-layer-1);
  overflow:hidden;
}

.rt-collab-pane{
  border:1px solid var(--dsw-alias-border-l1);
  border-radius:10px;
  padding:10px 12px;
  background:var(--dsw-alias-bg-layer-1);
  display:flex;
  flex-direction:column;
  gap:6px;
  width:100%;
  min-width:0;
  box-sizing:border-box;
  box-shadow:0 1px 6px -2px rgba(15,23,42,.05);
}

.rt-step-chain{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:6px;
  align-items:stretch;
  width:100%;
  padding:4px 0;
  box-sizing:border-box;
  position:relative;
}
@media(max-width:520px){
  .rt-step-chain{
    grid-template-columns:1fr;
  }
}
.rt-step-node{
  display:flex;
  align-items:stretch;
  gap:5px;
  min-width:0;
  position:relative;
}
.rt-step-pill{
  display:flex;
  flex-direction:column;
  gap:2px;
  padding:6px 8px;
  border-radius:8px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);
  min-width:0;
  flex:1;
  position:relative;
  transition:border-color 0.15s ease,transform 0.14s ease,box-shadow 0.15s ease;
}
body[data-ds-dark-theme] .rt-step-pill{
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 88%,var(--dsw-alias-bg-base));
  border-color:rgba(148,163,184,0.22);
}
.rt-step-pill:hover{
  border-color:var(--wb-blue,#4d6bfe);
  transform:translateY(-1px);
  box-shadow:0 3px 8px -2px rgba(59,130,246,0.14);
}
body[data-ds-dark-theme] .rt-step-pill:hover{
  border-color:#60a5fa;
  box-shadow:0 3px 10px -2px rgba(59,130,246,0.24);
}
.rt-step-arrow{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  flex:none;
  font-size:11px;
  font-weight:700;
  color:var(--dsw-alias-label-secondary);
  opacity:0.78;
  user-select:none;
}
body[data-ds-dark-theme] .rt-step-arrow{
  color:#93c5fd;
  opacity:0.85;
}
.rt-agent-inspector-drawer{
  width:100%;
  box-sizing:border-box;
  border:1px solid color-mix(in srgb,var(--wb-blue,#3b82f6) 42%,var(--dsw-alias-border-l1));
  border-left:3px solid var(--wb-blue,#3b82f6);
  border-radius:10px;
  padding:10px 12px;
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 4px 14px -6px rgba(15,23,42,0.12);
  display:flex;
  flex-direction:column;
  gap:8px;
  animation:rt-subnode-spawn 0.3s cubic-bezier(0.22,1,0.36,1);
}
body[data-ds-dark-theme] .rt-agent-inspector-drawer{
  border-color:rgba(96,165,250,0.4);
  border-left-color:#60a5fa;
  background:var(--dsw-alias-bg-layer-2);
  box-shadow:0 6px 18px -6px rgba(0,0,0,0.4);
}
.rt-jump-chat-btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:5px;
  padding:4px 10px;
  border-radius:7px;
  font-size:11.5px;
  font-weight:600;
  color:#ffffff;
  background:var(--wb-blue,#3b82f6);
  border:1px solid #2563eb;
  cursor:pointer;
  box-shadow:0 1px 4px rgba(59,130,246,0.22);
  transition:transform 0.14s ease,box-shadow 0.14s ease,background 0.14s ease;
}
.rt-jump-chat-btn:hover{
  transform:translateY(-1px);
  background:#2563eb;
  box-shadow:0 3px 10px rgba(59,130,246,0.28);
}
body[data-ds-dark-theme] .rt-jump-chat-btn{
  background:#4d6bfe;
  border-color:#60a5fa;
  box-shadow:0 2px 8px rgba(59,130,246,0.32);
}

.rt-digest-box{
  display:flex;
  flex-direction:column;
  gap:5px;
  padding:8px 10px;
  border-radius:8px;
  border:1px solid color-mix(in srgb,#10b981 30%,var(--dsw-alias-border-l1));
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);
  font-size:11.5px;
  line-height:1.5;
  box-sizing:border-box;
}
body[data-ds-dark-theme] .rt-digest-box{
  border-color:rgba(52,211,153,0.32);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 90%,var(--dsw-alias-bg-base));
}
.rt-plan-approve-btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:5px;
  padding:4px 10px;
  border-radius:7px;
  font-size:11.5px;
  font-weight:600;
  color:#ffffff;
  background:#10b981;
  border:1px solid #059669;
  cursor:pointer;
  box-shadow:0 1px 4px rgba(16,185,129,0.22);
  transition:transform 0.14s ease,box-shadow 0.14s ease,background 0.14s ease;
}
.rt-plan-approve-btn:hover{
  transform:translateY(-1px);
  background:#059669;
  box-shadow:0 3px 10px rgba(16,185,129,0.28);
}
body[data-ds-dark-theme] .rt-plan-approve-btn{
  background:#10b981;
  border-color:#34d399;
  box-shadow:0 2px 8px rgba(16,185,129,0.3);
}

.rt-seg,.rt-item{padding:7px 8px;border-radius:8px;cursor:pointer;margin-bottom:4px;border:1px solid transparent;transition:background .12s,border-color .12s,box-shadow .12s}
.rt-seg:hover,.rt-item:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 85%,transparent)}
.rt-seg.on,.rt-item.on{background:rgba(77,107,254,.1);border-color:rgba(77,107,254,.45)}
.rt-seg-cidr{font-family:ui-monospace,Menlo,monospace;font-size:12.5px}
.rt-seg-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.rt-table{flex:1;overflow:auto}
.rt-row{display:grid;grid-template-columns:150px 74px 104px 1.15fr 1fr;gap:8px;padding:6px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;cursor:pointer;font-size:12.5px;transition:background .12s}
.rt-row.head,.rt-vrow.head,.rt-score-row.head{cursor:default;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-weight:600;position:sticky;top:0;
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 78%,var(--dsw-alias-bg-layer-1));z-index:1;letter-spacing:.02em}
.rt-row.head:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-mono{font-family:ui-monospace,Menlo,monospace}
.rt-tag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;margin-right:4px;font-weight:500;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent);white-space:nowrap}
.rt-tag-passive{color:#6366f1;border-color:#6366f155;background:#6366f11a}
.rt-tag-active{color:#0ea5e9;border-color:#0ea5e955;background:#0ea5e91a}
.rt-tag-live{color:#4d6bfe;border-color:#4d6bfe55;background:#4d6bfe1a}
.rt-tag-warn{color:#ef4444;border-color:#ef444455;background:#ef44441a}
.rt-hint{border-radius:9px;padding:7px 9px;margin-bottom:8px;font-size:11.5px;line-height:1.6;
  border:1px solid #ef444488;background:#ef44440f;color:var(--dsw-alias-label-primary)}
.rt-hint b{color:#ef4444}
.rt-expand{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-kv{display:flex;gap:8px;margin-bottom:3px;align-items:baseline}
.rt-kv b{color:var(--dsw-alias-label-primary);font-weight:600;min-width:64px;flex:none}
.rt-card{border:1px solid var(--dsw-alias-border-l1);border-radius:11px;padding:11px 13px;margin-bottom:10px;
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 1px 3px rgba(15,23,42,.04)}
.rt-card h4{margin:0 0 6px;font-size:12.5px;letter-spacing:-.005em}
.rt-item-name{font-weight:600;font-size:12.5px}
.rt-item-desc{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rt-test{display:inline-block;padding:0 5px;border-radius:999px;font-size:11px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.rt-pri{display:inline-block;padding:0 6px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
.rt-pri-high{color:#fff;background:#4d6bfe}
.rt-pri-low{color:#fff;background:#94a3b8}
.rt-score-row{display:grid;grid-template-columns:16px 62px minmax(0,1fr) 116px 66px;gap:8px;padding:7px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;font-size:12.5px;cursor:pointer;transition:background .12s}
.rt-row:hover,.rt-vrow:hover,.rt-score-row:hover{background:color-mix(in srgb,#4d6bfe 6%,var(--dsw-alias-bg-layer-2))}
.rt-score-detail{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-score-group{display:flex;align-items:center;gap:8px;padding:7px 10px;margin:6px 8px 3px;border-radius:8px;
  font-size:12px;font-weight:600;border-top:none;background:linear-gradient(90deg,rgba(77,107,254,.09),transparent 72%)}
.rt-score-group .rt-sg-sub{font-weight:400;font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-sess-facts{display:flex;flex-direction:column;gap:2px;margin-top:5px}
.rt-sess-fact{display:flex;gap:6px;font-size:11.5px;line-height:1.5}
.rt-sess-fact>b{flex:none;min-width:62px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.rt-sess-fact>span{min-width:0;overflow-wrap:anywhere}
.rt-sess-fold{margin-top:6px;font-size:11.5px}
.rt-sess-fold>summary{cursor:pointer;color:var(--dsw-alias-label-secondary);user-select:none}
.rt-sess-fold>summary:hover{color:var(--dsw-alias-label-primary)}
.rt-score-row .rt-scope{font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.rt-score-form{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px}
.rt-score-form input,.rt-score-form select{width:100%;box-sizing:border-box}
.rt-vrow{display:grid;grid-template-columns:62px minmax(0,1fr) 132px 108px 74px 52px;gap:8px;padding:6px 10px;
  border-bottom:1px solid var(--dsw-alias-border-l1);align-items:center;font-size:12.5px;cursor:pointer;transition:background .12s}
.rt-vdetail{grid-column:1/-1;padding:8px 4px 10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.rt-vdetail .rt-kv{margin-bottom:4px}
.rt-actions{display:flex;gap:6px;margin-top:6px}
.rt-section{padding:8px 10px 2px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.rt-link{color:var(--wb-blue,var(--dsw-alias-brand-primary));text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rt-link:hover{text-decoration:underline}
.rt-sev{display:inline-block;padding:1px 7px;border-radius:5px;font-size:11px;font-weight:600;border:1px solid transparent;letter-spacing:.01em}
.rt-dot-on{display:inline-block;width:7px;height:7px;border-radius:50%;background:#4d6bfe;box-shadow:0 0 0 3px #4d6bfe33}
.rt-dot-off{display:inline-block;width:7px;height:7px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 3px #ef444433}
.rt-dot-unk{display:inline-block;width:7px;height:7px;border-radius:50%;background:#94a3b8;box-shadow:0 0 0 3px #94a3b833}
.rt-sess-grid{display:grid;grid-template-columns:1fr;gap:8px;padding:10px 12px}
.rt-sess,.rt-cred,.rt-rep,.rt-kb{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);
  box-shadow:0 1px 2px rgba(0,0,0,.035);transition:border-color .12s,box-shadow .12s}
.rt-sess:hover,.rt-cred:hover,.rt-rep:hover,.rt-kb:hover{border-color:rgba(77,107,254,.38);box-shadow:0 2px 8px rgba(37,99,235,.08)}
.rt-sess{padding:10px 11px}
.rt-sess-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-sess-title{font-weight:600;font-size:12.5px;font-family:ui-monospace,Menlo,monospace;word-break:break-all}
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
.rt-sidehead{padding:7px 8px 2px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:5px}
.rt-sidehead-btn{cursor:pointer;outline:none;padding:6px 6px 5px;border-radius:5px;user-select:none}
.rt-sidehead-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1)}
.rt-sidehead-btn:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-scope{display:inline-block;padding:0 4px;border-radius:3px;font-size:10px;font-weight:700;line-height:15px;flex:none}
.rt-scope-testing{color:#6366f1;background:rgba(99,102,241,.14)}
.rt-hits{display:flex;flex-direction:column;gap:6px;margin-top:7px}
.rt-hit-idx{width:16px;height:16px;border-radius:50%;background:#4d6bfe;color:#fff;font-size:10.5px;font-weight:700;
  display:inline-flex;align-items:center;justify-content:center;flex:none}
.rt-hit-time{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-cred{border-left:3px solid #0ea5e9;padding:7px 9px;margin-bottom:7px}
.rt-cred-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-cred-host{font-family:ui-monospace,Menlo,monospace;font-weight:600;font-size:12.5px;word-break:break-all}
.rt-secret{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;line-height:1.6;background:color-mix(in srgb,var(--wb-blue,#4d6bfe) 10%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);
  border:1px solid #4d6bfe55;border-radius:5px;padding:6px 9px;margin-top:6px;white-space:pre-wrap;word-break:break-all;user-select:all;cursor:text}
.rt-secret-none{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--dsw-alias-state-error-primary);
  border:1px dashed var(--dsw-alias-state-error-primary);border-radius:5px;padding:5px 9px;margin-top:6px}
.rt-cred-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:5px;word-break:break-word}
.rt-live-dot{width:8px;height:8px;border-radius:50%;background:#4d6bfe;flex:none;animation:rt-pulse 1.6s ease-in-out infinite}
.rt-live-dot.idle{background:#94a3b8;animation:none}
.rt-atest{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid #4d6bfe;border-radius:6px;
  padding:7px 10px;background:var(--dsw-alias-bg-layer-2);margin-bottom:6px}
.rt-atest.past{border-left-color:#94a3b8;opacity:.85}
.rt-atest-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.rt-atest-ip{font-family:ui-monospace,Menlo,monospace;font-weight:600;font-size:12.5px;word-break:break-all}
.rt-atest-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:3px;word-break:break-word}
.rt-atest-notes{font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;
  word-break:break-word;background:var(--dsw-alias-bg-base);border-radius:4px;padding:5px 7px;margin-top:4px;max-height:76px;overflow:auto}
.rt-concl{display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);
  background:color-mix(in srgb,var(--dsw-alias-bg-layer-1) 70%,transparent);flex-wrap:wrap}
.rt-concl-i{display:inline-flex;align-items:baseline;gap:4px;padding:2px 9px;border-radius:999px;cursor:pointer;
  border:1px solid transparent;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 58%,transparent);transition:background .12s,border-color .12s}
.rt-concl-i:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.rt-concl-i.on{border-color:#4d6bfe;background:rgba(77,107,254,.11)}
.rt-concl-i b{font-family:ui-monospace,Menlo,monospace;font-size:14px;font-weight:700}
.rt-concl-i>span{color:var(--dsw-alias-label-secondary);font-size:11.5px}
.rt-more{color:var(--wb-blue,var(--dsw-alias-brand-primary));font-size:11.5px;cursor:pointer;user-select:none;margin-top:4px;display:inline-block}
.rt-more:hover{text-decoration:underline}

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
.rt-sec-body>.rt-atest:last-child{margin-bottom:2px}

.rt-clip{margin-top:6px}
.rt-clip-head{display:flex;align-items:center;gap:6px}
.rt-clip-label{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:600}
.rt-clip-body{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;line-height:1.65;white-space:pre-wrap;
  word-break:break-word;background:var(--dsw-alias-bg-base);border-radius:5px;padding:6px 8px;margin-top:3px}
.rt-clip:not(.open) .rt-clip-body{max-height:46px;overflow:hidden;
  -webkit-mask-image:linear-gradient(180deg,#000 55%,transparent);mask-image:linear-gradient(180deg,#000 55%,transparent)}
.rt-clip.open .rt-clip-body{max-height:340px;overflow:auto}
.rt-flow-pts{margin-left:auto;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;font-weight:700;color:#1e40af;
  background:#dbeafe;border:1px solid #4d6bfe55;border-radius:10px;padding:0 8px;white-space:nowrap}
.rt-rep-list{padding:10px 12px 14px}
.rt-rep-tools{display:flex;gap:6px;justify-content:flex-end;margin-bottom:8px}
.rt-rep{border-left:3px solid #4d6bfe;padding:9px 11px;margin-bottom:10px}
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
.rt-rep-trace{margin-top:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;padding:8px 10px;background:var(--dsw-alias-bg-base)}
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
.rt-rep-step-cmd .rt-mono{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:2px 6px;word-break:break-all}
.rt-rep-step-result{font-size:11.5px;margin-top:3px;word-break:break-word}
.rt-rep-src{margin-top:6px;padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l1)}
.rt-rep-src-title{font-weight:600;font-size:12px;margin-bottom:3px}
.rt-ap-cum{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.rt-ap-sub{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:6px 0 3px}
.rt-hit-row{display:flex;flex-wrap:wrap;align-items:center;gap:2px 7px;font-size:11.5px;padding:4px 7px;border-radius:5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);margin-bottom:3px}
.rt-hit-asset{font-family:ui-monospace,Menlo,monospace;font-weight:600;flex:0 1 auto;max-width:100%;overflow-wrap:anywhere;word-break:break-word}
.rt-hit-txt{flex:1 1 100%;color:var(--dsw-alias-label-primary);line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
.rt-hit-txt.none{color:var(--dsw-alias-state-error-primary)}
.rt-hit-row .rt-hit-time{flex:none;margin-left:auto}
.rt-hit-row.self-created{opacity:.72;border-left:3px solid #ef444488}
.rt-hit-row.service-capped{opacity:.72;border-left:3px solid #f59e0b88}
.rt-hit-row.service-capped .rt-hit-idx{background:#f59e0b}
.rt-rep-group{margin-bottom:14px}
.rt-rep-stage{display:flex;align-items:center;gap:8px;padding:7px 10px;margin-bottom:7px;
  background:var(--dsw-alias-bg-layer-2);border-left:4px solid #64748b;border-radius:6px;cursor:pointer;outline:none;user-select:none}
.rt-rep-stage:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-rep-stage:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-rep-no{width:20px;height:20px;border-radius:5px;color:#fff;font-size:11px;font-weight:700;flex:none;
  display:inline-flex;align-items:center;justify-content:center}
.rt-rep-stage-name{font-weight:700;font-size:13px}
.rt-rep-stage-n{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-rep-pts{font-size:11px;font-weight:600;padding:1px 6px;border-radius:5px;border:1px solid transparent;flex:none}
.rt-rep-body{padding-left:6px}

.rt-kb-filter{display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-kb-cats{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.rt-kb-cat{display:flex;align-items:center;gap:7px;padding:7px 10px;background:var(--dsw-alias-bg-layer-2);
  border-bottom:1px solid var(--dsw-alias-border-l1);position:sticky;top:0;z-index:1}
.rt-kb-cat-name{font-weight:600;font-size:12.5px}
.rt-avail{display:inline-block;padding:0 5px;border-radius:999px;font-size:10.5px;white-space:nowrap;
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary)}
.rt-avail-available{color:#4d6bfe;border-color:#4d6bfe55;background:#4d6bfe1a}
.rt-avail-broken{color:#ef4444;border-color:#ef444455;background:#ef44441a}
.rt-avail-unknown{color:#94a3b8;border-color:#94a3b855;background:#94a3b81a}
.rt-kb-check{display:flex;align-items:center;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer}
.rt-kb{margin:0 0 8px;overflow:hidden}
.rt-kb.open{border-color:var(--wb-blue,var(--dsw-alias-brand-primary))}
.rt-kb-head{display:flex;align-items:center;gap:7px;padding:8px 10px;cursor:pointer;outline:none;flex-wrap:wrap}
.rt-kb-head:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-kb-head:focus-visible{outline:2px solid var(--wb-blue,var(--dsw-alias-brand-primary));outline-offset:-2px}
.rt-kb-title{font-weight:600;font-size:12.5px;overflow-wrap:anywhere}
.rt-kb-kind{font-size:10px;font-weight:700;letter-spacing:.4px;padding:1px 5px;border-radius:4px;
  color:#fff;background:#64748b;flex:none}
.rt-kb-kind.k-exp{background:#2563eb}.rt-kb-kind.k-poc{background:#4d6bfe}.rt-kb-kind.k-template{background:#6366f1}
.rt-kb-kind.k-script{background:#0ea5e9}.rt-kb-kind.k-payload{background:#0284c7}
.rt-kb-sub{font-size:11px;color:var(--dsw-alias-label-secondary);padding:0 9px 7px;overflow-wrap:anywhere}
.rt-kb-body{padding:0 9px 9px}
.rt-kb-actions{display:flex;gap:6px;margin:7px 0}
.rt-kb-body .rt-kv span{overflow-wrap:anywhere;word-break:break-word}
.rt-kb-tpl{margin-top:12px;border-top:1px dashed var(--dsw-alias-border-l1);padding-top:8px}
.rt-kb-tpl-row{display:flex;align-items:center;gap:7px;font-size:11.5px;padding:3px 7px;border-radius:5px;
  background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);margin-bottom:3px}
.rt-kb-tpl-path{flex:0 1 auto;font-weight:600;overflow-wrap:anywhere}
.rt-kb-tpl-name{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.rt-md{flex:1;overflow:auto;margin:0;padding:14px 16px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;
  line-height:1.65;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-base)}

.rt-markdown{flex:1;overflow:auto;padding:12px 14px;font-size:12.5px;line-height:1.7;
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);word-break:break-word}
.rt-markdown>:first-child{margin-top:0}
.rt-markdown>:last-child{margin-bottom:0}
.rt-markdown h1,.rt-markdown h2,.rt-markdown h3,.rt-markdown h4,.rt-markdown h5,.rt-markdown h6{margin:12px 0 6px;font-weight:600;line-height:1.35}
.rt-markdown h1{font-size:16px}.rt-markdown h2{font-size:14px}.rt-markdown h3{font-size:13px}.rt-markdown h4,.rt-markdown h5,.rt-markdown h6{font-size:12.5px}
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
.rt-markdown th,.rt-markdown td{border:1px solid var(--dsw-alias-border-l1);padding:4px 7px;text-align:left;vertical-align:top;word-break:break-word;overflow-wrap:anywhere}
.rt-markdown th{background:var(--dsw-alias-bg-layer-1);font-weight:600}
.rt-markdown blockquote{margin:0 0 9px;padding:4px 10px;border-left:3px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1)}
.rt-markdown hr{border:0;border-top:1px solid var(--dsw-alias-border-l1);margin:10px 0}
.rt-markdown strong{font-weight:600}

.rt-shots{margin:8px 0 4px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1)}
.rt-shots-head{display:flex;align-items:baseline;gap:8px;font-size:11.5px;margin-bottom:6px}
.rt-shots-n{color:var(--dsw-alias-label-secondary)}
.rt-shot-row{display:flex;gap:8px;flex-wrap:wrap}
.rt-shot{display:flex;flex-direction:column;gap:3px;max-width:220px}
.rt-shot-thumb{border:1px solid var(--dsw-alias-border-l1);border-radius:5px;background:#0b1020;object-fit:contain;display:block;width:auto;max-width:216px}
.rt-shot-loading{display:flex;align-items:center;justify-content:center;width:150px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-shot-cap{display:flex;align-items:center;gap:5px;font-size:10.5px;overflow-wrap:anywhere}
.rt-shot-label{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}
.rt-shot-zoom{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.82);display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:10px;cursor:zoom-out;padding:18px}
.rt-shot-zoom img{max-width:96vw;max-height:86vh;border-radius:6px;box-shadow:0 18px 48px rgba(0,0,0,.5)}
.rt-shot-zoom-cap{color:#e5e7eb;font-size:12px;text-align:center;max-width:90vw;overflow-wrap:anywhere}

.rt-skill-row{display:flex;align-items:center;gap:6px;padding:5px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer;min-width:0}
.rt-skill-row:hover{background:var(--dsw-alias-bg-layer-2)}
.rt-skill-row.on{background:var(--dsw-alias-bg-layer-2);border-left:2px solid var(--dsw-alias-brand-primary)}
.rt-skill-row.broken{background:rgba(245,158,11,.06)}
.rt-skill-main{flex:1;min-width:0}
.rt-skill-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-skill-desc{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-concl-group{font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-secondary);border-left:2px solid rgba(77,107,254,.4);padding-left:7px;margin:0 2px}
.rt-concl-extra{font-size:11px;color:var(--dsw-alias-label-secondary)}
.rt-concl-extra summary{cursor:pointer;white-space:nowrap}

.rt-rep-full[open]::before{content:'';position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:9997}
.rt-rep-full[open]>.rt-rep-full-body{position:fixed;inset:3vh 3vw;z-index:9998;background:var(--dsw-alias-bg-layer-1);
  border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:12px 16px;overflow:auto;
  box-shadow:0 24px 64px rgba(0,0,0,.4);max-width:none}
.rt-rep-full[open]>.rt-rep-full-body .rt-markdown{max-height:none}
.rt-rep-full-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}

.rt-ov{padding:0;min-height:0}
.rt-ov-scroll{overflow:auto;padding:14px 18px 20px;flex:1;min-height:0}

.rt-wb-badge{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:600;
  color:var(--wb-blue,#4d6bfe);background:rgba(77,107,254,.1);border:1px solid rgba(77,107,254,.28)}

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

.rt-bento-stack{display:flex;flex-direction:column;gap:12px;margin-bottom:12px}
.rt-bento-row-canvas{display:grid;grid-template-columns:1fr;gap:12px}
.rt-analytics-trio{display:grid}
@media(min-width:1180px){.rt-full .rt-bento-row-canvas{grid-template-columns:1fr}}
.rt-bento-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;
  background:var(--dsw-alias-bg-layer-1);
  box-shadow:0 1px 6px -2px rgba(15,23,42,.05);min-width:0;display:flex;flex-direction:column;gap:8px}
.rt-bento-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rt-bento-title{font-size:13.5px;font-weight:700;letter-spacing:-.01em;display:flex;align-items:center;gap:6px}

.rt-doc-wall{display:grid;grid-template-columns:185px minmax(0,1fr);gap:10px;min-height:240px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-base)}
.rt-doc-strip{border-right:1px solid var(--dsw-alias-border-l1);padding:8px;display:flex;flex-direction:column;gap:4px;background:var(--dsw-alias-bg-layer-2);overflow:auto}
.rt-doc-item{padding:7px 9px;border-radius:7px;cursor:pointer;border:1px solid transparent;display:flex;flex-direction:column;gap:2px}
.rt-doc-item:hover{background:var(--dsw-alias-bg-layer-1)}
.rt-doc-item.on{background:rgba(77,107,254,.12);border-color:rgba(77,107,254,.45)}
.rt-doc-item-title{font-size:11.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-doc-item-sub{font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rt-doc-preview{padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0;overflow:auto;max-height:320px}

.rt-p3-ctrl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.rt-p3-stepper{display:inline-flex;align-items:center;gap:4px}
.rt-p3-step-btn{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;cursor:pointer;padding:0;line-height:1}
.rt-p3-step-btn:hover:not(:disabled){border-color:var(--wb-blue,#4d6bfe);color:var(--wb-blue-ink,#1e40af)}
.rt-p3-step-btn:disabled{opacity:.45;cursor:default}
.rt-p3-step-val{font-size:11.5px;font-weight:600;min-width:34px;text-align:center;font-family:ui-monospace,Menlo,monospace}
.rt-p3-pills{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap}
.rt-p3-pill{
  display:inline-flex;
  align-items:center;
  gap:4px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-secondary);
  border-radius:999px;
  padding:2px 8px;
  font-size:11px;
  line-height:1.35;
  font-weight:500;
  cursor:pointer;
  font-family:inherit;
  transition:border-color .14s ease,background .14s ease,color .14s ease;
}
.rt-p3-pill:hover{
  border-color:var(--dsw-alias-border-l2,#94a3b8);
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-primary);
}
.rt-p3-pill.on{
  background:var(--wb-blue-soft,rgba(77,107,254,.12));
  border-color:color-mix(in srgb,var(--wb-blue,#4d6bfe) 45%,transparent);
  color:var(--wb-blue-ink,#1e40af);
  font-weight:600;
}
body[data-ds-dark-theme] .rt-p3-pill.on{
  color:#93c5fd;
  background:rgba(91,120,255,.22);
  border-color:rgba(96,165,250,.46);
}

.rt-wb-role-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:8px}
@media(min-width:1180px){.rt-full .rt-wb-role-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
.rt-wb-role-card{border:1px solid var(--dsw-alias-border-l1);border-top:3px solid #4d6bfe;border-radius:10px;padding:10px 12px;
  background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px;min-width:0;cursor:pointer;transition:border-color .14s,box-shadow .14s,transform .12s}
.rt-wb-role-card:hover{border-color:#4d6bfe;box-shadow:0 4px 12px rgba(77,107,254,.12);transform:translateY(-1px)}
.rt-wb-role-card.on{border-color:#4d6bfe;background:rgba(77,107,254,.07);box-shadow:0 0 0 1px rgba(77,107,254,.28)}
.rt-wb-role-badge{font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:700;color:var(--wb-blue-ink,#2563eb);background:rgba(77,107,254,.12);border:1px solid rgba(77,107,254,.28);border-radius:999px;padding:1px 7px;white-space:nowrap}
.rt-wb-role-desc{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rt-wb-skill-tag{font-family:ui-monospace,Menlo,monospace;font-size:10px;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--wb-blue-ink,#2563eb);white-space:nowrap}
.rt-wb-recurse-tag{font-size:9.5px;padding:1px 6px;border-radius:99px;background:rgba(99,102,241,.12);color:#4f46e5;border:1px solid rgba(99,102,241,.28);font-weight:600;white-space:nowrap}

body[data-ds-dark-theme] .rt-bento-card,
body[data-ds-dark-theme] .rt-wb-role-card{
  background:var(--dsw-alias-bg-layer-1);
  border-color:var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-primary);
}
body[data-ds-dark-theme] .rt-gain{
  background:rgba(77,107,254,.16);
  color:#93c5fd;
  border-color:rgba(77,107,254,.35);
}
@media(max-width:640px){.rt-wb-role-grid{grid-template-columns:1fr}.rt-doc-wall{grid-template-columns:1fr}}

.rt-settings-shell{
  display:flex;
  flex-direction:column;
  gap:12px;
  width:100%;
  max-width:960px;
  margin:0 auto;
  padding:10px 12px 18px;
  box-sizing:border-box;
  min-width:0;
}
.rt-dock .rt-settings-shell{
  max-width:100%;
  padding:8px 10px 16px;
  gap:10px;
}
.rt-full .rt-settings-shell{
  padding:16px 22px 26px;
  gap:16px;
}
.rt-settings-section{
  display:flex;
  flex-direction:column;
  gap:10px;
  padding:12px 14px;
  border-radius:12px;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-1);
  color:var(--dsw-alias-label-primary);
  box-shadow:0 1px 4px rgba(15,23,42,.04);
  box-sizing:border-box;
  min-width:0;
}
.rt-full .rt-settings-section{
  padding:14px 18px;
  gap:12px;
}
body[data-ds-dark-theme] .rt-settings-section{
  background:var(--dsw-alias-bg-layer-2);
  border-color:var(--dsw-alias-border-l1,rgba(148,163,184,.2));
  box-shadow:0 4px 12px rgba(0,0,0,.22);
}
.rt-settings-section-head{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px;
  flex-wrap:wrap;
  padding-bottom:8px;
  border-bottom:1px solid var(--dsw-alias-border-l1);
}
.rt-settings-section-title{
  margin:0;
  font-size:13.5px;
  font-weight:700;
  color:var(--dsw-alias-label-primary);
  display:inline-flex;
  align-items:center;
  gap:6px;
}
.rt-settings-badge{
  display:inline-flex;
  align-items:center;
  gap:4px;
  padding:2px 8px;
  border-radius:999px;
  font-size:11px;
  font-weight:600;
  line-height:1.35;
  border:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2);
  color:var(--dsw-alias-label-secondary);
  white-space:nowrap;
}
.rt-settings-badge.is-ok{
  color:#059669;
  background:rgba(16,185,129,.12);
  border-color:rgba(16,185,129,.3);
}
.rt-settings-badge.is-warn{
  color:#b45309;
  background:rgba(245,158,11,.12);
  border-color:rgba(245,158,11,.32);
}
body[data-ds-dark-theme] .rt-settings-badge.is-ok{
  color:#34d399;
  background:rgba(16,185,129,.2);
  border-color:rgba(52,211,153,.36);
}
body[data-ds-dark-theme] .rt-settings-badge.is-warn{
  color:#fbbf24;
  background:rgba(245,158,11,.2);
  border-color:rgba(251,191,36,.38);
}
.rt-settings-grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(260px,1fr));
  gap:10px 12px;
  align-items:start;
  width:100%;
  min-width:0;
  box-sizing:border-box;
}
.rt-dock .rt-settings-grid{
  grid-template-columns:1fr;
  gap:10px;
}
.rt-full .rt-settings-grid{
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px 16px;
}
@media(max-width:720px){
  .rt-settings-grid,
  .rt-full .rt-settings-grid{
    grid-template-columns:1fr;
  }
}
.rt-settings-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:8px 12px;
  flex-wrap:wrap;
  padding:8px 0;
  border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1) 68%,transparent);
  min-width:0;
  box-sizing:border-box;
}
.rt-settings-row:first-child{
  padding-top:0;
}
.rt-settings-row:last-child{
  border-bottom:0;
  padding-bottom:0;
}
.rt-settings-row.is-full,
.rt-settings-field.is-full{
  grid-column:1 / -1;
}
.rt-settings-field{
  display:flex;
  flex-direction:column;
  gap:5px;
  min-width:0;
  flex:1 1 200px;
  box-sizing:border-box;
}
.rt-settings-field > label{
  font-size:12px;
  font-weight:600;
  color:var(--dsw-alias-label-primary);
  line-height:1.4;
}
.rt-settings-field input,
.rt-settings-field select,
.rt-settings-field textarea{
  width:100%;
  min-width:0;
  box-sizing:border-box;
}
.rt-settings-hint{
  font-size:11.5px;
  line-height:1.5;
  color:var(--dsw-alias-label-secondary);
  margin:0;
  overflow-wrap:anywhere;
}
.rt-settings-actions{
  display:flex;
  align-items:center;
  justify-content:flex-end;
  gap:8px;
  flex-wrap:wrap;
  margin-top:4px;
  min-width:0;
}
.rt-settings-row > .rt-settings-actions{
  margin-top:0;
  flex:none;
}

@keyframes rt-pulse{
  0%,100%{opacity:1;box-shadow:0 0 0 0 #4d6bfe66}
  50%{opacity:.5;box-shadow:0 0 0 5px #4d6bfe00}
}
@keyframes rt-p5-pulse{
  0%,100%{opacity:1;transform:scale(1)}
  50%{opacity:.45;transform:scale(.92)}
}
@keyframes rt-wire-grow{
  from{stroke-dashoffset:240;opacity:0.25}
  to{stroke-dashoffset:0;opacity:1}
}
@keyframes rt-subnode-spawn{
  0%{opacity:0;transform:translateY(-14px) scale(0.84);filter:blur(3px)}
  65%{opacity:1;transform:translateY(2px) scale(1.02);filter:blur(0)}
  100%{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}
}
@keyframes rt-sonar-ripple{to{opacity:0}}
@keyframes rt-dash-flow{
  to{stroke-dashoffset:-24}
}
@keyframes rt-hub-absorb{
  0%{transform:scale(1)}
  50%{transform:scale(1.03);box-shadow:0 0 0 6px rgba(16,185,129,0.22)}
  100%{transform:scale(1)}
}
@keyframes rt-complete-sheen{
  0%{background-position:-200% 0}
  100%{background-position:200% 0}
}
@keyframes rt-check-stroke{to{stroke-dashoffset:0}}

.rt-p5-spin{
  display:inline-block;
  animation:rt-p5-pulse 1.4s ease-in-out infinite;
}
.rt-anim-spawn{
  animation:rt-subnode-spawn 0.38s cubic-bezier(0.34,1.56,0.64,1) both;
}
.rt-anim-complete{
  background-image:linear-gradient(110deg,transparent 35%,rgba(16,185,129,0.16) 50%,transparent 65%);
  background-size:200% 100%;
  animation:rt-complete-sheen 1.2s ease-out 1;
}
body[data-ds-dark-theme] .rt-anim-complete{
  background-image:linear-gradient(110deg,transparent 35%,rgba(52,211,153,0.22) 50%,transparent 65%);
}
.rt-anim-hub-absorb{
  animation:rt-hub-absorb 0.52s cubic-bezier(0.34,1.56,0.64,1) 1;
}
.rt-wire-flowing{
  stroke-dasharray:6 6;
  animation:rt-dash-flow 0.9s linear infinite;
}
.rt-wire-growing{
  stroke-dasharray:240;
  animation:rt-wire-grow 0.45s cubic-bezier(0.22,1,0.36,1) forwards;
}

@media (prefers-reduced-motion: reduce){
  .rt-live-dot,
  .rt-p5-spin,
  .rt-anim-spawn,
  .rt-anim-complete,
  .rt-anim-hub-absorb,
  .rt-wire-flowing,
  .rt-wire-growing,
  .rt-agent-inspector-drawer{
    animation:none !important;
  }
  .rt-dock,
  .rt-panzoom-stage.smooth-zoom,
  .rt-p4-node-card,
  .rt-tree-wave-card{
    transition:none !important;
  }
}
`


    const LOCALE_STORAGE_KEY = 'lmt_ui_locale'
    let _syncedUiLocale = 'auto'
    let _memoryLocale = null
    const _localeListeners = new Set()

    const normalizeLocalePref = (raw) => {
      const s = String(raw === undefined || raw === null ? '' : raw).trim()
      if (s === 'zh-CN' || s === 'en-US') return s
      if (/^zh\b/i.test(s)) return 'zh-CN'
      if (/^en\b/i.test(s)) return 'en-US'
      return 'auto'
    }

    const readStoredLocale = () => {
      try {
        if (typeof window !== 'undefined' && window && window.localStorage) {
          const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY)
          if (raw === 'zh-CN' || raw === 'en-US') return raw
          return null
        }
      } catch { /* ignore storage error */ }
      return (_memoryLocale === 'zh-CN' || _memoryLocale === 'en-US') ? _memoryLocale : null
    }

    const getLocale = () => {
      const stored = readStoredLocale()
      if (stored === 'zh-CN' || stored === 'en-US') return stored
      if (_syncedUiLocale === 'zh-CN' || _syncedUiLocale === 'en-US') return _syncedUiLocale
      try {
        if (typeof navigator !== 'undefined' && navigator && /^en\b/i.test(navigator.language || '')) {
          return 'en-US'
        }
      } catch { /* ignore */ }
      return 'zh-CN'
    }

    const notifyLocaleListeners = () => {
      const cur = getLocale()
      for (const fn of Array.from(_localeListeners)) {
        try { fn(cur) } catch { /* ignore */ }
      }
    }

    const setLocale = (nextLocale) => {
      const norm = normalizeLocalePref(nextLocale)
      const prev = getLocale()
      let hasStorage = false
      try {
        if (typeof window !== 'undefined' && window && window.localStorage) {
          hasStorage = true
          if (norm === 'zh-CN' || norm === 'en-US') {
            window.localStorage.setItem(LOCALE_STORAGE_KEY, norm)
          } else {
            window.localStorage.removeItem(LOCALE_STORAGE_KEY)
          }
        }
      } catch { hasStorage = false }
      if (!hasStorage) {
        _memoryLocale = (norm === 'zh-CN' || norm === 'en-US') ? norm : null
      } else {
        _memoryLocale = null
      }
      if (norm === 'auto') {
        _syncedUiLocale = 'auto'
      }
      const next = getLocale()
      if (next !== prev) notifyLocaleListeners()
      return next
    }

    const syncLocaleFromSettings = (rawPref) => {
      const prev = getLocale()
      const norm = normalizeLocalePref(rawPref)
      _syncedUiLocale = norm
      const next = getLocale()
      if (next !== prev) notifyLocaleListeners()
      return next
    }

    const t = (zh, en) => (getLocale() === 'en-US' ? (en !== undefined ? en : zh) : zh)

    const useLocale = () => {
      const [, force] = React.useReducer((x) => x + 1, 0)
      React.useEffect(() => {
        const listener = () => force()
        _localeListeners.add(listener)
        return () => { _localeListeners.delete(listener) }
      }, [])
      return getLocale()
    }



    const isFullWindow = () => {
      try {
        const hashVal = String(window.location.hash || '')
        return hashVal === '#lmtagent-full' || hashVal === '#redteam-full'
      } catch { return false }
    }

    const FULL_REQUEST_EVENT = 'rt-open-full'
    const EXIT_FULL_EVENT = 'rt-exit-full'
    const isDesktopShell = () => {
      try {
        const html = document.documentElement
        return html.hasAttribute('data-windows-titlebar') || html.getAttribute('data-platform') === 'darwin'
      } catch { return false }
    }
    const requestFullInPlace = () => {
      try { window.dispatchEvent(new Event(FULL_REQUEST_EVENT)) } catch { /* 旧浏览器 */ }
    }
    const exitFullInPlace = () => {
      try { window.dispatchEvent(new Event(EXIT_FULL_EVENT)) } catch { /* 旧浏览器 */ }
    }
    const formatShortSessionId = (sid) => {
      const raw = String(sid || '').trim()
      if (!raw) return ''
      const stripped = raw.replace(/^session-/i, '')
      return (stripped || raw).slice(0, 8)
    }

    const readStandaloneUrlParams = () => {
      try {
        const search = String((typeof window !== 'undefined' && window.location && window.location.search) || '')
        if (!search) return { session: null, engagement: null, tab: null }
        const p = new URLSearchParams(search)
        return {
          session: p.get('lmt_session') || null,
          engagement: p.get('lmt_eng') || null,
          tab: p.get('lmt_tab') || null,
        }
      } catch {
        return { session: null, engagement: null, tab: null }
      }
    }

    const openStandaloneWindow = (opts) => {
      const options = opts && typeof opts === 'object' ? opts : {}
      const baseHref = (() => {
        try { return String(window.location.href || '').split('#')[0] } catch { return '' }
      })()
      const payload = {
        op: 'openStandaloneWindow',
        url: baseHref || undefined,
        session: options.session || undefined,
        engagement: options.engagement || undefined,
        tab: options.tab || undefined,
      }
      const fallbackPopup = (targetUrl) => {
        const href = targetUrl || (baseHref ? (baseHref + '#lmtagent-full') : '#lmtagent-full')
        let win = null
        try {
          if (typeof window !== 'undefined' && typeof window.open === 'function') {
            win = window.open(href, 'lmtagent-standalone', 'popup=yes,width=1440,height=920')
          }
        } catch { win = null }
        if (win === null || win === undefined) {
          requestFullInPlace()
          return { ok: true, launched: false, mode: 'in-place-full' }
        }
        return { ok: true, launched: true, mode: 'popup', url: href }
      }
      return api(payload).then((res) => {
        if (res && res.ok && res.launched) {
          try { if (typeof setUI === 'function') setUI({ open: false }) } catch { /* ignore */ }
          return res
        }
        return fallbackPopup(res && res.url ? res.url : null)
      }).catch(() => fallbackPopup(null))
    }

    const openFullView = (opts) => openStandaloneWindow(opts)

    let _lastHostSeq = 0

    const api = (req, extraPayload) => {
      let bodyObj
      if (typeof req === 'string') {
        bodyObj = Object.assign(
          { op: req },
          (extraPayload && typeof extraPayload === 'object') ? extraPayload : {}
        )
      } else if (req && typeof req === 'object') {
        bodyObj = (extraPayload && typeof extraPayload === 'object')
          ? Object.assign({}, req, extraPayload)
          : req
      } else {
        bodyObj = {}
      }
      if (bodyObj.withSinceSeq === true) {
        const cloned = Object.assign({}, bodyObj)
        delete cloned.withSinceSeq
        if (cloned.sinceSeq === undefined && _lastHostSeq > 0) {
          cloned.sinceSeq = _lastHostSeq
        }
        bodyObj = cloned
      }
      if (typeof fetch !== 'function') {
        return Promise.resolve({ ok: false, error: 'fetch unavailable' })
      }
      return fetch('/lmtagent/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyObj),
      }).then((res) => {
        if (res && typeof res.text === 'function') {
          return res.text().then((txt) => {
            if (!txt || !txt.trim()) return { ok: false, emptyResponse: true, error: t('后端服务正在就绪，请稍候点击「刷新」重试', 'Backend service is starting up; please retry with Refresh.') }
            try {
              const parsed = JSON.parse(txt)
              if (parsed && typeof parsed === 'object' && Number.isFinite(Number(parsed.seq))) {
                const s = Number(parsed.seq)
                if (s > _lastHostSeq) _lastHostSeq = s
              }
              return parsed
            } catch {
              return { ok: false, emptyResponse: true, error: t('后端响应格式异常（HTTP ' + (res.status || 0) + '）', 'Invalid backend response (HTTP ' + (res.status || 0) + ')') }
            }
          })
        }
        if (res && typeof res.json === 'function') {
          return res.json().then((parsed) => {
            if (parsed && typeof parsed === 'object' && Number.isFinite(Number(parsed.seq))) {
              const s = Number(parsed.seq)
              if (s > _lastHostSeq) _lastHostSeq = s
            }
            return parsed
          })
        }
        return { ok: false, error: t('未知响应', 'Unknown response') }
      }).catch((err) => ({
        ok: false,
        error: err && err.message ? err.message : String(err || t('网络请求异常', 'Network request failed')),
      }))
    }

    const _sseListeners = new Set()
    let _sseSource = null
    let _sseReconnectTimer = null

    const _notifySseListeners = (evtPayload) => {
      if (evtPayload && typeof evtPayload === 'object' && Number.isFinite(Number(evtPayload.seq))) {
        const s = Number(evtPayload.seq)
        if (s > _lastHostSeq) _lastHostSeq = s
      }
      for (const fn of Array.from(_sseListeners)) {
        try { fn(evtPayload || {}) } catch { /* 单个订阅异常不影响全局 */ }
      }
    }

    const _ensureSseConnected = () => {
      if (_sseSource || _sseListeners.size === 0) return
      const ES = (typeof EventSource === 'function')
        ? EventSource
        : (typeof window !== 'undefined' && window && typeof window.EventSource === 'function' ? window.EventSource : null)
      if (!ES) return
      try {
        const url = _lastHostSeq > 0 ? ('/lmtagent/events?sinceSeq=' + _lastHostSeq) : '/lmtagent/events'
        const src = new ES(url)
        _sseSource = src
        const handleMsg = (ev) => {
          let data = {}
          try { data = ev && ev.data ? JSON.parse(ev.data) : {} } catch { data = { raw: ev && ev.data } }
          _notifySseListeners(data)
        }
        src.onmessage = handleMsg
        if (typeof src.addEventListener === 'function') {
          src.addEventListener('change', handleMsg)
          src.addEventListener('update', handleMsg)
          src.addEventListener('dag', handleMsg)
        }
        src.onerror = () => {
          try { src.close() } catch { /* ignore */ }
          if (_sseSource === src) _sseSource = null
          if (_sseListeners.size > 0 && !_sseReconnectTimer && typeof setTimeout === 'function') {
            _sseReconnectTimer = setTimeout(() => {
              _sseReconnectTimer = null
              _ensureSseConnected()
            }, 5000)
          }
        }
      } catch {
        _sseSource = null
      }
    }

    const _teardownSseIfIdle = () => {
      if (_sseListeners.size > 0) return
      if (_sseReconnectTimer && typeof clearTimeout === 'function') {
        clearTimeout(_sseReconnectTimer)
        _sseReconnectTimer = null
      }
      if (_sseSource) {
        try { _sseSource.close() } catch { /* ignore */ }
        _sseSource = null
      }
    }

    const subscribeHostEvents = (engagement, onRefresh, throttleMs) => {
      if (engagement === false) return () => {}
      const hasES = (typeof EventSource === 'function')
        || (typeof window !== 'undefined' && window && typeof window.EventSource === 'function')
      if (!hasES) return () => {}
      const minGap = Number(throttleMs) > 0 ? Number(throttleMs) : 600
      let lastFire = 0
      let trailingTimer = null
      const listener = (payload) => {
        if (payload && (payload.type === 'heartbeat' || payload.type === 'ping')) return
        const targetEng = payload && (payload.engagement_id || payload.engagement)
        if (targetEng && engagement && targetEng !== engagement) return
        const now = Date.now()
        const elapsed = now - lastFire
        if (elapsed >= minGap) {
          lastFire = now
          if (typeof onRefresh === 'function') onRefresh(payload)
        } else if (!trailingTimer && typeof setTimeout === 'function') {
          trailingTimer = setTimeout(() => {
            trailingTimer = null
            lastFire = Date.now()
            if (typeof onRefresh === 'function') onRefresh(payload)
          }, Math.max(120, minGap - elapsed))
        }
      }
      _sseListeners.add(listener)
      _ensureSseConnected()
      return () => {
        if (trailingTimer && typeof clearTimeout === 'function') clearTimeout(trailingTimer)
        _sseListeners.delete(listener)
        _teardownSseIfIdle()
      }
    }

    function useHostEvents(engagement, onRefresh, throttleMs) {
      const cbRef = React.useRef(onRefresh)
      cbRef.current = onRefresh
      const minGap = Number(throttleMs) > 0 ? Number(throttleMs) : 600

      React.useEffect(
        () => subscribeHostEvents(engagement, (payload) => {
          if (typeof cbRef.current === 'function') cbRef.current(payload)
        }, minGap),
        [engagement, minGap]
      )
    }

    const SHOT_CACHE_MAX = 64
    const shotCache = new Map()
    const shotLoading = new Map()
    let _shotCacheEng = null

    const clearShotCache = (nextEng) => {
      if (nextEng !== undefined) {
        if (_shotCacheEng === nextEng) return
        _shotCacheEng = nextEng
      }
      shotCache.clear()
      shotLoading.clear()
    }

    const shotCacheSet = (key, val) => {
      if (shotCache.has(key)) shotCache.delete(key)
      while (shotCache.size >= SHOT_CACHE_MAX) {
        const oldestKey = shotCache.keys().next().value
        if (oldestKey === undefined) break
        shotCache.delete(oldestKey)
      }
      shotCache.set(key, val)
    }

    const shotSrc = (eng, id) => {
      const key = eng + ':' + id
      if (!shotCache.has(key)) return null
      const val = shotCache.get(key)

      shotCache.delete(key)
      shotCache.set(key, val)
      return val || null
    }

    const loadShot = (eng, id) => {
      if (_shotCacheEng !== null && eng && _shotCacheEng !== eng) {
        clearShotCache(eng)
      } else if (_shotCacheEng === null && eng) {
        _shotCacheEng = eng
      }
      const key = eng + ':' + id
      if (shotCache.has(key) || shotLoading.has(key)) return
      const p = api({ op: 'shotData', engagement: eng, id: id }).then((r) => {
        shotCacheSet(key, r && r.base64 ? 'data:' + (r.mime || 'image/png') + ';base64,' + r.base64 : '')
        shotLoading.delete(key)
        for (const f of Array.from(subs)) f()
      }).catch(() => { shotLoading.delete(key) })
      shotLoading.set(key, p)
    }
    const shotKindLabel = (kind) => {
      if (kind === 'screenshot') return t('现场截图', 'Live Screenshot')
      if (kind === 'card') return t('记录生成的证据摘录', 'Generated Evidence Card')
      return kind || t('证据', 'Evidence')
    }

    const ShotImage = ({ eng, shot, height }) => {
      useLocale()
      const [zoom, setZoom] = React.useState(false)
      const src = shotSrc(eng, shot.id)
      if (src === null) { loadShot(eng, shot.id) }
      const card = shot.kind === 'card'
      return h('div', { className: 'rt-shot' },
        src === null
          ? h('div', { className: 'rt-shot-thumb rt-shot-loading', style: { height: (height || 96) + 'px' } }, t('载入中…', 'Loading...'))
          : h('img', {
              className: 'rt-shot-thumb', src: src, alt: shot.label || (t('证据 ', 'Evidence ') + shot.id),
              style: { height: (height || 96) + 'px', cursor: 'zoom-in' },
              onClick: () => setZoom(true),
            }),
        h('div', { className: 'rt-shot-cap' },
          h('span', { className: 'rt-tag ' + (card ? 'rt-tag-warn' : 'rt-tag-live'), title: card
            ? t('由当日记录生成的证据摘录，不是现场截图 —— 报告里同样会标注', 'Evidence card generated from session logs (not a live screenshot)')
            : t('现场截图', 'Live Screenshot') }, shotKindLabel(shot.kind)),
          h('span', { className: 'rt-shot-label', title: shot.label || shot.note || '' },
            shot.label || shot.target || ('#' + shot.id))),
        zoom
          ? h('div', { className: 'rt-shot-zoom', onClick: () => setZoom(false) },
              h('img', { src: src, alt: shot.label || '' }),
              h('div', { className: 'rt-shot-zoom-cap' }, (shot.label || shot.target || '')
                + (card ? t('　·　由当日记录生成（非现场截图）', ' · Generated from log (not live screenshot)') : '')
                + (shot.captured_at ? '　·　' + fmt(shot.captured_at) : '')
                + t('　·　点击任意处关闭', ' · Click anywhere to close')))
          : null)
    }

    const ShotStrip = ({ eng, shots, total, title }) => {
      useLocale()
      const list = shots || []
      if (list.length === 0) return null
      return h('div', { className: 'rt-shots' },
        h('div', { className: 'rt-shots-head' },
          h('b', null, title || t('证据截图', 'Evidence Screenshots')),
          h('span', { className: 'rt-shots-n' }, t('显示 ' + list.length + ' 张', 'Showing ' + list.length)
            + (total && total > list.length ? t('（该项共 ' + total + ' 张，取代表图）', ' (' + total + ' total, sample)') : ''))),
        h('div', { className: 'rt-shot-row' }, list.map((sh) => h(ShotImage, { key: 'sh' + sh.id, eng: eng, shot: sh }))))
    }

    const UI_MODE_KEY = 'rt-ui-mode'
    const readInitialUiMode = () => {
      try {
        const saved = window.localStorage.getItem(UI_MODE_KEY)
        return saved === 'novice' ? 'novice' : 'expert'
      } catch {
        return 'expert'
      }
    }

    let ui = { open: true, tab: 'overview', uiMode: readInitialUiMode() }
    const subs = new Set()
    const setUI = (patch) => {
      if (patch && (patch.uiMode === 'novice' || patch.uiMode === 'expert')) {
        try { window.localStorage.setItem(UI_MODE_KEY, patch.uiMode) } catch { /* ignore */ }
      }
      ui = Object.assign({}, ui, patch)
      for (const f of Array.from(subs)) f()
    }
    const setUiMode = (mode) => {
      const next = mode === 'novice' ? 'novice' : 'expert'
      setUI({ uiMode: next })
    }

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

    const FOLLOW_SOURCE = {
      bound: '落盘绑定',
      title: '会话标题',
      last: '上次选择',
      default: '默认单位',
      unbound: '待初始化',
      skipped: '已跳过指引',
    }
    const FOLLOW_SOURCE_EN = {
      bound: 'Bound',
      title: 'Session Title',
      last: 'Last Picked',
      default: 'Default',
      unbound: 'Pending Init',
      skipped: 'Guide Skipped',
    }
    const followSourceLabel = (src) => (
      getLocale() === 'en-US'
        ? (FOLLOW_SOURCE_EN[src] || FOLLOW_SOURCE[src] || src || '')
        : (FOLLOW_SOURCE[src] || src || '')
    )

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

    const sessionMetaOf = (props) => {
      const id = sessionIdOf(props)
      const useSessions = props && props.useSessions
      let row = null
      if (typeof useSessions === 'function') {
        try {
          const st = useSessions((s) => s)
          row = st && st.byId && id ? st.byId[id] : null
        } catch (e) { row = null }
      }
      const rawTitle = row && typeof row.displayTitle === 'string' && row.displayTitle
        ? row.displayTitle
        : (row && typeof row.title === 'string' && row.title ? row.title : null)
      const title = rawTitle && rawTitle !== id ? rawTitle : null
      const cwd = (row && (row.cwd || row.workspace || (row.header && row.header.cwd))) || null
      const blank = Boolean(row && row.blank)
      const hasConversation = (row && typeof row.blank === 'boolean')
        ? !row.blank
        : (row && Array.isArray(row.messages)
          ? row.messages.length > 0
          : (Number((row && (row.turnCount || row.turns)) || 0) > 0 ? true : undefined))
      return {
        id: id,
        title: title,
        cwd: cwd,
        blank: blank,
        hasConversation: hasConversation,
      }
    }

    function useScopedSession(props, embedMode) {
      const globalSess = useSession()
      const propSid = sessionIdOf(props)
      const meta = sessionMetaOf(props)
      const isScoped = Boolean((embedMode === 'session' || propSid) && propSid)
      const resolvedTitle = meta.title || (globalSess.id === propSid ? globalSess.title : null)

      React.useEffect(() => {
        if (isScoped && propSid) {
          setSessionId(propSid, meta.title || (globalSess.id === propSid ? globalSess.title : null))
        }
      }, [isScoped, propSid, meta.title])

      if (isScoped) {
        return {
          id: propSid,
          title: resolvedTitle,
          cwd: meta.cwd,
          hasConversation: meta.hasConversation,
          authoritative: true,
        }
      }
      return {
        id: globalSess.id,
        title: globalSess.title,
        cwd: null,
        hasConversation: undefined,
        authoritative: false,
      }
    }

    const POC_CAT_NAME = {
      rce: '核心计算引擎与业务算法', sqli: '数据模型与持久化查询规范', deserialization: '跨端协议与数据序列化契约',
      'file-upload': '静态资源与文件处理流水线', 'auth-bypass': '鉴权策略与开放平台契约', unauthorized: '公开接口与免鉴权数据源',
      'weak-password': '环境配置与密钥防呆基线', ssrf: '服务端代理与跨域网关适配', xxe: '结构化文档与配置解析器',
      'path-traversal': '文件系统边界与路径校验', 'info-leak': '数据脱敏与隐私合规防护', privesc: '并发调度与权限分层模型',
      tunnel: '跨进程通信与联调网关桥接', other: '通用工程模式与组件复刻模板',
    }
    const POC_CAT_NAME_EN = {
      rce: 'Core Compute & Business Algorithms', sqli: 'Data Models & Persistence Queries', deserialization: 'Cross-End Serialization Contracts',
      'file-upload': 'Static Assets & File Pipelines', 'auth-bypass': 'Auth Policies & Open Platform Contracts', unauthorized: 'Public APIs & Unauthenticated Sources',
      'weak-password': 'Env Config & Secret Guardrails', ssrf: 'Server Proxies & CORS Gateways', xxe: 'Structured Docs & Config Parsers',
      'path-traversal': 'Filesystem Boundaries & Path Checks', 'info-leak': 'Data Masking & Privacy Compliance', privesc: 'Concurrency Scheduling & RBAC Models',
      tunnel: 'IPC & Debug Tunnel Bridges', other: 'General Patterns & Component Templates',
    }
    const pocCatLabel = (code) => (
      getLocale() === 'en-US'
        ? (POC_CAT_NAME_EN[code] || POC_CAT_NAME[code] || code)
        : (POC_CAT_NAME[code] || code)
    )
    const POC_CAT_ORDER = Object.keys(POC_CAT_NAME)
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
    const ROLE_LABEL_EN = {
      plan: 'Captain (Orchestrator)',
      recon: 'Product & Planning (CEO)',
      designer: 'UI & Visual Design (Designer)',
      assess: 'Architecture & Sharding (Eng Manager)',
      'vuln-scan': 'Code Review & Security (Reviewer & CSO)',
      exploit: 'Full-Stack Build (Builder)',
      qa: 'QA & Verification (QA Lead)',
      internal: 'Docs & Release (Doc & Release)',
    }
    const roleLabel = (role) => (
      getLocale() === 'en-US'
        ? (ROLE_LABEL_EN[role] || ROLE_LABEL[role] || role)
        : (ROLE_LABEL[role] || role)
    )

    const fmt = (s) => (s ? String(s).replace('T', ' ').slice(0, 16) : '—')
    const fmtShort = (s) => {
      const tStr = String(s || '').replace('T', ' ')
      return tStr.length >= 16 ? tStr.slice(5, 16) : (tStr || '—')
    }
    const provLabel = (p) => (p === 'passive' ? t('被动', 'Passive') : p === 'active' ? t('主动', 'Active') : t('未知', 'Unknown'))

    const clickable = (onActivate, options = {}) => {
      const props = {
        role: 'button',
        tabIndex: 0,
        onClick: onActivate,
        onKeyDown: (e) => {
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

    const copyText = async (text) => {
      const value = text === undefined || text === null ? '' : String(text)
      if (value === '') return false
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(value)
          return true
        }
      } catch (e) { /* 落到兜底方案 */ }
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

    const copyWithFeedback = async (text, label, onResult) => {
      const okFlag = await copyText(text)
      const message = okFlag
        ? t('已复制：' + label, 'Copied: ' + label)
        : t('复制失败（浏览器未授权剪贴板）—— 请手动选中文本复制', 'Copy failed (clipboard permission denied) — please copy manually')
      if (typeof onResult === 'function') onResult(okFlag, message)
      return okFlag
    }

    function ProvTag(props) {
      useLocale()
      if (!props.p) return h('span', { className: 'rt-tag' }, t('未知', 'Unknown'))
      return h('span', { className: 'rt-tag rt-tag-' + props.p }, provLabel(props.p))
    }

    const TEST_LABEL = { untested: '待验证', testing: '验证中', tested: '已验证', blocked: '受阻', abandoned: '已跳过', no_surface: '无需验证' }
    const TEST_LABEL_EN = { untested: 'Untested', testing: 'Testing', tested: 'Verified', blocked: 'Blocked', abandoned: 'Skipped', no_surface: 'No Surface' }
    const testLabel = (st) => (getLocale() === 'en-US' ? (TEST_LABEL_EN[st] || TEST_LABEL[st] || st) : (TEST_LABEL[st] || st))

    const PRI_LABEL = { high: '高', medium: '中', low: '低' }
    const PRI_LABEL_EN = { high: 'High', medium: 'Med', low: 'Low' }
    const priLabel = (p) => (getLocale() === 'en-US' ? (PRI_LABEL_EN[p] || PRI_LABEL[p] || p) : (PRI_LABEL[p] || p))

    function PriTag(props) {
      useLocale()
      if (!props.p) return h('span', { className: 'rt-tag' }, t('未评', 'Unrated'))
      return h('span', { className: 'rt-pri rt-pri-' + props.p, title: props.title || '' }, priLabel(props.p))
    }

    function TestTag(props) {
      useLocale()
      const st = props.s || 'untested'
      return h('span', { className: 'rt-test rt-test-' + st }, testLabel(st))
    }

    const PENDING_APPROVAL_STATES = new Set([
      'pending_approval',
      'waiting_approval',
      'revision_required',
      'blocked',
    ])

    const ConclItem = (key, label, value, active, onClick) => h('span', Object.assign({
      key: key,
      className: 'rt-concl-i' + (active ? ' on' : ''),
      style: onClick ? undefined : { cursor: 'default' },
      title: onClick ? t('点击筛选 / 再点取消', 'Click to filter / click again to clear') : undefined,
    }, onClick ? clickable(onClick, { label: t('按「' + label + '」筛选（' + (value || 0) + '）', 'Filter by "' + label + '" (' + (value || 0) + ')'), expanded: active }) : {}),
      h('b', null, String(value || 0)), h('span', null, label))

    const isRealHostSessionId = (sid, hostSessionList) => {
      const s = String(sid || '').trim()
      if (!s || s === 'root' || s === 'root-main' || s === 'default') return false
      if (/^(?:sub-|agent-|dom-|task-|wish-|custom-|goal-)/i.test(s)) return false
      if (/^session-(?:plan|recon|designer|assess|exploit|qa|vuln-scan|internal)$/i.test(s)) return false
      if (Array.isArray(hostSessionList) && hostSessionList.length > 0) {
        for (let i = 0; i < hostSessionList.length; i += 1) {
          const hs = hostSessionList[i]
          if (!hs) continue
          if (hs.id === s || hs.sessionId === s) return true
          if (Array.isArray(hs.children) && hs.children.some((ch) => ch && (ch.id === s || ch.sessionId === s))) {
            return true
          }
        }
      }
      return /^(?:session-)?[0-9a-f]{8}-[0-9a-f]{4}/i.test(s) || (!s.startsWith('w') && s.length >= 12)
    }

    const openAgentSessionInHostChat = (agent, opts) => {
      const options = opts || {}
      const hostSessions = options.hostSessions
      const candidateSid = (agent && (agent.sessionId || agent.session_id || agent.id)) || ''
      const primarySid = options.sessionId !== undefined ? options.sessionId : sessionId
      const fallbackRealSid = isRealHostSessionId(primarySid, hostSessions)
        ? primarySid
        : (isRealHostSessionId(options.fallbackSessionId, hostSessions) ? options.fallbackSessionId : '')
      const targetSid = isRealHostSessionId(candidateSid, hostSessions) ? candidateSid : fallbackRealSid
      const targetTitle = (agent && (agent.title || agent.name)) || options.sessionTitle || sessionTitle || targetSid || t('当前会话', 'Current Session')

      if (targetSid) {
        setSessionId(targetSid, targetTitle)
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem('dsh.sessions.current', targetSid)
          }
        } catch (e) { /* ignore */ }
      }

      api({
        op: 'activateAgentSession',
        sessionId: targetSid || candidateSid || undefined,
        agentId: agent && (agent.id || agent.worker_id),
        engagement: options.engagement || undefined,
      }).catch(() => {})

      try {
        if (targetSid && typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
          const candidates = document.querySelectorAll(
            '[data-session-id],[data-id],a[href*="session"],[role="treeitem"],[role="option"],li'
          )
          const normTitle = String(targetTitle || '').trim().toLowerCase()
          for (let i = 0; i < candidates.length; i += 1) {
            const el = candidates[i]
            if (!el || typeof el.click !== 'function') continue
            if (typeof el.closest === 'function' && el.closest('.rt-dock, .rt-full, .rt-embed')) continue
            const dsId = (typeof el.getAttribute === 'function')
              ? (el.getAttribute('data-session-id') || el.getAttribute('data-id') || el.getAttribute('href') || '')
              : ''
            const txt = String(el.textContent || '').trim().toLowerCase()
            if (
              (dsId && dsId.includes(targetSid)) ||
              (txt && txt.includes(String(targetSid).toLowerCase())) ||
              (normTitle && txt && (txt === normTitle || txt.includes(normTitle)))
            ) {
              el.click()
              break
            }
          }
        }
      } catch (e) { /* ignore */ }

      exitFullInPlace()
      return { targetSid, targetTitle }
    }

    const COLLAPSE_KEY = 'rt-collapse:'
    const collapseLoad = (prefix) => {
      try {
        const raw = window.localStorage.getItem(COLLAPSE_KEY + prefix)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && typeof parsed === 'object' ? parsed : {}
      } catch (e) { return {} }
    }
    const collapseSave = (prefix, value) => {
      try { window.localStorage.setItem(COLLAPSE_KEY + prefix, JSON.stringify(value)) } catch (e) { /* ignore */ }
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
      useLocale()
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
          }, t('复制', 'Copy')),
          h('button', {
            className: 'rt-btn', style: { padding: '0 6px', fontSize: 11 },
            onClick: (e) => { e.stopPropagation(); setOpen((v) => !v) },
          }, open ? t('收起', 'Collapse') : t('展开', 'Expand'))),
        h('div', { className: 'rt-clip-body' }, text))
    }



    const parseTokNum = (raw) => {
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
      const m = /([\d.]+)\s*([kKmM]?)/.exec(String(raw || '').trim())
      if (!m) return 0
      const num = parseFloat(m[1]) || 0
      const unit = (m[2] || '').toLowerCase()
      const mult = unit === 'm' ? 1000000 : (unit === 'k' ? 1000 : 1)
      return Math.round(num * mult)
    }

    const fmtTokNum = (n) => {
      const val = Number(n) || 0
      if (val >= 1000000) return (val / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M'
      if (val >= 1000) return (val / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
      return String(Math.round(val))
    }

    const parseDshStoredSessionId = (raw) => {
      if (!raw) return null
      if (typeof raw === 'object') {
        const objSid = raw.sessionId || raw.id || raw.currentSessionId || ''
        return typeof objSid === 'string' && objSid.trim() ? objSid.trim() : null
      }
      let s = String(raw).trim()
      if (!s) return null
      if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('"') && s.endsWith('"'))) {
        try {
          const parsed = JSON.parse(s)
          if (typeof parsed === 'string') s = parsed.trim()
          else if (parsed && typeof parsed === 'object') {
            const inner = parsed.sessionId || parsed.id || parsed.currentSessionId || ''
            s = typeof inner === 'string' ? inner.trim() : ''
          }
        } catch { /* keep trimmed raw if unparseable */ }
      }
      return s && !s.startsWith('{') ? s : null
    }

    const isRawUuidName = (s) => {
      const str = String(s || '').trim()
      if (!str) return false
      return /^(?:[a-z0-9_-]+\s*[·-]\s*)?session-[0-9a-f]{8}-[0-9a-f]{4}/i.test(str)
        || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(str)
    }

    const _domTelSignature = (tel) => {
      if (!tel) return ''
      const subsSig = Array.isArray(tel.domSubagents)
        ? tel.domSubagents.map((s) => [s.id, s.title, s.tokenLabel, s.durationLabel, s.status].join(':')).join('|')
        : ''
      return [
        tel.sessionId || '',
        tel.sessionTitle || '',
        tel.workspaceName || '',
        tel.tokens || 0,
        tel.tokenLabel || '',
        tel.rounds || 0,
        tel.steps || 0,
        tel.speedLabel || '',
        tel.cacheHitPct || 0,
        tel.cacheLabel || '',
        tel.contextUsedLabel || '',
        tel.contextMaxLabel || '',
        tel.contextPct || '',
        tel.inputLabel || '',
        tel.outputLabel || '',
        tel.reasoningLabel || '',
        tel.costLabel || '',
        tel.subagentCount || 0,
        subsSig,
      ].join('§')
    }

    let _domTelemCache = { ts: 0, val: null, sig: '' }
    let _isCanvasDragging = false

    const readHostDomTelemetry = () => {
      const emptyTel = {
        sessionId: null,
        sessionTitle: null,
        workspaceName: null,
        tokens: 0,
        tokenLabel: '0',
        rounds: 0,
        steps: 0,
        speedLabel: '0 tok/s',
        cacheHitPct: 0,
        cacheLabel: '待命',
        contextUsedLabel: '',
        contextMaxLabel: '',
        contextPct: '',
        inputLabel: '',
        outputLabel: '',
        reasoningLabel: '',
        costLabel: '',
        subagentCount: 0,
        domSubagents: [],
      }
      if (_isCanvasDragging) {
        return _domTelemCache.val || emptyTel
      }
      const now = Date.now()
      if (now - _domTelemCache.ts < 3000 && _domTelemCache.val) {
        return _domTelemCache.val
      }
      const out = Object.assign({}, emptyTel, { domSubagents: [] })
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const sid = parseDshStoredSessionId(window.localStorage.getItem('dsh.sessions.current'))
          if (sid) out.sessionId = sid
        }
        if (typeof document !== 'undefined' && document.body) {
          const isPluginNode = (node) => {
            if (!node || typeof node !== 'object') return false
            const cls = typeof node.className === 'string' ? node.className : ''
            if (/(?:^|\s)(?:rt-dock|rt-full|rt-embed)(?:\s|$)/.test(cls)) return true
            const tag = String(node.tagName || '').toUpperCase()
            return tag === 'SCRIPT' || tag === 'STYLE'
          }
          const collectHostText = (root) => {
            if (!root || isPluginNode(root)) return ''
            if (typeof root.querySelector === 'function') {
              try {
                if (!root.querySelector('.rt-dock, .rt-full, .rt-embed')) {
                  return (root.textContent || '').slice(0, 6000)
                }
              } catch (e) { /* ignore selector error */ }
            }
            const kids = root.children || root.childNodes
            if (kids && kids.length > 0) {
              const parts = []
              let totalLen = 0
              for (let i = 0; i < kids.length && totalLen < 6000; i += 1) {
                const sub = collectHostText(kids[i])
                if (sub) {
                  parts.push(sub)
                  totalLen += sub.length
                }
              }
              return parts.join('\n').slice(0, 6000)
            }
            return (root.textContent || '').slice(0, 6000)
          }
          const el = document.body
          let text = collectHostText(el)
          if (!text && el.textContent) {
            text = (el.textContent || '').slice(0, 6000)
            if (typeof el.querySelectorAll === 'function') {
              const own = el.querySelectorAll('.rt-dock, .rt-full, .rt-embed')
              for (let i = 0; i < own.length; i += 1) {
                const ownTxt = (own[i].textContent || '').slice(0, 6000).trim()
                if (ownTxt) text = text.split(ownTxt).join('\n')
              }
            }
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

          const tokMatch = /(?:tok\/s\s+|用量\s*)([\d.]+)\s*([kKmM]?)\s*tok\b/i.exec(text)
            || /([\d.]+)\s*([kKmM])\s*tok\s*(?:·|\s)*(?:缓存命中|上下文)/i.exec(text)
            || /([\d.]+)\s*([kKmM])\s*tok\b(?!\s*\/)/i.exec(text)
          if (tokMatch) {
            const num = parseFloat(tokMatch[1]) || 0
            const rawUnit = tokMatch[2] || ''
            const unit = rawUnit.toLowerCase()
            const mult = unit === 'm' ? 1000000 : (unit === 'k' ? 1000 : 1)
            out.tokens = Math.round(num * mult)
            out.tokenLabel = tokMatch[1] + (rawUnit ? rawUnit : '')
          }

          const cacheMatch = /命中\s*(\d+\.\d+)%/.exec(text)
            || /(?:缓存命中|命中)\s*([\d.]+)%/.exec(text)
          if (cacheMatch) {
            out.cacheHitPct = parseFloat(cacheMatch[1]) || 0
            out.cacheLabel = '缓存命中 ' + cacheMatch[1] + '%'
          }

          const ctxMatch = /上下文\s*([\d.]+[kKmM]?)\s*\/\s*([\d.]+[kKmM]?)/.exec(text)
          if (ctxMatch) {
            out.contextUsedLabel = ctxMatch[1]
            out.contextMaxLabel = ctxMatch[2]
          }
          const ctxPctMatch = /推理\s*[\d.]+[kKmM]?\s+(\d+(?:\.\d+)?)%/.exec(text)
          if (ctxPctMatch) {
            out.contextPct = ctxPctMatch[1] + '%'
          } else if (out.contextUsedLabel && out.contextMaxLabel) {
            const u = parseTokNum(out.contextUsedLabel)
            const m = parseTokNum(out.contextMaxLabel)
            if (u > 0 && m > 0) out.contextPct = Math.round((u / m) * 100) + '%'
          }

          const inMatch = /输入\s*([\d.]+[kKmM]?)/.exec(text)
          if (inMatch) out.inputLabel = inMatch[1]
          const outMatch = /输出\s*([\d.]+[kKmM]?)/.exec(text)
          if (outMatch) out.outputLabel = outMatch[1]
          const reasonMatch = /推理\s*([\d.]+[kKmM]?)/.exec(text)
          if (reasonMatch) out.reasoningLabel = reasonMatch[1]

          const costMatch = /(?:本轮费用|费用)\s*[≈~]?\s*(¥[\d.]+)/.exec(text)
            || /(¥[\d.]+)/.exec(text)
          if (costMatch) out.costLabel = costMatch[1]

          const subCntMatch = /(\d+)\s*个子智能体/.exec(text)
          if (subCntMatch) out.subagentCount = parseInt(subCntMatch[1], 10) || 0
          const waveRe = /Wave\s*(\d)\s+([a-z-]+)\s+([^\n·•]+?)\s+([\d.]+[kKmM]?\s*tok)\s*[·•]\s*([^\n]+)/gi
          let wm
          const seenSub = new Set()
          while ((wm = waveRe.exec(text)) !== null) {
            const waveNo = parseInt(wm[1], 10) || 1
            const roleCode = String(wm[2] || '').toLowerCase()
            const shortTitle = String(wm[3] || '').trim()
            const tokStr = String(wm[4] || '').trim()
            const durStr = String(wm[5] || '').trim()
            const fullTitle = 'Wave' + waveNo + ' ' + roleCode + ' ' + shortTitle
            if (seenSub.has(fullTitle)) continue
            seenSub.add(fullTitle)
            out.domSubagents.push({
              id: 'dom-w' + waveNo + '-' + roleCode + '-' + out.domSubagents.length,
              wave: waveNo,
              role: roleCode,
              title: fullTitle,
              shortTitle: shortTitle,
              tokenLabel: tokStr,
              tokens: parseTokNum(tokStr),
              durationLabel: durStr,
              status: /运行中|正在|running|active/i.test(durStr) ? 'running' : 'done',
            })
          }
          if (out.domSubagents.length > out.subagentCount) {
            out.subagentCount = out.domSubagents.length
          }
        }
      } catch (e) { /* DOM 读取异常不阻断渲染 */ }

      const nextSig = _domTelSignature(out)
      if (_domTelemCache.val && _domTelemCache.sig === nextSig) {
        _domTelemCache.ts = now
        return _domTelemCache.val
      }
      _domTelemCache = { ts: now, val: out, sig: nextSig }
      return out
    }



    const NOVICE_WAVE_MILESTONES = {
      1: '第 1 步：理清需求与界面设计',
      2: '第 2 步：划分模块边界',
      3: '第 3 步：分头编写代码',
      4: '第 4 步：自动测试与验收',
    }

    const NOVICE_WAVE_MILESTONES_EN = {
      1: 'Step 1: Clarify Specs & UI Design',
      2: 'Step 2: Lock Architecture & Shards',
      3: 'Step 3: Parallel Implementation',
      4: 'Step 4: Auto Test & Verification',
    }

    const formatWaveHeaderByMode = (waveNo, defaultHeader, uiMode) => {
      if (uiMode === 'novice' && NOVICE_WAVE_MILESTONES[waveNo]) {
        return t(NOVICE_WAVE_MILESTONES[waveNo], NOVICE_WAVE_MILESTONES_EN[waveNo] || defaultHeader)
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
    ].map(([value, wave]) => ({ value, wave }))

    const DEMO_WISH_PRESETS = [
      {
        id: 'orderflow-demo',
        workspace: 'OrderFlow-Demo',
        labelZh: '示例：全栈订单工作台',
        labelEn: 'Demo: Full-Stack Order Workbench',
        promptZh: '构建「OrderFlow」全栈订单工作台：\n1. 数据模型与 Schema：定义 orders / order_items / order_events 表结构及索引，约束合法状态流转。\n2. 后端状态机与 API：实现创建、支付确认、发货、取消与退款幂等状态机及 REST 接口校验。\n3. React 订单列表 UI：支持按状态筛选、关键词搜索、分页与详情抽屉。\n4. 自动化测试：覆盖状态机非法跃迁单测、API 集成测试与前端表格渲染测试。',
        promptEn: 'Build the "OrderFlow" full-stack order workbench:\n1. Schema & Data Model: Define orders, order_items, and order_events schemas with indexes and strict status constraints.\n2. Backend State Machine & API: Implement idempotent order transitions (created -> paid -> shipped -> completed/cancelled) with REST validation.\n3. React Table UI: Build a filterable, searchable, paginated order workbench table with row detail drawer.\n4. Automated Tests: Cover invalid state transitions, API integration contracts, and UI table rendering assertions.',
      },
      {
        id: 'clirefactor-demo',
        workspace: 'CliRefactor-Demo',
        labelZh: '示例：CLI 重构与测试门禁',
        labelEn: 'Demo: CLI Refactor & Test Gate',
        promptZh: '重构现有 CLI 工程并建立严格测试门禁：\n1. 模块化拆分：将单体命令入口拆分为独立子命令模块、参数校验层与统一错误码输出器。\n2. 配置与向后兼容：保留旧版 CLI flags 与 JSON 输出契约，补充结构化帮助信息。\n3. 测试与质量门禁：补全子命令单测、边界输入回归用例及 CI 一键校验脚本。',
        promptEn: 'Refactor the CLI codebase and establish a strict test gate:\n1. Modularization: Split the monolithic entrypoint into isolated subcommand handlers, argument validators, and unified error formatters.\n2. Compatibility & Config: Preserve legacy CLI flags and JSON output contracts with structured help output.\n3. Test Verification Gate: Add unit/integration tests for every subcommand, edge-case inputs, and an automated CI verification gate.',
      },
    ]

    const WIZARD_WAVE_OPTIONS = [1, 2, 3, 4]

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

    function UiModeSwitcher(props) {
      useLocale()
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
          title: t('切换为简洁视图', 'Switch to Simple View'),
          onClick: () => setUiMode('novice'),
        }, t('简洁', 'Simple')),
        h('button', {
          type: 'button',
          className: 'rt-btn' + (!isNovice ? ' rt-btn-primary' : ''),
          style: { borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: !isNovice ? 700 : 500 },
          title: t('切换为专家视图', 'Switch to Expert View'),
          onClick: () => setUiMode('expert'),
        }, t('专家', 'Expert')))
    }

    function WishRefinerWizard(props) {
      useLocale()
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
          setFeedback({ tone: 'warn', text: t('请先输入需要实现的功能目标或工程需求。', 'Please describe the target feature or engineering requirement first.') })
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
            setLlmError(extractLlmErrorInfo(res, 'clarify', t('模型服务不可用或未配置，未能获取 AI 澄清问题。', 'Model service is unavailable or unconfigured; failed to get AI clarification.')))
            return
          }
          if (!eng && !hintEdited && (res.project_name || res.projectName) && !projectHint) {
            setProjectHint(String(res.project_name || res.projectName))
          }
          const parsed = normalizeClarifyResponse(res)
          if (!parsed || (parsed.questions.length === 0 && parsed.dimensions.length === 0 && !parsed.summary)) {
            setLlmError(extractLlmErrorInfo(res, 'clarify', t('模型未返回有效澄清维度，请直接重试 AI 拆解或转交主代理。', 'No valid clarification dimensions returned; please retry AI decompose or hand off to Captain.')))
            return
          }
          setClarifyData(parsed)
          setClarifyAnswers({})
          setSelectedDims([])
          setFeedback({
            tone: 'ok',
            text: t('已由模型生成项目专属澄清问题，选择或补充后点击「AI 拆解蓝图」。', 'Clarifying questions generated. Pick options and click "AI Decompose".'),
          })
        }).catch((err) => {
          setClarifying(false)
          setLlmError({
            stage: 'clarify',
            code: 'network_error',
            isLlmUnavailable: false,
            text: t('AI 澄清请求异常：', 'AI clarification error: ') + (err && err.message ? err.message : String(err)),
          })
        })
      }

      const handleRefinePreview = () => {
        const promptTrimmed = String(wishText || '').trim()
        if (!promptTrimmed) {
          setFeedback({ tone: 'warn', text: t('请先输入需要实现的功能目标或工程需求。', 'Please describe the target feature or engineering requirement first.') })
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
            setLlmError(extractLlmErrorInfo(res, 'decompose', t('模型服务不可用或调用失败，无法生成拆解蓝图。', 'Model service unavailable; failed to generate blueprint.')))
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
              text: t('模型未返回有效的分片蓝图条目，请补充需求细节后重试或直交主代理接管。', 'No valid shard blueprint returned; please add details or hand off to Captain.'),
            })
            return
          }
          setStageCards(normalized)
          setFeedback({
            tone: 'ok',
            text: t(
              '已生成 ' + normalized.length + ' 个可执行分片，请核对目标、角色、Wave 与文件边界后点击「确认立项并派发」。',
              'Generated ' + normalized.length + ' executable shards. Review goals, roles, waves & file ownership, then click "Confirm & Dispatch".'
            ),
          })
        }).catch((err) => {
          setPreviewing(false)
          setLlmError({
            stage: 'decompose',
            code: 'network_error',
            isLlmUnavailable: false,
            text: t('AI 拆解请求异常：', 'AI decompose error: ') + (err && err.message ? err.message : String(err)),
          })
        })
      }

      const handleHandoffToCaptain = async () => {
        const promptTrimmed = String(wishText || '').trim()
        if (!promptTrimmed) {
          setFeedback({ tone: 'warn', text: t('请先输入需求描述后再转交主代理接管。', 'Please enter requirements before handing off to Captain.') })
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
              text: t('转交主代理失败：', 'Captain handoff failed: ') + ((res && (res.message || res.error)) || t('后端未返回成功回执', 'No success receipt from backend')),
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
            captainNote: String(res.captain_note || res.message || res.note || t('已将需求与上下文转交主代理（Captain）在当前会话接管。', 'Requirements & context handed off to Captain in the current session.')),
          })
          if (typeof props.onDecomposed === 'function') {
            props.onDecomposed(res, stageCards, promptTrimmed, targetEng || eng)
          }
        } catch (err) {
          setHandoffBusy(false)
          setFeedback({ tone: 'err', text: t('转交主代理异常：', 'Captain handoff error: ') + (err && err.message ? err.message : String(err)) })
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
          title: t('新增研发分片 #' + (prev.length + 1), 'New Dev Shard #' + (prev.length + 1)),
          assignedGoal: '',
          filesOwned: '',
        }]))
      }

      const removeStageCard = (idx) => {
        setStageCards((prev) => prev.filter((_, i) => i !== idx))
      }

      const applyDemoPreset = (preset) => {
        if (!preset) return
        setWishText(t(preset.promptZh, preset.promptEn))
        setHintEdited(true)
        setProjectHint(preset.workspace)
        setLlmError(null)
        setFeedback({
          tone: 'ok',
          text: t(
            '已填充 1 分钟示例「' + preset.labelZh + '」（工作台：' + preset.workspace + '），可直接点击「AI 澄清需求」或「AI 拆解蓝图」。',
            'Loaded 1-min demo "' + preset.labelEn + '" (Workspace: ' + preset.workspace + '). Click "AI Clarify" or "AI Decompose".'
          ),
        })
      }

      const handleConfirmAndDecompose = async () => {
        const promptTrimmed = String(wishText || '').trim()
        if (!promptTrimmed && stageCards.length === 0) {
          setFeedback({ tone: 'warn', text: t('请先输入需求描述并点击「AI 拆解蓝图」。', 'Please enter requirements and click "AI Decompose" first.') })
          return
        }
        if (stageCards.length === 0) {
          setFeedback({ tone: 'warn', text: t('请先点击「AI 拆解蓝图」获取分片方案，或通过「直交主代理接管」直接调度。', 'Please click "AI Decompose" to generate shards, or hand off directly to Captain.') })
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
            setLlmError(extractLlmErrorInfo(decompRes, 'decompose', t('立项与派发失败，请检查模型配置或转交主代理接管。', 'Dispatch failed; check model settings or hand off to Captain.')))
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
            || (captainNotified === false
              ? t('未自动通知主代理', 'Captain was not auto-notified')
              : t('已同步写入工作流并通知主代理协同调度', 'Saved to workflow DAG and notified Captain'))
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
              text: t('分片已写入事实库，但未拉起子代理或唤醒主代理：', 'Shards saved, but no subagent or Captain was woken: ') + (dispatchWarnings[0] || captainNote),
            })
          } else {
            setFeedback({
              tone: 'ok',
              text: t(
                '立项成功，已写入 ' + editedGoals.length + ' 个分片' + (wave1Sessions.length > 0 ? ('，已拉起 ' + wave1Sessions.length + ' 个 Wave 1 子代理执行') : '并通知主代理协同调度') + '。',
                'Project launched with ' + editedGoals.length + ' shards' + (wave1Sessions.length > 0 ? (' and ' + wave1Sessions.length + ' Wave 1 subagent(s) started') : ' and Captain notified') + '.'
              ),
            })
          }
          if (typeof props.onDecomposed === 'function') {
            props.onDecomposed(decompRes, editedGoals, finalPrompt || derivedProjectName, targetEng)
          }
        } catch (err) {
          setLaunching(false)
          setFeedback({ tone: 'err', text: t('立项请求异常：', 'Launch request error: ') + (err && err.message ? err.message : String(err)) })
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
          h('strong', { style: { fontSize: 13 } }, t('AI 需求澄清与蓝图立项', 'AI Wish Refiner & Blueprint')),
          h('div', { className: 'rt-spacer' }),
          h('button', {
            type: 'button',
            className: 'rt-btn',
            onClick: () => setManualOpen(!isExpanded),
            style: { fontWeight: 600, fontSize: 11.5, padding: '3px 10px' },
          }, isExpanded ? t('收起', 'Collapse') : t('展开', 'Expand'))),

        isExpanded ? h('div', { className: 'rt-wish-wizard-body', style: { marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', {
            className: 'rt-demo-preset-bar',
            style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
          },
            h('span', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } },
              t('1 分钟体验示例：', '1-Min Quick Demos:')),
            DEMO_WISH_PRESETS.map((preset) => h('button', {
              key: preset.id,
              type: 'button',
              className: 'rt-p3-pill rt-demo-preset-chip',
              disabled: isAiBusy,
              onClick: () => applyDemoPreset(preset),
              title: t('点击填充示例需求并预设工作台名称：', 'Fill demo requirement & workspace name: ') + preset.workspace,
            }, t(preset.labelZh, preset.labelEn)))),

          h('textarea', {
            className: 'rt-textarea',
            rows: 3,
            value: wishText,
            onChange: (e) => setWishText(e.target.value),
            placeholder: t('描述目标功能、技术栈约束与验收要求…', 'Describe target features, tech stack constraints, and acceptance criteria...'),
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
                  placeholder: t('工作台名称（留空自动生成）', 'Workspace name (auto if empty)'),
                  style: { width: 210, fontSize: 12 },
                })
              : null,
            h('button', {
              type: 'button',
              className: 'rt-btn',
              disabled: isAiBusy,
              onClick: handleClarifyWithAI,
              style: { fontWeight: 600, padding: '5px 12px' },
            }, clarifying ? t('分析中…', 'Analyzing...') : t('AI 澄清需求', 'AI Clarify')),
            h('button', {
              type: 'button',
              className: 'rt-btn',
              disabled: isAiBusy,
              onClick: handleRefinePreview,
              style: { fontWeight: 600, padding: '5px 12px' },
            }, previewing ? t('拆解中…', 'Decomposing...') : t('AI 拆解蓝图', 'AI Decompose')),
            h('button', {
              type: 'button',
              className: 'rt-btn rt-btn-primary',
              disabled: isAiBusy || stageCards.length === 0,
              onClick: handleConfirmAndDecompose,
              style: { fontWeight: 700, padding: '5px 14px' },
            }, launching ? t('立项派发中…', 'Launching...') : t('确认立项并派发', 'Confirm & Dispatch'))),

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
            h('span', { style: { fontWeight: 600 } }, t('正在调用模型分析需求与项目结构…', 'Analyzing requirements and repository structure...'))) : null,

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
              (llmError.isLlmUnavailable ? t('模型服务不可用：', 'Model service unavailable: ') : t('AI 处理失败：', 'AI processing failed: ')) + llmError.text),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              llmError.stage === 'clarify'
                ? h('button', {
                    type: 'button',
                    className: 'rt-btn',
                    disabled: isAiBusy,
                    onClick: handleClarifyWithAI,
                  }, t('重试 AI 澄清', 'Retry AI Clarify'))
                : null,
              h('button', {
                type: 'button',
                className: 'rt-btn',
                disabled: isAiBusy,
                onClick: handleRefinePreview,
              }, t('重试 AI 拆解', 'Retry AI Decompose')),
              h('button', {
                type: 'button',
                className: 'rt-btn',
                onClick: () => setUI({ tab: 'settings' }),
              }, t('打开设置配置模型', 'Open Settings')),
              h('button', {
                type: 'button',
                className: 'rt-btn rt-btn-primary',
                disabled: isAiBusy,
                onClick: handleHandoffToCaptain,
              }, handoffBusy ? t('正在转交…', 'Handing off...') : t('直交主代理接管', 'Hand off to Captain')))) : null,

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
              h('strong', { style: { fontSize: 12 } }, t('AI 澄清追问与项目维度', 'AI Clarifications & Dimensions')),
              h('button', {
                type: 'button',
                className: 'rt-btn',
                style: { fontSize: 11, padding: '1px 7px' },
                onClick: () => setClarifyData(null),
              }, t('收起澄清', 'Hide'))),
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
                  placeholder: t('输入补充回答…', 'Additional answer...'),
                  style: { fontSize: 12 },
                }))
            }),
            h('input', {
              className: 'rt-input',
              value: extraClarifyNote,
              onChange: (e) => setExtraClarifyNote(e.target.value),
              placeholder: t('其他补充约束（选填）…', 'Extra constraints (optional)...'),
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
              h('strong', null, dispatchReceipt.mode === 'handoff' ? t('已转交主代理接管', 'Handed Off to Captain') : t('派发回执', 'Dispatch Receipt')),
              dispatchReceipt.totalGoals > 0
                ? h('span', { className: 'rt-tag rt-tag-live' }, t(dispatchReceipt.totalGoals + ' 个分片', dispatchReceipt.totalGoals + ' shards'))
                : null,
              h('span', { className: 'rt-tag ' + (dispatchReceipt.captainNotified ? 'rt-tag-live' : '') },
                dispatchReceipt.captainNotified ? t('主代理已通知', 'Captain Notified') : t('主代理待同步', 'Pending Captain Sync'))),
            h('div', { style: { color: 'var(--dsw-alias-label-secondary)' } }, dispatchReceipt.captainNote),
            dispatchReceipt.wave1Sessions.length > 0
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                  h('span', { style: { fontWeight: 600, fontSize: 11.5 } },
                    t('已拉起 Wave 1 子代理会话（' + dispatchReceipt.wave1Sessions.length + '）：', 'Wave 1 Subagent Sessions (' + dispatchReceipt.wave1Sessions.length + '):')),
                  h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                    dispatchReceipt.wave1Sessions.map((ws) => h('span', {
                      key: ws.sessionId,
                      className: 'rt-tag rt-mono',
                    }, (ws.role ? (ws.role + ' · ') : '') + (ws.title ? (ws.title + ' · ') : '') + ws.sessionId))))
              : h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                  t('Wave 1 任务已落库并通知主代理协调执行。', 'Wave 1 tasks persisted and Captain notified.'))) : null,

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
              h('strong', { style: { fontSize: 12.5 } }, t('拆解蓝图（' + stageCards.length + ' 个分片）', 'Decomposed Blueprint (' + stageCards.length + ' Shards)')),
              h('div', { style: { display: 'inline-flex', gap: 6 } },
                h('button', { type: 'button', className: 'rt-btn', style: { fontSize: 11, padding: '2px 8px' }, onClick: addStageCard }, t('+ 新增分片', '+ Add Shard')),
                h('button', {
                  type: 'button',
                  className: 'rt-btn rt-btn-primary',
                  disabled: isAiBusy,
                  style: { fontSize: 11, padding: '2px 10px', fontWeight: 700 },
                  onClick: handleConfirmAndDecompose,
                }, launching ? t('立项派发中…', 'Launching...') : t('确认立项并派发', 'Confirm & Dispatch')))),
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
                    'aria-label': t('所属波次 Wave', 'Target Wave'),
                    onChange: (e) => updateCardField(idx, 'wave', Number(e.target.value)),
                    style: { fontSize: 11, padding: '1px 6px', fontWeight: 600 },
                  }, WIZARD_WAVE_OPTIONS.map((w) => h('option', { key: 'w-' + w, value: String(w) }, formatWaveHeaderByMode(w, 'Wave ' + w, uiMode)))),
                  h('div', { className: 'rt-spacer' }),
                  stageCards.length > 1 ? h('button', {
                    type: 'button',
                    className: 'rt-btn',
                    style: { padding: '0 6px', fontSize: 10.5 },
                    onClick: () => removeStageCard(idx),
                  }, t('移除', 'Remove')) : null),
                h('label', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, t('分片标题与目标', 'Shard Title & Goal')),
                h('input', {
                  className: 'rt-input',
                  value: card.title,
                  onChange: (e) => updateCardField(idx, 'title', e.target.value),
                  placeholder: t('阶段标题', 'Stage title'),
                  style: { fontSize: 12, fontWeight: 600 },
                }),
                h('textarea', {
                  className: 'rt-textarea',
                  rows: 2,
                  value: card.assignedGoal,
                  onChange: (e) => updateCardField(idx, 'assignedGoal', e.target.value),
                  placeholder: t('具体阶段目标说明…', 'Detailed shard goal...'),
                  style: { fontSize: 11.5 },
                }),
                h('label', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, t('负责角色', 'Assigned Role')),
                h('select', {
                  className: 'rt-select',
                  value: card.role,
                  onChange: (e) => updateCardField(idx, 'role', e.target.value),
                  style: { fontSize: 11.5 },
                }, WIZARD_ROLE_OPTIONS.map((opt) => h('option', { key: opt.value, value: opt.value }, roleLabel(opt.value)))),
                h('label', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, t('独占文件分片 (files_owned)', 'Exclusive Files (files_owned)')),
                h('input', {
                  className: 'rt-input rt-mono',
                  value: card.filesOwned,
                  onChange: (e) => updateCardField(idx, 'filesOwned', e.target.value),
                  placeholder: t('例如 src/ui/*, src/utils/*', 'e.g. src/ui/*, src/utils/*'),
                  style: { fontSize: 11 },
                }))))) : null) : null)
    }

    function CollabApprovalTab(props) {
      useLocale()
      const eng = props.engagement || null
      const engName = props.engagementName || ''
      const engagements = Array.isArray(props.engagements) ? props.engagements : []
      const activeSid = props.sessionId || null
      const rawSessionTitle = props.sessionTitle || null
      const cleanSessionTitle = rawSessionTitle && !isRawUuidName(rawSessionTitle) ? String(rawSessionTitle).trim() : null
      const sessionBadgeText = cleanSessionTitle || (activeSid ? formatShortSessionId(activeSid) : t('未命名新会话', 'Untitled Session'))
      const sessionState = props.sessionState || null
      const snapshot = props.snapshot || null
      const refreshKey = props.refreshKey || 0

      const isBound = Boolean(eng)
      const isDismissed = Boolean(sessionState && sessionState.onboarding_dismissed)
      const hasConv = Boolean(sessionState && sessionState.has_conversation)
      const sessionCwd = (sessionState && sessionState.cwd) ? String(sessionState.cwd) : null

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
            setOnboardNote({ tone: 'err', text: (res && res.error) || t('创建工作台未返回有效标识', 'Workspace creation returned no valid ID') })
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

      const [dagData, setDagData] = React.useState(null)
      const [dagLoading, setDagLoading] = React.useState(false)
      const [queueFilter, setQueueFilter] = React.useState('pending')
      const [nextGoalDrafts, setNextGoalDrafts] = React.useState({})
      const [busyItemId, setBusyItemId] = React.useState(null)
      const [rollingBackId, setRollingBackId] = React.useState(null)
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
              : ((raw.compressedDigest && typeof raw.compressedDigest === 'object')
                ? raw.compressedDigest
                : ((raw.digest && typeof raw.digest === 'object') ? raw.digest : {}))
            const whatDone = String(
              digestSrc.what_was_done
              || digestSrc.whatWasDone
              || raw.whatWasDone
              || raw.summary
              || raw.output
              || raw.assigned_goal
              || raw.assignedGoal
              || t('阶段执行完毕，等待审批。', 'Stage complete, awaiting approval.')
            ).trim()
            const touchedFiles = Array.isArray(digestSrc.files_touched)
              ? digestSrc.files_touched
              : (Array.isArray(digestSrc.filesTouched) ? digestSrc.filesTouched : filesList)
            const verificationText = String(
              digestSrc.verification
              || digestSrc.test_result
              || digestSrc.verifyResult
              || raw.verification
              || (statusRaw === 'blocked' ? t('存在阻塞项', 'Blocked') : (isApproved ? t('已通过验收', 'Verified') : t('待确认放行', 'Awaiting sign-off')))
            ).trim()
            const rawViolations = Array.isArray(digestSrc.scope_violations)
              ? digestSrc.scope_violations
              : (Array.isArray(digestSrc.scopeViolations)
                ? digestSrc.scopeViolations
                : (Array.isArray(raw.scope_violations) ? raw.scope_violations : []))
            const scopeViolations = rawViolations.map((f) => String(f || '').trim()).filter(Boolean)
            const scopeOk = digestSrc.scope_ok !== false && digestSrc.scopeOk !== false && raw.scope_ok !== false && scopeViolations.length === 0
            merged.push({
              id,
              sessionId: raw.session_id || raw.sessionId || id,
              wave: Number(raw.wave) || 3,
              role: roleCode,
              roleLabel: roleLabel(roleCode),
              title: String(raw.title || raw.name || (t('分片任务 ', 'Shard Task ') + id)),
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
                scopeViolations,
                scopeOk,
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
        if (!eng || !item || busyItemId || rollingBackId) return
        const nextGoalStr = String(getDraftGoalFor(item) || '').trim() || t('继续推进下一阶段集成与验证', 'Proceed to next integration and verification stage')
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
          setQueueToast({ tone: 'err', text: t('审批提交失败：', 'Approval failed: ') + ((res && res.error) || t('后端响应异常', 'Backend error')) })
          return
        }
        const dispatchedRef = res.dispatched_session_id || res.next_session_id || res.next_worker_id || ''
        setQueueToast({
          tone: 'ok',
          text: t('✓ 已审批通过「' + item.title + '」', '✓ Approved "' + item.title + '"')
            + (dispatchedRef ? (t(' · 已派发 ', ' · Dispatched ') + dispatchedRef) : '')
            + (res.note ? (' · ' + res.note) : ''),
        })
        loadApprovalDag()
        if (typeof props.onRefresh === 'function') props.onRefresh()
      }

      const handleRetryItem = async (item) => {
        if (!eng || !item || busyItemId || rollingBackId) return
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
          setQueueToast({ tone: 'err', text: t('退回重跑失败：', 'Retry failed: ') + (res.error || t('请稍后重试', 'Please try again')) })
          return
        }
        const retrySid = (res && (res.session_id || res.sessionId || (res.worker_task && res.worker_task.session_id))) || ''
        setQueueToast({
          tone: 'ok',
          text: t('↻ 已触发「' + item.title + '」重跑分片', '↻ Retried shard "' + item.title + '"')
            + (retrySid ? (t('（子会话 ', ' (session ') + retrySid + t('）', ')')) : '')
            + (res && res.note ? (' · ' + res.note) : ''),
        })
        loadApprovalDag()
        if (typeof props.onRefresh === 'function') props.onRefresh()
      }

      const handleRollbackViolations = async (item) => {
        if (!eng || !item || busyItemId || rollingBackId) return
        const files = Array.isArray(item.digest && item.digest.scopeViolations) ? item.digest.scopeViolations : []
        if (files.length === 0) return
        setRollingBackId(item.id)
        setQueueToast(null)
        try {
          const res = await api({
            op: 'rollbackScopeViolations',
            engagement: eng,
            worker_task_id: item.id,
            files: files,
          })
          setRollingBackId(null)
          if (!res || res.ok === false) {
            setQueueToast({
              tone: 'err',
              text: t('越界文件回滚失败：', 'Rollback failed: ') + ((res && (res.error || res.message)) || t('后端响应异常', 'Backend error')),
            })
            return
          }
          const reverted = Array.isArray(res.reverted)
            ? res.reverted.length
            : (Array.isArray(res.restored) ? res.restored.length : files.length)
          setQueueToast({
            tone: 'ok',
            text: t(
              '✓ 已回滚 ' + reverted + ' 个越界文件（' + files.join(', ') + '）',
              '✓ Rolled back ' + reverted + ' violated file(s) (' + files.join(', ') + ')'
            ) + (res.note ? (' · ' + res.note) : ''),
          })
          loadApprovalDag()
          if (typeof props.onRefresh === 'function') props.onRefresh()
        } catch (err) {
          setRollingBackId(null)
          setQueueToast({
            tone: 'err',
            text: t('越界文件回滚异常：', 'Rollback error: ') + ((err && err.message) || String(err)),
          })
        }
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
            ? (t('已切换侧边对话至：', 'Switched chat sidebar to: ') + res.targetTitle)
            : (t('已返回侧边对话窗口：', 'Returned to chat sidebar: ') + res.targetTitle),
        })
      }

      const showFullOnboardingCard = (!isBound && !isDismissed) || forceShowGuide
      const boundDisplayName = isBound
        ? ((engName && !isRawUuidName(engName)) ? engName : eng)
        : ''
      const hasActiveTasks = reviewItems.length > 0

      return h('div', { className: 'rt-pane rt-collab-page' },

        showFullOnboardingCard
          ? h('section', { className: 'rt-card rt-onboard-card' },
              h('div', { className: 'rt-onboard-head' },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                  h('span', { className: 'rt-onboard-title' }, t('初始化当前会话工作台', 'Initialize Session Workspace')),
                  h('span', { className: 'rt-tag rt-tag-active' }, sessionBadgeText),
                  sessionCwd
                    ? h('span', { className: 'rt-tag rt-mono', title: sessionCwd }, sessionCwd)
                    : null),
                h('button', {
                  type: 'button',
                  className: 'rt-btn',
                  onClick: handleSkipGuide,
                }, isBound ? t('收起', 'Collapse') : t('跳过指引', 'Skip Guide'))),

              !isBound
                ? h('div', { className: 'rt-onboard-actions' },
                    h('input', {
                      className: 'rt-input',
                      value: wsNameDraft,
                      onChange: (e) => { setWsNameEdited(true); setWsNameDraft(e.target.value) },
                      placeholder: t('输入工作台名称…', 'Enter workspace name...'),
                      style: { flex: '1 1 240px', minWidth: 200 },
                    }),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-btn-primary',
                      disabled: creatingWs,
                      onClick: handleCreateWorkspaceForSession,
                      style: { fontWeight: 700, padding: '6px 14px' },
                    }, creatingWs ? t('正在创建…', 'Creating...') : t('创建并绑定工作台', 'Create & Bind Workspace')))
                : null,

              !isBound && engagements.length > 0
                ? h('details', { className: 'rt-onboard-bind-details' },
                    h('summary', null, t('关联已有项目（' + engagements.length + '）', 'Bind Existing Project (' + engagements.length + ')')),
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
                      }, bindingWs ? t('关联中…', 'Binding...') : t('确认关联', 'Bind Project'))))
                : null,

              onboardNote
                ? h('div', { className: 'rt-err', style: { margin: 0 } }, onboardNote.text)
                : null)
          : (!isBound && isDismissed
              ? h('section', { className: 'rt-card rt-onboard-card is-compact' },
                  h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5 } },
                      h('span', { className: 'rt-tag' }, t('待初始化', 'Pending Init')),
                      h('span', { style: { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 } },
                        (cleanSessionTitle || t('当前会话', 'Current Session')) + t(' 尚未绑定工作台', ' has no bound workspace'))),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn' + (!hasConv ? ' rt-btn-primary' : ''),
                      onClick: handleReopenGuide,
                      style: { fontWeight: 700 },
                    }, t('重新获取初始化指引', 'Reopen Setup Guide'))))
              : null),

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

        h('section', { className: 'rt-card rt-approval-queue-wrap' },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
            h('strong', { style: { fontSize: 13 } }, t('阶段审批队列', 'Approval Queue')),
            h('span', {
              className: 'rt-tag ' + (pendingCount > 0 ? 'rt-tag-warn' : 'rt-tag-live'),
            }, pendingCount > 0 ? t('待审批 ' + pendingCount, pendingCount + ' Pending') : t('已全部处理', 'All Handled')),
            h('div', { className: 'rt-spacer' }),
            h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
              h('button', {
                type: 'button',
                className: 'rt-btn' + (queueFilter === 'pending' ? ' rt-btn-primary' : ''),
                style: { padding: '2px 9px', fontSize: 11.5 },
                onClick: () => setQueueFilter('pending'),
              }, t('待决策 (' + pendingCount + ')', 'Pending (' + pendingCount + ')')),
              h('button', {
                type: 'button',
                className: 'rt-btn' + (queueFilter === 'all' ? ' rt-btn-primary' : ''),
                style: { padding: '2px 9px', fontSize: 11.5 },
                onClick: () => setQueueFilter('all'),
              }, t('全部 (' + reviewItems.length + ')', 'All (' + reviewItems.length + ')'))),
            eng
              ? h('button', {
                  type: 'button',
                  className: 'rt-btn',
                  disabled: dagLoading,
                  style: { padding: '2px 9px', fontSize: 11.5 },
                  onClick: loadApprovalDag,
                }, dagLoading ? t('同步中…', 'Syncing...') : t('刷新', 'Refresh'))
              : null),

          queueToast
            ? h('div', {
                className: queueToast.tone === 'err' ? 'rt-err' : 'rt-note',
                style: { margin: '0 0 8px' },
              }, queueToast.text)
            : null,

          visibleQueueItems.length === 0
            ? h('div', { className: 'rt-empty', style: { padding: '16px 12px', margin: 0 } },
                t('暂无待审批分片任务。', 'No shard tasks awaiting approval.'))
            : h('div', { className: 'rt-approval-list' },
                visibleQueueItems.map((item) => {
                  const isBusy = busyItemId === item.id || rollingBackId === item.id
                  const isRollingBack = rollingBackId === item.id
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
                      }, item.isApproved ? t('已审批', 'Approved') : (item.approvalState === 'revision_required' ? t('待修订', 'Revision Req.') : t('待审批', 'Pending')))),

                    item.filesOwned.length > 0
                      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
                          item.filesOwned.map((fp) => h('span', { key: fp, className: 'rt-shard-lock-badge' }, fp)))
                      : null,

                    h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 } },
                      item.digest.whatDone + ' · ' + item.digest.verificationText
                      + (item.digest.touchedFiles.length > 0 ? (t(' · 文件：', ' · Files: ') + item.digest.touchedFiles.join(', ')) : '')),

                    (!item.digest.scopeOk || item.digest.scopeViolations.length > 0)
                      ? h('div', {
                          className: 'rt-err rt-scope-violation-warn',
                          style: {
                            margin: 0,
                            padding: '6px 8px',
                            fontSize: 11.5,
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                          },
                        },
                          h('span', { style: { flex: '1 1 200px' } },
                            t('写盘越界警告：', 'Scope Violation Warning: ') + (item.digest.scopeViolations.length > 0
                              ? item.digest.scopeViolations.join(', ')
                              : t('存在未授权越界文件修改', 'Unauthorized out-of-scope file modifications detected'))),
                          item.digest.scopeViolations.length > 0
                            ? h('button', {
                                type: 'button',
                                className: 'rt-btn rt-rollback-scope-btn',
                                disabled: isBusy,
                                style: { padding: '2px 8px', fontSize: 11, fontWeight: 700, borderColor: '#ef4444', color: '#ef4444' },
                                onClick: () => handleRollbackViolations(item),
                              }, isRollingBack ? t('回滚中…', 'Rolling back...') : t('一键回滚越界文件', 'Rollback Violated Files'))
                            : null)
                      : null,

                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                      h('input', {
                        className: 'rt-input',
                        style: { flex: '1 1 200px', minWidth: 180, fontSize: 12 },
                        value: getDraftGoalFor(item),
                        onChange: (e) => {
                          const v = e.target.value
                          setNextGoalDrafts((prev) => Object.assign({}, prev, { [item.id]: v }))
                        },
                        placeholder: t('下一阶段目标或修订说明…', 'Next goal or revision note...'),
                      }),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn rt-btn-primary rt-plan-approve-btn',
                        disabled: isBusy,
                        onClick: () => handleApproveItem(item),
                      }, isBusy && !isRollingBack ? t('处理中…', 'Working...') : t('审批通过', 'Approve')),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn',
                        disabled: isBusy,
                        onClick: () => handleRetryItem(item),
                      }, t('退回重跑', 'Retry')),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn rt-jump-chat-btn',
                        onClick: () => handleJumpItemChat(item),
                      }, t('打开对话', 'Open Chat'))))
                }))))
    }


    const HARNESS_DAG_WAVES = [
      {
        wave: 'WAVE 0', sub: '主控调度', subEn: 'Orchestration',
        nodes: [
          {
            id: 'plan', code: '⓪ plan',
            name: 'Captain 主控架构师', nameEn: 'Captain Orchestrator',
            skill: '/dag-schedule', status: 'wait', statusLabel: '待命', statusLabelEn: 'Idle',
            slots: 'Orchestrator', thinking: 'high', docTitle: '00_PLAN_CHARTER.md',
            docBody: '# ⓪ Captain 主控立项与 4-Wave DAG 调度指令\n\n- 调度模式：4-Wave Bounded DAG（默认 6 并发槽，最高 12 槽）\n- 递归委派：允许子智能体继续派发微任务子智能体（maxDepth = 3，默认 thinking = low）\n- 事实库同步：全量写入 PostgreSQL Wire v3 事实库，支持任意节点断点续跑。',
            docBodyEn: '# ⓪ Captain Charter & 4-Wave DAG Scheduling\n\n- Mode: 4-Wave Bounded DAG (6 concurrent slots default, up to 12)\n- Delegation: Subagents may spawn micro-workers (maxDepth = 3, thinking = low)\n- Persistence: Synced to PostgreSQL / SQLite fact store with checkpoint resume.',
          },
        ],
      },
      {
        wave: 'WAVE 1', sub: '2 槽双轨立项', subEn: '2-Slot Discovery',
        nodes: [
          {
            id: 'recon', code: '① recon',
            name: 'CEO 产品与需求规划', nameEn: 'CEO Product & Planning',
            skill: '/office-hours · /plan-ceo-review', status: 'wait', statusLabel: '待命', statusLabelEn: 'Idle',
            slots: 'Slot #1', thinking: 'low', docTitle: '01_CEO_PRD_AND_SURFACE.md',
            docBody: '# ① CEO 产品需求拆解与全量模块测绘\n\n- 技能挂载：/office-hours + /plan-ceo-review\n- 核心产出：P0/P1 模块优先级清单、仓库拓扑与接口边界表\n- 数据库写入：INSERT INTO modules（实时同步）',
            docBodyEn: '# ① CEO PRD & Module Surface Mapping\n\n- Skills: /office-hours + /plan-ceo-review\n- Outputs: P0/P1 module priorities, repo topology & interface boundaries\n- Store Sync: INSERT INTO modules (live)',
          },
          {
            id: 'designer', code: '② designer',
            name: 'Designer 交互与视觉', nameEn: 'Designer UX & Visuals',
            skill: '/plan-design-review · /design-shotgun', status: 'wait', statusLabel: '待命', statusLabelEn: 'Idle',
            slots: 'Slot #2', thinking: 'low', docTitle: '02_DESIGN_SYSTEM_BENTO.md',
            docBody: '# ② Designer 模块化 Bento UI 与交互规范\n\n- 技能挂载：/plan-design-review + /design-shotgun\n- 视觉规范：WorkBuddy × DSH Brand Blue (#4D6BFE) + 主题自适应探针 + 可视化 DAG 画布\n- 响应式约束：三态（有数据 / 空态 / 报错）全覆盖，无障碍键盘可达。',
            docBodyEn: '# ② Designer Modular Bento UI & Interaction Spec\n\n- Skills: /plan-design-review + /design-shotgun\n- Visuals: DSH Brand Blue (#4D6BFE), adaptive theme tokens & live DAG canvas\n- States: Data / Empty / Error coverage with full keyboard accessibility.',
          },
        ],
      },
      {
        wave: 'WAVE 2', sub: '1 槽契约锁', subEn: '1-Slot Contract Lock',
        nodes: [
          {
            id: 'assess', code: '③ assess',
            name: 'Eng Manager 架构与分片', nameEn: 'Eng Manager Architecture & Shards',
            skill: '/plan-eng-review', status: 'wait', statusLabel: '待命', statusLabelEn: 'Idle',
            slots: 'Slot #1 (Lock)', thinking: 'low', docTitle: '03_ENG_SHARD_CONTRACT.md',
            docBody: '# ③ Eng Manager 接口契约与 6 槽独占文件分片\n\n- 技能挂载：/plan-eng-review\n- 分片准则：File-Disjoint Sharding（6 个并发构建槽文件集合严格无交集）\n- 断点快照：写入 dag_nodes 检查点，支持单分片失败独立重试。',
            docBodyEn: '# ③ Eng Manager Interface Contracts & File-Disjoint Shards\n\n- Skills: /plan-eng-review\n- Sharding: File-Disjoint Sharding across up to 6 parallel builder slots\n- Checkpoints: Persisted in dag_nodes for isolated per-shard retry.',
          },
        ],
      },
      {
        wave: 'WAVE 3', sub: '6 槽并发构建', subEn: '6-Slot Parallel Build',
        nodes: [
          {
            id: 'exploit', code: '⑤ exploit #1..#6',
            name: 'Builder 全栈分片构建', nameEn: 'Builder Parallel Shards',
            skill: '/parallel-build · 6 Slots', status: 'wait', statusLabel: '待命', statusLabelEn: 'Idle',
            slots: 'Slots #1–#6', thinking: 'low', docTitle: '04_BUILDER_SHARDS_LOG.md',
            docBody: '# ⑤ Builder 6 槽并发分片构建日志\n\n- 并发槽位：Slot #1..#6 并行编码与单元验证\n- 递归子代理：按需派生 Sub-Worker 处理微问题（maxDepth = 3, thinking = low）\n- 实时写库：INSERT INTO sharded_files（极速落盘）',
            docBodyEn: '# ⑤ Builder 6-Slot Parallel Implementation Log\n\n- Concurrency: Parallel coding & unit tests across Slots #1–#6\n- Sub-Workers: Spawn recursive workers for micro-tasks (maxDepth=3, thinking=low)\n- Store Sync: INSERT INTO sharded_files',
          },
          {
            id: 'subworker', code: '↳ sub-worker',
            name: '递归子代理 (thinking: low)', nameEn: 'Recursive Sub-Worker (thinking: low)',
            skill: 'maxDepth=3 · 微任务分解', status: 'wait', statusLabel: '待命', statusLabelEn: 'Idle',
            slots: 'Child Workers', thinking: 'low', isSub: true, docTitle: '05_RECURSIVE_SUBAGENTS.md',
            docBody: '# ↳ 递归子代理（Recursive Sub-Workers）执行栈\n\n- 派发策略：父 Builder 遇到局部类型推导/单测修复/接口对齐微问题时，直接递归 spawn 子代理\n- 思考档位：默认 thinking = low（极速低延迟）\n- 深度护栏：maxDepth = 3，结果自动回传父分片并同步 PG 事实库。',
            docBodyEn: '# ↳ Recursive Sub-Workers Execution Stack\n\n- Strategy: Parent builders spawn child workers for focused type fixes or tests\n- Thinking: Default thinking = low for low latency\n- Guardrail: maxDepth = 3, digests bubble back to parent shard.',
          },
        ],
      },
      {
        wave: 'WAVE 4', sub: '双轨门禁交付', subEn: 'Dual-Gate Release',
        nodes: [
          {
            id: 'vuln-scan', code: '④ vuln-scan',
            name: 'Reviewer & CSO 代码审查', nameEn: 'Reviewer & CSO Audit',
            skill: '/review · /cso', status: 'wait', statusLabel: '待命', statusLabelEn: 'Idle',
            slots: 'Gate #1', thinking: 'low', docTitle: '06_CSO_SECURITY_REVIEW.md',
            docBody: '# ④ Reviewer & CSO 代码质量与安全审计\n\n- 技能挂载：/review + /cso\n- 审计范围：静态代码缺陷、架构边界审查、安全规范门禁\n- 结论同步：UPDATE code_audits（通过后放行发布）。',
            docBodyEn: '# ④ Reviewer & CSO Quality & Security Audit\n\n- Skills: /review + /cso\n- Scope: Static analysis, architecture boundaries & security gates\n- Sync: UPDATE code_audits',
          },
          {
            id: 'qa', code: '⑥ qa',
            name: 'QA Lead 自动化回归', nameEn: 'QA Lead Automated Gate',
            skill: '/qa · /benchmark', status: 'wait', statusLabel: '待命', statusLabelEn: 'Idle',
            slots: 'Gate #2', thinking: 'low', docTitle: '07_QA_BENCHMARK_GATE.md',
            docBody: '# ⑥ QA Lead 全量测试套件与性能基线门禁\n\n- 技能挂载：/qa + /benchmark\n- 覆盖率与回归：前端渲染自检 + 打包契约自检 + PG 事务一致性基准\n- 门禁状态：INSERT INTO qa_runs（全部断言通过）。',
            docBodyEn: '# ⑥ QA Lead Regression & Benchmark Gate\n\n- Skills: /qa + /benchmark\n- Coverage: Client render tests, bundle contracts & DB consistency checks\n- Gate: INSERT INTO qa_runs',
          },
          {
            id: 'internal', code: '⑦ internal',
            name: 'Doc & Release 归档发布', nameEn: 'Doc & Release Shipper',
            skill: '/ship · /document-release', status: 'wait', statusLabel: '待命', statusLabelEn: 'Idle',
            slots: 'Release Slot', thinking: 'low', docTitle: '08_FINAL_RELEASE_NOTE.md',
            docBody: '# ⑦ Doc & Release 最终交付文稿与飞书归档\n\n- 技能挂载：/ship + /document-release\n- 交付闭环：汇总 Wave 1–4 全部文稿与代码产物，生成结构化研发交付报告并触发飞书群聊机器人通知。',
            docBodyEn: '# ⑦ Doc & Release Final Delivery & Notifications\n\n- Skills: /ship + /document-release\n- Closure: Aggregate Wave 1–4 deliverables, build structured delivery report & notify webhooks.',
          },
        ],
      },
    ]

    const useIsomorphicLayoutEffect = (typeof React !== 'undefined' && React.useLayoutEffect)
      ? React.useLayoutEffect
      : React.useEffect

    const _p4RoleDefaults = {
      defaultTok: '0 tok', defaultTokens: 0, defaultCompressedTokens: 0, defaultCompressionPct: 85,
      defaultDur: '待命', defaultDurEn: 'Idle', defaultSteps: 0, defaultPct: '0%', approvalState: 'pending_approval',
      filesTouched: [], nextGoal: '继续推进下一波次契约验证与回归闭环', nextGoalEn: 'Proceed to next wave contract verification & regression closure',
    }
    const _defP4Role = (spec) => Object.assign({}, _p4RoleDefaults, spec)

    const P4_ROLE_META = {
      designer: _defP4Role({
        wave: 1, role: 'designer', avatar: 'WD', color: '#ef4444',
        defaultTitle: 'Wave1 designer 交互与设计', defaultTitleEn: 'Wave1 designer UX & Design',
        prompt: '基于项目需求梳理模块化 Bento UI 布局、设计令牌与交互视图规范。',
        promptEn: 'Define modular Bento UI layout, design tokens, and interaction specs.',
        output: '等待执行交互与视觉设计任务。', outputEn: 'Awaiting UX & visual design execution.',
        whatWasDone: '交互与视觉规范分片已就绪。', whatWasDoneEn: 'UX & visual design shard ready.',
      }),
      recon: _defP4Role({
        wave: 1, role: 'recon', avatar: 'WR', color: '#10b981',
        defaultTitle: 'Wave1 recon 产品与需求', defaultTitleEn: 'Wave1 recon Product & Specs',
        prompt: '盘点目标项目全量业务模块、数据接口与核心功能优先级。',
        promptEn: 'Catalog project modules, API contracts, and P0/P1 priorities.',
        output: '等待执行需求拆解与数据源测绘。', outputEn: 'Awaiting requirement analysis & surface mapping.',
        whatWasDone: '产品与数据源测绘分片已就绪。', whatWasDoneEn: 'Product & surface mapping shard ready.',
      }),
      assess: _defP4Role({
        wave: 2, role: 'assess', avatar: 'WA', color: '#8b5cf6',
        defaultTitle: 'Wave2 assess 架构与分片', defaultTitleEn: 'Wave2 assess Architecture & Shards',
        prompt: '基于 Wave 1 需求与设计产出，冻结模块接口契约并划分独占文件分片。',
        promptEn: 'Freeze module interface contracts and partition exclusive file shards from Wave 1 outputs.',
        output: '等待锁定模块接口契约与独占文件分片。', outputEn: 'Awaiting contract freeze & shard assignment.',
        whatWasDone: '系统架构与分片边界待锁定。', whatWasDoneEn: 'Architecture & shard boundaries pending lock.',
      }),
      exploit: _defP4Role({
        wave: 3, role: 'exploit', avatar: 'WB', color: '#3b82f6',
        defaultTitle: 'Wave3 exploit 分片构建', defaultTitleEn: 'Wave3 exploit Parallel Build',
        prompt: '在独占文件分片内执行全栈编码实现与单元测试自检。',
        promptEn: 'Implement full-stack code and unit self-checks inside owned file shards.',
        output: '等待执行分片代码构建与自检。', outputEn: 'Awaiting shard build & self-check.',
        whatWasDone: '分片编码实现与单元验证就绪。', whatWasDoneEn: 'Shard implementation & verification ready.',
      }),
      'vuln-scan': _defP4Role({
        wave: 4, role: 'vuln-scan', avatar: 'WC', color: '#f59e0b',
        defaultTitle: 'Wave4 vuln-scan 代码审查', defaultTitleEn: 'Wave4 vuln-scan Code Review',
        prompt: '对各分片代码变更执行静态缺陷审查、架构边界复核与安全门禁审计。',
        promptEn: 'Run static defect review, boundary checks, and security gate audits.',
        output: '等待执行代码审查与安全门禁校验。', outputEn: 'Awaiting code review & security gate.',
        whatWasDone: '代码审查与安全门禁就绪。', whatWasDoneEn: 'Code review & security gate ready.',
      }),
      qa: _defP4Role({
        wave: 4, role: 'qa', avatar: 'WQ', color: '#06b6d4',
        defaultTitle: 'Wave4 qa 自动化回归', defaultTitleEn: 'Wave4 qa Automated QA',
        prompt: '运行全量单元测试、UI 渲染冒烟测试与打包一致性断言。',
        promptEn: 'Run full unit tests, UI render smoke checks, and bundle assertions.',
        output: '等待运行自动化测试套件与回归校验。', outputEn: 'Awaiting automated test suite & regression checks.',
        whatWasDone: '自动化回归测试套件就绪。', whatWasDoneEn: 'Automated QA regression suite ready.',
      }),
      internal: _defP4Role({
        wave: 4, role: 'internal', avatar: 'WI', color: '#ec4899',
        defaultTitle: 'Wave4 internal 归档发布', defaultTitleEn: 'Wave4 internal Docs & Release',
        prompt: '汇总 Wave 1–4 研发产物与交付里程碑，生成结构化交付报告。',
        promptEn: 'Aggregate Wave 1–4 deliverables and milestones into structured release report.',
        output: '等待汇总研发交付报告与归档。', outputEn: 'Awaiting release report & archival.',
        whatWasDone: '归档发布与交付报告就绪。', whatWasDoneEn: 'Release & delivery report ready.',
      }),
    }

    const WAVE_PAGE_SIZE = 24

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
      useLocale()
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
        sub: t(w.sub, w.subEn),
        nodes: w.nodes.map((n) => {
          const dn = dagNodesById.get(n.id)
          const dnStatus = dn ? String(dn.status || '').toLowerCase() : ''
          const isRunningSub = runningAgents.some((ra) => String(ra.label || '').toLowerCase().includes(n.id))
          let status = 'wait'
          let statusLabel = t('待命', 'Idle')
          if (['error', 'failed', 'blocked', 'timeout', 'shard_violation'].includes(dnStatus)) {
            status = 'error'
            statusLabel = t('异常待修复', 'Needs Fix')
          } else if (isRunningSub || dnStatus === 'running') {
            status = 'run'
            statusLabel = t('运行中', 'Running')
          } else if (dn && (dnStatus === 'done' || dnStatus === 'completed' || (Number(dn.steps) || 0) > 0)) {
            status = 'done'
            statusLabel = t('已完成 (' + (dn.steps || 1) + '步)', 'Done (' + (dn.steps || 1) + ' steps)')
          } else if (n.id === 'recon' && (Number(stats.assets) || 0) > 0) {
            status = 'done'
            statusLabel = t('已测绘 (' + stats.assets + ')', 'Mapped (' + stats.assets + ')')
          } else if (n.id === 'vuln-scan' && (Number(stats.vulns) || 0) > 0) {
            status = 'done'
            statusLabel = t('已审查 (' + stats.vulns + ')', 'Reviewed (' + stats.vulns + ')')
          } else if (n.id === 'exploit' && (Number(stats.steps) || 0) > 0) {
            status = 'done'
            statusLabel = t('已执行 (' + stats.steps + '步)', 'Executed (' + stats.steps + ' steps)')
          }
          return Object.assign({}, n, {
            name: t(n.name, n.nameEn),
            docBody: t(n.docBody, n.docBodyEn),
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
        const title = String(raw.title || raw.label || raw.name || t(meta.defaultTitle, meta.defaultTitleEn)).trim()
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
        const durLbl = raw.durationLabel || raw.duration || (isErr ? t('异常中断', 'Failed') : (isRun ? t('运行中', 'Running') : (isPending ? t('待调度', 'Queued') : t('已完成', 'Done'))))
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
          || t(meta.prompt, meta.promptEn)

        const digestObj = (raw.compressedDigest && typeof raw.compressedDigest === 'object')
          ? {
              whatWasDone: raw.compressedDigest.whatWasDone || raw.output || (isErr ? (raw.error || t('执行异常，等待修复或重跑分片', 'Execution error, awaiting fix or retry')) : (isPending ? assignedGoalStr : t(meta.whatWasDone, meta.whatWasDoneEn))),
              filesTouched: Array.isArray(raw.compressedDigest.filesTouched) && raw.compressedDigest.filesTouched.length > 0
                ? raw.compressedDigest.filesTouched
                : rawFilesOwned,
            }
          : {
              whatWasDone: raw.whatWasDone || raw.output || raw.summary || (isErr ? (raw.error || t('执行异常，等待修复或重跑分片', 'Execution error, awaiting fix or retry')) : (isPending ? assignedGoalStr : t(meta.whatWasDone, meta.whatWasDoneEn))),
              filesTouched: rawFilesOwned,
            }

        const resolvedStatus = isErr ? 'error' : (isRun ? 'running' : (isPending ? 'pending' : 'done'))
        const resolvedStatusLabel = isErr ? t('异常待修复', 'Needs Fix') : (isRun ? t('运行中', 'Running') : (isPending ? t('待执行', 'Pending') : t('已完成', 'Done')))

        fusedChildren.push({
          id: childId,
          sessionId: raw.sessionId || raw.session_id || childId,
          name: title,
          wave: Number(raw.wave) || (waveMatch ? Number(waveMatch[1]) : meta.wave),
          role: roleKey,
          roleLabel: roleLabel(roleKey),
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
          nextGoal: (overrideApproval && overrideApproval.nextGoal) || raw.nextGoal || raw.next_goal || t(meta.nextGoal, meta.nextGoalEn),
          tokenLabel: tokLbl,
          costLabel: costVal,
          durationLabel: durLbl,
          steps: stepsVal,
          ctxPct: ctxPctVal,
          prompt: assignedGoalStr,
          inputPrompt: assignedGoalStr,
          output: raw.output || raw.summary || raw.lastDecision || digestObj.whatWasDone || t(meta.output, meta.outputEn),
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
            title: ra.label || t('Wave2 assess 架构与分片', 'Wave2 assess Architecture & Shards'),
            status: 'running',
            tokenLabel: ra.tokenLabel,
            durationLabel: ra.durationLabel || t('运行中', 'Running'),
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
                  title: dn.title || dn.name || (P4_ROLE_META[dn.id] && t(P4_ROLE_META[dn.id].defaultTitle, P4_ROLE_META[dn.id].defaultTitleEn)),
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
        || (eng ? ((activeHostSess && (activeHostSess.displayLabel || activeHostSess.title)) || sessionTitle || eng) : (sessionTitle || t('待初始化会话', 'Pending Session')))
        || t('LMTAgent 主控工作台', 'LMTAgent Workbench')
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
      const rootDuration = (activeHostSess && activeHostSess.durationLabel) || (rootSteps > 0 ? t('实时同步', 'Live Sync') : t('待命', 'Idle'))
      const rootCtxPct = domTel.contextPct || (rootTokens > 0 ? t('实时', 'Live') : '0%')
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
          id: 'root', avatar: t('主控', 'Lead'), title: workspaceDisplayTitle, color: '#3b82f6', isRoot: true,
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
          ? t('异常待修复', 'Needs Fix')
          : (c.status === 'running' ? t('● 进行中', '● Running') : (c.status === 'pending' ? t('○ 待执行', '○ Pending') : t('● 已完成', '● Done'))),
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
        { id: 1, wave: 1, shortLabel: 'Wave 1', subTitle: t('立项与需求探索', 'Discovery & Specs'), title: t('Wave 1 · 立项与需求探索', 'Wave 1 · Discovery & Specs'), color: '#ec4899' },
        { id: 2, wave: 2, shortLabel: 'Wave 2', subTitle: t('架构与数据契约', 'Architecture & Contracts'), title: t('Wave 2 · 架构与数据契约', 'Wave 2 · Architecture & Contracts'), color: '#f59e0b' },
        { id: 3, wave: 3, shortLabel: 'Wave 3', subTitle: t('并发分片构建', 'Parallel Build'), title: t('Wave 3 · 并发分片构建', 'Wave 3 · Parallel Build'), color: '#3b82f6' },
        { id: 4, wave: 4, shortLabel: 'Wave 4', subTitle: t('审查修复与质量门禁', 'Review & QA Gate'), title: t('Wave 4 · 审查修复与质量门禁', 'Wave 4 · Review & QA Gate'), color: '#10b981' },
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
          shortLabel: isNovice ? (t('步骤 ', 'Step ') + wm.wave) : wm.shortLabel,
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
        setToast(t('正在拉起子代理分片：', 'Dispatching shard: ') + (targetAgent.title || targetId) + '…')
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
            setToast(t('拉起子代理失败：', 'Dispatch failed: ') + ((res && (res.message || res.error)) || t('后端返回异常', 'Backend error')))
            return
          }
          const sid = res.session_id || res.sessionId || (res.child && (res.child.session_id || res.child.id)) || (res.worker && res.worker.session_id) || ''
          setToast(res.note || (t('已拉起执行：', 'Dispatched: ') + (targetAgent.title || targetId) + (sid ? (t('（子会话 ', ' (session ') + sid + t('）', ')')) : '')))
          reloadDag()
        }, () => {
          setDispatchingId(null)
          setToast(t('拉起子代理失败：请求异常', 'Dispatch failed: request error'))
        })
      }

      const handleCreateCustomShard = () => {
        const titleStr = String(newShardTitle || '').trim()
        if (!titleStr) { setToast(t('请填写新增分片节点的标题', 'Please enter a title for the new shard')); return }
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
            setToast(t('新增分片节点失败：', 'Add shard failed: ') + (res.error || t('请检查分片冲突', 'Check shard conflict')))
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
          setToast(t('已新增分片节点：', 'Added shard: ') + titleStr + (createdSid ? (t('（子会话 ', ' (session ') + createdSid + t('）', ')')) : ''))
          reloadDag()
        })
      }

      const handleSaveWorkerGoal = (targetAgent) => {
        if (!targetAgent) return
        const goalStr = String(editGoalDraft || '').trim()
        const filesArr = String(editFilesDraft || '').split(/[,，\n]+/).map((s) => s.trim()).filter(Boolean)
        if (!goalStr) { setToast(t('分片目标不能为空', 'Shard goal cannot be empty')); return }
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
            setToast(t('保存目标失败：', 'Save goal failed: ') + (res.error || t('分片锁冲突', 'Shard lock conflict')))
            return
          }
          setWorkerGoalOverrides((prev) => Object.assign({}, prev, {
            [targetAgent.id]: { assignedGoal: goalStr, filesOwned: filesArr },
          }))
          setEditingGoalOpen(false)
          setToast((res && res.note) || (t('已更新分片目标与独占文件：', 'Updated shard goal & files: ') + (targetAgent.title || targetAgent.id)))
          reloadDag()
        })
      }

      const handlePlanApproveWorker = (detailTarget, decisionOverride) => {
        if (!detailTarget || approvingBusy) return
        const decision = decisionOverride === 'revision_requested' ? 'revision_requested' : 'approved'
        const nextGoalStr = String(customNextGoal || detailTarget.nextGoal || t('继续推进下一波次契约验证与回归闭环', 'Proceed to next wave contract verification')).trim()
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
            setToast(t('审批操作未生效：', 'Approval failed: ') + ((res && res.error) || t('后端返回异常', 'Backend error')))
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
            ? (t('，已联动派发：', ', dispatched: ') + dispatchedList.join(', '))
            : ((res && (res.session_id || res.sessionId)) ? (t('（子会话 ', ' (session ') + (res.session_id || res.sessionId) + t('）', ')')) : '')
          setToast(decision === 'revision_requested'
            ? (t('已驳回重做 ', 'Revision requested for ') + (detailTarget.name || detailTarget.title) + '：' + nextGoalStr)
            : (t('已审批通过 ', 'Approved ') + (detailTarget.name || detailTarget.title) + t('，下达目标：', ', next goal: ') + ((res && res.next_goal) || nextGoalStr) + sidSuffix))
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
            setToast(t('重跑分片失败：', 'Retry failed: ') + (res.error || t('请稍后重试', 'Please try again')))
            return
          }
          const sid = res && (res.session_id || res.sessionId || (res.worker && res.worker.session_id))
          setToast((res && res.note) || (t('已触发单分片重跑：', 'Retried shard: ') + (detailTarget.title || detailTarget.id) + (sid ? (t('（子会话 ', ' (session ') + sid + t('）', ')')) : '')))
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
          ? (t('已切换侧边聊天框至 Agent 会话：', 'Switched chat sidebar to Agent session: ') + res.targetTitle)
          : (t('已返回宿主聊天窗口（当前节点尚未绑定独立子会话）：', 'Returned to host chat window (no dedicated sub-session): ') + res.targetTitle))
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
          avatar: t('主控', 'Lead'),
          color: '#3b82f6',
          title: workspaceDisplayTitle,
          rawTokens: rootTokens,
          compressedTokens: rootTokens > 0 ? Math.round(rootTokens * 0.14) : 0,
          compressionPct: fusedChildren.length > 0 ? 85 : 0,
          approvalState: 'approved',
          assignedGoal: t('全局需求拆解与 4-Wave 并发调度：统筹需求探索、契约锁定、分片并发构建与质量安全门禁。', 'Global requirement decomposition and 4-Wave orchestration across discovery, contracts, parallel build, and QA gates.'),
          filesOwned: [],
          compressedDigest: {
            whatWasDone: fusedChildren.length > 0
              ? t('已统筹 ' + fusedChildren.length + ' 个子智能体分片目标、摘要压缩与阶段审批派发。', 'Coordinated ' + fusedChildren.length + ' subagent shard goals, digests, and approvals.')
              : t('主控编排器就绪 —— 可在协同与审批页输入需求一键立项并生成并行分片。', 'Orchestrator ready — describe requirements in Collab & Approval to generate parallel shards.'),
            filesTouched: [],
          },
          nextGoal: t('继续推进下一波次契约验证与回归闭环', 'Proceed to next wave contract verification'),
          status: runningCount > 0 ? 'running' : 'done',
          statusLabel: runningCount > 0 ? t('运行中', 'Running') : t('就绪', 'Ready'),
          tokenLabel: rootTokensLabel,
          costLabel: rootCostLabel,
          durationLabel: rootDuration,
          steps: rootSteps,
          isRoot: true,
          inputPrompt: t('全局需求拆解与 4-Wave 并发调度：统筹 Wave 1 双轨立项、Wave 2 架构契约锁、Wave 3 分片并发构建与 Wave 4 质量安全门禁。', 'Orchestrate Wave 1 discovery, Wave 2 architecture contract lock, Wave 3 parallel build, and Wave 4 QA gates.'),
          prompt: t('全局需求拆解与 4-Wave 并发调度：统筹 Wave 1 双轨立项、Wave 2 架构契约锁、Wave 3 分片并发构建与 Wave 4 质量安全门禁。', 'Orchestrate Wave 1 discovery, Wave 2 architecture contract lock, Wave 3 parallel build, and Wave 4 QA gates.'),
          output: fusedChildren.length > 0
            ? t('已调度 ' + fusedChildren.length + ' 个子智能体并同步至事实库。', 'Dispatched ' + fusedChildren.length + ' subagents synced to fact store.')
            : t('等待立项拆解研发任务。', 'Awaiting project launch & decomposition.'),
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
            phase: st.phase || (idx === 0 ? t('环节 ① 委派解析', 'Step ① Dispatch') : (idx === detail.stepTimeline.length - 1 ? t('环节 ③ 结论回传', 'Step ③ Digest') : t('环节 ② 工具调用', 'Step ② Tool Call'))),
            tool: st.tool || st.toolName || (idx === 0 ? 'view_file' : (idx === 1 ? 'replace_file_content' : 'run_command')),
            input: st.input || st.args || st.command || st.summary || (t('执行 ', 'Execute ') + (agent.title || agent.id) + ' #' + (idx + 1)),
            output: st.output || st.result || t('步骤执行完成', 'Step completed'),
            duration: st.duration || st.elapsed || '—',
            status: st.status || 'done',
          }))
        }
        const isErr = agent && agent.status === 'error'
        const isRun = agent && agent.status === 'running'
        const isPend = agent && agent.status === 'pending'
        return [
          {
            step: 1, phase: t('环节 ① 委派解析', 'Step ① Dispatch'), tool: 'plan_dispatch',
            input: (agent && (agent.assignedGoal || agent.prompt)) || t('解析当前分片目标与依赖边界', 'Parse shard goal and boundaries'),
            output: t('已锁定分片范围', 'Shard scope locked'), duration: '—', status: isPend ? 'pending' : 'done',
          },
          {
            step: 2, phase: t('环节 ② 核心执行', 'Step ② Execution'), tool: 'shard_exec',
            input: Array.isArray(agent && agent.filesOwned) && agent.filesOwned.length > 0
              ? (t('独占分片：', 'Owned files: ') + agent.filesOwned.join(', '))
              : (t('执行 ', 'Execute ') + ((agent && agent.title) || t('当前角色', 'current role'))),
            output: isErr ? t('执行受阻，等待修复或重跑', 'Blocked, awaiting fix or retry') : t('同步上下文与结构化产物', 'Sync context & artifacts'),
            duration: '—', status: isErr ? 'error' : (isRun ? 'running' : (isPend ? 'pending' : 'done')),
          },
          {
            step: 3, phase: t('环节 ③ 阶段结论', 'Step ③ Conclusion'), tool: 'submit_digest',
            input: t('压缩阶段工作摘要并回传主控审批', 'Compress digest and report for approval'),
            output: (agent && agent.output) || t('等待阶段结论回传', 'Awaiting stage digest'),
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
        setToast(t('正在执行：', 'Running: ') + actionLabel + ' (' + targetNode + ')…')
        api({ op: 'dagCheckpoint', engagement: eng || undefined, action: actionCode, node: targetNode }).then((r) => {
          if (r && r.ok === false) {
            setToast(t('检查点操作失败：', 'Checkpoint failed: ') + (r.error || t('请稍后重试', 'Please try again')))
            return
          }
          setToast((r && r.note) || (t('已触发「' + actionLabel + '」：节点 ', 'Triggered "' + actionLabel + '" on ') + targetNode))
          reloadDag()
        }, () => {
          setToast(t('已触发「' + actionLabel + '」：节点 ' + targetNode + ' 恢复请求已发出', 'Triggered "' + actionLabel + '" resume for ' + targetNode))
        })
      }

      const effectiveMode = isClusterVariant ? mode : 'p4'

      if (!eng) {
        return h('div', { className: 'rt-bento-card rt-p4-workbench' },
          h('div', { className: 'rt-bento-head' },
            h('span', { className: 'rt-bento-title' }, t('派生树状图 & 多维协同工作台', 'Derivation Tree & Multi-Agent Workbench')),
            h('span', { className: 'rt-tag' }, t('待初始化', 'Pending Init')),
            h('div', { className: 'rt-spacer' }),
            h('button', {
              type: 'button',
              className: 'rt-btn',
              onClick: () => setUI({ tab: 'settings' }),
            }, t('设置', 'Settings')),
            (props.onOpenCollab || props.onOpenWishWizard)
              ? h('button', {
                  type: 'button',
                  className: 'rt-btn rt-btn-primary',
                  onClick: props.onOpenCollab || props.onOpenWishWizard,
                }, t('前往协同与审批立项 →', 'Launch in Collab & Approval →'))
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
              t('当前会话尚未初始化研发任务', 'No engineering tasks initialized in this session')),
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', maxWidth: 520, lineHeight: 1.55 } },
              t('请前往「协同与审批」通过 AI 澄清与拆解立项，确认后此处将实时呈现派生树与子代理协同状态。', 'Go to "Collab & Approval" to clarify requirements and launch shards. Live DAG and worker telemetry will appear here.')),
            (props.onOpenCollab || props.onOpenWishWizard)
              ? h('button', {
                  type: 'button',
                  className: 'rt-btn rt-btn-primary',
                  onClick: props.onOpenCollab || props.onOpenWishWizard,
                }, t('前往「协同与审批」启动立项', 'Open "Collab & Approval"'))
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
        const statusText = isErrCard ? t('异常', 'Error') : (isRunCard ? t('运行中', 'Running') : (isPendCard ? t('待执行', 'Pending') : t('已完成', 'Done')))
        const summaryText = (c.compressedDigest && c.compressedDigest.whatWasDone) || c.output || c.assignedGoal || t('等待分片执行', 'Awaiting execution')
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
              c.tokenLabel + ' · ' + (c.durationLabel || t('待命', 'Idle')) + ' · ' + (c.steps || 0) + t(' 步', ' steps')),
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
                  }, isRevReq ? t('待重做', 'Redo') : t('待审批', 'Pending'))
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
                  }, isBusyDispatch ? t('拉起中…', 'Starting...') : t('拉起执行', 'Dispatch'))
                : null)))
      }

      return h('div', { className: 'rt-bento-card rt-p4-workbench' },
        h('div', { className: 'rt-bento-head' },
          h('span', { className: 'rt-bento-title' }, isClusterVariant ? t('派生树状图 & 多维协同工作台', 'Derivation Tree & Multi-Agent Workbench') : t('派生树状图 & 实时工作流', 'Derivation Tree & Live Workflow')),
          h('span', { className: 'rt-tag rt-tag-live' }, totalAgents + ' Agent · ' + allTasks.length + t(' 协作任务', ' Tasks')),
          pendingApprovalCount > 0
            ? h('span', { className: 'rt-tag rt-tag-warn' }, t('待审批 ', 'Pending ') + pendingApprovalCount)
            : null,
          errorCount > 0
            ? h('span', {
                className: 'rt-tag',
                style: { background: 'rgba(239,68,68,0.14)', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)', fontWeight: 700 },
              }, errorCount + t(' 异常待修复', ' Errors'))
            : null,
          selAgentId
            ? h('button', {
                type: 'button',
                className: 'rt-btn',
                style: { padding: '1px 7px', fontSize: 10.5 },
                onClick: () => setSelAgentId(null),
              }, t('清除节点筛选', 'Clear Filter'))
            : null,
          h('div', { className: 'rt-spacer' }),
          isClusterVariant
            ? h('div', { className: 'rt-harness-modebar', role: 'group', 'aria-label': t('工作流视图切换', 'Workflow View'), style: { display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
                h('button', {
                  type: 'button',
                  className: 'rt-harness-modebtn' + (mode === 'p4' ? ' on' : ''),
                  onClick: () => setMode('p4'),
                }, t('派生树', 'Tree')),
                h('button', {
                  type: 'button',
                  className: 'rt-harness-modebtn' + (mode === 'swim' ? ' on' : ''),
                  onClick: () => setMode('swim'),
                }, t('泳道矩阵', 'Swimlanes')),
                h('button', {
                  type: 'button',
                  className: 'rt-harness-modebtn' + (mode === 'docwall' ? ' on' : ''),
                  onClick: () => setMode('docwall'),
                }, t('角色文稿', 'Doc Wall')),
                (props.onOpenCollab || props.onOpenWishWizard)
                  ? h('button', {
                      type: 'button',
                      className: 'rt-btn',
                      style: { padding: '2px 8px', fontSize: 11 },
                      onClick: props.onOpenCollab || props.onOpenWishWizard,
                    }, t('协同与审批', 'Collab & Approval') + (pendingApprovalCount > 0 ? (' (' + pendingApprovalCount + ')') : ''))
                  : null,
                h('button', {
                  type: 'button',
                  className: 'rt-btn',
                  style: { padding: '2px 8px', fontSize: 11 },
                  onClick: () => setUI({ tab: 'settings' }),
                }, t('设置', 'Settings')))
            : h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                props.onOpenCollab
                  ? h('button', {
                      type: 'button',
                      className: 'rt-btn',
                      onClick: props.onOpenCollab,
                    }, t('协同与审批', 'Collab & Approval') + (pendingApprovalCount > 0 ? (' (' + pendingApprovalCount + ')') : ''))
                  : null,
                props.onOpenAgents
                  ? h('button', {
                      type: 'button',
                      className: 'rt-btn',
                      onClick: props.onOpenAgents,
                    }, t('完整拓扑与泳道 →', 'Full Topology & Swimlanes →'))
                  : null,
                h('button', {
                  type: 'button',
                  className: 'rt-btn',
                  onClick: () => setUI({ tab: 'settings' }),
                }, t('设置', 'Settings')))),

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
              }, t('关闭', 'Dismiss')))
          : null,

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
                    h('span', { style: { fontWeight: 700, fontSize: 13 } }, t('Agent 网络 · 派生树状图', 'Agent Network · Derivation Tree')),
                    h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                      isClusterVariant
                        ? t('点击节点检视执行细节、编辑目标、拉起执行或审批放行', 'Click any node to inspect steps, edit goals, dispatch, or approve')
                        : t('点击任意节点预览阶段进展', 'Click any node to preview progress'))),
                  h('div', { style: { display: 'inline-flex', flexWrap: 'wrap', gap: 6, fontSize: 11 } },
                    h('span', { className: 'rt-tag rt-tag-live' }, totalAgents + ' Agent'),
                    h('span', { className: 'rt-tag rt-tag-active' }, runningCount + t(' 运行中', ' Running')),
                    errorCount > 0 ? h('span', { className: 'rt-tag', style: { color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' } }, errorCount + t(' 异常', ' Error')) : null,
                    h('span', { className: 'rt-tag' }, t('上下文 ', 'Context ') + ctxSumLabel))),

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
                        placeholder: t('搜索节点 / 角色 / 独占文件...', 'Search node / role / files...'),
                        value: canvasSearch,
                        onChange: (e) => setCanvasSearch(e.target.value),
                      }),
                      [
                        { k: 'all', lbl: t('全部 (' + fusedChildren.length + ')', 'All (' + fusedChildren.length + ')') },
                        { k: 'running', lbl: t('运行中', 'Running') },
                        { k: 'pending', lbl: t('待审批', 'Pending') + (pendingApprovalCount > 0 ? ' (' + pendingApprovalCount + ')' : '') },
                        { k: 'error', lbl: t('异常阻塞', 'Errors') + (errorCount > 0 ? ' (' + errorCount + ')' : '') },
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
                          }, t('需求拆解与审批', 'Wish & Approval'))
                        : null,
                      h('button', {
                        type: 'button',
                        className: 'rt-btn' + (showAddShardForm ? ' rt-btn-primary' : ''),
                        style: { padding: '2px 9px', fontSize: 11, fontWeight: 600 },
                        onClick: () => setShowAddShardForm((v) => !v),
                      }, showAddShardForm ? t('收起新增分片', 'Close Form') : t('+ 新增分片节点', '+ Add Shard')))
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
                        placeholder: t('分片标题（如：Wave3 认证中间件重构）', 'Shard title (e.g. Wave3 Auth Refactor)'),
                        value: newShardTitle,
                        onChange: (e) => setNewShardTitle(e.target.value),
                      }),
                      h('select', {
                        className: 'rt-input',
                        value: String(newShardWave),
                        onChange: (e) => setNewShardWave(Number(e.target.value) || 3),
                      },
                        h('option', { value: '1' }, t('Wave 1 · 立项与设计', 'Wave 1 · Discovery & UX')),
                        h('option', { value: '2' }, t('Wave 2 · 架构与分片', 'Wave 2 · Architecture')),
                        h('option', { value: '3' }, t('Wave 3 · 并发编码构建', 'Wave 3 · Parallel Build')),
                        h('option', { value: '4' }, t('Wave 4 · 审查与测试门禁', 'Wave 4 · Review & QA'))),
                      h('select', {
                        className: 'rt-input',
                        value: newShardRole,
                        onChange: (e) => setNewShardRole(e.target.value),
                      },
                        Object.keys(P4_ROLE_META).map((rk) => h('option', { key: 'sr-' + rk, value: rk },
                          rk + ' · ' + t(P4_ROLE_META[rk].defaultTitle, P4_ROLE_META[rk].defaultTitleEn)))),
                      h('input', {
                        className: 'rt-input',
                        placeholder: t('分片任务目标说明', 'Shard goal description'),
                        value: newShardGoal,
                        onChange: (e) => setNewShardGoal(e.target.value),
                      }),
                      h('input', {
                        className: 'rt-input rt-mono',
                        placeholder: t('独占文件路径（逗号分隔）', 'Exclusive file paths (comma-separated)'),
                        value: newShardFiles,
                        onChange: (e) => setNewShardFiles(e.target.value),
                      }),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn rt-btn-primary',
                        disabled: addingShardBusy,
                        onClick: handleCreateCustomShard,
                      }, addingShardBusy ? t('创建中…', 'Creating...') : t('确认挂载分片', 'Create Shard')))
                  : null,

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
                    'aria-label': t('路径树画布平移缩放与折叠控制', 'Canvas Pan/Zoom & Collapse Controls'),
                    style: { flexWrap: 'wrap' },
                  },
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn rt-tree-layout-setting',
                      style: { padding: '1px 8px', fontSize: 10.5, fontWeight: 600 },
                      onClick: toggleTreeDirection,
                      title: t('切换开发树展开方向（横向向右派生 / 纵向向下派生）', 'Toggle derivation direction (Horizontal / Vertical)'),
                    }, treeDirection === 'horizontal'
                      ? t('⇄ 横向向右派生', '⇄ Horizontal Tree')
                      : t('⇄ 纵向向下派生', '⇄ Vertical Tree')),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn',
                      style: { padding: '1px 6px', fontSize: 11 },
                      onClick: zoomOutCanvas,
                      title: t('缩小画布', 'Zoom Out'),
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
                      title: t('放大画布', 'Zoom In'),
                    }, '+'),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn',
                      style: { padding: '1px 7px', fontSize: 10.5 },
                      onClick: fitCanvasToViewport,
                      title: t('自适应缩放完整放入当前视口', 'Fit graph to viewport'),
                    }, t('适应视口', 'Fit')),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn rt-panzoom-btn',
                      style: { padding: '1px 7px', fontSize: 10.5 },
                      onClick: resetPanZoom,
                    }, t('1:1 复位', 'Reset 1:1')),
                    activeWaveGroups.length > 0
                      ? h('button', {
                          type: 'button',
                          className: 'rt-btn' + (allWavesExpanded ? ' rt-btn-primary' : ''),
                          style: { padding: '1px 7px', fontSize: 10.5 },
                          onClick: () => (allWavesExpanded ? (fusedChildren.length > 4 ? autoFoldWaves() : collapseAllWaves()) : expandAllWaves()),
                        }, allWavesExpanded ? t('自动收起', 'Auto Fold') : t('全部展开', 'Expand All'))
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
                                  h('span', { style: { background: '#3b82f6', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 6, flex: 'none' } }, t('主控', 'Lead')),
                                  h('span', {
                                    style: { fontWeight: 700, fontSize: 12.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                                    title: workspaceDisplayTitle,
                                  }, workspaceDisplayTitle),
                                  h('span', { className: 'rt-tag rt-tag-live', style: { margin: 0, flex: 'none' } }, runningCount > 0 ? t('运行中', 'Running') : (fusedChildren.length > 0 ? t('协同中', 'Active') : t('就绪', 'Ready')))),
                                h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: 'var(--dsw-alias-label-secondary)', gap: 6 } },
                                  h('span', { className: 'rt-mono' }, rootTokensLabel + ' · ' + rootCostLabel),
                                  h('span', { className: 'rt-mono' }, rootDuration + ' · ' + rootSteps + t(' 步', ' steps')),
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
                                      ? (wg.errorInWave + t(' 异常', ' Error'))
                                      : (wg.runningInWave > 0
                                        ? (wg.runningInWave + t(' 运行中', ' Running'))
                                        : (wg.pendingInWave > 0 && wg.doneInWave === 0
                                          ? (wg.pendingInWave + t(' 待执行', ' Pending'))
                                          : (wg.doneInWave + '/' + wg.children.length + t(' 完成', ' Done'))))
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
                                          }, wg.shortLabel + ' · ' + wg.children.length + t(' 节点', ' nodes')),
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
                                          h('span', null, wg.runningInWave + t(' 运行 · ', ' run · ') + wg.doneInWave + t(' 完成', ' done') + (wg.pendingInWave > 0 ? (' · ' + wg.pendingInWave + t(' 待执行', ' pending')) : '')),
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
                                          }, expanded ? t('收起分片', 'Collapse') : t('展开分片', 'Expand')))),

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
                                                }, t('展开更多 (+' + hiddenWaveCount + ' 个节点)', 'Show More (+' + hiddenWaveCount + ' nodes)'))
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
                                      ? t('当前过滤条件下没有匹配的节点', 'No nodes match current filter')
                                      : t('当前工作台尚无研发分片', 'No shards in this workspace yet')),
                                  h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.55 } },
                                    fusedChildren.length > 0
                                      ? t('点击上方「全部」筛选或清空搜索词即可恢复显示。', 'Click "All" or clear search query to restore.')
                                      : t('请前往「协同与审批」通过 AI 澄清与拆解立项生成分片，或在工具栏点击「+ 新增分片节点」。', 'Decompose a requirement in "Collab & Approval" or click "+ Add Shard".')),
                                  fusedChildren.length > 0
                                    ? h('button', {
                                        type: 'button',
                                        className: 'rt-btn',
                                        onClick: () => { setCanvasFilter('all'); setCanvasSearch('') },
                                      }, t('重置筛选条件', 'Reset Filters'))
                                    : ((props.onOpenCollab || props.onOpenWishWizard)
                                      ? h('button', {
                                          type: 'button',
                                          className: 'rt-btn rt-btn-primary',
                                          onClick: props.onOpenCollab || props.onOpenWishWizard,
                                        }, t('前往「协同与审批」立项拆解', 'Open Collab & Approval'))
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
                              label: t('检视主控节点 ', 'Inspect orchestrator ') + workspaceDisplayTitle,
                              expanded: selAgentId === 'root',
                            })),
                              h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                                h('span', { style: { background: '#3b82f6', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 6 } }, t('主控', 'Lead')),
                                h('span', { style: { fontWeight: 700, fontSize: 12.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, workspaceDisplayTitle),
                                h('span', { className: 'rt-tag rt-tag-live', style: { margin: 0 } }, runningCount > 0 ? t('运行中', 'Running') : (fusedChildren.length > 0 ? t('协同中', 'Active') : t('就绪', 'Ready')))),
                              h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: 'var(--dsw-alias-label-secondary)', gap: 6 } },
                                h('span', { className: 'rt-mono' }, rootTokensLabel + ' · ' + rootCostLabel),
                                h('span', { className: 'rt-mono' }, rootDuration + ' · ' + rootSteps + t(' 步', ' steps')),
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
                                      ? (wg.errorInWave + t(' 异常', ' Error'))
                                      : (wg.runningInWave > 0
                                        ? (wg.runningInWave + t(' 运行中', ' Running'))
                                        : (wg.pendingInWave > 0 && wg.doneInWave === 0
                                          ? (wg.pendingInWave + t(' 待执行', ' Pending'))
                                          : (wg.doneInWave + '/' + wg.children.length + t(' 完成', ' Done'))))
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
                                        label: (expanded ? t('收起 ', 'Collapse ') : t('展开 ', 'Expand ')) + wg.title,
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
                                            wg.shortLabel + ' · ' + wg.children.length + t(' 节点', ' nodes')),
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
                                          }, expanded ? t('收起分片', 'Collapse') : t('展开分片', 'Expand')))),
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
                                                }, t('展开更多 (+' + hiddenWaveCount + ' 个节点)', 'Show More (+' + hiddenWaveCount + ' nodes)'))
                                              : null)
                                        : null)
                                  }))
                              : h('div', { className: 'rt-empty', style: { marginTop: 12 } },
                                  fusedChildren.length > 0
                                    ? t('当前过滤条件下没有匹配的节点', 'No nodes match current filter')
                                    : t('当前工作台尚无研发分片 — 前往「协同与审批」立项拆解', 'No shards yet — launch in "Collab & Approval"'))))))),

              !isClusterVariant
                ? (selAgentId && activeInspectorAgent
                    ? (() => {
                        const ovSummary = (activeInspectorAgent.compressedDigest && activeInspectorAgent.compressedDigest.whatWasDone)
                          || activeInspectorAgent.output
                          || t('节点已就绪，点击右侧入口可前往审批或展开完整泳道。', 'Node ready. Open Collab & Approval or full swimlanes on the right.')
                        const ovStatusLabel = activeInspectorAgent.status === 'error'
                          ? t('异常待修复', 'Needs Fix')
                          : (activeInspectorAgent.status === 'running'
                            ? t('运行中', 'Running')
                            : (activeInspectorAgent.status === 'pending' ? t('待执行', 'Pending') : t('已完成', 'Done')))
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
                              (activeInspectorAgent.tokenLabel || rootTokensLabel) + ' · ' + (activeInspectorAgent.durationLabel || t('待命', 'Idle')) + ' · ' + (activeInspectorAgent.steps || 0) + t(' 步', ' steps')),
                            h('div', { className: 'rt-spacer' }),
                            (props.onOpenCollab || props.onOpenWishWizard)
                              ? h('button', {
                                  type: 'button',
                                  className: 'rt-btn rt-btn-primary',
                                  style: { padding: '2px 9px', fontSize: 11, fontWeight: 600 },
                                  onClick: props.onOpenCollab || props.onOpenWishWizard,
                                }, t('前往「协同与审批」 →', 'Collab & Approval →'))
                              : null,
                            props.onOpenAgents
                              ? h('button', {
                                  type: 'button',
                                  className: 'rt-btn',
                                  style: { padding: '2px 9px', fontSize: 11, fontWeight: 600 },
                                  onClick: props.onOpenAgents,
                                }, t('查看完整泳道与检视器 →', 'Full Swimlanes & Inspector →'))
                              : null,
                            h('button', {
                              type: 'button',
                              className: 'rt-btn',
                              style: { padding: '1px 6px', fontSize: 11 },
                              title: t('收起节点摘要', 'Hide summary'),
                              onClick: () => openAgentInspector('__closed__'),
                            }, t('收起', 'Hide'))),
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

        (isClusterVariant && (effectiveMode === 'p4' || effectiveMode === 'swim'))
          ? h('div', {
              className: 'rt-lower-process-deck',
              style: { display: 'flex', flexDirection: 'column', gap: 12, width: '100%', minWidth: 0 },
            },

              activeInspectorAgent
                ? (() => {
                    const inspDigest = activeInspectorAgent.compressedDigest || {
                      whatWasDone: activeInspectorAgent.output || t('已完成阶段任务并生成压缩摘要。', 'Completed stage and generated compressed digest.'),
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
                            ? t('Wave 0 · 主控', 'Wave 0 · Orchestrator')
                            : ('Wave ' + (activeInspectorAgent.wave || 1) + ' · ' + activeInspectorAgent.role)),
                        h('span', { className: 'rt-tag rt-mono', style: { margin: 0, fontSize: 10 } },
                          'session: ' + ((activeInspectorDetail && activeInspectorDetail.sessionId) || activeInspectorAgent.sessionId || activeInspectorAgent.id)),
                        h('span', { className: 'rt-mono', style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
                          (activeInspectorAgent.tokenLabel || rootTokensLabel) + ' · ' + (activeInspectorAgent.durationLabel || t('实时', 'Live')) + ' · ' + (activeInspectorAgent.steps || 0) + t(' 步', ' steps')),
                        h('div', { className: 'rt-spacer' }),
                        isInspPendingExec
                          ? h('button', {
                              type: 'button',
                              className: 'rt-btn rt-btn-primary',
                              disabled: isInspDispatchBusy,
                              style: { padding: '3px 10px', fontSize: 11, fontWeight: 700 },
                              onClick: () => handleDispatchWorkerTask(activeInspectorAgent),
                            }, isInspDispatchBusy ? t('拉起中…', 'Starting...') : t('拉起执行', 'Dispatch'))
                          : null,
                        !activeInspectorAgent.isRoot
                          ? h('button', {
                              type: 'button',
                              className: 'rt-btn',
                              style: { padding: '3px 9px', fontSize: 11, fontWeight: 600 },
                              onClick: () => setEditingGoalOpen((v) => !v),
                            }, editingGoalOpen ? t('收起目标编辑', 'Close Goal Editor') : t('编辑分片目标', 'Edit Goal'))
                          : null,
                        !activeInspectorAgent.isRoot
                          ? h('button', {
                              type: 'button',
                              className: 'rt-btn',
                              disabled: retryingBusy,
                              style: { padding: '3px 9px', fontSize: 11, fontWeight: 600 },
                              onClick: () => handleRetryWorkerTask(activeInspectorAgent),
                            }, retryingBusy ? t('重跑中…', 'Retrying...') : t('重跑该分片', 'Retry Shard'))
                          : null,
                        h('button', {
                          type: 'button',
                          className: 'rt-btn rt-btn-primary rt-jump-chat-btn',
                          style: { padding: '3px 10px', fontSize: 11, fontWeight: 700 },
                          onClick: () => handleOpenAgentChat(activeInspectorAgent),
                        }, t('跳转会话聊天 ↗', 'Open Chat ↗')),
                        h('button', {
                          type: 'button',
                          className: 'rt-btn',
                          style: { padding: '2px 7px', fontSize: 11 },
                          title: t('收起检视抽屉', 'Collapse inspector'),
                          onClick: () => openAgentInspector('__closed__'),
                        }, t('收起', 'Collapse'))),

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
                            h('div', { style: { fontSize: 11, fontWeight: 700 } }, t('编辑该子智能体的委派目标与独占文件分片', 'Edit Worker Goal & Exclusive File Shards')),
                            h('textarea', {
                              className: 'rt-textarea',
                              rows: 2,
                              style: { minHeight: 48, fontSize: 11.5 },
                              value: editGoalDraft,
                              onChange: (e) => setEditGoalDraft(e.target.value),
                              placeholder: t('输入调整后的分片目标说明...', 'Enter updated shard goal...'),
                            }),
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
                              h('input', {
                                className: 'rt-input rt-mono',
                                style: { flex: 1, minWidth: 200, fontSize: 11 },
                                value: editFilesDraft,
                                onChange: (e) => setEditFilesDraft(e.target.value),
                                placeholder: t('独占文件分片（逗号分隔）', 'Exclusive file shards (comma-separated)'),
                              }),
                              h('button', {
                                type: 'button',
                                className: 'rt-btn rt-btn-primary',
                                disabled: savingGoalBusy,
                                onClick: () => handleSaveWorkerGoal(activeInspectorAgent),
                              }, savingGoalBusy ? t('保存中…', 'Saving...') : t('保存目标', 'Save Goal')),
                              h('button', {
                                type: 'button',
                                className: 'rt-btn',
                                onClick: () => setEditingGoalOpen(false),
                              }, t('取消', 'Cancel'))))
                        : null,

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
                              t('Step 1 · 委派目标', 'Step 1 · Assigned Goal')),
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
                              t('Step 2 · 核心执行', 'Step 2 · Core Execution')),
                            h('span', { className: 'rt-mono', style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } },
                              activeStepTimeline.length + t(' 步 · ', ' steps · ') + (inspDigest.filesTouched || []).length + t(' 文件', ' files'))),
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
                              }, st.status === 'error' ? t('异常', 'Error') : (st.status === 'running' ? t('执行中', 'Running') : (st.status === 'pending' ? t('待执行', 'Pending') : t('完成', 'Done')))))))),

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
                              t('Step 3 · 阶段结论与审批', 'Step 3 · Stage Digest & Approval')),
                            h('span', {
                              style: {
                                fontSize: 9.5,
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: 99,
                                background: isInspRevReq ? 'rgba(239,68,68,0.14)' : (isInspApproved ? 'rgba(16,185,129,0.14)' : 'rgba(245,158,11,0.16)'),
                                color: isInspRevReq ? '#ef4444' : (isInspApproved ? '#10b981' : '#d97706'),
                              },
                            }, isInspRevReq ? t('已驳回重做', 'Revision Req.') : (isInspApproved ? t('已审批', 'Approved') : t('待审批', 'Pending')))),
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
                                  t(`原始 ${rawTokNum} tok → 压缩后 ${compTokNum} tok (-${compPctNum}%)`, `Raw ${rawTokNum} tok → Digest ${compTokNum} tok (-${compPctNum}%)`))
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
                        h('span', { style: { fontSize: 11, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' } }, t('下一阶段目标：', 'Next Goal:')),
                        h('input', {
                          className: 'rt-input',
                          style: { flex: '1 1 220px', height: 26, fontSize: 11.5 },
                          value: customNextGoal,
                          onChange: (e) => setCustomNextGoal(e.target.value),
                          placeholder: t('输入审批通过后下达给下一波次的新目标...', 'Enter next goal to dispatch upon approval...'),
                        }),
                        h('input', {
                          className: 'rt-input',
                          style: { width: 150, height: 26, fontSize: 11 },
                          value: reviewNote,
                          onChange: (e) => setReviewNote(e.target.value),
                          placeholder: t('审批备注（选填）', 'Review note (optional)'),
                        }),
                        h('button', {
                          type: 'button',
                          disabled: approvingBusy,
                          className: 'rt-btn rt-plan-approve-btn' + (isInspApproved ? '' : ' rt-btn-primary'),
                          style: { padding: '3px 10px', fontSize: 11, fontWeight: 700 },
                          onClick: () => handlePlanApproveWorker(activeInspectorAgent, 'approved'),
                        }, approvingBusy ? t('提交中…', 'Submitting...') : t('审批通过并下达目标', 'Approve & Dispatch Next')),
                        !activeInspectorAgent.isRoot
                          ? h('button', {
                              type: 'button',
                              disabled: approvingBusy,
                              className: 'rt-btn',
                              style: { padding: '3px 9px', fontSize: 11, color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)' },
                              onClick: () => handlePlanApproveWorker(activeInspectorAgent, 'revision_requested'),
                            }, t('驳回重做', 'Request Revision'))
                          : null,
                        h('button', {
                          type: 'button',
                          className: 'rt-btn',
                          style: { padding: '3px 8px', fontSize: 10.5 },
                          onClick: () => { setSelId(activeInspectorAgent.role || 'plan'); setMode('docwall') },
                        }, t('查看角色文稿 →', 'View Role Doc →'))))
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
                    h('span', null, t('点击派生树节点或泳道行可展开环节执行轨迹与审批抽屉', 'Click any tree node or swimlane row to inspect trajectory and approve')),
                    h('button', {
                      type: 'button',
                      className: 'rt-btn',
                      style: { padding: '2px 8px', fontSize: 11 },
                      onClick: () => openAgentInspector('root'),
                    }, t('展开主控预览', 'Inspect Orchestrator'))),

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
                  h('span', { style: { fontWeight: 700, fontSize: 13 } }, t('跨 Agent 协作泳道', 'Cross-Agent Swimlanes')),
                  h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                    filteredCollabCount + '/' + totalCollabEvents + t(' 条记录 · ', ' events · ') + swimFilteredLanes.length + t(' 条泳道', ' lanes')),
                  h('div', { className: 'rt-spacer' }),
                  h('input', {
                    className: 'rt-input',
                    style: { width: 128, height: 24, fontSize: 11, padding: '0 7px' },
                    placeholder: t('搜索 Agent...', 'Search agent...'),
                    value: collabSearch,
                    onChange: (e) => setCollabSearch(e.target.value),
                  }),
                  h('button', {
                    type: 'button',
                    className: 'rt-btn' + (collabSort === 'asc' ? ' rt-btn-primary' : ''),
                    style: { padding: '1px 7px', fontSize: 11 },
                    onClick: () => setCollabSort('asc'),
                  }, t('最早', 'Oldest')),
                  h('button', {
                    type: 'button',
                    className: 'rt-btn' + (collabSort === 'desc' ? ' rt-btn-primary' : ''),
                    style: { padding: '1px 7px', fontSize: 11 },
                    onClick: () => setCollabSort('desc'),
                  }, t('最新', 'Newest'))),

                h('div', { className: 'rt-swim-wave-filter', style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
                  [
                    { k: 'all', lbl: t('全部', 'All') },
                    { k: 'running', lbl: t('运行中', 'Running') },
                    { k: '1', lbl: t('Wave 1 立项', 'Wave 1 Discovery') },
                    { k: '2', lbl: t('Wave 2 架构', 'Wave 2 Arch') },
                    { k: '3', lbl: t('Wave 3 构建', 'Wave 3 Build') },
                    { k: '4', lbl: t('Wave 4 审查', 'Wave 4 Review') },
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
                    const laneDur = lane.durationLabel || (lane.isRoot ? rootDuration : t('待命', 'Idle'))
                    const laneStatus = lane.isRoot ? (runningCount > 0 ? 'running' : 'done') : (lane.status || 'done')
                    const laneCompPct = lane.compressionPct || 0
                    const laneApproved = (approvedWorkerMap[lane.id] && approvedWorkerMap[lane.id].approved) || lane.approvalState === 'approved'
                    const step1Text = lane.isRoot ? t('全局需求拆解与多波次并发调度', 'Global requirement decomposition & multi-wave dispatch') : (lane.prompt || lane.title)
                    const step2Text = laneSteps + t(' 步工具调用 · ', ' tool calls · ') + laneTok + ' · ' + laneDur
                    const step3Text = lane.isRoot
                      ? (fusedChildren.length > 0 ? t('已统筹 ' + fusedChildren.length + ' 个子代理压缩摘要与审批', 'Coordinated ' + fusedChildren.length + ' worker digests & approvals') : t('主控编排器就绪，等待拆解任务', 'Orchestrator ready, awaiting decomposition'))
                      : ((lane.output || t('等待同步产物', 'Awaiting output')) + (laneCompPct > 0 ? (t(' · 压缩 -', ' · Digest -') + laneCompPct + '%') : ''))
                    const orderedStages = collabSort === 'desc'
                      ? [
                          { key: 's3', tag: t('阶段结论', 'Conclusion'), text: step3Text, isConclusion: true },
                          { key: 's2', tag: t('核心执行', 'Execution'), text: step2Text, isConclusion: false },
                          { key: 's1', tag: t('委派目标', 'Assigned Goal'), text: step1Text, isConclusion: false },
                        ]
                      : [
                          { key: 's1', tag: t('委派目标', 'Assigned Goal'), text: step1Text, isConclusion: false },
                          { key: 's2', tag: t('核心执行', 'Execution'), text: step2Text, isConclusion: false },
                          { key: 's3', tag: t('阶段结论', 'Conclusion'), text: step3Text, isConclusion: true },
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
                    }, clickable(() => openAgentInspector(lane.id), { label: t('梳理 Agent 环节详情 ', 'Inspect agent ') + lane.title, expanded: isLaneSel })),
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
                          }, lane.isRoot ? (t('主控 · ', 'Lead · ') + lane.title) : lane.title),
                          h('span', {
                            className: 'rt-mono',
                            style: { fontSize: 9.5, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                          }, (lane.isRoot ? 'Wave 0' : ('Wave ' + (lane.wave || 1) + ' · ' + lane.role))
                            + (laneCompPct > 0 ? (' · -' + laneCompPct + '%') : '')
                            + ' · ' + (laneApproved ? t('已审', 'Approved') : t('待审', 'Pending'))))),
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
                            }, { label: t('展开 ', 'Expand ') + lane.title + ' ' + stg.tag, expanded: isLaneSel })),
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
                                    }, laneStatus === 'error' ? t('异常待修复', 'Needs Fix') : (laneStatus === 'running' ? t('运行中', 'Running') : (laneStatus === 'pending' ? t('待执行', 'Pending') : t('已完成', 'Done'))))
                                  : null),
                              h('span', {
                                style: { fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                              }, stg.text)))
                            return acc
                          }, []))))
                  }))),

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
                  h('span', { style: { fontWeight: 700, fontSize: 13 } }, t('协作任务', 'Collab Tasks')),
                  h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } },
                    filteredTasks.length + '/' + allTasks.length + t(' 个工作项', ' work items')),
                  h('div', { className: 'rt-spacer' }),
                  h('input', {
                    className: 'rt-input',
                    style: { width: 128, height: 24, fontSize: 11, padding: '0 7px' },
                    placeholder: t('搜索工作项...', 'Search tasks...'),
                    value: taskSearch,
                    onChange: (e) => setTaskSearch(e.target.value),
                  })),
                h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
                  [
                    { k: 'all', lbl: t('全部 ', 'All ') + allTasks.length },
                    { k: 'run', lbl: t('进行中 ', 'Running ') + runTaskCount },
                    { k: 'wait', lbl: t('待处理 ', 'Pending ') + waitTaskCount },
                    { k: 'done', lbl: t('已完成 ', 'Done ') + doneTaskCount },
                  ].map((fp) => h('button', {
                    key: fp.k,
                    type: 'button',
                    className: 'rt-btn' + (taskFilter === fp.k ? ' rt-btn-primary' : ''),
                    style: { padding: '2px 8px', fontSize: 11 },
                    onClick: () => setTaskFilter(fp.k),
                  }, fp.lbl))),
                filteredTasks.length === 0
                  ? h('div', { className: 'rt-empty' }, t('当前暂无协作工作项 —— 在「协同与审批」拆解需求或新增分片后将自动生成。', 'No collab tasks yet — decompose requirements in "Collab & Approval" or add a shard.'))
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
                        }, clickable(() => setExpandedTaskId(isExp ? null : tk.id), { label: t('展开协作任务详情 ', 'Toggle task ') + tk.title, expanded: isExp })),
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
                                }, isTaskBusy ? t('拉起中…', 'Starting...') : t('拉起执行', 'Dispatch'))
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
                          }, t('委派: ', 'Goal: ') + tk.prompt),
                          isExp
                            ? h('div', {
                                style: { marginTop: 4, paddingTop: 6, borderTop: '1px dashed var(--dsw-alias-border-l1)', display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5 },
                              },
                                h('div', { style: { color: 'var(--dsw-alias-label-primary)', lineHeight: 1.55 } },
                                  h('b', null, t('产出摘要：', 'Output Digest: ')), tk.output),
                                h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)' } },
                                  h('span', { className: 'rt-mono' }, t('用量 ', 'Tokens ') + tk.tokenLabel),
                                  h('span', { className: 'rt-mono' }, t('耗时 ', 'Duration ') + tk.durationLabel),
                                  h('span', { className: 'rt-mono' }, tk.steps + t(' 步', ' steps')),
                                  h('div', { className: 'rt-spacer' }),
                                  h('button', {
                                    type: 'button',
                                    className: 'rt-btn',
                                    style: { padding: '1px 7px', fontSize: 10.5 },
                                    onClick: (e) => { e.stopPropagation(); openAgentInspector(tk.agentId) },
                                  }, t('检视环节细节', 'Inspect Steps')),
                                  h('button', {
                                    type: 'button',
                                    className: 'rt-btn rt-jump-chat-btn',
                                    style: { padding: '1px 7px', fontSize: 10.5 },
                                    onClick: (e) => { e.stopPropagation(); handleOpenAgentChat(tk) },
                                  }, t('跳转会话聊天 ↗', 'Open Chat ↗')),
                                  h('button', {
                                    type: 'button',
                                    className: 'rt-btn',
                                    style: { padding: '1px 7px', fontSize: 10.5 },
                                    onClick: (e) => { e.stopPropagation(); setSelId(tk.role); setMode('docwall') },
                                  }, t('查看角色文稿 →', 'View Role Doc →')),
                                  h('button', {
                                    type: 'button',
                                    className: 'rt-btn rt-btn-primary',
                                    style: { padding: '1px 7px', fontSize: 10.5 },
                                    onClick: (e) => { e.stopPropagation(); triggerCheckpoint(t('断点续跑', 'Checkpoint Resume'), 'resume', tk.agentId || tk.role) },
                                  }, t('断点续跑', 'Resume'))))
                            : null)
                      }))))
          : null,

        effectiveMode === 'docwall'
          ? h('div', { className: 'rt-doc-wall' },
              h('div', { className: 'rt-doc-strip' },
                allNodes.map((n) => h('div', Object.assign({
                  key: 'doc' + n.id,
                  className: 'rt-doc-item' + (selId === n.id ? ' on' : ''),
                }, clickable(() => setSelId(n.id), { label: t('预览文稿 ', 'Preview ') + n.docTitle, expanded: selId === n.id })),
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
                  }, t('复制文稿', 'Copy Doc')),
                  h('button', { type: 'button', className: 'rt-btn', onClick: () => setMode('p4') }, t('返回派生树', 'Back to Tree'))),
                h(Markdown, { className: 'rt-markdown', text: selected.docBody })))
          : null)
    }



    function RtMiniDonut(props) {
      const segments = Array.isArray(props.segments) ? props.segments.filter((s) => (Number(s.value) || 0) > 0) : []
      const total = segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0)
      const r = 34
      const circ = 2 * Math.PI * r
      let offset = 0
      const arcs = total > 0
        ? segments.map((s, idx) => {
            const len = ((Number(s.value) || 0) / total) * circ
            const el = h('circle', {
              key: 'arc-' + idx,
              cx: 46,
              cy: 46,
              r: r,
              fill: 'none',
              stroke: s.color || '#4d6bfe',
              strokeWidth: 11,
              strokeDasharray: len.toFixed(2) + ' ' + circ.toFixed(2),
              strokeDashoffset: (-offset).toFixed(2),
              transform: 'rotate(-90 46 46)',
            })
            offset += len
            return el
          })
        : [h('circle', {
            key: 'arc-empty',
            cx: 46,
            cy: 46,
            r: r,
            fill: 'none',
            stroke: 'var(--dsw-alias-border-l1, #e2e8f0)',
            strokeWidth: 11,
          })]
      return h('div', { className: 'rt-ov-donut-box' },
        h('svg', { width: 92, height: 92, viewBox: '0 0 92 92', 'aria-hidden': 'true' }, ...arcs),
        h('div', { className: 'rt-ov-donut-center' },
          h('div', { className: 'rt-ov-donut-main' }, props.centerMain || '0'),
          props.centerSub ? h('div', { className: 'rt-ov-donut-sub' }, props.centerSub) : null))
    }

    function RtStackedBar(props) {
      const segments = Array.isArray(props.segments) ? props.segments.filter((s) => (Number(s.value) || 0) > 0) : []
      const total = segments.reduce((sum, s) => sum + (Number(s.value) || 0), 0)
      const cls = props.mini ? 'rt-ov-mini-bar' : 'rt-ov-seg-bar'
      const segCls = props.mini ? 'rt-ov-mini-seg' : 'rt-ov-seg-piece'
      if (total <= 0) {
        return h('div', { className: cls })
      }
      return h('div', { className: cls },
        segments.map((s, idx) => {
          const pct = Math.max(2, ((Number(s.value) || 0) / total) * 100)
          return h('div', {
            key: 'seg-' + idx,
            className: segCls,
            style: { width: pct.toFixed(2) + '%', background: s.color || '#4d6bfe' },
            title: (s.label || '') + ': ' + (s.display || String(s.value)),
          })
        }))
    }

    function OverviewTab(props) {
      useLocale()
      const eng = props.engagement
      const engName = props.engagementName || eng
      const snapshot = props.snapshot
      const refreshKey = props.refreshKey || 0
      const onGo = props.onGo || (() => {})
      const currentSess = useSession()
      const activeSid = props.sessionId || currentSess.id || null

      const [agents, setAgents] = React.useState(null)
      const [dagData, setDagData] = React.useState(null)
      const [domTel, setDomTel] = React.useState(() => readHostDomTelemetry())
      const [expandedKey, setExpandedKey] = React.useState(null)
      const [sessionDetail, setSessionDetail] = React.useState(null)
      const [detailLoading, setDetailLoading] = React.useState(false)
      const [err, setErr] = React.useState(null)
      const [localRefresh, setLocalRefresh] = React.useState(0)
      const loadSeq = React.useRef(0)

      const load = React.useCallback(() => {
        const mySeq = ++loadSeq.current
        setDomTel(readHostDomTelemetry())
        if (!eng) {
          setAgents(null)
          setDagData(null)
          setSessionDetail(null)
          setErr(null)
          return
        }
        setErr(null)
        Promise.all([
          api({ op: 'agentsStatus', engagement: eng, session: activeSid || undefined }),
          api({ op: 'workflowDag', engagement: eng, session: activeSid || undefined }),
        ]).then(([ag, dg]) => {
          if (mySeq !== loadSeq.current) return
          if (!ag || ag.ok === false) {
            setErr((ag && ag.error) || t('读取工作台状态失败', 'Failed to read workspace status'))
            return
          }
          setAgents(ag)
          setDagData(dg && dg.ok !== false ? dg : null)
        }, (e) => {
          if (mySeq !== loadSeq.current) return
          setErr(String((e && e.message) || e))
        })
      }, [eng, activeSid])

      React.useEffect(() => {
        load()
      }, [load, refreshKey, localRefresh])

      useHostEvents(eng, load, 700)

      React.useEffect(() => {
        const t = window.setInterval(() => {
          if (!_isCanvasDragging) setDomTel(readHostDomTelemetry())
        }, 3000)
        return () => window.clearInterval(t)
      }, [])

      React.useEffect(() => {
        if (!eng || (expandedKey !== 'comms' && expandedKey !== 'context')) return
        let alive = true
        setDetailLoading(true)
        api({
          op: 'agentSessionDetail',
          engagement: eng,
          session: activeSid || undefined,
        }).then((res) => {
          if (!alive) return
          setDetailLoading(false)
          if (res && res.ok !== false) setSessionDetail(res)
        }, () => {
          if (alive) setDetailLoading(false)
        })
        return () => { alive = false }
      }, [eng, activeSid, expandedKey, refreshKey, localRefresh])

      const cleanSessionTitle = (props.sessionTitle && !isRawUuidName(props.sessionTitle) ? props.sessionTitle : null)
        || (currentSess.title && !isRawUuidName(currentSess.title) ? currentSess.title : null)
        || (activeSid ? (t('会话 ', 'Session ') + formatShortSessionId(activeSid)) : t('当前新会话', 'New Session'))

      if (!eng) {
        const sState = props.sessionState || null
        const isDismissed = Boolean(sState && sState.onboarding_dismissed)
        const hasConv = Boolean(sState && sState.has_conversation)
        return h('div', { className: 'rt-main rt-ov' },
          h('div', { className: 'rt-ov-scroll' },
            h('div', { className: 'rt-bento-stack rt-bento-workspace' },
              h('section', { className: 'rt-card rt-ov-standby-card' },
                h('div', { className: 'rt-ov-standby-badge-row' },
                  h('span', { className: 'rt-tag rt-tag-live' }, t('独立会话隔离', 'Session Isolated')),
                  h('span', { className: 'rt-mono', style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                    t('当前会话：', 'Session: ') + cleanSessionTitle),
                  sState && sState.cwd
                    ? h('span', { className: 'rt-tag rt-mono' }, sState.cwd)
                    : null),
                h('div', { className: 'rt-ov-standby-title' },
                  cleanSessionTitle + t(' · 未绑定工作台', ' · Unbound Workspace')),
                h('div', { className: 'rt-ov-standby-sub' },
                  t('0 运行中智能体 · 0 已拆解模块 · 每个会话拥有专属 1:1 隔离工作台。', '0 running agents · 0 shards · Each session gets an isolated 1:1 workspace.')),
                h('div', { className: 'rt-ov-standby-actions' },
                  h('button', {
                    type: 'button',
                    className: 'rt-btn rt-btn-primary',
                    onClick: () => onGo('collab'),
                  }, t('前往「协同与审批」初始化', 'Initialize in Collab & Approval')),
                  isDismissed && !hasConv
                    ? h('button', {
                        type: 'button',
                        className: 'rt-btn',
                        style: { borderColor: 'rgba(59,130,246,0.45)', color: 'var(--wb-blue-ink,#2563eb)', fontWeight: 700 },
                        onClick: () => {
                          if (typeof props.onReopenOnboarding === 'function') props.onReopenOnboarding()
                          onGo('collab')
                        },
                      }, t('重新获取初始化指引', 'Reopen Setup Guide'))
                    : null)))))
      }

      const stats = (snapshot && snapshot.stats) || {}
      const used = agents ? (Number(agents.used) || 0) : 0
      const max = agents ? (Number(agents.max) || 6) : 6
      const hostSessions = (agents && Array.isArray(agents.host_sessions)) ? agents.host_sessions : []
      const activeHostSess = hostSessions.find((hs) => hs.id === (activeSid || domTel.sessionId)) || hostSessions[0] || null
      const netChildren = (agents && agents.agentNetwork && Array.isArray(agents.agentNetwork.children))
        ? agents.agentNetwork.children
        : ((agents && Array.isArray(agents.children)) ? agents.children : [])
      const dagTasks = (dagData && Array.isArray(dagData.worker_tasks)) ? dagData.worker_tasks : []
      const dagDigests = (dagData && Array.isArray(dagData.worker_digests)) ? dagData.worker_digests : []
      const shardLocks = (dagData && Array.isArray(dagData.shard_locks))
        ? dagData.shard_locks
        : ((agents && Array.isArray(agents.shard_locks)) ? agents.shard_locks : [])
      const pgProbe = (agents && agents.pg_probe) || (dagData && dagData.pg_probe) || null
      const pgWorkerTaskCount = (pgProbe && pgProbe.row_counts && Number(pgProbe.row_counts.worker_tasks)) || 0
      const budgetGuard = (dagData && dagData.budgetGuard)
        || (agents && agents.budgetGuard)
        || (snapshot && snapshot.budgetGuard)
        || null
      const perfMetrics = (dagData && dagData.perfMetrics)
        || (agents && agents.perfMetrics)
        || (snapshot && snapshot.perfMetrics)
        || null

      const totalDispatchedSubagents = netChildren.length
        || dagTasks.length
        || (agents && Number(agents.total_children))
        || pgWorkerTaskCount
        || used
        || 0
      const runningSubagentCount = netChildren.filter((c) => c.status === 'running' || c.status === 'run' || c.activity === 'running').length
      const activeSlots = Math.min(max, Math.max(used, runningSubagentCount))

      const realTokens = domTel.tokens > 0
        ? domTel.tokens
        : ((activeHostSess && activeHostSess.tokens > 0) ? activeHostSess.tokens : 0)
      const realTokenLabel = domTel.tokens > 0
        ? domTel.tokenLabel
        : (realTokens > 0 ? fmtTokNum(realTokens) : '0')
      const realRounds = domTel.rounds > 0
        ? domTel.rounds
        : ((activeHostSess && activeHostSess.rounds > 0) ? activeHostSess.rounds : 0)
      const realSteps = domTel.steps > 0
        ? domTel.steps
        : ((activeHostSess && activeHostSess.steps > 0) ? activeHostSess.steps : (Number(stats.steps) || 0))
      const realSpeedLabel = domTel.speedLabel !== '0 tok/s'
        ? domTel.speedLabel
        : ((activeHostSess && activeHostSess.speedLabel) ? activeHostSess.speedLabel : (realTokens > 0 ? t('实时采样', 'Live') : '0 tok/s'))
      const cacheHitPct = domTel.cacheHitPct > 0
        ? domTel.cacheHitPct
        : (activeHostSess && Number(activeHostSess.cacheHitPct) ? Number(activeHostSess.cacheHitPct) : 0)
      const realCacheShort = domTel.cacheLabel && domTel.cacheLabel !== '待命'
        ? (getLocale() === 'en-US' ? (cacheHitPct > 0 ? ('Cache ' + cacheHitPct + '%') : 'Cache Idle') : domTel.cacheLabel)
        : (cacheHitPct > 0 ? (t('缓存 ', 'Cache ') + cacheHitPct + '%') : t('缓存待命', 'Cache Idle'))

      const ctxUsedNum = domTel.contextUsedLabel
        ? parseTokNum(domTel.contextUsedLabel)
        : ((activeHostSess && Number(activeHostSess.contextTokens)) || 0)
      const ctxMaxNum = domTel.contextMaxLabel
        ? parseTokNum(domTel.contextMaxLabel)
        : ((activeHostSess && Number(activeHostSess.contextMax)) || 421000)
      const ctxShort = domTel.contextUsedLabel
        ? (domTel.contextUsedLabel + '/' + (domTel.contextMaxLabel || '421k'))
        : (ctxUsedNum > 0 ? (fmtTokNum(ctxUsedNum) + '/' + fmtTokNum(ctxMaxNum)) : '0/421k')
      const ctxPctLabel = domTel.contextPct
        || (ctxUsedNum > 0 && ctxMaxNum > 0 ? Math.round((ctxUsedNum / ctxMaxNum) * 100) + '%' : '0%')

      const inputTok = parseTokNum(domTel.inputLabel)
      const outputTok = parseTokNum(domTel.outputLabel)
      const reasonTok = parseTokNum(domTel.reasoningLabel)
      const costText = domTel.costLabel || (activeHostSess && activeHostSess.costLabel) || t('暂无', 'N/A')

      const doneTasks = dagTasks.filter((tItem) => tItem.status === 'done' || tItem.status === 'approved' || tItem.status === 'completed').length
      const pendingCount = typeof countPendingApprovals === 'function' ? countPendingApprovals(snapshot, dagData) : 0
      const realPgWrites = (pgProbe && typeof pgProbe.total_writes === 'number')
        ? pgProbe.total_writes
        : ((Number(stats.assets) || 0) + (Number(stats.vulns) || 0) + (Number(stats.steps) || 0))
      const hasActiveWork = totalDispatchedSubagents > 0 || realPgWrites > 0

      const workspaceDisplayTitle = (engName && !isRawUuidName(engName) ? engName : null)
        || (props.sessionTitle && !isRawUuidName(props.sessionTitle) ? props.sessionTitle : null)
        || cleanSessionTitle
        || engName

      const pm = perfMetrics && typeof perfMetrics === 'object' ? perfMetrics : {}
      const digestCompPctText = Number.isFinite(Number(pm.digestCompressionRatioPct))
        ? (Number(pm.digestCompressionRatioPct) + '%')
        : (pgProbe && typeof pgProbe.compression_ratio_pct === 'number'
          ? (pgProbe.compression_ratio_pct + '%')
          : t('暂无', 'N/A'))
      const parallelEffText = Number.isFinite(Number(pm.parallelismEfficiencyPct))
        ? (Number(pm.parallelismEfficiencyPct) + '%')
        : (max > 0 ? Math.round((activeSlots / max) * 100) + '%' : t('暂无', 'N/A'))
      const schemaTokenSavedText = Number.isFinite(Number(pm.schemaTokenSavedEstimate))
        ? (fmtTokNum(Number(pm.schemaTokenSavedEstimate)) + ' tok')
        : t('暂无', 'N/A')
      const scopeComplianceText = Number.isFinite(Number(pm.scopeCompliancePct))
        ? (Number(pm.scopeCompliancePct) + '%')
        : t('暂无', 'N/A')

      const toggleCard = (key) => {
        setExpandedKey((prev) => (prev === key ? null : key))
      }

      const kpiCards = [
        {
          key: 'comms',
          label: t('沟通与执行', 'Execution'),
          val: t(realRounds + ' 轮 · ' + realSteps + ' 步', realRounds + ' rounds · ' + realSteps + ' steps'),
          sub: t('输出速度 ', 'Throughput ') + realSpeedLabel,
          segments: [
            { label: t('模型输入', 'Input'), value: Math.max(inputTok, realRounds > 0 ? 60 : 0), color: '#4d6bfe' },
            { label: t('模型输出', 'Output'), value: Math.max(outputTok, realSteps > 0 ? 25 : 0), color: '#0ea5e9' },
            { label: t('思考推理', 'Reasoning'), value: reasonTok, color: '#8b5cf6' },
          ],
        },
        {
          key: 'cluster',
          label: t('并发集群', 'Concurrency'),
          val: t(activeSlots + '/' + max + ' 槽', activeSlots + '/' + max + ' slots'),
          accent: true,
          sub: t('累计调度 ' + totalDispatchedSubagents + ' 个子代理', totalDispatchedSubagents + ' subagents dispatched'),
          segments: [
            { label: t('运行中槽位', 'Active Slots'), value: activeSlots, color: '#4d6bfe' },
            { label: t('空闲可用槽位', 'Idle Slots'), value: Math.max(0, max - activeSlots), color: '#cbd5e1' },
          ],
        },
        {
          key: 'context',
          label: t('上下文与缓存', 'Context & Cache'),
          val: ctxShort + ' · ' + realCacheShort,
          sub: t('总计 ' + realTokenLabel + ' tok · 费用 ' + costText, 'Total ' + realTokenLabel + ' tok · Cost ' + costText),
          segments: [
            { label: t('缓存命中', 'Cache Hit'), value: cacheHitPct > 0 ? cacheHitPct : (realTokens > 0 ? 50 : 0), color: '#10b981' },
            { label: t('非缓存输入', 'Uncached'), value: cacheHitPct > 0 ? Math.max(0, 100 - cacheHitPct) : (realTokens > 0 ? 50 : 0), color: '#4d6bfe' },
          ],
        },
        {
          key: 'delivery',
          label: t('交付进度', 'Delivery'),
          val: dagTasks.length > 0 ? t(doneTasks + '/' + dagTasks.length + ' 分片', doneTasks + '/' + dagTasks.length + ' shards') : t('待立项拆解', 'Pending Launch'),
          sub: t('已提交摘要 ' + dagDigests.length + ' 份 · 排他锁 ' + shardLocks.length + ' 项', dagDigests.length + ' digests · ' + shardLocks.length + ' locks'),
          segments: [
            { label: t('已完成分片', 'Completed'), value: doneTasks, color: '#10b981' },
            { label: t('推进中/待审', 'In Progress / Pending'), value: Math.max(0, dagTasks.length - doneTasks), color: '#f59e0b' },
          ],
        },
      ]

      const renderDetailDrawer = () => {
        if (!expandedKey) return null
        const detailMeta = kpiCards.find((c) => c.key === expandedKey)
        const titleText = detailMeta ? detailMeta.label + t(' · 详细分析表', ' · Breakdown') : t('详细视图', 'Details')

        let bodyNode = null

        if (expandedKey === 'comms') {
          const msgs = (sessionDetail && Array.isArray(sessionDetail.messages)) ? sessionDetail.messages : []
          const recentSteps = msgs.slice(-8).reverse()
          const segs = [
            { label: t('输入 Token', 'Input Tokens'), value: inputTok, display: domTel.inputLabel || '0', color: '#4d6bfe' },
            { label: t('输出 Token', 'Output Tokens'), value: outputTok, display: domTel.outputLabel || '0', color: '#0ea5e9' },
            { label: t('推理 Token', 'Reasoning Tokens'), value: reasonTok, display: domTel.reasoningLabel || '0', color: '#8b5cf6' },
            { label: t('缓存命中率', 'Cache Hit'), value: Math.round(cacheHitPct * 10), display: cacheHitPct ? (cacheHitPct + '%') : t('待命', 'Idle'), color: '#10b981' },
          ]
          bodyNode = h('div', { className: 'rt-ov-detail-grid' },
            h('div', { className: 'rt-ov-detail-card' },
              h('div', { className: 'rt-ov-detail-card-head' },
                h('span', null, t('对话与吞吐统计', 'Dialogue & Throughput')),
                h('span', { className: 'rt-mono', style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, realSpeedLabel)),
              h('div', { className: 'rt-ov-stat-tiles' },
                h('div', { className: 'rt-ov-stat-tile' },
                  h('div', { className: 'rt-ov-stat-tile-val' }, String(realRounds)),
                  h('div', { className: 'rt-ov-stat-tile-lbl' }, t('轮次', 'Rounds'))),
                h('div', { className: 'rt-ov-stat-tile' },
                  h('div', { className: 'rt-ov-stat-tile-val' }, String(realSteps)),
                  h('div', { className: 'rt-ov-stat-tile-lbl' }, t('步数', 'Steps'))),
                h('div', { className: 'rt-ov-stat-tile' },
                  h('div', { className: 'rt-ov-stat-tile-val' }, String(netChildren.length || domTel.subagentCount || 0)),
                  h('div', { className: 'rt-ov-stat-tile-lbl' }, t('子代理', 'Subagents'))),
                h('div', { className: 'rt-ov-stat-tile' },
                  h('div', { className: 'rt-ov-stat-tile-val' }, realTokenLabel),
                  h('div', { className: 'rt-ov-stat-tile-lbl' }, t('总 Token', 'Total Tokens')))),
              h('div', { className: 'rt-ov-donut-wrap' },
                h(RtMiniDonut, {
                  segments: segs.slice(0, 3),
                  centerMain: realTokenLabel,
                  centerSub: t('总用量', 'Total'),
                }),
                h('div', { className: 'rt-ov-legend-grid' },
                  segs.map((s) => h('div', { key: s.label, className: 'rt-ov-legend-row' },
                    h('span', { className: 'rt-ov-legend-name' },
                      h('span', { className: 'rt-ov-dot', style: { background: s.color } }),
                      s.label),
                    h('span', { className: 'rt-ov-legend-val rt-mono' }, s.display)))))),
            h('div', { className: 'rt-ov-detail-card' },
              h('div', { className: 'rt-ov-detail-card-head' },
                h('span', null, t('最近会话轮步明细', 'Recent Session Steps')),
                detailLoading ? h('span', { className: 'rt-tag' }, t('加载中…', 'Loading...')) : null),
              h('div', { className: 'rt-ov-table-wrap' },
                h('table', { className: 'rt-ov-table' },
                  h('thead', null,
                    h('tr', null,
                      h('th', null, t('角色', 'Role')),
                      h('th', null, t('摘要内容', 'Summary')),
                      h('th', null, t('时间', 'Time')))),
                  h('tbody', null,
                    recentSteps.length > 0
                      ? recentSteps.map((m, idx) => h('tr', { key: 'msg-' + idx },
                          h('td', null, h('span', { className: 'rt-tag' }, m.role || 'assistant')),
                          h('td', null, String(m.preview || m.text || m.summary || '—').slice(0, 80)),
                          h('td', { className: 'rt-mono' }, m.at ? String(m.at).slice(11, 19) : '—')))
                      : h('tr', null,
                          h('td', { colSpan: 3, style: { color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', padding: '14px' } },
                            t('暂无可展示的轮步事件，发送对话或启动子代理后将自动同步明细。', 'No step events yet. Details sync automatically once conversation or subagents start.'))))))))
        } else if (expandedKey === 'cluster') {
          const allWorkers = dagTasks.length > 0 ? dagTasks : netChildren
          bodyNode = h('div', { className: 'rt-ov-detail-card' },
            h('div', { className: 'rt-ov-detail-card-head' },
              h('span', null, t('并发槽位与子代理任务明细表（' + activeSlots + '/' + max + ' 槽占用）', 'Concurrency Slots & Worker Tasks (' + activeSlots + '/' + max + ' active)')),
              h('button', {
                type: 'button',
                className: 'rt-btn',
                style: { padding: '2px 9px', fontSize: 11 },
                onClick: () => onGo('agents'),
              }, t('前往「集群」完整视图 →', 'Full Cluster View →'))),
            h('div', { className: 'rt-ov-stat-tiles', style: { marginBottom: 8 } },
              h('div', { className: 'rt-ov-stat-tile' },
                h('div', { className: 'rt-ov-stat-tile-val' }, parallelEffText),
                h('div', { className: 'rt-ov-stat-tile-lbl' }, t('并行效率', 'Parallel Efficiency'))),
              h('div', { className: 'rt-ov-stat-tile' },
                h('div', { className: 'rt-ov-stat-tile-val' }, digestCompPctText),
                h('div', { className: 'rt-ov-stat-tile-lbl' }, t('摘要压缩率', 'Digest Compression'))),
              h('div', { className: 'rt-ov-stat-tile' },
                h('div', { className: 'rt-ov-stat-tile-val' }, schemaTokenSavedText),
                h('div', { className: 'rt-ov-stat-tile-lbl' }, t('Schema 节省 Token', 'Schema Token Saved'))),
              h('div', { className: 'rt-ov-stat-tile' },
                h('div', { className: 'rt-ov-stat-tile-val' }, scopeComplianceText),
                h('div', { className: 'rt-ov-stat-tile-lbl' }, t('分片合规率', 'Scope Compliance')))),
            h(RtStackedBar, {
              segments: [
                { label: t('活跃槽位', 'Active Slots'), value: activeSlots, display: activeSlots + t(' 槽', ' slots'), color: '#4d6bfe' },
                { label: t('空闲槽位', 'Idle Slots'), value: Math.max(0, max - activeSlots), display: Math.max(0, max - activeSlots) + t(' 槽', ' slots'), color: '#e2e8f0' },
              ],
            }),
            h('div', { className: 'rt-ov-table-wrap' },
              h('table', { className: 'rt-ov-table' },
                h('thead', null,
                  h('tr', null,
                    h('th', null, 'Wave'),
                    h('th', null, t('角色', 'Role')),
                    h('th', null, t('任务标题 / 目标', 'Task Title / Goal')),
                    h('th', null, t('状态', 'Status')),
                    h('th', null, t('独占文件分片', 'Owned Files')))),
                h('tbody', null,
                  allWorkers.length > 0
                    ? allWorkers.slice(0, 12).map((w, idx) => h('tr', { key: 'wk-' + idx },
                        h('td', { className: 'rt-mono' }, 'W' + (w.wave || w.wave_no || 1)),
                        h('td', null, h('span', { className: 'rt-tag' }, w.role || w.agent_role || 'worker')),
                        h('td', null, String(w.title || w.assigned_goal || w.goal || w.id || '—').slice(0, 64)),
                        h('td', null, String(w.status || w.activity || 'queued')),
                        h('td', { className: 'rt-mono' }, Array.isArray(w.files_owned) && w.files_owned.length > 0
                          ? w.files_owned.slice(0, 2).join(', ')
                          : '—')))
                    : h('tr', null,
                        h('td', { colSpan: 5, style: { color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', padding: '14px' } },
                          t('当前工作台尚未派发子代理，前往「协同与审批」立项后将展示并发分片明细。', 'No subagents dispatched yet. Launch in "Collab & Approval" to view shards.')))))))
        } else if (expandedKey === 'context') {
          const nonCachePct = cacheHitPct > 0 ? Math.max(0, Number((100 - cacheHitPct).toFixed(1))) : 0
          const ctxSegments = [
            { label: t('输入 Token', 'Input Tokens'), value: inputTok || (ctxUsedNum > 0 ? Math.round(ctxUsedNum * 0.7) : 0), display: domTel.inputLabel || (ctxUsedNum > 0 ? fmtTokNum(ctxUsedNum) : t('暂无采样', 'N/A')), color: '#4d6bfe' },
            { label: t('输出 Token', 'Output Tokens'), value: outputTok, display: domTel.outputLabel || '0', color: '#0ea5e9' },
            { label: t('推理 Token', 'Reasoning Tokens'), value: reasonTok, display: domTel.reasoningLabel || '0', color: '#8b5cf6' },
            { label: t('剩余可用窗口', 'Remaining Window'), value: Math.max(0, ctxMaxNum - ctxUsedNum), display: ctxMaxNum > ctxUsedNum ? fmtTokNum(ctxMaxNum - ctxUsedNum) : '0', color: '#e2e8f0' },
          ]
          const cacheSegments = [
            { label: t('缓存命中率', 'Cache Hit Rate'), value: cacheHitPct, display: cacheHitPct ? (cacheHitPct + '%') : t('待命', 'Idle'), color: '#10b981' },
            { label: t('非缓存输入', 'Uncached Input'), value: nonCachePct, display: nonCachePct ? (nonCachePct + '%') : '—', color: '#4d6bfe' },
          ]
          bodyNode = h('div', { className: 'rt-ov-detail-grid' },
            h('div', { className: 'rt-ov-detail-card' },
              h('div', { className: 'rt-ov-detail-card-head' },
                h('span', null, t('当前上下文窗口构成', 'Current Context Window Breakdown')),
                h('span', { className: 'rt-mono', style: { fontSize: 11.5 } }, ctxShort + ' (' + ctxPctLabel + ')')),
              h(RtStackedBar, { segments: ctxSegments }),
              h('div', { className: 'rt-ov-legend-grid' },
                ctxSegments.map((s) => h('div', { key: s.label, className: 'rt-ov-legend-row' },
                  h('span', { className: 'rt-ov-legend-name' },
                    h('span', { className: 'rt-ov-dot', style: { background: s.color } }),
                    s.label),
                  h('span', { className: 'rt-ov-legend-val rt-mono' }, s.display)))),
              h('div', { className: 'rt-ov-table-wrap' },
                h('table', { className: 'rt-ov-table' },
                  h('tbody', null,
                    h('tr', null,
                      h('td', null, t('会话总消耗 Token', 'Total Session Tokens')),
                      h('td', { className: 'rt-mono', style: { textAlign: 'right', fontWeight: 700 } }, realTokenLabel)),
                    h('tr', null,
                      h('td', null, t('参考费用（宿主实时采样）', 'Estimated Cost (Live)')),
                      h('td', { className: 'rt-mono', style: { textAlign: 'right', fontWeight: 700 } }, costText)),
                    h('tr', null,
                      h('td', null, t('Worker 摘要压缩率', 'Digest Compression Ratio')),
                      h('td', { className: 'rt-mono', style: { textAlign: 'right', fontWeight: 700 } }, digestCompPctText)),
                    h('tr', null,
                      h('td', null, t('Schema 预估节省 Token', 'Schema Token Saved Est.')),
                      h('td', { className: 'rt-mono', style: { textAlign: 'right', fontWeight: 700 } }, schemaTokenSavedText)),
                    h('tr', null,
                      h('td', null, t('并行效率 / 分片合规率', 'Parallel Efficiency / Scope Compliance')),
                      h('td', { className: 'rt-mono', style: { textAlign: 'right', fontWeight: 700 } }, parallelEffText + ' · ' + scopeComplianceText)))))),
            h('div', { className: 'rt-ov-detail-card' },
              h('div', { className: 'rt-ov-detail-card-head' },
                h('span', null, t('缓存读取与输入比例', 'Cache Read & Input Ratio')),
                h('span', { className: 'rt-tag' }, realCacheShort)),
              h('div', { className: 'rt-ov-donut-wrap' },
                h(RtMiniDonut, {
                  segments: cacheSegments,
                  centerMain: cacheHitPct ? (cacheHitPct + '%') : t('待命', 'Idle'),
                  centerSub: t('缓存命中', 'Cache Hit'),
                }),
                h('div', { className: 'rt-ov-legend-grid' },
                  cacheSegments.map((s) => h('div', { key: s.label, className: 'rt-ov-legend-row' },
                    h('span', { className: 'rt-ov-legend-name' },
                      h('span', { className: 'rt-ov-dot', style: { background: s.color } }),
                      s.label),
                    h('span', { className: 'rt-ov-legend-val rt-mono' }, s.display))))),
              h('div', { className: 'rt-ov-table-wrap' },
                h('table', { className: 'rt-ov-table' },
                  h('thead', null,
                    h('tr', null,
                      h('th', null, t('主机/子会话', 'Session')),
                      h('th', null, t('模型', 'Model')),
                      h('th', null, 'Token'))),
                  h('tbody', null,
                    hostSessions.length > 0
                      ? hostSessions.slice(0, 4).map((hs, idx) => h('tr', { key: 'hs-' + idx },
                          h('td', null, String(hs.title || hs.id || t('主会话', 'Main Session')).slice(0, 28)),
                          h('td', { className: 'rt-mono' }, String(hs.model || '—').slice(0, 24)),
                          h('td', { className: 'rt-mono' }, fmtTokNum(hs.tokens || 0))))
                      : h('tr', null,
                          h('td', { colSpan: 3, style: { color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', padding: '12px' } },
                            t('当前以本地 DOM 遥测为主，无多会话 Token 列表。', 'Using live local DOM telemetry; no multi-session token list.'))))))))
        } else if (expandedKey === 'delivery') {
          const waveDefs = [
            { wave: 1, name: t('Wave 1 · 立项与测绘', 'Wave 1 · Discovery'), color: '#4d6bfe' },
            { wave: 2, name: t('Wave 2 · 架构与分片', 'Wave 2 · Architecture'), color: '#8b5cf6' },
            { wave: 3, name: t('Wave 3 · 并发构建', 'Wave 3 · Parallel Build'), color: '#0ea5e9' },
            { wave: 4, name: t('Wave 4 · 审查与交付', 'Wave 4 · Review & Ship'), color: '#10b981' },
          ]
          bodyNode = h('div', { className: 'rt-ov-detail-card' },
            h('div', { className: 'rt-ov-detail-card-head' },
              h('span', null, t('4-Wave 工程交付进度与摘要明细', '4-Wave Delivery Progress & Digests')),
              h('div', { style: { display: 'inline-flex', gap: 6, flexWrap: 'wrap' } },
                h('button', { type: 'button', className: 'rt-btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: () => onGo('collab') }, t('协同与审批', 'Collab & Approval')),
                h('button', { type: 'button', className: 'rt-btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: () => onGo('assets') }, t('架构模块', 'Architecture')),
                h('button', { type: 'button', className: 'rt-btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: () => onGo('findings') }, t('质量审查', 'Quality')),
                h('button', { type: 'button', className: 'rt-btn', style: { padding: '2px 9px', fontSize: 11 }, onClick: () => onGo('report') }, t('交付报告', 'Report')))),
            h('div', { className: 'rt-ov-wave-strip' },
              waveDefs.map((wd) => {
                const wTasks = dagTasks.filter((tItem) => Number(tItem.wave || tItem.wave_no || 1) === wd.wave)
                const wDone = wTasks.filter((tItem) => tItem.status === 'done' || tItem.status === 'approved' || tItem.status === 'completed').length
                return h('div', { key: 'wd-' + wd.wave, className: 'rt-ov-wave-cell', style: { borderTop: '3px solid ' + wd.color } },
                  h('div', { style: { fontSize: 11.5, fontWeight: 700 } }, wd.name),
                  h('div', { className: 'rt-mono', style: { fontSize: 12, fontWeight: 700, color: wd.color } },
                    wTasks.length > 0 ? t(wDone + '/' + wTasks.length + ' 完成', wDone + '/' + wTasks.length + ' done') : t('0 分片', '0 shards')))
              })),
            h('div', { className: 'rt-ov-table-wrap' },
              h('table', { className: 'rt-ov-table' },
                h('thead', null,
                  h('tr', null,
                    h('th', null, t('角色', 'Role')),
                    h('th', null, t('已提交摘要（worker_digests）', 'Submitted Digest (worker_digests)')),
                    h('th', null, t('变更文件', 'Files Touched')),
                    h('th', null, t('审批状态', 'Approval')))),
                h('tbody', null,
                  dagDigests.length > 0
                    ? dagDigests.slice(0, 10).map((d, idx) => h('tr', { key: 'dg-' + idx },
                        h('td', null, h('span', { className: 'rt-tag' }, d.role || d.agent_role || 'worker')),
                        h('td', null, String(d.what_was_done || d.summary || '—').slice(0, 72)),
                        h('td', { className: 'rt-mono' }, Array.isArray(d.files_touched) && d.files_touched.length > 0
                          ? d.files_touched.slice(0, 2).join(', ')
                          : '—'),
                        h('td', null, d.approved ? t('已审批', 'Approved') : t('待审批', 'Pending'))))
                    : h('tr', null,
                        h('td', { colSpan: 4, style: { color: 'var(--dsw-alias-label-secondary)', textAlign: 'center', padding: '14px' } },
                          t('尚未收到 Worker 提交的执行摘要。', 'No worker digests submitted yet.')))))))
        }

        return h('section', { className: 'rt-ov-detail-drawer', 'data-detail-key': expandedKey },
          h('div', { className: 'rt-ov-detail-head' },
            h('div', { className: 'rt-ov-detail-title' },
              h('span', null, titleText),
              h('span', { className: 'rt-tag rt-mono' }, workspaceDisplayTitle)),
            h('div', { className: 'rt-ov-detail-actions' },
              h('button', {
                type: 'button',
                className: 'rt-btn',
                style: { padding: '2px 9px', fontSize: 11 },
                onClick: () => setLocalRefresh((x) => x + 1),
              }, t('刷新', 'Refresh')),
              h('button', {
                type: 'button',
                className: 'rt-btn',
                style: { padding: '2px 9px', fontSize: 11 },
                onClick: () => setExpandedKey(null),
              }, t('收起 ▴', 'Collapse ▴')))),
          bodyNode)
      }

      const showBudgetBanner = Boolean(budgetGuard && (budgetGuard.warnNearLimit || budgetGuard.tripped))

      return h('div', { className: 'rt-main rt-ov' },
        err ? h('div', { className: 'rt-err', style: { margin: '0 16px 8px' } }, err) : null,
        h('div', { className: 'rt-ov-scroll' },
          h('div', { className: 'rt-bento-stack rt-bento-workspace' },

            showBudgetBanner
              ? h('div', {
                  className: 'rt-ov-action-banner rt-budget-guard-banner ' + (budgetGuard.tripped ? 'is-tripped' : 'is-warn'),
                  role: 'alert',
                  style: {
                    border: '1px solid ' + (budgetGuard.tripped ? 'rgba(239,68,68,0.55)' : 'rgba(245,158,11,0.55)'),
                    background: budgetGuard.tripped ? 'rgba(239,68,68,0.09)' : 'rgba(245,158,11,0.09)',
                    color: budgetGuard.tripped ? '#ef4444' : '#b45309',
                  },
                },
                  h('span', { style: { fontWeight: 700 } },
                    (budgetGuard.tripped
                      ? t('预算熔断已触发：已暂停自动派发新分片。', 'Budget Circuit Breaker Tripped: auto-dispatch paused.')
                      : t('预算接近上限预警：当前工作区消耗接近设定上限。', 'Budget Warning: workspace consumption is nearing configured limit.'))
                    + (budgetGuard.reason ? (' ' + String(budgetGuard.reason)) : '')),
                  h('div', { className: 'rt-spacer' }),
                  h('button', {
                    type: 'button',
                    className: 'rt-btn' + (budgetGuard.tripped ? ' rt-btn-primary' : ''),
                    style: { padding: '3px 10px', fontSize: 11.5, fontWeight: 700 },
                    onClick: () => onGo('settings'),
                  }, t('前往设置调整预算 →', 'Adjust Budget in Settings →')))
              : null,

            pendingCount > 0
              ? h('div', { className: 'rt-ov-action-banner is-pending' },
                  h('span', { style: { fontWeight: 700 } },
                    t(pendingCount + ' 项分片产出待验收审批', pendingCount + ' shard output(s) awaiting approval')),
                  h('div', { className: 'rt-spacer' }),
                  h('button', {
                    type: 'button',
                    className: 'rt-btn rt-btn-primary',
                    style: { padding: '3px 10px', fontSize: 11.5, fontWeight: 700 },
                    onClick: () => onGo('collab'),
                  }, t('前往「协同与审批」', 'Go to Collab & Approval')))
              : (!hasActiveWork
                  ? h('div', { className: 'rt-ov-action-banner is-empty' },
                      h('span', null, t('当前工作台尚无研发任务，可前往「协同与审批」澄清需求并立项。', 'No active tasks in this workspace yet. Launch from "Collab & Approval".')),
                      h('div', { className: 'rt-spacer' }),
                      h('button', {
                        type: 'button',
                        className: 'rt-btn rt-btn-primary',
                        style: { padding: '3px 10px', fontSize: 11.5, fontWeight: 700 },
                        onClick: () => onGo('collab'),
                      }, t('前往「协同与审批」', 'Go to Collab & Approval')))
                  : null),

            h('div', { className: 'rt-ov-kpi-grid' },
              kpiCards.map((card) => {
                const isOpen = expandedKey === card.key
                return h('div', Object.assign({
                  key: card.key,
                  className: 'rt-ov-kpi-card is-interactive' + (isOpen ? ' is-expanded' : ''),
                }, clickable(() => toggleCard(card.key), {
                  label: (isOpen ? t('收起 ', 'Collapse ') : t('展开 ', 'Expand ')) + card.label + t('详细表', ' Details'),
                })),
                  h('div', { className: 'rt-ov-kpi-head' },
                    h('span', { className: 'rt-ov-kpi-label' }, card.label),
                    h('span', { className: 'rt-ov-kpi-toggle' }, isOpen ? t('▴ 收起', '▴ Hide') : t('▾ 详表', '▾ Details'))),
                  h('div', { className: 'rt-ov-kpi-val' + (card.accent ? ' accent' : '') }, card.val),
                  h(RtStackedBar, { mini: true, segments: card.segments }),
                  h('div', { className: 'rt-ov-kpi-sub' }, card.sub))
              })),

            renderDetailDrawer(),

            h('div', { className: 'rt-bento-row-canvas' },
              h(HarnessWorkflowDeck, {
                variant: 'overview',
                engagement: eng,
                engagementName: workspaceDisplayTitle,
                snapshot: snapshot,
                agents: agents,
                dagData: dagData,
                domTel: domTel,
                onReload: load,
                refreshKey: refreshKey + localRefresh,
                onOpenCollab: () => onGo('collab'),
                onOpenAgents: () => onGo('agents'),
                onOpenWishWizard: () => onGo('collab'),
              })))))
    }



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

      sideChildren.push(h('div', Object.assign({
        key: 'testing', className: 'rt-seg' + (view === 'testing' ? ' on' : ''),
        title: t('正在跑的扫描 / 探测与进度（5 秒自动刷新）', 'Active checks / probes & progress (auto-refresh every 5s)'),
      }, clickable(() => { setView('testing'); setCidr(null) }, { label: t('当前测试', 'Active Checks'), expanded: view === 'testing' })),
        h('div', { className: 'rt-seg-cidr', style: { display: 'flex', alignItems: 'baseline', gap: 5 } },
          h('span', { className: 'rt-scope rt-scope-testing', title: t('当前测试（既非内网也非外网）', 'Active checks (neither internal nor external)') }, t('测', 'RUN')),
          h('span', { style: { flex: 1 } }, t('当前测试', 'Active Checks'))),
        h('div', { className: 'rt-seg-meta' }, t('正在跑的扫描与探测', 'Running scans & probes'))))

      sideChildren.push(h('div', Object.assign({
        key: 'next', className: 'rt-seg' + (view === 'next' ? ' on' : ''),
        title: t('按待测状态 + 优先级 + 端口数排序，取前 10 个模块', 'Top 10 modules sorted by status + priority + ports'),
      }, clickable(() => { setView('next'); setCidr(null) }, { label: t('待验证模块 Top 10', 'Top 10 Pending'), expanded: view === 'next' })),
        h('div', { className: 'rt-seg-cidr', style: { display: 'flex', alignItems: 'baseline', gap: 5 } },
          h('span', { className: 'rt-scope rt-scope-testing', title: t('待评估/待测队列', 'Pending verification queue') }, t('下', 'NEXT')),
          h('span', { style: { flex: 1 } }, t('待验证模块 Top 10', 'Top 10 Pending'))),
        h('div', { className: 'rt-seg-meta' }, t('待评估 ', 'Pending ') + ((snapshot && snapshot.tests && snapshot.tests.untested) || 0) + t(' 个', ''))))

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

    const SEV_LABEL = { critical: '严重', high: '高危', medium: '中危', low: '低危', info: '信息' }
    const SEV_LABEL_EN = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' }
    const STATUS_LABEL = { candidate: '待验证', confirmed: '已确认', 'false-positive': '误报', exploited: '已利用', fixed: '已修复' }
    const STATUS_LABEL_EN = { candidate: 'Pending', confirmed: 'Confirmed', 'false-positive': 'False Positive', exploited: 'Verified', fixed: 'Fixed' }
    const sevLabel = (s) => t(SEV_LABEL[s] || s, SEV_LABEL_EN[s] || s)
    const vulnStatusLabel = (s) => t(STATUS_LABEL[s] || s, STATUS_LABEL_EN[s] || s)
    const sevClass = (s) => 'rt-sev rt-sev-' + (SEV_LABEL[s] ? s : 'info')

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

      const [grouped, setGrouped] = React.useState(true)

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

      const allFiles = (files || []).flatMap((g) => (g.files || []).map((f) => Object.assign({ target: g.target }, f)))
      const filesByVuln = new Map()
      for (const f of allFiles) {
        const vid = f.vuln_id === null || f.vuln_id === undefined ? null : Number(f.vuln_id)
        if (vid === null) continue
        if (!filesByVuln.has(vid)) filesByVuln.set(vid, [])
        filesByVuln.get(vid).push(f)
      }

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

      const [modelCatalog, setModelCatalog] = React.useState([])
      const [sessionRoute, setSessionRoute] = React.useState(null)
      const [modelMode, setModelMode] = React.useState('follow_session')
      const [provider, setProvider] = React.useState('')
      const [model, setModel] = React.useState('')
      const [reasoningEffort, setReasoningEffort] = React.useState('low')
      const [timeoutSec, setTimeoutSec] = React.useState(60)
      const [scanRepoContext, setScanRepoContext] = React.useState(true)
      const [customConstraints, setCustomConstraints] = React.useState('')

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

      const [dbEngine, setDbEngine] = React.useState(null)
      const [pgUrlMasked, setPgUrlMasked] = React.useState('')
      const [pgUrlConfigured, setPgUrlConfigured] = React.useState(false)
      const [pgUrlDraft, setPgUrlDraft] = React.useState('')
      const [pgBusy, setPgBusy] = React.useState(false)
      const [pgMsg, setPgMsg] = React.useState(null)

      const targetFeishuEng = eng || (engagements[0] && engagements[0].id) || 'default'
      const [feishuWebhook, setFeishuWebhook] = React.useState('')
      const [feishuOnNode, setFeishuOnNode] = React.useState(true)
      const [feishuOnGate, setFeishuOnGate] = React.useState(true)
      const [feishuOnShip, setFeishuOnShip] = React.useState(true)
      const [feishuBusy, setFeishuBusy] = React.useState(false)
      const [feishuMsg, setFeishuMsg] = React.useState(null)

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



    const GSTACK_ROLE_ROSTER = [
      {
        role: 'plan',
        badge: '⓪ plan Captain',
        title: '主控指挥（主会话调度）',
        titleEn: 'Lead Orchestrator (Main Session)',
        wave: 'Wave 0–4 全程中枢',
        waveEn: 'Wave 0-4 Hub',
        skills: ['/dag-orchestrate', '/slot-gate', '/pg-sync'],
        desc: '拆解用户意图、按 4-Wave DAG 调度 6 并发槽、核对事实库并汇总汇报，不直接改业务文件。',
        descEn: 'Decomposes user intent, schedules 6 parallel slots over 4-Wave DAG, verifies state DB and summarizes progress without direct code edits.',
      },
      {
        role: 'recon',
        badge: '① recon CEO',
        title: '产品与需求规划（信息收集）',
        titleEn: 'Product & Scope Planning (Discovery)',
        wave: 'Wave 1 · Slot #1',
        waveEn: 'Wave 1 · Slot #1',
        skills: ['/office-hours', '/plan-ceo-review'],
        desc: '全量业务模块与资产拓扑测绘，标注 P0/P1 优先级线索与产品验收口径。',
        descEn: 'Maps full module & asset topology, tags P0/P1 clues and defines product acceptance criteria.',
      },
      {
        role: 'designer',
        badge: '② designer Designer',
        title: '交互与视觉设计',
        titleEn: 'Interaction & Visual Design',
        wave: 'Wave 1 · Slot #2',
        waveEn: 'Wave 1 · Slot #2',
        skills: ['/plan-design-review', '/design-shotgun'],
        desc: 'DSH Desktop 模块化 Bento 组件树、设计令牌（#4D6BFE）与有数据/空态/报错三态交互规范。',
        descEn: 'DSH Desktop Bento component tree, design tokens (#4D6BFE), and data/empty/error UI state specifications.',
      },
      {
        role: 'assess',
        badge: '③ assess Eng Manager',
        title: '系统架构与排期',
        titleEn: 'Architecture & Scheduling',
        wave: 'Wave 2 · 1 槽契约锁',
        waveEn: 'Wave 2 · 1-Slot Contract Lock',
        skills: ['/plan-eng-review', '/file-disjoint-shard'],
        desc: '冻结模块接口契约、依赖拓扑与 6 并发无冲突文件分片（File-Disjoint Sharding）。',
        descEn: 'Freezes interface contracts, dependency topology, and conflict-free File-Disjoint Sharding for 6 parallel workers.',
      },
      {
        role: 'vuln-scan',
        badge: '④ vuln-scan Reviewer & CSO',
        title: '代码审查与安全门禁',
        titleEn: 'Code Review & Security Gate',
        wave: 'Wave 4 · Gate #1',
        waveEn: 'Wave 4 · Gate #1',
        skills: ['/review', '/cso'],
        desc: '静态代码缺陷审查、OWASP/STRIDE 安全门禁与凭据零明文泄露审计。',
        descEn: 'Static defect review, OWASP/STRIDE security gates, and zero-plaintext secret audit.',
      },
      {
        role: 'exploit',
        badge: '⑤ exploit 6× Builder',
        title: '全栈研发与分片构建',
        titleEn: 'Full-Stack Sharded Build',
        wave: 'Wave 3 · 6 槽满载',
        waveEn: 'Wave 3 · 6 Parallel Slots',
        skills: ['/parallel-build', '/subagent-spawn'],
        desc: 'Wave 3 主力 6 槽并发编码实现、单测自检与深度验证；遇微问题可递归派生子代理。',
        descEn: 'Wave 3 full 6-slot parallel implementation, unit testing, and verification; spawns child helpers as needed.',
      },
      {
        role: 'qa',
        badge: '⑥ qa QA Lead',
        title: '质量保障与自动化回归',
        titleEn: 'QA & Automated Regression',
        wave: 'Wave 4 · Gate #2',
        waveEn: 'Wave 4 · Gate #2',
        skills: ['/qa', '/benchmark'],
        desc: '全量测试套件、浏览器端到端回归、性能基线测试与高分成果独立复核。',
        descEn: 'Full test suite, E2E browser regression, performance benchmarks, and independent high-value milestone verification.',
      },
      {
        role: 'internal',
        badge: '⑦ internal Doc & Release',
        title: '文档工程与归档发布',
        titleEn: 'Docs & Release Engineering',
        wave: 'Wave 4 · Release',
        waveEn: 'Wave 4 · Release',
        skills: ['/ship', '/document-release'],
        desc: '文稿墙（Doc Wall）同步、版本归档、飞书群聊机器人推送与闭环交付报告生成。',
        descEn: 'Doc Wall sync, release archiving, Feishu group notifications, and closed-loop delivery report generation.',
      },
    ]

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
      useLocale()
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
            t('团队任务板 · ' + (1 + children.length) + ' 成员 · ' + runningCount + ' 运行中',
              'Team Board · ' + (1 + children.length) + ' members · ' + runningCount + ' running')),
          h('div', { className: 'rt-p5-filters' },
            [
              { k: 'all', lbl: t('全部', 'All') },
              { k: 'lead', lbl: t('主代理 Captain', 'Lead Captain') },
              { k: 'sub', lbl: t('子代理', 'Subagents') + ' (' + children.length + ')' },
            ].map((fp) => h('button', {
              key: 'p5f-' + fp.k,
              type: 'button',
              className: 'rt-p3-pill' + (filter === fp.k ? ' on' : ''),
              onClick: () => setFilter(fp.k),
            }, fp.lbl))),
          h('div', { className: 'rt-spacer' }),
          h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
            h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, t('树状图', 'Tree')),
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
                        h('span', { className: 'rt-p5-pill', style: { background: '#3b82f6', color: '#fff', fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999 } }, t('主代理', 'Lead')),
                        h('strong', { style: { fontSize: 12.5 } }, t('Captain 主控架构师', 'Captain Lead Architect')),
                        h('div', { className: 'rt-spacer' }),
                        h('span', { className: 'rt-tag rt-tag-live', style: { margin: 0 } }, runningCount > 0 ? t('协调中', 'Orchestrating') : t('就绪', 'Ready'))),
                      h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
                        t('工作区 ', 'Workspace ') + eng + t(' · 统筹 4-Wave 分片调度与摘要审批', ' · 4-Wave shard scheduling & digest gate')),
                      showChildren.length > 0 ? h('span', { className: 'rt-tree-port rt-tree-port-bottom' }) : null))
                : null,
              showChildren.length > 0
                ? h('div', { className: 'rt-p5-branches-grid' },
                    showChildren.map((c) => {
                      const cStatusLabel = c.status === 'error' ? t('异常', 'Error') : (c.status === 'running' ? t('运行中', 'Running') : t('已完成', 'Done'))
                      return h('div', Object.assign({
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
                      }, c.sessionId ? clickable(() => { openAgentSessionInHostChat(c.sessionId, c.title) }, { label: t('打开子代理 ', 'Open subagent ') + c.title }) : {}),
                        showRoot ? h('span', { className: 'rt-tree-port rt-tree-port-top' }) : null,
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
                          h('span', { className: 'rt-p5-pill', style: { background: c.color, color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 999 } }, c.role),
                          c.wave ? h('span', { className: 'rt-tag rt-tag-passive', style: { margin: 0 } }, c.wave) : null,
                          h('div', { className: 'rt-spacer' }),
                          h('span', { style: { fontSize: 10.5, fontWeight: 600, color: c.color } }, cStatusLabel)),
                        h('div', { style: { fontWeight: 700, fontSize: 12.5 } }, c.title),
                        c.goal ? h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.45 } }, c.goal) : null)
                    }))
                : filter !== 'lead'
                    ? h('div', { className: 'rt-empty', style: { width: '100%' } }, t('尚无已派发的子代理任务。', 'No subagent tasks dispatched yet.'))
                    : null))))
    }

    function AgentsTab(props) {
      useLocale()
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
            setErr((r && r.error) || t('读取集群并发状态失败', 'Failed to load cluster concurrency status'))
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
        setCtrlMsg(t('正在调整并发槽上限为 ' + clamped + ' 槽…', 'Updating slot limit to ' + clamped + '…'))
        api({ op: 'setAgentsMax', max: clamped }).then((r) => {
          if (r && r.ok !== false) {
            setCtrlMsg(t('已生效：并发槽上限 ' + (r.max || clamped) + ' 槽', 'Applied: max ' + (r.max || clamped) + ' slots'))
            load()
          } else {
            setCtrlMsg((r && r.error) || t('调整并发槽失败', 'Failed to update slot limit'))
          }
        }, (e) => setCtrlMsg(String((e && e.message) || e)))
      }

      const presets = [
        { n: 3, label: t('3 槽', '3 Slots') },
        { n: 6, label: t('6 槽 (推荐)', '6 Slots (Rec)') },
        { n: 8, label: t('8 槽', '8 Slots') },
        { n: 12, label: t('12 槽', '12 Slots') },
      ]

      return h('div', { className: 'rt-main' },
        h('div', { className: 'rt-toolbar' },
          h('span', { style: { fontWeight: 600 } }, t('智能体与并发', 'Agents & Concurrency')),
          h('span', {
            className: 'rt-tag' + (activeCount >= max ? ' rt-tag-warn' : (activeCount > 0 ? ' rt-tag-live' : ' rt-tag-passive')),
          }, t('并发槽 ', 'Slots ') + activeCount + '/' + max),
          h('span', {
            className: 'rt-tag rt-tag-live',
            title: t('子智能体超过 3 分钟无心跳自动回收槽位租约；文件分片由排他锁守护', 'Auto-reclaim stale slots after 3m without heartbeat; shards protected by exclusive locks'),
          }, t('3min 无心跳自动回收 · 分片排他锁', '3m Stale Reclaim · Exclusive Shard Locks')),
          h('div', { className: 'rt-spacer' }),
          h('button', {
            type: 'button',
            className: 'rt-btn',
            onClick: () => { if (typeof props.onGo === 'function') props.onGo('prompts') },
          }, t('角色与提示词 →', 'Roles & Prompts →')),
          h('button', {
            type: 'button',
            className: 'rt-btn',
            disabled: busy,
            onClick: load,
          }, busy ? t('读取中…', 'Loading…') : t('刷新', 'Refresh'))),
        h('div', { className: 'rt-pane' },
          err ? h('div', { className: 'rt-err' }, err) : null,
          h('div', { className: 'rt-card', style: { padding: '10px 12px' } },
            h('div', { className: 'rt-p3-ctrl', style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
              h('span', { style: { fontSize: 12, fontWeight: 700 } }, t('并发数量与租约控制', 'Concurrency & Lease Control')),
              h('div', { className: 'rt-p3-stepper', title: t('调节并发槽位 (1–' + limit + ')', 'Adjust concurrency slots (1-' + limit + ')') },
                h('button', { type: 'button', className: 'rt-p3-step-btn', disabled: max <= 1, onClick: () => applySlotMax(max - 1) }, '-'),
                h('span', { className: 'rt-p3-step-val' }, max + t(' 槽', ' slots')),
                h('button', { type: 'button', className: 'rt-p3-step-btn', disabled: max >= limit, onClick: () => applySlotMax(max + 1) }, '+')),
              h('div', { className: 'rt-p3-pills' },
                presets.map((p) => h('button', {
                  key: 'slot-pill-' + p.n,
                  type: 'button',
                  className: 'rt-p3-pill' + (max === p.n ? ' on' : ''),
                  onClick: () => applySlotMax(p.n),
                }, p.label))),
              h('span', { className: 'rt-tag rt-tag-passive' }, t('深度 ', 'Depth ') + maxDepth + t(' · 思考 ', ' · Thinking ') + thinking),
              h('button', {
                type: 'button',
                className: 'rt-btn',
                onClick: () => { if (typeof props.onGo === 'function') props.onGo('settings') },
              }, t('在设置页调整全部参数 →', 'All Settings →')),
              h('span', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', marginLeft: 'auto' } },
                t('同一项目', 'Max '),
                h('b', { style: { color: 'var(--dsw-alias-label-primary)' } }, t('同时最多 ' + max + ' 个执行智能体', max + ' parallel agents per workspace')),
                t(' · 经 ', ' · verified via '),
                h('code', { className: 'rt-code-inline' }, 'lmt_agent_slot'),
                t(' 核验', ''))),
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

    function RolePromptsHubTab(props) {
      useLocale()
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
            setErr((r && r.error) || t('读取角色提示词失败', 'Failed to load role prompts'))
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
          h('span', { style: { fontWeight: 600 } }, t('角色与提示词（8 角色 gstack 编队）', 'Roles & Prompts (8-Role gstack Roster)')),
          h('span', { className: 'rt-tag rt-tag-passive' }, t('当前角色 · ', 'Active · ') + openRole + '.md'),
          h('div', { className: 'rt-spacer' }),
          h('button', {
            type: 'button',
            className: 'rt-btn',
            onClick: () => { if (typeof props.onGo === 'function') props.onGo('agents') },
          }, t('← 返回智能体与并发', '← Back to Agents & Slots')),
          h('button', {
            type: 'button',
            className: 'rt-btn',
            disabled: busy || !eng,
            onClick: load,
          }, busy ? t('读取中…', 'Loading…') : t('刷新', 'Refresh'))),
        h('div', { className: 'rt-pane' },
          err ? h('div', { className: 'rt-err' }, err) : null,
          h('div', { className: 'rt-card' },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 6 } },
              h('h4', { style: { margin: 0 } }, t('8 角色 gstack 编队', '8-Role gstack Roster')),
              h('span', { className: 'rt-wb-recurse-tag' }, t('按工作区持久化模板', 'Persisted per workspace'))),
            h('div', { className: 'rt-wb-role-grid' },
              GSTACK_ROLE_ROSTER.map((r) => {
                const isSelected = openRole === r.role
                const roleData = (roles || []).find((x) => x.role === r.role)
                return h('div', Object.assign({
                  key: 'rc-' + r.role,
                  className: 'rt-wb-role-card' + (isSelected ? ' on' : ''),
                }, clickable(() => { setOpenRole(r.role) }, {
                  label: t('选择并编辑角色 ', 'Select role ') + r.badge + t(' 提示词', ' prompt'),
                  expanded: isSelected,
                })),
                  h('div', { className: 'rt-wb-role-top' },
                    h('span', { className: 'rt-wb-role-badge' }, r.badge),
                    h('span', { className: 'rt-tag rt-tag-passive' }, t(r.wave, r.waveEn))),
                  h('div', { className: 'rt-wb-role-title' }, t(r.title, r.titleEn) + (roleData && roleData.stale ? t('（旧版可升级）', ' (legacy)') : '')),
                  h('div', { className: 'rt-wb-role-desc' }, t(r.desc, r.descEn)),
                  h('div', { className: 'rt-wb-role-tags' },
                    r.skills.map((sk) => h('span', { key: sk, className: 'rt-wb-skill-tag' }, sk))),
                  h('div', { className: 'rt-wb-role-edit' },
                    isSelected ? t('当前 · ', 'Active · ') + r.role + '.md' : t('编辑 ', 'Edit ') + r.role + '.md →'))
              }))),
          eng
            ? h('div', { className: 'rt-card' },
                h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } },
                  t('角色提示词 · ', 'Role Prompt · ') + eng + ' · ' + openRole + '.md'),
                h(PromptsTab, { engagement: eng, refreshKey: refreshKey, selectedRole: openRole }))
            : h('div', { className: 'rt-card' },
                h('h4', { style: { marginTop: 0 } }, t('当前会话尚未初始化工作区', 'No Workspace Initialized')),
                h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 10, lineHeight: 1.55 } },
                  t('初始化当前会话工作台后，可按工作区独立编辑各角色提示词。', 'Initialize a workspace for this session to edit per-workspace role prompts.')),
                h('button', {
                  type: 'button',
                  className: 'rt-btn rt-btn-primary',
                  onClick: () => { if (typeof props.onGo === 'function') props.onGo('collab') },
                }, t('前往「协同与审批」初始化 →', 'Go to Collab & Approval →')))))
    }

    function VersionBar(props) {
      useLocale()
      const [info, setInfo] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [open, setOpen] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [countdown, setCountdown] = React.useState(0)
      const countdownTimerRef = React.useRef(null)

      const notifyHostVersion = (res) => {
        if (props && typeof props.onHostVersion === 'function' && res && typeof res.hostVersion === 'string' && res.hostVersion.trim()) {
          props.onHostVersion(res.hostVersion.trim())
        }
      }

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
            api({ op: 'version' }).then((v) => {
              if (v && v.ok !== false) {
                setInfo(v)
                notifyHostVersion(v)
              }
            }, () => {})
            return
          }
          setInfo(r)
          notifyHostVersion(r)
        }, () => {
          setBusy(false)
          api({ op: 'version' }).then((v) => {
            if (v && v.ok !== false) {
              setInfo(v)
              notifyHostVersion(v)
            }
          }, () => {})
        })
      }
      React.useEffect(() => { check(true) }, [])

      const applyUpdate = () => {
        setBusy(true)
        setMsg(null)
        api({ op: 'updateApply', target: (info && info.latest) || undefined }).then((r) => {
          setBusy(false)
          if (!r || r.ok === false) { setMsg({ err: (r && r.error) || t('更新失败', 'Update failed') }); return }
          setMsg({ ok: t('已安装 ' + (r.installed || '') + '，正在重启 dsh web…', 'Installed ' + (r.installed || '') + ', restarting dsh web…') })
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
          title: (t('当前版本 ', 'Current version ') + (current || t('未知', 'unknown')) + (latest ? t('\n最新版本 ', '\nLatest ') + latest : '')
            + ((mode === 'dev' || mode === 'source') ? t('\n安装方式：本地源码（未走包管理器）', '\nInstall: local source') : mode === 'package' ? t('\n安装方式：包安装', '\nInstall: package') : '')
            + (info && info.check_error ? t('\n检查失败：', '\nCheck failed: ') + info.check_error : '')),
        }, 'v' + (current || '?')),
        hasNew
          ? h('button', {
              className: 'rt-btn rt-btn-primary', disabled: busy,
              onClick: () => { setOpen(true); setMsg(null) },
              title: t('发现新版本 ' + latest + '：点击查看并一键更新（会重启 dsh web）', 'New version ' + latest + ' available; click to update and restart dsh web'),
            }, busy ? t('检查中…', 'Checking…') : t('有新版本 v', 'Update v') + latest)
          : h('button', {
              className: 'rt-btn', disabled: busy, onClick: () => check(false),
              title: t('重新检查 npm 上的最新版本', 'Check latest version on npm'),
            }, busy ? t('检查中…', 'Checking…') : t('检查更新', 'Check Update')),
        open
          ? h('div', { className: 'rt-modal', 'aria-hidden': 'true', onClick: () => setOpen(false) },
              h('div', { className: 'rt-modal-box', onClick: (e) => e.stopPropagation() },
                h('h4', { style: { marginTop: 0 } }, t('更新 LMTAgent 研发控制台', 'Update LMTAgent Console')),
                h('div', { className: 'rt-kv' }, h('b', null, t('开源仓库', 'Repository')), h('span', { className: 'rt-mono' }, 'ECCVIK/LMTAgent')),
                h('div', { className: 'rt-kv' }, h('b', null, t('当前版本', 'Current')), h('span', null, current || t('未知', 'Unknown'))),
                h('div', { className: 'rt-kv' }, h('b', null, t('最新版本', 'Latest')), h('span', null, latest || t('未知', 'Unknown'))),
                h('div', { className: 'rt-kv' }, h('b', null, t('安装方式', 'Install Mode')),
                  h('span', null, (mode === 'dev' || mode === 'source') ? t('本地源码', 'Local source') : mode === 'package' ? t('包安装（', 'Package (') + ((info.install && info.install.packageManager) || 'npm') + ')' : t('未知', 'Unknown'))),
                info && info.install && info.install.dir
                  ? h('div', { className: 'rt-kv' }, h('b', null, t('安装位置', 'Location')), h('span', { className: 'rt-mono' }, info.install.dir))
                  : null,
                blockers.length
                  ? h('div', { className: 'rt-hint' },
                      h('div', { style: { fontWeight: 600, marginBottom: 4 } }, t('现在不能更新：', 'Update blocked:')),
                      blockers.map((b, i) => h('div', { key: 'b' + i }, '· ' + b)))
                  : null,
                notes.length
                  ? h('div', { className: 'rt-foot', style: { padding: '4px 0' } }, notes.map((n, i) => h('div', { key: 'n' + i }, n)))
                  : null,
                h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', margin: '8px 0' } },
                  t('更新过程：安装新版本 → 自动重启 dsh web（当前页面会断开，约 5–10 秒后自动刷新）。重启前会检查有没有智能体在跑，有就拦住不动。',
                    'Update installs the latest release and restarts dsh web (auto-reloads in 5-10s). Aborts safely if subagents are still running.')),
                msg ? h('div', { className: msg.err ? 'rt-err' : 'rt-foot' }, msg.err || msg.ok) : null,
                countdown > 0
                  ? h('div', { className: 'rt-foot' }, t('dsh web 正在重启，' + countdown + ' 秒后自动刷新页面…', 'Restarting dsh web, reloading in ' + countdown + 's…'))
                  : null,
                h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 } },
                  h('button', { className: 'rt-btn', onClick: () => setOpen(false) }, t('关闭', 'Close')),
                  h('button', {
                    className: 'rt-btn rt-btn-primary',
                    disabled: busy || blockers.length > 0,
                    title: (mode === 'dev' || mode === 'source') ? t('把 npm 发布版装进 profile（本地源码改动不再生效）', 'Install published npm package into profile') : blockers.length ? t('先解决上面的阻塞项', 'Resolve blockers first') : t('安装并重启', 'Install and restart'),
                    onClick: applyUpdate,
                  }, busy ? t('更新中…', 'Updating…') : t('一键更新并重启', 'Update & Restart')))))
          : null)
    }

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
      useLocale()
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
      const [hostVersionMismatch, setHostVersionMismatch] = React.useState(null)
      const checkHostVersion = React.useCallback((hostVer) => {
        const hv = typeof hostVer === 'string' ? hostVer.trim() : ''
        if (!hv) return
        if (typeof CLIENT_PLUGIN_VERSION === 'string' && hv !== CLIENT_PLUGIN_VERSION) {
          setHostVersionMismatch(hv)
        } else {
          setHostVersionMismatch(null)
        }
      }, [])
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

      React.useEffect(() => {
        if (!isFullWindow()) return
        const params = readStandaloneUrlParams()
        if (params.session && !scopedSession.authoritative) {
          setSessionId(params.session, null)
        }
        if (params.engagement) {
          manualPickRef.current = params.session || sid || ''
          setEng(params.engagement)
        }
        if (params.tab) {
          setUI({ tab: params.tab })
        }
      }, [])

      const exitFull = React.useCallback(() => {
        setFull(false)
        try {
          if (window.opener && !window.opener.closed) { window.close(); return }
        } catch (e) { /* ignore */ }
        try { window.history.replaceState(null, '', window.location.pathname + window.location.search) } catch (e) { /* ignore */ }
      }, [])

      React.useEffect(() => {
        const onOpen = () => {
          setFull(true)
          try { window.history.replaceState(null, '', window.location.pathname + window.location.search + '#lmtagent-full') } catch { /* ignore */ }
        }
        const onExit = () => { exitFull() }
        window.addEventListener(FULL_REQUEST_EVENT, onOpen)
        window.addEventListener(EXIT_FULL_EVENT, onExit)
        return () => {
          window.removeEventListener(FULL_REQUEST_EVENT, onOpen)
          window.removeEventListener(EXIT_FULL_EVENT, onExit)
        }
      }, [exitFull])

      React.useEffect(() => {
        if (scopedSession.authoritative) return undefined
        return acquireSessionSyncTicker()
      }, [scopedSession.authoritative])

      React.useEffect(() => {
        if (eng) clearShotCache(eng)
      }, [eng])

      React.useEffect(() => () => {
        if (resizeCleanupRef.current) {
          resizeCleanupRef.current()
          resizeCleanupRef.current = null
        }
      }, [])

      React.useEffect(() => {
        setDockWidth(width)
        try { window.localStorage.setItem('rt-dock-width', String(width)) } catch (e) { /* 隐私模式 */ }
      }, [width])

      const loadSnapshot = (id) => {
        if (!id) { setSnapshot(null); return }
        api({ op: 'snapshot', engagement: id }).then((r) => {
          if (!r || r.ok === false) { setErr((r && r.error) || t('加载失败', 'Load failed')); return }
          setErr(null)
          setSnapshot(r)
        }, (e) => setErr(String((e && e.message) || e)))
      }

      const refreshList = (selectId) => {
        api({ op: 'bootstrap', session: sidRef.current || undefined }).then((b) => {
          if (b && b.hostVersion) checkHostVersion(b.hostVersion)
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
            setErr((r && r.error) || t('无法连接工作区存储', 'Failed to connect workspace storage'))
            return
          }
          setErr(null)
          if (r.hostVersion) checkHostVersion(r.hostVersion)
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
          if (!r || r.ok === false) { setErr((r && r.error) || t('创建失败', 'Create failed')); return null }
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
          if (b && b.hostVersion) checkHostVersion(b.hostVersion)
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
        : (sid ? formatShortSessionId(sid) : t('当前会话', 'Session'))

      const selectorOptions = []
      if (sid && !eng) {
        selectorOptions.push({
          value: '__session_unbound__',
          label: t('当前会话 · ', 'Session · ') + sessionDisplayLabel + (sessionState && sessionState.onboarding_dismissed ? t('（未绑定）', ' (Unbound)') : t('（待初始化）', ' (Setup Pending)')),
        })
        for (const x of visibleEngagements) {
          selectorOptions.push({
            value: x.id,
            label: t('关联已有 · ', 'Bind Existing · ') + (x.name || x.id),
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
        : ((!isRawUuidName(sesTitle) && sesTitle) || t('未绑定工作区', 'Unbound Workspace'))

      const tabs = [
        ['assets', t('模块与服务', 'Modules & Services')],
        ['agents', t('智能体与并发', 'Agents & Slots')],
        ['prompts', t('角色与提示词', 'Roles & Prompts')],
        ['sessions', t('运行环境', 'Runtime')],
        ['artifacts', t('构建产物', 'Artifacts')],
        ['findings', t('代码审查与缺陷', 'Review & Findings')],
        ['scores', t('交付里程碑', 'Milestones')],
        ['report', t('研发交付报告', 'Delivery Report')],
        ['knowledge', t('工程模式库', 'Pattern KB')],
        ['skills', t('研发技能库', 'Skill Library')],
        ['settings', t('设置', 'Settings')],
      ]
      const TAB_GROUPS = [
        { key: 'collab', label: t('协同与审批', 'Collab & Approval'), tabs: ['collab'] },
        { key: 'overview', label: t('总览', 'Overview'), tabs: ['overview'] },
        { key: 'assets', label: t('架构', 'Architecture'), tabs: ['assets'] },
        { key: 'results', label: t('质量', 'Quality'), tabs: ['findings', 'scores'] },
        { key: 'report', label: t('报告', 'Report'), tabs: ['report'] },
        { key: 'resources', label: t('集群', 'Cluster'), tabs: ['agents', 'prompts', 'sessions', 'artifacts', 'knowledge', 'skills'] },
        { key: 'settings', label: t('设置', 'Settings'), tabs: ['settings'] },
      ]
      const groupOf = (tab) => TAB_GROUPS.find((g) => g.tabs.indexOf(tab) !== -1) || TAB_GROUPS[1]
      const activeGroup = groupOf(st.tab)
      const openFull = () => {
        openStandaloneWindow({ session: sid || undefined, engagement: eng || undefined, tab: st.tab || undefined })
      }

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
          : h('div', { className: 'rt-pane' }, h('div', { className: 'rt-empty' }, t('设置中心尚未加载', 'Settings center not loaded')))
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
                h('h4', { style: { marginTop: 0 } }, t('协同与审批工作台', 'Collaboration & Approval')),
                h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 10 } },
                  eng ? t('当前已绑定工作区「' + currentEngName + '」。', 'Bound workspace "' + currentEngName + '".') : t('当前会话尚未绑定工作区，可立即初始化或跳过指引保持空白会话。', 'No workspace bound yet; initialize now or skip onboarding.')),
                !eng
                  ? h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                      h('button', { type: 'button', className: 'rt-btn rt-btn-primary', onClick: () => openEngagement(sessionDisplayLabel) }, t('为当前会话创建工作区', 'Create Workspace')),
                      h('button', { type: 'button', className: 'rt-btn', onClick: handleSkipOnboarding }, t('跳过指引', 'Skip Setup')))
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
            h('h4', { style: { marginTop: 0 } }, t('当前会话尚未初始化工作区', 'Workspace Not Initialized')),
            h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', marginBottom: 12, lineHeight: 1.55 } },
              t('按会话 1:1 隔离工作区；请前往「协同与审批」初始化或关联已有项目。', '1:1 session isolation enabled; open Collab & Approval to initialize or bind a workspace.')),
            h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
              h('button', {
                type: 'button',
                className: 'rt-btn rt-btn-primary',
                onClick: () => goTab('collab'),
              }, t('前往「协同与审批」初始化 →', 'Go to Collab & Approval →')),
              canReopenOnboarding
                ? h('button', {
                    type: 'button',
                    className: 'rt-btn',
                    onClick: handleReopenOnboarding,
                  }, t('重新获取初始化指引', 'Reopen Setup Guide'))
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
            full ? t('LMTAgent 独立工作台', 'LMTAgent Standalone Workbench') : t('LMTAgent 研发控制台', 'LMTAgent Console'),
            full ? h('span', { className: 'rt-tag', style: { marginLeft: 6 } }, t('独立窗口', 'Standalone')) : null),
          sid === null
            ? null
            : (!eng
                ? (isSessionDismissed
                    ? h('span', {
                        className: 'rt-tag rt-tag-passive',
                        title: t('当前会话已跳过初始化指引，保持干净独立态', 'Onboarding skipped; session remains clean and unbound'),
                      }, t('已跳过指引', 'Skipped'))
                    : h('span', {
                        className: 'rt-tag rt-tag-warn',
                        title: t('当前会话尚未绑定研发工作区，可在「协同与审批」初始化或跳过指引', 'Session not bound to a workspace; initialize or skip in Collab & Approval'),
                      }, t('待初始化', 'Setup Pending')))
                : (hasCleanBoundDiff
                    ? h('span', Object.assign({
                        className: 'rt-tag rt-tag-warn',
                        style: { cursor: 'pointer' },
                        title: t('当前已手动切换工作区；点击切回当前会话绑定的「' + boundEng + '」', 'Viewing manually selected workspace; click to return to "' + boundEng + '"'),
                      }, clickable(() => {
                        manualPickRef.current = null
                        setFollowSource('bound')
                        setEng(boundEng)
                        loadSnapshot(boundEng)
                      }, { label: t('切回当前会话绑定工作区：', 'Return to bound workspace: ') + boundEng })), t('手动选择：', 'Selected: ') + boundEng)
                    : h('span', {
                        className: 'rt-tag rt-tag-live',
                        title: t('控制台正 1:1 跟随当前会话绑定的研发工作区', 'Following active session workspace 1:1'),
                      }, t('跟随会话', 'Synced')))),
          canReopenOnboarding
            ? h('button', {
                type: 'button',
                className: 'rt-btn rt-btn-primary',
                style: { padding: '2px 8px', fontSize: 11.5 },
                title: t('重新打开工作台初始化指引', 'Reopen onboarding guide'),
                onClick: handleReopenOnboarding,
              }, t('重新指引', 'Reopen Setup'))
            : null,
          h('select', {
            className: 'rt-input',
            style: { maxWidth: '185px' },
            value: eng || (sid ? '__session_unbound__' : ((selectorOptions[0] && selectorOptions[0].value) || '')),
            'aria-label': t('切换研发工作区或关联已有项目', 'Switch or bind workspace'),
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
          h(LocaleSwitcher, null),
          h(VersionBar, { onHostVersion: checkHostVersion }),
          full
            ? h('button', { className: 'rt-btn', title: t('退出全屏（Esc）', 'Exit fullscreen (Esc)'), onClick: exitFull }, t('退出全屏', 'Exit Full'))
            : null,
          h('button', { className: 'rt-btn', title: t('刷新当前数据', 'Refresh'), onClick: refreshAll }, t('刷新', 'Refresh')),
          h('button', {
            type: 'button',
            className: 'rt-btn' + (st.tab === 'settings' ? ' rt-btn-primary' : ''),
            title: t('打开统一设置中心', 'Open unified settings'),
            onClick: () => goTab('settings'),
          }, t('设置', 'Settings')),
          full ? null : h('button', {
            className: 'rt-btn rt-btn-primary',
            title: t('在脱离 DSH 的独立应用窗口中打开（支持拖到双屏）', 'Open in a detached standalone OS window (multi-monitor ready)'),
            onClick: openFull,
          }, t('弹出独立窗口 ↗', 'Pop Out ↗')),
          (full || embedMode) ? null : h('button', { className: 'rt-btn', title: t('收起面板', 'Collapse panel'), onClick: () => setUI({ open: false }) }, t('收起', 'Close'))),
        hostVersionMismatch
          ? h('div', {
              className: 'rt-err rt-host-version-mismatch',
              role: 'alert',
              style: { margin: '6px 10px 0', fontSize: 12, fontWeight: 600 },
            }, t('检测到后端 Host 版本 (' + hostVersionMismatch + ') 与前端 (' + CLIENT_PLUGIN_VERSION + ') 不一致，请彻底退出并重启 DSH NEXT',
                'Host version (' + hostVersionMismatch + ') differs from client (' + CLIENT_PLUGIN_VERSION + '). Please quit and restart DSH NEXT.'))
          : null,
        h('div', { className: 'rt-tabs rt-tabs-groups', role: 'navigation', 'aria-label': t('控制台分区', 'Console Navigation') },
          TAB_GROUPS.map((g) => {
            const on = activeGroup.key === g.key
            const showCollabInitBadge = g.key === 'collab' && needsSessionInit
            const showCollabApprovalBadge = g.key === 'collab' && !showCollabInitBadge && pendingApprovalsCount > 0
            return h('div', Object.assign({}, clickable(() => goTab(g.tabs[0]), { label: g.label }), {
              key: g.key, className: 'rt-tab rt-tab-group' + (on ? ' on' : ''),
              title: t('切换到「', 'Switch to ') + g.label + t('」分区', ''),
            }),
              g.label,
              showCollabInitBadge
                ? h('span', {
                    className: 'rt-tag rt-tag-warn',
                    style: { marginLeft: 5, padding: '0 5px', fontSize: 10, lineHeight: '15px' },
                  }, t('待初始化', 'Setup'))
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
        }, tabs.map((tabItem) => {
          const visible = activeGroup.tabs.indexOf(tabItem[0]) !== -1
          return h('div', Object.assign({}, clickable(() => goTab(tabItem[0]), { label: tabItem[1] }), {
            key: tabItem[0], className: 'rt-tab' + (st.tab === tabItem[0] ? ' on' : ''),
            role: 'tab',
            'aria-selected': st.tab === tabItem[0] ? 'true' : 'false',
            style: visible ? undefined : { display: 'none' },
            title: unreadOf(tabItem[0]) ? tabItem[1] + t('：有新内容，点开看过红点就会消失', ': unread updates available') : tabItem[1],
          }), tabItem[1], unreadOf(tabItem[0])
            ? h('span', { className: 'rt-tab-dot', 'aria-label': t('有新内容', 'Unread updates') })
            : null)
        })),
        h('div', { className: 'rt-body' }, h(RtBoundary, { key: st.tab }, body)),
        h('div', { className: 'rt-foot' },
          h('span', { className: 'rt-wb-badge' },
            st.uiMode === 'novice' ? t('LMTAgent · 协同工作台', 'LMTAgent · Collab Workbench') : 'LMTAgent · 4-Wave DAG'),
          h('div', { className: 'rt-spacer' }),
          full ? h('span', null, t('Esc 退出全屏', 'Esc to exit fullscreen')) : null,
          eng
            ? h('span', null, (st.uiMode === 'novice' ? t('工作区 · ', 'Workspace · ') : 'PG/WAL · ') + currentEngName)
            : h('span', null, isSessionDismissed ? t('当前会话 · 独立空白态（未绑定工作区）', 'Session · Clean Unbound State') : t('当前会话 · 待初始化工作区', 'Session · Workspace Setup Pending')),
          sid === null
            ? null
            : h('span', {
                title: t('当前会话 ', 'Session ') + sid + (sesTitle ? ' (' + sesTitle + ')' : ''),
              }, t('会话 ', 'Session ') + formatShortSessionId(sid) + (followSource ? ' · ' + followSourceLabel(followSource) : ''))))
    }

    function LocaleSwitcher() {
      const loc = useLocale()
      return h('div', {
        className: 'rt-mode-switch rt-locale-switch',
        role: 'group',
        'aria-label': t('界面语言切换', 'UI Language Switcher'),
      },
        h('button', {
          type: 'button',
          className: 'rt-mode-btn' + (loc !== 'en-US' ? ' on' : ''),
          title: '切换为简体中文',
          onClick: () => setLocale('zh-CN'),
        }, '中文'),
        h('button', {
          type: 'button',
          className: 'rt-mode-btn' + (loc === 'en-US' ? ' on' : ''),
          title: 'Switch to English',
          onClick: () => setLocale('en-US'),
        }, 'EN'))
    }

    function SidebarButton() {
      useLocale()
      const st = useUI()
      const sess = useSession()
      return h('button', {
        className: 'rt-icon-btn' + (st.open ? ' on' : ''),
        title: t('弹出 LMTAgent 独立研发控制台窗口', 'Pop out LMTAgent Console in a standalone window'),
        onClick: () => openStandaloneWindow({ session: sess.id || undefined, tab: st.tab || undefined }),
      }, h('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': 'true',
      },
        h('rect', { x: 2, y: 2, width: 5, height: 5, rx: 1 }),
        h('rect', { x: 9, y: 2, width: 5, height: 5, rx: 1 }),
        h('rect', { x: 2, y: 9, width: 5, height: 5, rx: 1 }),
        h('rect', { x: 9, y: 9, width: 5, height: 5, rx: 1 })))
    }

    function HeaderButton(props) {
      useLocale()
      const st = useUI()
      const sid = sessionIdOf(props)
      const title = sessionTitleOf(props)
      React.useEffect(() => { if (sid || title) setSessionId(sid, title) }, [sid, title])
      return h('button', {
        className: 'rt-hbtn' + (st.open ? ' on' : ''),
        title: t('在脱离 DSH 的独立窗口中打开 LMTAgent 控制台', 'Pop out LMTAgent Console in an independent window'),
        onClick: () => openStandaloneWindow({ session: sid || undefined, tab: st.tab || undefined }),
      }, t('LMTAgent 独立窗口 ↗', 'LMTAgent Window ↗'))
    }

    function SettingsSlotSection() {
      useLocale()
      const sess = useSession()
      return h('div', { style: { margin: 12, display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
          h('div', null,
            h('div', { style: { fontWeight: 700, fontSize: 13 } }, t('LMTAgent 统一设置中心', 'LMTAgent Unified Settings')),
            h('div', { style: { fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)' } },
              t('AI 规划、并发派发、存储、飞书与界面偏好', 'AI Planning, Concurrency, Storage, Feishu & UI Preferences'))),
          h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            h('button', {
              type: 'button',
              className: 'rt-btn rt-btn-primary',
              onClick: () => openStandaloneWindow({ session: sess.id || undefined, tab: 'settings' }),
            }, t('弹出独立窗口 ↗', 'Pop Out Window ↗')),
            h('button', {
              type: 'button',
              className: 'rt-btn',
              onClick: () => setUI({ open: true, tab: 'settings' }),
            }, t('停靠右侧栏', 'Dock to Sidebar')))),
        typeof SettingsHubTab === 'function'
          ? h(SettingsHubTab, {
              compact: true,
              onGo: (tab) => openStandaloneWindow({ session: sess.id || undefined, tab: tab || 'settings' }),
            })
          : null)
    }

    const inject = ['slots']

    function apply(ctx) {
      const styleTag = document.createElement('style')
      styleTag.setAttribute('data-lmtagent-ui', '1')
      styleTag.textContent = CSS
      document.head.append(styleTag)

      const widthTag = document.createElement('style')
      widthTag.setAttribute('data-lmtagent-ui-width', '1')
      widthTag.textContent = ':root{--rt-dock-w:540px}'
      document.head.append(widthTag)
      dockWidthTag = widthTag

      ctx.effect(() => () => {
        styleTag.remove()
        widthTag.remove()
        dockWidthTag = null
      })

      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'lmtagent-console', order: 50 },
        () => h(Panel),
      ))

      ctx.slots.inject('main', () => ctx.slots.register(
        { name: 'main', id: 'lmtagent-workbench', key: 'lmtagent-workbench', order: 35 },
        (props) => h(Panel, Object.assign({ embedMode: 'main' }, props)),
      ))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
        { name: 'sidebar.panellist', id: 'lmtagent-panellist', key: 'lmtagent-workbench', label: t('LMTAgent 控制台', 'LMTAgent Console'), order: 35 },
        (props) => h(SidebarButton, props),
      ))

      ctx.slots.inject('conversation.view', () => ctx.slots.register(
        { name: 'conversation.view', id: 'lmtagent-view', key: 'lmtagent-view', label: 'LMTAgent Workbench', order: 45 },
        (props) => h(Panel, Object.assign({ embedMode: 'session' }, props)),
      ))

      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
        { name: 'conversation.session.header.utilities', id: 'lmtagent-header-toggle', order: 50, label: 'LMTAgent' },
        (props) => h(HeaderButton, props),
      ))

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'lmtagent-settings', order: 50, label: t('LMTAgent 研发集群', 'LMTAgent Cluster') },
        () => h(SettingsSlotSection),
      ))

      try {
        if (ctx.betterSidebar && typeof ctx.betterSidebar.registerItem === 'function') {
          ctx.betterSidebar.registerItem({
            id: 'lmtagent-workbench',
            label: t('LMTAgent 控制台', 'LMTAgent Console'),
            order: 35,
            onClick: () => openStandaloneWindow({ session: sessionId || undefined, tab: ui.tab || undefined }),
          })
        }
      } catch (e) { /* optional service */ }
    }

    exports.apply = apply
    exports.inject = inject

    exports.squashName = squashName
    exports.engagementByTitle = engagementByTitle
    exports.renderInline = renderInline
    exports.Markdown = Markdown
    exports.getLocale = getLocale
    exports.setLocale = setLocale
    exports.syncLocaleFromSettings = syncLocaleFromSettings
    exports.t = t
    exports.formatShortSessionId = formatShortSessionId
    exports.openStandaloneWindow = openStandaloneWindow
    return module.exports
  },
})
