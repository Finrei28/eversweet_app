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
 * Whether the balance held on this device covers a redemption.
 *
 * The app knows what the customer has, so it can decide before asking. That is
 * what lets a reward go into the cart immediately instead of waiting out the
 * round trip. The server still decides in the end - this can be stale if points
 * were spent on another device - so the add rolls back if it turns out to be
 * wrong. Reading the balance rather than subscribing to it, because this is
 * asked at the moment of a tap, not during a render.
 */
export const canAffordRedemption = (cost: number) =>
  useLoyaltyStore.getState().points >= cost

export const useLoyaltyStore = create<LoyaltyStore>()(
  persist(
    (set) => ({
      points: 0,
      fetchPoints: async () => {
        try {
          const token = await getToken()
          if (!token) return
          const points = await getUserLoyaltyPoints()
          set({ points })
        } catch (error) {
          // Most call sites fire this without awaiting it, so an escaping
          // rejection shows up as an unhandled promise rejection rather than a
          // stale points count.
          console.error("Failed to fetch loyalty points", error)
        }
      },
      setPoints: (points) => set({ points }),
      addPoints: (value) => set((state) => ({ points: state.points + value })),
      reset: () => set({ points: 0 }),
    }),
    {
      name: "loyalty-points", // persist key
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
