import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { getDependencyOverview, listRunDependencies } from '../services/dependencyAnalysis'
import type { DependencyFilters } from '../types/api'
import { queryKeys } from './queryKeys'

export function useRunDependencies(
  projectId: string,
  repositoryId: string,
  runId: string,
  filters: DependencyFilters,
) {
  return useQuery({
    queryKey: queryKeys.runDependencies(projectId, repositoryId, runId, filters),
    queryFn: () => listRunDependencies(projectId, repositoryId, runId, filters),
    placeholderData: keepPreviousData,
  })
}

export function useDependencyOverview() {
  return useQuery({ queryKey: queryKeys.dependencyOverview, queryFn: getDependencyOverview })
}
