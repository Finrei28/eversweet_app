import { describe, expect, it } from "vitest"
import { nzMonthRange } from "./tradingHours"
import { formatInTimeZone } from "date-fns-tz"

/**
 * Every case here is written as an instant — a UTC "Z" literal — rather than as
 * a wall-clock string, because the whole point of these tests is the gap
 * between the two. The API runs on Render in UTC while the leaderboard's month
 * boundaries belong to the New Zealand calendar, and that gap is where the
 * winner cron was silently computing the wrong month.
 *
 * The assertions describe the NZ wall clock the instant lands on, so they hold
 * whatever timezone the machine running them is set to.
 */
const nzWallClock = (date: Date) =>
  formatInTimeZone(date, "Pacific/Auckland", "yyyy-MM-dd HH:mm")

describe("nzMonthRange", () => {
  it("takes the month from the New Zealand calendar, not the server's", () => {
    // 31 Aug 12:30 UTC is already 1 Sep 00:30 in Auckland (NZST, +12). A UTC
    // host reading this with getMonth() sees August; New Zealand sees September.
    const justAfterNzMonthRollover = new Date("2026-08-31T12:30:00Z")

    expect(nzMonthRange(justAfterNzMonthRollover)).toMatchObject({
      month: 9,
      year: 2026,
    })
  })

  it("steps back a whole month for the winner cron", () => {
    // The cron fires at NZ midnight on the 1st and wants the month that just
    // ended. On a UTC host the old `new Date(y, m - 1, 1)` produced July here,
    // whose winner row already existed — so the insert hit the unique
    // constraint and no winner was ever recorded again.
    const cronFiresAtNzMidnight = new Date("2026-08-31T12:00:00Z")

    expect(nzMonthRange(cronFiresAtNzMidnight, -1)).toMatchObject({
      month: 8,
      year: 2026,
    })
  })

  it("does not overflow when run on a day the previous month does not have", () => {
    // The old findLastMonthsWinner mutated a Date with setMonth, so on 31 March
    // it asked for "31 February", which normalises forward into March — the
    // banner then queried the current month and showed no winner.
    const thirtyFirstOfMarch = new Date("2026-03-31T09:00:00Z")

    expect(nzMonthRange(thirtyFirstOfMarch, -1)).toMatchObject({
      month: 2,
      year: 2026,
    })
  })

  it("wraps to December of the previous year in January", () => {
    const january = new Date("2026-01-15T00:00:00Z")

    expect(nzMonthRange(january, -1)).toMatchObject({ month: 12, year: 2025 })
  })

  it("bounds the month with New Zealand midnights, not UTC midnights", () => {
    const midSeptember = new Date("2026-09-15T00:00:00Z")

    const { start, end } = nzMonthRange(midSeptember)

    expect(nzWallClock(start)).toBe("2026-09-01 00:00")
    expect(nzWallClock(end)).toBe("2026-10-01 00:00")
  })

  it("keeps midnight through the start of daylight saving", () => {
    // New Zealand moves to +13 on the last Sunday of September. A month bounded
    // by fixed arithmetic rather than by the zone would land an hour out on one
    // side of that.
    const september = new Date("2026-09-10T00:00:00Z")

    const { start, end } = nzMonthRange(september)

    expect(nzWallClock(start)).toBe("2026-09-01 00:00")
    expect(nzWallClock(end)).toBe("2026-10-01 00:00")
    expect(start.toISOString()).toBe("2026-08-31T12:00:00.000Z") // +12, NZST
    expect(end.toISOString()).toBe("2026-09-30T11:00:00.000Z") // +13, NZDT
  })

  it("keeps midnight through the end of daylight saving", () => {
    // And back to +12 on the first Sunday of April.
    const april = new Date("2026-04-10T00:00:00Z")

    const { start, end } = nzMonthRange(april)

    expect(nzWallClock(start)).toBe("2026-04-01 00:00")
    expect(nzWallClock(end)).toBe("2026-05-01 00:00")
  })

  it("returns a half-open range, so a record at `end` belongs to the next month", () => {
    const { end } = nzMonthRange(new Date("2026-09-15T00:00:00Z"))
    const { start: nextStart } = nzMonthRange(new Date("2026-10-15T00:00:00Z"))

    expect(end.getTime()).toBe(nextStart.getTime())
  })

  it("steps forward as well as back", () => {
    expect(nzMonthRange(new Date("2026-11-15T00:00:00Z"), 1)).toMatchObject({
      month: 12,
      year: 2026,
    })
    expect(nzMonthRange(new Date("2026-12-15T00:00:00Z"), 1)).toMatchObject({
      month: 1,
      year: 2027,
    })
  })
})
