import {
  getLoyaltyRates,
  getPointsExpireFrom,
  type LoyaltyRates,
} from "./loyaltyRates"

/** The plan row whose `stripePriceId` is a live-mode Stripe price. */
export const LIVE_MEMBERSHIP_PLAN_NAME = "Monthly_Membership"
/** The plan row whose `stripePriceId` is a test-mode Stripe price. */
export const TEST_MEMBERSHIP_PLAN_NAME = "Test_Membership"

/**
 * Which `MembershipPlan` row this server sells.
 *
 * A Stripe price exists in exactly one mode, so a test key asked for the live plan's price
 * gets `resource_missing`, and development (which runs on a test key) could not show or
 * join the membership at all. The plan follows the key rather than NODE_ENV because the key
 * is what decides which prices Stripe can see: nothing sets NODE_ENV in `.env`, and a
 * production host that happened to leave it unset would otherwise sell the test plan to
 * every customer. Restricted keys (`rk_live_`) count as live too.
 */
export const membershipPlanName = (
  secretKey: string | undefined = process.env.STRIPE_SECRET_KEY,
) =>
  /^(sk|rk)_live_/.test(secretKey ?? "")
    ? LIVE_MEMBERSHIP_PLAN_NAME
    : TEST_MEMBERSHIP_PLAN_NAME

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
 * Marks a benefit that is true only while points expiry is switched on, and is shown only
 * then.
 *
 * "Your Sweet Points never expire while you're a member" is an advantage when everyone
 * else's points expire. With expiry switched off, nobody's points expire, and the same line
 * would be claiming something members do not actually get over anyone else - the same kind
 * of untrue claim as the "2x" line. So it is stored with this token in front, and served
 * without the token while expiry is on and not at all while it is off.
 */
export const WHILE_POINTS_EXPIRE_TOKEN = "{{whilePointsExpire}}"

/** Added by 20260925000000_points_expiry; the fallback below carries the same line. */
export const POINTS_NEVER_EXPIRE_BENEFIT = `${WHILE_POINTS_EXPIRE_TOKEN}Your Sweet Points never expire while you're a member`

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
  POINTS_NEVER_EXPIRE_BENEFIT,
]

/**
 * The benefits with the live settings filled in, ready to serve.
 *
 * Trailing zeroes are dropped, so 1.5 reads as "1.5x" and 2 as "2x" rather than "2.0x".
 * A line carrying `WHILE_POINTS_EXPIRE_TOKEN` is dropped unless `pointsExpire` is set -
 * off by default, so a caller that forgets to say gets the line hidden rather than a claim
 * that may not be true.
 */
export const resolveMembershipBenefits = (
  benefits: readonly string[],
  rates: LoyaltyRates,
  { pointsExpire = false }: { pointsExpire?: boolean } = {},
): string[] => {
  const memberRate = String(Number(rates.memberRate.toFixed(2)))
  return benefits
    .filter((benefit) => pointsExpire || !benefit.includes(WHILE_POINTS_EXPIRE_TOKEN))
    .map((benefit) =>
      benefit
        .split(WHILE_POINTS_EXPIRE_TOKEN)
        .join("")
        .split(MEMBER_RATE_TOKEN)
        .join(memberRate)
        .trim(),
    )
}

/**
 * The benefits as customers are shown them: the plan's own list, or the fallback for a plan
 * that has none, resolved against the live rates and the expiry switch.
 *
 * The join screen, the welcome email and the membership warnings all list or quote these, and
 * the first two used to resolve them inline - the same three lines twice, which is how a
 * third caller would have been the one to forget `pointsExpire`.
 */
export const loadMembershipBenefits = async (
  planBenefits: readonly string[],
): Promise<string[]> => {
  const [rates, pointsExpireFrom] = await Promise.all([
    getLoyaltyRates(),
    getPointsExpireFrom(),
  ])
  return resolveMembershipBenefits(
    planBenefits.length ? planBenefits : DEFAULT_MEMBERSHIP_BENEFITS,
    rates,
    { pointsExpire: pointsExpireFrom !== null },
  )
}

/**
 * The one benefit a warning names beside the discount, so a member about to lose their
 * membership hears what else goes with it - "your 20% member discount, free weekly Mochi
 * Series Bowl ($9.99) and your other member benefits".
 *
 * Taken from the resolved list, in the order the shop has put it in, rather than written into
 * the push: the list is edited from the website's admin, and a warning must not name a perk
 * the shop has dropped. The discount is skipped because the warning names it already, with the
 * member's own figure; "Cancel anytime" because it is not something anyone loses. Lower-cased
 * at the front so it reads mid-sentence. Null when nothing is left, and the warning names the
 * discount alone.
 *
 * The customer app's `lib/membership.ts` has a deliberate copy, run over the same served list,
 * so the banner names the same perk the push did.
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
