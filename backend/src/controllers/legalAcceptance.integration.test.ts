import { beforeEach, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { LEGAL_LAST_UPDATED } from "../legal/legalDocuments"
import { describeIfDb, resetDatabase } from "../test/db"
import { makeUser } from "../test/factories"

vi.mock("../lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

// Sign-up mails a verification code. Not what these tests are about.
vi.mock("../lib/emailSender", () => ({ default: vi.fn(async () => {}) }))

const signUp = (body: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/auth/signup")
    .send({
      firstName: "grace",
      lastName: "hopper",
      email: `grace.${Math.random().toString(36).slice(2)}@example.com`,
      phoneNumber: "+64211234567",
      password: "correct horse",
      ...body,
    })

/**
 * What a customer accepted when they signed up - and that they accepted anything at all.
 *
 * The app's sign-up screen asks them to accept both documents, and for a while that was the
 * whole of it: the checkbox was screen state, the request did not carry it and the endpoint
 * had nowhere to put it. It was then recorded but not required, so a request without it
 * still made an account. Now no account is created without an acceptance of the documents
 * this server is currently serving.
 */
describeIfDb("requiring legal acceptance at sign-up", () => {
  beforeEach(async () => {
    await resetDatabase()
    redis.clear()
    redis.recover()
  })

  const storedFor = async (email: string) =>
    db.user.findUniqueOrThrow({
      where: { email: email.toLowerCase() },
      select: { acceptedLegalVersion: true, acceptedLegalAt: true },
    })

  const accountExists = async (email: string) =>
    (await db.user.count({ where: { email: email.toLowerCase() } })) > 0

  it("creates the account and records the version accepted", async () => {
    const email = "grace.accepts@example.com"

    const res = await signUp({ email, acceptedLegalVersion: LEGAL_LAST_UPDATED })

    expect(res.status).toBe(201)
    const stored = await storedFor(email)
    expect(stored.acceptedLegalVersion).toBe(LEGAL_LAST_UPDATED)
    expect(stored.acceptedLegalAt).not.toBeNull()
  })

  /**
   * Every build shipped before this one sends nothing, and its sign-up screen has no
   * checkbox to tick - so the answer names the one thing that customer can do.
   */
  it("refuses a sign-up that accepts nothing, and says to update", async () => {
    const email = "grace.oldbuild@example.com"

    const res = await signUp({ email })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe("LEGAL_ACCEPTANCE_REQUIRED")
    expect(res.body.message).toMatch(/update the Eversweet app/)
    expect(await accountExists(email)).toBe(false)
  })

  /**
   * Not a 426. That code tells the app the whole build is retired and puts up a wall, and
   * this build still signs in and orders perfectly well.
   */
  it("does not retire the build over it", async () => {
    const res = await signUp({ email: "grace.not426@example.com" })

    expect(res.status).not.toBe(426)
    expect(res.body.code).not.toBe("APP_UPDATE_REQUIRED")
  })

  it.each([
    ["a number", 42],
    ["an object", { version: LEGAL_LAST_UPDATED }],
    ["blank", "   "],
    ["null", null],
  ])("treats %s as no acceptance", async (_name, value) => {
    const email = `grace.${String(_name).replace(/\W/g, "")}@example.com`

    const res = await signUp({ email, acceptedLegalVersion: value })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe("LEGAL_ACCEPTANCE_REQUIRED")
    expect(await accountExists(email)).toBe(false)
  })

  /**
   * `/signup` is unauthenticated, so anything can post to it. A claim of a version nobody was
   * ever shown is not an acceptance of anything.
   */
  it("refuses a version this server does not serve", async () => {
    const email = "grace.fabricated@example.com"
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const res = await signUp({ email, acceptedLegalVersion: "1 January 1999" })

    expect(res.status).toBe(409)
    expect(res.body.code).toBe("LEGAL_DOCUMENTS_UPDATED")
    expect(await accountExists(email)).toBe(false)

    vi.restoreAllMocks()
  })

  /**
   * The ordinary way to reach that branch: an honest app whose cached documents are a few
   * minutes behind a deploy that changed them. The app reloads them and asks again on this
   * code, so the answer has to be one it can tell apart from a missing acceptance.
   */
  it("tells an out-of-date acceptance apart from none", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const stale = await signUp({ acceptedLegalVersion: "12 June 2026" })
    const none = await signUp({})

    expect(stale.body.code).not.toBe(none.body.code)
    expect(stale.body.message).toMatch(/updated/)

    vi.restoreAllMocks()
  })

  /** The claimed value is unvalidated client input, so it never reaches the log. */
  it("logs a refused version without echoing it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await signUp({ acceptedLegalVersion: "<script>forged</script>" })

    const logged = warn.mock.calls.flat().join(" ")
    expect(logged).not.toContain("forged")
    expect(logged).toContain(LEGAL_LAST_UPDATED)

    vi.restoreAllMocks()
  })

  /**
   * Checked before the email lookup. The other order would answer "already registered" to
   * a request that accepted nothing, which turns the refusal into a way of asking whether
   * an address has an account.
   */
  it("refuses before saying whether the email is registered", async () => {
    const taken = await makeUser()
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const none = await signUp({ email: taken.email })
    const stale = await signUp({
      email: taken.email,
      acceptedLegalVersion: "12 June 2026",
    })

    expect(none.body.message).not.toMatch(/already registered/)
    expect(stale.body.message).not.toMatch(/already registered/)

    vi.restoreAllMocks()
  })

  it("trims what it stores", async () => {
    const email = "grace.padded@example.com"

    await signUp({ email, acceptedLegalVersion: `  ${LEGAL_LAST_UPDATED}  ` })

    expect((await storedFor(email)).acceptedLegalVersion).toBe(
      LEGAL_LAST_UPDATED,
    )
  })

  /**
   * The documents carry their own version, and it is what the app sends. If these ever
   * stop matching, every sign-up is refused.
   */
  it("accepts exactly the version the documents are served with", async () => {
    const served = await request(app).get("/api/getTermAndConditions")
    const email = "grace.matches@example.com"

    const res = await signUp({
      email,
      acceptedLegalVersion: served.body.lastUpdated,
    })

    expect(res.status).toBe(201)
    expect((await storedFor(email)).acceptedLegalVersion).toBe(
      served.body.lastUpdated,
    )
  })
})
