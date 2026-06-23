"use client"

import { Order, OrderStatus } from "@/lib/types"
import {
  getCurrentOrders,
  getPastOrders,
  updateOrderStatusAPI,
} from "@/services/api"
import printerService, { addJob } from "@/services/printer-service"
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useRouter } from "expo-router"
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { Alert } from "react-native"
import Toast from "react-native-toast-message"

// Create the context
type OrderContextType = {
  currentOrders: Order[]
  completedOrders: Order[]
  isLoading: boolean
  fetchOrders: () => Promise<void>
  fetchCompletedOrders: (date?: Date) => Promise<void>
  updateOrderStatus: (orderId: string, newStatus: OrderStatus) => Promise<void>
  findOrderById: (id: string) => Order | undefined
  setPendingOrders: React.Dispatch<React.SetStateAction<Order[]>>
  // processNextOrderAlert: () => void
}

const OrderContext = createContext<OrderContextType | undefined>(undefined)

// Provider component
export function OrderProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [pendingOrders, setPendingOrders] = useState<Order[]>([])
  const [currentOrders, setCurrentOrders] = useState<Order[]>([])
  const [completedOrders, setCompletedOrders] = useState<Order[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Fetch current orders
  const fetchOrders = async () => {
    setIsLoading(true)
    try {
      const currentOrders = await getCurrentOrders()
      setCurrentOrders(currentOrders)
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Failed to fetch orders",
      )
      console.error("Failed to fetch orders:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch orders on mount
  useEffect(() => {
    fetchOrders()
  }, [])

  // Fetch completed orders
  const fetchCompletedOrders = async (date?: Date) => {
    const queryDate = date ?? new Date()
    setIsLoading(true)
    try {
      //fetch past orders
      const completedOrders = await getPastOrders(queryDate)
      setCompletedOrders(completedOrders)
    } catch (error) {
      Alert.alert(
        "Error",
        error instanceof Error
          ? error.message
          : "Failed to fetch completed orders",
      )
      console.error("Failed to fetch completed orders:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Find order by ID in any list
  const findOrderById = (id: string): Order | undefined => {
    return (
      pendingOrders.find((order) => order.id === id) ||
      currentOrders.find((order) => order.id === id) ||
      completedOrders.find((order) => order.id === id)
    )
  }

  // Update order status
  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      // update order status
      const existingOrder = findOrderById(orderId)

      if (!existingOrder) {
        return
      }

      await updateOrderStatusAPI(orderId, newStatus, existingOrder.appUserId)

      // For demo, update state directly
      if (newStatus === "ACCEPTED") {
        // remove from pending list
        setPendingOrders((prev) => prev.filter((o) => o.id !== orderId))
        // check if auto print
        const autoPrintSetting =
          await AsyncStorage.getItem("auto_print_enabled")

        if (autoPrintSetting === "true") {
          // store the order for printing

          await addJob(existingOrder)
          printerService.enqueue({
            id: existingOrder.id,
            order: existingOrder,
            createdAt: new Date().toISOString(),
            status: "pending",
          })
        }

        await fetchOrders()
        // } else if (newStatus === "DECLINED") {
      } else if (newStatus === "PICKED_UP") {
        // Move from current to completed
        const order = currentOrders.find((order) => order.id === orderId)

        if (order) {
          // Update the order status
          const updatedOrder = { ...order, status: newStatus as OrderStatus }

          // Remove from current orders
          setCurrentOrders((prev) => prev.filter((o) => o.id !== orderId))

          // Add to completed orders
          setCompletedOrders((prev) => [updatedOrder, ...prev])
        }
      } else {
        // Update status for current orders
        setCurrentOrders((prev) =>
          prev.map((order) =>
            order.id === orderId
              ? { ...order, status: newStatus as OrderStatus }
              : order,
          ),
        )
      }
    } catch (error) {
      console.error("Failed to update order status:", error)
      Toast.show({
        type: "error",
        text1: error instanceof Error ? error.message : "Something went wrong",
        position: "bottom",
        visibilityTime: 3000,
        autoHide: true,
        bottomOffset: 60,
      })
    }
  }

  return (
    <OrderContext.Provider
      value={{
        currentOrders,
        completedOrders,
        isLoading,
        fetchOrders,
        fetchCompletedOrders,
        updateOrderStatus,
        findOrderById,
        setPendingOrders,
      }}
    >
      {children}
    </OrderContext.Provider>
  )
}

// Hook for using the order context
export function useOrderContext() {
  const context = useContext(OrderContext)
  if (context === undefined) {
    throw new Error("useOrderContext must be used within an OrderProvider")
  }
  return context
}
