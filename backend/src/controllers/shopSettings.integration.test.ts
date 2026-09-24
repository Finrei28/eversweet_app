import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { invalidateLoyaltyRates } from "../lib/loyaltyRates"
import { invalidateShopProfile } from "../lib/storeInfo"
import { invalidateAnnouncements } from "../lib/announcements"
import { describeIfDb, resetDatabase } from "../test/db"

vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

/**
 * The settings that moved out of code and into the database.
 *
 * What these mostly pin is the **wire shape**. The app has no over-the-air updates, so a
 * field renamed or a type changed here reaches phones that cannot be fixed; every one of
 * these endpoints is read by builds already installed. The hours endpoint is guarded the
 * same way in `storeHours.integration.test.ts`.
 */
describeIfDb("shop settings served from the database", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  describe("GET /api/getLoyaltyRates", () => {
    /**
     * Three keys, plain numbers. `frontend/store/cart.ts` multiplies by these to show
     * "Earn N points" before an order is placed, so a shape change silently stops the
     * preview agreeing with what the order actually awards.
     */
    it("serves the shape installed app builds read", async () => {
      const res = await request(app).get("/api/getLoyaltyRates")

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ rate: 6, memberRate: 1.5, modifier: 1 })
    })

    it("converts whole percent back to the multipliers the app expects", async () => {
      await db.loyaltySetting.updateMany({
        data: { memberBonusPercent: 175, modifierPercent: 200 },
      })
      invalidateLoyaltyRates()

      const res = await request(app).get("/api/getLoyaltyRates")

      expect(res.body).toMatchObject({ memberRate: 1.75, modifier: 2 })
    })

    /** The seeded row must earn exactly what the constants earned. */
    it("reads the seeded row as the rates that were hardcoded", async () => {
      const row = await db.loyaltySetting.findFirst()

      expect(row).toMatchObject({
        pointsPerDollar: 6,
        memberBonusPercent: 150,
        modifierPercent: 100,
      })
    })
  })

  describe("GET /api/getStoreInfo", () => {
    it("serves the shop's details from the table, with every field the app reads", async () => {
      const res = await request(app).get("/api/getStoreInfo")

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({
        name: "Eversweet",
        address: "5D/119 Meadowland Drive, Somerville",
        city: "Auckland",
        state: "Auckland",
        postal: "2014",
        phone: "09 949 1050",
        email: "eversweet@eversweet.co.nz",
        website: "https://eversweet.co.nz",
      })
      expect(res.body).toHaveProperty("isOpen")
    })

    it("follows a change to the table", async () => {
      await db.shopProfile.updateMany({ data: { phone: "09 000 0000" } })
      invalidateShopProfile()

      const res = await request(app).get("/api/getStoreInfo")

      expect(res.body.phone).toBe("09 000 0000")
    })

    /**
     * isOpen is computed, not stored. Keeping it out of the table is deliberate: it used to
     * be worked out once at server start and served unchanged until the next deploy.
     */
    it("does not store isOpen on the row", async () => {
      const row = await db.shopProfile.findFirst()

      expect(row).not.toHaveProperty("isOpen")
    })
  })

  describe("GET /api/getAnnouncements", () => {
    const announcement = (overrides: Record<string, unknown> = {}) => ({
      title: "Closed Tuesday",
      text1: "We are shut for a private event.",
      publishedAt: new Date("2026-07-01T00:00:00.000Z"),
      ...overrides,
    })

    it("serves an array in the shape installed app builds read", async () => {
      await db.announcement.create({ data: announcement() })
      invalidateAnnouncements()

      const res = await request(app).get("/api/getAnnouncements")

      expect(res.status).toBe(200)
      expect(res.body).toEqual([
        {
          title: "Closed Tuesday",
          text1: "We are shut for a private event.",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ])
    })

    /**
     * The app compares `updatedAt` against the last announcement it showed, so it has to be
     * something `new Date()` reads. It carries `publishedAt` rather than the row's own
     * `updatedAt` precisely so that fixing a typo does not re-show the pop-up to everyone.
     */
    it("sends publishedAt as a date the app can parse, not the row's updatedAt", async () => {
      const row = await db.announcement.create({ data: announcement() })
      invalidateAnnouncements()

      await db.announcement.update({
        where: { id: row.id },
        data: { text1: "We are shut for a private function." },
      })
      invalidateAnnouncements()

      const res = await request(app).get("/api/getAnnouncements")

      expect(res.body[0].updatedAt).toBe("2026-07-01T00:00:00.000Z")
      expect(Number.isNaN(new Date(res.body[0].updatedAt).getTime())).toBe(false)
    })

    it("omits text2 entirely when the row has none", async () => {
      await db.announcement.create({ data: announcement({ text2: null }) })
      invalidateAnnouncements()

      const res = await request(app).get("/api/getAnnouncements")

      expect(res.body[0]).not.toHaveProperty("text2")
    })

    it("orders by position, so the pop-up's pages keep their order", async () => {
      await db.announcement.createMany({
        data: [
          announcement({ title: "Second", position: 1 }),
          announcement({ title: "First", position: 0 }),
        ],
      })
      invalidateAnnouncements()

      const res = await request(app).get("/api/getAnnouncements")

      expect(res.body.map((a: { title: string }) => a.title)).toEqual([
        "First",
        "Second",
      ])
    })

    it("leaves out a retired announcement", async () => {
      await db.announcement.create({ data: announcement({ isActive: false }) })
      invalidateAnnouncements()

      const res = await request(app).get("/api/getAnnouncements")

      expect(res.body).toEqual([])
    })

    /**
     * This is the app's first request on a cold start - the one that trips the version gate
     * before the splash hides - so it answers rather than failing. An empty list is a state
     * the app already handles; a 500 is not.
     */
    it("answers with an empty list rather than failing", async () => {
      invalidateAnnouncements()
      const findMany = vi
        .spyOn(db.announcement, "findMany")
        .mockRejectedValueOnce(new Error("connection terminated"))
      vi.spyOn(console, "error").mockImplementation(() => {})

      const res = await request(app).get("/api/getAnnouncements")

      expect(res.status).toBe(200)
      expect(res.body).toEqual([])

      findMany.mockRestore()
      vi.restoreAllMocks()
    })
  })
})
