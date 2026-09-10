import { db } from "./db"
import { nzMonthRange } from "./tradingHours"

/** What a customer who opted out of being named is shown as, on every surface. */
export const ANONYMOUS_NAME = "Anonymous"

/**
 * Finds the winner of the previous month's loyalty contest.
 * @returns A promise that resolves to the LoyaltyWinner record or null if no winner is found.
 */
const findLastMonthsWinner = async () => {
  // The month that just ended, on the New Zealand calendar. This used to walk
  // back with a mutating `setMonth`, which overflows: run on 31 March it asked
  // for "31 February", which normalises forward into March, so the banner
  // queried the *current* month and showed nothing. Same on 31 May, July,
  // October and December.
  const { month, year } = nzMonthRange(new Date(), -1)

  try {
    // Query the database for the winner of the previous month
    const winner = await db.loyaltyWinner.findFirst({
      where: {
        month,
        year,
      },
      select: {
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
    })

    return winner?.user
  } catch (error) {
    console.error("Error finding last month's winner:", error)
    return null
  }
}

export const organiseLeaderboardDetails = async () => {
  const winnerObject = await findLastMonthsWinner()
  const firstName = winnerObject?.firstName
  const lastName = winnerObject?.lastName
  const name = firstName && lastName ? firstName + " " + lastName : null

  // No winner at all stays null, so the app hides the banner entirely. A winner
  // who asked to stay anonymous is still announced — just not by name.
  const winner = winnerObject?.anonymousEnabled ? ANONYMOUS_NAME : name

  return {
    show: true,
    description:
      "This is a monthly leaderboard which shows how many loyalty points you have earned this month",
    lastMonthsWinner: winner, // The winner's first and last name, "Anonymous" if they opted out, or null if there was no winner.
  }
}
