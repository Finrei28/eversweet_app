import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"
import { randomUUID } from "crypto"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeDessert, makeUser, nextOpenPickUpTime } from "../test/factories"
import {
  resetStripeStub,
  resourceMissing,
  stripeApi,
} from "../test/stripeStub"
import EmailSender from "../lib/emailSender"
import { membershipPlanName } from "../lib/membership"

vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

// Never the real SDK: see test/stripeStub.
vi.mock("stripe", async (importOriginal) =>
  (await import("../test/stripeStub.js")).fakeStripeModule(await importOriginal()),
)

// Nothing here may reach Resend. The welcome email's element is replaced by its props, so a
// test can read what it would have said.
vi.mock("../lib/emailSender", () => ({
  default: vi.fn(async () => ({ data: { id: "email_test" }, error: null })),
}))
vi.mock("../email/membershipWelcome", () => ({
  default: (props: Record<string, unknown>) => ({ props }),
}))
vi.mock("../email/orderConfirmation", () => ({ default: () => null }))

const WEBHOOK_SECRET = "whsec_membership_cart"
const SUBSCRIPTION = "sub_member"
const PERIOD_END = Math.floor(Date.UTC(2026, 9, 25) / 1000)
const HOUR = 60 * 60 * 1000

const sentEmails = () => vi.mocked(EmailSender).mock.calls
const welcomeEmails = () =>
  sentEmails().filter(([, subject]) => subject === "Welcome to Eversweet membership")

// ---- Stripe events, in the webhook endpoint's own format ----

const deliver = async (event: Record<string, unknown>) => {
  const actual = await vi.importActual<typeof import("stripe")>("stripe")
  const payload = JSON.stringify(event)
  return request(app)
    .post("/api/stripe/webhook")
    .set(
      "stripe-signature",
      actual.Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: WEBHOOK_SECRET,
      }),
    )
    .set("Content-Type", "application/json")
    .send(payload)
}

const raisedIn = (month: number) => Math.floor(Date.UTC(2026, month, 14) / 1000)

const paymentSucceeded = (
  invoiceId: string,
  billingReason: string,
  created: number,
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
      amount_paid: 999,
      lines: { data: [{ subscription: SUBSCRIPTION }] },
    },
  },
})

const renewalDeclined = () => ({
  id: "evt_declined",
  object: "event",
  type: "invoice.payment_failed",
  data: {
    object: {
      id: "in_renewal",
      object: "invoice",
      billing_reason: "subscription_cycle",
      lines: { data: [{ subscription: SUBSCRIPTION }] },
    },
  },
})

const subscriptionDeleted = () => ({
  id: "evt_deleted",
  object: "event",
  type: "customer.subscription.deleted",
  data: {
    object: {
      id: SUBSCRIPTION,
      object: "subscription",
      status: "canceled",
      ended_at: PERIOD_END,
      cancellation_details: { reason: "cancellation_requested" },
    },
  },
})

const subscriptionCancelling = () => ({
  id: "evt_cancelling",
  object: "event",
  type: "customer.subscription.updated",
  data: { object: { id: SUBSCRIPTION, object: "subscription" } },
})

const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: SUBSCRIPTION,
  status: "active",
  cancel_at_period_end: false,
  metadata: {},
  items: { data: [{ current_period_end: PERIOD_END }] },
  ...overrides,
})

/** Stripe's list of the subscription's paid monthly invoices, newest first. */
const paidMonths = (count: number) => ({
  data: Array.from({ length: count }, (_, i) => ({
    id: `in_month_${i}`,
    billing_reason: i === 0 ? "subscription_create" : "subscription_cycle",
    status: "paid",
    created: raisedIn(6 + i),
  })).reverse(),
  has_more: false,
})

/** Stripe says the first payment has gone through, and lists `months` paid in a row. */
const stripeSaysPaid = (months: number, subscriptionOverrides = {}) => {
  stripeApi.subscriptions.retrieve.mockResolvedValue(
    subscription(subscriptionOverrides),
  )
  stripeApi.invoices.list.mockResolvedValue(paidMonths(months))
}

