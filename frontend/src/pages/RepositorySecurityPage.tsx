import { useState } from 'react'
import { Link } from 'react-router-dom'

import { ErrorMessage } from '../components/ErrorMessage'
import { RepositorySectionShell } from '../components/RepositorySectionShell'
import { SecurityReport } from '../components/SecurityReport'
import { useAnalysisRuns } from '../hooks/useAnalysisRuns'
import { getErrorMessage } from '../services/client'
import { formatDateTime } from '../utils/format'

function Security({ projectId, repositoryId }: { projectId: string; repositoryId: string }) {
  const runs = useAnalysisRuns(projectId, repositoryId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const history = runs.data?.runs ?? []
  const run = history.find((entry) => entry.id === selectedId) ?? history[0]
  const analysisPage = `/projects/${projectId}/repositories/${repositoryId}/analysis`

  return (
    <section aria-label="Security" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Security</h2>
          <p className="mt-1 text-xs text-slate-400">
            Committed secrets, injection and XSS risks, insecure configuration and containers,
            mapped to the OWASP Top 10. Repository code is never run.
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
          to see security findings.
        </p>
      )}
      {run && !run.security && (
        <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
          This run was stored before security analysis existed.{' '}
          <Link to={analysisPage} className="text-indigo-300 hover:underline">
            Run a new full analysis
          </Link>{' '}
          to see its findings.
        </p>
      )}
      {run?.security && (
        <>
          <p className="text-xs text-slate-500">Analyzed {formatDateTime(run.created_at)}</p>
          <SecurityReport
            key={run.id}
            projectId={projectId}
            repositoryId={repositoryId}
            runId={run.id}
            summary={run.security}
          />
        </>
      )}
    </section>
  )
}

export function RepositorySecurityPage() {
  return (
    <RepositorySectionShell>
      {({ projectId, repositoryId }) => <Security projectId={projectId} repositoryId={repositoryId} />}
    </RepositorySectionShell>
  )
}
