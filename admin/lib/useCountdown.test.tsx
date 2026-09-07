import { Text } from "react-native"
import { act, create, ReactTestRenderer } from "react-test-renderer"

import { nextTickIn, useCountdown } from "./useCountdown"

const NOW = new Date("2026-03-02T12:00:00+13:00")
const inSeconds = (n: number) =>
  new Date(NOW.getTime() + n * 1000).toISOString()

function Probe({ dueAt }: { dueAt: string | null | undefined }) {
  return <Text>{useCountdown(dueAt)}</Text>
}

let renderer: ReactTestRenderer

const render = (dueAt: string | null | undefined) => {
  act(() => {
    renderer = create(<Probe dueAt={dueAt} />)
  })
  return renderer
}

const label = () => (renderer.toJSON() as unknown as { children: string[] })
  .children[0]

const advance = (ms: number) => act(() => jest.advanceTimersByTime(ms))

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW)
})

afterEach(() => {
  act(() => renderer?.unmount())
  jest.useRealTimers()
})

/**
 * The pacing rule on its own. What it costs to leave the Upcoming list on
 * screen all service comes down to these three answers.
 */
describe("nextTickIn", () => {
  it("ticks every second inside the last ten minutes", () => {
    expect(nextTickIn(inSeconds(30), NOW.getTime())).toBe(1_000)
    expect(nextTickIn(inSeconds(599), NOW.getTime())).toBe(1_000)
  })

  it("ticks slowly when the label is in whole minutes or hours", () => {
    expect(nextTickIn(inSeconds(601), NOW.getTime())).toBe(30_000)
    expect(nextTickIn(inSeconds(6 * 3600), NOW.getTime())).toBe(30_000)
  })

  // A second out from needing seconds, so it takes the fast tick early
  // rather than sitting on a stale label for the next half minute.
  it("speeds up on the window rather than after it", () => {
    expect(nextTickIn(inSeconds(600), NOW.getTime())).toBe(1_000)
  })

  // The label is final, so a timer would only burn a wake-up to write the
  // same string back. A list of due orders should cost nothing to leave up.
  it("schedules nothing once there is nothing left to count", () => {
    expect(nextTickIn(inSeconds(0), NOW.getTime())).toBeNull()
    expect(nextTickIn(inSeconds(-90), NOW.getTime())).toBeNull()
    expect(nextTickIn(null, NOW.getTime())).toBeNull()
    expect(nextTickIn("not a date", NOW.getTime())).toBeNull()
  })
})

describe("useCountdown", () => {
  it("starts on the current label", () => {
    render(inSeconds(4 * 60))
    expect(label()).toBe("Starts in 04:00")
  })

  it("counts down every second inside the window", () => {
    render(inSeconds(4 * 60))

    advance(1_000)
    expect(label()).toBe("Starts in 03:59")

    advance(1_000)
    expect(label()).toBe("Starts in 03:58")
  })

  it("keeps a slower label current too", () => {
    render(inSeconds(30 * 60 + 1))
    expect(label()).toBe("Starts in 31 min")

    advance(30_000)
    expect(label()).toBe("Starts in 30 min")
  })

  it("crosses into seconds without waiting for the slow tick", () => {
    render(inSeconds(600 + 30))
    expect(label()).toBe("Starts in 11 min")

    // The tick that lands on the window is the one that re-paces it, so the
    // seconds start moving a second later rather than half a minute later.
    advance(30_000)
    expect(label()).toBe("Starts in 10 min")

    advance(1_000)
    expect(label()).toBe("Starts in 09:59")
  })

  it("reaches Start now and stops there", () => {
    render(inSeconds(2))

    advance(2_000)
    expect(label()).toBe("Start now")
    expect(jest.getTimerCount()).toBe(0)
  })

  it("holds still on an order with no usable start time", () => {
    render(null)
    expect(label()).toBe("Start time unknown")
    expect(jest.getTimerCount()).toBe(0)
  })

  it("leaves no timer behind when it goes away", () => {
    render(inSeconds(4 * 60))
    expect(jest.getTimerCount()).toBe(1)

    act(() => renderer.unmount())
    expect(jest.getTimerCount()).toBe(0)
  })

  /**
   * The server re-sends a receipt with a corrected `dueAt` whenever the
   * website retries, and `upsertPendingOrder` replaces the order in place.
   * The badge has to follow that immediately, not on its next tick — which
   * for a slow order would be half a minute of a stale countdown.
   */
  it("re-labels at once when the start time is corrected", () => {
    render(inSeconds(2 * 3600))
    expect(label()).toBe("Starts in 2 hr")

    act(() => {
      renderer.update(<Probe dueAt={inSeconds(90)} />)
    })

    expect(label()).toBe("Starts in 01:30")
  })
})
