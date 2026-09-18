import { Stripe } from "stripe"

import { db } from "./db"
import {
  captureOrderPayment,
  lockPayment,
  ORDER_PAYMENT_PURPOSE,
  refundOf,
  refundOrderPayment,
  releaseHold,
  WEBSITE_PAYMENT_SOURCE,
} from "./orderPayment"
import { stripe } from "./stripeClient"
import { orNullIfMissing } from "./stripeErrors"
import { getErrorMessage } from "../utils/getError"

/**
 * How long a payment may wait for its order before it is treated as abandoned. The app
 * places the order seconds after paying, and retries a dropped attempt straight away; half
 * an hour is far past either, and short enough that a hold soon drops off the customer's
 * banking app.
 */
export const STRANDED_AFTER_MS = 30 * 60 * 1000

/**
 * How far back taken payments are looked for. Each run re-reads this much, so it bounds
 * the work; anything older has already had many runs, and any left is for staff.
 */
export const REFUND_WINDOW_MS = 48 * 60 * 60 * 1000

const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 }

const unixSeconds = (ms: number) => Math.floor(ms / 1000)

/**
 * The payments this sweep settles, by the metadata the code that creates them tags them with:
 * the app's (`createPaymentIntent`), and the website's (its `/api/checkout_sessions`). The
 * website holds a card and captures it in its `createNewOrder` the same way `createOrder`
 * does - under the same lock, with the same capture and refund keys - so both are settled
 * alike. Stripe search cannot mix AND with OR, so each is searched on its own.
 */
export const ORDER_PAYMENT_TAGS = [
  `metadata['purpose']:'${ORDER_PAYMENT_PURPOSE}'`,
  `metadata['source']:'${WEBSITE_PAYMENT_SOURCE}'`,
] as const

type OrderPaymentTag = (typeof ORDER_PAYMENT_TAGS)[number]

/** Who a payment was for, for the log: an app user, or a website checkout, which has none. */
const payer = (intent: Stripe.PaymentIntent) =>
  intent.metadata?.userId ? `user ${intent.metadata.userId}` : "a website checkout"

/**
 * Whether the card was held more than `STRANDED_AFTER_MS` ago, by the charge's own time.
 *
 * Search can only ask when the payment intent was created. The app creates its payment right
 * before the card is confirmed, so the two are seconds apart - but the website creates its
 * payment as soon as the checkout's details are filled in, which can be long before Pay. By
 * the payment's age alone, a website hold made a moment ago could be released, or its money
 * refunded, in the seconds before its order is written. Needs the charge expanded; a charge
 * whose time cannot be read leaves it to the search's own filter.
 */
const heldLongEnoughAgo = (intent: Stripe.PaymentIntent, now: number) => {
  const charge = intent.latest_charge
  if (!charge || typeof charge === "string" || typeof charge.created !== "number") {
    return true
  }
  return charge.created < unixSeconds(now - STRANDED_AFTER_MS)
}

/** Every payment intent a search matches, across pages. */
async function searchAll(query: string): Promise<Stripe.PaymentIntent[]> {
  const found: Stripe.PaymentIntent[] = []
  let page: string | undefined

  for (;;) {
    const result = await stripe.paymentIntents.search({
      query,
      limit: 100,
      ...(page ? { page } : {}),
    })
    found.push(...result.data)
    if (!result.has_more || !result.next_page) return found
    page = result.next_page
  }
}

/**
 * Lets go of holds whose order never came.
 *
 * A card is held when the customer pays and captured when `createOrder` writes the order.
 * If the app is closed, loses its connection for good or crashes in between, nothing else
 * would ever let the hold go, and the amount would sit on the customer's card as pending
 * until the card network gave up on it days later.
 */
