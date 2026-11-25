import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { InternalAxiosRequestConfig } from 'axios'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ROUTER_FUTURE } from '../routerFuture'
import { beforeAll, describe, expect, it } from 'vitest'

import App from '../App'
import { setToken } from '../services/session'
import { mockApi, PROJECT, USER, ZIP_REPOSITORY, type MockResponse } from '../test/mockApi'
import { createTestQueryClient, renderWithProviders } from '../test/render'
import type {
  AnalysisRun,
  ComplexityFile,
  ComplexityFileList,
  ComplexityFunction,
  ComplexityFunctionList,
  ComplexityOverview,
  ComplexitySummary,
  QualitySummary,
  Repository,
} from '../types/api'
import { ComplexityPage } from './ComplexityPage'
import { RepositoryComplexityPage } from './RepositoryComplexityPage'
import { preloadAllPages } from '../routes/pages'

const P = PROJECT.id
const R = ZIP_REPOSITORY.id
const REPO_URL = `/projects/${P}/repositories/${R}`
const RUNS_URL = `${REPO_URL}/analysis-runs`
const READY: Repository = { ...ZIP_REPOSITORY, status: 'ready' }

const SUMMARY: ComplexitySummary = {
  files_measured: 12,
  files_skipped: { too_large: 0, unparsable: 0 },
  languages: [{ language: 'Python', files: 8 }, { language: 'TypeScript', files: 4 }],
  nloc: 1840,
  functions: 120,
  classes: 9,
  total_cyclomatic: 480,
  average_cyclomatic: 4,
  max_cyclomatic: 25,
  functions_by_rank: { low: 110, medium: 8, high: 2 },
  files_by_rank: { low: 9, medium: 2, high: 1 },
  maintainability_index: 63.4,
  maintainability: 'good',
  files_by_maintainability: { good: 10, moderate: 1, poor: 1 },
  mi_estimated_files: 0,
  stored_files: 12,
  stored_functions: 120,
  top_functions: [{ path: 'shop/pricing.py', name: 'discount', line: 12, cyclomatic: 25, nloc: 50, rank: 'high' }],
}

const QUALITY = { duplication: { percent: 7.5 } } as unknown as QualitySummary

const run = (overrides: Partial<AnalysisRun> = {}): AnalysisRun => ({
  id: 'run-1',
  analysis_job_id: 'job-1',
  repository_id: R,
  project_id: P,
  file_count: 14,
  analyzed_file_count: 12,
  excluded_file_count: 0,
  total_bytes: 4096,
  total_lines: 2200,
  code_lines: 1900,
  languages: [],
  skipped: { binary: 0, too_large: 0, unavailable: 0, generated: 0 },
  quality: QUALITY,
  security: null,
  complexity: SUMMARY,
  dependencies: null,
  architecture: null,
  chat_index: null,
  created_at: '2026-11-18T10:00:00Z',
  ...overrides,
})

const fn = (overrides: Partial<ComplexityFunction> = {}): ComplexityFunction => ({
  id: 'fn-1',
  path: 'shop/pricing.py',
  name: 'discount',
  line: 12,
  end_line: 60,
  cyclomatic: 25,
  nloc: 50,
  parameters: 2,
  rank: 'high',
  ...overrides,
})

const file = (overrides: Partial<ComplexityFile> = {}): ComplexityFile => ({
  id: 'file-1',
  path: 'shop/pricing.py',
  language: 'Python',
  nloc: 120,
  functions: 4,
  classes: 1,
  total_cyclomatic: 45,
  max_cyclomatic: 25,
  average_cyclomatic: 11.25,
  rank: 'high',
  maintainability_index: 41.2,
  maintainability: 'good',
  mi_estimated: false,
  ...overrides,
})

const fnPage = (items: ComplexityFunction[], total = items.length): ComplexityFunctionList => ({ items, total, page: 1, page_size: 25 })
const filePage = (items: ComplexityFile[], total = items.length): ComplexityFileList => ({ items, total, page: 1, page_size: 25 })
const last = <T,>(items: T[]): T | undefined => items[items.length - 1]

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

