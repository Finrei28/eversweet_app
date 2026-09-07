import { formatStartsIn, SECONDS_WINDOW } from "@/lib/formatters"
import { useEffect, useState } from "react"

/** Seconds-precision labels need a matching tick; whole minutes do not. */
const FAST_TICK = 1_000
const SLOW_TICK = 30_000

/**
 * How long until this label could next change.
 *
 * Returns null when it never will: an order that is already due reads
 * "Start now" until someone accepts it, and one with no usable `dueAt` reads
 * "Start time unknown" forever. Neither needs a timer, which is what makes a
 * full Upcoming list of due orders cost nothing to leave on screen.
 */
export const nextTickIn = (dueAt: string | null | undefined, now: number) => {
  if (!dueAt) return null

  const due = new Date(dueAt).getTime()
  if (Number.isNaN(due)) return null

  const seconds = (due - now) / 1000
  if (seconds <= 0) return null

  // Inclusive, unlike the formatter's own boundary: an order sitting exactly
  // on the window is one second from needing the fast tick, and scheduling
  // thirty would leave the label stale for the whole of that first half
  // minute of the countdown.
  return seconds <= SECONDS_WINDOW ? FAST_TICK : SLOW_TICK
}

/**
 * The "starts in" label for an order, kept current.
 *
 * Paces itself by how close the order is — once a second only inside the last
 * ten minutes, every thirty seconds before that, and not at all once it is
 * due. Used from the smallest component that shows the label rather than from
 * the panel around it, so a tick re-renders one badge instead of every row,
 * its dessert lines and their date formatting.
 *
 * The formatting itself stays in `formatStartsIn`, which is pure and tested
 * on its own.
 */
export function useCountdown(dueAt: string | null | undefined): string {
  const [label, setLabel] = useState(() => formatStartsIn(dueAt))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = () => {
      const now = new Date()
      // An unchanged string is a no-op: React bails out on Object.is, so the
      // fast tick costs nothing on the seconds where the label holds still.
      setLabel(formatStartsIn(dueAt, now))

      const delay = nextTickIn(dueAt, now.getTime())
      if (delay !== null) timer = setTimeout(tick, delay)
    }

    // Immediately, not after the first delay: `dueAt` may have changed since
    // the label was last computed. The server re-sends a receipt with a
    // corrected time whenever the website retries.
    tick()

    return () => clearTimeout(timer)
  }, [dueAt])

  return label
}
