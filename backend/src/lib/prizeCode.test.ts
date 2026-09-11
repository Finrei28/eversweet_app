import { describe, expect, it } from "vitest"
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  formatPrizeCode,
  generatePrizeCode,
  looksLikePrizeCode,
  normalisePrizeCode,
} from "./prizeCode"

describe("the prize code alphabet", () => {
  it("leaves out every character pair that is misread at a counter", () => {
    // The whole point of a custom alphabet. If someone widens it back to
    // base36 later, this is what should stop them.
    for (const ambiguous of ["O", "0", "I", "1", "L", "U"]) {
      expect(CODE_ALPHABET).not.toContain(ambiguous)
    }
  })

  it("has no repeated character", () => {
    expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length)
  })
})

describe("generatePrizeCode", () => {
  it("draws only from the alphabet, at the stated length", () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePrizeCode()
      expect(code).toHaveLength(CODE_LENGTH)
      expect(looksLikePrizeCode(code)).toBe(true)
    }
  })

  it("does not repeat itself", () => {
    // Not a randomness test — a smoke alarm. A generator stuck on a constant,
    // or seeded per call, shows up here immediately.
    const codes = new Set(Array.from({ length: 500 }, generatePrizeCode))
    expect(codes.size).toBe(500)
  })

  it("reaches every character in the alphabet", () => {
    // Catches an off-by-one in the randomInt bound, which would silently make
    // the last character unreachable.
    const seen = new Set<string>()
    for (let i = 0; i < 5000; i++) {
      for (const character of generatePrizeCode()) seen.add(character)
    }
    expect(seen.size).toBe(CODE_ALPHABET.length)
  })
})

describe("normalisePrizeCode", () => {
  const code = "7K4MQ92X"

  it("accepts the code exactly as the customer's screen shows it", () => {
    expect(normalisePrizeCode("7K4M-Q92X")).toBe(code)
  })

  it("accepts lower case, spaces and stray dashes", () => {
    expect(normalisePrizeCode("7k4m q92x")).toBe(code)
    expect(normalisePrizeCode(" 7k4m--q92x ")).toBe(code)
    expect(normalisePrizeCode("7-K-4-M-Q-9-2-X")).toBe(code)
  })

  it("leaves an already canonical code alone", () => {
    expect(normalisePrizeCode(code)).toBe(code)
  })

  it("does not silently repair a character that is not in the alphabet", () => {
    // "0" is not a code character. Normalising it to "O" would be worse than
    // rejecting it: two different codes could then collide.
    expect(looksLikePrizeCode(normalisePrizeCode("0K4MQ92X"))).toBe(false)
  })
})

describe("formatPrizeCode", () => {
  it("groups the code the way it is read aloud", () => {
    expect(formatPrizeCode("7K4MQ92X")).toBe("7K4M-Q92X")
  })

  it("round-trips through normalise", () => {
    const code = generatePrizeCode()
    expect(normalisePrizeCode(formatPrizeCode(code))).toBe(code)
  })
})

describe("looksLikePrizeCode", () => {
  it("rejects the wrong length", () => {
    expect(looksLikePrizeCode("7K4MQ92")).toBe(false)
    expect(looksLikePrizeCode("7K4MQ92XY")).toBe(false)
    expect(looksLikePrizeCode("")).toBe(false)
  })

  it("rejects characters outside the alphabet", () => {
    expect(looksLikePrizeCode("7K4MQ92O")).toBe(false)
    expect(looksLikePrizeCode("7K4M-Q92")).toBe(false)
  })
})
