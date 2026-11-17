import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { getSecurityOverview, listRunSecurityFindings } from '../services/security'
import type { FindingFilters } from '../types/api'
import { queryKeys } from './queryKeys'

/** One page of a run's findings; the previous page stays visible while the next loads. */
export function useRunSecurityFindings(
  projectId: string,
  repositoryId: string,
  runId: string,
  filters: FindingFilters,
) {
  return useQuery({
    queryKey: queryKeys.runSecurityFindings(projectId, repositoryId, runId, filters),
    queryFn: () => listRunSecurityFindings(projectId, repositoryId, runId, filters),
    placeholderData: keepPreviousData,
  })
}

export function useSecurityOverview() {
  return useQuery({ queryKey: queryKeys.securityOverview, queryFn: getSecurityOverview })
}
