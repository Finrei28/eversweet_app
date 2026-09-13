import { Request, Response } from "express"

import { relayOrder } from "../lib/orderRelay"
import { getErrorMessage } from "../utils/getError"
import { assignReward, settleCalendarMonth } from "./prize.controller"

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

/**
 * The website's `/admin/winners` assigning or editing a prize.
 *
 * The website used to write the reward row itself, with its own copy of the code
 * generator and no way to push, so a prize assigned there reached the customer only if
 * they happened to open the app. Routing it here means one minter, one set of guards and
 * one `PRIZE_READY` push, whichever screen staff used.
 *
 * `adminId` is taken from the body. The service secret is the trust boundary — the same
 * way `announceOrder` trusts the order id it is given — and the website has already
 * checked the admin's session before calling.
 */
export const assignRewardForService = async (req: Request, res: Response) => {
  const adminId =
    typeof req.body?.adminId === "string" && req.body.adminId
      ? req.body.adminId
      : null

  try {
    const { status, body } = await assignReward({
      winnerId: req.body?.winnerId,
      title: req.body?.title,
      description: req.body?.description,
      expiresAt: req.body?.expiresAt,
      adminId,
    })
    res.status(status).json(body)
    return
  } catch (error) {
    console.error("Failed to assign a reward for the website:", getErrorMessage(error))
    res.status(500).json({ message: "Failed to assign the reward" })
    return
  }
}

/** The website's "settle a missed month" button. See `settleCalendarMonth`. */
export const settleMonthForService = async (req: Request, res: Response) => {
  try {
    const { status, body } = await settleCalendarMonth(
      req.body?.month,
      req.body?.year,
    )
    res.status(status).json(body)
    return
  } catch (error) {
    console.error("Failed to settle a month for the website:", getErrorMessage(error))
    res.status(500).json({ message: "Failed to settle that month" })
    return
  }
}
