import axios, { type InternalAxiosRequestConfig } from 'axios'
import { describe, expect, it } from 'vitest'

import { mockApi } from '../test/mockApi'
import { getErrorMessage } from './client'
import { createEventReader, parseUnlessEvents, streamAnswer } from './chatStream'

const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`

describe('createEventReader', () => {
  it('reports the text so far as pieces arrive, even split mid-event, and keeps the result', () => {
    const texts: string[] = []
    const reader = createEventReader<{ id: string }>((text) => texts.push(text))
    const whole = event('delta', { text: 'Hello ' }) + event('delta', { text: 'world' }) + event('done', { id: 'c1' })
    reader.push(whole.slice(0, 20)) // half of the first event: nothing yet
    expect(texts).toEqual([])
    reader.push(whole.slice(0, 40))
    expect(texts).toEqual(['Hello '])
    reader.push(whole.slice(0, 40)) // the same text again changes nothing
    expect(texts).toEqual(['Hello '])
    expect(reader.finish(whole)).toEqual({ result: { id: 'c1' }, failure: undefined })
    expect(texts).toEqual(['Hello ', 'Hello world'])
  })

  it('reads Windows line ends, a final event without its blank line, and ignores what is not ours', () => {
    const texts: string[] = []
    const reader = createEventReader((text) => texts.push(text))
    const received =
      ': a comment\r\n\r\n' +
      'event: delta\r\ndata: not json\r\n\r\n' +
      'event: delta\r\ndata: {"other": 1}\r\n\r\n' +
      'event: unknown\r\ndata: {"text": "x"}\r\n\r\n' +
      'data: {"text": "no event name"}\r\n\r\n' +
      'event: delta\r\ndata: {"text": "ok"}\r\n\r\n' +
      'event: done\r\ndata: {"id": 2}'
    expect(reader.finish(received)).toEqual({ result: { id: 2 }, failure: undefined })
    expect(texts).toEqual(['ok'])
  })

  it('keeps a failure, with defaults for a malformed one', () => {
    const reader = createEventReader(() => {})
    expect(reader.finish(event('delta', { text: 'a' }) + event('error', { status: 429, detail: 'Slow down' }))).toEqual({
      result: undefined,
      failure: { status: 429, detail: 'Slow down' },
    })
    expect(createEventReader(() => {}).finish(event('error', {})).failure).toEqual({ status: 502, detail: 'The AI service is unavailable' })
  })
})

describe('parseUnlessEvents', () => {
  it('parses JSON bodies and leaves event streams and objects alone', () => {
    expect(parseUnlessEvents('{"detail":"Busy"}', { 'content-type': 'application/json' })).toEqual({ detail: 'Busy' })
    expect(parseUnlessEvents('{oops', { 'content-type': 'application/json' })).toBe('{oops')
    expect(parseUnlessEvents('event: delta\n', { 'content-type': 'text/event-stream' })).toBe('event: delta\n')
    expect(parseUnlessEvents({ already: true }, { 'content-type': 'application/json' })).toEqual({ already: true })
    expect(parseUnlessEvents('{"a":1}')).toBe('{"a":1}')
  })
})

describe('streamAnswer', () => {
  const URL = '/projects/p/repositories/r/chat/conversations/stream'

  it('posts the question, reports the text as the browser receives it, and resolves with the result', async () => {
    const first = event('delta', { text: 'Par' })
    const body = first + event('delta', { text: 'tial' }) + event('done', { id: 'c9' })
    const texts: string[] = []
    let duringRequest: string[] = []
    const requests = mockApi({
      [`POST ${URL}`]: (config: InternalAxiosRequestConfig) => {
        // What the browser's progress events would report along the way.
        config.onDownloadProgress?.({ event: { target: { responseText: first + 'event: del' } } } as never)
        config.onDownloadProgress?.({ event: {} } as never) // no text available: ignored
        duringRequest = [...texts]
        return { status: 200, data: body }
      },
    })
    await expect(streamAnswer(URL, 'Why?', (text) => texts.push(text))).resolves.toEqual({ id: 'c9' })
    expect(duringRequest).toEqual(['Par']) // shown before the response ended
    expect(texts).toEqual(['Par', 'Partial'])
    expect(JSON.parse(String(requests[0].data))).toEqual({ question: 'Why?' })
    expect(requests[0].headers.get('Accept')).toBe('text/event-stream')
  })

  it('rejects with the failure from the stream, readable like any API error', async () => {
    mockApi({ [`POST ${URL}`]: { status: 200, data: event('error', { status: 502, detail: 'The AI service is unavailable' }) } })
    const error = await streamAnswer(URL, 'Why?').catch((e: unknown) => e)
    expect(axios.isAxiosError(error)).toBe(true)
    expect(getErrorMessage(error)).toBe('The AI service is unavailable')
  })

  it('rejects an answer that ended without a result, and checks that failed before it began', async () => {
    mockApi({ [`POST ${URL}`]: { status: 200, data: event('delta', { text: 'half' }) } })
    expect(getErrorMessage(await streamAnswer(URL, 'Why?').catch((e: unknown) => e))).toBe('The answer was cut off; try again')
    mockApi({ [`POST ${URL}`]: { status: 409, data: { detail: 'Run a full analysis of this repository to chat about it' } } })
    expect(getErrorMessage(await streamAnswer(URL, 'Why?').catch((e: unknown) => e))).toBe('Run a full analysis of this repository to chat about it')
    mockApi({ [`POST ${URL}`]: { status: 200, data: { not: 'text' } } })
    expect(getErrorMessage(await streamAnswer(URL, 'Why?').catch((e: unknown) => e))).toBe('The answer was cut off; try again')
  })
})
