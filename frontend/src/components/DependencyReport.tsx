import { ChevronDown, ChevronRight, ExternalLink, FileCode2, Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useRunDependencies } from '../hooks/useDependencyAnalysis'
import { getErrorMessage } from '../services/client'
import { DEPENDENCY_PAGE_SIZE } from '../services/dependencyAnalysis'
import type {
  DependencyEcosystem,
  DependencyFilters,
  DependencyRecord,
  DependencyScopeFilter,
  DependencySort,
  DependencyAnalysisSummary,
  DependencyUpdate,
  LookupStatus,
  VulnerabilitySeverity,
} from '../types/api'
import { formatDateTime } from '../utils/format'
import { ErrorMessage } from './ErrorMessage'

export const VULNERABILITY_SEVERITIES: VulnerabilitySeverity[] = ['critical', 'high', 'medium', 'low', 'unknown']
const SEVERITY_LABELS: Record<VulnerabilitySeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unrated',
}
const SEVERITY_STYLES: Record<VulnerabilitySeverity, string> = {
  critical: 'border-fuchsia-500/50 bg-fuchsia-600/20 text-fuchsia-100',
  high: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
  medium: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
  low: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
  unknown: 'border-slate-600 bg-slate-800/60 text-slate-300',
}
const UPDATES: DependencyUpdate[] = ['major', 'minor', 'patch', 'up_to_date', 'unknown']
export const UPDATE_LABELS: Record<DependencyUpdate, string> = {
  major: 'Major update',
  minor: 'Minor update',
  patch: 'Patch update',
  up_to_date: 'Up to date',
  unknown: 'Unknown',
}
const UPDATE_STYLES: Record<DependencyUpdate, string> = {
  major: 'text-rose-300',
  minor: 'text-amber-300',
  patch: 'text-sky-300',
  up_to_date: 'text-emerald-300',
  unknown: 'text-slate-400',
}
const ECOSYSTEM_LABELS: Record<DependencyEcosystem, string> = { python: 'Python', npm: 'npm' }
const SCOPE_LABELS: Record<DependencyScopeFilter, string> = { runtime: 'Runtime', dev: 'Development', other: 'Peer and optional' }
const SORTS: { value: DependencySort; label: string }[] = [
  { value: 'risk', label: 'Highest risk' },
  { value: 'update', label: 'Most outdated' },
  { value: 'name', label: 'Name' },
]
const LOOKUP_PROBLEMS: Partial<Record<LookupStatus, string>> = {
  partial: 'only part of the packages could be checked in time',
  failed: 'the service could not be reached',
}
const OSV_PAGES = 'https://osv.dev/vulnerability/'

const number = (value: number) => value.toLocaleString('en-US')
const count = (value: number, one: string, many = `${one}s`) => `${number(value)} ${value === 1 ? one : many}`
const CARD = 'min-w-0 rounded-xl border border-slate-800 bg-slate-950/40 p-4'
const SELECT = 'mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100'
const BUTTON = 'rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40'

