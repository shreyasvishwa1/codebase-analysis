// Types mirroring the backend's /api/v1 response schemas.

export type RepositoryStatus = 'pending' | 'processing' | 'ready' | 'failed'
export type RepositorySourceType = 'zip' | 'github'
export type AnalysisJobStatus = 'pending' | 'processing' | 'completed' | 'failed'
export type AnalysisJobType = 'ingestion' | 'code_metrics' | 'full_analysis'

export interface User {
  id: string
  email: string
  created_at: string
  updated_at: string
}

export interface TokenResponse {
  access_token: string
  token_type: 'bearer'
}

export interface Project {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface ProjectCreate {
  name: string
  description?: string | null
}

/** Partial update (PATCH): omitted fields stay unchanged; description may be set to null. */
export interface ProjectUpdate {
  name?: string
  description?: string | null
}

export interface Repository {
  id: string
  project_id: string
  name: string
  source_type: RepositorySourceType
  source_url: string | null
  default_branch: string | null
  status: RepositoryStatus
  created_at: string
  updated_at: string
}

export interface RepositoryCreate {
  name: string
  source_type: RepositorySourceType
  source_url?: string
  default_branch?: string
}

/** Partial update (PATCH); the frontend only renames repositories. */
export interface RepositoryUpdate {
  name?: string
}

export interface AnalysisJob {
  id: string
  project_id: string
  repository_id: string
  job_type: AnalysisJobType
  status: AnalysisJobStatus
  progress: number
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface IngestionJobResponse {
  job_id: string
  repository_id: string
  status: AnalysisJobStatus
}

export interface TreeFile {
  type: 'file'
  name: string
  path: string
  extension: string | null
  language: string | null
  size_bytes: number
}

export interface TreeDirectory {
  type: 'directory'
  name: string
  path: string
  children: TreeNode[]
}

export type TreeNode = TreeDirectory | TreeFile

export interface RepositoryTree {
  repository_id: string
  status: RepositoryStatus
  file_count: number
  total_bytes: number
  tree: TreeDirectory
}

export interface FileContent {
  path: string
  language: string | null
  size_bytes: number
  /** null when the file cannot be shown as text; see reason */
  content: string | null
  reason: 'binary' | 'too_large' | null
}

export type FileMetricStatus = 'analyzed' | 'binary' | 'too_large' | 'unavailable'

export interface FileMetric {
  path: string
  language: string | null
  status: FileMetricStatus
  /** set only for analyzed files */
  line_count: number | null
  blank_line_count: number | null
}

export interface CodeMetricsSummary {
  files: number
  analyzed: number
  binary: number
  too_large: number
  unavailable: number
  total_lines: number
  blank_lines: number
}

export interface CodeMetrics {
  /** the latest code-metrics job, if any */
  job: AnalysisJob | null
  /** null until the current snapshot is analyzed */
  summary: CodeMetricsSummary | null
  files: FileMetric[]
}

export interface CodeMetricsJob {
  job_id: string
  repository_id: string
  status: AnalysisJobStatus
}

export interface FileExplanation {
  path: string
  /** plain text from the model; untrusted, render as text only */
  explanation: string
  model: string
  input_tokens: number | null
  output_tokens: number | null
}

export type ManifestStatus = 'parsed' | 'invalid' | 'too_large' | 'unavailable'

export interface DependencyEntry {
  name: string
  /** extras, version constraints and markers exactly as written */
  specifier: string
  /** runtime | dev | peer | optional | optional:<group> */
  scope: string
}

export interface DependencyManifest {
  path: string
  ecosystem: 'npm' | 'python'
  status: ManifestStatus
  dependencies: DependencyEntry[]
}

export interface DependencySummary {
  manifests: number
  parsed: number
  invalid: number
  too_large: number
  unavailable: number
  dependencies: number
}

export interface DependencyInventory {
  manifests: DependencyManifest[]
  summary: DependencySummary
  truncated: boolean
}

export type SecretRule =
  | 'aws-access-key-id'
  | 'github-token'
  | 'slack-token'
  | 'stripe-live-key'
  | 'google-api-key'
  | 'anthropic-api-key'
  | 'private-key'

/** Location of a likely secret; the server never sends the matched value. */
export interface SecretFinding {
  /** POSIX path relative to the repository root */
  path: string
  /** 1-based */
  line: number
  rule: SecretRule
  description: string
}

export interface SecretScanSummary {
  files_scanned: number
  /** includes content that is not valid UTF-8 */
  binary: number
  too_large: number
  unavailable: number
  findings: number
}

export interface SecretScan {
  findings: SecretFinding[]
  summary: SecretScanSummary
  truncated: boolean
}

/** One matching line from the server's literal, case-insensitive search. */
export interface CodeSearchMatch {
  /** POSIX path relative to the repository root */
  path: string
  /** 1-based */
  line: number
  /** at most 200 characters of the matching line; untrusted, render as text only */
  preview: string
}

export interface CodeSearchSummary {
  files_scanned: number
  /** includes content that is not valid UTF-8 */
  binary: number
  too_large: number
  unavailable: number
  matches: number
}

export interface CodeSearchResult {
  matches: CodeSearchMatch[]
  summary: CodeSearchSummary
  truncated: boolean
}

export type OutlineStatus =
  | 'parsed'
  | 'syntax_error'
  | 'too_large'
  | 'binary'
  | 'unsupported_language'

/** One class, function or method of a Python file; the name is untrusted text. */
export interface OutlineSymbol {
  kind: 'class' | 'function' | 'method'
  async: boolean
  name: string
  /** 1-based line of the class/def statement */
  line: number
  end_line: number
  /** 0 = top level */
  depth: number
}

export interface CodeOutline {
  path: string
  status: OutlineStatus
  /** empty unless status is 'parsed' */
  symbols: OutlineSymbol[]
  truncated: boolean
}

/** One import statement of a Python file, as resolved by the server (authoritative). */
export interface ImportEntry {
  line: number
  statement: 'import' | 'from'
  /** "from" module as written; null for "import" and "from . import" */
  module: string | null
  /** leading dots of a relative import; 0 = absolute */
  level: number
  names: string[]
  /** matching repository paths, sorted by the server (at most 5) */
  targets: string[]
  resolution: 'resolved' | 'ambiguous' | 'not_found'
}

export interface CodeImports {
  path: string
  status: OutlineStatus
  /** empty unless status is 'parsed' */
  imports: ImportEntry[]
  truncated: boolean
}

/** One statement of an importer that resolves to the target (Step 39 fields, no targets). */
export type ImporterImport = Omit<ImportEntry, 'targets'>

/** A Python file whose imports resolve to the target file (server-sorted by path). */
export interface Importer {
  path: string
  /** in source order, at most 20 */
  imports: ImporterImport[]
}

export interface ImportersSummary {
  files_scanned: number
  too_large: number
  binary: number
  syntax_error: number
}

export interface CodeImporters {
  path: string
  status: 'scanned' | 'unsupported_language'
  /** empty unless status is 'scanned' */
  importers: Importer[]
  summary: ImportersSummary
  truncated: boolean
}

/** One Python definition (Step 37 symbol fields) and its file. */
export type SymbolMatch = OutlineSymbol & { path: string }

export interface SymbolSearchSummary {
  files_scanned: number
  too_large: number
  binary: number
  syntax_error: number
}

export interface SymbolSearchResult {
  /** server order: by path, then source order */
  results: SymbolMatch[]
  summary: SymbolSearchSummary
  truncated: boolean
}

export interface LanguageStatistic {
  language: string | null
  file_count: number
  total_bytes: number
  percentage: number
}

export interface RepositoryLanguages {
  repository_id: string
  status: RepositoryStatus
  total_files: number
  total_bytes: number
  languages: LanguageStatistic[]
}

export interface Health {
  status: string
}

/** Step 45 go-to-definition outcome for one position of a Python file. */
export type DefinitionStatus =
  | 'resolved'
  | 'ambiguous'
  | 'not_found'
  | 'unsupported'
  | 'no_identifier'
  | 'syntax_error'
  | 'too_large'
  | 'binary'
  | 'unsupported_language'

/** The identifier found at the requested position. */
export interface DefinitionReference {
  path: string
  /** 1-based */
  line: number
  /** 1-based code-point column of the identifier's first character */
  column: number
  name: string
}

/** One definition the identifier resolves to. */
export interface DefinitionLocation {
  path: string
  kind: 'class' | 'function' | 'method' | 'module'
  name: string
  /** 1-based line of the class/def statement (1 for modules) */
  line: number
  end_line: number
}

export interface CodeDefinitionResult {
  status: DefinitionStatus
  /** null unless an identifier was found */
  reference: DefinitionReference | null
  /** server order (by path, then line); empty unless resolved or ambiguous */
  definitions: DefinitionLocation[]
  truncated: boolean
}

/** Step 47 find-references outcome; every status except 'scanned' describes the target. */
export type ReferencesStatus =
  | 'scanned'
  | 'not_a_definition'
  | 'unsupported_target'
  | 'syntax_error'
  | 'too_large'
  | 'binary'
  | 'unsupported_language'

/** One location that statically refers to the target definition. */
export interface ReferenceLocation {
  path: string
  /** 1-based */
  line: number
  /** 1-based code-point column of the identifier's first character */
  column: number
  name: string
  context: 'name' | 'attribute' | 'import'
  /** go-to-definition here also returns other definitions */
  ambiguous: boolean
}

export interface ReferencesSummary {
  files_scanned: number
  too_large: number
  binary: number
  syntax_error: number
  /** counted before the server's reference cap */
  references: number
  /** counted before the server's reference cap */
  ambiguous: number
  unsupported: number
}

export interface CodeReferencesResult {
  status: ReferencesStatus
  /** null unless scanned or unsupported_target */
  target: DefinitionLocation | null
  /** server order (path, line, column); empty unless scanned */
  references: ReferenceLocation[]
  /** all zero unless scanned */
  summary: ReferencesSummary
  truncated: boolean
}

/** Step 49 call-hierarchy outcome; every status except 'scanned' describes the target file. */
export type CallHierarchyStatus =
  | 'scanned'
  | 'not_a_definition'
  | 'syntax_error'
  | 'too_large'
  | 'binary'
  | 'unsupported_language'

/** 'unsupported_target': a method or nested class, whose callers are not searched. */
export type CallersStatus = 'scanned' | 'unsupported_target'

/**
 * One call. It has no path of its own: a caller group's calls are positions in caller.path,
 * a callee group's calls are positions in the response target's file (target.path).
 */
export interface CallSite {
  /** 1-based */
  line: number
  /** 1-based code-point column of the called name */
  column: number
  name: string
  /** go-to-definition here also returns other definitions */
  ambiguous: boolean
}

export interface CallerGroup {
  /** the def, class body or module making the calls */
  caller: DefinitionLocation
  /** before the response caps */
  total_calls: number
  calls: CallSite[]
}

export interface CalleeGroup {
  /** a called class, function or method */
  callee: DefinitionLocation
  /** before the response caps */
  total_calls: number
  calls: CallSite[]
}

export interface CallHierarchySummary {
  files_scanned: number
  too_large: number
  binary: number
  syntax_error: number
  caller_calls: number
  caller_ambiguous: number
  caller_unsupported: number
  non_call_references: number
  callee_calls: number
  callee_ambiguous: number
  callee_unsupported: number
  callee_builtin: number
  callee_unresolved: number
  callee_not_callable: number
  callee_dynamic: number
}

export interface CallHierarchyResult {
  status: CallHierarchyStatus
  /** null unless scanned */
  target: DefinitionLocation | null
  /** null unless scanned */
  callers_status: CallersStatus | null
  /** server order; null unless callers were searched */
  callers: CallerGroup[] | null
  /** server order; empty unless scanned */
  callees: CalleeGroup[]
  summary: CallHierarchySummary
  /** null exactly when callers is null */
  callers_truncated: boolean | null
  callees_truncated: boolean
}

/** Step 51 type-hierarchy outcome; every status except 'scanned' describes the target file. */
export type TypeHierarchyStatus =
  | 'scanned'
  | 'not_a_definition'
  | 'not_a_class'
  | 'syntax_error'
  | 'too_large'
  | 'binary'
  | 'unsupported_language'

/** 'unsupported_target': a class nested in a class, whose subclasses are not searched. */
export type SubclassesStatus = 'scanned' | 'unsupported_target'

export type BaseKind =
  | 'resolved'
  | 'ambiguous'
  | 'not_a_class'
  | 'builtin'
  | 'unsupported'
  | 'unresolved'
  | 'dynamic'

/** A base expression's position. It has no path of its own: it is in the target's file. */
export interface BaseSite {
  /** 1-based */
  line: number
  /** 1-based code-point column of the base name */
  column: number
  name: string
}

export interface BaseEntry {
  /** null exactly when the kind is dynamic */
  site: BaseSite | null
  kind: BaseKind
  /** server order; empty unless resolved, ambiguous or not_a_class */
  definitions: DefinitionLocation[]
}

/** Where a subclass names the target. It has no path of its own: it is in subclass.path. */
export interface SubclassSite {
  /** 1-based */
  line: number
  /** 1-based code-point column of the base name */
  column: number
  name: string
  /** go-to-definition here also returns other definitions */
  ambiguous: boolean
}

export interface SubclassEntry {
  subclass: DefinitionLocation
  site: SubclassSite
}

export interface TypeHierarchySummary {
  files_scanned: number
  too_large: number
  binary: number
  syntax_error: number
  bases: number
  bases_resolved: number
  bases_ambiguous: number
  bases_builtin: number
  bases_unresolved: number
  bases_unsupported: number
  bases_dynamic: number
  bases_not_a_class: number
  keyword_arguments: number
  subclasses: number
  subclasses_ambiguous: number
  subclass_unsupported: number
  non_base_references: number
}

export interface TypeHierarchyResult {
  status: TypeHierarchyStatus
  /** null unless scanned */
  target: DefinitionLocation | null
  /** server order, duplicates kept; empty unless scanned */
  bases: BaseEntry[]
  /** null unless scanned */
  subclasses_status: SubclassesStatus | null
  /** server order; null unless subclasses were searched */
  subclasses: SubclassEntry[] | null
  summary: TypeHierarchySummary
  bases_truncated: boolean
  /** null exactly when subclasses is null */
  subclasses_truncated: boolean | null
}

/** Step 53 method-overrides outcome; every status except 'scanned' describes the target file. */
export type MethodOverridesStatus =
  | 'scanned'
  | 'not_a_definition'
  | 'not_a_method'
  | 'syntax_error'
  | 'too_large'
  | 'binary'
  | 'unsupported_language'

/** 'unsupported_target': the method's class is nested in a class; its subclasses are not searched. */
export type OverridingStatus = 'scanned' | 'unsupported_target'

/** Whether a related class's own body defines the method (decorators are never interpreted). */
export type MemberStatus = 'defined' | 'not_defined' | 'not_a_method' | 'unsupported' | 'unavailable'

/** One direct base's class candidate, judged for the method. */
export interface OverriddenEntry {
  /** a position in the response target's file; null for a dynamic base */
  site: BaseSite | null
  base_kind: BaseKind
  /** one class candidate of the base (the JSON key is "class"); null exactly when unavailable */
  class: DefinitionLocation | null
  /** the base resolves to several definitions */
  ambiguous: boolean
  status: MemberStatus
  /** the class's same-name methods, server order (cut at 20); empty unless defined */
  implementations: DefinitionLocation[]
  /** the class defines the name more than once (counted before the cut) */
  implementations_ambiguous: boolean
}

/** One direct subclass entry whose own body binds the method's name. */
export interface OverridingEntry {
  subclass: DefinitionLocation
  /** a position in subclass.path */
  site: SubclassSite
  status: 'defined' | 'not_a_method' | 'unsupported'
  implementations: DefinitionLocation[]
  implementations_ambiguous: boolean
}

export interface MethodOverridesSummary {
  files_scanned: number
  too_large: number
  binary: number
  syntax_error: number
  bases: number
  base_classes: number
  overridden_defined: number
  overridden_not_defined: number
  overridden_not_a_method: number
  overridden_unavailable: number
  overridden_unsupported: number
  subclasses: number
  overriding: number
  /** subclass entries not binding the name: counted, never listed */
  inheriting: number
  overriding_not_a_method: number
  overriding_unsupported: number
}

export interface MethodOverridesResult {
  status: MethodOverridesStatus
  /** the method; null unless scanned */
  target: DefinitionLocation | null
  /** the method's class; null unless scanned */
  owner: DefinitionLocation | null
  /** server order (base order, then candidate order); empty unless scanned */
  overridden: OverriddenEntry[]
  /** null unless scanned */
  overriding_status: OverridingStatus | null
  /** server order with duplicates; null unless subclasses were searched */
  overriding: OverridingEntry[] | null
  summary: MethodOverridesSummary
  overridden_truncated: boolean
  /** null exactly when overriding is null */
  overriding_truncated: boolean | null
}

/**
 * Step 55: one identifier load of a Python file with no statically known binding, as found by
 * the server. Not a runtime error: names defined dynamically (exec, globals()) are listed,
 * names that may come from a star import are only counted.
 */
export interface UnboundName {
  /** 1-based */
  line: number
  /** 1-based code-point column of the identifier (shown, never used for navigation) */
  column: number
  /** the identifier as Python sees it (NFKC); untrusted text */
  name: string
}

/** The server's counts, taken before its 500-result cap (authoritative, never recounted). */
export interface UnboundNamesSummary {
  unbound: number
  distinct: number
  /** would-be-unbound loads in a module with a star import (never listed) */
  unsupported: number
  /** loads of interpreter-provided names such as __file__ (never listed) */
  implicit: number
}

export interface UnboundNamesResult {
  path: string
  status: OutlineStatus
  /** source order, every occurrence; empty unless status is 'parsed' */
  names: UnboundName[]
  summary: UnboundNamesSummary
  truncated: boolean
}

/** Step 58 name-occurrences outcome for one position of a Python file. */
export type OccurrencesStatus =
  | 'found'
  | 'not_bound'
  | 'unsupported'
  | 'no_identifier'
  | 'syntax_error'
  | 'too_large'
  | 'binary'
  | 'unsupported_language'

export type OccurrenceKind = 'read' | 'write' | 'delete' | 'parameter' | 'definition'

/** The scope that holds the binding (Step 45's scope kinds). */
export type OccurrenceScope = 'module' | 'function' | 'class' | 'lambda' | 'comprehension'

/** One occurrence of the binding, in the reference's file. */
export interface Occurrence {
  /** 1-based */
  line: number
  /** 1-based code-point column of the identifier's first character */
  column: number
  kind: OccurrenceKind
}

/** The server's counts, taken before its 1,000-occurrence cap (authoritative, never recounted). */
export interface OccurrencesSummary {
  occurrences: number
  reads: number
  writes: number
  deletes: number
  /** parameter and definition sites */
  bindings: number
}

export interface CodeOccurrencesResult {
  status: OccurrencesStatus
  /** null unless an identifier was found */
  reference: DefinitionReference | null
  /** null unless found */
  scope: OccurrenceScope | null
  /** source order, at most 1,000; empty unless found */
  occurrences: Occurrence[]
  summary: OccurrencesSummary
  truncated: boolean
}

/**
 * Step 60: one assignment to a def/async def local variable that nothing in the file reads, as
 * found by the server (variable-level "never read anywhere", not a data-flow analysis).
 */
export interface UnusedVariable {
  /** 1-based */
  line: number
  /** 1-based code-point column of the assigned name (shown, never used for navigation) */
  column: number
  /** the identifier as Python sees it (NFKC); untrusted text */
  name: string
}

/** The server's counts, taken before its 500-entry cap (authoritative, never recounted). */
export interface UnusedVariablesSummary {
  /** listed assignments */
  unused: number
  /** distinct listed variables: (function scope, name) */
  distinct: number
  /** never-read variables of dynamic functions or named in string annotations (never listed) */
  unsupported: number
}

export interface UnusedVariablesResult {
  path: string
  status: OutlineStatus
  /** source order, every assignment, at most 500; empty unless status is 'parsed' */
  variables: UnusedVariable[]
  summary: UnusedVariablesSummary
  truncated: boolean
}

/**
 * Step 62: one import whose bound name nothing in the file reads, as found by the server (an
 * import kept only for its side effects is listed too).
 */
export interface UnusedImport {
  /** 1-based */
  line: number
  /** 1-based code-point column of the bound name (shown, never used for navigation) */
  column: number
  /** the bound name as Python sees it (NFKC); untrusted text */
  name: string
}

/** The server's counts, taken before its 500-entry cap (authoritative, never recounted). */
export interface UnusedImportsSummary {
  /** listed imports */
  unused: number
  /** distinct listed bindings: (scope, name) */
  distinct: number
  /** never-read imports of package/stub interfaces, dynamic code or string annotations (never listed) */
  unsupported: number
}

export interface UnusedImportsResult {
  path: string
  status: OutlineStatus
  /** source order, every import, at most 500; empty unless status is 'parsed' */
  imports: UnusedImport[]
  summary: UnusedImportsSummary
  truncated: boolean
}

/**
 * Step 66: one def, async def or class statement that a later one of the same name, in the same
 * block, replaces before anything in the file could read it, as found by the server.
 */
export interface ReplacedDefinition {
  /** 1-based line of the replaced statement's name */
  line: number
  /** 1-based code-point column of that name */
  column: number
  /** the name as Python sees it (NFKC); untrusted text */
  name: string
  kind: 'class' | 'function' | 'method'
  /** 1-based line of the replacing statement's name */
  replaced_line: number
  /** 1-based code-point column of that name */
  replaced_column: number
}

/** The server's counts, taken before its 500-entry cap (authoritative, never recounted). */
export interface ReplacedDefinitionsSummary {
  /** listed statements */
  replaced: number
  /** distinct listed bindings: (scope, name) */
  distinct: number
  /** never-read replaced statements that decorators, class creation or dynamic access may keep (never listed) */
  unsupported: number
}

export interface ReplacedDefinitionsResult {
  path: string
  status: OutlineStatus
  /** source order, at most 500; empty unless status is 'parsed' */
  definitions: ReplacedDefinition[]
  summary: ReplacedDefinitionsSummary
  truncated: boolean
}

/**
 * Step 69: statements of one Python file that can never run because an earlier statement of the
 * same block always leaves it, as found by the server.
 */
export interface UnreachableRegion {
  /** 1-based line where the region's first statement starts (its first decorator's, if any) */
  line: number
  /** 1-based last line of the region's last statement */
  end_line: number
  /** statements in the region, counted in its own block (nested ones excluded) */
  statements: number
  /** the statement that always leaves the block: an if whose every branch leaves, or an endless while loop */
  cause: 'return' | 'raise' | 'break' | 'continue' | 'if' | 'while'
  /** 1-based line where that statement starts */
  cause_line: number
}

/** The server's counts, taken before its 500-region cap (authoritative, never recounted). */
export interface UnreachableCodeSummary {
  regions: number
  statements: number
}

export interface UnreachableCodeResult {
  path: string
  status: OutlineStatus
  /** source order, at most 500; empty unless status is 'parsed' */
  regions: UnreachableRegion[]
  summary: UnreachableCodeSummary
  truncated: boolean
}

// --- Full analysis runs (phase 1 of the repository intelligence pipeline) ---------------

export interface LanguageBreakdown {
  language: string | null
  files: number
  lines: number
  code_lines: number
  bytes: number
}

/** One completed full analysis of a repository snapshot. */
export interface AnalysisRun {
  id: string
  analysis_job_id: string
  repository_id: string
  project_id: string
  file_count: number
  analyzed_file_count: number
  /** files in excluded directories such as node_modules/ or dist/ */
  excluded_file_count: number
  total_bytes: number
  total_lines: number
  /** non-blank lines */
  code_lines: number
  languages: LanguageBreakdown[]
  skipped: { binary: number; too_large: number; unavailable: number; generated: number }
  /** code-quality results; null for runs stored before code-quality analysis existed */
  quality: QualitySummary | null
  /** security results; null for runs stored before security analysis existed */
  security: SecuritySummary | null
  /** complexity results; null for runs stored before complexity analysis existed */
  complexity: ComplexitySummary | null
  /** dependency results; null for runs stored before dependency analysis existed */
  dependencies: DependencyAnalysisSummary | null
  /** architecture summary; null for runs stored before architecture analysis existed */
  architecture: ArchitectureSummary | null
  /** the AI chat's index; null for runs stored before the chat existed */
  chat_index: ChatIndex | null
  created_at: string
}

export interface AnalysisRunList {
  /** the latest full-analysis job, any status */
  job: AnalysisJob | null
  /** completed runs, newest first */
  runs: AnalysisRun[]
}

export interface AnalysisRunJob {
  job_id: string
  repository_id: string
  status: AnalysisJobStatus
}

export interface RecentRun {
  run_id: string
  project_id: string
  project_name: string
  repository_id: string
  repository_name: string
  created_at: string
  file_count: number
  code_lines: number
  top_language: string | null
}

/** Totals across the user's projects; code size and languages from each repository's latest run. */
export interface DashboardSummary {
  projects: number
  repositories: number
  ready_repositories: number
  analyzed_repositories: number
  total_runs: number
  active_jobs: number
  analyzed_files: number
  code_lines: number
  languages: LanguageBreakdown[]
  recent_runs: RecentRun[]
}

// --- Code quality (phase 2) ----------------------------------------------------------------

export type IssueSeverity = 'high' | 'medium' | 'low' | 'info'
export type IssueCategory =
  | 'syntax_error'
  | 'bug_risk'
  | 'unused_code'
  | 'dead_code'
  | 'duplication'
  | 'naming'
  | 'documentation'
  | 'formatting'
  | 'maintainability'

export interface QualitySummary {
  files_analyzed: number
  python_files: number
  /** Ruff's status: completed, skipped (no Python files), timeout, unavailable, failed, too_large */
  ruff: string
  /** every finding */
  issues: number
  /** the most severe findings, stored and listed */
  stored_issues: number
  by_severity: Record<IssueSeverity, number>
  by_category: Record<IssueCategory, number>
  duplication: {
    percent: number
    duplicated_lines: number
    significant_lines: number
    files: number
    blocks: number
    partial: boolean
  }
  top_files: ({ path: string; issues: number } & Record<IssueSeverity, number>)[]
  top_rules: { rule_id: string; count: number; category: IssueCategory; severity: IssueSeverity }[]
}

export interface CodeIssue {
  id: string
  path: string
  line: number
  column: number | null
  end_line: number
  /** "ruff" or "codebase-analysis" */
  tool: string
  rule_id: string
  category: IssueCategory
  severity: IssueSeverity
  message: string
  explanation: string
  suggestion: string
  doc_url: string | null
}

export interface CodeIssueList {
  items: CodeIssue[]
  total: number
  page: number
  page_size: number
}

export interface IssueFilters {
  severity?: IssueSeverity
  category?: IssueCategory
  path?: string
  q?: string
  page?: number
}

export interface RepositoryQuality {
  project_id: string
  project_name: string
  repository_id: string
  repository_name: string
  run_id: string
  created_at: string
  analyzed_file_count: number
  code_lines: number
  quality: QualitySummary
}

export interface QualityOverview {
  repositories: RepositoryQuality[]
}

// --- Security (phase 3) ----------------------------------------------------------------------

export type SecuritySeverity = 'critical' | 'high' | 'medium' | 'low'
/** confirmed: the insecure code is definitely present; potential: a pattern that needs review */
export type FindingConfidence = 'confirmed' | 'potential'
export type OwaspCategory = 'A01' | 'A02' | 'A03' | 'A04' | 'A05' | 'A06' | 'A07' | 'A08' | 'A09' | 'A10'

export interface SecuritySummary {
  files_scanned: number
  python_files: number
  /** Bandit's status: completed, skipped (no Python files), timeout, unavailable, failed, too_large */
  bandit: string
  /** every finding */
  findings: number
  /** the most severe findings, stored and listed */
  stored_findings: number
  by_severity: Record<SecuritySeverity, number>
  by_confidence: Record<FindingConfidence, number>
  /** by severity, then confidence; absent in runs stored before the health score */
  by_severity_confidence?: Record<SecuritySeverity, Record<FindingConfidence, number>>
  by_owasp: Record<OwaspCategory, number>
  top_files: ({ path: string; findings: number } & Record<SecuritySeverity, number>)[]
  top_rules: { rule_id: string; count: number; title: string; severity: SecuritySeverity }[]
}

export interface SecurityFinding {
  id: string
  path: string
  line: number
  end_line: number
  /** "bandit" or "codebase-analysis" */
  tool: string
  rule_id: string
  title: string
  owasp: OwaspCategory
  cwe: number | null
  severity: SecuritySeverity
  confidence: FindingConfidence
  message: string
  explanation: string
  recommendation: string
  doc_url: string | null
}

export interface SecurityFindingList {
  items: SecurityFinding[]
  total: number
  page: number
  page_size: number
}

export interface FindingFilters {
  severity?: SecuritySeverity
  confidence?: FindingConfidence
  owasp?: OwaspCategory
  path?: string
  q?: string
  page?: number
}

export interface RepositorySecurity {
  project_id: string
  project_name: string
  repository_id: string
  repository_name: string
  run_id: string
  created_at: string
  analyzed_file_count: number
  security: SecuritySummary
}

export interface SecurityOverview {
  repositories: RepositorySecurity[]
}

// --- Complexity (phase 4) ----------------------------------------------------------------------

/** cyclomatic complexity: 1-10 low, 11-20 medium, 21+ high */
export type ComplexityRank = 'low' | 'medium' | 'high'
/** maintainability index: 20+ good, 10-19 moderate, below 10 poor */
export type MaintainabilityLevel = 'good' | 'moderate' | 'poor'
export type ComplexityFileSort = 'complexity' | 'maintainability' | 'size' | 'path'

export interface ComplexitySummary {
  files_measured: number
  files_skipped: { too_large: number; unparsable: number }
  languages: { language: string; files: number }[]
  /** lines of code without comments and blanks */
  nloc: number
  functions: number
  classes: number
  total_cyclomatic: number
  average_cyclomatic: number
  max_cyclomatic: number
  functions_by_rank: Record<ComplexityRank, number>
  files_by_rank: Record<ComplexityRank, number>
  /** mean over files, 0-100; null when no file has code */
  maintainability_index: number | null
  maintainability: MaintainabilityLevel | null
  files_by_maintainability: Record<MaintainabilityLevel, number>
  /** files whose index was estimated from Lizard's tokens (not Python) */
  mi_estimated_files: number
  stored_files: number
  stored_functions: number
  top_functions: { path: string; name: string; line: number; cyclomatic: number; nloc: number; rank: ComplexityRank }[]
}

export interface ComplexityFile {
  id: string
  path: string
  language: string
  nloc: number
  functions: number
  classes: number
  total_cyclomatic: number
  max_cyclomatic: number
  average_cyclomatic: number
  rank: ComplexityRank
  maintainability_index: number | null
  maintainability: MaintainabilityLevel | null
  mi_estimated: boolean
}

export interface ComplexityFunction {
  id: string
  path: string
  name: string
  line: number
  end_line: number
  cyclomatic: number
  nloc: number
  parameters: number
  rank: ComplexityRank
}

export interface ComplexityFileList {
  items: ComplexityFile[]
  total: number
  page: number
  page_size: number
}

export interface ComplexityFunctionList {
  items: ComplexityFunction[]
  total: number
  page: number
  page_size: number
}

export interface ComplexityFileFilters {
  rank?: ComplexityRank
  maintainability?: MaintainabilityLevel
  q?: string
  sort?: ComplexityFileSort
  page?: number
}

export interface ComplexityFunctionFilters {
  rank?: ComplexityRank
  path?: string
  q?: string
  page?: number
}

export interface RepositoryComplexity {
  project_id: string
  project_name: string
  repository_id: string
  repository_name: string
  run_id: string
  created_at: string
  analyzed_file_count: number
  code_lines: number
  complexity: ComplexitySummary
}

export interface ComplexityOverview {
  repositories: RepositoryComplexity[]
}

// --- Dependencies (phase 5) ------------------------------------------------------------------

export type DependencyEcosystem = 'npm' | 'python'
/** pinned: one exact version; minimum: the lowest version a range allows; none: no version */
export type VersionSource = 'pinned' | 'minimum' | 'none'
export type DependencyUpdate = 'up_to_date' | 'patch' | 'minor' | 'major' | 'unknown'
export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown'
export type DependencyScopeFilter = 'runtime' | 'dev' | 'other'
export type DependencySort = 'risk' | 'name' | 'update'
export type LookupStatus = 'completed' | 'partial' | 'failed' | 'disabled' | 'skipped'

export interface DependencyVulnerability {
  id: string
  aliases: string[]
  summary: string
  severity: VulnerabilitySeverity
  /** CVSS v3 base score, when published */
  score: number | null
  /** the lowest fixed version newer than the checked one */
  fixed_in: string | null
  cwe: number | null
  url: string
}

export interface DependencyRecord {
  id: string
  manifest: string
  ecosystem: DependencyEcosystem
  name: string
  specifier: string
  scope: string
  line: number | null
  version: string | null
  version_source: VersionSource
  latest_version: string | null
  update: DependencyUpdate
  vulnerability_count: number
  max_severity: VulnerabilitySeverity | null
  vulnerabilities: DependencyVulnerability[]
  conflict: boolean
}

export interface DependencyRecordList {
  items: DependencyRecord[]
  total: number
  page: number
  page_size: number
}

export interface DependencyAnalysisSummary {
  manifests: { total: number; parsed: number; invalid: number; unreadable: number }
  dependencies: number
  truncated: boolean
  by_ecosystem: Record<DependencyEcosystem, number>
  by_scope: Record<DependencyScopeFilter, number>
  by_version_source: Record<VersionSource, number>
  updates: Record<DependencyUpdate, number>
  vulnerable_dependencies: number
  /** vulnerable declarations by their worst vulnerability; absent in older runs */
  vulnerable_by_max_severity?: Record<VulnerabilitySeverity, number>
  vulnerabilities: number
  by_severity: Record<VulnerabilitySeverity, number>
  conflicts: { ecosystem: DependencyEcosystem; name: string; declarations: { manifest: string; specifier: string }[] }[]
  /** registry: latest versions (PyPI, npm); osv: vulnerabilities (OSV.dev) */
  lookups: { registry: LookupStatus; osv: LookupStatus; checked_at: string | null }
}

export interface DependencyFilters {
  ecosystem?: DependencyEcosystem
  scope?: DependencyScopeFilter
  update?: DependencyUpdate
  vulnerable?: boolean
  conflict?: boolean
  q?: string
  sort?: DependencySort
  page?: number
}

export interface RepositoryDependencies {
  project_id: string
  project_name: string
  repository_id: string
  repository_name: string
  run_id: string
  created_at: string
  analyzed_file_count: number
  code_lines: number
  dependencies: DependencyAnalysisSummary
}

export interface DependencyOverview {
  repositories: RepositoryDependencies[]
}

// --- Architecture (phase 6) --------------------------------------------------------------------

export type ComponentRole = 'ui' | 'api' | 'auth' | 'worker' | 'core' | 'data' | 'config' | 'test'

export interface EvidenceItem {
  path: string
  line: number
  detail: string
}

export interface ArchitectureComponent {
  /** the component's directory; "(root)" for files at the repository root */
  id: string
  files: number
  code_lines: number
  languages: string[]
  /** places the component in the diagram */
  role: ComponentRole
  roles: ComponentRole[]
  evidence: Partial<Record<ComponentRole, EvidenceItem[]>>
  depends_on: number
  used_by: number
}

export interface ArchitectureEdge {
  source: string
  target: string
  imports: number
  examples: EvidenceItem[]
}

export interface ArchitectureDocument {
  depth: number
  components: ArchitectureComponent[]
  edges: ArchitectureEdge[]
  cycles: string[][]
  technologies: { name: string; category: string; ecosystem: string; evidence: EvidenceItem[] }[]
  data_stores: { name: string; evidence: EvidenceItem[] }[]
  routes: { method: string; path: string; file: string; line: number; framework: string }[]
  entry_points: { kind: string; path: string; line: number; detail: string }[]
  infrastructure: { kind: string; path: string; line: number; detail: string }[]
  services: { name: string; file: string; image: string | null; build: boolean; ports: string[]; depends_on: string[]; data_store: string | null }[]
  observations: { title: string; detail: string; evidence: EvidenceItem[] }[]
  truncated: { edges: boolean; routes: boolean; entry_points: boolean; infrastructure: boolean }
}

export interface ArchitectureSummary {
  source_files: number
  components: number
  edges: number
  imports: number
  routes: number
  entry_points: number
  technologies: string[]
  data_stores: string[]
  infrastructure: number
  services: number
  cycles: number
  observations: number
  /** absent in runs stored before the health score */
  has_tests?: boolean
  has_ci?: boolean
  separated?: boolean
}

export interface ArchitectureReport {
  run_id: string
  created_at: string
  document: ArchitectureDocument
}

export interface RepositoryArchitecture {
  project_id: string
  project_name: string
  repository_id: string
  repository_name: string
  run_id: string
  created_at: string
  analyzed_file_count: number
  code_lines: number
  architecture: ArchitectureSummary
}

export interface ArchitectureOverview {
  repositories: RepositoryArchitecture[]
}

// --- Code Health Score -------------------------------------------------------------------------

export type HealthDimensionKey =
  | 'security'
  | 'quality'
  | 'complexity'
  | 'maintainability'
  | 'dependencies'
  | 'architecture'

/** Relative weight of each dimension (0-100; at least one above 0). */
export type HealthWeights = Record<HealthDimensionKey, number>

export interface HealthWeightsResponse {
  weights: HealthWeights
  /** the documented default weights are in use */
  defaults: boolean
}

export interface HealthDimension {
  key: HealthDimensionKey
  name: string
  /** null: not applicable to this run, left out of the overall score */
  score: number | null
  weight: number
  /** the numbers the score was computed from */
  inputs: Record<string, unknown>
  /** how the score was reached */
  explanation: string
  /** what would raise the score */
  improvements: string[]
}

export interface HealthReport {
  run_id: string
  created_at: string
  overall: number | null
  grade: string | null
  weights: HealthWeights
  dimensions: HealthDimension[]
}

export interface HealthPoint {
  run_id: string
  created_at: string
  overall: number | null
  grade: string | null
  scores: Record<HealthDimensionKey, number | null>
}

export interface HealthHistory {
  /** oldest first */
  points: HealthPoint[]
}

export interface RepositoryHealth extends HealthPoint {
  project_id: string
  project_name: string
  repository_id: string
  repository_name: string
}

export interface HealthOverview {
  weights: HealthWeights
  repositories: RepositoryHealth[]
}

// --- AI codebase chat --------------------------------------------------------------------------

export interface ChatIndex {
  chunks: number
  files: number
  /** secrets masked before anything was stored or sent to the AI provider */
  masked_secrets: number
  /** the chunk limit was reached; later files are not searched */
  truncated: boolean
}

export interface ChatStatus {
  /** an AI provider key is set on the server */
  configured: boolean
}

export interface ChatCitation {
  /** the number used in the answer, as [n] */
  n: number
  path: string
  start_line: number
  end_line: number
  symbol: string | null
}

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: ChatCitation[]
  created_at: string
}

export interface ChatConversationSummary {
  id: string
  project_id: string
  repository_id: string
  run_id: string
  /** the analysis the conversation is about */
  run_created_at: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
}

export interface ChatConversationList {
  /** most recently updated first */
  conversations: ChatConversationSummary[]
}

export interface ChatConversation extends ChatConversationSummary {
  /** oldest first */
  messages: ChatTurn[]
}

export interface ChatExchange {
  conversation: ChatConversationSummary
  /** the question and its answer */
  messages: ChatTurn[]
}

export interface ChatRepository {
  project_id: string
  project_name: string
  repository_id: string
  repository_name: string
  run_id: string
  created_at: string
  chunks: number
  files: number
}

export interface RecentConversation extends ChatConversationSummary {
  repository_name: string
}

export interface ChatOverview {
  configured: boolean
  repositories: ChatRepository[]
  conversations: RecentConversation[]
}
