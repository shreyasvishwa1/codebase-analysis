import { Minus, Plus, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { ArchitectureDocument, ComponentRole } from '../types/api'

export const ROLE_LABELS: Record<ComponentRole, string> = {
  ui: 'User interface',
  api: 'API',
  auth: 'Authentication',
  worker: 'Background work',
  core: 'Core logic',
  data: 'Data access',
  config: 'Configuration',
  test: 'Tests',
}
const ROLE_COLORS: Record<ComponentRole, string> = {
  ui: '#ec4899',
  api: '#6366f1',
  auth: '#f59e0b',
  worker: '#14b8a6',
  core: '#64748b',
  data: '#10b981',
  config: '#a855f7',
  test: '#0ea5e9',
}
const STORE_COLOR = '#22c55e'
// Columns from left to right: tests drive the code, the interface calls the API, the API calls
// core logic, which uses data access, which uses the data stores.
const COLUMN: Record<ComponentRole, number> = { test: 0, ui: 1, api: 2, auth: 3, worker: 3, core: 3, config: 3, data: 4 }
const STORE_COLUMN = 5
const NODE_W = 176
const NODE_H = 44
const COL_GAP = 236
const ROW_GAP = 62
const PAD = 24
const MAX_ROWS = 7 // a taller column wraps into another sub-column
const MIN_SCALE = 0.3
const MAX_SCALE = 2.5

export type Selection = { kind: 'component' | 'store'; id: string } | null

interface Node {
  kind: 'component' | 'store'
  id: string
  label: string
  role: ComponentRole | null
  files: number
  x: number
  y: number
}

interface Link {
  source: string
  target: string
  weight: number
  store: boolean
  /** the two components import each other directly */
  mutual: boolean
}

export function shortName(id: string): string {
  const parts = id.split('/')
  const label = parts.slice(-2).join('/')
  return label.length > 24 ? `…${label.slice(-23)}` : label
}

/** The component a file belongs to: the longest component directory containing it. */
export function componentOf(path: string, ids: string[]): string | null {
  const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  let best: string | null = null
  for (const id of ids) {
    if (id === '(root)') {
      if (directory === '' && best === null) best = id
    } else if ((directory === id || directory.startsWith(`${id}/`)) && (best === null || best === '(root)' || id.length > best.length)) {
      best = id
    }
  }
  return best
}

export function layout(document: ArchitectureDocument, hidden: Set<ComponentRole>) {
  const components = document.components.filter((c) => !hidden.has(c.role))
  const ids = components.map((c) => c.id)
  const storeLinks: Link[] = []
  const stores = document.data_stores
  for (const store of stores) {
    // A dashed link from each visible component whose files show the data store being used.
    const users = new Set(store.evidence.map((e) => componentOf(e.path, ids)).filter((id): id is string => id !== null))
    users.forEach((user) => storeLinks.push({ source: user, target: `store:${store.name}`, weight: 1, store: true, mutual: false }))
  }
  const groups = new Map<number, Node[]>()
  const add = (column: number, node: Omit<Node, 'x' | 'y'>) => {
    const list = groups.get(column) ?? []
    list.push({ ...node, x: 0, y: 0 })
    groups.set(column, list)
  }
  for (const component of [...components].sort((a, b) => a.id.localeCompare(b.id))) {
    add(COLUMN[component.role], { kind: 'component', id: component.id, label: shortName(component.id), role: component.role, files: component.files })
  }
  for (const store of stores) {
    add(STORE_COLUMN, { kind: 'store', id: `store:${store.name}`, label: store.name, role: null, files: 0 })
  }
  const nodes: Node[] = []
  let subColumn = 0
  let tallest = 1
  for (const column of [...groups.keys()].sort((a, b) => a - b)) {
    const list = groups.get(column) ?? []
    const perColumn = Math.min(MAX_ROWS, list.length)
    tallest = Math.max(tallest, perColumn)
    list.forEach((node, index) => {
      node.x = PAD + (subColumn + Math.floor(index / MAX_ROWS)) * COL_GAP
      node.y = PAD + (index % MAX_ROWS) * ROW_GAP
      nodes.push(node)
    })
    subColumn += Math.ceil(list.length / MAX_ROWS)
  }
  const visible = new Set(ids)
  const pairs = new Set(document.edges.map((e) => `${e.source}->${e.target}`))
  const links: Link[] = [
    ...document.edges
      .filter((e) => visible.has(e.source) && visible.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        weight: e.imports,
        store: false,
        mutual: pairs.has(`${e.target}->${e.source}`),
      })),
    ...storeLinks,
  ]
  const width = PAD * 2 + Math.max(0, subColumn - 1) * COL_GAP + NODE_W
  const height = PAD * 2 + tallest * ROW_GAP - (ROW_GAP - NODE_H)
  return { nodes, links, width, height }
}

function edgePath(from: Node, to: Node): string {
  const sx = from.x + NODE_W
  const sy = from.y + NODE_H / 2
  const tx = to.x
  const ty = to.y + NODE_H / 2
  if (tx > sx) {
    const dx = (tx - sx) / 2
    return `M${sx},${sy} C${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}`
  }
  // Same column or backwards: loop out to the right and come back into the target's left side.
  return `M${sx},${sy} C${sx + 80},${sy} ${tx - 80},${ty} ${tx},${ty}`
}

