import { useEffect, useRef } from 'react'

import { pointAlong, polylineLength, TRACE_TILE, TRACE_TILE_SIZE, tracePaths } from './circuitLayout'

/** The tile's traces, measured once. */
const TILE_PATHS = tracePaths(TRACE_TILE).map((points) => ({ points, length: polylineLength(points) }))

export type Density = 'high' | 'low'

/** How busy the background is: the intro and sign-in pages show more current than the app,
 * where it must not distract from the work. */
export const DENSITY: Record<Density, { max: number; everyMs: number }> = {
  high: { max: 16, everyMs: 220 },
  low: { max: 5, everyMs: 900 },
}

export interface Pulse {
  points: [number, number][]
  length: number
  /** the tile's top-left corner on screen */
  x: number
  y: number
  /** distance travelled along the trace, in pixels */
  at: number
  speed: number
  trail: number
}

export interface Spark {
  x: number
  y: number
  age: number
}

/** A new pulse on a random trace of a random tile that is on screen. */
export function spawnPulse(random: () => number, width: number, height: number): Pulse {
  const columns = Math.max(1, Math.ceil(width / TRACE_TILE_SIZE))
  const rows = Math.max(1, Math.ceil(height / TRACE_TILE_SIZE))
  const path = TILE_PATHS[Math.floor(random() * TILE_PATHS.length) % TILE_PATHS.length]
  return {
    points: path.points,
    length: path.length,
    x: (Math.floor(random() * columns) % columns) * TRACE_TILE_SIZE,
    y: (Math.floor(random() * rows) % rows) * TRACE_TILE_SIZE,
    at: 0,
    speed: 70 + random() * 70,
    trail: 64,
  }
}

/** Move a pulse on by dt seconds. Returns false once its tail has left the trace. */
export function stepPulse(pulse: Pulse, dt: number): boolean {
  pulse.at += pulse.speed * dt
  return pulse.at - pulse.trail < pulse.length
}

/** Where a pulse's head is on screen. */
export function pulseHead(pulse: Pulse): [number, number] {
  const [x, y] = pointAlong(pulse.points, Math.min(pulse.at, pulse.length))
  return [pulse.x + x, pulse.y + y]
}

function accent(): string {
  const light = document.documentElement.getAttribute('data-theme') === 'light'
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue(light ? '--indigo-500' : '--indigo-400')
    .trim()
    .split(/\s+/)
    .join(',')
  return channels || '226,183,85'
}

function motionAllowed(): boolean {
  return typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Current running through the page's background traces: pulses with fading tails travel
 * along the printed traces (same tile, same origin as the CSS pattern) and spark where they
 * end. Drawn on one fixed canvas behind the content; paused while the tab is hidden, and
 * not drawn at all under reduced motion.
 */
export function LiveTraces({ density = 'low' }: { density?: Density }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    // Checked before asking for a 2D context, which test environments do not provide.
    if (!motionAllowed()) return
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const { max, everyMs } = DENSITY[density]
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
    let width = 0
    let height = 0
    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    let color = accent()
    const onTheme = () => {
      color = accent()
    }
    window.addEventListener('cba-theme-change', onTheme)

    const pulses: Pulse[] = []
    const sparks: Spark[] = []
    let since = everyMs // spawn one right away
    let last = performance.now()
    let frame = 0

    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      since += dt * 1000
      if (since >= everyMs && pulses.length < max) {
        since = 0
        pulses.push(spawnPulse(Math.random, width, height))
      }
      context.clearRect(0, 0, width, height)
      context.globalCompositeOperation = 'lighter'
      context.lineCap = 'round'
      for (let i = pulses.length - 1; i >= 0; i -= 1) {
        const pulse = pulses[i]
        const alive = stepPulse(pulse, dt)
        // The tail: a few segments that fade toward the back.
        const steps = 8
        context.shadowColor = `rgba(${color},0.9)`
        context.shadowBlur = 8
        for (let s = 0; s < steps; s += 1) {
          const a = pulse.at - (pulse.trail * s) / steps
          const b = pulse.at - (pulse.trail * (s + 1)) / steps
          if (a < 0) break
          const [ax, ay] = pointAlong(pulse.points, Math.min(a, pulse.length))
          const [bx, by] = pointAlong(pulse.points, Math.max(0, Math.min(b, pulse.length)))
          context.strokeStyle = `rgba(${color},${0.85 * (1 - s / steps)})`
          context.lineWidth = 2.5
          context.beginPath()
          context.moveTo(pulse.x + ax, pulse.y + ay)
          context.lineTo(pulse.x + bx, pulse.y + by)
          context.stroke()
        }
        if (pulse.at <= pulse.length) {
          const [hx, hy] = pulseHead(pulse)
          const glow = context.createRadialGradient(hx, hy, 0, hx, hy, 10)
          glow.addColorStop(0, 'rgba(255,244,214,1)')
          glow.addColorStop(0.35, `rgba(${color},0.8)`)
          glow.addColorStop(1, `rgba(${color},0)`)
          context.fillStyle = glow
          context.beginPath()
          context.arc(hx, hy, 10, 0, Math.PI * 2)
          context.fill()
        } else if (pulse.at - pulse.speed * dt <= pulse.length) {
          const [ex, ey] = pulse.points[pulse.points.length - 1]
          sparks.push({ x: pulse.x + ex, y: pulse.y + ey, age: 0 })
        }
        if (!alive) pulses.splice(i, 1)
      }
      context.shadowBlur = 0
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const spark = sparks[i]
        spark.age += dt
        const fade = 1 - spark.age / 0.6
        if (fade <= 0) {
          sparks.splice(i, 1)
          continue
        }
        context.strokeStyle = `rgba(${color},${0.7 * fade})`
        context.lineWidth = 1.5
        context.beginPath()
        context.arc(spark.x, spark.y, 4 + (1 - fade) * 8, 0, Math.PI * 2)
        context.stroke()
      }
      frame = requestAnimationFrame(draw)
    }

    const start = () => {
      cancelAnimationFrame(frame)
      if (document.hidden) return
      last = performance.now()
      frame = requestAnimationFrame(draw)
    }
    document.addEventListener('visibilitychange', start)
    start()

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', start)
      window.removeEventListener('resize', resize)
      window.removeEventListener('cba-theme-change', onTheme)
    }
  }, [density])

  return <canvas ref={ref} aria-hidden="true" data-testid="live-traces" className="pointer-events-none fixed inset-0 -z-[1] h-full w-full" />
}
