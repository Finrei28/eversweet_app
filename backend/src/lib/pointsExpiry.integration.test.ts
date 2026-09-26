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

vi.mock("stripe", async (importOriginal) =>
  (await import("../test/stripeStub.js")).fakeStripeModule(await importOriginal()),
)

import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import { resetStripeStub, stripeApi } from "../test/stripeStub"

vi.mock("./redis", () => ({
  get redis() {
    return redis.redis
  },
}))

import app from "../app"
import { db } from "./db"
import { invalidateLoyaltyRates } from "./loyaltyRates"
import { rankMonth } from "./leaderboardRanking"
import { membershipPlanName, POINTS_NEVER_EXPIRE_BENEFIT } from "./membership"
import {
  creditRefund,
  expireBalance,
  expireInactivePoints,
  holdCustomerOrders,
  refundExpiredSince,
  warnPointsExpiring,
} from "./pointsExpiry"
import { nzMonthRange } from "./tradingHours"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeDessert, makeUser } from "../test/factories"

/**
 * Sweet Points expiring after a month without an app order.
 *
 * What has to be right is *whose* points and *once*. Taking a balance that should have
 * stayed is taking something a customer earned; taking one twice is taking it from a
 * balance they have since rebuilt. The rule itself is pinned in pointsExpiry.test.ts; these
 * prove the sweep, the warning and the endpoint obey it against a real database.
 *
 * Times are fixed. The switch goes on at 3pm on 1 October in Auckland, so a balance with no
 * orders expires at the end of 1 November - 2026-11-01T10:59:59.999Z.
 */
