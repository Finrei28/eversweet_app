import { db } from "./db"

/**
 * The monthly leaderboard's ranking, defined once.
 *
 * This was two copies of the same `groupBy` — one in `getLeaderBoard` for the board
 * customers watch all month, one in `settleMonthlyWinners` for the podium that pays — kept
 * in step by a comment in each and a test. They had already drifted once: settlement
 * filtered on the sign alone after the board had learned to filter on `reason`, which could
 * crown someone the board never showed in front. One function makes that impossible rather
 * than merely caught.
 *
 * `take` is the only thing the callers disagree on. The live board needs the full list so
 * it can place a viewer who is outside the top ten; settlement wants the podium.
 */
export const rankMonth = (
  range: { start: Date; end: Date },
  take?: number,
) =>
  db.loyaltyRecord.groupBy({
    by: ["loyaltyId"],
    where: {
      // Earnings only. `change > 0` alone is not enough: a refunded redemption is written
      // back as a *positive* record, so redeeming points and then having the order
      // cancelled left the points on the board — repeatably, with the balance restored.
      // `reason` is a free-form string rather than an enum, so this pairs with the sign
      // rather than replacing it.
      change: { gt: 0 },
      reason: "EARNED",
      createdAt: { gte: range.start, lt: range.end },
    },
    _sum: { change: true },
    _max: { createdAt: true },
    orderBy: [
      { _sum: { change: "desc" } },
      // A tie goes to whoever got there first: of two customers level on points, the one
      // whose last qualifying earning came earlier.
      //
      // Ties need *some* deterministic key or Postgres orders equal sums however the plan
      // happens to emit them — three customers level across positions 9-11 meant one
      // refresh put you at #10 and the next at #11. Settlement used to resolve only first
      // place, with a loop that fetched each tied customer's latest record a query at a
      // time; a tie for second or third came out in whatever order Postgres chose.
      { _max: { createdAt: "asc" } },
      // Last resort, for two customers whose final earning landed in the same millisecond.
      // Arbitrary, but total — without it the order is undefined.
      { loyaltyId: "asc" },
    ],
    take,
  })
