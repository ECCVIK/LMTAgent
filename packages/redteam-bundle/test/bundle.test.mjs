/**
 * 市场包 `dsh-lmtagent` 的打包自检（零依赖）
 *
 * 跑法：node packages/redteam-bundle/test/bundle.test.mjs
 *
 * 这个包是**要发布到 npm、被陌生人装进自己 harness** 的，所以除了功能，
 * 还要盯住三类最容易翻车的地方：
 *   ① 生成物漂移：lib/ 是从三个源码包生成的，忘了重新生成就会发旧代码；
 *   ② 打包契约：dsh.bundle.patch / dsh.client / exports 子路径必须齐，
 *      否则装完不挂载、浏览器半侧不加载；
 *   ③ 泄密：技能与预设里不能有本机路径、VPS 地址、API key（要公开的包）。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let pass = 0
let fail = 0
const ok = (cond, msg) => { if (cond) { pass += 1; console.log(`  ✓ ${msg}`) } else { fail += 1; console.log(`  ✗ ${msg}`) } }
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

console.log('— 打包契约')
ok(manifest.name === 'dsh-lmtagent', `包名是 ${manifest.name}`)
ok(manifest.dsh?.bundle?.patch === './cordis.patch.yml',
  'dsh.bundle.patch 是**单文件**（写成数组会让 DSH ≤0.1.6 拿数组去 path.join 直接抛错、整个 harness 起不来）')
ok(!Array.isArray(manifest.dsh?.bundle?.patch), '补丁声明不是数组（只有 DSH ≥0.1.7 才支持数组形式）')
ok(existsSync(join(root, manifest.dsh.bundle.patch)), `补丁文件真的在包里：${manifest.dsh.bundle.patch}`)
ok(manifest.dsh?.client?.platform === 'web', '声明了 dsh.client.platform=web（浏览器半侧才会被加载）')
for (const sub of ['.', './store', './ui', './tools', './client']) {
  ok(typeof manifest.exports?.[sub] === 'string', `exports["${sub}"] 存在`)
}
ok(manifest.dependencies === undefined || Object.keys(manifest.dependencies).length === 0, '零运行时依赖（自包含）')
const { OMITTED_SKILLS: omittedList } = await import('../tools/distribution.mjs')
const repoSkillFiles = readdirSync(join(root, '..', '..', 'skills')).filter((f) => f.endsWith('.md'))
const expectedShippedCount = repoSkillFiles.length - omittedList.length
const pkgSkillFiles = readdirSync(join(root, 'skills')).filter((f) => f.endsWith('.md')).sort()
const npmSkillFiles = (manifest.files ?? []).filter((f) => f.startsWith('skills/')).map((f) => f.slice('skills/'.length)).sort()
const coreEngSkills = ['eng-wish-spec.md', 'eng-ui-design-tokens.md', 'eng-api-contract-sharding.md', 'eng-fullstack-builder.md', 'eng-code-review-security.md', 'eng-test-verification-gate.md', 'eng-release-changelog.md', 'eng-git-recovery.md', 'browser-automation.md', 'campaign-planning.md', 'opsec-hygiene.md', 'supply-chain.md']
ok((manifest.files ?? []).includes('cordis.patch.yml') && (manifest.files ?? []).includes('presets'), 'files 覆盖补丁/预设')
ok(!(manifest.files ?? []).includes('skills') && npmSkillFiles.length === expectedShippedCount && expectedShippedCount === 12,
  `npm 包显式列出 ${npmSkillFiles.length} 个干净工程/中性技能（期待 ${expectedShippedCount} 个，不含攻击渗透技能）`)
ok(npmSkillFiles.every((f) => pkgSkillFiles.includes(f)), 'npm 技能清单里的文件都在包内')
ok(!npmSkillFiles.includes('egress-ip-rotate.md'), '本地自有技能 egress-ip-rotate 不随包')
ok(coreEngSkills.every((f) => npmSkillFiles.includes(f)), '全部 8 份工程核心技能 + 4 份中性技能随 npm 包分发')

console.log('— 补丁层')
const patchFileText = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const DECL_START = '# >>> preset-lmtagent declaration'
const declAt = patchFileText.indexOf(DECL_START)
ok(declAt > 0, 'cordis.patch.yml 里有生成区起始标记（build.mjs 靠它整段替换生成区）')
const patch = patchFileText.slice(0, declAt)
const decl = patchFileText.slice(declAt)
ok(patch.includes('dsh-lmtagent/store') && patch.includes('dsh-lmtagent/ui'), '只挂本包的子路径行（不引用传递依赖）')
ok(patch.includes("dshHomePath('lmtagent')"), '资产库根目录用 dshHomePath(\'lmtagent\') 解析')
const mountNames = [...patch.matchAll(/^\s{4,}-?\s*name:\s*(\S+)\s*$/gm)].map((m) => m[1])
ok(mountNames.length > 0 && mountNames.every((n) => n.startsWith('dsh-lmtagent')),
  `insert 的挂载行只用本包子路径：${mountNames.join(', ')}`)

const insertedIds = []
{
  let inInsert = false
  for (const line of patch.split('\n')) {
    if (/^\s*-?\s*insert:\s*$/.test(line)) { inInsert = true; continue }
    if (/^\s*-\s/.test(line) && !/^\s{4,}/.test(line)) {
      if (/^\s*-\s+id:/.test(line)) inInsert = false
    }
    const m = /^\s{4,}-\s+id:\s*(\S+)\s*$/.exec(line)
    if (inInsert && m) insertedIds.push(m[1])
  }
}
ok(insertedIds.length >= 3, `解析出 ${insertedIds.length} 个 insert 行 id：${insertedIds.join(', ')}`)
ok(insertedIds.every((id) => id.startsWith('lmtagent-')), 'insert 的行 id 统一带 lmtagent- 前缀，与旧 dsh-redteam-mode 物理共存零冲突')
ok(!/disabled:\s*true/.test(patch), '共存模式：不再禁用旧 dsh-redteam-store / dsh-redteam-ui')

console.log('— 预设声明行（新会话模式列表的唯一入口）')
ok(/^\s*- id: preset-lmtagent$/m.test(decl), '声明行 loader id = preset-lmtagent')
ok(/^\s*name: '@deepseek-ai\/dsh-agent-preset'$/m.test(decl), '挂的是 @deepseek-ai/dsh-agent-preset')
ok(/^\s*id: lmtagent$/m.test(decl), '预设 id = lmtagent')
ok(/^\s*name: "LMTAgent 研发集群"$/m.test(decl), '显示名 = LMTAgent 研发集群（与 preset/preset.yml 同源）')
ok(/^\s*order: \d+$/m.test(decl), '给了 order（模式列表里的位置）')
ok(/^\s*- id: preset-lmtagent-worker$/m.test(decl), '执行角色声明行 loader id = preset-lmtagent-worker')
ok(/^\s*id: lmtagent-worker$/m.test(decl), '执行角色预设 id = lmtagent-worker')
ok(/^\s*name: "LMTAgent 研发执行节点"$/m.test(decl), '执行角色显示名（与 preset/worker.preset.yml 同源）')
ok(/^\s*order: 90$/m.test(decl), '执行角色排在模式列表末尾')
ok(!decl.includes('{{LMTAGENT_SKILLS_DIR}}') && !decl.includes('{{REDTEAM_SKILLS_DIR}}'), '声明行里没有未替换的占位符')
ok(!decl.includes('{{cwd}}'), '声明行里没有当前 DSH 不支持的 {{cwd}} 变量')
ok((decl.match(/sampleOverCapGlobResults: false/g) || []).length >= 7,
  '主预设 + 执行角色 + 7 个角色变体都带 tool-fs-search 的必填 sampleOverCapGlobResults')
ok(/lmtagentMode/.test(decl) && /skills/.test(decl), '技能目录运行时解析（lmtagentMode 服务）')
ok(/dshHomePath\('skills'\)/.test(decl), '技能根顺序：$DSH_HOME/skills 排在包内目录前面')
ok(/name: '@deepseek-ai\/dsh-workflow-ptc'/.test(decl) && !/name: '@deepseek-ai\/dsh-workflow-worker-thread'/.test(decl),
  'workflow 行用随基座分发的 @deepseek-ai/dsh-workflow-ptc')
const declRows = [...decl.matchAll(/^ {10}- id: (\S+)$/gm)].map((m) => m[1])
ok(declRows.length >= 25, `带上了两份预设的完整插件列表（${declRows.length} 个顶层预设行）`)
for (const wanted of ['persona', 'lmtagent-tools', 'skill-filesystem', 'delegation', 'tool-web']) {
  ok(declRows.includes(wanted), `关键顶层行在：${wanted}`)
}
ok(/^\s+- id: tool-subagent$/m.test(decl) && /maxDepth: 3/.test(decl),
  '组内的 tool-subagent 行与其 maxDepth=3 递归派发配置随声明行一起带过来')
ok(/agentPreset: lmtagent-worker/.test(decl), 'tool-subagent 用 agentPreset 指向执行角色预设 lmtagent-worker')
ok(/allowedAgentPresets:/.test(decl) && ['recon','designer','assess','vuln-scan','exploit','qa','internal'].every((r) => decl.includes('lmtagent-worker-' + r)),
  '主预设列出 7 个按角色裁剪的执行预设 lmtagent-worker-*')
for (const r of ['recon','designer','assess','vuln-scan','exploit','qa','internal']) {
  ok(decl.includes('- id: preset-lmtagent-worker-' + r) && new RegExp('profile: ' + r).test(decl),
    '角色预设声明存在并带 profile=' + r)
  ok(existsSync(join(root, 'presets/lmtagent/worker-' + r + '.cordis.yml')),
    '角色预设文件随包：worker-' + r + '.cordis.yml')
}

const workerDeclAt = decl.indexOf('- id: preset-lmtagent-worker')
ok(workerDeclAt > 0, '找得到 preset-lmtagent-worker 声明行')
const workerDecl = workerDeclAt > 0 ? decl.slice(workerDeclAt) : ''
ok(workerDeclAt > 0 && /name: '@deepseek-ai\/dsh-tool-subagent'/.test(workerDecl) && /maxDepth: 3/.test(workerDecl),
  '执行角色预设挂载 dsh-tool-subagent（支持 maxDepth=3 递归子智能体派发）')
ok(workerDeclAt > 0 && !/name: '@deepseek-ai\/dsh-tool-workflow'/.test(workerDecl)
  && !/name: '@deepseek-ai\/dsh-tool-ralph'/.test(workerDecl),
  '执行角色预设不挂 workflow / ralph')
ok(workerDeclAt > 0 && /includeDefaultRoots: false/.test(workerDecl) && /dshHomePath\('skills'\)/.test(workerDecl),
  '执行角色预设的技能根与主预设同源（$DSH_HOME/skills + 包内 skills）')
ok(!/^\s+toolFilter:/m.test(decl), '声明行里没有 toolFilter 配置键')

console.log('— 预设')
const preset = readFileSync(join(root, 'presets/lmtagent/agent.cordis.yml'), 'utf8')
ok(preset.includes('name: dsh-lmtagent/tools'), '工具行指向本包子路径 dsh-lmtagent/tools')
ok(preset.includes('{{LMTAGENT_SKILLS_DIR}}'), '技能目录是待替换占位符 {{LMTAGENT_SKILLS_DIR}}')
ok(/includeDefaultRoots: false/.test(preset), '关掉默认技能根')
ok(/dshHomePath\('skills'\)/.test(preset), '额外只放行 $DSH_HOME/skills')
ok(/LMTAgent 软件工程研发集群总指挥（Captain）/.test(preset), '人设正文在')
ok(/lmt_preflight/.test(preset), '人设要求开工前跑 lmt_preflight')
ok(/lmt_agent_slot/.test(preset), '人设写明并发闸门 lmt_agent_slot')
ok(/数量由用户配置|当前\*\*名额/.test(preset) && /默认 6/.test(preset), '人设写明并发数量可配置、默认 6')
ok(/会话隔离/.test(preset), '人设写明会话隔离')
ok(/不动手/.test(preset), '人设写明主会话只计划/汇总、不直接动手写业务代码')
ok(/assess/.test(preset) && /designer/.test(preset) && /qa/.test(preset) && /recon/.test(preset), '人设写明八个角色')
ok(/4-Wave Bounded DAG/.test(preset) && /File-Disjoint Sharding/.test(preset),
  '人设写明 4-Wave Bounded DAG 与文件不重叠分片纪律')
ok(!preset.includes('/home/'), '预设里没有本机绝对路径')
ok(!/^\s+toolFilter:/m.test(preset), '主预设不再写 toolFilter')
ok(/agentPreset: lmtagent-worker/.test(preset), '主预设用 agentPreset 把子会话交给 lmtagent-worker')

const workerSource = readFileSync(join(root, '..', '..', 'preset', 'worker.cordis.yml'), 'utf8')
ok(/LMTAgent 软件工程研发集群的执行角色/.test(workerSource), '执行角色人设在')
ok(/角色系统提示词/.test(workerSource) && /严格按那段角色职责执行/.test(workerSource), '执行角色人设要求按 lmt_role_prompt 的职责执行')
ok(/thinking: low/.test(workerSource) && /maxDepth: 3/.test(workerSource), '执行角色人设写明默认 low 思考模式且支持 maxDepth=3')
ok(/技能路由/.test(workerSource) && /外部工具\/技能/.test(workerSource), '执行角色人设有技能路由与外部能力入口')
ok(/curl \| bash/.test(workerSource), '执行角色人设禁止无法审阅的 curl|bash 安装')
ok(/研发优先级/.test(workerSource) && /P0/.test(workerSource) && /P1/.test(workerSource), '执行角色人设写入 P0 / P1 优先级')
ok(/模块分层准入/.test(workerSource) && /T0/.test(workerSource) && /T2/.test(workerSource), '执行角色人设写入模块分层准入')
for (const wanted of ['persona', 'lmtagent-tools', 'skill-filesystem', 'tool-skill', 'tool-bash', 'tool-fs', 'tool-web']) {
  ok(new RegExp('^- id: ' + wanted + '$', 'm').test(workerSource), `执行角色预设包含：${wanted}`)
}
ok(/^- id: delegation$/m.test(workerSource), '执行角色预设包含 delegation 组')
ok(/^\s+- id: tool-subagent$/m.test(workerSource), '执行角色预设包含 subagent 工具行')
ok(/name: '@deepseek-ai\/dsh-tool-subagent'/.test(workerSource), '执行角色预设引用 dsh-tool-subagent')
ok(!/name: '@deepseek-ai\/dsh-tool-workflow'/.test(workerSource) && !/name: '@deepseek-ai\/dsh-tool-ralph'/.test(workerSource),
  '执行角色预设不引用 workflow / ralph')
ok(!workerSource.includes('{{LMTAGENT_SKILLS_DIR}}'), '执行角色源预设不含落地占位符')
ok(!/^\s+customSkillDirs:/m.test(workerSource), '执行角色源预设不含技能目录配置')
ok(!workerSource.includes('/home/'), '执行角色预设里没有本机绝对路径')

console.log('— 子智能体委派的硬约束（agentPreset / maxDepth）')
{
  const subagentRow = /- id: tool-subagent\n([\s\S]*?)(?=\n    - id: )/.exec(preset)
  ok(subagentRow !== null, '找得到 tool-subagent 行')
  if (subagentRow !== null) {
    const row = subagentRow[1]
    const depth = /maxDepth: (\d+)/.exec(row)
    ok(depth !== null && Number(depth[1]) === 3, 'maxDepth = 3')
    ok(/agentPreset: lmtagent-worker/.test(row), '子会话选用 lmtagent-worker 预设')
    ok(!/^\s+toolFilter:/m.test(row), '不再写 toolFilter')
    ok(!/^\s+persona:/m.test(row), '不再写 persona')
  }
}

console.log('— 浏览器半侧的注册 id')
{
  const client = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  const m = /__ModuleLoader__\.load\(\{\s*id:\s*'([^']+)'/.exec(client)
  ok(m !== null, 'client.js 里有 __ModuleLoader__.load({ id })')
  ok(m !== null && m[1] === manifest.name, `注册 id 等于包名（${m ? m[1] : '?'} vs ${manifest.name}）`)
  ok(/updateCheck/.test(client) && /updateApply/.test(client), 'client.js 带版本检查与一键更新')
  ok(/VersionBar/.test(client) && /有新版本/.test(client), 'client.js 有版本显示与"有新版本"按钮')
  ok(/'agents'/.test(client) && /智能体与并发/.test(client), 'client.js 有「智能体与并发」页签')
  ok(/agentsStatus/.test(client), 'client.js 读并发占用（agentsStatus）')
  ok(/发现时间/.test(client) && /discoveryTimeline/.test(client), 'client.js 有资产「发现时间」视图')
  ok(/POC_CAT_NAME/.test(client) && /按归类分组/.test(client), 'client.js 知识库按归类分组')
  ok(/复现步骤/.test(client) && /复现材料/.test(client), 'client.js 报告展示「复现步骤」与「复现材料」')
  ok(/ShotStrip/.test(client) && /ShotImage/.test(client), 'client.js 有证据截图组件')
  ok(/'shotData'/.test(client) && /rt-shot-zoom/.test(client), 'client.js 走 shotData 取图并支持点击放大')
  ok(/\.rt-shot-row/.test(client) && /\.rt-shot-zoom\{/.test(client), '样式已内联进 client.js')
  ok(!/没有关联的攻击步骤|说不清这一步/.test(client), 'client.js 不出现致歉式/内部口径文案')
}

{
  const srcPreset = readFileSync(join(root, '..', '..', 'preset', 'agent.cordis.yml'), 'utf8')
  ok(!srcPreset.includes('{{LMTAGENT_SKILLS_DIR}}') && !srcPreset.includes('{{REDTEAM_SKILLS_DIR}}'), '仓库源预设不含落地占位符')
  ok(!/customSkillDirs/.test(srcPreset), '仓库源预设不含 customSkillDirs')
}

console.log('— 技能随包分发（发行契约：只带干净工程技能）')
const skills = readdirSync(join(root, 'skills')).filter((f) => f.endsWith('.md'))
const { OMITTED_SKILLS: omitted } = await import('../tools/distribution.mjs')
const shippedCount = readdirSync(join(root, '..', '..', 'skills')).filter((f) => f.endsWith('.md')).length - omitted.length
ok(skills.length === shippedCount, `打包技能 ${skills.length} 个（仓库 ${shippedCount + omitted.length} 个，发行排除 ${omitted.length} 个）`)
for (const f of omitted) {
  ok(!skills.includes(f), `非默认工程包技能不随包分发：${f}`)
  ok(existsSync(join(root, '..', '..', 'skills', f)), `但它仍在仓库里（随可选附件分发）：${f}`)
}
const badSkill = skills.find((f) => {
  const text = readFileSync(join(root, 'skills', f), 'utf8')
  return !/^---\n[\s\S]*?name:\s*\S+/m.test(text) || !/description:/.test(text)
})
ok(badSkill === undefined, '每个技能都有 front-matter（name + description）')
const uncategorized = skills.filter((f) => {
  const text = readFileSync(join(root, 'skills', f), 'utf8')
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)
  if (fm === null) return true
  const cat = /^category: (.+)$/m.exec(fm[1])
  const tags = /^tags: \[(.+)\]$/m.exec(fm[1])
  const desc = /^description: (.+)$/m.exec(fm[1])
  return cat === null || tags === null || desc === null || !desc[1].startsWith('【' + cat[1].trim() + '】')
})
ok(uncategorized.length === 0, '每个随包技能都有 category/tags/【分类】描述前缀：' + (uncategorized.join(', ') || '全部通过'))

console.log('— 公开包不能夹带敏感信息')
/* 检查"打出来的包有没有夹带本机敏感值"。检查对象是包内文件（lib/ presets/ skills/
   cordis.patch.yml）；test/ 自己不在 npm 包里（见 package.json 的 files）。

   ⚠️ **真实值绝不能写进这个文件**（仓库是公开的），"拆成几段再拼"也不算安全 ——
   片段在同一个文件里，拼起来就是完整值。敏感值一律从环境变量读，没配就跳过并说明；
   本机路径由 homedir() 推导，不必写死用户名。

   想在本机跑全量检查：
     REDTEAM_TEST_FOFA_KEY=… REDTEAM_TEST_VPS_IP=… REDTEAM_TEST_HOSTNAME=… node test/bundle.test.mjs */
