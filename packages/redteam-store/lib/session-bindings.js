/**
 * 会话 → 工作区 1:1 状态机持久化与平滑目录迁移（零依赖）。
 *
 * 包含：
 *   - `migrateLegacyRedteamDir`：首次启用 `$DSH_HOME/lmtagent` 时，若目录下尚无工作区/绑定，
 *     无损复制同级 `$DSH_HOME/redteam/{settings.json,sessions.json,current,engagements/}` 并落 `.migrated-from-redteam` 标记。
 *   - `attachSessionBindingMethods`：带 mtimeMs 内存缓存的 `sessions.json` 状态机方法集，挂载至 Store 原型。
 */
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { nowIso } from './ip-utils.js'

const VALID_INIT_STATES = ['uninitialized', 'skipped', 'initialized']

function copyDirRecursiveNonDestructive(srcDir, dstDir) {
  if (!existsSync(srcDir)) return 0
  let copied = 0
  mkdirSync(dstDir, { recursive: true })
  const entries = readdirSync(srcDir, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(srcDir, entry.name)
    const dstPath = join(dstDir, entry.name)
    if (entry.isDirectory()) {
      copied += copyDirRecursiveNonDestructive(srcPath, dstPath)
    } else if (entry.isFile() && !existsSync(dstPath)) {
      copyFileSync(srcPath, dstPath)
      copied += 1
    }
  }
  return copied
}

/**
 * 若目标根目录为 `.../lmtagent` 且尚未包含 `engagements/`（或仅有空目录）及 `sessions.json`，
 * 检查同级 `../redteam`；若存在旧版数据则无损复制并写入 `.migrated-from-redteam`。
 */
export function migrateLegacyRedteamDir(targetRoot, _env = process.env) {
  try {
    if (typeof targetRoot !== 'string' || !targetRoot.trim()) return { migrated: false, reason: 'invalid_target' }
    const normTarget = targetRoot.replace(/[\\/]+$/, '')
    if (basename(normTarget).toLowerCase() !== 'lmtagent') {
      return { migrated: false, reason: 'non_lmtagent_root' }
    }
    const markerPath = join(normTarget, '.migrated-from-redteam')
    if (existsSync(markerPath)) return { migrated: false, reason: 'already_migrated' }

    const targetSessions = join(normTarget, 'sessions.json')
    const targetEngDir = join(normTarget, 'engagements')
    let hasExistingEng = false
    if (existsSync(targetEngDir)) {
      try {
        hasExistingEng = readdirSync(targetEngDir, { withFileTypes: true }).some((e) => e.isDirectory())
      } catch { hasExistingEng = false }
    }
    if (existsSync(targetSessions) || hasExistingEng) {
      return { migrated: false, reason: 'target_non_empty' }
    }

    const legacyRoot = join(dirname(normTarget), 'redteam')
    if (!existsSync(legacyRoot)) return { migrated: false, reason: 'no_legacy_dir' }

    const legacyEngDir = join(legacyRoot, 'engagements')
    const legacyHasEng = existsSync(legacyEngDir)
      && readdirSync(legacyEngDir, { withFileTypes: true }).some((e) => e.isDirectory())
    const legacyHasData = legacyHasEng
      || existsSync(join(legacyRoot, 'sessions.json'))
      || existsSync(join(legacyRoot, 'settings.json'))
    if (!legacyHasData) return { migrated: false, reason: 'legacy_empty' }

    mkdirSync(normTarget, { recursive: true })
    let filesCopied = 0
    for (const fname of ['settings.json', 'sessions.json', 'current']) {
      const srcFile = join(legacyRoot, fname)
      const dstFile = join(normTarget, fname)
      if (existsSync(srcFile) && !existsSync(dstFile)) {
        copyFileSync(srcFile, dstFile)
        filesCopied += 1
      }
    }
    if (legacyHasEng) {
      filesCopied += copyDirRecursiveNonDestructive(legacyEngDir, targetEngDir)
    }
    writeFileSync(
      markerPath,
      JSON.stringify({ migrated_at: nowIso(), source: legacyRoot, files_copied: filesCopied }, null, 2) + '\n',
      'utf8',
    )
    return { migrated: true, source: legacyRoot, target: normTarget, files_copied: filesCopied }
  } catch (err) {
    return { migrated: false, reason: 'error', error: err && err.message ? err.message : String(err) }
  }
}