type Handler = MockResponse | ((c: InternalAxiosRequestConfig) => MockResponse)

function recorder<T>(respond: (params: Record<string, unknown>) => T, seen: Record<string, unknown>[]) {
  return (config: InternalAxiosRequestConfig): MockResponse => {
    const params = { ...(config.params as Record<string, unknown>) }
    seen.push(params)
    return { status: 200, data: respond(params) }
  }
}

function mountRepositoryPage(routes: Record<string, Handler>) {
  const requests = mockApi({ [`GET ${REPO_URL}`]: { status: 200, data: READY }, ...routes })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter future={ROUTER_FUTURE} initialEntries={[`${REPO_URL}/complexity`]}>
        <Routes>
          <Route path="/projects/:projectId/repositories/:repositoryId/complexity" element={<RepositoryComplexityPage />} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return requests
}

function standardRoutes(fnSeen: Record<string, unknown>[] = [], fileSeen: Record<string, unknown>[] = []) {
  return {
    [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
    [`GET ${RUNS_URL}/run-1/complexity/functions`]: recorder(
      () => fnPage([fn(), fn({ id: 'fn-2', name: 'label', path: 'web/cart.ts', line: 3, cyclomatic: 3, nloc: 8, parameters: 1, rank: 'low' })]),
      fnSeen,
    ),
    [`GET ${RUNS_URL}/run-1/complexity/files`]: recorder(
      () =>
        filePage([
          file(),
          file({ id: 'file-2', path: 'web/cart.ts', language: 'TypeScript', max_cyclomatic: 3, average_cyclomatic: 2, rank: 'low', maintainability_index: 72.6, mi_estimated: true }),
          file({ id: 'file-3', path: 'shop/empty.py', functions: 0, max_cyclomatic: 0, average_cyclomatic: 0, rank: 'low', maintainability_index: null, maintainability: null }),
        ]),
      fileSeen,
    ),
  }
}


// Signed-in pages load lazily; compile them once up front so navigation tests do not
// spend their waits on the test environment's on-demand compilation.
beforeAll(() => preloadAllPages(), 120_000)

describe('Repository complexity', () => {
  it('shows the summary, distributions, functions and files of the latest run', async () => {
    const fnSeen: Record<string, unknown>[] = []
    const fileSeen: Record<string, unknown>[] = []
    mountRepositoryPage(standardRoutes(fnSeen, fileSeen))
    const summary = await screen.findByRole('region', { name: 'Complexity summary' })
    const value = (label: string) => within(summary).getByText(label).nextElementSibling?.textContent
    expect(value('Functions')).toBe('120')
    expect(value('Classes')).toBe('9')
    expect(value('Lines of code')).toBe('1,840')
    expect(value('Average complexity')).toBe('4.00')
    expect(value('Highest complexity')).toBe('25')
    expect(value('Maintainability')).toBe('63.4')
    expect(within(summary).getByText('Good (0–100, mean of files)')).toBeTruthy()
    expect(value('Duplication')).toBe('7.5%')
    expect(within(summary).queryByRole('list', { name: 'Analysis notes' })).toBeNull()

    const distribution = screen.getByRole('region', { name: 'Functions by complexity' })
    expect(within(distribution).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Low (1–10)110 · 91.7%',
      'Medium (11–20)8 · 6.7%',
      'High (21+)2 · 1.7%',
    ])
    const maintainability = screen.getByRole('region', { name: 'Files by maintainability' })
    expect(within(maintainability).getAllByRole('button').map((b) => b.textContent)).toEqual(['Good10', 'Moderate1', 'Poor1'])

    const functions = within(screen.getByRole('region', { name: 'Most complex functions' }))
    expect(await functions.findByText('discount')).toBeTruthy()
    expect(functions.getByText('shop/pricing.py:12 · 50 lines · 2 parameters')).toBeTruthy()
    expect(functions.getByText('web/cart.ts:3 · 8 lines · 1 parameter')).toBeTruthy()
    expect(functions.getByRole('status').textContent).toBe('2 functions · page 1 of 1')

    const files = within(screen.getByRole('region', { name: 'Files' }))
    const rows = await files.findAllByRole('row')
    expect(rows.slice(1).map((row) => [...row.querySelectorAll('td')].map((td) => td.textContent))).toEqual([
      ['shop/pricing.pyPython', '120', '4', '1', '25', '11.3', '41.2', 'High'],
      ['web/cart.tsTypeScript', '120', '4', '1', '3', '2.0', '72.6est.', 'Low'],
      ['shop/empty.pyPython', '120', '0', '1', '0', '0.0', '—', 'Low'],
    ])
    expect(fnSeen).toEqual([{ page: 1, page_size: 25 }])
    expect(fileSeen).toEqual([{ page: 1, page_size: 25, sort: 'complexity' }])
  })

  it('opens a function in the explorer at its line', async () => {
    mountRepositoryPage(standardRoutes())
    fireEvent.click(await screen.findByRole('link', { name: 'Open discount in the explorer' }))
    expect(screen.getByTestId('location').textContent).toBe(REPO_URL)
  })

  it('filters and pages the functions', async () => {
    const seen: Record<string, unknown>[] = []
    mountRepositoryPage({
      ...standardRoutes(),
      [`GET ${RUNS_URL}/run-1/complexity/functions`]: recorder((params) => ({ ...fnPage([fn({ id: `fn-p${String(params.page)}` })], 60), page: Number(params.page) }), seen),
    })
    const functions = within(await screen.findByRole('region', { name: 'Most complex functions' }))
    expect(await functions.findByText('60 functions · page 1 of 3')).toBeTruthy()
    fireEvent.click(functions.getByRole('button', { name: 'Next' }))
    expect(await functions.findByText('60 functions · page 2 of 3')).toBeTruthy()

    fireEvent.change(functions.getByLabelText('Complexity'), { target: { value: 'medium' } })
    await waitFor(() => expect(last(seen)).toEqual({ page: 1, page_size: 25, rank: 'medium' }))
    fireEvent.change(functions.getByLabelText('Search functions'), { target: { value: '  disc ' } })
    fireEvent.click(functions.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(last(seen)).toEqual({ page: 1, page_size: 25, rank: 'medium', q: 'disc' }))

    fireEvent.click(within(screen.getByRole('region', { name: 'Functions by complexity' })).getByRole('button', { name: 'Show high complexity functions' }))
    await waitFor(() => expect(last(seen)).toMatchObject({ rank: 'high', page: 1 }))
    fireEvent.click(await screen.findByRole('button', { name: 'Show the functions of web/cart.ts' }))
    await waitFor(() => expect(last(seen)).toMatchObject({ path: 'web/cart.ts', page: 1 }))
    fireEvent.click(functions.getByRole('button', { name: 'Clear file filter' }))
    await waitFor(() => expect(last(seen)).not.toHaveProperty('path'))
  })

  it('sorts, filters and pages the files', async () => {
    const seen: Record<string, unknown>[] = []
    mountRepositoryPage({
      ...standardRoutes(),
      [`GET ${RUNS_URL}/run-1/complexity/files`]: recorder((params) => ({ ...filePage([file({ id: `f-${String(params.page)}` })], 30), page: Number(params.page) }), seen),
    })
    const files = within(await screen.findByRole('region', { name: 'Files' }))
    expect(await files.findByText('30 files · page 1 of 2')).toBeTruthy()
    fireEvent.click(files.getByRole('button', { name: 'Next' }))
    expect(await files.findByText('30 files · page 2 of 2')).toBeTruthy()
    expect((files.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(files.getByLabelText('Sort by'), { target: { value: 'maintainability' } })
    await waitFor(() => expect(last(seen)).toEqual({ page: 1, page_size: 25, sort: 'maintainability' }))
    fireEvent.change(files.getByLabelText('Complexity'), { target: { value: 'high' } })
    await waitFor(() => expect(last(seen)).toMatchObject({ rank: 'high', sort: 'maintainability' }))
    fireEvent.change(files.getByLabelText('Maintainability'), { target: { value: 'poor' } })
    await waitFor(() => expect(last(seen)).toMatchObject({ maintainability: 'poor' }))
    fireEvent.change(files.getByLabelText('Search files'), { target: { value: 'shop/' } })
    fireEvent.click(files.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(last(seen)).toEqual({ page: 1, page_size: 25, sort: 'maintainability', rank: 'high', maintainability: 'poor', q: 'shop/' }))

    fireEvent.click(within(screen.getByRole('region', { name: 'Files by maintainability' })).getByRole('button', { name: 'Show moderate maintainability files' }))
    await waitFor(() => expect(last(seen)).toMatchObject({ maintainability: 'moderate', page: 1 }))
  })

  it('notes estimated indexes, files not measured and stored functions', async () => {
    mountRepositoryPage({
      ...standardRoutes(),
      [`GET ${RUNS_URL}`]: {
        status: 200,
        data: {
          job: null,
          runs: [run({ quality: null, complexity: { ...SUMMARY, mi_estimated_files: 4, files_skipped: { too_large: 1, unparsable: 1 }, stored_functions: 100 } })],
        },
      },
    })
    const notes = await screen.findByRole('list', { name: 'Analysis notes' })
    expect(within(notes).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'The maintainability index of 4 files is estimated from tokens (languages other than Python).',
      '2 files could not be measured (too large or unparsable).',
      'The 100 most complex of 120 functions are listed.',
    ])
    expect(screen.queryByText('Duplication')).toBeNull() // no code analysis in this run
  })

  it('shows a dash when no code was measured', async () => {
    mountRepositoryPage({
      ...standardRoutes(),
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run({ complexity: { ...SUMMARY, maintainability_index: null, maintainability: null } })] } },
    })
    const summary = await screen.findByRole('region', { name: 'Complexity summary' })
    expect(within(summary).getByText('Maintainability').nextElementSibling?.textContent).toBe('—')
    expect(within(summary).getByText('No code measured')).toBeTruthy()
  })

  it('switches runs and starts each run with no filters', async () => {
    const seen: Record<string, unknown>[] = []
    const older = run({ id: 'run-0', created_at: '2026-11-17T09:00:00Z', complexity: { ...SUMMARY, functions: 40 } })
    mountRepositoryPage({
      ...standardRoutes(seen),
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run(), older] } },
      [`GET ${RUNS_URL}/run-0/complexity/functions`]: recorder(() => fnPage([fn({ id: 'old', name: 'olderFunction' })]), seen),
      [`GET ${RUNS_URL}/run-0/complexity/files`]: { status: 200, data: filePage([]) },
    })
    const functions = within(await screen.findByRole('region', { name: 'Most complex functions' }))
    fireEvent.change(functions.getByLabelText('Complexity'), { target: { value: 'low' } })
    await waitFor(() => expect(last(seen)).toMatchObject({ rank: 'low' }))
    const trend = await screen.findByRole('region', { name: 'Since the previous run' })
    expect(trend.textContent).toContain('Highly complex functions')
    expect(trend.textContent).toContain('Average complexity')
    expect(trend.textContent).toMatch(/than the previous run|No change from the previous run/)
    fireEvent.change(screen.getByLabelText('Run'), { target: { value: 'run-0' } })
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Since the previous run' }).textContent).toContain('First run with this measure'),
    )
    expect(await screen.findByText('olderFunction')).toBeTruthy()
    expect(last(seen)).toEqual({ page: 1, page_size: 25 })
    expect(within(screen.getByRole('region', { name: 'Complexity summary' })).getByText('Functions').nextElementSibling?.textContent).toBe('40')
  })

  it('links to the full analysis when there is no run yet', async () => {
    mountRepositoryPage({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [] } } })
    fireEvent.click(await screen.findByRole('link', { name: 'Run a full analysis' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/analysis`)
  })

  it('asks for a new run when the latest predates complexity analysis', async () => {
    const requests = mountRepositoryPage({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run({ complexity: null })] } } })
    expect(await screen.findByRole('link', { name: 'Run a new full analysis' })).toBeTruthy()
    expect(requests.some((r) => r.url.includes('/complexity/'))).toBe(false)
  })

  it('reports failed requests and empty results', async () => {
    mountRepositoryPage({
      ...standardRoutes(),
      [`GET ${RUNS_URL}/run-1/complexity/functions`]: { status: 500, data: { detail: 'Server error' } },
      [`GET ${RUNS_URL}/run-1/complexity/files`]: { status: 200, data: filePage([]) },
    })
    expect((await screen.findByRole('alert')).textContent).toContain('Server error')
    expect(await screen.findByText('No files match these filters.')).toBeTruthy()
  })
})

const OVERVIEW: ComplexityOverview = {
  repositories: [
    {
      project_id: P,
      project_name: 'Demo project',
      repository_id: R,
      repository_name: 'shop-api',
      run_id: 'run-1',
      created_at: '2026-11-18T10:00:00Z',
      analyzed_file_count: 12,
      code_lines: 1900,
      complexity: SUMMARY,
    },
  ],
}

describe('Complexity overview', () => {
  function mountOverview() {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter future={ROUTER_FUTURE} initialEntries={['/complexity']}>
          <Routes>
            <Route path="/complexity" element={<ComplexityPage />} />
            <Route path="*" element={<Location />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it("lists each repository's latest results and opens its report", async () => {
    mockApi({ 'GET /complexity': { status: 200, data: OVERVIEW } })
    mountOverview()
    const card = within(await screen.findByRole('list', { name: 'Measured repositories' })).getByRole('listitem')
    expect(within(card).getByText('Average complexity').nextElementSibling?.textContent).toBe('4.00')
    expect(within(card).getByText('Maintainability').nextElementSibling?.textContent).toBe('63.4')
    expect(within(card).getByText('Good')).toBeTruthy()
    expect(within(card).getByText('Functions').nextElementSibling?.textContent).toBe('120')
    expect(within(card).getByLabelText('Functions by complexity').textContent).toBe('Low110Medium8High2')
    fireEvent.click(within(card).getByRole('link', { name: 'View the complexity report of shop-api' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/complexity`)
  })

  it('invites the user to analyze a repository', async () => {
    mockApi({ 'GET /complexity': { status: 200, data: { repositories: [] } } })
    mountOverview()
    fireEvent.click(await screen.findByRole('link', { name: 'Upload a repository' }))
    expect(screen.getByTestId('location').textContent).toBe('/upload')
  })

  it('reports a failed request', async () => {
    mockApi({ 'GET /complexity': { status: 500, data: { detail: 'Server error' } } })
    mountOverview()
    expect((await screen.findByRole('alert')).textContent).toContain('Server error')
  })
})

describe('Complexity navigation', () => {
  it('opens Complexity from the sidebar and a repository section', async () => {
    setToken('test-token')
    mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
      'GET /complexity': { status: 200, data: OVERVIEW },
      [`GET ${REPO_URL}`]: { status: 200, data: READY },
      ...standardRoutes(),
    })
    renderWithProviders(<App />, { route: '/overview' })
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]
    fireEvent.click(within(nav).getByRole('link', { name: 'Complexity' }))
    expect(await screen.findByRole('heading', { name: 'Complexity' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('link', { name: 'View the complexity report of shop-api' }))
    const sections = await screen.findByRole('navigation', { name: 'Repository sections' })
    expect(within(sections).getByRole('link', { name: 'Complexity' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByText('discount')).toBeTruthy()
  })
})
