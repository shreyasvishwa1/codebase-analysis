import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { InternalAxiosRequestConfig } from 'axios'
import { MemoryRouter } from 'react-router-dom'
import { ROUTER_FUTURE } from '../routerFuture'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import { ToastProvider } from '../components/Toaster'
import { preloadAllPages } from '../routes/pages'
import { setToken } from '../services/session'
import { mockApi, USER, type MockResponse } from '../test/mockApi'
import { createTestQueryClient, renderWithProviders } from '../test/render'
import type { UsabilityMine, UsabilityResults } from '../types/api'
import { CSV_FILENAME, UsabilityPage } from './UsabilityPage'

const STATEMENTS = Array.from({ length: 10 }, (_, i) => `Statement number ${i + 1}.`)
const GOOD = [4, 2, 4, 2, 4, 2, 4, 2, 4, 2]

const mine = (overrides: Partial<UsabilityMine> = {}): MockResponse => ({
  status: 200,
  data: { statements: STATEMENTS, answers: null, score: null, grade: null, updated_at: null, ...overrides },
})
const EMPTY_RESULTS: UsabilityResults = {
  responses: 0, mean: null, grade: null, median: null, standard_deviation: null, lowest: null, highest: null,
  average_benchmark: 68, items: STATEMENTS.map((statement, i) => ({ number: i + 1, statement, positive: i % 2 === 0, mean: null })),
  grades: { A: 0, B: 0, C: 0, D: 0, F: 0 },
}  // prettier-ignore
const RESULTS: UsabilityResults = {
  responses: 3, mean: 75, grade: 'B', median: 75, standard_deviation: 25, lowest: 50, highest: 100, average_benchmark: 68,
  items: STATEMENTS.map((statement, i) => ({ number: i + 1, statement, positive: i % 2 === 0, mean: i % 2 === 0 ? 4 : 2 })),
  grades: { A: 1, B: 1, C: 0, D: 0, F: 1 },
}  // prettier-ignore

type Routes = Parameters<typeof mockApi>[0]

function mount(routes: Routes) {
  const requests = mockApi({ 'GET /usability/results': { status: 200, data: EMPTY_RESULTS }, ...routes })
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter future={ROUTER_FUTURE}>
        <ToastProvider>
          <UsabilityPage />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return requests
}

const questionnaire = () => screen.findByRole('form', { name: 'Usability questionnaire' })
const answer = (number: number, value: number) =>
  fireEvent.click(within(screen.getByRole('radiogroup', { name: `Statement ${number}` })).getByLabelText(new RegExp(`^${value}:`)))
const toastTitles = () =>
  within(screen.getByRole('region', { name: 'Notifications' }))
    .queryAllByRole('listitem')
    .map((item) => item.querySelector('p')?.textContent)

beforeAll(() => preloadAllPages(), 120_000)

