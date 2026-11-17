import type { AnalysisRunJob, AnalysisRunList, DashboardSummary } from '../types/api'
import { apiClient } from './client'
import { repositoryPath } from './repositories'

function analysisRunsPath(projectId: string, repositoryId: string): string {
  return `${repositoryPath(projectId, repositoryId)}/analysis-runs`
}

/** The latest full-analysis job and the repository's completed runs (newest first). */
export async function listAnalysisRuns(
  projectId: string,
  repositoryId: string,
): Promise<AnalysisRunList> {
  const { data } = await apiClient.get<AnalysisRunList>(analysisRunsPath(projectId, repositoryId))
  return data
}

/** Start a full analysis of the repository's current snapshot; returns the queued job. */
export async function startAnalysisRun(
  projectId: string,
  repositoryId: string,
): Promise<AnalysisRunJob> {
  const { data } = await apiClient.post<AnalysisRunJob>(analysisRunsPath(projectId, repositoryId))
  return data
}

/** Totals across the signed-in user's projects. */
export async function getDashboard(): Promise<DashboardSummary> {
  const { data } = await apiClient.get<DashboardSummary>('/dashboard')
  return data
}
