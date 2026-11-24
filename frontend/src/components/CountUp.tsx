import { useEffect, useRef, useState } from 'react'

import { motionAllowed } from './LiveTraces'

/** How long a number takes to count to its value. */
export const COUNT_MS = 700

/** A formatted number split into what comes before it, the number, and what follows:
 * "108,570" → ['', 108570, ''], "35 s" → ['', 35, ' s'], "~2.5%" → ['~', 2.5, '%']. */
export interface ParsedNumber {
  prefix: string
  value: number
  decimals: number
  grouped: boolean
  suffix: string
}

const NUMBER = /^([^\d-]*)(-?\d[\d,]*)(\.\d+)?(.*)$/s

export function parseNumber(text: string): ParsedNumber | null {
  const found = NUMBER.exec(text)
  if (!found) return null
  const [, prefix, whole, fraction = '', suffix] = found
  const value = Number(whole.replace(/,/g, '') + fraction)
  if (!Number.isFinite(value)) return null
  return { prefix, value, decimals: fraction ? fraction.length - 1 : 0, grouped: whole.includes(','), suffix }
}

export function formatLike(parsed: ParsedNumber, value: number): string {
  const text = value.toLocaleString('en-US', {
    minimumFractionDigits: parsed.decimals,
    maximumFractionDigits: parsed.decimals,
    useGrouping: parsed.grouped,
  })
  return `${parsed.prefix}${text}${parsed.suffix}`
}

/** Eases out: quick at first, settling gently on the value. */
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3
}

/**
 * Shows a formatted number, counting up to it when it first appears and to each new value
 * after that. Text without a number ("—") is shown as it is. Without motion (reduced motion,
 * or no matchMedia, as in tests) the text is shown at once, exactly as given. While it counts,
 * screen readers get the final text and not the moving digits. `plain` is for SVG text, where
 * the surrounding element carries its own accessible label.
 */
export function CountUp({ children, plain = false }: { children: string; /** inside SVG text: no HTML wrappers */ plain?: boolean }) {
  const target = parseNumber(children)
  const [shown, setShown] = useState<number | null>(() => (target && motionAllowed() ? 0 : null))
  const from = useRef(0)
  const targetValue = target?.value

  useEffect(() => {
    if (targetValue === undefined || !motionAllowed()) {
      setShown(null)
      return
    }
    const start = from.current
    if (start === targetValue) {
      setShown(null)
      return
    }
    const began = performance.now()
    let frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - began) / COUNT_MS)
      const value = start + (targetValue - start) * easeOut(t)
      from.current = value
      if (t < 1) {
        setShown(value)
        frame = requestAnimationFrame(step)
      } else {
        from.current = targetValue
        setShown(null)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [targetValue])

  if (!target || shown === null) return <>{children}</>
  const factor = 10 ** target.decimals
  if (plain) return <>{formatLike(target, Math.round(shown * factor) / factor)}</>
  return (
    <>
      <span aria-hidden="true">{formatLike(target, Math.round(shown * factor) / factor)}</span>
      <span className="sr-only">{children}</span>
    </>
  )
}
