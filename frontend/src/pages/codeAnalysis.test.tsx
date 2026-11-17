import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { InternalAxiosRequestConfig } from 'axios'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import { setToken } from '../services/session'
import { mockApi, PROJECT, USER, ZIP_REPOSITORY, type MockResponse } from '../test/mockApi'
import { createTestQueryClient, renderWithProviders } from '../test/render'
import type {
  AnalysisRun,
  CodeIssue,
  CodeIssueList,
  QualityOverview,
  QualitySummary,
  Repository,
} from '../types/api'
import { CodeAnalysisPage } from './CodeAnalysisPage'
import { RepositoryCodeAnalysisPage } from './RepositoryCodeAnalysisPage'
import { RepositoryPage } from './RepositoryPage'

const P = PROJECT.id
const R = ZIP_REPOSITORY.id
const REPO_URL = `/projects/${P}/repositories/${R}`
const RUNS_URL = `${REPO_URL}/analysis-runs`
const READY: Repository = { ...ZIP_REPOSITORY, status: 'ready' }

const QUALITY: QualitySummary = {
  files_analyzed: 9,
  python_files: 4,
  ruff: 'completed',
  issues: 7,
  stored_issues: 7,
  by_severity: { high: 1, medium: 2, low: 3, info: 1 },
  by_category: {
    syntax_error: 0,
    bug_risk: 1,
    unused_code: 3,
    dead_code: 1,
    duplication: 1,
    naming: 0,
    documentation: 1,
    formatting: 0,
    maintainability: 0,
  },
  duplication: { percent: 12.5, duplicated_lines: 16, significant_lines: 128, files: 6, blocks: 1, partial: false },
  top_files: [
    { path: 'src/main.py', issues: 5, high: 1, medium: 1, low: 2, info: 1 },
    { path: 'web/b.js', issues: 1, high: 0, medium: 1, low: 0, info: 0 },
  ],
  top_rules: [{ rule_id: 'F401', count: 3, category: 'unused_code', severity: 'low' }],
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
  languages: [],
  skipped: { binary: 0, too_large: 0, unavailable: 0, generated: 0 },
  quality: QUALITY,
  created_at: '2026-11-17T10:00:00Z',
  ...overrides,
})

const issue = (overrides: Partial<CodeIssue> = {}): CodeIssue => ({
  id: 'issue-1',
  path: 'src/main.py',
  line: 10,
  column: 12,
  end_line: 10,
  tool: 'ruff',
  rule_id: 'F821',
  category: 'bug_risk',
  severity: 'high',
  message: 'Undefined name `missing_name`',
  explanation: 'A name is used that is never defined.',
  suggestion: 'Define or import the name.',
  doc_url: 'https://docs.astral.sh/ruff/rules/undefined-name',
  ...overrides,
})

const page = (items: CodeIssue[], total = items.length, pageNumber = 1): CodeIssueList => ({
  items,
  total,
  page: pageNumber,
  page_size: 50,
})

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function mountRepositoryPage(routes: Record<string, MockResponse | ((c: InternalAxiosRequestConfig) => MockResponse)>) {
  const requests = mockApi({ [`GET ${REPO_URL}`]: { status: 200, data: READY }, ...routes })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[`${REPO_URL}/code-analysis`]}>
        <Routes>
          <Route path="/projects/:projectId/repositories/:repositoryId/code-analysis" element={<RepositoryCodeAnalysisPage />} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return requests
}