/** The delivered event for the newest of `months` paid months. */
const newestPayment = (months: number) =>
  paymentSucceeded(
    `in_month_${months - 1}`,
    months === 1 ? "subscription_create" : "subscription_cycle",
    raisedIn(6 + months - 1),
  )

/** Stripe says the renewal was declined and is being retried. */
const stripeSaysDeclined = () => {
  stripeApi.subscriptions.retrieve.mockResolvedValue(
    subscription({ status: "past_due" }),
  )
  stripeApi.invoices.retrieve.mockResolvedValue({
    id: "in_renewal",
    status: "open",
    payments: {
      data: [{ payment: { type: "payment_intent", payment_intent: "pi_declined" } }],
    },
  })
  stripeApi.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_declined",
    last_payment_error: { code: "card_declined", message: "Declined." },
  })
}

// ---- Fixtures ----

const makePlan = () =>
  db.membershipPlan.create({
    data: {
      name: membershipPlanName(),
      stripePriceId: "price_plan",
      membershipDiscount: 5,
      maxDiscount: 25,
    },
  })

const makeMembership = async (
  userId: string,
  data: Record<string, unknown> = {},
) => {
  const plan = await makePlan()
  return db.membership.create({
    data: {
      userId,
      planId: plan.id,
      endDate: new Date(PERIOD_END * 1000),
      isActive: true,
      paymentStatus: "SUCCESS",
      stripeSubscriptionId: SUBSCRIPTION,
      totalMonths: 1,
      ...data,
    },
  })
}

/** A new member mid-join: the claim createMembership leaves while Stripe charges. */
const joining = (userId: string) =>
  makeMembership(userId, {
    isActive: false,
    paymentStatus: "PENDING",
    totalMonths: 0,
  })

const makeTopping = (priceInCents = 150) =>
  db.ingredient.create({
    data: { name: `Topping ${randomUUID()}`, chineseName: "配料", priceInCents },
  })

const addItem = (userId: string, body: Record<string, unknown>) =>
  request(app)
    .post("/api/cart/addItemToCart")
    .set("Authorization", `Bearer ${tokenFor(userId)}`)
    .send({ quantity: 1, customisations: [], ...body })

const topping = (id: string, priceInCents = 150) => ({
  id,
  name: "ignored",
  chineseName: "ignored",
  quantity: 1,
  priceInCents,
  discountedAmountInCents: 0,
})

const loadCart = (userId: string) =>
  request(app)
    .get("/api/cart/getCartItems")
    .set("Authorization", `Bearer ${tokenFor(userId)}`)

const linesOf = (userId: string) =>
  db.cartItem.findMany({
    where: { cart: { userId } },
    include: { customisations: true },
    orderBy: { createdAt: "asc" },
  })

/** A $12 dessert with a $1.50 topping in the customer's cart, added through the API. */
const cartWithToppedDessert = async (userId: string) => {
  const dessert = await makeDessert(1200)
  const extra = await makeTopping(150)
  const res = await addItem(userId, {
    dessertId: dessert.id,
    itemPriceInCents: 1200,
    customisations: [topping(extra.id)],
  })
  expect(res.status).toBe(201)
  return res.body.cartItem.id as string
}

/** A free members-only offer line - the weekly bowl - already in the cart, with its use held. */
const memberOnlyLine = async (userId: string, { limit = 1, used = 1 } = {}) => {
  const dessert = await makeDessert(999)
  const offer = await db.offer.create({
    data: {
      name: "Free weekly bowl",
      audience: "MEMBERS",
      dessertId: dessert.id,
      itemPriceInCents: 0,
      limit,
    },
  })
  await db.offerRedemption.create({
    data: { offerId: offer.id, userId, used, status: used >= limit ? "REDEEMED" : "AVAILABLE" },
  })
  const cart = await db.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
  })
  await db.cartItem.create({
    data: {
      cartId: cart.id,
      dessertId: dessert.id,
      offerId: offer.id,
      itemPriceInCents: 999,
      discountedAmountInCents: 999,
      quantity: 1,
    },
  })
  return offer
}

const redemptionOf = (offerId: string, userId: string) =>
  db.offerRedemption.findUniqueOrThrow({
    where: { offerId_userId: { offerId, userId } },
  })

