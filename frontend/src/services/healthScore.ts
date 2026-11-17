import type {
  HealthHistory,
  HealthOverview,
  HealthReport,
  HealthWeights,
  HealthWeightsResponse,
} from '../types/api'
import { apiClient } from './client'
import { repositoryPath } from './repositories'

/** A run's health score: the overall score, each dimension and the weights used. */
export async function getRunHealth(
  projectId: string,
  repositoryId: string,
  runId: string,
): Promise<HealthReport> {
  const { data } = await apiClient.get<HealthReport>(
    `${repositoryPath(projectId, repositoryId)}/analysis-runs/${runId}/health`,
  )
  return data
}

/** A repository's scores over its runs, oldest first. */
export async function getHealthHistory(projectId: string, repositoryId: string): Promise<HealthHistory> {
  const { data } = await apiClient.get<HealthHistory>(
    `${repositoryPath(projectId, repositoryId)}/health-history`,
  )
  return data
}

/** The latest score of each of the user's analyzed repositories. */
export async function getHealthOverview(): Promise<HealthOverview> {
  const { data } = await apiClient.get<HealthOverview>('/health-score')
  return data
}

export async function getHealthWeights(): Promise<HealthWeightsResponse> {
  const { data } = await apiClient.get<HealthWeightsResponse>('/health-score/weights')
  return data
}

export async function saveHealthWeights(weights: HealthWeights): Promise<HealthWeightsResponse> {
  const { data } = await apiClient.put<HealthWeightsResponse>('/health-score/weights', weights)
  return data
}

/** Back to the default weights. */
export async function resetHealthWeights(): Promise<void> {
  await apiClient.delete('/health-score/weights')
}
