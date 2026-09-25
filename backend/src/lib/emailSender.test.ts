import { afterEach, describe, expect, it, vi } from "vitest"

// Never the real Resend. What `send` answers is set per test.
const send = vi.fn()
vi.mock("resend", () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send } }
  }),
}))

import EmailSender from "./emailSender"

describe("EmailSender", () => {
  afterEach(() => {
    send.mockReset()
    vi.restoreAllMocks()
  })

  /**
   * Resend reports a refused email by returning it, not by throwing, and nothing looked:
   * a customer's code or receipt could fail to send with no trace anywhere.
   */
  it("logs an email Resend refuses, without the recipient", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    send.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid `to` field." },
    })

    const result = await EmailSender("ada@example.test", "Order Confirmation", null as never)

    expect(result?.error?.name).toBe("validation_error")
    expect(logged).toHaveBeenCalledTimes(1)
    const [line] = logged.mock.calls[0]
    expect(line).toContain("Order Confirmation")
    expect(line).toContain("validation_error")
    expect(line).not.toContain("ada@example.test")
  })

  it("says nothing when the email is accepted", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    send.mockResolvedValue({ data: { id: "email_1" }, error: null })

    const result = await EmailSender("ada@example.test", "Order Confirmation", null as never)

    expect(result?.data?.id).toBe("email_1")
    expect(logged).not.toHaveBeenCalled()
  })
})
