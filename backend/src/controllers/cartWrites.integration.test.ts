import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeDessert, makeUser } from "../test/factories"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

const ADD = "/api/cart/addItemToCart"
const SET_QUANTITY = "/api/cart/updateCartItemQuantity"

const addItem = (
  userId: string,
  body: Record<string, unknown>,
) =>
  request(app)
    .post(ADD)
    .set("Authorization", `Bearer ${tokenFor(userId)}`)
    .send({ quantity: 1, customisations: [], ...body })

/**
 * The cart write paths run as few database round trips as they can: a plain
 * add is a single `cart.upsert` with the item nested inside it, and a quantity
 * change is a single `cart.update`. Both used to be interactive transactions
 * that read, branched, then wrote — and in the quantity case wrote the same
 * row twice. These tests pin the behaviour that restructuring had to preserve:
 * the totals, the offer redemption, and the loyalty debit rolling back.
 */
describeIfDb("cart write paths", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  it("creates the cart when the customer does not have one", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)

    const res = await addItem(user.id, {
      dessertId: dessert.id,
      itemPriceInCents: 1200,
    })

    expect(res.status).toBe(201)
    expect(res.body.cartItem.itemPriceInCents).toBe(1200)

    const cart = await db.cart.findUnique({
      where: { userId: user.id },
      include: { cartItems: true },
    })

    expect(cart?.cartItems).toHaveLength(1)
    expect(cart?.totalPriceInCents).toBe(1200)
    expect(cart?.totalLoyaltyPointsUsed).toBe(0)
    expect(cart?.expiresAt).toBeTruthy()
  })

  it("adds to the existing cart and increments its total", async () => {
    const user = await makeUser()
    const first = await makeDessert(1200)
    const second = await makeDessert(800)

    await addItem(user.id, { dessertId: first.id, itemPriceInCents: 1200 })
    const res = await addItem(user.id, {
      dessertId: second.id,
      itemPriceInCents: 800,
    })

    expect(res.status).toBe(201)

    const cart = await db.cart.findUnique({
      where: { userId: user.id },
      include: { cartItems: true },
    })

    // Two separate lines, and the total is the sum rather than the last write.
    expect(cart?.cartItems).toHaveLength(2)
    expect(cart?.totalPriceInCents).toBe(2000)
  })

  it("returns the item it just created, not another line in the cart", async () => {
    const user = await makeUser()
    const first = await makeDessert(1200)
    const second = await makeDessert(800)

    await addItem(user.id, { dessertId: first.id, itemPriceInCents: 1200 })
    const res = await addItem(user.id, {
      dessertId: second.id,
      itemPriceInCents: 800,
    })

    expect(res.body.cartItem.dessert.id).toBe(second.id)
  })

  it("records the redemption when an open offer is used", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    const offer = await db.offer.create({
      data: {
        name: "Free scoop",
        audience: "EVERYONE",
        dessertId: dessert.id,
        itemPriceInCents: 500,
        limit: 2,
      },
    })

    const res = await addItem(user.id, {
      dessertId: dessert.id,
      itemPriceInCents: 1200,
      offerId: offer.id,
    })

    expect(res.status).toBe(201)

    const redemption = await db.offerRedemption.findUnique({
      where: { offerId_userId: { offerId: offer.id, userId: user.id } },
    })

    expect(redemption?.used).toBe(1)
    expect(redemption?.status).toBe("REDEEMED")
  })

  it("writes nothing at all when the customer cannot afford the points", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    await db.loyalty.create({ data: { userId: user.id, points: 10 } })

    const res = await addItem(user.id, {
      dessertId: dessert.id,
      itemPriceInCents: 0,
      loyaltyPointsUsed: 500,
    })

    expect(res.status).toBe(400)

    // The debit and the cart write share a transaction, so a refusal has to
    // leave both untouched.
    const loyalty = await db.loyalty.findUnique({ where: { userId: user.id } })
    const cart = await db.cart.findUnique({ where: { userId: user.id } })

    expect(loyalty?.points).toBe(10)
    expect(cart).toBeNull()
  })

  it("adjusts the cart total once when a quantity changes", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)

    const added = await addItem(user.id, {
      dessertId: dessert.id,
      itemPriceInCents: 1200,
    })
    const cartItemId = added.body.cartItem.id

    const res = await request(app)
      .patch(SET_QUANTITY)
      .set("Authorization", `Bearer ${tokenFor(user.id)}`)
      .send({ id: cartItemId, quantity: 3 })

    expect(res.status).toBe(200)
    expect(res.body.cartItem.quantity).toBe(3)

    const cart = await db.cart.findUnique({
      where: { userId: user.id },
      include: { cartItems: true },
    })

    expect(cart?.cartItems[0].quantity).toBe(3)
    expect(cart?.totalPriceInCents).toBe(3600)
  })
})
