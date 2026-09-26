import { contactUs } from "./supportContact"

describe("contactUs", () => {
  it("names the shop's email when there is one", () => {
    expect(contactUs("hello@example.co.nz")).toBe("contact us at hello@example.co.nz")
    expect(contactUs("  hello@example.co.nz ")).toBe("contact us at hello@example.co.nz")
  })

  it("still reads without one, rather than naming an address baked into the build", () => {
    expect(contactUs(undefined)).toBe("contact us")
    expect(contactUs(null)).toBe("contact us")
    expect(contactUs("   ")).toBe("contact us")
  })
})
