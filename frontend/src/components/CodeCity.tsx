import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { queryKeys } from '../hooks/queryKeys'
import { getErrorMessage } from '../services/client'
import { CITY_FILE_LIMIT, listLargestFiles } from '../services/complexity'
import { layoutCity, type Building, type BuildingTone } from '../utils/codeCity'
import { ErrorMessage } from './ErrorMessage'

/** Whether this browser can draw WebGL. */
export function supportsWebGL(): boolean {
  if (typeof window === 'undefined' || typeof window.WebGLRenderingContext === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

export const TONE_LABELS: Record<BuildingTone, string> = {
  good: 'Good maintainability',
  moderate: 'Moderate maintainability',
  poor: 'Poor maintainability',
  unknown: 'Not measured',
}
const TONE_SWATCH: Record<BuildingTone, string> = {
  good: 'bg-emerald-500',
  moderate: 'bg-amber-500',
  poor: 'bg-red-500',
  unknown: 'bg-slate-500',
}

const number = (value: number) => value.toLocaleString('en-US')

type Mode = 'loading' | 'live' | 'failed' | 'unsupported'

/**
 * The repository as a city: a district per architecture component, a building per file
 * (height: lines of code, colour: maintainability, red beacon: high-complexity code).
 * Drag to orbit, scroll to zoom, click a building to open the file.
 */
export function CodeCity({
  projectId,
  repositoryId,
  runId,
  components,
}: {
  projectId: string
  repositoryId: string
  runId: string
  components: string[]
}) {
  const navigate = useNavigate()
  const files = useQuery({
    queryKey: [...queryKeys.analysisRuns(projectId, repositoryId), runId, 'city'],
    queryFn: () => listLargestFiles(projectId, repositoryId, runId),
    staleTime: Infinity, // a stored run never changes
  })
  const city = useMemo(() => (files.data ? layoutCity(files.data.items, components) : null), [files.data, components])
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<Mode>(() => (supportsWebGL() ? 'loading' : 'unsupported'))
  const [hovered, setHovered] = useState<{ building: Building; x: number; y: number } | null>(null)
  const explorer = `/projects/${projectId}/repositories/${repositoryId}`
  // Kept in a ref so the scene (created once per city) always opens with the current router.
  const open = useRef<(building: Building) => void>(() => {})
  open.current = (building) => navigate(explorer, { state: { openFile: { path: building.file.path, line: 1 } } })

  useEffect(() => {
    if (!city || city.buildings.length === 0 || mode === 'unsupported') return
    let cancelled = false
    let dispose: (() => void) | null = null
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    import('./cityScene')
      .then(({ createCityScene }) =>
        createCityScene(canvas.current!, host.current!, city, {
          reducedMotion,
          onHover: (building, at) => setHovered(building ? { building, ...at } : null),
          onSelect: (building) => open.current(building),
        }),
      )
      .then((scene) => {
        if (cancelled) return scene.dispose()
        dispose = scene.dispose
        setMode('live')
      })
      .catch(() => {
        if (!cancelled) setMode('failed')
      })
    return () => {
      cancelled = true
      dispose?.()
    }
    // A new scene only for a new city; the mode changes come from this effect itself.
  }, [city])

  if (files.isPending) return <p className="text-sm text-slate-400">Loading the files…</p>
  if (files.isError) return <ErrorMessage message={getErrorMessage(files.error, 'Could not load the files')} />
  if (!city || city.buildings.length === 0) {
    return <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">This run has no measured source files to build a city from.</p>
  }

  const total = files.data.total
  const beacons = city.buildings.filter((building) => building.beacon).length
  const tones = (Object.keys(TONE_LABELS) as BuildingTone[]).map((tone) => ({
    tone,
    count: city.buildings.filter((building) => building.tone === tone).length,
  }))

  return (
    <section aria-label="Code city" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-400">
        <span>
          {number(city.buildings.length)} {city.buildings.length < total ? `largest of ${number(total)} files` : 'files'} in{' '}
          {number(city.districts.length)} {city.districts.length === 1 ? 'district' : 'districts'}
          {total > CITY_FILE_LIMIT && ' (the city shows the largest files)'}
        </span>
        <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {tones
            .filter(({ count }) => count > 0)
            .map(({ tone, count }) => (
              <li key={tone} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ${TONE_SWATCH[tone]}`} />
                {TONE_LABELS[tone]} ({number(count)})
              </li>
            ))}
          {beacons > 0 && (
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="led text-red-400" />
              High complexity ({number(beacons)})
            </li>
          )}
        </ul>
      </div>

      <div ref={host} className="pcb-card relative h-[min(70vh,560px)] overflow-hidden bg-slate-950 p-0">
        {mode !== 'unsupported' && mode !== 'failed' && (
          <canvas
            ref={canvas}
            data-testid="code-city"
            aria-hidden="true"
            className={`absolute inset-0 h-full w-full transition-opacity duration-700 ${mode === 'live' ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
        {mode === 'loading' && (
          <p className="absolute inset-0 flex items-center justify-center font-mono text-xs text-slate-500">Building the city…</p>
        )}
        {(mode === 'unsupported' || mode === 'failed') && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-slate-400">
            {mode === 'unsupported'
              ? 'The code city needs WebGL, which this browser does not provide. The diagram view shows the same components.'
              : 'The code city could not be drawn here. The diagram view shows the same components.'}
          </p>
        )}
        {hovered && mode === 'live' && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 max-w-xs rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-xl"
            style={{ left: Math.min(hovered.x + 14, (host.current?.clientWidth ?? 600) - 240), top: hovered.y + 14 }}
          >
            <p className="break-all font-mono text-slate-100">{hovered.building.file.path}</p>
            <p className="mt-1 text-slate-400">
              {number(hovered.building.file.nloc)} lines · {number(hovered.building.file.functions)} functions · max complexity{' '}
              {hovered.building.file.max_cyclomatic}
            </p>
            <p className="text-slate-400">
              {TONE_LABELS[hovered.building.tone]}
              {hovered.building.file.maintainability_index !== null && ` (index ${Math.round(hovered.building.file.maintainability_index)})`}
            </p>
            <p className="mt-1 text-indigo-300">Click to open the file</p>
          </div>
        )}
        {mode === 'live' && (
          <p className="pointer-events-none absolute bottom-3 left-4 font-mono text-[11px] text-slate-500">
            Drag to orbit · scroll to zoom · right-drag to pan · click a building to open it
          </p>
        )}
      </div>

      {/* The same information as a list, for keyboards and screen readers. */}
      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">The tallest buildings as a list</summary>
        <ol aria-label="Largest files" className="mt-2 space-y-1">
          {city.buildings
            .slice()
            .sort((a, b) => b.file.nloc - a.file.nloc)
            .slice(0, 15)
            .map((building) => (
              <li key={building.file.path}>
                <button
                  type="button"
                  onClick={() => open.current(building)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-slate-800/60"
                >
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-sm ${TONE_SWATCH[building.tone]}`} />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-200">{building.file.path}</span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {number(building.file.nloc)} lines · {TONE_LABELS[building.tone].toLowerCase()}
                    {building.beacon && ' · high complexity'}
                  </span>
                </button>
              </li>
            ))}
        </ol>
      </details>
    </section>
  )
}
