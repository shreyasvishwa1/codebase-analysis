import { Link, useParams } from 'react-router-dom'

import { AnalysisRunsPanel } from '../components/AnalysisRunsPanel'
import { ErrorMessage } from '../components/ErrorMessage'
import { RepositoryNav } from '../components/RepositoryNav'
import { StatusBadge } from '../components/StatusBadge'
import { useRepository } from '../hooks/useRepository'
import { getErrorMessage } from '../services/client'

export function RepositoryAnalysisPage() {
  const { projectId = '', repositoryId = '' } = useParams()
  const repository = useRepository(projectId, repositoryId)

  if (repository.isPending) {
    return <p className="text-sm text-slate-400">Loading repository…</p>
  }
  if (repository.isError) {
    return (
      <ErrorMessage message={getErrorMessage(repository.error, 'Could not load the repository')} />
    )
  }
  const repo = repository.data
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-indigo-600/25 via-fuchsia-600/10 to-cyan-500/15 p-8">
        <Link to={`/projects/${projectId}`} className="text-sm text-indigo-300 hover:underline">
          ← Project
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">{repo.name}</h1>
          <StatusBadge status={repo.status} />
        </div>
      </div>
      <RepositoryNav projectId={projectId} repositoryId={repositoryId} />
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-glow backdrop-blur">
        <AnalysisRunsPanel projectId={projectId} repositoryId={repositoryId} repository={repo} />
      </div>
    </div>
  )
}
