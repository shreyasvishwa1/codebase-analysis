import { History, Loader2, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { queryKeys } from '../hooks/queryKeys'
import { useAnalysisCompletion } from '../hooks/useAnalysisCompletion'
import { useAnalysisRuns, useStartAnalysisRun } from '../hooks/useAnalysisRuns'
import { getErrorMessage } from '../services/client'
import { listJobs } from '../services/jobs'
import type { AnalysisRun, Repository } from '../types/api'
import { formatBytes, formatDateTime } from '../utils/format'
import { isJobActive } from '../utils/jobs'
import { lastRunSeconds } from '../utils/runChanges'
import { ErrorMessage } from './ErrorMessage'
import { languageLabel } from './LanguageStats'
import { LiveAnalysisBoard } from './LiveAnalysisBoard'
import { useAnalysisWatch } from './AnalysisWatch'
import { CountUp } from './CountUp'

const number = (value: number) => value.toLocaleString('en-US')
const count = (value: number, noun: string) => `${number(value)} ${noun}${value === 1 ? '' : 's'}`

function RunSummary({ run }: { run: AnalysisRun }) {
  const top = run.languages.slice(0, 5)
  const maxLines = Math.max(1, ...top.map((entry) => entry.code_lines))
  const skipped = Object.entries(run.skipped).filter(([, count]) => count > 0)
  const stats = [
    ['Files analyzed', number(run.analyzed_file_count)],
    ['Lines of code', number(run.code_lines)],
    ['Total lines', number(run.total_lines)],
    ['Excluded files', number(run.excluded_file_count)],
  ]
  return (
    <section aria-label="Run summary" className="space-y-4">
      <p className="text-xs text-slate-400">
        Analyzed {formatDateTime(run.created_at)} · {count(run.file_count, 'file')} ·{' '}
        {formatBytes(run.total_bytes)}
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <dt className="text-xs text-slate-400">{label}</dt>
            <dd className="text-xl font-bold tabular-nums text-slate-50"><CountUp>{value}</CountUp></dd>
          </div>
        ))}
      </dl>
      {top.length > 0 && (
        <ul aria-label="Languages in this run" className="space-y-2">
          {top.map((entry) => (
            <li key={languageLabel(entry.language)}>
              <span className="flex items-baseline justify-between text-sm">
                <span className="text-slate-200">{languageLabel(entry.language)}</span>
                <span className="tabular-nums text-slate-400">
                  {count(entry.code_lines, 'line')} · {count(entry.files, 'file')}
                </span>
              </span>
              <span className="mt-1 block h-2 rounded-full bg-slate-800">
                <span
                  className="bar-grow block h-2 rounded-full bg-indigo-500"
                  style={{ width: `${Math.max(3, (entry.code_lines / maxLines) * 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-slate-500">
        Excluded from analysis: dependency folders, build output and caches (for example
        node_modules/, dist/, .venv/).
        {skipped.length > 0 &&
          ` Skipped: ${skipped.map(([reason, count]) => `${count} ${reason.replace('_', ' ')}`).join(', ')}.`}
      </p>
    </section>
  )
}

export function AnalysisRunsPanel({
  projectId,
  repositoryId,
  repository,
  pollIntervalMs,
}: {
  projectId: string
  repositoryId: string
  repository: Repository
  /** how often to refresh while an analysis runs (tests use a short interval) */
  pollIntervalMs?: number
}) {
  const runs = useAnalysisRuns(projectId, repositoryId, pollIntervalMs)
  const start = useStartAnalysisRun(projectId, repositoryId)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The live board stays after a run this page watched has finished, until it is hidden.
  const [watching, setWatching] = useState(false)

  const job = runs.data?.job ?? null
  const active = isJobActive(job ?? undefined)
  const history = runs.data?.runs ?? []
  const selected = history.find((run) => run.id === selectedId) ?? history[0]
  // While a run is going, how long the previous one took (same key as useJobs: shared cache).
  const jobs = useQuery({
    queryKey: queryKeys.jobs(projectId, repositoryId),
    queryFn: () => listJobs(projectId, repositoryId),
    enabled: active,
  })
  const previousSeconds = lastRunSeconds(jobs.data ?? [])

  // The run's toast and tab title: from the app-wide watcher when there is one (so they come
  // even after leaving this page), otherwise from this panel.
  const watch = useAnalysisWatch()
  useAnalysisCompletion({
    projectId,
    repositoryId,
    repositoryName: repository.name,
    job,
    history,
    enabled: watch === null,
  })
  useEffect(() => {
    if (active && watch) watch({ projectId, repositoryId, repositoryName: repository.name })
  }, [active, watch, projectId, repositoryId, repository.name])

  // The board stays after a run this page watched; a finished run shows its new summary.
  const wasActive = useRef(false)
  useEffect(() => {
    if (active) setWatching(true)
    if (wasActive.current && !active) setSelectedId(null)
    wasActive.current = active
  }, [active])

  async function onRun() {
    setError(null)
    try {
      await start.mutateAsync()
    } catch (err) {
      setError(getErrorMessage(err, 'Could not start the analysis'))
    }
  }

  const ready = repository.status === 'ready'
  return (
    <section aria-label="Full analysis" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Full analysis</h2>
          <p className="mt-1 text-xs text-slate-400">
            Analyzes the repository's current files and keeps every run in the history below.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onRun()}
          disabled={!ready || active || start.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-slate-50 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {active ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" />
          )}
          {active ? 'Analyzing…' : 'Run full analysis'}
        </button>
      </div>

      {!ready && (
        <p className="text-sm text-slate-400">Ingest the repository before running an analysis.</p>
      )}
      <ErrorMessage message={error} />
      {runs.isError && (
        <ErrorMessage message={getErrorMessage(runs.error, 'Could not load analysis runs')} />
      )}
      {active && (
        <p role="status" className="text-sm text-amber-300">
          Analysis {job?.status === 'pending' ? 'queued' : 'in progress'}…
        </p>
      )}
      {job && (active || watching) && (
        <LiveAnalysisBoard job={job} previousSeconds={previousSeconds} onHide={() => setWatching(false)} />
      )}
      {job?.status === 'failed' && job.error_message && (
        <ErrorMessage message={`The last analysis failed: ${job.error_message}`} />
      )}

      {runs.isPending && <p className="text-sm text-slate-400">Loading analysis runs…</p>}
      {runs.data && history.length === 0 && !active && (
        <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
          No analysis yet. Run a full analysis to see the repository summary.
        </p>
      )}
      {selected && <RunSummary run={selected} />}

      {history.length > 1 && (
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <History className="h-3.5 w-3.5" aria-hidden="true" /> History
          </h3>
          <ul aria-label="Analysis history" className="space-y-1">
            {history.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(run.id)}
                  aria-pressed={run.id === selected?.id}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${run.id === selected?.id ? 'bg-indigo-500/15 text-indigo-100' : 'text-slate-300 hover:bg-slate-800/60'}`}
                >
                  <span>{formatDateTime(run.created_at)}</span>
                  <span className="tabular-nums text-slate-400">
                    {count(run.analyzed_file_count, 'file')} · {count(run.code_lines, 'line')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
