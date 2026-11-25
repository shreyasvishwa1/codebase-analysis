import type {
  ChatConversation,
  ChatConversationList,
  ChatExchange,
  ChatOverview,
  ChatStatus,
} from '../types/api'
import { streamAnswer } from './chatStream'
import { apiClient } from './client'
import { repositoryPath } from './repositories'

const chatPath = (projectId: string, repositoryId: string) =>
  `${repositoryPath(projectId, repositoryId)}/chat/conversations`

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

/** Start a conversation with its first question; the answer streams in (`onText`, with the
 * text so far) and the stored conversation comes back with it. */
export async function startConversation(
  projectId: string,
  repositoryId: string,
  question: string,
  onText?: (text: string) => void,
): Promise<ChatConversation> {
  return streamAnswer<ChatConversation>(`${chatPath(projectId, repositoryId)}/stream`, question, onText)
}

export async function askQuestion(
  projectId: string,
  repositoryId: string,
  conversationId: string,
  question: string,
  onText?: (text: string) => void,
): Promise<ChatExchange> {
  return streamAnswer<ChatExchange>(`${chatPath(projectId, repositoryId)}/${conversationId}/messages/stream`, question, onText)
}

export async function deleteConversation(
  projectId: string,
  repositoryId: string,
  conversationId: string,
): Promise<void> {
  await apiClient.delete(`${chatPath(projectId, repositoryId)}/${conversationId}`)
}