export function ArchitectureDiagram({ document, selection, onSelect }: {
  document: ArchitectureDocument
  selection: Selection
  onSelect: (selection: Selection) => void
}) {
  const [hidden, setHidden] = useState<Set<ComponentRole>>(new Set())
  const [scale, setScale] = useState(1)
  const { nodes, links, width, height } = useMemo(() => layout(document, hidden), [document, hidden])
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const selectedId = selection ? (selection.kind === 'store' ? `store:${selection.id}` : selection.id) : null
  const connected = new Set<string>()
  if (selectedId) {
    connected.add(selectedId)
    links.forEach((l) => {
      if (l.source === selectedId) connected.add(l.target)
      if (l.target === selectedId) connected.add(l.source)
    })
  }
  const roles = [...new Set(document.components.map((c) => c.role))].sort((a, b) => COLUMN[a] - COLUMN[b])

  function toggleRole(role: ComponentRole) {
    const next = new Set(hidden)
    if (next.has(role)) next.delete(role)
    else next.add(role)
    setHidden(next)
    if (selection?.kind === 'component' && document.components.find((c) => c.id === selection.id)?.role === role) onSelect(null)
  }

  function zoom(factor: number) {
    setScale((k) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(k * factor * 100) / 100)))
  }

  const select = (node: Node) => {
    const next: Selection = node.kind === 'store' ? { kind: 'store', id: node.id.slice('store:'.length) } : { kind: 'component', id: node.id }
    onSelect(selectedId === node.id ? null : next)
  }

  return (
    <section aria-label="Architecture diagram" className="space-y-2">
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
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: ROLE_COLORS[role] }} />
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={() => zoom(1.25)} aria-label="Zoom in" className="rounded border border-slate-700 p-1 text-slate-300 hover:bg-slate-800"><Plus className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" onClick={() => zoom(0.8)} aria-label="Zoom out" className="rounded border border-slate-700 p-1 text-slate-300 hover:bg-slate-800"><Minus className="h-4 w-4" aria-hidden="true" /></button>
          <button type="button" onClick={() => setScale(1)} aria-label="Reset zoom" className="rounded border border-slate-700 p-1 text-slate-300 hover:bg-slate-800"><RotateCcw className="h-4 w-4" aria-hidden="true" /></button>
        </div>
      </div>
      {/* Drawn at its natural size (times the zoom); the box scrolls in both directions. */}
      <div className="max-h-[32rem] overflow-auto rounded-xl border border-slate-800 bg-slate-950/60">
        <svg
          role="img"
          aria-label={`Diagram of ${nodes.length} components and data stores with ${links.length} connections`}
          width={width * scale}
          height={height * scale}
          viewBox={`0 0 ${width} ${height}`}
          className="select-none"
        >
          <defs>
            {['normal', 'cycle', 'active'].map((kind) => (
              <marker key={kind} id={`arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill={kind === 'cycle' ? '#f43f5e' : kind === 'active' ? '#c7d2fe' : '#475569'} />
              </marker>
            ))}
          </defs>
          <g>
            {links.map((link) => {
              const from = byId.get(link.source)
              const to = byId.get(link.target)
              if (!from || !to) return null
              const active = selectedId !== null && (link.source === selectedId || link.target === selectedId)
              const dimmed = selectedId !== null && !active
              const color = link.mutual ? '#f43f5e' : active ? '#c7d2fe' : '#475569'
              return (
                <path
                  key={`${link.source}->${link.target}`}
                  data-edge={`${link.source}->${link.target}`}
                  d={edgePath(from, to)}
                  fill="none"
                  stroke={color}
                  strokeWidth={Math.min(6, 1 + Math.log2(link.weight))}
                  strokeDasharray={link.store ? '5 4' : undefined}
                  opacity={dimmed ? 0.12 : 0.85}
                  markerEnd={`url(#arrow-${link.mutual ? 'cycle' : active ? 'active' : 'normal'})`}
                >
                  <title>{link.store ? `${link.source} uses ${to.label}` : `${link.source} imports ${link.target} (${link.weight})`}</title>
                </path>
              )
            })}
            {nodes.map((node) => {
              const color = node.role ? ROLE_COLORS[node.role] : STORE_COLOR
              const active = selectedId === node.id
              const dimmed = selectedId !== null && !connected.has(node.id)
              const name = node.kind === 'store' ? `${node.label} data store` : `${node.id}: ${ROLE_LABELS[node.role as ComponentRole]}, ${node.files} file${node.files === 1 ? '' : 's'}`
              return (
                <g
                  key={node.id}
                  data-node={node.id}
                  role="button"
                  tabIndex={0}
                  aria-label={name}
                  aria-pressed={active}
                  transform={`translate(${node.x} ${node.y})`}
                  opacity={dimmed ? 0.3 : 1}
                  className="cursor-pointer outline-none"
                  onClick={() => select(node)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      select(node)
                    }
                  }}
                >
                  <title>{node.kind === 'store' ? node.label : node.id}</title>
                  <rect width={NODE_W} height={NODE_H} rx={node.kind === 'store' ? 22 : 10} fill="#0f172a" stroke={color} strokeWidth={active ? 3 : 1.5} />
                  <rect width={6} height={NODE_H} rx={3} fill={color} />
                  <text x={16} y={19} fill="#e2e8f0" fontSize={12} fontFamily="ui-monospace, monospace">{node.label}</text>
                  <text x={16} y={34} fill="#94a3b8" fontSize={10}>
                    {node.kind === 'store' ? 'Data store' : `${ROLE_LABELS[node.role as ComponentRole]} · ${node.files} file${node.files === 1 ? '' : 's'}`}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      <p className="text-xs text-slate-500">
        Arrows are imports between components (thicker means more imports;{' '}
        <span className="text-rose-300">red</span> arrows join two components that import each other); dashed arrows lead to the data
        stores a component uses. Scroll to move around; select a component to see its evidence.
      </p>
    </section>
  )
}
