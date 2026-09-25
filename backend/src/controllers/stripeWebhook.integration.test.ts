import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase } from "../test/db"
import { makeUser } from "../test/factories"
import {
  resetStripeStub,
  resourceMissing,
  stripeApi,
} from "../test/stripeStub"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

// Never the real SDK: see test/stripeStub. Signature checking is still the real one.
vi.mock("stripe", async (importOriginal) =>
  (await import("../test/stripeStub.js")).fakeStripeModule(await importOriginal()),
)

// A payment that switches a membership on sends the welcome email, which must never reach
// Resend from a test. What it says is tested in membershipCart.integration.test.ts.
vi.mock("../lib/emailSender", () => ({
  default: vi.fn(async () => ({ data: { id: "email_test" }, error: null })),
}))

const WEBHOOK_SECRET = "whsec_integration_test"
const SUBSCRIPTION = "sub_membership"
/** The end of the period the latest payment bought, as Stripe reports it. */
const PERIOD_END = Math.floor(Date.UTC(2026, 9, 14) / 1000)
/** What `invoice.period_end` says for that same payment: the period before. */
const INVOICE_PERIOD_END = Math.floor(Date.UTC(2026, 8, 14) / 1000)

/** Posts an event to the webhook exactly as Stripe would, signature and all. */
const deliver = async (event: Record<string, unknown>, secret = WEBHOOK_SECRET) => {
  const actual = await vi.importActual<typeof import("stripe")>("stripe")
  const payload = JSON.stringify(event)
  const header = actual.Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  })

  return request(app)
    .post("/api/stripe/webhook")
    .set("stripe-signature", header)
    .set("Content-Type", "application/json")
    .send(payload)
}

/** When a month's invoice was raised: the 14th of that month, 2026. */
const raisedIn = (month: number) => Math.floor(Date.UTC(2026, month, 14) / 1000)

/** The invoices in the tests below: `in_first` opened the membership, `in_second` renewed it. */
const RAISED: Record<string, number> = {
  in_first: raisedIn(7),
  in_second: raisedIn(8),
}

// In the webhook endpoint's own format, 2025-02-24.acacia: the subscription is on the line.
const paymentSucceeded = (
  invoiceId = "in_second",
  billingReason = "subscription_cycle",
  created = RAISED[invoiceId] ?? raisedIn(8),
) => ({
  id: `evt_${invoiceId}`,
  object: "event",
  type: "invoice.payment_succeeded",
  data: {
    object: {
      id: invoiceId,
      object: "invoice",
      billing_reason: billingReason,
      created,
      period_end: INVOICE_PERIOD_END,
      lines: { data: [{ subscription: SUBSCRIPTION }] },
    },
  },
})

/** A subscription in the state Stripe would report it. */
const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: SUBSCRIPTION,
  status: "active",
  cancel_at_period_end: false,
  metadata: {},
  items: { data: [{ current_period_end: PERIOD_END }] },
  ...overrides,
})

type ListedInvoice = {
  id: string
  billing_reason: string
  status: string
  created: number
}

/** One of the subscription's invoices, as it stands at Stripe. */
const invoice = (
  id: string,
  created: number,
  status = "paid",
  billing_reason = "subscription_cycle",
): ListedInvoice => ({ id, billing_reason, status, created })

/** A page of the subscription's invoices, newest first as Stripe lists them. */
const invoicePage = (invoices: ListedInvoice[], hasMore = false) => ({
  data: [...invoices].sort((a, b) => b.created - a.created),
  has_more: hasMore,
})

/** The paid invoices Stripe lists for the subscription. */
const paidInvoices = (...ids: [string, string][]) =>
  invoicePage(
    ids.map(([id, billingReason]) =>
      invoice(id, RAISED[id] ?? raisedIn(8), "paid", billingReason),
    ),
  )

const makeMembership = async (
  userId: string,
  data: Record<string, unknown> = {},
) => {
  const plan = await db.membershipPlan.create({
    data: { name: "Monthly_Membership", stripePriceId: "price_plan" },
  })
  return db.membership.create({
    data: {
      userId,
      planId: plan.id,
      endDate: new Date(Date.UTC(2026, 8, 14)),
      isActive: true,
      paymentStatus: "SUCCESS",
      stripeSubscriptionId: SUBSCRIPTION,
      totalMonths: 1,
      ...data,
    },
  })
}

