import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ROUTER_FUTURE } from '../routerFuture'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mockApi, PROJECT, ZIP_REPOSITORY, type MockResponse } from '../test/mockApi'
import { createTestQueryClient } from '../test/render'
import type { AnalysisJob, AnalysisRun, Repository } from '../types/api'
import { analysisStage, PROGRESS, stepIndex } from '../utils/analysisStages'
import { AnalysisRunsPanel } from './AnalysisRunsPanel'
import { GO_KEYS, GO_WINDOW_MS, ShortcutsDialog, useGlobalShortcuts } from './KeyboardShortcuts'
import { centerText, chipStates, formatElapsed, LiveAnalysisBoard } from './LiveAnalysisBoard'
import { MAX_TOASTS, TOAST_MS, ToastProvider, useToast, type ToastInput } from './Toaster'

const P = PROJECT.id
const R = ZIP_REPOSITORY.id
const RUNS_URL = `/projects/${P}/repositories/${R}/analysis-runs`

const job = (status: AnalysisJob['status'], progress = 0, extra: Partial<AnalysisJob> = {}): AnalysisJob => ({
  id: 'job-1',
  project_id: P,
  repository_id: R,
  job_type: 'full_analysis',
  status,
  progress,
  error_message: null,
  created_at: '2026-11-17T10:00:00Z',
  started_at: null,
  completed_at: null,
  ...extra,
})

afterEach(() => {
  vi.useRealTimers()
})

// --- Stages ----------------------------------------------------------------------------------

describe('analysis stages', () => {
  it('names the stage from the job status and progress', () => {
    expect(analysisStage(job('pending'))).toEqual({ key: 'queued' })
    expect(analysisStage(job('processing', 0))).toEqual({ key: 'starting' })
    expect(analysisStage(job('processing', PROGRESS.STARTED))).toEqual({ key: 'starting' })
    expect(analysisStage(job('processing', PROGRESS.READING_START))).toEqual({ key: 'reading', filesPercent: 0 })
    expect(analysisStage(job('processing', 32))).toEqual({ key: 'reading', filesPercent: 49 })
    expect(analysisStage(job('processing', PROGRESS.READING_END))).toEqual({ key: 'reading', filesPercent: 100 })
    expect(analysisStage(job('processing', 61))).toEqual({ key: 'reading', filesPercent: 100 })
    expect(analysisStage(job('processing', PROGRESS.TOOLS))).toEqual({ key: 'tools' })
    expect(analysisStage(job('processing', PROGRESS.DEPENDENCIES - 1))).toEqual({ key: 'tools' })
    expect(analysisStage(job('processing', PROGRESS.DEPENDENCIES))).toEqual({ key: 'dependencies' })
    expect(analysisStage(job('processing', PROGRESS.SAVING - 1))).toEqual({ key: 'dependencies' })
    expect(analysisStage(job('processing', PROGRESS.SAVING))).toEqual({ key: 'saving' })
    expect(analysisStage(job('completed', 100))).toEqual({ key: 'done' })
  })

  it('remembers where a failed job stopped', () => {
    expect(analysisStage(job('failed', 0))).toEqual({ key: 'failed', failedAt: 'queued' })
    expect(analysisStage(job('failed', 3))).toEqual({ key: 'failed', failedAt: 'starting' })
    expect(analysisStage(job('failed', 40))).toEqual({ key: 'failed', failedAt: 'reading' })
    expect(analysisStage(job('failed', 80))).toEqual({ key: 'failed', failedAt: 'dependencies' })
  })

  it('orders the steps', () => {
    expect(['queued', 'starting', 'reading', 'tools', 'dependencies', 'saving', 'done'].map((key) => stepIndex(key as never))).toEqual([
      0, 0.5, 1, 2, 3, 4, 5,
    ])
  })
})

