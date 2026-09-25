import { isPaidUpMember } from "./membership"
import {
  calculateBestDiscountedPrice,
  calculateMembershipDiscount,
  calculatePriceAfterMembershipDiscount,
} from "./priceHelper"
import { Dessert, UsersMembership } from "@/utils/types"

const membership = (
  overrides: Partial<UsersMembership> = {},
): UsersMembership => ({
  id: "membership",
  createdAt: new Date(),
  startDate: new Date(),
  endDate: new Date(),
  paymentStatus: "SUCCESS",
  stripeSubscriptionId: "sub",
  planId: "plan",
  isActive: true,
  totalMonths: 2,
  cancel: false,
  plan: {
    id: "plan",
    name: "Monthly_Membership",
    stripePriceId: "price",
    membershipDiscount: 5,
    maxDiscount: 25,
  },
  ...overrides,
})

// Only the fields the price helpers read.
const dessert = { priceInCents: 1000, promo: null } as unknown as Dessert

describe("isPaidUpMember", () => {
  it("is a running, paid-up membership", () => {
    expect(isPaidUpMember(membership())).toBe(true)
  })

  it("is not a membership on hold", () => {
    expect(isPaidUpMember(membership({ paymentStatus: "PENDING" }))).toBe(false)
  })

  it("is not one that has ended, or none at all", () => {
    expect(isPaidUpMember(membership({ isActive: false }))).toBe(false)
    expect(isPaidUpMember(null)).toBe(false)
  })
})

describe("member prices on the menu", () => {
  it("show a paid-up member their price", () => {
    expect(calculateBestDiscountedPrice(dessert, membership())).toBe(900)
    expect(calculatePriceAfterMembershipDiscount(1000, membership())).toBe(900)
    expect(calculateMembershipDiscount(1000, membership())).toBe(100)
  })

  it("show a member on hold the full price, as the server charges it", () => {
    const onHold = membership({ paymentStatus: "PENDING" })
    expect(calculateBestDiscountedPrice(dessert, onHold)).toBe(1000)
    expect(calculatePriceAfterMembershipDiscount(1000, onHold)).toBe(1000)
    expect(calculateMembershipDiscount(1000, onHold)).toBe(0)
  })
})
