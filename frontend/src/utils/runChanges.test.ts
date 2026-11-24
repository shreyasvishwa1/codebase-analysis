import { describe, expect, it } from 'vitest'

import type { AnalysisJob, AnalysisRun, HealthPoint } from '../types/api'
import { analysisTitle, healthChange, lastRunSeconds, runChanges, summarizeChanges } from './runChanges'

function run(security: { findings: number; critical: number; high: number } | null, issues: number | null): AnalysisRun {
  return {
    security: security && {
      findings: security.findings,
      by_severity: { critical: security.critical, high: security.high, medium: 0, low: 0 },
    },
    quality: issues === null ? null : { issues },
  } as unknown as AnalysisRun
}

function job(overrides: Partial<AnalysisJob>): AnalysisJob {
  return {
    id: 'j',
    project_id: 'p',
    repository_id: 'r',
    job_type: 'full_analysis',
    status: 'completed',
    progress: 100,
    error_message: null,
    created_at: '2026-11-20T10:00:00Z',
    started_at: '2026-11-20T10:00:00Z',
    completed_at: '2026-11-20T10:00:35Z',
    ...overrides,
  }
}

const point = (overall: number | null): HealthPoint =>
  ({ run_id: String(overall), created_at: '2026-11-20T10:00:00Z', overall, grade: null, scores: {} }) as HealthPoint

describe('runChanges', () => {
  it('compares findings, the critical and high ones, and code issues', () => {
    expect(runChanges(run({ findings: 44, critical: 2, high: 9 }, 118), run({ findings: 47, critical: 4, high: 14 }, 120))).toEqual([
      { label: 'Security findings', before: 47, after: 44 },
      { label: 'Critical and high', before: 18, after: 11 },
      { label: 'Code issues', before: 120, after: 118 },
    ])
  })

  it('has nothing to compare without a previous run, and skips what either run lacks', () => {
    expect(runChanges(run({ findings: 1, critical: 0, high: 0 }, 3), undefined)).toEqual([])
    expect(runChanges(run(null, 3), run({ findings: 1, critical: 0, high: 0 }, 5))).toEqual([
      { label: 'Code issues', before: 5, after: 3 },
    ])
    expect(runChanges(run({ findings: 2, critical: 1, high: 0 }, 3), run(null, 5))).toEqual([{ label: 'Code issues', before: 5, after: 3 }])
    expect(runChanges(run({ findings: 2, critical: 1, high: 0 }, 3), run({ findings: 1, critical: 0, high: 0 }, null))).toEqual([
      { label: 'Security findings', before: 1, after: 2 },
      { label: 'Critical and high', before: 0, after: 1 },
    ])
  })
})

describe('healthChange', () => {
  it('compares the last two scored runs', () => {
    expect(healthChange([point(40), point(null), point(54), point(null), point(61)])).toEqual({ label: 'Health score', before: 54, after: 61 })
  })

  it('needs two scored runs', () => {
    expect(healthChange([point(null), point(61)])).toBeNull()
    expect(healthChange([])).toBeNull()
  })
})

describe('summarizeChanges', () => {
  it('lists what moved, then what stayed the same', () => {
    expect(
      summarizeChanges([
        { label: 'Health score', before: 54, after: 58 },
        { label: 'Security findings', before: 1200, after: 1180 },
        { label: 'Code issues', before: 15, after: 15 },
      ]),
    ).toBe('Health score 54 → 58 · Security findings 1,200 → 1,180. Unchanged: code issues 15.')
  })

  it('says when nothing moved', () => {
    expect(
      summarizeChanges([
        { label: 'Health score', before: 54, after: 54 },
        { label: 'Code issues', before: 15, after: 15 },
      ]),
    ).toBe('No change since the previous run: health score 54 · code issues 15.')
    expect(summarizeChanges([{ label: 'Code issues', before: 2, after: 3 }])).toBe('Code issues 2 → 3.')
    expect(summarizeChanges([])).toBe('')
  })
})

describe('lastRunSeconds', () => {
  it('takes the most recently completed full analysis', () => {
    const jobs = [
      job({ id: 'now', status: 'processing', completed_at: null }),
      job({ id: 'old', started_at: '2026-11-19T10:00:00Z', completed_at: '2026-11-19T10:02:00Z' }),
      job({ id: 'last', started_at: '2026-11-20T10:00:00Z', completed_at: '2026-11-20T10:00:34.6Z' }),
      job({ id: 'ingest', job_type: 'ingestion', started_at: '2026-11-21T10:00:00Z', completed_at: '2026-11-21T10:00:02Z' }),
      job({ id: 'bad', status: 'failed', started_at: '2026-11-22T10:00:00Z', completed_at: '2026-11-22T10:00:09Z' }),
    ]
    expect(lastRunSeconds(jobs)).toBe(35)
    expect(lastRunSeconds(jobs.filter((item) => item.id !== 'last'))).toBe(120)
  })

  it('is at least one second, and unknown without a finished run', () => {
    expect(lastRunSeconds([job({ completed_at: '2026-11-20T10:00:00.2Z' })])).toBe(1)
    expect(lastRunSeconds([job({ started_at: null })])).toBeNull()
    expect(lastRunSeconds([])).toBeNull()
  })
})

describe('analysisTitle', () => {
  it('shows the queue or the progress', () => {
    expect(analysisTitle(job({ status: 'pending', progress: 0 }), 'shop-api')).toBe('Queued · shop-api')
    expect(analysisTitle(job({ status: 'processing', progress: 45 }), 'shop-api')).toBe('45% · Analyzing shop-api')
  })
})