export function VulnerabilityBadge({ severity }: { severity: VulnerabilitySeverity }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-xs font-semibold ${SEVERITY_STYLES[severity]}`}>
      {SEVERITY_LABELS[severity]}
    </span>
  )
}

export function outdatedCount(summary: DependencyAnalysisSummary): number {
  return summary.updates.major + summary.updates.minor + summary.updates.patch
}

function LookupNotes({ summary }: { summary: DependencyAnalysisSummary }) {
  const { registry, osv, checked_at } = summary.lookups
  const notes: string[] = []
  if (registry === 'disabled' && osv === 'disabled') {
    notes.push('Version and vulnerability lookups are turned off on this server: only the declarations are listed.')
  } else {
    if (LOOKUP_PROBLEMS[registry]) notes.push(`Latest versions are incomplete: ${LOOKUP_PROBLEMS[registry]} (PyPI, npm).`)
    if (LOOKUP_PROBLEMS[osv]) notes.push(`Vulnerabilities are incomplete: ${LOOKUP_PROBLEMS[osv]} (OSV.dev).`)
  }
  if (summary.truncated) notes.push('The repository declares more dependencies than are analyzed (limit reached).')
  if (summary.manifests.invalid > 0) notes.push(`${count(summary.manifests.invalid, 'manifest')} could not be parsed.`)
  return (
    <div className="space-y-1 text-xs">
      {checked_at && (
        <p className="text-slate-500">
          Checked against PyPI, npm and OSV.dev on {formatDateTime(checked_at)}. Vulnerabilities published later are not included.
        </p>
      )}
      {notes.length > 0 && (
        <ul aria-label="Analysis notes" className="space-y-1 text-amber-200/90">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Summary({ summary, update }: { summary: DependencyAnalysisSummary; update: (change: DependencyFilters) => void }) {
  const cards: { label: string; value: number; caption: string; filter: DependencyFilters | null }[] = [
    { label: 'Dependencies', value: summary.dependencies, caption: `In ${count(summary.manifests.parsed, 'manifest')}`, filter: null },
    { label: 'Vulnerable', value: summary.vulnerable_dependencies, caption: count(summary.vulnerabilities, 'known vulnerability', 'known vulnerabilities'), filter: { vulnerable: true } },
    { label: 'Outdated', value: outdatedCount(summary), caption: `${number(summary.updates.major)} behind a major version`, filter: null },
    { label: 'Conflicts', value: summary.conflicts.length, caption: 'Declared with different versions', filter: { conflict: true } },
  ]
  return (
    <section aria-label="Dependency summary" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(({ label, value, caption, filter }) =>
          filter ? (
            <button key={label} type="button" onClick={() => update(filter)} aria-label={`Show ${label.toLowerCase()} dependencies`} className={`${CARD} text-left hover:border-slate-600`}>
              <span className="block text-xs text-slate-400">{label}</span>
              <span className="block text-2xl font-extrabold tabular-nums text-slate-50">{number(value)}</span>
              <span className="block truncate text-xs text-slate-500">{caption}</span>
            </button>
          ) : (
            <div key={label} className={CARD}>
              <p className="text-xs text-slate-400">{label}</p>
              <p className="text-2xl font-extrabold tabular-nums text-slate-50">{number(value)}</p>
              <p className="truncate text-xs text-slate-500">{caption}</p>
            </div>
          ),
        )}
      </div>
      <LookupNotes summary={summary} />
    </section>
  )
}

function Breakdowns({ summary, update }: { summary: DependencyAnalysisSummary; update: (change: DependencyFilters) => void }) {
  const total = Math.max(1, summary.dependencies)
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section aria-label="Vulnerabilities by severity" className={CARD}>
        <h3 className="text-sm font-semibold text-slate-100">Vulnerabilities by severity</h3>
        <p className="text-xs text-slate-500">Published advisories affecting the checked versions (CVSS v3 rating when available).</p>
        <p className="mt-3 flex flex-wrap gap-3">
          {VULNERABILITY_SEVERITIES.map((severity) => (
            <span key={severity} className="inline-flex items-center gap-1.5 text-sm text-slate-200">
              <VulnerabilityBadge severity={severity} />
              <span className="tabular-nums">{number(summary.by_severity[severity])}</span>
            </span>
          ))}
        </p>
      </section>
      <section aria-label="Updates" className={CARD}>
        <h3 className="text-sm font-semibold text-slate-100">Updates</h3>
        <p className="text-xs text-slate-500">The checked version compared with the latest release.</p>
        <ul className="mt-3 space-y-1.5">
          {UPDATES.map((level) => (
            <li key={level}>
              <button type="button" onClick={() => update({ update: level })} aria-label={`Show dependencies: ${UPDATE_LABELS[level].toLowerCase()}`} className="block w-full text-left">
                <span className="flex items-baseline justify-between text-sm">
                  <span className={UPDATE_STYLES[level]}>{UPDATE_LABELS[level]}</span>
                  <span className="tabular-nums text-slate-400">{number(summary.updates[level])}</span>
                </span>
                <span className="mt-1 block h-1.5 rounded-full bg-slate-800">
                  <span className="block h-1.5 rounded-full bg-indigo-400/80" style={{ width: `${(summary.updates[level] / total) * 100}%` }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Conflicts({ summary }: { summary: DependencyAnalysisSummary }) {
  if (summary.conflicts.length === 0) return null
  return (
    <section aria-label="Conflicting declarations" className={CARD}>
      <h3 className="text-sm font-semibold text-slate-100">Conflicting declarations</h3>
      <p className="text-xs text-slate-500">The same package is declared with different versions.</p>
      <ul className="mt-2 divide-y divide-slate-800 text-sm">
        {summary.conflicts.map((conflict) => (
          <li key={`${conflict.ecosystem}:${conflict.name}`} className="py-2">
            <span className="font-mono text-slate-100">{conflict.name}</span>{' '}
            <span className="text-xs text-slate-500">({ECOSYSTEM_LABELS[conflict.ecosystem]})</span>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-400">
              {conflict.declarations.map((declaration) => (
                <li key={declaration.manifest} className="font-mono">
                  {declaration.manifest}: {declaration.specifier || '(any version)'}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}

function versionText(record: DependencyRecord): string {
  if (record.version === null) return 'no version to check'
  return record.version_source === 'pinned' ? `${record.version} (pinned)` : `${record.version} (lowest allowed)`
}

function DependencyRow({ record, explorer }: { record: DependencyRecord; explorer: string }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="py-3">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-start gap-2 text-left">
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-all font-mono text-sm text-slate-100">{record.name}</span>
            <span className="rounded border border-slate-700 px-1 text-xs text-slate-400">{ECOSYSTEM_LABELS[record.ecosystem]}</span>
            {record.max_severity && <VulnerabilityBadge severity={record.max_severity} />}
            {record.conflict && <span className="rounded border border-amber-500/40 px-1 text-xs text-amber-200">Conflict</span>}
          </span>
          <span className="block truncate text-xs text-slate-400">
            {record.specifier || '(any version)'} · {versionText(record)} · latest {record.latest_version ?? 'unknown'} ·{' '}
            <span className={UPDATE_STYLES[record.update]}>{UPDATE_LABELS[record.update]}</span>
          </span>
          <span className="block truncate font-mono text-xs text-slate-500">
            {record.manifest}
            {record.line !== null && `:${record.line}`} · {record.scope}
            {record.vulnerability_count > 0 && ` · ${count(record.vulnerability_count, 'vulnerability', 'vulnerabilities')}`}
          </span>
        </span>
      </button>
      {open && (
        <div className="ml-6 mt-2 space-y-2 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm">
          {record.vulnerabilities.length === 0 ? (
            <p className="text-slate-400">
              {record.version === null
                ? 'No version is declared, so vulnerabilities could not be checked.'
                : 'No published vulnerabilities were found for the checked version.'}
            </p>
          ) : (
            <ul aria-label={`Vulnerabilities of ${record.name}`} className="space-y-2">
              {record.vulnerabilities.map((vulnerability) => {
                const cves = vulnerability.aliases.filter((alias) => alias.startsWith('CVE-'))
                const link = vulnerability.url.startsWith(OSV_PAGES) ? vulnerability.url : null
                return (
                  <li key={vulnerability.id} className="space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2">
                      <VulnerabilityBadge severity={vulnerability.severity} />
                      <span className="font-mono text-xs text-slate-200">{[...cves, vulnerability.id].join(' · ')}</span>
                      {vulnerability.score !== null && <span className="text-xs text-slate-400">CVSS {vulnerability.score.toFixed(1)}</span>}
                    </p>
                    <p className="text-slate-300">{vulnerability.summary || 'No summary published.'}</p>
                    <p className="flex flex-wrap items-center gap-3 text-xs">
                      <span className={vulnerability.fixed_in ? 'text-emerald-300' : 'text-amber-300'}>
                        {vulnerability.fixed_in ? `Fixed in ${vulnerability.fixed_in}` : 'No fixed version published'}
                      </span>
                      {link && (
                        <a href={link} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-indigo-300 hover:underline">
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> {vulnerability.id} on OSV.dev
                        </a>
                      )}
                    </p>
                  </li>
                )
              })}
            </ul>
          )}
          <Link
            to={explorer}
            state={{ openFile: { path: record.manifest, line: record.line ?? 1 } }}
            className="inline-flex items-center gap-1 text-xs text-indigo-300 hover:underline"
          >
            <FileCode2 className="h-3.5 w-3.5" aria-hidden="true" /> Open {record.manifest} in the explorer
          </Link>
        </div>
      )}
    </li>
  )
}

function DependencyList({ projectId, repositoryId, runId, filters, setFilters }: {
  projectId: string
  repositoryId: string
  runId: string
  filters: DependencyFilters
  setFilters: (filters: DependencyFilters) => void
}) {
  const records = useRunDependencies(projectId, repositoryId, runId, filters)
  const [search, setSearch] = useState(filters.q ?? '')
  const update = (change: DependencyFilters) => setFilters({ ...filters, ...change, page: 1 })
  const page = filters.page ?? 1
  const total = records.data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / DEPENDENCY_PAGE_SIZE))
  const explorer = `/projects/${projectId}/repositories/${repositoryId}`
  const vulnerableValue = filters.vulnerable === undefined ? '' : String(filters.vulnerable)

  function onSearch(event: FormEvent) {
    event.preventDefault()
    update({ q: search.trim() || undefined })
  }

  return (
    <section aria-label="Dependencies" className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-slate-400">
          Sort by
          <select value={filters.sort ?? 'risk'} onChange={(event) => update({ sort: event.target.value as DependencySort })} className={SELECT}>
            {SORTS.map((sort) => (
              <option key={sort.value} value={sort.value}>{sort.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Ecosystem
          <select value={filters.ecosystem ?? ''} onChange={(event) => update({ ecosystem: (event.target.value || undefined) as DependencyEcosystem | undefined })} className={SELECT}>
            <option value="">All</option>
            <option value="python">Python</option>
            <option value="npm">npm</option>
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Scope
          <select value={filters.scope ?? ''} onChange={(event) => update({ scope: (event.target.value || undefined) as DependencyScopeFilter | undefined })} className={SELECT}>
            <option value="">All</option>
            {(Object.keys(SCOPE_LABELS) as DependencyScopeFilter[]).map((scope) => (
              <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Update
          <select value={filters.update ?? ''} onChange={(event) => update({ update: (event.target.value || undefined) as DependencyUpdate | undefined })} className={SELECT}>
            <option value="">Any</option>
            {UPDATES.map((level) => (
              <option key={level} value={level}>{UPDATE_LABELS[level]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Vulnerabilities
          <select
            value={vulnerableValue}
            onChange={(event) => update({ vulnerable: event.target.value === '' ? undefined : event.target.value === 'true' })}
            className={SELECT}
          >
            <option value="">Any</option>
            <option value="true">Vulnerable</option>
            <option value="false">No known vulnerabilities</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1.5 pb-2 text-xs text-slate-300">
          <input type="checkbox" checked={filters.conflict === true} onChange={(event) => update({ conflict: event.target.checked ? true : undefined })} />
          Conflicts only
        </label>
        <form onSubmit={onSearch} role="search" className="flex w-full min-w-0 items-end gap-2 sm:w-auto sm:flex-1">
          <label className="min-w-0 flex-1 text-xs text-slate-400">
            Search dependencies
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={200}
              placeholder="Package or manifest"
              className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
            />
          </label>
          <button type="submit" className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
            <Search className="h-4 w-4" aria-hidden="true" /> Search
          </button>
        </form>
      </div>
      {records.isPending && <p className="text-sm text-slate-400">Loading dependencies…</p>}
      {records.isError && <ErrorMessage message={getErrorMessage(records.error, 'Could not load dependencies')} />}
      {records.data && (
        <>
          <p role="status" className="text-xs text-slate-400">
            {total === 0 ? 'No dependencies match these filters.' : `${count(total, 'dependency', 'dependencies')} · page ${page} of ${pages}`}
          </p>
          <ul className="divide-y divide-slate-800">
            {records.data.items.map((record) => (
              <DependencyRow key={record.id} record={record} explorer={explorer} />
            ))}
          </ul>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setFilters({ ...filters, page: page - 1 })} className={BUTTON}>
                Previous
              </button>
              <button type="button" disabled={page >= pages} onClick={() => setFilters({ ...filters, page: page + 1 })} className={BUTTON}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

/** The dependency results of one run: summary, breakdowns, conflicts and the dependency list. */
export function DependencyReport({ projectId, repositoryId, runId, summary }: {
  projectId: string
  repositoryId: string
  runId: string
  summary: DependencyAnalysisSummary
}) {
  const [filters, setFilters] = useState<DependencyFilters>({})
  const update = (change: DependencyFilters) => setFilters({ ...filters, ...change, page: 1 })
  if (summary.dependencies === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
        No dependencies are declared in package.json, pyproject.toml or requirements*.txt files.
      </p>
    )
  }
  return (
    <div className="space-y-5">
      <Summary summary={summary} update={update} />
      <Breakdowns summary={summary} update={update} />
      <Conflicts summary={summary} />
      <DependencyList projectId={projectId} repositoryId={repositoryId} runId={runId} filters={filters} setFilters={setFilters} />
    </div>
  )
}