async function releaseAbandonedHolds(tag: OrderPaymentTag, now: number) {
  const held = await searchAll(
    `status:'requires_capture' AND ${tag} ` +
      `AND created<${unixSeconds(now - STRANDED_AFTER_MS)}`,
  )

  for (const found of held) {
    try {
      await db.$transaction(async (tx) => {
        // The same lock `createOrder` settles under, so a late retry of this order and
        // this release cannot both go ahead.
        await lockPayment(tx, found.id)

        const intent = await orNullIfMissing(
          stripe.paymentIntents.retrieve(found.id, {
            expand: ["latest_charge"],
          }),
        )
        if (intent?.status !== "requires_capture") return

        const order = await tx.order.findUnique({
          where: { paymentIntentId: intent.id },
          select: { id: true },
        })

        // Not a state `createOrder` can leave — it captures before its order commits — so
        // it is logged loudly. The order is real and the kitchen may be making it: take
        // the money rather than let it go.
        if (order) {
          await captureOrderPayment(intent.id)
          console.error(
            `Captured payment ${intent.id} for order ${order.id}: it was still on hold after the order was placed.`,
          )
          return
        }

        // Held too recently to call abandoned, however old the payment itself is.
        if (!heldLongEnoughAgo(intent, now)) return

        await releaseHold(intent.id)
        console.warn(
          `Released an abandoned hold: payment ${intent.id}, ${payer(intent)}, ` +
            `${intent.amount_capturable} ${intent.currency}.`,
        )
      }, TRANSACTION_OPTIONS)
    } catch (error) {
      console.error(
        `Could not settle held payment ${found.id}:`,
        getErrorMessage(error),
      )
    }
  }
}

/**
 * Refunds payments that were taken but never became an order.
 *
 * `createOrder` captures a hold as the last step before its order commits, and Stripe and
 * Postgres cannot commit together: a commit that fails straight after a successful capture
 * leaves the money taken and no order. The app's retry usually repairs that — the payment
 * is found taken and the order placed without capturing again — but a customer who closes
 * the app, or changes their cart first, would otherwise wait for staff to notice. The same
 * holds for the website's checkout.
 */
async function refundOrderlessPayments(tag: OrderPaymentTag, now: number) {
  const taken = await searchAll(
    `status:'succeeded' AND ${tag} ` +
      `AND created<${unixSeconds(now - STRANDED_AFTER_MS)} ` +
      `AND created>${unixSeconds(now - REFUND_WINDOW_MS)}`,
  )
  if (taken.length === 0) return

  // One query for the lot: nearly every taken payment has its order.
  const ordered = new Set(
    (
      await db.order.findMany({
        where: { paymentIntentId: { in: taken.map((intent) => intent.id) } },
        select: { paymentIntentId: true },
      })
    ).map((order) => order.paymentIntentId),
  )

  for (const found of taken) {
    if (ordered.has(found.id)) continue

    try {
      await db.$transaction(async (tx) => {
        await lockPayment(tx, found.id)

        // Asked again under the lock: a retry of this order may have committed since.
        const order = await tx.order.findUnique({
          where: { paymentIntentId: found.id },
          select: { id: true },
        })
        if (order) return

        const intent = await orNullIfMissing(
          stripe.paymentIntents.retrieve(found.id, {
            expand: ["latest_charge"],
          }),
        )
        if (
          !intent ||
          intent.status !== "succeeded" ||
          refundOf(intent) > 0 ||
          !heldLongEnoughAgo(intent, now)
        ) {
          return
        }

        await refundOrderPayment(intent, intent.metadata?.userId)
        console.error(
          `Refunded payment ${intent.id} for ${payer(intent)}: ${intent.amount_received} ${intent.currency} ` +
            `was taken but no order was placed within 30 minutes.`,
        )
      }, TRANSACTION_OPTIONS)
    } catch (error) {
      console.error(
        `Could not settle taken payment ${found.id}:`,
        getErrorMessage(error),
      )
    }
  }
}

/**
 * Settles every app and website payment that has waited too long for its order. Run on a
 * timer. Never throws: a failure is logged, and whatever it left is picked up by the next run.
 * Safe on more than one instance at once — every step is under the payment's lock, and
 * captures and refunds are idempotent on the payment.
 */
export async function sweepStrandedPayments(now = Date.now()) {
  for (const tag of ORDER_PAYMENT_TAGS) {
    try {
      await releaseAbandonedHolds(tag, now)
    } catch (error) {
      console.error(
        `Could not look for abandoned holds (${tag}):`,
        getErrorMessage(error),
      )
    }

    try {
      await refundOrderlessPayments(tag, now)
    } catch (error) {
      console.error(
        `Could not look for payments taken without an order (${tag}):`,
        getErrorMessage(error),
      )
    }
  }
}
