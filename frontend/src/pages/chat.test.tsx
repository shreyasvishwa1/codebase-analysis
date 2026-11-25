import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ROUTER_FUTURE } from '../routerFuture'
import { beforeAll, describe, expect, it } from 'vitest'

import App from '../App'
import { AnswerText, MAX_QUESTION_CHARS, SUGGESTIONS } from '../components/ChatPanel'
import { setToken } from '../services/session'
import { mockApi, PROJECT, USER, ZIP_REPOSITORY, type MockResponse } from '../test/mockApi'
import { createTestQueryClient, renderWithProviders } from '../test/render'
import type { AnalysisRun, ChatConversation, ChatOverview, ChatTurn, Repository } from '../types/api'
import { ChatPage } from './ChatPage'
import { RepositoryChatPage } from './RepositoryChatPage'
import { preloadAllPages } from '../routes/pages'

const P = PROJECT.id
const R = ZIP_REPOSITORY.id
const REPO_URL = `/projects/${P}/repositories/${R}`
const RUNS_URL = `${REPO_URL}/analysis-runs`
const CHAT_URL = `${REPO_URL}/chat/conversations`
const READY: Repository = { ...ZIP_REPOSITORY, status: 'ready' }
const INDEX = { chunks: 4431, files: 434, masked_secrets: 10, truncated: false }

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
  architecture: null,
  chat_index: INDEX,
  created_at: '2026-11-18T10:00:00Z',
  ...overrides,
})

const CITATION = { n: 1, path: 'app/auth.py', start_line: 4, end_line: 5, symbol: 'hash_password' }
const turn = (id: string, role: ChatTurn['role'], content: string, extra: Partial<ChatTurn> = {}): ChatTurn => ({
  id,
  role,
  content,
  citations: [],
  created_at: '2026-11-18T10:05:00Z',
  ...extra,
})
const summary = (id: string, title: string, count = 2) => ({
  id,
  project_id: P,
  repository_id: R,
  run_id: 'run-1',
  run_created_at: '2026-11-18T10:00:00Z',
  title,
  created_at: '2026-11-18T10:05:00Z',
  updated_at: '2026-11-18T10:06:00Z',
  message_count: count,
})
const CONVERSATION: ChatConversation = {
  ...summary('c1', 'How are passwords hashed?'),
  messages: [
    turn('m1', 'user', 'How are passwords hashed?'),
    turn('m2', 'assistant', 'With SHA-256 in `hash_password` [1].\n\n- It is fast [1]\n- See [9]', { citations: [CITATION] }),
  ],
}

function Location() {
  const location = useLocation()
  const state = location.state as { openFile?: { path: string; line: number } } | null
  return (
    <output data-testid="location">
      {location.pathname + location.search}
      {state?.openFile ? ` ${state.openFile.path}:${state.openFile.line}` : ''}
    </output>
  )
}

