import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { db } from "./db"
import { describeIfDb, resetDatabase } from "../test/db"
import { makeUser } from "../test/factories"
import { resetStripeStub, resourceMissing, stripeApi } from "../test/stripeStub"
import {
  REFUND_WINDOW_MS,
  STRANDED_AFTER_MS,
  sweepStrandedPayments,
} from "./strandedPayments"

// Never the real SDK: see test/stripeStub.
vi.mock("stripe", async (importOriginal) =>
  (await import("../test/stripeStub.js")).fakeStripeModule(await importOriginal()),
)

/** The payments Stripe knows about in this test, by id. */
const intents = new Map<string, Record<string, unknown>>()

const NOW = Date.UTC(2026, 8, 15, 3, 0, 0)
const longAgo = Math.floor((NOW - 2 * STRANDED_AFTER_MS) / 1000)

const held = (id: string, userId: string, extra: Record<string, unknown> = {}) => {
  const intent = {
    id,
    object: "payment_intent",
    status: "requires_capture",
    capture_method: "manual",
    amount: 1200,
    amount_capturable: 1200,
    amount_received: 0,
    currency: "nzd",
    created: longAgo,
    metadata: { purpose: "app_order", userId },
    latest_charge: { id: `ch_${id}`, amount_refunded: 0 },
    ...extra,
  }
  intents.set(id, intent)
  return intent
}

const taken = (id: string, userId: string, extra: Record<string, unknown> = {}) =>
  held(id, userId, {
    status: "succeeded",
    amount_capturable: 0,
    amount_received: 1200,
    ...extra,
  })

const orderFor = (paymentIntentId: string, appUserId: string) =>
  db.order.create({
    data: {
      tempOrderId: "6001",
      priceInCents: 1200,
      customerFirstName: "Ada",
      customerLastName: "Lovelace",
      customerEmail: "ada@example.test",
      status: "PENDING",
      GST: 157,
      source: "APP",
      appUserId,
      paymentIntentId,
    },
  })

/** The statuses a search query asks for. */
const statusIn = (query: string) => /status:'([a-z_]+)'/.exec(query)?.[1]

