jest.mock("@/_components/custom-header", () => "CustomHeader")
jest.mock("@/_components/loader", () => "BouncingLoader")

import { platformLabel } from "./legalDocumentScreen"
import { LegalPlatform } from "@/utils/types"

describe("platformLabel", () => {
  it("labels a section for one channel", () => {
    expect(platformLabel(["app"])).toBe("In this app")
    expect(platformLabel(["web"])).toBe("Ordering on our website")
  })

  it("leaves a section for both, or neither, unlabelled", () => {
    expect(platformLabel(undefined)).toBeNull()
    expect(platformLabel([])).toBeNull()
    expect(platformLabel(["app", "web"])).toBeNull()
  })

  /**
   * A platform added to the documents after this build. It was labelled as the website,
   * because anything but "app" was.
   */
  it("does not call a platform it does not know the website", () => {
    expect(platformLabel(["kiosk" as LegalPlatform])).toBeNull()
  })
})
