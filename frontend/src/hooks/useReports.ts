import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { createReport, deleteReport, downloadReport, getAnalysisHistory, listReports } from '../services/reports'
import type { GeneratedReport } from '../types/api'
import { saveFile } from '../utils/download'
import { queryKeys } from './queryKeys'

export function useReports(repositoryId: string | null) {
  return useQuery({ queryKey: queryKeys.reports(repositoryId), queryFn: () => listReports(repositoryId) })
}

export function useAnalysisHistory(repositoryId: string | null, limit: number) {
  return useQuery({
    queryKey: queryKeys.analysisHistory(repositoryId, limit),
    queryFn: () => getAnalysisHistory(repositoryId, limit),
    placeholderData: (previous) => previous, // keep the list while "Show more" loads
  })
}

/** Reports and their counts in the history change together. */
function refresh(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['reports'] })
  void queryClient.invalidateQueries({ queryKey: ['analysis-history'] })
}

export function useCreateReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, repositoryId, runId }: { projectId: string; repositoryId: string; runId: string }) =>
      createReport(projectId, repositoryId, runId),
    onSuccess: () => refresh(queryClient),
  })
}

export function useDeleteReport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (reportId: string) => deleteReport(reportId),
    onSuccess: () => refresh(queryClient),
  })
}

/** Fetch a report's PDF and hand it to the browser as a file download. */
export function useDownloadReport() {
  return useMutation({
    mutationFn: async (report: GeneratedReport) => saveFile(await downloadReport(report.id), report.filename),
  })
}
