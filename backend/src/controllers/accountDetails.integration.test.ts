import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

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

// Sign-up mails a verification code. Not what these tests are about.
vi.mock("../lib/emailSender", () => ({ default: vi.fn(async () => {}) }))

const LONGEST_NAME = "A".repeat(50)

const update = (userId: string, body: Record<string, unknown>) =>
  request(app)
    .patch("/api/auth/updateUser")
    .set("Authorization", `Bearer ${tokenFor(userId)}`)
    .send({ firstName: "grace", lastName: "hopper", phone: "+64211234567", ...body })

/**
 * updateUser wrote the email address straight from the request, with nothing sent to the
 * new inbox, so an account could claim an address its owner had never seen — keeping its
 * verified mark and taking the address away from whoever really held it.
 */
describeIfDb("PATCH /api/auth/updateUser", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  it("will not change the email address", async () => {
    const user = await makeUser()

    const res = await update(user.id, { email: "someone-else@example.test" })

    expect(res.status).toBe(400)
    const stored = await db.user.findUnique({ where: { id: user.id } })
    expect(stored?.email).toBe(user.email)
    // Refused whole, not half-applied.
    expect(stored?.firstName).toBe(user.firstName)
  })

  it("saves the rest when the app sends back the address it was given", async () => {
    const user = await makeUser()

    // Case and whitespace are not a change: sign-in normalises the same way.
    const res = await update(user.id, { email: `  ${user.email.toUpperCase()} ` })

    expect(res.status).toBe(200)
    const stored = await db.user.findUnique({ where: { id: user.id } })
    expect(stored).toMatchObject({
      email: user.email,
      firstName: "Grace",
      lastName: "Hopper",
      phone: "+64211234567",
    })
  })

  it("does not lock out an account whose stored address has capitals", async () => {
    // The website shares this table and is not guaranteed to store the lower-cased form.
    const user = await makeUser({ email: "Mixed.Case@Example.test" })

    const res = await update(user.id, { email: "mixed.case@example.test" })

    expect(res.status).toBe(200)
  })

  it("saves the rest when no address is sent at all", async () => {
    const user = await makeUser()

    const res = await update(user.id, { email: undefined })

    expect(res.status).toBe(200)
    expect((await db.user.findUnique({ where: { id: user.id } }))?.email).toBe(
      user.email,
    )
  })

  /**
   * Nothing limited these. A name is printed on the kitchen receipt, shown to everyone on
   * the leaderboard and copied into every order the customer places.
   */
  describe("field limits", () => {
    it.each([
      ["first name", { firstName: "A".repeat(51) }],
      ["last name", { lastName: "A".repeat(51) }],
      ["phone number", { phone: "1".repeat(21) }],
    ])("refuses an over-long %s and changes nothing", async (_field, body) => {
      const user = await makeUser()

      const res = await update(user.id, body)

      expect(res.status).toBe(400)
      const stored = await db.user.findUnique({ where: { id: user.id } })
      expect(stored).toMatchObject({
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
      })
    })

    it("refuses a name that is not text rather than failing", async () => {
      const user = await makeUser()

      const res = await update(user.id, { firstName: { nested: "object" } })

      expect(res.status).toBe(400)
    })

    it("accepts a name at the limit", async () => {
      const user = await makeUser()

      const res = await update(user.id, { firstName: LONGEST_NAME })

      expect(res.status).toBe(200)
    })
  })
})

describeIfDb("POST /api/auth/signup", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  const signUp = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/auth/signup")
      .send({
        email: `new-${Date.now()}@example.test`,
        password: "a-long-enough-password",
        firstName: "grace",
        lastName: "hopper",
        phoneNumber: "+64211234567",
        ...body,
      })

  it.each([
    ["first name", { firstName: "A".repeat(51) }],
    ["last name", { lastName: "A".repeat(51) }],
    ["phone number", { phoneNumber: "1".repeat(21) }],
    ["email", { email: `${"a".repeat(250)}@example.test` }],
  ])("refuses an over-long %s and creates no account", async (_field, body) => {
    const res = await signUp(body)

    expect(res.status).toBe(400)
    expect(await db.user.count()).toBe(0)
  })

  // `.trim()` on a number threw before the try, and came back as a 500.
  it.each([[42], [{ nested: "object" }]])(
    "refuses an email of %j with a 400",
    async (email) => {
      const res = await signUp({ email })

      expect(res.status).toBe(400)
      expect(await db.user.count()).toBe(0)
    },
  )

  it("accepts a name at the limit", async () => {
    const res = await signUp({ firstName: LONGEST_NAME })

    expect(res.status).toBe(201)
  })
})