describe('live board chips', () => {
  const states = (progress: number, status: AnalysisJob['status'] = 'processing') => chipStates(analysisStage(job(status, progress)))

  it('lights every module chip while the files are read', () => {
    expect(states(0, 'pending')).toEqual({ U1: 'idle', U2: 'idle', U3: 'idle', U4: 'idle', U5: 'idle', U0: 'idle', J1: 'idle', J2: 'idle' })
    expect(states(30)).toEqual({ U1: 'active', U2: 'active', U3: 'active', U4: 'active', U5: 'active', U0: 'idle', J1: 'idle', J2: 'idle' })
  })

  it('runs the tools while the dependency lookups wait, then the lookups', () => {
    expect(states(PROGRESS.TOOLS)).toMatchObject({ U1: 'active', U2: 'active', U3: 'active', U4: 'waiting', U5: 'active' })
    expect(states(PROGRESS.DEPENDENCIES)).toMatchObject({ U1: 'done', U2: 'done', U3: 'done', U4: 'active', U5: 'done', U0: 'idle' })
  })

  it('saves on the health chip and lights the outputs when done', () => {
    expect(states(PROGRESS.SAVING)).toMatchObject({ U4: 'done', U0: 'active', J1: 'idle', J2: 'idle' })
    expect(states(100, 'completed')).toEqual({ U1: 'done', U2: 'done', U3: 'done', U4: 'done', U5: 'done', U0: 'done', J1: 'done', J2: 'done' })
  })

  it('turns the chips that were working red when the job fails', () => {
    expect(states(PROGRESS.DEPENDENCIES, 'failed')).toMatchObject({ U1: 'done', U4: 'failed', U0: 'idle' })
    expect(states(PROGRESS.SAVING, 'failed')).toMatchObject({ U0: 'failed' })
  })

  it('prints the stage on the health chip', () => {
    expect(centerText(analysisStage(job('pending')))).toEqual(['QUEUED', 'WAITING FOR A WORKER'])
    expect(centerText(analysisStage(job('processing', 1)))).toEqual(['STARTING', 'LISTING FILES'])
    expect(centerText(analysisStage(job('processing', 32)))).toEqual(['49%', 'OF FILES READ'])
    expect(centerText(analysisStage(job('processing', PROGRESS.TOOLS)))).toEqual(['TOOLS', 'RUFF · BANDIT'])
    expect(centerText(analysisStage(job('processing', PROGRESS.DEPENDENCIES)))).toEqual(['OSV.dev', 'ADVISORIES'])
    expect(centerText(analysisStage(job('processing', PROGRESS.SAVING)))).toEqual(['SAVING', 'RESULTS'])
    expect(centerText(analysisStage(job('completed', 100)))).toEqual(['DONE', 'HEALTH SCORED'])
    expect(centerText(analysisStage(job('failed', 40)))).toEqual(['FAILED', 'SEE THE MESSAGE'])
  })

  it('formats the elapsed time', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(59)).toBe('59s')
    expect(formatElapsed(60)).toBe('1m 00s')
    expect(formatElapsed(125)).toBe('2m 05s')
  })
})

