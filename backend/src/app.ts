import express, { NextFunction, Request, Response } from "express"
import cors from "cors"
import bodyParser from "body-parser"
import authRoutes from "./routes/auth.routes"
import clientRoutes from "./routes/client.routes"
import stripeRoutes from "./routes/stripe.routes"
import cartRoutes from "./routes/cart.routes"
import notificationRoutes from "./routes/notification.routes"
import adminRoutes from "./routes/admin.routes"
import internalRoutes from "./routes/internal.routes"
import { stripeWebhook } from "./controllers/stripe.controller"
import { getIo } from "./lib/socket"
import { requestTiming } from "./middleware/requestTiming"

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
      // A refusal, not a fault: without the status the error handler below answered every
      // such request with a 500 and logged it as a server error, so any page pointed at this
      // API could fill the error log.
      callback(
        Object.assign(new Error(`Not allowed by CORS ${origin}`), { status: 403 }),
      ) // Block
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

// Before the routes, so every query a request makes is counted against it.
app.use(requestTiming)

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
// Server-to-server. Guarded by a shared secret, not a user session.
app.use("/api/internal", internalRoutes)

/**
 * The last word on anything a route threw without catching.
 *
 * Several handlers do work outside their try — pollMembershipStatus has none at all, and
 * adminSignIn and signUp both query before theirs — and Express hands those failures to
 * its default handler, which answers with an HTML page and, whenever NODE_ENV is not
 * "production", the whole stack trace. A malformed JSON body arrives here the same way.
 * The detail goes to the log; the client gets a status and a sentence. Four parameters,
 * because that arity is how Express recognises an error handler.
 */
app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error)
    return
  }

  // body-parser and friends attach the status they mean (400 bad JSON, 413 too large).
  const status = (error as { status?: unknown } | null)?.status
  const code =
    typeof status === "number" && status >= 400 && status < 600 ? status : 500

  if (code >= 500) {
    console.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, error)
  }

  res.status(code).json({
    message:
      code >= 500
        ? "Internal server error"
        : code === 403
          ? "Forbidden"
          : "Bad request",
  })
})

export default app
