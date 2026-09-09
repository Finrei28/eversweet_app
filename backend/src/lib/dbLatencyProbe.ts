import { db } from "./db"

/**
 * Answers one question: what does a single round trip to this database cost?
 *
 * Production reports `getUserLoyaltyPoints 200 1404ms db=1222ms queries=1` — one
 * `findUnique`, on a primary key, taking well over a second. The same request
 * costs 8ms against a database on the same host, so the time is in the
 * connection rather than the query. But "the connection" covers two very
 * different problems with two different fixes:
 *
 *   - the round trip itself is slow (the API is in Singapore, Postgres in
 *     Sydney), in which case the answer is to move them together and no code
 *     change helps much; or
 *   - acquiring a connection is slow (the pooler, TLS, a cold pool), in which
 *     case the answer is configuration and the distance is a red herring.
 *
 * `SELECT 1` separates them. It has no rows to read, no planning worth the
 * name and no locks, so whatever it costs is the floor for *any* query. Run
 * warm, it is the round trip and nothing else.
 *
 * The first call is reported separately because it pays for establishing the
 * connection, which is the number that tells us whether pooling is the
 * problem: a first call far above the rest means connections are expensive to
 * get, and the fix is to stop getting new ones.
 */
export async function probeDatabaseLatency() {
  const timings: number[] = []

  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      const startedAt = performance.now()
      await db.$queryRaw`SELECT 1`
      timings.push(performance.now() - startedAt)
    }
  } catch (error) {
    console.log(
      `db-probe failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return
  }

  const [first, ...warm] = timings
  const sorted = [...warm].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? first

  console.log(
    `db-probe SELECT 1  first=${Math.round(first)}ms  ` +
      `warm=[${warm.map((t) => Math.round(t)).join(", ")}]ms  ` +
      `median=${Math.round(median)}ms`,
  )
}
