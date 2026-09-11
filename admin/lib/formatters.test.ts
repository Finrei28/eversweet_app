import {
  formatCustomisation,
  formatLeaderboardMonth,
  formatPlace,
  formatStartsIn,
  isRemoval,
} from "./formatters"

const NOW = new Date("2026-03-02T12:00:00+13:00")
const inMinutes = (n: number) =>
  new Date(NOW.getTime() + n * 60_000).toISOString()

const inSeconds = (n: number) =>
  new Date(NOW.getTime() + n * 1000).toISOString()

describe("formatStartsIn", () => {
  it("counts down in mm:ss inside the last ten minutes", () => {
    expect(formatStartsIn(inMinutes(4), NOW)).toBe("Starts in 04:00")
    expect(formatStartsIn(inSeconds(4 * 60 + 35), NOW)).toBe("Starts in 04:35")
  })

  // Further out the seconds are noise, and showing them would mean ticking
  // this label once a second for the best part of an hour.
  it("counts down in whole minutes beyond that", () => {
    expect(formatStartsIn(inMinutes(25), NOW)).toBe("Starts in 25 min")
    expect(formatStartsIn(inMinutes(59), NOW)).toBe("Starts in 59 min")
  })

  it("swaps to seconds ten minutes out", () => {
    expect(formatStartsIn(inSeconds(600), NOW)).toBe("Starts in 10 min")
    expect(formatStartsIn(inSeconds(599), NOW)).toBe("Starts in 09:59")
  })

  // Both halves are padded, so the label keeps its width as it counts down
  // rather than shuffling the row every time a digit drops.
  it("pads to two digits either side", () => {
    expect(formatStartsIn(inSeconds(35), NOW)).toBe("Starts in 00:35")
    expect(formatStartsIn(inSeconds(9 * 60 + 5), NOW)).toBe("Starts in 09:05")
  })

  // Rounding down would show "00:00" for the last second, which reads as
  // broken rather than imminent.
  it("rounds part-seconds up", () => {
    expect(formatStartsIn(new Date(NOW.getTime() + 500).toISOString(), NOW)).toBe(
      "Starts in 00:01",
    )
  })

  it("says to start now once due, and stays there when overdue", () => {
    expect(formatStartsIn(inMinutes(0), NOW)).toBe("Start now")
    expect(formatStartsIn(inMinutes(-15), NOW)).toBe("Start now")
  })

  it("switches to hours past an hour out", () => {
    expect(formatStartsIn(inMinutes(60), NOW)).toBe("Starts in 1 hr")
    expect(formatStartsIn(inMinutes(150), NOW)).toBe("Starts in 2 hr 30 min")
  })

  // Rounding the minutes up before the hour check would read "60 min" here.
  it("reads the last second of the hour as an hour", () => {
    expect(formatStartsIn(inSeconds(3599), NOW)).toBe("Starts in 1 hr")
    expect(formatStartsIn(inSeconds(3540), NOW)).toBe("Starts in 59 min")
  })

  it("gives a weekday and time beyond a day", () => {
    expect(formatStartsIn(inMinutes(3 * 24 * 60), NOW)).toMatch(/^Starts /)
    expect(formatStartsIn(inMinutes(3 * 24 * 60), NOW)).not.toMatch(/hr|min/)
  })

  // The server sends null when it could not work out a due time. The card must
  // still render rather than showing "Invalid Date" or crashing the list.
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["an unparseable string", "not a date"],
  ])("handles %s", (_label, value) => {
    expect(formatStartsIn(value, NOW)).toBe("Start time unknown")
  })
})

/**
 * The customer only sends a customisation when they changed something, and the
 * quantity is the whole of what they changed: zero takes the ingredient out,
 * anything else adds that many. Reading it the wrong way round is a dessert
 * remade and a refund, so it is pinned down here.
 */
describe("customisations", () => {
  const line = (quantity: number, name = "Ice") => ({
    quantity,
    customisation: { name },
  })

  it("spells out a removal rather than showing a bare zero", () => {
    expect(formatCustomisation(line(0))).toBe("No Ice")
  })

  it("shows how many were added", () => {
    expect(formatCustomisation(line(1, "Taro"))).toBe("+1 Taro")
    expect(formatCustomisation(line(3, "Taro"))).toBe("+3 Taro")
  })

  it("knows which is which", () => {
    expect(isRemoval(line(0))).toBe(true)
    expect(isRemoval(line(1))).toBe(false)
  })
})

describe("formatLeaderboardMonth", () => {
  it("names the month the way staff would say it", () => {
    expect(formatLeaderboardMonth(8, 2026)).toBe("August 2026")
  })

  it("treats the month as 1-indexed, the way the server stores it", () => {
    // Read as 0-indexed, this convention once made the admin dashboard show no
    // winner for the whole of January.
    expect(formatLeaderboardMonth(1, 2026)).toBe("January 2026")
    expect(formatLeaderboardMonth(12, 2026)).toBe("December 2026")
  })

  it("does not render a month that cannot exist as a real one", () => {
    expect(formatLeaderboardMonth(0, 2026)).toBe("Unknown 2026")
    expect(formatLeaderboardMonth(13, 2026)).toBe("Unknown 2026")
  })
})

describe("formatPlace", () => {
  it("covers the podium", () => {
    expect(formatPlace(1)).toBe("1st")
    expect(formatPlace(2)).toBe("2nd")
    expect(formatPlace(3)).toBe("3rd")
  })
})
