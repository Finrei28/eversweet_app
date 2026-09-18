/**
 * Which customer app builds this server still supports.
 *
 * The app has no over-the-air updates, so the only way to retire a build is to
 * refuse it and send its customer to the store. Two thresholds per platform:
 * below `MIN_APP_BUILD_*` the build is refused outright, and below
 * `RECOMMENDED_APP_BUILD_*` it is asked — not made — to update.
 *
 * Build numbers rather than `expo.version`, because EAS owns them. `eas.json`
 * has `appVersionSource: "remote"` with `autoIncrement`, which moves the build
 * number on every production build and never touches `expo.version` — so every
 * build shipped so far reports version "1.0.0" and the version axis carries no
 * history. A threshold nobody has to remember to bump is the one that still
 * works a year from now. Being plain integers, they also cannot be compared
 * wrongly the way "1.10.0" and "1.9.0" can.
 *
 * iOS and Android are counted separately because EAS counts them separately,
 * and because the two stores approve and roll out independently.
 */
import { getErrorMessage } from "../utils/getError"

export type AppPlatform = "ios" | "android"

export type AppBuildCheck =
  | { outcome: "ok" }
  | { outcome: "blocked" }
  | { outcome: "recommend"; recommended: number }

/**
 * Android's `versionCode` is a signed 32-bit integer, and iOS build numbers are
 * far smaller, so anything larger is not a build number — it is someone seeing
 * what this endpoint does with a long string.
 */
const MAX_BUILD = 2_147_483_647
const MAX_BUILD_DIGITS = 10

/**
 * A build number, or null for "no opinion".
 *
 * Null is the answer to anything unexpected, and every caller reads it as
 * "don't gate this". That direction is deliberate and is the opposite of
 * `middleware/serviceAuth`, which fails closed: an unset internal secret costs
 * one website integration, while a version gate armed by accident blanks every
 * customer's app at once and can only be undone by a deploy.
 *
 * A binary built outside EAS can carry a dotted `CFBundleVersion` ("1.0.0"),
 * which lands here as null and is therefore never gated. EAS's remote
 * versioning always writes a plain integer, so that only affects hand-made
 * builds, which are not the ones being retired.
 */
export const parseBuild = (value: unknown): number | null => {
  if (typeof value !== "string") return null

  const trimmed = value.trim()
  // Length first, so a megabyte of digits is refused before it is parsed.
  if (!trimmed || trimmed.length > MAX_BUILD_DIGITS) return null
  if (!/^\d+$/.test(trimmed)) return null

  const build = Number(trimmed)
  if (!Number.isSafeInteger(build) || build > MAX_BUILD) return null

  return build
}

type CachedThreshold = { raw: string | undefined; value: number | null }

/**
 * Keyed on the raw value it was read from, so a typo is reported once rather
 * than on every request, and a change made in the dashboard is picked up on the
 * next read without a restart.
 */
const thresholds = new Map<string, CachedThreshold>()

const readThreshold = (name: string): number | null => {
  const raw = process.env[name]

  const cached = thresholds.get(name)
  if (cached && cached.raw === raw) return cached.value

  let value: number | null = null

  if (raw !== undefined && raw.trim() !== "") {
    value = parseBuild(raw)
    if (value === null) {
      console.error(`${name} is not a build number; ignoring it:`, raw)
    }
  }

  thresholds.set(name, { raw, value })
  return value
}

/** Null for either threshold means that threshold gates nothing. */
export const getVersionPolicy = (
  platform: AppPlatform,
): { minimum: number | null; recommended: number | null } => {
  const suffix = platform === "ios" ? "IOS" : "ANDROID"

  try {
    return {
      minimum: readThreshold(`MIN_APP_BUILD_${suffix}`),
      recommended: readThreshold(`RECOMMENDED_APP_BUILD_${suffix}`),
    }
  } catch (error) {
    // Nothing here should throw, but this decides whether a customer can use
    // the app at all, so a surprise answers "no opinion" rather than 500.
    console.error("Could not read the app version policy:", getErrorMessage(error))
    return { minimum: null, recommended: null }
  }
}

/** Called by tests, which set the variables between cases. */
export const resetVersionPolicy = () => {
  thresholds.clear()
}

/**
 * Both bounds are inclusive: a build standing exactly on a threshold has met
 * it. Blocking wins over recommending, so a minimum raised above the
 * recommended build still refuses.
 */
export const checkAppBuild = (
  platform: AppPlatform,
  build: number,
): AppBuildCheck => {
  const { minimum, recommended } = getVersionPolicy(platform)

  if (minimum !== null && build < minimum) return { outcome: "blocked" }

  if (recommended !== null && build < recommended) {
    return { outcome: "recommend", recommended }
  }

  return { outcome: "ok" }
}
