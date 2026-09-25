import { describe, expect, it } from "vitest"

import {
  customisationDiscountInCents,
  isPaidUpMember,
  isPromoLive,
  lineDiscountInCents,
  type LineForRepricing,
  builtUpDiscountPercent,
  memberDiscountPercent,
  staleDiscounts,
} from "./memberPricing"

const PLAN = { maxDiscount: 25, membershipDiscount: 5 }
const NOW = new Date("2026-09-25T02:00:00Z")
const HOUR = 60 * 60 * 1000

const member = (overrides: Partial<{ isActive: boolean; paymentStatus: string; totalMonths: number }> = {}) => ({
  isActive: true,
  paymentStatus: "SUCCESS",
  totalMonths: 1,
  plan: PLAN,
  ...overrides,
})

const promo = (overrides: Record<string, unknown> = {}) => ({
  type: "PERCENTAGE" as "PERCENTAGE" | "FIXED_AMOUNT",
  value: 20,
  isActive: true,
  startsAt: null as Date | null,
  endsAt: null as Date | null,
  ...overrides,
})

describe("isPaidUpMember", () => {
  it("is a running subscription that is paid up", () => {
    expect(isPaidUpMember(member())).toBe(true)
  })

  it("is not a membership on hold while a declined renewal is retried", () => {
    expect(isPaidUpMember(member({ paymentStatus: "PENDING" }))).toBe(false)
  })

  it("is not a membership that has ended or never started", () => {
    expect(isPaidUpMember(member({ isActive: false }))).toBe(false)
    expect(isPaidUpMember(member({ isActive: false, paymentStatus: "FAILED" }))).toBe(false)
    expect(isPaidUpMember(null)).toBe(false)
  })
})

describe("memberDiscountPercent", () => {
  it("grows a step for each month paid in a row, up to the cap", () => {
    expect(memberDiscountPercent(member({ totalMonths: 1 }))).toBe(5)
    expect(memberDiscountPercent(member({ totalMonths: 3 }))).toBe(15)
    expect(memberDiscountPercent(member({ totalMonths: 12 }))).toBe(25)
  })

  it("is nothing while the membership is on hold, whatever the run", () => {
    expect(
      memberDiscountPercent(member({ paymentStatus: "PENDING", totalMonths: 4 })),
    ).toBe(0)
  })

  it("is nothing for a membership that has ended", () => {
    expect(memberDiscountPercent(member({ isActive: false, totalMonths: 4 }))).toBe(0)
  })

  it("gives a paid-up member at least the first step", () => {
    expect(memberDiscountPercent(member({ totalMonths: 0 }))).toBe(5)
  })
})

/**
 * What a member stands to lose, which the warnings quote. Unlike the discount given, it does
 * not drop to nothing on hold: that is exactly when the member needs to hear the number.
 */
describe("builtUpDiscountPercent", () => {
  it("is the run's discount whether or not it is being given", () => {
    expect(builtUpDiscountPercent(member({ totalMonths: 4 }))).toBe(20)
    expect(
      builtUpDiscountPercent(member({ paymentStatus: "PENDING", totalMonths: 4 })),
    ).toBe(20)
  })

  it("stops at the cap and starts at the first step", () => {
    expect(builtUpDiscountPercent(member({ totalMonths: 9 }))).toBe(25)
    expect(builtUpDiscountPercent(member({ totalMonths: 0 }))).toBe(5)
  })
})

describe("isPromoLive", () => {
  it("honours the switch", () => {
    expect(isPromoLive(promo({ isActive: false }), NOW)).toBe(false)
  })

  it("is inclusive at both ends of the window", () => {
    expect(isPromoLive(promo({ startsAt: NOW, endsAt: NOW }), NOW)).toBe(true)
  })

  it("is not live before it starts or after it ends", () => {
    expect(
      isPromoLive(promo({ startsAt: new Date(NOW.getTime() + HOUR) }), NOW),
    ).toBe(false)
    expect(
      isPromoLive(promo({ endsAt: new Date(NOW.getTime() - HOUR) }), NOW),
    ).toBe(false)
  })
})

