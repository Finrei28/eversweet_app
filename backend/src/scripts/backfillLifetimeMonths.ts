import "dotenv/config"

import { db } from "../lib/db"
import { countLifetimePaidMonths } from "../lib/membershipMonths"
import { describeStripeFailure } from "../lib/stripeCustomer"

/**
 * One-off: brings every membership's `lifetimeMonths` up to what Stripe shows it paid.
 *
 * Migration 20260928000000_membership_lifetime_months (website repo) seeded the column from
 * `totalMonths`, the run, which is all a migration can see - so a member who had a break
 * starts with only the months since it. The webhook raises the count on every payment, but a
 * member who has left makes none. This reaches them, and any payment an order server from
 * before this change recorded between the migration and the deploy.
 *
 *   npx ts-node src/scripts/backfillLifetimeMonths.ts           dry run: lists what would change
 *   npx ts-node src/scripts/backfillLifetimeMonths.ts --apply   writes it
 *
 * Reads DATABASE_URL and STRIPE_SECRET_KEY from backend/.env. Run it with the live key: on a
 * test key Stripe cannot see live customers, every count comes back 0, and nothing is written
 * because the count only ever goes up. Running it twice is harmless for the same reason.
 *
 * A membership that fails is logged and the run carries on to the rest, but the script then
 * exits non-zero, so a run with failures never looks complete. Re-running retries them.
 *
 * Kept out of the build by tsconfig.build.json.
 */
const apply = process.argv.includes("--apply")
const PAGE_SIZE = 100

async function main() {
  const counts = { raised: 0, unchanged: 0, noCustomer: 0, failed: 0 }
  let after: string | undefined

  for (;;) {
    const memberships = await db.membership.findMany({
      select: {
        id: true,
        userId: true,
        lifetimeMonths: true,
        totalMonths: true,
        user: { select: { stripeCustomerId: true } },
      },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    })
    if (memberships.length === 0) break

    for (const membership of memberships) {
      const customerId = membership.user.stripeCustomerId
      if (!customerId) {
        counts.noCustomer += 1
        continue
      }

      try {
        const lifetimeMonths = Math.max(
          await countLifetimePaidMonths(customerId),
          membership.totalMonths,
        )
        if (lifetimeMonths <= membership.lifetimeMonths) {
          counts.unchanged += 1
          continue
        }

        console.log(
          `${apply ? "Raising" : "Would raise"} membership ${membership.id} (user ${membership.userId}): ${membership.lifetimeMonths} -> ${lifetimeMonths}`,
        )
        if (apply) {
          // Conditional, like the webhook's write, so a payment recorded meanwhile that took
          // the count higher still is never lowered by this.
          await db.membership.updateMany({
            where: { id: membership.id, lifetimeMonths: { lt: lifetimeMonths } },
            data: { lifetimeMonths },
          })
        }
        counts.raised += 1
      } catch (error) {
        counts.failed += 1
        console.error(
          `Failed on membership ${membership.id} (customer ${customerId}):`,
          describeStripeFailure(error),
        )
      }
    }

    after = memberships[memberships.length - 1].id
  }

  const { raised, ...rest } = counts
  console.log(
    apply ? "Done." : "Dry run: nothing was written. Re-run with --apply to write.",
    { [apply ? "raised" : "wouldRaise"]: raised, ...rest },
  )

  if (counts.failed > 0) {
    console.error(`${counts.failed} membership(s) failed; re-run to retry them.`)
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error("backfillLifetimeMonths failed:", error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
