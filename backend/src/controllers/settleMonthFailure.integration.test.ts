import { beforeEach, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeUser } from "../test/factories"
import { nzMonthRange } from "../lib/tradingHours"
import { settleMonthlyWinners } from "./client.controller"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

// The ranking is where a settle reaches the database first, so failing it is the
// honest stand-in for the database going away mid-settle. Its own file because the
// mock replaces the ranking for everything that imports it.
vi.mock("../lib/leaderboardRanking", () => ({
  rankMonth: vi.fn(async () => {
    throw new Error("connection terminated unexpectedly")
  }),
}))

/**
 * settleMonthlyWinners swallows its own error, because the cron must not throw. The
 * manual backfill used to swallow it with it and answer 200, so a failed settle read as
 * a successful one that simply recorded nobody.
 */
describeIfDb("a settle that fails", () => {
  let adminId: string

  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
    adminId = (await makeUser()).id
    await db.user.update({ where: { id: adminId }, data: { role: "ADMIN" } })
  })

  it("still does not throw from the cron", async () => {
    await expect(settleMonthlyWinners()).resolves.toMatchObject({
      outcome: "FAILED",
      recorded: 0,
    })
  })

  it("answers 500 from the manual backfill rather than reporting success", async () => {
    const target = nzMonthRange(new Date(), -2)

    const res = await request(app)
      .post("/api/admin/settleMonth")
      .set("Authorization", `Bearer ${tokenFor(adminId, "ADMIN")}`)
      .send({ month: target.month, year: target.year })

    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ outcome: "FAILED" })
    expect(JSON.stringify(res.body)).not.toContain("connection terminated")
  })
})
