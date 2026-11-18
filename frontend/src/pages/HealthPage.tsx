import { HeartPulse, UploadCloud } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ErrorMessage } from '../components/ErrorMessage'
import { DIMENSION_KEYS, DIMENSION_NAMES, ScoreGauge, scoreTone } from '../components/HealthReport'
import { HealthWeightsEditor } from '../components/HealthWeightsEditor'
import { useHealthOverview } from '../hooks/useHealthScore'
import { getErrorMessage } from '../services/client'
import { formatDateTime } from '../utils/format'

export function HealthPage() {
  const overview = useHealthOverview()
  const repositories = overview.data?.repositories ?? []
  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="page-eyebrow">Module 8</p>
        <h1 className="page-title">Code Health Score</h1>
        <p className="page-lede">
          One score from 0 to 100 for each repository&apos;s latest full analysis: a weighted average
          of security, code quality, complexity, maintainability, dependency health and
          architecture. Every dimension shows its inputs and how it was calculated.
        </p>
      </div>

      {overview.isPending && <p className="text-sm text-slate-400">Loading health scores…</p>}
      {overview.isError && (
        <ErrorMessage message={getErrorMessage(overview.error, 'Could not load health scores')} />
      )}
      {overview.data && repositories.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">
          <UploadCloud className="mx-auto h-8 w-8 text-indigo-300" aria-hidden="true" />
          <p className="mt-3 text-sm text-slate-300">
            No health scores yet. Upload a repository and run a full analysis.
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
        <ul aria-label="Scored repositories" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {repositories.map((entry) => (
            <li key={entry.repository_id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-glow">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-slate-100">{entry.repository_name}</h2>
                  <p className="truncate text-xs text-slate-400">
                    {entry.project_name} · {formatDateTime(entry.created_at)}
                  </p>
                </div>
                <Link
                  to={`/projects/${entry.project_id}/repositories/${entry.repository_id}/health`}
                  aria-label={`View the health score of ${entry.repository_name}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                >
                  <HeartPulse className="h-4 w-4" aria-hidden="true" /> Details
                </Link>
              </div>
              <div className="mt-4 flex items-center gap-5">
                <ScoreGauge score={entry.overall} grade={entry.grade} size={96} />
                <dl aria-label={`${entry.repository_name} dimensions`} className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  {DIMENSION_KEYS.map((key) => {
                    const score = entry.scores[key]
                    return (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <dt className="truncate text-xs text-slate-400">{DIMENSION_NAMES[key]}</dt>
                        <dd className={`font-semibold tabular-nums ${scoreTone(score).text}`}>{score ?? '—'}</dd>
                      </div>
                    )
                  })}
                </dl>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section id="weights" aria-label="Weights" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Weights</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-400">
            How much each dimension counts in the overall score. Weights are relative: a dimension
            counts its weight divided by the total weight of the dimensions scored for that run,
            and a dimension that does not apply (for example no declared dependencies) is left out.
            They apply to every repository you own.
          </p>
        </div>
        <HealthWeightsEditor />
      </section>
    </div>
  )
}
