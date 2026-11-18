import { lazy, type ComponentType } from 'react'

type Module = Record<string, unknown>

/**
 * Every signed-in page lives in its own file, loaded on first use. The same loaders are used
 * to fetch a page's file before it is opened: all of them once the browser is idle, and one
 * when its menu link is hovered. A loader that already ran returns its cached module.
 */
const LOADERS = {
  OverviewPage: () => import('../pages/OverviewPage'),
  UploadPage: () => import('../pages/UploadPage'),
  CodeAnalysisPage: () => import('../pages/CodeAnalysisPage'),
  SecurityPage: () => import('../pages/SecurityPage'),
  ComplexityPage: () => import('../pages/ComplexityPage'),
  DependenciesPage: () => import('../pages/DependenciesPage'),
  ArchitecturePage: () => import('../pages/ArchitecturePage'),
  HealthPage: () => import('../pages/HealthPage'),
  ChatPage: () => import('../pages/ChatPage'),
  HistoryPage: () => import('../pages/HistoryPage'),
  SettingsPage: () => import('../pages/SettingsPage'),
  ProjectsPage: () => import('../pages/ProjectsPage'),
  ProjectPage: () => import('../pages/ProjectPage'),
  RepositoryPage: () => import('../pages/RepositoryPage'),
  RepositoryAnalysisPage: () => import('../pages/RepositoryAnalysisPage'),
  RepositoryCodeAnalysisPage: () => import('../pages/RepositoryCodeAnalysisPage'),
  RepositorySecurityPage: () => import('../pages/RepositorySecurityPage'),
  RepositoryComplexityPage: () => import('../pages/RepositoryComplexityPage'),
  RepositoryDependenciesPage: () => import('../pages/RepositoryDependenciesPage'),
  RepositoryArchitecturePage: () => import('../pages/RepositoryArchitecturePage'),
  RepositoryHealthPage: () => import('../pages/RepositoryHealthPage'),
  RepositoryChatPage: () => import('../pages/RepositoryChatPage'),
  RepositoryHistoryPage: () => import('../pages/RepositoryHistoryPage'),
} satisfies Record<string, () => Promise<Module>>

export type PageName = keyof typeof LOADERS

export const PAGE_NAMES = Object.keys(LOADERS) as PageName[]

/** The lazily loaded component for a page (each module exports it under the page's name). */
function lazyPage(name: PageName) {
  return lazy(async () => {
    const module: Module = await LOADERS[name]()
    return { default: module[name] as ComponentType }
  })
}

export const Pages = Object.fromEntries(PAGE_NAMES.map((name) => [name, lazyPage(name)])) as Record<
  PageName,
  ReturnType<typeof lazyPage>
>

/** The page each main menu path opens. */
export const PATH_PAGES: Record<string, PageName> = {
  '/overview': 'OverviewPage',
  '/projects': 'ProjectsPage',
  '/upload': 'UploadPage',
  '/code-analysis': 'CodeAnalysisPage',
  '/security': 'SecurityPage',
  '/complexity': 'ComplexityPage',
  '/dependencies': 'DependenciesPage',
  '/architecture': 'ArchitecturePage',
  '/health-score': 'HealthPage',
  '/chat': 'ChatPage',
  '/history': 'HistoryPage',
  '/settings': 'SettingsPage',
}

/** Fetch one page's file now. Failures are ignored; opening the page retries the load. */
export function preloadPage(name: PageName): Promise<void> {
  return LOADERS[name]().then(
    () => undefined,
    () => undefined,
  )
}

/** Fetch every page's file. */
export function preloadAllPages(): Promise<void> {
  return Promise.all(PAGE_NAMES.map(preloadPage)).then(() => undefined)
}

let scheduled = false

/** Once per visit, fetch every page's file when the browser has nothing else to do, so later
 * navigation never waits for a download. */
export function preloadPagesWhenIdle(): void {
  if (scheduled) return
  scheduled = true
  const run = () => void preloadAllPages()
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 4000 })
  } else {
    setTimeout(run, 1500)
  }
}
