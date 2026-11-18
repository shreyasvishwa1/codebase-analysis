import { useEffect, useRef, useState } from 'react'

import { CircuitIllustration } from './AuthLayout'
import type { ChipSpec } from './circuitLayout'

/** Whether this browser can draw WebGL (checked without creating a context in old browsers). */
export function supportsWebGL(): boolean {
  if (typeof window === 'undefined' || typeof window.WebGLRenderingContext === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

type Mode = 'flat' | 'loading' | 'live'

/**
 * The intro board in 3D: the flat SVG board shows at once, three.js loads in the background
 * (its own file), and the 3D board fades in over it. Without WebGL, or if loading fails, the
 * flat board stays. Hovering a chip names it; clicking one calls onSelect.
 */
export function Board3D({ onSelect }: { onSelect?: (chip: ChipSpec) => void }) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<Mode>(() => (supportsWebGL() ? 'loading' : 'flat'))
  const [hovered, setHovered] = useState<ChipSpec | null>(null)
  const select = useRef(onSelect)
  select.current = onSelect

  useEffect(() => {
    if (mode !== 'loading') return
    let cancelled = false
    let dispose: (() => void) | null = null
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    import('./boardScene')
      .then(({ createBoardScene }) =>
        createBoardScene(canvas.current!, host.current!, {
          reducedMotion,
          onHover: (chip) => setHovered(chip),
          onSelect: (chip) => select.current?.(chip),
        }),
      )
      .then((scene) => {
        if (cancelled) {
          scene.dispose()
          return
        }
        dispose = scene.dispose
        setMode('live')
      })
      .catch(() => {
        if (!cancelled) setMode('flat')
      })
    return () => {
      cancelled = true
      dispose?.()
    }
    // Runs once (not on mode changes): the scene lives as long as the component.
  }, [])

  return (
    <div className="space-y-3">
      <div ref={host} className="relative aspect-[520/345] w-full">
        <div className={`absolute inset-0 transition-opacity duration-700 ${mode === 'live' ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
          <CircuitIllustration boot />
        </div>
        {mode !== 'flat' && (
          <canvas
            ref={canvas}
            aria-hidden="true"
            data-testid="board-3d"
            className={`absolute inset-0 h-full w-full touch-pan-y transition-opacity duration-700 ${mode === 'live' ? 'opacity-100' : 'opacity-0'}`}
          />
        )}
      </div>
      <p className="flex h-5 items-center justify-center gap-2 text-center font-mono text-[11px] text-slate-400" aria-live="polite">
        {mode === 'live' &&
          (hovered ? (
            <>
              <span className="text-indigo-300">{hovered.ref}</span>
              {hovered.description}
            </>
          ) : (
            <span className="text-slate-500">Drag to turn the board · hover a chip · click to jump to it</span>
          ))}
      </p>
    </div>
  )
}
