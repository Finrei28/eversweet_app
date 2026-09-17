import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { invalidateTradingHours } from "../lib/tradingHours"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeCustomerWithCart } from "../test/factories"
import { resetStripeStub, stripeApi } from "../test/stripeStub"

vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

// Never the real SDK: see test/stripeStub.
vi.mock("stripe", async (importOriginal) =>
  (await import("../test/stripeStub.js")).fakeStripeModule(await importOriginal()),
)

/** Thursday 5 March 2026 in Auckland: 12:30 PM to 9:30 PM, last pick-up 9:20. */
const thursday = (time: string) => new Date(`2026-03-05T${time}:00+13:00`)

/** Only `Date` is faked, so the server's own timers and sockets keep running. */
const at = (instant: Date) => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(instant)
}

describeIfDb("store hours from the TradingHours table", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
    resetStripeStub()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("GET /api/getStoreHours", () => {
    it("serves the table in the shape installed app builds read", async () => {
      const res = await request(app).get("/api/getStoreHours")

      expect(res.status).toBe(200)
      expect(Object.keys(res.body)).toEqual([
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ])
      expect(res.body.Thursday).toEqual(["12:30 PM", "9:30 PM"])
      expect(res.body.Sunday).toEqual(["12:00 PM", "10:00 PM"])
    })

    it("follows a change to the table", async () => {
      await db.tradingHours.update({
        where: { weekday: 3 },
        data: { opensAt: null, closesAt: null },
      })
      invalidateTradingHours()

      const res = await request(app).get("/api/getStoreHours")

      expect(res.body.Wednesday).toBeNull()
    })
  })

  /**
   * `isOpen` used to be worked out once, when the server started, and served unchanged
   * until the next restart - so the app's "Open Now" badge showed whatever it had been at
   * the last deploy. It never looked at days off either.
   */
  describe("GET /api/getStoreInfo", () => {
    it("works out isOpen for the moment it is asked", async () => {
      at(thursday("18:00"))
      expect((await request(app).get("/api/getStoreInfo")).body.isOpen).toBe(true)

      at(thursday("21:45"))
      expect((await request(app).get("/api/getStoreInfo")).body.isOpen).toBe(false)
    })

    it("is closed on a day off", async () => {
      await db.daysOff.create({ data: { date: thursday("00:00") } })
      at(thursday("18:00"))

      const res = await request(app).get("/api/getStoreInfo")

      expect(res.body).toMatchObject({ name: "Eversweet", isOpen: false })
    })
  })

  describe("POST /api/stripe/createPaymentIntent", () => {
    const pay = async (pickUpTime: Date) => {
      const { user } = await makeCustomerWithCart({ itemPriceInCents: 1200 })
      await db.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: "cus_own" },
      })
      stripeApi.customers.retrieve.mockResolvedValue({ id: "cus_own" })
      stripeApi.paymentIntents.create.mockResolvedValue({
        id: "pi_new",
        client_secret: "pi_new_secret",
      })

      return request(app)
        .post("/api/stripe/createPaymentIntent")
        .set("Authorization", `Bearer ${tokenFor(user.id)}`)
        .send({ amount: 1200, authoriseOnly: true, pickUpTime })
    }

    it("holds the card for the last pick-up", async () => {
      at(thursday("20:00"))

      const res = await pay(thursday("21:20"))

      expect(res.status).toBe(200)
      expect(stripeApi.paymentIntents.create).toHaveBeenCalled()
    })

    it("refuses a minute past it before touching the card, and says when last pick-up is", async () => {
      at(thursday("20:00"))

      const res = await pay(thursday("21:21"))

      expect(res.status).toBe(400)
      expect(res.body).toEqual({ message: "Our last pick up that day is 9:20 PM." })
      expect(stripeApi.paymentIntents.create).not.toHaveBeenCalled()
    })
  })
})
