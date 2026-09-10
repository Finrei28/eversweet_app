import { Request, Response } from "express"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import { Prisma } from "@prisma/client"
import { db, DbTransactionClient } from "../lib/db"
import { CreateOrderSchema } from "../utils/schema"
import { z } from "zod"
import VerifyEmail from "../email/verifyEmail"
import EmailOrderConfirmation from "../email/orderConfirmation"
import { emitNewOrder } from "../lib/socket"
import { Status } from "../types/types"
import { loyaltyRates } from "../lib/loyaltyRates"
import { formatInTimeZone } from "date-fns-tz"
import EmailSender from "../lib/emailSender"
import { getErrorMessage } from "../utils/getError"
import {
  checkPickUpTime,
  getDaysOffKeys,
  nzMonthRange,
} from "../lib/tradingHours"
import { calculateCartPrice } from "../lib/cartPricing"
import { redeemableAudiences } from "../lib/offerAudience"

//Helper function
/**
 * `client` lets a caller run this inside an open transaction. Order creation
 * does: points earned by an order have to commit or roll back with it.
 */
const incrementLoyaltyPoints = async (
  userId: string,
  points: number,
  client: DbTransactionClient = db,
) => {
  if (!userId) throw new Error("User not authenticated")
  if (!points) throw new Error("No points to add")

  const numericPoints = Number(points)
  if (!numericPoints || isNaN(numericPoints)) throw new Error("Invalid points")

  const existing = await client.loyalty.findUnique({
    where: { userId },
    select: { points: true },
  })

  if (!existing) {
    const newLoyalty = await client.loyalty.create({
      data: {
        userId: userId,
        points: numericPoints,
        records: { create: { change: numericPoints, reason: "EARNED" } },
      },
    })
    return newLoyalty.points
  }

  const updated = await client.loyalty.update({
    where: { userId },
    data: {
      points: existing.points + numericPoints,
      records: { create: { change: numericPoints, reason: "EARNED" } },
    },
  })

  return updated.points
}

export const signUp = async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, phoneNumber } =
    req.body ?? {}
  if (!email) {
    res.status(400).json({ message: "Email is required" })
    return
  }
  if (!password) {
    res.status(400).json({ message: "Password is required" })
    return
  }
  if (!firstName) {
    res.status(400).json({ message: "First name is required" })
    return
  }
  if (!lastName) {
    res.status(400).json({ message: "Last name is required" })
    return
  }
  if (!phoneNumber) {
    res.status(400).json({ message: "Phone number is required" })
    return
  }

  const normalisedEmail = email.trim().toLowerCase()

  const existUser = await db.user.findFirst({
    where: { email: normalisedEmail },
  })
  if (existUser) {
    res.status(400).json({ message: "Email already registered" })
    return
  }
  const hashed = await bcrypt.hash(password, 10)
  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000)
  try {
    const newUser = await db.user.create({
      data: {
        email: normalisedEmail,
        password: hashed,
        firstName:
          firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase(),
        lastName:
          lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase(),
        phone: phoneNumber,
        role: "USER",
        otp,
        otpExpiresAt,
        Loyalty: {
          create: {
            points: 0,
          },
        },
      },
    })
    const subject = "Verify your email address"
    await EmailSender(email, subject, VerifyEmail({ otp }))
    res
      .status(201)
      .json({ message: "User created", firstName: newUser.firstName ?? "" })
    return
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) })
    return
  }
}

