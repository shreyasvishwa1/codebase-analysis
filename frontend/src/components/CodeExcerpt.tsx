import { useFileContent } from '../hooks/useFileContent'
import { getErrorMessage } from '../services/client'

/** Lines shown before and after the finding's own lines. */
export const CONTEXT_LINES = 2
/** At most this many lines are shown, however long the finding spans. */
export const MAX_LINES = 12

/** Weaknesses whose line holds a secret value (hard-coded passwords, keys, tokens, committed
 * .env files): their code is never shown here, keeping the page's promise that secret values
 * are not displayed. */
export const SECRET_CWES = new Set([259, 321, 538, 798])

export interface ExcerptLine {
  number: number
  text: string
  /** one of the finding's own lines */
  flagged: boolean
  /** a line its data-flow path passes through */
  onPath: boolean
}

/** The lines around a finding: from CONTEXT_LINES before its first line to CONTEXT_LINES after
 * its last, cut to MAX_LINES; empty when the line is beyond the file. */
export function excerpt(content: string, line: number, endLine: number, pathLines: number[] = []): ExcerptLine[] {
  const lines = content.split(/\r?\n/)
  if (line < 1 || line > lines.length) return []
  const first = Math.max(1, line - CONTEXT_LINES)
  const last = Math.min(lines.length, Math.max(line, endLine) + CONTEXT_LINES, first + MAX_LINES - 1)
  const path = new Set(pathLines)
  const result: ExcerptLine[] = []
  for (let number = first; number <= last; number += 1) {
    result.push({
      number,
      text: lines[number - 1],
      flagged: number >= line && number <= Math.max(line, endLine),
      onPath: path.has(number),
    })
  }
  return result
}

/**
 * The code a finding points at, read through the same verified file API as the explorer and
 * shown as plain text. Not for findings about secrets (SECRET_CWES).
 */
export function CodeExcerpt({
  projectId,
  repositoryId,
  path,
  line,
  endLine,
  cwe,
  pathLines = [],
}: {
  projectId: string
  repositoryId: string
  path: string
  line: number
  endLine: number
  cwe: number | null
  pathLines?: number[]
}) {
  const secret = cwe !== null && SECRET_CWES.has(cwe)
  const file = useFileContent(projectId, repositoryId, secret ? null : path)
  if (secret) {
    return <p className="text-xs text-slate-500">The code is not shown for findings about secrets, so the value stays hidden.</p>
  }
  if (file.isPending) return <div aria-busy="true" className="skeleton h-16 rounded-md" />
  if (file.isError) {
    return <p className="text-xs text-slate-500">The code could not be loaded: {getErrorMessage(file.error, 'request failed')}.</p>
  }
  if (file.data.content === null) {
    return (
      <p className="text-xs text-slate-500">
        The code is not shown: the file is {file.data.reason === 'too_large' ? 'too large' : 'not text'}.
      </p>
    )
  }
  const lines = excerpt(file.data.content, line, endLine, pathLines)
  if (lines.length === 0) return <p className="text-xs text-slate-500">The line is no longer in the stored file.</p>
  return (
    <figure aria-label={`Code at ${path}, line ${line}`} className="overflow-hidden rounded-md border border-slate-800 bg-slate-950">
      <pre className="overflow-x-auto py-1.5 font-mono text-xs leading-5">
        {lines.map((entry) => (
          <div
            key={entry.number}
            data-flagged={entry.flagged || undefined}
            data-on-path={entry.onPath || undefined}
            className={`flex ${entry.flagged ? 'bg-rose-500/10' : entry.onPath ? 'bg-amber-500/5' : ''}`}
          >
            <span
              aria-hidden="true"
              className={`w-12 shrink-0 select-none border-r pr-2 text-right ${
                entry.flagged ? 'border-rose-400 text-rose-300' : entry.onPath ? 'border-amber-500/60 text-amber-300/80' : 'border-transparent text-slate-600'
              }`}
            >
              {entry.number}
            </span>
            <code className="whitespace-pre pl-3 pr-3 text-slate-200">{entry.text || ' '}</code>
          </div>
        ))}
      </pre>
    </figure>
  )
}
