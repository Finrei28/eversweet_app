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