/** Issue requests with their query parameters. */
function issueRoute(respond: (params: Record<string, unknown>) => CodeIssueList, seen: Record<string, unknown>[]) {
  return (config: InternalAxiosRequestConfig): MockResponse => {
    const params = { ...(config.params as Record<string, unknown>) }
    seen.push(params)
    return { status: 200, data: respond(params) }
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

const last = <T,>(items: T[]): T | undefined => items[items.length - 1]

describe('Repository code analysis', () => {
  it('shows the summary, breakdowns and the issues of the latest run', async () => {
    const seen: Record<string, unknown>[] = []
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${RUNS_URL}/run-1/issues`]: issueRoute(() => page([issue(), issue({ id: 'issue-2', severity: 'low', rule_id: 'F401', category: 'unused_code', message: '`os` imported but unused', line: 1, end_line: 1 })]), seen),
    })
    const summary = await screen.findByRole('region', { name: 'Quality summary' })
    expect(within(summary).getByText('Issues found').nextElementSibling?.textContent).toBe('7')
    expect(within(summary).getByRole('button', { name: 'Show high severity issues' }).textContent).toBe('High1')
    expect(within(summary).getByRole('button', { name: 'Show low severity issues' }).textContent).toBe('Low3')
    expect(within(summary).getByText('12.5%')).toBeTruthy()
    expect(within(summary).getByText('1 duplicate block')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Analysis notes' })).toBeNull()

    const categories = screen.getByRole('region', { name: 'Issues by category' })
    expect(within(categories).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Unused code3',
      'Bug risks1',
      'Dead code1',
      'Duplication1',
      'Documentation1',
    ])
    const files = screen.getByRole('region', { name: 'Files with the most issues' })
    expect(within(files).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'src/main.py5 issues· 1 high',
      'web/b.js1 issue',
    ])

    const issues = screen.getByRole('region', { name: 'Issues' })
    expect(await within(issues).findByText('Undefined name `missing_name`')).toBeTruthy()
    expect(within(issues).getByRole('status').textContent).toBe('2 issues · page 1 of 1')
    expect(within(issues).getByText('src/main.py:10 · F821 · Bug risks')).toBeTruthy()
    expect(seen).toEqual([{ page: 1, page_size: 50 }])
  })

  it('explains an issue, links its rule and opens the file at its line', async () => {
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${RUNS_URL}/run-1/issues`]: {
        status: 200,
        data: page([
          issue(),
          issue({ id: 'issue-2', tool: 'codebase-analysis', rule_id: 'unreachable-code', line: 6, end_line: 8, doc_url: null, message: 'Dead' }),
          issue({ id: 'issue-3', doc_url: 'https://evil.example/ruff', message: 'Odd link' }),
        ]),
      },
    })
    const issues = within(await screen.findByRole('region', { name: 'Issues' }))
    const toggle = await issues.findByRole('button', { name: /Undefined name/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(issues.queryByText('Why it matters:')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(issues.getByText('A name is used that is never defined.')).toBeTruthy()
    expect(issues.getByText('Define or import the name.')).toBeTruthy()
    const docs = issues.getByRole('link', { name: 'Rule F821 documentation' })
    expect(docs.getAttribute('href')).toBe('https://docs.astral.sh/ruff/rules/undefined-name')
    expect(docs.getAttribute('rel')).toContain('noopener')
    expect(issues.getByText('Found by Ruff')).toBeTruthy()

    fireEvent.click(issues.getByRole('button', { name: /Dead/ }))
    expect(issues.getByText('src/main.py:6–8 · unreachable-code · Bug risks')).toBeTruthy()
    expect(issues.getByText('Found by CodeBase Analysis')).toBeTruthy()
    fireEvent.click(issues.getByRole('button', { name: /Odd link/ }))
    expect(issues.getAllByRole('link', { name: /documentation/ })).toHaveLength(1) // other hosts: no link

    fireEvent.click(issues.getAllByRole('link', { name: 'Open in explorer at line 10' })[0])
    expect(screen.getByTestId('location').textContent).toBe(REPO_URL)
  })

  it('filters by severity, category, file and search text, and pages through results', async () => {
    const seen: Record<string, unknown>[] = []
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${RUNS_URL}/run-1/issues`]: issueRoute((params) => page([issue({ id: `i-${String(params.page)}` })], 120, Number(params.page)), seen),
    })
    const issues = within(await screen.findByRole('region', { name: 'Issues' }))
    expect(await issues.findByText('120 issues · page 1 of 3')).toBeTruthy()

    fireEvent.click(issues.getByRole('button', { name: 'Next' }))
    expect(await issues.findByText('120 issues · page 2 of 3')).toBeTruthy()
    fireEvent.click(issues.getByRole('button', { name: 'Next' }))
    expect(await issues.findByText('120 issues · page 3 of 3')).toBeTruthy()
    expect((issues.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(issues.getByRole('button', { name: 'Previous' }))
    expect(await issues.findByText('120 issues · page 2 of 3')).toBeTruthy()

    // A filter starts again at page 1.
    fireEvent.change(issues.getByLabelText('Severity'), { target: { value: 'medium' } })
    await waitFor(() => expect(last(seen)).toEqual({ page: 1, page_size: 50, severity: 'medium' }))
    fireEvent.change(issues.getByLabelText('Category'), { target: { value: 'dead_code' } })
    await waitFor(() => expect(last(seen)).toEqual({ page: 1, page_size: 50, severity: 'medium', category: 'dead_code' }))
    fireEvent.change(issues.getByLabelText('Search issues'), { target: { value: '  unused  ' } })
    expect(last(seen)).not.toHaveProperty('q') // nothing sent while typing
    fireEvent.click(issues.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(last(seen)).toEqual({ page: 1, page_size: 50, severity: 'medium', category: 'dead_code', q: 'unused' }))
    fireEvent.change(issues.getByLabelText('Severity'), { target: { value: '' } })
    await waitFor(() => expect(last(seen)).toEqual({ page: 1, page_size: 50, category: 'dead_code', q: 'unused' }))

    // Summary shortcuts set filters too.
    fireEvent.click(screen.getByRole('button', { name: 'Show high severity issues' }))
    await waitFor(() => expect(last(seen)).toMatchObject({ severity: 'high', page: 1 }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Issues by category' })).getByRole('button', { name: /Duplication/ }))
    await waitFor(() => expect(last(seen)).toMatchObject({ category: 'duplication' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Files with the most issues' })).getByRole('button', { name: /web\/b\.js/ }))
    await waitFor(() => expect(last(seen)).toMatchObject({ path: 'web/b.js' }))
    expect(issues.getByText('web/b.js', { selector: 'span' })).toBeTruthy()
    fireEvent.click(issues.getByRole('button', { name: 'Clear file filter' }))
    await waitFor(() => expect(last(seen)).not.toHaveProperty('path'))
  })

  it('reports no matches and failed requests', async () => {
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${RUNS_URL}/run-1/issues`]: (config) =>
        (config.params as { q?: string }).q
          ? { status: 500, data: { detail: 'Server error' } }
          : { status: 200, data: page([]) },
    })
    const issues = within(await screen.findByRole('region', { name: 'Issues' }))
    expect(await issues.findByText('No issues match these filters.')).toBeTruthy()
    fireEvent.change(issues.getByLabelText('Search issues'), { target: { value: 'boom' } })
    fireEvent.click(issues.getByRole('button', { name: 'Search' }))
    expect((await issues.findByRole('alert')).textContent).toContain('Server error')
  })

  it('switches runs and starts each run with no filters', async () => {
    const seen: Record<string, unknown>[] = []
    const older = run({ id: 'run-0', created_at: '2026-11-16T09:00:00Z', quality: { ...QUALITY, issues: 3 } })
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run(), older] } },
      [`GET ${RUNS_URL}/run-1/issues`]: issueRoute(() => page([issue()]), seen),
      [`GET ${RUNS_URL}/run-0/issues`]: issueRoute(() => page([issue({ id: 'old', message: 'Older issue' })]), seen),
    })
    const issues = within(await screen.findByRole('region', { name: 'Issues' }))
    fireEvent.change(issues.getByLabelText('Severity'), { target: { value: 'low' } })
    await waitFor(() => expect(last(seen)).toMatchObject({ severity: 'low' }))
    fireEvent.change(screen.getByLabelText('Run'), { target: { value: 'run-0' } })
    expect(await screen.findByText('Older issue')).toBeTruthy()
    expect(last(seen)).toEqual({ page: 1, page_size: 50 })
    expect(screen.getByText('Issues found').nextElementSibling?.textContent).toBe('3')
    expect((screen.getByLabelText('Severity') as HTMLSelectElement).value).toBe('')
  })

  it('links to the full analysis when there is no run yet', async () => {
    mountRepositoryPage({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [] } } })
    fireEvent.click(await screen.findByRole('link', { name: 'Run a full analysis' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/analysis`)
  })

  it('asks for a new run when the latest predates code analysis', async () => {
    const requests = mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run({ quality: null })] } },
    })
    expect(await screen.findByRole('link', { name: 'Run a new full analysis' })).toBeTruthy()
    expect(requests.some((r) => r.url.endsWith('/issues'))).toBe(false)
  })

  it('notes incomplete results', async () => {
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: {
        status: 200,
        data: {
          job: null,
          runs: [run({ quality: { ...QUALITY, ruff: 'timeout', issues: 9000, stored_issues: 5000, duplication: { ...QUALITY.duplication, partial: true } } })],
        },
      },
      [`GET ${RUNS_URL}/run-1/issues`]: { status: 200, data: page([]) },
    })
    const notes = await screen.findByRole('list', { name: 'Analysis notes' })
    expect(within(notes).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Python findings are missing from this run: Python linting took too long and was stopped.',
      'The 5,000 most severe of 9,000 findings are listed.',
      'The repository is very large: duplication was measured on part of it.',
    ])
  })

  it('says when a repository has no Python files', async () => {
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run({ quality: { ...QUALITY, ruff: 'skipped', python_files: 0 } })] } },
      [`GET ${RUNS_URL}/run-1/issues`]: { status: 200, data: page([]) },
    })
    const notes = await screen.findByRole('list', { name: 'Analysis notes' })
    expect(notes.textContent).toContain('No Python files')
  })

  it('reports runs that cannot be loaded', async () => {
    mountRepositoryPage({ [`GET ${RUNS_URL}`]: { status: 500, data: { detail: 'Server error' } } })
    expect((await screen.findByRole('alert')).textContent).toContain('Server error')
  })
})

describe('Explorer opened at a reported line', () => {
  it('opens the file and highlights the line', async () => {
    const scroll = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scroll })
    const contentPaths: string[] = []
    mockApi({
      [`GET ${REPO_URL}`]: { status: 200, data: READY },
      [`GET ${REPO_URL}/files/content`]: (config) => {
        const path = (config.params as { path: string }).path
        contentPaths.push(path)
        return { status: 200, data: { path, language: null, size_bytes: 9, content: 'one\ntwo\nthree\n', reason: null } }
      },
    })
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={[{ pathname: REPO_URL, state: { openFile: { path: 'src/main.py', line: 2 } } }]}>
          <Routes>
            <Route path="/projects/:projectId/repositories/:repositoryId" element={<RepositoryPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect((await screen.findByTestId('selected-line')).textContent).toBe('two')
    expect(contentPaths).toEqual(['src/main.py'])
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll).toHaveBeenCalledWith({ block: 'start' }) // instant: scroll anchoring holds it
    expect(scroll.mock.contexts[0]).toBe(screen.getByRole('region', { name: 'File' }))
  })

  it('ignores malformed navigation state', async () => {
    const requests = mockApi({ [`GET ${REPO_URL}`]: { status: 200, data: READY } })
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={[{ pathname: REPO_URL, state: { openFile: { path: 7, line: '2' } } }]}>
          <Routes>
            <Route path="/projects/:projectId/repositories/:repositoryId" element={<RepositoryPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('Select a file to view its content.')).toBeTruthy()
    expect(requests.some((r) => r.url.endsWith('/files/content'))).toBe(false)
  })
})

const OVERVIEW: QualityOverview = {
  repositories: [
    {
      project_id: P,
      project_name: 'Demo project',
      repository_id: R,
      repository_name: 'backend',
      run_id: 'run-1',
      created_at: '2026-11-17T10:00:00Z',
      analyzed_file_count: 9,
      code_lines: 1234,
      quality: QUALITY,
    },
  ],
}

describe('Code Analysis overview', () => {
  function mountOverview() {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={['/code-analysis']}>
          <Routes>
            <Route path="/code-analysis" element={<CodeAnalysisPage />} />
            <Route path="*" element={<Location />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it("lists each repository's latest results and opens its report", async () => {
    mockApi({ 'GET /code-quality': { status: 200, data: OVERVIEW } })
    mountOverview()
    const list = await screen.findByRole('list', { name: 'Analyzed repositories' })
    const card = within(list).getByRole('listitem')
    expect(within(card).getByRole('heading', { name: 'backend' })).toBeTruthy()
    expect(within(card).getByText('Issues').nextElementSibling?.textContent).toBe('7')
    expect(within(card).getByText('Duplication').nextElementSibling?.textContent).toBe('12.5%')
    expect(within(card).getByText('Files analyzed').nextElementSibling?.textContent).toBe('9')
    expect(within(card).getByLabelText('Issues by severity').textContent).toBe('High1Medium2Low3Info1')
    fireEvent.click(within(card).getByRole('link', { name: 'View the code analysis of backend' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/code-analysis`)
  })

  it('invites the user to analyze a repository', async () => {
    mockApi({ 'GET /code-quality': { status: 200, data: { repositories: [] } } })
    mountOverview()
    fireEvent.click(await screen.findByRole('link', { name: 'Upload a repository' }))
    expect(screen.getByTestId('location').textContent).toBe('/upload')
  })

  it('reports a failed request', async () => {
    mockApi({ 'GET /code-quality': { status: 500, data: { detail: 'Server error' } } })
    mountOverview()
    expect((await screen.findByRole('alert')).textContent).toContain('Server error')
  })
})

describe('Code Analysis navigation', () => {
  it('opens Code Analysis from the sidebar and a repository section', async () => {
    setToken('test-token')
    mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
      'GET /code-quality': { status: 200, data: OVERVIEW },
      [`GET ${REPO_URL}`]: { status: 200, data: READY },
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${RUNS_URL}/run-1/issues`]: { status: 200, data: page([issue()]) },
    })
    renderWithProviders(<App />, { route: '/overview' })
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]
    fireEvent.click(within(nav).getByRole('link', { name: 'Code Analysis' }))
    expect(await screen.findByRole('heading', { name: 'Code Analysis' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('link', { name: 'View the code analysis of backend' }))
    const sections = await screen.findByRole('navigation', { name: 'Repository sections' })
    expect(within(sections).getByRole('link', { name: 'Code analysis' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByText('Undefined name `missing_name`')).toBeTruthy()
  })
})
