import { describe, expect, it } from 'vitest'

import type { AnalysisRun } from '../types/api'
import { chatSuggestions, GENERAL_SUGGESTIONS, SUGGESTION_COUNT } from './chatSuggestions'

const file = (path: string, critical: number, high: number) => ({ path, findings: critical + high + 1, critical, high, medium: 1, low: 0 })
const fn = (name: string, path: string, rank: 'low' | 'medium' | 'high') => ({ name, path, rank, line: 1, cyclomatic: 30, nloc: 10 })

function run(parts: {
  topFiles?: ReturnType<typeof file>[]
  functions?: ReturnType<typeof fn>[]
  vulnerable?: number
  cycles?: number
  routes?: number
}): AnalysisRun {
  return {
    security: parts.topFiles ? { top_files: parts.topFiles } : null,
    complexity: parts.functions ? { top_functions: parts.functions } : null,
    dependencies: parts.vulnerable === undefined ? null : { vulnerable_dependencies: parts.vulnerable },
    architecture: parts.cycles === undefined && parts.routes === undefined ? null : { cycles: parts.cycles ?? 0, routes: parts.routes ?? 0 },
  } as unknown as AnalysisRun
}

describe('chatSuggestions', () => {
  it('asks about what the analysis found, after the overview question', () => {
    expect(
      chatSuggestions(
        run({
          topFiles: [file('web/a.js', 0, 1), file('app/db.py', 2, 3), file('app/clean.py', 0, 0)],
          functions: [fn('tiny', 'x.py', 'low'), fn('process_order', 'shop/orders.py', 'high')],
          vulnerable: 2,
          cycles: 1,
        }),
      ),
    ).toEqual([
      GENERAL_SUGGESTIONS[0],
      'What should I fix first in app/db.py, and how?',
      'Why is process_order in orders.py so complex, and how could it be simpler?',
      'Which dependencies have known vulnerabilities, and which versions fix them?',
    ])
  })

  it('counts high findings as well as critical ones', () => {
    expect(chatSuggestions(run({ topFiles: [file('a.py', 0, 0), file('web/high.js', 0, 2)] }))[1]).toBe('What should I fix first in web/high.js, and how?')
  })

  it('asks about routes when there is no cycle, and fills with general questions', () => {
    expect(chatSuggestions(run({ routes: 3, cycles: 0, functions: [fn('medium_one', 'a/b/c.py', 'medium')] }))).toEqual([
      GENERAL_SUGGESTIONS[0],
      'Why is medium_one in c.py so complex, and how could it be simpler?',
      'What API routes does this project expose, and what does each one do?',
      GENERAL_SUGGESTIONS[1],
    ])
  })

  it('leaves out what is not there: clean files, simple functions, safe dependencies', () => {
    expect(chatSuggestions(run({ topFiles: [file('a.py', 0, 0)], functions: [fn('f', 'a.py', 'low')], vulnerable: 0, cycles: 0, routes: 0 }))).toEqual(
      GENERAL_SUGGESTIONS,
    )
  })

  it('suggests the general questions without an analysis', () => {
    expect(chatSuggestions(undefined)).toEqual(GENERAL_SUGGESTIONS)
    expect(GENERAL_SUGGESTIONS).toHaveLength(SUGGESTION_COUNT)
  })

  it(`never suggests more than ${SUGGESTION_COUNT}`, () => {
    const all = chatSuggestions(run({ topFiles: [file('a.py', 1, 0)], functions: [fn('f', 'a.py', 'high')], vulnerable: 1, cycles: 2 }))
    expect(all).toHaveLength(SUGGESTION_COUNT)
    expect(all).not.toContain('Which components depend on each other in a cycle, and how could I break it?') // the fifth
  })
})
