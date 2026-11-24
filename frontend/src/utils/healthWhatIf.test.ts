import { describe, expect, it } from 'vitest'

import { gains, gradeOf, overallScore, roundHalfEven, type WeightedScore } from './healthWhatIf'

const d = (key: WeightedScore['key'], score: number | null, weight: number): WeightedScore => ({ key, score, weight })

describe('roundHalfEven', () => {
  it('rounds like Python: halves to the even neighbour', () => {
    expect([54.5, 55.5, 0.5, 1.5, 99.5].map(roundHalfEven)).toEqual([54, 56, 0, 2, 100])
    expect([54.49, 54.51, 61, 0].map(roundHalfEven)).toEqual([54, 55, 61, 0])
  })
})

describe('overallScore', () => {
  it('is the weighted average of the scored dimensions', () => {
    // (25 × 2 + 20 × 88 + 15 × 76 + 15 × 47 + 10 × 40) / 85 = 4,055 / 85 = 47.7; dependencies not scored
    expect(overallScore([d('security', 2, 25), d('quality', 88, 20), d('complexity', 76, 15), d('maintainability', 47, 15), d('dependencies', null, 15), d('architecture', 40, 10)])).toBe(48)
  })

  it('rounds halves to even, as the server does', () => {
    expect(overallScore([d('security', 54, 1), d('quality', 55, 1)])).toBe(54)
    expect(overallScore([d('security', 55, 1), d('quality', 56, 1)])).toBe(56)
  })

  it('has no score when nothing scored has weight', () => {
    expect(overallScore([d('security', 80, 0), d('quality', null, 20)])).toBeNull()
    expect(overallScore([])).toBeNull()
  })
})

describe('gradeOf', () => {
  it('uses the grade boundaries', () => {
    expect([85, 84, 70, 69, 55, 54, 40, 39, 0].map(gradeOf)).toEqual(['A', 'B', 'B', 'C', 'C', 'D', 'D', 'F', 'F'])
    expect(gradeOf(null)).toBeNull()
  })
})

describe('gains', () => {
  const dims = [d('security', 2, 25), d('quality', 88, 20), d('complexity', 76, 15), d('dependencies', null, 15), d('architecture', 100, 10), d('maintainability', 40, 0)]

  it('lists what each scored dimension at 100 would do, largest first', () => {
    // now: (50 + 1760 + 1140 + 1000) / 70 = 56.4 → 56; security at 100: 6400 / 70 = 91.4 → 91;
    // complexity: 4310 / 70 = 61.6 → 62; quality: 4190 / 70 = 59.9 → 60
    expect(gains(dims)).toEqual([
      { key: 'security', from: 2, overall: 91, gain: 35 },
      { key: 'complexity', from: 76, overall: 62, gain: 6 },
      { key: 'quality', from: 88, overall: 60, gain: 4 },
    ])
  })

  it('breaks ties by the lower score first, and leaves out gains that round to nothing', () => {
    // Both reach 80 (+20) from 60; quality starts lower, so it comes first.
    expect(gains([d('security', 70, 2), d('quality', 40, 1)]).map((g) => g.key)).toEqual(['quality', 'security'])
    // now 9970 / 102 = 97.7 → 98; security or quality at 100 still give 98, complexity gives 98.7 → 99
    expect(gains([d('security', 30, 1), d('quality', 40, 1), d('complexity', 99, 100)]).map((g) => g.key)).toEqual(['complexity'])
  })

  it('is empty without a score', () => {
    expect(gains([d('security', 10, 0)])).toEqual([])
  })
})
