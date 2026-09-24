import { formatInTimeZone } from "date-fns-tz"

import { db, type DbTransactionClient } from "./db"
import { getPointsExpireFrom } from "./loyaltyRates"
import { sendPushToUser } from "./pushToUser"
import { NZ_TIMEZONE, nzCalendarDay, nzEndOfDayMonthsAfter } from "./tradingHours"
import { getErrorMessage } from "../utils/getError"

/**
 * Sweet Points expire when a month passes without an app order, to give customers a reason
 * to come back. The whole balance goes at once.
 *
 * This file is the one definition of when. The balance endpoint, the warning push and the
 * nightly sweep all ask `pointsExpireAt`, so the date the app shows, the date the warning
 * names and the date the points actually go cannot disagree.
 */

export const POINTS_EXPIRE_AFTER_MONTHS = 1

/** How far ahead of the deadline the warning push goes. */
export const EXPIRY_WARNING_DAYS = 7

/** The Loyalty rows' ledger reason for an expiry. The leaderboard counts only EARNED. */
export const EXPIRED_REASON = "EXPIRED"

/** What the rule needs to know about one customer. */
export type ExpiryActivity = {
  /** Their most recent app order. Website orders are not tied to an account and cannot count. */
  lastOrderAt: Date | null
  membership: {
    endDate: Date
    /** The codebase's one definition of a member: `isActive` and paid up. */
    isMember: boolean
  } | null
}

export const NO_ACTIVITY: ExpiryActivity = { lastOrderAt: null, membership: null }

/**
 * When this customer's points expire - the last instant of that Auckland day - or null if
 * they do not.
 *
 * - **Off** (`expiryFrom` null): never.
 * - **An active member:** never, for as long as the membership runs. That is the user-facing
 *   promise, and it is the membership benefit that goes with this rule.
 * - **Otherwise** a month after the latest of:
 *   - their last app order - any order, one paid entirely in points included;
 *   - the end of a membership that has actually ended, so a lapsed member gets a full month
 *     from losing it rather than from an order they placed months ago. Only an *ended* one:
 *     `createMembership` writes an end date a month ahead before the first payment is even
 *     attempted, so a join that never paid carries a future date, and counting it would give
 *     a failed join attempt an extra month;
 *   - `expiryFrom`, the moment the switch went on. Nobody's month is counted from before it,
 *     which is the launch grace: every balance gets a full month's notice.
 */
export const pointsExpireAt = (
  activity: ExpiryActivity,
  expiryFrom: Date | null,
  now: Date,
): Date | null => {
  const anchor = expiryAnchor(activity, expiryFrom, now)
  return anchor ? nzEndOfDayMonthsAfter(anchor, POINTS_EXPIRE_AFTER_MONTHS) : null
}

/** The instant the month is counted from, or null when the points do not expire. */
export const expiryAnchor = (
  { lastOrderAt, membership }: ExpiryActivity,
  expiryFrom: Date | null,
  now: Date,
): Date | null => {
  if (!expiryFrom) return null
  if (membership?.isMember) return null

  const endedMembership =
    membership && membership.endDate <= now ? membership.endDate : null

  return [lastOrderAt, endedMembership, expiryFrom].reduce<Date>(
    (latest, candidate) =>
      candidate && candidate.getTime() > latest.getTime() ? candidate : latest,
    expiryFrom,
  )
}

/**
 * The activity the rule needs, for many customers in two queries rather than two each.
 * The last order comes from `Order`'s own `(appUserId, createdAt)` index, so nothing new has
 * to be written - and kept right - inside the order transaction.
 */
export const loadExpiryActivity = async (
  userIds: string[],
): Promise<Map<string, ExpiryActivity>> => {
  const [orders, memberships] = await Promise.all([
    db.order.groupBy({
      by: ["appUserId"],
      where: { appUserId: { in: userIds } },
      _max: { createdAt: true },
    }),
    db.membership.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        endDate: true,
        isActive: true,
        paymentStatus: true,
      },
    }),
  ])

  const activity = new Map<string, ExpiryActivity>()
  const entry = (userId: string) => {
    let found = activity.get(userId)
    if (!found) {
      found = { lastOrderAt: null, membership: null }
      activity.set(userId, found)
    }
    return found
  }

  for (const order of orders) {
    if (order.appUserId) entry(order.appUserId).lastOrderAt = order._max.createdAt
  }
  for (const membership of memberships) {
    entry(membership.userId).membership = {
      endDate: membership.endDate,
      isMember: membership.isActive && membership.paymentStatus === "SUCCESS",
    }
  }
  return activity
}

