import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

import { setUnauthorizedHandler } from '../services/session'
import { resetApiMock } from './mockApi'

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom does not provide.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver

// findBy*/waitFor wait up to 3 s (default 1 s): pages that load several requests can take
// longer than a second while the whole suite runs in parallel. A real failure still fails.
configure({ asyncUtilTimeout: 3000 })

afterEach(() => {
  cleanup()
  resetApiMock()
  setUnauthorizedHandler(null)
  window.sessionStorage.clear()
})
