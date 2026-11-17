import { FileSearch, FolderTree, Gauge, ShieldCheck } from 'lucide-react'
import { NavLink } from 'react-router-dom'

/**
 * Sections of one repository's workspace. A section is listed only once its module works;
 * later phases add Code Analysis, Security, Complexity and the others here.
 */
export function RepositoryNav({ projectId, repositoryId }: { projectId: string; repositoryId: string }) {
  const base = `/projects/${projectId}/repositories/${repositoryId}`
  const sections = [
    { to: base, label: 'Explorer', icon: FolderTree, end: true },
    { to: `${base}/analysis`, label: 'Full analysis', icon: Gauge, end: false },
    { to: `${base}/code-analysis`, label: 'Code analysis', icon: FileSearch, end: false },
    { to: `${base}/security`, label: 'Security', icon: ShieldCheck, end: false },
  ]
  return (
    <nav aria-label="Repository sections" className="flex flex-wrap gap-2">
      {sections.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${isActive ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-100' : 'border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-800/60'}`
          }
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
