import type { UsabilityMine, UsabilityResults } from '../types/api'
import { apiClient } from './client'

/** The questionnaire's statements and the signed-in account's own answers. */
export async function getMyUsability(): Promise<UsabilityMine> {
  const { data } = await apiClient.get<UsabilityMine>('/usability/me')
  return data
}

/** Save the account's ten answers (replacing earlier ones). */
export async function saveMyUsability(answers: number[]): Promise<UsabilityMine> {
  const { data } = await apiClient.put<UsabilityMine>('/usability/me', { answers })
  return data
}

/** Every account's answers, summarized anonymously. */
export async function getUsabilityResults(): Promise<UsabilityResults> {
  const { data } = await apiClient.get<UsabilityResults>('/usability/results')
  return data
}

/** The anonymous answers as CSV. */
export async function downloadUsabilityCsv(): Promise<Blob> {
  const { data } = await apiClient.get<Blob>('/usability/results.csv', { responseType: 'blob' })
  return data
}
