import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeAll, describe, expect, it } from 'vitest'

import App from '../App'
import { JobProgress } from '../components/JobProgress'
import { setToken } from '../services/session'
import { mockApi, PROJECT, USER, ZIP_REPOSITORY } from '../test/mockApi'
import { createTestQueryClient, renderWithProviders } from '../test/render'
import type { AnalysisJob } from '../types/api'
import { preloadPage } from '../routes/pages'
import { PAGE_DATA } from '../utils/prefetch'
import { UNREACHABLE_AFTER } from './IntroPage'
import { UploadPage } from './UploadPage'

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

const zip = (name = 'repo.zip', bytes = 2048) => new File(['P'.repeat(bytes)], name, { type: 'application/zip' })

// Pages load lazily; compile the overview once up front so the first test that opens it
// does not spend its wait on the test environment's on-demand compilation.
beforeAll(() => preloadPage('OverviewPage'), 60_000)

describe('Intro page', () => {
  it('greets visitors at the root, wakes the server and offers sign-up and sign-in', async () => {
    const requests = mockApi({ 'GET /health': { status: 200, data: { status: 'ok' } } })
    renderWithProviders(<App />, { route: '/' })
    expect(await screen.findByRole('heading', { level: 1, name: /See inside any codebase/ })).toBeTruthy()
    expect((await screen.findByText('Server online')).closest('[role="status"]')).toBeTruthy()
    expect(requests.some((r) => r.method === 'GET' && r.url === '/health')).toBe(true)
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('link', { name: 'Get started' }).getAttribute('href')).toBe('/register')
    expect(within(header).getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
    expect(screen.getByRole('link', { name: /Analyze your first repository/ }).getAttribute('href')).toBe('/register')
    // Every step and module is listed, and reveals show at once without IntersectionObserver.
    for (const step of ['Upload', 'Analyze', 'Review', 'Report']) {
      expect(screen.getByRole('heading', { level: 3, name: step })).toBeTruthy()
    }
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(12)
    const hidden = document.querySelectorAll('.reveal:not(.is-visible)')
    expect(hidden).toHaveLength(0)
  })

  it('keeps waking a slow server, and says it is unreachable only after repeated failures', async () => {
    mockApi({ 'GET /health': { status: 503, data: { detail: 'down' } } })
    const { queryClient } = renderWithProviders(<App />, { route: '/welcome' })
    expect(screen.getByText('Waking the server…')).toBeTruthy()
    expect(await screen.findByText('Still waking the server…')).toBeTruthy()
    for (let attempt = 2; attempt <= UNREACHABLE_AFTER; attempt += 1) {
      await queryClient.refetchQueries({ queryKey: ['health'] })
    }
    expect(await screen.findByText('Server unreachable')).toBeTruthy()
  })

  it('offers signed-in users the app instead of sign-up', async () => {
    setToken('test-token')
    mockApi({ 'GET /auth/me': { status: 200, data: USER }, 'GET /health': { status: 200, data: { status: 'ok' } } })
    renderWithProviders(<App />, { route: '/welcome' })
    const header = screen.getByRole('banner')
    expect((await within(header).findByRole('link', { name: 'Open the app' })).getAttribute('href')).toBe('/overview')
    expect(within(header).queryByRole('link', { name: 'Get started' })).toBeNull()
    const ctas = screen.getAllByRole('link', { name: /Upload a repository/ })
    expect(ctas).toHaveLength(2)
    ctas.forEach((link) => expect(link.getAttribute('href')).toBe('/upload'))
  })

  it('shows the boot screen while a saved session is checked, then the overview', async () => {
    setToken('test-token')
    mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
    })
    renderWithProviders(<App />, { route: '/' })
    expect(screen.getByRole('status').textContent).toBe('Checking your session…')
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeTruthy()
  })

  it('links the sign-in logo back to the intro', async () => {
    mockApi({ 'GET /health': { status: 200, data: { status: 'ok' } } })
    renderWithProviders(<App />, { route: '/login' })
    const home = screen.getAllByRole('link', { name: /CodeBase Analysis/ })
    expect(home.length).toBeGreaterThan(0)
    home.forEach((link) => expect(link.getAttribute('href')).toBe('/'))
  })
})

