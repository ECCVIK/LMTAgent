    /* ---------------------------------------------------------- 00b-i18n：轻量响应式多语言状态中心 (zh-CN / en-US) */
    const LOCALE_STORAGE_KEY = 'lmt_ui_locale'
    let _syncedUiLocale = 'auto'
    let _memoryLocale = null
    const _localeListeners = new Set()

    const normalizeLocalePref = (raw) => {
      const s = String(raw === undefined || raw === null ? '' : raw).trim()
      if (s === 'zh-CN' || s === 'en-US') return s
      if (/^zh\b/i.test(s)) return 'zh-CN'
      if (/^en\b/i.test(s)) return 'en-US'
      return 'auto'
    }

    const readStoredLocale = () => {
      try {
        if (typeof window !== 'undefined' && window && window.localStorage) {
          const raw = window.localStorage.getItem(LOCALE_STORAGE_KEY)
          if (raw === 'zh-CN' || raw === 'en-US') return raw
          return null
        }
      } catch { /* ignore storage error */ }
      return (_memoryLocale === 'zh-CN' || _memoryLocale === 'en-US') ? _memoryLocale : null
    }

    /**
     * 解析当前生效的 UI 语言：
     *   1. localStorage('lmt_ui_locale') ('zh-CN' | 'en-US')
     *   2. 设置中心同步值 syncedUiLocale ('zh-CN' | 'en-US')
     *   3. auto 模式下若 navigator.language 以 en 开头则用 'en-US'，否则默认 'zh-CN'
     */
    const getLocale = () => {
      const stored = readStoredLocale()
      if (stored === 'zh-CN' || stored === 'en-US') return stored
      if (_syncedUiLocale === 'zh-CN' || _syncedUiLocale === 'en-US') return _syncedUiLocale
      try {
        if (typeof navigator !== 'undefined' && navigator && /^en\b/i.test(navigator.language || '')) {
          return 'en-US'
        }
      } catch { /* ignore */ }
      return 'zh-CN'
    }

    const notifyLocaleListeners = () => {
      const cur = getLocale()
      for (const fn of Array.from(_localeListeners)) {
        try { fn(cur) } catch { /* ignore */ }
      }
    }

    const setLocale = (nextLocale) => {
      const norm = normalizeLocalePref(nextLocale)
      const prev = getLocale()
      let hasStorage = false
      try {
        if (typeof window !== 'undefined' && window && window.localStorage) {
          hasStorage = true
          if (norm === 'zh-CN' || norm === 'en-US') {
            window.localStorage.setItem(LOCALE_STORAGE_KEY, norm)
          } else {
            window.localStorage.removeItem(LOCALE_STORAGE_KEY)
          }
        }
      } catch { hasStorage = false }
      if (!hasStorage) {
        _memoryLocale = (norm === 'zh-CN' || norm === 'en-US') ? norm : null
      } else {
        _memoryLocale = null
      }
      if (norm === 'auto') {
        _syncedUiLocale = 'auto'
      }
      const next = getLocale()
      if (next !== prev) notifyLocaleListeners()
      return next
    }

    const syncLocaleFromSettings = (rawPref) => {
      const prev = getLocale()
      const norm = normalizeLocalePref(rawPref)
      _syncedUiLocale = norm
      const next = getLocale()
      if (next !== prev) notifyLocaleListeners()
      return next
    }

    const t = (zh, en) => (getLocale() === 'en-US' ? (en !== undefined ? en : zh) : zh)

    const useLocale = () => {
      const [, force] = React.useReducer((x) => x + 1, 0)
      React.useEffect(() => {
        const listener = () => force()
        _localeListeners.add(listener)
        return () => { _localeListeners.delete(listener) }
      }, [])
      return getLocale()
    }
