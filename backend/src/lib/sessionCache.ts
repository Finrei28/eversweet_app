import { redis } from "./redis"
import { bounded } from "./cache"

/**
 * Remembers, briefly, what every authenticated request has to know about its user: when
 * they last changed their password, and what role they hold.
 *
 * Every authenticated request has to establish that a token minted up to 90 days ago has
 * not been retired since. That check was a Postgres round trip on all ~35 authenticated
 * endpoints, before any controller ran — and a round trip to this app's database costs
 * roughly 0.9s, so it was comfortably the largest fixed cost in the API.
 *
 * The role rides along because it stopped being read from the token. Tokens run for 90
 * days (180 for staff) and carry the role they were issued with, so an admin who was
 * demoted kept admin access — and the kitchen socket, with every customer's name and
 * phone number — until the token expired. It is the same row as the password check, so
 * reading it costs nothing extra.
 *
 * The cache fails *safe*, which is the whole reason it is shaped this way: a miss, a slow
 * Redis, a down Redis and an unreadable entry all fall through to the database, so the
 * worst case is today's latency. The tempting inverse — storing a key only when a
 * password changes, and treating "no key" as valid — would use almost no memory but fail
 * *open*, silently honouring a revoked token if the key were ever evicted. Redis runs
 * `volatile-lru` here, so eviction is a real path.
 */
const SESSION_TTL_SECONDS = 60

/**
 * Short: the value is a few bytes, so anything slower than this means Redis is
 * unwell, and the database fallback is the better answer at that point.
 */
const SESSION_TIMEOUT_MS = 300

/**
 * Not the `auth:pwc:` prefix the previous version used. Its entries hold a bare
 * timestamp and no role; rather than teach this code to half-read them during a rolling
 * deploy, they are simply never read again and expire within a minute.
 */
const sessionKey = (userId: string) => `auth:session:${userId}`

export type SessionRecord = {
  /** Seconds, to match the `iat` it is compared against. Null if never changed. */
  changedAtSeconds: number | null
  role: string
}

const isSessionRecord = (value: unknown): value is SessionRecord => {
  const record = value as Partial<SessionRecord> | null
  return (
    typeof record?.role === "string" &&
    (record.changedAtSeconds === null ||
      typeof record.changedAtSeconds === "number")
  )
}

/**
 * `undefined` means nothing usable came back — an absent entry, a Redis that did not
 * answer in time, or one that does not parse. All of them mean "ask Postgres".
 */
export async function cachedSession(
  userId: string,
): Promise<SessionRecord | undefined> {
  const hit = await bounded(redis.get(sessionKey(userId)), SESSION_TIMEOUT_MS)

  if (hit === null) return undefined

  try {
    const parsed: unknown = JSON.parse(hit)
    return isSessionRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function rememberSession(userId: string, record: SessionRecord) {
  // Not awaited: the request should not wait on it, and a failed write only
  // means the next request asks the database again.
  void bounded(
    redis.set(
      sessionKey(userId),
      JSON.stringify(record),
      "EX",
      SESSION_TTL_SECONDS,
    ),
    SESSION_TIMEOUT_MS,
  )
}

/**
 * Called wherever a password changes. Revocation stays immediate because of this delete;
 * the TTL above is only a backstop for the case where it fails — and for a role change,
 * which happens outside this API and so takes effect within a minute rather than at once.
 */
export async function forgetSession(userId: string) {
  await bounded(redis.del(sessionKey(userId)), SESSION_TIMEOUT_MS)
}
