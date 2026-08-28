import { getErrorMessage } from "@/utils/getError"
import { getToken } from "./authToken"

export const API_URL = process.env.EXPO_PUBLIC_URL!

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
}

/**
 * Issues the request and hands back both the response and its parsed body,
 * without deciding what a failure means. Callers whose error handling is more
 * than a message per status code (sign-in, order creation) build on this;
 * everything else should use `apiRequest`.
 */
export async function apiFetch(
  path: string,
  { method = "GET", body, authMessage }: ApiRequestOptions = {},
): Promise<{ res: Response; data: any }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  }

  if (authMessage !== undefined) {
    const token = await getToken()
    if (!token) throw new Error(authMessage)
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

  // Failed responses are not reliably JSON — gateways and proxies return HTML,
  // and some endpoints return an empty body. Parsing must never be the thing
  // that surfaces to the caller.
  const data = await res.json().catch(() => null)

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
    const message =
      statusMessages?.[res.status] ??
      errorMessage ??
      getErrorMessage(data, fallback ?? `Request failed with status ${res.status}`)

    console.error(`${options.method ?? "GET"} ${path} failed:`, message)
    throw new Error(message)
  }

  return data as T
}
