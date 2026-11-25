import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ROUTER_FUTURE } from '../routerFuture'
import { overflowSides, RepositoryNav, SCROLL_SHARE } from './RepositoryNav'

describe('overflowSides', () => {
  it('says which sides have more out of view', () => {
    expect(overflowSides({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300 })).toEqual({ left: false, right: false })
    expect(overflowSides({ scrollLeft: 0, clientWidth: 300, scrollWidth: 900 })).toEqual({ left: false, right: true })
    expect(overflowSides({ scrollLeft: 200, clientWidth: 300, scrollWidth: 900 })).toEqual({ left: true, right: true })
    expect(overflowSides({ scrollLeft: 600, clientWidth: 300, scrollWidth: 900 })).toEqual({ left: true, right: false })
  })

  it('allows a pixel of rounding at each end', () => {
    expect(overflowSides({ scrollLeft: 1, clientWidth: 300, scrollWidth: 900 }).left).toBe(false)
    expect(overflowSides({ scrollLeft: 599.5, clientWidth: 300, scrollWidth: 900 }).right).toBe(false)
    expect(overflowSides({ scrollLeft: 1.5, clientWidth: 300, scrollWidth: 900 }).left).toBe(true)
  })
})

describe('RepositoryNav', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // jsdom has neither; the tests define them.
    delete (Element.prototype as Partial<Element>).scrollIntoView
    delete (Element.prototype as Partial<Element>).scrollBy
  })

  function show(path = '/projects/p/repositories/r/history', layout?: { clientWidth: number; scrollWidth: number }) {
    const scrolled: { left: number }[] = []
    const intoView: Element[] = []
    Element.prototype.scrollIntoView = function (this: Element) {
      intoView.push(this)
    }
    if (layout) {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(layout.clientWidth)
      vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(layout.scrollWidth)
    }
    Element.prototype.scrollBy = ((options?: ScrollToOptions) => {
      scrolled.push({ left: options?.left ?? 0 })
    }) as Element['scrollBy']
    render(
      <MemoryRouter future={ROUTER_FUTURE} initialEntries={[path]}>
        <RepositoryNav projectId="p" repositoryId="r" />
      </MemoryRouter>,
    )
    return { nav: screen.getByRole('navigation', { name: 'Repository sections' }), scrolled, intoView }
  }

  it('shows no arrows when every section fits', () => {
    show(undefined, { clientWidth: 900, scrollWidth: 900 })
    expect(screen.queryByRole('button', { name: 'Show more sections' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show earlier sections' })).toBeNull()
  })

  it('brings the current section into view', () => {
    const { intoView } = show('/projects/p/repositories/r/history')
    expect(intoView.map((element) => element.textContent)).toEqual(['History & reports'])
  })

  it('offers arrows on the sides with more, and scrolls by part of the width', () => {
    const { nav, scrolled } = show(undefined, { clientWidth: 300, scrollWidth: 900 })
    expect(screen.queryByRole('button', { name: 'Show earlier sections' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show more sections' }))
    expect(scrolled).toEqual([{ left: 300 * SCROLL_SHARE }])

    nav.scrollLeft = 600
    act(() => {
      nav.dispatchEvent(new Event('scroll'))
    })
    expect(screen.queryByRole('button', { name: 'Show more sections' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show earlier sections' }))
    expect(scrolled[1]).toEqual({ left: -300 * SCROLL_SHARE })

    nav.scrollLeft = 0
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(screen.getByRole('button', { name: 'Show more sections' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show earlier sections' })).toBeNull()
  })

  it('hides its scrollbar and keeps every section reachable as a link', () => {
    const { nav } = show(undefined, { clientWidth: 900, scrollWidth: 900 })
    expect(nav.className).toContain('scrollbar-none')
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toHaveLength(10)
    expect(screen.getByRole('link', { name: 'History & reports' }).getAttribute('aria-current')).toBe('page')
  })
})
