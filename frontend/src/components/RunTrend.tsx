import type { AnalysisRun } from '../types/api'

/** One measure followed across runs; lower is better for every measure shown. */
export interface TrendMetric {
  label: string
  /** the measure for a run; null or undefined when the run lacks it */
  value: (run: AnalysisRun) => number | null | undefined
  decimals?: number
  /** shown after the value, for example "%" */
  unit?: string
}

/** How many runs the trend line covers, ending at the selected run. */
export const TREND_RUNS = 12

const format = (value: number, decimals = 0) =>
  value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

/** The measure's values from the oldest to the selected run (runs without it are skipped). */
export function series(history: AnalysisRun[], runId: string, metric: TrendMetric): number[] {
  const at = history.findIndex((run) => run.id === runId)
  if (at < 0) return []
  return history
    .slice(at, at + TREND_RUNS)
    .map((run) => metric.value(run))
    .filter((value): value is number => typeof value === 'number')
    .reverse()
}

/** Points for an SVG polyline in a 100 × 28 box, with 3 units of room at the top and bottom. */
export function sparkPoints(values: number[]): [number, number][] {
  if (values.length === 0) return []
  const low = Math.min(...values)
  const high = Math.max(...values)
  const step = values.length === 1 ? 0 : 100 / (values.length - 1)
  return values.map((value, index) => {
    const y = high === low ? 14 : 25 - ((value - low) / (high - low)) * 22
    return [Math.round(index * step * 10) / 10, Math.round(y * 10) / 10]
  })
}

function Change({ values, metric }: { values: number[]; metric: TrendMetric }) {
  if (values.length < 2) return <span className="text-slate-500">First run with this measure</span>
  const current = values[values.length - 1]
  const previous = values[values.length - 2]
  const factor = 10 ** (metric.decimals ?? 0)
  const delta = Math.round((current - previous) * factor) / factor
  if (delta === 0) return <span className="text-slate-400">No change from the previous run</span>
  const better = delta < 0
  return (
    <span className={better ? 'text-emerald-300' : 'text-rose-300'}>
      <span aria-hidden="true">{better ? '▼' : '▲'} </span>
      {format(Math.abs(delta), metric.decimals)}
      {metric.unit ?? ''} {better ? 'lower' : 'higher'} than the previous run
    </span>
  )
}

function Sparkline({ values }: { values: number[] }) {
  const points = sparkPoints(values)
  if (points.length < 2) return null
  const [lastX, lastY] = points[points.length - 1]
  return (
    <svg viewBox="-2 0 104 28" preserveAspectRatio="none" className="h-8 w-28 shrink-0 overflow-visible" aria-hidden="true">
      <polyline
        points={points.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        className="spark-draw stroke-indigo-400"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
      />
      <circle cx={lastX} cy={lastY} r="2.5" className="fill-indigo-300" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * The selected run against the one before it, for a few measures: the value, how it changed,
 * and a line over the last runs. A finding count going down is shown as the improvement it is.
 */
export function RunTrend({ history, runId, metrics }: { history: AnalysisRun[]; runId: string; metrics: TrendMetric[] }) {
  return (
    <section aria-label="Since the previous run" className="grid gap-3 sm:grid-cols-2">
      {metrics.map((metric) => {
        const values = series(history, runId, metric)
        if (values.length === 0) return null
        const current = values[values.length - 1]
        return (
          <div key={metric.label} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-400">{metric.label}</p>
              <p className="text-sm">
                <span className="mr-2 font-semibold tabular-nums text-slate-50">
                  {format(current, metric.decimals)}
                  {metric.unit ?? ''}
                </span>
                <span className="text-xs">
                  <Change values={values} metric={metric} />
                </span>
              </p>
              {values.length > 1 && (
                <p className="sr-only">
                  Over the last {values.length} runs: {values.map((value) => format(value, metric.decimals)).join(', ')}.
                </p>
              )}
            </div>
            <Sparkline values={values} />
          </div>
        )
      })}
    </section>
  )
}
