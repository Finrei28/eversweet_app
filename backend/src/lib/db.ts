import { PrismaClient } from "@prisma/client"
import { recordQuery } from "../middleware/requestTiming"

const createPrismaClient = () => {
  const base = new PrismaClient({
    log: [
      { emit: "event", level: "query" },
      { emit: "stdout", level: "error" },
      { emit: "stdout", level: "warn" },
    ],
  })

  /**
   * Statement-level timing, off unless asked for.
   *
   * `queries=` in the request log counts Prisma operations, not SQL round
   * trips. A nested write is one operation that the engine runs as BEGIN, a
   * few statements and COMMIT, and an interactive transaction's BEGIN and
   * COMMIT are not model operations at all, so they are invisible to the
   * extension below. That means a request reporting "three queries at 1.8s
   * each" might be three slow round trips or fifteen quick ones - and those
   * have opposite fixes, one in the network and one in the query count.
   *
   * `SQL_TIMING=1` answers it. Only the leading keyword is logged, never the
   * statement or its parameters, so this is safe to turn on in production for
   * as long as it takes to read a few requests.
   */
  const sqlTiming = process.env.SQL_TIMING === "1"

  base.$on("query", (event) => {
    if (process.env.NODE_ENV === "development") {
      console.log(`prisma ${event.duration}ms ${event.query}`)
      return
    }

    if (sqlTiming) {
      const verb = event.query.trimStart().split(/\s+/)[0]?.toUpperCase() ?? "?"
      console.log(`sql ${verb} ${event.duration}ms`)
    }
  })

  /**
   * Timed by wrapping the call rather than by listening for the `query` event.
   *
   * The event handler was the obvious place and it did not work. Prisma emits
   * that event from its own async context, so the AsyncLocalStorage the request
   * middleware set up was not visible inside it: `recordQuery` looked up the
   * store, found nothing and returned. Every request logged `db=0ms queries=0`
   * however much work it did, which made the one number this was built to
   * produce quietly useless — and it looked like an answer rather than a
   * missing measurement.
   *
   * An extension runs where the query is issued, so the request's context is
   * still on the stack. It also measures the time the caller actually waited
   * instead of the engine's own execution figure, which excludes the wait for a
   * connection — and a wait for a connection is exactly what is under suspicion.
   */
  const timed = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const startedAt = performance.now()

          try {
            return await query(args)
          } finally {
            recordQuery(performance.now() - startedAt)
          }
        },
      },
    },
  })

  // Cast back to the plain client's type.
  //
  // `$extends` returns a structurally different type whose results widen -
  // `order.count()` becomes `number | {}` - which breaks every caller that
  // describes the client structurally rather than by Prisma's own type. The
  // extension adds timing and nothing else: the models, their arguments and
  // their results are identical at runtime, so the unextended type is an
  // accurate description of what callers are handed.
  //
  // The one real difference is that `$on` and `$use` do not exist on an
  // extended client. Nothing calls them on `db` - the dev logger above uses
  // `base` - and this cast would not catch it if something started to.
  return timed as unknown as PrismaClient
}

/**
 * The client this app actually uses. Extending changes the type, so the
 * signatures that accept a client have to come from here rather than from
 * Prisma's own `TransactionClient`, which describes an unextended one.
 */
export type Db = ReturnType<typeof createPrismaClient>

/** What a `$transaction` callback is handed: the models, without the methods
 * that only mean anything outside a transaction. */
export type DbTransactionClient = Omit<
  Db,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db
