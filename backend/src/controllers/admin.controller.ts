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
import { emitNewOrder } from "../lib/socket"
import { relayOrderSelect } from "../lib/orderRelay"
import { dueAt, isDue } from "../lib/orderTiming"
import { getPrepTimes, invalidatePrepTimes } from "../lib/prepTimes"
import { NZ_TIMEZONE } from "../lib/tradingHours"
import { OrderType, Status } from "../types/types"
import { Prisma } from "@prisma/client"
import { DateTime } from "luxon"
import { es } from "date-fns/locale"
import { getErrorMessage } from "../utils/getError"
import { invalidate, CACHE_KEYS } from "../lib/cache"
const expo = new Expo()

export const adminSignIn = async (req: Request, res: Response) => {
  const { username, password } = req.body ?? {}
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
      expiresIn: "180d",
    },
  )
  res.status(200).json({ token })
  return
}

/**
 * Everything the shop knows about but has not started yet — the Upcoming list.
 *
 * Deliberately server-backed rather than left to the socket. A list built only
 * from live events is a cache: it misses orders placed before the app launched,
 * misses orders placed yesterday for today, and empties on every restart.
 * Fetching it is what lets the app rebuild after a force-quit.
 *
 * Bounded to today. This used to return every unaccepted order ever placed, so
 * a booking for next week turned up in today's list.
 */
export const getPendingOrders = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  const role = (req as any).role
  if (!userId && role !== "ADMIN") {
    res.status(403).json({ message: "You're unauthorised to access this!" })
    return
  }

  try {
    // No lower bound: an order that came due earlier and was never accepted has
    // to stay on the list rather than disappear at midnight.
    const endOfTodayNZ = DateTime.now()
      .setZone(NZ_TIMEZONE)
      .endOf("day")
      .toJSDate()

    const [orders, prepTimes] = await Promise.all([
      db.order.findMany({
        where: {
          status: "PENDING",
          notified: false,
          pickUpTime: { lte: endOfTodayNZ },
        },
        select: relayOrderSelect,
        orderBy: { pickUpTime: "asc" },
      }),
      getPrepTimes(),
    ])

    res.status(200).json({
      orders: orders.map(({ notified, ...order }) => ({
        ...order,
        // Sent rather than recomputed in the app, so when the kitchen starts is
        // decided in exactly one place.
        dueAt: dueAt(order, prepTimes)?.toISOString() ?? null,
      })),
    })
    return
  } catch (error) {
    res.status(500).json({
      message: "Error fetching pending orders",
      error: getErrorMessage(error),
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
        notified: true,
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
        discountedAmountInCents: true,
        dineIn: true,
        GST: true,
        appUserId: true,
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
    res.status(200).json({ orders })
    return
  } catch (error) {
    res.status(500).json({
      message: "Error fetching current orders",
      error: getErrorMessage(error),
    })
    return
  }
}

export const getPastOrders = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  const role = (req as any).role

  const { queryDate } = req.body ?? {}
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
        discountedAmountInCents: true,
        dineIn: true,
        GST: true,
        appUserId: true,
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
    res.status(200).json({ orders })
    return
  } catch (error) {
    res.status(500).json({
      message: "Error fetching past orders",
      error: getErrorMessage(error),
    })
    return
  }
}

export const updateOrderStatus = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  const role = (req as any).role
  const { orderId, newStatus, customerId } = req.body ?? {}
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
        notified: true,
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
      error: getErrorMessage(error),
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
          isSameDay(new Date(order.createdAt), day),
        )
        overview[index].value = ordersForDay.length
      },
    )

    const todaySales =
      todaysOrders.reduce(
        (total: number, order: OrderType) => total + order.priceInCents,
        0,
      ) / 100

    res.status(200).json({ overview, today, week, month, todaySales })
    return
  } catch (error) {
    res.status(500).json({
      message: "Error fetching overview",
      error: getErrorMessage(error),
    })
    return
  }
}

export const updateRestaurantStatus = async (req: Request, res: Response) => {
  const { dineInAvailability, date } = req.body ?? {}

  if (typeof dineInAvailability !== "boolean" && !date) {
    res
      .status(400)
      .json({ message: "dineInAvailability or date is required" })
    return
  }

  try {
    const data: Prisma.RestaurantStatusUpdateManyMutationInput = {
      dineInAvailability,
    }
    if (date) {
      data.dineInAvailability = false
      data.unavailableUntil = new Date(date)
    }
    if (dineInAvailability === true) {
      data.unavailableUntil = null
    }

    await db.restaurantStatus.updateMany({
      data,
    })
    await invalidate(CACHE_KEYS.restaurantStatus)
    res.status(200).json({ message: "Restaurant status updated successfully" })
    return
  } catch (error) {
    res.status(500).json({
      message: "Error changing restaurant status",
      error: getErrorMessage(error),
    })
    return
  }
}

