import { MessagesSquare, UploadCloud } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ErrorMessage } from '../components/ErrorMessage'
import { useChatOverview } from '../hooks/useChat'
import { getErrorMessage } from '../services/client'
import { formatDateTime } from '../utils/format'

const number = (value: number) => value.toLocaleString('en-US')

export function ChatPage() {
  const overview = useChatOverview()
  const repositories = overview.data?.repositories ?? []
  const conversations = overview.data?.conversations ?? []
  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="page-eyebrow">Module 9</p>
        <h1 className="page-title">AI Chat</h1>
        <p className="page-lede">
          Ask questions about a repository in plain language. Answers are built from the
          passages of code that match the question and from the results of its latest full
          analysis, and they cite the files and lines they rely on.
        </p>
      </div>

      {overview.isPending && <p className="text-sm text-slate-400">Loading the AI chat…</p>}
      {overview.isError && <ErrorMessage message={getErrorMessage(overview.error, 'Could not load the AI chat')} />}
      {overview.data && !overview.data.configured && (
        <p role="note" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          The AI chat is not configured on this server: an administrator needs to set
          ANTHROPIC_API_KEY or GEMINI_API_KEY. Earlier conversations can still be read.
        </p>
      )}

      {overview.data && repositories.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">
          <UploadCloud className="mx-auto h-8 w-8 text-indigo-300" aria-hidden="true" />
          <p className="mt-3 text-sm text-slate-300">
            No repository is ready to chat about yet. Upload a repository and run a full analysis.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Link to="/upload" className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-slate-50 hover:bg-indigo-500">
              Upload a repository
            </Link>
            <Link to="/projects" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">
              My projects
            </Link>
          </div>
        </div>
      )}

      {repositories.length > 0 && (
        <section aria-label="Repositories ready to chat" className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Repositories</h2>
          <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {repositories.map((entry) => (
              <li key={entry.repository_id} className="flex min-w-0 items-start justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-slate-100">{entry.repository_name}</h3>
                  <p className="truncate text-xs text-slate-400">
                    {entry.project_name} · analyzed {formatDateTime(entry.created_at)}
                  </p>
                  <p className="mt-2 text-sm text-slate-300">
                    {number(entry.chunks)} passages from {number(entry.files)} files
                  </p>
                </div>
                <Link
                  to={`/projects/${entry.project_id}/repositories/${entry.repository_id}/chat`}
                  aria-label={`Chat about ${entry.repository_name}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                >
                  <MessagesSquare className="h-4 w-4" aria-hidden="true" /> Chat
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {conversations.length > 0 && (
        <section aria-label="Recent conversations" className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Recent conversations</h2>
          <ul className="divide-y divide-slate-800 rounded-2xl border border-slate-800 bg-slate-900/70">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  to={`/projects/${conversation.project_id}/repositories/${conversation.repository_id}/chat?conversation=${conversation.id}`}
                  className="flex min-w-0 items-center justify-between gap-3 px-5 py-3 hover:bg-slate-800/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-100">{conversation.title}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {conversation.repository_name} · {conversation.message_count} messages
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">{formatDateTime(conversation.updated_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
