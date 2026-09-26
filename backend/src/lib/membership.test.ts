import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEFAULT_MEMBERSHIP_BENEFITS,
  MEMBER_RATE_TOKEN,
  POINTS_NEVER_EXPIRE_BENEFIT,
  WHILE_POINTS_EXPIRE_TOKEN,
  headlinePerk,
  loadMembershipBenefits,
  membershipPlanName,
  resolveMembershipBenefits,
} from "./membership"

const settings = vi.hoisted(() => ({
  rates: { rate: 6, memberRate: 1.5, modifier: 1 },
  pointsExpireFrom: null as Date | null,
}))
vi.mock("./loyaltyRates", () => ({
  getLoyaltyRates: async () => settings.rates,
  getPointsExpireFrom: async () => settings.pointsExpireFrom,
}))

const rates = (memberRate: number) => ({ rate: 6, memberRate, modifier: 1 })

/**
 * The benefits list is the one piece of customer-facing copy that quotes a number the shop
 * can change. It advertised "Earn 2x loyalty points" for months while members earned 1.5x,
 * so the number is a token filled in from the live rates rather than typed.
 */
describe("resolveMembershipBenefits", () => {
  it("fills the token in from the live rate", () => {
    expect(
      resolveMembershipBenefits(
        [`Earn ${MEMBER_RATE_TOKEN}x loyalty points`],
        rates(1.5),
      ),
    ).toEqual(["Earn 1.5x loyalty points"])
  })

  it("follows a changed rate", () => {
    const benefits = [`Earn ${MEMBER_RATE_TOKEN}x loyalty points`]

    expect(resolveMembershipBenefits(benefits, rates(2))).toEqual([
      "Earn 2x loyalty points",
    ])
    expect(resolveMembershipBenefits(benefits, rates(1.75))).toEqual([
      "Earn 1.75x loyalty points",
    ])
  })

  /** "2.0x" reads as a typo. */
  it("does not leave a trailing zero on a whole multiplier", () => {
    expect(
      resolveMembershipBenefits([`${MEMBER_RATE_TOKEN}x`], rates(2.0)),
    ).toEqual(["2x"])
  })

  it("leaves a benefit without the token alone", () => {
    expect(
      resolveMembershipBenefits(["Cancel anytime"], rates(1.5)),
    ).toEqual(["Cancel anytime"])
  })

  it("fills in every occurrence", () => {
    expect(
      resolveMembershipBenefits(
        [`${MEMBER_RATE_TOKEN}x points, yes ${MEMBER_RATE_TOKEN}x`],
        rates(1.5),
      ),
    ).toEqual(["1.5x points, yes 1.5x"])
  })

  /**
   * The specific bug the review found: the fallback interpolated the compiled-in constant
   * at module load, so an admin who changed the rate got the new multiplier on their orders
   * and the old one in this list.
   */
  it("leaves no number baked into the fallback", () => {
    expect(DEFAULT_MEMBERSHIP_BENEFITS.join(" ")).toContain(MEMBER_RATE_TOKEN)
    expect(DEFAULT_MEMBERSHIP_BENEFITS.join(" ")).not.toMatch(
      /\d+(\.\d+)?x loyalty points/,
    )
  })

  it("resolves the fallback against whatever the rate currently is", () => {
    expect(resolveMembershipBenefits(DEFAULT_MEMBERSHIP_BENEFITS, rates(3))).toContain(
      "Earn 3x loyalty points",
    )
  })
})

/**
 * "Your Sweet Points never expire while you're a member" is an advantage only while everyone
 * else's points expire. With expiry off it would claim something members do not get over
 * anyone else, so the line is shown only while expiry is on.
 */