describe('LiveAnalysisBoard', () => {
  const steps = () =>
    within(screen.getByRole('list', { name: 'Analysis stages' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent)

  it('marks the steps done, now and to come, and draws the chips', () => {
    render(<LiveAnalysisBoard job={job('processing', 32, { started_at: new Date(Date.now() - 65_000).toISOString() })} onHide={() => {}} />)
    expect(steps()).toEqual([
      'Queued (done)',
      'Reading every file (49%) (now)',
      'Running Ruff, Bandit and the final passes (to come)',
      'Checking dependencies on OSV.dev (to come)',
      'Saving the results (to come)',
      'Done (to come)',
    ])
    expect(screen.getByText(/32% overall · 1m 0[5-6]s/)).toBeTruthy()
    expect(document.querySelector('[data-chip="U2"]')?.getAttribute('data-state')).toBe('active')
    expect(document.querySelector('[data-chip="U0"]')?.getAttribute('data-state')).toBe('idle')
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull() // only once finished
  })

  it('ticks the elapsed time while running', () => {
    vi.useFakeTimers({ now: new Date('2026-11-18T10:00:10Z') })
    render(<LiveAnalysisBoard job={job('processing', 10, { started_at: '2026-11-18T10:00:00Z' })} />)
    expect(screen.getByText('10% overall · 10s')).toBeTruthy()
    act(() => vi.advanceTimersByTime(3000))
    expect(screen.getByText('10% overall · 13s')).toBeTruthy()
  })

  it('shows a finished run with every step done and a Hide button', () => {
    const onHide = vi.fn()
    render(<LiveAnalysisBoard job={job('completed', 100)} onHide={onHide} />)
    expect(steps().every((text) => text?.endsWith('(done)'))).toBe(true)
    expect(screen.getByText('100% overall')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(onHide).toHaveBeenCalledOnce()
  })

  it('shows where a failed run stopped', () => {
    render(<LiveAnalysisBoard job={job('failed', PROGRESS.DEPENDENCIES)} />)
    expect(steps()).toEqual([
      'Queued (done)',
      'Reading every file (done)',
      'Running Ruff, Bandit and the final passes (done)',
      'Checking dependencies on OSV.dev (failed)',
      'Saving the results (to come)',
      'Done (to come)',
    ])
    expect(document.querySelector('[data-chip="U4"]')?.getAttribute('data-state')).toBe('failed')
  })
})

// --- Toasts ----------------------------------------------------------------------------------

function Trigger({ input }: { input: ToastInput }) {
  const toast = useToast()
  return (
    <button type="button" onClick={() => toast(input)}>
      Notify
    </button>
  )
}

function renderToasts(input: ToastInput) {
  return render(
    <MemoryRouter future={ROUTER_FUTURE}>
      <ToastProvider>
        <Trigger input={input} />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

function Where() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

const toasts = () => within(screen.getByRole('region', { name: 'Notifications' })).queryAllByRole('listitem')

describe('toasts', () => {
  it('shows a toast and removes it after its time', () => {
    vi.useFakeTimers()
    renderToasts({ title: 'Report ready', description: 'repo-report.pdf' })
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }))
    expect(toasts()).toHaveLength(1)
    expect(toasts()[0].textContent).toContain('Report ready')
    expect(toasts()[0].textContent).toContain('repo-report.pdf')
    expect(toasts()[0].getAttribute('data-tone')).toBe('success')
    act(() => vi.advanceTimersByTime(TOAST_MS.success - 10))
    expect(toasts()).toHaveLength(1)
    act(() => vi.advanceTimersByTime(20))
    expect(toasts()).toHaveLength(0)
  })

  it('keeps errors longer and pauses while hovered', () => {
    vi.useFakeTimers()
    renderToasts({ title: 'Analysis failed', tone: 'error' })
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }))
    const [item] = toasts()
    expect(item.getAttribute('data-tone')).toBe('error')
    act(() => vi.advanceTimersByTime(TOAST_MS.success + 100))
    expect(toasts()).toHaveLength(1)
    fireEvent.mouseEnter(item)
    act(() => vi.advanceTimersByTime(TOAST_MS.error * 2))
    expect(toasts()).toHaveLength(1) // paused
    fireEvent.mouseLeave(item)
    act(() => vi.advanceTimersByTime(TOAST_MS.error - TOAST_MS.success - 200))
    expect(toasts()).toHaveLength(1) // the remaining time continues, not a fresh start
    act(() => vi.advanceTimersByTime(200))
    expect(toasts()).toHaveLength(0)
  })

  it('pauses while focused, and closes from its button', () => {
    vi.useFakeTimers()
    renderToasts({ title: 'Saved', tone: 'info' })
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }))
    const close = screen.getByRole('button', { name: 'Dismiss: Saved' })
    fireEvent.focus(close)
    act(() => vi.advanceTimersByTime(TOAST_MS.info * 2))
    expect(toasts()).toHaveLength(1)
    fireEvent.blur(close)
    fireEvent.click(close)
    expect(toasts()).toHaveLength(0)
  })

  it(`keeps at most ${MAX_TOASTS}, dropping the oldest`, () => {
    let n = 0
    function Many() {
      const toast = useToast()
      return (
        <button type="button" onClick={() => toast({ title: `Toast ${++n}` })}>
          Many
        </button>
      )
    }
    render(
      <MemoryRouter future={ROUTER_FUTURE}>
        <ToastProvider>
          <Many />
        </ToastProvider>
      </MemoryRouter>,
    )
    for (let i = 0; i < MAX_TOASTS + 2; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Many' }))
    expect(toasts().map((item) => item.querySelector('p')?.textContent)).toEqual(['Toast 3', 'Toast 4', 'Toast 5', 'Toast 6'])
  })

  it('follows its link and closes', () => {
    renderToasts({ title: 'Analysis complete', action: { label: 'See the health score', to: '/health-score' } })
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }))
    fireEvent.click(screen.getByRole('link', { name: 'See the health score →' }))
    expect(screen.getByTestId('location').textContent).toBe('/health-score')
    expect(toasts()).toHaveLength(0)
  })

  it('does nothing without a provider', () => {
    render(<Trigger input={{ title: 'Lost' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }))
    expect(screen.queryByText('Lost')).toBeNull()
  })
})

