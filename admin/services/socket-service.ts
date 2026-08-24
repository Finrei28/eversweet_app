import { Order } from "@/lib/types"
import { useOrderStore } from "@/store/order-store"
import { useSocketStore } from "@/store/socket-store"
import { io, type Socket } from "socket.io-client"
import { getToken } from "./auth"
import newOrderServices from "./newOrders-service"

class SocketManager {
  private socket: Socket | null = null
  private connectingPromise: Promise<void> | null = null

  connect(): Promise<void> {
    if (this.socket || this.connectingPromise) {
      return this.connectingPromise ?? Promise.resolve()
    }

    this.connectingPromise = this.setupSocket().finally(() => {
      this.connectingPromise = null
    })

    return this.connectingPromise
  }

  private async setupSocket() {
    try {
      const token = await getToken()

      if (!token) {
        console.error("No auth token found, skipping socket connection")
        return
      }

      const socket = io(process.env.EXPO_PUBLIC_SERVER_URL!, {
        transports: ["websocket"],
        auth: { token },
        reconnection: true,
        reconnectionDelay: 1000,
      })

      socket.on("connect", () => {
        useSocketStore.getState().setConnected(true)
      })

      socket.on("disconnect", () => {
        useSocketStore.getState().setConnected(false)
      })

      socket.on("connect_error", (error) => {
        console.error("Socket connection error:", error)
        useSocketStore.getState().setConnected(false)
      })

      socket.on("new-order", (order: Order) => {
        useOrderStore
          .getState()
          .setPendingOrders((prev) =>
            prev.some((o) => o.id === order.id) ? prev : [...prev, order],
          )
        newOrderServices.enqueue({
          id: order.id,
          order,
          createdAt: new Date().toISOString(),
          status: "pending",
        })
      })

      this.socket = socket
    } catch (error) {
      console.error("Error setting up socket:", error)
    }
  }

  disconnect() {
    this.socket?.disconnect()
    this.socket = null
    useSocketStore.getState().setConnected(false)
  }

  async reconnect() {
    this.disconnect()
    await this.connect()
  }
}

const socketService = new SocketManager()
export default socketService
