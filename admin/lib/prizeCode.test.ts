import { bareLength, formatAsTyped, isComplete } from "./prizeCode"

describe("formatAsTyped", () => {
  it("groups the code the way the customer's screen shows it", () => {
    expect(formatAsTyped("7K4MQ92X")).toBe("7K4M-Q92X")
  })

  it("does not add the dash until there is something after it", () => {
    expect(formatAsTyped("7K4M")).toBe("7K4M")
    expect(formatAsTyped("7K4MQ")).toBe("7K4M-Q")
  })

  it("upper-cases as staff type", () => {
    // A keyboard that has quietly lower-cased the first letter should not cost
    // anyone a retry at the counter.
    expect(formatAsTyped("7k4mq92x")).toBe("7K4M-Q92X")
  })

  it("accepts the dash being typed too", () => {
    // It is on screen, so it is the obvious thing to copy.
    expect(formatAsTyped("7K4M-Q92X")).toBe("7K4M-Q92X")
  })

  it("ignores spaces and stray punctuation", () => {
    expect(formatAsTyped("7K4M Q92X")).toBe("7K4M-Q92X")
    expect(formatAsTyped("7-K-4-M-Q-9-2-X")).toBe("7K4M-Q92X")
    expect(formatAsTyped(" 7k4m--q92x ")).toBe("7K4M-Q92X")
  })

  it("stops at a full code rather than letting a stuck key run on", () => {
    expect(formatAsTyped("7K4MQ92XYYYY")).toBe("7K4M-Q92X")
  })

  it("is idempotent, so re-formatting on every keystroke is safe", () => {
    const once = formatAsTyped("7k4mq92x")
    expect(formatAsTyped(once)).toBe(once)
  })

  it("handles an empty box", () => {
    expect(formatAsTyped("")).toBe("")
  })

  it("does not repair a character that is not in the code alphabet", () => {
    // "0" is not a code character. Silently turning it into "O" would let two
    // different codes collide — the server says "no such code" instead.
    expect(formatAsTyped("0K4MQ92X")).toBe("0K4M-Q92X")
  })
})

describe("bareLength", () => {
  it("ignores the grouping dash", () => {
    expect(bareLength("7K4M-Q92X")).toBe(8)
    expect(bareLength("7K4M")).toBe(4)
    expect(bareLength("")).toBe(0)
  })
})

describe("isComplete", () => {
  it("is true only for a whole code", () => {
    expect(isComplete("7K4M-Q92X")).toBe(true)
    expect(isComplete("7K4MQ92X")).toBe(true)
  })

  it("is false while the code is still being typed", () => {
    expect(isComplete("7K4M-Q92")).toBe(false)
    expect(isComplete("7K4M")).toBe(false)
    expect(isComplete("")).toBe(false)
  })
})
