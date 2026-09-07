/**
 * The one definition of what a cart costs.
 *
 * Derived from the cart rows every time rather than read from
 * `Cart.totalPriceInCents`, which is maintained by scattered `increment` /
 * `decrement` updates and drifts from the items it is meant to describe.
 *
 * These are the same fields, in the same order, that the app's
 * `netUnitPriceInCents` uses (frontend/store/cart.ts), so the total worked out
 * here matches the one the customer was shown.
 */

/** The shape this needs: whatever query supplies it must include these. */
export type PricedCartItem = {
  quantity: number
  itemPriceInCents: number
  discountedAmountInCents: number
  customisations: {
    quantity: number
    discountedAmountInCents: number
    customisation: { priceInCents: number }
  }[]
}

export type CartPriceBreakdown = {
  /** List price of everything, before any discount. */
  beforeDiscountInCents: number
  /** Everything taken off that list price. */
  discountInCents: number
  /** What the customer actually pays: the two above, subtracted. */
  payableInCents: number
  /** The GST already inside `payableInCents`. See `gstFromInclusive`. */
  gstInCents: number
}

/**
 * The GST contained in a GST-inclusive amount.
 *
 * New Zealand retail prices include GST, so the 15% rate applies to the
 * ex-GST amount, not to the price on the label: for a $23.00 price the GST is
 * $3.00 and the ex-GST amount $20.00, because $20.00 x 1.15 = $23.00.
 * Multiplying the inclusive price by 15% gives $3.45 and overstates the tax by
 * 15% on every order. IRD's shorthand for the extraction is x 3 / 23.
 *
 * Rounded because Order.GST is an Int column and this rarely divides evenly.
 */
export const gstFromInclusive = (inclusiveInCents: number): number =>
  Math.round((inclusiveInCents * 3) / 23)

export const calculateCartPrice = (
  cartItems: PricedCartItem[],
): CartPriceBreakdown => {
  let beforeDiscountInCents = 0
  let discountInCents = 0

  for (const item of cartItems) {
    let itemPrice = item.itemPriceInCents
    let itemDiscount = item.discountedAmountInCents

    for (const c of item.customisations) {
      // Quantity zero means the customer removed an ingredient the dessert
      // normally includes, so there is nothing to charge for it.
      if (c.quantity <= 0) continue

      itemPrice += c.customisation.priceInCents * c.quantity
      itemDiscount += c.discountedAmountInCents * c.quantity
    }

    beforeDiscountInCents += itemPrice * item.quantity
    discountInCents += itemDiscount * item.quantity
  }

  const payableInCents = beforeDiscountInCents - discountInCents

  return {
    beforeDiscountInCents,
    discountInCents,
    payableInCents,
    gstInCents: gstFromInclusive(payableInCents),
  }
}

/** The include clause that gives a cart query the fields `calculateCartPrice` reads. */
export const cartPricingInclude = {
  customisations: { include: { customisation: true } },
} as const
