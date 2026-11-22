import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'

import { CodeMetricsPanel } from '../components/CodeMetricsPanel'
import { CodeSearchPanel } from '../components/CodeSearchPanel'
import { DependenciesPanel } from '../components/DependenciesPanel'
import { ErrorMessage } from '../components/ErrorMessage'
import { FileTree } from '../components/FileTree'
import { FilesMissingNotice, INGESTION_ANCHOR } from '../components/FilesMissingNotice'
import { FileViewer, type LineSelection } from '../components/FileViewer'
import { IngestPanel } from '../components/IngestPanel'
import { JobProgress } from '../components/JobProgress'
import { LanguageStats } from '../components/LanguageStats'
import { RepositoryDashboard } from '../components/RepositoryDashboard'
import { RepositoryNav } from '../components/RepositoryNav'
import { RepositorySettings } from '../components/RepositorySettings'
import { SecretsPanel } from '../components/SecretsPanel'
import { StatusBadge } from '../components/StatusBadge'
import { SymbolSearchPanel } from '../components/SymbolSearchPanel'
import {
  useRepository,
  useRepositoryLanguages,
  useRepositoryStorage,
  useRepositoryTree,
} from '../hooks/useRepository'
import { getErrorMessage } from '../services/client'
import { formatBytes } from '../utils/format'

const CARD = 'rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-glow'

/** A file and line to open on arrival, set by links to reported lines (Code Analysis). */
function openFileFrom(state: unknown): { path: string; line: number } | null {
  const openFile = (state as { openFile?: { path?: unknown; line?: unknown } } | null)?.openFile
  if (typeof openFile?.path !== 'string' || typeof openFile.line !== 'number') return null
  return { path: openFile.path, line: openFile.line }
}

