import { Stripe } from "stripe"
import { DbTransactionClient } from "./db"
import { orNullIfMissing } from "./stripeErrors"
import { idOf, stripe } from "./stripeClient"

/** The only currency the shop charges in. */
export const CHARGE_CURRENCY = "nzd"

/**
 * Written into the metadata of every payment intent `createPaymentIntent` makes, and
 * required of any payment an order is placed, captured or refunded against.
 *
 * The customer check alone is not enough: a member's subscription invoices are paid on the
 * same Stripe customer as their orders. Without the tag a membership payment could be
 * spent on a cart of the same price — or refunded while the membership it paid for carried
 * on.
 */
export const ORDER_PAYMENT_PURPOSE = "app_order"

/**
 * Written into the metadata of every payment the website's checkout creates. The website
 * places and captures its own orders, but the stranded-payment sweep settles its payments
 * too - see `ORDER_PAYMENT_TAGS` in `lib/strandedPayments`.
 */
export const WEBSITE_PAYMENT_SOURCE = "website"

/** A refusal to hand straight back to the client. */
export type PaymentRefusal = {
  status: number
  body: { message: string; refunded?: boolean; released?: boolean }
}

/**
 * What `settleOrderPayment` decided: a refusal, or that the order may be written — with the
 * payment to capture as the last step before it commits, or null when the money has
 * already been taken.
 */
export type PaymentSettlement =
  | { refusal: PaymentRefusal; capture?: never }
  | { capture: string | null; refusal?: never }

/** The payment was on hold and the hold is gone — released by the sweep, or expired. */
export const EXPIRED_HOLD: PaymentRefusal = {
  status: 409,
  body: {
    message:
      "This payment expired before your order was placed. You haven't been charged. Please check out again.",
    released: true,
  },
}

/** Thrown by `captureOrderPayment` when the hold it was sent to capture no longer exists. */
export class HoldReleasedError extends Error {}

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
 * Serialises everything that decides a payment's fate: settling it for an order, and the
 * sweep releasing or refunding it. Transaction-scoped, so it is released when the
 * transaction ends, and keyed on the payment alone, so it takes no part in the cart's
 * OfferRedemption → Loyalty → Cart row lock order.
 */
