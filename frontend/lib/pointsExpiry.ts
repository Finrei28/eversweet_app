import { formatWeekdayDate } from "./formatters"

/**
 * The line under the Rewards balance saying when the points go, or null when there is
 * nothing to say.
 *
 * The server decides the date (`lib/pointsExpiry` there) and sends null whenever nothing is
 * due to expire - no points, expiry switched off, or an active member - so the app never
 * forms a second, drifting opinion of the rule. This only words what it was told.
 *
 * The date is the last instant of the Auckland day, so it is formatted in New Zealand time:
 * a phone elsewhere would otherwise name the day before or after.
 */
export const pointsExpiryNotice = (
  expiresAt: string | null | undefined,
  points: number,
): string | null => {
  if (!expiresAt || points <= 0) return null

  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) return null

  return `Your points expire at the end of ${formatWeekdayDate(date)}. Place an order to keep them.`
}
