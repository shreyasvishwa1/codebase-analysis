import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from '../App'
import { scoreTone } from '../components/HealthReport'
import { setToken } from '../services/session'
import { mockApi, PROJECT, USER, ZIP_REPOSITORY, type MockResponse } from '../test/mockApi'
import { createTestQueryClient, renderWithProviders } from '../test/render'
import type {
  AnalysisRun,
  HealthDimension,
  HealthHistory,
  HealthOverview,
  HealthReport,
  HealthWeights,
  QualitySummary,
  Repository,
} from '../types/api'
import { HealthPage } from './HealthPage'
import { RepositoryHealthPage } from './RepositoryHealthPage'

const P = PROJECT.id
const R = ZIP_REPOSITORY.id
const REPO_URL = `/projects/${P}/repositories/${R}`
const RUNS_URL = `${REPO_URL}/analysis-runs`
const HEALTH_URL = `${RUNS_URL}/run-1/health`
const HISTORY_URL = `${REPO_URL}/health-history`
const READY: Repository = { ...ZIP_REPOSITORY, status: 'ready' }
// The page only checks that a run has code-quality results.
const QUALITY = { issues: 0 } as unknown as QualitySummary
const DEFAULTS: HealthWeights = { security: 25, quality: 20, complexity: 15, maintainability: 15, dependencies: 15, architecture: 10 }

const run = (overrides: Partial<AnalysisRun> = {}): AnalysisRun => ({
  id: 'run-1',
  analysis_job_id: 'job-1',
  repository_id: R,
  project_id: P,
  file_count: 12,
  analyzed_file_count: 10,
  excluded_file_count: 0,
  total_bytes: 4096,
  total_lines: 400,
  code_lines: 300,
  languages: [],
  skipped: { binary: 0, too_large: 0, unavailable: 0, generated: 0 },
  quality: QUALITY,
  security: null,
  complexity: null,
  dependencies: null,
  architecture: null,
  chat_index: null,
  created_at: '2026-11-18T10:00:00Z',
  ...overrides,
})

const dimension = (key: HealthDimension['key'], name: string, score: number | null, extra: Partial<HealthDimension> = {}): HealthDimension => ({
  key,
  name,
  score,
  weight: DEFAULTS[key],
  inputs: {},
  explanation: `${name} explanation`,
  improvements: [],
  ...extra,
})

const REPORT: HealthReport = {
  run_id: 'run-1',
  created_at: '2026-11-18T10:00:00Z',
  overall: 60,
  grade: 'C',
  weights: DEFAULTS,
  dimensions: [
    dimension('security', 'Security', 36, {
      inputs: { findings: 1234, by_severity: { critical: 1, high: 2 }, weighted_points: 296.5 },
      explanation: '296.5 weighted points over 82.9 thousand lines.',
      improvements: ['Fix the 1 critical finding first.', 'Fix the 2 high-severity findings.'],
    }),
    dimension('quality', 'Code quality', 63),
    dimension('complexity', 'Complexity', 97),
    dimension('maintainability', 'Maintainability', 59),
    dimension('dependencies', 'Dependency health', null, {
      inputs: { dependencies: 7, lookups: { registry: 'disabled', osv: 'disabled' } },
      explanation: 'Versions and vulnerabilities could not be looked up for this run.',
    }),
    dimension('architecture', 'Architecture', 60, { inputs: { checks: { tests: true, continuous_integration: false } } }),
  ],
}

const point = (id: string, created: string, overall: number | null, grade: string | null) => ({
  run_id: id,
  created_at: created,
  overall,
  grade,
  scores: { security: 36, quality: 63, complexity: 97, maintainability: 59, dependencies: null, architecture: overall },
})

const HISTORY: HealthHistory = {
  points: [point('run-0', '2026-11-17T09:00:00Z', 52, 'D'), point('run-1', '2026-11-18T10:00:00Z', 60, 'C')],
}

function Location() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.hash}</output>
}

