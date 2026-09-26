import { Stripe } from "stripe"

import { idOf, stripe } from "./stripeClient"

/** The invoices that pay for a month of membership, as opposed to prorations or one-offs. */
const MEMBERSHIP_MONTH_REASONS = new Set<Stripe.Invoice.BillingReason>([
  "subscription_create",
  "subscription_cycle",
])

export const paysForAMonth = (invoice: Stripe.Invoice) =>
  !!invoice.billing_reason &&
  MEMBERSHIP_MONTH_REASONS.has(invoice.billing_reason)

/** The subscription an invoice was raised for, in either shape Stripe sends. */
export const subscriptionIdOf = (invoice: Stripe.Invoice) =>
  idOf(invoice.lines?.data[0]?.subscription) ??
  idOf(invoice.parent?.subscription_details?.subscription)

/**
 * Every month of membership the customer has ever paid for, across all their subscriptions,
 * breaks included - where `countConsecutivePaidMonths` (the webhook's) is the run on one
 * subscription and starts again after a break.
 *
 * Read from Stripe and written as it stands, like the run, so a redelivered payment changes
 * nothing. Membership invoices are the only subscription invoices on a member's customer (app
 * orders are payment intents, and the website's customers are its own), so a paid monthly
 * invoice for any subscription is a month of membership. The invoice being delivered, when
 * there is one, counts whether or not the list has caught up with it.
 */
export async function countLifetimePaidMonths(
  customerId: string,
  justPaid?: Stripe.Invoice,
): Promise<number> {
  let months = 0
  let justPaidListed = false
  let startingAfter: string | undefined

  for (;;) {
    const page = await stripe.invoices.list({
      customer: customerId,
      status: "paid",
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })

    for (const invoice of page.data) {
      if (invoice.status !== "paid") continue
      if (!paysForAMonth(invoice) || !subscriptionIdOf(invoice)) continue
      if (invoice.id === justPaid?.id) justPaidListed = true
      months += 1
    }

    const last = page.data[page.data.length - 1]
    if (!page.has_more || !last?.id) break
    startingAfter = last.id
  }

  if (justPaid && !justPaidListed && paysForAMonth(justPaid)) months += 1
  return months
}