export const updateDaysOff = async (req: Request, res: Response) => {
  const { newDates }: { newDates?: Date[] } = req.body ?? {}

  if (!Array.isArray(newDates)) {
    res.status(400).json({ message: "newDates is required" })
    return
  }

  const dates = newDates.map((date) => new Date(date))
  try {
    const toDateKey = (date: Date) => date.toISOString().split("T")[0]
    const existingDates = await db.daysOff.findMany({
      select: {
        id: true,
        date: true,
      },
    })

    const existingKeys = new Set(existingDates.map((d) => toDateKey(d.date)))

    const selectedKeys = new Set(dates.map((date) => toDateKey(date)))

    // Dates to add
    const datesToAdd = dates.filter(
      (date) => !existingKeys.has(toDateKey(date)),
    )

    // Records to delete
    const daysOffToDelete = existingDates.filter(
      (dayOff) => !selectedKeys.has(toDateKey(dayOff.date)),
    )

    await db.$transaction([
      ...(datesToAdd.length
        ? [
            db.daysOff.createMany({
              data: datesToAdd.map((date: Date) => ({ date })),
              skipDuplicates: true,
            }),
          ]
        : []),

      ...(daysOffToDelete.length
        ? [
            db.daysOff.deleteMany({
              where: {
                id: {
                  in: daysOffToDelete.map((d) => d.id),
                },
              },
            }),
          ]
        : []),
    ])
    // The public /api/getDaysOff answer is now wrong; drop it rather than
    // leaving customers on a stale trading calendar until the TTL lapses.
    await invalidate(CACHE_KEYS.daysOff)

    const newDates = await db.daysOff.findMany({ select: { date: true } })
    const destructuredDates = newDates.map((day) => day.date)
    res.status(200).json({ newDates: destructuredDates })
    return
  } catch (error) {
    console.error("Error adding days off:", error)
    res.status(500).json({
      message: `Failed to add days off: ${getErrorMessage(error, "Unknown error")}`,
    })
  }
}

export const checkRestaurantStatus = async () => {
  await db.restaurantStatus.updateMany({
    where: {
      unavailableUntil: { lte: new Date() },
    },
    data: {
      unavailableUntil: null,
      dineInAvailability: true,
    },
  })
  await invalidate(CACHE_KEYS.restaurantStatus)
}

/**
 * The backstop that puts due orders on the kitchen screen.
 *
 * Runs on a cron. It used to be the only way a website order was ever
 * announced; orders are now announced the moment they are paid for, over
 * `/api/internal/orders/announce`. This still matters because that path and
 * the relay's in-memory timers do not survive a restart, and because orders
 * scheduled further out than the relay will hold are only ever found here.
 *
 * Emits every pass until the order is accepted, which is what sets `notified`.
 */
export const getFutureOrders = async () => {
  try {
    const now = new Date()
    // Once per pass, not once per order.
    const prepTimes = await getPrepTimes()

    const orders = await db.order.findMany({
      where: {
        status: "PENDING",
        notified: false,
      },
      select: relayOrderSelect,
    })

    for (const order of orders) {
      if (!isDue(order, now, prepTimes)) continue

      // `notified` is set when the order is accepted, in updateOrderStatus().
      const { notified, ...orderWithoutNotified } = order
      emitNewOrder(orderWithoutNotified)
    }
  } catch (error) {
    console.error("Error fetching future orders:", error)
  }
}

export const getPrepTimeSettings = async (_req: Request, res: Response) => {
  try {
    res.status(200).json({ prepTimes: await getPrepTimes() })
    return
  } catch (error) {
    res.status(500).json({
      message: "Failed to load preparation times",
      error: getErrorMessage(error),
    })
    return
  }
}

/** Minutes. Upper bounds are a guard against a typo closing the shop's book. */
const PREP_TIME_LIMITS: Record<string, { min: number; max: number }> = {
  singleItem: { min: 1, max: 120 },
  upToThree: { min: 1, max: 120 },
  upToSix: { min: 1, max: 120 },
  moreThanSix: { min: 1, max: 240 },
  kitchenSlack: { min: 0, max: 60 },
  quoteFloor: { min: 1, max: 240 },
}

