import { describe, expect, it } from "vitest"
import { render } from "@react-email/render"

import MembershipWelcome, { type MembershipWelcomeProps } from "./membershipWelcome"
import EmailOrderConfirmation from "./orderConfirmation"
import { gstFromInclusive } from "../lib/cartPricing"

/**
 * The rendered email as plain text, which is what these assertions care about, with the
 * renderer's line wrapping undone so a phrase is not split across lines.
 */
const textOf = async (element: React.JSX.Element) =>
  (await render(element, { plainText: true })).replace(/\s+/g, " ")

describe("the membership welcome email", () => {
  const welcome = (overrides: Partial<MembershipWelcomeProps> = {}) =>
    textOf(
      MembershipWelcome({
        ...(MembershipWelcome.PreviewProps as MembershipWelcomeProps),
        ...overrides,
      }),
    )

  it("renders, with the payment, the discount and when it renews", async () => {
    const text = await welcome()

    // Plain-text rendering upper-cases headings.
    expect(text).toMatch(/welcome to the membership, ada!/i)
    expect(text).toContain("$9.99")
    expect(text).toContain("5% off")
    expect(text).toContain("up by 5% for each month in a row you pay for, up to 25%")
    expect(text).toContain("Sunday, 25 October 2026")
    expect(text).toContain("Anything already in your cart now has your member price.")
  })

  it("says nothing it cannot back up", async () => {
    const text = await welcome({
      firstName: null,
      amountPaidInCents: null,
      discountPercent: 25,
      cartRepriced: false,
    })

    expect(text).toMatch(/welcome to the membership!/i)
    expect(text).not.toContain("first payment")
    // At the cap there is no further step to promise.
    expect(text).not.toContain("goes up by")
    expect(text).not.toContain("already in your cart")
  })
})

describe("the order confirmation email", () => {
  it("shows the GST contained in the price, not 15% on top of it", async () => {
    const order = {
      id: "order",
      tempOrderId: "6001",
      priceInCents: 2300,
      discountedAmountInCents: 0,
      GST: gstFromInclusive(2300),
      createdAt: new Date("2026-09-25T02:00:00Z"),
      customerFirstName: "Ada",
      customerLastName: "Lovelace",
      customerEmail: "ada@example.test",
      customerPhoneNumber: null,
      pickedUpAt: null,
      pickUpTime: new Date("2026-09-25T04:00:00Z"),
      status: "PENDING" as const,
      dineIn: false,
      desserts: [],
    }

    const text = await textOf(EmailOrderConfirmation({ order }))

    // $23.00 contains $3.00 of GST. 15% of it, which this used to show, is $3.45.
    expect(text).toContain("$3.00")
    expect(text).not.toContain("$3.45")
  })
})
