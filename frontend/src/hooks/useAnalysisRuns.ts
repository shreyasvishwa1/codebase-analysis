import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getDashboard, listAnalysisRuns, startAnalysisRun } from '../services/analysisRuns'
import { isJobActive, JOB_POLL_INTERVAL_MS } from '../utils/jobs'
import { queryKeys } from './queryKeys'

/** The repository's runs; polled only while its latest full-analysis job is active. */
export function useAnalysisRuns(
  projectId: string,
  repositoryId: string,
  pollIntervalMs: number = JOB_POLL_INTERVAL_MS,
) {
  return useQuery({
    queryKey: queryKeys.analysisRuns(projectId, repositoryId),
    queryFn: () => listAnalysisRuns(projectId, repositoryId),
    refetchInterval: (query) =>
      isJobActive(query.state.data?.job ?? undefined) ? pollIntervalMs : false,
  })
}

/** Start a full analysis; on success the runs (polling), the job list and the dashboard refresh. */
export function useStartAnalysisRun(projectId: string, repositoryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => startAnalysisRun(projectId, repositoryId),
    onSuccess: () => {
      for (const key of [
        queryKeys.analysisRuns(projectId, repositoryId),
        queryKeys.jobs(projectId, repositoryId),
        queryKeys.dashboard,
      ]) {
        void queryClient.invalidateQueries({ queryKey: key, exact: true })
      }
    },
  })
}

export function useDashboard() {
  return useQuery({ queryKey: queryKeys.dashboard, queryFn: getDashboard })
}
