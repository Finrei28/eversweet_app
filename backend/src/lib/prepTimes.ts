import { db } from "./db"
import { getErrorMessage } from "../utils/getError"

/**
 * How long each size of order takes to make, and the two numbers derived from
 * it.
 *
 * `PrepTimeSetting` holds one row. These values are what the shop tunes as it
 * learns its real timings, and they are read on the order path, so this module
 * caches them and can always answer — a settings table being unreachable must
 * never be able to stop an order reaching the kitchen.
 */
export type PrepTimes = {
  singleItem: number
  upToThree: number
  upToSix: number
  moreThanSix: number
  kitchenSlack: number
  quoteFloor: number
}

/**
 * The values that were hardcoded before the table existed. Used until the row
 * is read, and whenever it cannot be, so behaviour with no configuration is
 * exactly the behaviour the shop had.
 */
export const DEFAULT_PREP_TIMES: PrepTimes = {
  singleItem: 5,
  upToThree: 10,
  upToSix: 15,
  moreThanSix: 20,
  kitchenSlack: 1,
  quoteFloor: 10,
}

/**
 * Long enough that a busy service is not re-reading the row per order, short
 * enough that a change made in the app is in effect before anyone wonders why
 * it is not.
 */
const CACHE_TTL_MS = 60_000

let cached: PrepTimes | null = null
let cachedAt = 0

export const getPrepTimes = async (): Promise<PrepTimes> => {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached

  try {
    const row = await db.prepTimeSetting.findFirst()

    // No row yet — the table exists but has not been seeded. The defaults are
    // correct, so this is not worth logging on every read.
    cached = row
      ? {
          singleItem: row.singleItem,
          upToThree: row.upToThree,
          upToSix: row.upToSix,
          moreThanSix: row.moreThanSix,
          kitchenSlack: row.kitchenSlack,
          quoteFloor: row.quoteFloor,
        }
      : DEFAULT_PREP_TIMES
    cachedAt = Date.now()
    return cached
  } catch (error) {
    console.error(
      "Could not read preparation times; using defaults:",
      getErrorMessage(error),
    )
    // Deliberately not cached: a transient failure should not pin the defaults
    // in place for the next minute.
    return cached ?? DEFAULT_PREP_TIMES
  }
}

/** Called after a write, so the change is visible without waiting out the TTL. */
export const invalidatePrepTimes = () => {
  cached = null
  cachedAt = 0
}
