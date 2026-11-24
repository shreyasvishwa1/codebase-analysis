import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { useDashboard } from '../hooks/useAnalysisRuns'
import { ROUTER_FUTURE } from '../routerFuture'
import { mockApi, PROJECT, ZIP_REPOSITORY, type MockResponse } from '../test/mockApi'
import { createTestQueryClient } from '../test/render'
import type { AnalysisJob, AnalysisRun, Repository } from '../types/api'
import { formatDateTime } from '../utils/format'
import { AnalysisRunsPanel } from './AnalysisRunsPanel'
import { AnalysisWatchProvider, MAX_WATCHED, RunningAnalyses, useAnalysisWatch } from './AnalysisWatch'
import { ToastProvider } from './Toaster'

const P = PROJECT.id
const R = ZIP_REPOSITORY.id
const READY: Repository = { ...ZIP_REPOSITORY, status: 'ready' }
const RUNS_URL = `/projects/${P}/repositories/${R}/analysis-runs`

const job = (status: AnalysisJob['status'], progress = 0): AnalysisJob => ({
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
})

const run = {
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
} satisfies AnalysisRun

/** Serves a run that is processing at 30% until `finish()` is called. */
function serve(earlier: AnalysisRun[] = []) {
  let state: { job: AnalysisJob | null; runs: AnalysisRun[] } = { job: null, runs: earlier }
  const requests = mockApi({
    'GET /dashboard': { status: 500, data: { detail: 'not needed' } },
    [`GET ${RUNS_URL}`]: () => ({ status: 200, data: state }) as MockResponse,
    [`POST ${RUNS_URL}`]: () => {
      state = { job: job('processing', 30), runs: earlier }
      return { status: 202, data: { job_id: 'job-1', repository_id: R, status: 'pending' } }
    },
  })
  return { requests, finish: () => (state = { job: job('completed', 100), runs: [run, ...earlier] }) }
}

function Dashboard() {
  useDashboard()
  return null
}

function Where() {
  return <p data-testid="location">{useLocation().pathname}</p>
}

function app() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter future={ROUTER_FUTURE} initialEntries={['/analysis']}>
        <ToastProvider>
          <AnalysisWatchProvider pollIntervalMs={20}>
            <Routes>
              <Route
                path="/analysis"
                element={
                  <>
                    <Link to="/elsewhere">Leave</Link>
                    <AnalysisRunsPanel projectId={P} repositoryId={R} repository={READY} pollIntervalMs={20} />
                  </>
                }
              />
              <Route path="/elsewhere" element={<p>Another page</p>} />
            </Routes>
            <footer>
              <RunningAnalyses />
            </footer>
            <Where />
            <Dashboard />
          </AnalysisWatchProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const notifications = () => within(screen.getByRole('region', { name: 'Notifications' }))

afterEach(() => {
  document.title = 'CodeBase Analysis'
})

