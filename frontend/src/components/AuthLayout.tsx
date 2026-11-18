import { Eye, EyeOff } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'

/** What a full analysis does, as a terminal transcript (a description, not live data). */
const PIPELINE = [
  ['ingest', 'ZIP upload or public GitHub archive, verified'],
  ['quality', 'Ruff, duplication and code-smell rules'],
  ['security', 'Bandit, secret scan, OWASP Top 10 mapping'],
  ['complexity', 'cyclomatic complexity, maintainability'],
  ['deps', 'PyPI and npm versions, OSV.dev advisories'],
  ['architecture', 'components, imports, routes, diagram'],
] as const

export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-10 w-10' : 'h-7 w-7'
  const icon = size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5'
  return (
    <span
      aria-hidden="true"
      className={`inline-flex ${box} items-center justify-center rounded-lg border border-slate-700 bg-slate-950`}
    >
      <svg viewBox="0 0 24 24" className={`${icon} text-indigo-500`} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 6l-5 6 5 6M16 6l5 6-5 6" />
      </svg>
    </span>
  )
}

/** Split-screen frame for the sign-in, registration and password pages. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-950">
      <aside className="relative hidden flex-1 overflow-hidden border-r border-slate-800 bg-slate-900 lg:flex">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(rgb(var(--slate-800))_1px,transparent_1px),linear-gradient(90deg,rgb(var(--slate-800))_1px,transparent_1px)] [background-size:32px_32px]"
        />
        <div className="relative z-10 flex w-full flex-col justify-between p-12">
          <div className="flex items-center gap-3 text-base font-semibold text-slate-50">
            <BrandMark size="lg" />
            CodeBase Analysis
          </div>
          <div className="max-w-xl space-y-8">
            <div className="space-y-3">
              <p className="page-eyebrow">Repository intelligence</p>
              <p className="text-4xl font-semibold leading-[1.1] tracking-tight text-slate-50">
                Know what&apos;s in a codebase before you change it.
              </p>
              <p className="text-sm leading-relaxed text-slate-400">
                Quality, security, complexity, dependencies and architecture in one analysis, a
                health score you can explain, and an AI chat that cites the lines it read.
              </p>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 font-mono text-[13px] shadow-glow">
              <div className="flex items-center gap-1.5 border-b border-slate-800 px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                <span className="h-2.5 w-2.5 rounded-full bg-slate-700" />
                <span className="ml-2 text-xs text-slate-500">full analysis</span>
              </div>
              <ol className="space-y-1.5 px-4 py-4">
                {PIPELINE.map(([step, detail], index) => (
                  <li key={step} className="flex gap-3 animate-fade-in" style={{ animationDelay: `${index * 90}ms` }}>
                    <span className="text-emerald-400">✓</span>
                    <span className="w-28 shrink-0 text-slate-200">{step}</span>
                    <span className="truncate text-slate-500">{detail}</span>
                  </li>
                ))}
                <li className="flex gap-3 pt-1 animate-fade-in" style={{ animationDelay: `${PIPELINE.length * 90}ms` }}>
                  <span className="text-indigo-400">→</span>
                  <span className="text-slate-200">health score · AI chat · PDF report</span>
                </li>
              </ol>
            </div>
          </div>
          <p className="font-mono text-xs text-slate-500">Static analysis only: repository code is never run.</p>
        </div>
      </aside>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm animate-fade-in">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark />
            <span className="font-semibold text-slate-50">CodeBase Analysis</span>
          </div>
          <div className="space-y-6">{children}</div>
        </div>
      </main>
    </div>
  )
}

export const AUTH_INPUT =
  'mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500'
export const AUTH_BUTTON =
  'w-full rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-semibold hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50'

/**
 * A password input with an eye button that shows or hides what was typed. The button sits
 * outside the <label>, so the input's accessible name stays exactly the label text; it is a
 * plain type="button" (never submits) and reports its state with aria-pressed.
 */
export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: ReactNode
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
}) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  const Icon = visible ? EyeOff : Eye
  return (
    <div className="block text-sm">
      <label htmlFor={id} className="font-medium text-slate-300">
        {label}
      </label>
      <div className="relative mt-1.5">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          className={`${AUTH_INPUT.replace('mt-1.5 ', '')} pr-11`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setVisible((shown) => !shown)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
          title={visible ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 flex items-center rounded-r-lg px-3 text-slate-400 hover:text-slate-100 focus-visible:text-slate-100"
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
