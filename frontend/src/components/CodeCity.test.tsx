import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { InternalAxiosRequestConfig } from 'axios'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CITY_FILE_LIMIT, listLargestFiles } from '../services/complexity'
import { mockApi, PROJECT, ZIP_REPOSITORY } from '../test/mockApi'
import { createTestQueryClient } from '../test/render'
import type { ComplexityFile } from '../types/api'
import { buildingHeight, districtOf, FOOTPRINT, layoutCity, MAX_HEIGHT, ROOT, type CityFile } from '../utils/codeCity'
import type { CitySceneOptions } from './cityScene'
import { CodeCity, supportsWebGL } from './CodeCity'

const scene = vi.hoisted(() => ({
  options: null as CitySceneOptions | null,
  buildings: 0,
  dispose: vi.fn(),
  fail: false,
  hold: null as Promise<void> | null,
}))
vi.mock('./cityScene', () => ({
  createCityScene: (_canvas: HTMLCanvasElement, _host: HTMLElement, city: { buildings: unknown[] }, options: CitySceneOptions) => {
    scene.options = options
    scene.buildings = city.buildings.length
    if (scene.fail) return Promise.reject(new Error('no context'))
    return (scene.hold ?? Promise.resolve()).then(() => ({ dispose: scene.dispose }))
  },
}))

const P = PROJECT.id
const R = ZIP_REPOSITORY.id
const RUN = 'run-1'
const FILES_URL = `/projects/${P}/repositories/${R}/analysis-runs/${RUN}/complexity/files`

const file = (path: string, nloc: number, extra: Partial<ComplexityFile> = {}): ComplexityFile => ({
  id: path,
  path,
  language: 'Python',
  nloc,
  functions: 3,
  classes: 0,
  total_cyclomatic: 6,
  max_cyclomatic: 4,
  average_cyclomatic: 2,
  rank: 'low',
  maintainability_index: 72.4,
  maintainability: 'good',
  mi_estimated: false,
  ...extra,
})

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
  scene.buildings = 0
  scene.dispose.mockReset()
  scene.fail = false
  scene.hold = null
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// --- Layout -----------------------------------------------------------------------------------