export const lockPayment = (tx: DbTransactionClient, paymentIntentId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${paymentIntentId}, 0))`

/**
 * Hands a taken payment back in full. One set of parameters and one idempotency key for
 * every caller — `settleOrderPayment` and the stranded-payment sweep — so however the two
 * interleave, a payment is refunded once; Stripe refuses a reused key with different
 * parameters, which is why the reason goes to the log rather than into the request.
 *
 * A website payment has no user, and is refunded with no metadata at all: exactly what the
 * website's own `createNewOrder` sends under this key, so its refund and the sweep's are one.
 */
export const refundOrderPayment = (intent: Stripe.PaymentIntent, userId?: string) =>
  stripe.refunds.create(
    { payment_intent: intent.id, ...(userId ? { metadata: { userId } } : {}) },
    { idempotencyKey: `order-refund:${intent.id}` },
  )

/** Lets go of a hold without taking anything. */
export const releaseHold = (paymentIntentId: string) =>
  stripe.paymentIntents.cancel(paymentIntentId, {
    cancellation_reason: "abandoned",
  })

/**
 * Takes the money for an order. Called as the last step of the order's transaction, so a
 * capture that fails leaves no order behind, and keyed so that a retry after a lost
 * response cannot take it twice.
 */
export async function captureOrderPayment(paymentIntentId: string) {
  try {
    await stripe.paymentIntents.capture(
      paymentIntentId,
      {},
      { idempotencyKey: `order-capture:${paymentIntentId}` },
    )
  } catch (error) {
    if (
      error instanceof Stripe.errors.StripeInvalidRequestError &&
      error.code === "payment_intent_unexpected_state"
    ) {
      throw new HoldReleasedError(
        `Payment ${paymentIntentId} was no longer on hold when its order was placed`,
      )
    }
    throw error
  }
}

/**
 * Decides whether a payment really pays for this order. Must run inside the order's
 * transaction, before anything is written.
 *
 * `createOrder` used to take the payment intent id on trust. It was never looked up, so any
 * signed-in customer could place a real order — a kitchen ticket and a confirmation email —
 * with no payment at all or an id they made up, and any id at all also skipped the
 * trading-hours refusal.
 *
 * **The normal case is a hold.** `createPaymentIntent` authorises the card without taking
 * the money, and the money is captured only once the order has been written. Until then
 * nothing has moved, so a cart that changed during payment, a pick-up time the store has
 * closed on since, or a member-only item held by someone whose membership has since gone on
 * hold, is refused by letting the hold go: no refund, no fee, nothing on the customer's
 * statement. This used to charge at confirmation, which left refunding as the
 * only answer to a mismatch, a store that had closed as something to accept anyway, and a
 * crash between payment and order as a charged customer with no order.
 *
 * **A payment that has already been taken** reaches here only through one gap: the capture
 * succeeded and the order's commit then failed, since Stripe and Postgres cannot commit
 * together. A retry with the same cart is accepted without capturing again. One that no
 * longer matches is refunded in full — never accepted at the amount paid, which would
 * honour exactly the tampering this exists to stop.
 *
 * The advisory lock is what keeps releasing, capturing and refunding apart. Two requests
 * racing on one payment — one that read the cart as paid for, one that read it after an
 * edit — would otherwise each pass their own check, and the shop could both make the order
 * and let the money go. Held from the Stripe read to the order's commit, it means whichever
 * comes second sees the first's outcome.
 */
export async function settleOrderPayment(
  tx: DbTransactionClient,
  {
    paymentIntentId,
    userId,
    stripeCustomerId,
    payableInCents,
    refusedBecause,
  }: {
    paymentIntentId: string
    userId: string
    stripeCustomerId: string | null
    payableInCents: number
    /**
     * Why this order can no longer be placed, as a sentence for the customer, or null if it
     * still can. A pick-up time the store has closed on, or a member-only item the customer
     * is no longer a paid-up member for. It used to carry the pick-up time alone.
     */
    refusedBecause: string | null
  },
): Promise<PaymentSettlement> {
  await lockPayment(tx, paymentIntentId)

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
    return { refusal: { status: 404, body: { message: "Payment not found" } } }
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
      refusal: {
        status: 400,
        body: { message: "This payment can't be used for an order" },
      },
    }
  }

  // Under the lock, so an order committed by a concurrent attempt is visible. Asked only on
  // the way to letting a payment go: an order that exists must never lose its payment.
  const alreadyOrdered = async () =>
    !!(await tx.order.findUnique({
      where: { paymentIntentId },
      select: { id: true },
    }))

  const usedForAnOrder: PaymentSettlement = {
    refusal: {
      status: 409,
      body: { message: "This payment has already been used for an order." },
    },
  }

  if (intent.status === "requires_capture") {
    const matches =
      intent.amount_capturable === payableInCents &&
      intent.currency === CHARGE_CURRENCY

    if (matches && !refusedBecause) return { capture: intent.id }

    if (await alreadyOrdered()) {
      console.error(
        `Payment ${intent.id} is still on hold but already has an order; left for the sweep to capture.`,
      )
      return usedForAnOrder
    }

    await releaseHold(intent.id)

    if (!matches) {
      console.error(
        `Released the hold on payment ${intent.id} for user ${userId}: held ${intent.amount_capturable} ` +
          `${intent.currency}, cart is worth ${payableInCents} ${CHARGE_CURRENCY}. No order was created.`,
      )
      return {
        refusal: {
          status: 409,
          body: {
            message:
              "Your cart changed while you were paying, so we didn't take the payment. Please check your cart and try again.",
            released: true,
          },
        },
      }
    }

    return {
      refusal: {
        status: 400,
        body: {
          message: `${refusedBecause} You haven't been charged.`,
          released: true,
        },
      },
    }
  }

  if (intent.status === "canceled") return { refusal: EXPIRED_HOLD }

  if (intent.status !== "succeeded") {
    return {
      refusal: {
        status: 400,
        body: { message: "Your payment hasn't gone through. Please try again." },
      },
    }
  }

  // Taken already: the capture-to-commit gap described above.
  if (refundOf(intent) > 0) {
    return {
      refusal: {
        status: 409,
        body: {
          message: "This payment has been refunded. Please check out again.",
          refunded: true,
        },
      },
    }
  }

  if (
    intent.amount_received === payableInCents &&
    intent.currency === CHARGE_CURRENCY
  ) {
    return { capture: null }
  }

  if (await alreadyOrdered()) return usedForAnOrder

  await refundOrderPayment(intent, userId)

  console.error(
    `Refunded payment ${intent.id} for user ${userId}: paid ${intent.amount_received} ${intent.currency}, ` +
      `cart is worth ${payableInCents} ${CHARGE_CURRENCY}. No order was created.`,
  )

  return {
    refusal: {
      status: 409,
      body: {
        message: `Your cart changed while you were paying, so we've refunded ${dollars(
          intent.amount_received,
        )}. Please check your cart and try again.`,
        refunded: true,
      },
    },
  }
}