// --- The runs panel: live board and completion toast ------------------------------------------

const READY: Repository = { ...ZIP_REPOSITORY, status: 'ready' }
const run: AnalysisRun = {
  id: 'run-1',
  analysis_job_id: 'job-1',
  repository_id: R,
  project_id: P,
  file_count: 1,
  analyzed_file_count: 1,
  excluded_file_count: 0,
  total_bytes: 10,
  total_lines: 1,
  code_lines: 1,
  languages: [],
  skipped: { binary: 0, too_large: 0, unavailable: 0, generated: 0 },
  quality: null,
  security: null,
  complexity: null,
  dependencies: null,
  architecture: null,
  chat_index: null,
  created_at: '2026-11-17T10:00:00Z',
}

function panel() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter future={ROUTER_FUTURE}>
        <ToastProvider>
          <AnalysisRunsPanel projectId={P} repositoryId={R} repository={READY} pollIntervalMs={20} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('full analysis panel, live', () => {
  function serve(final: AnalysisJob) {
    const sequence = [job('processing', 3), job('processing', 30), job('processing', PROGRESS.DEPENDENCIES)]
    let state: { job: AnalysisJob | null; runs: AnalysisRun[] } = { job: null, runs: [] }
    let polls = 0
    mockApi({
      [`GET ${RUNS_URL}`]: () => {
        if (state.job && state.job.status === 'processing') {
          polls += 1
          state = polls < sequence.length ? { job: sequence[polls], runs: [] } : { job: final, runs: final.status === 'completed' ? [run] : [] }
        }
        return { status: 200, data: state } as MockResponse
      },
      [`POST ${RUNS_URL}`]: () => {
        state = { job: sequence[0], runs: [] }
        polls = 0
        return { status: 202, data: { job_id: 'job-1', repository_id: R, status: 'pending' } }
      },
    })
  }

  it('shows the live board through the run, then a completion toast and a Hide button', async () => {
    serve(job('completed', 100))
    panel()
    fireEvent.click(await screen.findByRole('button', { name: 'Run full analysis' }))
    expect(await screen.findByRole('region', { name: 'Live analysis' })).toBeTruthy()
    const toast = await within(screen.getByRole('region', { name: 'Notifications' })).findByText('Analysis complete')
    expect(toast.closest('li')?.textContent).toContain(`${READY.name} was analyzed`)
    expect(screen.getByRole('link', { name: 'See the health score →' }).getAttribute('href')).toBe(`/projects/${P}/repositories/${R}/health`)
    // The finished board stays until it is hidden.
    expect(screen.getByText('100% overall')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(screen.queryByRole('region', { name: 'Live analysis' })).toBeNull()
  })

  it('says when the run failed', async () => {
    serve(job('failed', PROGRESS.DEPENDENCIES, { error_message: 'Repository changed during analysis; run it again' }))
    panel()
    fireEvent.click(await screen.findByRole('button', { name: 'Run full analysis' }))
    const toast = await within(screen.getByRole('region', { name: 'Notifications' })).findByText('Analysis failed')
    expect(toast.closest('li')?.getAttribute('data-tone')).toBe('error')
    expect(toast.closest('li')?.textContent).toContain('Repository changed during analysis')
    expect(screen.getByRole('region', { name: 'Live analysis' }).textContent).toContain('(failed)')
  })

  it('shows no board for an old, finished run', async () => {
    mockApi({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: job('completed', 100), runs: [run] } } })
    panel()
    await screen.findByRole('region', { name: 'Run summary' })
    expect(screen.queryByRole('region', { name: 'Live analysis' })).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Notifications' })).queryAllByRole('listitem')).toHaveLength(0)
  })
})

