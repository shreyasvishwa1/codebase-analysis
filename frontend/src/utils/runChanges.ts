import type { AnalysisJob, AnalysisRun, HealthPoint } from '../types/api'

/** One measure compared between the previous run and the latest one. */
export interface RunChange {
  label: string
  before: number
  after: number
}

const number = (value: number) => value.toLocaleString('en-US')

/**
 * What changed between two completed runs of the same repository: security findings, the
 * critical and high ones among them, and code-quality issues. A measure is left out when
 * either run lacks it (runs stored before that analysis existed).
 */
export function runChanges(latest: AnalysisRun, previous: AnalysisRun | undefined): RunChange[] {
  if (!previous) return []
  const changes: RunChange[] = []
  if (latest.security && previous.security) {
    changes.push({ label: 'Security findings', before: previous.security.findings, after: latest.security.findings })
    const severe = (run: AnalysisRun) => (run.security?.by_severity.critical ?? 0) + (run.security?.by_severity.high ?? 0)
    changes.push({ label: 'Critical and high', before: severe(previous), after: severe(latest) })
  }
  if (latest.quality && previous.quality) {
    changes.push({ label: 'Code issues', before: previous.quality.issues, after: latest.quality.issues })
  }
  return changes
}

/** The health score change from the history's last two scored points, if there are two. */
export function healthChange(points: HealthPoint[]): RunChange | null {
  const scored = points.filter((point) => point.overall !== null)
  if (scored.length < 2) return null
  const [previous, latest] = scored.slice(-2)
  return { label: 'Health score', before: previous.overall as number, after: latest.overall as number }
}

/**
 * The changes in one sentence: what moved first ("Health score 54 → 58 · Security findings
 * 36 → 33"), then what stayed the same ("Unchanged: code issues 15"). With nothing moved:
 * "No change since the previous run: health score 54 · security findings 36".
 */
export function summarizeChanges(changes: RunChange[]): string {
  const moved = changes.filter((change) => change.before !== change.after)
  const same = changes.filter((change) => change.before === change.after)
  const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1)
  const kept = same.map((change) => `${lower(change.label)} ${number(change.after)}`).join(' · ')
  if (moved.length === 0) return kept ? `No change since the previous run: ${kept}.` : ''
  const parts = moved.map((change) => `${change.label} ${number(change.before)} → ${number(change.after)}`)
  return `${parts.join(' · ')}.${kept ? ` Unchanged: ${kept}.` : ''}`
}

/** How long the repository's last completed full analysis took, in whole seconds. */
export function lastRunSeconds(jobs: AnalysisJob[]): number | null {
  const finished = jobs
    .filter(
      (job) =>
        job.job_type === 'full_analysis' &&
        job.status === 'completed' &&
        job.started_at !== null &&
        job.completed_at !== null,
    )
    .sort((a, b) => (a.completed_at as string).localeCompare(b.completed_at as string))
  const last = finished[finished.length - 1]
  if (!last) return null
  const seconds = (new Date(last.completed_at as string).getTime() - new Date(last.started_at as string).getTime()) / 1000
  return Number.isFinite(seconds) && seconds >= 0 ? Math.max(1, Math.round(seconds)) : null
}

/** The browser tab's title while a full analysis runs: "45% · Analyzing shop-api". */
export function analysisTitle(job: AnalysisJob, repositoryName: string): string {
  return job.status === 'pending' ? `Queued · ${repositoryName}` : `${job.progress}% · Analyzing ${repositoryName}`
}
