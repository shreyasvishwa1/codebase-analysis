import { ChatPanel } from '../components/ChatPanel'
import { RepositorySectionShell } from '../components/RepositorySectionShell'

export function RepositoryChatPage() {
  return (
    <RepositorySectionShell>
      {({ projectId, repositoryId }) => (
        <section aria-label="AI chat" className="space-y-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">AI chat</h2>
            <p className="mt-1 text-xs text-slate-400">
              Questions about this repository, answered from its code and analysis results with
              citations to the files and lines used.
            </p>
          </div>
          <ChatPanel projectId={projectId} repositoryId={repositoryId} />
        </section>
      )}
    </RepositorySectionShell>
  )
}
