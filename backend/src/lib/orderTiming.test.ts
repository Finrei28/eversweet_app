import { describe, expect, it } from "vitest"
import {
  alertLeadMinutes,
  countItems,
  dueAt,
  isDue,
  prepMinutes,
  quoteMinutes,
} from "./orderTiming"
import { DEFAULT_PREP_TIMES, type PrepTimes } from "./prepTimes"

const at = (iso: string) => new Date(`2026-03-02T${iso}+13:00`)

/** A shop that makes things faster and promises sooner than the defaults. */
const fastShop: PrepTimes = {
  singleItem: 2,
  upToThree: 4,
  upToSix: 6,
  moreThanSix: 8,
  kitchenSlack: 0,
  quoteFloor: 3,
}

const order = (quantities: number[], pickUpTime: Date) => ({
  pickUpTime,
  desserts: quantities.map((quantity) => ({ quantity })),
})

describe("alertLeadMinutes", () => {
  it("uses the tighter single-item lead", () => {
    expect(alertLeadMinutes(1)).toBe(6)
  })

  it("steps at three, six and beyond", () => {
    expect(alertLeadMinutes(2)).toBe(11)
    expect(alertLeadMinutes(3)).toBe(11)
    expect(alertLeadMinutes(4)).toBe(16)
    expect(alertLeadMinutes(6)).toBe(16)
    expect(alertLeadMinutes(7)).toBe(21)
    expect(alertLeadMinutes(50)).toBe(21)
  })

  // An empty order should not fall through to the longest lead: it would sit
  // on the kitchen screen 21 minutes before a pick-up with nothing to make.
  it("treats an empty order as the smallest", () => {
    expect(alertLeadMinutes(0)).toBe(6)
  })

  it("follows the shop's own settings", () => {
    // prep + slack, with slack at zero.
    expect(alertLeadMinutes(1, fastShop)).toBe(2)
    expect(alertLeadMinutes(5, fastShop)).toBe(6)
  })
})

describe("quoteMinutes", () => {
  /**
   * The floor is the whole point: a single dessert takes five minutes but the
   * customer is still promised ten. The buffer absorbs a queue or a busy till,
   * and the mobile app used to skip it entirely — quoting six minutes, the
   * exact moment the kitchen was told to start, with nothing in hand.
   */
  it("never promises sooner than the floor", () => {
    expect(prepMinutes(1)).toBe(5)
    expect(quoteMinutes(1)).toBe(10)
  })

  it("uses the preparation time once it exceeds the floor", () => {
    expect(quoteMinutes(2)).toBe(10)
    expect(quoteMinutes(4)).toBe(15)
    expect(quoteMinutes(7)).toBe(20)
  })

  // The website's existing quotes, which must not move.
  it("matches what the website already offers", () => {
    expect([1, 2, 3].map((n) => quoteMinutes(n))).toEqual([10, 10, 10])
    expect([4, 5, 6].map((n) => quoteMinutes(n))).toEqual([15, 15, 15])
    expect(quoteMinutes(20)).toBe(20)
  })

  it("follows the shop's own settings", () => {
    expect(quoteMinutes(1, fastShop)).toBe(3) // floored
    expect(quoteMinutes(5, fastShop)).toBe(6) // above the floor
  })
})

describe("the defaults", () => {
  // A regression guard on the numbers themselves. These reproduce the
  // behaviour that was hardcoded before the settings table existed, and a
  // change to them changes how the shop runs.
  it("reproduce the previously hardcoded leads", () => {
    expect(
      [1, 2, 3, 4, 6, 7, 20].map((n) =>
        alertLeadMinutes(n, DEFAULT_PREP_TIMES),
      ),
    ).toEqual([6, 11, 11, 16, 16, 21, 21])
  })
})

describe("countItems", () => {
  it("counts quantities, not lines", () => {
    expect(countItems([{ quantity: 3 }, { quantity: 4 }])).toBe(7)
  })
})

describe("dueAt", () => {
  it("subtracts the lead for the order's size", () => {
    // Four items -> 16 minutes.
    expect(dueAt(order([2, 2], at("18:00:00")))).toEqual(at("17:44:00"))
  })

  it("returns null for an unusable pick-up time", () => {
    expect(dueAt(order([1], new Date("not a date")))).toBeNull()
  })
})

describe("isDue", () => {
  it("is due at exactly the lead boundary", () => {
    expect(isDue(order([1], at("18:00:00")), at("17:54:00"))).toBe(true)
  })

  it("is not due a second early", () => {
    expect(isDue(order([1], at("18:00:00")), at("17:53:59"))).toBe(false)
  })

  // The dangerous direction: a bad date must not read as "not yet", which
  // would withhold the order forever rather than surfacing a problem.
  it("is never due when the pick-up time is unusable", () => {
    expect(isDue(order([1], new Date("not a date")), at("18:00:00"))).toBe(false)
  })
})