describe('following an analysis across pages', () => {
  it('keeps the progress in the status bar and the tab after leaving the page, then tells how it ended', async () => {
    const server = serve()
    app()
    fireEvent.click(await screen.findByRole('button', { name: 'Run full analysis' }))
    const status = await screen.findByRole('status', { name: 'Running analyses' })
    const chip = await within(status).findByRole('link')
    await waitFor(() => expect(chip.textContent).toBe(`Analyzing ${READY.name}30%`))
    expect(chip.getAttribute('href')).toBe(`/projects/${P}/repositories/${R}/analysis`)

    fireEvent.click(screen.getByRole('link', { name: 'Leave' }))
    expect(await screen.findByText('Another page')).toBeTruthy()
    expect(within(screen.getByRole('status', { name: 'Running analyses' })).getByRole('link').textContent).toContain('30%')
    expect(document.title).toBe(`30% · Analyzing ${READY.name} — CodeBase Analysis`)

    act(() => {
      server.finish()
    })
    const toast = await notifications().findByText('Analysis complete')
    expect(toast.closest('li')?.textContent).toContain(`${READY.name} was analyzed`)
    expect(screen.getByTestId('location').textContent).toBe('/elsewhere')
    expect(within(screen.getByRole('status', { name: 'Running analyses' })).queryByRole('link')).toBeNull()
    expect(document.title).toBe('CodeBase Analysis')
  })

  it('tells once when the page stays open (the page leaves it to the watcher), and shows the new run', async () => {
    const older = [
      { ...run, id: 'run-b', created_at: '2026-11-10T10:00:00Z' },
      { ...run, id: 'run-a', created_at: '2026-11-01T10:00:00Z' },
    ]
    const server = serve(older)
    app()
    // An older run is looked at when the new one starts.
    const oldest = formatDateTime('2026-11-01T10:00:00Z')
    fireEvent.click(await screen.findByRole('button', { name: (name) => name.startsWith(oldest) }))
    expect(screen.getByRole('region', { name: 'Run summary' }).textContent).toContain(oldest)
    fireEvent.click(screen.getByRole('button', { name: 'Run full analysis' }))
    await screen.findByRole('region', { name: 'Live analysis' })
    const dashboardGets = () => server.requests.filter((r) => r.url === '/dashboard').length
    await waitFor(() => expect(dashboardGets()).toBe(2)) // on mount, and once the run started
    act(() => {
      server.finish()
    })
    await notifications().findByText('Analysis complete')
    await new Promise((resolve) => setTimeout(resolve, 100)) // time for a second toast to appear
    expect(notifications().getAllByText('Analysis complete')).toHaveLength(1)
    // The panel shows the new run, and the dashboard totals are fetched again.
    expect(screen.getByRole('region', { name: 'Run summary' }).textContent).toContain(formatDateTime(run.created_at))
    await waitFor(() => expect(dashboardGets()).toBe(3))
  })

  it('does not follow a run that already finished', async () => {
    mockApi({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: job('completed', 100), runs: [run] } } })
    app()
    await screen.findByRole('region', { name: 'Run summary' })
    expect(screen.queryByRole('status', { name: 'Running analyses' })).toBeNull()
    expect(document.title).toBe('CodeBase Analysis')
  })

  it('shows "Queued" until a worker takes the run', async () => {
    mockApi({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: job('pending'), runs: [] } } })
    app()
    const chip = await within(await screen.findByRole('status', { name: 'Running analyses' })).findByRole('link')
    expect(chip.textContent).toBe(`Queued ${READY.name}`)
  })

  it('shows nothing outside the provider, and follows at most the latest few repositories', async () => {
    const { container } = render(<RunningAnalyses />)
    expect(container.innerHTML).toBe('')

    let watch: ReturnType<typeof useAnalysisWatch> = null
    function Grab() {
      watch = useAnalysisWatch()
      return null
    }
    const routes: Record<string, MockResponse> = {}
    for (let i = 0; i < MAX_WATCHED + 2; i += 1) {
      routes[`GET /projects/${P}/repositories/repo-${i}/analysis-runs`] = {
        status: 200,
        data: { job: { ...job('processing', i), repository_id: `repo-${i}` }, runs: [] },
      }
    }
    mockApi(routes)
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter future={ROUTER_FUTURE}>
          <AnalysisWatchProvider pollIntervalMs={20}>
            <Grab />
            <RunningAnalyses />
          </AnalysisWatchProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(watch).not.toBeNull()
    act(() => {
      for (let i = 0; i < MAX_WATCHED + 2; i += 1) watch!({ projectId: P, repositoryId: `repo-${i}`, repositoryName: `repo ${i}` })
      watch!({ projectId: P, repositoryId: 'repo-3', repositoryName: 'repo 3' }) // already followed: no change
    })
    const status = screen.getByRole('status', { name: 'Running analyses' })
    await waitFor(() => expect(within(status).getAllByRole('link')).toHaveLength(MAX_WATCHED))
    expect(within(status).getAllByRole('link').map((link) => link.textContent)).toEqual(
      [2, 3, 4, 5, 6].map((i) => `Analyzing repo ${i}${i}%`),
    )
    act(() => {
      watch!({ projectId: P, repositoryId: 'repo-2', repositoryName: 'renamed' }) // renamed: moves to the end
    })
    await waitFor(() =>
      expect(within(status).getAllByRole('link').map((link) => link.textContent)).toEqual(
        ['Analyzing repo 33%', 'Analyzing repo 44%', 'Analyzing repo 55%', 'Analyzing repo 66%', 'Analyzing renamed2%'],
      ),
    )
  })
})
