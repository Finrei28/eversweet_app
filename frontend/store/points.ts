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
}

export const useLoyaltyStore = create<LoyaltyStore>()(
  persist(
    (set) => ({
      points: 0,
      fetchPoints: async () => {
        const token = await getToken()
        if (!token) return
        const points = await getUserLoyaltyPoints()
        set({ points })
      },
      setPoints: (points) => set({ points }),
      addPoints: (value) => set((state) => ({ points: state.points + value })),
    }),
    {
      name: "loyalty-points", // persist key
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
)
