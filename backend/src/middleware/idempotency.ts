import { NextFunction, Request, Response } from "express"
import { redis } from "../lib/redis"
import { getErrorMessage } from "../utils/getError"

/** How long a completed response stays replayable. */
const TTL_SECONDS = 60 * 60 * 24

/** Value stored while the first attempt is still running. */
const IN_PROGRESS = "in-progress"

/**
 * Redis is the fast path here, not the guarantee — the unique constraint on
 * Order.paymentIntentId is. So every call is bounded and every failure falls
 * open: a cache that is slow or down must not be able to stop people ordering.
 */
const CACHE_TIMEOUT_MS = 500

type CacheResult<T> = { ok: true; value: T } | { ok: false }

const cache = <T>(work: Promise<T>): Promise<CacheResult<T>> => {
  const attempt = work.then(
    (value) => ({ ok: true as const, value }),
    (error) => {
      console.error("Idempotency cache unavailable:", getErrorMessage(error))
      return { ok: false as const }
    },
  )

  const timeout = new Promise<CacheResult<T>>((resolve) => {
    setTimeout(() => resolve({ ok: false }), CACHE_TIMEOUT_MS).unref()
  })

  return Promise.race([attempt, timeout])
}

/**
 * The header is what a current build sends. Falling back to the payment intent
 * covers builds that predate it — those are already on people's phones and
 * can't be made to update — and a payment intent is single use, so it
 * identifies one checkout attempt just as well.
 *
 * An order paid entirely in loyalty points has neither on an old build. Those
 * carry no charge to duplicate, so they go through unguarded.
 */
const idempotencyKeyFor = (req: Request): string | null => {
  const header = req.header("Idempotency-Key")?.trim()
  if (header) return `key:${header.slice(0, 200)}`

  const paymentIntentId = (
    req.body as { paymentIntentId?: unknown } | undefined
  )?.paymentIntentId

  if (typeof paymentIntentId === "string" && paymentIntentId.trim()) {
    return `pi:${paymentIntentId.trim()}`
  }

  return null
}

const replay = async (cacheKey: string, res: Response) => {
  const stored = await cache(redis.get(cacheKey))

  if (stored.ok && stored.value && stored.value !== IN_PROGRESS) {
    try {
      const { status, body } = JSON.parse(stored.value) as {
        status: number
        body: unknown
      }
      res.status(status).json(body)
      return
    } catch (error) {
      console.error("Unreadable idempotency record:", getErrorMessage(error))
    }
  }

  // The first attempt is still running. Saying so specifically is the point:
  // the client must not read this as a failure and send a paid customer back
  // to pay a second time.
  res.status(409).json({
    message: "This order is already being placed. Check your orders shortly.",
    inProgress: true,
  })
}

const captureResponse = (cacheKey: string, res: Response) => {
  const sendJson = res.json.bind(res)
  let recorded = false

  res.json = (body?: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      recorded = true
      void cache(
        redis.set(
          cacheKey,
          JSON.stringify({ status: res.statusCode, body }),
          "EX",
          TTL_SECONDS,
        ),
      )
    }

    return sendJson(body)
  }

  // Keyed off whether a success was actually recorded, not off how the
  // response was sent. A handler that throws is answered by Express's own
  // error handler, which never touches res.json — checking only there left the
  // key claimed for its full lifetime and locked the customer out of retrying
  // an order that had failed. res.send, res.end and a dropped socket are the
  // same shape of problem.
  res.on("close", () => {
    if (!recorded) void cache(redis.del(cacheKey))
  })
}

/**
 * Makes a write safe to repeat. The first request through claims the key and
 * has its response recorded; a repeat of it either replays that response or,
 * if the original is still in flight, is told so.
 *
 * Mount it after the body parser and after `authenticateToken`: keys are
 * scoped per user so one customer's key can never collide with another's.
 */
export const idempotency =
  (scope: string) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const userId = (req as any).userId as string | undefined
    const key = idempotencyKeyFor(req)

    if (!userId || !key) {
      next()
      return
    }

    const cacheKey = `idem:${scope}:${userId}:${key}`

    const reserved = await cache(
      redis.set(cacheKey, IN_PROGRESS, "EX", TTL_SECONDS, "NX"),
    )

    if (!reserved.ok) {
      next()
      return
    }

    // `SET NX` returning null means someone claimed this key first.
    if (reserved.value === null) {
      await replay(cacheKey, res)
      return
    }

    captureResponse(cacheKey, res)
    next()
  }
