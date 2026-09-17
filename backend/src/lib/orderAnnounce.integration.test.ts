import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import http from "http"
import { AddressInfo } from "net"
import { Server } from "socket.io"
import { io as connect, type Socket as ClientSocket } from "socket.io-client"
import jwt from "jsonwebtoken"
import request from "supertest"

const { findUnique, findUser } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  // The socket handshake reads the user row for the role and the password check, rather
  // than trusting the token. Each token below names its role in its user id ("ADMIN-1"),
  // so the row on record agrees with it.
  findUser: vi.fn(async ({ where }: { where: { id: string } }) => ({
    role: where.id.split("-")[0],
    passwordChangedAt: null as Date | null,
  })),
}))

vi.mock("../lib/db", () => ({
  db: { order: { findUnique }, user: { findUnique: findUser } },
}))

// Always a miss. This file does not stub Redis, and the session cache would otherwise
// reach for whatever REDIS_URL backend/.env names.
vi.mock("./sessionCache", () => ({
  cachedSession: vi.fn(async () => undefined),
  rememberSession: vi.fn(),
  forgetSession: vi.fn(async () => {}),
}))

// The stub database has no settings table; pin the defaults rather than let
// the relay fall back through an error path on every call.
vi.mock("./prepTimes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./prepTimes")>()
  return {
    ...actual,
    getPrepTimes: vi.fn(async () => actual.DEFAULT_PREP_TIMES),
  }
})

// Every route file pulls a limiter in at import time, and the limiters want a
// Redis connection. None of them are what this test is about.
vi.mock("../middleware/rateLimiter", () => {
  // Declared in the factory: `vi.mock` is hoisted above the module body, so a
  // top-level const would not exist yet when this runs.
  const passThrough = (_req: unknown, _res: unknown, next: () => void) => next()

  return {
    ipShortLimiter: passThrough,
    ipLongLimiter: passThrough,
    userNameMediumLimiter: passThrough,
    userNameLongLimiter: passThrough,
    verificationEmailLimiter: passThrough,
    otpIpShortLimiter: passThrough,
    otpIpLongLimiter: passThrough,
    otpEmailMediumLimiter: passThrough,
    otpEmailLongLimiter: passThrough,
    serviceLimiter: passThrough,
    prizeCodeLimiter: passThrough,
    prizeCodeDailyLimiter: passThrough,
  }
})

vi.mock("../lib/emailSender", () => ({ default: vi.fn(async () => {}) }))
vi.mock("../email/orderConfirmation", () => ({ default: () => null }))

import app from "../app"
import { setIo } from "./socket"
import {
  disconnectUserSockets,
  recheckAdminSockets,
  registerSocketHandlers,
} from "./socketAuth"
import { clearScheduledOrders } from "./orderRelay"
import { SERVICE_SECRET_HEADER } from "../middleware/serviceAuth"

const SECRET = "integration-service-secret"
/** Two items means an 11 minute lead, so this much notice is "due now". */
const LEAD_MS = 11 * 60_000

let server: http.Server
let io: Server
let url: string
const clients: ClientSocket[] = []

const tokenFor = (role: string) =>
  jwt.sign({ userId: `${role}-1`, role }, process.env.JWT_SECRET!, {
    expiresIn: "1h",
  })

/** Connects a client and resolves once the handshake has been accepted. */
const connectAs = (role: string) =>
  new Promise<ClientSocket>((resolve, reject) => {
    const socket = connect(url, {
      transports: ["websocket"],
      auth: { token: tokenFor(role) },
      reconnection: false,
    })
    clients.push(socket)
    socket.on("connect", () => resolve(socket))
    socket.on("connect_error", reject)
  })

/** Resolves with the next event of this name, or null if none arrives in time. */
const nextEvent = (socket: ClientSocket, event: string, ms: number) =>
  new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    socket.once(event, (payload: unknown) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })

/** "Start making this" — the alarm. */
const nextOrder = (socket: ClientSocket, ms = 500) =>
  nextEvent(socket, "new-order", ms)

/** "This order exists" — the silent one, for the Upcoming list. */
const nextReceipt = (socket: ClientSocket, ms = 500) =>
  nextEvent(socket, "order-received", ms)

const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms))

