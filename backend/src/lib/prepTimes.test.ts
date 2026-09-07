import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }))

vi.mock("./db", () => ({ db: { prepTimeSetting: { findFirst } } }))

import {
  DEFAULT_PREP_TIMES,
  getPrepTimes,
  invalidatePrepTimes,
} from "./prepTimes"

const row = {
  singleItem: 7,
  upToThree: 12,
  upToSix: 18,
  moreThanSix: 25,
  kitchenSlack: 2,
  quoteFloor: 8,
}

beforeEach(() => {
  findFirst.mockReset()
  invalidatePrepTimes()
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  invalidatePrepTimes()
  vi.restoreAllMocks()
})

describe("getPrepTimes", () => {
  it("returns the configured row", async () => {
    findFirst.mockResolvedValue({ id: "default", updatedAt: new Date(), ...row })

    await expect(getPrepTimes()).resolves.toEqual(row)
  })

  // Deploying the table before seeding it must behave exactly as before.
  it("falls back to the defaults when the table is empty", async () => {
    findFirst.mockResolvedValue(null)

    await expect(getPrepTimes()).resolves.toEqual(DEFAULT_PREP_TIMES)
  })

  /**
   * This sits on the order path. A settings table being unreachable must never
   * be able to stop an order reaching the kitchen.
   */
  it("falls back to the defaults when the database is unreachable", async () => {
    findFirst.mockRejectedValue(new Error("connection terminated"))

    await expect(getPrepTimes()).resolves.toEqual(DEFAULT_PREP_TIMES)
  })

  it("caches rather than reading once per order", async () => {
    findFirst.mockResolvedValue({ id: "default", updatedAt: new Date(), ...row })

    await getPrepTimes()
    await getPrepTimes()
    await getPrepTimes()

    expect(findFirst).toHaveBeenCalledTimes(1)
  })

  // A transient failure must not pin the defaults in place for the whole TTL.
  it("does not cache a failure", async () => {
    findFirst.mockRejectedValueOnce(new Error("connection terminated"))
    await expect(getPrepTimes()).resolves.toEqual(DEFAULT_PREP_TIMES)

    findFirst.mockResolvedValue({ id: "default", updatedAt: new Date(), ...row })
    await expect(getPrepTimes()).resolves.toEqual(row)
  })

  it("re-reads once invalidated, so a saved change takes effect", async () => {
    findFirst.mockResolvedValue({ id: "default", updatedAt: new Date(), ...row })
    await getPrepTimes()

    invalidatePrepTimes()
    findFirst.mockResolvedValue({
      id: "default",
      updatedAt: new Date(),
      ...row,
      singleItem: 3,
    })

    await expect(getPrepTimes()).resolves.toMatchObject({ singleItem: 3 })
    expect(findFirst).toHaveBeenCalledTimes(2)
  })
})
