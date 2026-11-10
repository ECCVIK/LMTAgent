/**
 * 工程技能与开发环境可用性自检（零依赖，tools 与 UI 共用的**唯一一份**判定逻辑）
 *
 * 用途：在 LMTAgent 软件工程集群启动研发波次前，自动校验技能与本地开发工具链（Node.js / Git /
 * PostgreSQL 16+ / Playwright / 构建脚本）是否真正就绪：
 *   · 智能体侧 —— `redteam_preflight` 开工前跑一次，缺什么配置直接向用户说明或启用降级方案；
 *   · 面板侧 —— 「技能库」页签给每个工程技能标出可用性状态与一键修复指引。
 *
 * 每条问题都同时给出**修复方法**（`issues[].fix`，文案见 `skill-fixes.js`）：面板上
 * 不只是显示"哪里不可用"，而是直接给出可执行修复步骤。`problems` 保留为纯文本视图（兼容调用方）。
 *
 * 判定维度（从技能描述与正文客观读取）：
 *   ① 技能文件是否存在、正文能否正常加载；
 *   ② 必需环境变量（`os.environ["X"]` / `process.env.X`；带默认值的 `os.environ.get("X", "…")` 不算必需）；
 *   ③ 正文里引用的本机工具路径（toolkit / bin / local 下的绝对路径、`$DSH_HOME`、`~/`）；
 *   ④ 远程构建/部署节点占位符（如未替换的主机占位符）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { fixesForIssue } from './skill-fixes.js'

/** 解析 $DSH_HOME / ${DSH_HOME} / ~（技能正文里几种写法都有）。 */
export function expandSkillPath(p, env = process.env) {
  const dshHome = env.DSH_HOME || resolve(homedir(), '.dsh')
  let out = String(p).trim()
  out = out.replace(/\$\{DSH_HOME\}/g, dshHome).replace(/\$DSH_HOME/g, dshHome)
  if (out.startsWith('~/')) out = resolve(homedir(), out.slice(2))
  return out
}