export const updatePrepTimeSettings = async (req: Request, res: Response) => {
  const body = req.body ?? {}
  const data: Record<string, number> = {}

  for (const [field, { min, max }] of Object.entries(PREP_TIME_LIMITS)) {
    const value = body[field]

    // Absent means "leave it alone", so a screen can send only what changed.
    if (value === undefined) continue

    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < min ||
      value > max
    ) {
      res.status(400).json({
        message: `${field} must be a whole number of minutes between ${min} and ${max}`,
      })
      return
    }

    data[field] = value
  }

  if (Object.keys(data).length === 0) {
    res.status(400).json({ message: "No preparation times to update" })
    return
  }

  try {
    // One row, addressed the way `checkRestaurantStatus` addresses its own
    // singleton. `updateMany` matches nothing if the table has not been
    // seeded, so fall back to creating it rather than silently doing nothing.
    const { count } = await db.prepTimeSetting.updateMany({ data })

    if (count === 0) {
      await db.prepTimeSetting.create({ data })
    }

    invalidatePrepTimes()

    res.status(200).json({ prepTimes: await getPrepTimes() })
    return
  } catch (error) {
    res.status(500).json({
      message: "Failed to update preparation times",
      error: getErrorMessage(error),
    })
    return
  }
}

/**
 * Monday morning: hand back the offers that renew every week.
 *
 * This was `updateMany({ data: { used: 0 } })` with no `where` at all, so it reset the
 * usage counter on every OfferRedemption row in the database rather than the weekly
 * mochi perk it is named after. Harmless only while `status` was written REDEEMED on
 * every use and the gate read `status`; now that REDEEMED means "used up to the limit",
 * an unscoped reset would hand back every requirement-gated offer once a week - which is
 * the thing the admin's Close run deletes redemption rows to prevent.
 *
 * `status` moves with `used`. OfferRedemption.status has no @default, so an updateMany
 * that zeroes the counter and leaves the row REDEEMED is exactly what showed a member a
 * greyed, inert Redeem button every Monday.
 */
export const renewWeeklyOffers = async () => {
  try {
    await db.offerRedemption.updateMany({
      where: { offer: { renewsWeekly: true, archivedAt: null } },
      data: {
        used: 0,
        status: "AVAILABLE",
      },
    })
  } catch (error) {
    throw new Error(`Failed to renew weekly offers: ${getErrorMessage(error)}`)
  }
}

export const updateDailySpecial = async () => {
  try {
    const id = "2026"
    const existingPromo = await db.promo.findUnique({
      where: { id },
    })
    if (existingPromo) {
      await db.promo.delete({
        where: { id },
      })
    }
    const nzDate = new Date(
      new Date().toLocaleString("en-NZ", {
        timeZone: "Pacific/Auckland",
      }),
    )

    const currentDay = nzDate.getDay()
    const todaysSpecialDessert = (() => {
      switch (currentDay) {
        case 0:
          return "cm91cydht002yaijdqyk4vlne"
        case 1:
          return "cm95ldibs0008fvj0xwyqc8wn"
        case 2:
          return "cm91cztpc002zaijdftaxxtyh"
        case 3:
          return "cm91d0qrx0030aijd73z48s50"
        case 4:
          return "cm95lelj80009fvj0nhq7fvg6"
        case 5:
          return "cm91cuuk0002xaijd7wv313nz"
        case 6:
          return "cm91co2xv002waijdlfb067ei"
        default:
          return "cm91co2xv002waijdlfb067ei"
      }
    })()
    await db.promo.create({
      data: {
        id,
        name: "Daily Special: 20% off on selected items",
        type: "PERCENTAGE",
        value: 20,
        startsAt: new Date(),
        endsAt: new Date(new Date().getTime() + 24 * 60 * 60 * 1000), // Ends in 24 hours
        desserts: {
          connect: [{ id: todaysSpecialDessert }],
        },
      },
    })

    // The menu payload embeds each dessert's promo, so today's special is
    // baked into the cached copy. Without this the new discount would not
    // reach customers until the menu's TTL lapsed.
    await invalidate(CACHE_KEYS.menu)
  } catch (error) {
    throw new Error(
      `Failed to update daily special: ${getErrorMessage(error)}`,
    )
  }
}