/** Resolves true once the server has sent this socket away, or false if it has not in time. */
const disconnectedWithin = (socket: ClientSocket, ms = 500) =>
  new Promise<boolean>((resolve) => {
    if (socket.disconnected) return resolve(true)
    const timer = setTimeout(() => resolve(false), ms)
    socket.once("disconnect", () => {
      clearTimeout(timer)
      resolve(true)
    })
  })

const dueOrder = (over: Record<string, unknown> = {}) => ({
  id: "order-1",
  tempOrderId: "6001",
  status: "PENDING",
  createdAt: new Date(),
  pickedUpAt: null,
  pickUpTime: new Date(Date.now() + LEAD_MS),
  customerFirstName: "Ada",
  customerLastName: "Lovelace",
  customerEmail: "ada@example.test",
  customerPhoneNumber: "0211234567",
  priceInCents: 2400,
  discountedAmountInCents: 0,
  dineIn: false,
  notified: false,
  GST: 313,
  appUserId: null,
  desserts: [{ id: "line-1", orderId: "order-1", quantity: 2 }],
  ...over,
})

const announce = (orderId = "order-1", secret = SECRET) =>
  request(app)
    .post("/api/internal/orders/announce")
    .set(SERVICE_SECRET_HEADER, secret)
    .send({ orderId })

