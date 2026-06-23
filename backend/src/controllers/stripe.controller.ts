import { db } from "../lib/db"

import { Request, Response } from "express"
import { Stripe } from "stripe"
import { membershipBenefits } from "../lib/membership"
import { createOrderForWebsite } from "./auth.controller"

// Initialize Stripe with your secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

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

async function getUserFromDatabase(userId: string) {
  // Implement your database lookup
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
    })
    if (!user) {
      return { id: null, stripeCustomerId: null }
    }
    if (user.stripeCustomerId) {
      return {
        id: userId,
        stripeCustomerId: user.stripeCustomerId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      }
    }
    return {
      id: userId,
      stripeCustomerId: null,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    }
  } catch (error) {}
}

async function updateUserWithCustomerId(userId: string, customerId: string) {
  // Implement your database update

  await db.user.update({
    where: { id: userId },
    data: {
      stripeCustomerId: customerId,
    },
  })
}

async function getOrCreateCustomerId(userId: string) {
  try {
    // In a real app, you would look up the user in your database
    // to see if they already have a Stripe customer ID
    const user = await getUserFromDatabase(userId)

    if (!user || !user.id) {
      return { customerId: undefined }
    }

    if (user.stripeCustomerId) {
      try {
        const customer = await stripe.customers.retrieve(user.stripeCustomerId)
        return { customerId: customer.id }
      } catch (error) {
        if (
          error instanceof Stripe.errors.StripeInvalidRequestError &&
          error.message.includes("No such customer")
        ) {
          const customer = await stripe.customers.create({
            metadata: {
              userId: userId,
              email: user.email,
              name: `${user.firstName} ${user.lastName}`,
            },
          })
          return { customerId: customer.id }
        }
      }
    }

    // If no customer ID exists, create a new customer in Stripe
    const customer = await stripe.customers.create({
      metadata: {
        userId: userId,
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
      },
      // You can also add email, name, etc. if available
    })

    // Save the customer ID to your database
    await updateUserWithCustomerId(userId, customer.id)

    return { customerId: customer.id }
  } catch (error) {
    console.error("Error in getOrCreateCustomerId:", error)
    throw error
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
    res.status(500).json({
      message: "Error fetching payment methods",
      error: (error as Error).message,
    })
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
    console.error("Error saving card:", error)
    res.status(500).json({
      message: "Error saving card",
      error: (error as Error).message,
    })
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
    const { setupIntentId } = req.body

    if (!setupIntentId) {
      res.status(400).json({ message: "Set up intent is required" })
      return
    }

    const { customerId } = await getOrCreateCustomerId(userId)
    if (!customerId) {
      res.status(400).json({ message: "Could not find your details" })
      return
    }

    const si = await stripe.setupIntents.retrieve(setupIntentId)

    const paymentMethodId = si.payment_method as string

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)

    console.log({
      paymentMethodCustomer: paymentMethod.customer,
      customerId,
      paymentMethod,
      paymentMethodId,
    })

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
      message: (error as Error).message,
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
    const { paymentMethodId } = req.body

    if (!paymentMethodId) {
      res.status(400).json({ message: "Payment method ID is required" })
      return
    }

    // Get or create a Stripe customer for this user
    const { customerId } = await getOrCreateCustomerId(userId)
    if (!customerId) {
      res.status(400).json({ message: "Could not find your details" })
      return
    }
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId)
    if (paymentMethod.customer && paymentMethod.customer !== customerId) {
      res.status(400).json({
        message: "This payment method is already attached to another customer",
      })
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
    res.status(500).json({
      message: "Error saving card",
      error: (error as Error).message,
    })
    return
  }
}

export const removeCard = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }
  try {
    const { paymentMethodId } = req.body

    if (!paymentMethodId) {
      res.status(400).json({ message: "Payment method ID is required" })
      return
    }

    // Detach the payment method
    await stripe.paymentMethods.detach(paymentMethodId)

    res.status(200).json({ success: true })
    return
  } catch (error) {
    console.error("Error removing card:", error)
    res.status(500).json({
      message: "Error removing card",
      error: (error as Error).message,
    })
    return
  }
}

