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
    latest_charge: { id: `ch_${id}`, amount_refunded: 0, created: longAgo },
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

/**
 * A website checkout's payment, as the website's `/api/checkout_sessions` creates it: tagged
 * `source: "website"`, with no user. `heldAt` is when the card was held, which for a website
 * payment can be long after the payment was created.
 */
const websiteHeld = (
  id: string,
  { heldAt = longAgo, ...extra }: Record<string, unknown> & { heldAt?: number } = {},
) =>
  held(id, "", {
    metadata: { source: "website", itemCount: "2" },
    latest_charge: { id: `ch_${id}`, amount_refunded: 0, created: heldAt },
    ...extra,
  })

const websiteTaken = (id: string, extra: Record<string, unknown> & { heldAt?: number } = {}) =>
  websiteHeld(id, {
    status: "succeeded",
    amount_capturable: 0,
    amount_received: 1200,
    ...extra,
  })

/** A moment ago: well inside the half hour a payment is given to become an order. */
const justNow = Math.floor((NOW - 60_000) / 1000)

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

const websiteOrderFor = (paymentIntentId: string) =>
  db.order.create({
    data: {
      tempOrderId: "6003",
      priceInCents: 1200,
      customerFirstName: "Grace",
      customerLastName: "Hopper",
      customerEmail: "grace@example.test",
      status: "PENDING",
      GST: 157,
      source: "WEBSITE",
      paymentIntentId,
    },
  })

/** The statuses a search query asks for. */
const statusIn = (query: string) => /status:'([a-z_]+)'/.exec(query)?.[1]

/** Whether a payment carries the metadata tag a search query asks for, as Stripe matches it. */
const taggedFor = (query: string, intent: Record<string, unknown>) => {
  const [, key, value] = /metadata\['(\w+)'\]:'([^']*)'/.exec(query) ?? []
  const metadata = intent.metadata as Record<string, string> | undefined
  return key !== undefined && metadata?.[key] === value
}

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
          .filter(
            (intent) => intent.status === statusIn(query) && taggedFor(query, intent),
          )
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

  /**
   * The website holds a card when its customer pays and captures it when its createNewOrder
   * writes the order, under this same lock and with the same keys - so an abandoned website
   * checkout leaves exactly what an abandoned app checkout does.
   */
  describe("website payments", () => {
    it("asks for website holds and taken payments as well as the app's", async () => {
      await sweepStrandedPayments(NOW)

      const cutoff = Math.floor((NOW - STRANDED_AFTER_MS) / 1000)
      const window = Math.floor((NOW - REFUND_WINDOW_MS) / 1000)
      expect(stripeApi.paymentIntents.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: `status:'requires_capture' AND metadata['source']:'website' AND created<${cutoff}`,
        }),
      )
      expect(stripeApi.paymentIntents.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: `status:'succeeded' AND metadata['source']:'website' AND created<${cutoff} AND created>${window}`,
        }),
      )
    })

    it("lets go of a website hold nobody placed an order for", async () => {
      websiteHeld("pi_web_abandoned")

      await sweepStrandedPayments(NOW)

      expect(stripeApi.paymentIntents.retrieve).toHaveBeenCalledWith("pi_web_abandoned", {
        expand: ["latest_charge"],
      })
      expect(stripeApi.paymentIntents.cancel).toHaveBeenCalledWith("pi_web_abandoned", {
        cancellation_reason: "abandoned",
      })
      expect(stripeApi.paymentIntents.cancel).toHaveBeenCalledTimes(1)
    })

    /**
     * The website creates its payment when the checkout's details are filled in, not when
     * Pay is pressed. A payment made long ago whose card was held a minute ago is a customer
     * whose order is about to be written, not an abandoned one.
     */
    it("leaves a website hold made a moment ago, however old its payment", async () => {
      websiteHeld("pi_web_paying", { heldAt: justNow })

      await sweepStrandedPayments(NOW)

      expect(stripeApi.paymentIntents.cancel).not.toHaveBeenCalled()
      expect(intents.get("pi_web_paying")?.status).toBe("requires_capture")
    })

    it("takes the money for a website hold whose order exists", async () => {
      websiteHeld("pi_web_ordered")
      await websiteOrderFor("pi_web_ordered")

      await sweepStrandedPayments(NOW)

      expect(stripeApi.paymentIntents.capture).toHaveBeenCalledWith(
        "pi_web_ordered",
        {},
        { idempotencyKey: "order-capture:pi_web_ordered" },
      )
      expect(stripeApi.paymentIntents.cancel).not.toHaveBeenCalled()
    })

    /**
     * No metadata: the website refunds its own mismatched payments with exactly these
     * parameters under this key, and Stripe refuses a reused key with different ones.
     */
    it("refunds a website payment taken without an order, with the website's own parameters", async () => {
      websiteTaken("pi_web_orphan")

      await sweepStrandedPayments(NOW)

      expect(stripeApi.refunds.create).toHaveBeenCalledTimes(1)
      expect(stripeApi.refunds.create).toHaveBeenCalledWith(
        { payment_intent: "pi_web_orphan" },
        { idempotencyKey: "order-refund:pi_web_orphan" },
      )
    })

    it("does not refund a website payment whose card was held a moment ago", async () => {
      websiteTaken("pi_web_retrying", { heldAt: justNow })

      await sweepStrandedPayments(NOW)

      expect(stripeApi.refunds.create).not.toHaveBeenCalled()
    })

    it("leaves a website payment that has its order", async () => {
      websiteTaken("pi_web_paid_for")
      await websiteOrderFor("pi_web_paid_for")

      await sweepStrandedPayments(NOW)

      expect(stripeApi.refunds.create).not.toHaveBeenCalled()
    })

    it("settles each payment once, not once per search", async () => {
      const user = await makeUser()
      held("pi_app_abandoned", user.id)
      websiteHeld("pi_web_abandoned")

      await sweepStrandedPayments(NOW)

      expect(stripeApi.paymentIntents.cancel).toHaveBeenCalledTimes(2)
      expect(intents.get("pi_app_abandoned")?.status).toBe("canceled")
      expect(intents.get("pi_web_abandoned")?.status).toBe("canceled")
    })
  })

  it("never throws, even when Stripe cannot be searched", async () => {
    stripeApi.paymentIntents.search.mockRejectedValue(new Error("Stripe is down"))

    await expect(sweepStrandedPayments(NOW)).resolves.toBeUndefined()
  })
})
