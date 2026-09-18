import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import express from "express"
import request from "supertest"

import { appVersionGate } from "./appVersionGate"
import { resetVersionPolicy } from "../lib/appVersion"

const app = express()
app.use(appVersionGate)
// One route per surface the gate treats differently. The handlers are stand-ins
// — nothing here needs a database, because the gate answers before any
// controller runs, which is itself part of what these cases prove.
app.get("/api/getMenu", (_req, res) => {
  res.status(200).json({ reached: true })
})
app.get("/api/admin/getOrders", (_req, res) => {
  res.status(200).json({ reached: true })
})
app.post("/api/internal/winners/settle", (_req, res) => {
  res.status(200).json({ reached: true })
})

const THRESHOLDS = [
  "MIN_APP_BUILD_IOS",
  "MIN_APP_BUILD_ANDROID",
  "RECOMMENDED_APP_BUILD_IOS",
  "RECOMMENDED_APP_BUILD_ANDROID",
] as const

/** A customer app request, as apiClient sends one. */
const asApp = (
  path = "/api/getMenu",
  build: string | null = "10",
  platform: string | null = "ios",
) => {
  const pending = request(app).get(path)
  if (build !== null) pending.set("X-App-Build", build)
  if (platform !== null) pending.set("X-App-Platform", platform)
  return pending
}

beforeEach(() => {
  for (const name of THRESHOLDS) vi.stubEnv(name, "")
  resetVersionPolicy()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("appVersionGate", () => {
  it("lets a request with no version headers through, because the staff app and the website send none", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "100")

    const res = await asApp("/api/getMenu", null, null)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ reached: true })
  })

  it("lets a request through when only one of the two headers arrived", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "100")

    expect((await asApp("/api/getMenu", "1", null)).status).toBe(200)
    expect((await asApp("/api/getMenu", null, "ios")).status).toBe(200)
  })

  it("lets a request through when it cannot read the build it was sent", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "100")

    expect((await asApp("/api/getMenu", "1.0.0")).status).toBe(200)
    // Node folds a header sent twice into one comma-separated value.
    expect((await asApp("/api/getMenu", "1, 2")).status).toBe(200)
  })

  it("lets a build from a platform with no store to send it to through", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "100")
    vi.stubEnv("MIN_APP_BUILD_ANDROID", "100")

    expect((await asApp("/api/getMenu", "1", "web")).status).toBe(200)
  })

  it("lets every build through when no minimum is configured", async () => {
    expect((await asApp("/api/getMenu", "1")).status).toBe(200)
  })

  it("refuses a build below the minimum with the code the app branches on", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "10")

    const res = await asApp("/api/getMenu", "9")

    expect(res.status).toBe(426)
    expect(res.body).toEqual({
      code: "APP_UPDATE_REQUIRED",
      message: "Please update the Eversweet app to keep ordering.",
    })
  })

  it("lets a build that is exactly on the minimum through", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "10")

    expect((await asApp("/api/getMenu", "10")).status).toBe(200)
  })

  it("refuses an Android build below the Android minimum while the same iOS build passes", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "5")
    vi.stubEnv("MIN_APP_BUILD_ANDROID", "50")

    expect((await asApp("/api/getMenu", "10", "ios")).status).toBe(200)
    expect((await asApp("/api/getMenu", "10", "android")).status).toBe(426)
  })

  it("asks a build below the recommended build to update without refusing it", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "5")
    vi.stubEnv("RECOMMENDED_APP_BUILD_IOS", "20")

    const res = await asApp("/api/getMenu", "10")

    expect(res.status).toBe(200)
    expect(res.headers["x-app-update-recommended"]).toBe("20")
  })

  it("sends no recommendation to a build on the recommended build", async () => {
    vi.stubEnv("RECOMMENDED_APP_BUILD_IOS", "20")

    const res = await asApp("/api/getMenu", "20")

    expect(res.status).toBe(200)
    expect(res.headers["x-app-update-recommended"]).toBeUndefined()
  })

  it("builds the recommendation from the number, not from the variable it was given", async () => {
    // A value typed with stray whitespace must not reach the header as it was
    // written — rendering it from an integer is what makes header injection
    // impossible rather than merely unlikely.
    vi.stubEnv("RECOMMENDED_APP_BUILD_IOS", "  20  ")

    const res = await asApp("/api/getMenu", "10")

    expect(res.headers["x-app-update-recommended"]).toBe("20")
  })

  it("tells caches that the answer depends on the app build", async () => {
    // Several public endpoints answer with Cache-Control: public. Without this
    // a cache could hand the update-recommended header to an app that is
    // already current, or withhold it from one that is not.
    const res = await asApp("/api/getMenu", "10")

    expect(res.headers["vary"]).toMatch(/x-app-build/i)
  })

  it("tells caches it depends on the platform too, since the thresholds differ", async () => {
    // The same build number passes on one platform and is refused on the other.
    // On the build alone, a cache could answer an Android request from an iOS
    // response and wave a retired build through.
    const res = await asApp("/api/getMenu", "10")

    expect(res.headers["vary"]).toMatch(/x-app-platform/i)
  })

  it("tells caches so even for a request it never judged", async () => {
    const res = await asApp("/api/getMenu", null, null)

    expect(res.headers["vary"]).toMatch(/x-app-build/i)
    expect(res.headers["vary"]).toMatch(/x-app-platform/i)
  })

  it("never refuses a staff app request, whatever build it claims", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "100")

    const res = await asApp("/api/admin/getOrders", "1")

    expect(res.status).toBe(200)
  })

  it("never refuses an internal request, whatever build it claims", async () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "100")

    const res = await request(app)
      .post("/api/internal/winners/settle")
      .set("X-App-Build", "1")
      .set("X-App-Platform", "ios")

    expect(res.status).toBe(200)
  })
})
