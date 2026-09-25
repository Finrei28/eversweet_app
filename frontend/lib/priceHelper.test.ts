import {
  calculateBestDiscountedPrice,
  calculatePriceAfterPromo,
  isPromoLive,
} from "./priceHelper"
import { Dessert } from "@/utils/types"

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
