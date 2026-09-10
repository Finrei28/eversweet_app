import { beforeEach, describe, expect, it, vi } from "vitest"

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }))

vi.mock("./db", () => ({ db: { loyaltyWinner: { findFirst } } }))

import { organiseLeaderboardDetails } from "./leaderboardDetails"

/** What the select in findLastMonthsWinner hands back for a winner. */
const winner = (over: Partial<Record<string, unknown>> = {}) => ({
  user: {
    firstName: "Ana",
    lastName: "Ruiz",
    anonymousEnabled: false,
    ...over,
  },
})

beforeEach(() => {
  findFirst.mockReset().mockResolvedValue(winner())
})

describe("organiseLeaderboardDetails", () => {
  it("names a winner who is happy to be named", async () => {
    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsWinner: "Ana Ruiz",
    })
  })

  it("withholds the name of a winner who opted out", async () => {
    // The leak this replaced: the app decided this from the *viewer's*
    // anonymity setting, so an opted-out winner was named to every customer who
    // had not opted out themselves — and to anyone at all, since the endpoint
    // this feeds is unauthenticated and publicly cacheable.
    findFirst.mockResolvedValue(winner({ anonymousEnabled: true }))

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsWinner: "Anonymous",
    })
  })

  it("still announces an anonymous winner who has no name on file", async () => {
    findFirst.mockResolvedValue(
      winner({ firstName: null, lastName: null, anonymousEnabled: true }),
    )

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsWinner: "Anonymous",
    })
  })

  it("reports no winner when the month had none", async () => {
    findFirst.mockResolvedValue(null)

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsWinner: null,
    })
  })

  it("reports no winner when the winning account has since been deleted", async () => {
    // LoyaltyWinner.user is a nullable relation, so the row can outlive nothing
    // but still arrive without a user attached.
    findFirst.mockResolvedValue({ user: null })

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsWinner: null,
    })
  })

  it("reports no winner rather than half a name", async () => {
    findFirst.mockResolvedValue(winner({ lastName: null }))

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsWinner: null,
    })
  })

  it("asks for last month, not this one", async () => {
    await organiseLeaderboardDetails()

    const asked = findFirst.mock.calls[0][0].where
    const now = new Date()
    const nzThisMonth = Number(
      now.toLocaleString("en-NZ", {
        timeZone: "Pacific/Auckland",
        month: "numeric",
      }),
    )

    expect(asked.month).not.toBe(nzThisMonth)
    expect(asked.month).toBeGreaterThanOrEqual(1)
    expect(asked.month).toBeLessThanOrEqual(12)
  })

  it("survives a database error without taking the whole payload down", async () => {
    findFirst.mockRejectedValue(new Error("connection reset"))

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      show: true,
      lastMonthsWinner: null,
    })
  })
})
