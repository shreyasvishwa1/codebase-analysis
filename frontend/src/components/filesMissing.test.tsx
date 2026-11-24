import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ROUTER_FUTURE } from '../routerFuture'
import { describe, expect, it, vi } from 'vitest'

import { queryKeys } from '../hooks/queryKeys'
import { RepositoryPage } from '../pages/RepositoryPage'
import { GITHUB_REPOSITORY, mockApi, PROJECT, ZIP_REPOSITORY } from '../test/mockApi'
import { createTestQueryClient } from '../test/render'
import type { AnalysisJob, Repository, RepositoryStorage } from '../types/api'
import { JobProgress } from './JobProgress'

const P = PROJECT.id

function renderRepository(repository: Repository, storage: RepositoryStorage['files'] | null) {
  const base = `/projects/${P}/repositories/${repository.id}`
  const requests = mockApi({
    [`GET ${base}`]: { status: 200, data: repository },
    ...(storage ? { [`GET ${base}/storage`]: { status: 200, data: { files: storage } } } : {}),
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter future={ROUTER_FUTURE} initialEntries={[base]}>
        <Routes>
          <Route path="/projects/:projectId/repositories/:repositoryId" element={<RepositoryPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return requests
}

const ready = (repository: Repository): Repository => ({ ...repository, status: 'ready' })
const TITLE = 'This repository’s files are no longer on the server'

describe('Files missing notice', () => {
  it('asks for one more ZIP upload, pointing at the Ingestion card, when the files are gone', async () => {
    renderRepository(ready(ZIP_REPOSITORY), 'missing')
    const notice = (await screen.findByRole('heading', { name: TITLE })).closest('section')!
    expect(notice.textContent).toContain('Upload its ZIP once more below.')
    expect(notice.textContent).toContain('never has to be imported again')
    const link = within(notice).getByRole('link', { name: 'Go to Ingestion' })
    expect(link.getAttribute('href')).toBe('#ingestion')
    const target = document.getElementById('ingestion')!
    expect(within(target).getByRole('form', { name: 'Ingest repository' })).toBeTruthy()
  })

  it('offers a GitHub repository a new import without any upload', async () => {
    renderRepository(ready(GITHUB_REPOSITORY), 'missing')
    const notice = (await screen.findByRole('heading', { name: TITLE })).closest('section')!
    expect(notice.textContent).toContain('Import it again from GitHub below; no upload is needed.')
    expect(notice.textContent).not.toContain('ZIP')
  })

  it('stays hidden while the files are available', async () => {
    const requests = renderRepository(ready(ZIP_REPOSITORY), 'available')
    await screen.findByRole('heading', { level: 1, name: ZIP_REPOSITORY.name })
    await waitFor(() => expect(requests.some((r) => r.url.endsWith('/storage'))).toBe(true))
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull()
  })

  it('does not ask about the files before an import has completed', async () => {
    const requests = renderRepository({ ...ZIP_REPOSITORY, status: 'processing' }, null)
    await screen.findByRole('heading', { level: 1, name: ZIP_REPOSITORY.name })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(requests.some((r) => r.url.endsWith('/storage'))).toBe(false)
    expect(screen.queryByRole('heading', { name: TITLE })).toBeNull()
  })

  it('checks the files again when an import finishes, so the notice clears', async () => {
    const R = ZIP_REPOSITORY.id
    let jobCalls = 0
    const job = (status: AnalysisJob['status']): AnalysisJob => ({
      id: 'job-1',
      project_id: P,
      repository_id: R,
      job_type: 'ingestion',
      status,
      progress: status === 'completed' ? 100 : 0,
      error_message: null,
      created_at: '2026-10-02T00:00:00Z',
      started_at: null,
      completed_at: null,
    })
    mockApi({
      [`GET /projects/${P}/repositories/${R}/jobs`]: () => {
        jobCalls += 1
        return { status: 200, data: [job(jobCalls >= 3 ? 'completed' : 'processing')] }
      },
    })
    const queryClient = createTestQueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    render(
      <QueryClientProvider client={queryClient}>
        <JobProgress projectId={P} repositoryId={R} pollIntervalMs={20} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('status-badge').textContent).toBe('completed'))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.storage(P, R), exact: true })
  })
})
