/**
 * 把三个包「生」成单包插件 `dsh-redteam-mode` 的 lib/。
 *
 * 为什么要生成而不是直接依赖：
 *   pnpm 默认是隔离布局——`dsh-redteam-store` 这类**传递依赖**不会被链到
 *   `<profile>/node_modules/` 下。而 agent preset 里的行是按**宿主 base**解析裸包名的
 *   （`loader.internal.import(name, profileDir)`），所以预设行一旦引用传递依赖就直接
 *   解析失败。让市场用户只装一个包、包内自带全部实现，是唯一稳的做法。
 *
 * 于是：`packages/redteam-{store,ui,tools}` 仍是**唯一源码**，本脚本把它们拷成
 * 自包含的 lib/（改写包内相对 import），生成物随包提交。改完源码跑：
 *
 *   node packages/redteam-bundle/tools/build.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
/* 发行组成契约（哪些技能/脚本进 npm 包）—— 见该文件的说明 */
const { isSkillShipped, isScriptShipped } = await import('./distribution.mjs')
const pkgRoot = join(here, '..')
const packagesDir = join(pkgRoot, '..')
const repoRoot = join(packagesDir, '..')
const libDir = join(pkgRoot, 'lib')

const read = (rel) => readFileSync(join(packagesDir, rel), 'utf8').replace(/\r\n/g, '\n')
/** `--check`：只比对生成结果与仓库现状，不写盘（CI / 回归测试用）。 */
const CHECK = process.argv.includes('--check')
const drift = []

