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
import { Status } from "../types/types"

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

  if (!existing) throw new Error("User loyalty record not found")

  const updated = await db.loyalty.update({
    where: { userId },
    data: { points: existing.points + numericPoints },
  })

  return updated.points
}

export const signUp = async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body
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
  const existUser = await db.user.findFirst({
    where: { email },
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
        email,
        password: hashed,
        firstName:
          firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase(),
        lastName:
          lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase(),
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
      expiresIn: "60d",
    }
  )
  res.status(200).json({ token, name: user.firstName ?? "" })
  return
}

export const checkVerificationCode = async (req: Request, res: Response) => {
  const { verificationCode, email } = req.body
  try {
    const user = await db.user.findUnique({
      where: { email },
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
        expiresIn: "60d",
      }
    )

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
                      select: { id: true, name: true, chineseName: true },
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

export const addLoyaltyPoints = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    const { points } = req.body
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    if (!points) {
      res.status(400).json({ message: "No points to be added" })
      return
    }
    const numericPoints = Number(points)
    if (!numericPoints || isNaN(numericPoints)) {
      res.status(400).json({ message: "Invalid or missing points" })
      return
    }

    const existingpoints = await db.loyalty.findUnique({
      where: { userId },
      select: {
        points: true,
      },
    })
    if (!existingpoints) {
      res.status(404).json({ message: "User loyalty record not found" })
      return
    }
    const data = await db.loyalty.update({
      where: { userId },
      data: {
        points: existingpoints.points + numericPoints,
      },
    })
    res.status(201).json({ loyaltyPoints: data.points })
    return
  } catch (error) {
    res.status(500).json({ message: error })
    return
  }
}

export const orderWithLoyaltyPoints = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId

    const { points } = req.body

    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }

    const numericCost = Number(points)
    if (!numericCost || isNaN(numericCost)) {
      res.status(400).json({ message: "Invalid or missing point cost" })
      return
    }

    const existingpoints = await db.loyalty.findUnique({
      where: { userId },
      select: {
        points: true,
      },
    })

    if (!existingpoints) {
      res.status(404).json({ message: "User loyalty record not found" })
      return
    }

    const currentPoints = existingpoints.points

    if (currentPoints < numericCost) {
      res.status(400).json({ message: "Insufficient points" })
      return
    }

    const updatedPointed = await db.loyalty.update({
      where: { userId },
      data: {
        points: currentPoints - numericCost,
      },
      select: {
        points: true,
      },
    })
    res.status(201).json({ loyaltyPoints: updatedPointed.points })
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

    const today = new Date()
    today.setHours(0, 0, 0, 0) // Normalize to midnight

    let counter = await db.tempOrderCounter.findUnique({
      where: { date: today },
    })

    if (!counter) {
      counter = await db.tempOrderCounter.create({
        data: {
          date: today,
          counter: 6000,
        },
      })
    } else {
      counter = await db.tempOrderCounter.update({
        where: { date: today },
        data: { counter: counter.counter + 1 },
      })
    }

    const discountedAmountInCents = cart.cartItems.reduce(
      (total, item) => total + item.discountedAmountInCents,
      0
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
        priceInCents: cart.totalPriceInCents,
        discountedAmountInCents: discountedAmountInCents,
        GST: cart.totalPriceInCents * 0.15 * 100, // GST in cents
        pickUpTime: parsedBody.pickUpTime,
        dineIn: parsedBody.dineIn,
        status: "PENDING",
        paymentIntentId: parsedBody.paymentIntentId,
        paymentMethodId: parsedBody.paymentMethodId,
        desserts: {
          create: cart.cartItems.map((dessertItem) => ({
            dessert: {
              connect: {
                id: dessertItem.dessertId, // Ensure dessert exists before connecting
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
        appUserId: true,
        desserts: {
          select: {
            orderId: true,
            id: true,
            quantity: true,
            dessertId: true,
            priceInCents: true,
            discountedAmountInCents: true,
            dessert: {
              select: {
                id: true,
                name: true,
                chineseName: true,
                imagePath: true,
              },
            },
            customisations: {
              select: {
                id: true,
                quantity: true,
                customisationId: true,
                customisation: {
                  select: {
                    id: true,
                    name: true,
                    chineseName: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    const membership = await db.membership.findUnique({ where: { userId } })

    // add points members and non members
    if (cart.totalPriceInCents > 0) {
      let earnablePoints = 0
      if (membership?.isActive) {
        earnablePoints = cart.cartItems.reduce(
          (acc, item) =>
            acc +
            Math.floor((item.itemPriceInCents / 10) * item.quantity * 2.2),
          0
        )
      } else {
        earnablePoints = cart.cartItems.reduce(
          (acc, item) =>
            acc +
            Math.floor((item.itemPriceInCents / 10) * item.quantity * 1.1),
          0
        )
      }
      await incrementLoyaltyPoints(userId, earnablePoints)
    }

    await db.cart.delete({ where: { userId } })

    await resend.emails.send({
      from: '"Eversweet" <eversweet@eversweet.co.nz>',
      to: user.email,
      subject: "Order Confirmation",
      react: EmailOrderConfirmation({ order: newOrder }),
    })
    if (
      newOrder.pickUpTime.getTime() - new Date().getTime() <=
      1000 * 60 * 15
    ) {
      emitNewOrder(newOrder)
      await db.order.update({
        where: { id: newOrder.id },
        data: { notified: true }, // ✅ persist notification state
      })
    }

    res.status(201).json({ order: newOrder })
    return
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        message: "Invalid data",
        errors: error.errors, // This will give the validation errors
      })
      return
    }
    if (newOrder?.id) {
      res.status(500).json({
        message: "Order was created, but a follow-up action failed.",
        orderId: newOrder.id,
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
