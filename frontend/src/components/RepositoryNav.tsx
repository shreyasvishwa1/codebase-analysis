import { Activity, FileSearch, FolderTree, Gauge, HeartPulse, History, MessagesSquare, Network, Package, ShieldCheck } from 'lucide-react'
import { NavLink } from 'react-router-dom'

/** Sections of one repository's workspace: the explorer, then one per analysis module. */
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
  return (
    <nav aria-label="Repository sections" className="-mb-px flex gap-1 overflow-x-auto border-b border-slate-800">
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
  )
}
