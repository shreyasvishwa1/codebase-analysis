import { act, render, screen, waitFor } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoardSceneOptions } from './boardScene'
import { Board3D, supportsWebGL } from './Board3D'
import { HEALTH, INPUTS, OUTPUTS, pointAlong, polylineLength, tracePoints } from './circuitLayout'
import { PageSkeleton } from './PageSkeleton'

// The real scene needs WebGL; here a stand-in records what the component asks of it.
const scene = vi.hoisted(() => ({
  options: null as BoardSceneOptions | null,
  dispose: vi.fn(),
  fail: false,
  resolve: null as null | (() => void),
}))
vi.mock('./boardScene', () => ({
  createBoardScene: (_canvas: HTMLCanvasElement, _host: HTMLElement, options: BoardSceneOptions) => {
    scene.options = options
    if (scene.fail) return Promise.reject(new Error('no context'))
    return new Promise((resolve) => {
      scene.resolve = () => resolve({ dispose: scene.dispose })
    })
  },
}))

function withWebGL(available: boolean) {
  if (available) {
    vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {})
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as RenderingContext)
  } else {
    vi.stubGlobal('WebGLRenderingContext', undefined)
  }
}

beforeEach(() => {
  scene.options = null
  scene.dispose.mockReset()
  scene.fail = false
  scene.resolve = null
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const mount = (onSelect?: Parameters<typeof Board3D>[0]['onSelect']) =>
  render(
    <MemoryRouter>
      <Board3D onSelect={onSelect} />
    </MemoryRouter>,
  )

describe('circuit layout', () => {
  it('reads trace paths into points', () => {
    expect(tracePoints('M140 47 H194 L200 53 V144 L206 150 H230')).toEqual([
      [140, 47], [194, 47], [200, 53], [200, 144], [206, 150], [230, 150],
    ])
    expect(tracePoints('M1.5 -2 L3 4')).toEqual([[1.5, -2], [3, 4]])
    expect(() => tracePoints('M0 0 C1 1')).toThrow('Unsupported trace command C')
    expect(() => tracePoints('M0')).toThrow('Bad number')
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

describe('Board3D', () => {
  it('keeps the flat board when WebGL is missing', () => {
    withWebGL(false)
    expect(supportsWebGL()).toBe(false)
    mount()
    expect(screen.getByRole('img', { name: /feed one health score/ })).toBeTruthy()
    expect(screen.queryByTestId('board-3d')).toBeNull()
    expect(scene.options).toBeNull()
  })

  it('treats a browser that cannot create a context as missing WebGL', () => {
    vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {})
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(supportsWebGL()).toBe(false)
  })

  it('shows the flat board while the 3D scene loads, then fades the scene in', async () => {
    withWebGL(true)
    mount()
    const canvas = screen.getByTestId('board-3d')
    expect(canvas.className).toContain('opacity-0')
    expect(screen.getByRole('img', { name: /feed one health score/ })).toBeTruthy()
    await waitFor(() => expect(scene.resolve).not.toBeNull())
    expect(scene.options?.reducedMotion).toBe(false)
    act(() => scene.resolve!())
    await waitFor(() => expect(canvas.className).toContain('opacity-100'))
    expect(screen.getByText(/Drag to turn the board/)).toBeTruthy()
  })

  it('names the hovered chip and reports clicks', async () => {
    withWebGL(true)
    const onSelect = vi.fn()
    mount(onSelect)
    await waitFor(() => expect(scene.resolve).not.toBeNull())
    act(() => scene.resolve!())
    await screen.findByText(/Drag to turn the board/)
    act(() => scene.options!.onHover(INPUTS[1]))
    const caption = document.querySelector('[aria-live="polite"]')!
    expect(caption.textContent).toBe(`U2${INPUTS[1].description}`)
    act(() => scene.options!.onSelect(INPUTS[1]))
    expect(onSelect).toHaveBeenCalledWith(INPUTS[1])
    act(() => scene.options!.onHover(null))
    expect(screen.getByText(/Drag to turn the board/)).toBeTruthy()
  })

  it('falls back to the flat board if the scene fails', async () => {
    withWebGL(true)
    scene.fail = true
    mount()
    await waitFor(() => expect(screen.queryByTestId('board-3d')).toBeNull())
    expect(screen.getByRole('img', { name: /feed one health score/ })).toBeTruthy()
  })

  it('disposes the scene when it unmounts, and a scene that arrives after unmounting', async () => {
    withWebGL(true)
    const first = mount()
    await waitFor(() => expect(scene.resolve).not.toBeNull())
    act(() => scene.resolve!())
    await screen.findByText(/Drag to turn the board/)
    first.unmount()
    expect(scene.dispose).toHaveBeenCalledTimes(1)

    scene.resolve = null
    const second = mount()
    await waitFor(() => expect(scene.resolve).not.toBeNull())
    second.unmount()
    expect(scene.dispose).toHaveBeenCalledTimes(1)
    await act(async () => scene.resolve!())
    await waitFor(() => expect(scene.dispose).toHaveBeenCalledTimes(2))
  })

  it('asks for a still scene under reduced motion', async () => {
    withWebGL(true)
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
    )
    mount()
    await waitFor(() => expect(scene.options?.reducedMotion).toBe(true))
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
