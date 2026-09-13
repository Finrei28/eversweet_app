import { beforeEach, describe, expect, it, vi } from "vitest"
import express from "express"
import request from "supertest"

const { relayOrder, assignReward, settleCalendarMonth } = vi.hoisted(() => ({
  relayOrder: vi.fn(),
  assignReward: vi.fn(),
  settleCalendarMonth: vi.fn(),
}))

vi.mock("../lib/orderRelay", () => ({ relayOrder }))

// The prize cores are exercised against a real database in the prize and settle
// suites. What is under test here is the routing and the secret in front of them.
vi.mock("../controllers/prize.controller", () => ({
  assignReward,
  settleCalendarMonth,
}))

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
  assignReward.mockReset()
  settleCalendarMonth.mockReset()
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

describe("PUT /api/internal/winners/reward", () => {
  const assign = (secret?: string, body: object = { winnerId: "w-1", title: "Mochi" }) => {
    const req = request(app).put("/api/internal/winners/reward")
    if (secret !== undefined) req.set(SERVICE_SECRET_HEADER, secret)
    return req.send(body)
  }

  it("passes the body through, adminId and expiry included, and answers with the outcome", async () => {
    assignReward.mockResolvedValue({ status: 201, body: { notified: true } })

    const res = await assign(SECRET, {
      winnerId: "w-1",
      title: "Mochi",
      description: "Any flavour",
      expiresAt: "2026-10-31T10:59:59.999Z",
      adminId: "admin-9",
    })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({ notified: true })
    expect(assignReward).toHaveBeenCalledWith({
      winnerId: "w-1",
      title: "Mochi",
      description: "Any flavour",
      expiresAt: "2026-10-31T10:59:59.999Z",
      adminId: "admin-9",
    })
  })

  it.each([["no secret", undefined], ["the wrong secret", "wrong-secret-value"]])(
    "rejects a request with %s",
    async (_label, secret) => {
      expect((await assign(secret)).status).toBe(401)
      expect(assignReward).not.toHaveBeenCalled()
    },
  )

  it("reports a failure as a 500 without leaking the cause", async () => {
    assignReward.mockRejectedValue(new Error("connection terminated"))

    const res = await assign(SECRET)

    expect(res.status).toBe(500)
    expect(JSON.stringify(res.body)).not.toContain("connection terminated")
  })
})

describe("POST /api/internal/winners/settle", () => {
  const settle = (secret?: string) => {
    const req = request(app).post("/api/internal/winners/settle")
    if (secret !== undefined) req.set(SERVICE_SECRET_HEADER, secret)
    return req.send({ month: 8, year: 2026 })
  }

  it("settles the month asked for and answers with the outcome", async () => {
    settleCalendarMonth.mockResolvedValue({
      status: 200,
      body: { outcome: "RECORDED", recorded: 3 },
    })

    const res = await settle(SECRET)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ outcome: "RECORDED", recorded: 3 })
    expect(settleCalendarMonth).toHaveBeenCalledWith(8, 2026)
  })

  it("rejects a request without the secret", async () => {
    expect((await settle()).status).toBe(401)
    expect(settleCalendarMonth).not.toHaveBeenCalled()
  })
})
