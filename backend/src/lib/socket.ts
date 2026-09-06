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

export const setIo = (server: Server) => {
  io = server
}

export const getIo = () => io

/**
 * No-ops when there is no socket server, which is the case in tests and in any
 * process that loads a controller without booting the app. Failing to notify
 * the kitchen screen must never be able to fail a paid order.
 */
export const emitNewOrder = (order: FullOrderType) => {
  io?.to("admin-room").emit("new-order", order)
}
