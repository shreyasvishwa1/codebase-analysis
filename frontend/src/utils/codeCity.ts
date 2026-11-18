import type { ComplexityFile, MaintainabilityLevel } from '../types/api'

/**
 * The code city: each architecture component is a district, each file a building whose
 * height follows its lines of code and whose colour is its maintainability; files with
 * high-complexity code carry a red beacon. Pure layout, no drawing.
 */

export type CityFile = Pick<
  ComplexityFile,
  'path' | 'language' | 'nloc' | 'functions' | 'max_cyclomatic' | 'rank' | 'maintainability' | 'maintainability_index'
>

export type BuildingTone = MaintainabilityLevel | 'unknown'

export interface Building {
  file: CityFile
  district: string
  /** centre on the ground plane */
  x: number
  z: number
  height: number
  tone: BuildingTone
  beacon: boolean
}

export interface District {
  id: string
  /** centre and size on the ground plane */
  x: number
  z: number
  width: number
  depth: number
  files: number
  lines: number
}

export interface City {
  districts: District[]
  buildings: Building[]
  /** the side of the square the city fits in */
  size: number
}

export const ROOT = '(root)'
export const FOOTPRINT = 1 // a building's width and depth
const STREET = 0.45 // between buildings
const MARGIN = 0.7 // inside a district's edge
const AVENUE = 1.6 // between districts
export const MAX_HEIGHT = 9
const MIN_HEIGHT = 0.35

/** The district of a file: the deepest component that contains it, else its top folder,
 * else the root. */
export function districtOf(path: string, components: string[]): string {
  let best = ''
  for (const id of components) {
    if (id === ROOT) continue
    if ((path === id || path.startsWith(`${id}/`)) && id.length > best.length) best = id
  }
  if (best) return best
  const slash = path.indexOf('/')
  return slash < 0 ? ROOT : path.slice(0, slash)
}

/** Height for a file's lines: square-root scaled so the largest reaches MAX_HEIGHT. */
export function buildingHeight(nloc: number, largest: number): number {
  if (largest <= 0) return MIN_HEIGHT
  return MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * Math.sqrt(Math.max(0, nloc) / largest)
}

export function layoutCity(files: CityFile[], components: string[]): City {
  const groups = new Map<string, CityFile[]>()
  for (const file of files) {
    const id = districtOf(file.path, components)
    const group = groups.get(id)
    if (group) group.push(file)
    else groups.set(id, [file])
  }
  const largest = Math.max(0, ...files.map((file) => file.nloc))

  // Each district: a square-ish grid of its files, biggest first (largest districts first).
  const plots = [...groups.entries()]
    .map(([id, group]) => {
      const sorted = [...group].sort((a, b) => b.nloc - a.nloc || a.path.localeCompare(b.path))
      const columns = Math.ceil(Math.sqrt(sorted.length))
      const rows = Math.ceil(sorted.length / columns)
      const step = FOOTPRINT + STREET
      return {
        id,
        files: sorted,
        columns,
        width: columns * step - STREET + 2 * MARGIN,
        depth: rows * step - STREET + 2 * MARGIN,
        lines: sorted.reduce((sum, file) => sum + file.nloc, 0),
      }
    })
    .sort((a, b) => b.lines - a.lines || a.id.localeCompare(b.id))

  // Districts in rows (shelf packing) to a roughly square city.
  const area = plots.reduce((sum, plot) => sum + (plot.width + AVENUE) * (plot.depth + AVENUE), 0)
  const rowLimit = Math.max(Math.sqrt(area), ...plots.map((plot) => plot.width))
  const placed: { plot: (typeof plots)[number]; left: number; top: number }[] = []
  let left = 0
  let top = 0
  let rowDepth = 0
  let width = 0
  for (const plot of plots) {
    if (left > 0 && left + plot.width > rowLimit) {
      top += rowDepth + AVENUE
      left = 0
      rowDepth = 0
    }
    placed.push({ plot, left, top })
    left += plot.width + AVENUE
    rowDepth = Math.max(rowDepth, plot.depth)
    width = Math.max(width, left - AVENUE)
  }
  const depth = top + rowDepth
  const offsetX = width / 2
  const offsetZ = depth / 2

  const districts: District[] = []
  const buildings: Building[] = []
  for (const { plot, left: x0, top: z0 } of placed) {
    districts.push({
      id: plot.id,
      x: x0 + plot.width / 2 - offsetX,
      z: z0 + plot.depth / 2 - offsetZ,
      width: plot.width,
      depth: plot.depth,
      files: plot.files.length,
      lines: plot.lines,
    })
    plot.files.forEach((file, index) => {
      const column = index % plot.columns
      const row = Math.floor(index / plot.columns)
      buildings.push({
        file,
        district: plot.id,
        x: x0 + MARGIN + column * (FOOTPRINT + STREET) + FOOTPRINT / 2 - offsetX,
        z: z0 + MARGIN + row * (FOOTPRINT + STREET) + FOOTPRINT / 2 - offsetZ,
        height: buildingHeight(file.nloc, largest),
        tone: file.maintainability ?? 'unknown',
        beacon: file.rank === 'high',
      })
    })
  }
  return { districts, buildings, size: Math.max(width, depth, 1) }
}
