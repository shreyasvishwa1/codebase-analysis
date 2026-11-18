import { Package, UploadCloud } from 'lucide-react'
import { Link } from 'react-router-dom'

import { outdatedCount, VULNERABILITY_SEVERITIES, VulnerabilityBadge } from '../components/DependencyReport'
import { ErrorMessage } from '../components/ErrorMessage'
import { useDependencyOverview } from '../hooks/useDependencyAnalysis'
import { getErrorMessage } from '../services/client'
import { formatDateTime } from '../utils/format'

const number = (value: number) => value.toLocaleString('en-US')

export function DependenciesPage() {
  const overview = useDependencyOverview()
  const repositories = overview.data?.repositories ?? []
  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="page-eyebrow">Module 6</p>
        <h1 className="page-title">Dependencies</h1>
        <p className="page-lede">
          Dependency health from each repository&apos;s latest full analysis: declared packages,
          available updates from PyPI and npm, known vulnerabilities from OSV.dev and conflicting
          declarations.
        </p>
      </div>

      {overview.isPending && <p className="text-sm text-slate-400">Loading dependency results…</p>}
      {overview.isError && (
        <ErrorMessage message={getErrorMessage(overview.error, 'Could not load dependency results')} />
      )}
      {overview.data && repositories.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">
          <UploadCloud className="mx-auto h-8 w-8 text-indigo-300" aria-hidden="true" />
          <p className="mt-3 text-sm text-slate-300">
            No dependency results yet. Upload a repository and run a full analysis.
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
        <ul aria-label="Repositories with dependencies" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {repositories.map((entry) => {
            const summary = entry.dependencies
            return (
              <li key={entry.repository_id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-glow">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-slate-100">{entry.repository_name}</h2>
                    <p className="truncate text-xs text-slate-400">
                      {entry.project_name} · {formatDateTime(entry.created_at)}
                    </p>
                  </div>
                  <Link
                    to={`/projects/${entry.project_id}/repositories/${entry.repository_id}/dependencies`}
                    aria-label={`View the dependencies of ${entry.repository_name}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                  >
                    <Package className="h-4 w-4" aria-hidden="true" /> View report
                  </Link>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400">Dependencies</dt>
                    <dd className="text-xl font-bold tabular-nums text-slate-50">{number(summary.dependencies)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Vulnerable</dt>
                    <dd className="text-xl font-bold tabular-nums text-slate-50">{number(summary.vulnerable_dependencies)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Outdated</dt>
                    <dd className="text-xl font-bold tabular-nums text-slate-50">{number(outdatedCount(summary))}</dd>
                  </div>
                </dl>
                <p className="mt-3 flex flex-wrap gap-2" aria-label="Vulnerabilities by severity">
                  {VULNERABILITY_SEVERITIES.map((severity) => (
                    <span key={severity} className="inline-flex items-center gap-1 text-xs text-slate-300">
                      <VulnerabilityBadge severity={severity} />
                      <span className="tabular-nums">{number(summary.by_severity[severity])}</span>
                    </span>
                  ))}
                </p>
                {summary.lookups.registry === 'disabled' && (
                  <p className="mt-2 text-xs text-slate-500">Lookups are turned off: declarations only.</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
