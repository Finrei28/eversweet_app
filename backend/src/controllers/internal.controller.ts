import { Request, Response } from "express"

import { relayOrder } from "../lib/orderRelay"
import { getErrorMessage } from "../utils/getError"

/**
 * The website telling us an order it has taken payment for now exists.
 *
 * Takes only the id: the relay loads the order itself, so a stale or malformed
 * body cannot put an order on the kitchen screen that is not in the database.
 *
 * Idempotent. Announcing the same order twice delivers it once — the relay
 * skips an order already accepted and will not arm a second timer for one
 * already scheduled — so the caller is free to retry.
 */
export const announceOrder = async (req: Request, res: Response) => {
  const orderId = req.body?.orderId

  if (typeof orderId !== "string" || !orderId.trim()) {
    res.status(400).json({ message: "orderId is required" })
    return
  }

  try {
    const outcome = await relayOrder(orderId.trim())
    res.status(200).json(outcome)
    return
  } catch (error) {
    // The order is committed and paid for; only the announcement failed. Say
    // so plainly and let the caller log it — the cron announces the order on
    // its next pass regardless.
    console.error(
      `Failed to announce order ${orderId}:`,
      getErrorMessage(error),
    )
    res.status(500).json({ message: "Failed to announce order" })
    return
  }
}
