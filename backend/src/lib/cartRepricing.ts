import { Prisma } from "@prisma/client"
import { db, type DbTransactionClient } from "./db"
import { removeCartLines } from "./cartWrites"
import {
  type DiscountCorrections,
  hasCorrections,
  isPaidUpMember,
  type MemberForPricing,
  staleDiscounts,
} from "./memberPricing"

/**
 * Keeping a cart's prices in step with the customer's membership.
 *
 * The member discount is stored on each line when it goes into the cart, and
 * `calculateCartPrice` charges what is stored. Nothing ever revisited it, so joining did not
 * reach what was already in the cart - the new member paid full price for it - and a
 * membership that ended or went on hold left member prices, and member-only offers, sitting
 * in the cart until it expired.
 *
 * Two callers. The Stripe webhook, the moment a membership changes, so the cart is right
 * before the app next asks. And `getCartItems`, as the backstop for a webhook that failed or
 * raced an edit: it checks the rows it has already loaded and corrects any that are stale.
 */

/** Everything `staleDiscounts` reads from a line, plus the offer's audience. */
export const cartLineRepricingSelect = {
  id: true,
  itemPriceInCents: true,
  discountedAmountInCents: true,
  loyaltyPointsUsed: true,
  offerId: true,
  offer: { select: { audience: true } },
  dessert: {
    select: {
      promo: {
        select: {
          type: true,
          value: true,
          isActive: true,
          startsAt: true,
          endsAt: true,
        },
      },
    },
  },
  customisations: {
    select: {
      id: true,
      quantity: true,
      discountedAmountInCents: true,
      customisation: { select: { priceInCents: true } },
    },
  },
} satisfies Prisma.CartItemSelect

/**
 * Writes the corrected discounts. Returns how many rows it changed.
 *
 * A line is written only while its price is still the one the discount was worked out from:
 * an edit that changed the price (a mochi bowl losing its mochi) since the read is not
 * overwritten with a discount for the old price. A customisation row an edit has since
 * recreated matches nothing. Either way the next cart load puts it right.
 *
 * Touches only CartItem and CustomisationInCartItem, so it takes no part in the cart's
 * OfferRedemption - Loyalty - Cart lock order.
 */
export const applyDiscountCorrections = async (
  corrections: DiscountCorrections,
): Promise<number> => {
  if (!hasCorrections(corrections)) return 0

  const results = await db.$transaction([
    ...corrections.lines.map((line) =>
      db.cartItem.updateMany({
        where: {
          id: line.id,
          itemPriceInCents: line.itemPriceInCents,
          offerId: null,
        },
        data: { discountedAmountInCents: line.discountedAmountInCents },
      }),
    ),
    ...corrections.customisations.map((c) =>
      db.customisationInCartItem.updateMany({
        where: { id: c.id },
        data: { discountedAmountInCents: c.discountedAmountInCents },
      }),
    ),
  ])

  return results.reduce((sum, result) => sum + result.count, 0)
}

/**
 * The customer's membership as pricing needs it, read under a lock that lasts until `tx` ends.
 *
 * For `createOrder`, which must decide the points rate, whether a member-only item may be
 * bought and whether the stored discounts still stand from the membership as it is when the
 * order commits - not as it was a moment before. Read ahead of the transaction, a renewal
 * declined in between went unseen: the hold was captured, and the member-only line bought,
 * by someone who was no longer paid up. `FOR SHARE` makes a membership write already in flight
 * finish first, and then be seen; one arriving later waits until the order has committed, when
 * the customer was still a member.
 *
 * No deadlock: every Membership write is a statement of its own, and nothing that takes the
 * cart's rows waits on Membership while holding them. The points-expiry writers take the same
 * shared lock, which does not conflict with this one.
 */
export const readMembershipForPricingLocked = async (
  tx: DbTransactionClient,
  userId: string,
): Promise<MemberForPricing> => {
  const [row] = await tx.$queryRaw<
    {
      isActive: boolean
      paymentStatus: string
      totalMonths: number
      maxDiscount: number
      membershipDiscount: number
    }[]
  >`SELECT m."isActive", m."paymentStatus", m."totalMonths", p."maxDiscount", p."membershipDiscount"
    FROM "Membership" m JOIN "MembershipPlan" p ON p."id" = m."planId"
    WHERE m."userId" = ${userId}
    FOR SHARE OF m`
  if (!row) return null
  return {
    isActive: row.isActive,
    paymentStatus: row.paymentStatus,
    totalMonths: row.totalMonths,
    plan: {
      maxDiscount: row.maxDiscount,
      membershipDiscount: row.membershipDiscount,
    },
  }
}

export type CartSync = {
  /** Member-only offer lines taken out because the customer is not a paid-up member. */
  removed: number
  /** Line and customisation rows whose discount was corrected. */
  repriced: number
}

const NOTHING_TO_SYNC: CartSync = { removed: 0, repriced: 0 }

/**
 * Brings a customer's cart in line with their membership as it stands: member-only offer
 * lines out if they are not a paid-up member, and every discount recomputed.
 *
 * Found by the subscription the webhook is handling, or by the customer. Idempotent: run
 * twice, the second run finds nothing to do, which is what lets a redelivered Stripe event
 * call it again safely.
 */
export const syncCartWithMembership = async (
  where: { userId: string } | { stripeSubscriptionId: string },
  now: Date = new Date(),
): Promise<CartSync> => {
  const membership = await db.membership.findUnique({
    where,
    select: {
      userId: true,
      isActive: true,
      paymentStatus: true,
      totalMonths: true,
      plan: { select: { maxDiscount: true, membershipDiscount: true } },
      user: {
        select: {
          cart: { select: { cartItems: { select: cartLineRepricingSelect } } },
        },
      },
    },
  })

  const lines = membership?.user.cart?.cartItems
  if (!membership || !lines || lines.length === 0) return NOTHING_TO_SYNC

  // A member-only offer is not repriced to its full price when the membership stops: it is
  // taken out, with its use handed back, as the cart load has always done for a lapsed one.
  const memberOnly = isPaidUpMember(membership)
    ? []
    : lines.filter((line) => line.offerId && line.offer?.audience === "MEMBERS")

  const removed = await removeCartLines(membership.userId, memberOnly)
  const kept = lines.filter((line) => !memberOnly.includes(line))

  const repriced = await applyDiscountCorrections(
    staleDiscounts(kept, membership, now),
  )

  return { removed, repriced }
}
