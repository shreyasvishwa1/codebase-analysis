import { ArrowLeft, Database, Search } from 'lucide-react'
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

import type { ArchitectureComponent, ArchitectureDocument, ComponentRole } from '../types/api'
import { componentOf, ROLE_LABELS, shortName, type Selection } from './ArchitectureDiagram'

/** Each role's colours, as theme tokens (literal class names so Tailwind keeps them). */
export const ROLE_TONES: Record<ComponentRole, { bar: string; text: string; border: string }> = {
  ui: { bar: 'bg-pink-500', text: 'text-pink-300', border: 'border-pink-500/50' },
  api: { bar: 'bg-sky-500', text: 'text-sky-300', border: 'border-sky-500/50' },
  auth: { bar: 'bg-amber-500', text: 'text-amber-300', border: 'border-amber-500/50' },
  worker: { bar: 'bg-teal-500', text: 'text-teal-300', border: 'border-teal-500/50' },
  core: { bar: 'bg-indigo-500', text: 'text-indigo-300', border: 'border-indigo-500/50' },
  data: { bar: 'bg-emerald-500', text: 'text-emerald-300', border: 'border-emerald-500/50' },
  config: { bar: 'bg-violet-500', text: 'text-violet-300', border: 'border-violet-500/50' },
  test: { bar: 'bg-cyan-500', text: 'text-cyan-300', border: 'border-cyan-500/50' },
}

/** The lanes, top to bottom: the interface calls the API, the API the core logic, which uses
 * data access, which uses the data stores; tests sit underneath, driving everything. */
export const LANES: { key: string; label: string; roles: ComponentRole[] }[] = [
  { key: 'ui', label: 'User interface', roles: ['ui'] },
  { key: 'api', label: 'API and authentication', roles: ['api', 'auth'] },
  { key: 'worker', label: 'Background work', roles: ['worker'] },
  { key: 'core', label: 'Core logic and configuration', roles: ['core', 'config'] },
  { key: 'data', label: 'Data access', roles: ['data'] },
  { key: 'test', label: 'Tests', roles: ['test'] },
]

export const storeKey = (name: string) => `store:${name}`

export interface Neighbour {
  id: string
  imports: number
  /** the two components import each other */
  mutual: boolean
}

/** What a component imports, what imports it (both strongest first) and the data stores its
 * files use. */
export function neighbours(document: ArchitectureDocument, id: string) {
  const pairs = new Set(document.edges.map((edge) => `${edge.source}->${edge.target}`))
  const sort = (list: Neighbour[]) => list.sort((a, b) => b.imports - a.imports || a.id.localeCompare(b.id))
  const uses = sort(
    document.edges
      .filter((edge) => edge.source === id)
      .map((edge) => ({ id: edge.target, imports: edge.imports, mutual: pairs.has(`${edge.target}->${edge.source}`) })),
  )
  const usedBy = sort(
    document.edges
      .filter((edge) => edge.target === id)
      .map((edge) => ({ id: edge.source, imports: edge.imports, mutual: pairs.has(`${edge.target}->${edge.source}`) })),
  )
  const ids = document.components.map((component) => component.id)
  const stores = document.data_stores
    .filter((store) => store.evidence.some((item) => componentOf(item.path, ids) === id))
    .map((store) => store.name)
  return { uses, usedBy, stores }
}

/** The components that are part of an import cycle. */
export function cyclic(document: ArchitectureDocument): Set<string> {
  return new Set(document.cycles.flat())
}

/** The component to focus on first: the most connected one (then the largest). */
export function defaultFocus(document: ArchitectureDocument): string | null {
  const ranked = [...document.components].sort(
    (a, b) => b.depends_on + b.used_by - (a.depends_on + a.used_by) || b.code_lines - a.code_lines || a.id.localeCompare(b.id),
  )
  return ranked[0]?.id ?? null
}

export function componentLabel(component: ArchitectureComponent): string {
  return `${component.id}: ${ROLE_LABELS[component.role]}, ${component.files} file${component.files === 1 ? '' : 's'}`
}

