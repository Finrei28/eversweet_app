import { describe, expect, it, vi } from "vitest"

const { randomInt } = vi.hoisted(() => ({ randomInt: vi.fn() }))

vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>()
  return { ...actual, randomInt }
})

import { generateOtp } from "./otp"

describe("generateOtp", () => {
  it("draws from the CSPRNG across the whole six-digit range", () => {
    randomInt.mockReturnValue(123456)

    expect(generateOtp()).toBe("123456")
    expect(randomInt).toHaveBeenCalledWith(100_000, 1_000_000)
  })

  it.each([[100_000], [999_999]])("keeps %i at six digits", (value) => {
    randomInt.mockReturnValue(value)

    expect(generateOtp()).toMatch(/^\d{6}$/)
  })
})
