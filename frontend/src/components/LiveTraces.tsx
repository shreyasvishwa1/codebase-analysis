import { useEffect, useRef } from 'react'

import { BOARD_WIDTH, pointAlong, polylineLength, TRACE_TILE, TRACE_TILE_SIZE, tracePaths, tracePoints } from './circuitLayout'

/** The tile's traces, measured once. */
const TILE_PATHS = tracePaths(TRACE_TILE).map((points) => ({ points, length: polylineLength(points) }))

export type Density = 'high' | 'low'

/** How busy the background is: the intro and sign-in pages show more current than the app,
 * where it must not distract from the work. */
export const DENSITY: Record<Density, { max: number; everyMs: number }> = {
  high: { max: 8, everyMs: 380 },
  low: { max: 3, everyMs: 1400 },
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

/** A soft glow, drawn once and stamped at each pulse's head (much cheaper than canvas
 * shadows, which are recomputed for every stroke). */
function glowSprite(color: string): HTMLCanvasElement {
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 24
  const context = sprite.getContext('2d')
  if (context) {
    const glow = context.createRadialGradient(12, 12, 0, 12, 12, 12)
    glow.addColorStop(0, 'rgba(255,244,214,1)')
    glow.addColorStop(0.3, `rgba(${color},0.8)`)
    glow.addColorStop(1, `rgba(${color},0)`)
    context.fillStyle = glow
    context.fillRect(0, 0, 24, 24)
  }
  return sprite
}

/** At most this many frames a second: smooth for slow-moving light, half the work of 60. */
export const FRAME_MS = 1000 / 30

export function motionAllowed(): boolean {
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
    const ratio = 1 // a soft glow needs no high-density pixels
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
    let glow = glowSprite(color)
    const onTheme = () => {
      color = accent()
      glow = glowSprite(color)
    }
    window.addEventListener('cba-theme-change', onTheme)

    const pulses: Pulse[] = []
    const sparks: Spark[] = []
    let since = everyMs // spawn one right away
    let last = performance.now()
    let frame = 0

    const draw = (now: number) => {
      if (now - last < FRAME_MS - 1) {
        frame = requestAnimationFrame(draw)
        return
      }
      const dt = Math.min(0.08, (now - last) / 1000)
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
        const steps = 4
        for (let s = 0; s < steps; s += 1) {
          const a = pulse.at - (pulse.trail * s) / steps
          const b = pulse.at - (pulse.trail * (s + 1)) / steps
          if (a < 0) break
          const [ax, ay] = pointAlong(pulse.points, Math.min(a, pulse.length))
          const [bx, by] = pointAlong(pulse.points, Math.max(0, Math.min(b, pulse.length)))
          context.strokeStyle = `rgba(${color},${0.8 * (1 - s / steps)})`
          context.lineWidth = 2
          context.beginPath()
          context.moveTo(pulse.x + ax, pulse.y + ay)
          context.lineTo(pulse.x + bx, pulse.y + by)
          context.stroke()
        }
        if (pulse.at <= pulse.length) {
          const [hx, hy] = pulseHead(pulse)
          context.drawImage(glow, hx - 12, hy - 12)
        } else if (pulse.at - pulse.speed * dt <= pulse.length) {
          const [ex, ey] = pulse.points[pulse.points.length - 1]
          sparks.push({ x: pulse.x + ex, y: pulse.y + ey, age: 0 })
        }
        if (!alive) pulses.splice(i, 1)
      }
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

  return <canvas ref={ref} aria-hidden="true" data-testid="live-traces" className="pointer-events-none fixed inset-0 -z-[1] h-full w-full [will-change:transform]" />
}

/** Pulses per trace on a board, spread evenly along it. */
export const BOARD_PULSES = 2
/** Board current speed, in layout units per second. */
export const BOARD_SPEED = 55

/** Where a board pulse is: `t` seconds in, the `k`th of BOARD_PULSES on a trace. */
export function boardPulseAt(length: number, t: number, k: number): number {
  const cycle = length + 40 // a short gap before each pulse comes round again
  return (t * BOARD_SPEED + (k * cycle) / BOARD_PULSES) % cycle
}

/**
 * Current flowing along a circuit board's traces, drawn on a canvas laid over the board's
 * SVG (in the board's 520-wide layout units). Much cheaper than animating dashed SVG
 * strokes, which repaint every trace on every frame. 30 frames a second, paused when off
 * screen or hidden, and not drawn at all under reduced motion.
 */
export function BoardCurrent({ traces, delayMs = 0 }: { traces: string[]; delayMs?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const key = traces.join('|')

  useEffect(() => {
    if (!motionAllowed() || traces.length === 0) return
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const paths = traces.map((trace) => {
      const points = tracePoints(trace)
      return { points, length: polylineLength(points) }
    })
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    let scale = 1
    const resize = () => {
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      canvas.width = Math.max(1, Math.round(width * ratio))
      canvas.height = Math.max(1, Math.round(height * ratio))
      scale = width / BOARD_WIDTH
      context.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0)
    }
    resize()
    const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    sizeObserver?.observe(canvas)
    let color = accent()
    let glow = glowSprite(color)
    const onTheme = () => {
      color = accent()
      glow = glowSprite(color)
    }
    window.addEventListener('cba-theme-change', onTheme)

    const begin = performance.now() + delayMs
    let last = 0
    let frame = 0
    let visible = true
    const draw = (now: number) => {
      frame = 0
      if (now - last >= FRAME_MS - 1) {
        last = now
        context.clearRect(0, 0, BOARD_WIDTH, canvas.height / (ratio * scale))
        const t = (now - begin) / 1000
        if (t > 0) {
          context.globalCompositeOperation = 'lighter'
          context.lineCap = 'round'
          context.lineWidth = 2.5
          for (const { points, length } of paths) {
            for (let k = 0; k < BOARD_PULSES; k += 1) {
              const at = boardPulseAt(length, t, k)
              if (at > length + 4) continue
              for (let s = 0; s < 3; s += 1) {
                const a = Math.min(length, at - s * 6)
                const b = Math.max(0, at - (s + 1) * 6)
                if (a <= 0) break
                const [ax, ay] = pointAlong(points, a)
                const [bx, by] = pointAlong(points, b)
                context.strokeStyle = `rgba(${color},${0.85 - s * 0.25})`
                context.beginPath()
                context.moveTo(ax, ay)
                context.lineTo(bx, by)
                context.stroke()
              }
              if (at <= length) {
                const [hx, hy] = pointAlong(points, at)
                context.drawImage(glow, hx - 8, hy - 8, 16, 16)
              }
            }
          }
        }
      }
      start()
    }
    const start = () => {
      if (frame || !visible || document.hidden) return
      frame = requestAnimationFrame(draw)
    }
    const stop = () => {
      cancelAnimationFrame(frame)
      frame = 0
    }
    const visibility = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) start()
      else stop()
    })
    visibility?.observe(canvas)
    const onVisibility = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVisibility)
    start()
    return () => {
      stop()
      sizeObserver?.disconnect()
      visibility?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('cba-theme-change', onTheme)
    }
    // The traces are compared by value (key), not by array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key stands for the traces' value
  }, [key, delayMs])

  return <canvas ref={ref} aria-hidden="true" data-testid="board-current" className="pointer-events-none absolute inset-0 h-full w-full [will-change:transform]" />
}
