import { describe, it, expect } from "vitest"
import {
  canRedeemAudience,
  offerRefusalMessage,
  redeemableAudiences,
} from "./offerAudience"

const MEMBER = { isActiveMember: true, isNewCustomer: false }
const NEW = { isActiveMember: false, isNewCustomer: true }
const NEITHER = { isActiveMember: false, isNewCustomer: false }
const BOTH = { isActiveMember: true, isNewCustomer: true }

describe("canRedeemAudience", () => {
  it("lets anyone redeem an offer open to everyone", () => {
    expect(canRedeemAudience("EVERYONE", NEITHER)).toBe(true)
    expect(canRedeemAudience("EVERYONE", MEMBER)).toBe(true)
    expect(canRedeemAudience("EVERYONE", NEW)).toBe(true)
  })

  it("restricts members-only offers to active members", () => {
    expect(canRedeemAudience("MEMBERS", MEMBER)).toBe(true)
    expect(canRedeemAudience("MEMBERS", BOTH)).toBe(true)
    expect(canRedeemAudience("MEMBERS", NEITHER)).toBe(false)
    // Being new is not a substitute for being a member.
    expect(canRedeemAudience("MEMBERS", NEW)).toBe(false)
  })

  it("restricts first-order offers to customers who have not ordered", () => {
    expect(canRedeemAudience("NEW_USERS", NEW)).toBe(true)
    expect(canRedeemAudience("NEW_USERS", NEITHER)).toBe(false)
    // Paying for a membership does not make you a new customer again.
    expect(canRedeemAudience("NEW_USERS", MEMBER)).toBe(false)
  })

  it("lets a brand new member redeem from every audience", () => {
    expect(canRedeemAudience("EVERYONE", BOTH)).toBe(true)
    expect(canRedeemAudience("MEMBERS", BOTH)).toBe(true)
    expect(canRedeemAudience("NEW_USERS", BOTH)).toBe(true)
  })
})

describe("redeemableAudiences", () => {
  it("always includes EVERYONE", () => {
    expect(redeemableAudiences(NEITHER)).toEqual(["EVERYONE"])
  })

  it("adds each audience the viewer qualifies for", () => {
    expect(redeemableAudiences(MEMBER)).toEqual(["EVERYONE", "MEMBERS"])
    expect(redeemableAudiences(NEW)).toEqual(["EVERYONE", "NEW_USERS"])
    expect(redeemableAudiences(BOTH)).toEqual([
      "EVERYONE",
      "MEMBERS",
      "NEW_USERS",
    ])
  })

  it("agrees with canRedeemAudience for every combination", () => {
    const audiences = ["EVERYONE", "MEMBERS", "NEW_USERS"] as const
    for (const viewer of [MEMBER, NEW, NEITHER, BOTH]) {
      for (const audience of audiences) {
        expect(redeemableAudiences(viewer).includes(audience)).toBe(
          canRedeemAudience(audience, viewer),
        )
      }
    }
  })
})

describe("offerRefusalMessage", () => {
  it("points a non-member at the membership", () => {
    expect(offerRefusalMessage("MEMBERS")).toMatch(/membership/i)
  })

  it("explains a first-order offer without inviting a purchase", () => {
    expect(offerRefusalMessage("NEW_USERS")).toMatch(/first-time/i)
    expect(offerRefusalMessage("NEW_USERS")).not.toMatch(/membership/i)
  })
})
