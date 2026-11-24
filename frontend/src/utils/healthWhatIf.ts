import type { HealthDimensionKey } from '../types/api'

/** What the overall score is computed from: each dimension's score (null when it does not
 * apply to the run) and its weight. */
export interface WeightedScore {
  key: HealthDimensionKey
  score: number | null
  weight: number
}

/** Python's round(): halves go to the even neighbour (54.5 → 54, 55.5 → 56), as the server
 * rounds the overall score (app/analysis/health.py). */
export function roundHalfEven(value: number): number {
  const floor = Math.floor(value)
  const rest = value - floor
  if (rest > 0.5) return floor + 1
  if (rest < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/** The overall score exactly as the server computes it: the weighted average of the scored
 * dimensions (each 0-100), rounded; null when no scored dimension has weight. */
export function overallScore(dimensions: WeightedScore[]): number | null {
  const scored = dimensions.filter((d) => d.score !== null)
  const total = scored.reduce((sum, d) => sum + d.weight, 0)
  if (total === 0) return null
  const average = scored.reduce((sum, d) => sum + d.weight * (d.score as number), 0) / total
  return roundHalfEven(average)
}

/** The grade for a score (A from 85, B from 70, C from 55, D from 40, F below). */
export function gradeOf(score: number | null): string | null {
  if (score === null) return null
  return score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F'
}

export interface Gain {
  key: HealthDimensionKey
  from: number
  /** the overall score if this dimension reached 100 */
  overall: number
  gain: number
}

/**
 * How much the overall score would rise if each scored dimension reached 100, largest first.
 * Dimensions that cannot raise it (already at 100, weighing 0, or a gain that rounds away) are
 * left out, as are unscored ones.
 */
export function gains(dimensions: WeightedScore[]): Gain[] {
  const now = overallScore(dimensions)
  if (now === null) return []
  return dimensions
    .filter((d) => d.score !== null)
    .map((d) => {
      const overall = overallScore(dimensions.map((other) => (other.key === d.key ? { ...other, score: 100 } : other))) as number
      return { key: d.key, from: d.score as number, overall, gain: overall - now }
    })
    .filter((g) => g.gain > 0)
    .sort((a, b) => b.gain - a.gain || a.from - b.from)
}
