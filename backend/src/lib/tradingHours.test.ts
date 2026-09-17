import { readFileSync } from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  checkPickUpTime,
  formatStoreTime,
  isOpenAt,
  LAST_ORDER_OFFSET_MINUTES,
  nzWeekday,
  storeHoursByDayName,
  toWeeklyHours,
  type WeeklyHours,
} from "./tradingHours"
import { SHOP_HOURS } from "../test/shopHours"

/**
 * The rule every implementation agrees on - the website's `src/lib/pickUpTimes.ts`, the
 * app's `lib/checkoutHelpers.ts` and this - as cases. Copied byte-for-byte between the
 * repos; `cmp -s` them after changing one. Read from disk because this tsconfig does not
 * resolve JSON imports.
 */
const cases = JSON.parse(
  readFileSync(path.join(__dirname, "pickUpTimeCases.json"), "utf8"),
) as {
  hours: (number[] | null)[]
  validity: {
    name: string
    now: string
    at: string
    daysOff: string[]
    hours?: (number[] | null)[]
    reason: string | null
  }[]
}

const toHours = (hours: (number[] | null)[]): WeeklyHours =>
  hours.map((day) => (day ? { opensAt: day[0], closesAt: day[1] } : null))

/**
 * A Monday, when the store trades 12:30 PM to 9:30 PM. Times are written with
 * an explicit +13:00 (New Zealand daylight time in March) so a test never
 * depends on the timezone of the machine running it.
 */
const nz = (time: string) => new Date(`2026-03-02T${time}+13:00`)

const MONDAY_NOON = nz("12:00:00")
const noDaysOff = new Set<string>()

const check = (
  pickUpTime: Date,
  over: Partial<Parameters<typeof checkPickUpTime>[1]> = {},
) =>
  checkPickUpTime(pickUpTime, {
    eatIn: false,
    daysOffKeys: noDaysOff,
    hours: SHOP_HOURS,
    now: MONDAY_NOON,
    ...over,
  })

/**
 * The shared cases, under several process timezones. Render runs in UTC, and everything
 * here has to read the Auckland clock whichever zone the process is in.
 */
describe.each([
  ["this machine's timezone", undefined, undefined],
  ["UTC, as Render runs", "UTC", 0],
  ["Los Angeles", "America/Los_Angeles", 480],
])("the shared pick-up time cases, in %s", (_, timezone, offsetMinutes) => {
  const original = process.env.TZ
  beforeAll(() => {
    if (timezone) process.env.TZ = timezone
  })
  afterAll(() => {
    process.env.TZ = original
  })

  if (timezone) {
    it("is really running in that timezone", () => {
      expect(new Date("2026-03-02T00:00:00Z").getTimezoneOffset()).toBe(
        offsetMinutes,
      )
    })
  }

  it.each(cases.validity)("validity: $name", (c) => {
    const result = checkPickUpTime(new Date(c.at), {
      eatIn: false,
      daysOffKeys: new Set(c.daysOff),
      hours: toHours(c.hours ?? cases.hours),
      now: new Date(c.now),
    })

    expect(result.ok ? null : result.reason).toBe(c.reason)
  })
})

