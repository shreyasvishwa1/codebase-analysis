import { Network, UploadCloud } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ErrorMessage } from '../components/ErrorMessage'
import { useArchitectureOverview } from '../hooks/useArchitecture'
import { getErrorMessage } from '../services/client'
import { formatDateTime } from '../utils/format'
import { CountUp } from '../components/CountUp'

const number = (value: number) => value.toLocaleString('en-US')

export function ArchitecturePage() {
  const overview = useArchitectureOverview()
  const repositories = overview.data?.repositories ?? []
  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="page-eyebrow">Module 7</p>
        <h1 className="page-title">Architecture</h1>
        <p className="page-lede">
          The structure of each repository from its latest full analysis: components and their
          imports, technologies, data stores, API routes, entry points and infrastructure, all
          backed by evidence in the code.
        </p>
      </div>

      {overview.isPending && <p className="text-sm text-slate-400">Loading architecture results…</p>}
      {overview.isError && (
        <ErrorMessage message={getErrorMessage(overview.error, 'Could not load architecture results')} />
      )}
      {overview.data && repositories.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">
          <UploadCloud className="mx-auto h-8 w-8 text-indigo-300" aria-hidden="true" />
          <p className="mt-3 text-sm text-slate-300">
            No architecture results yet. Upload a repository and run a full analysis.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Link to="/upload" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-slate-50 hover:bg-indigo-500">
              Upload a repository
            </Link>
            <Link to="/projects" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">
              My projects
            </Link>
          </div>
        </div>
      )}
      {repositories.length > 0 && (
        <ul aria-label="Mapped repositories" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {repositories.map((entry) => {
            const summary = entry.architecture
            return (
              <li key={entry.repository_id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-glow">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-slate-100">{entry.repository_name}</h2>
                    <p className="truncate text-xs text-slate-400">
                      {entry.project_name} · {formatDateTime(entry.created_at)}
                    </p>
                  </div>
                  <Link
                    to={`/projects/${entry.project_id}/repositories/${entry.repository_id}/architecture`}
                    aria-label={`View the architecture of ${entry.repository_name}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                  >
                    <Network className="h-4 w-4" aria-hidden="true" /> View diagram
                  </Link>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400">Components</dt>
                    <dd className="text-xl font-bold tabular-nums text-slate-50"><CountUp>{number(summary.components)}</CountUp></dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">API routes</dt>
                    <dd className="text-xl font-bold tabular-nums text-slate-50"><CountUp>{number(summary.routes)}</CountUp></dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Cycles</dt>
                    <dd className="text-xl font-bold tabular-nums text-slate-50"><CountUp>{number(summary.cycles)}</CountUp></dd>
                  </div>
                </dl>
                {summary.technologies.length > 0 && (
                  <p aria-label="Technologies" className="mt-3 flex flex-wrap gap-1.5">
                    {summary.technologies.slice(0, 8).map((name) => (
                      <span key={name} className="rounded-full border border-slate-700 px-2 py-0.5 text-xs text-slate-200">{name}</span>
                    ))}
                    {summary.technologies.length > 8 && (
                      <span className="px-1 text-xs text-slate-500">+{summary.technologies.length - 8} more</span>
                    )}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
