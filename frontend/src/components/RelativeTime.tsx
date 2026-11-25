import { useEffect, useState } from 'react'

import { formatDateTime } from '../utils/format'

/** How often a shown relative time is brought up to date. */
export const TICK_MS = 30_000

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago"; a week or more shows the date. */
export function relativeTime(iso: string, now: number): string {
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return '—'
  const elapsed = now - time // a clock slightly ahead still reads "just now"
  if (elapsed < 45_000) return 'just now'
  if (elapsed < HOUR) return `${Math.round(elapsed / MINUTE)} min ago`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`
  if (elapsed < 2 * DAY) return 'yesterday'
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} days ago`
  return new Date(time).toLocaleDateString()
}

/** A time shown relative to now and kept current; the exact date and time on hover. */
export function RelativeTime({ iso }: { iso: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <time dateTime={iso} title={formatDateTime(iso)}>
      {relativeTime(iso, now)}
    </time>
  )
}
