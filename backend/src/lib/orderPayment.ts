import { Stripe } from "stripe"
import { DbTransactionClient } from "./db"
import { orNullIfMissing } from "./stripeErrors"
import { idOf, stripe } from "./stripeClient"

/** The only currency the shop charges in. */
export const CHARGE_CURRENCY = "nzd"

/**
 * Written into the metadata of every payment intent `createPaymentIntent` makes, and
 * required of any payment an order is placed or refunded against.
 *
 * The customer check alone is not enough: a member's subscription invoices are paid on the
 * same Stripe customer as their orders. Without the tag a membership payment could be
 * spent on a cart of the same price — or, on a mismatch, refunded while the membership it
 * paid for carried on.
 */
export const ORDER_PAYMENT_PURPOSE = "app_order"

/** A refusal to hand straight back to the client. */
export type PaymentRefusal = {
  status: number
  body: { message: string; refunded?: boolean }
}

/**
 * How much of a payment has been handed back.
 *
 * A refund does not change a payment intent's status — it still reads "succeeded" — so
 * this is the only thing that stops a refunded payment being spent on an order. Read
 * from the charge, which has to have been expanded; an id where the charge should be
 * throws rather than being read as "nothing refunded".
 */
export const refundOf = (intent: Stripe.PaymentIntent): number => {
  const charge = intent.latest_charge
  // No charge yet: nothing has been taken, so nothing has been handed back.
  if (charge == null) return 0
  if (typeof charge === "string") {
    throw new Error(`Payment ${intent.id} was read without its charge expanded`)
  }
  return charge.amount_refunded
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * Decides whether a payment really pays for this order: null when it does, a refusal
 * when it does not. Must run inside the order's transaction, before anything is written.
 *
 * `createOrder` used to take the payment intent id on trust. It was never looked up, so
 * any signed-in customer could place a real order — a kitchen ticket and a confirmation
 * email — with no payment at all or an id they made up, and any id at all also skipped
 * the trading-hours refusal.
 *
 * A real payment that does not match the cart is refunded in full, never accepted at the
 * amount paid: that would honour exactly the tampering this exists to stop. A genuine
 * customer should never land here — `createPaymentIntent` checks the amount against the
 * cart seconds before the charge — so the refund is for the rare cart that changed during
 * payment, and for anyone trying it on.
 *
 * The advisory lock is what makes refunding safe. Two requests racing on one payment — one
 * that read the cart as paid for, one that read it after an edit — would otherwise each
 * pass their own check, and the shop would both make the order and give the money back.
 * Holding the lock from the Stripe read to the order's commit means whichever comes second
 * sees the first's outcome: the order, or the refund. It is keyed on the payment alone, so
 * it takes no part in the cart's OfferRedemption → Loyalty → Cart row lock order.
 */
export async function settleOrderPayment(
  tx: DbTransactionClient,
  {
    paymentIntentId,
    userId,
    stripeCustomerId,
    payableInCents,
  }: {
    paymentIntentId: string
    userId: string
    stripeCustomerId: string | null
    payableInCents: number
  },
): Promise<PaymentRefusal | null> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentIntentId}, 0))`

  const intent = await orNullIfMissing(
    stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge"],
    }),
  )

  // One answer for an id Stripe has never issued and for someone else's payment, so this
  // cannot be used to learn whether an id is real.
  if (
    !intent ||
    !stripeCustomerId ||
    idOf(intent.customer) !== stripeCustomerId
  ) {
    return { status: 404, body: { message: "Payment not found" } }
  }

  if (
    intent.metadata?.purpose !== ORDER_PAYMENT_PURPOSE ||
    intent.metadata?.userId !== userId
  ) {
    // Logged loudly because one legitimate case exists: a checkout that was already paying
    // when the server that tags payments was deployed. That customer has paid, and this
    // line is how staff find the payment to refund by hand.
    console.error(
      `Order refused: payment ${intent.id} (${intent.status}, ${intent.amount_received} ${intent.currency}) ` +
        `on user ${userId}'s customer was not created for an app order.`,
    )
    return {
      status: 400,
      body: { message: "This payment can't be used for an order" },
    }
  }

  if (intent.status !== "succeeded") {
    return {
      status: 400,
      body: { message: "Your payment hasn't gone through. Please try again." },
    }
  }

  if (refundOf(intent) > 0) {
    return {
      status: 409,
      body: {
        message: "This payment has been refunded. Please check out again.",
        refunded: true,
      },
    }
  }

  if (
    intent.amount_received === payableInCents &&
    intent.currency === CHARGE_CURRENCY
  ) {
    return null
  }

  // Under the lock, so an order committed by a concurrent attempt is visible here. A
  // payment that has already bought an order is never refunded from this path.
  const existing = await tx.order.findUnique({
    where: { paymentIntentId },
    select: { id: true },
  })

  if (existing) {
    return {
      status: 409,
      body: { message: "This payment has already been used for an order." },
    }
  }

  // Keyed on the payment, so a retry after a lost response cannot refund it twice.
  await stripe.refunds.create(
    {
      payment_intent: intent.id,
      metadata: { reason: "order_amount_mismatch", userId },
    },
    { idempotencyKey: `order-refund:${intent.id}` },
  )

  console.error(
    `Refunded payment ${intent.id} for user ${userId}: paid ${intent.amount_received} ${intent.currency}, ` +
      `cart is worth ${payableInCents} ${CHARGE_CURRENCY}. No order was created.`,
  )

  return {
    status: 409,
    body: {
      message: `Your cart changed while you were paying, so we've refunded ${dollars(
        intent.amount_received,
      )}. Please check your cart and try again.`,
      refunded: true,
    },
  }
}
