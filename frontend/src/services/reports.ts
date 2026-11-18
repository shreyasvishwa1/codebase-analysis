import type { AnalysisHistory, GeneratedReport, ReportList } from '../types/api'
import { apiClient } from './client'
import { repositoryPath } from './repositories'

export async function listReports(repositoryId: string | null): Promise<ReportList> {
  const { data } = await apiClient.get<ReportList>('/reports', {
    params: repositoryId ? { repository_id: repositoryId } : undefined,
  })
  return data
}

/** Generate a PDF report of one run; it is kept for the user to download. */
export async function createReport(projectId: string, repositoryId: string, runId: string): Promise<GeneratedReport> {
  const { data } = await apiClient.post<GeneratedReport>(
    `${repositoryPath(projectId, repositoryId)}/analysis-runs/${runId}/reports`,
    undefined,
    { timeout: 120_000 },
  )
  return data
}

/** The report's PDF (the request carries the session token, so it is fetched, not linked). */
export async function downloadReport(reportId: string): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(`/reports/${reportId}/download`, { responseType: 'blob' })
  return data
}

export async function deleteReport(reportId: string): Promise<void> {
  await apiClient.delete(`/reports/${reportId}`)
}

export async function getAnalysisHistory(repositoryId: string | null, limit: number): Promise<AnalysisHistory> {
  const { data } = await apiClient.get<AnalysisHistory>('/analysis-history', {
    params: { limit, ...(repositoryId ? { repository_id: repositoryId } : {}) },
  })
  return data
}