const SENSITIVE = [
  ['FOFA key', 'REDTEAM_TEST_FOFA_KEY', process.env.REDTEAM_TEST_FOFA_KEY],
  ['VPS IP', 'REDTEAM_TEST_VPS_IP', process.env.REDTEAM_TEST_VPS_IP],
  ['主机名', 'REDTEAM_TEST_HOSTNAME', process.env.REDTEAM_TEST_HOSTNAME],
  ['本机用户名路径', '(homedir())', join(homedir(), '')],
]
for (const [label, source, needle] of SENSITIVE) {
  if (typeof needle !== 'string' || needle.length < 5) {
    console.log(`  · ${label}：跳过（未提供 ${source}；仓库里不留真实值）`)
    continue
  }
  const hits = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'node_modules' && entry.name !== 'test') walk(full); continue }
      if (!/\.(md|yml|yaml|js|json)$/.test(entry.name)) continue
      if (readFileSync(full, 'utf8').includes(needle)) hits.push(full.slice(root.length + 1))
    }
  }
  walk(root)
  ok(hits.length === 0, `${label} 0 命中${hits.length ? '：' + hits.join(', ') : ''}`)
}

console.log('— 模块化样式组装与仓库根同步契约')
{
  const repoRoot = join(root, '..', '..')
  const uiStylesDir = join(root, '..', 'redteam-ui', 'src', 'styles')
  const assembleStylesScript = join(root, '..', 'redteam-ui', 'tools', 'assemble-styles.mjs')
  const expectedStyleModules = [
    '00-tokens.css',
    '01-shell.css',
    '02-wizard.css',
    '03-canvas.css',
    '04-inspector-swimlane.css',
    '05-tabs.css',
    '06-animations.css',
  ]
  ok(existsSync(uiStylesDir), 'packages/redteam-ui/src/styles/ 模块化样式目录存在')
  ok(
    existsSync(uiStylesDir) && expectedStyleModules.every((f) => existsSync(join(uiStylesDir, f))),
    'src/styles/ 包含全部 7 个模块化 CSS 源文件（00-tokens .. 06-animations）',
  )
  for (const [label, scriptPath] of [
    ['assemble-styles.mjs', assembleStylesScript],
    ['assemble-client.mjs', join(root, '..', 'redteam-ui', 'tools', 'assemble-client.mjs')],
  ]) {
    try {
      execFileSync(process.execPath, [scriptPath, '--check'], { stdio: 'pipe' })
      ok(true, `${label} --check 通过（源码与生成产物零漂移）`)
    } catch (error) {
      ok(false, `${label} --check 失败：\n` + String(error.stderr || error.stdout || error.message || ''))
    }
  }

  for (const rel of ['cordis.patch.yml', 'lib/client.js', 'lib/store-core.js', 'lib/ui.js', 'lib/tools.js']) {
    const bundlePath = join(root, rel)
    const rootPath = join(repoRoot, rel)
    const same = existsSync(bundlePath)
      && existsSync(rootPath)
      && Buffer.compare(readFileSync(bundlePath), readFileSync(rootPath)) === 0
    ok(same, `仓库根 ${rel} 与 packages/redteam-bundle/${rel} 100% 字节一致（防根包静默漂移）`)
  }
}

