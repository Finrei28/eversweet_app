import { db } from "./db"
import { getErrorMessage } from "../utils/getError"

/**
 * The shop's fixed details, as `/api/getStoreInfo` serves them.
 *
 * The weekly hours used to live here too, hard-coded, with `isOpen` worked out from them
 * once - when the module loaded - and then served unchanged until the server restarted,
 * whatever the time. Hours are now the `TradingHours` table (see `lib/tradingHours`), and
 * `getStoreInfo` works out `isOpen` on every request, days off included.
 *
 * The details themselves are now the `ShopProfile` table, edited from the website's admin.
 * They were written out in five places that had already drifted into two different formats.
 * The functions are named for the model they read rather than for the endpoint, which keeps
 * the frozen wire name `getStoreInfo` where it belongs: in the controller.
 */
export type ShopProfile = {
  name: string
  address: string
  city: string
  state: string
  postal: string
  phone: string
  email: string
  website: string
}

/**
 * The values that were hardcoded before the table existed. Used until the row is read, and
 * whenever it cannot be, so behaviour with no configuration is exactly the behaviour the
 * shop had.
 */
export const DEFAULT_SHOP_PROFILE: ShopProfile = {
  name: "Eversweet",
  address: "5D/119 Meadowland Drive, Somerville",
  city: "Auckland",
  state: "Auckland",
  postal: "2014",
  phone: "09 949 1050",
  email: "eversweet@eversweet.co.nz",
  website: "https://eversweet.co.nz",
}

/** A minute, as for the preparation times and the trading hours. */
const CACHE_TTL_MS = 60_000

let cached: ShopProfile | null = null
let cachedAt = 0

export const getShopProfile = async (): Promise<ShopProfile> => {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached

  try {
    const row = await db.shopProfile.findFirst({
      select: {
        name: true,
        address: true,
        city: true,
        state: true,
        postal: true,
        phone: true,
        email: true,
        website: true,
      },
    })

    // No row yet — the table exists but has not been seeded. The defaults are correct, so
    // this is not worth logging on every read.
    cached = row ?? DEFAULT_SHOP_PROFILE
    cachedAt = Date.now()
    return cached
  } catch (error) {
    console.error(
      "Could not read the shop's details; using defaults:",
      getErrorMessage(error),
    )
    // Deliberately not cached: a transient failure should not pin the defaults in place for
    // the next minute.
    return cached ?? DEFAULT_SHOP_PROFILE
  }
}

/** Called after a write, so the change is visible without waiting out the TTL. */
export const invalidateShopProfile = () => {
  cached = null
  cachedAt = 0
}
