import { FileCode2, Search, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useComplexityFiles, useComplexityFunctions } from '../hooks/useComplexity'
import { getErrorMessage } from '../services/client'
import { COMPLEXITY_PAGE_SIZE } from '../services/complexity'
import type {
  ComplexityFileFilters,
  ComplexityFileSort,
  ComplexityFunctionFilters,
  ComplexityRank,
  ComplexitySummary,
  MaintainabilityLevel,
} from '../types/api'
import { ErrorMessage } from './ErrorMessage'

export const RANKS: ComplexityRank[] = ['low', 'medium', 'high']
export const RANK_LABELS: Record<ComplexityRank, string> = { low: 'Low', medium: 'Medium', high: 'High' }
const RANK_RANGES: Record<ComplexityRank, string> = { low: '1–10', medium: '11–20', high: '21+' }
const RANK_STYLES: Record<ComplexityRank, string> = {
  low: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
  medium: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  high: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
}
const RANK_BARS: Record<ComplexityRank, string> = {
  low: 'from-emerald-500 to-teal-400',
  medium: 'from-amber-500 to-yellow-400',
  high: 'from-rose-500 to-fuchsia-400',
}
const LEVELS: MaintainabilityLevel[] = ['good', 'moderate', 'poor']
export const LEVEL_LABELS: Record<MaintainabilityLevel, string> = { good: 'Good', moderate: 'Moderate', poor: 'Poor' }
const SORTS: { value: ComplexityFileSort; label: string }[] = [
  { value: 'complexity', label: 'Most complex' },
  { value: 'maintainability', label: 'Least maintainable' },
  { value: 'size', label: 'Largest' },
  { value: 'path', label: 'Path' },
]

const number = (value: number) => value.toLocaleString('en-US')
const count = (value: number, noun: string) => `${number(value)} ${noun}${value === 1 ? '' : 's'}`
const CARD = 'min-w-0 rounded-xl border border-slate-800 bg-slate-950/40 p-4'
const SELECT = 'mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100'
const BUTTON = 'rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40'

