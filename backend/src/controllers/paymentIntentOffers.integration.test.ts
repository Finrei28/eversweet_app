import { beforeEach, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeDessert, makeUser, nextOpenPickUpTime } from "../test/factories"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

const PAY = "/api/stripe/createPaymentIntent"

/**
 * Loading the cart sweeps out an offer that has stopped running, but an offer can end
 * between that load and the tap on Place order. This is the last point where it can
 * still be caught: `createOrder` runs after the card is charged, and a paid order is
 * never refused, so anything missed here is honoured at the old offer price.
 *
 * Stripe is never reached in these tests — every refusal returns before the customer
 * lookup, which is the only call that leaves the process on this path.
 */
describeIfDb("createPaymentIntent and offers that stopped running", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  const cartHoldingOffer = async (offerData: object = {}) => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    const offer = await db.offer.create({
      data: {
        name: "Running, for now",
        audience: "EVERYONE",
        dessertId: dessert.id,
        itemPriceInCents: 500,
        ...offerData,
      },
    })

    await db.cart.create({
      data: {
        userId: user.id,
        totalPriceInCents: 500,
        cartItems: {
          create: {
            dessertId: dessert.id,
            offerId: offer.id,
            itemPriceInCents: 1200,
            discountedAmountInCents: 700,
            quantity: 1,
          },
        },
      },
    })

    return { user, offer }
  }

  const pay = (userId: string, amount: number) =>
    request(app)
      .post(PAY)
      .set("Authorization", `Bearer ${tokenFor(userId)}`)
      .send({
        amount,
        currency: "nzd",
        pickUpTime: nextOpenPickUpTime().toISOString(),
      })

  it.each([
    { state: "ended", data: { endsAt: new Date(Date.now() - 60_000) } },
    { state: "archived", data: { archivedAt: new Date() } },
    { state: "switched off", data: { isActive: false } },
  ])("refuses a cart whose offer is $state", async ({ data }) => {
    const { user, offer } = await cartHoldingOffer()
    await db.offer.update({ where: { id: offer.id }, data })

    const res = await pay(user.id, 500)

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/no longer available/i)
  })

  // The guard must not stand in the way of an offer that is simply still running —
  // getting this wrong would refuse every offer checkout rather than none.
  it("does not refuse a cart whose offer is still running", async () => {
    const { user } = await cartHoldingOffer({
      endsAt: new Date(Date.now() + 86_400_000),
    })

    const res = await pay(user.id, 500)

    // Past the offer guard. Where it lands after that depends on Stripe credentials,
    // which these tests deliberately do not have — 409 for this reason is what matters.
    expect(res.body.message ?? "").not.toMatch(/no longer available/i)
  })
})
