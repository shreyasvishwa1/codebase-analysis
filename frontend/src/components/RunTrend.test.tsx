import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { AnalysisRun } from '../types/api'
import { RunTrend, series, sparkPoints, TREND_RUNS, type TrendMetric } from './RunTrend'

/** Runs newest first, as the API lists them; `findings` null means a run without security. */
const runs = (values: (number | null)[]): AnalysisRun[] =>
  values.map(
    (findings, index) =>
      ({ id: `run-${index}`, security: findings === null ? null : { findings, duplication: 0 } }) as unknown as AnalysisRun,
  )

const FINDINGS: TrendMetric = { label: 'Security findings', value: (run) => run.security?.findings }

describe('series', () => {
  it('runs from the oldest to the selected run, skipping runs without the measure', () => {
    const history = runs([5, 8, null, 9, 12]) // newest first
    expect(series(history, 'run-0', FINDINGS)).toEqual([12, 9, 8, 5])
    expect(series(history, 'run-1', FINDINGS)).toEqual([12, 9, 8]) // an older run: only what came before it
    expect(series(history, 'missing', FINDINGS)).toEqual([])
  })

  it(`covers at most the last ${TREND_RUNS} runs`, () => {
    const history = runs(Array.from({ length: TREND_RUNS + 3 }, (_, i) => i))
    expect(series(history, 'run-0', FINDINGS)).toEqual(Array.from({ length: TREND_RUNS }, (_, i) => TREND_RUNS - 1 - i))
  })
})

describe('sparkPoints', () => {
  it('spreads the runs across the width and the values across the height (higher is up)', () => {
    expect(sparkPoints([10, 20, 15])).toEqual([
      [0, 25],
      [50, 3],
      [100, 14],
    ])
  })

  it('draws a flat line through the middle when nothing changed, and nothing without values', () => {
    expect(sparkPoints([7, 7])).toEqual([
      [0, 14],
      [100, 14],
    ])
    expect(sparkPoints([4])).toEqual([[0, 14]])
    expect(sparkPoints([])).toEqual([])
  })
})

describe('RunTrend', () => {
  function show(history: AnalysisRun[], metrics: TrendMetric[] = [FINDINGS], runId = 'run-0') {
    render(<RunTrend history={history} runId={runId} metrics={metrics} />)
    return screen.getByRole('region', { name: 'Since the previous run' })
  }

  it('shows fewer findings as an improvement, with the values for screen readers', () => {
    const strip = show(runs([44, 47, 50]))
    expect(strip.textContent).toContain('Security findings')
    expect(strip.querySelector('.text-emerald-300')?.textContent).toBe('▼ 3 lower than the previous run')
    expect(strip.querySelector('.text-rose-300')).toBeNull()
    expect(strip.textContent).toContain('Over the last 3 runs: 50, 47, 44.')
    expect(strip.querySelector('polyline')?.getAttribute('points')).toBe('0,3 50,14 100,25') // 47 is halfway between 44 and 50
  })

  it('shows more as a step back', () => {
    const worse = show(runs([1_250, 1_000]))
    expect(worse.querySelector('.text-rose-300')?.textContent).toBe('▲ 250 higher than the previous run')
    expect(worse.textContent).toContain('1,250')
  })

  it('says when nothing changed', () => {
    expect(show(runs([6, 6])).textContent).toContain('6No change from the previous run')
  })

  it('has nothing to compare for the first run, and draws no line', () => {
    const strip = show(runs([9]))
    expect(strip.textContent).toContain('First run with this measure')
    expect(strip.querySelector('svg')).toBeNull()
    expect(strip.textContent).not.toContain('Over the last')
  })

  it('rounds decimals and shows units, and leaves out a measure no run has', () => {
    const history = [
      { id: 'b', quality: { duplication: { percent: 3.04 } } },
      { id: 'a', quality: { duplication: { percent: 3.36 } } },
    ] as unknown as AnalysisRun[]
    const strip = show(
      history,
      [
        { label: 'Duplication', value: (run) => run.quality?.duplication.percent, decimals: 1, unit: '%' },
        { label: 'Never measured', value: () => null },
      ],
      'b',
    )
    expect(strip.textContent).toContain('3.0%')
    expect(strip.textContent).toContain('0.3% lower than the previous run')
    expect(strip.textContent).not.toContain('Never measured')
  })

  it('treats a change that rounds to nothing as no change', () => {
    const history = [
      { id: 'b', complexity: { average_cyclomatic: 2.501 } },
      { id: 'a', complexity: { average_cyclomatic: 2.504 } },
    ] as unknown as AnalysisRun[]
    const strip = show(history, [{ label: 'Average complexity', value: (run) => run.complexity?.average_cyclomatic, decimals: 2 }], 'b')
    expect(strip.textContent).toContain('2.50No change from the previous run')
  })
})
