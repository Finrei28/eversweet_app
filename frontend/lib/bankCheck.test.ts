import {
  BANK_CHECK_NOT_COMPLETED,
  PAYMENT_NOT_COMPLETED,
  bankCheckMessage,
} from "./bankCheck"

describe("bankCheckMessage", () => {
  it("rewords Stripe's 3D Secure failure, which is written for developers", () => {
    expect(
      bankCheckMessage({
        code: "Failed",
        stripeErrorCode: "payment_intent_authentication_failure",
        message:
          "The provided PaymentMethod has failed authentication. You can provide payment_method_data or a new PaymentMethod to attempt to fulfill this PaymentIntent again.",
      }),
    ).toBe(BANK_CHECK_NOT_COMPLETED)
  })

  it("rewords a wrong code in the bank's check, which Android reports uncoded", () => {
    expect(
      bankCheckMessage({
        code: "Failed",
        stripeErrorCode: null,
        declineCode: null,
        message: "Failed with transaction_status: N",
      }),
    ).toBe(BANK_CHECK_NOT_COMPLETED)
  })

  it("says the same when the customer backs out of the check", () => {
    expect(
      bankCheckMessage({ code: "Canceled", message: "The payment has been canceled" }),
    ).toBe(BANK_CHECK_NOT_COMPLETED)
  })

  it("passes a card decline through, since Stripe words those for customers", () => {
    expect(
      bankCheckMessage({
        code: "Failed",
        stripeErrorCode: "card_declined",
        declineCode: "insufficient_funds",
        message: "Your card has insufficient funds.",
      }),
    ).toBe("Your card has insufficient funds.")
  })

  it("never shows the SDK's own wording for a failure Stripe did not code", () => {
    expect(
      bankCheckMessage({
        code: "Failed",
        message: "Activity doesn't exist yet. You can safely retry this method.",
      }),
    ).toBe(PAYMENT_NOT_COMPLETED)
  })

  it("does not promise nothing was charged for an uncoded failure", () => {
    expect(PAYMENT_NOT_COMPLETED).not.toMatch(/charged/)
  })
})
