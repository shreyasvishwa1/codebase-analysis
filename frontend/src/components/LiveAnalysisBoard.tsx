import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { AnalysisJob } from '../types/api'
import { analysisStage, STAGE_STEPS, stepIndex, type AnalysisStage, type StageKey } from '../utils/analysisStages'
import { HEALTH, INPUTS, OUTPUTS, VIAS, type ChipSpec } from './circuitLayout'

export type ChipState = 'idle' | 'active' | 'waiting' | 'done' | 'failed'

const BEFORE = new Set<StageKey>(['queued', 'starting'])

/** What each chip on the board is doing at a stage. Every analyzer reads the files in the
 * same pass, so all five module chips work together while files are read. */
export function chipStates(stage: AnalysisStage): Record<string, ChipState> {
  const at = stage.key === 'failed' ? stage.failedAt ?? 'queued' : stage.key
  const states: Record<string, ChipState> = {}
  for (const chip of INPUTS) {
    let state: ChipState
    if (BEFORE.has(at)) state = 'idle'
    else if (chip.ref === 'U4') {
      // Dependencies: declarations are collected while reading; the lookups come later.
      state = at === 'reading' || at === 'dependencies' ? 'active' : at === 'tools' ? 'waiting' : 'done'
    } else state = at === 'reading' || at === 'tools' ? 'active' : 'done'
    states[chip.ref] = state
  }
  states[HEALTH.ref] = at === 'saving' ? 'active' : at === 'done' ? 'done' : 'idle'
  for (const chip of OUTPUTS) states[chip.ref] = at === 'done' ? 'done' : 'idle'
  if (stage.key === 'failed') {
    for (const ref of Object.keys(states)) if (states[ref] === 'active') states[ref] = 'failed'
  }
  return states
}

/** The text on the health chip. */
export function centerText(stage: AnalysisStage): [string, string] {
  switch (stage.key) {
    case 'queued':
      return ['QUEUED', 'WAITING FOR A WORKER']
    case 'starting':
      return ['STARTING', 'LISTING FILES']
    case 'reading':
      return [`${stage.filesPercent ?? 0}%`, 'OF FILES READ']
    case 'tools':
      return ['TOOLS', 'RUFF · BANDIT']
    case 'dependencies':
      return ['OSV.dev', 'ADVISORIES']
    case 'saving':
      return ['SAVING', 'RESULTS']
    case 'done':
      return ['DONE', 'HEALTH SCORED']
    case 'failed':
      return ['FAILED', 'SEE THE MESSAGE']
  }
}

const CHIP_STYLE: Record<ChipState, { box: string; text: string; pin: string }> = {
  idle: { box: 'fill-slate-950 stroke-slate-700', text: 'fill-slate-500', pin: 'stroke-slate-700' },
  active: { box: 'fill-slate-950 stroke-indigo-400 live-chip', text: 'fill-indigo-200', pin: 'stroke-indigo-400' },
  waiting: { box: 'fill-slate-950 stroke-indigo-500/60 [stroke-dasharray:4_3]', text: 'fill-slate-300', pin: 'stroke-indigo-600' },
  done: { box: 'fill-indigo-500/10 stroke-indigo-500', text: 'fill-slate-100', pin: 'stroke-indigo-500' },
  failed: { box: 'fill-red-500/10 stroke-red-400', text: 'fill-red-300', pin: 'stroke-red-400' },
}

function Chip({ chip, state }: { chip: ChipSpec; state: ChipState }) {
  const style = CHIP_STYLE[state]
  const { x, y, width, height } = chip
  return (
    <g data-chip={chip.ref} data-state={state}>
      {[0.25, 0.5, 0.75].map((at) => (
        <g key={at} className={style.pin} strokeWidth="2">
          <line x1={x + width * at} y1={y - 5} x2={x + width * at} y2={y} />
          <line x1={x + width * at} y1={y + height} x2={x + width * at} y2={y + height + 5} />
        </g>
      ))}
      <rect x={x} y={y} width={width} height={height} rx="3" className={`${style.box} transition-colors duration-500`} strokeWidth="1.5" />
      <text x={x + 10} y={y + 21} className={`${style.text} font-mono text-[10.5px] font-medium tracking-[0.08em] transition-colors duration-500`}>
        {chip.label}
      </text>
      {state === 'done' && (
        <path d={`M${x + width - 16} ${y + 9} l3 3 l6 -6`} fill="none" className="stroke-indigo-400" strokeWidth="1.6" strokeLinecap="round" />
      )}
    </g>
  )
}

function Trace({ d, state }: { d: string; state: ChipState }) {
  const base = state === 'done' ? 'stroke-indigo-500' : state === 'failed' ? 'stroke-red-400/70' : 'stroke-slate-700'
  return (
    <g>
      <path d={d} fill="none" className={`${base} transition-colors duration-500`} strokeWidth="2.5" strokeLinejoin="round" />
      {state === 'active' && (
        <path d={d} fill="none" className="animate-current stroke-indigo-300" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="6 42" />
      )}
    </g>
  )
}