describe('full analysis panel, what changed', () => {
  const JOBS_URL = `/projects/${P}/repositories/${R}/jobs`
  const HEALTH_URL = `/projects/${P}/repositories/${R}/health-history`
  const summaryRun = (id: string, findings: number, critical: number, issues: number): AnalysisRun => ({
    ...run,
    id,
    security: { findings, by_severity: { critical, high: 1, medium: 0, low: 0 } } as unknown as AnalysisRun['security'],
    quality: { issues } as unknown as AnalysisRun['quality'],
  })
  const previous = summaryRun('run-0', 5, 2, 7)
  const latest = summaryRun('run-1', 3, 2, 7)
  const previousJob = job('completed', 100, {
    id: 'job-0',
    started_at: '2026-11-16T10:00:00Z',
    completed_at: '2026-11-16T10:00:35Z',
  })

  function serve(health: MockResponse) {
    let state: { job: AnalysisJob | null; runs: AnalysisRun[] } = { job: previousJob, runs: [previous] }
    let polls = 0
    const requests = mockApi({
      [`GET ${RUNS_URL}`]: () => {
        if (state.job?.status === 'processing') {
          polls += 1
          if (polls >= 3) state = { job: job('completed', 100), runs: [latest, previous] }
        }
        return { status: 200, data: state } as MockResponse
      },
      [`POST ${RUNS_URL}`]: () => {
        state = { job: job('processing', 30, { started_at: '2026-11-17T10:00:00Z' }), runs: [previous] }
        return { status: 202, data: { job_id: 'job-1', repository_id: R, status: 'pending' } }
      },
      [`GET ${JOBS_URL}`]: { status: 200, data: [job('processing', 30), previousJob] },
      [`GET ${HEALTH_URL}`]: health,
    })
    return requests
  }

  afterEach(() => {
    document.title = 'CodeBase Analysis'
  })

  it('says what changed since the previous run, how long that run took, and shows progress in the tab title', async () => {
    serve({
      status: 200,
      data: { points: [{ run_id: 'run-0', created_at: '', overall: 50, grade: 'D', scores: {} }, { run_id: 'run-1', created_at: '', overall: 61, grade: 'C', scores: {} }] },
    })
    panel()
    fireEvent.click(await screen.findByRole('button', { name: 'Run full analysis' }))
    const board = await screen.findByRole('region', { name: 'Live analysis' })
    await waitFor(() => expect(board.textContent).toContain('last run took 35s'))
    expect(document.title).toBe(`30% · Analyzing ${READY.name} — CodeBase Analysis`)
    const toast = await within(screen.getByRole('region', { name: 'Notifications' })).findByText('Analysis complete')
    expect(toast.closest('li')?.textContent).toContain(
      `${READY.name} was analyzed. Health score 50 → 61 · Security findings 5 → 3. Unchanged: critical and high 3 · code issues 7.`,
    )
    expect(document.title).toBe('CodeBase Analysis')
    expect(board.textContent).not.toContain('last run took') // only while running
  })

  it('leaves the health score out when it cannot be read', async () => {
    serve({ status: 500, data: { detail: 'down' } })
    panel()
    fireEvent.click(await screen.findByRole('button', { name: 'Run full analysis' }))
    const toast = await within(screen.getByRole('region', { name: 'Notifications' })).findByText('Analysis complete')
    expect(toast.closest('li')?.textContent).toContain(`${READY.name} was analyzed. Security findings 5 → 3. Unchanged:`)
    expect(toast.closest('li')?.textContent).not.toContain('Health score')
  })

  it('keeps "Analysis done" in a hidden tab until it is seen', async () => {
    serve({ status: 500, data: { detail: 'down' } })
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    try {
      panel()
      fireEvent.click(await screen.findByRole('button', { name: 'Run full analysis' }))
      await within(screen.getByRole('region', { name: 'Notifications' })).findByText('Analysis complete')
      expect(document.title).toBe('Analysis done — CodeBase Analysis')
      act(() => {
        document.dispatchEvent(new Event('visibilitychange')) // still hidden
      })
      expect(document.title).toBe('Analysis done — CodeBase Analysis')
      hidden.mockReturnValue(false)
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(document.title).toBe('CodeBase Analysis')
    } finally {
      hidden.mockRestore()
    }
  })
})

// --- Shortcuts -------------------------------------------------------------------------------

function ShortcutHost({ initial = '/overview' }: { initial?: string }) {
  return (
    <MemoryRouter future={ROUTER_FUTURE} initialEntries={[initial]}>
      <Keys />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>
  )
}

