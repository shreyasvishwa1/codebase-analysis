import { Keyboard, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/** "G then a letter" jumps to a page. */
export const GO_KEYS: { key: string; to: string; label: string }[] = [
  { key: 'o', to: '/overview', label: 'Overview' },
  { key: 'p', to: '/projects', label: 'My Projects' },
  { key: 'u', to: '/upload', label: 'Upload Repository' },
  { key: 'q', to: '/code-analysis', label: 'Code Analysis' },
  { key: 's', to: '/security', label: 'Security' },
  { key: 'c', to: '/complexity', label: 'Complexity' },
  { key: 'd', to: '/dependencies', label: 'Dependencies' },
  { key: 'a', to: '/architecture', label: 'Architecture' },
  { key: 'h', to: '/health-score', label: 'Health Score' },
  { key: 'i', to: '/chat', label: 'AI Chat' },
  { key: 'r', to: '/history', label: 'History & Reports' },
  { key: ',', to: '/settings', label: 'Settings' },
]

export const ACTION_KEYS: { keys: string[]; label: string }[] = [
  { keys: ['Ctrl', 'K'], label: 'Search pages, repositories and actions' },
  { keys: ['/'], label: 'Search (same as Ctrl K)' },
  { keys: ['T'], label: 'Switch between the dark and light theme' },
  { keys: ['?'], label: 'Show or hide these shortcuts' },
  { keys: ['Esc'], label: 'Close a dialog' },
]

/** How long after G the second key still counts. */
export const GO_WINDOW_MS = 1200

function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/**
 * The single-key shortcuts of the signed-in app. Ignored while typing in a field or with
 * Ctrl, Cmd or Alt held (those belong to the browser and to Ctrl+K).
 */
export function useGlobalShortcuts({
  onSearch,
  onToggleTheme,
  onToggleHelp,
  disabled,
}: {
  onSearch: () => void
  onToggleTheme: () => void
  onToggleHelp: () => void
  /** while a dialog is open, only its own keys apply */
  disabled: boolean
}) {
  const navigate = useNavigate()
  const goAt = useRef(0)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
      if (typingIn(event.target)) return
      if (event.key === '?') {
        event.preventDefault()
        onToggleHelp()
        return
      }
      if (disabled) return
      const key = event.key.toLowerCase()
      if (Date.now() - goAt.current < GO_WINDOW_MS) {
        goAt.current = 0
        const target = GO_KEYS.find((entry) => entry.key === key)
        if (target) {
          event.preventDefault()
          navigate(target.to)
        }
        return
      }
      if (key === 'g') {
        goAt.current = Date.now()
      } else if (key === 't') {
        event.preventDefault()
        onToggleTheme()
      } else if (key === '/') {
        event.preventDefault()
        onSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, onSearch, onToggleTheme, onToggleHelp, disabled])
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {keys.map((key, index) => (
        <span key={`${key}-${index}`} className="kbd min-w-[1.5rem] uppercase">
          {key}
        </span>
      ))}
    </span>
  )
}

/** The "?" overlay: every shortcut, grouped. */
export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/70 px-4 pt-[10vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="pcb-card w-full max-w-2xl animate-pop-in p-6 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <Keyboard className="h-5 w-5 text-indigo-400" aria-hidden="true" />
          <h2 id="shortcuts-title" className="text-lg font-semibold text-slate-50">
            Keyboard shortcuts
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close the shortcuts"
            className="ml-auto rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-5 grid gap-6 sm:grid-cols-2">
          <section aria-labelledby="shortcuts-go">
            <h3 id="shortcuts-go" className="page-eyebrow">
              Go to (press G, then)
            </h3>
            <ul className="mt-3 space-y-1.5">
              {GO_KEYS.map((entry) => (
                <li key={entry.key} className="flex items-center justify-between gap-3 text-sm text-slate-300">
                  {entry.label}
                  <Keys keys={['G', entry.key]} />
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="shortcuts-actions">
            <h3 id="shortcuts-actions" className="page-eyebrow">
              Actions
            </h3>
            <ul className="mt-3 space-y-1.5">
              {ACTION_KEYS.map((entry) => (
                <li key={entry.label} className="flex items-center justify-between gap-3 text-sm text-slate-300">
                  {entry.label}
                  <Keys keys={entry.keys} />
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-slate-500">
              Shortcuts are off while you type in a field. Press Esc or click outside to close.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
