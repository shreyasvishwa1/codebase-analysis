import type { CSSProperties } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { HealthDimension, HealthDimensionKey, HealthPoint, HealthReport as Report } from '../types/api'
import { formatDateTime } from '../utils/format'
import { CountUp } from './CountUp'
import { HealthWhatIf } from './HealthWhatIf'

export const DIMENSION_NAMES: Record<HealthDimensionKey, string> = {
  security: 'Security',
  quality: 'Code quality',
  complexity: 'Complexity',
  maintainability: 'Maintainability',
  dependencies: 'Dependency health',
  architecture: 'Architecture',
}
export const DIMENSION_KEYS = Object.keys(DIMENSION_NAMES) as HealthDimensionKey[]

/** Where each dimension's findings are listed in a repository's workspace. */
const DIMENSION_PAGES: Record<HealthDimensionKey, { path: string; label: string }> = {
  security: { path: 'security', label: 'Security findings' },
  quality: { path: 'code-analysis', label: 'Code-quality issues' },
  complexity: { path: 'complexity', label: 'Complex functions' },
  maintainability: { path: 'complexity', label: 'Maintainability by file' },
  dependencies: { path: 'dependencies', label: 'Dependencies' },
  architecture: { path: 'architecture', label: 'Architecture diagram' },
}

/** Colors by score band (the grade boundaries: 85, 70, 55, 40). */
export function scoreTone(score: number | null): { text: string; bar: string; stroke: string } {
  if (score === null) return { text: 'text-slate-400', bar: 'bg-slate-700', stroke: '#64748b' }
  if (score >= 85) return { text: 'text-emerald-300', bar: 'bg-emerald-400', stroke: '#34d399' }
  if (score >= 70) return { text: 'text-lime-300', bar: 'bg-lime-400', stroke: '#a3e635' }
  if (score >= 55) return { text: 'text-amber-300', bar: 'bg-amber-400', stroke: '#fbbf24' }
  if (score >= 40) return { text: 'text-orange-300', bar: 'bg-orange-400', stroke: '#fb923c' }
  return { text: 'text-red-300', bar: 'bg-red-400', stroke: '#f87171' }
}

