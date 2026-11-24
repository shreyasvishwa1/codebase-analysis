import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { useSaveHealthWeights } from '../hooks/useHealthScore'
import { getErrorMessage } from '../services/client'
import type { HealthDimension, HealthDimensionKey, HealthWeights } from '../types/api'
import { gains, gradeOf, overallScore } from '../utils/healthWhatIf'
import { ErrorMessage } from './ErrorMessage'
import { useToast } from './Toaster'

/** How many of the largest gains are listed. */
export const TOP_GAINS = 3

function weightsOf(dimensions: HealthDimension[]): Record<HealthDimensionKey, number> {
  return Object.fromEntries(dimensions.map((d) => [d.key, d.weight])) as Record<HealthDimensionKey, number>
}

/**
 * Explores the score without changing anything: which dimension would raise the overall score
 * most if it reached 100, and what the score would be with other weights (sliders, recomputed
 * as they move with the server's formula). The weights can then be saved for every score.
 */
export function HealthWhatIf({
  dimensions,
  pageFor,
}: {
  dimensions: HealthDimension[]
  /** where a dimension's findings are listed */
  pageFor: (key: HealthDimensionKey) => { to: string; label: string }
}) {
  const id = useId()
  const toast = useToast()
  const save = useSaveHealthWeights()
  const saved = weightsOf(dimensions)
  const [weights, setWeights] = useState(saved)

  const now = overallScore(dimensions)
  const tried = overallScore(dimensions.map((d) => ({ ...d, weight: weights[d.key] })))
  const changed = dimensions.some((d) => weights[d.key] !== saved[d.key])
  const total = dimensions.reduce((sum, d) => sum + weights[d.key], 0)
  const top = gains(dimensions).slice(0, TOP_GAINS)
  const name = (key: HealthDimensionKey) => dimensions.find((d) => d.key === key)?.name ?? key

  function onSave() {
    save.mutate(weights as HealthWeights, {
      onSuccess: () => toast({ title: 'Weights saved', description: 'Every health score now uses them.' }),
    })
  }

  return (
    <section aria-label="What if" className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <div>
        <h3 className="font-semibold text-slate-100">What if…</h3>
        <p className="text-xs text-slate-400">
          Worked out in your browser with the server's formula. Nothing changes until you save.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Where the score can rise most</h4>
          {top.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">
              {now === null ? 'Nothing is scored for this run.' : 'No scored dimension can raise the overall score.'}
            </p>
          ) : (
            <ol aria-label="Largest gains" className="mt-2 space-y-2">
              {top.map((gain) => (
                <li key={gain.key} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-sm">
                  <p className="text-slate-200">
                    <span className="font-semibold">{name(gain.key)}</span> {gain.from} → 100 would make the overall{' '}
                    <span className="font-semibold tabular-nums text-slate-50">
                      {gain.overall} ({gradeOf(gain.overall)})
                    </span>{' '}
                    <span className="tabular-nums text-emerald-300">+{gain.gain}</span>
                  </p>
                  <Link to={pageFor(gain.key).to} className="text-xs text-indigo-300 hover:underline">
                    {pageFor(gain.key).label} →
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Try other weights</h4>
          <div className="mt-2 space-y-2">
            {dimensions.map((d) => (
              <div key={d.key} className="grid grid-cols-[8rem_1fr_2.5rem] items-center gap-3 text-sm">
                <label htmlFor={`${id}-${d.key}`} className={d.score === null ? 'text-slate-500' : 'text-slate-300'}>
                  {d.name}
                </label>
                <input
                  id={`${id}-${d.key}`}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={weights[d.key]}
                  onChange={(event) => setWeights({ ...weights, [d.key]: Number(event.target.value) })}
                  aria-describedby={d.score === null ? `${id}-${d.key}-note` : undefined}
                  className="accent-indigo-500"
                />
                <span className="text-right tabular-nums text-slate-300">{weights[d.key]}</span>
                {d.score === null && (
                  <span id={`${id}-${d.key}-note`} className="col-span-3 -mt-1 text-xs text-slate-500">
                    Not scored for this run, so its weight does not change this score.
                  </span>
                )}
              </div>
            ))}
          </div>
          <p role="status" aria-live="polite" className="mt-3 text-sm text-slate-300">
            {tried === null ? (
              'With these weights nothing scored counts, so there is no overall score.'
            ) : (
              <>
                With these weights:{' '}
                <span className="text-lg font-bold tabular-nums text-slate-50">
                  {tried} ({gradeOf(tried)})
                </span>
                {changed && now !== null && tried !== now && (
                  <span className={`ml-2 tabular-nums ${tried > now ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {tried > now ? '+' : ''}
                    {tried - now} from {now}
                  </span>
                )}
              </>
            )}
          </p>
          <ErrorMessage message={save.isError ? getErrorMessage(save.error, 'Could not save the weights') : null} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={!changed || total === 0 || save.isPending}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-slate-50 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save as my weights'}
            </button>
            <button
              type="button"
              onClick={() => setWeights(saved)}
              disabled={!changed}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
