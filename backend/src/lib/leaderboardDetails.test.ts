import { beforeEach, describe, expect, it, vi } from "vitest"

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }))

vi.mock("./db", () => ({ db: { loyaltyWinner: { findMany } } }))

import { organiseLeaderboardDetails } from "./leaderboardDetails"

/** One row shaped the way findLastMonthsWinners selects it. */
const winner = (
  place: number,
  over: Record<string, unknown> = {},
) => ({
  place,
  user: {
    firstName: "Ana",
    lastName: "Ruiz",
    anonymousEnabled: false,
    ...over,
  },
})

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([winner(1)])
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
    findMany.mockResolvedValue([winner(1, { anonymousEnabled: true })])

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsWinner: "Anonymous",
    })
  })

  it("still announces an anonymous winner who has no name on file", async () => {
    findMany.mockResolvedValue([
      winner(1, { firstName: null, lastName: null, anonymousEnabled: true }),
    ])

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsWinner: "Anonymous",
    })
  })

  it("reports no winner when the month had none", async () => {
    findMany.mockResolvedValue([])

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsWinner: null,
      lastMonthsTopThree: [],
    })
  })

  it("reports no winner when the winning account has since been deleted", async () => {
    // LoyaltyWinner.user is a nullable relation, and closing an account now
    // nulls the link rather than deleting the row.
    findMany.mockResolvedValue([{ place: 1, user: null }])

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsWinner: null,
      lastMonthsTopThree: [],
    })
  })

  it("reports no winner rather than half a name", async () => {
    findMany.mockResolvedValue([winner(1, { lastName: null })])

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsWinner: null,
    })
  })

  it("returns the whole podium in place order", async () => {
    findMany.mockResolvedValue([
      winner(1, { firstName: "Ana", lastName: "Ruiz" }),
      winner(2, { firstName: "Sam", lastName: "Lee" }),
      winner(3, { firstName: "Kit", lastName: "Patel" }),
    ])

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsTopThree: [
        { place: 1, name: "Ana Ruiz" },
        { place: 2, name: "Sam Lee" },
        { place: 3, name: "Kit Patel" },
      ],
    })
  })

  it("decides anonymity per winner, not for the podium", async () => {
    // Second place opting out says nothing about first or third.
    findMany.mockResolvedValue([
      winner(1, { firstName: "Ana", lastName: "Ruiz" }),
      winner(2, { anonymousEnabled: true }),
      winner(3, { firstName: "Kit", lastName: "Patel" }),
    ])

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      lastMonthsWinner: "Ana Ruiz",
      lastMonthsTopThree: [
        { place: 1, name: "Ana Ruiz" },
        { place: 2, name: "Anonymous" },
        { place: 3, name: "Kit Patel" },
      ],
    })
  })

  it("keeps lastMonthsWinner working for app builds that predate the podium", async () => {
    // Dropping this field would blank the banner on every phone that has not
    // been updated, and this endpoint is public and publicly cached.
    findMany.mockResolvedValue([winner(1), winner(2), winner(3)])

    const details = await organiseLeaderboardDetails()

    expect(details.lastMonthsWinner).toBe("Ana Ruiz")
  })

  it("still names first place when a runner-up has no name", async () => {
    findMany.mockResolvedValue([
      winner(1, { firstName: "Ana", lastName: "Ruiz" }),
      { place: 2, user: null },
    ])

    const details = await organiseLeaderboardDetails()

    expect(details.lastMonthsWinner).toBe("Ana Ruiz")
    expect(details.lastMonthsTopThree).toEqual([{ place: 1, name: "Ana Ruiz" }])
  })

  it("asks for last month, not this one", async () => {
    await organiseLeaderboardDetails()

    const asked = findMany.mock.calls[0][0].where
    const nzThisMonth = Number(
      new Date().toLocaleString("en-NZ", {
        timeZone: "Pacific/Auckland",
        month: "numeric",
      }),
    )

    expect(asked.month).not.toBe(nzThisMonth)
    expect(asked.month).toBeGreaterThanOrEqual(1)
    expect(asked.month).toBeLessThanOrEqual(12)
  })

  it("survives a database error without taking the whole payload down", async () => {
    findMany.mockRejectedValue(new Error("connection reset"))

    await expect(organiseLeaderboardDetails()).resolves.toMatchObject({
      show: true,
      lastMonthsWinner: null,
      lastMonthsTopThree: [],
    })
  })
})
