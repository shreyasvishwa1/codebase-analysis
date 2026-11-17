import type { CodeIssueList, IssueFilters, QualityOverview } from '../types/api'
import { apiClient } from './client'
import { repositoryPath } from './repositories'

export const ISSUE_PAGE_SIZE = 50

/** One page of a run's stored code-quality issues, most severe first. */
export async function listRunIssues(
  projectId: string,
  repositoryId: string,
  runId: string,
  filters: IssueFilters,
): Promise<CodeIssueList> {
  const params: Record<string, string | number> = {
    page: filters.page ?? 1,
    page_size: ISSUE_PAGE_SIZE,
  }
  if (filters.severity) params.severity = filters.severity
  if (filters.category) params.category = filters.category
  if (filters.path) params.path = filters.path
  if (filters.q?.trim()) params.q = filters.q.trim()
  const { data } = await apiClient.get<CodeIssueList>(
    `${repositoryPath(projectId, repositoryId)}/analysis-runs/${runId}/issues`,
    { params },
  )
  return data
}

/** The latest code-quality results of each of the user's analyzed repositories. */
export async function getQualityOverview(): Promise<QualityOverview> {
  const { data } = await apiClient.get<QualityOverview>('/code-quality')
  return data
}
