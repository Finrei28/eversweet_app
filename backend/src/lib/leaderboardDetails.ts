import { db } from "./db"
import { nzMonthRange } from "./tradingHours"

/** What a customer who opted out of being named is shown as, on every surface. */
export const ANONYMOUS_NAME = "Anonymous"

/**
 * Finds last month's podium.
 *
 * @returns The winners in place order, or an empty list if the month had none.
 */
const findLastMonthsWinners = async () => {
  // The month that just ended, on the New Zealand calendar. This used to walk
  // back with a mutating `setMonth`, which overflows: run on 31 March it asked
  // for "31 February", which normalises forward into March, so the banner
  // queried the *current* month and showed nothing. Same on 31 May, July,
  // October and December.
  const { month, year } = nzMonthRange(new Date(), -1)

  try {
    return await db.loyaltyWinner.findMany({
      where: {
        month,
        year,
      },
      select: {
        place: true,
        // anonymousEnabled is the winner's own choice about being named, and it
        // has to be read here rather than in the app: this feeds
        // /getLeaderboardDetails, which is unauthenticated and sent with
        // `Cache-Control: public`, so a name that reaches the response has
        // already left the building. The app used to gate on the *viewer's*
        // flag instead, which meant an opted-out winner was named to everyone
        // who had not opted out themselves.
        user: {
          select: {
            firstName: true,
            lastName: true,
            anonymousEnabled: true,
          },
        },
      },
      orderBy: { place: "asc" },
    })
  } catch (error) {
    console.error("Error finding last month's winners:", error)
    return []
  }
}

type WinnerUser = {
  firstName: string | null
  lastName: string | null
  anonymousEnabled: boolean
} | null

/**
 * The name to show for one winner, or null when there is nobody to name — an
 * account closed since the month was settled, or a row with no name on file.
 * Anonymity is decided per winner, not for the podium as a whole: second place
 * opting out says nothing about first.
 */
const publicName = (user: WinnerUser) => {
  if (!user) return null
  if (user.anonymousEnabled) return ANONYMOUS_NAME

  return user.firstName && user.lastName
    ? user.firstName + " " + user.lastName
    : null
}

export const organiseLeaderboardDetails = async () => {
  const winners = await findLastMonthsWinners()

  const topThree = winners
    .map((winner) => ({ place: winner.place, name: publicName(winner.user) }))
    .filter((winner): winner is { place: number; name: string } =>
      Boolean(winner.name),
    )

  return {
    show: true,
    description:
      "This is a monthly leaderboard which shows how many loyalty points you have earned this month",
    /**
     * Kept alongside `lastMonthsTopThree` for builds already on people's
     * phones, which read this and know nothing about a podium. Dropping it
     * would blank the banner on every app that has not been updated.
     */
    lastMonthsWinner:
      topThree.find((winner) => winner.place === 1)?.name ?? null,
    lastMonthsTopThree: topThree,
  }
}