/**
 * One customer's deadline, for the balance endpoint and the cart's refunds.
 *
 * The switch first, and nothing else while it is off. It almost always answers from the
 * settings cache, so off costs no query at all - which matters because this runs on every
 * balance fetch, and expiry ships switched off.
 */
export const pointsExpiryForUser = async (
  userId: string,
  now: Date = new Date(),
): Promise<Date | null> => {
  const expiryFrom = await getPointsExpireFrom()
  if (!expiryFrom) return null

  const activity = await loadExpiryActivity([userId])
  return pointsExpireAt(activity.get(userId) ?? NO_ACTIVITY, expiryFrom, now)
}

/**
 * Whether points the cart gives back now should land already expired.
 *
 * Points leave the balance when a reward goes into the cart, so the nightly sweep cannot
 * see them, and an expired cart is only refunded when the customer next opens it. Without
 * this a customer could leave rewards in a cart for months, come back, have them refunded and
 * order that day - keeping points that expired weeks before. So a refund after the deadline
 * gives nothing back: the points expired with the rest of the balance.
 *
 * Asked before the refund's transaction, and by a caller only when there is something to
 * refund; free while expiry is off (see `pointsExpiryForUser`).
 */
export const refundLandsExpired = async (
  userId: string,
  now: Date = new Date(),
): Promise<boolean> => {
  const deadline = await pointsExpiryForUser(userId, now)
  return deadline !== null && now.getTime() > deadline.getTime()
}

/**
 * Hands points from the cart back - or, past the deadline, writes down that they expired.
 *
 * One `loyalty.update` either way, at the same point in the caller's transaction, so the
 * cart's lock order (OfferRedemption, then Loyalty, then Cart) is exactly what it was. An
 * expired refund leaves the balance alone and records both halves, REFUND then EXPIRED, so
 * the history says what happened rather than showing points that silently never returned.
 */
export const creditRefund = (
  tx: DbTransactionClient,
  userId: string,
  points: number,
  landsExpired: boolean,
) =>
  tx.loyalty.update({
    where: { userId },
    data: landsExpired
      ? {
          records: {
            create: [
              { change: points, reason: "REFUND" },
              { change: -points, reason: EXPIRED_REASON },
            ],
          },
        }
      : {
          points: { increment: points },
          records: { create: { change: points, reason: "REFUND" } },
        },
  })

type Balance = { id: string; userId: string; points: number }

/**
 * Takes one balance to zero and writes it down. True only for the caller that did it.
 *
 * Conditional on everything the decision was made on, in the one statement:
 * - **`points: observed`.** Cron runs in every instance, so two processes reach the same
 *   balance together; the loser finds it already zero and writes nothing. A refund or an
 *   earn landing between the read and this also changes it, and the balance is left for
 *   tomorrow rather than clobbered - zeroing a figure we never saw would take points the
 *   customer earned a second ago.
 * - **No app order after the anchor.** A points-only order changes no balance, so the check
 *   above cannot see one committed since the read. This does.
 * - **Still not an active member**, read under a lock. The sweep read the membership before
 *   deciding; a first payment or a renewal the Stripe webhook activates after that read made
 *   the customer exempt, and expiring them anyway takes a member's points. A condition in the
 *   update alone would still miss an activation committing while that statement runs, so the
 *   membership row is read `FOR SHARE` first: an activation already in progress is waited
 *   for and then seen, and one arriving later waits for this to commit - at which point the
 *   customer was not a member when the points went. No deadlock is possible: every Membership
 *   write is a statement of its own, and nothing takes Loyalty and then Membership.
 */
export const expireBalance = async (
  balance: Balance,
  anchor: Date,
): Promise<boolean> =>
  db.$transaction(
    async (tx) => {
      const [membership] = await tx.$queryRaw<
        { isActive: boolean; paymentStatus: string }[]
      >`SELECT "isActive", "paymentStatus" FROM "Membership" WHERE "userId" = ${balance.userId} FOR SHARE`
      if (membership?.isActive && membership.paymentStatus === "SUCCESS") {
        return false
      }

      const { count } = await tx.loyalty.updateMany({
        where: {
          id: balance.id,
          points: balance.points,
          User: { appOrders: { none: { createdAt: { gt: anchor } } } },
        },
        data: { points: 0 },
      })
      if (count !== 1) return false

      await tx.loyaltyRecord.create({
        data: {
          loyaltyId: balance.id,
          change: -balance.points,
          reason: EXPIRED_REASON,
        },
      })
      return true
    },
    // The API is in Singapore and Postgres in Sydney: three round trips here are nearly three
    // seconds, well past Prisma's 5s default once a pool is busy.
    { timeout: 20_000, maxWait: 10_000 },
  )

