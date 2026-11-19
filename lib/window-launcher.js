/**
 * Standalone Pop-Out Window Launcher & Dedicated HTML Shell (zero external dependencies)
 *
 * Launches LMTAgent in an independent OS-level chromeless app window (`--app=<url>`)
 * pointed at our dedicated loopback route `http://127.0.0.1:<port>/lmtagent/window`,
 * completely detached from DSH Desktop (`dsh-app://` Electron shell) and bypassing
 * DSH's 401-gated root `/` while sharing the exact same loopback origin for
 * `/lmtagent/api` and `/lmtagent/events` SSE.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const SAFE_PARAM_RE = /^[a-zA-Z0-9._:@/-]{1,128}$/
const STANDALONE_PATH = '/lmtagent/window'

/**
 * Check whether an HTTP `Host` header value points to loopback only.
 */
export function isLoopbackHostHeader(hostHeader) {
  const raw = String(hostHeader || '').trim()
  if (!raw || /[\r\n\0\s/@]/.test(raw)) return false
  try {
    const parsed = new URL(`http://${raw}/`)
    return LOOPBACK_HOSTS.has(String(parsed.hostname || '').toLowerCase())
  } catch {
    return false
  }
}

/**
 * Validate and normalize a standalone window target URL.
 * - Rejects explicit non-loopback `http:` / `https:` URLs (SSRF protection).
 * - Gracefully falls back to `http://<fallbackHost>/lmtagent/window` when the caller
 *   runs inside Electron (`dsh-app://app/`, `file://`, etc.) or omits `rawUrl`.
 * - Normalizes pathname to `/lmtagent/window` so the OS window loads our dedicated
 *   standalone workbench without hitting DSH's 401-protected root `/`.
 */
export function validateLoopbackWindowUrl(rawUrl, options = {}) {
  const fallbackHost = String(options.fallbackHost || '').trim()
  const raw = String(rawUrl || '').trim()
  if (/[\r\n\0]/.test(raw)) {
    return { ok: false, error: 'missing or malformed window URL' }
  }

  let parsed = null
  if (raw) {
    try {
      const candidate = new URL(raw)
      if (candidate.protocol === 'http:' || candidate.protocol === 'https:') {
        const hostLower = String(candidate.hostname || '').toLowerCase()
        if (!LOOPBACK_HOSTS.has(hostLower)) {
          return { ok: false, error: `non-loopback host rejected: ${hostLower}` }
        }
        parsed = candidate
      } else if (!fallbackHost) {
        return { ok: false, error: `unsupported protocol: ${candidate.protocol}` }
      }
      /* Non-http(s) Electron shell origins (e.g. dsh-app://app/, file://) fall through to fallbackHost */
    } catch {
      if (!fallbackHost) {
        return { ok: false, error: 'invalid URL syntax' }
      }
    }
  }

  if (!parsed) {
    if (!fallbackHost || !isLoopbackHostHeader(fallbackHost)) {
      return { ok: false, error: fallbackHost ? `non-loopback host rejected: ${fallbackHost}` : 'missing or malformed window URL' }
    }
    try {
      parsed = new URL(`http://${fallbackHost}${STANDALONE_PATH}`)
    } catch {
      return { ok: false, error: 'invalid fallback host' }
    }
  }

  if (options.preservePath !== true) {
    parsed.pathname = STANDALONE_PATH
  }

  const session = String(options.session || '').trim()
  const engagement = String(options.engagement || '').trim()
  const tab = String(options.tab || '').trim()
  const locale = String(options.locale || '').trim()
  if (session && SAFE_PARAM_RE.test(session)) parsed.searchParams.set('lmt_session', session)
  if (engagement && SAFE_PARAM_RE.test(engagement)) parsed.searchParams.set('lmt_eng', engagement)
  if (tab && SAFE_PARAM_RE.test(tab)) parsed.searchParams.set('lmt_tab', tab)
  if (locale === 'zh-CN' || locale === 'en-US') parsed.searchParams.set('lmt_locale', locale)
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
    locale: options.locale,
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

/**
 * Build the self-contained HTML shell for `GET /lmtagent/window`.
 * Uses local vendored React + ReactDOM (`/lmtagent/vendor/*`) and our compiled
 * `/lmtagent/client.js` bundle — zero CDN dependency, zero DSH shell chrome.
 */
export function buildStandaloneWindowHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LMTAgent — Standalone Workbench</title>
<style>
  :root {
    --dsw-alias-bg-base: #ffffff;
    --dsw-alias-bg-layer: #f6f8fb;
    --dsw-alias-bg-layer-hover: #eef2f7;
    --dsw-alias-label-primary: #111827;
    --dsw-alias-label-secondary: #4b5563;
    --dsw-alias-label-tertiary: #6b7280;
    --dsw-alias-line-primary: #dbe2ea;
    --dsw-alias-line-secondary: #e5eaf1;
    --dsw-alias-brand-primary: #2563eb;
    --dsw-alias-brand-primary-hover: #1d4ed8;
    --dsw-alias-state-error-primary: #dc2626;
    --dsw-alias-state-warn-primary: #d97706;
    --dsw-alias-state-success-primary: #16a34a;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --dsw-alias-bg-base: #0f141c;
      --dsw-alias-bg-layer: #161d28;
      --dsw-alias-bg-layer-hover: #1e2836;
      --dsw-alias-label-primary: #f3f4f6;
      --dsw-alias-label-secondary: #9ca3af;
      --dsw-alias-label-tertiary: #6b7280;
      --dsw-alias-line-primary: #273244;
      --dsw-alias-line-secondary: #1f2937;
      --dsw-alias-brand-primary: #3b82f6;
      --dsw-alias-brand-primary-hover: #2563eb;
      --dsw-alias-state-error-primary: #f87171;
      --dsw-alias-state-warn-primary: #fbbf24;
      --dsw-alias-state-success-primary: #4ade80;
    }
  }
  html, body, #root {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--dsw-alias-bg-base);
    color: var(--dsw-alias-label-primary);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .lmt-boot-err {
    padding: 24px;
    font-size: 13px;
    color: var(--dsw-alias-state-error-primary);
    white-space: pre-wrap;
  }
