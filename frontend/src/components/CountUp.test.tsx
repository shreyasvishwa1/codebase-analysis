import { act, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { COUNT_MS, CountUp, easeOut, formatLike, parseNumber } from './CountUp'

describe('parseNumber and formatLike', () => {
  it.each([
    ['108,570', { prefix: '', value: 108570, decimals: 0, grouped: true, suffix: '' }],
    ['35 s', { prefix: '', value: 35, decimals: 0, grouped: false, suffix: ' s' }],
    ['80%', { prefix: '', value: 80, decimals: 0, grouped: false, suffix: '%' }],
    ['~2.50%', { prefix: '~', value: 2.5, decimals: 2, grouped: false, suffix: '%' }],
    ['-3', { prefix: '', value: -3, decimals: 0, grouped: false, suffix: '' }],
    ['1,234.5 lines', { prefix: '', value: 1234.5, decimals: 1, grouped: true, suffix: ' lines' }],
  ])('reads %s', (text, parsed) => {
    expect(parseNumber(text)).toEqual(parsed)
    expect(formatLike(parsed, parsed.value)).toBe(text)
  })

  it('leaves text without a number alone', () => {
    expect(parseNumber('—')).toBeNull()
    expect(parseNumber('Not scored')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('9'.repeat(400))).toBeNull() // too large to count
  })

  it('formats in-between values like the target', () => {
    const parsed = parseNumber('1,234.5 lines')!
    expect(formatLike(parsed, 1000)).toBe('1,000.0 lines')
    expect(formatLike(parseNumber('5000')!, 4321)).toBe('4321') // no grouping if the target has none
  })

  it('eases out from 0 to 1', () => {
    expect(easeOut(0)).toBe(0)
    expect(easeOut(0.5)).toBe(0.875)
    expect(easeOut(1)).toBe(1)
  })
})

describe('CountUp', () => {
  let frames: FrameRequestCallback[] = []
  let ids: number[] = []
  let nextId = 0
  let now = 0

  function allowMotion(reduce = false) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce') }))
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      nextId += 1
      frames.push(callback)
      ids.push(nextId)
      return nextId
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      const at = ids.indexOf(id)
      if (at >= 0) {
        frames.splice(at, 1)
        ids.splice(at, 1)
      }
    })
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  }

  /** Runs the waiting frames at `at` milliseconds after the start. */
  function frame(at: number) {
    now = at
    const waiting = frames
    frames = []
    ids = []
    act(() => waiting.forEach((callback) => callback(at)))
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    frames = []
    ids = []
    now = 0
  })

  it('shows the text at once without motion support (as in tests) or with reduced motion', () => {
    const { container, unmount } = render(<CountUp>108,570</CountUp>)
    expect(container.innerHTML).toBe('108,570')
    unmount()
    allowMotion(true)
    const reduced = render(<CountUp>108,570</CountUp>)
    expect(reduced.container.innerHTML).toBe('108,570')
    expect(frames).toHaveLength(0)
  })

  it('counts up to the value, with the final text for screen readers meanwhile', () => {
    allowMotion()
    const { container } = render(<CountUp>1,000 files</CountUp>)
    const visible = () => container.querySelector('[aria-hidden="true"]')?.textContent
    expect(visible()).toBe('0 files')
    expect(container.querySelector('.sr-only')?.textContent).toBe('1,000 files')
    frame(COUNT_MS / 2)
    expect(visible()).toBe('875 files')
    frame(COUNT_MS * 0.95)
    expect(visible()).toBe('1,000 files') // nearly there, still counting
    expect(container.querySelector('.sr-only')).toBeTruthy()
    frame(COUNT_MS)
    expect(container.innerHTML).toBe('1,000 files')
    expect(frames).toHaveLength(0)
  })

  it('counts from the shown value to a new one, and not at all for the same value', () => {
    allowMotion()
    const { container, rerender } = render(<CountUp>10</CountUp>)
    frame(COUNT_MS)
    expect(container.innerHTML).toBe('10')
    rerender(<CountUp>20</CountUp>)
    const visible = () => container.querySelector('[aria-hidden="true"]')?.textContent
    frame(COUNT_MS + COUNT_MS / 2)
    expect(visible()).toBe('19') // 10 + 10 × 0.875, rounded
    frame(COUNT_MS * 2)
    expect(container.innerHTML).toBe('20')
    rerender(<CountUp>20</CountUp>)
    expect(frames).toHaveLength(0)
    expect(container.innerHTML).toBe('20')
  })

  it('turns to a new value from wherever the count is, and does not count to zero', () => {
    allowMotion()
    const { container, rerender } = render(<CountUp>100</CountUp>)
    frame(COUNT_MS / 2) // 87.5 shown
    rerender(<CountUp>200</CountUp>) // the new count starts now, from 87.5
    frame(COUNT_MS)
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('186') // 87.5 + 112.5 × 0.875
    frame(COUNT_MS * 1.5)
    expect(container.innerHTML).toBe('200')
    const zero = render(<CountUp>0</CountUp>)
    expect(frames).toHaveLength(0)
    expect(zero.container.innerHTML).toBe('0')
  })

  it('keeps decimals while counting, and shows text without a number as it is', () => {
    allowMotion()
    const { container } = render(<CountUp>2.50%</CountUp>)
    frame(COUNT_MS / 2)
    expect(container.querySelector('[aria-hidden="true"]')?.textContent).toBe('2.19%')
    const dash = render(<CountUp>—</CountUp>)
    expect(dash.container.innerHTML).toBe('—')
  })

  it('draws plain text inside SVG', () => {
    allowMotion()
    const { container } = render(
      <svg>
        <text>
          <CountUp plain>54</CountUp>
        </text>
      </svg>,
    )
    expect(container.querySelector('text')?.innerHTML).toBe('0')
    frame(COUNT_MS)
    expect(container.querySelector('text')?.innerHTML).toBe('54')
  })
})
