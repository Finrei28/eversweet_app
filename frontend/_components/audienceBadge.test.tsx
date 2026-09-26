import { act, create, ReactTestRenderer } from "react-test-renderer"
import { OfferAudience } from "@/utils/types"

// The real icon set loads its font asynchronously and sets state when it lands,
// which arrives as an act() warning long after a test has finished.
jest.mock("@expo/vector-icons", () => ({
  MaterialCommunityIcons: "MaterialCommunityIcons",
}))

import AudienceBadge from "./audienceBadge"

const render = (audience: OfferAudience) => {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(<AudienceBadge audience={audience} />)
  })
  return tree
}

describe("AudienceBadge", () => {
  it("labels the audiences this build knows", () => {
    expect(JSON.stringify(render("MEMBERS").toJSON())).toContain("Members")
    expect(JSON.stringify(render("NEW_USERS").toJSON())).toContain("First order")
  })

  it("shows nothing for an offer open to everyone", () => {
    expect(render("EVERYONE").toJSON()).toBeNull()
  })

  /**
   * An audience added to the enum after this build. The badge read `style.wrapper` off
   * `undefined` and threw, and the home carousel renders it: one new value would have taken the
   * home screen down on every installed build, with no over-the-air update to fix it.
   */
  it("shows nothing, rather than throwing, for an audience it does not know", () => {
    expect(() => render("STAFF" as OfferAudience)).not.toThrow()
    expect(render("STAFF" as OfferAudience).toJSON()).toBeNull()
  })
})
