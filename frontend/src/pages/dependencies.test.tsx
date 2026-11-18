import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { InternalAxiosRequestConfig } from 'axios'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import App from '../App'
import { setToken } from '../services/session'
import { mockApi, PROJECT, USER, ZIP_REPOSITORY, type MockResponse } from '../test/mockApi'
import { createTestQueryClient, renderWithProviders } from '../test/render'
import type {
  AnalysisRun,
  DependencyAnalysisSummary,
  DependencyOverview,
  DependencyRecord,
  DependencyRecordList,
  Repository,
} from '../types/api'
import { DependenciesPage } from './DependenciesPage'
import { RepositoryDependenciesPage } from './RepositoryDependenciesPage'

const P = PROJECT.id
const R = ZIP_REPOSITORY.id
const REPO_URL = `/projects/${P}/repositories/${R}`
const RUNS_URL = `${REPO_URL}/analysis-runs`
const DEPS_URL = `${RUNS_URL}/run-1/dependencies`
const READY: Repository = { ...ZIP_REPOSITORY, status: 'ready' }

const SUMMARY: DependencyAnalysisSummary = {
  manifests: { total: 2, parsed: 2, invalid: 0, unreadable: 0 },
  dependencies: 7,
  truncated: false,
  by_ecosystem: { python: 4, npm: 3 },
  by_scope: { runtime: 6, dev: 1, other: 0 },
  by_version_source: { pinned: 3, minimum: 2, none: 2 },
  updates: { up_to_date: 0, patch: 1, minor: 2, major: 2, unknown: 2 },
  vulnerable_dependencies: 3,
  vulnerabilities: 4,
  by_severity: { critical: 1, high: 1, medium: 1, low: 0, unknown: 1 },
  conflicts: [
    {
      ecosystem: 'python',
      name: 'requests',
      declarations: [
        { manifest: 'requirements.txt', specifier: '>=2.25' },
        { manifest: 'backend/requirements.txt', specifier: '==2.31.0' },
      ],
    },
  ],
  lookups: { registry: 'completed', osv: 'completed', checked_at: '2026-11-18T10:00:00Z' },
}

const run = (overrides: Partial<AnalysisRun> = {}): AnalysisRun => ({
  id: 'run-1',
  analysis_job_id: 'job-1',
  repository_id: R,
  project_id: P,
  file_count: 10,
  analyzed_file_count: 9,
  excluded_file_count: 1,
  total_bytes: 2048,
  total_lines: 300,
  code_lines: 250,
  languages: [],
  skipped: { binary: 0, too_large: 0, unavailable: 0, generated: 0 },
  quality: null,
  security: null,
  complexity: null,
  dependencies: SUMMARY,
  architecture: null,
  chat_index: null,
  created_at: '2026-11-18T10:00:00Z',
  ...overrides,
})

const FLASK: DependencyRecord = {
  id: 'd-1',
  manifest: 'requirements.txt',
  ecosystem: 'python',
  name: 'flask',
  specifier: '==2.0.1',
  scope: 'runtime',
  line: 2,
  version: '2.0.1',
  version_source: 'pinned',
  latest_version: '3.1.3',
  update: 'major',
  vulnerability_count: 1,
  max_severity: 'high',
  vulnerabilities: [
    {
      id: 'GHSA-m2qf-hxjv-5gpq',
      aliases: ['CVE-2023-30861', 'PYSEC-2023-62'],
      summary: 'Session cookie disclosure',
      severity: 'high',
      score: 7.5,
      fixed_in: '2.2.5',
      cwe: 539,
      url: 'https://osv.dev/vulnerability/GHSA-m2qf-hxjv-5gpq',
    },
  ],
  conflict: false,
}
const LEFTPAD: DependencyRecord = {
  ...FLASK,
  id: 'd-2',
  name: 'leftpad',
  specifier: '',
  line: 4,
  version: null,
  version_source: 'none',
  latest_version: '1.0.0',
  update: 'unknown',
  vulnerability_count: 0,
  max_severity: null,
  vulnerabilities: [],
}
const REQUESTS: DependencyRecord = {
  ...FLASK,
  id: 'd-3',
  name: 'requests',
  specifier: '>=2.25',
  line: 3,
  version: '2.25',
  version_source: 'minimum',
  latest_version: '2.34.2',
  update: 'minor',
  vulnerability_count: 1,
  max_severity: 'unknown',
  vulnerabilities: [{ ...FLASK.vulnerabilities[0], id: 'GHSA-zzzz', aliases: [], severity: 'unknown', score: null, fixed_in: null, summary: '', url: 'https://evil.example/x' }],
  conflict: true,
}

