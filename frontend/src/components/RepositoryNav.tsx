import { Activity, ChevronLeft, ChevronRight, FileSearch, FolderTree, Gauge, HeartPulse, History, MessagesSquare, Network, Package, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'

/** How much of the visible width one arrow press scrolls. */
export const SCROLL_SHARE = 0.6

/** Which sides of a scrolling row have more out of view (a pixel of slack for rounding). */
export function overflowSides(element: Pick<HTMLElement, 'scrollLeft' | 'scrollWidth' | 'clientWidth'>): { left: boolean; right: boolean } {
  return {
    left: element.scrollLeft > 1,
    right: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
  }
}

/** Sections of one repository's workspace: the explorer, then one per analysis module. When
 * they do not all fit, the edges fade and arrows scroll them; the current one is brought into
 * view. */
export function RepositoryNav({ projectId, repositoryId }: { projectId: string; repositoryId: string }) {
  const base = `/projects/${projectId}/repositories/${repositoryId}`
  const sections = [
    { to: base, label: 'Explorer', icon: FolderTree, end: true },
    { to: `${base}/analysis`, label: 'Full analysis', icon: Gauge, end: false },
    { to: `${base}/code-analysis`, label: 'Code analysis', icon: FileSearch, end: false },
    { to: `${base}/security`, label: 'Security', icon: ShieldCheck, end: false },
    { to: `${base}/complexity`, label: 'Complexity', icon: Activity, end: false },
    { to: `${base}/dependencies`, label: 'Dependencies', icon: Package, end: false },
    { to: `${base}/architecture`, label: 'Architecture', icon: Network, end: false },
    { to: `${base}/health`, label: 'Health score', icon: HeartPulse, end: false },
    { to: `${base}/chat`, label: 'AI chat', icon: MessagesSquare, end: false },
    { to: `${base}/history`, label: 'History & reports', icon: History, end: false },
  ]
  const row = useRef<HTMLElement>(null)
  const [sides, setSides] = useState({ left: false, right: false })
  const { pathname } = useLocation()

  const measure = useCallback(() => {
    if (row.current) setSides(overflowSides(row.current))
  }, [])

  useEffect(() => {
    const element = row.current
    if (!element) return
    measure()
    element.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      element.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  // The current section is brought into view (for example "History & reports" on a narrow screen).
  useEffect(() => {
    row.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    measure()
  }, [pathname, measure])

  const scroll = (direction: -1 | 1) => {
    const element = row.current
    if (element) element.scrollBy?.({ left: direction * element.clientWidth * SCROLL_SHARE, behavior: 'smooth' })
  }

  return (
    <div className="relative -mb-px">
      <nav ref={row} aria-label="Repository sections" className="scrollbar-none flex gap-1 overflow-x-auto border-b border-slate-800">
        {sections.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition ${isActive ? 'border-indigo-500 text-slate-50' : 'border-transparent text-slate-400 hover:border-slate-700 hover:text-slate-200'}`
            }
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
      {sides.left && (
        <div className="pointer-events-none absolute inset-y-0 left-0 flex w-14 items-center bg-gradient-to-r from-slate-950 via-slate-950/80 to-transparent">
          <button
            type="button"
            onClick={() => scroll(-1)}
            aria-label="Show earlier sections"
            className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-slate-50"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {sides.right && (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-14 items-center justify-end bg-gradient-to-l from-slate-950 via-slate-950/80 to-transparent">
          <button
            type="button"
            onClick={() => scroll(1)}
            aria-label="Show more sections"
            className="pointer-events-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-slate-50"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
