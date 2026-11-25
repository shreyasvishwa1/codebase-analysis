import { Bot, FileCode2, Loader2, MessageSquarePlus, Send, Trash2, User } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { useAnalysisRuns } from '../hooks/useAnalysisRuns'
import {
  useAskQuestion,
  useChatStatus,
  useConversation,
  useConversations,
  useDeleteConversation,
  useStartConversation,
} from '../hooks/useChat'
import { getErrorMessage } from '../services/client'
import type { ChatCitation, ChatTurn } from '../types/api'
import { chatSuggestions, GENERAL_SUGGESTIONS } from '../utils/chatSuggestions'
import { formatDateTime } from '../utils/format'
import { ErrorMessage } from './ErrorMessage'

export const MAX_QUESTION_CHARS = 2000
/** The questions suggested when the analysis has nothing more specific to point at. */
export const SUGGESTIONS = GENERAL_SUGGESTIONS

// Citations ([1], or lists such as [1, 3]), `code` and **bold**.
const TOKEN = /(\[\d{1,2}(?:\s*,\s*\d{1,2})*\]|`[^`\n]+`|\*\*[^*\n]+\*\*)/
const HEADING = /^#{1,6}\s+/

function CitationLink({ citation, explorer, children }: { citation: ChatCitation; explorer: string; children: ReactNode }) {
  return (
    <Link
      to={explorer}
      state={{ openFile: { path: citation.path, line: citation.start_line } }}
      className="text-indigo-300 hover:underline"
      aria-label={`Source ${citation.n}: ${citation.path} line ${citation.start_line}`}
    >
      {children}
    </Link>
  )
}

function inline(text: string, citations: Map<number, ChatCitation>, explorer: string): ReactNode[] {
  return text.split(TOKEN).map((part, index) => {
    const marker = /^\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]$/.exec(part)
    if (marker) {
      const numbers = marker[1].split(',').map((item) => Number(item.trim()))
      if (!numbers.some((n) => citations.has(n))) return part // cites nothing that exists
      return (
        <sup key={index}>
          {numbers.map((n, position) => {
            const citation = citations.get(n)
            return (
              <span key={position}>
                {position > 0 && ' '}
                {citation ? <CitationLink citation={citation} explorer={explorer}>[{n}]</CitationLink> : `[${n}]`}
              </span>
            )
          })}
        </sup>
      )
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded bg-slate-800 px-1 py-0.5 font-mono text-[0.85em] text-slate-100">
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-slate-100">
          {inline(part.slice(2, -2), citations, explorer)}
        </strong>
      )
    }
    return part
  })
}

/** An answer as paragraphs, "- " lists, headings and **bold**, with [n] and [n, m] citations
 * linked to the code. Text only: nothing in the answer is interpreted as HTML. */
export function AnswerText({ text, citations, explorer }: { text: string; citations: ChatCitation[]; explorer: string }) {
  const byNumber = new Map(citations.map((c) => [c.n, c]))
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let items: string[] = []
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '), byNumber, explorer)}</p>)
      paragraph = []
    }
  }
  const flushList = () => {
    if (items.length) {
      blocks.push(
        <ul key={blocks.length} className="list-disc space-y-1 pl-5">
          {items.map((item, index) => (
            <li key={index}>{inline(item, byNumber, explorer)}</li>
          ))}
        </ul>,
      )
      items = []
    }
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (HEADING.test(trimmed)) {
      // Models sometimes write Markdown headings: shown as a bold line of its own.
      flushParagraph()
      flushList()
      blocks.push(
        <p key={blocks.length} className="font-semibold text-slate-100">
          {inline(trimmed.replace(HEADING, ''), byNumber, explorer)}
        </p>,
      )
    } else if (/^[-*] /.test(trimmed)) {
      flushParagraph()
      items.push(trimmed.slice(2))
    } else if (!trimmed) {
      flushParagraph()
      flushList()
    } else {
      flushList()
      paragraph.push(trimmed)
    }
  }
  flushParagraph()
  flushList()
  return <div className="space-y-2">{blocks}</div>
}

function Message({ message, explorer }: { message: ChatTurn; explorer: string }) {
  if (message.role === 'user') {
    return (
      <li className="flex justify-end gap-2">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-indigo-600/80 px-4 py-2 text-sm text-slate-50">
          {message.content}
        </p>
        <User className="mt-1 h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
      </li>
    )
  }
  return (
    <li className="flex gap-2">
      <Bot className="mt-1 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
      <article aria-label="Answer" className="min-w-0 max-w-[90%] rounded-2xl rounded-tl-sm border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-200">
        <AnswerText text={message.content} citations={message.citations} explorer={explorer} />
        {message.citations.length > 0 && (
          <ol aria-label="Sources" className="mt-3 space-y-1 border-t border-slate-800 pt-2 text-xs">
            {message.citations.map((citation) => (
              <li key={citation.n} className="flex min-w-0 items-center gap-1.5">
                <span className="tabular-nums text-slate-500">[{citation.n}]</span>
                <CitationLink citation={citation} explorer={explorer}>
                  <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                    <FileCode2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {citation.path}:{citation.start_line}
                      {citation.end_line > citation.start_line ? `-${citation.end_line}` : ''}
                    </span>
                  </span>
                </CitationLink>
                {citation.symbol && <span className="truncate text-slate-500">{citation.symbol}</span>}
              </li>
            ))}
          </ol>
        )}
      </article>
    </li>
  )
}

function Composer({
  disabled,
  pending,
  onSend,
  initial,
}: {
  disabled: boolean
  pending: boolean
  onSend: (question: string) => void
  initial: string
}) {
  const [draft, setDraft] = useState(initial)
  const question = draft.trim()
  const tooLong = draft.length > MAX_QUESTION_CHARS
  const canSend = !disabled && !pending && question.length > 0 && !tooLong

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (canSend) {
      onSend(question)
      setDraft('')
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={submit} aria-label="Ask a question" className="space-y-1">
      <div className="flex items-end gap-2 rounded-2xl border border-slate-700 bg-slate-950 p-2 focus-within:border-indigo-500/70">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          disabled={disabled}
          aria-label="Question"
          placeholder={disabled ? 'The chat is not available' : 'Ask about this repository… (Enter to send, Shift+Enter for a new line)'}
          className="min-h-[2.5rem] flex-1 resize-y bg-transparent px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label="Send"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-slate-50 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <p className={`text-right text-xs tabular-nums ${tooLong ? 'text-red-300' : 'text-slate-500'}`}>
        {draft.length.toLocaleString('en-US')} / {MAX_QUESTION_CHARS.toLocaleString('en-US')}
      </p>
    </form>
  )
}

function ConversationList({
  projectId,
  repositoryId,
  selectedId,
  onSelect,
}: {
  projectId: string
  repositoryId: string
  selectedId: string | null
  onSelect: (id: string | null) => void
}) {
  const conversations = useConversations(projectId, repositoryId)
  const remove = useDeleteConversation(projectId, repositoryId)
  const [confirming, setConfirming] = useState<string | null>(null)
  const list = conversations.data?.conversations ?? []
  return (
    <nav aria-label="Conversations" className="space-y-2">
      <button
        type="button"
        onClick={() => onSelect(null)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
      >
        <MessageSquarePlus className="h-4 w-4" aria-hidden="true" /> New conversation
      </button>
      {conversations.isPending && <p className="text-xs text-slate-400">Loading conversations…</p>}
      {conversations.isError && <ErrorMessage message={getErrorMessage(conversations.error, 'Could not load conversations')} />}
      {conversations.data && list.length === 0 && <p className="px-1 text-xs text-slate-500">No conversations yet.</p>}
      <ul className="space-y-1">
        {list.map((conversation) => (
          <li key={conversation.id} className={`group rounded-lg border ${conversation.id === selectedId ? 'border-indigo-500/60 bg-indigo-500/10' : 'border-transparent hover:bg-slate-800/60'}`}>
            {confirming === conversation.id ? (
              <div className="flex flex-wrap items-center gap-2 px-2 py-2 text-xs">
                <span className="text-slate-300">Delete this conversation?</span>
                <button
                  type="button"
                  onClick={() =>
                    remove.mutate(conversation.id, {
                      onSuccess: () => {
                        setConfirming(null)
                        if (conversation.id === selectedId) onSelect(null)
                      },
                    })
                  }
                  disabled={remove.isPending}
                  className="rounded bg-red-600 px-2 py-1 font-semibold text-slate-50 hover:bg-red-500 disabled:opacity-50"
                >
                  Delete
                </button>
                <button type="button" onClick={() => setConfirming(null)} className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-start gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  aria-current={conversation.id === selectedId ? 'true' : undefined}
                  className="min-w-0 flex-1 px-2 py-1.5 text-left"
                >
                  <span className="block truncate text-sm text-slate-100">{conversation.title}</span>
                  <span className="block text-xs text-slate-500">
                    {formatDateTime(conversation.updated_at)} · {conversation.message_count} messages
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(conversation.id)}
                  aria-label={`Delete conversation ${conversation.title}`}
                  className="mt-1.5 mr-1 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <ErrorMessage message={remove.isError ? getErrorMessage(remove.error, 'Could not delete the conversation') : null} />
    </nav>
  )
}

function Thread({
  projectId,
  repositoryId,
  conversationId,
  onStarted,
  available,
}: {
  projectId: string
  repositoryId: string
  conversationId: string | null
  onStarted: (id: string) => void
  /** an AI provider is configured */
  available: boolean
}) {
  const explorer = `/projects/${projectId}/repositories/${repositoryId}`
  const runs = useAnalysisRuns(projectId, repositoryId)
  const indexed = runs.data?.runs.find((run) => run.chat_index !== null)
  const conversation = useConversation(projectId, repositoryId, conversationId)
  // The answer as the model writes it, until the stored answer replaces it.
  const [live, setLive] = useState('')
  const start = useStartConversation(projectId, repositoryId, setLive)
  const ask = useAskQuestion(projectId, repositoryId, conversationId ?? '', setLive)
  const mutation = conversationId ? ask : start
  const writing = live.length > 0
  const endRef = useRef<HTMLDivElement>(null)
  const messages = conversation.data?.messages ?? []

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length, mutation.isPending, writing])

  function send(question: string) {
    setLive('')
    if (conversationId) {
      ask.mutate(question)
    } else {
      start.mutate(question, { onSuccess: (created) => onStarted(created.id) })
    }
  }

  // A new conversation needs an analysis with a chat index; an existing one keeps its own.
  const canStart = Boolean(indexed)
  const disabled = !available || (!conversationId && !canStart)
  const pendingQuestion = mutation.isPending ? mutation.variables : undefined

  return (
    <section aria-label="Conversation" className="flex min-w-0 flex-col gap-3">
      {conversationId && conversation.isPending && <p className="text-sm text-slate-400">Loading the conversation…</p>}
      {conversationId && conversation.isError && (
        <ErrorMessage message={getErrorMessage(conversation.error, 'Could not load the conversation')} />
      )}
      {conversation.data && (
        <p className="text-xs text-slate-500">About the analysis of {formatDateTime(conversation.data.run_created_at)}</p>
      )}
      {!conversationId && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="font-semibold text-slate-100">Ask about this repository</h3>
          <p className="mt-1 text-sm text-slate-400">
            Answers come from the code and the results of its latest full analysis, with the
            files and lines they are based on.
            {indexed?.chat_index &&
              ` The analysis of ${formatDateTime(indexed.created_at)} indexed ${indexed.chat_index.chunks.toLocaleString('en-US')} passages from ${indexed.chat_index.files.toLocaleString('en-US')} files.`}
          </p>
          {runs.data && !indexed && (
            <p className="mt-3 text-sm text-amber-200">
              This repository has no analysis the chat can use yet.{' '}
              <Link to={`${explorer}/analysis`} className="text-indigo-300 hover:underline">
                Run a full analysis
              </Link>{' '}
              first.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2" aria-label="Suggested questions">
            {chatSuggestions(indexed).map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={disabled || mutation.isPending}
                onClick={() => send(suggestion)}
                className="rounded-full border border-slate-700 px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
      <ol aria-label="Messages" className="space-y-4">
        {messages.map((message) => (
          <Message key={message.id} message={message} explorer={explorer} />
        ))}
        {pendingQuestion && (
          <>
            <Message
              message={{ id: 'pending', role: 'user', content: pendingQuestion, citations: [], created_at: '' }}
              explorer={explorer}
            />
            {live ? (
              <li className="flex gap-2" aria-busy="true">
                <Bot className="mt-1 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
                <article aria-label="Answer being written" className="min-w-0 max-w-[90%] rounded-2xl rounded-tl-sm border border-slate-800 bg-slate-900/80 px-4 py-3 text-sm text-slate-200">
                  <AnswerText text={live} citations={[]} explorer={explorer} />
                  <span aria-hidden="true" className="typing-caret bg-emerald-300" />
                </article>
                <p role="status" className="sr-only">The answer is being written…</p>
              </li>
            ) : (
              <li role="status" className="flex items-center gap-2 pl-7 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Searching the code and analysis results…
              </li>
            )}
          </>
        )}
      </ol>
      <div ref={endRef} />
      {mutation.isError && (
        <div className="space-y-2">
          <ErrorMessage message={getErrorMessage(mutation.error, 'The question could not be answered')} />
          {mutation.variables && !disabled && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="min-w-0 truncate">Not answered: “{mutation.variables}”</span>
              <button
                type="button"
                onClick={() => send(mutation.variables as string)}
                className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
              >
                Try again
              </button>
            </p>
          )}
        </div>
      )}
      <Composer
        key={conversationId ?? 'new'}
        disabled={disabled}
        pending={mutation.isPending}
        onSend={send}
        initial=""
      />
      <p className="text-xs text-slate-500">
        Answers are written by an AI model from the passages it was given and can be wrong: check
        the cited lines. Secrets found in the code are removed before anything is sent.
      </p>
    </section>
  )
}

/** The AI chat for one repository: conversations, the selected thread and the composer. The
 * selected conversation is in the address (?conversation=…), so it can be linked to. */
export function ChatPanel({ projectId, repositoryId }: { projectId: string; repositoryId: string }) {
  const status = useChatStatus()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('conversation')
  const select = (id: string | null) => setParams(id ? { conversation: id } : {}, { replace: false })
  const available = status.data?.configured ?? false
  return (
    <div className="space-y-4">
      {status.isError && <ErrorMessage message={getErrorMessage(status.error, 'Could not check the AI chat')} />}
      {status.data && !status.data.configured && (
        <p role="note" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          The AI chat is not configured on this server: an administrator needs to set
          ANTHROPIC_API_KEY or GEMINI_API_KEY. Earlier conversations can still be read.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <ConversationList projectId={projectId} repositoryId={repositoryId} selectedId={selectedId} onSelect={select} />
        <Thread
          key={selectedId ?? 'new'}
          projectId={projectId}
          repositoryId={repositoryId}
          conversationId={selectedId}
          onStarted={select}
          available={available}
        />
      </div>
    </div>
  )
}
