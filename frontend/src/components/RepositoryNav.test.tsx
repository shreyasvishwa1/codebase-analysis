import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ROUTER_FUTURE } from '../routerFuture'
import { EDGE_ROOM, overflowSides, RepositoryNav, SCROLL_SHARE, scrollToShow } from './RepositoryNav'

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

describe('scrollToShow', () => {
  const row = { scrollLeft: 100, clientWidth: 300 }
  it('scrolls the row only when the section is not fully visible, leaving room beside it', () => {
    expect(scrollToShow(row, { offsetLeft: 150, offsetWidth: 100 })).toBeNull() // 150-250 inside 100-400
    expect(scrollToShow(row, { offsetLeft: 380, offsetWidth: 120 })).toBe(500 - 300 + EDGE_ROOM) // past the right edge
    expect(scrollToShow(row, { offsetLeft: 80, offsetWidth: 60 })).toBe(80 - EDGE_ROOM) // before the left edge
    expect(scrollToShow(row, { offsetLeft: 20, offsetWidth: 60 })).toBe(0) // never before the start
    expect(scrollToShow(row, { offsetLeft: 100, offsetWidth: 300 })).toBeNull() // exactly fits
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

  it('brings the current section into view by scrolling the row, never the page', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) {
      return this.textContent === 'History & reports' ? 1000 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(150)
    const { nav, intoView } = show('/projects/p/repositories/r/history', { clientWidth: 400, scrollWidth: 1200 })
    expect(nav.scrollLeft).toBe(1150 - 400 + EDGE_ROOM)
    expect(intoView).toEqual([]) // the page itself is not scrolled
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
