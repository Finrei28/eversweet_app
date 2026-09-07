import { beforeEach, describe, expect, it, vi } from "vitest"
import express from "express"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import { idempotency } from "./idempotency"

// vi.mock is hoisted above those imports, so the stub has to be reached
// through a getter: the factory is registered before `redis` is initialised,
// but not read until the middleware actually asks for a connection.
vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

/**
 * A minimal app carrying the real middleware. `handler` is swapped per test so
 * a case can control what the route does — succeed, fail, throw, or hang.
 */
let handler: express.RequestHandler
let handlerCalls = 0

const makeApp = (userId = "user-1") => {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    ;(req as any).userId = userId
    next()
  })
  app.post("/orders", idempotency("createOrder"), (req, res, next) => {
    handlerCalls += 1
    return handler(req, res, next)
  })
  return app
}

const succeed = (body: unknown = { order: { id: "order-1" } }, status = 201) =>
  ((_req, res) => {
    res.status(status).json(body)
  }) as express.RequestHandler

beforeEach(() => {
  redis.clear()
  redis.recover()
  handlerCalls = 0
  handler = succeed()
})

describe("idempotency", () => {
  it("runs the handler and records the response on a first request", async () => {
    const res = await request(makeApp())
      .post("/orders")
      .set("Idempotency-Key", "key-1")
      .send({})

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ order: { id: "order-1" } })
    expect(handlerCalls).toBe(1)
  })

  it("replays the first response instead of running the handler again", async () => {
    const app = makeApp()
    const first = await request(app)
      .post("/orders")
      .set("Idempotency-Key", "key-1")
      .send({})

    // The second attempt would create a second order if it reached the handler.
    handler = succeed({ order: { id: "order-2" } })

    const second = await request(app)
      .post("/orders")
      .set("Idempotency-Key", "key-1")
      .send({})

    expect(second.status).toBe(first.status)
    expect(second.body).toEqual({ order: { id: "order-1" } })
    expect(handlerCalls).toBe(1)
  })

  it("tells a caller the first attempt is still running rather than duplicating it", async () => {
    const app = makeApp()

    let releaseFirst: () => void = () => {}
    const firstFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    handler = async (_req, res) => {
      await firstFinished
      res.status(201).json({ order: { id: "order-1" } })
    }

    // `.then()` is what dispatches a supertest request; holding the Test
    // object alone would leave it unsent and the key unclaimed.
    const inFlight = request(app)
      .post("/orders")
      .set("Idempotency-Key", "key-1")
      .send({})
      .then((r) => r)

    // Give the first request time to claim the key before the retry arrives.
    await vi.waitFor(() => expect(handlerCalls).toBe(1))

    const retry = await request(app)
      .post("/orders")
      .set("Idempotency-Key", "key-1")
      .send({})

    expect(retry.status).toBe(409)
    expect(retry.body.inProgress).toBe(true)
    // The one thing that must not happen: a second order.
    expect(handlerCalls).toBe(1)

    releaseFirst()
    await expect(inFlight).resolves.toMatchObject({ status: 201 })
  })

  it("releases the key when the attempt fails, so a retry can succeed", async () => {
    const app = makeApp()

    handler = succeed({ message: "Cart is empty" }, 400)
    const failed = await request(app)
      .post("/orders")
      .set("Idempotency-Key", "key-1")
      .send({})
    expect(failed.status).toBe(400)

    handler = succeed()
    const retry = await request(app)
      .post("/orders")
      .set("Idempotency-Key", "key-1")
      .send({})

    expect(retry.status).toBe(201)
    expect(handlerCalls).toBe(2)
  })

  it("releases the key when the handler throws without answering", async () => {
    const app = makeApp()

    handler = () => {
      throw new Error("boom")
    }
    await request(app).post("/orders").set("Idempotency-Key", "key-1").send({})

    handler = succeed()
    const retry = await request(app)
      .post("/orders")
      .set("Idempotency-Key", "key-1")
      .send({})

    expect(retry.status).toBe(201)
  })

  it("falls back to the payment intent when a build sends no header", async () => {
    const app = makeApp()

    const first = await request(app)
      .post("/orders")
      .send({ paymentIntentId: "pi_123" })
    expect(first.status).toBe(201)

    handler = succeed({ order: { id: "order-2" } })
    const second = await request(app)
      .post("/orders")
      .send({ paymentIntentId: "pi_123" })

    expect(second.body).toEqual({ order: { id: "order-1" } })
    expect(handlerCalls).toBe(1)
  })

  it("passes through unguarded when there is neither header nor payment intent", async () => {
    // An order paid entirely in loyalty points on an old build. No charge to
    // duplicate, so it must not be blocked.
    const app = makeApp()

    await request(app).post("/orders").send({})
    await request(app).post("/orders").send({})

    expect(handlerCalls).toBe(2)
  })

  it("scopes keys per user, so one customer's key cannot answer another's", async () => {
    await request(makeApp("user-1"))
      .post("/orders")
      .set("Idempotency-Key", "same-key")
      .send({})

    handler = succeed({ order: { id: "order-2" } })

    const other = await request(makeApp("user-2"))
      .post("/orders")
      .set("Idempotency-Key", "same-key")
      .send({})

    expect(other.body).toEqual({ order: { id: "order-2" } })
    expect(handlerCalls).toBe(2)
  })

  it("lets the order through when Redis is unreachable", async () => {
    // The cache is the fast path, not the guarantee — the unique constraint on
    // paymentIntentId is. An outage must not stop anyone ordering.
    redis.goDown()

    const res = await request(makeApp())
      .post("/orders")
      .set("Idempotency-Key", "key-1")
      .send({})

    expect(res.status).toBe(201)
    expect(handlerCalls).toBe(1)
  })

  it("lets the order through when Redis stops responding", async () => {
    redis.hang()

    const res = await request(makeApp())
      .post("/orders")
      .set("Idempotency-Key", "key-1")
      .send({})

    expect(res.status).toBe(201)
    expect(handlerCalls).toBe(1)
  })
})
