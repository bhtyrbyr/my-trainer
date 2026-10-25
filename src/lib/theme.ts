/**
 * Theme preference: 'dark' (default), 'light' or 'system'. Stored per device in localStorage for an
 * instant first paint (see the inline script in index.html) and per account in user_settings.theme
 * so phone and desktop match. Applied as <html data-theme="light"> (dark needs no attribute).
 */
export const THEMES = ['dark', 'light', 'system'] as const
export type ThemePref = (typeof THEMES)[number]

const KEY = 'mt.theme'
const COLORS = { dark: '#111309', light: '#f5f6f0' } as const
const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'system' ? v : 'dark'
  } catch {
    return 'dark'
  }
}

export function resolveTheme(pref: ThemePref): 'dark' | 'light' {
  return pref === 'system' ? (mq?.matches ? 'light' : 'dark') : pref
}

export function applyTheme(pref: ThemePref): void {
  const resolved = resolveTheme(pref)
  const root = document.documentElement
  if (resolved === 'light') root.dataset.theme = 'light'
  else delete root.dataset.theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[resolved])
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    /* private mode: the account setting still applies after sign-in */
  }
}

/** Follow OS changes while the preference is 'system'. Returns an unsubscribe function. */
export function watchSystemTheme(): () => void {
  if (!mq) return () => {}
  const onChange = () => {
    if (readTheme() === 'system') applyTheme('system')
  }
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
