import { describe, expect, it } from "vitest"
import { checkPickUpTime, LAST_ORDER_OFFSET_MINUTES } from "./tradingHours"

/**
 * A Monday, when the store trades 12:30 PM to 9:30 PM. Times are written with
 * an explicit +13:00 (New Zealand daylight time in March) so a test never
 * depends on the timezone of the machine running it.
 */
const nz = (time: string) => new Date(`2026-03-02T${time}+13:00`)

const MONDAY_NOON = nz("12:00:00")
const noDaysOff = new Set<string>()

const check = (pickUpTime: Date, over: Partial<Parameters<typeof checkPickUpTime>[1]> = {}) =>
  checkPickUpTime(pickUpTime, {
    eatIn: false,
    daysOffKeys: noDaysOff,
    now: MONDAY_NOON,
    ...over,
  })

describe("checkPickUpTime", () => {
  it("accepts a slot inside trading hours", () => {
    expect(check(nz("18:00:00"))).toEqual({ ok: true })
  })

  it("rejects an unparseable date rather than treating it as midnight", () => {
    const result = check(new Date("not a date"))
    expect(result).toEqual({
      ok: false,
      message: "That pick up time is not a valid date.",
    })
  })

  it("rejects a slot before opening", () => {
    // `now` is moved back so 11:00 is still ahead: a slot in the past is
    // refused by an earlier rule, and this is testing the hours check.
    expect(check(nz("11:00:00"), { now: nz("10:00:00") })).toEqual({
      ok: false,
      message: "We are closed at that time.",
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
    })

    it("refuses a pickup order a minute past the cutoff", () => {
      expect(check(nz("21:21:00"))).toEqual({
        ok: false,
        message: "We are closed at that time.",
      })
    })

    it("closes eat-in earlier than pickup for the same slot", () => {
      const eatInCutoff = close - LAST_ORDER_OFFSET_MINUTES.eatIn // 9:00 PM
      expect(eatInCutoff).toBe(21 * 60)

      // 9:10 PM: fine to collect, too late to sit in.
      expect(check(nz("21:10:00"), { eatIn: false })).toEqual({ ok: true })
      expect(check(nz("21:10:00"), { eatIn: true })).toEqual({
        ok: false,
        message: "We are closed at that time.",
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
        message: "That pick up time has already passed.",
      })
    })
  })

  it("rejects a slot further ahead than the app's picker allows", () => {
    const farFuture = new Date(MONDAY_NOON.getTime() + 60 * 24 * 60 * 60 * 1000)
    expect(check(farFuture)).toEqual({
      ok: false,
      message: "Orders can only be placed up to a month in advance.",
    })
  })

  it("rejects a day the store has marked off", () => {
    expect(
      check(nz("18:00:00"), { daysOffKeys: new Set(["2026-03-02"]) }),
    ).toEqual({ ok: false, message: "We are closed on that date." })
  })

  it("matches a day off against the New Zealand calendar day, not UTC", () => {
    // 9:00 AM NZ on the 3rd is still the 2nd in UTC. Keying off UTC would let
    // an order through on a day the store told the system it was closed.
    const earlyTuesday = new Date("2026-03-03T09:00:00+13:00")
    expect(earlyTuesday.toISOString().slice(0, 10)).toBe("2026-03-02")

    expect(
      checkPickUpTime(earlyTuesday, {
        eatIn: false,
        daysOffKeys: new Set(["2026-03-03"]),
        now: MONDAY_NOON,
      }),
    ).toEqual({ ok: false, message: "We are closed on that date." })
  })

  it("uses each day's own hours", () => {
    // Friday opens at noon and closes at 10 PM, half an hour later than Monday.
    const friday = new Date("2026-03-06T21:45:00+13:00")
    expect(
      checkPickUpTime(friday, {
        eatIn: false,
        daysOffKeys: noDaysOff,
        now: MONDAY_NOON,
      }),
    ).toEqual({ ok: true })

    // The same clock time on a Monday is past last orders.
    expect(check(nz("21:45:00"))).toEqual({
      ok: false,
      message: "We are closed at that time.",
    })
  })
})
