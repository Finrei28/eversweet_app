import * as Application from "expo-application"
import { Platform } from "react-native"

/**
 * What this build tells the server about itself.
 *
 * The build number, not `expo.version`: EAS owns it (`appVersionSource:
 * "remote"` with `autoIncrement`) and moves it on every production build, while
 * `expo.version` only changes when somebody remembers. A threshold the server
 * compares against has to be a number nobody can forget to bump.
 *
 * Both are synchronous native constants — the binary cannot change while it is
 * running — so they are read once here rather than awaited per request.
 *
 * `nativeBuildVersion` describes the installed binary, which is the thing the
 * store can replace. That stays true if over-the-air updates are ever added,
 * where a JS bundle could otherwise report a version the binary does not have.
 */
export const APP_BUILD = Application.nativeBuildVersion

export const APP_PLATFORM = Platform.OS

/**
 * Sent on every request, or not at all.
 *
 * Null on web, where there is no store to be sent to. The server reads a
 * missing header as "not the customer app" and waves the request through, so
 * both sides fail in the same direction.
 */
export const APP_VERSION_HEADERS: Record<string, string> =
  APP_BUILD && (APP_PLATFORM === "ios" || APP_PLATFORM === "android")
    ? { "X-App-Build": APP_BUILD, "X-App-Platform": APP_PLATFORM }
    : {}