beforeAll(async () => {
  server = http.createServer(app)
  io = new Server(server)
  setIo(io)
  registerSocketHandlers(io)

  await new Promise<void>((resolve) => server.listen(0, resolve))
  url = `http://localhost:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  io.close()
  await new Promise<void>((resolve) => {
    server.close(() => resolve())
  })
})

beforeEach(() => {
  findUnique.mockReset()
  process.env.INTERNAL_SERVICE_SECRET = SECRET
  clearScheduledOrders()
})

afterEach(() => {
  clearScheduledOrders()
  while (clients.length) clients.pop()?.disconnect()
})

/**
 * The whole path the website's order takes: an HTTP announcement carrying only
 * an id, through the relay, out over the socket, onto the kitchen screen.
 */
describe("website order announcement, end to end", () => {
  it("puts a due order on an admin socket", async () => {
    findUnique.mockResolvedValue(dueOrder())
    const admin = await connectAs("ADMIN")
    const received = nextOrder(admin)

    const res = await announce()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: "delivered" })

    const order = (await received) as Record<string, unknown>
    expect(order.id).toBe("order-1")
    expect(order.tempOrderId).toBe("6001")
    // Bookkeeping the kitchen screen has never been sent.
    expect(order).not.toHaveProperty("notified")
  })

  /**
   * The reason `socketAuth` exists. Customer tokens are signed with the same
   * secret as admin ones; before the fix every connection was labelled admin
   * and this assertion would have failed, leaking the customer's name, email
   * and phone number to anyone signed in to the shop's app.
   */
  it("does not put it on a customer socket", async () => {
    findUnique.mockResolvedValue(dueOrder())
    const customer = await connectAs("USER")
    const received = nextOrder(customer)

    await announce()

    await expect(received).resolves.toBeNull()
  })

  it("refuses an announcement with no service secret", async () => {
    findUnique.mockResolvedValue(dueOrder())
    const admin = await connectAs("ADMIN")
    const received = nextOrder(admin)

    const res = await request(app)
      .post("/api/internal/orders/announce")
      .send({ orderId: "order-1" })

    expect(res.status).toBe(401)
    await expect(received).resolves.toBeNull()
  })

  it("holds a scheduled order back, then delivers it when it comes due", async () => {
    // Due in 300ms rather than minutes, so this exercises the real timer
    // instead of a simulated clock.
    findUnique.mockResolvedValue(
      dueOrder({ pickUpTime: new Date(Date.now() + LEAD_MS + 300) }),
    )
    const admin = await connectAs("ADMIN")
    const received = nextOrder(admin, 2000)

    const res = await announce()
    expect(res.body).toMatchObject({ status: "scheduled" })

    // Nothing yet: the order is not due for another 300ms.
    await expect(nextOrder(admin, 100)).resolves.toBeNull()

    expect((await received) as Record<string, unknown>).toMatchObject({
      id: "order-1",
    })
  })

  /**
   * The Upcoming list. A booking days out never gets an alarm today and is far
   * past anything the relay holds a timer for — before the receipt event the
   * shop had no way to know it existed until the sweep found it on the day.
   */
  it("puts an order days away on the screen without alarming", async () => {
    findUnique.mockResolvedValue(
      dueOrder({ pickUpTime: new Date(Date.now() + 3 * 24 * 60 * 60_000) }),
    )
    const admin = await connectAs("ADMIN")
    const receipt = nextReceipt(admin)
    const alarm = nextOrder(admin, 400)

    const res = await announce()
    expect(res.body).toMatchObject({ status: "deferred" })

    const seen = (await receipt) as Record<string, unknown>
    expect(seen).toMatchObject({ id: "order-1", tempOrderId: "6001" })
    expect(typeof seen.dueAt).toBe("string")

    await expect(alarm).resolves.toBeNull()
  })

  it("sends a due order's receipt and alarm together", async () => {
    findUnique.mockResolvedValue(dueOrder())
    const admin = await connectAs("ADMIN")
    const receipt = nextReceipt(admin)
    const alarm = nextOrder(admin)

    await announce()

    await expect(receipt).resolves.toMatchObject({ id: "order-1" })
    await expect(alarm).resolves.toMatchObject({ id: "order-1" })
  })

  // Same leak, same fix: the receipt carries the customer's name, email and
  // phone number just as the alarm does.
  it("does not put a receipt on a customer socket", async () => {
    findUnique.mockResolvedValue(dueOrder())
    const customer = await connectAs("USER")
    const receipt = nextReceipt(customer)

    await announce()

    await expect(receipt).resolves.toBeNull()
  })

  it("announces once however many times the website retries", async () => {
    findUnique.mockResolvedValue(dueOrder())
    const admin = await connectAs("ADMIN")

    let delivered = 0
    admin.on("new-order", () => {
      delivered += 1
    })

    await announce()
    await announce()
    await announce()

    await settle()

    // Three announcements, three deliveries — the server does not de-duplicate
    // an order that is due right now, because re-announcing an order staff
    // have not yet accepted is how the sweep nags them. The app is what keeps
    // it to one alert.
    expect(delivered).toBe(3)
  })
})

/**
 * A socket is checked once, at its handshake, and a kitchen tablet stays connected for
 * days. A demoted admin, a thief whose stolen password had been reset, or a token that had
 * run out kept receiving every order until the socket happened to reconnect.
 */
describe("sockets already in the kitchen room", () => {
  it("sends away an admin who is no longer an admin", async () => {
    const admin = await connectAs("ADMIN")
    findUser.mockResolvedValueOnce({ role: "USER", passwordChangedAt: null })

    await recheckAdminSockets(io)

    expect(await disconnectedWithin(admin)).toBe(true)
  })

  it("sends away a socket whose password has been reset since it connected", async () => {
    const admin = await connectAs("ADMIN")
    findUser.mockResolvedValueOnce({
      role: "ADMIN",
      passwordChangedAt: new Date(Date.now() + 60_000),
    })

    await recheckAdminSockets(io)

    expect(await disconnectedWithin(admin)).toBe(true)
  })

  it("keeps an admin whose session still holds, and keeps sending them orders", async () => {
    findUnique.mockResolvedValue(dueOrder())
    const admin = await connectAs("ADMIN")

    await recheckAdminSockets(io)

    expect(await disconnectedWithin(admin, 200)).toBe(false)
    const received = nextOrder(admin)
    await announce()
    expect(await received).toMatchObject({ id: "order-1" })
  })

  // Dropping every tablet in the shop over a database blip would silence the alarms.
  it("keeps the socket when the check cannot be made", async () => {
    const admin = await connectAs("ADMIN")
    findUser.mockRejectedValueOnce(new Error("Can't reach database server"))
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})

    await recheckAdminSockets(io)

    expect(await disconnectedWithin(admin, 200)).toBe(false)
    errors.mockRestore()
  })

  it("disconnects only the user whose password was reset", async () => {
    const admin = await connectAs("ADMIN")
    const customer = await connectAs("USER")

    await disconnectUserSockets("USER-1")

    expect(await disconnectedWithin(customer)).toBe(true)
    expect(await disconnectedWithin(admin, 200)).toBe(false)
  })
})
