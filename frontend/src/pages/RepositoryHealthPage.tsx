import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorMessage } from '../components/ErrorMessage'
import { HealthReport, HealthTrend } from '../components/HealthReport'
import { RepositorySectionShell } from '../components/RepositorySectionShell'
import { useAnalysisRuns } from '../hooks/useAnalysisRuns'
import { useHealthHistory, useRunHealth } from '../hooks/useHealthScore'
import { getErrorMessage } from '../services/client'
import { formatDateTime } from '../utils/format'

function RunHealth({ projectId, repositoryId, runId }: { projectId: string; repositoryId: string; runId: string }) {
  const report = useRunHealth(projectId, repositoryId, runId)
  if (report.isPending) return <p className="text-sm text-slate-400">Loading the health score…</p>
  if (report.isError) return <ErrorMessage message={getErrorMessage(report.error, 'Could not load the health score')} />
  return <HealthReport report={report.data} projectId={projectId} repositoryId={repositoryId} />
}

function Trend({ projectId, repositoryId }: { projectId: string; repositoryId: string }) {
  const history = useHealthHistory(projectId, repositoryId)
  return (
    <section aria-label="Health trend" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Trend</h3>
      {history.isPending && <p className="text-sm text-slate-400">Loading the history…</p>}
      {history.isError && <ErrorMessage message={getErrorMessage(history.error, 'Could not load the history')} />}
      {history.data && <HealthTrend points={history.data.points} />}
    </section>
  )
}

function Health({ projectId, repositoryId }: { projectId: string; repositoryId: string }) {
  const runs = useAnalysisRuns(projectId, repositoryId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const all = runs.data?.runs ?? []
  // Runs stored before code-quality analysis have none of the results the score uses.
  const scorable = all.filter((entry) => entry.quality !== null)
  const run = scorable.find((entry) => entry.id === selectedId) ?? scorable[0]
  const analysisPage = `/projects/${projectId}/repositories/${repositoryId}/analysis`

  return (
    <section aria-label="Health score" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Code health score</h2>
          <p className="mt-1 text-xs text-slate-400">
            One score from 0 to 100 combining security, code quality, complexity, maintainability,
            dependency health and architecture, computed from the analysis results with your weights.
          </p>
        </div>
        {scorable.length > 1 && run && (
          <label className="text-xs text-slate-400">
            Run
            <select
              value={run.id}
              onChange={(event) => setSelectedId(event.target.value)}
              className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            >
              {scorable.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {formatDateTime(entry.created_at)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {runs.isPending && <p className="text-sm text-slate-400">Loading analysis runs…</p>}
      {runs.isError && <ErrorMessage message={getErrorMessage(runs.error, 'Could not load analysis runs')} />}
      {runs.data && all.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
          No analysis yet.{' '}
          <Link to={analysisPage} className="text-indigo-300 hover:underline">
            Run a full analysis
          </Link>{' '}
          to see the health score.
        </p>
      )}
      {all.length > 0 && !run && (
        <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
          These runs were stored before the analyses the health score uses.{' '}
          <Link to={analysisPage} className="text-indigo-300 hover:underline">
            Run a new full analysis
          </Link>{' '}
          to see the score.
        </p>
      )}
      {run && (
        <>
          <p className="text-xs text-slate-500">Analyzed {formatDateTime(run.created_at)}</p>
          <RunHealth key={run.id} projectId={projectId} repositoryId={repositoryId} runId={run.id} />
          <Trend projectId={projectId} repositoryId={repositoryId} />
        </>
      )}
    </section>
  )
}

export function RepositoryHealthPage() {
  return (
    <RepositorySectionShell>
      {({ projectId, repositoryId }) => <Health projectId={projectId} repositoryId={repositoryId} />}
    </RepositorySectionShell>
  )
}
