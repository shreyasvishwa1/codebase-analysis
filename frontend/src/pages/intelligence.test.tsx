import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'

import App from '../App'
import { AnalysisRunsPanel } from '../components/AnalysisRunsPanel'
import { setToken } from '../services/session'
import { mockApi, PROJECT, USER, ZIP_REPOSITORY, type MockResponse } from '../test/mockApi'
import { createTestQueryClient, renderWithProviders } from '../test/render'
import type { AnalysisJob, AnalysisRun, DashboardSummary, Repository } from '../types/api'
import { OverviewPage } from './OverviewPage'
import { UploadPage } from './UploadPage'
import { preloadAllPages } from '../routes/pages'

const P = PROJECT.id
const R = ZIP_REPOSITORY.id
const REPO_URL = `/projects/${P}/repositories/${R}`
const RUNS_URL = `${REPO_URL}/analysis-runs`
const READY: Repository = { ...ZIP_REPOSITORY, status: 'ready' }

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function mount(ui: JSX.Element, path = '/') {
  const queryClient = createTestQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={ui} />
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

const run = (overrides: Partial<AnalysisRun> = {}): AnalysisRun => ({
  id: 'run-1',
  analysis_job_id: 'job-1',
  repository_id: R,
  project_id: P,
  file_count: 12,
  analyzed_file_count: 9,
  excluded_file_count: 2,
  total_bytes: 4096,
  total_lines: 1500,
  code_lines: 1234,
  languages: [
    { language: 'Python', files: 6, lines: 1000, code_lines: 900, bytes: 3000 },
    { language: 'TypeScript', files: 3, lines: 500, code_lines: 334, bytes: 1096 },
  ],
  skipped: { binary: 1, too_large: 0, unavailable: 0, generated: 0 },
  quality: null,
  security: null,
  complexity: null,
  dependencies: null,
  architecture: null,
  chat_index: null,
  created_at: '2026-11-17T10:00:00Z',
  ...overrides,
})

const job = (status: AnalysisJob['status'], extra: Partial<AnalysisJob> = {}): AnalysisJob => ({
  id: 'job-1',
  project_id: P,
  repository_id: R,
  job_type: 'full_analysis',
  status,
  progress: status === 'completed' ? 100 : 0,
  error_message: null,
  created_at: '2026-11-17T10:00:00Z',
  started_at: null,
  completed_at: null,
  ...extra,
})

const SUMMARY: DashboardSummary = {
  projects: 2,
  repositories: 3,
  ready_repositories: 2,
  analyzed_repositories: 2,
  total_runs: 5,
  active_jobs: 1,
  analyzed_files: 40,
  code_lines: 12345,
  languages: [
    { language: 'Python', files: 30, lines: 10000, code_lines: 9000, bytes: 1 },
    { language: 'TSX', files: 10, lines: 4000, code_lines: 3345, bytes: 1 },
  ],
  recent_runs: [
    {
      run_id: 'run-9',
      project_id: P,
      project_name: 'Demo project',
      repository_id: R,
      repository_name: 'backend',
      created_at: '2026-11-17T10:00:00Z',
      file_count: 20,
      code_lines: 4321,
      top_language: 'Python',
    },
  ],
}

// --- Overview --------------------------------------------------------------------------------

const healthEntry = (name: string, overall: number | null, grade: string | null) => ({
  project_id: P,
  project_name: 'Demo project',
  repository_id: `repo-${name}`,
  repository_name: name,
  run_id: `run-${name}`,
  created_at: '2026-11-18T10:00:00Z',
  overall,
  grade,
  scores: {},
})


// Signed-in pages load lazily; compile them once up front so navigation tests do not
// spend their waits on the test environment's on-demand compilation.
beforeAll(() => preloadAllPages(), 120_000)

describe('Overview', () => {
  it('lists each repository’s health score, lowest first', async () => {
    const scores = [
      healthEntry('alpha', 90, 'A'), healthEntry('beta', 42, 'D'), healthEntry('gamma', 71, 'B'),
      healthEntry('delta', 60, 'C'), healthEntry('epsilon', 85, 'A'), healthEntry('zeta', 30, 'F'),
      healthEntry('eta', 55, 'C'), healthEntry('old', null, null),
    ]  // prettier-ignore
    mockApi({
      'GET /dashboard': { status: 200, data: SUMMARY },
      'GET /health-score': { status: 200, data: { weights: {}, repositories: scores } },
    })
    mount(<OverviewPage />)
    const panel = within(await screen.findByRole('region', { name: 'Code health' }))
    await panel.findByText('zeta')
    const links = panel.getAllByRole('link')
    expect(links.slice(0, 6).map((link) => link.textContent)).toEqual([
      'zetaDemo project30F', 'betaDemo project42D', 'etaDemo project55C',
      'deltaDemo project60C', 'gammaDemo project71B', 'epsilonDemo project85A',
    ])  // prettier-ignore
    expect(links[0].getAttribute('href')).toBe(`/projects/${P}/repositories/repo-zeta/health`)
    expect(panel.getByText('62').className).toContain('text-amber-300') // (90+42+71+60+85+30+55) / 7
    expect(links[6].textContent).toBe('All 7 scores')
    expect(links[6].getAttribute('href')).toBe('/health-score')
  })

  it('says when there are no scores, and reports a failed request', async () => {
    mockApi({
      'GET /dashboard': { status: 200, data: SUMMARY },
      'GET /health-score': { status: 200, data: { weights: {}, repositories: [healthEntry('old', null, null)] } },
    })
    mount(<OverviewPage />)
    expect(await screen.findByText('No scores yet: run a full analysis of a repository.')).toBeTruthy()
  })

  it('reports scores that cannot be loaded', async () => {
    mockApi({
      'GET /dashboard': { status: 200, data: SUMMARY },
      'GET /health-score': { status: 500, data: { detail: 'Scores failed' } },
    })
    mount(<OverviewPage />)
    const panel = within(await screen.findByRole('region', { name: 'Code health' }))
    expect((await panel.findByRole('alert')).textContent).toBe('Scores failed')
  })

  it('shows totals, languages and recent analyses from the dashboard API', async () => {
    mockApi({
      'GET /dashboard': { status: 200, data: SUMMARY },
      'GET /health-score': { status: 200, data: { weights: {}, repositories: [] } },
    })
    mount(<OverviewPage />)
    expect(await screen.findByText('12,345')).toBeTruthy()
    const value = (label: string) => screen.getByText(label, { selector: 'p' }).nextElementSibling?.textContent
    expect(value('Projects')).toBe('2')
    expect(value('Repositories')).toBe('3')
    expect(value('Analyzed')).toBe('2')
    expect(value('Analyses')).toBe('5')
    expect(value('Active jobs')).toBe('1')
    const languages = screen.getByRole('region', { name: 'Programming languages' })
    expect(within(languages).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Python72.9%',
      'TSX27.1%',
    ])
    const recent = screen.getByRole('region', { name: 'Recent analyses' })
    const link = within(recent).getByRole('link')
    expect(link.getAttribute('href')).toBe(`${REPO_URL}/analysis`)
    expect(link.textContent).toContain('backend')
    expect(link.textContent).toContain('4,321 lines')
  })

  it('invites a new user to upload a repository', async () => {
    mockApi({
      'GET /dashboard': { status: 200, data: { ...SUMMARY, projects: 0, repositories: 0, recent_runs: [], languages: [] } },
    })
    mount(<OverviewPage />)
    fireEvent.click(await screen.findByRole('link', { name: 'Upload a repository' }))
    expect(screen.getByTestId('location').textContent).toBe('/upload')
  })

  it('reports a failed request', async () => {
    mockApi({ 'GET /dashboard': { status: 500, data: { detail: 'Server error' } } })
    mount(<OverviewPage />)
    expect((await screen.findByRole('alert')).textContent).toBeTruthy()
  })
})