</style>
</head>
<body>
<div id="root"></div>
<script>
  window.__LMT_STANDALONE_WINDOW__ = true;
  (function () {
    try {
      var p = new URLSearchParams(window.location.search || '');
      var loc = p.get('lmt_locale');
      if (loc === 'zh-CN' || loc === 'en-US') {
        try { window.localStorage.setItem('lmt_ui_locale', loc); } catch (e) {}
      }
      if (window.location.hash !== '#lmtagent-full') {
        window.history.replaceState(null, '', window.location.pathname + window.location.search + '#lmtagent-full');
      }
    } catch (e) {}
  })();
</script>
<script src="/lmtagent/vendor/react.js"></script>
<script src="/lmtagent/vendor/react-dom.js"></script>
<script>
  window.__LMT_MODULES__ = {};
  window.__ModuleLoader__ = {
    load: function (def) {
      var mod = { exports: {} };
      var req = function (id) {
        if (id === 'react') return window.React;
        if (id === 'react-dom') return window.ReactDOM;
        throw new Error('Unsupported require in standalone window: ' + id);
      };
      var out = def.factory(req, mod.exports, mod);
      window.__LMT_MODULES__[def.id] = out || mod.exports;
    }
  };
</script>
<script src="/lmtagent/client.js"></script>
<script>
  (function () {
    try {
      var mods = window.__LMT_MODULES__ || {};
      var plugin = mods['dsh-lmtagent'] || mods['dsh-redteam-ui'] || mods['dsh-redteam-mode'] || Object.values(mods)[0];
      if (!plugin || typeof plugin.apply !== 'function') {
        throw new Error('LMTAgent client bundle failed to register.');
      }
      var overlayFactory = null;
      var fakeCtx = {
        effect: function () {},
        slots: {
          inject: function (name, fn) { if (name === 'shell.overlay') fn(); },
          register: function (meta, renderFn) {
            if (meta && meta.name === 'shell.overlay') overlayFactory = renderFn;
          }
        }
      };
      plugin.apply(fakeCtx);
      if (typeof overlayFactory !== 'function') {
        throw new Error('LMTAgent Panel slot did not register.');
      }
      var rootEl = document.getElementById('root');
      var tree = overlayFactory();
      if (window.ReactDOM && typeof window.ReactDOM.createRoot === 'function') {
        window.ReactDOM.createRoot(rootEl).render(tree);
      } else if (window.ReactDOM && typeof window.ReactDOM.render === 'function') {
        window.ReactDOM.render(tree, rootEl);
      }
    } catch (err) {
      var el = document.getElementById('root');
      if (el) {
        el.innerHTML = '';
        var d = document.createElement('div');
        d.className = 'lmt-boot-err';
        d.textContent = 'LMTAgent Standalone Window failed to start:\\n' + (err && err.stack ? err.stack : String(err));
        el.appendChild(d);
      }
    }
  })();
</script>
</body>
</html>`
}