describe('Rate this app', () => {
  it('asks the ten statements from the server, each from 1 to 5', async () => {
    mount({ 'GET /usability/me': mine() })
    const form = await questionnaire()
    expect(within(form).getAllByRole('group')).toHaveLength(10)
    expect(within(form).getByText('1. Statement number 1.')).toBeTruthy()
    const first = screen.getByRole('radiogroup', { name: 'Statement 1' })
    expect(within(first).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      '1: Strongly disagree', '2: Disagree', '3: Neither agree nor disagree', '4: Agree', '5: Strongly agree',
    ])  // prettier-ignore
  })

  it('submits only a complete set of answers and shows the score', async () => {
    const requests = mount({
      'GET /usability/me': mine(),
      'PUT /usability/me': (config: InternalAxiosRequestConfig) => ({
        status: 200,
        data: { statements: STATEMENTS, answers: JSON.parse(String(config.data)).answers, score: 75, grade: 'B', updated_at: '2026-11-24T10:00:00Z' },
      }),
    })
    await questionnaire()
    const submit = screen.getByRole('button', { name: 'Submit answers' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    expect(screen.getByText('10 of 10 statements still to answer')).toBeTruthy()
    GOOD.slice(0, 9).forEach((value, i) => answer(i + 1, value))
    expect(screen.getByText('1 of 10 statements still to answer')).toBeTruthy()
    fireEvent.submit(screen.getByRole('form', { name: 'Usability questionnaire' }))
    expect(requests.some((r) => r.method === 'PUT')).toBe(false)  // incomplete: nothing sent
    answer(10, GOOD[9])
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)
    await waitFor(() => expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1))
    expect(JSON.parse(String(requests.find((r) => r.method === 'PUT')?.data))).toEqual({ answers: GOOD })
    expect(await screen.findByText(/Your answers give a score of/)).toBeTruthy()
    expect(screen.getByText('75')).toBeTruthy()
    await waitFor(() => expect(toastTitles()).toEqual(['Answers saved']))
    // The results are fetched again after saving.
    await waitFor(() => expect(requests.filter((r) => r.url === '/usability/results')).toHaveLength(2))
  })

  it('shows saved answers and updates only after a change', async () => {
    const requests = mount({
      'GET /usability/me': mine({ answers: GOOD, score: 75, grade: 'B', updated_at: '2026-11-24T10:00:00Z' }),
      'PUT /usability/me': (config: InternalAxiosRequestConfig) => ({
        status: 200,
        data: { statements: STATEMENTS, answers: JSON.parse(String(config.data)).answers, score: 77.5, grade: 'B+', updated_at: '2026-11-24T11:00:00Z' },
      }),
    })
    await questionnaire()
    const first = screen.getByRole('radiogroup', { name: 'Statement 1' })
    expect((within(first).getByLabelText(/^4:/) as HTMLInputElement).checked).toBe(true)
    const update = screen.getByRole('button', { name: 'Update answers' }) as HTMLButtonElement
    expect(update.disabled).toBe(true)
    expect(screen.getByText('These are your saved answers. Change any of them to update.')).toBeTruthy()
    answer(1, 5)
    expect(update.disabled).toBe(false)
    fireEvent.click(update)
    await waitFor(() => expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1))
    expect(JSON.parse(String(requests.find((r) => r.method === 'PUT')?.data)).answers).toEqual([5, ...GOOD.slice(1)])
    await waitFor(() => expect(toastTitles()).toEqual(['Answers updated']))
    expect(await screen.findByText('77.5')).toBeTruthy()
  })

  it('says why saving failed', async () => {
    mount({ 'GET /usability/me': mine({ answers: GOOD, score: 75, grade: 'B', updated_at: 'x' }), 'PUT /usability/me': { status: 500, data: {} } })
    await questionnaire()
    answer(2, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Update answers' }))
    expect(await screen.findByText('Could not save your answers')).toBeTruthy()
  })

  it('shows that there are no results yet', async () => {
    mount({ 'GET /usability/me': mine() })
    expect(await screen.findByText('No answers yet. The results appear here once someone has answered.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Download answers/ })).toBeNull()
  })

  it('summarizes every response', async () => {
    mount({ 'GET /usability/me': mine(), 'GET /usability/results': { status: 200, data: RESULTS } })
    const results = await screen.findByRole('region', { name: 'Results' })
    await within(results).findByText('Responses')
    expect(within(results).getByText('Grade B')).toBeTruthy()
    expect(within(results).getByText('± 25')).toBeTruthy()
    expect(within(results).getByText('Lowest 50, highest 100')).toBeTruthy()
    const grades = within(within(results).getByRole('list', { name: 'Responses by grade' })).getAllByRole('listitem')
    expect(grades.map((g) => g.textContent)).toEqual(['A1', 'B1', 'C0', 'D0', 'F1'])
    const rows = within(within(results).getByRole('table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(10)
    expect(rows[0].textContent).toBe('1. Statement number 1.4.00higher')
    expect(rows[1].textContent).toBe('2. Statement number 2.2.00lower')
  })

  describe('download', () => {
    let clicked: { download: string; href: string }[]
    beforeEach(() => {
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:sus'), revokeObjectURL: vi.fn() })
      clicked = []
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ download: this.download, href: this.getAttribute('href') ?? '' })
      })
    })
    afterEach(() => vi.restoreAllMocks())

    it('downloads the anonymous answers as CSV', async () => {
      const requests = mount({
        'GET /usability/me': mine(),
        'GET /usability/results': { status: 200, data: RESULTS },
        'GET /usability/results.csv': { status: 200, data: new Blob(['respondent,q1\n'], { type: 'text/csv' }) },
      })
      fireEvent.click(await screen.findByRole('button', { name: 'Download answers (CSV)' }))
      await waitFor(() => expect(clicked).toEqual([{ download: CSV_FILENAME, href: 'blob:sus' }]))
      expect(requests.some((r) => r.url === '/usability/results.csv')).toBe(true)
      await waitFor(() => expect(toastTitles()).toEqual(['Answers downloaded']))
    })
  })

  it('is reached from the menu as "Rate this app"', async () => {
    setToken('session-token')
    mockApi({
      'GET /auth/me': { status: 200, data: USER },
      'GET /health': { status: 200, data: { status: 'ok' } },
      'GET /dashboard': { status: 200, data: {} },
      'GET /usability/me': mine(),
      'GET /usability/results': { status: 200, data: EMPTY_RESULTS },
    })
    renderWithProviders(<App />, { route: '/settings' })
    fireEvent.click(await screen.findByRole('link', { name: 'Rate this app' }))
    expect(await screen.findByRole('heading', { name: 'Rate this app' })).toBeTruthy()
    expect(await questionnaire()).toBeTruthy()
  })
})
