import { describe, expect, it } from "vitest"

import { forEachWithConcurrency } from "./concurrency"

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe("forEachWithConcurrency", () => {
  it("runs every item, never more than the limit at once", async () => {
    let running = 0
    let most = 0
    const done: number[] = []

    await forEachWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1
      most = Math.max(most, running)
      await tick()
      done.push(n)
      running -= 1
    })

    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(most).toBe(3)
  })

  it("keeps going past an item that fails, then reports the failure", async () => {
    const done: number[] = []

    await expect(
      forEachWithConcurrency([1, 2, 3, 4], 2, async (n) => {
        await tick()
        if (n === 2) throw new Error("item 2 failed")
        done.push(n)
      }),
    ).rejects.toThrow("item 2 failed")

    expect(done.sort()).toEqual([1, 3, 4])
  })

  it("does nothing for an empty list", async () => {
    let calls = 0
    await forEachWithConcurrency([], 3, async () => {
      calls += 1
    })
    expect(calls).toBe(0)
  })
})
