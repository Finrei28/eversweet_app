"use client"

import { Order } from "@/lib/types"
import { getToken } from "@/services/auth"
import newOrderServices from "@/services/newOrders-service"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { io, type Socket } from "socket.io-client"
import { useAuth } from "./auth-provider"
import { useOrderContext } from "./order-provider"

type SocketContextType = {
  isConnected: boolean
  reconnect: () => void
}

const SocketContext = createContext<SocketContextType | undefined>(undefined)

export function SocketProvider({ children }: { children: ReactNode }) {
  const { authenticated } = useAuth()
  const { setPendingOrders } = useOrderContext()
  const socketRef = useRef<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  const setupSocket = useCallback(async () => {
    try {
      // Get auth token from storage
      const token = await getToken()

      if (!token) {
        console.error("No auth token found, skipping socket connection")
        return
      }
      // Create socket connection
      const socketInstance = io(process.env.EXPO_PUBLIC_SERVER_URL!, {
        transports: ["websocket"],
        auth: { token },
        reconnection: true,
        reconnectionDelay: 1000,
      })

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
        setPendingOrders((prev) =>
          prev.some((o) => o.id === order.id) ? prev : [...prev, order],
        )
        newOrderServices.enqueue({
          id: order.id,
          order: order,
          createdAt: new Date().toISOString(),
          status: "pending",
        })
      })

      socketRef.current = socketInstance

      return socketInstance
    } catch (error) {
      console.error("Error setting up socket:", error)
    }
  }, [])

  // Set up socket connection on mount
  useEffect(() => {
    let socketInstance: Socket | undefined

    const init = async () => {
      if (!authenticated) {
        socketRef.current?.disconnect()
        return
      }

      socketInstance = await setupSocket()
    }

    init()

    return () => {
      socketInstance?.disconnect()
    }
  }, [authenticated])

  // Reconnect function
  const reconnect = async () => {
    socketRef.current?.disconnect()
    socketRef.current = null

    await setupSocket()
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
