import express from "express"
import cors from "cors"
import bodyParser from "body-parser"
import authRoutes from "./routes/auth.routes"
import clientRoutes from "./routes/client.routes"
import stripeRoutes from "./routes/stripe.routes"
import cartRoutes from "./routes/cart.routes"
import notificationRoutes from "./routes/notification.routes"
import adminRoutes from "./routes/admin.routes"
import { stripeWebhook } from "./controllers/stripe.controller"
import { getIo } from "./lib/socket"

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || []

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
  }, // maintains a whitelist of approved clients, which is vital for security and reliability
  methods: "GET,POST,PATCH,PUT",
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false, // do not allow cookies
}

/**
 * The HTTP surface on its own: routes, middleware, nothing that listens.
 *
 * Split out of `index.ts` so a test can mount the real middleware chain — the
 * auth check, the rate limiters, the idempotency guard — without opening a
 * port, connecting a socket server, or scheduling cron jobs. `index.ts` is
 * what turns this into a running server.
 */
export const app = express()

// Before express.json(): Stripe signs the raw bytes, and a parsed body can no
// longer be verified against that signature.
app.post(
  "/api/stripe/webhook",
  bodyParser.raw({ type: "application/json" }),
  stripeWebhook,
)

app.use(cors(corsOptions))
app.use(express.json())
app.set("trust proxy", 1) // Crucial for accurate IP tracking behind proxies

app.use((req, res, next) => {
  const io = getIo()
  if (io) req.io = io
  next()
})

app.use("/api/auth", authRoutes)
app.use("/api", clientRoutes)
app.use("/api/stripe", stripeRoutes)
app.use("/api/notification", notificationRoutes)
app.use("/api/admin", adminRoutes)
app.use("/api/cart", cartRoutes)

export default app
