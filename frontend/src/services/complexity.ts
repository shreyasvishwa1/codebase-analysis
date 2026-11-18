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

/** The code city's buildings: at most this many files, the largest first. */
export const CITY_FILE_LIMIT = 400
const CITY_PAGE_SIZE = 200 // the server's largest page

/** A run's largest files (up to `limit`) and how many it has in all. */
export async function listLargestFiles(
  projectId: string,
  repositoryId: string,
  runId: string,
  limit: number = CITY_FILE_LIMIT,
): Promise<ComplexityFileList> {
  const items: ComplexityFileList['items'] = []
  let total = 0
  for (let page = 1; items.length < limit; page += 1) {
    const { data } = await apiClient.get<ComplexityFileList>(`${complexityPath(projectId, repositoryId, runId)}/files`, {
      params: { page, page_size: CITY_PAGE_SIZE, sort: 'size' },
    })
    items.push(...data.items)
    total = data.total
    if (data.items.length < CITY_PAGE_SIZE || items.length >= total) break
  }
  return { items: items.slice(0, limit), total, page: 1, page_size: limit }
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
