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

/**
 * How long Stripe lets an uncaptured hold stand before it expires it, and so the furthest a
 * capture can ever trail its authorisation. The refund search below looks back this much
 * further than its own window, since a charge is listed by when the card was authorised but
 * judged by when the money moved.
 */
const MAX_HOLD_MS = 7 * 24 * 60 * 60 * 1000

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

/**
 * Whether a payment was made for an order at all - an app one or a website one.
 *
 * The hold pass asks Stripe for its candidates by tag, so it needs no such check. The refund
 * pass finds its candidates by charge, and the account's charges include memberships and
 * anything else that is not an order: without this it would refund them, since they have no
 * `Order` row either.
 */
const isOrderPayment = (intent: Stripe.PaymentIntent) =>
  intent.metadata?.purpose === ORDER_PAYMENT_PURPOSE ||
  intent.metadata?.source === WEBSITE_PAYMENT_SOURCE

/** Who a payment was for, for the log: an app user, or a website checkout, which has none. */
const payer = (intent: Stripe.PaymentIntent) =>
  intent.metadata?.userId ? `user ${intent.metadata.userId}` : "a website checkout"

/**
 * Whether the card was held more than `STRANDED_AFTER_MS` ago, by the charge's own time.
 *
 * Search can only ask when the payment intent was created. The app creates its payment right
 * before the card is confirmed, so the two are seconds apart - but the website creates its
 * payment as soon as the checkout's details are filled in, which can be long before Pay. By
 * the payment's age alone, a website hold made a moment ago could be released in the seconds
 * between the card being held and the order that captures it. Needs the charge expanded; a
 * charge whose time cannot be read leaves it to the search's own filter.
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
 * When a charge's money actually moved.
 *
 * `charge.created` is when the card was **authorised**, which for these payments is not when
 * they were taken: every one is `capture_method: "manual"`, so the money moves later, when
 * `createOrder` captures the hold. The balance transaction is what Stripe creates at that
 * point, so its `created` is the capture. An uncaptured charge has none, and a charge whose
 * transaction was not expanded reads as its authorisation rather than throwing.
 */
const capturedAt = (charge: Stripe.Charge): number => {
  const transaction = charge.balance_transaction
  return transaction && typeof transaction !== "string"
    ? transaction.created
    : charge.created
}

/** Every charge authorised in a window, with the transaction that says when it was taken. */
async function chargesTakenBetween(
  from: number,
  to: number,
): Promise<Stripe.Charge[]> {
  const found: Stripe.Charge[] = []
  let startingAfter: string | undefined

  for (;;) {
    const page = await stripe.charges.list({
      created: { gte: unixSeconds(from), lte: unixSeconds(to) },
      expand: ["data.balance_transaction"],
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    found.push(...page.data)
    const last = page.data[page.data.length - 1]
    if (!page.has_more || !last) return found
    startingAfter = last.id
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
 *
 * **Candidates come from charges, not from a search for payments.** A search can only ask
 * when the payment *intent* was created, and the website creates its intent when the
 * checkout's details are filled in - a page left open longer than the window pays against an
 * intent already outside it, and that payment would be skipped by this run and by every run
 * after it. Listing has a second benefit: the list API is immediately consistent, while
 * search lags about a minute.
 *
 * **The window itself is on the capture** (`capturedAt`), because that is when the money
 * moved and what both of its bounds are about: a payment is given half an hour to become an
 * order before it is handed back, and money taken before the window is out of reach, so a
 * run cannot reach into payments the shop settled by hand. Charges can only be *listed* by
 * when the card was authorised, which for a manual capture comes first - so the search looks
 * back a hold's whole life further than the window, and the capture time decides. Judging by
 * the authorisation would refund a hold captured half an hour after it was made the moment it
 * was taken, with none of that grace, and would lose a capture whose authorisation had aged
 * past the window from every run after it.
 */
async function refundOrderlessPayments(now: number) {
  const takenBefore = unixSeconds(now - STRANDED_AFTER_MS)
  const takenAfter = unixSeconds(now - REFUND_WINDOW_MS)

  const taken = (
    await chargesTakenBetween(
      now - REFUND_WINDOW_MS - MAX_HOLD_MS,
      now - STRANDED_AFTER_MS,
    )
  ).filter(
    (charge) =>
      charge.paid &&
      charge.captured &&
      charge.amount_refunded === 0 &&
      typeof charge.payment_intent === "string" &&
      capturedAt(charge) <= takenBefore &&
      capturedAt(charge) >= takenAfter,
  )
  if (taken.length === 0) return

  const paymentIntentIds = [
    ...new Set(taken.map((charge) => charge.payment_intent as string)),
  ]

  // One query for the lot: nearly every taken payment has its order.
  const ordered = new Set(
    (
      await db.order.findMany({
        where: { paymentIntentId: { in: paymentIntentIds } },
        select: { paymentIntentId: true },
      })
    ).map((order) => order.paymentIntentId),
  )

  for (const paymentIntentId of paymentIntentIds) {
    if (ordered.has(paymentIntentId)) continue

    try {
      await db.$transaction(async (tx) => {
        await lockPayment(tx, paymentIntentId)

        // Asked again under the lock: a retry of this order may have committed since.
        const order = await tx.order.findUnique({
          where: { paymentIntentId },
          select: { id: true },
        })
        if (order) return

        const intent = await orNullIfMissing(
          stripe.paymentIntents.retrieve(paymentIntentId, {
            expand: ["latest_charge"],
          }),
        )
        if (
          !intent ||
          // Not an order's payment: a membership invoice, or anything else on the account.
          !isOrderPayment(intent) ||
          intent.status !== "succeeded" ||
          refundOf(intent) > 0
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
        `Could not settle taken payment ${paymentIntentId}:`,
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
  // Holds are searched for by tag, one query each. Taken payments are not: they are found by
  // charge, which covers both services at once.
  for (const tag of ORDER_PAYMENT_TAGS) {
    try {
      await releaseAbandonedHolds(tag, now)
    } catch (error) {
      console.error(
        `Could not look for abandoned holds (${tag}):`,
        getErrorMessage(error),
      )
    }
  }

  try {
    await refundOrderlessPayments(now)
  } catch (error) {
    console.error(
      "Could not look for payments taken without an order:",
      getErrorMessage(error),
    )
  }
}
