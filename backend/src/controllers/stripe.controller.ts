import { db } from "../lib/db"
import { Prisma } from "@prisma/client"

import { Request, Response } from "express"
import { Stripe } from "stripe"
import { loadMembershipBenefits } from "../lib/membership"
import { warnRenewalDeclined } from "../lib/membershipReminders"
import {
  isResourceMissing,
  orNullIfMissing,
  stripeErrorMessage,
} from "../lib/stripeErrors"
import {
  checkPickUpTime,
  getDaysOffKeys,
  getTradingHours,
} from "../lib/tradingHours"
import { calculateCartPrice, cartPricingInclude } from "../lib/cartPricing"
import {
  CART_PRICES_CHANGED_MESSAGE,
  hasCorrections,
  isPaidUpMember,
  MEMBER_ONLY_ITEM_MESSAGE,
  staleDiscounts,
} from "../lib/memberPricing"
import {
  applyDiscountCorrections,
  type CartSync,
  syncCartWithMembership,
} from "../lib/cartRepricing"
import { sendMembershipWelcome } from "../lib/membershipEmails"
import { getErrorMessage } from "../utils/getError"
import { isOfferLive } from "../lib/offerAvailability"
import { idOf, stripe } from "../lib/stripeClient"
import {
  type CustomerDetails,
  customerDetailsOf,
  describeStripeFailure,
  staleCustomerDetails,
} from "../lib/stripeCustomer"
import {
  CHARGE_CURRENCY,
  ORDER_PAYMENT_PURPOSE,
  refundOf,
} from "../lib/orderPayment"

export function getInvoicePaymentIntent(
  invoice: Stripe.Invoice,
): string | null {
  // New format: payments list
  if (invoice.payments && invoice.payments.data.length > 0) {
    const payment = invoice.payments.data[0].payment
    if (
      payment?.type === "payment_intent" &&
      typeof payment.payment_intent === "string"
    ) {
      return payment.payment_intent
    }
  }

  return null
}

/**
 * The user's Stripe customer, created on first use. Always a real id, or a throw.
 *
 * Two ways this used to go wrong, both quietly:
 *
 * It handed back `{ customerId: undefined }` when the user row could not be read — the
 * lookup swallowed every database error into that. Stripe's list endpoints read a missing
 * `customer` as no filter at all, so a caller that did not check went on to list across
 * every customer on the account.
 *
 * And any failure retrieving the stored customer other than "no such customer" — a
 * timeout, a Stripe outage — fell through to creating a brand new customer and overwriting
 * the stored id. One blip was enough to detach a member from the customer their cards and
 * subscription live on, after which every card and membership check here looked at an
 * empty customer.
 *
 * On the way it brings the customer's name, email and phone in line with the user row —
 * see `lib/stripeCustomer` — which fills in customers created before they carried any, and
 * follows a profile edit.
 */
async function getOrCreateCustomerId(
  userId: string,
): Promise<{ customerId: string }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      stripeCustomerId: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
    },
  })

  // authenticateToken found this user moments ago, so a miss is an account deleted in
  // between: a failure to report, not a customer to create.
  if (!user) throw new Error(`User ${userId} not found`)

  const details = customerDetailsOf(user)

  if (user.stripeCustomerId) {
    try {
      const customer = await stripe.customers.retrieve(user.stripeCustomerId)
      if (!customer.deleted) {
        await syncCustomerDetails(customer, details)
        return { customerId: customer.id }
      }
    } catch (error) {
      if (!isResourceMissing(error)) throw error
    }
  }

  // Only reached with no customer on record, or one Stripe no longer has. Created bare and
  // then given its details, so an email or phone Stripe refuses costs the Dashboard label
  // rather than the customer — and with it every payment.
  const customer = await stripe.customers.create({ metadata: { userId } })

  await db.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customer.id },
  })

  await syncCustomerDetails(customer, details)

  return { customerId: customer.id }
}

/**
 * Writes the user's details to their customer where they differ. Never throws: the details
 * only label payments in the Stripe Dashboard, and a payment, card or membership must not
 * fail over a label.
 */
async function syncCustomerDetails(
  customer: Stripe.Customer,
  details: CustomerDetails,
) {
  const stale = staleCustomerDetails(customer, details)
  if (!stale) return

  try {
    await stripe.customers.update(customer.id, stale)
  } catch (error) {
    console.error(
      `Could not update the details of Stripe customer ${customer.id}:`,
      describeStripeFailure(error),
    )
  }
}

export const paymentMethods = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }
  try {
    // Get or create a Stripe customer for this user
    const customerIdResult = await getOrCreateCustomerId(userId)

    // Get the payment methods for this customer
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerIdResult.customerId,
      type: "card",
    })

    res.status(200).json({ paymentMethods: paymentMethods.data })
    return
  } catch (error) {
    console.error("Error fetching payment methods:", error)
    res.status(500).json({ message: "Error fetching payment methods" })
    return
  }
}

export const createSetupIntent = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }

  try {
    const { customerId } = await getOrCreateCustomerId(userId)

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
    })

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: "2020-08-27" },
    )

    res.status(200).json({
      setupIntent: setupIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customerId,
      setupIntentId: setupIntent.id,
    })
    return
  } catch (error) {
    console.error("Error creating setup intent:", error)
    res.status(500).json({ message: "Error saving card" })
  }
  return
}

export const setCardForMembershipPayments = async (
  req: Request,
  res: Response,
) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }
  try {
    const { setupIntentId } = req.body ?? {}

    if (typeof setupIntentId !== "string" || !setupIntentId) {
      res.status(400).json({ message: "Set up intent is required" })
      return
    }

    const [{ customerId }, setupIntent] = await Promise.all([
      getOrCreateCustomerId(userId),
      orNullIfMissing(stripe.setupIntents.retrieve(setupIntentId)),
    ])

    // The setup intent has to be one this customer finished. It used to be taken on
    // trust — whatever card it named became the default for whoever asked — so the only
    // thing between one customer and another's setup intent was Stripe declining to set
    // a card the customer did not own. The card is checked too: it may have been removed
    // since the sheet closed, which Stripe would otherwise report as a 500.
    const paymentMethodId = idOf(setupIntent?.payment_method)
    const paymentMethod =
      setupIntent &&
      idOf(setupIntent.customer) === customerId &&
      setupIntent.status === "succeeded" &&
      paymentMethodId
        ? await orNullIfMissing(stripe.paymentMethods.retrieve(paymentMethodId))
        : null

    // The retrieve above used to feed a console.log of the whole payment method —
    // cardholder name, billing address, last four — into the server logs on every call.
    if (!paymentMethodId || idOf(paymentMethod?.customer) !== customerId) {
      res.status(404).json({ message: "Card not found" })
      return
    }

    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    })
    res.status(200).json({ success: true })
    return
  } catch (error) {
    console.error("Error making card as default:", error)
    res.status(500).json({
      message: stripeErrorMessage(
        error,
        "Could not set that card for membership payments",
      ),
    })
    return
  }
}

