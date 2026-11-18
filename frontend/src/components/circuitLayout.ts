/**
 * The board drawn on the sign-in and intro pages, in one coordinate space (520 x 345): the
 * analysis modules as chips on the left, the health score in the middle, and what it feeds
 * on the right. The flat SVG drawing and the 3D scene are both built from this.
 */
export interface ChipSpec {
  label: string
  ref: string
  x: number
  y: number
  width: number
  height: number
  trace?: string
  description: string
}

export const BOARD_WIDTH = 520
export const BOARD_HEIGHT = 345
const CHIP_HEIGHT = 34

export const INPUTS: ChipSpec[] = [
  { label: 'QUALITY', ref: 'U1', y: 30, trace: 'M140 47 H194 L200 53 V144 L206 150 H230', description: 'Code quality: lint rules, duplication and code smells.' },
  { label: 'SECURITY', ref: 'U2', y: 95, trace: 'M140 112 H179 L185 118 V159 L191 165 H230', description: 'Security: secrets, injection and the OWASP Top 10.' },
  { label: 'COMPLEXITY', ref: 'U3', y: 160, trace: 'M140 177 H230', description: 'Complexity: cyclomatic complexity and maintainability.' },
  { label: 'DEPENDENCIES', ref: 'U4', y: 225, trace: 'M140 242 H179 L185 236 V201 L191 195 H230', description: 'Dependencies: versions checked against OSV.dev advisories.' },
  { label: 'ARCHITECTURE', ref: 'U5', y: 290, trace: 'M140 307 H194 L200 301 V216 L206 210 H230', description: 'Architecture: components, imports and routes.' },
].map((chip) => ({ ...chip, x: 20, width: 120, height: CHIP_HEIGHT }))

export const OUTPUTS: ChipSpec[] = [
  { label: 'PDF REPORT', ref: 'J1', y: 95, trace: 'M340 165 H360 L366 159 V118 L372 112 H400', description: 'PDF reports: every analysis kept, ready to download.' },
  { label: 'AI CHAT', ref: 'J2', y: 225, trace: 'M340 195 H360 L366 201 V236 L372 242 H400', description: 'AI chat: questions answered with cited lines.' },
].map((chip) => ({ ...chip, x: 400, width: 110, height: CHIP_HEIGHT }))

export const HEALTH: ChipSpec = {
  label: 'HEALTH',
  ref: 'U0',
  x: 230,
  y: 130,
  width: 110,
  height: 100,
  description: 'Health score: one explainable 0 to 100 score.',
}

export const VIAS: readonly (readonly [number, number])[] = [
  [200, 98], [185, 140], [185, 218], [200, 258], [366, 138], [366, 220],
]

/** The background's repeating tile of traces (240 x 240), the same shape the page's CSS
 * pattern draws, so animated current can run exactly on the printed traces. */
export const TRACE_TILE_SIZE = 240
export const TRACE_TILE =
  'M0 40h70l20 20h60l20-20h70M200 0v100l-20 20v20l20 20v80M0 190h50l20-20h46M120 0v11M120 240v-25l15-15h21M30 100h40l20 20v30'

/**
 * The polylines of an SVG path made of move, line, horizontal and vertical commands
 * (M L H V, absolute, and m l h v, relative): one polyline per subpath.
 */
export function tracePaths(path: string): [number, number][][] {
  const tokens = path.match(/[A-Za-z]|-?\d*\.?\d+/g) ?? []
  const paths: [number, number][][] = []
  let points: [number, number][] = []
  let x = 0
  let y = 0
  let index = 0
  const next = () => {
    const value = Number(tokens[index++])
    if (!Number.isFinite(value)) throw new Error(`Bad number in trace: ${path}`)
    return value
  }
  while (index < tokens.length) {
    const command = tokens[index++]
    const relative = command === command.toLowerCase()
    switch (command.toUpperCase()) {
      case 'M':
        if (points.length) paths.push(points)
        x = (relative ? x : 0) + next()
        y = (relative ? y : 0) + next()
        points = []
        break
      case 'L':
        x = (relative ? x : 0) + next()
        y = (relative ? y : 0) + next()
        break
      case 'H':
        x = (relative ? x : 0) + next()
        break
      case 'V':
        y = (relative ? y : 0) + next()
        break
      default:
        throw new Error(`Unsupported trace command ${command} in ${path}`)
    }
    points.push([x, y])
  }
  if (points.length) paths.push(points)
  return paths
}

/** The points of a single-subpath trace. */
export function tracePoints(path: string): [number, number][] {
  return tracePaths(path)[0] ?? []
}

/** Total length of a polyline. */
export function polylineLength(points: [number, number][]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  }
  return total
}

/** The point at a distance along a polyline (clamped to its ends). */
export function pointAlong(points: [number, number][], distance: number): [number, number] {
  let left = Math.max(0, distance)
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const length = Math.hypot(bx - ax, by - ay)
    if (left <= length) {
      const t = length === 0 ? 0 : left / length
      return [ax + (bx - ax) * t, ay + (by - ay) * t]
    }
    left -= length
  }
  return points[points.length - 1]
}