export function RepositoryPage() {
  const { projectId = '', repositoryId = '' } = useParams()
  const location = useLocation()
  const repository = useRepository(projectId, repositoryId)
  const tree = useRepositoryTree(projectId, repositoryId)
  const languages = useRepositoryLanguages(projectId, repositoryId)
  // Asking also restores the files if the server's disk was reset since the import.
  const storage = useRepositoryStorage(projectId, repositoryId, repository.data?.status === 'ready')
  const [openFile] = useState(() => openFileFrom(location.state))
  const [selectedPath, setSelectedPath] = useState<string | null>(openFile?.path ?? null)
  // A fresh object per selection, so choosing the same line again scrolls to it again.
  const [selectedLine, setSelectedLine] = useState<LineSelection | null>(
    openFile ? { line: openFile.line } : null,
  )
  const fileCard = useRef<HTMLElement>(null)
  const loaded = repository.data !== undefined

  // Opened at a reported line: bring the file viewer into view once the page has rendered.
  // An instant jump (not smooth) lets the browser's scroll anchoring keep the viewer in view
  // while the panels above it finish loading and grow.
  useEffect(() => {
    const card = fileCard.current
    if (openFile && loaded && card && typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ block: 'start' })
    }
  }, [openFile, loaded])

  if (repository.isPending) {
    return <p className="text-sm text-slate-400">Loading repository…</p>
  }
  if (repository.isError) {
    return (
      <ErrorMessage message={getErrorMessage(repository.error, 'Could not load the repository')} />
    )
  }
  const repo = repository.data

  /** Selection from the tree: open the file without a line and without scrolling. */
  const selectFromTree = (path: string) => {
    setSelectedPath(path)
    setSelectedLine(null)
  }

  /** Selection from an analysis panel: open the file and bring the viewer into view. */
  const selectFromPanel = (path: string) => {
    setSelectedPath(path)
    setSelectedLine(null)
    const card = fileCard.current
    if (card && typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  /** Selection of a line within the open file (outline): highlight it without moving the page. */
  const selectLineInFile = (path: string, line: number) => {
    setSelectedPath(path)
    setSelectedLine({ line })
  }

  /** Selection of a reported line (Search, Secrets): open the file at that line. */
  const selectLineFromPanel = (path: string, line: number) => {
    selectFromPanel(path)
    setSelectedLine({ line })
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <Link to={`/projects/${projectId}`} className="text-sm text-indigo-300 hover:underline">
          ← Project
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">{repo.name}</h1>
          <StatusBadge status={repo.status} />
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Source: {repo.source_type}
          {/* Shown as plain text on purpose: never a clickable external link. */}
          {repo.source_url && <span className="ml-2 break-all font-mono">{repo.source_url}</span>}
          {repo.default_branch && <span className="ml-2">({repo.default_branch})</span>}
        </p>
        <RepositorySettings
          key={repo.id}
          projectId={projectId}
          repositoryId={repositoryId}
          repository={repo}
        />
      </div>

      {storage.data?.files === 'missing' && <FilesMissingNotice repository={repo} />}

      <RepositoryNav projectId={projectId} repositoryId={repositoryId} />

      <RepositoryDashboard
        projectId={projectId}
        repositoryId={repositoryId}
        repository={repo}
        tree={tree.data}
        languages={languages.data}
        onSelectFile={selectFromPanel}
      />

      <div className="grid gap-6 md:grid-cols-2">
        <div id={INGESTION_ANCHOR} className={`${CARD} scroll-mt-20`}>
          <IngestPanel repository={repo} />
        </div>
        <div className={CARD}>
          <JobProgress projectId={projectId} repositoryId={repositoryId} />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className={CARD} aria-label="Files">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200 before:h-4 before:w-1 before:rounded-full before:bg-indigo-400 before:content-['']">
            Files
            {tree.data && (
              <span className="ml-2 font-normal text-slate-500">
                {tree.data.file_count} files · {formatBytes(tree.data.total_bytes)}
              </span>
            )}
          </h2>
          {tree.isPending && <p className="text-sm text-slate-400">Loading files…</p>}
          {tree.isError && (
            <ErrorMessage message={getErrorMessage(tree.error, 'Could not load files')} />
          )}
          {tree.data && (
            <FileTree
              tree={tree.data.tree}
              onSelectFile={selectFromTree}
              selectedPath={selectedPath}
            />
          )}
        </section>
        <section className={CARD} aria-label="Languages">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200 before:h-4 before:w-1 before:rounded-full before:bg-indigo-400 before:content-['']">Languages</h2>
          {languages.isPending && <p className="text-sm text-slate-400">Loading languages…</p>}
          {languages.isError && (
            <ErrorMessage
              message={getErrorMessage(languages.error, 'Could not load language statistics')}
            />
          )}
          {languages.data && <LanguageStats languages={languages.data.languages} />}
        </section>
      </div>

      <section className={CARD} aria-label="Search">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200 before:h-4 before:w-1 before:rounded-full before:bg-indigo-400 before:content-['']">Search</h2>
        <CodeSearchPanel
          projectId={projectId}
          repositoryId={repositoryId}
          onSelectFile={selectFromPanel}
          onSelectLine={selectLineFromPanel}
        />
      </section>

      <section className={CARD} aria-label="Symbols">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200 before:h-4 before:w-1 before:rounded-full before:bg-indigo-400 before:content-['']">Symbols</h2>
        <SymbolSearchPanel
          projectId={projectId}
          repositoryId={repositoryId}
          onSelectLine={selectLineFromPanel}
        />
      </section>

      <section className={CARD} aria-label="Code metrics">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200 before:h-4 before:w-1 before:rounded-full before:bg-indigo-400 before:content-['']">Code metrics</h2>
        <CodeMetricsPanel
          projectId={projectId}
          repositoryId={repositoryId}
          repositoryStatus={repo.status}
          onSelectFile={selectFromPanel}
        />
      </section>

      <section className={CARD} aria-label="Dependencies">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200 before:h-4 before:w-1 before:rounded-full before:bg-indigo-400 before:content-['']">Dependencies</h2>
        <DependenciesPanel
          projectId={projectId}
          repositoryId={repositoryId}
          onSelectFile={selectFromPanel}
        />
      </section>

      <section className={CARD} aria-label="Secrets">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200 before:h-4 before:w-1 before:rounded-full before:bg-indigo-400 before:content-['']">Secrets</h2>
        <SecretsPanel
          projectId={projectId}
          repositoryId={repositoryId}
          onSelectFile={selectFromPanel}
          onSelectLine={selectLineFromPanel}
        />
      </section>

      <section className={CARD} aria-label="File" ref={fileCard}>
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200 before:h-4 before:w-1 before:rounded-full before:bg-indigo-400 before:content-['']">File</h2>
        <FileViewer
          projectId={projectId}
          repositoryId={repositoryId}
          selectedPath={selectedPath}
          selectedLine={selectedLine}
          onSelectLine={selectLineInFile}
          onSelectFile={selectFromPanel}
        />
      </section>
    </div>
  )
}
