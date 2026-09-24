// expo-application reads native constants that do not exist under jest.
jest.mock("expo-application", () => ({
  nativeBuildVersion: "114",
  nativeApplicationVersion: "1.0.0",
}))

// Reading the token crosses the native bridge into SecureStore.
jest.mock("@/services/authToken", () => ({
  getToken: jest.fn(async () => "test-token"),
}))

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

import { getLeaderboardDetails } from "@/services/api"

const fetchMock = jest.fn()
global.fetch = fetchMock as unknown as typeof fetch

const PODIUM = { show: true, description: "", lastMonthsWinner: null }

const requestedUrl = (call: number) => String(fetchMock.mock.calls[call][0])

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => PODIUM,
    headers: { get: () => null },
  })
})

/**
 * The podium is served `Cache-Control: public, max-age=60`, and the phone's own HTTP cache
 * honours that. Right after a customer switches anonymity - the one moment the banner has to
 * change - an ordinary refetch can be answered on the device with their name still in it.
 */
describe("getLeaderboardDetails", () => {
  it("asks for the plain URL normally, so the cache can do its job", async () => {
    await getLeaderboardDetails()

    expect(requestedUrl(0)).toMatch(/\/api\/getLeaderboardDetails$/)
  })

  it("asks for a URL no cache has seen when told to fetch fresh", async () => {
    const now = jest.spyOn(Date, "now")
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(2_000)

    await getLeaderboardDetails({ fresh: true })
    await getLeaderboardDetails({ fresh: true })

    expect(requestedUrl(0)).toMatch(/\/api\/getLeaderboardDetails\?fresh=\d+$/)
    // Two refetches in one minute must not share a URL, or the second is the cached first.
    expect(requestedUrl(0)).not.toBe(requestedUrl(1))

    now.mockRestore()
  })

  it("still hands back the podium", async () => {
    await expect(getLeaderboardDetails({ fresh: true })).resolves.toEqual(PODIUM)
  })
})
