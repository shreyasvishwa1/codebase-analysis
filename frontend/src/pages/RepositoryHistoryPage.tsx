import { HistoryPanel } from '../components/HistoryPanel'
import { RepositorySectionShell } from '../components/RepositorySectionShell'

export function RepositoryHistoryPage() {
  return (
    <RepositorySectionShell>
      {({ projectId, repositoryId }) => <HistoryPanel repository={{ projectId, repositoryId }} />}
    </RepositorySectionShell>
  )
}
