import { Request, Response } from "express"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import { db } from "../lib/db"
import { CreateOrderSchema } from "../utils/schema"
import { z } from "zod"
import { Resend } from "resend"
import VerifyEmail from "../email/verifyEmail"
import EmailOrderConfirmation from "../email/orderConfirmation"
import { emitNewOrder } from "../index"
import { Status, WebOrderType } from "../types/types"
import { loyaltyRates } from "../lib/loyaltyRates"
import { formatInTimeZone } from "date-fns-tz"

const resend = new Resend(process.env.RESEND_API_KEY!)

//Helper function
const incrementLoyaltyPoints = async (userId: string, points: number) => {
  if (!userId) throw new Error("User not authenticated")
  if (!points) throw new Error("No points to add")

  const numericPoints = Number(points)
  if (!numericPoints || isNaN(numericPoints)) throw new Error("Invalid points")

  const existing = await db.loyalty.findUnique({
    where: { userId },
    select: { points: true },
  })

  if (!existing) {
    const newLoyalty = await db.loyalty.create({
      data: {
        userId: userId,
        points: numericPoints,
        records: { create: { change: numericPoints, reason: "EARNED" } },
      },
    })
    return newLoyalty.points
  }

  const updated = await db.loyalty.update({
    where: { userId },
    data: {
      points: existing.points + numericPoints,
      records: { create: { change: numericPoints, reason: "EARNED" } },
    },
  })

  return updated.points
}

export const createOrderForWebsite = async (
  orderData: WebOrderType,
  paymentIntentId: string,
): Promise<string> => {
  const todayNZ = formatInTimeZone(new Date(), "Pacific/Auckland", "yyyy-MM-dd")

  let counter = await db.tempOrderCounter.findUnique({
    where: { date: todayNZ },
  })

  if (!counter) {
    counter = await db.tempOrderCounter.create({
      data: {
        date: todayNZ,
        counter: 6000,
      },
    })
  } else {
    counter = await db.tempOrderCounter.update({
      where: { date: todayNZ },
      data: {
        counter: {
          increment: 1,
        },
      },
    })
  }

  const newOrder = await db.order.create({
    data: {
      tempOrderId: counter.counter.toString(),
      customerFirstName: orderData.customerFirstName ?? "",
      customerLastName: orderData.customerLastName ?? "",
      customerEmail: orderData.customerEmail,
      customerPhoneNumber: orderData.customerPhoneNumber,
      source: "WEBSITE",
      priceInCents: orderData.totalPriceInCents,
      GST: orderData.totalPriceInCents * 0.15, // GST in cents
      pickUpTime: orderData.pickUpTime,
      dineIn: false,
      status: "PENDING",
      paymentIntentId: paymentIntentId,
      desserts: {
        create: orderData.desserts.map((dessertItem) => ({
          dessert: {
            connect: {
              id: dessertItem.dessert.id, // Ensure dessert exists before connecting
            },
          },

          quantity: dessertItem.dessert.quantity,
          priceInCents: dessertItem.priceInCents, // get price from order item
          discountedAmountInCents: dessertItem.discountedAmountInCents,
          promoId: dessertItem.promoId,
          customisations: {
            create: dessertItem.customisations.map((customisationsItem) => ({
              customisation: {
                connect: {
                  id: customisationsItem.id, // Ensure customisation exists before connecting
                },
              },
              quantity: customisationsItem.quantity,
            })),
          },
        })),
      },
    },
    select: {
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
      desserts: {
        select: {
          orderId: true,
          id: true,
          quantity: true,
          priceInCents: true,
          discountedAmountInCents: true,
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
    },
  })

  await resend.emails.send({
    from: '"Eversweet" <eversweet@eversweet.co.nz>',
    to: orderData.customerEmail,
    subject: "Order Confirmation",
    react: EmailOrderConfirmation({ order: newOrder }),
  })
  if (
    newOrder.pickUpTime.getTime() - new Date().getTime() <= // if pick up now or <= than 15 mins from now then send order immediately else cron job checks for future orders
      1000 * 60 * 15 &&
    newOrder.notified === false
  ) {
    emitNewOrder(newOrder)
  }

  return newOrder.id
}

export const signUp = async (req: Request, res: Response) => {
  const { email, password, firstName, lastName, phoneNumber } = req.body
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
    await resend.emails.send({
      from: '"Eversweet" <eversweet@eversweet.co.nz>',
      to: email,
      subject: "Verify your email address",
      react: VerifyEmail({ otp }),
    })
    res
      .status(201)
      .json({ message: "User created", firstName: newUser.firstName ?? "" })
    return
  } catch (error) {
    res.status(500).json({ message: error })
    return
  }
}

export const signIn = async (req: Request, res: Response) => {
  const { email, password } = req.body
  if (!email || !password) {
    res.status(400).json("Email and password is required")
    return
  }
  const user = await db.user.findUnique({ where: { email } })
  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401).json("Invalid credentials")
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
}

