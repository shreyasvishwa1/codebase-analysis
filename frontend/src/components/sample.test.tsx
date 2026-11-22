import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { UploadPage } from '../pages/UploadPage'
import { mockApi, PROJECT, ZIP_REPOSITORY } from '../test/mockApi'
import { createTestQueryClient } from '../test/render'
import { SAMPLE, SampleImport } from './SampleImport'

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function mount() {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={['/upload']}>
        <Routes>
          <Route path="*" element={<UploadPage />} />
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const SAMPLES = { ...PROJECT, id: '44444444-4444-4444-4444-444444444444', name: 'Samples' }
const SAMPLE_REPO = { ...ZIP_REPOSITORY, id: '55555555-5555-5555-5555-555555555555', project_id: SAMPLES.id, name: 'shop-api (sample)' }
const repoPath = `/projects/${SAMPLES.id}/repositories/${SAMPLE_REPO.id}`
const accepted = { status: 202, data: { job_id: 'j', repository_id: SAMPLE_REPO.id, status: 'pending' } }

function serveSample(ok = true) {
  const fetchMock = vi.fn(async () => (ok ? new Response('PK sample') : new Response('missing', { status: 404 })))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('Sample repository', () => {
  it('creates the Samples project and repository, uploads the bundled ZIP and opens it', async () => {
    const fetchMock = serveSample()
    const requests = mockApi({
      'GET /projects': { status: 200, data: [PROJECT] },
      'POST /projects': { status: 201, data: SAMPLES },
      [`GET /projects/${SAMPLES.id}/repositories`]: { status: 200, data: [] },
      [`POST /projects/${SAMPLES.id}/repositories`]: { status: 201, data: SAMPLE_REPO },
      [`POST ${repoPath}/ingest`]: accepted,
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Import the sample' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(repoPath))
    expect(fetchMock).toHaveBeenCalledWith(SAMPLE.url)
    const writes = requests.filter((r) => r.method === 'POST')
    expect(writes.map((r) => r.url)).toEqual(['/projects', `/projects/${SAMPLES.id}/repositories`, `${repoPath}/ingest`])
    expect(JSON.parse(writes[0].data as string)).toEqual({ name: 'Samples' })
    expect(JSON.parse(writes[1].data as string)).toEqual({ name: 'shop-api (sample)', source_type: 'zip' })
    const upload = (writes[2].data as FormData).get('file') as File
    expect(upload.name).toBe('shop-api.zip')
    expect(upload.type).toBe('application/zip')
    expect(upload.size).toBe('PK sample'.length)
  })

  it('reuses the Samples project and its repository on a later click and imports again', async () => {
    serveSample()
    const requests = mockApi({
      'GET /projects': { status: 200, data: [PROJECT, SAMPLES] },
      [`GET /projects/${SAMPLES.id}/repositories`]: { status: 200, data: [{ ...SAMPLE_REPO, status: 'ready' }] },
      [`POST ${repoPath}/ingest`]: accepted,
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Import the sample' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(repoPath))
    expect(requests.filter((r) => r.method === 'POST').map((r) => r.url)).toEqual([`${repoPath}/ingest`])
  })

  it('does not take a GitHub repository with the same name for the sample', async () => {
    serveSample()
    const github = { ...SAMPLE_REPO, id: '66666666-6666-6666-6666-666666666666', source_type: 'github' as const }
    const requests = mockApi({
      'GET /projects': { status: 200, data: [SAMPLES] },
      [`GET /projects/${SAMPLES.id}/repositories`]: { status: 200, data: [github] },
      [`POST /projects/${SAMPLES.id}/repositories`]: { status: 201, data: SAMPLE_REPO },
      [`POST ${repoPath}/ingest`]: accepted,
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Import the sample' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(repoPath))
    expect(requests.some((r) => r.method === 'POST' && r.url === `/projects/${SAMPLES.id}/repositories`)).toBe(true)
  })

  it('opens an import already under way instead of uploading again', async () => {
    serveSample()
    const requests = mockApi({
      'GET /projects': { status: 200, data: [SAMPLES] },
      [`GET /projects/${SAMPLES.id}/repositories`]: { status: 200, data: [{ ...SAMPLE_REPO, status: 'processing' }] },
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Import the sample' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(repoPath))
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0)
  })

  it('says so when the bundled archive cannot be loaded, and touches nothing', async () => {
    serveSample(false)
    const requests = mockApi({ 'GET /projects': { status: 200, data: [PROJECT] } })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Import the sample' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The sample archive could not be loaded; try again in a moment')
    expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0)
    expect(screen.getByTestId('location').textContent).toBe('/upload')
    expect((screen.getByRole('button', { name: 'Import the sample' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('waits while the form above it is importing', () => {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>
          <SampleImport disabled />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect((screen.getByRole('button', { name: 'Import the sample' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('ships the archive it fetches with the site', () => {
    expect(SAMPLE.url).toBe('/samples/shop-api.zip')
    expect(Object.keys(import.meta.glob('../../public/samples/*.zip'))).toEqual(['../../public/samples/shop-api.zip'])
  })

  it('shows the server’s reason when the import is refused', async () => {
    serveSample()
    mockApi({
      'GET /projects': { status: 200, data: [SAMPLES] },
      [`GET /projects/${SAMPLES.id}/repositories`]: { status: 200, data: [{ ...SAMPLE_REPO, status: 'ready' }] },
      [`POST ${repoPath}/ingest`]: { status: 409, data: { detail: 'Repository ingestion is already in progress' } },
    })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Import the sample' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Repository ingestion is already in progress')
    expect(screen.getByTestId('location').textContent).toBe('/upload')
  })
})