function mountRepositoryPage(routes: Record<string, MockResponse>) {
  const requests = mockApi({ [`GET ${REPO_URL}`]: { status: 200, data: READY }, ...routes })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[`${REPO_URL}/health`]}>
        <Routes>
          <Route path="/projects/:projectId/repositories/:repositoryId/health" element={<RepositoryHealthPage />} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return requests
}

const standard = {
  [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
  [`GET ${HEALTH_URL}`]: { status: 200, data: REPORT },
  [`GET ${HISTORY_URL}`]: { status: 200, data: HISTORY },
}

describe('Score colors', () => {
  it('follow the grade boundaries', () => {
    expect([100, 85, 84, 70, 69, 55, 54, 40, 39, 0, null].map((s) => scoreTone(s).text)).toEqual([
      'text-emerald-300', 'text-emerald-300', 'text-lime-300', 'text-lime-300', 'text-amber-300', 'text-amber-300',
      'text-orange-300', 'text-orange-300', 'text-red-300', 'text-red-300', 'text-slate-400',
    ])  // prettier-ignore
  })
})

describe('Repository health score', () => {
  it('shows the overall score, each dimension and how it was calculated', async () => {
    mountRepositoryPage(standard)
    const overall = await screen.findByRole('region', { name: 'Overall health' })
    expect(within(overall).getByRole('img').getAttribute('aria-label')).toBe('Overall health 60 out of 100, grade C')
    expect(overall.textContent).toContain('The weighted average of 5 scored dimensions.')
    expect(overall.textContent).toContain('Not scored, so left out of the average: Dependency health.')
    expect(overall.textContent).toContain('Weights used: Security 25 · Code quality 20 · Complexity 15 · Maintainability 15 · Dependency health 15 · Architecture 10.')

    const security = screen.getByRole('article', { name: 'Security' })
    expect(within(security).getByText('Weight 25 · 29% of this score')).toBeTruthy() // 25 / 85
    expect(within(security).getByText('36').className).toContain('text-red-300')
    expect(within(security).getByText('296.5 weighted points over 82.9 thousand lines.')).toBeTruthy()
    const improvements = within(security).getByRole('list', { name: 'How to improve Security' })
    expect(within(improvements).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Fix the 1 critical finding first.',
      'Fix the 2 high-severity findings.',
    ])
    const inputs = within(security).getByLabelText('Security inputs')
    expect([...inputs.querySelectorAll('div')].map((row) => row.textContent)).toEqual([
      'Findings1,234',
      'By severitycritical 1, high 2',
      'Weighted points296.5',
    ])
    expect(within(security).getByRole('link', { name: 'Security findings' }).getAttribute('href')).toBe(`${REPO_URL}/security`)

    const dependencies = screen.getByRole('article', { name: 'Dependency health' })
    expect(within(dependencies).getByText('Weight 15 · left out of the overall score')).toBeTruthy()
    expect(within(dependencies).getByText('Not scored')).toBeTruthy()
    expect(within(dependencies).getByLabelText('Dependency health inputs').textContent).toContain('Lookupsregistry disabled, osv disabled')
    expect(within(dependencies).queryByRole('list')).toBeNull() // no improvements
    const architecture = screen.getByRole('article', { name: 'Architecture' })
    expect(within(architecture).getByText('Weight 10 · 12% of this score')).toBeTruthy()
    expect(within(architecture).getByLabelText('Architecture inputs').textContent).toBe('Checkstests yes, continuous integration no')
    const maintainability = screen.getByRole('article', { name: 'Maintainability' })
    expect(within(maintainability).queryByLabelText('Maintainability inputs')).toBeNull() // no inputs
    expect(within(maintainability).getByRole('link', { name: 'Maintainability by file' }).getAttribute('href')).toBe(`${REPO_URL}/complexity`)
    expect(screen.getAllByRole('article').map((card) => card.getAttribute('aria-label'))).toEqual([
      'Security', 'Code quality', 'Complexity', 'Maintainability', 'Dependency health', 'Architecture',
    ])  // prettier-ignore

    const history = await screen.findByRole('table', { name: 'Health history' })
    const rows = within(history).getAllByRole('row').slice(1)
    expect(rows.map((row) => [...row.querySelectorAll('td')].slice(1).map((td) => td.textContent))).toEqual([
      ['60 (C)', '36', '63', '97', '59', '—', '60'], // newest first
      ['52 (D)', '36', '63', '97', '59', '—', '52'],
    ])

    fireEvent.click(within(overall).getByRole('link', { name: 'Change the weights' }))
    expect(screen.getByTestId('location').textContent).toBe('/health-score#weights')
  })

  it('shows a run that could not be scored', async () => {
    mountRepositoryPage({
      ...standard,
      [`GET ${HEALTH_URL}`]: { status: 200, data: { ...REPORT, overall: null, grade: null, dimensions: REPORT.dimensions.map((d) => ({ ...d, score: null })) } },
    })
    const overall = await screen.findByRole('region', { name: 'Overall health' })
    expect(within(overall).getByRole('img').getAttribute('aria-label')).toBe('Overall health not scored')
    expect(overall.textContent).toContain('No dimension could be scored for this run')
    expect(screen.getAllByText('Not scored')).toHaveLength(6)
  })

  it('waits for a second scored analysis before drawing the trend', async () => {
    mountRepositoryPage({ ...standard, [`GET ${HISTORY_URL}`]: { status: 200, data: { points: HISTORY.points.slice(1) } } })
    expect(await screen.findByText('The trend appears once the repository has two scored analyses.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('links to the full analysis when there is no run yet', async () => {
    const requests = mountRepositoryPage({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [] } } })
    fireEvent.click(await screen.findByRole('link', { name: 'Run a full analysis' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/analysis`)
    expect(requests.some((r) => r.url.includes('health'))).toBe(false)
  })

  it('asks for a new run when every run predates the analyses the score uses', async () => {
    const requests = mountRepositoryPage({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run({ quality: null })] } } })
    expect(await screen.findByText(/These runs were stored before the analyses the health score uses/)).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Run a new full analysis' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/analysis`)
    expect(requests.some((r) => r.url.includes('health'))).toBe(false)
  })

  it('reports a score or history that cannot be loaded', async () => {
    mountRepositoryPage({
      ...standard,
      [`GET ${HEALTH_URL}`]: { status: 404, data: { detail: 'This run was stored before the analyses the health score uses' } },
      [`GET ${HISTORY_URL}`]: { status: 500, data: { detail: 'History failed' } },
    })
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'This run was stored before the analyses the health score uses',
      'History failed',
    ])
  })

  it('reports runs that cannot be loaded', async () => {
    mountRepositoryPage({ [`GET ${RUNS_URL}`]: { status: 500, data: { detail: 'Runs failed' } } })
    expect((await screen.findByRole('alert')).textContent).toBe('Runs failed')
  })

  it('switches between scored runs', async () => {
    const older = run({ id: 'run-0', created_at: '2026-11-17T09:00:00Z' })
    const legacy = run({ id: 'run-old', created_at: '2026-11-16T09:00:00Z', quality: null })
    const requests = mountRepositoryPage({
      ...standard,
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run(), older, legacy] } },
      [`GET ${RUNS_URL}/run-0/health`]: { status: 200, data: { ...REPORT, run_id: 'run-0', overall: 52, grade: 'D' } },
    })
    await screen.findByRole('img', { name: 'Overall health 60 out of 100, grade C' })
    const select = screen.getByLabelText('Run')
    expect(within(select).getAllByRole('option').map((o) => o.getAttribute('value'))).toEqual(['run-1', 'run-0'])
    fireEvent.change(select, { target: { value: 'run-0' } })
    expect(await screen.findByRole('img', { name: 'Overall health 52 out of 100, grade D' })).toBeTruthy()
    fireEvent.change(select, { target: { value: 'run-1' } })
    // Already loaded: shown at once from the cache, without a loading state.
    expect(screen.getByRole('img', { name: 'Overall health 60 out of 100, grade C' })).toBeTruthy()
    expect(screen.queryByText('Loading the health score…')).toBeNull()
    expect(requests.some((r) => r.url.includes('run-old'))).toBe(false)
  })
})