export const signIn = async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {}
  if (!email || !password) {
    res.status(400).json("Email and password is required")
    return
  }
  const normalisedEmail = email.trim().toLowerCase()
  try {
    const user = await db.user.findUnique({ where: { email: normalisedEmail } })
    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401).json("Invalid credentials")
      return
    }

    if (!!user.emailVerified === false) {
      // Only mint a code when the last one is spent or expired. Sign-in is a
      // valid-credentials path that answers 200, so the email limiters never
      // count it — without this check it's a free way to flood an inbox.
      const hasLiveOtp =
        user.otp &&
        user.otpExpiresAt &&
        new Date() < new Date(user.otpExpiresAt)
      if (!hasLiveOtp) {
        const otp = Math.floor(100000 + Math.random() * 900000).toString()
        const otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000)
        await db.user.update({
          where: { id: user.id },
          data: {
            otp,
            otpExpiresAt,
          },
          select: { id: true },
        })
        const subject = "Verify your email address"
        await EmailSender(user.email, subject, VerifyEmail({ otp }))
      }
      res.status(200).json({
        message: "User needs to verify email",
        name: user.firstName ?? "",
        emailVerified: !!user.emailVerified,
      })
      return
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
      },
      process.env.JWT_SECRET!,
      {
        expiresIn: "90d",
      },
    )
    res.status(200).json({
      token,
      name: user.firstName ?? "",
      emailVerified: !!user.emailVerified,
    })
    return
  } catch (error) {
    if (getErrorMessage(error).includes("limit")) {
      res.status(429).json({
        message: "We've reached our email limit. Please try again tomorrow.",
      })
      return
    }

    if (getErrorMessage(error).includes("domain")) {
      res.status(400).json({
        message: "Email service is not configured correctly.",
      })
      return
    }

    res.status(500).json({ message: error })
    return
  }
}

export const resendVerificationCode = async (req: Request, res: Response) => {
  // The signup flow used to reuse getResetPasswordCode to resend, which meant
  // one code served both flows. Email verification now has its own endpoint so
  // the two codes stay in separate columns.
  const { email } = req.body ?? {}
  if (typeof email !== "string" || !email) {
    res.status(400).json({ message: "Email is required" })
    return
  }
  const normalisedEmail = email.trim().toLowerCase()
  try {
    const user = await db.user.findUnique({
      where: { email: normalisedEmail },
      select: { id: true, email: true, emailVerified: true },
    })
    // Say the same thing either way, so this can't be used to test which
    // addresses are registered or already verified.
    if (!user || user.emailVerified) {
      res.status(200).json({ success: true })
      return
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString()
    await db.user.update({
      where: { id: user.id },
      data: { otp, otpExpiresAt: new Date(Date.now() + 15 * 60 * 1000) },
      select: { id: true },
    })
    await EmailSender(
      user.email,
      "Verify your email address",
      VerifyEmail({ otp }),
    )
    res.status(200).json({ success: true })
    return
  } catch (error) {
    res.status(500).json({ message: getErrorMessage(error) })
    return
  }
}

export const checkVerificationCode = async (req: Request, res: Response) => {
  const { verificationCode, email } = req.body ?? {}

  try {
    if (!verificationCode) {
      res.status(400).json({ message: "Verification code is missing" })
      return
    }
    if (!email) {
      res.status(400).json({ message: "email is missing" })
      return
    }
    const normalisedEmail = email.trim().toLowerCase()
    const user = await db.user.findUnique({
      where: { email: normalisedEmail },
      select: {
        id: true,
        otpExpiresAt: true,
        otp: true,
        email: true,
        role: true,
        firstName: true,
      },
    })
    if (!user) {
      res.status(400).json({ message: "No user found" })
      return
    }

    if (verificationCode !== user.otp?.toString()) {
      res.status(401).json({ message: "Invalid verification code." })
      return
    }

    if (!user.otpExpiresAt) {
      res.status(400).json({ message: "Not valid" })
      return
    }

    const currentTime = new Date()
    const expirationTime = new Date(user.otpExpiresAt)

    if (currentTime > expirationTime) {
      res.status(400).json("Verification code has expired.")
      return
    }
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
      },
      process.env.JWT_SECRET!,
      {
        expiresIn: "90d",
      },
    )

    await db.user.update({
      where: { id: user.id },
      // Spend the code on the way through, otherwise it stays live for the
      // rest of its 15 minutes and can be replayed.
      data: {
        emailVerified: new Date(),
        otp: null,
        otpExpiresAt: null,
      },
      select: { id: true },
    })

    res.status(200).json({
      message: "Verification code is valid.",
      token,
      name: user.firstName ?? "",
      emailVerified: true,
    })
    return
  } catch (error) {
    res.status(500).json({ message: error })
    return
  }
}

