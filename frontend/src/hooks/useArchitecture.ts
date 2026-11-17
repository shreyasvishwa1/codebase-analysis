import { useQuery } from '@tanstack/react-query'

import { getArchitectureOverview, getRunArchitecture } from '../services/architecture'
import { queryKeys } from './queryKeys'

export function useRunArchitecture(projectId: string, repositoryId: string, runId: string) {
  return useQuery({
    queryKey: queryKeys.runArchitecture(projectId, repositoryId, runId),
    queryFn: () => getRunArchitecture(projectId, repositoryId, runId),
  })
}

export function useArchitectureOverview() {
  return useQuery({ queryKey: queryKeys.architectureOverview, queryFn: getArchitectureOverview })
}