// POST /api/stripe/save-card - Save a payment method to customer
export const saveCard = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }
  try {
    const { paymentMethodId } = req.body ?? {}

    if (typeof paymentMethodId !== "string" || !paymentMethodId) {
      res.status(400).json({ message: "Payment method ID is required" })
      return
    }

    const [{ customerId }, paymentMethod] = await Promise.all([
      getOrCreateCustomerId(userId),
      orNullIfMissing(stripe.paymentMethods.retrieve(paymentMethodId)),
    ])

    // One answer for a card that does not exist and a card that is someone else's, the
    // same one removeCard gives. This used to say "already attached to another customer",
    // which confirmed to anyone holding a card id that it was real and in use — and an id
    // Stripe had never issued came back as a 500.
    const owner = idOf(paymentMethod?.customer)
    if (!paymentMethod || (owner && owner !== customerId)) {
      res.status(404).json({ message: "Card not found" })
      return
    }

    // Attach the payment method to the customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    })
    const customer = await stripe.customers.retrieve(customerId)
    let defaultPaymentMethod: string | undefined = undefined
    defaultPaymentMethod = (customer as Stripe.Customer).invoice_settings
      ?.default_payment_method as string | undefined

    // Set as the default payment method if desired
    if (!defaultPaymentMethod) {
      await stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      })
    }

    res.status(200).json({ success: true })
    return
  } catch (error) {
    console.error("Error saving card:", error)
    // Attaching can decline a card, and that reason is worth passing on.
    res
      .status(500)
      .json({ message: stripeErrorMessage(error, "Error saving card") })
    return
  }
}

/**
 * Subscription states in which Stripe will still try to charge a card. A card behind any
 * of these is paying for a membership, whatever the membership row says.
 */
const BILLING_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
])

/**
 * The card a customer's membership renews on, or null when nothing is billing them.
 *
 * The subscription's own default wins when it has one, but `createMembership` never sets
 * it — it sets the customer's invoice default instead — and Stripe falls back to that. So
 * reading the subscription alone, as `getCurrentSubscriptionPaymentMethodId` used to,
 * found no card for any membership this app created.
 */
async function membershipPaymentMethodId(
  customerId: string,
): Promise<string | null> {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  })

  const billing = subscriptions.data.find((subscription) =>
    BILLING_SUBSCRIPTION_STATUSES.has(subscription.status),
  )
  if (!billing) return null

  const own = idOf(billing.default_payment_method)
  if (own) return own

  const customer = await stripe.customers.retrieve(customerId)
  return customer.deleted
    ? null
    : idOf(customer.invoice_settings.default_payment_method)
}

export const removeCard = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }
  try {
    const { paymentMethodId } = req.body ?? {}

    if (typeof paymentMethodId !== "string" || !paymentMethodId) {
      res.status(400).json({ message: "Payment method ID is required" })
      return
    }

    // This used to detach whatever id it was sent. A secret-key call can detach any
    // payment method on the account, so any signed-in customer holding someone else's
    // card id could take that card off them. The card now has to belong to the Stripe
    // customer on this user's record — read from the row, not getOrCreateCustomerId,
    // because removing a card is no reason to create a Stripe customer.
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { stripeCustomerId: true },
    })
    const customerId = user?.stripeCustomerId

    if (!customerId) {
      res.status(404).json({ message: "Card not found" })
      return
    }

    const [paymentMethod, renewsOn] = await Promise.all([
      orNullIfMissing(stripe.paymentMethods.retrieve(paymentMethodId)),
      membershipPaymentMethodId(customerId),
    ])

    // The same answer for a card that does not exist and a card that is someone else's,
    // so this cannot be used to learn whether an id is real.
    if (idOf(paymentMethod?.customer) !== customerId) {
      res.status(404).json({ message: "Card not found" })
      return
    }

    // Detaching the card a membership renews on leaves the next renewal nothing to
    // charge, and the membership lapses. The app greys this card's delete button, but
    // only the server can actually refuse.
    if (renewsOn === paymentMethodId) {
      res.status(409).json({
        message:
          "This card pays for your membership. Set another card for membership payments before removing it.",
      })
      return
    }

    await stripe.paymentMethods.detach(paymentMethodId)

    res.status(200).json({ success: true })
    return
  } catch (error) {
    console.error("Error removing card:", error)
    res.status(500).json({ message: "Error removing card" })
    return
  }
}

/**
 * How far back an identical order counts as a possible repeat. Long enough to
 * cover a lost response and the customer restarting the app, short enough that
 * a genuine second order later in the evening is never questioned.
 */
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000

