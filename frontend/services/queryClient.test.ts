// Pulled in through apiClient, which reads the build number from the binary.
jest.mock("expo-application", () => ({
  nativeBuildVersion: "114",
  nativeApplicationVersion: "1.1.0",
}))

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import { AppUpdateRequiredError } from "@/services/apiClient"
import { queryClient } from "@/services/queryClient"

const retry = queryClient.getDefaultOptions().queries?.retry as (
  failureCount: number,
  error: Error,
) => boolean

describe("how the query client retries", () => {
  it("does not retry a request the server refused as an out-of-date build", () => {
    // It will be refused again. A blocked launch has a dozen requests in it, and
    // retrying each twice turns that into thirty-odd.
    expect(retry(0, new AppUpdateRequiredError("Please update"))).toBe(false)
  })

  it("still retries an ordinary failure twice", () => {
    expect(retry(0, new Error("network"))).toBe(true)
    expect(retry(1, new Error("network"))).toBe(true)
    expect(retry(2, new Error("network"))).toBe(false)
  })
})
