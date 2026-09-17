import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"
import { Prisma } from "@prisma/client"
import { randomUUID } from "crypto"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import {
  makeCart,
  makeCustomerWithCart,
  makeDessert,
  makeUser,
  nextOpenPickUpTime,
} from "../test/factories"
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

// Never the real SDK: see test/stripeStub. Every payment below is one these tests made up.
vi.mock("stripe", async (importOriginal) =>
  (await import("../test/stripeStub.js")).fakeStripeModule(await importOriginal()),
)

// The two pieces of the flow that leave the process. Neither is what these
// tests are about, and both would need credentials to run.
vi.mock("../lib/emailSender", () => ({ default: vi.fn(async () => {}) }))
vi.mock("../email/orderConfirmation", () => ({ default: () => null }))

const ORDERS = "/api/auth/createOrder"

const placeOrder = (
  userId: string,
  {
    paymentIntentId = null,
    idempotencyKey = randomUUID(),
    body = {},
  }: {
    paymentIntentId?: string | null
    idempotencyKey?: string
    body?: Record<string, unknown>
  } = {},
) =>
  request(app)
    .post(ORDERS)
    .set("Authorization", `Bearer ${tokenFor(userId)}`)
    .set("Idempotency-Key", idempotencyKey)
    .send({
      pickupNow: false,
      pickUpTime: nextOpenPickUpTime().toISOString(),
      eatIn: false,
      paymentIntentId,
      paymentMethodId: paymentIntentId ? "pm_test" : null,
      ...body,
    })

/** The payments Stripe knows about in this test, by id. */
const intents = new Map<string, Record<string, unknown>>()

const customerOf = (userId: string) => `cus_${userId}`

/**
 * What a real checkout leaves behind: a completed payment of `cents`, on this customer,
 * made by createPaymentIntent for their order. Overrides describe everything else a
 * payment can be.
 */
const payFor = async (
  userId: string,
  paymentIntentId: string,
  cents: number,
  overrides: Record<string, unknown> = {},
) => {
  await db.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customerOf(userId) },
  })

  intents.set(paymentIntentId, {
    id: paymentIntentId,
    object: "payment_intent",
    status: "succeeded",
    amount: cents,
    amount_received: cents,
    currency: "nzd",
    customer: customerOf(userId),
    metadata: { purpose: "app_order", userId },
    latest_charge: { id: `ch_${paymentIntentId}`, amount_refunded: 0 },
    ...overrides,
  })
}

