import { AnalysisRunsPanel } from '../components/AnalysisRunsPanel'
import { RepositorySectionShell } from '../components/RepositorySectionShell'

export function RepositoryAnalysisPage() {
  return (
    <RepositorySectionShell>
      {({ projectId, repositoryId, repository }) => (
        <AnalysisRunsPanel projectId={projectId} repositoryId={repositoryId} repository={repository} />
      )}
    </RepositorySectionShell>
  )
}
