import { Expo } from "expo-server-sdk"
import { db } from "./db"
import { getErrorMessage } from "../utils/getError"

const expo = new Expo()

/**
 * Sends one push to one customer, from the server's own initiative.
 *
 * Every other push in this codebase answers a request the customer's own app
 * made — `sendNotification` pushes to `req.userId` and nothing else — so there
 * was no way to tell somebody something they had not asked about. Winning the
 * leaderboard is exactly that: it happens while the app is shut.
 *
 * This never throws. The rule is the same one written above the order
 * confirmation email: the write that made the news true has already committed,
 * so failing to deliver the news is a follow-up failure to log, never a reason
 * to fail the thing itself. A customer with notifications off, a stale token or
 * a flaky Expo just does not get the ping, and finds the prize in the app.
 */
export const sendPushToUser = async (
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown> = {},
): Promise<boolean> => {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { pushToken: true },
    })

    const pushToken = user?.pushToken
    if (!pushToken) return false

    // The handlers this is modelled on skip this check, which means a token
    // left over from a reinstall gets handed to Expo and comes back as an error
    // per send. Cheap to do, and it keeps the logs about real failures.
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Discarding an unusable push token for user ${userId}`)
      return false
    }

    const tickets = await expo.sendPushNotificationsAsync([
      { to: pushToken, sound: "default", title, body, data },
    ])

    // A ticket can come back as an error even when the request succeeded — most
    // often DeviceNotRegistered, meaning the customer uninstalled the app.
    const failed = tickets.filter((ticket) => ticket.status === "error")
    for (const ticket of failed) {
      console.error(`Push to ${userId} rejected:`, ticket.message)
    }

    return failed.length < tickets.length
  } catch (error) {
    console.error(`Failed to push to ${userId}:`, getErrorMessage(error))
    return false
  }
}
