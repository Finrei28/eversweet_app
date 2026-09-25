import { formatInTimeZone } from "date-fns-tz"

import { db } from "./db"
import { forEachWithConcurrency } from "./concurrency"
import { headlinePerk, loadMembershipBenefits } from "./membership"
import { builtUpDiscountPercent } from "./memberPricing"
import { sendPushToUser } from "./pushToUser"
import { NZ_TIMEZONE, nzCalendarDay } from "./tradingHours"
import { getErrorMessage } from "../utils/getError"

/**
 * Warnings to a member who is about to lose what their membership has built up.
 *
 * The discount is a run of months paid in a row, and it starts again at the first step once
 * the subscription itself ends - a cancellation left to run its course, or a declined renewal
 * that stays unpaid through Stripe's retries. Nothing said so: a cancelled member saw "Expires
 * on" on a screen they had no reason to open again, and a declined renewal turned that same
 * screen red. These are the two pushes, and the app's banner words the same two states.
 *
 * Each names the discount, one perk from the plan's own list and "your other member
 * benefits", so the member hears everything that goes, not only the percentage.
 */

/** How far ahead of a cancelled membership's end the reminder goes. */
export const MEMBERSHIP_END_WARNING_DAYS = 3

/** As `warnPointsExpiring`: a few round trips each, sharing the pool with the app. */
const MEMBERS_AT_ONCE = 3

const DAY_MS = 24 * 60 * 60 * 1000

/** What the wording needs to know about a membership. */
export type AtStake = {
  /** What the run has built up, given or not - `builtUpDiscountPercent`. */
  discountPercent: number
  /** The plan's first step, which is where a new subscription starts. */
  stepPercent: number
  /** From `headlinePerk`; null names the discount alone. */
  perk: string | null
}

/** "Your 20% member discount, free weekly Mochi Series Bowl ($9.99) and your other member benefits". */
export const benefitsAtStake = ({ discountPercent, perk }: AtStake): string =>
  perk
    ? `Your ${discountPercent}% member discount, ${perk} and your other member benefits`
    : `Your ${discountPercent}% member discount and your other member benefits`

/**
 * The run only matters to someone who has climbed past the first step: anyone still on it
 * would rejoin at the same figure, and telling them the discount "starts again at 5%" from 5%
 * is a threat that means nothing.
 */
const restartClause = ({ discountPercent, stepPercent }: AtStake): string =>
  discountPercent > stepPercent
    ? ` If it ends, rejoining starts the discount again at ${stepPercent}%.`
    : ""

/** The reminder before a cancelled membership ends. */
export const membershipEndingText = (atStake: AtStake, endDate: Date): string =>
  `${benefitsAtStake(atStake)} end on ${formatInTimeZone(
    endDate,
    NZ_TIMEZONE,
    "EEEE d MMMM",
  )}. Re-subscribe before then to keep them.${restartClause(atStake)}`

/**
 * `Membership.paymentFailureCode` for a payment waiting on the member's bank to confirm it is
 * them (3D Secure). Nothing is wrong with the card, so the member is asked to confirm the
 * payment rather than to retry or replace it. The app's `lib/membership` reads the same value.
 */
export const AUTHENTICATION_REQUIRED = "authentication_required"

const unpaidClause = ({ discountPercent, stepPercent }: AtStake): string =>
  `If it stays unpaid, your membership ends${
    discountPercent > stepPercent
      ? ` and the discount starts again at ${stepPercent}%`
      : ""
  }.`

/** The push when a renewal is declined and the membership goes on hold. */
export const renewalDeclinedText = (atStake: AtStake): string =>
  `${benefitsAtStake(atStake)} are paused. Retry the payment in the app to keep them. ${unpaidClause(atStake)}`

/** The push when a renewal is on hold waiting for the member to confirm it with their bank. */
export const renewalNeedsAuthenticationText = (atStake: AtStake): string =>
  `Your bank needs you to confirm this month's membership payment. ${benefitsAtStake(atStake)} are paused until you do - tap to confirm it in the app. ${unpaidClause(atStake)}`

type PlanForWarning = {
  membershipDiscount: number
  maxDiscount: number
  benefits: string[]
}

const atStakeFor = async (
  membership: { totalMonths: number; plan: PlanForWarning },
  benefitsFor: (plan: PlanForWarning) => Promise<string[]>,
): Promise<AtStake> => ({
  discountPercent: builtUpDiscountPercent(membership),
  stepPercent: membership.plan.membershipDiscount,
  perk: headlinePerk(await benefitsFor(membership.plan)),
})

const planSelect = {
  select: { membershipDiscount: true, maxDiscount: true, benefits: true },
} as const

/**
 * Takes ownership of reminding one membership about one end date. True exactly once per date.
 *
 * Keyed on the date rather than a flag, as `claimExpiryWarning` is, and needing its `OR` for
 * the same reason: SQL's `<>` is never true against NULL, so `{ not: endDate }` alone would
 * never claim a membership that has not been reminded before. The rest of the `where` repeats
 * what made the membership a candidate, so one resumed, put on hold or ended since it was read
 * matches nothing and is not told it is ending.
 */