export const createPaymentIntent = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }
  try {
    const {
      amount,
      currency,
      paymentMethodId,
      pickUpTime,
      eatIn,
      confirmDuplicate,
      authoriseOnly,
    } = req.body ?? {}

    // Every card order is now a hold, captured only once its order has been written (see
    // settleOrderPayment). A build that predates this treats anything but a completed
    // payment as a failure: it would put a hold on the card, report the payment as failed
    // and place no order. So a build has to say it expects a hold, and one that does not is
    // asked to update before its customer's card is touched. Orders paid entirely in points
    // never come here and keep working on every build.
    if (authoriseOnly !== true) {
      res.status(426).json({
        code: "APP_UPDATE_REQUIRED",
        message: "Please update the Eversweet app to pay by card.",
      })
      return
    }

    if (!amount) {
      res.status(400).json({ message: "Amount is required" })
      return
    }

    // The charge is in New Zealand dollars, always. `currency` used to go to Stripe
    // exactly as sent, while the amount check below compares bare cents — so a request
    // naming rupees passed that check and was charged 5000 paise, about NZ$1, for a
    // NZ$50 cart. Still accepted from builds that send it, but only ever as NZD.
    if (
      currency !== undefined &&
      (typeof currency !== "string" ||
        currency.toLowerCase() !== CHARGE_CURRENCY)
    ) {
      res.status(400).json({ message: "Payments are taken in NZD" })
      return
    }

    // Checked here as well as at order creation because this runs before the
    // card is touched: a time refused here never puts a hold on it. `createOrder`
    // checks again and lets the hold go if the store has closed in the meantime.
    // Optional only because older builds did not send it; every build past the
    // hold gate above does.
    if (pickUpTime !== undefined) {
      const [daysOffKeys, hours] = await Promise.all([
        getDaysOffKeys(),
        getTradingHours(),
      ])
      const check = checkPickUpTime(new Date(pickUpTime), {
        eatIn: Boolean(eatIn),
        daysOffKeys,
        hours,
      })

      if (!check.ok) {
        res.status(400).json({ message: check.message })
        return
      }
    }

    // The amount is worked out here, from the cart rows, and never taken from
    // the request: a modified client could otherwise name its own price and pay
    // a cent for a full order. The client's figure is compared only so a cart
    // that changed underneath the customer is reported rather than silently
    // charged at a different price than the one on their screen.
    //
    // Ahead of the Stripe customer lookup, so a cart that is going to be refused
    // does not create a customer at Stripe on its way out.
    //
    // The membership comes in the same wave, for the member-only check below.
    const [cart, membership] = await Promise.all([
      db.cart.findUnique({
        where: { userId },
        include: {
          cartItems: {
            include: {
              ...cartPricingInclude,
              dessert: { select: { promo: true } },
              offer: {
                select: {
                  audience: true,
                  isActive: true,
                  startsAt: true,
                  endsAt: true,
                  archivedAt: true,
                },
              },
            },
          },
        },
      }),
      db.membership.findUnique({
        where: { userId },
        select: {
          isActive: true,
          paymentStatus: true,
          totalMonths: true,
          plan: { select: { maxDiscount: true, membershipDiscount: true } },
        },
      }),
    ])

    if (!cart || cart.cartItems.length === 0) {
      res.status(400).json({ message: "Your cart is empty" })
      return
    }

    // Loading the cart sweeps out an offer that has stopped running, but an offer
    // can end between that load and this call - and this is the last point before
    // the card is held where it can still be caught. `calculateCartPrice` reads
    // the discount stored on the row, so without this the customer is held for the
    // old offer price, and `createOrder`, which checks the hold against those same
    // rows, then captures it at that price.
    //
    // Refused rather than silently repriced, for the same reason as the amount
    // mismatch below: the total on their screen must be the total they are charged.
    const now = new Date()
    if (
      cart.cartItems.some((item) => item.offer && !isOfferLive(item.offer, now))
    ) {
      res.status(409).json({
        message:
          "An offer in your cart is no longer available. Please review your cart and try again.",
      })
      return
    }

    // A member-only item held by someone who is no longer a paid-up member - a renewal
    // declined and on hold, or a membership that has ended. The cart load takes these out,
    // but one added just before the membership changed can still be here; nothing checked,
    // so it was bought at the member price. Refused before the card is touched.
    if (
      !isPaidUpMember(membership) &&
      cart.cartItems.some((item) => item.offer?.audience === "MEMBERS")
    ) {
      res.status(409).json({
        message: `${MEMBER_ONLY_ITEM_MESSAGE} Please review your cart and try again.`,
      })
      return
    }

    // The discounts stored on the lines, checked against the membership and promotions as
    // they stand. They are what this charges, and a membership that lapsed or a promotion
    // that ended since the cart was loaded - or a webhook that failed to reprice it - would
    // otherwise be held at the old price. Corrected here, so the reload the app does on this
    // answer shows the right total, and refused rather than charged differently from the
    // total on the customer's screen.
    const corrections = staleDiscounts(cart.cartItems, membership)
    if (hasCorrections(corrections)) {
      await applyDiscountCorrections(corrections)
      res.status(409).json({ message: CART_PRICES_CHANGED_MESSAGE })
      return
    }

    const { payableInCents, beforeDiscountInCents, discountInCents } =
      calculateCartPrice(cart.cartItems)

    if (Math.round(Number(amount)) !== payableInCents) {
      console.error(
        `Payment intent amount mismatch for user ${userId}: client sent ${amount}, cart is worth ${payableInCents}.`,
      )
      res.status(409).json({
        message:
          "Your cart has changed since this total was worked out. Please review it and try again.",
      })
      return
    }

    // The one duplicate the idempotency key cannot catch. If the response to
    // `createOrder` is lost, the order exists but the app never cleared its
    // local cart; re-opening it and tapping Place order starts a genuinely
    // new payment intent, which is by definition a new order. This is the
    // last point before the card is charged where it can still be questioned,
    // so ask rather than refuse: ordering the same thing twice is something
    // people really do.
    if (!confirmDuplicate) {
      const duplicate = await db.order.findFirst({
        where: {
          appUserId: userId,
          createdAt: { gte: new Date(Date.now() - DUPLICATE_WINDOW_MS) },
          // Same list price and same discount means the same items at the
          // same prices, which no coincidence produces within the window.
          priceInCents: beforeDiscountInCents,
          discountedAmountInCents: discountInCents,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, tempOrderId: true, createdAt: true },
      })

      if (duplicate) {
        res.status(409).json({
          code: "POSSIBLE_DUPLICATE",
          message:
            "You placed an order for these same items a few minutes ago.",
          existingOrder: duplicate,
        })
        return
      }
    }

    // Get or create a Stripe customer for this user. Last, because it is the only
    // step here that writes at Stripe — every refusal above now returns without
    // having created a customer for an order that is not going to happen.
    const { customerId } = await getOrCreateCustomerId(userId)

    // Create a payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: payableInCents,
      currency: CHARGE_CURRENCY,
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: false, // We'll confirm on the client side
      setup_future_usage: "off_session", // This allows the card to be used for future payments
      // Authorised when the app confirms, taken only when createOrder has written the
      // order. Until then a changed cart or a closed store just lets the hold go.
      capture_method: "manual",
      // What createOrder requires before it will place, or refund, an order against this
      // payment. See ORDER_PAYMENT_PURPOSE.
      metadata: { purpose: ORDER_PAYMENT_PURPOSE, userId },
    })

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    })
    return
  } catch (error) {
    console.error("Error creating payment intent:", error)
    res.status(500).json({
      message: stripeErrorMessage(error, "Error creating payment intent"),
    })
    return
  }
}

