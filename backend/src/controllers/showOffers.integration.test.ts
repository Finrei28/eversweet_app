import { beforeEach, expect, it, vi } from "vitest"
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

const SHOW_OFFERS = "/api/auth/showOffers"

/**
 * The offers screen had no test at all, which is how `.toNumber()` on an Int column and a
 * payload missing the fields the card reads both became possible at once. These pin the
 * response *shape* the app relies on, not just that the endpoint answers 200.
 */
describeIfDb("showOffers", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  const load = (userId: string) =>
    request(app)
      .get(SHOW_OFFERS)
      .set("Authorization", `Bearer ${tokenFor(userId)}`)

  it("sends discountAmount as whole percent, not a Decimal", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    await db.offer.create({
      data: {
        name: "20% off",
        audience: "EVERYONE",
        dessertId: dessert.id,
        discountAmount: 20,
      },
    })

    const res = await load(user.id)

    expect(res.status).toBe(200)
    // A plain number on the wire. This line used to be `.toNumber()`, which is a
    // TypeError once the column is an Int, and took the whole screen down with it.
    expect(res.body.offers[0].discountAmount).toBe(20)
  })

  /**
   * `renewsWeekly` is what lets the card say "Back again each Monday" instead of leaving a
   * spent weekly perk looking gone for good. The app degrades quietly if it is absent —
   * the copy just never appears — so nothing else would catch its loss.
   */
  it("carries renewsWeekly so the card can say the perk comes back", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    await db.offer.create({
      data: {
        name: "Free weekly mochi dessert bowl",
        audience: "EVERYONE",
        dessertId: dessert.id,
        itemPriceInCents: 0,
        renewsWeekly: true,
      },
    })

    const res = await load(user.id)

    expect(res.body.offers[0].renewsWeekly).toBe(true)
  })

  /**
   * The requirement's dessert/category name, so the card can say what unlocks the offer.
   * `requirements: true` selects scalars only, which left the app with ids it cannot
   * render and a greyed button with no explanation.
   */
  it("names what unlocks a requirement-gated offer", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    const offer = await db.offer.create({
      data: {
        name: "Buy 4, get one",
        audience: "EVERYONE",
        dessertId: dessert.id,
        itemPriceInCents: 0,
        requirements: { create: [{ dessertId: dessert.id, quantity: 4 }] },
      },
    })

    const res = await load(user.id)

    const returned = res.body.offers.find((o: { id: string }) => o.id === offer.id)
    expect(returned.requirements[0].quantity).toBe(4)
    expect(returned.requirements[0].dessert.name).toBe(dessert.name)
  })

  /**
   * The payload is built from an explicit `select`, which is what stops the client asking
   * for a column the database may not have yet — the 2026-09-12 failure. The cost of that
   * is that a field the app reads can now be dropped by editing one line, with nothing to
   * notice: the screen would just render blanks. So the shape is pinned here.
   *
   * Keep this in step with the `Offer` type in the app's utils/types.ts.
   */
  it("sends exactly the fields the app declares, and no more", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    const offer = await db.offer.create({
      data: {
        name: "Shape",
        audience: "EVERYONE",
        dessertId: dessert.id,
        itemPriceInCents: 0,
        requirements: { create: [{ dessertId: dessert.id, quantity: 2 }] },
      },
    })
    await db.offerRedemption.create({
      data: { offerId: offer.id, userId: user.id, status: "AVAILABLE" },
    })

    const res = await load(user.id)
    const returned = res.body.offers[0]

    expect(Object.keys(returned).sort()).toEqual([
      "audience",
      "category",
      "categoryId",
      "description",
      "dessert",
      "dessertId",
      "discountAmount",
      "id",
      "image",
      "itemPriceInCents",
      "limit",
      "name",
      "redemptions",
      "renewsWeekly",
      "requirements",
    ])

    expect(Object.keys(returned.redemptions[0]).sort()).toEqual([
      "id",
      "offerId",
      "redeemedAt",
      "status",
      "unlockedAt",
      "used",
      "userId",
    ])

    expect(Object.keys(returned.requirements[0]).sort()).toEqual([
      "category",
      "categoryId",
      "dessert",
      "dessertId",
      "id",
      "offerId",
      "quantity",
    ])
  })

  // Deliberately absent: the server is what gates on the window, so sending it would
  // invite the app to form a second, drifting opinion about whether an offer is live.
  it("keeps the window columns off the wire", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    await db.offer.create({
      data: {
        name: "Running",
        audience: "EVERYONE",
        dessertId: dessert.id,
        itemPriceInCents: 0,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 86_400_000),
      },
    })

    const returned = (await load(user.id)).body.offers[0]

    for (const field of ["isActive", "startsAt", "endsAt", "archivedAt"]) {
      expect(returned).not.toHaveProperty(field)
    }
  })

  // The window gates the list as well as the cart - an ended or archived run must not be
  // advertised at all, not merely refused when someone taps Redeem.
  it("leaves out an offer whose run has ended or been archived", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    await db.offer.create({
      data: {
        name: "Ended",
        audience: "EVERYONE",
        dessertId: dessert.id,
        itemPriceInCents: 0,
        endsAt: new Date(Date.now() - 60_000),
      },
    })
    await db.offer.create({
      data: {
        name: "Archived",
        audience: "EVERYONE",
        dessertId: dessert.id,
        itemPriceInCents: 0,
        archivedAt: new Date(),
      },
    })

    const res = await load(user.id)

    expect(res.body.offers).toHaveLength(0)
  })
})
