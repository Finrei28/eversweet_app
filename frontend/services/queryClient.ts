import { AppState, AppStateStatus } from "react-native"
import { QueryClient, focusManager } from "@tanstack/react-query"

/**
 * How long a result is served without a background refetch.
 *
 * The default suits data tied to one customer — orders, points, offers — where
 * a stale view is briefly wrong but self-corrects on the next focus.
 */
const USER_DATA_STALE_TIME = 30 * 1000

/**
 * Shop-wide data the kitchen edits occasionally: the menu, trading hours,
 * loyalty rates. Every customer sees the same values, and a few minutes of
 * staleness is not meaningful, so these are cached far longer.
 */
export const SHARED_DATA_STALE_TIME = 5 * 60 * 1000

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: USER_DATA_STALE_TIME,
      // Kept well past staleTime so returning to a screen paints from cache
      // and revalidates behind the content, rather than showing a spinner.
      gcTime: 30 * 60 * 1000,
      retry: 2,
      refetchOnReconnect: true,
    },
  },
})

/**
 * React Native has no window focus event, so react-query cannot detect it on
 * its own. Without this, refetch-on-focus silently never fires.
 */
export function subscribeAppStateFocus() {
  const onChange = (status: AppStateStatus) =>
    focusManager.setFocused(status === "active")

  const subscription = AppState.addEventListener("change", onChange)
  return () => subscription.remove()
}
