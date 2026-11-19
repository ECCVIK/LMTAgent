/**
 * Standalone Pop-Out Window Launcher (zero external dependencies)
 *
 * Launches LMTAgent in an independent OS-level chromeless app window (`--app=<url>`)
 * pointed at the live loopback DSH webServer (`#lmtagent-full`), so the workbench
 * detaches cleanly from the DSH host frame, supports multi-monitor dragging, and
 * shares the exact same origin for `/lmtagent/api` and `/lmtagent/events` SSE.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const SAFE_PARAM_RE = /^[a-zA-Z0-9._:@/-]{1,128}$/

/**
 * Validate and normalize a standalone window target URL.
 * Only permits `http:` / `https:` on loopback hosts to prevent SSRF or arbitrary URI launches.
 */
export function validateLoopbackWindowUrl(rawUrl, options = {}) {
  const fallbackHost = String(options.fallbackHost || '').trim()
  let candidate = String(rawUrl || '').trim()
  if (!candidate && fallbackHost) {
    candidate = `http://${fallbackHost}/`
  }
  if (!candidate || /[\r\n\0]/.test(candidate)) {
    return { ok: false, error: 'missing or malformed window URL' }
  }
  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, error: 'invalid URL syntax' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: `unsupported protocol: ${parsed.protocol}` }
  }
  const hostLower = String(parsed.hostname || '').toLowerCase()
  if (!LOOPBACK_HOSTS.has(hostLower)) {
    return { ok: false, error: `non-loopback host rejected: ${hostLower}` }
  }

  const session = String(options.session || '').trim()
  const engagement = String(options.engagement || '').trim()
  const tab = String(options.tab || '').trim()
  if (session && SAFE_PARAM_RE.test(session)) parsed.searchParams.set('lmt_session', session)
  if (engagement && SAFE_PARAM_RE.test(engagement)) parsed.searchParams.set('lmt_eng', engagement)
  if (tab && SAFE_PARAM_RE.test(tab)) parsed.searchParams.set('lmt_tab', tab)
  parsed.hash = '#lmtagent-full'
  return { ok: true, url: parsed.toString() }
}

/**
 * Resolve an installed Chromium-family browser binary supporting `--app=` chromeless window mode.
 */
export function resolveAppBrowserBin(options = {}) {
  const env = options.env || process.env
  const platform = options.platform || process.platform
  const exists = typeof options.existsFn === 'function' ? options.existsFn : existsSync

  const override = String(env.LMTAGENT_BROWSER_BIN || env.CHROMIUM_BIN || '').trim()
  if (override) {
    if (!override.includes('/') && !override.includes('\\')) return override
    if (exists(override)) return override
  }

  if (platform === 'win32') {
    const localApp = env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    const progFiles = env.ProgramFiles || 'C:\\Program Files'
    const progFilesX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    const winCandidates = [
      join(progFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(progFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(progFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(progFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(localApp, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ]
    for (const p of winCandidates) {
      if (exists(p)) return p
    }
    return null
  }

  if (platform === 'darwin') {
    const macCandidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ]
    for (const p of macCandidates) {
      if (exists(p)) return p
    }
    return null
  }

  const linuxCandidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ]
  for (const p of linuxCandidates) {
    if (exists(p)) return p
  }
  return null
}

/**
 * Launch LMTAgent in a detached OS-level standalone app window (no shell interpolation).
 */
export function launchStandaloneWindow(options = {}) {
  const validated = validateLoopbackWindowUrl(options.url, {
    fallbackHost: options.host || options.fallbackHost,
    session: options.session,
    engagement: options.engagement,
    tab: options.tab,
  })
  if (!validated.ok) {
    return { ok: false, launched: false, error: validated.error }
  }

  const width = Math.max(960, Math.min(2560, Number(options.width) || 1440))
  const height = Math.max(640, Math.min(1600, Number(options.height) || 920))
  const browserBin = resolveAppBrowserBin(options)
  const spawnFn = typeof options.spawnFn === 'function' ? options.spawnFn : spawn

  if (!browserBin) {
    return {
      ok: true,
      launched: false,
      fallback: 'popup',
      mode: 'popup-fallback',
      url: validated.url,
      reason: 'no_app_browser_detected',
    }
  }

  const args = [
    `--app=${validated.url}`,
    `--window-size=${width},${height}`,
    '--new-window',
  ]
  try {
    const child = spawnFn(browserBin, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })
    if (child && typeof child.unref === 'function') child.unref()
    return {
      ok: true,
      launched: true,
      mode: 'browser-app',
      url: validated.url,
      bin: browserBin,
    }
  } catch (error) {
    return {
      ok: true,
      launched: false,
      fallback: 'popup',
      mode: 'popup-fallback',
      url: validated.url,
      error: error && error.message ? error.message : String(error),
    }
  }
}
