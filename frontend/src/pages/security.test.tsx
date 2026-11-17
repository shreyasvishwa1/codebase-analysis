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
  Repository,
  SecurityFinding,
  SecurityFindingList,
  SecurityOverview,
  SecuritySummary,
} from '../types/api'
import { RepositorySecurityPage } from './RepositorySecurityPage'
import { SecurityPage } from './SecurityPage'

const P = PROJECT.id
const R = ZIP_REPOSITORY.id
const REPO_URL = `/projects/${P}/repositories/${R}`
const RUNS_URL = `${REPO_URL}/analysis-runs`
const READY: Repository = { ...ZIP_REPOSITORY, status: 'ready' }

const SUMMARY: SecuritySummary = {
  files_scanned: 16,
  python_files: 5,
  bandit: 'completed',
  findings: 9,
  stored_findings: 9,
  by_severity: { critical: 2, high: 3, medium: 3, low: 1 },
  by_confidence: { confirmed: 5, potential: 4 },
  by_owasp: { A01: 0, A02: 2, A03: 4, A04: 0, A05: 2, A06: 0, A07: 1, A08: 0, A09: 0, A10: 0 },
  top_files: [
    { path: 'shop/db.py', findings: 5, critical: 0, high: 2, medium: 2, low: 1 },
    { path: 'config/settings.py', findings: 2, critical: 1, high: 0, medium: 1, low: 0 },
  ],
  top_rules: [{ rule_id: 'B608', count: 2, title: 'SQL built from strings', severity: 'medium' }],
}

const run = (overrides: Partial<AnalysisRun> = {}): AnalysisRun => ({
  id: 'run-1',
  analysis_job_id: 'job-1',
  repository_id: R,
  project_id: P,
  file_count: 16,
  analyzed_file_count: 16,
  excluded_file_count: 0,
  total_bytes: 4096,
  total_lines: 400,
  code_lines: 350,
  languages: [],
  skipped: { binary: 0, too_large: 0, unavailable: 0, generated: 0 },
  quality: null,
  security: SUMMARY,
  created_at: '2026-11-18T10:00:00Z',
  ...overrides,
})

const finding = (overrides: Partial<SecurityFinding> = {}): SecurityFinding => ({
  id: 'f-1',
  path: 'config/settings.py',
  line: 7,
  end_line: 7,
  tool: 'codebase-analysis',
  rule_id: 'aws-access-key-id',
  title: 'AWS access key committed',
  owasp: 'A07',
  cwe: 798,
  severity: 'critical',
  confidence: 'confirmed',
  message: 'AWS access key ID found (value not shown).',
  explanation: 'A credential written in source code is readable by everyone.',
  recommendation: 'Revoke and rotate this credential now.',
  doc_url: null,
  ...overrides,
})

const BANDIT = finding({
  id: 'f-2',
  path: 'shop/db.py',
  line: 19,
  end_line: 21,
  tool: 'bandit',
  rule_id: 'B608',
  title: 'SQL built from strings',
  owasp: 'A03',
  cwe: 89,
  severity: 'medium',
  confidence: 'potential',
  message: 'Possible SQL injection vector through string-based query construction.',
  explanation: 'Bandit found code that commonly leads to a vulnerability.',
  recommendation: 'Use parameterized APIs.',
  doc_url: 'https://bandit.readthedocs.io/en/1.9.4/plugins/b608_hardcoded_sql_expressions.html',
})

const page = (items: SecurityFinding[], total = items.length, pageNumber = 1): SecurityFindingList => ({
  items,
  total,
  page: pageNumber,
  page_size: 50,
})

const last = <T,>(items: T[]): T | undefined => items[items.length - 1]

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

type Route_ = MockResponse | ((c: InternalAxiosRequestConfig) => MockResponse)

function mountRepositoryPage(routes: Record<string, Route_>) {
  const requests = mockApi({ [`GET ${REPO_URL}`]: { status: 200, data: READY }, ...routes })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={[`${REPO_URL}/security`]}>
        <Routes>
          <Route path="/projects/:projectId/repositories/:repositoryId/security" element={<RepositorySecurityPage />} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return requests
}

function findingRoute(respond: (params: Record<string, unknown>) => SecurityFindingList, seen: Record<string, unknown>[]) {
  return (config: InternalAxiosRequestConfig): MockResponse => {
    const params = { ...(config.params as Record<string, unknown>) }
    seen.push(params)
    return { status: 200, data: respond(params) }
  }
}

