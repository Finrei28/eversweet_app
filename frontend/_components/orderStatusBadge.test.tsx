import { statusLabel } from "./orderStatusBadge"

describe("statusLabel", () => {
  it("names each status the order server sends", () => {
    expect(statusLabel("PENDING")).toBe("Pending")
    expect(statusLabel("ACCEPTED")).toBe("Accepted")
    expect(statusLabel("MAKING")).toBe("Making")
    expect(statusLabel("READY")).toBe("Ready")
    expect(statusLabel("PICKED_UP")).toBe("Picked up")
  })

  /** A status added to the enum after this build was made, which it can only read as text. */
  it("reads a status it does not know rather than printing the raw value", () => {
    expect(statusLabel("OUT_FOR_DELIVERY")).toBe("Out for delivery")
  })
})
