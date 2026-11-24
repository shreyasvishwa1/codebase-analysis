import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ROUTER_FUTURE } from '../routerFuture'
import { describe, expect, it } from 'vitest'

import { AuthProvider } from '../hooks/useAuth'
import { setToken } from '../services/session'
import { mockApi, USER } from '../test/mockApi'
import { createTestQueryClient } from '../test/render'
import { LoginPage, safeReturnPath } from './LoginPage'

describe('Return path after sign-in', () => {
  it.each(['/projects', '/projects/p1/repositories/r1?tab=security#line-4', '/overview'])(
    'keeps a path on this site: %s',
    (path) => expect(safeReturnPath(path)).toBe(path),
  )

  it.each([
    ['//evil.example/phish'],
    ['/\\evil.example'],
    ['\\\\evil.example'],
    ['https://evil.example'],
    ['javascript:alert(1)'],
    ['/projects\\..\\x'],
    ['/a\u0000b'],
    ['/a\nb'],
    [''],
    [undefined],
    [42],
  ])('falls back to the projects for %j', (value) => {
    expect(safeReturnPath(value)).toBe('/projects')
  })

  it('never follows a hostile return path, even for a signed-in user', async () => {
    setToken('test-token')
    mockApi({ 'GET /auth/me': { status: 200, data: USER } })
    function Where() {
      return <output data-testid="where">{useLocation().pathname}</output>
    }
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter future={ROUTER_FUTURE} initialEntries={[{ pathname: '/login', state: { from: '//evil.example/phish' } }]}>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="*" element={<Where />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/projects'))
  })
})
