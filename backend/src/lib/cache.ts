import { redis } from "./redis"
import { getErrorMessage } from "../utils/getError"

/**
 * Redis is an accelerator here, never a dependency — the same contract the
 * idempotency middleware works to. Every call is bounded and every failure
 * falls open to the database, so a cache that is slow, full or down costs a
 * little latency and nothing else.
 */
const CACHE_TIMEOUT_MS = 300

const bounded = <T>(work: Promise<T>): Promise<T | null> => {
  const attempt = work.then(
    (value) => value,
    (error) => {
      console.error("Cache unavailable:", getErrorMessage(error))
      return null
    },
  )

  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), CACHE_TIMEOUT_MS).unref()
  })

  return Promise.race([attempt, timeout])
}

/**
 * Namespaced so these can be reasoned about — and invalidated — separately
 * from the rate limiter and idempotency keys sharing this database.
 */
const cacheKey = (name: string) => `cache:${name}`

export const CACHE_KEYS = {
  menu: "menu",
  clientOffers: "offers:client",
  daysOff: "days-off",
  leaderboardDetails: "leaderboard-details",
  customisations: (dessertId: string) => `customisations:${dessertId}`,
} as const

/**
 * Serve `name` from Redis when it is there, otherwise run `produce`, hand the
 * result back and store it for next time.
 *
 * Only worth applying to endpoints that actually query the database: several of
 * this app's public reads already answer from module-level constants, where a
 * Redis round trip would be slower than the thing it replaces.
 */
export async function cached<T>(
  name: string,
  ttlSeconds: number,
  produce: () => Promise<T>,
): Promise<T> {
  const key = cacheKey(name)
  const hit = await bounded(redis.get(key))

  if (hit) {
    try {
      return JSON.parse(hit) as T
    } catch (error) {
      // A corrupt entry is not a reason to fail the request.
      console.error("Unreadable cache entry:", getErrorMessage(error))
    }
  }

  const value = await produce()

  // Not awaited: the customer should not wait on the write, and a failed one
  // only means the next request recomputes.
  void bounded(redis.set(key, JSON.stringify(value), "EX", ttlSeconds))

  return value
}

/** Called from the admin writes that make a cached answer wrong. */
export async function invalidate(...names: string[]) {
  if (names.length === 0) return

  await bounded(redis.del(...names.map(cacheKey)))
}
