import {
  FileSearch,
  FolderGit2,
  Gauge,
  HeartPulse,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  MessagesSquare,
  Moon,
  Network,
  Package,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  UploadCloud,
  X,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { BrandMark } from '../components/AuthLayout'
import { CommandPalette, type PaletteLink } from '../components/CommandPalette'
import { PageSkeleton } from '../components/PageSkeleton'
import { useAuth } from '../hooks/useAuth'
import { useHealth } from '../hooks/useHealth'
import { useTheme } from '../hooks/useTheme'
import { preloadPagesWhenIdle } from '../routes/pages'
import { prefetchPage } from '../utils/prefetch'

function HealthIndicator() {
  const health = useHealth()
  const online = health.data?.status === 'ok'
  const label = health.isPending ? 'Checking backend…' : online ? 'Backend online' : 'Backend offline'
  return (
    <span className="inline-flex items-center gap-1.5" role="status">
      <span aria-hidden="true" className={`led ${online ? 'text-emerald-400' : health.isPending ? 'text-slate-500' : 'text-red-400'}`} />
      {label}
    </span>
  )
}

/** Main navigation: the workspace, then one entry per analysis module, then the account. */
const SECTIONS: { title: string; links: PaletteLink[] }[] = [
  {
    title: 'Workspace',
    links: [
      { to: '/overview', label: 'Overview', icon: LayoutDashboard },
      { to: '/projects', label: 'My Projects', icon: FolderGit2 },
      { to: '/upload', label: 'Upload Repository', icon: UploadCloud },
    ],
  },
  {
    title: 'Analysis',
    links: [
      { to: '/code-analysis', label: 'Code Analysis', icon: FileSearch },
      { to: '/security', label: 'Security', icon: ShieldCheck },
      { to: '/complexity', label: 'Complexity', icon: Gauge },
      { to: '/dependencies', label: 'Dependencies', icon: Package },
      { to: '/architecture', label: 'Architecture', icon: Network },
    ],
  },
  {
    title: 'Insights',
    links: [
      { to: '/health-score', label: 'Health Score', icon: HeartPulse },
      { to: '/chat', label: 'AI Chat', icon: MessagesSquare },
      { to: '/history', label: 'History & Reports', icon: History },
    ],
  },
  { title: 'Account', links: [{ to: '/settings', label: 'Settings', icon: Settings }] },
]
const PAGES = SECTIONS.flatMap((section) => section.links)

function MainNavigation({ className, onNavigate }: { className: string; onNavigate?: () => void }) {
  const queryClient = useQueryClient()
  return (
    <nav aria-label="Main navigation" className={className}>
      {SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="px-3 pb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">{section.title}</p>
          {/* A bus trace runs down each section; every page hangs off it on a pad. */}
          <div className="relative space-y-0.5 before:absolute before:bottom-3 before:left-[19px] before:top-3 before:w-px before:bg-slate-700">
            {section.links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onNavigate}
                onMouseEnter={() => prefetchPage(queryClient, to)}
                onFocus={() => prefetchPage(queryClient, to)}
                className={({ isActive }) =>
                  `group relative flex items-center gap-2.5 rounded-md py-1.5 pl-9 pr-3 text-[13px] font-medium transition ${isActive ? 'bg-slate-800/70 text-slate-50' : 'text-slate-400 hover:bg-slate-900/80 hover:text-slate-100'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden="true"
                      className={`absolute left-[16px] top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full border transition ${isActive ? 'border-indigo-300 bg-indigo-400 shadow-[0_0_10px_2px_rgb(var(--indigo-500)/0.55)]' : 'border-slate-600 bg-slate-950 group-hover:border-indigo-500'}`}
                    />
                    <span aria-hidden="true" className={`absolute left-[23px] top-1/2 h-px w-2 ${isActive ? 'bg-indigo-400' : 'bg-slate-700'}`} />
                    <Icon className={`h-4 w-4 ${isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'}`} aria-hidden="true" />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const Icon = theme === 'dark' ? Sun : Moon
  const label = theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-100"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  )
}

export function AppShell() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const closePalette = useCallback(() => setPaletteOpen(false), [])

  // Every page's file downloads in the background once the browser is idle.
  useEffect(() => preloadPagesWhenIdle(), [])

  // Ctrl+K or Cmd+K anywhere opens (or closes) the command palette.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A new page closes the mobile menu and starts at the top (instantly, not smooth-scrolled).
  useEffect(() => {
    setMenuOpen(false)
    if (!/jsdom/i.test(navigator.userAgent)) window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname])

  const name = user ? user.display_name ?? user.email : ''
  return (
    <div className="pcb-surface flex min-h-screen bg-slate-950">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-950/90 md:flex">
        <Link to="/overview" className="flex h-14 items-center gap-2.5 border-b border-slate-800 px-4 text-sm font-semibold tracking-tight text-slate-50">
          <BrandMark />
          CodeBase Analysis
        </Link>
        <MainNavigation className="flex-1 space-y-5 overflow-y-auto px-2 py-4" />
        {user && (
          <div className="flex items-center gap-2 border-t border-slate-800 p-2">
            <Link
              to="/settings"
              title={user.email}
              aria-label={`Account settings for ${name}`}
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-slate-300 hover:bg-slate-900"
            >
              <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-700 bg-slate-900 font-mono text-xs font-semibold uppercase text-indigo-300">
                {name.charAt(0)}
              </span>
              <span className="truncate">{name}</span>
            </Link>
            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-900 hover:text-slate-100"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-800 bg-slate-950/85 px-4 backdrop-blur md:px-8">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Close the menu' : 'Open the menu'}
            aria-expanded={menuOpen}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-800 text-slate-300 md:hidden"
          >
            {menuOpen ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
          </button>
          <Link to="/overview" className="md:hidden" aria-label="CodeBase Analysis home">
            <BrandMark />
          </Link>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900/60 px-3 text-left text-sm text-slate-500 hover:border-slate-700 hover:text-slate-300 md:max-w-md"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">Search or jump to…</span>
            <span className="kbd hidden sm:inline-flex">Ctrl K</span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>

        {menuOpen && (
          <div className="border-b border-slate-800 bg-slate-950 px-2 py-3 md:hidden">
            <MainNavigation className="space-y-4" onNavigate={() => setMenuOpen(false)} />
            {user && (
              <button
                type="button"
                onClick={logout}
                className="mt-4 flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] text-slate-400 hover:bg-slate-900"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out of {name}
              </button>
            )}
          </div>
        )}

        <main key={location.pathname} className="mx-auto w-full max-w-6xl flex-1 animate-fade-in px-4 py-8 md:px-8">
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </main>

        <footer className="sticky bottom-0 flex h-8 items-center gap-4 border-t border-slate-800 bg-slate-950/90 px-4 font-mono text-[11px] text-slate-500 backdrop-blur md:px-8">
          <HealthIndicator />
          <span className="hidden sm:inline">Static analysis: repository code is never run</span>
          <button type="button" onClick={() => setPaletteOpen(true)} className="ml-auto hover:text-slate-300">
            <span className="kbd">Ctrl K</span> commands
          </button>
        </footer>
      </div>

      <CommandPalette open={paletteOpen} onClose={closePalette} pages={PAGES} onSignOut={logout} />
    </div>
  )
}