describe('Repository security', () => {
  it('shows the disclaimer, summary, OWASP breakdown and findings of the latest run', async () => {
    const seen: Record<string, unknown>[] = []
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${RUNS_URL}/run-1/security-findings`]: findingRoute(() => page([finding(), BANDIT]), seen),
    })
    const note = await screen.findByRole('note')
    expect(note.textContent).toContain('cannot prove that a project is secure')
    expect(note.textContent).not.toContain('found no security problems')

    const summary = screen.getByRole('region', { name: 'Security summary' })
    expect(within(summary).getByText('Findings').nextElementSibling?.textContent).toBe('9')
    expect(within(summary).getByText('16 files scanned')).toBeTruthy()
    expect(within(summary).getByRole('button', { name: 'Show critical severity findings' }).textContent).toBe('Critical2')
    expect(within(summary).getByRole('button', { name: 'Show low severity findings' }).textContent).toBe('Low1')
    expect(within(summary).getByRole('button', { name: 'Show confirmed findings' }).textContent).toBe('Confirmed5')
    expect(within(summary).getByRole('button', { name: 'Show potential findings' }).textContent).toBe('Potential4')

    const owasp = screen.getByRole('region', { name: 'OWASP Top 10 categories' })
    expect(within(owasp).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'A02 Cryptographic Failures2',
      'A03 Injection4',
      'A05 Security Misconfiguration2',
      'A07 Identification and Authentication Failures1',
    ])
    const files = screen.getByRole('region', { name: 'Files with the most findings' })
    expect(within(files).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'shop/db.py5 findings',
      'config/settings.py2 findings· 1 critical',
    ])

    const findings = within(screen.getByRole('region', { name: 'Findings' }))
    expect(await findings.findByText('AWS access key committed')).toBeTruthy()
    expect(findings.getByRole('status').textContent).toBe('2 findings · page 1 of 1')
    expect(findings.getByText('config/settings.py:7 · aws-access-key-id · A07 Identification and Authentication Failures')).toBeTruthy()
    expect(findings.getByText('shop/db.py:19–21 · B608 · A03 Injection')).toBeTruthy()
    expect(findings.getAllByText('Confirmed', { selector: 'span' })).toHaveLength(1) // badges (not the filter option)
    expect(findings.getAllByText('Potential', { selector: 'span' })).toHaveLength(1)
    expect(seen).toEqual([{ page: 1, page_size: 50 }])
  })

  it('explains a finding with CWE and Bandit links and opens the file at its line', async () => {
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${RUNS_URL}/run-1/security-findings`]: {
        status: 200,
        data: page([BANDIT, finding({ id: 'f-3', cwe: null, doc_url: 'https://evil.example/bandit', title: 'Odd' })]),
      },
    })
    const findings = within(await screen.findByRole('region', { name: 'Findings' }))
    const toggle = await findings.findByRole('button', { name: /SQL built from strings/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(findings.getByText('Use parameterized APIs.')).toBeTruthy()
    expect(findings.getByText('Bandit found code that commonly leads to a vulnerability.')).toBeTruthy()
    expect(findings.getByRole('link', { name: 'CWE-89' }).getAttribute('href')).toBe('https://cwe.mitre.org/data/definitions/89.html')
    const docs = findings.getByRole('link', { name: 'Bandit B608 documentation' })
    expect(docs.getAttribute('href')).toBe(BANDIT.doc_url)
    expect(docs.getAttribute('rel')).toContain('noopener')
    expect(findings.getByText('Found by Bandit')).toBeTruthy()

    fireEvent.click(findings.getByRole('button', { name: /Odd/ }))
    expect(findings.getAllByRole('link', { name: /CWE-/ })).toHaveLength(1) // no CWE: no link
    expect(findings.getAllByRole('link', { name: /documentation/ })).toHaveLength(1) // other hosts: none
    expect(findings.getByText('Found by CodeBase Analysis')).toBeTruthy()

    fireEvent.click(findings.getByRole('link', { name: 'Open in explorer at line 19' }))
    expect(screen.getByTestId('location').textContent).toBe(REPO_URL)
  })

  it('filters by severity, confidence, OWASP category, file and text, and pages', async () => {
    const seen: Record<string, unknown>[] = []
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${RUNS_URL}/run-1/security-findings`]: findingRoute(
        (params) => page([finding({ id: `f-${String(params.page)}` })], 120, Number(params.page)),
        seen,
      ),
    })
    const findings = within(await screen.findByRole('region', { name: 'Findings' }))
    expect(await findings.findByText('120 findings · page 1 of 3')).toBeTruthy()
    fireEvent.click(findings.getByRole('button', { name: 'Next' }))
    expect(await findings.findByText('120 findings · page 2 of 3')).toBeTruthy()

    fireEvent.change(findings.getByLabelText('Severity'), { target: { value: 'high' } })
    await waitFor(() => expect(last(seen)).toEqual({ page: 1, page_size: 50, severity: 'high' }))
    fireEvent.change(findings.getByLabelText('Confidence'), { target: { value: 'confirmed' } })
    await waitFor(() => expect(last(seen)).toEqual({ page: 1, page_size: 50, severity: 'high', confidence: 'confirmed' }))
    fireEvent.change(findings.getByLabelText('OWASP category'), { target: { value: 'A03' } })
    await waitFor(() => expect(last(seen)).toMatchObject({ owasp: 'A03', page: 1 }))
    fireEvent.change(findings.getByLabelText('Search findings'), { target: { value: '  pickle ' } })
    expect(last(seen)).not.toHaveProperty('q')
    fireEvent.click(findings.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(last(seen)).toEqual({ page: 1, page_size: 50, severity: 'high', confidence: 'confirmed', owasp: 'A03', q: 'pickle' }))

    fireEvent.click(screen.getByRole('button', { name: 'Show critical severity findings' }))
    await waitFor(() => expect(last(seen)).toMatchObject({ severity: 'critical' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show potential findings' }))
    await waitFor(() => expect(last(seen)).toMatchObject({ confidence: 'potential' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'OWASP Top 10 categories' })).getByRole('button', { name: /A05/ }))
    await waitFor(() => expect(last(seen)).toMatchObject({ owasp: 'A05' }))
    fireEvent.click(within(screen.getByRole('region', { name: 'Files with the most findings' })).getByRole('button', { name: /shop\/db\.py/ }))
    await waitFor(() => expect(last(seen)).toMatchObject({ path: 'shop/db.py' }))
    fireEvent.click(findings.getByRole('button', { name: 'Clear file filter' }))
    await waitFor(() => expect(last(seen)).not.toHaveProperty('path'))
  })

  it('switches runs and starts each run with no filters', async () => {
    const seen: Record<string, unknown>[] = []
    const older = run({ id: 'run-0', created_at: '2026-11-17T09:00:00Z', security: { ...SUMMARY, findings: 4 } })
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run(), older] } },
      [`GET ${RUNS_URL}/run-1/security-findings`]: findingRoute(() => page([finding()]), seen),
      [`GET ${RUNS_URL}/run-0/security-findings`]: findingRoute(() => page([finding({ id: 'old', title: 'Older finding' })]), seen),
    })
    const findings = within(await screen.findByRole('region', { name: 'Findings' }))
    fireEvent.change(findings.getByLabelText('Severity'), { target: { value: 'low' } })
    await waitFor(() => expect(last(seen)).toMatchObject({ severity: 'low' }))
    fireEvent.change(screen.getByLabelText('Run'), { target: { value: 'run-0' } })
    expect(await screen.findByText('Older finding')).toBeTruthy()
    expect(last(seen)).toEqual({ page: 1, page_size: 50 })
    expect(screen.getByText('Findings').nextElementSibling?.textContent).toBe('4')
  })

  it('says when these checks found nothing, without calling the project secure', async () => {
    const empty: SecuritySummary = {
      ...SUMMARY,
      findings: 0,
      stored_findings: 0,
      by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
      by_confidence: { confirmed: 0, potential: 0 },
      by_owasp: { A01: 0, A02: 0, A03: 0, A04: 0, A05: 0, A06: 0, A07: 0, A08: 0, A09: 0, A10: 0 },
      top_files: [],
      top_rules: [],
    }
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run({ security: empty })] } },
      [`GET ${RUNS_URL}/run-1/security-findings`]: { status: 200, data: page([]) },
    })
    const note = await screen.findByRole('note')
    expect(note.textContent).toContain('These checks found no security problems.')
    expect(note.textContent).toContain('cannot prove that a project is secure')
    expect(await screen.findByText('No findings match these filters.')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'OWASP Top 10 categories' })).getByText('No findings.')).toBeTruthy()
  })

  it('notes incomplete results', async () => {
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: {
        status: 200,
        data: { job: null, runs: [run({ security: { ...SUMMARY, bandit: 'timeout', findings: 9000, stored_findings: 5000 } })] },
      },
      [`GET ${RUNS_URL}/run-1/security-findings`]: { status: 200, data: page([]) },
    })
    const notes = await screen.findByRole('list', { name: 'Analysis notes' })
    expect(within(notes).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Python findings are missing from this run: the Python security scan took too long and was stopped.',
      'The 5,000 most severe of 9,000 findings are listed.',
    ])
  })

  it('says when a repository has no Python files', async () => {
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run({ security: { ...SUMMARY, bandit: 'skipped', python_files: 0 } })] } },
      [`GET ${RUNS_URL}/run-1/security-findings`]: { status: 200, data: page([]) },
    })
    expect((await screen.findByRole('list', { name: 'Analysis notes' })).textContent).toContain('No Python files')
  })

  it('links to the full analysis when there is no run yet', async () => {
    mountRepositoryPage({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [] } } })
    fireEvent.click(await screen.findByRole('link', { name: 'Run a full analysis' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/analysis`)
  })

  it('asks for a new run when the latest predates security analysis', async () => {
    const requests = mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run({ security: null })] } },
    })
    expect(await screen.findByRole('link', { name: 'Run a new full analysis' })).toBeTruthy()
    expect(requests.some((r) => r.url.endsWith('/security-findings'))).toBe(false)
  })

  it('reports failed requests', async () => {
    mountRepositoryPage({
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${RUNS_URL}/run-1/security-findings`]: { status: 500, data: { detail: 'Server error' } },
    })
    expect((await screen.findByRole('alert')).textContent).toContain('Server error')
  })
})

const OVERVIEW: SecurityOverview = {
  repositories: [
    {
      project_id: P,
      project_name: 'Demo project',
      repository_id: R,
      repository_name: 'shop-api',
      run_id: 'run-1',
      created_at: '2026-11-18T10:00:00Z',
      analyzed_file_count: 16,
      security: SUMMARY,
    },
  ],
}

describe('Security overview', () => {
  function mountOverview() {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={['/security']}>
          <Routes>
            <Route path="/security" element={<SecurityPage />} />
            <Route path="*" element={<Location />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it("lists each repository's latest results and opens its report", async () => {
    mockApi({ 'GET /security': { status: 200, data: OVERVIEW } })
    mountOverview()
    const card = within(await screen.findByRole('list', { name: 'Scanned repositories' })).getByRole('listitem')
    expect(within(card).getByRole('heading', { name: 'shop-api' })).toBeTruthy()
    expect(within(card).getByText('Findings').nextElementSibling?.textContent).toBe('9')
    expect(within(card).getByText('Confirmed').nextElementSibling?.textContent).toBe('5')
    expect(within(card).getByText('Files scanned').nextElementSibling?.textContent).toBe('16')
    expect(within(card).getByLabelText('Findings by severity').textContent).toBe('Critical2High3Medium3Low1')
    expect(screen.getByRole('note').textContent).toContain('cannot prove that a project is secure')
    fireEvent.click(within(card).getByRole('link', { name: 'View the security report of shop-api' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/security`)
  })

  it('invites the user to analyze a repository', async () => {
    mockApi({ 'GET /security': { status: 200, data: { repositories: [] } } })
    mountOverview()
    fireEvent.click(await screen.findByRole('link', { name: 'Upload a repository' }))
    expect(screen.getByTestId('location').textContent).toBe('/upload')
  })

  it('reports a failed request', async () => {
    mockApi({ 'GET /security': { status: 500, data: { detail: 'Server error' } } })
    mountOverview()
    expect((await screen.findByRole('alert')).textContent).toContain('Server error')
  })
})

describe('Security navigation', () => {
  it('opens Security from the sidebar and a repository section', async () => {
    setToken('test-token')
    mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
      'GET /security': { status: 200, data: OVERVIEW },
      [`GET ${REPO_URL}`]: { status: 200, data: READY },
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${RUNS_URL}/run-1/security-findings`]: { status: 200, data: page([finding()]) },
    })
    renderWithProviders(<App />, { route: '/overview' })
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]
    fireEvent.click(within(nav).getByRole('link', { name: 'Security' }))
    expect(await screen.findByRole('heading', { name: 'Security' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('link', { name: 'View the security report of shop-api' }))
    const sections = await screen.findByRole('navigation', { name: 'Repository sections' })
    expect(within(sections).getByRole('link', { name: 'Security' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByText('AWS access key committed')).toBeTruthy()
  })
})