function readSessionStateRecordsCached(store) {
  const filePath = store.sessionBindingsPath()
  let st = null
  try {
    st = statSync(filePath)
  } catch {
    if (store._sessionCache) store._sessionCache = null
    return {}
  }
  const cache = store._sessionCache
  if (cache && cache.path === filePath && cache.mtimeMs === st.mtimeMs && cache.size === st.size) {
    return cache.records
  }
  let parsed = null
  try { parsed = JSON.parse(readFileSync(filePath, 'utf8')) } catch { parsed = null }
  const agents = parsed && parsed.agents && typeof parsed.agents === 'object' ? parsed.agents : {}
  const out = {}
  for (const [key, value] of Object.entries(agents)) {
    if (!key || !value || typeof value !== 'object') continue
    const rawEng = typeof value.engagement === 'string' && value.engagement.trim() ? value.engagement.trim() : null
    const engValid = Boolean(rawEng && existsSync(store.dbPathOf(rawEng)))
    const engagement = engValid ? rawEng : null
    const name = engagement
      ? (typeof value.name === 'string' && value.name.trim() ? value.name.trim() : engagement)
      : null
    const rawInit = typeof value.init_state === 'string' ? value.init_state.trim() : ''
    const validInit = VALID_INIT_STATES.includes(rawInit) ? rawInit : ''
    const initState = engagement
      ? (validInit || 'initialized')
      : (validInit && validInit !== 'initialized' ? validInit : 'uninitialized')
    const onboardingDismissed = typeof value.onboarding_dismissed === 'boolean'
      ? (rawEng && !engValid ? false : value.onboarding_dismissed)
      : Boolean(engagement)
    const updatedAt = typeof value.updated_at === 'string' && value.updated_at
      ? value.updated_at
      : (typeof value.at === 'string' && value.at ? value.at : null)
    out[key] = {
      engagement,
      name,
      session_title: typeof value.session_title === 'string' && value.session_title ? value.session_title : null,
      cwd: typeof value.cwd === 'string' && value.cwd ? value.cwd : null,
      init_state: initState,
      onboarding_dismissed: onboardingDismissed,
      has_conversation: Boolean(value.has_conversation),
      updated_at: updatedAt,
      at: updatedAt,
    }
  }
  store._sessionCache = { path: filePath, mtimeMs: st.mtimeMs, size: st.size, records: out }
  return out
}

function writeSessionStateRecords(store, records) {
  const entries = Object.entries(records || {})
    .filter(([key, val]) => Boolean(key && val && typeof val === 'object'))
    .sort((a, b) => String(b[1].updated_at || b[1].at || '').localeCompare(String(a[1].updated_at || a[1].at || '')))
    .slice(0, 200)
  const pruned = {}
  for (const [key, value] of entries) {
    if (value.engagement && !existsSync(store.dbPathOf(value.engagement))) {
      continue
    }
    pruned[key] = value
  }
  mkdirSync(store.root, { recursive: true })
  const filePath = store.sessionBindingsPath()
  try {
    writeFileSync(filePath, JSON.stringify({ v: 1, agents: pruned }, null, 2), 'utf8')
    store._sessionCache = null
    if (typeof store._bumpWriteSeq === 'function') store._bumpWriteSeq(null, 'sessions')
    return true
  } catch {
    store._sessionCache = null
    return false
  }
}

