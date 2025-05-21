import { db } from "../lib/db"

import { Request, Response } from "express"
import { Stripe } from "stripe"

// Initialize Stripe with your secret key
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

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
      return { customerId: user.stripeCustomerId }
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

    // Attach the payment method to the customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    })

    // Set as the default payment method if desired
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    })

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
