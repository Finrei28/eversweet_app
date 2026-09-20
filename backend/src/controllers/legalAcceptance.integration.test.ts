import { beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "../test/redisStub"
import app from "../app"
import { db } from "../lib/db"
import { LEGAL_LAST_UPDATED } from "../legal/legalDocuments"
import { describeIfDb, resetDatabase } from "../test/db"

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
 * What a customer accepted when they signed up.
 *
 * The app's sign-up screen asks them to accept both documents, and for a while that was the
 * whole of it: the checkbox was screen state, the request did not carry it and the endpoint
 * had nowhere to put it, so there was no answer to "did this customer agree, and to what".
 *
 * It is recorded rather than required. A build already installed sends nothing, and
 * refusing its sign-ups would lock those customers out of the product entirely.
 */
describeIfDb("recording legal acceptance at sign-up", () => {
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

  it("records the version the app says it displayed", async () => {
    const email = "grace.accepts@example.com"

    const res = await signUp({ email, acceptedLegalVersion: LEGAL_LAST_UPDATED })

    expect(res.status).toBe(201)
    const stored = await storedFor(email)
    expect(stored.acceptedLegalVersion).toBe(LEGAL_LAST_UPDATED)
    expect(stored.acceptedLegalAt).not.toBeNull()
  })

  /**
   * The honest answer for a build that never asked. Stamping the current version would
   * record an acceptance that did not happen, which is worse than recording nothing.
   */
  it("records nothing when the app sends no version", async () => {
    const email = "grace.silent@example.com"

    const res = await signUp({ email })

    expect(res.status).toBe(201)
    const stored = await storedFor(email)
    expect(stored.acceptedLegalVersion).toBeNull()
    expect(stored.acceptedLegalAt).toBeNull()
  })

  /** Recorded, not required - an old build must still be able to create an account. */
  it("still creates the account without one", async () => {
    const email = "grace.oldbuild@example.com"

    await signUp({ email })

    await expect(
      db.user.findUniqueOrThrow({ where: { email } }),
    ).resolves.toBeTruthy()
  })

  it("keeps the version and the time together", async () => {
    const email = "grace.together@example.com"
    await signUp({ email, acceptedLegalVersion: LEGAL_LAST_UPDATED })

    const stored = await storedFor(email)

    expect(stored.acceptedLegalVersion === null).toBe(
      stored.acceptedLegalAt === null,
    )
  })

  /**
   * A malformed field is dropped rather than refused. It is a record, not a credential,
   * and it must not be the thing that stops somebody signing up.
   */
  it.each([
    ["a number", 42],
    ["an object", { version: "1" }],
    ["blank", "   "],
    ["absurdly long", "v".repeat(200)],
  ])("ignores %s without refusing the sign-up", async (_name, value) => {
    const email = `grace.${String(_name).replace(/\W/g, "")}@example.com`

    const res = await signUp({ email, acceptedLegalVersion: value })

    expect(res.status).toBe(201)
    expect((await storedFor(email)).acceptedLegalVersion).toBeNull()
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
   * stop matching, the column records a string that identifies nothing.
   */
  it("stores a version the documents actually carry", async () => {
    const email = "grace.matches@example.com"
    await signUp({ email, acceptedLegalVersion: LEGAL_LAST_UPDATED })

    const res = await request(app).get("/api/getTermAndConditions")

    expect(res.body.lastUpdated).toBe(
      (await storedFor(email)).acceptedLegalVersion,
    )
  })
})
