import { NextFunction, Request, Response } from "express"
import { AppPlatform, checkAppBuild, parseBuild } from "../lib/appVersion"

export const APP_BUILD_HEADER = "x-app-build"
export const APP_PLATFORM_HEADER = "x-app-platform"
export const UPDATE_RECOMMENDED_HEADER = "X-App-Update-Recommended"

export const APP_UPDATE_REQUIRED_BODY = {
  code: "APP_UPDATE_REQUIRED",
  message: "Please update the Eversweet app to keep ordering.",
} as const

/**
 * Requests that are not the customer app, however they are labelled.
 *
 * `/api/admin` is the kitchen tablet and `/api/internal` is the website, and
 * neither is versioned by this app's thresholds. Nothing they send would reach
 * the check anyway — they set no version header — but saying so here means the
 * rule is in the code rather than resting on that accident.
 */
const UNGATED_PREFIXES = ["/api/admin", "/api/internal"]

/**
 * Turns away customer app builds this server no longer supports.
 *
 * The app has no over-the-air updates, so refusing the request is the only way
 * to reach an installed build. A build below `MIN_APP_BUILD_*` gets a 426 it
 * knows to read as "put up the update wall"; one below
 * `RECOMMENDED_APP_BUILD_*` is let through carrying a header that asks it to
 * update at the next convenient moment.
 *
 * **A request with no version header is always let through.** The staff app,
 * the website and every customer build that predates this middleware send none,
 * and there is no way to tell them apart — so refusing headerless requests
 * would take the kitchen offline on the first deploy. The cost is that this
 * gate can never reach a build that exists today; its value starts with the
 * next one. That is also why the in-band `authoriseOnly` check in
 * `createPaymentIntent` has to stay: that one is proved by the request itself.
 */
export const appVersionGate = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Unconditionally, and before anything can return early. Several public
  // endpoints answer with `Cache-Control: public`, and a response that carries
  // the update-recommended header must not be handed by a cache to an app that
  // is already up to date — nor a response without it to one that is not.
  // Set here rather than from a `res.on("finish")` hook like requestTiming's:
  // that fires after the headers are flushed, where this would throw.
  res.vary(APP_BUILD_HEADER)

  if (UNGATED_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    next()
    return
  }

  const givenPlatform = req.headers[APP_PLATFORM_HEADER]
  const givenBuild = req.headers[APP_BUILD_HEADER]

  // Express types these as `string | string[]`, because Node hands back an
  // array for the few headers it never folds. A header like this one sent twice
  // is folded into one comma-separated value instead, which parseBuild then
  // refuses — so a duplicate fails open either way.
  if (typeof givenPlatform !== "string" || typeof givenBuild !== "string") {
    next()
    return
  }

  const platform = givenPlatform.trim().toLowerCase()

  // "web" reaches here from a browser build, which has no store to be sent to.
  if (platform !== "ios" && platform !== "android") {
    next()
    return
  }

  const build = parseBuild(givenBuild)
  if (build === null) {
    next()
    return
  }

  const check = checkAppBuild(platform as AppPlatform, build)

  if (check.outcome === "blocked") {
    res.status(426).json(APP_UPDATE_REQUIRED_BODY)
    return
  }

  if (check.outcome === "recommend") {
    // Rendered from the number, never echoed from the variable it was read
    // from: a stray newline in an environment value would otherwise be header
    // injection, and building it from an integer makes that impossible.
    res.set(UPDATE_RECOMMENDED_HEADER, String(check.recommended))
  }

  next()
}