const page = (items: DependencyRecord[], total = items.length): DependencyRecordList => ({ items, total, page: 1, page_size: 25 })
const last = <T,>(items: T[]): T | undefined => items[items.length - 1]

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function recorder(respond: (params: Record<string, unknown>) => DependencyRecordList, seen: Record<string, unknown>[]) {
  return (config: InternalAxiosRequestConfig): MockResponse => {
    const params = { ...(config.params as Record<string, unknown>) }
    seen.push(params)
    return { status: 200, data: respond(params) }
  }
}

function mountRepositoryPage(routes: Record<string, MockResponse | ((c: InternalAxiosRequestConfig) => MockResponse)>) {
  const requests = mockApi({ [`GET ${REPO_URL}`]: { status: 200, data: READY }, ...routes })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[`${REPO_URL}/dependencies`]}>
        <Routes>
          <Route path="/projects/:projectId/repositories/:repositoryId/dependencies" element={<RepositoryDependenciesPage />} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return requests
}

describe('Repository dependencies', () => {
  it('shows the summary, breakdowns, conflicts and dependencies of the latest run', async () => {
    const seen: Record<string, unknown>[] = []
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${DEPS_URL}`]: recorder(() => page([FLASK, REQUESTS, LEFTPAD]), seen),
    })
    const summary = await screen.findByRole('region', { name: 'Dependency summary' })
    expect(within(summary).getByText('Dependencies').nextElementSibling?.textContent).toBe('7')
    expect(within(summary).getByText('In 2 manifests')).toBeTruthy()
    expect(within(summary).getByRole('button', { name: 'Show vulnerable dependencies' }).textContent).toBe('Vulnerable34 known vulnerabilities')
    expect(within(summary).getByText('Outdated').nextElementSibling?.textContent).toBe('5')
    expect(within(summary).getByText('2 behind a major version')).toBeTruthy()
    expect(within(summary).getByRole('button', { name: 'Show conflicts dependencies' }).textContent).toContain('1')
    expect(within(summary).getByText(/Checked against PyPI, npm and OSV.dev on/)).toBeTruthy()
    expect(within(summary).queryByRole('list', { name: 'Analysis notes' })).toBeNull()

    expect(within(screen.getByRole('region', { name: 'Vulnerabilities by severity' })).getByText('Unrated')).toBeTruthy()
    const updates = within(screen.getByRole('region', { name: 'Updates' }))
    expect(updates.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Major update2',
      'Minor update2',
      'Patch update1',
      'Up to date0',
      'Unknown2',
    ])
    const conflicts = within(screen.getByRole('region', { name: 'Conflicting declarations' }))
    expect(conflicts.getByText('requirements.txt: >=2.25')).toBeTruthy()
    expect(conflicts.getByText('backend/requirements.txt: ==2.31.0')).toBeTruthy()

    const list = within(screen.getByRole('region', { name: 'Dependencies' }))
    expect(await list.findByText('flask')).toBeTruthy()
    expect(list.getByRole('status').textContent).toBe('3 dependencies · page 1 of 1')
    expect(list.getByText('requirements.txt:2 · runtime · 1 vulnerability')).toBeTruthy()
    expect(list.getByText(/==2\.0\.1 · 2\.0\.1 \(pinned\) · latest 3\.1\.3/)).toBeTruthy()
    expect(list.getByText(/>=2\.25 · 2\.25 \(lowest allowed\)/)).toBeTruthy()
    expect(list.getByText(/\(any version\) · no version to check · latest 1\.0\.0/)).toBeTruthy()
    expect(list.getByText('Conflict')).toBeTruthy()
    expect(seen).toEqual([{ page: 1, page_size: 25, sort: 'risk' }])
  })

  it('expands vulnerabilities with fixes and advisory links, and opens the manifest', async () => {
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${DEPS_URL}`]: { status: 200, data: page([FLASK, REQUESTS, LEFTPAD]) },
    })
    const list = within(await screen.findByRole('region', { name: 'Dependencies' }))
    fireEvent.click(await list.findByRole('button', { name: /^flask/ }))
    const flask = within(list.getByRole('list', { name: 'Vulnerabilities of flask' }))
    expect(flask.getByText('CVE-2023-30861 · GHSA-m2qf-hxjv-5gpq')).toBeTruthy()
    expect(flask.getByText('CVSS 7.5')).toBeTruthy()
    expect(flask.getByText('Fixed in 2.2.5')).toBeTruthy()
    expect(flask.getByRole('link', { name: 'GHSA-m2qf-hxjv-5gpq on OSV.dev' }).getAttribute('href')).toBe(FLASK.vulnerabilities[0].url)

    fireEvent.click(list.getByRole('button', { name: /^requests/ }))
    const requests = within(list.getByRole('list', { name: 'Vulnerabilities of requests' }))
    expect(requests.getByText('No fixed version published')).toBeTruthy()
    expect(requests.getByText('No summary published.')).toBeTruthy()
    expect(requests.queryByRole('link')).toBeNull() // not an OSV.dev address: no link
    fireEvent.click(list.getByRole('button', { name: /^leftpad/ }))
    expect(list.getByText('No version is declared, so vulnerabilities could not be checked.')).toBeTruthy()

    fireEvent.click(list.getAllByRole('link', { name: 'Open requirements.txt in the explorer' })[0])
    expect(screen.getByTestId('location').textContent).toBe(REPO_URL)
  })

  it('filters, sorts and pages the dependencies', async () => {
    const seen: Record<string, unknown>[] = []
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${DEPS_URL}`]: recorder((params) => ({ ...page([{ ...FLASK, id: `p${String(params.page)}` }], 60), page: Number(params.page) }), seen),
    })
    const list = within(await screen.findByRole('region', { name: 'Dependencies' }))
    expect(await list.findByText('60 dependencies · page 1 of 3')).toBeTruthy()
    fireEvent.click(list.getByRole('button', { name: 'Next' }))
    expect(await list.findByText('60 dependencies · page 2 of 3')).toBeTruthy()

    fireEvent.change(list.getByLabelText('Sort by'), { target: { value: 'update' } })
    await waitFor(() => expect(last(seen)).toEqual({ page: 1, page_size: 25, sort: 'update' }))
    fireEvent.change(list.getByLabelText('Ecosystem'), { target: { value: 'npm' } })
    fireEvent.change(list.getByLabelText('Scope'), { target: { value: 'dev' } })
    fireEvent.change(list.getByLabelText('Update'), { target: { value: 'major' } })
    fireEvent.change(list.getByLabelText('Vulnerabilities'), { target: { value: 'false' } })
    fireEvent.click(list.getByLabelText('Conflicts only'))
    fireEvent.change(list.getByLabelText('Search dependencies'), { target: { value: ' jwt ' } })
    fireEvent.click(list.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(last(seen)).toEqual({
        page: 1, page_size: 25, sort: 'update', ecosystem: 'npm', scope: 'dev', update: 'major', vulnerable: false, conflict: true, q: 'jwt',
      }),
    )
    fireEvent.change(list.getByLabelText('Vulnerabilities'), { target: { value: '' } })
    fireEvent.click(list.getByLabelText('Conflicts only'))
    await waitFor(() => expect(last(seen)).not.toHaveProperty('vulnerable'))
    expect(last(seen)).not.toHaveProperty('conflict')

    fireEvent.click(screen.getByRole('button', { name: 'Show vulnerable dependencies' }))
    await waitFor(() => expect(last(seen)).toMatchObject({ vulnerable: true, page: 1 }))
    fireEvent.click(screen.getByRole('button', { name: 'Show dependencies: patch update' }))
    await waitFor(() => expect(last(seen)).toMatchObject({ update: 'patch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show conflicts dependencies' }))
    await waitFor(() => expect(last(seen)).toMatchObject({ conflict: true }))
  })

  it('explains turned-off and incomplete lookups', async () => {
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: {
        status: 200,
        data: { job: null, runs: [run({ dependencies: { ...SUMMARY, lookups: { registry: 'disabled', osv: 'disabled', checked_at: null } } })] },
      },
      [`GET ${DEPS_URL}`]: { status: 200, data: page([LEFTPAD]) },
    })
    const notes = await screen.findByRole('list', { name: 'Analysis notes' })
    expect(notes.textContent).toBe('Version and vulnerability lookups are turned off on this server: only the declarations are listed.')
    expect(screen.queryByText(/Checked against/)).toBeNull()
  })

  it('notes partial and failed lookups, limits and invalid manifests', async () => {
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: {
        status: 200,
        data: {
          job: null,
          runs: [run({ dependencies: { ...SUMMARY, truncated: true, manifests: { ...SUMMARY.manifests, invalid: 1 }, lookups: { registry: 'partial', osv: 'failed', checked_at: '2026-11-18T10:00:00Z' } } })],
        },
      },
      [`GET ${DEPS_URL}`]: { status: 200, data: page([]) },
    })
    const notes = await screen.findByRole('list', { name: 'Analysis notes' })
    expect(within(notes).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Latest versions are incomplete: only part of the packages could be checked in time (PyPI, npm).',
      'Vulnerabilities are incomplete: the service could not be reached (OSV.dev).',
      'The repository declares more dependencies than are analyzed (limit reached).',
      '1 manifest could not be parsed.',
    ])
    expect(await screen.findByText('No dependencies match these filters.')).toBeTruthy()
  })

  it('says when no dependencies are declared', async () => {
    const requests = mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run({ dependencies: { ...SUMMARY, dependencies: 0, conflicts: [] } })] } },
    })
    expect(await screen.findByText(/No dependencies are declared/)).toBeTruthy()
    expect(requests.some((r) => r.url.endsWith('/dependencies'))).toBe(false)
  })

  it('switches runs and starts each run with no filters', async () => {
    const seen: Record<string, unknown>[] = []
    const older = run({ id: 'run-0', created_at: '2026-11-17T09:00:00Z', dependencies: { ...SUMMARY, dependencies: 3 } })
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run(), older] } },
      [`GET ${DEPS_URL}`]: recorder(() => page([FLASK]), seen),
      [`GET ${RUNS_URL}/run-0/dependencies`]: recorder(() => page([{ ...LEFTPAD, name: 'olderpkg' }]), seen),
    })
    const list = within(await screen.findByRole('region', { name: 'Dependencies' }))
    fireEvent.change(list.getByLabelText('Ecosystem'), { target: { value: 'npm' } })
    await waitFor(() => expect(last(seen)).toMatchObject({ ecosystem: 'npm' }))
    fireEvent.change(screen.getByLabelText('Run'), { target: { value: 'run-0' } })
    expect(await screen.findByText('olderpkg')).toBeTruthy()
    expect(last(seen)).toEqual({ page: 1, page_size: 25, sort: 'risk' })
  })

  it('links to the full analysis when there is no run yet', async () => {
    mountRepositoryPage({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [] } } })
    fireEvent.click(await screen.findByRole('link', { name: 'Run a full analysis' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/analysis`)
  })

  it('asks for a new run when the latest predates dependency analysis', async () => {
    mountRepositoryPage({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run({ dependencies: null })] } } })
    expect(await screen.findByRole('link', { name: 'Run a new full analysis' })).toBeTruthy()
  })

  it('reports a failed request', async () => {
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${DEPS_URL}`]: { status: 500, data: { detail: 'Server error' } },
    })
    expect((await screen.findByRole('alert')).textContent).toContain('Server error')
  })
})

const OVERVIEW: DependencyOverview = {
  repositories: [
    {
      project_id: P,
      project_name: 'Demo project',
      repository_id: R,
      repository_name: 'shop-api',
      run_id: 'run-1',
      created_at: '2026-11-18T10:00:00Z',
      analyzed_file_count: 9,
      code_lines: 250,
      dependencies: SUMMARY,
    },
  ],
}

describe('Dependencies overview', () => {
  function mountOverview() {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={['/dependencies']}>
          <Routes>
            <Route path="/dependencies" element={<DependenciesPage />} />
            <Route path="*" element={<Location />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it("lists each repository's latest results and opens its report", async () => {
    mockApi({ 'GET /dependency-analysis': { status: 200, data: OVERVIEW } })
    mountOverview()
    const card = within(await screen.findByRole('list', { name: 'Repositories with dependencies' })).getByRole('listitem')
    expect(within(card).getByText('Dependencies').nextElementSibling?.textContent).toBe('7')
    expect(within(card).getByText('Vulnerable').nextElementSibling?.textContent).toBe('3')
    expect(within(card).getByText('Outdated').nextElementSibling?.textContent).toBe('5')
    expect(within(card).getByLabelText('Vulnerabilities by severity').textContent).toBe('Critical1High1Medium1Low0Unrated1')
    expect(within(card).queryByText(/Lookups are turned off/)).toBeNull()
    fireEvent.click(within(card).getByRole('link', { name: 'View the dependencies of shop-api' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/dependencies`)
  })

  it('marks repositories analyzed without lookups', async () => {
    mockApi({
      'GET /dependency-analysis': {
        status: 200,
        data: { repositories: [{ ...OVERVIEW.repositories[0], dependencies: { ...SUMMARY, lookups: { registry: 'disabled', osv: 'disabled', checked_at: null } } }] },
      },
    })
    mountOverview()
    expect(await screen.findByText('Lookups are turned off: declarations only.')).toBeTruthy()
  })

  it('invites the user to analyze a repository and reports errors', async () => {
    mockApi({ 'GET /dependency-analysis': { status: 200, data: { repositories: [] } } })
    mountOverview()
    fireEvent.click(await screen.findByRole('link', { name: 'Upload a repository' }))
    expect(screen.getByTestId('location').textContent).toBe('/upload')
  })

  it('reports a failed request', async () => {
    mockApi({ 'GET /dependency-analysis': { status: 500, data: { detail: 'Server error' } } })
    mountOverview()
    expect((await screen.findByRole('alert')).textContent).toContain('Server error')
  })
})

describe('Dependencies navigation', () => {
  it('opens Dependencies from the sidebar and a repository section', async () => {
    setToken('test-token')
    mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
      'GET /dependency-analysis': { status: 200, data: OVERVIEW },
      [`GET ${REPO_URL}`]: { status: 200, data: READY },
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${DEPS_URL}`]: { status: 200, data: page([FLASK]) },
    })
    renderWithProviders(<App />, { route: '/overview' })
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]
    fireEvent.click(within(nav).getByRole('link', { name: 'Dependencies' }))
    expect(await screen.findByRole('heading', { name: 'Dependencies' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('link', { name: 'View the dependencies of shop-api' }))
    const sections = await screen.findByRole('navigation', { name: 'Repository sections' })
    expect(within(sections).getByRole('link', { name: 'Dependencies' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByText('flask')).toBeTruthy()
  })
})
