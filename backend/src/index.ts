import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import authRoutes from "./routes/auth.routes"
import clientRoutes from "./routes/client.routes"
import stripeRoutes from "./routes/stripe.routes"
import cartRoutes from "./routes/cart.routes"
import notificationRoutes from "./routes/notification.routes"
import adminRoutes from "./routes/admin.routes"
import { Server, Socket } from "socket.io"
import http from "http"
import cron from "node-cron"
import {
  checkRestaurantStatus,
  getFutureOrders,
  renewMochiOffer,
  updateDailySpecial,
} from "./controllers/admin.controller"
import jwt from "jsonwebtoken"
import bodyParser from "body-parser"
import { stripeWebhook } from "./controllers/stripe.controller"

// Extend Socket type to include userId
declare module "socket.io" {
  interface Socket {
    userId?: string
  }
}

dotenv.config()
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || []

const app = express()
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

// Authentication middleware for socket connections
io.use((socket, next) => {
  const token = socket.handshake.auth.token
  if (!token) {
    return next(new Error("Authentication error"))
  }

  // In a real app, verify the token here
  // For example: verifyJWT(token)

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
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.userId}`)

  // Join admin room if user is admin
  if (socket.userId === "admin") {
    socket.join("admin-room")
  }

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.userId}`)
  })
})

// Function to emit new order event
//@ts-ignore
export const emitNewOrder = (order) => {
  io.to("admin-room").emit("new-order", order)
}

interface CorsOptions {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => void
  methods: string
  credentials: boolean
  allowedHeaders: string[]
}

const corsOptions: CorsOptions = {
  origin: function (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ): void {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true) // Allow
    } else {
      callback(new Error(`Not allowed by CORS ${origin}`)) // Block
    }
  }, // Change this to your frontend URL
  methods: "GET,POST,PATCH,PUT",
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false, // do not allow cookies
}

app.post(
  "/api/stripe/webhook",
  bodyParser.raw({ type: "application/json" }),
  stripeWebhook,
)

app.use(cors(corsOptions))
app.use(express.json())

app.use((req, res, next) => {
  req.io = io
  next()
})

app.use("/api/auth", authRoutes)
app.use("/api", clientRoutes)
app.use("/api/stripe", stripeRoutes)
app.use("/api/notification", notificationRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/cart", cartRoutes)

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

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id)
})

server.listen(PORT, () => {
  console.log(`Server + Socket.IO running on ${PORT}`)
})
function calculateMonthlyWinner() {
  throw new Error("Function not implemented.")
}
