import { afterEach, describe, expect, it, vi } from 'vitest'

import { installSmoothWheel, MOUSE_WHEEL_MIN_PX, scrollsOnItsOwn, wheelPixels } from './smoothScroll'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function sized(element: HTMLElement, { scrollHeight, clientHeight, scrollTop = 0 }: { scrollHeight: number; clientHeight: number; scrollTop?: number }) {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight })
  element.scrollTop = scrollTop
  Object.defineProperty(element, 'scrollTop', { configurable: true, value: scrollTop, writable: true })
  return element
}

describe('wheel distances', () => {
  it('converts lines and pages to pixels', () => {
    expect(wheelPixels({ deltaY: 100, deltaMode: 0 }, 800)).toBe(100)
    expect(wheelPixels({ deltaY: 3, deltaMode: 1 }, 800)).toBe(120)
    expect(wheelPixels({ deltaY: -1, deltaMode: 2 }, 800)).toBe(-800)
  })
})

describe('elements that scroll on their own', () => {
  it('leaves a scrollable box its own scrolling until it reaches its end', () => {
    const box = sized(document.createElement('div'), { scrollHeight: 500, clientHeight: 100, scrollTop: 0 })
    box.style.overflowY = 'auto'
    const inner = document.createElement('p')
    box.appendChild(inner)
    document.body.appendChild(box)
    expect(scrollsOnItsOwn(inner, 100)).toBe(true) // can go down
    expect(scrollsOnItsOwn(inner, -100)).toBe(false) // already at the top
    box.scrollTop = 400
    expect(scrollsOnItsOwn(inner, 100)).toBe(false) // at the bottom
    expect(scrollsOnItsOwn(inner, -100)).toBe(true)
  })

  it('ignores boxes that do not overflow or are not scroll containers', () => {
    const fits = sized(document.createElement('div'), { scrollHeight: 100, clientHeight: 100 })
    fits.style.overflowY = 'auto'
    const hidden = sized(document.createElement('div'), { scrollHeight: 500, clientHeight: 100 })
    hidden.style.overflowY = 'hidden'
    document.body.append(fits, hidden)
    expect(scrollsOnItsOwn(fits, 100)).toBe(false)
    expect(scrollsOnItsOwn(hidden, 100)).toBe(false)
    expect(scrollsOnItsOwn(null, 100)).toBe(false)
    expect(scrollsOnItsOwn(window, 100)).toBe(false)
  })
})

describe('smooth wheel', () => {
  function setup({ reduce = false, coarse = false } = {}) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: (reduce && query.includes('reduce')) || (coarse && query.includes('coarse')) }))
    const frames: { id: number; callback: FrameRequestCallback }[] = []
    let nextId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push({ id: nextId, callback })
      return nextId++
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      const index = frames.findIndex((frame) => frame.id === id)
      if (index >= 0) frames.splice(index, 1)
    })
    let y = 0
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y })
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    const scrollTo = vi.fn((options: ScrollToOptions) => {
      y = options.top ?? y
    })
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
    const run = (count: number) => {
      for (let i = 0; i < count && frames.length; i += 1) frames.shift()!.callback(0)
    }
    return { frames, scrollTo, run, setY: (value: number) => (y = value), getY: () => y }
  }

  const wheel = (init: WheelEventInit, target: EventTarget = window) => {
    const event = new WheelEvent('wheel', { cancelable: true, bubbles: true, ...init })
    target.dispatchEvent(event)
    return event
  }

  it('glides the page toward the wheel target and stops there', () => {
    const page = setup()
    const remove = installSmoothWheel()
    const event = wheel({ deltaY: 100 })
    expect(event.defaultPrevented).toBe(true)
    page.run(1)
    const first = page.getY()
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(100) // eased, not a jump
    wheel({ deltaY: 100 }) // another notch adds to the target
    page.run(200)
    expect(page.getY()).toBe(200)
    expect(page.frames).toHaveLength(0) // stopped
    expect(page.scrollTo).toHaveBeenLastCalledWith({ top: 200, behavior: 'instant' })
    remove()
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false)
  })

  it('stays within the page', () => {
    const page = setup()
    const remove = installSmoothWheel()
    wheel({ deltaY: -300 })
    page.run(200)
    expect(page.getY()).toBe(0)
    wheel({ deltaY: 2, deltaMode: 2 }) // two pages down... and more
    wheel({ deltaY: 10, deltaMode: 2 })
    page.run(400)
    expect(page.getY()).toBe(5000 - 800)
    remove()
  })

  it('leaves trackpads, zoom, sideways scrolling and scrollable boxes alone', () => {
    setup()
    const remove = installSmoothWheel()
    expect(wheel({ deltaY: MOUSE_WHEEL_MIN_PX - 1 }).defaultPrevented).toBe(false)
    expect(wheel({ deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false)
    expect(wheel({ deltaY: 100, metaKey: true }).defaultPrevented).toBe(false)
    expect(wheel({ deltaY: 60, deltaX: 120 }).defaultPrevented).toBe(false)
    const box = sized(document.createElement('div'), { scrollHeight: 500, clientHeight: 100 })
    box.style.overflowY = 'scroll'
    document.body.appendChild(box)
    expect(wheel({ deltaY: 100 }, box).defaultPrevented).toBe(false)
    expect(wheel({ deltaY: 3, deltaMode: 1 }).defaultPrevented).toBe(true) // a line-based mouse wheel
    remove()
  })

  it('stops gliding when something else moves the page', () => {
    const page = setup()
    const remove = installSmoothWheel()
    wheel({ deltaY: 400 })
    page.run(2)
    page.setY(1500) // the keyboard or the scrollbar
    window.dispatchEvent(new Event('scroll'))
    const calls = page.scrollTo.mock.calls.length
    page.run(5)
    expect(page.scrollTo.mock.calls.length).toBe(calls) // no more gliding from the old place
    wheel({ deltaY: 100 })
    page.run(200)
    expect(page.getY()).toBe(1600) // continues from where the page now is
    remove()
  })

  it('is off without media queries, under reduced motion and on touch screens', () => {
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false)
    const none = installSmoothWheel() // jsdom has no matchMedia
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false)
    none()
    setup({ reduce: true })
    const reduced = installSmoothWheel()
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false)
    reduced()
    setup({ coarse: true })
    const touch = installSmoothWheel()
    expect(wheel({ deltaY: 100 }).defaultPrevented).toBe(false)
    touch()
  })
})
