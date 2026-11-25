import { useState } from 'react'
import { Link } from 'react-router-dom'

import { DependencyReport } from '../components/DependencyReport'
import { ErrorMessage } from '../components/ErrorMessage'
import { RepositorySectionShell } from '../components/RepositorySectionShell'
import { RunTrend } from '../components/RunTrend'
import { useAnalysisRuns } from '../hooks/useAnalysisRuns'
import { getErrorMessage } from '../services/client'
import { formatDateTime } from '../utils/format'

function Dependencies({ projectId, repositoryId }: { projectId: string; repositoryId: string }) {
  const runs = useAnalysisRuns(projectId, repositoryId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const history = runs.data?.runs ?? []
  const run = history.find((entry) => entry.id === selectedId) ?? history[0]
  const analysisPage = `/projects/${projectId}/repositories/${repositoryId}/analysis`

  return (
    <section aria-label="Dependency analysis" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Dependencies</h2>
          <p className="mt-1 text-xs text-slate-400">
            Declared packages with their versions, available updates (PyPI, npm) and known
            vulnerabilities (OSV.dev). Packages are never installed or run.
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
          to see dependency health.
        </p>
      )}
      {run && !run.dependencies && (
        <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
          This run was stored before dependency analysis existed.{' '}
          <Link to={analysisPage} className="text-indigo-300 hover:underline">
            Run a new full analysis
          </Link>{' '}
          to see its dependencies.
        </p>
      )}
      {run?.dependencies && (
        <>
          <p className="text-xs text-slate-500">Analyzed {formatDateTime(run.created_at)}</p>
          <RunTrend
            history={history}
            runId={run.id}
            metrics={[
              { label: 'Vulnerable dependencies', value: (entry) => entry.dependencies?.vulnerable_dependencies },
              { label: 'Known vulnerabilities', value: (entry) => entry.dependencies?.vulnerabilities },
            ]}
          />
          <DependencyReport
            key={run.id}
            projectId={projectId}
            repositoryId={repositoryId}
            runId={run.id}
            summary={run.dependencies}
          />
        </>
      )}
    </section>
  )
}

export function RepositoryDependenciesPage() {
  return (
    <RepositorySectionShell>
      {({ projectId, repositoryId }) => <Dependencies projectId={projectId} repositoryId={repositoryId} />}
    </RepositorySectionShell>
  )
}
