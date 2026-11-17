import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { getQualityOverview, listRunIssues } from '../services/codeQuality'
import type { IssueFilters } from '../types/api'
import { queryKeys } from './queryKeys'

/** One page of a run's issues; the previous page stays visible while the next loads. */
export function useRunIssues(
  projectId: string,
  repositoryId: string,
  runId: string,
  filters: IssueFilters,
) {
  return useQuery({
    queryKey: queryKeys.runIssues(projectId, repositoryId, runId, filters),
    queryFn: () => listRunIssues(projectId, repositoryId, runId, filters),
    placeholderData: keepPreviousData,
  })
}

export function useQualityOverview() {
  return useQuery({ queryKey: queryKeys.qualityOverview, queryFn: getQualityOverview })
}