/**
 * Expires every balance whose deadline has passed. Nightly, just after Auckland midnight, so
 * a deadline at the end of yesterday has gone by.
 *
 * Points a customer had put in their cart were taken from the balance when they did, and
 * come back as a REFUND if the cart is emptied or expires. Those can arrive after this has
 * run. They need nothing special: the deadline is still in the past, so tomorrow's run takes
 * them.
 *
 * Never throws - it runs from cron, where a throw is unhandled.
 */
export const expireInactivePoints = async (
  now: Date = new Date(),
): Promise<{ expired: number }> => {
  try {
    const expiryFrom = await getPointsExpireFrom()
    if (!expiryFrom) return { expired: 0 }

    const balances = await db.loyalty.findMany({
      where: { points: { gt: 0 } },
      select: { id: true, userId: true, points: true },
    })
    if (balances.length === 0) return { expired: 0 }

    const activity = await loadExpiryActivity(balances.map((b) => b.userId))

    let expired = 0
    for (const balance of balances) {
      const customer = activity.get(balance.userId) ?? NO_ACTIVITY
      const anchor = expiryAnchor(customer, expiryFrom, now)
      if (!anchor) continue

      const deadline = nzEndOfDayMonthsAfter(anchor, POINTS_EXPIRE_AFTER_MONTHS)
      if (now.getTime() <= deadline.getTime()) continue

      try {
        if (await expireBalance(balance, anchor)) expired += 1
      } catch (error) {
        // One balance failing must not stop the rest; it is simply tried again tomorrow.
        console.error(
          `Could not expire points for loyalty ${balance.id}:`,
          getErrorMessage(error),
        )
      }
    }

    if (expired > 0) console.log(`Expired ${expired} inactive points balance(s)`)
    return { expired }
  } catch (error) {
    console.error("Points expiry sweep failed:", getErrorMessage(error))
    return { expired: 0 }
  }
}

/**
 * Takes ownership of warning about one deadline. True exactly once per deadline.
 *
 * Keyed on the deadline rather than a flag, so an order that moves the deadline makes the
 * next warning due again with nothing to reset. The `OR` is not decoration: SQL's `<>`
 * is never true against NULL, so `{ not: deadline }` alone would never claim a balance that
 * has not been warned before - which is every balance, the first time.
 */
export const claimExpiryWarning = async (
  loyaltyId: string,
  deadline: Date,
): Promise<boolean> => {
  const { count } = await db.loyalty.updateMany({
    where: {
      id: loyaltyId,
      OR: [{ expiryWarnedFor: null }, { expiryWarnedFor: { not: deadline } }],
    },
    data: { expiryWarnedFor: deadline },
  })
  return count === 1
}

/**
 * Tells customers their points are about to go, once, in the week before.
 *
 * Mid-morning rather than beside the midnight sweep: nobody should be woken by a points
 * reminder. "Within the week" rather than "exactly seven days out", so a day the server
 * missed delays a warning instead of losing it; the claim keeps that to one per deadline.
 *
 * Claims before sending, as `announceOffers` does. A crash in between loses one warning,
 * which is quiet; a duplicate is a second push to someone already drifting away.
 */
export const warnPointsExpiring = async (
  now: Date = new Date(),
): Promise<{ warned: number }> => {
  try {
    const expiryFrom = await getPointsExpireFrom()
    if (!expiryFrom) return { warned: 0 }

    const balances = await db.loyalty.findMany({
      where: { points: { gt: 0 } },
      select: { id: true, userId: true, points: true },
    })
    if (balances.length === 0) return { warned: 0 }

    const activity = await loadExpiryActivity(balances.map((b) => b.userId))
    const lastDayToWarn = nzCalendarDay(
      new Date(now.getTime() + EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000),
    )

    let warned = 0
    for (const balance of balances) {
      const deadline = pointsExpireAt(
        activity.get(balance.userId) ?? NO_ACTIVITY,
        expiryFrom,
        now,
      )
      if (!deadline || deadline.getTime() < now.getTime()) continue
      // Calendar days compared as strings: "yyyy-MM-dd" sorts as it reads.
      if (nzCalendarDay(deadline) > lastDayToWarn) continue

      if (!(await claimExpiryWarning(balance.id, deadline))) continue

      const day = formatInTimeZone(deadline, NZ_TIMEZONE, "EEEE d MMMM")
      const sent = await sendPushToUser(
        balance.userId,
        "Your Sweet Points expire soon",
        `Your ${balance.points} points expire at the end of ${day}. Place an order to keep them.`,
        { type: "POINTS_EXPIRING" },
      )
      if (sent) warned += 1
    }

    if (warned > 0) console.log(`Warned ${warned} customer(s) about expiring points`)
    return { warned }
  } catch (error) {
    console.error("Points expiry warning failed:", getErrorMessage(error))
    return { warned: 0 }
  }
}