// --- Upload ----------------------------------------------------------------------------------

function zipFile(name = 'repo.zip') {
  return new File(['PK'], name, { type: 'application/zip' })
}

describe('Upload repository', () => {
  it('validates before sending anything', async () => {
    const requests = mockApi({ 'GET /projects': { status: 200, data: [PROJECT] } })
    mount(<UploadPage />, '/upload')
    const submit = await screen.findByRole('button', { name: 'Import repository' })
    await screen.findByRole('option', { name: PROJECT.name })
    fireEvent.click(submit)
    expect((await screen.findByRole('alert')).textContent).toBe('Repository name is required')
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'api' } })
    fireEvent.click(submit)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Choose a ZIP file to upload'))
    fireEvent.change(screen.getByLabelText('ZIP archive'), { target: { files: [zipFile('notes.txt')] } })
    fireEvent.click(submit)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The file must be a .zip archive'))
    fireEvent.click(screen.getByLabelText('Public GitHub repository'))
    fireEvent.change(screen.getByLabelText('GitHub repository URL'), { target: { value: 'https://gitlab.com/a/b' } })
    fireEvent.click(submit)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('https://github.com/owner/repository'))
    expect(requests.filter((r) => r.method !== 'GET')).toHaveLength(0)
  })

  it('creates a new project and repository, uploads the ZIP and opens the repository', async () => {
    const created = { ...PROJECT, id: 'new-project', name: 'Thesis' }
    const requests = mockApi({
      'GET /projects': { status: 200, data: [] },
      'POST /projects': { status: 201, data: created },
      'POST /projects/new-project/repositories': { status: 201, data: { ...ZIP_REPOSITORY, id: 'new-repo', project_id: 'new-project' } },
      'POST /projects/new-project/repositories/new-repo/ingest': { status: 202, data: { job_id: 'j', repository_id: 'new-repo', status: 'pending' } },
    })
    mount(<UploadPage />, '/upload')
    // With no projects yet, "New project" is preselected.
    fireEvent.change(await screen.findByLabelText('New project name'), { target: { value: ' Thesis ' } })
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'backend' } })
    fireEvent.change(screen.getByLabelText('ZIP archive'), { target: { files: [zipFile()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import repository' }))
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/projects/new-project/repositories/new-repo'),
    )
    const writes = requests.filter((r) => r.method === 'POST')
    expect(writes.map((r) => r.url)).toEqual([
      '/projects',
      '/projects/new-project/repositories',
      '/projects/new-project/repositories/new-repo/ingest',
    ])
    expect(JSON.parse(String(writes[0].data))).toEqual({ name: 'Thesis' })
    expect(JSON.parse(String(writes[1].data))).toEqual({ name: 'backend', source_type: 'zip' })
    expect(writes[2].data).toBeInstanceOf(FormData)
  })

  it('imports a public GitHub repository into an existing project', async () => {
    const requests = mockApi({
      'GET /projects': { status: 200, data: [PROJECT] },
      [`POST /projects/${P}/repositories`]: { status: 201, data: { ...ZIP_REPOSITORY, source_type: 'github' } },
      [`POST ${REPO_URL}/ingest`]: { status: 202, data: { job_id: 'j', repository_id: R, status: 'pending' } },
    })
    mount(<UploadPage />, '/upload')
    await screen.findByRole('option', { name: PROJECT.name })
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'flask' } })
    fireEvent.click(screen.getByLabelText('Public GitHub repository'))
    fireEvent.change(screen.getByLabelText('GitHub repository URL'), { target: { value: 'https://github.com/pallets/flask/' } })
    fireEvent.change(screen.getByLabelText('Branch (optional)'), { target: { value: 'main' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import repository' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(REPO_URL))
    const writes = requests.filter((r) => r.method === 'POST')
    expect(JSON.parse(String(writes[0].data))).toEqual({
      name: 'flask',
      source_type: 'github',
      source_url: 'https://github.com/pallets/flask',
      default_branch: 'main',
    })
    expect(writes[1].url).toBe(`${REPO_URL}/ingest`)
    expect(writes[1].data).toBeUndefined()
  })

  it('shows the server error and lets the user try again', async () => {
    mockApi({
      'GET /projects': { status: 200, data: [PROJECT] },
      [`POST /projects/${P}/repositories`]: { status: 422, data: { detail: 'Repository name already exists' } },
    })
    mount(<UploadPage />, '/upload')
    await screen.findByRole('option', { name: PROJECT.name })
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'dup' } })
    fireEvent.change(screen.getByLabelText('ZIP archive'), { target: { files: [zipFile()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import repository' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Repository name already exists')
    expect((screen.getByRole('button', { name: 'Import repository' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByTestId('location').textContent).toBe('/upload')
  })
})

// --- Full analysis panel ---------------------------------------------------------------------

function panel(repository: Repository = READY) {
  return renderWithProviders(
    <AnalysisRunsPanel projectId={P} repositoryId={R} repository={repository} pollIntervalMs={20} />,
  )
}

describe('Full analysis panel', () => {
  it('runs an analysis, shows progress and then the new run', async () => {
    let state: { job: AnalysisJob | null; runs: AnalysisRun[] } = { job: null, runs: [] }
    let polls = 0
    const requests = mockApi({
      [`GET ${RUNS_URL}`]: () => {
        polls += 1
        if (state.job?.status === 'processing' && polls > 3) {
          state = { job: job('completed'), runs: [run()] }
        }
        return { status: 200, data: state } as MockResponse
      },
      [`POST ${RUNS_URL}`]: () => {
        state = { job: job('processing'), runs: [] }
        polls = 0
        return { status: 202, data: { job_id: 'job-1', repository_id: R, status: 'pending' } }
      },
    })
    panel()
    expect((await screen.findByText(/No analysis yet/)).textContent).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Run full analysis' }))
    expect((await screen.findByRole('status')).textContent).toBe('Analysis in progress…')
    expect((screen.getByRole('button', { name: 'Analyzing…' }) as HTMLButtonElement).disabled).toBe(true)
    const summary = await screen.findByRole('region', { name: 'Run summary' })
    expect(summary.textContent).toContain('1,234')
    expect(within(summary).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Python900 lines · 6 files',
      'TypeScript334 lines · 3 files',
    ])
    expect(summary.textContent).toContain('Skipped: 1 binary.')
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1)
  })

  it('switches between runs in the history', async () => {
    const older = run({ id: 'run-0', code_lines: 50, analyzed_file_count: 2, created_at: '2026-11-10T10:00:00Z' })
    mockApi({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: job('completed'), runs: [run(), older] } } })
    panel()
    const history = await screen.findByRole('list', { name: 'Analysis history' })
    const [newest, oldest] = within(history).getAllByRole('button')
    expect(newest.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(oldest)
    expect(oldest.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('region', { name: 'Run summary' }).textContent).toContain('2 files')
  })

  it('uses singular words for one file or line', async () => {
    const tiny = run({
      file_count: 1,
      analyzed_file_count: 1,
      code_lines: 1,
      languages: [{ language: 'Go', files: 1, lines: 1, code_lines: 1, bytes: 10 }],
    })
    mockApi({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: job('completed'), runs: [tiny] } } })
    panel()
    const summary = await screen.findByRole('region', { name: 'Run summary' })
    expect(within(summary).getByRole('listitem').textContent).toBe('Go1 line · 1 file')
    expect(summary.textContent).toContain('· 1 file ·')
  })

  it('explains a failed analysis and an unready repository', async () => {
    mockApi({
      [`GET ${RUNS_URL}`]: {
        status: 200,
        data: { job: job('failed', { error_message: 'Repository changed during analysis; run it again' }), runs: [] },
      },
    })
    panel({ ...READY, status: 'pending' })
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The last analysis failed: Repository changed during analysis; run it again',
    )
    expect(screen.getByText('Ingest the repository before running an analysis.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Run full analysis' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows why an analysis could not start', async () => {
    mockApi({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [] } },
      [`POST ${RUNS_URL}`]: { status: 409, data: { detail: 'A full analysis is already in progress' } },
    })
    panel()
    fireEvent.click(await screen.findByRole('button', { name: 'Run full analysis' }))
    expect((await screen.findByRole('alert')).textContent).toBe('A full analysis is already in progress')
  })
})

