import { beforeEach, expect, it, vi } from "vitest"
import request from "supertest"
import jwt from "jsonwebtoken"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { describeIfDb, resetDatabase, tokenFor } from "../test/db"
import { makeUser } from "../test/factories"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

/** An admin-only read with no side effects. */
const ADMIN_ROUTE = "/api/admin/getCurrentOrders"
/** Any signed-in user may call this. */
const USER_ROUTE = "/api/auth/getUser"

const get = (path: string, token: string) =>
  request(app).get(path).set("Authorization", `Bearer ${token}`)

/**
 * The role used to come from the token, which is fixed for the token's whole life —
 * 90 days for customers, 180 for staff — so demoting an admin changed nothing until it
 * expired. It now comes from the user row, through the same cache as the password check.
 */
describeIfDb("authenticateToken", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  it("refuses an admin route to a customer whose token claims ADMIN", async () => {
    const user = await makeUser()

    const res = await get(ADMIN_ROUTE, tokenFor(user.id, "ADMIN"))

    expect(res.status).toBe(403)
  })

  it("lets an admin through on the role on record", async () => {
    const admin = await makeUser()
    await db.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } })

    const res = await get(ADMIN_ROUTE, tokenFor(admin.id, "ADMIN"))

    expect(res.status).toBe(200)
  })

  it("stops honouring an admin once the role is taken away", async () => {
    const admin = await makeUser()
    await db.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } })
    const token = tokenFor(admin.id, "ADMIN")

    expect((await get(ADMIN_ROUTE, token)).status).toBe(200)

    await db.user.update({ where: { id: admin.id }, data: { role: "USER" } })
    // The cached role lives for a minute; this is that minute passing.
    redis.clear()

    expect((await get(ADMIN_ROUTE, token)).status).toBe(403)
  })

  it("reads the role straight from the database while Redis is down", async () => {
    const demoted = await makeUser()
    redis.goDown()

    const res = await get(ADMIN_ROUTE, tokenFor(demoted.id, "ADMIN"))

    expect(res.status).toBe(403)
  })

  it("ignores a cache entry it cannot read rather than trusting the token", async () => {
    const user = await makeUser()
    await redis.redis.set(`auth:session:${user.id}`, "not json at all")

    const res = await get(ADMIN_ROUTE, tokenFor(user.id, "ADMIN"))

    expect(res.status).toBe(403)
  })

  it("refuses a token minted before the password was last changed", async () => {
    const user = await makeUser()
    const token = tokenFor(user.id)
    await db.user.update({
      where: { id: user.id },
      data: { passwordChangedAt: new Date(Date.now() + 60_000) },
    })

    expect((await get(USER_ROUTE, token)).status).toBe(403)
  })

  it("accepts a token minted after the password was changed", async () => {
    const user = await makeUser()
    await db.user.update({
      where: { id: user.id },
      data: { passwordChangedAt: new Date(Date.now() - 60_000) },
    })

    expect((await get(USER_ROUTE, tokenFor(user.id))).status).toBe(200)
  })

  it("refuses a validly signed token for an account that no longer exists", async () => {
    const token = jwt.sign({ userId: "deleted-account" }, process.env.JWT_SECRET!, {
      expiresIn: "1h",
    })

    expect((await get(USER_ROUTE, token)).status).toBe(403)
  })
})