describeIfDb("membership and the cart", () => {
  const previousSecret = process.env.STRIPE_WEBHOOK_SECRET

  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
    resetStripeStub()
    vi.mocked(EmailSender).mockClear()
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = previousSecret
    vi.restoreAllMocks()
  })

  describe("joining", () => {
    it("puts the member price on what is already in the cart", async () => {
      const user = await makeUser()
      await cartWithToppedDessert(user.id)
      await joining(user.id)
      stripeSaysPaid(1)

      const res = await deliver(newestPayment(1))

      expect(res.status).toBe(200)
      const [line] = await linesOf(user.id)
      // 5% of $12, and of the $1.50 topping - 7.5c, rounded to a whole cent.
      expect(line.discountedAmountInCents).toBe(60)
      expect(line.customisations[0].discountedAmountInCents).toBe(8)
    })

    it("leaves an offer's price and a reward alone", async () => {
      const user = await makeUser()
      const dessert = await makeDessert(1200)
      const offer = await db.offer.create({
        data: {
          name: "Open offer",
          audience: "EVERYONE",
          dessertId: dessert.id,
          itemPriceInCents: 500,
          limit: 2,
        },
      })
      expect(
        (await addItem(user.id, { dessertId: dessert.id, itemPriceInCents: 1200, offerId: offer.id }))
          .status,
      ).toBe(201)
      const reward = await db.dessert.update({
        where: { id: (await makeDessert(900)).id },
        data: { priceInLoyaltyPoints: 300 },
      })
      await db.loyalty.create({ data: { userId: user.id, points: 1000 } })
      expect(
        (await addItem(user.id, { dessertId: reward.id, itemPriceInCents: 900, loyaltyPointsUsed: 300 }))
          .status,
      ).toBe(201)
      await joining(user.id)
      stripeSaysPaid(1)

      await deliver(newestPayment(1))

      const [offerLine, rewardLine] = await linesOf(user.id)
      expect(offerLine.discountedAmountInCents).toBe(700)
      expect(rewardLine.discountedAmountInCents).toBe(0)
    })

    it("sends one welcome email, however many times Stripe delivers the payment", async () => {
      const user = await makeUser()
      await cartWithToppedDessert(user.id)
      await joining(user.id)
      stripeSaysPaid(1)

      for (let delivery = 0; delivery < 3; delivery++) {
        expect((await deliver(newestPayment(1))).status).toBe(200)
      }

      expect(welcomeEmails()).toHaveLength(1)
      const [to, , element] = welcomeEmails()[0]
      expect(to).toBe(user.email)
      expect((element as unknown as { props: Record<string, unknown> }).props).toMatchObject({
        firstName: "Ada",
        amountPaidInCents: 999,
        discountPercent: 5,
        stepPercent: 5,
        maxDiscountPercent: 25,
        cartRepriced: true,
        renewsOn: new Date(PERIOD_END * 1000),
      })
    })

    it("welcomes a member whose payment beat their subscription id", async () => {
      const user = await makeUser()
      await makeMembership(user.id, {
        isActive: false,
        paymentStatus: "PENDING",
        stripeSubscriptionId: null,
        totalMonths: 0,
      })
      stripeSaysPaid(1, { metadata: { userId: user.id } })

      await deliver(newestPayment(1))
      await deliver(newestPayment(1))

      expect(welcomeEmails()).toHaveLength(1)
      expect(
        (welcomeEmails()[0][2] as unknown as { props: { cartRepriced: boolean } }).props
          .cartRepriced,
      ).toBe(false)
    })

    it("does not welcome an existing member on renewal", async () => {
      const user = await makeUser()
      await makeMembership(user.id)
      stripeSaysPaid(2)

      await deliver(newestPayment(2))

      expect(welcomeEmails()).toHaveLength(0)
    })

    it("still answers Stripe when the email cannot be sent", async () => {
      const user = await makeUser()
      await joining(user.id)
      stripeSaysPaid(1)
      vi.mocked(EmailSender).mockRejectedValueOnce(new Error("Resend is down"))

      const res = await deliver(newestPayment(1))

      expect(res.status).toBe(200)
      expect(
        await db.membership.findUniqueOrThrow({ where: { userId: user.id } }),
      ).toMatchObject({ isActive: true, paymentStatus: "SUCCESS" })
    })
  })

  describe("while a member", () => {
    it("steps the discount up when a renewal is paid", async () => {
      const user = await makeUser()
      await makeMembership(user.id, { totalMonths: 1 })
      await cartWithToppedDessert(user.id)
      expect((await linesOf(user.id))[0].discountedAmountInCents).toBe(60)
      stripeSaysPaid(2)

      await deliver(newestPayment(2))

      const [line] = await linesOf(user.id)
      expect(line.discountedAmountInCents).toBe(120)
      expect(line.customisations[0].discountedAmountInCents).toBe(15)
    })

    it("keeps member prices when the member taps Cancel, until the period ends", async () => {
      const user = await makeUser()
      await makeMembership(user.id)
      await cartWithToppedDessert(user.id)
      stripeApi.subscriptions.retrieve.mockResolvedValue(
        subscription({ cancel_at_period_end: true, cancel_at: PERIOD_END }),
      )

      await deliver(subscriptionCancelling())

      expect((await linesOf(user.id))[0].discountedAmountInCents).toBe(60)
    })
  })

  describe("a renewal declined and on hold", () => {
    it("takes member prices off the cart", async () => {
      const user = await makeUser()
      await makeMembership(user.id)
      await cartWithToppedDessert(user.id)
      stripeSaysDeclined()

      await deliver(renewalDeclined())

      const [line] = await linesOf(user.id)
      expect(line.discountedAmountInCents).toBe(0)
      expect(line.customisations[0].discountedAmountInCents).toBe(0)
    })

    it("takes member-only items out and hands their use back, once", async () => {
      const user = await makeUser()
      await makeMembership(user.id)
      const offer = await memberOnlyLine(user.id, { limit: 2, used: 2 })
      stripeSaysDeclined()

      await deliver(renewalDeclined())
      await deliver(renewalDeclined())

      expect(await linesOf(user.id)).toHaveLength(0)
      // One line held one use. A second delivery must not hand back another.
      expect(await redemptionOf(offer.id, user.id)).toMatchObject({
        used: 1,
        status: "AVAILABLE",
      })
    })

    it("puts member prices back when the retry is paid", async () => {
      const user = await makeUser()
      await makeMembership(user.id)
      await cartWithToppedDessert(user.id)
      stripeSaysDeclined()
      await deliver(renewalDeclined())
      stripeSaysPaid(2)

      await deliver(newestPayment(2))

      expect((await linesOf(user.id))[0].discountedAmountInCents).toBe(120)
      // Still the same membership: a paid retry is not a welcome.
      expect(welcomeEmails()).toHaveLength(0)
    })

    it("sweeps a member-only item when the cart is loaded", async () => {
      const user = await makeUser()
      await makeMembership(user.id, { paymentStatus: "PENDING" })
      await memberOnlyLine(user.id)

      const res = await loadCart(user.id)

      expect(res.status).toBe(200)
      expect(res.body.cartItems).toHaveLength(0)
      expect(res.body.warning).toMatch(/requires an active membership/)
    })
  })

  describe("a membership that ends", () => {
    it("takes member prices off but keeps a running promotion's", async () => {
      const user = await makeUser()
      await makeMembership(user.id)
      await cartWithToppedDessert(user.id)
      const promoted = await makeDessert(1000)
      await db.dessert.update({
        where: { id: promoted.id },
        data: { promo: { create: { name: "Ten off", type: "PERCENTAGE", value: 10 } } },
      })
      expect((await addItem(user.id, { dessertId: promoted.id, itemPriceInCents: 1000 })).status).toBe(201)

      await deliver(subscriptionDeleted())

      const [plain, promoLine] = await linesOf(user.id)
      expect(plain.discountedAmountInCents).toBe(0)
      expect(plain.customisations[0].discountedAmountInCents).toBe(0)
      expect(promoLine.discountedAmountInCents).toBe(100)
    })
  })

  describe("loading the cart", () => {
    it("corrects discounts the webhook never reached, and says so", async () => {
      const user = await makeUser()
      const lineId = await cartWithToppedDessert(user.id)
      // Switched on with no webhook: the one that should have repriced the cart failed.
      await makeMembership(user.id)

      const res = await loadCart(user.id)

      expect(res.status).toBe(200)
      const line = res.body.cartItems.find((item: { id: string }) => item.id === lineId)
      expect(line.discountedAmountInCents).toBe(60)
      expect(line.customisations[0].discountedAmountInCents).toBe(8)
      // The customisation keeps the ingredient's id on the wire, as installed builds expect.
      expect(line.customisations[0].priceInCents).toBe(150)
      expect(res.body.warning).toBe("Prices in your cart have been updated.")
    })

    it("says nothing when the cart is already right", async () => {
      const user = await makeUser()
      await makeMembership(user.id)
      await cartWithToppedDessert(user.id)

      const res = await loadCart(user.id)

      expect(res.body.warning).toBeNull()
    })

    it("stops a promotion that has ended from discounting a line added while it ran", async () => {
      const user = await makeUser()
      const dessert = await makeDessert(1000)
      const updated = await db.dessert.update({
        where: { id: dessert.id },
        data: { promo: { create: { name: "Daily special", type: "PERCENTAGE", value: 20 } } },
        select: { promoId: true },
      })
      await addItem(user.id, { dessertId: dessert.id, itemPriceInCents: 1000 })
      expect((await linesOf(user.id))[0].discountedAmountInCents).toBe(200)
      await db.promo.update({
        where: { id: updated.promoId! },
        data: { endsAt: new Date(Date.now() - HOUR) },
      })

      await loadCart(user.id)

      expect((await linesOf(user.id))[0].discountedAmountInCents).toBe(0)
    })
  })

  describe("adding to the cart", () => {
    it("adds a member's topping whose discount is not a whole cent", async () => {
      const user = await makeUser()
      await makeMembership(user.id)

      const lineId = await cartWithToppedDessert(user.id)

      const [line] = await linesOf(user.id)
      expect(line.id).toBe(lineId)
      expect(line.customisations[0].discountedAmountInCents).toBe(8)
    })

    it("gives no discount for a promotion that has been switched off", async () => {
      const user = await makeUser()
      const dessert = await makeDessert(1000)
      await db.dessert.update({
        where: { id: dessert.id },
        data: {
          promo: {
            create: { name: "Paused", type: "PERCENTAGE", value: 20, isActive: false },
          },
        },
      })

      await addItem(user.id, { dessertId: dessert.id, itemPriceInCents: 1000 })

      expect((await linesOf(user.id))[0].discountedAmountInCents).toBe(0)
    })

    it("never takes a fixed-amount promotion past the price", async () => {
      const user = await makeUser()
      const dessert = await makeDessert(300)
      await db.dessert.update({
        where: { id: dessert.id },
        data: { promo: { create: { name: "Five off", type: "FIXED_AMOUNT", value: 500 } } },
      })

      await addItem(user.id, { dessertId: dessert.id, itemPriceInCents: 300 })

      expect((await linesOf(user.id))[0].discountedAmountInCents).toBe(300)
    })

    it("gives a member on hold no member price", async () => {
      const user = await makeUser()
      await makeMembership(user.id, { paymentStatus: "PENDING" })

      await cartWithToppedDessert(user.id)

      const [line] = await linesOf(user.id)
      expect(line.discountedAmountInCents).toBe(0)
      expect(line.customisations[0].discountedAmountInCents).toBe(0)
    })
  })

  describe("checking out while on hold", () => {
    const placeOrder = (userId: string, paymentIntentId: string | null = null) =>
      request(app)
        .post("/api/auth/createOrder")
        .set("Authorization", `Bearer ${tokenFor(userId)}`)
        .set("Idempotency-Key", randomUUID())
        .send({
          pickupNow: false,
          pickUpTime: nextOpenPickUpTime().toISOString(),
          eatIn: false,
          paymentIntentId,
          paymentMethodId: paymentIntentId ? "pm_test" : null,
        })

    it("refuses a free member-only item, which needs no card", async () => {
      const user = await makeUser()
      await makeMembership(user.id, { paymentStatus: "PENDING" })
      const offer = await memberOnlyLine(user.id)

      const res = await placeOrder(user.id)

      expect(res.status).toBe(409)
      expect(res.body.message).toMatch(/only for members/)
      expect(await db.order.count()).toBe(0)
      expect((await redemptionOf(offer.id, user.id)).used).toBe(1)
    })

    it("refuses a member-only item before the card is touched", async () => {
      const user = await makeUser()
      await makeMembership(user.id, { paymentStatus: "PENDING" })
      await memberOnlyLine(user.id)
      await cartWithToppedDessert(user.id)

      const res = await request(app)
        .post("/api/stripe/createPaymentIntent")
        .set("Authorization", `Bearer ${tokenFor(user.id)}`)
        .send({
          amount: 1350,
          authoriseOnly: true,
          pickUpTime: nextOpenPickUpTime().toISOString(),
          eatIn: false,
        })

      expect(res.status).toBe(409)
      expect(res.body.message).toMatch(/only for members/)
      expect(stripeApi.paymentIntents.create).not.toHaveBeenCalled()
      expect(stripeApi.customers.create).not.toHaveBeenCalled()
    })

    it("lets the hold go rather than capture it", async () => {
      const user = await makeUser()
      await db.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: `cus_${user.id}` },
      })
      await makeMembership(user.id, { paymentStatus: "PENDING" })
      await memberOnlyLine(user.id)
      await cartWithToppedDessert(user.id)
      const intent: Record<string, unknown> = {
        id: "pi_on_hold",
        status: "requires_capture",
        amount_capturable: 1350,
        amount_received: 0,
        currency: "nzd",
        customer: `cus_${user.id}`,
        metadata: { purpose: "app_order", userId: user.id },
        latest_charge: { id: "ch_on_hold", amount_refunded: 0 },
      }
      const actual = await vi.importActual<typeof import("stripe")>("stripe")
      stripeApi.paymentIntents.retrieve.mockImplementation(async (id: string) => {
        if (id !== "pi_on_hold") throw resourceMissing(actual)
        return intent
      })
      stripeApi.paymentIntents.cancel.mockImplementation(async () => {
        Object.assign(intent, { status: "canceled", amount_capturable: 0 })
        return intent
      })

      const res = await placeOrder(user.id, "pi_on_hold")

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ released: true })
      expect(res.body.message).toMatch(/haven't been charged/)
      expect(stripeApi.paymentIntents.cancel).toHaveBeenCalledTimes(1)
      expect(stripeApi.paymentIntents.capture).not.toHaveBeenCalled()
      expect(await db.order.count()).toBe(0)
    })

    /**
     * The membership was read before the order's transaction, so a renewal declined while
     * the order was being placed went unseen: the member-only item was bought by someone
     * no longer paid up. It is read under a lock inside the transaction now, so a decline
     * already being written is waited for and then seen.
     */
    it("sees a renewal declined while the order is being placed", async () => {
      const user = await makeUser()
      await makeMembership(user.id)
      await memberOnlyLine(user.id)

      let commitDecline!: () => void
      const declineHeld = new Promise<void>((resolve) => (commitDecline = resolve))
      let declineWritten!: () => void
      const declineStarted = new Promise<void>((resolve) => (declineWritten = resolve))

      // The webhook's write, made and held uncommitted.
      const decline = db.$transaction(
        async (tx) => {
          await tx.membership.update({
            where: { userId: user.id },
            data: { paymentStatus: "PENDING" },
          })
          declineWritten()
          await declineHeld
        },
        { timeout: 20_000, maxWait: 10_000 },
      )
      await declineStarted

      // `.then` sends it now: supertest sends nothing until it is awaited, which would have
      // placed the order after the decline had already committed.
      const order = placeOrder(user.id).then((res) => res)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      commitDecline()
      await decline

      const res = await order
      expect(res.status).toBe(409)
      expect(res.body.message).toMatch(/only for members/)
      expect(await db.order.count()).toBe(0)
    })

    it("refuses to hold a card for a member price the membership no longer gives", async () => {
      const user = await makeUser()
      await makeMembership(user.id)
      await cartWithToppedDessert(user.id)
      // On hold with no webhook reprice: the one that should have run failed.
      await db.membership.update({
        where: { userId: user.id },
        data: { paymentStatus: "PENDING" },
      })

      const res = await request(app)
        .post("/api/stripe/createPaymentIntent")
        .set("Authorization", `Bearer ${tokenFor(user.id)}`)
        .send({
          // The stale total the app was showing: $12 + $1.50, less 60c and 8c.
          amount: 1282,
          authoriseOnly: true,
          pickUpTime: nextOpenPickUpTime().toISOString(),
          eatIn: false,
        })

      expect(res.status).toBe(409)
      expect(res.body.message).toMatch(/Prices in your cart have changed/)
      expect(stripeApi.paymentIntents.create).not.toHaveBeenCalled()
      // Corrected, so the reload the app does next shows the right total.
      const [line] = await linesOf(user.id)
      expect(line.discountedAmountInCents).toBe(0)
      expect(line.customisations[0].discountedAmountInCents).toBe(0)
    })

    it("lets a hold go when a promotion ended after the card was held", async () => {
      const user = await makeUser()
      await db.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: `cus_${user.id}` },
      })
      const dessert = await makeDessert(1000)
      const { promoId } = await db.dessert.update({
        where: { id: dessert.id },
        data: { promo: { create: { name: "Daily special", type: "PERCENTAGE", value: 20 } } },
        select: { promoId: true },
      })
      await addItem(user.id, { dessertId: dessert.id, itemPriceInCents: 1000 })
      const intent: Record<string, unknown> = {
        id: "pi_promo",
        status: "requires_capture",
        amount_capturable: 800,
        amount_received: 0,
        currency: "nzd",
        customer: `cus_${user.id}`,
        metadata: { purpose: "app_order", userId: user.id },
        latest_charge: { id: "ch_promo", amount_refunded: 0 },
      }
      stripeApi.paymentIntents.retrieve.mockResolvedValue(intent)
      stripeApi.paymentIntents.cancel.mockResolvedValue({ ...intent, status: "canceled" })
      await db.promo.update({
        where: { id: promoId! },
        data: { endsAt: new Date(Date.now() - HOUR) },
      })

      const res = await placeOrder(user.id, "pi_promo")

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ released: true })
      expect(res.body.message).toMatch(/Prices in your cart have changed/)
      expect(stripeApi.paymentIntents.capture).not.toHaveBeenCalled()
      expect(await db.order.count()).toBe(0)
    })

    it("earns the ordinary points rate, not the member rate", async () => {
      const user = await makeUser()
      await db.loyalty.create({ data: { userId: user.id, points: 0 } })
      await makeMembership(user.id, { paymentStatus: "PENDING" })
      const dessert = await makeDessert(1000)
      await db.cart.create({
        data: {
          userId: user.id,
          cartItems: {
            create: { dessertId: dessert.id, itemPriceInCents: 1000, quantity: 1 },
          },
        },
      })
      await db.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: `cus_${user.id}` },
      })
      const intent: Record<string, unknown> = {
        id: "pi_rate",
        status: "requires_capture",
        amount_capturable: 1000,
        amount_received: 0,
        currency: "nzd",
        customer: `cus_${user.id}`,
        metadata: { purpose: "app_order", userId: user.id },
        latest_charge: { id: "ch_rate", amount_refunded: 0 },
      }
      stripeApi.paymentIntents.retrieve.mockResolvedValue(intent)
      stripeApi.paymentIntents.capture.mockResolvedValue({ ...intent, status: "succeeded" })

      const res = await placeOrder(user.id, "pi_rate")

      expect(res.status).toBe(201)
      const earned = await db.loyaltyRecord.findFirstOrThrow({
        where: { reason: "EARNED" },
      })
      // $10 at the default rate of 6 per dollar. A paid-up member would earn 1.5x: 90.
      expect(earned.change).toBe(60)
    })
  })
})
