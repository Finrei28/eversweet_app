"use client"

import { Order } from "@/lib/types"
import { setOrderNotified } from "@/services/api"
import { getToken } from "@/services/auth"
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { io, type Socket } from "socket.io-client"
import { useOrderContext } from "./order-provider"

type SocketContextType = {
  isConnected: boolean
  reconnect: () => void
}

const SocketContext = createContext<SocketContextType | undefined>(undefined)

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const { setOrderAlertQueue, setPendingOrders } = useOrderContext()

  const setupSocket = async () => {
    try {
      // Get auth token from storage
      const token = await getToken()

      if (!token) {
        console.error("No auth token found, skipping socket connection")
        return
      }
      // Create socket connection
      const socketInstance = io(
        process.env.EXPO_PUBLIC_SOCKET_URL || "http://localhost:3001",
        {
          transports: ["polling"],
          auth: { token },
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
        }
      )

      // Set up event listeners
      socketInstance.on("connect", () => {
        // console.log("Socket connected")
        setIsConnected(true)
      })

      socketInstance.on("disconnect", () => {
        // console.log("Socket disconnected")
        setIsConnected(false)
      })

      socketInstance.on("connect_error", (error) => {
        console.error("Socket connection error:", error)
        setIsConnected(false)
      })

      // Listen for new orders
      socketInstance.on("new-order", async (order: Order) => {
        // Add the order to the context
        // console.log("New order received:", order)
        setPendingOrders((prev) => [...prev, order])
        setTimeout(() => {
          setOrderAlertQueue((prev) => [...prev, order.id])
        }, 100)
        await setOrderNotified(order.id)
        // Play notification sound if enabled
      })

      setSocket(socketInstance)

      return socketInstance
    } catch (error) {
      console.error("Error setting up socket:", error)
    }
  }

  // Set up socket connection on mount
  useEffect(() => {
    const socketInstance = setupSocket()

    // Clean up on unmount
    return () => {
      if (socket) {
        socket.disconnect()
      }
    }
  }, [])

  // Reconnect function
  const reconnect = () => {
    if (socket) {
      socket.disconnect()
    }
    setupSocket()
  }

  return (
    <SocketContext.Provider value={{ isConnected, reconnect }}>
      {children}
    </SocketContext.Provider>
  )
}

// Hook for using the socket context
export function useSocket() {
  const context = useContext(SocketContext)
  if (context === undefined) {
    throw new Error("useSocket must be used within a SocketProvider")
  }
  return context
}
