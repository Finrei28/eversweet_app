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

  /**
   * `discountAmount` is whole percent since the 2026-09-12 migration. Priced as the
   * fraction it used to be, a stored 20 reads as `1 - 20` and hands back a discount
   * twenty times the item — so this asserts the discount, not just that the row landed.
   */
  it("prices a percentage offer as percent off, not as a multiplier", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    const offer = await db.offer.create({
      data: {
        name: "20% off the good stuff",
        audience: "EVERYONE",
        dessertId: dessert.id,
        discountAmount: 20,
      },
    })

    const res = await addItem(user.id, {
      dessertId: dessert.id,
      itemPriceInCents: 1200,
      offerId: offer.id,
    })

    expect(res.status).toBe(201)
    expect(res.body.cartItem.itemPriceInCents).toBe(1200)
    expect(res.body.cartItem.discountedAmountInCents).toBe(240)

    const cart = await db.cart.findUnique({ where: { userId: user.id } })

    expect(cart?.totalPriceInCents).toBe(960)
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

  it("survives two adds racing to create the first cart", async () => {
    const user = await makeUser()
    const first = await makeDessert(1200)
    const second = await makeDessert(800)

    // No cart exists yet, so both requests take the create branch of the
    // upsert and one loses the unique index on Cart.userId. The loser has to
    // recover rather than surface a 500 — this is what adding two items
    // quickly actually does.
    const [a, b] = await Promise.all([
      addItem(user.id, { dessertId: first.id, itemPriceInCents: 1200 }),
      addItem(user.id, { dessertId: second.id, itemPriceInCents: 800 }),
    ])

    expect(a.status).toBe(201)
    expect(b.status).toBe(201)

    const cart = await db.cart.findUnique({
      where: { userId: user.id },
      include: { cartItems: true },
    })

    expect(cart?.cartItems).toHaveLength(2)
    expect(cart?.totalPriceInCents).toBe(2000)
  })

  it("keeps the total right when several adds land together", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(500)

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        addItem(user.id, { dessertId: dessert.id, itemPriceInCents: 500 }),
      ),
    )

    for (const res of results) expect(res.status).toBe(201)

    const cart = await db.cart.findUnique({
      where: { userId: user.id },
      include: { cartItems: true },
    })

    // Each add is its own row and the totals move by increment, so the result
    // is the sum rather than whichever write finished last.
    expect(cart?.cartItems).toHaveLength(4)
    expect(cart?.totalPriceInCents).toBe(2000)
  })

  // What a line costs, and what it costs in points, are the database's answer
  // and not the customer's. The request still carries both because older
  // installed apps send them; they are simply not believed.
  it("prices the item from the dessert, not from the request", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)

    const res = await addItem(user.id, {
      dessertId: dessert.id,
      itemPriceInCents: 0,
    })

    expect(res.status).toBe(201)
    expect(res.body.cartItem.itemPriceInCents).toBe(1200)

    const cart = await db.cart.findUnique({ where: { userId: user.id } })

    expect(cart?.totalPriceInCents).toBe(1200)
  })

  it("refuses a reward claimed at the wrong number of points", async () => {
    const user = await makeUser()
    // priceInLoyaltyPoints defaults to 500.
    const dessert = await makeDessert(1200)
    await db.loyalty.create({ data: { userId: user.id, points: 5000 } })

    const res = await addItem(user.id, {
      dessertId: dessert.id,
      itemPriceInCents: 0,
      loyaltyPointsUsed: 1,
    })

    expect(res.status).toBe(400)

    const loyalty = await db.loyalty.findUnique({ where: { userId: user.id } })

    expect(loyalty?.points).toBe(5000)
    expect(await db.cart.findUnique({ where: { userId: user.id } })).toBeNull()
  })

  it("will not change the quantity of a reward line", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    await db.loyalty.create({ data: { userId: user.id, points: 500 } })

    const added = await addItem(user.id, {
      dessertId: dessert.id,
      itemPriceInCents: 0,
      loyaltyPointsUsed: 500,
    })

    expect(added.status).toBe(201)

    const res = await request(app)
      .patch(SET_QUANTITY)
      .set("Authorization", `Bearer ${tokenFor(user.id)}`)
      .send({ id: added.body.cartItem.id, quantity: 10 })

    expect(res.status).toBe(400)

    // The bug this closes: ten desserts for one 500-point redemption, because
    // nothing on the quantity path debits anything.
    const item = await db.cartItem.findUnique({
      where: { id: added.body.cartItem.id },
    })
    const loyalty = await db.loyalty.findUnique({ where: { userId: user.id } })

    expect(item?.quantity).toBe(1)
    expect(loyalty?.points).toBe(0)
  })

  it("debits again for a second redemption of the same reward", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    await db.loyalty.create({ data: { userId: user.id, points: 1000 } })

    const body = {
      dessertId: dessert.id,
      itemPriceInCents: 0,
      loyaltyPointsUsed: 500,
    }

    expect((await addItem(user.id, body)).status).toBe(201)
    expect((await addItem(user.id, body)).status).toBe(201)

    const cart = await db.cart.findUnique({
      where: { userId: user.id },
      include: { cartItems: true },
    })
    const loyalty = await db.loyalty.findUnique({ where: { userId: user.id } })

    // Two lines and two debits, rather than one line at quantity two.
    expect(cart?.cartItems).toHaveLength(2)
    expect(loyalty?.points).toBe(0)

    // A third is refused rather than given away.
    expect((await addItem(user.id, body)).status).toBe(400)
  })

  it("discounts a customisation on its real price, not the claimed one", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    const plan = await db.membershipPlan.create({
      data: {
        name: "Sweet Club",
        stripePriceId: `price_${Date.now()}`,
        membershipDiscount: 5,
        maxDiscount: 25,
      },
    })
    await db.membership.create({
      data: {
        userId: user.id,
        planId: plan.id,
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
        paymentStatus: "SUCCESS",
        totalMonths: 5,
      },
    })
    const topping = await db.ingredient.create({
      data: { name: "Pearls", chineseName: "珍珠", priceInCents: 100 },
    })

    const res = await addItem(user.id, {
      dessertId: dessert.id,
      itemPriceInCents: 1200,
      customisations: [
        {
          id: topping.id,
          name: "Pearls",
          chineseName: "珍珠",
          quantity: 1,
          // The lie. checkout subtracts the stored discount from the real
          // price, so believing this bought $125 off the rest of the order.
          priceInCents: 50000,
          discountedAmountInCents: 0,
        },
      ],
    })

    expect(res.status).toBe(201)

    const stored = await db.customisationInCartItem.findFirst({
      where: { cartItemId: res.body.cartItem.id },
    })

    // 25% of the database's 100c, not of the 50000c that was claimed.
    expect(stored?.discountedAmountInCents).toBe(25)
  })

  it("refuses a customisation that does not exist", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)

    const res = await addItem(user.id, {
      dessertId: dessert.id,
      itemPriceInCents: 1200,
      customisations: [
        {
          id: "not-a-real-customisation",
          name: "Free Everything",
          chineseName: "免费",
          quantity: 1,
          priceInCents: 0,
          discountedAmountInCents: 0,
        },
      ],
    })

    expect(res.status).toBe(400)
    expect(await db.cart.findUnique({ where: { userId: user.id } })).toBeNull()
  })

  it("debits the points exactly once for one redemption", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    await db.loyalty.create({ data: { userId: user.id, points: 900 } })

    const res = await addItem(user.id, {
      dessertId: dessert.id,
      itemPriceInCents: 0,
      loyaltyPointsUsed: 500,
    })

    expect(res.status).toBe(201)

    const loyalty = await db.loyalty.findUnique({ where: { userId: user.id } })
    const records = await db.loyaltyRecord.count({
      where: { loyalty: { userId: user.id } },
    })

    expect(loyalty?.points).toBe(400)
    expect(records).toBe(1)
  })

  it("will not let two redemptions overdraw the balance", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    // Enough for exactly one 500-point reward.
    await db.loyalty.create({ data: { userId: user.id, points: 500 } })

    const body = {
      dessertId: dessert.id,
      itemPriceInCents: 0,
      loyaltyPointsUsed: 500,
    }

    const [a, b] = await Promise.all([
      addItem(user.id, body),
      addItem(user.id, body),
    ])

    // Reading the balance and then writing it let both of these see 500 and
    // both subtract it. One has to lose.
    expect([a.status, b.status].sort()).toEqual([201, 400])

    const loyalty = await db.loyalty.findUnique({ where: { userId: user.id } })
    const cart = await db.cart.findUnique({
      where: { userId: user.id },
      include: { cartItems: true },
    })
    const records = await db.loyaltyRecord.count({
      where: { loyalty: { userId: user.id } },
    })

    expect(loyalty?.points).toBe(0)
    expect(cart?.cartItems).toHaveLength(1)
    expect(records).toBe(1)
  })

  it("refuses a redemption from a customer with no loyalty record", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)

    const res = await addItem(user.id, {
      dessertId: dessert.id,
      itemPriceInCents: 0,
      loyaltyPointsUsed: 500,
    })

    // No record means no points, which is the same answer as too few - and a
    // 400 rather than the 500 this used to raise.
    expect(res.status).toBe(400)
    expect(await db.cart.findUnique({ where: { userId: user.id } })).toBeNull()
  })

  /**
   * Adding and removing used to take Loyalty and Cart in opposite orders, so
   * two of them overlapping deadlocked and Postgres killed one with 40P01.
   *
   * Be honest about what this test is: against a local database the
   * transactions finish in single-digit milliseconds, so the window barely
   * exists and this would not reliably reproduce the deadlock even with the
   * old ordering. It reproduced readily in production, where every statement
   * costs most of a second. What it does check every run is the arithmetic
   * under concurrency - that a refund and a debit landing together leave the
   * balance right - and it would catch a gross ordering regression some of
   * the time.
   */
  it("survives an add and a remove racing on the same reward", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    await db.loyalty.create({ data: { userId: user.id, points: 1000 } })

    const body = {
      dessertId: dessert.id,
      itemPriceInCents: 0,
      loyaltyPointsUsed: 500,
    }

    const first = await addItem(user.id, body)
    expect(first.status).toBe(201)

    const [added, removed] = await Promise.all([
      addItem(user.id, body),
      request(app)
        .delete(`/api/cart/removeItemFromCart/${first.body.cartItem.id}`)
        .set("Authorization", `Bearer ${tokenFor(user.id)}`),
    ])

    expect(added.status).toBe(201)
    expect(removed.status).toBe(200)

    // 1000 spend 500 spend 500 refund 500.
    const loyalty = await db.loyalty.findUnique({ where: { userId: user.id } })
    const cart = await db.cart.findUnique({
      where: { userId: user.id },
      include: { cartItems: true },
    })

    expect(loyalty?.points).toBe(500)
    expect(cart?.cartItems).toHaveLength(1)
  })

})