export const getUser = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        anonymousEnabled: true,
        // exclude sensitive fields like password
      },
    })
    if (!user) {
      res.status(404).json({ message: "User not found" })
      return
    }
    res.status(200).json({ user })
    return
  } catch (error) {
    console.error("Error fetching user:", error)
    res.status(500).json({ message: "Internal server error" })
    return
  }
}

export const updateAnonymousStatus = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    const { value } = req.body ?? {}
    if (typeof value !== "boolean") {
      res.status(400).json({ message: "value is required" })
      return
    }
    const user = await db.user.update({
      where: { id: userId },
      data: { anonymousEnabled: value },
      select: { anonymousEnabled: true },
    })
    res.status(200).json({ value: user.anonymousEnabled })
    return
  } catch (error) {
    console.error("Error updating anonymous status:", error)
    res.status(500).json({ message: "Internal server error" })
    return
  }
}

export const updateUser = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    const { email, firstName, lastName, phone } = req.body ?? {}
    if (!email || !firstName || !lastName || !phone) {
      res.status(400).json({
        message: "Email, first name, last name and phone are required",
      })
      return
    }
    // Sign-in and password reset both look up by trim().toLowerCase(), so
    // storing it any other way locks the account out of both.
    const normalisedEmail = email.trim().toLowerCase()
    const existing = await db.user.findUnique({
      where: { email: normalisedEmail },
      select: { id: true },
    })
    if (existing && existing.id !== userId) {
      res.status(409).json({ message: "Email already registered" })
      return
    }
    const user = await db.user.update({
      where: { id: userId },
      data: {
        email: normalisedEmail,
        firstName:
          firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase(),
        lastName:
          lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase(),
        phone,
        // exclude sensitive fields like password
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
    })
    if (!user) {
      res.status(404).json({ message: "User not found" })
      return
    }
    res.status(200).json({ user })
    return
  } catch (error) {
    console.error("Error fetching user:", error)
    res.status(500).json({ message: "Internal server error" })
    return
  }
}

export const getOrder = async (req: Request, res: Response) => {
  try {
    const { orderId } = req.body ?? {}
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthenticated" })
      return
    }
    if (!orderId) {
      res.status(400).json({ message: "No such order was found" })
      return
    }
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        desserts: {
          include: {
            dessert: {
              select: {
                id: true,
                name: true,
                chineseName: true,
                imagePath: true,
              },
            },
            customisations: {
              include: {
                customisation: {
                  select: { id: true, name: true, chineseName: true },
                },
              },
            },
          },
        },
      },
    })
    // Same 404 whether the order is missing or belongs to someone else — it
    // carries the customer's name, email and phone, so confirming that an id
    // exists is already more than a stranger should learn.
    if (!order || order.appUserId !== userId) {
      res.status(404).json({ message: "No such order was found" })
      return
    }

    res.status(200).json({ order })
    return
  } catch (error) {
    res.status(500).json({ message: error })
    return
  }
}

