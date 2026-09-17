import { describe, expect, it } from "vitest"
import { Stripe } from "stripe"

import {
  isResourceMissing,
  orNullIfMissing,
  stripeErrorMessage,
} from "./stripeErrors"

const cardError = () =>
  new Stripe.errors.StripeCardError({
    type: "card_error",
    code: "card_declined",
    message: "Your card was declined.",
  })

const missing = () =>
  new Stripe.errors.StripeInvalidRequestError({
    type: "invalid_request_error",
    code: "resource_missing",
    message: "No such customer: 'cus_123'",
  })

describe("stripeErrorMessage", () => {
  it("passes a card decline through, because it is written for the customer", () => {
    expect(stripeErrorMessage(cardError(), "fallback")).toBe(
      "Your card was declined.",
    )
  })

  it.each([
    ["a Stripe request error", missing()],
    ["a plain error", new Error("Invalid `prisma.user.update()` invocation")],
    ["a string", "connection reset"],
    ["nothing at all", undefined],
  ])("hides %s behind the fallback", (_label, error) => {
    expect(stripeErrorMessage(error, "fallback")).toBe("fallback")
  })
})

describe("orNullIfMissing", () => {
  it("settles to null for an id Stripe does not know", async () => {
    await expect(orNullIfMissing(Promise.reject(missing()))).resolves.toBeNull()
  })

  it("passes a found object through", async () => {
    await expect(orNullIfMissing(Promise.resolve({ id: "pm_1" }))).resolves.toEqual({
      id: "pm_1",
    })
  })

  it("still throws every other failure", async () => {
    await expect(
      orNullIfMissing(Promise.reject(cardError())),
    ).rejects.toBeInstanceOf(Stripe.errors.StripeCardError)
  })
})

describe("isResourceMissing", () => {
  it("is false for a request error with another code", () => {
    const other = new Stripe.errors.StripeInvalidRequestError({
      type: "invalid_request_error",
      code: "parameter_invalid_empty",
      message: "Missing required param",
    })
    expect(isResourceMissing(other)).toBe(false)
  })
})
