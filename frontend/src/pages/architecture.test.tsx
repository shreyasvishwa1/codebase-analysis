import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'

import App from '../App'
import { componentOf, shortName } from '../components/ArchitectureDiagram'
import { curveBetween, cyclic, defaultFocus, LANES, neighbours } from '../components/ArchitectureViews'
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
import { preloadAllPages } from '../routes/pages'

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
  chat_index: null,
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


// Signed-in pages load lazily; compile them once up front so navigation tests do not
// spend their waits on the test environment's on-demand compilation.
beforeAll(() => preloadAllPages(), 120_000)

describe('Architecture views', () => {
  it('finds what a component uses, what uses it and the data stores it touches', () => {
    expect(neighbours(DOCUMENT, 'backend/app/services')).toEqual({
      uses: [
        { id: 'backend/app/models', imports: 3, mutual: false },
        { id: 'backend/app/api', imports: 1, mutual: true },
      ],
      usedBy: [
        { id: 'backend/app/api', imports: 6, mutual: true },
        { id: 'backend/tests', imports: 4, mutual: false },
      ],
      stores: [],
    })
    expect(neighbours(DOCUMENT, 'backend/app/models').stores).toEqual(['PostgreSQL']) // docker-compose.yml is in no component
    expect(neighbours(DOCUMENT, 'frontend/src')).toEqual({ uses: [], usedBy: [], stores: [] })
    expect([...cyclic(DOCUMENT)].sort()).toEqual(['backend/app/api', 'backend/app/services'])
  })

  it('focuses first on the most connected component, then the largest', () => {
    expect(defaultFocus(DOCUMENT)).toBe('backend/app/services')
    const tie: ArchitectureDocument = { ...DOCUMENT, components: [component('a', 'core', { code_lines: 10 }), component('b', 'core', { code_lines: 90 })] }
    expect(defaultFocus(tie)).toBe('b')
    expect(defaultFocus({ ...DOCUMENT, components: [] })).toBeNull()
  })

  it('orders the lanes from the interface down to the data, tests last', () => {
    expect(LANES.map((lane) => lane.key)).toEqual(['ui', 'api', 'worker', 'core', 'data', 'test'])
    const roles = LANES.flatMap((lane) => lane.roles).sort()
    expect(roles).toEqual(['api', 'auth', 'config', 'core', 'data', 'test', 'ui', 'worker'])
  })

  it('draws curves between edges: top to bottom across lanes, side to side within one', () => {
    const down = curveBetween({ x: 0, y: 0, width: 100, height: 40 }, { x: 200, y: 100, width: 100, height: 40 })
    expect(down.d).toBe('M50,40 C50,70 250,70 250,100')
    expect(down.label).toEqual({ x: 150, y: 70 })
    const up = curveBetween({ x: 200, y: 100, width: 100, height: 40 }, { x: 0, y: 0, width: 100, height: 40 })
    expect(up.d).toBe('M250,100 C250,70 50,70 50,40')
    const side = curveBetween({ x: 0, y: 0, width: 100, height: 40 }, { x: 300, y: 10, width: 100, height: 40 })
    expect(side.d).toBe('M100,20 C200,20 200,30 300,30')
    const back = curveBetween({ x: 300, y: 0, width: 100, height: 40 }, { x: 0, y: 0, width: 100, height: 40 })
    expect(back.d).toBe('M300,20 C200,20 200,20 100,20')
    // Sideways always joins the facing sides, even far above or below (the focus map's columns).
    const far = curveBetween({ x: 300, y: 300, width: 100, height: 40 }, { x: 0, y: 0, width: 100, height: 40 }, 'sideways')
    expect(far.d).toBe('M300,320 C200,320 200,20 100,20')
    expect(far.label).toEqual({ x: 200, y: 170 })
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

    const lanes = screen.getByRole('region', { name: 'Layer lanes' })
    expect(within(lanes).getAllByRole('group', { name: / lane$/ }).map((lane) => lane.getAttribute('aria-label'))).toEqual([
      'User interface lane',
      'API and authentication lane',
      'Core logic and configuration lane',
      'Data access lane',
      'Tests lane',
      'Data stores lane',
    ])
    expect(within(lanes).getByRole('button', { name: 'backend/app/api: API, 2 files' }).textContent).toContain('in an import cycle')
    expect(within(lanes).getByRole('button', { name: 'PostgreSQL data store' })).toBeTruthy()
    expect(lanes.querySelectorAll('[data-edge]')).toHaveLength(0) // no lines until something is pointed at
    fireEvent.mouseEnter(within(lanes).getByRole('button', { name: 'backend/app/services: Core logic, 2 files' }))
    expect([...lanes.querySelectorAll('[data-edge]')].map((edge) => edge.getAttribute('data-edge')).sort()).toEqual([
      'backend/app/api->backend/app/services',
      'backend/app/services->backend/app/api',
      'backend/app/services->backend/app/models',
      'backend/tests->backend/app/services',
    ])
    expect(within(lanes).getByRole('button', { name: 'frontend/src: User interface, 2 files' }).getAttribute('data-dimmed')).toBe('true')
    expect(within(lanes).getByRole('button', { name: 'backend/tests: Tests, 2 files' }).getAttribute('data-dimmed')).toBe('false')
    fireEvent.mouseEnter(within(lanes).getByRole('button', { name: 'PostgreSQL data store' }))
    expect([...lanes.querySelectorAll('[data-edge]')].map((edge) => edge.getAttribute('data-edge'))).toEqual(['backend/app/models->store:PostgreSQL'])
    fireEvent.mouseLeave(within(lanes).getByRole('group', { name: 'Tests lane' }).parentElement!)
    expect(lanes.querySelectorAll('[data-edge]')).toHaveLength(0)

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
    expect(screen.getByRole('button', { name: 'frontend/src: User interface, 2 files' }).getAttribute('data-dimmed')).toBe('true')
    fireEvent.click(node)
    expect(screen.queryByRole('complementary')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'PostgreSQL data store' }))
    const store = within(screen.getByRole('complementary', { name: 'Details of PostgreSQL' }))
    expect(store.getByText(/Compose service db/)).toBeTruthy()
    fireEvent.click(store.getByRole('button', { name: 'Close details' }))
    expect(screen.queryByRole('complementary')).toBeNull()

    // Components are real buttons, so the keyboard activates them like any button.
    fireEvent.click(screen.getByRole('button', { name: 'backend/app/api: API, 2 files' }))
    const api = within(screen.getByRole('complementary', { name: 'Details of backend/app/api' }))
    expect(api.getByText(/api evidence/)).toBeTruthy()
    fireEvent.click(api.getByRole('link', { name: 'backend/app/api/routes.py:2' }))
    expect(screen.getByTestId('location').textContent).toBe(REPO_URL)
  })

  it('filters roles and finds components by name', async () => {
    mountRepositoryPage(standard)
    const lanes = within(await screen.findByRole('region', { name: 'Layer lanes' }))
    fireEvent.click(lanes.getByRole('button', { name: 'backend/tests: Tests, 2 files' }))
    const tests = lanes.getByRole('button', { name: 'Tests', pressed: true })
    fireEvent.click(tests)
    expect(tests.getAttribute('aria-pressed')).toBe('false')
    expect(lanes.queryByRole('button', { name: 'backend/tests: Tests, 2 files' })).toBeNull()
    expect(lanes.queryByRole('group', { name: 'Tests lane' })).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull() // the selected component was hidden
    fireEvent.click(tests)
    expect(lanes.getByRole('button', { name: 'backend/tests: Tests, 2 files' })).toBeTruthy()

    fireEvent.change(lanes.getByRole('textbox', { name: 'Find a component' }), { target: { value: 'MODELS' } })
    expect(lanes.getByRole('button', { name: 'backend/app/models: Data access, 2 files' }).getAttribute('data-dimmed')).toBe('false')
    expect(lanes.getByRole('button', { name: 'backend/app/api: API, 2 files' }).getAttribute('data-dimmed')).toBe('true')
    expect(lanes.getByRole('button', { name: 'PostgreSQL data store' }).getAttribute('data-dimmed')).toBe('true')
    fireEvent.change(lanes.getByRole('textbox', { name: 'Find a component' }), { target: { value: 'postgres' } })
    expect(lanes.getByRole('button', { name: 'PostgreSQL data store' }).getAttribute('data-dimmed')).toBe('false')
  })

  it('finds components whatever the case of their name', async () => {
    mountRepositoryPage({
      ...standard,
      [`GET ${ARCH_URL}`]: {
        status: 200,
        data: { run_id: 'run-1', created_at: '2026-11-18T10:00:00Z', document: { ...DOCUMENT, components: [...DOCUMENT.components, component('web/Widgets', 'ui')] } },
      },
    })
    const lanes = within(await screen.findByRole('region', { name: 'Layer lanes' }))
    fireEvent.change(lanes.getByRole('textbox', { name: 'Find a component' }), { target: { value: 'widgets' } })
    expect(lanes.getByRole('button', { name: 'web/Widgets: User interface, 2 files' }).getAttribute('data-dimmed')).toBe('false')
    expect(lanes.getByRole('button', { name: 'frontend/src: User interface, 2 files' }).getAttribute('data-dimmed')).toBe('true')
  })

  it('focuses on one component at a time and moves the focus', async () => {
    mountRepositoryPage(standard)
    fireEvent.click(await screen.findByRole('button', { name: 'Focus map' }))
    const map = within(screen.getByRole('region', { name: 'Focus map' }))
    // The most connected component first.
    expect(map.getByRole('heading', { name: 'backend/app/services' })).toBeTruthy()
    expect(within(map.getByRole('list', { name: 'Components backend/app/services uses' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Focus on backend/app/models (3 imports)',
      'Focus on backend/app/api (1 import)',
    ])
    expect(within(map.getByRole('list', { name: 'Components using backend/app/services' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Focus on backend/app/api (6 imports)',
      'Focus on backend/tests (4 imports)',
    ])
    expect(map.getByRole('button', { name: 'Focus on backend/app/api (1 import)' }).textContent).toContain('imports each other')
    const back = map.getByRole('button', { name: 'Back' }) as HTMLButtonElement
    expect(back.disabled).toBe(true)

    fireEvent.click(map.getByRole('button', { name: 'Focus on backend/app/models (3 imports)' }))
    expect(map.getByRole('heading', { name: 'backend/app/models' })).toBeTruthy()
    expect(map.getByText('PostgreSQL')).toBeTruthy() // the data store it uses
    expect(map.getByText('Imports no other component.')).toBeTruthy()
    expect(screen.getByRole('complementary', { name: 'Details of backend/app/models' })).toBeTruthy() // moving the focus selects it
    const trail = within(map.getByRole('navigation', { name: 'Focus trail' }))
    expect(trail.getByText('app/models').getAttribute('aria-current')).toBe('location')
    expect(back.disabled).toBe(false)
    fireEvent.click(back)
    expect(map.getByRole('heading', { name: 'backend/app/services' })).toBeTruthy()

    fireEvent.change(map.getByRole('combobox', { name: 'Focus on a component' }), { target: { value: 'frontend/src' } })
    expect(map.getByRole('heading', { name: 'frontend/src' })).toBeTruthy()
    expect(map.getByText('No other component imports it.')).toBeTruthy()
    fireEvent.click(within(map.getByRole('navigation', { name: 'Focus trail' })).getByRole('button', { name: 'app/services' }))
    expect(map.getByRole('heading', { name: 'backend/app/services' })).toBeTruthy()
    fireEvent.click(map.getByRole('button', { name: 'Show evidence' }))
    expect(screen.getByRole('complementary', { name: 'Details of backend/app/services' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Layer lanes' }))
    expect(screen.getByRole('button', { name: 'backend/app/services: Core logic, 2 files' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens the focus map on the selected component', async () => {
    mountRepositoryPage(standard)
    fireEvent.click(await screen.findByRole('button', { name: 'frontend/src: User interface, 2 files' }))
    fireEvent.click(screen.getByRole('button', { name: 'Focus map' }))
    expect(within(screen.getByRole('region', { name: 'Focus map' })).getByRole('heading', { name: 'frontend/src' })).toBeTruthy()
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
    expect(api.getAttribute('data-dimmed')).toBe('false')
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