function mountChat(routes: Parameters<typeof mockApi>[0], entry = `${REPO_URL}/chat`) {
  const requests = mockApi({
    [`GET ${REPO_URL}`]: { status: 200, data: READY },
    'GET /chat/status': { status: 200, data: { configured: true } },
    [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
    [`GET ${CHAT_URL}`]: { status: 200, data: { conversations: [summary('c1', 'How are passwords hashed?')] } },
    [`GET ${CHAT_URL}/c1`]: { status: 200, data: CONVERSATION },
    ...routes,
  })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter future={ROUTER_FUTURE} initialEntries={[entry]}>
        <Routes>
          <Route
            path="/projects/:projectId/repositories/:repositoryId/chat"
            element={
              <>
                <RepositoryChatPage />
                <Location />
              </>
            }
          />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return requests
}

const question = () => screen.getByRole('textbox', { name: 'Question' }) as HTMLTextAreaElement
const sendButton = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement


// Signed-in pages load lazily; compile them once up front so navigation tests do not
// spend their waits on the test environment's on-demand compilation.
beforeAll(() => preloadAllPages(), 120_000)

describe('Answer text', () => {
  function renderAnswer(text: string) {
    render(
      <MemoryRouter future={ROUTER_FUTURE}>
        <Routes>
          <Route path="/" element={<AnswerText text={text} citations={[CITATION]} explorer={REPO_URL} />} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('shows paragraphs, lists, code names and linked citations as text', () => {
    renderAnswer('First line\ncontinues [1].\n\n- one `item`\n* two [9]\n\n<b>not bold</b>')
    const paragraphs = document.querySelectorAll('p')
    expect([...paragraphs].map((p) => p.textContent)).toEqual(['First line continues [1].', '<b>not bold</b>'])
    expect(document.querySelector('b')).toBeNull() // never interpreted as HTML
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['one item', 'two [9]'])
    expect(screen.getByText('item').tagName).toBe('CODE')
    expect(screen.getAllByRole('link')).toHaveLength(1) // [9] cites nothing
    fireEvent.click(screen.getByRole('link', { name: 'Source 1: app/auth.py line 4' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL} app/auth.py:4`)
  })

  it('shows headings and bold as text styles, and links citation lists', () => {
    renderAnswer('### Critical findings\n**Hashing:** with `argon2` [1, 9]\n\n- **Note** [9, 8]\n## [1]')
    const paragraphs = [...document.querySelectorAll('p')]
    expect(paragraphs.map((p) => p.textContent)).toEqual(['Critical findings', 'Hashing: with argon2 [1] [9]', '[1]'])
    expect(paragraphs[0].className).toContain('font-semibold') // a heading line, without the #s
    expect(document.querySelector('h1, h2, h3')).toBeNull()
    expect(screen.getByText('Hashing:').tagName).toBe('STRONG')
    expect(screen.getByText('argon2').tagName).toBe('CODE')
    expect(screen.getAllByRole('link', { name: 'Source 1: app/auth.py line 4' })).toHaveLength(2) // [9] is not a link
    expect(screen.getByRole('listitem').textContent).toBe('Note [9, 8]') // a list citing nothing stays text
    expect(screen.getByText('Note').tagName).toBe('STRONG')
  })
})

/** A streamed answer: server-sent events, as the streaming endpoints send them. */
const sse = (...events: [string, unknown][]) => events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('')
const streamed = (result: unknown, ...pieces: string[]) => ({
  status: 200,
  data: sse(...pieces.map((text): [string, unknown] => ['delta', { text }]), ['done', result]),
})

describe('Repository chat', () => {
  it('starts a conversation and shows the answer with its sources', async () => {
    let listed = 0
    const requests = mountChat({
      [`GET ${CHAT_URL}`]: () => {
        listed += 1
        return { status: 200, data: { conversations: listed > 1 ? [summary('c1', 'How are passwords hashed?')] : [] } }
      },
      [`POST ${CHAT_URL}/stream`]: streamed(CONVERSATION, 'With SHA-256 ', 'in hash_password.'),
    })
    expect(await screen.findByText('No conversations yet.')).toBeTruthy()
    expect(await screen.findByText(/indexed 4,431 passages from 434 files/)).toBeTruthy()
    fireEvent.change(question(), { target: { value: '  How are passwords hashed?  ' } })
    expect(screen.getByText('29 / 2,000')).toBeTruthy()
    fireEvent.keyDown(question(), { key: 'Enter' })
    expect(await screen.findByRole('status')).toBeTruthy() // the question is being answered
    const answer = await screen.findByRole('article', { name: 'Answer' })
    expect(JSON.parse(String(requests.find((r) => r.method === 'POST')?.data))).toEqual({ question: 'How are passwords hashed?' })
    expect(within(answer).getByText('hash_password', { selector: 'code' })).toBeTruthy()
    const sources = within(answer).getByRole('list', { name: 'Sources' })
    expect(sources.textContent).toBe('[1]app/auth.py:4-5hash_password')
    expect(question().value).toBe('')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/chat?conversation=c1`))
    expect(await screen.findByRole('button', { name: /^How are passwords hashed\?/ })).toBeTruthy() // listed
    expect(screen.getByText('About the analysis of ' + new Date('2026-11-18T10:00:00Z').toLocaleString())).toBeTruthy()
    fireEvent.click(within(answer).getAllByRole('link', { name: 'Source 1: app/auth.py line 4' })[0])
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL} app/auth.py:4`)
  })

  it('asks a suggested question', async () => {
    const requests = mountChat({ [`POST ${CHAT_URL}/stream`]: streamed(CONVERSATION) })
    const suggestions = within(await screen.findByLabelText('Suggested questions'))
    await waitFor(() => expect((suggestions.getAllByRole('button')[0] as HTMLButtonElement).disabled).toBe(false))
    expect(suggestions.getAllByRole('button').map((b) => b.textContent)).toEqual(SUGGESTIONS)
    fireEvent.click(suggestions.getByRole('button', { name: SUGGESTIONS[1] }))
    await screen.findByRole('article', { name: 'Answer' })
    expect(JSON.parse(String(requests.find((r) => r.method === 'POST')?.data))).toEqual({ question: SUGGESTIONS[1] })
  })

  it('continues a conversation', async () => {
    let count = 2
    const requests = mountChat(
      {
        [`GET ${CHAT_URL}`]: () => ({ status: 200, data: { conversations: [summary('c1', 'How are passwords hashed?', count)] } }),
        [`POST ${CHAT_URL}/c1/messages/stream`]: () => {
          count = 4
          return streamed(
            {
              conversation: summary('c1', 'How are passwords hashed?', 4),
              messages: [turn('m3', 'user', 'Where is it called?'), turn('m4', 'assistant', 'In verify_password.')],
            },
            'In ',
            'verify_password.',
          )
        },
      },
      `${REPO_URL}/chat?conversation=c1`,
    )
    expect(await screen.findByRole('article', { name: 'Answer' })).toBeTruthy()
    const selected = screen.getByRole('button', { name: /^How are passwords hashed\?/ })
    expect(selected.getAttribute('aria-current')).toBe('true')
    expect(screen.queryByLabelText('Suggested questions')).toBeNull()
    const listReads = requests.filter((r) => r.method === 'GET' && r.url === CHAT_URL).length
    fireEvent.change(question(), { target: { value: 'Where is it called?' } })
    fireEvent.click(sendButton())
    expect(await screen.findByText('In verify_password.')).toBeTruthy()
    expect(question().value).toBe('') // the sent question leaves the composer
    const messages = within(screen.getByRole('list', { name: 'Messages' }))
    expect(messages.getAllByRole('listitem').filter((li) => li.parentElement?.getAttribute('aria-label') === 'Messages').map((li) => li.textContent?.slice(0, 20))).toEqual([
      'How are passwords ha', 'With SHA-256 in hash', 'Where is it called?', 'In verify_password.',
    ])  // prettier-ignore
    await waitFor(() => expect(requests.filter((r) => r.method === 'GET' && r.url === CHAT_URL).length).toBe(listReads + 1))
    expect(screen.getByText(/4 messages/)).toBeTruthy()
  })

  it('keeps a question that could not be answered and tries again', async () => {
    let attempts = 0
    const requests = mountChat({
      [`POST ${CHAT_URL}/stream`]: () => {
        attempts += 1
        return attempts === 1
          ? { status: 502, data: { detail: 'The AI service is unavailable; try again later' } }
          : streamed(CONVERSATION)
      },
    })
    await screen.findByText(/indexed 4,431 passages/)
    fireEvent.change(question(), { target: { value: 'Why?' } })
    fireEvent.click(sendButton())
    expect((await screen.findByRole('alert')).textContent).toBe('The AI service is unavailable; try again later')
    expect(screen.getByText('Not answered: “Why?”')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('article', { name: 'Answer' })).toBeTruthy()
    expect(requests.filter((r) => r.method === 'POST').map((r) => JSON.parse(String(r.data)).question)).toEqual(['Why?', 'Why?'])
  })

  it('shows the answer as it is written, then the stored answer with its sources', async () => {
    let finish: (() => void) | undefined
    mountChat({
      [`POST ${CHAT_URL}/stream`]: (config) =>
        new Promise<MockResponse>((resolve) => {
          const body = sse(['delta', { text: 'With **SHA-256** ' }], ['delta', { text: 'in' }])
          config.onDownloadProgress?.({ event: { target: { responseText: body } } } as never)
          finish = () => resolve(streamed(CONVERSATION, 'With **SHA-256** ', 'in'))
        }),
    })
    await screen.findByText(/indexed 4,431 passages/)
    fireEvent.change(question(), { target: { value: 'How are passwords hashed?' } })
    fireEvent.click(sendButton())
    const writing = await screen.findByRole('article', { name: 'Answer being written' })
    expect(writing.textContent).toBe('With SHA-256 in')
    expect(within(writing).getByText('SHA-256', { selector: 'strong' })).toBeTruthy() // formatted as it arrives
    expect(writing.querySelector('.typing-caret')).toBeTruthy()
    expect(screen.getByText('The answer is being written…')).toBeTruthy()
    expect(screen.queryByText('Searching the code and analysis results…')).toBeNull()
    act(() => finish?.())
    const answer = await screen.findByRole('article', { name: 'Answer' })
    expect(within(answer).getByRole('list', { name: 'Sources' })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Answer being written' })).toBeNull()
  })

  it('starts each answer afresh, without the text of the one before', async () => {
    let calls = 0
    mountChat(
      {
        [`POST ${CHAT_URL}/c1/messages/stream`]: () => {
          calls += 1
          if (calls === 1) {
            return streamed({ conversation: summary('c1', 'How are passwords hashed?', 4), messages: [turn('m3', 'user', 'First?'), turn('m4', 'assistant', 'First answer.')] }, 'First answer.')
          }
          return new Promise<MockResponse>(() => {}) // the second answer has not started yet
        },
      },
      `${REPO_URL}/chat?conversation=c1`,
    )
    await screen.findByRole('article', { name: 'Answer' })
    fireEvent.change(question(), { target: { value: 'First?' } })
    fireEvent.click(sendButton())
    expect(await screen.findByText('First answer.')).toBeTruthy()
    fireEvent.change(question(), { target: { value: 'Second?' } })
    fireEvent.click(sendButton())
    expect(await screen.findByText('Searching the code and analysis results…')).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Answer being written' })).toBeNull()
  })

  it('reports an answer that fails while it is written, and keeps the question', async () => {
    let attempts = 0
    mountChat({
      [`POST ${CHAT_URL}/stream`]: () => {
        attempts += 1
        if (attempts === 1) {
          return { status: 200, data: sse(['delta', { text: 'Half an ' }], ['error', { status: 502, detail: 'The AI service is unavailable' }]) }
        }
        return { status: 200, data: sse(['delta', { text: 'Cut off' }]) } // ended without a stored answer
      },
    })
    await screen.findByText(/indexed 4,431 passages/)
    fireEvent.change(question(), { target: { value: 'Why?' } })
    fireEvent.click(sendButton())
    expect((await screen.findByRole('alert')).textContent).toBe('The AI service is unavailable')
    expect(screen.getByText('Not answered: “Why?”')).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Answer being written' })).toBeNull() // nothing half-written stays
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The answer was cut off; try again'))
  })

  it('only sends questions that fit', async () => {
    const requests = mountChat({})
    await screen.findByText(/indexed 4,431 passages/)
    expect(sendButton().disabled).toBe(true)
    fireEvent.change(question(), { target: { value: '   ' } })
    expect(sendButton().disabled).toBe(true)
    fireEvent.change(question(), { target: { value: 'line one' } })
    fireEvent.keyDown(question(), { key: 'Enter', shiftKey: true }) // a new line, not a send
    expect(question().value).toBe('line one') // not sent, so the draft stays
    fireEvent.change(question(), { target: { value: 'x'.repeat(MAX_QUESTION_CHARS + 1) } })
    expect(sendButton().disabled).toBe(true)
    expect(screen.getByText('2,001 / 2,000').className).toContain('text-red-300')
    fireEvent.submit(screen.getByRole('form', { name: 'Ask a question' }))
    expect(requests.some((r) => r.method === 'POST')).toBe(false)
  })

  it('deletes a conversation after confirmation', async () => {
    let deleted = false
    const requests = mountChat(
      {
        [`GET ${CHAT_URL}`]: () => ({ status: 200, data: { conversations: deleted ? [] : [summary('c1', 'How are passwords hashed?')] } }),
        [`DELETE ${CHAT_URL}/c1`]: () => {
          deleted = true
          return { status: 204 }
        },
      },
      `${REPO_URL}/chat?conversation=c1`,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Delete conversation How are passwords hashed?' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(requests.some((r) => r.method === 'DELETE')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Delete conversation How are passwords hashed?' }))
    expect(screen.getByText('Delete this conversation?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('No conversations yet.')).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/chat`)
    expect(await screen.findByLabelText('Suggested questions')).toBeTruthy()
  })

  it('opens a new conversation from an existing one', async () => {
    mountChat({}, `${REPO_URL}/chat?conversation=c1`)
    await screen.findByRole('article', { name: 'Answer' })
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    expect(await screen.findByLabelText('Suggested questions')).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/chat`)
    fireEvent.click(screen.getByRole('button', { name: /^How are passwords hashed\?/ }))
    expect(await screen.findByRole('article', { name: 'Answer' })).toBeTruthy()
  })

  it('explains when the chat is not configured, and history stays readable', async () => {
    mountChat({ 'GET /chat/status': { status: 200, data: { configured: false } } }, `${REPO_URL}/chat?conversation=c1`)
    expect((await screen.findByRole('note')).textContent).toContain('ANTHROPIC_API_KEY or GEMINI_API_KEY')
    expect(await screen.findByRole('article', { name: 'Answer' })).toBeTruthy()
    expect(question().disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }))
    const suggestions = within(await screen.findByLabelText('Suggested questions'))
    expect((suggestions.getAllByRole('button')[0] as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks for a full analysis when none can be used', async () => {
    mountChat({ [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run({ chat_index: null })] } } })
    expect(await screen.findByText(/no analysis the chat can use yet/)).toBeTruthy()
    expect(question().disabled).toBe(true)
    fireEvent.click(screen.getByRole('link', { name: 'Run a full analysis' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/analysis`)
  })

  it('reports conversations that cannot be loaded', async () => {
    mountChat(
      {
        [`GET ${CHAT_URL}`]: { status: 500, data: { detail: 'List failed' } },
        [`GET ${CHAT_URL}/c1`]: { status: 404, data: { detail: 'Conversation not found' } },
      },
      `${REPO_URL}/chat?conversation=c1`,
    )
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent).sort()).toEqual(['Conversation not found', 'List failed']))
  })
})