export const checkVerificationCode = async (req: Request, res: Response) => {
  const { verificationCode, email } = req.body
  try {
    const user = await db.user.findUnique({
      where: { email },
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
      data: {
        emailVerified: new Date(),
      },
      select: { id: true },
    })

    res.status(200).json({
      message: "Verification code is valid.",
      token,
      name: user.firstName,
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

export const updateUser = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    const { email, firstName, lastName, phone } = req.body
    const user = await db.user.update({
      where: { id: userId },
      data: {
        email,
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
    const { orderId } = req.body
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
    if (!order) {
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

    const { status } = req.body
    if (!Object.values(Status).includes(status)) {
      res.status(400).json({ message: "Invalid status" })
      return
    }
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
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
    res.status(200).json({ orders: orders?.appOrders })
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
    res.status(200).json({ loyaltyPoints })
    return
  } catch (error) {
    res.status(500).json({ message: error })
    return
  }
}

export const createOrder = async (req: Request, res: Response) => {
  let newOrder
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }

    const parsedBody = CreateOrderSchema.parse({
      ...req.body,
      pickUpTime: new Date(req.body.pickUpTime),
    })

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

    const todayNZ = formatInTimeZone(
      new Date(),
      "Pacific/Auckland",
      "yyyy-MM-dd",
    )

    let counter = await db.tempOrderCounter.findUnique({
      where: { date: todayNZ },
    })

    if (!counter) {
      counter = await db.tempOrderCounter.create({
        data: {
          date: todayNZ,
          counter: 6000,
        },
      })
    } else {
      counter = await db.tempOrderCounter.update({
        where: { date: todayNZ },
        data: {
          counter: {
            increment: 1,
          },
        },
      })
    }

    const discountedAmountInCents = cart.cartItems.reduce((total, item) => {
      const customisationDiscountedAmount = item.customisations.reduce(
        (acc, c) =>
          acc + (c.quantity > 0 ? c.discountedAmountInCents * c.quantity : 0),
        0,
      )
      return (
        total +
        (item.discountedAmountInCents + customisationDiscountedAmount) *
          item.quantity
      )
    }, 0)

    const totalPriceInCentsBeforeDiscount = cart.cartItems.reduce(
      (acc, item) => {
        // find the total price by adding all the cart item price + customisation
        const totalCustomisationPriceInCents = item.customisations.reduce(
          (acc, c) =>
            acc +
            (c.quantity > 0 ? c.customisation.priceInCents * c.quantity : 0),
          0,
        )
        return (
          acc +
          (item.itemPriceInCents + totalCustomisationPriceInCents) *
            item.quantity
        )
      },
      0,
    )

    newOrder = await db.order.create({
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
        GST: cart.totalPriceInCents * 0.15, // GST in cents
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
      select: {
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
        desserts: {
          select: {
            orderId: true,
            id: true,
            quantity: true,
            priceInCents: true,
            discountedAmountInCents: true,
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
      },
    })

    // add points members and non members
    if (cart.totalPriceInCents > 0) {
      const membership = await db.membership.findUnique({ where: { userId } })
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

      await incrementLoyaltyPoints(userId, earnablePoints)

      // unlock membership offer if there is any
      if (membership && membership.isActive) {
        const lockedOffers = await db.offer.findMany({
          where: {
            AND: [
              {
                redemptions: {
                  none: {
                    membershipId: membership?.id,
                  },
                },
              },
              {
                requirements: {
                  some: {}, // ensures at least 1 requirement exists
                },
              },
            ],
          },
          include: {
            requirements: true,
          },
        })
        // count desserts and categories in the order for offer eligibility check
        const dessertCounts: Record<string, number> = {}
        const categoryCounts: Record<string, number> = {}
        for (const item of newOrder.desserts) {
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
        // unlock eligible offers for members
        for (const offer of eligibleOffers) {
          await db.offerRedemption.create({
            data: {
              offerId: offer.id,
              membershipId: membership?.id,
              unlockedAt: new Date(),
              status: "AVAILABLE",
            },
          })
        }
      }
    }

    // delete cart and send email and emit order

    await db.cart.delete({ where: { userId } })

    await resend.emails.send({
      from: '"Eversweet" <eversweet@eversweet.co.nz>',
      to: user.email,
      subject: "Order Confirmation",
      react: EmailOrderConfirmation({ order: newOrder }),
    })
    if (
      (newOrder.pickUpTime.getTime() - new Date().getTime() <= // if pick up now or <= than 15 mins from now then send order immediately else cron job checks for future orders
        1000 * 60 * 15 ||
        parsedBody.pickupNow) &&
      newOrder.notified === false
    ) {
      emitNewOrder(newOrder)
    }

    res.status(201).json({ order: newOrder })
    return
  } catch (error) {
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
      error: (error as Error).message,
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
    const membership = await db.membership.findUnique({ where: { userId } })
    if (!membership) {
      res.status(403).json({ message: "Not a member" })
      return
    }

    const offers = await db.offer.findMany({
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
          where: { membershipId: membership.id },
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

    res.status(200).json({ offers: serializedOffers })
    return
  } catch (error) {
    res.status(500).json({ message: error })
    return
  }
}
