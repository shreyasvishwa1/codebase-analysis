import type {
  ChatConversation,
  ChatConversationList,
  ChatExchange,
  ChatOverview,
  ChatStatus,
} from '../types/api'
import { apiClient } from './client'
import { repositoryPath } from './repositories'

const chatPath = (projectId: string, repositoryId: string) =>
  `${repositoryPath(projectId, repositoryId)}/chat/conversations`

/** Answers can take a while: the AI provider has up to a minute, with retries. */
const ANSWER_TIMEOUT_MS = 150_000

/** Whether an AI provider is configured on the server. */
export async function getChatStatus(): Promise<ChatStatus> {
  const { data } = await apiClient.get<ChatStatus>('/chat/status')
  return data
}

/** Repositories that can be chatted about and the user's recent conversations. */
export async function getChatOverview(): Promise<ChatOverview> {
  const { data } = await apiClient.get<ChatOverview>('/chat')
  return data
}

export async function listConversations(projectId: string, repositoryId: string): Promise<ChatConversationList> {
  const { data } = await apiClient.get<ChatConversationList>(chatPath(projectId, repositoryId))
  return data
}

export async function getConversation(
  projectId: string,
  repositoryId: string,
  conversationId: string,
): Promise<ChatConversation> {
  const { data } = await apiClient.get<ChatConversation>(`${chatPath(projectId, repositoryId)}/${conversationId}`)
  return data
}

/** Start a conversation with its first question; the answer comes back with it. */
export async function startConversation(
  projectId: string,
  repositoryId: string,
  question: string,
): Promise<ChatConversation> {
  const { data } = await apiClient.post<ChatConversation>(
    chatPath(projectId, repositoryId),
    { question },
    { timeout: ANSWER_TIMEOUT_MS },
  )
  return data
}

export async function askQuestion(
  projectId: string,
  repositoryId: string,
  conversationId: string,
  question: string,
): Promise<ChatExchange> {
  const { data } = await apiClient.post<ChatExchange>(
    `${chatPath(projectId, repositoryId)}/${conversationId}/messages`,
    { question },
    { timeout: ANSWER_TIMEOUT_MS },
  )
  return data
}

export async function deleteConversation(
  projectId: string,
  repositoryId: string,
  conversationId: string,
): Promise<void> {
  await apiClient.delete(`${chatPath(projectId, repositoryId)}/${conversationId}`)
}
