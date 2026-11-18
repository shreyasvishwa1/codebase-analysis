import { FileSearch, UploadCloud } from 'lucide-react'
import { Link } from 'react-router-dom'

import { SEVERITIES, SeverityBadge } from '../components/CodeQualityReport'
import { ErrorMessage } from '../components/ErrorMessage'
import { useQualityOverview } from '../hooks/useCodeQuality'
import { getErrorMessage } from '../services/client'
import { formatDateTime } from '../utils/format'

const number = (value: number) => value.toLocaleString('en-US')

export function CodeAnalysisPage() {
  const overview = useQualityOverview()
  const repositories = overview.data?.repositories ?? []
  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="page-eyebrow">Module 3</p>
        <h1 className="page-title">Code Analysis</h1>
        <p className="page-lede">
          Code-quality results from each repository's latest full analysis: bug risks, unused and
          dead code, duplication, naming, documentation and formatting.
        </p>
      </div>

      {overview.isPending && <p className="text-sm text-slate-400">Loading code analysis…</p>}
      {overview.isError && (
        <ErrorMessage message={getErrorMessage(overview.error, 'Could not load code analysis')} />
      )}
      {overview.data && repositories.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">
          <UploadCloud className="mx-auto h-8 w-8 text-indigo-300" aria-hidden="true" />
          <p className="mt-3 text-sm text-slate-300">
            No code-quality results yet. Upload a repository and run a full analysis.
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
        <ul aria-label="Analyzed repositories" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {repositories.map((entry) => (
            <li key={entry.repository_id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-glow">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-slate-100">{entry.repository_name}</h2>
                  <p className="truncate text-xs text-slate-400">
                    {entry.project_name} · {formatDateTime(entry.created_at)}
                  </p>
                </div>
                <Link
                  to={`/projects/${entry.project_id}/repositories/${entry.repository_id}/code-analysis`}
                  aria-label={`View the code analysis of ${entry.repository_name}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                >
                  <FileSearch className="h-4 w-4" aria-hidden="true" /> View report
                </Link>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-400">Issues</dt>
                  <dd className="text-xl font-bold tabular-nums text-slate-50">{number(entry.quality.issues)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Duplication</dt>
                  <dd className="text-xl font-bold tabular-nums text-slate-50">{entry.quality.duplication.percent.toFixed(1)}%</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">Files analyzed</dt>
                  <dd className="text-xl font-bold tabular-nums text-slate-50">{number(entry.analyzed_file_count)}</dd>
                </div>
              </dl>
              <p className="mt-3 flex flex-wrap gap-2" aria-label="Issues by severity">
                {SEVERITIES.map((severity) => (
                  <span key={severity} className="inline-flex items-center gap-1 text-xs text-slate-300">
                    <SeverityBadge severity={severity} />
                    <span className="tabular-nums">{number(entry.quality.by_severity[severity])}</span>
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
