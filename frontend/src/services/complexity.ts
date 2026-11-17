import type {
  ComplexityFileFilters,
  ComplexityFileList,
  ComplexityFunctionFilters,
  ComplexityFunctionList,
  ComplexityOverview,
} from '../types/api'
import { apiClient } from './client'
import { repositoryPath } from './repositories'

export const COMPLEXITY_PAGE_SIZE = 25

function complexityPath(projectId: string, repositoryId: string, runId: string): string {
  return `${repositoryPath(projectId, repositoryId)}/analysis-runs/${runId}/complexity`
}

/** One page of a run's files, sorted (most complex first by default). */
export async function listComplexityFiles(
  projectId: string,
  repositoryId: string,
  runId: string,
  filters: ComplexityFileFilters,
): Promise<ComplexityFileList> {
  const params: Record<string, string | number> = {
    page: filters.page ?? 1,
    page_size: COMPLEXITY_PAGE_SIZE,
    sort: filters.sort ?? 'complexity',
  }
  if (filters.rank) params.rank = filters.rank
  if (filters.maintainability) params.maintainability = filters.maintainability
  if (filters.q?.trim()) params.q = filters.q.trim()
  const { data } = await apiClient.get<ComplexityFileList>(
    `${complexityPath(projectId, repositoryId, runId)}/files`,
    { params },
  )
  return data
}

/** One page of a run's most complex functions. */
export async function listComplexityFunctions(
  projectId: string,
  repositoryId: string,
  runId: string,
  filters: ComplexityFunctionFilters,
): Promise<ComplexityFunctionList> {
  const params: Record<string, string | number> = {
    page: filters.page ?? 1,
    page_size: COMPLEXITY_PAGE_SIZE,
  }
  if (filters.rank) params.rank = filters.rank
  if (filters.path) params.path = filters.path
  if (filters.q?.trim()) params.q = filters.q.trim()
  const { data } = await apiClient.get<ComplexityFunctionList>(
    `${complexityPath(projectId, repositoryId, runId)}/functions`,
    { params },
  )
  return data
}

/** The latest complexity results of each of the user's analyzed repositories. */
export async function getComplexityOverview(): Promise<ComplexityOverview> {
  const { data } = await apiClient.get<ComplexityOverview>('/complexity')
  return data
}
