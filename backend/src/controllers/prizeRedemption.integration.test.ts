import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeUser } from "../test/factories"
import { nzMonthRange } from "../lib/tradingHours"
import { formatPrizeCode, generatePrizeCode } from "../lib/prizeCode"

vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

// Assigning a reward pushes to the winner. Expo is not what these tests are
// about and reaching it would need credentials.
const { sendPushToUser } = vi.hoisted(() => ({
  // Typed to match the real signature so a test can assert on the payload it
  // was handed, not just that it was called.
  sendPushToUser: vi.fn(
    async (
      _userId: string,
      _title: string,
      _body: string,
      _data?: Record<string, unknown>,
    ) => true,
  ),
}))
vi.mock("../lib/pushToUser", () => ({ sendPushToUser }))

const lastMonth = () => nzMonthRange(new Date(), -1)

const asAdmin = (userId: string) => `Bearer ${tokenFor(userId, "ADMIN")}`

/** A settled winner, optionally with a reward already attached. */
const makeWinner = async (
  {
    place = 1,
    reward,
  }: {
    place?: number
    reward?: { code?: string; expiresAt?: Date; redeemedAt?: Date | null }
  } = {},
) => {
  const user = await makeUser()
  const { month, year } = lastMonth()

  const winner = await db.loyaltyWinner.create({
    data: { userId: user.id, place, month, year, points: 900 },
  })

  const created = reward
    ? await db.winnerReward.create({
        data: {
          winnerId: winner.id,
          title: "A free tub of mochi",
          description: "Any flavour",
          code: reward.code ?? generatePrizeCode(),
          // Default well into the future so a test only opts into expiry.
          expiresAt:
            reward.expiresAt ?? new Date(Date.now() + 30 * 24 * 3600 * 1000),
          redeemedAt: reward.redeemedAt ?? null,
        },
      })
    : null

  return { user, winner, reward: created }
}