/** 将会话 1:1 绑定与状态机方法挂载到 Store 原型上。 */
export function attachSessionBindingMethods(StoreClass) {
  const methods = {
    sessionBindingsPath() { return join(this.root, 'sessions.json') },

    sessionStates() {
      return readSessionStateRecordsCached(this)
    },

    listSessionBindings() {
      return readSessionStateRecordsCached(this)
    },

    sessionBindings() {
      const records = readSessionStateRecordsCached(this)
      const out = {}
      for (const [key, value] of Object.entries(records)) {
        if (!value || !value.engagement) continue
        out[key] = {
          engagement: value.engagement,
          name: value.name || value.engagement,
          session_title: value.session_title,
          cwd: value.cwd,
          init_state: value.init_state,
          onboarding_dismissed: value.onboarding_dismissed,
          has_conversation: value.has_conversation,
          updated_at: value.updated_at,
          at: value.updated_at,
        }
      }
      return out
    },

    sessionBinding(sessionId) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return undefined
      const entry = this.sessionBindings()[sessionId]
      return entry ? entry.engagement : undefined
    },

    getSessionState(sessionId) {
      const sid = typeof sessionId === 'string' ? sessionId.trim() : ''
      const records = sid ? readSessionStateRecordsCached(this) : {}
      const entry = sid ? records[sid] : null
      const bound = (entry && entry.engagement) || null
      const explicitInit = entry && typeof entry.init_state === 'string' ? entry.init_state : ''
      const initState = bound
        ? (explicitInit || 'initialized')
        : (explicitInit && explicitInit !== 'initialized' ? explicitInit : 'uninitialized')
      const onboardingDismissed = entry && typeof entry.onboarding_dismissed === 'boolean'
        ? entry.onboarding_dismissed
        : Boolean(bound)
      return {
        session: sid || null,
        bound,
        name: bound ? (entry?.name || bound) : null,
        session_title: entry?.session_title || null,
        cwd: entry?.cwd || null,
        init_state: initState,
        onboarding_dismissed: onboardingDismissed,
        has_conversation: Boolean(entry?.has_conversation),
        updated_at: entry?.updated_at || null,
      }
    },

    setSessionBinding(sessionId, engagement, name, meta = {}) {
      if (typeof sessionId !== 'string' || sessionId.trim().length === 0) return false
      if (typeof engagement !== 'string' || engagement.trim().length === 0) return false
      const sid = sessionId.trim()
      const engId = engagement.trim()
      if (!existsSync(this.dbPathOf(engId))) return false
      const all = Object.assign({}, readSessionStateRecordsCached(this))
      const prev = all[sid] || null
      const ts = nowIso()
      const nextTitle = meta && (meta.title !== undefined || meta.session_title !== undefined)
        ? (String(meta.title ?? meta.session_title ?? '').trim() || null)
        : (prev?.session_title || null)
      const nextCwd = meta && meta.cwd !== undefined
        ? (String(meta.cwd || '').trim() || null)
        : (prev?.cwd || null)
      const nextHasConv = meta && (meta.hasConversation !== undefined || meta.has_conversation !== undefined)
        ? Boolean(meta.hasConversation ?? meta.has_conversation)
        : Boolean(prev?.has_conversation)
      all[sid] = {
        engagement: engId,
        name: typeof name === 'string' && name.trim() ? name.trim() : engId,
        session_title: nextTitle,
        cwd: nextCwd,
        init_state: 'initialized',
        onboarding_dismissed: true,
        has_conversation: nextHasConv,
        updated_at: ts,
        at: ts,
      }
      return writeSessionStateRecords(this, all)
    },

    setSessionOnboarding(sessionId, payload = {}) {
      const sid = typeof sessionId === 'string' ? sessionId.trim() : ''
      if (!sid) return null
      const opts = payload && typeof payload === 'object' ? payload : {}
      const action = String(opts.action || 'sync').trim().toLowerCase()
      const all = Object.assign({}, readSessionStateRecordsCached(this))
      const prev = all[sid] || null
      const ts = nowIso()

      const sessionTitle = opts.title !== undefined || opts.session_title !== undefined
        ? (String(opts.title ?? opts.session_title ?? '').trim() || null)
        : (prev?.session_title || null)
      const cwd = opts.cwd !== undefined
        ? (String(opts.cwd || '').trim() || null)
        : (prev?.cwd || null)
      const hasConversation = opts.hasConversation !== undefined || opts.has_conversation !== undefined
        ? Boolean(opts.hasConversation ?? opts.has_conversation)
        : Boolean(prev?.has_conversation)

      let engagement = prev?.engagement || null
      let name = prev?.name || null
      let initState = prev?.init_state || (engagement ? 'initialized' : 'uninitialized')
      let onboardingDismissed = typeof prev?.onboarding_dismissed === 'boolean'
        ? prev.onboarding_dismissed
        : Boolean(engagement)

      const requestedEng = typeof opts.engagement === 'string' && opts.engagement.trim()
        ? opts.engagement.trim()
        : null
      const requestedEngValid = Boolean(requestedEng && existsSync(this.dbPathOf(requestedEng)))

      if (action === 'skip') {
        if (requestedEngValid) {
          const metaEng = this.listEngagements().find((e) => e.id === requestedEng)
          engagement = requestedEng
          name = (typeof opts.name === 'string' && opts.name.trim()) || (metaEng && metaEng.name) || requestedEng
        } else {
          engagement = null
          name = null
        }
        initState = 'skipped'
        onboardingDismissed = true
      } else if (action === 'reopen') {
        if (requestedEngValid) {
          const metaEng = this.listEngagements().find((e) => e.id === requestedEng)
          engagement = requestedEng
          name = (typeof opts.name === 'string' && opts.name.trim()) || (metaEng && metaEng.name) || requestedEng
        }
        initState = 'uninitialized'
        onboardingDismissed = false
      } else if (action === 'initialize' || action === 'bind') {
        const targetEng = requestedEngValid ? requestedEng : (engagement && existsSync(this.dbPathOf(engagement)) ? engagement : null)
        if (!targetEng) return null
        const metaEng = this.listEngagements().find((e) => e.id === targetEng)
        engagement = targetEng
        name = (typeof opts.name === 'string' && opts.name.trim()) || (metaEng && metaEng.name) || name || targetEng
        initState = 'initialized'
        onboardingDismissed = true
      } else if (action === 'unbind' || action === 'reset') {
        engagement = null
        name = null
        initState = 'uninitialized'
        onboardingDismissed = false
      }

      all[sid] = {
        engagement,
        name: engagement ? (name || engagement) : null,
        session_title: sessionTitle,
        cwd,
        init_state: initState,
        onboarding_dismissed: onboardingDismissed,
        has_conversation: hasConversation,
        updated_at: ts,
        at: ts,
      }
      writeSessionStateRecords(this, all)
      return this.getSessionState(sid)
    },
  }
  Object.assign(StoreClass.prototype, methods)
}
