import { DEFAULT_LOYALTY_RATES } from "./loyaltyRates"

/**
 * What the app lists on the join and manage screens when the plan row carries no benefits
 * of its own.
 *
 * The list itself now lives on `MembershipPlan.benefits`, edited from the website's admin,
 * so the shop can reword a benefit without a deploy. This is only the fallback, kept so an
 * unseeded plan still describes the membership rather than showing an empty tick-list.
 *
 * The loyalty line is built from the rate rather than written out. The hardcoded version
 * advertised "Earn 2x loyalty points" for months while the rate gave members 1.5x, and a
 * sentence claiming a number should be derived from whatever sets that number. The rows an
 * admin types cannot be protected this way, which is why the admin screen shows the live
 * multiplier next to the field.
 */
export const DEFAULT_MEMBERSHIP_BENEFITS = [
  "Free weekly Mochi Series Bowl ($9.99)",
  "Stackable membership discount from 5% to 25%, up by 5% each month",
  `Earn ${DEFAULT_LOYALTY_RATES.memberRate}x loyalty points`,
  "Exclusive membership offers",
  "Cancel anytime",
]
