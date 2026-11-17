import type { DependencyFilters, DependencyOverview, DependencyRecordList } from '../types/api'
import { apiClient } from './client'
import { repositoryPath } from './repositories'

export const DEPENDENCY_PAGE_SIZE = 25

/** One page of a run's declared dependencies (riskiest first by default). */
export async function listRunDependencies(
  projectId: string,
  repositoryId: string,
  runId: string,
  filters: DependencyFilters,
): Promise<DependencyRecordList> {
  const params: Record<string, string | number | boolean> = {
    page: filters.page ?? 1,
    page_size: DEPENDENCY_PAGE_SIZE,
    sort: filters.sort ?? 'risk',
  }
  if (filters.ecosystem) params.ecosystem = filters.ecosystem
  if (filters.scope) params.scope = filters.scope
  if (filters.update) params.update = filters.update
  if (filters.vulnerable !== undefined) params.vulnerable = filters.vulnerable
  if (filters.conflict !== undefined) params.conflict = filters.conflict
  if (filters.q?.trim()) params.q = filters.q.trim()
  const { data } = await apiClient.get<DependencyRecordList>(
    `${repositoryPath(projectId, repositoryId)}/analysis-runs/${runId}/dependencies`,
    { params },
  )
  return data
}

/** The latest dependency results of each of the user's analyzed repositories. */
export async function getDependencyOverview(): Promise<DependencyOverview> {
  const { data } = await apiClient.get<DependencyOverview>('/dependency-analysis')
  return data
}