describe("lineDiscountInCents", () => {
  const price = (overrides: Partial<Parameters<typeof lineDiscountInCents>[0]> = {}) =>
    lineDiscountInCents({
      priceBeforeDiscountInCents: 1200,
      isReward: false,
      promo: null,
      memberPercent: 0,
      now: NOW,
      ...overrides,
    })

  it("takes the better of the member discount and a running promotion, never both", () => {
    expect(price({ memberPercent: 10, promo: promo({ value: 20 }) })).toBe(240)
    expect(price({ memberPercent: 25, promo: promo({ value: 20 }) })).toBe(300)
  })

  it("ignores a promotion that has been switched off or has ended", () => {
    expect(price({ promo: promo({ isActive: false }) })).toBe(0)
    expect(
      price({ promo: promo({ endsAt: new Date(NOW.getTime() - HOUR) }) }),
    ).toBe(0)
  })

  it("never takes more than the price for a fixed-amount promotion", () => {
    expect(
      price({
        priceBeforeDiscountInCents: 300,
        promo: promo({ type: "FIXED_AMOUNT", value: 500 }),
      }),
    ).toBe(300)
  })

  it("does not discount a reward again", () => {
    expect(price({ isReward: true, memberPercent: 25, promo: promo() })).toBe(0)
  })

  it("comes out in whole cents", () => {
    expect(Number.isInteger(price({ priceBeforeDiscountInCents: 999, memberPercent: 5 }))).toBe(true)
  })
})

describe("customisationDiscountInCents", () => {
  it("comes out in whole cents, which the column requires", () => {
    // 150c at 5% is 7.5c: the value that used to reach an Int column.
    expect(customisationDiscountInCents(150, 1, 5)).toBe(8)
  })

  it("is nothing for a removed ingredient", () => {
    expect(customisationDiscountInCents(150, 0, 5)).toBe(0)
  })
})

describe("staleDiscounts", () => {
  const line = (overrides: Partial<LineForRepricing> = {}): LineForRepricing => ({
    id: "line",
    itemPriceInCents: 1200,
    discountedAmountInCents: 0,
    loyaltyPointsUsed: null,
    offerId: null,
    dessert: { promo: null },
    customisations: [
      {
        id: "topping",
        quantity: 1,
        discountedAmountInCents: 0,
        customisation: { priceInCents: 200 },
      },
    ],
    ...overrides,
  })

  it("finds a line and its customisations priced before the customer joined", () => {
    expect(staleDiscounts([line()], member({ totalMonths: 2 }), NOW)).toEqual({
      lines: [{ id: "line", itemPriceInCents: 1200, discountedAmountInCents: 120 }],
      customisations: [{ id: "topping", discountedAmountInCents: 20 }],
    })
  })

  it("takes member prices off once the membership is on hold", () => {
    const priced = line({
      discountedAmountInCents: 60,
      customisations: [
        { id: "topping", quantity: 1, discountedAmountInCents: 10, customisation: { priceInCents: 200 } },
      ],
    })
    expect(staleDiscounts([priced], member({ paymentStatus: "PENDING" }), NOW)).toEqual({
      lines: [{ id: "line", itemPriceInCents: 1200, discountedAmountInCents: 0 }],
      customisations: [{ id: "topping", discountedAmountInCents: 0 }],
    })
  })

  it("keeps a promotion's price when the membership goes", () => {
    const promoted = line({
      discountedAmountInCents: 240,
      dessert: { promo: promo({ value: 20 }) },
      customisations: [],
    })
    expect(staleDiscounts([promoted], null, NOW).lines).toEqual([])
  })

  it("leaves an offer's own price alone, but reprices its customisations", () => {
    const offerLine = line({ offerId: "offer", discountedAmountInCents: 700 })
    const found = staleDiscounts([offerLine], member(), NOW)
    expect(found.lines).toEqual([])
    expect(found.customisations).toEqual([{ id: "topping", discountedAmountInCents: 10 }])
  })

  it("never discounts a reward's dessert", () => {
    const reward = line({ itemPriceInCents: 0, loyaltyPointsUsed: 500, customisations: [] })
    expect(staleDiscounts([reward], member(), NOW).lines).toEqual([])
  })

  it("finds nothing when the cart is already right", () => {
    const right = line({
      discountedAmountInCents: 60,
      customisations: [
        { id: "topping", quantity: 1, discountedAmountInCents: 10, customisation: { priceInCents: 200 } },
      ],
    })
    expect(staleDiscounts([right], member(), NOW)).toEqual({ lines: [], customisations: [] })
  })
})
