import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  askQuestion,
  deleteConversation,
  getChatOverview,
  getChatStatus,
  getConversation,
  listConversations,
  startConversation,
} from '../services/chat'
import type { ChatConversation } from '../types/api'
import { queryKeys } from './queryKeys'

export function useChatStatus() {
  return useQuery({ queryKey: queryKeys.chatStatus, queryFn: getChatStatus })
}

export function useChatOverview() {
  return useQuery({ queryKey: queryKeys.chatOverview, queryFn: getChatOverview })
}

export function useConversations(projectId: string, repositoryId: string) {
  return useQuery({
    queryKey: queryKeys.conversations(projectId, repositoryId),
    queryFn: () => listConversations(projectId, repositoryId),
  })
}

export function useConversation(projectId: string, repositoryId: string, conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.conversation(projectId, repositoryId, conversationId ?? ''),
    queryFn: () => getConversation(projectId, repositoryId, conversationId ?? ''),
    enabled: conversationId !== null,
  })
}

/** The first question of a new conversation; the answered conversation goes into the cache. */
export function useStartConversation(projectId: string, repositoryId: string, onText?: (text: string) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (question: string) => startConversation(projectId, repositoryId, question, onText),
    onSuccess: (conversation) => {
      queryClient.setQueryData(queryKeys.conversation(projectId, repositoryId, conversation.id), conversation)
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(projectId, repositoryId), exact: true })
    },
  })
}

/** A follow-up question; the question and answer are appended to the cached conversation. */
export function useAskQuestion(projectId: string, repositoryId: string, conversationId: string, onText?: (text: string) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (question: string) => askQuestion(projectId, repositoryId, conversationId, question, onText),
    onSuccess: (exchange) => {
      queryClient.setQueryData<ChatConversation>(
        queryKeys.conversation(projectId, repositoryId, conversationId),
        (current) => current && { ...current, ...exchange.conversation, messages: [...current.messages, ...exchange.messages] },
      )
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(projectId, repositoryId), exact: true })
    },
  })
}

export function useDeleteConversation(projectId: string, repositoryId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (conversationId: string) => deleteConversation(projectId, repositoryId, conversationId),
    onSuccess: (_, conversationId) => {
      queryClient.removeQueries({ queryKey: queryKeys.conversation(projectId, repositoryId, conversationId), exact: true })
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversations(projectId, repositoryId), exact: true })
    },
  })
}
