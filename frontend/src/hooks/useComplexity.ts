import { keepPreviousData, useQuery } from '@tanstack/react-query'

import {
  getComplexityOverview,
  listComplexityFiles,
  listComplexityFunctions,
} from '../services/complexity'
import type { ComplexityFileFilters, ComplexityFunctionFilters } from '../types/api'
import { queryKeys } from './queryKeys'

export function useComplexityFiles(
  projectId: string,
  repositoryId: string,
  runId: string,
  filters: ComplexityFileFilters,
) {
  return useQuery({
    queryKey: queryKeys.complexityFiles(projectId, repositoryId, runId, filters),
    queryFn: () => listComplexityFiles(projectId, repositoryId, runId, filters),
    placeholderData: keepPreviousData,
  })
}

export function useComplexityFunctions(
  projectId: string,
  repositoryId: string,
  runId: string,
  filters: ComplexityFunctionFilters,
) {
  return useQuery({
    queryKey: queryKeys.complexityFunctions(projectId, repositoryId, runId, filters),
    queryFn: () => listComplexityFunctions(projectId, repositoryId, runId, filters),
    placeholderData: keepPreviousData,
  })
}

export function useComplexityOverview() {
  return useQuery({ queryKey: queryKeys.complexityOverview, queryFn: getComplexityOverview })
}
