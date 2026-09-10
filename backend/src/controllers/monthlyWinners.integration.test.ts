import { beforeEach, describe, expect, it, vi } from "vitest"
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

/** The New Zealand month that just ended — the one the cron settles. */
const lastMonth = () => nzMonthRange(new Date(), -1)

/** A moment safely inside last month, offset by `minutes` for ordering. */
const during = (minutes = 0) =>
  new Date(lastMonth().start.getTime() + 24 * 3600 * 1000 + minutes * 60_000)

/**
 * A customer with a loyalty ledger for last month.
 *
 * `at` controls when each record lands, which is what the tie-break reads: of
 * two customers on equal points, the one whose *last* earning came earlier wins.
 */
const makeEarner = async (
  entries: { change: number; reason?: string; at?: Date }[],
) => {
  const user = await makeUser()
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
        createdAt: entry.at ?? during(),
      },
    })
  }

  return { user, loyalty }
}

const podium = async () => {
  const { month, year } = lastMonth()
  return db.loyaltyWinner.findMany({
    where: { month, year },
    orderBy: { place: "asc" },
    select: { place: true, userId: true, points: true },
  })
}

describeIfDb("settleMonthlyWinners", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  it("records the top three in order", async () => {
    const third = await makeEarner([{ change: 100 }])
    const first = await makeEarner([{ change: 900 }])
    const second = await makeEarner([{ change: 400 }])

    const result = await settleMonthlyWinners()

    expect(result.recorded).toBe(3)
    expect(await podium()).toEqual([
      { place: 1, userId: first.user.id, points: 900 },
      { place: 2, userId: second.user.id, points: 400 },
      { place: 3, userId: third.user.id, points: 100 },
    ])
  })

  it("records only as many places as there were earners", async () => {
    const only = await makeEarner([{ change: 50 }])

    await settleMonthlyWinners()

    expect(await podium()).toEqual([
      { place: 1, userId: only.user.id, points: 50 },
    ])
  })

  it("records nothing when nobody earned anything", async () => {
    await makeUser()

    const result = await settleMonthlyWinners()

    expect(result.recorded).toBe(0)
    expect(await podium()).toEqual([])
  })

  it("stops at three even when more people earned", async () => {
    for (const change of [500, 400, 300, 200, 100]) {
      await makeEarner([{ change }])
    }

    await settleMonthlyWinners()

    expect(await podium()).toHaveLength(3)
  })

  it("gives a tie to whoever got there first", async () => {
    // Both finish on 400. The one whose last earning landed earlier reached
    // that total first and takes the higher place.
    const slower = await makeEarner([
      { change: 200, at: during(10) },
      { change: 200, at: during(500) },
    ])
    const faster = await makeEarner([
      { change: 200, at: during(20) },
      { change: 200, at: during(30) },
    ])

    await settleMonthlyWinners()

    expect(await podium()).toEqual([
      { place: 1, userId: faster.user.id, points: 400 },
      { place: 2, userId: slower.user.id, points: 400 },
    ])
  })

  it("breaks a tie at the third and fourth boundary rather than picking at random", async () => {
    // The old tie-break only ever resolved first place, so a tie for third came
    // out in whatever order Postgres happened to emit — and which of the two got
    // a prize changed between runs.
    await makeEarner([{ change: 900, at: during(1) }])
    await makeEarner([{ change: 800, at: during(2) }])
    const onThePodium = await makeEarner([{ change: 300, at: during(10) }])
    const justMissed = await makeEarner([{ change: 300, at: during(90) }])

    await settleMonthlyWinners()

    const places = await podium()
    expect(places[2]).toEqual({
      place: 3,
      userId: onThePodium.user.id,
      points: 300,
    })
    expect(places.map((p) => p.userId)).not.toContain(justMissed.user.id)
  })

  it("orders the podium the same way the live board does", async () => {
    // The two must not disagree: the board a customer watched all month has to
    // be the board that pays out.
    await makeEarner([{ change: 400, at: during(5) }])
    await makeEarner([{ change: 400, at: during(50) }])
    await makeEarner([{ change: 400, at: during(500) }])

    await settleMonthlyWinners()
    const settled = (await podium()).map((p) => p.userId)

    const board = await db.loyaltyRecord.groupBy({
      by: ["loyaltyId"],
      where: {
        change: { gt: 0 },
        reason: "EARNED",
        createdAt: { gte: lastMonth().start, lt: lastMonth().end },
      },
      _sum: { change: true },
      _max: { createdAt: true },
      orderBy: [
        { _sum: { change: "desc" } },
        { _max: { createdAt: "asc" } },
        { loyaltyId: "asc" },
      ],
    })
    const loyalties = await db.loyalty.findMany({
      where: { id: { in: board.map((b) => b.loyaltyId) } },
      select: { id: true, userId: true },
    })
    const userIdFor = new Map(loyalties.map((l) => [l.id, l.userId]))

    expect(settled).toEqual(board.map((b) => userIdFor.get(b.loyaltyId)))
  })

  it("does not count a refunded redemption as an earning", async () => {
    // Redeem 500 and have the order cancelled: the balance comes back as a
    // positive REFUND record. Counting it would crown someone the board never
    // showed in front all month.
    const inflated = await makeEarner([
      { change: 100, reason: "EARNED" },
      { change: -500, reason: "REWARDS" },
      { change: 500, reason: "REFUND" },
    ])
    const genuine = await makeEarner([{ change: 300 }])

    await settleMonthlyWinners()

    expect(await podium()).toEqual([
      { place: 1, userId: genuine.user.id, points: 300 },
      { place: 2, userId: inflated.user.id, points: 100 },
    ])
  })

  it("ignores earnings from outside the month", async () => {
    const { start, end } = lastMonth()
    const inside = await makeEarner([
      { change: 40, at: new Date(start.getTime() + 1000) },
    ])
    await makeEarner([{ change: 5000, at: new Date(start.getTime() - 1000) }])
    await makeEarner([{ change: 5000, at: new Date(end.getTime() + 1000) }])

    await settleMonthlyWinners()

    expect(await podium()).toEqual([
      { place: 1, userId: inside.user.id, points: 40 },
    ])
  })

  it("is a no-op when the same month is settled twice", async () => {
    // cron.schedule runs in every process, so instances genuinely race this.
    await makeEarner([{ change: 900 }])
    await makeEarner([{ change: 400 }])

    await settleMonthlyWinners()
    const second = await settleMonthlyWinners()

    expect(second.recorded).toBe(0)
    expect(await podium()).toHaveLength(2)
  })

  it("survives two settles running at once without half-settling a month", async () => {
    await makeEarner([{ change: 900 }])
    await makeEarner([{ change: 400 }])
    await makeEarner([{ change: 100 }])

    const results = await Promise.all([
      settleMonthlyWinners(),
      settleMonthlyWinners(),
    ])

    // One writes all three, the other writes none — never one and a half.
    expect(results.map((r) => r.recorded).sort()).toEqual([0, 3])
    expect(await podium()).toHaveLength(3)
  })

  it("settles an older month when asked, for one the cron missed", async () => {
    const twoMonthsAgo = nzMonthRange(new Date(), -2)
    const earner = await makeEarner([
      { change: 250, at: new Date(twoMonthsAgo.start.getTime() + 3600 * 1000) },
    ])

    const result = await settleMonthlyWinners(-2)

    expect(result).toMatchObject({
      month: twoMonthsAgo.month,
      year: twoMonthsAgo.year,
      recorded: 1,
    })
    const settled = await db.loyaltyWinner.findMany({
      where: { month: twoMonthsAgo.month, year: twoMonthsAgo.year },
    })
    expect(settled[0]).toMatchObject({ userId: earner.user.id, points: 250 })
  })

  it("keeps the podium when a winner closes their account", async () => {
    // SetNull, not Cascade: the shop's record of who won survives, anonymised,
    // and the prize simply becomes unclaimable.
    //
    // The ledger has to go first. LoyaltyRecord.loyalty carries no onDelete, so
    // it defaults to Restrict and blocks deleting any customer who has ever
    // earned a point — which is why nothing in the API deletes an account today.
    // Whatever eventually does will have to unwind in this order, and this is
    // the state the podium has to survive.
    const winner = await makeEarner([{ change: 900 }])

    await settleMonthlyWinners()

    await db.loyaltyRecord.deleteMany({ where: { loyaltyId: winner.loyalty.id } })
    await db.loyalty.delete({ where: { id: winner.loyalty.id } })
    await db.user.delete({ where: { id: winner.user.id } })

    expect(await podium()).toEqual([{ place: 1, userId: null, points: 900 }])
  })
})

