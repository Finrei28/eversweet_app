import { AsyncLocalStorage } from "node:async_hooks"
import { Request, Response, NextFunction } from "express"

type RequestTiming = { queries: number; dbMs: number }

const store = new AsyncLocalStorage<RequestTiming>()

/** Called by the Prisma client for every query it runs. */
export function recordQuery(durationMs: number) {
  const timing = store.getStore()
  if (!timing) return

  timing.queries += 1
  timing.dbMs += durationMs
}

/**
 * Records how much of each request went on waiting for the database.
 *
 * A single round trip to this app's Postgres costs the better part of a
 * second, which makes "how many queries did this endpoint run" the number that
 * decides how fast it feels. That was previously only knowable by reading the
 * controller and counting awaits by hand — this makes it something the logs
 * say outright, so the next slow endpoint is a measurement rather than a
 * guess.
 *
 * Quiet by design: requests that never touched the database and returned
 * promptly say nothing.
 */
export function requestTiming(req: Request, res: Response, next: NextFunction) {
  const timing: RequestTiming = { queries: 0, dbMs: 0 }
  const startedAt = Date.now()

  store.run(timing, () => {
    res.on("finish", () => {
      const totalMs = Date.now() - startedAt

      if (timing.queries === 0 && totalMs < 500) return

      // `up` is how long this process has been alive. A slow request a few
      // seconds after boot is a cold start - a new container, a new Prisma
      // engine and a first connection to establish - not a slow query, and the
      // two are worth telling apart before optimising either.
      console.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} ${totalMs}ms ` +
          `db=${Math.round(timing.dbMs)}ms queries=${timing.queries} ` +
          `up=${Math.round(process.uptime())}s`,
      )
    })

    next()
  })
}
