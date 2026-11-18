import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ArchitectureReport } from '../components/ArchitectureReport'
import { ErrorMessage } from '../components/ErrorMessage'
import { RepositorySectionShell } from '../components/RepositorySectionShell'
import { useAnalysisRuns } from '../hooks/useAnalysisRuns'
import { useRunArchitecture } from '../hooks/useArchitecture'
import { getErrorMessage } from '../services/client'
import { formatDateTime } from '../utils/format'

function RunArchitecture({ projectId, repositoryId, runId }: { projectId: string; repositoryId: string; runId: string }) {
  const report = useRunArchitecture(projectId, repositoryId, runId)
  if (report.isPending) return <p className="text-sm text-slate-400">Loading architecture…</p>
  if (report.isError) return <ErrorMessage message={getErrorMessage(report.error, 'Could not load the architecture')} />
  return <ArchitectureReport document={report.data.document} projectId={projectId} repositoryId={repositoryId} />
}

function Architecture({ projectId, repositoryId }: { projectId: string; repositoryId: string }) {
  const runs = useAnalysisRuns(projectId, repositoryId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const history = runs.data?.runs ?? []
  const run = history.find((entry) => entry.id === selectedId) ?? history[0]
  const analysisPage = `/projects/${projectId}/repositories/${repositoryId}/analysis`

  return (
    <section aria-label="Architecture" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Architecture</h2>
          <p className="mt-1 text-xs text-slate-400">
            Components and the imports between them, technologies, data stores, API routes, entry
            points and infrastructure, each linked to the code it comes from.
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
          to see the architecture.
        </p>
      )}
      {run && !run.architecture && (
        <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
          This run was stored before architecture analysis existed.{' '}
          <Link to={analysisPage} className="text-indigo-300 hover:underline">
            Run a new full analysis
          </Link>{' '}
          to see its architecture.
        </p>
      )}
      {run?.architecture && (
        <>
          <p className="text-xs text-slate-500">Analyzed {formatDateTime(run.created_at)}</p>
          <RunArchitecture key={run.id} projectId={projectId} repositoryId={repositoryId} runId={run.id} />
        </>
      )}
    </section>
  )
}

export function RepositoryArchitecturePage() {
  return (
    <RepositorySectionShell>
      {({ projectId, repositoryId }) => <Architecture projectId={projectId} repositoryId={repositoryId} />}
    </RepositorySectionShell>
  )
}