export const checkPaymentStatus = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }
  try {
    const paymentIntentId = req.params.id

    const [user, order, paymentIntent] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: { stripeCustomerId: true },
      }),
      db.order.findUnique({
        where: { paymentIntentId },
        select: { id: true, appUserId: true },
      }),
      orNullIfMissing(
        stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: ["latest_charge"],
        }),
      ),
    ])

    // Whose payment this is. An order for it settles the question; with no order yet,
    // the payment's own customer does, since createPaymentIntent always sets one.
    //
    // Two things were wrong before. A database error in the order lookup was caught and
    // logged, and the status of any payment intent went back to whoever asked. And the
    // ownership check was on the order alone, so a payment with no order was always a
    // 403 — which meant the app's "paid, but no order was created" recovery in checkout
    // could never run for the one customer it exists for.
    const owned = order
      ? order.appUserId === userId
      : !!user?.stripeCustomerId &&
        idOf(paymentIntent?.customer) === user.stripeCustomerId

    // One answer for missing and for someone else's.
    if (!paymentIntent || !owned) {
      res.status(404).json({ message: "Payment not found" })
      return
    }

    // createOrder refunds a payment that no longer matches the cart, and a refunded
    // payment still reads "succeeded". Reported as such, the app would tell a customer
    // whose money is on its way back that they had paid and their order was lost.
    const refunded = refundOf(paymentIntent) > 0

    res.status(200).json({
      success: paymentIntent.status === "succeeded" && !refunded,
      refunded,
      // On hold and waiting for its order — the app can place that order again.
      authorised: paymentIntent.status === "requires_capture",
      // Let go without being taken: the cart changed, the store closed, or it was abandoned.
      released: paymentIntent.status === "canceled",
      pending: paymentIntent.status === "processing",
      orderId: order?.id ?? null,
    })
    return
  } catch (error) {
    console.error("Error checking payment status:", error)
    res.status(500).json({
      success: false,
      message: "Error checking payment status",
    })
    return
  }
}

// get membership details
export const getMembershipDetails = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }
  try {
    const membershipPlan = await db.membershipPlan.findFirst({
      where: { name: "Monthly_Membership" },
      // Listed rather than selected wholesale, so a client generated either side of an
      // unapplied migration cannot ask for a column the database lacks.
      select: {
        id: true,
        stripePriceId: true,
        benefits: true,
      },
    })
    if (!membershipPlan) {
      res.status(404).json({ message: "Membership plan not found" })
      return
    }
    if (!membershipPlan.stripePriceId) {
      res
        .status(404)
        .json({ message: "Membership plan does not have a stripe price id" })
      // Missing until now, so this carried on to ask Stripe for an empty price and
      // tried to answer a second time.
      return
    }
    const [price, membershipBenefits] = await Promise.all([
      stripe.prices.retrieve(membershipPlan.stripePriceId),
      // Resolved against the live rates, so a benefit saying "{{memberRate}}x loyalty
      // points" cannot advertise a multiplier orders no longer earn. An unseeded plan falls
      // back rather than showing the join screen an empty tick-list that reads as a
      // membership offering nothing - and the fallback goes through the same resolution,
      // because it used to bake the rate in at module load and drifted the same way. The
      // no-expiry benefit is only served while expiry is on - see lib/membership.
      loadMembershipBenefits(membershipPlan.benefits),
    ])
    const membershipDetails = {
      id: membershipPlan.id,
      price: price.unit_amount,
      stripePriceId: membershipPlan.stripePriceId,
      membershipBenefits,
    }
    res.status(200).json(membershipDetails)
    return
  } catch (error) {
    console.error("Error getting membership details:", error)
    res.status(500).json({
      success: false,
      message: "Error getting membership details",
    })
    return
  }
}

// get users membership status

export const getUsersMembership = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }
  try {
    const membership = await db.membership.findUnique({
      where: { userId },
      select: {
        id: true,
        createdAt: true,
        startDate: true,
        endDate: true,
        stripeSubscriptionId: true,
        paymentStatus: true,
        planId: true,
        isActive: true,
        cancel: true,
        totalMonths: true,
        plan: true,
      },
    })

    res.status(200).json(membership)
    return
  } catch (error) {
    console.error("Error getting users membership:", error)
    res.status(500).json({
      success: false,
      message: "Error getting users membership",
    })
    return
  }
}

// membership payment

export const retryPayment = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "unauthenticated to do this action" })
    return
  }
  try {
    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user) {
      res.status(401).json({ message: "Could not find user" })
      return
    }
    const membership = await db.membership.findUnique({
      where: { userId },
    })

    if (!membership) {
      res.status(404).json({ message: "Membership not found" })
      return
    }

    if (membership.paymentStatus !== "PENDING") {
      res.status(400).json({
        message: "No failed payment to retry",
      })
      return
    }

    if (!user.stripeCustomerId) {
      res.status(400).json({
        message: "No Stripe customer found",
      })
      return
    }

    const customer = await stripe.customers.retrieve(user.stripeCustomerId)

    if (customer.deleted || !customer.invoice_settings.default_payment_method) {
      res.status(400).json({
        message: "Please add a payment method first",
      })
      return
    }

    const invoices = await stripe.invoices.list({
      customer: user.stripeCustomerId,
      status: "open",
      limit: 10,
    })
    const invoice = invoices.data.find(
      (invoice) =>
        invoice.lines.data[0].subscription === membership.stripeSubscriptionId,
    )

    if (!invoice || !invoice.id) {
      res.status(404).json({
        message: "No unpaid invoice found",
      })
      return
    }

    if (invoice.status === "paid") {
      res.status(400).json({
        message: "Invoice already paid",
      })
      return
    }

    await stripe.invoices.pay(invoice.id)
    res.status(200).json({ success: true })
  } catch (error) {
    console.error("Error retrying payment:", error)
    // A decline is the likeliest failure here, and its reason is for the customer.
    res.status(500).json({
      message: stripeErrorMessage(
        error,
        "Your payment retry could not be completed",
      ),
    })
  }
}

