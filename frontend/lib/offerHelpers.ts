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

export type OfferState = {
  /** Viewer does not qualify for the audience. */
  locked: boolean
  /** Used up to the offer's limit. */
  alreadyRedeemed: boolean
  /** Qualified, not used up, and any requirements already met. */
  isRedeemable: boolean
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

  return {
    locked,
    alreadyRedeemed,
    isRedeemable:
      !locked &&
      !alreadyRedeemed &&
      // A requirement-gated offer only becomes usable once an order has
      // unlocked it; the server writes that AVAILABLE row.
      (offer.requirements.length === 0 || redemption?.status === "AVAILABLE"),
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
