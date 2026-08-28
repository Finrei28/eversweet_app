import { Order, OrderStatus } from "@/lib/types"
import {
  getCurrentOrders,
  getPastOrders,
  updateOrderStatusAPI,
} from "@/services/api"
import printerService, { addJob } from "@/services/printer-service"
import { getErrorMessage } from "@/utilities/getError"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { Alert } from "react-native"
import Toast from "react-native-toast-message"
import { create } from "zustand"

type OrderState = {
  currentOrders: Order[]
  completedOrders: Order[]
  pendingOrders: Order[]
  isLoading: boolean
  fetchOrders: () => Promise<void>
  fetchCompletedOrders: (date?: Date) => Promise<void>
  updateOrderStatus: (orderId: string, newStatus: OrderStatus) => Promise<void>
  findOrderById: (id: string) => Order | undefined
  setPendingOrders: (updater: Order[] | ((prev: Order[]) => Order[])) => void
  reset: () => void
}

export const useOrderStore = create<OrderState>((set, get) => ({
  currentOrders: [],
  completedOrders: [],
  pendingOrders: [],
  isLoading: true,

  fetchOrders: async () => {
    set({ isLoading: true })
    try {
      const currentOrders = await getCurrentOrders()
      set({ currentOrders })
    } catch (error) {
      Alert.alert("Error", getErrorMessage(error, "Failed to fetch orders"))
      console.error("Failed to fetch orders:", error)
    } finally {
      set({ isLoading: false })
    }
  },

  fetchCompletedOrders: async (date) => {
    const queryDate = date ?? new Date()
    set({ isLoading: true })
    try {
      const completedOrders = await getPastOrders(queryDate)
      set({ completedOrders })
    } catch (error) {
      Alert.alert(
        "Error",
        getErrorMessage(error, "Failed to fetch completed orders"),
      )
      console.error("Failed to fetch completed orders:", error)
    } finally {
      set({ isLoading: false })
    }
  },

  findOrderById: (id) => {
    const { pendingOrders, currentOrders, completedOrders } = get()
    return (
      pendingOrders.find((order) => order.id === id) ||
      currentOrders.find((order) => order.id === id) ||
      completedOrders.find((order) => order.id === id)
    )
  },

  updateOrderStatus: async (orderId, newStatus) => {
    try {
      const existingOrder = get().findOrderById(orderId)

      if (!existingOrder) {
        return
      }

      await updateOrderStatusAPI(orderId, newStatus, existingOrder.appUserId)

      if (newStatus === "ACCEPTED") {
        set((state) => ({
          pendingOrders: state.pendingOrders.filter((o) => o.id !== orderId),
        }))

        const autoPrintSetting =
          await AsyncStorage.getItem("auto_print_enabled")

        if (autoPrintSetting === "true") {
          await addJob(existingOrder)
          printerService.enqueue({
            id: existingOrder.id,
            order: existingOrder,
            createdAt: new Date().toISOString(),
            status: "pending",
          })
        }

        set((state) => {
          const exists = state.currentOrders.some(
            (o) => o.id === existingOrder.id,
          )

          return {
            currentOrders: exists
              ? state.currentOrders.map((order) =>
                  order.id === existingOrder.id
                    ? { ...order, status: "ACCEPTED" as OrderStatus }
                    : order,
                )
              : [
                  ...state.currentOrders,
                  { ...existingOrder, status: "ACCEPTED" as OrderStatus },
                ],
          }
        }) // if duplicate -> update status, if new -> add to current orders
      } else if (newStatus === "PICKED_UP") {
        const order = get().currentOrders.find((o) => o.id === orderId)

        if (order) {
          const updatedOrder = { ...order, status: newStatus }

          set((state) => ({
            currentOrders: state.currentOrders.filter((o) => o.id !== orderId),
            completedOrders: [updatedOrder, ...state.completedOrders],
          }))
        }
      } else {
        set((state) => ({
          currentOrders: state.currentOrders.map((order) =>
            order.id === orderId ? { ...order, status: newStatus } : order,
          ),
        }))
      }
    } catch (error) {
      console.error("Failed to update order status:", error)
      Toast.show({
        type: "error",
        text1: getErrorMessage(error),
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })
    }
  },

  setPendingOrders: (updater) => {
    set((state) => ({
      pendingOrders:
        typeof updater === "function"
          ? (updater as (prev: Order[]) => Order[])(state.pendingOrders)
          : updater,
    }))
  },

  reset: () =>
    set({
      currentOrders: [],
      completedOrders: [],
      pendingOrders: [],
      isLoading: true,
    }),
}))
