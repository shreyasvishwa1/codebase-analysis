import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ROUTER_FUTURE } from '../routerFuture'
import { beforeAll, describe, expect, it } from 'vitest'

import App from '../App'
import { getToken, setToken } from '../services/session'
import { mockApi, USER } from '../test/mockApi'
import { createTestQueryClient, renderWithProviders } from '../test/render'
import { AuthProvider } from '../hooks/useAuth'
import { LoginPage } from './LoginPage'
import { preloadAllPages } from '../routes/pages'

const SUMMARY = { projects: 2, repositories: 3, analyses: 7, reports: 1, conversations: 4, latest_analysis_at: '2026-11-18T10:00:00Z' }

type Routes = Parameters<typeof mockApi>[0]

function mountSettings(routes: Routes = {}) {
  setToken('session-token')
  const requests = mockApi({
    'GET /auth/me': { status: 200, data: USER },
    'GET /health': { status: 200, data: { status: 'ok' } },
    'GET /auth/me/summary': { status: 200, data: SUMMARY },
    'GET /chat/status': { status: 200, data: { configured: false } },
    ...routes,
  })
  renderWithProviders(<App />, { route: '/settings' })
  return requests
}

const body = (requests: ReturnType<typeof mockApi>, method: string, url: string) =>
  JSON.parse(String(requests.find((r) => r.method === method && r.url === url)?.data))


// Signed-in pages load lazily; compile them once up front so navigation tests do not
// spend their waits on the test environment's on-demand compilation.
beforeAll(() => preloadAllPages(), 120_000)

