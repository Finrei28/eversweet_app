import { pointsExpiryNotice } from "./pointsExpiry"

/**
 * The server sends the last instant of an Auckland day. The notice has to name that day
 * wherever the phone is - 10:59pm UTC on 1 November is already 2 November in Auckland's
 * morning, and the day before in Los Angeles.
 */
describe("pointsExpiryNotice", () => {
  it("names the Auckland day the points expire at the end of", () => {
    expect(pointsExpiryNotice("2026-11-01T10:59:59.999Z", 120)).toBe(
      "Your points expire at the end of Sunday 1 November. Place an order to keep them.",
    )
  })

  it.each([
    ["no date", null],
    ["an older server", undefined],
    ["an unreadable date", "not a date"],
  ])("says nothing for %s", (_name, expiresAt) => {
    expect(pointsExpiryNotice(expiresAt, 120)).toBeNull()
  })

  /** With nothing to lose there is nothing to warn about, whatever the date says. */
  it("says nothing when there are no points", () => {
    expect(pointsExpiryNotice("2026-11-01T10:59:59.999Z", 0)).toBeNull()
  })
})
