import { describe, expect, it } from "vitest"
import { Stripe } from "stripe"

import {
  customerDetailsOf,
  describeStripeFailure,
  staleCustomerDetails,
} from "./stripeCustomer"

const ADA = {
  email: "ada@example.test",
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "0211234567",
}

describe("customerDetailsOf", () => {
  it("gives a customer the user's name, email and phone", () => {
    expect(customerDetailsOf(ADA)).toEqual({
      email: "ada@example.test",
      name: "Ada Lovelace",
      phone: "0211234567",
    })
  })

  // A template string wrote "null null" as the name of an account that had none.
  it.each([
    [{ firstName: null, lastName: null }, undefined],
    [{ firstName: "Ada", lastName: null }, "Ada"],
    [{ firstName: " ", lastName: "Lovelace" }, "Lovelace"],
  ])("names %j as %j", (parts, name) => {
    expect(customerDetailsOf({ ...ADA, ...parts }).name).toBe(name)
  })

  it("leaves out a phone the account has none of", () => {
    expect(customerDetailsOf({ ...ADA, phone: null })).not.toHaveProperty("phone")
  })
})

describe("staleCustomerDetails", () => {
  const details = customerDetailsOf(ADA)

  it("is null for a customer that is up to date", () => {
    expect(
      staleCustomerDetails(
        { email: ADA.email, name: "Ada Lovelace", phone: ADA.phone },
        details,
      ),
    ).toBeNull()
  })

  it("fills in everything on a customer created before it carried details", () => {
    expect(
      staleCustomerDetails({ email: null, name: null, phone: null }, details),
    ).toEqual(details)
  })

  it("returns only what changed", () => {
    expect(
      staleCustomerDetails(
        { email: ADA.email, name: "Ada Lovelace", phone: "0220000000" },
        details,
      ),
    ).toEqual({ phone: ADA.phone })
  })

  it("never blanks a name or phone the account has no value for", () => {
    expect(
      staleCustomerDetails(
        { email: ADA.email, name: "Ada Lovelace", phone: "0211234567" },
        customerDetailsOf({ ...ADA, firstName: null, lastName: null, phone: null }),
      ),
    ).toBeNull()
  })
})

describe("describeStripeFailure", () => {
  it("keeps a refusal's type, code and parameter, and not its message", () => {
    const refused = new Stripe.errors.StripeInvalidRequestError({
      type: "invalid_request_error",
      code: "email_invalid",
      param: "email",
      message: "Invalid email address: ada@example.test",
    })

    const described = describeStripeFailure(refused)

    expect(described).toEqual({
      type: "StripeInvalidRequestError",
      code: "email_invalid",
      param: "email",
    })
    expect(JSON.stringify(described)).not.toContain("ada@example.test")
  })
})