/** 从技能正文里抽出"必需但没有设"的环境变量名。 */
export function requiredEnvOf(content) {
  const names = new Set()
  const body = String(content || '')
  /* Node 侧：process.env.X */
  for (const m of body.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) names.add(m[1])
  /* Python 侧：os.environ["X"] 必需；os.environ.get("X", "默认") 有兜底，不算必需 */
  for (const m of body.matchAll(/os\.environ(?:\.get)?[\[(]\s*["']([A-Z][A-Z0-9_]{2,})["']\s*(,)?/g)) {
    if (m[2] === undefined) names.add(m[1])
  }
  /* shell 侧：${X:?必填} 是显式必需；裸 $X 不判定 */
  for (const m of body.matchAll(/\$\{([A-Z][A-Z0-9_]{2,}):\?/g)) names.add(m[1])
  return Array.from(names)
}

/** 正文里引用的、可判定存在性的本机工具路径（toolkit / bin / local 下的绝对路径）。 */
export function referencedPathsOf(content) {
  const out = new Set()
  for (const m of String(content || '').matchAll(/(?:~|\$DSH_HOME|\/home\/[^\s"'`,)]+?)\/[\w./\u4e00-\u9fa5-]+/g)) {
    const raw = m[0].replace(/[，。；、：)）\]]+$/, '')
    if (!/\/(toolkit|bin|local)\//.test(raw)) continue
    if (/[<>{}*|]/.test(raw)) continue
    out.add(raw)
  }
  return Array.from(out)
}

/** 从某个技能根里读同名技能的正文（读不到返回 null）。 */
export function readSkillFromRoot(root, name) {
  if (typeof root !== 'string' || root === '') return null
  for (const dir of [root, resolve(root, String(name || ''))]) {
    for (const file of [resolve(dir, String(name || '') + '.md'), resolve(dir, 'SKILL.md')]) {
      try { if (existsSync(file)) return { path: file, content: readFileSync(file, 'utf8') } } catch { /* 继续试下一个 */ }
    }
  }
  return null
}

/** 调修复文案生成器，任何异常都退化成空串（可用性判定不能因为文案出错而中断）。 */
function safeFix(issue) {
  try { return String(fixesForIssue(issue) || '') } catch { return '' }
}

/**
 * 检查一个工程技能的可用性。
 *
 * @param skill - `{ name, description?, content?, path?, root? }`（content 是技能正文，root 是它来自哪个技能根）。
 * @param options - `{ env?: NodeJS.ProcessEnv, sameNameIn?: string[] }`。
 *   `sameNameIn` 是**其它也注册了同名技能**的根目录：同名技能会按根顺序择优，被排在后面的那份
 *   会被"盖住"。这里用它兜底识别"实际加载的是随包模板版本、而用户已配置版本排在后面"的情况。
 * @returns `{ name, status: 'available'|'broken'|'unknown', issues, problems, needs_user, checked, shadowed_by? }`
 */
export function checkSkill(skill, options = {}) {
  const env = options.env || process.env
  const name = skill && skill.name ? String(skill.name) : '(未命名)'
  const content = skill && typeof skill.content === 'string' ? skill.content : ''
  const file = skill && typeof skill.path === 'string' ? skill.path : null
  const root = skill && typeof skill.root === 'string' ? skill.root : null
  const issues = []
  const needsUser = []
  /** 记一条问题：detail 是给用户看的"不可用原因"，fix 是"怎么修"（见 skill-fixes.js）。 */
  const addIssue = (kind, detail, extra) => {
    const payload = Object.assign({ kind, skill: name }, extra || {})
    let fix = ''
    try { fix = String(fixesForIssue(payload) || '') } catch { fix = '' }
    issues.push(Object.assign({ kind, detail, fix }, extra || {}))
  }

  if (content.trim() === '') {
    const detail = '技能正文读不到（只有元数据）：无法判断可用性，需要时用 `skill` 工具实际加载一次'
    return {
      name,
      status: 'unknown',
      issues: [{ kind: 'content-missing', detail, fix: safeFix({ kind: 'content-missing', skill: name }) }],
      problems: [detail],
      needs_user: [],
      checked: { file, env: [], paths: [] },
    }
  }
  if (file !== null && !existsSync(file)) addIssue('file-missing', '技能文件不存在：' + file, { file })

  const envNames = requiredEnvOf(content)
  const missingEnv = envNames.filter((n) => !env[n])
  for (const n of missingEnv) {
    addIssue('env-missing', '缺环境变量 ' + n, { env: n })
  }

  const paths = referencedPathsOf(content)
  const missingPaths = paths.filter((p) => !existsSync(expandSkillPath(p, env)))
  if (missingPaths.length > 0) {
    addIssue('path-missing', '引用的本机路径不存在：' + missingPaths.slice(0, 6).join('、')
      + (missingPaths.length > 6 ? ' 等 ' + missingPaths.length + ' 处' : ''), { paths: missingPaths })
  }

  /* 远程主机/节点配置占位符检测：若环境变量已配置则视为就绪，否则提示补齐配置。 */
  const remoteConfigured = (typeof env.LMT_REMOTE_HOST === 'string' && env.LMT_REMOTE_HOST.trim() !== '')
    || (typeof env.REDTEAM_VPS_HOST === 'string' && env.REDTEAM_VPS_HOST.trim() !== '')
  const placeholders = []
  if (!remoteConfigured) {
    if (content.includes('<你的VPS_IP>') || content.includes('<VPS_IP>')) placeholders.push('VPS 地址')
    if (content.includes('<你的VPS_主机名>') || content.includes('<VPS 主机名>')) placeholders.push('VPS 主机名')
    if (content.includes('<REMOTE_HOST>') || content.includes('<远程节点_IP>')) placeholders.push('远程构建节点地址')
  }
  for (const p of placeholders) {
    addIssue('placeholder', p + '还是占位符（技能里写的是占位符，说明本机/本环境还没配）', { placeholder: p })
    needsUser.push(p)
  }
  for (const n of missingEnv) needsUser.push('环境变量 ' + n)

  /* 兜底：同名技能在别的根里有一份"问题更少"的版本（被排在前面的随包模板版本盖住）。 */
  let shadowed = null
  for (const other of Array.isArray(options.sameNameIn) ? options.sameNameIn : []) {
    if (other === root) continue
    const alt = readSkillFromRoot(other, name)
    if (alt === null || alt.content === content) continue
    const verdict = checkSkill({ name, content: alt.content, path: alt.path }, { env })
    if (verdict.status === 'available' || verdict.problems.length < issues.length) {
      shadowed = { root: other, path: alt.path, status: verdict.status }
      addIssue('shadowed', '`' + other + '` 里还有一份同名技能（' + verdict.status + '），'
        + '但按技能根顺序当前加载的是这一份（上面这些不可用原因来自这一份）', { other_root: other })
      break
    }
  }

  return {
    name,
    status: issues.length === 0 ? 'available' : 'broken',
    issues,
    problems: issues.map((x) => x.detail),
    needs_user: Array.from(new Set(needsUser)),
    ...(shadowed === null ? {} : { shadowed_by: shadowed.root, shadowed_path: shadowed.path }),
    checked: { file, env: envNames, missing_env: missingEnv, paths, missing_paths: missingPaths },
  }
}

/** 汇总一批技能的状态（面板顶部标签与 preflight 的返回值都用它）。 */
export function summarizeSkills(results) {
  const out = { total: results.length, available: 0, broken: 0, unknown: 0 }
  for (const r of results) out[r.status] = (out[r.status] || 0) + 1
  return out
}
