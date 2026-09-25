import { UsersMembership } from "@/utils/types"
import { formatWeekdayDate } from "./formatters"

/**
 * Whether the customer gets member benefits right now: a subscription running and paid up.
 *
 * A copy of `isPaidUpMember` in the order server's lib/memberPricing, on purpose. The server
 * decides every price and every refusal; this only stops the app from showing a member price,
 * member savings or member points the server will not give. A membership on hold - a renewal
 * declined and being retried - is still `isActive`, and every benefit pauses until the payment
 * goes through.
 *
 * `isActive` alone still means "has a subscription running", which is what decides whether
 * to offer someone the membership at all: a customer on hold should retry, not rejoin.
 */
export const isPaidUpMember = (
  membership: Pick<UsersMembership, "isActive" | "paymentStatus"> | null | undefined,
): boolean =>
  !!membership && membership.isActive && membership.paymentStatus === "SUCCESS"

/**
 * The discount a membership has built up, in whole percent, whether or not it is being given
 * right now: a step for each month paid in a row, up to the plan's cap, and at least one step.
 *
 * A copy of `builtUpDiscountPercent` in the order server's lib/memberPricing. It is what a
 * member stands to lose, so the warnings quote it - a membership on hold is given nothing and
 * still has its whole run riding on the retry.
 */
export const builtUpDiscountPercent = (
  membership: Pick<UsersMembership, "totalMonths" | "plan">,
): number =>
  Math.min(
    membership.plan.maxDiscount,
    Math.max(1, membership.totalMonths) * membership.plan.membershipDiscount,
  )

/**
 * The member discount being given right now, in whole percent: what has been built up, and
 * nothing for anyone not paid up.
 *
 * A copy of `memberDiscountPercent` in the order server's lib/memberPricing, and the only
 * place the app works it out. `priceHelper` used to repeat the formula three times as
 * `(totalMonths ?? 1) * step`, which is 0% for a count of 0 where the server gives the first
 * step, so the app could show a member the full price for a line the server discounts.
 */
export const memberDiscountPercent = (
  membership: UsersMembership | null | undefined,
): number =>
  membership && isPaidUpMember(membership) ? builtUpDiscountPercent(membership) : 0

/**
 * The one benefit a warning names beside the discount - the first in the shop's order that is
 * not the discount itself or "Cancel anytime", lower-cased to sit mid-sentence, or null.
 *
 * A deliberate copy of `headlinePerk` in the order server's lib/membership, run over the same
 * served list, so the banner names the perk the push did. The list is the shop's to edit, so
 * the perk is never written into the app.
 */
export const headlinePerk = (benefits: readonly string[]): string | null => {
  const perk = benefits.find(
    (benefit) =>
      benefit.trim() !== "" && !/discount/i.test(benefit) && !/cancel/i.test(benefit),
  )
  if (!perk) return null
  const trimmed = perk.trim()
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1)
}

/** Worded as the server's `benefitsAtStake`, so the banner and the push read alike. */
const benefitsAtStake = (discountPercent: number, perk: string | null) =>
  perk
    ? `Your ${discountPercent}% member discount, ${perk} and your other member benefits`
    : `Your ${discountPercent}% member discount and your other member benefits`

/**
 * How close a cancelled membership's end has to be for the banner to show. Wider than the
 * push's three days: the banner costs nothing to someone who is not looking, and a month of it
 * from the day they cancelled would be nagging.
 */
export const MEMBERSHIP_ENDING_BANNER_DAYS = 7

/**
 * The banner's line for a member about to lose their benefits, or null.
 *
 * - **On hold** (a renewal declined and being retried): the benefits are paused now, and an
 *   unpaid hold ends the subscription.
 * - **Cancelled and ending within the week**: they end on the day, unless re-subscribed.
 *
 * The end is formatted in New Zealand time, as every date in the app is.
 */
export const membershipWarning = (
  membership: UsersMembership | null | undefined,
  benefits: readonly string[],
  now: Date = new Date(),
): string | null => {
  if (!membership || !membership.isActive) return null

  const atStake = benefitsAtStake(
    builtUpDiscountPercent(membership),
    headlinePerk(benefits),
  )

  if (membership.paymentStatus === "PENDING") {
    return `${atStake} are paused until your renewal is paid. Tap to retry the payment.`
  }

  if (membership.paymentStatus !== "SUCCESS" || !membership.cancel) return null

  const end = new Date(membership.endDate)
  const untilEnd = end.getTime() - now.getTime()
  if (
    Number.isNaN(untilEnd) ||
    untilEnd <= 0 ||
    untilEnd > MEMBERSHIP_ENDING_BANNER_DAYS * 24 * 60 * 60 * 1000
  ) {
    return null
  }
  return `${atStake} end on ${formatWeekdayDate(end)}. Tap to re-subscribe and keep them.`
}
