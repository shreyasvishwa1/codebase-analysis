import { ChevronDown, ChevronRight, ExternalLink, FileCode2, Search, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useRunIssues } from '../hooks/useCodeQuality'
import { getErrorMessage } from '../services/client'
import { ISSUE_PAGE_SIZE } from '../services/codeQuality'
import type {
  CodeIssue,
  IssueCategory,
  IssueFilters,
  IssueSeverity,
  QualitySummary,
} from '../types/api'
import { ErrorMessage } from './ErrorMessage'

export const SEVERITIES: IssueSeverity[] = ['high', 'medium', 'low', 'info']
export const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
}
export const SEVERITY_STYLES: Record<IssueSeverity, string> = {
  high: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
  medium: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  low: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  info: 'border-slate-600 bg-slate-800/60 text-slate-300',
}
export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  syntax_error: 'Syntax errors',
  bug_risk: 'Bug risks',
  unused_code: 'Unused code',
  dead_code: 'Dead code',
  duplication: 'Duplication',
  naming: 'Naming',
  documentation: 'Documentation',
  formatting: 'Formatting',
  maintainability: 'Maintainability',
}
const CATEGORIES = Object.keys(CATEGORY_LABELS) as IssueCategory[]
const RUFF_DOCS = 'https://docs.astral.sh/ruff/'
const RUFF_PROBLEMS: Record<string, string> = {
  timeout: 'Python linting took too long and was stopped',
  unavailable: 'the Python linter is not available on the server',
  failed: 'the Python linter failed',
  too_large: 'the Python linter produced too large a report',
}

const number = (value: number) => value.toLocaleString('en-US')
const count = (value: number, noun: string) => `${number(value)} ${noun}${value === 1 ? '' : 's'}`
const CARD = 'min-w-0 rounded-xl border border-slate-800 bg-slate-950/40 p-4'

