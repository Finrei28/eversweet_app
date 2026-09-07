import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Hoisted so the `vi.mock` factories below, which are lifted above the
// imports, can close over the same spies the test bodies read.
const { findUnique, emitNewOrder, emitOrderReceived } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  emitNewOrder: vi.fn(),
  emitOrderReceived: vi.fn(),
}))

// The database is stubbed rather than run: the behaviour under test is the
// decision tree — deliver, schedule, defer or skip — not Prisma's ability to
// fetch a row by primary key.
vi.mock("./db", () => ({ db: { order: { findUnique } } }))
vi.mock("./socket", () => ({ emitNewOrder, emitOrderReceived }))

// Pinned to the defaults. The relay reads these on every call, and letting it
// fall through to the real module would have it reaching for a table the stub
// database above does not have.
vi.mock("./prepTimes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prepTimes")>()
  return {
    ...actual,
    getPrepTimes: vi.fn(async () => actual.DEFAULT_PREP_TIMES),
  }
})

import {
  MAX_SCHEDULE_AHEAD_MS,
  clearScheduledOrders,
  relayOrder,
  scheduledOrderIds,
} from "./orderRelay"

const NOW = new Date("2026-03-02T12:00:00+13:00")
const minutes = (n: number) => n * 60_000

/** Two items, so an 11 minute lead unless a case says otherwise. */
const makeOrder = (over: Record<string, unknown> = {}) => ({
  id: "order-1",
  tempOrderId: "6001",
  status: "PENDING",
  createdAt: NOW,
  pickedUpAt: null,
  pickUpTime: new Date(NOW.getTime() + minutes(11)),
  customerFirstName: "Ada",
  customerLastName: "Lovelace",
  customerEmail: "ada@example.test",
  customerPhoneNumber: "0211234567",
  priceInCents: 2400,
  discountedAmountInCents: 0,
  dineIn: false,
  notified: false,
  GST: 313,
  appUserId: null,
  desserts: [{ id: "line-1", orderId: "order-1", quantity: 2 }],
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  findUnique.mockReset()
  emitNewOrder.mockReset()
  emitOrderReceived.mockReset()
  clearScheduledOrders()
})

afterEach(() => {
  clearScheduledOrders()
  vi.useRealTimers()
})

describe("relayOrder", () => {
  it("delivers an order that is already due", async () => {
    findUnique.mockResolvedValue(makeOrder())

    await expect(relayOrder("order-1")).resolves.toEqual({
      status: "delivered",
    })
    expect(emitNewOrder).toHaveBeenCalledTimes(1)
  })

  // `notified` is the cron's bookkeeping. The kitchen screen has never been
  // sent it and should not start receiving it now.
  it("strips notified from what it emits", async () => {
    findUnique.mockResolvedValue(makeOrder())

    await relayOrder("order-1")

    const emitted = emitNewOrder.mock.calls[0]?.[0]
    expect(emitted).not.toHaveProperty("notified")
    expect(emitted).toMatchObject({ id: "order-1", tempOrderId: "6001" })
  })

  it("schedules an order that is not due yet, and emits when it comes due", async () => {
    const order = makeOrder({
      pickUpTime: new Date(NOW.getTime() + minutes(30)),
    })
    findUnique.mockResolvedValue(order)

    const outcome = await relayOrder("order-1")

    expect(outcome).toEqual({
      status: "scheduled",
      dueAt: new Date(NOW.getTime() + minutes(19)).toISOString(),
    })
    expect(emitNewOrder).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(minutes(19))

    expect(emitNewOrder).toHaveBeenCalledTimes(1)
    expect(scheduledOrderIds()).toEqual([])
  })

  it("leaves an order beyond the scheduling window to the cron", async () => {
    findUnique.mockResolvedValue(
      makeOrder({ pickUpTime: new Date(NOW.getTime() + minutes(24 * 60)) }),
    )

    const outcome = await relayOrder("order-1")

    expect(outcome).toMatchObject({ status: "deferred" })
    expect(scheduledOrderIds()).toEqual([])

    await vi.advanceTimersByTimeAsync(MAX_SCHEDULE_AHEAD_MS)
    expect(emitNewOrder).not.toHaveBeenCalled()
  })

  // The website retries a dropped request. Two announcements must not become
  // two alerts.
  it("arms only one timer however many times it is called", async () => {
    findUnique.mockResolvedValue(
      makeOrder({ pickUpTime: new Date(NOW.getTime() + minutes(30)) }),
    )

    await relayOrder("order-1")
    await relayOrder("order-1")
    await relayOrder("order-1")

    expect(scheduledOrderIds()).toEqual(["order-1"])

    await vi.advanceTimersByTimeAsync(minutes(19))
    expect(emitNewOrder).toHaveBeenCalledTimes(1)
  })

  // Accepted from the mobile app while the timer was pending: the row is
  // re-read on fire precisely so this does not reach the screen.
  it("does not emit an order accepted before its timer fires", async () => {
    findUnique.mockResolvedValueOnce(
      makeOrder({ pickUpTime: new Date(NOW.getTime() + minutes(30)) }),
    )

    await relayOrder("order-1")

    findUnique.mockResolvedValueOnce(
      makeOrder({
        pickUpTime: new Date(NOW.getTime() + minutes(30)),
        notified: true,
      }),
    )

    await vi.advanceTimersByTimeAsync(minutes(19))
    expect(emitNewOrder).not.toHaveBeenCalled()
  })

  it("cancels a pending timer once the order is delivered", async () => {
    findUnique.mockResolvedValueOnce(
      makeOrder({ pickUpTime: new Date(NOW.getTime() + minutes(30)) }),
    )
    await relayOrder("order-1")
    expect(scheduledOrderIds()).toEqual(["order-1"])

    findUnique.mockResolvedValueOnce(makeOrder())
    await relayOrder("order-1")

    expect(scheduledOrderIds()).toEqual([])
    expect(emitNewOrder).toHaveBeenCalledTimes(1)

    // The cancelled timer must not fire a second alert.
    await vi.advanceTimersByTimeAsync(minutes(30))
    expect(emitNewOrder).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["an order that does not exist", null, "not-found"],
    ["an order already accepted", { notified: true }, "already-notified"],
    ["an order no longer pending", { status: "ACCEPTED" }, "not-pending"],
    [
      "an unusable pick-up time",
      { pickUpTime: new Date("not a date") },
      "invalid-pick-up-time",
    ],
  ])("skips %s", async (_label, over, reason) => {
    findUnique.mockResolvedValue(over === null ? null : makeOrder(over))

    await expect(relayOrder("order-1")).resolves.toEqual({
      status: "skipped",
      reason,
    })
    expect(emitNewOrder).not.toHaveBeenCalled()
    // A skipped order does not belong on the Upcoming list either: it has been
    // accepted, cancelled, or never existed.
    expect(emitOrderReceived).not.toHaveBeenCalled()
  })

  // The caller turns this into a 500 and logs it; it must not be swallowed
  // into a false "delivered".
  it("propagates a database failure", async () => {
    findUnique.mockRejectedValue(new Error("connection terminated"))

    await expect(relayOrder("order-1")).rejects.toThrow(
      "connection terminated",
    )
  })
})