export const createPaymentIntent = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthenticated" })
    return
  }
  try {
    const { amount, currency, paymentMethodId } = req.body

    if (!amount || !currency) {
      res.status(400).json({ message: "Amount and currency are required" })
      return
    }

    // Get or create a Stripe customer for this user
    const { customerId } = await getOrCreateCustomerId(userId)

    // Create a payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency,
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: false, // We'll confirm on the client side
      setup_future_usage: "off_session", // This allows the card to be used for future payments
    })

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    })
    return
  } catch (error) {
    console.error("Error creating payment intent:", error)
    res.status(500).json({
      message: "Error creating payment intent",
      error: (error as Error).message,
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
    // Retrieve the payment intent from Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)

    // Check if this payment intent belongs to this user
    // In a real app, you would check this in your database
    // For this example, we'll assume it's valid

    // Check if there's an order associated with this payment intent
    // In a real app, you would query your database
    // For this example, we'll simulate it
    let orderId = null
    try {
      // Query your database for an order with this payment intent ID
      const order = await db.order.findFirst({
        where: { paymentIntentId: paymentIntentId },
      })
      if (order?.appUserId !== userId) {
        res
          .status(403)
          .json({ message: "You don't have permission to view this order" })
        return
      }
      if (!order) {
        res.status(404).json({
          message: "no orders found associated with this payment intent",
        })
        return
      }
      orderId = order.id
    } catch (dbError) {
      console.error("Error checking for order:", dbError)
    }

    // Return the payment intent status
    res.status(200).json({
      success: paymentIntent.status === "succeeded",
      pending:
        paymentIntent.status === "processing" ||
        paymentIntent.status === "requires_capture",
      status: paymentIntent.status,
      orderId: orderId, // Include the order ID if found
    })
    return
  } catch (error) {
    console.error("Error checking payment status:", error)
    res.status(500).json({
      success: false,
      message: "Error checking payment status",
      error: (error as Error).message,
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
    })
    if (!membershipPlan) {
      res.status(404).json({ message: "Membership plan not found" })
      return
    }
    if (!membershipPlan.stripePriceId!) {
      res
        .status(404)
        .json({ message: "Membership plan does not have a stripe price id" })
    }
    const price = await stripe.prices.retrieve(membershipPlan.stripePriceId)
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
      error: (error as Error).message,
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
    const membership = await db.membership.findFirst({
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
    if (!membership) {
      res.status(404).json({ message: "user has no membership" })
      return
    }
    res.status(200).json(membership)
    return
  } catch (error) {
    console.error("Error getting users membership:", error)
    res.status(500).json({
      success: false,
      message: "Error getting users membership",
      error: (error as Error).message,
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
    res.status(500).json({
      message: (error as Error).message,
    })
  }
}

export const createMembership = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Please sign in to join our membership." })
    return
  }
  try {
    const { paymentMethodId, stripePriceId } = req.body

    // Get or create a Stripe customer for this user
    const { customerId } = await getOrCreateCustomerId(userId)

    if (!customerId) {
      res.status(400).json({ message: "Could not find your details" })
      return
    }

    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    })

    const plan = await db.membershipPlan.findFirstOrThrow({
      where: { name: "Monthly_Membership" },
    })

    let membership = await db.membership.findUnique({ where: { userId } })
    if (membership && membership.isActive) {
      res.status(400).json({ message: "Your membership is still active" })
      return
    }
    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "active", // or "active" if you only care about active ones
      expand: ["data.items.data.price"],
    })

    const hasSameSub = existingSubs.data.some((sub) =>
      sub.items.data.some((item) => item.price.id === stripePriceId),
    )

    if (hasSameSub) {
      res.status(400).json({ message: "Your membership is still active" })
      return
    }
    if (!membership) {
      // Create a membership in PENDING state
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
    } else {
      await db.membership.update({
        where: { id: membership.id },
        data: {
          paymentStatus: "PENDING",
          isActive: false,
          stripePaymentMethodId: paymentMethodId,
          totalMonths: 0,
        },
      })
    }

    // Create a payment intent
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: stripePriceId }],
      metadata: { userId },
      collection_method: "charge_automatically",
    })

    // first create the membership to store the subscriptionid before setting member active. Only set active when webhook confirms payment is successful

    // check if user has a membership record already else create one

    await db.membership.update({
      where: { id: membership.id },
      data: { stripeSubscriptionId: subscription.id },
    })

    res.status(201).json({ success: true })
    return
  } catch (error) {
    console.error("Error creating membership:", error)
    res.status(500).json({
      message: "Failed to create membership: " + (error as Error).message,
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

    await db.membership.updateMany({
      where: { stripeSubscriptionId: membership.stripeSubscriptionId },
      data: {
        endDate: new Date(subscription.cancel_at * 1000), // JS Date from timestamp
      },
    })
    res
      .status(201)
      .json({ success: true, endDate: new Date(subscription.cancel_at * 1000) })
  } catch (error) {
    console.error("Error cancelling membershp:", error)
    res.status(500).json({
      message: "Failed to cancel membership: " + (error as Error).message,
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
    res.status(500).json({
      message: (error as Error).message,
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

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 1,
      status: "active",
    })

    const subscription = subscriptions.data[0]
    if (!subscription) {
      res.status(200).json({ message: "No active subscription found" })
      return
    }

    const paymentMethodId = subscription.default_payment_method

    if (!paymentMethodId) {
      res.status(200).json({ message: "No payment method found" })
      return
    }

    res.status(200).json({ paymentMethodId })
    return
  } catch (error) {
    res.status(500).json({
      message:
        "Failed to fetch current subscription payment method ID: " +
        (error as Error).message,
    })
    return
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
      const newEndDate = invoice.period_end
      const subscriptionId = invoice.lines.data[0].subscription
      if (subscriptionId) {
        await db.membership.update({
          where: { stripeSubscriptionId: subscriptionId as string },
          data: {
            endDate: new Date(newEndDate * 1000),
            paymentStatus: "SUCCESS",
            isActive: true,
            totalMonths: { increment: 1 },
            cancel: false,
          },
        })
      }
      break
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice

      const subscriptionId = invoice.lines.data[0].subscription as string

      const subscription = await stripe.subscriptions.retrieve(subscriptionId)

      let paymentIntentId: string | null = null

      if ((invoice as any).payment_intent) {
        paymentIntentId = (invoice as any).payment_intent
      } else if (
        invoice.confirmation_secret &&
        invoice.confirmation_secret.type === "payment_intent"
      ) {
        const clientSecret = invoice.confirmation_secret.client_secret
        paymentIntentId = clientSecret.split("_secret_")[0]
      }

      let failureCode: string | null = null
      let failureMessage: string | null = null

      if (paymentIntentId) {
        const paymentIntent =
          await stripe.paymentIntents.retrieve(paymentIntentId)

        failureCode = paymentIntent.last_payment_error?.code ?? null
        failureMessage = paymentIntent.last_payment_error?.message ?? null
      }

      if (subscription.status === "incomplete") {
        // First payment failed
        await db.membership.updateMany({
          where: { stripeSubscriptionId: subscriptionId },
          data: {
            paymentStatus: "FAILED",
            isActive: false,
            paymentFailureCode: failureCode,
            paymentFailureMessage: failureMessage,
          },
        })
      } else {
        // Renewal payment failed -> still in retry window
        await db.membership.updateMany({
          where: { stripeSubscriptionId: subscriptionId },
          data: {
            paymentStatus: "PENDING", // attempt to charge the customer again before cancelling their membership
          },
        })
      }
      break
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription

      // Check if subscription is set to cancel at period end
      if (sub.cancel_at_period_end && sub.cancel_at) {
        // Update your DB with the endDate from Stripe
        await db.membership.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { endDate: new Date(sub.cancel_at * 1000), cancel: true }, // timestamp to JS Date
        })
      } else if (!sub.cancel_at_period_end) {
        await db.membership.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: { cancel: false }, // timestamp to JS Date
        })
      }
      break
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription

      // Only mark inactive if subscription ended immediately
      await db.membership.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: {
          paymentStatus: "FAILED",
          isActive: false,
          endDate: new Date(),
          cancel: true,
        },
      })
      break
    }
  }

  res.json({ received: true })
  return
}
