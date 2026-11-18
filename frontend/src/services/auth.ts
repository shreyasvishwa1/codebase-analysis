import type { AccountSummary, TokenResponse, User } from '../types/api'
import { apiClient } from './client'

export async function register(email: string, password: string): Promise<User> {
  const { data } = await apiClient.post<User>('/auth/register', { email, password })
  return data
}

export async function login(email: string, password: string): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>('/auth/login', { email, password })
  return data
}

/** Asks for a reset email; the answer is the same whether or not the account exists. */
export async function requestPasswordReset(email: string): Promise<string> {
  const { data } = await apiClient.post<{ detail: string }>('/auth/password-reset/request', { email })
  return data.detail
}

export async function confirmPasswordReset(token: string, password: string): Promise<string> {
  const { data } = await apiClient.post<{ detail: string }>('/auth/password-reset/confirm', {
    token,
    password,
  })
  return data.detail
}

export async function getCurrentUser(): Promise<User> {
  const { data } = await apiClient.get<User>('/auth/me')
  return data
}

/** Set or remove (null or blank) the display name. */
export async function updateProfile(displayName: string | null): Promise<User> {
  const { data } = await apiClient.patch<User>('/auth/me', { display_name: displayName })
  return data
}

/** Change the password; every other session ends, and the new token keeps this one. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>('/auth/change-password', {
    current_password: currentPassword,
    new_password: newPassword,
  })
  return data
}

/** Permanently delete the account and everything in it. */
export async function deleteAccount(password: string): Promise<void> {
  await apiClient.delete('/auth/me', { data: { password } })
}

export async function getAccountSummary(): Promise<AccountSummary> {
  const { data } = await apiClient.get<AccountSummary>('/auth/me/summary')
  return data
}
