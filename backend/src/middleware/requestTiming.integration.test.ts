import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeDessert, makeUser } from "../test/factories"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

/**
 * This exists because the timing middleware shipped broken and said nothing.
 *
 * `recordQuery` was called from Prisma's `$on("query")` handler, which runs in
 * Prisma's own async context rather than the request's, so the
 * AsyncLocalStorage lookup found nothing and every request logged
 * `db=0ms queries=0` however much work it did. The failure looked exactly like
 * an answer - a request that spent four seconds somewhere other than the
 * database - which is worse than no instrumentation at all.
 *
 * So the thing worth testing is not the arithmetic but the wiring: that the
 * queries a request runs are still attributed to it.
 */
describeIfDb("request timing", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  it("attributes the queries a request runs to that request", async () => {
    const user = await makeUser()
    const dessert = await makeDessert(1200)

    const logged: string[] = []
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logged.push(args.join(" "))
    })

    try {
      await request(app)
        .post("/api/cart/addItemToCart")
        .set("Authorization", `Bearer ${tokenFor(user.id)}`)
        .send({
          dessertId: dessert.id,
          itemPriceInCents: 1200,
          quantity: 1,
          customisations: [],
        })
        .expect(201)

      // The line is written from res.on("finish"), which can land just after
      // supertest's promise resolves.
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      spy.mockRestore()
    }

    const line = logged.find((entry) => entry.includes("addItemToCart"))

    expect(line).toBeDefined()

    const queries = Number(line?.match(/queries=(\d+)/)?.[1])

    // An add writes a cart and a line, so this is several - but the assertion
    // that matters is "not zero", which is what the broken wiring produced.
    expect(queries).toBeGreaterThan(0)
    expect(line).not.toMatch(/db=0ms/)
  })
})
