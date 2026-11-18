import { useEffect, useRef, useState, type RefObject } from 'react'

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * Adds `is-visible` to elements with the `reveal` class inside the container the first time
 * each one scrolls into view. Without IntersectionObserver (old browsers, tests) everything is
 * shown at once.
 */
export function useReveal<T extends HTMLElement>(): RefObject<T> {
  const ref = useRef<T>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.reveal'))
    if (typeof IntersectionObserver === 'undefined' || reducedMotion()) {
      targets.forEach((element) => element.classList.add('is-visible'))
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.12 },
    )
    targets.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])
  return ref
}

/**
 * Tilts an element (with the `tilt` class) toward the pointer, up to `max` degrees, and levels
 * it again when the pointer leaves. Does nothing for touch input or under reduced motion.
 */
export function useTilt<T extends HTMLElement>(max = 8): RefObject<T> {
  const ref = useRef<T>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || reducedMotion()) return
    let frame = 0
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const box = element.getBoundingClientRect()
      const x = (event.clientX - box.left) / box.width - 0.5
      const y = (event.clientY - box.top) / box.height - 0.5
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        element.style.setProperty('--ry', `${(x * max * 2).toFixed(2)}deg`)
        element.style.setProperty('--rx', `${(-y * max * 2).toFixed(2)}deg`)
      })
    }
    const leave = () => {
      cancelAnimationFrame(frame)
      element.style.setProperty('--rx', '0deg')
      element.style.setProperty('--ry', '0deg')
    }
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', leave)
    }
  }, [max])
  return ref
}

/** How far (0 to 1) the element has scrolled through the viewport: 0 when its top reaches the
 * bottom of the screen, 1 when its bottom reaches the middle. Used to fill a progress trace. */
export function useScrollProgress<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (reducedMotion()) {
      setProgress(1)
      return
    }
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const box = element.getBoundingClientRect()
        const start = window.innerHeight
        const end = window.innerHeight / 2 - box.height
        const value = (start - box.top) / (start - end)
        setProgress(Math.min(1, Math.max(0, value)))
      })
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return [ref, progress]
}
