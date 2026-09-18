import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  checkAppBuild,
  getVersionPolicy,
  parseBuild,
  resetVersionPolicy,
} from "./appVersion"

const THRESHOLDS = [
  "MIN_APP_BUILD_IOS",
  "MIN_APP_BUILD_ANDROID",
  "RECOMMENDED_APP_BUILD_IOS",
  "RECOMMENDED_APP_BUILD_ANDROID",
] as const

beforeEach(() => {
  // setup.ts runs dotenv.config(), so a developer with these set in
  // backend/.env would otherwise arm the gate for the whole file. Every case
  // states the policy it is testing.
  for (const name of THRESHOLDS) vi.stubEnv(name, "")
  resetVersionPolicy()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("parseBuild", () => {
  it("reads a build number", () => {
    expect(parseBuild("114")).toBe(114)
  })

  it("ignores the whitespace around a value typed into a dashboard", () => {
    expect(parseBuild(" 114 ")).toBe(114)
  })

  it("refuses a build number that is not a whole number", () => {
    expect(parseBuild("1.0.0")).toBeNull()
    expect(parseBuild("114.5")).toBeNull()
    expect(parseBuild("-1")).toBeNull()
    expect(parseBuild("v114")).toBeNull()
  })

  it("refuses an empty build number", () => {
    expect(parseBuild("")).toBeNull()
    expect(parseBuild("   ")).toBeNull()
  })

  it("refuses a build number long enough to be someone probing", () => {
    expect(parseBuild("9".repeat(11))).toBeNull()
    expect(parseBuild("9".repeat(5000))).toBeNull()
  })

  it("refuses a build number past the largest Android will issue", () => {
    expect(parseBuild("2147483647")).toBe(2_147_483_647)
    expect(parseBuild("2147483648")).toBeNull()
  })

  it("refuses a header that arrived twice, which is an array rather than a string", () => {
    expect(parseBuild(["1", "2"])).toBeNull()
    expect(parseBuild(undefined)).toBeNull()
  })
})

describe("getVersionPolicy", () => {
  it("gates nothing when no thresholds are configured", () => {
    expect(getVersionPolicy("ios")).toEqual({ minimum: null, recommended: null })
  })

  it("reads the thresholds belonging to the platform it was given", () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "10")
    vi.stubEnv("MIN_APP_BUILD_ANDROID", "20")

    expect(getVersionPolicy("ios").minimum).toBe(10)
    expect(getVersionPolicy("android").minimum).toBe(20)
  })

  it("gates nothing when a threshold cannot be read, and says so once", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubEnv("MIN_APP_BUILD_IOS", "1.2.x")

    expect(getVersionPolicy("ios").minimum).toBeNull()
    // A bad value is read on every request; reporting it every time would bury
    // the log it is trying to draw attention to.
    expect(getVersionPolicy("ios").minimum).toBeNull()

    expect(errors).toHaveBeenCalledTimes(1)
    errors.mockRestore()
  })

  it("picks up a threshold changed without a restart", () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "10")
    expect(getVersionPolicy("ios").minimum).toBe(10)

    vi.stubEnv("MIN_APP_BUILD_IOS", "20")
    expect(getVersionPolicy("ios").minimum).toBe(20)
  })
})

describe("checkAppBuild", () => {
  it("lets every build through when nothing is configured", () => {
    expect(checkAppBuild("ios", 1)).toEqual({ outcome: "ok" })
  })

  it("refuses a build below the minimum", () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "10")

    expect(checkAppBuild("ios", 9)).toEqual({ outcome: "blocked" })
  })

  it("lets a build that is exactly on the minimum through", () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "10")

    expect(checkAppBuild("ios", 10)).toEqual({ outcome: "ok" })
  })

  it("recommends an update between the minimum and the recommended build", () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "10")
    vi.stubEnv("RECOMMENDED_APP_BUILD_IOS", "20")

    expect(checkAppBuild("ios", 15)).toEqual({
      outcome: "recommend",
      recommended: 20,
    })
  })

  it("says nothing to a build that is on the recommended build", () => {
    vi.stubEnv("RECOMMENDED_APP_BUILD_IOS", "20")

    expect(checkAppBuild("ios", 20)).toEqual({ outcome: "ok" })
  })

  it("refuses a build below a minimum raised past the recommended build", () => {
    // Someone raising the minimum and forgetting the other value should still
    // get the refusal they asked for, not a suggestion.
    vi.stubEnv("MIN_APP_BUILD_IOS", "30")
    vi.stubEnv("RECOMMENDED_APP_BUILD_IOS", "20")

    expect(checkAppBuild("ios", 25)).toEqual({ outcome: "blocked" })
  })

  it("judges each platform against its own thresholds", () => {
    vi.stubEnv("MIN_APP_BUILD_IOS", "10")
    vi.stubEnv("MIN_APP_BUILD_ANDROID", "50")

    expect(checkAppBuild("ios", 20)).toEqual({ outcome: "ok" })
    expect(checkAppBuild("android", 20)).toEqual({ outcome: "blocked" })
  })
})
