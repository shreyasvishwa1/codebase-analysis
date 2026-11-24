import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BarChart3, ClipboardCheck, Download } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { ErrorMessage } from '../components/ErrorMessage'
import { useToast } from '../components/Toaster'
import { queryKeys } from '../hooks/queryKeys'
import { getErrorMessage } from '../services/client'
import { downloadUsabilityCsv, getMyUsability, getUsabilityResults, saveMyUsability } from '../services/usability'
import type { UsabilityMine, UsabilityResults } from '../types/api'
import { saveFile } from '../utils/download'
import { CountUp } from '../components/CountUp'

export const SCALE = [1, 2, 3, 4, 5] as const
export const SCALE_LABELS: Record<number, string> = {
  1: 'Strongly disagree',
  2: 'Disagree',
  3: 'Neither agree nor disagree',
  4: 'Agree',
  5: 'Strongly agree',
}
export const CSV_FILENAME = 'sus-responses.csv'
const GRADE_GROUPS = ['A', 'B', 'C', 'D', 'F'] as const

const PRIMARY =
  'rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-slate-50 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'
const SECONDARY =
  'inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50'

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  )
}

const formatScore = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1))

function Questionnaire({ mine }: { mine: UsabilityMine }) {
  const client = useQueryClient()
  const toast = useToast()
  const [answers, setAnswers] = useState<(number | null)[]>(
    () => mine.answers ?? mine.statements.map(() => null),
  )
  const save = useMutation({
    mutationFn: saveMyUsability,
    onSuccess: (saved) => {
      client.setQueryData(queryKeys.usabilityMine, saved)
      void client.invalidateQueries({ queryKey: queryKeys.usabilityResults })
      toast({ title: mine.answers ? 'Answers updated' : 'Answers saved', description: `Score ${formatScore(saved.score ?? 0)} of 100` })
    },
  })
  const complete = answers.every((a) => a !== null)
  const changed = mine.answers === null || answers.some((a, i) => a !== mine.answers?.[i])
  const remaining = answers.filter((a) => a === null).length

  function submit(event: FormEvent) {
    event.preventDefault()
    if (complete && changed) save.mutate(answers as number[])
  }

  return (
    <form aria-label="Usability questionnaire" onSubmit={submit} className="space-y-5">
      <p className="text-sm text-slate-400">
        For each statement, pick how much you agree, from 1 (strongly disagree) to 5 (strongly agree). Answer with your first
        impression; there are no right or wrong answers.
      </p>
      <ol className="space-y-4">
        {mine.statements.map((statement, index) => {
          const number = index + 1
          return (
            <li key={number}>
              <fieldset className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <legend className="px-1 text-sm font-medium text-slate-100">
                  {number}. {statement}
                </legend>
                <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label={`Statement ${number}`}>
                  <span className="hidden w-28 text-right text-xs text-slate-500 sm:inline">Strongly disagree</span>
                  {SCALE.map((value) => {
                    const id = `sus-q${number}-${value}`
                    const selected = answers[index] === value
                    return (
                      <label
                        key={value}
                        htmlFor={id}
                        className={`flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border text-sm font-semibold focus-within:ring-2 focus-within:ring-indigo-400 ${
                          selected ? 'border-indigo-400 bg-indigo-600 text-slate-50' : 'border-slate-700 text-slate-300 hover:border-slate-500'
                        }`}
                      >
                        <input
                          id={id}
                          type="radio"
                          name={`sus-q${number}`}
                          value={value}
                          checked={selected}
                          onChange={() => setAnswers((current) => current.map((a, i) => (i === index ? value : a)))}
                          className="sr-only"
                          aria-label={`${value}: ${SCALE_LABELS[value]}`}
                        />
                        {value}
                      </label>
                    )
                  })}
                  <span className="hidden text-xs text-slate-500 sm:inline">Strongly agree</span>
                </div>
              </fieldset>
            </li>
          )
        })}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={PRIMARY} disabled={!complete || !changed || save.isPending}>
          {save.isPending ? 'Saving…' : mine.answers ? 'Update answers' : 'Submit answers'}
        </button>
        <p className="text-sm text-slate-400" role="status">
          {remaining > 0
            ? `${remaining} of ${answers.length} statements still to answer`
            : !changed
              ? 'These are your saved answers. Change any of them to update.'
              : 'All statements answered.'}
        </p>
      </div>
      <ErrorMessage message={save.isError ? getErrorMessage(save.error, 'Could not save your answers') : null} />
    </form>
  )
}

