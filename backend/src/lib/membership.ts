import { type LoyaltyRates } from "./loyaltyRates"

/**
 * The token a benefit uses instead of writing the member multiplier out.
 *
 * A benefit is free text an admin types, and the one thing it kept getting wrong was the
 * number: the list advertised "Earn 2x loyalty points" for months while the rate gave
 * members 1.5x. A sentence that quotes a number should be filled in from whatever sets that
 * number, so `{{memberRate}}` is resolved from `LoyaltySetting` when the benefits are
 * served. Change the rate and every screen that lists the benefits follows.
 *
 * The website's settings screen offers it, previews the resolved text, and still warns when
 * somebody types a bare number anyway - nothing can stop that, but it can be pointed out
 * while they are typing rather than after customers have read it.
 */
export const MEMBER_RATE_TOKEN = "{{memberRate}}"

/**
 * What the app lists on the join and manage screens when the plan row carries no benefits
 * of its own.
 *
 * The list itself lives on `MembershipPlan.benefits`, edited from the website's admin, so
 * the shop can reword a benefit without a deploy. This is only the fallback, kept so an
 * unseeded plan still describes the membership rather than showing an empty tick-list.
 *
 * The loyalty line carries the token rather than a number. It used to interpolate
 * `DEFAULT_LOYALTY_RATES.memberRate` at module load, which is a constant compiled into the
 * build - so an admin who changed the rate got the new multiplier on their orders and the
 * old one in this list, which is the drift the whole arrangement exists to stop.
 */
export const DEFAULT_MEMBERSHIP_BENEFITS = [
  "Free weekly Mochi Series Bowl ($9.99)",
  "Stackable membership discount from 5% to 25%, up by 5% each month",
  `Earn ${MEMBER_RATE_TOKEN}x loyalty points`,
  "Exclusive membership offers",
  "Cancel anytime",
]

/**
 * The benefits with the live rates filled in, ready to serve.
 *
 * Trailing zeroes are dropped, so 1.5 reads as "1.5x" and 2 as "2x" rather than "2.0x".
 */
export const resolveMembershipBenefits = (
  benefits: readonly string[],
  rates: LoyaltyRates,
): string[] => {
  const memberRate = String(Number(rates.memberRate.toFixed(2)))
  return benefits.map((benefit) =>
    benefit.split(MEMBER_RATE_TOKEN).join(memberRate),
  )
}
