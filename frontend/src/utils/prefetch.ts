import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { queryKeys } from '../hooks/queryKeys'
import { getDashboard } from '../services/analysisRuns'
import { getArchitectureOverview } from '../services/architecture'
import { getAccountSummary } from '../services/auth'
import { getChatOverview } from '../services/chat'
import { getQualityOverview } from '../services/codeQuality'
import { getComplexityOverview } from '../services/complexity'
import { getDependencyOverview } from '../services/dependencyAnalysis'
import { getHealthOverview } from '../services/healthScore'
import { listProjects } from '../services/projects'
import { getAnalysisHistory } from '../services/reports'
import { getSecurityOverview } from '../services/security'
import { getMyUsability, getUsabilityResults } from '../services/usability'
import { PATH_PAGES, preloadPage } from '../routes/pages'
import { HISTORY_PAGE } from './history'

interface Prefetch {
  queryKey: QueryKey
  queryFn: () => Promise<unknown>
}

/** The data each main page loads first, keyed by its path. */
export const PAGE_DATA: Record<string, Prefetch[]> = {
  '/overview': [
    { queryKey: queryKeys.dashboard, queryFn: getDashboard },
    { queryKey: queryKeys.healthOverview, queryFn: getHealthOverview },
  ],
  '/projects': [{ queryKey: queryKeys.projects, queryFn: listProjects }],
  '/upload': [{ queryKey: queryKeys.projects, queryFn: listProjects }],
  '/code-analysis': [{ queryKey: queryKeys.qualityOverview, queryFn: getQualityOverview }],
  '/security': [{ queryKey: queryKeys.securityOverview, queryFn: getSecurityOverview }],
  '/complexity': [{ queryKey: queryKeys.complexityOverview, queryFn: getComplexityOverview }],
  '/dependencies': [{ queryKey: queryKeys.dependencyOverview, queryFn: getDependencyOverview }],
  '/architecture': [{ queryKey: queryKeys.architectureOverview, queryFn: getArchitectureOverview }],
  '/health-score': [{ queryKey: queryKeys.healthOverview, queryFn: getHealthOverview }],
  '/chat': [{ queryKey: queryKeys.chatOverview, queryFn: getChatOverview }],
  '/settings': [{ queryKey: queryKeys.accountSummary, queryFn: getAccountSummary }],
  '/rate': [
    { queryKey: queryKeys.usabilityMine, queryFn: getMyUsability },
    { queryKey: queryKeys.usabilityResults, queryFn: getUsabilityResults },
  ],
  '/history': [
    { queryKey: queryKeys.analysisHistory(null, HISTORY_PAGE), queryFn: () => getAnalysisHistory(null, HISTORY_PAGE) },
  ],
}

/** How long a hover-prefetched result counts as fresh, so moving the pointer back and forth
 * over the menu does not repeat requests. */
export const PREFETCH_FRESH_MS = 15_000

/** Start loading a page (its file and its data) before it opens, on hover or keyboard focus of
 * its link. Failures are ignored here; the page shows its own error when it opens. */
export function prefetchPage(queryClient: QueryClient, path: string): void {
  const page = PATH_PAGES[path]
  if (page) void preloadPage(page)
  for (const { queryKey, queryFn } of PAGE_DATA[path] ?? []) {
    void queryClient.prefetchQuery({ queryKey, queryFn, staleTime: PREFETCH_FRESH_MS })
  }
}
