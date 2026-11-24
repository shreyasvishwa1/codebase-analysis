import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { useToast } from '../components/Toaster'
import { getHealthHistory } from '../services/healthScore'
import type { AnalysisJob, AnalysisRun } from '../types/api'
import { isJobActive } from '../utils/jobs'
import { analysisTitle, healthChange, runChanges, summarizeChanges } from '../utils/runChanges'
import { queryKeys } from './queryKeys'

export const APP_TITLE = 'CodeBase Analysis'

/**
 * What happens around a full analysis of one repository, wherever it is followed from:
 * - while it runs, the browser tab shows its progress ("45% · Analyzing shop-api");
 * - when it ends, the dashboard totals refresh and a toast says how it ended and what changed
 *   since the previous run (health score, findings, code issues);
 * - if it ends while the tab is hidden, "Analysis done" stays in the title until the tab is seen.
 * `enabled: false` turns all of it off (a page whose run is followed by the app-wide watcher).
 */
export function useAnalysisCompletion({
  projectId,
  repositoryId,
  repositoryName,
  job,
  history,
  enabled = true,
}: {
  projectId: string
  repositoryId: string
  repositoryName: string
  job: AnalysisJob | null
  /** completed runs, newest first */
  history: AnalysisRun[]
  enabled?: boolean
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const active = isJobActive(job ?? undefined)

  const wasActive = useRef(false)
  const latestHistory = useRef(history)
  latestHistory.current = history
  useEffect(() => {
    if (!enabled) return
    if (wasActive.current && !active) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard, exact: true })
      if (job?.status === 'completed') {
        const [latest, previous] = latestHistory.current
        const changes = latest ? runChanges(latest, previous) : []
        const notify = (health: ReturnType<typeof healthChange>) => {
          const summary = summarizeChanges([health, ...changes].filter((change) => change !== null))
          toast({
            title: 'Analysis complete',
            description: `${repositoryName} was analyzed. ${summary || 'Its health score and findings are ready.'}`,
            action: { label: 'See the health score', to: `/projects/${projectId}/repositories/${repositoryId}/health` },
          })
        }
        if (previous) {
          // The new run's score; the toast says nothing about health if it cannot be read.
          queryClient
            .fetchQuery({
              queryKey: queryKeys.healthHistory(projectId, repositoryId),
              queryFn: () => getHealthHistory(projectId, repositoryId),
              staleTime: 0,
            })
            .then((data) => notify(healthChange(data.points)), () => notify(null))
        } else {
          notify(null)
        }
      } else if (job?.status === 'failed') {
        toast({ title: 'Analysis failed', description: job.error_message ?? undefined, tone: 'error' })
      }
    }
    wasActive.current = active
  }, [enabled, active, job?.status, job?.error_message, queryClient, toast, repositoryName, projectId, repositoryId])

  const wasRunningTitle = useRef(false)
  useEffect(() => {
    if (!enabled || !job || !active) return
    wasRunningTitle.current = true
    document.title = `${analysisTitle(job, repositoryName)} — ${APP_TITLE}`
  }, [enabled, job, active, repositoryName])
  useEffect(() => {
    if (!enabled || active || !wasRunningTitle.current) return
    wasRunningTitle.current = false
    if (!document.hidden) {
      document.title = APP_TITLE
      return
    }
    document.title = `${job?.status === 'failed' ? 'Analysis failed' : 'Analysis done'} — ${APP_TITLE}`
    const seen = () => {
      if (document.hidden) return
      document.title = APP_TITLE
      document.removeEventListener('visibilitychange', seen)
    }
    document.addEventListener('visibilitychange', seen)
    return () => document.removeEventListener('visibilitychange', seen)
  }, [enabled, active, job?.status])
  useEffect(
    () => () => {
      if (wasRunningTitle.current) document.title = APP_TITLE
    },
    [],
  )
}
