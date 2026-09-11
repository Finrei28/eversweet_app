import { beforeEach, expect, it } from "vitest"

import { db } from "../lib/db"
import { describeIfDb, resetDatabase } from "../test/db"
import { makeDessert, makeUser } from "../test/factories"
import { renewWeeklyOffers } from "./admin.controller"

/**
 * The Monday cron was `offerRedemption.updateMany({ data: { used: 0 } })` with no `where`
 * at all, so it reset the usage counter on every redemption row in the database rather
 * than the weekly mochi perk it is named after. Harmless only while `status` was written
 * REDEEMED on every use; now that REDEEMED means "used up to the limit", an unscoped
 * reset would hand back every requirement-gated offer once a week — exactly what the
 * admin's Close run deletes rows to prevent.
 */
describeIfDb("renewWeeklyOffers", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  const redemptionFor = async (
    offerId: string,
    userId: string,
    used: number,
  ) =>
    db.offerRedemption.create({
      data: { offerId, userId, used, status: "REDEEMED" },
    })

  it("hands back a weekly offer, counter and status together", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    const offer = await db.offer.create({
      data: {
        name: "Free weekly mochi dessert bowl",
        audience: "MEMBERS",
        dessertId: dessert.id,
        itemPriceInCents: 0,
        renewsWeekly: true,
      },
    })
    await redemptionFor(offer.id, user.id, 1)

    await renewWeeklyOffers()

    const row = await db.offerRedemption.findUnique({
      where: { offerId_userId: { offerId: offer.id, userId: user.id } },
    })
    // status has no @default, so zeroing the counter alone leaves the row REDEEMED —
    // which is what showed a member a greyed, inert Redeem button every Monday.
    expect(row?.used).toBe(0)
    expect(row?.status).toBe("AVAILABLE")
  })

  it("leaves every other offer alone", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)

    const gated = await db.offer.create({
      data: {
        name: "Buy 4 Mochi Bowls and get one for free",
        audience: "EVERYONE",
        dessertId: dessert.id,
        itemPriceInCents: 0,
        requirements: { create: [{ dessertId: dessert.id, quantity: 4 }] },
      },
    })
    const ordinary = await db.offer.create({
      data: {
        name: "Half price scoop",
        audience: "EVERYONE",
        dessertId: dessert.id,
        discountAmount: 50,
      },
    })

    await redemptionFor(gated.id, user.id, 1)
    await redemptionFor(ordinary.id, user.id, 1)

    await renewWeeklyOffers()

    for (const offerId of [gated.id, ordinary.id]) {
      const row = await db.offerRedemption.findUnique({
        where: { offerId_userId: { offerId, userId: user.id } },
      })
      expect(row?.used).toBe(1)
      expect(row?.status).toBe("REDEEMED")
    }
  })

  it("does not renew an archived offer", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)
    const offer = await db.offer.create({
      data: {
        name: "Retired weekly perk",
        audience: "MEMBERS",
        dessertId: dessert.id,
        itemPriceInCents: 0,
        renewsWeekly: true,
        archivedAt: new Date(),
      },
    })
    await redemptionFor(offer.id, user.id, 1)

    await renewWeeklyOffers()

    const row = await db.offerRedemption.findUnique({
      where: { offerId_userId: { offerId: offer.id, userId: user.id } },
    })
    expect(row?.used).toBe(1)
  })
})
