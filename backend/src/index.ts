import dotenv from "dotenv"
dotenv.config()

import http from "http"
import { Server, Socket } from "socket.io"
import cron from "node-cron"
import jwt from "jsonwebtoken"
import app from "./app"
import { setIo, emitNewOrder } from "./lib/socket"
import {
  checkRestaurantStatus,
  getFutureOrders,
  renewMochiOffer,
  updateDailySpecial,
} from "./controllers/admin.controller"
import { calculateMonthlyWinner } from "./controllers/client.controller"

// Extend Socket type to include userId
declare module "socket.io" {
  interface Socket {
    userId?: string
  }
}

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

// Authentication middleware for socket connections
io.use((socket, next) => {
  const token = socket.handshake.auth.token
  if (!token) {
    return next(new Error("Authentication error"))
  }

  jwt.verify(token, process.env.JWT_SECRET!, (err: jwt.VerifyErrors | null) => {
    if (err) {
      return next(new Error("Authentication error"))
    }
  })

  // Attach user info to the socket
  socket.userId = "admin" // This would come from the token verification
  next()
})

// Handle socket connections
io.on("connection", (socket: Socket) => {
  console.log(`User connected: ${socket.userId}`)

  // Join admin room if user is admin
  if (socket.userId === "admin") {
    socket.join("admin-room")
  }

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.userId}`)
  })
})

// Re-exported so existing importers keep working.
export { emitNewOrder }

try {
  cron.schedule("* * * * *", getFutureOrders, {
    timezone: "Pacific/Auckland",
  })
  cron.schedule("* * * * *", checkRestaurantStatus, {
    timezone: "Pacific/Auckland",
  })
  cron.schedule("0 0 * * 1", renewMochiOffer, {
    timezone: "Pacific/Auckland",
  })
  cron.schedule("0 0 * * *", updateDailySpecial, {
    timezone: "Pacific/Auckland",
  })
  cron.schedule("0 0 1 * *", calculateMonthlyWinner, {
    timezone: "Pacific/Auckland",
  })
} catch (err) {
  console.error("Failed to schedule task:", err)
}

server.listen(PORT, () => {
  console.log(`Server + Socket.IO running on ${PORT}`)
})
