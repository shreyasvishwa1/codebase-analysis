import type { ArchitectureOverview, ArchitectureReport } from '../types/api'
import { apiClient } from './client'
import { repositoryPath } from './repositories'

/** A run's architecture document (components, edges, technologies, routes, ...). */
export async function getRunArchitecture(
  projectId: string,
  repositoryId: string,
  runId: string,
): Promise<ArchitectureReport> {
  const { data } = await apiClient.get<ArchitectureReport>(
    `${repositoryPath(projectId, repositoryId)}/analysis-runs/${runId}/architecture`,
  )
  return data
}

/** The latest architecture summary of each of the user's analyzed repositories. */
export async function getArchitectureOverview(): Promise<ArchitectureOverview> {
  const { data } = await apiClient.get<ArchitectureOverview>('/architecture')
  return data
}
