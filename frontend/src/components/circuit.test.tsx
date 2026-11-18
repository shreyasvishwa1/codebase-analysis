import { act, fireEvent, render, screen } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IntroPage } from '../pages/IntroPage'
import { mockApi } from '../test/mockApi'
import { renderWithProviders } from '../test/render'
import { CircuitIllustration } from './AuthLayout'
import { HEALTH, INPUTS, OUTPUTS, pointAlong, polylineLength, TRACE_TILE, tracePaths, tracePoints } from './circuitLayout'
import { DENSITY, LiveTraces, pulseHead, spawnPulse, stepPulse } from './LiveTraces'
import { PageSkeleton } from './PageSkeleton'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('circuit layout', () => {
  it('reads trace paths into points', () => {
    expect(tracePoints('M140 47 H194 L200 53 V144 L206 150 H230')).toEqual([
      [140, 47], [194, 47], [200, 53], [200, 144], [206, 150], [230, 150],
    ])
    expect(tracePoints('M1.5 -2 L3 4')).toEqual([[1.5, -2], [3, 4]])
    expect(() => tracePoints('M0 0 C1 1')).toThrow('Unsupported trace command C')
    expect(() => tracePoints('M0')).toThrow('Bad number')
  })

  it('reads relative commands and one polyline per subpath', () => {
    expect(tracePaths('M0 40h70l20 20v-5M200 0v10')).toEqual([
      [[0, 40], [70, 40], [90, 60], [90, 55]],
      [[200, 0], [200, 10]],
    ])
    expect(tracePaths('m10 10l5 5m1 1h2')).toEqual([
      [[10, 10], [15, 15]],
      [[16, 16], [18, 16]],
    ])
    expect(tracePaths('')).toEqual([])
    expect(tracePoints('')).toEqual([])
  })

  it('splits the background tile into its traces, all inside the tile', () => {
    const paths = tracePaths(TRACE_TILE)
    expect(paths).toHaveLength(6)
    for (const path of paths) {
      for (const [x, y] of path) {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x).toBeLessThanOrEqual(240)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(240)
      }
    }
  })

  it('measures and walks along a polyline', () => {
    const points: [number, number][] = [[0, 0], [3, 0], [3, 4]]
    expect(polylineLength(points)).toBe(7)
    expect(pointAlong(points, -1)).toEqual([0, 0])
    expect(pointAlong(points, 1.5)).toEqual([1.5, 0])
    expect(pointAlong(points, 3)).toEqual([3, 0])
    expect(pointAlong(points, 5)).toEqual([3, 2])
    expect(pointAlong(points, 99)).toEqual([3, 4])
    expect(pointAlong([[1, 1], [1, 1], [2, 1]], 0.5)).toEqual([1.5, 1])
  })

  it('wires every module chip from its edge into the health chip, and the health chip out', () => {
    for (const chip of INPUTS) {
      const points = tracePoints(chip.trace!)
      expect(points[0]).toEqual([chip.x + chip.width, chip.y + chip.height / 2])
      expect(points[points.length - 1][0]).toBe(HEALTH.x)
    }
    for (const chip of OUTPUTS) {
      const points = tracePoints(chip.trace!)
      expect(points[0][0]).toBe(HEALTH.x + HEALTH.width)
      expect(points[points.length - 1]).toEqual([chip.x, chip.y + chip.height / 2])
    }
  })
})

describe('live traces', () => {
  it('spawns pulses on a visible tile and moves them until their tail leaves the trace', () => {
    const values = [0.99, 0.99, 0.6, 0.5] // trace, column, row, speed
    const pulse = spawnPulse(() => values.shift() ?? 0, 500, 300)
    expect(pulse.x).toBe(480) // third of three columns
    expect(pulse.y).toBe(240) // second of two rows
    expect(pulse.speed).toBe(105)
    expect(pulse.at).toBe(0)
    expect(pulseHead(pulse)).toEqual([pulse.x + pulse.points[0][0], pulse.y + pulse.points[0][1]])
    const steps = Math.ceil((pulse.length + pulse.trail) / (pulse.speed * 0.05))
    let alive = true
    let count = 0
    while (alive && count < 10_000) {
      alive = stepPulse(pulse, 0.05)
      count += 1
    }
    expect(count).toBe(steps)
    const end = pulse.points[pulse.points.length - 1]
    expect(pulseHead(pulse)).toEqual([pulse.x + end[0], pulse.y + end[1]])
  })

  it('keeps the app quieter than the intro', () => {
    expect(DENSITY.low.max).toBeLessThan(DENSITY.high.max)
    expect(DENSITY.low.everyMs).toBeGreaterThan(DENSITY.high.everyMs)
  })

  it('draws nothing without motion support or under reduced motion', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    render(<LiveTraces />)
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce') }))
    render(<LiveTraces density="high" />)
    expect(getContext).not.toHaveBeenCalled()
    expect(screen.getAllByTestId('live-traces')).toHaveLength(2)
  })

  it('animates on a 2D context while visible and stops when unmounted', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    const calls: string[] = []
    const gradient = { addColorStop: () => {} }
    const context = new Proxy(
      {},
      {
        get: (_target, name: string) =>
          name === 'createRadialGradient' ? () => gradient : (...args: unknown[]) => calls.push(`${name}:${args.length}`),
        set: () => true,
      },
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as RenderingContext)
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback))
    const cancel = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancel)
    const view = render(<LiveTraces density="high" />)
    expect(frames).toHaveLength(1)
    let now = performance.now()
    for (let i = 0; i < 60; i += 1) {
      now += 40
      frames[frames.length - 1](now)
    }
    expect(calls.filter((call) => call.startsWith('clearRect'))).toHaveLength(60)
    expect(calls.some((call) => call.startsWith('stroke'))).toBe(true)
    expect(calls.some((call) => call.startsWith('arc'))).toBe(true)
    view.unmount()
    expect(cancel).toHaveBeenCalled()
  })
})

