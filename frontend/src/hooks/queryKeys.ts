import type {
  ComplexityFileFilters,
  ComplexityFunctionFilters,
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
}