/**
 * How long a join that is still waiting on Stripe keeps a second one out. Long enough to
 * cover the subscription being created and its first payment coming back, short enough
 * that a join that crashed partway does not lock the customer out for good.
 */
const JOIN_IN_PROGRESS_MS = 2 * 60 * 1000

const JOIN_IN_PROGRESS_MESSAGE =
  "Your membership is already being set up. Please wait a moment and check again."

export const createMembership = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Please sign in to join our membership." })
    return
  }
  // Undoes this request's claim on the membership if Stripe refuses before a subscription
  // exists, so the customer can try again at once rather than being told a join is under way.
  let releaseClaim: (() => Promise<unknown>) | null = null
  try {
    const { paymentMethodId, stripePriceId } = req.body ?? {}

    if (typeof paymentMethodId !== "string" || !paymentMethodId) {
      res.status(400).json({ message: "Payment method is required" })
      return
    }

    const [plan, existingMembership] = await Promise.all([
      db.membershipPlan.findFirstOrThrow({
        where: { name: "Monthly_Membership" },
      }),
      db.membership.findUnique({ where: { userId } }),
    ])
    let membership = existingMembership

    // The price is the plan's. It used to be whatever the request named, handed to Stripe
    // as sent — so any other recurring price on the account, however cheap, bought a full
    // membership the moment its first invoice cleared. Builds send the id
    // getMembershipDetails gave them, and one that disagrees is refused rather than
    // charged a price the customer was not shown: the rule createPaymentIntent applies to
    // a cart total. Omitting it is fine.
    if (stripePriceId !== undefined && stripePriceId !== plan.stripePriceId) {
      res.status(409).json({
        message: "Membership pricing has changed. Please reload and try again.",
      })
      return
    }

    if (membership && membership.isActive) {
      res.status(400).json({ message: "Your membership is still active" })
      return
    }

    // Get or create a Stripe customer for this user
    const { customerId } = await getOrCreateCustomerId(userId)

    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      expand: ["data.items.data.price"],
    })

    const hasSameSub = existingSubs.data.some((sub) =>
      sub.items.data.some((item) => item.price.id === plan.stripePriceId),
    )

    if (hasSameSub) {
      res.status(400).json({ message: "Your membership is still active" })
      return
    }

    // The attempt is claimed before anything changes at Stripe. Nothing did before: two
    // requests for a returning member — a double tap that lands before the button disables,
    // or a resend — both read an inactive membership, both passed every check above, and
    // both created a subscription. The customer was billed twice, every month. Now the
    // second finds the claim and is turned away.
    if (!membership) {
      try {
        membership = await db.membership.create({
          data: {
            user: { connect: { id: userId } },
            plan: { connect: { id: plan.id } },
            paymentStatus: "PENDING",
            isActive: false,
            stripePaymentMethodId: paymentMethodId,
            startDate: new Date(),
            endDate: new Date(new Date().setMonth(new Date().getMonth() + 1)),
          },
        })
      } catch (error) {
        // One membership per user: the other request created it first.
        //
        // Two codes, because `Membership.userId` is a required one-to-one and how the loser
        // fails depends on where the winner got to. Winner not yet committed: the unique
        // index refuses this insert, P2002. Winner already committed: Prisma refuses it
        // before the database sees it, because connecting this user to a second membership
        // would orphan the one they have and `Membership.user` is required - P2014.
        //
        // Only P2002 was caught, so the second case answered 500 and told a customer the
        // server had broken when all that had happened was their own double tap. It showed
        // up as a flaky test the moment CI's database was slow enough to let the winner
        // commit first.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2002" || error.code === "P2014")
        ) {
          res.status(409).json({ message: JOIN_IN_PROGRESS_MESSAGE })
          return
        }
        throw error
      }

      const created = membership
      releaseClaim = () =>
        db.membership.deleteMany({
          where: { id: created.id, stripeSubscriptionId: null },
        })
    } else {
      const claimed = await db.membership.updateMany({
        where: {
          id: membership.id,
          isActive: false,
          OR: [
            { paymentStatus: { not: "PENDING" } },
            { updatedAt: { lt: new Date(Date.now() - JOIN_IN_PROGRESS_MS) } },
          ],
        },
        // `totalMonths` is left as it was. It used to be zeroed here, which served nothing -
        // the new subscription's first payment writes its own count - and cost a returning
        // member whose rejoin failed their real end date as the start of their points month:
        // expiry counts only a membership that was paid for, and zero reads as never paid.
        data: {
          paymentStatus: "PENDING",
          isActive: false,
          stripePaymentMethodId: paymentMethodId,
        },
      })

      if (claimed.count === 0) {
        res.status(409).json({ message: JOIN_IN_PROGRESS_MESSAGE })
        return
      }

      const { id, paymentStatus } = membership
      releaseClaim = () =>
        db.membership.updateMany({
          where: { id, paymentStatus: "PENDING" },
          data: { paymentStatus },
        })
    }

    // After every refusal rather than first, where it was: a request turned away above
    // still used to replace the customer's default card on its way out.
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    })

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: plan.stripePriceId }],
      metadata: { userId },
      collection_method: "charge_automatically",
    })
    // From here the subscription exists and the webhook decides the membership's state.
    releaseClaim = null

    // The membership only becomes active once the webhook confirms the first payment.
    await db.membership.update({
      where: { id: membership.id },
      data: { stripeSubscriptionId: subscription.id },
    })

    res.status(201).json({ success: true })
    return
  } catch (error) {
    console.error("Error creating membership:", error)
    if (releaseClaim) {
      await releaseClaim().catch((releaseError) =>
        console.error("Could not release a failed membership join:", releaseError),
      )
    }
    res.status(500).json({
      message: stripeErrorMessage(
        error,
        "Failed to create membership. Please try again.",
      ),
    })
    return
  }
}

