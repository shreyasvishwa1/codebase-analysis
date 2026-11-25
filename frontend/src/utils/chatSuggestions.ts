import type { AnalysisRun } from '../types/api'

/** How many questions are suggested. */
export const SUGGESTION_COUNT = 4

/** Asked of any repository; they fill the list when the analysis has less to point at. */
export const GENERAL_SUGGESTIONS = [
  'What does this project do, and how is it structured?',
  'What are the most serious security findings, and how do I fix them?',
  'Which functions are the most complex, and why?',
  'How is authentication handled?',
]

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/**
 * Questions about what this repository's analysis actually found: the file with the most
 * critical and high security findings, the most complex function, vulnerable dependencies,
 * dependency cycles, the API routes. The overview question comes first; general questions fill
 * the rest. Names come from the stored analysis, never from guesses.
 */
export function chatSuggestions(run: AnalysisRun | undefined): string[] {
  const specific: string[] = []
  const security = run?.security
  if (security) {
    const worst = [...security.top_files]
      .map((file) => ({ path: file.path, severe: (file.critical ?? 0) + (file.high ?? 0) }))
      .filter((file) => file.severe > 0)
      .sort((a, b) => b.severe - a.severe)[0]
    if (worst) specific.push(`What should I fix first in ${worst.path}, and how?`)
  }
  const complex = run?.complexity?.top_functions.find((fn) => fn.rank === 'high' || fn.rank === 'medium')
  if (complex) specific.push(`Why is ${complex.name} in ${basename(complex.path)} so complex, and how could it be simpler?`)
  if (run?.dependencies && run.dependencies.vulnerable_dependencies > 0) {
    specific.push('Which dependencies have known vulnerabilities, and which versions fix them?')
  }
  const architecture = run?.architecture
  if (architecture && architecture.cycles > 0) {
    specific.push('Which components depend on each other in a cycle, and how could I break it?')
  } else if (architecture && architecture.routes > 0) {
    specific.push('What API routes does this project expose, and what does each one do?')
  }
  const questions = [GENERAL_SUGGESTIONS[0], ...specific]
  return [...questions, ...GENERAL_SUGGESTIONS.slice(1)].slice(0, SUGGESTION_COUNT)
}