describe('interactive board', () => {
  it('names a chip on hover or focus and selects it by click or keyboard', () => {
    const onHover = vi.fn()
    const onSelect = vi.fn()
    render(<CircuitIllustration interaction={{ hovered: 'U2', onHover, onSelect }} />)
    const group = screen.getByRole('group', { name: /feed one health score/ })
    const chips = Array.from(group.querySelectorAll('[role="button"]'))
    expect(chips.map((chip) => chip.getAttribute('data-chip'))).toEqual(['U1', 'U2', 'U3', 'U4', 'U5', 'J1', 'J2', 'U0'])
    const security = screen.getByRole('button', { name: INPUTS[1].description })
    expect(security.querySelector('rect')?.getAttribute('class')).toContain('stroke-indigo-400') // hovered
    expect(screen.getByRole('button', { name: INPUTS[0].description }).querySelector('rect')?.getAttribute('class')).toContain('stroke-slate-600')
    fireEvent.mouseEnter(security)
    expect(onHover).toHaveBeenLastCalledWith(INPUTS[1])
    fireEvent.mouseLeave(security)
    expect(onHover).toHaveBeenLastCalledWith(null)
    const health = screen.getByRole('button', { name: HEALTH.description })
    fireEvent.focus(health)
    expect(onHover).toHaveBeenLastCalledWith(HEALTH)
    fireEvent.blur(health)
    expect(onHover).toHaveBeenLastCalledWith(null)
    fireEvent.click(security)
    fireEvent.keyDown(health, { key: 'Enter' })
    fireEvent.keyDown(health, { key: ' ' })
    fireEvent.keyDown(health, { key: 'a' })
    expect(onSelect.mock.calls.map(([chip]) => chip.ref)).toEqual(['U2', 'U0', 'U0'])
  })

  it('is a plain picture without interaction', () => {
    render(<CircuitIllustration />)
    expect(screen.getByRole('img', { name: /feed one health score/ })).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('names the hovered chip under the intro board and jumps to its card', () => {
    const scrolled: string[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id)
    }
    mockApi({ 'GET /health': { status: 200, data: { status: 'ok' } } })
    renderWithProviders(<IntroPage />)
    expect(screen.getByText(/Hover a chip to see what it checks/)).toBeTruthy()
    const chip = screen.getByRole('button', { name: OUTPUTS[1].description })
    fireEvent.mouseEnter(chip)
    expect(screen.getByText(OUTPUTS[1].description, { selector: 'p' })).toBeTruthy()
    fireEvent.click(chip)
    expect(scrolled).toEqual(['module-J2'])
    expect(document.getElementById('module-J2')?.classList.contains('module-flash')).toBe(true)
    fireEvent.mouseLeave(chip)
    expect(screen.getByText(/Hover a chip to see what it checks/)).toBeTruthy()
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })
})

describe('Lazy pages', () => {
  it('shows the page skeleton while a page file loads', async () => {
    let release: (value: { default: () => JSX.Element }) => void = () => {}
    const Slow = lazy(() => new Promise<{ default: () => JSX.Element }>((resolve) => { release = resolve }))
    render(
      <Suspense fallback={<PageSkeleton />}>
        <Slow />
      </Suspense>,
    )
    expect(screen.getByRole('status').textContent).toBe('Loading the page…')
    await act(async () => release({ default: () => <h1>Loaded</h1> }))
    expect(await screen.findByRole('heading', { name: 'Loaded' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('schedules the background download of every page once per visit', async () => {
    vi.resetModules()
    const idle = vi.fn()
    vi.stubGlobal('requestIdleCallback', idle)
    const pages = await import('../routes/pages')
    pages.preloadPagesWhenIdle()
    pages.preloadPagesWhenIdle()
    expect(idle).toHaveBeenCalledTimes(1)
    expect(idle.mock.calls[0][1]).toEqual({ timeout: 4000 })
  })

  it('falls back to a timer where idle callbacks are missing', async () => {
    vi.resetModules()
    vi.stubGlobal('requestIdleCallback', undefined)
    const timer = vi.spyOn(window, 'setTimeout')
    const pages = await import('../routes/pages')
    // 'requestIdleCallback' in window is still true for a stubbed undefined, so delete it.
    delete (window as { requestIdleCallback?: unknown }).requestIdleCallback
    pages.preloadPagesWhenIdle()
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 1500)
  })

  it('maps every main menu path to a page that loads', async () => {
    const { PATH_PAGES, PAGE_NAMES, preloadPage } = await import('../routes/pages')
    for (const name of Object.values(PATH_PAGES)) expect(PAGE_NAMES).toContain(name)
    await expect(preloadPage('SettingsPage')).resolves.toBeUndefined()
  }, 60_000)
})
