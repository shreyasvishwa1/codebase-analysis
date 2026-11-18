import { ShieldCheck, UploadCloud } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ErrorMessage } from '../components/ErrorMessage'
import { SECURITY_SEVERITIES, SecurityDisclaimer, SecuritySeverityBadge } from '../components/SecurityReport'
import { useSecurityOverview } from '../hooks/useSecurity'
import { getErrorMessage } from '../services/client'
import { formatDateTime } from '../utils/format'

const number = (value: number) => value.toLocaleString('en-US')

export function SecurityPage() {
  const overview = useSecurityOverview()
  const repositories = overview.data?.repositories ?? []
  const totalFindings = repositories.reduce((sum, entry) => sum + entry.security.findings, 0)
  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="page-eyebrow">Module 4</p>
        <h1 className="page-title">Security</h1>
        <p className="page-lede">
          Security findings from each repository&apos;s latest full analysis: committed secrets,
          injection and XSS risks, insecure configuration and containers, mapped to the OWASP
          Top 10.
        </p>
      </div>

      {overview.isPending && <p className="text-sm text-slate-400">Loading security results…</p>}
      {overview.isError && (
        <ErrorMessage message={getErrorMessage(overview.error, 'Could not load security results')} />
      )}
      {overview.data && repositories.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">
          <UploadCloud className="mx-auto h-8 w-8 text-indigo-300" aria-hidden="true" />
          <p className="mt-3 text-sm text-slate-300">
            No security results yet. Upload a repository and run a full analysis.
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
        <>
          <SecurityDisclaimer findings={totalFindings} />
          <ul aria-label="Scanned repositories" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {repositories.map((entry) => (
              <li key={entry.repository_id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-glow">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-slate-100">{entry.repository_name}</h2>
                    <p className="truncate text-xs text-slate-400">
                      {entry.project_name} · {formatDateTime(entry.created_at)}
                    </p>
                  </div>
                  <Link
                    to={`/projects/${entry.project_id}/repositories/${entry.repository_id}/security`}
                    aria-label={`View the security report of ${entry.repository_name}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" /> View report
                  </Link>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400">Findings</dt>
                    <dd className="text-xl font-bold tabular-nums text-slate-50">{number(entry.security.findings)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Confirmed</dt>
                    <dd className="text-xl font-bold tabular-nums text-slate-50">{number(entry.security.by_confidence.confirmed)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Files scanned</dt>
                    <dd className="text-xl font-bold tabular-nums text-slate-50">{number(entry.security.files_scanned)}</dd>
                  </div>
                </dl>
                <p className="mt-3 flex flex-wrap gap-2" aria-label="Findings by severity">
                  {SECURITY_SEVERITIES.map((severity) => (
                    <span key={severity} className="inline-flex items-center gap-1 text-xs text-slate-300">
                      <SecuritySeverityBadge severity={severity} />
                      <span className="tabular-nums">{number(entry.security.by_severity[severity])}</span>
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
