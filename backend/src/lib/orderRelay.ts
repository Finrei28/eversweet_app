import { Prisma } from "@prisma/client"
import { db } from "./db"
import { emitNewOrder, emitOrderReceived } from "./socket"
import { dueAt } from "./orderTiming"
import { getPrepTimes } from "./prepTimes"
import { getErrorMessage } from "../utils/getError"

/**
 * Exactly the shape the kitchen screen has always received for a website
 * order. Shared with `getFutureOrders` rather than copied: both now announce
 * the same orders, and a field present on one path and missing on the other
 * shows up as a card that renders differently depending on which one happened
 * to get there first.
 */
export const relayOrderSelect = {
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
  notified: true,
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
} satisfies Prisma.OrderSelect

export type RelayableOrder = Prisma.OrderGetPayload<{
  select: typeof relayOrderSelect
}>

/**
 * How far ahead the relay will hold an order in memory.
 *
 * These timers live in this process and are lost on every deploy and restart,
 * so they are only trusted with the near future. Anything further out is left
 * to the cron, which reads the database and so survives a restart.
 */
export const MAX_SCHEDULE_AHEAD_MS = 60 * 60 * 1000

export type RelayOutcome =
  /** Sent to the kitchen screen now. */
  | { status: "delivered" }
  /** Held in this process; will be sent when preparation is due to start. */
  | { status: "scheduled"; dueAt: string }
  /** Too far out to hold in memory. The cron will pick it up. */
  | { status: "deferred"; dueAt: string }
  /** Nothing to announce, and nothing wrong. */
  | {
      status: "skipped"
      reason:
        | "not-found"
        | "already-notified"
        | "not-pending"
        | "invalid-pick-up-time"
    }

/**
 * Pending timers, keyed by order id.
 *
 * The map is what makes a repeated announcement harmless: the website retries
 * a dropped request, and without this each attempt would arm another timer and
 * the kitchen would get one alert per retry.
 */
const scheduled = new Map<string, NodeJS.Timeout>()

/**
 * `notified` is the cron's bookkeeping, not part of the order, and the kitchen
 * screen has never been sent it.
 */
const forKitchen = (order: RelayableOrder) => {
  const { notified, ...rest } = order
  return rest
}

const emitAlarm = (order: RelayableOrder) => {
  emitNewOrder(forKitchen(order))
}

const emitReceipt = (order: RelayableOrder, due: Date | null) => {
  emitOrderReceived({ ...forKitchen(order), dueAt: due?.toISOString() ?? null })
}

/**
 * Announce an order to the kitchen screen, now or when it comes due.
 *
 * Reads the order from the database rather than taking it from the caller. The
 * website is trusted, but an order that exists only in a request body is one
 * the kitchen can accept and the shop can never reconcile — and loading it
 * here is what guarantees every path emits the same shape.
 */
export const relayOrder = async (
  orderId: string,
  now: Date = new Date(),
): Promise<RelayOutcome> => {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: relayOrderSelect,
  })

  if (!order) return { status: "skipped", reason: "not-found" }

  // Set when the kitchen accepts an order. Re-announcing one already taken
  // puts a duplicate alert in front of staff mid-service.
  if (order.notified) return { status: "skipped", reason: "already-notified" }

  if (order.status !== "PENDING") {
    return { status: "skipped", reason: "not-pending" }
  }

  const due = dueAt(order, await getPrepTimes())

  if (!due) return { status: "skipped", reason: "invalid-pick-up-time" }

  // Unconditional, and before any decision about the alarm. This is what puts
  // the order in the Upcoming list, and the shop should be able to see an
  // order the moment it is paid for however far out it is — being blind until
  // the alarm is the thing this event exists to fix. The app keys the list by
  // order id, so a repeat is an update rather than a duplicate.
  emitReceipt(order, due)

  const waitMs = due.getTime() - now.getTime()

  if (waitMs <= 0) {
    // A timer armed by an earlier attempt is now redundant.
    cancelScheduledOrder(orderId)
    emitAlarm(order)
    return { status: "delivered" }
  }

  if (waitMs > MAX_SCHEDULE_AHEAD_MS) {
    return { status: "deferred", dueAt: due.toISOString() }
  }

  scheduleOrder(orderId, waitMs)
  return { status: "scheduled", dueAt: due.toISOString() }
}

const scheduleOrder = (orderId: string, waitMs: number) => {
  if (scheduled.has(orderId)) return

  const timer = setTimeout(() => {
    scheduled.delete(orderId)

    // Re-read rather than emitting the row loaded when the timer was armed: in
    // the meantime the order may have been accepted from the mobile app,
    // announced by the cron, or had its pick-up time moved.
    relayOrder(orderId).catch((error) => {
      console.error(
        `Failed to announce scheduled order ${orderId}:`,
        getErrorMessage(error),
      )
    })
  }, waitMs)

  // Nothing should keep the process alive waiting to ring a kitchen bell — and
  // a test run has to be able to finish.
  timer.unref?.()

  scheduled.set(orderId, timer)
}

export const cancelScheduledOrder = (orderId: string) => {
  const timer = scheduled.get(orderId)
  if (!timer) return
  clearTimeout(timer)
  scheduled.delete(orderId)
}

/** Shutdown, and the seam tests use to start from a clean slate. */
export const clearScheduledOrders = () => {
  for (const timer of scheduled.values()) clearTimeout(timer)
  scheduled.clear()
}

export const scheduledOrderIds = () => [...scheduled.keys()]
