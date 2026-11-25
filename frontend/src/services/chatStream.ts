import { AxiosError, type AxiosProgressEvent, type AxiosResponse } from 'axios'

import { apiClient } from './client'

/** Answers can take a while: the AI provider has up to a minute, with retries. */
export const ANSWER_TIMEOUT_MS = 150_000

interface Failure {
  status: number
  detail: string
}

/**
 * Reads server-sent events as they arrive: `delta` events add to the answer's text (reported
 * through `onText` with everything so far), `done` carries the stored result, `error` the
 * provider's failure. `push` takes the whole response received so far; only new events count.
 */
export function createEventReader<T>(onText: (text: string) => void) {
  let consumed = 0
  let text = ''
  let result: T | undefined
  let failure: Failure | undefined

  function handle(block: string) {
    let name = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
    }
    let payload: unknown
    try {
      payload = JSON.parse(data.join('\n'))
    } catch {
      return // not ours: ignored
    }
    if (name === 'delta' && typeof (payload as { text?: unknown }).text === 'string') {
      text += (payload as { text: string }).text
      onText(text)
    } else if (name === 'done') {
      result = payload as T
    } else if (name === 'error') {
      const { status, detail } = payload as Partial<Failure>
      failure = { status: typeof status === 'number' ? status : 502, detail: typeof detail === 'string' ? detail : 'The AI service is unavailable' }
    }
  }

  return {
    push(received: string) {
      const normalized = received.replace(/\r\n/g, '\n')
      let end = normalized.indexOf('\n\n', consumed)
      while (end !== -1) {
        handle(normalized.slice(consumed, end))
        consumed = end + 2
        end = normalized.indexOf('\n\n', consumed)
      }
    },
    finish(received: string): { result?: T; failure?: Failure } {
      this.push(received.endsWith('\n\n') ? received : `${received}\n\n`)
      return { result, failure }
    },
  }
}

/** Event streams stay text; JSON bodies (the errors before a stream starts) are parsed. */
export function parseUnlessEvents(data: unknown, headers?: Record<string, unknown>): unknown {
  const type = String(headers?.['content-type'] ?? '')
  if (typeof data === 'string' && type.includes('json')) {
    try {
      return JSON.parse(data)
    } catch {
      return data
    }
  }
  return data
}

/** What the browser's request has received so far (XMLHttpRequest progress events). */
function receivedSoFar(event: AxiosProgressEvent): string | null {
  const target = (event.event as { target?: { responseText?: unknown } } | undefined)?.target
  return typeof target?.responseText === 'string' ? target.responseText : null
}

/** A failure carried in the stream, shaped like any other API error for getErrorMessage. */
function streamError(failure: Failure): AxiosError {
  const response = { status: failure.status, statusText: '', headers: {}, config: {}, data: { detail: failure.detail } }
  return new AxiosError(failure.detail, 'ERR_BAD_RESPONSE', undefined, undefined, response as AxiosResponse)
}

/**
 * POSTs a question to a streaming chat endpoint and resolves with the stored result once the
 * answer is complete, reporting the answer's text as it is written. Checks that fail before
 * the answer starts (404, 409, 429, 503) reject like any request; a provider failure during
 * the answer rejects with its status and message.
 */
export async function streamAnswer<T>(url: string, question: string, onText: (text: string) => void = () => {}): Promise<T> {
  const reader = createEventReader<T>(onText)
  const response = await apiClient.post<string>(
    url,
    { question },
    {
      timeout: ANSWER_TIMEOUT_MS,
      headers: { Accept: 'text/event-stream' },
      responseType: 'text',
      transformResponse: parseUnlessEvents,
      onDownloadProgress: (event) => {
        const received = receivedSoFar(event)
        if (received !== null) reader.push(received)
      },
    },
  )
  const { result, failure } = reader.finish(typeof response.data === 'string' ? response.data : '')
  if (failure) throw streamError(failure)
  if (result === undefined) throw streamError({ status: 502, detail: 'The answer was cut off; try again' })
  return result
}
