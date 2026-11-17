import { useId, useState, type FormEvent } from 'react'

import { useHealthWeights, useResetHealthWeights, useSaveHealthWeights } from '../hooks/useHealthScore'
import { getErrorMessage } from '../services/client'
import type { HealthWeights, HealthWeightsResponse } from '../types/api'
import { ErrorMessage } from './ErrorMessage'
import { DIMENSION_KEYS, DIMENSION_NAMES } from './HealthReport'

type Draft = Record<keyof HealthWeights, string>

const toDraft = (weights: HealthWeights): Draft =>
  Object.fromEntries(DIMENSION_KEYS.map((key) => [key, String(weights[key])])) as Draft

const valid = (text: string) => /^\d{1,3}$/.test(text.trim()) && Number(text) <= 100

function WeightsForm({
  saved,
  save,
  reset,
}: {
  saved: HealthWeightsResponse
  save: ReturnType<typeof useSaveHealthWeights>
  reset: ReturnType<typeof useResetHealthWeights>
}) {
  const id = useId()
  const [draft, setDraft] = useState<Draft>(() => toDraft(saved.weights))
  const allValid = DIMENSION_KEYS.every((key) => valid(draft[key]))
  const parsed = Object.fromEntries(DIMENSION_KEYS.map((key) => [key, Number(draft[key])])) as HealthWeights
  const total = allValid ? DIMENSION_KEYS.reduce((sum, key) => sum + parsed[key], 0) : 0
  const problem = !allValid
    ? 'Each weight must be a whole number from 0 to 100.'
    : total === 0
      ? 'At least one weight must be above 0.'
      : null
  const changed = DIMENSION_KEYS.some((key) => draft[key].trim() !== String(saved.weights[key]))
  const busy = save.isPending || reset.isPending

  function submit(event: FormEvent) {
    event.preventDefault()
    if (problem || !changed || busy) return
    reset.reset()
    save.mutate(parsed)
  }

  return (
    <form onSubmit={submit} aria-label="Health score weights" className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DIMENSION_KEYS.map((key) => (
          <div key={key} className="text-sm text-slate-300">
            <label htmlFor={`${id}-${key}`}>{DIMENSION_NAMES[key]}</label>
            <span className="mt-1 flex items-center gap-2">
              <input
                id={`${id}-${key}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                value={draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
                aria-invalid={!valid(draft[key])}
                className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 aria-[invalid=true]:border-red-500/70"
              />
              <span className="text-xs tabular-nums text-slate-400">
                {allValid && total > 0 ? `${Math.round((parsed[key] * 100) / total)}% when all six are scored` : ''}
              </span>
            </span>
          </div>
        ))}
      </div>
      {changed && <ErrorMessage message={problem} />}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!changed || problem !== null || busy}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save weights'}
        </button>
        {changed && (
          <button
            type="button"
            onClick={() => setDraft(toDraft(saved.weights))}
            disabled={busy}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            Undo changes
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            save.reset()
            reset.mutate()
          }}
          disabled={saved.defaults || busy}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {reset.isPending ? 'Resetting…' : 'Reset to defaults'}
        </button>
        <p role="status" className="text-xs text-slate-400">
          {save.isSuccess && !changed
            ? 'Weights saved. Every score now uses them.'
            : reset.isSuccess && saved.defaults
              ? 'Back to the default weights.'
              : saved.defaults
                ? 'Using the default weights.'
                : 'Using your own weights.'}
        </p>
      </div>
      <ErrorMessage message={save.isError ? getErrorMessage(save.error, 'Could not save the weights') : null} />
      <ErrorMessage message={reset.isError ? getErrorMessage(reset.error, 'Could not reset the weights') : null} />
    </form>
  )
}

/** The signed-in user's weights for the overall score, with save and reset. */
export function HealthWeightsEditor() {
  const weights = useHealthWeights()
  const save = useSaveHealthWeights()
  const reset = useResetHealthWeights()
  if (weights.isPending) return <p className="text-sm text-slate-400">Loading weights…</p>
  if (weights.isError) {
    return <ErrorMessage message={getErrorMessage(weights.error, 'Could not load the weights')} />
  }
  // A new key after a save or reset starts the form from the stored weights.
  return <WeightsForm key={JSON.stringify(weights.data)} saved={weights.data} save={save} reset={reset} />
}
