import dotenv from "dotenv"
dotenv.config()

import http from "http"
import { Server } from "socket.io"
import cron from "node-cron"
import app from "./app"
import { setIo, emitNewOrder } from "./lib/socket"
import { recheckAdminSockets, registerSocketHandlers } from "./lib/socketAuth"
import { clearScheduledOrders } from "./lib/orderRelay"
import {
  checkRestaurantStatus,
  getFutureOrders,
  renewWeeklyOffers,
  updateDailySpecial,
} from "./controllers/admin.controller"
import { settleMonthlyWinners } from "./controllers/client.controller"
import { probeDatabaseLatency } from "./lib/dbLatencyProbe"
import { sweepStrandedPayments } from "./lib/strandedPayments"
import { announceNewOffers } from "./lib/announceOffers"
import { expireInactivePoints, warnPointsExpiring } from "./lib/pointsExpiry"

const PORT = process.env.PORT || 3000
const server = http.createServer(app)

/**
 * Any origin, deliberately — this is not the open door the old "restrict this in
 * production" comment made it sound like.
 *
 * CORS protects credentials a browser attaches on its own: cookies. Nothing here uses
 * them. A socket authenticates with a bearer token passed in the handshake (see
 * lib/socketAuth), which a page on another origin has no way to read or borrow, so
 * limiting origins would stop no attack. What it could stop is the kitchen: React Native
 * sockets can send an Origin header, and a whitelist that missed it would silence the
 * order alarms. `credentials` is off because no cookie is ever involved — it was on,
 * which advertised a capability this server has no use for.
 */
export const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Authorization"],
    credentials: false,
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
  // A socket is checked once, at its handshake; this is what stops one staying in the
  // kitchen room after a demotion, a password reset or its token running out.
  cron.schedule("* * * * *", () => recheckAdminSockets(io), {
    timezone: "Pacific/Auckland",
  })
  // Holds whose order never came, and payments taken without one. Wrapped for the same
  // reason as settleMonthlyWinners below: node-cron's TaskContext would arrive as `now`.
  cron.schedule("*/5 * * * *", () => sweepStrandedPayments(), {
    timezone: "Pacific/Auckland",
  })
  cron.schedule("0 0 * * 1", renewWeeklyOffers, {
    timezone: "Pacific/Auckland",
  })
  // Offers that have become available and not been announced. A sweep rather than a hook on
  // the write, because an offer with a future startsAt goes live with nothing written - see
  // lib/announceOffers. Wrapped for the same reason as the two below: node-cron would hand
  // the task a TaskContext, which would arrive as `now` and decide liveness by it.
  cron.schedule("*/5 * * * *", () => announceNewOffers(), {
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
  // Points expiry - see lib/pointsExpiry. The sweep runs just after midnight, once the last
  // day of a deadline has ended; the warning mid-morning, because nobody should be woken by
  // a points reminder. Both wrapped: a TaskContext arriving as `now` would decide every
  // deadline by it.
  cron.schedule("5 0 * * *", () => expireInactivePoints(), {
    timezone: "Pacific/Auckland",
  })
  cron.schedule("0 10 * * *", () => warnPointsExpiring(), {
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
