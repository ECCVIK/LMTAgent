/**
 * 工程技能与开发工具链修复文案（零依赖，纯 ESM）
 *
 * 用途：给控制台「技能库」页签与 `redteam_preflight` 环境预检使用 —— 每个**不可用**的技能或工具
 * 都要能直接告诉开发者"怎么补齐配置"，而不是只报"缺什么"。
 * `skill-availability.js` 负责判定（缺环境变量 / 缺本地工具 / 占位符未配置 / 被同名技能覆盖），
 * 这里负责把每一类判定翻译成可执行的中文步骤：
 *   · `TOOL_FIXES`   —— 常用开发、测试与数据库工具链的安装与配置指引
 *   · `SKILL_FIXES`  —— 各工程技能的环境变量与依赖修复步骤
 *   · `toolNameOfPath` / `fixesForIssue` —— 把路径或环境缺失判定转为具体修复建议
 */

/** 仓库自带的一键环境初始化脚本入口。 */
const SETUP = 'node packages/redteam-bundle/tools/build.mjs --check'

/** 通用兜底修复建议。 */
const GENERIC_FIX = '请检查本地 Node.js、Git、PostgreSQL 16+ / PGlite 及项目依赖是否完整，执行 `' + SETUP + '` 校验构建产物；'
  + '修改 `$DSH_HOME/.env` 环境变量后请重启 `dsh web` 使配置生效。'

/* ── 开发与测试工具链修法 ───────────────────────────────────────────────────── */

export const TOOL_FIXES = {
  node: {
    what: 'Node.js 运行时（LMTAgent 构建、打包与单元测试核心运行环境，推荐 Node.js 20+ LTS）',
    install: '通过 `nvm install --lts` 或系统包管理器安装 Node.js 20+，执行 `node -v` 确认版本可用',
  },
  npm: {
    what: 'npm 包管理器（用于管理工作区依赖与运行脚本）',
    install: '随 Node.js 自动安装，执行 `npm -v` 校验；项目根目录下可执行 `npm install` 补齐依赖',
  },
  pnpm: {
    what: 'pnpm 高效包管理器（支持 Monorepo 多包工作区依赖管理）',
    install: '执行 `corepack enable && corepack prepare pnpm@latest --activate` 或 `npm i -g pnpm` 安装',
  },
  git: {
    what: 'Git 版本控制工具（代码分片合入、变更对比与版本标签管理）',
    install: '通过系统包管理器安装 `git`，并配置 `git config --global user.name` 与 `user.email`',
  },
  psql: {
    what: 'PostgreSQL 客户端 CLI（连接 PostgreSQL 16+ 事实库、检查 Schema 与执行 SQL 诊断）',
    install: '安装 `postgresql-client`（或使用内置零配置 PGlite 引擎），通过 `psql --version` 验证',
  },
  postgres: {
    what: 'PostgreSQL 16+ 关系型数据库服务端（支持高并发连接池、JSONB 与 GIN tsvector 全文检索）',
    install: '配置环境变量 `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE`，或自动回退至内置 PGlite 引擎',
  },
  chromium: {
    what: 'Chromium 无头浏览器（用于 WebUI 端到端回归测试、DOM 快照检查与界面截图归档，`/usr/bin/chromium`）',
    install: '安装 `chromium` 或 `google-chrome-stable`；无头截图命令：`/usr/bin/chromium --headless=new --no-sandbox --screenshot=runs/shot.png <url>`',
  },
  'playwright-cli': {
    what: 'Playwright 自动化测试 CLI（用于多状态交互测试、组件渲染验证与端到端回归，`npx --yes @playwright/cli@latest`）',
    install: '执行 `npx playwright install chromium` 安装浏览器内核；调用时建议指定 `--browser chromium`',
  },
  'kimi-chrome': {
    what: '支持 WebBridge 调试扩展的浏览器启动脚本（`~/.local/bin/kimi-chrome`）',
    install: '安装 Chrome 或 Chromium 后创建启动脚本 `~/.local/bin/kimi-chrome` 并执行 `chmod +x ~/.local/bin/kimi-chrome`',
  },
  'kimi-webbridge': {
    what: 'Kimi WebBridge 本地浏览器桥接服务（监听 `127.0.0.1:10086`，供 UI 与端到端验证技能驱动浏览器）',
    install: '确认 `~/.kimi-webbridge/bin/kimi-webbridge status` 运行正常，或改用内置 `playwright-cli` / 无头 Chromium 方案',
  },
  curl: {
    what: 'HTTP 命令行客户端（用于本地服务健康检查与 REST/RPC 接口契约验证）',
    install: '通过系统包管理器安装 `curl`，使用 `curl -i -s <url>` 验证接口响应',
  },
  jq: {
    what: 'JSON 命令行处理器（用于解析构建清单、测试报告与接口返回结构）',
    install: '通过系统包管理器安装 `jq`',
  },
  rg: {
    what: 'ripgrep 高速代码检索工具（用于大型代码仓符号查找与依赖梳理）',
    install: '通过系统包管理器安装 `ripgrep`（提供 `rg` 命令）',
  },
  tmux: {
    what: '终端多路复用器（用于保持本地开发服务器、后台构建与数据库守护进程常驻）',
    install: '通过系统包管理器安装 `tmux`；常用命令：`tmux new -s dev`、`tmux a -t dev`',
  },
  python3: {
    what: 'Python 3 运行时（用于执行辅助数据处理与验证脚本）',
    install: '安装 `python3` 与 `python3-venv`，使用虚拟环境隔离运行辅助脚本',
  },
}

