import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { ROUTER_FUTURE } from '../routerFuture'
import { mockApi } from '../test/mockApi'
import { createTestQueryClient } from '../test/render'
import type { HealthDimension } from '../types/api'
import { HealthWhatIf, TOP_GAINS } from './HealthWhatIf'
import { ToastProvider } from './Toaster'

const dim = (key: HealthDimension['key'], name: string, score: number | null, weight: number): HealthDimension => ({
  key,
  name,
  score,
  weight,
  inputs: {},
  explanation: '',
  improvements: [],
})

// Saved weights 25/20/15/15/15/10; dependency health not scored. Overall now:
// (25 × 2 + 20 × 88 + 15 × 76 + 15 × 47 + 10 × 40) / 85 = 47.7 → 48.
const DIMENSIONS = [
  dim('security', 'Security', 2, 25),
  dim('quality', 'Code quality', 88, 20),
  dim('complexity', 'Complexity', 76, 15),
  dim('maintainability', 'Maintainability', 47, 15),
  dim('dependencies', 'Dependency health', null, 15),
  dim('architecture', 'Architecture', 40, 10),
]

function show(dimensions = DIMENSIONS) {
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter future={ROUTER_FUTURE}>
        <ToastProvider>
          <HealthWhatIf dimensions={dimensions} pageFor={(key) => ({ to: `/repo/${key}`, label: `${key} page` })} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return within(screen.getByRole('region', { name: 'What if' }))
}

const slider = (panel: ReturnType<typeof show>, name: string) => panel.getByLabelText(name) as HTMLInputElement
const status = (panel: ReturnType<typeof show>) => panel.getByRole('status').textContent

describe('health what-if', () => {
  it('lists the largest gains, each linking to its findings', () => {
    const panel = show()
    const items = within(panel.getByRole('list', { name: 'Largest gains' })).getAllByRole('listitem')
    expect(items).toHaveLength(TOP_GAINS)
    // Security at 100: 6505 / 85 = 76.5 → 77 (half to even: 76.53 rounds up); maintainability:
    // 4850 / 85 = 57.1 → 57; architecture: 4655 / 85 = 54.8 → 55
    expect(items.map((item) => item.querySelector('p')?.textContent)).toEqual([
      'Security 2 → 100 would make the overall 77 (B) +29',
      'Maintainability 47 → 100 would make the overall 57 (C) +9',
      'Architecture 40 → 100 would make the overall 55 (C) +7',
    ])
    expect(within(items[0]).getByRole('link').getAttribute('href')).toBe('/repo/security')
    expect(within(items[0]).getByRole('link').textContent).toBe('security page →')
  })

  it('recomputes the score as the weights move, and resets to the saved ones', () => {
    const panel = show()
    expect(status(panel)).toBe('With these weights: 48 (D)')
    fireEvent.change(slider(panel, 'Security'), { target: { value: '0' } })
    // (1760 + 1140 + 705 + 400) / 60 = 66.75 → 67
    expect(status(panel)).toBe('With these weights: 67 (C)+19 from 48')
    fireEvent.change(slider(panel, 'Code quality'), { target: { value: '0' } })
    fireEvent.change(slider(panel, 'Architecture'), { target: { value: '100' } })
    // (1140 + 705 + 4000) / 130 = 44.96 → 45
    expect(status(panel)).toBe('With these weights: 45 (D)-3 from 48')
    fireEvent.click(panel.getByRole('button', { name: 'Reset' }))
    expect(slider(panel, 'Security').value).toBe('25')
    expect(status(panel)).toBe('With these weights: 48 (D)')
    expect((panel.getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says an unscored dimension does not count, and when nothing counts at all', () => {
    const panel = show()
    expect(slider(panel, 'Dependency health').getAttribute('aria-describedby')).toBeTruthy()
    expect(panel.getByText('Not scored for this run, so its weight does not change this score.')).toBeTruthy()
    fireEvent.change(slider(panel, 'Dependency health'), { target: { value: '100' } })
    expect(status(panel)).toBe('With these weights: 48 (D)') // unchanged, and no "+0"
    for (const name of ['Security', 'Code quality', 'Complexity', 'Maintainability', 'Architecture']) {
      fireEvent.change(slider(panel, name), { target: { value: '0' } })
    }
    expect(status(panel)).toBe('With these weights nothing scored counts, so there is no overall score.')
  })

  it('saves the tried weights for every score', async () => {
    const requests = mockApi({
      'PUT /health-score/weights': (config) => ({ status: 200, data: { weights: JSON.parse(String(config.data)), is_default: false } }),
    })
    const panel = show()
    const save = panel.getByRole('button', { name: 'Save as my weights' }) as HTMLButtonElement
    expect(save.disabled).toBe(true) // nothing changed yet
    fireEvent.change(slider(panel, 'Security'), { target: { value: '50' } })
    fireEvent.click(save)
    await within(screen.getByRole('region', { name: 'Notifications' })).findByText('Weights saved')
    expect(JSON.parse(String(requests.find((r) => r.method === 'PUT')?.data))).toEqual({
      security: 50,
      quality: 20,
      complexity: 15,
      maintainability: 15,
      dependencies: 15,
      architecture: 10,
    })
  })

  it('cannot save weights that are all 0, and reports a failed save', async () => {
    mockApi({ 'PUT /health-score/weights': { status: 500, data: { detail: 'Weights could not be stored' } } })
    const panel = show()
    for (const d of DIMENSIONS) fireEvent.change(slider(panel, d.name), { target: { value: '0' } })
    expect((panel.getByRole('button', { name: 'Save as my weights' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(slider(panel, 'Security'), { target: { value: '5' } })
    fireEvent.click(panel.getByRole('button', { name: 'Save as my weights' }))
    await waitFor(() => expect(panel.getByRole('alert').textContent).toBe('Weights could not be stored'))
  })

  it('says when no dimension can raise the score', () => {
    const panel = show([dim('security', 'Security', 100, 25), dim('quality', 'Code quality', null, 20)])
    expect(panel.getByText('No scored dimension can raise the overall score.')).toBeTruthy()
    expect(panel.queryByRole('list', { name: 'Largest gains' })).toBeNull()
  })
})
