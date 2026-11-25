import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatDateTime } from '../utils/format'
import { RelativeTime, relativeTime, TICK_MS } from './RelativeTime'

const NOW = new Date('2026-11-25T12:00:00Z').getTime()
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MIN = 60_000

describe('relativeTime', () => {
  it.each([
    [0, 'just now'],
    [44_000, 'just now'],
    [45_000, '1 min ago'],
    [89_000, '1 min ago'],
    [90_000, '2 min ago'],
    [59 * MIN, '59 min ago'],
    [60 * MIN, '1 h ago'],
    [23 * 60 * MIN + 59 * MIN, '23 h ago'],
    [24 * 60 * MIN, 'yesterday'],
    [47 * 60 * MIN, 'yesterday'],
    [48 * 60 * MIN, '2 days ago'],
    [6 * 24 * 60 * MIN + 23 * 60 * MIN, '6 days ago'],
  ])('%i ms ago reads "%s"', (elapsed, text) => {
    expect(relativeTime(ago(elapsed), NOW)).toBe(text)
  })

  it('shows the date from a week on, "just now" for a clock slightly ahead, and a dash for no date', () => {
    expect(relativeTime(ago(7 * 24 * 60 * MIN), NOW)).toBe(new Date(NOW - 7 * 24 * 60 * MIN).toLocaleDateString())
    expect(relativeTime(new Date(NOW + 5000).toISOString(), NOW)).toBe('just now')
    expect(relativeTime('not a date', NOW)).toBe('—')
  })
})

describe('RelativeTime', () => {
  afterEach(() => vi.useRealTimers())

  it('keeps itself current, with the exact time on hover', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const iso = ago(40_000)
    render(<RelativeTime iso={iso} />)
    const time = screen.getByText('just now')
    expect(time.tagName).toBe('TIME')
    expect(time.getAttribute('dateTime')).toBe(iso)
    expect(time.getAttribute('title')).toBe(formatDateTime(iso))
    act(() => {
      vi.advanceTimersByTime(TICK_MS)
    })
    expect(time.textContent).toBe('1 min ago')
    act(() => {
      vi.advanceTimersByTime(4 * TICK_MS)
    })
    expect(time.textContent).toBe('3 min ago')
  })
})