export const cancelMembership = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }
  try {
    const membership = await db.membership.findUnique({
      where: { userId },
    })
    if (!membership) {
      res.status(404).json({ message: "membership not found" })
      return
    }
    if (!membership.stripeSubscriptionId) {
      res.status(404).json({ message: "subscription not found" })
      return
    }
    const subscription = await stripe.subscriptions.update(
      membership.stripeSubscriptionId,
      {
        cancel_at_period_end: true,
      },
    )

    if (!subscription.cancel_at) {
      res.status(400).json({ message: "no cancellation date" })
      return
    }

    res
      .status(201)
      .json({ success: true, endDate: new Date(subscription.cancel_at * 1000) })
  } catch (error) {
    console.error("Error cancelling membership:", error)
    res.status(500).json({
      message: "Failed to cancel membership. Please try again.",
    })
    return
  }
}

export const resumeMembership = async (req: Request, res: Response) => {
  const userId = (req as any).userId

  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }

  try {
    const membership = await db.membership.findUnique({
      where: { userId },
    })

    if (!membership?.stripeSubscriptionId) {
      res.status(404).json({
        message: "Subscription not found",
      })
      return
    }

    await stripe.subscriptions.update(membership.stripeSubscriptionId, {
      cancel_at_period_end: false,
    })

    res.status(200).json({
      success: true,
    })
    return
  } catch (error) {
    console.error("Error resuming membership:", error)
    res.status(500).json({
      message: "Failed to resume membership. Please try again.",
    })
    return
  }
}

// poll for payment status after paying for membership
export const pollMembershipStatus = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }
  const membershipStatus = await db.membership.findUnique({
    where: { userId },
    select: {
      paymentStatus: true,
      isActive: true,
      paymentFailureCode: true,
      paymentFailureMessage: true,
    },
  })

  if (!membershipStatus) {
    res.status(404).json({ message: "No membership found" })
    return
  }

  res.status(200).json(membershipStatus)
  return
}

export const getCurrentSubscriptionPaymentMethodId = async (
  req: Request,
  res: Response,
) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }

  try {
    const { customerId } = await getOrCreateCustomerId(userId)

    // The same lookup removeCard refuses on, so the card the app greys out is exactly the
    // card the server will not detach.
    const paymentMethodId = await membershipPaymentMethodId(customerId)

    if (!paymentMethodId) {
      res.status(200).json({ message: "No payment method found" })
      return
    }

    res.status(200).json({ paymentMethodId })
    return
  } catch (error) {
    console.error("Error fetching the membership card:", error)
    res.status(500).json({
      message: "Failed to fetch current subscription payment method ID",
    })
    return
  }
}

/** The invoices that pay for a month of membership, as opposed to prorations or one-offs. */
const MEMBERSHIP_MONTH_REASONS = new Set<Stripe.Invoice.BillingReason>([
  "subscription_create",
  "subscription_cycle",
])

const paysForAMonth = (invoice: Stripe.Invoice) =>
  !!invoice.billing_reason &&
  MEMBERSHIP_MONTH_REASONS.has(invoice.billing_reason)

/**
 * How many months of this subscription have been paid in a row, up to the newest month
 * paid. The member discount grows a step for each, and a month that was never paid starts
 * the customer again from the first step.
 *
 * Counting back and stopping at the first month left unpaid is what makes it a run rather
 * than a total. Stripe is set to cancel a subscription whose renewal fails every retry, and
 * a customer who comes back gets a new subscription counted from one — but a month voided or
 * written off by hand leaves the subscription running, and a plain count of paid invoices
 * stepped straight over it. A renewal declined and then paid on a retry ends up paid, so it
 * keeps the run: the customer paid for that month.
 *
 * The count starts from the newest paid month whichever invoice was delivered, so every
 * delivery of every payment arrives at the same number. It used to run back from the
 * delivered invoice and skip anything newer, and Stripe redelivers events — so August
 * arriving again after September had been recorded wrote two months over three and cut the
 * member's discount until the next renewal. A newer renewal still being settled (the next
 * one's draft, or one Stripe is retrying) is passed over rather than read as a missed month.
 *
 * The invoice being delivered counts as paid whatever the list says, since the list may not
 * have caught up with it.
 */
async function countConsecutivePaidMonths(
  subscriptionId: string,
  justPaid: Stripe.Invoice,
): Promise<number> {
  let months = 0
  let counting = false
  // A proration or one-off invoice also arrives here; it is no month of its own to place.
  let justPaidPlaced = !paysForAMonth(justPaid)
  let startingAfter: string | undefined

  /** Takes the next monthly invoice, newest first. False once the run has ended. */
  const take = (status: Stripe.Invoice.Status | null) => {
    if (status === "paid") {
      counting = true
      months += 1
      return true
    }
    return !counting && (status === "draft" || status === "open")
  }

  for (;;) {
    const page = await stripe.invoices.list({
      subscription: subscriptionId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })

    for (const invoice of page.data) {
      if (!paysForAMonth(invoice)) continue

      if (invoice.id === justPaid.id) {
        justPaidPlaced = true
        take("paid")
        continue
      }

      // Listed newest first: the delivered invoice belongs before the first one older than
      // it, if the list has not caught up with it yet.
      if (!justPaidPlaced && invoice.created < justPaid.created) {
        justPaidPlaced = true
        take("paid")
      }

      if (!take(invoice.status)) return months
    }

    const last = page.data[page.data.length - 1]
    if (!page.has_more || !last?.id) break
    startingAfter = last.id
  }

  if (!justPaidPlaced) take("paid")
  return months
}

/**
 * Brings a membership in line with its subscription after a successful payment.
 *
 * Every figure is read from Stripe and written as it stands, never adjusted from what the
 * row held, so a delivery Stripe repeats — which it does whenever a response is slow or
 * lost — changes nothing the second time. This used to add one to `totalMonths` per
 * delivery, and each repeat raised the member's discount a step towards its cap.
 *
 * It also used to store `invoice.period_end` as the renewal date. For a subscription
 * invoice that field looks back one period, so "Renews on" showed the day the member had
 * just paid rather than the day they would next be charged. The subscription item's
 * `current_period_end` is the real one.
 */