// --- Connection curves -------------------------------------------------------------------------

interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Curve {
  key: string
  d: string
  /** where the import count is printed */
  label: { x: number; y: number }
}

/** A smooth curve between two boxes: top/bottom edges when one is above the other, the sides
 * when they sit side by side ('sideways' always joins the facing sides, as columns do). */
export function curveBetween(from: Box, to: Box, mode: 'auto' | 'sideways' = 'auto'): Omit<Curve, 'key'> {
  const fromCentre = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
  const toCentre = { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  const vertical = mode === 'auto' && Math.abs(toCentre.y - fromCentre.y) > Math.max(from.height, to.height) / 2
  if (vertical) {
    const down = toCentre.y > fromCentre.y
    const y1 = down ? from.y + from.height : from.y
    const y2 = down ? to.y : to.y + to.height
    const mid = (y1 + y2) / 2
    return {
      d: `M${fromCentre.x},${y1} C${fromCentre.x},${mid} ${toCentre.x},${mid} ${toCentre.x},${y2}`,
      label: { x: (fromCentre.x + toCentre.x) / 2, y: mid },
    }
  }
  const right = toCentre.x > fromCentre.x
  const x1 = right ? from.x + from.width : from.x
  const x2 = right ? to.x : to.x + to.width
  const mid = (x1 + x2) / 2
  return {
    d: `M${x1},${fromCentre.y} C${mid},${fromCentre.y} ${mid},${toCentre.y} ${x2},${toCentre.y}`,
    label: { x: mid, y: (fromCentre.y + toCentre.y) / 2 },
  }
}

/** Card positions inside a container, measured after layout and on resize, so curves can be
 * drawn between them. `register(id)` is the ref callback for a card. */
function useBoxes(container: RefObject<HTMLElement>, deps: unknown[]) {
  const cards = useRef(new Map<string, HTMLElement>())
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map())
  const register = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      if (element) cards.current.set(id, element)
      else cards.current.delete(id)
    },
    [],
  )
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const measure = () => {
      const origin = root.getBoundingClientRect()
      const next = new Map<string, Box>()
      cards.current.forEach((element, id) => {
        const rect = element.getBoundingClientRect()
        next.set(id, { x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height })
      })
      setBoxes(next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
    // Re-measured whenever the caller's inputs change (what is highlighted, the filters).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller's inputs are the dependencies
  }, deps)
  return { boxes, register }
}

function Curves({
  curves,
  width,
  height,
  labels = true,
}: {
  curves: (Curve & { imports: number; mutual: boolean; store?: boolean })[]
  width: number
  height: number
  /** print each curve's import count (off where the cards already show it) */
  labels?: boolean
}) {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height}>
      {curves.map((curve) => (
        <g key={curve.key} data-edge={curve.key} className="animate-fade-in">
          <path
            d={curve.d}
            fill="none"
            className={curve.mutual ? 'stroke-red-400' : 'stroke-indigo-400'}
            strokeWidth={labels ? Math.min(5, 1.5 + Math.log2(Math.max(1, curve.imports))) : Math.min(3.5, 1 + Math.log2(Math.max(1, curve.imports)) / 1.5)}
            strokeDasharray={curve.store ? '5 4' : undefined}
            strokeLinecap="round"
            opacity={0.85}
          />
          {labels && !curve.store && (
            <g transform={`translate(${curve.label.x} ${curve.label.y})`}>
              <rect x={-12} y={-8} width={24} height={16} rx={8} className="fill-slate-950 stroke-slate-700" />
              <text textAnchor="middle" y={4} className={`font-mono text-[10px] ${curve.mutual ? 'fill-red-300' : 'fill-indigo-200'}`}>
                {curve.imports}
              </text>
            </g>
          )}
        </g>
      ))}
    </svg>
  )
}

// --- Layer lanes -------------------------------------------------------------------------------

