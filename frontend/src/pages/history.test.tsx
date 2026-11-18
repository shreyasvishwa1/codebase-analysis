import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { InternalAxiosRequestConfig } from 'axios'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import { scoreChanges } from '../components/HistoryPanel'
import { ToastProvider } from '../components/Toaster'
import { setToken } from '../services/session'
import { mockApi, PROJECT, USER, ZIP_REPOSITORY, type MockResponse } from '../test/mockApi'
import { createTestQueryClient, renderWithProviders } from '../test/render'
import type { GeneratedReport, HistoryEntry, Repository } from '../types/api'
import { HistoryPage } from './HistoryPage'
import { RepositoryHistoryPage } from './RepositoryHistoryPage'
import { preloadAllPages } from '../routes/pages'

const P = PROJECT.id
const R = ZIP_REPOSITORY.id
const REPO_URL = `/projects/${P}/repositories/${R}`
const READY: Repository = { ...ZIP_REPOSITORY, status: 'ready' }

const entry = (id: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  run_id: id,
  project_id: P,
  project_name: 'Demo project',
  repository_id: R,
  repository_name: 'shop',
  created_at: '2026-11-18T10:00:00Z',
  analyzed_file_count: 120,
  code_lines: 4500,
  overall: 60,
  grade: 'C',
  security_findings: 40,
  critical_findings: 2,
  high_findings: 5,
  quality_issues: 300,
  complex_functions: 4,
  vulnerable_dependencies: 1,
  chat_ready: true,
  reports: 0,
  ...overrides,
})

const ENTRIES: HistoryEntry[] = [
  entry('run-3'),
  entry('run-x', { repository_id: 'repo-2', repository_name: 'web', overall: 80, grade: 'B', created_at: '2026-11-17T12:00:00Z', critical_findings: 0, high_findings: 0 }),
  entry('run-2', { overall: 55, created_at: '2026-11-16T10:00:00Z', reports: 2 }),
  entry('run-1', { overall: null, grade: null, security_findings: null, critical_findings: null, high_findings: null, quality_issues: null, complex_functions: null, vulnerable_dependencies: null, chat_ready: false, created_at: '2026-11-15T10:00:00Z' }),
]

const REPORT: GeneratedReport = {
  id: 'rep-1',
  project_id: P,
  project_name: 'Demo project',
  repository_id: R,
  repository_name: 'shop',
  run_id: 'run-3',
  run_created_at: '2026-11-18T10:00:00Z',
  filename: 'shop-report-20261118-1000.pdf',
  size_bytes: 24_576,
  sha256: 'a'.repeat(64),
  pages: 8,
  created_at: '2026-11-18T11:00:00Z',
}

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

type Routes = Parameters<typeof mockApi>[0]

function mount(routes: Routes, element = <HistoryPage />, entryPath = '/history', path = '/history') {
  const requests = mockApi(routes)
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[entryPath]}>
        <ToastProvider>
          <Routes>
            <Route path={path} element={element} />
            <Route path="*" element={<Location />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return requests
}

const history = (entries: HistoryEntry[] = ENTRIES, total = entries.length): MockResponse => ({ status: 200, data: { entries, total } })
/** The titles of the toasts on screen. */
const toastTitles = () =>
  within(screen.getByRole('region', { name: 'Notifications' }))
    .queryAllByRole('listitem')
    .map((item) => item.querySelector('p')?.textContent)
const params = (config: InternalAxiosRequestConfig) => config.params as Record<string, unknown> | undefined


// Signed-in pages load lazily; compile them once up front so navigation tests do not
// spend their waits on the test environment's on-demand compilation.
beforeAll(() => preloadAllPages(), 120_000)

describe('Score changes', () => {
  it('compare each run with the same repository’s previous one', () => {
    expect(Object.fromEntries(scoreChanges(ENTRIES))).toEqual({ 'run-3': 5, 'run-x': null, 'run-2': null, 'run-1': null })
    expect(Object.fromEntries(scoreChanges([entry('a', { overall: 50 }), entry('b', { overall: 50 })]))).toEqual({ a: 0, b: null })
  })
})

