/**
 * dsh-lmtagent —— 插件自举（host 半侧）
 *
 * 这个包是**自包含**的：工程事实库、精简工具集、双语控制台、预设、干净工程技能全在包内，
 * 与历史包 `dsh-redteam-mode` 完全独立命名空间，可共存安装。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Cordis 插件名。 */
export const name = 'lmtagent-mode'

/** 无硬依赖：即使 skills 服务缺失也不该阻断挂载。 */
export const inject = []

/** 本包根目录（从模块位置解析，装到哪个 profile / 哪个路径都对）。 */
export function packagePaths() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  return {
    root,
    presets: join(root, 'presets'),
    presetDir: join(root, 'presets', 'lmtagent'),
    skills: join(root, 'skills'),
    setupScript: join(root, 'scripts', 'redteam-setup.sh'),
  }
}

/** 环境数据目录（默认 $DSH_HOME/lmtagent）。 */
export function lmtagentDataDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'lmtagent')
}

export { lmtagentDataDir as redteamDataDir }

/**
 * 历史环境安装脚本已于 v0.12.0 移出分发包，此函数保留为空操作返回 `{ action: 'missing', path }`。
 */
export function installSetupScript() {
  return { action: 'missing', path: join(lmtagentDataDir(), 'setup.sh') }
}

/** 用户 preset 根（DSH < 0.1.7 兼容目录）。 */
export function userPresetRoot() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, '.agent-presets')
}

/** 预设模板里技能目录的占位符（build.mjs 写进打包预设，落地时才替换）。 */
const SKILLS_PLACEHOLDER = '{{LMTAGENT_SKILLS_DIR}}'
const LEGACY_PLACEHOLDER = '{{REDTEAM_SKILLS_DIR}}'

/** customSkillDirs 里指向本包或旧包 skills/ 目录的那一行。 */
function isSkillsDirLine(line) {
  const text = line.trim().replace(/^-\s*/, '')
  if (text === SKILLS_PLACEHOLDER || text === LEGACY_PLACEHOLDER) return true
  return /[/\\](dsh-lmtagent|dsh-redteam-mode|redteam-bundle)[/\\]skills\/?$/.test(text)
}

function renderSkillsDir(text, skillsDir) {
  if (text.includes(SKILLS_PLACEHOLDER)) {
    return { text: text.split(SKILLS_PLACEHOLDER).join(skillsDir), changed: true, reason: 'placeholder' }
  }
  if (text.includes(LEGACY_PLACEHOLDER)) {
    return { text: text.split(LEGACY_PLACEHOLDER).join(skillsDir), changed: true, reason: 'placeholder' }
  }
  let changed = false
  const out = text.split('\n').map((line) => {
    if (!isSkillsDirLine(line)) return line
    const indent = /^(\s*)/.exec(line)[1]
    const wanted = indent + '- ' + skillsDir
    if (line === wanted) return line
    changed = true
    return wanted
  }).join('\n')
  return { text: out, changed, reason: changed ? 'stale-path' : 'none' }
}

/**
 * 把包内预设落地到用户 preset 根（仅老版本 DSH < 0.1.7 兼容路径，带占位符自愈）。
 */
export function installPreset(options = {}) {
  const paths = packagePaths()
  const target = join(userPresetRoot(), 'lmtagent')
  const log = options.log ?? (() => {})
  const skillCount = existsSync(paths.skills)
    ? readdirSync(paths.skills).filter((f) => f.endsWith('.md')).length
    : 0
  const presetFile = join(target, 'agent.cordis.yml')

  if (existsSync(presetFile) && options.force !== true) {
    let text
    try {
      text = readFileSync(presetFile, 'utf8')
    } catch (error) {
      log(`读取 ${presetFile} 失败：${error && error.message ? error.message : String(error)}`)
      return { action: 'kept', dir: target, skillsDir: paths.skills, skills: skillCount }
    }
    const rendered = renderSkillsDir(text, paths.skills)
    if (rendered.changed) {
      writeFileSync(presetFile, rendered.text, 'utf8')
      log(
        (rendered.reason === 'placeholder'
          ? '预设里还留着 ' + SKILLS_PLACEHOLDER
          : '预设里的技能目录指向已失效的旧包路径')
        + `，已就地修正为 ${paths.skills}`,
      )
      return {
        action: 'repaired', dir: target, skillsDir: paths.skills, skills: skillCount,
        repaired: rendered.reason,
      }
    }
    log(`已存在用户自己的预设 ${target}，保留不动（要覆盖：LMTAGENT_PRESET_REFRESH=1 启动一次）`)
    return { action: 'kept', dir: target, skillsDir: paths.skills, skills: skillCount }
  }

  mkdirSync(target, { recursive: true })
  for (const file of readdirSync(paths.presetDir)) {
    const text = readFileSync(join(paths.presetDir, file), 'utf8')
    writeFileSync(join(target, file), renderSkillsDir(text, paths.skills).text, 'utf8')
  }
  log(`预设已安装到 ${target}（打包技能 ${skillCount} 个：${paths.skills}）`)
  return { action: 'installed', dir: target, skillsDir: paths.skills, skills: skillCount }
}

/** @param ctx - 插件上下文。 */
export function apply(ctx) {
  const paths = packagePaths()
  let result
  const forceRefresh = process.env.LMTAGENT_PRESET_REFRESH === '1' || process.env.REDTEAM_PRESET_REFRESH === '1'
  const enableLegacy = process.env.LMTAGENT_LEGACY_PRESET === '1' || process.env.REDTEAM_LEGACY_PRESET === '1'
  if (enableLegacy || forceRefresh) {
    try {
      result = installPreset({
        force: forceRefresh,
        log: (msg) => ctx.logger?.info?.('lmtagent-mode: ' + msg),
      })
    } catch (error) {
      ctx.logger?.error?.('lmtagent-mode: 预设安装失败：%s', error && error.message ? error.message : String(error))
      result = { action: 'failed', dir: join(userPresetRoot(), 'lmtagent'), skillsDir: paths.skills, skills: 0 }
    }
  } else {
    result = { action: 'skipped', dir: join(userPresetRoot(), 'lmtagent'), skillsDir: paths.skills, skills: 0 }
  }
  const setupResult = installSetupScript()
  ctx.provide('lmtagentMode', Object.freeze({ paths, preset: result, setup: setupResult }))
  ctx.logger?.info?.(
    'lmtagent-mode: 就绪（数据目录默认 $DSH_HOME/lmtagent；预设 %s；技能目录 %s）',
    result.dir, result.skillsDir,
  )
}

export default { name, inject, apply }
