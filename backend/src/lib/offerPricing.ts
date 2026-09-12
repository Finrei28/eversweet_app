/**
 * What one unit costs under an offer.
 *
 * This lived twice, byte for byte, in `addItemToCart` and `updateCartItem` — add an item
 * and edit it and you were running two copies of the same ternary. Both are now this.
 */

/** The shape this needs: whatever query supplies it must include the offer's dessert. */
export type PricedOffer = {
  itemPriceInCents: number | null
  discountAmount: number | null
  dessert: { priceInCents: number } | null
}

export const offerUnitPriceInCents = (
  offer: PricedOffer,
  /** The dessert being bought, used when the offer names a category rather than one item. */
  fallbackDessert: { priceInCents: number } | null,
): number => {
  // A null check and not a truthiness one: `itemPriceInCents: 0` is how a free item is
  // expressed, and both live offers use it. Reading 0 as "unset" would fall through to
  // the discount arm and charge full price for the thing being given away.
  if (offer.itemPriceInCents !== null) return offer.itemPriceInCents

  const listPriceInCents =
    offer.dessert?.priceInCents ?? fallbackDessert?.priceInCents ?? 0

  // Whole percent, 0-100, since the 2026-09-12 migration. This was
  // `1 - Number(discountAmount)` while the column was a Decimal fraction, which reads a
  // stored 20 as `1 - 20` — pricing the item at -19x its list price, so the discount
  // came out twenty times larger than the item and the app rendered "2000% off".
  //
  // Clamped rather than trusted: the column itself allows any Int, and only the website's
  // zod schema keeps it inside 0-100. A bad row must not be able to mint money again.
  const percent = Math.min(100, Math.max(0, offer.discountAmount ?? 0))

  return Math.round((listPriceInCents * (100 - percent)) / 100)
}