/**
 * The Upcoming list. Its whole point is that the shop can see an order before
 * the kitchen is told to start it, so these assertions are mostly about the
 * receipt firing where the alarm deliberately does not.
 */
describe("order receipt", () => {
  it("is emitted for an order that is due right now", async () => {
    findUnique.mockResolvedValue(makeOrder())

    await relayOrder("order-1")

    expect(emitOrderReceived).toHaveBeenCalledTimes(1)
    expect(emitNewOrder).toHaveBeenCalledTimes(1)
  })

  it("is emitted for a scheduled order, without the alarm", async () => {
    findUnique.mockResolvedValue(
      makeOrder({ pickUpTime: new Date(NOW.getTime() + minutes(30)) }),
    )

    await relayOrder("order-1")

    expect(emitOrderReceived).toHaveBeenCalledTimes(1)
    expect(emitNewOrder).not.toHaveBeenCalled()
  })

  // The case the Upcoming list exists for: an order placed days ahead is far
  // past anything the relay will hold a timer for, so before this the shop had
  // no way of knowing it existed until the sweep found it on the day.
  it("is emitted for an order days away, without the alarm", async () => {
    findUnique.mockResolvedValue(
      makeOrder({ pickUpTime: new Date(NOW.getTime() + minutes(3 * 24 * 60)) }),
    )

    const outcome = await relayOrder("order-1")

    expect(outcome).toMatchObject({ status: "deferred" })
    expect(emitOrderReceived).toHaveBeenCalledTimes(1)
    expect(emitNewOrder).not.toHaveBeenCalled()
  })

  it("carries when the kitchen should start, and no bookkeeping", async () => {
    findUnique.mockResolvedValue(
      makeOrder({ pickUpTime: new Date(NOW.getTime() + minutes(30)) }),
    )

    await relayOrder("order-1")

    const received = emitOrderReceived.mock.calls[0]?.[0]
    expect(received).toMatchObject({ id: "order-1", tempOrderId: "6001" })
    // Two items -> an 11 minute lead, so 30 - 11 = 19 minutes out.
    expect(received.dueAt).toBe(
      new Date(NOW.getTime() + minutes(19)).toISOString(),
    )
    expect(received).not.toHaveProperty("notified")
  })

  // The app keys the list by order id, so repeats are updates. Worth pinning:
  // the website retries, and the receipt is deliberately not de-duplicated the
  // way the timer is.
  it("is re-sent when an order is announced again", async () => {
    findUnique.mockResolvedValue(
      makeOrder({ pickUpTime: new Date(NOW.getTime() + minutes(30)) }),
    )

    await relayOrder("order-1")
    await relayOrder("order-1")

    expect(emitOrderReceived).toHaveBeenCalledTimes(2)
    expect(scheduledOrderIds()).toEqual(["order-1"])
    expect(emitNewOrder).not.toHaveBeenCalled()
  })
})
