import { Gauge, UploadCloud } from 'lucide-react'
import { Link } from 'react-router-dom'

import { LEVEL_LABELS, RANKS, RankBadge } from '../components/ComplexityReport'
import { ErrorMessage } from '../components/ErrorMessage'
import { useComplexityOverview } from '../hooks/useComplexity'
import { getErrorMessage } from '../services/client'
import { formatDateTime } from '../utils/format'

const number = (value: number) => value.toLocaleString('en-US')

export function ComplexityPage() {
  const overview = useComplexityOverview()
  const repositories = overview.data?.repositories ?? []
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-amber-600/20 via-violet-600/15 to-cyan-500/10 p-8">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">Module 5</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Complexity</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-300">
          Complexity and maintainability from each repository&apos;s latest full analysis:
          cyclomatic complexity per function, the maintainability index per file, functions,
          classes and lines of code.
        </p>
      </div>

      {overview.isPending && <p className="text-sm text-slate-400">Loading complexity results…</p>}
      {overview.isError && (
        <ErrorMessage message={getErrorMessage(overview.error, 'Could not load complexity results')} />
      )}
      {overview.data && repositories.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">
          <UploadCloud className="mx-auto h-8 w-8 text-indigo-300" aria-hidden="true" />
          <p className="mt-3 text-sm text-slate-300">
            No complexity results yet. Upload a repository and run a full analysis.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Link to="/upload" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">
              Upload a repository
            </Link>
            <Link to="/projects" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">
              My projects
            </Link>
          </div>
        </div>
      )}
      {repositories.length > 0 && (
        <ul aria-label="Measured repositories" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {repositories.map((entry) => {
            const summary = entry.complexity
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
                    to={`/projects/${entry.project_id}/repositories/${entry.repository_id}/complexity`}
                    aria-label={`View the complexity report of ${entry.repository_name}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                  >
                    <Gauge className="h-4 w-4" aria-hidden="true" /> View report
                  </Link>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400">Average complexity</dt>
                    <dd className="text-xl font-bold tabular-nums text-white">{summary.average_cyclomatic.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Maintainability</dt>
                    <dd className="text-xl font-bold tabular-nums text-white">
                      {summary.maintainability_index === null ? '—' : summary.maintainability_index.toFixed(1)}
                    </dd>
                    {summary.maintainability && (
                      <dd className="text-xs text-slate-500">{LEVEL_LABELS[summary.maintainability]}</dd>
                    )}
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Functions</dt>
                    <dd className="text-xl font-bold tabular-nums text-white">{number(summary.functions)}</dd>
                  </div>
                </dl>
                <p className="mt-3 flex flex-wrap gap-2" aria-label="Functions by complexity">
                  {RANKS.map((rank) => (
                    <span key={rank} className="inline-flex items-center gap-1 text-xs text-slate-300">
                      <RankBadge rank={rank} />
                      <span className="tabular-nums">{number(summary.functions_by_rank[rank])}</span>
                    </span>
                  ))}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