/* ── 逐工程技能修法 ─────────────────────────────────────────────────────────── */

export const SKILL_FIXES = {
  'campaign-planning': '纯工程规划与 4-Wave DAG 拆解技能，无外部二进制依赖；若显示不可用请检查技能文件是否存在并重启 `dsh web`。',

  'specialist-paths': '子系统架构分型与专项研发路径技能，无外部依赖；不可用时请确认技能目录挂载正常并重启 `dsh web`。',

  'score-coverage': '软件工程交付里程碑与质量门禁规则技能，无外部依赖；请确认 `redteam_score_list` 工具正常可用。',

  'asset-correlation': '代码仓模块关联与跨包依赖拓扑分析技能，不依赖外部二进制；确认插件已最新构建并重启 `dsh web`。',

  'browser-automation': '安装 Chromium 或 Playwright：`npx playwright install chromium`；执行端到端 UI 验证时指定 `--browser chromium`。',

  'kimi-webbridge': '确保 Chrome/Chromium 已安装且本地 WebBridge 服务（`127.0.0.1:10086`）已启动；若未安装扩展，可无缝切换至 `browser-automation`（Playwright / Headless Chromium）完成 UI 验证。',

  'deepseek-web-intel': '需配置 `DEEPSEEK_API_KEY` 环境变量：在 `$DSH_HOME/.env` 中写入 `DEEPSEEK_API_KEY=<你的密钥>`（建议 `chmod 600`），重启 `dsh web` 后生效。',

  'supply-chain': '用于审查 `package.json` 依赖树、锁文件一致性与构建脚本安全性，仅需本地 Node.js 与文件检索工具。',

  'api-data-exfil': '用于验证核心 API 分页契约与 ≥1 万条规模数据集的吞吐性能，依赖本地 `curl` / `node` 与 PostgreSQL 事实库连接。',

  'oob-verify': '用于异步回调、Webhook 与跨进程事件通知验证，确认本地调试端口或回调服务可达即可。',

  'redteam-setup': '用于开发环境与工具链自检：确认 Node.js、Git、PostgreSQL 16+ / PGlite 及构建脚本完备，设置环境变量后重启 `dsh web` 并运行 `redteam_preflight` 复核。',

  'opsec-hygiene': '用于研发工作区清理、临时测试数据回滚与敏感配置脱敏检查，不依赖额外外部工具。',
}

/* ── 内部解析工具 ───────────────────────────────────────────────────────────── */

const EXT_RE = /\.(exe|zip|tar\.gz|tgz|gz|bz2|xz|jar|sh|py|bin|txt|md|json)$/i
const PLATFORM_RE = /[-_](windows|win32|win64|win|linux|darwin|macos|osx|freebsd)[-_][a-z0-9_.]+$/
const ARCH_RE = /[-_](amd64|x86_64|x64|arm64|aarch64|arm|386|i386|i686|mips[a-z0-9]*)$/

/**
 * 把二进制/目录名规范化为工具名：剥除扩展名、平台与架构后缀并转小写。
 */
function cleanToolName(raw) {
  let out = String(raw == null ? '' : raw).trim()
  if (out === '') return null
  out = out.replace(EXT_RE, '')
  let prev = ''
  while (out !== '' && out !== prev) {
    prev = out
    out = out.replace(PLATFORM_RE, '').replace(ARCH_RE, '')
  }
  out = out.toLowerCase()
  return /[a-z]/.test(out) ? out : null
}

/**
 * 从路径里提取工具名（无法提取时返回 `null`）。
 */
export function toolNameOfPath(p) {
  if (typeof p !== 'string') return null
  const s = p.trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[，。；、：,;:)\]}>）】]+$/, '')
    .replace(/\\/g, '/')
  if (s === '') return null
  let candidate = null
  const at = s.lastIndexOf('toolkit/')
  if (at !== -1) {
    candidate = s.slice(at + 'toolkit/'.length).split('/').filter((seg) => seg !== '')[0] || null
  } else if (/\/bin\//.test(s) || /(^|\/)\.local\//.test(s)) {
    const segs = s.split('/').filter((seg) => seg !== '')
    candidate = segs.length > 0 ? segs[segs.length - 1] : null
  } else if (!s.includes('/')) {
    candidate = s
  }
  return candidate === null ? null : cleanToolName(candidate)
}

function canonicalTool(name) {
  return String(name || '')
}

