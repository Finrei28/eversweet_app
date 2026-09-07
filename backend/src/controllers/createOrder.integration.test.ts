import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"
import { Prisma } from "@prisma/client"
import { randomUUID } from "crypto"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeCustomerWithCart, nextOpenPickUpTime } from "../test/factories"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

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

describeIfDb("POST /api/auth/createOrder", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
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

    const res = await placeOrder(user.id, { paymentIntentId: "pi_basic" })

    expect(res.status).toBe(201)
    expect(res.body.order.priceInCents).toBe(2400)
    expect(res.body.order.status).toBe("PENDING")

    expect(await db.order.count()).toBe(1)
    expect(await db.cart.count({ where: { userId: user.id } })).toBe(0)
  })

  it("never lets a client name its own price", async () => {
    const { user } = await makeCustomerWithCart({ itemPriceInCents: 1200 })

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

  describe("repeated attempts", () => {
    it("replays the original order when the cart is already gone", async () => {
      // The failure this exists for: the first response is lost, the app
      // resends, and the cart it needs has already been consumed. Reporting an
      // empty cart there tells a customer whose card was charged that their
      // order failed, and they pay again.
      const { user } = await makeCustomerWithCart()

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
    })

    it("lets a genuinely new order through", async () => {
      const { user } = await makeCustomerWithCart()
      await placeOrder(user.id, { paymentIntentId: "pi_first" })

      // A second, separate checkout: new cart, new payment intent.
      const dessert = await db.dessert.findFirstOrThrow()
      await db.cart.create({
        data: {
          userId: user.id,
          totalPriceInCents: 900,
          cartItems: {
            create: [
              { dessertId: dessert.id, itemPriceInCents: 900, quantity: 1 },
            ],
          },
        },
      })

      const second = await placeOrder(user.id, { paymentIntentId: "pi_second" })

      expect(second.status).toBe(201)
      expect(await db.order.count()).toBe(2)
    })
  })

  it("rolls back the order, its points and the cart when a later write fails", async () => {
    const { user, cart } = await makeCustomerWithCart()

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
})
