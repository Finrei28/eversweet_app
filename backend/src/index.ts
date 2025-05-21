import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import authRoutes from "./routes/auth.routes"
import clientRoutes from "./routes/client.routes"
import stripeRoutes from "./routes/stripe.routes"
import notificationRoutes from "./routes/notification.routes"
import adminRoutes from "./routes/admin.routes"
import { Server } from "socket.io"
import http from "http"
import cron from "node-cron"
import { getFutureOrders } from "./controllers/admin.controller"

dotenv.config()
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || []

const app = express()
const PORT = process.env.PORT || 3000
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: "*", // or restrict to your frontend domain
    methods: ["GET", "POST"],
  },
})

interface CorsOptions {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ) => void
  methods: string
  credentials: boolean
  allowedHeaders: string[]
}

const corsOptions: CorsOptions = {
  origin: function (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void
  ): void {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true) // Allow
    } else {
      callback(new Error("Not allowed by CORS")) // Block
    }
  }, // Change this to your frontend URL
  methods: "GET,POST,PATCH,PUT",
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false, // do not allow cookies
}

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

cron.schedule("* * * * *", getFutureOrders)

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id)
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
