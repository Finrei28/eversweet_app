import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import express from "express"
import request from "supertest"
import { rateLimit } from "express-rate-limit"

import { redisStub as redis } from "../test/redisStub"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

import { ResilientStore } from "./resilientRateLimitStore"

const PREFIX = "rate-limit:test:"
const KEY = `${PREFIX}same-client`

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A limiter of two, built fresh per test so no count or cooldown leaks between them. The
 * timeout and cooldown are shortened so the recovery paths can run in real time.
 */
const makeApp = ({
  skipSuccessfulRequests = false,
}: { skipSuccessfulRequests?: boolean } = {}) => {
  const app = express()
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 2,
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests,
      keyGenerator: () => "same-client",
      store: new ResilientStore(PREFIX, { timeoutMs: 50, cooldownMs: 200 }),
    }),
  )
  app.get("/", (_req, res) => {
    res.status(200).send("ok")
  })
  return app
}

const statuses = async (app: express.Express, count: number) => {
  const seen: number[] = []
  for (let i = 0; i < count; i++) seen.push((await request(app).get("/")).status)
  return seen
}

beforeEach(() => {
  redis.clear()
  redis.recover()
  // The store says when it changes state; keep the output about the tests.
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  vi.spyOn(console, "log").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("ResilientStore", () => {
  it("counts in Redis while Redis is up", async () => {
    const app = makeApp()

    expect(await statuses(app, 3)).toEqual([200, 200, 429])
    expect(redis.keys()).toContain(KEY)
  })

  // This used to be a 500 on every limited route — sign-in, OTPs, prize codes — and
  // falling back to no limit at all would hand the outage to anyone brute-forcing one.
  it("keeps the limit, in memory, when Redis is down", async () => {
    redis.goDown()
    const app = makeApp()

    expect(await statuses(app, 3)).toEqual([200, 200, 429])
    expect(redis.keys()).not.toContain(KEY)
  })

  // Nothing bounded the call before, so ioredis queued it and retried twenty times.
  it("answers within the timeout when Redis hangs", async () => {
    redis.hang()
    const app = makeApp()

    const started = Date.now()
    expect(await statuses(app, 3)).toEqual([200, 200, 429])
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it("does not ask Redis again during the cooldown", async () => {
    redis.goDown()
    const app = makeApp()
    await request(app).get("/")

    const call = vi.spyOn(redis.redis, "call")
    await statuses(app, 5)

    expect(call).not.toHaveBeenCalled()
  })

  /**
   * The trap in rate-limit-redis: its init caches the promise of loading the Lua scripts,
   * and a rejected promise stays rejected, so a Redis blip at boot kept every limiter
   * failing until the process restarted. The store has to reload the scripts itself.
   */
  it("goes back to Redis when it recovers, even after failing at boot", async () => {
    redis.goDown()
    const app = makeApp()
    expect((await request(app).get("/")).status).toBe(200)
    expect(redis.keys()).not.toContain(KEY)

    redis.recover()
    await sleep(250)

    expect((await request(app).get("/")).status).toBe(200)
    expect(redis.keys()).toContain(KEY)
  })

  // skipSuccessfulRequests un-counts a success through decrement, which has to survive an
  // outage too or every successful sign-in would error on its way out.
  it("un-counts successful requests without error while Redis is down", async () => {
    redis.goDown()
    const app = makeApp({ skipSuccessfulRequests: true })

    // Each success is taken back off the count, so a limit of two is never reached.
    expect(await statuses(app, 5)).toEqual([200, 200, 200, 200, 200])
  })
})