function YourScore({ mine }: { mine: UsabilityMine }) {
  if (mine.score === null) return null
  return (
    <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
      Thank you. Your answers give a score of <strong>{formatScore(mine.score)}</strong> out of 100 (grade {mine.grade}). The
      average across many studies is 68. You can change your answers at any time.
    </p>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-50"><CountUp>{value}</CountUp></p>
      {note ? <p className="mt-0.5 text-xs text-slate-400">{note}</p> : null}
    </div>
  )
}

function ResultsView({ results }: { results: UsabilityResults }) {
  const toast = useToast()
  const download = useMutation({
    mutationFn: async () => saveFile(await downloadUsabilityCsv(), CSV_FILENAME),
    onSuccess: () => toast({ title: 'Answers downloaded', description: CSV_FILENAME }),
  })

  if (results.responses === 0) {
    return <p className="text-sm text-slate-400">No answers yet. The results appear here once someone has answered.</p>
  }
  const value = (n: number | null) => (n === null ? '—' : formatScore(n))
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Responses" value={String(results.responses)} />
        <Stat label="Mean SUS score" value={value(results.mean)} note={results.grade ? `Grade ${results.grade}` : undefined} />
        <Stat label="Median" value={value(results.median)} />
        <Stat
          label="Spread"
          value={results.standard_deviation === null ? '—' : `± ${formatScore(results.standard_deviation)}`}
          note={`Lowest ${value(results.lowest)}, highest ${value(results.highest)}`}
        />
      </div>
      <p className="text-sm text-slate-400">
        Scores run from 0 to 100; {results.average_benchmark} is the average across hundreds of studies. Grades follow Sauro and
        Lewis&apos;s curved scale (A+ from 84.1, C from 65, F below 51.7).
      </p>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-200">Responses by grade</h3>
        <ul className="space-y-1.5" aria-label="Responses by grade">
          {GRADE_GROUPS.map((letter) => {
            const count = results.grades[letter] ?? 0
            return (
              <li key={letter} className="flex items-center gap-3 text-sm">
                <span className="w-6 font-semibold text-slate-200">{letter}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <span className="bar-grow block h-full rounded-full bg-indigo-500" style={{ width: `${(100 * count) / results.responses}%` }} />
                </span>
                <span className="w-8 text-right tabular-nums text-slate-300">{count}</span>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-2 text-left text-sm font-semibold text-slate-200">Average answer per statement (1 to 5)</caption>
          <thead className="text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-2 pr-3">Statement</th>
              <th className="py-2 pr-3 text-right">Average</th>
              <th className="py-2">Better when</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {results.items.map((item) => (
              <tr key={item.number}>
                <td className="py-2 pr-3 text-slate-200">
                  {item.number}. {item.statement}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-100">{item.mean === null ? '—' : item.mean.toFixed(2)}</td>
                <td className="py-2 text-slate-400">{item.positive ? 'higher' : 'lower'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={SECONDARY} onClick={() => download.mutate()} disabled={download.isPending}>
          <Download className="h-4 w-4" aria-hidden="true" />
          Download answers (CSV)
        </button>
        <p className="text-xs text-slate-500">Anonymous: a respondent number, the ten answers, the score and the day. No names or emails.</p>
      </div>
      <ErrorMessage message={download.isError ? getErrorMessage(download.error, 'Could not download the answers') : null} />
    </div>
  )
}

export function UsabilityPage() {
  const mine = useQuery({ queryKey: queryKeys.usabilityMine, queryFn: getMyUsability })
  const results = useQuery({ queryKey: queryKeys.usabilityResults, queryFn: getUsabilityResults })
  return (
    <div className="space-y-6">
      <div className="page-header">
        <p className="page-eyebrow">Usability study</p>
        <h1 className="page-title">Rate this app</h1>
        <p className="page-lede">
          Ten short statements from the System Usability Scale, a standard questionnaire. It takes about two minutes. Answer
          after trying the app: import a repository, run a full analysis and look through the results.
        </p>
      </div>

      <Section title="Questionnaire" icon={<ClipboardCheck className="h-4 w-4" aria-hidden="true" />}>
        {mine.isPending ? <p className="text-sm text-slate-400">Loading the questionnaire…</p> : null}
        <ErrorMessage message={mine.isError ? getErrorMessage(mine.error, 'Could not load the questionnaire') : null} />
        {mine.data ? (
          <>
            <YourScore mine={mine.data} />
            <Questionnaire key={mine.data.updated_at ?? 'new'} mine={mine.data} />
          </>
        ) : null}
      </Section>

      <Section title="Results" icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}>
        {results.isPending ? <p className="text-sm text-slate-400">Loading the results…</p> : null}
        <ErrorMessage message={results.isError ? getErrorMessage(results.error, 'Could not load the results') : null} />
        {results.data ? <ResultsView results={results.data} /> : null}
      </Section>
    </div>
  )
}
