import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useRepository } from '../hooks/useRepository'
import { getErrorMessage } from '../services/client'
import type { Repository } from '../types/api'
import { ErrorMessage } from './ErrorMessage'
import { RepositoryNav } from './RepositoryNav'
import { StatusBadge } from './StatusBadge'

/** The header and section navigation shared by a repository's section pages. */
export function RepositorySectionShell({
  children,
}: {
  children: (context: { projectId: string; repositoryId: string; repository: Repository }) => ReactNode
}) {
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
        {children({ projectId, repositoryId, repository: repo })}
      </div>
    </div>
  )
}