const OVERVIEW: ChatOverview = {
  configured: true,
  repositories: [
    { project_id: P, project_name: 'Demo project', repository_id: R, repository_name: 'shop', run_id: 'run-1', created_at: '2026-11-18T10:00:00Z', chunks: 4431, files: 434 },
  ],
  conversations: [{ ...summary('c1', 'How are passwords hashed?'), repository_name: 'shop' }],
}

describe('AI chat overview', () => {
  function mountOverview(data: ChatOverview | MockResponse) {
    mockApi({ 'GET /chat': 'status' in data && !('configured' in data) ? (data as MockResponse) : { status: 200, data } })
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter future={ROUTER_FUTURE} initialEntries={['/chat']}>
          <Routes>
            <Route path="/chat" element={<ChatPage />} />
            <Route path="*" element={<Location />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('lists repositories and recent conversations', async () => {
    mountOverview(OVERVIEW)
    const repositories = within(await screen.findByRole('region', { name: 'Repositories ready to chat' }))
    expect(repositories.getByText('4,431 passages from 434 files')).toBeTruthy()
    const recent = within(screen.getByRole('region', { name: 'Recent conversations' }))
    expect(recent.getByText('shop · 2 messages')).toBeTruthy()
    fireEvent.click(recent.getByRole('link', { name: /How are passwords hashed\?/ }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/chat?conversation=c1`)
  })

  it('opens a repository chat', async () => {
    mountOverview(OVERVIEW)
    fireEvent.click(await screen.findByRole('link', { name: 'Chat about shop' }))
    expect(screen.getByTestId('location').textContent).toBe(`${REPO_URL}/chat`)
  })

  it('invites an analysis and explains a missing configuration', async () => {
    mountOverview({ configured: false, repositories: [], conversations: [] })
    expect((await screen.findByRole('note')).textContent).toContain('not configured')
    expect(screen.queryByRole('region', { name: 'Recent conversations' })).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Upload a repository' }))
    expect(screen.getByTestId('location').textContent).toBe('/upload')
  })

  it('reports a failed request', async () => {
    mountOverview({ status: 500, data: { detail: 'Server error' } })
    expect((await screen.findByRole('alert')).textContent).toBe('Server error')
  })
})

describe('AI chat navigation', () => {
  it('opens the chat from the sidebar and a repository section', async () => {
    setToken('test-token')
    mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
      'GET /chat': { status: 200, data: OVERVIEW },
      'GET /chat/status': { status: 200, data: { configured: true } },
      [`GET ${REPO_URL}`]: { status: 200, data: READY },
      [`GET ${RUNS_URL}`]: { status: 200, data: { job: null, runs: [run()] } },
      [`GET ${CHAT_URL}`]: { status: 200, data: { conversations: [] } },
    })
    renderWithProviders(<App />, { route: '/overview' })
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]
    fireEvent.click(within(nav).getByRole('link', { name: 'AI Chat' }))
    expect(await screen.findByRole('heading', { name: 'AI Chat' })).toBeTruthy()
    fireEvent.click(await screen.findByRole('link', { name: 'Chat about shop' }))
    const sections = await screen.findByRole('navigation', { name: 'Repository sections' })
    expect(within(sections).getByRole('link', { name: 'AI chat' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByLabelText('Suggested questions')).toBeTruthy()
  })
})