describeIfDb("POST /api/admin/settleMonth", () => {
  let adminId: string

  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
    adminId = (await makeUser()).id
    await db.user.update({ where: { id: adminId }, data: { role: "ADMIN" } })
  })

  const settle = (body: unknown, who = adminId) =>
    request(app)
      .post("/api/admin/settleMonth")
      .set("Authorization", `Bearer ${tokenFor(who, "ADMIN")}`)
      .send(body as object)

  it("settles the month it was asked for, not some other one", async () => {
    // The endpoint turns an absolute (month, year) into the offset
    // settleMonthlyWinners counts backwards by. An off-by-one here settles the
    // wrong month — the exact shape of bug this feature has already had twice.
    const target = nzMonthRange(new Date(), -2)
    await makeEarner([
      { change: 300, at: new Date(target.start.getTime() + 3600 * 1000) },
    ])

    const res = await settle({ month: target.month, year: target.year })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      month: target.month,
      year: target.year,
      recorded: 1,
    })
  })

  it("settles the right month across a year boundary", async () => {
    // December of the previous year, requested from whatever month it is now.
    const target = nzMonthRange(new Date(), -13)

    const res = await settle({ month: target.month, year: target.year })

    expect(res.body).toMatchObject({ month: target.month, year: target.year })
  })

  it("refuses the month currently being competed for", async () => {
    const now = nzMonthRange(new Date())

    const res = await settle({ month: now.month, year: now.year })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/not finished/i)
  })

  it("refuses a future month", async () => {
    const next = nzMonthRange(new Date(), 1)

    expect((await settle({ month: next.month, year: next.year })).status).toBe(
      400,
    )
  })

  it("refuses a month outside 1 to 12", async () => {
    expect((await settle({ month: 0, year: 2026 })).status).toBe(400)
    expect((await settle({ month: 13, year: 2026 })).status).toBe(400)
    expect((await settle({ month: "7", year: 2026 })).status).toBe(400)
  })

  it("refuses a nonsense year", async () => {
    expect((await settle({ month: 7, year: 1066 })).status).toBe(400)
    expect((await settle({ month: 7 })).status).toBe(400)
  })

  it("writes nothing the second time", async () => {
    const target = nzMonthRange(new Date(), -2)
    await makeEarner([
      { change: 300, at: new Date(target.start.getTime() + 3600 * 1000) },
    ])

    await settle({ month: target.month, year: target.year })
    const second = await settle({ month: target.month, year: target.year })

    expect(second.body.recorded).toBe(0)
  })

  it("refuses a non-admin", async () => {
    const customer = await makeUser()
    const target = nzMonthRange(new Date(), -2)

    const res = await request(app)
      .post("/api/admin/settleMonth")
      .set("Authorization", `Bearer ${tokenFor(customer.id)}`)
      .send({ month: target.month, year: target.year })

    expect(res.status).toBe(403)
  })
})
