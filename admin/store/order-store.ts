import { Order, OrderStatus } from "@/lib/types"
import {
  getCurrentOrders,
  getPastOrders,
  getPendingOrders,
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
  /**
   * Paid for, not yet accepted. Holds both halves of the Upcoming list: orders
   * the kitchen should not start yet, and orders that are due and waiting on
   * someone to accept them. The screen splits them on `dueAt`; keeping one list
   * means `findOrderById` stays whole and there is nothing to keep in sync.
   */
  pendingOrders: Order[]
  /**
   * Orders the alarm has already been raised for.
   *
   * Membership of `pendingOrders` cannot answer this any more: an order lands
   * there the moment it is paid for, long before the kitchen is told to start
   * it. Without this, the receipt would suppress its own alarm.
   */
  alertedOrderIds: Set<string>
  isLoading: boolean
  fetchOrders: () => Promise<void>
  fetchPendingOrders: () => Promise<Order[]>
  fetchCompletedOrders: (date?: Date) => Promise<void>
  /** Resolves true when the new status actually reached the server. */
  updateOrderStatus: (
    orderId: string,
    newStatus: OrderStatus,
  ) => Promise<boolean>
  findOrderById: (id: string) => Order | undefined
  setPendingOrders: (updater: Order[] | ((prev: Order[]) => Order[])) => void
  upsertPendingOrder: (order: Order) => void
  hasAlerted: (id: string) => boolean
  markAlerted: (id: string) => void
  clearAlerted: (id: string) => void
  reset: () => void
}

export const useOrderStore = create<OrderState>((set, get) => ({
  currentOrders: [],
  completedOrders: [],
  pendingOrders: [],
  alertedOrderIds: new Set<string>(),
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

  /**
   * Rebuilds the Upcoming list from the server.
   *
   * Called on launch and on reconnect. The socket alone cannot populate this:
   * it only carries orders placed while the app was running and connected, so
   * a force-quit or a dropped connection would otherwise leave staff blind to
   * everything already booked for today.
   *
   * Returns the orders so the caller can decide what to alarm on, rather than
   * this reaching into the alert queue itself.
   */
  fetchPendingOrders: async () => {
    try {
      const pendingOrders = await getPendingOrders()
      set({ pendingOrders })
      return pendingOrders
    } catch (error) {
      // Deliberately quiet: the socket still delivers new orders, and the
      // sweep still raises alarms, so a failure here degrades the Upcoming
      // list rather than the service. An alert box mid-service would be worse
      // than the gap.
      console.error("Failed to fetch pending orders:", error)
      return []
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
        return false
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

      return true
    } catch (error) {
      /**
       * The status never reached the server, so the order is still PENDING and
       * un-notified there and the sweep will re-emit it. Releasing the alerted
       * mark is what lets that sweep actually raise the alarm again — holding
       * it would leave the order sitting silently in the Upcoming list, never
       * alerted and never printed, until someone restarted the app.
       *
       * A three second toast is not a sufficient record of a lost order,
       * least of all with auto-accept clearing a modal every few seconds.
       */
      get().clearAlerted(orderId)

      console.error("Failed to update order status:", error)
      Toast.show({
        type: "error",
        text1: getErrorMessage(error),
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })

      return false
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

  /**
   * Adds an order, or replaces the copy already held.
   *
   * Replacing rather than ignoring matters: the server re-sends a receipt
   * whenever the website retries, and that copy may carry a corrected `dueAt`.
   * Keyed by id so a repeat is an update, never a second card.
   */
  upsertPendingOrder: (order) => {
    set((state) => {
      const index = state.pendingOrders.findIndex((o) => o.id === order.id)

      if (index === -1) {
        return { pendingOrders: [...state.pendingOrders, order] }
      }

      const pendingOrders = [...state.pendingOrders]
      pendingOrders[index] = { ...pendingOrders[index], ...order }
      return { pendingOrders }
    })
  },

  hasAlerted: (id) => get().alertedOrderIds.has(id),

  markAlerted: (id) => {
    set((state) => {
      if (state.alertedOrderIds.has(id)) return state
      // A new Set rather than a mutation, so subscribers actually re-render.
      return { alertedOrderIds: new Set(state.alertedOrderIds).add(id) }
    })
  },

  /**
   * Makes an order eligible to be alarmed again.
   *
   * Only for when an accept failed: the guard exists to stop the sweep
   * re-alerting an order staff already took, which is only true once the
   * server has actually recorded it.
   */
  clearAlerted: (id) => {
    set((state) => {
      if (!state.alertedOrderIds.has(id)) return state
      const next = new Set(state.alertedOrderIds)
      next.delete(id)
      return { alertedOrderIds: next }
    })
  },

  reset: () =>
    set({
      currentOrders: [],
      completedOrders: [],
      pendingOrders: [],
      // Cleared with the rest: after a sign-out the next session has to be able
      // to be alarmed about orders still waiting.
      alertedOrderIds: new Set<string>(),
      isLoading: true,
    }),
}))
