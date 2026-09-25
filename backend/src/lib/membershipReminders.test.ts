import { describe, expect, it } from "vitest"

import {
  benefitsAtStake,
  membershipEndingText,
  renewalDeclinedText,
} from "./membershipReminders"

const PERK = "free weekly Mochi Series Bowl ($9.99)"
/** 3 PM on Thursday 15 October in Auckland. */
const END = new Date("2026-10-15T02:00:00.000Z")

/**
 * What the two membership pushes say. Each names the discount, one perk and the rest, so a
 * member hears everything that goes - and the discount's restart only where it means
 * something.
 */
describe("membership warning wording", () => {
  it("names the discount, the perk and the rest", () => {
    expect(benefitsAtStake({ discountPercent: 20, stepPercent: 5, perk: PERK })).toBe(
      `Your 20% member discount, ${PERK} and your other member benefits`,
    )
  })

  it("names the discount alone when the list has no perk to name", () => {
    expect(benefitsAtStake({ discountPercent: 20, stepPercent: 5, perk: null })).toBe(
      "Your 20% member discount and your other member benefits",
    )
  })

  it("dates the end in Auckland and warns of the restart", () => {
    expect(
      membershipEndingText({ discountPercent: 20, stepPercent: 5, perk: PERK }, END),
    ).toBe(
      `Your 20% member discount, ${PERK} and your other member benefits end on Thursday 15 October. Re-subscribe before then to keep them. If it ends, rejoining starts the discount again at 5%.`,
    )
  })

  /** Still on the first step, rejoining gives the same figure: no restart to warn about. */
  it("says nothing of a restart to a member on the first step", () => {
    const atStake = { discountPercent: 5, stepPercent: 5, perk: PERK }
    expect(membershipEndingText(atStake, END)).not.toMatch(/starts the discount again/)
    expect(renewalDeclinedText(atStake)).toBe(
      `Your 5% member discount, ${PERK} and your other member benefits are paused. Retry the payment in the app to keep them. If it stays unpaid, your membership ends.`,
    )
  })

  it("says a declined renewal pauses everything, and what an unpaid one costs", () => {
    expect(
      renewalDeclinedText({ discountPercent: 25, stepPercent: 5, perk: PERK }),
    ).toBe(
      `Your 25% member discount, ${PERK} and your other member benefits are paused. Retry the payment in the app to keep them. If it stays unpaid, your membership ends and the discount starts again at 5%.`,
    )
  })
})
