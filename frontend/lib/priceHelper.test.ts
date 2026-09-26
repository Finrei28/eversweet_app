import {
  appliedDiscount,
  calculateBestDiscountedPrice,
  calculatePriceAfterPromo,
  isPromoLive,
} from "./priceHelper"
import { Dessert, UsersMembership } from "@/utils/types"

const START = new Date("2026-10-01T00:00:00.000Z")
const END = new Date("2026-10-31T10:59:59.999Z")

const promo = (overrides: Partial<NonNullable<Dessert["promo"]>> = {}) => ({
  id: "promo",
  name: "Spring",
  type: "PERCENTAGE" as const,
  value: 20,
  isActive: true,
  startsAt: START,
  endsAt: END,
  ...overrides,
})

// Only the fields the price helpers read.
const dessert = (p: Dessert["promo"]) =>
  ({ priceInCents: 1000, promo: p }) as unknown as Dessert

/**
 * The window is the server's `isPromoLive`: both ends inclusive, no date meaning no bound. The
 * app treated the end as exclusive, so at that instant it showed the full price for a line the
 * server still discounted.
 */
describe("isPromoLive", () => {
  it("runs at the very instant it ends, as the server has it", () => {
    expect(isPromoLive(promo(), END)).toBe(true)
    expect(isPromoLive(promo(), new Date(END.getTime() + 1))).toBe(false)
  })

  it("runs from the very instant it starts", () => {
    expect(isPromoLive(promo(), START)).toBe(true)
    expect(isPromoLive(promo(), new Date(START.getTime() - 1))).toBe(false)
  })

  it("has no bound where there is no date", () => {
    const openEnded = promo({ startsAt: null, endsAt: null })
    expect(isPromoLive(openEnded, new Date("2020-01-01T00:00:00Z"))).toBe(true)
    expect(isPromoLive(openEnded, new Date("2040-01-01T00:00:00Z"))).toBe(true)
  })

  it("is never live switched off, or when there is none", () => {
    expect(isPromoLive(promo({ isActive: false }), END)).toBe(false)
    expect(isPromoLive(null, END)).toBe(false)
  })

  /** What arrives over the wire, whatever the type says. */
  it("reads dates sent as strings", () => {
    const fromJson = promo({
      startsAt: START.toISOString() as unknown as Date,
      endsAt: END.toISOString() as unknown as Date,
    })
    expect(isPromoLive(fromJson, END)).toBe(true)
    expect(isPromoLive(fromJson, new Date(END.getTime() + 1))).toBe(false)
  })
})

describe("promotion prices", () => {
  it("are charged up to and including the last instant", () => {
    expect(calculatePriceAfterPromo(dessert(promo()), END)).toBe(800)
    expect(calculateBestDiscountedPrice(dessert(promo()), null, undefined, END)).toBe(800)
  })

  it("are gone a moment after it ends", () => {
    const after = new Date(END.getTime() + 1)
    expect(calculatePriceAfterPromo(dessert(promo()), after)).toBe(1000)
    expect(calculateBestDiscountedPrice(dessert(promo()), null, undefined, after)).toBe(1000)
  })

  it("take no more than the price off a fixed amount", () => {
    expect(
      calculatePriceAfterPromo(dessert(promo({ type: "FIXED_AMOUNT", value: 1500 })), END),
    ).toBe(0)
  })
})

// Only the fields the membership helpers read: a 5% step, capped at 25%.
const member = (
  totalMonths: number,
  paymentStatus: UsersMembership["paymentStatus"] = "SUCCESS",
) =>
  ({
    isActive: true,
    paymentStatus,
    totalMonths,
    plan: { membershipDiscount: 5, maxDiscount: 25 },
  }) as unknown as UsersMembership

/**
 * The label on a price names the discount the server will take - the better of the two, never
 * both. The card asked `promo.isActive` alone, so an ended promotion struck the price through
 * over a price nothing had come off.
 */
describe("appliedDiscount", () => {
  it("is nothing once the promotion has ended, whatever its switch says", () => {
    const after = new Date(END.getTime() + 1)
    expect(appliedDiscount(dessert(promo()), null, after)).toBeNull()
  })

  it("is nothing for a dessert with no promotion and no member", () => {
    expect(appliedDiscount(dessert(null), null, END)).toBeNull()
  })

  it("is the promotion when it beats the member discount", () => {
    // 20% promotion against a 10% member step.
    expect(appliedDiscount(dessert(promo()), member(2), END)).toBe("promo")
  })

  it("is the member discount when it beats the promotion", () => {
    // 25% member cap against the 20% promotion.
    expect(appliedDiscount(dessert(promo()), member(9), END)).toBe("member")
  })

  it("is the member discount on a tie", () => {
    expect(appliedDiscount(dessert(promo()), member(4), END)).toBe("member")
  })

  it("leaves the promotion to a member on hold, who is given no member price", () => {
    expect(appliedDiscount(dessert(promo()), member(9, "PENDING"), END)).toBe("promo")
    expect(appliedDiscount(dessert(null), member(9, "PENDING"), END)).toBeNull()
  })
})
