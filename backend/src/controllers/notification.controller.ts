import { Request, Response } from "express"
import { db } from "../lib/db"
import { Expo } from "expo-server-sdk"

const expo = new Expo()

export const sendOfferNotifications = async (
  title: string,
  body: string,
  isMembersOffer: boolean
) => {
  try {
    // 1. Load all push tokens
    const users = await db.user.findMany({
      where: isMembersOffer
        ? { membership: { isActive: true } } // only members
        : {}, // everyone
      select: { pushToken: true },
    })

    // 2. Filter out null / invalid tokens
    const validTokens = users
      .map((u) => u.pushToken)
      .filter((token) => Expo.isExpoPushToken(token))

    if (validTokens.length === 0) {
      console.log("No valid push tokens")
      return
    }

    // 3. Build message array
    const messages = validTokens.map((token) => ({
      to: token,
      sound: "default",
      title,
      body,
      data: {}, // or add custom data
    }))

    // 4. Chunk messages
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

    console.log("Push tickets:", tickets)
  } catch (err) {
    console.error("Notification error:", err)
  }
}

export const pushToken = async (req: Request, res: Response) => {
  try {
    const { pushToken } = req.body
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
      error: (error as Error).message,
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
    const { title, body, data } = req.body

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
      error: (error as Error).message,
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
    const { orderId, orderNumber, newStatus } = req.body

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
      error: (error as Error).message,
    })
    return
  }
}
