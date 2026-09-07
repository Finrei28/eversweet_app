import { beforeEach, describe, expect, it, vi } from "vitest"
import express from "express"
import request from "supertest"

const { updateMany, create, getPrepTimes, invalidatePrepTimes } = vi.hoisted(
  () => ({
    updateMany: vi.fn(),
    create: vi.fn(),
    getPrepTimes: vi.fn(),
    invalidatePrepTimes: vi.fn(),
  }),
)

vi.mock("../lib/db", () => ({
  db: { prepTimeSetting: { updateMany, create } },
}))

vi.mock("../lib/prepTimes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/prepTimes")>()
  return { ...actual, getPrepTimes, invalidatePrepTimes }
})

import { updatePrepTimeSettings } from "./admin.controller"
import { DEFAULT_PREP_TIMES } from "../lib/prepTimes"

const app = express()
app.use(express.json())
app.patch("/prep-times", updatePrepTimeSettings)

const save = (body: unknown) =>
  request(app).patch("/prep-times").send(body as object)

beforeEach(() => {
  updateMany.mockReset().mockResolvedValue({ count: 1 })
  create.mockReset().mockResolvedValue({})
  getPrepTimes.mockReset().mockResolvedValue(DEFAULT_PREP_TIMES)
  invalidatePrepTimes.mockReset()
})

describe("updatePrepTimeSettings", () => {
  it("saves the fields it was given", async () => {
    const res = await save({ singleItem: 7, quoteFloor: 12 })

    expect(res.status).toBe(200)
    expect(updateMany).toHaveBeenCalledWith({
      data: { singleItem: 7, quoteFloor: 12 },
    })
  })

  // A screen should be able to send only what moved.
  it("leaves fields it was not given alone", async () => {
    await save({ singleItem: 7 })

    expect(updateMany).toHaveBeenCalledWith({ data: { singleItem: 7 } })
  })

  // Otherwise the next order would still be timed by the old numbers for up to
  // a minute, and whoever changed them would think it had not worked.
  it("clears the cache so the change takes effect at once", async () => {
    await save({ singleItem: 7 })

    expect(invalidatePrepTimes).toHaveBeenCalled()
  })

  // Deployed but never seeded: updateMany matches nothing and would otherwise
  // report success having written nothing at all.
  it("creates the row when there is none to update", async () => {
    updateMany.mockResolvedValue({ count: 0 })

    const res = await save({ singleItem: 7 })

    expect(res.status).toBe(200)
    expect(create).toHaveBeenCalledWith({ data: { singleItem: 7 } })
  })

  it.each([
    ["a non-number", { singleItem: "seven" }],
    ["a fraction", { singleItem: 7.5 }],
    ["zero preparation time", { singleItem: 0 }],
    ["a negative", { singleItem: -5 }],
    ["an absurd value", { singleItem: 500 }],
    ["a negative head start", { kitchenSlack: -1 }],
  ])("rejects %s", async (_label, body) => {
    const res = await save(body)

    expect(res.status).toBe(400)
    expect(updateMany).not.toHaveBeenCalled()
  })

  // Zero slack is legitimate: it means alert exactly at preparation time.
  it("accepts a zero head start", async () => {
    expect((await save({ kitchenSlack: 0 })).status).toBe(200)
  })

  it("rejects a body with nothing to change", async () => {
    const res = await save({ notAField: 5 })

    expect(res.status).toBe(400)
    expect(updateMany).not.toHaveBeenCalled()
  })

  it("reports a write failure as a 500", async () => {
    updateMany.mockRejectedValue(new Error("connection terminated"))

    expect((await save({ singleItem: 7 })).status).toBe(500)
  })
})
