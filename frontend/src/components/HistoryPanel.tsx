import { Download, FileDown, Loader2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAnalysisHistory, useCreateReport, useDeleteReport, useDownloadReport, useReports } from '../hooks/useReports'
import { getErrorMessage } from '../services/client'
import type { GeneratedReport, HistoryEntry } from '../types/api'
import { formatBytes, formatDateTime } from '../utils/format'
import { ErrorMessage } from './ErrorMessage'
import { scoreTone } from './HealthReport'

export const HISTORY_PAGE = 25

const number = (value: number) => value.toLocaleString('en-US')

/** Score change from the repository's previous run in the list (entries are newest first). */
export function scoreChanges(entries: HistoryEntry[]): Map<string, number | null> {
  const changes = new Map<string, number | null>()
  entries.forEach((entry, index) => {
    const previous = entries.slice(index + 1).find((other) => other.repository_id === entry.repository_id)
    changes.set(
      entry.run_id,
      previous && entry.overall !== null && previous.overall !== null ? entry.overall - previous.overall : null,
    )
  })
  return changes
}

function Change({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null
  if (value === 0) return <span className="text-xs text-slate-500" title="Same score as the previous run">±0</span>
  return (
    <span className={`text-xs font-semibold ${value > 0 ? 'text-emerald-300' : 'text-red-300'}`} title="Change from the previous run">
      {value > 0 ? `+${value}` : `−${Math.abs(value)}`}
    </span>
  )
}

const missing = <span className="text-slate-600" title="Not analyzed in this run">—</span>

function Count({ value, warn = false }: { value: number | null; warn?: boolean }) {
  if (value === null) return missing
  return <span className={`tabular-nums ${warn && value > 0 ? 'font-semibold text-orange-300' : 'text-slate-300'}`}>{number(value)}</span>
}

function ReportsTable({ repositoryId, highlight }: { repositoryId: string | null; highlight: string | null }) {
  const reports = useReports(repositoryId)
  const download = useDownloadReport()
  const remove = useDeleteReport()
  const [confirming, setConfirming] = useState<string | null>(null)
  const list = reports.data?.reports ?? []
  return (
    <section aria-label="Reports" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">PDF reports</h2>
        <p className="mt-1 text-xs text-slate-400">
          Reports you created, kept so you can download them again. Each describes one analysis run.
        </p>
      </div>
      {reports.isPending && <p className="text-sm text-slate-400">Loading reports…</p>}
      {reports.isError && <ErrorMessage message={getErrorMessage(reports.error, 'Could not load reports')} />}
      {reports.data && list.length === 0 && (
        <p className="text-sm text-slate-400">No reports yet. Create one from an analysis in the history above.</p>
      )}
      {list.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="py-2 pr-3 font-medium">Report</th>
                <th className="py-2 pr-3 font-medium">Analysis</th>
                <th className="py-2 pr-3 font-medium">Pages</th>
                <th className="py-2 pr-3 font-medium">Size</th>
                <th className="py-2 pr-3 font-medium">Created</th>
                <th className="py-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {list.map((report: GeneratedReport) => (
                <tr key={report.id} className={`border-t border-slate-800 ${report.id === highlight ? 'bg-indigo-500/10' : ''}`}>
                  <td className="py-2 pr-3">
                    <span className="block break-all font-mono text-xs text-slate-200">{report.filename}</span>
                    <span className="block text-xs text-slate-500">{report.repository_name} · {report.project_name}</span>
                  </td>
                  <td className="py-2 pr-3 text-slate-300">{formatDateTime(report.run_created_at)}</td>
                  <td className="py-2 pr-3 tabular-nums text-slate-300">{report.pages}</td>
                  <td className="py-2 pr-3 tabular-nums text-slate-300">{formatBytes(report.size_bytes)}</td>
                  <td className="py-2 pr-3 text-slate-300">{formatDateTime(report.created_at)}</td>
                  <td className="py-2">
                    {confirming === report.id ? (
                      <span className="flex flex-wrap items-center justify-end gap-2 text-xs">
                        <span className="text-slate-300">Delete?</span>
                        <button
                          type="button"
                          onClick={() => remove.mutate(report.id, { onSuccess: () => setConfirming(null) })}
                          disabled={remove.isPending}
                          className="rounded bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                        >
                          Delete
                        </button>
                        <button type="button" onClick={() => setConfirming(null)} className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => download.mutate(report)}
                          disabled={download.isPending && download.variables?.id === report.id}
                          aria-label={`Download ${report.filename}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(report.id)}
                          aria-label={`Delete ${report.filename}`}
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-800 hover:text-red-300"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorMessage message={download.isError ? getErrorMessage(download.error, 'Could not download the report') : null} />
      <ErrorMessage message={remove.isError ? getErrorMessage(remove.error, 'Could not delete the report') : null} />
    </section>
  )
}

/** Analysis runs with their headline numbers, PDF reports of any run, and the saved reports.
 * ``repository`` limits both to one repository; null shows all of the user's. */
export function HistoryPanel({ repository }: { repository: { projectId: string; repositoryId: string } | null }) {
  const repositoryId = repository?.repositoryId ?? null
  const [limit, setLimit] = useState(HISTORY_PAGE)
  const history = useAnalysisHistory(repositoryId, limit)
  const create = useCreateReport()
  const download = useDownloadReport()
  const entries = history.data?.entries ?? []
  const changes = scoreChanges(entries)
  const created = create.data ?? null
  const everyRepository = repositoryId === null

  return (
    <div className="space-y-6">
      <section aria-label="Analysis history" className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Analysis history</h2>
          <p className="mt-1 text-xs text-slate-400">
            Every full analysis{everyRepository ? ' of your repositories' : ''}, newest first, with its
            health score (and the change from the repository's previous analysis) and what it found.
          </p>
        </div>
        {history.isPending && <p className="text-sm text-slate-400">Loading the history…</p>}
        {history.isError && <ErrorMessage message={getErrorMessage(history.error, 'Could not load the history')} />}
        {history.data && entries.length === 0 && (
          <p className="text-sm text-slate-400">
            No analyses yet.{' '}
            <Link
              to={repository ? `/projects/${repository.projectId}/repositories/${repository.repositoryId}/analysis` : '/upload'}
              className="text-indigo-300 hover:underline"
            >
              {everyRepository ? 'Upload a repository' : 'Run a full analysis'}
            </Link>{' '}
            to start the history.
          </p>
        )}
        {entries.length > 0 && (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">Analysis</th>
                  {everyRepository && <th className="py-2 pr-3 font-medium">Repository</th>}
                  <th className="py-2 pr-3 font-medium">Health</th>
                  <th className="py-2 pr-3 font-medium" title="Critical and high security findings, of all findings">Security</th>
                  <th className="py-2 pr-3 font-medium">Quality issues</th>
                  <th className="py-2 pr-3 font-medium" title="Functions with cyclomatic complexity above 20">Complex functions</th>
                  <th className="py-2 pr-3 font-medium">Vulnerable packages</th>
                  <th className="py-2 font-medium">PDF report</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const base = `/projects/${entry.project_id}/repositories/${entry.repository_id}`
                  const creating = create.isPending && create.variables?.runId === entry.run_id
                  return (
                    <tr key={entry.run_id} className="border-t border-slate-800 align-top">
                      <td className="py-2 pr-3">
                        <span className="block text-slate-200">{formatDateTime(entry.created_at)}</span>
                        <span className="block text-xs text-slate-500">
                          {number(entry.analyzed_file_count)} files · {number(entry.code_lines)} lines
                        </span>
                      </td>
                      {everyRepository && (
                        <td className="py-2 pr-3">
                          <Link to={base} className="text-indigo-300 hover:underline">{entry.repository_name}</Link>
                          <span className="block text-xs text-slate-500">{entry.project_name}</span>
                        </td>
                      )}
                      <td className="py-2 pr-3">
                        {entry.overall === null ? (
                          missing
                        ) : (
                          <Link to={`${base}/health`} className="inline-flex items-baseline gap-1.5 hover:underline" aria-label={`Health ${entry.overall}, grade ${entry.grade}`}>
                            <span className={`font-bold tabular-nums ${scoreTone(entry.overall).text}`}>{entry.overall}</span>
                            <span className="text-xs text-slate-400">{entry.grade}</span>
                            <Change value={changes.get(entry.run_id)} />
                          </Link>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {entry.security_findings === null ? (
                          missing
                        ) : (
                          <span className="text-xs text-slate-300">
                            <Count value={entry.critical_findings} warn /> critical, <Count value={entry.high_findings} warn /> high
                            <span className="block text-slate-500">of {number(entry.security_findings)}</span>
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3"><Count value={entry.quality_issues} /></td>
                      <td className="py-2 pr-3"><Count value={entry.complex_functions} warn /></td>
                      <td className="py-2 pr-3"><Count value={entry.vulnerable_dependencies} warn /></td>
                      <td className="py-2">
                        <button
                          type="button"
                          onClick={() => create.mutate({ projectId: entry.project_id, repositoryId: entry.repository_id, runId: entry.run_id })}
                          disabled={create.isPending}
                          aria-label={`Create a PDF report of the analysis of ${formatDateTime(entry.created_at)}${everyRepository ? ` (${entry.repository_name})` : ''}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FileDown className="h-3.5 w-3.5" aria-hidden="true" />}
                          {creating ? 'Creating…' : 'Create PDF'}
                        </button>
                        {entry.reports > 0 && (
                          <span className="mt-1 block text-xs text-slate-500">{entry.reports === 1 ? '1 saved' : `${entry.reports} saved`}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {history.data && history.data.total > entries.length && (
          <button
            type="button"
            onClick={() => setLimit(limit + HISTORY_PAGE)}
            disabled={history.isFetching}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {history.isFetching ? 'Loading…' : `Show more (${number(history.data.total - entries.length)} older)`}
          </button>
        )}
        {created && !create.isPending && (
          <p role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
            Report created: <span className="font-mono text-xs">{created.filename}</span> ({created.pages} pages, {formatBytes(created.size_bytes)})
            <button
              type="button"
              onClick={() => download.mutate(created)}
              className="inline-flex items-center gap-1 rounded border border-emerald-400/40 px-2 py-0.5 text-xs hover:bg-emerald-500/20"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download now
            </button>
          </p>
        )}
        <ErrorMessage message={create.isError ? getErrorMessage(create.error, 'Could not create the report') : null} />
        <ErrorMessage message={download.isError ? getErrorMessage(download.error, 'Could not download the report') : null} />
      </section>
      <ReportsTable repositoryId={repositoryId} highlight={created?.id ?? null} />
    </div>
  )
}
