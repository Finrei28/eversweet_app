import { beforeEach, describe, expect, it, vi } from "vitest"
import express from "express"
import request from "supertest"

const { relayOrder } = vi.hoisted(() => ({ relayOrder: vi.fn() }))

vi.mock("../lib/orderRelay", () => ({ relayOrder }))

// Pass-through: the limiter needs Redis, and what is under test here is the
// secret check and the handler behind it.
vi.mock("../middleware/rateLimiter", () => ({
  serviceLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}))

import internalRoutes from "./internal.routes"
import { SERVICE_SECRET_HEADER } from "../middleware/serviceAuth"

const SECRET = "service-secret-value"
const ANNOUNCE = "/api/internal/orders/announce"

const app = express()
app.use(express.json())
app.use("/api/internal", internalRoutes)

const announce = (secret?: string, body: unknown = { orderId: "order-1" }) => {
  const req = request(app).post(ANNOUNCE)
  if (secret !== undefined) req.set(SERVICE_SECRET_HEADER, secret)
  return req.send(body as object)
}

beforeEach(() => {
  relayOrder.mockReset()
  relayOrder.mockResolvedValue({ status: "delivered" })
  process.env.INTERNAL_SERVICE_SECRET = SECRET
})

describe("POST /api/internal/orders/announce", () => {
  it("announces the order and returns the outcome", async () => {
    relayOrder.mockResolvedValue({ status: "scheduled", dueAt: "2026-03-02T12:00:00.000Z" })

    const res = await announce(SECRET)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      status: "scheduled",
      dueAt: "2026-03-02T12:00:00.000Z",
    })
    expect(relayOrder).toHaveBeenCalledWith("order-1")
  })

  it.each([
    ["no secret", undefined],
    ["the wrong secret", "wrong-secret-value"],
    ["a secret that is a prefix of the real one", SECRET.slice(0, -1)],
    ["an empty secret", ""],
  ])("rejects a request with %s", async (_label, secret) => {
    const res = await announce(secret)

    expect(res.status).toBe(401)
    expect(relayOrder).not.toHaveBeenCalled()
  })

  // A deploy that forgets the variable must fail closed. Treating "unset" as
  // "no check" would leave the kitchen screen open to anyone who found it.
  it("rejects every request when the secret is not configured", async () => {
    delete process.env.INTERNAL_SERVICE_SECRET

    expect((await announce(SECRET)).status).toBe(401)
    expect((await announce("")).status).toBe(401)
    expect(relayOrder).not.toHaveBeenCalled()
  })

  it.each([
    ["an empty body", {}],
    ["a blank orderId", { orderId: "   " }],
    ["a non-string orderId", { orderId: 42 }],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await announce(SECRET, body)

    expect(res.status).toBe(400)
    expect(relayOrder).not.toHaveBeenCalled()
  })

  // The order is committed and paid for; only the announcement failed. The
  // caller logs the 500 and the cron announces it on the next pass.
  it("reports a relay failure as a 500 without leaking the cause", async () => {
    relayOrder.mockRejectedValue(new Error("connection terminated"))

    const res = await announce(SECRET)

    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain("connection terminated")
  })
})