/**
 * Components in lanes by role. No lines until one is pointed at: then its imports and
 * importers light up with curves and counts, and everything else fades. Clicking selects it
 * (the details panel shows its evidence).
 */
export function LayerLanes({
  document,
  selection,
  onSelect,
}: {
  document: ArchitectureDocument
  selection: Selection
  onSelect: (selection: Selection) => void
}) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Set<ComponentRole>>(new Set())
  const [query, setQuery] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const cycles = useMemo(() => cyclic(document), [document])
  const roles = useMemo(() => {
    const present = new Set(document.components.map((component) => component.role))
    return LANES.flatMap((lane) => lane.roles).filter((role) => present.has(role))
  }, [document])
  const visible = document.components.filter((component) => !hidden.has(component.role))
  const selectedId = selection ? (selection.kind === 'store' ? storeKey(selection.id) : selection.id) : null
  const active = hovered ?? selectedId
  const term = query.trim().toLowerCase()

  // The highlighted component's connections (for a store: the components that use it).
  const related = useMemo(() => {
    const links: { key: string; from: string; to: string; imports: number; mutual: boolean; store?: boolean }[] = []
    if (!active) return { ids: new Set<string>(), links }
    const ids = new Set<string>([active])
    if (active.startsWith('store:')) {
      const name = active.slice('store:'.length)
      const all = document.components.map((component) => component.id)
      const store = document.data_stores.find((entry) => entry.name === name)
      for (const item of store?.evidence ?? []) {
        const user = componentOf(item.path, all)
        if (user && !ids.has(user)) {
          ids.add(user)
          links.push({ key: `${user}->${active}`, from: user, to: active, imports: 1, mutual: false, store: true })
        }
      }
      return { ids, links }
    }
    const { uses, usedBy, stores } = neighbours(document, active)
    for (const n of uses) {
      ids.add(n.id)
      links.push({ key: `${active}->${n.id}`, from: active, to: n.id, imports: n.imports, mutual: n.mutual })
    }
    for (const n of usedBy) {
      ids.add(n.id)
      links.push({ key: `${n.id}->${active}`, from: n.id, to: active, imports: n.imports, mutual: n.mutual })
    }
    for (const name of stores) {
      ids.add(storeKey(name))
      links.push({ key: `${active}->${storeKey(name)}`, from: active, to: storeKey(name), imports: 1, mutual: false, store: true })
    }
    return { ids, links }
  }, [active, document])

  const { boxes, register } = useBoxes(container, [active, hidden, document, query])
  const size = container.current ? { width: container.current.scrollWidth, height: container.current.scrollHeight } : { width: 0, height: 0 }
  const curves = related.links.flatMap((link) => {
    const from = boxes.get(link.from)
    const to = boxes.get(link.to)
    return from && to ? [{ ...curveBetween(from, to), key: link.key, imports: link.imports, mutual: link.mutual, store: link.store }] : []
  })

  function toggleRole(role: ComponentRole) {
    const next = new Set(hidden)
    if (next.has(role)) next.delete(role)
    else next.add(role)
    setHidden(next)
    if (selection?.kind === 'component' && document.components.find((c) => c.id === selection.id)?.role === role) onSelect(null)
  }
  const choose = (next: NonNullable<Selection>, key: string) => onSelect(selectedId === key ? null : next)

  const lanes = [
    ...LANES.map((lane) => ({
      ...lane,
      components: visible.filter((component) => lane.roles.includes(component.role)).sort((a, b) => b.code_lines - a.code_lines || a.id.localeCompare(b.id)),
    })),
  ].filter((lane) => lane.components.length > 0)

  return (
    <section aria-label="Layer lanes" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Show roles" className="flex flex-wrap gap-1.5">
          {roles.map((role) => (
            <button
              key={role}
              type="button"
              aria-pressed={!hidden.has(role)}
              onClick={() => toggleRole(role)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${hidden.has(role) ? 'border-slate-800 text-slate-500 line-through' : 'border-slate-700 text-slate-200'}`}
            >
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${ROLE_TONES[role].bar}`} />
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>
        <label className="relative block w-full sm:w-56">
          <span className="sr-only">Find a component</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a component"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/60 py-1.5 pl-8 pr-2 text-xs text-slate-100 placeholder:text-slate-500"
          />
        </label>
      </div>

      <div ref={container} className="relative space-y-2" onMouseLeave={() => setHovered(null)}>
        {lanes.map((lane) => (
          <div key={lane.key} role="group" aria-label={`${lane.label} lane`} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500 sm:pt-2">
              {lane.label}
              <span className="block normal-case tracking-normal text-slate-600">{lane.components.length} {lane.components.length === 1 ? 'component' : 'components'}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {lane.components.map((component) => {
                const tone = ROLE_TONES[component.role]
                const isActive = active === component.id
                const dimmed = (active !== null && !related.ids.has(component.id)) || (term !== '' && !component.id.toLowerCase().includes(term))
                return (
                  <button
                    key={component.id}
                    ref={register(component.id)}
                    type="button"
                    data-node={component.id}
                    data-dimmed={dimmed}
                    aria-label={componentLabel(component)}
                    aria-pressed={selectedId === component.id}
                    onMouseEnter={() => setHovered(component.id)}
                    onFocus={() => setHovered(component.id)}
                    onBlur={() => setHovered(null)}
                    onClick={() => choose({ kind: 'component', id: component.id }, component.id)}
                    className={`relative z-10 flex min-w-[9.5rem] max-w-[14rem] flex-col items-start gap-0.5 overflow-hidden rounded-lg border bg-slate-900 py-2 pl-3.5 pr-3 text-left transition duration-200 ${
                      isActive || selectedId === component.id ? `${tone.border} ring-2 ring-indigo-400/60` : 'border-slate-700 hover:border-slate-500'
                    } ${dimmed ? 'opacity-30' : 'opacity-100'}`}
                  >
                    <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} />
                    <span className="max-w-full truncate font-mono text-xs text-slate-100" title={component.id}>
                      {shortName(component.id)}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {component.files} file{component.files === 1 ? '' : 's'} · uses {component.depends_on} · used by {component.used_by}
                    </span>
                    {cycles.has(component.id) && (
                      <span className="mt-0.5 rounded-full bg-red-500/15 px-1.5 text-[10px] font-medium text-red-300">in an import cycle</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {document.data_stores.length > 0 && (
          <div role="group" aria-label="Data stores lane" className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500 sm:pt-2">Data stores</p>
            <div className="flex flex-wrap gap-2">
              {document.data_stores.map((store) => {
                const key = storeKey(store.name)
                const dimmed = (active !== null && !related.ids.has(key)) || (term !== '' && !store.name.toLowerCase().includes(term))
                return (
                  <button
                    key={key}
                    ref={register(key)}
                    type="button"
                    data-node={key}
                    data-dimmed={dimmed}
                    aria-label={`${store.name} data store`}
                    aria-pressed={selectedId === key}
                    onMouseEnter={() => setHovered(key)}
                    onFocus={() => setHovered(key)}
                    onBlur={() => setHovered(null)}
                    onClick={() => choose({ kind: 'store', id: store.name }, key)}
                    className={`relative z-10 inline-flex items-center gap-2 rounded-full border bg-slate-900 px-3 py-2 text-xs text-slate-100 transition duration-200 ${
                      active === key || selectedId === key ? 'border-emerald-500/60 ring-2 ring-indigo-400/60' : 'border-slate-700 hover:border-slate-500'
                    } ${dimmed ? 'opacity-30' : 'opacity-100'}`}
                  >
                    <Database className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                    {store.name}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        <Curves curves={curves} width={size.width} height={size.height} />
      </div>
      <p className="text-xs text-slate-500">
        Point at a component to see what it imports and what imports it (the number is how many imports;{' '}
        <span className="text-red-300">red</span> means the two import each other). Click it to see its evidence.
      </p>
    </section>
  )
}

// --- Focus map ---------------------------------------------------------------------------------

function NeighbourCard({
  neighbour,
  component,
  max,
  register,
  onFocus,
}: {
  neighbour: Neighbour
  component: ArchitectureComponent | undefined
  max: number
  register: (element: HTMLElement | null) => void
  onFocus: () => void
}) {
  const tone = component ? ROLE_TONES[component.role] : ROLE_TONES.core
  return (
    <li>
      <button
        ref={register}
        type="button"
        data-node={neighbour.id}
        aria-label={`Focus on ${neighbour.id} (${neighbour.imports} import${neighbour.imports === 1 ? '' : 's'})`}
        onClick={onFocus}
        className="group relative z-10 flex w-full flex-col gap-1 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-2 pl-3.5 pr-3 text-left transition hover:-translate-y-0.5 hover:border-indigo-400/70"
      >
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${tone.bar}`} />
        <span className="flex w-full items-center justify-between gap-2">
          <span className="truncate font-mono text-xs text-slate-100" title={neighbour.id}>
            {shortName(neighbour.id)}
          </span>
          <span className={`shrink-0 font-mono text-[11px] ${neighbour.mutual ? 'text-red-300' : 'text-indigo-300'}`}>{neighbour.imports}</span>
        </span>
        <span aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
          <span className={`block h-1 rounded-full ${neighbour.mutual ? 'bg-red-400' : 'bg-indigo-400'}`} style={{ width: `${Math.max(8, (neighbour.imports / max) * 100)}%` }} />
        </span>
        <span className="text-[10px] text-slate-500">
          {component ? ROLE_LABELS[component.role] : 'Component'}
          {neighbour.mutual && <span className="text-red-300"> · imports each other</span>}
        </span>
      </button>
    </li>
  )
}

/**
 * One component at a time: what it imports on the left, what imports it on the right (with
 * how many imports), and the data stores it uses. Click any card to move the focus there;
 * the trail and Back go back.
 */
export function FocusMap({
  document,
  selection,
  onSelect,
}: {
  document: ArchitectureDocument
  selection: Selection
  onSelect: (selection: Selection) => void
}) {
  const byId = useMemo(() => new Map(document.components.map((component) => [component.id, component])), [document])
  const initial = selection?.kind === 'component' && byId.has(selection.id) ? selection.id : defaultFocus(document)
  const [trail, setTrail] = useState<string[]>(initial ? [initial] : [])
  const focus = trail[trail.length - 1] ?? null
  const container = useRef<HTMLDivElement>(null)
  const { boxes, register } = useBoxes(container, [focus, document])
  const centre = focus ? byId.get(focus) : undefined
  if (!focus || !centre) return <p className="text-sm text-slate-400">No components to focus on.</p>

  const { uses, usedBy, stores } = neighbours(document, focus)
  const max = Math.max(1, ...uses.map((n) => n.imports), ...usedBy.map((n) => n.imports))
  const moveTo = (id: string) => {
    setTrail((list) => (list[list.length - 1] === id ? list : [...list.slice(-11), id]))
    onSelect({ kind: 'component', id })
  }
  const back = () => {
    const previous = trail[trail.length - 2]
    setTrail((list) => list.slice(0, -1))
    if (previous) onSelect({ kind: 'component', id: previous })
  }
  const centreBox = boxes.get(focus)
  const curves = centreBox
    ? [
        ...uses.flatMap((n) => {
          const box = boxes.get(`uses:${n.id}`)
          return box ? [{ ...curveBetween(centreBox, box, 'sideways'), key: `${focus}->${n.id}`, imports: n.imports, mutual: n.mutual }] : []
        }),
        ...usedBy.flatMap((n) => {
          const box = boxes.get(`by:${n.id}`)
          return box ? [{ ...curveBetween(box, centreBox, 'sideways'), key: `${n.id}->${focus}`, imports: n.imports, mutual: n.mutual }] : []
        }),
      ]
    : []
  const size = container.current ? { width: container.current.scrollWidth, height: container.current.scrollHeight } : { width: 0, height: 0 }
  const tone = ROLE_TONES[centre.role]
  const sorted = [...document.components].sort((a, b) => a.id.localeCompare(b.id))

  return (
    <section aria-label="Focus map" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={back}
          disabled={trail.length < 2}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back
        </button>
        <nav aria-label="Focus trail" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs text-slate-500">
          {trail.map((id, index) => (
            <span key={`${id}-${index}`} className="inline-flex items-center gap-1">
              {index > 0 && <span aria-hidden="true">›</span>}
              {index === trail.length - 1 ? (
                <span aria-current="location" className="font-mono text-slate-200">{shortName(id)}</span>
              ) : (
                <button type="button" onClick={() => setTrail((list) => list.slice(0, index + 1))} className="font-mono hover:text-indigo-300">
                  {shortName(id)}
                </button>
              )}
            </span>
          ))}
        </nav>
        <label className="text-xs text-slate-400">
          <span className="sr-only">Focus on a component</span>
          <select
            value={focus}
            onChange={(event) => moveTo(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-100"
          >
            {sorted.map((component) => (
              <option key={component.id} value={component.id}>
                {component.id}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div ref={container} className="relative grid gap-6 rounded-xl border border-slate-800 bg-slate-950/40 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)] md:gap-10">
        <div>
          <h4 className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">Uses ({uses.length})</h4>
          {uses.length === 0 ? (
            <p className="text-xs text-slate-500">Imports no other component.</p>
          ) : (
            <ul aria-label={`Components ${focus} uses`} className="space-y-2">
              {uses.map((n) => (
                <NeighbourCard key={n.id} neighbour={n} component={byId.get(n.id)} max={max} register={register(`uses:${n.id}`)} onFocus={() => moveTo(n.id)} />
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col justify-center">
          <div ref={register(focus)} key={focus} className={`relative z-10 animate-pop-in overflow-hidden rounded-2xl border-2 ${tone.border} bg-slate-900 p-4 shadow-[0_0_30px_rgb(var(--indigo-500)/0.12)]`}>
            <span aria-hidden="true" className={`absolute inset-x-0 top-0 h-1 ${tone.bar}`} />
            <p className={`font-mono text-[10px] uppercase tracking-[0.14em] ${tone.text}`}>{ROLE_LABELS[centre.role]}</p>
            <h4 className="mt-1 break-all font-mono text-sm font-semibold text-slate-50">{centre.id}</h4>
            <p className="mt-2 text-xs text-slate-400">
              {centre.files} file{centre.files === 1 ? '' : 's'} · {centre.code_lines.toLocaleString('en-US')} lines · {centre.languages.join(', ') || 'no language'}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Uses {uses.length} · used by {usedBy.length}
              {uses.some((n) => n.mutual) && <span className="text-red-300"> · in an import cycle</span>}
            </p>
            {stores.length > 0 && (
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
                <Database className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                {stores.join(', ')}
              </p>
            )}
            <button
              type="button"
              onClick={() => onSelect({ kind: 'component', id: focus })}
              className="mt-3 rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-200 hover:border-indigo-400/70 hover:text-indigo-200"
            >
              Show evidence
            </button>
          </div>
        </div>

        <div>
          <h4 className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">Used by ({usedBy.length})</h4>
          {usedBy.length === 0 ? (
            <p className="text-xs text-slate-500">No other component imports it.</p>
          ) : (
            <ul aria-label={`Components using ${focus}`} className="space-y-2">
              {usedBy.map((n) => (
                <NeighbourCard key={n.id} neighbour={n} component={byId.get(n.id)} max={max} register={register(`by:${n.id}`)} onFocus={() => moveTo(n.id)} />
              ))}
            </ul>
          )}
        </div>
        <Curves curves={curves} width={size.width} height={size.height} labels={false} />
      </div>
      <p className="text-xs text-slate-500">
        Left: the components it imports; right: the components importing it, strongest first. Click any card to move the focus
        there.
      </p>
    </section>
  )
}
