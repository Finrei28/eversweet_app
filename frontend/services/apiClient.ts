import { getErrorMessage } from "@/utils/getError"
import { APP_VERSION_HEADERS } from "@/lib/appVersion"
import { useAppUpdateStore } from "@/store/appUpdate"
import { getToken } from "./authToken"

export const API_URL = process.env.EXPO_PUBLIC_URL!

/**
 * Thrown when the server has retired this build.
 *
 * A class rather than a message so `services/queryClient` can recognise it and
 * stop retrying — a refusal is not going to come back any differently, and a
 * blocked launch would otherwise spend three attempts on each of a dozen
 * requests. Lives beside its thrower, as `DuplicateOrderError` does in
 * `stripe-api.ts`.
 */
export class AppUpdateRequiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AppUpdateRequiredError"
  }
}

/**
 * A request the server answered with a failure status, carrying that status.
 *
 * Every failure used to arrive as a plain Error holding only its message, so a caller could
 * not tell "that is already gone" from "the server broke". Removing a cart line the server had
 * already taken out - a members-only item the membership webhook removed, say - came back 404
 * and read as a failed removal: the line was put back on screen and an error shown. An Error
 * still, so everything that catches one is unchanged.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

const UPDATE_RECOMMENDED_HEADER = "X-App-Update-Recommended"

/**
 * Records what this response said about the build, on every response.
 *
 * Absence of the recommendation header means "up to date", not "no news" — it
 * is the only thing that ever lifts the wall once the server stops refusing.
 *
 * Nothing is written when a request never got a response: an abort or a network
 * error throws before this runs, so a launch with no signal behaves exactly as
 * it did before any of this existed. That is the right direction — an update
 * cannot be applied offline either.
 */
const noteUpdateState = (res: Response, data: any) => {
  const update = useAppUpdateStore.getState()

  if (res.status === 426 && data?.code === "APP_UPDATE_REQUIRED") {
    update.noteRequired()
    return
  }

  const recommended = Number(res.headers.get(UPDATE_RECOMMENDED_HEADER))

  if (Number.isSafeInteger(recommended) && recommended > 0) {
    update.noteRecommended(recommended)
    return
  }

  update.noteUpToDate()
}

/**
 * Without this a request that stalls rather than fails hangs until the OS
 * gives up — around a minute on iOS — and because loading state gates
 * full-screen spinners, the customer just watches a loader the whole time.
 */
const REQUEST_TIMEOUT_MS = 15000

/**
 * Called when the server refuses a token the app actually sent. AuthProvider
 * registers it so a session that expires mid-use is cleared, instead of leaving
 * the app looking signed in while every request is rejected. Only the expiry at
 * startup was checked before, so a token that lapsed while the app was open
 * produced "please sign in" errors on every action and no way to recover.
 */
let onUnauthorized: (() => void) | null = null

export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler
}

export type ApiRequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE"
  /** Serialised as JSON. Omit for requests that send nothing. */
  body?: unknown
  /**
   * Message to throw when no auth token is stored. Supplying it is what marks
   * an endpoint as authenticated — public endpoints leave it off.
   */
  authMessage?: string
  /** Fixed messages for particular statuses, e.g. `{ 404: "Not found" }`. */
  statusMessages?: Record<number, string>
  /** Used when the response body carries no usable message of its own. */
  fallback?: string
  /** Replaces the response body's message entirely for any failed request. */
  errorMessage?: string
  /**
   * Marks the request as safe to repeat. The server records the first
   * response under this key and replays it for any retry carrying the same
   * one, so a dropped connection can't turn one order into two.
   */
  idempotencyKey?: string
}

/**
 * Issues the request and hands back both the response and its parsed body,
 * without deciding what a failure means. Callers whose error handling is more
 * than a message per status code (sign-in, order creation) build on this;
 * everything else should use `apiRequest`.
 */
export async function apiFetch(
  path: string,
  { method = "GET", body, authMessage, idempotencyKey }: ApiRequestOptions = {},
): Promise<{ res: Response; data: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Every request carries them, because this is the only fetch in the app —
    // so the server can retire a build without the app having to ask whether it
    // has been retired.
    ...APP_VERSION_HEADERS,
  }

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey
  }

  if (authMessage !== undefined) {
    const token = await getToken()
    if (!token) throw new Error(authMessage)
    headers.Authorization = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      signal: controller.signal,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch (error) {
    // An abort is this timeout firing, not a caller cancelling — nothing else
    // holds the controller — so it is reported as what it is.
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "The request took too long. Please check your connection and try again.",
      )
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  // Failed responses are not reliably JSON — gateways and proxies return HTML,
  // and some endpoints return an empty body. Parsing must never be the thing
  // that surfaces to the caller.
  const data = await res.json().catch(() => null)

  // Here rather than in apiRequest, so the two callers that build on apiFetch
  // directly — sign-in and order creation — also keep the wall current.
  noteUpdateState(res, data)

  return { res, data }
}

/**
 * The shape almost every endpoint follows: attach the token if the endpoint
 * needs one, send JSON, turn a failed status into an Error carrying the most
 * specific message available, and return the parsed body.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { statusMessages, fallback, errorMessage } = options
  const { res, data } = await apiFetch(path, options)

  if (!res.ok) {
    // Above the logging below, which is what keeps a blocked launch from
    // putting a redbox on screen for every one of its dozen requests. The root
    // layout has already been told; this only has to stop the caller.
    if (res.status === 426 && data?.code === "APP_UPDATE_REQUIRED") {
      throw new AppUpdateRequiredError(
        getErrorMessage(data, "Please update the Eversweet app."),
      )
    }

    // Only for endpoints marked authenticated: apiFetch throws before sending
    // when one of those has no token at all, so a 401 reaching here means a
    // token was sent and rejected. A 401 from a public endpoint (a failed sign
    // in) says nothing about the stored session and must not clear it.
    if (res.status === 401 && options.authMessage !== undefined) {
      onUnauthorized?.()
    }

    const message =
      statusMessages?.[res.status] ??
      errorMessage ??
      getErrorMessage(data, fallback ?? `Request failed with status ${res.status}`)

    // Only in development, and not for statuses the caller named itself: a 404
    // from getUsersMembership just means "not a member", and getPushToken is
    // expected to fail on a fresh install. Logging those unconditionally put
    // several LogBox redboxes on the screen during a normal startup.
    if (__DEV__ && statusMessages?.[res.status] === undefined) {
      console.error(`${options.method ?? "GET"} ${path} failed:`, message)
    }
    throw new ApiError(message, res.status)
  }

  return data as T
}
