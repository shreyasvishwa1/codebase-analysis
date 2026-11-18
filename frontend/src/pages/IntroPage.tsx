import {
  ArrowRight,
  FileText,
  Gauge,
  HeartPulse,
  Lock,
  MessagesSquare,
  Moon,
  Network,
  Package,
  ScanSearch,
  ShieldCheck,
  Sun,
  UploadCloud,
  type LucideIcon,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'

import { BrandMark } from '../components/AuthLayout'
import { Board3D } from '../components/Board3D'
import { useAuth } from '../hooks/useAuth'
import { useHealth } from '../hooks/useHealth'
import { useReveal, useScrollProgress, useTilt } from '../hooks/useMotion'
import { useTheme } from '../hooks/useTheme'

const STEPS: { title: string; text: string; icon: LucideIcon }[] = [
  { title: 'Upload', text: 'Drop a ZIP or paste a public GitHub link. Files are checked and stored; nothing is run.', icon: UploadCloud },
  { title: 'Analyze', text: 'One full analysis runs every module in the background while you watch each stage finish.', icon: ScanSearch },
  { title: 'Review', text: 'Findings link to the exact lines. The health score shows what it was made of and how to raise it.', icon: HeartPulse },
  { title: 'Report', text: 'Ask the AI about the code with citations, then download a PDF report to share.', icon: FileText },
]

const MODULES: { refDes: string; title: string; text: string; icon: LucideIcon }[] = [
  { refDes: 'U1', title: 'Code quality', text: 'Ruff rules, duplication and code smells, ranked by severity.', icon: ScanSearch },
  { refDes: 'U2', title: 'Security', text: 'Secrets, injection and misconfiguration, mapped to the OWASP Top 10.', icon: ShieldCheck },
  { refDes: 'U3', title: 'Complexity', text: 'Cyclomatic complexity and maintainability for every function and file.', icon: Gauge },
  { refDes: 'U4', title: 'Dependencies', text: 'PyPI and npm versions checked against OSV.dev advisories.', icon: Package },
  { refDes: 'U5', title: 'Architecture', text: 'Components, imports and routes drawn as a diagram.', icon: Network },
  { refDes: 'U0', title: 'Health score', text: 'One explainable 0 to 100 score with weights you control.', icon: HeartPulse },
  { refDes: 'J2', title: 'AI chat', text: 'Questions about the codebase, answered with citations to real lines.', icon: MessagesSquare },
  { refDes: 'J1', title: 'PDF reports', text: 'Every analysis kept in history, with a report to download.', icon: FileText },
]

const PROMISES = [
  'Repository code is never executed',
  'Secrets are masked in every view',
  'Findings cite file and line',
  'Your data stays in your account',
]

/** The server light: asking for /health also wakes a sleeping server while the visitor reads.
 * A free-tier server can take longer than one request's timeout to wake, so a failure only
 * counts as "unreachable" after three in a row (the check repeats every 30 seconds). */
export const UNREACHABLE_AFTER = 3

function ServerLight() {
  const health = useHealth()
  const online = health.data?.status === 'ok' && !health.isError
  const down = health.isError && health.errorUpdateCount >= UNREACHABLE_AFTER
  const label = online ? 'Server online' : down ? 'Server unreachable' : health.isError ? 'Still waking the server…' : 'Waking the server…'
  return (
    <span role="status" className="inline-flex items-center gap-2 font-mono text-[11px] text-slate-400">
      <span aria-hidden="true" className={`led ${online ? 'text-emerald-400' : down ? 'text-red-400' : 'animate-pulse text-amber-400'}`} />
      {label}
    </span>
  )
}

function ModuleCard({ refDes, title, text, icon: Icon, index }: (typeof MODULES)[number] & { index: number }) {
  const tilt = useTilt<HTMLDivElement>(6)
  return (
    <div className="reveal" style={{ '--reveal-delay': `${(index % 4) * 70}ms` } as CSSProperties}>
      <div ref={tilt} id={`module-${refDes}`} className="tilt group pcb-card h-full scroll-mt-24 p-5 hover:border-indigo-500/50">
        <div className="tilt-layer flex items-center justify-between" style={{ '--z': '28px' } as CSSProperties}>
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-indigo-400 transition group-hover:border-indigo-500 group-hover:shadow-[0_0_18px_rgb(var(--indigo-500)/0.35)]">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="font-mono text-[10px] text-slate-500">{refDes}</span>
        </div>
        <h3 className="tilt-layer mt-4 font-semibold text-slate-50" style={{ '--z': '18px' } as CSSProperties}>
          {title}
        </h3>
        <p className="tilt-layer mt-1.5 text-sm leading-relaxed text-slate-400" style={{ '--z': '10px' } as CSSProperties}>
          {text}
        </p>
      </div>
    </div>
  )
}

/** Scroll to a module's card and flash it (from a click on its chip on the 3D board). */
function showModule(ref: string) {
  const card = document.getElementById(`module-${ref}`)
  if (!card) return
  card.scrollIntoView({ behavior: 'smooth', block: 'center' })
  card.classList.remove('module-flash')
  void card.offsetWidth // restart the animation if it is already running
  card.classList.add('module-flash')
  window.setTimeout(() => card.classList.remove('module-flash'), 1800)
}

/** The landing page: what the app does, shown as a board that powers on, then the four steps
 * and every module, revealed as the visitor scrolls. */
export function IntroPage() {
  const { status } = useAuth()
  const { theme, toggle } = useTheme()
  const page = useReveal<HTMLDivElement>()
  const [stepsRef, stepsProgress] = useScrollProgress<HTMLOListElement>()
  const signedIn = status === 'authenticated'
  const ThemeIcon = theme === 'dark' ? Sun : Moon

  return (
    <div ref={page} className="pcb-surface min-h-screen overflow-x-clip bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 md:px-8">
          <Link to="/" className="flex items-center gap-2.5 text-sm font-semibold text-slate-50">
            <BrandMark />
            CodeBase Analysis
          </Link>
          <nav aria-label="Intro" className="ml-6 hidden gap-5 text-[13px] text-slate-400 md:flex">
            <a href="#how" className="hover:text-slate-100">How it works</a>
            <a href="#modules" className="hover:text-slate-100">Modules</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-800 text-slate-400 hover:text-slate-100"
            >
              <ThemeIcon className="h-4 w-4" aria-hidden="true" />
            </button>
            {signedIn ? (
              <Link to="/overview" className="rounded-lg bg-indigo-500 px-3.5 py-1.5 text-sm font-semibold hover:bg-indigo-400">
                Open the app
              </Link>
            ) : (
              <>
                <Link to="/login" className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-300 hover:text-slate-50">
                  Sign in
                </Link>
                <Link to="/register" className="rounded-lg bg-indigo-500 px-3.5 py-1.5 text-sm font-semibold hover:bg-indigo-400">
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 md:px-8 lg:grid-cols-[1fr_1.1fr] lg:pt-20">
          <div className="space-y-6">
            <div className="animate-fade-in">
              <ServerLight />
            </div>
            <p className="page-eyebrow animate-fade-in">Repository intelligence</p>
            <h1 className="animate-fade-in text-4xl font-semibold leading-[1.05] tracking-tight text-slate-50 [animation-delay:80ms] sm:text-5xl lg:text-6xl">
              See inside any codebase{' '}
              <span className="bg-gradient-to-r from-indigo-300 to-indigo-500 bg-clip-text text-transparent">before you touch it.</span>
            </h1>
            <p className="max-w-xl animate-fade-in text-base leading-relaxed text-slate-400 [animation-delay:160ms]">
              Upload a repository and one analysis checks its quality, security, complexity,
              dependencies and architecture, scores its health, and lets you ask an AI about it with
              answers that cite the lines they came from.
            </p>
            <div className="flex animate-fade-in flex-wrap items-center gap-3 [animation-delay:240ms]">
              <Link
                to={signedIn ? '/upload' : '/register'}
                className="group inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-5 py-3 text-sm font-semibold shadow-[0_0_24px_rgb(var(--indigo-500)/0.35)] hover:bg-indigo-400"
              >
                {signedIn ? 'Upload a repository' : 'Analyze your first repository'}
                <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
              <a href="#how" className="rounded-lg border border-slate-700 px-5 py-3 text-sm font-medium text-slate-200 hover:border-slate-500">
                See how it works
              </a>
            </div>
          </div>

          <div className="relative animate-fade-in [animation-delay:120ms]">
            <div aria-hidden="true" className="absolute -inset-6 rounded-[2rem] bg-indigo-500/10 blur-3xl" />
            <div className="pcb-card relative bg-slate-900/90 px-3 pb-3 pt-4 shadow-2xl sm:px-5">
              <Board3D onSelect={(chip) => showModule(chip.ref)} />
            </div>
          </div>
        </section>

        {/* Promises */}
        <section aria-label="Safety" className="border-y border-slate-800 bg-slate-950/70">
          <ul className="mx-auto grid max-w-6xl gap-4 px-4 py-6 text-sm text-slate-300 sm:grid-cols-2 md:px-8 lg:grid-cols-4">
            {PROMISES.map((promise, index) => (
              <li key={promise} className="reveal flex items-center gap-2.5" style={{ '--reveal-delay': `${index * 80}ms` } as CSSProperties}>
                <Lock className="h-4 w-4 shrink-0 text-indigo-400" aria-hidden="true" />
                {promise}
              </li>
            ))}
          </ul>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 md:px-8">
          <div className="reveal max-w-2xl">
            <p className="page-eyebrow">How it works</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">From archive to answers in four steps.</h2>
          </div>
          <ol ref={stepsRef} className="relative mt-14 space-y-10 pl-12">
            {/* The trace fills with current as the visitor scrolls through the steps. */}
            <span aria-hidden="true" className="absolute bottom-6 left-[15px] top-2 w-0.5 rounded bg-slate-800" />
            <span
              aria-hidden="true"
              className="absolute left-[15px] top-2 w-0.5 rounded bg-indigo-400 shadow-[0_0_10px_rgb(var(--indigo-400)/0.7)]"
              style={{ height: `calc((100% - 2rem) * ${stepsProgress})` }}
            />
            {STEPS.map(({ title, text, icon: Icon }, index) => {
              const lit = stepsProgress >= (index + 0.35) / STEPS.length
              return (
                <li key={title} className="reveal relative">
                  <span
                    aria-hidden="true"
                    className={`absolute -left-12 top-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 transition duration-500 ${lit ? 'border-indigo-400 bg-indigo-500 text-[rgb(var(--on-accent))] shadow-[0_0_16px_rgb(var(--indigo-500)/0.6)]' : 'border-slate-700 bg-slate-950 text-slate-500'}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-500">Step {index + 1}</p>
                  <h3 className="mt-1 text-xl font-semibold text-slate-50">{title}</h3>
                  <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-slate-400">{text}</p>
                </li>
              )
            })}
          </ol>
        </section>

        {/* Modules */}
        <section id="modules" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-24 md:px-8">
          <div className="reveal max-w-2xl">
            <p className="page-eyebrow">On the board</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-50 sm:text-4xl">Eight modules, one analysis.</h2>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((module, index) => (
              <ModuleCard key={module.refDes} {...module} index={index} />
            ))}
          </div>
        </section>

        {/* Call to action */}
        <section className="mx-auto max-w-6xl px-4 pb-24 md:px-8">
          <div className="reveal pcb-card relative overflow-hidden px-6 py-14 text-center sm:px-12">
            <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-400 to-transparent" />
            <h2 className="text-3xl font-semibold tracking-tight text-slate-50">Plug in your first repository.</h2>
            <p className="mx-auto mt-3 max-w-lg text-sm text-slate-400">
              A free account, a ZIP or a GitHub link, and a full report in a few minutes.
            </p>
            <Link
              to={signedIn ? '/upload' : '/register'}
              className="mt-8 inline-flex items-center gap-2 rounded-lg bg-indigo-500 px-6 py-3 text-sm font-semibold hover:bg-indigo-400"
            >
              {signedIn ? 'Upload a repository' : 'Create an account'}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-800 bg-slate-950/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-6 font-mono text-[11px] text-slate-500 md:px-8">
          <span className="flex items-center gap-2">
            <BrandMark /> CodeBase Analysis
          </span>
          <span className="ml-auto">Static analysis only: repository code is never run.</span>
        </div>
      </footer>
    </div>
  )
}
