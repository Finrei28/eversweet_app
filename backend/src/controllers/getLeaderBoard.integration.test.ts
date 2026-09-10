import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeUser } from "../test/factories"
import { nzMonthRange } from "../lib/tradingHours"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

const BOARD = "/api/auth/getLeaderBoard"

const fetchBoard = (userId: string) =>
  request(app).get(BOARD).set("Authorization", `Bearer ${tokenFor(userId)}`)

/** The current New Zealand month, which is the window the endpoint reports on. */
const thisMonth = () => nzMonthRange(new Date())

/**
 * A customer with a loyalty ledger. `at` defaults to mid-month in New Zealand
 * so a test that does not care about the boundary never accidentally lands
 * outside it — the suite would otherwise behave differently on the 1st.
 */
const makeEarner = async (
  entries: { change: number; reason?: string; at?: Date }[],
) => {
  const user = await makeUser()
  const midMonth = new Date(thisMonth().start.getTime() + 15 * 24 * 3600 * 1000)

  const loyalty = await db.loyalty.create({
    data: {
      userId: user.id,
      points: entries.reduce((sum, e) => sum + e.change, 0),
    },
  })

  for (const entry of entries) {
    await db.loyaltyRecord.create({
      data: {
        loyaltyId: loyalty.id,
        change: entry.change,
        reason: entry.reason ?? "EARNED",
        createdAt: entry.at ?? midMonth,
      },
    })
  }

  return { user, loyalty }
}

describeIfDb("GET /api/auth/getLeaderBoard", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  it("counts only what was earned inside the New Zealand month", async () => {
    const { start } = thisMonth()
    const { user } = await makeEarner([
      // One second before NZ midnight on the 1st: last month's business.
      { change: 500, at: new Date(start.getTime() - 1000) },
      // One second after: this month's.
      { change: 40, at: new Date(start.getTime() + 1000) },
    ])

    const res = await fetchBoard(user.id)

    expect(res.status).toBe(200)
    expect(res.body.leaderboard).toHaveLength(1)
    expect(res.body.leaderboard[0].pointsEarned).toBe(40)
    expect(res.body.userRank).toMatchObject({ position: 1, points: 40 })
  })

  it("does not count a refunded redemption as an earning", async () => {
    // Redeem 300 and have the order cancelled: the balance is restored by a
    // positive REFUND record. Counting that as earning made the points free on
    // the board, and the trick repeated.
    const { user } = await makeEarner([
      { change: 100, reason: "EARNED" },
      { change: -300, reason: "REWARDS" },
      { change: 300, reason: "REFUND" },
    ])

    const res = await fetchBoard(user.id)

    expect(res.body.leaderboard[0].pointsEarned).toBe(100)
  })

  it("orders ties the same way on every call", async () => {
    const [a, b, c] = await Promise.all([
      makeEarner([{ change: 400 }]),
      makeEarner([{ change: 400 }]),
      makeEarner([{ change: 400 }]),
    ])

    const first = await fetchBoard(a.user.id)
    const second = await fetchBoard(b.user.id)
    const third = await fetchBoard(c.user.id)

    const ids = (res: { body: { leaderboard: { user: { id: string } }[] } }) =>
      res.body.leaderboard.map((row) => row.user.id)

    expect(ids(first)).toEqual(ids(second))
    expect(ids(second)).toEqual(ids(third))
  })

  it("keeps a tied customer at the same position across calls", async () => {
    const { user } = await makeEarner([{ change: 400 }])
    await makeEarner([{ change: 400 }])
    await makeEarner([{ change: 400 }])

    const positions = new Set<number>()
    for (let i = 0; i < 3; i++) {
      positions.add((await fetchBoard(user.id)).body.userRank.position)
    }

    expect(positions.size).toBe(1)
  })

  it("returns at most ten rows but ranks the viewer beyond them", async () => {
    // Eleven customers, the viewer earning least, so they fall outside the top
    // ten and their rank has to come from the full ordering.
    for (let i = 0; i < 10; i++) {
      await makeEarner([{ change: 1000 + i }])
    }
    const { user } = await makeEarner([{ change: 5 }])

    const res = await fetchBoard(user.id)

    expect(res.body.leaderboard).toHaveLength(10)
    expect(res.body.userRank).toMatchObject({ position: 11, points: 5 })
  })

  it("reports a customer with no points as unranked", async () => {
    const user = await makeUser()
    await makeEarner([{ change: 200 }])

    const res = await fetchBoard(user.id)

    expect(res.body.userRank).toBeNull()
    expect(res.body.leaderboard).toHaveLength(1)
  })

  it("does not create a loyalty row just because someone looked", async () => {
    // This is a GET. It used to upsert, so opening the leaderboard wrote a row.
    const user = await makeUser()

    await fetchBoard(user.id)

    await expect(
      db.loyalty.findUnique({ where: { userId: user.id } }),
    ).resolves.toBeNull()
  })

  it("carries the anonymity flag so the app can withhold a name", async () => {
    const { user } = await makeEarner([{ change: 200 }])
    await db.user.update({
      where: { id: user.id },
      data: { anonymousEnabled: true },
    })

    const res = await fetchBoard(user.id)

    expect(res.body.leaderboard[0].user).toMatchObject({
      anonymousEnabled: true,
    })
  })

  it("refuses an unauthenticated request", async () => {
    await expect(request(app).get(BOARD)).resolves.toMatchObject({
      status: 401,
    })
  })
})
