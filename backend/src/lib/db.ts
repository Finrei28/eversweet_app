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

  if (process.env.NODE_ENV === "development") {
    base.$on("query", (event) => {
      console.log(`prisma ${event.duration}ms ${event.query}`)
    })
  }

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
