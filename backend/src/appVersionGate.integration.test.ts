import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import request from "supertest"

import { redisStub as redis } from "./test/redisStub"
import app from "./app"
import { resetVersionPolicy } from "./lib/appVersion"

// Reached through a getter because vi.mock is hoisted above the imports.
vi.mock("./lib/redis", () => ({
  get redis() {
    return redis.redis
  },
}))

const THRESHOLDS = [
  "MIN_APP_BUILD_IOS",
  "MIN_APP_BUILD_ANDROID",
  "RECOMMENDED_APP_BUILD_IOS",
  "RECOMMENDED_APP_BUILD_ANDROID",
] as const

const REFUSAL = {
  code: "APP_UPDATE_REQUIRED",
  message: "Please update the Eversweet app to keep ordering.",
}

/** app.ts reads this at import time, so take it from the same place it did. */
const allowedOrigin = (process.env.ALLOWED_ORIGINS ?? "").split(",")[0]

/**
 * The gate through the whole chain, rather than on its own.
 *
 * Nothing here needs a database: every case is answered before any controller
 * runs, which is part of what is being proved. What it is really checking is
 * position — that the gate sits above the routers and below the Stripe webhook.
 */
describe("the app version gate, mounted", () => {
  beforeEach(() => {
    for (const name of THRESHOLDS) vi.stubEnv(name, "")
    resetVersionPolicy()
    redis.clear()
    redis.recover()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("refuses an out-of-date build asking for public data", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "10")

    const res = await request(app)
      .get("/api/getStoreHours")
      .set("X-App-Build", "9")
      .set("X-App-Platform", "ios")

    expect(res.status).toBe(426)
    expect(res.body).toEqual(REFUSAL)
  })

  it("refuses an out-of-date build at sign-in, before the request reaches the route", async () => {
    vi.stubEnv("MIN_APP_BUILD_ANDROID", "10")

    // An empty body would be a 400 from the controller, and a real one would
    // spend a rate-limit budget. Neither happens: the gate answers first, which
    // is why it is mounted above the routers rather than inside them.
    const res = await request(app)
      .post("/api/auth/signin")
      .set("X-App-Build", "9")
      .set("X-App-Platform", "android")
      .send({})

    expect(res.status).toBe(426)
    expect(res.body).toEqual(REFUSAL)
  })

  it("answers an out-of-date build the same way whether or not it carries a token", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "10")

    const withToken = await request(app)
      .get("/api/auth/getUserDetails")
      .set("Authorization", "Bearer not-a-real-token")
      .set("X-App-Build", "9")
      .set("X-App-Platform", "ios")

    expect(withToken.status).toBe(426)
    expect(withToken.body).toEqual(REFUSAL)
  })

  it("leaves the Stripe webhook alone, since it is mounted above the gate", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "10")

    // Stripe does not send these headers; this proves the webhook could not be
    // refused even if something did. It fails its signature check instead,
    // which is the point — it reached the handler.
    const res = await request(app)
      .post("/api/stripe/webhook")
      .set("Content-Type", "application/json")
      .set("X-App-Build", "9")
      .set("X-App-Platform", "ios")
      .send(JSON.stringify({ id: "evt_test" }))

    expect(res.status).not.toBe(426)
  })

  // getPrivacyPolicy answers from a module constant, so the cases that expect
  // to reach a controller use it rather than one of the reads that would need
  // the database this file deliberately does without.
  it("lets a build that is current through untouched", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "10")

    const res = await request(app)
      .get("/api/getPrivacyPolicy")
      .set("X-App-Build", "10")
      .set("X-App-Platform", "ios")

    expect(res.status).toBe(200)
    expect(res.headers["x-app-update-recommended"]).toBeUndefined()
  })

  it("lets the app's version headers through CORS", async () => {
    const res = await request(app)
      .options("/api/getStoreHours")
      .set("Origin", allowedOrigin)
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "x-app-build,x-app-platform")

    expect(res.headers["access-control-allow-headers"]).toMatch(/x-app-build/i)
    expect(res.headers["access-control-allow-headers"]).toMatch(
      /x-app-platform/i,
    )
  })

  it("lets a browser read the recommendation it was sent", async () => {
    vi.stubEnv("RECOMMENDED_APP_BUILD_IOS", "20")

    const res = await request(app)
      .get("/api/getPrivacyPolicy")
      .set("Origin", allowedOrigin)
      .set("X-App-Build", "10")
      .set("X-App-Platform", "ios")

    expect(res.headers["x-app-update-recommended"]).toBe("20")
    expect(res.headers["access-control-expose-headers"]).toMatch(
      /x-app-update-recommended/i,
    )
  })
})
