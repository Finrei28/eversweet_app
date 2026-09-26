import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { customerDetailsOf } from "../lib/stripeCustomer"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeCustomerWithCart, makeUser } from "../test/factories"
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

// Never the real SDK: see test/stripeStub.
vi.mock("stripe", async (importOriginal) =>
  (await import("../test/stripeStub.js")).fakeStripeModule(await importOriginal()),
)

const OWN_CUSTOMER = "cus_own"

const as = (userId: string) => `Bearer ${tokenFor(userId)}`

/**
 * A customer whose Stripe customer already exists and already carries their details, so no
 * test creates one, or writes to one, by accident.
 */
const withStripeCustomer = async (userId: string, customerId = OWN_CUSTOMER) => {
  const user = await db.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customerId },
    select: { email: true, firstName: true, lastName: true, phone: true },
  })
  // The user's details as they stand, however the test set them up - so a test that gives a
  // user another name does not find its customer "out of date" and trip a sync update.
  const details = customerDetailsOf(user)
  stripeApi.customers.retrieve.mockResolvedValue({
    id: customerId,
    email: details.email,
    name: details.name ?? null,
    phone: details.phone ?? null,
  })
}

describeIfDb("Stripe endpoints", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
    resetStripeStub()
  })

  /**
   * The charge's currency came from the request while its amount was checked as bare
   * cents, so "inr" passed the check and a NZ$50 cart could be paid as 5000 paise.
   */
  describe("createPaymentIntent", () => {
    const pay = (userId: string, body: Record<string, unknown>) =>
      request(app)
        .post("/api/stripe/createPaymentIntent")
        .set("Authorization", as(userId))
        .send({ amount: 1200, authoriseOnly: true, ...body })

    beforeEach(() => {
      stripeApi.paymentIntents.create.mockResolvedValue({
        id: "pi_new",
        client_secret: "pi_new_secret",
      })
    })

    it.each([["inr"], ["usd"], [""], [42]])(
      "refuses a charge in %j",
      async (currency) => {
        const { user } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
        await withStripeCustomer(user.id)

        const res = await pay(user.id, { currency })

        expect(res.status).toBe(400)
        expect(stripeApi.paymentIntents.create).not.toHaveBeenCalled()
      },
    )

    it.each([["nzd"], ["NZD"], [undefined]])(
      "charges in NZD when sent %j",
      async (currency) => {
        const { user } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
        await withStripeCustomer(user.id)

        const res = await pay(user.id, { currency })

        expect(res.status).toBe(200)
        expect(stripeApi.paymentIntents.create).toHaveBeenCalledWith(
          expect.objectContaining({
            amount: 1200,
            currency: "nzd",
            customer: OWN_CUSTOMER,
          }),
        )
      },
    )

    /**
     * Every card order is a hold now. A build that predates holds reads one as a failed
     * payment, so it is asked to update before its customer's card is touched.
     */
    it.each([[undefined], [false], ["true"]])(
      "asks a build that sends authoriseOnly %j to update, without touching Stripe",
      async (authoriseOnly) => {
        const { user } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
        await db.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: null },
        })

        const res = await pay(user.id, { authoriseOnly })

        expect(res.status).toBe(426)
        expect(res.body).toEqual({
          code: "APP_UPDATE_REQUIRED",
          message: "Please update the Eversweet app to pay by card.",
        })
        expect(stripeApi.paymentIntents.create).not.toHaveBeenCalled()
        expect(stripeApi.customers.create).not.toHaveBeenCalled()
      },
    )

    it("holds the card rather than charging it", async () => {
      const { user } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
      await withStripeCustomer(user.id)

      const res = await pay(user.id, {})

      expect(res.status).toBe(200)
      expect(stripeApi.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ capture_method: "manual" }),
      )
    })

    // createOrder will only place, or refund, an order against a payment carrying this.
    it("marks the payment as one made for this customer's order", async () => {
      const { user } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
      await withStripeCustomer(user.id)

      const res = await pay(user.id, {})

      expect(res.status).toBe(200)
      expect(stripeApi.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { purpose: "app_order", userId: user.id },
        }),
      )
    })
  })

  /**
   * The subscription was created at whatever price id the request named, so any cheaper
   * recurring price on the account bought a full membership.
   */
  describe("createMembership", () => {
    const PLAN_PRICE = "price_plan"

    const join = (userId: string, body: Record<string, unknown>) =>
      request(app)
        .post("/api/stripe/createMembership")
        .set("Authorization", as(userId))
        .send({ paymentMethodId: "pm_card", ...body })

    beforeEach(async () => {
      await db.membershipPlan.create({
        data: { name: membershipPlanName(), stripePriceId: PLAN_PRICE },
      })
      stripeApi.subscriptions.list.mockResolvedValue({ data: [] })
      stripeApi.customers.update.mockResolvedValue({})
      stripeApi.subscriptions.create.mockResolvedValue({ id: "sub_new" })
    })

    it("refuses a price other than the plan's, and changes nothing", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)

      const res = await join(user.id, { stripePriceId: "price_one_cent" })

      expect(res.status).toBe(409)
      expect(stripeApi.subscriptions.create).not.toHaveBeenCalled()
      // Refused before it could swap the customer's default card, which it used to do first.
      expect(stripeApi.customers.update).not.toHaveBeenCalled()
      expect(await db.membership.findUnique({ where: { userId: user.id } })).toBeNull()
    })

    it.each([[PLAN_PRICE], [undefined]])(
      "subscribes at the plan's price when sent %j",
      async (stripePriceId) => {
        const user = await makeUser()
        await withStripeCustomer(user.id)

        const res = await join(user.id, { stripePriceId })

        expect(res.status).toBe(201)
        expect(stripeApi.subscriptions.create).toHaveBeenCalledWith(
          expect.objectContaining({ items: [{ price: PLAN_PRICE }] }),
        )
        const membership = await db.membership.findUnique({
          where: { userId: user.id },
        })
        expect(membership?.stripeSubscriptionId).toBe("sub_new")
      },
    )

    /** A membership that has ended, as a returning member's row looks. */
    const endedMembership = async (userId: string) => {
      const plan = await db.membershipPlan.findFirstOrThrow()
      return db.membership.create({
        data: {
          userId,
          planId: plan.id,
          endDate: new Date(),
          isActive: false,
          paymentStatus: "SUCCESS",
          stripeSubscriptionId: "sub_old",
          totalMonths: 4,
        },
      })
    }

    /**
     * The claim zeroed `totalMonths`, which nothing needed - the new subscription's first
     * payment writes its own count - and which made a returning member whose rejoin then
     * failed read as never having paid. Points expiry counts only a paid membership's end, so
     * they lost the month it would have given them.
     */
    it("leaves a returning member's paid months alone while they rejoin", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      await endedMembership(user.id)

      expect((await join(user.id, {})).status).toBe(201)

      const membership = await db.membership.findUniqueOrThrow({
        where: { userId: user.id },
      })
      expect(membership).toMatchObject({ paymentStatus: "PENDING", totalMonths: 4 })
    })

    /**
     * Nothing claimed a join, so two requests — a double tap that lands before the button
     * disables, or a resend — both created a subscription, and the customer was billed
     * twice every month.
     */
    it.each([["a returning member"], ["a first-time member"]])(
      "creates one subscription when %s's join is sent twice at once",
      async (who) => {
        const user = await makeUser()
        await withStripeCustomer(user.id)
        if (who === "a returning member") await endedMembership(user.id)

        const [a, b] = await Promise.all([join(user.id, {}), join(user.id, {})])

        expect([a.status, b.status].sort()).toEqual([201, 409])
        expect(stripeApi.subscriptions.create).toHaveBeenCalledTimes(1)
      },
    )

    /**
     * The same race, forced rather than hoped for.
     *
     * `Membership.userId` is a required one-to-one, so how the loser's create fails depends
     * on where the winner got to. If the winner has not committed yet, the database's unique
     * index refuses it: P2002. If it has, Prisma refuses it first - connecting this user to
     * a second membership would orphan the one they have, and `Membership.user` is required
     * - which is P2014. Only P2002 was caught, so the second outcome answered 500 and the
     * customer got a server error instead of "you are already joining".
     *
     * Both mean the same thing here, and this pins the one that only appeared when CI's
     * slower database let the winner commit first. Holding the read back is what makes it
     * deterministic: the controller sees no membership and takes the create branch, while
     * the row is already there.
     */
    it("turns the loser away when the winner has already committed", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      const plan = await db.membershipPlan.findFirstOrThrow({
        where: { name: membershipPlanName() },
      })
      await db.membership.create({
        data: {
          userId: user.id,
          planId: plan.id,
          paymentStatus: "PENDING",
          isActive: false,
          startDate: new Date(),
          endDate: new Date(),
        },
      })

      const read = vi
        .spyOn(db.membership, "findUnique")
        .mockResolvedValueOnce(null)

      const res = await join(user.id, {})

      expect(res.status).toBe(409)
      expect(stripeApi.subscriptions.create).not.toHaveBeenCalled()

      read.mockRestore()
    })

    it("lets a join Stripe turned away be tried again straight away", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      const previous = await endedMembership(user.id)
      stripeApi.customers.update.mockRejectedValueOnce(new Error("card refused"))

      const refused = await join(user.id, {})
      expect(refused.status).toBe(500)
      expect(
        (await db.membership.findUniqueOrThrow({ where: { id: previous.id } }))
          .paymentStatus,
      ).toBe("SUCCESS")

      const retried = await join(user.id, { paymentMethodId: "pm_other_card" })
      expect(retried.status).toBe(201)
      expect(stripeApi.subscriptions.create).toHaveBeenCalledTimes(1)
    })

    it("lets a first-time member try again after Stripe turned the first join away", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.customers.update.mockRejectedValueOnce(new Error("card refused"))

      expect((await join(user.id, {})).status).toBe(500)
      expect(await db.membership.findUnique({ where: { userId: user.id } })).toBeNull()

      expect((await join(user.id, {})).status).toBe(201)
    })

    it("frees a join left waiting by a request that died partway", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      const stuck = await endedMembership(user.id)
      await db.membership.update({
        where: { id: stuck.id },
        data: {
          paymentStatus: "PENDING",
          updatedAt: new Date(Date.now() - 3 * 60 * 1000),
        },
      })

      const res = await join(user.id, {})

      expect(res.status).toBe(201)
    })

    describe("when the bank wants to authenticate the first payment", () => {
      /** A subscription whose first invoice's payment is `pi_first`. */
      const incompleteSubscription = () => ({
        id: "sub_new",
        status: "incomplete",
        latest_invoice: {
          id: "in_first",
          payments: {
            data: [
              { payment: { type: "payment_intent", payment_intent: "pi_first" } },
            ],
          },
        },
      })

      beforeEach(() => {
        stripeApi.subscriptions.create.mockResolvedValue(incompleteSubscription())
      })

      /**
       * The server charged the first month itself, so a card whose bank asked for 3D Secure
       * left the subscription incomplete with nobody able to answer, and the app reported a
       * failed payment. Every attempt to join on that card failed the same way.
       */
      it("hands the payment back for the app to confirm", async () => {
        const user = await makeUser()
        await withStripeCustomer(user.id)
        stripeApi.paymentIntents.retrieve.mockResolvedValue({
          id: "pi_first",
          status: "requires_action",
          client_secret: "pi_first_secret_abc",
        })

        const res = await join(user.id, {})

        expect(res.status).toBe(201)
        expect(res.body).toEqual({
          success: true,
          requiresAction: true,
          clientSecret: "pi_first_secret_abc",
          paymentMethodId: "pm_card",
        })
        expect(stripeApi.subscriptions.create).toHaveBeenCalledWith(
          expect.objectContaining({ expand: ["latest_invoice.payments"] }),
        )
        expect(stripeApi.paymentIntents.retrieve).toHaveBeenCalledWith("pi_first")
        const membership = await db.membership.findUniqueOrThrow({
          where: { userId: user.id },
        })
        expect(membership).toMatchObject({
          isActive: false,
          paymentStatus: "PENDING",
          stripeSubscriptionId: "sub_new",
        })
      })

      it("answers a plain decline as before, for the webhook to record", async () => {
        const user = await makeUser()
        await withStripeCustomer(user.id)
        stripeApi.paymentIntents.retrieve.mockResolvedValue({
          id: "pi_first",
          status: "requires_payment_method",
          client_secret: "pi_first_secret_abc",
          last_payment_error: { code: "card_declined" },
        })

        const res = await join(user.id, {})

        expect(res.status).toBe(201)
        expect(res.body).toEqual({ success: true })
      })

      it("still answers the join when the payment cannot be read", async () => {
        const user = await makeUser()
        await withStripeCustomer(user.id)
        stripeApi.paymentIntents.retrieve.mockRejectedValue(new Error("Stripe is down"))
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

        const res = await join(user.id, {})

        expect(res.status).toBe(201)
        expect(res.body).toEqual({ success: true })
        errorSpy.mockRestore()
      })
    })
  })

  /**
   * A renewal on hold is retried with `invoices.pay`, off-session. A bank that wanted the
   * member to confirm it was them declined it every time, and the member could only watch
   * the retries fail until Stripe cancelled the subscription and their run of months.
   */
  describe("retryPayment", () => {
    const retry = (userId: string) =>
      request(app)
        .post("/api/stripe/retryPayment")
        .set("Authorization", as(userId))
        .send({})

    const heldMember = async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.customers.retrieve.mockResolvedValue({
        id: OWN_CUSTOMER,
        invoice_settings: { default_payment_method: "pm_member_card" },
      })
      const plan = await db.membershipPlan.create({
        data: { name: membershipPlanName(), stripePriceId: "price_plan" },
      })
      await db.membership.create({
        data: {
          userId: user.id,
          planId: plan.id,
          endDate: new Date(),
          isActive: true,
          paymentStatus: "PENDING",
          stripeSubscriptionId: "sub_member",
          totalMonths: 3,
        },
      })
      return user
    }

    const cardError = async (code: string, message: string) => {
      const actual = await vi.importActual<typeof import("stripe")>("stripe")
      return new actual.Stripe.errors.StripeCardError({
        type: "card_error",
        code,
        decline_code: code,
        message,
      })
    }

    let errorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      stripeApi.invoices.list.mockResolvedValue({
        data: [
          {
            id: "in_renewal",
            status: "open",
            lines: { data: [{ subscription: "sub_member" }] },
          },
        ],
      })
      stripeApi.invoices.retrieve.mockResolvedValue({
        id: "in_renewal",
        payments: {
          data: [
            { payment: { type: "payment_intent", payment_intent: "pi_renewal" } },
          ],
        },
      })
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    })

    afterEach(() => {
      errorSpy.mockRestore()
    })

    it("answers a paid retry as it always has", async () => {
      const user = await heldMember()
      stripeApi.invoices.pay.mockResolvedValue({ id: "in_renewal", status: "paid" })

      const res = await retry(user.id)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ success: true })
    })

    it("hands a retry the bank wants to authenticate back for the app to confirm", async () => {
      const user = await heldMember()
      stripeApi.invoices.pay.mockRejectedValue(
        await cardError(
          "authentication_required",
          "Your card was declined. This transaction requires authentication.",
        ),
      )
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_renewal",
        status: "requires_payment_method",
        client_secret: "pi_renewal_secret_abc",
        payment_method: null,
        last_payment_error: {
          code: "card_declined",
          decline_code: "authentication_required",
          payment_method: { id: "pm_member_card" },
        },
      })

      const res = await retry(user.id)

      // Not a 200: a build from before this reads the refusal the way it always has.
      expect(res.status).toBe(402)
      expect(res.body).toEqual({
        code: "AUTHENTICATION_REQUIRED",
        message: "Your card was declined. This transaction requires authentication.",
        clientSecret: "pi_renewal_secret_abc",
        paymentMethodId: "pm_member_card",
      })
      expect(stripeApi.invoices.retrieve).toHaveBeenCalledWith("in_renewal", {
        expand: ["payments"],
      })
      // Still on hold: only the payment going through lifts it, through the webhook.
      const membership = await db.membership.findUniqueOrThrow({
        where: { userId: user.id },
      })
      expect(membership.paymentStatus).toBe("PENDING")
    })

    /**
     * A renewal is charged on the subscription's own card before the customer's default,
     * and the retry named the default. With the two different, the app confirmed the
     * renewal with a card the bank had never challenged.
     */
    it("names the card the renewal was attempted with, not the customer's default", async () => {
      const user = await heldMember()
      stripeApi.invoices.pay.mockRejectedValue(
        await cardError("authentication_required", "This transaction requires authentication."),
      )
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_renewal",
        status: "requires_payment_method",
        client_secret: "pi_renewal_secret_abc",
        payment_method: null,
        last_payment_error: {
          code: "authentication_required",
          payment_method: { id: "pm_subscription_card" },
        },
      })

      const res = await retry(user.id)

      expect(res.status).toBe(402)
      expect(res.body.paymentMethodId).toBe("pm_subscription_card")
    })

    it("reads the card off a payment still waiting on the bank", async () => {
      const user = await heldMember()
      stripeApi.invoices.pay.mockRejectedValue(
        await cardError("invoice_payment_intent_requires_action", "This payment requires authentication."),
      )
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_renewal",
        status: "requires_action",
        client_secret: "pi_renewal_secret_abc",
        payment_method: "pm_subscription_card",
        last_payment_error: null,
      })

      const res = await retry(user.id)

      expect(res.status).toBe(402)
      expect(res.body.paymentMethodId).toBe("pm_subscription_card")
    })

    /** Any other card could take the money from somewhere the member did not expect. */
    it("does not guess a card when the payment names none", async () => {
      const user = await heldMember()
      stripeApi.invoices.pay.mockRejectedValue(
        await cardError("authentication_required", "This transaction requires authentication."),
      )
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_renewal",
        status: "requires_payment_method",
        client_secret: "pi_renewal_secret_abc",
        payment_method: null,
        last_payment_error: { code: "authentication_required" },
      })

      const res = await retry(user.id)

      expect(res.status).toBe(500)
      expect(res.body).toEqual({ message: "This transaction requires authentication." })
    })

    it("reports an ordinary decline with the card's own message", async () => {
      const user = await heldMember()
      stripeApi.invoices.pay.mockRejectedValue(
        await cardError("card_declined", "Your card has insufficient funds."),
      )
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_renewal",
        status: "requires_payment_method",
        client_secret: "pi_renewal_secret_abc",
        last_payment_error: { code: "card_declined", decline_code: "insufficient_funds" },
      })

      const res = await retry(user.id)

      expect(res.status).toBe(500)
      expect(res.body).toEqual({ message: "Your card has insufficient funds." })
    })
  })

  /**
   * The setup intent was taken on trust and its card made the caller's default, and the
   * whole payment method — cardholder name, billing address — went to the logs.
   */
  describe("setCardForMembershipPayments", () => {
    const setCard = (userId: string, setupIntentId: string) =>
      request(app)
        .post("/api/stripe/setCardForMembershipPayments")
        .set("Authorization", as(userId))
        .send({ setupIntentId })

    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      stripeApi.customers.update.mockResolvedValue({})
      logSpy = vi.spyOn(console, "log")
    })

    afterEach(() => {
      logSpy.mockRestore()
    })

    it("will not use another customer's setup intent", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.setupIntents.retrieve.mockResolvedValue({
        customer: "cus_someone_else",
        status: "succeeded",
        payment_method: "pm_theirs",
      })
      stripeApi.paymentMethods.retrieve.mockResolvedValue({
        id: "pm_theirs",
        customer: "cus_someone_else",
      })

      const res = await setCard(user.id, "seti_theirs")

      expect(res.status).toBe(404)
      expect(stripeApi.customers.update).not.toHaveBeenCalled()
    })

    it("will not use a setup intent that was never completed", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.setupIntents.retrieve.mockResolvedValue({
        customer: OWN_CUSTOMER,
        status: "requires_payment_method",
        payment_method: null,
      })

      const res = await setCard(user.id, "seti_unfinished")

      expect(res.status).toBe(404)
      expect(stripeApi.customers.update).not.toHaveBeenCalled()
    })

    it("answers a card removed since the sheet closed with a 404, not a 500", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.setupIntents.retrieve.mockResolvedValue({
        customer: OWN_CUSTOMER,
        status: "succeeded",
        payment_method: "pm_removed",
      })
      stripeApi.paymentMethods.retrieve.mockResolvedValue({
        id: "pm_removed",
        customer: null,
      })

      const res = await setCard(user.id, "seti_own")

      expect(res.status).toBe(404)
      expect(stripeApi.customers.update).not.toHaveBeenCalled()
    })

    it("answers a setup intent Stripe has never heard of with a 404", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.setupIntents.retrieve.mockRejectedValue(
        resourceMissing(await vi.importActual<typeof import("stripe")>("stripe")),
      )

      const res = await setCard(user.id, "seti_made_up")

      expect(res.status).toBe(404)
    })

    it("sets the customer's own card, without logging it", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.setupIntents.retrieve.mockResolvedValue({
        customer: OWN_CUSTOMER,
        status: "succeeded",
        payment_method: "pm_own",
      })
      stripeApi.paymentMethods.retrieve.mockResolvedValue({
        id: "pm_own",
        customer: OWN_CUSTOMER,
        billing_details: { name: "Distinctive Cardholder Name" },
      })

      const res = await setCard(user.id, "seti_own")

      expect(res.status).toBe(200)
      expect(stripeApi.customers.update).toHaveBeenCalledWith(OWN_CUSTOMER, {
        invoice_settings: { default_payment_method: "pm_own" },
      })
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(
        "Distinctive Cardholder Name",
      )
    })
  })

  /**
   * Ownership used to be checked on the order alone, after the Stripe lookup, with any
   * database error swallowed — so a payment with no order was always a 403, and a failed
   * order lookup returned the status of anybody's payment.
   */
  describe("checkPaymentStatus", () => {
    const check = (userId: string, paymentIntentId: string) =>
      request(app)
        .get(`/api/stripe/checkPaymentStatus/${paymentIntentId}`)
        .set("Authorization", as(userId))

    const makeOrderFor = (userId: string, paymentIntentId: string) =>
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
          appUserId: userId,
          paymentIntentId,
        },
      })

    it("will not report on another customer's payment", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_theirs",
        customer: "cus_someone_else",
        status: "succeeded",
      })

      const res = await check(user.id, "pi_theirs")

      expect(res.status).toBe(404)
      expect(res.body.success).toBeUndefined()
    })

    it("will not report on a payment whose order is someone else's", async () => {
      const user = await makeUser()
      const other = await makeUser()
      await withStripeCustomer(user.id)
      await makeOrderFor(other.id, "pi_their_order")
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_their_order",
        // Even naming this customer: the order settles whose payment it is.
        customer: OWN_CUSTOMER,
        status: "succeeded",
      })

      const res = await check(user.id, "pi_their_order")

      expect(res.status).toBe(404)
    })

    it("answers a payment Stripe has never heard of with a 404", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.paymentIntents.retrieve.mockRejectedValue(
        resourceMissing(await vi.importActual<typeof import("stripe")>("stripe")),
      )

      const res = await check(user.id, "pi_made_up")

      expect(res.status).toBe(404)
    })

    /** The checkout recovery path that could never run: paid, but no order yet. */
    it("reports the customer's own payment before its order exists", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_own",
        customer: OWN_CUSTOMER,
        status: "succeeded",
      })

      const res = await check(user.id, "pi_own")

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        success: true,
        refunded: false,
        authorised: false,
        released: false,
        pending: false,
        orderId: null,
      })
    })

    /**
     * A hold waiting for its order. It used to be reported as "pending", which the app took
     * as a payment still processing — so a customer whose order had dropped was left watching
     * a spinner with nothing to retry.
     */
    it("reports a hold as authorised, so the app can place its order again", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_held",
        customer: OWN_CUSTOMER,
        status: "requires_capture",
      })

      const res = await check(user.id, "pi_held")

      expect(res.body).toEqual({
        success: false,
        refunded: false,
        authorised: true,
        released: false,
        pending: false,
        orderId: null,
      })
    })

    it("reports a hold that was let go as released", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_released",
        customer: OWN_CUSTOMER,
        status: "canceled",
      })

      const res = await check(user.id, "pi_released")

      expect(res.body).toMatchObject({
        success: false,
        authorised: false,
        released: true,
      })
    })

    /**
     * createOrder refunds a payment that no longer matches the cart, and a refunded payment
     * still reads "succeeded" — which the app would have shown as "your payment was
     * processed, but we couldn't send your order to the kitchen".
     */
    it("reports a refunded payment as not paid", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_refunded",
        customer: OWN_CUSTOMER,
        status: "succeeded",
        latest_charge: { id: "ch_refunded", amount_refunded: 1200 },
      })

      const res = await check(user.id, "pi_refunded")

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        success: false,
        refunded: true,
        authorised: false,
        released: false,
        pending: false,
        orderId: null,
      })
      expect(stripeApi.paymentIntents.retrieve).toHaveBeenCalledWith("pi_refunded", {
        expand: ["latest_charge"],
      })
    })

    it("reports the customer's own order", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      const order = await makeOrderFor(user.id, "pi_own_order")
      stripeApi.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_own_order",
        customer: OWN_CUSTOMER,
        status: "processing",
      })

      const res = await check(user.id, "pi_own_order")

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        success: false,
        refunded: false,
        authorised: false,
        released: false,
        pending: true,
        orderId: order.id,
      })
    })
  })

  /**
   * Customers were created with the name and email in metadata only, which the Stripe
   * Dashboard does not show, so every app payment appeared there with no one against it.
   */
  describe("the Stripe customer's details", () => {
    const listCards = (userId: string) =>
      request(app).get("/api/stripe/paymentMethods").set("Authorization", as(userId))

    beforeEach(() => {
      stripeApi.paymentMethods.list.mockResolvedValue({ data: [] })
    })

    it("gives a new customer the user's name, email and phone", async () => {
      const user = await makeUser()
      stripeApi.customers.create.mockResolvedValue({
        id: "cus_created",
        email: null,
        name: null,
        phone: null,
      })

      const res = await listCards(user.id)

      expect(res.status).toBe(200)
      expect(stripeApi.customers.create).toHaveBeenCalledWith({
        metadata: { userId: user.id },
      })
      expect(stripeApi.customers.update).toHaveBeenCalledWith("cus_created", {
        email: user.email,
        name: "Ada Lovelace",
        phone: "0211234567",
      })
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: user.id } })).stripeCustomerId,
      ).toBe("cus_created")
    })

    it("fills in a customer created before it carried any details", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      stripeApi.customers.retrieve.mockResolvedValue({
        id: OWN_CUSTOMER,
        email: null,
        name: null,
        phone: null,
        metadata: { userId: user.id, name: "Ada Lovelace" },
      })

      const res = await listCards(user.id)

      expect(res.status).toBe(200)
      expect(stripeApi.customers.update).toHaveBeenCalledWith(OWN_CUSTOMER, {
        email: user.email,
        name: "Ada Lovelace",
        phone: "0211234567",
      })
    })

    it("follows a change of phone number", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)
      await db.user.update({ where: { id: user.id }, data: { phone: "0229876543" } })

      await listCards(user.id)

      expect(stripeApi.customers.update).toHaveBeenCalledWith(OWN_CUSTOMER, {
        phone: "0229876543",
      })
    })

    it("leaves a customer that is up to date alone", async () => {
      const user = await makeUser()
      await withStripeCustomer(user.id)

      const res = await listCards(user.id)

      expect(res.status).toBe(200)
      expect(stripeApi.customers.update).not.toHaveBeenCalled()
    })

    // `withStripeCustomer` hard-coded the factory's name, so any test giving a user another
    // one found its "up to date" customer stale and tripped a sync update it did not expect.
    it("treats a customer set up for a renamed user as up to date", async () => {
      const user = await makeUser()
      await db.user.update({
        where: { id: user.id },
        data: { firstName: "Grace", lastName: "Hopper" },
      })
      await withStripeCustomer(user.id)

      const res = await listCards(user.id)

      expect(res.status).toBe(200)
      expect(stripeApi.customers.update).not.toHaveBeenCalled()
    })

    // The details only label payments; a refusal must not cost the customer a payment.
    it.each([["an existing customer"], ["a new customer"]])(
      "carries on when Stripe refuses the details of %s",
      async (which) => {
        const user = await makeUser()
        if (which === "an existing customer") {
          await withStripeCustomer(user.id)
          await db.user.update({ where: { id: user.id }, data: { phone: "0229876543" } })
        } else {
          stripeApi.customers.create.mockResolvedValue({ id: "cus_created" })
        }
        stripeApi.customers.update.mockRejectedValue(new Error("refused"))
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

        const res = await listCards(user.id)

        errorSpy.mockRestore()
        expect(res.status).toBe(200)
        expect(stripeApi.paymentMethods.list).toHaveBeenCalled()
      },
    )
  })
})