export const getUserOrders = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId

    const { status, limit, cursor } = req.body ?? {}
    if (!Object.values(Status).includes(status)) {
      res.status(400).json({ message: "Invalid status" })
      return
    }

    /*
     * Optional, and omitted means "all of them" — the shape older builds
     * already on people's phones expect. Picked-up orders accumulate for the
     * life of an account, so the history screen asks for a page at a time
     * rather than downloading and parsing every order a regular customer has
     * ever placed.
     */
    const take =
      typeof limit === "number" && limit > 0 ? Math.min(limit, 100) : undefined
    if (!userId) {
      res.status(401).json({ message: "Unauthenticated" })
      return
    }
    const orders = await db.user.findUnique({
      where: { id: userId },
      select: {
        appOrders: {
          where: {
            status:
              status === "PICKED_UP"
                ? "PICKED_UP"
                : {
                    in: ["PENDING", "READY", "ACCEPTED", "MAKING"],
                  },
          },
          orderBy: {
            createdAt: "desc", // ✅ Sorts by newest first
          },
          // One past the page so the caller learns whether more exist without
          // a second count query.
          ...(take ? { take: take + 1 } : {}),
          ...(cursor ? { skip: 1, cursor: { id: cursor as string } } : {}),
          include: {
            desserts: {
              include: {
                dessert: {
                  select: {
                    id: true,
                    name: true,
                    chineseName: true,
                    imagePath: true,
                  },
                },
                customisations: {
                  include: {
                    customisation: {
                      select: {
                        id: true,
                        name: true,
                        chineseName: true,
                        priceInCents: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
    const page = orders?.appOrders ?? []
    const hasMore = take !== undefined && page.length > take
    const items = hasMore ? page.slice(0, take) : page

    res.status(200).json({
      orders: items,
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
    })
    return
  } catch (error) {
    res.status(500).json({ message: error })
    return
  }
}

export const getUserLoyaltyPoints = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }

    const loyaltyPoints = await db.loyalty.findUnique({
      where: { userId },
      select: {
        points: true,
      },
    })
    res.status(200).json({ points: loyaltyPoints?.points ?? 0 })
    return
  } catch (error) {
    res.status(500).json({ message: error })
    return
  }
}

/**
 * The shape every response carrying an order uses, so a replayed order and a
 * freshly created one are indistinguishable to the client.
 */
const orderSelect = {
  id: true,
  tempOrderId: true,
  status: true,
  createdAt: true,
  customerFirstName: true,
  customerLastName: true,
  customerEmail: true,
  customerPhoneNumber: true,
  priceInCents: true,
  discountedAmountInCents: true,
  pickUpTime: true,
  dineIn: true,
  pickedUpAt: true,
  GST: true,
  notified: true,
  appUserId: true,
  desserts: {
    select: {
      orderId: true,
      id: true,
      quantity: true,
      priceInCents: true,
      discountedAmountInCents: true,
      offerId: true,
      dessert: {
        select: {
          id: true,
          name: true,
          chineseName: true,
          imagePath: true,
          categoryId: true,
        },
      },
      customisations: {
        select: {
          id: true,
          quantity: true,
          discountedAmountInCents: true,
          customisation: {
            select: {
              id: true,
              name: true,
              chineseName: true,
              priceInCents: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderSelect

export const createOrder = async (req: Request, res: Response) => {
  let newOrder
  // Hoisted so the catch below can tell a lost race from a real failure.
  let paymentIntentId: string | null = null
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }

    const parsedBody = CreateOrderSchema.parse({
      ...(req.body ?? {}),
      pickUpTime: new Date(req.body?.pickUpTime),
    })

    paymentIntentId = parsedBody.paymentIntentId ?? null

    // A retry of a request that already succeeded has to return the original
    // order. The cart is deleted at the end of the first run, so without this
    // the retry falls through to the empty-cart branch and tells a customer
    // whose card was charged that their order failed — at which point they
    // pay again. Checked before the trading-hours gate: an order that exists
    // is an order, whatever the clock says now.
    if (paymentIntentId) {
      const existing = await db.order.findUnique({
        where: { paymentIntentId },
        select: orderSelect,
      })

      if (existing) {
        res.status(200).json({ order: existing })
        return
      }
    }

    const pickUpCheck = checkPickUpTime(parsedBody.pickUpTime, {
      eatIn: parsedBody.eatIn,
      daysOffKeys: await getDaysOffKeys(),
    })

    if (!pickUpCheck.ok) {
      // Refusing a paid order would strand the customer's money: the card is
      // charged before this endpoint is reached and nothing here can refund it.
      // `createPaymentIntent` is the gate that stops a bad time before the
      // charge, so reaching this branch with a payment attached means the store
      // closed in the seconds since. Take the order and make the problem
      // visible instead of taking the money and dropping it.
      if (parsedBody.paymentIntentId) {
        console.error(
          `Order accepted with an invalid pick up time (${pickUpCheck.message}) ` +
            `because payment ${parsedBody.paymentIntentId} was already taken. ` +
            `User ${userId}, requested ${parsedBody.pickUpTime.toISOString()}.`,
        )
      } else {
        res.status(400).json({ message: pickUpCheck.message })
        return
      }
    }

    const cart = await db.cart.findUnique({
      where: { userId },
      include: {
        cartItems: {
          include: {
            dessert: true,
            customisations: { include: { customisation: true } },
          },
        },
      },
    })

    if (!cart || cart.cartItems.length === 0) {
      // The narrow window the pre-flight check above cannot cover: a
      // concurrent attempt committed — emptying the cart — between that lookup
      // and this read. The order exists and is paid for, so report it rather
      // than an empty cart.
      if (paymentIntentId) {
        const justCreated = await db.order.findUnique({
          where: { paymentIntentId },
          select: orderSelect,
        })

        if (justCreated) {
          res.status(200).json({ order: justCreated })
          return
        }
      }

      res.status(400).json({ message: "Cart is empty" })
      return
    }

    const user = await db.user.findUnique({
      where: { id: userId },
    })

    if (!user) {
      res.status(401).json({ message: "Unauthenticated" })
      return
    }

    const pickUpNZDate = formatInTimeZone(
      new Date(parsedBody.pickUpTime),
      "Pacific/Auckland",
      "yyyy-MM-dd",
    )

    // One statement, so two orders placed at the same moment cannot both find
    // the row missing and both try to create it. Read-then-create failed the
    // loser with a unique-constraint error on the first order of a new day.
    const counter = await db.tempOrderCounter.upsert({
      where: { date: pickUpNZDate },
      create: { date: pickUpNZDate, counter: 6000 },
      update: { counter: { increment: 1 } },
    })

    // Same helper `createPaymentIntent` prices the charge with, so the order
    // recorded here and the amount taken can never disagree.
    const {
      beforeDiscountInCents: totalPriceInCentsBeforeDiscount,
      discountInCents: discountedAmountInCents,
      payableInCents,
      gstInCents,
    } = calculateCartPrice(cart.cartItems)

    // One transaction for every write this order makes: the order row, the
    // points it earns, the offers it unlocks, and the cart it empties. The
    // cart delete used to be a separate statement, so a failure between the
    // two committed an order and left the cart full — leaving the customer
    // able to pay for the same items a second time.
    //
    // The confirmation email and the socket emit stay outside it. Both are
    // external and slow, and neither should be able to roll back an order
    // the customer has already paid for.
    newOrder = await db.$transaction(
      async (tx) => {
        const order = await tx.order.create({
          data: {
            tempOrderId: counter.counter.toString(),
            customerFirstName: user.firstName ?? "",
            customerLastName: user.lastName ?? "",
            customerEmail: user.email,
            customerPhoneNumber: user.phone,
            appUser: {
              connect: {
                id: userId,
              },
            },
            source: "APP",
            priceInCents: totalPriceInCentsBeforeDiscount,
            discountedAmountInCents: discountedAmountInCents,
            // From the priced items, not Cart.totalPriceInCents: that column is
            // kept up to date by scattered increment/decrement writes and can
            // drift from the rows it summarises. Extracted from the inclusive
            // total rather than added on top of it, and rounded, since this is an
            // Int column that a raw percentage would not always land on.
            GST: gstInCents,
            pickUpTime: parsedBody.pickUpTime,
            dineIn: parsedBody.eatIn,
            status: "PENDING",
            paymentIntentId: parsedBody.paymentIntentId,
            paymentMethodId: parsedBody.paymentMethodId,
            desserts: {
              create: cart.cartItems.map((dessertItem) => ({
                dessert: {
                  connect: {
                    id: dessertItem.dessert.id, // Ensure dessert exists before connecting
                  },
                },
                // Connected through the relation rather than written as a
                // foreign key. Prisma will not accept `offerId` in the same
                // create as `dessert: { connect }`: one belongs to its checked
                // create input and the other to its unchecked one, and mixing
                // the two fails the whole order with "Unknown argument
                // `offerId`".
                ...(dessertItem.offerId
                  ? { offer: { connect: { id: dessertItem.offerId } } }
                  : {}),
                quantity: dessertItem.quantity,
                priceInCents: dessertItem.itemPriceInCents, // get price from order item
                discountedAmountInCents: dessertItem.discountedAmountInCents,
                loyaltyPointsUsed: dessertItem.loyaltyPointsUsed ?? null,
                customisations: {
                  create: dessertItem.customisations.map((customisationsItem) => ({
                    customisation: {
                      connect: {
                        id: customisationsItem.customisation.id, // Ensure customisation exists before connecting
                      },
                    },
                    discountedAmountInCents:
                      customisationsItem.discountedAmountInCents,
                    quantity: customisationsItem.quantity,
                  })),
                },
              })),
            },
          },
          select: orderSelect,
        })

        // add points members and non members
        if (cart.totalPriceInCents > 0) {
          const membership = await tx.membership.findUnique({ where: { userId } })
          let earnablePoints = 0

          earnablePoints = cart.cartItems.reduce(
            (acc, item) =>
              acc +
              Math.floor(
                ((item.itemPriceInCents -
                  item.discountedAmountInCents +
                  item.customisations.reduce(
                    (acc, c) =>
                      acc +
                      (c.quantity > 0
                        ? (c.customisation.priceInCents -
                            c.discountedAmountInCents) *
                          c.quantity
                        : 0),
                    0,
                  )) /
                  100) * // points is calculated per dollar
                  (loyaltyRates.rate ?? 5) * // if !rates.rate ? fallback to 5 points per dollar
                  item.quantity *
                  (membership?.isActive
                    ? (loyaltyRates.modifier ?? 1) * loyaltyRates.memberRate // if !rates.modifier ? fallback to 1
                    : (loyaltyRates.modifier ?? 1)),
              ),
            0,
          )

          // Zero is reachable on a very small order once the per-dollar rate
          // is floored, and the helper treats zero as a programming error. It
          // would now roll the whole order back rather than skip a no-op.
          if (earnablePoints > 0) {
            await incrementLoyaltyPoints(userId, earnablePoints, tx)
          }

          // Unlock any requirement-gated offer this order qualifies for.
          //
          // No longer members-only: an offer open to everyone can carry
          // requirements too, and without this it would be advertised and
          // then refused, because redeeming one needs an AVAILABLE
          // redemption and this is the only thing that creates one.
          {
            // Newness is judged as of *before* this order. The order row
            // already exists inside this transaction, so counting plainly
            // would make every customer non-new by the time we get here and
            // no NEW_USERS offer could ever unlock.
            const priorOrders = await tx.order.count({
              where: { appUserId: userId, id: { not: order.id } },
            })

            const viewer = {
              isActiveMember:
                !!membership &&
                membership.isActive &&
                membership.paymentStatus === "SUCCESS",
              isNewCustomer: priorOrders === 0,
            }

            const lockedOffers = await tx.offer.findMany({
              where: {
                isActive: true,
                audience: { in: redeemableAudiences(viewer) },
                redemptions: { none: { userId } },
                requirements: {
                  some: {}, // ensures at least 1 requirement exists
                },
              },
              include: {
                requirements: true,
              },
            })
            // count desserts and categories in the order for offer eligibility check
            const dessertCounts: Record<string, number> = {}
            const categoryCounts: Record<string, number> = {}
            for (const item of order.desserts) {
              const id = item.dessert.id
              dessertCounts[id] = (dessertCounts[id] ?? 0) + item.quantity
              const categoryId = item.dessert.categoryId
              categoryCounts[categoryId] =
                (categoryCounts[categoryId] ?? 0) + item.quantity
            }

            // offer requirements check
            const eligibleOffers = lockedOffers.filter((offer) => {
              return offer.requirements.every((req) => {
                if (req.dessertId) {
                  return (dessertCounts[req.dessertId] ?? 0) >= req.quantity
                }

                if (req.categoryId) {
                  return (categoryCounts[req.categoryId] ?? 0) >= req.quantity
                }

                return false
              })
            })

            // createMany over a loop of creates: a unique-constraint collision
            // here would throw inside the order transaction and roll back an
            // order the customer has already paid for.
            await tx.offerRedemption.createMany({
              data: eligibleOffers.map((offer) => ({
                offerId: offer.id,
                userId,
                unlockedAt: new Date(),
                status: "AVAILABLE" as const,
              })),
              skipDuplicates: true,
            })
          }
        }

        // The cart goes with the order, in the same commit.
        await tx.cart.delete({ where: { userId } })
        return order
      },
      // The nested order create plus the loyalty and offer writes run past
      // Prisma's 5s default when the connection is cold.
      { timeout: 20_000, maxWait: 10_000 },
    )

    // Past this point the order is committed and paid for. Anything that
    // fails below is reported as a follow-up failure carrying the order id,
    // never as a failed order.
    const subject = "Order Confirmation"
    await EmailSender(
      user.email,
      subject,
      EmailOrderConfirmation({ order: newOrder }),
    )

    if (parsedBody.pickupNow && newOrder.notified === false) {
      emitNewOrder(newOrder)
    }

    res.status(201).json({ order: newOrder })
    return
  } catch (error) {
    // Two attempts ran at once and this one lost the unique constraint on
    // paymentIntentId. The other created the order; return that rather than
    // reporting a failure for an order that exists and is paid for.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      paymentIntentId
    ) {
      const winner = await db.order.findUnique({
        where: { paymentIntentId },
        select: orderSelect,
      })

      if (winner) {
        res.status(200).json({ order: winner })
        return
      }
    }

    if (newOrder?.id) {
      res.status(500).json({
        message: "Order was created, but a follow-up action failed.",
        orderId: newOrder.id,
      })
      return
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({
        message: "Invalid data",
        errors: error.errors, // This will give the validation errors
      })
      return
    }

    if (getErrorMessage(error).includes("limit")) {
      res.status(429).json({
        message: "We've reached our email limit. Please try again tomorrow.",
      })
      return
    }

    if (getErrorMessage(error).includes("domain")) {
      res.status(400).json({
        message: "Email service is not configured correctly.",
      })
      return
    }

    // Handle other types of errors (e.g., DB errors)
    res.status(500).json({ message: "Internal server error" })
    return
  }
}

export const orderStatus = async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }

    // Find the order in the database
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        appUserId: true,
      },
    })

    // If order doesn't exist or doesn't belong to this user
    if (!order) {
      res.status(404).json({
        success: false,
        message: "Order not found",
      })
      return
    }

    // If order exists but belongs to another user
    if (order.appUserId !== userId) {
      res.status(403).json({
        success: false,
        message: "You don't have permission to view this order",
      })
      return
    }

    // else order is present

    res.status(200).json({
      success: true,
      status: order.status,
    })
    return
  } catch (error) {
    console.error("Error checking order status:", error)
    res.status(500).json({
      success: false,
      message: "Error checking order status",
      error: getErrorMessage(error),
    })
    return
  }
}

export const showOffers = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    // No membership gate any more. Everyone gets the full active list; the
    // members-only ones come back flagged so the app can render them locked
    // with a join prompt rather than hiding them, which is the upsell.
    const [membership, priorOrders] = await Promise.all([
      db.membership.findUnique({ where: { userId } }),
      db.order.count({ where: { appUserId: userId } }),
    ])

    const viewer = {
      isActiveMember:
        !!membership &&
        membership.isActive &&
        membership.paymentStatus === "SUCCESS",
      isNewCustomer: priorOrders === 0,
    }

    const offers = await db.offer.findMany({
      where: { isActive: true },
      include: {
        dessert: {
          select: {
            id: true,
            name: true,
            priceInCents: true,
            chineseName: true,
            description: true,
            priceInLoyaltyPoints: true,
            imagePath: true,
            ingredients: { include: { ingredient: true } },
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            chineseName: true,
            desserts: {
              select: {
                id: true,
                name: true,
                priceInCents: true,
                chineseName: true,
                description: true,
                priceInLoyaltyPoints: true,
                imagePath: true,
                ingredients: { include: { ingredient: true } },
              },
            },
          },
        },
        requirements: true,
        redemptions: {
          where: { userId },
        },
      },
    })

    const serializedOffers = offers.map((o) => ({
      ...o,
      discountAmount: o.discountAmount ? o.discountAmount.toNumber() : null,
      dessert: o.dessert
        ? {
            ...o.dessert,
            ingredients: o.dessert.ingredients.map((i) => i.ingredient),
          }
        : null,
      category: o.category
        ? {
            ...o.category,
            desserts: o.category.desserts.map((d) => ({
              ...d,
              ingredients: d.ingredients.map((i) => i.ingredient),
            })),
          }
        : null,
    }))

    // `viewer` travels with the list because the app cannot work out
    // isNewCustomer on its own — it has no order count — and both flags need
    // to agree with what the cart guard will decide.
    res.status(200).json({ offers: serializedOffers, viewer })
    return
  } catch (error) {
    res.status(500).json({ message: error })
    return
  }
}

export const getLeaderBoard = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    // The New Zealand month, because that is what the app's copy promises and
    // what calculateMonthlyWinner settles against. This filter spent a while
    // commented out, which quietly turned the board into an all-time ranking
    // that disagreed with its own description — and left the query summing every
    // positive loyalty record ever written, for every customer, on each view.
    const { start, end } = nzMonthRange(new Date())

    const leaderboard = await db.loyaltyRecord.groupBy({
      by: ["loyaltyId"],
      where: {
        // Earnings only. `change > 0` alone is not enough: a refunded redemption
        // is written back as a *positive* record, so redeeming points and then
        // having the order cancelled left the points on the board — repeatably,
        // with the balance restored. `reason` is a free-form string rather than
        // an enum, so this pairs with the sign rather than replacing it.
        change: { gt: 0 },
        reason: "EARNED",
        createdAt: {
          gte: start,
          lt: end,
        },
      },
      _sum: {
        change: true,
      },
      _max: {
        createdAt: true,
      },
      orderBy: [
        {
          _sum: {
            change: "desc",
          },
        },
        // A tie goes to whoever got there first: of two customers level on
        // points, the one whose last qualifying earning came earlier.
        //
        // Ties need *some* deterministic key or Postgres orders equal sums
        // however the plan happens to emit them — three customers level across
        // positions 9-11 meant one refresh put you at #10 and the next at #11.
        // This particular key is the one settleMonthlyWinners uses to decide who
        // is actually paid, and the two must not disagree: the board a customer
        // watched all month has to be the board that pays out.
        { _max: { createdAt: "asc" } },
        // Last resort, for two customers whose final earning landed in the same
        // millisecond. Arbitrary, but total — without it the order is undefined.
        { loyaltyId: "asc" },
      ],
    })

    // Read, not upsert: this is a GET, and the upsert it replaces created a
    // Loyalty row as a side effect of merely looking at the leaderboard. A
    // customer who has never earned anything has no row, which findIndex already
    // reports as unranked.
    const usersLoyalty = await db.loyalty.findUnique({
      where: { userId },
      select: { id: true },
    })

    const userRankIndex = usersLoyalty
      ? leaderboard.findIndex((r) => r.loyaltyId === usersLoyalty.id)
      : -1

    const top10 = leaderboard.slice(0, 10)

    const loyalties = await db.loyalty.findMany({
      where: {
        id: { in: top10.map((l) => l.loyaltyId) },
      },
      select: {
        id: true,
        User: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            anonymousEnabled: true,
          },
        },
      },
    })

    const loyaltyMap = new Map(loyalties.map((l) => [l.id, l]))

    const result = top10.map((entry) => {
      const loyalty = loyaltyMap.get(entry.loyaltyId)

      return {
        user: loyalty?.User ?? null,
        pointsEarned: entry._sum.change ?? 0,
      }
    })

    res.status(200).json({
      leaderboard: result,
      userRank:
        userRankIndex === -1
          ? null
          : {
              position: userRankIndex + 1,
              points: leaderboard[userRankIndex]._sum.change ?? 0,
            },
    })
    return
  } catch (error) {
    res.status(500).json({
      message: "Error getting leaderboard: " + getErrorMessage(error),
    })
  }
}
