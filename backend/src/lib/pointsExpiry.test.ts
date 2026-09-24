import { describe, expect, it } from "vitest"

import { expiryAnchor, NO_ACTIVITY, pointsExpireAt } from "./pointsExpiry"
import { nzEndOfDayMonthsAfter } from "./tradingHours"

/**
 * When Sweet Points expire. Pure, so every rule is pinned here with fixed instants, and the
 * integration suite only has to prove the sweep and the warning obey it.
 *
 * Auckland is UTC+13 in daylight saving (late September to early April) and UTC+12 outside
 * it, so each expected instant below is the last millisecond of an Auckland day written in
 * UTC. The host runs UTC; a calendar worked out in its zone lands on the wrong day.
 */
describe("nzEndOfDayMonthsAfter", () => {
  it("ends at the last instant of the same Auckland day a month on", () => {
    // 3pm on 15 October in Auckland.
    expect(
      nzEndOfDayMonthsAfter(new Date("2026-10-15T02:00:00.000Z"), 1).toISOString(),
    ).toBe("2026-11-15T10:59:59.999Z")
  })

  /** 9am on 15 October in Auckland is still the 14th in UTC. The day is Auckland's. */
  it("counts from the Auckland day, not the UTC one", () => {
    expect(
      nzEndOfDayMonthsAfter(new Date("2026-10-14T20:00:00.000Z"), 1).toISOString(),
    ).toBe("2026-11-15T10:59:59.999Z")
  })

  it("clamps to the end of a shorter month rather than overflowing into the next", () => {
    expect(
      nzEndOfDayMonthsAfter(new Date("2027-01-31T02:00:00.000Z"), 1).toISOString(),
    ).toBe("2027-02-28T10:59:59.999Z")
    // A leap year.
    expect(
      nzEndOfDayMonthsAfter(new Date("2028-01-31T02:00:00.000Z"), 1).toISOString(),
    ).toBe("2028-02-29T10:59:59.999Z")
  })

  /** From NZST (+12) into NZDT (+13): the day still ends at Auckland midnight. */
  it("crosses the start of daylight saving", () => {
    expect(
      nzEndOfDayMonthsAfter(new Date("2026-09-10T00:00:00.000Z"), 1).toISOString(),
    ).toBe("2026-10-10T10:59:59.999Z")
  })

  it("crosses the end of daylight saving", () => {
    expect(
      nzEndOfDayMonthsAfter(new Date("2026-03-20T00:00:00.000Z"), 1).toISOString(),
    ).toBe("2026-04-20T11:59:59.999Z")
  })

  it("wraps the year", () => {
    expect(
      nzEndOfDayMonthsAfter(new Date("2026-12-20T02:00:00.000Z"), 1).toISOString(),
    ).toBe("2027-01-20T10:59:59.999Z")
  })
})

describe("pointsExpireAt", () => {
  const switchedOn = new Date("2026-10-01T02:00:00.000Z") // 3pm 1 October, Auckland
  const now = new Date("2026-10-20T02:00:00.000Z")
  const endOfDay = (iso: string) => new Date(iso).toISOString()

  it("never expires anything while expiry is switched off", () => {
    expect(pointsExpireAt(NO_ACTIVITY, null, now)).toBeNull()
    expect(
      pointsExpireAt(
        { lastOrderAt: new Date("2020-01-01T00:00:00.000Z"), membership: null },
        null,
        now,
      ),
    ).toBeNull()
  })

  /**
   * The launch grace. Nobody's month is counted from before the switch went on, so a
   * customer who last ordered in August still gets a full month from the day it did.
   */
  it("counts from the switch for a customer who last ordered before it", () => {
    const deadline = pointsExpireAt(
      { lastOrderAt: new Date("2026-08-01T02:00:00.000Z"), membership: null },
      switchedOn,
      now,
    )
    expect(deadline?.toISOString()).toBe(endOfDay("2026-11-01T10:59:59.999Z"))
  })

  it("counts from the last app order when that is later", () => {
    const deadline = pointsExpireAt(
      { lastOrderAt: new Date("2026-10-12T02:00:00.000Z"), membership: null },
      switchedOn,
      now,
    )
    expect(deadline?.toISOString()).toBe("2026-11-12T10:59:59.999Z")
  })

  it("never expires an active member's points", () => {
    expect(
      pointsExpireAt(
        {
          lastOrderAt: null,
          membership: { endDate: new Date("2026-11-05T00:00:00.000Z"), isMember: true },
        },
        switchedOn,
        now,
      ),
    ).toBeNull()
  })

  /** A member who lapses gets a full month from losing it, not from an old order. */
  it("counts from the end of a membership that has ended", () => {
    const deadline = pointsExpireAt(
      {
        lastOrderAt: new Date("2026-10-02T02:00:00.000Z"),
        membership: { endDate: new Date("2026-10-15T02:00:00.000Z"), isMember: false },
      },
      switchedOn,
      now,
    )
    expect(deadline?.toISOString()).toBe("2026-11-15T10:59:59.999Z")
  })

  /**
   * `createMembership` writes an end date a month ahead before the first payment is
   * attempted. A join that never paid must not buy the customer an extra month.
   */
  it("ignores the future end date of a join that never paid", () => {
    const deadline = pointsExpireAt(
      {
        lastOrderAt: null,
        membership: { endDate: new Date("2026-11-18T02:00:00.000Z"), isMember: false },
      },
      switchedOn,
      now,
    )
    expect(deadline?.toISOString()).toBe("2026-11-01T10:59:59.999Z")
  })

  it("names the anchor it counted from", () => {
    const lastOrderAt = new Date("2026-10-12T02:00:00.000Z")
    expect(
      expiryAnchor({ lastOrderAt, membership: null }, switchedOn, now)?.toISOString(),
    ).toBe(lastOrderAt.toISOString())
    expect(expiryAnchor(NO_ACTIVITY, switchedOn, now)?.toISOString()).toBe(
      switchedOn.toISOString(),
    )
  })
})
