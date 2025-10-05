"use client"

import { Order, OrderStatus } from "@/lib/types"
import {
  getCurrentOrders,
  getPastOrders,
  getPendingOrders,
  updateOrderStatusAPI,
} from "@/services/api"
import thermalPrinter from "@/services/thermal-printer"
import AsyncStorage from "@react-native-async-storage/async-storage"
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
  orderAlertQueue: string[]
  currentAlertId: string | null
  fetchOrders: () => Promise<void>
  fetchCompletedOrders: (date?: Date) => Promise<void>
  updateOrderStatus: (orderId: string, newStatus: OrderStatus) => Promise<void>
  findOrderById: (id: string) => Order | undefined
  findPendingOrdersById: (id: string) => Order | undefined
  setOrderAlertQueue: Dispatch<SetStateAction<string[]>>
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
  const [isPrinting, setIsPrinting] = useState(false)

  // Add these new state variables after the existing state declarations
  const [orderAlertQueue, setOrderAlertQueue] = useState<string[]>([])
  const [currentAlertId, setCurrentAlertId] = useState<string | null>(null)

  // Fetch orders on mount
  useEffect(() => {
    fetchOrders()
  }, [])

  useEffect(() => {
    if (orderAlertQueue.length > 0 && currentAlertId === null) {
      processNextOrderAlert()
    }
  }, [orderAlertQueue, currentAlertId])

  // Fetch current orders
  const fetchOrders = async () => {
    setIsLoading(true)
    try {
      const pendingOrders = await getPendingOrders()
      const currentOrders = await getCurrentOrders()
      setPendingOrders(pendingOrders)
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

  const handlePrintReceipt = async (order: Order) => {
    setIsPrinting(true)
    try {
      const autoPrintEnabled = await AsyncStorage.getItem("auto_print_enabled")
      if (autoPrintEnabled === "true") {
        const defaultPrinter = await thermalPrinter.getDefaultPrinter()
        if (defaultPrinter) {
          const connected = await thermalPrinter.connectToPrinter(
            defaultPrinter.id
          )
          if (connected) {
            const printResult = await thermalPrinter.printReceipt(order)
            if (!printResult.success) {
              console.warn("Auto-print failed:", printResult.message)
            }
          } else {
            console.warn("Failed to connect to default printer for auto-print")
          }
        } else {
          console.warn("No default printer set for auto-print")
        }
      }
    } catch (error) {
      console.error("Error in auto-print:", error)
    } finally {
      setIsPrinting(false)
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

  const processNextOrderAlert = () => {
    if (orderAlertQueue.length > 0) {
      const nextOrderId = orderAlertQueue[0]
      setCurrentAlertId(nextOrderId)

      // Remove this order from the queue
      setOrderAlertQueue((prev) => prev.slice(1))

      // Show the alert for this order
      router.push({
        pathname: "/new-order-alert/[id]",
        params: { id: nextOrderId },
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
        // Delete from pending
        setPendingOrders((prev) => prev.filter((order) => order.id !== orderId))
        setCurrentAlertId(null)

        // Find the order
        const newOrder = pendingOrders.find((order) => order.id === orderId)

        if (newOrder) {
          // Update the order status
          const updatedOrder = { ...newOrder, status: newStatus as OrderStatus }
          setCurrentOrders((prev) => [...prev, updatedOrder])
        } else if (existingOrder) {
          const updatedOrder = {
            ...existingOrder,
            status: newStatus as OrderStatus,
          }
          setCurrentOrders((prev) =>
            prev.map((o) => (o.id === orderId ? updatedOrder : o))
          )
        }
        await handlePrintReceipt(existingOrder)

        // } else if (newStatus === "DECLINED") {
        //   // Remove from pending
        //   setPendingOrders((prev) => prev.filter((order) => order.id !== orderId))
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
      if (orderId === currentAlertId) {
        // If we just processed the current alert, move to the next one
        setTimeout(() => {
          processNextOrderAlert()
        }, 500) // Small delay to allow animations to complete
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
        orderAlertQueue,
        currentAlertId,
        fetchOrders,
        fetchCompletedOrders,
        updateOrderStatus,
        findOrderById,
        findPendingOrdersById,
        setOrderAlertQueue,
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
