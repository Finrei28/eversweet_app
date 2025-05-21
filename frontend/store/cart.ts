import { create } from "zustand"
import { persist, StorageValue } from "zustand/middleware"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Customisations, Dessert } from "@/utils/types"
import { getUserIdFromToken } from "@/services/authToken"
import { isEqual } from "lodash"
import { orderWithLoyaltyPoints, restoreLoyaltyPoints } from "@/services/api"
import Toast from "react-native-toast-message"
import { useLoyaltyStore } from "./points"

export type CartItem = {
  id: string
  customisations: Customisations
  dessert: Dessert
  itemPriceInCents: number
  quantity: number
  loyaltyPointsUsed: number | null
}

interface CartState {
  items: CartItem[]
  lastUpdated: number | null
  error: string | null
  addItem: (item: CartItem) => void
  editItem: (item: CartItem) => void
  removeItem: (id: string) => void
  clearCart: () => void
  incrementItem: (id: string) => void
  decrementItem: (id: string) => void
  setError: (error: string | null) => void
  getTotalItems: () => number
  getTotalCost: () => number
}

const twelveHours = 12 * 60 * 60 * 1000

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      lastUpdated: null,
      error: null,
      addItem: async (item) => {
        if (item?.loyaltyPointsUsed) {
          try {
            // Example: restore points via backend API
            await orderWithLoyaltyPoints(item.loyaltyPointsUsed)
            Toast.show({
              type: "success",
              text1: `${item.dessert.name} added to cart`,
              text2: `${item.loyaltyPointsUsed} points has been used`,
              position: "bottom",
              visibilityTime: 2000,
              autoHide: true,
              bottomOffset: 60,
            })
            const fetchPoints = useLoyaltyStore.getState().fetchPoints
            fetchPoints()
          } catch (error) {
            console.error("Failed to order with loyalty points", error)
            Toast.show({
              type: "error",
              text1: "Failed to order with loyalty points",
              text2: `${error.message}`,
              position: "bottom",
              visibilityTime: 3000,
              autoHide: true,
              bottomOffset: 60,
            })
            return
          }
        }
        const now = Date.now()

        const areListsEqual = (
          list1: Customisations,
          list2: Customisations
        ) => {
          if (list1.length !== list2.length) return false

          const sortedList1 = [...list1].sort((a, b) =>
            a.id.localeCompare(b.id)
          )
          const sortedList2 = [...list2].sort((a, b) =>
            a.id.localeCompare(b.id)
          )

          return sortedList1.every((item, index) =>
            isEqual(item, sortedList2[index])
          )
        }

        const existing = get().items.find(
          (i) =>
            i.dessert.id === item.dessert.id &&
            i.loyaltyPointsUsed === item.loyaltyPointsUsed &&
            areListsEqual(i.customisations, item.customisations)
        )

        if (existing) {
          set({
            items: get().items.map((i) =>
              i === existing ? { ...i, quantity: i.quantity + 1 } : i
            ),
            lastUpdated: now,
          })
        } else {
          set({
            items: [...get().items, { ...item }],
            lastUpdated: now,
          })
        }
      },
      editItem: (item) => {
        const now = Date.now()
        const existing = get().items.find((i) => i.id === item.id)

        if (!existing) return
        set({
          items: get().items.map((i) =>
            i.id === item.id ? { ...i, ...item } : i
          ),
          lastUpdated: now,
        })
      },
      removeItem: async (id) => {
        const item = get().items.find((i) => i.id === id)
        const userId = await getUserIdFromToken()
        // if (!userId) {
        //   set({ error: "User not authenticated" })
        //   return
        // }

        if (item?.loyaltyPointsUsed) {
          try {
            // Example: restore points via backend API
            await restoreLoyaltyPoints(item.loyaltyPointsUsed)
            Toast.show({
              type: "success",
              text1: `${item.loyaltyPointsUsed} points refunded`,
              position: "bottom",
              visibilityTime: 3000,
              autoHide: true,
              bottomOffset: 60,
            })
            const fetchPoints = useLoyaltyStore.getState().fetchPoints
            fetchPoints()
          } catch (error) {
            console.error("Failed to restore points", error)
            Toast.show({
              type: "error",
              text1: "Failed to restore loyalty points",
              text2: "Please contact eversweet@eversweet.co.nz",
              position: "bottom",
              visibilityTime: 4000,
              autoHide: true,
              bottomOffset: 60,
            })
            return
          }
        }

        set({
          items: get().items.filter((i) => i.id !== id),
          lastUpdated: Date.now(),
          error: null, // Clear error on successful removal
        })
      },
      clearCart: async () => {
        const totalLoyaltyPointsUsed = get().items.reduce((total, item) => {
          return item.loyaltyPointsUsed ? total + item.loyaltyPointsUsed : total
        }, 0)

        if (totalLoyaltyPointsUsed > 0) {
          try {
            await restoreLoyaltyPoints(totalLoyaltyPointsUsed)
            const fetchPoints = useLoyaltyStore.getState().fetchPoints
            fetchPoints()
          } catch (error) {
            console.error("Failed to restore loyalty points", error)
          }
        }

        set({ items: [], lastUpdated: null, error: null })

        Toast.show({
          type: "success",
          text1: `Cart has been cleared`,
          position: "bottom",
          visibilityTime: 3000,
          autoHide: true,
          bottomOffset: 60,
        })
      },
      incrementItem: (id) =>
        set({
          items: get().items.map((i) =>
            i.id === id ? { ...i, quantity: i.quantity + 1 } : i
          ),
          lastUpdated: Date.now(),
          error: null,
        }),
      decrementItem: (id) =>
        set({
          items: get()
            .items.map((i) =>
              i.id === id && i.quantity > 1
                ? { ...i, quantity: i.quantity - 1 }
                : i
            )
            .filter((i) => i.quantity > 0),
          lastUpdated: Date.now(),
          error: null,
        }),
      setError: (error) => set({ error }), // Action to set error
      getTotalItems: () =>
        get().items.reduce((acc, item) => acc + item.quantity, 0),
      getTotalCost: () =>
        get().items.reduce(
          (acc, item) => acc + item.quantity * item.itemPriceInCents,
          0
        ),
    }),
    {
      name: "cart-storage", // storage key
      storage: {
        getItem: async (
          key: string
        ): Promise<StorageValue<CartState> | null> => {
          const value = await AsyncStorage.getItem(key)
          if (!value) return null

          const parsed = JSON.parse(value)
          const now = Date.now()
          // If it's been more than 24 hours, clear cart
          if (
            parsed.state?.lastUpdated &&
            now - parsed.state.lastUpdated > twelveHours
          ) {
            const userId = await getUserIdFromToken()
            if (userId) {
              // Calculate the total loyalty points used
              const totalLoyaltyPointsUsed = parsed.state.items.reduce(
                (total, item) => {
                  return item.loyaltyPointsUsed
                    ? total + item.loyaltyPointsUsed
                    : total
                },
                0
              )

              if (totalLoyaltyPointsUsed > 0) {
                // Call the API to restore the total loyalty points
                await restoreLoyaltyPoints(totalLoyaltyPointsUsed)
                const fetchPoints = useLoyaltyStore.getState().fetchPoints
                fetchPoints()
              }
            }
            await AsyncStorage.removeItem(key)
            return null
          }
          return parsed
        },
        setItem: async (key: string, value: StorageValue<CartState>) => {
          await AsyncStorage.setItem(key, JSON.stringify(value))
        },
        removeItem: async (key: string) => {
          await AsyncStorage.removeItem(key)
        },
      },
    }
  )
)