describe('Prefetching', () => {
  it('loads a page’s data when its menu link is hovered, before it is opened', async () => {
    setToken('test-token')
    const requests = mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
      'GET /security': { status: 200, data: { repositories: [] } },
      'GET /complexity': { status: 200, data: { repositories: [] } },
    })
    renderWithProviders(<App />, { route: '/overview' })
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]
    expect(requests.some((r) => r.url === '/security')).toBe(false)
    fireEvent.mouseEnter(within(nav).getByRole('link', { name: 'Security' }))
    await waitFor(() => expect(requests.filter((r) => r.url === '/security')).toHaveLength(1))
    // A second hover within the freshness window does not repeat the request.
    fireEvent.mouseEnter(within(nav).getByRole('link', { name: 'Security' }))
    fireEvent.focus(within(nav).getByRole('link', { name: 'Complexity' }))
    await waitFor(() => expect(requests.some((r) => r.url === '/complexity')).toBe(true))
    expect(requests.filter((r) => r.url === '/security')).toHaveLength(1)
    // Every menu link has data to prefetch.
    for (const link of within(nav).getAllByRole('link')) {
      expect(PAGE_DATA[link.getAttribute('href') ?? '']?.length ?? 0).toBeGreaterThan(0)
    }
  })
})

describe('Upload socket', () => {
  it('plugs a dropped ZIP into the socket and lights the step track', async () => {
    mockApi({ 'GET /projects': { status: 200, data: [PROJECT] } })
    mount(<UploadPage />, '/upload')
    await screen.findByRole('option', { name: PROJECT.name })
    const track = screen.getByRole('list', { name: 'Form progress' })
    expect(within(track).getByText('Project').textContent).toBe('Project (done)')
    expect(within(track).getByText('Repository').textContent).toBe('Repository (to do)')
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'api' } })
    expect(within(track).getByText('Repository').textContent).toBe('Repository (done)')

    const zone = screen.getByText('Drop a ZIP here').closest('label')!.parentElement!
    fireEvent.dragOver(zone, { dataTransfer: { files: [], dropEffect: 'none' } })
    expect(screen.getByText('Release to plug it in')).toBeTruthy()
    fireEvent.dragLeave(zone)
    expect(screen.getByText('Drop a ZIP here')).toBeTruthy()
    fireEvent.drop(zone, { dataTransfer: { files: [zip('repo.zip', 2048)], dropEffect: 'none' } })
    expect(screen.getByText('repo.zip')).toBeTruthy()
    expect(screen.getByText(/2\.0 KB · plugged in/)).toBeTruthy()
    expect(within(track).getByText('Archive').textContent).toBe('Archive (done)')

    fireEvent.drop(zone, { dataTransfer: { files: [zip('notes.txt', 10)], dropEffect: 'none' } })
    expect(screen.getByText(/Not a \.zip archive/)).toBeTruthy()
    expect(within(track).getByText('Archive').textContent).toBe('Archive (to do)')
    fireEvent.click(screen.getByRole('button', { name: 'Import repository' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The file must be a .zip archive')
  })

  it('checks a GitHub link as it is typed', async () => {
    mockApi({ 'GET /projects': { status: 200, data: [PROJECT] } })
    mount(<UploadPage />, '/upload')
    await screen.findByRole('option', { name: PROJECT.name })
    fireEvent.click(screen.getByLabelText('Public GitHub repository'))
    const track = screen.getByRole('list', { name: 'Form progress' })
    fireEvent.change(screen.getByLabelText('GitHub repository URL'), { target: { value: 'https://gitlab.com/a/b' } })
    expect(screen.getByText('Format: https://github.com/owner/repository')).toBeTruthy()
    expect(within(track).getByText('GitHub link').textContent).toBe('GitHub link (to do)')
    fireEvent.change(screen.getByLabelText('GitHub repository URL'), { target: { value: 'https://github.com/pallets/flask' } })
    expect(screen.getByText('Looks like a public GitHub repository')).toBeTruthy()
    expect(within(track).getByText('GitHub link').textContent).toBe('GitHub link (done)')
  })

  it('shows each import stage while it runs', async () => {
    mockApi({
      'GET /projects': { status: 200, data: [PROJECT] },
      [`POST /projects/${PROJECT.id}/repositories`]: { status: 201, data: ZIP_REPOSITORY },
      [`POST /projects/${PROJECT.id}/repositories/${ZIP_REPOSITORY.id}/ingest`]: { status: 202, data: { job_id: 'j', repository_id: ZIP_REPOSITORY.id, status: 'pending' } },
    })
    mount(<UploadPage />, '/upload')
    await screen.findByRole('option', { name: PROJECT.name })
    fireEvent.change(screen.getByLabelText('Repository name'), { target: { value: 'api' } })
    fireEvent.change(screen.getByLabelText('ZIP archive'), { target: { files: [zip()] } })
    fireEvent.click(screen.getByRole('button', { name: 'Import repository' }))
    const stages = await screen.findByRole('list', { name: 'Import progress' })
    expect(within(stages).getAllByRole('listitem').map((item) => item.textContent?.replace(/\d+%/, ''))).toEqual([
      'Create the repository',
      'Upload the archive',
      'Open the repository',
    ])
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(`/projects/${PROJECT.id}/repositories/${ZIP_REPOSITORY.id}`),
    )
  })
})