async function recordMembershipPayment(
  subscriptionId: string,
  invoice: Stripe.Invoice,
) {
  const [subscription, totalMonths] = await Promise.all([
    orNullIfMissing(stripe.subscriptions.retrieve(subscriptionId)),
    countConsecutivePaidMonths(subscriptionId, invoice),
  ])

  // A delivery that arrives after the subscription ended — a retry of one that failed
  // earlier — must not switch a cancelled membership back on.
  if (
    !subscription ||
    (subscription.status !== "active" && subscription.status !== "trialing")
  ) {
    console.warn(
      `Membership payment for subscription ${subscriptionId} ignored: the subscription is ${
        subscription?.status ?? "missing"
      }.`,
    )
    return
  }

  const periodEnd = subscription.items.data[0]?.current_period_end

  const data = {
    ...(periodEnd ? { endDate: new Date(periodEnd * 1000) } : {}),
    paymentStatus: "SUCCESS" as const,
    isActive: true,
    totalMonths,
    cancel: subscription.cancel_at_period_end,
  }

  // Switching a membership on is claimed, so the welcome email goes exactly once. Only a
  // row still switched off matches: a redelivery, or a renewal, finds it on and falls
  // through to the ordinary write below, which changes nothing a second time. Two
  // deliveries at once cannot both match - Postgres re-reads the row for the second after
  // the first commits. A membership on hold stays switched on, so its retry being paid is a
  // payment, not a welcome.
  const switchedOn = await db.membership.updateMany({
    where: { stripeSubscriptionId: subscription.id, isActive: false },
    data,
  })
  const activated =
    switchedOn.count > 0 ||
    (await updateSubscriptionMembership(subscription, "payment", data)) ===
      "claimed"

  // Joining reprices what is already in the cart, a renewal steps the discount up, and a
  // paid retry lifts a hold - all three change what the cart should cost.
  const sync = await syncCartAfterMembershipChange(subscription.id)

  if (activated) {
    await sendMembershipWelcome({
      stripeSubscriptionId: subscription.id,
      amountPaidInCents:
        typeof invoice.amount_paid === "number" ? invoice.amount_paid : null,
      cartRepriced: (sync?.repriced ?? 0) > 0,
    })
  }
}

/**
 * Brings the member's cart in line with the membership just written: the discount on, off or
 * a step higher, and member-only items out while they are not a paid-up member.
 *
 * Never throws. The membership is what the event is about, and it is already written; the
 * cart load checks the discounts again whenever the app next asks (see `getCartItems`), so a
 * failure here costs a moment's staleness rather than a wrong charge.
 */
async function syncCartAfterMembershipChange(
  stripeSubscriptionId: string,
): Promise<CartSync | null> {
  try {
    return await syncCartWithMembership({ stripeSubscriptionId })
  } catch (error) {
    console.error(
      `Could not reprice the cart for subscription ${stripeSubscriptionId}:`,
      getErrorMessage(error),
    )
    return null
  }
}

/**
 * Writes to the membership a subscription belongs to. Never throws for a subscription that
 * matches no membership — it logs and returns — because a webhook that throws is redelivered
 * by Stripe for days, and a subscription with no membership never gains one by being retried.
 */
async function updateSubscriptionMembership(
  subscription: Stripe.Subscription,
  event: string,
  data: Prisma.MembershipUpdateManyMutationInput,
): Promise<"updated" | "claimed" | "none"> {
  const updated = await db.membership.updateMany({
    where: { stripeSubscriptionId: subscription.id },
    data,
  })
  if (updated.count > 0) return "updated"

  // createMembership stores the subscription id only once Stripe has created the
  // subscription, and Stripe attempts the first invoice while doing so — so its outcome, paid
  // or declined, can arrive before the id does. The row is found by its owner instead, and
  // only while it is still waiting on a first payment. A payment used to throw here, so only
  // Stripe's later retry ever switched such a membership on; a decline matched nothing and
  // was lost, leaving the app polling until it timed out.
  const userId = subscription.metadata?.userId
  if (userId) {
    const claimed = await db.membership.updateMany({
      where: { userId, isActive: false, paymentStatus: "PENDING" },
      data: { ...data, stripeSubscriptionId: subscription.id },
    })
    // Always a row that was switched off, so for a payment this is the switch-on.
    if (claimed.count > 0) return "claimed"
  }

  console.error(
    `Membership ${event} for subscription ${subscription.id} matched no membership.`,
  )
  return "none"
}

/** The subscription an invoice was raised for, in either shape Stripe sends. */
const subscriptionIdOf = (invoice: Stripe.Invoice) =>
  idOf(invoice.lines?.data[0]?.subscription) ??
  idOf(invoice.parent?.subscription_details?.subscription)

/** Subscription states in which a declined renewal is still being retried. */
const RETRYING_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>([
  "active",
  "past_due",
  "unpaid",
])

/** Why the last attempt at an invoice was declined, as Stripe reports it to the customer. */
async function declineOf(
  current: Stripe.Invoice,
  delivered: Stripe.Invoice,
): Promise<{ code: string | null; message: string | null }> {
  // The live invoice is read with its payments expanded, which is where this API version
  // keeps the payment intent. The event's own copy is in whatever version the webhook
  // endpoint is set to, so the older places are still tried.
  const legacy = delivered as Stripe.Invoice & {
    payment_intent?: string | null
  }
  const confirmation = delivered.confirmation_secret
  const paymentIntentId =
    getInvoicePaymentIntent(current) ??
    legacy.payment_intent ??
    (confirmation?.type === "payment_intent"
      ? confirmation.client_secret.split("_secret_")[0]
      : null)

  if (!paymentIntentId) return { code: null, message: null }

  const intent = await orNullIfMissing(
    stripe.paymentIntents.retrieve(paymentIntentId),
  )
  return {
    code: intent?.last_payment_error?.code ?? null,
    message: intent?.last_payment_error?.message ?? null,
  }
}

/**
 * Records a declined membership payment: a failed first payment ends the attempt to join,
 * a failed renewal puts the membership on hold while Stripe retries.
 *
 * Both the subscription and the invoice are read back from Stripe rather than taken from
 * the event (webhook), for two reasons. The handler used to call Stripe with whatever the event named
 * and throw on anything unexpected — an invoice with no subscription, a subscription Stripe
 * no longer had — so Stripe redelivered those for days.
 *
 * And a decline can be delivered after the payment has gone through: Stripe retries a
 * renewal on its own, and redelivers any event whose first delivery failed. Applied then,
 * the stale decline put a paid member back on hold, and since perks need a SUCCESS payment
 * status, switched their discount off until the next renewal. Only an invoice that is still
 * unpaid now is recorded as declined.
 */
