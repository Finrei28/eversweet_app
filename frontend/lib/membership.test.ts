import {
  builtUpDiscountPercent,
  headlinePerk,
  isPaidUpMember,
  memberDiscountPercent,
  membershipWarning,
  needsBankConfirmation,
} from "./membership"
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

  /**
   * The helpers read `(totalMonths ?? 1) * step`, so a count of 0 priced the line at full
   * price while the server - which gives a paid-up member at least the first step - charged
   * the member price.
   */
  it("give a paid-up member at least the first step, as the server does", () => {
    const noMonthsCounted = membership({ totalMonths: 0 })
    expect(calculateBestDiscountedPrice(dessert, noMonthsCounted)).toBe(950)
    expect(calculatePriceAfterMembershipDiscount(1000, noMonthsCounted)).toBe(950)
    expect(calculateMembershipDiscount(1000, noMonthsCounted)).toBe(50)
  })

  it("stop at the plan's cap", () => {
    const longServing = membership({ totalMonths: 12 })
    expect(calculatePriceAfterMembershipDiscount(1000, longServing)).toBe(750)
    expect(calculateMembershipDiscount(1000, longServing)).toBe(250)
  })

  it("give nobody without a membership a discount", () => {
    expect(calculateBestDiscountedPrice(dessert, null)).toBe(1000)
    expect(calculateMembershipDiscount(1000, null)).toBe(0)
  })
})

describe("memberDiscountPercent", () => {
  it("is the built-up discount for a paid-up member and nothing otherwise", () => {
    expect(memberDiscountPercent(membership({ totalMonths: 3 }))).toBe(15)
    expect(memberDiscountPercent(membership({ totalMonths: 0 }))).toBe(5)
    expect(
      memberDiscountPercent(membership({ totalMonths: 3, paymentStatus: "PENDING" })),
    ).toBe(0)
    expect(memberDiscountPercent(membership({ isActive: false }))).toBe(0)
    expect(memberDiscountPercent(null)).toBe(0)
  })
})

describe("builtUpDiscountPercent", () => {
  it("is the run's discount, whether or not it is being given", () => {
    expect(builtUpDiscountPercent(membership({ totalMonths: 4 }))).toBe(20)
    expect(
      builtUpDiscountPercent(membership({ totalMonths: 4, paymentStatus: "PENDING" })),
    ).toBe(20)
  })

  it("stops at the cap and starts at the first step, as the server does", () => {
    expect(builtUpDiscountPercent(membership({ totalMonths: 9 }))).toBe(25)
    expect(builtUpDiscountPercent(membership({ totalMonths: 0 }))).toBe(5)
  })
})

const BENEFITS = [
  "Free weekly Mochi Series Bowl ($9.99)",
  "Stackable membership discount from 5% to 25%, up by 5% each month",
  "Earn 1.5x loyalty points",
  "Cancel anytime",
]

describe("headlinePerk", () => {
  it("names the first perk in the shop's order, ready to sit mid-sentence", () => {
    expect(headlinePerk(BENEFITS)).toBe("free weekly Mochi Series Bowl ($9.99)")
  })

  it("skips the discount line and cancelling", () => {
    expect(headlinePerk(BENEFITS.slice(1))).toBe("earn 1.5x loyalty points")
    expect(headlinePerk(["Stackable membership discount", "Cancel anytime"])).toBeNull()
  })
})

/**
 * 10 AM on Monday 12 October in Auckland. The banner is for a member about to lose what they
 * have built up, and nobody else.
 */
describe("membershipWarning", () => {
  const now = new Date("2026-10-11T21:00:00.000Z")
  /** 3 PM on Thursday 15 October in Auckland. */
  const endsThursday = new Date("2026-10-15T02:00:00.000Z")

  it("names the discount, the perk and the rest while a renewal is on hold", () => {
    expect(
      membershipWarning(
        membership({ paymentStatus: "PENDING", totalMonths: 4 }),
        BENEFITS,
        now,
      ),
    ).toBe(
      "Your 20% member discount, free weekly Mochi Series Bowl ($9.99) and your other member benefits are paused until your renewal is paid. Tap to retry the payment.",
    )
  })

  /**
   * A bank waiting for 3D Secure was worded as an unpaid renewal, which sent a member whose
   * card was fine off to replace it.
   */
  it("asks the member to confirm a renewal their bank is holding", () => {
    expect(
      membershipWarning(
        membership({
          paymentStatus: "PENDING",
          paymentFailureCode: "authentication_required",
          totalMonths: 4,
        }),
        BENEFITS,
        now,
      ),
    ).toBe(
      "Your bank needs you to confirm this month's payment. Your 20% member discount, free weekly Mochi Series Bowl ($9.99) and your other member benefits are paused until you do. Tap to confirm it.",
    )
  })

  it("words any other hold as an unpaid renewal", () => {
    expect(
      membershipWarning(
        membership({ paymentStatus: "PENDING", paymentFailureCode: "card_declined" }),
        BENEFITS,
        now,
      ),
    ).toMatch(/paused until your renewal is paid\. Tap to retry the payment\.$/)
  })

  /** The code outlives the hold only if a server forgot to clear it; paid up is paid up. */
  it("says nothing to a paid-up member whose last hold was the bank's", () => {
    expect(
      needsBankConfirmation(
        membership({ paymentStatus: "SUCCESS", paymentFailureCode: "authentication_required" }),
      ),
    ).toBe(false)
  })

  it("dates a cancelled membership's end in New Zealand time", () => {
    expect(
      membershipWarning(
        membership({ cancel: true, endDate: endsThursday, totalMonths: 3 }),
        BENEFITS,
        now,
      ),
    ).toBe(
      "Your 15% member discount, free weekly Mochi Series Bowl ($9.99) and your other member benefits end on Thursday 15 October. Tap to re-subscribe and keep them.",
    )
  })

  it("waits until a cancelled membership's last week", () => {
    const farOff = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000)
    expect(
      membershipWarning(membership({ cancel: true, endDate: farOff }), BENEFITS, now),
    ).toBeNull()
  })

  it("names the discount alone before the benefits have loaded", () => {
    expect(
      membershipWarning(membership({ paymentStatus: "PENDING" }), [], now),
    ).toMatch(/^Your 10% member discount and your other member benefits are paused/)
  })

  it("says nothing to a renewing member, an ended one, or nobody", () => {
    expect(membershipWarning(membership({ endDate: endsThursday }), BENEFITS, now)).toBeNull()
    expect(
      membershipWarning(
        membership({ cancel: true, isActive: false, endDate: endsThursday }),
        BENEFITS,
        now,
      ),
    ).toBeNull()
    expect(
      membershipWarning(
        membership({ cancel: true, endDate: new Date(now.getTime() - 1000) }),
        BENEFITS,
        now,
      ),
    ).toBeNull()
    expect(membershipWarning(null, BENEFITS, now)).toBeNull()
  })
})
