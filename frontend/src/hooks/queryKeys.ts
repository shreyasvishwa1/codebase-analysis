import type {
  ComplexityFileFilters,
  ComplexityFunctionFilters,
  DependencyFilters,
  FindingFilters,
  IssueFilters,
} from '../types/api'

export const queryKeys = {
  health: ['health'] as const,
  projects: ['projects'] as const,
  project: (projectId: string) => ['projects', projectId] as const,
  repositories: (projectId: string) => ['projects', projectId, 'repositories'] as const,
  repository: (projectId: string, repositoryId: string) =>
    ['projects', projectId, 'repositories', repositoryId] as const,
  tree: (projectId: string, repositoryId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'tree'] as const,
  storage: (projectId: string, repositoryId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'storage'] as const,
  languages: (projectId: string, repositoryId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'languages'] as const,
  jobs: (projectId: string, repositoryId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'jobs'] as const,
  fileContent: (projectId: string, repositoryId: string, path: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'file-content', path] as const,
  codeMetrics: (projectId: string, repositoryId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'code-metrics'] as const,
  dependencies: (projectId: string, repositoryId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'dependencies'] as const,
  secretScan: (projectId: string, repositoryId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'secret-scan'] as const,
  analysisRuns: (projectId: string, repositoryId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'analysis-runs'] as const,
  dashboard: ['dashboard'] as const,
  runIssues: (projectId: string, repositoryId: string, runId: string, filters: IssueFilters) =>
    ['projects', projectId, 'repositories', repositoryId, 'analysis-runs', runId, 'issues', filters] as const,
  qualityOverview: ['code-quality'] as const,
  runSecurityFindings: (projectId: string, repositoryId: string, runId: string, filters: FindingFilters) =>
    ['projects', projectId, 'repositories', repositoryId, 'analysis-runs', runId, 'security-findings', filters] as const,
  securityOverview: ['security'] as const,
  complexityFiles: (projectId: string, repositoryId: string, runId: string, filters: ComplexityFileFilters) =>
    ['projects', projectId, 'repositories', repositoryId, 'analysis-runs', runId, 'complexity-files', filters] as const,
  complexityFunctions: (projectId: string, repositoryId: string, runId: string, filters: ComplexityFunctionFilters) =>
    ['projects', projectId, 'repositories', repositoryId, 'analysis-runs', runId, 'complexity-functions', filters] as const,
  complexityOverview: ['complexity'] as const,
  runDependencies: (projectId: string, repositoryId: string, runId: string, filters: DependencyFilters) =>
    ['projects', projectId, 'repositories', repositoryId, 'analysis-runs', runId, 'dependencies', filters] as const,
  dependencyOverview: ['dependency-analysis'] as const,
  runArchitecture: (projectId: string, repositoryId: string, runId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'analysis-runs', runId, 'architecture'] as const,
  architectureOverview: ['architecture'] as const,
  // Every health-score key contains 'health-score', so a change of weights refreshes them all.
  runHealth: (projectId: string, repositoryId: string, runId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'analysis-runs', runId, 'health-score'] as const,
  healthHistory: (projectId: string, repositoryId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'health-score', 'history'] as const,
  healthOverview: ['health-score'] as const,
  healthWeights: ['health-score', 'weights'] as const,
  chatStatus: ['chat', 'status'] as const,
  accountSummary: ['account', 'summary'] as const,
  chatOverview: ['chat'] as const,
  reports: (repositoryId: string | null) => ['reports', repositoryId ?? 'all'] as const,
  analysisHistory: (repositoryId: string | null, limit: number) =>
    ['analysis-history', repositoryId ?? 'all', limit] as const,
  conversations: (projectId: string, repositoryId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'chat', 'conversations'] as const,
  conversation: (projectId: string, repositoryId: string, conversationId: string) =>
    ['projects', projectId, 'repositories', repositoryId, 'chat', 'conversations', conversationId] as const,
}