const RADIUS = 52
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function ScoreGauge({ score, grade, size = 132 }: { score: number | null; grade: string | null; size?: number }) {
  const tone = scoreTone(score)
  return (
    <svg
      role="img"
      aria-label={score === null ? 'Overall health not scored' : `Overall health ${score} out of 100, grade ${grade}`}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      className="shrink-0"
    >
      <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="rgb(var(--slate-800))" strokeWidth="10" />
      {score !== null && (
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          stroke={tone.stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(CIRCUMFERENCE * score) / 100} ${CIRCUMFERENCE}`}
          transform="rotate(-90 60 60)"
          className="ring-fill"
          style={{ '--ring-c': CIRCUMFERENCE } as CSSProperties}
        />
      )}
      <text x="60" y="58" textAnchor="middle" className="fill-slate-50 font-mono text-[28px] font-semibold">
        <CountUp plain>{score === null ? '—' : String(score)}</CountUp>
      </text>
      <text x="60" y="80" textAnchor="middle" className="fill-slate-400 text-[11px]">
        {grade ? `grade ${grade}` : 'not scored'}
      </text>
    </svg>
  )
}

function label(key: string): string {
  const text = key.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatInput(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return value.toLocaleString('en-US')
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => `${key.replace(/_/g, ' ')} ${formatInput(inner)}`)
      .join(', ')
  }
  return String(value)
}

function DimensionCard({
  dimension,
  share,
  base,
}: {
  dimension: HealthDimension
  /** percent of the overall score, or null when not scored */
  share: number | null
  base: string
}) {
  const tone = scoreTone(dimension.score)
  const inputs = Object.entries(dimension.inputs)
  const page = DIMENSION_PAGES[dimension.key]
  return (
    <article aria-label={dimension.name} className="flex min-w-0 flex-col rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-100">{dimension.name}</h3>
          <p className="text-xs text-slate-400">
            Weight {dimension.weight}
            {share !== null ? ` · ${share}% of this score` : ' · left out of the overall score'}
          </p>
        </div>
        <p className={`text-2xl font-extrabold tabular-nums ${tone.text}`}>
          {dimension.score === null ? <span className="text-sm font-medium">Not scored</span> : <CountUp>{String(dimension.score)}</CountUp>}
        </p>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-slate-800" aria-hidden="true">
        <div className={`bar-grow h-1.5 rounded-full ${tone.bar}`} style={{ width: `${dimension.score ?? 0}%` }} />
      </div>
      <p className="mt-3 text-sm text-slate-300">{dimension.explanation}</p>
      {dimension.improvements.length > 0 && (
        <div className="mt-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">How to improve</h4>
          <ul aria-label={`How to improve ${dimension.name}`} className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-200">
            {dimension.improvements.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      {inputs.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">Inputs</summary>
          <dl aria-label={`${dimension.name} inputs`} className="mt-2 space-y-1">
            {inputs.map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="shrink-0 text-slate-400">{label(key)}</dt>
                <dd className="min-w-0 break-words text-slate-200">{formatInput(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <Link
        to={`${base}/${page.path}`}
        className="mt-auto inline-flex items-center gap-1 pt-3 text-sm text-indigo-300 hover:underline"
      >
        {page.label} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </article>
  )
}

export function HealthReport({ report, projectId, repositoryId }: { report: Report; projectId: string; repositoryId: string }) {
  const base = `/projects/${projectId}/repositories/${repositoryId}`
  const scored = report.dimensions.filter((d) => d.score !== null)
  const unscored = report.dimensions.filter((d) => d.score === null)
  const total = scored.reduce((sum, d) => sum + d.weight, 0)
  const share = (d: HealthDimension) => (d.score === null || total === 0 ? null : Math.round((d.weight * 100) / total))
  return (
    <div className="space-y-4">
      <section aria-label="Overall health" className="flex flex-col gap-5 rounded-2xl border border-slate-800 bg-slate-900 p-6 sm:flex-row sm:items-center">
        <ScoreGauge score={report.overall} grade={report.grade} />
        <div className="min-w-0 space-y-2 text-sm text-slate-300">
          <p>
            {report.overall === null
              ? 'No dimension could be scored for this run, or every scored dimension weighs 0.'
              : `The weighted average of ${scored.length} scored ${scored.length === 1 ? 'dimension' : 'dimensions'}. Grades: A from 85, B from 70, C from 55, D from 40, F below.`}
          </p>
          {unscored.length > 0 && (
            <p className="text-slate-400">
              Not scored, so left out of the average: {unscored.map((d) => d.name).join(', ')}.
            </p>
          )}
          <p className="text-xs text-slate-400">
            Weights used:{' '}
            {report.dimensions.map((d) => `${d.name} ${d.weight}`).join(' · ')}.{' '}
            <Link to="/health-score#weights" className="text-indigo-300 hover:underline">
              Change the weights
            </Link>
          </p>
        </div>
      </section>
      {scored.length > 0 && (
        <HealthWhatIf
          // Saved weights start the sliders; new saved weights start them again.
          key={report.dimensions.map((d) => d.weight).join(',')}
          dimensions={report.dimensions}
          pageFor={(key) => ({ to: `${base}/${DIMENSION_PAGES[key].path}`, label: DIMENSION_PAGES[key].label })}
        />
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {report.dimensions.map((dimension) => (
          <DimensionCard key={dimension.key} dimension={dimension} share={share(dimension)} base={base} />
        ))}
      </div>
    </div>
  )
}

/** The overall score across a repository's scored runs, oldest first. */
export function HealthTrend({ points }: { points: HealthPoint[] }) {
  if (points.length < 2) {
    return (
      <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
        The trend appears once the repository has two scored analyses.
      </p>
    )
  }
  const data = points.map((point) => ({
    // Several runs a day are common, so the label includes the time.
    when: new Date(point.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    overall: point.overall,
  }))
  return (
    <div className="space-y-3">
      <div className="h-56" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -16 }}>
            <CartesianGrid stroke="rgb(var(--slate-800))" vertical={false} />
            <XAxis dataKey="when" stroke="rgb(var(--slate-500))" fontSize={12} />
            <YAxis domain={[0, 100]} stroke="rgb(var(--slate-500))" fontSize={12} />
            <Tooltip contentStyle={{ background: 'rgb(var(--slate-900))', border: '1px solid rgb(var(--slate-700))' }} />
            <Line type="monotone" dataKey="overall" name="Overall" stroke="rgb(var(--indigo-500))" strokeWidth={2} dot isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">Scores by run</summary>
        <div className="mt-2 overflow-x-auto">
          <table aria-label="Health history" className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs text-slate-400">
              <tr>
                <th className="py-1 pr-3 font-medium">Run</th>
                <th className="py-1 pr-3 font-medium">Overall</th>
                {DIMENSION_KEYS.map((key) => (
                  <th key={key} className="py-1 pr-3 font-medium">{DIMENSION_NAMES[key]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((point) => (
                <tr key={point.run_id} className="border-t border-slate-800">
                  <td className="py-1 pr-3 text-slate-300">{formatDateTime(point.created_at)}</td>
                  <td className={`py-1 pr-3 font-semibold tabular-nums ${scoreTone(point.overall).text}`}>
                    {point.overall === null ? '—' : `${point.overall} (${point.grade})`}
                  </td>
                  {DIMENSION_KEYS.map((key) => (
                    <td key={key} className="py-1 pr-3 tabular-nums text-slate-300">{point.scores[key] ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