describeIfDb("sweepStrandedPayments", () => {
  beforeEach(async () => {
    await resetDatabase()
    resetStripeStub()
    intents.clear()

    const actual = await vi.importActual<typeof import("stripe")>("stripe")

    // Search answers from what Stripe held when it was asked, as a snapshot.
    stripeApi.paymentIntents.search.mockImplementation(
      async ({ query }: { query: string }) => ({
        data: [...intents.values()]
          .filter((intent) => intent.status === statusIn(query))
          .map((intent) => ({ ...intent })),
        has_more: false,
        next_page: null,
      }),
    )
    stripeApi.paymentIntents.retrieve.mockImplementation(async (id: string) => {
      const intent = intents.get(id)
      if (!intent) throw resourceMissing(actual)
      return intent
    })
    stripeApi.paymentIntents.capture.mockImplementation(async (id: string) =>
      Object.assign(intents.get(id)!, {
        status: "succeeded",
        amount_received: 1200,
        amount_capturable: 0,
      }),
    )
    stripeApi.paymentIntents.cancel.mockImplementation(async (id: string) =>
      Object.assign(intents.get(id)!, { status: "canceled", amount_capturable: 0 }),
    )
    stripeApi.refunds.create.mockResolvedValue({ id: "re_test" })

    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("holds", () => {
    /** Nothing else would let it go, and it would sit on the card as pending for days. */
    it("lets go of a hold nobody placed an order for", async () => {
      const user = await makeUser()
      held("pi_abandoned", user.id)

      await sweepStrandedPayments(NOW)

      expect(stripeApi.paymentIntents.cancel).toHaveBeenCalledWith("pi_abandoned", {
        cancellation_reason: "abandoned",
      })
      expect(stripeApi.paymentIntents.capture).not.toHaveBeenCalled()
    })

    it("takes the money for a hold whose order exists", async () => {
      const user = await makeUser()
      held("pi_ordered", user.id)
      await orderFor("pi_ordered", user.id)

      await sweepStrandedPayments(NOW)

      expect(stripeApi.paymentIntents.capture).toHaveBeenCalledWith(
        "pi_ordered",
        {},
        { idempotencyKey: "order-capture:pi_ordered" },
      )
      expect(stripeApi.paymentIntents.cancel).not.toHaveBeenCalled()
    })

    it("leaves a payment that has moved on since the search", async () => {
      const user = await makeUser()
      held("pi_moved", user.id)
      stripeApi.paymentIntents.search.mockResolvedValueOnce({
        data: [{ ...intents.get("pi_moved") }],
        has_more: false,
        next_page: null,
      })
      Object.assign(intents.get("pi_moved")!, { status: "succeeded" })

      await sweepStrandedPayments(NOW)

      expect(stripeApi.paymentIntents.cancel).not.toHaveBeenCalled()
      expect(stripeApi.paymentIntents.capture).not.toHaveBeenCalled()
    })

    it("only asks for app holds older than half an hour", async () => {
      await sweepStrandedPayments(NOW)

      const cutoff = Math.floor((NOW - STRANDED_AFTER_MS) / 1000)
      expect(stripeApi.paymentIntents.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: `status:'requires_capture' AND metadata['purpose']:'app_order' AND created<${cutoff}`,
        }),
      )
    })

    it("reads every page of results", async () => {
      const user = await makeUser()
      held("pi_page_one", user.id)
      held("pi_page_two", user.id)
      stripeApi.paymentIntents.search
        .mockResolvedValueOnce({
          data: [{ ...intents.get("pi_page_one") }],
          has_more: true,
          next_page: "page_2",
        })
        .mockResolvedValueOnce({
          data: [{ ...intents.get("pi_page_two") }],
          has_more: false,
          next_page: null,
        })

      await sweepStrandedPayments(NOW)

      expect(stripeApi.paymentIntents.search).toHaveBeenCalledWith(
        expect.objectContaining({ page: "page_2" }),
      )
      expect(stripeApi.paymentIntents.cancel).toHaveBeenCalledTimes(2)
    })

    /**
     * The same lock createOrder settles under. An order that commits while the sweep waits
     * must be paid for, not have its hold let go underneath it.
     */
    it("captures rather than releases a hold whose order commits while it waits", async () => {
      const user = await makeUser()
      held("pi_racing", user.id)

      let release!: () => void
      const released = new Promise<void>((resolve) => (release = resolve))
      let markLocked!: () => void
      const locked = new Promise<void>((resolve) => (markLocked = resolve))

      const placing = db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"pi_racing"}, 0))`
          markLocked()
          await released
          await tx.order.create({
            data: {
              tempOrderId: "6002",
              priceInCents: 1200,
              customerFirstName: "Ada",
              customerLastName: "Lovelace",
              customerEmail: "ada@example.test",
              status: "PENDING",
              GST: 157,
              source: "APP",
              appUserId: user.id,
              paymentIntentId: "pi_racing",
            },
          })
        },
        { timeout: 20_000 },
      )
      await locked

      const sweep = sweepStrandedPayments(NOW)
      await new Promise((resolve) => setTimeout(resolve, 750))
      expect(stripeApi.paymentIntents.cancel).not.toHaveBeenCalled()

      release()
      await placing
      await sweep

      expect(stripeApi.paymentIntents.cancel).not.toHaveBeenCalled()
      expect(stripeApi.paymentIntents.capture).toHaveBeenCalledTimes(1)
    })

    it("carries on past a hold it cannot let go", async () => {
      const user = await makeUser()
      held("pi_stuck", user.id, { created: longAgo - 60 })
      held("pi_fine", user.id)
      stripeApi.paymentIntents.cancel.mockImplementationOnce(async () => {
        throw new Error("Stripe is having a moment")
      })

      await expect(sweepStrandedPayments(NOW)).resolves.toBeUndefined()

      expect(stripeApi.paymentIntents.cancel).toHaveBeenCalledTimes(2)
      expect(intents.get("pi_fine")?.status).toBe("canceled")
    })
  })

  describe("payments taken without an order", () => {
    /**
     * Capture comes last before an order commits, and a commit that fails straight after
     * leaves the money taken and nothing to show for it.
     */
    it("refunds a payment that never became an order", async () => {
      const user = await makeUser()
      taken("pi_orphan", user.id)

      await sweepStrandedPayments(NOW)

      expect(stripeApi.refunds.create).toHaveBeenCalledTimes(1)
      expect(stripeApi.refunds.create).toHaveBeenCalledWith(
        { payment_intent: "pi_orphan", metadata: { userId: user.id } },
        { idempotencyKey: "order-refund:pi_orphan" },
      )
    })

    it("leaves a payment that has its order", async () => {
      const user = await makeUser()
      taken("pi_paid_for", user.id)
      await orderFor("pi_paid_for", user.id)

      await sweepStrandedPayments(NOW)

      expect(stripeApi.refunds.create).not.toHaveBeenCalled()
    })

    it("does not refund a payment that has already been refunded", async () => {
      const user = await makeUser()
      taken("pi_already", user.id, {
        latest_charge: { id: "ch_already", amount_refunded: 1200 },
      })

      await sweepStrandedPayments(NOW)

      expect(stripeApi.refunds.create).not.toHaveBeenCalled()
    })

    it("only asks for app payments between half an hour and two days old", async () => {
      await sweepStrandedPayments(NOW)

      const cutoff = Math.floor((NOW - STRANDED_AFTER_MS) / 1000)
      const window = Math.floor((NOW - REFUND_WINDOW_MS) / 1000)
      expect(stripeApi.paymentIntents.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: `status:'succeeded' AND metadata['purpose']:'app_order' AND created<${cutoff} AND created>${window}`,
        }),
      )
    })
  })

  it("never throws, even when Stripe cannot be searched", async () => {
    stripeApi.paymentIntents.search.mockRejectedValue(new Error("Stripe is down"))

    await expect(sweepStrandedPayments(NOW)).resolves.toBeUndefined()
  })
})