describeIfDb("POST /api/auth/createOrder", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
    resetStripeStub()
    intents.clear()

    const actual = await vi.importActual<typeof import("stripe")>("stripe")
    stripeApi.paymentIntents.retrieve.mockImplementation(async (id: string) => {
      const intent = intents.get(id)
      if (!intent) throw resourceMissing(actual)
      return intent
    })
    stripeApi.refunds.create.mockResolvedValue({ id: "re_test" })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await db.$disconnect()
  })

  it("requires authentication", async () => {
    const res = await request(app).post(ORDERS).send({})
    expect(res.status).toBe(401)
  })

  it("creates the order, prices it from the cart, and empties the cart", async () => {
    const { user } = await makeCustomerWithCart({
      itemPriceInCents: 1200,
      quantity: 2,
    })
    await payFor(user.id, "pi_basic", 2400)

    const res = await placeOrder(user.id, { paymentIntentId: "pi_basic" })

    expect(res.status).toBe(201)
    expect(res.body.order.priceInCents).toBe(2400)
    expect(res.body.order.status).toBe("PENDING")

    expect(await db.order.count()).toBe(1)
    expect(await db.cart.count({ where: { userId: user.id } })).toBe(0)
  })

  it("never lets a client name its own price", async () => {
    const { user } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
    await payFor(user.id, "pi_cheeky", 1200)

    const res = await placeOrder(user.id, {
      paymentIntentId: "pi_cheeky",
      // A modified client naming a total of one cent.
      body: { priceInCents: 1, discountedAmountInCents: 1199 },
    })

    expect(res.status).toBe(201)
    expect(res.body.order.priceInCents).toBe(1200)
    expect(res.body.order.discountedAmountInCents).toBe(0)
  })

  it("rejects an empty cart", async () => {
    const { user } = await makeCustomerWithCart()
    await db.cart.delete({ where: { userId: user.id } })

    const res = await placeOrder(user.id)

    expect(res.status).toBe(400)
    expect(res.body.message).toBe("Cart is empty")
  })

  /**
   * The payment id used to be taken on trust — never looked up — so any signed-in customer
   * could put a real order on the kitchen screen with no payment or one they made up.
   */
  describe("payment", () => {
    const expectNoOrder = async (cartId: string) => {
      expect(await db.order.count()).toBe(0)
      // The customer still has what they chose.
      expect(await db.cartItem.count({ where: { cartId } })).toBe(1)
    }

    it("refuses a cart that costs something with no payment at all", async () => {
      const { user, cart } = await makeCustomerWithCart({ itemPriceInCents: 1200 })

      const res = await placeOrder(user.id)

      expect(res.status).toBe(400)
      await expectNoOrder(cart.id)
    })

    it("still takes an order paid entirely in loyalty points", async () => {
      const { user } = await makeCustomerWithCart({
        itemPriceInCents: 1200,
        discountedAmountInCents: 1200,
      })

      const res = await placeOrder(user.id)

      expect(res.status).toBe(201)
      expect(stripeApi.paymentIntents.retrieve).not.toHaveBeenCalled()
    })

    it("refuses a payment id Stripe has never issued", async () => {
      const { user, cart } = await makeCustomerWithCart()
      await db.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerOf(user.id) },
      })

      const res = await placeOrder(user.id, { paymentIntentId: "pi_made_up" })

      expect(res.status).toBe(404)
      expect(stripeApi.refunds.create).not.toHaveBeenCalled()
      await expectNoOrder(cart.id)
    })

    it("refuses another customer's payment, and never refunds it", async () => {
      const { user, cart } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
      const other = await makeUser()
      // Theirs, and for a different amount — the case that would otherwise be refunded.
      await payFor(other.id, "pi_theirs", 900)
      await db.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerOf(user.id) },
      })

      const res = await placeOrder(user.id, { paymentIntentId: "pi_theirs" })

      expect(res.status).toBe(404)
      expect(stripeApi.refunds.create).not.toHaveBeenCalled()
      await expectNoOrder(cart.id)
    })

    /**
     * A membership invoice is paid on the same Stripe customer as an order. Without the
     * tag it could buy a cart of the same price, or be refunded while the membership it
     * paid for carried on.
     */
    it("will not spend or refund a payment that was not made for an order", async () => {
      const { user, cart } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
      await payFor(user.id, "pi_membership_invoice", 999, { metadata: {} })

      const res = await placeOrder(user.id, {
        paymentIntentId: "pi_membership_invoice",
      })

      expect(res.status).toBe(400)
      expect(stripeApi.refunds.create).not.toHaveBeenCalled()
      await expectNoOrder(cart.id)
    })

    it("refuses a payment that has not gone through", async () => {
      const { user, cart } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
      await payFor(user.id, "pi_unfinished", 1200, {
        status: "requires_payment_method",
        amount_received: 0,
        latest_charge: null,
      })

      const res = await placeOrder(user.id, { paymentIntentId: "pi_unfinished" })

      expect(res.status).toBe(400)
      expect(stripeApi.refunds.create).not.toHaveBeenCalled()
      await expectNoOrder(cart.id)
    })

    it("refunds a payment that no longer covers the cart instead of making the order", async () => {
      const { user, cart } = await makeCustomerWithCart({
        itemPriceInCents: 1200,
        quantity: 2,
      })
      // Paid for one, then a second added before the order was placed.
      await payFor(user.id, "pi_short", 1200)

      const res = await placeOrder(user.id, { paymentIntentId: "pi_short" })

      expect(res.status).toBe(409)
      expect(res.body.refunded).toBe(true)
      expect(res.body.message).toContain("$12.00")
      expect(stripeApi.refunds.create).toHaveBeenCalledTimes(1)
      expect(stripeApi.refunds.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_intent: "pi_short" }),
        { idempotencyKey: "order-refund:pi_short" },
      )
      expect(await db.order.count()).toBe(0)
      expect(await db.cartItem.count({ where: { cartId: cart.id } })).toBe(1)
    })

    it("refunds a payment taken in another currency", async () => {
      const { user, cart } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
      // 1200 paise is about 25 cents.
      await payFor(user.id, "pi_rupees", 1200, { currency: "inr" })

      const res = await placeOrder(user.id, { paymentIntentId: "pi_rupees" })

      expect(res.status).toBe(409)
      expect(res.body.refunded).toBe(true)
      expect(stripeApi.refunds.create).toHaveBeenCalledTimes(1)
      await expectNoOrder(cart.id)
    })

    /**
     * A refund leaves a payment's status at "succeeded". Put the cart back the way it was
     * and, without this, the refunded payment would buy the order after all.
     */
    it("will not spend a payment that has been refunded", async () => {
      const { user, cart } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
      await payFor(user.id, "pi_refunded", 1200, {
        latest_charge: { id: "ch_refunded", amount_refunded: 1200 },
      })

      const res = await placeOrder(user.id, { paymentIntentId: "pi_refunded" })

      expect(res.status).toBe(409)
      expect(res.body.refunded).toBe(true)
      expect(stripeApi.refunds.create).not.toHaveBeenCalled()
      await expectNoOrder(cart.id)
    })

    it("never refunds a payment that has already bought an order", async () => {
      const { user, cart } = await makeCustomerWithCart({
        itemPriceInCents: 1200,
        quantity: 2,
      })
      const other = await makeUser()
      await db.order.create({
        data: {
          tempOrderId: "6001",
          priceInCents: 1200,
          customerFirstName: "Ada",
          customerLastName: "Lovelace",
          customerEmail: "ada@example.test",
          status: "PENDING",
          GST: 157,
          source: "APP",
          appUserId: other.id,
          paymentIntentId: "pi_spent",
        },
      })
      await payFor(user.id, "pi_spent", 1200)

      const res = await placeOrder(user.id, { paymentIntentId: "pi_spent" })

      expect(res.status).toBe(409)
      expect(stripeApi.refunds.create).not.toHaveBeenCalled()
      expect(await db.cartItem.count({ where: { cartId: cart.id } })).toBe(1)
    })

    /**
     * The replay lookup matched the payment id alone, so another customer's id handed back
     * their order — name, email and phone number included.
     */
    it("does not hand back another customer's order for their payment id", async () => {
      const { user: owner } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
      await payFor(owner.id, "pi_owner", 1200)
      const placed = await placeOrder(owner.id, { paymentIntentId: "pi_owner" })
      expect(placed.status).toBe(201)

      const { user: snoop } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
      await db.user.update({
        where: { id: snoop.id },
        data: { stripeCustomerId: customerOf(snoop.id) },
      })

      const res = await placeOrder(snoop.id, { paymentIntentId: "pi_owner" })

      expect(res.status).toBe(404)
      expect(res.text).not.toContain(placed.body.order.id)
      expect(res.text).not.toContain(owner.email)
      expect(stripeApi.refunds.create).not.toHaveBeenCalled()
    })

    describe("an order whose pick up time has passed", () => {
      const passed = () => new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

      it("is refused on a payment id alone", async () => {
        const { user, cart } = await makeCustomerWithCart()
        await db.user.update({
          where: { id: user.id },
          data: { stripeCustomerId: customerOf(user.id) },
        })

        const res = await placeOrder(user.id, {
          paymentIntentId: "pi_skips_the_clock",
          body: { pickUpTime: passed() },
        })

        expect(res.status).toBeGreaterThanOrEqual(400)
        await expectNoOrder(cart.id)
      })

      // A verified payment is still never refused over the clock: the money has moved.
      it("is still taken once its payment checks out", async () => {
        const { user } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
        await payFor(user.id, "pi_late", 1200)
        const errors = vi.spyOn(console, "error").mockImplementation(() => {})

        const res = await placeOrder(user.id, {
          paymentIntentId: "pi_late",
          body: { pickUpTime: passed() },
        })

        expect(res.status).toBe(201)
        expect(JSON.stringify(errors.mock.calls)).toContain(
          "accepted with an invalid pick up time",
        )
      })
    })

    /**
     * What makes refunding safe. With nothing held between reading the payment and
     * committing the order, one request could make the order while a concurrent one — after
     * a cart edit — refunded the same payment.
     */
    it("waits for any other attempt holding the same payment", async () => {
      const { user } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
      await payFor(user.id, "pi_locked", 1200)

      let release!: () => void
      const released = new Promise<void>((resolve) => (release = resolve))
      let markLocked!: () => void
      const locked = new Promise<void>((resolve) => (markLocked = resolve))

      const holder = db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"pi_locked"}, 0))`
          markLocked()
          await released
        },
        { timeout: 20_000 },
      )
      await locked

      let settled = false
      const attempt = placeOrder(user.id, { paymentIntentId: "pi_locked" }).then(
        (res) => {
          settled = true
          return res
        },
      )

      await new Promise((resolve) => setTimeout(resolve, 1000))
      expect(settled).toBe(false)
      expect(stripeApi.paymentIntents.retrieve).not.toHaveBeenCalled()

      release()
      await holder

      const res = await attempt
      expect(res.status).toBe(201)
    })
  })

  describe("repeated attempts", () => {
    it("replays the original order when the cart is already gone", async () => {
      // The failure this exists for: the first response is lost, the app
      // resends, and the cart it needs has already been consumed. Reporting an
      // empty cart there tells a customer whose card was charged that their
      // order failed, and they pay again.
      const { user } = await makeCustomerWithCart()
      await payFor(user.id, "pi_replay", 1200)

      const first = await placeOrder(user.id, { paymentIntentId: "pi_replay" })
      expect(first.status).toBe(201)

      // A different idempotency key, so the cache cannot answer this and the
      // controller's own lookup has to.
      const retry = await placeOrder(user.id, {
        paymentIntentId: "pi_replay",
        idempotencyKey: randomUUID(),
      })

      expect(retry.status).toBe(200)
      expect(retry.body.order.id).toBe(first.body.order.id)
      expect(await db.order.count()).toBe(1)
    })

    it("replays from the cache when the same idempotency key comes back", async () => {
      const { user } = await makeCustomerWithCart()
      await payFor(user.id, "pi_cached", 1200)
      const key = randomUUID()

      const first = await placeOrder(user.id, {
        paymentIntentId: "pi_cached",
        idempotencyKey: key,
      })
      const retry = await placeOrder(user.id, {
        paymentIntentId: "pi_cached",
        idempotencyKey: key,
      })

      expect(retry.status).toBe(first.status)
      expect(retry.body.order.id).toBe(first.body.order.id)
      expect(await db.order.count()).toBe(1)
    })

    it("creates one order when two attempts race on the same payment intent", async () => {
      // Different keys on purpose: this is testing the unique constraint on
      // Order.paymentIntentId, which is the guarantee the cache cannot give.
      const { user } = await makeCustomerWithCart()
      await payFor(user.id, "pi_race", 1200)

      const [a, b] = await Promise.all([
        placeOrder(user.id, { paymentIntentId: "pi_race" }),
        placeOrder(user.id, { paymentIntentId: "pi_race" }),
      ])

      expect(a.status).toBeLessThan(400)
      expect(b.status).toBeLessThan(400)
      expect(a.body.order.id).toBe(b.body.order.id)

      expect(await db.order.count()).toBe(1)
      // One charge earns one lot of points, however many times it was sent.
      const loyalty = await db.loyalty.findUnique({ where: { userId: user.id } })
      const single = await db.loyaltyRecord.count()
      expect(single).toBe(1)
      expect(loyalty).not.toBeNull()
      expect(stripeApi.refunds.create).not.toHaveBeenCalled()
    })

    it("lets a genuinely new order through", async () => {
      const { user } = await makeCustomerWithCart()
      await payFor(user.id, "pi_first", 1200)
      await placeOrder(user.id, { paymentIntentId: "pi_first" })

      // A second, separate checkout: new cart, new payment intent.
      const dessert = await makeDessert(900)
      await makeCart(user.id, [{ dessertId: dessert.id, itemPriceInCents: 900 }])
      await payFor(user.id, "pi_second", 900)

      const second = await placeOrder(user.id, { paymentIntentId: "pi_second" })

      expect(second.status).toBe(201)
      expect(await db.order.count()).toBe(2)
    })
  })

  it("rolls back the order, its points and the cart when a later write fails", async () => {
    const { user, cart } = await makeCustomerWithCart()
    await payFor(user.id, "pi_rollback", 1200)

    // Runs the real transaction body against the real transaction, then fails
    // the way a dropped connection would. If any of those writes were outside
    // the transaction, they would survive this and the assertions below fail.
    type TxCallback = (tx: Prisma.TransactionClient) => Promise<unknown>
    type TxOptions = { maxWait?: number; timeout?: number }

    const realTransaction = db.$transaction.bind(db) as (
      fn: TxCallback,
      options?: TxOptions,
    ) => Promise<unknown>

    vi.spyOn(db, "$transaction").mockImplementation((async (
      fn: TxCallback,
      options?: TxOptions,
    ) =>
      realTransaction(async (tx) => {
        await fn(tx)
        throw new Error("simulated failure after the writes")
      }, options)) as never)

    const res = await placeOrder(user.id, { paymentIntentId: "pi_rollback" })

    expect(res.status).toBe(500)
    expect(await db.order.count()).toBe(0)
    expect(await db.loyalty.count()).toBe(0)
    expect(await db.offerRedemption.count()).toBe(0)

    // The cart survives, so the customer still has what they chose.
    expect(await db.cartItem.count({ where: { cartId: cart.id } })).toBe(1)
  })

  /**
   * The unlock sweep is the only thing that writes an AVAILABLE redemption, and until
   * the window landed it read `isActive` alone - so an order placed today could unlock
   * an offer scheduled for next month or one whose run finished last week.
   */
  describe("the post-order unlock sweep", () => {
    const gatedOffer = (dessertId: string, extra: object = {}) =>
      db.offer.create({
        data: {
          name: "Buy one, get one",
          audience: "EVERYONE",
          dessertId,
          itemPriceInCents: 0,
          requirements: { create: [{ dessertId, quantity: 1 }] },
          ...extra,
        },
      })

    it("unlocks an offer that is running", async () => {
      const { user, dessert } = await makeCustomerWithCart()
      const offer = await gatedOffer(dessert.id)
      await payFor(user.id, "pi_unlock", 1200)

      const res = await placeOrder(user.id, { paymentIntentId: "pi_unlock" })
      expect(res.status).toBe(201)

      const redemption = await db.offerRedemption.findUnique({
        where: { offerId_userId: { offerId: offer.id, userId: user.id } },
      })
      expect(redemption?.status).toBe("AVAILABLE")
      expect(redemption?.used).toBe(0)
    })

    it.each([
      { state: "ended", extra: { endsAt: new Date(Date.now() - 60_000) } },
      {
        state: "not started",
        extra: { startsAt: new Date(Date.now() + 86_400_000) },
      },
      { state: "archived", extra: { archivedAt: new Date() } },
    ])("leaves an offer that is $state locked", async ({ extra }) => {
      const { user, dessert } = await makeCustomerWithCart()
      await gatedOffer(dessert.id, extra)
      await payFor(user.id, "pi_skip", 1200)

      const res = await placeOrder(user.id, { paymentIntentId: "pi_skip" })

      // The order still lands. The sweep only ever narrows - it runs inside the paid
      // order transaction, so refusing here would roll back an order already charged.
      expect(res.status).toBe(201)
      expect(await db.offerRedemption.count()).toBe(0)
    })

    /**
     * The guarantee the whole run lifecycle rests on. The admin's Close run *deletes*
     * redemption rows rather than resetting them to AVAILABLE, precisely so that
     * `redemptions: { none: { userId } }` matches again and the requirements are
     * re-evaluated against a real qualifying order instead of being handed back to
     * everyone who had already earned the offer once.
     */
    it("re-grants the offer after its redemptions are cleared", async () => {
      const { user, dessert } = await makeCustomerWithCart()
      const offer = await gatedOffer(dessert.id)
      await payFor(user.id, "pi_first", 1200)

      await placeOrder(user.id, { paymentIntentId: "pi_first" })
      expect(await db.offerRedemption.count()).toBe(1)

      // What closeRun does.
      await db.offerRedemption.deleteMany({ where: { offerId: offer.id } })

      // A second qualifying order, the way the next run would be earned.
      const dessert2 = await db.dessert.findUniqueOrThrow({
        where: { id: dessert.id },
      })
      await db.cart.create({
        data: {
          userId: user.id,
          totalPriceInCents: dessert2.priceInCents,
          cartItems: {
            create: {
              dessertId: dessert2.id,
              itemPriceInCents: dessert2.priceInCents,
              discountedAmountInCents: 0,
              quantity: 1,
            },
          },
        },
      })
      await payFor(user.id, "pi_second", dessert2.priceInCents)

      const res = await placeOrder(user.id, { paymentIntentId: "pi_second" })
      expect(res.status).toBe(201)

      const regranted = await db.offerRedemption.findUnique({
        where: { offerId_userId: { offerId: offer.id, userId: user.id } },
      })
      expect(regranted?.status).toBe("AVAILABLE")
    })
  })
})
