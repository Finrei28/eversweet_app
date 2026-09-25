/**
 * Who counts as a member, and what a member or a promotion takes off a cart line.
 *
 * The one definition, used when a line is added or edited, when the Stripe webhook changes
 * a membership, and when the cart is loaded. Those used to be two private helpers in the cart
 * controller, run only at add and edit time, so a discount stored on a line stayed there for
 * the life of the cart: a customer who joined paid full price for what was already in it,
 * and one whose membership lapsed kept member prices until the cart expired.
 */

/** The fields that decide whether someone is a member at all. */
export type MemberStatus = {
  isActive: boolean
  paymentStatus: string
}

export type MemberForPricing =
  | (MemberStatus & {
      totalMonths: number
      plan: { maxDiscount: number; membershipDiscount: number }
    })
  | null
  | undefined

/**
 * Whether this customer gets member benefits right now: a subscription running **and paid
 * up**.
 *
 * `isActive` alone is not it. A renewal that is declined and being retried leaves the
 * membership `isActive` with a PENDING payment - "on hold" in the Terms - and every benefit
 * pauses until the payment goes through: member prices, member-only offers (including any
 * already in the cart), the higher points rate and the protection from points expiry. The
 * price, the points rate and the cart's member-only sweep used to check `isActive` alone, so a
 * member whose card had stopped paying kept all three.
 *
 * `isActive` on its own still means "has a subscription running", which is what refuses a
 * second join while one is on hold: the way out of a hold is to retry the payment.
 */
export const isPaidUpMember = (
  membership: MemberStatus | null | undefined,
): boolean =>
  !!membership && membership.isActive && membership.paymentStatus === "SUCCESS"

/**
 * What checkout says to someone holding a member-only item without a paid-up membership - most
 * likely because a renewal was declined and the membership is on hold. The cart load removes
 * such items, so a customer normally never sees this; it is the refusal for one that slipped
 * past, and a hold is released with it.
 */
export const MEMBER_ONLY_ITEM_MESSAGE =
  "An item in your cart is only for members with an active, paid-up membership."

/**
 * What checkout says when a stored discount is no longer the right one - a membership that
 * went on hold or ended, a renewal that stepped the discount up, or a promotion that finished
 * - between the cart being loaded and the payment. Answered instead of charging the old
 * price; a hold is released with it.
 */
export const CART_PRICES_CHANGED_MESSAGE =
  "Prices in your cart have changed. Please review your cart and try again."

/**
 * The member discount, in whole percent. It grows a step for each month paid in a row, up to
 * the plan's cap, and is nothing for anyone not paid up.
 *
 * At least one step for a paid-up member: `totalMonths` is written by the webhook from the
 * paid invoices, so it is never below one once a membership is live, but a row from before
 * that count existed must not read as no discount at all.
 */
export const memberDiscountPercent = (membership: MemberForPricing): number => {
  if (!membership || !isPaidUpMember(membership)) return 0
  const { maxDiscount, membershipDiscount } = membership.plan
  return Math.min(
    maxDiscount,
    Math.max(1, membership.totalMonths) * membershipDiscount,
  )
}

export type PromoForPricing =
  | {
      type: "PERCENTAGE" | "FIXED_AMOUNT"
      value: number
      isActive: boolean
      startsAt: Date | null
      endsAt: Date | null
    }
  | null
  | undefined

/**
 * Whether a promotion is running: switched on, and inside its window, both ends inclusive,
 * with NULL meaning no bound - the same reading as `isOfferLive`.
 *
 * The server never asked. A dessert's promo was applied whatever its switch and dates said, so
 * a promotion that had been paused or had ended still took money off - while the app, which
 * does check, showed the customer the full price.
 */
export const isPromoLive = (
  promo: PromoForPricing,
  now: Date = new Date(),
): promo is NonNullable<PromoForPricing> =>
  !!promo &&
  promo.isActive &&
  (promo.startsAt === null || promo.startsAt <= now) &&
  (promo.endsAt === null || promo.endsAt >= now)

