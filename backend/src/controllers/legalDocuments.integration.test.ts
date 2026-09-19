import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { invalidateShopProfile } from "../lib/storeInfo"
import { LEGAL_LAST_UPDATED } from "../legal/legalDocuments"
import { describeIfDb, resetDatabase } from "../test/db"

vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

/**
 * The two legal endpoints.
 *
 * What these pin is the wire shape and the fact that the shop's details arrive resolved.
 * The app has no over-the-air updates, so a key renamed here reaches phones that cannot be
 * fixed; and a document that went out with `{{email}}` still in it would be a legal
 * document telling a customer to contact a template placeholder.
 */
describeIfDb("the legal documents over HTTP", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  describe.each([
    ["/api/getPrivacyPolicy", "privacy_policy", "Privacy Policy"],
    ["/api/getTermAndConditions", "terms_and_conditions", "Terms & Conditions"],
  ])("GET %s", (path, type, title) => {
    it("serves the shape installed app builds read", async () => {
      const res = await request(app).get(path)

      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({
        type,
        title,
        lastUpdated: LEGAL_LAST_UPDATED,
      })
      expect(Array.isArray(res.body.sections)).toBe(true)
      expect(res.body.sections.length).toBeGreaterThan(0)

      for (const section of res.body.sections) {
        expect(typeof section.heading).toBe("string")
        expect(
          section.content !== undefined || Array.isArray(section.list),
        ).toBe(true)
      }
    })

    it("resolves the shop's details rather than sending a template", async () => {
      const res = await request(app).get(path)

      const text = JSON.stringify(res.body)
      expect(text).not.toMatch(/\{\{|\}\}/)
      expect(text).toContain("eversweet@eversweet.co.nz")
      expect(text).toContain("Meadowland")
    })

    /** The details come from ShopProfile, so moving shop moves them in the documents. */
    it("follows a change to the shop's details", async () => {
      await db.shopProfile.updateMany({
        data: { email: "hello@eversweet.co.nz", phone: "09 000 0000" },
      })
      invalidateShopProfile()

      const res = await request(app).get(path)

      const text = JSON.stringify(res.body)
      expect(text).toContain("hello@eversweet.co.nz")
      expect(text).toContain("09 000 0000")
      expect(text).not.toContain("eversweet@eversweet.co.nz")
    })

    /**
     * The labels are the whole point of there being one document rather than two. An older
     * app build ignores the key and shows the section unlabelled, which is why it is
     * optional rather than part of the shape above.
     */
    it("carries the platform labels", async () => {
      const res = await request(app).get(path)

      const labelled = res.body.sections.filter(
        (section: { appliesTo?: string[] }) => section.appliesTo !== undefined,
      )
      expect(labelled.length).toBeGreaterThan(0)

      for (const section of labelled) {
        for (const platform of section.appliesTo) {
          expect(["app", "web"]).toContain(platform)
        }
      }
    })

    /**
     * Still answers with the shop's details when the table cannot be read: `getShopProfile`
     * falls back to the values that used to be hardcoded. A legal page that renders a gap
     * where the contact details belong is worse than one showing a slightly stale address.
     */
    it("still answers when the shop's details cannot be read", async () => {
      invalidateShopProfile()
      const findFirst = vi
        .spyOn(db.shopProfile, "findFirst")
        .mockRejectedValueOnce(new Error("connection terminated"))
      vi.spyOn(console, "error").mockImplementation(() => {})

      const res = await request(app).get(path)

      expect(res.status).toBe(200)
      expect(JSON.stringify(res.body)).toContain("Meadowland")

      findFirst.mockRestore()
      vi.restoreAllMocks()
    })
  })
})
