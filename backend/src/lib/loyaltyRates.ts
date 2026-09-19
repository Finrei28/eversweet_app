import { db } from "./db"
import { getErrorMessage } from "../utils/getError"

/**
 * What an app order earns in Sweet Points.
 *
 * `LoyaltySetting` holds one row, edited from the website's admin. These are read on the
 * order path, so this module caches them and can always answer — a settings table being
 * unreachable must never cost a customer their points, and must never fail an order.
 *
 * The shape is the one `/api/getLoyaltyRates` has always served and installed builds parse:
 * `rate` points per dollar, `memberRate` an active member's multiplier, `modifier` applied
 * to everyone. The row stores whole numbers instead, so a rate cannot be written as an
 * ambiguous fraction the way `Offer.discountAmount` was; the conversion happens here.
 */
export type LoyaltyRates = {
  memberRate: number
  rate: number
  modifier: number
}

/**
 * The values that were hardcoded before the table existed. Used until the row is read, and
 * whenever it cannot be, so behaviour with no configuration is exactly the behaviour the
 * shop had.
 */
export const DEFAULT_LOYALTY_RATES: LoyaltyRates = {
  memberRate: 1.5,
  rate: 6,
  modifier: 1,
}

/** As for the preparation times: long enough not to re-read per order, short enough that a
 * change made on the website is in effect before anyone wonders why it is not. */
const CACHE_TTL_MS = 60_000

let cached: LoyaltyRates | null = null
let cachedAt = 0

export const getLoyaltyRates = async (): Promise<LoyaltyRates> => {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached

  try {
    const row = await db.loyaltySetting.findFirst({
      select: {
        pointsPerDollar: true,
        memberBonusPercent: true,
        modifierPercent: true,
      },
    })

    // No row yet — the table exists but has not been seeded. The defaults are correct, so
    // this is not worth logging on every read.
    cached = row
      ? {
          rate: row.pointsPerDollar,
          // Whole percent on the way out: 150 is 1.5x. Dividing by 100 gives exactly the
          // double the old constant held, so what an order earns is unchanged.
          memberRate: row.memberBonusPercent / 100,
          modifier: row.modifierPercent / 100,
        }
      : DEFAULT_LOYALTY_RATES
    cachedAt = Date.now()
    return cached
  } catch (error) {
    console.error(
      "Could not read loyalty rates; using defaults:",
      getErrorMessage(error),
    )
    // Deliberately not cached: a transient failure should not pin the defaults in place for
    // the next minute.
    return cached ?? DEFAULT_LOYALTY_RATES
  }
}

/** Called after a write, so the change is visible without waiting out the TTL. */
export const invalidateLoyaltyRates = () => {
  cached = null
  cachedAt = 0
}

/**
 * Points earned on one cart line, given its net price in cents.
 *
 * The one definition, shared by `createOrder` and the `/api/getLoyaltyRates` consumers, so
 * the figure the cart previews and the figure the order awards cannot drift. Floored per
 * line, exactly as the inline calculation in `createOrder` always did — a small enough line
 * earns nothing, which is why the caller skips a zero rather than treating it as an error.
 */
export const pointsForLine = (
  netPriceInCents: number,
  quantity: number,
  isMember: boolean,
  rates: LoyaltyRates,
): number =>
  Math.floor(
    (netPriceInCents / 100) * // points are calculated per dollar
      rates.rate *
      quantity *
      (isMember ? rates.modifier * rates.memberRate : rates.modifier),
  )
