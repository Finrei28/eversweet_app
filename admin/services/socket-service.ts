import { Order } from "@/lib/types"
import { useOrderStore } from "@/store/order-store"
import { useSocketStore } from "@/store/socket-store"
import { io, type Socket } from "socket.io-client"
import { getToken } from "./auth"
import newOrderServices from "./newOrders-service"

/**
 * One at a time. Launch and the socket's first `connect` both ask for a sync,
 * and two overlapping runs could each read an order as un-alerted before
 * either marked it — raising the same alarm twice.
 */
let syncInFlight: Promise<void> | null = null

/**
 * Rebuild the Upcoming list from the server, and raise the alarm for anything
 * already due that has not been alerted yet.
 *
 * The second half is what makes a restart safe. Without it, an order that came
 * due while the app was closed would sit silently in the list until the
 * server's sweep came round again.
 */
export const syncPendingOrders = (): Promise<void> => {
  if (syncInFlight) return syncInFlight

  syncInFlight = (async () => {
    const store = useOrderStore.getState()
    const orders = await store.fetchPendingOrders()
    const now = Date.now()

    for (const order of orders) {
      // No due time means the server could not work one out. Leave it on the
      // list to be seen rather than alarming at an unknown moment.
      if (!order.dueAt) continue

      const due = new Date(order.dueAt).getTime()
      if (Number.isNaN(due) || due > now) continue

      if (store.hasAlerted(order.id)) continue

      store.markAlerted(order.id)
      newOrderServices.enqueue({
        id: order.id,
        order,
        createdAt: new Date().toISOString(),
        status: "pending",
      })
    }
  })().finally(() => {
    syncInFlight = null
  })

  return syncInFlight
}

/** Already dealt with — it belongs on another screen, not the Upcoming list. */
const alreadyHandled = (id: string) => {
  const { currentOrders, completedOrders } = useOrderStore.getState()
  return (
    currentOrders.some((o) => o.id === id) ||
    completedOrders.some((o) => o.id === id)
  )
}

/**
 * "This order exists."
 *
 * Silent by design: it fills the Upcoming list so staff can see what is booked,
 * and says nothing about when to start. Exported so the split between this and
 * the alarm can be tested without standing up a socket.
 */
export const handleOrderReceived = (order: Order) => {
  if (alreadyHandled(order.id)) return

  useOrderStore.getState().upsertPendingOrder(order)
}

/** "Start making this." The alarm: modal and sound. */
export const handleNewOrder = (order: Order) => {
  const store = useOrderStore.getState()

  // An order reaches here more than once. `notified` is only set when staff
  // accept it, so the server's sweep re-emits an untouched order every couple
  // of minutes, and `newOrderServices` only de-dupes against jobs still in its
  // queue — a repeat landing while the modal is open is queued behind it and
  // alerted again for an order that was just accepted.
  //
  // Being in `pendingOrders` is deliberately *not* the test. A receipt puts an
  // order there the moment it is paid for, which for a scheduled order is
  // hours before the kitchen should start it; checking the list here would
  // suppress every alarm the feature exists to raise.
  if (store.hasAlerted(order.id)) return

  // Accepted on another device, or on this one before a reconnect.
  if (alreadyHandled(order.id)) return

  store.upsertPendingOrder(order)
  store.markAlerted(order.id)

  newOrderServices.enqueue({
    id: order.id,
    order,
    createdAt: new Date().toISOString(),
    status: "pending",
  })
}

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

        // Also runs on every reconnect, which is the point: receipts sent while
        // the connection was down were missed, and only a fetch can recover
        // them.
        void syncPendingOrders()
      })

      socket.on("disconnect", () => {
        useSocketStore.getState().setConnected(false)
      })

      socket.on("connect_error", (error) => {
        console.error("Socket connection error:", error)
        useSocketStore.getState().setConnected(false)
      })

      socket.on("order-received", handleOrderReceived)
      socket.on("new-order", handleNewOrder)

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
