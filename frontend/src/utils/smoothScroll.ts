/**
 * Smooth mouse-wheel scrolling for the page: a wheel notch glides the page instead of
 * jumping it. Only the page itself and only real mouse wheels are handled; trackpads and
 * touch already scroll smoothly, anything that scrolls on its own (code views, lists,
 * dialogs) keeps its native scrolling, Ctrl+wheel still zooms, and reduced motion turns
 * it off.
 */

/** Wheel events from trackpads come in many small pixel steps; a mouse notch is large. */
export const MOUSE_WHEEL_MIN_PX = 50
/** How much of the remaining distance each frame covers (higher is snappier). */
export const EASE = 0.14

/** A wheel event's vertical distance in pixels, whatever unit the browser reports. */
export function wheelPixels(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, pageHeight: number): number {
  if (event.deltaMode === 1) return event.deltaY * 40 // lines
  if (event.deltaMode === 2) return event.deltaY * pageHeight // pages
  return event.deltaY
}

/** Whether an element between the target and the page can scroll in this direction itself. */
export function scrollsOnItsOwn(target: EventTarget | null, deltaY: number): boolean {
  let element = target instanceof Element ? target : null
  while (element && element !== document.body && element !== document.documentElement) {
    const style = getComputedStyle(element)
    const scrollable = /(auto|scroll|overlay)/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1
    if (scrollable) {
      const atTop = element.scrollTop <= 0
      const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 1
      if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) return true
    }
    element = element.parentElement
  }
  return false
}

/** Install the smooth wheel on the window; returns a function that removes it. */
export function installSmoothWheel(): () => void {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia : null
  if (!media || media('(prefers-reduced-motion: reduce)').matches || media('(pointer: coarse)').matches) {
    return () => {}
  }
  let target = window.scrollY
  let current = window.scrollY
  let frame = 0
  let gliding = false

  const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight)

  const step = () => {
    current += (target - current) * EASE
    if (Math.abs(target - current) < 0.5) current = target
    window.scrollTo({ top: current, behavior: 'instant' })
    if (current !== target) frame = requestAnimationFrame(step)
    else gliding = false
  }

  const onWheel = (event: WheelEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey) return
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
    const pixels = wheelPixels(event, window.innerHeight)
    if (event.deltaMode === 0 && Math.abs(pixels) < MOUSE_WHEEL_MIN_PX) return // a trackpad
    if (scrollsOnItsOwn(event.target, pixels)) return
    event.preventDefault()
    if (!gliding) {
      target = window.scrollY
      current = window.scrollY
    }
    target = Math.min(maxScroll(), Math.max(0, target + pixels))
    if (!gliding) {
      gliding = true
      frame = requestAnimationFrame(step)
    }
  }

  // The keyboard, the scrollbar or a link moved the page: stop gliding from the old place.
  const onScroll = () => {
    if (gliding && Math.abs(window.scrollY - current) > 2) {
      cancelAnimationFrame(frame)
      gliding = false
    }
  }

  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('scroll', onScroll, { passive: true })
  return () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('scroll', onScroll)
  }
}