describeIfDb("prize rewards", () => {
  let adminId: string

  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
    sendPushToUser.mockClear()
    adminId = (await makeUser()).id
    await db.user.update({ where: { id: adminId }, data: { role: "ADMIN" } })
  })

  describe("PUT /api/admin/assignWinnerReward", () => {
    const assign = (body: unknown) =>
      request(app)
        .put("/api/admin/assignWinnerReward")
        .set("Authorization", asAdmin(adminId))
        .send(body as object)

    it("mints a code and tells the winner", async () => {
      const { winner } = await makeWinner()

      const res = await assign({ winnerId: winner.id, title: "A free mochi" })

      expect(res.status).toBe(201)
      expect(res.body.reward.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/)
      expect(sendPushToUser).toHaveBeenCalledTimes(1)
      expect(sendPushToUser.mock.calls[0][3]).toMatchObject({
        type: "PRIZE_READY",
      })
    })

    it("expires the prize at the end of the month after the one won", async () => {
      const { winner } = await makeWinner()

      await assign({ winnerId: winner.id, title: "A free mochi" })

      const stored = await db.winnerReward.findFirst()
      // Won last month, collectable through this one, gone at the start of the
      // next — computed from the month that was won, not from today.
      expect(stored!.expiresAt.toISOString()).toBe(
        nzMonthRange(new Date()).end.toISOString(),
      )
    })

    it("does not extend the deadline when staff assign late", async () => {
      // Two months late. The prize is already expired on arrival rather than
      // silently getting a fresh window.
      const user = await makeUser()
      const { month, year } = nzMonthRange(new Date(), -3)
      const winner = await db.loyaltyWinner.create({
        data: { userId: user.id, place: 1, month, year, points: 500 },
      })

      await assign({ winnerId: winner.id, title: "A free mochi" })

      const stored = await db.winnerReward.findFirst()
      expect(stored!.expiresAt.getTime()).toBeLessThan(Date.now())
    })

    it("edits the wording without rotating the code", async () => {
      // A customer may already be holding a screenshot of it.
      const { winner, reward } = await makeWinner({ reward: {} })

      const res = await assign({
        winnerId: winner.id,
        title: "Two free mochi",
        description: "Any flavour, one visit",
      })

      expect(res.status).toBe(200)
      const stored = await db.winnerReward.findUnique({
        where: { id: reward!.id },
      })
      expect(stored!.code).toBe(reward!.code)
      expect(stored!.title).toBe("Two free mochi")
    })

    it("does not push again on an edit", async () => {
      const { winner } = await makeWinner({ reward: {} })

      await assign({ winnerId: winner.id, title: "Two free mochi" })

      expect(sendPushToUser).not.toHaveBeenCalled()
    })

    it("refuses to change a prize that has been collected", async () => {
      const { winner } = await makeWinner({
        reward: { redeemedAt: new Date() },
      })

      const res = await assign({ winnerId: winner.id, title: "Something else" })

      expect(res.status).toBe(409)
    })

    it("refuses a winner whose account has closed", async () => {
      const { winner } = await makeWinner()
      await db.loyaltyWinner.update({
        where: { id: winner.id },
        data: { userId: null },
      })

      const res = await assign({ winnerId: winner.id, title: "A free mochi" })

      expect(res.status).toBe(409)
    })

    it("requires a title", async () => {
      const { winner } = await makeWinner()

      expect((await assign({ winnerId: winner.id })).status).toBe(400)
      expect(
        (await assign({ winnerId: winner.id, title: "   " })).status,
      ).toBe(400)
    })

    it("refuses a non-admin", async () => {
      const { winner } = await makeWinner()
      const customer = await makeUser()

      const res = await request(app)
        .put("/api/admin/assignWinnerReward")
        .set("Authorization", `Bearer ${tokenFor(customer.id)}`)
        .send({ winnerId: winner.id, title: "A free mochi" })

      expect(res.status).toBe(403)
    })
  })

  describe("GET /api/admin/verifyPrizeCode", () => {
    const verify = (code: string) =>
      request(app)
        .get("/api/admin/verifyPrizeCode")
        .query({ code })
        .set("Authorization", asAdmin(adminId))

    it("names who is standing there and what they are owed", async () => {
      const { user, reward } = await makeWinner({ reward: {} })

      const res = await verify(reward!.code)

      expect(res.status).toBe(200)
      expect(res.body.valid).toBe(true)
      expect(res.body.winner).toMatchObject({
        firstName: user.firstName,
        lastName: user.lastName,
        place: 1,
      })
      expect(res.body.winner.reward.title).toBe("A free tub of mochi")
    })

    it("does not spend the code", async () => {
      // The whole reason verify and redeem are separate.
      const { reward } = await makeWinner({ reward: {} })

      await verify(reward!.code)
      await verify(reward!.code)

      const stored = await db.winnerReward.findUnique({
        where: { id: reward!.id },
      })
      expect(stored!.redeemedAt).toBeNull()
    })

    it("accepts the code however carefully it was typed", async () => {
      const { reward } = await makeWinner({ reward: { code: "7K4MQ92X" } })

      for (const typed of ["7K4MQ92X", "7k4mq92x", "7K4M-Q92X", " 7k4m q92x "]) {
        expect((await verify(typed)).body.valid).toBe(true)
      }
    })

    it("reports an already collected prize as collected, not as invalid", async () => {
      const { reward } = await makeWinner({
        reward: { redeemedAt: new Date() },
      })

      const res = await verify(reward!.code)

      expect(res.body.reason).toBe("ALREADY_REDEEMED")
    })

    it("reports an expired prize as expired", async () => {
      const { reward } = await makeWinner({
        reward: { expiresAt: new Date(Date.now() - 1000) },
      })

      const res = await verify(reward!.code)

      expect(res.body.reason).toBe("EXPIRED")
    })

    it("refuses an unknown code", async () => {
      expect((await verify(generatePrizeCode())).status).toBe(404)
    })

    it("cuts off a staff account that starts guessing", async () => {
      // Verify reads without committing, which makes it the oracle of the two:
      // it says whether a code exists. Only an ADMIN token can reach it, so
      // this is not sized against the internet — it is what stops a borrowed
      // staff account walking the code space.
      const statuses: number[] = []
      for (let attempt = 0; attempt < 35; attempt++) {
        statuses.push((await verify(generatePrizeCode())).status)
      }

      expect(statuses).toContain(429)
    })

    it("counts against the staff account, not the shop's IP", async () => {
      // Every till in the shop shares one egress address. Keying on the IP
      // would let one counter guessing lock out every other counter mid-service
      // — which is why the limiters are mounted after authenticateToken, where
      // req.userId exists to key on.
      const other = (await makeUser()).id
      await db.user.update({ where: { id: other }, data: { role: "ADMIN" } })

      for (let attempt = 0; attempt < 35; attempt++) {
        await verify(generatePrizeCode())
      }

      // Same IP (supertest), different staff account: still served.
      const stillWorking = await request(app)
        .get("/api/admin/verifyPrizeCode")
        .query({ code: generatePrizeCode() })
        .set("Authorization", asAdmin(other))

      expect(stillWorking.status).toBe(404)
    })
  })

  describe("POST /api/admin/redeemPrizeCode", () => {
    const redeem = (code: string, admin = adminId) =>
      request(app)
        .post("/api/admin/redeemPrizeCode")
        .set("Authorization", asAdmin(admin))
        .send({ code })

    it("collects the prize and records who handed it over", async () => {
      const { reward } = await makeWinner({ reward: {} })

      const res = await redeem(formatPrizeCode(reward!.code))

      expect(res.status).toBe(200)
      expect(res.body.redeemed).toBe(true)
      const stored = await db.winnerReward.findUnique({
        where: { id: reward!.id },
      })
      expect(stored!.redeemedAt).not.toBeNull()
      expect(stored!.redeemedByAdminId).toBe(adminId)
    })

    it("tells staff it was already collected rather than that it is invalid", async () => {
      // Read as a typo, staff retype it — and the second time round an
      // "invalid" reply looks like a fresh code, which is how a prize gets
      // handed over twice.
      const { reward } = await makeWinner({ reward: {} })

      await redeem(reward!.code)
      const second = await redeem(reward!.code)

      expect(second.status).toBe(409)
      expect(second.body.reason).toBe("ALREADY_REDEEMED")
      expect(second.body.message).toMatch(/already collected/i)
    })

    it("lets only one of two tablets win the same code", async () => {
      const { reward } = await makeWinner({ reward: {} })
      const other = (await makeUser()).id
      await db.user.update({ where: { id: other }, data: { role: "ADMIN" } })

      const [a, b] = await Promise.all([
        redeem(reward!.code),
        redeem(reward!.code, other),
      ])

      expect([a.status, b.status].sort()).toEqual([200, 409])
      const stored = await db.winnerReward.findUnique({
        where: { id: reward!.id },
      })
      // Whoever won, exactly one admin is recorded as having handed it over.
      expect([adminId, other]).toContain(stored!.redeemedByAdminId)
    })

    it("refuses an expired prize", async () => {
      const { reward } = await makeWinner({
        reward: { expiresAt: new Date(Date.now() - 1000) },
      })

      const res = await redeem(reward!.code)

      expect(res.status).toBe(409)
      expect(res.body.reason).toBe("EXPIRED")
      const stored = await db.winnerReward.findUnique({
        where: { id: reward!.id },
      })
      expect(stored!.redeemedAt).toBeNull()
    })

    it("refuses an unknown code without saying anything useful about it", async () => {
      const res = await redeem(generatePrizeCode())

      expect(res.status).toBe(404)
      expect(res.body.reason).toBe("NOT_FOUND")
    })

    it("refuses a non-admin", async () => {
      const { reward } = await makeWinner({ reward: {} })
      const customer = await makeUser()

      const res = await request(app)
        .post("/api/admin/redeemPrizeCode")
        .set("Authorization", `Bearer ${tokenFor(customer.id)}`)
        .send({ code: reward!.code })

      expect(res.status).toBe(403)
      const stored = await db.winnerReward.findUnique({
        where: { id: reward!.id },
      })
      expect(stored!.redeemedAt).toBeNull()
    })
  })

  describe("GET /api/auth/getMyPrizes", () => {
    const myPrizes = (userId: string) =>
      request(app)
        .get("/api/auth/getMyPrizes")
        .set("Authorization", `Bearer ${tokenFor(userId)}`)

    it("gives the winner their code", async () => {
      const { user, reward } = await makeWinner({ reward: {} })

      const res = await myPrizes(user.id)

      expect(res.status).toBe(200)
      expect(res.body.prizes).toHaveLength(1)
      expect(res.body.prizes[0].reward.code).toBe(
        formatPrizeCode(reward!.code),
      )
    })

    it("says they placed even before staff have decided on a prize", async () => {
      const { user } = await makeWinner({ place: 2 })

      const res = await myPrizes(user.id)

      expect(res.body.prizes[0]).toMatchObject({ place: 2, reward: null })
    })

    it("withholds the code once the prize expires", async () => {
      // The counter would refuse it, so the app must never be able to put it on
      // screen. The customer finds out on their own phone, not in a queue.
      const { user } = await makeWinner({
        reward: { expiresAt: new Date(Date.now() - 1000) },
      })

      const res = await myPrizes(user.id)

      expect(res.body.prizes).toHaveLength(0)
    })

    it("withholds the code once the prize is collected", async () => {
      const { user } = await makeWinner({
        reward: { redeemedAt: new Date() },
      })

      const res = await myPrizes(user.id)

      // Still shown briefly, so "you collected this" is visible — but with no
      // code on it.
      expect(res.body.prizes).toHaveLength(1)
      expect(res.body.prizes[0].reward.code).toBeNull()
      expect(res.body.prizes[0].reward.redeemedAt).not.toBeNull()
    })

    it("never shows one customer another's prize", async () => {
      await makeWinner({ reward: {} })
      const stranger = await makeUser()

      const res = await myPrizes(stranger.id)

      expect(res.body.prizes).toEqual([])
    })

    it("returns every live prize when someone wins twice running", async () => {
      const user = await makeUser()
      for (const offset of [-1, -2]) {
        const { month, year } = nzMonthRange(new Date(), offset)
        const winner = await db.loyaltyWinner.create({
          data: { userId: user.id, place: 1, month, year, points: 900 },
        })
        await db.winnerReward.create({
          data: {
            winnerId: winner.id,
            title: `Prize for ${month}`,
            code: generatePrizeCode(),
            expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
          },
        })
      }

      const res = await myPrizes(user.id)

      expect(res.body.prizes).toHaveLength(2)
      expect(res.body.prizes.every((p: { reward: { code: string } }) => p.reward.code)).toBe(true)
    })

    it("refuses an unauthenticated request", async () => {
      const res = await request(app).get("/api/auth/getMyPrizes")
      expect(res.status).toBe(401)
    })
  })
})
