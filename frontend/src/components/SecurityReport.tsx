import { ChevronDown, ChevronRight, ExternalLink, FileCode2, Search, ShieldAlert, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useRunSecurityFindings } from '../hooks/useSecurity'
import { getErrorMessage } from '../services/client'
import { FINDING_PAGE_SIZE } from '../services/security'
import type {
  FindingConfidence,
  FindingFilters,
  OwaspCategory,
  SecurityFinding,
  SecuritySeverity,
  SecuritySummary,
} from '../types/api'
import { ErrorMessage } from './ErrorMessage'
import { CountUp } from './CountUp'
import { CodeExcerpt } from './CodeExcerpt'

export const SECURITY_SEVERITIES: SecuritySeverity[] = ['critical', 'high', 'medium', 'low']
export const SECURITY_SEVERITY_LABELS: Record<SecuritySeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}
const SEVERITY_STYLES: Record<SecuritySeverity, string> = {
  critical: 'border-fuchsia-500/50 bg-fuchsia-600/20 text-fuchsia-100',
  high: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
  medium: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  low: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
}
const CONFIDENCES: FindingConfidence[] = ['confirmed', 'potential']
const CONFIDENCE_LABELS: Record<FindingConfidence, string> = {
  confirmed: 'Confirmed',
  potential: 'Potential',
}
export const OWASP_LABELS: Record<OwaspCategory, string> = {
  A01: 'Broken Access Control',
  A02: 'Cryptographic Failures',
  A03: 'Injection',
  A04: 'Insecure Design',
  A05: 'Security Misconfiguration',
  A06: 'Vulnerable and Outdated Components',
  A07: 'Identification and Authentication Failures',
  A08: 'Software and Data Integrity Failures',
  A09: 'Security Logging and Monitoring Failures',
  A10: 'Server-Side Request Forgery',
}
const OWASP_KEYS = Object.keys(OWASP_LABELS) as OwaspCategory[]
const BANDIT_DOCS = 'https://bandit.readthedocs.io/'
const OSV_PAGES = 'https://osv.dev/vulnerability/'
const TOOL_NAMES: Record<string, string> = { bandit: 'Bandit', osv: 'OSV.dev' }
const BANDIT_PROBLEMS: Record<string, string> = {
  timeout: 'the Python security scan took too long and was stopped',
  unavailable: 'the Python security scanner is not available on the server',
  failed: 'the Python security scanner failed',
  too_large: 'the Python security scanner produced too large a report',
}

const number = (value: number) => value.toLocaleString('en-US')
const count = (value: number, noun: string) => `${number(value)} ${noun}${value === 1 ? '' : 's'}`
const CARD = 'min-w-0 rounded-xl border border-slate-800 bg-slate-950/40 p-4'
const SELECT = 'mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100'

export function SecuritySeverityBadge({ severity }: { severity: SecuritySeverity }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold ${SEVERITY_STYLES[severity]}`}>
      {SECURITY_SEVERITY_LABELS[severity]}
    </span>
  )
}

function ConfidenceBadge({ confidence }: { confidence: FindingConfidence }) {
  const style = confidence === 'confirmed' ? 'border-slate-500 text-slate-100' : 'border-dashed border-slate-600 text-slate-400'
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-xs ${style}`}>
      {CONFIDENCE_LABELS[confidence]}
    </span>
  )
}

/** Shown with every security result: a scan can find problems, never prove their absence. */
export function SecurityDisclaimer({ findings }: { findings: number }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-xl border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-300">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden="true" />
      <span>
        {findings === 0 ? 'These checks found no security problems. ' : ''}
        Automated checks find known patterns only; they cannot prove that a project is secure.
        <strong className="font-semibold text-slate-200"> Confirmed</strong> means the insecure code is
        definitely present; <strong className="font-semibold text-slate-200">potential</strong> means a
        pattern that needs a person to review it.
      </span>
    </p>
  )
}

