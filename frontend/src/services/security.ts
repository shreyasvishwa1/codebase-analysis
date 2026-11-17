import type { FindingFilters, SecurityFindingList, SecurityOverview } from '../types/api'
import { apiClient } from './client'
import { repositoryPath } from './repositories'

export const FINDING_PAGE_SIZE = 50

/** One page of a run's stored security findings, most severe first. */
export async function listRunSecurityFindings(
  projectId: string,
  repositoryId: string,
  runId: string,
  filters: FindingFilters,
): Promise<SecurityFindingList> {
  const params: Record<string, string | number> = {
    page: filters.page ?? 1,
    page_size: FINDING_PAGE_SIZE,
  }
  if (filters.severity) params.severity = filters.severity
  if (filters.confidence) params.confidence = filters.confidence
  if (filters.owasp) params.owasp = filters.owasp
  if (filters.path) params.path = filters.path
  if (filters.q?.trim()) params.q = filters.q.trim()
  const { data } = await apiClient.get<SecurityFindingList>(
    `${repositoryPath(projectId, repositoryId)}/analysis-runs/${runId}/security-findings`,
    { params },
  )
  return data
}

/** The latest security results of each of the user's analyzed repositories. */
export async function getSecurityOverview(): Promise<SecurityOverview> {
  const { data } = await apiClient.get<SecurityOverview>('/security')
  return data
}
