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
    ? Math.round(originalPrice * (1 - maxMembershipDiscount / 100))
    : originalPrice

  let promoPrice = originalPrice
  const promo = dessert.promo
  if (promo) {
    const now = new Date()
    const isActive = promo?.isActive ?? false
    const hasStarted = !promo?.startsAt || now >= new Date(promo.startsAt)
    const hasEnded = !!promo?.endsAt && now >= new Date(promo.endsAt)
    if (isActive && !hasEnded && hasStarted) {
      promoPrice =
        promo.type === "PERCENTAGE"
          ? Math.round(originalPrice * (1 - promo.value / 100))
          : Math.max(0, originalPrice - promo.value)
    }
  }

  const dessertPriceInCentsAfterDiscount = Math.min(
    originalPrice,
    membershipPrice,
    promoPrice,
  )

  return offerItemPrice ?? dessertPriceInCentsAfterDiscount // if offer then show offer price
}

export function calculatePriceAfterPromo(dessert: Dessert) {
  const now = new Date()
  const originalPrice = dessert.priceInCents
  const promo = dessert.promo
  if (!promo) {
    return originalPrice
  }
  const isActive = promo?.isActive ?? false
  const hasStarted = !promo?.startsAt || now >= new Date(promo.startsAt)
  const hasEnded = !!promo?.endsAt && now >= new Date(promo.endsAt)

  if (!isActive || hasEnded || !hasStarted) {
    return originalPrice
  }

  const promoPrice =
    promo.type === "PERCENTAGE"
      ? Math.round(originalPrice * (1 - promo.value / 100))
      : Math.max(0, originalPrice - promo.value)

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
    ? Math.round(price * (1 - maxMembershipDiscount / 100))
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

  const membershipDiscount = usersMembership?.isActive
    ? Math.round(price * (maxMembershipDiscount / 100))
    : 0

  return membershipDiscount
}
