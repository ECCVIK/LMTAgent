/**
 * LMTAgent Host Bridge — 越界写入 Git 安全回滚子系统（零外部依赖）
 *
 * 严格约束：
 *   - 全程使用 `execFileSync('git', argvArray, ...)`，绝不拼接 shell 字符串，杜绝命令注入；
 *   - `sanitizeRepoRelativePath` 拒绝空路径、空字节、Windows 盘符、前导斜杠与 `..` 路径穿越；
 *   - 仅当 `allowDeleteUntracked === true` 时才删除未追踪文件，默认保留并在 `skipped_untracked` 中报告。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, unlinkSync } from 'node:fs'
import { isAbsolute, posix, relative, resolve } from 'node:path'

/**
 * 校验并规范化仓库内相对路径，严防路径穿越与盘符/绝对路径注入。
 * 合法时返回规范化后的 POSIX 相对路径字符串；非法时返回 `{ ok: false, reason, raw }`。
 *
 * @param {string} gitRoot
 * @param {string} rawRelPath
 * @returns {string | { ok: false, reason: string, raw: unknown }}
 */
export function sanitizeRepoRelativePath(gitRoot, rawRelPath) {
  if (typeof gitRoot !== 'string' || !gitRoot.trim()) {
    return { ok: false, reason: 'invalid_git_root', raw: rawRelPath }
  }
  if (typeof rawRelPath !== 'string') {
    return { ok: false, reason: 'empty_path', raw: rawRelPath }
  }
  if (rawRelPath.includes('\0')) {
    return { ok: false, reason: 'null_byte', raw: rawRelPath }
  }

  const trimmed = rawRelPath.trim()
  if (!trimmed) {
    return { ok: false, reason: 'empty_path', raw: rawRelPath }
  }
  if (/^[A-Za-z]:/.test(trimmed)) {
    return { ok: false, reason: 'windows_drive_letter', raw: rawRelPath }
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('\\') || isAbsolute(trimmed)) {
    return { ok: false, reason: 'leading_slash_or_absolute', raw: rawRelPath }
  }

  let norm = trimmed.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  while (norm.startsWith('./')) {
    norm = norm.slice(2)
  }
  norm = norm.replace(/\/+$/, '')
  if (!norm || norm === '.') {
    return { ok: false, reason: 'empty_path', raw: rawRelPath }
  }

  const rawSegments = norm.split('/')
  if (rawSegments.some((seg) => seg === '..')) {
    return { ok: false, reason: 'path_traversal', raw: rawRelPath }
  }

  const posixNorm = posix.normalize(norm).replace(/^\/+/, '').replace(/\/+$/, '')
  if (!posixNorm || posixNorm === '.' || posixNorm.split('/').some((seg) => seg === '..')) {
    return { ok: false, reason: 'path_traversal', raw: rawRelPath }
  }
  if (/^[A-Za-z]:/.test(posixNorm)) {
    return { ok: false, reason: 'windows_drive_letter', raw: rawRelPath }
  }

  const resolvedRoot = resolve(gitRoot)
  const resolvedTarget = resolve(resolvedRoot, posixNorm)
  const relFromRoot = relative(resolvedRoot, resolvedTarget)
  if (!relFromRoot || relFromRoot === '.' || relFromRoot.startsWith('..') || isAbsolute(relFromRoot)) {
    return { ok: false, reason: 'outside_git_root', raw: rawRelPath }
  }

  /* 若根目录与目标路径均已在磁盘存在，额外校验 realpath 防止符号链接跳出仓库边界。 */
  try {
    if (existsSync(resolvedRoot) && existsSync(resolvedTarget)) {
      const realRoot = realpathSync(resolvedRoot)
      const realTarget = realpathSync(resolvedTarget)
      const realRel = relative(realRoot, realTarget)
      if (!realRel || realRel === '.' || realRel.startsWith('..') || isAbsolute(realRel)) {
        return { ok: false, reason: 'symlink_outside_git_root', raw: rawRelPath }
      }
    }
  } catch { /* ignore stat/realpath edge errors */ }

  return relFromRoot.replace(/\\/g, '/')
}

/**
 * 安全回滚越界修改的文件（已追踪文件执行 `git checkout --`，未追踪文件默认跳过除非 `allowDeleteUntracked === true`）。
 *
 * @param {object} options
 * @param {string} options.cwd
 * @param {string[]} [options.files]
 * @param {boolean} [options.allowDeleteUntracked]
 */
export function rollbackScopeViolations({ cwd, files = [], allowDeleteUntracked = false } = {}) {
  const workDir = typeof cwd === 'string' && cwd.trim() ? resolve(cwd.trim()) : ''
  if (!workDir || !existsSync(workDir)) {
    return {
      ok: false,
      error: '无效的工作区目录（cwd 不存在或为空）',
      git_root: null,
      rolled_back: [],
      skipped_untracked: [],
      rejected_paths: [],
    }
  }

  let gitRoot = ''
  try {
    const rawTop = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: workDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    gitRoot = resolve(String(rawTop || '').trim())
  } catch (err) {
    return {
      ok: false,
      error: `当前目录不是有效的 Git 仓库：${err && err.message ? err.message : String(err)}`,
      git_root: null,
      rolled_back: [],
      skipped_untracked: [],
      rejected_paths: [],
    }
  }

  const candidateList = Array.isArray(files) ? files : []
  const rejectedPaths = []
  const validPaths = []
  const seen = new Set()

  for (const rawFile of candidateList) {
    const sanitized = sanitizeRepoRelativePath(gitRoot, rawFile)
    if (typeof sanitized !== 'string') {
      rejectedPaths.push({
        path: typeof rawFile === 'string' ? rawFile : String(rawFile ?? ''),
        raw: sanitized && sanitized.raw !== undefined ? sanitized.raw : rawFile,
        reason: (sanitized && sanitized.reason) || 'invalid_path',
      })
      continue
    }
    if (!seen.has(sanitized)) {
      seen.add(sanitized)
      validPaths.push(sanitized)
    }
  }

  const tracked = []
  const untracked = []
  for (const rel of validPaths) {
    let isTracked = false
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', rel], {
        cwd: gitRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      isTracked = true
    } catch {
      isTracked = false
    }
    if (isTracked) tracked.push(rel)
    else untracked.push(rel)
  }

  const rolledBack = []
  const skippedUntracked = []

  if (tracked.length > 0) {
    try {
      execFileSync('git', ['checkout', '--', ...tracked], {
        cwd: gitRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      rolledBack.push(...tracked)
    } catch (err) {
      return {
        ok: false,
        error: `git checkout 回滚失败：${err && err.message ? err.message : String(err)}`,
        git_root: gitRoot,
        rolled_back: rolledBack,
        skipped_untracked: skippedUntracked,
        rejected_paths: rejectedPaths,
      }
    }
  }

  for (const rel of untracked) {
    const absTarget = resolve(gitRoot, rel)
    if (allowDeleteUntracked === true) {
      if (existsSync(absTarget)) {
        try {
          unlinkSync(absTarget)
          rolledBack.push(rel)
        } catch (err) {
          rejectedPaths.push({
            path: rel,
            raw: rel,
            reason: `unlink_failed: ${err && err.message ? err.message : String(err)}`,
          })
        }
      } else {
        skippedUntracked.push(rel)
      }
    } else {
      skippedUntracked.push(rel)
    }
  }

  return {
    ok: true,
    git_root: gitRoot,
    rolled_back: rolledBack,
    skipped_untracked: skippedUntracked,
    rejected_paths: rejectedPaths,
  }
}
