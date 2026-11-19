/**
 * File-Disjoint Sharding 路径归一化、Glob 重叠判定、事前写盘校验与事后越界审计（零依赖）。
 */

export function normalizeShardPattern(raw) {
  return String(raw || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
}

function shardGlobToRegExp(pat) {
  const norm = normalizeShardPattern(pat)
  if (!norm) return /^$/
  if (norm === '*' || norm === '**' || norm === '**/*') return /^.+$/
  const effective = norm.endsWith('/') ? norm + '**' : norm
  let re = '^'
  for (let i = 0; i < effective.length; i += 1) {
    const ch = effective[i]
    if (ch === '*' && effective[i + 1] === '*') {
      if (effective[i + 2] === '/') {
        re += '(?:.+/)?'
        i += 2
      } else {
        re += '.*'
        i += 1
      }
    } else if (ch === '*') {
      re += '[^/]*'
    } else if (ch === '?') {
      re += '[^/]'
    } else if ('+.^$()[]{}|\\'.includes(ch)) {
      re += '\\' + ch
    } else {
      re += ch
    }
  }
  if (!/[*?]/.test(norm) && !norm.endsWith('/') && !/\.[a-zA-Z0-9]+$/.test(norm.split('/').pop() || '')) {
    re += '(?:$|/.+)'
  } else {
    re += '$'
  }
  return new RegExp(re)
}

export function fileMatchesShardPattern(filePath, pattern) {
  const f = normalizeShardPattern(filePath)
  const p = normalizeShardPattern(pattern)
  if (!f || !p) return false
  if (f === p) return true
  return shardGlobToRegExp(p).test(f)
}

function shardStaticPrefix(pat) {
  const norm = normalizeShardPattern(pat)
  const idx = norm.search(/[*?]/)
  if (idx < 0) {
    if (norm.endsWith('/')) return norm
    if (!/\.[a-zA-Z0-9]+$/.test(norm.split('/').pop() || '')) return norm + '/'
    return norm
  }
  return norm.slice(0, idx)
}

export function shardPatternsOverlap(patA, patB) {
  const a = normalizeShardPattern(patA)
  const b = normalizeShardPattern(patB)
  if (!a || !b) return false
  if (a === b) return true
  if (fileMatchesShardPattern(a, b) || fileMatchesShardPattern(b, a)) return true
  const prefA = shardStaticPrefix(a)
  const prefB = shardStaticPrefix(b)
  if (prefA.startsWith(prefB) || prefB.startsWith(prefA)) {
    const deeper = prefA.length >= prefB.length ? prefA : prefB
    const baseDir = deeper.endsWith('/') ? deeper : deeper.replace(/[^/]*$/, '')
    const extMatchA = /\.([a-zA-Z0-9]+)$/.exec(a)
    const extMatchB = /\.([a-zA-Z0-9]+)$/.exec(b)
    if (extMatchA && extMatchB && extMatchA[1].toLowerCase() !== extMatchB[1].toLowerCase()) {
      return false
    }
    const ext = (extMatchA && extMatchA[1]) || (extMatchB && extMatchB[1]) || 'js'
    const probes = [
      `${baseDir}index.${ext}`,
      `${baseDir}sub/index.${ext}`,
      `${deeper}${deeper.endsWith('/') ? 'file.' + ext : ''}`,
    ]
    for (const sample of probes) {
      if (fileMatchesShardPattern(sample, a) && fileMatchesShardPattern(sample, b)) return true
    }
    if ((a.includes('**') || a.endsWith('/')) && (b.includes('**') || b.endsWith('/'))) {
      return true
    }
  }
  return false
}

/**
 * 审计 Worker 实际触碰文件是否越出其声明的 `files_owned` 分片边界。
 * 当 `filesOwned` 为空时视为未声明分片约束，返回 `{ scope_ok: true, scope_violations: [] }`。
 */
export function auditWorkerScopeViolation(filesOwned, filesTouched) {
  const ownedList = (Array.isArray(filesOwned) ? filesOwned : [])
    .map((p) => normalizeShardPattern(p))
    .filter(Boolean)
  if (ownedList.length === 0) {
    return { scope_ok: true, scope_violations: [] }
  }
  const touchedList = Array.isArray(filesTouched) ? filesTouched : []
  const violations = []
  const seen = new Set()
  for (const rawFile of touchedList) {
    const normFile = normalizeShardPattern(rawFile)
    if (!normFile || seen.has(normFile)) continue
    const matched = ownedList.some((pat) => (
      fileMatchesShardPattern(normFile, pat)
      || (pat.endsWith('/*') && fileMatchesShardPattern(normFile, pat.slice(0, -2) + '/**'))
    ))
    if (!matched) {
      seen.add(normFile)
      violations.push(normFile)
    }
  }
  return {
    scope_ok: violations.length === 0,
    scope_violations: violations,
  }
}

/**
 * 事前写盘分片门禁：校验候选文件路径是否落在自身 `filesOwned` 内，且未被其他活跃 Worker 的独占锁占用。
 */
export function checkFileAgainstShardLocks(filesOwned = [], activeLocks = [], workerName = '', candidatePath = '') {
  const normFile = normalizeShardPattern(candidatePath)
  if (!normFile) {
    return {
      allowed: false,
      reason: 'empty_path',
      candidate_path: '',
      conflicting_lock: null,
    }
  }
  const selfName = String(workerName || '').trim().toLowerCase()
  const locks = Array.isArray(activeLocks) ? activeLocks : []
  for (const lock of locks) {
    if (!lock || String(lock.status || 'active').toLowerCase() !== 'active') continue
    const owner = String(lock.worker_name || lock.workerName || '').trim().toLowerCase()
    if (selfName && owner === selfName) continue
    const pat = normalizeShardPattern(lock.file_pattern || lock.pattern || '')
    if (!pat) continue
    const hit = fileMatchesShardPattern(normFile, pat)
      || (pat.endsWith('/*') && fileMatchesShardPattern(normFile, pat.slice(0, -2) + '/**'))
    if (hit) {
      return {
        allowed: false,
        reason: 'locked_by_other',
        candidate_path: normFile,
        conflicting_lock: {
          worker_name: lock.worker_name || lock.workerName || '',
          file_pattern: pat,
          wave: lock.wave || '',
        },
      }
    }
  }

  const ownedList = (Array.isArray(filesOwned) ? filesOwned : [])
    .map((p) => normalizeShardPattern(p))
    .filter(Boolean)
  if (ownedList.length > 0) {
    const inOwned = ownedList.some((pat) => (
      fileMatchesShardPattern(normFile, pat)
      || (pat.endsWith('/*') && fileMatchesShardPattern(normFile, pat.slice(0, -2) + '/**'))
    ))
    if (!inOwned) {
      return {
        allowed: false,
        reason: 'outside_files_owned',
        candidate_path: normFile,
        conflicting_lock: null,
      }
    }
  }

  return {
    allowed: true,
    reason: 'in_owned_scope',
    candidate_path: normFile,
    conflicting_lock: null,
  }
}