export const claimEndWarning = async (
  membershipId: string,
  endDate: Date,
): Promise<boolean> => {
  const { count } = await db.membership.updateMany({
    where: {
      id: membershipId,
      isActive: true,
      cancel: true,
      paymentStatus: "SUCCESS",
      endDate,
      OR: [{ endWarnedFor: null }, { endWarnedFor: { not: endDate } }],
    },
    data: { endWarnedFor: endDate },
  })
  return count === 1
}

/**
 * Reminds members whose cancelled membership ends within three days, once per end date.
 *
 * Mid-morning, like the points warning. "Within the three days" rather than "exactly three
 * days out", so a day the server missed delays a reminder instead of losing it, and a member
 * who cancels with a day left still hears what goes with it; the claim keeps that to one per
 * end date. Only a paid-up membership: one on hold has been told by the declined-renewal push,
 * and its end is Stripe's retries running out, not a date.
 *
 * Claims before sending, as `warnPointsExpiring` does. A crash in between loses one
 * reminder, which is quiet; a duplicate is a second push to someone who has chosen to leave.
 */
export const warnMembershipsEnding = async (
  now: Date = new Date(),
): Promise<{ warned: number }> => {
  try {
    // A day's slack on the query, then decided by Auckland calendar day below: an end at
    // 3 PM on the third day is inside the window at 10 AM, 77 hours ahead.
    const candidates = await db.membership.findMany({
      where: {
        isActive: true,
        cancel: true,
        paymentStatus: "SUCCESS",
        endDate: {
          gt: now,
          lte: new Date(now.getTime() + (MEMBERSHIP_END_WARNING_DAYS + 1) * DAY_MS),
        },
      },
      select: {
        id: true,
        userId: true,
        endDate: true,
        endWarnedFor: true,
        totalMonths: true,
        plan: planSelect,
      },
    })

    const lastDayToWarn = nzCalendarDay(
      new Date(now.getTime() + MEMBERSHIP_END_WARNING_DAYS * DAY_MS),
    )
    const due = candidates.filter(
      (m) =>
        // Calendar days compared as strings: "yyyy-MM-dd" sorts as it reads.
        nzCalendarDay(m.endDate) <= lastDayToWarn &&
        // Prisma cannot compare two columns, so the claim's own condition is checked here
        // too, to spare a round trip per member already reminded.
        m.endWarnedFor?.getTime() !== m.endDate.getTime(),
    )
    if (due.length === 0) return { warned: 0 }

    // Every membership is on the same plan in practice; resolved once per run rather than
    // once per member, since each resolution reads the settings.
    const benefits = new Map<string, Promise<string[]>>()
    const benefitsFor = (plan: PlanForWarning) => {
      const key = JSON.stringify(plan.benefits)
      if (!benefits.has(key)) benefits.set(key, loadMembershipBenefits(plan.benefits))
      return benefits.get(key)!
    }

    let warned = 0
    await forEachWithConcurrency(due, MEMBERS_AT_ONCE, async (membership) => {
      // Per member: one that fails must not leave everyone after it unwarned for the day.
      try {
        if (!(await claimEndWarning(membership.id, membership.endDate))) return

        const sent = await sendPushToUser(
          membership.userId,
          "Your membership ends soon",
          membershipEndingText(
            await atStakeFor(membership, benefitsFor),
            membership.endDate,
          ),
          { type: "MEMBERSHIP_ENDING" },
        )
        if (sent) warned += 1
      } catch (error) {
        console.error(
          `Could not remind membership ${membership.id} that it is ending:`,
          getErrorMessage(error),
        )
      }
    })

    if (warned > 0) console.log(`Reminded ${warned} member(s) that their membership ends soon`)
    return { warned }
  } catch (error) {
    console.error("Membership end reminder failed:", getErrorMessage(error))
    return { warned: 0 }
  }
}

/**
 * Tells a member their renewal was declined and their benefits are paused - or, when their
 * bank is waiting for them to confirm the payment, to confirm it.
 *
 * The caller claims the moment - the switch from paid-up to on hold, in
 * `recordMembershipPaymentFailure` - so this goes once per hold, not once per retry Stripe
 * makes. Never throws: the membership is written by the time this runs, and a webhook that
 * failed over a push would be redelivered by Stripe to no effect.
 */
export const warnRenewalDeclined = async (
  stripeSubscriptionId: string,
  { needsAuthentication = false }: { needsAuthentication?: boolean } = {},
): Promise<boolean> => {
  try {
    const membership = await db.membership.findUnique({
      where: { stripeSubscriptionId },
      select: { userId: true, totalMonths: true, plan: planSelect },
    })
    if (!membership) return false

    const atStake = await atStakeFor(membership, (plan) =>
      loadMembershipBenefits(plan.benefits),
    )
    // The same type either way: installed builds route it to /membership, where Retry is
    // what confirms the payment with the bank.
    return await sendPushToUser(
      membership.userId,
      needsAuthentication
        ? "Please confirm your membership payment"
        : "Your membership payment didn't go through",
      needsAuthentication
        ? renewalNeedsAuthenticationText(atStake)
        : renewalDeclinedText(atStake),
      { type: "MEMBERSHIP_PAYMENT_FAILED" },
    )
  } catch (error) {
    console.error(
      `Could not tell the member on subscription ${stripeSubscriptionId} their renewal was declined:`,
      getErrorMessage(error),
    )
    return false
  }
}