describe('city layout', () => {
  it('puts a file in the deepest component that contains it', () => {
    // Deepest wins whatever the order the components arrive in.
    const components = ['backend/app/api', 'backend/app', 'backend', ROOT]
    expect(districtOf('backend/app/api/routes.py', components)).toBe('backend/app/api')
    expect(districtOf('backend/app/main.py', components)).toBe('backend/app')
    expect(districtOf('backend/setup.py', components)).toBe('backend')
    expect(districtOf('backendx/a.py', components)).toBe('backendx') // not a prefix match
    expect(districtOf('frontend/src/a.ts', components)).toBe('frontend')
    expect(districtOf('README.py', components)).toBe(ROOT)
  })

  it('scales heights by the square root of the lines', () => {
    expect(buildingHeight(400, 400)).toBe(MAX_HEIGHT)
    expect(buildingHeight(100, 400)).toBeCloseTo(0.35 + (MAX_HEIGHT - 0.35) * 0.5)
    expect(buildingHeight(0, 400)).toBe(0.35)
    expect(buildingHeight(-5, 400)).toBe(0.35)
    expect(buildingHeight(10, 0)).toBe(0.35)
  })

  it('places every file once, in its district, without overlaps, centred on the origin', () => {
    const files: CityFile[] = [
      ...Array.from({ length: 9 }, (_, i) => file(`app/core/m${i}.py`, 10 + i * 30)),
      ...Array.from({ length: 4 }, (_, i) => file(`web/src/c${i}.ts`, 50, { maintainability: i === 0 ? 'poor' : 'moderate', rank: i === 1 ? 'high' : 'low' })),
      file('setup.py', 5, { maintainability: null, maintainability_index: null }),
      file('app/core/medium.py', 7, { rank: 'medium' }),
    ]
    const city = layoutCity(files, ['app/core', 'web/src', ROOT])
    expect(city.buildings).toHaveLength(files.length)
    expect(new Set(city.buildings.map((b) => b.file.path)).size).toBe(files.length)
    expect(city.districts.map((d) => [d.id, d.files])).toEqual([['app/core', 10], ['web/src', 4], [ROOT, 1]]) // most lines first
    expect(city.districts.reduce((sum, d) => sum + d.lines, 0)).toBe(files.reduce((sum, f) => sum + f.nloc, 0))

    // Inside its district, and no two buildings closer than a footprint.
    for (const building of city.buildings) {
      const district = city.districts.find((d) => d.id === building.district)!
      expect(Math.abs(building.x - district.x) + FOOTPRINT / 2).toBeLessThanOrEqual(district.width / 2 + 1e-9)
      expect(Math.abs(building.z - district.z) + FOOTPRINT / 2).toBeLessThanOrEqual(district.depth / 2 + 1e-9)
    }
    for (let i = 0; i < city.buildings.length; i += 1) {
      for (let j = i + 1; j < city.buildings.length; j += 1) {
        const a = city.buildings[i]
        const b = city.buildings[j]
        expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z))).toBeGreaterThanOrEqual(FOOTPRINT)
      }
    }
    // Districts never overlap either.
    for (let i = 0; i < city.districts.length; i += 1) {
      for (let j = i + 1; j < city.districts.length; j += 1) {
        const a = city.districts[i]
        const b = city.districts[j]
        const apart = Math.abs(a.x - b.x) >= (a.width + b.width) / 2 || Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2
        expect(apart).toBe(true)
      }
    }
    const xs = city.districts.flatMap((d) => [d.x - d.width / 2, d.x + d.width / 2])
    const zs = city.districts.flatMap((d) => [d.z - d.depth / 2, d.z + d.depth / 2])
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0)
    expect(Math.min(...zs) + Math.max(...zs)).toBeCloseTo(0)
    expect(city.size).toBeCloseTo(Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)))

    const tallest = city.buildings.find((b) => b.file.path === 'app/core/m8.py')!
    expect(tallest.height).toBe(MAX_HEIGHT)
    expect(city.buildings.find((b) => b.file.path === 'web/src/c0.ts')!.tone).toBe('poor')
    expect(city.buildings.find((b) => b.file.path === 'setup.py')!.tone).toBe('unknown')
    expect(city.buildings.filter((b) => b.beacon).map((b) => b.file.path)).toEqual(['web/src/c1.ts'])
    // Biggest file first inside a district.
    expect(city.buildings.filter((b) => b.district === 'app/core')[0].file.path).toBe('app/core/m8.py')
  })

  it('wraps many districts into a roughly square city', () => {
    const files = Array.from({ length: 16 }, (_, d) => Array.from({ length: 4 }, (_, i) => file(`d${d}/f${i}.py`, 20))).flat()
    const city = layoutCity(files, [])
    expect(city.districts).toHaveLength(16)
    const xs = city.districts.flatMap((d) => [d.x - d.width / 2, d.x + d.width / 2])
    const zs = city.districts.flatMap((d) => [d.z - d.depth / 2, d.z + d.depth / 2])
    const width = Math.max(...xs) - Math.min(...xs)
    const depth = Math.max(...zs) - Math.min(...zs)
    expect(width / depth).toBeGreaterThan(0.6)
    expect(width / depth).toBeLessThan(1.7)
    // Sixteen equal districts make a four-by-four grid.
    expect(new Set(city.districts.map((d) => d.z.toFixed(3))).size).toBe(4)
    expect(new Set(city.districts.map((d) => d.x.toFixed(3))).size).toBe(4)
  })

  it('handles an empty run', () => {
    expect(layoutCity([], [])).toEqual({ districts: [], buildings: [], size: 1 })
  })
})

describe('largest files', () => {
  it('pages through the largest files up to the limit', async () => {
    const all = Array.from({ length: 450 }, (_, i) => file(`f${i}.py`, 1000 - i))
    const asked: unknown[] = []
    mockApi({
      [`GET ${FILES_URL}`]: (config: InternalAxiosRequestConfig) => {
        const { page, page_size } = config.params as { page: number; page_size: number }
        asked.push(config.params)
        return { status: 200, data: { items: all.slice((page - 1) * page_size, page * page_size), total: all.length, page, page_size } }
      },
    })
    const result = await listLargestFiles(P, R, RUN)
    expect(result.items).toHaveLength(CITY_FILE_LIMIT)
    expect(result.items[0].path).toBe('f0.py')
    expect(result.items[CITY_FILE_LIMIT - 1].path).toBe(`f${CITY_FILE_LIMIT - 1}.py`)
    expect(result.total).toBe(450)
    expect(asked).toEqual([
      { page: 1, page_size: 200, sort: 'size' },
      { page: 2, page_size: 200, sort: 'size' },
    ])
  })

  it('stops after the last page', async () => {
    const calls: number[] = []
    mockApi({
      [`GET ${FILES_URL}`]: (config: InternalAxiosRequestConfig) => {
        const { page, sort } = config.params as { page: number; sort: string }
        calls.push(page)
        expect(sort).toBe('size')
        return { status: 200, data: { items: page === 1 ? [file('a.py', 3), file('b.py', 2)] : [], total: 2, page, page_size: 200 } }
      },
    })
    const result = await listLargestFiles(P, R, RUN)
    expect(result.items.map((f) => f.path)).toEqual(['a.py', 'b.py'])
    expect(calls).toEqual([1])
  })
})

