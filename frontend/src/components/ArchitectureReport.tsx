import { FileCode2, Focus, Rows3, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import type { ArchitectureDocument, ComponentRole, EvidenceItem } from '../types/api'
import { ROLE_LABELS, type Selection } from './ArchitectureDiagram'
import { FocusMap, LayerLanes } from './ArchitectureViews'

const CATEGORY_LABELS: Record<string, string> = {
  backend: 'Backend',
  frontend: 'Frontend',
  orm: 'ORM and migrations',
  database: 'Databases',
  queue: 'Queues',
  state: 'State and data fetching',
  http: 'HTTP clients',
  styling: 'Styling',
  build: 'Build',
  testing: 'Testing',
}
const METHOD_STYLES: Record<string, string> = {
  GET: 'text-emerald-300',
  POST: 'text-sky-300',
  PUT: 'text-amber-300',
  PATCH: 'text-amber-300',
  DELETE: 'text-rose-300',
}
const ROUTES_SHOWN = 25
const CARD = 'min-w-0 rounded-xl border border-slate-800 bg-slate-950/40 p-4'
const number = (value: number) => value.toLocaleString('en-US')
const count = (value: number, one: string, many = `${one}s`) => `${number(value)} ${value === 1 ? one : many}`

function EvidenceLink({ evidence, explorer }: { evidence: EvidenceItem; explorer: string }) {
  return (
    <Link
      to={explorer}
      state={{ openFile: { path: evidence.path, line: evidence.line } }}
      className="inline-flex max-w-full items-center gap-1 font-mono text-xs text-indigo-300 hover:underline"
      title={evidence.detail}
    >
      <FileCode2 className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{evidence.path}:{evidence.line}</span>
    </Link>
  )
}

function Details({ document, selection, onClose, explorer }: {
  document: ArchitectureDocument
  selection: NonNullable<Selection>
  onClose: () => void
  explorer: string
}) {
  if (selection.kind === 'store') {
    const store = document.data_stores.find((s) => s.name === selection.id)
    if (!store) return null
    return (
      <aside aria-label={`Details of ${store.name}`} className={`${CARD} space-y-2`}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-slate-100">{store.name}</h3>
          <button type="button" onClick={onClose} aria-label="Close details" className="rounded p-0.5 text-slate-400 hover:bg-slate-800"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <p className="text-xs text-slate-400">Data store, found in:</p>
        <ul className="space-y-1">
          {store.evidence.map((e) => (
            <li key={`${e.path}:${e.line}`} className="text-xs text-slate-300">
              {e.detail} · <EvidenceLink evidence={e} explorer={explorer} />
            </li>
          ))}
        </ul>
      </aside>
    )
  }
  const component = document.components.find((c) => c.id === selection.id)
  if (!component) return null
  const outgoing = document.edges.filter((e) => e.source === component.id)
  const incoming = document.edges.filter((e) => e.target === component.id)
  return (
    <aside aria-label={`Details of ${component.id}`} className={`${CARD} space-y-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-all font-mono text-sm font-semibold text-slate-100">{component.id}</h3>
          <p className="text-xs text-slate-400">
            {ROLE_LABELS[component.role]} · {count(component.files, 'file')} · {count(component.code_lines, 'line')} of code
            {component.languages.length > 0 && ` · ${component.languages.join(', ')}`}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close details" className="rounded p-0.5 text-slate-400 hover:bg-slate-800"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      {component.roles.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Why these roles</h4>
          <ul className="mt-1 space-y-1">
            {component.roles.map((role: ComponentRole) =>
              (component.evidence[role] ?? []).slice(0, 2).map((e) => (
                <li key={`${role}:${e.path}:${e.line}`} className="text-xs text-slate-300">
                  <span className="text-slate-400">{ROLE_LABELS[role]}:</span> {e.detail} · <EvidenceLink evidence={e} explorer={explorer} />
                </li>
              )),
            )}
          </ul>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Imports ({outgoing.length})</h4>
          <ul aria-label={`Components ${component.id} imports`} className="mt-1 space-y-0.5 text-xs text-slate-300">
            {outgoing.length === 0 && <li className="text-slate-500">None</li>}
            {outgoing.map((e) => (
              <li key={e.target} className="break-all"><span className="font-mono">{e.target}</span> <span className="text-slate-500">({e.imports})</span></li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Used by ({incoming.length})</h4>
          <ul aria-label={`Components importing ${component.id}`} className="mt-1 space-y-0.5 text-xs text-slate-300">
            {incoming.length === 0 && <li className="text-slate-500">None</li>}
            {incoming.map((e) => (
              <li key={e.source} className="break-all"><span className="font-mono">{e.source}</span> <span className="text-slate-500">({e.imports})</span></li>
            ))}
          </ul>
        </div>
      </div>
      {outgoing[0]?.examples[0] && (
        <p className="text-xs text-slate-400">
          Example import: <EvidenceLink evidence={outgoing[0].examples[0]} explorer={explorer} />
        </p>
      )}
    </aside>
  )
}

function Routes({ routes, truncated, explorer }: { routes: ArchitectureDocument['routes']; truncated: boolean; explorer: string }) {
  const [method, setMethod] = useState('')
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(ROUTES_SHOWN)
  const methods = [...new Set(routes.map((r) => r.method))].sort()
  const text = query.trim().toLowerCase()
  const matching = routes.filter((r) => (!method || r.method === method) && (!text || r.path.toLowerCase().includes(text) || r.file.toLowerCase().includes(text)))
  return (
    <section aria-label="API routes" className={`${CARD} space-y-3`}>
      <h3 className="text-sm font-semibold text-slate-100">API routes ({number(routes.length)}{truncated ? '+' : ''})</h3>
      <p className="text-xs text-slate-500">Paths as declared in each file (with that file&apos;s router prefix).</p>
      {routes.length === 0 ? (
        <p className="text-sm text-slate-400">No route declarations were found.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-400">
              Method
              <select value={method} onChange={(e) => { setMethod(e.target.value); setShown(ROUTES_SHOWN) }} className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100">
                <option value="">All</option>
                {methods.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1 text-xs text-slate-400">
              Filter routes
              <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setShown(ROUTES_SHOWN) }} maxLength={200} placeholder="Path or file" className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
            </label>
          </div>
          <p role="status" className="text-xs text-slate-400">{count(matching.length, 'route')}</p>
          <ul className="divide-y divide-slate-800">
            {matching.slice(0, shown).map((r) => (
              <li key={`${r.method}:${r.path}:${r.file}:${r.line}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-sm">
                <span className={`w-14 shrink-0 font-mono text-xs font-semibold ${METHOD_STYLES[r.method] ?? 'text-slate-300'}`}>{r.method}</span>
                <span className="min-w-0 flex-1 break-all font-mono text-slate-100">{r.path || '/'}</span>
                <EvidenceLink evidence={{ path: r.file, line: r.line, detail: r.framework }} explorer={explorer} />
              </li>
            ))}
          </ul>
          {matching.length > shown && (
            <button type="button" onClick={() => setShown(shown + ROUTES_SHOWN)} className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">
              Show more routes
            </button>
          )}
        </>
      )}
    </section>
  )
}