/** 常用环境变量配置说明。 */
const ENV_HINTS = {
  DEEPSEEK_API_KEY: '配置 DeepSeek API 密钥（写入 `$DSH_HOME/.env` 的 `DEEPSEEK_API_KEY=<密钥>` 并重启 `dsh web`）',
  PGHOST: '填写 PostgreSQL 16+ 主机地址（如 `127.0.0.1`）',
  PGPORT: '填写 PostgreSQL 端口（默认 `5432`）',
  PGUSER: '填写 PostgreSQL 用户名（如 `postgres`）',
  PGPASSWORD: '填写 PostgreSQL 密码（写入 `$DSH_HOME/.env`，禁止硬编码进源码）',
  PGDATABASE: '填写 PostgreSQL 数据库名（如 `lmtagent`）',
  LMT_REMOTE_HOST: '填写远程构建/测试节点地址 `user@host`',
}

function asArray(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.trim() !== '')
  if (typeof v === 'string' && v.trim() !== '') return [v]
  return []
}

/**
 * 由 `skill-availability.js` 的判定生成一条单行中文修复建议。
 */
export function fixesForIssue(issue) {
  const it = issue && typeof issue === 'object' ? issue : {}
  const kind = typeof it.kind === 'string' ? it.kind : ''
  const skill = typeof it.skill === 'string' ? it.skill : ''
  const skillName = skill === '' ? '<技能名>' : skill
  const skillHint = skill !== '' && Object.prototype.hasOwnProperty.call(SKILL_FIXES, skill) ? SKILL_FIXES[skill] : ''
  const parts = []

  if (kind === 'path-missing') {
    const tools = []
    const seen = new Set()
    for (const p of asArray(it.paths)) {
      const name = toolNameOfPath(p)
      if (name === null) continue
      const canon = canonicalTool(name)
      if (seen.has(canon)) continue
      seen.add(canon)
      tools.push({ name, canon, path: p })
    }
    if (tools.length > 0) {
      const items = tools.map(({ name, canon, path }) => {
        const fix = Object.prototype.hasOwnProperty.call(TOOL_FIXES, canon) ? TOOL_FIXES[canon] : null
        if (fix === null) {
          return '`' + name + '`（' + path + '）：本机未检测到该工具，请通过包管理器安装或将其放置到对应路径并赋予可执行权限（`chmod +x`）'
        }
        return '`' + name + '`（' + path + '）：' + fix.what + '。配置方法：' + fix.install
      })
      parts.push('缺少 ' + tools.length + ' 个本地工具：' + items.join('；'))
      parts.push('安装完成后可重新运行 `redteam_preflight` 复核环境状态。')
    }
  } else if (kind === 'env-missing') {
    const names = asArray(it.env)
    if (names.length > 0) {
      const items = names.map((n) => {
        const hint = Object.prototype.hasOwnProperty.call(ENV_HINTS, n) ? ENV_HINTS[n] : '请根据项目配置填入对应值'
        return '`' + n + '`：`export ' + n + '=<值>`（' + hint + '）'
      })
      parts.push('缺环境变量：' + items.join('；') + '。')
      parts.push('持久化方法：写入 `$DSH_HOME/.env`（每行一个 `NAME=值`，建议 `chmod 600`），修改后重启 `dsh web` 使当前进程读取最新配置。')
    }
  } else if (kind === 'placeholder') {
    const ph = typeof it.placeholder === 'string' && it.placeholder.trim() !== '' ? it.placeholder.trim() : '远程节点地址'
    parts.push('技能配置中 `' + ph + '` 仍为模板占位符（当前环境尚未配置对应主机参数）。')
    parts.push('配置方法：在 `$DSH_HOME/.env` 中写入对应主机地址配置后重启 `dsh web`，或直接编辑 `$DSH_HOME/skills/' + skillName + '.md` 将占位符替换为实际地址。')
  } else if (kind === 'shadowed') {
    parts.push('技能被同名版本覆盖：`' + skillName + '` 在其他技能根目录下存在一份配置更完整的同名技能，'
      + '但按当前技能根加载顺序优先命中了排在前面的未配置版本。')
    parts.push('修复方法：将已配置的技能根目录调整到技能根顺序最前面（如 `$DSH_HOME/skills`），重启 `dsh web` 后重新预检。')
  } else if (kind === 'file-missing') {
    parts.push('技能文件不存在：请重新构建或安装插件以同步技能目录，然后重启 `dsh web` 再执行环境预检。')
    parts.push('若是自定义工程技能，请确认文件位于技能根目录下且文件名与技能名一致（`<技能名>.md`）。')
  } else if (kind === 'content-missing') {
    parts.push('技能正文不可读（仅存在元数据，无法自动判定可用性）：请重新同步插件技能文件并重启 `dsh web`。')
    parts.push('如需立即验证，可让智能体调用 `skill` 工具实际加载一次 `' + skillName + '`。')
  }

  if (parts.length === 0) parts.push(skillHint !== '' ? skillHint : GENERIC_FIX)
  return parts.join(' ')
}
