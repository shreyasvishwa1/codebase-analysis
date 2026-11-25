import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ComplexityReport } from '../components/ComplexityReport'
import { ErrorMessage } from '../components/ErrorMessage'
import { RepositorySectionShell } from '../components/RepositorySectionShell'
import { RunTrend } from '../components/RunTrend'
import { useAnalysisRuns } from '../hooks/useAnalysisRuns'
import { getErrorMessage } from '../services/client'
import { formatDateTime } from '../utils/format'

function Complexity({ projectId, repositoryId }: { projectId: string; repositoryId: string }) {
  const runs = useAnalysisRuns(projectId, repositoryId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const history = runs.data?.runs ?? []
  const run = history.find((entry) => entry.id === selectedId) ?? history[0]
  const analysisPage = `/projects/${projectId}/repositories/${repositoryId}/analysis`

  return (
    <section aria-label="Complexity" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Complexity</h2>
          <p className="mt-1 text-xs text-slate-400">
            Cyclomatic complexity of every function, maintainability of every file, functions,
            classes and lines of code. Repository code is never run.
          </p>
        </div>
        {history.length > 1 && run && (
          <label className="text-xs text-slate-400">
            Run
            <select
              value={run.id}
              onChange={(event) => setSelectedId(event.target.value)}
              className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            >
              {history.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {formatDateTime(entry.created_at)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {runs.isPending && <p className="text-sm text-slate-400">Loading analysis runs…</p>}
      {runs.isError && (
        <ErrorMessage message={getErrorMessage(runs.error, 'Could not load analysis runs')} />
      )}
      {runs.data && !run && (
        <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
          No analysis yet.{' '}
          <Link to={analysisPage} className="text-indigo-300 hover:underline">
            Run a full analysis
          </Link>{' '}
          to see complexity metrics.
        </p>
      )}
      {run && !run.complexity && (
        <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
          This run was stored before complexity analysis existed.{' '}
          <Link to={analysisPage} className="text-indigo-300 hover:underline">
            Run a new full analysis
          </Link>{' '}
          to see its metrics.
        </p>
      )}
      {run?.complexity && (
        <>
          <p className="text-xs text-slate-500">Analyzed {formatDateTime(run.created_at)}</p>
          <RunTrend
            history={history}
            runId={run.id}
            metrics={[
              { label: 'Highly complex functions', value: (entry) => entry.complexity?.functions_by_rank.high },
              { label: 'Average complexity', value: (entry) => entry.complexity?.average_cyclomatic, decimals: 2 },
            ]}
          />
          <ComplexityReport
            key={run.id}
            projectId={projectId}
            repositoryId={repositoryId}
            runId={run.id}
            summary={run.complexity}
            duplication={run.quality?.duplication.percent ?? null}
          />
        </>
      )}
    </section>
  )
}

export function RepositoryComplexityPage() {
  return (
    <RepositorySectionShell>
      {({ projectId, repositoryId }) => <Complexity projectId={projectId} repositoryId={repositoryId} />}
    </RepositorySectionShell>
  )
}