describe("the benefit that depends on points expiry", () => {
  const list = ["Cancel anytime", POINTS_NEVER_EXPIRE_BENEFIT]

  it("is shown without its token while expiry is on", () => {
    expect(
      resolveMembershipBenefits(list, rates(1.5), { pointsExpire: true }),
    ).toEqual([
      "Cancel anytime",
      "Your Sweet Points never expire while you're a member",
    ])
  })

  it("is dropped while expiry is off", () => {
    expect(
      resolveMembershipBenefits(list, rates(1.5), { pointsExpire: false }),
    ).toEqual(["Cancel anytime"])
  })

  /** A caller that forgets to say gets the line hidden, never a claim that may be false. */
  it("is dropped when the caller does not say", () => {
    expect(resolveMembershipBenefits(list, rates(1.5))).toEqual(["Cancel anytime"])
  })

  it("never serves the token itself", () => {
    for (const pointsExpire of [true, false]) {
      const served = resolveMembershipBenefits(
        [...DEFAULT_MEMBERSHIP_BENEFITS],
        rates(1.5),
        { pointsExpire },
      )
      expect(served.join(" ")).not.toContain("{{")
    }
  })

  /** The token works on any line an admin writes, not just the seeded wording. */
  it("hides an admin's own wording of it too", () => {
    const own = `${WHILE_POINTS_EXPIRE_TOKEN}Members keep their points for good`
    expect(resolveMembershipBenefits([own], rates(1.5))).toEqual([])
    expect(
      resolveMembershipBenefits([own], rates(1.5), { pointsExpire: true }),
    ).toEqual(["Members keep their points for good"])
  })

  it("is in the fallback list, so an unseeded plan follows the switch too", () => {
    expect(DEFAULT_MEMBERSHIP_BENEFITS).toContain(POINTS_NEVER_EXPIRE_BENEFIT)
  })
})

describe("loadMembershipBenefits", () => {
  beforeEach(() => {
    settings.rates = { rate: 6, memberRate: 1.5, modifier: 1 }
    settings.pointsExpireFrom = null
  })

  it("serves the plan's own list, resolved", async () => {
    expect(
      await loadMembershipBenefits([`Earn ${MEMBER_RATE_TOKEN}x points`, "Cancel anytime"]),
    ).toEqual(["Earn 1.5x points", "Cancel anytime"])
  })

  it("falls back for a plan with no list of its own", async () => {
    expect(await loadMembershipBenefits([])).toContain(
      "Free weekly Mochi Series Bowl ($9.99)",
    )
  })

  it("follows the expiry switch", async () => {
    const line = "Your Sweet Points never expire while you're a member"
    expect(await loadMembershipBenefits([])).not.toContain(line)
    settings.pointsExpireFrom = new Date("2026-09-01T00:00:00Z")
    expect(await loadMembershipBenefits([])).toContain(line)
  })
})

/**
 * The perk a warning names beside the discount. It comes from the list the shop edits, so the
 * push can never advertise a perk that has been dropped.
 */
describe("headlinePerk", () => {
  it("names the free bowl from the default list, ready to sit mid-sentence", () => {
    expect(
      headlinePerk(
        resolveMembershipBenefits(DEFAULT_MEMBERSHIP_BENEFITS, rates(1.5)),
      ),
    ).toBe("free weekly Mochi Series Bowl ($9.99)")
  })

  it("keeps the shop's order", () => {
    expect(
      headlinePerk(["Exclusive membership offers", "Free weekly Mochi Series Bowl"]),
    ).toBe("exclusive membership offers")
  })

  /** The warning names the discount already, with the member's own figure. */
  it("skips the discount line and cancelling", () => {
    expect(
      headlinePerk([
        "Stackable membership discount from 5% to 25%",
        "Cancel anytime",
        "Free birthday dessert",
      ]),
    ).toBe("free birthday dessert")
  })

  it("is null when nothing else is left to name", () => {
    expect(headlinePerk(["Stackable membership discount", "Cancel anytime"])).toBeNull()
    expect(headlinePerk([])).toBeNull()
    expect(headlinePerk(["   "])).toBeNull()
  })
})

describe("membershipPlanName", () => {
  // A Stripe price lives in one mode only, so the plan has to follow the key: the live
  // plan's price asked for with a test key is resource_missing, and the other way round.
  it("sells the live plan on a live key, secret or restricted", () => {
    expect(membershipPlanName("sk_live_abc")).toBe("Monthly_Membership")
    expect(membershipPlanName("rk_live_abc")).toBe("Monthly_Membership")
  })

  it("sells the test plan on a test key", () => {
    expect(membershipPlanName("sk_test_abc")).toBe("Test_Membership")
    expect(membershipPlanName("rk_test_abc")).toBe("Test_Membership")
  })

  it("never takes a key that merely mentions live for a live one", () => {
    expect(membershipPlanName("sk_test_live_abc")).toBe("Test_Membership")
    expect(membershipPlanName(undefined)).toBe("Test_Membership")
  })
})