describe("checkPickUpTime", () => {
  it("accepts a slot inside trading hours", () => {
    expect(check(nz("18:00:00"))).toEqual({ ok: true })
  })

  it("rejects an unparseable date rather than treating it as midnight", () => {
    expect(check(new Date("not a date"))).toEqual({
      ok: false,
      reason: "invalid-date",
      message: "That pick up time is not a valid date.",
    })
  })

  it("rejects a slot before opening, naming the opening time", () => {
    // `now` is moved back so 11:00 is still ahead: a slot in the past is
    // refused by an earlier rule, and this is testing the hours check.
    expect(check(nz("11:00:00"), { now: nz("10:00:00") })).toEqual({
      ok: false,
      reason: "before-open",
      message: "We open at 12:30 PM that day.",
    })
  })

  it("accepts the opening minute itself", () => {
    expect(check(nz("12:30:00"))).toEqual({ ok: true })
  })

  describe("last orders", () => {
    // The counter stops taking orders before the doors close, and eat-in needs
    // longer because the customer still has to sit and eat.
    const close = 21 * 60 + 30

    it("takes a pickup order right up to the pickup cutoff", () => {
      const cutoff = close - LAST_ORDER_OFFSET_MINUTES.pickup // 9:20 PM
      expect(cutoff).toBe(21 * 60 + 20)
      expect(check(nz("21:20:00"))).toEqual({ ok: true })
      expect(check(nz("21:20:59"))).toEqual({ ok: true })
    })

    it("refuses a pickup order a minute past the cutoff, naming the last pick-up", () => {
      expect(check(nz("21:21:00"))).toEqual({
        ok: false,
        reason: "after-last-pick-up",
        message: "Our last pick up that day is 9:20 PM.",
      })
    })

    it("closes eat-in earlier than pickup for the same slot", () => {
      const eatInCutoff = close - LAST_ORDER_OFFSET_MINUTES.eatIn // 9:00 PM
      expect(eatInCutoff).toBe(21 * 60)

      // 9:10 PM: fine to collect, too late to sit in.
      expect(check(nz("21:10:00"), { eatIn: false })).toEqual({ ok: true })
      expect(check(nz("21:10:00"), { eatIn: true })).toEqual({
        ok: false,
        reason: "after-last-pick-up",
        message: "Our last eat-in order that day is 9:00 PM.",
      })
    })
  })

  describe("the past", () => {
    it("allows a slot a few minutes behind now, for clock skew and slow networks", () => {
      // The app works a time out, the customer takes a moment to confirm, the
      // request arrives late. Refusing that would break ordering on the minute.
      expect(check(nz("13:00:00"), { now: nz("13:10:00") })).toEqual({ ok: true })
    })

    it("rejects a slot well past the grace window", () => {
      expect(check(nz("13:00:00"), { now: nz("14:00:00") })).toEqual({
        ok: false,
        reason: "past",
        message: "That pick up time has already passed.",
      })
    })
  })

  it("rejects a slot further ahead than the app's picker allows", () => {
    const farFuture = new Date(MONDAY_NOON.getTime() + 60 * 24 * 60 * 60 * 1000)
    expect(check(farFuture)).toEqual({
      ok: false,
      reason: "too-far-ahead",
      message: "Orders can only be placed up to a month in advance.",
    })
  })

  it("rejects a day the store has marked off", () => {
    expect(
      check(nz("18:00:00"), { daysOffKeys: new Set(["2026-03-02"]) }),
    ).toEqual({
      ok: false,
      reason: "closed-day",
      message: "We are closed on that date.",
    })
  })

  it("matches a day off against the New Zealand calendar day, not UTC", () => {
    // 9:00 AM NZ on the 3rd is still the 2nd in UTC. Keying off UTC would let
    // an order through on a day the store told the system it was closed.
    const earlyTuesday = new Date("2026-03-03T09:00:00+13:00")
    expect(earlyTuesday.toISOString().slice(0, 10)).toBe("2026-03-02")

    expect(
      check(earlyTuesday, { daysOffKeys: new Set(["2026-03-03"]) }),
    ).toMatchObject({ ok: false, reason: "closed-day" })
  })

  it("rejects a weekday the hours mark closed", () => {
    const closedMondays = SHOP_HOURS.map((day, weekday) =>
      weekday === 1 ? null : day,
    )
    expect(check(nz("18:00:00"), { hours: closedMondays })).toEqual({
      ok: false,
      reason: "closed-day",
      message: "We are not open on that day.",
    })
  })

  it("uses each day's own hours", () => {
    // Friday opens at noon and closes at 10 PM, half an hour later than Monday.
    expect(check(new Date("2026-03-06T21:45:00+13:00"))).toEqual({ ok: true })

    // The same clock time on a Monday is past last orders.
    expect(check(nz("21:45:00"))).toMatchObject({
      ok: false,
      reason: "after-last-pick-up",
    })
  })
})

describe("isOpenAt", () => {
  it("is open from opening up to closing, not only to the last pick-up", () => {
    expect(isOpenAt(nz("12:29:00"), SHOP_HOURS, noDaysOff)).toBe(false)
    expect(isOpenAt(nz("12:30:00"), SHOP_HOURS, noDaysOff)).toBe(true)
    expect(isOpenAt(nz("21:25:00"), SHOP_HOURS, noDaysOff)).toBe(true)
    expect(isOpenAt(nz("21:30:00"), SHOP_HOURS, noDaysOff)).toBe(false)
  })

  // It used to be computed once at start-up, and never looked at days off.
  it("is closed on a day off, whatever the hours say", () => {
    expect(
      isOpenAt(nz("18:00:00"), SHOP_HOURS, new Set(["2026-03-02"])),
    ).toBe(false)
  })

  it("answers for the moment it is asked", () => {
    expect(isOpenAt(nz("18:00:00"), SHOP_HOURS, noDaysOff)).toBe(true)
    expect(isOpenAt(nz("23:00:00"), SHOP_HOURS, noDaysOff)).toBe(false)
  })
})

describe("the store hours the app reads", () => {
  /**
   * App builds already installed parse this shape, and list the days in the order they
   * arrive - so the shape, the strings and the Monday-first order are all a contract.
   */
  it("keeps the shape and order `/api/getStoreHours` has always served", () => {
    const served = storeHoursByDayName(SHOP_HOURS)

    expect(Object.keys(served)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ])
    expect(served).toEqual({
      Monday: ["12:30 PM", "9:30 PM"],
      Tuesday: ["12:30 PM", "9:30 PM"],
      Wednesday: ["12:30 PM", "9:30 PM"],
      Thursday: ["12:30 PM", "9:30 PM"],
      Friday: ["12:00 PM", "10:00 PM"],
      Saturday: ["12:00 PM", "10:00 PM"],
      Sunday: ["12:00 PM", "10:00 PM"],
    })
  })

  it("serves a closed weekday as null", () => {
    expect(
      storeHoursByDayName(toWeeklyHours([{ weekday: 1, opensAt: 750, closesAt: 1290 }]))
        .Tuesday,
    ).toBeNull()
  })

  it.each([
    [0, "12:00 AM"],
    [720, "12:00 PM"],
    [750, "12:30 PM"],
    [1290, "9:30 PM"],
    [1439, "11:59 PM"],
  ])("formats %i minutes as %s", (minutes, label) => {
    expect(formatStoreTime(minutes)).toBe(label)
  })

  it("reads the weekday on the Auckland clock", () => {
    // 11:30 PM Sunday in Auckland is still Sunday, though it is Sunday morning in UTC.
    expect(nzWeekday(new Date("2026-03-08T23:30:00+13:00"))).toBe(0)
    // 12:30 AM Monday in Auckland is still Sunday in UTC.
    expect(nzWeekday(new Date("2026-03-09T00:30:00+13:00"))).toBe(1)
  })
})
