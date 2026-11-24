import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { useAnalysisCompletion } from '../hooks/useAnalysisCompletion'
import { useAnalysisRuns } from '../hooks/useAnalysisRuns'
import { isJobActive } from '../utils/jobs'

/** A repository whose full analysis the app follows, whichever page is open. */
export interface WatchedAnalysis {
  projectId: string
  repositoryId: string
  repositoryName: string
}

/** At most this many repositories are followed; the oldest is dropped first. */
export const MAX_WATCHED = 5

interface WatchContextValue {
  watched: WatchedAnalysis[]
  watch: (analysis: WatchedAnalysis) => void
  pollIntervalMs?: number
}

const WatchContext = createContext<WatchContextValue | null>(null)

/** The app-wide watcher, or null outside the signed-in app (pages then follow runs themselves). */
export function useAnalysisWatch(): WatchContextValue['watch'] | null {
  return useContext(WatchContext)?.watch ?? null
}

/** Follows one repository's runs: the same query (and polling) as its analysis page, so with
 * the page open nothing is fetched twice. */
function Watcher({ analysis, pollIntervalMs }: { analysis: WatchedAnalysis; pollIntervalMs?: number }) {
  const runs = useAnalysisRuns(analysis.projectId, analysis.repositoryId, pollIntervalMs)
  useAnalysisCompletion({
    projectId: analysis.projectId,
    repositoryId: analysis.repositoryId,
    repositoryName: analysis.repositoryName,
    job: runs.data?.job ?? null,
    history: runs.data?.runs ?? [],
  })
  return null
}

/**
 * Follows every full analysis started (or seen running) in this session, so leaving the
 * analysis page loses nothing: the status bar keeps showing the progress, and the toast and
 * the tab title come wherever the user is when the run ends.
 */
export function AnalysisWatchProvider({
  children,
  pollIntervalMs,
}: {
  children: ReactNode
  /** how often running analyses are refreshed (tests use a short interval) */
  pollIntervalMs?: number
}) {
  const [watched, setWatched] = useState<WatchedAnalysis[]>([])
  const watch = useCallback((analysis: WatchedAnalysis) => {
    setWatched((list) => {
      const rest = list.filter((item) => item.repositoryId !== analysis.repositoryId)
      const same = list.find((item) => item.repositoryId === analysis.repositoryId)
      if (same && same.repositoryName === analysis.repositoryName && same.projectId === analysis.projectId) return list
      return [...rest, analysis].slice(-MAX_WATCHED)
    })
  }, [])
  const value = useMemo(() => ({ watched, watch, pollIntervalMs }), [watched, watch, pollIntervalMs])
  return (
    <WatchContext.Provider value={value}>
      {children}
      {watched.map((analysis) => (
        <Watcher key={analysis.repositoryId} analysis={analysis} pollIntervalMs={pollIntervalMs} />
      ))}
    </WatchContext.Provider>
  )
}

function RunningChip({ analysis, pollIntervalMs }: { analysis: WatchedAnalysis; pollIntervalMs?: number }) {
  const runs = useAnalysisRuns(analysis.projectId, analysis.repositoryId, pollIntervalMs)
  const job = runs.data?.job
  if (!job || !isJobActive(job)) return null
  return (
    <Link
      to={`/projects/${analysis.projectId}/repositories/${analysis.repositoryId}/analysis`}
      className="inline-flex min-w-0 items-center gap-1.5 text-amber-300 hover:text-amber-200"
    >
      <span aria-hidden="true" className="led animate-pulse text-amber-300" />
      <span className="truncate">
        {job.status === 'pending' ? 'Queued' : 'Analyzing'} {analysis.repositoryName}
      </span>
      {job.status === 'processing' && <span className="tabular-nums">{job.progress}%</span>}
    </Link>
  )
}

/** The status bar's list of running analyses, each linking to its live board. */
export function RunningAnalyses() {
  const context = useContext(WatchContext)
  if (!context || context.watched.length === 0) return null
  return (
    <span role="status" aria-label="Running analyses" className="flex min-w-0 items-center gap-3">
      {context.watched.map((analysis) => (
        <RunningChip key={analysis.repositoryId} analysis={analysis} pollIntervalMs={context.pollIntervalMs} />
      ))}
    </span>
  )
}
