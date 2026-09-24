import { describe, expect, it } from "vitest"

import {
  DEFAULT_MEMBERSHIP_BENEFITS,
  MEMBER_RATE_TOKEN,
  POINTS_NEVER_EXPIRE_BENEFIT,
  WHILE_POINTS_EXPIRE_TOKEN,
  resolveMembershipBenefits,
} from "./membership"

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