console.log('— 生成物与源码同步')
try {
  execFileSync(process.execPath, [join(root, 'tools', 'build.mjs'), '--check'], { stdio: 'pipe' })
  ok(true, 'lib/ 与三个源码包一致（跑 build.mjs 生成）')
} catch (error) {
  ok(false, 'lib/ 已漂移，需要重新运行 node packages/redteam-bundle/tools/build.mjs\n' + String(error.stdout || '') + String(error.stderr || ''))
}

console.log('— 首次启动自举（预设落地 + 占位符替换 + 幂等）')
const home = mkdtempSync(join(tmpdir(), 'lmt-bundle-'))
const prevHome = process.env.DSH_HOME
try {
  process.env.DSH_HOME = home
  const { installPreset, packagePaths } = await import('../lib/index.js')
  const first = installPreset({ log: () => {} })
  ok(first.action === 'installed', '首次启动安装预设')
  const installed = join(home, '.agent-presets', 'lmtagent', 'agent.cordis.yml')
  ok(existsSync(installed), '预设落到 $DSH_HOME/.agent-presets/lmtagent/')
  const text = readFileSync(installed, 'utf8')
  ok(!text.includes('{{LMTAGENT_SKILLS_DIR}}') && !text.includes('{{REDTEAM_SKILLS_DIR}}'), '占位符已被替换成真实路径')
  ok(text.includes(packagePaths().skills), '替换成的是包内 skills/ 绝对路径')
  /* 用户改过就不该被覆盖 */
  writeFileSync(installed, '# 用户自己改过的预设\n', 'utf8')
  const second = installPreset({ log: () => {} })
  ok(second.action === 'kept' && readFileSync(installed, 'utf8').includes('用户自己改过'), '已存在时不覆盖用户预设')
  const forced = installPreset({ force: true, log: () => {} })
  ok(forced.action === 'installed' && !readFileSync(installed, 'utf8').includes('用户自己改过'), 'LMTAGENT_PRESET_REFRESH=1 时强制覆盖')

  /* ── 发行契约：npm 包**不含**环境安装脚本（v0.12.0+ / v1.0.0）────────────────── */
  const { installSetupScript, lmtagentDataDir } = await import('../lib/index.js')
  const { isScriptShipped, isSkillShipped, OMITTED_SKILLS } = await import('../tools/distribution.mjs')
  const setupTarget = join(lmtagentDataDir(), 'setup.sh')
  ok(!existsSync(join(root, 'scripts', 'redteam-setup.sh')), 'npm 包内不含 redteam-setup.sh（发行契约）')
  ok(isScriptShipped('redteam-setup.sh') === false, '发行契约把 redteam-setup.sh 标为"不随包"')
  const s1 = installSetupScript()
  ok(s1.action === 'missing' && !existsSync(setupTarget), '包内没有脚本时安装步骤返回 missing，不写盘、不报错')
  /* 用户自己从 Release 附件解压放了一份 → 包内没有也**不许覆盖**用户那份 */
  mkdirSync(lmtagentDataDir(), { recursive: true })
  writeFileSync(setupTarget, '#!/usr/bin/env bash\n# 用户自己放的\n', { encoding: 'utf8', mode: 0o755 })
  ok(installSetupScript().action === 'missing', '用户自己放的同名脚本不受影响（不覆盖、不删除）')
  ok(readFileSync(setupTarget, 'utf8').includes('用户自己放的'), '用户自己的脚本内容原样保留')

  /* ── 坏预设自愈（v0.9.0 事故回归）──────────────────────────────────── */
  writeFileSync(installed, "- id: skill-filesystem\n  config:\n    customSkillDirs:\n      - {{LMTAGENT_SKILLS_DIR}}\n      - !!js dshHomePath('skills')\n", 'utf8')
  const healed = installPreset({ log: () => {} })
  const healedText = readFileSync(installed, 'utf8')
  ok(healed.action === 'repaired' && healed.repaired === 'placeholder', '占位符残留的预设被判为需要自愈（不再"保留不动"）')
  ok(!healedText.includes('{{LMTAGENT_SKILLS_DIR}}') && healedText.includes(packagePaths().skills), '自愈后占位符替换成包内真实路径')
  ok(healedText.includes("!!js dshHomePath('skills')"), '自愈只改技能目录那一行，其它内容保留')
  /* 包换过位置：旧的绝对路径指向不存在的目录 → 技能静默消失，同样要自愈 */
  writeFileSync(installed, "- id: skill-filesystem\n  config:\n    customSkillDirs:\n      - /old/npx/hash/node_modules/dsh-lmtagent/skills\n      - !!js dshHomePath('skills')\n", 'utf8')
  const healed2 = installPreset({ log: () => {} })
  ok(healed2.action === 'repaired' && healed2.repaired === 'stale-path', '失效的旧包路径被判为需要自愈')
  ok(readFileSync(installed, 'utf8').includes('- ' + packagePaths().skills), '失效路径被换成当前包内路径')
  /* 正常的用户预设（含自写内容）不许被动 */
  writeFileSync(installed, "- id: persona\n  config:\n    prefix: |\n      用户自己写的人设\n- id: skill-filesystem\n  config:\n    customSkillDirs:\n      - " + packagePaths().skills + "\n", 'utf8')
  const kept = installPreset({ log: () => {} })
  ok(kept.action === 'kept' && readFileSync(installed, 'utf8').includes('用户自己写的人设'), '正常的用户预设仍然原样保留（不越权改动）')
} catch (error) {
  ok(false, '自举流程抛错：' + (error && error.message))
} finally {
  if (prevHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = prevHome
  rmSync(home, { recursive: true, force: true })
}

console.log('— 迁移脚本（预发布期遗留行）')
{
  const home = mkdtempSync(join(tmpdir(), 'rt-migrate-'))
  const prev = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = home
    mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
    const patchFile = join(home, 'profiles', 'web', 'cordis.patch.yml')
    const legacy = [
      '# 用户自己的补丁',
      '- insert:',
      '    - id: redteam-store',
      '      name: dsh-redteam-store',
      '      config:',
      "        root: /tmp/x",
      '    - id: redteam-ui',
      '      name: dsh-redteam-ui',
      '',
      '- id: other-plugin',
      '  disabled: true',
      '',
    ].join('\n')
    writeFileSync(patchFile, legacy, 'utf8')
    const out = execFileSync(process.execPath, [join(root, 'lib', 'migrate-legacy-rows.mjs')], { encoding: 'utf8' })
    const text = readFileSync(patchFile, 'utf8')
    ok(!/redteam-store|redteam-ui/.test(text), '遗留的 redteam-store / redteam-ui 行被删除')
    ok(/other-plugin/.test(text) && /用户自己的补丁/.test(text), '其它行与注释原样保留')
    ok(/备份/.test(out), '写回前做了备份')
    /* 只剩遗留行时，必须写回 `[]`，否则 boot 报 "must be a top-level YAML array" */
    writeFileSync(patchFile, '- insert:\n    - id: redteam-store\n      name: dsh-redteam-store\n', 'utf8')
    execFileSync(process.execPath, [join(root, 'lib', 'migrate-legacy-rows.mjs')], { encoding: 'utf8' })
    ok(readFileSync(patchFile, 'utf8').trim() === '[]', '整份被删空时写回 []（合法空补丁）')
    const again = execFileSync(process.execPath, [join(root, 'lib', 'migrate-legacy-rows.mjs')], { encoding: 'utf8' })
    ok(/没有预发布期的遗留行/.test(again), '重复执行是幂等的')

    /* 块里带注释的遗留补丁：删掉 id 行后 `- insert:` 不能留成悬空块
       （只剩注释，YAML 会解析成 {insert: null}，boot 照样出错） */
    const withComments = [
      '# 用户自己的补丁',
      '- insert:',
      '    # 老版本的资产库行',
      '    - id: redteam-store',
      '      name: dsh-redteam-store',
      '    # 老版本的控制台行',
      '    - id: redteam-ui',
      '      name: dsh-redteam-ui',
      '',
      '- id: other-plugin',
      '  disabled: true',
      '',
    ].join('\n')
    writeFileSync(patchFile, withComments, 'utf8')
    execFileSync(process.execPath, [join(root, 'lib', 'migrate-legacy-rows.mjs')], { encoding: 'utf8' })
    const cleaned = readFileSync(patchFile, 'utf8')
    ok(!/insert:/.test(cleaned) && !/redteam-store|redteam-ui/.test(cleaned),
      '块内带注释时不留悬空的 `- insert:`')
    ok(/other-plugin/.test(cleaned), '悬空块清理后其它行仍在')
    /* 旧版脚本留下的悬空块（没有遗留行可删）也要能被自愈 */
    writeFileSync(patchFile, '# 只有注释\n- insert:\n    # 只剩注释了\n\n', 'utf8')
    execFileSync(process.execPath, [join(root, 'lib', 'migrate-legacy-rows.mjs')], { encoding: 'utf8' })
    ok(readFileSync(patchFile, 'utf8').trim() === '[]', '已是悬空块时自愈为 []（无需遗留行）')
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prev
    rmSync(home, { recursive: true, force: true })
  }
}

console.log(`\n通过 ${pass}/${pass + fail}`)
process.exit(fail === 0 ? 0 : 1)