// --- The component --------------------------------------------------------------------------

function Where() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}|${JSON.stringify(location.state)}`}</output>
}

function mount(files: ComplexityFile[], total = files.length) {
  mockApi({ [`GET ${FILES_URL}`]: { status: 200, data: { items: files, total, page: 1, page_size: 200 } } })
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter initialEntries={['/city']}>
        <Routes>
          <Route path="/city" element={<CodeCity projectId={P} repositoryId={R} runId={RUN} components={['app']} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const FILES = [
  file('app/big.py', 900, { maintainability: 'poor', rank: 'high', max_cyclomatic: 31, maintainability_index: 12.6 }),
  file('app/mid.py', 300, { maintainability: 'moderate' }),
  file('app/small.py', 40),
]

describe('CodeCity', () => {
  it('draws the city, with a legend, a tooltip and click to open', async () => {
    withWebGL(true)
    mount(FILES, 1000)
    const region = await screen.findByRole('region', { name: 'Code city' })
    expect(region.textContent).toContain('3 largest of 1,000 files in 1 district (the city shows the largest files)')
    expect(within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Good maintainability (1)',
      'Moderate maintainability (1)',
      'Poor maintainability (1)',
      'High complexity (1)',
    ])
    await waitFor(() => expect(screen.getByTestId('code-city').className).toContain('opacity-100'))
    expect(scene.buildings).toBe(3)
    expect(screen.getByText(/Drag to orbit/)).toBeTruthy()

    const [big] = layoutCity(FILES, ['app']).buildings
    act(() => scene.options!.onHover(big, { x: 40, y: 50 }))
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('app/big.py')
    expect(tip.textContent).toContain('900 lines · 3 functions · max complexity 31')
    expect(tip.textContent).toContain('Poor maintainability (index 13)')
    act(() => scene.options!.onHover(null, { x: 0, y: 0 }))
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => scene.options!.onSelect(big))
    expect(screen.getByTestId('location').textContent).toBe(`/projects/${P}/repositories/${R}|{"openFile":{"path":"app/big.py","line":1}}`)
  })

  it('lists the tallest buildings for keyboards, and opens them', async () => {
    withWebGL(false)
    mount(FILES)
    const list = await screen.findByRole('list', { name: 'Largest files' })
    expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'app/big.py900 lines · poor maintainability · high complexity',
      'app/mid.py300 lines · moderate maintainability',
      'app/small.py40 lines · good maintainability',
    ])
    fireEvent.click(within(list).getAllByRole('button')[1])
    expect(screen.getByTestId('location').textContent).toContain('"path":"app/mid.py"')
  })

  it('explains when WebGL is missing or the scene fails', async () => {
    withWebGL(false)
    expect(supportsWebGL()).toBe(false)
    const first = mount(FILES)
    expect(await screen.findByText(/needs WebGL/)).toBeTruthy()
    expect(screen.queryByTestId('code-city')).toBeNull()
    first.unmount()

    withWebGL(true)
    scene.fail = true
    mount(FILES)
    expect(await screen.findByText(/could not be drawn here/)).toBeTruthy()
  })

  it('treats a browser that cannot create a context as missing WebGL', () => {
    vi.stubGlobal('WebGLRenderingContext', function WebGLRenderingContext() {})
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(supportsWebGL()).toBe(false)
  })

  it('says when there is nothing to build, and when loading fails', async () => {
    withWebGL(true)
    const first = mount([])
    expect(await screen.findByText(/no measured source files/)).toBeTruthy()
    expect(scene.options).toBeNull()
    first.unmount()
    mockApi({ [`GET ${FILES_URL}`]: { status: 500, data: { detail: 'Server error' } } })
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>
          <CodeCity projectId={P} repositoryId={R} runId={RUN} components={[]} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('disposes a scene that finishes loading after the city was closed', async () => {
    withWebGL(true)
    let release: () => void = () => {}
    scene.hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const view = mount(FILES)
    await waitFor(() => expect(scene.options).not.toBeNull())
    view.unmount()
    expect(scene.dispose).not.toHaveBeenCalled()
    await act(async () => release())
    await waitFor(() => expect(scene.dispose).toHaveBeenCalledOnce())
  })

  it('disposes the scene when it unmounts', async () => {
    withWebGL(true)
    const view = mount(FILES)
    await waitFor(() => expect(screen.getByTestId('code-city').className).toContain('opacity-100'))
    view.unmount()
    expect(scene.dispose).toHaveBeenCalledOnce()
  })
})