/* 0) 先运行 UI 模块化组装器（src/styles/*.css → styles.js；src/client/* → client.js）。 */
for (const relAssembler of ['redteam-ui/tools/assemble-styles.mjs', 'redteam-ui/tools/assemble-client.mjs']) {
  const assemblerPath = join(packagesDir, relAssembler)
  if (existsSync(assemblerPath)) {
    try {
      execFileSync(process.execPath, [assemblerPath, ...(CHECK ? ['--check'] : [])], { stdio: 'inherit' })
    } catch (error) {
      if (!CHECK) throw error
      drift.push(`packages/${relAssembler} --check 未通过`)
    }
  }
}
const write = (rel, text) => {
  const target = join(pkgRoot, rel)
  const normalized = text.replace(/\r\n/g, '\n')
  if (CHECK) {
    let current
    try { current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n') } catch { current = undefined }
    if (current !== normalized) drift.push(rel)
    return rel
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, normalized, 'utf8')
  return rel
}

/* 1) 资产库核心：零依赖，原样拷过来；插件壳里的 './core.js' 改成 './store-core.js'。
   core.js 拆分成了 4 个模块（ip-utils / schema / validate / score-rules），
   它们用的是**同目录相对导入**（./ip-utils.js 等），拷贝时文件名不变，因此
   无需改写导入路径 —— 只要把这 5 个文件都放进 lib/ 即可。 */
const core = read('redteam-store/lib/core.js')
write('lib/store-core.js', core)
/* 1a) core.js 依赖的模块（纯函数、分片策略、会话状态机、DAG工作流、提示词与 PostgreSQL 引擎，零外部依赖） */
const STORE_SUB_MODULES = [
  'ip-utils', 'schema', 'validate', 'score-rules', 'report-replay',
  'settings', 'pg-engine', 'prompts', 'shard-policy', 'session-bindings', 'dag-workflow',
]
for (const name of STORE_SUB_MODULES) {
  if (existsSync(join(packagesDir, 'redteam-store/lib/' + name + '.js'))) {
    write('lib/' + name + '.js', read('redteam-store/lib/' + name + '.js'))
  }
}

/* 1b) 技能可用性判定与「不可用修复方法」：tools 与面板共用（零依赖，原样拷） */
const skillAvailability = read('redteam-store/lib/skill-availability.js')
write('lib/skill-availability.js', skillAvailability)
write('lib/skill-fixes.js', read('redteam-store/lib/skill-fixes.js'))
const storeIndex = read('redteam-store/lib/index.js')
  .replace("from './core.js'", "from './store-core.js'")
write('lib/store.js', storeIndex)

function rewriteStoreImports(text) {
  let out = text.replace(/from '\.\.\/\.\.\/redteam-store\/lib\/core\.js'/g, "from './store-core.js'")
  for (const modName of [...STORE_SUB_MODULES, 'skill-availability', 'skill-fixes']) {
    out = out.replace(
      new RegExp(`from '\\.\\./\\.\\./redteam-store/lib/${modName}\\.js'`, 'g'),
      `from './${modName}.js'`,
    )
  }
  return out
}

/* 2) 控制台 host 半侧：把跨包的 core/store 引用改成本地兄弟文件 */
const uiIndex = rewriteStoreImports(read('redteam-ui/lib/index.js'))
write('lib/ui.js', uiIndex)
const UI_SUB_MODULES = [
  'llm-planner.js', 'dsh-dispatch.js', 'telemetry-jsonl.js',
  'settings-bridge.js', 'update-manager.js', 'scope-rollback.js', 'dag-scheduler.js',
  'window-launcher.js',
]
for (const uiSub of UI_SUB_MODULES) {
  if (existsSync(join(packagesDir, 'redteam-ui/lib/' + uiSub))) {
    write('lib/' + uiSub, rewriteStoreImports(read('redteam-ui/lib/' + uiSub)))
  }
}

/* 3) 浏览器半侧：拷过来，并把注册 id 改成**本包的包名**。
   前端加载器按包名取模块：bundle URL 是 `dsh-redteam-mode/client.js`，它就用
   `__ModuleLoader__.load({ id: 'dsh-redteam-mode' })` 去认领；源码包里写的是
   `dsh-redteam-ui`（那份 bundle 属于 UI 包），不改就会报
   "loaded without registering ... via __ModuleLoader__.load"。 */
const clientSrc = read('redteam-ui/lib/client.js')

/* 3a) 把 CSS 占位符替换成 styles.js 的正文。
   浏览器半侧运行期不能 import（模块身份靠 __ModuleLoader__.load，基座外只能 require react），
   所以源码里 client.js 只留一行 `const CSS = '__RT_STYLES__'`，由这里内联 ——
   源码可读（CSS 单独一个文件、编辑器能高亮），产物仍是单文件自包含。 */
const stylesSrc = read('redteam-ui/lib/styles.js')
const styleMatch = /export const CSS = String\.raw`([\s\S]*?)`\r?\n?$/.exec(stylesSrc)
if (styleMatch === null) throw new Error('styles.js 里找不到 export const CSS = String.raw`...`')
const cssText = styleMatch[1]
if (!clientSrc.includes("'__RT_STYLES__'")) throw new Error('client.js 里找不到 __RT_STYLES__ 占位符')
if (cssText.includes('`') || cssText.includes('${')) {
  throw new Error('CSS 里含反引号或 ${ —— 内联进模板串会截断，请改用其它引号写法')
}
const clientWithCss = clientSrc.replace("'__RT_STYLES__'", '`' + cssText + '`')
const clientId = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).name
const registered = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(clientWithCss)
if (registered === null) throw new Error('client.js 里找不到 __ModuleLoader__.load({ id })')
const clientOut = clientWithCss.replace(
  /(__ModuleLoader__\.load\(\{\s*id:\s*')[^']+(')/,
  `$1${clientId}$2`,
)
if (!new RegExp(`__ModuleLoader__\\.load\\(\\{\\s*id:\\s*'${clientId}'`).test(clientOut)) {
  throw new Error('client.js 的注册 id 改写失败')
}
write('lib/client.js', clientOut)

/* 4) 工具集：跨包引用改成本地兄弟文件 */
const tools = rewriteStoreImports(read('redteam-tools/lib/index.js'))
write('lib/tools.js', tools)

/* 5) 预设：源码是仓库根的 `preset/agent.cordis.yml`（指挥者）与
      `preset/worker.cordis.yml`（执行角色）。生成两个产物：
       a) `presets/redteam/agent.cordis.yml` —— 老式「目录预设」，只有 DSH < 0.1.7
          的 `$DSH_HOME/.agent-presets/` 扫描机制会读它，留着给老版本用户。
       b) `cordis.patch.yml` 生成区里的 `preset-redteam` / `preset-redteam-worker`
          九条声明行（主预设 + 执行角色 + 7 个角色变体）—— DSH 0.1.7-alpha.1 起 agent preset **只认
          `@deepseek-ai/dsh-agent-preset` 声明行**（注册表既不扫目录也不接受预设路径）。
          DSH 0.2.1 起 `tool-subagent` 移除了 persona/toolFilter：执行角色的人设与
          工具集必须由 `preset-redteam-worker` 提供，再由主预设的
          `tool-subagent.agentPreset: redteam-worker` 选中。
          不单开补丁文件的原因见 cordis.patch.yml 里的说明（数组形式旧版会崩）。
   工具行都改成本包子路径；skill-filesystem 行注入技能目录。 */
/* 预设：工具行改成本包子路径；skill-filesystem 行注入包内技能目录占位符。
   占位符由这里注入（而不是写在源码预设里），避免仓库预设耦合运行期路径。 */
const SKILL_ROW = "- id: skill-filesystem\n  name: '@deepseek-ai/dsh-skill-filesystem'"
const SKILLS_LINE = '      - {{LMTAGENT_SKILLS_DIR}}'

/** 读一份源预设，把工具行改成本包子路径，并注入技能目录配置。 */
function renderPreset(rel) {
  const source = read(rel)
  if (!source.includes(SKILL_ROW)) throw new Error(rel + ' 里找不到 skill-filesystem 行')
  const rendered = source
    .replace('  name: dsh-lmtagent-tools', '  name: dsh-lmtagent/tools')
    .replace(SKILL_ROW, SKILL_ROW + `
  # 工程技能随包分发：{{LMTAGENT_SKILLS_DIR}} 由插件首次启动时替换成包内 skills/ 的绝对路径。
  # 技能根顺序即优先级（同名技能取先出现的那份）：$DSH_HOME/skills 排在包内目录前面，
  # 方便用户覆盖或扩充自有工程规范，同时保证随包工程技能开箱即用。
  config:
    # 只扫描 "$DSH_HOME/skills + 本插件自带的干净工程技能包" 两个根：
    # 关掉 includeDefaultRoots，避免把项目级无关技能全部吞进会话上下文。
    includeDefaultRoots: false
    customSkillDirs:
      - !!js dshHomePath('skills')
      - {{LMTAGENT_SKILLS_DIR}}`)
  if (!rendered.includes('  name: dsh-lmtagent/tools')) throw new Error(rel + ' 工具名改写 dsh-lmtagent/tools 失败')
  if (!rendered.includes('{{LMTAGENT_SKILLS_DIR}}')) throw new Error(rel + ' 技能目录占位符注入失败')
  return rendered
}

const preset = renderPreset('../preset/agent.cordis.yml')
const workerPreset = renderPreset('../preset/worker.cordis.yml')

/* 7 个按角色裁剪工具的执行预设：同一份 worker 模板，只改 persona 标题与
   lmtagent-tools 的 config.profile。工具裁剪在插件里按排除集实现；profile 没被
   宿主传进来时回退 all，所以即使这里配置失效也只是“多看见工具”，不会少工具。 */
const ROLE_PROFILES = [
  { profile: 'recon', title: '产品与需求规划（CEO）' },
  { profile: 'designer', title: '交互与视觉设计（Designer）' },
  { profile: 'assess', title: '系统架构与排期（Eng Manager）' },
  { profile: 'vuln-scan', title: '代码审查与安全（Reviewer & CSO）' },
  { profile: 'exploit', title: '全栈研发与构建（Builder）' },
  { profile: 'qa', title: '质量保障与测试（QA Lead）' },
  { profile: 'internal', title: '文档工程与发布（Doc & Release）' },
]
const workerMeta = read('../preset/worker.preset.yml')
function renderWorkerVariant(role) {
  let text = workerPreset
  text = text.replace('  name: dsh-lmtagent/tools', '  name: dsh-lmtagent/tools\n  config:\n    profile: ' + role.profile)
  text = text
    .replace('你是 **LMTAgent 软件工程研发集群的执行角色** 智能体',
      '你是 **LMTAgent 软件工程研发集群 · ' + role.title + '执行角色** 智能体')
    .replace('你是红队（RedTeam）作战的**执行角色**智能体',
      '你是 **LMTAgent 软件工程研发集群 · ' + role.title + '执行角色** 智能体')
  return text
}
function workerVariantMeta(role) {
  return workerMeta
    .replace(/^name:.*$/m, 'name: LMTAgent 研发节点 · ' + role.title)
    .replace(/^description:.*$/m, 'description: LMTAgent 主会话派发任务时自动选用的' + role.title + '执行预设（按角色裁剪工具），请不要手动选择。')
}
const workerVariants = ROLE_PROFILES.map((role) => ({ ...role, text: renderWorkerVariant(role) }))
for (const role of workerVariants) {
  /* 目录预设是给 DSH <0.1.7 的旧安装路径看的；角色变体没有 installPreset 替换占位符，
     写文件时直接落到 $DSH_HOME/skills（包内技能根由声明行负责）。 */
  write('presets/lmtagent/worker-' + role.profile + '.cordis.yml',
    role.text.replace('      - {{LMTAGENT_SKILLS_DIR}}\n', ''))
}
write('presets/lmtagent/agent.cordis.yml', preset)
const presetMeta = read('../preset/preset.yml')
const presetMetaPath = join(pkgRoot, 'presets/lmtagent/preset.yml')
if (CHECK) {
  let current
  try { current = readFileSync(presetMetaPath, 'utf8').replace(/\r\n/g, '\n') } catch { current = undefined }
  if (current !== presetMeta) drift.push('presets/lmtagent/preset.yml')
  if (existsSync(join(pkgRoot, 'presets/redteam'))) drift.push('presets/redteam（旧命名空间目录，应删除）')
  if (existsSync(join(repoRoot, 'presets/redteam'))) drift.push('repoRoot/presets/redteam（旧命名空间目录，应删除）')
} else {
  rmSync(join(pkgRoot, 'presets/redteam'), { recursive: true, force: true })
  rmSync(join(repoRoot, 'presets/redteam'), { recursive: true, force: true })
  mkdirSync(dirname(presetMetaPath), { recursive: true })
  writeFileSync(presetMetaPath, presetMeta, 'utf8')
}

/* 5b) 声明行（产物 b 的内容，写回 cordis.patch.yml 的生成区）。
     技能目录改为运行时解析，两级：
       ① 本包 host 半侧 `dsh-lmtagent` 提供的 `lmtagentMode` 服务，它用
          `import.meta.url` 解析包内路径；
       ② 兜底按 profile base 解析 `dsh-lmtagent/package.json`。 */
const SKILLS_EXPR = "ctx.get('lmtagentMode')?.paths?.skills ?? process.getBuiltinModule('node:path').join(process.getBuiltinModule('node:path').dirname(process.getBuiltinModule('node:module').createRequire(baseUrl).resolve('dsh-lmtagent/package.json')), 'skills')"

/** 剥离生成区 YAML 中的纯注释行与空行，保留 block scalar（如 `prefix: |`）内的 Markdown 正文。 */
function stripYamlCommentsOutsideBlockScalars(yamlText) {
  const lines = yamlText.split('\n')
  const out = []
  let blockIndent = null
  for (const line of lines) {
    if (blockIndent !== null) {
      if (line.trim() === '') {
        out.push('')
        continue
      }
      const indent = line.match(/^[ \t]*/)[0].length
      if (indent > blockIndent) {
        out.push(line)
        continue
      }
      blockIndent = null
    }
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    out.push(line)
    if (/^[a-zA-Z0-9_-]+:\s*[|>][+-]?\s*(#.*)?$/.test(trimmed)) {
      blockIndent = line.match(/^[ \t]*/)[0].length
    }
  }
  return out.join('\n')
}

/** 生成一条 `@deepseek-ai/dsh-agent-preset` 声明行。 */
function declarePreset({ entryId, id, metaRel, metaText, order, plugins }) {
  const meta = metaText !== undefined ? metaText : read(metaRel)
  const metaName = /^name:[ \t]*(.*)$/m.exec(meta)
  const metaDescription = /^description:[ \t]*(.*)$/m.exec(meta)
  if (metaName === null || metaDescription === null) throw new Error((metaRel || entryId) + ' 缺少 name 或 description')
  const declaredPlugins = stripYamlCommentsOutsideBlockScalars(
    plugins.replace(SKILLS_LINE, '      - !!js ' + SKILLS_EXPR),
  )
  if (declaredPlugins === plugins) throw new Error(entryId + ' 声明行里技能目录占位符替换失败')
  return `- insert:
    - id: ${entryId}
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: ${id}
        name: ${JSON.stringify(metaName[1].trim())}
        description: ${JSON.stringify(metaDescription[1].trim())}
        order: ${order}
        plugins:
${declaredPlugins.split('\n').map((line) => (line.trim() === '' ? '' : '          ' + line)).join('\n')}
`
}

/* 生成区从起始标记整段替换：标记之前的内容（迁移补丁 + 三个挂载行）是手写的，
   这里原样保留，所以 patches 文件平时仍然可以手工编辑。 */
const DECL_START = '# >>> preset-lmtagent declaration'
const DECL_END = '# <<< preset-lmtagent declaration <<<'
const declBody = declarePreset({
  entryId: 'preset-lmtagent',
  id: 'lmtagent',
  metaRel: '../preset/preset.yml',
  order: 10,
  plugins: preset,
}) + declarePreset({
  entryId: 'preset-lmtagent-worker',
  id: 'lmtagent-worker',
  metaRel: '../preset/worker.preset.yml',
  order: 90,
  plugins: workerPreset,
}) + workerVariants.map((role, i) => declarePreset({
  entryId: 'preset-lmtagent-worker-' + role.profile,
  id: 'lmtagent-worker-' + role.profile,
  metaRel: '../preset/worker.preset.yml',
  metaText: workerVariantMeta(role),
  order: 91 + i,
  plugins: role.text,
})).join('')
const patchPath = join(pkgRoot, 'cordis.patch.yml')
const patchText = readFileSync(patchPath, 'utf8').replace(/\r\n/g, '\n')
const startAt = patchText.indexOf(DECL_START)
const endAt = patchText.indexOf(DECL_END)
if (startAt < 0 || endAt < 0 || endAt < startAt) {
  throw new Error('cordis.patch.yml 里找不到生成区标记（' + DECL_START + ' / ' + DECL_END + '）')
}
write('cordis.patch.yml', patchText.slice(0, startAt) + DECL_START + ' (generated by tools/build.mjs) >>>\n' + declBody + DECL_END + '\n')

/* 技能：从仓库已脱敏的 skills/ 拷一份 —— 但按 tools/distribution.mjs 的发行契约，
   攻击操作手册型技能**不进 npm 包**（它们与"下载渗透工具"一起构成自动审查眼中的恶意特征）。
   留在仓库的那 9 份随 Release 附件分发，用户显式获取。

   ⚠️ 拷贝前先清空目标目录：本脚本只"写"不"删"，历史上一次手工放进
   packages/redteam-bundle/skills/ 的文件会永远留在包里 —— 表现是"本机看着 23 个技能、
   干净检出只有 13 个"（README 承诺 23 个，发布产物却只有 13 个）。
   清空后 `skills/` 与"仓库根 skills/ ∩ 发行白名单"严格对应，包内容可复现。 */
const skillsSrc = join(packagesDir, '../skills')
const skillsDst = join(pkgRoot, 'skills')
const allSkillNames = readdirSync(skillsSrc).filter((f) => f.endsWith('.md'))
const omittedSkills = allSkillNames.filter((f) => !isSkillShipped(f))
const skillNames = allSkillNames.filter((f) => isSkillShipped(f))
if (CHECK) {
  /* 只比对，不删盘：目标目录里多出来的文件同样是 drift */
  let current = []
  try { current = readdirSync(skillsDst).filter((f) => f.endsWith('.md')) } catch { current = [] }
  for (const f of current) if (!skillNames.includes(f)) drift.push('skills/' + f + '（多余，应删除）')
} else {
  rmSync(skillsDst, { recursive: true, force: true })
  mkdirSync(skillsDst, { recursive: true })
}
let skills = 0
for (const f of skillNames) {
  const text = readFileSync(join(skillsSrc, f), 'utf8').replace(/\r\n/g, '\n')
  if (CHECK) {
    let current
    try { current = readFileSync(join(skillsDst, f), 'utf8').replace(/\r\n/g, '\n') } catch { current = undefined }
    if (current !== text) drift.push('skills/' + f)
  } else {
    writeFileSync(join(skillsDst, f), text, 'utf8')
  }
  skills += 1
}

/* 环境安装脚本：**不再随 npm 包分发**（0.12.0 起）。
   它会在用户机器上自动下载 11 个渗透二进制并 chmod +x —— 这正是发布期自动审查判定
   "恶意"的行为特征。改为：包内不带；需要的人从 Release 附件取工具箱后**自己执行**。
   启动逻辑（lib/index.js 的 installSetupScript）本就处理"包内没有脚本"的情况：
   返回 action=missing，预检据此提示用户去哪拿，绝不代下载。 */
const setupSrc = join(packagesDir, '..', 'scripts', 'redteam-setup.sh')
const setupDst = join(pkgRoot, 'scripts', 'redteam-setup.sh')
let setupCopied = false
if (!isScriptShipped('redteam-setup.sh')) {
  if (CHECK) {
    if (existsSync(setupDst)) drift.push('scripts/redteam-setup.sh（发行契约要求删除）')
  } else {
    rmSync(join(pkgRoot, 'scripts'), { recursive: true, force: true })
  }
} else {
  try {
    const text = readFileSync(setupSrc, 'utf8')
    if (CHECK) {
      let current
      try { current = readFileSync(setupDst, 'utf8') } catch { current = undefined }
      if (current !== text) drift.push('scripts/redteam-setup.sh')
    } else {
      mkdirSync(dirname(setupDst), { recursive: true })
      writeFileSync(setupDst, text, { encoding: 'utf8', mode: 0o755 })
    }
    setupCopied = true
  } catch (error) {
    console.error('✗ 读取 scripts/redteam-setup.sh 失败：' + (error && error.message ? error.message : String(error)))
  }
}

/* 校验：生成的 lib 里不允许再出现跨包的相对路径 */
const generated = [
  'lib/store-core.js', 'lib/store.js', 'lib/ui.js', 'lib/tools.js', 'lib/client.js',
  ...STORE_SUB_MODULES.map((m) => `lib/${m}.js`),
  'lib/skill-availability.js', 'lib/skill-fixes.js',
  ...UI_SUB_MODULES.map((m) => `lib/${m}`),
].filter((rel) => existsSync(join(pkgRoot, rel)))
const offenders = []
for (const rel of generated) {
  const text = readFileSync(join(pkgRoot, rel), 'utf8')
  for (const m of text.matchAll(/from\s+'([^']*\.\.\/[^']*)'/g)) offenders.push(`${rel}: ${m[1]}`)
  for (const m of text.matchAll(/from\s+'([^']*(?:redteam|lmtagent)-(store|ui|tools)[^']*)'/g)) offenders.push(`${rel}: ${m[1]}`)
  for (const m of text.matchAll(/from\s+'(@lmtagent\/[^']+)'/g)) offenders.push(`${rel}: ${m[1]}`)
}
if (offenders.length > 0) {
  console.error('✗ 生成结果仍含跨包引用：')
  for (const o of offenders) console.error('   ' + o)
  process.exit(1)
}
if (!existsSync(join(pkgRoot, 'presets/lmtagent/agent.cordis.yml'))) {
  console.error('✗ 预设未生成（目录预设给 DSH < 0.1.7，声明行写在 cordis.patch.yml 里）')
  process.exit(1)
}
if (!preset.includes('maxDepth: 3') || !workerPreset.includes('maxDepth: 3')) {
  console.error('✗ 主预设或执行角色预设未启用递归子代理委派（maxDepth: 3）')
  process.exit(1)
}
const patchGenerated = readFileSync(join(pkgRoot, 'cordis.patch.yml'), 'utf8')
if (!patchGenerated.includes('id: preset-lmtagent')) {
  console.error('✗ cordis.patch.yml 里没有生成出 preset-lmtagent 声明行')
  process.exit(1)
}
if (!patchGenerated.includes('id: preset-lmtagent-worker')) {
  console.error('✗ cordis.patch.yml 里没有生成出 preset-lmtagent-worker 声明行（执行角色预设）')
  process.exit(1)
}
/* 6) 同步仓库根产物（支持 dsh plugin add github:ECCVIK/LMTAgent 直接安装仓库根），杜绝根包静默漂移。 */
const syncOrCheckRootFile = (relPath) => {
  const bundlePath = join(pkgRoot, relPath)
  const rootPath = join(repoRoot, relPath)
  if (CHECK) {
    let bundleBuf
    let rootBuf
    try { bundleBuf = readFileSync(bundlePath) } catch { bundleBuf = undefined }
    try { rootBuf = readFileSync(rootPath) } catch { rootBuf = undefined }
    if (!bundleBuf || !rootBuf || Buffer.compare(bundleBuf, rootBuf) !== 0) {
      drift.push(`repoRoot/${relPath}（与 packages/redteam-bundle/${relPath} 不同步）`)
    }
    return
  }
  mkdirSync(dirname(rootPath), { recursive: true })
  copyFileSync(bundlePath, rootPath)
}

syncOrCheckRootFile('cordis.patch.yml')

const bundleLibFiles = readdirSync(libDir, { withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => e.name)
  .sort()
for (const fileName of bundleLibFiles) {
  syncOrCheckRootFile('lib/' + fileName)
}

const bundlePresetDir = join(pkgRoot, 'presets/lmtagent')
const rootPresetDir = join(repoRoot, 'presets/lmtagent')
const bundlePresetFiles = readdirSync(bundlePresetDir, { withFileTypes: true })
  .filter((e) => e.isFile())
  .map((e) => e.name)
  .sort()
if (CHECK) {
  let rootPresetFiles = []
  try {
    rootPresetFiles = readdirSync(rootPresetDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
  } catch { rootPresetFiles = [] }
  for (const f of rootPresetFiles) {
    if (!bundlePresetFiles.includes(f)) drift.push('repoRoot/presets/lmtagent/' + f + '（多余，应删除）')
  }
} else if (existsSync(rootPresetDir)) {
  for (const e of readdirSync(rootPresetDir, { withFileTypes: true })) {
    if (e.isFile() && !bundlePresetFiles.includes(e.name)) rmSync(join(rootPresetDir, e.name), { force: true })
  }
}
for (const fileName of bundlePresetFiles) {
  syncOrCheckRootFile('presets/lmtagent/' + fileName)
}

if (CHECK) {
  if (drift.length > 0) {
    console.error('✗ 生成物与源码或仓库根不同步（跑 node packages/redteam-bundle/tools/build.mjs 重新生成）：')
    for (const d of drift) console.error('   ' + d)
    process.exit(1)
  }
  console.log(`✓ 生成物与源码及仓库根同步（lib/ ${generated.length} 个生成文件、根同步 ${bundleLibFiles.length} 个文件、预设 9 份、cordis.patch.yml 九条声明行、技能 ${skills} 个）`)
  process.exit(0)
}
console.log(`✓ dsh-lmtagent 已生成并同步至仓库根：lib/ ${generated.length} 个文件（根同步 ${bundleLibFiles.length} 个）、预设 9 份（指挥者 + 执行角色 + 7 个角色变体，支持 maxDepth: 3 递归子代理 + thinking: low 默认）+ cordis.patch.yml 九条声明行、技能 ${skills} 个、安装脚本 ${setupCopied ? '1 个' : '缺失'}`)