async function recordMembershipPaymentFailure(
  subscriptionId: string,
  delivered: Stripe.Invoice,
) {
  if (!delivered.id) return

  const [subscription, current] = await Promise.all([
    orNullIfMissing(stripe.subscriptions.retrieve(subscriptionId)),
    orNullIfMissing(
      stripe.invoices.retrieve(delivered.id, { expand: ["payments"] }),
    ),
  ])

  if (!subscription || !current || current.status !== "open") {
    console.warn(
      `Membership payment failure for subscription ${subscriptionId} ignored: the invoice is ${
        current?.status ?? "missing"
      } and the subscription is ${subscription?.status ?? "missing"}.`,
    )
    return
  }

  if (subscription.status === "incomplete") {
    const decline = await declineOf(current, delivered)
    await updateSubscriptionMembership(subscription, "payment failure", {
      paymentStatus: "FAILED",
      isActive: false,
      paymentFailureCode: decline.code,
      paymentFailureMessage: decline.message,
    })
    await syncCartAfterMembershipChange(subscription.id)
    return
  }

  // A renewal. Once the subscription has ended, customer.subscription.deleted has the last
  // word; putting an ended membership on hold would offer its owner a retry that charges
  // them for a membership that no longer exists.
  if (!RETRYING_SUBSCRIPTION_STATUSES.has(subscription.status)) {
    console.warn(
      `Membership renewal failure for subscription ${subscriptionId} ignored: the subscription is ${subscription.status}.`,
    )
    return
  }

  // Going on hold is claimed, so the member is told once. Only a paid-up row matches: Stripe
  // retries a declined renewal several times over the following weeks, each decline is another
  // event, and any of them can be redelivered - all of those find the row already on hold and
  // fall through to the ordinary write below, which changes nothing a second time. A paid retry
  // puts the row back to SUCCESS, so a later renewal declined is a new hold and a new push.
  const putOnHold = await db.membership.updateMany({
    where: {
      stripeSubscriptionId: subscription.id,
      isActive: true,
      paymentStatus: "SUCCESS",
    },
    data: { paymentStatus: "PENDING" },
  })
  if (putOnHold.count === 0) {
    await updateSubscriptionMembership(subscription, "renewal failure", {
      paymentStatus: "PENDING",
    })
  }
  // On hold pauses every member benefit until the payment goes through: member prices come
  // off the cart and member-only items leave it now, not whenever the app next loads it.
  await syncCartAfterMembershipChange(subscription.id)

  // Before this the only sign was the membership screen turning red, on a screen a member has
  // no reason to open - and a hold left unpaid ends the subscription and the discount's run.
  if (putOnHold.count > 0) await warnRenewalDeclined(subscription.id)
}

/**
 * Records that a membership has ended.
 *
 * This used to mark every ended membership as a failed payment, so a member who cancelled
 * and simply reached the end of what they had paid for was told "Payment Failed" in red on
 * the membership screen. Stripe records why the subscription ended; only a payment that
 * failed or was disputed is a failure. Otherwise the status says nothing is owed — never
 * "pending", which would show the membership as on hold and offer to retry a payment for a
 * subscription that no longer exists.
 *
 * The end date is when the subscription actually ended, not when this event was processed,
 * which for a redelivered event can be days later.
 */
async function recordMembershipEnded(delivered: Stripe.Subscription) {
  // Stripe added the reason in 2023. An event rendered in an older version lacks it, so it
  // is read back through the SDK, which is pinned to a version that has it.
  const details =
    delivered.cancellation_details !== undefined
      ? delivered.cancellation_details
      : (await orNullIfMissing(stripe.subscriptions.retrieve(delivered.id)))
          ?.cancellation_details
  const reason = details?.reason
  const unpaid = reason === "payment_failed" || reason === "payment_disputed"

  await db.membership.updateMany({
    where: { stripeSubscriptionId: delivered.id },
    data: {
      paymentStatus: unpaid ? "FAILED" : "SUCCESS",
      isActive: false,
      endDate: delivered.ended_at
        ? new Date(delivered.ended_at * 1000)
        : new Date(),
      cancel: true,
    },
  })
  await syncCartAfterMembershipChange(delivered.id)
}

/**
 * Records whether a membership is set to end at the close of its period, and when.
 *
 * Read from the subscription as it stands, not from the event. This took the event's
 * `cancel_at_period_end` as the truth, and Stripe redelivers events: a "cancelling" update
 * that arrived again after the member had tapped Re-subscribe marked them as leaving, and the
 * app showed "Expires on" to someone still being billed until their next renewal set it right.
 */
async function recordMembershipSchedule(delivered: Stripe.Subscription) {
  const subscription = await orNullIfMissing(
    stripe.subscriptions.retrieve(delivered.id),
  )

  // An ended subscription is customer.subscription.deleted's to record.
  if (
    !subscription ||
    subscription.status === "canceled" ||
    subscription.status === "incomplete_expired"
  ) {
    return
  }

  if (subscription.cancel_at_period_end && subscription.cancel_at) {
    await db.membership.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: { endDate: new Date(subscription.cancel_at * 1000), cancel: true },
    })
  } else if (!subscription.cancel_at_period_end) {
    await db.membership.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: { cancel: false },
    })
  }
}

// stripeWebhook

export const stripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"] as string
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret)
  } catch (err: any) {
    console.error("❌ Webhook signature verification failed:", err.message)
    res.status(400).send(`Webhook Error: ${err.message}`)
    return
  }

  // 🔹 Handle different event types
  switch (event.type) {
    case "payment_intent.succeeded": {
      // const paymentIntent = event.data.object

      break
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice
      const subscriptionId = subscriptionIdOf(invoice)
      if (subscriptionId) {
        await recordMembershipPayment(subscriptionId, invoice)
      }
      break
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice
      // A one-off invoice has no subscription and nothing to do with a membership.
      const subscriptionId = subscriptionIdOf(invoice)
      if (subscriptionId) {
        await recordMembershipPaymentFailure(subscriptionId, invoice)
      }
      break
    }

    case "customer.subscription.updated": {
      await recordMembershipSchedule(event.data.object as Stripe.Subscription)
      break
    }

    case "customer.subscription.deleted": {
      await recordMembershipEnded(event.data.object as Stripe.Subscription)
      break
    }
  }

  res.json({ received: true })
  return
}
