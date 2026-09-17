import "dotenv/config"

import { db } from "../lib/db"
import { stripe } from "../lib/stripeClient"
import {
  customerDetailsOf,
  describeStripeFailure,
  staleCustomerDetails,
} from "../lib/stripeCustomer"
import { orNullIfMissing } from "../lib/stripeErrors"

/**
 * One-off: gives every existing Stripe customer its user's name, email and phone.
 *
 * Customers used to be created with those in metadata only, which the Stripe Dashboard does
 * not show. `getOrCreateCustomerId` now fills a customer in whenever it is next used; this
 * reaches the ones that never will be, and because the Dashboard reads a payment's customer
 * as it is now, it labels every past app payment as well.
 *
 *   npx ts-node src/scripts/syncStripeCustomers.ts           dry run: lists what would change
 *   npx ts-node src/scripts/syncStripeCustomers.ts --apply   writes it
 *
 * Reads DATABASE_URL and STRIPE_SECRET_KEY from backend/.env, so with the production values
 * `--apply` writes to the live Stripe account. Running it twice is harmless: a customer that
 * is already up to date is skipped.
 *
 * A customer that fails is logged and the run carries on to the rest, but the script then
 * exits non-zero, so a run with failures never looks complete. Re-running retries them.
 *
 * Kept out of the build by tsconfig.build.json.
 */
const apply = process.argv.includes("--apply")
const PAGE_SIZE = 100

async function main() {
  const counts = { updated: 0, unchanged: 0, missing: 0, failed: 0 }
  let after: string | undefined

  for (;;) {
    const users = await db.user.findMany({
      where: { stripeCustomerId: { not: null } },
      select: {
        id: true,
        stripeCustomerId: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    })
    if (users.length === 0) break

    for (const user of users) {
      const customerId = user.stripeCustomerId!

      try {
        const customer = await orNullIfMissing(
          stripe.customers.retrieve(customerId),
        )
        if (!customer || customer.deleted) {
          counts.missing += 1
          continue
        }

        const stale = staleCustomerDetails(customer, customerDetailsOf(user))
        if (!stale) {
          counts.unchanged += 1
          continue
        }

        // Field names only: the values are customers' personal details.
        console.log(
          `${apply ? "Updating" : "Would update"} ${customerId} (user ${user.id}): ${Object.keys(stale).join(", ")}`,
        )
        if (apply) await stripe.customers.update(customerId, stale)
        counts.updated += 1
      } catch (error) {
        counts.failed += 1
        console.error(
          `Failed on ${customerId} (user ${user.id}):`,
          describeStripeFailure(error),
        )
      }
    }

    after = users[users.length - 1].id
  }

  const { updated, ...rest } = counts
  console.log(
    apply ? "Done." : "Dry run: nothing was written. Re-run with --apply to write.",
    { [apply ? "updated" : "wouldUpdate"]: updated, ...rest },
  )

  // Each customer that failed was logged and the rest carried on, but the run as a whole is
  // not complete: exit non-zero, so an unattended --apply is not mistaken for a clean one.
  if (counts.failed > 0) {
    console.error(`${counts.failed} customer(s) failed; re-run to retry them.`)
    process.exitCode = 1
  }
}

main()
  .catch((error) => {
    console.error("syncStripeCustomers failed:", error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