describeIfDb("points expiry", () => {
  const switchedOn = new Date("2026-10-01T02:00:00.000Z")
  /** 12:05am on 2 November in Auckland: the sweep's first run after that deadline. */
  const afterDeadline = new Date("2026-11-01T11:05:00.000Z")
  /** 11pm on 1 November: the last day is still theirs. */
  const onLastDay = new Date("2026-11-01T10:00:00.000Z")

  const switchOn = async (at: Date | null = switchedOn) => {
    await db.loyaltySetting.update({
      where: { id: "default" },
      data: { pointsExpireFrom: at },
    })
    invalidateLoyaltyRates()
  }

  const customerWithPoints = async (points: number) => {
    const user = await makeUser()
    const loyalty = await db.loyalty.create({ data: { userId: user.id, points } })
    return { user, loyalty }
  }

  let orderNumber = 7000
  const orderAt = (userId: string, createdAt: Date, priceInCents = 1200) =>
    db.order.create({
      data: {
        tempOrderId: String(orderNumber++),
        priceInCents,
        customerFirstName: "Ada",
        customerLastName: "Lovelace",
        customerEmail: "ada@example.test",
        status: "PICKED_UP",
        GST: 0,
        source: "APP",
        appUserId: userId,
        createdAt,
      },
    })

  /**
   * A membership in the state given. One month paid unless `totalMonths` says otherwise:
   * a membership that ever ran has at least one, and 0 is a join that never paid.
   */
  const membershipFor = async (
    userId: string,
    endDate: Date,
    state: {
      isActive: boolean
      paymentStatus: "SUCCESS" | "PENDING" | "FAILED"
      totalMonths?: number
    },
  ) => {
    const plan = await db.membershipPlan.create({
      data: {
        // The name `getMembershipDetails` looks the plan up by.
        name: membershipPlanName(),
        stripePriceId: `price_${Math.random().toString(36).slice(2)}`,
        benefits: ["Cancel anytime", POINTS_NEVER_EXPIRE_BENEFIT],
      },
    })
    await db.membership.create({
      data: { userId, planId: plan.id, endDate, totalMonths: 1, ...state },
    })
    return plan
  }

  const balanceOf = async (loyaltyId: string) =>
    (await db.loyalty.findUniqueOrThrow({ where: { id: loyaltyId } })).points

  const expiredRecords = (loyaltyId: string) =>
    db.loyaltyRecord.findMany({ where: { loyaltyId, reason: "EXPIRED" } })

  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
    resetStripeStub()
    sendPushToUser.mockClear()
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  describe("the sweep", () => {
    it("expires a balance a month after the switch, and writes it down", async () => {
      await switchOn()
      const { loyalty } = await customerWithPoints(120)

      await expect(expireInactivePoints(afterDeadline)).resolves.toEqual({
        expired: 1,
      })

      expect(await balanceOf(loyalty.id)).toBe(0)
      const records = await expiredRecords(loyalty.id)
      expect(records.map((r) => r.change)).toEqual([-120])
    })

    it("leaves the last day alone", async () => {
      await switchOn()
      const { loyalty } = await customerWithPoints(120)

      await expireInactivePoints(onLastDay)

      expect(await balanceOf(loyalty.id)).toBe(120)
    })

    it("expires nothing while switched off", async () => {
      const { loyalty } = await customerWithPoints(120)

      await expireInactivePoints(new Date("2030-01-01T00:00:00.000Z"))

      expect(await balanceOf(loyalty.id)).toBe(120)
    })

    it("takes a balance once, however often it runs", async () => {
      await switchOn()
      const { loyalty } = await customerWithPoints(120)

      await expireInactivePoints(afterDeadline)
      await expireInactivePoints(new Date(afterDeadline.getTime() + 60_000))

      expect(await expiredRecords(loyalty.id)).toHaveLength(1)
    })

    it("keeps the points of a customer who ordered within the month", async () => {
      await switchOn()
      const { user, loyalty } = await customerWithPoints(120)
      await orderAt(user.id, new Date("2026-10-20T02:00:00.000Z"))

      await expireInactivePoints(afterDeadline)

      expect(await balanceOf(loyalty.id)).toBe(120)
    })

    /** Spending points is still coming back to the shop. */
    it("counts an order paid entirely in points", async () => {
      await switchOn()
      const { user, loyalty } = await customerWithPoints(120)
      await orderAt(user.id, new Date("2026-10-20T02:00:00.000Z"), 0)

      await expireInactivePoints(afterDeadline)

      expect(await balanceOf(loyalty.id)).toBe(120)
    })

    it("never takes an active member's points", async () => {
      await switchOn()
      const { user, loyalty } = await customerWithPoints(120)
      await membershipFor(user.id, new Date("2027-06-01T00:00:00.000Z"), {
        isActive: true,
        paymentStatus: "SUCCESS",
      })

      await expireInactivePoints(new Date("2027-05-01T00:00:00.000Z"))

      expect(await balanceOf(loyalty.id)).toBe(120)
    })

    it("gives a lapsed member a month from the end of their membership", async () => {
      await switchOn()
      const { user, loyalty } = await customerWithPoints(120)
      await membershipFor(user.id, new Date("2026-10-25T02:00:00.000Z"), {
        isActive: false,
        paymentStatus: "SUCCESS",
      })

      await expireInactivePoints(afterDeadline)
      expect(await balanceOf(loyalty.id)).toBe(120)

      // 12:05am on 26 November: the day after the month from 25 October ran out.
      await expireInactivePoints(new Date("2026-11-25T11:05:00.000Z"))
      expect(await balanceOf(loyalty.id)).toBe(0)
    })

    /**
     * A join claimed but never paid carries an end date a month ahead. It must not keep a
     * balance alive as though a membership had run.
     */
    it("gives nothing for a join that never paid", async () => {
      await switchOn()
      const { user, loyalty } = await customerWithPoints(120)
      await membershipFor(user.id, new Date("2026-11-20T02:00:00.000Z"), {
        isActive: false,
        paymentStatus: "PENDING",
        totalMonths: 0,
      })

      await expireInactivePoints(afterDeadline)

      expect(await balanceOf(loyalty.id)).toBe(0)
    })

    /**
     * The same failed join once its end date has passed. Only the date was checked, so a
     * month later it counted as a membership that had run and ended, and kept the balance
     * alive for up to another month.
     */
    it("gives nothing for a failed join once its end date has passed", async () => {
      await switchOn()
      const { user, loyalty } = await customerWithPoints(120)
      await membershipFor(user.id, new Date("2026-10-25T02:00:00.000Z"), {
        isActive: false,
        paymentStatus: "FAILED",
        totalMonths: 0,
      })

      await expireInactivePoints(afterDeadline)

      expect(await balanceOf(loyalty.id)).toBe(0)
    })

    /**
     * Points in a cart were taken from the balance when the reward went in, and come back
     * as a REFUND when the cart is emptied or expires - possibly after the sweep ran.
     */
    it("takes points refunded from a cart after expiry on the next run", async () => {
      await switchOn()
      const { loyalty } = await customerWithPoints(120)
      await expireInactivePoints(afterDeadline)

      await db.loyalty.update({
        where: { id: loyalty.id },
        data: {
          points: { increment: 50 },
          records: { create: { change: 50, reason: "REFUND" } },
        },
      })
      await expireInactivePoints(new Date("2026-11-02T11:05:00.000Z"))

      expect(await balanceOf(loyalty.id)).toBe(0)
      expect((await expiredRecords(loyalty.id)).map((r) => r.change)).toEqual([
        -120, -50,
      ])
    })

    /**
     * Cron runs in every instance, so two processes reach one balance together. Asserted on
     * the claim itself, because two sweeps started side by side do not reliably interleave -
     * each can commit before the other reads, and pass for the wrong reason.
     */
    it("lets only one of two concurrent expiries take the balance", async () => {
      await switchOn()
      const { loyalty } = await customerWithPoints(120)
      const balance = { id: loyalty.id, userId: loyalty.userId, points: 120 }

      const results = await Promise.all([
        expireBalance(balance, switchedOn),
        expireBalance(balance, switchedOn),
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
      expect(await expiredRecords(loyalty.id)).toHaveLength(1)
    })

    /** Zeroing a figure we never saw would take points the customer earned a second ago. */
    it("leaves a balance that changed since it was read", async () => {
      await switchOn()
      const { loyalty } = await customerWithPoints(120)
      await db.loyalty.update({
        where: { id: loyalty.id },
        data: { points: { increment: 30 } },
      })

      const taken = await expireBalance(
        { id: loyalty.id, userId: loyalty.userId, points: 120 },
        switchedOn,
      )

      expect(taken).toBe(false)
      expect(await balanceOf(loyalty.id)).toBe(150)
    })

    /** A points-only order changes no balance, so only the relation check can see it. */
    it("leaves a balance whose owner ordered since the decision", async () => {
      await switchOn()
      const { user, loyalty } = await customerWithPoints(120)
      await orderAt(user.id, new Date("2026-11-01T11:04:00.000Z"), 0)

      const taken = await expireBalance(
        { id: loyalty.id, userId: user.id, points: 120 },
        switchedOn,
      )

      expect(taken).toBe(false)
      expect(await balanceOf(loyalty.id)).toBe(120)
    })

    /**
     * The sweep decided on a membership it read earlier. A payment the webhook has activated
     * since makes the customer exempt, and taking their points anyway takes a member's.
     */
    it("leaves a balance whose owner became a member since the decision", async () => {
      await switchOn()
      const { user, loyalty } = await customerWithPoints(120)
      await membershipFor(user.id, new Date("2026-12-01T00:00:00.000Z"), {
        isActive: true,
        paymentStatus: "SUCCESS",
      })

      const taken = await expireBalance(
        { id: loyalty.id, userId: user.id, points: 120 },
        switchedOn,
      )

      expect(taken).toBe(false)
      expect(await balanceOf(loyalty.id)).toBe(120)
    })

    /**
     * An activation still in flight - written, not yet committed - is invisible to a plain
     * read, so a check in the update alone would expire a customer a moment from becoming a
     * member. The expiry has to wait for it and then see it.
     *
     * The activation is held open for longer than an unlocked expiry takes to finish. Read
     * without the lock, the expiry would complete in that time against the old state and
     * return true; locked, it cannot finish until the activation commits.
     */
    it("waits for an activation in progress, and honours it", async () => {
      await switchOn()
      const { user, loyalty } = await customerWithPoints(120)
      await membershipFor(user.id, new Date("2026-12-01T00:00:00.000Z"), {
        isActive: false,
        paymentStatus: "PENDING",
      })

      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      let written!: () => void
      const activationWritten = new Promise<void>((resolve) => (written = resolve))

      const activation = db.$transaction(
        async (tx) => {
          await tx.membership.update({
            where: { userId: user.id },
            data: { isActive: true, paymentStatus: "SUCCESS" },
          })
          written()
          await held
        },
        { timeout: 20_000 },
      )
      await activationWritten

      const expiring = expireBalance(
        { id: loyalty.id, userId: user.id, points: 120 },
        switchedOn,
      )
      await Promise.race([
        expiring,
        new Promise((resolve) => setTimeout(resolve, 1_500)),
      ])
      release()
      await activation

      expect(await expiring).toBe(false)
      expect(await balanceOf(loyalty.id)).toBe(120)
    })

    /** The board counts points earned; an expiry is not un-earning them. */
    it("does not move the leaderboard", async () => {
      await switchOn()
      const { loyalty } = await customerWithPoints(120)
      await db.loyaltyRecord.create({
        data: {
          loyaltyId: loyalty.id,
          change: 120,
          reason: "EARNED",
          createdAt: new Date("2026-11-01T11:00:00.000Z"),
        },
      })
      const november = nzMonthRange(afterDeadline)
      const before = await rankMonth(november)

      await expireInactivePoints(afterDeadline)

      expect(await rankMonth(november)).toEqual(before)
    })
  })

  /**
   * An order still being placed as the sweep or a refund runs. Its row is inserted but not
   * committed, so no read can see it - and the customer who was ordering would lose their
   * points to an order already on its way. Each of these holds such an order open, exactly as
   * `createOrder` holds one mid-flight, for longer than an unlocked expiry takes to finish.
   */
  describe("an order in flight", () => {
    const holdOrderOpen = (
      userId: string,
      afterInsert?: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<unknown>,
    ) => {
      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      let inserted!: () => void
      const orderInserted = new Promise<void>((resolve) => (inserted = resolve))

      const order = db.$transaction(
        async (tx) => {
          await tx.order.create({
            data: {
              tempOrderId: String(orderNumber++),
              priceInCents: 1200,
              customerFirstName: "Ada",
              customerLastName: "Lovelace",
              customerEmail: "ada@example.test",
              status: "PENDING",
              GST: 0,
              source: "APP",
              appUserId: userId,
            },
          })
          inserted()
          await held
          // What createOrder goes on to do while it still holds the customer: earn points.
          if (afterInsert) await afterInsert(tx)
        },
        { timeout: 20_000 },
      )
      return { order, orderInserted, release }
    }

    const settle = <T,>(work: Promise<T>) =>
      Promise.race([work, new Promise((resolve) => setTimeout(resolve, 1_500))])

    it("makes the sweep wait for it, and keeps the points", async () => {
      await switchOn(new Date(Date.now() - 60 * 86_400_000))
      const { user, loyalty } = await customerWithPoints(120)
      const { order, orderInserted, release } = holdOrderOpen(user.id)
      await orderInserted

      const expiring = expireBalance(
        { id: loyalty.id, userId: user.id, points: 120 },
        new Date(Date.now() - 60 * 86_400_000),
      )
      await settle(expiring)
      release()
      await order

      expect(await expiring).toBe(false)
      expect(await balanceOf(loyalty.id)).toBe(120)
    })

    it("makes a cart refund wait for it, and gives the points back", async () => {
      await switchOn(new Date(Date.now() - 60 * 86_400_000))
      const { user, loyalty } = await customerWithPoints(500)
      const expiredSince = await refundExpiredSince(user.id)
      expect(expiredSince).not.toBeNull()
      const { order, orderInserted, release } = holdOrderOpen(user.id)
      await orderInserted

      const refunding = db.$transaction(
        async (tx) => {
          await holdCustomerOrders(tx, user.id)
          await creditRefund(tx, user.id, 500, expiredSince)
        },
        { timeout: 20_000 },
      )
      await settle(refunding)
      release()
      await order
      await refunding

      expect(await balanceOf(loyalty.id)).toBe(1000)
      expect(await expiredRecords(loyalty.id)).toHaveLength(0)
    })

    /**
     * The lock order. createOrder holds the customer while it goes on to write their Loyalty
     * row; the sweep waiting for it must be holding nothing that write needs, or the two
     * would deadlock. The order finishing, and the sweep then standing down, is the proof.
     */
    it("lets an order that goes on to earn points finish, without a deadlock", async () => {
      await switchOn(new Date(Date.now() - 60 * 86_400_000))
      const { user, loyalty } = await customerWithPoints(120)
      const { order, orderInserted, release } = holdOrderOpen(user.id, (tx) =>
        tx.loyalty.update({
          where: { id: loyalty.id },
          data: {
            points: { increment: 60 },
            records: { create: { change: 60, reason: "EARNED" } },
          },
        }),
      )
      await orderInserted

      const expiring = expireBalance(
        { id: loyalty.id, userId: user.id, points: 120 },
        new Date(Date.now() - 60 * 86_400_000),
      )
      await settle(expiring)
      release()

      await expect(order).resolves.toBeUndefined()
      expect(await expiring).toBe(false)
      expect(await balanceOf(loyalty.id)).toBe(180)
    })
  })

  describe("the warning", () => {
    /** 10am on 26 October in Auckland: six days before a 1 November deadline. */
    const inWarningWeek = new Date("2026-10-25T21:00:00.000Z")

    it("warns once in the week before, naming the day", async () => {
      await switchOn()
      const { user } = await customerWithPoints(120)

      await warnPointsExpiring(inWarningWeek)

      expect(sendPushToUser).toHaveBeenCalledTimes(1)
      const [userId, , body, data] = sendPushToUser.mock.calls[0]!
      expect(userId).toBe(user.id)
      expect(body).toContain("120 points")
      expect(body).toContain("Sunday 1 November")
      expect(data).toEqual({ type: "POINTS_EXPIRING" })
    })

    it("says nothing earlier than the week before", async () => {
      await switchOn()
      await customerWithPoints(120)

      await warnPointsExpiring(new Date("2026-10-20T21:00:00.000Z"))

      expect(sendPushToUser).not.toHaveBeenCalled()
    })

    it("warns about a deadline once, however often it runs", async () => {
      await switchOn()
      await customerWithPoints(120)

      await warnPointsExpiring(inWarningWeek)
      await warnPointsExpiring(new Date("2026-10-26T21:00:00.000Z"))

      expect(sendPushToUser).toHaveBeenCalledTimes(1)
    })

    /** Keyed on the deadline, so an order that moves it makes the next warning due. */
    it("warns again about a new deadline after an order moves it", async () => {
      await switchOn()
      const { user } = await customerWithPoints(120)
      await warnPointsExpiring(inWarningWeek)

      await orderAt(user.id, new Date("2026-10-28T02:00:00.000Z"))
      await warnPointsExpiring(new Date("2026-11-22T21:00:00.000Z"))

      expect(sendPushToUser).toHaveBeenCalledTimes(2)
      expect(sendPushToUser.mock.calls[1]?.[2]).toContain("28 November")
    })

    it("never warns an active member", async () => {
      await switchOn()
      const { user } = await customerWithPoints(120)
      await membershipFor(user.id, new Date("2026-11-20T02:00:00.000Z"), {
        isActive: true,
        paymentStatus: "SUCCESS",
      })

      await warnPointsExpiring(inWarningWeek)

      expect(sendPushToUser).not.toHaveBeenCalled()
    })

    it("does not warn about points already gone, or none at all", async () => {
      await switchOn()
      await customerWithPoints(0)
      await customerWithPoints(120)

      await warnPointsExpiring(afterDeadline)

      expect(sendPushToUser).not.toHaveBeenCalled()
    })

    it("says nothing while expiry is switched off", async () => {
      await customerWithPoints(120)

      await warnPointsExpiring(inWarningWeek)

      expect(sendPushToUser).not.toHaveBeenCalled()
    })
  })

  /**
   * Points leave the balance when a reward goes into the cart, so the nightly sweep cannot
   * see them, and an abandoned cart is refunded only when the customer next opens it. Left
   * alone, a customer could park rewards in a cart for months, come back, have them refunded
   * and order that day - keeping points that expired long before. Past the deadline, what the
   * cart gives back lands expired.
   *
   * The real clock, because the cart endpoints use it: switched on two months ago with no
   * order since puts the deadline a month behind.
   */
  describe("points held in a cart", () => {
    const longAgo = () => new Date(Date.now() - 60 * 86_400_000)
    const auth = (userId: string) => ({
      Authorization: `Bearer ${tokenFor(userId)}`,
    })

    /** 1,000 points, 500 of them put into the cart as a reward. */
    const customerWithRewardInCart = async () => {
      const user = await makeUser()
      const loyalty = await db.loyalty.create({
        data: { userId: user.id, points: 1000 },
      })
      const dessert = await makeDessert(1200)
      const added = await request(app)
        .post("/api/cart/addItemToCart")
        .set(auth(user.id))
        .send({
          quantity: 1,
          customisations: [],
          dessertId: dessert.id,
          itemPriceInCents: 0,
          loyaltyPointsUsed: 500,
        })
      expect(added.status).toBe(201)
      expect(await balanceOf(loyalty.id)).toBe(500)
      return { user, loyalty, lineId: added.body.cartItem.id as string }
    }

    const ways: [string, (userId: string, lineId: string) => Promise<unknown>][] = [
      [
        "removing the item",
        (userId, lineId) =>
          request(app)
            .delete(`/api/cart/removeItemFromCart/${lineId}`)
            .set(auth(userId)),
      ],
      [
        "clearing the cart",
        (userId) => request(app).delete("/api/cart/clearCart").set(auth(userId)),
      ],
      [
        "the cart expiring",
        async (userId) => {
          await db.cart.update({
            where: { userId },
            data: { expiresAt: new Date(Date.now() - 60_000) },
          })
          return request(app).get("/api/cart/getCartItems").set(auth(userId))
        },
      ],
    ]

    it.each(ways)(
      "gives nothing back past the deadline: %s",
      async (_name, giveBack) => {
        await switchOn(longAgo())
        const { user, loyalty, lineId } = await customerWithRewardInCart()

        await giveBack(user.id, lineId)

        expect(await balanceOf(loyalty.id)).toBe(500)
        const records = await db.loyaltyRecord.findMany({
          where: { loyaltyId: loyalty.id },
          orderBy: { createdAt: "asc" },
          select: { change: true, reason: true },
        })
        // What happened, in full: spent into the cart, handed back, expired.
        expect(records.map((r) => `${r.reason} ${r.change}`).sort()).toEqual(
          ["EXPIRED -500", "REFUND 500", "REWARDS -500"].sort(),
        )
      },
    )

    it.each(ways)(
      "gives them back to a customer who ordered within the month: %s",
      async (_name, giveBack) => {
        await switchOn(longAgo())
        const { user, loyalty, lineId } = await customerWithRewardInCart()
        await orderAt(user.id, new Date(Date.now() - 86_400_000))

        await giveBack(user.id, lineId)

        expect(await balanceOf(loyalty.id)).toBe(1000)
        expect(await expiredRecords(loyalty.id)).toHaveLength(0)
      },
    )

    it("gives them back to an active member", async () => {
      await switchOn(longAgo())
      const { user, loyalty, lineId } = await customerWithRewardInCart()
      await membershipFor(user.id, new Date(Date.now() + 20 * 86_400_000), {
        isActive: true,
        paymentStatus: "SUCCESS",
      })

      await ways[0]![1](user.id, lineId)

      expect(await balanceOf(loyalty.id)).toBe(1000)
    })

    /**
     * The verdict is reached before the cart's transaction, so it can be stale when the points
     * are written. Each of these reaches the verdict, then changes what it was based on, then
     * applies the refund - which must notice.
     */
    const refundNow = (userId: string, expiredSince: Date | null) =>
      db.$transaction((tx) => creditRefund(tx, userId, 500, expiredSince))

    const pastDeadline = async () => {
      await switchOn(longAgo())
      const user = await makeUser()
      const loyalty = await db.loyalty.create({
        data: { userId: user.id, points: 500 },
      })
      const expiredSince = await refundExpiredSince(user.id)
      expect(expiredSince).not.toBeNull()
      return { user, loyalty, expiredSince }
    }

    it("gives them back to a customer who ordered after the verdict", async () => {
      const { user, loyalty, expiredSince } = await pastDeadline()
      await orderAt(user.id, new Date())

      await refundNow(user.id, expiredSince)

      expect(await balanceOf(loyalty.id)).toBe(1000)
      expect(await expiredRecords(loyalty.id)).toHaveLength(0)
    })

    it("gives them back to a customer who became a member after the verdict", async () => {
      const { user, loyalty, expiredSince } = await pastDeadline()
      await membershipFor(user.id, new Date(Date.now() + 20 * 86_400_000), {
        isActive: true,
        paymentStatus: "SUCCESS",
      })

      await refundNow(user.id, expiredSince)

      expect(await balanceOf(loyalty.id)).toBe(1000)
    })

    /**
     * An activation written but not yet committed is invisible to a plain read. Held open for
     * longer than an unlocked refund takes, so without the lock the refund would finish in
     * that time against the old state and withhold the points.
     */
    it("waits for an activation in progress, and honours it", async () => {
      const { user, loyalty, expiredSince } = await pastDeadline()
      await membershipFor(user.id, new Date(Date.now() + 20 * 86_400_000), {
        isActive: false,
        paymentStatus: "PENDING",
      })

      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      let written!: () => void
      const activationWritten = new Promise<void>((resolve) => (written = resolve))
      const activation = db.$transaction(
        async (tx) => {
          await tx.membership.update({
            where: { userId: user.id },
            data: { isActive: true, paymentStatus: "SUCCESS" },
          })
          written()
          await held
        },
        { timeout: 20_000 },
      )
      await activationWritten

      const refunding = refundNow(user.id, expiredSince)
      await Promise.race([
        refunding,
        new Promise((resolve) => setTimeout(resolve, 1_500)),
      ])
      release()
      await activation
      await refunding

      expect(await balanceOf(loyalty.id)).toBe(1000)
    })

    it("still withholds them when nothing has changed since the verdict", async () => {
      const { user, loyalty, expiredSince } = await pastDeadline()

      await refundNow(user.id, expiredSince)

      expect(await balanceOf(loyalty.id)).toBe(500)
      expect(await expiredRecords(loyalty.id)).toHaveLength(1)
    })

    it("gives them back while expiry is off", async () => {
      const { user, loyalty, lineId } = await customerWithRewardInCart()

      await ways[1]![1](user.id, lineId)

      expect(await balanceOf(loyalty.id)).toBe(1000)
    })
  })

  /** These use the real clock, because the endpoints do. */
  describe("GET /api/auth/getUserLoyaltyPoints", () => {
    const get = (userId: string) =>
      request(app)
        .get("/api/auth/getUserLoyaltyPoints")
        .set("Authorization", `Bearer ${tokenFor(userId)}`)

    it("serves the deadline beside the balance while expiry is on", async () => {
      await switchOn(new Date())
      const { user } = await customerWithPoints(120)

      const res = await get(user.id)

      expect(res.status).toBe(200)
      expect(Object.keys(res.body).sort()).toEqual(["expiresAt", "points"])
      expect(res.body.points).toBe(120)
      const days = (Date.parse(res.body.expiresAt) - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(27)
      expect(days).toBeLessThan(33)
    })

    it.each([
      ["expiry is off", false, 120, false],
      ["there are no points", true, 0, false],
      ["the customer is an active member", true, 120, true],
    ])("serves no deadline when %s", async (_name, on, points, member) => {
      if (on) await switchOn(new Date())
      const { user } = await customerWithPoints(points)
      if (member) {
        await membershipFor(user.id, new Date(Date.now() + 20 * 86_400_000), {
          isActive: true,
          paymentStatus: "SUCCESS",
        })
      }

      const res = await get(user.id)

      expect(res.status).toBe(200)
      expect(res.body.expiresAt).toBeNull()
    })
  })

  describe("the no-expiry membership benefit", () => {
    const benefitsFor = async () => {
      const user = await makeUser()
      await membershipFor(user.id, new Date(Date.now() + 86_400_000), {
        isActive: false,
        paymentStatus: "PENDING",
      })
      stripeApi.prices.retrieve.mockResolvedValue({ unit_amount: 999 })
      const res = await request(app)
        .get("/api/stripe/getMembershipDetails")
        .set("Authorization", `Bearer ${tokenFor(user.id)}`)
      expect(res.status).toBe(200)
      return res.body.membershipBenefits as unknown
    }

    /** Only true while everyone else's points expire, so only shown then. */
    it("is listed, without its token, while expiry is on", async () => {
      await switchOn(new Date())

      const benefits = await benefitsFor()

      expect(benefits).toEqual([
        "Cancel anytime",
        "Your Sweet Points never expire while you're a member",
      ])
    })

    it("is left out while expiry is off", async () => {
      expect(await benefitsFor()).toEqual(["Cancel anytime"])
    })
  })
})