describe('History & Reports', () => {
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>
  let clicked: { download: string; href: string }[]

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:report')
    revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    clicked = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.getAttribute('href') ?? '' })
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('lists analyses with their numbers and score changes', async () => {
    mount({ 'GET /analysis-history': history(), 'GET /reports': { status: 200, data: { reports: [] } } })
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(4)
    const first = within(rows[0])
    expect(first.getByRole('link', { name: 'shop' }).getAttribute('href')).toBe(REPO_URL)
    const score = first.getByRole('link', { name: 'Health 60, grade C' })
    expect(score.getAttribute('href')).toBe(`${REPO_URL}/health`)
    expect(score.textContent).toBe('60C+5')
    expect(rows[0].textContent).toContain('2 critical, 5 high')
    expect(rows[0].textContent).toContain('of 40')
    expect(rows[0].textContent).toContain('120 files · 4,500 lines')
    expect(rows[2].textContent).toContain('2 saved')
    expect(within(rows[3]).getAllByTitle('Not analyzed in this run')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull()
    expect(await screen.findByText(/No reports yet/)).toBeTruthy()
  })

  it('shows older analyses on request', async () => {
    const requests = mount({
      'GET /analysis-history': (config) => (params(config)?.limit === 25 ? history(ENTRIES.slice(0, 2), 4) : history(ENTRIES, 4)),
      'GET /reports': { status: 200, data: { reports: [] } },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Show more (2 older)' }))
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5))
    expect(requests.filter((r) => r.url === '/analysis-history')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull()
  })

  it('creates a report, refreshes the lists and downloads it', async () => {
    let created = false
    const requests = mount({
      'GET /analysis-history': () => history(created ? [entry('run-3', { reports: 1 }), ...ENTRIES.slice(1)] : ENTRIES),
      'GET /reports': () => ({ status: 200, data: { reports: created ? [REPORT] : [] } }),
      [`POST ${REPO_URL}/analysis-runs/run-3/reports`]: () => {
        created = true
        return { status: 201, data: REPORT }
      },
      'GET /reports/rep-1/download': { status: 200, data: new Blob(['%PDF-1.4'], { type: 'application/pdf' }) },
    })
    const button = await screen.findByRole('button', { name: `Create a PDF report of the analysis of ${new Date('2026-11-18T10:00:00Z').toLocaleString()} (shop)` })
    fireEvent.click(button)
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('Report created: shop-report-20261118-1000.pdf (8 pages, 24.0 KB)')
    expect(toastTitles()).toEqual(['Report ready'])
    const reports = within(screen.getByRole('region', { name: 'Reports' }))
    expect(await reports.findByText('shop-report-20261118-1000.pdf')).toBeTruthy()
    expect(reports.getByText('shop-report-20261118-1000.pdf').closest('tr')?.className).toContain('bg-indigo-500/10')
    expect(await screen.findByText('1 saved')).toBeTruthy()
    fireEvent.click(within(status).getByRole('button', { name: 'Download now' }))
    await waitFor(() => expect(clicked).toEqual([{ download: 'shop-report-20261118-1000.pdf', href: 'blob:report' }]))
    await waitFor(() => expect(toastTitles()).toEqual(['Report ready', 'Report downloaded']))
    const get = requests.find((r) => r.url === '/reports/rep-1/download')
    expect(get?.method).toBe('GET')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report')
    fireEvent.click(reports.getByRole('button', { name: 'Download shop-report-20261118-1000.pdf' }))
    await waitFor(() => expect(clicked).toHaveLength(2))
    await waitFor(() => expect(toastTitles()).toEqual(['Report ready', 'Report downloaded', 'Report downloaded']))
  })

  it('reports a report that could not be created or downloaded', async () => {
    mount({
      'GET /analysis-history': history([entry('run-3')]),
      'GET /reports': { status: 200, data: { reports: [REPORT] } },
      [`POST ${REPO_URL}/analysis-runs/run-3/reports`]: { status: 429, data: { detail: 'Too many requests; try again in 60 seconds' } },
      'GET /reports/rep-1/download': { status: 404, data: { detail: 'Report not found' } },
    })
    fireEvent.click(await screen.findByRole('button', { name: /Create a PDF report/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('Too many requests; try again in 60 seconds')
    fireEvent.click(screen.getByRole('button', { name: 'Download shop-report-20261118-1000.pdf' }))
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent)).toContain('Report not found'))
    expect(clicked).toEqual([])
  })

  it('deletes a report after confirmation', async () => {
    let deleted = false
    const requests = mount({
      'GET /analysis-history': history([entry('run-3', { reports: 1 })]),
      'GET /reports': () => ({ status: 200, data: { reports: deleted ? [] : [REPORT] } }),
      'DELETE /reports/rep-1': () => {
        deleted = true
        return { status: 204 }
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete shop-report-20261118-1000.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete shop-report-20261118-1000.pdf' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(/No reports yet/)).toBeTruthy()
    expect(toastTitles()).toEqual(['Report deleted'])
    expect(requests.filter((r) => r.method === 'DELETE').map((r) => r.url)).toEqual(['/reports/rep-1'])
    await waitFor(() => expect(requests.filter((r) => r.url === '/analysis-history').length).toBeGreaterThan(1))
  })

  it('invites an upload when there is no history', async () => {
    mount({ 'GET /analysis-history': history([]), 'GET /reports': { status: 200, data: { reports: [] } } })
    fireEvent.click(await screen.findByRole('link', { name: 'Upload a repository' }))
    expect(screen.getByTestId('location').textContent).toBe('/upload')
  })

  it('reports lists that cannot be loaded', async () => {
    mount({
      'GET /analysis-history': { status: 500, data: { detail: 'History failed' } },
      'GET /reports': { status: 500, data: { detail: 'Reports failed' } },
    })
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['History failed', 'Reports failed']))
  })

  it('shows one repository’s history and reports', async () => {
    const requests = mount(
      {
        [`GET ${REPO_URL}`]: { status: 200, data: READY },
        'GET /analysis-history': history([]),
        'GET /reports': { status: 200, data: { reports: [] } },
      },
      <RepositoryHistoryPage />,
      `${REPO_URL}/history`,
      '/projects/:projectId/repositories/:repositoryId/history',
    )
    fireEvent.click(await screen.findByRole('link', { name: 'Run a full analysis' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/analysis`)
    const calls = requests.filter((r) => r.url === '/analysis-history' || r.url === '/reports')
    expect(calls).toHaveLength(2)
  })
})

describe('History navigation', () => {
  it('opens History & Reports from the sidebar and a repository section', async () => {
    setToken('test-token')
    mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
      'GET /analysis-history': (config) =>
        history(params(config)?.repository_id ? [entry('run-3')] : ENTRIES),
      'GET /reports': { status: 200, data: { reports: [] } },
      [`GET ${REPO_URL}`]: { status: 200, data: READY },
    })
    renderWithProviders(<App />, { route: '/overview' })
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]
    fireEvent.click(within(nav).getByRole('link', { name: 'History & Reports' }))
    expect(await screen.findByRole('heading', { name: 'History & Reports' })).toBeTruthy()
    fireEvent.click(within(await screen.findByRole('table')).getAllByRole('link', { name: 'shop' })[0])
    const sections = await screen.findByRole('navigation', { name: 'Repository sections' })
    fireEvent.click(within(sections).getByRole('link', { name: 'History & reports' }))
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2))
    expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: 'Repository' })).toBeNull()
  })
})
