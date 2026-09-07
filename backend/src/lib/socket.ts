import { Server } from "socket.io"
import { FullOrderType } from "../types/types"

/**
 * The socket server, once `index.ts` has built it.
 *
 * Controllers used to import `io` and `emitNewOrder` straight from `index.ts`,
 * which meant importing a module that opens a port and schedules cron jobs as
 * a side effect of loading. Nothing could import a controller without starting
 * a server — tests included. Holding the instance here breaks that: `index.ts`
 * registers it at boot, and anything that only needs to emit takes it from
 * here.
 */
let io: Server | null = null

/** The room the kitchen screens sit in. Only ADMIN sockets are let into it. */
export const ADMIN_ROOM = "admin-room"

export const setIo = (server: Server) => {
  io = server
}

export const getIo = () => io

/**
 * Start making this order, now.
 *
 * The alarm: the app raises a modal and plays a sound. Fires when preparation
 * is due to begin, which for a scheduled order can be hours after it was paid
 * for — `emitOrderReceived` is what tells the shop it exists in the meantime.
 *
 * No-ops when there is no socket server, which is the case in tests and in any
 * process that loads a controller without booting the app. Failing to notify
 * the kitchen screen must never be able to fail a paid order.
 */
export const emitNewOrder = (order: FullOrderType) => {
  io?.to(ADMIN_ROOM).emit("new-order", order)
}

export type ReceivedOrder = FullOrderType & {
  /** When the kitchen should start on it. Null if the pick-up time is unusable. */
  dueAt: string | null
}

/**
 * An order the shop now knows about, but must not start yet.
 *
 * Silent — it populates the Upcoming list so staff can see what is coming
 * rather than being blind until the alarm. Sent for every order, however far
 * out, so the two events answer two different questions: this one says the
 * order exists, `emitNewOrder` says to start it.
 */
export const emitOrderReceived = (order: ReceivedOrder) => {
  io?.to(ADMIN_ROOM).emit("order-received", order)
}
