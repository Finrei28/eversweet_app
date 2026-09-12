import { beforeEach, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase } from "../test/db"
import { makeDessert } from "../test/factories"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

const CAROUSEL = "/api/showOfferForClient"

/**
 * The public home carousel. Unauthenticated, Redis-cached, and the one offer endpoint
 * where the window is applied *after* the cache read rather than in the query — caching
 * the verdict would freeze `now` for the life of the 120s entry, so an offer would start
 * and stop whenever the entry happened to have been filled.
 */
describeIfDb("showOfferForClient", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  const makeOffer = async (name: string, data: object = {}) => {
    const dessert = await makeDessert(1200)
    return db.offer.create({
      data: {
        name,
        audience: "EVERYONE",
        dessertId: dessert.id,
        itemPriceInCents: 0,
        ...data,
      },
    })
  }

  const names = (body: { offers: { name: string }[] }) =>
    body.offers.map((o) => o.name).sort()

  it("advertises only the offers that are actually running", async () => {
    await makeOffer("Live")
    await makeOffer("Scheduled", { startsAt: new Date(Date.now() + 86_400_000) })
    await makeOffer("Ended", { endsAt: new Date(Date.now() - 60_000) })
    await makeOffer("Archived", { archivedAt: new Date() })
    await makeOffer("Paused", { isActive: false })

    const res = await request(app).get(CAROUSEL)

    expect(res.status).toBe(200)
    expect(names(res.body)).toEqual(["Live"])
  })

  /**
   * The reason the window is not part of the cached query: the *verdict* must not be
   * cached with it. The entry is filled while the offer is still running, the clock then
   * runs past its end, and it has to drop out on the next request rather than lingering
   * for the rest of the 120s TTL.
   *
   * A real wait of a few tens of milliseconds, against an `endsAt` that close, rather
   * than fake timers — the cache stub keys its own TTL off Date.now(), so moving the
   * system clock would expire the entry and the offer would vanish because the query ran
   * again, which is the wrong reason and would pass either way.
   *
   * Note this is about time passing, not about editing the dates: `endsAt` is itself a
   * cached value, so changing it in the admin is stale for up to the TTL like any other
   * field. Time passing is the case worth being exact about, because it happens on its own.
   */
  it("drops an offer the moment the clock passes its end, not when the cache expires", async () => {
    await makeOffer("Ending", { endsAt: new Date(Date.now() + 60) })

    // Fills the cache while it is still running.
    expect(names((await request(app).get(CAROUSEL)).body)).toEqual(["Ending"])

    await new Promise((resolve) => setTimeout(resolve, 120))

    // Same warm entry, recomputed verdict.
    expect(names((await request(app).get(CAROUSEL)).body)).toEqual([])
  })

  // Same rule as showOffers: the server gates on the window, so it never goes out.
  it("keeps the window columns off the wire", async () => {
    await makeOffer("Live", {
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 86_400_000),
    })

    const returned = (await request(app).get(CAROUSEL)).body.offers[0]

    for (const field of ["isActive", "startsAt", "endsAt", "archivedAt"]) {
      expect(returned).not.toHaveProperty(field)
    }
    // Still carries what the carousel renders.
    expect(returned).toHaveProperty("name")
    expect(returned).toHaveProperty("audience")
    expect(returned.dessert).toHaveProperty("imagePath")
  })
})