describe('Settings', () => {
  it('shows the profile and saves a display name shown in the header', async () => {
    const requests = mountSettings({
      'PATCH /auth/me': (config) => ({
        status: 200,
        data: { ...USER, display_name: JSON.parse(String(config.data)).display_name },
      }),
    })
    // The file's first full-app render: allow more than the usual 3 s on a busy machine.
    const profile = within(await screen.findByRole('region', { name: 'Profile' }, { timeout: 10_000 }))
    expect(profile.getByText('alice@example.com')).toBeTruthy()
    expect(profile.getByText(new Date('2026-10-01T00:00:00Z').toLocaleString())).toBeTruthy()
    const save = profile.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(profile.getByLabelText('Display name'), { target: { value: '  Alice   Smith ' } })
    expect(profile.getByText('11 / 80')).toBeTruthy()
    fireEvent.click(save)
    expect((await screen.findByRole('link', { name: 'Account settings for Alice Smith' })).textContent).toBe('AAlice Smith')
    expect(body(requests, 'PATCH', '/auth/me')).toEqual({ display_name: 'Alice Smith' })
    const saved = within(screen.getByRole('region', { name: 'Profile' }))
    expect(saved.getByRole('status').textContent).toBe('Saved.')
    expect((saved.getByLabelText('Display name') as HTMLInputElement).value).toBe('Alice Smith')
    fireEvent.change(saved.getByLabelText('Display name'), { target: { value: '   ' } })
    fireEvent.click(saved.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('link', { name: 'Account settings for alice@example.com' })).toBeTruthy()
    const patches = requests.filter((r) => r.method === 'PATCH')
    await waitFor(() => expect(JSON.parse(String(patches[patches.length - 1]?.data))).toEqual({ display_name: null }))
  }, 15_000) // the file's first full-app render; slow while the whole suite runs

  it('refuses names that are too long', async () => {
    const requests = mountSettings()
    const profile = within(await screen.findByRole('region', { name: 'Profile' }))
    fireEvent.change(profile.getByLabelText('Display name'), { target: { value: 'x'.repeat(81) } })
    expect((profile.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    expect(profile.getByText('81 / 80').className).toContain('text-red-300')
    fireEvent.submit(profile.getByRole('form', { name: 'Change display name' }))
    expect(requests.some((r) => r.method === 'PATCH')).toBe(false)
  })

  it('summarizes the account with links', async () => {
    mountSettings()
    const data = within(await screen.findByRole('region', { name: 'Your data' }))
    await data.findByText('Projects')
    const value = (label: string) => data.getByText(label).nextElementSibling?.textContent
    expect(['Projects', 'Repositories', 'Analyses', 'PDF reports', 'Conversations'].map(value)).toEqual(['2', '3', '7', '1', '4'])
    expect(data.getByText('Analyses').closest('a')?.getAttribute('href')).toBe('/history')
    expect(data.getByText('Conversations').closest('a')?.getAttribute('href')).toBe('/chat')
    expect(data.getByText(`Latest analysis: ${new Date('2026-11-18T10:00:00Z').toLocaleString()}.`)).toBeTruthy()
  })

  it('changes the password and keeps the session with the new token', async () => {
    const requests = mountSettings({ 'POST /auth/change-password': { status: 200, data: { access_token: 'new-token', token_type: 'bearer' } } })
    const section = within(await screen.findByRole('region', { name: 'Password' }))
    const submit = section.getByRole('button', { name: 'Change password' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(section.getByLabelText('Current password'), { target: { value: 'old-password' } })
    fireEvent.change(section.getByLabelText('New password'), { target: { value: 'short' } })
    expect(section.getByRole('alert').textContent).toBe('The new password must be at least 8 characters long.')
    fireEvent.change(section.getByLabelText('New password'), { target: { value: 'old-password' } })
    expect(section.getByRole('alert').textContent).toBe('Choose a password different from the current one.')
    fireEvent.change(section.getByLabelText('New password'), { target: { value: 'brand-new-password' } })
    fireEvent.change(section.getByLabelText('Confirm the new password'), { target: { value: 'brand-new-passwor' } })
    expect(section.getByRole('alert').textContent).toBe('The new passwords do not match.')
    expect(submit.disabled).toBe(true)
    fireEvent.change(section.getByLabelText('Confirm the new password'), { target: { value: 'brand-new-password' } })
    expect(section.queryByRole('alert')).toBeNull()
    fireEvent.click(submit)
    expect((await section.findByRole('status')).textContent).toContain('Every other session was signed out')
    expect(body(requests, 'POST', '/auth/change-password')).toEqual({ current_password: 'old-password', new_password: 'brand-new-password' })
    expect(getToken()).toBe('new-token')
    expect((section.getByLabelText('Current password') as HTMLInputElement).value).toBe('')
  })

  it('reports a wrong current password', async () => {
    mountSettings({ 'POST /auth/change-password': { status: 400, data: { detail: 'The current password is incorrect' } } })
    const section = within(await screen.findByRole('region', { name: 'Password' }))
    fireEvent.change(section.getByLabelText('Current password'), { target: { value: 'wrong-password' } })
    fireEvent.change(section.getByLabelText('New password'), { target: { value: 'brand-new-password' } })
    fireEvent.change(section.getByLabelText('Confirm the new password'), { target: { value: 'brand-new-password' } })
    fireEvent.click(section.getByRole('button', { name: 'Change password' }))
    expect((await section.findByRole('alert')).textContent).toBe('The current password is incorrect')
    expect(getToken()).toBe('session-token')
  })

  it('links to the weights and shows whether the AI is available', async () => {
    mountSettings({ 'GET /chat/status': { status: 200, data: { configured: true } } })
    const preferences = within(await screen.findByRole('region', { name: 'Preferences' }))
    expect(preferences.getByRole('link', { name: 'Change the weights' }).getAttribute('href')).toBe('/health-score#weights')
    expect(await preferences.findByText('Available')).toBeTruthy()
  })

  it('deletes the account after the password and a confirmation', async () => {
    const requests = mountSettings({ 'DELETE /auth/me': { status: 204 } })
    const section = within(await screen.findByRole('region', { name: 'Delete account' }))
    expect(await screen.findByText('Not configured')).toBeTruthy()
    const button = section.getByRole('button', { name: 'Delete my account' }) as HTMLButtonElement
    fireEvent.change(section.getByLabelText('Your password'), { target: { value: 'my-password' } })
    expect(button.disabled).toBe(true) // not confirmed yet
    fireEvent.click(section.getByRole('checkbox'))
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(await screen.findByText('Your account and all its data were deleted.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy()
    expect(body(requests, 'DELETE', '/auth/me')).toEqual({ password: 'my-password' })
    expect(getToken()).toBeNull()
  })

  it('keeps the account when deletion is refused', async () => {
    mountSettings({ 'DELETE /auth/me': { status: 400, data: { detail: 'The current password is incorrect' } } })
    const section = within(await screen.findByRole('region', { name: 'Delete account' }))
    fireEvent.change(section.getByLabelText('Your password'), { target: { value: 'wrong' } })
    fireEvent.click(section.getByRole('checkbox'))
    fireEvent.click(section.getByRole('button', { name: 'Delete my account' }))
    expect((await section.findByRole('alert')).textContent).toBe('The current password is incorrect')
    expect(getToken()).toBe('session-token')
  })

  it('opens from the sidebar and the header', async () => {
    mountSettings({ 'GET /projects': { status: 200, data: [] } })
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0]
    expect(within(nav).getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
    expect((await screen.findByRole('link', { name: 'Account settings for alice@example.com' })).getAttribute('href')).toBe('/settings')
  })
})

describe('Sign-in notice', () => {
  it('shows a notice passed to the sign-in page', async () => {
    mockApi({})
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter future={ROUTER_FUTURE} initialEntries={[{ pathname: '/login', state: { notice: 'Done.' } }]}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect((await screen.findByRole('status')).textContent).toBe('Done.')
  })
})

describe('Settings errors', () => {
  it('reports a summary that cannot be loaded', async () => {
    mountSettings({ 'GET /auth/me/summary': { status: 500, data: { detail: 'Summary failed' } } })
    const data = within(await screen.findByRole('region', { name: 'Your data' }))
    await waitFor(() => expect(data.getByRole('alert').textContent).toBe('Summary failed'))
  })
})
