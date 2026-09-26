import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase } from "../test/db"
import { makeUser } from "../test/factories"
import { membershipPlanName } from "../lib/membership"
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

// A renewal declined pushes to the member (lib/membershipReminders). Typed with the real
// signature, so `mock.calls[0][2]` is checked rather than inferred as an empty tuple.
const { sendPushToUser } = vi.hoisted(() => ({
  sendPushToUser: vi.fn(
    async (
      _userId: string,
      _title: string,
      _body: string,
      _data?: Record<string, unknown>,
    ) => true,
  ),
}))
vi.mock("../lib/pushToUser", () => ({ sendPushToUser }))

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
    data: { name: membershipPlanName(), stripePriceId: "price_plan" },
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
    sendPushToUser.mockClear()
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

    /**
     * A first payment the bank wants to authenticate is reported as a failed payment before
     * the customer has had the chance to answer, so the row reads FAILED. Confirming it in
     * the app then pays the invoice, and that payment has to switch the membership on.
     */
    it("switches on a membership whose first payment was authenticated after a decline", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id, {
        isActive: false,
        paymentStatus: "FAILED",
        totalMonths: 0,
      })
      stripeApi.subscriptions.retrieve.mockResolvedValue(subscription())
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

    /**
     * `totalMonths` is the run, and starts again after a break. `lifetimeMonths` is every month
     * ever paid for, across every subscription the member has had.
     */
    describe("the lifetime count", () => {
      const CUSTOMER = "cus_member"

      /** One of the customer's invoices, with the subscription it was raised for. */
      const customerInvoice = (
        id: string,
        subscriptionId: string | null,
        created: number,
        billing_reason = "subscription_cycle",
      ) => ({
        id,
        billing_reason,
        status: "paid",
        created,
        parent: subscriptionId
          ? { subscription_details: { subscription: subscriptionId } }
          : null,
      })

      /** An earlier membership: three months paid, then it ended. */
      const EARLIER = [
        customerInvoice("in_jan", "sub_earlier", raisedIn(0), "subscription_create"),
        customerInvoice("in_feb", "sub_earlier", raisedIn(1)),
        customerInvoice("in_mar", "sub_earlier", raisedIn(2)),
      ]

      /**
       * Stripe lists the subscription's invoices for the run and the customer's for the
       * lifetime, so each is answered from its own list.
       */
      const listing = (
        run: ReturnType<typeof invoicePage>,
        customerInvoices: ReturnType<typeof customerInvoice>[],
      ) =>
        stripeApi.invoices.list.mockImplementation(
          async (params: { subscription?: string; customer?: string }) =>
            params.customer
              ? {
                  data: [...customerInvoices].sort((a, b) => b.created - a.created),
                  has_more: false,
                }
              : run,
        )

      /** The member's payment, carrying the customer as every real invoice does. */
      const paid = (invoiceId = "in_second") => {
        const event = paymentSucceeded(invoiceId)
        return {
          ...event,
          data: { object: { ...event.data.object, customer: CUSTOMER } },
        }
      }

      it("counts every month paid, across a break, however often it is delivered", async () => {
        const user = await makeUser()
        const membership = await makeMembership(user.id)
        stripeApi.subscriptions.retrieve.mockResolvedValue(subscription())
        listing(
          paidInvoices(["in_first", "subscription_create"], ["in_second", "subscription_cycle"]),
          [
            ...EARLIER,
            // Neither is a month: a proration, and a one-off with no subscription.
            customerInvoice("in_prorate", "sub_earlier", raisedIn(1) + 3600, "subscription_update"),
            customerInvoice("in_one_off", null, raisedIn(4), "manual"),
            customerInvoice("in_first", SUBSCRIPTION, RAISED.in_first, "subscription_create"),
            customerInvoice("in_second", SUBSCRIPTION, RAISED.in_second),
          ],
        )

        for (let delivery = 0; delivery < 3; delivery++) {
          expect((await deliver(paid())).status).toBe(200)
        }

        const after = await db.membership.findUniqueOrThrow({
          where: { id: membership.id },
        })
        expect(after).toMatchObject({ totalMonths: 2, lifetimeMonths: 5 })
        expect(stripeApi.invoices.list).toHaveBeenCalledWith(
          expect.objectContaining({ customer: CUSTOMER, status: "paid" }),
        )
      })

      it("counts the payment being delivered even if the list has not caught up", async () => {
        const user = await makeUser()
        const membership = await makeMembership(user.id)
        stripeApi.subscriptions.retrieve.mockResolvedValue(subscription())
        listing(paidInvoices(["in_first", "subscription_create"]), [
          ...EARLIER,
          customerInvoice("in_first", SUBSCRIPTION, RAISED.in_first, "subscription_create"),
        ])

        await deliver(paid("in_second"))

        const after = await db.membership.findUniqueOrThrow({
          where: { id: membership.id },
        })
        expect(after.lifetimeMonths).toBe(5)
      })

      /**
       * A Stripe customer that went missing is replaced (`getOrCreateCustomerId`), and the new
       * one has none of the old invoices. What was paid stays paid.
       */
      it("never lowers the count", async () => {
        const user = await makeUser()
        const membership = await makeMembership(user.id, { lifetimeMonths: 12 })
        stripeApi.subscriptions.retrieve.mockResolvedValue(subscription())
        listing(paidInvoices(["in_first", "subscription_create"], ["in_second", "subscription_cycle"]), [
          customerInvoice("in_first", SUBSCRIPTION, RAISED.in_first, "subscription_create"),
          customerInvoice("in_second", SUBSCRIPTION, RAISED.in_second),
        ])

        await deliver(paid())

        const after = await db.membership.findUniqueOrThrow({
          where: { id: membership.id },
        })
        expect(after).toMatchObject({ totalMonths: 2, lifetimeMonths: 12 })
      })

      // Every month in the run was paid for, so the lifetime can never be the smaller.
      it("is never less than the run, even when the customer's invoices cannot be read", async () => {
        const user = await makeUser()
        const membership = await makeMembership(user.id, { lifetimeMonths: 0 })
        stripeApi.subscriptions.retrieve.mockResolvedValue(subscription())
        stripeApi.invoices.list.mockImplementation(
          async (params: { subscription?: string; customer?: string }) => {
            if (params.customer) throw new Error("Stripe is down")
            return paidInvoices(
              ["in_first", "subscription_create"],
              ["in_second", "subscription_cycle"],
            )
          },
        )

        expect((await deliver(paid())).status).toBe(200)

        const after = await db.membership.findUniqueOrThrow({
          where: { id: membership.id },
        })
        expect(after).toMatchObject({
          isActive: true,
          paymentStatus: "SUCCESS",
          totalMonths: 2,
          lifetimeMonths: 2,
        })
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
     * Stripe retries a declined renewal several times, each decline is another event, and any
     * of them can be redelivered. The member is told when the membership goes on hold, once.
     */
    it("tells the member once that their renewal was declined", async () => {
      const user = await makeUser()
      await makeMembership(user.id, { totalMonths: 3 })
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ status: "past_due" }),
      )
      stripeApi.invoices.retrieve.mockResolvedValue(invoiceNow("open"))

      await deliver(paymentFailed())
      await deliver(paymentFailed())
      // Stripe's own retry, declined again.
      await deliver({ ...paymentFailed(), id: "evt_failed_retry" })

      expect(sendPushToUser).toHaveBeenCalledTimes(1)
      const [userId, title, body, data] = sendPushToUser.mock.calls[0]
      expect(userId).toBe(user.id)
      expect(title).toBe("Your membership payment didn't go through")
      expect(body).toMatch(/^Your 15% member discount, .+ and your other member benefits are paused\./)
      expect(body).toMatch(/the discount starts again at 5%\.$/)
      expect(data).toEqual({ type: "MEMBERSHIP_PAYMENT_FAILED" })
    })

    describe("when the bank wants the member to confirm the renewal", () => {
      /** Off-session, a bank that wants 3D Secure declines with this and Stripe waits. */
      const awaitingBank = {
        id: "pi_declined",
        status: "requires_payment_method",
        last_payment_error: {
          code: "card_declined",
          decline_code: "authentication_required",
          message: "Your card was declined. This transaction requires authentication.",
        },
      }

      const actionRequired = () => ({
        ...paymentFailed(),
        id: "evt_action_in_renewal",
        type: "invoice.payment_action_required",
      })

      beforeEach(() => {
        stripeApi.paymentIntents.retrieve.mockResolvedValue(awaitingBank)
        stripeApi.subscriptions.retrieve.mockResolvedValue(
          subscription({ status: "past_due" }),
        )
        stripeApi.invoices.retrieve.mockResolvedValue(invoiceNow("open"))
      })

      /**
       * Worded as a decline, the push and the banner sent a member whose card was fine off
       * to replace it, when all the bank wanted was for them to confirm the payment.
       */
      it("records it and asks the member to confirm, not to replace the card", async () => {
        const user = await makeUser()
        const membership = await makeMembership(user.id, { totalMonths: 3 })

        await deliver(paymentFailed())

        const after = await db.membership.findUniqueOrThrow({
          where: { id: membership.id },
        })
        expect(after).toMatchObject({
          isActive: true,
          paymentStatus: "PENDING",
          paymentFailureCode: "authentication_required",
        })
        expect(sendPushToUser).toHaveBeenCalledTimes(1)
        const [, title, body, data] = sendPushToUser.mock.calls[0]
        expect(title).toBe("Please confirm your membership payment")
        expect(body).toMatch(/^Your bank needs you to confirm this month's membership payment\./)
        expect(data).toEqual({ type: "MEMBERSHIP_PAYMENT_FAILED" })
      })

      /** Waiting in `requires_action` carries no error at all, and is the same case. */
      it("recognises a payment waiting on the bank with no error on it", async () => {
        const user = await makeUser()
        const membership = await makeMembership(user.id)
        stripeApi.paymentIntents.retrieve.mockResolvedValue({
          id: "pi_declined",
          status: "requires_action",
          last_payment_error: null,
        })

        await deliver(actionRequired())

        const after = await db.membership.findUniqueOrThrow({
          where: { id: membership.id },
        })
        expect(after.paymentFailureCode).toBe("authentication_required")
      })

      /**
       * Stripe can send both events for the one attempt. Each would put the membership on
       * hold, and the claim is what keeps it to one push.
       */
      it("tells the member once when both events arrive", async () => {
        const user = await makeUser()
        await makeMembership(user.id)

        await deliver(actionRequired())
        await deliver(paymentFailed())

        expect(sendPushToUser).toHaveBeenCalledTimes(1)
      })

      it("forgets the reason once the renewal is paid", async () => {
        const user = await makeUser()
        const membership = await makeMembership(user.id)
        await deliver(paymentFailed())

        stripeApi.subscriptions.retrieve.mockResolvedValue(subscription())
        stripeApi.invoices.list.mockResolvedValue(
          paidInvoices(["in_first", "subscription_create"], ["in_second", "subscription_cycle"]),
        )
        await deliver(paymentSucceeded())

        const after = await db.membership.findUniqueOrThrow({
          where: { id: membership.id },
        })
        expect(after).toMatchObject({
          paymentStatus: "SUCCESS",
          paymentFailureCode: null,
          paymentFailureMessage: null,
        })
      })
    })

    it("records why a renewal was declined, and words the push as a decline", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id)
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ status: "past_due" }),
      )
      stripeApi.invoices.retrieve.mockResolvedValue(invoiceNow("open"))

      await deliver(paymentFailed())

      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after).toMatchObject({
        paymentStatus: "PENDING",
        paymentFailureCode: "card_declined",
        paymentFailureMessage: "Your card was declined.",
      })
      expect(sendPushToUser.mock.calls[0][1]).toBe(
        "Your membership payment didn't go through",
      )
    })

    /** A paid retry lifts the hold, so a later renewal declined is a new one. */
    it("tells the member again when a later renewal is declined", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id)
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ status: "past_due" }),
      )
      stripeApi.invoices.retrieve.mockResolvedValue(invoiceNow("open"))

      await deliver(paymentFailed())
      await db.membership.update({
        where: { id: membership.id },
        data: { paymentStatus: "SUCCESS" },
      })
      await deliver({ ...paymentFailed(), id: "evt_failed_next_month" })

      expect(sendPushToUser).toHaveBeenCalledTimes(2)
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
      expect(sendPushToUser).not.toHaveBeenCalled()
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
      // The app is watching this one happen; there is no membership to warn about losing.
      expect(sendPushToUser).not.toHaveBeenCalled()
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

    /**
     * The run is the discount's input, and a rejoin is a new subscription that starts it again,
     * so once the subscription has ended the row said the member had a run they no longer had.
     * `lifetimeMonths` keeps what was paid, which is what points expiry needs, and the
     * subscription id stays: it is what every late delivery for that subscription matches on,
     * and each of them checks the subscription's live status and does nothing.
     */
    it("starts the run again, keeping the months paid and the subscription it was", async () => {
      const user = await makeUser()
      const membership = await makeMembership(user.id, {
        cancel: true,
        totalMonths: 4,
        lifetimeMonths: 9,
      })

      await deliver(subscriptionDeleted({ reason: "cancellation_requested" }))

      const after = await db.membership.findUniqueOrThrow({
        where: { id: membership.id },
      })
      expect(after).toMatchObject({
        isActive: false,
        totalMonths: 0,
        lifetimeMonths: 9,
        stripeSubscriptionId: SUBSCRIPTION,
      })
    })

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
