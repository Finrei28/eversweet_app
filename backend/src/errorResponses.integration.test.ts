import { beforeEach, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "./test/redisStub"
import app from "./app"
import { db } from "./lib/db"
import { describeIfDb, resetDatabase, tokenFor } from "./test/db"
import { makeUser } from "./test/factories"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("./lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

/** Words that only appear in a response when an internal error has been passed through. */
const INTERNALS = /prisma|invocation|stack|at .*\.ts|SyntaxError|clientVersion/i

/**
 * Handlers used to answer a failure with the error itself — `{ message: error }`, or an
 * `error` field carrying its message — which put Prisma's model, argument and query
 * details in front of whoever sent the request. Anything thrown outside a try went to
 * Express's default handler instead: an HTML page with the stack trace outside production.
 */
describeIfDb("error responses", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  it("answers a failing query inside a handler without the database's error", async () => {
    const user = await makeUser()

    // An object where an id belongs makes Prisma throw a validation error that names the
    // model and the argument — which is what used to come back.
    const res = await request(app)
      .get("/api/auth/getOrder")
      .set("Authorization", `Bearer ${tokenFor(user.id)}`)
      .send({ orderId: { not: "anything" } })

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ message: "Internal server error" })
    expect(res.text).not.toMatch(INTERNALS)
  })

  it("answers a throw outside any try as JSON, with no stack trace", async () => {
    // adminSignIn queries before it has a try.
    const res = await request(app)
      .post("/api/admin/signin")
      .send({ username: { not: "anyone" }, password: "irrelevant" })

    expect(res.status).toBe(500)
    expect(res.headers["content-type"]).toMatch(/json/)
    expect(res.body).toEqual({ message: "Internal server error" })
    expect(res.text).not.toMatch(INTERNALS)
  })

  it("keeps a malformed body a 400, without echoing the parser's error", async () => {
    const res = await request(app)
      .post("/api/auth/signin")
      .set("Content-Type", "application/json")
      .send('{"email": "a@b.c", "password": ')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ message: "Bad request" })
    expect(res.text).not.toMatch(INTERNALS)
  })

  // Answered as a server fault, with an error logged, for every request a foreign page sent.
  it("refuses a browser request from another site as forbidden, without logging an error", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})

    const res = await request(app)
      .get("/api/getStoreHours")
      .set("Origin", "https://not-eversweet.example")

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ message: "Forbidden" })
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })

  // A 403 for someone else's order and a 404 for a missing one told a stranger which ids
  // were real orders.
  it("answers the status of someone else's order exactly as a missing one", async () => {
    const owner = await makeUser()
    const stranger = await makeUser()
    const order = await db.order.create({
      data: {
        tempOrderId: "6001",
        priceInCents: 1200,
        customerFirstName: "Ada",
        customerLastName: "Lovelace",
        customerEmail: owner.email,
        status: "PENDING",
        GST: 157,
        source: "APP",
        appUserId: owner.id,
      },
    })

    const theirs = await request(app)
      .get(`/api/auth/orderStatus/${order.id}`)
      .set("Authorization", `Bearer ${tokenFor(stranger.id)}`)
    const missing = await request(app)
      .get("/api/auth/orderStatus/no-such-order")
      .set("Authorization", `Bearer ${tokenFor(stranger.id)}`)

    expect(theirs.status).toBe(404)
    expect(theirs.body).toEqual(missing.body)
  })
})
