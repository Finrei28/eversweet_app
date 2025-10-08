"use client"

import { Order, OrderStatus } from "@/lib/types"
import {
  getCurrentOrders,
  getPastOrders,
  updateOrderStatusAPI,
} from "@/services/api"
import usePrintReceipt from "@/services/printer-service"
import { useRouter } from "expo-router"
import {
  createContext,
  Dispatch,
  SetStateAction,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { Alert } from "react-native"
import Toast from "react-native-toast-message"

// Create the context
type OrderContextType = {
  pendingOrders: Order[]
  currentOrders: Order[]
  completedOrders: Order[]
  isLoading: boolean
  currentAlertId: string | null
  fetchOrders: () => Promise<void>
  fetchCompletedOrders: (date?: Date) => Promise<void>
  updateOrderStatus: (orderId: string, newStatus: OrderStatus) => Promise<void>
  findOrderById: (id: string) => Order | undefined
  findPendingOrdersById: (id: string) => Order | undefined
  setPendingOrders: Dispatch<SetStateAction<Order[]>>
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
  const { handlePrintReceipt } = usePrintReceipt()

  // Add these new state variables after the existing state declarations
  const [currentAlertId, setCurrentAlertId] = useState<string | null>(null)

  // Fetch orders on mount
  useEffect(() => {
    fetchOrders()
  }, [])

  useEffect(() => {
    if (pendingOrders.length > 0 && currentAlertId === null) {
      processNextOrderAlert(pendingOrders[0].id)
    }
  }, [pendingOrders, currentAlertId])

  // Fetch current orders
  const fetchOrders = async () => {
    setIsLoading(true)
    try {
      const currentOrders = await getCurrentOrders()
      setCurrentOrders(currentOrders)
    } catch (error) {
      Alert.alert("Error", error.message)
      console.error("Failed to fetch orders:", error)
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch completed orders
  const fetchCompletedOrders = async (date?: Date) => {
    const queryDate = date ?? null
    setIsLoading(true)
    try {
      //fetch past orders
      const completedOrders = await getPastOrders(queryDate)
      setCompletedOrders(completedOrders)
    } catch (error) {
      Alert.alert("Error", error.message)
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

  const findPendingOrdersById = (id: string): Order | undefined => {
    return pendingOrders.find((order) => order.id === id)
  }

  const processNextOrderAlert = (orderId: string) => {
    if (pendingOrders.length > 0) {
      setCurrentAlertId(orderId)

      // Show the alert for this order
      router.push({
        pathname: "/new-order-alert/[id]",
        params: { id: orderId },
      })
    } else {
      setCurrentAlertId(null)
    }
  }

  // Update order status
  const updateOrderStatus = async (orderId: string, newStatus: OrderStatus) => {
    try {
      // update order status
      const existingOrder = findOrderById(orderId)

      await updateOrderStatusAPI(orderId, newStatus, existingOrder.appUserId)

      // For demo, update state directly
      if (newStatus === "ACCEPTED") {
        // Find the order
        const newOrder = pendingOrders.find((order) => order.id === orderId)
        // Delete from pending
        setPendingOrders((prev) => prev.filter((order) => order.id !== orderId))
        setCurrentAlertId(null)

        if (newOrder) {
          // Update the order status
          const updatedOrder = { ...newOrder, status: newStatus }
          setCurrentOrders((prev) => [...prev, updatedOrder])
        } else if (existingOrder) {
          const updatedOrder = {
            ...existingOrder,
            status: newStatus,
          }
          setCurrentOrders((prev) =>
            prev.map((o) => (o.id === orderId ? updatedOrder : o))
          )
        }
        await handlePrintReceipt(existingOrder)

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
              : order
          )
        )
      }
    } catch (error) {
      console.error("Failed to update order status:", error)
      Toast.show({
        type: "error",
        text1: `${error.message}`,
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
        pendingOrders,
        currentOrders,
        completedOrders,
        isLoading,
        currentAlertId,
        fetchOrders,
        fetchCompletedOrders,
        updateOrderStatus,
        findOrderById,
        findPendingOrdersById,
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