describe('Job stages', () => {
  const base: AnalysisJob = {
    id: 'job-1',
    project_id: PROJECT.id,
    repository_id: ZIP_REPOSITORY.id,
    job_type: 'ingestion',
    status: 'processing',
    progress: 40,
    error_message: null,
    created_at: '2026-11-17T10:00:00Z',
    started_at: null,
    completed_at: null,
  }
  const url = `/projects/${PROJECT.id}/repositories/${ZIP_REPOSITORY.id}/jobs`

  function stageColors() {
    return ['Queued', 'Processing', 'Done'].map((label) =>
      screen.getByText(label).className.includes('text-indigo-300') ? 'lit' : 'dark',
    )
  }

  it('lights the stages the job has reached and fills the trace with its progress', async () => {
    mockApi({ [`GET ${url}`]: { status: 200, data: [base] } })
    mount(<JobProgress projectId={PROJECT.id} repositoryId={ZIP_REPOSITORY.id} pollIntervalMs={60_000} />)
    await screen.findByTestId('job-progress')
    expect(stageColors()).toEqual(['lit', 'lit', 'dark'])
    expect(document.querySelector('[style*="width: 40%"]')).toBeTruthy()
  })

  it('keeps Done dark when the job failed', async () => {
    mockApi({ [`GET ${url}`]: { status: 200, data: [{ ...base, status: 'failed', error_message: 'Bad archive' }] } })
    mount(<JobProgress projectId={PROJECT.id} repositoryId={ZIP_REPOSITORY.id} pollIntervalMs={60_000} />)
    await screen.findByText('Bad archive')
    expect(stageColors()).toEqual(['lit', 'lit', 'dark'])
  })

  it('lights every stage once the job is complete, and only Queued while pending', async () => {
    mockApi({ [`GET ${url}`]: { status: 200, data: [{ ...base, status: 'completed', progress: 100 }] } })
    mount(<JobProgress projectId={PROJECT.id} repositoryId={ZIP_REPOSITORY.id} pollIntervalMs={60_000} />)
    await screen.findByTestId('job-progress')
    expect(stageColors()).toEqual(['lit', 'lit', 'lit'])
  })

  it('lights only Queued while the job waits', async () => {
    mockApi({ [`GET ${url}`]: { status: 200, data: [{ ...base, status: 'pending', progress: 0 }] } })
    mount(<JobProgress projectId={PROJECT.id} repositoryId={ZIP_REPOSITORY.id} pollIntervalMs={60_000} />)
    await screen.findByTestId('job-progress')
    expect(stageColors()).toEqual(['lit', 'dark', 'dark'])
  })
})
