import { redis } from "./redis"
import { bounded } from "./cache"

/**
 * Remembers, briefly, when each user last changed their password.
 *
 * Every authenticated request has to establish that a token minted up to 90
 * days ago has not been retired since. That check was a Postgres round trip on
 * all ~35 authenticated endpoints, before any controller ran — and a round trip
 * to this app's database costs roughly 0.9s, so it was comfortably the largest
 * fixed cost in the API.
 *
 * The cache fails *safe*, which is the whole reason it is shaped this way: a
 * miss, a slow Redis or a down Redis all fall through to the database, so the
 * worst case is today's latency. The tempting inverse — storing a key only when
 * a password changes, and treating "no key" as valid — would use almost no
 * memory but fail *open*, silently honouring a revoked token if the key were
 * ever evicted. Redis runs `volatile-lru` here, so eviction is a real path.
 */
const SESSION_TTL_SECONDS = 60

/**
 * Short: the value is a few bytes, so anything slower than this means Redis is
 * unwell, and the database fallback is the better answer at that point.
 */
const SESSION_TIMEOUT_MS = 300

const sessionKey = (userId: string) => `auth:pwc:${userId}`

/** Distinguishes "never changed their password" from an absent entry. */
const NEVER = "0"

/**
 * `undefined` means nothing usable came back — an absent entry, or a Redis that
 * did not answer in time. Both mean "ask Postgres". `null` means the user is
 * known and has never changed their password.
 */
export async function cachedPasswordChangedAt(
  userId: string,
): Promise<number | null | undefined> {
  const hit = await bounded(redis.get(sessionKey(userId)), SESSION_TIMEOUT_MS)

  if (hit === null) return undefined

  return hit === NEVER ? null : Number(hit)
}

/** Seconds, to match the `iat` the value is compared against. */
export function rememberPasswordChangedAt(
  userId: string,
  passwordChangedAt: Date | null,
) {
  const value = passwordChangedAt
    ? String(Math.floor(passwordChangedAt.getTime() / 1000))
    : NEVER

  // Not awaited: the request should not wait on it, and a failed write only
  // means the next request asks the database again.
  void bounded(
    redis.set(sessionKey(userId), value, "EX", SESSION_TTL_SECONDS),
    SESSION_TIMEOUT_MS,
  )
}

/**
 * Called wherever a password changes. Revocation stays immediate because of
 * this delete; the TTL above is only a backstop for the case where it fails.
 */
export async function forgetSession(userId: string) {
  await bounded(redis.del(sessionKey(userId)), SESSION_TIMEOUT_MS)
}