export function SeverityBadge({ severity }: { severity: IssueSeverity }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold ${SEVERITY_STYLES[severity]}`}>
      {SEVERITY_LABELS[severity]}
    </span>
  )
}

function QualityNotes({ quality }: { quality: QualitySummary }) {
  const notes: string[] = []
  const problem = RUFF_PROBLEMS[quality.ruff]
  if (problem) notes.push(`Python findings are missing from this run: ${problem}.`)
  if (quality.ruff === 'skipped' && quality.files_analyzed > 0) {
    notes.push('No Python files: only the checks for every language ran (duplication, TODO markers, long files).')
  }
  if (quality.stored_issues < quality.issues) {
    notes.push(`The ${number(quality.stored_issues)} most severe of ${number(quality.issues)} findings are listed.`)
  }
  if (quality.duplication.partial) {
    notes.push('The repository is very large: duplication was measured on part of it.')
  }
  if (notes.length === 0) return null
  return (
    <ul aria-label="Analysis notes" className="space-y-1 text-xs text-amber-200/90">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  )
}

function Summary({ quality, onSeverity }: { quality: QualitySummary; onSeverity: (s: IssueSeverity) => void }) {
  return (
    <section aria-label="Quality summary" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <div className={CARD}>
          <p className="text-xs text-slate-400">Issues found</p>
          <p className="text-2xl font-extrabold tabular-nums text-white">{number(quality.issues)}</p>
          <p className="text-xs text-slate-500">{count(quality.files_analyzed, 'file')} analyzed</p>
        </div>
        {SEVERITIES.map((severity) => (
          <button
            key={severity}
            type="button"
            onClick={() => onSeverity(severity)}
            aria-label={`Show ${SEVERITY_LABELS[severity].toLowerCase()} severity issues`}
            className={`${CARD} text-left hover:border-slate-600`}
          >
            <SeverityBadge severity={severity} />
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-white">{number(quality.by_severity[severity])}</p>
          </button>
        ))}
        <div className={CARD}>
          <p className="text-xs text-slate-400">Duplication</p>
          <p className="text-2xl font-extrabold tabular-nums text-white">{quality.duplication.percent.toFixed(1)}%</p>
          <p className="text-xs text-slate-500">{count(quality.duplication.blocks, 'duplicate block')}</p>
        </div>
      </div>
      <QualityNotes quality={quality} />
    </section>
  )
}

function CategoryBreakdown({ quality, onCategory }: { quality: QualitySummary; onCategory: (c: IssueCategory) => void }) {
  const rows = CATEGORIES.map((category) => ({ category, value: quality.by_category[category] }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <section aria-label="Issues by category" className={CARD}>
      <h3 className="text-sm font-semibold text-slate-100">Issues by category</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No issues found.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map(({ category, value }) => (
            <li key={category}>
              <button type="button" onClick={() => onCategory(category)} className="block w-full text-left">
                <span className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-200">{CATEGORY_LABELS[category]}</span>
                  <span className="tabular-nums text-slate-400">{number(value)}</span>
                </span>
                <span className="mt-1 block h-2 rounded-full bg-slate-800">
                  <span
                    className="block h-2 rounded-full bg-gradient-to-r from-indigo-500 to-fuchsia-400"
                    style={{ width: `${Math.max(3, (value / max) * 100)}%` }}
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function TopFiles({ quality, onPath }: { quality: QualitySummary; onPath: (path: string) => void }) {
  return (
    <section aria-label="Files with the most issues" className={CARD}>
      <h3 className="text-sm font-semibold text-slate-100">Files with the most issues</h3>
      {quality.top_files.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No issues found.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-800">
          {quality.top_files.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                onClick={() => onPath(file.path)}
                className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:text-indigo-200"
              >
                <span className="min-w-0 truncate font-mono text-xs text-slate-200">{file.path}</span>
                <span className="shrink-0 tabular-nums text-xs text-slate-400">
                  {count(file.issues, 'issue')}
                  {file.high > 0 && <span className="ml-1 text-rose-300">· {number(file.high)} high</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function IssueRow({ issue, explorer }: { issue: CodeIssue; explorer: string }) {
  const [open, setOpen] = useState(false)
  const lines = issue.end_line > issue.line ? `${issue.line}–${issue.end_line}` : String(issue.line)
  // Documentation links are shown only for Ruff's own documentation site.
  const docs = issue.doc_url?.startsWith(RUFF_DOCS) ? issue.doc_url : null
  return (
    <li className="py-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 text-left"
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        )}
        <SeverityBadge severity={issue.severity} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm text-slate-100">{issue.message}</span>
          <span className="block truncate font-mono text-xs text-slate-400">
            {issue.path}:{lines} · {issue.rule_id} · {CATEGORY_LABELS[issue.category]}
          </span>
        </span>
      </button>
      {open && (
        <div className="ml-6 mt-2 space-y-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm">
          <p className="text-slate-300">
            <span className="font-semibold text-slate-200">Why it matters: </span>
            {issue.explanation}
          </p>
          <p className="text-emerald-200/90">
            <span className="font-semibold text-emerald-200">Suggested fix: </span>
            {issue.suggestion}
          </p>
          <p className="flex flex-wrap items-center gap-3 text-xs">
            <Link
              to={explorer}
              state={{ openFile: { path: issue.path, line: issue.line } }}
              className="inline-flex items-center gap-1 text-indigo-300 hover:underline"
            >
              <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" /> Open in explorer at line {issue.line}
            </Link>
            {docs && (
              <a href={docs} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-indigo-300 hover:underline">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Rule {issue.rule_id} documentation
              </a>
            )}
            <span className="text-slate-500">Found by {issue.tool === 'ruff' ? 'Ruff' : 'CodeBase Analysis'}</span>
          </p>
        </div>
      )}
    </li>
  )
}

function IssueList({
  projectId,
  repositoryId,
  runId,
  filters,
  setFilters,
}: {
  projectId: string
  repositoryId: string
  runId: string
  filters: IssueFilters
  setFilters: (filters: IssueFilters) => void
}) {
  const issues = useRunIssues(projectId, repositoryId, runId, filters)
  const [search, setSearch] = useState(filters.q ?? '')
  const page = filters.page ?? 1
  const total = issues.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / ISSUE_PAGE_SIZE))
  const explorer = `/projects/${projectId}/repositories/${repositoryId}`
  const update = (change: IssueFilters) => setFilters({ ...filters, ...change, page: 1 })

  function onSearch(event: FormEvent) {
    event.preventDefault()
    update({ q: search.trim() || undefined })
  }

  return (
    <section aria-label="Issues" className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-400">
          Severity
          <select
            value={filters.severity ?? ''}
            onChange={(event) => update({ severity: (event.target.value || undefined) as IssueSeverity | undefined })}
            className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="">All severities</option>
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>{SEVERITY_LABELS[severity]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Category
          <select
            value={filters.category ?? ''}
            onChange={(event) => update({ category: (event.target.value || undefined) as IssueCategory | undefined })}
            className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>
            ))}
          </select>
        </label>
        {/* Its own full-width line on phones; beside the filters from the sm breakpoint. */}
        <form onSubmit={onSearch} role="search" className="flex w-full min-w-0 items-end gap-2 sm:w-auto sm:flex-1">
          <label className="min-w-0 flex-1 text-xs text-slate-400">
            Search issues
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={200}
              placeholder="Message, file or rule"
              className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <button type="submit" className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
            <Search className="h-4 w-4" aria-hidden="true" /> Search
          </button>
        </form>
      </div>
      {filters.path && (
        <p className="flex items-center gap-2 text-xs text-slate-300">
          File: <span className="truncate font-mono">{filters.path}</span>
          <button
            type="button"
            onClick={() => update({ path: undefined })}
            aria-label="Clear file filter"
            className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </p>
      )}

      {issues.isPending && <p className="text-sm text-slate-400">Loading issues…</p>}
      {issues.isError && <ErrorMessage message={getErrorMessage(issues.error, 'Could not load issues')} />}
      {issues.data && (
        <>
          <p className="text-xs text-slate-400" role="status">
            {total === 0 ? 'No issues match these filters.' : `${count(total, 'issue')} · page ${page} of ${pages}`}
          </p>
          <ul className="divide-y divide-slate-800">
            {issues.data.items.map((issue) => (
              <IssueRow key={issue.id} issue={issue} explorer={explorer} />
            ))}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setFilters({ ...filters, page: page - 1 })}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= pages}
                onClick={() => setFilters({ ...filters, page: page + 1 })}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** The code-quality results of one run: summary, breakdowns and the filterable issue list. */
export function CodeQualityReport({
  projectId,
  repositoryId,
  runId,
  quality,
}: {
  projectId: string
  repositoryId: string
  runId: string
  quality: QualitySummary
}) {
  const [filters, setFilters] = useState<IssueFilters>({})
  const update = (change: IssueFilters) => setFilters({ ...filters, ...change, page: 1 })
  return (
    <div className="space-y-5">
      <Summary quality={quality} onSeverity={(severity) => update({ severity })} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CategoryBreakdown quality={quality} onCategory={(category) => update({ category })} />
        <TopFiles quality={quality} onPath={(path) => update({ path })} />
      </div>
      <IssueList
        projectId={projectId}
        repositoryId={repositoryId}
        runId={runId}
        filters={filters}
        setFilters={setFilters}
      />
    </div>
  )
}
