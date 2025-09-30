import { Request, Response } from "express"
import { db } from "../lib/db"
import { Expo } from "expo-server-sdk"
import bcrypt from "bcrypt"
import jwt from "jsonwebtoken"
import {
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameDay,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
} from "date-fns"
import { emitNewOrder } from "../index"
import { OrderType, Status } from "../types/types"
const expo = new Expo()

export const adminSignIn = async (req: Request, res: Response) => {
  const { username, password } = req.body
  if (!username || !password) {
    res.status(400).json("Username and password is required")
    return
  }
  const user = await db.user.findUnique({ where: { username } })

  if (!user || !(await bcrypt.compare(password, user.password))) {
    res.status(401).json("Invalid credentials")
    return
  }

  if (user.role !== "ADMIN") {
    res.status(403).json("Unauthorised")
    return
  }

  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET!,
    {
      expiresIn: "60d",
    }
  )
  res.status(200).json({ token })
  return
}

export const getPendingOrders = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  const role = (req as any).role
  if (!userId && role !== "ADMIN") {
    res.status(403).json({ message: "You're unauthorised to access this!" })
    return
  }

  try {
    const now = new Date()
    const fiveFromNow = new Date(now.getTime() + 5 * 60 * 1000)
    const orders = await db.order.findMany({
      where: {
        status: "PENDING",
        pickUpTime: {
          lte: fiveFromNow,
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
        pickUpTime: true,
        GST: true,
        appUserId: true,
        desserts: {
          select: {
            id: true,
            quantity: true,
            dessert: {
              select: {
                id: true,
                name: true,
                chineseName: true,
                priceInCents: true,
                imagePath: true,
              },
            },
            customisations: {
              select: {
                id: true,
                quantity: true,
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
    res.status(200).json({ orders })
    return
  } catch (error) {
    res.status(500).json({
      message: "Error fetching current orders",
      error: (error as Error).message,
    })
    return
  }
}

export const getCurrentOrders = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  const role = (req as any).role
  if (!userId && role !== "ADMIN") {
    res.status(403).json({ message: "You're unauthorised to access this!" })
    return
  }

  try {
    const orders = await db.order.findMany({
      where: {
        status: {
          notIn: ["PICKED_UP", "PENDING"],
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
        pickUpTime: true,
        GST: true,
        appUserId: true,
        desserts: {
          select: {
            id: true,
            quantity: true,
            dessert: {
              select: {
                id: true,
                name: true,
                chineseName: true,
                priceInCents: true,
                imagePath: true,
              },
            },
            customisations: {
              select: {
                id: true,
                quantity: true,
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
    res.status(200).json({ orders })
    return
  } catch (error) {
    res.status(500).json({
      message: "Error fetching current orders",
      error: (error as Error).message,
    })
    return
  }
}

export const getPastOrders = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  const role = (req as any).role

  const { queryDate } = req.body
  if (!userId && role !== "ADMIN") {
    res.status(403).json({ message: "You're unauthorised to access this!" })
    return
  }

  let dateFilter = {}

  if (queryDate) {
    const startOfDay = new Date(new Date(queryDate).setHours(0, 0, 0, 0))
    const endOfDay = new Date(new Date(queryDate).setHours(23, 59, 59, 999))

    dateFilter = {
      gte: startOfDay,
      lte: endOfDay,
    }
  } else {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    dateFilter = {
      gte: thirtyDaysAgo,
    }
  }
  try {
    const orders = await db.order.findMany({
      where: {
        status: "PICKED_UP",
        pickedUpAt: dateFilter,
      },
      select: {
        id: true,
        tempOrderId: true,
        status: true,
        createdAt: true,
        pickedUpAt: true,
        pickUpTime: true,
        customerFirstName: true,
        customerLastName: true,
        customerEmail: true,
        customerPhoneNumber: true,
        priceInCents: true,
        GST: true,
        appUserId: true,
        desserts: {
          select: {
            id: true,
            quantity: true,
            dessert: {
              select: {
                id: true,
                name: true,
                chineseName: true,
                priceInCents: true,
                imagePath: true,
              },
            },
            customisations: {
              select: {
                id: true,
                quantity: true,
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
    res.status(200).json({ orders })
    return
  } catch (error) {
    res.status(500).json({
      message: "Error fetching past orders",
      error: (error as Error).message,
    })
    return
  }
}

export const updateOrderStatus = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  const role = (req as any).role
  const { orderId, newStatus, customerId } = req.body
  if (!userId && role !== "ADMIN") {
    res.status(403).json({ message: "You're unauthorised to access this!" })
    return
  }

  if (!orderId || !newStatus) {
    res.status(400).json({
      message: "orderId and newStatus are required",
    })
    return
  }

  if (!Object.values(Status).includes(newStatus)) {
    res.status(400).json({ message: "Invalid status" })
    return
  }
  try {
    const order = await db.order.update({
      where: { id: orderId },
      data: {
        status: newStatus,
        pickedUpAt: newStatus === "PICKED_UP" ? new Date() : null,
        completedAt: newStatus === "READY" ? new Date() : null,
      },
      select: {
        tempOrderId: true,
      },
    })

    // If there is a customerId i.e, it is an app order, send a push notification
    const tickets = []
    if (customerId && newStatus !== "PICKED_UP") {
      const token = await db.user.findUnique({
        where: {
          id: customerId,
        },
        select: {
          firstName: true,
          role: true,
          pushToken: true,
        },
      })

      const pushToken = token?.pushToken

      if (!pushToken) {
        res.status(200).json({ message: "User does not have a push token" })
        return
      }

      const orderNumber = order.tempOrderId

      // Create different messages based on the new status
      let title, body

      switch (newStatus) {
        case "ACCEPTED":
          title = "Your order has been accepted!"
          body = `Order #${orderNumber} has been accepted and is waiting to be made.`
          break
        case "READY":
          title = "Your order is ready!"
          body = `Order #${orderNumber} is ready for pickup.`
          break
        case "MAKING":
          title = "Your order is being prepared"
          body = `Order #${orderNumber} is now being prepared.`
          break
        default:
          title = "Order status update"
          body = `Order #${orderNumber} status has changed to ${newStatus}.`
      }

      // Create the notification
      const message = {
        to: pushToken,
        sound: "default",
        title,
        body,
        data: {
          type: "ORDER_STATUS_CHANGED",
          orderId,
          orderNumber,
          newStatus,
        },
      }

      // Send the notification
      const chunks = expo.chunkPushNotifications([message])
      for (const chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk)
          tickets.push(...ticketChunk)
        } catch (error) {
          console.error("Error sending push notification:", error)
        }
      }
    }

    res.status(200).json({ success: true, tickets })
    return
  } catch (error) {
    console.error("Error sending order status notification:", error)
    res.status(500).json({
      message: "Error sending order status notification",
      error: (error as Error).message,
    })
    return
  }
}

export const getOverview = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  const role = (req as any).role

  if (!userId && role !== "ADMIN") {
    res.status(403).json({ message: "You're unauthorised to access this!" })
    return
  }

  try {
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }) // Monday
    const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 }) // Sunday

    const monthStart = startOfMonth(new Date())
    const monthEnd = endOfMonth(new Date())

    const todayStart = startOfDay(new Date())
    const todayEnd = endOfDay(new Date())

    //Get orders for today
    const todaysOrders = await db.order.findMany({
      where: {
        createdAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
    })

    const today = todaysOrders.length

    // Get all orders from this week
    const thisWeeksOrders = await db.order.findMany({
      where: {
        createdAt: {
          gte: weekStart,
          lte: weekEnd,
        },
      },
    })

    const week = thisWeeksOrders.length

    //Get all orders for this month
    const thisMonthsOrders = await db.order.findMany({
      where: {
        createdAt: {
          gte: monthStart,
          lte: monthEnd,
        },
      },
    })

    const month = thisMonthsOrders.length

    const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    const overview = weekDays.map((label) => ({
      label,
      value: 0,
    }))

    // Count orders per day
    eachDayOfInterval({ start: weekStart, end: weekEnd }).forEach(
      (day, index) => {
        const ordersForDay = thisWeeksOrders.filter((order: OrderType) =>
          isSameDay(new Date(order.createdAt), day)
        )
        overview[index].value = ordersForDay.length
      }
    )

    const todaySales =
      todaysOrders.reduce(
        (total: number, order: OrderType) => total + order.priceInCents,
        0
      ) / 100

    res.status(200).json({ overview, today, week, month, todaySales })
    return
  } catch (error) {
    res.status(500).json({
      message: "Error fetching overview",
      error: (error as Error).message,
    })
    return
  }
}

// Get future orders where pickUpTime is more than 15 minutes from when the order was created
export const getFutureOrders = async () => {
  try {
    const now = new Date()

    const orders = await db.order.findMany({
      where: {
        status: "PENDING",
        notified: false,
        pickUpTime: {
          gt: now, // future orders
        },
      },
      select: {
        id: true,
        tempOrderId: true,
        status: true,
        createdAt: true,
        pickedUpAt: true,
        pickUpTime: true,
        customerFirstName: true,
        customerLastName: true,
        customerEmail: true,
        customerPhoneNumber: true,
        priceInCents: true,
        source: true,
        notified: true,
        GST: true,
        appUserId: true,
        desserts: {
          select: {
            id: true,
            quantity: true,
            dessert: {
              select: {
                id: true,
                name: true,
                chineseName: true,
                priceInCents: true,
                imagePath: true,
              },
            },
            customisations: {
              select: {
                id: true,
                quantity: true,
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

    //@ts-ignore
    const filteredOrders = orders.filter((order) => {
      const timeBetween = order.pickUpTime.getTime() - order.createdAt.getTime()
      if (
        timeBetween <= 15 * 60 * 1000 &&
        order.source === "APP" &&
        order.notified === true
      )
        return false
      // Calculate how early we should start preparing based on dessert count
      const count = order.desserts.reduce(
        (total, item) => total + item.quantity,
        0
      )
      let minutesBefore = 16 // default to item count >= 6, taking 15 minutes to prepare
      if (count < 3) minutesBefore = 6
      else if (count < 6) minutesBefore = 11

      const thresholdTime = new Date(
        order.pickUpTime.getTime() - minutesBefore * 60 * 1000
      )

      return thresholdTime <= new Date() // Ready to fetch
    })

    for (const order of filteredOrders) {
      emitNewOrder(order)
      await db.order.update({
        where: { id: order.id },
        data: { notified: true }, // ✅ persist notification state
      })
    }
  } catch (error) {
    console.error("Error fetching future orders:", error)
  }
}