/**
 * What comes off one unit of a line's dessert, in whole cents.
 *
 * - A reward, bought with points, is not discounted again by anything.
 * - Otherwise the better of the member discount and a running promotion. They never add
 *   together - the Terms promise one or the other.
 * - A fixed-amount promotion takes no more than the price. It used to be taken whole, so a
 *   $5-off promotion on a $3 line priced it at -$2.
 */
export const lineDiscountInCents = ({
  priceBeforeDiscountInCents,
  isReward,
  promo,
  memberPercent,
  now = new Date(),
}: {
  priceBeforeDiscountInCents: number
  isReward: boolean
  promo: PromoForPricing
  memberPercent: number
  now?: Date
}): number => {
  if (isReward) return 0

  const memberDiscount = (priceBeforeDiscountInCents * memberPercent) / 100
  const promoDiscount = !isPromoLive(promo, now)
    ? 0
    : promo.type === "PERCENTAGE"
      ? (priceBeforeDiscountInCents * promo.value) / 100
      : Math.min(promo.value, priceBeforeDiscountInCents)

  return Math.round(Math.max(memberDiscount, promoDiscount))
}

/**
 * What the member discount takes off one unit of a customisation, in whole cents.
 *
 * Rounded because the column is an Int. It was not: a 150c topping at 5% came to 7.5, which
 * reached the column as 7 - the fraction dropped rather than rounded, by nobody's decision.
 *
 * A removed ingredient (quantity 0) costs nothing, so there is nothing to take off it.
 */
export const customisationDiscountInCents = (
  priceInCents: number,
  quantity: number,
  memberPercent: number,
): number =>
  quantity > 0 ? Math.round((priceInCents * memberPercent) / 100) : 0

/** A cart line as `staleDiscounts` needs to see it. */
export type LineForRepricing = {
  id: string
  itemPriceInCents: number
  discountedAmountInCents: number
  loyaltyPointsUsed: number | null
  offerId: string | null
  dessert: { promo: PromoForPricing }
  customisations: {
    id: string
    quantity: number
    discountedAmountInCents: number
    customisation: { priceInCents: number }
  }[]
}

export type DiscountCorrections = {
  /** `itemPriceInCents` is the price the discount was worked out from, as read. */
  lines: { id: string; itemPriceInCents: number; discountedAmountInCents: number }[]
  customisations: { id: string; discountedAmountInCents: number }[]
}

/**
 * The discounts on these lines that are no longer what they should be.
 *
 * An offer line keeps its offer price: that is the offer's to set, and a line whose offer has
 * stopped standing is removed by the cart's own sweeps, not repriced. Its customisations are
 * member-discounted like any other, so those are checked. A reward line's dessert is never
 * discounted.
 */
export const staleDiscounts = (
  lines: LineForRepricing[],
  membership: MemberForPricing,
  now: Date = new Date(),
): DiscountCorrections => {
  const memberPercent = memberDiscountPercent(membership)
  const corrections: DiscountCorrections = { lines: [], customisations: [] }

  for (const line of lines) {
    if (!line.offerId) {
      const expected = lineDiscountInCents({
        priceBeforeDiscountInCents: line.itemPriceInCents,
        isReward: !!line.loyaltyPointsUsed,
        promo: line.dessert.promo,
        memberPercent,
        now,
      })
      if (expected !== line.discountedAmountInCents) {
        corrections.lines.push({
          id: line.id,
          itemPriceInCents: line.itemPriceInCents,
          discountedAmountInCents: expected,
        })
      }
    }

    for (const c of line.customisations) {
      const expected = customisationDiscountInCents(
        c.customisation.priceInCents,
        c.quantity,
        memberPercent,
      )
      if (expected !== c.discountedAmountInCents) {
        corrections.customisations.push({
          id: c.id,
          discountedAmountInCents: expected,
        })
      }
    }
  }

  return corrections
}

export const hasCorrections = (corrections: DiscountCorrections) =>
  corrections.lines.length > 0 || corrections.customisations.length > 0
