import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from '../App'
import { componentOf, layout, shortName } from '../components/ArchitectureDiagram'
import { setToken } from '../services/session'
import { mockApi, PROJECT, USER, ZIP_REPOSITORY, type MockResponse } from '../test/mockApi'
import { createTestQueryClient, renderWithProviders } from '../test/render'
import type {
  AnalysisRun,
  ArchitectureComponent,
  ArchitectureDocument,
  ArchitectureOverview,
  ArchitectureSummary,
  Repository,
} from '../types/api'
import { ArchitecturePage } from './ArchitecturePage'
import { RepositoryArchitecturePage } from './RepositoryArchitecturePage'

const P = PROJECT.id
const R = ZIP_REPOSITORY.id
const REPO_URL = `/projects/${P}/repositories/${R}`
const RUNS_URL = `${REPO_URL}/analysis-runs`
const ARCH_URL = `${RUNS_URL}/run-1/architecture`
const READY: Repository = { ...ZIP_REPOSITORY, status: 'ready' }

const component = (id: string, role: ArchitectureComponent['role'], extra: Partial<ArchitectureComponent> = {}): ArchitectureComponent => ({
  id,
  files: 2,
  code_lines: 40,
  languages: ['Python'],
  role,
  roles: [role],
  evidence: { [role]: [{ path: `${id}/a.py`, line: 3, detail: `${role} evidence` }] },
  depends_on: 0,
  used_by: 0,
  ...extra,
})

const DOCUMENT: ArchitectureDocument = {
  depth: 3,
  components: [
    component('backend/app/api', 'api', { depends_on: 1, used_by: 1 }),
    component('backend/app/services', 'core', { depends_on: 2, used_by: 2 }),
    component('backend/app/models', 'data', { used_by: 1 }),
    component('backend/tests', 'test', { depends_on: 1 }),
    component('frontend/src', 'ui', { languages: ['TSX'] }),
  ],
  edges: [
    { source: 'backend/app/api', target: 'backend/app/services', imports: 6, examples: [{ path: 'backend/app/api/routes.py', line: 2, detail: 'imports backend/app/services/orders.py' }] },
    { source: 'backend/app/services', target: 'backend/app/api', imports: 1, examples: [] },
    { source: 'backend/app/services', target: 'backend/app/models', imports: 3, examples: [] },
    { source: 'backend/tests', target: 'backend/app/services', imports: 4, examples: [] },
  ],
  cycles: [['backend/app/api', 'backend/app/services']],
  technologies: [
    { name: 'FastAPI', category: 'backend', ecosystem: 'python', evidence: [{ path: 'backend/requirements.txt', line: 1, detail: 'Declares fastapi ==0.110.0' }] },
    { name: 'React', category: 'frontend', ecosystem: 'npm', evidence: [{ path: 'frontend/package.json', line: 6, detail: 'Declares react ^18.3.1' }] },
    { name: 'SQLAlchemy', category: 'orm', ecosystem: 'python', evidence: [] },
  ],
  data_stores: [{ name: 'PostgreSQL', evidence: [{ path: 'backend/app/models/order.py', line: 1, detail: 'Imports psycopg2' }, { path: 'docker-compose.yml', line: 1, detail: 'Compose service db (postgres:16)' }] }],
  routes: [
    { method: 'GET', path: '/orders', file: 'backend/app/api/routes.py', line: 11, framework: 'Python' },
    { method: 'POST', path: '/orders/{id}/pay', file: 'backend/app/api/routes.py', line: 16, framework: 'Python' },
    ...Array.from({ length: 30 }, (_, n) => ({ method: 'GET', path: `/items/${n}`, file: 'backend/app/api/items.py', line: n + 1, framework: 'Python' })),
  ],
  entry_points: [{ kind: 'web application', path: 'backend/app/main.py', line: 4, detail: 'FastAPI application' }],
  infrastructure: [
    { kind: 'container image', path: 'backend/Dockerfile', line: 1, detail: 'Base image python:3.12-slim' },
    { kind: 'ci', path: '.github/workflows/ci.yml', line: 1, detail: 'GitHub Actions workflow: CI' },
  ],
  services: [
    { name: 'api', file: 'docker-compose.yml', image: null, build: true, ports: ['8000:8000'], depends_on: ['db'], data_store: null },
    { name: 'db', file: 'docker-compose.yml', image: 'postgres:16', build: false, ports: [], depends_on: [], data_store: 'PostgreSQL' },
  ],
  observations: [
    { title: 'Circular dependency', detail: '2 components import each other in a cycle: backend/app/api, backend/app/services.', evidence: [{ path: 'backend/app/api/routes.py', line: 2, detail: 'imports backend/app/services/orders.py' }] },
    { title: 'No automated tests found', detail: 'No test files were found.', evidence: [] },
  ],
  truncated: { edges: false, routes: false, entry_points: false, infrastructure: false },
}

