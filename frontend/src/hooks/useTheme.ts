import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'cba-theme'
const CHANGE_EVENT = 'cba-theme-change' // keeps every useTheme() in step

function saved(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function apply(theme: Theme, animate: boolean) {
  const root = document.documentElement
  if (animate) {
    root.classList.add('theme-transition')
    window.setTimeout(() => root.classList.remove('theme-transition'), 250)
  }
  root.setAttribute('data-theme', theme)
  window.dispatchEvent(new CustomEvent<Theme>(CHANGE_EVENT, { detail: theme }))
}

/** The colour theme: the saved choice, else the system setting (followed while unsaved). */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(
    () => (document.documentElement.getAttribute('data-theme') as Theme | null) ?? saved() ?? systemTheme(),
  )

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: light)')
    if (!media) return
    const follow = () => {
      if (saved() === null) apply(systemTheme(), true)
    }
    media.addEventListener?.('change', follow)
    return () => media.removeEventListener?.('change', follow)
  }, [])

  useEffect(() => {
    const sync = (event: Event) => setThemeState((event as CustomEvent<Theme>).detail)
    window.addEventListener(CHANGE_EVENT, sync)
    return () => window.removeEventListener(CHANGE_EVENT, sync)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage may be unavailable (private mode); the theme still applies for this visit.
    }
    apply(next, true)
  }, [])

  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme])

  return { theme, setTheme, toggle }
}
