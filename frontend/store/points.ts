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