function SecurityNotes({ summary }: { summary: SecuritySummary }) {
  const notes: string[] = []
  const problem = BANDIT_PROBLEMS[summary.bandit]
  if (problem) notes.push(`Python findings are missing from this run: ${problem}.`)
  if (summary.bandit === 'skipped' && summary.files_scanned > 0) {
    notes.push('No Python files: the secret, configuration, container and JavaScript checks ran.')
  }
  if (summary.stored_findings < summary.findings) {
    notes.push(`The ${number(summary.stored_findings)} most severe of ${number(summary.findings)} findings are listed.`)
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

function Summary({ summary, onSeverity, onConfidence }: {
  summary: SecuritySummary
  onSeverity: (severity: SecuritySeverity) => void
  onConfidence: (confidence: FindingConfidence) => void
}) {
  return (
    <section aria-label="Security summary" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className={CARD}>
          <p className="text-xs text-slate-400">Findings</p>
          <p className="text-2xl font-extrabold tabular-nums text-slate-50"><CountUp>{number(summary.findings)}</CountUp></p>
          <p className="text-xs text-slate-500">{count(summary.files_scanned, 'file')} scanned</p>
        </div>
        {SECURITY_SEVERITIES.map((severity) => (
          <button
            key={severity}
            type="button"
            onClick={() => onSeverity(severity)}
            aria-label={`Show ${SECURITY_SEVERITY_LABELS[severity].toLowerCase()} severity findings`}
            className={`${CARD} text-left hover:border-slate-600`}
          >
            <SecuritySeverityBadge severity={severity} />
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-50"><CountUp>{number(summary.by_severity[severity])}</CountUp></p>
          </button>
        ))}
      </div>
      <p className="flex flex-wrap gap-2 text-xs text-slate-400">
        {CONFIDENCES.map((confidence) => (
          <button
            key={confidence}
            type="button"
            onClick={() => onConfidence(confidence)}
            aria-label={`Show ${confidence} findings`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2 py-1 hover:border-slate-600"
          >
            <ConfidenceBadge confidence={confidence} />
            <span className="tabular-nums text-slate-200">{number(summary.by_confidence[confidence])}</span>
          </button>
        ))}
      </p>
      <SecurityNotes summary={summary} />
    </section>
  )
}

function OwaspBreakdown({ summary, onOwasp }: { summary: SecuritySummary; onOwasp: (key: OwaspCategory) => void }) {
  const rows = OWASP_KEYS.map((key) => ({ key, value: summary.by_owasp[key] })).filter((row) => row.value > 0)
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <section aria-label="OWASP Top 10 categories" className={CARD}>
      <h3 className="text-sm font-semibold text-slate-100">OWASP Top 10 (2021)</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No findings.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map(({ key, value }) => (
            <li key={key}>
              <button type="button" onClick={() => onOwasp(key)} className="block w-full text-left">
                <span className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-slate-200">
                    <span className="font-mono text-xs text-slate-400">{key}</span> {OWASP_LABELS[key]}
                  </span>
                  <span className="tabular-nums text-slate-400">{number(value)}</span>
                </span>
                <span className="mt-1 block h-2 rounded-full bg-slate-800">
                  <span
                    className="bar-grow block h-2 rounded-full bg-rose-500"
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

function TopFiles({ summary, onPath }: { summary: SecuritySummary; onPath: (path: string) => void }) {
  return (
    <section aria-label="Files with the most findings" className={CARD}>
      <h3 className="text-sm font-semibold text-slate-100">Files with the most findings</h3>
      {summary.top_files.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No findings.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-800">
          {summary.top_files.map((file) => (
            <li key={file.path}>
              <button
                type="button"
                onClick={() => onPath(file.path)}
                className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm hover:text-indigo-200"
              >
                <span className="min-w-0 truncate font-mono text-xs text-slate-200">{file.path}</span>
                <span className="shrink-0 tabular-nums text-xs text-slate-400">
                  {count(file.findings, 'finding')}
                  {file.critical > 0 && <span className="ml-1 text-fuchsia-300">· {number(file.critical)} critical</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** How request input reached the finding's line: each step opens the file at its line. */
function FlowPath({ finding, explorer }: { finding: SecurityFinding; explorer: string }) {
  const steps = finding.flow ?? []
  if (steps.length < 2) return null
  const last = steps.length - 1
  return (
    <div>
      <p className="font-semibold text-slate-200">How the input gets here</p>
      <ol aria-label="Data flow" className="mt-1.5 flex flex-wrap items-center gap-y-1.5 font-mono text-xs">
        {steps.map((step, index) => (
          <li key={`${step.line}-${step.label}-${index}`} className="flex items-center">
            <Link
              to={explorer}
              state={{ openFile: { path: finding.path, line: step.line } }}
              className={`rounded-md border px-2 py-0.5 hover:underline ${
                index === 0
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  : index === last
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                    : 'border-slate-700 bg-slate-900 text-slate-200'
              }`}
            >
              <span className="sr-only">{index === 0 ? 'Comes in as ' : index === last ? 'Reaches ' : 'Then '}</span>
              {step.label} <span className="text-slate-500">line {step.line}</span>
            </Link>
            {index < last && (
              <span aria-hidden="true" className="flow-arrow px-1.5 text-slate-500">
                →
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

function FindingRow({
  finding,
  explorer,
  projectId,
  repositoryId,
}: {
  finding: SecurityFinding
  explorer: string
  projectId: string
  repositoryId: string
}) {
  const [open, setOpen] = useState(false)
  const lines = finding.end_line > finding.line ? `${finding.line}–${finding.end_line}` : String(finding.line)
  // Links only to Bandit's documentation and OSV.dev advisories; CWE links are built here.
  const docs = finding.doc_url?.startsWith(BANDIT_DOCS) ? finding.doc_url : null
  const advisory = finding.doc_url?.startsWith(OSV_PAGES) ? finding.doc_url : null
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
        <SecuritySeverityBadge severity={finding.severity} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-words text-sm font-medium text-slate-100">{finding.title}</span>
            <ConfidenceBadge confidence={finding.confidence} />
          </span>
          <span className="block break-words text-sm text-slate-300">{finding.message}</span>
          <span className="block truncate font-mono text-xs text-slate-400">
            {finding.path}:{lines} · {finding.rule_id} · {finding.owasp} {OWASP_LABELS[finding.owasp]}
          </span>
        </span>
      </button>
      {open && (
        <div className="ml-6 mt-2 space-y-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm">
          <CodeExcerpt
            projectId={projectId}
            repositoryId={repositoryId}
            path={finding.path}
            line={finding.line}
            endLine={finding.end_line}
            cwe={finding.cwe}
            pathLines={(finding.flow ?? []).map((step) => step.line)}
          />
          <FlowPath finding={finding} explorer={explorer} />
          <p className="text-slate-300">
            <span className="font-semibold text-slate-200">Why it matters: </span>
            {finding.explanation}
          </p>
          <p className="text-emerald-200/90">
            <span className="font-semibold text-emerald-200">How to fix it: </span>
            {finding.recommendation}
          </p>
          <p className="flex flex-wrap items-center gap-3 text-xs">
            <Link
              to={explorer}
              state={{ openFile: { path: finding.path, line: finding.line } }}
              className="inline-flex items-center gap-1 text-indigo-300 hover:underline"
            >
              <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" /> Open in explorer at line {finding.line}
            </Link>
            {finding.cwe !== null && (
              <a
                href={`https://cwe.mitre.org/data/definitions/${finding.cwe}.html`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-indigo-300 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> CWE-{finding.cwe}
              </a>
            )}
            {docs && (
              <a href={docs} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-indigo-300 hover:underline">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Bandit {finding.rule_id} documentation
              </a>
            )}
            {advisory && (
              <a href={advisory} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-indigo-300 hover:underline">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Advisory {finding.rule_id} on OSV.dev
              </a>
            )}
            <span className="text-slate-500">Found by {TOOL_NAMES[finding.tool] ?? 'CodeBase Analysis'}</span>
          </p>
        </div>
      )}
    </li>
  )
}

function FindingList({ projectId, repositoryId, runId, filters, setFilters }: {
  projectId: string
  repositoryId: string
  runId: string
  filters: FindingFilters
  setFilters: (filters: FindingFilters) => void
}) {
  const findings = useRunSecurityFindings(projectId, repositoryId, runId, filters)
  const [search, setSearch] = useState(filters.q ?? '')
  const page = filters.page ?? 1
  const total = findings.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / FINDING_PAGE_SIZE))
  const explorer = `/projects/${projectId}/repositories/${repositoryId}`
  const update = (change: FindingFilters) => setFilters({ ...filters, ...change, page: 1 })

  function onSearch(event: FormEvent) {
    event.preventDefault()
    update({ q: search.trim() || undefined })
  }

  return (
    <section aria-label="Findings" className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-400">
          Severity
          <select
            value={filters.severity ?? ''}
            onChange={(event) => update({ severity: (event.target.value || undefined) as SecuritySeverity | undefined })}
            className={SELECT}
          >
            <option value="">All severities</option>
            {SECURITY_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>{SECURITY_SEVERITY_LABELS[severity]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Confidence
          <select
            value={filters.confidence ?? ''}
            onChange={(event) => update({ confidence: (event.target.value || undefined) as FindingConfidence | undefined })}
            className={SELECT}
          >
            <option value="">Confirmed and potential</option>
            {CONFIDENCES.map((confidence) => (
              <option key={confidence} value={confidence}>{CONFIDENCE_LABELS[confidence]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          OWASP category
          <select
            value={filters.owasp ?? ''}
            onChange={(event) => update({ owasp: (event.target.value || undefined) as OwaspCategory | undefined })}
            className={`${SELECT} max-w-[16rem]`}
          >
            <option value="">All categories</option>
            {OWASP_KEYS.map((key) => (
              <option key={key} value={key}>{key} {OWASP_LABELS[key]}</option>
            ))}
          </select>
        </label>
        {/* Its own full-width line on phones; beside the filters from the sm breakpoint. */}
        <form onSubmit={onSearch} role="search" className="flex w-full min-w-0 items-end gap-2 sm:w-auto sm:flex-1">
          <label className="min-w-0 flex-1 text-xs text-slate-400">
            Search findings
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={200}
              placeholder="Title, message, file or rule"
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
            className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-slate-50"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </p>
      )}

      {findings.isPending && <p className="text-sm text-slate-400">Loading findings…</p>}
      {findings.isError && <ErrorMessage message={getErrorMessage(findings.error, 'Could not load findings')} />}
      {findings.data && (
        <>
          <p className="text-xs text-slate-400" role="status">
            {total === 0 ? 'No findings match these filters.' : `${count(total, 'finding')} · page ${page} of ${pages}`}
          </p>
          <ul className="divide-y divide-slate-800">
            {findings.data.items.map((finding) => (
              <FindingRow key={finding.id} finding={finding} explorer={explorer} projectId={projectId} repositoryId={repositoryId} />
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

/** The security results of one run: summary, breakdowns and the filterable finding list. */
export function SecurityReport({ projectId, repositoryId, runId, summary }: {
  projectId: string
  repositoryId: string
  runId: string
  summary: SecuritySummary
}) {
  const [filters, setFilters] = useState<FindingFilters>({})
  const update = (change: FindingFilters) => setFilters({ ...filters, ...change, page: 1 })
  return (
    <div className="space-y-5">
      <SecurityDisclaimer findings={summary.findings} />
      <Summary
        summary={summary}
        onSeverity={(severity) => update({ severity })}
        onConfidence={(confidence) => update({ confidence })}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OwaspBreakdown summary={summary} onOwasp={(owasp) => update({ owasp })} />
        <TopFiles summary={summary} onPath={(path) => update({ path })} />
      </div>
      <FindingList
        projectId={projectId}
        repositoryId={repositoryId}
        runId={runId}
        filters={filters}
        setFilters={setFilters}
      />
    </div>
  )
}
