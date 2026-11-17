import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import {
  getHealthHistory,
  getHealthOverview,
  getHealthWeights,
  getRunHealth,
  resetHealthWeights,
  saveHealthWeights,
} from '../services/healthScore'
import type { HealthWeights, HealthWeightsResponse } from '../types/api'
import { queryKeys } from './queryKeys'

export function useRunHealth(projectId: string, repositoryId: string, runId: string) {
  return useQuery({
    queryKey: queryKeys.runHealth(projectId, repositoryId, runId),
    queryFn: () => getRunHealth(projectId, repositoryId, runId),
  })
}

export function useHealthHistory(projectId: string, repositoryId: string) {
  return useQuery({
    queryKey: queryKeys.healthHistory(projectId, repositoryId),
    queryFn: () => getHealthHistory(projectId, repositoryId),
  })
}

export function useHealthOverview() {
  return useQuery({ queryKey: queryKeys.healthOverview, queryFn: getHealthOverview })
}

export function useHealthWeights() {
  return useQuery({ queryKey: queryKeys.healthWeights, queryFn: getHealthWeights })
}

/** Scores are computed with the user's weights, so every health-score query is refreshed. */
function refreshScores(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => query.queryKey.includes('health-score'),
  })
}

export function useSaveHealthWeights() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (weights: HealthWeights) => saveHealthWeights(weights),
    onSuccess: (saved) => {
      queryClient.setQueryData<HealthWeightsResponse>(queryKeys.healthWeights, saved)
      void refreshScores(queryClient)
    },
  })
}

export function useResetHealthWeights() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: resetHealthWeights,
    onSuccess: () => void refreshScores(queryClient),
  })
}
