import { Eye, EyeOff } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** The analysis modules as chips on a board, wired into the health score (an illustration
 * of what a full analysis does, not live data). */
const INPUTS = [
  { label: 'QUALITY', ref: 'U1', y: 30, trace: 'M140 47 H194 L200 53 V144 L206 150 H230' },
  { label: 'SECURITY', ref: 'U2', y: 95, trace: 'M140 112 H179 L185 118 V159 L191 165 H230' },
  { label: 'COMPLEXITY', ref: 'U3', y: 160, trace: 'M140 177 H230' },
  { label: 'DEPENDENCIES', ref: 'U4', y: 225, trace: 'M140 242 H179 L185 236 V201 L191 195 H230' },
  { label: 'ARCHITECTURE', ref: 'U5', y: 290, trace: 'M140 307 H194 L200 301 V216 L206 210 H230' },
] as const
const OUTPUTS = [
  { label: 'PDF REPORT', ref: 'J1', y: 95, trace: 'M340 165 H360 L366 159 V118 L372 112 H400' },
  { label: 'AI CHAT', ref: 'J2', y: 225, trace: 'M340 195 H360 L366 201 V236 L372 242 H400' },
] as const
const VIAS = [[200, 98], [185, 140], [185, 218], [200, 258], [366, 138], [366, 220]] as const

function Chip({ x, y, width, label, refDes }: { x: number; y: number; width: number; label: string; refDes: string }) {
  return (
    <g>
      {[0.25, 0.5, 0.75].map((at) => (
        <g key={at} className="stroke-slate-600" strokeWidth="2">
          <line x1={x + width * at} y1={y - 5} x2={x + width * at} y2={y} />
          <line x1={x + width * at} y1={y + 34} x2={x + width * at} y2={y + 39} />
        </g>
      ))}
      <rect x={x} y={y} width={width} height="34" rx="3" className="fill-slate-950 stroke-slate-600" strokeWidth="1.25" />
      <circle cx={x + 7} cy={y + 7} r="1.75" className="fill-slate-600" />
      <text x={x + 12} y={y + 21} className="fill-slate-200 font-mono text-[10.5px] font-medium tracking-[0.08em]">
        {label}
      </text>
      <text x={x + width - 6} y={y + 30} textAnchor="end" className="fill-slate-500 font-mono text-[8px]">
        {refDes}
      </text>
    </g>
  )
}

/** The board illustration on the sign-in pages: current flows from every module chip into the
 * health score and on to the report and the chat. Motion stops under reduced-motion. */
export function CircuitIllustration({ boot = false }: { boot?: boolean }) {
  const traces = [...INPUTS, ...OUTPUTS]
  // With boot, the traces draw in one after another and the current starts once they're done.
  const late = (delay: number) => (boot ? { className: 'boot-late', style: { animationDelay: `${delay}ms` } } : {})
  return (
    <svg
      viewBox="0 0 520 345"
      className="h-auto w-full"
      role="img"
      aria-label="Quality, security, complexity, dependency and architecture analysis feed one health score, a PDF report and an AI chat"
    >
      {traces.map(({ ref, trace }, index) => (
        <path
          key={`base-${ref}`}
          d={trace}
          fill="none"
          pathLength={1}
          className={`stroke-slate-700 ${boot ? 'boot-trace' : ''}`}
          style={boot ? { animationDelay: `${250 + index * 110}ms` } : undefined}
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      ))}
      <g {...late(1300)}>
        {traces.map(({ ref, trace }, index) => (
          <path
            key={`current-${ref}`}
            d={trace}
            fill="none"
            className="animate-current stroke-indigo-400"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="6 42"
            style={{ animationDelay: `${index * -0.35}s` }}
          />
        ))}
      </g>
      {VIAS.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.5" className="fill-slate-900 stroke-indigo-500" strokeWidth="1.5" />
      ))}
      {INPUTS.map(({ label, ref, y }) => (
        <Chip key={ref} x={20} y={y} width={120} label={label} refDes={ref} />
      ))}
      {OUTPUTS.map(({ label, ref, y }) => (
        <Chip key={ref} x={400} y={y} width={110} label={label} refDes={ref} />
      ))}
      <g>
        {[150, 165, 180, 195, 210].map((py) => (
          <line key={py} x1="224" y1={py} x2="230" y2={py} className="stroke-indigo-500" strokeWidth="2" />
        ))}
        {[250, 270, 290, 310].map((px) => (
          <g key={px} className="stroke-slate-600" strokeWidth="2">
            <line x1={px} y1="124" x2={px} y2="130" />
            <line x1={px} y1="230" x2={px} y2="236" />
          </g>
        ))}
        <rect x="230" y="130" width="110" height="100" rx="5" className="fill-slate-950 stroke-indigo-500" strokeWidth="1.5" />
        <circle cx="240" cy="140" r="2.5" className="fill-indigo-500" />
        <text x="285" y="176" textAnchor="middle" className="fill-indigo-300 font-mono text-[12px] font-semibold tracking-[0.14em]">
          HEALTH
        </text>
        <text x="285" y="194" textAnchor="middle" className="fill-slate-400 font-mono text-[9px] tracking-[0.1em]">
          SCORE 0-100
        </text>
        <text x="334" y="224" textAnchor="end" className="fill-slate-500 font-mono text-[8px]">
          U0
        </text>
      </g>
    </svg>
  )
}

/** The logo: a gold chip with code brackets on its die. */
export function BrandMark({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-10 w-10' : 'h-7 w-7'
  return (
    <span aria-hidden="true" className={`inline-flex ${box} shrink-0 items-center justify-center`}>
      <svg viewBox="0 0 32 32" className="h-full w-full" fill="none" strokeLinecap="round">
        <path
          d="M12 3v4M16 3v4M20 3v4M12 25v4M16 25v4M20 25v4M3 12h4M3 16h4M3 20h4M25 12h4M25 16h4M25 20h4"
          className="stroke-indigo-500"
          strokeWidth="1.75"
        />
        <rect x="7" y="7" width="18" height="18" rx="2.5" className="fill-slate-900 stroke-indigo-500" strokeWidth="1.75" />
        <path d="M14 13l-3 3 3 3M18 13l3 3-3 3" className="stroke-indigo-300" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

/** Split-screen frame for the sign-in, registration and password pages. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="pcb-surface flex min-h-screen bg-slate-950">
      <aside className="relative hidden flex-1 overflow-hidden border-r border-slate-800 bg-slate-950/40 lg:flex">
        <div className="relative z-10 flex w-full flex-col justify-between p-12">
          <Link to="/" className="flex w-fit items-center gap-3 text-base font-semibold text-slate-50">
            <BrandMark size="lg" />
            CodeBase Analysis
          </Link>
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
            <div className="pcb-card bg-slate-900/80 p-6">
              <CircuitIllustration />
            </div>
          </div>
          <p className="flex items-center gap-2.5 font-mono text-xs text-slate-500">
            <span className="led text-emerald-400" aria-hidden="true" />
            Static analysis only: repository code is never run.
          </p>
        </div>
      </aside>
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm animate-fade-in rounded-2xl border border-slate-800 bg-slate-950/85 p-8 backdrop-blur-sm">
          <Link to="/" className="mb-8 flex w-fit items-center gap-3 lg:hidden">
            <BrandMark />
            <span className="font-semibold text-slate-50">CodeBase Analysis</span>
          </Link>
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