export function RankBadge({ rank }: { rank: ComplexityRank }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold ${RANK_STYLES[rank]}`}>
      {RANK_LABELS[rank]}
    </span>
  )
}

function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / COMPLEXITY_PAGE_SIZE))
  if (pages <= 1) return null
  return (
    <div className="flex items-center justify-end gap-2">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className={BUTTON}>
        Previous
      </button>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className={BUTTON}>
        Next
      </button>
    </div>
  )
}

function SearchBox({ label, placeholder, initial, onSearch }: {
  label: string
  placeholder: string
  initial: string
  onSearch: (text: string | undefined) => void
}) {
  const [text, setText] = useState(initial)
  function submit(event: FormEvent) {
    event.preventDefault()
    onSearch(text.trim() || undefined)
  }
  return (
    <form onSubmit={submit} role="search" className="flex w-full min-w-0 items-end gap-2 sm:w-auto sm:flex-1">
      <label className="min-w-0 flex-1 text-xs text-slate-400">
        {label}
        <input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={200}
          placeholder={placeholder}
          className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
        />
      </label>
      <button type="submit" className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
        <Search className="h-4 w-4" aria-hidden="true" /> Search
      </button>
    </form>
  )
}

function Summary({ summary, duplication }: { summary: ComplexitySummary; duplication: number | null }) {
  const index = summary.maintainability_index
  const stats: [string, string, string][] = [
    ['Functions', number(summary.functions), count(summary.files_measured, 'file') + ' measured'],
    ['Classes', number(summary.classes), 'Class declarations'],
    ['Lines of code', number(summary.nloc), 'Without comments and blanks'],
    ['Average complexity', summary.average_cyclomatic.toFixed(2), 'Cyclomatic, per function'],
    ['Highest complexity', number(summary.max_cyclomatic), 'Most complex function'],
    [
      'Maintainability',
      index === null ? '—' : index.toFixed(1),
      summary.maintainability ? `${LEVEL_LABELS[summary.maintainability]} (0–100, mean of files)` : 'No code measured',
    ],
  ]
  if (duplication !== null) stats.push(['Duplication', `${duplication.toFixed(1)}%`, 'From the code analysis'])
  const notes: string[] = []
  if (summary.mi_estimated_files > 0) {
    notes.push(
      `The maintainability index of ${count(summary.mi_estimated_files, 'file')} is estimated from tokens (languages other than Python).`,
    )
  }
  const skipped = summary.files_skipped.too_large + summary.files_skipped.unparsable
  if (skipped > 0) notes.push(`${count(skipped, 'file')} could not be measured (too large or unparsable).`)
  if (summary.stored_functions < summary.functions) {
    notes.push(`The ${number(summary.stored_functions)} most complex of ${number(summary.functions)} functions are listed.`)
  }
  return (
    <section aria-label="Complexity summary" className="space-y-3">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map(([label, value, caption]) => (
          <div key={label} className={CARD}>
            <dt className="text-xs text-slate-400">{label}</dt>
            <dd className="text-2xl font-extrabold tabular-nums text-white">{value}</dd>
            <dd className="truncate text-xs text-slate-500">{caption}</dd>
          </div>
        ))}
      </dl>
      {notes.length > 0 && (
        <ul aria-label="Analysis notes" className="space-y-1 text-xs text-amber-200/90">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Distribution({ summary, onRank }: { summary: ComplexitySummary; onRank: (rank: ComplexityRank) => void }) {
  const total = Math.max(1, summary.functions)
  return (
    <section aria-label="Functions by complexity" className={CARD}>
      <h3 className="text-sm font-semibold text-slate-100">Functions by complexity</h3>
      <p className="text-xs text-slate-500">Cyclomatic complexity: 1–10 low, 11–20 medium, 21+ high.</p>
      <ul className="mt-3 space-y-2">
        {RANKS.map((rank) => {
          const value = summary.functions_by_rank[rank]
          return (
            <li key={rank}>
              <button type="button" onClick={() => onRank(rank)} aria-label={`Show ${rank} complexity functions`} className="block w-full text-left">
                <span className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-200">
                    {RANK_LABELS[rank]} <span className="text-xs text-slate-500">({RANK_RANGES[rank]})</span>
                  </span>
                  <span className="tabular-nums text-slate-400">
                    {number(value)} · {((value / total) * 100).toFixed(1)}%
                  </span>
                </span>
                <span className="mt-1 block h-2 rounded-full bg-slate-800">
                  <span
                    className={`block h-2 rounded-full bg-gradient-to-r ${RANK_BARS[rank]}`}
                    style={{ width: `${value === 0 ? 0 : Math.max(2, (value / total) * 100)}%` }}
                  />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function MaintainabilityPanel({ summary, onLevel }: { summary: ComplexitySummary; onLevel: (level: MaintainabilityLevel) => void }) {
  return (
    <section aria-label="Files by maintainability" className={CARD}>
      <h3 className="text-sm font-semibold text-slate-100">Files by maintainability</h3>
      <p className="text-xs text-slate-500">Maintainability index: 20+ good, 10–19 moderate, below 10 poor.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => onLevel(level)}
            aria-label={`Show ${level} maintainability files`}
            className="rounded-lg border border-slate-800 p-3 text-left hover:border-slate-600"
          >
            <span className="block text-xs text-slate-400">{LEVEL_LABELS[level]}</span>
            <span className="block text-xl font-bold tabular-nums text-white">{number(summary.files_by_maintainability[level])}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function FunctionList({ projectId, repositoryId, runId, filters, setFilters }: {
  projectId: string
  repositoryId: string
  runId: string
  filters: ComplexityFunctionFilters
  setFilters: (filters: ComplexityFunctionFilters) => void
}) {
  const functions = useComplexityFunctions(projectId, repositoryId, runId, filters)
  const update = (change: ComplexityFunctionFilters) => setFilters({ ...filters, ...change, page: 1 })
  const page = filters.page ?? 1
  const total = functions.data?.total ?? 0
  const explorer = `/projects/${projectId}/repositories/${repositoryId}`
  return (
    <section aria-label="Most complex functions" className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-100">Most complex functions</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-400">
          Complexity
          <select
            value={filters.rank ?? ''}
            onChange={(event) => update({ rank: (event.target.value || undefined) as ComplexityRank | undefined })}
            className={SELECT}
          >
            <option value="">All functions</option>
            {RANKS.map((rank) => (
              <option key={rank} value={rank}>{RANK_LABELS[rank]} ({RANK_RANGES[rank]})</option>
            ))}
          </select>
        </label>
        <SearchBox label="Search functions" placeholder="Function name or file" initial={filters.q ?? ''} onSearch={(q) => update({ q })} />
      </div>
      {filters.path && (
        <p className="flex items-center gap-2 text-xs text-slate-300">
          File: <span className="truncate font-mono">{filters.path}</span>
          <button type="button" onClick={() => update({ path: undefined })} aria-label="Clear file filter" className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </p>
      )}
      {functions.isPending && <p className="text-sm text-slate-400">Loading functions…</p>}
      {functions.isError && <ErrorMessage message={getErrorMessage(functions.error, 'Could not load functions')} />}
      {functions.data && (
        <>
          <p role="status" className="text-xs text-slate-400">
            {total === 0 ? 'No functions match these filters.' : `${count(total, 'function')} · page ${page} of ${Math.max(1, Math.ceil(total / COMPLEXITY_PAGE_SIZE))}`}
          </p>
          <ul className="divide-y divide-slate-800">
            {functions.data.items.map((fn) => (
              <li key={fn.id} className="flex items-start gap-3 py-2.5">
                <span className="w-10 shrink-0 text-right text-lg font-bold tabular-nums text-white" title="Cyclomatic complexity">
                  {fn.cyclomatic}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-sm text-slate-100">{fn.name}</span>
                    <RankBadge rank={fn.rank} />
                  </span>
                  <span className="block truncate font-mono text-xs text-slate-400">
                    {fn.path}:{fn.line} · {count(fn.nloc, 'line')} · {count(fn.parameters, 'parameter')}
                  </span>
                </span>
                <Link
                  to={explorer}
                  state={{ openFile: { path: fn.path, line: fn.line } }}
                  aria-label={`Open ${fn.name} in the explorer`}
                  className="shrink-0 rounded p-1 text-indigo-300 hover:bg-slate-800"
                >
                  <FileCode2 className="h-4 w-4" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <Pager page={page} total={total} onPage={(next) => setFilters({ ...filters, page: next })} />
        </>
      )}
    </section>
  )
}

function FileTable({ projectId, repositoryId, runId, filters, setFilters, onFile }: {
  projectId: string
  repositoryId: string
  runId: string
  filters: ComplexityFileFilters
  setFilters: (filters: ComplexityFileFilters) => void
  onFile: (path: string) => void
}) {
  const files = useComplexityFiles(projectId, repositoryId, runId, filters)
  const update = (change: ComplexityFileFilters) => setFilters({ ...filters, ...change, page: 1 })
  const page = filters.page ?? 1
  const total = files.data?.total ?? 0
  return (
    <section aria-label="Files" className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-100">Files</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-400">
          Sort by
          <select value={filters.sort ?? 'complexity'} onChange={(event) => update({ sort: event.target.value as ComplexityFileSort })} className={SELECT}>
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>{sort.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Complexity
          <select
            value={filters.rank ?? ''}
            onChange={(event) => update({ rank: (event.target.value || undefined) as ComplexityRank | undefined })}
            className={SELECT}
          >
            <option value="">All files</option>
            {RANKS.map((rank) => (
              <option key={rank} value={rank}>{RANK_LABELS[rank]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Maintainability
          <select
            value={filters.maintainability ?? ''}
            onChange={(event) => update({ maintainability: (event.target.value || undefined) as MaintainabilityLevel | undefined })}
            className={SELECT}
          >
            <option value="">Any</option>
            {LEVELS.map((level) => (
              <option key={level} value={level}>{LEVEL_LABELS[level]}</option>
            ))}
          </select>
        </label>
        <SearchBox label="Search files" placeholder="Path" initial={filters.q ?? ''} onSearch={(q) => update({ q })} />
      </div>
      {files.isPending && <p className="text-sm text-slate-400">Loading files…</p>}
      {files.isError && <ErrorMessage message={getErrorMessage(files.error, 'Could not load files')} />}
      {files.data && (
        <>
          <p role="status" className="text-xs text-slate-400">
            {total === 0 ? 'No files match these filters.' : `${count(total, 'file')} · page ${page} of ${Math.max(1, Math.ceil(total / COMPLEXITY_PAGE_SIZE))}`}
          </p>
          {/* Wide table: scrolls inside its own box on small screens. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="text-xs text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">File</th>
                  <th className="px-2 py-2 text-right font-medium">Lines</th>
                  <th className="px-2 py-2 text-right font-medium">Functions</th>
                  <th className="px-2 py-2 text-right font-medium">Classes</th>
                  <th className="px-2 py-2 text-right font-medium">Max</th>
                  <th className="px-2 py-2 text-right font-medium">Average</th>
                  <th className="px-2 py-2 text-right font-medium">Maintainability</th>
                  <th className="py-2 pl-2 font-medium">Complexity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {files.data.items.map((file) => (
                  <tr key={file.id}>
                    <td className="max-w-[18rem] py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => onFile(file.path)}
                        aria-label={`Show the functions of ${file.path}`}
                        className="block max-w-full truncate font-mono text-xs text-slate-200 hover:text-indigo-200"
                      >
                        {file.path}
                      </button>
                      <span className="text-xs text-slate-500">{file.language}</span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{number(file.nloc)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{number(file.functions)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{number(file.classes)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{number(file.max_cyclomatic)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{file.average_cyclomatic.toFixed(1)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {file.maintainability_index === null ? '—' : file.maintainability_index.toFixed(1)}
                      {file.mi_estimated && <span className="ml-1 text-xs text-slate-500" title="Estimated from tokens">est.</span>}
                    </td>
                    <td className="py-2 pl-2"><RankBadge rank={file.rank} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} total={total} onPage={(next) => setFilters({ ...filters, page: next })} />
        </>
      )}
    </section>
  )
}

/** The complexity results of one run: summary, distributions, functions and files. */
export function ComplexityReport({ projectId, repositoryId, runId, summary, duplication }: {
  projectId: string
  repositoryId: string
  runId: string
  summary: ComplexitySummary
  /** the run's duplication percentage, when its code analysis is available */
  duplication: number | null
}) {
  const [functionFilters, setFunctionFilters] = useState<ComplexityFunctionFilters>({})
  const showFunctions = (change: ComplexityFunctionFilters) => setFunctionFilters({ ...functionFilters, ...change, page: 1 })
  const [fileFilters, setFileFilters] = useState<ComplexityFileFilters>({})
  return (
    <div className="space-y-5">
      <Summary summary={summary} duplication={duplication} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Distribution summary={summary} onRank={(rank) => showFunctions({ rank })} />
        <MaintainabilityPanel
          summary={summary}
          onLevel={(maintainability) => setFileFilters({ ...fileFilters, maintainability, page: 1 })}
        />
      </div>
      <FunctionList
        projectId={projectId}
        repositoryId={repositoryId}
        runId={runId}
        filters={functionFilters}
        setFilters={setFunctionFilters}
      />
      <FileTable
        projectId={projectId}
        repositoryId={repositoryId}
        runId={runId}
        filters={fileFilters}
        setFilters={setFileFilters}
        onFile={(path) => showFunctions({ path })}
      />
    </div>
  )
}
