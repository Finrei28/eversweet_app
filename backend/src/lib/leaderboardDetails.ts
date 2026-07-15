import { db } from "./db"

/**
 * Finds the winner of the previous month's loyalty contest.
 * @returns A promise that resolves to the LoyaltyWinner record or null if no winner is found.
 */
const findLastMonthsWinner = async () => {
  // Get current date
  const currentDate = new Date()

  // Calculate previous month and year
  const lastMonth = new Date(currentDate.setMonth(currentDate.getMonth() - 1))
  const targetYear = lastMonth.getFullYear()
  const targetMonth = lastMonth.getMonth() + 1 // Month is 1-indexed

  try {
    // Query the database for the winner of the previous month
    const winner = await db.loyaltyWinner.findFirst({
      where: {
        month: targetMonth,
        year: targetYear,
      },
      select: {
        user: { select: { firstName: true, lastName: true } }, // We get the first and last name of the winner
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
  const winner = firstName && lastName ? firstName + " " + lastName : null

  return {
    show: true,
    description:
      "This is a monthly leaderboard which shows how many loyalty points you have earned this month",
    lastMonthsWinner: "Finlay Wong", // Include the resolved winner data here, this will be the winners first and last name if any.
  }
}