const calls = { search: 0, theme: 0 }
function Keys() {
  const [help, setHelp] = useState(false)
  useGlobalShortcuts({
    onSearch: () => (calls.search += 1),
    onToggleTheme: () => (calls.theme += 1),
    onToggleHelp: () => setHelp((open) => !open),
    disabled: help,
  })
  return (
    <>
      <input aria-label="Field" />
      <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
    </>
  )
}

const press = (key: string, init: KeyboardEventInit = {}, target: Window | Element = window) =>
  fireEvent.keyDown(target, { key, ...init })

describe('keyboard shortcuts', () => {
  it('opens and closes the list with ?, Esc and the close button', () => {
    render(<ShortcutHost />)
    press('?')
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' })
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(GO_KEYS.length + 5)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close the shortcuts')
    press('Escape')
    expect(screen.queryByRole('dialog')).toBeNull()
    press('?')
    press('?')
    expect(screen.queryByRole('dialog')).toBeNull()
    press('?')
    fireEvent.click(screen.getByRole('button', { name: 'Close the shortcuts' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    press('?')
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('jumps to a page with G then a letter', () => {
    render(<ShortcutHost />)
    for (const { key, to } of GO_KEYS) {
      press('g')
      press(key)
      expect(screen.getByTestId('location').textContent).toBe(to)
    }
    press('G')
    press('S')
    expect(screen.getByTestId('location').textContent).toBe('/security')
  })

  it('forgets the G after a moment, and ignores unknown letters', () => {
    vi.useFakeTimers({ now: 100_000 })
    render(<ShortcutHost />)
    press('g')
    vi.setSystemTime(100_000 + GO_WINDOW_MS - 1)
    press('d') // still inside the window
    expect(screen.getByTestId('location').textContent).toBe('/dependencies')
    press('g')
    vi.setSystemTime(100_000 + 2 * GO_WINDOW_MS)
    press('s')
    expect(screen.getByTestId('location').textContent).toBe('/dependencies')
    press('g')
    press('z')
    press('s') // the G was used up by the unknown letter
    expect(screen.getByTestId('location').textContent).toBe('/dependencies')
  })

  it('toggles the theme with T and searches with /', () => {
    calls.search = 0
    calls.theme = 0
    render(<ShortcutHost />)
    press('t')
    press('/')
    expect(calls).toEqual({ search: 1, theme: 1 })
  })

  it('stays out of the way while typing, with modifier keys and while a dialog is open', () => {
    calls.search = 0
    calls.theme = 0
    render(<ShortcutHost />)
    const field = screen.getByRole('textbox', { name: 'Field' })
    press('t', {}, field)
    press('?', {}, field)
    press('g', {}, field)
    press('s', {}, field)
    press('t', { ctrlKey: true })
    press('t', { metaKey: true })
    press('t', { altKey: true })
    expect(calls).toEqual({ search: 0, theme: 0 })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('location').textContent).toBe('/overview')
    press('?')
    press('t')
    press('g')
    press('s')
    expect(calls.theme).toBe(0)
    expect(screen.getByTestId('location').textContent).toBe('/overview')
  })
})

// The shortcuts and toasts are wired into the app shell: checked once end to end.
describe('shortcuts in the app', () => {
  it('opens the list from the status bar and switches the theme with a toast', async () => {
    const { default: App } = await import('../App')
    const { setToken } = await import('../services/session')
    const { AuthProvider } = await import('../hooks/useAuth')
    const { preloadPage } = await import('../routes/pages')
    await preloadPage('OverviewPage')
    setToken('test-token')
    mockApi({
      'GET /auth/me': { status: 200, data: { id: 'u', email: 'a@b.c', display_name: null, created_at: '2026-01-01T00:00:00Z' } },
      'GET /health': { status: 200, data: { status: 'ok' } },
    })
    document.documentElement.setAttribute('data-theme', 'dark')
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter future={ROUTER_FUTURE} initialEntries={['/overview']}>
          <AuthProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByRole('heading', { name: 'Overview' })
    fireEvent.click(screen.getByRole('button', { name: '? shortcuts' }))
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy()
    press('Escape')
    press('t')
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('light'))
    expect(within(screen.getByRole('region', { name: 'Notifications' })).getByText('Light theme')).toBeTruthy()
    press('t')
    await waitFor(() => expect(document.documentElement.getAttribute('data-theme')).toBe('dark'))
    window.localStorage.removeItem('cba-theme')
  }, 60_000)
})
