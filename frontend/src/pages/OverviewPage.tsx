import { Activity, FileCode2, FolderGit2, GitBranch, Layers, ScanSearch, UploadCloud, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { ErrorMessage } from '../components/ErrorMessage'
import { scoreTone } from '../components/HealthReport'
import { languageLabel } from '../components/LanguageStats'
import { useDashboard } from '../hooks/useAnalysisRuns'
import { useHealthOverview } from '../hooks/useHealthScore'
import { getErrorMessage } from '../services/client'
import type { DashboardSummary, LanguageBreakdown } from '../types/api'
import { formatDateTime } from '../utils/format'
import { CountUp } from '../components/CountUp'

const SERIES = ['rgb(var(--indigo-500))', 'rgb(var(--slate-400))', 'rgb(var(--emerald-500))', 'rgb(var(--sky-500))', 'rgb(var(--rose-500))']
const OTHER = 'rgb(var(--slate-600))'
const PANEL = 'min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-glow'
const number = (value: number) => value.toLocaleString('en-US')

function Kpi({ icon: Icon, accent, label, value, caption }: {
  icon: LucideIcon
  accent: string
  label: string
  value: string
  caption: string
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 shadow-glow">
      <span aria-hidden="true" className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 ${accent}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</p>
        <p className="text-2xl font-extrabold tabular-nums text-slate-50"><CountUp>{value}</CountUp></p>
        <p className="truncate text-xs text-slate-400">{caption}</p>
      </div>
    </div>
  )
}

function slices(languages: LanguageBreakdown[]) {
  const top = languages.slice(0, SERIES.length).map((entry, index) => ({
    name: languageLabel(entry.language),
    value: entry.code_lines,
    color: SERIES[index],
  }))
  const rest = languages.slice(SERIES.length).reduce((sum, entry) => sum + entry.code_lines, 0)
  if (rest > 0) top.push({ name: 'Other', value: rest, color: OTHER })
  return top
}

function LanguagePanel({ data }: { data: DashboardSummary }) {
  const parts = slices(data.languages)
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  return (
    <section className={PANEL} aria-label="Programming languages">
      <h2 className="text-sm font-semibold text-slate-100">Programming languages</h2>
      <p className="mt-1 text-xs text-slate-400">Lines of code across your repositories' latest analyses.</p>
      {total === 0 ? (
        <p className="mt-6 text-sm text-slate-400">Run a full analysis to see language distribution.</p>
      ) : (
        <div className="mt-2 flex flex-col items-center gap-4 sm:flex-row">
          <div className="h-44 w-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={parts} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="100%" paddingAngle={1} stroke="rgb(var(--slate-900))" strokeWidth={2} isAnimationActive={false}>
                  {parts.map((part) => (
                    <Cell key={part.name} fill={part.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => `${number(value)} lines`}
                  contentStyle={{ background: 'rgb(var(--slate-900))', border: '1px solid rgb(var(--slate-700))', borderRadius: 8 }}
                  itemStyle={{ color: 'rgb(var(--slate-100))' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-full space-y-1.5 text-sm">
            {parts.map((part) => (
              <li key={part.name} className="flex items-center gap-2">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: part.color }} />
                <span className="flex-1 truncate text-slate-200">{part.name}</span>
                <span className="tabular-nums text-slate-400">{((part.value / total) * 100).toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

const HEALTH_SHOWN = 6

/** Each repository's latest health score, lowest first: the ones that need attention. */
function HealthPanel() {
  const overview = useHealthOverview()
  const scored = (overview.data?.repositories ?? [])
    .filter((entry) => entry.overall !== null)
    .sort((a, b) => (a.overall ?? 0) - (b.overall ?? 0))
  const average = scored.length ? Math.round(scored.reduce((sum, entry) => sum + (entry.overall ?? 0), 0) / scored.length) : null
  return (
    <section className={PANEL} aria-label="Code health">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Code health</h2>
          <p className="mt-1 text-xs text-slate-400">Latest score of each repository, lowest first.</p>
        </div>
        {average !== null && (
          <p className="text-right text-xs text-slate-400">
            Average <span className={`block text-2xl font-bold tabular-nums ${scoreTone(average).text}`}><CountUp>{String(average)}</CountUp></span>
          </p>
        )}
      </div>
      {overview.isPending && <p className="mt-4 text-sm text-slate-400">Loading scores…</p>}
      {overview.isError && <ErrorMessage message={getErrorMessage(overview.error, 'Could not load the scores')} />}
      {overview.data && scored.length === 0 && (
        <p className="mt-4 text-sm text-slate-400">No scores yet: run a full analysis of a repository.</p>
      )}
      {scored.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-800">
          {scored.slice(0, HEALTH_SHOWN).map((entry) => (
            <li key={entry.repository_id}>
              <Link
                to={`/projects/${entry.project_id}/repositories/${entry.repository_id}/health`}
                className="flex items-center justify-between gap-3 py-2 hover:text-slate-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-slate-200">{entry.repository_name}</span>
                  <span className="block truncate text-xs text-slate-500">{entry.project_name}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`text-lg font-bold tabular-nums ${scoreTone(entry.overall).text}`}>{entry.overall}</span>
                  <span className="ml-1 text-xs text-slate-400">{entry.grade}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {scored.length > HEALTH_SHOWN && (
        <Link to="/health-score" className="mt-2 inline-block text-xs text-indigo-300 hover:underline">
          All {scored.length} scores
        </Link>
      )}
    </section>
  )
}

function RecentPanel({ data }: { data: DashboardSummary }) {
  return (
    <section className={PANEL} aria-label="Recent analyses">
      <h2 className="text-sm font-semibold text-slate-100">Recent analyses</h2>
      <p className="mt-1 text-xs text-slate-400">The latest full analyses across your projects.</p>
      {data.recent_runs.length === 0 ? (
        <p className="mt-6 text-sm text-slate-400">No analyses yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-800">
          {data.recent_runs.map((run) => (
            <li key={run.run_id}>
              <Link
                to={`/projects/${run.project_id}/repositories/${run.repository_id}/analysis`}
                className="flex items-center justify-between gap-3 py-2.5 hover:text-indigo-200"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-100">{run.repository_name}</span>
                  <span className="block truncate text-xs text-slate-400">
                    {run.project_name} · {formatDateTime(run.created_at)}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums text-slate-400">
                  {number(run.code_lines)} lines
                  <span className="block">{languageLabel(run.top_language)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function OverviewPage() {
  const dashboard = useDashboard()
  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="page-eyebrow">Repository intelligence</p>
        <h1 className="page-title">Overview</h1>
        <p className="page-lede">
          Totals from your repositories' stored analyses. Upload a repository, run a full analysis,
          and its results appear here.
        </p>
      </div>

      {dashboard.isPending && <p className="text-sm text-slate-400">Loading overview…</p>}
      {dashboard.isError && (
        <ErrorMessage message={getErrorMessage(dashboard.error, 'Could not load the overview')} />
      )}
      {dashboard.data && dashboard.data.projects === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center">
          <UploadCloud className="mx-auto h-8 w-8 text-indigo-300" aria-hidden="true" />
          <p className="mt-3 text-sm text-slate-300">You haven't added a repository yet.</p>
          <Link to="/upload" className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-slate-50 hover:bg-indigo-500">
            Upload a repository
          </Link>
        </div>
      )}
      {dashboard.data && dashboard.data.projects > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi icon={FolderGit2} accent="text-slate-300" label="Projects" value={number(dashboard.data.projects)} caption="In your workspace" />
            <Kpi icon={GitBranch} accent="text-slate-300" label="Repositories" value={number(dashboard.data.repositories)} caption={`${number(dashboard.data.ready_repositories)} ingested`} />
            <Kpi icon={ScanSearch} accent="text-slate-300" label="Analyzed" value={number(dashboard.data.analyzed_repositories)} caption="Repositories with a run" />
            <Kpi icon={FileCode2} accent="text-slate-300" label="Lines of code" value={number(dashboard.data.code_lines)} caption={`${number(dashboard.data.analyzed_files)} files analyzed`} />
            <Kpi icon={Layers} accent="text-slate-300" label="Analyses" value={number(dashboard.data.total_runs)} caption="Runs stored in history" />
            <Kpi icon={Activity} accent="text-slate-300" label="Active jobs" value={number(dashboard.data.active_jobs)} caption="Ingestions and analyses" />
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <LanguagePanel data={dashboard.data} />
            <RecentPanel data={dashboard.data} />
          </div>
          <HealthPanel />
        </>
      )}
    </div>
  )
}
