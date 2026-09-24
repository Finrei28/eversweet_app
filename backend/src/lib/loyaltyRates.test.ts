import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }))

vi.mock("./db", () => ({ db: { loyaltySetting: { findFirst } } }))

import {
  DEFAULT_LOYALTY_RATES,
  getLoyaltyRates,
  invalidateLoyaltyRates,
  pointsForLine,
} from "./loyaltyRates"

/** The seeded row: the rates that used to be hardcoded. */
const seeded = {
  pointsPerDollar: 6,
  memberBonusPercent: 150,
  modifierPercent: 100,
}

beforeEach(() => {
  findFirst.mockReset()
  invalidateLoyaltyRates()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  invalidateLoyaltyRates()
  vi.restoreAllMocks()
})

describe("getLoyaltyRates", () => {
  /**
   * The wire shape `/api/getLoyaltyRates` has always served. Installed builds read these
   * three keys by name and compute the cart's points preview from them, so the conversion
   * from whole numbers happens here and never reaches the app.
   */
  it("serves the stored whole numbers in the shape installed builds parse", async () => {
    findFirst.mockResolvedValue(seeded)

    await expect(getLoyaltyRates()).resolves.toEqual({
      rate: 6,
      memberRate: 1.5,
      modifier: 1,
    })
  })

  /**
   * The seeded row must reproduce the constants exactly. If this fails, the migration
   * changed what a customer earns, which it is explicitly not supposed to do.
   */
  it("reads the seeded row as exactly the rates that were hardcoded", async () => {
    findFirst.mockResolvedValue(seeded)

    await expect(getLoyaltyRates()).resolves.toEqual(DEFAULT_LOYALTY_RATES)
  })

  it("converts a promotion to a multiplier", async () => {
    findFirst.mockResolvedValue({ ...seeded, modifierPercent: 200 })

    await expect(getLoyaltyRates()).resolves.toMatchObject({ modifier: 2 })
  })

  // Deploying the table before seeding it must behave exactly as before.
  it("falls back to the defaults when the table is empty", async () => {
    findFirst.mockResolvedValue(null)

    await expect(getLoyaltyRates()).resolves.toEqual(DEFAULT_LOYALTY_RATES)
  })

  /**
   * This sits on the order path, inside `createOrder`. A settings table being unreachable
   * must never cost a customer their points, and must never fail an order.
   */
  it("falls back to the defaults when the database is unreachable", async () => {
    findFirst.mockRejectedValue(new Error("connection terminated"))

    await expect(getLoyaltyRates()).resolves.toEqual(DEFAULT_LOYALTY_RATES)
  })

  it("caches rather than reading once per order", async () => {
    findFirst.mockResolvedValue(seeded)

    await getLoyaltyRates()
    await getLoyaltyRates()
    await getLoyaltyRates()

    expect(findFirst).toHaveBeenCalledTimes(1)
  })

  // A transient failure must not pin the defaults in place for the whole TTL.
  it("does not cache a failure", async () => {
    findFirst.mockRejectedValueOnce(new Error("connection terminated"))
    await expect(getLoyaltyRates()).resolves.toEqual(DEFAULT_LOYALTY_RATES)

    findFirst.mockResolvedValue({ ...seeded, pointsPerDollar: 9 })
    await expect(getLoyaltyRates()).resolves.toMatchObject({ rate: 9 })
  })

  it("re-reads once invalidated, so a saved change takes effect", async () => {
    findFirst.mockResolvedValue(seeded)
    await getLoyaltyRates()

    invalidateLoyaltyRates()
    findFirst.mockResolvedValue({ ...seeded, pointsPerDollar: 8 })

    await expect(getLoyaltyRates()).resolves.toMatchObject({ rate: 8 })
    expect(findFirst).toHaveBeenCalledTimes(2)
  })
})

/**
 * The calculation `createOrder` ran inline, with the rates read from constants:
 *
 *   floor((netCents / 100) * rate * quantity * (member ? modifier * memberRate : modifier))
 *
 * Reproduced here from the old constants so the table-backed path can be held against it.
 * There was no test over this at all before, which is how the app's own copy drifted to a
 * different fallback rate without anyone noticing.
 */
const pointsTheOldWay = (
  netCents: number,
  quantity: number,
  isMember: boolean,
) =>
  Math.floor(
    (netCents / 100) *
      6 *
      quantity *
      (isMember ? 1 * 1.5 : 1),
  )

describe("pointsForLine", () => {
  /**
   * The load-bearing one. 150/100 is exactly 1.5 in IEEE 754, so storing whole percent and
   * dividing cannot move a floor boundary — but that is an argument, and this is the check.
   */
  it("earns exactly what the hardcoded rates earned", () => {
    const prices = [0, 1, 49, 50, 99, 100, 101, 333, 999, 1000, 1234, 9999, 100000]
    const quantities = [1, 2, 3, 7]

    for (const netCents of prices) {
      for (const quantity of quantities) {
        for (const isMember of [false, true]) {
          expect(
            pointsForLine(netCents, quantity, isMember, DEFAULT_LOYALTY_RATES),
          ).toBe(pointsTheOldWay(netCents, quantity, isMember))
        }
      }
    }
  })

  it("gives a member half as much again", () => {
    expect(pointsForLine(1000, 1, false, DEFAULT_LOYALTY_RATES)).toBe(60)
    expect(pointsForLine(1000, 1, true, DEFAULT_LOYALTY_RATES)).toBe(90)
  })

  /**
   * Zero is reachable on a very small line once the per-dollar rate is floored, and
   * `createOrder` skips a zero rather than calling the helper, which treats it as a
   * programming error and would roll the whole order back.
   */
  it("floors a line too small to earn anything to zero", () => {
    expect(pointsForLine(16, 1, false, DEFAULT_LOYALTY_RATES)).toBe(0)
  })

  it("applies a promotion multiplier to members and non-members alike", () => {
    const doublePoints = { rate: 6, memberRate: 1.5, modifier: 2 }

    expect(pointsForLine(1000, 1, false, doublePoints)).toBe(120)
    expect(pointsForLine(1000, 1, true, doublePoints)).toBe(180)
  })
})
