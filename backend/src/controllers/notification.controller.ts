import { Request, Response } from "express"
import { db } from "../lib/db"
import { Expo } from "expo-server-sdk"

const expo = new Expo()

/**
 * Tells customers about a new offer.
 *
 * A broadcast, unlike everything else in this file: the other two notifications go to one
 * customer about something they did. It is the one message the shop sends because it wants
 * to, which is why the privacy policy names it specifically and why the only way to stop it
 * is the phone's own notification settings.
 *
 * `isMembersOffer` narrows it to active members, for an offer nobody else could redeem. A
 * member here is `isActive` **and** paid up, the same test `getOffersForClient` builds its
 * viewer from - it used to be `isActive` alone, which pushed a members-only offer to someone
 * whose renewal had failed and who would be refused at the cart. It is deliberately coarser
 * than `lib/offerAudience` in the other direction: a NEW_USERS offer goes to everyone rather
 * than to customers with no orders, because "everyone who has never ordered" is a list this
 * shop should not be singling out.
 *
 * Staff are excluded. They are `User` rows like anyone else, and an EVERYONE offer used to
 * buzz every kitchen phone.
 *
 * Returns how many customers it reached, so a caller has something to log. Failures are
 * logged and swallowed - nobody is waiting on this, and a push that does not arrive must
 * never take an admin's save down with it.
 */
export const sendOfferNotifications = async (
  title: string,
  body: string,
  isMembersOffer: boolean,
): Promise<number> => {
  try {
    const users = await db.user.findMany({
      where: {
        role: { not: "ADMIN" },
        ...(isMembersOffer
          ? { membership: { isActive: true, paymentStatus: "SUCCESS" } }
          : {}),
      },
      select: { pushToken: true },
    })

    const validTokens = users
      .map((u) => u.pushToken)
      .filter((token) => Expo.isExpoPushToken(token))

    if (validTokens.length === 0) {
      console.log("No valid push tokens")
      return 0
    }

    const messages = validTokens.map((token) => ({
      to: token,
      sound: "default",
      title,
      body,
      // The app routes on `type` and ignores anything it does not recognise, so an empty
      // data object made this notification do nothing when tapped - which for a message
      // whose whole purpose is "come and look at this offer" is most of the point lost.
      data: { type: "NEW_OFFER" },
    }))

    // One chunk per request, each in its own try: a chunk Expo refuses must not stop the
    // rest of the customer base being told.
    const chunks = expo.chunkPushNotifications(messages)

    const tickets = []
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk)
        tickets.push(...ticketChunk)
      } catch (err) {
        console.error("Error sending push notifications", err)
      }
    }

    // A ticket can come back as an error even when the request succeeded - most often
    // DeviceNotRegistered, meaning the customer uninstalled the app. These were collected
    // and logged wholesale, so a broadcast to a thousand stale tokens looked like a
    // success. Counted the way `sendPushToUser` does.
    const failed = tickets.filter((ticket) => ticket.status === "error")
    if (failed.length > 0) {
      console.error(
        `${failed.length} of ${tickets.length} offer pushes were rejected:`,
        failed[0]?.message,
      )
    }

    return tickets.length - failed.length
  } catch (err) {
    console.error("Notification error:", err)
    return 0
  }
}

export const getPushToken = async (req: Request, res: Response) => {
  const userId = (req as any).userId
  if (!userId) {
    res.status(401).json({ message: "Unauthorised" })
    return
  }
  try {
    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user) {
      res.status(401).json({ message: "Please sign in or sign up to continue" })
      return
    }
    const pushToken = user.pushToken
    if (!pushToken) {
      res.status(400).json({ message: "No push token found" })
      return
    }
    if (!Expo.isExpoPushToken(pushToken)) {
      res.status(400).json({ message: "Invalid Expo push token" })
      return
    }
    res.status(200).json({ pushToken })
    return
  } catch (error) {
    console.error("Error getting push token:", error)
    res.status(500).json({
      message: "Error getting push token",
    })
    return
  }
}

export const pushToken = async (req: Request, res: Response) => {
  try {
    const { pushToken } = req.body ?? {}
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    if (!pushToken) {
      res.status(400).json({ message: "Push token is required" })
      return
    }

    // Validate that the push token is a valid Expo push token
    if (!Expo.isExpoPushToken(pushToken)) {
      res.status(400).json({ message: "Invalid Expo push token" })
      return
    }

    await db.user.update({
      where: { id: userId },
      data: {
        pushToken,
      },
      select: {
        pushToken: true,
      },
    })

    res.status(200).json({ success: true })
    return
  } catch (error) {
    console.error("Error saving push token:", error)
    res.status(500).json({
      message: "Error saving push token",
    })
    return
  }
}

export const removePushToken = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { pushToken: true },
    })

    if (!user) {
      res.status(401).json({ message: "Unauthenticated" })
      return
    }

    if (!user.pushToken) {
      res.status(200).json({ message: "not registered for push notification" })
      return
    }

    await db.user.update({
      where: { id: userId },
      data: {
        pushToken: null,
      },
      select: {
        pushToken: true,
      },
    })

    res.status(200).json({ success: true })
    return
  } catch (error) {
    console.error("Error removing push token:", error)
    res.status(500).json({
      message: "Error removing push token",
    })
    return
  }
}

export const sendNotification = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    const { title, body, data } = req.body ?? {}

    if (!userId || !title || !body) {
      res.status(400).json({ message: "userId, title, and body are required" })
      return
    }

    const token = await db.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        pushToken: true,
      },
    })

    const pushToken = token?.pushToken

    if (!pushToken) {
      res.status(404).json({ message: "User does not have a push token" })
      return
    }

    // Create the notification
    const message = {
      to: pushToken,
      sound: "default",
      title,
      body,
      data: data || {},
    }

    // Send the notification
    const chunks = expo.chunkPushNotifications([message])
    const tickets = []

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk)
        tickets.push(...ticketChunk)
      } catch (error) {
        console.error("Error sending push notification:", error)
      }
    }

    res.status(200).json({ success: true, tickets })
    return
  } catch (error) {
    console.error("Error sending notification:", error)
    res.status(500).json({
      message: "Error sending notification",
    })
    return
  }
}

// POST /api/notification/orderStatusChange - Send a notification when order status changes
export const orderStatusChange = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId
    if (!userId) {
      res.status(401).json({ message: "Unauthorised" })
      return
    }
    const { orderId, orderNumber, newStatus } = req.body ?? {}

    if (!orderId || !orderNumber || !newStatus) {
      res.status(400).json({
        message: "orderId, orderNumber, and newStatus are required",
      })
      return
    }

    // In a real app, you would get the user's push token from your database
    // Example: const user = await db.collection('users').findOne({ _id: userId })
    // const pushToken = user.pushToken

    // For this example, we'll assume you have the token
    const token = await db.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        pushToken: true,
      },
    }) // In a real app, get this from the database

    const pushToken = token?.pushToken

    if (!pushToken) {
      res.status(404).json({ message: "User does not have a push token" })
      return
    }

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
    const tickets = []

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk)
        tickets.push(...ticketChunk)
      } catch (error) {
        console.error("Error sending push notification:", error)
      }
    }
    res.status(200).json({ success: true, tickets })
    return
  } catch (error) {
    console.error("Error sending order status notification:", error)
    res.status(500).json({
      message: "Error sending order status notification",
    })
    return
  }
}
