import type { ComponentRole } from '../types/api'

/** Shared by the architecture views: role names, the selection, and component naming. */

export const ROLE_LABELS: Record<ComponentRole, string> = {
  ui: 'User interface',
  api: 'API',
  auth: 'Authentication',
  worker: 'Background work',
  core: 'Core logic',
  data: 'Data access',
  config: 'Configuration',
  test: 'Tests',
}

export type Selection = { kind: 'component' | 'store'; id: string } | null

export function shortName(id: string): string {
  const parts = id.split('/')
  const label = parts.slice(-2).join('/')
  return label.length > 24 ? `…${label.slice(-23)}` : label
}

/** The component a file belongs to: the longest component directory containing it. */
export function componentOf(path: string, ids: string[]): string | null {
  const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  let best: string | null = null
  for (const id of ids) {
    if (id === '(root)') {
      if (directory === '' && best === null) best = id
    } else if ((directory === id || directory.startsWith(`${id}/`)) && (best === null || best === '(root)' || id.length > best.length)) {
      best = id
    }
  }
  return best
}
