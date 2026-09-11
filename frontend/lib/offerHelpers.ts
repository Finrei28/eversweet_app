import { Offer, OfferAudience, OfferViewer } from "@/utils/types"

/**
 * Mirrors `canRedeemAudience` in backend/src/lib/offerAudience.ts. If the two
 * drift, the app offers a Redeem button the server then refuses.
 */
export const canRedeemAudience = (
  audience: OfferAudience,
  viewer: OfferViewer,
): boolean => {
  switch (audience) {
    case "EVERYONE":
      return true
    case "MEMBERS":
      return viewer.isActiveMember
    case "NEW_USERS":
      return viewer.isNewCustomer
  }
}

/**
 * What one unit costs under an offer. Mirrors `offerUnitPriceInCents` in
 * backend/src/lib/offerPricing.ts — if the two drift, the app shows a price the server
 * then charges differently.
 *
 * `discountAmount` is WHOLE PERCENT, 0-100, since the 2026-09-12 migration. The card used
 * to render `discountAmount * 100` and the modal priced at `1 - discountAmount`; both were
 * reading it as a fraction, so a stored 20 showed "2000% off" and priced at -19x list.
 */
export const offerUnitPriceInCents = (
  offer: Pick<Offer, "itemPriceInCents" | "discountAmount">,
  /** The dessert being bought — the offer may name a category rather than one item. */
  dessert: { priceInCents: number } | null,
): number => {
  // Null, not falsy: `itemPriceInCents: 0` is how a free item is expressed.
  if (offer.itemPriceInCents !== null) return offer.itemPriceInCents

  const percent = Math.min(100, Math.max(0, offer.discountAmount ?? 0))
  return Math.round(((dessert?.priceInCents ?? 0) * (100 - percent)) / 100)
}

/**
 * What an offer's requirements ask for, phrased for the customer.
 *
 * A requirement carrying neither a dessert nor a category is skipped: the server's
 * eligibility check returns false for such a row, so it can never be satisfied and
 * naming it would only promise something unreachable.
 */
export const describeRequirements = (offer: Offer): string | null => {
  const parts = offer.requirements
    .map((requirement) => {
      const name = requirement.dessert?.name ?? requirement.category?.name
      return name ? `${requirement.quantity} × ${name}` : null
    })
    .filter((part): part is string => part !== null)

  return parts.length > 0 ? `Order ${parts.join(" and ")} to unlock` : null
}

export type OfferState = {
  /** Viewer does not qualify for the audience. */
  locked: boolean
  /** Used up to the offer's limit. */
  alreadyRedeemed: boolean
  /** Qualified, not used up, and any requirements already met. */
  isRedeemable: boolean
  /**
   * Why the Redeem button is inert, for the card to explain.
   *
   * Without this a gated offer nobody has earned yet and one already used up both
   * rendered as the same greyed "Redeem" — indistinguishable, with no copy saying which.
   */
  unavailableReason: "AUDIENCE" | "LIMIT_REACHED" | "REQUIREMENTS_NOT_MET" | null
}

export const getOfferState = (
  offer: Offer,
  viewer: OfferViewer,
): OfferState => {
  // The API scopes redemptions to the caller, so there is at most one.
  const redemption = offer.redemptions[0]
  const usedCount = redemption?.used ?? 0

  const locked = !canRedeemAudience(offer.audience, viewer)
  const alreadyRedeemed = usedCount >= offer.limit
  // A requirement-gated offer only becomes usable once an order has
  // unlocked it; the server writes that AVAILABLE row.
  const requirementsMet =
    offer.requirements.length === 0 || redemption?.status === "AVAILABLE"

  return {
    locked,
    alreadyRedeemed,
    isRedeemable: !locked && !alreadyRedeemed && requirementsMet,
    unavailableReason: locked
      ? "AUDIENCE"
      : alreadyRedeemed
        ? "LIMIT_REACHED"
        : !requirementsMet
          ? "REQUIREMENTS_NOT_MET"
          : null,
  }
}

/**
 * Splits offers into the three sections the Offers page renders, in display
 * order: members first, then first-order, then everything else.
 *
 * A members-only offer the viewer cannot use is still returned — shown locked,
 * it is the membership upsell. A first-order offer is not: once someone has
 * ordered there is no way back, so showing it would only be a tease.
 */
export const groupOffers = (offers: Offer[], viewer: OfferViewer) => ({
  members: offers.filter((o) => o.audience === "MEMBERS"),
  newCustomer: viewer.isNewCustomer
    ? offers.filter((o) => o.audience === "NEW_USERS")
    : [],
  everyone: offers.filter((o) => o.audience === "EVERYONE"),
})
