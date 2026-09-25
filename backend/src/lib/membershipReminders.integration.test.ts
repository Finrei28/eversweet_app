import { beforeEach, describe, expect, it, vi } from "vitest"

// Typed with the real signature, so `mock.calls[0][2]` is checked rather than inferred as an
// empty tuple.
const { sendPushToUser } = vi.hoisted(() => ({
  sendPushToUser: vi.fn(
    async (
      _userId: string,
      _title: string,
      _body: string,
      _data?: Record<string, unknown>,
    ) => true,
  ),
}))
vi.mock("./pushToUser", () => ({ sendPushToUser }))

import { redisStub as redis } from "../test/redisStub"

vi.mock("./redis", () => ({
  get redis() {
    return redis.redis
  },
}))

import { db } from "./db"
import { invalidateLoyaltyRates } from "./loyaltyRates"
import { claimEndWarning, warnMembershipsEnding } from "./membershipReminders"
import { describeIfDb, resetDatabase } from "../test/db"
import { makeUser } from "../test/factories"

/**
 * The reminder before a cancelled membership ends.
 *
 * What has to be right is *who* and *once*: a member who has resumed, or whose renewal is on
 * hold, must not be told their membership is ending, and nobody who has chosen to leave should
 * hear it twice. The wording is pinned in membershipReminders.test.ts.
 *
 * Times are fixed. The run is at 10 AM on Monday 12 October in Auckland (NZDT, UTC+13), so the
 * window reaches the end of Thursday 15 October.
 */
describeIfDb("membership end reminder", () => {
  const now = new Date("2026-10-11T21:00:00.000Z")
  /** 3 PM on Thursday 15 October: the third day, inside the window. */
  const endsThursday = new Date("2026-10-15T02:00:00.000Z")
  /** 1 AM on Friday 16 October: under four days away, but a day too far. */
  const endsFriday = new Date("2026-10-15T12:00:00.000Z")

  const membership = async (
    state: Partial<{
      endDate: Date
      isActive: boolean
      cancel: boolean
      paymentStatus: "SUCCESS" | "PENDING" | "FAILED"
      totalMonths: number
      endWarnedFor: Date
      benefits: string[]
    }> = {},
  ) => {
    const { benefits = ["Free weekly Mochi Series Bowl ($9.99)", "Cancel anytime"], ...rest } =
      state
    const user = await makeUser()
    const plan = await db.membershipPlan.create({
      data: {
        name: "Monthly_Membership",
        stripePriceId: `price_${Math.random().toString(36).slice(2)}`,
        benefits,
      },
    })
    const row = await db.membership.create({
      data: {
        userId: user.id,
        planId: plan.id,
        endDate: endsThursday,
        isActive: true,
        cancel: true,
        paymentStatus: "SUCCESS",
        totalMonths: 4,
        ...rest,
      },
    })
    return { user, membership: row }
  }

  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
    invalidateLoyaltyRates()
    sendPushToUser.mockClear()
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  it("reminds a cancelled member once, naming what they will lose", async () => {
    const { user } = await membership()

    expect(await warnMembershipsEnding(now)).toEqual({ warned: 1 })
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
    const [userId, title, body, data] = sendPushToUser.mock.calls[0]
    expect(userId).toBe(user.id)
    expect(title).toBe("Your membership ends soon")
    expect(body).toBe(
      "Your 20% member discount, free weekly Mochi Series Bowl ($9.99) and your other member benefits end on Thursday 15 October. Re-subscribe before then to keep them. If it ends, rejoining starts the discount again at 5%.",
    )
    expect(data).toEqual({ type: "MEMBERSHIP_ENDING" })

    // The next day's run, and a second instance's, find it claimed.
    expect(await warnMembershipsEnding(now)).toEqual({ warned: 0 })
    expect(
      await warnMembershipsEnding(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
    ).toEqual({ warned: 0 })
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
  })

  it("waits until the end is within three Auckland days", async () => {
    await membership({ endDate: endsFriday })

    expect(await warnMembershipsEnding(now)).toEqual({ warned: 0 })
    // The next morning, Friday is the third day.
    expect(
      await warnMembershipsEnding(new Date(now.getTime() + 24 * 60 * 60 * 1000)),
    ).toEqual({ warned: 1 })
  })

  it("leaves alone a membership that is renewing, on hold or already over", async () => {
    await membership({ cancel: false })
    await membership({ paymentStatus: "PENDING" })
    await membership({ isActive: false })
    await membership({ endDate: new Date(now.getTime() - 60 * 1000) })

    expect(await warnMembershipsEnding(now)).toEqual({ warned: 0 })
    expect(sendPushToUser).not.toHaveBeenCalled()
  })

  /** Resumed, renewed a period, cancelled again: a new end date is a new reminder. */
  it("reminds again when the end date moves", async () => {
    const { membership: row } = await membership({ endWarnedFor: endsThursday })
    const later = new Date("2026-11-15T02:00:00.000Z")
    await db.membership.update({ where: { id: row.id }, data: { endDate: later } })

    expect(
      await warnMembershipsEnding(new Date("2026-11-12T21:00:00.000Z")),
    ).toEqual({ warned: 1 })
  })

  it("sends one reminder when two instances run at once", async () => {
    await membership()

    const runs = await Promise.all([
      warnMembershipsEnding(now),
      warnMembershipsEnding(now),
    ])
    expect(runs[0].warned + runs[1].warned).toBe(1)
    expect(sendPushToUser).toHaveBeenCalledTimes(1)
  })

  /** Read before the claim, resumed before it: the claim must match nothing. */
  it("does not claim a membership resumed since it was read", async () => {
    const { membership: row } = await membership()
    await db.membership.update({ where: { id: row.id }, data: { cancel: false } })

    expect(await claimEndWarning(row.id, endsThursday)).toBe(false)
  })

  it("names the perk the shop has listed, and falls back with the list", async () => {
    await membership({ benefits: ["Cancel anytime", "Free birthday dessert"] })
    await membership({ benefits: [] })

    await warnMembershipsEnding(now)
    const bodies = sendPushToUser.mock.calls.map((call) => call[2])
    expect(bodies).toEqual(
      expect.arrayContaining([
        expect.stringContaining(", free birthday dessert and your other member benefits"),
        expect.stringContaining(
          ", free weekly Mochi Series Bowl ($9.99) and your other member benefits",
        ),
      ]),
    )
  })
})