// --- Navigation ------------------------------------------------------------------------------

describe('Navigation', () => {
  it('opens the overview from the root and moves between sections', async () => {
    setToken('test-token')
    mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
      'GET /dashboard': { status: 200, data: SUMMARY },
      'GET /projects': { status: 200, data: [PROJECT] },
    })
    renderWithProviders(<App />, { route: '/' })
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy()
    const nav = screen.getAllByRole('navigation', { name: 'Main navigation' })[0]
    fireEvent.click(within(nav).getByRole('link', { name: 'Upload Repository' }))
    expect(await screen.findByRole('heading', { name: 'Upload repository' })).toBeTruthy()
    fireEvent.click(within(nav).getByRole('link', { name: 'My Projects' }))
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeTruthy()
  })

  it('links a repository to its full analysis page', async () => {
    setToken('test-token')
    mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
      [`GET ${REPO_URL}`]: { status: 200, data: READY },
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [] } },
    })
    renderWithProviders(<App />, { route: `${REPO_URL}/analysis` })
    expect(await screen.findByRole('heading', { name: READY.name })).toBeTruthy()
    const sections = screen.getByRole('navigation', { name: 'Repository sections' })
    expect(within(sections).getByRole('link', { name: 'Full analysis' }).getAttribute('aria-current')).toBe('page')
    expect(within(sections).getByRole('link', { name: 'Explorer' }).getAttribute('href')).toBe(REPO_URL)
    expect(await screen.findByRole('button', { name: 'Run full analysis' })).toBeTruthy()
  })
})
