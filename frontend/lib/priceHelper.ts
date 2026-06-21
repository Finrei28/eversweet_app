import { Dessert, UsersMembership } from "@/utils/types"

export function calculateBestDiscountedPrice(
  dessert: Dessert,
  usersMembership: UsersMembership | null,
  offerItemPrice?: number,
) {
  const originalPrice = dessert.priceInCents

  const maxMembershipDiscount = Math.min(
    usersMembership?.plan.maxDiscount ?? 0,
    (usersMembership?.totalMonths ?? 1) *
      (usersMembership?.plan.membershipDiscount ?? 0),
  )

  const membershipPrice = usersMembership?.isActive
    ? originalPrice * (1 - maxMembershipDiscount / 100)
    : originalPrice

  const promoPrice = dessert.promo?.isActive
    ? dessert.promo.type === "PERCENTAGE"
      ? originalPrice * (1 - dessert.promo.value / 100)
      : Math.max(0, originalPrice - dessert.promo.value)
    : originalPrice

  const dessertPriceInCentsAfterDiscount = Math.min(
    originalPrice,
    membershipPrice,
    promoPrice,
  )

  return offerItemPrice ?? dessertPriceInCentsAfterDiscount // if offer then show offer price
}

export function calculatePriceAfterPromo(dessert: Dessert) {
  const originalPrice = dessert.priceInCents

  const promoPrice = dessert.promo?.isActive
    ? dessert.promo.type === "PERCENTAGE"
      ? originalPrice * (1 - dessert.promo.value / 100)
      : Math.max(0, originalPrice - dessert.promo.value)
    : originalPrice

  return promoPrice
}

export function calculatePriceAfterMembershipDiscount(
  price: number,
  usersMembership: UsersMembership | null,
) {
  const maxMembershipDiscount = Math.min(
    usersMembership?.plan.maxDiscount ?? 0,
    (usersMembership?.totalMonths ?? 1) *
      (usersMembership?.plan.membershipDiscount ?? 0),
  )

  const membershipPrice = usersMembership?.isActive
    ? price * (1 - maxMembershipDiscount / 100)
    : price

  return membershipPrice
}

export function calculateMembershipDiscount(
  price: number,
  usersMembership: UsersMembership | null,
) {
  const maxMembershipDiscount = Math.min(
    usersMembership?.plan.maxDiscount ?? 0,
    (usersMembership?.totalMonths ?? 1) *
      (usersMembership?.plan.membershipDiscount ?? 0),
  )

  const membershipPrice = usersMembership?.isActive
    ? price * (maxMembershipDiscount / 100)
    : 0

  return membershipPrice
}