/** A run's architecture: summary, the interactive diagram, observations and the evidence lists. */
export function ArchitectureReport({ document, projectId, repositoryId }: {
  document: ArchitectureDocument
  projectId: string
  repositoryId: string
}) {
  const [selection, setSelection] = useState<Selection>(null)
  const [view, setView] = useState<'lanes' | 'focus'>('lanes')
  const explorer = `/projects/${projectId}/repositories/${repositoryId}`
  const imports = document.edges.reduce((sum, e) => sum + e.imports, 0)
  const categories = [...new Set(document.technologies.map((t) => t.category))]
  const stats: [string, string][] = [
    ['Components', number(document.components.length)],
    ['Connections', number(document.edges.length)],
    ['API routes', number(document.routes.length)],
    ['Entry points', number(document.entry_points.length)],
    ['Technologies', number(document.technologies.length)],
    ['Data stores', number(document.data_stores.length)],
  ]
  if (document.components.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
        No Python, JavaScript or TypeScript source files were found, so there is no component diagram.
      </p>
    )
  }
  return (
    <div className="space-y-5">
      <dl aria-label="Architecture summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([label, value]) => (
          <div key={label} className={CARD}>
            <dt className="text-xs text-slate-400">{label}</dt>
            <dd className="text-2xl font-extrabold tabular-nums text-slate-50">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-slate-500">
        Components are directories (shown {document.depth} level{document.depth === 1 ? '' : 's'} deep); connections are{' '}
        {count(imports, 'import')} between their files{document.truncated.edges ? ' (the strongest connections are shown)' : ''}.
        Everything below links to the file and line it comes from.
      </p>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-3">
          <div role="group" aria-label="Architecture view" className="inline-flex rounded-lg border border-slate-700 bg-slate-950/60 p-1">
            {([
              ['lanes', 'Layer lanes', Rows3],
              ['focus', 'Focus map', Focus],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                aria-pressed={view === key}
                onClick={() => setView(key)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ${view === key ? 'bg-indigo-500 font-semibold' : 'text-slate-300 hover:bg-slate-800'}`}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
          {view === 'lanes' ? (
            <LayerLanes document={document} selection={selection} onSelect={setSelection} />
          ) : (
            <FocusMap document={document} selection={selection} onSelect={setSelection} />
          )}
        </div>
        {selection ? (
          <Details document={document} selection={selection} onClose={() => setSelection(null)} explorer={explorer} />
        ) : (
          <p className={`${CARD} text-sm text-slate-400`}>Select a component or data store to see its files, connections and evidence.</p>
        )}
      </div>

      <section aria-label="Observations" className={`${CARD} space-y-2`}>
        <h3 className="text-sm font-semibold text-slate-100">Observations</h3>
        {document.observations.length === 0 ? (
          <p className="text-sm text-slate-400">No observations.</p>
        ) : (
          <ul className="space-y-3">
            {document.observations.map((o) => (
              <li key={`${o.title}:${o.detail}`}>
                <p className="text-sm font-medium text-slate-100">{o.title}</p>
                <p className="text-sm text-slate-300">{o.detail}</p>
                {o.evidence.length > 0 && (
                  <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    {o.evidence.map((e) => (
                      <EvidenceLink key={`${e.path}:${e.line}`} evidence={e} explorer={explorer} />
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Technologies" className={`${CARD} space-y-2`}>
        <h3 className="text-sm font-semibold text-slate-100">Technologies</h3>
        {document.technologies.length === 0 ? (
          <p className="text-sm text-slate-400">No known frameworks or libraries were found.</p>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2">
            {categories.map((category) => (
              <div key={category}>
                <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">{CATEGORY_LABELS[category] ?? category}</dt>
                {document.technologies.filter((t) => t.category === category).map((t) => (
                  <dd key={t.name} className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-100">
                    {t.name}
                    {t.evidence[0] && <EvidenceLink evidence={t.evidence[0]} explorer={explorer} />}
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        )}
      </section>

      <Routes routes={document.routes} truncated={document.truncated.routes} explorer={explorer} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-label="Entry points" className={`${CARD} space-y-2`}>
          <h3 className="text-sm font-semibold text-slate-100">Entry points</h3>
          {document.entry_points.length === 0 ? (
            <p className="text-sm text-slate-400">No entry points were found.</p>
          ) : (
            <ul className="space-y-1.5">
              {document.entry_points.map((e) => (
                <li key={`${e.path}:${e.line}:${e.kind}`} className="text-sm">
                  <span className="text-slate-100">{e.detail}</span> <span className="text-xs text-slate-500">({e.kind})</span>
                  <div><EvidenceLink evidence={e} explorer={explorer} /></div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Infrastructure" className={`${CARD} space-y-2`}>
          <h3 className="text-sm font-semibold text-slate-100">Infrastructure</h3>
          {document.infrastructure.length === 0 ? (
            <p className="text-sm text-slate-400">No container, CI or deployment files were found.</p>
          ) : (
            <ul className="space-y-1.5">
              {document.infrastructure.map((i) => (
                <li key={`${i.path}:${i.line}:${i.detail}`} className="text-sm">
                  <span className="text-slate-100">{i.detail}</span> <span className="text-xs text-slate-500">({i.kind})</span>
                  <div><EvidenceLink evidence={i} explorer={explorer} /></div>
                </li>
              ))}
            </ul>
          )}
          {document.services.length > 0 && (
            <div className="pt-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Docker Compose services</h4>
              <ul aria-label="Docker Compose services" className="mt-1 space-y-1 text-sm">
                {document.services.map((s) => (
                  <li key={`${s.file}:${s.name}`} className="text-slate-300">
                    <span className="font-mono text-slate-100">{s.name}</span>: {s.image ?? (s.build ? 'built from source' : 'no image')}
                    {s.data_store && <span className="text-emerald-300"> ({s.data_store})</span>}
                    {s.ports.length > 0 && <span className="text-slate-500"> · ports {s.ports.join(', ')}</span>}
                    {s.depends_on.length > 0 && <span className="text-slate-500"> · depends on {s.depends_on.join(', ')}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
