import * as SecureStore from "expo-secure-store"

const TOKEN_KEY = "token"

/**
 * Every SecureStore read crosses the native bridge into the keychain, and
 * `apiClient` asks for the token on each authenticated request — around a dozen
 * of them before the app is even interactive, every one of them serialised
 * ahead of the request it belongs to.
 *
 * The stored value only changes through `saveToken` and `removeToken`, both of
 * which live here, so it is safe to hold in memory.
 *
 * `undefined` means "not read yet"; `null` means "read, and there is none".
 */
let cachedToken: string | null | undefined
let pendingRead: Promise<string | null> | null = null

export async function getToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken

  // Callers that arrive together during startup share one keychain read
  // instead of queueing a dozen identical ones.
  pendingRead ??= SecureStore.getItemAsync(TOKEN_KEY)
    .then((token) => {
      cachedToken = token
      return token
    })
    .catch((error) => {
      // Deliberately not cached: a failed read should be retried rather than
      // remembered as "signed out".
      console.error("Error fetching token from SecureStore:", error)
      return null
    })
    .finally(() => {
      pendingRead = null
    })

  return pendingRead
}

export async function saveToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token)
  cachedToken = token
}

export async function removeToken() {
  // Cleared first so a request racing the sign-out cannot pick up a token that
  // is on its way out.
  cachedToken = null

  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
  } catch (error) {
    console.error("Error removing token from SecureStore:", error)
    return null
  }
}
