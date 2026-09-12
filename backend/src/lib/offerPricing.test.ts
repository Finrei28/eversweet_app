import { describe, expect, it } from "vitest"

import { offerUnitPriceInCents } from "./offerPricing"

/**
 * `discountAmount` went from a Decimal fraction to an Int whole percent on 2026-09-12 and
 * nothing tested it either way, so the mispricing would have shipped green. These pin the
 * unit itself, and the two rules the column carries: fixed price wins, and a stored 0 is a
 * real price rather than an absent one.
 */
describe("offerUnitPriceInCents", () => {
  const dessert = { priceInCents: 1200 }

  it("takes 20 to mean twenty percent, not twenty times", () => {
    expect(
      offerUnitPriceInCents(
        { itemPriceInCents: null, discountAmount: 20, dessert },
        null,
      ),
    ).toBe(960)
  })

  it("lets a fixed price win over a discount", () => {
    expect(
      offerUnitPriceInCents(
        { itemPriceInCents: 500, discountAmount: 20, dessert },
        null,
      ),
    ).toBe(500)
  })

  // The offer that gives a dessert away stores 0, and a truthiness check here would read
  // that as "no fixed price" and charge the full 1200.
  it("treats a fixed price of zero as free, not as absent", () => {
    expect(
      offerUnitPriceInCents(
        { itemPriceInCents: 0, discountAmount: null, dessert },
        null,
      ),
    ).toBe(0)
  })

  it("charges list price when there is no discount at all", () => {
    expect(
      offerUnitPriceInCents(
        { itemPriceInCents: null, discountAmount: null, dessert },
        null,
      ),
    ).toBe(1200)
  })

  it("prices the dessert being bought when the offer names a category", () => {
    expect(
      offerUnitPriceInCents(
        { itemPriceInCents: null, discountAmount: 50, dessert: null },
        { priceInCents: 800 },
      ),
    ).toBe(400)
  })

  it("rounds to whole cents", () => {
    // 999 * 67 / 100 = 669.33
    expect(
      offerUnitPriceInCents(
        {
          itemPriceInCents: null,
          discountAmount: 33,
          dessert: { priceInCents: 999 },
        },
        null,
      ),
    ).toBe(669)
  })

  // Only the website's zod schema keeps this inside 0-100; the column takes any Int. A
  // negative percent used to price the item above list and a large one below zero, which
  // is how the old fraction reading gave away twenty times the item.
  it("clamps a percent the column should never have held", () => {
    expect(
      offerUnitPriceInCents(
        { itemPriceInCents: null, discountAmount: 400, dessert },
        null,
      ),
    ).toBe(0)

    expect(
      offerUnitPriceInCents(
        { itemPriceInCents: null, discountAmount: -50, dessert },
        null,
      ),
    ).toBe(1200)
  })

  it("gives nothing away when neither the offer nor the caller has a dessert", () => {
    expect(
      offerUnitPriceInCents(
        { itemPriceInCents: null, discountAmount: 20, dessert: null },
        null,
      ),
    ).toBe(0)
  })
})
