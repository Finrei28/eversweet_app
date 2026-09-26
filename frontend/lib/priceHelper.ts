import { Dessert, UsersMembership } from "@/utils/types"
import { memberDiscountPercent } from "@/lib/membership"

/**
 * Whether a dessert's promotion is running: switched on, and inside its window, both ends
 * inclusive, with no date meaning no bound.
 *
 * A copy of `isPromoLive` in the order server's lib/memberPricing. The app used to treat
 * `endsAt` as exclusive, so at that instant it showed the full price for a line the server
 * still discounted. The dates arrive from JSON as strings, whatever the type says.
 */
export const isPromoLive = (
  promo: Dessert["promo"],
  now: Date = new Date(),
): promo is NonNullable<Dessert["promo"]> =>
  !!promo &&
  promo.isActive &&
  (!promo.startsAt || new Date(promo.startsAt).getTime() <= now.getTime()) &&
  (!promo.endsAt || new Date(promo.endsAt).getTime() >= now.getTime())

export function calculateBestDiscountedPrice(
  dessert: Dessert,
  usersMembership: UsersMembership | null,
  offerItemPrice?: number,
  now: Date = new Date(),
) {
  const originalPrice = dessert.priceInCents

  // Paid up, not merely active: a membership on hold gets no member price, which
  // memberDiscountPercent answers as 0.
  const membershipPrice = Math.round(
    originalPrice * (1 - memberDiscountPercent(usersMembership) / 100),
  )

  const promoPrice = calculatePriceAfterPromo(dessert, now)

  const dessertPriceInCentsAfterDiscount = Math.min(
    originalPrice,
    membershipPrice,
    promoPrice,
  )

  return offerItemPrice ?? dessertPriceInCentsAfterDiscount // if offer then show offer price
}

export function calculatePriceAfterPromo(dessert: Dessert, now: Date = new Date()) {
  const originalPrice = dessert.priceInCents
  const promo = dessert.promo
  if (!isPromoLive(promo, now)) return originalPrice

  return promo.type === "PERCENTAGE"
    ? Math.round(originalPrice * (1 - promo.value / 100))
    : Math.max(0, originalPrice - promo.value)
}

/**
 * Which discount the order server will take off this dessert, or null when neither lowers
 * the price: the better of the member discount and a running promotion, never both - the
 * server's `lineDiscountInCents`. A tie is the member's, as `getTotalMembershipDiscount` has it.
 *
 * What the menu card, the dessert sheet and the cart line label a price with. They asked
 * `promo.isActive` alone, so a promotion past its end date still struck the price through and
 * said "Special Offer" over a price nothing had come off; and "Member Price" was said to a
 * member whose promotion was the better of the two.
 */
export function appliedDiscount(
  dessert: Dessert,
  usersMembership: UsersMembership | null,
  now: Date = new Date(),
): "member" | "promo" | null {
  const memberPrice = calculatePriceAfterMembershipDiscount(
    dessert.priceInCents,
    usersMembership,
  )
  const promoPrice = calculatePriceAfterPromo(dessert, now)

  if (Math.min(memberPrice, promoPrice) >= dessert.priceInCents) return null
  return memberPrice <= promoPrice ? "member" : "promo"
}

export function calculatePriceAfterMembershipDiscount(
  price: number,
  usersMembership: UsersMembership | null,
) {
  return Math.round(price * (1 - memberDiscountPercent(usersMembership) / 100))
}

export function calculateMembershipDiscount(
  price: number,
  usersMembership: UsersMembership | null,
) {
  return Math.round(price * (memberDiscountPercent(usersMembership) / 100))
}