describeIfDb("Stripe webhook", () => {
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET

  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
    resetStripeStub()
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = previousSecret
    vi.restoreAllMocks()
  })

  it("refuses an event that Stripe did not sign", async () => {
    const res = await deliver(paymentSucceeded(), "whsec_someone_else")

    expect(res.status).toBe(400)
    expect(stripeApi.subscriptions.retrieve).not.toHaveBeenCalled()
  })

  describe("invoice.payment_succeeded", () => {
    /**
     * Stripe redelivers an event whenever a response is slow or lost. Each delivery used to
     * add a month, and each month raised the member's discount a step.
     */
    it("counts a payment once however many times it is delivered", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id)
      stripeApi.subscriptions.retrieve.mockResolvedValue(subscription())
      stripeApi.invoices.list.mockResolvedValue(
        paidInvoices(["in_first", "subscription_create"], ["in_second", "subscription_cycle"]),
      )

      for (let delivery = 0; delivery < 3; delivery++) {
        const res = await deliver(paymentSucceeded())
        expect(res.status).toBe(200)
      }

      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after.totalMonths).toBe(2)
      expect(after.isActive).toBe(true)
      expect(after.paymentStatus).toBe("SUCCESS")
    })

    /**
     * `invoice.period_end` looks back one period on a subscription invoice, so the app's
     * "Renews on" showed the day the member had just paid.
     */
    it("records the date the membership next renews", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id)
      stripeApi.subscriptions.retrieve.mockResolvedValue(subscription())
      stripeApi.invoices.list.mockResolvedValue(
        paidInvoices(["in_first", "subscription_create"], ["in_second", "subscription_cycle"]),
      )

      await deliver(paymentSucceeded())

      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after.endDate.getTime()).toBe(PERIOD_END * 1000)
    })

    it("counts the payment being delivered even if the list has not caught up", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id)
      stripeApi.subscriptions.retrieve.mockResolvedValue(subscription())
      stripeApi.invoices.list.mockResolvedValue(
        paidInvoices(["in_first", "subscription_create"]),
      )

      await deliver(paymentSucceeded("in_second"))

      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after.totalMonths).toBe(2)
    })

    /**
     * createMembership stores the subscription id only after Stripe has charged the first
     * invoice, so this event can arrive first. It used to throw, and only Stripe's later
     * retry ever switched the membership on.
     */
    it("switches on a new membership whose payment beat its subscription id", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id, {
        isActive: false,
        paymentStatus: "PENDING",
        stripeSubscriptionId: null,
        totalMonths: 0,
      })
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ metadata: { userId: user.id } }),
      )
      stripeApi.invoices.list.mockResolvedValue(
        paidInvoices(["in_first", "subscription_create"]),
      )

      const res = await deliver(paymentSucceeded("in_first", "subscription_create"))

      expect(res.status).toBe(200)
      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after).toMatchObject({
        isActive: true,
        paymentStatus: "SUCCESS",
        stripeSubscriptionId: SUBSCRIPTION,
        totalMonths: 1,
      })
    })

    /** A throw here had Stripe redelivering the event for days. */
    it("acknowledges a subscription that matches no membership", async () => {
      const user = await makeUser()
      // Active on a different subscription: a stray event naming this user must not take it over.
      const membership = await makeMembership(user.id, {
        stripeSubscriptionId: "sub_current",
      })
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ metadata: { userId: user.id } }),
      )
      stripeApi.invoices.list.mockResolvedValue(
        paidInvoices(["in_first", "subscription_create"]),
      )

      const res = await deliver(paymentSucceeded("in_first", "subscription_create"))

      expect(res.status).toBe(200)
      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after.stripeSubscriptionId).toBe("sub_current")
      expect(after.totalMonths).toBe(1)
    })

    it("does not switch a cancelled membership back on when a late delivery arrives", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id, {
        isActive: false,
        paymentStatus: "FAILED",
        cancel: true,
      })
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ status: "canceled" }),
      )
      stripeApi.invoices.list.mockResolvedValue(
        paidInvoices(["in_first", "subscription_create"], ["in_second", "subscription_cycle"]),
      )

      const res = await deliver(paymentSucceeded())

      expect(res.status).toBe(200)
      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after).toMatchObject({
        isActive: false,
        paymentStatus: "FAILED",
        totalMonths: 1,
      })
    })

    /**
     * The discount grows a step for each month paid in a row, and a month that was never
     * paid starts the customer from the first step again.
     */
    describe("the month count", () => {
      const countAfter = async (
        justPaid: ReturnType<typeof paymentSucceeded>,
      ) => {
        const user = await makeUser()
        const membership = await makeMembership(user.id)
        stripeApi.subscriptions.retrieve.mockResolvedValue(subscription())

        const res = await deliver(justPaid)
        expect(res.status).toBe(200)

        const after = await db.membership.findUniqueOrThrow({
          where: { id: membership.id },
        })
        return after.totalMonths
      }

      /**
       * Stripe cancels a subscription whose renewal fails every retry, but a month voided or
       * written off by hand leaves it running — and a count of paid invoices stepped over it.
       */
      it.each([["void"], ["uncollectible"], ["open"]])(
        "starts again after a month left %s",
        async (status) => {
          stripeApi.invoices.list.mockResolvedValue(
            invoicePage([
              invoice("in_may", raisedIn(4), "paid", "subscription_create"),
              invoice("in_jun", raisedIn(5)),
              invoice("in_jul", raisedIn(6), status),
              invoice("in_aug", raisedIn(7)),
              invoice("in_sep", raisedIn(8)),
            ]),
          )

          expect(
            await countAfter(
              paymentSucceeded("in_sep", "subscription_cycle", raisedIn(8)),
            ),
          ).toBe(2)
        },
      )

      // The customer's decision: paid before Stripe gave up is a month paid.
      it("keeps counting through a renewal that was paid on a retry", async () => {
        stripeApi.invoices.list.mockResolvedValue(
          invoicePage([
            invoice("in_jun", raisedIn(5), "paid", "subscription_create"),
            { ...invoice("in_jul", raisedIn(6)), attempt_count: 3 } as ListedInvoice,
            invoice("in_aug", raisedIn(7)),
          ]),
        )

        expect(
          await countAfter(
            paymentSucceeded("in_aug", "subscription_cycle", raisedIn(7)),
          ),
        ).toBe(3)
      })

      it("ignores the next renewal while it is still being prepared", async () => {
        stripeApi.invoices.list.mockResolvedValue(
          invoicePage([
            invoice("in_aug", raisedIn(7), "paid", "subscription_create"),
            invoice("in_sep", raisedIn(8)),
            invoice("in_oct", raisedIn(9), "draft"),
          ]),
        )

        expect(
          await countAfter(
            paymentSucceeded("in_sep", "subscription_cycle", raisedIn(8)),
          ),
        ).toBe(2)
      })

      /**
       * Stripe redelivers an event whose delivery failed, and anyone can resend one from the
       * Dashboard. The count used to run back from the invoice delivered, skipping anything
       * newer, so August arriving again after September was recorded wrote two months over
       * three and cut the member's discount a step until the next renewal.
       */
      it("does not lower the count when an older payment is delivered again", async () => {
        stripeApi.invoices.list.mockResolvedValue(
          invoicePage([
            invoice("in_jul", raisedIn(6), "paid", "subscription_create"),
            invoice("in_aug", raisedIn(7)),
            invoice("in_sep", raisedIn(8)),
          ]),
        )

        expect(
          await countAfter(
            paymentSucceeded("in_aug", "subscription_cycle", raisedIn(7)),
          ),
        ).toBe(3)
      })

      it.each([["draft"], ["open"]])(
        "counts from the newest paid month past a renewal that is still %s",
        async (status) => {
          stripeApi.invoices.list.mockResolvedValue(
            invoicePage([
              invoice("in_jul", raisedIn(6), "paid", "subscription_create"),
              invoice("in_aug", raisedIn(7)),
              invoice("in_sep", raisedIn(8), status),
            ]),
          )

          expect(
            await countAfter(
              paymentSucceeded("in_jul", "subscription_create", raisedIn(6)),
            ),
          ).toBe(2)
        },
      )

      it("counts the payment being delivered even while the list still shows it open", async () => {
        stripeApi.invoices.list.mockResolvedValue(
          invoicePage([
            invoice("in_aug", raisedIn(7), "paid", "subscription_create"),
            invoice("in_sep", raisedIn(8), "open"),
          ]),
        )

        expect(
          await countAfter(
            paymentSucceeded("in_sep", "subscription_cycle", raisedIn(8)),
          ),
        ).toBe(2)
      })

      it("does not count a proration payment as a month", async () => {
        stripeApi.invoices.list.mockResolvedValue(
          invoicePage([
            invoice("in_jul", raisedIn(6), "paid", "subscription_create"),
            invoice("in_aug", raisedIn(7)),
            invoice("in_prorate", raisedIn(7) + 3600, "paid", "subscription_update"),
          ]),
        )

        expect(
          await countAfter(
            paymentSucceeded("in_prorate", "subscription_update", raisedIn(7) + 3600),
          ),
        ).toBe(2)
      })

      it("reads past the first page of invoices", async () => {
        stripeApi.invoices.list
          .mockResolvedValueOnce(
            invoicePage(
              [invoice("in_sep", raisedIn(8)), invoice("in_aug", raisedIn(7))],
              true,
            ),
          )
          .mockResolvedValueOnce(
            invoicePage([
              invoice("in_jul", raisedIn(6), "paid", "subscription_create"),
            ]),
          )

        expect(
          await countAfter(
            paymentSucceeded("in_sep", "subscription_cycle", raisedIn(8)),
          ),
        ).toBe(3)
        expect(stripeApi.invoices.list).toHaveBeenLastCalledWith(
          expect.objectContaining({ starting_after: "in_aug" }),
        )
      })
    })
  })

  describe("invoice.payment_failed", () => {
    const paymentFailed = (
      invoiceId = "in_renewal",
      subscriptionId: string | null = SUBSCRIPTION,
    ) => ({
      id: `evt_failed_${invoiceId}`,
      object: "event",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: invoiceId,
          object: "invoice",
          billing_reason: "subscription_cycle",
          lines: { data: [{ subscription: subscriptionId }] },
        },
      },
    })

    /** The invoice as Stripe holds it now, with its payment expanded. */
    const invoiceNow = (status: string) => ({
      id: "in_renewal",
      status,
      payments: {
        data: [
          { payment: { type: "payment_intent", payment_intent: "pi_declined" } },
        ],
      },
    })

    beforeEach(() => {
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_declined",
        last_payment_error: {
          code: "card_declined",
          message: "Your card was declined.",
        },
      })
    })

    it("puts a membership on hold when a renewal is declined", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id)
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ status: "past_due" }),
      )
      stripeApi.invoices.retrieve.mockResolvedValue(invoiceNow("open"))

      const res = await deliver(paymentFailed())

      expect(res.status).toBe(200)
      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after).toMatchObject({ isActive: true, paymentStatus: "PENDING" })
    })

    /**
     * Stripe retries a declined renewal itself and redelivers events. A decline applied
     * after the payment went through put a paid member on hold, and perks need a SUCCESS
     * payment status, so their discount went with it.
     */
    it("does not put a paid member on hold when a decline arrives after the payment", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id)
      stripeApi.subscriptions.retrieve.mockResolvedValue(subscription())
      stripeApi.invoices.retrieve.mockResolvedValue(invoiceNow("paid"))

      const res = await deliver(paymentFailed())

      expect(res.status).toBe(200)
      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after).toMatchObject({ isActive: true, paymentStatus: "SUCCESS" })
    })

    it("records why a first payment was declined", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id, {
        isActive: false,
        paymentStatus: "PENDING",
        totalMonths: 0,
      })
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ status: "incomplete" }),
      )
      stripeApi.invoices.retrieve.mockResolvedValue(invoiceNow("open"))

      await deliver(paymentFailed())

      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after).toMatchObject({
        isActive: false,
        paymentStatus: "FAILED",
        paymentFailureCode: "card_declined",
        paymentFailureMessage: "Your card was declined.",
      })
      expect(stripeApi.invoices.retrieve).toHaveBeenCalledWith("in_renewal", {
        expand: ["payments"],
      })
    })

    /**
     * The same race as a first payment that succeeds. The decline matched no row and was
     * lost, so the app polled a PENDING membership until it gave up with "timed out".
     */
    it("records a declined first payment that beat its subscription id", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id, {
        isActive: false,
        paymentStatus: "PENDING",
        stripeSubscriptionId: null,
        totalMonths: 0,
      })
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ status: "incomplete", metadata: { userId: user.id } }),
      )
      stripeApi.invoices.retrieve.mockResolvedValue(invoiceNow("open"))

      await deliver(paymentFailed())

      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after).toMatchObject({
        paymentStatus: "FAILED",
        stripeSubscriptionId: SUBSCRIPTION,
      })
    })

    it("leaves an ended membership alone when its last renewal attempt is declined", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id, { isActive: false })
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ status: "canceled" }),
      )
      stripeApi.invoices.retrieve.mockResolvedValue(invoiceNow("open"))

      const res = await deliver(paymentFailed())

      expect(res.status).toBe(200)
      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      // Not PENDING: that would show it on hold and offer a retry for a dead subscription.
      expect(after.paymentStatus).toBe("SUCCESS")
    })

    /** Both of these threw, and Stripe redelivered them for days. */
    it("acknowledges an invoice whose subscription Stripe no longer has", async () => {
      stripeApi.subscriptions.retrieve.mockRejectedValue(
        resourceMissing(await vi.importActual<typeof import("stripe")>("stripe")),
      )
      stripeApi.invoices.retrieve.mockResolvedValue(invoiceNow("open"))

      const res = await deliver(paymentFailed())

      expect(res.status).toBe(200)
    })

    it("ignores an invoice that is not for a subscription", async () => {
      const res = await deliver(paymentFailed("in_one_off", null))

      expect(res.status).toBe(200)
      expect(stripeApi.subscriptions.retrieve).not.toHaveBeenCalled()
    })
  })

  describe("customer.subscription.updated", () => {
    const CANCEL_AT = Math.floor(Date.UTC(2026, 9, 14) / 1000)

    const subscriptionUpdated = (cancelling: boolean) => ({
      id: "evt_updated",
      object: "event",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: SUBSCRIPTION,
          object: "subscription",
          status: "active",
          cancel_at_period_end: cancelling,
          cancel_at: cancelling ? CANCEL_AT : null,
        },
      },
    })

    /**
     * The event's own `cancel_at_period_end` was taken as the truth, so a "cancelling"
     * update redelivered after the member tapped Re-subscribe marked them as leaving.
     */
    it("does not mark a member as leaving when a stale cancellation arrives after they resumed", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id)
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ cancel_at_period_end: false, cancel_at: null }),
      )

      const res = await deliver(subscriptionUpdated(true))

      expect(res.status).toBe(200)
      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after.cancel).toBe(false)
    })

    it("records a cancellation set for the end of the period", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id)
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ cancel_at_period_end: true, cancel_at: CANCEL_AT }),
      )

      await deliver(subscriptionUpdated(true))

      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after.cancel).toBe(true)
      expect(after.endDate.getTime()).toBe(CANCEL_AT * 1000)
    })
  })

  describe("customer.subscription.deleted", () => {
    const ENDED_AT = Math.floor(Date.UTC(2026, 9, 1) / 1000)

    const subscriptionDeleted = (details?: { reason: string | null }) => ({
      id: "evt_deleted",
      object: "event",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: SUBSCRIPTION,
          object: "subscription",
          status: "canceled",
          ended_at: ENDED_AT,
          ...(details ? { cancellation_details: details } : {}),
        },
      },
    })

    /**
     * Every ended membership was marked as a failed payment, so a member who cancelled was
     * shown "Payment Failed" in red once their paid time ran out.
     */
    it.each([["SUCCESS"], ["PENDING"]])(
      "ends a cancelled membership that was %s without calling it a failed payment",
      async (paymentStatus) => {
        const user = await makeUser()
        const membership = await makeMembership(user.id, {
          paymentStatus,
          cancel: true,
        })

        const res = await deliver(
          subscriptionDeleted({ reason: "cancellation_requested" }),
        )

        expect(res.status).toBe(200)
        const after = await db.membership.findUniqueOrThrow({
          where: { id: membership.id },
        })
        expect(after).toMatchObject({ isActive: false, paymentStatus: "SUCCESS" })
        // When it ended, not when the event happened to be processed.
        expect(after.endDate.getTime()).toBe(ENDED_AT * 1000)
      },
    )

    it("records a membership that ended because its payment failed", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id, { paymentStatus: "PENDING" })

      await deliver(subscriptionDeleted({ reason: "payment_failed" }))

      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after).toMatchObject({ isActive: false, paymentStatus: "FAILED" })
    })

    it("reads the reason back from Stripe when the event does not carry it", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id)
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({
          status: "canceled",
          cancellation_details: { reason: "cancellation_requested" },
        }),
      )

      await deliver(subscriptionDeleted())

      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after).toMatchObject({ isActive: false, paymentStatus: "SUCCESS" })
    })
  })
})
