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
import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { BrandMark } from '../components/AuthLayout'
import { CommandPalette, type PaletteLink } from '../components/CommandPalette'
import { useAuth } from '../hooks/useAuth'
import { useHealth } from '../hooks/useHealth'
import { useTheme } from '../hooks/useTheme'

function HealthIndicator() {
  const health = useHealth()
  const online = health.data?.status === 'ok'
  const label = health.isPending ? 'Checking backend…' : online ? 'Backend online' : 'Backend offline'
  return (
    <span className="inline-flex items-center gap-1.5" role="status">
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-400' : health.isPending ? 'bg-slate-500' : 'bg-red-400'}`} />
      </span>
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
  return (
    <nav aria-label="Main navigation" className={className}>
      {SECTIONS.map((section) => (
        <div key={section.title} className="space-y-0.5">
          <p className="px-3 pb-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">{section.title}</p>
          {section.links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onNavigate}
              className={({ isActive }) =>
                `group relative flex items-center gap-2.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition ${isActive ? 'bg-slate-800/80 text-slate-50' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-indigo-500" />}
                  <Icon className={`h-4 w-4 ${isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'}`} aria-hidden="true" />
                  {label}
                </>
              )}
            </NavLink>
          ))}
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

  // The mobile menu closes when the page changes.
  useEffect(() => setMenuOpen(false), [location.pathname])

  const name = user ? user.display_name ?? user.email : ''
  return (
    <div className="flex min-h-screen bg-slate-950">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-800 md:flex">
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
          <Outlet />
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
