import dotenv from "dotenv"
dotenv.config()

import http from "http"
import { Server } from "socket.io"
import cron from "node-cron"
import app from "./app"
import { setIo, emitNewOrder } from "./lib/socket"
import { registerSocketHandlers } from "./lib/socketAuth"
import { clearScheduledOrders } from "./lib/orderRelay"
import {
  checkRestaurantStatus,
  getFutureOrders,
  renewWeeklyOffers,
  updateDailySpecial,
} from "./controllers/admin.controller"
import { settleMonthlyWinners } from "./controllers/client.controller"
import { probeDatabaseLatency } from "./lib/dbLatencyProbe"

const PORT = process.env.PORT || 3000
const server = http.createServer(app)

// Initialize Socket.IO with CORS configuration
export const io = new Server(server, {
  cors: {
    origin: "*", // In production, restrict this to your app's domain
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization"],
    credentials: true,
  },
})

// Hand it to the holder controllers read from, so nothing has to import this
// module — and start a server — just to emit an event.
setIo(io)

// Authentication and room membership live in `lib/socketAuth`, so the rule
// that keeps non-admins out of the kitchen room can be tested without this
// module, which opens a port and schedules cron jobs on import.
registerSocketHandlers(io)

// Re-exported so existing importers keep working.
export { emitNewOrder }

try {
  // A backstop now rather than the only path: website orders are announced as
  // they are paid for. Every two minutes is enough to catch what a restart
  // dropped, and the 6-21 minute preparation leads absorb the extra minute.
  cron.schedule("*/2 * * * *", getFutureOrders, {
    timezone: "Pacific/Auckland",
  })
  cron.schedule("* * * * *", checkRestaurantStatus, {
    timezone: "Pacific/Auckland",
  })
  cron.schedule("0 0 * * 1", renewWeeklyOffers, {
    timezone: "Pacific/Auckland",
  })
  cron.schedule("0 0 * * *", updateDailySpecial, {
    timezone: "Pacific/Auckland",
  })
  // Wrapped rather than passed by reference: node-cron hands the task a
  // TaskContext, which would arrive as settleMonthlyWinners' `offset` and settle
  // some arbitrary month instead of the one that just ended.
  cron.schedule("0 0 1 * *", () => settleMonthlyWinners(), {
    timezone: "Pacific/Auckland",
  })
} catch (err) {
  console.error("Failed to schedule task:", err)
}

// Orders waiting on an in-memory timer are lost on shutdown either way; the
// cron re-announces them when the process comes back. Clearing them stops a
// draining worker from holding handles that can never usefully fire.
const shutdown = () => {
  clearScheduledOrders()
  server.close(() => process.exit(0))
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

server.listen(PORT, () => {
  console.log(`Server + Socket.IO running on ${PORT}`)

  // Opt-in, and only ever a handful of `SELECT 1`s. See dbLatencyProbe.
  if (process.env.SQL_TIMING === "1") {
    void probeDatabaseLatency()
  }
})
