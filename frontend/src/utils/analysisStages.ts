import type { AnalysisJob } from '../types/api'

/**
 * A full analysis reports its stage through the job's 0-100 progress: each stage owns a
 * range. Keep in step with the backend (app/analysis/progress.py).
 */
export const PROGRESS = {
  STARTED: 3,
  READING_START: 5,
  READING_END: 60,
  TOOLS: 62,
  DEPENDENCIES: 76,
  SAVING: 92,
} as const

export type StageKey = 'queued' | 'starting' | 'reading' | 'tools' | 'dependencies' | 'saving' | 'done' | 'failed'

/** The stages a run passes through, in order (failed is a state, not a step). */
export const STAGE_STEPS: { key: Exclude<StageKey, 'failed' | 'starting'>; label: string }[] = [
  { key: 'queued', label: 'Queued' },
  { key: 'reading', label: 'Reading every file' },
  { key: 'tools', label: 'Running Ruff, Bandit and the final passes' },
  { key: 'dependencies', label: 'Checking dependencies on OSV.dev' },
  { key: 'saving', label: 'Saving the results' },
  { key: 'done', label: 'Done' },
]

export interface AnalysisStage {
  key: StageKey
  /** for a failed job, the stage it was in when it failed */
  failedAt?: Exclude<StageKey, 'failed' | 'done'>
  /** while reading: the share of files read, 0-100 */
  filesPercent?: number
}

function processingStage(progress: number): AnalysisStage {
  if (progress < PROGRESS.READING_START) return { key: 'starting' }
  if (progress < PROGRESS.TOOLS) {
    const share = (progress - PROGRESS.READING_START) / (PROGRESS.READING_END - PROGRESS.READING_START)
    return { key: 'reading', filesPercent: Math.round(Math.min(1, Math.max(0, share)) * 100) }
  }
  if (progress < PROGRESS.DEPENDENCIES) return { key: 'tools' }
  if (progress < PROGRESS.SAVING) return { key: 'dependencies' }
  return { key: 'saving' }
}

/** The stage a full-analysis job is in, from its status and progress. */
export function analysisStage(job: AnalysisJob): AnalysisStage {
  if (job.status === 'pending') return { key: 'queued' }
  if (job.status === 'completed') return { key: 'done' }
  if (job.status === 'failed') {
    const at = job.progress <= 0 ? 'queued' : processingStage(job.progress).key
    return { key: 'failed', failedAt: at as AnalysisStage['failedAt'] }
  }
  return processingStage(job.progress)
}

/** Position of a stage among the steps (starting counts as reading's predecessor). */
export function stepIndex(key: StageKey): number {
  if (key === 'starting') return 0.5
  return STAGE_STEPS.findIndex((step) => step.key === key)
}