const OVERVIEW: HealthOverview = {
  weights: DEFAULTS,
  repositories: [
    { ...point('run-1', '2026-11-18T10:00:00Z', 60, 'C'), project_id: P, project_name: 'Demo project', repository_id: R, repository_name: 'shop' },
  ],
}

type Routes = Parameters<typeof mockApi>[0]

function mountOverview(routes: Routes) {
  const requests = mockApi(routes)
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={['/health-score']}>
        <Routes>
          <Route path="/health-score" element={<HealthPage />} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return requests
}

/** Weights routes backed by one stored value, like the server. */
function weightsRoutes(initial: HealthWeights | null): Routes {
  let stored = initial
  return {
    'GET /health-score': { status: 200, data: OVERVIEW },
    'GET /health-score/weights': () => ({ status: 200, data: { weights: stored ?? DEFAULTS, defaults: stored === null } }),
    'PUT /health-score/weights': (config) => {
      stored = JSON.parse(String(config.data)) as HealthWeights
      return { status: 200, data: { weights: stored, defaults: JSON.stringify(stored) === JSON.stringify(DEFAULTS) } }
    },
    'DELETE /health-score/weights': () => {
      stored = null
      return { status: 204 }
    },
  }
}

const weightInput = (name: string) => within(screen.getByRole('form', { name: 'Health score weights' })).getByLabelText(name) as HTMLInputElement

