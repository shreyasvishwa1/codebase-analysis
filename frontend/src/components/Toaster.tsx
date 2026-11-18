import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
  /** a link shown on the toast, for example to the finished analysis */
  action?: { label: string; to: string }
}

interface Toast extends Required<Pick<ToastInput, 'title' | 'tone'>>, Omit<ToastInput, 'title' | 'tone'> {
  id: number
}

/** How long a toast stays (errors stay longer); hovering or focusing it pauses the timer. */
export const TOAST_MS = { success: 4500, info: 4500, error: 8000 } as const
export const MAX_TOASTS = 4

type Notify = (toast: ToastInput) => void

// Without a provider (in isolated component tests) notifications are simply dropped.
const ToastContext = createContext<Notify>(() => {})

/** Show a short notification in the corner: `const toast = useToast(); toast({ title })`. */
export function useToast(): Notify {
  return useContext(ToastContext)
}

const TONES: Record<ToastTone, { icon: typeof Info; accent: string }> = {
  success: { icon: CheckCircle2, accent: 'text-indigo-400' },
  info: { icon: Info, accent: 'text-sky-400' },
  error: { icon: XCircle, accent: 'text-red-400' },
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: (id: number) => void }) {
  const [paused, setPaused] = useState(false)
  const remaining = useRef(TOAST_MS[toast.tone])
  const started = useRef(Date.now())

  useEffect(() => {
    if (paused) return
    started.current = Date.now()
    const timer = window.setTimeout(() => onClose(toast.id), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current -= Date.now() - started.current
    }
  }, [paused, toast.id, onClose])

  const { icon: Icon, accent } = TONES[toast.tone]
  return (
    <li
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      data-tone={toast.tone}
      className={`pointer-events-auto relative flex w-full animate-slide-in gap-3 overflow-hidden rounded-xl border bg-slate-900/95 p-4 pr-10 shadow-2xl backdrop-blur ${toast.tone === 'error' ? 'border-red-500/40' : 'border-slate-700'}`}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${accent}`} aria-hidden="true" />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold text-slate-50">{toast.title}</p>
        {toast.description && <p className="text-xs leading-relaxed text-slate-400">{toast.description}</p>}
        {toast.action && (
          <Link
            to={toast.action.to}
            onClick={() => onClose(toast.id)}
            className="inline-block pt-1 text-xs font-semibold text-indigo-300 hover:text-indigo-200"
          >
            {toast.action.label} →
          </Link>
        )}
      </div>
      <button
        type="button"
        onClick={() => onClose(toast.id)}
        aria-label={`Dismiss: ${toast.title}`}
        className="absolute right-2 top-2 rounded-md p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      {/* A gold trace that drains while the toast waits (stops while paused). */}
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-0 h-0.5 bg-indigo-500/70"
        style={{
          animation: `toast-drain ${TOAST_MS[toast.tone]}ms linear forwards`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      />
    </li>
  )
}

/** Holds the notifications and draws them in the bottom-right corner (above the status bar). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(1)

  const close = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), [])
  const notify = useCallback<Notify>((input) => {
    const toast: Toast = { ...input, tone: input.tone ?? 'success', id: next.current++ }
    setToasts((list) => [...list, toast].slice(-MAX_TOASTS))
  }, [])
  const value = useMemo(() => notify, [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section
        aria-label="Notifications"
        aria-live="polite"
        className="pointer-events-none fixed bottom-12 right-4 z-[60] w-[min(22rem,calc(100vw-2rem))]"
      >
        <ol className="flex flex-col gap-2">
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onClose={close} />
          ))}
        </ol>
      </section>
    </ToastContext.Provider>
  )
}
