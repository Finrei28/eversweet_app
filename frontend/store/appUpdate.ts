import AsyncStorage from "@react-native-async-storage/async-storage"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

export type AppUpdateStatus = "ok" | "recommended" | "required"

type AppUpdateStore = {
  status: AppUpdateStatus
  /** The build the server is asking them to move to, for the nudge. */
  recommendedBuild: number | null
  /** The build a "Not now" was last said to. */
  dismissedBuild: number | null
  /**
   * Whether the dismissal has been read back from storage yet.
   *
   * Held here rather than read through `persist.hasHydrated()`, which cannot
   * answer this safely: it is only set on the success path, so a storage read
   * that fails leaves it false for the rest of the session, and a listener
   * registered after hydration finished is never called at all. The callback
   * that sets this runs on both outcomes.
   */
  hydrated: boolean
  noteRequired: () => void
  noteRecommended: (build: number) => void
  noteUpToDate: () => void
  dismiss: () => void
}

/**
 * Whether this build is still one the server supports.
 *
 * A store rather than a handler registered with `apiClient` — the way
 * `setUnauthorizedHandler` works — because this has to be readable from outside
 * React: `services/queryClient` reads it to decide whether a failure is worth
 * retrying, which is the same reason the cart and points live in zustand. It
 * also must not belong to a provider, whose unmount cleanup would null it, and
 * the root layout reads it while rendering rather than through a callback.
 *
 * Every response updates it, so the server's judgement is always the current
 * one — see `noteUpToDate`.
 */
export const useAppUpdateStore = create<AppUpdateStore>()(
  persist(
    (set, get) => ({
      status: "ok",
      recommendedBuild: null,
      dismissedBuild: null,
      hydrated: false,

      /**
       * Every one of these checks before it writes, and none of them is merely
       * tidiness: persist wraps setState so that *any* set writes the whole
       * partialized state back to AsyncStorage, whether or not it changed. With
       * noteUpToDate running on every API response, setting unconditionally
       * would put a write across the native bridge on every request the app
       * makes.
       */
      noteRequired: () => {
        if (get().status === "required") return
        set({ status: "required", recommendedBuild: null })
      },

      noteRecommended: (build) => {
        const { status, recommendedBuild } = get()
        if (status === "recommended" && recommendedBuild === build) return
        set({ status: "recommended", recommendedBuild: build })
      },

      /**
       * Also what lifts the update wall.
       *
       * Deliberately not one-way. Once the wall is up nothing in the app
       * fetches, so if this could never be undone a minimum raised by mistake
       * and put back a minute later would keep every open app blocked until it
       * was force-quit. The screen's "I've already updated" button is a request
       * whose success lands here.
       */
      noteUpToDate: () => {
        const { status, recommendedBuild } = get()
        if (status === "ok" && recommendedBuild === null) return
        set({ status: "ok", recommendedBuild: null })
      },

      dismiss: () => {
        const { recommendedBuild, dismissedBuild } = get()
        if (recommendedBuild === dismissedBuild) return
        set({ dismissedBuild: recommendedBuild })
      },
    }),
    {
      name: "app-update",
      storage: createJSONStorage(() => AsyncStorage),
      /**
       * Only the dismissal survives a restart. Remembering "required" would
       * block the app at cold start before the server had said anything —
       * including with no signal at all, where the right behaviour is to carry
       * on as normal.
       *
       * Kept against the build it was said to, so turning down one release does
       * not silence the next.
       */
      partialize: (state) => ({ dismissedBuild: state.dismissedBuild }),
      /**
       * Fires whether the read succeeded or failed — zustand calls this from
       * both the then and the catch — so blocked or corrupt storage costs the
       * customer a repeated nudge once, rather than silently withholding every
       * nudge from then on.
       *
       * The self-reference is safe: hydration resolves in a later microtask, by
       * which time create() has returned and this binding exists.
       */
      onRehydrateStorage: () => () => {
        useAppUpdateStore.setState({ hydrated: true })
      },
    },
  ),
)