describe('Health overview', () => {
  it("lists each repository's latest score and opens it", async () => {
    mountOverview(weightsRoutes(null))
    const card = within(await screen.findByRole('list', { name: 'Scored repositories' })).getByRole('listitem')
    expect(within(card).getByRole('img').getAttribute('aria-label')).toBe('Overall health 60 out of 100, grade C')
    const scores = within(card).getByLabelText('shop dimensions')
    const value = (name: string) => within(scores).getByText(name).nextElementSibling?.textContent
    expect(['Security', 'Code quality', 'Complexity', 'Maintainability', 'Dependency health', 'Architecture'].map(value)).toEqual(['36', '63', '97', '59', '—', '60'])
    expect(card.textContent).toContain('Demo project')
    fireEvent.click(within(card).getByRole('link', { name: 'View the health score of shop' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/health`)
  })

  it('invites the user to analyze a repository', async () => {
    mountOverview({ ...weightsRoutes(null), 'GET /health-score': { status: 200, data: { weights: DEFAULTS, repositories: [] } } })
    expect(await screen.findByText('No health scores yet. Upload a repository and run a full analysis.')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Upload a repository' }))
    expect(screen.getByTestId('location').textContent).toBe('/upload')
  })

  it('reports failed requests', async () => {
    mountOverview({
      'GET /health-score': { status: 500, data: { detail: 'Server error' } },
      'GET /health-score/weights': { status: 500, data: { detail: 'Weights failed' } },
    })
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Server error', 'Weights failed'])
  })
})

describe('Health weights', () => {
  it('saves new weights and refreshes the scores', async () => {
    const requests = mountOverview(weightsRoutes(null))
    expect((await screen.findByRole('status')).textContent).toBe('Using the default weights.')
    expect(weightInput('Security').value).toBe('25')
    expect(screen.getByText('25% when all six are scored')).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Save weights' }) as HTMLButtonElement
    expect(save.disabled).toBe(true) // nothing changed
    expect((screen.getByRole('button', { name: 'Reset to defaults' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(weightInput('Security'), { target: { value: '50' } })
    expect(screen.getByText('40% when all six are scored')).toBeTruthy() // 50 / 125
    expect(save.disabled).toBe(false)
    const overviewReads = requests.filter((r) => r.method === 'GET' && r.url === '/health-score').length
    fireEvent.click(save)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Weights saved. Every score now uses them.'))
    const put = requests.find((r) => r.method === 'PUT')
    expect(JSON.parse(String(put?.data))).toEqual({ ...DEFAULTS, security: 50 })
    await waitFor(() => expect(requests.filter((r) => r.method === 'GET' && r.url === '/health-score').length).toBe(overviewReads + 1))
    expect(weightInput('Security').value).toBe('50')
    expect((screen.getByRole('button', { name: 'Save weights' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Reset to defaults' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('checks the weights before saving and undoes changes', async () => {
    const requests = mountOverview(weightsRoutes(null))
    await screen.findByRole('status')
    const save = screen.getByRole('button', { name: 'Save weights' }) as HTMLButtonElement
    fireEvent.change(weightInput('Complexity'), { target: { value: '101' } })
    expect(screen.getByRole('alert').textContent).toBe('Each weight must be a whole number from 0 to 100.')
    expect(weightInput('Complexity').getAttribute('aria-invalid')).toBe('true')
    expect(save.disabled).toBe(true)
    expect(screen.queryByText(/when all six are scored/)).toBeNull()
    for (const value of ['', '2.5', '-1']) {
      fireEvent.change(weightInput('Complexity'), { target: { value } })
      expect(save.disabled).toBe(true)
    }
    for (const name of ['Security', 'Code quality', 'Complexity', 'Maintainability', 'Dependency health', 'Architecture']) {
      fireEvent.change(weightInput(name), { target: { value: '0' } })
    }
    expect(screen.getByRole('alert').textContent).toBe('At least one weight must be above 0.')
    fireEvent.submit(screen.getByRole('form', { name: 'Health score weights' }))
    expect(save.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }))
    expect(weightInput('Security').value).toBe('25')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo changes' })).toBeNull()
    expect(requests.some((r) => r.method === 'PUT')).toBe(false)
  })

  it('resets to the default weights', async () => {
    const custom = { ...DEFAULTS, architecture: 40 }
    const requests = mountOverview(weightsRoutes(custom))
    expect((await screen.findByRole('status')).textContent).toBe('Using your own weights.')
    expect(weightInput('Architecture').value).toBe('40')
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Back to the default weights.'))
    expect(requests.filter((r) => r.method === 'DELETE')).toHaveLength(1)
    expect(weightInput('Architecture').value).toBe('10')
    expect((screen.getByRole('button', { name: 'Reset to defaults' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('reports a save or reset the server refuses', async () => {
    mountOverview({
      ...weightsRoutes({ ...DEFAULTS, architecture: 40 }),
      'PUT /health-score/weights': { status: 422, data: { detail: 'At least one weight must be above 0' } },
      'DELETE /health-score/weights': { status: 500, data: { detail: 'Reset failed' } },
    })
    await screen.findByRole('status')
    fireEvent.change(weightInput('Code quality'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save weights' }))
    expect((await screen.findByRole('alert')).textContent).toBe('At least one weight must be above 0')
    expect(weightInput('Code quality').value).toBe('5') // the draft is kept
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Reset failed']))
    expect(weightInput('Architecture').value).toBe('40')
  })
})

describe('Health navigation', () => {
  it('opens the Health Score from the sidebar and a repository section', async () => {
    setToken('test-token')
    mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
      ...weightsRoutes(null),
      [`GET ${REPO_URL}`]: { status: 200, data: READY },
      ...standard,
    })
    renderWithProviders(<App />, { route: '/overview' })
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]
    fireEvent.click(within(nav).getByRole('link', { name: 'Health Score' }))
    expect(await screen.findByRole('heading', { name: 'Code Health Score' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('link', { name: 'View the health score of shop' }))
    const sections = await screen.findByRole('navigation', { name: 'Repository sections' })
    expect(within(sections).getByRole('link', { name: 'Health score' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('img', { name: 'Overall health 60 out of 100, grade C' })).toBeTruthy()
  })
})