const SUMMARY: ArchitectureSummary = {
  source_files: 10, components: 5, edges: 4, imports: 14, routes: 32, entry_points: 1,
  technologies: ['FastAPI', 'React', 'SQLAlchemy'], data_stores: ['PostgreSQL'],
  infrastructure: 2, services: 2, cycles: 1, observations: 2,
}  // prettier-ignore

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
  quality: null,
  security: null,
  complexity: null,
  dependencies: null,
  architecture: SUMMARY,
  created_at: '2026-11-18T10:00:00Z',
  ...overrides,
})

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function mountRepositoryPage(routes: Record<string, MockResponse>) {
  const requests = mockApi({ [`GET ${REPO_URL}`]: { status: 200, data: READY }, ...routes })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[`${REPO_URL}/architecture`]}>
        <Routes>
          <Route path="/projects/:projectId/repositories/:repositoryId/architecture" element={<RepositoryArchitecturePage />} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return requests
}

const standard = {
  [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
  [`GET ${ARCH_URL}`]: { status: 200, data: { run_id: 'run-1', created_at: '2026-11-18T10:00:00Z', document: DOCUMENT } },
}

describe('Diagram layout', () => {
  it('places components in role columns, wraps tall columns and links data stores', () => {
    const { nodes, links } = layout(DOCUMENT, new Set())
    const x = (id: string) => nodes.find((n) => n.id === id)?.x
    // Columns: tests, interface, API, core, data, data stores.
    expect([x('backend/tests'), x('frontend/src'), x('backend/app/api'), x('backend/app/services'), x('backend/app/models'), x('store:PostgreSQL')]).toEqual([24, 260, 496, 732, 968, 1204])
    const mutual = links.filter((l) => l.mutual).map((l) => `${l.source}->${l.target}`)
    expect(mutual).toEqual(['backend/app/api->backend/app/services', 'backend/app/services->backend/app/api'])
    const stores = links.filter((l) => l.store)
    expect(stores.map((l) => `${l.source}->${l.target}`)).toEqual(['backend/app/models->store:PostgreSQL']) // docker-compose.yml is in no component
    const many: ArchitectureDocument = {
      ...DOCUMENT,
      components: Array.from({ length: 9 }, (_, n) => component(`pkg/m${n}`, 'core')),
      edges: [],
      data_stores: [],
    }
    const wrapped = layout(many, new Set())
    expect(new Set(wrapped.nodes.map((n) => n.x))).toEqual(new Set([24, 260])) // 7 + 2
    expect(Math.max(...wrapped.nodes.map((n) => n.y))).toBe(24 + 6 * 62)
  })

  it('hides roles with their edges', () => {
    const { nodes, links } = layout(DOCUMENT, new Set(['test', 'core']))
    expect(nodes.map((n) => n.id).sort()).toEqual(['backend/app/api', 'backend/app/models', 'frontend/src', 'store:PostgreSQL'])
    expect(links.filter((l) => !l.store)).toEqual([])
  })

  it('names components and maps files to them', () => {
    expect(shortName('backend/app/services')).toBe('app/services')
    expect(shortName('a/very-long-directory-name/another-very-long-name')).toBe('…/another-very-long-name') // 24 characters
    const ids = ['(root)', 'backend', 'backend/app']
    expect(componentOf('backend/app/x.py', ids)).toBe('backend/app')
    expect(componentOf('backend/tools/y.py', ids)).toBe('backend')
    expect(componentOf('setup.py', ids)).toBe('(root)')
    expect(componentOf('frontend/z.ts', ['backend'])).toBeNull()
  })
})

describe('Repository architecture', () => {
  it('shows the summary, the diagram and the evidence lists', async () => {
    mountRepositoryPage(standard)
    const summary = await screen.findByLabelText('Architecture summary')
    const value = (label: string) => within(summary).getByText(label).nextElementSibling?.textContent
    expect([value('Components'), value('Connections'), value('API routes'), value('Entry points'), value('Technologies'), value('Data stores')]).toEqual(['5', '4', '32', '1', '3', '1'])
    expect(screen.getByText(/shown 3 levels deep\); connections are 14 imports/)).toBeTruthy()

    const diagram = screen.getByRole('region', { name: 'Architecture diagram' })
    expect(within(diagram).getByRole('img').getAttribute('aria-label')).toBe('Diagram of 6 components and data stores with 5 connections')
    expect(within(diagram).getByRole('button', { name: 'backend/app/api: API, 2 files' })).toBeTruthy()
    expect(within(diagram).getByRole('button', { name: 'PostgreSQL data store' })).toBeTruthy()
    expect(diagram.querySelectorAll('[data-edge]')).toHaveLength(5)

    const observations = within(screen.getByRole('region', { name: 'Observations' }))
    expect(observations.getByText('Circular dependency')).toBeTruthy()
    expect(observations.getByRole('link', { name: 'backend/app/api/routes.py:2' })).toBeTruthy()
    const technologies = within(screen.getByRole('region', { name: 'Technologies' }))
    expect(technologies.getByText('Backend')).toBeTruthy()
    expect(technologies.getByText('ORM and migrations')).toBeTruthy()
    expect(technologies.getByRole('link', { name: 'frontend/package.json:6' })).toBeTruthy()
    const entry = within(screen.getByRole('region', { name: 'Entry points' }))
    expect(entry.getByText('FastAPI application')).toBeTruthy()
    const infrastructure = within(screen.getByRole('region', { name: 'Infrastructure' }))
    expect(infrastructure.getByText('GitHub Actions workflow: CI')).toBeTruthy()
    const services = within(infrastructure.getByRole('list', { name: 'Docker Compose services' }))
    expect(services.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'api: built from source · ports 8000:8000 · depends on db',
      'db: postgres:16 (PostgreSQL)',
    ])
  })

  it('selects a component to show its evidence and connections, then a data store', async () => {
    mountRepositoryPage(standard)
    expect(await screen.findByText(/Select a component or data store/)).toBeTruthy()
    const node = await screen.findByRole('button', { name: 'backend/app/services: Core logic, 2 files' })
    fireEvent.click(node)
    expect(node.getAttribute('aria-pressed')).toBe('true')
    const details = within(screen.getByRole('complementary', { name: 'Details of backend/app/services' }))
    expect(details.getByText('Core logic · 2 files · 40 lines of code · Python')).toBeTruthy()
    expect(within(details.getByRole('list', { name: 'Components backend/app/services imports' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'backend/app/api (1)',
      'backend/app/models (3)',
    ])
    expect(within(details.getByRole('list', { name: 'Components importing backend/app/services' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'backend/app/api (6)',
      'backend/tests (4)',
    ])
    // Unconnected components are dimmed.
    expect(screen.getByRole('button', { name: 'frontend/src: User interface, 2 files' }).getAttribute('opacity')).toBe('0.3')
    fireEvent.click(node)
    expect(screen.queryByRole('complementary')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'PostgreSQL data store' }))
    const store = within(screen.getByRole('complementary', { name: 'Details of PostgreSQL' }))
    expect(store.getByText(/Compose service db/)).toBeTruthy()
    fireEvent.click(store.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('complementary')).toBeNull()

    fireEvent.keyDown(screen.getByRole('button', { name: 'backend/app/api: API, 2 files' }), { key: 'Enter' })
    const api = within(screen.getByRole('complementary', { name: 'Details of backend/app/api' }))
    expect(api.getByText(/api evidence/)).toBeTruthy()
    fireEvent.click(api.getByRole('link', { name: 'backend/app/api/routes.py:2' }))
    expect(screen.getByTestId('location').textContent).toBe(REPO_URL)
  })

  it('filters roles and zooms', async () => {
    mountRepositoryPage(standard)
    const diagram = within(await screen.findByRole('region', { name: 'Architecture diagram' }))
    fireEvent.click(diagram.getByRole('button', { name: 'backend/tests: Tests, 2 files' }))
    const tests = diagram.getByRole('button', { name: 'Tests', pressed: true })
    fireEvent.click(tests)
    expect(tests.getAttribute('aria-pressed')).toBe('false')
    expect(diagram.queryByRole('button', { name: 'backend/tests: Tests, 2 files' })).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull() // the selected component was hidden
    fireEvent.click(tests)
    expect(diagram.getByRole('button', { name: 'backend/tests: Tests, 2 files' })).toBeTruthy()

    const svg = diagram.getByRole('img')
    const width = Number(svg.getAttribute('width'))
    fireEvent.click(diagram.getByRole('button', { name: 'Zoom in' }))
    expect(Number(svg.getAttribute('width'))).toBeCloseTo(width * 1.25)
    fireEvent.click(diagram.getByRole('button', { name: 'Reset zoom' }))
    fireEvent.click(diagram.getByRole('button', { name: 'Zoom out' }))
    expect(Number(svg.getAttribute('width'))).toBeCloseTo(width * 0.8)
  })

  it('filters the API routes and shows more', async () => {
    mountRepositoryPage(standard)
    const routes = within(await screen.findByRole('region', { name: 'API routes' }))
    expect(routes.getByRole('status').textContent).toBe('32 routes')
    expect(routes.getAllByRole('listitem')).toHaveLength(25)
    fireEvent.click(routes.getByRole('button', { name: 'Show more routes' }))
    expect(routes.getAllByRole('listitem')).toHaveLength(32)
    fireEvent.change(routes.getByLabelText('Method'), { target: { value: 'POST' } })
    expect(routes.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['POST/orders/{id}/paybackend/app/api/routes.py:16'])
    fireEvent.change(routes.getByLabelText('Method'), { target: { value: '' } })
    fireEvent.change(routes.getByLabelText('Filter routes'), { target: { value: 'ITEMS/1' } })
    expect(routes.getByRole('status').textContent).toBe('11 routes') // items/1, items/10-19
  })

  it('says when there are no source components', async () => {
    mountRepositoryPage({
      ...standard,
      [`GET ${ARCH_URL}`]: { status: 200, data: { run_id: 'run-1', created_at: '2026-11-18T10:00:00Z', document: { ...DOCUMENT, components: [], edges: [] } } },
    })
    expect(await screen.findByText(/No Python, JavaScript or TypeScript source files were found/)).toBeTruthy()
  })

  it('links to the full analysis when there is no run yet', async () => {
    mountRepositoryPage({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [] } } })
    fireEvent.click(await screen.findByRole('link', { name: 'Run a full analysis' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/analysis`)
  })

  it('asks for a new run when the latest predates architecture analysis', async () => {
    const requests = mountRepositoryPage({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run({ architecture: null })] } } })
    expect(await screen.findByRole('link', { name: 'Run a new full analysis' })).toBeTruthy()
    expect(requests.some((r) => r.url.endsWith('/architecture'))).toBe(false)
  })

  it('reports a report that cannot be loaded', async () => {
    mountRepositoryPage({ ...standard, [`GET ${ARCH_URL}`]: { status: 404, data: { detail: 'This run has no architecture report' } } })
    expect((await screen.findByRole('alert')).textContent).toContain('This run has no architecture report')
  })

  it('switches runs', async () => {
    const older = run({ id: 'run-0', created_at: '2026-11-17T09:00:00Z' })
    mountRepositoryPage({
      ...standard,
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run(), older] } },
      [`GET ${RUNS_URL}/run-0/architecture`]: {
        status: 200,
        data: { run_id: 'run-0', created_at: '2026-11-17T09:00:00Z', document: { ...DOCUMENT, components: [component('old/pkg', 'core')], edges: [], data_stores: [] } },
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'backend/app/api: API, 2 files' }))
    expect(screen.getByRole('complementary', { name: 'Details of backend/app/api' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Run'), { target: { value: 'run-0' } })
    expect(await screen.findByRole('button', { name: 'old/pkg: Core logic, 2 files' })).toBeTruthy()
    expect(screen.queryByRole('complementary')).toBeNull() // a new run starts with no selection
    // Back to the first run (already loaded): a selection made in the other run does not carry over.
    fireEvent.click(screen.getByRole('button', { name: 'old/pkg: Core logic, 2 files' }))
    fireEvent.change(screen.getByLabelText('Run'), { target: { value: 'run-1' } })
    const api = await screen.findByRole('button', { name: 'backend/app/api: API, 2 files' })
    expect(api.getAttribute('opacity')).toBe('1')
    expect(api.getAttribute('aria-pressed')).toBe('false')
  })
})

const OVERVIEW: ArchitectureOverview = {
  repositories: [
    {
      project_id: P,
      project_name: 'Demo project',
      repository_id: R,
      repository_name: 'shop',
      run_id: 'run-1',
      created_at: '2026-11-18T10:00:00Z',
      analyzed_file_count: 10,
      code_lines: 300,
      architecture: { ...SUMMARY, technologies: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] },
    },
  ],
}

describe('Architecture overview', () => {
  function mountOverview() {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={['/architecture']}>
          <Routes>
            <Route path="/architecture" element={<ArchitecturePage />} />
            <Route path="*" element={<Location />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it("lists each repository's latest results and opens its diagram", async () => {
    mockApi({ 'GET /architecture': { status: 200, data: OVERVIEW } })
    mountOverview()
    const card = within(await screen.findByRole('list', { name: 'Mapped repositories' })).getByRole('listitem')
    expect(within(card).getByText('Components').nextElementSibling?.textContent).toBe('5')
    expect(within(card).getByText('API routes').nextElementSibling?.textContent).toBe('32')
    expect(within(card).getByText('Cycles').nextElementSibling?.textContent).toBe('1')
    expect(within(card).getByLabelText('Technologies').textContent).toBe('ABCDEFGH+2 more')
    fireEvent.click(within(card).getByRole('link', { name: 'View the architecture of shop' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/architecture`)
  })

  it('invites the user to analyze a repository', async () => {
    mockApi({ 'GET /architecture': { status: 200, data: { repositories: [] } } })
    mountOverview()
    fireEvent.click(await screen.findByRole('link', { name: 'Upload a repository' }))
    expect(screen.getByTestId('location').textContent).toBe('/upload')
  })

  it('reports a failed request', async () => {
    mockApi({ 'GET /architecture': { status: 500, data: { detail: 'Server error' } } })
    mountOverview()
    expect((await screen.findByRole('alert')).textContent).toContain('Server error')
  })
})

describe('Architecture navigation', () => {
  it('opens Architecture from the sidebar and a repository section', async () => {
    setToken('test-token')
    mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
      'GET /architecture': { status: 200, data: OVERVIEW },
      [`GET ${REPO_URL}`]: { status: 200, data: READY },
      ...standard,
    })
    renderWithProviders(<App />, { route: '/overview' })
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]
    fireEvent.click(within(nav).getByRole('link', { name: 'Architecture' }))
    expect(await screen.findByRole('heading', { name: 'Architecture' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('link', { name: 'View the architecture of shop' }))
    const sections = await screen.findByRole('navigation', { name: 'Repository sections' })
    expect(within(sections).getByRole('link', { name: 'Architecture' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('button', { name: 'backend/app/api: API, 2 files' })).toBeTruthy()
  })
})