/** Seconds since a time, ticking once a second while `running`. */
function useElapsed(since: string | null, running: boolean): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  if (!since) return null
  return Math.max(0, Math.round((now - new Date(since).getTime()) / 1000))
}

export function formatElapsed(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

/**
 * A full analysis as it runs, drawn as the board: the module chips light up while the files
 * are read, the dependencies chip during the OSV.dev lookups, the health chip while the
 * results are saved, and the outputs once it is done. Driven by the job's real progress.
 */
export function LiveAnalysisBoard({ job, onHide }: { job: AnalysisJob; onHide?: () => void }) {
  const stage = analysisStage(job)
  const states = chipStates(stage)
  const [title, subtitle] = centerText(stage)
  const running = job.status === 'pending' || job.status === 'processing'
  const elapsed = useElapsed(job.started_at, running)
  const current = stepIndex(stage.key === 'failed' ? stage.failedAt ?? 'queued' : stage.key)
  const healthState = states[HEALTH.ref]

  return (
    <section aria-label="Live analysis" className="pcb-card animate-pop-in space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`led ${running ? 'animate-pulse text-amber-300' : stage.key === 'failed' ? 'text-red-400' : 'text-emerald-400'}`} aria-hidden="true" />
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Live analysis</h3>
        <span className="font-mono text-[11px] text-slate-500">
          {job.progress}% overall{elapsed !== null && ` · ${formatElapsed(elapsed)}`}
        </span>
        {!running && onHide && (
          <button
            type="button"
            onClick={onHide}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Hide
          </button>
        )}
      </div>

      <svg viewBox="0 0 520 345" className="mx-auto h-auto w-full max-w-xl" aria-hidden="true">
        {INPUTS.map((chip) => (
          <Trace key={`t-${chip.ref}`} d={chip.trace!} state={states[chip.ref]} />
        ))}
        {OUTPUTS.map((chip) => (
          <Trace key={`t-${chip.ref}`} d={chip.trace!} state={states[chip.ref]} />
        ))}
        {VIAS.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.5" className="fill-slate-900 stroke-slate-600" strokeWidth="1.5" />
        ))}
        {[...INPUTS, ...OUTPUTS].map((chip) => (
          <Chip key={chip.ref} chip={chip} state={states[chip.ref]} />
        ))}
        <g data-chip={HEALTH.ref} data-state={healthState}>
          {[250, 270, 290, 310].map((px) => (
            <g key={px} className={CHIP_STYLE[healthState].pin} strokeWidth="2">
              <line x1={px} y1="124" x2={px} y2="130" />
              <line x1={px} y1="230" x2={px} y2="236" />
            </g>
          ))}
          <rect
            x={HEALTH.x}
            y={HEALTH.y}
            width={HEALTH.width}
            height={HEALTH.height}
            rx="5"
            className={`${stage.key === 'failed' ? CHIP_STYLE.failed.box : healthState === 'idle' ? 'fill-slate-950 stroke-indigo-500/70' : CHIP_STYLE[healthState].box} transition-colors duration-500`}
            strokeWidth="1.75"
          />
          <text x="285" y="182" textAnchor="middle" className={`font-mono text-[17px] font-semibold ${stage.key === 'failed' ? 'fill-red-300' : 'fill-indigo-300'}`}>
            {title}
          </text>
          <text x="285" y="200" textAnchor="middle" className="fill-slate-400 font-mono text-[8px] tracking-[0.1em]">
            {subtitle}
          </text>
        </g>
      </svg>

      <ol aria-label="Analysis stages" className="grid gap-2 sm:grid-cols-3">
        {STAGE_STEPS.map((step, index) => {
          const failedHere = stage.key === 'failed' && index === Math.ceil(current)
          const done = stage.key === 'done' || index < current
          const now = !failedHere && !done && index === Math.ceil(current) && running
          return (
            <li
              key={step.key}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors duration-500 ${
                failedHere
                  ? 'border-red-500/50 text-red-300'
                  : done
                    ? 'border-indigo-500/40 text-slate-200'
                    : now
                      ? 'border-indigo-400 bg-indigo-500/10 text-slate-50'
                      : 'border-slate-800 text-slate-500'
              }`}
            >
              {failedHere ? (
                <X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : done ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-indigo-400" aria-hidden="true" />
              ) : (
                <span aria-hidden="true" className={`led shrink-0 ${now ? 'animate-pulse text-amber-300' : 'text-slate-700'}`} />
              )}
              <span>
                {step.label}
                {step.key === 'reading' && now && stage.filesPercent !== undefined && ` (${stage.filesPercent}%)`}
              </span>
              <span className="sr-only">{failedHere ? ' (failed)' : done ? ' (done)' : now ? ' (now)' : ' (to come)'}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
