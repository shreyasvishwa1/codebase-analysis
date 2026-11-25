import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { mockApi, type MockResponse } from '../test/mockApi'
import { createTestQueryClient } from '../test/render'
import { CodeExcerpt, CONTEXT_LINES, excerpt, MAX_LINES, SECRET_CWES } from './CodeExcerpt'

const FILE = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n')
const CONTENT_URL = '/projects/p/repositories/r/files/content'

describe('excerpt', () => {
  it(`shows ${CONTEXT_LINES} lines around the finding and marks its lines and its path`, () => {
    const lines = excerpt(FILE, 10, 11, [8, 10])
    expect(lines.map((l) => l.number)).toEqual([8, 9, 10, 11, 12, 13])
    expect(lines.filter((l) => l.flagged).map((l) => l.number)).toEqual([10, 11])
    expect(lines.filter((l) => l.onPath).map((l) => l.number)).toEqual([8, 10])
    expect(lines[0].text).toBe('line 8')
  })

  it('stays within the file, handles Windows line ends, and cuts long spans', () => {
    expect(excerpt('a\r\nb\r\nc', 1, 1).map((l) => [l.number, l.text])).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ])
    expect(excerpt(FILE, 30, 30).map((l) => l.number)).toEqual([28, 29, 30])
    expect(excerpt(FILE, 3, 25)).toHaveLength(MAX_LINES)
    expect(excerpt(FILE, 3, 25)[0].number).toBe(1)
    expect(excerpt(FILE, 5, 2).filter((l) => l.flagged).map((l) => l.number)).toEqual([5]) // end before start
  })

  it('is empty when the line is not in the file', () => {
    expect(excerpt(FILE, 31, 31)).toEqual([])
    expect(excerpt(FILE, 0, 0)).toEqual([])
  })
})

describe('CodeExcerpt', () => {
  function show(response: MockResponse | null, cwe: number | null = 22) {
    const requests = mockApi(response ? { [`GET ${CONTENT_URL}`]: response } : {})
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <CodeExcerpt projectId="p" repositoryId="r" path="web/app.py" line={12} endLine={12} cwe={cwe} pathLines={[10]} />
      </QueryClientProvider>,
    )
    return requests
  }
  const ok = (content: string | null, reason: 'binary' | 'too_large' | null = null): MockResponse => ({
    status: 200,
    data: { path: 'web/app.py', language: 'Python', size_bytes: 10, content, reason },
  })

  it('reads the file through the file API and shows the lines as text', async () => {
    const requests = show(ok(FILE.replace('line 12', '<b>open(name)</b>')))
    const figure = await screen.findByRole('figure', { name: 'Code at web/app.py, line 12' })
    expect(figure.querySelector('[data-flagged]')?.textContent).toBe('12<b>open(name)</b>') // text, not HTML
    expect(figure.querySelector('b')).toBeNull()
    expect(figure.querySelector('[data-on-path]')?.textContent).toBe('10line 10')
    expect(requests[0].url).toBe(CONTENT_URL)
    expect(requests[0].data).toBeUndefined()
  })

  it('treats hard-coded passwords, keys, tokens and committed .env files as secrets', () => {
    expect([...SECRET_CWES].sort((a, b) => a - b)).toEqual([259, 321, 538, 798])
  })

  it.each([259, 321, 538, 798])('never loads the code of a secret finding (CWE-%i)', async (cwe) => {
    const requests = show(ok(FILE), cwe)
    expect(screen.getByText('The code is not shown for findings about secrets, so the value stays hidden.')).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 50)) // time for a request to be sent
    expect(requests).toHaveLength(0)
  })

  it('says why the code is missing', async () => {
    show(ok(null, 'too_large'))
    expect(await screen.findByText('The code is not shown: the file is too large.')).toBeTruthy()
  })

  it('says when the file is not text', async () => {
    show(ok(null, 'binary'))
    expect(await screen.findByText('The code is not shown: the file is not text.')).toBeTruthy()
  })

  it('says when the line is no longer in the stored file', async () => {
    show(ok('only one line'))
    expect(await screen.findByText('The line is no longer in the stored file.')).toBeTruthy()
  })

  it('reports a failed request, after a loading placeholder', async () => {
    show({ status: 409, data: { detail: 'Repository changed during analysis; run it again' } })
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByText('The code could not be loaded: Repository changed during analysis; run it again.')).toBeTruthy(),
    )
  })
})
