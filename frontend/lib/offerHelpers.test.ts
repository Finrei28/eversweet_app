import { canRedeemAudience } from "./offerHelpers"
import { OfferAudience } from "@/utils/types"

const everything = { isActiveMember: true, isNewCustomer: true }

describe("canRedeemAudience", () => {
  it("follows the viewer for the audiences this build knows", () => {
    expect(canRedeemAudience("EVERYONE", { isActiveMember: false, isNewCustomer: false })).toBe(true)
    expect(canRedeemAudience("MEMBERS", { isActiveMember: false, isNewCustomer: true })).toBe(false)
    expect(canRedeemAudience("MEMBERS", everything)).toBe(true)
    expect(canRedeemAudience("NEW_USERS", { isActiveMember: true, isNewCustomer: false })).toBe(false)
    expect(canRedeemAudience("NEW_USERS", everything)).toBe(true)
  })

  /**
   * An audience added to the enum after this build was made. The switch had no default, so it
   * answered `undefined`; locked is the same outcome said on purpose, and never a Redeem the
   * server would refuse.
   */
  it("is locked for an audience it does not know, whoever is looking", () => {
    expect(canRedeemAudience("STAFF" as OfferAudience, everything)).toBe(false)
  })
})
