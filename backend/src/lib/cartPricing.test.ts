import { describe, expect, it } from "vitest"
import {
  calculateCartPrice,
  gstFromInclusive,
  type PricedCartItem,
} from "./cartPricing"

const line = (over: Partial<PricedCartItem> = {}): PricedCartItem => ({
  quantity: 1,
  itemPriceInCents: 1200,
  discountedAmountInCents: 0,
  customisations: [],
  ...over,
})

describe("gstFromInclusive", () => {
  it("extracts the GST already inside a price rather than adding it on top", () => {
    // $23.00 inclusive contains $3.00 of GST, because $20.00 x 1.15 = $23.00.
    // Multiplying by 15% would give $3.45 and overstate the tax on every order.
    expect(gstFromInclusive(2300)).toBe(300)
  })

  it("rounds to whole cents, since Order.GST is an integer column", () => {
    expect(gstFromInclusive(1000)).toBe(130) // 1000 x 3 / 23 = 130.43…
    expect(Number.isInteger(gstFromInclusive(999))).toBe(true)
  })

  it("returns nothing for a free order", () => {
    expect(gstFromInclusive(0)).toBe(0)
  })
})

describe("calculateCartPrice", () => {
  it("returns zeroes for an empty cart", () => {
    expect(calculateCartPrice([])).toEqual({
      beforeDiscountInCents: 0,
      discountInCents: 0,
      payableInCents: 0,
      gstInCents: 0,
    })
  })

  it("multiplies price and discount by the line quantity", () => {
    const price = calculateCartPrice([
      line({ quantity: 3, itemPriceInCents: 1200, discountedAmountInCents: 200 }),
    ])

    expect(price.beforeDiscountInCents).toBe(3600)
    expect(price.discountInCents).toBe(600)
    expect(price.payableInCents).toBe(3000)
  })

  it("charges for customisations at their own quantity", () => {
    const price = calculateCartPrice([
      line({
        quantity: 2,
        itemPriceInCents: 1000,
        customisations: [
          {
            quantity: 3,
            discountedAmountInCents: 0,
            customisation: { priceInCents: 100 },
          },
        ],
      }),
    ])

    // (1000 + 3 x 100) x 2
    expect(price.beforeDiscountInCents).toBe(2600)
  })

  it("ignores a customisation at quantity zero", () => {
    // Zero means the customer removed an ingredient the dessert normally
    // includes. There is nothing to charge, and nothing to discount either.
    const price = calculateCartPrice([
      line({
        itemPriceInCents: 1000,
        customisations: [
          {
            quantity: 0,
            discountedAmountInCents: 50,
            customisation: { priceInCents: 100 },
          },
        ],
      }),
    ])

    expect(price.beforeDiscountInCents).toBe(1000)
    expect(price.discountInCents).toBe(0)
  })

  it("never treats a negative customisation quantity as a credit", () => {
    const price = calculateCartPrice([
      line({
        itemPriceInCents: 1000,
        customisations: [
          {
            quantity: -2,
            discountedAmountInCents: 0,
            customisation: { priceInCents: 100 },
          },
        ],
      }),
    ])

    expect(price.beforeDiscountInCents).toBe(1000)
  })

  it("discounts customisations alongside the dessert", () => {
    const price = calculateCartPrice([
      line({
        quantity: 2,
        itemPriceInCents: 1000,
        discountedAmountInCents: 100,
        customisations: [
          {
            quantity: 2,
            discountedAmountInCents: 25,
            customisation: { priceInCents: 200 },
          },
        ],
      }),
    ])

    expect(price.beforeDiscountInCents).toBe(2800) // (1000 + 400) x 2
    expect(price.discountInCents).toBe(300) //        (100 + 50) x 2
    expect(price.payableInCents).toBe(2500)
  })

  it("sums independent lines", () => {
    const price = calculateCartPrice([
      line({ itemPriceInCents: 1200 }),
      line({ itemPriceInCents: 800, quantity: 2 }),
    ])

    expect(price.payableInCents).toBe(2800)
  })

  it("keeps GST consistent with what is actually payable", () => {
    const price = calculateCartPrice([
      line({ itemPriceInCents: 2300, discountedAmountInCents: 1150 }),
    ])

    expect(price.payableInCents).toBe(1150)
    // The tax follows the discounted total, not the list price.
    expect(price.gstInCents).toBe(gstFromInclusive(1150))
    expect(price.gstInCents).not.toBe(gstFromInclusive(2300))
  })

  it("can price a cart fully covered by a discount", () => {
    const price = calculateCartPrice([
      line({ itemPriceInCents: 1200, discountedAmountInCents: 1200 }),
    ])

    expect(price.payableInCents).toBe(0)
    expect(price.gstInCents).toBe(0)
  })
})
