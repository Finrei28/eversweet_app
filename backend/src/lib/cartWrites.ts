import { Prisma } from "@prisma/client"
import { db } from "./db"

/**
 * The pieces every multi-table cart write shares. They lived in the cart controller until the
 * Stripe webhook needed them too: when a membership stops being paid up, the webhook takes
 * member-only lines out of the customer's cart through exactly the path a cart load uses.
 *
 * The lock order they all follow - OfferRedemption, then Loyalty, then Cart - is set out at
 * the top of cart.controller.ts.
 */

/**
 * Handing a held redemption back, as one `data` block because every release path -
 * removing an item, clearing the cart, the cart expiring, a membership lapsing and a
 * membership going on hold - has to agree.
 *
 * `status` goes with `used`. Releasing used to move the counter alone, which was
 * harmless only while `status` was written REDEEMED on every use; now that it means
 * "used up", leaving it behind would lock a gated offer out for good the first time
 * somebody changed their mind. AVAILABLE is unconditionally right here: redeeming
 * refuses at `used >= limit`, so `used <= limit` always, and every release below is
 * guarded by `used > 0` - so afterwards `used <= limit - 1`, which is short of the limit.
 */
export const RELEASE_REDEMPTION = {
  used: { decrement: 1 },
  status: "AVAILABLE",
} as const

/**
 * Prisma defaults an interactive transaction to 5s. A round trip to this
 * database costs the better part of a second, so a transaction making five or
 * six of them can exceed that as soon as two requests overlap — which is
 * exactly how adding two items quickly used to fail, with P2028 "transaction
 * already closed" after 5182ms. The work inside these transactions is small;
 * the time goes on waiting for the network, so the bound has to be set for a
 * remote database rather than a local one.
 */
export const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 }

/** Postgres's deadlock code, which Prisma surfaces without mapping. */
const isDeadlock = (error: unknown) =>
  error instanceof Error && error.message.includes("40P01")

/**
 * The two codes a lost race to create the first cart can arrive as.
 *
 * P2002 is the obvious one: both adds took upsert's create branch and one lost
 * the unique index on Cart.userId.
 *
 * P2014 is the same race wearing a different hat, and missing it is what made
 * four simultaneous adds return a 500. `Cart.user` is a required one-to-one, so
 * when the loser's `create` runs after the winner has committed, Prisma reads
 * its `connect` as detaching the cart the winner just made and reports a
 * violated relation instead of a duplicate key. Nothing is wrong with the
 * request - the cart it wanted to create simply already exists - so it retries
 * on exactly the same reasoning as P2002.
 */
const isCartCreateConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  (error.code === "P2002" || error.code === "P2014")

/**
 * Runs `work`, retrying once for the conflicts that are a normal part of
 * concurrent cart writes rather than a fault.
 *
 * P2002 / P2014: two adds racing to create the same customer's first cart. The
 * cart exists by the time the loser retries, so the retry takes the update
 * branch. See `isCartCreateConflict` for why one race produces two codes.
 *
 * 40P01: a deadlock. Consistent lock ordering makes these rare rather than
 * impossible - Postgres can still pick a victim when index or tuple locks
 * collide - and the loser is rolled back whole, so retrying is the correct
 * response rather than a way of hiding it.
 *
 * Either way the failed transaction committed nothing, so re-running it cannot
 * double up an offer redemption or a points debit.
 */
export const retryOnCartConflict = async <T>(
  work: () => Promise<T>,
): Promise<T> => {
  try {
    return await work()
  } catch (error) {
    if (isCartCreateConflict(error) || isDeadlock(error)) {
      return work()
    }

    throw error
  }
}

/**
 * Thrown inside a clean-up transaction to roll it back, when the rows it came
 * to sweep turn out to have been swept by someone else. Caught by the caller and
 * never surfaced: the cart is already in the state asked for.
 */
export class AlreadySwept extends Error {}

/**
 * Takes these lines out of the customer's cart and hands back the offer uses they held.
 * Returns how many went, or 0 when another request dealt with some of them first.
 *
 * Releases then the delete, in one transaction, in the lock order. The count is the claim:
 * fewer rows deleted than lines asked for means another request - a second load, the
 * customer removing one of them, or the webhook - has dealt with some already and handed
 * their redemptions back. Releasing from this caller's stale list would hand those back
 * twice, so it rolls back instead and leaves whatever is left to the next load.
 */
export const removeCartLines = async (
  userId: string,
  lines: { id: string; offerId: string | null }[],
): Promise<number> => {
  if (lines.length === 0) return 0

  try {
    return await retryOnCartConflict(() =>
      db.$transaction(async (tx) => {
        for (const line of lines) {
          if (!line.offerId) continue
          await tx.offerRedemption.updateMany({
            where: { offerId: line.offerId, userId, used: { gt: 0 } },
            data: RELEASE_REDEMPTION,
          })
        }

        const { count } = await tx.cartItem.deleteMany({
          where: { id: { in: lines.map((line) => line.id) } },
        })
        if (count !== lines.length) throw new AlreadySwept()
        return count
      }, TRANSACTION_OPTIONS),
    )
  } catch (error) {
    if (error instanceof AlreadySwept) return 0
    throw error
  }
}
