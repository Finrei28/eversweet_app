// In your zustand store
import { getUserLoyaltyPoints } from "@/services/api"
import { getToken } from "@/services/authToken"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

type LoyaltyStore = {
  points: number
  fetchPoints: () => Promise<void>
  setPoints: (points: number) => void
  addPoints: (value: number) => void
  reset: () => void
}

/**
 * Bumped by every local change to the balance.
 *
 * A fetch takes a second or two to come back, and its answer describes the
 * balance as it was when the request left. If anything moved the balance in
 * the meantime, applying that answer puts the counter back to a number that is
 * no longer true - which is how redeeming twice quickly used to leave the
 * balance showing the value from between the two debits.
 */
let balanceRevision = 0

export const useLoyaltyStore = create<LoyaltyStore>()(
  persist(
    (set) => ({
      points: 0,
      fetchPoints: async () => {
        const startedAt = balanceRevision

        try {
          const token = await getToken()
          if (!token) return
          const points = await getUserLoyaltyPoints()

          // Superseded while this was in the air. The caller that moved the
          // balance did so on the server's behalf and will have its own fetch
          // behind it, so dropping this one loses nothing.
          if (balanceRevision !== startedAt) return

          set({ points })
        } catch (error) {
          // Most call sites fire this without awaiting it, so an escaping
          // rejection shows up as an unhandled promise rejection rather than a
          // stale points count.
          console.error("Failed to fetch loyalty points", error)
        }
      },
      setPoints: (points) => {
        balanceRevision += 1
        set({ points })
      },
      addPoints: (value) => {
        balanceRevision += 1
        set((state) => ({ points: state.points + value }))
      },
      reset: () => {
        // Signing out counts: without this, a fetch still in the air from the
        // previous session could put their balance back on screen.
        balanceRevision += 1
        set({ points: 0 })
      },
    }),
    {
      name: "loyalty-points", // persist key
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
