import { useQueries, useQuery } from '@tanstack/react-query'
import { ArrowRight, CornerDownLeft, FolderGit2, Moon, Search, Sun, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { queryKeys } from '../hooks/queryKeys'
import { useTheme } from '../hooks/useTheme'
import { listProjects } from '../services/projects'
import { listRepositories } from '../services/repositories'

export interface PaletteLink {
  to: string
  label: string
  icon: LucideIcon
}

interface Command {
  id: string
  group: 'Pages' | 'Repositories' | 'Actions'
  label: string
  hint?: string
  icon: LucideIcon
  run: () => void
}

const MAX_SHOWN = 40

/** Commands whose text contains every word of the query (case-insensitive), in order. */
export function filterCommands<T extends { label: string; hint?: string; group: string }>(commands: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return commands
  return commands.filter((command) => {
    const text = `${command.label} ${command.hint ?? ''} ${command.group}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

/** Ctrl+K / Cmd+K: jump to any page or repository, or run an action, from the keyboard.
 * Repositories are loaded only while the palette is open. */
export function CommandPalette({
  open,
  onClose,
  pages,
  onSignOut,
}: {
  open: boolean
  onClose: () => void
  pages: PaletteLink[]
  onSignOut: () => void
}) {
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const projects = useQuery({ queryKey: queryKeys.projects, queryFn: listProjects, enabled: open })
  const repositoryLists = useQueries({
    queries: (open ? projects.data ?? [] : []).map((project) => ({
      queryKey: queryKeys.repositories(project.id),
      queryFn: () => listRepositories(project.id),
    })),
  })

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      const previous = document.activeElement as HTMLElement | null
      window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => previous?.focus?.()
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      onClose()
      navigate(to)
    }
    const list: Command[] = pages.map((page) => ({
      id: `page:${page.to}`,
      group: 'Pages',
      label: page.label,
      icon: page.icon,
      run: go(page.to),
    }))
    ;(projects.data ?? []).forEach((project, index) => {
      for (const repository of repositoryLists[index]?.data ?? []) {
        const base = `/projects/${project.id}/repositories/${repository.id}`
        list.push(
          { id: `repo:${repository.id}`, group: 'Repositories', label: repository.name, hint: `${project.name} · explorer`, icon: FolderGit2, run: go(base) },
          { id: `repo:${repository.id}:health`, group: 'Repositories', label: `${repository.name}: health score`, hint: project.name, icon: ArrowRight, run: go(`${base}/health`) },
          { id: `repo:${repository.id}:security`, group: 'Repositories', label: `${repository.name}: security findings`, hint: project.name, icon: ArrowRight, run: go(`${base}/security`) },
          { id: `repo:${repository.id}:chat`, group: 'Repositories', label: `${repository.name}: ask the AI`, hint: project.name, icon: ArrowRight, run: go(`${base}/chat`) },
          { id: `repo:${repository.id}:analysis`, group: 'Repositories', label: `${repository.name}: run a full analysis`, hint: project.name, icon: ArrowRight, run: go(`${base}/analysis`) },
        )
      }
    })
    list.push(
      {
        id: 'action:theme',
        group: 'Actions',
        label: theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme',
        icon: theme === 'dark' ? Sun : Moon,
        run: () => {
          toggle()
          onClose()
        },
      },
      {
        id: 'action:sign-out',
        group: 'Actions',
        label: 'Sign out',
        icon: ArrowRight,
        run: () => {
          onClose()
          onSignOut()
        },
      },
    )
    return list
  }, [pages, projects.data, repositoryLists, theme, toggle, navigate, onClose, onSignOut])

  const shown = filterCommands(commands, query).slice(0, MAX_SHOWN)
  const loadingRepositories = open && (projects.isPending || repositoryLists.some((list) => list.isPending))

  if (!open) return null

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (shown.length ? (index + 1) % shown.length : 0))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (shown.length ? (index - 1 + shown.length) % shown.length : 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      shown[active]?.run()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl animate-pop-in overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-800 px-4">
          <Search className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
            aria-label="Search pages, repositories and actions"
            placeholder="Search pages, repositories and actions…"
            className="h-12 flex-1 border-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:!shadow-none focus:outline-none"
          />
          <span className="kbd">Esc</span>
        </div>
        <ul id={listId} role="listbox" aria-label="Commands" className="max-h-[52vh] overflow-y-auto p-2">
          {shown.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-slate-500">{loadingRepositories ? 'Loading repositories…' : 'Nothing matches.'}</li>
          )}
          {shown.map((command, index) => {
            const header = command.group !== lastGroup ? command.group : null
            lastGroup = command.group
            const Icon = command.icon
            return (
              <li key={command.id} role="presentation">
                {header && <p className="px-3 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500 first:pt-1">{header}</p>}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseMove={() => setActive(index)}
                  onClick={() => command.run()}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${index === active ? 'bg-slate-800 text-slate-50' : 'text-slate-300'}`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${index === active ? 'text-indigo-400' : 'text-slate-500'}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">{command.label}</span>
                  {command.hint && <span className="truncate text-xs text-slate-500">{command.hint}</span>}
                  {index === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />}
                </div>
              </li>
            )
          })}
        </ul>
        <div className="flex items-center gap-4 border-t border-slate-800 px-4 py-2 font-mono text-[11px] text-slate-500">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> move</span>
          <span><span className="kbd">↵</span> open</span>
          <span><span className="kbd">Esc</span> close</span>
        </div>
      </div>
    </div>
  )
}
